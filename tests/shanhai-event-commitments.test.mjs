import assert from 'node:assert/strict'
import test from 'node:test'

import {
  advanceEventCommitments,
  createEventCommitment,
  validateEventCommitmentDefinition,
} from '../build/shanhai/event-commitments.js'

const definition = (overrides = {}) => ({
  name: '护送药箱',
  after_nodes: 2,
  avoid_node_types: ['R'],
  rewards: [{ type: 'artifact', id: 'RC17', count: 2 }],
  success_outcome: '药箱送达，取得两层行医囊。',
  failure_outcome: '护送失约，盘缠不退，也没有药囊。',
  ...overrides,
})

function record(overrides = {}) {
  return createEventCommitment('RE001', 'RE001-A', { act: 1, step: 3 }, definition(overrides))
}

function advance(records, act, step, type, phase) {
  return advanceEventCommitments(records, { act, step, type }, phase)
}

test('the source event node is excluded and a saved cross-act commitment fulfills once', () => {
  const initial = record()
  const sourceEntry = advance([initial], 1, 3, 'E', 'entered')
  const sourceComplete = advance(sourceEntry.eventCommitments, 1, 3, 'E', 'completed')
  assert.equal(sourceComplete.eventCommitments[0].remaining, 2)
  assert.deepEqual(sourceComplete.fulfilled, [])

  const firstNode = advance(sourceComplete.eventCommitments, 1, 4, 'C', 'completed')
  assert.equal(firstNode.eventCommitments[0].remaining, 1)
  const restored = JSON.parse(JSON.stringify(firstNode.eventCommitments))
  const secondNode = advance(restored, 2, 1, 'B', 'completed')
  assert.equal(secondNode.eventCommitments[0].remaining, 0)
  assert.equal(secondNode.eventCommitments[0].status, 'fulfilled')
  assert.equal(secondNode.fulfilled.length, 1)
  assert.deepEqual(secondNode.fulfilled[0].snapshot.rewards, [{ type: 'artifact', id: 'RC17', count: 2 }])

  const repeated = advance(secondNode.eventCommitments, 2, 1, 'B', 'completed')
  assert.deepEqual(repeated.fulfilled, [])
  assert.equal(repeated.eventCommitments[0].status, 'fulfilled')
})

test('node completion is idempotent even if the same active node is delivered twice', () => {
  const initial = record()
  const first = advance([initial], 1, 4, 'C', 'completed')
  const duplicate = advance(first.eventCommitments, 1, 4, 'C', 'completed')
  assert.equal(duplicate.eventCommitments[0].remaining, 1)
  assert.deepEqual(duplicate.fulfilled, [])
  const next = advance(duplicate.eventCommitments, 1, 5, 'L', 'completed')
  assert.equal(next.eventCommitments[0].status, 'fulfilled')
  assert.equal(next.fulfilled.length, 1)
})

test('entering either avoided branch node breaks without refund or later fulfillment', () => {
  for (const type of ['R', 'S']) {
    const initial = record({ avoid_node_types: [type] })
    const entered = advance([initial], 1, 4, type, 'entered')
    assert.equal(entered.eventCommitments[0].status, 'broken')
    assert.equal(entered.broken.length, 1)
    assert.deepEqual(entered.eventCommitments[0].snapshot.rewards, initial.snapshot.rewards)

    const completed = advance(entered.eventCommitments, 1, 4, type, 'completed')
    assert.equal(completed.eventCommitments[0].status, 'broken')
    assert.deepEqual(completed.fulfilled, [])
  }
})

test('a final node expires an outstanding commitment and cannot grant its reward', () => {
  const initial = record({ after_nodes: 3 })
  const expired = advance([initial], 1, 4, 'F', 'entered')
  assert.equal(expired.eventCommitments[0].status, 'expired')
  assert.equal(expired.expired.length, 1)
  assert.deepEqual(expired.fulfilled, [])
  assert.deepEqual(expired.eventCommitments[0].snapshot.rewards, initial.snapshot.rewards)
})

test('legacy saves without eventCommitments are treated as empty', () => {
  const result = advance(undefined, 1, 1, 'C', 'completed')
  assert.deepEqual(result.eventCommitments, [])
  assert.deepEqual(result.fulfilled, [])
  assert.deepEqual(result.broken, [])
  assert.deepEqual(result.expired, [])
})

test('definition validation only accepts bounded artifact and flat-resource rewards', () => {
  assert.deepEqual(validateEventCommitmentDefinition(definition()), [])
  assert.ok(validateEventCommitmentDefinition(definition({ after_nodes: 4 })).some((error) => error.includes('after_nodes')))
  assert.ok(validateEventCommitmentDefinition(definition({
    avoid_node_types: ['B'],
  })).some((error) => error.includes('avoid_node_types')))
  assert.ok(validateEventCommitmentDefinition(definition({
    rewards: [{ type: 'resource', resource: 'coins', amount: 5, basis: 'common_price' }],
  })).some((error) => error.includes('basis')))
})
