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
  { simulateBattle },
  { battleImpactSegments, battleBeatEquipmentTriggers },
  { combatPresentationGroup },
] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
  import(buildModule('battle-impact.js')),
  import(buildModule('battle-playback.js')),
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

function makeLoadout(method, artifacts = [], overrides = {}) {
  const { talents = [], n = 4, ...stats } = overrides;
  return {
    name: method,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
  };
}

function patchContent(edit) {
  const entities = structuredClone(baseContent.entities);
  edit(entities);
  return contentFromEntities(entities, `${baseContent.version}-battle-impact-test`);
}

function fighter(name, overrides = {}) {
  return {
    name,
    method: 'RKF01',
    hp: 500,
    maxHp: 1_000,
    shield: 0,
    maxShield: 1_000,
    rage: 0,
    rageCap: 100,
    statuses: {},
    ...overrides,
  };
}

function frame({
  kind = 'status',
  actor,
  target,
  source,
  text = '',
  amount,
  player = fighter('玩家'),
  enemy = fighter('敌人'),
  round = 1,
} = {}) {
  return {
    round,
    kind,
    actor,
    target,
    source,
    text,
    amount,
    player: structuredClone(player),
    enemy: structuredClone(enemy),
  };
}

test('real multi-segment rage separates actual HP loss from shield absorption', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const thunder = entities.find(item => item.id === 'RKF07');
    thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-DAMAGE')
      .params.segments = 3;
    thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-CHAIN')
      .params.chance = 0;
  });
  const player = makeLoadout('RKF07', [], { attack: 300, speed: 30 });
  const enemy = makeLoadout('RKF06', [{ id: 'RC11', stacks: 1 }], {
    attack: 0,
    max_hp: 1_000,
    speed: 1,
  });
  const result = simulateBattle(content, player, enemy, 'battle-impact-multi-hit-shield', { roundLimit: 1 });
  const replay = simulateBattle(content, player, enemy, 'battle-impact-multi-hit-shield', { roundLimit: 1 });
  assert.deepEqual(replay.frames, result.frames, 'impact extraction must not alter deterministic combat');

  const damageFrames = result.frames.filter(candidate => candidate.kind === 'damage' &&
    candidate.actor === 'player' && candidate.target === 'enemy' &&
    candidate.source === 'RKF07-RAGE-DAMAGE');
  assert.equal(damageFrames.length, 3, 'the real rage action emits all three configured segments');
  const cursor = result.frames.indexOf(damageFrames.at(-1));
  const beforeExtraction = structuredClone(result.frames);
  const impacts = battleImpactSegments(result.frames, cursor, combatPresentationGroup(result.frames, cursor));
  const rageImpacts = impacts.filter(impact => impact.source === 'RKF07-RAGE-DAMAGE');

  assert.equal(rageImpacts.length, 3);
  assert.deepEqual(rageImpacts.map(impact => impact.order), [0, 1, 2]);
  for (const impact of rageImpacts) {
    const before = result.frames[impact.frameIndex - 1].enemy;
    const after = result.frames[impact.frameIndex].enemy;
    assert.equal(impact.attacker, 'player');
    assert.equal(impact.target, 'enemy');
    assert.equal(impact.hpDamage, Math.max(0, before.hp - after.hp));
    assert.equal(impact.shieldAbsorbed, Math.max(0, before.shield - after.shield));
    assert.equal(impact.amount, impact.hpDamage + impact.shieldAbsorbed);
  }
  assert.ok(rageImpacts[0].shieldAbsorbed > 0, 'the first segment is absorbed by RC11 opening shield');
  assert.ok(rageImpacts.some(impact => impact.shieldAbsorbed > 0 && impact.hpDamage > 0),
    'a segment can split between the remaining shield and HP');
  assert.ok(rageImpacts.some(impact => impact.hpDamage > 0));
  assert.ok(rageImpacts.some(impact =>
    impact.amount !== result.frames[impact.frameIndex].amount),
  'reported actual impact is independent of the authored frame amount');
  assert.deepEqual(result.frames, beforeExtraction, 'extraction is read-only');
});

