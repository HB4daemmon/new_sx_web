/** Small seeded RNG (mulberry32). State is a single uint32 so it serialises with the run. */
export interface Rng { state: number }

export function seedFrom(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h || 1;
}

export function next(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const int = (rng: Rng, min: number, max: number) => min + Math.floor(next(rng) * (max - min + 1));
export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(next(rng) * list.length)];
export const chance = (rng: Rng, p: number) => next(rng) < p;

export function shuffle<T>(rng: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next(rng) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Picks n distinct items, weighted by `weight`. */
export function sample<T>(rng: Rng, list: readonly T[], n: number, weight: (item: T) => number = () => 1): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
    let roll = next(rng) * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= Math.max(0, weight(pool[i]));
      if (roll <= 0) { index = i; break; }
    }
    out.push(pool.splice(index, 1)[0]);
  }
  return out;
}
