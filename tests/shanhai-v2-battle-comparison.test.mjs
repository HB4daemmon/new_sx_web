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

const [{ contentFromEntities }, { simulateBattle }, { compareArtifactRemoval }] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
  import(buildModule('battle-comparison.js')),
]);

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const baseContent = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const FILLER_ID = 'TEST-COMPARISON-FILLER';
const NEIGHBOR_ID = 'TEST-COMPARISON-NEIGHBOR';
const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 100,
});

function artifactTemplate(id, name, maxStacks, { maxHp = 0, awakening } = {}) {
  const template = baseContent.entities.find(entity => entity.id === 'RL01');
  assert.ok(template, 'fixture needs an artifact template');
  const artifact = structuredClone(template);
  artifact.id = id;
  artifact.name = name;
  artifact.max_stacks = maxStacks;
  artifact.unique_group = `${id.toLowerCase()}_unique`;
  artifact.equipment_role = 'support';
  artifact.attributes = { flat: { max_hp: maxHp }, percent: {} };
  artifact.effects = [];
  delete artifact.core_rule;
  delete artifact.gambit_rule;
  delete artifact.awakening;
  delete artifact.mirror_rule;
  if (awakening) artifact.awakening = structuredClone(awakening);
  return artifact;
}

function comparisonContent() {
  const filler = artifactTemplate(FILLER_ID, '次序测试法宝', 2, { maxHp: 100 });
  const neighbor = artifactTemplate(NEIGHBOR_ID, '铭刻测试法宝', 2, {
    awakening: {
      at_stacks: 2,
      name: '邻位测试觉醒',
      quick: '用于验证镜位与铭刻的单场对照。',
      trigger: 'basic',
      effects: [{ kind: 'damage', value: 0.2 }],
    },
  });
  return contentFromEntities(
    [...structuredClone(baseContent.entities), filler, neighbor],
    `${baseContent.version}-battle-comparison-fixture`,
  );
}

function makeLoadout(method, artifacts, overrides = {}) {
  const { hp, ...stats } = overrides;
  return {
    name: method,
    method,
    n: 4,
    talents: [],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
  };
}

function makeInput(artifacts, overrides = {}) {
  const rules = Object.hasOwn(overrides, 'rules') ? overrides.rules : 'awakening-v1';
  const { seed = 'same-seed-artifact-comparison', roundLimit = 1 } = overrides;
  return {
    player: makeLoadout('RKF01', artifacts, { hp: 1_300 }),
    enemy: makeLoadout('RKF06', [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000,
      crit_rate: 0,
      speed: 1,
    }),
    seed,
    roundLimit,
    ...(rules === undefined ? {} : { rules }),
  };
}

test('same-seed replay is stable, preserves the frozen input, and clamps starting HP after removal', () => {
  const content = comparisonContent();
  const input = makeInput([
    { id: 'RL08', stacks: 1 },
    { id: FILLER_ID, stacks: 2, inscription: 'leech' },
    { id: NEIGHBOR_ID, stacks: 2, inscription: 'twin' },
  ]);
  const beforeContent = structuredClone(content.entities);
  const beforeInput = structuredClone(input);

  const comparison = compareArtifactRemoval(content, input, FILLER_ID);
  const replay = compareArtifactRemoval(content, input, FILLER_ID);

  assert.deepEqual(replay, comparison);
  assert.deepEqual(content.entities, beforeContent, 'comparison must leave content untouched');
  assert.deepEqual(input, beforeInput, 'comparison must leave battle input untouched');
  assert.equal(comparison.scope, 'same_seed_single_battle_counterfactual');
  assert.match(comparison.interpretation, /不代表跨种子的统计净收益/);
  assert.match(comparison.healthDifferenceMeaning, /不是伤害占比/);
  assert.equal(comparison.roundLimit, input.roundLimit);
  assert.equal(comparison.rules, 'awakening-v1');
  assert.deepEqual(comparison.removedArtifact, { id: FILLER_ID, stacks: 2 });
  assert.equal(comparison.original.rounds, 1);
  assert.equal(comparison.withoutArtifact.rounds, 1);
  assert.equal(comparison.original.player.startingHp, comparison.original.player.maxHp);
  assert.equal(comparison.withoutArtifact.player.startingHp, comparison.withoutArtifact.player.maxHp);
  assert.ok(comparison.original.player.maxHp > comparison.withoutArtifact.player.maxHp,
    'removing max-HP equipment reduces the pre-battle HP cap');
  assert.ok(comparison.withoutArtifact.enemy.remainingHp < comparison.original.enemy.remainingHp,
    'removing the middle slot makes RL08 adjacent to the inscribed awakened artifact');
  assert.equal('frames' in comparison.original, false);
  assert.equal('contributions' in comparison.original, false);
});

