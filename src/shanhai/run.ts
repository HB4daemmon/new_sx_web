import { hashSeed, seededRandom } from './content.js';
import {
  calculateStats as combatCalculateStats,
  simulateBattle as combatSimulateBattle,
} from './combat.js';
import {
  ACT1_CORE_DEPTHS,
  createRouteMapNodes,
  validateRouteMap,
} from './route-map.js';
import {
  advanceEventCommitments,
  assertEventCommitmentRecords,
  createEventCommitment,
} from './event-commitments.js';
import { assertEventCheckResult, resolveEventCheck } from './event-checks.js';
import { routeLayoutForAct } from './route-profiles.js';
import {
  MAX_EQUIPMENT_SLOTS,
  artifactRole,
  autoEquipArtifact,
  equippedArtifactStacks,
  removeMissingEquipment,
  validateEquipment,
} from './equipment.js';
import type {
  ArtifactStack,
  ArtifactRewardFamily,
  BattleFrame,
  BattleResult,
  Content,
  Entity,
  FusionBattleEntry,
  FusionHistoryRecord,
  FusionStatus,
  FusionWinRecord,
  Loadout,
  RewardRefineRecord,
  RewardSearchRecord,
  RunCommand,
  RunNode,
  RunPhase,
  RunState,
  RouteMapNode,
  ShopItem,
  Stats,
} from './types.js';

/**
 * The combat implementation is intentionally a separate worker.  The run
 * layer only owns the input snapshot and the settlement boundary, so it can be
 * used by the browser UI and by a headless test harness without importing a
 * particular combat bundle.
 */
export interface ShanhaiCombatWorker {
  calculateStats(content: Content, loadout: Loadout): Stats;
  simulateBattle(
    content: Content,
    player: Loadout,
    enemy: Loadout,
    seed: string,
    options?: { roundLimit?: number; artifactAwakenings?: boolean },
  ): BattleResult;
}

let combatWorker: ShanhaiCombatWorker | undefined;

export function registerCombatWorker(worker: ShanhaiCombatWorker): void {
  if (!worker || typeof worker.calculateStats !== 'function' || typeof worker.simulateBattle !== 'function') {
    throw new Error('Invalid Shanhai combat worker');
  }
  combatWorker = worker;
}

export const setCombatWorker = registerCombatWorker;
export const configureCombatWorker = registerCombatWorker;

const PHASES: readonly RunPhase[] = [
  'route',
  'map',
  'preview',
  'battle',
  'reward',
  'event',
  'event_result',
  'shop',
  'rest',
  'talent',
  'transition',
  'won',
  'lost',
];

const SHOP_KINDS = ['artifact', 'recovery', 'preparation', 'talent_reset'] as const;
const METHOD_IDS = /^RKF\d\d$/;
const ARTIFACT_IDS = /^(?:RC|RR|RL)\d\d$/;
const ARTIFACT_REWARD_FAMILIES: readonly ArtifactRewardFamily[] = [
  'sword',
  'guard',
  'vitality',
  'affliction',
];

type AnyRecord = Record<string, any>;
type CoreQueueItem = { method: string; tier: number; advance: boolean };
type TravelResource = 'hp' | 'coins' | 'xp';

interface RouteTemplate {
  id: string;
  name: string;
  summary: string;
  nodes: AnyRecord[];
}

interface EventEncounter {
  eventId: string;
  optionId: string;
  enemyId: string;
  mode: string;
  failureHpFloor: number;
  failureRewards: AnyRecord[];
  failureOutcome?: string;
}

interface ThunderChallengeRecord {
  act: number;
  step: number;
  nodeType: 'L' | 'B';
  enemyId: string;
  outcome: 'win' | 'loss';
  xpBonus: number;
  normalCandidates: string[];
  normalSettled: boolean;
  normalReward: string | null;
  extraRarity: 'rare' | 'legendary' | null;
  extraInventory: ArtifactStack[];
  extraCandidates: string[];
  extraReward: string | null;
  fallbackCoins: number;
}

const THUNDER_CHALLENGE_FALLBACK_COINS = 20;

