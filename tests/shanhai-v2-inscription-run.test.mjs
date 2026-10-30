import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const buildDirectory = resolve(process.env.SHANHAI_V2_TEST_BUILD_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '../build/shanhai'));
const [{ calculateStats }, { ShanhaiGame, registerCombatWorker }, {
  SHANHAI_BUILD_KEY,
  loadWinningBuilds,
  parseRunSave,
  saveWinningBuild,
  serializeRun,
}] =
  await Promise.all([
    import(pathToFileURL(join(buildDirectory, 'combat.js')).href),
    import(pathToFileURL(join(buildDirectory, 'run.js')).href),
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

function installCombat() {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player) {
      const hp = player.hp ?? player.baseStats.max_hp;
      const fighter = {
        name: player.name,
        method: player.method,
        hp,
        maxHp: player.baseStats.max_hp,
        shield: player.preparation ?? 0,
        rage: 0,
        rageCap: 100,
        statuses: {},
      };
      return {
        outcome: 'player',
        rounds: 1,
        playerHp: hp,
        enemyHp: 0,
        frames: [{ round: 1, kind: 'action', text: '铭刻验收', player: fighter, enemy: { ...fighter, name: '对手' } }],
        contributions: [],
      };
    },
  });
}

function make(seed = 'v2-inscription') {
  installCombat();
  return ShanhaiGame.create(content, { seed, name: '铭刻行者', method: 'RKF01' });
}

function setShop(game, artifacts = [], equipment = []) {
  game.state.phase = 'shop';
  game.state.shop = [];
  game.state.artifacts = structuredClone(artifacts);
  game.state.equipment = { slots: equipment.slice() };
  game.state._shopInscribed = false;
}

function pathToShop(game) {
  const routeMap = game.state.routeMap;
  const shop = routeMap.nodes.find(node => node.type === 'S');
  assert.ok(shop, 'route should contain a shop');
  const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
  const visit = (key, path = []) => {
    const node = byKey.get(key);
    if (!node) return undefined;
    const current = [...path, key];
    if (key === shop.key) return current;
    for (const next of node.next) {
      const found = visit(next, current);
      if (found) return found;
    }
    return undefined;
  };
  const fullPath = routeMap.nodes.filter(node => node.depth === 0)
    .map(node => visit(node.key))
    .find(path => path !== undefined);
  assert.ok(fullPath, 'shop should be reachable from the route start');
  const prefix = fullPath.slice(0, -1);
  routeMap.path = prefix.slice();
  game.state.nodes = prefix.map(key => {
    const node = byKey.get(key);
    node.completed = true;
    return { type: node.type, id: node.id, completed: true };
  });
  game.state.step = prefix.length;
  game.state.phase = 'map';
  return shop.key;
}

function enterShop(game) {
  const id = pathToShop(game);
  game.dispatch({ type: 'enter', id });
  assert.equal(game.state.phase, 'shop');
}

function enterFight(game) {
  const node = game.availableNodes().find(candidate => ['C', 'L', 'B'].includes(candidate.type));
  assert.ok(node);
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
}

