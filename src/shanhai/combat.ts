import { hashSeed, seededRandom } from './content.js';
import type {
  BattleFrame,
  BattleResult,
  Content,
  Contribution,
  FighterView,
  Loadout,
  Stats,
} from './types.js';

/*
 * The Shanhai cards are deliberately data first, but the combat boundary is
 * not a generic "multiply every number" evaluator.  Several cards replace an
 * outlet or reserve a resource before an action starts.  The small runtime
 * below keeps those decisions explicit while still reading the authored
 * values from the content entities.
 */

type AnyMap = Record<string, any>;
type Effect = AnyMap & { id: string; trigger: string; operation: string; target?: string };
type ActiveEffect = Effect & { ownerId: string; ownerName: string; ownerKind: SourceKind; ownerSide?: 'player' | 'enemy'; stacks: number };
type SourceKind = 'method' | 'talent' | 'artifact';
type ActionType = 'basic_action' | 'rage_action';
type StatusName = 'poison' | 'burn' | 'weakness' | 'armor_break' | 'sword_intent' | 'charge_luck' | 'day_night';

interface StatusLayer {
  remaining: number;
  damage?: number;
  sourceId?: string;
  ownerId?: string;
  attackRatio?: number;
  kind?: 'dot' | 'regular';
}

interface ArtifactRuntime {
  entity: AnyMap;
  stacks: number;
}

interface Fighter {
  side: 'player' | 'enemy';
  lockedAction?: ActionType;
  loadout: Loadout;
  method: AnyMap;
  talents: AnyMap[];
  artifacts: ArtifactRuntime[];
  stats: Stats;
  hp: number;
  shield: number;
  rage: number;
  rageCap: number;
  firstStrike: number;
  firstStrikeConsumed: boolean;
  statuses: Map<StatusName, StatusLayer[]>;
  phase: 'day' | 'night';
  forcedBasic: { ratioAdd: number; rageGainBonus: number } | null;
  pendingGains: RageEntry[];
  pendingDrains: RageDrain[];
  actionNumber: number;
  battleFlags: Set<string>;
  battleLayers: Record<string, number>;
  contributionIds: Set<string>;
  runtimeEffects?: ActiveEffect[];
}

interface RageEntry {
  amount: number;
  sourceId: string;
  sourceOwner: string;
}

interface RageDrain {
  amount: number;
  sourceId: string;
  sourceOwner: string;
  opening: boolean;
}

interface ActionContext {
  actor: Fighter;
  target: Fighter;
  type: ActionType;
  isMainAction: boolean;
  round: number;
  lockedCost: number;
  actionStats: Stats;
  actionStartShield: number;
  actionStartStatuses: Map<StatusName, number>;
  reservedChargeLuck: boolean;
  chargeLuckAvailableAtStart: boolean;
  swordIntentAtStart: number;
  consumedSwordIntent: number;
  consumedBurn: number;
  consumedShield: number;
  consumedShieldDamage: number;
  actualBonusSegments: number;
  actualDebuffApplied: boolean;
  hadEffectiveBaseHit: boolean;
  hadBaseCriticalHit: boolean;
  firstBaseHit: boolean;
  baseDirectHitCount: number;
  directCritCount: number;
  rr10CritCount: number;
  recoilDone: boolean;
  actualHpDamage: number;
  actualAbsorbed: number;
  enemyActualHpDamage: number;
  reflectDamage: number;
  phaseBefore: 'day' | 'night';
  phaseChanged: boolean;
  phaseTransition: string | null;
  completed: boolean;
  stop: boolean;
  dotRageRecorded: boolean;
  healRageRecorded: boolean;
}

interface HitResult {
  raw: number;
  amount: number;
  absorbed: number;
  hpDamage: number;
  critical: boolean;
  effective: boolean;
  shieldBroken: boolean;
}

interface BattleRuntime {
  content: Content;
  random: () => number;
  seed: string;
  frames: BattleFrame[];
  player: Fighter;
  enemy: Fighter;
  contributions: Map<string, Contribution>;
  sourceNames: Map<string, string>;
  round: number;
  active: boolean;
  reason?: string;
  roundDrainRequested: Map<'player' | 'enemy', number>;
  openingDrainRequested: Map<'player' | 'enemy', number>;
  currentAction: ActionContext | null;
  sameSpeedFirst: 'player' | 'enemy';
}

const COMBAT_TRIGGERS = new Set([
  'battle_start',
  'basic_action',
  'rage_action',
  'basic_hit',
  'direct_hit',
  'direct_crit',
  'action_end',
  'enemy_action_end',
  'shield_absorbed',
  'shield_broken',
  'heal_resolved',
  'overflow_resolved',
  'dot_resolved',
  'round_end',
  'always',
]);

const SUPPORTED_OPERATIONS = new Set([
  'damage',
  'heal',
  'shield',
  'apply_status',
  'modify_stat',
  'modify_effect',
  'rage_gain',
  'rage_cap',
  'rage_drain',
  'rage_drain_resist',
  'convert_overflow',
  'consume_status',
  'consume_shield',
  'advance_phase',
  'chance_damage',
  'modify_chance',
  'replace_action',
]);

const TRAVEL_TRIGGERS = new Set([
  'node_complete',
  'battle_node_complete',
  'rest_complete',
  'event_cost_paid',
]);

const KNOWN_REQUIREMENTS = new Set([
  'shield_present',
  'shield_available',
  'first_direct_break_alive',
  'positive_direct_damage_absorbed',
  'rage_action_completed',
  'phase_is_day',
  'phase_changed',
  'phase_transition_day_to_night',
  'phase_transition_night_to_day',
  'low_current_hp',
  'critical_low_current_hp',
  'effective_self_heal',
  'positive_actual_heal_overflow',
  'actual_heal_overflow',
  'enemy_has_method_burn',
  'burn_available',
  'poison_available',
  'sword_intent_available',
  'sword_intent_snapshot',
  'sword_intent_at_or_above_5',
  'effective_direct_critical_hit',
  'effective_basic_base_hit',
  'effective_basic_base_hit',
  'effective_rage_base_segment',
  'positive_effective_base_hit',
  'actual_bonus_lightning_segments',
  'charge_luck_available',
  'enemy_has_poison',
  'enemy_has_actual_debuff',
  'actual_debuff_applied_this_action',
  'enemy_has_armor_break',
  'enemy_has_burn',
  'effective_existing_shield_reflect',
  'own_main_action_completed',
  'positive_actual_burn_damage',
  'positive_actual_hp_damage',
  'positive_actual_hp_damage_from_own_burn',
  'positive_actual_hp_damage_from_own_poison_or_burn',
  'real_rest_completed_alive',
  'real_rest_completed',
  'real_nonbattle_node_completed',
  'real_battle_node_completed_alive',
  'real_open_node_completed_alive',
  'real_node_completed_alive',
  'two_consecutive_nodes_completed',
  'active_hp_event_cost_paid_and_survived',
  'requires_alive',
  'rage_action_completed',
  'burn_available',
  'poison_available',
  'first_direct_break_alive',
]);

