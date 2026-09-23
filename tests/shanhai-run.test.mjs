import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import {
  ShanhaiGame,
  registerCombatWorker,
} from '../build/shanhai/run.js';
import {
  SHANHAI_SAVE_KEY,
  loadRun,
  loadWinningBuilds,
  parseRunSave,
  saveRun,
  saveWinningBuild,
  serializeRun,
} from '../build/shanhai/persistence.js';
import { nextCommand } from './shanhai-policy.mjs';

const loaded = await loadContent();
const content = {
  version: loaded.manifest.content_version,
  entities: loaded.entities,
  byId: loaded.byId,
  rules: loaded.entities.find(entity => entity.id === 'RULES'),
};

function storage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

function installCombat({ outcome = 'player', drawUntil = 0, playerHp = null, onBattle, onStats } = {}) {
  registerCombatWorker({
    calculateStats(_content, loadout) {
      onStats?.(structuredClone(loadout));
      return structuredClone(loadout.baseStats);
    },
    simulateBattle(_content, player, enemy, seed, options = {}) {
      onBattle?.({ player: structuredClone(player), enemy: structuredClone(enemy), seed, options: structuredClone(options) });
      const drawn = options.roundLimit < drawUntil;
      const result = drawn ? 'draw' : outcome;
      return {
        outcome: result,
        rounds: options.roundLimit,
        playerHp: result === 'enemy' ? (playerHp ?? 0) : (playerHp ?? player.hp ?? 500),
        enemyHp: result === 'player' ? 0 : 100,
        frames: [],
        contributions: [],
        reason: drawn ? 'round_limit' : undefined,
      };
    },
  });
}

function make(seed = 'run-test', method = 'RKF01') {
  return ShanhaiGame.create(content, { seed, name: '测试者', method });
}

function enterFirstBattle(game) {
  const first = game.availableNodes();
  assert.equal(first.length, 1);
  game.dispatch({ type: 'enter', id: first[0].key });
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
      const event = content.byId.get(game.node.id);
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
    if (['won', 'lost'].includes(game.state.phase)) break;
    const starts = game.availableNodes();
    const nodes = game.state.routeMap.nodes;
    const byKey = new Map(nodes.map(node => [node.key, node]));
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
    const key = path[0];
    const target = starts.find(node => node.key === key);
    assert.ok(target, 'planned node is no longer reachable');
    game.dispatch({ type: 'enter', id: target.key });
    if (predicate(target)) return target;
    resolveCurrentNode(game);
  }
  throw new Error('Node target was not reached');
}

function reachAct(game, act) {
  while (game.state.act < act) {
    assert.equal(game.state.phase, 'map');
    const previousAct = game.state.act;
    const boss = routeToNode(game, node => node.type === 'B');
    assert.equal(boss.type, 'B');
    resolveCurrentNode(game);
    assert.equal(game.state.act, previousAct + 1);
  }
  assert.equal(game.state.act, act);
}

function runToTerminal(game) {
  while (!['won', 'lost'].includes(game.state.phase)) {
    if (game.state.phase === 'map') game.dispatch(nextCommand(game, 'balanced'));
    else if (game.state.phase === 'preview') {
      game.dispatch({ type: 'fight' });
    } else if (game.state.phase === 'battle') {
      if (game.state.battle.outcome === 'draw') game.dispatch({ type: 'continue_battle' });
      else game.dispatch({ type: 'battle_done' });
    } else if (game.state.phase === 'reward') {
      game.dispatch({ type: 'reward', id: null });
    } else if (game.state.phase === 'event') {
      const event = content.byId.get(game.node.id);
      const option = event.options.find(candidate => game.optionAvailability(candidate).available);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') {
      game.dispatch({ type: 'continue' });
    } else if (game.state.phase === 'shop') {
      game.dispatch({ type: 'leave_shop' });
    } else if (game.state.phase === 'rest') {
      game.dispatch({ type: 'rest', choice: 'heal' });
    } else if (game.state.phase === 'talent') {
      game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
    } else if (game.state.phase === 'transition') {
      game.dispatch({ type: 'continue' });
    } else {
      throw new Error(`Unhandled phase ${game.state.phase}`);
    }
  }
}