test('shop inscriptions charge the rounded half-price once, reject invalid uses, and survive backing out and saving', () => {
  const game = make('inscription-shop-rules');
  enterShop(game);
  game.state.artifacts = [
    { id: 'RC01', stacks: 1 },
    { id: 'RR01', stacks: 1 },
  ];
  game.state.equipment.slots = ['RR01'];
  const cost = Math.ceil(game.actContent.economy.shop.common_price * 0.5);
  game.state.coins = cost + 10;
  const initialSpent = game.state.progress.coinsSpent;
  assert.deepEqual(game.inscriptionOptions(), ['twin', 'leech', 'swift']);
  assert.equal(game.inscriptionPrice(), cost);
  assert.equal(game.inscriptionAvailability('RC01', 'twin').available, true);
  assert.equal(game.inscriptionAvailability('missing', 'twin').available, false);
  assert.equal(game.inscriptionAvailability('RR01', 'bad').reason, 'invalid-inscription');

  game.dispatch({ type: 'inscribe', artifact: 'RC01', inscription: 'twin' });
  assert.deepEqual(game.state.artifacts[0], { id: 'RC01', stacks: 1, inscription: 'twin' });
  assert.equal(game.state.coins, 10);
  assert.equal(game.state.progress.coinsSpent, initialSpent + cost);
  assert.equal(game.state._shopInscribed, true);
  assert.deepEqual(game.equippedArtifacts(), [{ id: 'RR01', stacks: 1 }]);
  assert.equal(game.inscriptionAvailability('RR01', 'leech').reason, 'already-inscribed-this-shop');

  const afterFirst = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'inscribe', artifact: 'RR01', inscription: 'leech' }), /already inscribed/i);
  assert.deepEqual(game.state, afterFirst, 'a second inscription must leave all state untouched');
  game.dispatch({ type: 'back' });
  assert.equal(game.inscriptionAvailability('RR01', 'leech').reason, 'not-shop');
  const sameShop = game.availableNodes().find(node => node.type === 'S');
  assert.ok(sameShop);
  game.dispatch({ type: 'enter', id: sameShop.key });
  assert.equal(game.inscriptionAvailability('RR01', 'leech').reason, 'already-inscribed-this-shop',
    'returning to the same shop must preserve its one-use marker');

  const saved = serializeRun(game);
  const restored = new ShanhaiGame(content, parseRunSave(content, saved));
  assert.equal(restored.state._shopInscribed, true);
  assert.deepEqual(restored.state.artifacts, game.state.artifacts);
  assert.equal(restored.inscriptionAvailability('RR01', 'leech').reason, 'already-inscribed-this-shop');

  restored.dispatch({ type: 'leave_shop' });
  restored.startAct(2);
  restored.state._shopInscribed = true;
  enterShop(restored);
  assert.equal(restored.state._shopInscribed, false, 'entering a new shop clears its one-use marker');
  restored.state.coins = cost;
  restored.state.artifacts.push({ id: 'RL06', stacks: 1 });
  restored.dispatch({ type: 'inscribe', artifact: 'RL06', inscription: 'swift' });
  assert.equal(restored.state.artifacts.find(stack => stack.id === 'RL06')?.inscription, 'swift',
    'legendary fusion outputs can be inscribed while held');

  const poor = make('inscription-poor');
  setShop(poor, [{ id: 'RR01', stacks: 1 }], ['RR01']);
  poor.state.coins = cost - 1;
  assert.equal(poor.inscriptionAvailability('RR01', 'leech').reason, 'cannot-pay');
  const poorState = structuredClone(poor.state);
  assert.throws(() => poor.dispatch({ type: 'inscribe', artifact: 'RR01', inscription: 'leech' }), /pay/i);
  assert.deepEqual(poor.state, poorState);

  poor.state.coins = cost;
  assert.throws(() => poor.dispatch({ type: 'inscribe', artifact: 'unowned', inscription: 'twin' }), /owned/i);
  assert.throws(() => poor.dispatch({ type: 'inscribe', artifact: 'RR01', inscription: 'invalid' }), /invalid inscription command/i);
  poor.state.phase = 'map';
  assert.throws(() => poor.dispatch({ type: 'inscribe', artifact: 'RR01', inscription: 'leech' }), /shop/i);
});

test('same-ID shop stacking keeps an inscription while reforge consumption drops it from the new artifact', () => {
  const stacked = make('inscription-stack');
  setShop(stacked, [{ id: 'RC01', stacks: 1, inscription: 'twin' }]);
  stacked.state.coins = 100;
  stacked.state.shop = [{ id: 'RC01', kind: 'artifact', price: 1, sold: false }];
  stacked.dispatch({ type: 'buy', id: 'RC01' });
  assert.deepEqual(stacked.state.artifacts, [{ id: 'RC01', stacks: 2, inscription: 'twin' }]);

  const reforged = make('inscription-reforge-source');
  setShop(reforged, [{ id: 'RC14', stacks: 1, inscription: 'leech' }]);
  reforged.state.coins = 100;
  const target = reforged.reforgeOptions('RC14')[0];
  assert.ok(target);
  reforged.dispatch({ type: 'reforge', source: 'RC14', target });
  assert.equal(reforged.state.artifacts.some(stack => stack.id === 'RC14'), false);
  assert.equal(reforged.state.artifacts.find(stack => stack.id === target)?.inscription, undefined);
});