const STAT_KEYS: (keyof Stats)[] = ['attack', 'defense', 'max_hp', 'crit_rate', 'speed'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function n(value: unknown, fallback = 0): number {
  return isFiniteNumber(value) ? value : fallback;
}

function int(value: unknown, fallback = 0): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function entity(content: Content, id: string, kind?: string): AnyMap {
  const result = content.byId[id];
  if (!result) throw new Error(`Unknown Shanhai content ID: ${id}`);
  if (kind && result.kind !== kind) throw new Error(`Content ${id} is not ${kind}`);
  return result;
}

function allMethodEffects(method: AnyMap): Effect[] {
  const result: Effect[] = [];
  for (const action of [method.actions?.basic, method.actions?.rage]) {
    for (const effect of action?.effects ?? []) result.push(effect);
  }
  result.push(...(method.passives ?? []));
  for (const talent of method.talents ?? []) result.push(...(talent.effects ?? []));
  result.push(...(method.travel ?? []));
  return result;
}

function activeEffects(method: AnyMap, talents: AnyMap[], artifacts: ArtifactRuntime[]): ActiveEffect[] {
  const result: ActiveEffect[] = [];
  const add = (effect: Effect, ownerId: string, ownerName: string, ownerKind: SourceKind, stacks = 1) => {
    result.push(Object.assign(clone(effect), { ownerId, ownerName, ownerKind, stacks }));
  };
  for (const action of [method.actions?.basic, method.actions?.rage]) {
    for (const effect of action?.effects ?? []) add(effect, method.id, method.name, 'method');
  }
  for (const effect of method.passives ?? []) add(effect, method.id, method.name, 'method');
  for (const talent of talents) for (const effect of talent.effects ?? []) add(effect, talent.id, talent.name, 'talent');
  for (const artifact of artifacts) for (const effect of artifact.entity.effects ?? []) add(effect, artifact.entity.id, artifact.entity.name, 'artifact', artifact.stacks);
  return result;
}

function effectIds(method: AnyMap, talents: AnyMap[], artifacts: ArtifactRuntime[]): Set<string> {
  return new Set(activeEffects(method, talents, artifacts).map(effect => effect.id));
}

function validateEffects(
  method: AnyMap,
  talents: AnyMap[],
  artifacts: ArtifactRuntime[],
): void {
  const activeIds = effectIds(method, talents, artifacts);
  const authoredIds = new Set<string>([
    ...allMethodEffects(method).map(effect => effect.id),
    ...artifacts.flatMap(artifact => (artifact.entity.effects ?? []).map((effect: Effect) => effect.id)),
  ]);
  for (const effect of activeEffects(method, talents, artifacts)) {
    if (!effect.id || !COMBAT_TRIGGERS.has(effect.trigger) && !TRAVEL_TRIGGERS.has(effect.trigger)) {
      throw new Error(`Unsupported or missing Shanhai effect trigger: ${effect.id}`);
    }
    if (TRAVEL_TRIGGERS.has(effect.trigger)) continue;
    if (!SUPPORTED_OPERATIONS.has(effect.operation)) {
      throw new Error(`Unsupported Shanhai combat operation ${effect.operation} (${effect.id})`);
    }
    for (const requirement of effect.requires ?? []) {
      if (activeIds.has(requirement) || authoredIds.has(requirement)) continue;
      if (!KNOWN_REQUIREMENTS.has(requirement)) {
        throw new Error(`Unsupported Shanhai combat requirement ${requirement} (${effect.id})`);
      }
    }
    for (const replacement of effect.replaces ?? []) {
      if (!authoredIds.has(replacement)) {
        throw new Error(`Unsupported Shanhai replacement ${replacement} (${effect.id})`);
      }
    }
  }
}

function validateLoadout(content: Content, loadout: Loadout): { method: AnyMap; talents: AnyMap[]; artifacts: ArtifactRuntime[] } {
  if (!loadout || typeof loadout !== 'object') throw new Error('Invalid Shanhai loadout');
  if (typeof loadout.method !== 'string') throw new Error('Loadout method is required');
  for (const [key, value] of [['preparation', loadout.preparation], ['firstStrike', loadout.firstStrike]] as const) {
    if (value !== undefined && (!isFiniteNumber(value) || value < 0)) {
      throw new Error(`Invalid ${key} preparation`);
    }
  }
  const method = entity(content, loadout.method, 'method');
  if (!Number.isInteger(loadout.n) || loadout.n < 0 || loadout.n > 4) {
    throw new Error(`Invalid cultivation tier n=${loadout.n}`);
  }
  if (!Array.isArray(loadout.talents)) throw new Error('Loadout talents must be an array');
  const methodTalents = new Map<string, AnyMap>((method.talents ?? []).map((talent: AnyMap) => [talent.id, talent]));
  const chosen: AnyMap[] = [];
  const tiers = new Set<number>();
  for (const id of loadout.talents) {
    const talent = methodTalents.get(id);
    if (!talent) throw new Error(`Talent ${id} does not belong to ${method.id}`);
    if (tiers.has(talent.tier)) throw new Error(`More than one talent selected at tier ${talent.tier}`);
    if (talent.tier > loadout.n) throw new Error(`Talent ${id} exceeds cultivation tier ${loadout.n}`);
    tiers.add(talent.tier);
    chosen.push(talent);
  }
  if (!Array.isArray(loadout.artifacts)) throw new Error('Loadout artifacts must be an array');
  const artifacts: ArtifactRuntime[] = [];
  const uniqueGroups = new Set<string>();
  const counts = new Map<string, number>();
  for (const stack of loadout.artifacts) {
    if (!stack || typeof stack.id !== 'string' || !Number.isInteger(stack.stacks) || stack.stacks <= 0) {
      throw new Error(`Invalid artifact stack ${JSON.stringify(stack)}`);
    }
    const artifact = entity(content, stack.id, 'artifact');
    const max = int(artifact.max_stacks, 1);
    if (stack.stacks > max) throw new Error(`Artifact ${stack.id} exceeds max stacks ${max}`);
    const count = (counts.get(stack.id) ?? 0) + stack.stacks;
    counts.set(stack.id, count);
    if (count > max) throw new Error(`Artifact ${stack.id} exceeds combined max stacks ${max}`);
    const group = artifact.unique_group;
    if (group) {
      if (uniqueGroups.has(group)) throw new Error(`Duplicate unique artifact group ${group}`);
      uniqueGroups.add(group);
    }
    artifacts.push({ entity: artifact, stacks: stack.stacks });
  }
  validateEffects(method, chosen, artifacts);
  return { method, talents: chosen, artifacts };
}

function rules(content: Content): AnyMap {
  if (!content.rules || content.rules.id !== 'RULES') throw new Error('Missing Shanhai RULES');
  return content.rules;
}

function tierBaseStats(content: Content, loadout: Loadout): Stats {
  if (loadout.baseStats) {
    const base = loadout.baseStats;
    for (const key of STAT_KEYS) if (!isFiniteNumber(base[key])) throw new Error(`Invalid base stat ${key}`);
    return { ...base };
  }
  const table = rules(content).cultivation?.base_stats_by_tier;
  const row = table?.[loadout.n];
  if (!row) throw new Error(`Missing base stats for tier ${loadout.n}`);
  const stats: AnyMap = {};
  for (const key of STAT_KEYS) {
    if (!isFiniteNumber(row[key])) throw new Error(`Missing base stat ${key} at tier ${loadout.n}`);
    stats[key] = row[key];
  }
  return stats as Stats;
}

function unconditionalStatEffect(effect: Effect): boolean {
  if (effect.operation !== 'modify_stat') return false;
  if (effect.trigger !== 'always') return false;
  const p = effect.params ?? {};
  if (p.condition) return false;
  if (effect.requires?.some((item: string) => !item.startsWith('RKF') && !item.startsWith('RC') && !item.startsWith('RR') && !item.startsWith('RL'))) return false;
  return true;
}

function addStatEffect(stats: Stats, effect: Effect, stacks: number): void {
  if (!unconditionalStatEffect(effect)) return;
  const p = effect.params ?? {};
  const stat = p.stat as keyof Stats;
  if (!STAT_KEYS.includes(stat)) throw new Error(`Unknown stat ${String(stat)} in ${effect.id}`);
  const amount = n(p.amount ?? p.flat, 0) * stacks;
  if (p.mode === 'percent_add') stats[stat] *= 1 + amount;
  else stats[stat] += amount;
}

export function calculateStats(content: Content, loadout: Loadout): Stats {
  const compiled = validateLoadout(content, loadout);
  const stats = tierBaseStats(content, loadout);
  const flat: Stats = { attack: 0, defense: 0, max_hp: 0, crit_rate: 0, speed: 0 };
  const percent: Stats = { attack: 0, defense: 0, max_hp: 0, crit_rate: 0, speed: 0 };
  for (const artifact of compiled.artifacts) {
    for (const key of STAT_KEYS) flat[key] += n(artifact.entity.attributes?.flat?.[key], 0) * artifact.stacks;
    for (const key of STAT_KEYS) percent[key] += n(artifact.entity.attributes?.percent?.[key], 0) * artifact.stacks;
  }
  for (const key of STAT_KEYS) stats[key] += flat[key];
  for (const key of STAT_KEYS) stats[key] *= 1 + percent[key];
  for (const effect of activeEffects(compiled.method, compiled.talents, compiled.artifacts)) {
    if (effect.ownerKind === 'artifact') continue;
    addStatEffect(stats, effect, effect.stacks);
  }
  for (const key of STAT_KEYS) if (!isFiniteNumber(stats[key]) || stats[key] < 0) throw new Error(`Invalid calculated stat ${key}`);
  return stats;
}

function sourceName(runtime: BattleRuntime, id: string): string {
  return runtime.sourceNames.get(id) ?? id;
}

function ensureContribution(runtime: BattleRuntime, id: string, name?: string): Contribution {
  let contribution = runtime.contributions.get(id);
  if (!contribution) {
    contribution = {
      id,
      name: name ?? sourceName(runtime, id),
      triggers: 0,
      damage: 0,
      healing: 0,
      shield: 0,
      absorbed: 0,
      rage: 0,
    };
    runtime.contributions.set(id, contribution);
  }
  return contribution;
}

function sourceBelongsToPlayer(
  runtime: BattleRuntime,
  effect: ActiveEffect | string,
  explicitSide?: 'player' | 'enemy',
): boolean {
  if (explicitSide) return explicitSide === 'player';
  if (typeof effect !== 'string' && effect.ownerSide) return effect.ownerSide === 'player';
  const id = typeof effect === 'string' ? effect : effect.ownerId;
  const action = runtime.currentAction;
  if (action) {
    const actor = action.actor;
    if (id === actor.method.id || actor.talents.some(talent => talent.id === id) || actor.artifacts.some(artifact => artifact.entity.id === id)) {
      return actor.side === 'player';
    }
  }
  return id === runtime.player.method.id ||
    runtime.player.talents.some(talent => talent.id === id) ||
    runtime.player.artifacts.some(artifact => artifact.entity.id === id);
}

function mark(runtime: BattleRuntime, effect: ActiveEffect | string, triggers = 1, ownerSide?: 'player' | 'enemy'): void {
  if (!sourceBelongsToPlayer(runtime, effect, ownerSide)) return;
  const id = typeof effect === 'string' ? effect : effect.ownerId;
  const name = typeof effect === 'string' ? undefined : effect.ownerName;
  const contribution = ensureContribution(runtime, id, name);
  contribution.triggers += triggers;
}

function addContribution(
  runtime: BattleRuntime,
  owner: ActiveEffect | string,
  field: 'damage' | 'healing' | 'shield' | 'absorbed' | 'rage',
  amount: number,
  ownerSide?: 'player' | 'enemy',
): void {
  if (!amount || !sourceBelongsToPlayer(runtime, owner, ownerSide)) return;
  const id = typeof owner === 'string' ? owner : owner.ownerId;
  const name = typeof owner === 'string' ? undefined : owner.ownerName;
  const contribution = ensureContribution(runtime, id, name);
  contribution[field] = n(contribution[field], 0) + amount;
}

function buildSourceRegistry(runtime: BattleRuntime, fighter: Fighter): void {
  runtime.sourceNames.set(fighter.method.id, fighter.method.name);
  ensureContribution(runtime, fighter.method.id, fighter.method.name);
  for (const talent of fighter.talents) {
    runtime.sourceNames.set(talent.id, talent.name);
    if (fighter.side === 'player') ensureContribution(runtime, talent.id, talent.name);
  }
  for (const artifact of fighter.artifacts) {
    runtime.sourceNames.set(artifact.entity.id, artifact.entity.name);
    if (fighter.side === 'player') ensureContribution(runtime, artifact.entity.id, artifact.entity.name);
  }
}

function hasAuthoredAttributes(source: AnyMap): boolean {
  const attributes = source.attributes ?? {};
  return Object.values(attributes.flat ?? {}).some(value => n(value, 0) !== 0) ||
    Object.values(attributes.percent ?? {}).some(value => n(value, 0) !== 0);
}

function authoredSourceEffects(source: AnyMap): Effect[] {
  if (source.kind === 'artifact') return source.effects ?? [];
  if (Array.isArray(source.effects)) return source.effects;
  return allMethodEffects(source);
}

function assignZeroContributionReasons(runtime: BattleRuntime): void {
  for (const contribution of runtime.contributions.values()) {
    if (contribution.triggers !== 0 ||
        contribution.damage !== 0 ||
        contribution.healing !== 0 ||
        contribution.shield !== 0 ||
        contribution.absorbed !== 0 ||
        contribution.rage !== 0) continue;
    const artifact = runtime.player.artifacts.find(item => item.entity.id === contribution.id)?.entity;
    const talent = runtime.player.talents.find(item => item.id === contribution.id);
    const source = artifact ?? talent ?? (runtime.player.method.id === contribution.id ? runtime.player.method : undefined);
    if (!source) {
      contribution.reason = 'conditional trigger absent';
      continue;
    }
    const effects = authoredSourceEffects(source);
    if (hasAuthoredAttributes(source)) {
      contribution.reason = effects.length > 0
        ? 'permanent attributes applied; conditional effect not triggered'
        : 'permanent attributes applied';
      continue;
    }
    if (effects.some(effect => effect.trigger === 'always' && effect.operation === 'modify_stat')) {
      contribution.reason = 'passive modifier not used';
      continue;
    }
    contribution.reason = 'conditional trigger absent';
  }
}

function getStatusLayers(fighter: Fighter, status: StatusName): StatusLayer[] {
  const value = fighter.statuses.get(status);
  if (value) return value;
  const created: StatusLayer[] = [];
  fighter.statuses.set(status, created);
  return created;
}

function statusCount(fighter: Fighter, status: StatusName): number {
  // day_night is a method-owned phase, not a public one-stack status shared
  // by every fighter.  Keep the existing view encoding for RKF10 only.
  if (status === 'day_night') {
    return fighter.method.id === 'RKF10' ? (fighter.phase === 'day' ? 2 : 1) : 0;
  }
  return getStatusLayers(fighter, status).length;
}

function hasStatus(fighter: Fighter, status: StatusName, minimum = 1): boolean {
  return statusCount(fighter, status) >= minimum;
}

function snapshotStatuses(fighter: Fighter): Map<StatusName, number> {
  return new Map<StatusName, number>([
    ['poison', statusCount(fighter, 'poison')],
    ['burn', statusCount(fighter, 'burn')],
    ['weakness', statusCount(fighter, 'weakness')],
    ['armor_break', statusCount(fighter, 'armor_break')],
    ['sword_intent', statusCount(fighter, 'sword_intent')],
    ['charge_luck', statusCount(fighter, 'charge_luck')],
    ['day_night', statusCount(fighter, 'day_night')],
  ]);
}

function fighterView(fighter: Fighter): FighterView {
  const statuses: Record<string, number> = {};
  for (const status of ['poison', 'burn', 'weakness', 'armor_break', 'sword_intent', 'charge_luck', 'day_night'] as StatusName[]) {
    const count = statusCount(fighter, status);
    if (count > 0) statuses[status] = count;
  }
  return {
    name: fighter.loadout.name,
    method: fighter.method.id,
    hp: Math.max(0, fighter.hp),
    maxHp: fighter.stats.max_hp,
    shield: Math.max(0, fighter.shield),
    rage: Math.max(0, fighter.rage),
    rageCap: fighter.rageCap,
    statuses,
    ...(fighter.lockedAction ? { lockedAction: fighter.lockedAction } : {}),
  };
}

function frame(
  runtime: BattleRuntime,
  kind: string,
  text: string,
  actor?: 'player' | 'enemy',
  target?: 'player' | 'enemy',
  source?: string,
  amount?: number,
): void {
  runtime.frames.push({
    round: runtime.round,
    kind,
    actor,
    target,
    source,
    text,
    ...(amount === undefined ? {} : { amount }),
    player: fighterView(runtime.player),
    enemy: fighterView(runtime.enemy),
  });
}

function other(runtime: BattleRuntime, fighter: Fighter): Fighter {
  return fighter.side === 'player' ? runtime.enemy : runtime.player;
}

function conditionOK(
  effect: ActiveEffect,
  actor: Fighter,
  target: Fighter,
  action: ActionContext | null,
): boolean {
  const p = effect.params ?? {};
  const requirements = effect.requires ?? [];
  for (const requirement of requirements) {
    if (requirement.startsWith('RKF') || requirement.startsWith('RC') || requirement.startsWith('RR') || requirement.startsWith('RL')) continue;
    switch (requirement) {
      case 'shield_present':
      case 'shield_available':
        if (actor.shield <= 0) return false;
        break;
      case 'rage_action_completed':
        if (!action?.completed || action.type !== 'rage_action') return false;
        break;
      case 'phase_is_day':
        if (actor.phase !== 'day') return false;
        break;
      case 'phase_changed':
        if (!action?.phaseChanged) return false;
        break;
      case 'phase_transition_day_to_night':
        if (action?.phaseTransition !== 'day_to_night') return false;
        break;
      case 'phase_transition_night_to_day':
        if (action?.phaseTransition !== 'night_to_day') return false;
        break;
      case 'low_current_hp':
        if (actor.hp > actor.stats.max_hp * 0.5) return false;
        break;
      case 'critical_low_current_hp':
        if (actor.hp > actor.stats.max_hp * 0.3) return false;
        break;
      case 'effective_self_heal':
        if (!action || n((action as AnyMap).lastEffectiveHeal, 0) <= 0) return false;
        break;
      case 'positive_actual_heal_overflow':
      case 'actual_heal_overflow':
        if (!action || n((action as AnyMap).lastOverflow, 0) <= 0) return false;
        break;
      case 'effective_direct_critical_hit':
        if (!action?.hadBaseCriticalHit) return false;
        break;
      case 'actual_bonus_lightning_segments':
        if (!action || action.actualBonusSegments < 1) return false;
        break;
      case 'charge_luck_available':
        if (!action?.chargeLuckAvailableAtStart && !hasStatus(actor, 'charge_luck')) return false;
        break;
      case 'effective_basic_base_hit':
        if (!action?.hadEffectiveBaseHit || action.type !== 'basic_action') return false;
        break;
      case 'positive_effective_base_hit':
        if (!action?.hadEffectiveBaseHit || (action.type !== 'basic_action' && action.type !== 'rage_action')) return false;
        break;
      case 'effective_rage_base_segment':
        if (!action?.hadEffectiveBaseHit || action.type !== 'rage_action') return false;
        break;
      case 'enemy_has_method_burn':
      case 'enemy_has_burn':
        if (!hasStatus(target, 'burn')) return false;
        break;
      case 'burn_available':
        if (!hasStatus(target, 'burn')) return false;
        break;
      case 'poison_available':
        if (!hasStatus(target, 'poison')) return false;
        break;
      case 'sword_intent_available':
        if (!hasStatus(actor, 'sword_intent')) return false;
        break;
      case 'sword_intent_snapshot':
        if (!action) return false;
        break;
      case 'sword_intent_at_or_above_5':
        if ((action?.swordIntentAtStart ?? statusCount(actor, 'sword_intent')) < 5) return false;
        break;
      case 'enemy_has_poison':
        if (!hasStatus(target, 'poison')) return false;
        break;
      case 'enemy_has_actual_debuff':
        if (!hasStatus(target, 'weakness') && !hasStatus(target, 'armor_break')) return false;
        break;
      case 'actual_debuff_applied_this_action':
        if (!action?.actualDebuffApplied) return false;
        break;
      case 'enemy_has_armor_break':
        if (!hasStatus(target, 'armor_break')) return false;
        break;
      case 'positive_actual_burn_damage':
        if (!action || n((action as AnyMap).lastDotDamage, 0) <= 0) return false;
        break;
      case 'positive_actual_hp_damage':
        if (!action || action.enemyActualHpDamage <= 0) return false;
        break;
      case 'effective_existing_shield_reflect':
        if (!action || action.reflectDamage <= 0) return false;
        break;
      case 'own_main_action_completed':
        if (!action?.completed) return false;
        break;
      case 'positive_actual_hp_damage_from_own_burn':
        if (!action || n((action as AnyMap).lastOwnDotHpDamage, 0) <= 0) return false;
        break;
      case 'positive_actual_hp_damage_from_own_poison_or_burn':
        if (!action || n((action as AnyMap).lastOwnDotHpDamage, 0) <= 0) return false;
        break;
      default:
        throw new Error(`Unhandled Shanhai requirement ${requirement} (${effect.id})`);
    }
  }
  const condition = p.condition;
  if (!condition) return true;
  if (typeof condition === 'string') {
    switch (condition) {
      case 'shield_present': return actor.shield > 0;
      case 'enemy_has_burn': return hasStatus(target, 'burn');
      case 'first_direct_break_per_battle': return !actor.battleFlags.has('RKF01-J3-B-RECHARGE');
      case 'low_current_hp': return actor.hp <= actor.stats.max_hp * 0.5;
      case 'critical_low_current_hp': return actor.hp <= actor.stats.max_hp * 0.3;
      case 'sword_intent_at_or_above_5': return (action?.swordIntentAtStart ?? statusCount(actor, 'sword_intent')) >= 5;
      default: throw new Error(`Unhandled Shanhai effect condition ${condition} (${effect.id})`);
    }
  }
  if (condition.phase && actor.phase !== condition.phase) return false;
  if (condition.phase_status && condition.phase_status === 'day_night' && condition.phase && actor.phase !== condition.phase) return false;
  if (condition.status && !hasStatus(actor, condition.status, n(condition.min_stacks, 1))) return false;
  if (condition.enemy_status && !hasStatus(target, condition.enemy_status, n(condition.min_stacks, 1))) return false;
  if (condition.enemy_has_actual_debuff && !hasStatus(target, 'weakness') && !hasStatus(target, 'armor_break')) return false;
  if (condition.enemy_has_poison && !hasStatus(target, 'poison')) return false;
  if (condition.enemy_has_burn && !hasStatus(target, 'burn')) return false;
  if (condition.phase_changed && !action?.phaseChanged) return false;
  if (condition.actual_bonus_lightning_segments && (action?.actualBonusSegments ?? 0) < 1) return false;
  if (condition.actual_debuff_applied_this_action && !action?.actualDebuffApplied) return false;
  if (condition.owner_status && !hasStatus(target, condition.owner_status)) return false;
  if (condition.actual_damage && n((action as AnyMap)?.lastDotDamage, 0) <= 0) return false;
  if (condition.last_action === 'rage' && action?.type !== 'rage_action') return false;
  if (condition.phase_transition && action?.phaseTransition !== condition.phase_transition) return false;
  return true;
}

function activeModifiers(fighter: Fighter, op?: string): ActiveEffect[] {
  return fighterRuntimeEffects(fighter).filter(effect => !op || effect.operation === op);
}

function fighterRuntimeEffects(fighter: Fighter): ActiveEffect[] {
  if (fighter.runtimeEffects) return fighter.runtimeEffects;
  const method = fighter.method;
  const result: ActiveEffect[] = [];
  const add = (effect: Effect, ownerId: string, ownerName: string, ownerKind: SourceKind, stacks = 1) =>
    result.push(Object.assign(clone(effect), { ownerId, ownerName, ownerKind, ownerSide: fighter.side, stacks }));
  for (const effect of method.passives ?? []) add(effect, method.id, method.name, 'method');
  for (const talent of fighter.talents) for (const effect of talent.effects ?? []) add(effect, talent.id, talent.name, 'talent');
  for (const artifact of fighter.artifacts) for (const effect of artifact.entity.effects ?? []) add(effect, artifact.entity.id, artifact.entity.name, 'artifact', artifact.stacks);
  fighter.runtimeEffects = result;
  return result;
}

function staticRageCap(fighter: Fighter): number {
  let cap = n(rules((fighter as AnyMap).__content).rage?.base_cap, 100);
  for (const effect of activeModifiers(fighter, 'rage_cap')) {
    const p = effect.params ?? {};
    if (p.first_rage_action_only) continue;
    const amount = n(p.amount ?? p.delta, 0) * effect.stacks;
    if (p.mode === 'subtract') cap -= amount;
    else cap += amount;
  }
  return Math.max(n(rules((fighter as AnyMap).__content).rage?.min_cap, 60), cap);
}

function dynamicStats(runtime: BattleRuntime, fighter: Fighter, target: Fighter, action: ActionContext | null): Stats {
  const stats = { ...fighter.stats };
  const weak = statusCount(fighter, 'weakness');
  stats.attack *= Math.max(0, 1 - weak * n(rules(runtime.content).statuses?.weakness?.reduction_per_stack, 0.05));
  stats.defense *= Math.max(0, 1 - statusCount(fighter, 'armor_break') * n(rules(runtime.content).statuses?.armor_break?.reduction_per_stack, 0.05));
  for (const effect of activeModifiers(fighter, 'modify_stat')) {
    if (effect.trigger === 'battle_start') continue;
    const p = effect.params ?? {};
    if (p.stat !== 'attack' && p.stat !== 'defense' && p.stat !== 'max_hp' && p.stat !== 'crit_rate' && p.stat !== 'speed') continue;
    const context: ActionContext = action ?? ({
      actor: fighter,
      target,
      actionStats: fighter.stats,
      type: 'basic_action',
      isMainAction: false,
      round: runtime.round,
      lockedCost: fighter.rageCap,
      actionStartShield: fighter.shield,
      actionStartStatuses: snapshotStatuses(fighter),
      reservedChargeLuck: false,
      chargeLuckAvailableAtStart: false,
      swordIntentAtStart: statusCount(fighter, 'sword_intent'),
      consumedSwordIntent: 0,
      consumedBurn: 0,
      consumedShield: 0,
      consumedShieldDamage: 0,
      actualBonusSegments: 0,
      actualDebuffApplied: false,
      hadEffectiveBaseHit: false,
      hadBaseCriticalHit: false,
      firstBaseHit: false,
      baseDirectHitCount: 0,
      directCritCount: 0,
      rr10CritCount: 0,
      recoilDone: false,
      actualHpDamage: 0,
      actualAbsorbed: 0,
      enemyActualHpDamage: 0,
      reflectDamage: 0,
      phaseBefore: fighter.phase,
      phaseChanged: false,
      phaseTransition: null,
      completed: false,
      stop: false,
      dotRageRecorded: false,
      healRageRecorded: false,
    } as ActionContext);
    if (!conditionOK(effect, fighter, target, context)) continue;
    const amount = effect.id === 'RR05-ACTION-END-ATTACK-LAYER'
      ? n(p.layer_value ?? p.flat, 4) * n(fighter.battleLayers[effect.id], 0)
      : n(p.amount ?? p.flat, 0) * effect.stacks;
    const stat = p.stat as keyof Stats;
    if (!STAT_KEYS.includes(stat)) throw new Error(`Unknown stat ${String(p.stat)} in ${effect.id}`);
    if (p.mode === 'percent_add') stats[stat] *= 1 + amount;
    else stats[stat] += amount;
    if (amount === 0) continue;
    mark(runtime, effect, effect.stacks);
  }
  return stats;
}

function methodEffect(method: AnyMap, id: string): Effect | undefined {
  return allMethodEffects(method).find(effect => effect.id === id);
}

function selectedEffect(fighter: Fighter, id: string): ActiveEffect | undefined {
  return activeModifiers(fighter).find(effect => effect.id === id);
}

function matchingModification(
  fighter: Fighter,
  targetEffectId: string,
  action: ActionContext,
  target: Fighter,
): ActiveEffect[] {
  return activeModifiers(fighter, 'modify_effect').filter(effect => {
    const p = effect.params ?? {};
    const ids = Array.isArray(p.effect_ids) ? p.effect_ids : p.effect_id ? [p.effect_id] : [];
    if (!ids.includes(targetEffectId)) return false;
    return conditionOK(effect, fighter, target, action);
  });
}

function matchingChanceModification(
  fighter: Fighter,
  targetEffectId: string,
  action: ActionContext,
  target: Fighter,
): ActiveEffect[] {
  return activeModifiers(fighter, 'modify_chance').filter(effect => {
    const ids = Array.isArray(effect.params?.effect_ids) ? effect.params.effect_ids : [];
    return ids.includes(targetEffectId) && conditionOK(effect, fighter, target, action);
  });
}

function actionEffect(fighter: Fighter, actionType: ActionType, id: string): ActiveEffect {
  const effect = (fighter.method.actions?.[actionType === 'basic_action' ? 'basic' : 'rage']?.effects ?? []).find((item: Effect) => item.id === id);
  if (!effect) throw new Error(`Missing action effect ${id} on ${fighter.method.id}`);
  return Object.assign(clone(effect), { ownerId: fighter.method.id, ownerName: fighter.method.name, ownerKind: 'method' as SourceKind, ownerSide: fighter.side, stacks: 1 });
}

function numericField(params: AnyMap, path: string, fallback = 0): number {
  const parts = path.split('.');
  let cursor = params;
  for (const part of parts) cursor = cursor?.[part];
  return isFiniteNumber(cursor) ? cursor : fallback;
}

function applyGenericNumberModifiers(
  runtime: BattleRuntime,
  actor: Fighter,
  target: Fighter,
  action: ActionContext,
  effectId: string,
  field: string,
  value: number,
): number {
  let result = value;
  for (const modifier of matchingModification(actor, effectId, action, target)) {
    const p = modifier.params ?? {};
    const mod = p.mode;
    let delta = 0;
    if (field.endsWith('attack_ratio') || field === 'params.attack_ratio') {
      delta = n(p.damage_ratio_add ?? p.value, 0);
    } else {
      delta = n(p.value, 0);
    }
    if (mod === 'add' || mod === 'add_ratio') result += delta * modifier.stacks;
    else if (mod === 'replace_segments') result = n(p[field.split('.').at(-1) ?? 'value'], result);
    else if (mod === 'add_each') result += delta * modifier.stacks;
    mark(runtime, modifier, modifier.stacks);
  }
  return result;
}

function directSpec(runtime: BattleRuntime, action: ActionContext, base: ActiveEffect): {
  ratio: number;
  bonusNoCrit: number;
  segments: number;
  canCrit: boolean;
  effectId: string;
} {
  const actor = action.actor;
  const target = action.target;
  const p = base.params ?? {};
  const effectId = base.id;
  let ratio: number;
  let formulaRatio = 0;
  let directPercentAdd = 0;
  let formulaPercentAdd = 0;
  if (p.attack_ratio_by_phase) ratio = n(p.attack_ratio_by_phase[actor.phase], 0);
  else ratio = n(p.attack_ratio, 0);
  let bonusNoCrit = 0;
  let segments = int(p.segments, 1);
  let canCrit = p.can_crit !== false;
  const modifications = matchingModification(actor, effectId, action, target);
  for (const modifier of modifications) {
    const mp = modifier.params ?? {};
    const mode = mp.mode;
    let used = false;
    if (mode === 'replace_segments') {
      segments = int(mp.segments, segments);
      ratio = n(mp.attack_ratio_per_segment, ratio);
      used = true;
    } else if (mode === 'add' && (
      mp.field === 'params.attack_ratio' ||
      mp.field === `params.attack_ratio_by_phase.${actor.phase}`
    )) {
      const delta = n(mp.value, 0);
      ratio += delta * modifier.stacks;
      used = delta !== 0;
    } else if (mode === 'add_each' && mp.field === 'params.attack_ratio_by_phase') {
      const delta = n(mp.value, 0) * modifier.stacks;
      ratio += delta;
      used = delta !== 0;
    } else if (mode === 'add_ratio' || mp.damage_ratio_add !== undefined) {
      const delta = n(mp.damage_ratio_add ?? mp.value, 0) * modifier.stacks;
      directPercentAdd += delta;
      if (mp.includes_j3_a_formula === true || mp.damage_scope === 'base_direct_segment') {
        formulaPercentAdd += delta;
      }
      used = delta !== 0;
    } else if (mode === 'add_formula') {
      if (mp.sword_intent_ratio_per_stack !== undefined) {
        const delta = action.swordIntentAtStart * n(mp.sword_intent_ratio_per_stack, 0) * modifier.stacks;
        bonusNoCrit += delta;
        used ||= delta !== 0;
      }
      if (mp.sword_intent_ratio_per_stack_add !== undefined) {
        const delta = action.swordIntentAtStart * n(mp.sword_intent_ratio_per_stack_add, 0) * modifier.stacks;
        bonusNoCrit += delta;
        used ||= delta !== 0;
      }
      if (mp.attack_ratio_per_paid_rage !== undefined) {
        const delta = action.lockedCost * n(mp.attack_ratio_per_paid_rage, 0) * modifier.stacks;
        formulaRatio += delta;
        used ||= delta !== 0;
      }
    } else if (mode === 'incoming_multiplier') {
      // Incoming multipliers are applied by dealDamage, never to the outgoing ratio.
      continue;
    } else {
      const field = String(mp.field ?? '');
      if (field.endsWith('attack_ratio')) {
        const delta = n(mp.value, 0) * modifier.stacks;
        ratio += delta;
        used = delta !== 0;
      }
    }
    if (used) mark(runtime, modifier, modifier.stacks);
  }
  for (const artifact of actor.artifacts) {
    const id = artifact.entity.id;
    const stacks = artifact.stacks;
    if (action.type === 'basic_action' && id === 'RC09') directPercentAdd += 0.06 * stacks;
    if (action.type === 'rage_action' && id === 'RC10') directPercentAdd += 0.06 * stacks;
    if ((action.type === 'basic_action' && id === 'RC09') || (action.type === 'rage_action' && id === 'RC10')) {
      const effect = artifact.entity.effects?.[0];
      if (effect) mark(runtime, Object.assign(clone(effect), { ownerId: id, ownerName: artifact.entity.name, ownerKind: 'artifact', ownerSide: actor.side, stacks }), stacks);
    }
  }
  if (action.type === 'basic_action' && action.actor.forcedBasic) {
    directPercentAdd += action.actor.forcedBasic.ratioAdd;
  }
  ratio = ratio * (1 + directPercentAdd) + formulaRatio * (1 + formulaPercentAdd);
  bonusNoCrit *= 1 + directPercentAdd;
  if (action.type === 'rage_action' && action.consumedShieldDamage > 0) ratio += action.consumedShieldDamage / Math.max(action.actionStats.attack, 1);
  if (action.type === 'rage_action' && action.actor.method.id === 'RKF05' && action.consumedSwordIntent > 0) {
    // This is a separate derived outlet and is resolved after the base hit.
  }
  return { ratio, bonusNoCrit, segments, canCrit, effectId };
}

function chanceValue(runtime: BattleRuntime, action: ActionContext, effect: ActiveEffect, target: Fighter): number {
  let chance = clamp(n(effect.params?.chance, 0), 0, 1);
  for (const modifier of matchingChanceModification(action.actor, effect.id, action, target)) {
    const p = modifier.params ?? {};
    if (p.mode === 'add') chance += n(p.value, 0) * modifier.stacks;
    chance = clamp(chance, 0, n(p.cap, 1));
    mark(runtime, modifier, modifier.stacks);
  }
  if (effect.params?.charge_luck_status === 'charge_luck' && hasStatus(action.actor, 'charge_luck') && !action.reservedChargeLuck) {
    chance += n(effect.params.charge_luck_bonus, 0);
  }
  return clamp(chance, 0, 1);
}

function incomingMultiplier(runtime: BattleRuntime, target: Fighter, source: Fighter, kind: string): number {
  let multiplier = 1;
  if (kind === 'direct' || kind === 'derived') {
    for (const effect of activeModifiers(target, 'modify_effect')) {
      const p = effect.params ?? {};
      if (p.mode !== 'incoming_multiplier' || p.source !== 'enemy_direct') continue;
      if (kind !== 'direct') continue;
      if (p.excludes?.includes(kind)) continue;
      const sourceIsEnemy = source.side !== target.side;
      if (!sourceIsEnemy) continue;
      const action = runtime.currentAction;
      if (!conditionOK(effect, target, source, action)) continue;
      multiplier *= n(p.multiplier, 1);
      mark(runtime, effect, effect.stacks);
    }
  }
  const healingReductionUntil = n(target.battleLayers['RKF03-J3-B-REDUCE'], 0);
  if (kind === 'direct' && runtime.round <= healingReductionUntil) {
    const effect = selectedEffect(target, 'RKF03-J3-B-REDUCE');
    if (effect && source.side !== target.side) {
      multiplier *= n(effect.params?.multiplier, 1);
      mark(runtime, effect);
    }
  }
  return multiplier;
}

function targetDefense(runtime: BattleRuntime, target: Fighter, source: Fighter, action: ActionContext | null): number {
  const stats = dynamicStats(runtime, target, source, action);
  return Math.max(0, stats.defense);
}

function attackStats(runtime: BattleRuntime, source: Fighter, target: Fighter, action: ActionContext | null): Stats {
  return action?.actor === source ? action.actionStats : dynamicStats(runtime, source, target, action);
}

function registerIncomingDirectRage(runtime: BattleRuntime, target: Fighter): void {
  registerRage(runtime, target, 5, 'RULES-INCOMING-DIRECT', target.method.id);
  for (const artifact of target.artifacts) {
    if (artifact.entity.id !== 'RC24') continue;
    registerRage(runtime, target, 2 * artifact.stacks, 'RC24-INCOMING-SEGMENT-RAGE', artifact.entity.id);
  }
}

function dealDamage(
  runtime: BattleRuntime,
  source: Fighter,
  target: Fighter,
  ratio: number,
  options: {
    sourceEffect: ActiveEffect | string;
    kind: 'direct' | 'derived' | 'dot' | 'reflect';
    canCrit: boolean;
    rawOverride?: number;
    base?: boolean;
    followup?: boolean;
    round?: number;
    criticalBonusRatio?: number;
  },
): HitResult {
  if (!runtime.active || source.hp <= 0 || target.hp <= 0) {
    return {
      raw: 0,
      amount: 0,
      absorbed: 0,
      hpDamage: 0,
      critical: false,
      effective: false,
      shieldBroken: false,
    };
  }
  const action = runtime.currentAction;
  const sourceEffect = typeof options.sourceEffect === 'string'
    ? options.sourceEffect
    : options.sourceEffect;
  const stats = attackStats(runtime, source, target, action);
  let raw = options.rawOverride ?? stats.attack * ratio;
  let critical = false;
  if (options.canCrit && options.kind !== 'dot' && options.kind !== 'reflect') {
    const chance = clamp(stats.crit_rate, 0, 1);
    critical = runtime.random() < chance;
    if (critical) raw *= n(rules(runtime.content).combat?.crit_multiplier, 1.5);
  }
  if (options.criticalBonusRatio) raw += stats.attack * options.criticalBonusRatio;
  const multiplier = options.kind === 'dot' ? 1 : incomingMultiplier(runtime, target, source, options.kind);
  let amount = raw * multiplier;
  if (options.kind !== 'dot' && options.kind !== 'reflect') {
    amount = amount * n(rules(runtime.content).combat?.direct_defense_constant, 100) /
      (n(rules(runtime.content).combat?.direct_defense_constant, 100) + targetDefense(runtime, target, source, action));
  }
  amount = Math.max(0, amount);
  const beforeShield = target.shield;
  const absorbed = Math.min(beforeShield, amount);
  target.shield = Math.max(0, beforeShield - absorbed);
  const hpDamage = Math.min(target.hp, amount - absorbed);
  target.hp = Math.max(0, target.hp - hpDamage);
  const effective = absorbed > 0 || hpDamage > 0;
  const shieldBroken = beforeShield > 0 && target.shield <= 0 && absorbed > 0;
  if (typeof sourceEffect !== 'string') {
    mark(runtime, sourceEffect, 1, source.side);
    addContribution(runtime, sourceEffect, 'damage', hpDamage + absorbed, source.side);
  } else {
    addContribution(runtime, sourceEffect, 'damage', hpDamage + absorbed, source.side);
  }
  if (options.kind === 'dot' && sourceEffect) {
    // DOT damage is attributed to its authored source, while the defender's
    // method still records absorbed damage through the common shield outlet.
  }
  if (target === runtime.player || target === runtime.enemy) {
    addContribution(runtime, target.method.id, 'absorbed', absorbed, target.side);
  }
  const sideText = source.side === 'player' ? '玩家' : '敌人';
  const kindText = options.kind === 'dot' ? '持续伤害' : options.kind === 'reflect' ? '盾返' : critical ? '暴击' : '伤害';
  frame(runtime, options.kind === 'dot' ? 'dot' : 'damage', `${sideText}造成${kindText} ${Math.round(hpDamage + absorbed)}`, source.side, target.side, typeof sourceEffect === 'string' ? sourceEffect : sourceEffect.id, hpDamage + absorbed);
  if (action && source === action.actor && target === action.target &&
      (options.kind === 'direct' || options.kind === 'derived') && effective) {
      action.enemyActualHpDamage += hpDamage;
      action.actualHpDamage += hpDamage;
      action.actualAbsorbed += absorbed;
      if (options.kind === 'direct') registerIncomingDirectRage(runtime, target);
  }
  if (action && options.base && options.kind === 'direct' && effective) {
    action.hadEffectiveBaseHit = true;
    action.baseDirectHitCount += 1;
    if (critical) {
      action.hadBaseCriticalHit = true;
      action.directCritCount += 1;
    }
  }
  if (action && options.followup && effective) action.actualBonusSegments += 1;
  if (critical && action && options.kind === 'direct' && effective) {
    triggerDirectCrit(runtime, source, target, action, options.base === true || options.followup === true);
  }
  if (shieldBroken && target.hp > 0) {
    if (options.kind === 'direct') triggerShieldBreak(runtime, target, source, action);
  }
  if (absorbed > 0 && target.hp > 0 && action && source.side !== target.side && options.kind === 'direct') {
    triggerShieldAbsorbed(runtime, target, source, action, absorbed);
  }
  if (target.hp <= 0) runtime.active = false;
  return { raw, amount, absorbed, hpDamage, critical, effective, shieldBroken };
}

function registerRage(runtime: BattleRuntime, fighter: Fighter, amount: number, sourceId: string, sourceOwner: string): void {
  if (amount <= 0 || fighter.hp <= 0) return;
  fighter.pendingGains.push({ amount, sourceId, sourceOwner });
  addContribution(runtime, sourceOwner, 'rage', amount, fighter.side);
  const source = selectedEffect(fighter, sourceId) ?? selectedEffect(fighter, sourceOwner);
  if (source) mark(runtime, source, 1, fighter.side);
}

function requestDrain(runtime: BattleRuntime, target: Fighter, amount: number, sourceId: string, sourceOwner: string, opening = false): void {
  if (amount <= 0) return;
  const map = opening ? runtime.openingDrainRequested : runtime.roundDrainRequested;
  map.set(target.side, (map.get(target.side) ?? 0) + amount);
  target.pendingDrains.push({ amount, sourceId, sourceOwner, opening });
  const sourceFighter = other(runtime, target);
  addContribution(runtime, sourceOwner, 'rage', -amount, sourceFighter.side);
  const source = selectedEffect(target, sourceId) ??
    selectedEffect(target, sourceOwner) ??
    selectedEffect(sourceFighter, sourceId) ??
    selectedEffect(sourceFighter, sourceOwner);
  if (source) mark(runtime, source, 1, sourceFighter.side);
}

function addShield(
  runtime: BattleRuntime,
  fighter: Fighter,
  amount: number,
  source: ActiveEffect | string,
  text: string,
  additionalBonus = 0,
): number {
  if (amount <= 0 || fighter.hp <= 0) return 0;
  let input = amount;
  let shieldBonus = additionalBonus;
  for (const artifact of fighter.artifacts) {
    if (artifact.entity.id !== 'RC11') continue;
    shieldBonus += 0.06 * artifact.stacks;
    const effect = artifact.entity.effects?.[0];
    if (effect) {
      mark(runtime, Object.assign(clone(effect), {
        ownerId: artifact.entity.id,
        ownerName: artifact.entity.name,
        ownerKind: 'artifact' as SourceKind,
        ownerSide: fighter.side,
        stacks: artifact.stacks,
      }), artifact.stacks);
    }
  }
  input *= 1 + shieldBonus;
  const gained = Math.max(0, Math.min(input, fighter.stats.max_hp - fighter.shield));
  fighter.shield += gained;
  if (typeof source !== 'string') {
    mark(runtime, source, 1, fighter.side);
    addContribution(runtime, source, 'shield', gained, fighter.side);
  } else addContribution(runtime, source, 'shield', gained, fighter.side);
  frame(runtime, 'shield', `${fighter.side === 'player' ? '玩家' : '敌人'}${text} ${Math.round(gained)}`, fighter.side, fighter.side, typeof source === 'string' ? source : source.id, gained);
  return gained;
}

function removeStatusLayers(fighter: Fighter, status: StatusName, count: number): number {
  const layers = getStatusLayers(fighter, status);
  const consumed = Math.min(count, layers.length);
  layers.splice(0, consumed);
  return consumed;
}

function actionFlag(action: ActionContext, id: string): string {
  return `${id}:${action.round}:${action.actor.actionNumber}`;
}

function addRegularStatus(
  runtime: BattleRuntime,
  target: Fighter,
  status: StatusName,
  count: number,
  duration: number,
  source: ActiveEffect | string,
  dot?: { damage: number; attackRatio: number; ownerId: string },
  maxStacks?: number,
): number {
  const cap = maxStacks ?? n(rules(runtime.content).statuses?.[status]?.max_stacks, status === 'sword_intent' ? 5 : 1);
  const layers = getStatusLayers(target, status);
  const added = Math.min(Math.max(0, count), Math.max(0, cap - layers.length));
  for (let i = 0; i < added; i++) {
    layers.push({
      remaining: Math.max(1, duration),
      ...(dot ? { damage: dot.damage, attackRatio: dot.attackRatio, ownerId: dot.ownerId, kind: 'dot' as const } : { kind: 'regular' as const }),
      sourceId: typeof source === 'string' ? source : source.id,
    });
  }
  if (added > 0) {
    if (typeof source !== 'string') mark(runtime, source);
    frame(runtime, 'status', `${target.side === 'player' ? '玩家' : '敌人'}获得${status}${added}层`, sourceTargetSide(runtime, source), target.side, typeof source === 'string' ? source : source.id, added);
  }
  return added;
}

function sourceTargetSide(runtime: BattleRuntime, source: ActiveEffect | string): 'player' | 'enemy' | undefined {
  if (typeof source !== 'string' && source.ownerSide) return source.ownerSide;
  if (typeof source !== 'string') return source.ownerId === runtime.player.method.id || runtime.player.talents.some(x => x.id === source.ownerId) || runtime.player.artifacts.some(x => x.entity.id === source.ownerId) ? 'player' : 'enemy';
  return undefined;
}

function triggerShieldBreak(runtime: BattleRuntime, target: Fighter, source: Fighter, action: ActionContext | null): void {
  if (!action || target.hp <= 0) return;
  const effect = selectedEffect(target, 'RKF01-J3-B-RECHARGE');
  if (target.method.id !== 'RKF01' || !effect || target.battleFlags.has(effect.id)) return;
  if (action.type !== 'basic_action' && action.type !== 'rage_action') return;
  target.battleFlags.add(effect.id);
  addShield(runtime, target, target.stats.max_hp * n(effect.params?.max_hp_ratio, 0.24), effect, '破盾后续护');
  frame(runtime, 'status', `${target.side === 'player' ? '玩家' : '敌人'}首次破盾后续护`, target.side, target.side, effect.id);
}

function triggerShieldAbsorbed(runtime: BattleRuntime, target: Fighter, source: Fighter, action: ActionContext, absorbed: number): void {
  if (target.method.id !== 'RKF01' || action.recoilDone) return;
  action.recoilDone = true;
  const recoil = methodEffect(target.method, 'RKF01-PASSIVE-RECOIL');
  if (!recoil) throw new Error('RKF01 passive recoil missing');
  const effect = Object.assign(clone(recoil), { ownerId: target.method.id, ownerName: target.method.name, ownerKind: 'method' as SourceKind, ownerSide: target.side, stacks: 1 });
  let raw = targetDefense(runtime, target, source, action) * n(recoil.params?.defense_ratio, 0.38);
  const replace = selectedEffect(target, 'RKF01-J4-C-RECOIL-FORMULA');
  if (replace) {
    raw += attackStats(runtime, target, source, action).attack * n(replace.params?.attack_ratio, 0.22);
    mark(runtime, replace);
  }
  let recoilBonus = 0;
  const bonus = selectedEffect(target, 'RKF01-J3-A-RECOIL');
  if (bonus) {
    recoilBonus += n(bonus.params?.damage_ratio_add, 0.28);
    mark(runtime, bonus);
  }
  for (const artifact of target.artifacts) {
    if (artifact.entity.id !== 'RC13') continue;
    recoilBonus += 0.06 * artifact.stacks;
    const effect = artifact.entity.effects?.[0];
    if (effect) mark(runtime, Object.assign(clone(effect), { ownerId: artifact.entity.id, ownerName: artifact.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: target.side, stacks: artifact.stacks }), artifact.stacks);
  }
  raw *= 1 + recoilBonus;
  const hit = dealDamage(runtime, target, source, 0, {
    sourceEffect: effect,
    kind: 'reflect',
    canCrit: false,
    rawOverride: raw,
  });
  if (hit.hpDamage > 0 || hit.absorbed > 0) {
    action.reflectDamage += hit.hpDamage + hit.absorbed;
  }
  const armor = selectedEffect(target, 'RKF01-J4-C-ARMOR-BREAK');
  if (armor && hit.effective && source.hp > 0) {
    const added = addRegularStatus(runtime, source, 'armor_break', int(armor.params?.stacks, 1), int(armor.params?.duration_rounds, 2), armor, undefined, int(armor.params?.max_stacks, 5));
    if (added > 0) mark(runtime, armor);
  }
}

function triggerDirectCrit(runtime: BattleRuntime, source: Fighter, target: Fighter, action: ActionContext, baseOrFollowup: boolean): void {
  for (const artifact of source.artifacts) {
    if (artifact.entity.id !== 'RR10' || action.rr10CritCount >= 2) continue;
    action.rr10CritCount += 1;
    registerRage(runtime, source, 5 * artifact.stacks, 'RR10-DIRECT-CRIT-RAGE', artifact.entity.id);
  }
  const follow = selectedEffect(source, 'RKF05-J3-C-CRIT-FOLLOWUP');
  if (follow && !source.battleFlags.has(`crit-followup-${action.round}-${source.actionNumber}`)) {
    source.battleFlags.add(`crit-followup-${action.round}-${source.actionNumber}`);
    const stats = attackStats(runtime, source, target, action);
    dealDamage(runtime, source, target, n(follow.params?.attack_ratio, 0.45), {
      sourceEffect: follow,
      kind: 'derived',
      canCrit: false,
      base: false,
      followup: true,
    });
    if (target.hp <= 0) action.stop = true;
    void stats;
  }
}

function applyDot(
  runtime: BattleRuntime,
  owner: Fighter,
  target: Fighter,
  effect: ActiveEffect,
  status: 'poison' | 'burn',
  stacks: number,
  duration: number,
  attackRatio: number,
  maxStacks: number,
  snapshotAttack: number,
): number {
  let ratio = attackRatio;
  if (status === 'burn' && owner.method.id === 'RKF04' && selectedEffect(owner, 'RKF04-J4-B-BURN-DURATION')) {
    duration += n(selectedEffect(owner, 'RKF04-J4-B-BURN-DURATION')?.params?.duration_rounds_add, 2);
  }
  for (const modifier of activeModifiers(owner, 'modify_effect')) {
    const p = modifier.params ?? {};
    if (p.status !== status && !(p.effect_ids ?? []).some((id: string) => id === effect.id)) continue;
    if (p.field === 'params.attack_ratio_per_stack' || p.attack_ratio_per_stack_add !== undefined) {
      ratio += n(p.value ?? p.attack_ratio_per_stack_add, 0) * modifier.stacks;
      mark(runtime, modifier, modifier.stacks);
    }
  }
  for (const artifact of owner.artifacts) {
    if ((status === 'poison' && artifact.entity.id === 'RC14') || (status === 'burn' && artifact.entity.id === 'RC15')) {
      ratio *= 1 + 0.06 * artifact.stacks;
      const ae = artifact.entity.effects?.[0];
      if (ae) mark(runtime, Object.assign(clone(ae), { ownerId: artifact.entity.id, ownerName: artifact.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: owner.side, stacks: artifact.stacks }), artifact.stacks);
    }
  }
  const damage = snapshotAttack * ratio;
  return addRegularStatus(runtime, target, status, stacks, duration, effect, { damage, attackRatio: ratio, ownerId: owner.method.id }, maxStacks);
}

function effectValueForStatus(
  runtime: BattleRuntime,
  actor: Fighter,
  target: Fighter,
  action: ActionContext,
  effect: ActiveEffect,
  field: string,
  fallback: number,
): number {
  let value = n(numericField(effect.params ?? {}, field, fallback), fallback);
  for (const modifier of matchingModification(actor, effect.id, action, target)) {
    const p = modifier.params ?? {};
    let applied = false;
    if (p.mode === 'add' && (p.field === field || p.field === `params.${field}`)) {
      value += n(p.value, 0) * modifier.stacks;
      applied = true;
    }
    if (p.mode === 'add_input') {
      if (field === 'stacks' && p.stacks_add !== undefined) {
        value += n(p.stacks_add, 0) * modifier.stacks;
        applied = true;
      }
      if (field === 'duration_rounds' && p.duration_rounds_add !== undefined) {
        value += n(p.duration_rounds_add, 0) * modifier.stacks;
        applied = true;
      }
      if (field === 'max_stacks' && p.max_stacks_add !== undefined) {
        value += n(p.max_stacks_add, 0) * modifier.stacks;
        applied = true;
      }
    }
    if (applied) mark(runtime, modifier, modifier.stacks);
  }
  return value;
}

function applyActionHitStatus(
  runtime: BattleRuntime,
  action: ActionContext,
  baseEffect: ActiveEffect,
  hit: HitResult,
): void {
  if (!hit.effective || action.stop || !runtime.active) return;
  const actor = action.actor;
  const target = action.target;
  const id = baseEffect.id;
  if (id === 'RKF06-BASIC-DAMAGE') {
    const poison = actionEffect(actor, 'basic_action', 'RKF06-BASIC-POISON');
    const stacks = effectValueForStatus(runtime, actor, target, action, poison, 'stacks', 1);
    const duration = effectValueForStatus(runtime, actor, target, action, poison, 'duration_rounds', 3);
    const ratio = n(poison.params?.attack_ratio_per_stack, 0.08);
    const added = applyDot(runtime, actor, target, poison, 'poison', stacks, duration, ratio, int(poison.params?.max_stacks, 10), action.actionStats.attack);
    action.actualDebuffApplied ||= added > 0;
  }
  if (id === 'RKF08-BASIC-DAMAGE') {
    const weak = actionEffect(actor, 'basic_action', 'RKF08-BASIC-WEAKNESS');
    const stacks = effectValueForStatus(runtime, actor, target, action, weak, 'stacks', 1);
    const added = addRegularStatus(runtime, target, 'weakness', stacks, int(weak.params?.duration_rounds, 2), weak, undefined, int(weak.params?.max_stacks, 5));
    action.actualDebuffApplied ||= added > 0;
  }
  if (id === 'RKF09-BASIC-DAMAGE') {
    const burn = actionEffect(actor, 'basic_action', 'RKF09-BASIC-BURN');
    const stacks = effectValueForStatus(runtime, actor, target, action, burn, 'stacks', 1);
    const added = applyDot(runtime, actor, target, burn, 'burn', stacks, int(burn.params?.duration_rounds, 3), n(burn.params?.attack_ratio_per_stack, 0.08), int(burn.params?.max_stacks, 10), action.actionStats.attack);
    action.actualDebuffApplied ||= added > 0;
  }
  if (id === 'RKF07-BASIC-DAMAGE') resolveChain(runtime, action, actionEffect(actor, 'basic_action', 'RKF07-BASIC-CHAIN'), hit);
  if (id === 'RKF08-BASIC-DAMAGE') resolveDirectHitAdditions(runtime, action, hit, baseEffect);
  else resolveDirectHitAdditions(runtime, action, hit, baseEffect);
}

function resolveDirectHitAdditions(runtime: BattleRuntime, action: ActionContext, hit: HitResult, baseEffect: ActiveEffect): void {
  if (!hit.effective || action.stop || !runtime.active) return;
  const actor = action.actor;
  const target = action.target;
  const actionType = action.type;
  const firstBase = action.baseDirectHitCount === 1;
  if (actionType === 'basic_action' && firstBase) {
    for (const artifact of actor.artifacts) {
      if (artifact.entity.id === 'RL03') {
        const effect = Object.assign(clone(artifact.entity.effects?.[0]), { ownerId: artifact.entity.id, ownerName: artifact.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: actor.side, stacks: artifact.stacks });
        for (let i = 0; i < int(effect.params?.segments, 2); i++) {
          const follow = dealDamage(runtime, actor, target, n(effect.params?.attack_ratio, 0.5), {
            sourceEffect: effect,
            kind: 'direct',
            canCrit: false,
            followup: true,
          });
          if (!follow.effective) continue;
          if (target.hp <= 0) {
            action.stop = true;
            return;
          }
        }
      }
      if (artifact.entity.id === 'RR04') {
        const effect = Object.assign(clone(artifact.entity.effects?.[0]), { ownerId: artifact.entity.id, ownerName: artifact.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: actor.side, stacks: artifact.stacks });
        const chance = clamp(n(effect.params?.chance, 0.25), 0, 1);
        if (runtime.random() < chance) {
          const follow = dealDamage(runtime, actor, target, n(effect.params?.attack_ratio, 0.5), {
            sourceEffect: effect,
            kind: 'direct',
            canCrit: false,
            followup: true,
          });
          if (follow.effective && (target.hp <= 0 || !runtime.active)) {
            action.stop = true;
            return;
          }
        }
      }
      if (artifact.entity.id === 'RR03') {
        const effect = Object.assign(clone(artifact.entity.effects?.[0]), { ownerId: artifact.entity.id, ownerName: artifact.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: actor.side, stacks: artifact.stacks });
        const added = applyDot(runtime, actor, target, effect, 'poison', int(effect.params?.stacks, 1), int(effect.params?.duration_rounds, 3), 0.08, 10, action.actionStats.attack);
        action.actualDebuffApplied ||= added > 0;
      }
      if (artifact.entity.id === 'RR13') requestDrain(runtime, target, 10 * artifact.stacks, artifact.entity.id === 'RR13' ? 'RR13-FIRST-BASIC-RAGE-DRAIN' : artifact.entity.id, artifact.entity.id);
    }
  }
  const basicOrRage = actionType === 'basic_action' || actionType === 'rage_action';
  if (basicOrRage) {
    const hitRage = selectedEffect(actor, 'RKF02-J2-A-HIT-RAGE');
    if (hitRage && firstBase) registerRage(runtime, actor, n(hitRage.params?.amount, 10), hitRage.id, hitRage.ownerId);
    const rr01 = actor.artifacts.find(artifact => artifact.entity.id === 'RR01');
    if (rr01 && firstBase) registerRage(runtime, actor, 10 * rr01.stacks, 'RR01-BASE-HIT-RAGE-GAIN', rr01.entity.id);
  }
  const j4b = selectedEffect(actor, 'RKF08-J4-B-RAGE');
  if (j4b && hasStatus(target, 'armor_break') && firstBase) registerRage(runtime, actor, n(j4b.params?.amount, 10), j4b.id, j4b.ownerId);
  if (actor.method.id === 'RKF06' && firstBase && hasStatus(target, 'poison')) {
    for (const id of ['RKF06-J2-B-WEAKNESS', 'RKF06-J3-B-WEAKNESS', 'RKF06-J4-B-ARMOR']) {
      const effect = selectedEffect(actor, id);
      if (!effect) continue;
      const status: StatusName = id.endsWith('ARMOR') ? 'armor_break' : 'weakness';
      const added = addRegularStatus(
        runtime,
        target,
        status,
        int(effect.params?.stacks, 1),
        int(effect.params?.duration_rounds, 2),
        effect,
        undefined,
        int(effect.params?.max_stacks, 5),
      );
      action.actualDebuffApplied ||= added > 0;
    }
  }
  if (actor.method.id === 'RKF08' && firstBase && action.type === 'basic_action') {
    const drain = selectedEffect(actor, 'RKF08-J2-A-DRAIN');
    if (drain) requestDrain(runtime, target, n(drain.params?.amount, 10) * drain.stacks, drain.id, drain.ownerId);
  }
  resolveNegativeFollowup(runtime, action);
  if (action.stop || !runtime.active || target.hp <= 0) return;
  const consumePoison = selectedEffect(actor, 'RKF06-J3-C-CONSUME');
  const preexistingPoison = action.actionStartStatuses.get('poison') ?? 0;
  if (consumePoison && firstBase && preexistingPoison > 0) {
    const consumed = removeStatusLayers(target, 'poison', Math.min(preexistingPoison, int(consumePoison.params?.max_stacks, 2)));
    if (consumed > 0) {
      const heal = selectedEffect(actor, 'RKF06-J3-C-HEAL');
      if (heal) resolveHeal(runtime, action, actor.stats.max_hp * n(heal.params?.amount_per_stack, 0.05) * consumed, heal, false);
    }
  }
}

function resolveNegativeFollowup(runtime: BattleRuntime, action: ActionContext): void {
  if (!runtime.active || action.stop || action.actor.hp <= 0 || action.target.hp <= 0) return;
  const actor = action.actor;
  const target = action.target;
  const effect = selectedEffect(actor, 'RKF08-J3-B-DAMAGE');
  const flag = `negative-followup-${action.round}-${actor.actionNumber}`;
  if (!effect || !action.actualDebuffApplied || actor.battleFlags.has(flag)) return;
  actor.battleFlags.add(flag);
  const hit = dealDamage(runtime, actor, target, n(effect.params?.attack_ratio, 0.28), {
    sourceEffect: effect,
    kind: 'derived',
    canCrit: false,
    followup: true,
  });
  if (hit.effective && (target.hp <= 0 || !runtime.active)) action.stop = true;
}

function resolveChain(runtime: BattleRuntime, action: ActionContext, effect: ActiveEffect, baseHit: HitResult): void {
  if (!baseHit.effective || action.stop || !runtime.active) return;
  const actor = action.actor;
  const target = action.target;
  const p = effect.params ?? {};
  if (action.reservedChargeLuck && p.exclude_reserved_for_shield) {
    const chance = chanceValue(runtime, action, effect, target);
    if (runtime.random() >= chance) return;
  } else {
    const had = hasStatus(actor, 'charge_luck');
    const chance = chanceValue(runtime, action, effect, target);
    if (had && !action.reservedChargeLuck) removeStatusLayers(actor, 'charge_luck', 1);
    if (runtime.random() >= chance) {
      if (!action.reservedChargeLuck) addRegularStatus(runtime, actor, 'charge_luck', 1, int(p.on_fail?.duration_rounds, 2), effect, undefined, 1);
      return;
    }
  }
  dealDamage(runtime, actor, target, n(p.attack_ratio, 0.48), {
    sourceEffect: effect,
    kind: 'direct',
    canCrit: p.can_crit !== false,
    followup: true,
  });
  if (target.hp <= 0) action.stop = true;
}

function resolveHeal(runtime: BattleRuntime, action: ActionContext, amount: number, source: ActiveEffect, allowOverflow = true): { effective: number; overflow: number } {
  const fighter = action.actor;
  if (fighter.hp <= 0) return { effective: 0, overflow: 0 };
  let total = Math.max(0, amount);
  for (const artifact of fighter.artifacts) {
    if (artifact.entity.id === 'RC12') {
      total *= 1 + 0.06 * artifact.stacks;
      const ae = artifact.entity.effects?.[0];
      if (ae) mark(runtime, Object.assign(clone(ae), { ownerId: artifact.entity.id, ownerName: artifact.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: fighter.side, stacks: artifact.stacks }), artifact.stacks);
    }
  }
  const effective = Math.min(total, Math.max(0, fighter.stats.max_hp - fighter.hp));
  const overflow = Math.max(0, total - effective);
  fighter.hp += effective;
  (action as AnyMap).lastEffectiveHeal = effective;
  mark(runtime, source, 1, fighter.side);
  addContribution(runtime, source, 'healing', effective, fighter.side);
  if (effective > 0) {
    frame(runtime, 'heal', `${fighter.side === 'player' ? '玩家' : '敌人'}恢复 ${Math.round(effective)}`, fighter.side, fighter.side, source.id, effective);
    const rr02 = fighter.artifacts.find(artifact => artifact.entity.id === 'RR02');
    if (rr02 && action.isMainAction && !fighter.battleFlags.has(`rr02-${action.round}-${fighter.actionNumber}`)) {
      fighter.battleFlags.add(`rr02-${action.round}-${fighter.actionNumber}`);
      const ae = rr02.entity.effects?.[0];
      if (ae) addShield(runtime, fighter, effective * n(ae.params?.ratio, 0.35) * rr02.stacks, Object.assign(clone(ae), { ownerId: rr02.entity.id, ownerName: rr02.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: fighter.side, stacks: rr02.stacks }), '有效治疗转盾');
    }
    const rr12 = fighter.artifacts.find(artifact => artifact.entity.id === 'RR12');
    if (rr12 && action.isMainAction && !fighter.battleFlags.has(actionFlag(action, 'RR12-SELF-HEAL-RAGE'))) {
      fighter.battleFlags.add(actionFlag(action, 'RR12-SELF-HEAL-RAGE'));
      registerRage(runtime, fighter, 10 * rr12.stacks, 'RR12-SELF-HEAL-RAGE', rr12.entity.id);
    }
    const healRage = selectedEffect(fighter, 'RKF03-J2-C-RAGE');
    if (healRage && action.isMainAction && !fighter.battleFlags.has(actionFlag(action, healRage.id))) {
      fighter.battleFlags.add(actionFlag(action, healRage.id));
      registerRage(runtime, fighter, effective * n(healRage.params?.ratio, 0.25), healRage.id, healRage.ownerId);
    }
    const healShield = selectedEffect(fighter, 'RKF03-J3-C-SHIELD');
    if (healShield) addShield(runtime, fighter, effective * n(healShield.params?.effective_heal_ratio, 0.35), healShield, '有效治疗造盾');
    const reduce = selectedEffect(fighter, 'RKF03-J3-B-REDUCE');
    if (reduce) {
      fighter.battleLayers[reduce.id] = runtime.round + Math.max(0, int(reduce.params?.duration_rounds, 1));
      mark(runtime, reduce);
    }
  }
  (action as AnyMap).lastOverflow = overflow;
  if (allowOverflow && overflow > 0) {
    const rl01 = fighter.artifacts.find(artifact => artifact.entity.id === 'RL01');
    if (rl01) {
      const ae = rl01.entity.effects?.[0];
      if (ae) addShield(runtime, fighter, overflow * n(ae.params?.ratio, 1) * rl01.stacks, Object.assign(clone(ae), { ownerId: rl01.entity.id, ownerName: rl01.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: fighter.side, stacks: rl01.stacks }), '溢疗转盾');
    } else if (fighter.method.id === 'RKF03') {
      const j4 = selectedEffect(fighter, 'RKF03-J4-C-DAMAGE');
      const j2 = selectedEffect(fighter, 'RKF03-J2-A-POISON');
      const j1 = selectedEffect(fighter, 'RKF03-J1-A-OVERFLOW');
      if (j4) {
        dealDamage(runtime, fighter, other(runtime, fighter), 0, {
          sourceEffect: j4,
          kind: 'derived',
          canCrit: false,
          rawOverride: overflow * n(j4.params?.damage_ratio, 1.1),
        });
      } else if (j2) {
        const stacks = Math.floor(overflow * n(j2.params?.stacks_per_overflow, 0.012));
        const target = other(runtime, fighter);
        applyDot(runtime, fighter, target, j2, 'poison', stacks, int(j2.params?.duration_rounds, 3), 0.08, int(j2.params?.max_stacks, 10), action.actionStats.attack);
      } else {
        const ratio = n((methodEffect(fighter.method, 'RKF03-PASSIVE-OVERFLOW')?.params ?? {}).damage_ratio, 0.7) + n(j1?.params?.damage_ratio_add, 0);
        const passive = methodEffect(fighter.method, 'RKF03-PASSIVE-OVERFLOW');
        if (!passive) throw new Error('RKF03 overflow effect missing');
        const effect = Object.assign(clone(j1 ?? passive), { ownerId: j1?.ownerId ?? fighter.method.id, ownerName: j1?.ownerName ?? fighter.method.name, ownerKind: (j1?.ownerKind ?? 'method') as SourceKind, ownerSide: fighter.side, stacks: 1 });
        dealDamage(runtime, fighter, other(runtime, fighter), 0, {
          sourceEffect: effect,
          kind: 'derived',
          canCrit: false,
          rawOverride: overflow * ratio,
        });
      }
    }
  }
  return { effective, overflow };
}

function resolveStatusConsumption(runtime: BattleRuntime, action: ActionContext): void {
  const actor = action.actor;
  const target = action.target;
  if (action.type === 'rage_action' && actor.method.id === 'RKF04') {
    const consume = selectedEffect(actor, 'RKF04-J3-A-CONSUME-BURN');
    const preexistingBurn = action.actionStartStatuses.get('burn') ?? 0;
    if (consume && preexistingBurn > 0) {
      action.consumedBurn = removeStatusLayers(target, 'burn', Math.min(preexistingBurn, int(consume.params?.max_stacks, 3)));
      if (action.consumedBurn) {
        mark(runtime, consume);
        dealDamage(runtime, actor, target, 0, {
          sourceEffect: consume,
          kind: 'derived',
          canCrit: false,
          rawOverride: action.consumedBurn * attackStats(runtime, actor, target, action).attack *
            n(consume.params?.damage_per_stack_attack_ratio, 0.18),
        });
      }
    }
  }
  if (action.type === 'rage_action' && actor.method.id === 'RKF05') {
    const consume = selectedEffect(actor, 'RKF05-J2-B-CONSUME');
    if (consume && hasStatus(actor, 'sword_intent')) {
      action.consumedSwordIntent = removeStatusLayers(actor, 'sword_intent', int(consume.params?.max_stacks, 3));
      if (action.consumedSwordIntent) {
        mark(runtime, consume);
        dealDamage(runtime, actor, target, 0, {
          sourceEffect: consume,
          kind: 'derived',
          canCrit: false,
          rawOverride: action.consumedSwordIntent * attackStats(runtime, actor, target, action).attack * n(consume.params?.damage_per_stack_attack_ratio, 0.28),
        });
      }
    }
  }
  if (action.type === 'rage_action' && actor.method.id === 'RKF09') {
    const consume = selectedEffect(actor, 'RKF09-J4-B-CONSUME');
    const damage = selectedEffect(actor, 'RKF09-J4-B-DAMAGE');
    const preexistingBurn = action.actionStartStatuses.get('burn') ?? 0;
    if (consume && damage && preexistingBurn > 0) {
      action.consumedBurn = removeStatusLayers(target, 'burn', Math.min(preexistingBurn, int(consume.params?.max_stacks, 3)));
      if (action.consumedBurn) {
        mark(runtime, consume);
        dealDamage(runtime, actor, target, 0, {
          sourceEffect: damage,
          kind: 'derived',
          canCrit: false,
          rawOverride: action.consumedBurn * attackStats(runtime, actor, target, action).attack * n(damage.params?.attack_ratio_per_stack, 0.16),
        });
      }
    }
  }
}

function resolveActionEnd(runtime: BattleRuntime, action: ActionContext): void {
  const actor = action.actor;
  const target = action.target;
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0) return;
  const effects: ActiveEffect[] = [];
  const methodAction = actor.method.actions?.[action.type === 'basic_action' ? 'basic' : 'rage']?.effects ?? [];
  for (const effect of methodAction) {
    if (effect.trigger === 'action_end' || effect.trigger === action.type) effects.push(Object.assign(clone(effect), { ownerId: actor.method.id, ownerName: actor.method.name, ownerKind: 'method' as SourceKind, ownerSide: actor.side, stacks: 1 }));
  }
  effects.push(...activeModifiers(actor).filter(effect => effect.trigger === 'action_end' || effect.trigger === action.type));
  for (const effect of effects) {
    if (!conditionOK(effect, actor, target, action)) continue;
    const p = effect.params ?? {};
    if (effect.operation === 'rage_cap' && effect.id === 'RR07-FIRST-RAGE-CAP-REDUCTION') {
      if (action.type === 'rage_action' &&
          !actor.battleFlags.has(effect.id) &&
          !actor.battleFlags.has('RR07-PENDING')) {
        actor.battleFlags.add(effect.id);
        actor.battleFlags.add('RR07-PENDING');
        mark(runtime, effect);
      }
      continue;
    }
    if (effect.operation === 'modify_stat' && effect.id === 'RR05-ACTION-END-ATTACK-LAYER') {
      const current = n(actor.battleLayers[effect.id], 0);
      actor.battleLayers[effect.id] = Math.min(int(p.max_stacks, 3), current + effect.stacks);
      mark(runtime, effect);
      continue;
    }
    if (effect.operation === 'apply_status') {
      if (effect.id === 'RKF04-BASIC-BURN' || effect.id === 'RKF04-RAGE-BURN') {
        if (action.type === 'rage_action' && selectedEffect(actor, 'RKF04-J3-A-CONSUME-BURN')) continue;
        const stacks = effectValueForStatus(runtime, actor, target, action, effect, 'stacks', n(p.stacks, 1));
        const duration = effectValueForStatus(runtime, actor, target, action, effect, 'duration_rounds', n(p.duration_rounds, 3));
        const extra = selectedEffect(actor, 'RKF04-J3-C-BURN-STACK');
        const finalStacks = stacks + (extra ? n(extra.params?.stacks_add, 1) : 0);
        const max = int(p.max_stacks, 10) + (selectedEffect(actor, 'RKF04-J2-A-BURN-CAP') ? int(selectedEffect(actor, 'RKF04-J2-A-BURN-CAP')?.params?.max_stacks_add, 2) : 0);
        applyDot(runtime, actor, target, effect, 'burn', finalStacks, duration, n(p.attack_ratio_per_stack, 0.08), max, action.actionStats.attack);
        continue;
      }
      if (effect.id === 'RKF05-BASIC-INTENT') {
        const extra = selectedEffect(actor, 'RKF05-J1-B-INTENT');
        addRegularStatus(runtime, actor, 'sword_intent', 1 + (extra ? n(extra.params?.stacks_add, 1) : 0), 99, effect, undefined, selectedEffect(actor, 'RKF05-J2-A-RETENTION') ? 7 : 5);
        continue;
      }
      if (effect.id === 'RKF10-PASSIVE-INITIAL-PHASE') continue;
    }
    if (effect.operation === 'shield') {
      if (effect.id === 'RKF01-BASIC-SHIELD' || effect.id === 'RKF01-RAGE-SHIELD') {
        if (actor.method.id !== 'RKF01') continue;
        if (effect.id === 'RKF01-RAGE-SHIELD' && selectedEffect(actor, 'RKF01-J4-B-CONSUME-SHIELD')) continue;
        const hpRatio = selectedEffect(actor, effect.id === 'RKF01-BASIC-SHIELD' ? 'RKF01-J2-C-BASIC-HP-SHIELD' : 'RKF01-J2-C-RAGE-HP-SHIELD') ? 0.12 : 0;
        const amount = action.actionStats.defense * n(p.defense_ratio, 0) + actor.stats.max_hp * hpRatio;
        const bonus = selectedEffect(actor, 'RKF01-J1-A-SHIELD');
        const shieldBonus = bonus ? n(bonus.params?.shield_ratio_add, 0.18) : 0;
        if (bonus) mark(runtime, bonus);
        addShield(runtime, actor, amount, effect, '金刚造盾', shieldBonus);
        continue;
      }
      if (effect.id === 'RKF02-J3-C-SHIELD') {
        addShield(runtime, actor, action.actionStats.attack * n(p.attack_ratio, 0.26), effect, '怒技造盾');
        continue;
      }
      if (effect.id === 'RKF04-J1-C-SHIELD' && action.type === 'basic_action') {
        addShield(runtime, actor, action.actionStats.defense * n(p.defense_ratio, 0.2), effect, '普攻造盾');
        continue;
      }
      if (effect.id === 'RKF05-J3-B-SHIELD') {
        addShield(runtime, actor, action.actionStats.defense * n(p.defense_ratio, 0.16) + actor.stats.max_hp * action.swordIntentAtStart * n(p.max_hp_ratio_per_stack, 0.025), effect, '剑势护体');
        continue;
      }
      if (effect.id === 'RKF07-J3-B-SHIELD' || effect.id === 'RKF07-J4-C-CHAIN') {
        if (effect.id === 'RKF07-J3-B-SHIELD' && selectedEffect(actor, 'RKF07-J4-C-CHAIN')) continue;
        if (action.reservedChargeLuck && actor.hp > 0 && hasStatus(actor, 'charge_luck')) {
          removeStatusLayers(actor, 'charge_luck', 1);
          addShield(runtime, actor, action.actionStats.defense * n(p.defense_ratio, 0), effect, '蓄运成盾');
        }
        continue;
      }
      if ((effect.id === 'RKF08-J2-C-SHIELD' && action.type === 'rage_action') ||
          (effect.id === 'RKF08-J3-C-SHIELD' && (hasStatus(target, 'weakness') || hasStatus(target, 'armor_break'))) ||
          (effect.id === 'RKF06-J2-C-SHIELD' && hasStatus(target, 'poison')) ||
          (effect.id === 'RKF06-J4-C-SHIELD' && hasStatus(target, 'poison')) ||
          (effect.id === 'RKF09-J2-C-SHIELD' && hasStatus(target, 'burn')) ||
          (effect.id === 'RKF09-J4-C-SHIELD' && action.type === 'rage_action')) {
        let amount = action.actionStats.defense * n(p.defense_ratio, 0) + actor.stats.max_hp * n(p.max_hp_ratio, 0);
        addShield(runtime, actor, amount, effect, '天赋护盾');
        continue;
      }
      if (effect.id === 'RKF10-BASIC-SHIELD-DAY' || effect.id === 'RKF10-RAGE-SHIELD-DAY') {
        if (actor.phase === 'day') addShield(runtime, actor, action.actionStats.defense * n(p.defense_ratio, 0), effect, '白昼护盾');
        continue;
      }
    }
    if (effect.operation === 'heal') {
      if (effect.id === 'RKF03-BASIC-HEAL' || effect.id === 'RKF03-RAGE-HEAL') {
        let ratio = n(p.max_hp_ratio, 0);
        const extras = effect.id === 'RKF03-BASIC-HEAL'
          ? [selectedEffect(actor, 'RKF03-J1-B-BASIC-HEAL')]
          : [
            selectedEffect(actor, 'RKF03-J2-B-RAGE-HEAL'),
            selectedEffect(actor, 'RKF03-J4-A-RAGE-HEAL'),
          ];
        for (const extra of extras) {
          if (!extra) continue;
          ratio += n(extra.params?.max_hp_ratio_add, 0);
          mark(runtime, extra);
        }
        if (actor.hp <= actor.stats.max_hp * 0.5 && selectedEffect(actor, 'RKF03-J3-A-LOW-HEAL')) ratio *= 1.25;
        if (actor.hp <= actor.stats.max_hp * 0.3 && selectedEffect(actor, 'RKF03-J4-B-LOW-HEAL')) ratio *= 1.3;
        resolveHeal(runtime, action, actor.stats.max_hp * ratio, effect);
        continue;
      }
    }
    if (effect.operation === 'rage_gain') {
      if (p.action && p.action !== action.type) continue;
      if (p.action_types && !p.action_types.includes(action.type)) continue;
      let amount = n(p.amount, 0);
      if (p.mode === 'ratio_of_actual_paid') amount = action.lockedCost * n(p.ratio, 0);
      if (p.mode === 'add_ratio_to_actual_paid') amount = action.lockedCost * n(p.ratio_add, 0);
      if (effect.id === 'RKF02-PASSIVE-RAGE-REFUND') amount = action.lockedCost * 0.2;
      if (effect.id === 'RKF02-J2-C-REFUND') amount = action.lockedCost * 0.2;
      if (effect.id === 'RKF02-J4-A-REFUND') amount = action.lockedCost * 0.2;
      if (effect.id === 'RKF05-J2-C-RAGE' || effect.id === 'RKF05-J4-B-RAGE') amount = n(p.amount, 0);
      if (effect.id === 'RKF02-J1-B-RAGE' || effect.id === 'RKF01-J1-B-RAGE' || effect.id === 'RKF07-J1-B-RAGE' || effect.id === 'RKF09-J1-C-RAGE') {
        if (action.type !== 'basic_action') continue;
      }
      if (effect.id === 'RKF07-J3-C-RAGE' && action.actualBonusSegments < 1) continue;
      if (effect.id === 'RKF08-J1-C-RAGE' && !hasStatus(target, 'weakness') && !hasStatus(target, 'armor_break')) continue;
      if (effect.id === 'RKF10-J1-C-RAGE' && action.phaseTransition !== 'night_to_day') continue;
      if (effect.id === 'RKF10-J3-A-RAGE' && action.phaseTransition !== 'day_to_night') continue;
      if (effect.id === 'RKF10-J4-C-RAGE' && !action.phaseChanged) continue;
      if (effect.id === 'RKF04-J2-B-RAGE') continue;
      if (effect.id === 'RKF09-J3-C-RAGE') continue;
      if (effect.id === 'RKF03-J2-C-RAGE') continue;
      if (effect.id === 'RL05-RAGE-ACTION-RETURN' || effect.id === 'RC23-RAGE-ACTION-RETURN') {
        if (action.type !== 'rage_action') continue;
      }
      if (effect.id === 'RKF02-J4-C-NEXT-BASIC') continue;
      if (effect.id === 'RKF02-PASSIVE-RAGE-REFUND' ||
          effect.id === 'RKF02-J2-C-REFUND' ||
          effect.id === 'RKF02-J4-A-REFUND') continue;
      registerRage(runtime, actor, amount * effect.stacks, effect.id, effect.ownerId);
      continue;
    }
    if (effect.operation === 'rage_drain') {
      const amount = n(p.amount, 0) * effect.stacks;
      if (amount > 0) requestDrain(runtime, target, amount, effect.id, effect.ownerId);
      continue;
    }
    if (effect.operation === 'replace_action' &&
        action.type === 'rage_action' &&
        p.next_action === 'basic_action') {
      actor.forcedBasic = {
        ratioAdd: n(p.basic_damage_ratio_add, 0),
        rageGainBonus: n(p.basic_rage_gain_bonus, 0) + (p.base_public_basic_gain ? n(p.base_public_basic_gain, 25) - 25 : 0),
      };
      mark(runtime, effect);
      continue;
    }
    if (effect.operation === 'advance_phase') {
      const before = actor.phase;
      actor.phase = actor.phase === 'day' ? 'night' : 'day';
      action.phaseChanged = before !== actor.phase;
      action.phaseTransition = `${before}_to_${actor.phase}`;
      mark(runtime, effect);
      frame(runtime, 'phase', `${actor.side === 'player' ? '玩家' : '敌人'}相位转为${actor.phase === 'day' ? '白昼' : '长夜'}`, actor.side, actor.side, effect.id);
      continue;
    }
  }
  if (action.type === 'basic_action' && action.completed) {
    const basicGain = n(rules(runtime.content).rage?.basic_completed, 25) + (actor.forcedBasic?.rageGainBonus ?? 0);
    registerRage(runtime, actor, basicGain, 'RULES-BASIC-COMPLETED', actor.method.id);
    actor.forcedBasic = null;
  }
  if (action.type === 'rage_action') {
    const refundRatio = actor.method.id === 'RKF02'
      ? 0.2 + (selectedEffect(actor, 'RKF02-J2-C-REFUND') ? 0.2 : 0) + (selectedEffect(actor, 'RKF02-J4-A-REFUND') ? 0.2 : 0)
      : 0;
    if (refundRatio > 0) registerRage(runtime, actor, action.lockedCost * refundRatio, 'RKF02-RAGE-REFUND', actor.method.id);
  }
  if (target.hp > 0) {
    for (const artifact of target.artifacts) {
      if (artifact.entity.id === 'RR08' && action.enemyActualHpDamage > 0) {
        registerRage(runtime, target, 10 * artifact.stacks, 'RR08-ENEMY-ACTION-RAGE-GAIN', artifact.entity.id);
      }
      if (artifact.entity.id === 'RR09' && action.reflectDamage > 0) {
        registerRage(runtime, target, 10 * artifact.stacks, 'RR09-REFLECT-ENEMY-ACTION-RAGE', artifact.entity.id);
      }
    }
  }
}

