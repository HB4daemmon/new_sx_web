import path from 'node:path'
import {
  ARTIFACT_BASELINE,
  ARTIFACT_BUDGET,
  ARTIFACT_IDS,
  ARTIFACT_RARITIES,
  ATTRIBUTES,
  CONTENT_VERSION,
  CORE_EVENT_IDS,
  EFFECT_LIMIT_SCOPES,
  EFFECT_OPERATIONS,
  EFFECT_TARGETS,
  EFFECT_TRIGGERS,
  ENTITY_KINDS,
  EXPECTED_MANIFEST_ENTRIES,
  METHOD_IDS,
  METHOD_MULTIPLIER,
  METHOD_P_BY_TIER,
  METHOD_RARITIES,
  NODE_TYPES,
  ORDINARY_EVENT_IDS,
  RARITIES,
  SCHEMA_VERSION,
  STORYLINE_IDS,
} from './constants.mjs'
import { loadContent } from './loader.mjs'

const COMMON_FIELDS = [
  'schema_version',
  'content_version',
  'kind',
  'id',
  'name',
  'status',
  'summary',
  'description',
  'tags',
  'source',
  'balance',
]
const SOURCE_FIELDS = ['basis', 'reference', 'note']
const BALANCE_FIELDS = ['target', 'measured']
// Generic tree validation only knows fields whose protocol meaning is
// unambiguously numeric.  Free-form text such as status policies, symbolic
// caps, and source notes must remain strings.
const NUMERIC_KEYS = new Set([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'H',
  'J',
  'K',
  'L',
  'P',
  'R',
  'S',
  'U',
  'amount',
  'amount_per_stack',
  'amount_ratio',
  'attack',
  'attack_ratio',
  'attack_ratio_per_paid_rage',
  'attack_ratio_per_segment',
  'attack_ratio_per_shield',
  'attack_ratio_per_stack',
  'attack_ratio_per_stack_add',
  'attack_per_layer',
  'artifact_B',
  'artifact_decline_coins',
  'base_cap',
  'base_public_basic_gain',
  'base_public_gain',
  'base_public_round_end_gain',
  'basic_completed',
  'basic_damage_ratio_add',
  'basic_rage_gain_bonus',
  'chance',
  'common_prices_by_act',
  'count',
  'crit_rate',
  'crit_multiplier',
  'damage_per_stack_attack_ratio',
  'damage_ratio',
  'damage_ratio_add',
  'defense',
  'defense_ratio',
  'direct_defense_constant',
  'duration_rounds',
  'duration_rounds_add',
  'effective_heal_ratio',
  'effective_incoming_segment',
  'elite_coins_by_act',
  'elite_xp_by_act',
  'event_heal_ratio',
  'failure_hp_floor',
  'floor',
  'initial_coins',
  'index',
  'main_actions_per_round',
  'max_amount_ratio',
  'max_bonus_segments',
  'max_core_per_act',
  'max_core_per_run',
  'max_extra_elites_per_act',
  'max_extra_elites_per_run',
  'max_hp',
  'max_hp_ratio',
  'max_hp_ratio_add',
  'max_hp_ratio_per_stack',
  'max_per_action',
  'max_per_enemy_action',
  'max_preparations',
  'max_reduction_ratio',
  'max_segments',
  'max_segments_counted',
  'max_stacks',
  'max_stacks_add',
  'method_multiplier',
  'min',
  'min_C_plus_E_per_run',
  'min_cap',
  'min_common_battles_per_act',
  'min_noncore_between_core',
  'min_stacks',
  'minimum_cap',
  'minimum_effective_heal',
  'multiplier',
  'n',
  'nodes_per_act',
  'observation_rounds',
  'opening',
  'opening_drain_cap',
  'ordinary_coins_by_act',
  'ordinary_xp_by_act',
  'planned_independent_cores',
  'planned_per_run',
  'planned_storylines',
  'ratio',
  'ratio_add',
  'rate',
  'reduction',
  'reduction_per_stack',
  'reference_hp_by_act',
  'rest_heal_ratio',
  'round_drain_cap',
  'round_end',
  'round_target_cap',
  'segments',
  'segments_per_stack',
  'shield_consume_ratio',
  'shield_ratio_add',
  'speed',
  'stacks',
  'stacks_add',
  'stacks_per_overflow',
  'stacks_per_segment',
  'sword_intent_ratio_per_stack',
  'sword_intent_ratio_per_stack_add',
  'terminal_nodes',
  'tier',
  'total_ratio',
  'value',
  'window',
  'xp',
])
const NULLABLE_NUMERIC_KEYS = new Set(['J'])
const RESOURCE_TYPES = new Set(['hp', 'coins', 'xp'])
const RESOURCE_BASES = new Set(['flat', 'reference_hp', 'common_price', 'next_xp'])
const POOLS = new Set([
  'common_artifact',
  'rare_artifact',
  'legendary_artifact',
  'method_common',
  'method_rare',
  'method_legendary',
  'owned_methods',
])
const REWARD_TYPES = new Set(['resource', 'artifact', 'method', 'pool', 'preparation', 'swap_method'])
const REQUIREMENT_TYPES = new Set(['can_pay', 'capacity', 'owned_artifact', 'flag', 'known_method'])
const TARGET_KEYS = ['n0', 'n1', 'n2', 'n3', 'n4']
const GENERATED_WARNING =
  '伤害、持续伤害、护盾、治疗、buff/debuff 与怒气仍是设计输入；未接入运行时校准，不能据此宣称已平衡。'

function addIssue(errors, code, message, source, detail = undefined) {
  const item = { code, message, path: source }
  if (detail !== undefined) item.detail = detail
  errors.push(item)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(errors, object, key, source) {
  if (typeof object?.[key] !== 'string' || object[key].trim() === '') {
    addIssue(errors, 'required-string', `${key} must be a non-empty string`, source)
    return false
  }
  return true
}

function requiredArray(errors, object, key, source) {
  if (!Array.isArray(object?.[key])) {
    addIssue(errors, 'required-array', `${key} must be an array`, source)
    return false
  }
  return true
}

function requiredRecord(errors, object, key, source) {
  if (!isRecord(object?.[key])) {
    addIssue(errors, 'required-map', `${key} must be a mapping`, source)
    return false
  }
  return true
}

function finiteNumber(errors, value, source, label, { integer = false, min = undefined, max = undefined } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addIssue(errors, 'invalid-number', `${label} must be a finite number`, source)
    return false
  }
  if (integer && !Number.isInteger(value)) {
    addIssue(errors, 'invalid-integer', `${label} must be an integer`, source)
    return false
  }
  if (min !== undefined && value < min) {
    addIssue(errors, 'number-range', `${label} must be >= ${min}`, source)
    return false
  }
  if (max !== undefined && value > max) {
    addIssue(errors, 'number-range', `${label} must be <= ${max}`, source)
    return false
  }
  return true
}

function isNumericKey(key) {
  return NUMERIC_KEYS.has(key)
}

function finiteTree(errors, value, source, label = 'value', key = undefined) {
  if (value === null) {
    if (key && isNumericKey(key) && !NULLABLE_NUMERIC_KEYS.has(key)) {
      addIssue(errors, 'null-number', `${label} cannot use null as a numeric value`, source)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => finiteTree(errors, item, source, `${label}[${index}]`, key))
    return
  }
  if (key && isNumericKey(key) && typeof value !== 'number') {
    addIssue(errors, 'invalid-number', `${label} must be a finite number`, source)
    return
  }
  if (typeof value === 'number') {
    finiteNumber(errors, value, source, label)
    return
  }
  if (isRecord(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      finiteTree(errors, childValue, source, `${label}.${childKey}`, childKey)
    }
  }
}

function exactKeys(actual, expected) {
  const actualKeys = Object.keys(actual ?? {}).sort()
  const expectedKeys = Object.keys(expected ?? {}).sort()
  return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index])
}

function compareNumberMap(errors, actual, expected, source, label) {
  if (!isRecord(actual)) {
    addIssue(errors, 'invalid-map', `${label} must be a mapping`, source)
    return
  }
  if (!exactKeys(actual, expected)) {
    addIssue(errors, 'artifact-attributes', `${label} must preserve the authored attribute values`, source)
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      addIssue(errors, 'artifact-value', `${label}.${key} must be ${expectedValue}`, source)
    }
  }
  finiteTree(errors, actual, source, label)
}

