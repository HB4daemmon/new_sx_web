export const META_KEY = 'shanhai-v3-meta';
const DEFAULT = { runs: 0, wins: 0, bestHit: 0, bestHitMethod: null, unlocked: [], heatWon: {}, maxHeat: 0, seen: [], sound: true, speed: 1, tutorialDone: false };
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
            maxHeat: Math.min(10, n(raw.maxHeat)),
            seen: Array.isArray(raw.seen) ? raw.seen.filter((x) => typeof x === 'string') : [],
            sound: raw.sound !== false,
            speed: raw.speed === 2 ? 2 : 1,
            tutorialDone: raw.tutorialDone === true,
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
    if (end.won) {
        meta.wins += 1;
        if (!meta.unlocked.includes('zhulong')) {
            meta.unlocked.push('zhulong');
            unlockedMethod = 'zhulong';
        }
        meta.heatWon[end.method] = Math.max(meta.heatWon[end.method] ?? -1, end.heat);
        if (end.heat >= meta.maxHeat && meta.maxHeat < 10) {
            meta.maxHeat = end.heat + 1;
            unlockedHeat = meta.maxHeat;
        }
    }
    return { newBest, unlockedMethod, unlockedHeat };
}