function executeAction(runtime: BattleRuntime, actor: Fighter, target: Fighter, type: ActionType, lockedCost: number): void {
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0) return;
  actor.actionNumber += 1;
  const action: ActionContext = {
    actor,
    target,
    type,
    isMainAction: true,
    round: runtime.round,
    lockedCost,
    actionStats: dynamicStats(runtime, actor, target, null),
    actionStartShield: actor.shield,
    actionStartStatuses: snapshotStatuses(actor),
    reservedChargeLuck: false,
    chargeLuckAvailableAtStart: hasStatus(actor, 'charge_luck'),
    swordIntentAtStart: statusCount(actor, 'sword_intent'),
    consumedSwordIntent: 0,
    consumedBurn: 0,
    consumedShield: 0,
    consumedShieldDamage: 0,
    actualBonusSegments: 0,
    actualDebuffApplied: false,
    hadEffectiveBaseHit: false,
    hadBaseCriticalHit: false,
    firstBaseHit: false,
    baseDirectHitCount: 0,
    directCritCount: 0,
    rr10CritCount: 0,
    recoilDone: false,
    actualHpDamage: 0,
    actualAbsorbed: 0,
    enemyActualHpDamage: 0,
    reflectDamage: 0,
    phaseBefore: actor.phase,
    phaseChanged: false,
    phaseTransition: null,
    completed: false,
    stop: false,
    dotRageRecorded: false,
    healRageRecorded: false,
  };
  runtime.currentAction = action;
  if (type === 'rage_action') {
    if (actor.rage < lockedCost) {
      runtime.currentAction = null;
      return;
    }
    actor.rage -= lockedCost;
    frame(runtime, 'rage', `${actor.side === 'player' ? '玩家' : '敌人'}支付怒气 ${Math.round(lockedCost)}`, actor.side, actor.side, `${actor.method.id}-rage-cost`, lockedCost);
  }
  if (actor.method.id === 'RKF07') {
    const shieldEffect = selectedEffect(actor, 'RKF07-J4-C-CHAIN') ?? selectedEffect(actor, 'RKF07-J3-B-SHIELD');
    if (shieldEffect && action.chargeLuckAvailableAtStart) {
      action.reservedChargeLuck = true;
      mark(runtime, shieldEffect);
    }
  }
  if (actor.method.id === 'RKF01' && type === 'rage_action' && selectedEffect(actor, 'RKF01-J4-B-CONSUME-SHIELD')) {
    const effect = selectedEffect(actor, 'RKF01-J4-B-CONSUME-SHIELD')!;
    action.consumedShield = actor.shield * n(effect.params?.shield_consume_ratio, 0.75);
    actor.shield = Math.max(0, actor.shield - action.consumedShield);
    action.consumedShieldDamage = action.consumedShield * n(effect.params?.extra_damage_per_shield_ratio, 0.5);
    if (action.consumedShield > 0) mark(runtime, effect);
  }
  if (actor.method.id === 'RKF10' && type === 'basic_action' && actor.phase === 'day' && selectedEffect(actor, 'RKF10-J3-C-CONVERT')) {
    const effect = selectedEffect(actor, 'RKF10-J3-C-CONVERT')!;
    action.consumedShield = actor.shield * n(effect.params?.consume_ratio, 0.35);
    actor.shield = Math.max(0, actor.shield - action.consumedShield);
    action.consumedShieldDamage = action.consumedShield * n(effect.params?.attack_ratio_per_shield, 0.18);
    if (action.consumedShield > 0) {
      mark(runtime, effect);
      dealDamage(runtime, actor, target, 0, { sourceEffect: effect, kind: 'derived', canCrit: false, rawOverride: action.consumedShieldDamage });
      if (!runtime.active) {
        runtime.currentAction = null;
        return;
      }
    }
  }
  const baseId = `${actor.method.id}-${type === 'basic_action' ? 'BASIC-DAMAGE' : 'RAGE-DAMAGE'}`;
  const base = actionEffect(actor, type, baseId);
  const spec = directSpec(runtime, action, base);
  frame(runtime, 'action', `${actor.side === 'player' ? '玩家' : '敌人'}${type === 'basic_action' ? '普攻' : '怒技'}`, actor.side, target.side, base.id);
  for (let index = 0; index < spec.segments; index++) {
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) {
      action.stop = true;
      break;
    }
    const before = target.hp;
    const hit = dealDamage(runtime, actor, target, spec.ratio, {
      sourceEffect: base,
      kind: 'direct',
      canCrit: spec.canCrit,
      base: true,
      criticalBonusRatio: spec.bonusNoCrit,
    });
    if (hit.effective) action.firstBaseHit ||= true;
    applyActionHitStatus(runtime, action, base, hit);
    if (actor.method.id === 'RKF07' && type === 'rage_action') {
      const chain = actionEffect(actor, type, 'RKF07-RAGE-CHAIN');
      resolveChain(runtime, action, chain, hit);
    }
    if (target.hp <= 0 || !runtime.active) {
      action.stop = true;
      break;
    }
    if (actor.method.id === 'RKF09' && type === 'rage_action') {
      const burn = actionEffect(actor, type, 'RKF09-RAGE-BURN');
      const stacks = effectValueForStatus(runtime, actor, target, action, burn, 'stacks_per_segment', 1);
      const added = applyDot(runtime, actor, target, burn, 'burn', stacks, int(burn.params?.duration_rounds, 3), n(burn.params?.attack_ratio_per_stack, 0.08), int(burn.params?.max_stacks, 10), action.actionStats.attack);
      action.actualDebuffApplied ||= added > 0;
    }
    void before;
  }
  if (!runtime.active || target.hp <= 0 || actor.hp <= 0) {
    runtime.currentAction = null;
    return;
  }
  if (actor.method.id === 'RKF08' && type === 'rage_action') {
    const armor = actionEffect(actor, type, 'RKF08-RAGE-ARMOR');
    const added = addRegularStatus(runtime, target, 'armor_break', int(armor.params?.stacks, 2), int(armor.params?.duration_rounds, 2), armor, undefined, int(armor.params?.max_stacks, 5));
    action.actualDebuffApplied ||= added > 0;
    resolveNegativeFollowup(runtime, action);
    if (action.stop || !runtime.active || target.hp <= 0) {
      runtime.currentAction = null;
      return;
    }
  }
  if (actor.method.id === 'RKF06' && type === 'rage_action') {
    const poison = actionEffect(actor, type, 'RKF06-RAGE-POISON');
    const stacks = effectValueForStatus(runtime, actor, target, action, poison, 'stacks', 2);
    const added = applyDot(runtime, actor, target, poison, 'poison', stacks, int(poison.params?.duration_rounds, 3), n(poison.params?.attack_ratio_per_stack, 0.08), int(poison.params?.max_stacks, 10), action.actionStats.attack);
    action.actualDebuffApplied ||= added > 0;
  }
  if (actor.method.id === 'RKF04' && type === 'rage_action') resolveStatusConsumption(runtime, action);
  if (actor.method.id === 'RKF05' && type === 'rage_action') resolveStatusConsumption(runtime, action);
  if (actor.method.id === 'RKF09' && type === 'rage_action') {
    if (selectedEffect(actor, 'RKF09-J3-A-CHANCE')) {
      const chance = selectedEffect(actor, 'RKF09-J3-A-CHANCE')!;
      if (runtime.random() < n(chance.params?.chance, 0.5)) {
        const hit = dealDamage(runtime, actor, target, n(chance.params?.attack_ratio, 0.46), { sourceEffect: chance, kind: 'direct', canCrit: chance.params?.can_crit !== false, followup: true });
        if (hit.effective) {
          const ap = chance.params?.apply_status;
          if (ap) applyDot(runtime, actor, target, chance, 'burn', int(ap.stacks, 1), int(ap.duration_rounds, 3), n(ap.attack_ratio_per_stack, 0.08), 10, action.actionStats.attack);
        }
      }
    }
    resolveStatusConsumption(runtime, action);
  }
  action.completed = true;
  resolveActionEnd(runtime, action);
  runtime.currentAction = null;
}

