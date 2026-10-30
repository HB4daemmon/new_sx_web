import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = path.resolve(TOOL_ROOT, '..', '..')
export const CONTENT_ROOT = path.resolve(REPO_ROOT, 'content', 'shanhai')
export const MANIFEST_PATH = path.resolve(CONTENT_ROOT, 'manifest.yaml')
export const DOCS_ROOT = path.resolve(REPO_ROOT, 'docs', 'shanhai', 'rework', 'content')

export const CONTENT_VERSION = 'shanhai-content-0.2'
export const SCHEMA_VERSION = 1

export const METHOD_IDS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => `RKF${String(index + 1).padStart(2, '0')}`),
)
export const METHOD_RARITIES = Object.freeze({
  RKF01: 'common',
  RKF02: 'common',
  RKF03: 'common',
  RKF04: 'common',
  RKF05: 'common',
  RKF06: 'rare',
  RKF07: 'rare',
  RKF08: 'rare',
  RKF09: 'legendary',
  RKF10: 'legendary',
})
export const COMPANION_TRIGGERS = Object.freeze([
  'hit',
  'shield',
  'heal',
  'rage',
  'poison',
  'burn',
  'debuff',
  'phase',
])
export const COMPANION_EFFECT_KINDS = Object.freeze([
  'damage',
  'shield',
  'heal',
  'rage',
  'poison',
  'burn',
])
export const AWAKENING_TRIGGERS = Object.freeze(['basic', 'rage', 'either'])
export const AWAKENING_EFFECT_KINDS = COMPANION_EFFECT_KINDS

export const ARTIFACT_IDS = Object.freeze([
  ...Array.from({ length: 24 }, (_, index) => `RC${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 15 }, (_, index) => `RR${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, index) => `RL${String(index + 1).padStart(2, '0')}`),
])
export const ARTIFACT_RARITIES = Object.freeze({
  ...Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`RC${String(index + 1).padStart(2, '0')}`, 'common'])),
  ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`RR${String(index + 1).padStart(2, '0')}`, 'rare'])),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`RL${String(index + 1).padStart(2, '0')}`, 'legendary'])),
})
export const ARTIFACT_FUSION_RECIPES = Object.freeze({
  RL06: Object.freeze({ inputs: Object.freeze(['RC14', 'RC15']), fights: 2 }),
  RL07: Object.freeze({ inputs: Object.freeze(['RC01', 'RC09']), fights: 2 }),
})
export const ARTIFACT_FUSION_RULES = Object.freeze({
  RL06: Object.freeze({ kind: 'toxic_flame' }),
  RL07: Object.freeze({ kind: 'twin_swords' }),
})
export const ARTIFACT_GAMBIT_RULES = Object.freeze({
  RL04: Object.freeze({ kind: 'overdrive', rage_cap: 50, defense_multiplier: 0.65 }),
  RR05: Object.freeze({ kind: 'reckless', defense_multiplier: 0.5, direct_damage_multiplier: 1.6 }),
})
export const ARTIFACT_MIRROR_RULES = Object.freeze({
  RL08: Object.freeze({ kind: 'neighbor_awakening' }),
})
export const ARTIFACT_MIRROR_UNIQUE_GROUP = 'awakening_mirror'
export const CORE_ARTIFACT_RULES = Object.freeze({
  RC01: Object.freeze({ kind: 'basic_convergence', damage_ratio: 1.25 }),
  RC09: Object.freeze({ kind: 'basic_echo', ratio: 0.45, rage_damage_ratio: 0.65 }),
  RC10: Object.freeze({ kind: 'rage_gambit', rage_refund: 20, incoming_damage_ratio: 1.12 }),
  RC11: Object.freeze({ kind: 'shield_burst', opening_shield_ratio: 0.12, shield_ratio: 0.5, damage_ratio: 1.4 }),
  RC12: Object.freeze({ kind: 'healing_guard', heal_ratio: 0.04, shield_ratio: 0.6, direct_damage_ratio: 0.8 }),
  RC14: Object.freeze({ kind: 'poison_detonation', poison_stacks: 1, damage_ratio: 1.1 }),
  RC15: Object.freeze({ kind: 'burn_siphon', burn_stacks: 1, heal_ratio: 0.25, rage_damage_ratio: 0.8 }),
})
export const CORE_ARTIFACT_IDS = Object.freeze([
  ...Object.keys(CORE_ARTIFACT_RULES),
  'RL01',
  'RL02',
  'RL03',
  'RL04',
  'RL05',
  'RL06',
  'RL07',
])
export const ARTIFACT_EQUIPMENT_ROLES = Object.freeze(Object.fromEntries(
  ARTIFACT_IDS.map((id) => [id, CORE_ARTIFACT_IDS.includes(id) ? 'core' : 'support']),
))
export const SHARED_INSIGHT_IDS = Object.freeze([
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((branch) => `V2-J1-${branch}`),
  ...Array.from({ length: 3 }, (_, index) =>
    ['A', 'B', 'C'].map((branch) => `V2-J${index + 2}-${branch}`),
  ).flat(),
])

