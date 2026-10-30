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
const NEIGHBOR_ID = 'TEST-MIRROR-NEIGHBOR';
const OUTPUTS = [
  { kind: 'damage', value: 0.2 },
  { kind: 'shield', value: 0.1 },
  { kind: 'heal', value: 0.1 },
  { kind: 'rage', value: 7 },
  { kind: 'poison', value: 1 },
  { kind: 'burn', value: 1 },
];
const FRAME_KIND_BY_OUTPUT = ['damage', 'shield', 'heal', 'rage', 'status', 'status'];

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 20,
});

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
        ...structuredClone(journey),
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

function cleanArtifact(template, id, name, maxStacks = 1) {
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

function contentWithMirror({ trigger = 'basic', outputs = OUTPUTS, neighborStacks = 2 } = {}) {
  const entities = structuredClone(baseContent.entities);
  const template = entities.find(entity => entity.id === 'RL01');
  assert.ok(template, 'fixture needs an artifact template');
  const filtered = entities.filter(entity => entity.id !== MIRROR_ID);
  const mirror = cleanArtifact(template, MIRROR_ID, '照影镜');
  mirror.mirror_rule = { kind: 'neighbor_awakening' };
  const neighbor = cleanArtifact(template, NEIGHBOR_ID, '镜右法宝', 2);
  neighbor.max_stacks = 2;
  neighbor.awakening = {
    at_stacks: 2,
    name: '邻位六效觉醒',
    quick: '测试用出手型觉醒。',
    trigger,
    effects: structuredClone(outputs),
  };
  const content = contentFromEntities([...filtered, mirror, neighbor], `${baseContent.version}-mirror-fixture`);
  return { content, mirror, neighbor, neighborStacks };
}

function contentWithRightNeighborResonance() {
  const entities = structuredClone(baseContent.entities);
  const mirror = entities.find(entity => entity.id === MIRROR_ID);
  const neighbor = entities.find(entity => entity.id === 'RR04');
  assert.ok(mirror && neighbor, 'fixture needs the real mirror and RR04');
  neighbor.max_stacks = 3;
  return contentFromEntities(entities, `${baseContent.version}-mirror-resonance-fixture`);
}

function contentPatch(edit) {
  const entities = structuredClone(baseContent.entities);
  edit(entities);
  return contentFromEntities(entities, `${baseContent.version}-mirror-invalid-fixture`);
}

function withoutMirrorOwner(entities) {
  for (let index = entities.length - 1; index >= 0; index--) {
    if (entities[index].id === MIRROR_ID) entities.splice(index, 1);
  }
}

function withOpeningRage(content, amount) {
  const entities = structuredClone(content.entities);
  entities.find(entity => entity.id === 'RULES').rage.opening = amount;
  return contentFromEntities(entities, `${content.version}-rage-${amount}`);
}

function outputFrames(result, source, kind) {
  return result.frames.filter(frame => frame.source === source && frame.kind === kind);
}

function awakeningFrame(result, source, kind) {
  const frame = outputFrames(result, source, kind)[0];
  assert.ok(frame, `expected ${kind} output from ${source}`);
  return frame;
}

function appliedStatusFrame(result, source, side, status) {
  const frame = result.frames.find(candidate => candidate.source === source && candidate.kind === 'status' &&
    candidate[side].statuses[status] > 0);
  assert.ok(frame, `expected ${status} status from ${source}`);
  return frame;
}

function contribution(result, id) {
  const entry = result.contributions.find(item => item.id === id);
  assert.ok(entry, `expected contribution ${id}`);
  return entry;
}

function playerWithMirrorAndNeighbor(stacks = 2, speed = BASE_STATS.speed) {
  return makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
    { id: NEIGHBOR_ID, stacks },
  ], { speed, hp: 500 });
}

function mirrorSource(index) {
  return `${MIRROR_ID}-MIRROR-AWAKENING-${index}`;
}

