import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { normalizeEnemyMultipliers, scaleEnemyBaseStats } from './shanhai-difficulty.mjs';
import { parseEnemyMultipliers, simulateMultiPolicy } from './shanhai-v2-multipolicy-simulate.mjs';

const ACTS = ['1', '2', '3', '4', '5'];
const STATS = ['attack', 'defense', 'max_hp'];

function identityMultipliers() {
  return Object.fromEntries(ACTS.map(act => [act, Object.fromEntries(STATS.map(stat => [stat, 1]))]));
}

test('enemy multiplier input defaults omitted values to one and rejects invalid or mixed formats', () => {
  assert.deepEqual(parseEnemyMultipliers(), identityMultipliers());
  assert.deepEqual(parseEnemyMultipliers('{"1":{"attack":2},"5":{"max_hp":0.5}}'), {
    ...identityMultipliers(),
    '1': { attack: 2, defense: 1, max_hp: 1 },
    '5': { attack: 1, defense: 1, max_hp: 0.5 },
  });
  assert.deepEqual(parseEnemyMultipliers('{"defense":1.25}'),
    Object.fromEntries(ACTS.map(act => [act, { attack: 1, defense: 1.25, max_hp: 1 }])));

  for (const raw of [
    '{',
    'null',
    '[]',
    '{"1":{"attack":0}}',
    '{"2":{"defense":-1}}',
    '{"3":{"max_hp":1e999}}',
    '{"6":{"attack":2}}',
    '{"1":{"attack":2},"defense":1.5}',
  ]) {
    assert.throws(() => parseEnemyMultipliers(raw), undefined, raw);
  }
});

test('per-act scaling changes only enemy base stats and preserves enemy equipment', async () => {
  const model = await loadContent();
  const sourceContent = contentFromEntities(model.entities, model.manifest.content_version);
  const act1 = sourceContent.entities.find(entity => entity.kind === 'enemy' &&
    entity.acts?.length === 1 && entity.acts[0] === 1 && entity.artifacts?.length);
  const act2 = sourceContent.entities.find(entity => entity.kind === 'enemy' &&
    entity.acts?.length === 1 && entity.acts[0] === 2);
  const act3 = sourceContent.entities.find(entity => entity.kind === 'enemy' &&
    entity.acts?.length === 1 && entity.acts[0] === 3);
  assert.ok(act1 && act2 && act3, 'expected enemies with single-act assignments in acts 1, 2, and 3');

  const multipliers = normalizeEnemyMultipliers({
    '1': { attack: 2, max_hp: 0.5 },
    '3': { defense: 1.25 },
  });
  const adjusted = scaleEnemyBaseStats(sourceContent, multipliers);
  assert.equal(adjusted.byId[act1.id].stats.attack, act1.stats.attack * 2);
  assert.equal(adjusted.byId[act1.id].stats.defense, act1.stats.defense);
  assert.equal(adjusted.byId[act1.id].stats.max_hp, act1.stats.max_hp * 0.5);
  assert.equal(adjusted.byId[act2.id].stats.attack, act2.stats.attack);
  assert.equal(adjusted.byId[act3.id].stats.defense, act3.stats.defense * 1.25);
  assert.deepEqual(adjusted.byId[act1.id].artifacts, act1.artifacts);
  for (const stack of act1.artifacts) {
    assert.deepEqual(adjusted.byId[stack.id], sourceContent.byId[stack.id]);
  }
  assert.deepEqual(sourceContent.byId[act1.id].stats, act1.stats, 'source content must stay unchanged');
});

test('same seed, methods, and strategies reproduce the same balance trial', async () => {
  const rawMultipliers = '{"1":{"attack":1.1},"4":{"max_hp":0.9}}';
  const first = await simulateMultiPolicy(1, rawMultipliers);
  const second = await simulateMultiPolicy(1, rawMultipliers);

  assert.deepEqual(first.runs, second.runs);
  assert.deepEqual(first.byStrategy, second.byStrategy);
  assert.equal(first.totalRuns, 15);
  assert.equal(first.enemyStatAdjustment.input, rawMultipliers);
  assert.equal(first.enemyStatAdjustment.multipliers['1'].attack, 1.1);
  assert.equal(first.seedPrefix, 'v2-multipolicy');
  assert.deepEqual(first.seedValues, ['v2-multipolicy-001']);
  assert.notEqual(first.contentFingerprint.sourceContent, first.contentFingerprint.simulationContent);
  assert.match(first.contentFingerprint.sourceContent, /^[a-f0-9]{64}$/);
  assert.match(first.contentFingerprint.simulationContent, /^[a-f0-9]{64}$/);
  assert.match(first.reproductionCommand, /ENEMY_MULTIPLIERS=/);
  assert.match(first.note, /not a player win rate/);
  assert.ok(first.limitations.some(item => item.includes('human-player win rates')));
});

test('configured seed prefixes create reproducible, independent seed labels', async () => {
  const first = await simulateMultiPolicy(1, undefined, 'v2-calibration-holdout');
  const second = await simulateMultiPolicy(1, undefined, 'v2-calibration-holdout');

  assert.equal(first.seedPrefix, 'v2-calibration-holdout');
  assert.deepEqual(first.seedValues, ['v2-calibration-holdout-001']);
  assert.deepEqual(first.runs, second.runs);
  assert.match(first.reproductionCommand, /SIM_SEED_PREFIX='v2-calibration-holdout'/);
  await assert.rejects(simulateMultiPolicy(1, undefined, 'bad prefix'), /SIM_SEED_PREFIX/);
});
