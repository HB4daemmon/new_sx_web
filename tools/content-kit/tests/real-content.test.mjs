import assert from 'node:assert/strict'
import test from 'node:test'

import { loadContent } from '../src/loader.mjs'
import { validateLoadedContent } from '../src/validator.mjs'
import { renderDocuments } from '../src/renderer.mjs'
import {
  ARTIFACT_EQUIPMENT_ROLES,
  ARTIFACT_RESONANCE_RULES,
  CORE_ARTIFACT_RULES,
  METHOD_RESONANCE_RULES,
  SHARED_INSIGHT_IDS,
} from '../src/constants.mjs'

const model = await loadContent()
const report = validateLoadedContent(model)

function entitiesOf(kind) {
  return model.byKind.get(kind) ?? []
}

function validationDetails() {
  return report.errors.map((error) => `${error.code}:${error.path}:${error.message}`).join('\n')
}

function talentById(method) {
  return new Map(method.talents.map((talent) => [talent.id, talent]))
}

function effectsOf(method) {
  return [
    ...(method.actions?.basic?.effects ?? []),
    ...(method.actions?.rage?.effects ?? []),
    ...(method.passives ?? []),
    ...(method.travel ?? []),
    ...method.talents.flatMap((talent) => talent.effects ?? []),
  ]
}

function effectById(method, id) {
  const effect = effectsOf(method).find((candidate) => candidate.id === id)
  assert.ok(effect, `${method.id} should define effect ${id}`)
  return effect
}

function enumerateStructuralTalentBuilds(method) {
  let builds = [[]]
  for (const tier of [1, 2, 3, 4]) {
    const choices = method.talents.filter((talent) => talent.tier === tier)
    builds = builds.flatMap((build) => choices.map((talent) => [...build, talent.id]))
  }
  return builds
}