function normalizePByTier(value) {
  if (Array.isArray(value) && value.length === 5) {
    return value
  }
  if (isRecord(value)) {
    const values = TARGET_KEYS.map((key, index) => value[key] ?? value[index] ?? value[String(index)])
    if (values.every((item) => item !== undefined)) return values
  }
  return null
}

function targetRange(value) {
  if (typeof value === 'number') return [value, value]
  if (Array.isArray(value) && value.length === 2) return value
  if (isRecord(value) && typeof value.min === 'number' && typeof value.max === 'number') {
    return [value.min, value.max]
  }
  return null
}

function normalizeEncounterId(value) {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return null
  return value.id ?? value.event_id ?? value.event ?? null
}

function sourceFor(entity) {
  return entity.__path ?? entity.id ?? '<entity>'
}

function validateCommon(entity, manifestEntry, errors) {
  const source = sourceFor(entity)
  if (!isRecord(entity)) {
    addIssue(errors, 'entity-map', 'entity must be a mapping', source)
    return
  }
  for (const field of COMMON_FIELDS) {
    if (!(field in entity)) {
      addIssue(errors, 'missing-common-field', `missing common field ${field}`, source)
    }
  }
  if (entity.schema_version !== SCHEMA_VERSION) {
    addIssue(errors, 'schema-version', `schema_version must be ${SCHEMA_VERSION}`, source)
  }
  if (entity.content_version !== CONTENT_VERSION) {
    addIssue(errors, 'content-version', `content_version must be ${CONTENT_VERSION}`, source)
  }
  if (manifestEntry && entity.id !== manifestEntry.id) {
    addIssue(errors, 'id-file-mismatch', `entity id ${entity.id ?? '<missing>'} does not match manifest filename id ${manifestEntry.id}`, source)
  }
  if (manifestEntry && entity.kind !== manifestEntry.kind) {
    addIssue(errors, 'kind-mismatch', `entity kind ${entity.kind ?? '<missing>'} does not match manifest kind ${manifestEntry.kind}`, source)
  }
  if (!ENTITY_KINDS.includes(entity.kind)) {
    addIssue(errors, 'kind', `unknown entity kind ${entity.kind}`, source)
  }
  if (entity.status !== 'design_target') {
    addIssue(errors, 'status', 'status must be design_target', source)
  }
  for (const field of ['id', 'name', 'summary', 'description']) {
    requiredString(errors, entity, field, source)
  }
  if (!Array.isArray(entity.tags) || entity.tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    addIssue(errors, 'tags', 'tags must be an array of non-empty strings', source)
  }
  if (!isRecord(entity.source)) {
    addIssue(errors, 'source', 'source must be a mapping', source)
  } else {
    for (const field of SOURCE_FIELDS) {
      if (!(field in entity.source)) addIssue(errors, 'source-field', `source.${field} is required`, source)
    }
    if (!['original', 'myth_adaptation'].includes(entity.source.basis)) {
      addIssue(errors, 'source-basis', 'source.basis must be original or myth_adaptation', source)
    }
    if (entity.source.note !== undefined && typeof entity.source.note !== 'string') {
      addIssue(errors, 'source-note', 'source.note must be a string', source)
    }
  }
  if (!isRecord(entity.balance)) {
    addIssue(errors, 'balance', 'balance must be a mapping', source)
  } else {
    for (const field of BALANCE_FIELDS) {
      if (!(field in entity.balance)) addIssue(errors, 'balance-field', `balance.${field} is required`, source)
    }
    if (entity.balance.measured !== null) {
      addIssue(errors, 'measured', 'balance.measured must be null until runtime measurement exists', source)
    }
    if (!isRecord(entity.balance.target)) {
      addIssue(errors, 'balance-target', 'balance.target must be a mapping', source)
    } else {
      finiteTree(errors, entity.balance.target, source, 'balance.target')
    }
  }
}

function validateEffectArray(entity, fieldPath, effects, errors, effectIds, { deferReplaces = false } = {}) {
  const source = sourceFor(entity)
  if (!Array.isArray(effects)) {
    addIssue(errors, 'effects-array', `${fieldPath} must be an array`, source)
    return []
  }
  const localEffects = []
  for (const [index, effect] of effects.entries()) {
    const location = `${source}:${fieldPath}[${index}]`
    if (!isRecord(effect)) {
      addIssue(errors, 'effect-map', 'effect must be a mapping', location)
      continue
    }
    for (const field of ['id', 'trigger', 'operation', 'target', 'params', 'requires', 'consumes', 'replaces', 'limit', 'text']) {
      if (!(field in effect)) addIssue(errors, 'effect-field', `effect.${field} is required`, location)
    }
    requiredString(errors, effect, 'id', location)
    if (typeof effect.id === 'string') {
      if (effectIds.has(effect.id)) addIssue(errors, 'duplicate-effect-id', `duplicate effect id ${effect.id}`, location)
      effectIds.add(effect.id)
      localEffects.push(effect)
    }
    if (!EFFECT_TRIGGERS.includes(effect.trigger)) {
      addIssue(errors, 'effect-trigger', `unknown effect trigger ${effect.trigger}`, location)
    }
    if (!EFFECT_OPERATIONS.includes(effect.operation)) {
      addIssue(errors, 'effect-operation', `unknown effect operation ${effect.operation}`, location)
    }
    if (!EFFECT_TARGETS.includes(effect.target)) {
      addIssue(errors, 'effect-target', `unknown effect target ${effect.target}`, location)
    }
    if (!isRecord(effect.params)) {
      addIssue(errors, 'effect-params', 'effect.params must be a mapping', location)
    } else {
      finiteTree(errors, effect.params, location, 'effect.params')
    }
    for (const arrayField of ['requires', 'consumes', 'replaces']) {
      if (!Array.isArray(effect[arrayField]) || effect[arrayField].some((item) => typeof item !== 'string' || item.trim() === '')) {
        addIssue(errors, 'effect-array', `effect.${arrayField} must be an array of strings`, location)
      }
    }
    if (!isRecord(effect.limit)) {
      addIssue(errors, 'effect-limit', 'effect.limit must be a mapping', location)
    } else {
      if (!EFFECT_LIMIT_SCOPES.includes(effect.limit.scope)) {
        addIssue(errors, 'effect-limit-scope', `unknown effect limit scope ${effect.limit.scope}`, location)
      }
      finiteNumber(errors, effect.limit.count, location, 'effect.limit.count', { integer: true, min: 1 })
    }
    requiredString(errors, effect, 'text', location)
  }
  if (!deferReplaces) {
    const localIds = new Set(localEffects.map((effect) => effect.id))
    for (const [index, effect] of localEffects.entries()) {
      for (const replacement of effect.replaces ?? []) {
        if (!localIds.has(replacement)) {
          addIssue(
            errors,
            'effect-replaces',
            `effect.replaces must reference an effect in the same entity: ${replacement}`,
            `${source}:${fieldPath}[${index}]`,
          )
        }
      }
    }
  }
  return localEffects
}

function methodEffects(entity, errors, effectIds) {
  const source = sourceFor(entity)
  const effects = []
  const actions = entity.actions
  if (!requiredRecord(errors, entity, 'actions', sourceFor(entity))) return effects
  for (const actionName of ['basic', 'rage']) {
    const action = actions[actionName]
    const location = `${sourceFor(entity)}:actions.${actionName}`
    if (!isRecord(action)) {
      addIssue(errors, 'action-map', `${actionName} must be a mapping`, location)
      continue
    }
    requiredString(errors, action, 'name', location)
    requiredString(errors, action, 'quick', location)
    effects.push(...validateEffectArray(entity, `actions.${actionName}.effects`, action.effects, errors, effectIds, { deferReplaces: true }))
  }
  for (const field of ['passives', 'travel']) {
    effects.push(...validateEffectArray(entity, field, entity[field], errors, effectIds, { deferReplaces: true }))
  }
  if (Array.isArray(entity.talents)) {
    for (const [index, talent] of entity.talents.entries()) {
      effects.push(...validateEffectArray(entity, `talents[${index}].effects`, talent?.effects, errors, effectIds, { deferReplaces: true }))
    }
  }
  const localIds = new Set(effects.map((effect) => effect.id))
  for (const effect of effects) {
    for (const replacement of effect.replaces ?? []) {
      if (!localIds.has(replacement)) {
        addIssue(errors, 'effect-replaces', `effect.replaces must reference an effect in the same entity: ${replacement}`, source)
      }
    }
  }
  return effects
}

