import assert from 'node:assert/strict'
import test from 'node:test'

import {
  eventCheckChance,
  resolveEventCheck,
} from '../../../src/shanhai/event-checks.ts'

const context = {
  seed: 'event-check-seed',
  act: 2,
  step: 5,
  eventId: 'RE011',
  optionId: 'RE011-A',
  stats: { attack: 110, defense: 100, max_hp: 200, crit_rate: 0.1, speed: 12 },
  hp: 100,
  ownedMethods: ['RKF06'],
  artifacts: [{ id: 'RC08', stacks: 1 }, { id: 'RC02', stacks: 0 }],
}

function chanceCheck(overrides = {}) {
  return {
    kind: 'chance',
    hint: '把握时机。',
    chance: 0.4,
    failure_rewards: [],
    failure_outcome: '没有成功。',
    failure_echo: '试炼失手。',
    ...overrides,
  }
}

test('stat checks compare a snapshot stat or current hp ratio against the threshold', () => {
  const attack = resolveEventCheck({
    kind: 'stat',
    hint: '稳住攻击。',
    stat: 'attack',
    threshold: 110,
    failure_rewards: [],
    failure_outcome: '失手。',
    failure_echo: '失手后离开。',
  }, context)
  assert.deepEqual(attack, {
    kind: 'stat',
    success: true,
    stat: 'attack',
    value: 110,
    threshold: 110,
  })

  const hpRatio = resolveEventCheck({
    kind: 'stat',
    hint: '伤势影响。',
    stat: 'hp_ratio',
    threshold: 0.55,
    failure_rewards: [],
    failure_outcome: '失手。',
    failure_echo: '失手后离开。',
  }, context)
  assert.deepEqual(hpRatio, {
    kind: 'stat',
    success: false,
    stat: 'hp_ratio',
    value: 0.5,
    threshold: 0.55,
  })
})

test('chance checks sum only satisfied stat, method, and artifact bonuses and clamp', () => {
  const check = chanceCheck({
    bonuses: [
      { type: 'stat', stat: 'attack', threshold: 110, amount: 0.1 },
      { type: 'method', id: 'RKF06', amount: 0.15 },
      { type: 'artifact', id: 'RC08', amount: 0.1 },
      { type: 'artifact', id: 'RC02', amount: 0.2 },
    ],
  })
  assert.equal(eventCheckChance(check, context), 0.75)
  assert.equal(eventCheckChance(chanceCheck({ chance: 0.99, bonuses: [{ type: 'method', id: 'RKF06', amount: 0.2 }] }), context), 0.95)
  assert.equal(eventCheckChance(chanceCheck({ chance: 0.01 }), context), 0.05)
})

test('chance roll is stable for its named seed and option and independent of prior calls', () => {
  const check = chanceCheck({ chance: 0.5 })
  const first = resolveEventCheck(check, context)
  resolveEventCheck(chanceCheck({ chance: 0.9 }), { ...context, optionId: 'RE011-B' })
  const second = resolveEventCheck(check, context)
  const nextPosition = resolveEventCheck(check, { ...context, step: context.step + 1 })

  assert.deepEqual(second, first)
  assert.notEqual(nextPosition.roll, first.roll)
  assert.ok(first.roll >= 0 && first.roll < 1)
})

test('invalid runtime numeric inputs are rejected instead of silently changing a check', () => {
  assert.throws(() => eventCheckChance(chanceCheck({ chance: Number.NaN }), context), /finite/)
  assert.throws(() => eventCheckChance(chanceCheck({ chance: 1.1 }), context), /between 0 and 1/)
  assert.throws(() => resolveEventCheck({
    kind: 'stat',
    hint: '无效。',
    stat: 'attack',
    threshold: Infinity,
    failure_rewards: [],
    failure_outcome: '失败。',
    failure_echo: '失败。',
  }, context), /finite/)
})
