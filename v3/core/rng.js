export function seedFrom(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1)
        h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
    return h || 1;
}
export function next(rng) {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0;
    let t = rng.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const int = (rng, min, max) => min + Math.floor(next(rng) * (max - min + 1));
export const pick = (rng, list) => list[Math.floor(next(rng) * list.length)];
export const chance = (rng, p) => next(rng) < p;
export function shuffle(rng, list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next(rng) * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}
/** Picks n distinct items, weighted by `weight`. */
export function sample(rng, list, n, weight = () => 1) {
    const pool = [...list];
    const out = [];
    while (out.length < n && pool.length) {
        const total = pool.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
        let roll = next(rng) * total;
        let index = pool.length - 1;
        for (let i = 0; i < pool.length; i += 1) {
            roll -= Math.max(0, weight(pool[i]));
            if (roll <= 0) {
                index = i;
                break;
            }
        }
        out.push(pool.splice(index, 1)[0]);
    }
    return out;
}
