import { combatPresentationGroup } from './battle-playback.js';
import type { CombatPresentationGroup } from './battle-playback.js';
import type { BattleFrame, Side } from './types.js';

const DAMAGE_KINDS = new Set(['damage', 'dot']);
const BOUNDARY_KINDS = new Set(['action', 'round', 'start', 'end', 'draw', 'summary', 'wait']);
const EQUIPMENT_SOURCE = /^(RC\d{2}|RR\d{2}|RL\d{2})(?:-|$)/;
const MIRROR_SOURCE = /^RL08-MIRROR(?:-|$)/;

export interface BattleImpactSegment {
  /** Zero-based position among impacts visible in this beat. */
  order: number;
  /** Index in the original battle frame array. */
  frameIndex: number;
  kind: 'damage' | 'dot';
  attacker: Side;
  target: Side;
  /** Actual HP loss plus shield absorption, derived from adjacent snapshots. */
  amount: number;
  hpDamage: number;
  shieldAbsorbed: number;
  source?: string;
  critical: boolean;
}

export interface BattleEquipmentTrigger {
  /** The frozen equipped ID that produced the first visible trigger. */
  id: string;
  /** Zero-based position among unique equipment triggers in this beat. */
  order: number;
  /** Index of the first frame attributed to this equipment. */
  frameIndex: number;
  /** Explicit source from the first triggering frame. */
  source: string;
}

function isSide(value: unknown): value is Side {
  return value === 'player' || value === 'enemy';
}

function visibleBeatRange(
  frames: readonly BattleFrame[],
  cursor: number,
  group?: CombatPresentationGroup,
): { startIndex: number; endIndex: number } | undefined {
  if (!frames.length || !Number.isFinite(cursor) || cursor < 0) return undefined;
  const cursorIndex = Math.min(frames.length - 1, Math.floor(cursor));
  if (BOUNDARY_KINDS.has(frames[cursorIndex].kind)) return undefined;

  // The helper only scans through cursorIndex. Keep the caller-supplied group
  // as a narrowing hint, never as permission to inspect later frames.
  const currentBeat = combatPresentationGroup(frames, cursorIndex);
  if (!currentBeat) return undefined;
  const requestedStart = group && Number.isFinite(group.startIndex)
    ? Math.floor(group.startIndex)
    : currentBeat.startIndex;
  const requestedEnd = group && Number.isFinite(group.endIndex)
    ? Math.floor(group.endIndex)
    : cursorIndex;
  const startIndex = Math.max(currentBeat.startIndex, requestedStart);
  const endIndex = Math.min(currentBeat.endIndex, cursorIndex, requestedEnd);
  if (startIndex > endIndex) return undefined;
  return { startIndex, endIndex };
}

function actualLoss(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
  return Math.max(0, before - after);
}

function phaseShieldCreated(before: BattleFrame, after: BattleFrame, side: Side): number {
  const oldCounters = before[side].counters ?? [];
  const opened = (after[side].counters ?? []).find(counter =>
    counter.id.endsWith('-PHASE-GATE') && counter.name === '二阶护罩' &&
    oldCounters.some(previous => previous.id === counter.id && previous.name === '半血劫门'));
  return opened && Number.isFinite(opened.value) ? Math.max(0, opened.value) : 0;
}

/**
 * Returns real damage and DOT impacts visible at `cursor`.
 * Values come from adjacent HP/shield snapshots; frame.amount is deliberately
 * ignored because it records pre-mitigation or otherwise authored damage.
 */
export function battleImpactSegments(
  frames: readonly BattleFrame[],
  cursor: number,
  group?: CombatPresentationGroup,
): BattleImpactSegment[] {
  const range = visibleBeatRange(frames, cursor, group);
  if (!range) return [];

  const impacts: BattleImpactSegment[] = [];
  for (let index = range.startIndex; index <= range.endIndex; index += 1) {
    const frame = frames[index];
    if (!DAMAGE_KINDS.has(frame.kind) || !isSide(frame.actor) || !isSide(frame.target) || index === 0) continue;

    const previous = frames[index - 1];
    const hpDamage = actualLoss(previous[frame.target].hp, frame[frame.target].hp);
    // The crossing hit can consume an existing shield and create the phase
    // shield in the same snapshot; include that new shield before comparing.
    const shieldAbsorbed = actualLoss(
      previous[frame.target].shield + phaseShieldCreated(previous, frame, frame.target),
      frame[frame.target].shield,
    );
    if (hpDamage <= 0 && shieldAbsorbed <= 0) continue;

    impacts.push({
      order: impacts.length,
      frameIndex: index,
      kind: frame.kind as 'damage' | 'dot',
      attacker: frame.actor,
      target: frame.target,
      amount: hpDamage + shieldAbsorbed,
      hpDamage,
      shieldAbsorbed,
      ...(typeof frame.source === 'string' ? { source: frame.source } : {}),
      critical: /暴击|会心|critical|crit/i.test(frame.text),
    });
  }
  return impacts;
}

function equipmentIdFromSource(source: string): string | undefined {
  // Mirror output belongs to the mirror itself, even when its source text also
  // names the neighboring artifact whose output it copied.
  if (MIRROR_SOURCE.test(source)) return 'RL08';
  return source.match(EQUIPMENT_SOURCE)?.[1];
}

/**
 * Returns unique player-owned equipment triggers in visible frame order.
 * Only explicit source roots among the frozen equipped IDs are considered.
 */
export function battleBeatEquipmentTriggers(
  frames: readonly BattleFrame[],
  cursor: number,
  equippedIds: readonly string[],
  group?: CombatPresentationGroup,
): BattleEquipmentTrigger[] {
  const range = visibleBeatRange(frames, cursor, group);
  if (!range || !equippedIds.length) return [];

  const equipped = new Set(equippedIds);
  const seen = new Set<string>();
  const triggers: BattleEquipmentTrigger[] = [];
  for (let index = range.startIndex; index <= range.endIndex; index += 1) {
    const frame = frames[index];
    if (frame.actor !== 'player' || typeof frame.source !== 'string') continue;
    const id = equipmentIdFromSource(frame.source);
    if (!id || !equipped.has(id) || seen.has(id)) continue;
    seen.add(id);
    triggers.push({
      id,
      order: triggers.length,
      frameIndex: index,
      source: frame.source,
    });
  }
  return triggers;
}
