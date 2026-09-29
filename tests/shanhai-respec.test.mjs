import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import {
  loadRun,
  parseRunSave,
  saveRun,
  serializeRun,
} from '../build/shanhai/persistence.js';

const loaded = await loadContent();
const content = {
  version: loaded.manifest.content_version,
  entities: loaded.entities,
  byId: loaded.byId,
  rules: loaded.entities.find(entity => entity.id === 'RULES'),
};

function installCombat() {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player) {
      return {
        outcome: 'player',
        rounds: 1,
        playerHp: player.hp ?? 1,
        enemyHp: 0,
        frames: [],
        contributions: [],
      };
    },
  });
}

function storage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

function method(methodId) {
  return content.byId.get(methodId);
}

function talentsFor(methodId, n, firstTierId) {
  return Array.from({ length: n }, (_value, index) => {
    const tier = index + 1;
    const choices = method(methodId).talents.filter(talent => talent.tier === tier);
    return tier === 1 && firstTierId
      ? firstTierId
      : choices[0].id;
  });
}

function resolveCurrentNode(game) {
  let guard = 0;
  while (game.state.phase !== 'map' && !['won', 'lost'].includes(game.state.phase) && guard++ < 32) {
    if (game.state.phase === 'preview') game.dispatch({ type: 'fight' });
    else if (game.state.phase === 'battle') game.dispatch({ type: 'battle_done' });
    else if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    else if (game.state.phase === 'event') {
      const event = content.byId.get(game.node.id);
      const option = event.options.find(candidate =>
        !candidate.encounter && game.optionAvailability(candidate).available) ??
        event.options.find(candidate => game.optionAvailability(candidate).available);
      assert.ok(option, `expected ${event.id} to expose an available option`);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    else if (game.state.phase === 'shop') game.dispatch({ type: 'leave_shop' });
    else if (game.state.phase === 'rest') game.dispatch({ type: 'rest', choice: 'heal' });
    else if (game.state.phase === 'talent') {
      const choice = game.availableTalents()[0];
      assert.ok(choice, 'talent phase should expose a choice');
      game.dispatch({ type: 'talent', id: choice.id });
    } else if (game.state.phase === 'transition') game.dispatch({ type: 'continue' });
    else throw new Error(`Unhandled phase ${game.state.phase}`);
  }
  assert.ok(guard < 32, 'node did not resolve');
}

function openShop(game) {
  const route = game.state.routeMap;
  const byKey = new Map(route.nodes.map(node => [node.key, node]));
  const queue = game.availableNodes().map(node => [node.key]);
  const seen = new Set();
  let path;
  while (queue.length && !path) {
    const current = queue.shift();
    const key = current.at(-1);
    if (seen.has(key)) continue;
    seen.add(key);
    const node = byKey.get(key);
    if (node?.type === 'S') path = current;
    else for (const next of node?.next ?? []) queue.push([...current, next]);
  }
  assert.ok(path, 'expected a reachable shop');
  for (const key of path) {
    if (game.state.phase !== 'map') resolveCurrentNode(game);
    const target = game.availableNodes().find(node => node.key === key);
    assert.ok(target, `expected route node ${key} to be available`);
    game.dispatch({ type: 'enter', id: key });
    if (target.type === 'S') return target;
    resolveCurrentNode(game);
  }
  throw new Error('Shop was not reached');
}

function makeAtShop({ seed = 'respec-shop', methodId = 'RKF03', n = 4 } = {}) {
  installCombat();
  const game = ShanhaiGame.create(content, { seed, name: '洗髓测试', method: methodId });
  game.state.coins = 200;
  const shopNode = openShop(game);
  game.state.n = n;
  game.state.xp = content.rules.cultivation.cumulative[n - 1];
  game.state.talents[methodId] = talentsFor(methodId, n);
  game.state._talentQueue = [];
  game.state._returnPhase = undefined;
  game.state.returnPhase = undefined;
  return { game, shopNode };
}

function finishRespec(game) {
  while (game.state.phase === 'talent') {
    const choice = game.availableTalents()[0];
    assert.ok(choice, `expected a choice at n=${game.state.n}`);
    game.dispatch({ type: 'talent', id: choice.id });
  }
}

test('shop freezes one 40-coin talent reset item and empty or unaffordable purchases are atomic', () => {
  installCombat();
  const game = ShanhaiGame.create(content, { seed: 'respec-empty', name: '测试者', method: 'RKF01' });
  game.state.coins = 100;
  const shopNode = openShop(game);
  const reset = game.state.shop.find(item => item.kind === 'talent_reset');
  assert.deepEqual(reset, { id: 'talent_reset', kind: 'talent_reset', price: 40, sold: false });

  for (const state of [
    { n: 0, xp: 0, talents: [] },
    { n: 2, xp: 600, talents: [] },
  ]) {
    game.state.n = state.n;
    game.state.xp = state.xp;
    game.state.talents.RKF01 = state.talents;
    const before = structuredClone(game.state);
    assert.throws(() => game.dispatch({ type: 'buy', id: 'talent_reset' }), /No earned talents/);
    assert.deepEqual(game.state, before);
  }

  game.state.n = 1;
  game.state.xp = 120;
  game.state.talents.RKF01 = ['RKF01-J1-A'];
  game.state.coins = 39;
  const beforeUnaffordable = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'buy', id: 'talent_reset' }), /Cannot afford/);
  assert.deepEqual(game.state, beforeUnaffordable);

  game.state.coins = 40;
  game.dispatch({ type: 'back' });
  assert.throws(() => game.dispatch({ type: 'buy', id: 'talent_reset' }), /Shop is not open/);
  game.dispatch({ type: 'enter', id: shopNode.key });
  assert.equal(game.state.shop.find(item => item.id === 'talent_reset')?.sold, false);
  assert.equal(game.state.phase, 'shop');
});

