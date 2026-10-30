import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { MAX_EQUIPMENT_SLOTS } from '../build/shanhai/equipment.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { nextCommand } from './shanhai-policy.mjs';

export const START_METHODS = Object.freeze(['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05']);
// Handpicked functional win fixtures only; this seed set is not a win-rate cohort.
export const FUNCTIONAL_WIN_SEEDS = Object.freeze({
  RKF01: 'v2-functional-RKF01-1',
  RKF02: 'v2-functional-RKF02-3',
  RKF03: 'v2-functional-RKF03-5',
  RKF04: 'v2-functional-RKF04-0',
  // These seeds exercise all 45 nodes under the revised enemies; they are
  // deliberately selected functional fixtures, not win-rate evidence.
  RKF05: 'v2-functional-RKF05-1',
});
export const METHOD_BRANCHES = Object.freeze({
  RKF01: 'A',
  RKF02: 'B',
  RKF03: 'B',
  RKF04: 'C',
  RKF05: 'B',
});

export const REFERENCE_EQUIPMENT = Object.freeze(['RC11', 'RC10', 'RC01', 'RC17', 'RC02']);

const V2_REPORT_DIRECTORY = 'verification/shanhai/v2';

function clone(value) {
  return structuredClone(value);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stable(value[key])]),
    );
  }
  return value;
}

function inputHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function quantiles(values) {
  const sorted = values.filter(finite).slice().sort((a, b) => a - b);
  if (!sorted.length) return { p10: null, p25: null, p50: null, p75: null, p90: null };
  const pick = ratio => sorted[Math.floor((sorted.length - 1) * ratio)];
  return {
    p10: pick(0.10),
    p25: pick(0.25),
    p50: pick(0.50),
    p75: pick(0.75),
    p90: pick(0.90),
  };
}

function outcomeCounts(rows) {
  return resultCounts(rows);
}

function resultCounts(rows) {
  return Object.fromEntries(['won', 'lost', 'undecided', 'error'].map(result => [
    result,
    rows.filter(row => {
      const normalized = ['won', 'lost', 'undecided', 'error'].includes(row.result)
        ? row.result
        : normalizeResult(row.outcome);
      return normalized === result;
    }).length,
  ]));
}

function normalizeResult(outcome) {
  return {
    player: 'won',
    enemy: 'lost',
    draw: 'undecided',
    won: 'won',
    lost: 'lost',
    undecided: 'undecided',
    error: 'error',
  }[outcome] ?? 'error';
}

function enemyByName(content) {
  return new Map(content.entities
    .filter(entity => entity.kind === 'enemy')
    .map(entity => [entity.name, entity.id]));
}

function referenceSegment(enemy) {
  if (enemy.tier === 'final') return 'final';
  if (/-C[12]$/.test(enemy.id)) return 'early';
  if (/-C[34]$/.test(enemy.id)) return 'late';
  if (/-L[12]$/.test(enemy.id)) return 'elite';
  if (/-B[12]$/.test(enemy.id)) return 'boss_entry';
  return enemy.tier;
}

function fixedReferenceTier(enemy) {
  if (!Number.isInteger(enemy.n)) throw new Error(`Enemy ${enemy.id} is missing authored reference tier`);
  return Math.min(4, Math.max(0, enemy.n));
}

function assertLegalEquipment(content, loadout, label) {
  const ids = new Set();
  const groups = new Set();
  for (const stack of loadout.artifacts ?? []) {
    const artifact = content.byId[stack.id];
    if (!artifact || artifact.kind !== 'artifact') {
      throw new Error(`${label} has unknown artifact ${stack.id}`);
    }
    if (!['core', 'support'].includes(artifact.equipment_role)) {
      throw new Error(`${label} has invalid equipment role for ${stack.id}`);
    }
    if (ids.has(stack.id)) throw new Error(`${label} repeats artifact ${stack.id}`);
    ids.add(stack.id);
    if (artifact.unique_group) {
      if (groups.has(artifact.unique_group)) {
        throw new Error(`${label} repeats unique artifact group ${artifact.unique_group}`);
      }
      groups.add(artifact.unique_group);
    }
  }
  if (ids.size > MAX_EQUIPMENT_SLOTS) {
    throw new Error(`${label} exceeds the V2 limit of ${MAX_EQUIPMENT_SLOTS} generic artifact slots`);
  }
}