function validateMethod(entity, errors, effectIds) {
  const source = sourceFor(entity)
  for (const field of ['role', 'stat_focus', 'mechanic', 'acquisition', 'actions', 'passives', 'travel', 'talents', 'routes']) {
    if (!(field in entity)) addIssue(errors, 'method-field', `missing method field ${field}`, source)
  }
  const expectedRarity = METHOD_RARITIES[entity.id]
  if (entity.rarity !== expectedRarity) {
    addIssue(errors, 'method-rarity', `method ${entity.id} must have rarity ${expectedRarity}`, source)
  }
  if (!isRecord(entity.acquisition)) {
    addIssue(errors, 'method-acquisition', 'acquisition must be a mapping', source)
  } else {
    if (typeof entity.acquisition.start !== 'boolean') {
      addIssue(errors, 'method-acquisition-start', 'acquisition.start must be boolean', source)
    }
    if (!Array.isArray(entity.acquisition.pools) || entity.acquisition.pools.some((pool) => typeof pool !== 'string' || !POOLS.has(pool))) {
      addIssue(errors, 'method-acquisition-pool', 'acquisition.pools must contain known pools', source)
    }
    const expectedPool = `method_${expectedRarity}`
    if (!entity.acquisition.pools?.includes(expectedPool)) {
      addIssue(errors, 'method-acquisition-pool', `method acquisition must include ${expectedPool}`, source)
    }
    if (expectedRarity === 'common' && entity.acquisition.start !== true) {
      addIssue(errors, 'method-opening', 'common methods must be available at start', source)
    }
    if (expectedRarity !== 'common' && entity.acquisition.start === true) {
      addIssue(errors, 'method-opening', 'only common methods may be available at start', source)
    }
  }
  if (entity.mechanic !== null && typeof entity.mechanic !== 'string' && !isRecord(entity.mechanic)) {
    addIssue(errors, 'method-mechanic', 'mechanic must be null, text, or a mapping', source)
  }
  methodEffects(entity, errors, effectIds)
  if (!Array.isArray(entity.talents) || entity.talents.length !== 12) {
    addIssue(errors, 'talent-count', 'each method must define exactly 12 talents', source)
  } else {
    const expectedTalents = new Set()
    for (let tier = 1; tier <= 4; tier += 1) {
      for (const branch of ['A', 'B', 'C']) expectedTalents.add(`${entity.id}-J${tier}-${branch}`)
    }
    const seen = new Set()
    for (const [index, talent] of entity.talents.entries()) {
      const location = `${source}:talents[${index}]`
      if (!isRecord(talent)) {
        addIssue(errors, 'talent-map', 'talent must be a mapping', location)
        continue
      }
      for (const field of ['id', 'tier', 'branch', 'name', 'quick', 'category', 'effects']) {
        if (!(field in talent)) addIssue(errors, 'talent-field', `talent.${field} is required`, location)
      }
      requiredString(errors, talent, 'id', location)
      const expectedId = `${entity.id}-J${talent.tier}-${talent.branch}`
      if (!expectedTalents.has(talent.id) || talent.id !== expectedId) {
        addIssue(errors, 'talent-id', `talent id must follow ${entity.id}-J<tier>-<branch>`, location)
      }
      if (seen.has(talent.id)) addIssue(errors, 'talent-duplicate', `duplicate talent ${talent.id}`, location)
      seen.add(talent.id)
      finiteNumber(errors, talent.tier, location, 'talent.tier', { integer: true, min: 1, max: 4 })
      if (!['A', 'B', 'C'].includes(talent.branch)) addIssue(errors, 'talent-branch', 'talent.branch must be A, B or C', location)
      if (typeof talent.name !== 'string' || !/^[\u3400-\u9fff]{4}$/u.test(talent.name)) {
        addIssue(errors, 'talent-name', 'talent.name must be exactly four Chinese characters', location)
      }
      requiredString(errors, talent, 'quick', location)
      if (!['enhance', 'cycle', 'convert'].includes(talent.category)) {
        addIssue(errors, 'talent-category', 'talent.category must be enhance, cycle or convert', location)
      }
      // Talent effects are collected by methodEffects so replacements can
      // point to another effect on the same method, regardless of section.
    }
    for (const expectedId of expectedTalents) {
      if (!seen.has(expectedId)) addIssue(errors, 'talent-missing', `missing talent ${expectedId}`, source)
    }
  }
  if (!Array.isArray(entity.routes) || entity.routes.length !== 3) {
    addIssue(errors, 'route-count', 'each method must define exactly 3 routes', source)
  } else {
    const talentIds = new Set((entity.talents ?? []).map((talent) => talent?.id))
    for (const [index, route] of entity.routes.entries()) {
      const location = `${source}:routes[${index}]`
      if (!isRecord(route)) {
        addIssue(errors, 'route-map', 'route must be a mapping', location)
        continue
      }
      requiredString(errors, route, 'name', location)
      requiredString(errors, route, 'summary', location)
      if (!Array.isArray(route.talents) || route.talents.length !== 4) {
        addIssue(errors, 'route-talents', 'route.talents must contain exactly 4 talent ids', location)
        continue
      }
      const seenTiers = new Set()
      const seenTalentIds = new Set()
      for (const talentId of route.talents) {
        if (typeof talentId !== 'string' || !talentIds.has(talentId)) {
          addIssue(errors, 'route-reference', `route references unknown talent ${talentId}`, location)
          continue
        }
        const tier = Number(talentId.match(/-J(\d)-/)?.[1])
        if (seenTiers.has(tier)) addIssue(errors, 'route-tier', 'route must choose four different talent tiers', location)
        seenTiers.add(tier)
        if (seenTalentIds.has(talentId)) addIssue(errors, 'route-duplicate', `route repeats talent ${talentId}`, location)
        seenTalentIds.add(talentId)
      }
    }
  }
  const pByTier = normalizePByTier(entity.balance?.target?.P_by_tier)
  if (!pByTier) {
    addIssue(errors, 'method-budget', 'balance.target.P_by_tier must contain five tier values', source)
  } else {
    const multiplier = METHOD_MULTIPLIER[expectedRarity] ?? 1
    METHOD_P_BY_TIER.forEach((base, index) => {
      const expected = base * multiplier
      if (typeof pByTier[index] !== 'number' || Math.abs(pByTier[index] - expected) > 1e-9) {
        addIssue(errors, 'method-budget', `P_by_tier[${index}] must be ${expected}`, source)
      }
      finiteNumber(errors, pByTier[index], source, `P_by_tier[${index}]`, { min: 0 })
    })
  }
}

function validateArtifact(entity, errors, effectIds) {
  const source = sourceFor(entity)
  const expected = ARTIFACT_BASELINE[entity.id]
  if (!expected) {
    addIssue(errors, 'artifact-id', `unknown artifact ${entity.id}`, source)
    return
  }
  for (const field of ['rarity', 'max_stacks', 'unique_group', 'attributes', 'effects', 'acquisition']) {
    if (!(field in entity)) addIssue(errors, 'artifact-field', `missing artifact field ${field}`, source)
  }
  const expectedRarity = ARTIFACT_RARITIES[entity.id]
  if (entity.rarity !== expectedRarity) addIssue(errors, 'artifact-rarity', `artifact rarity must be ${expectedRarity}`, source)
  if (entity.name !== expected.name) addIssue(errors, 'artifact-name', `artifact name must be ${expected.name}`, source)
  if (entity.max_stacks !== expected.max_stacks) addIssue(errors, 'artifact-stacks', `max_stacks must be ${expected.max_stacks}`, source)
  if (entity.unique_group !== null && typeof entity.unique_group !== 'string') {
    addIssue(errors, 'artifact-unique-group', 'unique_group must be null or a string', source)
  }
  if (entity.id === 'RL01' && entity.unique_group !== 'overflow_outlet') {
    addIssue(errors, 'artifact-unique-group', 'RL01 must use unique_group overflow_outlet', source)
  }
  if (!isRecord(entity.attributes)) {
    addIssue(errors, 'artifact-attributes', 'attributes must be a mapping', source)
  } else {
    compareNumberMap(errors, entity.attributes.flat, expected.flat, source, 'attributes.flat')
    compareNumberMap(errors, entity.attributes.percent, expected.percent, source, 'attributes.percent')
    const keys = [...Object.keys(entity.attributes.flat ?? {}), ...Object.keys(entity.attributes.percent ?? {})]
    for (const key of keys) {
      if (!ATTRIBUTES.includes(key)) addIssue(errors, 'artifact-attribute-key', `unknown artifact attribute ${key}`, source)
    }
    if (Object.hasOwn(entity.attributes.percent ?? {}, 'crit_rate')) {
      addIssue(errors, 'artifact-crit-rate', 'crit_rate must be a flat ratio, not a percent attribute', source)
    }
    if (keys.length === 0) addIssue(errors, 'artifact-attributes', 'each artifact must provide at least one base attribute', source)
  }
  validateEffectArray(entity, 'effects', entity.effects, errors, effectIds)
  if (!isRecord(entity.acquisition)) {
    addIssue(errors, 'artifact-acquisition', 'acquisition must be a mapping', source)
  } else if (!Array.isArray(entity.acquisition.pools) || entity.acquisition.pools.some((pool) => typeof pool !== 'string' || !POOLS.has(pool))) {
    addIssue(errors, 'artifact-acquisition', 'acquisition.pools must contain known pools', source)
  } else if (!entity.acquisition.pools.includes(`${expectedRarity}_artifact`)) {
    addIssue(errors, 'artifact-acquisition', `artifact acquisition must include ${expectedRarity}_artifact`, source)
  }
  const target = entity.balance?.target
  if (!isRecord(target)) return
  finiteNumber(errors, target.B, source, 'balance.target.B', { min: 0 })
  finiteNumber(errors, target.A, source, 'balance.target.A', { min: 0 })
  finiteNumber(errors, target.J, source, 'balance.target.J', { min: 0 })
  if (target.B !== ARTIFACT_BUDGET[expectedRarity]) {
    addIssue(errors, 'artifact-budget', `balance.target.B must be ${ARTIFACT_BUDGET[expectedRarity]}`, source)
  }
  if (typeof target.A === 'number' && typeof target.J === 'number' && typeof target.B === 'number') {
    if (Math.abs(target.A / 5 + target.J - target.B) > 1e-9) {
      addIssue(errors, 'artifact-budget', 'balance.target must satisfy A / 5 + J = B', source)
    }
  }
}

