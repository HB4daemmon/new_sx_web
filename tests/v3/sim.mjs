import { createRun } from '../../build/v3/core/run.js';
import { METHODS } from '../../build/v3/core/content.js';
import { playRun } from './bot.mjs';

// SEEDS=n METHODS=a,b HEAT=k ENDLESS=1 (keep going into 无尽天劫 after the ending) FATE=id
const seeds = Number(process.env.SEEDS ?? 20);
const heat = Number(process.env.HEAT ?? 0);
const fate = process.env.FATE || undefined;
const methods = (process.env.METHODS ?? METHODS.map(m => m.id).join(',')).split(',');
const deaths = {};
const byMethod = {};
const battles = [];
let wins = 0, total = 0;
const t0 = Date.now();
for (const method of methods) {
  for (let i = 0; i < seeds; i += 1) {
    const fights = [];
    const run = playRun(createRun({ seed: `sim-${i}`, method, heat, fate }), f => fights.push(f));
    total += 1;
    const m = byMethod[method] ??= { runs: 0, wins: 0, best: 0, endless: 0, endless3: 0 };
    m.runs += 1;
    m.best = Math.max(m.best, run.stats.bestHit);
    const won = run.screen.name === 'won' || run.endless > 0;
    if (won) { wins += 1; m.wins += 1; m.endless += run.endless; if (run.endless >= 3) m.endless3 += 1; }
    if (run.screen.name !== 'won') { const key = `${run.endless ? `e${run.endless}` : `act${run.act}`}:${fights.at(-1)?.enemy}`; deaths[key] = (deaths[key] ?? 0) + 1; }
    battles.push({ turns: run.stats.turns, casts: run.stats.casts, kills: run.stats.kills });
  }
}
for (const m of Object.values(byMethod)) if (m.wins) m.endless = +(m.endless / m.wins).toFixed(2);
const rates = Object.values(byMethod).map(m => m.wins);
console.log(JSON.stringify({ heat, total, wins, winRate: +(100 * wins / total).toFixed(1), spread: +(Math.max(...rates) / Math.max(1, Math.min(...rates))).toFixed(2), byMethod, deaths: Object.fromEntries(Object.entries(deaths).sort()), turnsPerKill: +(battles.reduce((s, b) => s + b.turns, 0) / Math.max(1, battles.reduce((s, b) => s + b.kills, 0))).toFixed(2), secs: (Date.now() - t0) / 1000 }, null, 1));
