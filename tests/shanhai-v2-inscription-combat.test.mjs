import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadContent } from '../tools/content-kit/src/loader.mjs';

function buildModule(name) {
  const buildRoot = process.env.SHANHAI_BUILD_DIR
    ? resolve(process.env.SHANHAI_BUILD_DIR)
    : resolve(new URL('../build', import.meta.url).pathname);
  return pathToFileURL(resolve(buildRoot, 'shanhai', name)).href;
}

const [{ contentFromEntities }, { calculateStats, simulateBattle }] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
]);

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const baseContent = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const MIRROR_ID = 'RL08';
const INSCRIBED_ID = 'TEST-INSCRIPTION-ARTIFACT';
const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 20,
});
const ALL_OUTPUTS = [
  { kind: 'damage', value: 0.2 },
  { kind: 'shield', value: 0.1 },
  { kind: 'heal', value: 0.1 },
  { kind: 'rage', value: 7 },
  { kind: 'poison', value: 1 },
  { kind: 'burn', value: 1 },
];
const FRAME_KIND_BY_OUTPUT = ['damage', 'shield', 'heal', 'rage', 'status', 'status'];

function makeLoadout(method = 'RKF01', artifacts = [], overrides = {}) {
  const { talents = [], n = 4, hp, journey, ...stats } = overrides;
  return {
    name: method,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
    ...(journey === undefined ? {} : {
      journey: {
        coins: 0,
        coinsSpent: 0,
        eliteWins: 0,
        bossWins: 0,
        artifactKinds: 0,
        knownMethods: 0,
        ...journey,
      },
    }),
  };
}