function validateRequirement(requirement, known, errors, source) {
  if (!isRecord(requirement) || !REQUIREMENT_TYPES.has(requirement.type)) {
    addIssue(errors, 'requirement', `unknown requirement type ${requirement?.type}`, source)
    return
  }
  if (requirement.type === 'capacity') {
    if (typeof requirement.id !== 'string' || !known.artifacts.has(requirement.id)) {
      addIssue(errors, 'requirement-reference', `capacity references unknown artifact ${requirement.id}`, source)
    }
    finiteNumber(errors, requirement.count, source, 'capacity.count', { integer: true, min: 1 })
  } else if (requirement.type === 'owned_artifact') {
    if (typeof requirement.id !== 'string' || !known.artifacts.has(requirement.id)) {
      addIssue(errors, 'requirement-reference', `owned_artifact references unknown artifact ${requirement.id}`, source)
    }
    finiteNumber(errors, requirement.count, source, 'owned_artifact.count', { integer: true, min: 1 })
  } else if (requirement.type === 'known_method') {
    if (typeof requirement.id !== 'string' || !known.methods.has(requirement.id)) {
      addIssue(errors, 'requirement-reference', `known_method references unknown method ${requirement.id}`, source)
    }
  } else if (requirement.type === 'flag') {
    requiredString(errors, requirement, 'id', source)
    if (!('value' in requirement)) addIssue(errors, 'requirement-flag', 'flag requirement needs value', source)
  }
}

function validateCost(cost, errors, source) {
  if (!isRecord(cost) || cost.type !== 'resource') {
    addIssue(errors, 'cost', 'costs entries must be resource costs', source)
    return
  }
  if (!RESOURCE_TYPES.has(cost.resource)) addIssue(errors, 'cost-resource', `unknown cost resource ${cost.resource}`, source)
  finiteNumber(errors, cost.amount, source, 'cost.amount', { min: 0 })
  if (!RESOURCE_BASES.has(cost.basis)) addIssue(errors, 'cost-basis', `unknown cost basis ${cost.basis}`, source)
  if (cost.resource === 'hp' && cost.must_survive !== true) {
    addIssue(errors, 'blood-price', 'hp costs must explicitly require must_survive: true', source)
  }
  if ('must_survive' in cost && typeof cost.must_survive !== 'boolean') {
    addIssue(errors, 'blood-price', 'must_survive must be boolean', source)
  }
}

function validateReward(reward, known, errors, source) {
  if (!isRecord(reward) || !REWARD_TYPES.has(reward.type)) {
    addIssue(errors, 'reward', `unknown reward type ${reward?.type}`, source)
    return
  }
  switch (reward.type) {
    case 'resource':
      if (!RESOURCE_TYPES.has(reward.resource)) addIssue(errors, 'reward-resource', `unknown reward resource ${reward.resource}`, source)
      finiteNumber(errors, reward.amount, source, 'reward.amount', { min: 0 })
      if (!RESOURCE_BASES.has(reward.basis)) addIssue(errors, 'reward-basis', `unknown reward basis ${reward.basis}`, source)
      break
    case 'artifact':
      if (!known.artifacts.has(reward.id)) addIssue(errors, 'reward-reference', `reward references unknown artifact ${reward.id}`, source)
      finiteNumber(errors, reward.count, source, 'reward.count', { integer: true, min: 1 })
      break
    case 'method':
      if (!known.methods.has(reward.id)) addIssue(errors, 'reward-reference', `reward references unknown method ${reward.id}`, source)
      break
    case 'pool':
      if (!POOLS.has(reward.pool)) addIssue(errors, 'reward-pool', `unknown reward pool ${reward.pool}`, source)
      finiteNumber(errors, reward.count, source, 'reward.count', { integer: true, min: 1 })
      break
    case 'preparation':
      if (!['shield'].includes(reward.effect)) addIssue(errors, 'reward-preparation', `unknown preparation effect ${reward.effect}`, source)
      finiteNumber(errors, reward.amount, source, 'preparation.amount', { min: 0 })
      if (!RESOURCE_BASES.has(reward.basis)) addIssue(errors, 'reward-basis', `unknown preparation basis ${reward.basis}`, source)
      break
    case 'swap_method':
      if (reward.pool !== 'owned_methods') addIssue(errors, 'reward-pool', 'swap_method must use owned_methods', source)
      break
    default:
      break
  }
}

function validateEncounter(encounter, option, known, errors, source) {
  if (!isRecord(encounter)) {
    addIssue(errors, 'encounter', 'option.encounter must be a mapping', source)
    return
  }
  if (!known.enemies.has(encounter.enemy_id)) {
    addIssue(errors, 'encounter-reference', `unknown encounter enemy ${encounter.enemy_id}`, source)
  }
  if (encounter.mode !== 'nonlethal') addIssue(errors, 'encounter-mode', 'event encounters must be nonlethal', source)
  finiteNumber(errors, encounter.failure_hp_floor, source, 'encounter.failure_hp_floor', { min: 1 })
  if (!Array.isArray(encounter.failure_rewards)) {
    addIssue(errors, 'encounter-failure', 'failure_rewards must be an array', source)
  } else {
    encounter.failure_rewards.forEach((reward) => validateReward(reward, known, errors, source))
  }
  requiredString(errors, encounter, 'failure_outcome', source)
  for (const reward of option.rewards ?? []) {
    if (reward?.type === 'pool' || reward?.type === 'battle_package' || reward?.type === 'fixed_battle_package') {
      addIssue(errors, 'internal-battle-package', 'event-internal battles cannot grant a generic battle package', source)
    }
  }
  for (const reward of encounter.failure_rewards ?? []) {
    if (reward?.type === 'pool' || reward?.type === 'battle_package' || reward?.type === 'fixed_battle_package') {
      addIssue(errors, 'internal-battle-package', 'event-internal battles cannot grant a generic battle package', source)
    }
  }
}

