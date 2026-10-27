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

test('V2 reaction saves leave V1, resonance and journey records isolated', () => {
  assert.equal(SHANHAI_SAVE_KEY, 'suishi-shanhai-run-v2-reactions');
  assert.equal(SHANHAI_BUILD_KEY, 'suishi-shanhai-build-v2-reactions');
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
  const oldResonanceRecord = JSON.parse(serializeRun(game));
  oldResonanceRecord.key = 'suishi-shanhai-run-v2-resonance';
  oldResonanceRecord.state.buildVersion = 2;
  const oldResonanceText = JSON.stringify(oldResonanceRecord);
  store.setItem('suishi-shanhai-run-v2-resonance', oldResonanceText);
  store.setItem('suishi-shanhai-build-v2-resonance', 'legacy-v2-resonance-build-untouched');
  store.setItem('suishi-shanhai-replay-v2-resonance', 'legacy-v2-resonance-replay-untouched');
  assert.equal(loadRun(content, store), null);
  assert.equal(hasSavedRun(store), false);
  assert.throws(() => parseRunSave(content, oldJourneyText), /invalid record header/);
  assert.throws(() => parseRunSave(content, oldResonanceText), /invalid record header/);

  saveRun(game, store);
  assert.equal(store.getItem('suishi-shanhai-run-v1'), oldRecord);
  assert.equal(store.getItem('suishi-shanhai-run-v2-journey'), oldJourneyText);
  assert.equal(store.getItem('suishi-shanhai-build-v2-journey'), 'legacy-v2-build-untouched');
  assert.equal(store.getItem('suishi-shanhai-replay-v2-journey'), 'legacy-v2-replay-untouched');
  assert.equal(store.getItem('suishi-shanhai-run-v2-resonance'), oldResonanceText);
  assert.equal(store.getItem('suishi-shanhai-build-v2-resonance'), 'legacy-v2-resonance-build-untouched');
  assert.equal(store.getItem('suishi-shanhai-replay-v2-resonance'), 'legacy-v2-resonance-replay-untouched');
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

test('contentless saves still enforce reaction build version and owned equipment IDs', () => {
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
    state => { state.buildVersion = 2; },
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

test('build version 3 and real run progress are required save data', () => {
  const game = make('v2-progress-save');
  assert.equal(game.state.buildVersion, 3);
  assert.deepEqual(game.state.progress, { coinsSpent: 0, eliteWins: 0, bossWins: 0 });
  const saved = JSON.parse(serializeRun(game));
  delete saved.state.buildVersion;
  assert.throws(() => parseRunSave(content, JSON.stringify(saved)), /build version/);

  const previousRules = structuredClone(game.state);
  previousRules.buildVersion = 2;
  assert.throws(() => parseRunSave(content, JSON.stringify(previousRules)), /build version/);
  assert.throws(() => validateRunState(content, previousRules), /build version/);
  assert.throws(() => serializeRun(previousRules), /build version/);

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

test('reward search records round-trip and contentless saves reject malformed records', () => {
  const game = make('v2-persistence-reward-search');
  game.state._coreRewardOffered = true;
  game.startAct(2);
  const node = game.availableNodes()[0];
  assert.equal(node.type, 'C');
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  game.state.rewardCandidates = ['RC01', 'RR01', 'RL01'];
  assert.equal(game.rewardSearchPreview('sword').available, true);
  game.dispatch({ type: 'seek_reward', family: 'sword' });

  const unresolvedSave = serializeRun(game);
  const unresolved = parseRunSave(content, unresolvedSave);
  assert.deepEqual(unresolved.rewardSearches, game.state.rewardSearches);
  assert.deepEqual(unresolved.rewardCandidates, game.state.rewardCandidates);

  game.dispatch({ type: 'reward', id: null });
  const resolved = parseRunSave(content, serializeRun(game));
  assert.deepEqual(resolved.rewardSearches, game.state.rewardSearches);
  assert.equal(resolved.rewardSearches[0].resolved, true);

  const validShape = structuredClone(game.state);
  validShape.rewardSearches = [{
    act: 1,
    step: 0,
    family: 'guard',
    cost: 8,
    candidates: ['RC01', 'RR01'],
    resolved: false,
  }];
  assert.doesNotThrow(() => serializeRun(validShape));

  const invalidRecords = [
    state => { delete state.rewardSearches; },
    state => { delete state.rewardSearches[0].family; },
    state => { state.rewardSearches[0].extra = true; },
    state => { state.rewardSearches[0].act = 0; },
    state => { state.rewardSearches[0].act = 5; },
    state => { state.rewardSearches[0].step = -1; },
    state => { state.rewardSearches[0].step = 11; },
    state => { state.rewardSearches[0].family = 'unknown'; },
    state => { state.rewardSearches[0].cost = 0; },
    state => { state.rewardSearches[0].cost = 1.5; },
    state => { state.rewardSearches[0].candidates = []; },
    state => { state.rewardSearches[0].candidates = ['RC01', 'RR01', 'RL01', 'RC02']; },
    state => { state.rewardSearches[0].candidates = ['RC01', 'RC01']; },
    state => { state.rewardSearches[0].candidates = ['']; },
    state => { state.rewardSearches[0].resolved = 1; },
    state => { state.rewardSearches.push(structuredClone(state.rewardSearches[0])); },
  ];
  for (const corrupt of invalidRecords) {
    const invalid = structuredClone(validShape);
    corrupt(invalid);
    assert.throws(() => serializeRun(invalid), /reward search/i);
  }

  const futureRecord = structuredClone(validShape);
  futureRecord.rewardSearches[0].act = futureRecord.act;
  futureRecord.rewardSearches[0].step = futureRecord.step + 1;
  assert.throws(() => serializeRun(futureRecord), /future reward search coordinate/);
});

test('enemy encounter IDs are non-empty and never appear on the player loadout', () => {
  const game = make('v2-encounter-shape');
  game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
  game.dispatch({ type: 'fight' });

  const playerEncounter = structuredClone(game.state);
  playerEncounter.battleInput.player.encounterId = 'EN-A1-B1';
  assert.throws(() => serializeRun(playerEncounter), /enemy encounter reference/);

  const emptyEnemyEncounter = structuredClone(game.state);
  emptyEnemyEncounter.battleInput.enemy.encounterId = '  ';
  assert.throws(() => serializeRun(emptyEnemyEncounter), /enemy encounter reference/);
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
  store.setItem('suishi-shanhai-build-v2-resonance', 'legacy-v2-resonance-build-untouched');

  const record = saveWinningBuild(game, store);
  assert.deepEqual(record.artifacts, [
    { id: 'RC09', stacks: 1 },
    { id: 'RC01', stacks: 2 },
  ]);
  assert.deepEqual(loadWinningBuilds(store)[0].artifacts, record.artifacts);
  assert.equal(store.getItem('suishi-shanhai-build-v1'), null);
  assert.equal(store.getItem('suishi-shanhai-build-v2-journey'), 'legacy-v2-build-untouched');
  assert.equal(store.getItem('suishi-shanhai-build-v2-resonance'), 'legacy-v2-resonance-build-untouched');
});
