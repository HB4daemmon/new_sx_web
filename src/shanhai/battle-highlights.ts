import type { CombatPresentationGroup } from './battle-playback.js';
import { combatPresentationGroup } from './battle-playback.js';
import type { BattleFrame, FighterView, Side } from './types.js';

export type BattleHighlightKind =
  | 'phase_gate_break'
  | 'phase_gate_open'
  | 'awakening'
  | 'fusion'
  | 'mirror';

export interface BattleHighlight {
  kind: BattleHighlightKind;
  owner: Side;
  target: Side;
  sourceId: string;
  label: string;
}

interface Candidate {
  highlight: BattleHighlight;
  frameIndex: number;
  order: number;
  dedupeKey: string;
}

const MAX_HIGHLIGHTS_PER_BEAT = 3;
const FUSION_ARTIFACT_IDS = new Set(['RL06', 'RL07', 'RL10', 'RL11', 'RL12', 'RL13']);
const AWAKENING_SOURCE = /^[A-Z0-9][A-Z0-9-]*-AWAKENING-\d+$/;
const STACK_GATED_AWAKENING_SOURCE = /^RC\d{2}-AWAKENING-[A-Z][A-Z0-9-]*$/;
const MIRROR_AWAKENING_SOURCE = /^RL08-MIRROR-AWAKENING-\d+$/;
const MIRROR_SOURCE = /^RL08-MIRROR-[A-Z0-9-]+$/;
const PHASE_GATE_SUFFIX = '-PHASE-GATE';
const BOUNDARY_KINDS = new Set(['action', 'round', 'start', 'end', 'draw', 'summary', 'wait']);

const PRIORITY: Record<BattleHighlightKind, number> = {
  phase_gate_break: 0,
  phase_gate_open: 1,
  awakening: 2,
  fusion: 3,
  mirror: 4,
};

const LABEL: Record<BattleHighlightKind, string> = {
  phase_gate_break: '破门',
  phase_gate_open: '劫门开启',
  awakening: '法宝觉醒',
  fusion: '合炼',
  mirror: '镜映',
};

function isSide(value: unknown): value is Side {
  return value === 'player' || value === 'enemy';
}

function counterById(fighter: FighterView, id: string) {
  return fighter.counters?.find(counter => counter.id === id);
}

function addCandidate(
  candidates: Candidate[],
  frame: BattleFrame,
  frameIndex: number,
  kind: BattleHighlightKind,
  sourceId: string,
  target: Side,
  order: number,
): void {
  if (!sourceId || !isSide(frame.actor)) return;
  const rootSourceId = kind === 'awakening'
    ? sourceId.replace(/-AWAKENING-[A-Z0-9-]+$/, '')
    : kind === 'mirror' ? 'RL08' : sourceId;
  const dedupeKey = `${kind}:${frame.actor}:${rootSourceId}`;
  if (candidates.some(candidate => candidate.dedupeKey === dedupeKey)) return;
  candidates.push({
    highlight: {
      kind,
      owner: frame.actor,
      target,
      sourceId,
      label: LABEL[kind],
    },
    frameIndex,
    order,
    dedupeKey,
  });
}

function phaseGateTransitions(
  candidates: Candidate[],
  frames: readonly BattleFrame[],
  frame: BattleFrame,
  frameIndex: number,
  order: number,
): void {
  if (frameIndex === 0 || !isSide(frame.actor)) return;
  const previous = frames[frameIndex - 1];

  for (const side of ['player', 'enemy'] as const) {
    for (const current of frame[side].counters ?? []) {
      if (!current.id.endsWith(PHASE_GATE_SUFFIX)) continue;
      const before = counterById(previous[side], current.id);
      if (!before) continue;

      let kind: BattleHighlightKind | undefined;
      if (before.name === '半血劫门' && current.name === '二阶护罩') {
        kind = 'phase_gate_open';
      } else if (before.name === '二阶护罩' && current.name === '破门窗口') {
        kind = 'phase_gate_break';
      }
      if (kind) addCandidate(candidates, frame, frameIndex, kind, current.id, side, order);
    }
  }
}