function validateEvent(entity, errors, known) {
  const source = sourceFor(entity)
  const expectedCore = CORE_EVENT_IDS.includes(entity.id)
  const expectedOrdinary = ORDINARY_EVENT_IDS.includes(entity.id)
  if (entity.event_type !== (expectedCore ? 'core' : expectedOrdinary ? 'ordinary' : entity.event_type)) {
    addIssue(errors, 'event-type', `event_type must be ${expectedCore ? 'core' : 'ordinary'}`, source)
  }
  for (const field of ['event_type', 'acts', 'scene', 'options', 'settlement']) {
    if (!(field in entity)) addIssue(errors, 'event-field', `missing event field ${field}`, source)
  }
  if (!Array.isArray(entity.acts) || entity.acts.length === 0 || entity.acts.some((act) => !Number.isInteger(act) || act < 1 || act > 4)) {
    addIssue(errors, 'event-acts', 'acts must be a non-empty array of act numbers 1-4', source)
  } else if (new Set(entity.acts).size !== entity.acts.length) {
    addIssue(errors, 'event-acts', 'acts must not repeat an act number', source)
  }
  requiredString(errors, entity, 'scene', source)
  if (!Array.isArray(entity.options) || entity.options.length < 2 || entity.options.length > 3) {
    addIssue(errors, 'event-options', 'events must have 2 or 3 mutually exclusive options', source)
  }
  const options = Array.isArray(entity.options) ? entity.options : []
  const optionIds = new Set()
  for (const [index, option] of options.entries()) {
    const location = `${source}:options[${index}]`
    if (!isRecord(option)) {
      addIssue(errors, 'option-map', 'option must be a mapping', location)
      continue
    }
    for (const field of ['id', 'label', 'quick', 'requirements', 'costs', 'rewards', 'outcome']) {
      if (!(field in option)) addIssue(errors, 'option-field', `option.${field} is required`, location)
    }
    requiredString(errors, option, 'id', location)
    if (typeof option.id === 'string' && !option.id.startsWith(`${entity.id}-`)) {
      addIssue(errors, 'option-id', 'option id must begin with its event id', location)
    }
    if (typeof option.id === 'string' && optionIds.has(option.id)) {
      addIssue(errors, 'option-id', `duplicate option id ${option.id}`, location)
    }
    if (typeof option.id === 'string') optionIds.add(option.id)
    for (const field of ['label', 'quick', 'outcome']) requiredString(errors, option, field, location)
    if (!Array.isArray(option.requirements)) {
      addIssue(errors, 'requirements', 'requirements must be an array', location)
    } else {
      option.requirements.forEach((requirement) => validateRequirement(requirement, known, errors, location))
    }
    if (!Array.isArray(option.costs)) {
      addIssue(errors, 'costs', 'costs must be an array', location)
    } else {
      option.costs.forEach((cost) => validateCost(cost, errors, location))
    }
    if (!Array.isArray(option.rewards)) {
      addIssue(errors, 'rewards', 'rewards must be an array', location)
    } else {
      option.rewards.forEach((reward) => validateReward(reward, known, errors, location))
      for (const reward of option.rewards) {
        if (reward?.type !== 'artifact' || reward.count <= 1) continue
        const capacity = option.requirements?.find(
          (requirement) => requirement?.type === 'capacity' && requirement.id === reward.id,
        )
        if (!capacity || capacity.count < reward.count) {
          addIssue(errors, 'capacity', `multi-layer artifact reward ${reward.id} requires matching capacity`, location)
        }
      }
    }
    if (option.encounter !== undefined) validateEncounter(option.encounter, option, known, errors, `${location}:encounter`)
  }
  if (!isRecord(entity.settlement)) {
    addIssue(errors, 'settlement', 'settlement must be a mapping', source)
  } else {
    if (entity.settlement.once !== true) addIssue(errors, 'settlement-once', 'settlement.once must be true', source)
    if (entity.settlement.internal_battle_package !== false) {
      addIssue(errors, 'settlement-package', 'settlement.internal_battle_package must be false', source)
    }
    if (entity.settlement.travel_triggers !== 1) addIssue(errors, 'settlement-travel', 'settlement.travel_triggers must be 1', source)
    requiredString(errors, entity.settlement, 'fallback', source)
  }
  const gross = targetRange(entity.balance?.target?.gross_U)
  if (!gross || gross.some((value) => !Number.isFinite(value) || value < 0)) {
    addIssue(errors, 'event-budget', 'balance.target.gross_U must be a finite non-negative value or range', source)
  }
  if (entity.encounter !== undefined) {
    addIssue(errors, 'encounter-location', 'encounter belongs on the selected option, not at event top level', source)
  }
}

function validateStoryline(entity, errors, known, storylineEncounterIds) {
  const source = sourceFor(entity)
  for (const field of ['character', 'premise', 'encounters', 'commitment', 'resolution', 'selection']) {
    if (!(field in entity)) addIssue(errors, 'storyline-field', `missing storyline field ${field}`, source)
  }
  requiredString(errors, entity, 'character', source)
  requiredString(errors, entity, 'premise', source)
  if (!Array.isArray(entity.encounters) || entity.encounters.length !== 2) {
    addIssue(errors, 'storyline-encounters', 'storyline.encounters must contain exactly two core event ids', source)
  } else {
    const encounterIds = entity.encounters.map(normalizeEncounterId)
    const unique = new Set(encounterIds)
    if (unique.size !== 2) addIssue(errors, 'storyline-encounters', 'storyline encounters must be distinct', source)
    const acts = []
    for (const [index, encounterId] of encounterIds.entries()) {
      if (!known.coreEvents.has(encounterId)) {
        addIssue(errors, 'storyline-reference', `unknown core event ${encounterId}`, `${source}:encounters[${index}]`)
        continue
      }
      storylineEncounterIds.add(encounterId)
      acts.push(known.byId.get(encounterId)?.acts ?? [])
    }
    if (acts.length === 2) {
      const canSeparate = acts[0].some((first) => acts[1].some((second) => first !== second))
      if (!canSeparate) addIssue(errors, 'storyline-acts', 'storyline encounters must be placeable in different acts', source)
    }
  }
  if (!isRecord(entity.selection)) {
    addIssue(errors, 'storyline-selection', 'selection must be a mapping', source)
  } else {
    if (entity.selection.planned_per_run !== 1) addIssue(errors, 'storyline-selection', 'selection.planned_per_run must be 1', source)
    if (entity.selection.optional !== true) addIssue(errors, 'storyline-selection', 'selection.optional must be true', source)
    if (entity.selection.fallback !== 'ordinary_event') addIssue(errors, 'storyline-selection', 'selection.fallback must be ordinary_event', source)
  }
  for (const field of ['commitment', 'resolution']) {
    if (!(typeof entity[field] === 'string' || isRecord(entity[field]))) {
      addIssue(errors, 'storyline-copy', `${field} must be a string or mapping`, source)
    }
  }
}

function artifactStackLimit(id) {
  return ARTIFACT_BASELINE[id]?.max_stacks ?? null
}

function collectEffectIds(entity) {
  const ids = new Set()
  if (!entity) return ids
  const effectLists = []
  if (entity.kind === 'method') {
    effectLists.push(entity.actions?.basic?.effects, entity.actions?.rage?.effects, entity.passives, entity.travel)
    for (const talent of entity.talents ?? []) effectLists.push(talent?.effects)
  }
  if (entity.kind === 'artifact') effectLists.push(entity.effects)
  for (const effects of effectLists) {
    for (const effect of effects ?? []) {
      if (typeof effect?.id === 'string') ids.add(effect.id)
    }
  }
  return ids
}

function enemyLoadoutSources(entity, known) {
  const sources = new Set()
  const method = known.byId.get(entity.method)
  if (method) {
    sources.add(method.id)
    for (const effectId of collectEffectIds(method)) sources.add(effectId)
  }
  for (const talentId of entity.talents ?? []) {
    sources.add(talentId)
    const talent = known.talentsById?.get(talentId)
    for (const effectId of collectEffectIds({ kind: 'method', talents: [talent] })) sources.add(effectId)
  }
  for (const loadout of entity.artifacts ?? []) {
    if (typeof loadout?.id !== 'string') continue
    sources.add(loadout.id)
    const artifact = known.byId.get(loadout.id)
    for (const effectId of collectEffectIds(artifact)) sources.add(effectId)
  }
  return sources
}

