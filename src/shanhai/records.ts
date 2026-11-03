/**
 * Local personal records — the "one more run" hook. Stored per browser only;
 * never affects runs, saves or balance.
 */
export interface PlayerRecords {
  runs: number;
  wins: number;
  furthestAct: number;
  bestHit: number;
  methodWins: Record<string, number>;
  /** Highlights of the run in progress / just finished, keyed by run id. */
  current?: { runId: string; bestHit: number };
  /** Run ids already counted, so a reload never double-counts a finish. */
  finalized: string[];
}

export interface RunFinish {
  runId: string;
  won: boolean;
  act: number;
  method: string;
}

export interface FinishReport {
  counted: boolean;
  runBestHit: number;
  newBestHit: boolean;
  newFurthestAct: boolean;
  firstWinWithMethod: boolean;
  records: PlayerRecords;
}

export const RECORDS_KEY = 'suishi-shanhai-records-v2';

export function emptyRecords(): PlayerRecords {
  return { runs: 0, wins: 0, furthestAct: 0, bestHit: 0, methodWins: {}, finalized: [] };
}

function sanitize(value: unknown): PlayerRecords {
  const base = emptyRecords();
  if (!value || typeof value !== 'object') return base;
  const v = value as Record<string, any>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  return {
    runs: num(v.runs),
    wins: num(v.wins),
    furthestAct: num(v.furthestAct),
    bestHit: num(v.bestHit),
    methodWins: v.methodWins && typeof v.methodWins === 'object'
      ? Object.fromEntries(Object.entries(v.methodWins).filter(([, n]) => typeof n === 'number' && n >= 0)) as Record<string, number>
      : {},
    current: v.current && typeof v.current.runId === 'string'
      ? { runId: v.current.runId, bestHit: num(v.current.bestHit) }
      : undefined,
    finalized: Array.isArray(v.finalized) ? v.finalized.filter((id: unknown) => typeof id === 'string').slice(-50) : [],
  };
}

export function readRecords(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): PlayerRecords {
  try {
    return sanitize(JSON.parse(storage?.getItem(RECORDS_KEY) ?? 'null'));
  } catch {
    return emptyRecords();
  }
}

export function writeRecords(records: PlayerRecords, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Records are a convenience; storage failures are ignored.
  }
}

/** Records a player strike; returns true when it beats the previous all-time best (and one existed). */
export function recordHit(records: PlayerRecords, runId: string, amount: number): boolean {
  if (!(amount > 0) || !runId) return false;
  if (records.current?.runId !== runId) records.current = { runId, bestHit: 0 };
  records.current.bestHit = Math.max(records.current.bestHit, amount);
  const beat = records.bestHit > 0 && amount > records.bestHit;
  records.bestHit = Math.max(records.bestHit, amount);
  return beat;
}

/** Counts a finished run once. */
export function finishRun(records: PlayerRecords, finish: RunFinish): FinishReport {
  const runBestHit = records.current?.runId === finish.runId ? records.current.bestHit : 0;
  if (records.finalized.includes(finish.runId)) {
    return { counted: false, runBestHit, newBestHit: false, newFurthestAct: false, firstWinWithMethod: false, records };
  }
  const reachedAct = finish.won ? 5 : finish.act;
  const newFurthestAct = reachedAct > records.furthestAct && records.runs > 0;
  const firstWinWithMethod = finish.won && !records.methodWins[finish.method];
  records.runs += 1;
  if (finish.won) {
    records.wins += 1;
    records.methodWins[finish.method] = (records.methodWins[finish.method] ?? 0) + 1;
  }
  records.furthestAct = Math.max(records.furthestAct, reachedAct);
  records.finalized = [...records.finalized, finish.runId].slice(-50);
  return {
    counted: true,
    runBestHit,
    newBestHit: runBestHit > 0 && runBestHit >= records.bestHit && records.runs > 1,
    newFurthestAct,
    firstWinWithMethod,
    records,
  };
}