test('new runs open a deterministic branching map without preselecting a route', () => {
  installCombat();
  const a = make('same-seed');
  const b = make('same-seed');
  assert.equal(a.state.phase, 'map');
  assert.deepEqual(a.state.routeMap, b.state.routeMap);
  assert.equal(a.state.routeMap.nodes.length, 29);
  assert.deepEqual(a.state.routeMap.path, []);
  assert.deepEqual(a.state.nodes, []);
  assert.deepEqual(a.state.routes, []);
  assert.equal(a.state.ordinaryCount, 0);
  assert.deepEqual(a.state._seenEnemyIds, []);
  assert.equal(a.availableNodes().length, 1);
  assert.throws(() => a.dispatch({ type: 'route', id: 'steady' }), /no longer selectable/);

  a.dispatch({ type: 'enter', id: a.availableNodes()[0].key });
  assert.equal(a.state.nodes.length, 1);
  assert.equal(a.state.ordinaryCount, 1);
  assert.equal(a.state._seenEnemyIds.length, 1);
  assert.equal(a.availableNodes().length, 0);
  a.dispatch({ type: 'back' });
  assert.equal(a.availableNodes().length, 1);
  a.dispatch({ type: 'enter', id: a.availableNodes()[0].key });
  assert.equal(a.state.ordinaryCount, 1);
  assert.equal(a.state._seenEnemyIds.length, 1);
});

test('only connected branch choices can be entered and the chosen path is retained', () => {
  installCombat();
  const left = make('branch-left');
  const right = make('branch-right');
  for (const game of [left, right]) {
    game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
    resolveCurrentNode(game);
    const next = game.availableNodes();
    assert.equal(next.length, 3);
    assert.ok(next.every(node => node.depth === 1));
    const skipped = game.state.routeMap.nodes.find(node => node.depth === 2);
    assert.ok(skipped);
    assert.throws(() => game.dispatch({ type: 'enter', id: skipped.key }), /not reachable/);
  }

  left.dispatch({ type: 'enter', id: left.availableNodes().find(node => node.lane === 0).key });
  right.dispatch({ type: 'enter', id: right.availableNodes().find(node => node.lane === 2).key });
  assert.equal(left.state.nodes.length, 2);
  assert.equal(right.state.nodes.length, 2);
  assert.notDeepEqual(left.state.routeMap.path, right.state.routeMap.path);
  assert.equal(left.state.routeMap.path.at(-1), 'a1-d1-l0');
  assert.equal(right.state.routeMap.path.at(-1), 'a1-d1-l2');
});

test('legacy linear saves retain only visited nodes and roll back future counters', () => {
  installCombat();
  const game = make('legacy-map-seed');
  const legacy = structuredClone(game.state);
  delete legacy.routeMap;
  delete legacy._routeMapVersion;
  delete legacy._routeMapLegacy;
  legacy.phase = 'map';
  legacy.step = 2;
  legacy.routes = ['steady'];
  legacy._routeHistory = ['steady'];
  legacy.nodes = [
    { type: 'C', id: 'EN-A1-C1', completed: true },
    { type: 'E', id: 'RE001', completed: true },
    { type: 'C', id: 'EN-A1-C2', completed: false },
    { type: 'E', id: 'RE002', completed: false },
    { type: 'C', id: 'EN-A1-C3', completed: false },
    { type: 'E', id: 'RE003', completed: false },
    { type: 'C', id: 'EN-A1-C4', completed: false },
    { type: 'E', id: 'RE004', completed: false },
    { type: 'E', id: 'RE005', completed: false },
    { type: 'E', id: 'RE006', completed: false },
    { type: 'B', id: 'EN-A1-B1', completed: false },
  ];
  legacy.ordinaryCount = legacy.nodes.filter(node => node.type === 'C' || node.type === 'E').length;
  legacy._seenEnemyIds = legacy.nodes
    .filter(node => ['C', 'L', 'B', 'F'].includes(node.type))
    .map(node => node.id);
  legacy._lastEnemyId = legacy._seenEnemyIds.at(-1);

  const migrated = parseRunSave(content, serializeRun(legacy));
  assert.equal(migrated._routeMapLegacy, true);
  assert.equal(migrated.nodes.length, 2);
  assert.deepEqual(migrated.routeMap.path, ['a1-d0-l1', 'a1-d1-l1']);
  assert.equal(migrated.ordinaryCount, 2);
  assert.deepEqual(migrated._seenEnemyIds, ['EN-A1-C1']);
});

