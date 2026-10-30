import { hashSeed, seededRandom } from './content.js';
import { MAX_EQUIPMENT_SLOTS } from './equipment.js';
import {
  DEVOURING_ARTIFACT_ID,
  artifactDevourRule,
  devouredDamageMultiplier,
  assertArtifactDevouredField,
} from './artifact-growth.js';
import {
  journeyFacts,
  selectedBuildMechanics,
  staticBuildStats,
  type BuildKind,
  type BuildMechanic,
} from './build-mechanics.js';
import type {
  BattleFrame,
  BattleResult,
  Content,
  Contribution,
  FighterView,
  Loadout,
  PermanentSacrificeRule,
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
type ArtifactInscription = 'twin' | 'leech' | 'swift';
type ActionType = 'basic_action' | 'rage_action';
type LockedActionType = ActionType | 'wait';
type StatusName = 'poison' | 'burn' | 'weakness' | 'armor_break' | 'sword_intent' | 'charge_luck' | 'day_night';
type FusionKind = 'toxic_flame' | 'twin_swords';
type ResonanceKind =
  | 'guard_pressure'
  | 'returning_breath'
  | 'spring_bloom'
  | 'burn_accelerate'
  | 'sword_array'
  | 'thunder_induction'
  | 'moon_hex'
  | 'shield_retort'
  | 'venom_pin'
  | 'wealth_strikes'
  | 'rebound_guard'
  | 'toxic_furnace'
  | 'healing_blades'
  | 'ember_furnace'
  | 'wheel_storm';

interface StatusLayer {
  remaining: number;
  damage?: number;
  sourceId?: string;
  ownerId?: string;
  ownerSide?: 'player' | 'enemy';
  attackRatio?: number;
  kind?: 'dot' | 'regular';
}

interface ArtifactRuntime {
  entity: AnyMap;
  stacks: number;
  inscription?: ArtifactInscription;
  devoured?: number;
}

interface CompanionRuntime {
  method: AnyMap;
  sourceId: string;
  usesAlternateEffect: boolean;
}

interface CoreRuleRuntime {
  artifact: ArtifactRuntime;
  effect: ActiveEffect;
  kind: string;
  params: AnyMap;
}

type EnemyTrial =
  | {
    kind: 'tidal_charge';
    period: number;
    charges: number;
    attack_ratio_per_charge: number;
  }
  | {
    kind: 'reviving_mist';
    period: number;
    charges: number;
    heal_hp_ratio_per_charge: number;
  };

interface Fighter {
  artifactAwakenings: boolean;
  side: 'player' | 'enemy';
  lockedAction?: LockedActionType;
  loadout: Loadout;
  method: AnyMap;
  companions: CompanionRuntime[];
  talents: AnyMap[];
  artifacts: ArtifactRuntime[];
  coreRules: CoreRuleRuntime[];
  buildRules: BuildMechanic[];
  stats: Stats;
  hp: number;
  shield: number;
  maxShield: number;
  rage: number;
  rageCap: number;
  firstStrike: number;
  firstStrikeConsumed: boolean;
  statuses: Map<StatusName, StatusLayer[]>;
  phase: 'day' | 'night';
  forcedBasic: {
    ratioAdd: number;
    rageGainBonus: number;
    extraSegments?: number;
    segmentScale?: number;
  } | null;
  pendingGains: RageEntry[];
  pendingDrains: RageDrain[];
  actionNumber: number;
  battleFlags: Set<string>;
  battleLayers: Record<string, number>;
  contributionIds: Set<string>;
  trial?: EnemyTrial;
  trialCharges?: number;
  trialCountdown?: number;
  runtimeEffects?: ActiveEffect[];
}

interface RageEntry {
  amount: number;
  sourceId: string;
  sourceOwner: string;
  isEcho?: boolean;
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
  actorStartStatusLayers: Map<StatusName, StatusLayer[]>;
  targetStartStatusLayers: Map<StatusName, StatusLayer[]>;
  resonanceLimitUses: Map<string, number>;
  reservedChargeLuck: boolean;
  chargeLuckAvailableAtStart: boolean;
  swordIntentAtStart: number;
  consumedSwordIntent: number;
  consumedBurn: number;
  consumedShield: number;
  consumedShieldDamage: number;
  reservedPressure: number;
  reservedHealingBlades: number;
  reservedFurnaceHeat: number;
  returningBreathSegments: number;
  returningBreathScale: number;
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
  unmirroredMainHpDamage: number;
  rr02SelfHealConversion?: boolean;
  reflectDamage: number;
  phaseBefore: 'day' | 'night';
  phaseChanged: boolean;
  phaseTransition: string | null;
  completed: boolean;
  stop: boolean;
  isReaction?: boolean;
  directShieldAbsorbed?: number;
  directShieldBroken?: boolean;
  dotRageRecorded: boolean;
  healRageRecorded: boolean;
  isEcho?: boolean;
  echoSource?: ActiveEffect;
  powerScale?: number;
  chargeLuckShieldOutput?: boolean;
  roundDotSettlement?: boolean;
  combatEvents?: Set<CompanionTrigger>;
}

type CompanionTrigger = 'hit' | 'shield' | 'heal' | 'rage' | 'poison' | 'burn' | 'debuff' | 'phase';

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
  artifactAwakenings: boolean;
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
  activeCue?: BattleFrame['cue'];
  reason?: string;
  roundDrainRequested: Map<'player' | 'enemy', number>;
  openingDrainRequested: Map<'player' | 'enemy', number>;
  currentAction: ActionContext | null;
  sameSpeedFirst: 'player' | 'enemy';
  artifactOutputReplayDepth: number;
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

interface ResonanceSchema {
  kind: ResonanceKind;
  params: readonly string[];
}

const RESONANCE_SCHEMAS: Record<string, ResonanceSchema> = {
  RKF01: {
    kind: 'guard_pressure',
    params: ['absorb_ratio', 'cap_hp_ratio', 'counter_threshold_hp_ratio', 'release_ratio'],
  },
  RKF02: { kind: 'returning_breath', params: ['extra_segments', 'segment_ratio', 'rage_bonus'] },
  RKF03: { kind: 'spring_bloom', params: ['threshold_hp_ratio', 'burst_hp_ratio'] },
  RKF04: { kind: 'burn_accelerate', params: ['ticks'] },
  RKF05: {
    kind: 'sword_array',
    params: [
      'artifact_intent_limit',
      'consume_stacks',
      'attack_ratio',
      'opening_swords',
      'flying_sword_cap',
      'flying_sword_ratio',
    ],
  },
  RKF07: { kind: 'thunder_induction', params: ['hit_threshold', 'attack_ratio', 'max_per_action'] },
  RKF08: { kind: 'moon_hex', params: ['attack_ratio', 'drain_per_kind'] },
  RC13: { kind: 'shield_retort', params: ['defense_ratio'] },
  RR03: {
    kind: 'venom_pin',
    params: ['hit_threshold', 'poison_stacks', 'duration_rounds', 'attack_ratio', 'max_per_action'],
  },
  RR04: { kind: 'wealth_strikes', params: ['coins_per_segment', 'max_segments', 'attack_ratio'] },
  RR09: { kind: 'rebound_guard', params: ['rage_gain', 'defense_ratio'] },
  RR11: { kind: 'toxic_furnace', params: ['remaining_damage_ratio', 'rage_gain'] },
  RR12: { kind: 'healing_blades', params: ['max_charges', 'attack_ratio'] },
  RL02: { kind: 'ember_furnace', params: ['stored_ratio', 'cap_hp_ratio', 'segments'] },
  RL03: {
    kind: 'wheel_storm',
    params: ['hit_threshold', 'segments', 'attack_ratio', 'max_per_action'],
  },
};

const FUSION_RULE_SCHEMAS: Record<string, FusionKind> = {
  RL06: 'toxic_flame',
  RL07: 'twin_swords',
};

const RESONANCE_INTEGER_PARAMETERS = new Set([
  'ticks',
  'extra_segments',
  'artifact_intent_limit',
  'consume_stacks',
  'hit_threshold',
  'max_per_action',
  'drain_per_kind',
  'poison_stacks',
  'duration_rounds',
  'coins_per_segment',
  'max_segments',
  'max_charges',
  'segments',
  'rage_bonus',
  'rage_gain',
  'opening_swords',
  'flying_sword_cap',
]);

const RESONANCE_POSITIVE_PARAMETERS = new Set([
  'threshold_hp_ratio',
  'counter_threshold_hp_ratio',
  'hit_threshold',
  'extra_segments',
  'artifact_intent_limit',
  'consume_stacks',
  'max_per_action',
  'ticks',
  'poison_stacks',
  'duration_rounds',
  'coins_per_segment',
  'max_segments',
  'max_charges',
  'segments',
  'opening_swords',
  'flying_sword_cap',
  'flying_sword_ratio',
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

function sharedInsights(content: Content): AnyMap[] {
  const insights = rules(content).insights;
  if (Array.isArray(insights)) return insights.filter(item => item && typeof item.id === 'string');
  if (insights && typeof insights === 'object') {
    return Object.values(insights).filter((item: any) => item && typeof item.id === 'string') as AnyMap[];
  }
  return [];
}

function sharedInsight(content: Content, id: string): AnyMap | undefined {
  return sharedInsights(content).find(talent => talent.id === id);
}

function validateSharedInsight(talent: AnyMap): void {
  if (!Array.isArray(talent.effects) || talent.effects.length === 0) {
    throw new Error(`Shared insight ${talent.id} has no effects`);
  }
  for (const effect of talent.effects as Effect[]) {
    const supported = (effect.trigger === 'always' && effect.operation === 'modify_stat') ||
      (effect.trigger === 'battle_start' && effect.operation === 'shield') ||
      (effect.trigger === 'round_end' && effect.operation === 'rage_gain') ||
      (effect.trigger === 'action_end' && (effect.operation === 'heal' || effect.operation === 'shield')) ||
      (effect.trigger === 'always' && effect.operation === 'modify_effect' &&
        typeof effect.params?.build === 'string');
    if (!supported || effect.target !== 'self') {
      throw new Error(`Unsupported shared insight effect ${effect.id} (${talent.id})`);
    }
  }
}

function isSharedTalentEffect(runtime: BattleRuntime, fighter: Fighter, effect: ActiveEffect): boolean {
  return effect.ownerKind === 'talent' &&
    fighter.talents.some(talent => talent.id === effect.ownerId) &&
    Boolean(sharedInsight(runtime.content, effect.ownerId));
}

function equipmentRole(artifact: AnyMap): 'core' | 'support' {
  const declared = artifact.equipment_role;
  if (declared === 'core' || declared === 'support') return declared;
  if (declared !== undefined) throw new Error(`Invalid equipment role ${String(declared)} (${artifact.id})`);
  throw new Error(`Missing equipment role (${artifact.id})`);
}

const CORE_RULE_PARAMETERS: Record<string, string[]> = {
  basic_convergence: ['damage_ratio'],
  basic_echo: ['ratio', 'rage_damage_ratio'],
  rage_gambit: ['rage_refund', 'incoming_damage_ratio'],
  shield_burst: ['opening_shield_ratio', 'shield_ratio', 'damage_ratio'],
  healing_guard: ['heal_ratio', 'shield_ratio', 'direct_damage_ratio'],
  poison_detonation: ['poison_stacks', 'damage_ratio'],
  burn_siphon: ['burn_stacks', 'heal_ratio', 'rage_damage_ratio'],
};

const GAMBIT_RULE_SCHEMAS: Record<string, { kind: string; params: Record<string, number> }> = {
  RL04: { kind: 'overdrive', params: { rage_cap: 50, defense_multiplier: 0.65 } },
  RR05: { kind: 'reckless', params: { defense_multiplier: 0.5, direct_damage_multiplier: 1.6 } },
};

function coreRuleShape(artifact: AnyMap): { kind: string; params: AnyMap } | undefined {
  const rule = artifact.core_rule;
  if (!rule) return undefined;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.kind !== 'string') {
    throw new Error(`Invalid core_rule (${artifact.id})`);
  }
  const params = rule.params && typeof rule.params === 'object' && !Array.isArray(rule.params)
    ? rule.params
    : rule;
  const required = CORE_RULE_PARAMETERS[rule.kind];
  if (!required) throw new Error(`Unsupported core_rule ${rule.kind} (${artifact.id})`);
  if (rule.kind === 'basic_convergence') {
    const ruleKeys = rule.params ? ['kind', 'params'] : ['kind', ...required];
    const parameterKeys = params === rule ? ['kind', ...required] : required;
    if (Object.keys(rule).some(key => !ruleKeys.includes(key)) ||
        Object.keys(params).some(key => !parameterKeys.includes(key))) {
      throw new Error(`Unknown core_rule parameter (${artifact.id})`);
    }
  }
  for (const key of required) {
    if (!isFiniteNumber(params[key]) || params[key] < 0) {
      throw new Error(`Invalid core_rule parameter ${key} (${artifact.id})`);
    }
  }
  if (rule.kind === 'shield_burst' && params.shield_ratio > 1) {
    throw new Error(`Invalid core_rule shield_ratio (${artifact.id})`);
  }
  for (const key of ['poison_stacks', 'burn_stacks']) {
    if (required.includes(key) && (!Number.isInteger(params[key]) || params[key] < 1)) {
      throw new Error(`Invalid core_rule parameter ${key} (${artifact.id})`);
    }
  }
  return { kind: rule.kind, params };
}

function gambitRuleShape(artifact: AnyMap): { kind: string; params: AnyMap } | undefined {
  const expected = GAMBIT_RULE_SCHEMAS[artifact.id];
  const hasRule = Object.prototype.hasOwnProperty.call(artifact, 'gambit_rule');
  if (!expected) {
    if (hasRule) throw new Error(`Unsupported gambit_rule owner (${artifact.id})`);
    return undefined;
  }
  const rule = artifact.gambit_rule;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error(`Missing or invalid gambit_rule (${artifact.id})`);
  }
  const expectedKeys = ['kind', ...Object.keys(expected.params)];
  const keys = Object.keys(rule);
  if (keys.length !== expectedKeys.length || keys.some(key => !expectedKeys.includes(key))) {
    throw new Error(`Unknown or missing gambit_rule parameter (${artifact.id})`);
  }
  if (rule.kind !== expected.kind) throw new Error(`Unsupported gambit_rule kind ${String(rule.kind)} (${artifact.id})`);
  for (const [key, expectedValue] of Object.entries(expected.params)) {
    if (!isFiniteNumber(rule[key]) || rule[key] !== expectedValue) {
      throw new Error(`Invalid gambit_rule parameter ${key} (${artifact.id})`);
    }
  }
  return { kind: rule.kind, params: rule };
}

function validateGambitRules(content: Content): void {
  const kinds = new Map<string, string>();
  for (const authored of content.entities) {
    if (authored.kind !== 'artifact') {
      if (Object.prototype.hasOwnProperty.call(authored, 'gambit_rule')) {
        throw new Error(`gambit_rule is only valid on artifacts (${authored.id})`);
      }
      continue;
    }
    const shape = gambitRuleShape(authored);
    if (!shape) continue;
    const previous = kinds.get(shape.kind);
    if (previous) throw new Error(`Duplicate gambit_rule kind ${shape.kind} (${previous}, ${authored.id})`);
    kinds.set(shape.kind, authored.id);
  }
}

function fusionRuleKind(artifact: AnyMap): FusionKind | undefined {
  if (!Object.prototype.hasOwnProperty.call(artifact, 'fusion_rule')) return undefined;
  const expected = FUSION_RULE_SCHEMAS[artifact.id];
  if (artifact.kind !== 'artifact' || !expected) {
    throw new Error(`Unsupported fusion_rule owner (${artifact.id})`);
  }
  const rule = artifact.fusion_rule;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
      Object.keys(rule).length !== 1 || Object.keys(rule)[0] !== 'kind' ||
      typeof rule.kind !== 'string' || rule.kind !== expected) {
    throw new Error(`Invalid fusion_rule (${artifact.id})`);
  }
  return expected;
}

function validateFusionRules(content: Content): void {
  for (const artifact of content.entities) {
    if (Object.prototype.hasOwnProperty.call(artifact, 'fusion_rule')) {
      fusionRuleKind(artifact);
    }
  }
  for (const artifactId of Object.keys(FUSION_RULE_SCHEMAS)) {
    const artifact = content.byId[artifactId];
    if (!artifact || artifact.kind !== 'artifact' || fusionRuleKind(artifact) === undefined) {
      throw new Error(`Missing fusion_rule (${artifactId})`);
    }
  }
}

interface FusionRuleRuntime {
  artifact: ArtifactRuntime;
  effect: ActiveEffect;
  kind: FusionKind;
}

function fusionRules(fighter: Fighter): FusionRuleRuntime[] {
  return fighter.artifacts.flatMap(artifact => {
    const kind = fusionRuleKind(artifact.entity);
    if (!kind) return [];
    const effect = Object.assign({
      id: artifact.entity.id,
      trigger: 'action_end',
      operation: 'fusion_rule',
      params: { kind },
    }, {
      ownerId: artifact.entity.id,
      ownerName: artifact.entity.name,
      ownerKind: 'artifact' as SourceKind,
      ownerSide: fighter.side,
      stacks: 1,
    }) as ActiveEffect;
    return [{ artifact, effect, kind }];
  });
}

function resonanceMarker(effect: AnyMap): boolean {
  return typeof effect?.id === 'string' && effect.id.endsWith('-V2-RESONANCE') ||
    Boolean(effect?.params && typeof effect.params === 'object' &&
      !Array.isArray(effect.params) && 'resonance' in effect.params);
}

function validateResonanceEffect(
  ownerId: string,
  location: string,
  effect: AnyMap,
  counts: Map<string, number>,
): void {
  const schema = RESONANCE_SCHEMAS[ownerId];
  if (!schema) throw new Error(`Unsupported V2 resonance owner ${ownerId}`);
  const expectedLocation = ownerId.startsWith('RKF') ? 'method_passive' : 'artifact_effect';
  if (location !== expectedLocation) {
    throw new Error(`V2 resonance rule ${effect.id ?? ownerId} is not an authored ${expectedLocation}`);
  }
  const expectedId = `${ownerId}-V2-RESONANCE`;
  if (effect.id !== expectedId) throw new Error(`Mismatched V2 resonance effect id for ${ownerId}`);
  if (effect.trigger !== 'always' || effect.operation !== 'modify_effect' || effect.target !== 'self') {
    throw new Error(`Invalid V2 resonance effect shape (${ownerId})`);
  }
  const requiredEffectKeys = [
    'id', 'trigger', 'operation', 'target', 'params', 'requires',
    'consumes', 'replaces', 'limit', 'text',
  ];
  if (requiredEffectKeys.some(key => !(key in effect)) ||
      typeof effect.text !== 'string' || effect.text.trim().length === 0) {
    throw new Error(`Incomplete V2 resonance effect shape (${ownerId})`);
  }
  const allowedEffectKeys = new Set([
    'id', 'trigger', 'operation', 'target', 'params', 'requires', 'consumes', 'replaces', 'limit', 'text',
  ]);
  for (const key of Object.keys(effect)) {
    if (!allowedEffectKeys.has(key)) throw new Error(`Unknown V2 resonance effect key ${key} (${ownerId})`);
  }
  const params = effect.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error(`Missing V2 resonance parameters (${ownerId})`);
  }
  const expectedParams = new Set(['resonance', ...schema.params]);
  for (const key of Object.keys(params)) {
    if (!expectedParams.has(key)) throw new Error(`Unknown V2 resonance parameter ${key} (${ownerId})`);
  }
  if (params.resonance !== schema.kind) {
    throw new Error(`Mismatched V2 resonance kind for ${ownerId}: ${String(params.resonance)}`);
  }
  for (const key of schema.params) {
    const value = params[key];
    if (!isFiniteNumber(value) || value < 0) {
      throw new Error(`Invalid V2 resonance parameter ${key} (${ownerId})`);
    }
    if (RESONANCE_INTEGER_PARAMETERS.has(key) && !Number.isInteger(value)) {
      throw new Error(`Noninteger V2 resonance count ${key} (${ownerId})`);
    }
    if (RESONANCE_POSITIVE_PARAMETERS.has(key) && value <= 0) {
      throw new Error(`Zero V2 resonance threshold/count ${key} (${ownerId})`);
    }
    if (key.endsWith('_ratio') && value > 1) {
      throw new Error(`V2 resonance fraction exceeds one: ${key} (${ownerId})`);
    }
  }
  if (schema.kind === 'sword_array' && params.opening_swords > params.flying_sword_cap) {
    throw new Error(`Opening flying swords exceed cap (${ownerId})`);
  }
  for (const key of ['requires', 'consumes', 'replaces']) {
    if (!Array.isArray(effect[key]) || effect[key].length !== 0) {
      throw new Error(`V2 resonance ${key} must be empty (${ownerId})`);
    }
  }
  const limit = effect.limit;
  if (!limit || typeof limit !== 'object' || Array.isArray(limit) ||
      Object.keys(limit).some(key => key !== 'scope' && key !== 'count') ||
      limit.scope !== 'permanent' || limit.count !== 1) {
    throw new Error(`Invalid V2 resonance installation limit (${ownerId})`);
  }
  counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
}

function validateResonanceRules(content: Content): void {
  const counts = new Map<string, number>();
  const inspect = (ownerId: string, location: string, effects: unknown): void => {
    if (!Array.isArray(effects)) return;
    for (const effect of effects) {
      if (!resonanceMarker(effect)) continue;
      validateResonanceEffect(ownerId, location, effect, counts);
    }
  };
  for (const authored of content.entities) {
    const id = String(authored.id);
    inspect(id, authored.kind === 'artifact' ? 'artifact_effect' : 'entity_effect', authored.effects);
    inspect(id, 'method_passive', authored.passives);
    inspect(id, 'method_travel', authored.travel);
    for (const action of Object.values(authored.actions ?? {}) as AnyMap[]) {
      inspect(id, 'method_action', action?.effects);
    }
    for (const talent of authored.talents ?? []) inspect(talent.id, 'talent', talent.effects);
    if (authored.id === 'RULES') {
      const insights = authored.insights;
      const shared = Array.isArray(insights) ? insights : Object.values(insights ?? {});
      for (const talent of shared as AnyMap[]) inspect(talent.id, 'shared_talent', talent.effects);
    }
  }
  for (const ownerId of Object.keys(RESONANCE_SCHEMAS)) {
    if (counts.get(ownerId) !== 1) {
      throw new Error(`Expected exactly one V2 resonance rule for ${ownerId}`);
    }
  }
}

const ENEMY_TRIAL_CONTRACTS = {
  'EN-A1-B1': { kind: 'tidal_charge', ratio: 'attack_ratio_per_charge' },
  'EN-A1-B2': { kind: 'reviving_mist', ratio: 'heal_hp_ratio_per_charge' },
} as const;

