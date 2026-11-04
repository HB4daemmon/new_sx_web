import type { El } from './elements.js';

export type TileMod = 'lei' | 'zhong' | 'ling' | 'jing';
export interface Tile {
  uid: number;
  /** 'zhuo' = 浊符, a curse tile with no element. */
  el: El | 'zhuo';
  v: number;
  mod?: TileMod;
}

export type PatternId =
  | 'san' | 'dui' | 'liangyi' | 'sancai' | 'sheng3' | 'mantang'
  | 'wuxing' | 'sixiang' | 'sheng4' | 'lunzhuan' | 'wulei';

export interface Move {
  name: string;
  atk?: number;
  hits?: number;
  armor?: number;
  curse?: number;
  burn?: number;
  heal?: number;
  buff?: number;
  drain?: number;
  charge?: boolean;
}

export interface Fighter {
  hp: number;
  maxHp: number;
  shield: number;
  burn: number;
}

export interface EnemyState extends Fighter {
  id: string;
  el: El;
  armor: number;
  atkBonus: number;
  charged: boolean;
  moveIndex: number;
  phase: 1 | 2;
  revived: boolean;
  intent: Move;
}

export interface BattleState {
  enemyId: string;
  kind: NodeKind;
  turn: number;
  hand: Tile[];
  draw: Tile[];
  discard: Tile[];
  /** Tiles removed for this battle only (e.g. 回 tiles are not used yet). */
  exhausted: Tile[];
  player: Fighter;
  enemy: EnemyState;
  qi: number; // 剑意 meter 0..100
  discardsLeft: number;
  castsThisTurn: number;
  freeCastUsed: boolean;
  castCount: number;
  swords: number;
  spring: number; // 春华 (回春功)
  stacks: Record<string, number>; // per-battle growth counters
  outcome: 'fighting' | 'won' | 'lost';
  bestHit: number;
  /** 因缘 that came to help in this battle (final only). */
  assists?: string[];
}

export type NodeKind = 'fight' | 'elite' | 'event' | 'shop' | 'rest' | 'boss';
export interface MapNode {
  id: string;
  row: number;
  col: number;
  kind: NodeKind;
  next: string[];
  enemy?: string;
  event?: string;
}

export type RewardOption =
  | { type: 'tile'; tile: Omit<Tile, 'uid'> }
  | { type: 'pattern'; pattern: PatternId }
  | { type: 'relic'; relic: string }
  | { type: 'talent'; talent: string }
  | { type: 'heal'; amount: number }
  | { type: 'gold'; amount: number };

export interface ShopItem { option: RewardOption; price: number; sold: boolean }

export type Screen =
  | { name: 'map' }
  | { name: 'battle' }
  | { name: 'reward'; gold: number; options: RewardOption[]; relicOptions: RewardOption[]; picked: boolean; relicPicked: boolean; next: 'map' | 'breakthrough'; story?: string }
  | { name: 'story'; act: number }
  | { name: 'ending' }
  | { name: 'breakthrough'; options: RewardOption[] }
  | { name: 'shop'; items: ShopItem[]; removePrice: number; removed: boolean }
  | { name: 'event'; event: string; resolved?: string }
  | { name: 'rest'; done?: boolean }
  | { name: 'pick-tile'; purpose: 'remove' | 'upgrade' | 'reforge'; count: number; then: Screen; title: string }
  | { name: 'won' }
  | { name: 'lost' };

export interface RunState {
  version: 3;
  seed: string;
  rng: { state: number };
  method: string;
  heat: number;
  act: number; // 1..5 (5 = 天门)
  map: MapNode[];
  at: string | null;
  visited: string[];
  hp: number;
  maxHp: number;
  gold: number;
  bag: Tile[];
  nextUid: number;
  relics: string[];
  relicSlots: number;
  patternLv: Record<PatternId, number>;
  talents: string[];
  vow: string | null;
  realm: number;
  screen: Screen;
  battle: BattleState | null;
  stats: { bestHit: number; kills: number; casts: number; turns: number; biggestPattern: PatternId | null; floors: number };
  log: string[];
  /** The two 因缘 threads planned for this run: [act1→act3, act2→act4]. */
  plan: string[];
  bonds: Record<string, 'kept' | 'declined' | 'done'>;
  /** 行迹: one line per meaningful thing that actually happened. */
  deeds: string[];
  ending: string | null;
}
