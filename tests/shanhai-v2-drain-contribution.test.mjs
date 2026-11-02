import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { simulateBattle } from '../build/shanhai/combat.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const baseContent = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const { name = method, n = 4, talents = [], hp, ...stats } = overrides;
  return {
    name,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
  };
}

function makeEnemy(artifacts = [], overrides = {}) {
  return makeLoadout('RKF06', artifacts, {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function contentWithOpening(opening, openingDrainCap = 50) {
  const entities = structuredClone(baseContent.entities);
  const rage = entities.find(entity => entity.id === 'RULES').rage;
  rage.opening = opening;
  rage.opening_drain_cap = openingDrainCap;
  return contentFromEntities(entities, `${baseContent.version}-drain-contribution`);
}

function contribution(result, id) {
  const entry = result.contributions.find(item => item.id === id);
  assert.ok(entry, `expected contribution for ${id}`);
  return entry;
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

test('rage drain contribution records only the amount remaining after resistance', () => {
  const result = simulateBattle(
    contentWithOpening(80),
    makeLoadout('RKF01', [{ id: 'RR14', stacks: 1 }], { speed: 100 }),
    makeEnemy([{ id: 'RR15', stacks: 1 }]),
    'rage-drain-contribution-resistance',
    { roundLimit: 1 },
  );

  const drain = result.frames.find(frame => frame.source === 'RULES-OPENING-DRAIN' && frame.actor === 'enemy');
  assert.equal(drain?.amount, 15);
  assert.equal(contribution(result, 'RR14').rage, -15);
});

test('rage drain contribution stays zero when the target has no rage', () => {
  const result = simulateBattle(
    contentWithOpening(0),
    makeLoadout('RKF01', [{ id: 'RR14', stacks: 1 }], { speed: 100 }),
    makeEnemy(),
    'rage-drain-contribution-empty-target',
    { roundLimit: 1 },
  );

  assert.equal(result.frames.some(frame => frame.source === 'RULES-OPENING-DRAIN'), false);
  assert.equal(contribution(result, 'RR14').rage, 0);
});

test('capped opening drain is split by request share and keeps mirrored ownership', () => {
  const entities = structuredClone(baseContent.entities);
  const rage = entities.find(entity => entity.id === 'RULES').rage;
  rage.opening = 80;
  rage.opening_drain_cap = 50;

  const extraDrain = structuredClone(entities.find(entity => entity.id === 'RR14'));
  extraDrain.id = 'TEST-OPENING-DRAIN';
  extraDrain.name = '测试开场削怒';
  extraDrain.unique_group = 'test_opening_drain';
  extraDrain.effects[0].id = 'TEST-OPENING-DRAIN-EFFECT';
  extraDrain.effects[0].params.amount = 10;
  entities.push(extraDrain);

  const content = contentFromEntities(entities, `${baseContent.version}-drain-share-mirror`);
  const result = simulateBattle(
    content,
    makeLoadout('RKF01', [
      { id: 'RL08', stacks: 1 },
      { id: 'RR14', stacks: 1 },
      { id: 'TEST-OPENING-DRAIN', stacks: 1 },
    ], { speed: 100 }),
    makeEnemy(),
    'rage-drain-contribution-share-mirror',
    { roundLimit: 1 },
  );

  const drain = result.frames.find(frame => frame.source === 'RULES-OPENING-DRAIN' && frame.actor === 'enemy');
  assert.equal(drain?.amount, 50);
  near(contribution(result, 'RR14').rage, -50 * 30 / 70);
  near(contribution(result, 'RL08').rage, -50 * 30 / 70);
  near(contribution(result, 'TEST-OPENING-DRAIN').rage, -50 * 10 / 70);
});
