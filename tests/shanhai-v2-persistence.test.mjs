import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker, validateRunState } from '../build/shanhai/run.js';
import {
  SHANHAI_BUILD_KEY,
  SHANHAI_SAVE_KEY,
  hasSavedRun,
  loadRun,
  loadWinningBuilds,
  parseRunSave,
  saveRun,
  saveWinningBuild,
  serializeRun,
} from '../build/shanhai/persistence.js';

const loaded = await loadContent();
const entities = loaded.entities;
const byId = new Map(entities.map(entity => [entity.id, entity]));
const rules = byId.get('RULES');
const content = {
  version: loaded.manifest.content_version,
  entities,
  byId,
  rules,
};

function installCombat() {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player) {
      return {
        outcome: 'player',
        rounds: 1,
        playerHp: player.hp ?? player.baseStats.max_hp,
        enemyHp: 0,
        frames: [],
        contributions: [],
      };
    },
  });
}

function make(seed = 'v2-persistence') {
  installCombat();
  return ShanhaiGame.create(content, { seed, name: '存档者', method: 'RKF01' });
}

function storage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

test('V2 resonance saves leave V1 and V2 journey records isolated', () => {
  assert.equal(SHANHAI_SAVE_KEY, 'suishi-shanhai-run-v2-resonance');
  assert.equal(SHANHAI_BUILD_KEY, 'suishi-shanhai-build-v2-resonance');
  const store = storage();
  const oldRecord = JSON.stringify({
    schema: 1,
    key: 'suishi-shanhai-run-v1',
    contentVersion: 'shanhai-content-0.1',
    savedAt: '2026-10-01T00:00:00.000Z',
    state: { schema: 1, contentVersion: 'shanhai-content-0.1' },
  });
  store.setItem('suishi-shanhai-run-v1', oldRecord);
  const game = make();
  const oldJourneyRecord = JSON.parse(serializeRun(game));
  oldJourneyRecord.key = 'suishi-shanhai-run-v2-journey';
  const oldJourneyText = JSON.stringify(oldJourneyRecord);
  store.setItem('suishi-shanhai-run-v2-journey', oldJourneyText);
  store.setItem('suishi-shanhai-build-v2-journey', 'legacy-v2-build-untouched');
  store.setItem('suishi-shanhai-replay-v2-journey', 'legacy-v2-replay-untouched');
  assert.equal(loadRun(content, store), null);
  assert.equal(hasSavedRun(store), false);
  assert.throws(() => parseRunSave(content, oldJourneyText), /invalid record header/);

  saveRun(game, store);
  assert.equal(store.getItem('suishi-shanhai-run-v1'), oldRecord);
  assert.equal(store.getItem('suishi-shanhai-run-v2-journey'), oldJourneyText);
  assert.equal(store.getItem('suishi-shanhai-build-v2-journey'), 'legacy-v2-build-untouched');
  assert.equal(store.getItem('suishi-shanhai-replay-v2-journey'), 'legacy-v2-replay-untouched');
  assert.equal(JSON.parse(store.getItem(SHANHAI_SAVE_KEY)).key, SHANHAI_SAVE_KEY);
  assert.throws(() => parseRunSave(content, oldRecord), /V1.*cannot be loaded/);

});

test('equipment and frozen candidates round-trip and malformed snapshots are rejected', () => {
  const game = make('v2-strict-load');
  game.state.artifacts = [
    { id: 'RC01', stacks: 1 },
    { id: 'RC09', stacks: 1 },
  ];
  game.state.equipment = { slots: ['RC09', 'RC01'] };
  game.state.xp = 120;
  game.state.phase = 'talent';
  game.state._talentQueue = [{ method: 'RKF01', tier: 1, advance: true }];
  game.availableTalents();

  const saved = serializeRun(game);
  const restored = parseRunSave(content, saved);
  assert.deepEqual(restored.equipment, { slots: ['RC09', 'RC01'] });
  assert.deepEqual(restored.talentDrafts['RKF01:1:0'], game.state.talentDrafts['RKF01:1:0']);

  for (const corrupt of [
    state => { state.equipment.slots = ['RC09', 'RC09']; },
    state => { state.equipment.slots = ['RC10']; },
    state => { state.talentDrafts['RKF01:1:0'].pop(); },
  ]) {
    const payload = JSON.parse(saved);
    corrupt(payload.state);
    assert.throws(() => parseRunSave(content, JSON.stringify(payload)));
  }

  const replacement = JSON.parse(saved);
  const offered = replacement.state.talentDrafts['RKF01:1:0'];
  const unofferedLocal = byId.get('RKF01').talents.find(talent =>
    talent.tier === 1 && talent.id.startsWith('RKF01-J1-') && !offered.includes(talent.id));
  assert.ok(unofferedLocal);
  offered[0] = unofferedLocal.id;
  assert.equal(offered.filter(id => id.startsWith('RKF01-J1-')).length, 1);
  assert.equal(offered.filter(id => id.startsWith('V2-J1-')).length, 2);
  assert.throws(() => parseRunSave(content, JSON.stringify(replacement)), /seed/);
});

