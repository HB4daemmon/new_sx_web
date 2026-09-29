import type { BattleFrame, FighterView, Side } from './types.js';

export type BattleMotion =
  | 'idle'
  | 'strike'
  | 'rage'
  | 'hit'
  | 'block'
  | 'heal'
  | 'shield'
  | 'dot'
  | 'buff';

export type BattleActionKind = 'basic' | 'rage' | 'none';

export interface BattlePresentationCue {
  actionKind: BattleActionKind;
  playerMotion: BattleMotion;
  enemyMotion: BattleMotion;
  critical: boolean;
}

export interface BloodShieldPresentation {
  capacity: number;
  hp: number;
  shield: number;
  hpPercent: number;
  shieldPercent: number;
  total: number;
}

const BASE_BEATS: Record<string, number> = {
  action: 520,
  damage: 450,
  dot: 440,
  heal: 400,
  shield: 400,
  status: 220,
  rage: 220,
  round: 400,
  start: 400,
  phase: 400,
  draw: 400,
  end: 400,
  summary: 220,
};

export function bloodShieldPresentation(
  fighter: Pick<FighterView, 'hp' | 'maxHp' | 'shield'>,
): BloodShieldPresentation {
  const maxHp = Math.max(0, fighter.maxHp);
  const hp = fighter.hp;
  const shield = fighter.shield;
  const nonNegativeShield = Math.max(0, shield);
  const capacity = Math.max(1, fighter.maxHp + nonNegativeShield);
  return {
    capacity,
    hp,
    shield,
    hpPercent: Math.min(maxHp, Math.max(0, hp)) / capacity * 100,
    shieldPercent: nonNegativeShield / capacity * 100,
    total: hp + shield,
  };
}

function actionKind(frame: BattleFrame): BattleActionKind {
  if (frame.kind !== 'action') return 'none';
  if (frame.actor && frame[frame.actor].lockedAction === 'rage_action' ||
      /怒技|rage/i.test(frame.text)) return 'rage';
  if (frame.actor && frame[frame.actor].lockedAction === 'basic_action' ||
      /普攻|basic/i.test(frame.text)) return 'basic';
  return 'none';
}

function targetOf(frame: BattleFrame, previous: BattleFrame): Side | undefined {
  if (frame.target) return frame.target;
  for (const side of ['player', 'enemy'] as const) {
    if (frame[side].hp < previous[side].hp || frame[side].shield < previous[side].shield) return side;
  }
  return undefined;
}

export function battleBeatDuration(frame: BattleFrame, speed = 1): number {
  const action = actionKind(frame);
  const base = frame.kind === 'action' && action === 'rage'
    ? 800
    : BASE_BEATS[frame.kind] || 220;
  const multiplier = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return base / multiplier;
}

export function battlePresentationCue(
  frame: BattleFrame,
  previous?: BattleFrame,
): BattlePresentationCue {
  const cue: BattlePresentationCue = {
    actionKind: actionKind(frame),
    playerMotion: 'idle',
    enemyMotion: 'idle',
    critical: false,
  };

  if (!previous) return cue;
  const motions: Record<Side, BattleMotion> = { player: 'idle', enemy: 'idle' };
  const target = targetOf(frame, previous);
  if (frame.kind === 'action' && frame.actor) {
    motions[frame.actor] = cue.actionKind === 'rage' ? 'rage' :
      cue.actionKind === 'basic' ? 'strike' : 'idle';
  } else if (frame.kind === 'dot' && target) {
    motions[target] = 'dot';
  } else if (frame.kind === 'damage' && target) {
    if (frame[target].hp < previous[target].hp) motions[target] = 'hit';
    else if (frame[target].shield < previous[target].shield) motions[target] = 'block';
    cue.critical = motions[target] === 'hit' && /暴击|会心|critical|crit/i.test(frame.text);
  } else if (frame.kind === 'heal') {
    for (const side of ['player', 'enemy'] as const) {
      if (frame[side].hp > previous[side].hp) motions[side] = 'heal';
    }
  } else if (frame.kind === 'shield') {
    for (const side of ['player', 'enemy'] as const) {
      if (frame[side].shield > previous[side].shield) motions[side] = 'shield';
    }
  } else if (frame.kind === 'status') {
    for (const side of ['player', 'enemy'] as const) {
      const statuses = new Set([
        ...Object.keys(previous[side].statuses),
        ...Object.keys(frame[side].statuses),
      ]);
      if ([...statuses].some(status =>
        (frame[side].statuses[status] || 0) > (previous[side].statuses[status] || 0))) {
        motions[side] = 'buff';
      }
    }
  }

  cue.playerMotion = motions.player;
  cue.enemyMotion = motions.enemy;
  return cue;
}