const numericRange = (min, max, integer = false) => Object.freeze({ min, max, integer })
const buildRule = (kind, params) => Object.freeze({ kind, params: Object.freeze(params) })
const resonanceRule = (kind, params) => Object.freeze({ kind, params: Object.freeze(params) })
const resonanceRatio = numericRange(0, 1)
const resonancePositiveRatio = numericRange(Number.MIN_VALUE, 1)
const resonanceIntegerPoints = numericRange(0, undefined, true)
const resonanceCount = numericRange(1, undefined, true)
const trialPeriod = numericRange(1, 10, true)
const trialCharges = numericRange(1, 10, true)
export const REWARD_SEEKING_FAMILIES = Object.freeze(['sword', 'guard', 'vitality', 'affliction'])
export const ENEMY_TRIAL_RULES = Object.freeze({
  'EN-A1-B1': Object.freeze({
    kind: 'tidal_charge',
    params: Object.freeze({
      period: trialPeriod,
      charges: trialCharges,
      attack_ratio_per_charge: resonancePositiveRatio,
    }),
  }),
  'EN-A1-B2': Object.freeze({
    kind: 'reviving_mist',
    params: Object.freeze({
      period: trialPeriod,
      charges: trialCharges,
      heal_hp_ratio_per_charge: resonancePositiveRatio,
    }),
  }),
})
export const SHARED_INSIGHT_BUILD_RULES = Object.freeze({
  'V2-J1-A': buildRule('wealth_damage', {
    scale: numericRange(0, 5),
    half_saturation: numericRange(1, 10000),
  }),
  'V2-J1-B': buildRule('hunter', {
    base_attack: numericRange(0, 100),
    base_defense: numericRange(0, 100),
    elite_attack: numericRange(0, 100),
    elite_defense: numericRange(0, 100),
    boss_attack: numericRange(0, 100),
    boss_defense: numericRange(0, 100),
  }),
  'V2-J1-C': buildRule('speed_damage', {
    speed_bonus: numericRange(0, 100),
    max_multiplier: numericRange(1, 5),
  }),
  'V2-J1-D': buildRule('carapace', {
    defense_per_hit: numericRange(0, 100),
    reflect_ratio: numericRange(0, 1),
  }),
  'V2-J1-E': buildRule('spending_power', {
    base_attack: numericRange(0, 100),
    attack_per_coin: numericRange(0, 1),
  }),
  'V2-J1-F': buildRule('collection_damage', {
    base_bonus: numericRange(0, 1),
    per_kind: numericRange(0, 1),
  }),
  'V2-J1-G': buildRule('blood_vow', {
    healing_multiplier: numericRange(1.5, 1.5),
    damage_multiplier: numericRange(1.35, 1.35),
  }),
  'V2-J2-A': buildRule('bounty', {
    attack_bonus: numericRange(0, 100),
    normal_coins: numericRange(0, 1000, true),
    elite_coins: numericRange(0, 1000, true),
    boss_coins: numericRange(0, 1000, true),
  }),
  'V2-J2-B': buildRule('shop_discount', {
    ratio: numericRange(0, 1),
  }),
  'V2-J2-C': buildRule('basic_split', {
    extra_segments: numericRange(1, 10, true),
    segment_ratio: numericRange(0, 1),
  }),
  'V2-J3-A': buildRule('hit_rage', {
    amount: numericRange(0, 100, true),
  }),
  'V2-J3-B': buildRule('rage_echo', {
    ratio: numericRange(0, 1),
  }),
  'V2-J3-C': buildRule('veteran_shield', {
    base_ratio: numericRange(0, 1),
    elite_ratio: numericRange(0, 1),
    boss_ratio: numericRange(0, 1),
  }),
  'V2-J4-A': buildRule('wealth_shield', {
    base_shield: numericRange(0, 10000),
    shield_per_coin: numericRange(0, 100),
  }),
  'V2-J4-B': buildRule('trophy_damage', {
    base_bonus: numericRange(0, 1),
    elite_bonus: numericRange(0, 1),
    boss_bonus: numericRange(0, 1),
  }),
})