test('the first elite in every act does not consume the extra elite allowance', () => {
  installCombat();
  const game = make('baseline-elites');
  game.state.extraElites = 3;
  for (let act = 1; act <= 4; act++) {
    reachAct(game, act);
    const target = routeToNode(game, node => node.type === 'L');
    assert.equal(game.state._actEliteCount, 1);
    assert.equal(game.state.extraElites, 3);
    game.dispatch({ type: 'back' });
    game.dispatch({ type: 'enter', id: target.key });
    assert.equal(game.state._actEliteCount, 1, 'reentry must not count the same elite twice');
    assert.equal(game.state.extraElites, 3);
    resolveCurrentNode(game);
  }
});

test('linear save migration preserves active phases and does not select a node during breakthrough', () => {
  installCombat();
  const game = make('legacy-active-boundaries');
  function checkMigration() {
    const before = structuredClone(game.state);
    const legacy = structuredClone(before);
    const unvisited = before.routeMap.nodes.filter(node => node.depth >= before.nodes.length && node.lane === 1)
      .map(({ type, id }) => ({ type, id, completed: false }));
    legacy.nodes.push(...unvisited);
    legacy.ordinaryCount += unvisited.filter(node => ['C', 'E'].includes(node.type)).length;
    legacy._seenEnemyIds.push(...unvisited.filter(node => ['C', 'L', 'B', 'F'].includes(node.type)).map(node => node.id));
    legacy._lastEnemyId = legacy._seenEnemyIds.at(-1);
    delete legacy.routeMap;
    delete legacy._routeMapVersion;
    delete legacy._routeMapLegacy;
    const migrated = parseRunSave(content, serializeRun(legacy));
    assert.equal(migrated.phase, before.phase);
    assert.equal(migrated.step, before.step);
    assert.deepEqual(migrated.nodes, before.nodes);
    assert.equal(migrated.hp, before.hp);
    assert.equal(migrated.ordinaryCount, before.ordinaryCount);
    assert.deepEqual(migrated.rewardCandidates, before.rewardCandidates);
  }
  game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
  checkMigration();
  game.dispatch({ type: 'fight' });
  checkMigration();
  game.dispatch({ type: 'battle_done' });
  checkMigration();
  game.state.xp = 120;
  game.dispatch({ type: 'reward', id: null });
  assert.equal(game.state.phase, 'talent');
  checkMigration();
  game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
  checkMigration();
});

test('save/reload keeps frozen map and does not touch the legacy key', () => {
  installCombat();
  const game = make('save-seed');
  game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
  const before = structuredClone(game.state);
  const store = storage();
  saveRun(game, store);
  assert.ok(store.getItem(SHANHAI_SAVE_KEY));
  const loadedGame = loadRun(content, store);
  assert.deepEqual(loadedGame.state.nodes, before.nodes);
  assert.deepEqual(loadedGame.state.routeMap, before.routeMap);
  assert.equal(loadedGame.state.phase, before.phase);
  assert.equal(store.getItem('fengshen-run'), null);
});

test('every major dispatch boundary survives serialize and reload', () => {
  installCombat();
  let game = make('boundary-seed');
  const store = storage();
  const reload = () => {
    saveRun(game, store);
    game = loadRun(content, store);
  };

  reload();
  assert.equal(game.state.phase, 'map');
  game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
  reload();
  assert.equal(game.state.phase, 'preview');
  game.dispatch({ type: 'fight' });
  reload();
  assert.equal(game.state.phase, 'battle');
  game.dispatch({ type: 'battle_done' });
  reload();
  assert.equal(game.state.phase, 'reward');
  game.dispatch({ type: 'reward', id: null });
  reload();
  assert.equal(game.state.phase, 'map');
});

