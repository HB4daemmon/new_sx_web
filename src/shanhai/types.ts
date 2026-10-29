import type { EventCommitmentRecord } from './event-commitments.js';
import type { EventCheckResult } from './event-checks.js';

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
export type EquipmentRole = 'core' | 'support';
export interface RunEquipment {
  slots: string[];
}
export interface RunProgress {
  coinsSpent: number;
  eliteWins: number;
  bossWins: number;
}
export interface JourneyContext extends RunProgress {
  coins: number;
  artifactKinds: number;
  knownMethods: number;
}
export interface Loadout {
  name: string;
  method: string;
  companion?: string;
  n: number;
  talents: string[];
  artifacts: ArtifactStack[];
  baseStats?: Stats;
  hp?: number;
  preparation?: number;
  firstStrike?: number;
  journey?: JourneyContext;
  encounterId?: string;
  thunderChallenge?: boolean;
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
  counters?: { id: string; name: string; value: number; max: number }[];
  summons?: { id: string; kind: 'sword'; count: number; max: number }[];
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
  cue?: {
    kind: 'sword_volley' | 'guard_counter' | 'spring_bloom' | 'enemy_charge' | 'enemy_release' | 'rage_chain' | 'companion_assist';
    owner: Side;
    sourceId: string;
    count?: number;
  };
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
  kind: 'artifact' | 'recovery' | 'preparation' | 'talent_reset';
  price: number;
  sold: boolean;
}
export type ArtifactRewardFamily = 'sword' | 'guard' | 'vitality' | 'affliction';
export interface RewardSearchRecord {
  act: number;
  step: number;
  family: ArtifactRewardFamily;
  cost: number;
  candidates: string[];
  resolved: boolean;
}
export interface RewardRefineRecord {
  act: number;
  step: number;
  source: string;
  target: string;
  targetStacksBefore: number;
  forfeited: string[];
}
export interface FusionWinRecord {
  act: number;
  step: number;
  kind: 'node' | 'event';
  enemyId: string;
  entryInventory: ArtifactStack[];
  settlementInventory: ArtifactStack[];
}
export interface FusionProgressRecord {
  id: string;
  wins: FusionWinRecord[];
}
export interface FusionHistoryRecord {
  id: string;
  act: number;
  step: number;
  title: string;
  text: string;
}
export interface FusionBattleEntry {
  act: number;
  step: number;
  kind: 'node' | 'event';
  enemyId: string;
  inventory: ArtifactStack[];
  eligibleRecipes: string[];
  settlementInventory?: ArtifactStack[];
}
export interface FusionStatus {
  id: string;
  name: string;
  inputs: [string, string];
  wins: number;
  requiredWins: number;
  complete: boolean;
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
  equipment: RunEquipment;
  buildVersion: 5;
  rewardSearches: RewardSearchRecord[];
  rewardRefinements: RewardRefineRecord[];
  fusionProgress: FusionProgressRecord[];
  fusionHistory: FusionHistoryRecord[];
  progress: RunProgress;
  talentDraftGeneration: number;
  talentDrafts: Record<string, string[]>;
  preparation: number;
  firstStrike?: number;
  flags: Record<string, boolean>;
  storyline: string;
  independentCore: string | null;
  history: {
    act: number;
    step: number;
    title: string;
    text: string;
    eventId?: string;
    optionId?: string;
    eventOutcome?: 'success' | 'failure';
    eventCheck?: EventCheckResult;
    storyEcho?: string;
  }[];
  seenEvents: string[];
  completedCore: string[];
  eventCommitments?: EventCommitmentRecord[];
  extraElites: number;
  ordinaryCount: number;
  rewardCandidates: string[];
  shop: ShopItem[];
  resultText: string;
  battle?: BattleResult;
  battleInput?: { player: Loadout; enemy: Loadout; seed: string; roundLimit: number; rules?: 'awakening-v1' };
  _fusionBattleEntry?: FusionBattleEntry;
  eventOption?: string;
  eventCheck?: EventCheckResult;
  eventStoryEcho?: string;
  _shopReforged?: boolean;
  returnPhase?: RunPhase;
  nodeEntry?: { method: string; talents: string[]; artifacts: ArtifactStack[] };
  [key: string]: any;
}
export type RunCommand =
  | { type: 'route'; id: string }
  | { type: 'enter'; id?: string }
  | { type: 'back' }
  | { type: 'fight' }
  | { type: 'challenge_elite' }
  | { type: 'thunder_challenge'; enabled: boolean }
  | { type: 'battle_done' }
  | { type: 'continue_battle' }
  | { type: 'reward'; id: string | null }
  | { type: 'seek_reward'; family: ArtifactRewardFamily }
  | { type: 'refine_reward'; source: string; target: string }
  | { type: 'event'; id: string }
  | { type: 'continue' }
  | { type: 'buy'; id: string }
  | { type: 'reforge'; source: string; target: string }
  | { type: 'leave_shop' }
  | { type: 'rest'; choice: 'heal' | 'preparation' | 'swap_method' | 'temper'; method?: string; artifact?: string }
  | { type: 'talent'; id: string }
  | { type: 'equip'; id: string; replace?: string }
  | { type: 'unequip'; id: string }
  | { type: 'reorder_equipment'; id: string; direction: 'left' | 'right' }
  | { type: 'retire' };