function validateEnemy(entity, errors, known) {
  const source = sourceFor(entity)
  const final = entity.id === 'EN-F1' || entity.id === 'EN-F2'
  for (const field of ['acts', 'tier', 'identity', 'method', 'n', 'talents', 'artifacts', 'stats', 'pressure', 'counterplay', 'preview', 'phases', 'reward_profile']) {
    if (!(field in entity)) addIssue(errors, 'enemy-field', `missing enemy field ${field}`, source)
  }
  const expectedTier = final ? 'final' : entity.id.includes('-C') ? 'normal' : entity.id.includes('-L') ? 'elite' : 'boss'
  if (entity.tier !== expectedTier) addIssue(errors, 'enemy-tier', `enemy tier must be ${expectedTier}`, source)
  if (!Array.isArray(entity.acts) || entity.acts.length === 0 || entity.acts.some((act) => !Number.isInteger(act) || (final ? (act !== 5 && act !== 0) : (act < 1 || act > 4)))) {
    addIssue(errors, 'enemy-acts', final ? 'final enemy acts must identify final stage 5 (or 0)' : 'act enemy acts must contain act numbers 1-4', source)
  }
  if (!known.methods.has(entity.method)) addIssue(errors, 'enemy-method', `enemy method must reference a real method: ${entity.method}`, source)
  finiteNumber(errors, entity.n, source, 'enemy.n', { integer: true, min: 0, max: 4 })
  if (!Array.isArray(entity.talents)) {
    addIssue(errors, 'enemy-talents', 'enemy.talents must be an array', source)
  } else {
    const tiers = new Set()
    for (const talentId of entity.talents) {
      if (typeof talentId !== 'string') {
        addIssue(errors, 'enemy-talent-reference', 'enemy talent ids must be strings', source)
        continue
      }
      const match = talentId.match(/^(RKF\d{2})-J([1-4])-([ABC])$/)
      if (!match || !known.talents.has(talentId)) {
        addIssue(errors, 'enemy-talent-reference', `enemy references unknown talent ${talentId}`, source)
        continue
      }
      if (match[1] !== entity.method) addIssue(errors, 'enemy-method-boundary', `enemy talent ${talentId} does not belong to method ${entity.method}`, source)
      const tier = Number(match[2])
      if (tier > entity.n) addIssue(errors, 'enemy-talent-boundary', `enemy talent ${talentId} exceeds n=${entity.n}`, source)
      if (tiers.has(tier)) addIssue(errors, 'enemy-talent-tier', `enemy may equip at most one talent per tier`, source)
      tiers.add(tier)
    }
  }
  if (!Array.isArray(entity.artifacts)) {
    addIssue(errors, 'enemy-artifacts', 'enemy.artifacts must be an array', source)
  } else {
    const artifactIds = new Set()
    for (const [index, artifact] of entity.artifacts.entries()) {
      const location = `${source}:artifacts[${index}]`
      if (!isRecord(artifact)) {
        addIssue(errors, 'enemy-artifact-map', 'enemy artifact loadout must be a mapping', location)
        continue
      }
      if (!known.artifacts.has(artifact.id)) addIssue(errors, 'enemy-artifact-reference', `unknown enemy artifact ${artifact.id}`, location)
      if (artifactIds.has(artifact.id)) addIssue(errors, 'enemy-artifact-duplicate', `enemy repeats artifact ${artifact.id}`, location)
      artifactIds.add(artifact.id)
      finiteNumber(errors, artifact.stacks, location, 'artifact.stacks', { integer: true, min: 1 })
      const limit = artifactStackLimit(artifact.id)
      if (limit !== null && typeof artifact.stacks === 'number' && artifact.stacks > limit) {
        addIssue(errors, 'enemy-artifact-stacks', `${artifact.id} stacks exceed authored max ${limit}`, location)
      }
    }
  }
  if (!isRecord(entity.stats)) {
    addIssue(errors, 'enemy-stats', 'enemy.stats must be a mapping', source)
  } else {
    for (const attribute of ATTRIBUTES) {
      finiteNumber(errors, entity.stats[attribute], source, `stats.${attribute}`, { min: 0, max: attribute === 'crit_rate' ? 1 : undefined })
    }
    for (const key of Object.keys(entity.stats)) {
      if (!ATTRIBUTES.includes(key)) addIssue(errors, 'enemy-stats', `unknown enemy stat ${key}`, source)
    }
  }
  if (!Array.isArray(entity.pressure) || entity.pressure.length < 1 || entity.pressure.length > 3 || entity.pressure.some((item) => typeof item !== 'string' || item.trim() === '')) {
    addIssue(errors, 'enemy-pressure', 'pressure must contain 1-3 labels', source)
  }
  if (!Array.isArray(entity.counterplay) || entity.counterplay.length < 2 || entity.counterplay.some((item) => typeof item !== 'string' || item.trim() === '')) {
    addIssue(errors, 'enemy-counterplay', 'counterplay must contain at least two concrete choices', source)
  }
  if (!(typeof entity.preview === 'string' || isRecord(entity.preview))) {
    addIssue(errors, 'enemy-preview', 'preview must be readable text or a mapping', source)
  }
  const loadoutSources = enemyLoadoutSources(entity, known)
  if (!Array.isArray(entity.phases)) {
    addIssue(errors, 'enemy-phases', 'phases must be an array, possibly empty', source)
  } else {
    for (const [index, phase] of entity.phases.entries()) {
      const location = `${source}:phases[${index}]`
      if (!isRecord(phase)) {
        addIssue(errors, 'enemy-phase-map', 'phase must be a mapping', location)
        continue
      }
      if (!phase.source && !phase.source_id) addIssue(errors, 'enemy-phase-source', 'non-empty phases need an existing card source', location)
      const inspectPhaseKeys = (value, keyPath = '') => {
        if (Array.isArray(value)) {
          value.forEach((item, childIndex) => inspectPhaseKeys(item, `${keyPath}[${childIndex}]`))
        } else if (isRecord(value)) {
          for (const [key, childValue] of Object.entries(value)) {
            const fullKey = keyPath ? `${keyPath}.${key}` : key
            if (/hidden|immune|immunity|secret|multiplier/i.test(key)) {
              addIssue(errors, 'enemy-phase-hidden', `phase cannot define hidden immunity or multiplier ${fullKey}`, location)
            }
            inspectPhaseKeys(childValue, fullKey)
          }
        }
      }
      inspectPhaseKeys(phase)
      const sourceId = phase.source_id ?? phase.source
      if (typeof sourceId !== 'string' || sourceId.trim() === '') {
        addIssue(errors, 'enemy-phase-source', 'phase source must be a non-empty loadout id', location)
      } else if (!loadoutSources.has(sourceId)) {
        addIssue(errors, 'enemy-phase-source', `phase source is not part of this enemy loadout: ${sourceId}`, location)
      }
    }
  }
  if (!['C', 'L', 'B', 'F'].includes(entity.reward_profile)) addIssue(errors, 'enemy-reward', 'reward_profile must be C/L/B/F', source)
  const expectedReward = final ? 'F' : entity.tier === 'normal' ? 'C' : entity.tier === 'elite' ? 'L' : 'B'
  if (entity.reward_profile !== expectedReward) addIssue(errors, 'enemy-reward', `reward_profile must match tier ${expectedReward}`, source)
  if (final && entity.reward_profile !== 'F') addIssue(errors, 'enemy-reward', 'final enemies must use reward_profile F', source)
  if (!final && entity.reward_profile === 'F') addIssue(errors, 'enemy-reward', 'only final enemies may use reward_profile F', source)
  if (final && Object.hasOwn(entity, 'rewards')) addIssue(errors, 'enemy-reward', 'final enemy cannot define rewards', source)
}

function routeEntries(routes) {
  if (Array.isArray(routes)) return routes
  if (isRecord(routes)) {
    return Object.entries(routes).map(([name, value]) => (isRecord(value) ? { name, ...value } : { name, nodes: value }))
  }
  return []
}

function normalizeNode(node) {
  if (typeof node === 'string') {
    if (NODE_TYPES.includes(node)) return node
    if (/^EN-.*-C\d+$/.test(node)) return 'C'
    if (/^EN-.*-L\d+$/.test(node)) return 'L'
    if (/^EN-.*-B\d+$/.test(node)) return 'B'
    if (node === 'EN-F1' || node === 'EN-F2' || node === 'F') return 'F'
    if (/^(RE|RK)\d+/.test(node)) return node.startsWith('RK') ? 'K' : 'E'
    return null
  }
  if (!isRecord(node)) return null
  const type = node.type ?? node.kind ?? node.node_type ?? node.slot
  if (NODE_TYPES.includes(type)) return type
  return normalizeNode(node.id ?? node.enemy_id ?? node.event_id ?? null)
}

function collectDeclaredPoolIds(value, known, ids = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectDeclaredPoolIds(item, known, ids)
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectDeclaredPoolIds(item, known, ids)
  } else if (typeof value === 'string' && known.ids.has(value)) {
    ids.add(value)
  }
  return ids
}