function validateEnemyTrials(content: Content): void {
  for (const authored of content.entities) {
    if (!Object.prototype.hasOwnProperty.call(authored, 'trial')) continue;
    const schema = ENEMY_TRIAL_CONTRACTS[authored.id as keyof typeof ENEMY_TRIAL_CONTRACTS];
    if (authored.kind !== 'enemy' || !schema) {
      throw new Error(`Unsupported enemy trial owner ${authored.id}`);
    }
    const trial = authored.trial;
    if (!trial || typeof trial !== 'object' || Array.isArray(trial)) {
      throw new Error(`Invalid enemy trial (${authored.id})`);
    }
    const expectedKeys = ['kind', 'period', 'charges', schema.ratio];
    const keys = Object.keys(trial);
    if (keys.length !== expectedKeys.length || keys.some(key => !expectedKeys.includes(key))) {
      throw new Error(`Unknown or missing enemy trial parameter (${authored.id})`);
    }
    if (trial.kind !== schema.kind) {
      throw new Error(`Invalid enemy trial kind (${authored.id})`);
    }
    for (const key of ['period', 'charges']) {
      const value = trial[key];
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        throw new Error(`Invalid enemy trial parameter ${key} (${authored.id})`);
      }
    }
    const ratio = trial[schema.ratio];
    if (!isFiniteNumber(ratio) || ratio <= 0 || ratio > 1) {
      throw new Error(`Invalid enemy trial parameter ${schema.ratio} (${authored.id})`);
    }
  }
}

function validateMirrorRules(content: Content): void {
  const mirrorOwners = content.entities.filter(authored => authored.id === 'RL08');
  if (mirrorOwners.length > 1) throw new Error('Duplicate mirror rule owner RL08');
  for (const authored of content.entities) {
    const hasMirrorRule = Object.prototype.hasOwnProperty.call(authored, 'mirror_rule');
    if (authored.id !== 'RL08') {
      if (hasMirrorRule) throw new Error(`Unsupported mirror rule owner ${authored.id}`);
      continue;
    }
    if (authored.kind !== 'artifact') throw new Error('Mirror rule owner RL08 must be an artifact');
    if (!hasMirrorRule) throw new Error('Missing mirror rule (RL08)');
    const mirrorRule = authored.mirror_rule;
    if (!mirrorRule || typeof mirrorRule !== 'object' || Array.isArray(mirrorRule)) {
      throw new Error('Invalid mirror rule (RL08)');
    }
    const keys = Object.keys(mirrorRule);
    if (keys.length !== 1 || keys[0] !== 'kind') {
      throw new Error('Unknown or missing mirror rule parameter (RL08)');
    }
    if (mirrorRule.kind !== 'neighbor_awakening') {
      throw new Error(`Unsupported mirror rule kind ${String(mirrorRule.kind)} (RL08)`);
    }
  }
}

function coreRulesForFighter(fighter: Fighter): CoreRuleRuntime[] {
  return fighter.artifacts.flatMap(artifact => {
    const shape = coreRuleShape(artifact.entity);
    if (!shape) return [];
    const effect = Object.assign({
      id: artifact.entity.id,
      trigger: 'core_rule',
      operation: 'core_rule',
      params: {},
    }, {
      ownerId: artifact.entity.id,
      ownerName: artifact.entity.name,
      ownerKind: 'artifact' as SourceKind,
      ownerSide: fighter.side,
      stacks: 1,
    }) as ActiveEffect;
    return [{ artifact, effect, ...shape }];
  });
}

function artifactEffectStacks(effect: Effect, stacks: number): number | undefined {
  const minStacks = Math.max(1, int(effect.min_stacks, 1));
  if (stacks < minStacks) return undefined;
  return effect.min_stacks === undefined ? stacks : 1;
}

function activeEffects(method: AnyMap, talents: AnyMap[], artifacts: ArtifactRuntime[]): ActiveEffect[] {
  const result: ActiveEffect[] = [];
  const add = (
    effect: Effect,
    ownerId: string,
    ownerName: string,
    ownerKind: SourceKind,
    stacks = 1,
    artifactEffect = false,
  ) => {
    const effectStacks = artifactEffect ? artifactEffectStacks(effect, stacks) : stacks;
    if (effectStacks === undefined) return;
    result.push(Object.assign(clone(effect), { ownerId, ownerName, ownerKind, stacks: effectStacks }));
  };
  for (const action of [method.actions?.basic, method.actions?.rage]) {
    for (const effect of action?.effects ?? []) add(effect, method.id, method.name, 'method');
  }
  for (const effect of method.passives ?? []) add(effect, method.id, method.name, 'method');
  for (const talent of talents) for (const effect of talent.effects ?? []) add(effect, talent.id, talent.name, 'talent');
  for (const artifact of artifacts) {
    for (const effect of artifact.entity.effects ?? []) {
      add(effect, artifact.entity.id, artifact.entity.name, 'artifact', artifact.stacks, true);
    }
  }
  return result;
}

function effectIds(method: AnyMap, talents: AnyMap[], artifacts: ArtifactRuntime[]): Set<string> {
  return new Set(activeEffects(method, talents, artifacts).map(effect => effect.id));
}

