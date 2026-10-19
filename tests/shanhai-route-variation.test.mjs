import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';
import { isValidAct1RouteDistribution } from '../build/shanhai/route-map.js';

const loaded = await loadContent();
const content = {
  version: loaded.manifest.content_version,
  entities: loaded.entities,
  byId: loaded.byId,
  rules: loaded.entities.find(entity => entity.id === 'RULES'),
};

function make(seed) {
  return ShanhaiGame.create(content, { seed, name: '路线测试', method: 'RKF01' });
}

function setNode(node, type, id) {
  node.type = type;
  node.id = id;
  node.completed = false;
}

function minCommonBattlesOnPath(routeMap, key, memo = new Map()) {
  if (memo.has(key)) return memo.get(key);
  const node = routeMap.nodes.find(candidate => candidate.key === key);
  assert.ok(node, `missing route node ${key}`);
  const own = node.type === 'C' ? 1 : 0;
  const result = node.depth === 10
    ? own
    : own + Math.min(...node.next.map(next => minCommonBattlesOnPath(routeMap, next, memo)));
  memo.set(key, result);
  return result;
}

function canReachBossAvoiding(routeMap, excludedKeys) {
  const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
  const queue = routeMap.nodes.filter(node => node.depth === 0).map(node => node.key);
  const excluded = excludedKeys instanceof Set ? excludedKeys : new Set([excludedKeys]);
  const visited = new Set();
  while (queue.length) {
    const key = queue.shift();
    if (excluded.has(key) || visited.has(key)) continue;
    visited.add(key);
    const node = byKey.get(key);
    if (node?.depth === 10) return true;
    queue.push(...(node?.next ?? []));
  }
  return false;
}

function normalizeAsOldAct1Map(game) {
  const saved = structuredClone(game.state);
  const nodes = saved.routeMap.nodes;
  for (const node of nodes) {
    if ([2, 6, 8].includes(node.depth)) setNode(node, 'C', 'EN-A1-C1');
    if ([3, 5, 9].includes(node.depth)) setNode(node, 'C', 'EN-A1-C1');
  }

  const rest = nodes.find(node => node.depth === 3 && node.lane === 0);
  const shop = nodes.find(node => node.depth === 5 && node.lane === 0);
  const elite = nodes.find(node => node.depth === 9 && node.lane === 1);
  assert.ok(rest && shop && elite);
  setNode(rest, 'R', `R-A1-${rest.key}`);
  setNode(shop, 'S', `SHOP-A1-${shop.key}`);
  setNode(elite, 'L', 'EN-A1-L1');

  for (const depth of [1, 4, 7]) {
    const core = nodes.find(node => node.depth === depth && node.lane === 0);
    assert.ok(core);
    setNode(core, 'K', 'RK001');
  }
  return saved;
}

test('first-act cadence is seeded, frozen, and keeps common battles reachable', () => {
  const sameSeed = make('route-same-seed');
  const sameSeedReload = parseRunSave(content, serializeRun(sameSeed.state));
  assert.deepEqual(sameSeedReload.routeMap, sameSeed.state.routeMap);
  assert.deepEqual(make('route-same-seed').state.routeMap, sameSeed.state.routeMap);

  const cadences = new Map();
  for (let index = 0; index < 64 && cadences.size < 2; index++) {
    const game = make(`route-cadence-${index}`);
    const nodes = game.state.routeMap.nodes;
    if (nodes.some(node => node.type === 'L' && node.depth === 2)) {
      cadences.set('early_challenge', game);
    } else if (nodes.some(node => node.type === 'R' && node.depth === 6) &&
      nodes.some(node => node.type === 'S' && node.depth === 8)) {
      cadences.set('late_preparation', game);
    }
  }
  assert.deepEqual([...cadences.keys()].sort(), ['early_challenge', 'late_preparation']);

  for (const game of cadences.values()) {
    const nodes = game.state.routeMap.nodes;
    const byDepth = depth => nodes.filter(node => node.depth === depth);
    assert.equal(nodes.length, 29);
    assert.equal(byDepth(0)[0].type, 'C');
    assert.equal(byDepth(10)[0].type, 'B');
    for (const depth of [1, 4, 7]) {
      assert.equal(byDepth(depth).length, 3);
      assert.ok(byDepth(depth).every(node => ['E', 'K'].includes(node.type)));
    }
    assert.ok(nodes.filter(node => node.type === 'C').length >= 3);
    assert.ok(nodes.filter(node => node.type === 'R').length <= 1);
    assert.ok(nodes.filter(node => node.type === 'S').length <= 1);
    assert.ok(nodes.filter(node => node.type === 'L').length <= 2);
    assert.ok(nodes.filter(node => node.type === 'K').length <= 1);
    assert.ok(nodes.some(node => node.type === 'L' && node.depth >= 6));
    assert.ok(minCommonBattlesOnPath(game.state.routeMap, byDepth(0)[0].key) >= 3);
    assert.ok(canReachBossAvoiding(game.state.routeMap,
      new Set(nodes.filter(node => node.type === 'L').map(node => node.key))));
    for (const elite of nodes.filter(node => node.type === 'L')) {
      assert.ok(canReachBossAvoiding(game.state.routeMap, elite.key), `${elite.key} must be bypassable`);
    }
  }
});

