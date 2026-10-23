import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const buildDirectory = process.env.SHANHAI_BUILD_DIR;
const moduleUrl = name => buildDirectory
  ? pathToFileURL(resolve(buildDirectory, name)).href
  : new URL(`../build/shanhai/${name}`, import.meta.url).href;
const { createRouteMapNodes, isValidRouteDistribution, validateRouteMap } =
  await import(moduleUrl('route-map.js'));
const { ROUTE_PROFILES_BY_ACT, routeLayoutForAct } =
  await import(moduleUrl('route-profiles.js'));

const CORE_DEPTHS = [1, 4, 7];

function actEntity(act) {
  return { id: `RA0${act}`, kind: 'act', name: `第${act}幕` };
}

function setNode(node, type, id) {
  node.type = type;
  node.id = id;
  node.completed = false;
}

function makeProfileMap(act, layout, {
  includeExtraElite = true,
  includeLateElite = true,
  coreDepths = [1],
} = {}) {
  const nodes = createRouteMapNodes(act, () => ({
    type: 'C',
    id: `EN-A${act}-C1`,
    completed: false,
  }));
  const at = (depth, lane) => {
    const node = nodes.find(candidate => candidate.depth === depth && candidate.lane === lane);
    assert.ok(node, `missing slot ${depth}/${lane}`);
    return node;
  };

  setNode(at(10, 1), 'B', `EN-A${act}-B1`);
  for (const depth of CORE_DEPTHS) {
    for (const lane of [0, 1, 2]) {
      setNode(at(depth, lane), 'E', `RE-A${act}-${depth}`);
    }
    if (coreDepths.includes(depth)) setNode(at(depth, 0), 'K', `RK-A${act}-${depth}`);
  }
  setNode(at(layout.restDepth, 0), 'R', `R-A${act}-${layout.restDepth}`);
  setNode(at(layout.shopDepth, 0), 'S', `SHOP-A${act}-${layout.shopDepth}`);
  if (includeExtraElite && layout.extraEliteDepth !== null) {
    setNode(at(layout.extraEliteDepth, 0), 'L', `EN-A${act}-L1`);
  }
  if (includeLateElite) setNode(at(9, 1), 'L', `EN-A${act}-L2`);
  return { nodes, path: [] };
}

function validateEmptyProgress(map, act) {
  validateRouteMap(map, act, [], 0, 'route');
}

function reachableKeys(routeMap, startKey) {
  const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
  const queue = [startKey];
  const visited = new Set();
  while (queue.length) {
    const key = queue.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push(...(byKey.get(key)?.next ?? []));
  }
  return visited;
}

function minimumCommonBattles(routeMap, key = routeMap.nodes.find(node => node.depth === 0).key, memo = new Map()) {
  if (memo.has(key)) return memo.get(key);
  const node = routeMap.nodes.find(candidate => candidate.key === key);
  assert.ok(node, `missing node ${key}`);
  const own = node.type === 'C' ? 1 : 0;
  const result = node.depth === 10
    ? own
    : own + Math.min(...node.next.map(next => minimumCommonBattles(routeMap, next, memo)));
  memo.set(key, result);
  return result;
}

function oldFixedMap(act) {
  const map = makeProfileMap(act, {
    id: 'old',
    label: '旧分布',
    restDepth: 3,
    shopDepth: 5,
    extraEliteDepth: null,
  }, { includeExtraElite: false, includeLateElite: true, coreDepths: CORE_DEPTHS });
  const at = (depth, lane) => map.nodes.find(node => node.depth === depth && node.lane === lane);
  const rest = map.nodes.find(node => node.type === 'R');
  const shop = map.nodes.find(node => node.type === 'S');
  assert.ok(rest && shop && at(9, 1));
  rest.id = `R-A${act}-legacy`;
  shop.id = `SHOP-A${act}-legacy`;
  return map;
}

test('acts two through four select and freeze both authored route profiles by seed', () => {
  const profileSignatures = new Map();
  for (const act of [2, 3, 4]) {
    const entity = actEntity(act);
    const profiles = ROUTE_PROFILES_BY_ACT[act];
    assert.equal(profiles.length, 2);

    const signatures = new Set(profiles.map(profile =>
      `${profile.restDepth}/${profile.shopDepth}/${profile.extraEliteDepth}`));
    assert.equal(signatures.size, 2);
    profileSignatures.set(act, signatures);

    const observed = new Set();
    for (let index = 0; index < 256; index++) {
      const seed = `later-route-${act}-${index}`;
      const first = routeLayoutForAct(entity, seed);
      const repeat = routeLayoutForAct(entity, seed);
      assert.deepEqual(repeat, first);
      observed.add(first.id);
    }
    assert.deepEqual(observed, new Set(profiles.map(profile => profile.id)));
  }

  for (const firstAct of [2, 3, 4]) {
    for (const secondAct of [2, 3, 4]) {
      if (firstAct >= secondAct) continue;
      for (const signature of profileSignatures.get(firstAct)) {
        assert.equal(profileSignatures.get(secondAct).has(signature), false);
      }
    }
  }

  assert.equal(routeLayoutForAct({ id: 'RF01', kind: 'act', name: '終局' }, 'seed').id,
    'final_act_placeholder');
});