function neighborSource(index) {
  return `${NEIGHBOR_ID}-AWAKENING-${index}`;
}

test('the real Kunlun mirror repeats the real full-stack Qingfeng awakening', () => {
  const player = makeLoadout('RKF01', [
    { id: 'RL08', stacks: 1 },
    { id: 'RC01', stacks: 5 },
  ]);
  const result = simulateBattle(baseContent, player, makeEnemy(), 'v2-real-mirror-qingfeng', { roundLimit: 1 });
  const hits = result.frames.filter(frame => frame.kind === 'damage' &&
    ['RL08-MIRROR-AWAKENING-1', 'RC01-AWAKENING-1'].includes(frame.source));
  assert.deepEqual(hits.map(frame => frame.source), ['RL08-MIRROR-AWAKENING-1', 'RC01-AWAKENING-1']);
  assert.ok(contribution(result, 'RL08').damage > 0);
  assert.ok(contribution(result, 'RC01').damage > 0);
});

test('right neighbor outputs mirror once in order and all contribution belongs to RL08', () => {
  const { content } = contentWithMirror();
  const player = playerWithMirrorAndNeighbor();
  const enemy = makeEnemy();
  const seed = 'v2-mirror-right-neighbor-all-outputs';
  const result = simulateBattle(content, player, enemy, seed, { roundLimit: 1 });
  const replay = simulateBattle(content, player, enemy, seed, { roundLimit: 1 });

  assert.deepEqual(replay.frames, result.frames, 'same-seed mirror playback must be frame-stable');
  for (let index = 1; index <= OUTPUTS.length; index++) {
    const mirrorOutput = awakeningFrame(result, mirrorSource(index), FRAME_KIND_BY_OUTPUT[index - 1]);
    const nativeOutput = awakeningFrame(result, neighborSource(index), FRAME_KIND_BY_OUTPUT[index - 1]);
    assert.equal(mirrorOutput.actor, 'player');
    assert.equal(nativeOutput.actor, 'player');
  }
  assert.match(awakeningFrame(result, mirrorSource(1), 'status').text, /昆仑镜镜映/);
  assert.equal(outputFrames(result, mirrorSource(1), 'damage').length, 1);
  assert.equal(outputFrames(result, neighborSource(1), 'damage').length, 1);
  assert.deepEqual(result.frames.filter(frame => frame.kind === 'damage' &&
    [mirrorSource(1), neighborSource(1)].includes(frame.source)).map(frame => frame.source),
  [mirrorSource(1), neighborSource(1)], 'the mirror resolves before the right neighbor output');
  for (const [index, kind] of [
    [2, 'shield'],
    [3, 'heal'],
    [4, 'rage'],
  ]) {
    const mirrorFrame = outputFrames(result, mirrorSource(index), kind)[0];
    const neighborFrame = outputFrames(result, neighborSource(index), kind)[0];
    assert.ok(mirrorFrame && neighborFrame);
    assert.ok(result.frames.indexOf(mirrorFrame) < result.frames.indexOf(neighborFrame),
      `${kind} mirror must resolve before its right neighbor`);
  }
  const mirrorPoisonIndex = result.frames.indexOf(appliedStatusFrame(result, mirrorSource(5), 'enemy', 'poison'));
  const neighborPoisonIndex = result.frames.findIndex(frame => frame.source === neighborSource(5) &&
    frame.kind === 'status' && frame.text.includes('获得poison'));
  assert.ok(mirrorPoisonIndex >= 0 && neighborPoisonIndex >= 0 && mirrorPoisonIndex < neighborPoisonIndex,
    'status mirrors resolve before their right neighbor');
  assert.equal(outputFrames(result, mirrorSource(2), 'shield').length, 1);
  assert.equal(outputFrames(result, neighborSource(2), 'shield').length, 1);
  assert.equal(outputFrames(result, mirrorSource(3), 'heal').length, 1);
  assert.equal(outputFrames(result, neighborSource(3), 'heal').length, 1);
  assert.equal(outputFrames(result, mirrorSource(4), 'rage').length, 1);
  assert.equal(outputFrames(result, neighborSource(4), 'rage').length, 1);

  const mirroredPoison = appliedStatusFrame(result, mirrorSource(5), 'enemy', 'poison');
  const mirroredBurn = appliedStatusFrame(result, mirrorSource(6), 'enemy', 'burn');
  assert.ok(mirroredPoison.enemy.statuses.poison > 0);
  assert.ok(mirroredBurn.enemy.statuses.burn > 0);
  assert.equal(contribution(result, MIRROR_ID).rage, 7);
  assert.ok(contribution(result, MIRROR_ID).damage > 0);
  assert.ok(contribution(result, MIRROR_ID).shield > 0);
  assert.ok(contribution(result, MIRROR_ID).healing > 0);
  assert.ok(contribution(result, NEIGHBOR_ID).damage > 0);
  assert.ok(contribution(result, NEIGHBOR_ID).healing > 0);
});

