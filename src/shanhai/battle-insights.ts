import type { BattleResult, Side } from './types.js';

export type BattleInsightMetric = 'damage' | 'healing' | 'shield' | 'rage';

export interface BattleInsightHighlight {
  source: string;
  metric: BattleInsightMetric;
  amount: number;
}

export interface BattleInsightDamage {
  source: string;
  actor: Side;
  target: Side;
  round: number;
  kind: 'damage' | 'dot';
  hpLost: number;
  shieldLost: number;
  lethal: boolean;
}

export interface BattleInsights {
  highlights: BattleInsightHighlight[];
  keyDamage?: BattleInsightDamage;
}

const METRICS: BattleInsightMetric[] = ['damage', 'healing', 'shield', 'rage'];

export function battleInsights(result: BattleResult): BattleInsights {
  const contributions = Array.isArray(result?.contributions) ? result.contributions : [];
  const highlights: BattleInsightHighlight[] = [];

  for (const metric of METRICS) {
    const candidates = contributions
      .filter(item =>
        typeof item.id === 'string' &&
        item.id.length > 0 &&
        Number.isFinite(item[metric]) &&
        item[metric] > 0,
      )
      .sort((left, right) => right[metric] - left[metric]);
    const candidate = candidates.find(item => !highlights.some(highlight => highlight.source === item.id));
    if (candidate) {
      highlights.push({
        source: candidate.id,
        metric,
        amount: candidate[metric],
      });
    }
    if (highlights.length === 2) break;
  }

  const frames = Array.isArray(result?.frames) ? result.frames : [];
  let largestHit: BattleInsightDamage | undefined;
  let lethalHit: BattleInsightDamage | undefined;

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    if (previous.kind === 'summary' ||
        (frame.kind !== 'damage' && frame.kind !== 'dot') ||
        typeof frame.source !== 'string' || !frame.source ||
        !frame.actor || !frame.target) continue;

    const hpLost = Math.max(0, previous[frame.target].hp - frame[frame.target].hp);
    const shieldLost = Math.max(0, previous[frame.target].shield - frame[frame.target].shield);
    if (hpLost === 0 && shieldLost === 0) continue;

    const hit: BattleInsightDamage = {
      source: frame.source,
      actor: frame.actor,
      target: frame.target,
      round: frame.round,
      kind: frame.kind,
      hpLost,
      shieldLost,
      lethal: previous[frame.target].hp > 0 && frame[frame.target].hp <= 0,
    };
    if (hit.lethal) lethalHit = hit;
    if (!largestHit || hpLost + shieldLost > largestHit.hpLost + largestHit.shieldLost) {
      largestHit = hit;
    }
  }

  return {
    highlights,
    ...(lethalHit || largestHit ? { keyDamage: lethalHit || largestHit } : {}),
  };
}