function makeEnemy(overrides = {}) {
  return makeLoadout('RKF06', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function artifactTemplate(template, id, name, maxStacks = 2) {
  const artifact = structuredClone(template);
  artifact.id = id;
  artifact.name = name;
  artifact.max_stacks = maxStacks;
  artifact.unique_group = `${id.toLowerCase()}_unique`;
  artifact.equipment_role = 'support';
  artifact.attributes = { flat: {}, percent: {} };
  artifact.effects = [];
  delete artifact.core_rule;
  delete artifact.gambit_rule;
  delete artifact.awakening;
  delete artifact.mirror_rule;
  return artifact;
}

function contentWithInscribedArtifact({ outputs = ALL_OUTPUTS, trigger = 'basic' } = {}) {
  const entities = structuredClone(baseContent.entities)
    .filter(entity => entity.id !== INSCRIBED_ID);
  const artifact = artifactTemplate(
    entities.find(entity => entity.id === 'RL01'),
    INSCRIBED_ID,
    '铭刻测试法宝',
  );
  artifact.awakening = {
    at_stacks: 2,
    name: '铭刻输出',
    quick: '测试战斗输出复制。',
    trigger,
    effects: structuredClone(outputs),
  };
  entities.push(artifact);
  return contentFromEntities(entities, `${baseContent.version}-inscription-fixture`);
}

function withOpeningRage(content, amount) {
  const entities = structuredClone(content.entities);
  entities.find(entity => entity.id === 'RULES').rage.opening = amount;
  return contentFromEntities(entities, `${content.version}-opening-rage-${amount}`);
}

function framesFrom(result, source, kind) {
  return result.frames.filter(frame => frame.source === source && frame.kind === kind);
}

function statusOutputsFrom(result, source) {
  return framesFrom(result, source, 'status').filter(frame => frame.text.includes('获得'));
}

function contribution(result, id) {
  const entry = result.contributions.find(item => item.id === id);
  assert.ok(entry, `expected contribution ${id}`);
  return entry;
}

function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
}

function playerWithInscribed(inscription, overrides = {}) {
  return makeLoadout('RKF01', [
    { id: INSCRIBED_ID, stacks: 2, ...(inscription ? { inscription } : {}) },
  ], overrides);
}

test('twin duplicates each resolved awakening output once with exact artifact ownership', () => {
  const content = contentWithInscribedArtifact();
  const player = playerWithInscribed('twin', { hp: 500, speed: 100 });
  const result = simulateBattle(content, player, makeEnemy(), 'v2-inscription-twin-all', { roundLimit: 1 });
  const twinSource = `${INSCRIBED_ID}-AWAKENING-1-INSCRIPTION-TWIN`;

  for (let index = 1; index <= ALL_OUTPUTS.length; index++) {
    const kind = FRAME_KIND_BY_OUTPUT[index - 1];
    const source = `${INSCRIBED_ID}-AWAKENING-${index}`;
    const copiedSource = twinSource.replace('-1-INSCRIPTION', `-${index}-INSCRIPTION`);
    const outputFrames = kind === 'status'
      ? statusOutputsFrom(result, source)
      : framesFrom(result, source, kind);
    const copiedFrames = kind === 'status'
      ? statusOutputsFrom(result, copiedSource)
      : framesFrom(result, copiedSource, kind);
    assert.equal(outputFrames.length, 1);
    assert.equal(copiedFrames.length, 1);
  }
  const artifactDamageFrames = result.frames.filter(frame =>
    (frame.kind === 'damage' || frame.kind === 'dot') &&
    frame.source?.startsWith(`${INSCRIBED_ID}-AWAKENING-`));
  assert.equal(contribution(result, INSCRIBED_ID).damage,
    artifactDamageFrames.reduce((sum, frame) => sum + frame.amount, 0));
  assert.ok(contribution(result, INSCRIBED_ID).shield > 0);
  assert.equal(contribution(result, INSCRIBED_ID).rage, 14);
  assert.ok(contribution(result, INSCRIBED_ID).healing > 0);
  assert.equal(result.frames.filter(frame => frame.kind === 'rage' && frame.source?.endsWith('-rage-cost')).length, 0,
    'output copies do not pay rage or rerun an action');
});

test('leech converts only actual enemy HP damage to healing and does not loop', () => {
  const content = contentWithInscribedArtifact({ outputs: [{ kind: 'damage', value: 0.2 }] });
  const player = playerWithInscribed('leech', { hp: 500, speed: 100 });
  const result = simulateBattle(content, player, makeEnemy(), 'v2-inscription-leech', { roundLimit: 1 });
  const damage = framesFrom(result, `${INSCRIBED_ID}-AWAKENING-1`, 'damage');
  const healing = framesFrom(result, `${INSCRIBED_ID}-AWAKENING-1`, 'heal');

  assert.equal(damage.length, 1);
  assert.equal(healing.length, 1, 'one damage output produces one leech heal');
  assert.ok(Math.abs(healing[0].amount - damage[0].amount * 0.15) < 1e-8);
  assert.ok(Math.abs(contribution(result, INSCRIBED_ID).healing - healing[0].amount) < 1e-8);

  const shieldedEnemy = makeLoadout('RKF06', [{ id: 'RC11', stacks: 3 }], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 1,
  });
  const absorbed = simulateBattle(content, player, shieldedEnemy, 'v2-inscription-leech-shielded', { roundLimit: 1 });
  const absorbedOutput = framesFrom(absorbed, `${INSCRIBED_ID}-AWAKENING-1`, 'damage');
  assert.equal(absorbedOutput.length, 1);
  assert.equal(absorbedOutput[0].amount > 0, true);
  assert.equal(framesFrom(absorbed, `${INSCRIBED_ID}-AWAKENING-1`, 'heal').length, 0,
    'shield absorption does not count as actual HP damage for leech');
  assert.equal(contribution(absorbed, INSCRIBED_ID).healing, 0);
});