test('shop inventory and node entry snapshot remain frozen across back and re-entry', () => {
  installCombat();
  const game = make('shop-freeze-seed');
  game.state.coins = 100;
  const shop = routeToNode(game, node => node.type === 'S');
  assert.equal(game.state.phase, 'shop');
  const beforeEntry = structuredClone(game.state.nodeEntry);
  const service = game.state.shop.find(item => item.kind === 'recovery');
  assert.ok(service);
  game.dispatch({ type: 'buy', id: service.id });
  assert.equal(game.state.shop.find(item => item.id === service.id)?.sold, true);
  game.dispatch({ type: 'back' });
  assert.equal(game.state.phase, 'map');
  assert.deepEqual(game.state.nodeEntry, beforeEntry);
  game.dispatch({ type: 'enter', id: shop.key });
  assert.equal(game.state.phase, 'shop');
  assert.equal(game.state.shop.find(item => item.id === service.id)?.sold, true);
  assert.deepEqual(game.state.nodeEntry, beforeEntry);
});

test('invalid event options and costs are atomic', () => {
  installCombat();
  const game = make('event-atomic');
  const routeNode = routeToNode(game, node => node.type === 'E' &&
    content.byId.get(node.id).options?.some(option => option.costs?.length));
  const event = content.byId.get(game.node.id);
  const paid = event.options.find(option => option.costs?.length);
  assert.ok(paid, `expected ${event.id} to expose a paid option`);
  const before = structuredClone(game.state);
  game.state.coins = 0;
  game.state.hp = 0;
  game.state.xp = 0;
  assert.throws(() => game.dispatch({ type: 'event', id: paid.id }));
  assert.equal(game.state.phase, before.phase);
  assert.equal(game.state.eventOption, before.eventOption);
  assert.equal(game.state.coins, 0);
});

test('draw continuation reuses the same input and seed without charging twice', () => {
  installCombat({ drawUntil: 400 });
  const game = make('draw-seed');
  enterFirstBattle(game);
  game.dispatch({ type: 'fight' });
  assert.equal(game.state.battle.outcome, 'draw');
  const input = structuredClone(game.state.battleInput);
  const coins = game.state.coins;
  game.dispatch({ type: 'continue_battle' });
  assert.equal(game.state.battleInput.seed, input.seed);
  assert.equal(game.state.battleInput.player.hp, input.player.hp);
  assert.equal(game.state.coins, coins);
  assert.equal(game.state.battleInput.roundLimit, 512);
  assert.equal(game.state.battle.outcome, 'player');
});

test('non-lethal encounter loss floors HP and grants no event reward', () => {
  installCombat();
  const game = make('nonlethal-seed');
  const routeNode = routeToNode(game, node => node.type === 'E' &&
    content.byId.get(node.id).options?.some(option => option.encounter));
  const event = content.byId.get(game.node.id);
  const option = event.options.find(candidate =>
    candidate.encounter && game.optionAvailability(candidate).available);
  assert.ok(option, `expected ${event.id} to expose an available encounter option`);
  const artifacts = structuredClone(game.state.artifacts);
  installCombat({ outcome: 'enemy', playerHp: 0 });
  game.dispatch({ type: 'event', id: option.id });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'event_result');
  assert.equal(game.state.hp, 1);
  assert.deepEqual(game.state.artifacts, artifacts);
  game.dispatch({ type: 'continue' });
  assert.equal(game.state.phase, 'map');
});

test('battle input keeps enemy HP initialization with the combat worker', () => {
  let seen;
  installCombat({
    onBattle(value) {
      seen = value;
    },
  });
  const game = make('enemy-hp-seed');
  enterFirstBattle(game);
  game.dispatch({ type: 'fight' });
  assert.ok(seen);
  assert.equal(seen.enemy.hp, undefined);
  assert.ok(seen.enemy.baseStats.max_hp > 0);
  assert.equal(game.state.battleInput.enemy.hp, undefined);
});

test('draw continuation doubles the horizon through 4096 and requires explicit retirement', () => {
  installCombat({ drawUntil: 5000 });
  const game = make('long-draw-seed');
  enterFirstBattle(game);
  game.dispatch({ type: 'fight' });
  for (const horizon of [256, 512, 1024, 2048, 4096]) {
    assert.equal(game.state.battle.outcome, 'draw');
    assert.equal(game.state.battleInput.roundLimit, horizon);
    if (horizon < 4096) game.dispatch({ type: 'continue_battle' });
  }
  assert.throws(() => game.dispatch({ type: 'continue_battle' }), /4096/);
  assert.equal(game.state.phase, 'battle');
  assert.equal(game.state.battleInput.roundLimit, 4096);
});