test('a real half-health gate hit still counts the ordinary shield it consumed', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
  });
  const player = {
    ...makeLoadout('RKF08', [], { attack: 0, max_hp: 10_000, speed: 30 }),
    firstStrike: 1_000,
  };
  const boss = {
    ...makeLoadout('RKF07', [], { attack: 0, max_hp: 1_000, speed: 1 }),
    encounterId: 'EN-F1',
    thunderChallenge: true,
  };
  const result = simulateBattle(content, player, boss, 'battle-impact-phase-shield', { roundLimit: 1 });
  const hitIndex = result.frames.findIndex(item => item.kind === 'damage' &&
    item.source === 'RKF05-TRAVEL-NEXT-STRIKE');
  assert.ok(hitIndex > 0);
  const hit = battleImpactSegments(result.frames, hitIndex).find(item => item.frameIndex === hitIndex);
  assert.ok(hit);
  assert.equal(hit.hpDamage, 500);
  assert.equal(hit.shieldAbsorbed, 150, 'the old challenge shield was absorbed before the new gate appeared');
  assert.equal(hit.amount, 650);
});

test('real Kunlun mirror and equipped awakening IDs retain their actual trigger order', () => {
  const player = makeLoadout('RKF01', [
    { id: 'RL08', stacks: 1 },
    { id: 'RC01', stacks: 5 },
  ], { speed: 30 });
  const enemy = makeLoadout('RKF06', [], {
    attack: 0,
    max_hp: 1_000_000_000,
    speed: 1,
  });
  const result = simulateBattle(baseContent, player, enemy, 'battle-impact-real-mirror-awakening', { roundLimit: 1 });
  const sourceFrames = result.frames.filter(candidate => candidate.actor === 'player' &&
    ['RC01-AWAKENING-1', 'RL08-MIRROR-AWAKENING-1'].includes(candidate.source));
  const nativeIndex = result.frames.findIndex(candidate => candidate.actor === 'player' &&
    candidate.source === 'RC01-AWAKENING-1');
  const mirrorIndex = result.frames.findIndex(candidate => candidate.actor === 'player' &&
    candidate.source === 'RL08-MIRROR-AWAKENING-1');
  assert.ok(nativeIndex >= 0, 'the fully stacked RC01 emits its real awakening');
  assert.ok(mirrorIndex >= 0, 'RL08 emits a separate mirror output');
  assert.ok(sourceFrames.some(candidate => candidate.kind === 'damage'));

  const cursor = Math.max(nativeIndex, mirrorIndex);
  const group = combatPresentationGroup(result.frames, cursor);
  const beforeExtraction = structuredClone(result.frames);
  const triggers = battleBeatEquipmentTriggers(result.frames, cursor, ['RL08', 'RC01'], group);

  assert.deepEqual(triggers.map(trigger => trigger.id), ['RC01', 'RL08']);
  assert.deepEqual(triggers.map(trigger => trigger.order), [0, 1]);
  assert.ok(triggers[0].frameIndex < triggers[1].frameIndex);
  assert.match(triggers[0].source, /^RC01-/);
  assert.match(triggers[1].source, /^RL08-MIRROR-/);
  assert.deepEqual(result.frames, beforeExtraction, 'equipment extraction does not mutate the combat result');
});