function processRoundDots(runtime: BattleRuntime): void {
  const first = runtime.player.stats.speed > runtime.enemy.stats.speed
    ? runtime.player
    : runtime.enemy.stats.speed > runtime.player.stats.speed
      ? runtime.enemy
      : runtime.sameSpeedFirst === 'player' ? runtime.player : runtime.enemy;
  const second = first === runtime.player ? runtime.enemy : runtime.player;
  const order: [Fighter, Fighter][] = [[first, second], [second, first]];
  for (const [owner, target] of order) {
    if (!runtime.active || owner.hp <= 0 || target.hp <= 0) return;
    for (const status of ['poison', 'burn'] as const) {
      const layers = [...getStatusLayers(target, status)];
      for (const layer of layers) {
        if (!runtime.active || owner.hp <= 0 || target.hp <= 0) return;
        const sourceId = layer.sourceId ?? `${owner.method.id}-${status}`;
        const ownerEffect = activeModifiers(owner).find(effect => effect.id === sourceId) ??
          Object.assign({ id: sourceId, ownerId: owner.method.id, ownerName: owner.method.name, ownerKind: 'method', ownerSide: owner.side, stacks: 1 }, {});
        const synthetic: ActionContext = {
          actor: owner,
          target,
          type: 'basic_action',
          isMainAction: false,
          round: runtime.round,
          lockedCost: 0,
          actionStats: dynamicStats(runtime, owner, target, null),
          actionStartShield: owner.shield,
          actionStartStatuses: snapshotStatuses(owner),
          reservedChargeLuck: false,
          chargeLuckAvailableAtStart: false,
          swordIntentAtStart: statusCount(owner, 'sword_intent'),
          consumedSwordIntent: 0,
          consumedBurn: 0,
          consumedShield: 0,
          consumedShieldDamage: 0,
          actualBonusSegments: 0,
          actualDebuffApplied: false,
          hadEffectiveBaseHit: false,
          hadBaseCriticalHit: false,
          firstBaseHit: false,
          baseDirectHitCount: 0,
          directCritCount: 0,
          rr10CritCount: 0,
          recoilDone: false,
          actualHpDamage: 0,
          actualAbsorbed: 0,
          enemyActualHpDamage: 0,
          reflectDamage: 0,
          phaseBefore: owner.phase,
          phaseChanged: false,
          phaseTransition: null,
          completed: false,
          stop: false,
          dotRageRecorded: false,
          healRageRecorded: false,
        };
        runtime.currentAction = synthetic;
        const result = dealDamage(runtime, owner, target, 0, {
          sourceEffect: ownerEffect as ActiveEffect,
          kind: 'dot',
          canCrit: false,
          rawOverride: n(layer.damage, 0),
        });
        (synthetic as AnyMap).lastDotDamage = result.hpDamage + result.absorbed;
        (synthetic as AnyMap).lastOwnDotHpDamage = result.hpDamage;
        if (result.hpDamage > 0) {
          const dotEffects = activeModifiers(owner).filter(effect => effect.trigger === 'dot_resolved');
          for (const effect of dotEffects) {
            if (effect.params?.status && effect.params.status !== status && !(effect.params?.statuses ?? []).includes(status)) continue;
            if (effect.id === 'RKF04-J2-B-RAGE' && status !== 'burn') continue;
            if (effect.id === 'RKF09-J3-C-RAGE' && status !== 'burn') continue;
            if (effect.id === 'RR11-DOT-ROUND-RAGE' && !['poison', 'burn'].includes(status)) continue;
            if (effect.id === 'RL02-FIRST-BURN-HEAL' && status !== 'burn') continue;
            const oncePerRound = effect.id === 'RKF04-J2-B-RAGE' ||
              effect.id === 'RKF09-J3-C-RAGE' ||
              effect.id === 'RR11-DOT-ROUND-RAGE' ||
              effect.id === 'RL02-FIRST-BURN-HEAL' ||
              effect.id === 'RKF04-J4-C-SHIELD';
            const onceKey = `dot:${runtime.round}:${effect.id}`;
            if (oncePerRound && owner.battleFlags.has(onceKey)) continue;
            if (effect.operation === 'rage_gain') {
              if (oncePerRound) owner.battleFlags.add(onceKey);
              registerRage(runtime, owner, n(effect.params?.amount, 0) * effect.stacks, effect.id, effect.ownerId);
            }
            if (effect.operation === 'shield') {
              if (oncePerRound) owner.battleFlags.add(onceKey);
              addShield(runtime, owner, (result.hpDamage + result.absorbed) * n(effect.params?.actual_damage_ratio, 0.3), effect, '持续伤害转盾');
            }
            if (effect.operation === 'heal') {
              if (oncePerRound) owner.battleFlags.add(onceKey);
              resolveHeal(runtime, synthetic, result.hpDamage * n(effect.params?.ratio, 0.25), effect);
            }
          }
        }
        runtime.currentAction = null;
        const liveLayer = getStatusLayers(target, status).find(item => item === layer);
        if (liveLayer) liveLayer.remaining -= 1;
        const liveLayers = getStatusLayers(target, status);
        fighterStatusReplace(target, status, liveLayers.filter(item => item.remaining > 0));
        if (!runtime.active) return;
      }
    }
  }
}

