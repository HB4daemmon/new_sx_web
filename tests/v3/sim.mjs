import { createRun } from '../../build/v3/core/run.js';
import { METHODS } from '../../build/v3/core/content.js';
import { playRun } from './bot.mjs';

const seeds = Number(process.env.SEEDS ?? 20);
const heat = Number(process.env.HEAT ?? 0);
const methods = (process.env.METHODS ?? METHODS.map(m => m.id).join(',')).split(',');
const deaths = {};
const byMethod = {};
const battles = [];
let wins = 0, total = 0;
const t0 = Date.now();
for (const method of methods) {
  for (let i = 0; i < seeds; i += 1) {
    const fights = [];
    const run = playRun(createRun({ seed: `sim-${i}`, method, heat }), f => fights.push(f));
    total += 1;
    byMethod[method] ??= { runs: 0, wins: 0, best: 0 };
    byMethod[method].runs += 1;
    byMethod[method].best = Math.max(byMethod[method].best, run.stats.bestHit);
    if (run.screen.name === 'won') { wins += 1; byMethod[method].wins += 1; }
    else { const key = `act${run.act}:${fights.at(-1)?.enemy}`; deaths[key] = (deaths[key] ?? 0) + 1; }
    battles.push({ turns: run.stats.turns, casts: run.stats.casts, kills: run.stats.kills });
  }
}
console.log(JSON.stringify({ heat, total, wins, winRate: +(100 * wins / total).toFixed(1), byMethod, deaths: Object.fromEntries(Object.entries(deaths).sort()), turnsPerKill: +(battles.reduce((s, b) => s + b.turns, 0) / Math.max(1, battles.reduce((s, b) => s + b.kills, 0))).toFixed(2), secs: (Date.now() - t0) / 1000 }, null, 1));
