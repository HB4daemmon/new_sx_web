import type { BattleFrame, Side } from './types.js';

export interface CombatSideSummary {
  damage: number;
  healing: number;
  shieldAbsorbed: number;
  shieldGenerated: number;
  shieldConsumed: number;
  hits: number;
  dotDamage: number;
  dotHits: number;
  critical: boolean;
  statuses: Record<string, number>;
}

export interface CombatPresentationGroup {
  startIndex: number;
  endIndex: number;
  round: number;
  dot: boolean;
  player: CombatSideSummary;
  enemy: CombatSideSummary;
}

export type CombatPresentationMotion = 'idle' | 'hit' | 'block' | 'heal' | 'shield' | 'dot' | 'buff';

const BOUNDARY_KINDS = new Set(['action', 'round', 'start', 'end', 'draw', 'summary']);

function isBoundary(frame: BattleFrame): boolean {
  return BOUNDARY_KINDS.has(frame.kind);
}

function emptySideSummary(): CombatSideSummary {
  return {
    damage: 0,
    healing: 0,
    shieldAbsorbed: 0,
    shieldGenerated: 0,
    shieldConsumed: 0,
    hits: 0,
    dotDamage: 0,
    dotHits: 0,
    critical: false,
    statuses: {},
  };
}

function hasCritical(frame: BattleFrame): boolean {
  return /暴击|会心|critical|crit/i.test(frame.text);
}

function summarizeFrame(
  summary: CombatSideSummary,
  side: Side,
  frame: BattleFrame,
  previous: BattleFrame,
): void {
  const before = previous[side];
  const after = frame[side];
  const hpDelta = after.hp - before.hp;
  const shieldDelta = after.shield - before.shield;
  const damageFrame = frame.kind === 'damage' || frame.kind === 'dot';
  const target = frame.target === side || (!frame.target && hpDelta < 0);

  if (hpDelta < 0) summary.damage += -hpDelta;
  if (hpDelta > 0) summary.healing += hpDelta;
  if (shieldDelta > 0) summary.shieldGenerated += shieldDelta;
  if (shieldDelta < 0) {
    if (damageFrame && frame.target === side) summary.shieldAbsorbed += -shieldDelta;
    else summary.shieldConsumed += -shieldDelta;
  }

  const hit = damageFrame && target && (hpDelta < 0 || (frame.target === side && shieldDelta < 0));
  if (hit) {
    summary.hits += 1;
    if (frame.kind === 'dot') {
      summary.dotHits += 1;
      if (hpDelta < 0) summary.dotDamage += -hpDelta;
    }
    if (hasCritical(frame)) summary.critical = true;
  }

  for (const status of new Set([
    ...Object.keys(before.statuses || {}),
    ...Object.keys(after.statuses || {}),
  ])) {
    const delta = (after.statuses[status] || 0) - (before.statuses[status] || 0);
    if (delta) summary.statuses[status] = (summary.statuses[status] || 0) + delta;
  }
}

function emptyGroup(startIndex: number, frame: BattleFrame, dot: boolean): CombatPresentationGroup {
  return {
    startIndex,
    endIndex: startIndex,
    round: frame.round,
    dot,
    player: emptySideSummary(),
    enemy: emptySideSummary(),
  };
}

/**
 * Summarizes only the effect run visible at `cursor`; later raw frames are never read.
 * Action frames and round/result markers are standalone beats.
 */
export function combatPresentationGroup(
  frames: readonly BattleFrame[],
  cursor: number,
): CombatPresentationGroup | undefined {
  if (!frames.length || !Number.isFinite(cursor)) return undefined;
  const end = Math.min(frames.length - 1, Math.max(0, Math.floor(cursor)));
  if (isBoundary(frames[end])) return undefined;

  let runStart = end;
  while (runStart > 0) {
    const previous = frames[runStart - 1];
    if (isBoundary(previous) || previous.round !== frames[end].round) break;
    runStart -= 1;
  }
  let firstDot = -1;
  for (let index = runStart; index <= end; index += 1) {
    if (frames[index].kind === 'dot') {
      firstDot = index;
      break;
    }
  }
  const start = firstDot >= 0 ? firstDot : runStart;
  const group = emptyGroup(start, frames[start], firstDot >= 0);
  for (let index = start; index <= end; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    if (previous) {
      summarizeFrame(group.player, 'player', frame, previous);
      summarizeFrame(group.enemy, 'enemy', frame, previous);
    }
    group.endIndex = index;
  }
  return group;
}

/** Returns the last raw frame in the effect beat beginning at `startIndex`. */
export function combatPresentationStepEnd(
  frames: readonly BattleFrame[],
  startIndex: number,
): number {
  if (!frames.length) return 0;
  const start = Math.min(frames.length - 1, Math.max(0, Math.floor(startIndex)));
  const first = frames[start];
  if (isBoundary(first)) return start;

  let dot = first.kind === 'dot';
  const round = first.round;
  let end = start;
  for (let index = start + 1; index < frames.length; index += 1) {
    const frame = frames[index];
    if (isBoundary(frame) || frame.round !== round) break;
    if (frame.kind === 'dot' && !dot) break;
    if (frame.kind === 'dot') dot = true;
    end = index;
  }
  return end;
}

/** Advances across one presentation beat while retaining the raw-frame cursor. */
export function nextCombatPresentationCursor(
  frames: readonly BattleFrame[],
  cursor: number,
): number {
  if (!frames.length) return 0;
  const current = Math.min(frames.length - 1, Math.max(0, Math.floor(cursor)));
  const frame = frames[current];
  let nextStart: number;
  if (!isBoundary(frame)) {
    const visibleGroup = combatPresentationGroup(frames, current);
    const start = visibleGroup?.startIndex ?? current;
    const end = combatPresentationStepEnd(frames, start);
    if (end > current) return end;
    nextStart = end + 1;
  } else {
    nextStart = current + 1;
  }
  if (nextStart >= frames.length) return current;
  return combatPresentationStepEnd(frames, nextStart);
}

export function combatPresentationDuration(speed = 1, hitCount = 0): number {
  const multiplier = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.min(1400, Math.max(400, 850 / multiplier + Math.min(250, Math.max(0, hitCount - 1) * 50)));
}

export function combatPresentationMotion(
  summary: CombatSideSummary,
  dotPhase: boolean,
): CombatPresentationMotion {
  if (summary.damage > 0) return dotPhase && summary.dotDamage === summary.damage ? 'dot' : 'hit';
  if (summary.shieldAbsorbed > 0) return 'block';
  if (summary.healing > 0) return 'heal';
  if (summary.shieldGenerated > 0) return 'shield';
  if (Object.values(summary.statuses).some(Boolean)) return 'buff';
  return 'idle';
}