function validateEffects(
  method: AnyMap,
  talents: AnyMap[],
  artifacts: ArtifactRuntime[],
  shared: AnyMap[],
): void {
  const activeIds = effectIds(method, talents, artifacts);
  const authoredIds = new Set<string>([
    ...allMethodEffects(method).map(effect => effect.id),
    ...shared.flatMap(talent => (talent.effects ?? []).map((effect: Effect) => effect.id)),
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

function validateLoadout(
  content: Content,
  loadout: Loadout,
  side: 'player' | 'enemy',
): { method: AnyMap; companions: AnyMap[]; talents: AnyMap[]; artifacts: ArtifactRuntime[]; trial?: EnemyTrial } {
  if (!loadout || typeof loadout !== 'object') throw new Error('Invalid Shanhai loadout');
  if (typeof loadout.method !== 'string') throw new Error('Loadout method is required');
  if (Object.hasOwn(loadout, 'companion')) throw new Error('Loadout uses unsupported single companion field');
  if (loadout.permanentRule !== undefined) {
    const rule = loadout.permanentRule as PermanentSacrificeRule;
    const validShattered = rule?.kind === 'shattered_core' &&
      Object.keys(rule).length === 2 && Number.isFinite(rule.originalMaxHp) && rule.originalMaxHp > 0;
    const validMarker = (rule?.kind === 'blind_sword' || rule?.kind === 'endless_chain') &&
      Object.keys(rule).length === 1;
    if (side !== 'player' || (!validShattered && !validMarker)) {
      throw new Error('Invalid permanent sacrifice rule');
    }
  }
  validateMirrorRules(content);
  validateResonanceRules(content);
  validateFusionRules(content);
  validateGambitRules(content);
  for (const [key, value] of [['preparation', loadout.preparation], ['firstStrike', loadout.firstStrike]] as const) {
    if (value !== undefined && (!isFiniteNumber(value) || value < 0)) {
      throw new Error(`Invalid ${key} preparation`);
    }
  }
  const method = entity(content, loadout.method, 'method');
  if (loadout.companions !== undefined && !Array.isArray(loadout.companions)) {
    throw new Error('Loadout companions must be an array of method IDs');
  }
  const companionIds = loadout.companions ?? [];
  const companionSet = new Set<string>();
  const companions: AnyMap[] = [];
  for (const id of companionIds) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Loadout companions must contain method IDs');
    if (companionSet.has(id)) throw new Error(`Duplicate companion method ${id}`);
    companionSet.add(id);
    const companion = entity(content, id, 'method');
    if (companion.id === method.id) throw new Error('Loadout companions must differ from the main method');
    if (!companion.companion || typeof companion.companion.name !== 'string' ||
        typeof companion.companion.quick !== 'string' || !companion.companion.effect) {
      throw new Error(`Method ${companion.id} has no valid companion assistance configuration`);
    }
    companions.push(companion);
  }
  let trial: EnemyTrial | undefined;
  if (loadout.encounterId !== undefined) {
    if (side !== 'enemy') throw new Error('Loadout encounterId is enemy-only');
    if (typeof loadout.encounterId !== 'string' || loadout.encounterId.length === 0) {
      throw new Error('Invalid enemy encounterId');
    }
    const encounter = entity(content, loadout.encounterId, 'enemy');
    if (encounter.method !== method.id) {
      throw new Error(`Enemy encounter ${encounter.id} does not match method ${method.id}`);
    }
    if (encounter.trial !== undefined) trial = clone(encounter.trial) as EnemyTrial;
  }
  if (!Number.isInteger(loadout.n) || loadout.n < 0 || loadout.n > 4) {
    throw new Error(`Invalid cultivation tier n=${loadout.n}`);
  }
  if (!Array.isArray(loadout.talents)) throw new Error('Loadout talents must be an array');
  const methodTalents = new Map<string, AnyMap>((method.talents ?? []).map((talent: AnyMap) => [talent.id, talent]));
  const sharedTalents = new Map<string, AnyMap>(sharedInsights(content).map(talent => [talent.id, talent]));
  const chosen: AnyMap[] = [];
  const tiers = new Set<number>();
  for (const id of loadout.talents) {
    const localTalent = methodTalents.get(id);
    const sharedTalent = localTalent ? undefined : sharedTalents.get(id);
    const talent = localTalent ?? sharedTalent;
    if (!talent) throw new Error(`Talent ${id} does not belong to ${method.id} or shared insights`);
    if (sharedTalent) validateSharedInsight(sharedTalent);
    if (!Number.isInteger(talent.tier) || talent.tier < 1 || talent.tier > 4) {
      throw new Error(`Invalid talent tier (${id})`);
    }
    if (tiers.has(talent.tier)) throw new Error(`More than one talent selected at tier ${talent.tier}`);
    if (talent.tier > loadout.n) throw new Error(`Talent ${id} exceeds cultivation tier ${loadout.n}`);
    tiers.add(talent.tier);
    chosen.push(talent);
  }
  if (!Array.isArray(loadout.artifacts)) throw new Error('Loadout artifacts must be an array');
  const artifacts: ArtifactRuntime[] = [];
  const uniqueGroups = new Set<string>();
  const counts = new Map<string, number>();
  const artifactIds = new Set<string>();
  if (loadout.artifacts.length > MAX_EQUIPMENT_SLOTS) {
    throw new Error(`Loadout exceeds ${MAX_EQUIPMENT_SLOTS} artifact slots`);
  }
  for (const stack of loadout.artifacts) {
    assertArtifactDevouredField(stack, 'loadout artifact');
    if (side === 'enemy' && stack && typeof stack === 'object' && Object.hasOwn(stack, 'devoured')) {
      throw new Error('Enemy loadouts cannot carry artifact devour growth');
    }
    if (!stack || typeof stack.id !== 'string' || !Number.isInteger(stack.stacks) || stack.stacks <= 0) {
      throw new Error(`Invalid artifact stack ${JSON.stringify(stack)}`);
    }
    const inscription = (stack as AnyMap).inscription;
    if (inscription !== undefined && inscription !== 'twin' && inscription !== 'leech' && inscription !== 'swift') {
      throw new Error(`Invalid artifact inscription ${String(inscription)} (${stack.id})`);
    }
    const artifact = entity(content, stack.id, 'artifact');
    if (artifactIds.has(artifact.id)) throw new Error(`Duplicate artifact ID ${artifact.id}`);
    artifactIds.add(artifact.id);
    const role = equipmentRole(artifact);
    void role;
    coreRuleShape(artifact);
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
    artifacts.push({
      entity: artifact,
      stacks: stack.stacks,
      ...(inscription ? { inscription: inscription as ArtifactInscription } : {}),
      ...(stack.devoured !== undefined ? { devoured: stack.devoured } : {}),
    });
  }
  validateEffects(method, chosen, artifacts, [...sharedTalents.values()]);
  return { method, companions, talents: chosen, artifacts, ...(trial ? { trial } : {}) };
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

function gambitDefenseMultiplier(artifacts: ArtifactRuntime[]): number {
  return artifacts.reduce((multiplier, artifact) =>
    multiplier * n(artifact.entity.gambit_rule?.defense_multiplier, 1), 1);
}

function unconditionalStatEffect(effect: Effect): boolean {
  if (effect.operation !== 'modify_stat') return false;
  if (effect.trigger !== 'always') return false;
  const p = effect.params ?? {};
  if (p.condition) return false;
  if (effect.requires?.some((item: string) =>
    !item.startsWith('RKF') && !item.startsWith('RC') && !item.startsWith('RR') &&
    !item.startsWith('RL') && !item.startsWith('V2-J'))) return false;
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
  const side = loadout?.encounterId === undefined ? 'player' : 'enemy';
  if (side === 'enemy') validateEnemyTrials(content);
  return calculateStatsForSide(content, loadout, side);
}

function calculateStatsForSide(
  content: Content,
  loadout: Loadout,
  side: 'player' | 'enemy',
): Stats {
  const compiled = validateLoadout(content, loadout, side);
  const stats = tierBaseStats(content, loadout);
  const flat: Stats = { attack: 0, defense: 0, max_hp: 0, crit_rate: 0, speed: 0 };
  const percent: Stats = { attack: 0, defense: 0, max_hp: 0, crit_rate: 0, speed: 0 };
  for (const artifact of compiled.artifacts) {
    for (const key of STAT_KEYS) flat[key] += n(artifact.entity.attributes?.flat?.[key], 0) * artifact.stacks;
    for (const key of STAT_KEYS) percent[key] += n(artifact.entity.attributes?.percent?.[key], 0) * artifact.stacks;
  }
  const buildStats = staticBuildStats(content, loadout);
  for (const key of STAT_KEYS) stats[key] += flat[key] + (buildStats[key] ?? 0);
  for (const key of STAT_KEYS) stats[key] *= 1 + percent[key];
  for (const effect of activeEffects(compiled.method, compiled.talents, compiled.artifacts)) {
    if (effect.ownerKind === 'artifact') continue;
    addStatEffect(stats, effect, effect.stacks);
  }
  stats.defense *= gambitDefenseMultiplier(compiled.artifacts);
  if (side === 'player' && loadout.permanentRule?.kind === 'shattered_core') {
    stats.max_hp = 1;
    stats.attack *= 1.8;
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
  const permanentRuleId = runtime.player.loadout.permanentRule?.kind === 'shattered_core'
    ? 'RE037-A'
    : runtime.player.loadout.permanentRule?.kind === 'blind_sword'
      ? 'RE037-B'
      : runtime.player.loadout.permanentRule?.kind === 'endless_chain'
        ? 'RE037-C'
        : undefined;
  if (id === permanentRuleId) return true;
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

function fighterOwnsSource(fighter: Fighter, sourceId: string, sourceSide?: 'player' | 'enemy'): boolean {
  if (sourceSide !== undefined && sourceSide !== fighter.side) return false;
  return sourceId === fighter.method.id ||
    fighter.talents.some(talent => talent.id === sourceId) ||
    fighter.artifacts.some(artifact => artifact.entity.id === sourceId) ||
    fighter.companions.some(companion => companion.sourceId === sourceId);
}

function fighterOwnsDotLayer(fighter: Fighter, layer: StatusLayer): boolean {
  return fighterOwnsSource(fighter, layer.ownerId ?? layer.sourceId ?? '', layer.ownerSide);
}

function companionSource(fighter: Fighter, companion: CompanionRuntime): ActiveEffect {
  const config = companion.method.companion;
  return {
    id: `${companion.method.id}-COMPANION-ASSIST`,
    trigger: 'companion_assist',
    operation: 'companion_assist',
    params: {},
    ownerId: companion.sourceId,
    ownerName: config.name,
    ownerKind: 'method',
    ownerSide: fighter.side,
    stacks: 1,
  };
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
  const action = runtime.currentAction;
  const echoOutput = action?.isEcho && action.echoSource &&
    typeof owner !== 'string' && owner.ownerKind !== 'artifact' &&
    owner.ownerSide === action.actor.side &&
    (field === 'damage' || field === 'healing' || field === 'shield');
  const attributed = echoOutput ? action.echoSource! : owner;
  const id = typeof attributed === 'string' ? attributed : attributed.ownerId;
  const name = typeof attributed === 'string' ? undefined : attributed.ownerName;
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
  for (const companion of fighter.companions) {
    const name = companion.method.companion.name;
    runtime.sourceNames.set(companion.sourceId, name);
    if (fighter.side === 'player') ensureContribution(runtime, companion.sourceId, name);
  }
  if (fighter.side === 'player' && fighter.loadout.permanentRule) {
    const [id, name] = fighter.loadout.permanentRule.kind === 'shattered_core'
      ? ['RE037-A', '法则·碎丹化婴']
      : fighter.loadout.permanentRule.kind === 'blind_sword'
        ? ['RE037-B', '法则·盲眼剑圣']
        : ['RE037-C', '法则·断普连诀'];
    runtime.sourceNames.set(id, name);
    ensureContribution(runtime, id, name);
  }
}

function artifactOutputCopyEffect(
  original: ActiveEffect,
  artifact: ArtifactRuntime,
  owner: Fighter,
  mode: 'mirror' | 'twin' | 'swift',
): ActiveEffect {
  let id: string;
  if (mode === 'mirror') {
    const awakeningSuffix = original.id.match(/-AWAKENING-\d+$/)?.[0];
    const suffix = awakeningSuffix ?? `-${original.id}`;
    id = `${artifact.entity.id}-MIRROR${suffix}`;
  } else {
    id = `${original.id}-INSCRIPTION-${mode.toUpperCase()}`;
  }
  return {
    ...clone(original),
    id,
    ownerId: artifact.entity.id,
    ownerName: artifact.entity.name,
    ownerKind: 'artifact',
    ownerSide: owner.side,
    stacks: artifact.stacks,
  };
}

function artifactOwnerForOutput(runtime: BattleRuntime, source: ActiveEffect): Fighter | undefined {
  const side = source.ownerSide ?? runtime.currentAction?.actor.side;
  const owner = side === 'player' ? runtime.player : side === 'enemy' ? runtime.enemy : undefined;
  if (!owner || source.ownerKind !== 'artifact') return undefined;
  return owner.artifacts.some(artifact => artifact.entity.id === source.ownerId) ? owner : undefined;
}

function isFirstMirrorOutput(runtime: BattleRuntime, source: ActiveEffect | string): source is ActiveEffect {
  return typeof source !== 'string' && runtime.artifactOutputReplayDepth === 1 &&
    source.ownerId === 'RL08' && source.id.startsWith('RL08-MIRROR-');
}

function leftMirrorForArtifact(owner: Fighter, artifact: ArtifactRuntime): ArtifactRuntime | undefined {
  const index = owner.artifacts.indexOf(artifact);
  if (index <= 0) return undefined;
  const mirror = owner.artifacts[index - 1];
  return mirror.entity.id === 'RL08' && mirror.entity.mirror_rule?.kind === 'neighbor_awakening'
    ? mirror
    : undefined;
}

function resolveArtifactOutputCopies(
  runtime: BattleRuntime,
  source: ActiveEffect | string,
  outputTarget: Fighter,
  resolve: (effect: ActiveEffect, mode: 'mirror' | 'twin' | 'swift') => void,
  phase: 'mirror' | 'inscription' | 'all' = 'all',
): void {
  if (typeof source === 'string' || source.ownerKind !== 'artifact' ||
      !runtime.active || outputTarget.hp <= 0) return;
  const isMirrorOutput = isFirstMirrorOutput(runtime, source);
  if (runtime.artifactOutputReplayDepth > 0 && !isMirrorOutput) return;
  const owner = artifactOwnerForOutput(runtime, source);
  if (!owner || owner.hp <= 0) return;
  const artifact = owner.artifacts.find(item => item.entity.id === source.ownerId);
  if (!artifact) return;

  const inscription = artifact.inscription;
  const inscriptionMode: 'twin' | 'swift' | undefined = inscription === 'twin'
    ? 'twin'
    : inscription === 'swift' && runtime.round === 1 ? 'swift' : undefined;
  const mirror = isMirrorOutput ? undefined : leftMirrorForArtifact(owner, artifact);
  const copies: { artifact: ArtifactRuntime; mode: 'mirror' | 'twin' | 'swift' }[] = [];
  // The right artifact's inscription stays with its own output. RL08 may use
  // its own inscription on a mirrored output, but that copy cannot mirror again.
  if (phase !== 'inscription' && mirror) copies.push({ artifact: mirror, mode: 'mirror' });
  if (phase !== 'mirror' && inscriptionMode) copies.push({ artifact, mode: inscriptionMode });

  for (const copy of copies) {
    if (!runtime.active || owner.hp <= 0 || outputTarget.hp <= 0) break;
    const copiedEffect = artifactOutputCopyEffect(source, copy.artifact, owner, copy.mode);
    if (copy.mode === 'mirror' && source.trigger === 'awakening') {
      frame(
        runtime,
        'status',
        `昆仑镜镜映（${artifact.entity.name}）：觉醒输出`,
        owner.side,
        outputTarget.side,
        copiedEffect.id,
      );
    }
    runtime.artifactOutputReplayDepth += 1;
    try {
      resolve(copiedEffect, copy.mode);
    } finally {
      runtime.artifactOutputReplayDepth -= 1;
    }
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
    if (effects.some(effect =>
      ['hunter', 'spending_power', 'bounty'].includes(effect.params?.build))) {
      contribution.reason = 'permanent attributes applied';
      continue;
    }
    if (effects.some(effect => effect.params?.build === 'shop_discount')) {
      contribution.reason = 'journey rule applied outside combat';
      continue;
    }
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

function resonanceRules(fighter: Fighter): ActiveEffect[] {
  return activeModifiers(fighter, 'modify_effect')
    .filter(effect => typeof effect.params?.resonance === 'string');
}

function resonanceRule(fighter: Fighter, kind: ResonanceKind): ActiveEffect | undefined {
  return resonanceRules(fighter).find(effect => effect.params.resonance === kind);
}

function resonanceStateKey(ownerId: string, field: string): string {
  return `resonance:${ownerId}:${field}`;
}

function resonanceState(fighter: Fighter, rule: ActiveEffect, field: string): number {
  return n(fighter.battleLayers[resonanceStateKey(rule.ownerId, field)], 0);
}

function setResonanceState(fighter: Fighter, rule: ActiveEffect, field: string, value: number): void {
  fighter.battleLayers[resonanceStateKey(rule.ownerId, field)] = Math.max(0, value);
}

function reserveActionLimit(action: ActionContext, key: string, maximum: number): boolean {
  const used = action.resonanceLimitUses.get(key) ?? 0;
  if (used >= maximum) return false;
  action.resonanceLimitUses.set(key, used + 1);
  return true;
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

function snapshotStatusLayers(fighter: Fighter): Map<StatusName, StatusLayer[]> {
  return new Map<StatusName, StatusLayer[]>(
    (['poison', 'burn', 'weakness', 'armor_break', 'sword_intent', 'charge_luck', 'day_night'] as StatusName[])
      .map(status => [status, [...getStatusLayers(fighter, status)]]),
  );
}

function resonanceCounters(fighter: Fighter): NonNullable<FighterView['counters']> {
  return resonanceRules(fighter).flatMap(rule => {
    const p = rule.params ?? {};
    let value: number | undefined;
    let maximum: number | undefined;
    let name: string | undefined;
    switch (p.resonance as ResonanceKind) {
      case 'guard_pressure':
        name = '蓄劲';
        maximum = fighter.stats.max_hp * n(p.cap_hp_ratio, 0);
        value = resonanceState(fighter, rule, 'pressure');
        break;
      case 'returning_breath':
        name = '归元蓄击';
        maximum = 1;
        value = resonanceState(fighter, rule, 'ready');
        break;
      case 'spring_bloom':
        name = '春华';
        maximum = fighter.stats.max_hp * n(p.threshold_hp_ratio, 0) * 2;
        value = resonanceState(fighter, rule, 'reservoir');
        break;
      case 'thunder_induction':
        name = '雷引';
        maximum = int(p.hit_threshold, 1);
        value = resonanceState(fighter, rule, 'hits');
        break;
      case 'venom_pin':
        name = '毒针';
        maximum = int(p.hit_threshold, 1);
        value = resonanceState(fighter, rule, 'hits');
        break;
      case 'wheel_storm':
        name = '轮势';
        maximum = int(p.hit_threshold, 1);
        value = resonanceState(fighter, rule, 'hits');
        break;
      case 'healing_blades':
        name = '生息刃';
        maximum = n(p.max_charges, 0);
        value = resonanceState(fighter, rule, 'charges');
        break;
      case 'ember_furnace':
        name = '炉火';
        maximum = fighter.stats.max_hp * n(p.cap_hp_ratio, 0);
        value = resonanceState(fighter, rule, 'heat');
        break;
      default:
        return [];
    }
    if (!name || !isFiniteNumber(maximum) || !isFiniteNumber(value)) return [];
    maximum = Math.max(0, maximum);
    return [{
      id: rule.id,
      name,
      value: Math.max(0, value),
      max: maximum,
    }];
  });
}

function rr08StoredKey(): string {
  return 'RR08:BLOOD-VALOR';
}

function rr08Effect(fighter: Fighter): ActiveEffect | undefined {
  return selectedEffect(fighter, 'RR08-ENEMY-ACTION-RAGE-GAIN');
}

function rr08Stored(fighter: Fighter): number {
  return Math.max(0, n(fighter.battleLayers[rr08StoredKey()], 0));
}

function rr08StorageCap(fighter: Fighter, effect = rr08Effect(fighter)): number {
  return effect ? fighter.stats.max_hp * n(effect.params?.storage_cap_hp_ratio, 0) : 0;
}

function rr08Counter(fighter: Fighter): NonNullable<FighterView['counters']> {
  const effect = rr08Effect(fighter);
  if (!effect) return [];
  const maximum = Math.max(0, rr08StorageCap(fighter, effect));
  return [{
    id: effect.id,
    name: '血勇',
    value: Math.min(maximum, rr08Stored(fighter)),
    max: maximum,
  }];
}

function trialCounters(fighter: Fighter): NonNullable<FighterView['counters']> {
  if (!fighter.trial || fighter.trialCharges === undefined || fighter.trialCountdown === undefined) return [];
  const chargeName = fighter.trial.kind === 'tidal_charge' ? '蓄潮' : '回雾';
  return [
    {
      id: `${fighter.loadout.encounterId}-TRIAL-CHARGES`,
      name: chargeName,
      value: fighter.trialCharges,
      max: fighter.trial.charges,
    },
    {
      id: `${fighter.loadout.encounterId}-TRIAL-COUNTDOWN`,
      name: '释势倒计时',
      value: fighter.trialCountdown,
      max: fighter.trial.period,
    },
  ];
}

function flyingSwordSnapshot(fighter: Fighter): FighterView['summons'] {
  const rule = resonanceRule(fighter, 'sword_array');
  if (!rule) return undefined;
  return [{
    id: rule.id,
    kind: 'sword',
    count: resonanceState(fighter, rule, 'flying_swords'),
    max: int(rule.params.flying_sword_cap, 0),
  }];
}

function fighterView(fighter: Fighter): FighterView {
  const statuses: Record<string, number> = {};
  const counters = [
    ...(resonanceCounters(fighter) ?? []),
    ...rr08Counter(fighter),
    ...trialCounters(fighter),
  ];
  const summons = flyingSwordSnapshot(fighter);
  for (const status of ['poison', 'burn', 'weakness', 'armor_break', 'sword_intent', 'charge_luck', 'day_night'] as StatusName[]) {
    const count = statusCount(fighter, status);
    if (count > 0) statuses[status] = count;
  }
  return {
    name: fighter.loadout.name,
    method: fighter.method.id,
    hp: Math.max(0, fighter.hp),
    maxHp: fighter.stats.max_hp,
    maxShield: fighter.loadout.permanentRule?.kind === 'shattered_core'
      ? fighter.maxShield
      : fighter.stats.max_hp,
    shield: Math.max(0, fighter.shield),
    rage: Math.max(0, fighter.rage),
    rageCap: fighter.rageCap,
    statuses,
    ...(counters?.length ? { counters } : {}),
    ...(summons?.length ? { summons } : {}),
    ...(fighter.lockedAction ? { lockedAction: fighter.lockedAction } : {}),
    ...(fighter.loadout.permanentRule ? { permanentRule: clone(fighter.loadout.permanentRule) } : {}),
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
  cue?: BattleFrame['cue'],
): void {
  const frameCue = cue ?? runtime.activeCue;
  runtime.frames.push({
    round: runtime.round,
    kind,
    actor,
    target,
    source,
    text,
    ...(amount === undefined ? {} : { amount }),
    ...(frameCue ? { cue: { ...frameCue } } : {}),
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
    if (requirement.startsWith('RKF') || requirement.startsWith('RC') ||
        requirement.startsWith('RR') || requirement.startsWith('RL') ||
        requirement.startsWith('V2-J')) continue;
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
  const add = (
    effect: Effect,
    ownerId: string,
    ownerName: string,
    ownerKind: SourceKind,
    stacks = 1,
    artifactEffect = false,
  ) => {
    const effectStacks = artifactEffect ? artifactEffectStacks(effect, stacks) : stacks;
    if (effectStacks === undefined) return;
    result.push(Object.assign(clone(effect), { ownerId, ownerName, ownerKind, ownerSide: fighter.side, stacks: effectStacks }));
  };
  for (const effect of method.passives ?? []) add(effect, method.id, method.name, 'method');
  for (const talent of fighter.talents) for (const effect of talent.effects ?? []) add(effect, talent.id, talent.name, 'talent');
  for (const artifact of fighter.artifacts) {
    for (const effect of artifact.entity.effects ?? []) {
      if (!fighter.artifactAwakenings && effect.min_stacks !== undefined) continue;
      add(effect, artifact.entity.id, artifact.entity.name, 'artifact', artifact.stacks, true);
    }
  }
  result.push(...fighter.coreRules.map(core => core.effect));
  fighter.runtimeEffects = result;
  return result;
}

function buildEffect(fighter: Fighter, mechanic: BuildMechanic): ActiveEffect | undefined {
  return activeModifiers(fighter, 'modify_effect').find(effect =>
    effect.ownerId === mechanic.id && effect.params?.build === mechanic.kind);
}

function mechanicsOf(fighter: Fighter, kind: BuildKind): BuildMechanic[] {
  return fighter.buildRules.filter(mechanic => mechanic.kind === kind);
}

function overdriveRule(fighter: Fighter): AnyMap | undefined {
  return fighter.artifacts.find(artifact => artifact.entity.gambit_rule?.kind === 'overdrive')?.entity.gambit_rule;
}

function normalizeRageCap(fighter: Fighter, cap: number): number {
  const overdrive = overdriveRule(fighter);
  if (overdrive) return n(overdrive.rage_cap, 50);
  return Math.max(60, n(rules((fighter as AnyMap).__content).rage?.min_cap, 60), cap);
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
  return normalizeRageCap(fighter, cap);
}

function dynamicStats(runtime: BattleRuntime, fighter: Fighter, target: Fighter, action: ActionContext | null): Stats {
  const stats = { ...fighter.stats };
  const gambitDefense = gambitDefenseMultiplier(fighter.artifacts);
  for (const mechanic of mechanicsOf(fighter, 'carapace')) {
    stats.defense += n(fighter.battleLayers[`carapace:${mechanic.id}`], 0) * gambitDefense;
  }
  const weak = statusCount(fighter, 'weakness');
  stats.attack *= Math.max(0, 1 - weak * n(rules(runtime.content).statuses?.weakness?.reduction_per_stack, 0.05));
  stats.defense *= Math.max(0, 1 - statusCount(fighter, 'armor_break') * n(rules(runtime.content).statuses?.armor_break?.reduction_per_stack, 0.05));
  for (const effect of activeModifiers(fighter, 'modify_stat')) {
    if (effect.trigger === 'battle_start' ||
        (effect.trigger === 'always' && unconditionalStatEffect(effect))) continue;
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
      actorStartStatusLayers: snapshotStatusLayers(fighter),
      targetStartStatusLayers: snapshotStatusLayers(target),
      resonanceLimitUses: new Map(),
      reservedChargeLuck: false,
      chargeLuckAvailableAtStart: false,
      swordIntentAtStart: statusCount(fighter, 'sword_intent'),
      consumedSwordIntent: 0,
      consumedBurn: 0,
      consumedShield: 0,
      consumedShieldDamage: 0,
      reservedPressure: 0,
      reservedHealingBlades: 0,
      reservedFurnaceHeat: 0,
      returningBreathSegments: 0,
      returningBreathScale: 1,
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
      unmirroredMainHpDamage: 0,
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
    else stats[stat] += stat === 'defense' ? amount * gambitDefense : amount;
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

function sharedOutputAmount(
  fighter: Fighter,
  action: ActionContext | null,
  params: AnyMap,
  stacks = 1,
): number {
  const stats = action?.actionStats ?? fighter.stats;
  if (isFiniteNumber(params.amount)) return params.amount * stacks;
  if (isFiniteNumber(params.max_hp_ratio)) return stats.max_hp * params.max_hp_ratio * stacks;
  if (isFiniteNumber(params.attack_ratio)) return stats.attack * params.attack_ratio * stacks;
  if (isFiniteNumber(params.defense_ratio)) return stats.defense * params.defense_ratio * stacks;
  if (isFiniteNumber(params.ratio)) return stats.max_hp * params.ratio * stacks;
  return 0;
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
    if (p.field !== field) continue;
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
  segmentRatios: number[];
  segmentBonusNoCrits: number[];
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
    } else if (mode === 'add' && mp.field === 'params.segments') {
      const previousSegments = segments;
      const nextSegments = previousSegments + int(mp.value, 0) * modifier.stacks;
      segments = Math.max(0, Math.min(int(mp.max_segments, nextSegments), nextSegments));
      used = segments !== previousSegments;
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
  if (action.type === 'rage_action') {
    for (const core of actor.coreRules) {
      if (!['basic_echo', 'burn_siphon'].includes(core.kind)) continue;
      ratio *= n(core.params.rage_damage_ratio, 1);
      mark(runtime, core.effect);
    }
  }
  if (action.type === 'rage_action' && action.actor.method.id === 'RKF05' && action.consumedSwordIntent > 0) {
    // This is a separate derived outlet and is resolved after the base hit.
  }
  const segmentRatios = Array.from({ length: segments }, () => ratio);
  const segmentBonusNoCrits = Array.from({ length: segments }, () => bonusNoCrit);
  if (action.type === 'basic_action') {
    let splitScale = 1;
    for (const mechanic of mechanicsOf(actor, 'basic_split')) {
      const extraSegments = int(mechanic.params.extra_segments, 0);
      if (extraSegments <= 0) continue;
      const segmentScale = n(mechanic.params.segment_ratio, 0);
      splitScale *= segmentScale;
      for (let index = 0; index < segmentRatios.length; index++) {
        segmentRatios[index] *= segmentScale;
        segmentBonusNoCrits[index] *= segmentScale;
      }
      const extraRatio = ratio * segmentScale;
      const extraBonus = bonusNoCrit * segmentScale;
      for (let index = 0; index < extraSegments; index++) {
        segmentRatios.push(extraRatio);
        segmentBonusNoCrits.push(extraBonus);
      }
      const effect = buildEffect(actor, mechanic);
      if (effect) mark(runtime, effect);
    }
    if (action.returningBreathSegments > 0) {
      const breathScale = action.returningBreathScale;
      for (let index = 0; index < segmentRatios.length; index++) {
        segmentRatios[index] *= breathScale;
        segmentBonusNoCrits[index] *= breathScale;
      }
      const extraRatio = ratio * splitScale * breathScale;
      const extraBonus = bonusNoCrit * splitScale * breathScale;
      for (let index = 0; index < action.returningBreathSegments; index++) {
        segmentRatios.push(extraRatio);
        segmentBonusNoCrits.push(extraBonus);
      }
    }
  }
  segments = segmentRatios.length;
  return { ratio, bonusNoCrit, segments, segmentRatios, segmentBonusNoCrits, canCrit, effectId };
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
  if (kind === 'direct' && source.side !== target.side) {
    for (const core of target.coreRules) {
      if (core.kind !== 'rage_gambit') continue;
      multiplier *= n(core.params.incoming_damage_ratio, 1);
      mark(runtime, core.effect);
    }
  }
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

function outgoingBuildMultiplier(
  runtime: BattleRuntime,
  source: Fighter,
  target: Fighter,
  action: ActionContext | null,
  kind: 'direct' | 'derived' | 'dot' | 'reflect',
): number {
  if (kind !== 'direct' && kind !== 'derived') return 1;
  let multiplier = 1;
  const journey = journeyFacts(source.loadout);
  for (const mechanic of source.buildRules) {
    const p = mechanic.params;
    if (mechanic.kind === 'wealth_damage') {
      const denominator = journey.coins + n(p.half_saturation, 0);
      if (denominator > 0) multiplier *= 1 + n(p.scale, 0) * journey.coins / denominator;
    } else if (mechanic.kind === 'speed_damage') {
      const ownSpeed = action?.actor === source ? action.actionStats.speed : source.stats.speed;
      const targetSpeed = dynamicStats(runtime, target, source, null).speed;
      const ratio = targetSpeed > 0 ? ownSpeed / targetSpeed : Number.POSITIVE_INFINITY;
      multiplier *= Math.max(1, Math.min(n(p.max_multiplier, 1), ratio));
    } else if (mechanic.kind === 'collection_damage') {
      multiplier *= 1 + n(p.base_bonus, 0) + n(p.per_kind, 0) * journey.artifactKinds;
    } else if (mechanic.kind === 'trophy_damage') {
      multiplier *= 1 + n(p.base_bonus, 0) +
        n(p.elite_bonus, 0) * journey.eliteWins +
        n(p.boss_bonus, 0) * journey.bossWins;
    } else if (mechanic.kind === 'blood_vow') {
      multiplier *= n(p.damage_multiplier, 1);
    } else {
      continue;
    }
    const effect = buildEffect(source, mechanic);
    if (effect) mark(runtime, effect);
  }
  return isFiniteNumber(multiplier) ? multiplier : 1;
}

function gambitDamageMultiplier(
  source: Fighter,
  kind: 'direct' | 'derived' | 'dot' | 'reflect',
): number {
  if (kind !== 'direct' && kind !== 'derived') return 1;
  return source.artifacts.reduce((multiplier, artifact) => {
    const rule = artifact.entity.gambit_rule;
    return rule?.kind === 'reckless'
      ? multiplier * n(rule.direct_damage_multiplier, 1)
      : multiplier;
  }, 1);
}

function applyCarapace(
  runtime: BattleRuntime,
  defender: Fighter,
  attacker: Fighter,
  action: ActionContext | null,
): void {
  if (defender.hp <= 0 || attacker.hp <= 0 || defender.side === attacker.side) return;
  for (const mechanic of mechanicsOf(defender, 'carapace')) {
    const layer = `carapace:${mechanic.id}`;
    defender.battleLayers[layer] = n(defender.battleLayers[layer], 0) +
      n(mechanic.params.defense_per_hit, 0);
    const effect = buildEffect(defender, mechanic);
    if (effect) mark(runtime, effect);
    const reflect = targetDefense(runtime, defender, attacker, action) *
      n(mechanic.params.reflect_ratio, 0);
    if (reflect <= 0 || defender.hp <= 0 || attacker.hp <= 0) continue;
    const hit = dealDamage(runtime, defender, attacker, 0, {
      sourceEffect: effect ?? mechanic.id,
      kind: 'reflect',
      canCrit: false,
      rawOverride: reflect,
    });
    if (action && hit.effective) action.reflectDamage += hit.hpDamage + hit.absorbed;
  }
}

function addGuardPressure(
  runtime: BattleRuntime,
  defender: Fighter,
  action: ActionContext | null,
  absorbed: number,
): void {
  if (!action || !action.isMainAction || action.isEcho || absorbed <= 0) return;
  const rule = resonanceRule(defender, 'guard_pressure');
  if (!rule) return;
  const cap = defender.stats.max_hp * n(rule.params.cap_hp_ratio, 0);
  const next = Math.min(cap, resonanceState(defender, rule, 'pressure') +
    absorbed * n(rule.params.absorb_ratio, 0));
  setResonanceState(defender, rule, 'pressure', next);
  mark(runtime, rule);
}

function triggerOutgoingResonances(
  runtime: BattleRuntime,
  source: Fighter,
  target: Fighter,
  action: ActionContext | null,
  sourceEffect: ActiveEffect | string,
  kind: 'direct' | 'derived' | 'dot' | 'reflect',
  effective: boolean,
  reactionEffectId?: string,
): void {
  if (!effective || !action ||
      (!action.isMainAction && !action.roundDotSettlement && !action.isReaction) || action.isEcho ||
      !runtime.active || source.hp <= 0 || target.hp <= 0 ||
      source === target || source.side === target.side ||
      action.actor !== source || action.target !== target ||
      (kind !== 'direct' && kind !== 'derived')) return;
  for (const rule of resonanceRules(source)) {
    if (rule.id === reactionEffectId) continue;
    const p = rule.params ?? {};
    switch (p.resonance as ResonanceKind) {
      case 'sword_array': {
        if (typeof sourceEffect === 'string' || sourceEffect.ownerKind !== 'artifact' ||
            !source.artifacts.some(artifact => artifact.entity.id === sourceEffect.ownerId)) break;
        const limit = int(p.artifact_intent_limit, 0);
        if (!reserveActionLimit(action, rule.id, limit)) break;
        addRegularStatus(
          runtime,
          source,
          'sword_intent',
          1,
          99,
          rule,
          undefined,
          selectedEffect(source, 'RKF05-J2-A-RETENTION')
            ? 7
            : int(rules(runtime.content).statuses?.sword_intent?.max_stacks, 5),
        );
        break;
      }
      case 'thunder_induction':
      case 'venom_pin':
      case 'wheel_storm': {
        const threshold = int(p.hit_threshold, 1);
        let hits = resonanceState(source, rule, 'hits') + 1;
        if (hits < threshold) {
          setResonanceState(source, rule, 'hits', hits);
          break;
        }
        const maximum = int(p.max_per_action, 1);
        const used = action.resonanceLimitUses.get(rule.id) ?? 0;
        if (used >= maximum) {
          setResonanceState(source, rule, 'hits', hits % threshold);
          break;
        }
        hits -= threshold;
        setResonanceState(source, rule, 'hits', hits);
        action.resonanceLimitUses.set(rule.id, used + 1);
        if (p.resonance === 'thunder_induction') {
          dealDamage(runtime, source, target, n(p.attack_ratio, 0), {
            sourceEffect: rule,
            kind: 'derived',
            canCrit: false,
            followup: true,
            resonanceEffectId: rule.id,
          });
          break;
        }
        if (p.resonance === 'venom_pin') {
          const poison = rules(runtime.content).statuses?.poison ?? {};
          const added = applyDot(
            runtime,
            source,
            target,
            rule,
            'poison',
            int(p.poison_stacks, 0),
            int(p.duration_rounds, 0),
            n(p.attack_ratio, 0),
            int(poison.max_stacks, 10),
            action.actionStats.attack,
          );
          action.actualDebuffApplied ||= added > 0;
          if (added === 0) mark(runtime, rule);
          break;
        }
        for (let segment = 0; segment < int(p.segments, 0); segment++) {
          if (!runtime.active || source.hp <= 0 || target.hp <= 0) break;
          dealDamage(runtime, source, target, n(p.attack_ratio, 0), {
            sourceEffect: rule,
            kind: 'derived',
            canCrit: false,
            resonanceEffectId: rule.id,
          });
        }
        break;
      }
      default:
        break;
    }
    if (!runtime.active || source.hp <= 0 || target.hp <= 0) return;
  }
}

function cauldronGrowth(fighter: Fighter): { count: number; multiplier: number } {
  if (fighter.side !== 'player') return { count: 0, multiplier: 1 };
  const cauldron = fighter.artifacts.find(artifact => artifact.entity.id === DEVOURING_ARTIFACT_ID);
  if (!cauldron) return { count: 0, multiplier: 1 };
  const count = cauldron.devoured ?? 0;
  const rule = artifactDevourRule((fighter as AnyMap).__content as Content);
  return { count, multiplier: devouredDamageMultiplier(rule, count) };
}

function damageAmounts(hp: number, shield: number, amount: number, trueAmount: number): {
  regularAbsorbed: number;
  regularHpDamage: number;
  trueAbsorbed: number;
  trueHpDamage: number;
} {
  const regularAbsorbed = Math.min(shield, amount);
  const regularHpDamage = Math.min(hp, amount - regularAbsorbed);
  const hpAfterRegular = Math.max(0, hp - regularHpDamage);
  const shieldAfterRegular = Math.max(0, shield - regularAbsorbed);
  const trueAbsorbed = trueAmount > 0 && hpAfterRegular > 0
    ? Math.min(shieldAfterRegular, trueAmount)
    : 0;
  const trueHpDamage = trueAmount > 0 && hpAfterRegular > 0
    ? Math.min(hpAfterRegular, trueAmount - trueAbsorbed)
    : 0;
  return { regularAbsorbed, regularHpDamage, trueAbsorbed, trueHpDamage };
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
    echoScale?: boolean;
    rawOverride?: number;
    base?: boolean;
    followup?: boolean;
    round?: number;
    criticalBonusRatio?: number;
    resonanceEffectId?: string;
    rawIsResolved?: boolean;
    outputCopy?: boolean;
    devourScaled?: boolean;
    devourBaselineRaw?: number;
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
  const blindSwordOwner = source.loadout.permanentRule?.kind === 'blind_sword';
  const blindSwordSuppressesCrit = blindSwordOwner &&
    (options.kind === 'direct' || options.kind === 'derived');
  const blindSwordConversion = blindSwordOwner &&
    action?.actor === source && (action.type === 'basic_action' || action.type === 'rage_action') &&
    (options.kind === 'direct' || options.kind === 'derived');
  const convertedCritChance = blindSwordConversion ? clamp(stats.crit_rate, 0, 1) : 0;
  let raw = options.rawOverride ?? stats.attack * ratio;
  let critical = false;
  if (!options.rawIsResolved) {
    if (!blindSwordSuppressesCrit && options.canCrit && options.kind !== 'dot' && options.kind !== 'reflect') {
      const chance = clamp(stats.crit_rate, 0, 1);
      critical = runtime.random() < chance;
      if (critical) raw *= n(rules(runtime.content).combat?.crit_multiplier, 1.5);
    }
    if (options.criticalBonusRatio) raw += stats.attack * options.criticalBonusRatio;
    if (options.echoScale !== false && action?.isEcho && action.actor === source) {
      raw *= n(action.powerScale, 0.45);
    }
    raw *= outgoingBuildMultiplier(runtime, source, target, action, options.kind) *
      gambitDamageMultiplier(source, options.kind);
    if (options.kind === 'direct') {
      for (const core of source.coreRules) {
        if (core.kind !== 'healing_guard') continue;
        raw *= n(core.params.direct_damage_ratio, 1);
        mark(runtime, core.effect, 1, source.side);
      }
    }
  }
  const growth = options.kind === 'direct' || options.kind === 'derived' ||
    options.kind === 'dot' || options.kind === 'reflect'
    ? cauldronGrowth(source)
    : { count: 0, multiplier: 1 };
  const devourBaselineRaw = options.devourScaled === true
    ? options.devourBaselineRaw ?? raw / growth.multiplier
    : raw;
  const devourApplied = growth.count > 0 && growth.multiplier > 1 &&
    (options.devourScaled === true || raw > 0);
  if (devourApplied && options.devourScaled !== true) raw *= growth.multiplier;

  if ((options.kind !== 'dot') && raw > 0 &&
      (!options.outputCopy || isFirstMirrorOutput(runtime, sourceEffect))) {
    resolveArtifactOutputCopies(runtime, sourceEffect, target, (copy, mode) => {
      dealDamage(runtime, source, target, 0, {
        sourceEffect: copy,
        kind: options.kind,
        canCrit: false,
        rawOverride: raw,
        rawIsResolved: true,
        outputCopy: true,
        ...(devourApplied ? { devourScaled: true, devourBaselineRaw } : {}),
      });
      void mode;
    }, 'mirror');
  }
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

  const multiplier = options.kind === 'dot' ? 1 : incomingMultiplier(runtime, target, source, options.kind);
  let amount = raw * multiplier;
  let baselineAmount = devourApplied ? devourBaselineRaw * multiplier : amount;
  let trueAmount = blindSwordConversion ? raw * 3 * convertedCritChance * multiplier : 0;
  let baselineTrueAmount = devourApplied
    ? blindSwordConversion ? devourBaselineRaw * 3 * convertedCritChance * multiplier : 0
    : trueAmount;
  if (options.kind !== 'dot' && options.kind !== 'reflect') {
    const defenseConstant = n(rules(runtime.content).combat?.direct_defense_constant, 100);
    const defenseFactor = defenseConstant / (defenseConstant + targetDefense(runtime, target, source, action));
    amount *= defenseFactor;
    baselineAmount *= defenseFactor;
  }
  amount = Math.max(0, amount);
  trueAmount = Math.max(0, trueAmount);
  baselineAmount = Math.max(0, baselineAmount);
  baselineTrueAmount = Math.max(0, baselineTrueAmount);
  const beforeHp = target.hp;
  const beforeShield = target.shield;
  const applied = damageAmounts(beforeHp, beforeShield, amount, trueAmount);
  const baseline = damageAmounts(beforeHp, beforeShield, baselineAmount, baselineTrueAmount);
  const { regularAbsorbed, regularHpDamage, trueAbsorbed, trueHpDamage } = applied;
  target.shield = Math.max(0, beforeShield - regularAbsorbed - trueAbsorbed);
  target.hp = Math.max(0, beforeHp - regularHpDamage - trueHpDamage);
  const regularDamage = regularAbsorbed + regularHpDamage;
  const convertedDamage = trueAbsorbed + trueHpDamage;
  amount += trueAmount;
  const absorbed = regularAbsorbed + trueAbsorbed;
  const hpDamage = regularHpDamage + trueHpDamage;
  const effective = absorbed > 0 || hpDamage > 0;
  const shieldBroken = beforeShield > 0 && target.shield <= 0 && absorbed > 0;
  const baselineRegularDamage = baseline.regularAbsorbed + baseline.regularHpDamage;
  const baselineConvertedDamage = baseline.trueAbsorbed + baseline.trueHpDamage;
  const cauldronBonus = devourApplied
    ? Math.max(0, regularDamage + convertedDamage - baselineRegularDamage - baselineConvertedDamage)
    : 0;
  const regularGrowth = Math.max(0, regularDamage - baselineRegularDamage);
  const convertedGrowth = Math.max(0, convertedDamage - baselineConvertedDamage);
  const growthParts = regularGrowth + convertedGrowth;
  const regularGrowthShare = growthParts > 0 ? cauldronBonus * regularGrowth / growthParts : 0;
  const convertedGrowthShare = cauldronBonus - regularGrowthShare;
  const regularSourceDamage = Math.max(0, regularDamage - regularGrowthShare);
  const convertedSourceDamage = Math.max(0, convertedDamage - convertedGrowthShare);
  if (typeof sourceEffect !== 'string') {
    mark(runtime, sourceEffect, 1, source.side);
    addContribution(runtime, sourceEffect, 'damage', regularSourceDamage, source.side);
  } else {
    addContribution(runtime, sourceEffect, 'damage', regularSourceDamage, source.side);
  }
  if (convertedSourceDamage > 0) {
    mark(runtime, 'RE037-B', 1, source.side);
    addContribution(runtime, 'RE037-B', 'damage', convertedSourceDamage, source.side);
  }
  if (cauldronBonus > 0) {
    mark(runtime, DEVOURING_ARTIFACT_ID, 1, source.side);
    addContribution(runtime, DEVOURING_ARTIFACT_ID, 'damage', cauldronBonus, source.side);
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
  const frameSource = typeof sourceEffect === 'string'
    ? sourceEffect
    : action?.isEcho && action.actor === source
      ? `${sourceEffect.id}-RAGE-ECHO`
      : sourceEffect.id;
  frame(runtime, options.kind === 'dot' ? 'dot' : 'damage', `${sideText}造成${kindText} ${Math.round(regularDamage)}`, source.side, target.side, frameSource, regularDamage);
  if (convertedDamage > 0) {
    frame(runtime, 'damage', `${sideText}造成真实伤害 ${Math.round(convertedDamage)}`, source.side, target.side, 'RE037-B', convertedDamage);
  }
  if (target.trial?.kind === 'tidal_charge' && source.side !== target.side &&
      (options.kind === 'direct' || options.kind === 'derived') && effective &&
      (target.trialCharges ?? 0) > 0) {
    target.trialCharges = Math.max(0, (target.trialCharges ?? 0) - 1);
    frame(
      runtime,
      'status',
      `${target.loadout.name}潮汐蓄势被打断`,
      source.side,
      target.side,
      frameSource,
      1,
      {
        kind: 'enemy_charge',
        owner: target.side,
        sourceId: target.loadout.encounterId ?? '',
      },
    );
  }
  if (options.kind === 'reflect' && effective) {
    triggerReboundGuard(runtime, source, target, action);
  }
  if (action && source === action.actor && target === action.target &&
      (options.kind === 'direct' || options.kind === 'derived') && effective) {
      action.enemyActualHpDamage += hpDamage;
      action.actualHpDamage += hpDamage;
      action.actualAbsorbed += absorbed;
      if (action.isMainAction && !action.isEcho && !options.outputCopy) {
        action.unmirroredMainHpDamage += hpDamage;
      }
      if (options.kind === 'direct') registerIncomingDirectRage(runtime, target);
  }
  if (effective && action?.actor === source && action.target === target &&
      (options.kind === 'direct' || options.kind === 'derived')) {
    recordCombatEvent(runtime, 'hit', source);
  }
  if (action && action.actor === source && action.target === target &&
      action.isMainAction && !action.isEcho && options.kind === 'direct') {
    action.directShieldAbsorbed = n(action.directShieldAbsorbed, 0) + absorbed;
    action.directShieldBroken ||= shieldBroken;
  }
  if (effective && (options.kind === 'direct' || options.kind === 'derived')) {
    for (const mechanic of mechanicsOf(source, 'hit_rage')) {
      const effect = buildEffect(source, mechanic);
      const amount = n(mechanic.params.amount, 0);
      if (effect && amount > 0) registerRage(runtime, source, amount, effect.id, effect.ownerId);
    }
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
    if (!action.isEcho) triggerDirectCrit(runtime, source, target, action, options.base === true || options.followup === true);
  }
  if (shieldBroken && target.hp > 0) {
    if (options.kind === 'direct' && !options.outputCopy) triggerShieldBreak(runtime, target, source, action);
  }
  if (absorbed > 0 && target.hp > 0 && action && source.side !== target.side && options.kind === 'direct') {
    triggerShieldAbsorbed(runtime, target, source, action, absorbed);
  }
  if (effective && options.kind === 'direct' && source.side !== target.side && target.hp > 0) {
    applyCarapace(runtime, target, source, action);
  }
  if (options.kind === 'direct' && source.side !== target.side && action?.isMainAction && !action.isEcho) {
    addGuardPressure(runtime, target, action, absorbed);
  }
  if (effective) {
    if (!options.outputCopy) {
      triggerOutgoingResonances(
        runtime,
        source,
        target,
        action,
        sourceEffect,
        options.kind,
        effective,
        options.resonanceEffectId,
      );
    }
  }
  if (hpDamage > 0 && typeof sourceEffect !== 'string' && sourceEffect.ownerKind === 'artifact' &&
      sourceEffect.ownerSide === source.side) {
    const sourceArtifact = source.artifacts.find(artifact => artifact.entity.id === sourceEffect.ownerId);
    if (sourceArtifact?.inscription === 'leech' && source.side !== target.side && source.hp > 0) {
      const leechAction = action?.actor === source ? action : syntheticAction(runtime, source, target);
      resolveHeal(runtime, leechAction, hpDamage * 0.15, sourceEffect);
    }
  }
  if ((options.kind !== 'dot') && (!options.outputCopy || isFirstMirrorOutput(runtime, sourceEffect)) &&
      raw > 0 && typeof sourceEffect !== 'string') {
    resolveArtifactOutputCopies(runtime, sourceEffect, target, (copy, mode) => {
      dealDamage(runtime, source, target, 0, {
        sourceEffect: copy,
        kind: options.kind,
        canCrit: false,
        rawOverride: raw,
        rawIsResolved: true,
        outputCopy: true,
        ...(devourApplied ? { devourScaled: true, devourBaselineRaw } : {}),
      });
      void mode;
    }, 'inscription');
  }
  if (target.hp <= 0) runtime.active = false;
  return { raw, amount, absorbed, hpDamage, critical, effective, shieldBroken };
}

function registerRage(runtime: BattleRuntime, fighter: Fighter, amount: number, sourceId: string, sourceOwner: string): void {
  if (amount <= 0 || fighter.hp <= 0) return;
  const source = selectedEffect(fighter, sourceId) ?? selectedEffect(fighter, sourceOwner);
  const artifact = fighter.artifacts.find(candidate => candidate.entity.id === sourceOwner);
  const artifactSource = source?.ownerKind === 'artifact' && source.ownerId === sourceOwner
    ? source
    : artifact
      ? {
        id: sourceId,
        trigger: 'rage_gain',
        operation: 'rage_gain',
        params: {},
        ownerId: artifact.entity.id,
        ownerName: artifact.entity.name,
        ownerKind: 'artifact' as SourceKind,
        ownerSide: fighter.side,
        stacks: artifact.stacks,
      }
      : undefined;
  if (artifactSource) {
    resolveArtifactOutputCopies(runtime, artifactSource, fighter, (copy, mode) => {
      registerRage(runtime, fighter, amount, copy.id, copy.ownerId);
      frame(
        runtime,
        'rage',
        `${fighter.side === 'player' ? '玩家' : '敌人'}${mode === 'mirror' ? '镜映' : mode === 'twin' ? '双生铭刻' : '极速铭刻'}回怒 ${Math.round(amount)}`,
        fighter.side,
        fighter.side,
        copy.id,
        amount,
      );
    }, 'mirror');
  }
  fighter.pendingGains.push({ amount, sourceId, sourceOwner, isEcho: runtime.currentAction?.isEcho === true });
  addContribution(runtime, sourceOwner, 'rage', amount, fighter.side);
  recordCombatEvent(runtime, 'rage', fighter);
  if (source) mark(runtime, source, 1, fighter.side);
  if (artifactSource) {
    resolveArtifactOutputCopies(runtime, artifactSource, fighter, (copy, mode) => {
      registerRage(runtime, fighter, amount, copy.id, copy.ownerId);
      frame(
        runtime,
        'rage',
        `${fighter.side === 'player' ? '玩家' : '敌人'}${mode === 'mirror' ? '镜映' : mode === 'twin' ? '双生铭刻' : '极速铭刻'}回怒 ${Math.round(amount)}`,
        fighter.side,
        fighter.side,
        copy.id,
        amount,
      );
    }, 'inscription');
  }
}

function recordCombatEvent(runtime: BattleRuntime, event: CompanionTrigger, owner?: Fighter): void {
  const action = runtime.currentAction;
  if (!action?.isMainAction || action.isEcho || action.isReaction || !action.combatEvents ||
      (owner && action.actor !== owner)) return;
  action.combatEvents.add(event);
}

function requestDrain(runtime: BattleRuntime, target: Fighter, amount: number, sourceId: string, sourceOwner: string, opening = false): void {
  if (amount <= 0) return;
  const sourceFighter = other(runtime, target);
  const source = selectedEffect(sourceFighter, sourceId) ??
    selectedEffect(sourceFighter, sourceOwner) ??
    selectedEffect(target, sourceId) ??
    selectedEffect(target, sourceOwner);
  const artifact = sourceFighter.artifacts.find(candidate => candidate.entity.id === sourceOwner);
  let artifactSource: ActiveEffect | undefined;
  if (artifact) {
    artifactSource = source?.ownerKind === 'artifact' && source.ownerId === sourceOwner
      ? source
      : {
        id: sourceId,
        trigger: 'rage_drain',
        operation: 'rage_drain',
        params: {},
        ownerId: artifact.entity.id,
        ownerName: artifact.entity.name,
        ownerKind: 'artifact' as SourceKind,
        ownerSide: sourceFighter.side,
        stacks: artifact.stacks,
      };
    resolveArtifactOutputCopies(runtime, artifactSource, target, (copy, _mode) => {
      requestDrain(runtime, target, amount, copy.id, copy.ownerId, opening);
    }, 'mirror');
  }
  const map = opening ? runtime.openingDrainRequested : runtime.roundDrainRequested;
  map.set(target.side, (map.get(target.side) ?? 0) + amount);
  target.pendingDrains.push({ amount, sourceId, sourceOwner, opening });
  addContribution(runtime, sourceOwner, 'rage', -amount, sourceFighter.side);
  if (source) mark(runtime, source, 1, sourceFighter.side);
  if (artifactSource) {
    resolveArtifactOutputCopies(runtime, artifactSource, target, (copy, _mode) => {
      requestDrain(runtime, target, amount, copy.id, copy.ownerId, opening);
    }, 'inscription');
  }
}

function addShield(
  runtime: BattleRuntime,
  fighter: Fighter,
  amount: number,
  source: ActiveEffect | string,
  text: string,
  additionalBonus = 0,
  scaleForEcho = true,
  outputCopy = false,
): number {
  if (amount <= 0 || fighter.hp <= 0) return 0;
  let input = amount;
  const action = runtime.currentAction;
  if (!outputCopy && scaleForEcho && action?.isEcho && action.actor === fighter) {
    input *= n(action.powerScale, 0.45);
  }
  let shieldBonus = additionalBonus;
  if (!outputCopy) {
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
  }
  input *= 1 + shieldBonus;
  const capacity = fighter.loadout.permanentRule?.kind === 'shattered_core'
    ? fighter.maxShield
    : fighter.stats.max_hp;
  const plannedGain = Math.max(0, Math.min(input, capacity - fighter.shield));
  if ((!outputCopy || isFirstMirrorOutput(runtime, source)) && plannedGain > 0) {
    resolveArtifactOutputCopies(runtime, source, fighter, (copy, mode) => {
      const label = mode === 'mirror' ? '镜映护盾' : mode === 'twin' ? '双生铭刻护盾' : '极速铭刻护盾';
      addShield(runtime, fighter, plannedGain, copy, label, 0, false, true);
    }, 'mirror');
  }
  if (fighter.hp <= 0) return 0;
  const gained = Math.max(0, Math.min(input, capacity - fighter.shield));
  fighter.shield += gained;
  if (gained > 0 && action?.actor === fighter) recordCombatEvent(runtime, 'shield', fighter);
  if (typeof source !== 'string') {
    mark(runtime, source, 1, fighter.side);
    addContribution(runtime, source, 'shield', gained, fighter.side);
  } else addContribution(runtime, source, 'shield', gained, fighter.side);
  const frameSource = typeof source === 'string'
    ? source
    : action?.isEcho && action.actor === fighter
      ? `${source.id}-RAGE-ECHO`
      : source.id;
  frame(runtime, 'shield', `${fighter.side === 'player' ? '玩家' : '敌人'}${text} ${Math.round(gained)}`, fighter.side, fighter.side, frameSource, gained);
  if ((!outputCopy || isFirstMirrorOutput(runtime, source)) && gained > 0) {
    resolveArtifactOutputCopies(runtime, source, fighter, (copy, mode) => {
      const label = mode === 'mirror' ? '镜映护盾' : mode === 'twin' ? '双生铭刻护盾' : '极速铭刻护盾';
      addShield(runtime, fighter, gained, copy, label, 0, false, true);
    }, 'inscription');
  }
  return gained;
}

function removeStatusLayers(fighter: Fighter, status: StatusName, count: number): number {
  const layers = getStatusLayers(fighter, status);
  const consumed = Math.min(count, layers.length);
  layers.splice(0, consumed);
  return consumed;
}

function removeStatusLayersByIdentity(
  fighter: Fighter,
  status: StatusName,
  selected: Set<StatusLayer>,
): StatusLayer[] {
  const layers = getStatusLayers(fighter, status);
  const removed: StatusLayer[] = [];
  for (let index = layers.length - 1; index >= 0; index--) {
    if (!selected.has(layers[index])) continue;
    removed.unshift(...layers.splice(index, 1));
  }
  return removed;
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
  scaleForEcho = true,
  deferArtifactEcho = false,
  outputCopy = false,
): number {
  const cap = maxStacks ?? n(rules(runtime.content).statuses?.[status]?.max_stacks, status === 'sword_intent' ? 5 : 1);
  const layers = getStatusLayers(target, status);
  const beforeCount = layers.length;
  const isEchoSource = runtime.currentAction?.isEcho &&
    sourceTargetSide(runtime, source) === runtime.currentAction.actor.side;
  const echo = isEchoSource && scaleForEcho
    ? n(runtime.currentAction?.powerScale, 0.45)
    : 1;
  const effectiveCount = count > 0 && echo < 1 ? Math.max(1, Math.round(count * echo)) : count;
  const effectiveDuration = duration > 0 && echo < 1 ? Math.max(1, Math.round(duration * echo)) : duration;
  const plannedAdded = Math.min(Math.max(0, effectiveCount), Math.max(0, cap - layers.length));
  let copiedAdded = 0;
  if (plannedAdded > 0 && !outputCopy && !deferArtifactEcho) {
    const copyDot = dot ? { ...dot } : undefined;
    resolveArtifactOutputCopies(runtime, source, target, (copy, mode) => {
      copiedAdded += addRegularStatus(
        runtime,
        target,
        status,
        plannedAdded,
        Math.max(1, effectiveDuration),
        copy,
        copyDot ? { ...copyDot, ownerId: copy.ownerId } : undefined,
        cap,
        false,
        false,
        true,
      );
      void mode;
    }, 'mirror');
  }
  const added = Math.min(Math.max(0, effectiveCount), Math.max(0, cap - layers.length));
  for (let i = 0; i < added; i++) {
    layers.push({
      remaining: Math.max(1, effectiveDuration),
      ...(dot ? {
        damage: dot.damage,
        attackRatio: dot.attackRatio,
        ownerId: dot.ownerId,
        ownerSide: sourceTargetSide(runtime, source),
        kind: 'dot' as const,
      } : { kind: 'regular' as const }),
      sourceId: typeof source === 'string' ? source : isEchoSource ? `${source.id}-RAGE-ECHO` : source.id,
    });
  }
  if (added > 0) {
    if (typeof source !== 'string') mark(runtime, source);
    const action = runtime.currentAction;
    const frameSource = typeof source === 'string'
      ? source
      : isEchoSource
        ? `${source.id}-RAGE-ECHO`
        : source.id;
    frame(runtime, 'status', `${target.side === 'player' ? '玩家' : '敌人'}获得${status}${added}层`, sourceTargetSide(runtime, source), target.side, frameSource, added);
    if ((status === 'weakness' || status === 'armor_break') && action?.target === target &&
        sourceTargetSide(runtime, source) === action.actor.side) recordCombatEvent(runtime, 'debuff', action.actor);
    if ((!outputCopy && !deferArtifactEcho) || isFirstMirrorOutput(runtime, source)) {
      const emittedLayers = layers.slice(beforeCount, beforeCount + added).map(layer => ({ ...layer }));
      resolveArtifactOutputCopies(runtime, source, target, (copy, mode) => {
        const firstLayer = emittedLayers[0];
        const copyDot = firstLayer?.kind === 'dot'
          ? {
            damage: n(firstLayer.damage, 0),
            attackRatio: n(firstLayer.attackRatio, 0),
            ownerId: copy.ownerId,
          }
          : undefined;
        void mode;
        addRegularStatus(
          runtime,
          target,
          status,
          emittedLayers.length,
          Math.max(1, int(firstLayer?.remaining, effectiveDuration)),
          copy,
          copyDot,
          cap,
          false,
          false,
          true,
        );
      }, 'inscription');
    }
  }
  return added + copiedAdded;
}

function sourceTargetSide(runtime: BattleRuntime, source: ActiveEffect | string): 'player' | 'enemy' | undefined {
  if (typeof source !== 'string' && source.ownerSide) return source.ownerSide;
  if (typeof source !== 'string') return source.ownerId === runtime.player.method.id || runtime.player.talents.some(x => x.id === source.ownerId) || runtime.player.artifacts.some(x => x.entity.id === source.ownerId) ? 'player' : 'enemy';
  return undefined;
}

function triggerShieldBreak(runtime: BattleRuntime, target: Fighter, source: Fighter, action: ActionContext | null): void {
  if (!action || target.hp <= 0 || source.side === target.side) return;
  if (action.type !== 'basic_action' && action.type !== 'rage_action') return;
  const methodEffect = selectedEffect(target, 'RKF01-J3-B-RECHARGE');
  if (target.method.id === 'RKF01' && methodEffect && !target.battleFlags.has(methodEffect.id)) {
    target.battleFlags.add(methodEffect.id);
    addShield(runtime, target, target.stats.max_hp * n(methodEffect.params?.max_hp_ratio, 0.24), methodEffect, '破盾后续护');
    frame(runtime, 'status', `${target.side === 'player' ? '玩家' : '敌人'}首次破盾后续护`, target.side, target.side, methodEffect.id);
  }
  const awakening = selectedEffect(target, 'RC11-AWAKENING-SHIELD');
  const battleFlag = 'RC11-AWAKENING-SHIELD';
  if (awakening && !target.battleFlags.has(battleFlag)) {
    target.battleFlags.add(battleFlag);
    addShield(runtime, target, target.stats.max_hp * n(awakening.params?.max_hp_ratio, 0.06), awakening, '铁壁符觉醒续护');
  }
  const genuineEnemyMainBreak = action.isMainAction && !action.isEcho && !action.isReaction &&
    action.actor === source && action.target === target;
  const rr02 = genuineEnemyMainBreak
    ? selectedEffect(target, 'RR02-ENEMY-SHIELD-BREAK-HEAL')
    : undefined;
  if (rr02 && !target.battleFlags.has(rr02.id)) {
    target.battleFlags.add(rr02.id);
    withAuxiliaryAction(runtime, target, source, response => {
      response.rr02SelfHealConversion = true;
      frame(runtime, 'status', `${target.loadout.name}甘露盏真破回春`, target.side, target.side, rr02.id);
      resolveHeal(runtime, response, target.stats.max_hp * n(rr02.params?.max_hp_ratio, 0), rr02);
    });
  }
}

function triggerShieldAbsorbed(runtime: BattleRuntime, target: Fighter, source: Fighter, action: ActionContext, absorbed: number): void {
  if (!action.isMainAction || action.isEcho || target.hp <= 0 || source.side === target.side) return;
  if (target.method.id === 'RKF01' && !action.recoilDone) {
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
    const bonus = selectedEffect(target, 'RKF01-J3-A-RECOIL');
    if (bonus) {
      raw *= 1 + n(bonus.params?.damage_ratio_add, 0.28);
      mark(runtime, bonus);
    }
    const hit = dealDamage(runtime, target, source, 0, {
      sourceEffect: effect,
      kind: 'reflect',
      canCrit: false,
      rawOverride: raw,
    });
    if (hit.effective) action.reflectDamage += hit.hpDamage + hit.absorbed;
    const armor = selectedEffect(target, 'RKF01-J4-C-ARMOR-BREAK');
    if (armor && hit.effective && source.hp > 0) {
      const added = addRegularStatus(runtime, source, 'armor_break', int(armor.params?.stacks, 1), int(armor.params?.duration_rounds, 2), armor, undefined, int(armor.params?.max_stacks, 5));
      if (added > 0) mark(runtime, armor);
    }
  }
  const retort = resonanceRule(target, 'shield_retort');
  if (retort) {
    const onceKey = `${retort.id}:${action.round}:${action.actor.actionNumber}`;
    if (!target.battleFlags.has(onceKey)) {
      target.battleFlags.add(onceKey);
      const stacks = target.artifacts.find(artifact => artifact.entity.id === retort.ownerId)?.stacks ?? 0;
      const raw = targetDefense(runtime, target, source, null) *
        n(retort.params.defense_ratio, 0) * stacks;
      const hit = dealDamage(runtime, target, source, 0, {
        sourceEffect: retort,
        kind: 'reflect',
        canCrit: false,
        rawOverride: raw,
        resonanceEffectId: retort.id,
      });
      if (hit.effective) action.reflectDamage += hit.hpDamage + hit.absorbed;
    }
  }
}

function triggerDirectCrit(runtime: BattleRuntime, source: Fighter, target: Fighter, action: ActionContext, baseOrFollowup: boolean): void {
  const rr10 = selectedEffect(source, 'RR10-DIRECT-CRIT-RAGE');
  if (rr10 && action.isMainAction && !action.isEcho && action.actor === source &&
      action.rr10CritCount < int(rr10.params?.per_action_cap, 2)) {
    action.rr10CritCount += 1;
    registerRage(
      runtime,
      source,
      n(rr10.params?.amount, 0) * rr10.stacks,
      rr10.id,
      rr10.ownerId,
    );
    if (action.rr10CritCount === int(rr10.params?.lightning_on_crit, 2) &&
        runtime.active && source.hp > 0 && target.hp > 0) {
      frame(runtime, 'status', `${source.loadout.name}引雷针第二次直接暴击引雷`, source.side, target.side, rr10.id);
      dealDamage(runtime, source, target, n(rr10.params?.lightning_attack_ratio, 0), {
        sourceEffect: rr10,
        kind: 'derived',
        canCrit: false,
        followup: true,
      });
    }
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

function triggerReboundGuard(
  runtime: BattleRuntime,
  reflector: Fighter,
  hostileTarget: Fighter,
  action: ActionContext | null,
): void {
  if (!action || !action.isMainAction || action.isEcho ||
      action.actor !== hostileTarget || action.target !== reflector ||
      reflector.hp <= 0 || hostileTarget.side === reflector.side) return;
  const rule = resonanceRule(reflector, 'rebound_guard');
  if (!rule) return;
  const onceKey = `${rule.id}:${action.round}:${action.actor.actionNumber}`;
  if (reflector.battleFlags.has(onceKey)) return;
  reflector.battleFlags.add(onceKey);
  const defense = targetDefense(runtime, reflector, hostileTarget, null);
  addShield(runtime, reflector, defense * n(rule.params.defense_ratio, 0), rule, '反震回护');
  registerRage(runtime, reflector, n(rule.params.rage_gain, 0), rule.id, rule.ownerId);
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
  scaleForEcho = true,
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
  const action = runtime.currentAction;
  const echoSource = action?.isEcho && action.actor === owner ? action.echoSource : undefined;
  const echoScale = scaleForEcho && echoSource ? n(action?.powerScale, 0.45) : 1;
  ratio *= echoScale;
  const cap = maxStacks ?? n(rules(runtime.content).statuses?.[status]?.max_stacks, 10);
  const layers = getStatusLayers(target, status);
  const effectiveStacks = stacks > 0 && echoScale < 1
    ? Math.max(1, Math.round(stacks * echoScale))
    : stacks;
  const plannedAdded = Math.min(Math.max(0, effectiveStacks), Math.max(0, cap - layers.length));
  const effectiveDuration = duration > 0 && echoScale < 1
    ? Math.max(1, Math.round(duration * echoScale))
    : duration;
  const awakeningId = status === 'poison'
    ? 'RC14-AWAKENING-POISON-ON-BURN'
    : 'RC15-AWAKENING-BURN-ON-POISON';
  const awakening = selectedEffect(owner, awakeningId);
  const oppositeStatus = status === 'poison' ? 'burn' : 'poison';
  const roundFlag = `${awakeningId}:${runtime.round}`;
  let addedRatio = 0;
  if (plannedAdded > 0 && awakening && hasStatus(target, oppositeStatus) && !owner.battleFlags.has(roundFlag)) {
    owner.battleFlags.add(roundFlag);
    addedRatio = n(awakening.params?.attack_ratio_per_stack_add, 0.04) * echoScale;
    mark(runtime, awakening);
  }
  const finalRatio = ratio + addedRatio;
  const dot = {
    damage: snapshotAttack * finalRatio,
    attackRatio: finalRatio,
    ownerId: echoSource && effect.ownerKind !== 'artifact' ? echoSource.ownerId : effect.ownerId,
  };
  let mirroredAdded = 0;
  if (plannedAdded > 0) {
    resolveArtifactOutputCopies(runtime, effect, target, (copy, mode) => {
      mirroredAdded += addRegularStatus(
        runtime,
        target,
        status,
        plannedAdded,
        effectiveDuration,
        copy,
        { ...dot, ownerId: copy.ownerId },
        cap,
        false,
        false,
        true,
      );
      void mode;
    }, 'mirror');
  }
  const added = addRegularStatus(
    runtime,
    target,
    status,
    stacks,
    duration,
    effect,
    dot,
    maxStacks,
    scaleForEcho,
    true,
  );
  if (added <= 0 && mirroredAdded <= 0) return added;
  recordCombatEvent(runtime, status, owner);
  if (added > 0) {
    const emittedLayers = getStatusLayers(target, status).slice(-added).map(layer => ({ ...layer }));
    resolveArtifactOutputCopies(runtime, effect, target, (copy, mode) => {
      const firstLayer = emittedLayers[0];
      const copyDot = firstLayer ? {
        damage: n(firstLayer.damage, 0),
        attackRatio: n(firstLayer.attackRatio, 0),
        ownerId: copy.ownerId,
      } : undefined;
      addRegularStatus(
        runtime,
        target,
        status,
        emittedLayers.length,
        Math.max(1, int(firstLayer?.remaining, duration)),
        copy,
        copyDot,
        maxStacks,
        false,
        false,
        true,
      );
      void mode;
    }, 'inscription');
  }
  return added + mirroredAdded;
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

function applyCoreBasicDot(runtime: BattleRuntime, action: ActionContext): void {
  const { actor, target } = action;
  if (action.type !== 'basic_action' || action.baseDirectHitCount !== 1) return;
  for (const core of actor.coreRules) {
    const status = core.kind === 'poison_detonation'
      ? 'poison'
      : core.kind === 'burn_siphon' ? 'burn' : undefined;
    if (!status) continue;
    const contentStatus = rules(runtime.content).statuses?.[status] ?? {};
    const stackField = status === 'poison' ? 'poison_stacks' : 'burn_stacks';
    const stacks = effectValueForStatus(runtime, actor, target, action, core.effect, 'stacks', n(core.params[stackField], 0));
    const duration = effectValueForStatus(runtime, actor, target, action, core.effect, 'duration_rounds', int(contentStatus.duration_rounds, 1));
    const ratio = effectValueForStatus(runtime, actor, target, action, core.effect, 'attack_ratio_per_stack', n(contentStatus.attack_ratio_per_stack, 0));
    const maxStacks = effectValueForStatus(runtime, actor, target, action, core.effect, 'max_stacks', int(contentStatus.max_stacks, stacks));
    const added = applyDot(runtime, actor, target, core.effect, status, stacks, duration, ratio, maxStacks, action.actionStats.attack);
    action.actualDebuffApplied ||= added > 0;
  }
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
  applyCoreBasicDot(runtime, action);
  if (id === 'RKF07-BASIC-DAMAGE') resolveChain(runtime, action, actionEffect(actor, 'basic_action', 'RKF07-BASIC-CHAIN'), hit);
  if (id === 'RKF08-BASIC-DAMAGE') resolveDirectHitAdditions(runtime, action, hit, baseEffect);
  else resolveDirectHitAdditions(runtime, action, hit, baseEffect);
}

function resolveDirectHitAdditions(runtime: BattleRuntime, action: ActionContext, hit: HitResult, baseEffect: ActiveEffect): void {
  if (!hit.effective || action.stop || !runtime.active) return;
  if (action.isEcho) return;
  const actor = action.actor;
  const target = action.target;
  const actionType = action.type;
  const firstBase = action.baseDirectHitCount === 1;
  if (actionType === 'basic_action' && firstBase) {
    const awakening = selectedEffect(actor, 'RC09-AWAKENING-ARMOR-BREAK');
    const roundFlag = `RC09-AWAKENING-ARMOR-BREAK:${action.round}`;
    if (awakening && !actor.battleFlags.has(roundFlag)) {
      const added = addRegularStatus(runtime, target, 'armor_break', 1, 2, awakening, undefined, 5);
      if (added > 0) {
        actor.battleFlags.add(roundFlag);
        action.actualDebuffApplied = true;
      }
    }
  }
  if (actionType === 'basic_action' && firstBase) {
    for (const artifact of actor.artifacts) {
      if (artifact.entity.id === 'RR13') {
        requestDrain(runtime, target, 10 * artifact.stacks, 'RR13-FIRST-BASIC-RAGE-DRAIN', artifact.entity.id);
      }
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
  const preexistingPoison = action.targetStartStatusLayers.get('poison')?.length ?? 0;
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
    if (had && !action.reservedChargeLuck && !action.isEcho) removeStatusLayers(actor, 'charge_luck', 1);
    if (runtime.random() >= chance) {
      if (!action.reservedChargeLuck && !action.isEcho) {
        addRegularStatus(runtime, actor, 'charge_luck', 1, int(p.on_fail?.duration_rounds, 2), effect, undefined, 1);
      }
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

function resolveSpringBloom(
  runtime: BattleRuntime,
  action: ActionContext,
  healedAmount: number,
): void {
  const actor = action.actor;
  if (healedAmount <= 0 || action.isEcho) return;
  const rule = resonanceRule(actor, 'spring_bloom');
  if (!rule) return;
  const threshold = actor.stats.max_hp * n(rule.params.threshold_hp_ratio, 0);
  if (threshold <= 0) return;
  const current = resonanceState(actor, rule, 'reservoir');
  const reservoir = Math.min(threshold * 2, current + healedAmount);
  if (reservoir <= current) return;
  setResonanceState(actor, rule, 'reservoir', reservoir);
  mark(runtime, rule);
}

function resolveHeal(
  runtime: BattleRuntime,
  action: ActionContext,
  amount: number,
  source: ActiveEffect,
  allowOverflow = true,
  outputCopy = false,
): { effective: number; overflow: number; totalEffective: number } {
  const fighter = action.actor;
  if (!runtime.active || fighter.hp <= 0 || action.target.hp <= 0) {
    return { effective: 0, overflow: 0, totalEffective: 0 };
  }
  let total = Math.max(0, amount) * (!outputCopy && action.isEcho ? n(action.powerScale, 0.45) : 1);
  let copiedEffective = 0;
  if (!outputCopy) {
    for (const artifact of fighter.artifacts) {
      if (artifact.entity.id === 'RC12') {
        total *= 1 + 0.06 * artifact.stacks;
        const ae = artifact.entity.effects?.[0];
        if (ae) mark(runtime, Object.assign(clone(ae), { ownerId: artifact.entity.id, ownerName: artifact.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: fighter.side, stacks: artifact.stacks }), artifact.stacks);
      }
    }
    for (const mechanic of mechanicsOf(fighter, 'blood_vow')) {
      total *= n(mechanic.params.healing_multiplier, 1);
      const effect = buildEffect(fighter, mechanic);
      if (effect) mark(runtime, effect);
    }
  }
  if ((!outputCopy || isFirstMirrorOutput(runtime, source)) && total > 0) {
    resolveArtifactOutputCopies(runtime, source, fighter, (copy, mode) => {
      const copyAction = syntheticAction(runtime, fighter, other(runtime, fighter));
      copiedEffective += resolveHeal(runtime, copyAction, total, copy, allowOverflow, true).totalEffective;
      void mode;
    }, 'mirror');
  }
  if (!runtime.active || fighter.hp <= 0 || action.target.hp <= 0) {
    return { effective: 0, overflow: 0, totalEffective: copiedEffective };
  }
  const effective = Math.min(total, Math.max(0, fighter.stats.max_hp - fighter.hp));
  const overflow = Math.max(0, total - effective);
  fighter.hp += effective;
  if (effective > 0 && action.actor === fighter) recordCombatEvent(runtime, 'heal', fighter);
  (action as AnyMap).lastEffectiveHeal = effective;
  (action as AnyMap).lastOverflow = overflow;
  mark(runtime, source, 1, fighter.side);
  addContribution(runtime, source, 'healing', effective, fighter.side);
  const cleanse = selectedEffect(fighter, 'RC12-AWAKENING-CLEANSE');
  const cleanseFlag = 'RC12-AWAKENING-CLEANSE';
  if (total > 0 && cleanse && !fighter.battleFlags.has(cleanseFlag)) {
    const status = (['poison', 'burn', 'weakness', 'armor_break'] as StatusName[])
      .find(candidate => hasStatus(fighter, candidate));
    if (status && removeStatusLayers(fighter, status, 1) > 0) {
      fighter.battleFlags.add(cleanseFlag);
      mark(runtime, cleanse, 1, fighter.side);
      frame(runtime, 'status', `${fighter.side === 'player' ? '玩家' : '敌人'}治疗净化${status}1层`, fighter.side, fighter.side, cleanse.id, 1);
    }
  }
  if (effective > 0) {
    const sourceId = action.isEcho && !outputCopy ? `${source.id}-RAGE-ECHO` : source.id;
    frame(runtime, 'heal', `${fighter.side === 'player' ? '玩家' : '敌人'}恢复 ${Math.round(effective)}`, fighter.side, fighter.side, sourceId, effective);
    for (const core of fighter.coreRules) {
      if (core.kind !== 'healing_guard') continue;
      addShield(
        runtime,
        fighter,
        effective * n(core.params.shield_ratio, 0),
        core.effect,
        '有效治疗转盾',
        0,
        false,
      );
    }
    const bladeRule = resonanceRule(fighter, 'healing_blades');
    if (bladeRule && !action.isEcho && (action.isMainAction || action.roundDotSettlement)) {
      const settlement = action.roundDotSettlement
        ? `round-dot:${action.round}`
        : `action:${action.round}:${fighter.actionNumber}`;
      const onceKey = `${bladeRule.id}:${settlement}`;
      if (!fighter.battleFlags.has(onceKey)) {
        fighter.battleFlags.add(onceKey);
        const maximum = int(bladeRule.params.max_charges, 0);
        const current = resonanceState(fighter, bladeRule, 'charges');
        const next = Math.min(maximum, current + 1);
        setResonanceState(fighter, bladeRule, 'charges', next);
        if (next > current) mark(runtime, bladeRule);
      }
    }
    const healRage = selectedEffect(fighter, 'RKF03-J2-C-RAGE');
    if (healRage && action.isMainAction && !fighter.battleFlags.has(actionFlag(action, healRage.id))) {
      fighter.battleFlags.add(actionFlag(action, healRage.id));
      registerRage(runtime, fighter, effective * n(healRage.params?.ratio, 0.25), healRage.id, healRage.ownerId);
    }
    const healShield = selectedEffect(fighter, 'RKF03-J3-C-SHIELD');
    if (healShield) addShield(runtime, fighter, effective * n(healShield.params?.effective_heal_ratio, 0.35), healShield, '有效治疗造盾', 0, false);
    const reduce = selectedEffect(fighter, 'RKF03-J3-B-REDUCE');
    if (reduce) {
      fighter.battleLayers[reduce.id] = runtime.round + Math.max(0, int(reduce.params?.duration_rounds, 1));
      mark(runtime, reduce);
    }
  }
  if (allowOverflow && overflow > 0) {
    const rl01 = fighter.artifacts.find(artifact => artifact.entity.id === 'RL01');
    if (rl01) {
      const ae = rl01.entity.effects?.[0];
      if (ae) addShield(runtime, fighter, overflow * n(ae.params?.ratio, 1) * rl01.stacks, Object.assign(clone(ae), { ownerId: rl01.entity.id, ownerName: rl01.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: fighter.side, stacks: rl01.stacks }), '溢疗转盾', 0, false);
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
          echoScale: false,
        });
      } else if (j2) {
        const stacks = Math.floor(overflow * n(j2.params?.stacks_per_overflow, 0.012));
        const target = other(runtime, fighter);
        applyDot(
          runtime,
          fighter,
          target,
          j2,
          'poison',
          stacks,
          int(j2.params?.duration_rounds, 3),
          0.08,
          int(j2.params?.max_stacks, 10),
          action.actionStats.attack,
          false,
        );
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
          echoScale: false,
        });
      }
    }
  }
  resolveSpringBloom(runtime, action, effective + overflow);
  if ((!outputCopy || isFirstMirrorOutput(runtime, source)) && total > 0) {
    resolveArtifactOutputCopies(runtime, source, fighter, (copy, mode) => {
      const copyAction = syntheticAction(runtime, fighter, other(runtime, fighter));
      copiedEffective += resolveHeal(runtime, copyAction, total, copy, allowOverflow, true).totalEffective;
      void mode;
    }, 'inscription');
  }
  const rr02 = fighter.artifacts.find(artifact => artifact.entity.id === 'RR02');
  const rr02ConversionKey = action.rr02SelfHealConversion
    ? `rr02-shield-break-${action.round}`
    : `rr02-${action.round}-${fighter.actionNumber}`;
  if (rr02 && (action.isMainAction || action.rr02SelfHealConversion) &&
      effective + copiedEffective > 0 && !fighter.battleFlags.has(rr02ConversionKey)) {
    fighter.battleFlags.add(rr02ConversionKey);
    const ae = rr02.entity.effects?.[0];
    if (ae) addShield(runtime, fighter, (effective + copiedEffective) * n(ae.params?.ratio, 0.35) * rr02.stacks, Object.assign(clone(ae), { ownerId: rr02.entity.id, ownerName: rr02.entity.name, ownerKind: 'artifact' as SourceKind, ownerSide: fighter.side, stacks: rr02.stacks }), '有效治疗转盾', 0, false);
  }
  return { effective, overflow, totalEffective: effective + copiedEffective };
}

function syntheticAction(
  runtime: BattleRuntime,
  actor: Fighter,
  target: Fighter,
): ActionContext {
  return {
    actor,
    target,
    type: 'basic_action',
    isMainAction: false,
    round: runtime.round,
    lockedCost: 0,
    actionStats: dynamicStats(runtime, actor, target, null),
    actionStartShield: actor.shield,
    actionStartStatuses: snapshotStatuses(actor),
    actorStartStatusLayers: snapshotStatusLayers(actor),
    targetStartStatusLayers: snapshotStatusLayers(target),
    resonanceLimitUses: new Map(),
    reservedChargeLuck: false,
    chargeLuckAvailableAtStart: false,
    swordIntentAtStart: statusCount(actor, 'sword_intent'),
    consumedSwordIntent: 0,
    consumedBurn: 0,
    consumedShield: 0,
    consumedShieldDamage: 0,
    reservedPressure: 0,
    reservedHealingBlades: 0,
    reservedFurnaceHeat: 0,
    returningBreathSegments: 0,
    returningBreathScale: 1,
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
    unmirroredMainHpDamage: 0,
    reflectDamage: 0,
    phaseBefore: actor.phase,
    phaseChanged: false,
    phaseTransition: null,
    completed: false,
    stop: false,
    isReaction: true,
    dotRageRecorded: false,
    healRageRecorded: false,
  };
}

function withReactionBeat(
  runtime: BattleRuntime,
  owner: Fighter,
  target: Fighter,
  kind: NonNullable<BattleFrame['cue']>['kind'],
  sourceId: string,
  text: string,
  resolve?: (action: ActionContext) => void,
  count?: number,
): void {
  if (owner.hp <= 0 || target.hp <= 0) return;
  const previousAction = runtime.currentAction;
  const previousCue = runtime.activeCue;
  const cue: NonNullable<BattleFrame['cue']> = {
    kind,
    owner: owner.side,
    sourceId,
    ...(count === undefined ? {} : { count }),
  };
  const action = syntheticAction(runtime, owner, target);
  runtime.currentAction = action;
  runtime.activeCue = cue;
  try {
    frame(runtime, 'reaction', text, owner.side, target.side, sourceId, undefined, cue);
    if (resolve && runtime.active && owner.hp > 0 && target.hp > 0) {
      resolve(action);
    }
  } finally {
    runtime.currentAction = previousAction;
    runtime.activeCue = previousCue;
  }
}

function withAuxiliaryAction(
  runtime: BattleRuntime,
  owner: Fighter,
  target: Fighter,
  resolve: (action: ActionContext) => void,
): void {
  if (owner.hp <= 0 || target.hp <= 0) return;
  const previousAction = runtime.currentAction;
  const action = syntheticAction(runtime, owner, target);
  runtime.currentAction = action;
  try {
    if (runtime.active && owner.hp > 0 && target.hp > 0) resolve(action);
  } finally {
    runtime.currentAction = previousAction;
  }
}

function resolveCombatOutput(
  runtime: BattleRuntime,
  action: ActionContext,
  source: ActiveEffect,
  output: AnyMap,
  text: string,
): void {
  const { actor, target } = action;
  const value = n(output.value, 0);
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0 || value <= 0) return;
  switch (output.kind) {
    case 'damage':
      dealDamage(runtime, actor, target, 0, {
        sourceEffect: source,
        kind: 'derived',
        canCrit: false,
        rawOverride: action.actionStats.attack * value,
      });
      break;
    case 'shield':
      addShield(runtime, actor, actor.stats.max_hp * value, source, text, 0, false);
      break;
    case 'heal':
      resolveHeal(runtime, action, actor.stats.max_hp * value, source);
      break;
    case 'rage':
      mark(runtime, source, 1, actor.side);
      registerRage(runtime, actor, value, source.id, source.ownerId);
      frame(runtime, 'rage', `${actor.side === 'player' ? '玩家' : '敌人'}${source.trigger === 'awakening' ? '觉醒' : '协力'}回怒 ${Math.round(value)}`, actor.side, actor.side, source.id, value);
      break;
    case 'poison':
    case 'burn':
      applyDot(runtime, actor, target, source, output.kind, Math.floor(value), 2, 0.05, 10, action.actionStats.attack);
      break;
    default:
      throw new Error(`Unsupported combat output ${String(output.kind)} (${source.id})`);
  }
}

function resolveCompanionAssist(runtime: BattleRuntime, action: ActionContext): void {
  const { actor, target } = action;
  const events = action.combatEvents;
  if (!action.isMainAction || action.isEcho || !action.completed || !events?.size ||
      !runtime.active || actor.hp <= 0 || target.hp <= 0 || actor.companions.length === 0) return;

  for (const companion of actor.companions) {
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
    const config = companion.method.companion;
    const source = companionSource(actor, companion);
    const pair = (config.pair_bonuses ?? []).find((bonus: AnyMap) =>
      bonus.with === actor.method.id && events.has(bonus.trigger));
    const usesAlternateEffect = !pair && companion.usesAlternateEffect && Boolean(config.alternate_effect);
    const output = pair?.effect ?? (events.has(config.trigger)
      ? (usesAlternateEffect ? config.alternate_effect : config.effect)
      : undefined);
    if (!output) continue;
    const trigger = pair?.trigger ?? config.trigger;
    const display = pair
      ? `${config.name}与${actor.method.name}合练`
      : config.name;
    withReactionBeat(
      runtime,
      actor,
      target,
      'companion_assist',
      source.ownerId,
      `${actor.side === 'player' ? '玩家' : '敌人'}伴生协力：${display}（${trigger}）`,
      reaction => resolveCombatOutput(runtime, reaction, source, output, '伴生护盾'),
    );
    if (!pair && config.alternate_effect) {
      companion.usesAlternateEffect = !companion.usesAlternateEffect;
    }
  }
}

function artifactAwakeningMatchesAction(artifact: ArtifactRuntime, action: ActionContext): boolean {
  const awakening = artifact.entity.awakening;
  if (!Array.isArray(awakening?.effects) || awakening.effects.length === 0 ||
      artifact.stacks < int(awakening.at_stacks, artifact.entity.max_stacks) ||
      artifact.stacks < int(artifact.entity.max_stacks, 1)) return false;
  const trigger = awakening.trigger ?? 'either';
  return trigger === 'either' || trigger === (action.type === 'basic_action' ? 'basic' : 'rage');
}

function resolveArtifactAwakeningOutputs(
  runtime: BattleRuntime,
  action: ActionContext,
  awakening: AnyMap,
  sourceArtifact: ArtifactRuntime,
): void {
  const { actor, target } = action;
  for (const [index, output] of awakening.effects.entries()) {
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
    const source: ActiveEffect = {
      id: `${sourceArtifact.entity.id}-AWAKENING-${index + 1}`,
      trigger: 'awakening',
      operation: 'combat_output',
      params: output,
      ownerId: sourceArtifact.entity.id,
      ownerName: sourceArtifact.entity.name,
      ownerKind: 'artifact',
      ownerSide: actor.side,
      stacks: 1,
    };
    withAuxiliaryAction(runtime, actor, target, reaction => {
      const sideName = actor.side === 'player' ? '玩家' : '敌人';
      frame(runtime, 'status', `${sideName}法宝觉醒：${awakening.name}`, actor.side, actor.side, source.id);
      resolveCombatOutput(runtime, reaction, source, output, '觉醒护盾');
    });
  }
}

function resolveArtifactAwakenings(runtime: BattleRuntime, action: ActionContext): void {
  const { actor, target } = action;
  if (!runtime.artifactAwakenings || !action.isMainAction || action.isEcho || !action.completed ||
      !runtime.active || actor.hp <= 0 || target.hp <= 0) return;
  // validateLoadout keeps this array in Loadout.artifacts order, which is also
  // the resolution order for awakenings sharing this completed main action.
  for (let index = 0; index < actor.artifacts.length; index++) {
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
    const artifact = actor.artifacts[index];
    if (artifactAwakeningMatchesAction(artifact, action)) {
      resolveArtifactAwakeningOutputs(runtime, action, artifact.entity.awakening, artifact);
    }
  }
}

function trialSource(owner: Fighter): ActiveEffect {
  const id = owner.loadout.encounterId ?? '';
  return {
    id,
    trigger: 'core_rule',
    operation: 'core_rule',
    params: {},
    ownerId: id,
    ownerName: owner.loadout.name,
    ownerKind: 'method',
    ownerSide: owner.side,
    stacks: 1,
  };
}

function emitEnemyTrialCharge(runtime: BattleRuntime, owner: Fighter): void {
  if (!owner.trial) return;
  const label = owner.trial.kind === 'tidal_charge' ? '潮汐蓄势' : '回雾蓄势';
  withReactionBeat(
    runtime,
    owner,
    owner,
    'enemy_charge',
    owner.loadout.encounterId ?? '',
    `${owner.loadout.name}${label} ${owner.trialCharges ?? 0}/${owner.trial.charges}`,
  );
}

function prepareEnemyTrialRound(runtime: BattleRuntime): void {
  for (const fighter of [runtime.player, runtime.enemy]) {
    if (!fighter.trial) continue;
    fighter.trialCountdown = fighter.trial.period -
      ((runtime.round - 1) % fighter.trial.period);
  }
}

function releaseEnemyTrial(runtime: BattleRuntime, owner: Fighter): void {
  const trial = owner.trial;
  if (!trial || runtime.round % trial.period !== 0 || owner.hp <= 0) return;
  const target = other(runtime, owner);
  const charges = Math.max(0, owner.trialCharges ?? 0);
  owner.trialCharges = 0;
  owner.trialCountdown = 0;
  const source = trialSource(owner);
  const brokenText = trial.kind === 'tidal_charge'
    ? `${owner.loadout.name}潮汐准备已被打断，释放落空`
    : `${owner.loadout.name}回雾准备已被打断，未能恢复`;
  const releaseText = trial.kind === 'tidal_charge'
    ? `${owner.loadout.name}释放潮汐 ${charges} 段`
    : `${owner.loadout.name}释放回雾，按剩余蓄势恢复`;
  withReactionBeat(
    runtime,
    owner,
    target,
    'enemy_release',
    source.id,
    charges > 0 ? releaseText : brokenText,
    action => {
      if (charges === 0) return;
      if (trial.kind === 'tidal_charge') {
        for (let segment = 0; segment < charges; segment++) {
          if (!runtime.active || owner.hp <= 0 || target.hp <= 0) break;
          dealDamage(runtime, owner, target, 0, {
            sourceEffect: source,
            kind: 'direct',
            canCrit: false,
            rawOverride: attackStats(runtime, owner, target, action).attack *
              trial.attack_ratio_per_charge,
          });
        }
        return;
      }
      resolveHeal(
        runtime,
        action,
        owner.stats.max_hp * trial.heal_hp_ratio_per_charge * charges,
        source,
      );
    },
  );
  if (owner.hp > 0) {
    owner.trialCharges = trial.charges;
    owner.trialCountdown = trial.period;
    if (runtime.active && target.hp > 0) emitEnemyTrialCharge(runtime, owner);
  }
}

function resolveEnemyTrialReleases(runtime: BattleRuntime): void {
  for (const fighter of [runtime.player, runtime.enemy]) {
    if (!runtime.active) return;
    if (fighter.trial) releaseEnemyTrial(runtime, fighter);
  }
}

function resolveSwordArray(runtime: BattleRuntime, action: ActionContext): void {
  if (!action.isMainAction || action.isEcho || action.type !== 'rage_action') return;
  const actor = action.actor;
  const rule = resonanceRule(actor, 'sword_array');
  if (!rule) return;
  const initial = action.actorStartStatusLayers.get('sword_intent') ?? [];
  const live = initial.filter(layer => getStatusLayers(actor, 'sword_intent').includes(layer));
  if (live.length === 0) return;
  const retention = selectedEffect(actor, 'RKF05-J2-A-RETENTION');
  if (retention) {
    mark(runtime, retention);
    return;
  }
  const replacement = selectedEffect(actor, 'RKF05-J2-B-CONSUME');
  const limit = replacement
    ? int(replacement.params?.max_stacks, 5)
    : int(rule.params.consume_stacks, 0);
  if (limit <= 0) return;
  const consumed = removeStatusLayersByIdentity(actor, 'sword_intent', new Set(live.slice(0, limit)));
  if (consumed.length === 0) return;
  action.consumedSwordIntent = consumed.length;
  const source = replacement ?? rule;
  const ratio = replacement
    ? n(replacement.params?.damage_per_stack_attack_ratio ??
      replacement.params?.attack_ratio_per_stack ??
      replacement.params?.attack_ratio, n(rule.params.attack_ratio, 0))
    : n(rule.params.attack_ratio, 0);
  for (let sword = 0; sword < consumed.length; sword++) {
    if (!runtime.active || actor.hp <= 0 || action.target.hp <= 0) break;
    dealDamage(runtime, actor, action.target, 0, {
      sourceEffect: source,
      kind: 'derived',
      canCrit: false,
      rawOverride: attackStats(runtime, actor, action.target, action).attack * ratio,
      resonanceEffectId: rule.id,
    });
  }
}

function resolveStatusConsumption(runtime: BattleRuntime, action: ActionContext): void {
  if (action.isEcho) return;
  const actor = action.actor;
  const target = action.target;
  if (action.type === 'rage_action' && actor.method.id === 'RKF04') {
    const consume = selectedEffect(actor, 'RKF04-J3-A-CONSUME-BURN');
    const initialBurns = action.targetStartStatusLayers.get('burn') ?? [];
    const liveBurns = initialBurns.filter(layer =>
      getStatusLayers(target, 'burn').includes(layer) && layer.remaining > 0);
    if (consume && liveBurns.length > 0) {
      const selected = new Set(liveBurns.slice(0, int(consume.params?.max_stacks, 3)));
      const consumed = removeStatusLayersByIdentity(target, 'burn', selected);
      action.consumedBurn = consumed.length;
      if (consumed.length > 0) {
        mark(runtime, consume);
        dealDamage(runtime, actor, target, 0, {
          sourceEffect: consume,
          kind: 'derived',
          canCrit: false,
          rawOverride: consumed.length * attackStats(runtime, actor, target, action).attack *
            n(consume.params?.damage_per_stack_attack_ratio, 0.18),
        });
      }
    }
  }
  if (action.type === 'rage_action' && actor.method.id === 'RKF05') {
    resolveSwordArray(runtime, action);
  }
  if (action.type === 'rage_action' && actor.method.id === 'RKF09') {
    const consume = selectedEffect(actor, 'RKF09-J4-B-CONSUME');
    const damage = selectedEffect(actor, 'RKF09-J4-B-DAMAGE');
    const initialBurns = action.targetStartStatusLayers.get('burn') ?? [];
    const liveBurns = initialBurns.filter(layer =>
      getStatusLayers(target, 'burn').includes(layer) && layer.remaining > 0);
    if (consume && damage && liveBurns.length > 0) {
      const selected = new Set(liveBurns.slice(0, int(consume.params?.max_stacks, 3)));
      const consumed = removeStatusLayersByIdentity(target, 'burn', selected);
      action.consumedBurn = consumed.length;
      if (consumed.length > 0) {
        mark(runtime, consume);
        dealDamage(runtime, actor, target, 0, {
          sourceEffect: damage,
          kind: 'derived',
          canCrit: false,
          rawOverride: consumed.length * attackStats(runtime, actor, target, action).attack * n(damage.params?.attack_ratio_per_stack, 0.16),
        });
      }
    }
  }
}

function resolveCoreRageAction(runtime: BattleRuntime, action: ActionContext): void {
  const { actor, target } = action;
  if (action.isEcho || action.type !== 'rage_action' || actor.hp <= 0 || target.hp <= 0) return;
  for (const core of actor.coreRules) {
    if (core.kind !== 'poison_detonation') continue;
    const initialLayers = action.targetStartStatusLayers.get('poison') ?? [];
    const eligible = initialLayers.filter(layer =>
      fighterOwnsDotLayer(actor, layer));
    const selected = new Set(eligible);
    if (!selected.size) continue;
    const consumed = removeStatusLayersByIdentity(target, 'poison', selected);
    if (!consumed.length) continue;
    const remainingDamage = consumed.reduce((sum, layer) =>
      sum + n(layer.damage, 0) * Math.max(0, n(layer.remaining, 0)), 0);
    const damage = remainingDamage * n(core.params.damage_ratio, 0);
    if (runtime.active && actor.hp > 0 && target.hp > 0) {
      dealDamage(runtime, actor, target, 0, {
        sourceEffect: core.effect,
        kind: 'derived',
        canCrit: false,
        rawOverride: damage,
      });
    }
  }
}

function resolveCoreRageRefund(runtime: BattleRuntime, action: ActionContext, core: CoreRuleRuntime): void {
  const { actor } = action;
  if (action.isEcho || action.type !== 'rage_action' || actor.hp <= 0 || core?.kind !== 'rage_gambit') return;
  const onceKey = `core-rage-refund:${action.round}:${actor.actionNumber}`;
  if (actor.battleFlags.has(onceKey)) return;
  actor.battleFlags.add(onceKey);
  const sourceId = core.artifact.entity.id;
  registerRage(runtime, actor, n(core.params.rage_refund, 0), sourceId, sourceId);
}

function resolveCoreActionEnd(runtime: BattleRuntime, action: ActionContext): void {
  const { actor, target } = action;
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0) return;
  for (const core of actor.coreRules) {
    if (core.kind === 'rage_gambit' && action.type === 'rage_action') {
      resolveCoreRageRefund(runtime, action, core);
    }
    if (core.kind === 'healing_guard' && action.type === 'basic_action') {
      resolveHeal(runtime, action, actor.stats.max_hp * n(core.params.heal_ratio, 0), core.effect);
    }
  }
}

function earliestOwnDotLayer(
  actor: Fighter,
  target: Fighter,
  status: 'poison' | 'burn',
): StatusLayer | undefined {
  return getStatusLayers(target, status).find(layer =>
    layer.remaining > 0 && fighterOwnsDotLayer(actor, layer));
}

function addFusionDotLayer(
  runtime: BattleRuntime,
  action: ActionContext,
  effect: ActiveEffect,
  status: 'poison' | 'burn',
): boolean {
  const { actor, target } = action;
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0) return false;
  const layers = getStatusLayers(target, status);
  const authoredCap = int(rules(runtime.content).statuses?.[status]?.max_stacks, 10);
  const cap = Math.min(10, Math.max(0, authoredCap));
  if (layers.length >= cap) return false;
  layers.push({
    remaining: 2,
    damage: action.actionStats.attack * 0.05,
    sourceId: effect.id,
    ownerId: effect.ownerId,
    ownerSide: actor.side,
    attackRatio: 0.05,
    kind: 'dot',
  });
  mark(runtime, effect, 1, actor.side);
  recordCombatEvent(runtime, status, actor);
  frame(
    runtime,
    'status',
    `${effect.ownerName}补入1层${status === 'poison' ? '中毒' : '燃烧'}`,
    actor.side,
    target.side,
    effect.id,
    1,
  );
  return true;
}

function resolveFusionActionEnd(runtime: BattleRuntime, action: ActionContext): void {
  const { actor, target } = action;
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0 ||
      !action.isMainAction || action.isEcho || action.isReaction || !action.completed) return;

  // Stable order: Twin Swords hits first so their legal on-hit outputs are
  // visible to Toxic Flame. Toxic Flame then resolves before RR11's furnace.
  const priority: Record<FusionKind, number> = { twin_swords: 0, toxic_flame: 1 };
  const rulesInOrder = fusionRules(actor).sort((left, right) =>
    priority[left.kind] - priority[right.kind]);
  for (const fusion of rulesInOrder) {
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) return;
    const onceKey = `fusion:${fusion.artifact.entity.id}`;

    if (fusion.kind === 'twin_swords') {
      if (action.type !== 'basic_action' || !action.hadEffectiveBaseHit ||
          !reserveActionLimit(action, onceKey, 1)) continue;
      frame(runtime, 'status', '雌雄剑双剑追击', actor.side, target.side, fusion.effect.id, 2);
      for (let hit = 0; hit < 2; hit++) {
        if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
        dealDamage(runtime, actor, target, 0.4, {
          sourceEffect: fusion.effect,
          kind: 'derived',
          canCrit: false,
        });
      }
      continue;
    }

    const poison = earliestOwnDotLayer(actor, target, 'poison');
    const burn = earliestOwnDotLayer(actor, target, 'burn');
    if (!poison && !burn) continue;
    if (!reserveActionLimit(action, onceKey, 1)) continue;

    if (poison && burn) {
      const consumed = [
        ...removeStatusLayersByIdentity(target, 'poison', new Set([poison])),
        ...removeStatusLayersByIdentity(target, 'burn', new Set([burn])),
      ];
      if (consumed.length !== 2) continue;
      const remainingDamage = consumed.reduce((sum, layer) =>
        sum + n(layer.damage, 0) * Math.max(0, n(layer.remaining, 0)), 0);
      frame(runtime, 'status', '九幽毒火幡引爆最早一层毒火', actor.side, target.side, fusion.effect.id, 2);
      dealDamage(runtime, actor, target, 0, {
        sourceEffect: fusion.effect,
        kind: 'derived',
        canCrit: false,
        rawOverride: remainingDamage * 1.2,
      });
      continue;
    }

    const missingStatus = poison ? 'burn' : 'poison';
    addFusionDotLayer(runtime, action, fusion.effect, missingStatus);
  }
}

function resolveResonanceActionEnd(runtime: BattleRuntime, action: ActionContext): void {
  const { actor, target } = action;
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0 ||
      !action.isMainAction || action.isEcho || !action.completed) return;

  resolveFusionActionEnd(runtime, action);
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0) return;

  const breath = resonanceRule(actor, 'returning_breath');
  if (breath && action.type === 'rage_action') {
    const previous = actor.forcedBasic ?? { ratioAdd: 0, rageGainBonus: 0 };
    actor.forcedBasic = {
      ...previous,
      extraSegments: n(previous.extraSegments, 0) + n(breath.params.extra_segments, 0),
      segmentScale: n(previous.segmentScale, 1) * n(breath.params.segment_ratio, 1),
      rageGainBonus: n(previous.rageGainBonus, 0) + n(breath.params.rage_bonus, 0),
    };
    setResonanceState(actor, breath, 'ready', 1);
    mark(runtime, breath);
  }

  const wealth = resonanceRule(actor, 'wealth_strikes');
  if (wealth && action.type === 'basic_action' && action.hadEffectiveBaseHit) {
    const coins = journeyFacts(actor.loadout).coins;
    const perSegment = n(wealth.params.coins_per_segment, 0);
    const maxSegments = int(wealth.params.max_segments, 0);
    const segments = perSegment > 0
      ? Math.min(maxSegments, 1 + Math.floor(coins / perSegment))
      : maxSegments;
    if (segments > 0 && reserveActionLimit(action, wealth.id, 1)) {
      for (let segment = 0; segment < segments; segment++) {
        if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
        dealDamage(runtime, actor, target, n(wealth.params.attack_ratio, 0), {
          sourceEffect: wealth,
          kind: 'derived',
          canCrit: false,
          resonanceEffectId: wealth.id,
        });
      }
    }
  }
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0) return;

  const hex = resonanceRule(actor, 'moon_hex');
  if (hex && reserveActionLimit(action, hex.id, 1)) {
    const debuffs = (['poison', 'burn', 'weakness', 'armor_break'] as StatusName[])
      .filter(status => hasStatus(target, status));
    if (debuffs.length > 0) {
      for (const _status of debuffs) {
        requestDrain(runtime, target, n(hex.params.drain_per_kind, 0), hex.id, hex.ownerId);
      }
      for (let seal = 0; seal < debuffs.length; seal++) {
        if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
        dealDamage(runtime, actor, target, n(hex.params.attack_ratio, 0), {
          sourceEffect: hex,
          kind: 'derived',
          canCrit: false,
          resonanceEffectId: hex.id,
        });
      }
    }
  }
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0) return;

  const furnace = resonanceRule(actor, 'toxic_furnace');
  if (furnace) {
    const onceKey = `${furnace.id}:${action.round}:${actor.actionNumber}`;
    if (!actor.battleFlags.has(onceKey)) {
      const ownLayer = (status: 'poison' | 'burn') =>
        getStatusLayers(target, status).find(layer =>
          layer.remaining > 0 && fighterOwnsDotLayer(actor, layer));
      const poison = ownLayer('poison');
      const burn = ownLayer('burn');
      if (poison && burn) {
        actor.battleFlags.add(onceKey);
        const consumedPoison = removeStatusLayersByIdentity(target, 'poison', new Set([poison]));
        const consumedBurn = removeStatusLayersByIdentity(target, 'burn', new Set([burn]));
        if (consumedPoison.length > 0 && consumedBurn.length > 0) {
          const remainingDamage = [...consumedPoison, ...consumedBurn].reduce((sum, layer) =>
            sum + n(layer.damage, 0) * Math.max(0, n(layer.remaining, 0)), 0);
          const damage = remainingDamage * n(furnace.params.remaining_damage_ratio, 0);
          registerRage(runtime, actor, n(furnace.params.rage_gain, 0), furnace.id, furnace.ownerId);
          if (runtime.active && actor.hp > 0 && target.hp > 0) {
            dealDamage(runtime, actor, target, 0, {
              sourceEffect: furnace,
              kind: 'derived',
              canCrit: false,
              rawOverride: damage,
              resonanceEffectId: furnace.id,
            });
          }
        }
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
    if (isSharedTalentEffect(runtime, actor, effect)) {
      if (effect.operation === 'heal') {
        resolveHeal(runtime, action, sharedOutputAmount(actor, action, p, effect.stacks), effect);
        continue;
      }
      if (effect.operation === 'shield') {
        addShield(runtime, actor, sharedOutputAmount(actor, action, p, effect.stacks), effect, '共通天赋护盾');
        continue;
      }
    }
    if (effect.operation === 'rage_cap' && effect.id === 'RR07-FIRST-RAGE-CAP-REDUCTION') {
      if (action.isEcho) continue;
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
      if (action.isEcho) continue;
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
        const hpShield = selectedEffect(actor, effect.id === 'RKF01-BASIC-SHIELD'
          ? 'RKF01-J2-C-BASIC-HP-SHIELD' : 'RKF01-J2-C-RAGE-HP-SHIELD');
        const hpRatio = n(p.max_hp_ratio, 0) + n(hpShield?.params?.max_hp_ratio_add, 0);
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
        if (action.reservedChargeLuck && actor.hp > 0 &&
            (action.isEcho ? action.chargeLuckShieldOutput : hasStatus(actor, 'charge_luck'))) {
          if (!action.isEcho) {
            removeStatusLayers(actor, 'charge_luck', 1);
            action.chargeLuckShieldOutput = true;
          }
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
        if (actor.phase === 'day') {
          const defenseRatio = applyGenericNumberModifiers(
            runtime,
            actor,
            target,
            action,
            effect.id,
            'params.defense_ratio',
            n(p.defense_ratio, 0),
          );
          addShield(runtime, actor, action.actionStats.defense * defenseRatio, effect, '白昼护盾');
        }
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
      if (action.isEcho) continue;
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
      if (action.isEcho) continue;
      const amount = n(p.amount, 0) * effect.stacks;
      if (amount > 0) requestDrain(runtime, target, amount, effect.id, effect.ownerId);
      continue;
    }
    if (effect.operation === 'replace_action' &&
        !action.isEcho &&
        action.type === 'rage_action' &&
        p.next_action === 'basic_action') {
      const previous = actor.forcedBasic ?? { ratioAdd: 0, rageGainBonus: 0 };
      actor.forcedBasic = {
        ...previous,
        ratioAdd: previous.ratioAdd + n(p.basic_damage_ratio_add, 0),
        rageGainBonus: previous.rageGainBonus + n(p.basic_rage_gain_bonus, 0) +
          (p.base_public_basic_gain ? n(p.base_public_basic_gain, 25) - 25 : 0),
      };
      mark(runtime, effect);
      continue;
    }
    if (effect.operation === 'advance_phase') {
      if (action.isEcho) continue;
      const before = actor.phase;
      actor.phase = actor.phase === 'day' ? 'night' : 'day';
      action.phaseChanged = before !== actor.phase;
      action.phaseTransition = `${before}_to_${actor.phase}`;
      if (action.phaseChanged) recordCombatEvent(runtime, 'phase', actor);
      mark(runtime, effect);
      frame(runtime, 'phase', `${actor.side === 'player' ? '玩家' : '敌人'}相位转为${actor.phase === 'day' ? '白昼' : '长夜'}`, actor.side, actor.side, effect.id);
      continue;
    }
  }
  if (!action.isEcho && action.type === 'basic_action' && action.completed) {
    const basicGain = n(rules(runtime.content).rage?.basic_completed, 25) + (actor.forcedBasic?.rageGainBonus ?? 0);
    registerRage(runtime, actor, basicGain, 'RULES-BASIC-COMPLETED', actor.method.id);
    actor.forcedBasic = null;
  }
  if (!action.isEcho && action.type === 'rage_action') {
    const refundRatio = actor.method.id === 'RKF02'
      ? 0.2 + (selectedEffect(actor, 'RKF02-J2-C-REFUND') ? 0.2 : 0) + (selectedEffect(actor, 'RKF02-J4-A-REFUND') ? 0.2 : 0)
      : 0;
    if (refundRatio > 0) registerRage(runtime, actor, action.lockedCost * refundRatio, 'RKF02-RAGE-REFUND', actor.method.id);
  }
  const incomingRr08 = rr08Effect(target);
  if (incomingRr08 && action.isMainAction && !action.isEcho && actor.side !== target.side &&
      target.hp > 0 && action.unmirroredMainHpDamage > 0) {
    registerRage(
      runtime,
      target,
      n(incomingRr08.params?.amount, 0) * incomingRr08.stacks,
      incomingRr08.id,
      incomingRr08.ownerId,
    );
    const stored = rr08Stored(target);
    const next = Math.min(
      rr08StorageCap(target, incomingRr08),
      stored + action.unmirroredMainHpDamage,
    );
    if (next > stored) {
      target.battleLayers[rr08StoredKey()] = next;
      mark(runtime, incomingRr08);
      frame(
        runtime,
        'status',
        `${target.loadout.name}积蓄血勇 ${Math.round(next)}`,
        target.side,
        target.side,
        incomingRr08.id,
        next,
      );
    }
  }
  resolveCoreActionEnd(runtime, action);
  resolveResonanceActionEnd(runtime, action);

  const rr08 = rr08Effect(actor);
  const storedBloodValor = rr08Stored(actor);
  const retaliationFlag = 'RR08:BLOOD-VALOR-RETALIATED';
  if (rr08 && action.isMainAction && !action.isEcho &&
      (action.type === 'basic_action' || action.type === 'rage_action') &&
      action.unmirroredMainHpDamage > 0 && storedBloodValor > 0 &&
      !actor.battleFlags.has(retaliationFlag) && runtime.active &&
      actor.hp > 0 && target.hp > 0) {
    actor.battleFlags.add(retaliationFlag);
    actor.battleLayers[rr08StoredKey()] = 0;
    mark(runtime, rr08);
    const retaliation = storedBloodValor * n(rr08.params?.retaliation_ratio, 1);
    withReactionBeat(
      runtime,
      actor,
      target,
      'blood_valor',
      rr08.id,
      `${actor.loadout.name}血勇反击 ${Math.round(retaliation)}`,
      response => {
        dealDamage(runtime, actor, target, 0, {
          sourceEffect: rr08,
          kind: 'derived',
          canCrit: false,
          rawOverride: retaliation,
          followup: true,
        });
        void response;
      },
    );
  }
}

function executeRageEcho(runtime: BattleRuntime, original: ActionContext): void {
  const { actor, target } = original;
  if (original.type !== 'rage_action' || original.isEcho ||
      !runtime.active || actor.hp <= 0 || target.hp <= 0 || original.stop) return;
  for (const mechanic of mechanicsOf(actor, 'rage_echo')) {
    const effect = buildEffect(actor, mechanic);
    if (!effect) continue;
    const powerScale = n(mechanic.params.ratio, 0);
    if (powerScale <= 0) continue;
    mark(runtime, effect);
    const echo: ActionContext = {
      ...original,
      isMainAction: false,
      isEcho: true,
      echoSource: effect,
      powerScale,
      actionStats: { ...original.actionStats },
      actionStartStatuses: new Map(original.actionStartStatuses),
      targetStartStatusLayers: new Map(
        [...original.targetStartStatusLayers.entries()].map(([status, layers]) => [status, [...layers]]),
      ),
      consumedSwordIntent: 0,
      consumedBurn: 0,
      consumedShield: 0,
      consumedShieldDamage: 0,
      chargeLuckShieldOutput: original.chargeLuckShieldOutput,
      completed: false,
      stop: false,
      actualBonusSegments: 0,
      baseDirectHitCount: 0,
      directCritCount: 0,
      rr10CritCount: 0,
      recoilDone: false,
      actualHpDamage: 0,
      actualAbsorbed: 0,
      enemyActualHpDamage: 0,
      unmirroredMainHpDamage: 0,
      reflectDamage: 0,
    };
    runtime.currentAction = echo;
    if (runtime.active && target.hp > 0 && actor.hp > 0) {
      const base = actionEffect(actor, 'rage_action', `${actor.method.id}-RAGE-DAMAGE`);
      const spec = directSpec(runtime, echo, base);
      for (let index = 0; index < spec.segments; index++) {
        if (!runtime.active || actor.hp <= 0 || target.hp <= 0 || echo.stop) break;
        const hit = dealDamage(runtime, actor, target, spec.segmentRatios[index] ?? spec.ratio, {
          sourceEffect: base,
          kind: 'direct',
          canCrit: spec.canCrit,
          base: true,
          criticalBonusRatio: spec.segmentBonusNoCrits[index] ?? spec.bonusNoCrit,
        });
        if (hit.effective) echo.firstBaseHit = true;
        applyActionHitStatus(runtime, echo, base, hit);
        if (actor.method.id === 'RKF07') {
          const chain = actionEffect(actor, 'rage_action', 'RKF07-RAGE-CHAIN');
          resolveChain(runtime, echo, chain, hit);
        }
        if (!runtime.active || target.hp <= 0) break;
        if (actor.method.id === 'RKF09') {
          const burn = actionEffect(actor, 'rage_action', 'RKF09-RAGE-BURN');
          const stacks = effectValueForStatus(runtime, actor, target, echo, burn, 'stacks_per_segment', 1);
          const added = applyDot(runtime, actor, target, burn, 'burn', stacks,
            int(burn.params?.duration_rounds, 3),
            n(burn.params?.attack_ratio_per_stack, 0.08),
            int(burn.params?.max_stacks, 10),
            echo.actionStats.attack);
          echo.actualDebuffApplied ||= added > 0;
        }
      }
    }
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
    if (actor.method.id === 'RKF08') {
      const armor = actionEffect(actor, 'rage_action', 'RKF08-RAGE-ARMOR');
      const added = addRegularStatus(runtime, target, 'armor_break',
        int(armor.params?.stacks, 2),
        int(armor.params?.duration_rounds, 2),
        armor,
        undefined,
        int(armor.params?.max_stacks, 5));
      echo.actualDebuffApplied ||= added > 0;
      resolveNegativeFollowup(runtime, echo);
    }
    if (actor.method.id === 'RKF06') {
      const poison = actionEffect(actor, 'rage_action', 'RKF06-RAGE-POISON');
      const stacks = effectValueForStatus(runtime, actor, target, echo, poison, 'stacks', 2);
      const added = applyDot(runtime, actor, target, poison, 'poison', stacks,
        int(poison.params?.duration_rounds, 3),
        n(poison.params?.attack_ratio_per_stack, 0.08),
        int(poison.params?.max_stacks, 10),
        echo.actionStats.attack);
      echo.actualDebuffApplied ||= added > 0;
    }
    if (actor.method.id === 'RKF04' || actor.method.id === 'RKF05') {
      resolveStatusConsumption(runtime, echo);
    }
    if (actor.method.id === 'RKF09') {
      const chance = selectedEffect(actor, 'RKF09-J3-A-CHANCE');
      if (chance && runtime.random() < n(chance.params?.chance, 0.5)) {
        const hit = dealDamage(runtime, actor, target, n(chance.params?.attack_ratio, 0.46), {
          sourceEffect: chance,
          kind: 'direct',
          canCrit: chance.params?.can_crit !== false,
          followup: true,
        });
        if (hit.effective) {
          const ap = chance.params?.apply_status;
          if (ap) applyDot(runtime, actor, target, chance, 'burn',
            int(ap.stacks, 1), int(ap.duration_rounds, 3),
            n(ap.attack_ratio_per_stack, 0.08), 10, echo.actionStats.attack);
        }
      }
      resolveStatusConsumption(runtime, echo);
    }
    resolveCoreRageAction(runtime, echo);
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
    echo.completed = true;
    resolveActionEnd(runtime, echo);
    runtime.currentAction = original;
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
  }
}

function resolveAcceleratedOwnBurns(runtime: BattleRuntime, action: ActionContext): void {
  const { actor, target } = action;
  const rule = resonanceRule(actor, 'burn_accelerate');
  if (!rule || action.type !== 'rage_action' || actor.hp <= 0 || target.hp <= 0) return;
  let burnSiphonDamage = 0;
  const initialBurns = action.targetStartStatusLayers.get('burn') ?? [];
  for (const layer of initialBurns) {
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) break;
    const live = getStatusLayers(target, 'burn').includes(layer);
    if (!live || layer.remaining <= 0 || !fighterOwnsDotLayer(actor, layer)) continue;
    for (let tick = 0; tick < int(rule.params.ticks, 0); tick++) {
      if (!runtime.active || actor.hp <= 0 || target.hp <= 0 ||
          !getStatusLayers(target, 'burn').includes(layer) || layer.remaining <= 0) break;
      const result = resolveDotTick(runtime, actor, target, 'burn', layer, action);
      if (result.hpDamage > 0 && actor.coreRules.some(core => core.kind === 'burn_siphon')) {
        burnSiphonDamage += result.hpDamage;
      }
    }
  }
  if (runtime.active && actor.hp > 0 && target.hp > 0 && burnSiphonDamage > 0) {
    resolveBurnSiphonHeal(runtime, actor, action, burnSiphonDamage);
  }
}

function reserveMainActionResources(runtime: BattleRuntime, action: ActionContext): void {
  const { actor } = action;
  if (action.type === 'basic_action') {
    const blades = resonanceRule(actor, 'healing_blades');
    if (blades) {
      action.reservedHealingBlades = resonanceState(actor, blades, 'charges');
      setResonanceState(actor, blades, 'charges', 0);
    }
    const breath = resonanceRule(actor, 'returning_breath');
    if (breath && resonanceState(actor, breath, 'ready') > 0) {
      action.returningBreathSegments = int(
        actor.forcedBasic?.extraSegments,
        int(breath.params.extra_segments, 0),
      );
      action.returningBreathScale = n(actor.forcedBasic?.segmentScale, n(breath.params.segment_ratio, 1));
      setResonanceState(actor, breath, 'ready', 0);
      mark(runtime, breath);
    }
  }
  if (action.type === 'rage_action') {
    const pressure = resonanceRule(actor, 'guard_pressure');
    if (pressure) {
      action.reservedPressure = resonanceState(actor, pressure, 'pressure');
      setResonanceState(actor, pressure, 'pressure', 0);
    }
    const furnace = resonanceRule(actor, 'ember_furnace');
    if (furnace) {
      action.reservedFurnaceHeat = resonanceState(actor, furnace, 'heat');
      setResonanceState(actor, furnace, 'heat', 0);
    }
  }
}

function releaseGuardPressure(runtime: BattleRuntime, action: ActionContext): void {
  const rule = resonanceRule(action.actor, 'guard_pressure');
  if (!rule || action.type !== 'rage_action' || action.reservedPressure <= 0) return;
  dealDamage(runtime, action.actor, action.target, 0, {
    sourceEffect: rule,
    kind: 'derived',
    canCrit: false,
    rawOverride: action.reservedPressure * n(rule.params.release_ratio, 0),
    resonanceEffectId: rule.id,
  });
}

function resolveReservedResonanceAttacks(runtime: BattleRuntime, action: ActionContext): void {
  if (action.type === 'basic_action' && action.reservedHealingBlades > 0) {
    const rule = resonanceRule(action.actor, 'healing_blades');
    if (rule) {
      for (let blade = 0; blade < action.reservedHealingBlades; blade++) {
        if (!runtime.active || action.actor.hp <= 0 || action.target.hp <= 0) break;
        dealDamage(runtime, action.actor, action.target, n(rule.params.attack_ratio, 0), {
          sourceEffect: rule,
          kind: 'derived',
          canCrit: false,
          resonanceEffectId: rule.id,
        });
      }
    }
  }
  if (action.type === 'rage_action' && action.reservedFurnaceHeat > 0) {
    const rule = resonanceRule(action.actor, 'ember_furnace');
    if (!rule) return;
    const segments = int(rule.params.segments, 0);
    if (segments <= 0) return;
    for (let segment = 0; segment < segments; segment++) {
      if (!runtime.active || action.actor.hp <= 0 || action.target.hp <= 0) break;
      dealDamage(runtime, action.actor, action.target, 0, {
        sourceEffect: rule,
        kind: 'derived',
        canCrit: false,
        rawOverride: action.reservedFurnaceHeat / segments,
        resonanceEffectId: rule.id,
      });
    }
  }
}

function addFlyingSwordAfterBasic(runtime: BattleRuntime, action: ActionContext): void {
  if (!action.isMainAction || action.isEcho || action.type !== 'basic_action' ||
      !action.completed || !runtime.active || action.actor.hp <= 0 || action.target.hp <= 0) return;
  const rule = resonanceRule(action.actor, 'sword_array');
  if (!rule) return;
  const current = resonanceState(action.actor, rule, 'flying_swords');
  const maximum = int(rule.params.flying_sword_cap, 0);
  const next = Math.min(maximum, current + 1);
  if (next <= current) return;
  setResonanceState(action.actor, rule, 'flying_swords', next);
  mark(runtime, rule);
}

function resolveHostileActionResponses(runtime: BattleRuntime, completed: ActionContext): void {
  if (!runtime.active || !completed.isMainAction || completed.isEcho ||
      !completed.completed || completed.actor.hp <= 0 || completed.target.hp <= 0 ||
      completed.actor.side === completed.target.side) return;
  const responder = completed.target;
  const hostile = completed.actor;

  const rr06 = selectedEffect(responder, 'RR06-ENEMY-HP-LOSS-HEAL-BURN');
  if (rr06 && completed.unmirroredMainHpDamage > 0 && !responder.battleFlags.has(rr06.id)) {
    responder.battleFlags.add(rr06.id);
    withAuxiliaryAction(runtime, responder, hostile, response => {
      frame(
        runtime,
        'status',
        `${responder.loadout.name}长明灯受创回春`,
        responder.side,
        responder.side,
        rr06.id,
      );
      const healing = resolveHeal(
        runtime,
        response,
        responder.stats.max_hp * n(rr06.params?.max_hp_ratio, 0),
        rr06,
      );
      if (healing.totalEffective <= 0 || !runtime.active || responder.hp <= 0 || hostile.hp <= 0) return;
      const added = applyDot(
        runtime,
        responder,
        hostile,
        rr06,
        'burn',
        int(rr06.params?.burn_stacks, 1),
        int(rr06.params?.burn_duration_rounds, 2),
        n(rr06.params?.burn_attack_ratio, 0.06),
        int(rules(runtime.content).statuses?.burn?.max_stacks, 10),
        attackStats(runtime, responder, hostile, response).attack,
        false,
      );
      if (added > 0) mark(runtime, rr06);
    });
  }
  if (!runtime.active || responder.hp <= 0 || hostile.hp <= 0) return;

  const swords = resonanceRule(responder, 'sword_array');
  const swordCount = swords ? Math.floor(resonanceState(responder, swords, 'flying_swords')) : 0;
  if (swords && swordCount > 0) {
    withReactionBeat(
      runtime,
      responder,
      hostile,
      'sword_volley',
      swords.id,
      `${responder.loadout.name}御使飞剑齐射 ${swordCount} 柄`,
      action => {
        for (let sword = 0; sword < swordCount; sword++) {
          if (!runtime.active || responder.hp <= 0 || hostile.hp <= 0) break;
          dealDamage(runtime, responder, hostile, 0, {
            sourceEffect: swords,
            kind: 'derived',
            canCrit: false,
            rawOverride: attackStats(runtime, responder, hostile, action).attack *
              n(swords.params.flying_sword_ratio, 0),
            resonanceEffectId: swords.id,
          });
        }
      },
    );
  }
  if (!runtime.active || responder.hp <= 0 || hostile.hp <= 0) return;

  const pressureRule = resonanceRule(responder, 'guard_pressure');
  if (pressureRule) {
    const pressure = resonanceState(responder, pressureRule, 'pressure');
    const threshold = responder.stats.max_hp *
      n(pressureRule.params.counter_threshold_hp_ratio, 0);
    if (n(completed.directShieldAbsorbed, 0) > 0 && pressure > 0 &&
        (pressure >= threshold || completed.directShieldBroken)) {
      setResonanceState(responder, pressureRule, 'pressure', 0);
      withReactionBeat(
        runtime,
        responder,
        hostile,
        'guard_counter',
        pressureRule.id,
        `${responder.loadout.name}蓄劲反击`,
        action => {
          dealDamage(runtime, responder, hostile, 0, {
            sourceEffect: pressureRule,
            kind: 'derived',
            canCrit: false,
            rawOverride: pressure * n(pressureRule.params.release_ratio, 0),
            resonanceEffectId: pressureRule.id,
          });
        },
      );
    }
  }
  if (!runtime.active || responder.hp <= 0 || hostile.hp <= 0) return;

  const spring = resonanceRule(responder, 'spring_bloom');
  if (spring) {
    const threshold = responder.stats.max_hp * n(spring.params.threshold_hp_ratio, 0);
    const stored = resonanceState(responder, spring, 'reservoir');
    if (threshold > 0 && stored >= threshold) {
      setResonanceState(responder, spring, 'reservoir', stored - threshold);
      withReactionBeat(
        runtime,
        responder,
        hostile,
        'spring_bloom',
        spring.id,
        `${responder.loadout.name}春生绽放`,
        action => {
          dealDamage(runtime, responder, hostile, 0, {
            sourceEffect: spring,
            kind: 'derived',
            canCrit: false,
            rawOverride: responder.stats.max_hp * n(spring.params.burst_hp_ratio, 0),
            resonanceEffectId: spring.id,
          });
        },
      );
    }
  }
}

function executeActionOnce(runtime: BattleRuntime, actor: Fighter, target: Fighter, type: ActionType, lockedCost: number): ActionContext | undefined {
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
    actorStartStatusLayers: snapshotStatusLayers(actor),
    targetStartStatusLayers: snapshotStatusLayers(target),
    resonanceLimitUses: new Map(),
    reservedChargeLuck: false,
    chargeLuckAvailableAtStart: hasStatus(actor, 'charge_luck'),
    swordIntentAtStart: statusCount(actor, 'sword_intent'),
    consumedSwordIntent: 0,
    consumedBurn: 0,
    consumedShield: 0,
    consumedShieldDamage: 0,
    reservedPressure: 0,
    reservedHealingBlades: 0,
    reservedFurnaceHeat: 0,
    returningBreathSegments: 0,
    returningBreathScale: 1,
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
    unmirroredMainHpDamage: 0,
    reflectDamage: 0,
    phaseBefore: actor.phase,
    phaseChanged: false,
    phaseTransition: null,
    completed: false,
    stop: false,
    dotRageRecorded: false,
    healRageRecorded: false,
    combatEvents: new Set(),
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
  reserveMainActionResources(runtime, action);
  if (type === 'rage_action') {
    releaseGuardPressure(runtime, action);
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) {
      runtime.currentAction = null;
      return;
    }
    resolveAcceleratedOwnBurns(runtime, action);
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) {
      runtime.currentAction = null;
      return;
    }
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
  if (type === 'rage_action') {
    for (const core of actor.coreRules) {
      if (core.kind !== 'shield_burst') continue;
      const consumed = Math.min(actor.shield, actor.shield * n(core.params.shield_ratio, 0));
      actor.shield = Math.max(0, actor.shield - consumed);
      if (consumed <= 0) continue;
      const raw = consumed * n(core.params.damage_ratio, 0);
      dealDamage(runtime, actor, target, 0, {
        sourceEffect: core.effect,
        kind: 'derived',
        canCrit: false,
        rawOverride: raw,
      });
      if (!runtime.active || target.hp <= 0) {
        runtime.currentAction = null;
        return;
      }
    }
  }
  const baseId = `${actor.method.id}-${type === 'basic_action' ? 'BASIC-DAMAGE' : 'RAGE-DAMAGE'}`;
  const base = actionEffect(actor, type, baseId);
  const spec = directSpec(runtime, action, base);
  frame(runtime, 'action', `${actor.side === 'player' ? '玩家' : '敌人'}${type === 'basic_action' ? '普攻' : '怒技'}`, actor.side, target.side, base.id);
  const convergence = action.isMainAction && type === 'basic_action'
    ? actor.coreRules.find(core => core.kind === 'basic_convergence')
    : undefined;
  if (convergence) {
    const segmentCount = spec.segments;
    frame(
      runtime,
      'status',
      `凝锋：${segmentCount}段合一，不可暴击`,
      actor.side,
      target.side,
      `${convergence.artifact.entity.id}-CORE`,
      segmentCount,
    );
    mark(runtime, convergence.effect, 1, actor.side);
    const ratio = spec.segmentRatios.reduce((sum, segmentRatio) => sum + segmentRatio, 0) *
      n(convergence.params.damage_ratio, 0);
    const bonus = spec.segmentBonusNoCrits.reduce((sum, segmentBonus) => sum + segmentBonus, 0) *
      n(convergence.params.damage_ratio, 0);
    spec.ratio = ratio;
    spec.bonusNoCrit = bonus;
    spec.segmentRatios = segmentCount > 0 ? [ratio] : [];
    spec.segmentBonusNoCrits = segmentCount > 0 ? [bonus] : [];
    spec.segments = spec.segmentRatios.length;
    spec.canCrit = false;
  }
  for (let index = 0; index < spec.segments; index++) {
    if (!runtime.active || actor.hp <= 0 || target.hp <= 0) {
      action.stop = true;
      break;
    }
    const before = target.hp;
    const hit = dealDamage(runtime, actor, target, spec.segmentRatios[index] ?? spec.ratio, {
      sourceEffect: base,
      kind: 'direct',
      canCrit: spec.canCrit,
      base: true,
      criticalBonusRatio: spec.segmentBonusNoCrits[index] ?? spec.bonusNoCrit,
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
  if (type === 'basic_action' && action.hadEffectiveBaseHit && runtime.active &&
      actor.hp > 0 && target.hp > 0 && !action.stop) {
    for (const core of actor.coreRules) {
      if (core.kind !== 'basic_echo') continue;
      dealDamage(runtime, actor, target, n(core.params.ratio, 0), {
        sourceEffect: core.effect,
        kind: 'derived',
        canCrit: false,
        followup: true,
      });
      if (!runtime.active || target.hp <= 0) {
        runtime.currentAction = null;
        return;
      }
    }
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
  resolveCoreRageAction(runtime, action);
  action.completed = true;
  resolveReservedResonanceAttacks(runtime, action);
  if (!runtime.active || actor.hp <= 0 || target.hp <= 0) {
    runtime.currentAction = null;
    return;
  }
  resolveActionEnd(runtime, action);
  resolveArtifactAwakenings(runtime, action);
  resolveCompanionAssist(runtime, action);
  if (type === 'rage_action' && runtime.active && actor.hp > 0 && target.hp > 0) {
    executeRageEcho(runtime, action);
  }
  addFlyingSwordAfterBasic(runtime, action);
  runtime.currentAction = null;
  resolveHostileActionResponses(runtime, action);
  return action;
}

function executeAction(runtime: BattleRuntime, actor: Fighter, target: Fighter, type: ActionType, lockedCost: number): void {
  let actionPendingStart = actor.pendingGains.length;
  let action = executeActionOnce(runtime, actor, target, type, lockedCost);
  if (type !== 'rage_action' || !action?.completed) return;

  let rageActions = 1;
  while (rageActions < 3 && runtime.active && actor.hp > 0 && target.hp > 0 &&
      (!actor.forcedBasic || actor.loadout.permanentRule?.kind === 'endless_chain')) {
    if (actor.loadout.permanentRule?.kind === 'endless_chain') actor.forcedBasic = null;
    const actionGains = actor.pendingGains.slice(actionPendingStart).filter(entry => !entry.isEcho);
    const gained = actionGains.reduce((sum, entry) => sum + entry.amount, 0);
    if (actionGains.length === 0 || actor.rage + gained < actor.rageCap) break;

    // Only remove entries appended during the just-finished rage action. Any
    // rage waiting from an earlier event remains for the ordinary round-end
    // settlement.
    for (let index = actor.pendingGains.length - 1; index >= actionPendingStart; index--) {
      if (!actor.pendingGains[index].isEcho) actor.pendingGains.splice(index, 1);
    }
    actor.rage = Math.min(actor.rageCap, actor.rage + gained);
    const sourceId = `${actor.method.id}-RAGE-CHAIN`;
    const nextAction = rageActions + 1;
    frame(runtime, 'rage', `${actor.side === 'player' ? '玩家' : '敌人'}怒气连斩结算 ${Math.round(gained)} 点本次回怒`, actor.side, actor.side, sourceId, gained);
    frame(runtime, 'reaction', `${actor.side === 'player' ? '玩家' : '敌人'}怒技连斩·第${nextAction}式`, actor.side, target.side, sourceId, undefined, {
      kind: 'rage_chain',
      owner: actor.side,
      sourceId,
      count: nextAction,
    });

    actionPendingStart = actor.pendingGains.length;
    action = executeActionOnce(runtime, actor, target, 'rage_action', actor.rageCap);
    if (!action?.completed) break;
    rageActions += 1;
  }
}

function resolveBurnSiphonHeal(
  runtime: BattleRuntime,
  owner: Fighter,
  action: ActionContext,
  actualBurnHpDamage: number,
): void {
  if (actualBurnHpDamage <= 0 || owner.hp <= 0) return;
  const previousAction = runtime.currentAction;
  runtime.currentAction = action;
  try {
    for (const core of owner.coreRules) {
      if (core.kind !== 'burn_siphon') continue;
      const healing = actualBurnHpDamage * n(core.params.heal_ratio, 0);
      if (healing > 0) resolveHeal(runtime, action, healing, core.effect);
    }
  } finally {
    runtime.currentAction = previousAction;
  }
}

function resolveDotTick(
  runtime: BattleRuntime,
  owner: Fighter,
  target: Fighter,
  status: 'poison' | 'burn',
  layer: StatusLayer,
  action: ActionContext,
): HitResult {
  const sourceId = layer.sourceId ?? `${owner.method.id}-${status}`;
  const ownerId = layer.ownerId ?? layer.sourceId ?? '';
  const ownerEffect = activeModifiers(owner).find(effect => effect.id === sourceId) ??
    {
      id: sourceId,
      ownerId: ownerId || owner.method.id,
      ownerName: sourceName(runtime, ownerId || owner.method.id),
      ownerKind: owner.talents.some(talent => talent.id === ownerId)
        ? 'talent'
        : owner.artifacts.some(artifact => artifact.entity.id === ownerId) ? 'artifact' : 'method',
      ownerSide: layer.ownerSide ?? owner.side,
      stacks: 1,
    };
  const previousAction = runtime.currentAction;
  let result: HitResult;
  runtime.currentAction = action;
  try {
    result = dealDamage(runtime, owner, target, 0, {
      sourceEffect: ownerEffect as ActiveEffect,
      kind: 'dot',
      canCrit: false,
      rawOverride: n(layer.damage, 0),
    });
    if (target.trial?.kind === 'reviving_mist' && owner.side !== target.side &&
        (status === 'poison' || status === 'burn') && result.hpDamage > 0 &&
        (target.trialCharges ?? 0) > 0) {
      target.trialCharges = Math.max(0, (target.trialCharges ?? 0) - 1);
      frame(
        runtime,
        'status',
        `${target.loadout.name}回雾被${status === 'poison' ? '毒伤' : '灼伤'}削弱`,
        owner.side,
        target.side,
        ownerEffect.id,
        1,
        {
          kind: 'enemy_charge',
          owner: target.side,
          sourceId: target.loadout.encounterId ?? '',
        },
      );
    }
    (action as AnyMap).lastDotDamage = result.hpDamage + result.absorbed;
    (action as AnyMap).lastOwnDotHpDamage = fighterOwnsDotLayer(owner, layer)
      ? result.hpDamage
      : 0;
    if (status === 'burn' && result.hpDamage > 0 && fighterOwnsDotLayer(owner, layer)) {
      const furnace = resonanceRule(owner, 'ember_furnace');
      if (furnace) {
        const cap = owner.stats.max_hp * n(furnace.params.cap_hp_ratio, 0);
        const heat = Math.min(cap, resonanceState(owner, furnace, 'heat') +
          result.hpDamage * n(furnace.params.stored_ratio, 0));
        setResonanceState(owner, furnace, 'heat', heat);
        mark(runtime, furnace);
      }
    }
    if (result.hpDamage > 0 && runtime.active && owner.hp > 0 && target.hp > 0) {
      const ownLayer = fighterOwnsDotLayer(owner, layer);
      const dotEffects = activeModifiers(owner).filter(effect => effect.trigger === 'dot_resolved');
      for (const effect of dotEffects) {
        if (effect.params?.status && effect.params.status !== status &&
            !(effect.params?.statuses ?? []).includes(status)) continue;
        if (effect.id === 'RKF04-J2-B-RAGE' && status !== 'burn') continue;
        if (effect.id === 'RKF09-J3-C-RAGE' && status !== 'burn') continue;
        if (effect.id === 'RR11-DOT-ROUND-RAGE' && (!['poison', 'burn'].includes(status) || !ownLayer)) continue;
        if (effect.id === 'RKF04-J4-C-SHIELD' && !ownLayer) continue;
        const oncePerRound = effect.id === 'RKF04-J2-B-RAGE' ||
          effect.id === 'RKF09-J3-C-RAGE' ||
          effect.id === 'RR11-DOT-ROUND-RAGE' ||
          effect.id === 'RKF04-J4-C-SHIELD';
        const onceKey = `dot:${runtime.round}:${effect.id}`;
        if (oncePerRound && owner.battleFlags.has(onceKey)) continue;
        if (effect.operation === 'rage_gain') {
          if (oncePerRound) owner.battleFlags.add(onceKey);
          registerRage(runtime, owner, n(effect.params?.amount, 0) * effect.stacks, effect.id, effect.ownerId);
        }
        if (effect.operation === 'shield') {
          if (oncePerRound) owner.battleFlags.add(onceKey);
          addShield(runtime, owner, (result.hpDamage + result.absorbed) *
            n(effect.params?.actual_damage_ratio, 0.3), effect, '持续伤害转盾');
        }
        if (effect.operation === 'heal') {
          if (oncePerRound) owner.battleFlags.add(onceKey);
          resolveHeal(runtime, action, result.hpDamage * n(effect.params?.ratio, 0.25), effect);
        }
        if (!runtime.active || owner.hp <= 0 || target.hp <= 0) break;
      }
    }
  } finally {
    runtime.currentAction = previousAction;
  }
  const liveLayer = getStatusLayers(target, status).find(item => item === layer);
  if (liveLayer) liveLayer.remaining -= 1;
  const liveLayers = getStatusLayers(target, status);
  fighterStatusReplace(target, status, liveLayers.filter(item => item.remaining > 0));
  return result;
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
    let burnSiphonDamage = 0;
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
      actorStartStatusLayers: snapshotStatusLayers(owner),
      targetStartStatusLayers: snapshotStatusLayers(target),
      resonanceLimitUses: new Map(),
      reservedChargeLuck: false,
      chargeLuckAvailableAtStart: false,
      swordIntentAtStart: statusCount(owner, 'sword_intent'),
      consumedSwordIntent: 0,
      consumedBurn: 0,
      consumedShield: 0,
      consumedShieldDamage: 0,
      reservedPressure: 0,
      reservedHealingBlades: 0,
      reservedFurnaceHeat: 0,
      returningBreathSegments: 0,
      returningBreathScale: 1,
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
      unmirroredMainHpDamage: 0,
      reflectDamage: 0,
      phaseBefore: owner.phase,
      phaseChanged: false,
      phaseTransition: null,
      completed: false,
      stop: false,
      dotRageRecorded: false,
      healRageRecorded: false,
      roundDotSettlement: true,
    };
    for (const status of ['poison', 'burn'] as const) {
      const layers = [...getStatusLayers(target, status)];
      for (const layer of layers) {
        if (!runtime.active || owner.hp <= 0 || target.hp <= 0) return;
        const result = resolveDotTick(runtime, owner, target, status, layer, synthetic);
        if (status === 'burn' && result.hpDamage > 0 &&
            owner.coreRules.some(core => core.kind === 'burn_siphon') &&
            fighterOwnsDotLayer(owner, layer)) {
          burnSiphonDamage += result.hpDamage;
        }
      }
      if (!runtime.active) break;
    }
    if (runtime.active && target.hp > 0 && burnSiphonDamage > 0 && owner.hp > 0)
      resolveBurnSiphonHeal(runtime, owner, synthetic, burnSiphonDamage);
    if (!runtime.active || owner.hp <= 0 || target.hp <= 0) return;
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
    const thunderBonus = fighter.side === 'enemy' && fighter.loadout.thunderChallenge === true ? 20 : 0;
    fighter.rage = Math.min(fighter.rageCap, Math.max(0, base));
    let actualBonus = 0;
    for (const artifact of fighter.artifacts) {
      let requested = 0;
      if (artifact.entity.id === 'RC22') requested = 15 * artifact.stacks;
      if (artifact.entity.id === 'RL04') requested = 50 * artifact.stacks;
      if (requested <= 0) continue;
      const plannedGain = Math.min(requested, Math.max(0, fighter.rageCap - fighter.rage));
      if (plannedGain <= 0) continue;
      const effect = artifact.entity.effects?.find((item: Effect) => item.operation === 'rage_gain' && item.trigger === 'battle_start');
      const outputSource: ActiveEffect = Object.assign(clone(effect ?? {
        id: `${artifact.entity.id}-OPENING-RAGE`,
        trigger: 'battle_start',
        operation: 'rage_gain',
        params: {},
      }), {
        ownerId: artifact.entity.id,
        ownerName: artifact.entity.name,
        ownerKind: 'artifact' as SourceKind,
        ownerSide: fighter.side,
        stacks: artifact.stacks,
      });
      if (effect) {
        mark(runtime, outputSource, artifact.stacks, fighter.side);
      }
      const applyOpeningCopy = (copy: ActiveEffect, mode: 'mirror' | 'twin' | 'swift', requestedCopyGain: number): void => {
        const copiedGain = Math.min(requestedCopyGain, Math.max(0, fighter.rageCap - fighter.rage));
        if (copiedGain <= 0) return;
        fighter.rage += copiedGain;
        actualBonus += copiedGain;
        addContribution(runtime, copy, 'rage', copiedGain, fighter.side);
        frame(
          runtime,
          'rage',
          `${fighter.side === 'player' ? '玩家' : '敌人'}${mode === 'mirror' ? '镜映' : mode === 'twin' ? '双生铭刻' : '极速铭刻'}开场回怒`,
          fighter.side,
          fighter.side,
          copy.id,
          copiedGain,
        );
      };
      resolveArtifactOutputCopies(runtime, outputSource, fighter, (copy, mode) => {
        applyOpeningCopy(copy, mode, plannedGain);
        if (mode === 'mirror') {
          resolveArtifactOutputCopies(runtime, copy, fighter, (nestedCopy, nestedMode) => {
            applyOpeningCopy(nestedCopy, nestedMode, plannedGain);
          }, 'inscription');
        }
      }, 'mirror');
      const gained = Math.min(requested, Math.max(0, fighter.rageCap - fighter.rage));
      fighter.rage += gained;
      actualBonus += gained;
      if (gained <= 0) continue;
      addContribution(runtime, artifact.entity.id, 'rage', gained, fighter.side);
      resolveArtifactOutputCopies(runtime, outputSource, fighter, (copy, mode) => {
        applyOpeningCopy(copy, mode, gained);
      }, 'inscription');
    }
    if (thunderBonus > 0) {
      const gained = Math.min(thunderBonus, Math.max(0, fighter.rageCap - fighter.rage));
      fighter.rage += gained;
      actualBonus += gained;
      addContribution(runtime, 'THUNDER-CHALLENGE', 'rage', gained, fighter.side);
    }
    if (actualBonus > 0) {
      frame(runtime, 'rage', `${fighter.side === 'player' ? '玩家' : '敌人'}开场回怒`, fighter.side, fighter.side, 'RULES-OPENING-RAGE', fighter.rage);
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
        else fighter.stats[stat] += stat === 'defense'
          ? amount * gambitDefenseMultiplier(fighter.artifacts)
          : amount;
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
      if (effect.operation === 'shield' && isSharedTalentEffect(runtime, fighter, effect)) {
        addShield(runtime, fighter, sharedOutputAmount(fighter, null, effect.params ?? {}, effect.stacks), effect, '共通天赋开场护盾');
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
  for (const fighter of [runtime.player, runtime.enemy]) {
    if (fighter.loadout.permanentRule?.kind !== 'shattered_core') {
      fighter.maxShield = fighter.stats.max_hp;
    }
  }
  applyOpening(runtime);
  for (const fighter of [runtime.player, runtime.enemy]) {
    const journey = journeyFacts(fighter.loadout);
    for (const mechanic of fighter.buildRules) {
      let amount = 0;
      if (mechanic.kind === 'veteran_shield') {
        amount = fighter.stats.max_hp * (
          n(mechanic.params.base_ratio, 0) +
          journey.eliteWins * n(mechanic.params.elite_ratio, 0) +
          journey.bossWins * n(mechanic.params.boss_ratio, 0)
        );
      } else if (mechanic.kind === 'wealth_shield') {
        amount = n(mechanic.params.base_shield, 0) +
          journey.coins * n(mechanic.params.shield_per_coin, 0);
      } else {
        continue;
      }
      const effect = buildEffect(fighter, mechanic);
      if (effect) addShield(runtime, fighter, amount, effect, '构筑开场护盾');
    }
    for (const core of fighter.coreRules) {
      if (core.kind !== 'shield_burst') continue;
      const amount = fighter.stats.max_hp * n(core.params.opening_shield_ratio, 0);
      addShield(runtime, fighter, amount, core.effect, '战斗开场护盾');
    }
    if (fighter.side === 'enemy' && fighter.loadout.thunderChallenge === true) {
      addShield(runtime, fighter, fighter.stats.max_hp * 0.15, 'THUNDER-CHALLENGE', '雷霆挑战开场护盾', 0, false);
    }
    if (fighter.loadout.permanentRule?.kind === 'shattered_core') {
      addShield(
        runtime,
        fighter,
        fighter.loadout.permanentRule.originalMaxHp * 2.5,
        'RE037-A',
        '碎丹化婴开场护盾',
        0,
        false,
      );
    }
  }
  for (const fighter of [runtime.player, runtime.enemy]) {
    const swords = resonanceRule(fighter, 'sword_array');
    if (swords) {
      setResonanceState(fighter, swords, 'flying_swords', int(swords.params.opening_swords, 0));
    }
  }
  frame(runtime, 'start', '战斗开始');
  for (const fighter of [runtime.player, runtime.enemy]) {
    if (fighter.trial) emitEnemyTrialCharge(runtime, fighter);
  }
}

function chooseAction(fighter: Fighter): { type: LockedActionType; cost: number } {
  if (fighter.loadout.permanentRule?.kind === 'endless_chain') {
    // This rule is absolute: a queued forced basic cannot replace its wait or rage action.
    fighter.forcedBasic = null;
    return fighter.rage >= fighter.rageCap
      ? { type: 'rage_action', cost: fighter.rageCap }
      : { type: 'wait', cost: 0 };
  }
  if (fighter.forcedBasic) return { type: 'basic_action', cost: 0 };
  if (fighter.rage >= fighter.rageCap) return { type: 'rage_action', cost: fighter.rageCap };
  return { type: 'basic_action', cost: 0 };
}

function executeLockedAction(
  runtime: BattleRuntime,
  actor: Fighter,
  target: Fighter,
  choice: { type: LockedActionType; cost: number },
): void {
  if (choice.type === 'wait') {
    frame(runtime, 'wait', `${actor.side === 'player' ? '玩家' : '敌人'}蓄气等待，尚未达到怒气上限`, actor.side, actor.side, 'RE037-C');
    return;
  }
  executeAction(runtime, actor, target, choice.type, choice.cost);
}

function createFighter(
  runtime: BattleRuntime,
  side: 'player' | 'enemy',
  loadout: Loadout,
): Fighter {
  const compiled = validateLoadout(runtime.content, loadout, side);
  const stats = calculateStatsForSide(runtime.content, loadout, side);
  const fighter: Fighter = {
    artifactAwakenings: runtime.artifactAwakenings,
    side,
    loadout,
    method: compiled.method,
    companions: compiled.companions.map(method => ({
      method,
      sourceId: `${method.id}-COMPANION`,
      usesAlternateEffect: false,
    })),
    talents: compiled.talents,
    artifacts: compiled.artifacts,
    coreRules: [],
    buildRules: selectedBuildMechanics(runtime.content, loadout),
    stats,
    hp: clamp(n(loadout.hp, stats.max_hp), 0, stats.max_hp),
    shield: 0,
    maxShield: loadout.permanentRule?.kind === 'shattered_core'
      ? loadout.permanentRule.originalMaxHp * 2.5
      : stats.max_hp,
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
    trial: compiled.trial,
    ...(compiled.trial ? {
      trialCharges: compiled.trial.charges,
      trialCountdown: compiled.trial.period,
    } : {}),
  };
  (fighter as AnyMap).__content = runtime.content;
  fighter.coreRules = coreRulesForFighter(fighter);
  fighter.rageCap = staticRageCap(fighter);
  if (loadout.encounterId) {
    runtime.sourceNames.set(loadout.encounterId, entity(runtime.content, loadout.encounterId, 'enemy').name);
  }
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
  options: { roundLimit?: number; artifactAwakenings?: boolean } = {},
): BattleResult {
  if (typeof seed !== 'string') throw new Error('Battle seed must be a string');
  const roundLimit = options.roundLimit === undefined ? 256 : options.roundLimit;
  if (!Number.isInteger(roundLimit) || roundLimit <= 0) throw new Error('roundLimit must be a positive integer');
  validateEnemyTrials(content);
  const runtime = {
    artifactAwakenings: options.artifactAwakenings !== false,
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
    artifactOutputReplayDepth: 0,
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
    prepareEnemyTrialRound(runtime);
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
    resolveEnemyTrialReleases(runtime);
    outcome = checkOutcome(runtime);
    if (outcome) break;
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
    executeLockedAction(
      runtime,
      first,
      first === runtime.player ? runtime.enemy : runtime.player,
      first === runtime.player ? pChoice : eChoice,
    );
    outcome = checkOutcome(runtime);
    if (outcome) break;
    executePreparedFirstStrike(runtime, second, second === runtime.player ? runtime.enemy : runtime.player);
    outcome = checkOutcome(runtime);
    if (outcome) break;
    executeLockedAction(
      runtime,
      second,
      second === runtime.player ? runtime.enemy : runtime.player,
      second === runtime.player ? pChoice : eChoice,
    );
    outcome = checkOutcome(runtime);
    if (outcome) break;
    processRoundDots(runtime);
    outcome = checkOutcome(runtime);
    if (outcome) break;
    if (runtime.player.hp > 0) {
      registerRage(runtime, runtime.player, n(rules(content).rage?.round_end, 10), 'RULES-ROUND-END', runtime.player.method.id);
      if (runtime.player.loadout.permanentRule?.kind === 'endless_chain') {
        registerRage(runtime, runtime.player, 80, 'RE037-C', 'RE037-C');
      }
    }
    if (runtime.enemy.hp > 0) registerRage(runtime, runtime.enemy, n(rules(content).rage?.round_end, 10), 'RULES-ROUND-END', runtime.enemy.method.id);
    for (const fighter of [runtime.player, runtime.enemy]) {
      if (fighter.hp <= 0) continue;
      for (const artifact of fighter.artifacts) {
        if (artifact.entity.id !== 'RC21') continue;
        registerRage(runtime, fighter, 5 * artifact.stacks, artifact.entity.id, artifact.entity.id);
      }
      const roundTalent = selectedEffect(fighter, 'RKF02-J2-B-ROUND-RAGE');
      if (roundTalent) registerRage(runtime, fighter, n(roundTalent.params?.amount, 10), roundTalent.id, roundTalent.ownerId);
      for (const effect of activeModifiers(fighter)) {
        if (!isSharedTalentEffect(runtime, fighter, effect) ||
            effect.trigger !== 'round_end' || effect.operation !== 'rage_gain') continue;
        registerRage(runtime, fighter, n(effect.params?.amount, 0) * effect.stacks, effect.id, effect.ownerId);
      }
    }
    settleRage(runtime);
    for (const fighter of [runtime.player, runtime.enemy]) {
      const cap = selectedEffect(fighter, 'RR07-FIRST-RAGE-CAP-REDUCTION');
      if (cap && fighter.battleFlags.has('RR07-PENDING')) {
        const previousCap = fighter.rageCap;
        fighter.rageCap = normalizeRageCap(fighter, fighter.rageCap + n(cap.params?.delta, -15));
        fighter.rage = Math.min(fighter.rage, fighter.rageCap);
        fighter.battleFlags.delete('RR07-PENDING');
        if (fighter.rageCap !== previousCap) {
          frame(runtime, 'rage', `${fighter.side === 'player' ? '玩家' : '敌人'}怒气上限调整`, fighter.side, fighter.side, cap.id, fighter.rageCap);
        }
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
  const permanentRuleContributionId = runtime.player.loadout.permanentRule?.kind === 'shattered_core'
    ? 'RE037-A'
    : runtime.player.loadout.permanentRule?.kind === 'blind_sword'
      ? 'RE037-B'
      : runtime.player.loadout.permanentRule?.kind === 'endless_chain'
        ? 'RE037-C'
        : undefined;
  const contributions = [...runtime.contributions.values()].filter(contribution =>
    runtime.player.side === 'player' && (
      contribution.id === runtime.player.method.id ||
      runtime.player.talents.some(talent => talent.id === contribution.id) ||
      runtime.player.artifacts.some(artifact => artifact.entity.id === contribution.id) ||
      runtime.player.companions.some(companion => companion.sourceId === contribution.id) ||
      contribution.id === permanentRuleContributionId
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