function playerLoadout(content, enemy, method) {
  const n = fixedReferenceTier(enemy);
  const baseStats = clone(content.rules.cultivation.base_stats_by_tier[n]);
  const talents = (content.byId[method].talents ?? [])
    .filter(talent => talent.tier <= n && talent.branch === METHOD_BRANCHES[method])
    .map(talent => talent.id);
  const loadout = {
    name: `校准参考-${method}`,
    method,
    n,
    talents,
    // A fixed reference, not a sampled run: later cultivation tiers use
    // additional common layers so late encounters are not evaluated against
    // five permanently first-layer items. Never exceed the authored cap.
    artifacts: REFERENCE_EQUIPMENT.map(id => ({
      id,
      stacks: Math.min(content.byId[id].max_stacks, 1 + Math.ceil(n / 2)),
    })),
    baseStats,
    preparation: 0,
    firstStrike: 0,
  };
  assertLegalEquipment(content, loadout, `reference loadout for ${method}`);
  return {
    ...loadout,
    hp: calculateStats(content, loadout).max_hp,
  };
}

function enemyLoadout(content, entity) {
  const loadout = {
    name: entity.name,
    method: entity.method,
    n: entity.n,
    talents: clone(entity.talents ?? []),
    artifacts: clone(entity.artifacts ?? []),
    baseStats: clone(entity.stats),
    preparation: 0,
    firstStrike: 0,
    ...(entity.trial ? { encounterId: entity.id } : {}),
  };
  assertLegalEquipment(content, loadout, `enemy loadout for ${entity.id}`);
  return {
    ...loadout,
    hp: calculateStats(content, loadout).max_hp,
  };
}

function loadoutSummary(content, loadout) {
  return {
    name: loadout.name,
    method: loadout.method,
    n: loadout.n,
    talents: clone(loadout.talents ?? []),
    artifacts: clone(loadout.artifacts ?? []),
    baseStats: clone(loadout.baseStats),
    hp: loadout.hp,
    preparation: loadout.preparation ?? 0,
    firstStrike: loadout.firstStrike ?? 0,
    ...(loadout.encounterId ? { encounterId: loadout.encounterId } : {}),
    calculatedStats: calculateStats(content, loadout),
  };
}

function clampEntryHp(hp, maxHp) {
  return Math.max(0, Math.min(finite(hp) ? hp : maxHp, maxHp));
}

function battleMetrics(content, result, player, enemy) {
  const playerStats = calculateStats(content, player);
  const enemyStats = calculateStats(content, enemy);
  const playerEntryHp = clampEntryHp(player.hp, playerStats.max_hp);
  const enemyEntryHp = clampEntryHp(enemy.hp, enemyStats.max_hp);
  const playerPostBattleHp = Math.max(0, finite(result?.playerHp) ? result.playerHp : 0);
  const enemyPostBattleHp = Math.max(0, finite(result?.enemyHp) ? result.enemyHp : 0);
  const playerFrames = Array.isArray(result?.frames) ? result.frames : [];
  const playerHpValues = [playerEntryHp, ...playerFrames.map(frame => frame.player?.hp).filter(finite)];
  const enemyHpValues = [enemyEntryHp, ...playerFrames.map(frame => frame.enemy?.hp).filter(finite)];
  const playerMinimumHp = playerHpValues.length ? Math.min(...playerHpValues) : playerEntryHp;
  const enemyMinimumHp = enemyHpValues.length ? Math.min(...enemyHpValues) : enemyEntryHp;
  const roundFrames = new Map();
  for (const frame of playerFrames) {
    if (!Number.isInteger(frame.round) || frame.round < 1) continue;
    const frames = roundFrames.get(frame.round) ?? [];
    frames.push(frame);
    roundFrames.set(frame.round, frames);
  }
  const roundNetLosses = [...roundFrames.values()]
    .map(frames => {
      const first = frames[0]?.player?.hp;
      const last = frames.at(-1)?.player?.hp;
      return finite(first) && finite(last) ? first - last : null;
    })
    .filter(finite);
  const playerNetHpLoss = playerEntryHp - playerPostBattleHp;
  const enemyNetHpLoss = enemyEntryHp - enemyPostBattleHp;
  const playerNetHpLossPct = playerNetHpLoss / Math.max(1, playerStats.max_hp) * 100;
  const enemyNetHpLossPct = enemyNetHpLoss / Math.max(1, enemyStats.max_hp) * 100;
  const maxSingleRoundNetLoss = roundNetLosses.length ? Math.max(...roundNetLosses) : 0;
  return {
    entry: {
      player: { hp: playerEntryHp, maxHp: playerStats.max_hp },
      enemy: { hp: enemyEntryHp, maxHp: enemyStats.max_hp },
    },
    postBattle: {
      player: { hp: playerPostBattleHp, maxHp: playerStats.max_hp },
      enemy: { hp: enemyPostBattleHp, maxHp: enemyStats.max_hp },
    },
    playerEntryHp,
    playerEntryMaxHp: playerStats.max_hp,
    enemyEntryHp,
    enemyEntryMaxHp: enemyStats.max_hp,
    playerHp: playerPostBattleHp,
    enemyHp: enemyPostBattleHp,
    playerNetHpLoss,
    playerNetHpLossPct,
    enemyNetHpLoss,
    enemyNetHpLossPct,
    playerMinimumHp,
    enemyMinimumHp,
    maxSingleRoundNetLoss,
    maxSingleRoundNetLossPct: maxSingleRoundNetLoss / Math.max(1, playerStats.max_hp) * 100,
  };
}