test('real content validates and preserves the authored entity and talent counts', () => {
  assert.equal(report.ok, true, validationDetails())
  assert.equal(model.entities.length, 154)
  assert.equal(model.manifestEntries.length, 154)

  const expectedManifestCounts = {
    methods: 10,
    artifacts: 46,
    ordinary_events: 36,
    core_events: 16,
    storylines: 6,
    act_enemies: 32,
    final_enemies: 2,
    acts: 5,
  }
  for (const [key, expected] of Object.entries(expectedManifestCounts)) {
    assert.equal(model.manifest.counts[key], expected, `manifest.counts.${key}`)
  }

  assert.equal(entitiesOf('rules').length, 1)
  assert.equal(entitiesOf('method').length, 10)
  for (const method of entitiesOf('method')) {
    assert.equal(typeof method.companion.name, 'string', `${method.id} companion name`)
    assert.equal(typeof method.companion.quick, 'string', `${method.id} companion quick description`)
    assert.ok(method.companion.effect, `${method.id} has a combat output`)
  }
  assert.equal(entitiesOf('artifact').length, 46)
  assert.equal(entitiesOf('event').length, 52)
  assert.equal(entitiesOf('storyline').length, 6)
  assert.equal(entitiesOf('enemy').length, 34)
  assert.equal(entitiesOf('act').length, 5)

  const ordinaryEvents = entitiesOf('event').filter((event) => event.event_type === 'ordinary')
  const coreEvents = entitiesOf('event').filter((event) => event.event_type === 'core')
  const actEnemies = entitiesOf('enemy').filter((enemy) => enemy.tier !== 'final')
  const finalEnemies = entitiesOf('enemy').filter((enemy) => enemy.tier === 'final')
  assert.equal(ordinaryEvents.length, 36)
  assert.equal(coreEvents.length, 16)
  const eventOptions = entitiesOf('event').flatMap((event) => event.options)
  assert.equal(eventOptions.length, 157)
  assert.equal(eventOptions.filter((option) => option.encounter).length, 21)
  assert.equal(eventOptions.filter((option) => option.check).length, 8)
  assert.equal(actEnemies.length, 32)
  assert.equal(finalEnemies.length, 2)

  const totalTalents = entitiesOf('method').reduce((total, method) => total + method.talents.length, 0)
  assert.equal(totalTalents, 120)
  const rules = entitiesOf('rules')[0]
  const insights = rules.insights
  assert.equal(insights.length, 15)
  assert.equal(rules.source.basis, 'original')
  assert.equal(rules.balance.measured, null)
  assert.deepEqual(insights.map((talent) => talent.id).sort(), [...SHARED_INSIGHT_IDS].sort())
  assert.deepEqual([...report.known.sharedTalents].sort(), [...SHARED_INSIGHT_IDS].sort())
  for (const [tier, expectedBranches] of [[1, ['A', 'B', 'C', 'D', 'E', 'F']], [2, ['A', 'B', 'C']], [3, ['A', 'B', 'C']], [4, ['A', 'B', 'C']]]) {
    assert.deepEqual(
      insights.filter((talent) => talent.tier === tier).map((talent) => talent.branch).sort(),
      expectedBranches,
    )
  }
  const expectedBuildParams = {
    'V2-J1-A': { build: 'wealth_damage', scale: 1.2, half_saturation: 150 },
    'V2-J1-B': { build: 'hunter', base_attack: 8, base_defense: 6, elite_attack: 8, elite_defense: 6, boss_attack: 12, boss_defense: 8 },
    'V2-J1-C': { build: 'speed_damage', speed_bonus: 2, max_multiplier: 2.5 },
    'V2-J1-D': { build: 'carapace', defense_per_hit: 6, reflect_ratio: 0.24 },
    'V2-J1-E': { build: 'spending_power', base_attack: 8, attack_per_coin: 0.08 },
    'V2-J1-F': { build: 'collection_damage', base_bonus: 0.1, per_kind: 0.04 },
    'V2-J2-A': { build: 'bounty', attack_bonus: 8, normal_coins: 4, elite_coins: 20, boss_coins: 30 },
    'V2-J2-B': { build: 'shop_discount', ratio: 0.75 },
    'V2-J2-C': { build: 'basic_split', extra_segments: 2, segment_ratio: 0.6 },
    'V2-J3-A': { build: 'hit_rage', amount: 3 },
    'V2-J3-B': { build: 'rage_echo', ratio: 0.45 },
    'V2-J3-C': { build: 'veteran_shield', base_ratio: 0.06, elite_ratio: 0.02, boss_ratio: 0.03 },
    'V2-J4-A': { build: 'wealth_shield', base_shield: 30, shield_per_coin: 0.4 },
    'V2-J4-B': { build: 'trophy_damage', base_bonus: 0.12, elite_bonus: 0.1, boss_bonus: 0.15 },
  }
  for (const talent of insights) {
    const effect = talent.effects[0]
    assert.equal(effect.target, 'self', talent.id)
    assert.deepEqual(effect.requires, [], talent.id)
    assert.deepEqual(effect.consumes, [], talent.id)
    assert.deepEqual(effect.replaces, [], talent.id)
    assert.deepEqual(effect.limit, { scope: 'permanent', count: 1 }, talent.id)
    if (talent.id === 'V2-J4-C') {
      assert.equal(effect.trigger, 'always')
      assert.equal(effect.operation, 'modify_stat')
      assert.deepEqual(effect.params, { stat: 'attack', mode: 'percent_add', amount: 0.35 })
    } else {
      assert.equal(effect.id, `${talent.id}-BUILD`)
      assert.equal(effect.trigger, 'always')
      assert.equal(effect.operation, 'modify_effect')
      assert.deepEqual(effect.params, expectedBuildParams[talent.id], talent.id)
    }
  }

  for (const artifact of entitiesOf('artifact')) {
    assert.equal(artifact.equipment_role, ARTIFACT_EQUIPMENT_ROLES[artifact.id], `${artifact.id} equipment role`)
    const roleLabel = artifact.equipment_role === 'core' ? '核心定位' : '支援定位'
    assert.ok(artifact.summary.includes(roleLabel), `${artifact.id} summary discloses its descriptive role`)
    assert.doesNotMatch(artifact.description, /核心位仅1席|支援位（共3席）/, `${artifact.id} description has no role capacity claim`)
    if (CORE_ARTIFACT_RULES[artifact.id]) {
      assert.deepEqual(artifact.core_rule, CORE_ARTIFACT_RULES[artifact.id], `${artifact.id} core rule`)
    } else {
      assert.equal(Object.hasOwn(artifact, 'core_rule'), false, `${artifact.id} has no parallel core rule`)
    }
  }

  const realRules = model.byId.get('RULES')
  assert.deepEqual(realRules.economy.reward_refining, { max_per_act: 1 })
  const swordPool = realRules.economy.reward_seeking.families.sword
  assert.ok(swordPool.includes('RC01'))
  assert.equal(new Set(swordPool).size, swordPool.length)

  const convergenceCore = model.byId.get('RC01')
  assert.equal(convergenceCore.equipment_role, 'core')
  assert.deepEqual(convergenceCore.core_rule, { kind: 'basic_convergence', damage_ratio: 1.25 })
  assert.equal(convergenceCore.max_stacks, 5)
  assert.deepEqual(convergenceCore.attributes, { flat: { attack: 6 }, percent: {} })
  assert.deepEqual(convergenceCore.acquisition.pools, ['common_artifact'])

  const awakeningArtifacts = entitiesOf('artifact').filter((artifact) => artifact.awakening)
  assert.ok(awakeningArtifacts.some((artifact) => Array.isArray(artifact.awakening.effects)))
  for (const artifact of awakeningArtifacts) {
    assert.equal(artifact.awakening.at_stacks, artifact.max_stacks, `${artifact.id} awakens at max stacks`)
    assert.equal(typeof artifact.awakening.name, 'string', `${artifact.id} awakening name`)
    assert.equal(typeof artifact.awakening.quick, 'string', `${artifact.id} awakening description`)
    if (artifact.awakening.effects !== undefined) assert.ok(artifact.awakening.effects.length > 0)
  }

  for (const enemy of entitiesOf('enemy')) {
    assert.ok(enemy.artifacts.length <= 4, `${enemy.id} total equipment count`)
  }
})