test('RKF05 prepares first strike on nodes 2 and 4, preserves it across a method swap, and consumes it once', () => {
  const battles = [];
  installCombat({
    onBattle(value) {
      battles.push(value);
    },
  });
  const game = make('first-strike-seed');
  game.state.ownedMethods.push('RKF05');
  game.state.talents.RKF05 = [];
  game.state.method = 'RKF05';
  const first = routeToNode(game, node => node.type === 'C');
  assert.equal(first.depth, 0);
  resolveCurrentNode(game);
  routeToNode(game, node => node.type === 'E');
  resolveCurrentNode(game);
  assert.ok(game.state.firstStrike > 0);

  const firstStrikeBattle = routeToNode(game, node => node.type === 'C');
  assert.equal(firstStrikeBattle.depth, 2);
  game.dispatch({ type: 'fight' });
  assert.equal(battles[0].player.firstStrike, 0);
  assert.ok(battles[1].player.firstStrike > 0);
  assert.equal(game.state.firstStrike, 0);
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  assert.equal(game.state.firstStrike, 0);

  const rest = routeToNode(game, node => node.type === 'R');
  assert.equal(rest.depth, 3);
  game.dispatch({ type: 'rest', choice: 'swap_method', method: 'RKF01' });
  assert.ok(game.state.firstStrike > 0);
  const secondStrikeBattle = routeToNode(game, node => node.type === 'C');
  assert.equal(secondStrikeBattle.depth, 5);
  game.dispatch({ type: 'fight' });
  assert.ok(battles[2].player.firstStrike > 0);
  assert.equal(game.state.firstStrike, 0);
});

test('preparation rewards and rest preparation are additive', () => {
  installCombat();
  const game = make('preparation-seed');
  const firstRest = routeToNode(game, node => node.type === 'R');
  assert.equal(firstRest.depth, 3);
  game.dispatch({ type: 'rest', choice: 'preparation' });
  const first = game.state.preparation;
  assert.ok(first > 0);
  reachAct(game, 2);
  const secondRest = routeToNode(game, node => node.type === 'R');
  assert.equal(secondRest.depth, 3);
  game.dispatch({ type: 'rest', choice: 'preparation' });
  assert.ok(game.state.preparation > first);
});

test('travel artifacts use their authored stack and max-hp parameters', () => {
  installCombat({ playerHp: 100 });
  const game = make('travel-artifacts-seed');
  game.state.artifacts = [
    { id: 'RC16', stacks: 2 },
    { id: 'RC17', stacks: 1 },
    { id: 'RC18', stacks: 3 },
    { id: 'RR06', stacks: 1 },
  ];
  const rest = routeToNode(game, node => node.type === 'R');
  assert.equal(rest.depth, 3);
  game.state.hp = 100;
  game.state.xp = 0;
  game.state.coins = 0;
  game.dispatch({ type: 'rest', choice: 'preparation' });
  assert.equal(game.state.xp, 26);
  assert.equal(game.state.coins, 6);
  assert.equal(game.state.hp, 102);
  routeToNode(game, node => node.type === 'C');
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  const afterBattle = game.state.hp;
  game.dispatch({ type: 'reward', id: null });
  assert.ok(game.state.hp > afterBattle);
  assert.ok(game.state.hp <= game.stats.max_hp);
});

test('RKF06 reduces one HP event cost and RKF08 refunds the actual paid amount', () => {
  const setup = method => {
    installCombat();
    let game;
    for (let seed = 0; seed < 20; seed++) {
      const candidate = make(`event-cost-${method}-${seed}`);
      candidate.state.ownedMethods.push(method);
      candidate.state.talents[method] = [];
      candidate.state.method = method;
      reachAct(candidate, 3);
      if (candidate.state.routeMap.nodes.some(node => node.type === 'E' && node.id === 'RE021')) {
        game = candidate;
        break;
      }
    }
    assert.ok(game, `expected to freeze RE021 on an act-three map for ${method}`);
    routeToNode(game, node => node.type === 'E' && node.id === 'RE021');
    assert.equal(game.state.method, method);
    game.state.hp = 500;
    return game;
  };
  const reduced = setup('RKF06');
  const reducedBefore = reduced.state.hp;
  reduced.dispatch({ type: 'event', id: 'RE021-A' });
  assert.equal(reduced.state.hp, reducedBefore - (0.15 * 950 * 0.85));

  const refunded = setup('RKF08');
  const refundedBefore = refunded.state.hp;
  refunded.dispatch({ type: 'event', id: 'RE021-A' });
  assert.equal(refunded.state.hp, refundedBefore - (0.15 * 950) + (0.08 * 950));
});

