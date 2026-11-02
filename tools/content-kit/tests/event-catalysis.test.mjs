import assert from 'node:assert/strict'
import test from 'node:test'

import { loadContent } from '../src/loader.mjs'
import { validateLoadedContent } from '../src/validator.mjs'

const loaded = await loadContent()
assert.deepEqual(loaded.issues, [])

function catalysisReport(edit) {
  const model = structuredClone(loaded)
  const event = model.entities.find(entity => entity.id === 'RE012')
  const option = event.options.find(candidate => candidate.id === 'RE012-C')
  edit(option)
  model.byId.set(event.id, event)
  model.byKind.set('event', model.entities.filter(entity => entity.kind === 'event'))
  return validateLoadedContent(model)
}

function assertCatalysisIssue(report, code) {
  assert.equal(report.ok, false)
  assert.ok(report.errors.some(issue => issue.code === code),
    `expected ${code}; received ${report.errors.map(issue => issue.code).join(', ')}`)
}

test('event catalysis options reject extra effects, altered prices, and nonempty rewards', () => {
  assertCatalysisIssue(catalysisReport(option => {
    option.encounter = { enemy_id: 'EN-A2-C1' }
  }), 'event-catalysis-fields')

  assertCatalysisIssue(catalysisReport(option => {
    option.costs[0].amount = 0.4
  }), 'event-catalysis-cost')

  assertCatalysisIssue(catalysisReport(option => {
    option.rewards.push({ type: 'resource', resource: 'coins', amount: 1, basis: 'flat' })
  }), 'event-catalysis-rewards')

  assertCatalysisIssue(catalysisReport(option => {
    option.catalysis.extra = true
  }), 'event-catalysis')
})