test('mirror copies non-awakening RR04 hits from a right neighbor below its stack cap', () => {
  const content = contentWithRightNeighborResonance();
  const player = makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
    { id: 'RR04', stacks: 1 },
  ], { journey: { coins: 200 }, speed: 100 });
  const result = simulateBattle(content, player, makeEnemy(), 'v2-mirror-real-rr04', { roundLimit: 1 });
  const native = outputFrames(result, 'RR04-V2-RESONANCE', 'damage');
  const mirrored = outputFrames(result, 'RL08-MIRROR-RR04-V2-RESONANCE', 'damage');

  assert.equal(content.byId.RR04.max_stacks, 3);
  assert.equal(player.artifacts[1].stacks, 1, 'the right neighbor is not at its stack cap');
  assert.equal(native.length, 3, 'RR04 still resolves its real resonance output');
  assert.equal(mirrored.length, native.length, 'RL08 copies every RR04 hit output once');
  assert.ok(contribution(result, MIRROR_ID).damage > 0);
  assert.ok(contribution(result, 'RR04').damage > 0);
});

test('mirror only reads the adjacent right slot and never mirrors at the end or backwards', () => {
  const { content } = contentWithMirror({ outputs: [{ kind: 'damage', value: 0.2 }] });
  const enemy = makeEnemy();

  const right = simulateBattle(content, playerWithMirrorAndNeighbor(), enemy,
    'v2-mirror-right-direction', { roundLimit: 1 });
  assert.equal(outputFrames(right, mirrorSource(1), 'damage').length, 1);
  assert.equal(outputFrames(right, neighborSource(1), 'damage').length, 1);

  const neighborAloneAtMirrorEnd = simulateBattle(content, makeLoadout('RKF01', [
    { id: NEIGHBOR_ID, stacks: 2 },
    { id: MIRROR_ID, stacks: 1 },
  ]), enemy, 'v2-mirror-no-left-copy', { roundLimit: 1 });
  assert.equal(outputFrames(neighborAloneAtMirrorEnd, mirrorSource(1), 'damage').length, 0);
  assert.equal(outputFrames(neighborAloneAtMirrorEnd, neighborSource(1), 'damage').length, 1);

  const mirrorAtEnd = simulateBattle(content, makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
  ]), enemy, 'v2-mirror-empty-right-edge', { roundLimit: 1 });
  assert.equal(outputFrames(mirrorAtEnd, mirrorSource(1), 'damage').length, 0);

  const separated = simulateBattle(content, makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
    { id: 'RL01', stacks: 1 },
    { id: NEIGHBOR_ID, stacks: 2 },
  ]), enemy, 'v2-mirror-not-through-gap', { roundLimit: 1 });
  assert.equal(outputFrames(separated, mirrorSource(1), 'damage').length, 0);
  assert.equal(outputFrames(separated, neighborSource(1), 'damage').length, 1);
});

