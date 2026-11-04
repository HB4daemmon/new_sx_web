/**
 * 诀式分析 v2 —— 三层叠加，而不是“取最好的一个牌型”：
 *  1. 同元成组（不看顺序）：每种元素凑成双元/三才/四象/五雷，各组的气与倍都计入；两组以上另有两仪/满堂加成。
 *     三枚以上同元触发该元素「共鸣」。
 *  2. 相生（看顺序，木→火→土→金→水→木）：后一枚符接过前一枚的气（传气），链尾的元素效果被放大。
 *  3. 相克（看顺序，木→土→水→火→金→木）：每一次相克，倍率再乘一次。
 *  五枚各不同元为「五行俱全」，再加倍率；全相生称「五行轮转」，全相克称「五行逆乱」。
 */
import { ELEMENTS, GEN, KE, type El } from './elements.js';
import type { ComboId, PatternId, Tile } from './types.js';

export interface PatternDef { id: PatternId; name: string; hint: string; qi: number; mult: number; lvQi: number; lvMult: number }

/** Upgradeable 诀 (心法). For 相生 `qi` is the share of qi passed on, `mult` the 倍 per link; for 相克 `mult` is the × per link. */
export const PATTERNS: Record<PatternId, PatternDef> = {
  dui: { id: 'dui', name: '双元', hint: '两枚同元', qi: 10, mult: 2, lvQi: 8, lvMult: 1 },
  sancai: { id: 'sancai', name: '三才', hint: '三枚同元，并触发该元素共鸣', qi: 25, mult: 3, lvQi: 15, lvMult: 1.5 },
  sixiang: { id: 'sixiang', name: '四象', hint: '四枚同元', qi: 50, mult: 6, lvQi: 25, lvMult: 2 },
  wulei: { id: 'wulei', name: '五雷', hint: '五枚同元', qi: 100, mult: 10, lvQi: 40, lvMult: 4 },
  sheng: { id: 'sheng', name: '相生', hint: '按 木→火→土→金→水 相邻：后一枚接过前一枚的气，链尾元素效果放大', qi: 1, mult: 0.5, lvQi: 0.25, lvMult: 0.25 },
  ke: { id: 'ke', name: '相克', hint: '按 木→土→水→火→金 相邻：每一次相克，倍率再乘一次', qi: 0, mult: 1.3, lvQi: 0, lvMult: 0.1 },
  wuxing: { id: 'wuxing', name: '五行', hint: '五枚各不同元：倍率再加', qi: 0, mult: 3, lvQi: 0, lvMult: 1.5 },
};
export const PATTERN_ORDER: PatternId[] = ['dui', 'sancai', 'sixiang', 'wulei', 'sheng', 'ke', 'wuxing'];
export const SET_BY_SIZE: Record<number, PatternId> = { 2: 'dui', 3: 'sancai', 4: 'sixiang', 5: 'wulei' };

export function patternValue(id: PatternId, level: number) {
  const def = PATTERNS[id];
  const lv = Math.max(1, level);
  return { qi: def.qi + def.lvQi * (lv - 1), mult: def.mult + def.lvMult * (lv - 1) };
}

/** Named result of a cast, for the stamp, records and 悟道. */
export interface ComboDef { name: string; tier: number; intent: number }
export const COMBOS: Record<ComboId, ComboDef> = {
  san: { name: '散招', tier: 0, intent: 8 },
  dui: { name: '双元', tier: 1, intent: 12 },
  sheng3: { name: '三生', tier: 1, intent: 14 },
  ke3: { name: '三克', tier: 1, intent: 14 },
  liangyi: { name: '两仪', tier: 2, intent: 18 },
  sancai: { name: '三才', tier: 2, intent: 20 },
  sheng4: { name: '四生', tier: 3, intent: 22 },
  ke4: { name: '四克', tier: 3, intent: 22 },
  wuxing: { name: '五行俱全', tier: 3, intent: 26 },
  mantang: { name: '满堂', tier: 4, intent: 30 },
  sixiang: { name: '四象', tier: 4, intent: 34 },
  lunzhuan: { name: '五行轮转', tier: 5, intent: 40 },
  nixing: { name: '五行逆乱', tier: 5, intent: 40 },
  wulei: { name: '五雷正法', tier: 6, intent: 50 },
};

