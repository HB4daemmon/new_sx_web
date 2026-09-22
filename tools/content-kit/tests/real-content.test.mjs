import assert from 'node:assert/strict'
import test from 'node:test'

import { loadContent } from '../src/loader.mjs'
import { validateLoadedContent } from '../src/validator.mjs'

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
  assert.equal(model.entities.length, 152)
  assert.equal(model.manifestEntries.length, 152)

  const expectedManifestCounts = {
    methods: 10,
    artifacts: 44,
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
  assert.equal(entitiesOf('artifact').length, 44)
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
  assert.equal(actEnemies.length, 32)
  assert.equal(finalEnemies.length, 2)

  const totalTalents = entitiesOf('method').reduce((total, method) => total + method.talents.length, 0)
  assert.equal(totalTalents, 120)
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