test('malformed serialized internals and outer save headers are rejected', () => {
  installCombat();
  const game = make('corrupt-save-seed');
  const store = storage();
  const valid = JSON.parse(serializeRun(game));

  const badHeader = structuredClone(valid);
  badHeader.key = 'wrong-key';
  store.setItem(SHANHAI_SAVE_KEY, JSON.stringify(badHeader));
  assert.throws(() => loadRun(content, store), /record header/);

  const badEdge = structuredClone(valid);
  badEdge.state.routeMap.nodes[0].next = ['a1-d2-l1'];
  assert.throws(() => parseRunSave(content, JSON.stringify(badEdge)), /Invalid route map/);

  const badPath = structuredClone(valid);
  badPath.state.routeMap.path = ['a1-d1-l0'];
  assert.throws(() => parseRunSave(content, JSON.stringify(badPath)), /Invalid route map/);

  const badQueue = structuredClone(valid);
  badQueue.state._talentQueue = [{ method: 'RKF99', tier: 1, advance: false }];
  store.setItem(SHANHAI_SAVE_KEY, JSON.stringify(badQueue));
  assert.throws(() => loadRun(content, store), /talent queue|method/);

  const badRoundLimit = structuredClone(valid);
  badRoundLimit.state.phase = 'battle';
  badRoundLimit.state._battleKind = 'node';
  badRoundLimit.state._battleNodeType = 'C';
  badRoundLimit.state.battleInput = {
    player: structuredClone(game.player),
    enemy: { name: 'enemy', method: 'RKF01', n: 0, talents: [], artifacts: [] },
    seed: 'bad',
    roundLimit: 8192,
  };
  badRoundLimit.state.battle = {
    outcome: 'draw',
    rounds: 1,
    playerHp: 1,
    enemyHp: 1,
    frames: [],
    contributions: [],
  };
  store.setItem(SHANHAI_SAVE_KEY, JSON.stringify(badRoundLimit));
  assert.throws(() => loadRun(content, store), /battle input|4096/);

  assert.throws(() => serializeRun({ ...game.state, firstStrike: Number.NaN }), /first strike|run resources|Non-finite/);
});

test('reward selection is single-use and respects artifact capacity', () => {
  installCombat();
  const game = make('reward-seed');
  enterFirstBattle(game);
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  const reward = game.state.rewardCandidates[0];
  game.dispatch({ type: 'reward', id: reward });
  assert.equal(game.state.artifacts.find(item => item.id === reward)?.stacks, 1);
  assert.throws(() => game.dispatch({ type: 'reward', id: reward }));

  const capped = make('capacity-seed');
  capped.state.artifacts = [{ id: 'RC01', stacks: 5 }];
  routeToNode(capped, node => node.type === 'C');
  capped.dispatch({ type: 'fight' });
  capped.dispatch({ type: 'battle_done' });
  capped.state.battle = {
    outcome: 'player',
    rounds: 1,
    playerHp: capped.state.hp,
    enemyHp: 0,
    frames: [],
    contributions: [],
  };
  capped.state.rewardCandidates = ['RC01'];
  assert.throws(() => capped.dispatch({ type: 'reward', id: 'RC01' }));
});

test('full deterministic winning run records the actual build once', () => {
  installCombat();
  const game = make('full-seed');
  runToTerminal(game);
  assert.equal(game.state.phase, 'won');
  const store = storage();
  const first = saveWinningBuild(game, store);
  const second = saveWinningBuild(game, store);
  assert.ok(first);
  assert.equal(first.buildId, second.buildId);
  assert.equal(loadWinningBuilds(store).length, 1);
});