function findForbiddenFinalEconomyKeys(value, pathName = '', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenFinalEconomyKeys(item, `${pathName}[${index}]`, found))
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = pathName ? `${pathName}.${key}` : key
      if (/store|shop|heal|rest|recover|preparation|prepare|breakthrough/i.test(key)) found.push(childPath)
      findForbiddenFinalEconomyKeys(child, childPath, found)
    }
  }
  return found
}

function validateAct(entity, errors, known) {
  const source = sourceFor(entity)
  const final = entity.id === 'RF01'
  const expectedIndex = final ? null : Number(entity.id.slice(2))
  if (final) {
    if (![5, 'F'].includes(entity.index)) addIssue(errors, 'act-index', 'RF01 index must identify the final stage as 5 or F', source)
  } else if (entity.index !== expectedIndex) {
    addIssue(errors, 'act-index', `${entity.id} index must be ${expectedIndex}`, source)
  }
  for (const field of ['index', 'story', 'node_budget', 'routes', 'pools', 'rewards', 'economy', 'cultivation', 'transition']) {
    if (!(field in entity)) addIssue(errors, 'act-field', `missing act field ${field}`, source)
  }
  if (!isRecord(entity.node_budget)) {
    addIssue(errors, 'act-budget', 'node_budget must be a mapping', source)
  } else {
    const expected = final ? { F: 1 } : { C: 4, E: 3, L: 1, S: 1, R: 1, B: 1 }
    if (!exactKeys(entity.node_budget, expected)) addIssue(errors, 'act-budget', `node_budget must contain ${Object.keys(expected).join(', ')}`, source)
    for (const [key, value] of Object.entries(expected)) {
      if (entity.node_budget[key] !== value) addIssue(errors, 'act-budget', `node_budget.${key} must be ${value}`, source)
    }
    finiteTree(errors, entity.node_budget, source, 'node_budget')
  }
  const routes = routeEntries(entity.routes)
  if (final) {
    if (routes.length !== 1) addIssue(errors, 'act-routes', 'RF01 must define exactly one final route', source)
  } else if (routes.length !== 6) {
    addIssue(errors, 'act-routes', 'each adventure act must define exactly six routes', source)
  }
  const routeNames = new Set()
  for (const [index, route] of routes.entries()) {
    const location = `${source}:routes[${index}]`
    if (!isRecord(route)) {
      addIssue(errors, 'route-map', 'act route must be a mapping', location)
      continue
    }
    const routeName = route.id ?? route.name ?? String(index)
    if (routeNames.has(routeName)) addIssue(errors, 'route-duplicate', `duplicate route ${routeName}`, location)
    routeNames.add(routeName)
    if (!Array.isArray(route.nodes)) {
      addIssue(errors, 'route-nodes', 'route.nodes must be an array', location)
      continue
    }
    const expectedLength = final ? 1 : 11
    if (route.nodes.length !== expectedLength) addIssue(errors, 'route-length', `route must contain ${expectedLength} nodes`, location)
    const types = route.nodes.map(normalizeNode)
    if (types.some((type) => !type)) addIssue(errors, 'route-node-type', 'every route node must identify C/E/K/L/S/R/B/F', location)
    if (!final) {
      if (types.at(-1) !== 'B') addIssue(errors, 'route-boss', 'every adventure route must end with B', location)
      if (types.includes('F')) addIssue(errors, 'route-final', 'adventure routes cannot contain final F nodes', location)
    } else if (types[0] !== 'F') {
      addIssue(errors, 'route-final', 'RF01 route must contain one F node', location)
    }
    if (route.count !== undefined) {
      if (!isRecord(route.count)) {
        addIssue(errors, 'route-count', 'route.count must be a mapping', location)
      } else {
        for (const type of NODE_TYPES) {
          const actual = types.filter((item) => item === type).length
          if (route.count[type] !== undefined && route.count[type] !== actual) {
            addIssue(errors, 'route-count', `route.count.${type} does not match route nodes`, location)
          }
        }
      }
    }
    for (const node of route.nodes) {
      const id = isRecord(node) ? (node.id ?? node.enemy_id ?? node.event_id) : typeof node === 'string' ? node : null
      if (typeof id === 'string' && id.startsWith('EN-') && !known.enemies.has(id)) addIssue(errors, 'route-reference', `unknown enemy ${id}`, location)
      if (typeof id === 'string' && (id.startsWith('RE') || id.startsWith('RK')) && !known.events.has(id)) addIssue(errors, 'route-reference', `unknown event ${id}`, location)
    }
  }
  if (final) {
    if (!Array.isArray(entity.rewards) || entity.rewards.length !== 0) addIssue(errors, 'final-rewards', 'RF01 must have no rewards', source)
    const forbiddenEconomyKeys = findForbiddenFinalEconomyKeys(entity.economy)
    if (forbiddenEconomyKeys.length > 0) {
      addIssue(
        errors,
        'final-economy',
        `RF01 economy cannot define store, recovery, preparation, or breakthrough fields: ${forbiddenEconomyKeys.join(', ')}`,
        source,
      )
    }
  } else if (!Array.isArray(entity.rewards) && !isRecord(entity.rewards)) {
    addIssue(errors, 'act-rewards', 'adventure act rewards must be an explicit array or mapping', source)
  }
  if (!isRecord(entity.story)) addIssue(errors, 'act-story', 'story must be a mapping', source)
  if (!isRecord(entity.economy)) addIssue(errors, 'act-economy', 'economy must be a mapping', source)
  if (!isRecord(entity.cultivation)) addIssue(errors, 'act-cultivation', 'cultivation must be a mapping', source)
  if (!isRecord(entity.transition)) addIssue(errors, 'act-transition', 'transition must be a mapping', source)
  if (!isRecord(entity.pools)) {
    addIssue(errors, 'act-pools', 'pools must be a mapping', source)
  } else {
    finiteTree(errors, entity.pools, source, 'pools')
    const visitPoolReference = (value, location) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visitPoolReference(item, `${location}[${index}]`))
      } else if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) visitPoolReference(item, `${location}.${key}`)
      } else if (typeof value === 'string') {
        if (value.startsWith('EN-') && !known.enemies.has(value)) addIssue(errors, 'pool-reference', `unknown enemy ${value}`, location)
        if ((value.startsWith('RE') || value.startsWith('RK')) && !known.events.has(value)) addIssue(errors, 'pool-reference', `unknown event ${value}`, location)
      }
    }
    visitPoolReference(entity.pools, `${source}:pools`)
  }

  const declaredPoolIds = collectDeclaredPoolIds(entity.pools, known)
  const adventureRules = known.rules?.adventure ?? {}
  const maxCorePerAct = Number.isInteger(adventureRules.max_core_per_act) ? adventureRules.max_core_per_act : 1
  const maxExtraElitesPerAct = Number.isInteger(adventureRules.max_extra_elites_per_act)
    ? adventureRules.max_extra_elites_per_act
    : 1
  const minimumCommonBattles = Number.isInteger(adventureRules.min_common_battles_per_act)
    ? adventureRules.min_common_battles_per_act
    : 3
  for (const [index, route] of routes.entries()) {
    if (!isRecord(route) || !Array.isArray(route.nodes) || final) continue
    const location = `${source}:routes[${index}]`
    const types = route.nodes.map(normalizeNode)
    const counts = Object.fromEntries(NODE_TYPES.map((type) => [type, types.filter((item) => item === type).length]))
    if (counts.B !== 1) addIssue(errors, 'route-boss-count', 'each adventure route must contain exactly one B node', location)
    if (counts.K > maxCorePerAct) {
      addIssue(errors, 'route-core-count', `each adventure route may contain at most ${maxCorePerAct} K node`, location)
    }
    const baselineElites = Number(entity.node_budget?.L ?? 1)
    const maxElites = baselineElites + maxExtraElitesPerAct
    if (counts.L > maxElites) {
      addIssue(errors, 'route-elite-count', `each adventure route may contain at most ${maxElites} L nodes`, location)
    }
    if (counts.C < minimumCommonBattles) {
      addIssue(errors, 'route-common-battles', `each route must contain at least ${minimumCommonBattles} common battles`, location)
    }
    const coreIndexes = types.flatMap((type, nodeIndex) => type === 'K' ? [nodeIndex] : [])
    const minimumGap = Number.isInteger(adventureRules.min_noncore_between_core)
      ? adventureRules.min_noncore_between_core
      : 2
    for (let coreIndex = 1; coreIndex < coreIndexes.length; coreIndex += 1) {
      if (coreIndexes[coreIndex] - coreIndexes[coreIndex - 1] - 1 < minimumGap) {
        addIssue(errors, 'route-core-spacing', `K nodes must have at least ${minimumGap} non-core nodes between them`, location)
      }
    }
    for (const node of route.nodes) {
      const id = isRecord(node) ? (node.id ?? node.enemy_id ?? node.event_id) : typeof node === 'string' ? node : null
      if (typeof id !== 'string') continue
      const referenced = known.byId.get(id)
      if (referenced?.kind === 'enemy' && !referenced.acts?.includes(entity.index)) {
        addIssue(errors, 'route-act-reference', `enemy ${id} is not declared for act ${entity.index}`, location)
      }
      if (referenced?.kind === 'event' && !referenced.acts?.includes(entity.index)) {
        addIssue(errors, 'route-act-reference', `event ${id} is not declared for act ${entity.index}`, location)
      }
      if (
        declaredPoolIds.size > 0 &&
        (referenced?.kind === 'enemy' || referenced?.kind === 'event') &&
        !declaredPoolIds.has(id)
      ) {
        addIssue(errors, 'route-pool-filter', `route node ${id} is not included in the act's declared pools`, location)
      }
    }
  }
}