function sourceHighlight(
  frame: BattleFrame,
  previous?: BattleFrame,
): { kind: BattleHighlightKind; sourceId: string; target: Side } | undefined {
  if (!isSide(frame.actor) || !isSide(frame.target) || typeof frame.source !== 'string') return undefined;

  if (frame.kind === 'status' && MIRROR_AWAKENING_SOURCE.test(frame.source)) {
    return { kind: 'mirror', sourceId: frame.source, target: frame.target };
  }

  // Opening shields can be the first recorded frame, before a prior snapshot
  // exists. The shield frame carries the actual amount gained (after its cap).
  if (!previous && frame.kind === 'shield' && frame.actor === frame.target &&
      MIRROR_SOURCE.test(frame.source) && typeof frame.amount === 'number' && frame.amount > 0) {
    return { kind: 'mirror', sourceId: frame.source, target: frame.target };
  }

  if (previous && (MIRROR_SOURCE.test(frame.source) || STACK_GATED_AWAKENING_SOURCE.test(frame.source)) &&
      ['damage', 'dot', 'heal', 'shield', 'rage', 'status'].includes(frame.kind)) {
    const changed = (['player', 'enemy'] as const).some(side => {
      const before = previous[side];
      const after = frame[side];
      return before.hp !== after.hp || before.shield !== after.shield || before.rage !== after.rage ||
        [...new Set([...Object.keys(before.statuses), ...Object.keys(after.statuses)])]
          .some(status => (before.statuses[status] || 0) !== (after.statuses[status] || 0));
    });
    if (changed) return {
      kind: MIRROR_SOURCE.test(frame.source) ? 'mirror' : 'awakening',
      sourceId: frame.source,
      target: frame.target,
    };
  }

  if (frame.kind === 'status' && AWAKENING_SOURCE.test(frame.source)) {
    return { kind: 'awakening', sourceId: frame.source, target: frame.target };
  }

  if (frame.kind === 'status' && frame.actor !== frame.target && FUSION_ARTIFACT_IDS.has(frame.source)) {
    return { kind: 'fusion', sourceId: frame.source, target: frame.target };
  }

  return undefined;
}

/**
 * Finds a small set of source-backed highlights in the presentation beat visible at `cursor`.
 * The previous snapshot is read only to establish real state transitions; no frame after the
 * cursor is inspected.
 */
export function battleHighlights(
  frames: readonly BattleFrame[],
  cursor: number,
  group?: CombatPresentationGroup,
): BattleHighlight[] {
  if (!frames.length || !Number.isFinite(cursor) || cursor < 0) return [];
  const cursorIndex = Math.min(frames.length - 1, Math.floor(cursor));
  if (BOUNDARY_KINDS.has(frames[cursorIndex].kind)) return [];

  const currentBeat = combatPresentationGroup(frames, cursorIndex);
  if (!currentBeat) return [];

  const startIndex = Math.max(
    currentBeat.startIndex,
    group && Number.isFinite(group.startIndex) ? Math.floor(group.startIndex) : currentBeat.startIndex,
  );
  const requestedEnd = group && Number.isFinite(group.endIndex)
    ? Math.floor(group.endIndex)
    : cursorIndex;
  const endIndex = Math.min(currentBeat.endIndex, cursorIndex, requestedEnd);
  if (startIndex > cursorIndex || startIndex > endIndex) return [];

  const candidates: Candidate[] = [];
  let order = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const frame = frames[index];
    phaseGateTransitions(candidates, frames, frame, index, order++);

    const sourceEvent = sourceHighlight(frame, index > 0 ? frames[index - 1] : undefined);
    if (sourceEvent) {
      addCandidate(
        candidates,
        frame,
        index,
        sourceEvent.kind,
        sourceEvent.sourceId,
        sourceEvent.target,
        order++,
      );
    }
  }

  return candidates
    .sort((left, right) =>
      PRIORITY[left.highlight.kind] - PRIORITY[right.highlight.kind] ||
      left.frameIndex - right.frameIndex ||
      left.order - right.order,
    )
    .slice(0, MAX_HIGHLIGHTS_PER_BEAT)
    .map(candidate => candidate.highlight);
}