test('contentless saves still enforce V2 version and owned equipment IDs', () => {
  const game = make('v2-contentless-save');
  const unownedEquipment = structuredClone(game.state);
  unownedEquipment.equipment.slots = ['RC09'];
  assert.throws(() => serializeRun(unownedEquipment), /equipment ownership/);

  const v1State = structuredClone(game.state);
  v1State.contentVersion = 'shanhai-content-0.1';
  assert.throws(() => serializeRun(v1State), /V2 save requires/);
  assert.throws(() => parseRunSave(content, JSON.stringify(v1State)), /Run\/content version mismatch/);

  for (const mutate of [
    state => { state.equipment.slots = ['RC01', 'RC01']; },
    state => { state.equipment.slots = ['RC01', 'RC02', 'RC03', 'RC04', 'RC05']; },
    state => { state.buildVersion = 1; },
    state => { delete state.buildVersion; },
    state => { state.progress.eliteWins = 0.5; },
    state => { state.progress.coinsSpent = -1; },
  ]) {
    const invalid = structuredClone(game.state);
    invalid.artifacts = [
      { id: 'RC01', stacks: 1 },
      { id: 'RC02', stacks: 1 },
      { id: 'RC03', stacks: 1 },
      { id: 'RC04', stacks: 1 },
      { id: 'RC05', stacks: 1 },
    ];
    mutate(invalid);
    assert.throws(() => serializeRun(invalid), /equipment|build version|progress/i);
  }
});

test('build version and real run progress are required save data', () => {
  const game = make('v2-progress-save');
  assert.equal(game.state.buildVersion, 2);
  assert.deepEqual(game.state.progress, { coinsSpent: 0, eliteWins: 0, bossWins: 0 });
  const saved = JSON.parse(serializeRun(game));
  delete saved.state.buildVersion;
  assert.throws(() => parseRunSave(content, JSON.stringify(saved)), /build version/);

  const previousRules = structuredClone(game.state);
  previousRules.buildVersion = 1;
  assert.throws(() => parseRunSave(content, JSON.stringify(previousRules)), /build version/);
  assert.throws(() => validateRunState(content, previousRules), /build version/);

  for (const mutate of [
    state => { state.progress.coinsSpent = -1; },
    state => { state.progress.eliteWins = 0.5; },
    state => { state.progress.bossWins = Number.POSITIVE_INFINITY; },
  ]) {
    const corrupt = JSON.parse(serializeRun(game));
    mutate(corrupt.state);
    assert.throws(() => parseRunSave(content, JSON.stringify(corrupt)), /progress|non-finite/i);
  }
});

test('frozen journey context is validated in contentless and restored active battles', () => {
  const game = make('v2-frozen-journey-context');
  game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
  game.dispatch({ type: 'fight' });
  const parsed = JSON.parse(serializeRun(game));

  for (const key of ['coins', 'coinsSpent', 'eliteWins', 'bossWins', 'artifactKinds', 'knownMethods']) {
    const changed = structuredClone(parsed);
    changed.state.battleInput.player.journey[key] += 1;
    assert.throws(() => parseRunSave(content, JSON.stringify(changed)), /journey context/);

    const contentless = structuredClone(game.state);
    contentless.battleInput.player.journey[key] += 1;
    assert.throws(() => serializeRun(contentless), /journey context/);
  }

  const missing = structuredClone(parsed);
  delete missing.state.battleInput.player.journey;
  assert.throws(() => parseRunSave(content, JSON.stringify(missing)), /journey context/);
});

test('a selected shared talent remains valid after the active method and draft generation change', () => {
  const game = make('v2-historical-talent');
  game.state.xp = 120;
  game.state.phase = 'talent';
  game.state._talentQueue = [{ method: 'RKF01', tier: 1, advance: true }];
  game.availableTalents();
  const selectedShared = game.state.talentDrafts['RKF01:1:0'].find(id => id.startsWith('V2-J1-'));
  assert.ok(selectedShared);

  game.state.talents.RKF01 = [selectedShared];
  game.state._talentQueue = [];
  game.state.phase = 'map';
  game.state.n = 1;
  game.state.ownedMethods.push('RKF02');
  game.state.talents.RKF02 = [];
  game.state.method = 'RKF02';
  game.state.talentDraftGeneration = 1;

  const saved = serializeRun({ content, state: game.state });
  const restored = parseRunSave(content, saved);
  assert.deepEqual(restored.talents.RKF01, [selectedShared]);
});

test('a winning build records equipped artifacts rather than the owned inventory', () => {
  const game = make('v2-build-record');
  game.state.artifacts = [
    { id: 'RC01', stacks: 2 },
    { id: 'RC02', stacks: 1 },
    { id: 'RC09', stacks: 1 },
  ];
  game.state.equipment = { slots: ['RC09', 'RC01'] };
  game.state.phase = 'won';
  const store = storage();
  store.setItem('suishi-shanhai-build-v2-journey', 'legacy-v2-build-untouched');

  const record = saveWinningBuild(game, store);
  assert.deepEqual(record.artifacts, [
    { id: 'RC09', stacks: 1 },
    { id: 'RC01', stacks: 2 },
  ]);
  assert.deepEqual(loadWinningBuilds(store)[0].artifacts, record.artifacts);
  assert.equal(store.getItem('suishi-shanhai-build-v1'), null);
  assert.equal(store.getItem('suishi-shanhai-build-v2-journey'), 'legacy-v2-build-untouched');
});
