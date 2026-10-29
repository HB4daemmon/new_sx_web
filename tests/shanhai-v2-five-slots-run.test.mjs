import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const buildDirectory = resolve(process.env.SHANHAI_V2_TEST_BUILD_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '../build/shanhai'));
const [{ ShanhaiGame, registerCombatWorker, validateRunState },
  { calculateStats, simulateBattle },
  { loadWinningBuilds, parseRunSave, saveWinningBuild, serializeRun }] = await Promise.all([
  import(pathToFileURL(join(buildDirectory, 'run.js')).href),
  import(pathToFileURL(join(buildDirectory, 'combat.js')).href),
  import(pathToFileURL(join(buildDirectory, 'persistence.js')).href),
]);

const loaded = await loadContent();
const entities = loaded.entities;
const byId = new Map(entities.map(entity => [entity.id, entity]));
const content = {
  version: loaded.manifest.content_version,
  entities,
  byId,
  rules: byId.get('RULES'),
};

const FIVE_ARTIFACTS = ['RC01', 'RC02', 'RC03', 'RC04', 'RC05'];
const SIX_ARTIFACTS = [...FIVE_ARTIFACTS, 'RC06'];

function installStubCombat() {
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

function installReplayCombat() {
  registerCombatWorker({ calculateStats, simulateBattle });
}

function make(seed = 'v2-five-slots') {
  installStubCombat();
  return ShanhaiGame.create(content, { seed, name: '五格试炼者', method: 'RKF01' });
}

function giveArtifacts(game, ids, equipped = []) {
  game.state.artifacts = ids.map(id => ({ id, stacks: 1 }));
  game.state.equipment = { slots: equipped.slice() };
}

function atomicFailure(game, command, error) {
  const before = structuredClone(game.state);
  assert.throws(() => game.dispatch(command), error);
  assert.deepEqual(game.state, before);
}

function nextBattleNode(game) {
  const node = game.availableNodes().find(candidate => ['C', 'L', 'B', 'F'].includes(candidate.type));
  assert.ok(node, 'a reachable battle node should be available');
  return node;
}

function enterBattle(game, node = nextBattleNode(game)) {
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  return node;
}

function enterPathToType(game, type) {
  const routeMap = game.state.routeMap;
  const target = routeMap.nodes.find(node => node.type === type);
  assert.ok(target, `act ${game.state.act} should include a ${type} node`);
  const path = [target];
  while (path[0].depth > 0) {
    const parent = routeMap.nodes.find(node => node.next.includes(path[0].key));
    assert.ok(parent, `route path should reach ${target.key}`);
    path.unshift(parent);
  }
  const ancestors = new Set(path.slice(0, -1).map(node => node.key));
  for (const node of routeMap.nodes) node.completed = ancestors.has(node.key);
  routeMap.path = path.map(node => node.key);
  game.state.nodes = path.map((_node, index) => ({
    type: path[index].type,
    id: path[index].id,
    completed: index < path.length - 1,
  }));
  game.state.step = path.length - 1;
  game.state.phase = 'map';
  game.state.nodeEntry = undefined;
  game.state._nodeEntry = undefined;
  game.dispatch({ type: 'enter', id: target.key });
  return target;
}

test('artifact rewards fill all five equipped slots and keep the sixth in the backpack', () => {
  const game = make('five-slot-reward-acquisition');
  game.state.n = 4;

  for (const [index, id] of SIX_ARTIFACTS.entries()) {
    if (index > 0) game.startAct(1);
    const node = nextBattleNode(game);
    enterBattle(game, node);
    game.dispatch({ type: 'battle_done' });
    assert.equal(game.state.phase, 'reward');
    game.state.rewardCandidates = [id];
    game.dispatch({ type: 'reward', id });
  }

  assert.deepEqual(game.state.equipment.slots, FIVE_ARTIFACTS);
  assert.deepEqual(game.state.artifacts.map(stack => stack.id), SIX_ARTIFACTS);
  assert.deepEqual(game.equippedArtifacts().map(stack => stack.id), FIVE_ARTIFACTS);

  game.startAct(1);
  game.dispatch({ type: 'equip', id: 'RC06', replace: 'RC03' });
  assert.deepEqual(game.state.equipment.slots, ['RC01', 'RC02', 'RC06', 'RC04', 'RC05']);
  assert.equal(game.state.artifacts.some(stack => stack.id === 'RC03'), true,
    'replacement leaves the displaced artifact in the backpack');
  atomicFailure(game, { type: 'equip', id: 'RC03' }, /full/i);
});

test('reorder accepts only editable phases and rejects invalid commands atomically', () => {
  const editablePhases = ['map', 'reward', 'shop', 'rest', 'transition'];
  for (const phase of editablePhases) {
    const game = make(`reorder-allowed-${phase}`);
    giveArtifacts(game, FIVE_ARTIFACTS, FIVE_ARTIFACTS);
    game.state.phase = phase;
    assert.equal(game.canChangeEquipment(), true);
    game.dispatch({ type: 'reorder_equipment', id: 'RC03', direction: 'left' });
    assert.deepEqual(game.state.equipment.slots, ['RC01', 'RC03', 'RC02', 'RC04', 'RC05']);
  }

  const lockedPhases = ['route', 'preview', 'battle', 'event', 'event_result', 'talent', 'won', 'lost'];
  for (const phase of lockedPhases) {
    const game = make(`reorder-locked-${phase}`);
    giveArtifacts(game, FIVE_ARTIFACTS, FIVE_ARTIFACTS);
    game.state.phase = phase;
    assert.equal(game.canChangeEquipment(), false);
    atomicFailure(game,
      { type: 'reorder_equipment', id: 'RC03', direction: 'left' },
      /equipment cannot change now/i);
  }

  const failures = [
    [{ type: 'reorder_equipment', id: 'RC01', direction: 'left' }, /edge/i],
    [{ type: 'reorder_equipment', id: 'RC05', direction: 'right' }, /edge/i],
    [{ type: 'reorder_equipment', id: 'RC03', direction: 'up' }, /direction/i],
    [{ type: 'reorder_equipment', id: 'RC06', direction: 'left' }, /not owned/i],
    [{ type: 'reorder_equipment', id: 'RC03', direction: 'left', extra: true }, /invalid equipment reorder/i],
  ];
  for (const [command, error] of failures) {
    const game = make(`reorder-invalid-${String(command.direction)}`);
    giveArtifacts(game, FIVE_ARTIFACTS, FIVE_ARTIFACTS);
    atomicFailure(game, command, error);
  }

  const unequipped = make('reorder-owned-backpack-artifact');
  giveArtifacts(unequipped, SIX_ARTIFACTS, FIVE_ARTIFACTS);
  atomicFailure(unequipped,
    { type: 'reorder_equipment', id: 'RC06', direction: 'left' },
    /not equipped/i);

  const unownedEquipped = make('reorder-unowned-equipped-id');
  giveArtifacts(unownedEquipped, FIVE_ARTIFACTS, ['RC06', 'RC02', 'RC03', 'RC04', 'RC05']);
  atomicFailure(unownedEquipped,
    { type: 'reorder_equipment', id: 'RC06', direction: 'right' },
    /not owned/i);
});

test('reorder changes only slot order; back, entry snapshots, battle input, save and replay preserve order', () => {
  installReplayCombat();
  const game = ShanhaiGame.create(content, {
    seed: 'five-slot-order-replay', name: '五格试炼者', method: 'RKF01',
  });
  giveArtifacts(game, FIVE_ARTIFACTS, FIVE_ARTIFACTS);

  const node = nextBattleNode(game);
  game.dispatch({ type: 'enter', id: node.key });
  const entrySnapshot = structuredClone(game.state.nodeEntry);
  assert.deepEqual(entrySnapshot.artifacts.map(stack => stack.id), FIVE_ARTIFACTS);
  game.dispatch({ type: 'back' });
  assert.equal(game.state.phase, 'map');

  const beforeReorder = structuredClone(game.state);
  game.dispatch({ type: 'reorder_equipment', id: 'RC02', direction: 'right' });
  const expectedAfterReorder = structuredClone(beforeReorder);
  expectedAfterReorder.equipment.slots = ['RC01', 'RC03', 'RC02', 'RC04', 'RC05'];
  assert.deepEqual(game.state, expectedAfterReorder,
    'reorder does not change HP, coins, route layers, rewards, enemy state, or travel snapshots');
  assert.deepEqual(game.state.nodeEntry, entrySnapshot);
  assert.deepEqual(game.state._nodeEntry, entrySnapshot);
  assert.deepEqual(game.player.artifacts.map(stack => stack.id), expectedAfterReorder.equipment.slots);

  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  const battleOrder = ['RC01', 'RC03', 'RC02', 'RC04', 'RC05'];
  assert.deepEqual(game.state.battleInput.player.artifacts.map(stack => stack.id), battleOrder);

  const saved = serializeRun(game);
  const savedRecord = JSON.parse(saved);
  assert.equal(savedRecord.replay, 'deterministic-input-v1');
  const restoredState = parseRunSave(content, saved);
  assert.deepEqual(restoredState.battleInput.player.artifacts.map(stack => stack.id), battleOrder);
  assert.deepEqual(restoredState.battleInput, game.state.battleInput);
  assert.deepEqual(restoredState.battle, game.state.battle,
    'deterministic replay uses the frozen artifact order');
  assert.deepEqual(restoredState.nodeEntry, entrySnapshot);

  const fiveOnBothSides = JSON.parse(saved);
  delete fiveOnBothSides.replay;
  fiveOnBothSides.state.battleInput.enemy.artifacts = FIVE_ARTIFACTS.map(id => ({ id, stacks: 1 }));
  const loadedEnemyFive = parseRunSave(content, JSON.stringify(fiveOnBothSides));
  assert.deepEqual(loadedEnemyFive.battleInput.enemy.artifacts.map(stack => stack.id), FIVE_ARTIFACTS);

  for (const side of ['player', 'enemy']) {
    const sixArtifactLoadout = structuredClone(fiveOnBothSides);
    sixArtifactLoadout.state.battleInput[side].artifacts.push({ id: 'RC06', stacks: 1 });
    assert.throws(() => parseRunSave(content, JSON.stringify(sixArtifactLoadout)), /saved loadout|equipment slots/i,
      `${side} loadouts must reject a sixth equipped artifact`);
  }

  const sixRunSlots = structuredClone(fiveOnBothSides);
  sixRunSlots.state.artifacts.push({ id: 'RC06', stacks: 1 });
  sixRunSlots.state.equipment.slots.push('RC06');
  assert.throws(() => parseRunSave(content, JSON.stringify(sixRunSlots)), /equipment/i,
    'saved run equipment must reject a sixth slot');

  const buildGame = make('five-slot-winning-build');
  giveArtifacts(buildGame, FIVE_ARTIFACTS, FIVE_ARTIFACTS);
  buildGame.state.phase = 'won';
  const buildStorage = {
    value: null,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
    removeItem() { this.value = null; },
  };
  const winningBuild = saveWinningBuild(buildGame, buildStorage);
  assert.deepEqual(winningBuild.artifacts.map(stack => stack.id), FIVE_ARTIFACTS);
  assert.deepEqual(loadWinningBuilds(buildStorage)[0].artifacts.map(stack => stack.id), FIVE_ARTIFACTS);
  const invalidBuild = structuredClone(winningBuild);
  invalidBuild.artifacts.push({ id: 'RC06', stacks: 1 });
  buildStorage.value = JSON.stringify([invalidBuild]);
  assert.throws(() => loadWinningBuilds(buildStorage), /build records/i,
    'saved winning builds must reject a sixth equipped artifact');
});

test('fusion consumes an equipped material, auto-fills the fifth slot, and stays valid with thunder', () => {
  const game = make('five-slot-fusion-thunder');
  giveArtifacts(game,
    ['RC14', 'RC15', 'RC02', 'RC03', 'RC04', 'RC05'],
    ['RC14', 'RC02', 'RC03', 'RC04', 'RC05']);

  enterBattle(game);
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.fusionStatus().find(item => item.id === 'RL06').wins, 1);
  game.dispatch({ type: 'reward', id: null });
  game.startAct(2);

  const elite = enterPathToType(game, 'L');
  assert.equal(game.canThunderChallenge(), true);
  game.dispatch({ type: 'thunder_challenge', enabled: true });
  game.dispatch({ type: 'fight' });
  assert.equal(game.state.battleInput.enemy.thunderChallenge, true);
  game.dispatch({ type: 'battle_done' });

  assert.equal(game.state.phase, 'reward');
  assert.equal(game.state._thunderChallenge, true);
  assert.equal(game.state.fusionHistory.some(record => record.id === 'RL06'), true);
  assert.equal(game.state.artifacts.some(stack => stack.id === 'RC14'), false);
  assert.equal(game.state.artifacts.some(stack => stack.id === 'RC15'), false);
  assert.deepEqual(game.state.equipment.slots, ['RC02', 'RC03', 'RC04', 'RC05', 'RL06']);
  assert.equal(game.state.equipment.slots.length, 5);
  assert.equal(game.state.thunderChallenges.at(-1).enemyId, elite.id);

  const restored = parseRunSave(content, serializeRun(game));
  assert.equal(restored._thunderChallenge, true);
  assert.deepEqual(restored.equipment.slots, game.state.equipment.slots);
  assert.equal(restored.fusionHistory.some(record => record.id === 'RL06'), true);
  validateRunState(content, restored);
});
