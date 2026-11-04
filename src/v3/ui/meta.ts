/** Cross-run progression and settings, stored per browser. Never affects a run in progress. */
export interface Meta {
  runs: number;
  wins: number;
  bestHit: number;
  bestHitMethod: string | null;
  unlocked: string[];
  /** Highest 劫数 won per method. */
  heatWon: Record<string, number>;
  maxHeat: number;
  seen: string[];
  sound: boolean;
  speed: 1 | 2;
  tutorialDone: boolean;
  endings: string[];
}
export const META_KEY = 'shanhai-v3-meta';
const DEFAULT: Meta = { runs: 0, wins: 0, bestHit: 0, bestHitMethod: null, unlocked: [], heatWon: {}, maxHeat: 0, seen: [], sound: true, speed: 1, tutorialDone: false, endings: [] };

export function readMeta(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Meta {
  try {
    const raw = JSON.parse(storage?.getItem(META_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT };
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
    return {
      runs: n(raw.runs), wins: n(raw.wins), bestHit: n(raw.bestHit),
      bestHitMethod: typeof raw.bestHitMethod === 'string' ? raw.bestHitMethod : null,
      unlocked: Array.isArray(raw.unlocked) ? raw.unlocked.filter((x: unknown) => typeof x === 'string') : [],
      heatWon: raw.heatWon && typeof raw.heatWon === 'object' ? Object.fromEntries(Object.entries(raw.heatWon).filter(([, v]) => typeof v === 'number')) as Record<string, number> : {},
      maxHeat: Math.min(10, n(raw.maxHeat)),
      seen: Array.isArray(raw.seen) ? raw.seen.filter((x: unknown) => typeof x === 'string') : [],
      sound: raw.sound !== false,
      speed: raw.speed === 2 ? 2 : 1,
      tutorialDone: raw.tutorialDone === true,
      endings: Array.isArray(raw.endings) ? raw.endings.filter((x: unknown) => typeof x === 'string') : [],
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function writeMeta(meta: Meta, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try { storage?.setItem(META_KEY, JSON.stringify(meta)); } catch { /* storage unavailable */ }
}

export interface RunEnd { won: boolean; method: string; heat: number; bestHit: number; ending?: string | null }
export interface EndReport { newBest: boolean; unlockedMethod: string | null; unlockedHeat: number | null; newEnding: boolean }

export function recordRunEnd(meta: Meta, end: RunEnd): EndReport {
  meta.runs += 1;
  const newBest = end.bestHit > meta.bestHit && meta.bestHit > 0;
  if (end.bestHit > meta.bestHit) { meta.bestHit = end.bestHit; meta.bestHitMethod = end.method; }
  let unlockedMethod: string | null = null;
  let unlockedHeat: number | null = null;
  let newEnding = false;
  if (end.won && end.ending && !meta.endings.includes(end.ending)) { meta.endings.push(end.ending); newEnding = true; }
  if (end.won) {
    meta.wins += 1;
    if (!meta.unlocked.includes('zhulong')) { meta.unlocked.push('zhulong'); unlockedMethod = 'zhulong'; }
    meta.heatWon[end.method] = Math.max(meta.heatWon[end.method] ?? -1, end.heat);
    if (end.heat >= meta.maxHeat && meta.maxHeat < 10) { meta.maxHeat = end.heat + 1; unlockedHeat = meta.maxHeat; }
  }
  return { newBest, unlockedMethod, unlockedHeat, newEnding };
}
