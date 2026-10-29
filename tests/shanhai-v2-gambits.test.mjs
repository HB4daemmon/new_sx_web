import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadContent } from '../tools/content-kit/src/loader.mjs';

const buildRoot = process.env.SHANHAI_BUILD_DIR
  ? resolve(process.env.SHANHAI_BUILD_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../build');
const buildModule = name => pathToFileURL(resolve(buildRoot, 'shanhai', name)).href;
const [{ contentFromEntities }, { calculateStats, simulateBattle }] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
]);

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const baseContent = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 20,
  max_hp: 10_000,
  crit_rate: 0,
  speed: 30,
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

function makeEnemy(overrides = {}) {
  return makeLoadout('RKF06', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function patchContent(edit) {
  const entities = structuredClone(baseContent.entities);
  edit(entities);
  return contentFromEntities(entities, `${baseContent.version}-gambit-test`);
}

function findFrame(result, predicate, message = 'expected battle frame was not found') {
  const found = result.frames.find(predicate);
  assert.ok(found, message);
  return found;
}

function actionFrames(result, side, actionName) {
  return result.frames.filter(frame => frame.kind === 'action' && frame.actor === side &&
    frame.text.includes(actionName));
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

test('gambits change calculated defense and combat rage-cap displays symmetrically', () => {
  const overdrive = makeLoadout('RKF06', [{ id: 'RL04', stacks: 1 }]);
  const reckless = makeLoadout('RKF06', [{ id: 'RR05', stacks: 1 }]);
  const combined = makeLoadout('RKF06', [
    { id: 'RL04', stacks: 1 },
    { id: 'RR05', stacks: 1 },
  ]);

  near(calculateStats(baseContent, overdrive).defense, 13);
  near(calculateStats(baseContent, reckless).defense, 14);
  near(calculateStats(baseContent, combined).defense, 9.1);

  const mirrorContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
  });
  const mirror = simulateBattle(mirrorContent, combined, combined, 'gambit-mirror', { roundLimit: 1 });
  const start = findFrame(mirror, frame => frame.kind === 'start');
  assert.equal(start.player.rageCap, 50);
  assert.equal(start.enemy.rageCap, 50);
  const playerHit = findFrame(mirror, frame => frame.kind === 'damage' && frame.actor === 'player' &&
    frame.source === 'RKF06-RAGE-DAMAGE');
  const enemyHit = findFrame(mirror, frame => frame.kind === 'damage' && frame.actor === 'enemy' &&
    frame.source === 'RKF06-RAGE-DAMAGE');
  near(playerHit.amount, enemyHit.amount);

  const lowBaseCap = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.base_cap = 40;
  });
  const normal = simulateBattle(lowBaseCap, makeLoadout('RKF06'), makeEnemy(), 'gambit-normal-floor', { roundLimit: 1 });
  const overdriven = simulateBattle(lowBaseCap, makeLoadout('RKF06', [{ id: 'RL04', stacks: 1 }]), makeEnemy(), 'gambit-overdrive-floor', { roundLimit: 1 });
  assert.equal(findFrame(normal, frame => frame.kind === 'start').player.rageCap, 60);
  assert.equal(findFrame(overdriven, frame => frame.kind === 'start').player.rageCap, 50);
});

test('reckless multiplies only the owner\'s direct and derived damage, never DOT', () => {
  const enemy = makeEnemy();
  const plain = makeLoadout('RKF06', [{ id: 'RC09', stacks: 1 }]);
  const reckless = makeLoadout('RKF06', [
    { id: 'RC09', stacks: 1 },
    { id: 'RR05', stacks: 1 },
  ]);
  const plainResult = simulateBattle(baseContent, plain, enemy, 'gambit-damage', { roundLimit: 1 });
  const recklessResult = simulateBattle(baseContent, reckless, enemy, 'gambit-damage', { roundLimit: 1 });

  for (const source of ['RKF06-BASIC-DAMAGE', 'RC09']) {
    const before = findFrame(plainResult, frame => frame.kind === 'damage' && frame.actor === 'player' && frame.source === source);
    const after = findFrame(recklessResult, frame => frame.kind === 'damage' && frame.actor === 'player' && frame.source === source);
    near(after.amount / before.amount, 1.6);
  }
  const recklessContribution = recklessResult.contributions.find(item => item.id === 'RR05');
  assert.equal(recklessContribution?.damage ?? 0, 0,
    'the modifier does not claim damage that belongs to the actual direct/derived sources');

  const plainPoison = simulateBattle(baseContent, makeLoadout('RKF06'), enemy, 'gambit-dot', { roundLimit: 1 });
  const recklessPoison = simulateBattle(baseContent, makeLoadout('RKF06', [{ id: 'RR05', stacks: 1 }]), enemy,
    'gambit-dot', { roundLimit: 1 });
  const dotBefore = findFrame(plainPoison, frame => frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source === 'RKF06-BASIC-POISON');
  const dotAfter = findFrame(recklessPoison, frame => frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source === 'RKF06-BASIC-POISON');
  near(dotAfter.amount, dotBefore.amount);
});

