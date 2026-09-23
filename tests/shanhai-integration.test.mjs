import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { contentFromEntities } from '../build/shanhai/content.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { loadWinningBuilds, parseRunSave, saveWinningBuild, serializeRun } from '../build/shanhai/persistence.js';
import { nextCommand } from './shanhai-policy.mjs';

const model = await loadContent();
const content = contentFromEntities(model.entities, model.manifest.content_version);

function installWinningCombat() {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player, _enemy, _seed, options = {}) {
      return {
        outcome: 'player',
        rounds: options.roundLimit ?? 256,
        playerHp: player.hp ?? 500,
        enemyHp: 0,
        frames: [],
        contributions: [],
      };
    },
  });
}

function installRealCombat() {
  registerCombatWorker({ calculateStats, simulateBattle });
}

function resolveCurrentNode(game) {
  let guard = 0;
  while (game.state.phase !== 'map' && !['won', 'lost'].includes(game.state.phase) && guard++ < 32) {
    if (game.state.phase === 'preview') game.dispatch({ type: 'fight' });
    else if (game.state.phase === 'battle') {
      if (game.state.battle.outcome === 'draw') game.dispatch({ type: 'continue_battle' });
      else game.dispatch({ type: 'battle_done' });
    } else if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    else if (game.state.phase === 'event') {
      const event = game.content.byId[game.node.id];
      const option = event.options.find(candidate =>
        !candidate.encounter &&
        !candidate.rewards?.some(reward => ['method', 'swap_method'].includes(reward.type)) &&
        game.optionAvailability(candidate).available) ??
        event.options.find(candidate =>
          !candidate.encounter && game.optionAvailability(candidate).available) ??
        event.options.find(candidate => game.optionAvailability(candidate).available);
      assert.ok(option, `expected ${event.id} to expose an available option`);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    else if (game.state.phase === 'shop') game.dispatch({ type: 'leave_shop' });
    else if (game.state.phase === 'rest') {
      if (game.state._restFromEvent) {
        const method = game.state.ownedMethods.find(id => id !== game.state.method);
        assert.ok(method, 'event offered a swap without another method');
        game.dispatch({ type: 'rest', choice: 'swap_method', method });
      } else game.dispatch({ type: 'rest', choice: 'heal' });
    } else if (game.state.phase === 'talent') {
      game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
    } else if (game.state.phase === 'transition') game.dispatch({ type: 'continue' });
    else throw new Error(`Unhandled phase ${game.state.phase}`);
  }
  assert.ok(guard < 32, 'node did not resolve');
}

function routeToNode(game, predicate) {
  for (let guard = 0; guard < 80; guard++) {
    if (game.state.phase !== 'map') resolveCurrentNode(game);
    assert.ok(!['won', 'lost'].includes(game.state.phase), 'run ended before reaching target node');
    const starts = game.availableNodes();
    const byKey = new Map(game.state.routeMap.nodes.map(node => [node.key, node]));
    const queue = starts.map(node => [node.key]);
    const seen = new Set();
    let path;
    while (queue.length && !path) {
      const current = queue.shift();
      const key = current.at(-1);
      if (seen.has(key)) continue;
      seen.add(key);
      const node = byKey.get(key);
      if (node && predicate(node)) path = current;
      else for (const next of node?.next ?? []) queue.push([...current, next]);
    }
    assert.ok(path, 'no reachable node matches the requested predicate');
    const target = starts.find(node => node.key === path[0]);
    assert.ok(target, 'planned node is no longer reachable');
    game.dispatch({ type: 'enter', id: target.key });
    if (predicate(target)) return target;
    resolveCurrentNode(game);
  }
  throw new Error('Node target was not reached');
}

function atRest(method = 'RKF01') {
  installWinningCombat();
  const game = ShanhaiGame.create(content, { seed: `travel-contract-${method}`, name: '旅行测试', method: 'RKF01' });
  game.state.ownedMethods = [...new Set(['RKF01', 'RKF02', method])];
  game.state.method = method;
  game.state.talents[method] = [];
  const rest = routeToNode(game, node => node.type === 'R');
  assert.equal(rest.depth, 3);
  game.state.hp = 100;
  return game;
}

test('all ten methods complete a reachable travel node using their authored effects', () => {
  for (const method of content.entities.filter(entity => entity.kind === 'method')) {
    const game = atRest(method.id);
    game.dispatch({ type: 'rest', choice: 'heal' });
    assert.ok(game.state.hp <= game.stats.max_hp && game.state.hp > 0, method.id);
    assert.doesNotThrow(() => parseRunSave(content, serializeRun(game)), method.id);
  }
});

test('RKF10 travel alternates healing and XP without consulting its combat phase', () => {
  const game = atRest('RKF10');
  game.state.xp = 0;
  game.state._methodTravelSequence = 'heal';
  game.dispatch({ type: 'rest', choice: 'heal' });
  const referenceHp = game.content.rules.economy.reference_hp_by_act[game.state.act - 1];
  assert.equal(game.state.hp, 100 + referenceHp * 0.25 + game.stats.max_hp * 0.08);
  assert.equal(game.state.xp, 0);
  assert.equal(game.state._methodTravelSequence, 'xp');

  routeToNode(game, node => node.type === 'E');
  const event = game.content.byId[game.node.id];
  const option = event.options.find(candidate =>
    !candidate.encounter &&
    !(candidate.costs ?? []).some(cost => ['hp', 'xp'].includes(cost.resource)) &&
    !(candidate.rewards ?? []).some(reward => ['hp', 'xp'].includes(reward.resource)) &&
    game.optionAvailability(candidate).available);
  assert.ok(option, `expected ${event.id} to offer a non-HP option`);
  game.state.hp = 100;
  const hp = game.state.hp;
  game.dispatch({ type: 'event', id: option.id });
  game.dispatch({ type: 'continue' });
  assert.equal(game.state.hp, hp);
  assert.equal(game.state.xp, 9);
  assert.equal(game.state._methodTravelSequence, 'heal');
});

test('real combat replays are saved as inputs and rebuilt exactly on reload', () => {
  installRealCombat();
  const game = ShanhaiGame.create(content, { seed: 'compact-save', name: '存档测试', method: 'RKF01' });
  game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
  game.dispatch({ type: 'fight' });
  const replay = structuredClone(game.state.battle);
  const save = serializeRun(game);
  const record = JSON.parse(save);
  assert.equal(record.replay, 'deterministic-input-v1');
  assert.equal(record.state.battle.frames.length, 0);
  assert.ok(save.length < 100000);
  assert.deepEqual(parseRunSave(content, save).battle, replay);
});

test('ordinary event results advance exactly one reachable node with real state and travel', () => {
  installWinningCombat();
  const game = ShanhaiGame.create(content, { seed: 'event-flow', name: '行者', method: 'RKF02' });
  routeToNode(game, node => node.type === 'E');
  const event = content.byId[game.node.id];
  const option = event.options.findLast(item =>
    !item.encounter && game.optionAvailability(item).available);
  assert.ok(option);
  game.dispatch({ type: 'event', id: option.id });
  assert.equal(game.state.phase, 'event_result');
  const oldStep = game.state.step;
  game.dispatch({ type: 'continue' });
  assert.equal(game.state.step, oldStep + 1);
  assert.equal(game.state.routeMap.path.length, game.state.nodes.length);
  assert.throws(() => game.dispatch({ type: 'continue' }));
});

test('a 45-node branching journey survives every save boundary and archives once', () => {
  installWinningCombat();
  let game = ShanhaiGame.create(content, { seed: 'acceptance-0', name: '贯通测试', method: 'RKF01' });
  let commands = 0;
  let crossedFinalEntry = false;
  while (!['won', 'lost'].includes(game.state.phase) && commands++ < 600) {
    const finalEntry = game.state.act === 4 && game.state.phase === 'transition';
    const before = structuredClone(game.state);
    game.dispatch(nextCommand(game, 'balanced'));
    const expected = JSON.parse(JSON.stringify(game.state));
    game = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
    assert.deepEqual(JSON.parse(JSON.stringify(game.state)), expected);
    if (game.state.phase === 'transition') {
      assert.equal(game.state.routeMap.path.length, 11);
      assert.equal(game.state.nodes.length, 11);
    }
    if (finalEntry) {
      crossedFinalEntry = true;
      assert.equal(game.state.act, 5);
      assert.equal(game.state.phase, 'map');
      assert.deepEqual(game.state.routes, []);
      assert.deepEqual(game.state._routeHistory, []);
      assert.equal(game.state.routeMap.nodes.length, 1);
      assert.deepEqual(game.state.routeMap.path, []);
      assert.equal(game.state.nodes.length, 0);
      assert.equal(game.availableNodes()[0].type, 'F');
      for (const resource of ['hp', 'xp', 'coins', 'preparation']) {
        assert.equal(game.state[resource], before[resource], resource);
      }
      assert.deepEqual(game.state.artifacts, before.artifacts);
    }
  }
  assert.ok(commands < 600);
  assert.equal(crossedFinalEntry, true);
  assert.equal(game.state.phase, 'won');
  assert.equal(game.state.history.length, 45);
  assert.equal(game.state.history.filter(entry => entry.act === 5).length, 1);
  assert.equal(game.state.routeMap.path.length, 1);
  assert.equal(game.state.routeMap.nodes[0].completed, true);
  const records = new Map();
  const storage = {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key),
  };
  saveWinningBuild(game, storage);
  saveWinningBuild(game, storage);
  const builds = loadWinningBuilds(storage);
  assert.equal(builds.length, 1);
  assert.equal(builds[0].runId, game.state.id);
  assert.deepEqual(builds[0].artifacts, game.state.artifacts);
  assert.deepEqual(builds[0].talents, game.state.talents[game.state.method]);
});