test('later profile maps retain graph reachability, optional elites, and three common battles on every route', () => {
  for (const act of [2, 3, 4]) {
    for (const profile of ROUTE_PROFILES_BY_ACT[act]) {
      const map = makeProfileMap(act, profile, { coreDepths: [1, 4, 7] });
      validateEmptyProgress(map, act);

      assert.equal(map.nodes.length, 29);
      assert.equal(map.nodes.find(node => node.depth === 0).type, 'C');
      assert.equal(map.nodes.find(node => node.depth === 10).type, 'B');
      assert.ok(CORE_DEPTHS.every(depth =>
        ['E', 'K'].includes(map.nodes.find(node => node.depth === depth && node.lane === 0).type)));
      assert.equal(map.nodes.filter(node => node.type === 'K').length, 3);
      assert.equal(map.nodes.filter(node => node.type === 'R').length, 1);
      assert.equal(map.nodes.filter(node => node.type === 'S').length, 1);
      assert.ok(map.nodes.filter(node => node.type === 'L').length <= 2);

      const reachable = reachableKeys(map, map.nodes.find(node => node.depth === 0).key);
      assert.equal(reachable.size, 29);
      for (const type of ['R', 'S']) {
        const service = map.nodes.find(node => node.type === type);
        assert.ok(reachable.has(service.key));
        assert.ok(service.next.some(next => reachableKeys(map, next).has(
          map.nodes.find(node => node.depth === 10).key)));
      }
      assert.ok(minimumCommonBattles(map) >= 3);

      const noExtra = makeProfileMap(act, profile, {
        includeExtraElite: false,
        includeLateElite: false,
        coreDepths: [1],
      });
      validateEmptyProgress(noExtra, act);
      assert.equal(noExtra.nodes.some(node => node.type === 'L'), false);
    }
  }
});

test('old fixed later-act distributions remain accepted', () => {
  for (const act of [2, 3, 4]) {
    validateEmptyProgress(oldFixedMap(act), act);
  }
});

test('first-act cadence and old fixed distribution remain accepted', () => {
  for (const profile of ROUTE_PROFILES_BY_ACT[1]) {
    validateEmptyProgress(makeProfileMap(1, profile), 1);
  }
  validateEmptyProgress(oldFixedMap(1), 1);
});

test('later route validation rejects duplicate services and misplaced event or boss nodes', () => {
  const act = 2;
  const profile = ROUTE_PROFILES_BY_ACT[act][0];
  const duplicateRest = makeProfileMap(act, profile);
  setNode(duplicateRest.nodes.find(node =>
    node.depth === profile.restDepth && node.lane === 1), 'R', 'R-A2-duplicate');
  assert.throws(() => validateEmptyProgress(duplicateRest, act), /Invalid route map/);

  const duplicateShop = makeProfileMap(act, profile);
  setNode(duplicateShop.nodes.find(node =>
    node.depth === profile.shopDepth && node.lane === 1), 'S', 'SHOP-A2-duplicate');
  assert.throws(() => validateEmptyProgress(duplicateShop, act), /Invalid route map/);

  const displacedRest = makeProfileMap(act, profile);
  setNode(displacedRest.nodes.find(node =>
    node.type === 'R'), 'C', 'EN-A2-C1');
  setNode(displacedRest.nodes.find(node =>
    node.depth === 8 && node.lane === 1), 'R', 'R-A2-displaced');
  assert.throws(() => validateEmptyProgress(displacedRest, act), /Invalid route map/);

  const tooManyElites = makeProfileMap(act, profile);
  setNode(tooManyElites.nodes.find(node => node.depth === 9 && node.lane === 0), 'L', 'EN-A2-L3');
  assert.throws(() => validateEmptyProgress(tooManyElites, act), /Invalid route map/);

  const misplacedEvent = makeProfileMap(act, profile);
  setNode(misplacedEvent.nodes.find(node => node.depth === 2 && node.lane === 1), 'E', 'RE-A2-invalid');
  assert.throws(() => validateEmptyProgress(misplacedEvent, act), /Invalid route map/);

  const misplacedBoss = makeProfileMap(act, profile);
  setNode(misplacedBoss.nodes.find(node => node.depth === 9 && node.lane === 0), 'B', 'EN-A2-B-invalid');
  assert.throws(() => validateEmptyProgress(misplacedBoss, act), /Invalid route map/);
});

test('legacy route-path compatibility keeps the common-battle floor', () => {
  const act = 2;
  const profile = ROUTE_PROFILES_BY_ACT[act][0];
  const map = makeProfileMap(act, profile);
  assert.equal(isValidRouteDistribution(act, map.nodes, new Set(map.nodes.map(node => node.key))), true);

  for (const depth of [2, 3, 5, 6]) {
    for (const node of map.nodes.filter(candidate => candidate.depth === depth)) {
      node.type = 'E';
    }
  }
  for (const node of map.nodes.filter(candidate => candidate.depth === 9)) {
    node.type = 'E';
  }
  assert.equal(isValidRouteDistribution(act, map.nodes, new Set(map.nodes.map(node => node.key))), false);
});