export const METHOD_RESONANCE_RULES = Object.freeze({
  RKF01: resonanceRule('guard_pressure', {
    absorb_ratio: resonanceRatio,
    cap_hp_ratio: resonanceRatio,
    release_ratio: resonanceRatio,
    counter_threshold_hp_ratio: resonancePositiveRatio,
  }),
  RKF02: resonanceRule('returning_breath', {
    extra_segments: resonanceCount,
    segment_ratio: resonanceRatio,
    rage_bonus: resonanceIntegerPoints,
  }),
  RKF03: resonanceRule('spring_bloom', {
    threshold_hp_ratio: resonancePositiveRatio,
    burst_hp_ratio: resonanceRatio,
  }),
  RKF04: resonanceRule('burn_accelerate', {
    ticks: resonanceCount,
  }),
  RKF05: resonanceRule('sword_array', {
    artifact_intent_limit: resonanceCount,
    consume_stacks: resonanceCount,
    attack_ratio: resonanceRatio,
    opening_swords: resonanceCount,
    flying_sword_cap: resonanceCount,
    flying_sword_ratio: resonancePositiveRatio,
  }),
  RKF07: resonanceRule('thunder_induction', {
    hit_threshold: resonanceCount,
    attack_ratio: resonanceRatio,
    max_per_action: resonanceCount,
  }),
  RKF08: resonanceRule('moon_hex', {
    attack_ratio: resonanceRatio,
    drain_per_kind: resonanceCount,
  }),
})

export const ARTIFACT_RESONANCE_RULES = Object.freeze({
  RC13: resonanceRule('shield_retort', {
    defense_ratio: resonanceRatio,
  }),
  RR03: resonanceRule('venom_pin', {
    hit_threshold: resonanceCount,
    poison_stacks: resonanceCount,
    duration_rounds: resonanceCount,
    attack_ratio: resonanceRatio,
    max_per_action: resonanceCount,
  }),
  RR04: resonanceRule('wealth_strikes', {
    coins_per_segment: resonanceCount,
    max_segments: resonanceCount,
    attack_ratio: resonanceRatio,
  }),
  RR09: resonanceRule('rebound_guard', {
    rage_gain: resonanceIntegerPoints,
    defense_ratio: resonanceRatio,
  }),
  RR11: resonanceRule('toxic_furnace', {
    remaining_damage_ratio: resonanceRatio,
    rage_gain: resonanceIntegerPoints,
  }),
  RR12: resonanceRule('healing_blades', {
    max_charges: resonanceCount,
    attack_ratio: resonanceRatio,
  }),
  RL02: resonanceRule('ember_furnace', {
    stored_ratio: resonanceRatio,
    cap_hp_ratio: resonanceRatio,
    segments: resonanceCount,
  }),
  RL03: resonanceRule('wheel_storm', {
    hit_threshold: resonanceCount,
    segments: resonanceCount,
    attack_ratio: resonanceRatio,
    max_per_action: resonanceCount,
  }),
})

export const ORDINARY_EVENT_IDS = Object.freeze(
  Array.from({ length: 36 }, (_, index) => `RE${String(index + 1).padStart(3, '0')}`),
)
export const CORE_EVENT_IDS = Object.freeze(
  Array.from({ length: 16 }, (_, index) => `RK${String(index + 1).padStart(3, '0')}`),
)
export const STORYLINE_IDS = Object.freeze(
  Array.from({ length: 6 }, (_, index) => `RS${String(index + 1).padStart(2, '0')}`),
)
export const ACT_IDS = Object.freeze([
  'RA01',
  'RA02',
  'RA03',
  'RA04',
  'RF01',
])

export const ENEMY_IDS = Object.freeze([
  ...Array.from({ length: 4 }, (_, act) =>
    [
      ...Array.from({ length: 4 }, (_, index) => `EN-A${act + 1}-C${index + 1}`),
      ...Array.from({ length: 2 }, (_, index) => `EN-A${act + 1}-L${index + 1}`),
      ...Array.from({ length: 2 }, (_, index) => `EN-A${act + 1}-B${index + 1}`),
    ].flat(),
  ).flat(),
  'EN-F1',
  'EN-F2',
])

export const EXPECTED_IDS = Object.freeze([
  'RULES',
  ...METHOD_IDS,
  ...ARTIFACT_IDS,
  ...ORDINARY_EVENT_IDS,
  ...CORE_EVENT_IDS,
  ...STORYLINE_IDS,
  ...ENEMY_IDS,
  ...ACT_IDS,
])

export const ENTITY_KINDS = Object.freeze([
  'rules',
  'method',
  'artifact',
  'event',
  'storyline',
  'enemy',
  'act',
])

