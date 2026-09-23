import { hashSeed, seededRandom } from './content.js';
import {
  calculateStats as combatCalculateStats,
  simulateBattle as combatSimulateBattle,
} from './combat.js';
import { createRouteMapNodes, validateRouteMap } from './route-map.js';
import type {
  ArtifactStack,
  BattleResult,
  Content,
  Entity,
  Loadout,
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
    options?: { roundLimit?: number },
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

const METHOD_IDS = /^RKF\d\d$/;
const ARTIFACT_IDS = /^(?:RC|RR|RL)\d\d$/;

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
    artifacts: clone(state.artifacts),
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
}

function removeArtifact(state: RunState, id: string, count: number): void {
  const existing = state.artifacts.find(stack => stack.id === id);
  if (!existing || existing.stacks < count) throw new Error(`Insufficient artifact: ${id}`);
  existing.stacks -= count;
  if (existing.stacks === 0) state.artifacts = state.artifacts.filter(stack => stack.id !== id);
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

function talentTier(content: Content, method: string, id: string): number | undefined {
  return methodTalents(content, method).find(talent => talent.id === id)?.tier;
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
    if (!this.state.routeMap) this.migrateLegacyRouteMap();
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
      preparation: 0,
      flags: {},
      storyline: '',
      independentCore: null,
      history: [],
      seenEvents: [],
      completedCore: [],
      extraElites: 0,
      ordinaryCount: 0,
      rewardCandidates: [],
      shop: [],
      resultText: '',
      firstStrike: 0,
      _routeHistory: [],
      _seenEnemyIds: [],
      _corePositions: [],
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
    return {
      name: state.name,
      method: state.method,
      n: state.n,
      talents: clone(state.talents[state.method] ?? []),
      artifacts: clone(state.artifacts),
      baseStats: baseStats(this.content, state.n),
      hp: state.hp,
      preparation: state.preparation,
      firstStrike: state.firstStrike,
    };
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

  private createRouteMap(legacyPath: RunNode[] = []): RouteMapNode[] {
    const act = this.state.act;
    const coreSlots = new Map<number, string>();
    for (const depth of [1, 4, 7]) {
      const candidates = this.coreCandidatesAt(depth);
      if (!candidates.length) continue;
      const lane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:core-lane:${depth}`)() * 3);
      const pick = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:core-id:${depth}`)() * candidates.length);
      coreSlots.set(depth * 3 + lane, candidates[pick] ?? candidates[0]!);
    }
    const restLane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:rest-lane`)() * 3);
    const shopLane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:shop-lane`)() * 3);
    const eliteLane = Math.floor(seededRandom(`${this.state.seed}:route-map:${act}:elite-lane`)() * 3);
    const eliteLimit = this.maxElitesPerAct();
    const actElites = (this.state as RunStateInternals)._actEliteCount ?? 0;
    const hasElite = act < 5 &&
      actElites < eliteLimit &&
      (actElites === 0 || this.state.extraElites < this.maxExtraElites());
    const nodes = createRouteMapNodes(act, (depth, lane, key) => {
      if (act === 5) {
        return { type: 'F', id: this.freezeEnemy('F', depth, key), completed: false, label: '终战' };
      }
      if (depth === 10) {
        const id = this.freezeEnemy('B', depth, key);
        return { type: 'B', id, completed: false, label: '首领', description: contentEntity(this.content, id)?.name };
      }
      let type: RunNode['type'] = 'C';
      if (depth === 1 || depth === 4 || depth === 7) type = 'E';
      if (depth === 1 || depth === 4 || depth === 7) {
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
      if (depth === 3 && lane === restLane) {
        return { type: 'R', id: `R-A${act}-${key}`, completed: false, label: '休整' };
      }
      if (depth === 5 && lane === shopLane) {
        return { type: 'S', id: `SHOP-A${act}-${key}`, completed: false, label: '坊市' };
      }
      if (depth === 9 && hasElite && lane === eliteLane) type = 'L';
      if (type === 'C' || type === 'L') {
        const id = this.freezeEnemy(type, depth, key);
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
        const id = this.freezeEnemy(type, depth, key);
        return { type, id, completed: false, label: '终战', description: contentEntity(this.content, id)?.name };
      }
      throw new Error(`Unsupported route map node at ${key}`);
    });

    for (let depth = 0; depth < legacyPath.length; depth++) {
      const selected = legacyPath[depth];
      const candidate = nodes.find(node => node.depth === depth && node.lane === 1);
      if (!selected || !candidate) throw new Error('Invalid legacy route path');
      candidate.type = selected.type;
      candidate.id = selected.id;
      candidate.completed = selected.completed;
      candidate.label = this.routeNodeLabel(selected.type);
      candidate.description = contentEntity(this.content, selected.id)?.name;
    }
    return nodes;
  }

  private routeNodeLabel(type: RunNode['type']): string {
    return ({
      C: '普通战',
      E: '事件',
      K: '机缘',
      L: '精英',
      S: '坊市',
      R: '休整',
      B: '首领',
      F: '终战',
    })[type];
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
      .flatMap(route => {
        const source = route.nodes[depth];
        if (!isObject(source) || source.type !== 'K') return [];
        return Array.isArray(source.candidate_ids)
          ? source.candidate_ids.filter((id: unknown): id is string => typeof id === 'string')
          : typeof source.id === 'string' ? [source.id] : [];
      });
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

  private migrateLegacyRouteMap(): void {
    const state = this.state as RunStateInternals;
    if (state._routeMapVersion === 1) throw new Error('Saved route map is missing');
    const oldNodes = clone(state.nodes);
    const isLegacy = state.phase === 'route' || state.routes.length > 0 || oldNodes.length > 0;
    const activePhases: RunPhase[] = [
      'preview', 'battle', 'reward', 'event', 'event_result', 'shop', 'rest', 'lost', 'won',
    ];
    const mapHasActiveNode = ['map', 'talent'].includes(state.phase) && oldNodes[state.step] &&
      !oldNodes[state.step]!.completed && (!!state.nodeEntry || !!state._nodeEntry);
    const legacyPathLength = state.phase === 'transition'
      ? Math.min(oldNodes.length, 11)
      : activePhases.includes(state.phase) || mapHasActiveNode
        ? Math.min(oldNodes.length, state.step + 1)
        : Math.min(oldNodes.length, state.step);
    const selected = oldNodes.slice(0, legacyPathLength);
    const unvisited = oldNodes.slice(legacyPathLength);
    const futureOrdinary = unvisited.filter(node => node.type === 'C' || node.type === 'E').length;
    state.ordinaryCount = Math.max(0, state.ordinaryCount - futureOrdinary);

    const futureCores = unvisited.filter(node => node.type === 'K').length;
    state._coreCount = Math.max(0, (state._coreCount ?? 0) - futureCores);
    state._actCoreCount = selected.filter(node => node.type === 'K').length;
    const currentActStart = (state.act - 1) * 11;
    state._corePositions = (state._corePositions ?? []).filter(position =>
      position < currentActStart || position - currentActStart < legacyPathLength);
    state._lastCorePosition = state._corePositions.at(-1);

    const futureEnemies = unvisited.filter(node => ['C', 'L', 'B', 'F'].includes(node.type));
    for (const node of futureEnemies) {
      const index = state._seenEnemyIds?.indexOf(node.id) ?? -1;
      if (index >= 0) state._seenEnemyIds!.splice(index, 1);
    }
    state._lastEnemyId = state._seenEnemyIds?.at(-1);
    state._actEliteCount = selected.filter(node => node.type === 'L').length;
    const oldCurrentExtras = Math.max(0, oldNodes.filter(node => node.type === 'L').length - 1);
    const selectedCurrentExtras = Math.max(0, selected.filter(node => node.type === 'L').length - 1);
    state.extraElites = Math.max(0, state.extraElites - oldCurrentExtras + selectedCurrentExtras);

    state.nodes = selected;
    if (state.phase === 'route') state.phase = 'map';
    state.routeMap = { nodes: this.createRouteMap(selected), path: selected.map((_node, depth) => `a${state.act}-d${depth}-l1`) };
    state._routeMapVersion = 1;
    state._routeMapLegacy = isLegacy;
    if (state.phase === 'won' && state.act === 5) {
      state.step = 0;
    } else if (selected.length && !selected.at(-1)?.completed) {
      state.step = selected.length - 1;
    } else {
      state.step = selected.length;
    }
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
    return methodTalents(this.content, item.method).filter(talent => talent.tier === item.tier);
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
        case 'battle_done':
          this.battleDone();
          break;
        case 'continue_battle':
          this.continueBattle();
          break;
        case 'reward':
          this.chooseReward(command.id);
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
        case 'leave_shop':
          this.leaveShop();
          break;
        case 'rest':
          this.rest(command.choice, command.method);
          break;
        case 'talent':
          this.chooseTalent(command.id);
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

  private freezeEnemy(type: RunNode['type'], index: number, key: string): string {
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
    const random = seededRandom(`${this.state.seed}:enemy:${key}`);
    let selected = pool[Math.floor(random() * pool.length)] ?? pool[0];
    if (selected === state._lastEnemyId && pool.length > 1) {
      selected = pool[(pool.indexOf(selected) + 1) % pool.length];
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
      state._battleSettled = false;
      state._eventSettled = false;
      state._previewKind = undefined;
      state._eventCostTravelApplied = false;
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
    };
  }

  private fight(): void {
    if (this.state.phase !== 'preview') throw new Error('Fight is not available now');
    const node = this.node;
    if (!node) throw new Error('No node');
    const state = this.state as RunStateInternals;
    const enemyId = state._previewKind === 'event' ? state._pendingEvent?.enemyId : node.id;
    if (!enemyId) throw new Error('No frozen enemy');
    const enemy = this.buildEnemy(enemyId);
    const input: RunState['battleInput'] = {
      player: clone(this.player),
      enemy,
      seed: `${this.state.seed}:battle:${this.state.act}:${this.state.step}:${state._previewKind ?? 'node'}`,
      roundLimit: 256,
    };
    // Preparation is a one-battle input.  It is consumed at battle start and
    // therefore is not replayed by `continue_battle`.
    this.state.preparation = 0;
    this.state.firstStrike = 0;
    const result = worker().simulateBattle(this.content, input.player, input.enemy, input.seed, { roundLimit: input.roundLimit });
    validateBattleResult(result);
    this.state.battleInput = input;
    this.state.battle = clone(result);
    this.state.phase = 'battle';
    state._battleKind = state._previewKind === 'event' ? 'event' : 'node';
    state._battleNodeType = node.type;
  }

  private continueBattle(): void {
    if (this.state.phase !== 'battle' || !this.state.battleInput || !this.state.battle) throw new Error('No battle can be continued');
    if (this.state.battle.outcome !== 'draw') throw new Error('Only a drawn battle can continue');
    const input = this.state.battleInput;
    if (input.roundLimit >= 4096) {
      throw new Error('Battle reached the maximum 4096-round horizon; retire the run explicitly');
    }
    input.roundLimit = Math.min(4096, input.roundLimit * 2);
    const result = worker().simulateBattle(this.content, input.player, input.enemy, input.seed, { roundLimit: input.roundLimit });
    validateBattleResult(result);
    this.state.battleInput = input;
    this.state.battle = clone(result);
  }

  private battleDone(): void {
    if (this.state.phase !== 'battle' || !this.state.battle) throw new Error('No battle result to settle');
    if (this.state.battle.outcome === 'draw') throw new Error('A drawn battle must be continued');
    const state = this.state as RunStateInternals;
    if (state._battleSettled) throw new Error('Battle already settled');
    state._battleSettled = true;
    if (state._battleKind === 'event') {
      this.settleEventBattle();
      return;
    }
    const node = this.node;
    if (!node) throw new Error('No battle node');
    const battle = this.state.battle;
    this.state.hp = clamp(battle.playerHp, 0, this.stats.max_hp);
    if (battle.outcome !== 'player') {
      this.state.phase = 'lost';
      this.state.resultText = `你在${contentEntity(this.content, node.id)?.name ?? node.id}前倒下。`;
      return;
    }
    if (node.type === 'F') {
      this.markNodeCompleteWithoutTravel();
      const finalText = '你凭一路修来的本领渡过天门。';
      this.state.history.push({
        act: this.state.act,
        step: this.state.step,
        title: contentEntity(this.content, node.id)?.name ?? node.id,
        text: finalText,
      });
      this.state.phase = 'won';
      this.state.resultText = finalText;
      return;
    }
    this.state.phase = 'reward';
    this.settleBattleEconomy(node.type);
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
    if (battle.outcome === 'player') {
      this.applyFlags(option);
      this.applyRewards(optionRewards(option));
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

  private settleBattleEconomy(type: RunNode['type']): void {
    const state = this.state as RunStateInternals;
    if (state._rewardSettled) throw new Error('Battle economy already settled');
    state._rewardSettled = true;
    const index = Math.max(0, this.state.act - 1);
    const economy = rulesOf(this.content).economy ?? {};
    if (type === 'C') {
      this.state.xp += finite(economy.ordinary_xp_by_act?.[index]) ? economy.ordinary_xp_by_act[index] : 0;
      this.state.coins += finite(economy.ordinary_coins_by_act?.[index]) ? economy.ordinary_coins_by_act[index] : 0;
      this.state.rewardCandidates = this.rollArtifacts('common', 3, `reward:${this.state.act}:${this.state.step}:common`);
    } else if (type === 'L') {
      this.state.xp += finite(economy.elite_xp_by_act?.[index]) ? economy.elite_xp_by_act[index] : 0;
      this.state.coins += finite(economy.elite_coins_by_act?.[index]) ? economy.elite_coins_by_act[index] : 0;
      this.state.rewardCandidates = this.rollArtifacts('rare', 3, `reward:${this.state.act}:${this.state.step}:elite`);
    } else if (type === 'B') {
      this.state.xp += finite(economy.boss_xp_by_act?.[index]) ? economy.boss_xp_by_act[index] : 0;
      this.state.coins += finite(economy.boss_coins_by_act?.[index]) ? economy.boss_coins_by_act[index] : 0;
      this.state.rewardCandidates = this.rollArtifacts('rare', 3, `reward:${this.state.act}:${this.state.step}:boss`);
      this.maybeReplaceBossReward();
    }
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

  private chooseReward(id: string | null): void {
    if (this.state.phase !== 'reward') throw new Error('No reward is pending');
    const state = this.state as RunStateInternals;
    if (state._rewardSettled !== true) throw new Error('Battle reward is not frozen');
    if (id === null) {
      this.state.coins += finite(rulesOf(this.content).economy?.artifact_decline_coins)
        ? rulesOf(this.content).economy.artifact_decline_coins
        : 4;
    } else {
      if (typeof id !== 'string' || !this.state.rewardCandidates.includes(id)) throw new Error('Invalid reward ID');
      if (!this.canAcquireArtifact(id, 1)) throw new Error('Reward artifact is no longer available');
      addArtifact(this.content, this.state, id, 1);
    }
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
    this.applyCosts(optionCosts(option));
    this.state.eventOption = id;
    if (encounter) {
      const state = this.state as RunStateInternals;
      state._pendingEvent = encounter;
      state._previewKind = 'event';
      this.state.phase = 'preview';
      return;
    }
    this.applyFlags(option);
    this.state.phase = 'event_result';
    this.applyRewards(optionRewards(option));
    this.state.resultText = option.outcome ?? '';
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
    state._lastCorePosition = undefined;
    this.state.routeMap = { nodes: this.createRouteMap(), path: [] };
    this.state.rewardCandidates = [];
    this.state.shop = [];
    state._routeMapVersion = 1;
    state._routeMapLegacy = false;
    state._battleSettled = false;
    state._eventSettled = false;
    state._previewKind = undefined;
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
        price: artifact.rarity === 'rare' ? (finite(act?.economy?.shop?.rare_price) ? act.economy.shop.rare_price : 90) :
          (finite(act?.economy?.shop?.common_price) ? act.economy.shop.common_price : 40),
        sold: false,
      });
    }
    const recovery = rulesOf(this.content).economy?.non_artifact_prices?.recovery ?? {};
    const preparation = rulesOf(this.content).economy?.non_artifact_prices?.preparation ?? {};
    items.push({
      id: 'recovery',
      kind: 'recovery',
      price: finite(recovery.price) ? recovery.price : 15,
      sold: false,
    });
    items.push({
      id: 'preparation',
      kind: 'preparation',
      price: finite(preparation.price) ? preparation.price : 12,
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
    this.state.coins -= item.price;
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

  private rest(choice: 'heal' | 'preparation' | 'swap_method', method?: string): void {
    if (this.state.phase !== 'rest') throw new Error('Rest is not available');
    const state = this.state as RunStateInternals;
    if (!['heal', 'preparation', 'swap_method'].includes(choice)) throw new Error('Unknown rest choice');
    if (state._restFromEvent && choice !== 'swap_method') throw new Error('This event only grants a method swap');
    if (choice === 'heal') {
      this.state.hp = Math.min(this.stats.max_hp, this.state.hp + (rulesOf(this.content).economy?.rest_heal_ratio ?? 0.25) * currentReferenceHp(this.content, this.state.act));
      this.state.resultText = '休整后恢复气血。';
    } else if (choice === 'preparation') {
      this.state.preparation += 0.1 * currentReferenceHp(this.content, this.state.act);
      this.state.resultText = '下一场战斗前的护盾准备完成。';
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
    const talent = methodTalents(this.content, item.method).find(candidate => candidate.id === id && candidate.tier === item.tier);
    if (!talent) throw new Error('Talent is not an earned choice for the active method');
    state.talents[item.method] ??= [];
    if (state.talents[item.method].includes(id)) throw new Error('Talent already selected');
    state.talents[item.method].push(id);
    if (item.advance && item.tier === this.state.n + 1) this.state.n += 1;
    state._talentQueue!.shift();
    this.ensureTalentQueue();
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
      state._returnPhase ??= this.state.phase === 'talent' ? 'map' : this.state.phase;
      if (activate) this.state.phase = 'talent';
      return;
    }
    const unlocked = unlockedTier(this.content, this.state);
    const currentTalents = state.talents[state.method] ?? [];
    const selectedTiers = new Set(currentTalents.map(id => talentTier(this.content, state.method, id)).filter(integer));
    let next = this.state.n + 1;
    if (unlocked >= next && !selectedTiers.has(next)) {
      state._talentQueue.push({ method: state.method, tier: next, advance: true });
    } else {
      for (let tier = 1; tier <= unlocked; tier++) {
        if (!selectedTiers.has(tier)) {
          state._talentQueue.push({ method: state.method, tier, advance: false });
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
        state._talentQueue.push({ method, tier, advance });
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
      } else if (cost.resource === 'coins') this.state.coins -= cost.amount;
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
          return contentEntity(this.content, reward.id)?.kind === 'method' ? undefined : 'unknown-method';
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

  private canAcquireArtifact(id: string, count: number): boolean {
    try {
      return artifactCapacity(this.content, this.state, id, count).ok;
    } catch {
      return false;
    }
  }

  private artifactPool(rarity: string): string[] {
    return contentEntities(this.content, 'artifact')
      .filter(artifact => artifact.rarity === rarity)
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
    const entity = contentEntity(this.content, node.id);
    this.state.history.push({
      act: this.state.act,
      step: this.state.step,
      title: entity?.name ?? node.id,
      text: this.state.resultText || entity?.summary || '',
    });
    node.completed = true;
    const routeKey = state.routeMap?.path[this.state.step];
    const routeNode = state.routeMap?.nodes.find(candidate => candidate.key === routeKey);
    if (routeNode) routeNode.completed = true;
    if (node.type === 'K' && !this.state.completedCore.includes(node.id)) {
      this.state.completedCore.push(node.id);
    }
    this.applyTravel(node, source);
    this.state.eventOption = undefined;
    this.state.battle = undefined;
    this.state.battleInput = undefined;
    state._pendingEvent = undefined;
    state._previewKind = undefined;
    state._battleKind = undefined;
    state._battleNodeType = undefined;
    state._battleRewardType = undefined;
    state._battleSettled = false;
    state._eventSettled = false;
    state._rewardSettled = false;
    this.state.rewardCandidates = [];
    this.state.shop = [];
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
      artifacts: clone(source?.artifacts ?? this.state.artifacts),
      baseStats: baseStats(this.content, this.state.n),
      hp: this.state.hp,
      preparation: 0,
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
    const sourceMethod = source?.method ?? this.state.method;
    const sourceStats = this.sourceStats(source);
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
    for (const stack of source?.artifacts ?? []) {
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

export function validateBattleResult(result: BattleResult): void {
  if (!isObject(result) || !['player', 'enemy', 'draw'].includes(result.outcome)) throw new Error('Invalid battle outcome');
  if (!integer(result.rounds) || result.rounds < 0 || !finite(result.playerHp) || !finite(result.enemyHp)) throw new Error('Invalid battle result numbers');
  if (!Array.isArray(result.frames) || result.frames.length > 20000 || !Array.isArray(result.contributions)) throw new Error('Invalid battle result frames');
  if (!allFiniteNumbers(result)) throw new Error('Non-finite battle result');
}

function validateLoadoutReferences(content: Content, loadout: Loadout, enemy = false): void {
  if (!isObject(loadout) || typeof loadout.name !== 'string' || typeof loadout.method !== 'string' ||
    !integer(loadout.n) || loadout.n < 0 || loadout.n > 4 || !Array.isArray(loadout.talents) ||
    !Array.isArray(loadout.artifacts)) throw new Error('Invalid saved loadout');
  const method = contentEntity(content, loadout.method);
  if (!method || method.kind !== 'method') throw new Error('Invalid saved loadout method');
  const tiers = new Set<number>();
  for (const id of loadout.talents) {
    if (typeof id !== 'string') throw new Error('Invalid saved talent ID');
    const talent = methodTalents(content, method.id).find(candidate => candidate.id === id);
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
    if (artifact.unique_group) {
      if (groups.has(artifact.unique_group)) throw new Error('Invalid saved unique artifact group');
      groups.add(artifact.unique_group);
    }
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

export function validateRunState(content: Content, raw: RunState): void {
  content = normalizeContent(content);
  if (!isObject(raw)) throw new Error('Invalid run state');
  const state = raw as RunStateInternals;
  if (state.schema !== 1 || state.contentVersion !== content.version) throw new Error('Run/content version mismatch');
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
      const key = `${item.method}:${item.tier}`;
      if (queued.has(key)) throw new Error('Duplicate talent queue item');
      queued.add(key);
      const selected = state.talents[item.method] ?? [];
      if (selected.some(id => talentTier(content, item.method, id) === item.tier)) {
        throw new Error('Talent queue conflicts with selected talent');
      }
      if (item.advance && item.tier !== state.n + 1) {
        throw new Error('Invalid advancing talent queue item');
      }
    }
  }
  if (!Array.isArray(state.nodes) || !Array.isArray(state.routes) || !Array.isArray(state.artifacts) ||
    !Array.isArray(state.history)) throw new Error('Invalid run collections');
  if (state._routeMapVersion !== undefined && state._routeMapVersion !== 1) {
    throw new Error('Invalid route map version');
  }
  if (state._routeMapLegacy !== undefined && typeof state._routeMapLegacy !== 'boolean') {
    throw new Error('Invalid legacy route map marker');
  }
  if (state._routeMapVersion === 1 && !state.routeMap) throw new Error('Saved route map is missing');
  if (state.routeMap) {
    validateRouteMap(state.routeMap, state.act, state.nodes, state.step, state.phase, state._routeMapLegacy === true);
  }
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
  ] as const) {
    if (state[key] !== undefined && typeof state[key] !== 'boolean') throw new Error(`Invalid ${key}`);
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
  if (state._battleNodeType !== undefined &&
    !['C', 'E', 'K', 'L', 'S', 'R', 'B', 'F'].includes(state._battleNodeType)) {
    throw new Error('Invalid battle node type');
  }
  if (state._battleRewardType !== undefined &&
    !['common', 'elite', 'boss'].includes(state._battleRewardType)) {
    throw new Error('Invalid battle reward type');
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
    artifacts: state.artifacts,
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
  if (!Array.isArray(state.rewardCandidates) || state.rewardCandidates.some(id =>
    typeof id !== 'string' || contentEntity(content, id)?.kind !== 'artifact')) throw new Error('Invalid reward candidates');
  if (!Array.isArray(state.shop)) throw new Error('Invalid shop');
  for (const item of state.shop) {
    if (!isObject(item) || typeof item.id !== 'string' || !['artifact', 'recovery', 'preparation'].includes(item.kind) ||
      !finite(item.price) || item.price < 0 || typeof item.sold !== 'boolean') throw new Error('Invalid shop item');
    if (item.kind === 'artifact' && contentEntity(content, item.id)?.kind !== 'artifact') throw new Error('Invalid shop artifact');
    if (item.kind !== 'artifact' && !['recovery', 'preparation'].includes(item.id)) throw new Error('Invalid shop service');
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
    validateLoadoutReferences(content, state.battleInput.player);
    validateLoadoutReferences(content, state.battleInput.enemy, true);
  }
  if (state.battle) validateBattleResult(state.battle);
  if (state.eventOption !== undefined && typeof state.eventOption !== 'string') throw new Error('Invalid event option');
  const currentNode = state.nodes[state.step];
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
  options?: { roundLimit?: number },
): BattleResult {
  const result = worker().simulateBattle(content, player, enemy, seed, options);
  validateBattleResult(result);
  return result;
}