test('overdrive and RL05 use the real 50-rage return for at most three rage casts', () => {
  const loadout = makeLoadout('RKF06', [
    { id: 'RL04', stacks: 1 },
    { id: 'RL05', stacks: 1 },
  ]);
  const enemy = makeEnemy();
  const result = simulateBattle(baseContent, loadout, enemy, 'gambit-three-casts', { roundLimit: 1 });
  const replay = simulateBattle(baseContent, loadout, enemy, 'gambit-three-casts', { roundLimit: 1 });
  assert.deepEqual(replay, result, 'the same seed must replay identical gambit results');

  assert.equal(actionFrames(result, 'player', '怒技').length, 3);
  assert.deepEqual(result.frames.filter(frame => frame.cue?.kind === 'rage_chain' && frame.cue.owner === 'player')
    .map(frame => frame.cue.count), [2, 3]);
  assert.equal(result.frames.some(frame => frame.cue?.kind === 'rage_chain' && frame.cue.count === 4), false);
  assert.ok(result.contributions.find(item => item.id === 'RL05')?.rage >= 150,
    'each of the three completed rage actions receives RL05\'s actual 50-rage return');
  assert.equal(result.contributions.find(item => item.id === 'RL04')?.rage ?? 0, 0,
    'opening overflow at the 50 cap is not reported as gained rage');
  assert.equal(findFrame(result, frame => frame.kind === 'start').player.rageCap, 50);

  const withoutOverdrive = makeLoadout('RKF06', [{ id: 'RL05', stacks: 1 }]);
  const baseline = simulateBattle(baseContent, withoutOverdrive, enemy, 'gambit-without-overdrive', { roundLimit: 1 });
  assert.equal(findFrame(baseline, frame => frame.kind === 'start').player.rageCap, 100);
  assert.equal(actionFrames(baseline, 'player', '怒技').length, 0);
  assert.equal(baseline.frames.some(frame => frame.cue?.kind === 'rage_chain'), false);

  const rr07 = makeLoadout('RKF06', [
    { id: 'RL04', stacks: 1 },
    { id: 'RL05', stacks: 1 },
    { id: 'RR07', stacks: 1 },
  ]);
  const withRr07 = simulateBattle(baseContent, rr07, enemy, 'gambit-rr07', { roundLimit: 1 });
  assert.equal(actionFrames(withRr07, 'player', '怒技').length, 3);
  assert.ok(withRr07.frames.every(frame => frame.player.rageCap === undefined || frame.player.rageCap === 50));
  assert.equal(withRr07.frames.some(frame => frame.source === 'RR07-FIRST-RAGE-CAP-REDUCTION' &&
    frame.text.includes('怒气上限调整')), false,
  'RR07 cannot move the fixed 50 cap upward or downward');
});

test('rage-chain lethal interruption stops follow-up casts and absent gambits stay absent', () => {
  const loadout = makeLoadout('RKF06', [
    { id: 'RL04', stacks: 1 },
    { id: 'RL05', stacks: 1 },
  ], { attack: 1000 });
  const lethal = simulateBattle(baseContent, loadout, makeEnemy({ max_hp: 1 }),
    'gambit-lethal-interruption', { roundLimit: 1 });
  assert.equal(actionFrames(lethal, 'player', '怒技').length, 1);
  assert.equal(lethal.frames.some(frame => frame.cue?.kind === 'rage_chain' && frame.cue.owner === 'player'), false);

  const absent = makeLoadout('RKF06');
  near(calculateStats(baseContent, absent).defense, BASE_STATS.defense);
  const noGambit = simulateBattle(baseContent, absent, makeEnemy(), 'gambit-absent', { roundLimit: 1 });
  assert.equal(findFrame(noGambit, frame => frame.kind === 'start').player.rageCap, 100);
});

test('runtime rejects missing, unknown, unsupported, and duplicate gambit rules', () => {
  const loadout = makeLoadout('RKF06', [{ id: 'RL04', stacks: 1 }]);
  const missing = patchContent(entities => {
    delete entities.find(item => item.id === 'RL04').gambit_rule;
  });
  assert.throws(() => calculateStats(missing, loadout), /gambit_rule/);

  const unknownParam = patchContent(entities => {
    entities.find(item => item.id === 'RL04').gambit_rule.hidden_bonus = 1;
  });
  assert.throws(() => calculateStats(unknownParam, loadout), /Unknown or missing gambit_rule parameter/);

  const unsupportedKind = patchContent(entities => {
    entities.find(item => item.id === 'RR05').gambit_rule.kind = 'unrestricted';
  });
  assert.throws(() => calculateStats(unsupportedKind, loadout), /Unsupported gambit_rule kind/);

  const unsupportedOwner = patchContent(entities => {
    entities.find(item => item.id === 'RC01').gambit_rule = { kind: 'overdrive', rage_cap: 50, defense_multiplier: 0.65 };
  });
  assert.throws(() => calculateStats(unsupportedOwner, loadout), /Unsupported gambit_rule owner/);

  const duplicateArtifact = makeLoadout('RKF06', [
    { id: 'RL04', stacks: 1 },
    { id: 'RL04', stacks: 1 },
  ]);
  assert.throws(() => calculateStats(baseContent, duplicateArtifact), /Duplicate gambit_rule kind|Duplicate artifact ID/);

  const duplicateRule = structuredClone(baseContent);
  duplicateRule.entities.push(structuredClone(duplicateRule.byId.RL04));
  assert.throws(() => calculateStats(duplicateRule, loadout), /Duplicate gambit_rule kind/);
});