export const EFFECT_TRIGGERS = Object.freeze([
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
  'node_complete',
  'battle_node_complete',
  'rest_complete',
  'event_cost_paid',
  'always',
])

export const EFFECT_OPERATIONS = Object.freeze([
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
  'grant_resource',
  'prepare_next_battle',
  'reduce_event_cost',
  'replace_action',
  'chance_damage',
  'modify_chance',
])

export const EFFECT_TARGETS = Object.freeze(['self', 'enemy', 'both', 'run'])
export const EFFECT_LIMIT_SCOPES = Object.freeze([
  'segment',
  'action',
  'enemy_action',
  'round',
  'battle',
  'node',
  'run',
  'permanent',
])

export const ATTRIBUTES = Object.freeze(['attack', 'defense', 'max_hp', 'crit_rate', 'speed'])
export const RARITIES = Object.freeze(['common', 'rare', 'legendary'])
export const ARTIFACT_BUDGET = Object.freeze({ common: 1, rare: 2.4, legendary: 4 })
export const METHOD_MULTIPLIER = Object.freeze({ common: 1, rare: 1.1, legendary: 1.25 })
export const METHOD_P_BY_TIER = Object.freeze([100, 125, 150, 175, 200])

export const ARTIFACT_BASELINE = Object.freeze({
  RC01: { name: '青锋石', max_stacks: 5, flat: { attack: 6 }, percent: {} },
  RC02: { name: '虎纹佩', max_stacks: 3, flat: {}, percent: { attack: 0.04 } },
  RC03: { name: '玄铁甲', max_stacks: 5, flat: { defense: 5 }, percent: {} },
  RC04: { name: '厚土环', max_stacks: 3, flat: {}, percent: { defense: 0.04 } },
  RC05: { name: '养气玉', max_stacks: 5, flat: { max_hp: 25 }, percent: {} },
  RC06: { name: '长生结', max_stacks: 3, flat: {}, percent: { max_hp: 0.05 } },
  RC07: { name: '明目珠', max_stacks: 3, flat: { crit_rate: 0.02 }, percent: {} },
  RC08: { name: '疾风履', max_stacks: 3, flat: { speed: 1 }, percent: {} },
  RC09: { name: '剑穗', max_stacks: 3, flat: { attack: 2 }, percent: {} },
  RC10: { name: '雷纹印', max_stacks: 3, flat: { attack: 2 }, percent: {} },
  RC11: { name: '铁壁符', max_stacks: 3, flat: { defense: 2 }, percent: {} },
  RC12: { name: '回春瓶', max_stacks: 3, flat: { max_hp: 10 }, percent: {} },
  RC13: { name: '震山环', max_stacks: 3, flat: { defense: 2 }, percent: {} },
  RC14: { name: '蛇纹瓶', max_stacks: 3, flat: { attack: 2 }, percent: {} },
  RC15: { name: '赤炎珠', max_stacks: 3, flat: { attack: 2 }, percent: {} },
  RC16: { name: '采气袋', max_stacks: 3, flat: { attack: 2 }, percent: {} },
  RC17: { name: '行医囊', max_stacks: 3, flat: { max_hp: 10 }, percent: {} },
  RC18: { name: '聚财钱', max_stacks: 3, flat: { defense: 2 }, percent: {} },
  RC19: { name: '凝气珠', max_stacks: 3, flat: { attack: 2 }, percent: {} },
  RC20: { name: '引气符', max_stacks: 3, flat: { attack: 2 }, percent: {} },
  RC21: { name: '调息玉', max_stacks: 3, flat: { defense: 2 }, percent: {} },
  RC22: { name: '先机符', max_stacks: 3, flat: { attack: 2 }, percent: {} },
  RC23: { name: '返气环', max_stacks: 3, flat: { defense: 2 }, percent: {} },
  RC24: { name: '血气石', max_stacks: 3, flat: { max_hp: 10 }, percent: {} },
  RR01: { name: '蓄气珠', max_stacks: 1, flat: { attack: 8 }, percent: {} },
  RR02: { name: '甘露盏', max_stacks: 1, flat: { max_hp: 30 }, percent: {} },
  RR03: { name: '毒牙钉', max_stacks: 1, flat: { attack: 8 }, percent: {} },
  RR04: { name: '如意钱', max_stacks: 1, flat: { attack: 6, crit_rate: 0.02 }, percent: {} },
  RR05: { name: '镇心玉', max_stacks: 1, flat: { defense: 8 }, percent: {} },
  RR06: { name: '长明灯', max_stacks: 1, flat: { max_hp: 30 }, percent: {} },
  RR07: { name: '回元佩', max_stacks: 1, flat: { defense: 8 }, percent: {} },
  RR08: { name: '血勇佩', max_stacks: 1, flat: { max_hp: 30 }, percent: {} },
  RR09: { name: '震岳鼓', max_stacks: 1, flat: { defense: 8 }, percent: {} },
  RR10: { name: '引雷针', max_stacks: 1, flat: { attack: 8 }, percent: {} },
  RR11: { name: '余烬盏', max_stacks: 1, flat: { max_hp: 30 }, percent: {} },
  RR12: { name: '回生佩', max_stacks: 1, flat: { max_hp: 30 }, percent: {} },
  RR13: { name: '截脉针', max_stacks: 1, flat: { attack: 8 }, percent: {} },
  RR14: { name: '封元镜', max_stacks: 1, flat: { defense: 8 }, percent: {} },
  RR15: { name: '定心佩', max_stacks: 1, flat: { max_hp: 30 }, percent: {} },
  RL01: { name: '琉璃法印', max_stacks: 1, flat: { defense: 8 }, percent: { max_hp: 0.12 } },
  RL02: { name: '薪火宝炉', max_stacks: 1, flat: { attack: 12, defense: 6 }, percent: {} },
  RL03: { name: '裂空宝轮', max_stacks: 1, flat: { attack: 12, crit_rate: 0.03 }, percent: {} },
  RL04: { name: '启明玉', max_stacks: 1, flat: { attack: 12, speed: 1 }, percent: {} },
  RL05: { name: '回澜印', max_stacks: 1, flat: { attack: 12, defense: 6 }, percent: {} },
  RL06: { name: '九幽毒火幡', max_stacks: 1, flat: {}, percent: {} },
  RL07: { name: '雌雄剑', max_stacks: 1, flat: {}, percent: {} },
  RL08: { name: '昆仑镜', max_stacks: 1, flat: { defense: 8 }, percent: {} },
})

