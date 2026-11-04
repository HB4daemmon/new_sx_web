import { createRun } from '../../build/v3/core/run.js';
import { METHODS } from '../../build/v3/core/content.js';
import { playRun, FIGHTS } from './bot.mjs';
for (const method of METHODS.map(m => m.id)) for (let i = 0; i < Number(process.env.SEEDS ?? 6); i++) playRun(createRun({ seed: `fs-${i}`, method, heat: Number(process.env.HEAT ?? 0) }));
const groups = {};
for (const f of FIGHTS) (groups[`a${f.act} ${f.kind}`] ??= []).push(f);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
for (const [k, list] of Object.entries(groups).sort()) console.log(k.padEnd(10), 'n', String(list.length).padStart(3), 'casts med', med(list.map(f => f.casts)), 'max', Math.max(...list.map(f => f.casts)), 'hpLost% med', Math.round(100 * med(list.map(f => f.lost / f.maxHp))), 'win%', Math.round(100 * list.filter(f => f.won).length / list.length));
import { CASTS } from './bot.mjs';
for (let a = 1; a <= 5; a++) { const l = CASTS.filter(c => c.act === a && !c.rage).map(c => c.dmg); console.log('act', a, 'cast dmg p25', med(l.filter((_, i) => true).sort((x, y) => x - y).slice(0, l.length / 2)), 'median', med(l), 'p90', [...l].sort((x, y) => x - y)[Math.floor(l.length * 0.9)]); }