test('V2 resonance rules are authored once on their owners and render with the changed method loops', () => {
  const expectedMethodParams = {
    RKF01: { resonance: 'guard_pressure', absorb_ratio: 0.75, cap_hp_ratio: 0.4, release_ratio: 1, counter_threshold_hp_ratio: 0.12 },
    RKF02: { resonance: 'returning_breath', extra_segments: 2, segment_ratio: 0.55, rage_bonus: 10 },
    RKF03: { resonance: 'spring_bloom', threshold_hp_ratio: 0.2, burst_hp_ratio: 0.12 },
    RKF04: { resonance: 'burn_accelerate', ticks: 1 },
    RKF05: { resonance: 'sword_array', artifact_intent_limit: 2, consume_stacks: 3, attack_ratio: 0.22, opening_swords: 1, flying_sword_cap: 3, flying_sword_ratio: 0.18 },
    RKF07: { resonance: 'thunder_induction', hit_threshold: 3, attack_ratio: 0.45, max_per_action: 2 },
    RKF08: { resonance: 'moon_hex', attack_ratio: 0.2, drain_per_kind: 2 },
  }
  const expectedArtifactParams = {
    RC13: { resonance: 'shield_retort', defense_ratio: 0.18 },
    RR03: { resonance: 'venom_pin', hit_threshold: 3, poison_stacks: 2, duration_rounds: 3, attack_ratio: 0.08, max_per_action: 1 },
    RR04: { resonance: 'wealth_strikes', coins_per_segment: 100, max_segments: 3, attack_ratio: 0.22 },
    RR09: { resonance: 'rebound_guard', rage_gain: 10, defense_ratio: 0.35 },
    RR11: { resonance: 'toxic_furnace', remaining_damage_ratio: 0.8, rage_gain: 8 },
    RR12: { resonance: 'healing_blades', max_charges: 2, attack_ratio: 0.35 },
    RL02: { resonance: 'ember_furnace', stored_ratio: 0.6, cap_hp_ratio: 0.5, segments: 3 },
    RL03: { resonance: 'wheel_storm', hit_threshold: 6, segments: 4, attack_ratio: 0.25, max_per_action: 1 },
  }
  for (const [owner, expectedParams] of Object.entries(expectedMethodParams)) {
    assert.ok(METHOD_RESONANCE_RULES[owner], `${owner} is an authorized method owner`)
    const method = model.byId.get(owner)
    const rule = method.passives.filter((effect) => effect.id === `${owner}-V2-RESONANCE`)
    assert.equal(rule.length, 1, `${owner} owns one resonance passive`)
    assert.deepEqual(rule[0].params, expectedParams, owner)
    assert.deepEqual(rule[0].limit, { scope: 'permanent', count: 1 }, owner)
    assert.deepEqual(rule[0].requires, [], owner)
    assert.deepEqual(rule[0].consumes, [], owner)
    assert.deepEqual(rule[0].replaces, [], owner)
    assert.equal(method.talents.flatMap((talent) => talent.effects).some((effect) => effect.params?.resonance), false, `${owner} does not attach resonance to a talent`)
  }
  for (const [owner, expectedParams] of Object.entries(expectedArtifactParams)) {
    assert.ok(ARTIFACT_RESONANCE_RULES[owner], `${owner} is an authorized artifact owner`)
    const artifact = model.byId.get(owner)
    const rule = artifact.effects.filter((effect) => effect.id === `${owner}-V2-RESONANCE`)
    assert.equal(rule.length, 1, `${owner} owns one resonance effect`)
    assert.deepEqual(rule[0].params, expectedParams, owner)
    assert.deepEqual(rule[0].limit, { scope: 'permanent', count: 1 }, owner)
    assert.deepEqual(rule[0].requires, [], owner)
    assert.deepEqual(rule[0].consumes, [], owner)
    assert.deepEqual(rule[0].replaces, [], owner)
  }

  for (const id of ['RKF06', 'RKF09', 'RKF10']) {
    assert.equal(effectsOf(model.byId.get(id)).some((effect) => effect.params?.resonance), false, `${id} keeps its existing identity`)
  }

  const ratios = {
    RKF01: [0.8, 1.1],
    RKF02: [1.55, 2],
    RKF03: [0.75, 1.15],
    RKF05: [0.95, 1.5],
    RKF07: [0.75, 0.38],
  }
  for (const [id, [basicRatio, rageRatio]] of Object.entries(ratios)) {
    const method = model.byId.get(id)
    assert.equal(effectById(method, `${id}-BASIC-DAMAGE`).params.attack_ratio, basicRatio, `${id} basic`)
    assert.equal(effectById(method, `${id}-RAGE-DAMAGE`).params.attack_ratio, rageRatio, `${id} rage`)
  }
  const sword = model.byId.get('RKF05')
  const j2a = talentById(sword).get('RKF05-J2-A').effects[0]
  const j2b = talentById(sword).get('RKF05-J2-B').effects[0]
  assert.equal(j2a.params.disables_intrinsic_sword_expenditure, true)
  assert.deepEqual(j2b.replaces, ['RKF05-V2-RESONANCE'])
  assert.equal(j2b.params.max_stacks, 5)
  assert.equal(j2b.params.damage_per_stack_attack_ratio, 0.32)
  assert.equal(j2b.params.preexisting_only, true)
  assert.equal(Object.hasOwn(effectById(sword, 'RKF05-RAGE-DAMAGE').params, 'preserve_sword_intent'), false)
  const swordArrayText = effectById(sword, 'RKF05-V2-RESONANCE').text
  assert.match(swordArrayText, /最多3柄/)
  assert.match(swordArrayText, /攻击0\.18倍/)
  assert.match(swordArrayText, /最多新增2层/)
  assert.match(swordArrayText, /0\.22倍/)
  assert.match(swordArrayText, /本场战斗内保留/)
  assert.doesNotMatch(swordArrayText, /场间保留/)

  assert.equal(
    model.byId.get('RR11').effects.find((effect) => effect.id === 'RR11-DOT-ROUND-RAGE').params.amount,
    5,
  )
  const removedArtifactEffects = {
    RC13: 'RC13-SHIELD-REFLECT-BONUS',
    RR03: 'RR03-FIRST-BASIC-HIT-POISON',
    RR04: 'RR04-BASIC-HIT-CHANCE-FOLLOWUP',
    RR09: 'RR09-REFLECT-ENEMY-ACTION-RAGE',
    RR12: 'RR12-SELF-HEAL-RAGE',
    RL02: 'RL02-FIRST-BURN-HEAL',
    RL03: 'RL03-BASIC-HIT-TWO-FOLLOWUPS',
  }
  for (const [owner, oldId] of Object.entries(removedArtifactEffects)) {
    assert.equal(model.byId.get(owner).effects.some((effect) => effect.id === oldId), false, `${owner} no longer runs ${oldId}`)
  }

  const pages = renderDocuments(report)
  assert.match(pages.get('methods/RKF05.md'), /取代归刃剑阵/)
  assert.match(pages.get('methods/RKF03.md'), /存活敌方主动作结束后/)
  assert.match(pages.get('methods/RKF03.md'), /最大气血20%/)
  assert.match(pages.get('methods/RKF01.md'), /counter_threshold_hp_ratio=0\.12/)
  assert.match(pages.get('enemies/ACT1.md'), /潮势准备/)
  assert.match(pages.get('enemies/ACT1.md'), /回生雾准备/)
  assert.match(pages.get('RULES.md'), /悬赏寻器/)
  assert.match(pages.get('RULES.md'), /剑穗/)
  assert.match(pages.get('RULES.md'), /## 炼宝/)
  assert.match(pages.get('RULES.md'), /每幕最多炼化 1 次/)
  assert.match(pages.get('artifacts/COMMON.md'), /青锋石[\s\S]*核心规则（仅装备时生效）：存活主普攻/)
  assert.match(pages.get('artifacts/COMMON.md'), /非暴击加成总和分别乘 1\.25/)
  assert.match(pages.get('methods/RKF03.md'), /## 伴生协力/)
  assert.match(pages.get('methods/RKF03.md'), /春脉灵医/)
  assert.match(pages.get('methods/RKF03.md'), /与五毒经（`RKF06`）配对/)
  assert.match(pages.get('methods/RKF06.md'), /与回春功（`RKF03`）配对/)
  assert.match(pages.get('artifacts/RARE.md'), /毒火/)
  assert.match(pages.get('artifacts/LEGENDARY.md'), /四段攻击0.25倍/)
})

test('authored trials and reward-seeking families stay on the public contract', () => {
  const tidal = model.byId.get('EN-A1-B1')
  const mist = model.byId.get('EN-A1-B2')
  assert.deepEqual(tidal.trial, {
    kind: 'tidal_charge',
    period: 3,
    charges: 3,
    attack_ratio_per_charge: 0.45,
  })
  assert.match(tidal.preview, /攻击0\.45倍/)
  assert.match(tidal.preview, /中毒、燃烧与反震不消耗/)
  assert.ok(tidal.counterplay.some((text) => /多段普攻或派生攻击/.test(text)))
  assert.deepEqual(mist.trial, {
    kind: 'reviving_mist',
    period: 3,
    charges: 3,
    heal_hp_ratio_per_charge: 0.045,
  })
  assert.match(mist.preview, /最大气血4\.5%/)
  assert.match(mist.preview, /直接伤害不消耗/)
  assert.ok(mist.counterplay.some((text) => /中毒或燃烧/.test(text)))
  assert.equal(entitiesOf('enemy').filter((enemy) => Object.hasOwn(enemy, 'trial')).length, 2)

  const seeking = model.byId.get('RULES').economy.reward_seeking
  assert.equal(seeking.price, 8)
  assert.equal(seeking.max_per_act, 1)
  assert.deepEqual(Object.keys(seeking.families).sort(), ['affliction', 'guard', 'sword', 'vitality'])
  assert.deepEqual(seeking.families.sword, ['RC01', 'RC09', 'RC20', 'RR01', 'RR03', 'RR04', 'RR10'])
  assert.deepEqual(seeking.families.guard, ['RC11', 'RC13', 'RR02', 'RR09'])
  assert.deepEqual(seeking.families.vitality, ['RC05', 'RC06', 'RC12', 'RC17', 'RC24', 'RR02', 'RR06', 'RR12'])
  assert.deepEqual(seeking.families.affliction, ['RC14', 'RC15', 'RR03', 'RR11'])
  for (const ids of Object.values(seeking.families)) {
    const rarities = ids.map((id) => model.byId.get(id).rarity)
    assert.ok(rarities.filter((rarity) => rarity === 'common').length >= 2)
    assert.ok(rarities.filter((rarity) => rarity === 'rare').length >= 2)
    assert.ok(rarities.every((rarity) => rarity !== 'legendary'))
  }
})

test('every method has four A/B/C talent tiers and 81 structural builds', () => {
  for (const method of entitiesOf('method')) {
    const talentsById = talentById(method)
    assert.equal(method.talents.length, 12, `${method.id} talent count`)

    for (const tier of [1, 2, 3, 4]) {
      const talents = method.talents.filter((talent) => talent.tier === tier)
      assert.deepEqual(
        talents.map((talent) => talent.branch).sort(),
        ['A', 'B', 'C'],
        `${method.id} tier ${tier} branches`,
      )
    }

    const builds = enumerateStructuralTalentBuilds(method)
    assert.equal(builds.length, 81, `${method.id} structural build count`)
    assert.equal(new Set(builds.map((build) => build.join('|'))).size, 81, `${method.id} build uniqueness`)

    for (const build of builds) {
      assert.equal(build.length, 4)
      assert.deepEqual(
        build.map((id) => talentsById.get(id)?.tier),
        [1, 2, 3, 4],
        `${method.id} build tier order`,
      )
      assert.equal(new Set(build).size, 4, `${method.id} build has one talent per tier`)
      assert.ok(build.every((id) => talentsById.has(id)), `${method.id} build references authored talents`)
    }

    for (const route of method.routes) {
      assert.equal(route.talents.length, 4, `${method.id} route length`)
      assert.deepEqual(
        route.talents.map((id) => talentsById.get(id)?.tier).sort((a, b) => a - b),
        [1, 2, 3, 4],
        `${method.id} route tier coverage`,
      )
    }
  }
})

test('RKF07 keeps charge luck consumption and reserved shield outlets structurally distinct', () => {
  const method = model.byId.get('RKF07')
  assert.ok(method)

  const mechanic = method.mechanic
  assert.equal(mechanic.id, 'charge_luck')
  assert.equal(mechanic.max_stacks, 1)
  assert.equal(mechanic.scope, 'battle')
  assert.equal(mechanic.initial, 0)
  assert.deepEqual(mechanic.consumption_priority, [
    'RKF07-J4-C-CHAIN',
    'RKF07-J3-B-SHIELD',
    'next_eligible_chain_check',
  ])
  assert.match(mechanic.shield_reservation, /动作开始/)
  assert.match(mechanic.shield_reservation, /消费造盾/)

  for (const effectId of ['RKF07-BASIC-CHAIN', 'RKF07-RAGE-CHAIN']) {
    const chain = effectById(method, effectId)
    assert.equal(chain.operation, 'chance_damage')
    assert.equal(chain.params.charge_luck_consumption, 'next_eligible_chain_check')
    assert.equal(chain.params.consume_if_available, true)
    assert.equal(chain.params.exclude_reserved_for_shield, true)
    assert.equal(chain.params.on_fail.apply_status, 'charge_luck')
  }

  const j3Shield = effectById(method, 'RKF07-J3-B-SHIELD')
  const j4Shield = effectById(method, 'RKF07-J4-C-CHAIN')
  for (const shield of [j3Shield, j4Shield]) {
    assert.equal(shield.trigger, 'action_end')
    assert.equal(shield.operation, 'shield')
    assert.equal(shield.target, 'self')
    assert.deepEqual(shield.requires, ['charge_luck_available'])
    assert.deepEqual(shield.consumes, ['charge_luck'])
    assert.equal(shield.params.condition.status, 'charge_luck')
    assert.equal(shield.params.condition.min_stacks, 1)
    assert.equal(shield.params.consume_status, 'charge_luck')
    assert.equal(shield.params.consume_key, 'charge_luck')
    assert.equal(shield.params.outlet_group, 'charge_luck')
    assert.equal(shield.params.max_per_action, 1)
    assert.equal(shield.params.preexisting_only, true)
    assert.equal(shield.params.reserve_at, 'action_start')
    assert.equal(shield.params.resolve_at, 'action_end')
    assert.equal(shield.params.priority_over_chain, true)
    assert.equal(shield.params.no_new_stack_while_reserved, true)
  }
  assert.deepEqual(j3Shield.replaces, [])
  assert.deepEqual(j4Shield.replaces, ['RKF07-J3-B-SHIELD'])
  assert.ok(j4Shield.params.defense_ratio > j3Shield.params.defense_ratio)
})

test('RK005 and RK006 use owned_artifact for the RC07 qualification', () => {
  const matchingOptions = []
  for (const eventId of ['RK005', 'RK006']) {
    const event = model.byId.get(eventId)
    assert.ok(event)
    const options = event.options.filter((option) =>
      option.requirements.some((requirement) => requirement.id === 'RC07'),
    )
    assert.ok(options.length > 0, `${eventId} should have an RC07-qualified option`)
    matchingOptions.push(...options)
  }

  for (const option of matchingOptions) {
    const rc07Requirements = option.requirements.filter((requirement) => requirement.id === 'RC07')
    assert.ok(rc07Requirements.length > 0, `${option.id} should require RC07`)
    for (const requirement of rc07Requirements) {
      assert.equal(requirement.type, 'owned_artifact', `${option.id} RC07 qualification`)
      assert.notEqual(requirement.type, 'capacity', `${option.id} must not use capacity for RC07`)
      assert.equal(requirement.count, 1, `${option.id} RC07 count`)
    }
  }
})

test('all event encounters are attached to options, never to the event entity', () => {
  let encounterCount = 0
  for (const event of entitiesOf('event')) {
    assert.equal(Object.hasOwn(event, 'encounter'), false, `${event.id} must not own an encounter`)
    for (const option of event.options) {
      if (!option.encounter) continue
      encounterCount += 1
      assert.equal(typeof option.encounter.enemy_id, 'string', `${option.id} encounter enemy`)
      assert.equal(typeof option.encounter.mode, 'string', `${option.id} encounter mode`)
      assert.equal(typeof option.encounter.failure_hp_floor, 'number', `${option.id} failure floor`)
      assert.ok(Array.isArray(option.encounter.failure_rewards), `${option.id} failure rewards`)
      assert.equal(typeof option.encounter.failure_outcome, 'string', `${option.id} failure outcome`)
    }
  }
  assert.ok(encounterCount > 0)
})

test('first-act event choices preserve IDs while legacy commitments stay inactive for new runs', () => {
  const events = new Map(entitiesOf('event').map((event) => [event.id, event]))
  for (let index = 1; index <= 9; index += 1) {
    const id = `RE${String(index).padStart(3, '0')}`
    const event = events.get(id)
    assert.ok(event, `${id} remains in the content set`)
    assert.equal(event.options.length, 3, `${id} keeps 2-3 mutually exclusive options`)
    assert.deepEqual(event.options.map((option) => option.id), [`${id}-A`, `${id}-B`, `${id}-C`])
    assert.equal(event.balance.measured, null, `${id} remains a design target`)
  }

  const escort = events.get('RE001').options.find((option) => option.id === 'RE001-C')
  assert.equal(escort.commitment, undefined)
  assert.equal(escort.legacy_commitment.after_nodes, 3)
  assert.deepEqual(escort.legacy_commitment.avoid_node_types, ['R'])
  assert.deepEqual(escort.legacy_commitment.rewards, [{ type: 'artifact', id: 'RC17', count: 2 }])
  assert.equal(escort.legacy_story_echo, '你交出盘缠立下护送之约，药箱尚未送达，两层行医囊也未到手。')
  assert.equal(escort.check.kind, 'chance')
  assert.deepEqual(escort.rewards, [{ type: 'artifact', id: 'RC17', count: 2 }])
  assert.equal(escort.costs[0].resource, 'coins')

  const forge = events.get('RE002').options.find((option) => option.id === 'RE002-B')
  assert.equal(forge.commitment, undefined)
  assert.equal(forge.legacy_commitment.after_nodes, 2)
  assert.deepEqual(forge.legacy_commitment.avoid_node_types, ['S'])
  assert.deepEqual(forge.legacy_commitment.rewards, [{ type: 'artifact', id: 'RC19', count: 2 }])
  assert.equal(forge.legacy_story_echo, '你预付炉钱与炉工立约，两处行程尚未走完，凝气珠仍未到手。')
  assert.equal(forge.check.kind, 'chance')
  assert.deepEqual(forge.rewards, [{ type: 'artifact', id: 'RC19', count: 2 }])
  assert.ok(forge.costs[0].amount < 0.75)

  const xpChoice = events.get('RE004').options.find((option) => option.id === 'RE004-A')
  assert.deepEqual(xpChoice.costs, [{ type: 'resource', resource: 'xp', amount: 0.2, basis: 'next_xp' }])
  assert.equal(xpChoice.rewards[0].type, 'artifact')
  assert.ok(events.get('RE004').options.some((option) => option.rewards.some((reward) => reward.resource === 'hp')))

  const pages = renderDocuments(report)
  const actOne = pages.get('events/ACT1.md')
  assert.match(actOne, /选择前隐藏具体奖励与分支结果/)
  assert.match(actOne, /检定提示：沿水寻物可能空手而归，盘缠不退/)
  assert.doesNotMatch(actOne, /护送药箱|凝气珠|本事件节点不计数|已付成本不退/)
})

test('regular acts keep shop mappings and methods keep rarity acquisition mappings', () => {
  for (const actId of ['RA01', 'RA02', 'RA03', 'RA04']) {
    const shop = model.byId.get(actId)?.economy?.shop
    assert.ok(shop, `${actId} should define a shop mapping`)
    assert.equal(typeof shop.inventory_slots, 'number')
    assert.equal(typeof shop.artifact_slots, 'number')
    assert.equal(typeof shop.common_price, 'number')
    assert.equal(typeof shop.rare_price, 'number')
    assert.ok(shop.non_artifact_prices?.recovery)
    assert.ok(shop.non_artifact_prices?.preparation)
  }

  for (const method of entitiesOf('method')) {
    assert.ok(method.acquisition)
    assert.equal(method.acquisition.pools.length, 1, `${method.id} acquisition pool count`)
    assert.deepEqual(method.acquisition.pools, [`method_${method.rarity}`], `${method.id} acquisition pool`)
    assert.equal(method.acquisition.start, method.rarity === 'common', `${method.id} start availability`)
  }
})

test('RF01 has only the final node and no event, storyline, or extra economy pools', () => {
  const finalAct = model.byId.get('RF01')
  assert.ok(finalAct)

  assert.deepEqual(finalAct.pools.events, {
    ordinary: [],
    core: [],
    storylines: {},
    independent: [],
  })
  assert.deepEqual(finalAct.pools.methods, {
    common: [],
    rare: [],
    legendary: [],
  })
  assert.deepEqual(finalAct.rewards, [])
  assert.equal(finalAct.economy.no_additional_economy, true)
  assert.equal(finalAct.economy.terminal_resource_policy.item_grant, false)
  assert.equal(finalAct.economy.terminal_resource_policy.xp_gain, 0)
  assert.equal(finalAct.economy.terminal_resource_policy.coins_gain, 0)
  assert.equal(finalAct.economy.terminal_resource_policy.free_level, false)
  assert.equal(finalAct.pools.artifacts.reward_rules.final.no_new_items, true)

  for (const field of ['no_shop', 'no_rest', 'no_preparation', 'no_items', 'no_xp', 'no_coins', 'no_freelevel', 'no_extra_transition_node']) {
    assert.equal(finalAct.transition[field], true, `RF01 transition.${field}`)
  }
})