export function buildEncounterCalibration(content, seedCount = 5) {
  const enemies = content.entities.filter(entity => entity.kind === 'enemy');
  const records = [];
  const matrix = [];
  const seeds = [];
  for (const enemy of enemies) {
    for (const method of START_METHODS) {
      const player = playerLoadout(content, enemy, method);
      const targetLoadout = enemyLoadout(content, enemy);
      matrix.push({
        enemyId: enemy.id,
        tier: enemy.tier,
        acts: clone(enemy.acts),
        segment: referenceSegment(enemy),
        referenceTier: fixedReferenceTier(enemy),
        method,
        target: clone(enemy.balance?.target ?? enemy.target ?? null),
        player: loadoutSummary(content, player),
        enemy: loadoutSummary(content, targetLoadout),
      });
      const target = enemy.balance?.target ?? enemy.target ?? null;
      for (let seedIndex = 0; seedIndex < seedCount; seedIndex += 1) {
        const seed = `calibration-${enemy.id}-${method}-${seedIndex}`;
        seeds.push(seed);
        try {
          const result = simulateBattle(
            content,
            player,
            targetLoadout,
            seed,
            { roundLimit: 256 },
          );
          const metrics = battleMetrics(content, result, player, targetLoadout);
          records.push({
            enemyId: enemy.id,
            tier: enemy.tier,
            acts: clone(enemy.acts),
            act: enemy.acts[0],
            segment: referenceSegment(enemy),
            referenceTier: fixedReferenceTier(enemy),
            method,
            seed,
            target,
            outcome: result.outcome,
            result: normalizeResult(result.outcome),
            rounds: result.rounds,
            ...metrics,
          });
        } catch (error) {
          records.push({
            enemyId: enemy.id,
            tier: enemy.tier,
            acts: clone(enemy.acts),
            act: enemy.acts[0],
            segment: referenceSegment(enemy),
            referenceTier: fixedReferenceTier(enemy),
            method,
            seed,
            target,
            outcome: 'error',
            result: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  const input = {
    mode: 'fixed_reference_board',
    board: 'V2 fixed reference loadout (5 generic slots; 3 core-role and 2 support-role artifacts) against authored enemy.n; no runtime node growth, rewards, or route state',
    contentVersion: content.version,
    referenceEquipment: clone(REFERENCE_EQUIPMENT),
    referenceStackRule: 'min(authored cap, 1 + ceil(reference cultivation tier / 2))',
    roundLimit: 256,
    seedCount,
    seeds,
    methods: [...START_METHODS],
    matrix,
  };
  const hash = inputHash(input);
  for (const record of records) record.inputHash = hash;
  const byEnemy = Object.fromEntries(enemies.map(enemy => {
    const rows = records.filter(row => row.enemyId === enemy.id);
    const rounds = rows.map(row => row.rounds).filter(finite);
    const lossPcts = rows.map(row => row.playerNetHpLossPct).filter(finite);
    const minimumHps = rows.map(row => row.playerMinimumHp).filter(finite);
    const burstPcts = rows.map(row => row.maxSingleRoundNetLossPct).filter(finite);
    const survivorWinLoss = rows
      .filter(row => row.result === 'won' && row.playerHp > 0)
      .map(row => row.playerNetHpLossPct)
      .filter(finite);
    return [enemy.id, {
      tier: enemy.tier,
      act: enemy.acts[0],
      acts: clone(enemy.acts),
      segment: referenceSegment(enemy),
      referenceTier: fixedReferenceTier(enemy),
      target: enemy.balance?.target ?? enemy.target ?? null,
      samples: rows.length,
      outcomes: outcomeCounts(rows),
      rounds: quantiles(rounds),
      playerNetHpLossPct: quantiles(lossPcts),
      playerMinimumHp: quantiles(minimumHps),
      maxSingleRoundNetLossPct: quantiles(burstPcts),
      survivorWinLossPctMedian: survivorWinLoss.length ? quantiles(survivorWinLoss).p50 : null,
      survivorWinSamples: survivorWinLoss.length,
      minRounds: rounds.length ? Math.min(...rounds) : null,
      maxRounds: rounds.length ? Math.max(...rounds) : null,
    }];
  }));

  return {
    policy: 'V2 fixed legal 5-slot reference loadouts; artifact roles are descriptive; direct simulateBattle; no mocked combat',
    calibrationStatus: 'uncalibrated V2 sample; observations do not modify authored measured fields',
    roundLimit: 256,
    seedCount,
    inputHash: hash,
    input,
    records,
    byEnemy,
  };
}

export function runFullCalibration(content, seedCount = 5) {
  const names = enemyByName(content);
  const runs = [];
  for (const method of START_METHODS) {
    for (let seedIndex = 0; seedIndex < seedCount; seedIndex += 1) {
      const seed = `acceptance-${seedIndex}`;
      let game;
      const battles = [];
      try {
        game = ShanhaiGame.create(content, {
          seed,
          name: '校准行者',
          method,
        });
        let steps = 0;
        while (!['won', 'lost'].includes(game.state.phase) && steps++ < 600) {
          const route = seedIndex % 3 === 0
            ? 'avoid'
            : seedIndex % 3 === 1
              ? 'steady'
              : 'tracking';
          const command = nextCommand(game, route);
          game.dispatch(command);
          if (command.type === 'fight' && game.state.battle && game.state.battleInput) {
            const metrics = battleMetrics(
              content,
              game.state.battle,
              game.state.battleInput.player,
              game.state.battleInput.enemy,
            );
            battles.push({
              act: game.state.act,
              step: game.state.step,
              enemyId: names.get(game.state.battleInput.enemy.name) ?? null,
              inputMode: 'real_shanhai_game_node',
              rounds: game.state.battle.rounds,
              outcome: game.state.battle.outcome,
              result: normalizeResult(game.state.battle.outcome),
              ...metrics,
            });
          }
        }
        if (steps >= 600) throw new Error('run_step_guard');
        runs.push({
          seed,
          method,
          result: game.state.phase,
          act: game.state.act,
          step: game.state.step,
          nodes: game.state.history.length,
          n: game.state.n,
          hp: game.state.hp,
          xp: game.state.xp,
          battles,
        });
      } catch (error) {
        runs.push({
          seed,
          method,
          result: 'error',
          error: error instanceof Error ? error.message : String(error),
          battles,
        });
      }
    }
  }

  const byMethod = Object.fromEntries(START_METHODS.map(method => {
    const rows = runs.filter(row => row.method === method);
    return [method, {
      runs: rows.length,
      outcomes: resultCounts(rows),
      furthestAct: rows.length ? Math.max(...rows.map(row => row.act ?? 0)) : null,
      furthestNode: rows.length ? Math.max(...rows.map(row => row.nodes ?? 0)) : null,
      finalHp: rows.map(row => row.hp).filter(finite),
      finalBattleRounds: rows
        .flatMap(row => row.battles)
        .filter(battle => battle.act === 5)
        .map(battle => battle.rounds)
        .filter(finite),
    }];
  }));

  const seeds = runs.map(row => row.seed);
  const input = {
    mode: 'real_shanhai_game_policy',
    experimentTrack: 'V2 second overhaul; buildVersion 5; uncalibrated',
    functionalWinSeeds: clone(FUNCTIONAL_WIN_SEEDS),
    contentVersion: content.version,
    methods: [...START_METHODS],
    seeds,
    routeSelection: 'seedIndex % 3 => avoid, steady, tracking; current reachable nodes only',
    equipmentStrategy: 'fill up to five generic slots and replace only a lower-scoring equipped artifact when all five slots are occupied; artifact roles are descriptive',
    stepGuard: 600,
  };
  const hash = inputHash(input);
  for (const run of runs) {
    run.inputHash = hash;
    for (const battle of run.battles) battle.inputHash = hash;
  }
  return {
    policy: 'tests/shanhai-policy.mjs',
    experimentTrack: 'V2 second overhaul; buildVersion 5; shanhai-content-0.2; uncalibrated',
    note: '真实 ShanhaiGame 与 simulateBattle；胜率是当前种子样本的直接观测，不沿用 V1 校准结果。装备策略在合法阶段依据当前库存和槽位价值换装，选择器不读取未来路线节点、战斗结果或隐藏事件结果。',
    seedCount,
    inputHash: hash,
    input,
    runs,
    outcomes: resultCounts(runs),
    byMethod,
  };
}

export async function runCalibration({
  fullRunSeeds = Number(process.env.SIM_SEEDS ?? 5),
  encounterSeeds = Number(process.env.CALIBRATION_ENCOUNTER_SEEDS ?? 5),
} = {}) {
  const model = await loadContent();
  const content = contentFromEntities(model.entities, model.manifest.content_version);
  const encounter = buildEncounterCalibration(content, encounterSeeds);
  const fullRuns = runFullCalibration(content, fullRunSeeds);
  return {
    contentVersion: content.version,
    input: {
      experimentTrack: 'V2 second overhaul; buildVersion 5; shanhai-content-0.2; uncalibrated',
      fullRunSeeds,
      encounterSeeds,
      functionalWinSeeds: clone(FUNCTIONAL_WIN_SEEDS),
      functionalWinPolicy: 'tests/shanhai-policy.mjs nextCommand(game, steady); real battle and authored enemy stats',
      roundLimit: 256,
      measuredFieldsRemainNull: true,
      referenceBoard: 'V2 fixed five-slot reference equipment; authored enemy.n; no runtime node growth or rewards',
      encounterInputHash: encounter.inputHash,
      fullRunInputHash: fullRuns.inputHash,
      referenceEquipment: clone(REFERENCE_EQUIPMENT),
      referenceStackRule: encounter.input.referenceStackRule,
      encounterSeeds: encounter.input.seeds,
      fullRunSeeds: fullRuns.input.seeds,
    },
    encounter,
    fullRuns,
  };
}

export async function writeCalibrationReports(report, outputDir = V2_REPORT_DIRECTORY) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/calibration-encounters.json`, JSON.stringify(report.encounter, null, 2) + '\n');
  await writeFile(`${outputDir}/calibration-runs.json`, JSON.stringify(report.fullRuns, null, 2) + '\n');
  await writeFile(`${outputDir}/calibration-summary.json`, JSON.stringify({
    contentVersion: report.contentVersion,
    input: report.input,
    encounterSummary: report.encounter.byEnemy,
    fullRunSummary: {
      outcomes: report.fullRuns.outcomes,
      byMethod: report.fullRuns.byMethod,
      inputHash: report.fullRuns.inputHash,
    },
  }, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runCalibration();
  await writeCalibrationReports(report);
  console.log(JSON.stringify({
    fullRunOutcomes: report.fullRuns.outcomes,
    byMethod: report.fullRuns.byMethod,
    encounterSamples: report.encounter.records.length,
  }, null, 2));
}
