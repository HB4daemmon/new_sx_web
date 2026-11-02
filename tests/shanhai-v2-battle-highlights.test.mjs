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

const [
  { contentFromEntities },
  { simulateBattle },
  { battleHighlights },
  { combatPresentationGroup },
] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
  import(buildModule('battle-highlights.js')),
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
  const {
    name = method,
    talents = [],
    n = 4,
    encounterId,
    ...stats
  } = overrides;
  return {
    name,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(encounterId === undefined ? {} : { encounterId }),
  };
}

function makeBoss(id, overrides = {}) {
  const authored = baseContent.byId[id];
  assert.ok(authored, `missing boss ${id}`);
  return makeLoadout(authored.method, overrides.artifacts ?? [], {
    name: authored.name,
    encounterId: id,
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    crit_rate: 0,
    speed: 1,
    ...overrides,
  });
}

function patchContent(edit) {
  const entities = structuredClone(baseContent.entities);
  edit(entities);
  return contentFromEntities(entities, `${baseContent.version}-battle-highlights`);
}

function phaseGateContent() {
  return patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    entities.find(item => item.id === 'EN-F1').phase_gate.shield_hp_ratio = 0.45;
    entities.find(item => item.id === 'EN-F1').phase_gate.exposure_damage_ratio = 1.5;
    const thunder = entities.find(item => item.id === 'RKF07');
    const rageDamage = thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-DAMAGE');
    rageDamage.params = { ...rageDamage.params, attack_ratio: 0.5, segments: 2 };
    thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-CHAIN').params.chance = 0;
    thunder.actions.basic.effects.find(effect => effect.id === 'RKF07-BASIC-DAMAGE').params.attack_ratio = 0.4;
    thunder.actions.basic.effects.find(effect => effect.id === 'RKF07-BASIC-CHAIN').params.chance = 0;
  });
}

function fighterView(name, counters = [], overrides = {}) {
  return {
    name,
    method: 'RKF01',
    hp: 1_000,
    maxHp: 1_000,
    shield: 0,
    maxShield: 1_000,
    rage: 0,
    rageCap: 100,
    statuses: {},
    ...(counters.length ? { counters: structuredClone(counters) } : {}),
    ...overrides,
  };
}

function frame({
  kind = 'status',
  actor,
  target,
  source,
  text = '',
  player = fighterView('玩家'),
  enemy = fighterView('敌人'),
  round = 1,
} = {}) {
  return { kind, actor, target, source, text, player, enemy, round };
}

function phaseCounter(name, value = 0) {
  return { id: 'EN-F1-PHASE-GATE', name, value, max: 1 };
}

test('real terminal simulation replays and exposes both gate opening and phase shield break', () => {
  const content = phaseGateContent();
  const player = makeLoadout('RKF07', [], {
    attack: 1_000,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
  });
  const enemy = makeBoss('EN-F1', { max_hp: 1_000 });
  const seed = 'battle-highlights-terminal-gate-replay';
  const result = simulateBattle(content, player, enemy, seed, { roundLimit: 2 });
  const replay = simulateBattle(content, player, enemy, seed, { roundLimit: 2 });

  assert.deepEqual(replay.frames, result.frames, 'the source frames are deterministic for the same seed');
  const rageHits = result.frames.filter(item => item.kind === 'damage' &&
    item.actor === 'player' && item.source === 'RKF07-RAGE-DAMAGE');
  assert.equal(rageHits.length, 2);
  assert.equal(rageHits[0].enemy.counters.find(counter => counter.id.endsWith('-PHASE-GATE')).name, '二阶护罩');
  assert.equal(rageHits[1].enemy.counters.find(counter => counter.id.endsWith('-PHASE-GATE')).name, '破门窗口');

  const cursor = result.frames.indexOf(rageHits[1]);
  const group = combatPresentationGroup(result.frames, cursor);
  assert.ok(group);
  const highlights = battleHighlights(result.frames, cursor, group);
  assert.deepEqual(highlights.map(item => [item.kind, item.sourceId]), [
    ['phase_gate_break', 'EN-F1-PHASE-GATE'],
    ['phase_gate_open', 'EN-F1-PHASE-GATE'],
  ]);
  assert.ok(highlights.every(item => item.owner === 'player' && item.target === 'enemy'));
});