function fighterStatusReplace(fighter: Fighter, status: StatusName, layers: StatusLayer[]): void {
  fighter.statuses.set(status, layers);
}

function decayStatuses(fighter: Fighter): void {
  for (const status of ['weakness', 'armor_break'] as StatusName[]) {
    const layers = getStatusLayers(fighter, status);
    for (const layer of layers) layer.remaining -= 1;
    fighter.statuses.set(status, layers.filter(layer => layer.remaining > 0));
  }
}

function rageDrainResistance(runtime: BattleRuntime, fighter: Fighter, requested: number): number {
  if (requested <= 0) return 0;
  let resistance = 0;
  for (const effect of activeModifiers(fighter, 'rage_drain_resist')) {
    const params = effect.params ?? {};
    const source = params.source;
    if (source && source !== 'external_rage_drain_only') continue;
    const ratio = n(params.ratio ?? params.amount, 0);
    if (ratio <= 0) continue;
    resistance += ratio * effect.stacks;
    mark(runtime, effect, effect.stacks);
  }
  return clamp(resistance, 0, 1);
}

function settleRage(runtime: BattleRuntime): void {
  for (const fighter of [runtime.player, runtime.enemy]) {
    if (fighter.hp <= 0) {
      fighter.pendingGains = [];
      fighter.pendingDrains = [];
      continue;
    }
    const gains = fighter.pendingGains.reduce((sum, entry) => sum + entry.amount, 0);
    if (gains > 0) {
      fighter.rage = Math.min(fighter.rageCap, fighter.rage + gains);
      frame(runtime, 'rage', `${fighter.side === 'player' ? '玩家' : '敌人'}轮尾回怒 ${Math.round(gains)}`, fighter.side, fighter.side, 'RULES-RAGE-SETTLE', gains);
    }
    const requested = runtime.roundDrainRequested.get(fighter.side) ?? 0;
    const resistance = rageDrainResistance(runtime, fighter, requested);
    const actualDrain = Math.min(n(rules(runtime.content).rage?.round_drain_cap, 20), Math.floor(requested * (1 - resistance)));
    if (actualDrain > 0) {
      fighter.rage = Math.max(0, fighter.rage - actualDrain);
      frame(runtime, 'rage', `${fighter.side === 'player' ? '玩家' : '敌人'}被削怒 ${actualDrain}`, fighter.side, fighter.side, 'RULES-RAGE-DRAIN', actualDrain);
    }
    fighter.pendingGains = [];
    fighter.pendingDrains = [];
  }
  runtime.roundDrainRequested.clear();
}