test('respec repicks every earned tier, saves halfway, and returns to the same shop without node settlement', () => {
  const { game, shopNode } = makeAtShop({ seed: 'respec-four-tiers' });
  game.state.ownedMethods.push('RKF02');
  game.state.talents.RKF02 = talentsFor('RKF02', 4);
  game.state.firstStrike = 7;
  game.state.preparation = 55;
  const originalMethodTalents = [...game.state.talents.RKF03];
  const originalOtherTalents = [...game.state.talents.RKF02];
  const originalEntry = structuredClone(game.state.nodeEntry);
  const originalHistory = structuredClone(game.state.history);
  const originalTravel = structuredClone(game.state._travelSnapshots);
  const originalXp = game.state.xp;
  const originalN = game.state.n;
  const originalCoins = game.state.coins;
  game.state.hp = game.stats.max_hp - 20;
  const hpBefore = game.state.hp;
  const store = storage();

  game.dispatch({ type: 'buy', id: 'talent_reset' });
  assert.equal(game.state.phase, 'talent');
  assert.equal(game.state.coins, originalCoins - 40);
  assert.equal(game.state.shop.find(item => item.id === 'talent_reset')?.sold, true);
  assert.deepEqual(game.state.talents.RKF03, []);
  assert.deepEqual(game.state.talents.RKF02, originalOtherTalents);
  assert.equal(game.state.n, originalN);
  assert.equal(game.state.hp, hpBefore);
  assert.equal(game.state.xp, originalXp);
  assert.equal(game.state.preparation, 55);
  assert.equal(game.state.firstStrike, 7);
  assert.deepEqual(game.state.nodeEntry, originalEntry);
  assert.deepEqual(game.state.history, originalHistory);
  assert.deepEqual(game.state._travelSnapshots, originalTravel);
  assert.deepEqual(game.state._talentQueue.map(item => [item.method, item.tier, item.advance]), [
    ['RKF03', 1, false],
    ['RKF03', 2, false],
    ['RKF03', 3, false],
    ['RKF03', 4, false],
  ]);
  assert.equal(game.state._returnPhase, 'shop');

  const firstChoice = game.availableTalents().find(talent =>
    talent.id !== originalMethodTalents.find(id =>
      method('RKF03').talents.find(item => item.id === id).tier === 1));
  assert.ok(firstChoice);
  game.dispatch({ type: 'talent', id: firstChoice.id });
  assert.equal(game.state.n, originalN);
  assert.equal(game.state._talentQueue.length, 3);
  saveRun(game, store);
  let resumed = loadRun(content, store);
  assert.equal(resumed.state.phase, 'talent');
  assert.equal(resumed.state._returnPhase, 'shop');
  assert.equal(resumed.state._talentQueue.length, 3);

  finishRespec(resumed);
  assert.equal(resumed.state.phase, 'shop');
  assert.equal(resumed.state.n, originalN);
  assert.equal(resumed.state.coins, originalCoins - 40);
  assert.equal(resumed.state.talents.RKF03.length, originalN);
  assert.deepEqual(resumed.state.talents.RKF03.map(id =>
    method('RKF03').talents.find(talent => talent.id === id).tier).sort(), [1, 2, 3, 4]);
  assert.deepEqual(resumed.state.talents.RKF02, originalOtherTalents);
  assert.equal(resumed.state.shop.find(item => item.id === 'talent_reset')?.sold, true);
  assert.deepEqual(resumed.state.nodeEntry, originalEntry);
  assert.equal(resumed.node.type, 'S');
  assert.equal(resumed.node.completed, false);
  saveRun(resumed, store);
  const afterCompletion = structuredClone(resumed.state);
  assert.throws(() => resumed.dispatch({ type: 'buy', id: 'talent_reset' }), /Unknown or sold/);
  assert.deepEqual(resumed.state, afterCompletion);

  resumed.dispatch({ type: 'back' });
  resumed.dispatch({ type: 'enter', id: shopNode.key });
  assert.equal(resumed.state.phase, 'shop');
  assert.equal(resumed.state.shop.find(item => item.id === 'talent_reset')?.sold, true);
});

