// Balance audit: real runs with the regression policy, recording per-battle
// survival sources so degenerate patterns (e.g. fighting on 1 HP behind
// shields) and snowballing show up as numbers, not impressions.
// Output: verification/shanhai/v2/balance-audit.json (+ console summary).
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { nextCommand } from './shanhai-policy.mjs';

const POLICIES = ['avoid', 'steady', 'tracking'];

function battleStats(battle) {
  const frames = battle?.frames || [];
  if (!frames.length) return null;
  const first = frames[0], last = frames[frames.length - 1];
  let absorbed = 0, generated = 0, hpLost = 0, healed = 0, dealt = 0, peakShieldRatio = 0, minHpRatio = 1;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].player, b = frames[i].player;
    const ea = frames[i - 1].enemy, eb = frames[i].enemy;
    if (b.shield < a.shield) absorbed += a.shield - b.shield;
    if (b.shield > a.shield) generated += b.shield - a.shield;
    if (b.hp < a.hp) hpLost += a.hp - b.hp;
    if (b.hp > a.hp) healed += b.hp - a.hp;
    if (eb.hp < ea.hp) dealt += ea.hp - eb.hp;
    if (eb.shield < ea.shield) dealt += ea.shield - eb.shield;
    peakShieldRatio = Math.max(peakShieldRatio, b.shield / Math.max(1, b.maxHp));
    minHpRatio = Math.min(minHpRatio, b.hp / Math.max(1, b.maxHp));
  }
  return {
    rounds: battle.rounds, outcome: battle.outcome,
    hpBefore: first.player.hp, hpAfter: last.player.hp, maxHp: first.player.maxHp,
    enemyMaxHp: first.enemy.maxHp, absorbed, generated, hpLost, healed, dealt,
    peakShieldRatio: +peakShieldRatio.toFixed(3), minHpRatio: +minHpRatio.toFixed(3),
  };
}

export async function auditRuns(seeds = 10, methods) {
  const model = await loadContent();
  const content = contentFromEntities(model.entities, model.manifest.content_version);
  const starters = content.entities.filter(item => item.kind === 'method' && item.acquisition.start)
    .map(item => item.id).filter(id => !methods || methods.includes(id));
  const runs = [];
  for (const method of starters) {
    for (let seed = 0; seed < seeds; seed++) {
      const policy = POLICIES[seed % POLICIES.length];
      const game = ShanhaiGame.create(content, { seed: `audit-${seed}`, name: '审计行者', method });
      const battles = [];
      let steps = 0;
      while (!['won', 'lost'].includes(game.state.phase) && steps++ < 800) {
        const node = game.node;
        let command = nextCommand(game, policy);
        // AUDIT_VOW=A|B|C|D forces the RE037 sacrifice choice so vows can be compared on equal seeds.
        if (command.type === 'event' && node?.id === 'RE037' && process.env.AUDIT_VOW && !game.state.permanentRule) {
          command = { type: 'event', id: `RE037-${process.env.AUDIT_VOW}` };
        }
        const enemyId = game.state.battleInput?.enemy?.id;
        game.dispatch(command);
        if (command.type === 'fight' && game.state.battle) {
          const stats = battleStats(game.state.battle);
          if (stats) battles.push({ act: game.state.act, type: node?.type, enemy: node?.id || enemyId, ...stats });
        }
      }
      runs.push({
        method, seed, policy, result: game.state.phase, act: game.state.act, step: game.state.step,
        n: game.state.n, hp: game.state.hp, coins: game.state.coins, vow: game.state.permanentRule?.kind || null,
        talents: Object.values(game.state.talents || {}).flat(),
        artifacts: (game.state.artifacts || []).map(stack => `${stack.id}x${stack.stacks}`),
        equipped: [...(game.state.equipment?.slots || [])],
        battles,
      });
    }
  }
  return { contentVersion: content.version, seeds, runs, summary: summarize(runs) };
}

function pct(n, d) { return d ? +(100 * n / d).toFixed(1) : 0; }
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

export function summarize(runs) {
  const battles = runs.flatMap(run => run.battles.map(b => ({ ...b, method: run.method })));
  const wins = runs.filter(run => run.result === 'won');
  const deathsByAct = {};
  for (const run of runs.filter(r => r.result === 'lost')) {
    const key = `act${run.act}`;
    deathsByAct[key] = (deathsByAct[key] || 0) + 1;
  }
  // "Fighting on fumes": entered below 15% HP, won, and shields absorbed more than the HP it had.
  const fumes = battles.filter(b => b.outcome === 'player' && b.hpBefore / b.maxHp < 0.15 && b.absorbed > b.hpBefore * 2);
  const byAct = {};
  for (const act of [1, 2, 3, 4, 5]) {
    const list = battles.filter(b => b.act === act);
    if (!list.length) continue;
    byAct[`act${act}`] = {
      battles: list.length,
      winRate: pct(list.filter(b => b.outcome === 'player').length, list.length),
      medianRounds: median(list.map(b => b.rounds)),
      medianHpLossPct: median(list.map(b => +(100 * Math.max(0, b.hpBefore - b.hpAfter) / b.maxHp).toFixed(1))),
      medianShieldShareOfMitigation: median(list.map(b => +(b.absorbed / Math.max(1, b.absorbed + b.hpLost)).toFixed(2))),
      medianPeakShieldRatio: median(list.map(b => b.peakShieldRatio)),
      medianEntryHpPct: median(list.map(b => +(100 * b.hpBefore / b.maxHp).toFixed(1))),
    };
  }
  const byMethod = {};
  for (const method of [...new Set(runs.map(run => run.method))]) {
    const list = runs.filter(run => run.method === method);
    const mb = battles.filter(b => b.method === method);
    byMethod[method] = {
      runs: list.length, wins: list.filter(r => r.result === 'won').length,
      medianFinalRounds: median(mb.filter(b => b.act === 5).map(b => b.rounds)),
      medianPeakShieldRatio: median(mb.map(b => b.peakShieldRatio)),
      fumesWins: fumes.filter(b => b.method === method).length,
    };
  }
  const talentWins = {};
  for (const run of runs) for (const t of new Set(run.talents)) {
    talentWins[t] ||= { picks: 0, wins: 0 };
    talentWins[t].picks++;
    if (run.result === 'won') talentWins[t].wins++;
  }
  return {
    runs: runs.length, wins: wins.length, winRate: pct(wins.length, runs.length), deathsByAct, byAct, byMethod,
    fumes: { count: fumes.length, shareOfWonBattles: pct(fumes.length, battles.filter(b => b.outcome === 'player').length),
      examples: fumes.slice(0, 8).map(b => ({ method: b.method, act: b.act, enemy: b.enemy, hpBefore: b.hpBefore, maxHp: b.maxHp, absorbed: b.absorbed, peakShieldRatio: b.peakShieldRatio })) },
    talentWinRates: Object.fromEntries(Object.entries(talentWins).sort((a, b) => b[1].picks - a[1].picks)
      .map(([id, v]) => [id, { ...v, winRate: pct(v.wins, v.picks) }])),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await auditRuns(Number(process.env.SIM_SEEDS ?? 10));
  await mkdir('verification/shanhai/v2', { recursive: true });
  if (process.env.AUDIT_OUT !== 'none') {
    await writeFile(process.env.AUDIT_OUT || 'verification/shanhai/v2/balance-audit.json', JSON.stringify(report, null, 2) + '\n');
  }
  const { talentWinRates, ...headline } = report.summary;
  console.log(JSON.stringify(headline, null, 2));
}