test('rage output inscriptions do not repeat the paid action or its cost', () => {
  const content = withOpeningRage(contentWithInscribedArtifact({
    outputs: [{ kind: 'rage', value: 7 }],
    trigger: 'rage',
  }), 100);
  const player = playerWithInscribed('twin', { speed: 100 });
  const result = simulateBattle(content, player, makeEnemy(), 'v2-inscription-no-action-repeat', { roundLimit: 1 });
  const source = `${INSCRIBED_ID}-AWAKENING-1`;
  const twinSource = `${source}-INSCRIPTION-TWIN`;

  assert.equal(result.frames.filter(frame => frame.kind === 'rage' && frame.source === 'RKF01-rage-cost').length, 1);
  assert.equal(framesFrom(result, source, 'rage').length, 1);
  assert.equal(framesFrom(result, twinSource, 'rage').length, 1);
});

test('swift duplicates every first-round output only and remains deterministic', () => {
  const content = contentWithInscribedArtifact({ outputs: [{ kind: 'damage', value: 0.2 }] });
  const player = playerWithInscribed('swift', { speed: 100 });
  const enemy = makeEnemy();
  const seed = 'v2-inscription-swift-round-one';
  const result = simulateBattle(content, player, enemy, seed, { roundLimit: 2 });
  const replay = simulateBattle(content, player, enemy, seed, { roundLimit: 2 });
  const source = `${INSCRIBED_ID}-AWAKENING-1`;
  const swiftSource = `${source}-INSCRIPTION-SWIFT`;
  const native = framesFrom(result, source, 'damage');
  const swift = framesFrom(result, swiftSource, 'damage');

  assert.deepEqual(replay.frames, result.frames);
  assert.equal(native.length, 2, 'native artifact trigger runs once in each round');
  assert.equal(swift.length, 1, 'swift adds one output in round one only');
  assert.equal(swift[0].round, 1);
});

test('a right neighbor twin output is mirrored once and its inscription stays with that artifact', () => {
  const content = contentWithInscribedArtifact({ outputs: [{ kind: 'damage', value: 0.2 }] });
  const player = makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
    { id: INSCRIBED_ID, stacks: 2, inscription: 'twin' },
  ], { speed: 100 });
  const result = simulateBattle(content, player, makeEnemy(), 'v2-mirror-twin-isolation', { roundLimit: 1 });
  const native = framesFrom(result, `${INSCRIBED_ID}-AWAKENING-1`, 'damage');
  const mirror = framesFrom(result, `${MIRROR_ID}-MIRROR-AWAKENING-1`, 'damage');
  const twin = framesFrom(result, `${INSCRIBED_ID}-AWAKENING-1-INSCRIPTION-TWIN`, 'damage');

  assert.equal(native.length, 1);
  assert.equal(mirror.length, 1);
  assert.equal(twin.length, 1);
  assert.equal(framesFrom(result, `${MIRROR_ID}-MIRROR-AWAKENING-1-INSCRIPTION-TWIN`, 'damage').length, 0,
    'the right artifact inscription is not inherited by RL08');
  assert.equal(contribution(result, MIRROR_ID).damage, mirror[0].amount);
  assert.equal(contribution(result, INSCRIBED_ID).damage, native[0].amount + twin[0].amount);
});

test('an inscription equipped on RL08 applies to its own mirrored output', () => {
  const content = contentWithInscribedArtifact({ outputs: [{ kind: 'damage', value: 0.2 }] });
  const player = makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1, inscription: 'twin' },
    { id: INSCRIBED_ID, stacks: 2 },
  ], { speed: 100 });
  const result = simulateBattle(content, player, makeEnemy(), 'v2-mirror-own-twin', { roundLimit: 1 });
  const mirrorSource = `${MIRROR_ID}-MIRROR-AWAKENING-1`;

  assert.equal(framesFrom(result, `${INSCRIBED_ID}-AWAKENING-1`, 'damage').length, 1);
  assert.equal(framesFrom(result, mirrorSource, 'damage').length, 1);
  assert.equal(framesFrom(result, `${mirrorSource}-INSCRIPTION-TWIN`, 'damage').length, 1);
  assert.equal(contribution(result, MIRROR_ID).damage,
    framesFrom(result, mirrorSource, 'damage')[0].amount +
    framesFrom(result, `${mirrorSource}-INSCRIPTION-TWIN`, 'damage')[0].amount);
});

