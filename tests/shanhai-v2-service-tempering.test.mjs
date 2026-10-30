import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker, validateRunState } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';

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

function make(seed) {
  installCombat();
  return ShanhaiGame.create(content, { seed, name: '休整温养测试', method: 'RKF01' });
}

function routeToService(game, type) {
  const routeNodes = game.state.routeMap.nodes;
  const target = routeNodes
    .filter(node => node.type === type)
    .sort((left, right) => left.depth - right.depth)[0];
  assert.ok(target, `the current act route must contain a ${type} node`);

  const path = [target];
  while (path[0].depth > 0) {
    const parent = routeNodes.find(node => node.next.includes(path[0].key));
    assert.ok(parent, `route node ${path[0].key} must have a reachable parent`);
    path.unshift(parent);
  }

  for (let index = 0; index < path.length; index++) {
    const planned = path[index];
    const reachable = game.availableNodes();
    assert.ok(reachable.some(node => node.key === planned.key),
      `route node ${planned.key} must be reachable through the live map`);
    game.dispatch({ type: 'enter', id: planned.key });

    if (index === path.length - 1) {
      assert.equal(game.state.phase, type === 'R' ? 'rest' : 'shop');
      return planned;
    }
    resolveRouteNode(game, planned);
  }

  assert.fail(`failed to reach a ${type} node`);
}

function resolveRouteNode(game, routeNode) {
  if (['C', 'L', 'B', 'F'].includes(routeNode.type)) {
    game.dispatch({ type: 'fight' });
    game.dispatch({ type: 'battle_done' });
    assert.equal(game.state.phase, 'reward');
    game.dispatch({ type: 'reward', id: null });
  } else if (routeNode.type === 'E' || routeNode.type === 'K') {
    const event = byId.get(routeNode.id);
    assert.ok(event?.options?.length, `route event ${routeNode.id} must have authored choices`);
    const option = event.options.find(candidate =>
      !candidate.rewards?.some(reward => reward.type === 'swap_method') &&
      game.optionAvailability(candidate.id).available);
    assert.ok(option, `route event ${routeNode.id} must have an available non-swap choice`);
    game.dispatch({ type: 'event', id: option.id });
    if (game.state.phase === 'preview') {
      game.dispatch({ type: 'fight' });
      game.dispatch({ type: 'battle_done' });
    }
    assert.equal(game.state.phase, 'event_result');
    game.dispatch({ type: 'continue' });
  } else {
    assert.fail(`unexpected ${routeNode.type} node before service`);
  }

  while (game.state.phase === 'talent') {
    const offered = game.availableTalents();
    assert.ok(offered.length, 'a pending breakthrough must offer at least one talent');
    game.dispatch({ type: 'talent', id: offered[0].id });
  }
  assert.equal(game.state.phase, 'map');
}

function setOwnedArtifact(game, id, stacks, equip = false) {
  const existing = game.state.artifacts.find(stack => stack.id === id);
  if (existing) existing.stacks = stacks;
  else game.state.artifacts.push({ id, stacks });

  if (equip && !game.state.equipment.slots.includes(id)) {
    game.state.equipment = { slots: [id] };
  }
  validateRunState(content, game.state);
}

function stackCount(game, id) {
  return game.state.artifacts.find(stack => stack.id === id)?.stacks ?? 0;
}

test('tempering adds one real artifact layer, charges the rest cost, and cannot replay after restore', () => {
  const game = make('v2-service-temper-save');
  routeToService(game, 'R');
  setOwnedArtifact(game, 'RC02', 1);
  assert.ok(game.warmableArtifacts().includes('RC02'));

  const cost = game.warmCost();
  game.state.coins = cost + 11;
  const coinsBefore = game.state.coins;
  const spentBefore = game.state.progress.coinsSpent;
  game.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC02' });

  assert.equal(stackCount(game, 'RC02'), 2);
  assert.equal(game.state.coins, coinsBefore - cost);
  assert.equal(game.state.progress.coinsSpent, spentBefore + cost);
  assert.equal(game.state.phase, 'map');
  validateRunState(content, game.state);

  const restored = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
  assert.equal(stackCount(restored, 'RC02'), 2);
  assert.equal(restored.state.coins, coinsBefore - cost);
  assert.equal(restored.state.progress.coinsSpent, spentBefore + cost);
  const restoredBeforeReplay = structuredClone(restored.state);
  assert.throws(
    () => restored.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC02' }),
    /Rest is not available/,
  );
  assert.deepEqual(restored.state, restoredBeforeReplay,
    'restoring a settled rest must not repeat its tempering charge or layer');
});

