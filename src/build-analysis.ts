import {
 Ability,
 Condition,
 Content,
 Effect,
 LoadoutSlot,
 RunState,
 Slot,
 abilityLoadoutSlot,
 abilityMechanicTags,
 playerStats,
 SLOT_ORDER,
 value,
} from './engine.js';

/**
 * This module is deliberately independent from `abilityRole` and `rollAbilities`.
 * It describes concrete, reachable inputs instead of assigning a single score.
 */

export type BuildSourceKind = 'ability' | 'race' | 'origin' | 'fate' | 'talent' | 'rule';
export type BuildTarget = 'self' | 'enemy' | 'unknown';
export type BuildStatus = 'missing-input' | 'reachable' | 'threshold' | 'unknown';
export type SourceStatus = 'reachable' | 'unknown' | 'unreachable';
export type BuildResourceKind = 'status' | 'resource' | 'effect' | 'event';
export type GateKind =
  | 'action'
  | 'condition'
  | 'event'
  | 'requires-tags'
  | 'any-tags'
  | 'exclude-tags'
  | 'chance'
  | 'frequency'
  | 'strategy'
  | 'unknown';

export type BuildNumber = number | number[];

export interface BuildResource {
  kind: BuildResourceKind;
  type?: BuildResourceKind;
  key: string;
  status?: string;
  resource?: string;
  target: BuildTarget;
  value?: BuildNumber;
  amount?: number;
  coefficient?: BuildNumber;
  threshold?: number;
  order?: number;
  sourceRuleId?: string;
  event?: string;
}

export interface BuildGate {
  kind: GateKind;
  type?: string;
  event?: string;
  action?: 'basic' | 'rage';
  condition?: Condition;
  target?: BuildTarget;
  key?: string;
  value?: number | string;
  threshold?: number;
  requiresTags?: string[];
  anyTags?: string[];
  excludeTags?: string[];
  status: SourceStatus | 'met' | 'unmet';
  reason?: string;
}

export interface BuildSourceRef {
  id: string;
  ruleId: string;
  name: string;
  kind: BuildSourceKind;
  slot?: Slot | LoadoutSlot;
  contentSlot?: Slot;
  slotIndex?: number;
  rank?: number;
  event?: string;
}

export interface BuildSource {
  id: string;
  ruleId: string;
  sourceId: string;
  name: string;
  kind: BuildSourceKind;
  type: BuildSourceKind;
  source: BuildSourceRef;
  slot?: Slot | LoadoutSlot;
  contentSlot?: Slot;
  slotIndex?: number;
  rank?: number;
  event: string;
  trigger?: string;
  tags: string[];
  produces: BuildResource[];
  reads: BuildResource[];
  consumes: BuildResource[];
  gates: BuildGate[];
  status: SourceStatus;
  reason?: string;
}

export interface BuildEvent {
  id: string;
  event: string;
  sourceId: string;
  sourceRuleId?: string;
  sourceName: string;
  tags: string[];
  status: SourceStatus;
  target?: BuildTarget;
  reason?: string;
}

export interface BuildSourceCollection {
  sources: BuildSource[];
  events: BuildEvent[];
  produces: BuildResource[];
  reads: BuildResource[];
  consumes: BuildResource[];
  gates: BuildGate[];
  byResource: Record<string, BuildSourceRef[]>;
  byEvent: Record<string, BuildEvent[]>;
}

export interface BuildDependency {
  resource: BuildResource;
  status: BuildStatus;
  producers: BuildSourceRef[];
  reachableProducers: BuildSourceRef[];
  unknownProducers: BuildSourceRef[];
  targetMatched: boolean;
  threshold?: number;
  knownAmount?: number;
  repeatable?: boolean;
  reason: string;
}

export interface PlacementInfo {
  slotIndex?: number;
  role: LoadoutSlot;
  valid: boolean;
  replaces?: BuildSourceRef;
  empty?: boolean;
  upgrade?: boolean;
  reason?: string;
}

export interface AbilityFitAnalysis {
  status: BuildStatus;
  statusLabel: string;
  candidate: BuildSourceRef;
  placement?: PlacementInfo;
  produces: BuildResource[];
  reads: BuildResource[];
  consumes: BuildResource[];
  gates: BuildGate[];
  dependencies: BuildDependency[];
  missing: BuildDependency[];
  reachable: BuildDependency[];
  threshold: BuildDependency[];
  unknown: BuildDependency[];
  sources: BuildSourceCollection;
  independent: boolean;
  reasons: string[];
  uncertainty: string[];
}

export interface ResourceSourceChange {
  resource: BuildResource;
  gainedSources: BuildSourceRef[];
  lostSources: BuildSourceRef[];
  retainedSources: BuildSourceRef[];
  remainingSources: BuildSourceRef[];
}

export interface LoadoutComparison {
  status: BuildStatus | 'replace-required';
  statusLabel: string;
  incoming: BuildSourceRef;
  outgoing?: BuildSourceRef;
  targetSlotIndex?: number;
  targetRole: LoadoutSlot;
  placement?: PlacementInfo;
  before: BuildSourceCollection;
  after: BuildSourceCollection;
  fit: AbilityFitAnalysis;
  analysis: AbilityFitAnalysis;
  gainedSources: BuildSourceRef[];
  lostSources: BuildSourceRef[];
  retainedSources: BuildSourceRef[];
  addedSources: BuildSourceRef[];
  removedSources: BuildSourceRef[];
  keptSources: BuildSourceRef[];
  resourceChanges: ResourceSourceChange[];
  changes: ResourceSourceChange[];
  reasons: string[];
  uncertainty: string[];
}

export type AbilityCandidate = Ability | string;
export type Placement = number | {slotIndex?: number; targetSlotIndex?: number; index?: number; rank?: number};

const STATUS_LABELS: Record<BuildStatus | 'replace-required', string> = {
  'missing-input': '缺少输入',
  reachable: '可触达',
  threshold: '需阈值',
  unknown: '尚不能确认',
  'replace-required': '需要指定替换位',
};

const STATUS_KEYS = new Set(['burn', 'weak', 'break', 'stun', 'vulnerable']);
const TRIGGER_EVENTS = new Set([
  'battle_start',
  'before_action',
  'after_action',
  'on_hit',
  'on_damage',
  'on_crit',
  'on_evade',
  'on_heal',
  'on_shield_gain',
  'on_status_apply',
  'on_status_tick',
  'on_consume',
  'on_rage_spend',
  'on_damaged',
  'on_rage_skill',
  'hp_threshold',
  'round_end',
  'battle_end',
]);

const EVENT_STATUS_PRIORITY: Record<SourceStatus, number> = {
  reachable: 3,
  unknown: 2,
  unreachable: 1,
};

interface SourceMeta {
  sourceId: string;
  name: string;
  kind: BuildSourceKind;
  slot?: Slot | LoadoutSlot;
  contentSlot?: Slot;
  slotIndex?: number;
  rank?: number;
  tags?: string[];
}

interface RawSource {
  source: BuildSource;
  meta: SourceMeta;
  action?: 'basic' | 'rage';
  direct?: boolean;
}

interface ResolutionContext {
  content: Content;
  state: RunState;
  collection: BuildSourceCollection;
  raw: RawSource[];
  sourceStatus: Map<string, SourceStatus>;
  events: BuildEvent[];
}

interface ProducerResolution {
  status: BuildStatus;
  producers: BuildSource[];
  targetMatched: boolean;
  knownAmount: number;
  repeatable: boolean;
  reason: string;
}

interface ConditionResolution {
  status: SourceStatus | 'met' | 'unmet';
  reason?: string;
  dependency?: BuildDependency;
}

function targetForEffect(effect: Effect): BuildTarget {
  if (effect.target === 'self') return 'self';
  if (effect.target === 'enemy') return 'enemy';
  // `simulateBattle` defaults apply() to the other fighter when target is omitted.
  return 'enemy';
}

function targetForCondition(condition: Condition): BuildTarget {
  if (condition.target === 'enemy') return 'enemy';
  if (condition.target === 'self') return 'self';
  return 'self';
}

function targetForResourceDamage(effect: Effect): BuildTarget {
  if (effect.resourceTarget === 'self') return 'self';
  if (effect.resourceTarget === 'enemy') return 'enemy';
  return 'enemy';
}

/**
 * Event targets are expressed from the perspective of the fighter whose
 * trigger is being analyzed. When the runtime can only provide an event
 * without a concrete target, the analysis must stay conservative.
 */
function eventTargetForConsumer(event: string): BuildTarget | undefined {
  switch (event) {
    case 'on_damage':
    case 'on_hit':
    case 'on_crit':
    case 'on_status_apply':
      return 'enemy';
    case 'on_heal':
    case 'on_shield_gain':
    case 'on_status_tick':
    case 'on_damaged':
    case 'on_evade':
      return 'self';
    default:
      return undefined;
  }
}

function resourceKind(key: string): BuildResourceKind {
  if (STATUS_KEYS.has(key) || key === 'shield') return key === 'shield' ? 'resource' : 'status';
  if (key === 'rage') return 'resource';
  return 'effect';
}

function resourceKey(resource: BuildResource): string {
  return `${resource.kind}:${resource.key}:${resource.target}`;
}

function eventKey(event: string, tags: string[] = []): string {
  return `${event}:${[...tags].sort().join(',')}`;
}