test('mirror and twin preserve full RL01 overflow and RKF03 healing outlets at full and partial HP', () => {
  const content = contentWithInscribedArtifact({ outputs: [{ kind: 'heal', value: 0.1 }] });
  const player = makeLoadout('RKF03', [
    { id: MIRROR_ID, stacks: 1 },
    { id: INSCRIBED_ID, stacks: 2, inscription: 'twin' },
    { id: 'RL01', stacks: 1 },
    { id: 'RC12', stacks: 1 },
  ], { speed: 100 });
  const maxHp = calculateStats(content, player).max_hp;
  const expectedCopiedHeal = maxHp * 0.1 * 1.06;
  const baseActionHeal = maxHp * 0.06 * 1.06;
  const enemy = makeEnemy();

  for (const [label, hp, expectedEffectiveMirrorHeal] of [
    ['full', maxHp, 0],
    ['partial', maxHp - baseActionHeal - 50, 50],
  ]) {
    const result = simulateBattle(content, { ...player, hp }, enemy,
      `v2-heal-copy-${label}-overflow`, { roundLimit: 1 });
    const mirrorId = `${MIRROR_ID}-MIRROR-AWAKENING-1`;
    const sourceId = `${INSCRIBED_ID}-AWAKENING-1`;
    const twinId = `${sourceId}-INSCRIPTION-TWIN`;
    const overflowShields = result.frames.filter(frame => frame.kind === 'shield' &&
      frame.source === 'RL01-HEAL-OVERFLOW-TO-SHIELD');
    const expectedMethodHeal = baseActionHeal;
    const expectedMethodOverflow = Math.max(0, expectedMethodHeal - (maxHp - hp));
    const copyOverflowShields = overflowShields.slice(-3);

    assert.ok(overflowShields.length >= 3,
      'all three copied awakening outputs use RL01');
    close(copyOverflowShields[0].amount, expectedCopiedHeal - expectedEffectiveMirrorHeal);
    close(copyOverflowShields[1].amount, expectedCopiedHeal);
    close(copyOverflowShields[2].amount, expectedCopiedHeal);
    close(contribution(result, 'RL01').shield,
      expectedMethodOverflow + expectedCopiedHeal * 3 - expectedEffectiveMirrorHeal);

    if (expectedEffectiveMirrorHeal > 0) {
      const mirrorHeal = result.frames.find(frame => frame.kind === 'heal' && frame.source === mirrorId);
      assert.ok(mirrorHeal);
      close(mirrorHeal.amount, expectedEffectiveMirrorHeal);
    } else {
      assert.equal(result.frames.some(frame => frame.kind === 'heal' && frame.source === mirrorId), false,
        'a full-health mirror copy still runs overflow without inventing effective healing');
    }
    assert.equal(result.frames.some(frame => frame.kind === 'heal' && frame.source === sourceId), false);
    assert.equal(result.frames.some(frame => frame.kind === 'heal' && frame.source === twinId), false);
    assert.ok(result.frames.some(frame => frame.kind === 'damage' &&
      frame.source === 'RKF03-V2-RESONANCE'), 'each resolved heal amount also feeds RKF03 spring bloom');
  }
});

test('inscription works only on an equipped stack and rejects unknown values', () => {
  const content = contentWithInscribedArtifact({ outputs: [{ kind: 'damage', value: 0.2 }] });
  const unequipped = simulateBattle(content, makeLoadout('RKF01'), makeEnemy(),
    'v2-inscription-unequipped', { roundLimit: 1 });
  assert.equal(unequipped.frames.some(frame => frame.source?.startsWith(`${INSCRIBED_ID}-AWAKENING-`)), false);

  assert.throws(() => simulateBattle(content, makeLoadout('RKF01', [
    { id: INSCRIBED_ID, stacks: 2, inscription: 'unknown' },
  ]), makeEnemy(), 'v2-inscription-invalid'), /Invalid artifact inscription/);
});
