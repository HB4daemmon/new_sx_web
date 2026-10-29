import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadContent } from '../tools/content-kit/src/loader.mjs';

const buildRoot = process.env.SHANHAI_BUILD_DIR
  ? resolve(process.env.SHANHAI_BUILD_DIR)
  : resolve(new URL('../build', import.meta.url).pathname);
function buildModule(name) {
  return pathToFileURL(resolve(buildRoot, 'shanhai', name)).href;
}

const [
  { contentFromEntities },
  { calculateStats, simulateBattle },
  { MAX_EQUIPMENT_SLOTS },
] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
  import(buildModule('equipment.js')),
]);

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const {
    name = method,
    n = 4,
    talents = [],
    hp,
    ...stats
  } = overrides;
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

function enemy(overrides = {}) {
  const { method = 'RKF06', artifacts = [], ...stats } = overrides;
  return makeLoadout(method, artifacts, {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
    ...stats,
  });
}

function patchContent(edit) {
  const entities = structuredClone(content.entities);
  edit(entities);
  return contentFromEntities(entities, `${content.version}-five-slot-test`);
}

function contribution(result, id) {
  const found = result.contributions.find(item => item.id === id);
  assert.ok(found, `expected contribution ${id}`);
  return found;
}

function awakeningResolutionOrder(result) {
  return result.frames
    .filter(frame => frame.round === 1 && frame.actor === 'player' && (
      (frame.kind === 'damage' && frame.source === 'RC01-AWAKENING-1') ||
      (frame.kind === 'status' && frame.source === 'RC08-AWAKENING-1' &&
        frame.amount > 0 && frame.enemy.statuses.poison > 0)
    ))
    .map(frame => frame.source.startsWith('RC01-') ? 'RC01' : 'RC08');
}

function actualAwakeningLoadout(ids) {
  return ids.map(id => {
    const artifact = content.byId[id];
    assert.equal(artifact.kind, 'artifact');
    assert.equal(artifact.awakening.at_stacks, artifact.max_stacks,
      `${id} awakening should require its actual maximum stack count`);
    return { id, stacks: artifact.max_stacks };
  });
}

test('combat accepts five artifact slots on either side and rejects a sixth', () => {
  assert.equal(MAX_EQUIPMENT_SLOTS, 5);
  const artifactIds = ['RC01', 'RC02', 'RC03', 'RC04', 'RC05', 'RC06'];
  const fiveArtifacts = artifactIds.slice(0, MAX_EQUIPMENT_SLOTS)
    .map(id => ({ id, stacks: 1 }));
  const sixArtifacts = artifactIds.slice(0, MAX_EQUIPMENT_SLOTS + 1)
    .map(id => ({ id, stacks: 1 }));

  const bothSidesFive = simulateBattle(
    content,
    makeLoadout('RKF01', fiveArtifacts),
    enemy({ artifacts: fiveArtifacts }),
    'v2-five-slots-both-sides',
    { roundLimit: 1 },
  );
  assert.ok(bothSidesFive.frames.some(frame => frame.kind === 'action' && frame.actor === 'player'));
  assert.ok(bothSidesFive.frames.some(frame => frame.kind === 'action' && frame.actor === 'enemy'));

  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF01', sixArtifacts),
    enemy(),
    'v2-six-player-slots',
    { roundLimit: 1 },
  ), /Loadout exceeds 5 artifact slots/);
  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF01'),
    enemy({ artifacts: sixArtifacts }),
    'v2-six-enemy-slots',
    { roundLimit: 1 },
  ), /Loadout exceeds 5 artifact slots/);
});

test('five-slot validation still rejects duplicate artifacts and invalid stacks', () => {
  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF01', [{ id: 'RC01', stacks: 1 }, { id: 'RC01', stacks: 1 }]),
    enemy(),
    'v2-five-slot-duplicate-artifact',
    { roundLimit: 1 },
  ), /Duplicate artifact ID RC01/);
  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF01', [{ id: 'RC01', stacks: 0 }]),
    enemy(),
    'v2-five-slot-zero-stack',
    { roundLimit: 1 },
  ), /Invalid artifact stack/);
  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF01', [{ id: 'RC01', stacks: content.byId.RC01.max_stacks + 1 }]),
    enemy(),
    'v2-five-slot-over-max-stack',
    { roundLimit: 1 },
  ), /exceeds max stacks/);
});

