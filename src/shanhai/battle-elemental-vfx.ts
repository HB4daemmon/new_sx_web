import { battleImpactSegments } from './battle-impact.js';
import { combatPresentationGroup } from './battle-playback.js';
import type { CombatPresentationGroup } from './battle-playback.js';
import type { ElementalFxCue, ElementalFxKind } from './elemental-vfx-art.js';
import type { BattleFrame, Side } from './types.js';

const METHOD_FX: Record<string, ElementalFxKind> = {
  RKF01: 'guard',
  RKF02: 'energy',
  RKF03: 'healing',
  RKF04: 'fire',
  RKF05: 'blade',
  RKF06: 'poison',
  RKF07: 'thunder',
  RKF08: 'moon',
  RKF09: 'sun',
  RKF10: 'dragon',
};

// These are actual effect sources, not guesses from the character's loadout.
const ARTIFACT_FX: Record<string, ElementalFxKind> = {
  RC01: 'blade', RC09: 'blade', RC10: 'thunder', RC11: 'guard',
  RC12: 'healing', RC14: 'poison', RC15: 'fire',
  RR03: 'poison', RR04: 'fortune', RR10: 'thunder', RR11: 'poison_fire',
  RL02: 'fire', RL03: 'wheel', RL06: 'poison_fire', RL07: 'blade',
  RL10: 'guard', RL11: 'healing', RL12: 'thunder', RL13: 'fortune',
};

interface Candidate {
  cue: ElementalFxCue;
  priority: number;
  firstIndex: number;
  /** Only real damage frames contribute to a projectile count. */
  hitCount: number;
}

function side(value: unknown): value is Side {
  return value === 'player' || value === 'enemy';
}

function opposite(value: Side): Side {
  return value === 'player' ? 'enemy' : 'player';
}

function sourceKind(frame: BattleFrame): ElementalFxKind | undefined {
  if (!side(frame.actor) || typeof frame.source !== 'string') return undefined;
  // Mirror output retains the copied source after this prefix. An awakening
  // without an encoded source cannot be assigned an element safely.
  const source = frame.source.replace(/^RL08-MIRROR-/, '');
  const method = source.match(/^(RKF\d{2})(?:-|$)/)?.[1];
  if (method) {
    const actualMethod = frame[frame.actor].method === method;
    const companion = frame.cue?.kind === 'companion_assist' &&
      frame.cue.owner === frame.actor && frame.cue.sourceId === `${method}-COMPANION`;
    return actualMethod || companion ? METHOD_FX[method] : undefined;
  }
  const artifact = source.match(/^(RC\d{2}|RR\d{2}|RL\d{2})(?:-|$)/)?.[1];
  return artifact ? ARTIFACT_FX[artifact] : undefined;
}

function dotKind(frame: BattleFrame): ElementalFxKind | undefined {
  if (frame.dotStatus === 'poison') return 'poison';
  if (frame.dotStatus === 'burn') return 'fire';
  // Older or synthetic frames may lack the explicit status. Only an
  // unambiguous authored source is safe to use as a fallback.
  const source = frame.source?.toUpperCase() ?? '';
  if (/POISON|VENOM/.test(source) && !/BURN|FIRE|FLAME/.test(source)) return 'poison';
  if (/BURN|FIRE|FLAME/.test(source) && !/POISON|VENOM/.test(source)) return 'fire';
  return undefined;
}

function intensity(frame: BattleFrame): ElementalFxCue['intensity'] {
  if (frame.cue && frame.cue.kind !== 'rage_chain') return 'reaction';
  return /(?:^|-)RAGE(?:-|$)/.test(frame.source ?? '') || /怒技/.test(frame.text)
    ? 'rage' : 'basic';
}

/**
 * Build decorative cues only from the current action or frames already visible
 * in the current playback beat. Later frames and inventory are never read.
 */