test('real awakening and Kunlun mirror frames use their explicit source IDs', () => {
  const player = makeLoadout('RKF01', [
    { id: 'RL08', stacks: 1 },
    { id: 'RC01', stacks: 5 },
  ]);
  const enemy = makeLoadout('RKF06', [], { attack: 0, max_hp: 1_000_000_000, speed: 1 });
  const result = simulateBattle(baseContent, player, enemy, 'battle-highlights-real-mirror-awakening', { roundLimit: 1 });
  const nativeIndex = result.frames.findIndex(item => item.kind === 'status' &&
    item.actor === 'player' && item.source === 'RC01-AWAKENING-1');
  const mirrorIndex = result.frames.findIndex(item => item.kind === 'status' &&
    item.actor === 'player' && item.source === 'RL08-MIRROR-AWAKENING-1');

  assert.ok(nativeIndex >= 0, 'the fully stacked RC01 fixture emits its real awakening event');
  assert.ok(mirrorIndex >= 0, 'RL08 emits a separate mirror event for the awakening');
  const cursor = Math.max(nativeIndex, mirrorIndex);
  const highlights = battleHighlights(result.frames, cursor);
  assert.deepEqual(highlights.map(item => [item.kind, item.sourceId]), [
    ['awakening', 'RC01-AWAKENING-1'],
    ['mirror', 'RL08-MIRROR-AWAKENING-1'],
  ]);
  assert.deepEqual(highlights.map(item => [item.owner, item.target]), [
    ['player', 'player'],
    ['player', 'enemy'],
  ]);
});

test('a real non-awakening mirror output is highlighted when it changes combat state', () => {
  const player = makeLoadout('RKF06', [
    { id: 'RL08', stacks: 1 },
    { id: 'RL10', stacks: 1 },
    { id: 'RC11', stacks: 1 },
  ]);
  const enemy = makeLoadout('RKF06', [], { attack: 0, max_hp: 1_000_000_000, speed: 1 });
  const result = simulateBattle(baseContent, player, enemy, 'battle-highlights-mirror-cannon', { roundLimit: 2 });
  const index = result.frames.findIndex(item => item.kind === 'damage' && item.source === 'RL08-MIRROR-RL10');
  assert.ok(index > 0, 'the mirror actually copies the neighboring cannon output');
  assert.ok(result.frames[index].enemy.hp < result.frames[index - 1].enemy.hp);
  assert.ok(battleHighlights(result.frames, index).some(item => item.kind === 'mirror'));
});

test('a real copied opening shield is highlighted even when it is the first recorded frame', () => {
  const player = makeLoadout('RKF06', [
    { id: 'RL10', stacks: 1 },
    { id: 'RL08', stacks: 1 },
    { id: 'RC11', stacks: 1 },
  ]);
  const enemy = makeLoadout('RKF06', [], { attack: 0, max_hp: 1_000_000_000, speed: 1 });
  const result = simulateBattle(baseContent, player, enemy, 'battle-highlights-opening-mirror', { roundLimit: 1 });
  assert.equal(result.frames[0].source, 'RL08-MIRROR-RC11');
  assert.equal(result.frames[0].kind, 'shield');
  assert.ok(result.frames[0].amount > 0);
  assert.ok(battleHighlights(result.frames, 0).some(item => item.kind === 'mirror'));
});

test('a real stack-gated awakening is highlighted only after its status changes', () => {
  const player = makeLoadout('RKF01', [{ id: 'RC09', stacks: 3 }], { speed: 30 });
  const enemy = makeLoadout('RKF06', [], { attack: 0, max_hp: 1_000_000_000, speed: 1 });
  const result = simulateBattle(baseContent, player, enemy, 'battle-highlights-stack-awakening', { roundLimit: 1 });
  const index = result.frames.findIndex(item => item.source === 'RC09-AWAKENING-ARMOR-BREAK');
  assert.ok(index > 0, 'the full-stack sword tassel applies its real armor break');
  assert.ok(battleHighlights(result.frames, index).some(item =>
    item.kind === 'awakening' && item.sourceId === 'RC09-AWAKENING-ARMOR-BREAK'));
  const fake = [frame({ actor: 'player', target: 'enemy' }), frame({
    actor: 'player', target: 'enemy', source: 'RC09-AWAKENING-ARMOR-BREAK',
  })];
  assert.deepEqual(battleHighlights(fake, 1), [], 'a named source without a state change is not an awakening');
});

test('real RL07 output is highlighted, while an unequipped simulation and text-only fakes are ignored', () => {
  const enemy = makeLoadout('RKF06', [], { attack: 0, max_hp: 1_000_000_000, speed: 1 });
  const equipped = simulateBattle(
    baseContent,
    makeLoadout('RKF01', [{ id: 'RL07', stacks: 1 }], { speed: 30 }),
    enemy,
    'battle-highlights-real-fusion',
    { roundLimit: 1 },
  );
  const fusionIndex = equipped.frames.findIndex(item => item.kind === 'status' && item.source === 'RL07' &&
    item.actor === 'player' && item.target === 'enemy');
  assert.ok(fusionIndex >= 0, 'equipped RL07 emits an explicit output event');
  assert.deepEqual(battleHighlights(equipped.frames, fusionIndex).map(item => item.kind), ['fusion']);

  const unequipped = simulateBattle(
    baseContent,
    makeLoadout('RKF01', [], { speed: 30 }),
    enemy,
    'battle-highlights-unequipped-fusion',
    { roundLimit: 1 },
  );
  assert.equal(unequipped.frames.some(item => item.source === 'RL07'), false);
  assert.equal(unequipped.frames.flatMap((_, index) => battleHighlights(unequipped.frames, index)).length, 0);

  const fake = [frame({
    actor: 'player',
    target: 'enemy',
    source: 'UNOWNED-TEST-SOURCE',
    text: 'RL07 合炼、法宝觉醒、昆仑镜镜映，二阶护罩破开',
  })];
  assert.deepEqual(battleHighlights(fake, 0), [], 'event-like prose without trusted source/state data is ignored');
});

