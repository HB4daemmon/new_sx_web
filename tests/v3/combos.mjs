// Which shapes does the bot actually play, and how hard do they hit (non-rage, act 3+)?
import { createRun } from '../../build/v3/core/run.js';
import { METHODS } from '../../build/v3/core/content.js';
import { COMBOS } from '../../build/v3/core/patterns.js';
import { playRun, CASTS } from './bot.mjs';
const wins = {};
for (const m of METHODS) for (let i = 0; i < Number(process.env.SEEDS ?? 6); i++) { const r = playRun(createRun({ seed: `cb-${i}`, method: m.id })); wins[m.id] = (wins[m.id] ?? 0) + (r.ending ? 1 : 0); }
const by = {};
for (const c of CASTS.filter(c => !c.rage)) (by[c.combo] ??= []).push(c);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log('wins', wins);
for (const [k, l] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) console.log(COMBOS[k].name.padEnd(6), 'share', (100 * l.length / CASTS.length).toFixed(1) + '%', 'median dmg a3+', med(l.filter(c => c.act >= 3).map(c => c.dmg)) ?? '-');
const any = f => (100 * CASTS.filter(f).length / CASTS.length).toFixed(1) + '%';
const paths = {};
for (const c of CASTS) for (const y of c.yaku) paths[y] = (paths[y] ?? 0) + 1;
console.log('役出现率', Object.entries(paths).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${COMBOS[k].name} ${(100 * n / CASTS.length).toFixed(1)}%`).join(' · '));
