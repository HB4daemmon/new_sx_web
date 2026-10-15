import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'shanhai-game-art-test-'));
const moduleDirectory = path.join(temporary, 'shanhai');
await mkdir(moduleDirectory, { recursive: true });
await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}');

for (const filename of [
  'art-assets.ts',
  'battle-playback.ts',
  'battle-presentation.ts',
  'game-art.ts',
]) {
  const source = await readFile(path.join(ROOT, 'src/shanhai', filename), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  await writeFile(path.join(moduleDirectory, filename.replace(/\.ts$/, '.js')), compiled);
}

const [gameArt, artAssets] = await Promise.all([
  import(pathToFileURL(path.join(moduleDirectory, 'game-art.js')).href),
  import(pathToFileURL(path.join(moduleDirectory, 'art-assets.js')).href),
]);
after(() => rm(temporary, { recursive: true, force: true }));

function frameCharacter(id) {
  return {
    src: `/assets/frames-${id.toLowerCase()}.png`,
    frames: Array.from({ length: 12 }, (_, index) => [
      (index % 3) * 400,
      Math.floor(index / 3) * 448,
      400,
      448,
    ]),
    anchor: [160, 420],
    bodyHeight: 300,
    review: id.startsWith('EN-') && id !== 'EN-A1-L1'
      ? { status: 'agent-reviewed', reviewedBy: 'agent', date: '2026-10-15' }
      : undefined,
  };
}

function prepareArt(art) {
  const characters = Object.fromEntries([
    'RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05',
    ...Array.from({ length: 4 }, (_, act) => [
      ...Array.from({ length: 4 }, (_, index) => `EN-A${act + 1}-C${index + 1}`),
      ...Array.from({ length: 2 }, (_, index) => `EN-A${act + 1}-L${index + 1}`),
      ...Array.from({ length: 2 }, (_, index) => `EN-A${act + 1}-B${index + 1}`),
    ]).flat(),
    'EN-F1',
    'EN-F2',
  ].map(id => [id, frameCharacter(id)]));
  const images = new Map();
  for (const id of ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05']) {
    images.set(artAssets.assetUrl(characters[id].src), {
      naturalWidth: 1200,
      naturalHeight: 1792,
      complete: true,
    });
  }
  images.set(artAssets.assetUrl(characters['EN-A1-L1'].src), {
    naturalWidth: 1200,
    naturalHeight: 1792,
    complete: true,
  });
  art.manifest = {
    schemaVersion: 1,
    frameSize: [400, 448],
    targetBodyHeight: 300,
    characters,
  };
  art.images = images;
}

function sideSummary(overrides = {}) {
  return {
    damage: 0,
    healing: 0,
    shieldAbsorbed: 0,
    shieldGenerated: 0,
    shieldConsumed: 0,
    hits: 0,
    dotDamage: 0,
    dotHits: 0,
    critical: false,
    statuses: {},
    ...overrides,
  };
}

function group(player = {}, enemy = {}, dot = false) {
  return {
    startIndex: 1,
    endIndex: 1,
    round: 1,
    dot,
    player: sideSummary(player),
    enemy: sideSummary(enemy),
  };
}

function battleFrame(kind = 'action', actor = 'player', lockedAction = 'basic_action') {
  return {
    kind,
    text: '',
    round: 1,
    actor,
    player: { lockedAction: actor === 'player' ? lockedAction : undefined },
    enemy: { lockedAction: actor === 'enemy' ? lockedAction : undefined },
  };
}

function nodes() {
  const attributes = {};
  const canvas = {
    isConnected: true,
    parentElement: { setAttribute: (name, value) => { attributes[name] = value; } },
    closest: () => ({ setAttribute: (name, value) => { attributes[name] = value; } }),
  };
  const arena = { dataset: {} };
  return { canvas, arena, attributes };
}

function fakeRig(canvas) {
  const calls = [];
  const actions = new Map();
  const characters = new Set();
  let disposed = false;
  const rig = {
    canvas,
    timeline: {
      actions,
      clock: 0,
      configure: options => calls.push(['configure', options]),
      play: (side, action) => {
        calls.push(['play', side, action]);
        actions.set(side, { action });
      },
    },
    configure: () => {},
    hasCharacter: id => characters.has(id),
    addCharacter: (_manifest, _images, id) => {
      characters.add(id);
      calls.push(['add-skin', id]);
    },
    setCharacter: (side, skin) => calls.push(['skin', side, skin]),
    draw: () => calls.push(['draw']),
    dispose: () => { disposed = true; },
  };
  return {
    rig,
    calls,
    actions,
    setCharacters: ids => ids.forEach(id => characters.add(id)),
    disposed: () => disposed,
  };
}

function runtimeFor(mounted, create) {
  return {
    FrameBattle: {
      create(canvas, manifest, images, onFailure) {
        mounted.setCharacters(Object.keys(manifest.characters));
        return create
          ? create(canvas, manifest, images, onFailure)
          : Promise.resolve(mounted.rig);
      },
    },
  };
}

function battleState({ canvas, arena, frame, group: presentationGroup, cursorChanged = false }) {
  return {
    canvas,
    arena,
    method: 'RKF02',
    enemyMethod: 'RKF03',
    enemyId: 'EN-A1-L1',
    paused: false,
    cursorChanged,
    frame,
    group: presentationGroup,
  };
}

test('frame action mapping recognizes basic and rage actions but not rage gains', () => {
  assert.deepEqual(gameArt.battleActionForFrame(battleFrame('action', 'player', 'basic_action')), {
    side: 'player',
    action: 'attack',
  });
  assert.deepEqual(gameArt.battleActionForFrame(battleFrame('action', 'enemy', 'rage_action')), {
    side: 'enemy',
    action: 'rage',
  });
  assert.equal(gameArt.battleActionForFrame(battleFrame('rage', 'player', 'rage_action')), undefined);
});

test('group reaction mapping covers damage, DOT, blocking, healing, and artifact effects', () => {
  assert.deepEqual(
    gameArt.battleReactionsForGroup(group({ damage: 12 })),
    [{ side: 'player', action: 'hit' }],
  );
  assert.deepEqual(
    gameArt.battleReactionsForGroup(group({ damage: 12, dotDamage: 12, dotHits: 1 }, {}, true)),
    [{ side: 'player', action: 'hit' }],
  );
  assert.deepEqual(
    gameArt.battleReactionsForGroup(group({}, { shieldAbsorbed: 9 })),
    [{ side: 'enemy', action: 'guard' }],
  );
  assert.deepEqual(
    gameArt.battleReactionsForGroup(group({ healing: 7 }, { shieldGenerated: 10 })),
    [{ side: 'player', action: 'heal' }, { side: 'enemy', action: 'artifact' }],
  );
  assert.deepEqual(
    gameArt.battleReactionsForGroup(group({ statuses: { poison: 1 } })),
    [{ side: 'player', action: 'artifact' }],
  );
});

test('a same-side heal does not replace a rage animation already in progress', async () => {
  const { canvas, arena } = nodes();
  const mounted = fakeRig(canvas);
  const runtime = {
    FrameBattle: runtimeFor(mounted).FrameBattle,
  };
  const art = new gameArt.GameArt();
  prepareArt(art);
  art.runtimePromise = Promise.resolve(runtime);

  art.syncBattle(battleState({
    canvas,
    arena,
    frame: battleFrame('start'),
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(mounted.calls.filter(call => call[0] === 'play'), []);

  art.syncBattle(battleState({
    canvas,
    arena,
    frame: battleFrame('action', 'player', 'rage_action'),
    cursorChanged: true,
  }));
  art.syncBattle(battleState({
    canvas,
    arena,
    frame: battleFrame('shield'),
    group: group({ shieldGenerated: 18, statuses: { shield_bonus: 1 } }),
    cursorChanged: true,
  }));
  assert.deepEqual(mounted.calls.filter(call => call[0] === 'play'), [
    ['play', 'player', 'rage'],
  ]);

  art.syncBattle(battleState({
    canvas,
    arena,
    frame: battleFrame('heal'),
    group: group({ healing: 18 }),
    cursorChanged: true,
  }));
  assert.deepEqual(mounted.calls.filter(call => call[0] === 'play'), [
    ['play', 'player', 'rage'],
  ]);
  art.dispose();
});

test('reduced motion is forwarded to the shared animation timeline', async () => {
  const { canvas, arena } = nodes();
  const mounted = fakeRig(canvas);
  const art = new gameArt.GameArt();
  prepareArt(art);
  art.runtimePromise = Promise.resolve(runtimeFor(mounted));
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    art.syncBattle(battleState({ canvas, arena, frame: battleFrame('start') }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(mounted.calls.find(call => call[0] === 'configure')[1].reduced, true);
    art.setBattlePaused(true);
    assert.equal(mounted.calls.at(-1)[1].reduced, true);
  } finally {
    globalThis.matchMedia = previous;
    art.dispose();
  }
});

test('pending battle mounts apply the latest frame after asynchronous renderer creation', async () => {
  const { canvas, arena } = nodes();
  const mounted = fakeRig(canvas);
  let resolveCreation;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const creation = new Promise(resolve => { resolveCreation = resolve; });
  const runtime = {
    FrameBattle: runtimeFor(mounted, () => {
        markStarted();
        return creation;
      }).FrameBattle,
  };
  const art = new gameArt.GameArt();
  prepareArt(art);
  art.runtimePromise = Promise.resolve(runtime);

  art.syncBattle(battleState({
    canvas,
    arena,
    frame: battleFrame('start'),
  }));
  await started;
  art.syncBattle(battleState({
    canvas,
    arena,
    frame: battleFrame('action', 'enemy', 'rage_action'),
    cursorChanged: true,
  }));
  art.syncBattle({
    ...battleState({
      canvas,
      arena,
      frame: battleFrame('action', 'enemy', 'rage_action'),
    }),
    paused: true,
  });
  resolveCreation(mounted.rig);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(mounted.calls.filter(call => call[0] === 'play'), [
    ['play', 'enemy', 'rage'],
  ]);
  assert.equal(arena.dataset.artReady, 'true');
  assert.equal(mounted.calls.filter(call => call[0] === 'configure').at(-1)[1].paused, true);
  assert.ok(mounted.calls.findIndex(call => call[0] === 'draw') <
    mounted.calls.findLastIndex(call => call[0] === 'configure'),
  'the restored pose is drawn before the newly mounted timeline is paused');
  art.dispose();
});

test('battle art loads only the selected enemy and swaps skins without resetting its clock', async () => {
  const { canvas, arena } = nodes();
  const mounted = fakeRig(canvas);
  const art = new gameArt.GameArt();
  prepareArt(art);
  art.images.delete(artAssets.assetUrl(art.manifest.characters['EN-A1-L1'].src));
  const createdCharacters = [];
  const decodedSources = [];
  const originalImage = globalThis.Image;
  globalThis.Image = class {
    naturalWidth = 1200;
    naturalHeight = 1792;
    complete = true;
    src = '';
    async decode() {
      decodedSources.push(this.src);
    }
  };
  art.runtimePromise = Promise.resolve(runtimeFor(mounted, (_canvas, manifest) => {
    createdCharacters.push(Object.keys(manifest.characters));
    return Promise.resolve(mounted.rig);
  }));

  try {
    art.syncBattle({
      ...battleState({ canvas, arena, frame: battleFrame('start') }),
      enemyId: 'EN-A4-B2',
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(createdCharacters, [['RKF02', 'EN-A4-B2']]);
    assert.equal(decodedSources.length, 1);
    assert.match(decodedSources[0], /frames-en-a4-b2\.png$/);
    assert.equal(art.runtimeFailed, false);
    assert.equal(arena.dataset.artReady, 'true');

    mounted.rig.timeline.clock = 481;
    mounted.actions.set('enemy', { action: 'rage' });
    art.syncBattle({
      ...battleState({ canvas, arena, frame: battleFrame('start') }),
      enemyId: 'EN-A3-C2',
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(mounted.calls.filter(call => call[0] === 'add-skin'), [
      ['add-skin', 'EN-A3-C2'],
    ]);
    assert.equal(mounted.rig.timeline.clock, 481);
    assert.equal(mounted.actions.get('enemy').action, 'rage');
    assert.match(decodedSources[1], /frames-en-a3-c2\.png$/);
  } finally {
    globalThis.Image = originalImage;
    art.dispose();
  }
});

test('load failure clears pending mounts and leaves static art available as fallback', async () => {
  const startNodes = nodes();
  const battleNodes = nodes();
  const art = new gameArt.GameArt();
  art.loadRuntime = async () => {
    throw new Error('renderer assets unavailable');
  };

  art.syncStart(startNodes.canvas, 'RKF01');
  art.syncBattle(battleState({
    canvas: battleNodes.canvas,
    arena: battleNodes.arena,
    frame: battleFrame('start'),
  }));
  assert.equal(await art.load(), false);

  assert.equal(art.pendingStart, null);
  assert.equal(art.pendingBattle, null);
  assert.equal(startNodes.attributes['data-art-ready'], undefined);
  assert.equal(battleNodes.arena.dataset.artReady, 'false');
  assert.equal(art.runtimeFailed, true);
});

test('a battle rig created for a replaced canvas is disposed without attaching', async () => {
  const oldNodes = nodes();
  const mounted = fakeRig(oldNodes.canvas);
  let resolveCreation;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const creation = new Promise(resolve => { resolveCreation = resolve; });
  const runtime = {
    FrameBattle: runtimeFor(mounted, () => {
        markStarted();
        return creation;
      }).FrameBattle,
  };
  const art = new gameArt.GameArt();
  prepareArt(art);
  art.runtimePromise = Promise.resolve(runtime);

  art.syncBattle(battleState({
    canvas: oldNodes.canvas,
    arena: oldNodes.arena,
    frame: battleFrame('start'),
  }));
  await started;
  art.syncBattle({ ...battleState({
    canvas: null,
    arena: null,
    frame: battleFrame('start'),
  }) });
  resolveCreation(mounted.rig);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(mounted.disposed(), true);
  assert.equal(art.battleRig, null);
  art.dispose();
});