interface RunStateInternals extends RunState {
  _routeId?: string;
  _routeHistory?: string[];
  _plannedStoryline?: string;
  _independentCore?: string | null;
  _corePositions?: number[];
  _coreCount?: number;
  _actCoreCount?: number;
  _lastCorePosition?: number;
  _seenEnemyIds?: string[];
  _lastEnemyId?: string;
  _actEliteCount?: number;
  _talentQueue?: CoreQueueItem[];
  _returnPhase?: RunPhase;
  _pendingRestChoice?: string;
  _restFromEvent?: boolean;
  _pendingEvent?: EventEncounter;
  _previewKind?: 'node' | 'event';
  _battleSettled?: boolean;
  _battleKind?: 'node' | 'event';
  _battleNodeType?: string;
  _battleRewardType?: 'common' | 'elite' | 'boss';
  _eventRewardApplied?: boolean;
  _swapAvailable?: boolean;
  _consecutiveNodes?: number;
  _methodConsecutiveNodes?: Record<string, number>;
  _pendingTravelResources?: Record<string, number>;
  _pendingTravelResourceKinds?: Record<string, TravelResource>;
  _methodTravelSequence?: 'heal' | 'xp';
  _pendingTravelCoins?: number;
  _eventCostTravelApplied?: boolean;
  _nodeEntry?: RunState['nodeEntry'];
  _travelSnapshots?: Array<{
    act: number;
    step: number;
    method: string;
    talents: string[];
    artifacts: ArtifactStack[];
    phase: RunPhase;
  }>;
  _bossEnemyByAct?: Record<string, string>;
  _nodeEnemyByKey?: Record<string, string>;
  _rewardSettled?: boolean;
  _eventSettled?: boolean;
  _eventOutcome?: 'success' | 'failure';
  _coreRewardOffered?: boolean;
  _actEliteChallengeUsed?: boolean;
  _challengeEliteEnemyId?: string;
  _thunderChallenge?: boolean;
  _thunderRewardStage?: 'normal' | 'bonus';
  _thunderRewardCandidates?: string[];
  _thunderRewardFallback?: { type: 'coins'; amount: number };
  thunderChallenges?: ThunderChallengeRecord[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isObject(value: unknown): value is AnyRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return Number.isInteger(value);
}

function contentEntity(content: Content, id: string | undefined): Entity | undefined {
  if (!id) return undefined;
  const byId = content.byId as any;
  if (byId instanceof Map) return byId.get(id);
  return byId?.[id] ?? content.entities?.find(entity => entity.id === id);
}

function normalizeContent(input: Content): Content {
  const source = input as any;
  const rawById = source.byId;
  const byId: Record<string, Entity> = Object.create(null);
  if (rawById instanceof Map) {
    for (const [id, entity] of rawById.entries()) byId[id] = entity;
  } else if (isObject(rawById)) {
    Object.assign(byId, rawById);
  } else if (Array.isArray(source.entities)) {
    for (const entity of source.entities) if (entity?.id) byId[entity.id] = entity;
  }
  const entities = Array.isArray(source.entities)
    ? source.entities
    : Object.values(byId);
  const rules = source.rules ?? byId.RULES;
  const version = typeof source.version === 'string'
    ? source.version
    : typeof source.manifest?.content_version === 'string'
      ? source.manifest.content_version
      : rules?.content_version;
  if (!version || !rules) throw new Error('Invalid Shanhai content');
  return { ...source, version, entities, byId, rules };
}

function contentEntities(content: Content, kind?: string): Entity[] {
  if (Array.isArray(content.entities)) {
    return kind ? content.entities.filter(entity => entity.kind === kind) : content.entities.slice();
  }
  return [];
}

function rulesOf(content: Content): AnyRecord {
  return content.rules ?? contentEntity(content, 'RULES') ?? {};
}

interface RewardSeekingConfig {
  price: number;
  max_per_act: 1;
  families: Record<ArtifactRewardFamily, string[]>;
}

interface RewardRefiningConfig {
  max_per_act: 1;
}

interface FusionRecipe {
  id: string;
  name: string;
  inputs: [string, string];
  fights: number;
}

function rewardRefiningConfig(content: Content): RewardRefiningConfig {
  const source = rulesOf(content).economy?.reward_refining;
  if (!isObject(source) || Object.keys(source).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(source, 'max_per_act') ||
    !integer(source.max_per_act) || source.max_per_act !== 1) {
    throw new Error('Invalid reward refining configuration');
  }
  return { max_per_act: source.max_per_act };
}

function fusionRecipes(content: Content): FusionRecipe[] {
  const authored = contentEntities(content, 'artifact')
    .filter(artifact => artifact.fusion_recipe !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (authored.length > 16) throw new Error('Invalid fusion recipe count');
  const inputs = new Set<string>();
  const recipes = authored.map(artifact => {
    const source = artifact.fusion_recipe;
    if (!isObject(source) || Object.keys(source).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(source, 'inputs') ||
      !Object.prototype.hasOwnProperty.call(source, 'fights') ||
      !Array.isArray(source.inputs) || source.inputs.length !== 2 ||
      source.inputs.some((id: unknown) => typeof id !== 'string' || id === artifact.id) ||
      source.inputs[0] === source.inputs[1] || !integer(source.fights) ||
      source.fights < 1 || source.fights > 16 || artifact.max_stacks !== 1 ||
      !artifactRole(content, artifact.id)) {
      throw new Error(`Invalid fusion recipe: ${artifact.id}`);
    }
    const recipeInputs = source.inputs as [string, string];
    for (const inputId of recipeInputs) {
      const input = contentEntity(content, inputId);
      if (!input || input.kind !== 'artifact' || !artifactRole(content, inputId) || inputs.has(inputId)) {
        throw new Error(`Invalid fusion input: ${artifact.id}:${inputId}`);
      }
      inputs.add(inputId);
    }
    return { id: artifact.id, name: artifact.name, inputs: recipeInputs.slice() as [string, string], fights: source.fights };
  });
  return recipes;
}

function isFusionResult(content: Content, id: string): boolean {
  return contentEntities(content, 'artifact').some(artifact =>
    artifact.id === id && artifact.fusion_recipe !== undefined);
}

function inventoryHasInputs(inventory: ArtifactStack[], recipe: FusionRecipe): boolean {
  return recipe.inputs.every(id => inventory.some(stack => stack.id === id && stack.stacks > 0));
}

function fusionCompletionText(content: Content, recipe: FusionRecipe): string {
  const inputs = recipe.inputs.map(id => artifactEntity(content, id).name);
  return `融合完成：消耗${inputs[0]}×1、${inputs[1]}×1，获得${recipe.name}。`;
}

function sameInventory(left: ArtifactStack[], right: ArtifactStack[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rewardSeekingConfig(content: Content): RewardSeekingConfig {
  const source = rulesOf(content).economy?.reward_seeking;
  const keys = ['price', 'max_per_act', 'families'];
  if (!isObject(source) || Object.keys(source).length !== keys.length ||
    keys.some(key => !Object.prototype.hasOwnProperty.call(source, key)) ||
    !integer(source.price) || source.price <= 0 || source.max_per_act !== 1 ||
    !isObject(source.families)) {
    throw new Error('Invalid reward seeking configuration');
  }
  const familyKeys = Object.keys(source.families).sort();
  const expectedFamilyKeys = ARTIFACT_REWARD_FAMILIES.slice().sort();
  if (JSON.stringify(familyKeys) !== JSON.stringify(expectedFamilyKeys)) {
    throw new Error('Invalid reward seeking families');
  }
  const families = {} as Record<ArtifactRewardFamily, string[]>;
  for (const family of ARTIFACT_REWARD_FAMILIES) {
    const ids = source.families[family];
    if (!Array.isArray(ids) || ids.some((id: unknown) =>
      typeof id !== 'string' || contentEntity(content, id)?.kind !== 'artifact') ||
      new Set(ids).size !== ids.length) {
      throw new Error(`Invalid reward seeking family: ${family}`);
    }
    families[family] = ids.slice();
  }
  return { price: source.price, max_per_act: source.max_per_act, families };
}

function actEntity(content: Content, act: number): Entity | undefined {
  return contentEntity(content, act === 5 ? 'RF01' : `RA0${act}`);
}

function methodEntity(content: Content, id: string): Entity {
  const method = contentEntity(content, id);
  if (!method || method.kind !== 'method') throw new Error(`Unknown method: ${id}`);
  return method;
}

function artifactEntity(content: Content, id: string): Entity {
  const artifact = contentEntity(content, id);
  if (!artifact || artifact.kind !== 'artifact') throw new Error(`Unknown artifact: ${id}`);
  return artifact;
}

function rewardRefinementHistoryText(content: Content, record: RewardRefineRecord): string {
  const source = artifactEntity(content, record.source);
  const target = artifactEntity(content, record.target);
  const forfeited = record.forfeited
    .map(id => artifactEntity(content, id).name)
    .join('、');
  return `第${record.act}幕第${record.step + 1}处炼宝：舍弃${source.name}一层；${target.name}由${record.targetStacksBefore}层炼至${record.targetStacksBefore + 1}层；放弃本次奖励：${forfeited}。`;
}

function eventEntity(content: Content, id: string): Entity {
  const event = contentEntity(content, id);
  if (!event || event.kind !== 'event') throw new Error(`Unknown event: ${id}`);
  return event;
}

function routeTemplates(content: Content, act: number): RouteTemplate[] {
  const entity = actEntity(content, act);
  if (!entity || !Array.isArray(entity.routes)) return [];
  return entity.routes.filter((route: AnyRecord) =>
    isObject(route) && typeof route.id === 'string' && Array.isArray(route.nodes),
  ) as RouteTemplate[];
}

function baseStats(content: Content, n: number): Stats {
  const rules = rulesOf(content);
  const list = rules.cultivation?.base_stats_by_tier;
  const source = Array.isArray(list) ? list[Math.max(0, Math.min(4, n))] : undefined;
  return {
    attack: finite(source?.attack) ? source.attack : 120 + n * 30,
    defense: finite(source?.defense) ? source.defense : 100 + n * 25,
    max_hp: finite(source?.max_hp) ? source.max_hp : 500 + n * 125,
    crit_rate: finite(source?.crit_rate) ? source.crit_rate : 0.05,
    speed: finite(source?.speed) ? source.speed : 10,
  };
}

function hasTalent(state: RunState, id: string): boolean {
  return (state.talents[state.method] ?? []).includes(id);
}

function journeyContext(state: RunState): NonNullable<Loadout['journey']> {
  return {
    coins: state.coins,
    coinsSpent: state.progress.coinsSpent,
    eliteWins: state.progress.eliteWins,
    bossWins: state.progress.bossWins,
    artifactKinds: new Set(state.artifacts.map(stack => stack.id)).size,
    knownMethods: new Set(state.ownedMethods).size,
  };
}

function battleRewardType(type: RunNode['type']): 'common' | 'elite' | 'boss' | undefined {
  if (type === 'C') return 'common';
  if (type === 'L') return 'elite';
  if (type === 'B') return 'boss';
  return undefined;
}

function thunderChallengeXpBonus(content: Content, act: number, nodeType: 'L' | 'B'): number {
  const economy = rulesOf(content).economy ?? {};
  const values = nodeType === 'L' ? economy.elite_xp_by_act : economy.boss_xp_by_act;
  const base = finite(values?.[act - 1]) ? values[act - 1] : 0;
  return base * 0.5;
}

function rollThunderChallengeCandidates(
  content: Content,
  seed: string,
  act: number,
  step: number,
  inventory: ArtifactStack[],
  normalReward: string | null,
): { rarity: 'rare' | 'legendary' | null; candidates: string[] } {
  const snapshot = { artifacts: inventory } as RunState;
  for (const rarity of ['rare', 'legendary'] as const) {
    const pool = contentEntities(content, 'artifact')
      .filter(artifact => artifact.rarity === rarity && artifact.id !== normalReward &&
        !isFusionResult(content, artifact.id) &&
        artifactCapacity(content, snapshot, artifact.id, 1).ok)
      .map(artifact => artifact.id);
    const random = seededRandom(`${seed}:thunder-challenge:${act}:${step}:${rarity}`);
    const candidates: string[] = [];
    while (pool.length && candidates.length < 3) {
      const index = Math.floor(random() * pool.length);
      candidates.push(pool.splice(index, 1)[0]!);
    }
    if (candidates.length) return { rarity, candidates };
  }
  return { rarity: null, candidates: [] };
}

function sameStats(actual: unknown, expected: unknown): boolean {
  if (!isObject(actual) || !isObject(expected)) return false;
  const keys = ['attack', 'defense', 'max_hp', 'crit_rate', 'speed'];
  return Object.keys(actual).length === keys.length && Object.keys(expected).length === keys.length &&
    keys.every(key => actual[key] === expected[key]);
}

function validateThunderChallengeHistory(content: Content, state: RunStateInternals): void {
  const records = state.thunderChallenges;
  const activeBonusCandidates = state._thunderRewardCandidates ?? [];
  if (!Array.isArray(records) || records.length > 44) throw new Error('Invalid thunder challenge history');
  const expectedKeys = [
    'act', 'step', 'nodeType', 'enemyId', 'outcome', 'xpBonus', 'normalCandidates',
    'normalSettled', 'normalReward', 'extraRarity', 'extraInventory', 'extraCandidates',
    'extraReward', 'fallbackCoins',
  ];
  const seen = new Set<string>();
  let previousPosition = -1;

  for (const record of records) {
    if (!isObject(record) || Object.keys(record).length !== expectedKeys.length ||
      !expectedKeys.every(key => Object.prototype.hasOwnProperty.call(record, key)) ||
      !integer(record.act) || record.act < 1 || record.act > 4 || record.act > state.act ||
      !integer(record.step) || record.step < 0 || record.step > 10 ||
      !['L', 'B'].includes(record.nodeType) || typeof record.enemyId !== 'string' ||
      !['win', 'loss'].includes(record.outcome) || !finite(record.xpBonus) || record.xpBonus < 0 ||
      !Array.isArray(record.normalCandidates) || record.normalCandidates.length > 3 ||
      typeof record.normalSettled !== 'boolean' ||
      (record.normalReward !== null && typeof record.normalReward !== 'string') ||
      ![null, 'rare', 'legendary'].includes(record.extraRarity) ||
      !Array.isArray(record.extraInventory) || record.extraInventory.length > 128 ||
      !Array.isArray(record.extraCandidates) || record.extraCandidates.length > 3 ||
      (record.extraReward !== null && typeof record.extraReward !== 'string') ||
      !integer(record.fallbackCoins) || ![0, THUNDER_CHALLENGE_FALLBACK_COINS].includes(record.fallbackCoins)) {
      throw new Error('Invalid thunder challenge record');
    }

    const position = (record.act - 1) * 11 + record.step;
    const coordinate = `${record.act}:${record.step}`;
    if (position <= previousPosition || seen.has(coordinate)) throw new Error('Invalid thunder challenge order');
    previousPosition = position;
    seen.add(coordinate);

    const enemy = contentEntity(content, record.enemyId);
    const expectedTier = record.nodeType === 'L' ? 'elite' : 'boss';
    if (!enemy || enemy.kind !== 'enemy' || enemy.tier !== expectedTier) {
      throw new Error('Invalid thunder challenge enemy');
    }
    if (record.act === state.act) {
      const recordedNode = state.nodes[record.step];
      if (!recordedNode || recordedNode.type !== record.nodeType || recordedNode.id !== record.enemyId) {
        throw new Error('Thunder challenge does not match the current route node');
      }
    }

    const normalIds = new Set<string>();
    for (const id of record.normalCandidates) {
      const artifact = typeof id === 'string' ? contentEntity(content, id) : undefined;
      if (!artifact || artifact.kind !== 'artifact' || !['rare', 'legendary'].includes(artifact.rarity) ||
        isFusionResult(content, id) || normalIds.has(id)) throw new Error('Invalid thunder normal reward candidates');
      normalIds.add(id);
    }
    if (record.normalReward !== null && !normalIds.has(record.normalReward)) {
      throw new Error('Thunder normal reward was not offered');
    }

    const inventoryIds = new Set<string>();
    const uniqueGroups = new Set<string>();
    for (const stack of record.extraInventory) {
      if (!isObject(stack) || typeof stack.id !== 'string' || !integer(stack.stacks) || stack.stacks <= 0 ||
        inventoryIds.has(stack.id)) throw new Error('Invalid thunder reward inventory snapshot');
      inventoryIds.add(stack.id);
      const artifact = contentEntity(content, stack.id);
      if (!artifact || artifact.kind !== 'artifact' ||
        stack.stacks > (integer(artifact.max_stacks) ? artifact.max_stacks : 1) ||
        (artifact.unique_group && uniqueGroups.has(artifact.unique_group))) {
        throw new Error('Invalid thunder reward inventory artifact');
      }
      if (artifact.unique_group) uniqueGroups.add(artifact.unique_group);
    }
    if (record.normalReward !== null && !inventoryIds.has(record.normalReward)) {
      throw new Error('Thunder primary reward is absent from its inventory snapshot');
    }

    const current = record.act === state.act && record.step === state.step;
    const entries = state.history.filter(entry => entry.act === record.act && entry.step === record.step);
    if (record.outcome === 'loss') {
      if (record.xpBonus !== 0 || record.normalCandidates.length || record.normalSettled ||
        record.normalReward !== null || record.extraRarity !== null || record.extraInventory.length ||
        record.extraCandidates.length || record.extraReward !== null || record.fallbackCoins !== 0 ||
        !current || state.phase !== 'lost' || state._thunderChallenge !== true ||
        state.battle?.outcome !== 'enemy' || state.battleInput?.enemy.thunderChallenge !== true || entries.length) {
        throw new Error('Invalid failed thunder challenge settlement');
      }
      continue;
    }

    const xpBonus = thunderChallengeXpBonus(content, record.act, record.nodeType);
    if (record.xpBonus !== xpBonus) throw new Error('Invalid thunder challenge XP bonus');
    if (!record.normalSettled) {
      if (record.normalReward !== null || record.extraRarity !== null || record.extraInventory.length ||
        record.extraCandidates.length || record.extraReward !== null || record.fallbackCoins !== 0 ||
        !current || !state._thunderChallenge || !['reward', 'lost'].includes(state.phase) ||
        state._thunderRewardStage !== 'normal' ||
        JSON.stringify(record.normalCandidates) !== JSON.stringify(state.rewardCandidates) || entries.length) {
        throw new Error('Invalid pending thunder normal reward');
      }
      continue;
    }

    const expectedBonus = rollThunderChallengeCandidates(
      content, state.seed, record.act, record.step, record.extraInventory, record.normalReward,
    );
    if (record.extraRarity !== expectedBonus.rarity ||
      JSON.stringify(record.extraCandidates) !== JSON.stringify(expectedBonus.candidates)) {
      throw new Error('Frozen thunder bonus candidates do not match their seed');
    }

    if (expectedBonus.candidates.length === 0) {
      const fallbackText = `雷劫加赏池已尽，改得${THUNDER_CHALLENGE_FALLBACK_COINS}灵石。`;
      const xpText = `雷劫应战：额外修为 +${record.xpBonus}。`;
      if (record.extraReward !== null || record.fallbackCoins !== THUNDER_CHALLENGE_FALLBACK_COINS ||
        !entries.length || entries.length !== 1 || entries[0]!.title !== enemy.name ||
        !entries[0]!.text.includes(xpText) || !entries[0]!.text.includes(fallbackText) ||
        (current && state._thunderRewardStage !== undefined)) {
        throw new Error('Invalid thunder challenge fallback history');
      }
      continue;
    }

    if (record.fallbackCoins !== 0 ||
      (record.extraReward !== null && (!record.extraCandidates.includes(record.extraReward) ||
        record.extraReward === record.normalReward))) {
      throw new Error('Invalid thunder bonus settlement');
    }
    if (record.extraReward === null) {
      if (!current || !state._thunderChallenge || !['reward', 'lost'].includes(state.phase) ||
        state._thunderRewardStage !== 'bonus' || entries.length ||
        JSON.stringify(record.extraCandidates) !== JSON.stringify(activeBonusCandidates) ||
        JSON.stringify(record.extraCandidates) !== JSON.stringify(state.rewardCandidates)) {
        throw new Error('Invalid pending thunder bonus choice');
      }
      continue;
    }

    const extraArtifact = contentEntity(content, record.extraReward);
    const xpText = `雷劫应战：额外修为 +${record.xpBonus}。`;
    const rewardText = `雷劫加赏：${extraArtifact?.name ?? record.extraReward}。`;
    if (entries.length !== 1 || entries[0]!.title !== enemy.name ||
      !entries[0]!.text.includes(xpText) || !entries[0]!.text.includes(rewardText) ||
      (current && state._thunderRewardStage !== undefined)) {
      throw new Error('Thunder challenge reward does not match completed history');
    }
  }

  const currentNode = state.nodes[state.step];
  if (state._thunderChallenge === true) {
    if (state.act < 1 || state.act > 4 || !currentNode || currentNode.completed ||
      !['L', 'B'].includes(currentNode.type) ||
      !['map', 'preview', 'battle', 'reward', 'lost'].includes(state.phase) ||
      (state.phase === 'preview' && state._previewKind !== 'node') ||
      (state.phase === 'battle' && state._battleKind !== 'node') ||
      (state.phase === 'reward' && state._thunderRewardStage !== 'normal' &&
        state._thunderRewardStage !== 'bonus')) {
      throw new Error('Invalid active thunder challenge intent');
    }
    if (state.battleInput && state._battleKind === 'node' &&
      state.battleInput.enemy.thunderChallenge !== true) {
      throw new Error('Active thunder challenge has no frozen enemy modifier');
    }
  } else if (state._thunderRewardStage !== undefined || activeBonusCandidates.length) {
    throw new Error('Thunder reward stage without active challenge');
  }

  if (state._thunderRewardStage === 'normal') {
    const record = records.find(candidate => candidate.act === state.act && candidate.step === state.step);
    if (!record || record.outcome !== 'win' || record.normalSettled || activeBonusCandidates.length) {
      throw new Error('Thunder normal reward stage does not match history');
    }
  } else if (state._thunderRewardStage === 'bonus') {
    const record = records.find(candidate => candidate.act === state.act && candidate.step === state.step);
    if (!record || record.outcome !== 'win' || !record.normalSettled || !record.extraCandidates.length ||
      record.extraReward !== null ||
      JSON.stringify(record.extraCandidates) !== JSON.stringify(activeBonusCandidates)) {
      throw new Error('Thunder bonus reward stage does not match history');
    }
  } else if (activeBonusCandidates.length) {
    throw new Error('Thunder candidates outside a reward stage');
  }

  if (state._thunderRewardFallback !== undefined &&
    (records.at(-1)?.fallbackCoins !== THUNDER_CHALLENGE_FALLBACK_COINS ||
      !records.at(-1) || records.at(-1)!.act > state.act ||
      (records.at(-1)!.act === state.act && records.at(-1)!.step >= state.step))) {
    throw new Error('Thunder fallback does not match challenge history');
  }
}

function rewardTypeForEnemyTier(tier: unknown): 'common' | 'elite' | 'boss' | undefined {
  if (tier === 'normal') return 'common';
  if (tier === 'elite') return 'elite';
  if (tier === 'boss') return 'boss';
  return undefined;
}

function worker(): ShanhaiCombatWorker {
  if (combatWorker) return combatWorker;
  return {
    calculateStats: combatCalculateStats,
    simulateBattle: combatSimulateBattle,
  };
}

function snapshotEntry(state: RunStateInternals): RunState['nodeEntry'] {
  return {
    method: state.method,
    talents: clone(state.talents[state.method] ?? []),
    artifacts: equippedArtifactStacks(state),
  };
}

function artifactCount(state: RunState, id: string): number {
  return state.artifacts.find(stack => stack.id === id)?.stacks ?? 0;
}

function artifactCapacity(content: Content, state: RunState, id: string, count: number): { ok: boolean; reason?: string } {
  if (!ARTIFACT_IDS.test(id)) return { ok: false, reason: `Unknown artifact: ${id}` };
  const artifact = artifactEntity(content, id);
  if (!integer(count) || count <= 0) return { ok: false, reason: 'Invalid artifact count' };
  const current = artifactCount(state, id);
  if (current + count > (integer(artifact.max_stacks) ? artifact.max_stacks : 1)) {
    return { ok: false, reason: `${id} capacity exhausted` };
  }
  if (artifact.unique_group) {
    const conflict = state.artifacts.find(stack => {
      if (stack.id === id || stack.stacks <= 0) return false;
      return contentEntity(content, stack.id)?.unique_group === artifact.unique_group;
    });
    if (conflict) return { ok: false, reason: `${artifact.unique_group} already occupied` };
  }
  return { ok: true };
}

function addArtifact(content: Content, state: RunState, id: string, count: number): void {
  const capacity = artifactCapacity(content, state, id, count);
  if (!capacity.ok) throw new Error(capacity.reason);
  const existing = state.artifacts.find(stack => stack.id === id);
  if (existing) existing.stacks += count;
  else state.artifacts.push({ id, stacks: count });
  autoEquipArtifact(content, state, id);
}

function removeArtifact(state: RunState, id: string, count: number): void {
  const existing = state.artifacts.find(stack => stack.id === id);
  if (!existing || existing.stacks < count) throw new Error(`Insufficient artifact: ${id}`);
  existing.stacks -= count;
  if (existing.stacks === 0) state.artifacts = state.artifacts.filter(stack => stack.id !== id);
  removeMissingEquipment(state);
}

function currentReferenceHp(content: Content, act: number): number {
  const values = rulesOf(content).economy?.reference_hp_by_act;
  return finite(values?.[Math.max(0, act - 1)]) ? values[Math.max(0, act - 1)] : baseStats(content, Math.min(4, act - 1)).max_hp;
}

function commonPrice(content: Content, act: number): number {
  const values = rulesOf(content).economy?.common_prices_by_act;
  return finite(values?.[Math.max(0, act - 1)]) ? values[Math.max(0, act - 1)] : 40;
}

function nextXpRequirement(content: Content, n: number): number {
  const values = rulesOf(content).cultivation?.requirements;
  return finite(values?.[Math.max(0, Math.min(3, n))]) ? values[Math.max(0, Math.min(3, n))] : 0;
}

function cumulativeXp(content: Content, n: number): number {
  const values = rulesOf(content).cultivation?.cumulative;
  return finite(values?.[Math.max(0, Math.min(3, n - 1))]) ? values[Math.max(0, Math.min(3, n - 1))] : 0;
}

function resourceAmount(content: Content, state: RunState, item: AnyRecord): number {
  if (!finite(item.amount) || item.amount < 0) throw new Error('Invalid resource amount');
  switch (item.basis) {
    case 'flat':
    case undefined:
      return item.amount;
    case 'common_price':
      return item.amount * commonPrice(content, state.act);
    case 'reference_hp':
      return item.amount * currentReferenceHp(content, state.act);
    case 'next_xp':
      return state.n >= 4 ? 0 : item.amount * nextXpRequirement(content, state.n);
    default:
      throw new Error(`Unknown resource basis: ${item.basis}`);
  }
}

function lookupNodeEntity(content: Content, node: RunNode): Entity | undefined {
  return contentEntity(content, node.id);
}

function methodTalents(content: Content, method: string): Entity[] {
  const entity = methodEntity(content, method);
  return Array.isArray(entity.talents) ? entity.talents.filter(isObject) as Entity[] : [];
}

function sharedTalents(content: Content): Entity[] {
  const insights = rulesOf(content).insights;
  return Array.isArray(insights) ? insights.filter(isObject) as Entity[] : [];
}

function sharedBuildParams(content: Content, id: string, kind: string): AnyRecord | undefined {
  const talent = sharedTalents(content).find(candidate => candidate.id === id);
  const effect = Array.isArray(talent?.effects)
    ? talent.effects.find((candidate: AnyRecord) => candidate?.params?.build === kind)
    : undefined;
  return isObject(effect?.params) ? effect.params : undefined;
}

function talentEntity(content: Content, method: string, id: string): Entity | undefined {
  return methodTalents(content, method).find(talent => talent.id === id) ??
    sharedTalents(content).find(talent => talent.id === id);
}

function talentTier(content: Content, method: string, id: string): number | undefined {
  return talentEntity(content, method, id)?.tier;
}

function talentDraftKey(method: string, tier: number, generation: number): string {
  return `${method}:${tier}:${generation}`;
}

function sample<T>(items: T[], count: number, random: () => number): T[] {
  const pool = items.slice();
  const result: T[] = [];
  while (pool.length && result.length < count) {
    result.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  }
  return result;
}

function unlockedTier(content: Content, state: RunState): number {
  const cumulative = rulesOf(content).cultivation?.cumulative;
  if (!Array.isArray(cumulative)) return Math.min(4, state.n);
  let result = 0;
  for (let tier = 1; tier <= 4; tier++) {
    if (finite(cumulative[tier - 1]) && state.xp >= cumulative[tier - 1]) result = tier;
  }
  return result;
}

function coreEventIds(content: Content, storyline: string | undefined): string[] {
  const line = storyline ? contentEntity(content, storyline) : undefined;
  return Array.isArray(line?.encounters) ? line.encounters.filter((id: unknown): id is string => typeof id === 'string') : [];
}

function eventOption(event: Entity, id: string): AnyRecord | undefined {
  return Array.isArray(event.options) ? event.options.find((option: AnyRecord) => option?.id === id) : undefined;
}

function optionCosts(option: AnyRecord): AnyRecord[] {
  return Array.isArray(option.costs) ? option.costs.filter(isObject) : [];
}

function optionRewards(option: AnyRecord): AnyRecord[] {
  return Array.isArray(option.rewards) ? option.rewards.filter(isObject) : [];
}

function eventEncounter(option: AnyRecord, eventId: string, content: Content): EventEncounter | undefined {
  if (!isObject(option.encounter)) return undefined;
  const enemyId = option.encounter.enemy_id;
  if (typeof enemyId !== 'string' || !contentEntity(content, enemyId)) throw new Error(`Unknown event encounter enemy: ${enemyId}`);
  return {
    eventId,
    optionId: option.id,
    enemyId,
    mode: typeof option.encounter.mode === 'string' ? option.encounter.mode : 'nonlethal',
    failureHpFloor: finite(option.encounter.failure_hp_floor) ? Math.max(1, option.encounter.failure_hp_floor) : 1,
    failureRewards: Array.isArray(option.encounter.failure_rewards) ? option.encounter.failure_rewards : [],
    failureOutcome: typeof option.encounter.failure_outcome === 'string' ? option.encounter.failure_outcome : undefined,
  };
}

function allFiniteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFiniteNumbers);
  if (isObject(value)) return Object.values(value).every(allFiniteNumbers);
  return true;
}

function validateSavedEventCheck(option: AnyRecord | undefined, result: unknown, outcome?: string): void {
  assertEventCheckResult(result);
  if (!option?.check || result.kind !== option.check.kind ||
    (result.kind === 'stat' &&
      (result.stat !== option.check.stat || result.threshold !== option.check.threshold)) ||
    outcome !== (result.success ? 'success' : 'failure')) throw new Error('Event check snapshot mismatch');
}

export class ShanhaiGame {
  readonly content: Content;
  state: RunState;

  constructor(content: Content, state: RunState) {
    this.content = normalizeContent(content);
    this.state = state;
    ensureStateInternals(this.content, this.state as RunStateInternals);
    if (this.state._routeMapVersion !== undefined && this.state._routeMapVersion !== 1) {
      throw new Error('Invalid route map version');
    }
    if (!this.state.routeMap) this.initializeRouteMap();
    else (this.state as RunStateInternals)._routeMapVersion ??= 1;
    validateRunState(this.content, this.state);
  }

  static create(
    content: Content,
    options: { seed: string; name: string; method: string },
  ): ShanhaiGame {
    content = normalizeContent(content);
    if (!isObject(options) || typeof options.seed !== 'string' || !options.seed) throw new Error('Seed is required');
    if (typeof options.name !== 'string') throw new Error('Name is required');
    const method = methodEntity(content, options.method);
    if (method.rarity !== 'common' || method.acquisition?.start !== true) {
      throw new Error('Only the five common start methods are available');
    }
    const rules = rulesOf(content);
    const initial = baseStats(content, 0);
    const state: RunStateInternals = {
      schema: 1,
      contentVersion: content.version,
      id: `shanhai-${hashSeed(`${options.seed}:${options.name}:${options.method}`).toString(16)}`,
      seed: options.seed,
      name: options.name.slice(0, 32) || '无名',
      phase: 'map',
      act: 1,
      step: 0,
      nodes: [],
      routes: [],
      method: options.method,
      ownedMethods: [options.method],
      talents: { [options.method]: [] },
      n: 0,
      hp: initial.max_hp,
      xp: 0,
      coins: finite(rules.economy?.initial_coins) ? rules.economy.initial_coins : 20,
      artifacts: [],
      equipment: { slots: [] },
      buildVersion: 5,
      rewardSearches: [],
      rewardRefinements: [],
      fusionProgress: fusionRecipes(content).map(recipe => ({ id: recipe.id, wins: [] })),
      fusionHistory: [],
      thunderChallenges: [],
      progress: { coinsSpent: 0, eliteWins: 0, bossWins: 0 },
      talentDraftGeneration: 0,
      talentDrafts: {},
      preparation: 0,
      flags: {},
      storyline: '',
      independentCore: null,
      history: [],
      seenEvents: [],
      completedCore: [],
      eventCommitments: [],
      extraElites: 0,
      ordinaryCount: 0,
      rewardCandidates: [],
      shop: [],
      resultText: '',
      firstStrike: 0,
      _routeHistory: [],
      _seenEnemyIds: [],
      _corePositions: [],
      _actEliteChallengeUsed: false,
      _thunderChallenge: false,
      _thunderRewardCandidates: [],
      _nodeEnemyByKey: {},
      _bossEnemyByAct: {},
      _travelSnapshots: [],
      _talentQueue: [],
      _consecutiveNodes: 0,
      _methodConsecutiveNodes: {},
      _pendingTravelResources: {},
      _pendingTravelResourceKinds: {},
    };
    const lines = contentEntities(content, 'storyline').filter(line => line.selection?.planned_per_run === 1);
    if (lines.length) {
      const pick = Math.floor(seededRandom(`${options.seed}:storyline`)() * lines.length);
      state.storyline = lines[Math.max(0, Math.min(lines.length - 1, pick))].id;
    }
    const independent = ['RK013', 'RK014', 'RK015', 'RK016'].filter(id => !!contentEntity(content, id));
    state.independentCore = seededRandom(`${options.seed}:independent-core`)() < 0.5
      ? independent[Math.floor(seededRandom(`${options.seed}:independent-core:value`)() * independent.length)] ?? null
      : null;
    state._plannedStoryline = state.storyline;
    state._independentCore = state.independentCore;
    return new ShanhaiGame(content, state);
  }

  get player(): Loadout {
    const state = this.state as RunStateInternals;
    const companion = state.ownedMethods.find(method => method !== state.method);
    return {
      name: state.name,
      method: state.method,
      ...(companion ? { companion } : {}),
      n: state.n,
      talents: clone(state.talents[state.method] ?? []),
      artifacts: equippedArtifactStacks(state),
      baseStats: baseStats(this.content, state.n),
      hp: state.hp,
      preparation: state.preparation,
      firstStrike: state.firstStrike,
      journey: journeyContext(state),
    };
  }

  equippedArtifacts(): ArtifactStack[] {
    return clone(equippedArtifactStacks(this.state));
  }

  fusionStatus(): FusionStatus[] {
    const state = this.state as RunStateInternals;
    return fusionRecipes(this.content).map(recipe => {
      const progress = state.fusionProgress.find(record => record.id === recipe.id);
      return {
        id: recipe.id,
        name: recipe.name,
        inputs: recipe.inputs.slice() as [string, string],
        wins: progress?.wins.length ?? 0,
        requiredWins: recipe.fights,
        complete: state.fusionHistory.some(record => record.id === recipe.id),
      };
    });
  }

  canChangeEquipment(): boolean {
    return ['map', 'reward', 'shop', 'rest', 'transition'].includes(this.state.phase);
  }

  canChallengeElite(): boolean {
    const state = this.state as RunStateInternals;
    const node = this.node;
    if (this.state.phase !== 'preview' || state._previewKind !== 'node' ||
      node?.type !== 'C' || state._actEliteChallengeUsed === true ||
      !hasTalent(this.state, 'V2-J1-B')) return false;
    const candidates = this.actContent.pools?.enemies?.elite_candidates;
    return Array.isArray(candidates) && candidates.some((id: unknown) =>
      typeof id === 'string' && contentEntity(this.content, id)?.kind === 'enemy' &&
      contentEntity(this.content, id)?.tier === 'elite');
  }

  canThunderChallenge(): boolean {
    const state = this.state as RunStateInternals;
    const node = this.node;
    if (this.state.phase !== 'preview' || state._previewKind !== 'node' ||
      state._pendingEvent !== undefined || state._challengeEliteEnemyId !== undefined ||
      state._battleKind !== undefined || state._battleSettled === true ||
      this.state.act < 1 || this.state.act > 4 || !node || !['L', 'B'].includes(node.type)) {
      return false;
    }
    const enemy = contentEntity(this.content, node.id);
    return enemy?.kind === 'enemy' && enemy.tier === (node.type === 'L' ? 'elite' : 'boss');
  }

  get stats(): Stats {
    const result = worker().calculateStats(this.content, this.player);
    if (!isObject(result) || !['attack', 'defense', 'max_hp', 'crit_rate', 'speed']
      .every(key => finite(result[key as keyof Stats]))) {
      throw new Error('Combat worker returned invalid stats');
    }
    return {
      attack: result.attack,
      defense: result.defense,
      max_hp: result.max_hp,
      crit_rate: result.crit_rate,
      speed: result.speed,
    };
  }

  get actContent(): Entity {
    const entity = actEntity(this.content, this.state.act);
    if (!entity) throw new Error(`Unknown act: ${this.state.act}`);
    return entity;
  }

  private createRouteMap(): RouteMapNode[] {
    const act = this.state.act;
    const coreSlots = new Map<number, string>();
    if (act === 1) {
      const coreOptions = ACT1_CORE_DEPTHS.flatMap(depth =>
        this.coreCandidatesAt(depth).map(id => ({ depth, id })));
      if (coreOptions.length) {
        const pick = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:core-slot`)() * coreOptions.length);
        const selected = coreOptions[pick] ?? coreOptions[0]!;
        const lane = Math.floor(seededRandom(
          `${this.state.seed}:route-map:${act}:core-lane:${selected.depth}`,
        )() * 3);
        coreSlots.set(selected.depth * 3 + lane, selected.id);
      }
    } else {
      for (const depth of ACT1_CORE_DEPTHS) {
        const candidates = this.coreCandidatesAt(depth);
        if (!candidates.length) continue;
        const lane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:core-lane:${depth}`)() * 3);
        const pick = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:core-id:${depth}`)() * candidates.length);
        coreSlots.set(depth * 3 + lane, candidates[pick] ?? candidates[0]!);
      }
    }
    const functionLayout = routeLayoutForAct(this.actContent, this.state.seed);
    const restLane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:rest-lane`)() * 3);
    const shopLane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:shop-lane`)() * 3);
    const eliteLane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:elite-lane`)() * 3);
    const earlyEliteLane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:early-elite-lane`)() * 3);
    const eliteLimit = this.maxElitesPerAct();
    const actElites = (this.state as RunStateInternals)._actEliteCount ?? 0;
    const generatedCombatEnemies = new Map<string, string>();
    const freezeRouteEnemy = (type: RunNode['type'], depth: number, lane: number, key: string): string => {
      const parentDepth = depth - 1;
      const parentLanes = parentDepth === 0 || parentDepth === 3 || parentDepth === 6
        ? [0, 1, 2]
        : parentDepth < 0 ? [] : [lane];
      const directParentEnemies = new Set(parentLanes.flatMap(parentLane => {
        const parentKey = `a${act}-d${parentDepth}-l${parentLane}`;
        const enemyId = generatedCombatEnemies.get(parentKey);
        return enemyId ? [enemyId] : [];
      }));
      const enemyId = this.freezeEnemy(type, depth, key, directParentEnemies);
      generatedCombatEnemies.set(key, enemyId);
      return enemyId;
    };
    const hasElite = act < 5 &&
      actElites < eliteLimit &&
      (actElites === 0 || this.state.extraElites < this.maxExtraElites());
    const hasEarlyElite = functionLayout.extraEliteDepth !== null && hasElite && actElites === 0 &&
      eliteLimit > 1 && this.state.extraElites < this.maxExtraElites();
    const nodes = createRouteMapNodes(act, (depth, lane, key) => {
      if (act === 5) {
        return { type: 'F', id: freezeRouteEnemy('F', depth, lane, key), completed: false, label: '终战' };
      }
      if (depth === 10) {
        const id = freezeRouteEnemy('B', depth, lane, key);
        return { type: 'B', id, completed: false, label: '首领', description: contentEntity(this.content, id)?.name };
      }
      let type: RunNode['type'] = 'C';
      if ((ACT1_CORE_DEPTHS as readonly number[]).includes(depth)) type = 'E';
      if ((ACT1_CORE_DEPTHS as readonly number[]).includes(depth)) {
        const coreId = coreSlots.get(depth * 3 + lane);
        if (coreId) type = 'K';
        const id = coreId ?? this.selectOrdinaryEvent(depth, key);
        return {
          type,
          id,
          completed: false,
          label: type === 'K' ? '机缘' : '事件',
          description: contentEntity(this.content, id)?.name,
        };
      }
      const restDepth = functionLayout.restDepth;
      const shopDepth = functionLayout.shopDepth;
      if (depth === restDepth && lane === restLane) {
        return { type: 'R', id: `R-A${act}-${key}`, completed: false, label: '休整', description: functionLayout.label };
      }
      if (depth === shopDepth && lane === shopLane) {
        return { type: 'S', id: `SHOP-A${act}-${key}`, completed: false, label: '坊市', description: functionLayout.label };
      }
      if (functionLayout?.extraEliteDepth === depth && lane === earlyEliteLane && hasEarlyElite) type = 'L';
      if (depth === 9 && hasElite && lane === eliteLane) type = 'L';
      if (type === 'C' || type === 'L') {
        const id = freezeRouteEnemy(type, depth, lane, key);
        return {
          type,
          id,
          completed: false,
          label: type === 'L' ? '精英' : '普通战',
          description: contentEntity(this.content, id)?.name,
        };
      }
      if (type === 'E') {
        const id = this.selectOrdinaryEvent(depth, key);
        return { type, id, completed: false, label: '事件', description: contentEntity(this.content, id)?.name };
      }
      if (type === 'F') {
        const id = freezeRouteEnemy(type, depth, lane, key);
        return { type, id, completed: false, label: '终战', description: contentEntity(this.content, id)?.name };
      }
      throw new Error(`Unsupported route map node at ${key}`);
    });

    return nodes;
  }

  private maxExtraElites(): number {
    const rules = rulesOf(this.content);
    const filter = rules.adventure?.filters ?? rules.run_selection?.filters ?? this.actContent.run_selection?.filters ?? {};
    return integer(filter.global_extra_elite_max) ? filter.global_extra_elite_max :
      integer(rules.adventure?.max_extra_elites_per_run) ? rules.adventure.max_extra_elites_per_run : 3;
  }

  private maxElitesPerAct(): number {
    const rules = rulesOf(this.content);
    const filter = rules.adventure?.filters ?? rules.run_selection?.filters ?? this.actContent.run_selection?.filters ?? {};
    const extra = integer(filter.per_act_extra_elite_max) ? filter.per_act_extra_elite_max :
      integer(rules.adventure?.max_extra_elites_per_act) ? rules.adventure.max_extra_elites_per_act : 1;
    return Math.min(2, 1 + extra);
  }

  private coreCandidatesAt(depth: number): string[] {
    const state = this.state as RunStateInternals;
    const candidates = routeTemplates(this.content, this.state.act)
      .flatMap(route => (this.state.act === 1 ? route.nodes : [route.nodes[depth]]).flatMap(source => {
        if (!isObject(source) || source.type !== 'K') return [];
        return Array.isArray(source.candidate_ids)
          ? source.candidate_ids.filter((id: unknown): id is string => typeof id === 'string')
          : typeof source.id === 'string' ? [source.id] : [];
      }));
    const [firstLine, secondLine] = coreEventIds(this.content, state._plannedStoryline);
    const eligible = [...new Set(candidates)].filter(id => {
      const event = contentEntity(this.content, id);
      if (!event || event.kind !== 'event' || event.event_type !== 'core' || !event.acts?.includes(this.state.act)) return false;
      if (id === secondLine && !this.followUpCoreUnlocked(firstLine, secondLine)) return false;
      if (id !== firstLine && id !== secondLine && id !== state._independentCore) return false;
      if (id === state._independentCore && state.completedCore?.includes(id)) return false;
      return this.coreCanBeClaimed(id, depth);
    });
    return eligible;
  }

  private coreCanBeClaimed(id: string, depth: number): boolean {
    const state = this.state as RunStateInternals;
    if ((state._actCoreCount ?? 0) >= 1 || (state._coreCount ?? 0) >= 3) return false;
    const position = (this.state.act - 1) * 11 + depth;
    const lastPosition = state._corePositions?.at(-1);
    return lastPosition === undefined || position - lastPosition >= 3;
  }

  private nodeCanBeEntered(node: RouteMapNode): boolean {
    if (node.type === 'K' && (!this.coreCanBeClaimed(node.id, node.depth) ||
      !this.coreCandidatesAt(node.depth).includes(node.id))) return false;
    if (node.type === 'L') {
      const state = this.state as RunStateInternals;
      const actElites = state._actEliteCount ?? 0;
      return actElites < this.maxElitesPerAct() &&
        (actElites === 0 || this.state.extraElites < this.maxExtraElites());
    }
    return true;
  }

  private initializeRouteMap(): void {
    const state = this.state as RunStateInternals;
    if (state._routeMapVersion !== undefined || state.phase !== 'map' ||
      state.act !== 1 || state.step !== 0 || state.nodes.length || state.routes.length ||
      state.history.length || state._routeMapLegacy) {
      throw new Error('Invalid route map: V2 does not migrate legacy routes');
    }
    state.routeMap = { nodes: this.createRouteMap(), path: [] };
    state._routeMapVersion = 1;
    state._routeMapLegacy = false;
  }

  get node(): RunNode | undefined {
    return this.state.nodes[this.state.step];
  }

  availableRoutes(): AnyRecord[] {
    return [];
  }

  availableNodes(): RouteMapNode[] {
    const state = this.state as RunStateInternals;
    const map = state.routeMap;
    if (this.state.phase !== 'map' || !map) return [];

    const active = this.state.nodes[this.state.step];
    if (active && !active.completed) {
      const key = map.path[this.state.step];
      const current = map.nodes.find(candidate => candidate.key === key);
      return current ? [clone(current)] : [];
    }

    const keys = map.path.length
      ? map.nodes.find(candidate => candidate.key === map.path.at(-1))?.next ?? []
      : map.nodes.filter(candidate => candidate.depth === 0).map(candidate => candidate.key);
    return keys
      .map(key => map.nodes.find(candidate => candidate.key === key))
      .filter((node): node is RouteMapNode => !!node && this.nodeCanBeEntered(node))
      .map(clone);
  }

  availableTalents(): Entity[] {
    const state = this.state as RunStateInternals;
    this.ensureTalentQueue(false);
    const item = state._talentQueue?.[0];
    if (!item) return [];
    const key = talentDraftKey(item.method, item.tier, state.talentDraftGeneration);
    return (state.talentDrafts[key] ?? []).flatMap(id => {
      const talent = talentEntity(this.content, item.method, id);
      return talent ? [talent] : [];
    });
  }

  optionAvailability(option: any): { available: boolean; reason: string } {
    try {
      if (this.state.phase !== 'event') return { available: false, reason: 'not-event-phase' };
      const eventId = this.node?.id;
      if (!eventId) return { available: false, reason: 'no-event' };
      const event = eventEntity(this.content, eventId);
      const target = typeof option === 'string' ? eventOption(event, option) : option;
      if (!target || typeof target.id !== 'string') return { available: false, reason: 'unknown-option' };
      return this.checkOption(event, target);
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  dispatch(command: RunCommand): void {
    const before = clone(this.state);
    try {
      if (!isObject(command) || typeof command.type !== 'string') throw new Error('Unknown command');
      switch (command.type) {
        case 'route':
          throw new Error('Whole-act routes are no longer selectable');
        case 'enter':
          this.enterNode(command.id);
          break;
        case 'back':
          this.back();
          break;
        case 'fight':
          this.fight();
          break;
        case 'challenge_elite':
          this.challengeElite();
          break;
        case 'thunder_challenge':
          if (Object.keys(command).length !== 2 || typeof command.enabled !== 'boolean') {
            throw new Error('Invalid thunder challenge command');
          }
          this.setThunderChallenge(command.enabled);
          break;
        case 'battle_done':
          this.battleDone();
          break;
        case 'continue_battle':
          this.continueBattle();
          break;
        case 'reward':
          this.chooseReward(command.id);
          break;
        case 'seek_reward':
          this.seekReward(command.family);
          break;
        case 'refine_reward':
          this.refineReward(command.source, command.target);
          break;
        case 'event':
          this.chooseEvent(command.id);
          break;
        case 'continue':
          this.continuePhase();
          break;
        case 'buy':
          this.buy(command.id);
          break;
        case 'reforge':
          this.reforge(command.source, command.target);
          break;
        case 'leave_shop':
          this.leaveShop();
          break;
        case 'rest':
          this.rest(command.choice, command.method, command.artifact);
          break;
        case 'talent':
          this.chooseTalent(command.id);
          break;
        case 'equip':
          this.equipArtifact(command.id, command.replace);
          break;
        case 'unequip':
          this.unequipArtifact(command.id);
          break;
        case 'reorder_equipment':
          if (Object.keys(command).length !== 3) throw new Error('Invalid equipment reorder command');
          this.reorderEquipment(command.id, command.direction);
          break;
        case 'retire':
          this.retire();
          break;
        default:
          throw new Error(`Unknown command: ${(command as AnyRecord).type}`);
      }
    } catch (error) {
      restore(this.state, before);
      throw error;
    }
  }

  private equipArtifact(id: string, replace?: string): void {
    if (!this.canChangeEquipment()) throw new Error('Equipment cannot change now');
    if (typeof id !== 'string') throw new Error('Invalid artifact ID');
    if (replace !== undefined && typeof replace !== 'string') throw new Error('Invalid replacement artifact ID');
    if (!this.state.artifacts.some(stack => stack.id === id && stack.stacks > 0)) {
      throw new Error(`Artifact is not owned: ${id}`);
    }
    if (!artifactRole(this.content, id)) throw new Error(`Unknown artifact: ${id}`);
    if (this.state.equipment.slots.includes(id)) {
      throw new Error('Artifact is already equipped');
    }

    if (replace !== undefined) {
      const index = this.state.equipment.slots.indexOf(replace);
      if (index < 0) throw new Error('Replacement artifact is not equipped');
      this.state.equipment.slots[index] = id;
    } else {
      if (this.state.equipment.slots.length >= MAX_EQUIPMENT_SLOTS) throw new Error('Equipment slots are full');
      this.state.equipment.slots.push(id);
    }
    this.state.hp = Math.min(this.state.hp, this.stats.max_hp);
  }

  private challengeElite(): void {
    if (!this.canChallengeElite()) throw new Error('Elite challenge is unavailable');
    const state = this.state as RunStateInternals;
    const key = state.routeMap?.path[this.state.step] ?? `a${this.state.act}-d${this.state.step}`;
    const depth = state.routeMap?.nodes.find(candidate => candidate.key === key)?.depth ?? this.state.step;
    const enemyId = this.freezeEnemy('L', depth, `${key}:hunter-challenge`);
    state._actEliteChallengeUsed = true;
    state._challengeEliteEnemyId = enemyId;
    state._battleRewardType = 'elite';
    state._seenEnemyIds ??= [];
    state._seenEnemyIds.push(enemyId);
    state._lastEnemyId = enemyId;
  }

  private setThunderChallenge(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('Invalid thunder challenge command');
    if (!this.canThunderChallenge()) throw new Error('Thunder challenge is unavailable');
    (this.state as RunStateInternals)._thunderChallenge = enabled;
  }

  private freezeTalentDraft(item: CoreQueueItem): void {
    const state = this.state as RunStateInternals;
    const key = talentDraftKey(item.method, item.tier, state.talentDraftGeneration);
    if (state.talentDrafts[key]) return;
    const local = methodTalents(this.content, item.method)
      .filter(talent => talent.tier === item.tier);
    const shared = sharedTalents(this.content)
      .filter(talent => talent.tier === item.tier);
    const isFirstBreakthrough = item.tier === 1;
    if ((isFirstBreakthrough && shared.length < 3) ||
      (!isFirstBreakthrough && (local.length < 1 || shared.length < 2))) {
      throw new Error(`Talent draft pool is incomplete for ${item.method} tier ${item.tier}`);
    }
    if (isFirstBreakthrough) {
      state.talentDrafts[key] = sample(
        shared,
        3,
        seededRandom(`${state.seed}:talent-draft:${key}:shared`),
      ).map(talent => talent.id);
    } else {
      const localIds = sample(
        local,
        1,
        seededRandom(`${state.seed}:talent-draft:${key}:local`),
      ).map(talent => talent.id);
      const sharedIds = sample(
        shared,
        2,
        seededRandom(`${state.seed}:talent-draft:${key}:shared`),
      ).map(talent => talent.id);
      state.talentDrafts[key] = [...localIds, ...sharedIds];
    }
  }

  private unequipArtifact(id: string): void {
    if (!this.canChangeEquipment()) throw new Error('Equipment cannot change now');
    if (typeof id !== 'string') throw new Error('Invalid artifact ID');
    const index = this.state.equipment.slots.indexOf(id);
    if (index < 0) throw new Error('Artifact is not equipped');
    this.state.equipment.slots.splice(index, 1);
    this.state.hp = Math.min(this.state.hp, this.stats.max_hp);
  }

  private reorderEquipment(id: string, direction: 'left' | 'right'): void {
    if (!this.canChangeEquipment()) throw new Error('Equipment cannot change now');
    if (typeof id !== 'string') throw new Error('Invalid artifact ID');
    if (direction !== 'left' && direction !== 'right') throw new Error('Invalid equipment direction');
    if (!this.state.artifacts.some(stack => stack.id === id && stack.stacks > 0)) {
      throw new Error(`Artifact is not owned: ${id}`);
    }

    const slots = this.state.equipment.slots;
    const index = slots.indexOf(id);
    if (index < 0) throw new Error('Artifact is not equipped');
    const adjacentIndex = index + (direction === 'left' ? -1 : 1);
    if (adjacentIndex < 0 || adjacentIndex >= slots.length) {
      throw new Error('Equipment cannot move beyond the edge');
    }
    if (typeof slots[adjacentIndex] !== 'string') throw new Error('Adjacent equipment slot is empty');
    [slots[index], slots[adjacentIndex]] = [slots[adjacentIndex]!, slots[index]!];
  }

  private freezeEnemy(
    type: RunNode['type'],
    index: number,
    key: string,
    directParentEnemies: ReadonlySet<string> = new Set(),
  ): string {
    const state = this.state as RunStateInternals;
    const act = this.state.act;
    const actContent = actEntity(this.content, act);
    const pools = actContent?.pools?.enemies ?? {};
    let candidates: string[] = type === 'C'
      ? pools.common_candidates
      : type === 'L'
        ? pools.elite_candidates
        : type === 'B'
          ? pools.boss_candidates
          : pools.final_candidates;
    if (!Array.isArray(candidates) || !candidates.length) {
      candidates = type === 'F' ? ['EN-F1', 'EN-F2'] : [];
    }
    candidates = candidates.filter(id => typeof id === 'string' && !!contentEntity(this.content, id));
    if (!candidates.length) throw new Error(`No ${type} enemy pool for act ${act}`);
    if (type === 'B' || type === 'F') {
      const stored = type === 'B' ? state._bossEnemyByAct?.[String(act)] : state._nodeEnemyByKey?.[`final:${index}`];
      if (stored && candidates.includes(stored)) return stored;
    }
    const used = new Set(state._seenEnemyIds ?? []);
    const unseen = candidates.filter(id => !used.has(id));
    const pool = unseen.length ? unseen : candidates;
    const distinctFromParents = (source: string[]) =>
      source.filter(id => !directParentEnemies.has(id));
    const drawPool = distinctFromParents(pool).length
      ? distinctFromParents(pool)
      : distinctFromParents(candidates).length
        ? distinctFromParents(candidates)
        : pool;
    const random = seededRandom(`${this.state.seed}:enemy:${key}`);
    let selected = drawPool[Math.floor(random() * drawPool.length)] ?? drawPool[0];
    if (selected === state._lastEnemyId && drawPool.length > 1) {
      selected = drawPool[(drawPool.indexOf(selected) + 1) % drawPool.length];
    }
    return selected;
  }

  private selectOrdinaryEvent(index: number, displayId?: string): string {
    const actContent = actEntity(this.content, this.state.act);
    const pool = Array.isArray(actContent?.pools?.events?.ordinary)
      ? actContent.pools.events.ordinary.filter((id: unknown): id is string => typeof id === 'string')
      : contentEntities(this.content, 'event')
        .filter(event => event.event_type === 'ordinary' && event.acts?.includes(this.state.act))
        .map(event => event.id);
    if (!pool.length) throw new Error(`No ordinary event pool for act ${this.state.act}`);
    const unseen = pool.filter((id: string) => !this.state.seenEvents.includes(id));
    const choices = unseen.length ? unseen : pool;
    const random = seededRandom(`${this.state.seed}:ordinary:${this.state.act}:${index}:${displayId ?? ''}`);
    return choices[Math.floor(random() * choices.length)] ?? choices[0];
  }

  private claimCore(node: RouteMapNode): void {
    const state = this.state as RunStateInternals;
    if (node.type !== 'K' || !this.nodeCanBeEntered(node)) throw new Error('Core node is no longer available');
    const position = (this.state.act - 1) * 11 + node.depth;
    state._actCoreCount = (state._actCoreCount ?? 0) + 1;
    state._coreCount = (state._coreCount ?? 0) + 1;
    state._lastCorePosition = node.depth;
    state._corePositions ??= [];
    state._corePositions.push(position);
  }

  private followUpCoreUnlocked(firstId: string | undefined, _secondId: string | undefined): boolean {
    const state = this.state as RunStateInternals;
    if (!firstId || !state.completedCore?.includes(firstId)) return false;
    const first = contentEntity(this.content, firstId);
    const unlockFlags = (Array.isArray(first?.options) ? first.options : [])
      .flatMap((option: AnyRecord) => isObject(option?.set_flags)
        ? Object.entries(option.set_flags)
          .filter(([, value]) => value === true)
          .map(([id]) => id)
        : []);
    // Some authored first encounters intentionally use no persistent flag.
    // Completion is then the contract; otherwise use the exact flags authored
    // by the encounter instead of deriving a "-promised" name.
    return unlockFlags.length === 0 || unlockFlags.some(id => state.flags[id] === true);
  }

  private enterNode(id?: string): void {
    if (this.state.phase !== 'map') throw new Error('No map node can be entered');
    const state = this.state as RunStateInternals;
    const routeMap = state.routeMap;
    if (!routeMap) throw new Error('No route map');
    const reachable = this.availableNodes();
    if (!reachable.length) throw new Error('No reachable route map node');
    const target = id === undefined
      ? reachable.length === 1 ? reachable[0] : undefined
      : reachable.find(candidate => candidate.key === id);
    if (!target) {
      if (id === undefined) throw new Error('A route map node ID is required');
      throw new Error(`Route map node is not reachable: ${id}`);
    }

    let node = this.state.nodes[this.state.step];
    const reentry = !!node && !node.completed;
    if (reentry) {
      if (routeMap.path[this.state.step] !== target.key || node!.type !== target.type || node!.id !== target.id) {
        throw new Error('A selected route map node must be resumed before advancing');
      }
    } else {
      if (target.depth !== this.state.step) throw new Error('Route map node is not on the next layer');
      if (target.type === 'K') this.claimCore(target);
      if (target.type === 'L') {
        if (!this.nodeCanBeEntered(target)) throw new Error('Elite node is no longer available');
        state._actEliteCount = (state._actEliteCount ?? 0) + 1;
        if (state._actEliteCount > 1) this.state.extraElites += 1;
      }
      if (target.type === 'C' || target.type === 'E') this.state.ordinaryCount += 1;
      if (['C', 'L', 'B', 'F'].includes(target.type)) {
        state._seenEnemyIds ??= [];
        state._seenEnemyIds.push(target.id);
        state._lastEnemyId = target.id;
        if (target.type === 'B') {
          state._bossEnemyByAct ??= {};
          state._bossEnemyByAct[String(this.state.act)] = target.id;
        } else if (target.type === 'F') {
          state._nodeEnemyByKey ??= {};
          state._nodeEnemyByKey.final = target.id;
        }
      }
      node = { type: target.type, id: target.id, completed: false };
      this.state.nodes.push(node);
      routeMap.path.push(target.key);
      this.state.step = this.state.nodes.length - 1;
    }

    const firstEntry = !state._nodeEntry && !this.state.nodeEntry;
    if (firstEntry) {
      state._nodeEntry = snapshotEntry(state);
      this.state.nodeEntry = clone(state._nodeEntry);
      this.state.rewardCandidates = [];
      state._thunderChallenge = false;
      state._thunderRewardStage = undefined;
      state._thunderRewardCandidates = [];
      state._thunderRewardFallback = undefined;
      state._battleSettled = false;
      state._eventSettled = false;
      state._previewKind = undefined;
      state._eventCostTravelApplied = false;
      state._eventOutcome = undefined;
      this.state.eventCheck = undefined;
      this.state.eventStoryEcho = undefined;
      if (node.type === 'S') state._shopReforged = false;
      this.state.eventOption = undefined;
      this.state.resultText = '';
      this.advanceCommitments('entered');
    }
    if (['C', 'L', 'B', 'F'].includes(node.type)) {
      state._previewKind = 'node';
      this.state.phase = 'preview';
      return;
    }
    if (node.type === 'E' || node.type === 'K') {
      const event = eventEntity(this.content, node.id);
      if (!this.state.seenEvents.includes(event.id)) this.state.seenEvents.push(event.id);
      this.state.eventOption = undefined;
      this.state.resultText = '';
      this.state.phase = 'event';
      return;
    }
    if (node.type === 'S') {
      if (!this.state.shop.length) this.generateShop();
      this.state.phase = 'shop';
      return;
    }
    if (node.type === 'R') {
      this.state.phase = 'rest';
      return;
    }
    throw new Error(`Unsupported node type: ${node.type}`);
  }

  private back(): void {
    if (!['preview', 'event', 'shop', 'rest'].includes(this.state.phase)) throw new Error('Cannot go back now');
    if (this.state.phase === 'rest' && (this.state as RunStateInternals)._restFromEvent) {
      throw new Error('Committed method swap cannot be cancelled');
    }
    if (this.state.phase === 'preview' && (this.state as RunStateInternals)._pendingEvent) {
      throw new Error('Committed event encounters cannot be cancelled');
    }
    if (this.state.phase === 'event') {
      this.state.eventOption = undefined;
      this.state._eventSettled = false;
      (this.state as RunStateInternals)._previewKind = undefined;
    }
    if (this.state.phase === 'preview') {
      (this.state as RunStateInternals)._previewKind = undefined;
    }
    this.state.phase = 'map';
  }

  private buildEnemy(enemyId: string): Loadout {
    const enemy = contentEntity(this.content, enemyId);
    if (!enemy || enemy.kind !== 'enemy') throw new Error(`Unknown enemy: ${enemyId}`);
    if (!METHOD_IDS.test(enemy.method) || !contentEntity(this.content, enemy.method)) throw new Error(`Enemy has invalid method: ${enemy.method}`);
    return {
      name: enemy.name,
      method: enemy.method,
      n: integer(enemy.n) ? enemy.n : 0,
      talents: Array.isArray(enemy.talents) ? clone(enemy.talents) : [],
      artifacts: Array.isArray(enemy.artifacts) ? clone(enemy.artifacts) : [],
      baseStats: clone(enemy.stats),
      preparation: 0,
      ...(isObject(enemy.trial) ? { encounterId: enemy.id } : {}),
    };
  }

  private freezeFusionBattleEntry(kind: 'node' | 'event', enemyId: string): FusionBattleEntry {
    const inventory = clone(this.state.artifacts);
    return {
      act: this.state.act,
      step: this.state.step,
      kind,
      enemyId,
      inventory,
      eligibleRecipes: fusionRecipes(this.content)
        .filter(recipe => inventoryHasInputs(inventory, recipe))
        .map(recipe => recipe.id),
    };
  }

  private settleFusionVictory(entry: FusionBattleEntry): void {
    const state = this.state as RunStateInternals;
    const settlementInventory = entry.settlementInventory;
    if (!settlementInventory) throw new Error('Fusion victory is missing its settlement inventory');

    const projected = clone(this.state) as RunState;
    const accepted: Array<{ recipe: FusionRecipe; win: FusionWinRecord; completes: boolean }> = [];
    const recipes = fusionRecipes(this.content);
    for (const recipe of recipes) {
      if (!entry.eligibleRecipes.includes(recipe.id) ||
        !inventoryHasInputs(settlementInventory, recipe)) continue;
      const progress = state.fusionProgress.find(record => record.id === recipe.id);
      if (!progress) throw new Error(`Missing fusion progress: ${recipe.id}`);
      if (progress.wins.length >= recipe.fights) continue;
      if (progress.wins.some(win => win.act === entry.act && win.step === entry.step)) {
        throw new Error(`Fusion battle already counted: ${recipe.id}`);
      }

      const completes = progress.wins.length + 1 >= recipe.fights;
      if (completes) {
        const candidate = clone(projected) as RunState;
        if (recipe.inputs.some(id => artifactCount(candidate, id) < 1)) continue;
        recipe.inputs.forEach(id => removeArtifact(candidate, id, 1));
        if (!artifactCapacity(this.content, candidate, recipe.id, 1).ok) continue;
        addArtifact(this.content, candidate, recipe.id, 1);
        projected.artifacts = candidate.artifacts;
        projected.equipment = candidate.equipment;
      }

      accepted.push({
        recipe,
        completes,
        win: {
          act: entry.act,
          step: entry.step,
          kind: entry.kind,
          enemyId: entry.enemyId,
          entryInventory: clone(entry.inventory),
          settlementInventory: clone(settlementInventory),
        },
      });
    }

    if (!accepted.length) return;
    if (accepted.some(item => item.completes)) {
      this.state.artifacts = projected.artifacts;
      this.state.equipment = projected.equipment;
      // Equipment removal can lower max HP; fusion never grants healing.
      this.state.hp = Math.min(this.state.hp, this.stats.max_hp);
    }
    for (const item of accepted) {
      const progress = state.fusionProgress.find(record => record.id === item.recipe.id)!;
      progress.wins.push(item.win);
      if (!item.completes) continue;
      const text = fusionCompletionText(this.content, item.recipe);
      const history: FusionHistoryRecord = {
        id: item.recipe.id,
        act: entry.act,
        step: entry.step,
        title: item.recipe.name,
        text,
      };
      state.fusionHistory.push(history);
      this.state.resultText = `${this.state.resultText} ${text}`.trim();
    }
  }

  private fight(): void {
    if (this.state.phase !== 'preview') throw new Error('Fight is not available now');
    const node = this.node;
    if (!node) throw new Error('No node');
    const state = this.state as RunStateInternals;
    const enemyId = state._previewKind === 'event'
      ? state._pendingEvent?.enemyId
      : state._challengeEliteEnemyId ?? node.id;
    if (!enemyId) throw new Error('No frozen enemy');
    const enemy = this.buildEnemy(enemyId);
    if (state._thunderChallenge === true) {
      if (!this.canThunderChallenge()) throw new Error('Thunder challenge is unavailable');
      const challengeStats = clone(enemy.baseStats);
      if (!isObject(challengeStats) || !finite(challengeStats.max_hp)) {
        throw new Error('Enemy base stats are invalid for the thunder challenge');
      }
      challengeStats.max_hp *= 1.25;
      enemy.baseStats = challengeStats;
      enemy.thunderChallenge = true;
    }
    const input: RunState['battleInput'] = {
      player: clone(this.player),
      enemy,
      seed: `${this.state.seed}:battle:${this.state.act}:${this.state.step}:${state._previewKind ?? 'node'}`,
      roundLimit: 256,
      rules: 'awakening-v1',
    };
    // Preparation is a one-battle input.  It is consumed at battle start and
    // therefore is not replayed by `continue_battle`.
    this.state.preparation = 0;
    this.state.firstStrike = 0;
    const result = worker().simulateBattle(this.content, input.player, input.enemy, input.seed, {
      roundLimit: input.roundLimit, artifactAwakenings: input.rules === 'awakening-v1',
    });
    validateBattleResult(result);
    validateBattleCuesAgainstInput(result, input);
    this.state.battleInput = input;
    this.state.battle = clone(result);
    this.state.phase = 'battle';
    state._battleKind = state._previewKind === 'event' ? 'event' : 'node';
    state._fusionBattleEntry = this.freezeFusionBattleEntry(state._battleKind, enemyId);
    state._battleNodeType = node.type;
    state._battleRewardType = state._previewKind === 'event'
      ? undefined
      : state._challengeEliteEnemyId ? 'elite' : battleRewardType(node.type);
  }

  private continueBattle(): void {
    if (this.state.phase !== 'battle' || !this.state.battleInput || !this.state.battle) throw new Error('No battle can be continued');
    if (this.state.battle.outcome !== 'draw') throw new Error('Only a drawn battle can continue');
    const input = this.state.battleInput;
    if (input.roundLimit >= 4096) {
      throw new Error('Battle reached the maximum 4096-round horizon; retire the run explicitly');
    }
    input.roundLimit = Math.min(4096, input.roundLimit * 2);
    const result = worker().simulateBattle(this.content, input.player, input.enemy, input.seed, {
      roundLimit: input.roundLimit, artifactAwakenings: input.rules === 'awakening-v1',
    });
    validateBattleResult(result);
    validateBattleCuesAgainstInput(result, input);
    this.state.battleInput = input;
    this.state.battle = clone(result);
  }

  private battleDone(): void {
    if (this.state.phase !== 'battle' || !this.state.battle) throw new Error('No battle result to settle');
    if (this.state.battle.outcome === 'draw') throw new Error('A drawn battle must be continued');
    const state = this.state as RunStateInternals;
    if (state._battleSettled) throw new Error('Battle already settled');
    const fusionEntry = state._fusionBattleEntry;
    if (!fusionEntry) throw new Error('Battle has no frozen fusion eligibility');
    fusionEntry.settlementInventory = clone(this.state.artifacts);
    state._battleSettled = true;
    if (state._battleKind === 'event') {
      this.settleEventBattle();
      if (this.state.battle.outcome === 'player') this.settleFusionVictory(fusionEntry);
      return;
    }
    const node = this.node;
    if (!node) throw new Error('No battle node');
    const battle = this.state.battle;
    const thunderChallenge = state._thunderChallenge === true;
    if (thunderChallenge && (this.state.act < 1 || this.state.act > 4 ||
      !['L', 'B'].includes(node.type) || this.state.battleInput?.enemy.thunderChallenge !== true)) {
      throw new Error('Frozen thunder challenge input is missing');
    }
    this.state.hp = clamp(battle.playerHp, 0, this.stats.max_hp);
    if (battle.outcome !== 'player') {
      if (thunderChallenge) {
        state.thunderChallenges!.push({
          act: this.state.act,
          step: this.state.step,
          nodeType: node.type as 'L' | 'B',
          enemyId: node.id,
          outcome: 'loss',
          xpBonus: 0,
          normalCandidates: [],
          normalSettled: false,
          normalReward: null,
          extraRarity: null,
          extraInventory: [],
          extraCandidates: [],
          extraReward: null,
          fallbackCoins: 0,
        });
      }
      this.state.phase = 'lost';
      const defeat = actEntity(this.content, this.state.act)?.story?.defeat;
      this.state.resultText = `你在${contentEntity(this.content, node.id)?.name ?? node.id}前倒下。${defeat ?? '此行未能走到归途。'}`;
      return;
    }
    if (node.type === 'F') {
      this.state.progress.bossWins += 1;
      this.markNodeCompleteWithoutTravel();
      const story = actEntity(this.content, 5)?.story;
      const finalText = [
        story?.boss_variants?.[node.id],
        story?.victory ?? '你凭一路修来的本领渡过天门。',
      ].filter(Boolean).join(' ');
      this.state.resultText = finalText;
      this.settleFusionVictory(fusionEntry);
      this.state.history.push({
        act: this.state.act,
        step: this.state.step,
        title: contentEntity(this.content, node.id)?.name ?? node.id,
        text: this.state.resultText,
      });
      this.state.phase = 'won';
      return;
    }
    const rewardType = state._battleRewardType ?? battleRewardType(node.type);
    if (!rewardType) throw new Error('Missing battle reward type');
    if (rewardType === 'elite') this.state.progress.eliteWins += 1;
    if (rewardType === 'boss') this.state.progress.bossWins += 1;
    const story = actEntity(this.content, this.state.act)?.story;
    this.state.resultText = rewardType === 'boss'
      ? story?.boss_variants?.[node.id] ?? story?.battle_after?.boss ?? ''
      : story?.battle_after?.[rewardType === 'elite' ? 'elite' : 'common'] ?? '';
    this.state.phase = 'reward';
    this.settleBattleEconomy(rewardType);
    if (thunderChallenge) {
      const xpBonus = thunderChallengeXpBonus(this.content, this.state.act, node.type as 'L' | 'B');
      this.state.xp += xpBonus;
      state.thunderChallenges!.push({
        act: this.state.act,
        step: this.state.step,
        nodeType: node.type as 'L' | 'B',
        enemyId: node.id,
        outcome: 'win',
        xpBonus,
        normalCandidates: this.state.rewardCandidates.slice(),
        normalSettled: false,
        normalReward: null,
        extraRarity: null,
        extraInventory: [],
        extraCandidates: [],
        extraReward: null,
        fallbackCoins: 0,
      });
      state._thunderRewardStage = 'normal';
      state._thunderRewardCandidates = [];
      state._thunderRewardFallback = undefined;
      this.state.resultText = `${this.state.resultText} 雷劫应战：额外修为 +${xpBonus}。`.trim();
    }
    this.settleFusionVictory(fusionEntry);
  }

  private settleEventBattle(): void {
    const state = this.state as RunStateInternals;
    const pending = state._pendingEvent;
    const battle = this.state.battle;
    if (!pending || !battle) throw new Error('Missing event encounter');
    const event = eventEntity(this.content, pending.eventId);
    const option = eventOption(event, pending.optionId);
    if (!option) throw new Error('Missing event option');
    this.state.hp = clamp(
      battle.outcome === 'player'
        ? battle.playerHp
        : Math.max(pending.failureHpFloor, battle.playerHp),
      0,
      this.stats.max_hp,
    );
    this.state.phase = 'event_result';
    state._eventOutcome = battle.outcome === 'player' ? 'success' : 'failure';
    this.state.eventStoryEcho = battle.outcome === 'player' ? option.story_echo : option.story_failure_echo;
    if (battle.outcome === 'player') {
      const enemy = contentEntity(this.content, pending.enemyId);
      const rewardType = rewardTypeForEnemyTier(enemy?.tier);
      if (rewardType === 'elite') this.state.progress.eliteWins += 1;
      if (rewardType === 'boss') this.state.progress.bossWins += 1;
      this.applyFlags(option);
      this.applyRewards(optionRewards(option));
      if (rewardType) this.applyBounty(rewardType);
      this.state.resultText = option.outcome ?? '';
    } else {
      // Non-lethal encounter failure only keeps the already-paid cost and
      // floor HP; authored failure rewards, if any, are the only exception.
      if (pending.failureRewards.length) this.applyRewards(pending.failureRewards);
      this.state.resultText = pending.failureOutcome ?? option.encounter?.failure_outcome ?? '';
    }
    this.state.eventOption = pending.optionId;
    state._pendingEvent = undefined;
    state._eventSettled = true;
    this.ensureTalentQueue();
  }

  private settleBattleEconomy(type: 'common' | 'elite' | 'boss'): void {
    const state = this.state as RunStateInternals;
    if (state._rewardSettled) throw new Error('Battle economy already settled');
    state._rewardSettled = true;
    const index = Math.max(0, this.state.act - 1);
    const economy = rulesOf(this.content).economy ?? {};
    if (type === 'common') {
      this.state.xp += finite(economy.ordinary_xp_by_act?.[index]) ? economy.ordinary_xp_by_act[index] : 0;
      this.state.coins += finite(economy.ordinary_coins_by_act?.[index]) ? economy.ordinary_coins_by_act[index] : 0;
      const noCoreOwned = !this.state.artifacts.some(stack =>
        artifactRole(this.content, stack.id) === 'core');
      if (!state._coreRewardOffered) {
        state._coreRewardOffered = true;
        this.state.rewardCandidates = noCoreOwned
          ? this.rollCoreArtifacts(3, `reward:${this.state.act}:${this.state.step}:first-core`)
          : this.rollArtifacts('common', 3, `reward:${this.state.act}:${this.state.step}:common`);
      } else {
        this.state.rewardCandidates = this.rollArtifacts('common', 3, `reward:${this.state.act}:${this.state.step}:common`);
      }
    } else if (type === 'elite') {
      this.state.xp += finite(economy.elite_xp_by_act?.[index]) ? economy.elite_xp_by_act[index] : 0;
      this.state.coins += finite(economy.elite_coins_by_act?.[index]) ? economy.elite_coins_by_act[index] : 0;
      this.state.rewardCandidates = this.rollArtifacts('rare', 3, `reward:${this.state.act}:${this.state.step}:elite`);
    } else if (type === 'boss') {
      this.state.xp += finite(economy.boss_xp_by_act?.[index]) ? economy.boss_xp_by_act[index] : 0;
      this.state.coins += finite(economy.boss_coins_by_act?.[index]) ? economy.boss_coins_by_act[index] : 0;
      this.state.rewardCandidates = this.rollArtifacts('rare', 3, `reward:${this.state.act}:${this.state.step}:boss`);
      this.maybeReplaceBossReward();
    }
    this.applyBounty(type);
  }

  private applyBounty(type: 'common' | 'elite' | 'boss'): void {
    if (!this.state.battleInput?.player.talents.includes('V2-J2-A')) return;
    const params = sharedBuildParams(this.content, 'V2-J2-A', 'bounty');
    const amount = type === 'common' ? params?.normal_coins
      : type === 'elite' ? params?.elite_coins
        : params?.boss_coins;
    if (finite(amount) && amount >= 0) this.state.coins += amount;
  }

  private maybeReplaceBossReward(): void {
    const state = this.state as RunStateInternals;
    if (this.state.rewardCandidates.length >= 3) {
      const probabilities = rulesOf(this.content).economy?.boss_legendary_replacement?.probability_by_act;
      const probability = finite(probabilities?.[Math.max(0, this.state.act - 1)]) ? probabilities[this.state.act - 1] : 0;
      if (probability > 0 && seededRandom(`${this.state.seed}:legendary:${this.state.act}:${this.state.step}`)() < probability) {
        const candidates = this.artifactPool('legendary').filter(id => this.canAcquireArtifact(id, 1));
        if (candidates.length) {
          const replacement = candidates[Math.floor(seededRandom(`${this.state.seed}:legendary:value:${this.state.act}:${this.state.step}`)() * candidates.length)]!;
          const index = Math.floor(seededRandom(`${this.state.seed}:legendary:slot:${this.state.act}:${this.state.step}`)() * this.state.rewardCandidates.length);
          this.state.rewardCandidates[index] = replacement;
        }
      }
    }
    void state;
  }

  private searchedRewardCandidates(family: ArtifactRewardFamily): string[] {
    const config = rewardSeekingConfig(this.content);
    const offered = this.state.rewardCandidates;
    const random = seededRandom(
      `${this.state.seed}:reward-search:${this.state.act}:${this.state.step}:${family}`,
    );
    const result: Array<string | undefined> = Array(offered.length);

    for (let index = 0; index < offered.length; index++) {
      const id = offered[index]!;
      if (contentEntity(this.content, id)?.rarity === 'legendary') result[index] = id;
    }

    const rarities = [...new Set(offered.flatMap(id => {
      const rarity = contentEntity(this.content, id)?.rarity;
      return typeof rarity === 'string' && rarity !== 'legendary' ? [rarity] : [];
    }))];
    for (const rarity of rarities) {
      const slots = offered.flatMap((id, index) =>
        contentEntity(this.content, id)?.rarity === rarity ? [index] : []);
      const pool = config.families[family].filter(id =>
        contentEntity(this.content, id)?.rarity === rarity && this.canAcquireArtifact(id, 1));
      while (slots.length && pool.length) {
        const slot = slots.shift()!;
        const pick = Math.floor(random() * pool.length);
        result[slot] = pool.splice(pick, 1)[0];
      }
    }
    return result.filter((id): id is string => typeof id === 'string');
  }

  rewardSearchPreview(family: ArtifactRewardFamily): {
    available: boolean;
    reason: string;
    cost: number;
    candidates: string[];
  } {
    const config = rewardSeekingConfig(this.content);
    const cost = config.price;
    const isFamily = ARTIFACT_REWARD_FAMILIES.includes(family);
    const state = this.state as RunStateInternals;
    const searches = Array.isArray(this.state.rewardSearches) ? this.state.rewardSearches : [];
    const alreadyUsed = searches.some(record => record?.act === this.state.act);
    const initialCoreOffer = this.state.act === 1 && this.state.step === 0;
    const eligiblePhase = this.state.phase === 'reward' &&
      this.state.act >= 1 && this.state.act <= 4 &&
      state._rewardSettled === true &&
      !initialCoreOffer &&
      state._coreRewardOffered === true &&
      !alreadyUsed;
    const candidates = isFamily && eligiblePhase ? this.searchedRewardCandidates(family) : [];
    let reason = '';
    if (!isFamily) reason = 'invalid-family';
    else if (this.state.phase !== 'reward') reason = 'not-reward-phase';
    else if (this.state.act < 1 || this.state.act > 4) reason = 'act-unavailable';
    else if (state._rewardSettled !== true) reason = 'reward-not-frozen';
    else if (initialCoreOffer) reason = 'guaranteed-core-offer';
    else if (state._coreRewardOffered !== true) reason = 'initial-core-offer-pending';
    else if (!Array.isArray(this.state.rewardSearches)) reason = 'invalid-search-history';
    else if (alreadyUsed) reason = 'already-used';
    else if (!candidates.length || JSON.stringify(candidates) === JSON.stringify(this.state.rewardCandidates)) {
      reason = 'no-different-candidates';
    } else if (this.state.coins + 1e-9 < cost) reason = 'cannot-pay';
    return { available: reason === '', reason, cost, candidates: candidates.slice() };
  }

  private seekReward(family: ArtifactRewardFamily): void {
    const preview = this.rewardSearchPreview(family);
    if (!preview.available) throw new Error(`Reward search unavailable: ${preview.reason}`);
    const state = this.state as RunStateInternals;
    const record: RewardSearchRecord = {
      act: this.state.act,
      step: this.state.step,
      family,
      cost: preview.cost,
      candidates: preview.candidates.slice(),
      resolved: false,
    };
    this.chargeCoins(record.cost);
    this.state.rewardCandidates = record.candidates.slice();
    state.rewardSearches.push(record);
    const challengeRecord = this.thunderChallengeRecordAt(this.state.act, this.state.step);
    if (state._thunderRewardStage === 'normal' && challengeRecord && !challengeRecord.normalSettled) {
      challengeRecord.normalCandidates = record.candidates.slice();
    }
  }

  private thunderChallengeRecordAt(act: number, step: number): ThunderChallengeRecord | undefined {
    return (this.state as RunStateInternals).thunderChallenges?.find(record =>
      record.act === act && record.step === step);
  }

  rewardRefinePreview(source: string, target: string): {
    available: boolean;
    reason: string;
    sourceStacks: number;
    targetStacks: number;
    nextStacks: number;
    awakening: boolean;
    forfeited: string[];
  } {
    const config = rewardRefiningConfig(this.content);
    const state = this.state as RunStateInternals;
    const sourceStacks = typeof source === 'string' ? artifactCount(this.state, source) : 0;
    const targetStacks = typeof target === 'string' ? artifactCount(this.state, target) : 0;
    const nextStacks = targetStacks + 1;
    const sourceArtifact = typeof source === 'string' ? contentEntity(this.content, source) : undefined;
    const targetArtifact = typeof target === 'string' ? contentEntity(this.content, target) : undefined;
    const targetMax = targetArtifact?.max_stacks;
    const forfeited = Array.isArray(this.state.rewardCandidates)
      ? this.state.rewardCandidates.slice()
      : [];
    let reason = '';

    if (this.state.phase !== 'reward') reason = 'not-reward-phase';
    else if (this.state.act < 1 || this.state.act > 4) reason = 'act-unavailable';
    else if (state._rewardSettled !== true || state._battleSettled !== true ||
      state._battleKind !== 'node' || state._battleRewardType !== 'common' ||
      this.node?.type !== 'C') reason = 'reward-not-frozen';
    else if (this.state.act === 1 && this.state.step === 0) reason = 'guaranteed-core-offer';
    else if (state._coreRewardOffered !== true) reason = 'initial-core-offer-pending';
    else if (!Array.isArray(this.state.rewardCandidates) || !forfeited.length) reason = 'empty-offer';
    else if (forfeited.length > 3 || forfeited.some(id =>
      contentEntity(this.content, id)?.kind !== 'artifact' ||
      contentEntity(this.content, id)?.rarity !== 'common')) reason = 'common-only-offer-required';
    else if (!Array.isArray(this.state.rewardRefinements)) reason = 'invalid-refine-history';
    else if (this.state.rewardRefinements.length >= config.max_per_act * 4 ||
      this.state.rewardRefinements.some(record => record?.act === this.state.act)) {
      reason = 'already-used';
    } else if (source === target) reason = 'same-artifact';
    else if (!sourceArtifact || sourceArtifact.kind !== 'artifact' ||
      sourceArtifact.rarity !== 'common' || !targetArtifact ||
      targetArtifact.kind !== 'artifact' || targetArtifact.rarity !== 'common' ||
      !integer(targetMax) || targetMax <= 0) reason = 'invalid-artifact-reference';
    else if (!sourceStacks) reason = 'source-not-owned';
    else if (this.state.equipment?.slots?.includes(source)) reason = 'source-equipped';
    else if (!targetStacks) reason = 'target-not-owned';
    else if (!this.state.equipment?.slots?.includes(target)) reason = 'target-not-equipped';
    else if (targetStacks >= targetMax) reason = 'target-capped';

    const awakening = !!targetArtifact && isObject(targetArtifact.awakening) &&
      integer(targetArtifact.awakening.at_stacks) &&
      targetArtifact.awakening.at_stacks === nextStacks;
    return {
      available: reason === '',
      reason,
      sourceStacks,
      targetStacks,
      nextStacks,
      awakening,
      forfeited,
    };
  }

  private refineReward(source: string, target: string): void {
    const preview = this.rewardRefinePreview(source, target);
    if (!preview.available) {
      throw new Error(`Reward refinement unavailable: ${preview.reason}`);
    }
    const record: RewardRefineRecord = {
      act: this.state.act,
      step: this.state.step,
      source,
      target,
      targetStacksBefore: preview.targetStacks,
      forfeited: preview.forfeited.slice(),
    };
    const state = this.state as RunStateInternals;
    const targetStack = this.state.artifacts.find(stack => stack.id === target);
    if (!targetStack) throw new Error(`Insufficient artifact: ${target}`);

    removeArtifact(this.state, source, 1);
    targetStack.stacks += 1;
    state.rewardRefinements.push(record);
    const search = state.rewardSearches.find(candidate =>
      !candidate.resolved && candidate.act === this.state.act && candidate.step === this.state.step);
    if (search) search.resolved = true;
    this.state.hp = Math.min(this.state.hp, this.stats.max_hp);
    this.state.resultText = rewardRefinementHistoryText(this.content, record);
    this.state.rewardCandidates = [];
    this.state.phase = 'map';
    this.completeNode();
  }

  private chooseReward(id: string | null): void {
    if (this.state.phase !== 'reward') throw new Error('No reward is pending');
    const state = this.state as RunStateInternals;
    if (state._rewardSettled !== true) throw new Error('Battle reward is not frozen');
    if (state._thunderRewardStage === 'bonus') {
      this.chooseThunderBonusReward(id);
      return;
    }
    if (state._thunderRewardStage === 'normal') {
      const challenge = this.thunderChallengeRecordAt(this.state.act, this.state.step);
      if (!challenge || challenge.outcome !== 'win' || challenge.normalSettled) {
        throw new Error('Thunder challenge reward is not frozen');
      }
      if (id === null) {
        this.state.coins += finite(rulesOf(this.content).economy?.artifact_decline_coins)
          ? rulesOf(this.content).economy.artifact_decline_coins
          : 4;
      } else {
        if (typeof id !== 'string' || !this.state.rewardCandidates.includes(id)) throw new Error('Invalid reward ID');
        if (!this.canAcquireArtifact(id, 1)) throw new Error('Reward artifact is no longer available');
        addArtifact(this.content, this.state, id, 1);
      }
      const search = state.rewardSearches.find(record =>
        !record.resolved && record.act === this.state.act && record.step === this.state.step);
      if (search) search.resolved = true;
      challenge.normalCandidates = this.state.rewardCandidates.slice();
      challenge.normalSettled = true;
      challenge.normalReward = id;
      challenge.extraInventory = clone(this.state.artifacts);
      this.state.rewardCandidates = [];

      const bonus = rollThunderChallengeCandidates(
        this.content,
        this.state.seed,
        challenge.act,
        challenge.step,
        challenge.extraInventory,
        challenge.normalReward,
      );
      challenge.extraRarity = bonus.rarity;
      challenge.extraCandidates = bonus.candidates.slice();
      if (bonus.candidates.length) {
        state._thunderRewardStage = 'bonus';
        state._thunderRewardCandidates = bonus.candidates.slice();
        this.state.rewardCandidates = bonus.candidates.slice();
        return;
      }

      challenge.fallbackCoins = THUNDER_CHALLENGE_FALLBACK_COINS;
      state._thunderRewardFallback = { type: 'coins', amount: THUNDER_CHALLENGE_FALLBACK_COINS };
      this.state.coins += THUNDER_CHALLENGE_FALLBACK_COINS;
      this.state.resultText = `${this.state.resultText} 雷劫加赏池已尽，改得${THUNDER_CHALLENGE_FALLBACK_COINS}灵石。`.trim();
      state._thunderRewardStage = undefined;
      state._thunderRewardCandidates = [];
      this.state.phase = 'map';
      this.completeNode();
      return;
    }
    if (id === null) {
      this.state.coins += finite(rulesOf(this.content).economy?.artifact_decline_coins)
        ? rulesOf(this.content).economy.artifact_decline_coins
        : 4;
    } else {
      if (typeof id !== 'string' || !this.state.rewardCandidates.includes(id)) throw new Error('Invalid reward ID');
      if (!this.canAcquireArtifact(id, 1)) throw new Error('Reward artifact is no longer available');
      addArtifact(this.content, this.state, id, 1);
    }
    const search = state.rewardSearches.find(record =>
      !record.resolved && record.act === this.state.act && record.step === this.state.step);
    if (search) search.resolved = true;
    this.state.rewardCandidates = [];
    this.state.phase = 'map';
    this.completeNode();
  }

  private chooseThunderBonusReward(id: string | null): void {
    const state = this.state as RunStateInternals;
    const challenge = this.thunderChallengeRecordAt(this.state.act, this.state.step);
    if (id === null || typeof id !== 'string' || !challenge ||
      challenge.outcome !== 'win' || !challenge.normalSettled ||
      !challenge.extraCandidates.includes(id) ||
      JSON.stringify(state._thunderRewardCandidates) !== JSON.stringify(challenge.extraCandidates) ||
      JSON.stringify(this.state.rewardCandidates) !== JSON.stringify(challenge.extraCandidates)) {
      throw new Error('Invalid thunder challenge reward ID');
    }
    if (!this.canAcquireArtifact(id, 1)) throw new Error('Thunder challenge artifact is no longer available');
    addArtifact(this.content, this.state, id, 1);
    challenge.extraReward = id;
    this.state.resultText = `${this.state.resultText} 雷劫加赏：${artifactEntity(this.content, id).name}。`.trim();
    state._thunderRewardStage = undefined;
    state._thunderRewardCandidates = [];
    this.state.rewardCandidates = [];
    this.state.phase = 'map';
    this.completeNode();
  }

  private checkOption(event: Entity, option: AnyRecord): { available: boolean; reason: string } {
    if (!Array.isArray(event.options) || !event.options.some((candidate: AnyRecord) => candidate?.id === option.id)) {
      return { available: false, reason: 'unknown-option' };
    }
    if (this.state.eventOption) return { available: false, reason: 'event-already-settled' };
    for (const requirement of Array.isArray(option.requirements) ? option.requirements : []) {
      if (!isObject(requirement) || typeof requirement.type !== 'string') return { available: false, reason: 'invalid-requirement' };
      switch (requirement.type) {
        case 'can_pay':
          if (!this.canPay(optionCosts(option))) return { available: false, reason: 'cannot-pay' };
          break;
        case 'capacity':
          if (typeof requirement.id !== 'string' || !this.canAcquireArtifact(requirement.id, requirement.count ?? 1)) {
            return { available: false, reason: 'capacity' };
          }
          break;
        case 'owned_artifact':
          if (typeof requirement.id !== 'string' || artifactCount(this.state, requirement.id) < (requirement.count ?? 1)) {
            return { available: false, reason: 'required-artifact-missing' };
          }
          break;
        case 'flag':
          if (this.state.flags[requirement.id] !== requirement.value) return { available: false, reason: 'flag' };
          break;
        case 'known_method':
          if (!this.state.ownedMethods.includes(requirement.id)) return { available: false, reason: 'method-not-known' };
          break;
        default:
          return { available: false, reason: `unknown-requirement:${requirement.type}` };
      }
    }
    if (!this.canPay(optionCosts(option))) return { available: false, reason: 'cannot-pay' };
    for (const reward of optionRewards(option)) {
      const issue = this.rewardAvailability(reward);
      if (issue) return { available: false, reason: issue };
    }
    for (const reward of option.check?.failure_rewards ?? []) {
      const issue = this.rewardAvailability(reward);
      if (issue) return { available: false, reason: issue };
    }
    for (const reward of option.commitment?.rewards ?? []) {
      const issue = this.rewardAvailability(reward);
      if (issue) return { available: false, reason: issue };
    }
    return { available: true, reason: '' };
  }

  private chooseEvent(id: string): void {
    if (this.state.phase !== 'event') throw new Error('No event is pending');
    if (typeof id !== 'string') throw new Error('Invalid event option');
    const node = this.node;
    if (!node) throw new Error('No event node');
    const event = eventEntity(this.content, node.id);
    const option = eventOption(event, id);
    if (!option) throw new Error(`Unknown event option: ${id}`);
    const availability = this.checkOption(event, option);
    if (!availability.available) throw new Error(availability.reason);
    const encounter = eventEncounter(option, event.id, this.content);
    const commitment = option.commitment
      ? createEventCommitment(event.id, option.id, { act: this.state.act, step: this.state.step + 1 }, option.commitment)
      : undefined;
    const check = option.check ? resolveEventCheck(option.check, {
      seed: this.state.seed, act: this.state.act, step: this.state.step + 1,
      eventId: event.id, optionId: option.id, stats: this.stats, hp: this.state.hp,
      ownedMethods: this.state.ownedMethods, artifacts: equippedArtifactStacks(this.state),
    }) : undefined;
    this.applyCosts(optionCosts(option));
    this.state.eventOption = id;
    this.state.eventCheck = check;
    if (encounter) {
      const state = this.state as RunStateInternals;
      state._pendingEvent = encounter;
      state._previewKind = 'event';
      this.state.phase = 'preview';
      return;
    }
    const success = check?.success !== false;
    if (success) this.applyFlags(option);
    (this.state as RunStateInternals)._eventOutcome = success ? 'success' : 'failure';
    this.state.phase = 'event_result';
    this.applyRewards(success ? optionRewards(option) : option.check.failure_rewards);
    if (commitment) (this.state.eventCommitments ??= []).push(commitment);
    this.state.resultText = (success ? option.outcome : option.check.failure_outcome) ?? '';
    this.state.eventStoryEcho = success ? option.story_echo : option.check.failure_echo;
    (this.state as RunStateInternals)._eventSettled = true;
    this.ensureTalentQueue();
  }

  private continuePhase(): void {
    if (this.state.phase === 'event_result') {
      const state = this.state as RunStateInternals;
      if (state._eventSettled || this.state.eventOption) {
        if (state._swapAvailable) {
          state._restFromEvent = true;
          state._returnPhase = 'map';
          this.state.phase = 'rest';
          return;
        }
        this.state.phase = 'map';
        this.completeNode();
        return;
      }
      throw new Error('Event has no result');
    }
    if (this.state.phase === 'transition') {
      if (this.state.act < 4) {
        this.startAct(this.state.act + 1);
        return;
      }
      this.startAct(5);
      return;
    }
    throw new Error('Nothing to continue');
  }

  private startAct(act: number): void {
    const state = this.state as RunStateInternals;
    this.state.act = act;
    this.state.step = 0;
    this.state.nodes = [];
    state._actCoreCount = 0;
    state._actEliteCount = 0;
    state._actEliteChallengeUsed = false;
    state._challengeEliteEnemyId = undefined;
    state._thunderChallenge = false;
    state._thunderRewardStage = undefined;
    state._thunderRewardCandidates = [];
    state._thunderRewardFallback = undefined;
    state._battleRewardType = undefined;
    state._lastCorePosition = undefined;
    this.state.routeMap = { nodes: this.createRouteMap(), path: [] };
    this.state.rewardCandidates = [];
    this.state.shop = [];
    state._routeMapVersion = 1;
    state._routeMapLegacy = false;
    state._battleSettled = false;
    state._eventSettled = false;
    state._eventOutcome = undefined;
    state._previewKind = undefined;
    state._shopReforged = false;
    this.state.phase = 'map';
  }

  private generateShop(): void {
    if (this.state.shop.length) return;
    const act = actEntity(this.content, this.state.act);
    const config = act?.economy?.shop ?? {};
    const artifactSlots = integer(config.artifact_slots) ? config.artifact_slots : 3;
    const weight = finite(config.rare_inventory_weight) ? config.rare_inventory_weight : 0;
    const common = this.artifactPool('common').filter(id => this.canAcquireArtifact(id, 1));
    const rare = this.artifactPool('rare').filter(id => this.canAcquireArtifact(id, 1));
    const random = seededRandom(`${this.state.seed}:shop:${this.state.act}:${this.state.step}`);
    const available = [...common, ...rare];
    const items: ShopItem[] = [];
    for (let slot = 0; slot < artifactSlots; slot++) {
      const useRare = rare.length > 0 && random() < weight;
      const pool = useRare ? rare : common.length ? common : rare;
      if (!pool.length) break;
      const offset = Math.floor(random() * pool.length);
      let id = pool[offset]!;
      if (items.some(item => item.id === id)) {
        id = available.find(candidate => !items.some(item => item.id === candidate)) ?? id;
      }
      const artifact = artifactEntity(this.content, id);
      items.push({
        id,
        kind: 'artifact',
        price: this.shopQuote(artifact.rarity === 'rare' ? (finite(act?.economy?.shop?.rare_price) ? act.economy.shop.rare_price : 90) :
          (finite(act?.economy?.shop?.common_price) ? act.economy.shop.common_price : 40),
        ),
        sold: false,
      });
    }
    const recovery = rulesOf(this.content).economy?.non_artifact_prices?.recovery ?? {};
    const preparation = rulesOf(this.content).economy?.non_artifact_prices?.preparation ?? {};
    const talentReset = rulesOf(this.content).economy?.non_artifact_prices?.talent_reset ?? {};
    items.push({
      id: 'recovery',
      kind: 'recovery',
      price: this.shopQuote(finite(recovery.price) ? recovery.price : 15),
      sold: false,
    });
    items.push({
      id: 'preparation',
      kind: 'preparation',
      price: this.shopQuote(finite(preparation.price) ? preparation.price : 12),
      sold: false,
    });
    items.push({
      id: 'talent_reset',
      kind: 'talent_reset',
      price: this.shopQuote(finite(talentReset.price) ? talentReset.price : 40),
      sold: false,
    });
    this.state.shop = items;
  }

  private buy(id: string): void {
    if (this.state.phase !== 'shop') throw new Error('Shop is not open');
    const item = this.state.shop.find(candidate => candidate.id === id);
    if (!item || item.sold) throw new Error('Unknown or sold shop item');
    if (!finite(item.price) || this.state.coins < item.price) throw new Error('Cannot afford shop item');
    if (item.kind === 'artifact' && !this.canAcquireArtifact(item.id, 1)) throw new Error('Artifact capacity exhausted');
    if (item.kind === 'talent_reset') {
      const state = this.state as RunStateInternals;
      const chosen = state.talents[state.method] ?? [];
      const tiers = chosen.map(talentId => talentTier(this.content, state.method, talentId));
      if (state.n < 1 || !chosen.length) throw new Error('No earned talents to reset');
      if (state._talentQueue?.length || state._returnPhase !== undefined || tiers.some(tier =>
        !integer(tier) || tier < 1 || tier > state.n)) {
        throw new Error('Talent reset is unavailable');
      }
      const queue: CoreQueueItem[] = Array.from({ length: state.n }, (_value, index) => ({
        method: state.method,
        tier: index + 1,
        advance: false,
      }));
      this.chargeCoins(item.price);
      item.sold = true;
      state.talentDraftGeneration += 1;
      state.talents[state.method] = [];
      state._talentQueue = queue;
      for (const draft of queue) this.freezeTalentDraft(draft);
      state._returnPhase = 'shop';
      this.state.phase = 'talent';
      this.state.hp = Math.min(this.state.hp, this.stats.max_hp);
      return;
    }
    this.chargeCoins(item.price);
    if (item.kind === 'artifact') addArtifact(this.content, this.state, item.id, 1);
    else if (item.kind === 'recovery') this.state.hp = Math.min(this.stats.max_hp, this.state.hp + 0.12 * currentReferenceHp(this.content, this.state.act));
    else this.state.preparation += 0.1 * currentReferenceHp(this.content, this.state.act);
    item.sold = true;
  }

  private leaveShop(): void {
    if (this.state.phase !== 'shop') throw new Error('Shop is not open');
    this.state.shop = clone(this.state.shop);
    this.state.phase = 'map';
    this.completeNode();
  }

  private shopQuote(price: number): number {
    const params = hasTalent(this.state, 'V2-J2-B')
      ? sharedBuildParams(this.content, 'V2-J2-B', 'shop_discount')
      : undefined;
    if (!params) return Math.max(1, price);
    const ratio = finite(params?.ratio) ? params.ratio : 1;
    return Math.max(1, Math.floor(price * ratio));
  }

  private chargeCoins(amount: number): void {
    if (!finite(amount) || amount < 0 || this.state.coins + 1e-9 < amount) {
      throw new Error('Cannot pay coins');
    }
    const spent = this.state.progress.coinsSpent + amount;
    if (!finite(spent)) throw new Error('Invalid run spending total');
    this.state.coins = Math.max(0, this.state.coins - amount);
    this.state.progress.coinsSpent = spent;
  }

  reforgePrice(): number {
    return Math.ceil((this.actContent.economy?.shop?.common_price ?? 40) * 0.2);
  }

  reforgeOptions(sourceId: string): string[] {
    if (!this.state.artifacts.some(stack => stack.id === sourceId && stack.stacks > 0) ||
      contentEntity(this.content, sourceId)?.rarity !== 'common') return [];
    const candidates = this.artifactPool('common').filter(id => id !== sourceId);
    const random = seededRandom(`${this.state.seed}:reforge:${this.state.act}:${this.state.step}:${sourceId}`);
    const fixed: string[] = [];
    while (candidates.length && fixed.length < 3) {
      fixed.push(candidates.splice(Math.floor(random() * candidates.length), 1)[0]!);
    }
    return fixed.filter(id => this.canAcquireArtifact(id, 1));
  }

  reforgeAvailability(sourceId: string, targetId: string): { available: boolean; reason: string } {
    if (this.state.phase !== 'shop') return { available: false, reason: 'not-shop' };
    if (this.state._shopReforged) return { available: false, reason: 'already-reforged' };
    if (!this.reforgeOptions(sourceId).includes(targetId)) return { available: false, reason: 'invalid-source-or-target' };
    if (this.state.coins < this.reforgePrice()) return { available: false, reason: 'cannot-pay' };
    return { available: true, reason: '' };
  }

  private reforge(sourceId: string, targetId: string): void {
    const availability = this.reforgeAvailability(sourceId, targetId);
    if (!availability.available) throw new Error(availability.reason);
    this.chargeCoins(this.reforgePrice());
    removeArtifact(this.state, sourceId, 1);
    addArtifact(this.content, this.state, targetId, 1);
    this.state.hp = Math.min(this.state.hp, this.stats.max_hp);
    this.state._shopReforged = true;
    this.state.resultText = `献祭${artifactEntity(this.content, sourceId).name}一层，重铸为${artifactEntity(this.content, targetId).name}。`;
  }

  warmCost(): number {
    return Math.ceil((this.actContent.economy?.shop?.common_price ?? 40) * 0.5);
  }

  warmableArtifacts(): string[] {
    return this.state.artifacts
      .filter(stack => contentEntity(this.content, stack.id)?.rarity === 'common' &&
        this.canAcquireArtifact(stack.id, 1))
      .map(stack => stack.id);
  }

  private rest(choice: 'heal' | 'preparation' | 'swap_method' | 'temper', method?: string, artifact?: string): void {
    if (this.state.phase !== 'rest') throw new Error('Rest is not available');
    const state = this.state as RunStateInternals;
    if (!['heal', 'preparation', 'swap_method', 'temper'].includes(choice)) throw new Error('Unknown rest choice');
    if (state._restFromEvent && choice !== 'swap_method') throw new Error('This event only grants a method swap');
    if (choice === 'heal') {
      this.state.hp = Math.min(this.stats.max_hp, this.state.hp + (rulesOf(this.content).economy?.rest_heal_ratio ?? 0.25) * currentReferenceHp(this.content, this.state.act));
      this.state.resultText = '休整后恢复气血。';
    } else if (choice === 'preparation') {
      this.state.preparation += 0.1 * currentReferenceHp(this.content, this.state.act);
      this.state.resultText = '下一场战斗前的护盾准备完成。';
    } else if (choice === 'temper') {
      if (typeof artifact !== 'string' || !this.warmableArtifacts().includes(artifact)) throw new Error('Artifact cannot be tempered');
      if (this.state.coins < this.warmCost()) throw new Error('Cannot afford tempering');
      this.chargeCoins(this.warmCost());
      addArtifact(this.content, this.state, artifact, 1);
      this.state.resultText = `${artifactEntity(this.content, artifact).name}温养一层。`;
    } else {
      if (typeof method !== 'string' || !this.state.ownedMethods.includes(method)) throw new Error('Method is not owned');
      if (method === this.state.method) throw new Error('Method is already active');
      methodEntity(this.content, method);
      this.state.method = method;
      this.state.hp = Math.min(this.state.hp, this.stats.max_hp);
      state._pendingRestChoice = 'swap_method';
      state._returnPhase = 'map';
      state._swapAvailable = false;
      state._restFromEvent = false;
      this.queueMissingTalents(method, false);
      this.state.resultText = `已换修${methodEntity(this.content, method).name}。`;
    }
    this.state.phase = 'map';
    this.completeNode();
  }

  private chooseTalent(id: string): void {
    if (this.state.phase !== 'talent') throw new Error('No talent is pending');
    if (typeof id !== 'string') throw new Error('Invalid talent ID');
    const state = this.state as RunStateInternals;
    this.ensureTalentQueue();
    const item = state._talentQueue?.[0];
    if (!item) throw new Error('No talent is pending');
    const key = talentDraftKey(item.method, item.tier, state.talentDraftGeneration);
    if (!state.talentDrafts[key]?.includes(id)) throw new Error('Talent was not offered for this choice');
    const talent = talentEntity(this.content, item.method, id);
    if (!talent || talent.tier !== item.tier) throw new Error('Talent is not an earned choice for the active method');
    state.talents[item.method] ??= [];
    if (state.talents[item.method].includes(id)) throw new Error('Talent already selected');
    state.talents[item.method].push(id);
    if (item.advance && item.tier === this.state.n + 1) this.state.n += 1;
    this.state.hp = Math.min(this.state.hp, this.stats.max_hp);
    state._talentQueue!.shift();
    if (state._talentQueue!.length || state._returnPhase !== 'shop') this.ensureTalentQueue();
    if (!state._talentQueue?.length) {
      this.state.phase = state._returnPhase ?? 'map';
      state._returnPhase = undefined;
      this.state.returnPhase = undefined;
    } else {
      this.state.phase = 'talent';
    }
  }

  private retire(): void {
    if (this.state.phase === 'won') throw new Error('Won runs cannot be retired');
    if (this.state.phase === 'lost') return;
    this.state.phase = 'lost';
    this.state.resultText = '你主动结束了这局行旅。';
  }

  private ensureTalentQueue(activate = true): void {
    const state = this.state as RunStateInternals;
    state._talentQueue ??= [];
    state._returnPhase ??= state.returnPhase;
    if (state._talentQueue.length) {
      for (const item of state._talentQueue) this.freezeTalentDraft(item);
      state._returnPhase ??= this.state.phase === 'talent' ? 'map' : this.state.phase;
      if (activate) this.state.phase = 'talent';
      return;
    }
    const unlocked = unlockedTier(this.content, this.state);
    const currentTalents = state.talents[state.method] ?? [];
    const selectedTiers = new Set(currentTalents.map(id => talentTier(this.content, state.method, id)).filter(integer));
    let next = this.state.n + 1;
    if (unlocked >= next && !selectedTiers.has(next)) {
      const item = { method: state.method, tier: next, advance: true };
      state._talentQueue.push(item);
      this.freezeTalentDraft(item);
    } else {
      for (let tier = 1; tier <= unlocked; tier++) {
        if (!selectedTiers.has(tier)) {
          const item = { method: state.method, tier, advance: false };
          state._talentQueue.push(item);
          this.freezeTalentDraft(item);
          break;
        }
      }
    }
    if (state._talentQueue.length) {
      state._returnPhase ??= this.state.phase === 'talent' ? 'map' : this.state.phase;
      if (activate) this.state.phase = 'talent';
    }
  }

  private queueMissingTalents(method: string, advance: boolean): void {
    const state = this.state as RunStateInternals;
    const unlocked = unlockedTier(this.content, this.state);
    const selected = new Set((state.talents[method] ?? []).map(id => talentTier(this.content, method, id)).filter(integer));
    state._talentQueue ??= [];
    for (let tier = 1; tier <= unlocked; tier++) {
      if (!selected.has(tier) && !state._talentQueue.some(item => item.method === method && item.tier === tier)) {
        const item = { method, tier, advance };
        state._talentQueue.push(item);
        this.freezeTalentDraft(item);
      }
    }
    if (state._talentQueue.length) this.state.phase = 'talent';
  }

  private applyCosts(costs: AnyRecord[]): void {
    let hpCostIndex = 0;
    const resolved: Array<{ resource: string; amount: number; mustSurvive?: boolean }> = costs.map(cost => {
      if (cost.type !== 'resource' || !['hp', 'coins', 'xp'].includes(cost.resource)) throw new Error('Unsupported event cost');
      const index = cost.resource === 'hp' ? hpCostIndex++ : -1;
      return {
        resource: cost.resource,
        amount: this.resolveCostAmount(cost, index),
        mustSurvive: cost.must_survive === true,
      };
    });
    for (const cost of resolved) {
      if (cost.resource === 'coins' && this.state.coins < cost.amount) throw new Error('Cannot pay coins');
      if (cost.resource === 'xp' && this.state.xp < cost.amount) throw new Error('Cannot pay xp');
      if (cost.resource === 'hp' && cost.mustSurvive && this.state.hp - cost.amount < 1) throw new Error('Must survive HP cost');
    }
    for (const cost of resolved) {
      if (cost.resource === 'hp') {
        this.state.hp = Math.max(0, this.state.hp - cost.amount);
        this.applyEventTravelAfterHpCost(cost.amount);
      } else if (cost.resource === 'coins') this.chargeCoins(cost.amount);
      else this.state.xp -= cost.amount;
    }
  }

  private eventCostEffects(): AnyRecord[] {
    const method = contentEntity(this.content, this.state.method);
    return (Array.isArray(method?.travel) ? method.travel : [])
      .filter((effect: AnyRecord) => effect?.trigger === 'event_cost_paid' &&
        ['reduce_event_cost', 'grant_resource'].includes(effect.operation) &&
        effect.params?.active_event_cost === true);
  }

  private resolveCostAmount(cost: AnyRecord, hpCostIndex = -1): number {
    let amount = resourceAmount(this.content, this.state, cost);
    if (cost.resource === 'hp') {
      const effect = this.eventCostEffects().find(candidate =>
        candidate.operation === 'reduce_event_cost' &&
        (!candidate.params?.one_cost_per_event || hpCostIndex === 0));
      if (effect) {
        const params = effect.params ?? {};
        const multiplier = finite(params.multiplier) ? params.multiplier : 1;
        const reduced = params.mode === 'multiply' ? amount * multiplier : amount;
        const reduction = amount - reduced;
        const cap = finite(params.max_reduction_ratio)
          ? params.max_reduction_ratio * currentReferenceHp(this.content, this.state.act)
          : reduction;
        amount = Math.max(0, amount - Math.min(Math.max(0, cap), Math.max(0, reduction)));
      }
    }
    return amount;
  }

  private applyEventTravelAfterHpCost(actualPaid: number): void {
    const state = this.state as RunStateInternals;
    if (state._eventCostTravelApplied || actualPaid <= 0 || this.state.hp < 1) return;
    const effect = this.eventCostEffects().find(candidate =>
      candidate.operation === 'grant_resource' && candidate.params?.resource === 'hp');
    if (!effect) return;
    const params = effect.params ?? {};
    const refund = Math.min(actualPaid, this.travelAmount(effect, this.stats));
    this.state.hp = Math.min(this.stats.max_hp, this.state.hp + refund);
    state._eventCostTravelApplied = true;
  }

  private canPay(costs: AnyRecord[]): boolean {
    try {
      let coins = this.state.coins;
      let xp = this.state.xp;
      let hp = this.state.hp;
      let hpCostIndex = 0;
      for (const cost of costs) {
        if (cost.type !== 'resource' || !['hp', 'coins', 'xp'].includes(cost.resource)) return false;
        const index = cost.resource === 'hp' ? hpCostIndex++ : -1;
        const amount = this.resolveCostAmount(cost, index);
        if (cost.resource === 'coins') {
          coins -= amount;
          if (coins < 0) return false;
        } else if (cost.resource === 'xp') {
          xp -= amount;
          if (xp < 0) return false;
        } else {
          hp -= amount;
          if (cost.must_survive === true && hp < 1) return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private applyFlags(option: AnyRecord): void {
    if (!isObject(option.set_flags)) return;
    for (const [id, value] of Object.entries(option.set_flags)) {
      if (typeof value !== 'boolean') throw new Error(`Invalid flag value: ${id}`);
      this.state.flags[id] = value;
    }
  }

  private poolRewardIds(reward: AnyRecord): string[] {
    const pool = typeof reward.pool === 'string' ? reward.pool : '';
    if (!pool) return [];
    if (reward.type === 'artifact') {
      const rarity = pool.endsWith('_artifact')
        ? pool.slice(0, -'_artifact'.length)
        : pool;
      if (!['common', 'rare', 'legendary'].includes(rarity)) return [];
      return this.artifactPool(rarity);
    }
    if (reward.type === 'method') {
      const rarity = pool.endsWith('_method')
        ? pool.slice(0, -'_method'.length)
        : pool;
      if (!['common', 'rare', 'legendary'].includes(rarity)) return [];
      return contentEntities(this.content, 'method')
        .filter(method => method.rarity === rarity)
        .map(method => method.id);
    }
    return [];
  }

  private resolvePoolRewardId(reward: AnyRecord, index: number): string | undefined {
    const candidates = this.poolRewardIds(reward).filter(id => {
      if (reward.type === 'artifact') return this.canAcquireArtifact(id, reward.count ?? 1);
      return !this.state.ownedMethods.includes(id);
    });
    if (!candidates.length) return undefined;
    const random = seededRandom(
      `${this.state.seed}:reward-pool:${this.state.act}:${this.state.step}:${index}:${reward.pool}`,
    );
    return candidates[Math.floor(random() * candidates.length)] ?? candidates[0];
  }

  private rewardAvailability(reward: AnyRecord): string | undefined {
    if (!isObject(reward) || typeof reward.type !== 'string') return 'invalid-reward';
    switch (reward.type) {
      case 'artifact': {
        const count = reward.count ?? 1;
        if (!integer(count) || count <= 0) return 'invalid-artifact-count';
        if (typeof reward.id === 'string') {
          return this.canAcquireArtifact(reward.id, count) ? undefined : 'artifact-capacity';
        }
        if (typeof reward.pool !== 'string' || !this.poolRewardIds(reward).length) return 'unknown-artifact-pool';
        // An exhausted authored pool deliberately falls back to the public
        // four-coin decline value instead of making the event unselectable.
        return undefined;
      }
      case 'method':
        if (typeof reward.id === 'string') {
          if (contentEntity(this.content, reward.id)?.kind !== 'method') return 'unknown-method';
          return this.state.ownedMethods.includes(reward.id) ? 'method-already-known' : undefined;
        }
        if (typeof reward.pool !== 'string' || !this.poolRewardIds(reward).length) return 'unknown-method-pool';
        return this.resolvePoolRewardId(reward, 0) ? undefined : 'method-pool-exhausted';
      case 'resource':
        if (!['hp', 'coins', 'xp'].includes(reward.resource)) return 'unknown-resource';
        try {
          resourceAmount(this.content, this.state, reward);
        } catch {
          return 'invalid-resource';
        }
        return undefined;
      case 'preparation':
        try {
          resourceAmount(this.content, this.state, reward);
        } catch {
          return 'invalid-preparation';
        }
        return undefined;
      case 'swap_method':
        if (reward.pool !== 'owned_methods') return 'unknown-method-pool';
        if (this.state.ownedMethods.length < 2) return 'no-method-to-swap';
        return undefined;
      default:
        return `unknown-reward:${reward.type}`;
    }
  }

  private applyRewards(rewards: AnyRecord[]): void {
    const issues = rewards.map(reward => this.rewardAvailability(reward)).filter((issue): issue is string => !!issue);
    if (issues.length) throw new Error(issues[0]);
    for (const [index, reward] of rewards.entries()) {
      switch (reward.type) {
        case 'artifact': {
          const id = typeof reward.id === 'string'
            ? reward.id
            : this.resolvePoolRewardId(reward, index);
          if (!id) {
            this.state.coins += finite(rulesOf(this.content).economy?.artifact_decline_coins)
              ? rulesOf(this.content).economy.artifact_decline_coins
              : 4;
          } else {
            addArtifact(this.content, this.state, id, reward.count ?? 1);
          }
          break;
        }
        case 'method': {
          const id = typeof reward.id === 'string' ? reward.id : this.resolvePoolRewardId(reward, index);
          if (!id) throw new Error('method-pool-exhausted');
          if (!this.state.ownedMethods.includes(id)) {
            methodEntity(this.content, id);
            this.state.ownedMethods.push(id);
            this.state.talents[id] ??= [];
          }
          break;
        }
        case 'resource':
          this.applyResource(reward.resource, resourceAmount(this.content, this.state, reward));
          break;
        case 'preparation':
          this.state.preparation += resourceAmount(this.content, this.state, reward);
          break;
        case 'swap_method':
          (this.state as RunStateInternals)._swapAvailable = true;
          break;
      }
    }
  }

  private applyResource(resource: 'hp' | 'coins' | 'xp', amount: number): void {
    if (!finite(amount)) throw new Error('Invalid resource result');
    if (resource === 'hp') this.state.hp = Math.min(this.stats.max_hp, Math.max(0, this.state.hp + amount));
    else if (resource === 'coins') this.state.coins += amount;
    else this.state.xp += amount;
  }

  private advanceCommitments(phase: 'entered' | 'completed'): void {
    if (this.state.hp <= 0 || this.state.phase === 'lost') return;
    const node = this.node;
    if (!node) return;
    const result = advanceEventCommitments(this.state.eventCommitments, {
      act: this.state.act,
      step: this.state.step + 1,
      type: node.type,
    }, phase);
    this.state.eventCommitments = result.eventCommitments;
    for (const record of result.fulfilled) {
      let fallbackCoins = 0;
      const delivered: string[] = [];
      for (const reward of record.snapshot.rewards) {
        if (reward.type !== 'artifact') {
          this.applyRewards([reward]);
          delivered.push(`${reward.amount}${({ hp: '气血', coins: '灵石', xp: '修为' })[reward.resource]}`);
          continue;
        }
        let acquired = 0;
        for (let count = 0; count < reward.count; count++) {
          if (this.canAcquireArtifact(reward.id, 1)) {
            this.applyRewards([{ ...reward, count: 1 }]);
            acquired++;
          } else fallbackCoins += 4;
        }
        if (acquired) delivered.push(`${artifactEntity(this.content, reward.id).name}×${acquired}`);
      }
      this.state.coins += fallbackCoins;
      const text = fallbackCoins
        ? `${record.snapshot.name}已兑现：${delivered.length ? `${delivered.join('，')}；` : ''}满层或冲突部分折为${fallbackCoins}灵石。`
        : record.snapshot.success_outcome;
      record.resultText = text;
      const entry = this.state.history.at(-1);
      if (entry) entry.text = `${entry.text} ${text}`.trim();
    }
    for (const record of [...result.broken, ...result.expired]) {
      record.resultText = record.status === 'expired'
        ? '已抵达天门，约定未兑现；不补发奖励，已付代价不退。'
        : record.snapshot.failure_outcome;
      const entry = this.state.history.find(item =>
        item.act === record.originAct && item.step + 1 === record.originStep);
      if (entry) entry.text = `${entry.text} ${record.resultText}`.trim();
    }
  }

  private canAcquireArtifact(id: string, count: number): boolean {
    try {
      return !isFusionResult(this.content, id) && artifactCapacity(this.content, this.state, id, count).ok;
    } catch {
      return false;
    }
  }

  private artifactPool(rarity: string): string[] {
    return contentEntities(this.content, 'artifact')
      .filter(artifact => artifact.rarity === rarity && !isFusionResult(this.content, artifact.id))
      .map(artifact => artifact.id);
  }

  private rollArtifacts(rarity: string, count: number, seed: string): string[] {
    const pool = this.artifactPool(rarity).filter(id => this.canAcquireArtifact(id, 1));
    if (!pool.length) return [];
    const random = seededRandom(`${this.state.seed}:${seed}`);
    const result: string[] = [];
    const mutable = pool.slice();
    while (result.length < count && mutable.length) {
      const index = Math.floor(random() * mutable.length);
      result.push(mutable.splice(index, 1)[0]!);
    }
    return result;
  }

  private rollCoreArtifacts(count: number, seed: string): string[] {
    const pool = this.artifactPool('common')
      .filter(id => artifactRole(this.content, id) === 'core' && this.canAcquireArtifact(id, 1));
    if (!pool.length) return [];
    const random = seededRandom(`${this.state.seed}:${seed}`);
    const result: string[] = [];
    const mutable = pool.slice();
    while (result.length < count && mutable.length) {
      const index = Math.floor(random() * mutable.length);
      result.push(mutable.splice(index, 1)[0]!);
    }
    return result;
  }

  private markNodeCompleteWithoutTravel(): void {
    const node = this.node;
    if (!node || node.completed) return;
    node.completed = true;
    const state = this.state as RunStateInternals;
    const key = state.routeMap?.path[this.state.step];
    const routeNode = state.routeMap?.nodes.find(candidate => candidate.key === key);
    if (routeNode) routeNode.completed = true;
  }

  private completeNode(): void {
    const state = this.state as RunStateInternals;
    const node = this.node;
    if (!node || node.completed) throw new Error('Node already completed or missing');
    if (node.type === 'F') {
      const entity = contentEntity(this.content, node.id);
      this.state.history.push({
        act: this.state.act,
        step: this.state.step,
        title: entity?.name ?? node.id,
        text: this.state.resultText || entity?.summary || '',
      });
      this.markNodeCompleteWithoutTravel();
      this.state.phase = 'won';
      return;
    }
    const source = (state._nodeEntry ?? this.state.nodeEntry ?? snapshotEntry(state)) as NonNullable<RunState['nodeEntry']>;
    state._travelSnapshots ??= [];
    state._travelSnapshots.push({
      act: this.state.act,
      step: this.state.step,
      method: source.method,
      talents: clone(source.talents),
      artifacts: clone(source.artifacts),
      phase: this.state.phase,
    });
    const entity = contentEntity(
      this.content,
      node.type === 'C' ? state._challengeEliteEnemyId ?? node.id : node.id,
    );
    const selected = this.state.eventOption && entity?.kind === 'event'
      ? eventOption(entity, this.state.eventOption) : undefined;
    const echo = this.state.eventStoryEcho ??
      (selected?.legacy_story_echo && !this.state.eventCheck ? selected.legacy_story_echo : undefined);
    this.state.history.push({
      act: this.state.act,
      step: this.state.step,
      title: entity?.name ?? node.id,
      text: this.state.resultText || entity?.summary || '',
      ...(['E', 'K'].includes(node.type) && this.state.eventOption
        ? {
          eventId: node.id,
          optionId: this.state.eventOption,
          ...(state._eventOutcome ? { eventOutcome: state._eventOutcome } : {}),
          ...(this.state.eventCheck ? { eventCheck: clone(this.state.eventCheck) } : {}),
          ...(echo ? { storyEcho: echo } : {}),
        } : {}),
    });
    node.completed = true;
    const routeKey = state.routeMap?.path[this.state.step];
    const routeNode = state.routeMap?.nodes.find(candidate => candidate.key === routeKey);
    if (routeNode) routeNode.completed = true;
    if (node.type === 'K' && !this.state.completedCore.includes(node.id)) {
      this.state.completedCore.push(node.id);
    }
    this.applyTravel(node, source);
    this.advanceCommitments('completed');
    this.ensureTalentQueue(false);
    this.state.eventOption = undefined;
    this.state.eventCheck = undefined;
    this.state.eventStoryEcho = undefined;
    this.state.battle = undefined;
    this.state.battleInput = undefined;
    state._fusionBattleEntry = undefined;
    state._thunderChallenge = false;
    state._thunderRewardStage = undefined;
    state._thunderRewardCandidates = [];
    state._pendingEvent = undefined;
    state._previewKind = undefined;
    state._battleKind = undefined;
    state._battleNodeType = undefined;
    state._battleRewardType = undefined;
    state._challengeEliteEnemyId = undefined;
    state._battleSettled = false;
    state._eventSettled = false;
    state._eventOutcome = undefined;
    state._rewardSettled = false;
    this.state.rewardCandidates = [];
    this.state.shop = [];
    state._shopReforged = false;
    this.state.step += 1;
    this.state.nodeEntry = undefined;
    state._nodeEntry = undefined;
    if (state._talentQueue?.length) {
      state._returnPhase = (state.routeMap?.path.length ?? this.state.nodes.length) >=
        (this.state.act === 5 ? 1 : 11) ? 'transition' : 'map';
      this.state.phase = 'talent';
      return;
    }
    if ((state.routeMap?.path.length ?? this.state.nodes.length) >= (this.state.act === 5 ? 1 : 11)) {
      if (this.state.act < 5 && node.type === 'B') {
        this.state.phase = 'transition';
      } else if (this.state.act === 5) {
        this.state.phase = 'won';
      } else {
        this.state.phase = 'transition';
      }
    } else {
      this.state.phase = 'map';
    }
  }

  private travelNodeMatches(effect: AnyRecord, node: RunNode): boolean {
    const types = effect.params?.node_types ?? effect.params?.source_node_types;
    if (!Array.isArray(types) || !types.length) return true;
    return types.some((value: unknown) => {
      if (typeof value !== 'string') return false;
      if (value === 'open') return ['C', 'L', 'B'].includes(node.type);
      if (value === 'combat') return node.type === 'C';
      if (value === 'elite') return node.type === 'L';
      if (value === 'boss') return node.type === 'B';
      if (value === 'event') return node.type === 'E' || node.type === 'K';
      if (value === 'shop') return node.type === 'S';
      if (value === 'rest') return node.type === 'R';
      return value === node.type;
    });
  }

  private travelRequires(effect: AnyRecord, node: RunNode): boolean {
    const state = this.state as RunStateInternals;
    const requirements = Array.isArray(effect.requires) ? effect.requires : [];
    for (const requirement of requirements) {
      if (requirement === 'real_rest_completed' || requirement === 'real_rest_completed_alive') {
        if (node.type !== 'R' || (requirement.endsWith('_alive') && this.state.hp <= 0)) return false;
      } else if (requirement === 'real_nonbattle_node_completed') {
        if (!['E', 'K', 'S', 'R'].includes(node.type)) return false;
      } else if (requirement === 'real_battle_node_completed_alive') {
        if (!['C', 'L', 'B'].includes(node.type) || this.state.hp <= 0) return false;
      } else if (requirement === 'real_open_node_completed_alive' || requirement === 'real_node_completed_alive') {
        if (node.type === 'F' || this.state.hp <= 0) return false;
      } else if (requirement === 'two_consecutive_nodes_completed') {
        const needed = integer(effect.params?.consecutive_completed_nodes)
          ? effect.params.consecutive_completed_nodes
          : 2;
        if (!needed || (state._consecutiveNodes ?? 0) < needed ||
          (state._consecutiveNodes ?? 0) % needed !== 0) return false;
      } else if (requirement === 'travel_sequence_heal_turn') {
        if ((state._methodTravelSequence ?? 'heal') !== 'heal') return false;
      } else if (requirement === 'travel_sequence_xp_turn') {
        if ((state._methodTravelSequence ?? 'heal') !== 'xp') return false;
      } else if (requirement === 'requires_alive' && this.state.hp <= 0) {
        return false;
      }
    }
    return true;
  }

  private travelAmount(effect: AnyRecord, sourceStats: Stats, stacks = 1): number {
    const params = effect.params ?? {};
    let amount: number;
    if (finite(params.amount_ratio)) amount = params.amount_ratio * sourceStats.max_hp;
    else if (finite(params.ratio) && params.basis === 'max_hp') amount = params.ratio * sourceStats.max_hp;
    else if (finite(params.amount)) {
      switch (params.basis) {
        case 'max_hp':
          amount = params.amount * sourceStats.max_hp;
          break;
        case 'reference_hp':
          amount = params.amount * currentReferenceHp(this.content, this.state.act);
          break;
        case 'flat':
        case undefined:
          amount = params.amount;
          break;
        default:
          throw new Error(`Unknown travel amount basis: ${params.basis}`);
      }
    } else if (finite(params.ratio)) {
      amount = params.ratio * sourceStats.max_hp;
    } else {
      throw new Error(`Invalid travel amount for ${effect.id ?? 'effect'}`);
    }
    if (!finite(amount) || amount < 0) throw new Error(`Invalid travel amount for ${effect.id ?? 'effect'}`);
    return amount * stacks;
  }

  private sourceStats(source: RunState['nodeEntry']): Stats {
    const result = worker().calculateStats(this.content, {
      name: this.state.name,
      method: source?.method ?? this.state.method,
      n: this.state.n,
      talents: clone(source?.talents ?? this.state.talents[this.state.method] ?? []),
      artifacts: clone(source?.artifacts ?? equippedArtifactStacks(this.state)),
      baseStats: baseStats(this.content, this.state.n),
      hp: this.state.hp,
      preparation: 0,
      journey: journeyContext(this.state),
    });
    if (!isObject(result) || !['attack', 'defense', 'max_hp', 'crit_rate', 'speed']
      .every(key => finite(result[key as keyof Stats]))) {
      throw new Error('Combat worker returned invalid travel stats');
    }
    return {
      attack: result.attack,
      defense: result.defense,
      max_hp: result.max_hp,
      crit_rate: result.crit_rate,
      speed: result.speed,
    };
  }

  private applyTravelEffect(
    effect: AnyRecord,
    node: RunNode,
    sourceStats: Stats,
    stacks = 1,
  ): boolean {
    const state = this.state as RunStateInternals;
    if (!this.travelNodeMatches(effect, node) || !this.travelRequires(effect, node)) return false;
    if (effect.params?.only_if_alive === true && this.state.hp <= 0) return false;
    if (effect.params?.non_battle_only === true && ['C', 'L', 'B'].includes(node.type)) return false;
    if (effect.params?.sequence_value &&
      (state._methodTravelSequence ?? effect.params.sequence_starts_with ?? 'heal') !== effect.params.sequence_value) {
      return false;
    }
    const params = effect.params ?? {};
    // Sequence effects are advanced once after all node rewards, not valued as resources.
    if (effect.operation === 'advance_phase') return false;
    const amount = effect.operation === 'prepare_next_battle' && params.preparation === 'first_strike'
      ? sourceStats.attack * (finite(params.attack_ratio) ? params.attack_ratio : 0) * stacks
      : this.travelAmount(effect, sourceStats, stacks);
    switch (effect.operation) {
      case 'grant_resource': {
        if (!['hp', 'coins', 'xp'].includes(params.resource)) throw new Error(`Unknown travel resource: ${params.resource}`);
        if (params.defer_until === 'next_nonbattle_node') {
          state._pendingTravelResources ??= {};
          state._pendingTravelResourceKinds ??= {};
          const key = typeof params.pending_resource_key === 'string'
            ? params.pending_resource_key
            : effect.id;
          if (!finite(state._pendingTravelResources[key]) || state._pendingTravelResources[key] <= 0) {
            state._pendingTravelResources[key] = amount;
          }
          state._pendingTravelResourceKinds[key] = params.resource;
        } else {
          this.applyResource(params.resource, amount);
        }
        return true;
      }
      case 'heal':
        this.state.hp = Math.min(this.stats.max_hp, this.state.hp + amount);
        return true;
      case 'prepare_next_battle':
        if (params.preparation === 'first_strike') {
          const maxPreparations = integer(params.max_preparations) ? params.max_preparations : 1;
          if (maxPreparations > 0 && (this.state.firstStrike ?? 0) <= 0) this.state.firstStrike = amount;
        } else {
          this.state.preparation += amount;
        }
        return true;
      default:
        return false;
    }
  }

  private applyTravel(node: RunNode, source: RunState['nodeEntry']): void {
    const state = this.state as RunStateInternals;
    const entry = source ?? snapshotEntry(state)!;
    const currentlyEquipped = new Map(equippedArtifactStacks(state).map(stack => [stack.id, stack]));
    const travelSource: NonNullable<RunState['nodeEntry']> = {
      method: entry.method,
      talents: entry.talents.slice(),
      artifacts: entry.artifacts.flatMap(stack => {
        const current = currentlyEquipped.get(stack.id);
        if (!current) return [];
        const stacks = Math.min(stack.stacks, current.stacks);
        return stacks > 0 ? [{ id: stack.id, stacks }] : [];
      }),
    };
    const sourceMethod = travelSource.method;
    const sourceStats = this.sourceStats(travelSource);
    const method = methodEntity(this.content, sourceMethod);
    const isBattle = ['C', 'L', 'B'].includes(node.type);
    const isNonBattle = ['E', 'K', 'S', 'R'].includes(node.type);
    const methodTravel = Array.isArray(method.travel) ? method.travel.filter(isObject) : [];
    state._methodConsecutiveNodes ??= {};
    if (sourceMethod === 'RKF05') {
      const count = (state._methodConsecutiveNodes.RKF05 ?? 0) + 1;
      state._methodConsecutiveNodes.RKF05 = count;
      state._consecutiveNodes = count;
    } else {
      state._consecutiveNodes = 0;
    }
    if (isNonBattle) {
      const pending = state._pendingTravelResources ?? {};
      const pendingKinds = state._pendingTravelResourceKinds ?? {};
      let claimedPendingCoins = false;
      for (const [key, amount] of Object.entries(pending)) {
        if (!finite(amount) || amount <= 0) continue;
        const effect = methodTravel.find(candidate => candidate.id === key);
        const resource = pendingKinds[key] ?? effect?.params?.resource ??
          (key === 'RKF07-TRAVEL-COINS' ? 'coins' : undefined);
        if (resource && ['hp', 'coins', 'xp'].includes(resource)) this.applyResource(resource, amount);
        if (resource === 'coins') claimedPendingCoins = true;
      }
      state._pendingTravelResources = {};
      state._pendingTravelResourceKinds = {};
      if (finite(state._pendingTravelCoins) && state._pendingTravelCoins > 0) {
        // `_pendingTravelCoins` predates the typed pending-resource map.  Keep
        // it readable for old saves, but never pay the same pending grant
        // twice when both representations are present.
        if (!claimedPendingCoins) this.state.coins += state._pendingTravelCoins;
        state._pendingTravelCoins = 0;
      }
    }
    for (const effect of methodTravel) {
      const trigger = effect.trigger;
      if (trigger !== 'node_complete' &&
        !(trigger === 'rest_complete' && node.type === 'R') &&
        !(trigger === 'battle_node_complete' && isBattle)) continue;
      this.applyTravelEffect(effect, node, sourceStats);
    }
    for (const stack of travelSource.artifacts) {
      const artifact = contentEntity(this.content, stack.id);
      if (!artifact) continue;
      for (const effect of Array.isArray(artifact.effects) ? artifact.effects.filter(isObject) : []) {
        if (effect.trigger !== 'node_complete' &&
          !(effect.trigger === 'battle_node_complete' && isBattle)) continue;
        this.applyTravelEffect(effect, node, sourceStats, stack.stacks);
      }
    }
    if (sourceMethod === 'RKF10' && this.state.hp > 0) {
      const sequenceEffect = methodTravel.find(effect =>
        effect.operation === 'advance_phase' && effect.params?.scope === 'method_travel');
      if (sequenceEffect) {
        const order = Array.isArray(sequenceEffect.params?.order)
          ? sequenceEffect.params.order.filter((value: unknown): value is 'heal' | 'xp' => value === 'heal' || value === 'xp')
          : ['heal', 'xp'];
        const current = state._methodTravelSequence ?? sequenceEffect.params?.initial ?? order[0] ?? 'heal';
        const index = order.indexOf(current);
        state._methodTravelSequence = order[(index + 1 + order.length) % order.length] ?? current;
      }
    }
    this.state.n = Math.max(0, Math.min(4, this.state.n));
    this.ensureTalentQueue();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function restore(target: AnyRecord, source: AnyRecord): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, clone(source));
}

function ensureStateInternals(content: Content, state: RunStateInternals): void {
  if (!Array.isArray(state.routes) || !Array.isArray(state.nodes) ||
    !Array.isArray(state.ownedMethods) || !isObject(state.talents)) {
    throw new Error('Invalid run state collections');
  }
  if (state.firstStrike === undefined) state.firstStrike = 0;
  if (state.eventCommitments === undefined) state.eventCommitments = [];
  if (state.firstStrike !== undefined && (!finite(state.firstStrike) || state.firstStrike < 0)) {
    throw new Error('Invalid first strike');
  }
  if (state._routeHistory !== undefined && !Array.isArray(state._routeHistory)) throw new Error('Invalid route history');
  if (state._seenEnemyIds !== undefined && !Array.isArray(state._seenEnemyIds)) throw new Error('Invalid enemy history');
  if (state._corePositions !== undefined && !Array.isArray(state._corePositions)) throw new Error('Invalid core positions');
  if (state._nodeEnemyByKey !== undefined && !isObject(state._nodeEnemyByKey)) throw new Error('Invalid enemy map');
  if (state._bossEnemyByAct !== undefined && !isObject(state._bossEnemyByAct)) throw new Error('Invalid boss map');
  if (state._methodConsecutiveNodes !== undefined && !isObject(state._methodConsecutiveNodes)) {
    throw new Error('Invalid method travel counters');
  }
  if (state._travelSnapshots !== undefined && !Array.isArray(state._travelSnapshots)) throw new Error('Invalid travel snapshots');
  if (state.rewardRefinements !== undefined && !Array.isArray(state.rewardRefinements)) {
    throw new Error('Invalid reward refinement history');
  }
  if (state._talentQueue !== undefined && !Array.isArray(state._talentQueue)) throw new Error('Invalid talent queue');
  if (state._pendingTravelResources !== undefined && !isObject(state._pendingTravelResources)) {
    throw new Error('Invalid pending travel resources');
  }
  if (state._pendingTravelResourceKinds !== undefined && !isObject(state._pendingTravelResourceKinds)) {
    throw new Error('Invalid pending travel resource kinds');
  }
  if (state.seenEvents !== undefined && !Array.isArray(state.seenEvents)) throw new Error('Invalid seen events');
  if (state.completedCore !== undefined && !Array.isArray(state.completedCore)) throw new Error('Invalid completed core');
  if (state.rewardCandidates !== undefined && !Array.isArray(state.rewardCandidates)) throw new Error('Invalid reward candidates');
  if (state.shop !== undefined && !Array.isArray(state.shop)) throw new Error('Invalid shop');
  if (state.flags !== undefined && !isObject(state.flags)) throw new Error('Invalid flags');
  if (state._returnPhase !== undefined && !PHASES.includes(state._returnPhase)) throw new Error('Invalid return phase');
  if (state.returnPhase !== undefined && !PHASES.includes(state.returnPhase)) throw new Error('Invalid public return phase');
  for (const key of [
    '_battleSettled',
    '_eventRewardApplied',
    '_swapAvailable',
    '_eventCostTravelApplied',
    '_rewardSettled',
    '_eventSettled',
  ] as const) {
    if (state[key] !== undefined && typeof state[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  }
  if (state._previewKind !== undefined && !['node', 'event'].includes(state._previewKind)) {
    throw new Error('Invalid preview kind');
  }
  if (state._battleKind !== undefined && !['node', 'event'].includes(state._battleKind)) {
    throw new Error('Invalid battle kind');
  }
  if (state._eventOutcome !== undefined && !['success', 'failure'].includes(state._eventOutcome)) {
    throw new Error('Invalid event outcome');
  }
  if (state._methodTravelSequence !== undefined && !['heal', 'xp'].includes(state._methodTravelSequence)) {
    throw new Error('Invalid method travel sequence');
  }
  if (state._pendingTravelCoins !== undefined &&
    (!finite(state._pendingTravelCoins) || state._pendingTravelCoins < 0)) {
    throw new Error('Invalid pending travel coins');
  }
  state._routeHistory ??= state.routes.slice();
  state._seenEnemyIds ??= [];
  state._corePositions ??= [];
  state._nodeEnemyByKey ??= {};
  state._bossEnemyByAct ??= {};
  state._travelSnapshots ??= [];
  state._talentQueue ??= [];
  state._consecutiveNodes ??= 0;
  state._methodConsecutiveNodes ??= state._consecutiveNodes > 0 ? { RKF05: state._consecutiveNodes } : {};
  state._plannedStoryline ??= state.storyline;
  state._independentCore ??= state.independentCore;
  state._pendingTravelResources ??= {};
  state._pendingTravelResourceKinds ??= {};
  state._returnPhase ??= state.returnPhase;
  if (state.seenEvents === undefined) state.seenEvents = [];
  if (state.completedCore === undefined) state.completedCore = [];
  if (state.rewardCandidates === undefined) state.rewardCandidates = [];
  if (state.shop === undefined) state.shop = [];
  if (state.flags === undefined) state.flags = {};
  if (!state.talents[state.method]) state.talents[state.method] = [];
  if (state.nodeEntry && !state._nodeEntry) state._nodeEntry = clone(state.nodeEntry);
  void content;
}

function validateFusionInventory(content: Content, inventory: unknown): asserts inventory is ArtifactStack[] {
  if (!Array.isArray(inventory) || inventory.length > 128) throw new Error('Invalid fusion inventory snapshot');
  const ids = new Set<string>();
  const groups = new Set<string>();
  for (const stack of inventory) {
    const artifact = isObject(stack) && typeof stack.id === 'string'
      ? contentEntity(content, stack.id) : undefined;
    if (!isObject(stack) || !integer(stack.stacks) || stack.stacks <= 0 || ids.has(stack.id) ||
      !artifact || artifact.kind !== 'artifact' || !artifactRole(content, stack.id) ||
      stack.stacks > (integer(artifact.max_stacks) ? artifact.max_stacks : 1) ||
      (artifact.unique_group && groups.has(artifact.unique_group))) {
      throw new Error('Invalid fusion inventory snapshot');
    }
    ids.add(stack.id);
    if (artifact.unique_group) groups.add(artifact.unique_group);
  }
}

function validateFusionState(content: Content, state: RunStateInternals): void {
  const recipes = fusionRecipes(content);
  if (!Array.isArray(state.fusionProgress) || state.fusionProgress.length !== recipes.length ||
    !Array.isArray(state.fusionHistory) || state.fusionHistory.length > recipes.length) {
    throw new Error('Invalid fusion state collections');
  }

  let previousHistoryPosition = -1;
  let previousHistoryId = '';
  const historyIds = new Set<string>();
  for (const record of state.fusionHistory) {
    const recipe = recipes.find(candidate => candidate.id === record?.id);
    const expectedText = recipe ? fusionCompletionText(content, recipe) : '';
    const position = isObject(record) && integer(record.act) && integer(record.step)
      ? (record.act - 1) * 11 + record.step : -1;
    if (!isObject(record) || Object.keys(record).length !== 5 ||
      !['id', 'act', 'step', 'title', 'text'].every(key => Object.prototype.hasOwnProperty.call(record, key)) ||
      !recipe || historyIds.has(record.id) || !integer(record.act) || record.act < 1 || record.act > 5 ||
      !integer(record.step) || record.step < 0 || record.step > (record.act === 5 ? 0 : 10) ||
      record.act > state.act || (record.act === state.act && record.step > state.step) ||
      record.title !== recipe.name || record.text !== expectedText ||
      position < previousHistoryPosition ||
      (position === previousHistoryPosition && record.id <= previousHistoryId)) {
      throw new Error('Invalid fusion history entry');
    }
    previousHistoryPosition = position;
    previousHistoryId = record.id;
    historyIds.add(record.id);
  }

  const progressIds = new Set<string>();
  for (let index = 0; index < recipes.length; index++) {
    const recipe = recipes[index]!;
    const progress = state.fusionProgress[index];
    if (!isObject(progress) || Object.keys(progress).length !== 2 || progress.id !== recipe.id ||
      !Array.isArray(progress.wins) || progress.wins.length > recipe.fights ||
      progressIds.has(progress.id)) {
      throw new Error('Invalid fusion progress');
    }
    progressIds.add(progress.id);
    let previousPosition = -1;
    const coordinates = new Set<string>();
    for (const win of progress.wins) {
      if (!isObject(win) || Object.keys(win).length !== 6 ||
        !['act', 'step', 'kind', 'enemyId', 'entryInventory', 'settlementInventory']
          .every(key => Object.prototype.hasOwnProperty.call(win, key)) ||
        !integer(win.act) || win.act < 1 || win.act > 5 ||
        !integer(win.step) || win.step < 0 || win.step > (win.act === 5 ? 0 : 10) ||
        win.act > state.act || (win.act === state.act && win.step > state.step) ||
        !['node', 'event'].includes(win.kind) || typeof win.enemyId !== 'string') {
        throw new Error('Invalid fusion win evidence');
      }
      validateFusionInventory(content, win.entryInventory);
      validateFusionInventory(content, win.settlementInventory);
      if (!inventoryHasInputs(win.entryInventory, recipe) ||
        !inventoryHasInputs(win.settlementInventory, recipe)) {
        throw new Error('Fusion win did not hold both inputs at entry and settlement');
      }
      const enemy = contentEntity(content, win.enemyId);
      if (!enemy || enemy.kind !== 'enemy') throw new Error('Invalid fusion battle enemy');
      const position = (win.act - 1) * 11 + win.step;
      const coordinate = `${win.act}:${win.step}`;
      if (position <= previousPosition || coordinates.has(coordinate)) {
        throw new Error('Invalid fusion win order');
      }
      previousPosition = position;
      coordinates.add(coordinate);

      const currentEntry = state._fusionBattleEntry;
      const isCurrentSettledVictory = currentEntry?.act === win.act && currentEntry.step === win.step &&
        currentEntry.kind === win.kind && currentEntry.enemyId === win.enemyId &&
        state._battleSettled === true && state.battle?.outcome === 'player' &&
        sameInventory(currentEntry.inventory, win.entryInventory) &&
        sameInventory(currentEntry.settlementInventory ?? [], win.settlementInventory);
      const historyEntries = state.history.filter(entry => entry.act === win.act && entry.step === win.step);
      const hasMatchingCompletedHistory = win.kind === 'event'
        ? historyEntries.some(entry => {
          const event = typeof entry.eventId === 'string' ? contentEntity(content, entry.eventId) : undefined;
          const option = event?.kind === 'event' && typeof entry.optionId === 'string'
            ? eventOption(event, entry.optionId) : undefined;
          return entry.eventOutcome === 'success' && option?.encounter?.enemy_id === win.enemyId;
        })
        : historyEntries.some(entry => entry.title === enemy.name);
      if (!isCurrentSettledVictory && !hasMatchingCompletedHistory) {
        throw new Error('Fusion win does not match a completed victory');
      }
    }
    const completion = state.fusionHistory.find(record => record.id === recipe.id);
    if ((progress.wins.length === recipe.fights) !== !!completion ||
      (completion && (progress.wins.at(-1)?.act !== completion.act ||
        progress.wins.at(-1)?.step !== completion.step))) {
      throw new Error('Fusion completion does not match its progress');
    }
  }

  if (state._fusionBattleEntry !== undefined) {
    const entry = state._fusionBattleEntry;
    const entryKeys = ['act', 'step', 'kind', 'enemyId', 'inventory', 'eligibleRecipes', 'settlementInventory'];
    const hasSettlementInventory = isObject(entry) &&
      Object.prototype.hasOwnProperty.call(entry, 'settlementInventory');
    if (!isObject(entry) || !integer(entry.act) || entry.act !== state.act ||
      !integer(entry.step) || entry.step !== state.step ||
      !['node', 'event'].includes(entry.kind) || !Array.isArray(entry.eligibleRecipes) ||
      !Array.isArray(entry.inventory) || typeof entry.enemyId !== 'string' ||
      !state.battleInput || !state.battle || state._battleKind !== entry.kind ||
      typeof state._battleSettled !== 'boolean' ||
      Object.keys(entry).length !== (hasSettlementInventory ? 7 : 6) ||
      Object.keys(entry).some(key => !entryKeys.includes(key))) {
      throw new Error('Invalid frozen fusion battle entry');
    }
    validateFusionInventory(content, entry.inventory);
    const expectedEligible = recipes
      .filter(recipe => inventoryHasInputs(entry.inventory, recipe))
      .map(recipe => recipe.id);
    if (JSON.stringify(entry.eligibleRecipes) !== JSON.stringify(expectedEligible)) {
      throw new Error('Frozen fusion eligibility does not match battle entry inventory');
    }
    const node = state.nodes[state.step];
    const expectedEnemyId = entry.kind === 'event'
      ? state._pendingEvent?.enemyId ?? (() => {
        const event = node ? contentEntity(content, node.id) : undefined;
        const option = event?.kind === 'event' && typeof state.eventOption === 'string'
          ? eventOption(event, state.eventOption) : undefined;
        return option?.encounter?.enemy_id;
      })()
      : state._challengeEliteEnemyId ?? node?.id;
    if (expectedEnemyId !== entry.enemyId || state.battleInput.enemy.name !== contentEntity(content, entry.enemyId)?.name) {
      throw new Error('Frozen fusion battle identity mismatch');
    }
    if (state._battleSettled === true) {
      if (!hasSettlementInventory || !Array.isArray(entry.settlementInventory) || state.battle.outcome === 'draw') {
        throw new Error('Settled battle is missing its fusion settlement snapshot');
      }
      validateFusionInventory(content, entry.settlementInventory);
    } else if (hasSettlementInventory) {
      throw new Error('Unsettled battle has a fusion settlement snapshot');
    }
  } else if (state.battleInput !== undefined) {
    throw new Error('Battle input has no frozen fusion eligibility');
  }
}

export function validateBattleResult(result: BattleResult): void {
  if (!isObject(result) || !['player', 'enemy', 'draw'].includes(result.outcome)) throw new Error('Invalid battle outcome');
  if (!integer(result.rounds) || result.rounds < 0 || !finite(result.playerHp) || !finite(result.enemyHp)) throw new Error('Invalid battle result numbers');
  if (!Array.isArray(result.frames) || result.frames.length > 20000 || !Array.isArray(result.contributions)) throw new Error('Invalid battle result frames');
  if (!allFiniteNumbers(result)) throw new Error('Non-finite battle result');
  for (const frame of result.frames) {
    if (!isObject(frame)) {
      throw new Error('Invalid battle frame');
    }
    for (const side of ['player', 'enemy'] as const) {
      if (frame[side] === undefined) continue;
      if (!isObject(frame[side])) throw new Error('Invalid battle fighter view');
      const fighter = frame[side];
      if (fighter.summons === undefined) continue;
      if (!Array.isArray(fighter.summons) || fighter.summons.length > 16) {
        throw new Error('Invalid battle summons');
      }
      const summonIds = new Set<string>();
      for (const summon of fighter.summons) {
        if (!isObject(summon) || Object.keys(summon).length !== 4 ||
          !['id', 'kind', 'count', 'max'].every(key => Object.prototype.hasOwnProperty.call(summon, key)) ||
          summon.id !== 'RKF05-V2-RESONANCE' || summon.kind !== 'sword' ||
          fighter.method !== 'RKF05' || summonIds.has(summon.id) ||
          !Number.isSafeInteger(summon.count) || summon.count < 0 ||
          !Number.isSafeInteger(summon.max) || summon.max < 1 ||
          summon.count > summon.max) {
          throw new Error('Invalid battle summon source or bounds');
        }
        summonIds.add(summon.id);
      }
    }
    if (frame.kind === 'reaction' && frame.cue === undefined) {
      throw new Error('Reaction frame is missing its cue');
    }
    if (frame.cue === undefined) continue;
    const cue = frame.cue;
    const countedCue = isObject(cue) && cue.kind === 'rage_chain';
    if (!isObject(cue) || Object.keys(cue).length !== (countedCue ? 4 : 3) ||
      !['kind', 'owner', 'sourceId'].every(key => Object.prototype.hasOwnProperty.call(cue, key)) ||
      (countedCue && !Object.prototype.hasOwnProperty.call(cue, 'count')) ||
      (!countedCue && Object.prototype.hasOwnProperty.call(cue, 'count')) ||
      !['sword_volley', 'guard_counter', 'spring_bloom', 'enemy_charge', 'enemy_release',
        'rage_chain', 'companion_assist'].includes(cue.kind) ||
      !['player', 'enemy'].includes(cue.owner) ||
      typeof cue.sourceId !== 'string' || cue.sourceId.length < 1 || cue.sourceId.length > 128) {
      throw new Error('Invalid battle reaction cue');
    }
    if (cue.kind === 'rage_chain' && (!integer(cue.count) || ![2, 3].includes(cue.count))) {
      throw new Error('Invalid V2 reaction cue data');
    }
    const expectedSources: Partial<Record<NonNullable<BattleFrame['cue']>['kind'], string>> = {
      sword_volley: 'RKF05-V2-RESONANCE',
      guard_counter: 'RKF01-V2-RESONANCE',
      spring_bloom: 'RKF03-V2-RESONANCE',
    };
    const expectedSource = expectedSources[cue.kind];
    if (expectedSource && cue.sourceId !== expectedSource) {
      throw new Error('Battle reaction cue has invalid source');
    }
    if ((cue.kind === 'enemy_charge' || cue.kind === 'enemy_release') &&
      (!['EN-A1-B1', 'EN-A1-B2'].includes(cue.sourceId) || cue.owner !== 'enemy')) {
      throw new Error('Enemy trial cue has invalid source or side');
    }
    if (cue.kind === 'rage_chain' && !/^RKF\d{2}-RAGE-CHAIN$/.test(cue.sourceId)) {
      throw new Error('Rage-chain cue has invalid source');
    }
    if (cue.kind === 'companion_assist' && !/^RKF\d{2}-COMPANION$/.test(cue.sourceId)) {
      throw new Error('Companion-assist cue has invalid source');
    }
    if ((cue.kind === 'rage_chain' || cue.kind === 'companion_assist') && frame.kind !== 'reaction') {
      throw new Error('V2 reaction cue is attached to a non-reaction frame');
    }
    if (frame.kind === 'reaction') {
      const expectedTarget = cue.kind === 'enemy_charge'
        ? cue.owner
        : cue.owner === 'player' ? 'enemy' : 'player';
      if (frame.actor !== cue.owner || frame.target !== expectedTarget || frame.source !== cue.sourceId) {
        throw new Error('Battle reaction cue has invalid source or side');
      }
      if (cue.kind === 'enemy_charge' || cue.kind === 'enemy_release') {
        if ((cue.kind === 'enemy_charge' && frame.target !== 'enemy') ||
          (cue.kind === 'enemy_release' && frame.target !== 'player')) {
          throw new Error('Enemy trial cue has invalid target side');
        }
      }
      if (cue.kind === 'rage_chain' || cue.kind === 'companion_assist') {
        if (frame.actor !== cue.owner || frame.target === cue.owner) {
          throw new Error('V2 reaction cue has invalid owner or target');
        }
      }
    } else if (cue.kind === 'enemy_charge' && frame.kind === 'status' &&
      (cue.sourceId !== 'EN-A1-B1' && cue.sourceId !== 'EN-A1-B2' ||
        cue.owner !== 'enemy' || frame.actor !== 'player' || frame.target !== 'enemy' ||
        typeof frame.source !== 'string' || frame.source.length === 0)) {
      throw new Error('Enemy trial interruption cue has invalid source or side');
    }
  }
}

function validateBattleCuesAgainstInput(
  result: BattleResult,
  input: { player: Loadout; enemy: Loadout },
): void {
  for (const frame of result.frames) {
    const cue = frame.cue;
    if (!cue) continue;
    if (cue.kind === 'rage_chain') {
      const owner = cue.owner === 'player' ? input.player : input.enemy;
      if (cue.sourceId !== `${owner.method}-RAGE-CHAIN`) {
        throw new Error('Rage-chain source does not match its battle owner');
      }
    } else if (cue.kind === 'companion_assist') {
      const owner = cue.owner === 'player' ? input.player : input.enemy;
      if (!owner.companion || cue.sourceId !== `${owner.companion}-COMPANION`) {
        throw new Error('Companion-assist source does not match the frozen companion');
      }
    }
  }
}

function validateLoadoutReferences(
  content: Content,
  loadout: Loadout,
  enemy = false,
  ownedMethods?: string[],
): void {
  if (!isObject(loadout) || typeof loadout.name !== 'string' || typeof loadout.method !== 'string' ||
    !integer(loadout.n) || loadout.n < 0 || loadout.n > 4 || !Array.isArray(loadout.talents) ||
    !Array.isArray(loadout.artifacts)) throw new Error('Invalid saved loadout');
  if (loadout.companion !== undefined) {
    const companion = typeof loadout.companion === 'string'
      ? contentEntity(content, loadout.companion)
      : undefined;
    if (!companion || companion.kind !== 'method' || companion.id === loadout.method ||
      (!enemy && (!ownedMethods?.includes(companion.id) ||
        ownedMethods.find(id => id !== loadout.method) !== companion.id)) ||
      !isObject(companion.companion) || typeof companion.companion.name !== 'string' ||
      typeof companion.companion.quick !== 'string' || !companion.companion.effect) {
      throw new Error(enemy ? 'Invalid saved enemy companion' : 'Invalid saved companion ownership');
    }
  }
  if ((enemy && loadout.thunderChallenge !== undefined && loadout.thunderChallenge !== true) ||
    (!enemy && loadout.thunderChallenge !== undefined) ||
    (!enemy && loadout.companion !== undefined && typeof loadout.companion !== 'string')) {
    throw new Error('Invalid saved loadout challenge or companion');
  }
  if (loadout.encounterId !== undefined) {
    const encounter = typeof loadout.encounterId === 'string'
      ? contentEntity(content, loadout.encounterId)
      : undefined;
    if (!enemy || !encounter || encounter.kind !== 'enemy' || !isObject(encounter.trial)) {
      throw new Error('Invalid saved enemy encounter reference');
    }
  }
  const method = contentEntity(content, loadout.method);
  if (!method || method.kind !== 'method') throw new Error('Invalid saved loadout method');
  const tiers = new Set<number>();
  for (const id of loadout.talents) {
    if (typeof id !== 'string') throw new Error('Invalid saved talent ID');
    const talent = talentEntity(content, method.id, id);
    if (!talent || !integer(talent.tier) || talent.tier < 1 || talent.tier > 4 ||
      talent.tier > loadout.n || tiers.has(talent.tier)) {
      throw new Error('Invalid saved loadout talent');
    }
    tiers.add(talent.tier);
  }
  const ids = new Set<string>();
  const groups = new Set<string>();
  for (const stack of loadout.artifacts) {
    if (!isObject(stack) || typeof stack.id !== 'string' || !integer(stack.stacks) || stack.stacks <= 0 || ids.has(stack.id)) {
      throw new Error('Invalid saved loadout artifact');
    }
    ids.add(stack.id);
    const artifact = contentEntity(content, stack.id);
    if (!artifact || artifact.kind !== 'artifact' ||
      stack.stacks > (integer(artifact.max_stacks) ? artifact.max_stacks : 1)) throw new Error('Invalid saved loadout artifact');
    const role = artifactRole(content, stack.id);
    if (!role) throw new Error('Invalid saved loadout artifact role');
    if (artifact.unique_group) {
      if (groups.has(artifact.unique_group)) throw new Error('Invalid saved unique artifact group');
      groups.add(artifact.unique_group);
    }
  }
  if (ids.size > MAX_EQUIPMENT_SLOTS) {
    throw new Error(enemy ? 'Invalid enemy equipment slots' : 'Invalid player equipment slots');
  }
  if (loadout.hp !== undefined && (!finite(loadout.hp) || loadout.hp < 0)) {
    throw new Error(enemy ? 'Invalid saved enemy HP' : 'Invalid saved player loadout HP');
  }
  if (loadout.preparation !== undefined && (!finite(loadout.preparation) || loadout.preparation < 0)) {
    throw new Error(enemy ? 'Invalid saved enemy preparation' : 'Invalid saved player preparation');
  }
  if (loadout.firstStrike !== undefined && (!finite(loadout.firstStrike) || loadout.firstStrike < 0)) {
    throw new Error('Invalid saved first strike');
  }
  if (!enemy && (!finite(loadout.hp) || loadout.hp < 0 || !finite(loadout.preparation) || loadout.preparation < 0)) {
    throw new Error('Invalid saved player loadout resources');
  }
  if (loadout.journey !== undefined &&
    (!isObject(loadout.journey) ||
      !finite(loadout.journey.coins) || loadout.journey.coins < 0 ||
      !finite(loadout.journey.coinsSpent) || loadout.journey.coinsSpent < 0 ||
      !integer(loadout.journey.eliteWins) || loadout.journey.eliteWins < 0 ||
      !integer(loadout.journey.bossWins) || loadout.journey.bossWins < 0 ||
      !integer(loadout.journey.artifactKinds) || loadout.journey.artifactKinds < 0 ||
      !integer(loadout.journey.knownMethods) || loadout.journey.knownMethods < 0)) {
    throw new Error('Invalid saved journey context');
  }
  if (loadout.baseStats && (!isObject(loadout.baseStats) ||
    !['attack', 'defense', 'max_hp', 'crit_rate', 'speed'].every(key => finite(loadout.baseStats?.[key as keyof Stats])) ||
    loadout.baseStats.max_hp < 0)) {
    throw new Error('Invalid saved loadout stats');
  }
}

function validateNodeEntrySnapshot(
  content: Content,
  state: RunStateInternals,
  entry: RunState['nodeEntry'] | undefined,
): void {
  if (!entry || typeof entry.method !== 'string' || !Array.isArray(entry.talents) ||
    !Array.isArray(entry.artifacts)) {
    throw new Error('Invalid node entry snapshot');
  }
  validateLoadoutReferences(content, {
    name: state.name,
    method: entry.method,
    n: state.n,
    talents: entry.talents,
    artifacts: entry.artifacts,
    hp: state.hp,
    preparation: state.preparation,
  });
}

function equalNodeEntry(
  left: RunState['nodeEntry'] | undefined,
  right: RunState['nodeEntry'] | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatePendingEncounter(content: Content, pending: EventEncounter): void {
  if (!isObject(pending) || typeof pending.eventId !== 'string' ||
    typeof pending.optionId !== 'string' || typeof pending.enemyId !== 'string' ||
    typeof pending.mode !== 'string' || !finite(pending.failureHpFloor) ||
    pending.failureHpFloor < 1 || !Array.isArray(pending.failureRewards) ||
    (pending.failureOutcome !== undefined && typeof pending.failureOutcome !== 'string')) {
    throw new Error('Invalid pending event encounter');
  }
  const event = contentEntity(content, pending.eventId);
  if (!event || event.kind !== 'event') throw new Error('Invalid pending event');
  const option = eventOption(event, pending.optionId);
  if (!option || !isObject(option.encounter)) throw new Error('Invalid pending event option');
  if (option.encounter.enemy_id !== pending.enemyId) throw new Error('Pending event enemy mismatch');
  if (!contentEntity(content, pending.enemyId) ||
    contentEntity(content, pending.enemyId)?.kind !== 'enemy') {
    throw new Error('Invalid pending event enemy');
  }
  if (pending.failureRewards.some(reward => !isObject(reward))) {
    throw new Error('Invalid pending event failure rewards');
  }
  const expected = eventEncounter(option, pending.eventId, content);
  if (!expected || expected.mode !== pending.mode ||
    expected.failureHpFloor !== pending.failureHpFloor ||
    JSON.stringify(expected.failureRewards) !== JSON.stringify(pending.failureRewards) ||
    expected.failureOutcome !== pending.failureOutcome) {
    throw new Error('Pending event encounter mismatch');
  }
}

function validateTalentDrafts(content: Content, state: RunStateInternals): void {
  if (!integer(state.talentDraftGeneration) || state.talentDraftGeneration < 0 ||
    !isObject(state.talentDrafts)) {
    throw new Error('Invalid talent draft state');
  }
  for (const [key, ids] of Object.entries(state.talentDrafts)) {
    const match = /^(RKF\d{2}):([1-4]):(0|[1-9]\d*)$/.exec(key);
    if (!match || !state.ownedMethods.includes(match[1]!) ||
      contentEntity(content, match[1]!)?.kind !== 'method' ||
      Number(match[3]) > state.talentDraftGeneration ||
      !Array.isArray(ids) || ids.length !== 3 ||
      ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      throw new Error('Invalid frozen talent draft');
    }
    const method = match[1]!;
    const tier = Number(match[2]);
    const local = methodTalents(content, method).filter(talent => talent.tier === tier);
    const shared = sharedTalents(content).filter(talent => talent.tier === tier);
    if ((tier === 1 && shared.length < 3) ||
      (tier > 1 && (local.length < 1 || shared.length < 2))) {
      throw new Error('Talent draft pool is incomplete');
    }
    const expected = tier === 1
      ? sample(shared, 3, seededRandom(`${state.seed}:talent-draft:${key}:shared`))
        .map(talent => talent.id)
      : [
        ...sample(local, 1, seededRandom(`${state.seed}:talent-draft:${key}:local`))
          .map(talent => talent.id),
        ...sample(shared, 2, seededRandom(`${state.seed}:talent-draft:${key}:shared`))
          .map(talent => talent.id),
      ];
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      throw new Error('Frozen talent draft does not match run seed');
    }
  }
}

export function validateRunState(content: Content, raw: RunState): void {
  content = normalizeContent(content);
  if (!isObject(raw)) throw new Error('Invalid run state');
  const state = raw as RunStateInternals;
  if (state.schema !== 1 || state.contentVersion !== content.version) throw new Error('Run/content version mismatch');
  rewardSeekingConfig(content);
  const refiningConfig = rewardRefiningConfig(content);
  if (state.buildVersion !== 5) throw new Error('Incompatible run build version');
  if (!Array.isArray(state.thunderChallenges)) throw new Error('Invalid thunder challenge history');
  if (!isObject(state.progress) ||
    !finite(state.progress.coinsSpent) || state.progress.coinsSpent < 0 ||
    !integer(state.progress.eliteWins) || state.progress.eliteWins < 0 ||
    !integer(state.progress.bossWins) || state.progress.bossWins < 0) {
    throw new Error('Invalid run progress');
  }
  if (typeof state.id !== 'string' || !state.id || typeof state.seed !== 'string' || typeof state.name !== 'string') throw new Error('Invalid run identity');
  if (!PHASES.includes(state.phase)) throw new Error('Invalid run phase');
  if (!integer(state.act) || state.act < 1 || state.act > 5 || !integer(state.step) || state.step < 0) throw new Error('Invalid run position');
  if (!METHOD_IDS.test(state.method) || !contentEntity(content, state.method)?.kind || contentEntity(content, state.method)?.kind !== 'method') throw new Error('Invalid current method');
  if (!Array.isArray(state.ownedMethods) || new Set(state.ownedMethods).size !== state.ownedMethods.length ||
    state.ownedMethods.some(id => typeof id !== 'string' || contentEntity(content, id)?.kind !== 'method') ||
    !state.ownedMethods.includes(state.method)) {
    throw new Error('Invalid owned methods');
  }
  if (!isObject(state.talents)) throw new Error('Invalid talent map');
  for (const [method, talents] of Object.entries(state.talents)) {
    if (!state.ownedMethods.includes(method) || !Array.isArray(talents) || new Set(talents).size !== talents.length) throw new Error('Invalid talent map');
    const tiers = new Set<number>();
    for (const id of talents) {
      const tier = talentTier(content, method, id);
      if (!tier || tier < 1 || tier > 4 || tiers.has(tier)) throw new Error('Invalid selected talent');
      tiers.add(tier);
    }
  }
  validateTalentDrafts(content, state);
  if (!integer(state.n) || state.n < 0 || state.n > 4 || !finite(state.hp) || state.hp < 0 ||
    !finite(state.xp) || state.xp < 0 || !finite(state.coins) || state.coins < 0 ||
    !finite(state.preparation) || state.preparation < 0 ||
    (state.firstStrike !== undefined && (!finite(state.firstStrike) || state.firstStrike < 0))) {
    throw new Error('Invalid run resources');
  }
  if (state._talentQueue) {
    const queued = new Set<string>();
    const unlocked = unlockedTier(content, state);
    for (const item of state._talentQueue) {
      if (!isObject(item) || typeof item.method !== 'string' || !state.ownedMethods.includes(item.method) ||
        !integer(item.tier) || item.tier < 1 || item.tier > 4 || typeof item.advance !== 'boolean') {
        throw new Error('Invalid talent queue item');
      }
      const talent = methodTalents(content, item.method).find(candidate => candidate.tier === item.tier);
      if (!talent || item.tier > unlocked) throw new Error('Invalid talent queue tier');
      const queueKey = `${item.method}:${item.tier}`;
      if (queued.has(queueKey)) throw new Error('Duplicate talent queue item');
      queued.add(queueKey);
      const draftKey = talentDraftKey(item.method, item.tier, state.talentDraftGeneration);
      if (!state.talentDrafts[draftKey]) throw new Error('Talent queue has no frozen draft');
      const selected = state.talents[item.method] ?? [];
      if (selected.some(id => talentTier(content, item.method, id) === item.tier)) {
        throw new Error('Talent queue conflicts with selected talent');
      }
      if (item.advance && item.tier !== state.n + 1) {
        throw new Error('Invalid advancing talent queue item');
      }
    }
  }
  if (state._returnPhase === 'shop') {
    const queue = state._talentQueue ?? [];
    const resetItem = Array.isArray(state.shop)
      ? state.shop.find(item => item.id === 'talent_reset' && item.kind === 'talent_reset')
      : undefined;
    const completedTiers = (state.talents[state.method] ?? [])
      .map(id => talentTier(content, state.method, id))
      .filter(integer);
    const remainingTiers = Array.from({ length: state.n }, (_value, index) => index + 1)
      .filter(tier => !completedTiers.includes(tier));
    if (state.phase !== 'talent' || state.n < 1 || !resetItem?.sold ||
      !queue.length || queue.length !== remainingTiers.length ||
      queue.some((item, index) => item.method !== state.method ||
        item.tier !== remainingTiers[index] || item.advance)) {
      throw new Error('Invalid shop talent reset queue');
    }
  }
  if (!Array.isArray(state.nodes) || !Array.isArray(state.routes) || !Array.isArray(state.artifacts) ||
    !Array.isArray(state.history)) throw new Error('Invalid run collections');
  validateEquipment(content, state);
  assertEventCommitmentRecords(state.eventCommitments);
  for (const record of state.eventCommitments ?? []) {
    const source = contentEntity(content, record.eventId);
    const option = source?.options?.find((candidate: AnyRecord) => candidate.id === record.optionId);
    const definition = option?.commitment ?? option?.legacy_commitment;
    if (source?.kind !== 'event' || !definition ||
      JSON.stringify(record.snapshot) !== JSON.stringify(createEventCommitment(
        record.eventId, record.optionId,
        { act: record.originAct, step: record.originStep }, definition,
      ).snapshot)) throw new Error('Invalid event commitment source');
    const originPosition = (record.originAct - 1) * 11 + record.originStep;
    const currentPosition = (state.act - 1) * 11 + state.step + 1;
    const origin = state.history.find(entry =>
      entry.act === record.originAct && entry.step + 1 === record.originStep);
    const pendingOrigin = originPosition === currentPosition &&
      ['event_result', 'talent'].includes(state.phase) &&
      ['E', 'K'].includes(state.nodes[state.step]?.type ?? '') &&
      state.nodes[state.step]?.id === record.eventId && state.eventOption === record.optionId;
    if ((!pendingOrigin && (origin?.eventId !== record.eventId || origin?.optionId !== record.optionId)) ||
      originPosition > currentPosition || record.processedNodes.some(key => {
      const [act, step] = key.split(':').map(Number);
      return !state.history.some(entry => entry.act === act && entry.step + 1 === step);
    })) throw new Error('Invalid event commitment history');
  }
  if (state._routeMapVersion !== undefined && state._routeMapVersion !== 1) {
    throw new Error('Invalid route map version');
  }
  if (state._routeMapLegacy !== undefined && typeof state._routeMapLegacy !== 'boolean') {
    throw new Error('Invalid legacy route map marker');
  }
  if (!state.routeMap) throw new Error('Invalid route map: saved route map is missing');
  validateRouteMap(state.routeMap, state.act, state.nodes, state.step, state.phase, state._routeMapLegacy === true);
  if (!integer(state.extraElites) || state.extraElites < 0 || state.extraElites > 3 ||
    !integer(state.ordinaryCount) || state.ordinaryCount < 0) throw new Error('Invalid run counters');
  if (state.returnPhase !== undefined && !PHASES.includes(state.returnPhase)) throw new Error('Invalid public return phase');
  if (state._returnPhase !== undefined && !PHASES.includes(state._returnPhase)) throw new Error('Invalid return phase');
  if (state.returnPhase !== undefined && state._returnPhase !== undefined &&
    state.returnPhase !== state._returnPhase) throw new Error('Return phase mismatch');
  if (state._routeHistory !== undefined &&
    (!Array.isArray(state._routeHistory) || state._routeHistory.some(route => typeof route !== 'string'))) {
    throw new Error('Invalid route history');
  }
  if (state._seenEnemyIds !== undefined &&
    (!Array.isArray(state._seenEnemyIds) || state._seenEnemyIds.some(id =>
      typeof id !== 'string' || contentEntity(content, id)?.kind !== 'enemy'))) {
    throw new Error('Invalid enemy history');
  }
  if (state._lastEnemyId !== undefined &&
    (typeof state._lastEnemyId !== 'string' || contentEntity(content, state._lastEnemyId)?.kind !== 'enemy')) {
    throw new Error('Invalid last enemy');
  }
  if (state._corePositions !== undefined &&
    (!Array.isArray(state._corePositions) || state._corePositions.some(position =>
      !integer(position) || position < 0))) {
    throw new Error('Invalid core positions');
  }
  for (const key of ['_coreCount', '_actCoreCount', '_actEliteCount', '_lastCorePosition', '_consecutiveNodes'] as const) {
    if (state[key] !== undefined && (!integer(state[key]) || state[key] < 0)) {
      throw new Error(`Invalid ${key}`);
    }
  }
  if (state._methodConsecutiveNodes !== undefined &&
    (!isObject(state._methodConsecutiveNodes) ||
      Object.entries(state._methodConsecutiveNodes).some(([method, count]) =>
        !METHOD_IDS.test(method) || !state.ownedMethods.includes(method) ||
        !integer(count) || count < 0))) {
    throw new Error('Invalid method travel counters');
  }
  if (state._nodeEnemyByKey !== undefined &&
    (!isObject(state._nodeEnemyByKey) || Object.values(state._nodeEnemyByKey).some(id =>
      typeof id !== 'string' || contentEntity(content, id)?.kind !== 'enemy'))) {
    throw new Error('Invalid enemy map');
  }
  if (state._bossEnemyByAct !== undefined &&
    (!isObject(state._bossEnemyByAct) || Object.values(state._bossEnemyByAct).some(id =>
      typeof id !== 'string' || contentEntity(content, id)?.kind !== 'enemy'))) {
    throw new Error('Invalid boss map');
  }
  if (state._pendingTravelResources !== undefined &&
    (!isObject(state._pendingTravelResources) ||
      Object.values(state._pendingTravelResources).some(amount => !finite(amount) || amount < 0))) {
    throw new Error('Invalid pending travel resources');
  }
  if (state._pendingTravelResourceKinds !== undefined &&
    (!isObject(state._pendingTravelResourceKinds) ||
      Object.values(state._pendingTravelResourceKinds).some(resource =>
        !['hp', 'coins', 'xp'].includes(resource)))) {
    throw new Error('Invalid pending travel resource kinds');
  }
  if (state._pendingTravelResourceKinds && !state._pendingTravelResources) {
    throw new Error('Pending travel resource kinds without amounts');
  }
  if (state._pendingTravelResources && state._pendingTravelResourceKinds &&
    Object.keys(state._pendingTravelResourceKinds).some(key => !(key in (state._pendingTravelResources ?? {})))) {
    throw new Error('Pending travel resource kind without amount');
  }
  if (state._pendingTravelCoins !== undefined &&
    (!finite(state._pendingTravelCoins) || state._pendingTravelCoins < 0)) {
    throw new Error('Invalid pending travel coins');
  }
  if (state._methodTravelSequence !== undefined &&
    !['heal', 'xp'].includes(state._methodTravelSequence)) {
    throw new Error('Invalid method travel sequence');
  }
  for (const key of [
    '_battleSettled',
    '_eventRewardApplied',
    '_swapAvailable',
    '_eventCostTravelApplied',
    '_rewardSettled',
    '_eventSettled',
    '_shopReforged',
    '_coreRewardOffered',
  ] as const) {
    if (state[key] !== undefined && typeof state[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  }
  if (typeof state._thunderChallenge !== 'boolean') throw new Error('Invalid thunder challenge marker');
  if (state._thunderRewardStage !== undefined && !['normal', 'bonus'].includes(state._thunderRewardStage)) {
    throw new Error('Invalid thunder challenge reward stage');
  }
  if (!Array.isArray(state._thunderRewardCandidates) ||
    state._thunderRewardCandidates.length > 3 ||
    state._thunderRewardCandidates.some(id => typeof id !== 'string') ||
    new Set(state._thunderRewardCandidates).size !== state._thunderRewardCandidates.length) {
    throw new Error('Invalid thunder challenge reward candidates');
  }
  if (state._thunderRewardFallback !== undefined &&
    (!isObject(state._thunderRewardFallback) || Object.keys(state._thunderRewardFallback).length !== 2 ||
      state._thunderRewardFallback.type !== 'coins' ||
      state._thunderRewardFallback.amount !== THUNDER_CHALLENGE_FALLBACK_COINS)) {
    throw new Error('Invalid thunder challenge reward fallback');
  }
  if (typeof state._actEliteChallengeUsed !== 'boolean') {
    throw new Error('Invalid elite challenge marker');
  }
  if (state._pendingRestChoice !== undefined && typeof state._pendingRestChoice !== 'string') {
    throw new Error('Invalid pending rest choice');
  }
  if (state._restFromEvent !== undefined && typeof state._restFromEvent !== 'boolean') {
    throw new Error('Invalid rest origin');
  }
  if (state._previewKind !== undefined && !['node', 'event'].includes(state._previewKind)) {
    throw new Error('Invalid preview kind');
  }
  if (state._battleKind !== undefined && !['node', 'event'].includes(state._battleKind)) {
    throw new Error('Invalid battle kind');
  }
  if (state._eventOutcome !== undefined && !['success', 'failure'].includes(state._eventOutcome)) {
    throw new Error('Invalid event outcome');
  }
  if (state._battleNodeType !== undefined &&
    !['C', 'E', 'K', 'L', 'S', 'R', 'B', 'F'].includes(state._battleNodeType)) {
    throw new Error('Invalid battle node type');
  }
  if (state._battleRewardType !== undefined &&
    !['common', 'elite', 'boss'].includes(state._battleRewardType)) {
    throw new Error('Invalid battle reward type');
  }
  if (state._battleKind === 'event' && state._battleRewardType !== undefined) {
    throw new Error('Event battle has node reward type');
  }
  if (state._battleKind === 'node' && state._battleRewardType !== undefined) {
    const node = state.nodes[state.step];
    const expected = state._challengeEliteEnemyId ? 'elite' : node && battleRewardType(node.type);
    if (!expected || state._battleRewardType !== expected) {
      throw new Error('Battle reward type mismatch');
    }
  }
  if (state._challengeEliteEnemyId !== undefined) {
    const enemy = contentEntity(content, state._challengeEliteEnemyId);
    const node = state.nodes[state.step];
    const eligibleEnemies = actEntity(content, state.act)?.pools?.enemies?.elite_candidates;
    if (typeof state._challengeEliteEnemyId !== 'string' ||
      state._actEliteChallengeUsed !== true || node?.type !== 'C' ||
      enemy?.kind !== 'enemy' || enemy.tier !== 'elite' ||
      !Array.isArray(eligibleEnemies) || !eligibleEnemies.includes(state._challengeEliteEnemyId)) {
      throw new Error('Invalid challenged elite encounter');
    }
    if (state._battleRewardType !== 'elite') {
      throw new Error('Challenged elite reward type mismatch');
    }
    if (state.nodeEntry && !state.nodeEntry.talents.includes('V2-J1-B')) {
      throw new Error('Challenged elite requires the hunter insight');
    }
    if (state.battleInput && state._battleKind === 'node' &&
      (state.battleInput.enemy.name !== enemy.name ||
        state.battleInput.enemy.method !== enemy.method ||
        state.battleInput.enemy.encounterId !== (isObject(enemy.trial) ? enemy.id : undefined))) {
      throw new Error('Challenged elite battle input mismatch');
    }
  }
  if (state._battleKind === 'node' && state.battleInput) {
    const node = state.nodes[state.step];
    const enemyId = state._challengeEliteEnemyId ?? node?.id;
    const enemy = enemyId ? contentEntity(content, enemyId) : undefined;
    if (!enemy || state.battleInput.enemy.name !== enemy.name ||
      state.battleInput.enemy.method !== enemy.method ||
      state.battleInput.enemy.encounterId !== (isObject(enemy.trial) ? enemy.id : undefined)) {
      throw new Error('Battle input does not match the selected encounter');
    }
    const challenged = state._thunderChallenge === true;
    if ((state.battleInput.enemy.thunderChallenge === true) !== challenged) {
      throw new Error('Frozen enemy challenge state mismatch');
    }
    if (challenged) {
      const node = state.nodes[state.step];
      if (state.act < 1 || state.act > 4 || state._challengeEliteEnemyId !== undefined ||
        !node || !['L', 'B'].includes(node.type) || enemy.tier !== (node.type === 'L' ? 'elite' : 'boss') ||
        !isObject(enemy.stats)) {
        throw new Error('Thunder challenge does not match an elite or boss node');
      }
      const expectedStats = clone(enemy.stats) as Stats;
      expectedStats.max_hp *= 1.25;
      if (!sameStats(state.battleInput.enemy.baseStats, expectedStats)) {
        throw new Error('Frozen thunder challenge enemy stats mismatch');
      }
    }
  }
  if (state._battleKind === 'event' && state.battleInput) {
    const eventNode = state.nodes[state.step];
    const event = eventNode ? contentEntity(content, eventNode.id) : undefined;
    const option = event?.kind === 'event' && typeof state.eventOption === 'string'
      ? eventOption(event, state.eventOption)
      : undefined;
    const settledEnemyId = state._eventSettled === true && state._battleSettled === true
      ? option?.encounter?.enemy_id
      : undefined;
    const enemyId = state._pendingEvent?.enemyId ?? settledEnemyId;
    const enemy = typeof enemyId === 'string' ? contentEntity(content, enemyId) : undefined;
    if (!enemy || state.battleInput.enemy.name !== enemy.name ||
      state.battleInput.enemy.method !== enemy.method ||
      state.battleInput.enemy.encounterId !== (isObject(enemy.trial) ? enemy.id : undefined) ||
      state.battleInput.enemy.thunderChallenge !== undefined) {
      throw new Error('Event battle input does not match the selected encounter');
    }
  }
  if (state._talentQueue !== undefined && !Array.isArray(state._talentQueue)) {
    throw new Error('Invalid talent queue');
  }
  if (state.step > state.nodes.length && state.phase !== 'transition' && state.phase !== 'won' && state.phase !== 'lost') throw new Error('Invalid node position');
  if (state.routes.some(route => typeof route !== 'string')) throw new Error('Invalid routes');
  for (const entry of state.history) {
    if (!isObject(entry) || !integer(entry.act) || entry.act < 1 || entry.act > 5 ||
      !integer(entry.step) || entry.step < 0 || typeof entry.title !== 'string' || typeof entry.text !== 'string') {
      throw new Error('Invalid run history');
    }
    if (entry.eventId !== undefined || entry.optionId !== undefined || entry.eventOutcome !== undefined) {
      const event = typeof entry.eventId === 'string' ? contentEntity(content, entry.eventId) : undefined;
      const option = event?.kind === 'event' && typeof entry.optionId === 'string'
        ? eventOption(event, entry.optionId) : undefined;
      if (!option || (entry.eventOutcome !== undefined &&
        !['success', 'failure'].includes(entry.eventOutcome)) ||
        (entry.eventOutcome === 'failure' && !option.encounter && !option.check)) {
        throw new Error('Invalid event history outcome');
      }
      if (entry.eventCheck !== undefined) {
        validateSavedEventCheck(option, entry.eventCheck, entry.eventOutcome);
      }
      if (entry.storyEcho !== undefined &&
        (typeof entry.storyEcho !== 'string' || entry.storyEcho.length > 2000)) throw new Error('Invalid history story echo');
    }
  }
  const finalHistory = state.history.filter(entry => entry.act === 5);
  if (finalHistory.length > 1) throw new Error('Duplicate final history');
  if (finalHistory.some(entry => entry.step !== 0)) throw new Error('Invalid final history');
  if (state.phase === 'won') {
    const finalNode = state.nodes[state.step];
    if (state.act !== 5 || !finalNode || finalNode.type !== 'F' || !finalNode.completed ||
      finalHistory.length !== 1) {
      throw new Error('Won run is missing final history');
    }
  } else if (finalHistory.length) {
    throw new Error('Final history before victory');
  }
  if (state._routeHistory && state._routeHistory.length !== state.routes.length) {
    throw new Error('Route history mismatch');
  }
  if (state._routeHistory && state._routeHistory.some((route, index) => route !== state.routes[index])) {
    throw new Error('Route history mismatch');
  }
  for (const route of state.routes) {
    if (route === 'final') continue;
    if (!routeTemplates(content, Math.min(4, Math.max(1, state.routes.indexOf(route) + 1))).some(candidate => candidate.id === route) &&
      ![1, 2, 3, 4].some(act => routeTemplates(content, act).some(candidate => candidate.id === route))) {
      throw new Error('Invalid route reference');
    }
  }
  for (const node of state.nodes) {
    if (!isObject(node) || !['C', 'E', 'K', 'L', 'S', 'R', 'B', 'F'].includes(node.type) ||
      typeof node.id !== 'string' || typeof node.completed !== 'boolean') throw new Error('Invalid saved node');
    if (['C', 'L', 'B', 'F'].includes(node.type)) {
      const enemy = contentEntity(content, node.id);
      const tier = node.type === 'C' ? 'normal' : node.type === 'L' ? 'elite' : node.type === 'B' ? 'boss' : 'final';
      if (!enemy || enemy.kind !== 'enemy' || enemy.tier !== tier) throw new Error('Invalid saved enemy node');
    } else if (node.type === 'E' || node.type === 'K') {
      const event = contentEntity(content, node.id);
      if (!event || event.kind !== 'event' || (node.type === 'K' && event.event_type !== 'core') ||
        (node.type === 'E' && event.event_type !== 'ordinary')) throw new Error('Invalid saved event node');
    }
  }
  if (state.routeMap) {
    for (const node of state.routeMap.nodes) {
      if (['C', 'L', 'B', 'F'].includes(node.type)) {
        const enemy = contentEntity(content, node.id);
        const tier = node.type === 'C' ? 'normal' : node.type === 'L' ? 'elite' : node.type === 'B' ? 'boss' : 'final';
        if (!enemy || enemy.kind !== 'enemy' || enemy.tier !== tier) throw new Error('Invalid route map enemy');
      } else if (node.type === 'E' || node.type === 'K') {
        const event = contentEntity(content, node.id);
        if (!event || event.kind !== 'event' || (node.type === 'K' && event.event_type !== 'core') ||
          (node.type === 'E' && event.event_type !== 'ordinary')) throw new Error('Invalid route map event');
      }
    }
  }
  if (state._travelSnapshots) {
    for (const snapshot of state._travelSnapshots) {
      if (!isObject(snapshot) || !integer(snapshot.act) || snapshot.act < 1 || snapshot.act > 5 ||
        !integer(snapshot.step) || snapshot.step < 0 ||
        snapshot.step >= (snapshot.act === 5 ? 1 : 11) ||
        typeof snapshot.method !== 'string' || !state.ownedMethods.includes(snapshot.method) ||
        !Array.isArray(snapshot.talents) || !Array.isArray(snapshot.artifacts) ||
        !PHASES.includes(snapshot.phase)) {
        throw new Error('Invalid travel snapshot');
      }
      validateLoadoutReferences(content, {
        name: state.name,
        method: snapshot.method,
        n: state.n,
        talents: snapshot.talents,
        artifacts: snapshot.artifacts,
        hp: state.hp,
        preparation: state.preparation,
      });
    }
  }
  if (!Array.isArray(state.rewardRefinements) || state.rewardRefinements.length > 4) {
    throw new Error('Invalid reward refinement history');
  }
  const refinedActs = new Set<number>();
  let previousRefinementAct = 0;
  for (const record of state.rewardRefinements) {
    if (!isObject(record) || Object.keys(record).length !== 6 ||
      !['act', 'step', 'source', 'target', 'targetStacksBefore', 'forfeited']
        .every(key => Object.prototype.hasOwnProperty.call(record, key)) ||
      !integer(record.act) || record.act < 1 || record.act > 4 || record.act > state.act ||
      !integer(record.step) || record.step < 0 || record.step > 10 ||
      typeof record.source !== 'string' || typeof record.target !== 'string' ||
      record.source === record.target ||
      !integer(record.targetStacksBefore) || record.targetStacksBefore <= 0 ||
      !Array.isArray(record.forfeited) || record.forfeited.length < 1 ||
      record.forfeited.length > 3 ||
      record.forfeited.some((id: unknown) => {
        const artifact = typeof id === 'string' ? contentEntity(content, id) : undefined;
        return artifact?.kind !== 'artifact' || artifact.rarity !== 'common';
      }) ||
      new Set(record.forfeited).size !== record.forfeited.length ||
      refinedActs.has(record.act) || record.act <= previousRefinementAct) {
      throw new Error('Invalid reward refinement record');
    }
    const source = contentEntity(content, record.source);
    const target = contentEntity(content, record.target);
    if (source?.kind !== 'artifact' || source.rarity !== 'common' ||
      target?.kind !== 'artifact' || target.rarity !== 'common' ||
      !integer(target.max_stacks) || target.max_stacks <= record.targetStacksBefore) {
      throw new Error('Invalid reward refinement artifact reference');
    }
    refinedActs.add(record.act);
    previousRefinementAct = record.act;

    const entries = state.history.filter(entry =>
      entry.act === record.act && entry.step === record.step);
    const entry = entries[0];
    const isCommonEnemyHistory = !!entry && contentEntities(content, 'enemy').some(enemy =>
      enemy.tier === 'normal' && enemy.name === entry.title);
    const expectedText = rewardRefinementHistoryText(content, record);
    const travelSnapshot = state._travelSnapshots?.find(snapshot =>
      snapshot.act === record.act && snapshot.step === record.step && snapshot.phase === 'map');
    const isCurrentCompletedNode = record.act === state.act &&
      state.nodes[record.step]?.type === 'C' &&
      state.nodes[record.step]?.completed === true &&
      state.step > record.step;
    const isTerminalJustCompletedNode = record.act === state.act &&
      ['won', 'lost'].includes(state.phase) && state.step === record.step &&
      state.nodes[record.step]?.type === 'C' &&
      state.nodes[record.step]?.completed === true;
    if (entries.length !== 1 || !entry || !isCommonEnemyHistory ||
      !entry.text.startsWith(expectedText) || !travelSnapshot ||
      (record.act === state.act &&
        !isCurrentCompletedNode && !isTerminalJustCompletedNode)) {
      throw new Error('Reward refinement does not match a completed ordinary node');
    }
  }
  if (state.rewardRefinements.length > refiningConfig.max_per_act * 4 ||
    refinedActs.size !== state.rewardRefinements.length) {
    throw new Error('Invalid reward refinement limit');
  }
  if (state.storyline && (!contentEntity(content, state.storyline) || contentEntity(content, state.storyline)?.kind !== 'storyline')) {
    throw new Error('Invalid storyline reference');
  }
  if (state.independentCore !== null &&
    (!contentEntity(content, state.independentCore) || contentEntity(content, state.independentCore)?.kind !== 'event')) {
    throw new Error('Invalid independent core reference');
  }
  const stacks = new Set<string>();
  const groups = new Set<string>();
  for (const stack of state.artifacts) {
    if (!isObject(stack) || typeof stack.id !== 'string' || !integer(stack.stacks) || stack.stacks <= 0 || stacks.has(stack.id)) throw new Error('Invalid artifact stack');
    stacks.add(stack.id);
    const artifact = contentEntity(content, stack.id);
    if (!artifact || artifact.kind !== 'artifact' || stack.stacks > (integer(artifact.max_stacks) ? artifact.max_stacks : 1)) throw new Error('Invalid artifact capacity');
    if (!artifactRole(content, stack.id)) throw new Error('Invalid artifact equipment role');
    if (artifact.unique_group) {
      if (groups.has(artifact.unique_group)) throw new Error('Invalid artifact unique group');
      groups.add(artifact.unique_group);
    }
  }
  const savedPlayer: Loadout = {
    name: state.name,
    method: state.method,
    n: state.n,
    talents: state.talents[state.method] ?? [],
    artifacts: equippedArtifactStacks(state),
    baseStats: baseStats(content, state.n),
    hp: state.hp,
    preparation: state.preparation,
  };
  let savedStats: Stats;
  try {
    savedStats = worker().calculateStats(content, savedPlayer);
  } catch (error) {
    throw new Error(`Invalid saved player build: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!finite(savedStats.max_hp) || state.hp > savedStats.max_hp + 1e-9) throw new Error('Saved HP exceeds maximum HP');
  if (!isObject(state.flags) || !Array.isArray(state.seenEvents) || !Array.isArray(state.completedCore)) throw new Error('Invalid event state');
  if (Object.values(state.flags).some(value => typeof value !== 'boolean')) throw new Error('Invalid event flags');
  for (const id of state.seenEvents) {
    if (typeof id !== 'string' || contentEntity(content, id)?.kind !== 'event') throw new Error('Invalid seen event reference');
  }
  for (const id of state.completedCore) {
    if (typeof id !== 'string' || contentEntity(content, id)?.kind !== 'event' ||
      contentEntity(content, id)?.event_type !== 'core') throw new Error('Invalid completed core reference');
  }
  if (!Array.isArray(state.rewardCandidates) || state.rewardCandidates.length > 3 ||
    state.rewardCandidates.some(id =>
      typeof id !== 'string' || contentEntity(content, id)?.kind !== 'artifact' || isFusionResult(content, id)) ||
    new Set(state.rewardCandidates).size !== state.rewardCandidates.length) {
    throw new Error('Invalid reward candidates');
  }
  if (!Array.isArray(state.rewardSearches) || state.rewardSearches.length > 4) {
    throw new Error('Invalid reward search history');
  }
  if (!Array.isArray(state.rewardRefinements) || state.rewardRefinements.length > 4) {
    throw new Error('Invalid reward refinement history');
  }
  const searchedActs = new Set<number>();
  let unresolvedSearch: RewardSearchRecord | undefined;
  let previousSearchAct = 0;
  let searchedCoins = 0;
  const seekingConfig = rewardSeekingConfig(content);
  for (const record of state.rewardSearches) {
    if (!isObject(record) || Object.keys(record).length !== 6 ||
      !['act', 'step', 'family', 'cost', 'candidates', 'resolved']
        .every(key => Object.prototype.hasOwnProperty.call(record, key)) ||
      !integer(record.act) || record.act < 1 || record.act > 4 || record.act > state.act ||
      !integer(record.step) || record.step < 0 || record.step > 10 ||
      !ARTIFACT_REWARD_FAMILIES.includes(record.family) ||
      record.cost !== seekingConfig.price || typeof record.resolved !== 'boolean' ||
      !Array.isArray(record.candidates) || record.candidates.length < 1 || record.candidates.length > 3 ||
      record.candidates.some(id => {
        const artifact = typeof id === 'string' ? contentEntity(content, id) : undefined;
        return artifact?.kind !== 'artifact' ||
          isFusionResult(content, id) ||
          (artifact.rarity !== 'legendary' && !seekingConfig.families[record.family].includes(id));
      }) ||
      new Set(record.candidates).size !== record.candidates.length ||
      searchedActs.has(record.act) || record.act <= previousSearchAct ||
      (record.act === 1 && record.step === 0) ||
      (record.act === 1 && record.step > 0 &&
        !state.history.some(entry => entry.act === 1 && entry.step === 0))) {
      throw new Error('Invalid reward search record');
    }
    searchedActs.add(record.act);
    previousSearchAct = record.act;
    searchedCoins += record.cost;
    if (!finite(searchedCoins)) throw new Error('Invalid reward search ledger');
    const current = state.phase === 'reward' &&
      state.act === record.act && state.step === record.step;
    const hasHistory = state.history.some(entry =>
      entry.act === record.act && entry.step === record.step);
    if (record.act === state.act && record.step > state.step) {
      throw new Error('Reward search record is ahead of the current position');
    }
    if (record.resolved) {
      if (!hasHistory || current) {
        throw new Error('Resolved reward search has no history');
      }
    } else {
      const node = state.nodes[record.step];
      if (!current || hasHistory || unresolvedSearch || state._rewardSettled !== true ||
        state._battleSettled !== true || state._battleKind !== 'node' ||
        !node || !['C', 'L', 'B'].includes(node.type) ||
        JSON.stringify(record.candidates) !== JSON.stringify(state.rewardCandidates)) {
        throw new Error('Unresolved reward search does not match current reward');
      }
      unresolvedSearch = record;
    }
  }
  if (state.phase !== 'reward' && unresolvedSearch) {
    throw new Error('Unresolved reward search outside reward phase');
  }
  if (state.rewardSearches.length > 0 &&
    (state._coreRewardOffered !== true || searchedCoins > state.progress.coinsSpent + 1e-9)) {
    throw new Error('Reward search history does not match the reward or spending ledger');
  }
  if (!Array.isArray(state.shop)) throw new Error('Invalid shop');
  for (const item of state.shop) {
    if (!isObject(item) || typeof item.id !== 'string' || !SHOP_KINDS.includes(item.kind) ||
      !finite(item.price) || item.price < 0 || typeof item.sold !== 'boolean') throw new Error('Invalid shop item');
    if (item.kind === 'artifact' &&
      (contentEntity(content, item.id)?.kind !== 'artifact' || isFusionResult(content, item.id))) {
      throw new Error('Invalid shop artifact');
    }
    if (item.kind !== 'artifact' && item.id !== item.kind) throw new Error('Invalid shop service');
  }
  if ((state.nodeEntry === undefined) !== (state._nodeEntry === undefined)) {
    throw new Error('Node entry snapshot mismatch');
  }
  if (state.nodeEntry) {
    validateNodeEntrySnapshot(content, state, state.nodeEntry);
    validateNodeEntrySnapshot(content, state, state._nodeEntry);
    if (!equalNodeEntry(state.nodeEntry, state._nodeEntry)) {
      throw new Error('Node entry snapshot mismatch');
    }
  }
  if (state._pendingEvent) validatePendingEncounter(content, state._pendingEvent);
  if (state._pendingEvent && !['preview', 'battle'].includes(state.phase)) {
    throw new Error('Pending event outside encounter phase');
  }
  if (state._pendingEvent && state.eventOption !== state._pendingEvent.optionId) {
    throw new Error('Pending event option mismatch');
  }
  if (state.battleInput) {
    if (!isObject(state.battleInput) || typeof state.battleInput.seed !== 'string' || !integer(state.battleInput.roundLimit) ||
      state.battleInput.roundLimit <= 0 || state.battleInput.roundLimit > 4096 ||
      !isObject(state.battleInput.player) || !isObject(state.battleInput.enemy)) throw new Error('Invalid battle input');
    if (state.battleInput.rules !== undefined && state.battleInput.rules !== 'awakening-v1') throw new Error('Invalid battle rules');
    validateLoadoutReferences(content, state.battleInput.player, false, state.ownedMethods);
    validateLoadoutReferences(content, state.battleInput.enemy, true);
    if (state.battleInput.enemy.companion !== undefined) {
      throw new Error('Frozen enemy companion does not match the selected encounter');
    }
  }
  if (state.phase === 'battle') {
    const journey = state.battleInput?.player?.journey;
    const expected = journeyContext(state);
    if (!journey || Object.keys(expected).some(key =>
      journey[key as keyof typeof expected] !== expected[key as keyof typeof expected])) {
      throw new Error('Frozen battle journey context mismatch');
    }
    const expectedCompanion = state.ownedMethods.find(id => id !== state.battleInput?.player?.method);
    if (state.battleInput?.player?.companion !== expectedCompanion) {
      throw new Error('Frozen battle companion does not match owned methods');
    }
  }
  if (state.battle) validateBattleResult(state.battle);
  if (state.battle && state.battleInput) validateBattleCuesAgainstInput(state.battle, state.battleInput);
  if (state.eventOption !== undefined && typeof state.eventOption !== 'string') throw new Error('Invalid event option');
  const currentNode = state.nodes[state.step];
  if (state.eventCheck !== undefined) {
    const event = currentNode ? contentEntity(content, currentNode.id) : undefined;
    const option = event ? eventOption(event, state.eventOption ?? '') : undefined;
    if (!['event_result', 'talent', 'rest', 'lost'].includes(state.phase)) throw new Error('Invalid event check phase');
    validateSavedEventCheck(option, state.eventCheck, state._eventOutcome);
  }
  if (state.eventStoryEcho !== undefined &&
    (typeof state.eventStoryEcho !== 'string' || state.eventStoryEcho.length > 2000)) throw new Error('Invalid event story echo');
  if (state.phase === 'event' && (!currentNode || !['E', 'K'].includes(currentNode.type))) {
    throw new Error('Event phase without event node');
  }
  if (state.phase === 'preview' && (!state._previewKind || !['node', 'event'].includes(state._previewKind))) {
    throw new Error('Preview phase without preview kind');
  }
  if (state._previewKind === 'node' &&
    state.phase === 'preview' &&
    (!currentNode || !['C', 'L', 'B', 'F'].includes(currentNode.type))) {
    throw new Error('Node preview without battle node');
  }
  if (state._previewKind === 'event' &&
    ['preview', 'battle'].includes(state.phase) &&
    (!currentNode || !['E', 'K'].includes(currentNode.type) || !state._pendingEvent)) {
    throw new Error('Event preview without pending encounter');
  }
  if (state.phase === 'battle') {
    if (!state._battleKind || !['node', 'event'].includes(state._battleKind) || !state.battleInput || !state.battle) {
      throw new Error('Battle phase without frozen battle input');
    }
    if (state._battleKind === 'event' && !state._pendingEvent) throw new Error('Event battle without pending encounter');
    if (state._battleKind === 'node' && (!currentNode || !['C', 'L', 'B', 'F'].includes(currentNode.type))) {
      throw new Error('Node battle without battle node');
    }
    if (state._battleKind === 'event' && (!currentNode || !['E', 'K'].includes(currentNode.type))) {
      throw new Error('Event battle without event node');
    }
  }
  if (state._battleNodeType !== undefined && currentNode &&
    state._battleNodeType !== currentNode.type &&
    ['preview', 'battle', 'reward', 'event_result', 'lost'].includes(state.phase)) {
    throw new Error('Battle node type mismatch');
  }
  if (['battle', 'reward'].includes(state.phase) && !state.battle) throw new Error('Battle phase without result');
  if (state.phase === 'reward' && !state.rewardCandidates.length && !state.battle) throw new Error('Reward phase without battle');
  validateFusionState(content, state);
  validateThunderChallengeHistory(content, state);
  if (!allFiniteNumbers(state)) throw new Error('Non-finite run state');
}

export function calculateStats(content: Content, loadout: Loadout): Stats {
  return worker().calculateStats(content, loadout);
}

export function simulateBattle(
  content: Content,
  player: Loadout,
  enemy: Loadout,
  seed: string,
  options?: { roundLimit?: number; artifactAwakenings?: boolean },
): BattleResult {
  const result = worker().simulateBattle(content, player, enemy, seed, options);
  validateBattleResult(result);
  validateBattleCuesAgainstInput(result, { player, enemy });
  return result;
}