test('only explicit fusion artifact source IDs count, and mirror copies are not fusion owners', () => {
  for (const source of ['RL06', 'RL07', 'RL10', 'RL11', 'RL12', 'RL13']) {
    const highlights = battleHighlights([frame({ actor: 'player', target: 'enemy', source })], 0);
    assert.deepEqual(highlights.map(item => [item.kind, item.sourceId]), [['fusion', source]]);
  }

  for (const source of ['RL07-INSCRIPTION-TWIN', 'RL08-MIRROR-RL07', 'TEST-RL07']) {
    assert.deepEqual(
      battleHighlights([frame({ actor: 'player', target: 'enemy', source })], 0),
      [],
      `${source} is not a native fusion source`,
    );
  }
  assert.deepEqual(
    battleHighlights([frame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RL07' })], 0),
    [],
    'derived damage from a fusion source is not a second event marker',
  );
  assert.deepEqual(
    battleHighlights([frame({ actor: 'player', target: 'player', source: 'RL10' })], 0),
    [],
    'RL10 charge storage targets its owner and is not an output event',
  );
});

test('ordinary shield loss, missing previous state, and boundary frames do not claim a phase gate event', () => {
  const before = frame({ player: fighterView('玩家', [], { shield: 100 }) });
  const ordinaryShieldBreak = frame({
    kind: 'damage',
    actor: 'enemy',
    target: 'player',
    source: 'RKF01-BASIC-DAMAGE',
    player: fighterView('玩家', [], { shield: 0 }),
  });
  assert.deepEqual(battleHighlights([before, ordinaryShieldBreak], 1), []);

  const firstVisibleGateState = frame({
    actor: 'player',
    target: 'enemy',
    enemy: fighterView('终战', [phaseCounter('二阶护罩', 200)]),
  });
  assert.deepEqual(battleHighlights([firstVisibleGateState], 0), [], 'an absent previous frame is not guessed');

  const boundary = frame({
    kind: 'action',
    actor: 'player',
    target: 'enemy',
    enemy: fighterView('终战', [phaseCounter('破门窗口', 1)]),
  });
  assert.deepEqual(battleHighlights([before, boundary], 1), []);
});

test('cursor caps frame reads and cannot see a later phase transition', () => {
  const frames = [
    frame({ enemy: fighterView('终战', [phaseCounter('半血劫门')]) }),
    frame({ actor: 'player', target: 'enemy', enemy: fighterView('终战', [phaseCounter('半血劫门')]) }),
    frame({ actor: 'player', target: 'enemy', enemy: fighterView('终战', [phaseCounter('二阶护罩', 200)]) }),
  ];
  const guardedFrames = new Proxy(frames, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property) && Number(property) > 1) {
        throw new Error(`read past cursor: ${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });

  assert.deepEqual(battleHighlights(guardedFrames, 1), []);
  assert.deepEqual(battleHighlights(frames, 2).map(item => item.kind), ['phase_gate_open']);
});

test('simultaneous events follow break, opening, awakening, fusion, mirror priority and stay capped', () => {
  const frames = [
    frame({ enemy: fighterView('终战', [phaseCounter('半血劫门')]) }),
    frame({
      actor: 'player',
      target: 'enemy',
      source: 'RKF07-BASIC-DAMAGE',
      enemy: fighterView('终战', [phaseCounter('二阶护罩', 200)]),
    }),
    frame({
      actor: 'player', target: 'player', source: 'RC01-AWAKENING-1',
      enemy: fighterView('终战', [phaseCounter('二阶护罩', 200)]),
    }),
    frame({
      actor: 'player', target: 'enemy', source: 'RL07',
      enemy: fighterView('终战', [phaseCounter('二阶护罩', 200)]),
    }),
    frame({
      actor: 'player', target: 'enemy', source: 'RL08-MIRROR-AWAKENING-1',
      enemy: fighterView('终战', [phaseCounter('二阶护罩', 200)]),
    }),
    frame({
      actor: 'player',
      target: 'enemy',
      source: 'RKF07-RAGE-DAMAGE',
      enemy: fighterView('终战', [phaseCounter('破门窗口', 1)]),
    }),
  ];

  const highlights = battleHighlights(frames, frames.length - 1);
  assert.equal(highlights.length, 3);
  assert.deepEqual(highlights.map(item => item.kind), [
    'phase_gate_break',
    'phase_gate_open',
    'awakening',
  ]);
});