test('mirror requires the neighbor awakening to be full and to match basic or rage', () => {
  const { content } = contentWithMirror({ outputs: [{ kind: 'damage', value: 0.2 }] });
  const enemy = makeEnemy();
  const notFull = simulateBattle(content, playerWithMirrorAndNeighbor(1), enemy,
    'v2-mirror-neighbor-not-full', { roundLimit: 1 });
  assert.equal(outputFrames(notFull, mirrorSource(1), 'damage').length, 0);
  assert.equal(outputFrames(notFull, neighborSource(1), 'damage').length, 0);

  const basic = simulateBattle(withOpeningRage(content, 0), playerWithMirrorAndNeighbor(), enemy,
    'v2-mirror-basic-trigger', { roundLimit: 1 });
  assert.equal(outputFrames(basic, mirrorSource(1), 'damage').length, 1);
  assert.equal(outputFrames(basic, neighborSource(1), 'damage').length, 1);

  const basicDoesNotCopyOnRage = simulateBattle(withOpeningRage(content, 100), playerWithMirrorAndNeighbor(), enemy,
    'v2-mirror-basic-trigger-on-rage', { roundLimit: 1 });
  assert.equal(outputFrames(basicDoesNotCopyOnRage, mirrorSource(1), 'damage').length, 0);
  assert.equal(outputFrames(basicDoesNotCopyOnRage, neighborSource(1), 'damage').length, 0);

  const rageContent = contentWithMirror({
    trigger: 'rage',
    outputs: [{ kind: 'damage', value: 0.2 }],
  }).content;
  const rageDoesNotCopyOnBasic = simulateBattle(withOpeningRage(rageContent, 0), playerWithMirrorAndNeighbor(), enemy,
    'v2-mirror-rage-trigger-on-basic', { roundLimit: 1 });
  assert.equal(outputFrames(rageDoesNotCopyOnBasic, mirrorSource(1), 'damage').length, 0);
  assert.equal(outputFrames(rageDoesNotCopyOnBasic, neighborSource(1), 'damage').length, 0);

  const rage = simulateBattle(withOpeningRage(rageContent, 100), playerWithMirrorAndNeighbor(), enemy,
    'v2-mirror-rage-trigger', { roundLimit: 1 });
  assert.equal(outputFrames(rage, mirrorSource(1), 'damage').length, 1);
  assert.equal(outputFrames(rage, neighborSource(1), 'damage').length, 1);
});

test('mirror copies RL04 opening rage as a source-attributed battle-start output', () => {
  const content = withOpeningRage(baseContent, 0);
  const player = makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
    { id: 'RL04', stacks: 1 },
  ]);
  const result = simulateBattle(content, player, makeEnemy(), 'v2-mirror-rl04-opening-rage', { roundLimit: 1 });
  const mirroredRage = awakeningFrame(result, `${MIRROR_ID}-MIRROR-RL04-OPENING-RAGE-GAIN`, 'rage');

  assert.equal(mirroredRage.amount, 50);
  assert.equal(contribution(result, MIRROR_ID).rage, 50);
});

