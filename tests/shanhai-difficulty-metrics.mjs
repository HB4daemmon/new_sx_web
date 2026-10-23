const OUTCOMES = Object.freeze(['won', 'lost', 'undecided', 'error']);
const ACTS = Object.freeze([1, 2, 3, 4]);

function finiteValues(values) {
  return values.filter(value => typeof value === 'number' && Number.isFinite(value));
}

export function wilson95(successes, total) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) ||
    successes < 0 || total < 0 || successes > total) {
    throw new Error('Wilson interval requires 0 <= successes <= total');
  }
  if (total === 0) return null;

  const z = 1.959963984540054;
  const rate = successes / total;
  const denominator = 1 + z * z / total;
  const center = (rate + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(rate * (1 - rate) / total + z * z / (4 * total * total)) / denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export function rateSummary(successes, total) {
  return {
    successes,
    total,
    rate: total ? successes / total : null,
    wilson95: wilson95(successes, total),
  };
}

function countOutcomes(rows) {
  return Object.fromEntries(OUTCOMES.map(result => [
    result,
    rows.filter(row => row.result === result).length,
  ]));
}

function quantiles(values) {
  const sorted = finiteValues(values).slice().sort((left, right) => left - right);
  const pick = percentile => sorted.length
    ? sorted[Math.floor((sorted.length - 1) * percentile)]
    : null;
  return {
    min: sorted.length ? sorted[0] : null,
    p50: pick(0.5),
    p90: pick(0.9),
    max: sorted.length ? sorted.at(-1) : null,
    mean: sorted.length
      ? sorted.reduce((total, value) => total + value, 0) / sorted.length
      : null,
  };
}

export function summarizeBattles(battles) {
  const losses = finiteValues(battles.map(battle => battle.playerNetHpLoss));
  const lossPercentages = finiteValues(battles.map(battle => battle.playerNetHpLossPct));
  return {
    battles: battles.length,
    outcomes: countOutcomes(battles),
    rounds: quantiles(battles.map(battle => battle.rounds)),
    playerNetHpLoss: {
      total: losses.length ? losses.reduce((total, value) => total + value, 0) : null,
      ...quantiles(losses),
    },
    playerNetHpLossPct: quantiles(lossPercentages),
  };
}

function actPass(rows, act, totalRuns = rows.length) {
  const entered = rows.filter(row => row.enteredActs.includes(act));
  const cleared = entered.filter(row => row.clearedActs.includes(act));
  const cumulative = rows.filter(row =>
    Array.from({ length: act }, (_, index) => index + 1)
      .every(requiredAct => row.clearedActs.includes(requiredAct)));
  return {
    cumulative: rateSummary(cumulative.length, totalRuns),
    conditional: rateSummary(cleared.length, entered.length),
    entered: entered.length,
  };
}

function finalBattlePass(rows) {
  const entrants = rows.filter(row => row.enteredActs.includes(5));
  const wins = entrants.filter(row => row.finalBattle?.result === 'won');
  return {
    eligibleRuns: entrants.length,
    wins: wins.length,
    outcomes: countOutcomes(entrants.map(row => ({
      result: row.finalBattle?.result ?? (row.result === 'error' ? 'error' : 'undecided'),
    }))),
    winRate: rateSummary(wins.length, entrants.length),
  };
}

function groupedBattleStats(rows, keyFor, labelFor) {
  const groups = new Map();
  for (const run of rows) {
    for (const battle of run.battles) {
      const key = keyFor(battle);
      if (key === null || key === undefined) continue;
      const group = groups.get(key) ?? { ...labelFor(battle), battles: [], deaths: 0 };
      group.battles.push(battle);
      groups.set(key, group);
    }
    if (run.result === 'lost' && run.fatal) {
      const key = keyFor(run.fatal);
      if (key !== null && key !== undefined) {
        const group = groups.get(key) ?? { ...labelFor(run.fatal), battles: [], deaths: 0 };
        group.deaths += 1;
        groups.set(key, group);
      }
    }
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, group]) => {
      const { battles, ...labels } = group;
      return [key, {
        ...labels,
        deaths: group.deaths,
        ...summarizeBattles(battles),
      }];
    }));
}

function runOutcomes(rows) {
  return countOutcomes(rows);
}

function summarizeRows(rows, totalRuns = rows.length) {
  return {
    runs: rows.length,
    outcomes: runOutcomes(rows),
    acts: Object.fromEntries(ACTS.map(act => [String(act), actPass(rows, act, totalRuns)])),
    finalBattle: finalBattlePass(rows),
    battles: summarizeBattles(rows.flatMap(row => row.battles)),
  };
}

export function aggregateDifficultyRuns(runs, methods) {
  const methodList = [...methods];
  const totalRuns = runs.length;
  const overall = summarizeRows(runs, totalRuns);
  const byMethod = Object.fromEntries(methodList.map(method => {
    const methodRuns = runs.filter(run => run.method === method);
    return [method, summarizeRows(methodRuns, methodRuns.length)];
  }));

  const deaths = runs.filter(run => run.result === 'lost' && run.fatal);
  const errors = runs.filter(run => run.result === 'error');
  return {
    totalRuns,
    outcomes: runOutcomes(runs),
    acts: overall.acts,
    finalBattle: overall.finalBattle,
    battles: overall.battles,
    byMethod,
    byAct: groupedBattleStats(runs, battle => battle.act, battle => ({ act: battle.act })),
    byNode: groupedBattleStats(
      runs,
      battle => `${battle.act}:${battle.nodeType ?? 'unknown'}:${battle.nodeId ?? 'unknown'}`,
      battle => ({
        act: battle.act,
        nodeType: battle.nodeType ?? null,
        nodeId: battle.nodeId ?? null,
      }),
    ),
    byEnemy: groupedBattleStats(
      runs,
      battle => battle.enemyId,
      battle => ({ enemyId: battle.enemyId }),
    ),
    deaths: {
      total: deaths.length,
      byAct: countBy(deaths, run => run.fatal.act ?? 'unknown'),
      byNode: countBy(deaths, run =>
        `${run.fatal.act ?? 'unknown'}:${run.fatal.nodeType ?? 'unknown'}:${run.fatal.nodeId ?? 'unknown'}`),
      byEnemy: countBy(deaths, run => run.fatal.enemyId ?? 'unknown'),
      unknownLocation: runs.filter(run => run.result === 'lost' && !run.fatal).length,
    },
    errors: {
      total: errors.length,
      records: errors.map(run => ({
        seed: run.seed,
        method: run.method,
        error: run.error,
      })),
    },
  };
}

function countBy(rows, keyFor) {
  const counts = {};
  for (const row of rows) {
    const key = String(keyFor(row));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right)));
}