test('same-trigger max-stack awakenings resolve in equipped order with attributed bounded outputs', () => {
  const orderedArtifacts = actualAwakeningLoadout(['RC01', 'RC08']);
  const reversedArtifacts = [...orderedArtifacts].reverse();
  const player = makeLoadout('RKF01', orderedArtifacts);
  const reversedPlayer = makeLoadout('RKF01', reversedArtifacts);
  const opponent = enemy({ method: 'RKF01' });
  const seed = 'v2-five-slot-awakening-order';

  const ordered = simulateBattle(content, player, opponent, seed, { roundLimit: 1 });
  const orderedReplay = simulateBattle(content, player, opponent, seed, { roundLimit: 1 });
  const reversed = simulateBattle(content, reversedPlayer, opponent, seed, { roundLimit: 1 });
  const reversedReplay = simulateBattle(content, reversedPlayer, opponent, seed, { roundLimit: 1 });

  assert.deepEqual(orderedReplay.frames, ordered.frames);
  assert.deepEqual(reversedReplay.frames, reversed.frames);
  assert.deepEqual(awakeningResolutionOrder(ordered), ['RC01', 'RC08']);
  assert.deepEqual(awakeningResolutionOrder(reversed), ['RC08', 'RC01']);

  const awakeningDamage = ordered.frames.filter(frame =>
    frame.kind === 'damage' && frame.source === 'RC01-AWAKENING-1');
  const poisonApplications = ordered.frames.filter(frame =>
    frame.kind === 'status' && frame.source === 'RC08-AWAKENING-1' &&
    frame.amount > 0 && frame.enemy.statuses.poison > 0);
  assert.equal(awakeningDamage.length, 1);
  assert.equal(awakeningDamage[0].actor, 'player');
  assert.equal(awakeningDamage[0].target, 'enemy');
  assert.equal(poisonApplications.length, 1);
  assert.equal(poisonApplications[0].amount, 1);
  assert.equal(poisonApplications[0].enemy.statuses.poison, 1);

  const attack = calculateStats(content, player).attack;
  assert.ok(Math.abs(awakeningDamage[0].amount - attack * 0.18) < 1e-8);
  assert.equal(contribution(ordered, 'RC01').damage, awakeningDamage[0].amount);
  assert.ok(contribution(ordered, 'RC08').triggers > 0);
});

test('lethal awakening stops later equipped awakenings and poison ticks', () => {
  const noConvergence = patchContent(entities => {
    delete entities.find(item => item.id === 'RC01').core_rule;
  });
  const ordered = actualAwakeningLoadout(['RC01', 'RC08']);
  const reverse = [...ordered].reverse();
  const lethalEnemy = enemy({ method: 'RKF01', hp: 120 });

  const firstLethal = simulateBattle(
    noConvergence,
    makeLoadout('RKF01', ordered),
    lethalEnemy,
    'v2-five-slot-awakening-lethal-first',
    { roundLimit: 1 },
  );
  assert.equal(firstLethal.outcome, 'player');
  assert.equal(firstLethal.enemyHp, 0);
  assert.equal(firstLethal.frames.filter(frame =>
    frame.kind === 'damage' && frame.source === 'RC01-AWAKENING-1').length, 1);
  assert.equal(firstLethal.frames.some(frame => frame.source === 'RC08-AWAKENING-1'), false,
    'the next equipped awakening cannot run after the earlier awakening kills the target');
  assert.equal(firstLethal.frames.some(frame => frame.kind === 'dot' &&
    frame.source === 'RC08-AWAKENING-1'), false);

  const secondLethal = simulateBattle(
    noConvergence,
    makeLoadout('RKF01', reverse),
    lethalEnemy,
    'v2-five-slot-awakening-lethal-reverse',
    { roundLimit: 1 },
  );
  assert.equal(secondLethal.outcome, 'player');
  assert.equal(secondLethal.enemyHp, 0);
  assert.deepEqual(awakeningResolutionOrder(secondLethal), ['RC08', 'RC01']);
  assert.equal(secondLethal.frames.some(frame => frame.kind === 'dot' &&
    frame.source === 'RC08-AWAKENING-1'), false,
  'poison applied before the lethal awakening cannot tick after combat ends');
});
