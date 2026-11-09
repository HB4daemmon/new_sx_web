export const META_KEY = 'shanhai-v3-meta';
/** 可切换的画风（都由 tools/v3-art 生成）。 */
export const ART_SETS = [
    { id: '', name: '剪纸' },
    { id: 'cel', name: '墨线' },
    { id: 'painted', name: '手绘' },
    { id: 'woodcut', name: '木刻' },
    { id: 'pixel', name: '像素' },
];
const DEFAULT = { runs: 0, wins: 0, bestHit: 0, bestHitMethod: null, unlocked: [], heatWon: {}, maxHeat: 0, seen: [], sound: true, speed: 1, tutorialDone: false, endings: [], daoguo: 0, unlocks: [], achievements: [], mastery: {}, endlessBest: 0, daily: {}, lastPacts: {}, artSet: '' };
const strs = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string') : []);
const nums = (x) => (x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) : {});
export function readMeta(storage = globalThis.localStorage) {
    try {
        const raw = JSON.parse(storage?.getItem(META_KEY) ?? 'null');
        if (!raw || typeof raw !== 'object')
            return { ...DEFAULT };
        const n = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
        return {
            runs: n(raw.runs), wins: n(raw.wins), bestHit: n(raw.bestHit),
            bestHitMethod: typeof raw.bestHitMethod === 'string' ? raw.bestHitMethod : null,
            unlocked: Array.isArray(raw.unlocked) ? raw.unlocked.filter((x) => typeof x === 'string') : [],
            heatWon: raw.heatWon && typeof raw.heatWon === 'object' ? Object.fromEntries(Object.entries(raw.heatWon).filter(([, v]) => typeof v === 'number')) : {},
            maxHeat: Math.min(30, n(raw.maxHeat)),
            seen: Array.isArray(raw.seen) ? raw.seen.filter((x) => typeof x === 'string') : [],
            sound: raw.sound !== false,
            speed: raw.speed === 2 ? 2 : 1,
            tutorialDone: raw.tutorialDone === true,
            endings: Array.isArray(raw.endings) ? raw.endings.filter((x) => typeof x === 'string') : [],
            daoguo: n(raw.daoguo),
            unlocks: strs(raw.unlocks),
            achievements: strs(raw.achievements),
            mastery: nums(raw.mastery),
            endlessBest: n(raw.endlessBest),
            daily: raw.daily && typeof raw.daily === 'object' ? Object.fromEntries(Object.entries(raw.daily).filter(([, v]) => v && typeof v === 'object').slice(-60)) : {},
            lastPacts: nums(raw.lastPacts),
            artSet: ART_SETS.some(a => a.id === raw.artSet) ? raw.artSet : '',
        };
    }
    catch {
        return { ...DEFAULT };
    }
}
export function writeMeta(meta, storage = globalThis.localStorage) {
    try {
        storage?.setItem(META_KEY, JSON.stringify(meta));
    }
    catch { /* storage unavailable */ }
}
export function recordRunEnd(meta, end) {
    meta.runs += 1;
    const newBest = end.bestHit > meta.bestHit && meta.bestHit > 0;
    if (end.bestHit > meta.bestHit) {
        meta.bestHit = end.bestHit;
        meta.bestHitMethod = end.method;
    }
    let unlockedMethod = null;
    let unlockedHeat = null;
    if (end.endless)
        meta.endlessBest = Math.max(meta.endlessBest, end.endless);
    if (end.daily) {
        const prev = meta.daily[end.daily];
        const score = (r) => (r.won ? 10 : 0) + r.act + r.endless;
        const cur = { act: end.act ?? 0, won: end.won, bestHit: end.bestHit, endless: end.endless ?? 0 };
        if (!prev || score(cur) > score(prev) || (score(cur) === score(prev) && cur.bestHit > prev.bestHit))
            meta.daily[end.daily] = cur;
    }
    let newEnding = false;
    if (end.won && end.ending && !meta.endings.includes(end.ending)) {
        meta.endings.push(end.ending);
        newEnding = true;
    }
    if (end.won) {
        meta.wins += 1;
        if (!meta.unlocked.includes('zhulong')) {
            meta.unlocked.push('zhulong');
            unlockedMethod = 'zhulong';
        }
        meta.heatWon[end.method] = Math.max(meta.heatWon[end.method] ?? -1, end.heat);
        if (end.heat >= meta.maxHeat && meta.maxHeat < 30) {
            meta.maxHeat = end.heat + 1;
            unlockedHeat = meta.maxHeat;
        }
    }
    return { newBest, unlockedMethod, unlockedHeat, newEnding };
}