export type Link = 'sheng' | 'ke' | null;
export interface Analysis {
  els: (El | null)[];
  sets: { el: El; size: number }[];
  links: Link[];
  distinct: number;
  combo: ComboId;
  /** Tile indices joined by a 相生 / 相克 link. */
  shengIdx: number[];
  keIdx: number[];
}

export interface AnalyzeOptions { reverse?: boolean }

export function linkOf(a: El | null, b: El | null, opts: AnalyzeOptions = {}): Link {
  if (!a || !b || a === b) return null;
  if (GEN[a] === b || (opts.reverse && GEN[b] === a)) return 'sheng';
  if (KE[a] === b) return 'ke';
  return null;
}

function longestRun(links: Link[], kind: Link): number {
  let best = 0, run = 0;
  for (const l of links) { run = l === kind ? run + 1 : 0; best = Math.max(best, run); }
  return best ? best + 1 : 0; // tiles in the run
}

export function analyze(els: (El | null)[], opts: AnalyzeOptions = {}): Analysis {
  const counts = new Map<El, number>();
  for (const el of els) if (el) counts.set(el, (counts.get(el) ?? 0) + 1);
  const sets = [...counts.entries()].filter(([, n]) => n >= 2).map(([el, size]) => ({ el, size })).sort((a, b) => b.size - a.size);
  const links = els.slice(1).map((el, i) => linkOf(els[i], el, opts));
  const shengIdx = new Set<number>(), keIdx = new Set<number>();
  links.forEach((l, i) => { if (l === 'sheng') { shengIdx.add(i); shengIdx.add(i + 1); } if (l === 'ke') { keIdx.add(i); keIdx.add(i + 1); } });
  const distinct = counts.size;
  const sizes = sets.map(s => s.size);
  const sh = longestRun(links, 'sheng'), kr = longestRun(links, 'ke');
  let combo: ComboId = 'san';
  if (sizes[0] === 5) combo = 'wulei';
  else if (distinct === 5 && sh === 5) combo = 'lunzhuan';
  else if (distinct === 5 && kr === 5) combo = 'nixing';
  else if (sizes[0] === 4) combo = 'sixiang';
  else if (sizes[0] === 3 && sizes[1] === 2) combo = 'mantang';
  else if (distinct === 5) combo = 'wuxing';
  else if (sh >= 4) combo = 'sheng4';
  else if (kr >= 4) combo = 'ke4';
  else if (sizes[0] === 3) combo = 'sancai';
  else if (sizes[0] === 2 && sizes[1] === 2) combo = 'liangyi';
  else if (sh >= 3) combo = 'sheng3';
  else if (kr >= 3) combo = 'ke3';
  else if (sizes[0] === 2) combo = 'dui';
  return { els, sets, links, distinct, combo, shengIdx: [...shengIdx].sort(), keIdx: [...keIdx].sort() };
}

/** Every element assignment for the cast (灵符 may be any element; 浊符 is none). */
export function assignments(tiles: Tile[]): (El | null)[][] {
  const base = tiles.map(t => (t.el === 'zhuo' ? null : t.el));
  const wild = tiles.map((t, i) => (t.mod === 'ling' && t.el !== 'zhuo' ? i : -1)).filter(i => i >= 0);
  const out: (El | null)[][] = [];
  const total = ELEMENTS.length ** wild.length;
  for (let code = 0; code < total; code += 1) {
    const els = [...base];
    let c = code;
    for (const index of wild) { els[index] = ELEMENTS[c % 5]; c = Math.floor(c / 5); }
    out.push(els);
  }
  return out;
}

/** Old saves stored levels per old pattern id. */
export function migrateLevels(old: Record<string, number> | undefined): Record<PatternId, number> {
  const lv = Object.fromEntries(PATTERN_ORDER.map(id => [id, 1])) as Record<PatternId, number>;
  if (!old) return lv;
  const take = (id: PatternId, ...keys: string[]) => { lv[id] = Math.max(1, ...keys.map(k => old[k] ?? 1)); };
  take('dui', 'dui', 'liangyi'); take('sancai', 'sancai', 'mantang'); take('sixiang', 'sixiang'); take('wulei', 'wulei');
  take('sheng', 'sheng', 'sheng3', 'sheng4', 'lunzhuan'); take('ke', 'ke'); take('wuxing', 'wuxing');
  return lv;
}