test('tempering can reach an authored awakening threshold and then respects the artifact cap', () => {
  const artifact = byId.get('RC01');
  assert.equal(artifact.max_stacks, 5);
  assert.equal(artifact.awakening.at_stacks, artifact.max_stacks);

  const game = make('v2-service-temper-awakening');
  routeToService(game, 'R');
  setOwnedArtifact(game, 'RC01', artifact.max_stacks - 1);
  game.state.coins = game.warmCost();
  assert.ok(game.warmableArtifacts().includes('RC01'));

  game.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC01' });
  assert.equal(stackCount(game, 'RC01'), artifact.awakening.at_stacks);
  assert.equal(stackCount(game, 'RC01'), artifact.max_stacks);
  assert.ok(!game.warmableArtifacts().includes('RC01'));
  validateRunState(content, game.state);

  const capped = make('v2-service-temper-at-cap');
  routeToService(capped, 'R');
  setOwnedArtifact(capped, 'RC01', artifact.max_stacks);
  capped.state.coins = capped.warmCost() + 1;
  assert.ok(!capped.warmableArtifacts().includes('RC01'));
  const before = structuredClone(capped.state);
  assert.throws(
    () => capped.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC01' }),
    /Artifact cannot be tempered/,
  );
  assert.deepEqual(capped.state, before, 'a capped artifact cannot gain an extra layer');
  validateRunState(content, capped.state);
});

test('insufficient coins and an illegal phase reject tempering atomically', () => {
  const poor = make('v2-service-temper-poor');
  routeToService(poor, 'R');
  setOwnedArtifact(poor, 'RC02', 1);
  const price = poor.warmCost();
  poor.state.coins = price - 1;
  const poorBefore = structuredClone(poor.state);
  assert.throws(
    () => poor.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC02' }),
    /Cannot afford tempering/,
  );
  assert.deepEqual(poor.state, poorBefore);
  validateRunState(content, poor.state);

  const wrongPhase = make('v2-service-temper-wrong-phase');
  setOwnedArtifact(wrongPhase, 'RC02', 1);
  wrongPhase.state.coins = wrongPhase.warmCost() + 1;
  const wrongPhaseBefore = structuredClone(wrongPhase.state);
  assert.throws(
    () => wrongPhase.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC02' }),
    /Rest is not available/,
  );
  assert.deepEqual(wrongPhase.state, wrongPhaseBefore);
  validateRunState(content, wrongPhase.state);
});

test('a real shop reforge consumes one equipped source layer, equips its replacement, and cannot repeat', () => {
  const game = make('v2-service-reforge-atomic');
  routeToService(game, 'S');
  setOwnedArtifact(game, 'RC01', 1, true);
  game.state.coins = 1000;
  const target = game.reforgeOptions('RC01')[0];
  assert.ok(target, 'the real common artifact pool must offer a reforge result');
  const price = game.reforgePrice();
  const coinsBefore = game.state.coins;
  const spentBefore = game.state.progress.coinsSpent;

  assert.deepEqual(game.reforgeAvailability('RC01', target), { available: true, reason: '' });
  game.dispatch({ type: 'reforge', source: 'RC01', target });

  assert.equal(stackCount(game, 'RC01'), 0);
  assert.equal(stackCount(game, target), 1);
  assert.ok(!game.state.equipment.slots.includes('RC01'));
  assert.ok(game.state.equipment.slots.includes(target));
  assert.equal(game.state.coins, coinsBefore - price);
  assert.equal(game.state.progress.coinsSpent, spentBefore + price);
  assert.deepEqual(game.reforgeAvailability('RC01', target), {
    available: false,
    reason: 'already-reforged',
  });
  validateRunState(content, game.state);

  const beforeRepeat = structuredClone(game.state);
  assert.throws(
    () => game.dispatch({ type: 'reforge', source: 'RC01', target }),
    /already-reforged/,
  );
  assert.deepEqual(game.state, beforeRepeat, 'a second reforge in the same shop must be atomic');
});