test('reset clamps lost max HP without healing and preserves all non-target method trees', () => {
  const { game } = makeAtShop({ seed: 'respec-clamp', methodId: 'RKF03', n: 4 });
  const otherMethodTalents = talentsFor('RKF02', 4);
  game.state.ownedMethods.push('RKF02');
  game.state.talents.RKF02 = [...otherMethodTalents];
  game.state.talents.RKF03 = talentsFor('RKF03', 4, 'RKF03-J1-C');
  const hpBoostedMax = game.stats.max_hp;
  assert.ok(hpBoostedMax > game.player.baseStats.max_hp);
  game.state.hp = hpBoostedMax - 1;
  const previousHp = game.state.hp;

  game.dispatch({ type: 'buy', id: 'talent_reset' });
  assert.equal(game.state.hp, game.player.baseStats.max_hp);
  assert.ok(game.state.hp < previousHp);
  const clampedHp = game.state.hp;

  while (game.state.phase === 'talent') {
    const choices = game.availableTalents();
    const choice = choices.find(talent => talent.tier !== 1 || talent.id !== 'RKF03-J1-C');
    assert.ok(choice);
    game.dispatch({ type: 'talent', id: choice.id });
    assert.ok(game.state.hp <= game.stats.max_hp);
  }
  assert.equal(game.state.hp, clampedHp);
  assert.deepEqual(game.state.talents.RKF02, otherMethodTalents);
  assert.equal(game.state.n, 4);
});

test('respec does not auto-advance from surplus XP after the earned tiers are replaced', () => {
  const { game } = makeAtShop({ seed: 'respec-surplus-xp', methodId: 'RKF01', n: 2 });
  game.state.xp = content.rules.cultivation.cumulative[2];
  game.dispatch({ type: 'buy', id: 'talent_reset' });
  assert.deepEqual(game.state._talentQueue.map(item => [item.tier, item.advance]), [
    [1, false],
    [2, false],
  ]);

  finishRespec(game);
  assert.equal(game.state.phase, 'shop');
  assert.equal(game.state.n, 2);
  assert.equal(game.state._talentQueue.length, 0);
  assert.equal(game.state._returnPhase, undefined);
});

test('combat phase purchases and malformed talent reset shop kinds are rejected', () => {
  installCombat();
  const game = ShanhaiGame.create(content, { seed: 'respec-combat', name: '测试者', method: 'RKF01' });
  game.state.coins = 100;
  game.state.phase = 'battle';
  const before = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'buy', id: 'talent_reset' }), /Shop is not open/);
  assert.deepEqual(game.state, before);

  const valid = JSON.parse(serializeRun(ShanhaiGame.create(content, {
    seed: 'respec-invalid-kind',
    name: '测试者',
    method: 'RKF01',
  })));
  valid.state.shop = [{ id: 'mystery', kind: 'mystery', price: 1, sold: false }];
  assert.throws(() => parseRunSave(content, JSON.stringify(valid)), /Invalid shop item/);

  valid.state.shop = [{ id: 'preparation', kind: 'talent_reset', price: 40, sold: false }];
  assert.throws(() => parseRunSave(content, JSON.stringify(valid)), /Invalid shop service/);
});