export function battleElementalFxCues(
  frames: readonly BattleFrame[],
  cursor: number,
  suppliedGroup?: CombatPresentationGroup,
): ElementalFxCue[] {
  if (!frames.length || !Number.isFinite(cursor) || cursor < 0) return [];
  const end = Math.min(frames.length - 1, Math.floor(cursor));
  const current = frames[end];
  if (current.kind === 'action' && side(current.actor)) {
    const kind = METHOD_FX[current[current.actor].method];
    if (!kind) return [];
    return [{
      kind, owner: current.actor,
      target: side(current.target) ? current.target : opposite(current.actor),
      phase: 'cast', intensity: intensity(current),
    }];
  }

  const visible = combatPresentationGroup(frames, end);
  if (!visible) return [];
  const start = Math.max(visible.startIndex, suppliedGroup?.startIndex ?? visible.startIndex);
  const last = Math.min(end, visible.endIndex, suppliedGroup?.endIndex ?? end);
  if (start > last) return [];
  const group = { ...visible, startIndex: start, endIndex: last };
  const candidates: Candidate[] = [];

  const add = (cue: ElementalFxCue, priority: number, index: number, isHit = false) => {
    const existing = candidates.find(item => item.cue.kind === cue.kind &&
      item.cue.owner === cue.owner && item.cue.target === cue.target &&
      item.cue.phase === cue.phase && item.cue.intensity === cue.intensity);
    if (existing) {
      if (isHit) existing.hitCount += 1;
      return;
    }
    candidates.push({ cue, priority, firstIndex: index, hitCount: isHit ? 1 : 0 });
  };

  for (const impact of battleImpactSegments(frames, last, group)) {
    const frame = frames[impact.frameIndex];
    const isVolley = frame.cue?.kind === 'sword_volley' &&
      frame.cue.owner === impact.attacker && frame.source === frame.cue.sourceId;
    const isSwordStrike = frame.kind === 'damage' &&
      (frame.strikeVisual === 'sword_pill' || frame.strikeVisual === 'converged_blade');
    const kind = isVolley ? 'volley' : isSwordStrike ? 'blade' :
      frame.kind === 'dot' ? dotKind(frame) : sourceKind(frame);
    if (!kind) continue;
    const localImpact = frame.kind === 'dot' || kind === 'poison_fire';
    add({
      kind, owner: impact.attacker, target: impact.target,
      phase: localImpact ? 'impact' : 'travel', intensity: intensity(frame),
    }, isVolley ? 0 : kind === 'poison_fire' || isSwordStrike ? 1 : frame.kind === 'dot' ? 2 : 3,
    impact.frameIndex, true);
  }

  for (let index = start; index <= last; index += 1) {
    const frame = frames[index];
    if (!side(frame.actor) || !side(frame.target)) continue;
    const previous = frames[index - 1];
    if (frame.kind === 'status' && previous) {
      for (const [status, kind] of [['burn', 'fire'], ['poison', 'poison']] as const) {
        if ((frame[frame.target].statuses[status] || 0) >
            (previous[frame.target].statuses[status] || 0)) {
          add({ kind, owner: frame.actor, target: frame.target, phase: 'impact', intensity: intensity(frame) }, 4, index);
        }
      }
    }
    if (frame.kind === 'heal' && previous && frame[frame.target].hp > previous[frame.target].hp) {
      add({ kind: 'healing', owner: frame.actor, target: frame.target, phase: 'impact', intensity: intensity(frame) }, 5, index);
    }
    if (frame.kind === 'shield' &&
        (previous ? frame[frame.target].shield > previous[frame.target].shield : (frame.amount ?? 0) > 0)) {
      add({ kind: 'guard', owner: frame.actor, target: frame.target, phase: 'impact', intensity: intensity(frame) }, 5, index);
    }
  }

  // A travelling attack already includes its own impact; avoid covering it
  // with an identical status burst while retaining genuinely different types.
  const travel = candidates.filter(item => item.cue.phase === 'travel');
  return candidates
    .filter(item => !(item.priority === 4 && travel.some(other =>
      other.cue.kind === item.cue.kind && other.cue.owner === item.cue.owner &&
      other.cue.target === item.cue.target)))
    .sort((a, b) => a.priority - b.priority || a.firstIndex - b.firstIndex)
    .slice(0, 3)
    .map(({ cue, hitCount }) => ({ ...cue, ...(cue.phase === 'travel' && hitCount > 1 ? { count: hitCount } : {}) }));
}