test('equipped inscriptions freeze into battles and replays; consumed fusion sources leave the output uninscribed', () => {
  const battle = make('inscription-battle-replay');
  battle.state.artifacts = [
    { id: 'RC01', stacks: 1, inscription: 'twin' },
    { id: 'RC02', stacks: 1, inscription: 'leech' },
  ];
  battle.state.equipment.slots = ['RC01'];
  assert.deepEqual(battle.player.artifacts, [{ id: 'RC01', stacks: 1, inscription: 'twin' }]);
  const node = battle.availableNodes()[0];
  battle.dispatch({ type: 'enter', id: node.key });
  assert.deepEqual(battle.state.nodeEntry.artifacts, [{ id: 'RC01', stacks: 1, inscription: 'twin' }]);
  battle.dispatch({ type: 'fight' });
  assert.deepEqual(battle.state.battleInput.player.artifacts, [{ id: 'RC01', stacks: 1, inscription: 'twin' }]);
  const saved = serializeRun(battle);
  const replayed = new ShanhaiGame(content, parseRunSave(content, saved));
  assert.deepEqual(replayed.state.battleInput.player.artifacts, [{ id: 'RC01', stacks: 1, inscription: 'twin' }]);
  assert.deepEqual(replayed.state.battle, battle.state.battle);
  const malformedStateInscription = JSON.parse(saved);
  malformedStateInscription.state.artifacts[0].inscription = 'etched';
  assert.throws(() => parseRunSave(content, JSON.stringify(malformedStateInscription)), /inscription/i);
  const malformedBattleInscription = JSON.parse(saved);
  malformedBattleInscription.state.battleInput.player.artifacts[0].inscription = 'etched';
  assert.throws(() => parseRunSave(content, JSON.stringify(malformedBattleInscription)), /inscription/i);

  const archiveData = new Map();
  const archiveStorage = {
    getItem(key) { return archiveData.get(key) ?? null; },
    setItem(key, value) { archiveData.set(key, value); },
    removeItem(key) { archiveData.delete(key); },
  };
  battle.state.phase = 'won';
  const archive = saveWinningBuild(battle, archiveStorage);
  assert.deepEqual(archive.artifacts, [{ id: 'RC01', stacks: 1, inscription: 'twin' }]);
  assert.deepEqual(loadWinningBuilds(archiveStorage)[0].artifacts, archive.artifacts);
  const malformedArchive = JSON.parse(archiveStorage.getItem(SHANHAI_BUILD_KEY));
  malformedArchive[0].artifacts[0].inscription = 'etched';
  archiveStorage.setItem(SHANHAI_BUILD_KEY, JSON.stringify(malformedArchive));
  assert.throws(() => loadWinningBuilds(archiveStorage), /build records/i);

  const fused = make('inscription-fusion-consumption');
  fused.state.artifacts = [
    { id: 'RC14', stacks: 1, inscription: 'twin' },
    { id: 'RC15', stacks: 1, inscription: 'swift' },
  ];
  fused.state.equipment.slots = ['RC14', 'RC15'];
  enterFight(fused);
  assert.deepEqual(fused.state._fusionBattleEntry.inventory, fused.state.artifacts);
  fused.dispatch({ type: 'battle_done' });
  assert.deepEqual(fused.state.fusionProgress.find(record => record.id === 'RL06').wins[0].entryInventory, [
    { id: 'RC14', stacks: 1, inscription: 'twin' },
    { id: 'RC15', stacks: 1, inscription: 'swift' },
  ]);
  fused.dispatch({ type: 'reward', id: null });
  fused.startAct(2);
  enterFight(fused);
  fused.dispatch({ type: 'battle_done' });
  assert.equal(fused.state.artifacts.some(stack => ['RC14', 'RC15'].includes(stack.id)), false);
  assert.equal(fused.state.artifacts.find(stack => stack.id === 'RL06')?.inscription, undefined);
});