function applyOpening(runtime: BattleRuntime): void {
  const base = n(rules(runtime.content).rage?.opening, 50);
  for (const fighter of [runtime.player, runtime.enemy]) {
    const bonus = fighter.artifacts.reduce((sum, artifact) => {
      if (artifact.entity.id === 'RC22') return sum + 15 * artifact.stacks;
      if (artifact.entity.id === 'RL04') return sum + 50 * artifact.stacks;
      return sum;
    }, 0);
    fighter.rage = Math.min(fighter.rageCap, base + bonus);
    if (bonus > 0) {
      frame(runtime, 'rage', `${fighter.side === 'player' ? '玩家' : '敌人'}开场回怒`, fighter.side, fighter.side, 'RULES-OPENING-RAGE', base + bonus);
      for (const artifact of fighter.artifacts) {
        let amount = 0;
        if (artifact.entity.id === 'RC22') amount = 15 * artifact.stacks;
        if (artifact.entity.id === 'RL04') amount = 50 * artifact.stacks;
        if (amount <= 0) continue;
        addContribution(runtime, artifact.entity.id, 'rage', amount, fighter.side);
        const effect = artifact.entity.effects?.find((item: Effect) => item.operation === 'rage_gain' && item.trigger === 'battle_start');
        if (effect) {
          mark(runtime, Object.assign(clone(effect), {
            ownerId: artifact.entity.id,
            ownerName: artifact.entity.name,
            ownerKind: 'artifact' as SourceKind,
            stacks: artifact.stacks,
          }), artifact.stacks, fighter.side);
        }
      }
    }
    const drain = runtime.openingDrainRequested.get(fighter.side) ?? 0;
    const resistance = rageDrainResistance(runtime, fighter, drain);
    const actual = Math.min(n(rules(runtime.content).rage?.opening_drain_cap, 50), Math.floor(drain * (1 - resistance)));
    if (actual > 0) {
      fighter.rage = Math.max(0, fighter.rage - actual);
      frame(runtime, 'rage', `${fighter.side === 'player' ? '玩家' : '敌人'}开场被削怒 ${actual}`, fighter.side, fighter.side, 'RULES-OPENING-DRAIN', actual);
    }
  }
  runtime.openingDrainRequested.clear();
}