export const ROUTE_LABELS = Object.freeze(['稳健', '精英', '追踪', '省钱', '硬闯', '避险'])
export const NODE_TYPES = Object.freeze(['C', 'E', 'K', 'L', 'S', 'R', 'B', 'F'])

export function expectedManifestEntries() {
  const entries = [
    { id: 'RULES', kind: 'rules', path: 'rules/RULES.yaml' },
    ...METHOD_IDS.map((id) => ({ id, kind: 'method', path: `methods/${id}.yaml` })),
    ...ARTIFACT_IDS.map((id) => ({
      id,
      kind: 'artifact',
      path: `artifacts/${id.startsWith('RC') ? 'common' : id.startsWith('RR') ? 'rare' : 'legendary'}/${id}.yaml`,
    })),
    ...ORDINARY_EVENT_IDS.map((id) => ({ id, kind: 'event', path: `events/ordinary/${id}.yaml` })),
    ...CORE_EVENT_IDS.map((id) => ({ id, kind: 'event', path: `events/core/${id}.yaml` })),
    ...STORYLINE_IDS.map((id) => ({ id, kind: 'storyline', path: `storylines/${id}.yaml` })),
    ...Array.from({ length: 4 }, (_, index) => [
      ...Array.from({ length: 4 }, (_, enemy) => ({
        id: `EN-A${index + 1}-C${enemy + 1}`,
        kind: 'enemy',
        path: `enemies/act${index + 1}/EN-A${index + 1}-C${enemy + 1}.yaml`,
      })),
      ...Array.from({ length: 2 }, (_, enemy) => ({
        id: `EN-A${index + 1}-L${enemy + 1}`,
        kind: 'enemy',
        path: `enemies/act${index + 1}/EN-A${index + 1}-L${enemy + 1}.yaml`,
      })),
      ...Array.from({ length: 2 }, (_, enemy) => ({
        id: `EN-A${index + 1}-B${enemy + 1}`,
        kind: 'enemy',
        path: `enemies/act${index + 1}/EN-A${index + 1}-B${enemy + 1}.yaml`,
      })),
    ]).flat(),
    { id: 'EN-F1', kind: 'enemy', path: 'enemies/final/EN-F1.yaml' },
    { id: 'EN-F2', kind: 'enemy', path: 'enemies/final/EN-F2.yaml' },
    ...ACT_IDS.map((id) => ({ id, kind: 'act', path: `acts/${id}.yaml` })),
  ]
  return Object.freeze(entries)
}

export const EXPECTED_MANIFEST_ENTRIES = expectedManifestEntries()