function sourceRef(source: BuildSource): BuildSourceRef {
  return {
    id: source.sourceId,
    ruleId: source.ruleId,
    name: source.name,
    kind: source.kind,
    slot: source.slot,
    contentSlot: source.contentSlot,
    slotIndex: source.slotIndex,
    rank: source.rank,
    event: source.event,
  };
}

function sourceRefKey(ref: BuildSourceRef): string {
  return `${ref.ruleId}`;
}

function uniqueResources(resources: BuildResource[]): BuildResource[] {
  const seen = new Set<string>();
  return resources.filter(resource => {
    const key = [
      resourceKey(resource),
      resource.threshold ?? '',
      resource.amount ?? '',
      resource.order ?? '',
      resource.sourceRuleId ?? '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueRefs(refs: BuildSourceRef[]): BuildSourceRef[] {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = sourceRefKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addResource(
  list: BuildResource[],
  resource: Omit<BuildResource, 'sourceRuleId'>,
  ruleId: string,
): void {
  list.push({...resource, type: resource.kind, sourceRuleId: ruleId});
}

function effectFacts(
  effect: Effect,
  rank: number,
  ruleId: string,
  order: number,
): {produces: BuildResource[]; reads: BuildResource[]; consumes: BuildResource[]} {
  const produces: BuildResource[] = [];
  const reads: BuildResource[] = [];
  const consumes: BuildResource[] = [];
  const target = targetForEffect(effect);
  const amount = value(effect.value, rank);
  switch (effect.type) {
    case 'damage':
      addResource(produces, {
        kind: 'effect',
        key: 'damage',
        target,
        value: effect.value,
        amount,
        coefficient: effect.coefficient,
        order,
      }, ruleId);
      break;
    case 'heal':
      addResource(produces, {
        kind: 'effect',
        key: 'heal',
        target,
        value: effect.value,
        amount,
        coefficient: effect.maxHpPercent,
        order,
      }, ruleId);
      break;
    case 'gain_shield':
      addResource(produces, {
        kind: 'resource',
        key: 'shield',
        resource: 'shield',
        target,
        value: effect.value,
        amount,
        coefficient: effect.coefficient,
        order,
      }, ruleId);
      break;
    case 'gain_rage':
      addResource(produces, {
        kind: 'resource',
        key: 'rage',
        resource: 'rage',
        target,
        value: effect.value,
        amount,
        order,
      }, ruleId);
      break;
    case 'apply_status':
      if (effect.status) {
        addResource(produces, {
          kind: 'status',
          key: effect.status,
          status: effect.status,
          target,
          value: effect.value,
          amount,
          order,
        }, ruleId);
      }
      break;
    case 'resource_damage': {
      const key = effect.resource ?? 'unknown';
      addResource(reads, {
        kind: resourceKind(key),
        key,
        status: STATUS_KEYS.has(key) ? key : undefined,
        resource: key,
        target: targetForResourceDamage(effect),
        threshold: effect.cap,
        order,
        event: 'resource_damage',
      }, ruleId);
      addResource(produces, {
        kind: 'effect',
        key: 'damage',
        target,
        coefficient: effect.coefficient,
        order,
      }, ruleId);
      break;
    }
    case 'consume_status':
      if (effect.status) {
        addResource(reads, {
          kind: 'status',
          key: effect.status,
          status: effect.status,
          target,
          threshold: amount || 1,
          order,
        }, ruleId);
        addResource(consumes, {
          kind: 'status',
          key: effect.status,
          status: effect.status,
          target,
          value: effect.value,
          amount,
          order,
        }, ruleId);
      }
      break;
    case 'consume_shield':
      addResource(reads, {
        kind: 'resource',
        key: 'shield',
        resource: 'shield',
        target,
        threshold: amount || 1,
        order,
      }, ruleId);
      addResource(consumes, {
        kind: 'resource',
        key: 'shield',
        resource: 'shield',
        target,
        value: effect.value,
        amount,
        order,
      }, ruleId);
      break;
    case 'lose_rage':
      addResource(reads, {
        kind: 'resource',
        key: 'rage',
        resource: 'rage',
        target,
        threshold: amount || 1,
        order,
      }, ruleId);
      addResource(consumes, {
        kind: 'resource',
        key: 'rage',
        resource: 'rage',
        target,
        value: effect.value,
        amount,
        order,
      }, ruleId);
      break;
    case 'remove_status':
      if (effect.status) {
        addResource(reads, {
          kind: 'status',
          key: effect.status,
          status: effect.status,
          target,
          threshold: 1,
          order,
        }, ruleId);
        addResource(consumes, {
          kind: 'status',
          key: effect.status,
          status: effect.status,
          target,
          order,
        }, ruleId);
      }
      break;
    default:
      break;
  }
  return {produces, reads, consumes};
}

function conditionFact(condition: Condition, ruleId: string): BuildResource | undefined {
  const target = targetForCondition(condition);
  if (condition.type === 'has_status' || condition.type === 'status_stack_at_least') {
    const key = condition.status ?? 'unknown';
    return {
      kind: resourceKind(key),
      type: resourceKind(key),
      key,
      status: STATUS_KEYS.has(key) ? key : undefined,
      resource: key,
      target,
      threshold: condition.type === 'status_stack_at_least' ? (condition.value ?? 1) : 1,
      sourceRuleId: ruleId,
    };
  }
  if (condition.type === 'rage_at_least') {
    return {
      kind: 'resource',
      type: 'resource',
      key: 'rage',
      resource: 'rage',
      target,
      threshold: condition.value ?? 1,
      sourceRuleId: ruleId,
    };
  }
  return undefined;
}

function conditionGate(condition: Condition): BuildGate {
  const fact = conditionFact(condition, '');
  return {
    kind: 'condition',
    type: condition.type,
    condition,
    target: fact?.target,
    key: fact?.key,
    threshold: fact?.threshold,
    status: 'unknown',
  };
}

function actionForAbility(ability: Ability): 'basic' | 'rage' | undefined {
  if (ability.slot === 'basic') return 'basic';
  if (ability.slot === 'rage') return 'rage';
  return undefined;
}

function conversionEventName(from: string): string {
  switch (from) {
    case 'damage':
      return 'on_damage';
    case 'damage_taken':
      return 'on_damaged';
    case 'heal':
      return 'on_heal';
    case 'shield_gain':
      return 'on_shield_gain';
    case 'rage_spend':
      return 'on_rage_spend';
    case 'status_tick':
      return 'on_status_tick';
    case 'status_consume':
      return 'on_consume';
    default:
      return `conversion.${from}`;
  }
}

function addActionGate(source: BuildSource, action: 'basic' | 'rage', role: LoadoutSlot): void {
  source.gates.push({
    kind: 'action',
    action,
    status: role === action ? 'met' : 'unmet',
    reason: role === action ? undefined : `需要${action === 'basic' ? '普攻' : '怒技'}槽`,
  });
}

function makeSource(meta: SourceMeta, ruleId: string, event: string, trigger?: string): BuildSource {
  const source: BuildSource = {
    id: ruleId,
    ruleId,
    sourceId: meta.sourceId,
    name: meta.name,
    kind: meta.kind,
    type: meta.kind,
    source: {
      id: meta.sourceId,
      ruleId,
      name: meta.name,
      kind: meta.kind,
      slot: meta.slot,
      contentSlot: meta.contentSlot,
      slotIndex: meta.slotIndex,
      rank: meta.rank,
      event,
    },
    slot: meta.slot,
    contentSlot: meta.contentSlot,
    slotIndex: meta.slotIndex,
    rank: meta.rank,
    event,
    trigger,
    tags: [...(meta.tags ?? [])],
    produces: [],
    reads: [],
    consumes: [],
    gates: [],
    status: 'unknown',
  };
  return source;
}

function appendTriggerFacts(source: BuildSource, trigger: {on: string; effects: Effect[]; conditions?: Condition[]; requiresTags?: string[]; anyTags?: string[]; excludeTags?: string[]; chance?: number; once?: boolean; maxPerRound?: number}, rank: number): void {
  const target = eventTargetForConsumer(trigger.on);
  source.gates.push({
    kind: 'event',
    event: trigger.on,
    target,
    status: 'unknown',
  });
  if (trigger.requiresTags?.length) {
    source.gates.push({
      kind: 'requires-tags',
      event: trigger.on,
      target,
      requiresTags: [...trigger.requiresTags],
      status: 'unknown',
    });
  }
  if (trigger.anyTags?.length) {
    source.gates.push({
      kind: 'any-tags',
      event: trigger.on,
      target,
      anyTags: [...trigger.anyTags],
      status: 'unknown',
    });
  }
  if (trigger.excludeTags?.length) {
    source.gates.push({
      kind: 'exclude-tags',
      event: trigger.on,
      target,
      excludeTags: [...trigger.excludeTags],
      status: 'unknown',
    });
  }
  for (const condition of trigger.conditions ?? []) source.gates.push(conditionGate(condition));
  if (trigger.chance !== undefined && trigger.chance < 100) {
    source.gates.push({
      kind: 'chance',
      value: trigger.chance,
      status: 'unknown',
      reason: '触发带有概率限制',
    });
  }
  if (trigger.once || trigger.maxPerRound !== undefined) {
    source.gates.push({
      kind: 'frequency',
      value: trigger.once ? 'once' : trigger.maxPerRound,
      status: 'met',
      reason: trigger.once ? '每战至多一次' : `每轮至多${trigger.maxPerRound}次`,
    });
  }
  for (let i = 0; i < trigger.effects.length; i++) {
    const facts = effectFacts(trigger.effects[i], rank, source.ruleId, i);
    source.produces.push(...facts.produces);
    source.reads.push(...facts.reads);
    source.consumes.push(...facts.consumes);
  }
  source.produces = uniqueResources(source.produces);
  source.reads = uniqueResources(source.reads);
  source.consumes = uniqueResources(source.consumes);
}

function appendAbilitySources(
  collection: BuildSourceCollection,
  raw: RawSource[],
  ability: Ability,
  meta: SourceMeta,
): void {
  const action = actionForAbility(ability);
  const directRuleId = `ability:${ability.id}:action`;
  const direct = makeSource(meta, directRuleId, action ? `action.${action}` : 'passive');
  if (action) addActionGate(direct, action, abilityLoadoutSlot(ability));
  for (let i = 0; i < ability.effects.length; i++) {
    const facts = effectFacts(ability.effects[i], meta.rank ?? 0, direct.ruleId, i);
    direct.produces.push(...facts.produces);
    direct.reads.push(...facts.reads);
    direct.consumes.push(...facts.consumes);
  }
  direct.produces = uniqueResources(direct.produces);
  direct.reads = uniqueResources(direct.reads);
  direct.consumes = uniqueResources(direct.consumes);
  collection.sources.push(direct);
  raw.push({source: direct, meta, action, direct: true});

  for (let i = 0; i < ability.triggers.length; i++) {
    const trigger = ability.triggers[i];
    const ruleId = `ability:${ability.id}:trigger:${i}`;
    const source = makeSource(meta, ruleId, trigger.on, trigger.on);
    appendTriggerFacts(source, trigger, meta.rank ?? 0);
    collection.sources.push(source);
    raw.push({source, meta});
  }
  for (let i = 0; i < (ability.relicConversions ?? []).length; i++) {
    const conversion = ability.relicConversions![i];
    const ruleId = `ability:${ability.id}:conversion:${i}`;
    const triggerEvent = conversionEventName(conversion.from);
    const source = makeSource(meta, ruleId, `conversion.${conversion.from}`);
    const fromTarget: BuildTarget = conversion.from === 'damage_taken' ? 'self' : 'unknown';
    addResource(source.reads, {
      kind: 'event',
      key: conversion.from,
      target: fromTarget,
      event: triggerEvent,
    }, ruleId);
    if (conversion.status) {
      addResource(source.reads, {
        kind: resourceKind(conversion.status),
        key: conversion.status,
        status: conversion.status,
        target: conversion.from === 'status_tick' ? 'self' : 'enemy',
        event: triggerEvent,
      }, ruleId);
    }
    const outputTarget: BuildTarget = conversion.to === 'damage' ? 'enemy' : 'self';
    const outputKind: BuildResourceKind = conversion.to === 'damage' || conversion.to === 'heal' ? 'effect' : 'resource';
    addResource(source.produces, {
      kind: outputKind,
      key: conversion.to,
      resource: ['rage', 'shield'].includes(conversion.to) ? conversion.to : undefined,
      target: outputTarget,
      coefficient: conversion.percent,
      event: triggerEvent,
    }, ruleId);
    source.gates.push({kind: 'event', event: triggerEvent, status: 'unknown'});
    source.produces = uniqueResources(source.produces);
    source.reads = uniqueResources(source.reads);
    collection.sources.push(source);
    raw.push({source, meta});
  }
  if (ability.strategyRules?.length || ability.defaultAction) {
    const ruleId = `ability:${ability.id}:strategy`;
    const source = makeSource(meta, ruleId, 'strategy');
    for (const strategyRule of ability.strategyRules ?? []) {
      source.gates.push({
        kind: 'strategy',
        action: strategyRule.action,
        status: 'unknown',
        reason: strategyRule.label,
      });
      for (const condition of strategyRule.conditions ?? []) {
        source.gates.push(conditionGate(condition));
        const fact = conditionFact(condition, source.ruleId);
        if (fact) source.reads.push(fact);
      }
    }
    if (ability.defaultAction) {
      source.gates.push({
        kind: 'strategy',
        action: ability.defaultAction,
        status: 'met',
        reason: '战策默认行动',
      });
    }
    source.reads = uniqueResources(source.reads);
    collection.sources.push(source);
    raw.push({source, meta});
  }
}

function appendExternalSource(
  collection: BuildSourceCollection,
  raw: RawSource[],
  meta: SourceMeta,
  effects: Effect[],
  event: string,
  ruleSuffix: string,
  rank = 0,
): void {
  const ruleId = `${meta.sourceId}:${ruleSuffix}`;
  const source = makeSource(meta, ruleId, event, event);
  source.gates.push({kind: 'event', event, status: 'unknown'});
  for (let i = 0; i < effects.length; i++) {
    const facts = effectFacts(effects[i], rank, source.ruleId, i);
    source.produces.push(...facts.produces);
    source.reads.push(...facts.reads);
    source.consumes.push(...facts.consumes);
  }
  source.produces = uniqueResources(source.produces);
  source.reads = uniqueResources(source.reads);
  source.consumes = uniqueResources(source.consumes);
  collection.sources.push(source);
  raw.push({source, meta});
}

function appendConditionReads(source: BuildSource): void {
  for (const gate of source.gates) {
    if (gate.kind !== 'condition' || !gate.condition) continue;
    const fact = conditionFact(gate.condition, source.ruleId);
    if (fact) source.reads.push(fact);
  }
  source.reads = uniqueResources(source.reads);
}

function baseCollection(content: Content, state: RunState, slots: (RunState['slots'][number])[] = state.slots): {collection: BuildSourceCollection; raw: RawSource[]} {
  const collection: BuildSourceCollection = {
    sources: [],
    events: [],
    produces: [],
    reads: [],
    consumes: [],
    gates: [],
    byResource: {},
    byEvent: {},
  };
  const raw: RawSource[] = [];

  const origin = content.origins.find(item => item.id === state.origin);
  if (origin?.battleStartEffects?.length) {
    appendExternalSource(
      collection,
      raw,
      {sourceId: `origin.${origin.id}`, name: origin.name, kind: 'origin'},
      origin.battleStartEffects,
      'battle_start',
      'battle-start',
    );
  }
  const race = content.races.find(item => item.id === state.race);
  if (race) {
    for (let i = 0; i < race.triggers.length; i++) {
      const ruleId = `race.${race.id}:trigger:${i}`;
      const source = makeSource(
        {sourceId: `race.${race.id}`, name: race.name, kind: 'race', tags: []},
        ruleId,
        race.triggers[i].on,
        race.triggers[i].on,
      );
      appendTriggerFacts(source, race.triggers[i], 0);
      collection.sources.push(source);
      raw.push({source, meta: {sourceId: `race.${race.id}`, name: race.name, kind: 'race'}});
    }
  }
  const fate = content.fates.find(item => item.id === state.fate);
  if (fate) {
    for (let i = 0; i < (fate.triggers ?? []).length; i++) {
      const ruleId = `${fate.id}:trigger:${i}`;
      const source = makeSource(
        {sourceId: fate.id, name: fate.name, kind: 'fate', tags: []},
        ruleId,
        fate.triggers![i].on,
        fate.triggers![i].on,
      );
      appendTriggerFacts(source, fate.triggers![i], 0);
      collection.sources.push(source);
      raw.push({source, meta: {sourceId: fate.id, name: fate.name, kind: 'fate'}});
    }
  }
  for (const talentId of state.talents ?? []) {
    const talent = content.talents.find(item => item.id === talentId);
    if (!talent) continue;
    for (let i = 0; i < talent.triggers.length; i++) {
      const ruleId = `talent.${talent.id}:trigger:${i}`;
      const source = makeSource(
        {sourceId: talent.id, name: talent.name, kind: 'talent', tags: []},
        ruleId,
        talent.triggers[i].on,
        talent.triggers[i].on,
      );
      appendTriggerFacts(source, talent.triggers[i], 0);
      collection.sources.push(source);
      raw.push({source, meta: {sourceId: talent.id, name: talent.name, kind: 'talent'}});
    }
  }

  slots.forEach((equipped, slotIndex) => {
    if (!equipped) return;
    const ability = content.abilities.find(item => item.id === equipped.id);
    if (!ability) return;
    const role = abilityLoadoutSlot(ability);
    appendAbilitySources(
      collection,
      raw,
      ability,
      {
        sourceId: ability.id,
        name: ability.name,
        kind: 'ability',
        slot: role,
        contentSlot: ability.slot,
        slotIndex,
        rank: equipped.rank,
        tags: abilityMechanicTags(ability),
      },
    );
  });

  const basicIndex = slots.findIndex((equipped, index) => equipped && SLOT_ORDER[index] === 'basic');
  const rageIndex = slots.findIndex((equipped, index) => equipped && SLOT_ORDER[index] === 'rage');
  if (basicIndex >= 0) {
    const meta: SourceMeta = {sourceId: 'rule.basic-rage', name: '基础规则：普攻回气', kind: 'rule', slot: 'basic', slotIndex: basicIndex};
    const source = makeSource(meta, 'rule:basic-rage', 'after_basic_action');
    source.gates.push({kind: 'action', action: 'basic', status: 'met'});
    addResource(source.produces, {
      kind: 'resource',
      key: 'rage',
      resource: 'rage',
      target: 'self',
      amount: content.rules.basicRage,
      value: content.rules.basicRage,
      order: 0,
    }, source.ruleId);
    collection.sources.push(source);
    raw.push({source, meta, action: 'basic'});
  }
  {
    const meta: SourceMeta = {sourceId: 'rule.hit-rage', name: '基础规则：受击回气', kind: 'rule'};
    const source = makeSource(meta, 'rule:hit-rage', 'after_enemy_hit');
    source.gates.push({kind: 'event', event: 'after_enemy_hit', status: 'unknown', reason: '需要敌方攻击实际命中'});
    addResource(source.produces, {
      kind: 'resource',
      key: 'rage',
      resource: 'rage',
      target: 'self',
      amount: content.rules.hitRage,
      value: content.rules.hitRage,
      order: 0,
    }, source.ruleId);
    collection.sources.push(source);
    raw.push({source, meta});
  }
  if (rageIndex >= 0) {
    const equipped = slots[rageIndex];
    const ability = equipped ? content.abilities.find(item => item.id === equipped.id) : undefined;
    const meta: SourceMeta = {sourceId: 'rule.rage-action', name: '基础规则：怒技行动', kind: 'rule', slot: 'rage', slotIndex: rageIndex};
    const source = makeSource(meta, 'rule:rage-action', 'rage_action');
    source.gates.push({kind: 'action', action: 'rage', status: 'met'});
    if (ability?.cost) {
      addResource(source.reads, {
        kind: 'resource',
        key: 'rage',
        resource: 'rage',
        target: 'self',
        threshold: ability.cost,
        order: 0,
      }, source.ruleId);
    }
    collection.sources.push(source);
    raw.push({source, meta, action: 'rage'});
  }

  for (const source of collection.sources) appendConditionReads(source);
  return {collection, raw};
}

function addEvent(events: BuildEvent[], event: BuildEvent): void {
  const existing = events.find(item => item.id === event.id);
  if (!existing) {
    events.push(event);
    return;
  }
  if (EVENT_STATUS_PRIORITY[event.status] > EVENT_STATUS_PRIORITY[existing.status]) existing.status = event.status;
  for (const tag of event.tags) if (!existing.tags.includes(tag)) existing.tags.push(tag);
  if (!existing.reason && event.reason) existing.reason = event.reason;
}

function staticEvents(context: ResolutionContext): BuildEvent[] {
  const events: BuildEvent[] = [];
  const add = (event: string, sourceId: string, sourceName: string, status: SourceStatus, tags: string[] = [], reason?: string, target?: BuildTarget): void => {
    addEvent(events, {
      id: `event:${event}:${sourceId}:${tags.sort().join(',')}`,
      event,
      sourceId,
      sourceRuleId: sourceId,
      sourceName,
      tags,
      status,
      reason,
      target,
    });
  };
  add('battle_start', 'rule:battle-start', '基础规则：入战', 'reachable');
  add('round_end', 'rule:round-end', '基础规则：回合结束', 'reachable');
  add('hp_threshold', 'rule:hp-threshold', '基础规则：生命阈值', 'unknown', [], '取决于战斗中的生命变化');
  add('battle_end', 'rule:battle-end', '基础规则：战斗结束', 'unknown', [], '取决于战斗是否胜利并到达结算时点');
  add('on_damaged', 'rule:enemy-action', '基础规则：敌方行动', 'unknown', [], '需要敌方攻击命中自身', 'self');
  add('on_evade', 'rule:enemy-action', '基础规则：成功闪避', 'unknown', [], '需要敌方攻击且实际闪避成功', 'self');
  add('on_status_tick', 'rule:status-tick', '基础规则：持续状态结算', 'unknown', ['duration'], '需要自身存在可结算的持续状态', 'self');
  add('on_crit', 'rule:critical-hit', '基础规则：暴击', 'unknown', [], '需要攻击实际暴击', 'enemy');
  const hasAction = context.raw.some(item => item.action);
  if (hasAction) {
    add('before_action', 'rule:action', '基础规则：行动前', 'reachable');
    add('after_action', 'rule:action', '基础规则：行动后', 'reachable');
  }
  if (context.raw.some(item => item.action === 'rage')) {
    add('on_rage_skill', 'rule:rage-action', '基础规则：怒技行动', 'reachable');
    add('on_rage_spend', 'rule:rage-action', '基础规则：怒气消耗', 'reachable');
  }
  return events;
}

function sourceOutputEvents(source: BuildSource, sourceStatus: SourceStatus): BuildEvent[] {
  const events: BuildEvent[] = [];
  const add = (event: string, key: string, target: BuildTarget, tags: string[] = source.tags): void => {
    events.push({
      id: `event:${event}:${source.ruleId}:${key}:${target}`,
      event,
      sourceId: source.sourceId,
      sourceRuleId: source.ruleId,
      sourceName: source.name,
      tags: [...tags],
      status: sourceStatus,
      target,
    });
  };
  for (const resource of source.produces) {
    if (resource.key === 'damage') {
      add('on_damage', 'damage', resource.target);
      add('on_hit', 'hit', resource.target);
      add('on_crit', 'crit', resource.target);
    } else if (resource.key === 'heal') {
      add('on_heal', 'heal', resource.target);
    } else if (resource.key === 'shield') {
      add('on_shield_gain', 'shield', resource.target);
    } else if (resource.kind === 'status') {
      add('on_status_apply', resource.key, resource.target);
    }
  }
  if (source.consumes.length) add('on_consume', 'consume', 'unknown');
  return events;
}

function actionOutputEvents(raw: RawSource): BuildEvent[] {
  if (!raw.direct || !raw.action) return [];
  const source = raw.source;
  const events: BuildEvent[] = [{
    id: `event:action.${raw.action}:${source.ruleId}`,
    event: `action.${raw.action}`,
    sourceId: source.sourceId,
    sourceRuleId: source.ruleId,
    sourceName: source.name,
    tags: [...source.tags],
    status: 'reachable',
  }];
  if (raw.action === 'basic' || raw.action === 'rage') {
    events.push({
      id: `event:action.before:${source.ruleId}`,
      event: 'before_action',
      sourceId: source.sourceId,
      sourceRuleId: source.ruleId,
      sourceName: source.name,
      tags: [...source.tags],
      status: 'reachable',
    });
    events.push({
      id: `event:action.after:${source.ruleId}`,
      event: 'after_action',
      sourceId: source.sourceId,
      sourceRuleId: source.ruleId,
      sourceName: source.name,
      tags: [...source.tags],
      status: 'reachable',
    });
    if (raw.action === 'rage') {
      events.push({
        id: `event:rage-skill:${source.ruleId}`,
        event: 'on_rage_skill',
        sourceId: source.sourceId,
        sourceRuleId: source.ruleId,
        sourceName: source.name,
        tags: [...source.tags],
        status: 'reachable',
      });
      events.push({
        id: `event:rage-spend:${source.ruleId}`,
        event: 'on_rage_spend',
        sourceId: source.sourceId,
        sourceRuleId: source.ruleId,
        sourceName: source.name,
        tags: [...source.tags],
        status: 'reachable',
      });
    }
  }
  return events;
}

function buildEvents(context: ResolutionContext): BuildEvent[] {
  const events = staticEvents(context);
  for (const raw of context.raw) {
    for (const event of actionOutputEvents(raw)) addEvent(events, event);
    const status = context.sourceStatus.get(raw.source.ruleId) ?? 'unknown';
    for (const event of sourceOutputEvents(raw.source, status)) addEvent(events, event);
  }
  return events;
}

function eventMatches(events: BuildEvent[], event: string, ruleId?: string): BuildEvent[] {
  return events.filter(item => item.event === event && item.sourceRuleId !== ruleId);
}

function eventGateStatus(
  gate: BuildGate,
  events: BuildEvent[],
  ruleId: string,
): {status: SourceStatus | 'unmet'; reason?: string} {
  const event = gate.event ?? '';
  const matches = eventMatches(events, event, ruleId);
  if (!matches.length) return {status: 'unreachable', reason: `尚未找到${gate.event ?? '该事件'}的具体来源`};
  const expectedTarget = gate.target && gate.target !== 'unknown'
    ? gate.target
    : eventTargetForConsumer(event);
  const targetMatches = expectedTarget
    ? matches.filter(item => item.target === expectedTarget)
    : matches;
  const unknownTarget = expectedTarget
    ? matches.filter(item => item.target === undefined || item.target === 'unknown')
    : [];
  const reachable = targetMatches.filter(item => item.status === 'reachable');
  const unknown = targetMatches.filter(item => item.status === 'unknown');
  if (gate.kind === 'event') {
    if (reachable.length) return {status: 'reachable'};
    if (unknown.length) return {status: 'unknown', reason: unknown[0].reason};
    if (unknownTarget.length) return {status: 'unknown', reason: '事件来源存在，但目标方尚不能确认'};
    if (!targetMatches.length) return {status: 'unreachable', reason: '事件来源的目标方与当前触发条件不匹配'};
    return {status: 'unreachable', reason: '事件来源尚未可达'};
  }
  const tagMatches = matches.filter(item => {
    if (gate.requiresTags?.length && !gate.requiresTags.every(tag => item.tags.includes(tag))) return false;
    if (gate.anyTags?.length && !gate.anyTags.some(tag => item.tags.includes(tag))) return false;
    if (gate.excludeTags?.some(tag => item.tags.includes(tag))) return false;
    return true;
  });
  const taggedTargetMatches = expectedTarget
    ? tagMatches.filter(item => item.target === expectedTarget)
    : tagMatches;
  const taggedUnknownTarget = expectedTarget
    ? tagMatches.filter(item => item.target === undefined || item.target === 'unknown')
    : [];
  if (taggedTargetMatches.some(item => item.status === 'reachable')) return {status: 'reachable'};
  if (taggedTargetMatches.some(item => item.status === 'unknown')) return {status: 'unknown', reason: '匹配事件存在，但其来源仍需战斗确认'};
  if (taggedUnknownTarget.length) return {status: 'unknown', reason: '匹配事件存在，但目标方尚不能确认'};
  if (!taggedTargetMatches.length) return {status: 'unreachable', reason: '事件来源的目标方或标签与当前触发条件不匹配'};
  if (matches.some(item => item.status === 'unknown')) return {status: 'unknown', reason: '事件来源标签尚不能确认'};
  return {status: 'unreachable', reason: '事件发生过，但没有满足标签门槛的具体来源'};
}

function matchesResource(a: BuildResource, b: BuildResource): boolean {
  return a.kind === b.kind && a.key === b.key && a.target === b.target;
}

function sourceFactIsRepeatable(source: BuildSource): boolean {
  if (source.event === 'battle_start' || source.event === 'battle_end') return false;
  if (source.gates.some(gate => gate.kind === 'frequency' && (gate.value === 'once' || gate.threshold === 1))) return false;
  return true;
}

function resolveProducers(
  context: ResolutionContext,
  wanted: BuildResource,
  excludeRuleIds: Set<string>,
  threshold = wanted.threshold,
  allowOwnEarlier = false,
): ProducerResolution {
  const all = context.collection.sources.filter(source => {
    if (excludeRuleIds.has(source.ruleId)) {
      if (!allowOwnEarlier || source.sourceId !== [...excludeRuleIds][0]) return false;
    }
    return source.produces.some(produced => matchesResource(produced, wanted));
  });
  const targetMatched = context.collection.sources.some(source => source.produces.some(produced => produced.key === wanted.key && produced.target === wanted.target));
  const producers = all.filter(source => context.sourceStatus.get(source.ruleId) !== 'unreachable');
  const reachable = producers.filter(source => context.sourceStatus.get(source.ruleId) === 'reachable');
  const unknown = producers.filter(source => context.sourceStatus.get(source.ruleId) === 'unknown');
  const knownAmount = reachable.reduce((sum, source) => {
    return sum + source.produces.filter(produced => matchesResource(produced, wanted)).reduce((inner, produced) => inner + (produced.amount ?? 0), 0);
  }, 0);
  const repeatable = reachable.some(source => sourceFactIsRepeatable(source));
  if (!targetMatched) {
    return {
      status: 'missing-input',
      producers: [],
      targetMatched: false,
      knownAmount: 0,
      repeatable: false,
      reason: `${wanted.target === 'enemy' ? '敌方' : '自身'}没有${wanted.status ?? wanted.resource ?? wanted.key}来源`,
    };
  }
  if (!producers.length) {
    return {
      status: 'missing-input',
      producers: [],
      targetMatched: true,
      knownAmount: 0,
      repeatable: false,
      reason: '已有同名规则，但没有可触达的实际产生者',
    };
  }
  if (!reachable.length && unknown.length) {
    return {
      status: 'unknown',
      producers,
      targetMatched: true,
      knownAmount: 0,
      repeatable: false,
      reason: '来源存在，但触发时机或外部条件尚不能确认',
    };
  }
  if (threshold !== undefined && !repeatable && knownAmount < threshold) {
    return {
      status: 'threshold',
      producers,
      targetMatched: true,
      knownAmount,
      repeatable,
      reason: `已知来源最多提供${knownAmount}，仍需要${threshold}`,
    };
  }
  if (threshold !== undefined && !repeatable && knownAmount >= threshold) {
    return {
      status: 'reachable',
      producers,
      targetMatched: true,
      knownAmount,
      repeatable,
      reason: `已知来源可达到${threshold}门槛`,
    };
  }
  return {
    status: 'reachable',
    producers,
    targetMatched: true,
    knownAmount,
    repeatable,
    reason: threshold === undefined ? '存在可触达来源' : `存在可继续叠加的来源，仍需达到${threshold}门槛`,
  };
}

function resolveKnownCondition(
  condition: Condition,
  context: ResolutionContext,
  currentRuleId: string,
): ConditionResolution {
  switch (condition.type) {
    case 'race_is':
      return context.state.race === condition.key
        ? {status: 'met'}
        : {status: 'unmet', reason: `当前族裔不是${condition.key ?? '指定族裔'}`};
    case 'has_talent':
      return context.state.talents.includes(condition.key ?? '')
        ? {status: 'met'}
        : {status: 'unmet', reason: `尚未悟得${condition.key ?? '指定天赋'}`};
    case 'has_fact':
      return context.state.facts[condition.key ?? '']
        ? {status: 'met'}
        : {status: 'unmet', reason: `尚未拥有因果${condition.key ?? ''}`};
    case 'counter_at_least': {
      const current = context.state.counters[condition.key ?? ''] ?? 0;
      return current >= (condition.value ?? 0)
        ? {status: 'met'}
        : {status: 'unknown', reason: `当前计数尚未达到${condition.value ?? 0}，后续可由事件推进`};
    }
    case 'currency_at_least':
      return context.state.gold >= (condition.value ?? 0)
        ? {status: 'met'}
        : {status: 'unmet', reason: `当前灵石不足${condition.value ?? 0}`};
    case 'act_is':
      return context.state.act === (condition.value ?? 0)
        ? {status: 'met'}
        : {status: 'unmet', reason: `仅在指定幕次可触发`};
    case 'thread_is':
      return context.state.threads[condition.key ?? ''] === condition.text
        ? {status: 'met'}
        : {status: 'unmet', reason: '前缘分支不匹配'};
    case 'event_seen':
      return (context.state.seenEvents[condition.key ?? ''] ?? 0) >= (condition.value ?? 1)
        ? {status: 'met'}
        : {status: 'unmet', reason: '尚未经历所需前缘'};
    case 'player_tag': {
      const origin = context.content.origins.find(item => item.id === context.state.origin);
      return origin?.affinity === condition.tag
        ? {status: 'met'}
        : {status: 'unmet', reason: '当前出身标签不匹配'};
    }
    case 'enemy_tag':
      return {status: 'unknown', reason: '敌方类型只有进入战斗后才能确认'};
    case 'hp_below':
    case 'hp_above':
    case 'hp_above_absolute':
      return {status: 'unknown', reason: '生命门槛取决于战斗中的实际伤势'};
    case 'rage_at_least': {
      const wanted: BuildResource = {
        kind: 'resource',
        key: 'rage',
        resource: 'rage',
        target: targetForCondition(condition),
        threshold: condition.value ?? 1,
      };
      const resolved = resolveProducers(context, wanted, new Set([currentRuleId]), wanted.threshold);
      if (resolved.status === 'missing-input') return {status: 'unknown', reason: '怒气可以由基础规则或战斗事件积累'};
      if (resolved.status === 'threshold') return {status: 'unknown', reason: resolved.reason};
      return {status: 'unknown', reason: '怒气门槛需要进入战斗确认'};
    }
    case 'has_status':
    case 'status_stack_at_least': {
      const wanted = conditionFact(condition, currentRuleId);
      if (!wanted) return {status: 'unknown', reason: '状态条件格式无法识别'};
      const resolved = resolveProducers(context, wanted, new Set([currentRuleId]), wanted.threshold);
      const producerRefs = uniqueRefs(resolved.producers.map(sourceRef));
      const reachableRefs = uniqueRefs(resolved.producers.filter(source => context.sourceStatus.get(source.ruleId) === 'reachable').map(sourceRef));
      const unknownRefs = uniqueRefs(resolved.producers.filter(source => context.sourceStatus.get(source.ruleId) === 'unknown').map(sourceRef));
      const dependency: BuildDependency = {
        resource: wanted,
        status: resolved.status,
        producers: producerRefs,
        reachableProducers: reachableRefs,
        unknownProducers: unknownRefs,
        targetMatched: resolved.targetMatched,
        threshold: wanted.threshold,
        knownAmount: resolved.knownAmount,
        repeatable: resolved.repeatable,
        reason: resolved.reason,
      };
      if (resolved.status === 'missing-input') return {status: 'unmet', reason: resolved.reason, dependency};
      if (resolved.status === 'threshold') return {status: 'unknown', reason: resolved.reason, dependency};
      if (resolved.status === 'unknown') return {status: 'unknown', reason: resolved.reason, dependency};
      return {status: 'met', dependency};
    }
    default:
      return {status: 'unknown', reason: `条件${condition.type}尚不能由静态分析确认`};
  }
}

function resolveSourceGate(
  gate: BuildGate,
  context: ResolutionContext,
  ruleId: string,
): {status: SourceStatus | 'met' | 'unmet'; reason?: string; dependency?: BuildDependency} {
  if (gate.kind === 'event' || gate.kind === 'requires-tags' || gate.kind === 'any-tags' || gate.kind === 'exclude-tags') {
    return eventGateStatus(gate, context.events, ruleId);
  }
  if (gate.kind === 'action') {
    return gate.status === 'met' ? {status: 'met'} : {status: 'unmet', reason: gate.reason};
  }
  if (gate.kind === 'chance') return {status: 'unknown', reason: gate.reason};
  if (gate.kind === 'frequency') return {status: 'met'};
  if (gate.kind === 'strategy') return {status: 'unknown', reason: gate.reason ?? '行动偏好需要实际战斗确认'};
  if (gate.kind === 'condition' && gate.condition) return resolveKnownCondition(gate.condition, context, ruleId);
  return {status: 'unknown', reason: gate.reason ?? '存在未支持的门槛'};
}

function resolveCollection(content: Content, state: RunState, collection: BuildSourceCollection, raw: RawSource[]): BuildSourceCollection {
  const sourceStatus = new Map<string, SourceStatus>();
  for (const item of raw) sourceStatus.set(item.source.ruleId, 'unreachable');
  const context: ResolutionContext = {content, state, collection, raw, sourceStatus, events: []};
  for (let iteration = 0; iteration < raw.length + 4; iteration++) {
    context.events = buildEvents(context);
    let changed = false;
    for (const item of raw) {
      const statuses = item.source.gates.map(gate => resolveSourceGate(gate, context, item.source.ruleId));
      const next: SourceStatus = statuses.some(result => result.status === 'unmet' || result.status === 'unreachable')
        ? 'unreachable'
        : statuses.some(result => result.status === 'unknown')
          ? 'unknown'
          : 'reachable';
      if (sourceStatus.get(item.source.ruleId) !== next) {
        sourceStatus.set(item.source.ruleId, next);
        changed = true;
      }
      item.source.status = next;
      for (let i = 0; i < item.source.gates.length; i++) {
        const result = statuses[i];
        const gate = item.source.gates[i];
        gate.status = result.status;
        gate.reason = result.reason;
      }
      const reasons = statuses.map(result => result.reason).filter(Boolean);
      item.source.reason = reasons.length ? reasons.join('；') : undefined;
    }
    if (!changed) break;
  }
  context.events = buildEvents(context);
  collection.events = context.events;
  collection.produces = uniqueResources(collection.sources.flatMap(source => source.produces));
  collection.reads = uniqueResources(collection.sources.flatMap(source => source.reads));
  collection.consumes = uniqueResources(collection.sources.flatMap(source => source.consumes));
  collection.gates = collection.sources.flatMap(source => source.gates);
  collection.byResource = {};
  for (const source of collection.sources) {
    for (const produced of source.produces) {
      const key = resourceKey(produced);
      collection.byResource[key] = [...(collection.byResource[key] ?? []), sourceRef(source)];
    }
  }
  collection.byEvent = {};
  for (const event of collection.events) collection.byEvent[event.event] = [...(collection.byEvent[event.event] ?? []), event];
  return collection;
}

function resolveCandidate(content: Content, candidate: AbilityCandidate): Ability {
  if (typeof candidate !== 'string') return candidate;
  const ability = content.abilities.find(item => item.id === candidate);
  if (!ability) throw new Error(`Unknown ability: ${candidate}`);
  return ability;
}

function extractPlacement(placement?: Placement): {index?: number; rank?: number} {
  if (typeof placement === 'number') return {index: placement};
  if (!placement) return {};
  return {
    index: placement.slotIndex ?? placement.targetSlotIndex ?? placement.index,
    rank: placement.rank,
  };
}

function firstCompatibleSlot(content: Content, state: RunState, ability: Ability): number | undefined {
  const role = abilityLoadoutSlot(ability);
  const index = state.slots.findIndex((equipped, slotIndex) => !equipped && SLOT_ORDER[slotIndex] === role);
  return index < 0 ? undefined : index;
}

function virtualStateFor(
  content: Content,
  state: RunState,
  ability: Ability,
  placement?: Placement,
): {state: RunState; placement: PlacementInfo; candidateIndex?: number} {
  const role = abilityLoadoutSlot(ability);
  const {index, rank} = extractPlacement(placement);
  const slots = state.slots.map(equipped => equipped ? {...equipped} : null);
  const existingIndex = slots.findIndex(equipped => equipped?.id === ability.id);
  const selectedIndex = index ?? (existingIndex >= 0 ? existingIndex : firstCompatibleSlot(content, state, ability));
  const placementInfo: PlacementInfo = {slotIndex: selectedIndex, role, valid: true};
  if (existingIndex >= 0 && (index === undefined || index === existingIndex)) {
    const current = slots[existingIndex];
    if (current) {
      placementInfo.upgrade = current.rank < 3;
      placementInfo.empty = false;
      slots[existingIndex] = {id: current.id, rank: rank ?? Math.min(3, current.rank + 1)};
      return {state: {...state, slots}, placement: placementInfo, candidateIndex: existingIndex};
    }
  }
  if (selectedIndex === undefined) {
    placementInfo.valid = false;
    placementInfo.reason = `没有空闲的${role === 'component' ? '组件' : role}槽位`;
    return {state: {...state, slots}, placement: placementInfo};
  }
  if (selectedIndex < 0 || selectedIndex >= slots.length || SLOT_ORDER[selectedIndex] !== role) {
    placementInfo.valid = false;
    placementInfo.reason = '指定槽位与能力槽位不匹配';
    return {state: {...state, slots}, placement: placementInfo};
  }
  const outgoing = slots[selectedIndex];
  placementInfo.empty = !outgoing;
  if (outgoing) {
    const outgoingAbility = content.abilities.find(item => item.id === outgoing.id);
    if (outgoingAbility) {
      placementInfo.replaces = {
        id: outgoingAbility.id,
        ruleId: `ability:${outgoingAbility.id}:action`,
        name: outgoingAbility.name,
        kind: 'ability',
        slot: abilityLoadoutSlot(outgoingAbility),
        contentSlot: outgoingAbility.slot,
        slotIndex: selectedIndex,
        rank: outgoing.rank,
        event: `action.${actionForAbility(outgoingAbility) ?? 'passive'}`,
      };
    }
  }
  slots[selectedIndex] = {id: ability.id, rank: rank ?? 0};
  return {state: {...state, slots}, placement: placementInfo, candidateIndex: selectedIndex};
}

function candidateSourceIds(collection: BuildSourceCollection, candidate: Ability): Set<string> {
  return new Set(collection.sources.filter(source => source.sourceId === candidate.id).map(source => source.ruleId));
}

function candidateFacts(collection: BuildSourceCollection, candidate: Ability): {sources: BuildSource[]; produces: BuildResource[]; reads: BuildResource[]; consumes: BuildResource[]; gates: BuildGate[]} {
  const sources = collection.sources.filter(source => source.sourceId === candidate.id);
  return {
    sources,
    produces: uniqueResources(sources.flatMap(source => source.produces)),
    reads: uniqueResources(sources.flatMap(source => source.reads)),
    consumes: uniqueResources(sources.flatMap(source => source.consumes)),
    gates: sources.flatMap(source => source.gates),
  };
}

function isCandidateOwnProducerAllowed(
  producer: BuildSource,
  wanted: BuildResource,
  dependency: BuildResource,
  candidate: Ability,
): boolean {
  if (producer.sourceId !== candidate.id) return true;
  if (producer.ruleId === dependency.sourceRuleId) {
    const produced = producer.produces.find(item => matchesResource(item, wanted));
    return produced !== undefined && (produced.order ?? 0) < (dependency.order ?? Number.POSITIVE_INFINITY);
  }
  // A conversion fires after its input event. A direct battle-start/skill effect
  // can therefore feed a conversion on the same equipped relic.
  return dependency.event !== undefined && producer.event !== dependency.event;
}

function dependencyForResource(
  context: ResolutionContext,
  wanted: BuildResource,
  candidate: Ability,
  candidateRuleIds: Set<string>,
): BuildDependency {
  const producers = context.collection.sources.filter(source => {
    if (!source.produces.some(produced => matchesResource(produced, wanted))) return false;
    if (candidateRuleIds.has(source.ruleId)) {
      return isCandidateOwnProducerAllowed(source, wanted, wanted, candidate);
    }
    return true;
  });
  const targetMatched = context.collection.sources.some(source => source.produces.some(produced => produced.key === wanted.key && produced.target === wanted.target));
  const usable = producers.filter(source => context.sourceStatus.get(source.ruleId) !== 'unreachable');
  const reachable = usable.filter(source => context.sourceStatus.get(source.ruleId) === 'reachable');
  const unknown = usable.filter(source => context.sourceStatus.get(source.ruleId) === 'unknown');
  const knownAmount = reachable.reduce((sum, source) => sum + source.produces.filter(item => matchesResource(item, wanted)).reduce((inner, item) => inner + (item.amount ?? 0), 0), 0);
  const repeatable = reachable.some(source => sourceFactIsRepeatable(source));
  let status: BuildStatus;
  let reason: string;
  if (!targetMatched) {
    status = 'missing-input';
    reason = `${wanted.target === 'enemy' ? '敌方' : '自身'}没有${wanted.status ?? wanted.resource ?? wanted.key}来源`;
  } else if (!usable.length) {
    status = 'missing-input';
    reason = '当前构筑没有可触达的实际产生者';
  } else if (!reachable.length && unknown.length) {
    status = 'unknown';
    reason = '来源存在，但触发时机或外部条件尚不能确认';
  } else if (wanted.threshold !== undefined && !repeatable && knownAmount < wanted.threshold) {
    status = 'threshold';
    reason = `已有来源，但已知最多${knownAmount}，仍需要${wanted.threshold}`;
  } else if (wanted.threshold !== undefined && !repeatable && knownAmount >= wanted.threshold) {
    status = 'reachable';
    reason = `已有来源可达到${wanted.threshold}门槛`;
  } else {
    status = 'reachable';
    reason = wanted.threshold === undefined
      ? '存在可触达的具体来源'
      : `存在可继续叠加的来源，仍需达到${wanted.threshold}门槛`;
  }
  return {
    resource: wanted,
    status,
    producers: uniqueRefs(usable.map(sourceRef)),
    reachableProducers: uniqueRefs(reachable.map(sourceRef)),
    unknownProducers: uniqueRefs(unknown.map(sourceRef)),
    targetMatched,
    threshold: wanted.threshold,
    knownAmount,
    repeatable,
    reason,
  };
}

function dependencyForEvent(
  context: ResolutionContext,
  wanted: BuildResource,
  candidateRuleIds: Set<string>,
): BuildDependency {
  const event = wanted.event ?? wanted.key;
  const matches = context.events.filter(item => item.event === event && item.sourceRuleId !== wanted.sourceRuleId);
  const usable = matches.filter(item => {
    if (!item.sourceRuleId || !candidateRuleIds.has(item.sourceRuleId)) return true;
    // A direct action happens before its own conversion/trigger chain and can
    // be a real input. Other rules on the same candidate cannot bootstrap it.
    return item.sourceRuleId.endsWith(':action');
  });
  const expectedTarget = wanted.target && wanted.target !== 'unknown'
    ? wanted.target
    : eventTargetForConsumer(event);
  const targetMatches = expectedTarget
    ? usable.filter(item => item.target === expectedTarget)
    : usable;
  const unknownTarget = expectedTarget
    ? usable.filter(item => item.target === undefined || item.target === 'unknown')
    : [];
  const relevant = [...targetMatches, ...unknownTarget.filter(item => !targetMatches.includes(item))];
  const reachable = targetMatches.filter(item => item.status === 'reachable');
  const unknown = [
    ...targetMatches.filter(item => item.status === 'unknown'),
    ...unknownTarget,
  ];
  let status: BuildStatus;
  let reason: string;
  if (!relevant.length) {
    status = 'missing-input';
    reason = usable.length
      ? `${event}来源的目标方与当前依赖不匹配`
      : `尚未找到${event}的具体来源`;
  } else if (!targetMatches.length && unknownTarget.length) {
    status = 'unknown';
    reason = `存在${event}来源，但目标方尚不能确认`;
  } else if (!reachable.length && unknown.length) {
    status = 'unknown';
    reason = `存在${event}来源，但触发时机尚不能确认`;
  } else if (!reachable.length) {
    status = 'missing-input';
    reason = `${event}来源尚未可达`;
  } else {
    status = 'reachable';
    reason = `存在可触达的${event}来源`;
  }
  const refs = uniqueRefs(relevant.flatMap(item => {
    const source = context.collection.sources.find(candidateSource => candidateSource.ruleId === item.sourceRuleId);
    return source ? [sourceRef(source)] : [];
  }));
  const reachableRefs = uniqueRefs(reachable.flatMap(item => {
    const source = context.collection.sources.find(candidateSource => candidateSource.ruleId === item.sourceRuleId);
    return source ? [sourceRef(source)] : [];
  }));
  const unknownRefs = uniqueRefs(unknown.flatMap(item => {
    const source = context.collection.sources.find(candidateSource => candidateSource.ruleId === item.sourceRuleId);
    return source ? [sourceRef(source)] : [];
  }));
  return {
    resource: wanted,
    status,
    producers: refs,
    reachableProducers: reachableRefs,
    unknownProducers: unknownRefs,
    targetMatched: targetMatches.length > 0,
    reason,
  };
}

function dependencyForGate(
  context: ResolutionContext,
  gate: BuildGate,
  candidate: Ability,
  candidateRuleIds: Set<string>,
): BuildDependency | undefined {
  if (gate.kind !== 'condition' || !gate.condition) return undefined;
  const wanted = conditionFact(gate.condition, '');
  if (!wanted) return undefined;
  const dependency = dependencyForResource(context, wanted, candidate, candidateRuleIds);
  dependency.threshold = wanted.threshold;
  return dependency;
}

function analyzeDependencies(
  context: ResolutionContext,
  candidate: Ability,
  facts: {reads: BuildResource[]; gates: BuildGate[]},
  candidateRuleIds: Set<string>,
): {dependencies: BuildDependency[]; missing: BuildDependency[]; reachable: BuildDependency[]; threshold: BuildDependency[]; unknown: BuildDependency[]; reasons: string[]; uncertainty: string[]} {
  const dependencies: BuildDependency[] = [];
  const seen = new Map<string, number>();
  const add = (dependency: BuildDependency): void => {
    const key = resourceKey(dependency.resource);
    const previousIndex = seen.get(key);
    if (previousIndex === undefined) {
      seen.set(key, dependencies.length);
      dependencies.push(dependency);
      return;
    }
    const previous = dependencies[previousIndex];
    const previousThreshold = previous.threshold ?? previous.resource.threshold ?? 0;
    const nextThreshold = dependency.threshold ?? dependency.resource.threshold ?? 0;
    if (nextThreshold <= previousThreshold) return;
    // A consume action may read one stack while its trigger condition requires
    // more. Keep the stricter condition as the single dependency record.
    const mergedResource = {...previous.resource, threshold: nextThreshold};
    dependencies[previousIndex] = dependencyForResource(context, mergedResource, candidate, candidateRuleIds);
  };
  for (const read of facts.reads) {
    if (read.kind === 'event') {
      add(dependencyForEvent(context, read, candidateRuleIds));
    } else if (['status', 'resource'].includes(read.kind) || read.key === 'rage') {
      add(dependencyForResource(context, read, candidate, candidateRuleIds));
    }
  }
  for (const gate of facts.gates) {
    const dependency = dependencyForGate(context, gate, candidate, candidateRuleIds);
    if (dependency) add(dependency);
  }
  const missing = dependencies.filter(item => item.status === 'missing-input');
  const reachable = dependencies.filter(item => item.status === 'reachable');
  const threshold = dependencies.filter(item => item.status === 'threshold');
  const unknown = dependencies.filter(item => item.status === 'unknown');
  const reasons = dependencies.map(item => item.reason);
  const uncertainty = [
    ...unknown.map(item => item.reason),
    ...facts.gates.filter(gate => gate.status === 'unknown' && gate.reason).map(gate => gate.reason as string),
  ];
  return {dependencies, missing, reachable, threshold, unknown, reasons, uncertainty};
}

function hasUnmetCandidateGate(
  collection: BuildSourceCollection,
  candidate: Ability,
): {missing: boolean; unknown: boolean; reasons: string[]; uncertainty: string[]} {
  const sources = collection.sources.filter(source => source.sourceId === candidate.id);
  const reasons: string[] = [];
  const uncertainty: string[] = [];
  let missing = false;
  let unknown = false;
  for (const source of sources) {
    for (const gate of source.gates) {
      if (gate.status === 'unmet' || gate.status === 'unreachable') {
        missing = true;
        if (gate.reason) reasons.push(gate.reason);
      } else if (gate.status === 'unknown') {
        unknown = true;
        if (gate.reason) uncertainty.push(gate.reason);
      }
    }
  }
  return {missing, unknown, reasons, uncertainty};
}

function fitReason(status: BuildStatus, candidate: Ability, dependencies: BuildDependency[]): string {
  if (status === 'missing-input') {
    const missing = dependencies.find(item => item.status === 'missing-input');
    return `${candidate.name}当前缺少${missing?.resource.target === 'enemy' ? '敌方' : '自身'}${missing?.resource.status ?? missing?.resource.resource ?? missing?.resource.key}来源`;
  }
  if (status === 'threshold') {
    const threshold = dependencies.find(item => item.status === 'threshold');
    return `${candidate.name}已有潜在来源，但仍需达到${threshold?.threshold ?? '指定'}层/点门槛`;
  }
  if (status === 'unknown') return `${candidate.name}的触发依赖战斗时机或当前未支持的外部条件`;
  return `${candidate.name}有可核验的具体来源或可独立提供效果`;
}

function makeCandidateRef(_content: Content, ability: Ability, placement?: PlacementInfo): BuildSourceRef {
  return {
    id: ability.id,
    ruleId: `ability:${ability.id}:action`,
    name: ability.name,
    kind: 'ability',
    slot: abilityLoadoutSlot(ability),
    contentSlot: ability.slot,
    slotIndex: placement?.slotIndex,
    rank: placement?.upgrade ? undefined : 0,
    event: `action.${actionForAbility(ability) ?? 'passive'}`,
  };
}

export function collectBuildSources(content: Content, state: RunState): BuildSourceCollection {
  const {collection, raw} = baseCollection(content, state);
  return resolveCollection(content, state, collection, raw);
}

export function analyzeAbilityFit(
  content: Content,
  state: RunState,
  candidateInput: AbilityCandidate,
  placement?: Placement,
): AbilityFitAnalysis {
  const candidate = resolveCandidate(content, candidateInput);
  const current = collectBuildSources(content, state);
  const virtual = virtualStateFor(content, state, candidate, placement);
  const after = (() => {
    const {collection, raw} = baseCollection(content, virtual.state);
    return resolveCollection(content, virtual.state, collection, raw);
  })();
  const facts = candidateFacts(after, candidate);
  const candidateRuleIds = candidateSourceIds(after, candidate);
  const context: ResolutionContext = {
    content,
    state: virtual.state,
    collection: after,
    raw: after.sources.map(source => ({source, meta: {sourceId: source.sourceId, name: source.name, kind: source.kind}})),
    sourceStatus: new Map(after.sources.map(source => [source.ruleId, source.status])),
    events: after.events,
  };
  // `current` is intentionally collected before the virtual placement. It is
  // exposed through uncertainty only as a stability check and never mutated.
  void current;
  const dependencyResult = analyzeDependencies(context, candidate, facts, candidateRuleIds);
  const gateResult = hasUnmetCandidateGate(after, candidate);
  let status: BuildStatus;
  if (!virtual.placement.valid) status = 'unknown';
  else if (dependencyResult.missing.length || gateResult.missing) status = 'missing-input';
  else if (dependencyResult.threshold.length) status = 'threshold';
  else if (dependencyResult.unknown.length || gateResult.unknown) status = 'unknown';
  else status = 'reachable';
  const reasons = [...dependencyResult.reasons, ...gateResult.reasons];
  if (!reasons.length) reasons.push(fitReason(status, candidate, dependencyResult.dependencies));
  const uncertainty = [...dependencyResult.uncertainty, ...gateResult.uncertainty];
  if (!virtual.placement.valid && virtual.placement.reason) uncertainty.push(virtual.placement.reason);
  return {
    status,
    statusLabel: STATUS_LABELS[status],
    candidate: makeCandidateRef(content, candidate, virtual.placement),
    placement: virtual.placement,
    produces: facts.produces,
    reads: facts.reads,
    consumes: facts.consumes,
    gates: facts.gates,
    dependencies: dependencyResult.dependencies,
    missing: dependencyResult.missing,
    reachable: dependencyResult.reachable,
    threshold: dependencyResult.threshold,
    unknown: dependencyResult.unknown,
    sources: after,
    independent: facts.reads.length === 0 && dependencyResult.unknown.length === 0 && !gateResult.unknown,
    reasons,
    uncertainty,
  };
}

function virtualReplacementState(content: Content, state: RunState, incoming: Ability, targetSlotIndex?: number): {state: RunState; placement: PlacementInfo; outgoing?: BuildSourceRef} {
  const role = abilityLoadoutSlot(incoming);
  const slots = state.slots.map(equipped => equipped ? {...equipped} : null);
  const duplicateIndex = slots.findIndex(equipped => equipped?.id === incoming.id);
  if (duplicateIndex >= 0 && (targetSlotIndex === undefined || targetSlotIndex === duplicateIndex)) {
    const current = slots[duplicateIndex];
    const placement: PlacementInfo = {slotIndex: duplicateIndex, role, valid: true, empty: false, upgrade: !!current && current.rank < 3};
    if (current) slots[duplicateIndex] = {id: current.id, rank: Math.min(3, current.rank + 1)};
    return {state: {...state, slots}, placement};
  }
  const emptyIndex = slots.findIndex((equipped, slotIndex) => !equipped && SLOT_ORDER[slotIndex] === role);
  const index = targetSlotIndex ?? (emptyIndex < 0 ? undefined : emptyIndex);
  const placement: PlacementInfo = {slotIndex: index, role, valid: true, empty: index !== undefined && !slots[index]};
  if (index === undefined) {
    placement.valid = false;
    placement.reason = `没有空闲的${role === 'component' ? '组件' : role}槽位，需要指定替换位`;
    return {state: {...state, slots}, placement};
  }
  if (index < 0 || index >= slots.length || SLOT_ORDER[index] !== role) {
    placement.valid = false;
    placement.reason = '指定槽位与能力槽位不匹配';
    return {state: {...state, slots}, placement};
  }
  const outgoing = slots[index];
  let outgoingRef: BuildSourceRef | undefined;
  if (outgoing) {
    const outgoingAbility = content.abilities.find(item => item.id === outgoing.id);
    if (outgoingAbility) {
      outgoingRef = {
        id: outgoingAbility.id,
        ruleId: `ability:${outgoingAbility.id}:action`,
        name: outgoingAbility.name,
        kind: 'ability',
        slot: abilityLoadoutSlot(outgoingAbility),
        contentSlot: outgoingAbility.slot,
        slotIndex: index,
        rank: outgoing.rank,
        event: `action.${actionForAbility(outgoingAbility) ?? 'passive'}`,
      };
    }
    placement.replaces = outgoingRef;
  }
  slots[index] = {id: incoming.id, rank: 0};
  return {state: {...state, slots}, placement, outgoing: outgoingRef};
}

function sourceDiff(before: BuildSourceCollection, after: BuildSourceCollection): {gained: BuildSourceRef[]; lost: BuildSourceRef[]; retained: BuildSourceRef[]} {
  const beforeMap = new Map(before.sources.map(source => [source.ruleId, sourceRef(source)]));
  const afterMap = new Map(after.sources.map(source => [source.ruleId, sourceRef(source)]));
  return {
    gained: [...afterMap.entries()].filter(([ruleId]) => !beforeMap.has(ruleId)).map(([, ref]) => ref),
    lost: [...beforeMap.entries()].filter(([ruleId]) => !afterMap.has(ruleId)).map(([, ref]) => ref),
    retained: [...afterMap.entries()].filter(([ruleId]) => beforeMap.has(ruleId)).map(([, ref]) => ref),
  };
}

function resourceDiff(before: BuildSourceCollection, after: BuildSourceCollection): ResourceSourceChange[] {
  const keys = new Map<string, BuildResource>();
  for (const resource of [...before.produces, ...after.produces]) {
    const key = `${resourceKey(resource)}:${resource.threshold ?? ''}`;
    if (!keys.has(key)) keys.set(key, resource);
  }
  const changes: ResourceSourceChange[] = [];
  for (const resource of keys.values()) {
    const beforeSources = before.sources.filter(source => source.status !== 'unreachable' && source.produces.some(item => matchesResource(item, resource))).map(sourceRef);
    const afterSources = after.sources.filter(source => source.status !== 'unreachable' && source.produces.some(item => matchesResource(item, resource))).map(sourceRef);
    const beforeIds = new Set(beforeSources.map(sourceRefKey));
    const afterIds = new Set(afterSources.map(sourceRefKey));
    const gainedSources = afterSources.filter(ref => !beforeIds.has(sourceRefKey(ref)));
    const lostSources = beforeSources.filter(ref => !afterIds.has(sourceRefKey(ref)));
    const retainedSources = afterSources.filter(ref => beforeIds.has(sourceRefKey(ref)));
    if (gainedSources.length || lostSources.length) {
      changes.push({
        resource,
        gainedSources,
        lostSources,
        retainedSources,
        remainingSources: afterSources,
      });
    }
  }
  return changes;
}

export function compareLoadouts(
  content: Content,
  state: RunState,
  incomingInput: AbilityCandidate,
  targetSlotIndex?: number,
): LoadoutComparison {
  const incoming = resolveCandidate(content, incomingInput);
  const before = collectBuildSources(content, state);
  const replacement = virtualReplacementState(content, state, incoming, targetSlotIndex);
  const after = (() => {
    const {collection, raw} = baseCollection(content, replacement.state);
    return resolveCollection(content, replacement.state, collection, raw);
  })();
  const fit = analyzeAbilityFit(content, state, incoming, replacement.placement.slotIndex);
  const diff = sourceDiff(before, after);
  const changes = resourceDiff(before, after);
  const requiresReplacement = !replacement.placement.valid && replacement.placement.reason?.includes('需要指定替换位');
  const status: BuildStatus | 'replace-required' = requiresReplacement ? 'replace-required' : fit.status;
  const statusLabel = STATUS_LABELS[status];
  const reasons = [...fit.reasons];
  const uncertainty = [...fit.uncertainty];
  if (replacement.placement.reason) uncertainty.push(replacement.placement.reason);
  if (diff.lost.length) reasons.push(`替换后失去${diff.lost.map(ref => ref.name).slice(0, 3).join('、')}的规则来源`);
  if (changes.some(change => change.lostSources.length && change.remainingSources.length)) reasons.push('部分资源仍由其他具体来源保留');
  return {
    status,
    statusLabel,
    incoming: {
      ...makeCandidateRef(content, incoming, replacement.placement),
      rank: 0,
    },
    outgoing: replacement.outgoing,
    targetSlotIndex: replacement.placement.slotIndex,
    targetRole: replacement.placement.role,
    placement: replacement.placement,
    before,
    after,
    fit,
    analysis: fit,
    gainedSources: diff.gained,
    lostSources: diff.lost,
    retainedSources: diff.retained,
    addedSources: diff.gained,
    removedSources: diff.lost,
    keptSources: diff.retained,
    resourceChanges: changes,
    changes,
    reasons,
    uncertainty,
  };
}

export const buildStatusLabel = (status: BuildStatus | 'replace-required'): string => STATUS_LABELS[status];