function executePreparedFirstStrike(runtime: BattleRuntime, actor: Fighter, target: Fighter): void {
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0 || actor.firstStrikeConsumed || actor.firstStrike <= 0) return;
  actor.firstStrikeConsumed = true;
  const hit = dealDamage(runtime, actor, target, 0, {
    sourceEffect: 'RKF05-TRAVEL-NEXT-STRIKE',
    kind: 'direct',
    canCrit: true,
    rawOverride: actor.firstStrike,
  });
  // A prepared strike is a direct segment for the receiver's public incoming
  // rage rule, but it has no action context and therefore cannot enter any
  // basic-hit, crit-followup, shield-recoil, or action-end chain.
  if (hit.effective && runtime.active && target.hp > 0) {
    registerIncomingDirectRage(runtime, target);
  }
}

function startBattle(runtime: BattleRuntime): void {
  for (const fighter of [runtime.player, runtime.enemy]) {
    for (const effect of activeModifiers(fighter)) {
      if (effect.trigger !== 'battle_start') continue;
      if (effect.operation === 'modify_stat') {
        const p = effect.params ?? {};
        if (p.condition) continue;
        const stat = p.stat as keyof Stats;
        if (!STAT_KEYS.includes(stat)) throw new Error(`Unknown battle-start stat ${String(stat)}`);
        const amount = n(p.amount ?? p.flat, 0) * effect.stacks;
        if (p.mode === 'percent_add') fighter.stats[stat] *= 1 + amount;
        else fighter.stats[stat] += amount;
        mark(runtime, effect, effect.stacks);
      }
      if (effect.operation === 'apply_status' && effect.id === 'RKF10-PASSIVE-INITIAL-PHASE') {
        fighter.phase = effect.params?.phase === 'night' ? 'night' : 'day';
        mark(runtime, effect);
      }
      if (effect.operation === 'rage_drain') {
        if (effect.ownerKind === 'artifact') continue;
        requestDrain(runtime, other(runtime, fighter), n(effect.params?.amount, 0) * effect.stacks, effect.id, effect.ownerId, true);
      }
    }
    for (const artifact of fighter.artifacts) {
      for (const effect of artifact.entity.effects ?? []) {
        if (effect.trigger !== 'battle_start') continue;
        const active = Object.assign(clone(effect), { ownerId: artifact.entity.id, ownerName: artifact.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: fighter.side, stacks: artifact.stacks });
        if (effect.operation === 'rage_gain') {
          // Opening additions are folded into the common opening clamp.
          continue;
        }
        if (effect.operation === 'rage_drain') {
          requestDrain(runtime, other(runtime, fighter), n(effect.params?.amount, 0) * artifact.stacks, effect.id, artifact.entity.id, true);
          mark(runtime, active);
        }
      }
    }
  }
  applyOpening(runtime);
  frame(runtime, 'start', '战斗开始');
}