test('mirrored RC14 poison creates two independent layers whose ticks are not copied again', () => {
  const content = withOpeningRage(baseContent, 0);
  const player = makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
    { id: 'RC14', stacks: 3 },
  ], { speed: 100 });
  const result = simulateBattle(content, player, makeEnemy(), 'v2-mirror-rc14-dot-once', { roundLimit: 3 });
  const originalTicks = result.frames.filter(frame => frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source === 'RC14');
  const mirroredTicks = result.frames.filter(frame => frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source?.startsWith(`${MIRROR_ID}-MIRROR-RC14`));
  const applications = source => result.frames.filter(frame => frame.kind === 'status' &&
    frame.source === source && frame.text.includes('获得poison'));

  assert.deepEqual(originalTicks.reduce((counts, frame) => {
    counts[frame.round - 1] += 1;
    return counts;
  }, [0, 0, 0]), [1, 2, 3]);
  assert.deepEqual(mirroredTicks.reduce((counts, frame) => {
    counts[frame.round - 1] += 1;
    return counts;
  }, [0, 0, 0]), [1, 2, 3]);
  assert.equal(applications('RC14').length, 3);
  assert.equal(applications(`${MIRROR_ID}-MIRROR-RC14`).length, 3,
    'each RC14 poison application receives exactly one mirror layer');

  const ordinaryBurn = simulateBattle(content, makeLoadout('RKF04'), makeEnemy(),
    'v2-ordinary-dot-still-ticks-once', { roundLimit: 3 });
  const ordinaryTicks = ordinaryBurn.frames.filter(frame => frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source === 'RKF04-BASIC-BURN');
  assert.deepEqual(ordinaryTicks.reduce((counts, frame) => {
    counts[frame.round - 1] += 1;
    return counts;
  }, [0, 0, 0]), [1, 2, 3], 'ordinary unmirrored DOT layers retain their normal tick count');
});

test('mirror resolution is symmetric when the enemy owns the mirror', () => {
  const { content } = contentWithMirror();
  const enemy = makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
    { id: NEIGHBOR_ID, stacks: 2 },
  ], { speed: 100, hp: 500 });
  const player = makeLoadout('RKF01', [], { speed: 1, attack: 0, max_hp: 1_000_000 });
  const result = simulateBattle(content, player, enemy, 'v2-mirror-enemy-owner', { roundLimit: 1 });

  const mirrorDamage = awakeningFrame(result, mirrorSource(1), 'damage');
  assert.equal(mirrorDamage.actor, 'enemy');
  assert.equal(mirrorDamage.target, 'player');
  const mirrorPoison = appliedStatusFrame(result, mirrorSource(5), 'player', 'poison');
  assert.equal(mirrorPoison.actor, 'enemy');
  assert.ok(mirrorPoison.player.statuses.poison > 0);
  assert.equal(awakeningFrame(result, neighborSource(1), 'damage').actor, 'enemy');
  assert.equal(result.contributions.some(entry => entry.id === MIRROR_ID), false,
    'enemy mirror outputs do not enter player contributions');
});

test('a lethal mirror resolves first and stops the right neighbor output chain', () => {
  const lethalContent = contentWithMirror({
    outputs: [
      { kind: 'damage', value: 0.2 },
      { kind: 'shield', value: 0.5 },
    ],
  }).content;
  const plain = simulateBattle(lethalContent, makeLoadout('RKF01'), makeEnemy(),
    'v2-mirror-lethal-baseline', { roundLimit: 1 });
  const firstMainDamage = plain.frames.find(frame => frame.kind === 'damage' &&
    frame.actor === 'player' && frame.target === 'enemy');
  assert.ok(firstMainDamage, 'baseline main action needs a target hit');
  const enemyHp = firstMainDamage.amount + 10;
  const lethal = simulateBattle(lethalContent, playerWithMirrorAndNeighbor(), makeEnemy({ hp: enemyHp }),
    'v2-mirror-lethal-copy', { roundLimit: 1 });

  assert.equal(lethal.outcome, 'player');
  assert.equal(lethal.enemyHp, 0);
  assert.equal(outputFrames(lethal, mirrorSource(1), 'damage').length, 1);
  assert.equal(outputFrames(lethal, mirrorSource(2), 'shield').length, 0,
    'the remaining mirrored output cannot resolve after the target dies');
  assert.equal(outputFrames(lethal, neighborSource(1), 'damage').length, 0,
    'the source output does not run after its mirror kills the target');
  assert.equal(outputFrames(lethal, neighborSource(2), 'shield').length, 0,
    'the target death prevents the next source awakening output');
});

