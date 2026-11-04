import { ELEMENTS, GEN } from './elements.js';
export const PATTERNS = {
    san: { id: 'san', name: '散招', hint: '任意出符', qi: 5, mult: 1, lvQi: 5, lvMult: 1, intent: 8, tier: 0 },
    dui: { id: 'dui', name: '双元', hint: '两枚同元', qi: 10, mult: 2, lvQi: 10, lvMult: 1, intent: 12, tier: 1 },
    liangyi: { id: 'liangyi', name: '两仪', hint: '两组双元', qi: 20, mult: 2, lvQi: 15, lvMult: 1, intent: 16, tier: 2 },
    sancai: { id: 'sancai', name: '三才', hint: '三枚同元', qi: 30, mult: 3, lvQi: 20, lvMult: 2, intent: 20, tier: 3 },
    sheng3: { id: 'sheng3', name: '三生', hint: '按相生顺序连出三枚（木→火→土→金→水→木）', qi: 30, mult: 3, lvQi: 20, lvMult: 2, intent: 22, tier: 3 },
    mantang: { id: 'mantang', name: '满堂', hint: '三枚同元 + 两枚同元', qi: 40, mult: 4, lvQi: 25, lvMult: 2, intent: 26, tier: 4 },
    wuxing: { id: 'wuxing', name: '五行俱全', hint: '五枚各不同元，顺序不限', qi: 40, mult: 4, lvQi: 25, lvMult: 2, intent: 26, tier: 4 },
    sixiang: { id: 'sixiang', name: '四象', hint: '四枚同元', qi: 60, mult: 7, lvQi: 30, lvMult: 3, intent: 34, tier: 5 },
    sheng4: { id: 'sheng4', name: '四生', hint: '按相生顺序连出四枚', qi: 50, mult: 6, lvQi: 30, lvMult: 3, intent: 34, tier: 5 },
    lunzhuan: { id: 'lunzhuan', name: '五行轮转', hint: '按相生顺序连出五枚，五行一周', qi: 100, mult: 10, lvQi: 40, lvMult: 4, intent: 50, tier: 6 },
    wulei: { id: 'wulei', name: '五雷正法', hint: '五枚同元', qi: 120, mult: 12, lvQi: 50, lvMult: 5, intent: 50, tier: 6 },
};
export const PATTERN_ORDER = ['san', 'dui', 'liangyi', 'sancai', 'sheng3', 'mantang', 'wuxing', 'sixiang', 'sheng4', 'lunzhuan', 'wulei'];
export function patternValue(id, level) {
    const def = PATTERNS[id];
    const lv = Math.max(1, level);
    return { qi: def.qi + def.lvQi * (lv - 1), mult: def.mult + def.lvMult * (lv - 1) };
}
function longestChain(els, reverse) {
    let best = [];
    for (const dir of reverse ? [1, -1] : [1]) {
        let run = [];
        for (let i = 0; i < els.length; i += 1) {
            const el = els[i];
            if (!el) {
                run = [];
                continue;
            }
            if (run.length) {
                const prev = els[run[run.length - 1]];
                const ok = dir === 1 ? GEN[prev] === el : GEN[el] === prev;
                run = ok ? [...run, i] : [i];
            }
            else
                run = [i];
            if (run.length > best.length)
                best = run;
        }
    }
    return best;
}
/** All patterns the cast satisfies, for one assignment of wildcard elements. */
function matchesFor(els, opts) {
    const counts = new Map();
    for (const el of els)
        if (el)
            counts.set(el, (counts.get(el) ?? 0) + 1);
    const sizes = [...counts.values()].sort((a, b) => b - a);
    const chain = longestChain(els, !!opts.reverse);
    const out = [];
    const add = (id, chainIdx = []) => out.push({ id, assigned: els, chain: chainIdx });
    add('san');
    if (sizes[0] >= 2)
        add('dui');
    if (sizes[0] >= 2 && sizes[1] >= 2)
        add('liangyi');
    if (sizes[0] >= 3)
        add('sancai');
    if (sizes[0] >= 3 && sizes[1] >= 2)
        add('mantang');
    if (sizes[0] >= 4)
        add('sixiang');
    if (sizes[0] >= 5)
        add('wulei');
    if (counts.size === 5)
        add('wuxing');
    if (chain.length >= 3)
        add('sheng3', chain.slice(0, 3));
    if (chain.length >= 4)
        add('sheng4', chain.slice(0, 4));
    if (chain.length >= 5)
        add('lunzhuan', chain.slice(0, 5));
    return out;
}
/** Every distinct pattern reachable by any wildcard assignment (灵符 can be any element). */
export function detectPatterns(tiles, opts = {}) {
    const base = tiles.map(tile => (tile.el === 'zhuo' ? null : tile.el));
    const wild = tiles.map((tile, i) => (tile.mod === 'ling' && tile.el !== 'zhuo' ? i : -1)).filter(i => i >= 0);
    const found = new Map();
    const total = ELEMENTS.length ** wild.length;
    for (let code = 0; code < total; code += 1) {
        const els = [...base];
        let c = code;
        for (const index of wild) {
            els[index] = ELEMENTS[c % 5];
            c = Math.floor(c / 5);
        }
        for (const match of matchesFor(els, opts))
            if (!found.has(match.id))
                found.set(match.id, match);
    }
    return [...found.values()];
}