test('one core opportunity is frozen and a locked follow-up is not backfilled', () => {
  const storyline = content.entities.find(entity =>
    entity.kind === 'storyline' && Array.isArray(entity.encounters) && entity.encounters.length >= 2);
  assert.ok(storyline);
  const [first, second] = storyline.encounters;
  assert.ok(first && second);

  const state = structuredClone(make('core-opportunity').state);
  state.storyline = storyline.id;
  state._plannedStoryline = storyline.id;
  state.independentCore = null;
  state._independentCore = null;
  delete state.routeMap;
  delete state._routeMapVersion;
  delete state._routeMapLegacy;
  const game = new ShanhaiGame(content, state);
  const coreNodes = game.state.routeMap.nodes.filter(node => node.type === 'K');
  assert.equal(coreNodes.length, 1);
  assert.equal(coreNodes[0].id, first);
  assert.ok([1, 4, 7].includes(coreNodes[0].depth));

  const frozen = structuredClone(game.state.routeMap);
  game.state.completedCore.push(first);
  const firstEvent = content.byId.get(first);
  const unlockFlags = firstEvent.options.flatMap(option => Object.entries(option.set_flags ?? {})
    .filter(([, value]) => value === true)
    .map(([id]) => id));
  for (const flag of unlockFlags) game.state.flags[flag] = true;
  const reloaded = parseRunSave(content, serializeRun(game.state));
  assert.deepEqual(reloaded.routeMap, frozen);
  assert.equal(reloaded.routeMap.nodes.some(node => node.type === 'K' && node.id === second), false);
});

test('legacy first-act distributions load unchanged and invalid placement mixes are rejected', () => {
  const legacy = normalizeAsOldAct1Map(make('legacy-route-shape'));
  const loadedLegacy = parseRunSave(content, serializeRun(legacy));
  assert.deepEqual(loadedLegacy.routeMap, legacy.routeMap);
  assert.equal(loadedLegacy.routeMap.nodes.filter(node => node.type === 'K').length, 3);

  const invalid = structuredClone(legacy);
  const misplacedRest = invalid.routeMap.nodes.find(node => node.type === 'R');
  const displacedShop = invalid.routeMap.nodes.find(node => node.type === 'S');
  assert.ok(misplacedRest && displacedShop);
  setNode(misplacedRest, 'C', 'EN-A1-C1');
  setNode(displacedShop, 'C', 'EN-A1-C1');
  const lateShop = invalid.routeMap.nodes.find(node => node.depth === 8 && node.lane === 1);
  assert.ok(lateShop);
  setNode(lateShop, 'S', `SHOP-A1-${lateShop.key}`);
  assert.throws(() => parseRunSave(content, serializeRun(invalid)), /Invalid route map/);

  const lowBudget = structuredClone(legacy.routeMap.nodes);
  const byKey = new Map(lowBudget.map(node => [node.key, node]));
  const path = [];
  let cursor = byKey.get('a1-d0-l1');
  while (cursor) {
    path.push(cursor.key);
    if (cursor.depth === 10) break;
    cursor = byKey.get(cursor.next[0]);
  }
  assert.equal(byKey.get(path.at(-1)).depth, 10);
  for (const key of path.slice(1)) {
    const node = byKey.get(key);
    if (node.type === 'C') setNode(node, 'E', 'RE001');
  }
  assert.ok(lowBudget.filter(node => node.type === 'C').length >= 3);
  assert.equal(isValidAct1RouteDistribution(lowBudget, new Set(path)), false);
});

test('early elite remains optional and respects act and global extra-elite limits', () => {
  let game;
  for (let index = 0; index < 64; index++) {
    const candidate = make(`route-elite-${index}`);
    if (candidate.state.routeMap.nodes.some(node => node.type === 'L' && node.depth === 2)) {
      game = candidate;
      break;
    }
  }
  assert.ok(game, 'expected a seeded early-challenge map');
  const elites = game.state.routeMap.nodes.filter(node => node.type === 'L');
  assert.equal(elites.length, 2);
  const early = elites.find(node => node.depth === 2);
  assert.ok(early);
  assert.equal(game.nodeCanBeEntered(early), true);

  game.state._actEliteCount = 1;
  game.state.extraElites = 3;
  assert.equal(game.nodeCanBeEntered(early), false);
  game.state.extraElites = 0;
  assert.equal(game.nodeCanBeEntered(early), true);
  game.state._actEliteCount = 2;
  assert.equal(game.nodeCanBeEntered(early), false);
});

test('later acts retain their original template-bound core and service layers', () => {
  for (let index = 0; index < 16; index++) {
    const game = make(`later-act-core-${index}`);
    for (const act of [2, 3, 4]) {
      game.startAct(act);
      const nodes = game.state.routeMap.nodes;
      assert.ok(nodes.filter(node => node.type === 'K').every(node => node.depth === 1));
      assert.deepEqual(nodes.filter(node => node.type === 'R').map(node => node.depth), [3]);
      assert.deepEqual(nodes.filter(node => node.type === 'S').map(node => node.depth), [5]);
      assert.deepEqual(nodes.filter(node => node.type === 'L').map(node => node.depth), [9]);
    }
  }
});