test('round-end rage mirrors use the rage recipient side when both fighters own the same artifact', () => {
  const player = makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1, inscription: 'twin' },
    { id: 'RC21', stacks: 1 },
  ], { speed: 100 });
  const enemy = makeLoadout('RKF01', [
    { id: MIRROR_ID, stacks: 1 },
    { id: 'RC21', stacks: 1 },
  ], { speed: 1, attack: 0 });
  const result = simulateBattle(baseContent, player, enemy, 'v2-mirror-rage-owner-side', { roundLimit: 1 });
  const playerMirror = result.frames.filter(frame => frame.kind === 'rage' && frame.actor === 'player' &&
    frame.source?.startsWith(`${MIRROR_ID}-MIRROR-RC21`));
  const enemyMirror = result.frames.filter(frame => frame.kind === 'rage' && frame.actor === 'enemy' &&
    frame.source?.startsWith(`${MIRROR_ID}-MIRROR-RC21`));

  assert.ok(playerMirror.some(frame => frame.source?.endsWith('-INSCRIPTION-TWIN')),
    'the player mirror applies its own twin inscription');
  assert.ok(enemyMirror.some(frame => !frame.source?.endsWith('-INSCRIPTION-TWIN')),
    'the enemy mirror resolves its own copy');
  assert.equal(enemyMirror.some(frame => frame.source?.endsWith('-INSCRIPTION-TWIN')), false,
    'an enemy rage output cannot inherit the player mirror inscription');
});

test('runtime mirror validation accepts only RL08 and the exact neighbor_awakening schema', () => {
  const valid = contentWithMirror({ outputs: [{ kind: 'damage', value: 0.2 }] }).content;
  const validSnapshot = structuredClone(valid.entities);
  calculateStats(valid, playerWithMirrorAndNeighbor());
  assert.deepEqual(valid.entities, validSnapshot, 'mirror validation must not mutate authored content');

  const extraField = contentPatch(entities => {
    withoutMirrorOwner(entities);
    const mirror = cleanArtifact(entities.find(entity => entity.id === 'RL01'), MIRROR_ID, '坏镜');
    mirror.mirror_rule = { kind: 'neighbor_awakening', copy_core: true };
    entities.push(mirror);
  });
  assert.throws(() => simulateBattle(extraField, makeLoadout('RKF01'), makeEnemy(), 'v2-mirror-bad-extra'),
    /Unknown or missing mirror rule parameter/);

  const unknownKind = contentPatch(entities => {
    withoutMirrorOwner(entities);
    const mirror = cleanArtifact(entities.find(entity => entity.id === 'RL01'), MIRROR_ID, '坏镜');
    mirror.mirror_rule = { kind: 'all_triggers' };
    entities.push(mirror);
  });
  assert.throws(() => simulateBattle(unknownKind, makeLoadout('RKF01'), makeEnemy(), 'v2-mirror-bad-kind'),
    /Unsupported mirror rule kind/);

  const unsupportedOwner = contentPatch(entities => {
    const artifact = cleanArtifact(entities.find(entity => entity.id === 'RL01'), 'TEST-UNSUPPORTED-MIRROR', '坏法宝');
    artifact.mirror_rule = { kind: 'neighbor_awakening' };
    entities.push(artifact);
  });
  assert.throws(() => simulateBattle(unsupportedOwner, makeLoadout('RKF01'), makeEnemy(), 'v2-mirror-bad-owner'),
    /Unsupported mirror rule owner TEST-UNSUPPORTED-MIRROR/);

  const missingRule = contentPatch(entities => {
    withoutMirrorOwner(entities);
    const mirror = cleanArtifact(entities.find(entity => entity.id === 'RL01'), MIRROR_ID, '坏镜');
    entities.push(mirror);
  });
  assert.throws(() => simulateBattle(missingRule, makeLoadout('RKF01'), makeEnemy(), 'v2-mirror-missing-rule'),
    /Missing mirror rule \(RL08\)/);
});