test('removing RL08 or its inscribed right neighbor removes that full equipped stack', () => {
  const content = comparisonContent();
  const input = makeInput([
    { id: 'RL08', stacks: 1, inscription: 'twin' },
    { id: NEIGHBOR_ID, stacks: 2, inscription: 'twin' },
  ]);

  const withoutMirror = compareArtifactRemoval(content, input, 'RL08');
  const withoutInscribedArtifact = compareArtifactRemoval(content, input, NEIGHBOR_ID);

  assert.deepEqual(withoutMirror.removedArtifact, { id: 'RL08', stacks: 1 });
  assert.ok(withoutMirror.original.enemy.remainingHp < withoutMirror.withoutArtifact.enemy.remainingHp,
    'the mirror copies the adjacent neighbor output before it is removed');
  assert.deepEqual(withoutInscribedArtifact.removedArtifact, { id: NEIGHBOR_ID, stacks: 2 });
  assert.ok(withoutInscribedArtifact.original.enemy.remainingHp <
    withoutInscribedArtifact.withoutArtifact.enemy.remainingHp,
  'removing an inscribed multi-stack artifact removes its native and mirrored outputs');
});

test('frozen rules disable awakenings unless awakening-v1 was explicitly recorded', () => {
  const content = comparisonContent();
  const input = makeInput([{ id: NEIGHBOR_ID, stacks: 2 }], { rules: undefined });
  const comparison = compareArtifactRemoval(content, input, NEIGHBOR_ID);
  const direct = simulateBattle(content, input.player, input.enemy, input.seed, {
    roundLimit: input.roundLimit,
    artifactAwakenings: false,
  });
  const emptyPlayer = { ...input.player, artifacts: [] };
  const directWithoutArtifact = simulateBattle(content, emptyPlayer, input.enemy, input.seed, {
    roundLimit: input.roundLimit,
    artifactAwakenings: false,
  });

  assert.equal(comparison.rules, null);
  assert.equal(comparison.original.enemy.remainingHp, direct.enemyHp);
  assert.equal(comparison.withoutArtifact.enemy.remainingHp, directWithoutArtifact.enemyHp);
});

test('rejects an unequipped or unknown artifact and malformed frozen battle inputs', () => {
  const content = comparisonContent();
  const input = makeInput([{ id: NEIGHBOR_ID, stacks: 2 }]);

  assert.throws(() => compareArtifactRemoval(content, input, 'NOT-AN-ARTIFACT'), /Unknown Shanhai artifact ID/);
  assert.throws(() => compareArtifactRemoval(content, input, 'RL08'), /not equipped in this battle/);
  assert.throws(() => compareArtifactRemoval(content, input, ''), /artifactId must be a non-empty string/);
  assert.throws(() => compareArtifactRemoval(content, { ...input, roundLimit: 0 }, NEIGHBOR_ID), /roundLimit/);
  assert.throws(() => compareArtifactRemoval(content, { ...input, rules: 'unknown' }, NEIGHBOR_ID), /unsupported rules/);
  assert.throws(() => compareArtifactRemoval(content, { ...input, player: { ...input.player, hp: Infinity } }, NEIGHBOR_ID), /hp must be finite/);
});
