import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 20,
});
const FILLER_IDS = [1, 2, 3, 4].map(index => `TEST-POSITION-FILLER-${index}`);

function patchContent(edit = () => {}) {
  const entities = structuredClone(baseContent.entities);
  edit(entities);
  return contentFromEntities(entities, `${baseContent.version}-five-positions`);
}

const slotContent = patchContent(entities => {
  const template = entities.find(entity => entity.id === 'RL13');
  for (const [index, id] of FILLER_IDS.entries()) {
    const filler = structuredClone(template);
    filler.id = id;
    filler.name = `阵位测试填充${index + 1}`;
    filler.max_stacks = 1;
    filler.unique_group = `five_position_filler_${index + 1}`;
    filler.attributes = { flat: {}, percent: {} };
    filler.effects = [];
    filler.acquisition = { pools: [] };
    delete filler.awakening;
    delete filler.fusion_recipe;
    delete filler.fusion_rule;
    entities.push(filler);
  }
  const rules = entities.find(entity => entity.id === 'RULES');
  rules.rage.opening = 0;
});

function patchSlotContent(edit) {
  const entities = structuredClone(slotContent.entities);
  edit(entities);
  return contentFromEntities(entities, `${slotContent.version}-fixture`);
}

function makeLoadout(method, artifacts = [], overrides = {}) {
  const {
    name = method,
    hp,
    journey,
    baseStats,
    talents = [],
    n = 4,
    ...stats
  } = overrides;
  return {
    name,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...baseStats, ...stats },
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

function dummy(overrides = {}) {
  return makeLoadout('RKF01', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function fullTail(mirrorTargetId, fillers = FILLER_IDS.slice(0, 3)) {
  return [
    ...fillers.map(id => ({ id, stacks: 1 })),
    ...(mirrorTargetId === undefined ? [] : [{ id: 'RL08', stacks: 1 }]),
    { id: mirrorTargetId, stacks: 1 },
  ];
}

function frames(result, kind, source, actor) {
  return result.frames.filter(frame => frame.kind === kind && frame.source === source &&
    (actor === undefined || frame.actor === actor));
}

function oneFrame(result, kind, source, actor) {
  const found = frames(result, kind, source, actor)[0];
  assert.ok(found, `expected ${kind} output from ${source} (${actor ?? 'any side'})`);
  return found;
}

function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
}

function retainedResonance(artifact) {
  return artifact.effects.filter(effect => effect.id === `${artifact.id}-V2-RESONANCE`);
}

test('moving an artifact changes only its own static attribute contribution and never heals current HP', () => {
  const activeContent = patchSlotContent(entities => {
    const artifact = entities.find(entity => entity.id === 'RC13');
    artifact.max_stacks = 3;
    artifact.effects = retainedResonance(artifact);
    artifact.attributes = {
      flat: { attack: 10, defense: 4, max_hp: 100 },
      percent: { attack: 0.1 },
    };
    delete artifact.awakening;
  });
  const front = makeLoadout('RKF06', [
    { id: 'RC13', stacks: 2 },
    { id: FILLER_IDS[0], stacks: 1 },
  ]);
  const movedBack = makeLoadout('RKF06', [
    { id: FILLER_IDS[0], stacks: 1 },
    { id: 'RC13', stacks: 2 },
  ]);

  assert.deepEqual(calculateStats(activeContent, front), {
    attack: 169,
    defense: 12,
    max_hp: 1_300,
    crit_rate: 0,
    speed: 20,
  });
  assert.deepEqual(calculateStats(activeContent, movedBack), {
    attack: 144,
    defense: 8,
    max_hp: 1_200,
    crit_rate: 0,
    speed: 20,
  });

  const wounded = makeLoadout('RKF06', front.artifacts, { hp: 700, speed: 30 });
  const result = simulateBattle(activeContent, wounded, dummy(), 'five-position-no-free-heal', { roundLimit: 1 });
  assert.equal(result.playerHp, 700, 'a larger head-slot max HP does not restore the old missing HP');
  assert.equal(result.frames.at(-1).player.maxHp, 1_300);
  assert.equal(wounded.artifacts[0].stacks, 2, 'the inventory stack count stays unchanged');
});

test('the first slot advances stackable common awakening checks without adding a real stack', () => {
  const activeContent = patchSlotContent(entities => {
    const artifact = entities.find(entity => entity.id === 'RC13');
    artifact.max_stacks = 3;
    artifact.effects = retainedResonance(artifact);
    artifact.attributes = { flat: { attack: 10 }, percent: {} };
    artifact.awakening = {
      at_stacks: 3,
      name: '阵首试验觉醒',
      quick: '测试输出。',
      trigger: 'basic',
      effects: [{ kind: 'damage', value: 0.1 }],
    };
  });
  const playerAtHead = makeLoadout('RKF06', [
    { id: 'RC13', stacks: 2 },
    { id: FILLER_IDS[0], stacks: 1 },
  ], { speed: 30 });
  const playerInSecondSlot = makeLoadout('RKF06', [
    { id: FILLER_IDS[0], stacks: 1 },
    { id: 'RC13', stacks: 2 },
  ], { speed: 30 });
  const enemy = dummy();
  const headResult = simulateBattle(activeContent, playerAtHead, enemy, 'five-position-pre-awakening', { roundLimit: 1 });
  const secondResult = simulateBattle(activeContent, playerInSecondSlot, enemy, 'five-position-no-pre-awakening', { roundLimit: 1 });

  assert.equal(frames(headResult, 'damage', 'RC13-AWAKENING-1', 'player').length, 1);
  assert.equal(frames(secondResult, 'damage', 'RC13-AWAKENING-1', 'player').length, 0);
  assert.equal(playerAtHead.artifacts[0].stacks, 2, 'pre-awakening is a check only and leaves inventory at two stacks');
  assert.equal(calculateStats(activeContent, playerAtHead).attack, 130,
    'the virtual awakening layer does not add static attribute value');
});

test('only the real fifth-slot damage, shield, and heal outputs gain 25%; mirror and inscription copies stay at base', () => {
  const activeContent = patchSlotContent(entities => {
    const artifact = entities.find(entity => entity.id === 'RL13');
    artifact.effects = retainedResonance(artifact);
    artifact.attributes = { flat: {}, percent: {} };
    artifact.awakening = {
      at_stacks: 1,
      name: '阵尾试验输出',
      quick: '测试输出。',
      trigger: 'basic',
      effects: [
        { kind: 'damage', value: 0.1 },
        { kind: 'shield', value: 0.01 },
        { kind: 'heal', value: 0.01 },
      ],
    };
  });
  const tailArtifacts = [
    { id: FILLER_IDS[0], stacks: 1 },
    { id: FILLER_IDS[1], stacks: 1 },
    { id: FILLER_IDS[2], stacks: 1 },
    { id: 'RL08', stacks: 1 },
    { id: 'RL13', stacks: 1, inscription: 'twin' },
  ];
  const player = makeLoadout('RKF06', tailArtifacts, { attack: 100, speed: 1, hp: 500 });
  const enemy = makeLoadout('RKF06', [], { attack: 30, speed: 30 });
  const seed = 'five-position-output-source-order';
  const result = simulateBattle(activeContent, player, enemy, seed, { roundLimit: 1 });
  const replay = simulateBattle(activeContent, player, enemy, seed, { roundLimit: 1 });

  const damageCopy = oneFrame(result, 'damage', 'RL08-MIRROR-AWAKENING-1', 'player');
  const damageInscription = oneFrame(result, 'damage', 'RL13-AWAKENING-1-INSCRIPTION-TWIN', 'player');
  const damageNative = oneFrame(result, 'damage', 'RL13-AWAKENING-1', 'player');
  const shieldCopy = oneFrame(result, 'shield', 'RL08-MIRROR-AWAKENING-2', 'player');
  const shieldInscription = oneFrame(result, 'shield', 'RL13-AWAKENING-2-INSCRIPTION-TWIN', 'player');
  const shieldNative = oneFrame(result, 'shield', 'RL13-AWAKENING-2', 'player');
  const healCopy = oneFrame(result, 'heal', 'RL08-MIRROR-AWAKENING-3', 'player');
  const healInscription = oneFrame(result, 'heal', 'RL13-AWAKENING-3-INSCRIPTION-TWIN', 'player');
  const healNative = oneFrame(result, 'heal', 'RL13-AWAKENING-3', 'player');

  for (const [native, copied] of [
    [damageNative, damageCopy],
    [damageNative, damageInscription],
    [shieldNative, shieldCopy],
    [shieldNative, shieldInscription],
    [healNative, healCopy],
    [healNative, healInscription],
  ]) close(native.amount, copied.amount * 1.25);
  assert.ok(damageCopy.amount > 0);
  close(shieldCopy.amount, 10);
  close(healCopy.amount, 10);
  assert.ok(result.frames.indexOf(damageCopy) < result.frames.indexOf(damageNative),
    'RL08 resolves its copy before the native fifth-slot damage');
  assert.deepEqual(result, replay, 'all copies and tail outputs are stable for the same seed');

  const notFull = makeLoadout('RKF06', [
    { id: FILLER_IDS[0], stacks: 1 },
    { id: FILLER_IDS[1], stacks: 1 },
    { id: FILLER_IDS[2], stacks: 1 },
    { id: 'RL13', stacks: 1, inscription: 'twin' },
  ], { attack: 100, speed: 30, hp: 500 });
  const notFullResult = simulateBattle(activeContent, notFull, dummy(), 'five-position-no-fifth-slot', { roundLimit: 1 });
  close(oneFrame(notFullResult, 'damage', 'RL13-AWAKENING-1', 'player').amount, 10);
  close(oneFrame(notFullResult, 'shield', 'RL13-AWAKENING-2', 'player').amount, 10);
  close(oneFrame(notFullResult, 'heal', 'RL13-AWAKENING-3', 'player').amount, 10);

  const enemyWithTail = makeLoadout('RKF06', tailArtifacts.map(stack => ({ ...stack, inscription: undefined })), {
    attack: 100,
    speed: 30,
    hp: 500,
  });
  const enemyResult = simulateBattle(
    activeContent,
    dummy({ speed: 1 }),
    enemyWithTail,
    'five-position-enemy-symmetry',
    { roundLimit: 1 },
  );
  const enemyNative = oneFrame(enemyResult, 'damage', 'RL13-AWAKENING-1', 'enemy');
  const enemyCopy = oneFrame(enemyResult, 'damage', 'RL08-MIRROR-AWAKENING-1', 'enemy');
  close(enemyNative.amount, enemyCopy.amount * 1.25);
  close(oneFrame(enemyResult, 'shield', 'RL13-AWAKENING-2', 'enemy').amount, 12.5);
  close(oneFrame(enemyResult, 'heal', 'RL13-AWAKENING-3', 'enemy').amount, 12.5);
});

test('tail amplification applies per multi-hit segment while RL08 copies each segment once', () => {
  const player = makeLoadout('RKF01', [
    { id: FILLER_IDS[0], stacks: 1 },
    { id: FILLER_IDS[1], stacks: 1 },
    { id: FILLER_IDS[2], stacks: 1 },
    { id: 'RL08', stacks: 1 },
    { id: 'RR04', stacks: 1 },
  ], { journey: { coins: 200 }, speed: 100 });
  const enemy = dummy();
  const seed = 'five-position-multi-segment-mirror';
  const result = simulateBattle(slotContent, player, enemy, seed, { roundLimit: 1 });
  const native = frames(result, 'damage', 'RR04-V2-RESONANCE', 'player');
  const copied = frames(result, 'damage', 'RL08-MIRROR-RR04-V2-RESONANCE', 'player');

  assert.equal(native.length, 3);
  assert.equal(copied.length, native.length);
  native.forEach((hit, index) => close(hit.amount, copied[index].amount * 1.25));
  const playerContribution = result.contributions.find(item => item.id === 'RR04');
  const mirrorContribution = result.contributions.find(item => item.id === 'RL08');
  close(playerContribution.damage, native.reduce((sum, hit) => sum + hit.amount, 0));
  close(mirrorContribution.damage, copied.reduce((sum, hit) => sum + hit.amount, 0));
  assert.deepEqual(result, simulateBattle(slotContent, player, enemy, seed, { roundLimit: 1 }));
});

test('RL10, RL11, and RL12 tail outputs scale without enlarging RL08 copies; RL13 stays a global rule', () => {
  const enemy = dummy();
  const rl10Artifacts = [
    { id: FILLER_IDS[0], stacks: 1 },
    { id: FILLER_IDS[1], stacks: 1 },
    { id: 'RC11', stacks: 1 },
    { id: 'RL08', stacks: 1 },
    { id: 'RL10', stacks: 1 },
  ];
  const rl10Player = makeLoadout('RKF06', rl10Artifacts, { attack: 100, speed: 30 });
  const rl10 = simulateBattle(slotContent, rl10Player, enemy, 'five-position-rl10-mirror', { roundLimit: 2 });
  const rl10Shot = oneFrame(rl10, 'damage', 'RL10', 'player');
  const rl10Copy = oneFrame(rl10, 'damage', 'RL08-MIRROR-RL10', 'player');
  close(rl10Shot.amount, rl10Copy.amount * 1.25);
  assert.deepEqual(rl10, simulateBattle(slotContent, rl10Player, enemy, 'five-position-rl10-mirror', { roundLimit: 2 }));

  const rl11Base = makeLoadout('RKF01', [
    { id: FILLER_IDS[0], stacks: 1 },
    { id: FILLER_IDS[1], stacks: 1 },
    { id: 'RC12', stacks: 1 },
    { id: 'RL08', stacks: 1 },
    { id: 'RL11', stacks: 1 },
  ], { attack: 100, speed: 30 });
  const rl11MaxHp = calculateStats(slotContent, rl11Base).max_hp;
  const rl11Player = { ...rl11Base, hp: rl11MaxHp - rl11MaxHp * 0.04 };
  const rl11 = simulateBattle(slotContent, rl11Player, enemy, 'five-position-rl11-mirror', { roundLimit: 8 });
  const rl11Bursts = frames(rl11, 'damage', 'RL11', 'player');
  const rl11Copies = frames(rl11, 'damage', 'RL08-MIRROR-RL11', 'player');
  assert.equal(rl11Bursts.length, 1);
  assert.equal(rl11Copies.length, rl11Bursts.length);
  close(rl11Bursts[0].amount, rl11Copies[0].amount * 1.25);

  const rl12Player = makeLoadout('RKF01', [
    { id: FILLER_IDS[0], stacks: 1 },
    { id: FILLER_IDS[1], stacks: 1 },
    { id: FILLER_IDS[2], stacks: 1 },
    { id: 'RL08', stacks: 1 },
    { id: 'RL12', stacks: 1 },
  ], { attack: 100, crit_rate: 1, speed: 30 });
  const rl12 = simulateBattle(slotContent, rl12Player, enemy, 'five-position-rl12-mirror', { roundLimit: 1 });
  const rl12Bolt = oneFrame(rl12, 'damage', 'RL12', 'player');
  const rl12Copy = oneFrame(rl12, 'damage', 'RL08-MIRROR-RL12', 'player');
  close(rl12Bolt.amount, rl12Copy.amount * 1.25);
  close(frames(rl12, 'rage', 'RL08-MIRROR-RL12', 'player')[0].amount, 10);

  const baselinePlayer = makeLoadout('RKF01', [], { attack: 100, speed: 30 });
  const baseline = simulateBattle(slotContent, baselinePlayer, enemy, 'five-position-rl13-baseline', { roundLimit: 1 });
  const rl13Player = makeLoadout('RKF01', fullTail('RL13'), {
    attack: 100,
    speed: 30,
    journey: { coins: 200, coinsSpent: 0, eliteWins: 0, bossWins: 0, artifactKinds: 1, knownMethods: 1 },
  });
  const rl13 = simulateBattle(slotContent, rl13Player, enemy, 'five-position-rl13-global', { roundLimit: 1 });
  const baselineHit = baseline.frames.find(frame => frame.kind === 'damage' && frame.actor === 'player');
  const rl13Hit = rl13.frames.find(frame => frame.kind === 'damage' && frame.actor === 'player');
  close(rl13Hit.amount, baselineHit.amount * 1.1);
  assert.equal(rl13.frames.some(frame => frame.source?.startsWith('RL08-MIRROR-')), false,
    'RL13 has no output of its own for RL08 to copy');
});

test('the equipment board explains both positions and clarifies that early awakening is not a real stack', async () => {
  const app = await readFile(new URL('../src/shanhai/app.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/shanhai/cartoon.css', import.meta.url), 'utf8');
  assert.match(app, /阵首（第1格）.*可叠层普通法宝觉醒判定 \+1 层，不增加真实层数/);
  assert.match(app, /阵尾（第5格）.*镜映与铭刻复制不加成，未满五件时无阵尾/);
  assert.match(styles, /\.game-page \.equipment-position-guide/);
});
