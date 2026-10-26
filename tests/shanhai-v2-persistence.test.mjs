import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import {
  SHANHAI_BUILD_KEY,
  SHANHAI_SAVE_KEY,
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

test('V2 saves use independent keys and never load or overwrite V1 records', () => {
  assert.equal(SHANHAI_SAVE_KEY, 'suishi-shanhai-run-v2');
  assert.equal(SHANHAI_BUILD_KEY, 'suishi-shanhai-build-v2');
  const store = storage();
  const oldRecord = JSON.stringify({
    schema: 1,
    key: 'suishi-shanhai-run-v1',
    contentVersion: 'shanhai-content-0.1',
    savedAt: '2026-10-01T00:00:00.000Z',
    state: { schema: 1, contentVersion: 'shanhai-content-0.1' },
  });
  store.setItem('suishi-shanhai-run-v1', oldRecord);
  assert.equal(loadRun(content, store), null);

  const game = make();
  saveRun(game, store);
  assert.equal(store.getItem('suishi-shanhai-run-v1'), oldRecord);
  assert.equal(JSON.parse(store.getItem(SHANHAI_SAVE_KEY)).key, SHANHAI_SAVE_KEY);
  assert.throws(() => parseRunSave(content, oldRecord), /V1.*cannot be loaded/);
});

test('equipment and frozen candidates round-trip and malformed snapshots are rejected', () => {
  const game = make('v2-strict-load');
  game.state.artifacts = [
    { id: 'RC01', stacks: 1 },
    { id: 'RC09', stacks: 1 },
  ];
  game.state.equipment = { core: 'RC09', support: ['RC01'] };
  game.state.xp = 120;
  game.state.phase = 'talent';
  game.state._talentQueue = [{ method: 'RKF01', tier: 1, advance: true }];
  game.availableTalents();

  const saved = serializeRun(game);
  const restored = parseRunSave(content, saved);
  assert.deepEqual(restored.equipment, { core: 'RC09', support: ['RC01'] });
  assert.deepEqual(restored.talentDrafts['RKF01:1:0'], game.state.talentDrafts['RKF01:1:0']);

  for (const corrupt of [
    state => { state.equipment.support = ['RC09']; },
    state => { state.equipment.core = 'RC10'; },
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
  assert.equal(offered.filter(id => id.startsWith('RKF01-J1-')).length, 2);
  assert.equal(offered.filter(id => id.startsWith('V2-J1-')).length, 1);
  assert.throws(() => parseRunSave(content, JSON.stringify(replacement)), /seed/);
});

test('contentless saves still enforce V2 version and owned equipment IDs', () => {
  const game = make('v2-contentless-save');
  const unownedEquipment = structuredClone(game.state);
  unownedEquipment.equipment.core = 'RC09';
  assert.throws(() => serializeRun(unownedEquipment), /equipment ownership/);

  const v1State = structuredClone(game.state);
  v1State.contentVersion = 'shanhai-content-0.1';
  assert.throws(() => serializeRun(v1State), /V2 save requires/);
  assert.throws(() => parseRunSave(content, JSON.stringify(v1State)), /Run\/content version mismatch/);
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
  game.state.equipment = { core: 'RC09', support: ['RC01'] };
  game.state.phase = 'won';
  const store = storage();

  const record = saveWinningBuild(game, store);
  assert.deepEqual(record.artifacts, [
    { id: 'RC09', stacks: 1 },
    { id: 'RC01', stacks: 2 },
  ]);
  assert.deepEqual(loadWinningBuilds(store)[0].artifacts, record.artifacts);
  assert.equal(store.getItem('suishi-shanhai-build-v1'), null);
});
