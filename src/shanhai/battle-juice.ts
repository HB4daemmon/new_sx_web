import type { CombatPresentationGroup } from './battle-playback.js';
import type { BattleFrame, Side } from './types.js';

/**
 * Presentation-only "game feel" cues: screen shake, hit-stop, flashes, combo
 * counters, rage cut-ins and knockouts. Everything here is derived from frame
 * snapshots that already exist; nothing feeds back into combat resolution.
 */
export type JuiceShake = 0 | 1 | 2 | 3;
export type JuiceFlash = 'none' | 'hit' | 'crit' | 'rage' | 'ko';

export interface BattleJuice {
  shake: JuiceShake;
  /** Game-time freeze applied before the beat continues. */
  hitstopMs: number;
  flash: JuiceFlash;
  /** Side that received the heaviest blow in this beat. */
  target?: Side;
  /** Side dealing the blow (opposite of target unless self damage). */
  attacker?: Side;
  /** Real damage dealt to the target in this beat. */
  damage: number;
  /** Damage as a share of the target's max HP, 0..1+. */
  ratio: number;
  /** Visible hit count on the target; ≥2 shows a combo counter. */
  combo: number;
  critical: boolean;
  /** The blow lands right after a rage action by the attacker. */
  rageImpact: boolean;
  /** A rage action begins this beat: show the cut-in for this side. */
  rageCutIn?: Side;
  /** This side's HP dropped to zero in this beat. */
  knockout?: Side;
  /** Healing or shield gain worth celebrating on this side. */
  surge?: Side;
}

const NONE: BattleJuice = {
  shake: 0,
  hitstopMs: 0,
  flash: 'none',
  damage: 0,
  ratio: 0,
  combo: 0,
  critical: false,
  rageImpact: false,
};

export const RAGE_CUTIN_HOLD_MS = 520;
export const KO_HOLD_MS = 640;

function other(side: Side): Side {
  return side === 'player' ? 'enemy' : 'player';
}

function isRageAction(frame: BattleFrame | undefined): boolean {
  if (!frame || frame.kind !== 'action' || !frame.actor) return false;
  return frame[frame.actor]?.lockedAction === 'rage_action' || /怒技|rage/i.test(frame.text || '');
}

/** Finds the action frame that opened the beat containing `startIndex`. */
function precedingAction(frames: readonly BattleFrame[], startIndex: number): BattleFrame | undefined {
  for (let index = startIndex - 1; index >= 0 && index >= startIndex - 4; index -= 1) {
    const frame = frames[index];
    if (frame.kind === 'action') return frame;
    if (frame.kind === 'round' || frame.kind === 'start') return undefined;
  }
  return undefined;
}

function shakeFor(ratio: number, critical: boolean, rage: boolean): JuiceShake {
  let level = ratio >= .2 ? 3 : ratio >= .08 ? 2 : ratio > 0 ? 1 : 0;
  if (level && (critical || rage)) level += 1;
  return Math.min(3, level) as JuiceShake;
}

export function battleJuice(
  frames: readonly BattleFrame[],
  cursor: number,
  group?: CombatPresentationGroup,
): BattleJuice {
  const frame = frames[cursor];
  if (!frame) return NONE;
  const previous = cursor > 0 ? frames[cursor - 1] : undefined;

  if (!group) {
    if (isRageAction(frame) && frame.actor) {
      return { ...NONE, flash: 'rage', rageCutIn: frame.actor, hitstopMs: RAGE_CUTIN_HOLD_MS };
    }
    return NONE;
  }

  const before = group.startIndex > 0 ? frames[group.startIndex - 1] : previous;
  const end = frames[Math.min(frames.length - 1, group.endIndex)] || frame;
  let target: Side | undefined;
  let best = 0;
  for (const side of ['player', 'enemy'] as const) {
    const damage = group[side].damage;
    if (damage > best) {
      best = damage;
      target = side;
    }
  }

  let knockout: Side | undefined;
  if (before) {
    for (const side of ['player', 'enemy'] as const) {
      if (before[side].hp > 0 && end[side].hp <= 0) knockout = side;
    }
  }

  let surge: Side | undefined;
  for (const side of ['player', 'enemy'] as const) {
    if (group[side].healing > 0 || group[side].shieldGenerated > 0) surge = side;
  }

  if (!target) {
    return knockout
      ? { ...NONE, knockout, flash: 'ko', hitstopMs: KO_HOLD_MS, shake: 3 }
      : { ...NONE, surge };
  }

  const summary = group[target];
  const dotOnly = group.dot && summary.dotDamage === summary.damage;
  const maxHp = Math.max(1, (before || frame)[target].maxHp || 1);
  const ratio = summary.damage / maxHp;
  const opener = precedingAction(frames, group.startIndex);
  const attacker = opener?.actor || other(target);
  const rageImpact = !dotOnly && isRageAction(opener) && opener?.actor === attacker;
  const critical = summary.critical && !dotOnly;
  const shake = dotOnly ? (ratio >= .08 ? 1 : 0) : shakeFor(ratio, critical, rageImpact);
  let hitstopMs = dotOnly ? 0
    : rageImpact ? 170
      : critical ? 120
        : shake >= 3 ? 100 : shake === 2 ? 70 : 45;
  let flash: JuiceFlash = dotOnly ? 'none' : rageImpact ? 'rage' : critical ? 'crit' : 'hit';
  if (knockout) {
    hitstopMs = KO_HOLD_MS;
    flash = 'ko';
  }

  return {
    shake: knockout ? 3 : shake,
    hitstopMs,
    flash,
    target,
    attacker,
    damage: summary.damage,
    ratio,
    combo: summary.hits,
    critical,
    rageImpact,
    knockout,
    surge,
  };
}

/**
 * Scales a game-time freeze to wall time. Faster playback keeps some freeze
 * so 4× still feels weighty, but never blocks the timeline for long.
 */
export function hitstopWallMs(juice: BattleJuice, speed: number, reducedMotion = false): number {
  if (reducedMotion || juice.hitstopMs <= 0) return 0;
  const multiplier = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.round(juice.hitstopMs / Math.sqrt(multiplier));
}
