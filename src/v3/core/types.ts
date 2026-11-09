import type { El } from './elements.js';

/** 灵：当任意元素 · 幻：当任意点数 1–5 · 宝：+1 番 · 倍（id 'lei'）：伤害 ×1.5 */
export type TileMod = 'ling' | 'huan' | 'bao' | 'lei';
/** 本门符: each method's own buff tile. */
export type SpId = 'jian' | 'huozhong' | 'jingang' | 'leiyin' | 'chunya' | 'zhuyin';
export interface Tile {
  uid: number;
  /** 'zhuo' = 浊符, a curse tile with no element. */
  el: El | 'zhuo';
  v: number;
  mod?: TileMod;
  sp?: SpId;
}

/** 路 (each one an upgradeable 心法). */
export type PatternId = 'yuan' | 'shu' | 'lian' | 'wuxing' | 'podi' | 'luoshu';
/** 役. */
export type YakuId =
  | 'shuangyuan' | 'liangyi' | 'sancai' | 'mantang' | 'sixiang' | 'sancai2' | 'sixiang2' | 'wulei'
  | 'chengshuang' | 'shuangdui' | 'sanqing' | 'hulu' | 'siyu' | 'sanqing2' | 'siyu2'
  | 'lian3' | 'lian4' | 'lian5' | 'hualong'
  | 'sanhua' | 'wuxing'
  | 'pozhan' | 'pozhen' | 'pojun'
  | 'shiquan' | 'luoshu'
  | 'jiutian' | 'shengsheng' | 'wuqi'
  | 'jianzhen' | 'wanjian' | 'liaoyuan' | 'fenyuan' | 'jinshen' | 'buhuai' | 'leiming' | 'lianlei' | 'chunman' | 'wanmu' | 'zhouye' | 'riyue';
/** The named shape of a cast: its headline 役, or 散 (no 役). */
export type ComboId = YakuId | 'san';

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

export interface FightRecord {
  act: number; enemy: string; kind: NodeKind; won: boolean;
  hpIn: number; hpOut: number; maxHp: number; turns: number; casts: number; best: number;
  /** Damage the player took, by source, and how much shields soaked. */
  taken: { enemy: number; burn: number; trib: number; blood: number }; blocked: number;
  enemyMax: number; enemyLeft: number;
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
  | { name: 'reward'; gold: number; options: RewardOption[]; relicOptions: RewardOption[]; picked: boolean; relicPicked: boolean; next: 'map' | 'breakthrough' | 'endless'; story?: string; rerolled?: boolean; devoured?: boolean }
  | { name: 'story'; act: number }
  | { name: 'ending' }
  | { name: 'breakthrough'; options: RewardOption[] }
  | { name: 'shop'; items: ShopItem[]; removePrice: number; removed: boolean; restocked?: boolean; merged?: boolean }
  | { name: 'event'; event: string; resolved?: string }
  | { name: 'rest'; done?: boolean; used?: number }
  | { name: 'pick-tile'; purpose: 'remove' | 'upgrade' | 'reforge' | 'fuse' | 'merge' | 'devour'; count: number; then: Screen; title: string; price?: number }
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
  stats: {
    bestHit: number; kills: number; casts: number; turns: number; biggestPattern: ComboId | null; floors: number; paid?: number; achPaid?: number;
    /** How often each 诀 / element went into a cast: the run's "build" as actually played. */
    use?: Partial<Record<PatternId, number>>; elUse?: Partial<Record<El, number>>;
    /** Rewards left on the table (not purged), and paid rerolls. */
    skips?: number; rerolls?: number;
  };
  /** One line per battle, for the 复盘 on the end screen. */
  journal?: FightRecord[];
  /** 命格 and, for 偏枯命, its 本命元素. */
  fate?: string | null;
  fateEl?: El | null;
  /** Small running tallies for talents and 命格 (行险 streak, 点石成金 spend, …). */
  counters?: Record<string, number>;
  log: string[];
  /** The two 因缘 threads planned for this run: [act1→act3, act2→act4]. */
  plan: string[];
  bonds: Record<string, 'kept' | 'declined' | 'done'>;
  /** 行迹: one line per meaningful thing that actually happened. */
  deeds: string[];
  ending: string | null;
  /** 天劫契 clauses (id → rank). */
  pacts: Record<string, number>;
  /** 道树 unlocks and 道行 perks active for this run, copied from the profile at start. */
  unlocks: string[];
  /** 无尽劫 layer after the ending (0 = not entered). */
  endless: number;
  daily: string | null;
  /** 养剑诀: swords carried between battles. */
  swordsKept?: number;
}