function validateRules(entity, errors) {
  const source = sourceFor(entity)
  for (const field of ['attributes', 'rarities', 'cultivation', 'combat', 'rage', 'statuses', 'adventure', 'economy', 'pools', 'calibration']) {
    if (!(field in entity)) addIssue(errors, 'rules-field', `missing rules field ${field}`, source)
  }
  if (!Array.isArray(entity.attributes) || entity.attributes.length !== ATTRIBUTES.length || new Set(entity.attributes).size !== ATTRIBUTES.length || ATTRIBUTES.some((item) => !entity.attributes.includes(item))) {
    addIssue(errors, 'rules-attributes', 'rules.attributes must contain the five authored attributes', source)
  }
  finiteTree(errors, entity, source, 'rules')
}

function validateEntityKind(entity, errors, known, effectIds, storylineEncounterIds) {
  switch (entity.kind) {
    case 'rules':
      validateRules(entity, errors)
      break
    case 'method':
      validateMethod(entity, errors, effectIds)
      break
    case 'artifact':
      validateArtifact(entity, errors, effectIds)
      break
    case 'event':
      validateEvent(entity, errors, known)
      break
    case 'storyline':
      validateStoryline(entity, errors, known, storylineEncounterIds)
      break
    case 'enemy':
      validateEnemy(entity, errors, known)
      break
    case 'act':
      validateAct(entity, errors, known)
      break
    default:
      break
  }
}

function makeKnown(model) {
  const byId = new Map()
  const methods = new Set()
  const artifacts = new Set()
  const events = new Set()
  const coreEvents = new Set()
  const enemies = new Set()
  const talents = new Set()
  const talentsById = new Map()
  const rules = model.entities.find((entity) => entity.kind === 'rules')
  for (const entity of model.entities) {
    if (typeof entity.id !== 'string') continue
    byId.set(entity.id, entity)
    if (entity.kind === 'method') methods.add(entity.id)
    if (entity.kind === 'artifact') artifacts.add(entity.id)
    if (entity.kind === 'event') {
      events.add(entity.id)
      if (CORE_EVENT_IDS.includes(entity.id)) coreEvents.add(entity.id)
    }
    if (entity.kind === 'enemy') enemies.add(entity.id)
    if (entity.kind === 'method') {
      for (const talent of entity.talents ?? []) {
        if (typeof talent?.id !== 'string') continue
        talents.add(talent.id)
        talentsById.set(talent.id, talent)
      }
    }
  }
  return {
    byId,
    rules,
    ids: new Set(model.entities.map((entity) => entity.id).filter(Boolean)),
    methods,
    artifacts,
    events,
    coreEvents,
    enemies,
    talents,
    talentsById,
    effects: new Set(),
  }
}

function collectRawEffectIds(model) {
  const ids = new Set()
  for (const entity of model.entities) {
    const candidates = []
    if (entity.kind === 'artifact') {
      candidates.push(entity.effects)
    } else if (entity.kind === 'method') {
      candidates.push(entity.actions?.basic?.effects, entity.actions?.rage?.effects, entity.passives, entity.travel)
      for (const talent of entity.talents ?? []) candidates.push(talent?.effects)
    }
    for (const effects of candidates) {
      for (const effect of effects ?? []) {
        if (typeof effect?.id === 'string') ids.add(effect.id)
      }
    }
  }
  return ids
}

function validateGlobal(model, errors, warnings) {
  const known = makeKnown(model)
  known.effects = collectRawEffectIds(model)
  const effectIds = new Set()
  const storylineEncounterIds = new Set()
  const entityIds = new Map()

  const manifestByPath = new Map((model.manifestEntries ?? []).map((entry) => [entry.path, entry]))
  for (const entity of model.entities) {
    const source = sourceFor(entity)
    const manifestEntry = manifestByPath.get(entity.__path)
    validateCommon(entity, manifestEntry, errors)
    if (typeof entity.id === 'string') {
      const previous = entityIds.get(entity.id)
      if (previous) addIssue(errors, 'duplicate-id', `duplicate entity id ${entity.id}`, source, previous)
      entityIds.set(entity.id, source)
    }
    validateEntityKind(entity, errors, known, effectIds, storylineEncounterIds)
  }
  known.effects = effectIds
  for (const effectId of effectIds) {
    if (entityIds.has(effectId)) {
      addIssue(errors, 'duplicate-id', `effect id ${effectId} collides with an entity id`, 'effects')
    }
  }

  const expectedIds = new Set(EXPECTED_MANIFEST_ENTRIES.map((entry) => entry.id))
  for (const id of expectedIds) {
    if (!entityIds.has(id)) addIssue(errors, 'missing-entity', `manifest entity ${id} is missing or could not be parsed`, id)
  }
  for (const id of STORYLINE_IDS) {
    if (!entityIds.has(id)) continue
  }
  if (storylineEncounterIds.size !== 12) {
    addIssue(errors, 'core-count', `storylines must cover exactly 12 distinct core events; found ${storylineEncounterIds.size}`, 'storylines')
  }
  const coreIds = new Set(CORE_EVENT_IDS)
  const independent = [...coreIds].filter((id) => !storylineEncounterIds.has(id))
  if (independent.length !== 4) {
    addIssue(errors, 'independent-core-count', `exactly 4 core events must remain independent; found ${independent.length}`, 'events/core')
  }
  if (effectIds.size === 0 && model.entities.some((entity) => entity.kind === 'method' || entity.kind === 'artifact')) {
    addIssue(errors, 'effects', 'methods and artifacts must define effect records', 'effects')
  }
  warnings.push(GENERATED_WARNING)
  return known
}

export function validateLoadedContent(model) {
  const errors = [...(model.issues ?? [])]
  const warnings = []
  const known = validateGlobal(model, errors, warnings)
  const counts = {
    entities: model.entities.length,
    methods: model.entities.filter((entity) => entity.kind === 'method').length,
    artifacts: model.entities.filter((entity) => entity.kind === 'artifact').length,
    events: model.entities.filter((entity) => entity.kind === 'event').length,
    storylines: model.entities.filter((entity) => entity.kind === 'storyline').length,
    enemies: model.entities.filter((entity) => entity.kind === 'enemy').length,
    acts: model.entities.filter((entity) => entity.kind === 'act').length,
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts,
    known,
    model,
  }
}

export async function validateContent(options = {}) {
  const model = await loadContent(options)
  return validateLoadedContent(model)
}

export class ContentValidationError extends Error {
  constructor(report) {
    super(formatValidationReport(report))
    this.name = 'ContentValidationError'
    this.report = report
  }
}

export function assertValidContent(report) {
  if (!report?.ok) throw new ContentValidationError(report)
  return report
}

export function formatValidationReport(report) {
  const lines = []
  lines.push(report?.ok ? 'content validation passed' : 'content validation failed')
  if (report?.counts) lines.push(`entities=${report.counts.entities} methods=${report.counts.methods} artifacts=${report.counts.artifacts} events=${report.counts.events} storylines=${report.counts.storylines} enemies=${report.counts.enemies} acts=${report.counts.acts}`)
  for (const error of report?.errors ?? []) {
    lines.push(`- [${error.code}] ${error.path}: ${error.message}`)
  }
  for (const warning of report?.warnings ?? []) lines.push(`warning: ${warning}`)
  return lines.join('\n')
}