test('actual snapshot deltas ignore frame.amount, shield spending, healing, and zero-damage frames', () => {
  const frames = [
    frame({ kind: 'action', actor: 'player', target: 'enemy',
      player: fighter('玩家', { shield: 100 }), enemy: fighter('敌人', { shield: 100 }) }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RC01-TEST',
      text: '造成暴击', amount: 900,
      player: fighter('玩家', { shield: 100 }), enemy: fighter('敌人', { shield: 40 }) }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RC02-TEST',
      text: '造成伤害', amount: 0,
      player: fighter('玩家', { shield: 100 }), enemy: fighter('敌人', { hp: 450, shield: 0 }) }),
    frame({ kind: 'rage', actor: 'player', target: 'player', source: 'RKF01-RAGE',
      player: fighter('玩家', { shield: 90 }), enemy: fighter('敌人', { hp: 450, shield: 0 }) }),
    frame({ kind: 'heal', actor: 'player', target: 'enemy', source: 'RC03-HEAL',
      player: fighter('玩家', { shield: 90 }), enemy: fighter('敌人', { hp: 480, shield: 0 }) }),
    frame({ kind: 'dot', actor: 'enemy', target: 'player', source: 'RR01-DOT',
      text: '持续伤害', amount: 800,
      player: fighter('玩家', { hp: 480, shield: 90 }), enemy: fighter('敌人', { hp: 480, shield: 0 }) }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RC04-ZERO',
      amount: 800,
      player: fighter('玩家', { hp: 480, shield: 90 }), enemy: fighter('敌人', { hp: 480, shield: 0 }) }),
  ];

  const directImpacts = battleImpactSegments(frames, 4);
  assert.deepEqual(directImpacts.map(({ source, amount, hpDamage, shieldAbsorbed, critical }) =>
    ({ source, amount, hpDamage, shieldAbsorbed, critical })), [
    { source: 'RC01-TEST', amount: 60, hpDamage: 0, shieldAbsorbed: 60, critical: true },
    { source: 'RC02-TEST', amount: 90, hpDamage: 50, shieldAbsorbed: 40, critical: false },
  ]);
  assert.equal(directImpacts[0].target, 'enemy');
  assert.equal(directImpacts[1].target, 'enemy');

  const dotImpacts = battleImpactSegments(frames, 6);
  assert.deepEqual(dotImpacts.map(({ kind, attacker, target, source, amount, hpDamage }) =>
    ({ kind, attacker, target, source, amount, hpDamage })), [
    { kind: 'dot', attacker: 'enemy', target: 'player', source: 'RR01-DOT', amount: 20, hpDamage: 20 },
  ], 'the HP heal and a following zero-damage hit cannot become impacts');
});

test('equipment triggers require player ownership, an equipped root ID, and a source boundary', () => {
  const frames = [
    frame({ kind: 'action' }),
    frame({ kind: 'status', actor: 'player', target: 'enemy', source: 'RC01-AWAKENING-1' }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RC01-AWAKENING-2' }),
    frame({ kind: 'status', actor: 'enemy', target: 'player', source: 'RC01-AWAKENING-1' }),
    frame({ kind: 'status', actor: 'player', target: 'enemy', source: 'RL08-MIRROR-RC01-AWAKENING-1' }),
    frame({ kind: 'status', actor: 'player', target: 'enemy', source: 'TEST-RC02-AWAKENING-1' }),
    frame({ kind: 'status', actor: 'player', target: 'enemy', source: 'RC03-AWAKENING-1' }),
  ];
  const guardedFrames = new Proxy(frames, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property) && Number(property) > 5) {
        throw new Error(`read past cursor: ${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const futureGroup = { startIndex: 1, endIndex: 6 };

  assert.deepEqual(
    battleBeatEquipmentTriggers(guardedFrames, 5, ['RC01', 'RL08'], futureGroup),
    [
      { id: 'RC01', order: 0, frameIndex: 1, source: 'RC01-AWAKENING-1' },
      { id: 'RL08', order: 1, frameIndex: 4, source: 'RL08-MIRROR-RC01-AWAKENING-1' },
    ],
    'future frames, enemy-owned IDs, unequipped artifacts, and embedded ID text are ignored',
  );
  assert.deepEqual(battleBeatEquipmentTriggers(guardedFrames, 5, []), [], 'unequipped sources never light');
});

test('impact extraction does not read after cursor even when the supplied group reaches farther', () => {
  const frames = [
    frame({ kind: 'action', actor: 'player', target: 'enemy', enemy: fighter('敌人', { hp: 500 }) }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RC01-HIT', amount: 999,
      enemy: fighter('敌人', { hp: 450 }) }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RC01-FUTURE', amount: 999,
      enemy: fighter('敌人', { hp: 0 }) }),
  ];
  const guardedFrames = new Proxy(frames, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property) && Number(property) > 1) {
        throw new Error(`read past cursor: ${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });

  assert.deepEqual(
    battleImpactSegments(guardedFrames, 1, { startIndex: 1, endIndex: 2 }),
    [{
      order: 0,
      frameIndex: 1,
      kind: 'damage',
      attacker: 'player',
      target: 'enemy',
      amount: 50,
      hpDamage: 50,
      shieldAbsorbed: 0,
      source: 'RC01-HIT',
      critical: false,
    }],
  );
});
