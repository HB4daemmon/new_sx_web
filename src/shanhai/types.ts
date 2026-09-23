// Authored entities are validated by content-kit before entering this boundary.
export interface Entity {
  id: string;
  name: string;
  kind: string;
  [key: string]: any;
}
export interface Content {
  version: string;
  entities: Entity[];
  byId: Record<string, Entity>;
  rules: Entity;
}
export interface Stats {
  attack: number;
  defense: number;
  max_hp: number;
  crit_rate: number;
  speed: number;
}
export interface ArtifactStack { id: string; stacks: number }
export interface Loadout {
  name: string;
  method: string;
  n: number;
  talents: string[];
  artifacts: ArtifactStack[];
  baseStats?: Stats;
  hp?: number;
  preparation?: number;
  firstStrike?: number;
}
export type Side = 'player' | 'enemy';
export interface FighterView {
  name: string;
  method: string;
  hp: number;
  maxHp: number;
  shield: number;
  rage: number;
  rageCap: number;
  statuses: Record<string, number>;
  lockedAction?: 'basic_action' | 'rage_action';
}
export interface BattleFrame {
  round: number;
  kind: string;
  actor?: Side;
  target?: Side;
  source?: string;
  text: string;
  amount?: number;
  player: FighterView;
  enemy: FighterView;
}
export interface Contribution {
  id: string;
  name: string;
  triggers: number;
  damage: number;
  healing: number;
  shield: number;
  absorbed: number;
  rage: number;
  reason?: string;
}
export interface BattleResult {
  outcome: 'player' | 'enemy' | 'draw';
  rounds: number;
  playerHp: number;
  enemyHp: number;
  frames: BattleFrame[];
  contributions: Contribution[];
  reason?: string;
}
export type NodeType = 'C' | 'E' | 'K' | 'L' | 'S' | 'R' | 'B' | 'F';
export interface RunNode { type: NodeType; id: string; completed: boolean }
export interface RouteMapNode extends RunNode {
  key: string;
  depth: number;
  lane: number;
  next: string[];
  label?: string;
  description?: string;
}
export type RunPhase = 'route' | 'map' | 'preview' | 'battle' | 'reward' | 'event' |
  'event_result' | 'shop' | 'rest' | 'talent' | 'transition' | 'won' | 'lost';
export interface ShopItem {
  id: string;
  kind: 'artifact' | 'recovery' | 'preparation';
  price: number;
  sold: boolean;
}
export interface RunState {
  schema: 1;
  contentVersion: string;
  id: string;
  seed: string;
  name: string;
  phase: RunPhase;
  act: number;
  step: number;
  nodes: RunNode[];
  routes: string[];
  routeMap?: { nodes: RouteMapNode[]; path: string[] };
  method: string;
  ownedMethods: string[];
  talents: Record<string, string[]>;
  n: number;
  hp: number;
  xp: number;
  coins: number;
  artifacts: ArtifactStack[];
  preparation: number;
  firstStrike?: number;
  flags: Record<string, boolean>;
  storyline: string;
  independentCore: string | null;
  history: { act: number; step: number; title: string; text: string }[];
  seenEvents: string[];
  completedCore: string[];
  extraElites: number;
  ordinaryCount: number;
  rewardCandidates: string[];
  shop: ShopItem[];
  resultText: string;
  battle?: BattleResult;
  battleInput?: { player: Loadout; enemy: Loadout; seed: string; roundLimit: number };
  eventOption?: string;
  returnPhase?: RunPhase;
  nodeEntry?: { method: string; talents: string[]; artifacts: ArtifactStack[] };
  [key: string]: any;
}
export type RunCommand =
  | { type: 'route'; id: string }
  | { type: 'enter'; id?: string }
  | { type: 'back' }
  | { type: 'fight' }
  | { type: 'battle_done' }
  | { type: 'continue_battle' }
  | { type: 'reward'; id: string | null }
  | { type: 'event'; id: string }
  | { type: 'continue' }
  | { type: 'buy'; id: string }
  | { type: 'leave_shop' }
  | { type: 'rest'; choice: 'heal' | 'preparation' | 'swap_method'; method?: string }
  | { type: 'talent'; id: string }
  | { type: 'retire' };
