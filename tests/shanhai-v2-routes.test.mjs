import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { isValidRouteDistribution, validateRouteMap } from '../build/shanhai/route-map.js';
import {
  ROUTE_PROFILES_BY_ACT,
  routeLayoutForAct,
  routeSegmentLabel,
} from '../build/shanhai/route-profiles.js';

const loaded = await loadContent();
const content = {
  version: loaded.manifest.content_version,
  entities: loaded.entities,
  byId: loaded.byId,
  rules: loaded.entities.find(entity => entity.id === 'RULES'),
};

function makeForAct(act, seed) {
  const game = ShanhaiGame.create(content, { seed, name: 'V2 路线测试', method: 'RKF01' });
  if (act === 1) return game;

  game.state.act = act;
  game.state.routeMap = { nodes: game.createRouteMap(), path: [] };
  return game;
}

function enumerateCompletePaths(routeMap) {
  const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
  const start = routeMap.nodes.find(node => node.depth === 0);
  assert.ok(start, 'route map has a start node');
  const paths = [];
  const visit = (node, path) => {
    const current = [...path, node];
    if (node.depth === 10) {
      paths.push(current);
      return;
    }
    for (const next of node.next) {
      const child = byKey.get(next);
      assert.ok(child, `${node.key} points to missing node ${next}`);
      visit(child, current);
    }
  };
  visit(start, []);
  return paths;
}

function assertRealMap(game, act, profile) {
  const routeMap = game.state.routeMap;
  assert.ok(routeMap);
  assert.equal(routeMap.nodes.length, 29);
  assert.deepEqual(routeMap.path, []);
  assert.equal(routeLayoutForAct(game.actContent, game.state.seed).id, profile.id);
  assert.equal(routeMap.nodes.find(node => node.depth === 0)?.type, 'C');
  assert.equal(routeMap.nodes.find(node => node.depth === 10)?.type, 'B');
  assert.equal(isValidRouteDistribution(act, routeMap.nodes), true);
  validateRouteMap(routeMap, act, [], 0, 'map');

  const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
  const reachable = new Set();
  const queue = [routeMap.nodes.find(node => node.depth === 0).key];
  while (queue.length) {
    const key = queue.shift();
    if (reachable.has(key)) continue;
    reachable.add(key);
    queue.push(...(byKey.get(key)?.next ?? []));
  }
  assert.equal(reachable.size, routeMap.nodes.length, `act ${act} ${profile.id}: every node reachable`);

  const paths = enumerateCompletePaths(routeMap);
  assert.equal(paths.length, 27, `act ${act} ${profile.id}: all three segment choices are represented`);
  assert.ok(paths.every(path => path.length === 11));
  const minimumNormalBattles = Math.min(...paths.map(path =>
    path.filter(node => node.type === 'C').length));
  assert.ok(minimumNormalBattles >= 3,
    `act ${act} ${profile.id}: all paths need three normal battles, got ${minimumNormalBattles}`);

  for (const [type, expectedDepth] of [['R', profile.restDepth], ['S', profile.shopDepth]]) {
    const services = routeMap.nodes.filter(node => node.type === type);
    assert.equal(services.length, 1, `act ${act} ${profile.id}: exactly one ${type} service`);
    assert.equal(services[0].depth, expectedDepth);
    assert.ok(paths.some(path => path.some(node => node.key === services[0].key)),
      `act ${act} ${profile.id}: ${type} service is reachable on a complete path`);
  }

  for (const elite of routeMap.nodes.filter(node => node.type === 'L')) {
    assert.ok(paths.some(path => !path.some(node => node.key === elite.key)),
      `${elite.key} is optional`);
  }
}

test('V2 lane segments expose depth labels for the route UI', () => {
  assert.equal(routeSegmentLabel(0), null);
  assert.equal(routeSegmentLabel(1), '第一段（第1-3步）');
  assert.equal(routeSegmentLabel(3), '第一段（第1-3步）');
  assert.equal(routeSegmentLabel(4), '第二段（第4-6步）');
  assert.equal(routeSegmentLabel(6), '第二段（第4-6步）');
  assert.equal(routeSegmentLabel(7), '第三段（第7-9步）');
  assert.equal(routeSegmentLabel(9), '第三段（第7-9步）');
  assert.equal(routeSegmentLabel(10), null);
});

test('real seeded routes keep all complete paths fair for every act and profile', () => {
  for (const act of [1, 2, 3, 4]) {
    const actEntity = content.byId.get(`RA0${act}`);
    assert.ok(actEntity);
    for (const profile of ROUTE_PROFILES_BY_ACT[act]) {
      let verifiedSeeds = 0;
      for (let index = 0; index < 256 && verifiedSeeds < 24; index++) {
        const seed = `v2-route-act-${act}-${profile.id}-${index}`;
        if (routeLayoutForAct(actEntity, seed).id !== profile.id) continue;
        assertRealMap(makeForAct(act, seed), act, profile);
        verifiedSeeds++;
      }
      assert.equal(verifiedSeeds, 24, `act ${act} ${profile.id} has enough deterministic seeds`);
    }
  }
});

test('V2 save validation rejects the previous adjacent-lane topology, including legacy paths', () => {
  const game = makeForAct(1, 'v2-route-topology-regression');
  const oldNodes = structuredClone(game.state.routeMap.nodes);
  for (const node of oldNodes) {
    let nextLanes;
    if (node.depth === 10) nextLanes = [];
    else if (node.depth === 0) nextLanes = [0, 1, 2];
    else if (node.depth === 9) nextLanes = [1];
    else if (node.lane === 0) nextLanes = [0, 1];
    else if (node.lane === 1) nextLanes = [0, 1, 2];
    else nextLanes = [1, 2];
    node.next = nextLanes.map(lane => `a1-d${node.depth + 1}-l${lane}`);
  }

  const start = oldNodes.find(node => node.depth === 0);
  assert.ok(start);
  const previousTopology = { nodes: oldNodes, path: [start.key] };
  assert.throws(
    () => validateRouteMap(previousTopology, 1, [{
      type: start.type,
      id: start.id,
      completed: start.completed,
    }], 0, 'map', true),
    /Invalid route map/,
  );
});