function chooseAction(fighter: Fighter): { type: ActionType; cost: number } {
  if (fighter.forcedBasic) return { type: 'basic_action', cost: 0 };
  if (fighter.rage >= fighter.rageCap) return { type: 'rage_action', cost: fighter.rageCap };
  return { type: 'basic_action', cost: 0 };
}

function createFighter(runtime: BattleRuntime, side: 'player' | 'enemy', loadout: Loadout): Fighter {
  const compiled = validateLoadout(runtime.content, loadout);
  const stats = calculateStats(runtime.content, loadout);
  const fighter: Fighter = {
    side,
    loadout,
    method: compiled.method,
    talents: compiled.talents,
    artifacts: compiled.artifacts,
    stats,
    hp: clamp(n(loadout.hp, stats.max_hp), 0, stats.max_hp),
    shield: 0,
    rage: 0,
    rageCap: 100,
    firstStrike: Math.max(0, n(loadout.firstStrike, 0)),
    firstStrikeConsumed: false,
    statuses: new Map(),
    phase: compiled.method.id === 'RKF10' ? 'day' : 'day',
    forcedBasic: null,
    pendingGains: [],
    pendingDrains: [],
    actionNumber: 0,
    battleFlags: new Set(),
    battleLayers: {},
    contributionIds: new Set(),
  };
  (fighter as AnyMap).__content = runtime.content;
  fighter.rageCap = staticRageCap(fighter);
  fighter.rageCap = Math.max(60, fighter.rageCap);
  return fighter;
}

function checkOutcome(runtime: BattleRuntime): 'player' | 'enemy' | 'draw' | undefined {
  const playerDead = runtime.player.hp <= 0;
  const enemyDead = runtime.enemy.hp <= 0;
  if (!playerDead && !enemyDead) return undefined;
  runtime.active = false;
  if (playerDead && enemyDead) return 'draw';
  return playerDead ? 'enemy' : 'player';
}

export function simulateBattle(
  content: Content,
  player: Loadout,
  enemy: Loadout,
  seed: string,
  options: { roundLimit?: number } = {},
): BattleResult {
  if (typeof seed !== 'string') throw new Error('Battle seed must be a string');
  const roundLimit = options.roundLimit === undefined ? 256 : options.roundLimit;
  if (!Number.isInteger(roundLimit) || roundLimit <= 0) throw new Error('roundLimit must be a positive integer');
  const runtime = {
    content,
    random: seededRandom(`${seed}:combat`),
    seed,
    frames: [],
    player: undefined as unknown as Fighter,
    enemy: undefined as unknown as Fighter,
    contributions: new Map<string, Contribution>(),
    sourceNames: new Map<string, string>(),
    round: 0,
    active: true,
    roundDrainRequested: new Map(),
    openingDrainRequested: new Map(),
    currentAction: null,
    sameSpeedFirst: 'player',
  } as BattleRuntime;
  runtime.player = createFighter(runtime, 'player', player);
  runtime.enemy = createFighter(runtime, 'enemy', enemy);
  buildSourceRegistry(runtime, runtime.player);
  buildSourceRegistry(runtime, runtime.enemy);
  startBattle(runtime);
  if (runtime.player.loadout.preparation && runtime.player.hp > 0) {
    addShield(runtime, runtime.player, n(runtime.player.loadout.preparation), runtime.player.method.id, '战前准备护盾');
  }
  runtime.sameSpeedFirst = hashSeed(`${seed}:same-speed`) % 2 === 0 ? 'player' : 'enemy';
  let outcome = checkOutcome(runtime);
  for (let round = 1; runtime.active && !outcome && round <= roundLimit; round++) {
    runtime.round = round;
    const pChoice = chooseAction(runtime.player);
    const eChoice = chooseAction(runtime.enemy);
    runtime.player.lockedAction = pChoice.type;
    runtime.enemy.lockedAction = eChoice.type;
    const first = runtime.player.stats.speed > runtime.enemy.stats.speed
      ? runtime.player
      : runtime.enemy.stats.speed > runtime.player.stats.speed
        ? runtime.enemy
        : runtime.sameSpeedFirst === 'player' ? runtime.player : runtime.enemy;
    const second = first === runtime.player ? runtime.enemy : runtime.player;
    frame(runtime, 'round', `第${round}轮`);
    if (round === 1) {
      // Travel preparation belongs to the player and is the battle's first
      // strike, so it precedes whichever side wins the speed ordering.
      executePreparedFirstStrike(runtime, runtime.player, runtime.enemy);
      outcome = checkOutcome(runtime);
      if (outcome) break;
    }
    executePreparedFirstStrike(runtime, first, first === runtime.player ? runtime.enemy : runtime.player);
    outcome = checkOutcome(runtime);
    if (outcome) break;
    executeAction(runtime, first, first === runtime.player ? runtime.enemy : runtime.player,
      first === runtime.player ? pChoice.type : eChoice.type,
      first === runtime.player ? pChoice.cost : eChoice.cost);
    outcome = checkOutcome(runtime);
    if (outcome) break;
    executePreparedFirstStrike(runtime, second, second === runtime.player ? runtime.enemy : runtime.player);
    outcome = checkOutcome(runtime);
    if (outcome) break;
    executeAction(runtime, second, second === runtime.player ? runtime.enemy : runtime.player,
      second === runtime.player ? pChoice.type : eChoice.type,
      second === runtime.player ? pChoice.cost : eChoice.cost);
    outcome = checkOutcome(runtime);
    if (outcome) break;
    processRoundDots(runtime);
    outcome = checkOutcome(runtime);
    if (outcome) break;
    if (runtime.player.hp > 0) registerRage(runtime, runtime.player, n(rules(content).rage?.round_end, 10), 'RULES-ROUND-END', runtime.player.method.id);
    if (runtime.enemy.hp > 0) registerRage(runtime, runtime.enemy, n(rules(content).rage?.round_end, 10), 'RULES-ROUND-END', runtime.enemy.method.id);
    for (const fighter of [runtime.player, runtime.enemy]) {
      if (fighter.hp <= 0) continue;
      for (const artifact of fighter.artifacts) {
        if (artifact.entity.id !== 'RC21') continue;
        registerRage(runtime, fighter, 5 * artifact.stacks, artifact.entity.id, artifact.entity.id);
      }
      const roundTalent = selectedEffect(fighter, 'RKF02-J2-B-ROUND-RAGE');
      if (roundTalent) registerRage(runtime, fighter, n(roundTalent.params?.amount, 10), roundTalent.id, roundTalent.ownerId);
    }
    settleRage(runtime);
    for (const fighter of [runtime.player, runtime.enemy]) {
      const cap = selectedEffect(fighter, 'RR07-FIRST-RAGE-CAP-REDUCTION');
      if (cap && fighter.battleFlags.has('RR07-PENDING')) {
        fighter.rageCap = Math.max(60, fighter.rageCap + n(cap.params?.delta, -15));
        fighter.rage = Math.min(fighter.rage, fighter.rageCap);
        fighter.battleFlags.delete('RR07-PENDING');
        frame(runtime, 'rage', `${fighter.side === 'player' ? '玩家' : '敌人'}怒气上限调整`, fighter.side, fighter.side, cap.id, fighter.rageCap);
      }
    }
    decayStatuses(runtime.player);
    decayStatuses(runtime.enemy);
    runtime.currentAction = null;
  }
  if (!outcome) {
    outcome = 'draw';
    runtime.reason = `round_limit_${roundLimit}`;
    frame(runtime, 'draw', `达到${roundLimit}轮上限，战斗平局`);
  } else {
    frame(runtime, 'end', outcome === 'player' ? '玩家胜利' : outcome === 'enemy' ? '敌人胜利' : '双方同时倒下');
  }
  assignZeroContributionReasons(runtime);
  const contributions = [...runtime.contributions.values()].filter(contribution =>
    runtime.player.side === 'player' && (
      contribution.id === runtime.player.method.id ||
      runtime.player.talents.some(talent => talent.id === contribution.id) ||
      runtime.player.artifacts.some(artifact => artifact.entity.id === contribution.id)
    ),
  );
  const frames = runtime.frames.length > 12000
    ? [
      ...runtime.frames.slice(0, 5999),
      { ...runtime.frames[5999], kind: 'summary', text: `战报折叠了中间 ${runtime.frames.length - 11999} 条记录；结算与贡献保留完整。` },
      ...runtime.frames.slice(-6000),
    ]
    : runtime.frames;
  return {
    outcome,
    rounds: runtime.round,
    playerHp: Math.max(0, runtime.player.hp),
    enemyHp: Math.max(0, runtime.enemy.hp),
    frames,
    contributions,
    ...(runtime.reason ? { reason: runtime.reason } : {}),
  };
}
