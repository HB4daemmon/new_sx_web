import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker, simulateBattle, validateBattleResult } from '../build/shanhai/run.js';
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

function installCombat(outcome = 'player') {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player, enemy) {
      return {
        outcome,
        rounds: 1,
        playerHp: outcome === 'player' ? player.hp ?? player.baseStats.max_hp : 0,
        enemyHp: outcome === 'player' ? 0 : enemy.baseStats.max_hp,
        frames: [],
        contributions: [],
      };
    },
  });
}

function make(seed = 'v2-overhaul', currentContent = content, outcome = 'player') {
  installCombat(outcome);
  return ShanhaiGame.create(currentContent, { seed, name: '雷劫试炼者', method: 'RKF01' });
}

function prepareNode(game, act, type, idOverride) {
  game.startAct(act);
  const routeMap = game.state.routeMap;
  const target = routeMap.nodes.find(node => node.type === type);
  assert.ok(target, `act ${act} should include ${type}`);
  if (idOverride) target.id = idOverride;

  const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
  const path = [target];
  while (path[0].depth > 0) {
    const parent = routeMap.nodes.find(node => node.next.includes(path[0].key));
    assert.ok(parent, `route path must reach ${target.key}`);
    path.unshift(parent);
  }
  routeMap.path = path.map(node => node.key);
  for (let index = 0; index < path.length; index++) {
    const routeNode = byKey.get(path[index].key);
    routeNode.completed = index < path.length - 1;
  }
  game.state.nodes = path.map((node, index) => ({
    type: node.type,
    id: node.id,
    completed: index < path.length - 1,
  }));
  game.state.step = path.length - 1;
  game.state.phase = 'map';
  game.state.nodeEntry = undefined;
  game.state._nodeEntry = undefined;
  game.state._previewKind = undefined;
  game.state._battleKind = undefined;
  game.state._battleSettled = false;
  game.state._rewardSettled = false;
  game.state._eventSettled = false;
  game.state._pendingEvent = undefined;
  const mapSize = routeMap.path.length;
  game.dispatch({ type: 'enter', id: target.key });
  assert.equal(routeMap.path.length, mapSize);
  return target;
}

function withExhaustedArtifacts(rarities) {
  const copiedEntities = structuredClone(entities).map(entity => {
    if (entity.kind !== 'artifact') return entity;
    return { ...entity, max_stacks: 1, unique_group: entity.id };
  });
  const copiedById = new Map(copiedEntities.map(entity => [entity.id, entity]));
  return {
    ...content,
    entities: copiedEntities,
    byId: copiedById,
    rules: copiedById.get('RULES'),
    exhaustedArtifacts: copiedEntities.filter(entity =>
      entity.kind === 'artifact' && rarities.includes(entity.rarity)).map(entity => entity.id),
  };
}

function ownArtifacts(game, ids) {
  game.state.artifacts = ids.map(id => ({ id, stacks: 1 }));
  game.state.equipment = { slots: [] };
}

function assertInvalidCommandIsAtomic(game, command, pattern) {
  const before = structuredClone(game.state);
  assert.throws(() => game.dispatch(command), pattern);
  assert.deepEqual(game.state, before);
}

test('player companion follows acquisition order, changes with main method, and is owner-validated when frozen', () => {
  const game = make('companion-order');
  assert.equal(game.player.companion, undefined);
  game.state.ownedMethods.push('RKF02', 'RKF03');
  game.state.talents.RKF02 = [];
  game.state.talents.RKF03 = [];
  assert.equal(game.player.companion, 'RKF02');

  game.state.method = 'RKF02';
  assert.equal(game.player.companion, 'RKF01');
  prepareNode(game, 1, 'L');
  game.dispatch({ type: 'fight' });
  assert.equal(game.state.battleInput.player.method, 'RKF02');
  assert.equal(game.state.battleInput.player.companion, 'RKF01');
  assert.equal(game.state.battleInput.enemy.companion, undefined);
  assert.equal(game.state.battleInput.enemy.thunderChallenge, undefined);

  const saved = serializeRun(game);
  assert.equal(parseRunSave(content, saved).battleInput.player.companion, 'RKF01');
  for (const companion of ['RKF03', 'RKF04']) {
    const corrupt = JSON.parse(saved);
    corrupt.state.battleInput.player.companion = companion;
    assert.throws(() => parseRunSave(content, JSON.stringify(corrupt)), /companion/i);
  }
  const enemyCompanion = JSON.parse(saved);
  enemyCompanion.state.battleInput.enemy.companion = 'RKF01';
  assert.throws(() => serializeRun(enemyCompanion.state), /companion/i);
  assert.throws(() => parseRunSave(content, JSON.stringify(enemyCompanion)), /companion/i);
});

test('thunder challenge previews cover elite and boss nodes in acts 1-4 without changing 45 route steps', () => {
  let totalSteps = 0;
  for (let act = 1; act <= 4; act++) {
    const routeCheck = make(`route-length-${act}`);
    routeCheck.startAct(act);
    assert.deepEqual(
      [...new Set(routeCheck.state.routeMap.nodes.map(node => node.depth))].sort((a, b) => a - b),
      Array.from({ length: 11 }, (_value, index) => index),
    );
    totalSteps += 11;

    for (const type of ['L', 'B']) {
      const game = make(`challenge-preview-${act}-${type}`);
      const target = prepareNode(game, act, type);
      assert.equal(game.canThunderChallenge(), true);
      const nodesBefore = structuredClone(game.state.nodes);
      const pathBefore = game.state.routeMap.path.slice();
      game.dispatch({ type: 'thunder_challenge', enabled: true });
      assert.equal(game.state._thunderChallenge, true);
      assert.deepEqual(game.state.nodes, nodesBefore);
      assert.deepEqual(game.state.routeMap.path, pathBefore);

      game.dispatch({ type: 'back' });
      assert.equal(game.state._thunderChallenge, true, 'back to map keeps the node intent');
      const roundTrip = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
      assert.equal(roundTrip.state._thunderChallenge, true);
      roundTrip.dispatch({ type: 'enter', id: target.key });
      assert.equal(roundTrip.canThunderChallenge(), true);
      roundTrip.dispatch({ type: 'thunder_challenge', enabled: false });
      assert.equal(roundTrip.state._thunderChallenge, false);
      assert.deepEqual(roundTrip.state.nodes, nodesBefore);
      assert.deepEqual(roundTrip.state.routeMap.path, pathBefore);
    }
  }
  const finalAct = make('route-length-final');
  finalAct.startAct(5);
  assert.equal(finalAct.state.routeMap.nodes.length, 1);
  assert.equal(finalAct.state.routeMap.nodes[0].type, 'F');
  totalSteps += 1;
  assert.equal(totalSteps, 45);
});

test('wrong phases, normal nodes, events, and malformed challenge commands reject atomically', () => {
  const map = make('invalid-thunder-map');
  assert.equal(map.canThunderChallenge(), false);
  assertInvalidCommandIsAtomic(map, { type: 'thunder_challenge', enabled: true }, /unavailable/i);
  assertInvalidCommandIsAtomic(map, { type: 'thunder_challenge', enabled: 1 }, /invalid/i);

  const normal = make('invalid-thunder-normal');
  prepareNode(normal, 1, 'C');
  assert.equal(normal.canThunderChallenge(), false);
  assertInvalidCommandIsAtomic(normal, { type: 'thunder_challenge', enabled: true }, /unavailable/i);

  const event = make('invalid-thunder-event');
  prepareNode(event, 1, 'E', 'RE009');
  event.dispatch({ type: 'event', id: 'RE009-A' });
  assert.equal(event.state._previewKind, 'event');
  assert.equal(event.canThunderChallenge(), false);
  assertInvalidCommandIsAtomic(event, { type: 'thunder_challenge', enabled: true }, /unavailable/i);

  const active = make('invalid-thunder-after-fight');
  prepareNode(active, 1, 'L');
  active.dispatch({ type: 'thunder_challenge', enabled: true });
  active.dispatch({ type: 'fight' });
  assert.equal(active.canThunderChallenge(), false);
  assertInvalidCommandIsAtomic(active, { type: 'thunder_challenge', enabled: false }, /unavailable/i);
});

test('challenge saves freeze the modified enemy and offer a separate bonus only after the normal reward', () => {
  const seed = 'paired-thunder-save';
  const challenged = make(seed);
  const target = prepareNode(challenged, 2, 'L');
  const enemy = byId.get(target.id);
  const authoredStats = structuredClone(enemy.stats);
  const routeNodeCount = challenged.state.nodes.length;
  const routePath = challenged.state.routeMap.path.slice();
  const startingXp = challenged.state.xp;

  challenged.dispatch({ type: 'thunder_challenge', enabled: true });
  challenged.dispatch({ type: 'fight' });
  assert.equal(challenged.state.battleInput.enemy.thunderChallenge, true);
  assert.deepEqual(challenged.state.battleInput.enemy.baseStats, {
    ...authoredStats,
    max_hp: authoredStats.max_hp * 1.25,
  });
  assert.deepEqual(enemy.stats, authoredStats, 'authored enemy stats stay unchanged');
  assert.equal(challenged.state.nodes.length, routeNodeCount);
  assert.deepEqual(challenged.state.routeMap.path, routePath);

  const battleSave = serializeRun(challenged);
  const replayed = new ShanhaiGame(content, parseRunSave(content, battleSave));
  assert.deepEqual(replayed.state.battleInput, challenged.state.battleInput);
  assert.deepEqual(replayed.state.battle, challenged.state.battle);
  replayed.dispatch({ type: 'battle_done' });
  const baseXp = content.rules.economy.elite_xp_by_act[1];
  const xpBonus = baseXp * 0.5;
  assert.equal(replayed.state.xp, startingXp + baseXp + xpBonus);
  assert.equal(replayed.state._thunderRewardStage, 'normal');
  assert.equal(replayed.state.thunderChallenges[0].xpBonus, xpBonus);
  assert.equal(replayed.state.thunderChallenges[0].outcome, 'win');

  const normalReward = replayed.state.rewardCandidates[0];
  replayed.dispatch({ type: 'reward', id: normalReward ?? null });
  assert.equal(replayed.state._thunderRewardStage, 'bonus');
  assert.ok(replayed.state._thunderRewardCandidates.length > 0);
  assert.deepEqual(replayed.state.rewardCandidates, replayed.state._thunderRewardCandidates);
  assert.ok(replayed.state._thunderRewardCandidates.every(id => byId.get(id).rarity === 'rare'));
  const bonusStage = new ShanhaiGame(content, parseRunSave(content, serializeRun(replayed)));
  assert.equal(bonusStage.state._thunderRewardStage, 'bonus');
  assert.deepEqual(bonusStage.state._thunderRewardCandidates, replayed.state._thunderRewardCandidates);

  const bonusReward = bonusStage.state._thunderRewardCandidates[0];
  const normalCountBefore = bonusStage.state.artifacts.find(item => item.id === normalReward)?.stacks ?? 0;
  assert.notEqual(bonusReward, normalReward, 'the bonus offer excludes the settled normal reward');
  bonusStage.dispatch({ type: 'reward', id: bonusReward });
  assert.equal(bonusStage.state._thunderChallenge, false);
  assert.equal(bonusStage.state._thunderRewardStage, undefined);
  assert.equal(bonusStage.state.nodes.length, routeNodeCount);
  assert.equal(bonusStage.state.thunderChallenges[0].normalReward, normalReward ?? null);
  assert.equal(bonusStage.state.thunderChallenges[0].extraReward, bonusReward);
  assert.equal(bonusStage.state.artifacts.find(item => item.id === bonusReward)?.stacks, 1);
  if (normalReward) assert.equal(bonusStage.state.artifacts.find(item => item.id === normalReward)?.stacks, normalCountBefore);
  assert.match(bonusStage.state.history.at(-1).text, /雷劫应战/);
  assert.match(bonusStage.state.history.at(-1).text, /雷劫加赏/);
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(bonusStage)));
  const completed = structuredClone(bonusStage.state);
  assert.throws(() => bonusStage.dispatch({ type: 'reward', id: bonusReward }), /reward/i);
  assert.deepEqual(bonusStage.state, completed, 'the extra artifact is settled once');

  const unchallenged = make(seed);
  prepareNode(unchallenged, 2, 'L');
  unchallenged.dispatch({ type: 'fight' });
  assert.equal(unchallenged.state.battleInput.enemy.thunderChallenge, undefined);
  unchallenged.dispatch({ type: 'battle_done' });
  assert.equal(unchallenged.state.xp, startingXp + baseXp);
  assert.equal(unchallenged.state.thunderChallenges.length, 0);
  assert.equal(unchallenged.state._thunderRewardStage, undefined);
  assert.deepEqual(unchallenged.state.rewardCandidates, replayed.state.thunderChallenges[0].normalCandidates);

  bonusStage.startAct(3);
  prepareNode(bonusStage, 3, 'C');
  bonusStage.dispatch({ type: 'fight' });
  assert.equal(bonusStage.state._thunderChallenge, false);
  assert.equal(bonusStage.state.battleInput.enemy.thunderChallenge, undefined);
});

test('defeated thunder challenges grant no bonus XP or artifact and persist as failed attempts', () => {
  const game = make('thunder-defeat', content, 'enemy');
  prepareNode(game, 4, 'B');
  const startingXp = game.state.xp;
  game.dispatch({ type: 'thunder_challenge', enabled: true });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });

  assert.equal(game.state.phase, 'lost');
  assert.equal(game.state.xp, startingXp);
  assert.equal(game.state.rewardCandidates.length, 0);
  assert.deepEqual(game.state.thunderChallenges[0], {
    act: 4,
    step: game.state.step,
    nodeType: 'B',
    enemyId: game.state.nodes[game.state.step].id,
    outcome: 'loss',
    xpBonus: 0,
    normalCandidates: [],
    normalSettled: false,
    normalReward: null,
    extraRarity: null,
    extraInventory: [],
    extraCandidates: [],
    extraReward: null,
    fallbackCoins: 0,
  });
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(game)));
});

test('rare pool exhaustion falls back to legendary choices; exhausting both pools gives disclosed coins', () => {
  const rareExhausted = withExhaustedArtifacts(['rare']);
  const legendaryFallback = make('thunder-legendary-fallback', rareExhausted);
  prepareNode(legendaryFallback, 3, 'B');
  ownArtifacts(legendaryFallback, rareExhausted.exhaustedArtifacts);
  legendaryFallback.dispatch({ type: 'thunder_challenge', enabled: true });
  legendaryFallback.dispatch({ type: 'fight' });
  legendaryFallback.dispatch({ type: 'battle_done' });
  assert.deepEqual(legendaryFallback.state.rewardCandidates, []);
  legendaryFallback.dispatch({ type: 'reward', id: null });
  assert.equal(legendaryFallback.state._thunderRewardStage, 'bonus');
  assert.ok(legendaryFallback.state._thunderRewardCandidates.every(id => id.startsWith('RL')));
  const legendary = legendaryFallback.state._thunderRewardCandidates[0];
  legendaryFallback.dispatch({ type: 'reward', id: legendary });
  assert.equal(legendaryFallback.state.thunderChallenges[0].extraRarity, 'legendary');
  assert.equal(legendaryFallback.state.thunderChallenges[0].extraReward, legendary);
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(legendaryFallback)));

  const allExhausted = withExhaustedArtifacts(['rare', 'legendary']);
  const fallback = make('thunder-coins-fallback', allExhausted);
  prepareNode(fallback, 4, 'B');
  ownArtifacts(fallback, allExhausted.exhaustedArtifacts);
  fallback.dispatch({ type: 'thunder_challenge', enabled: true });
  fallback.dispatch({ type: 'fight' });
  fallback.dispatch({ type: 'battle_done' });
  const coinsBeforeRewards = fallback.state.coins;
  const artifactIdsBefore = fallback.state.artifacts.map(item => item.id).sort();
  fallback.dispatch({ type: 'reward', id: null });
  assert.equal(fallback.state.phase, 'talent', 'the challenge XP queues the earned talent before the act transition');
  assert.equal(fallback.state._returnPhase, 'transition');
  assert.ok(fallback.state._talentQueue.length > 0);
  assert.ok(fallback.availableTalents().length > 0);
  assert.equal(fallback.state._thunderRewardStage, undefined);
  assert.deepEqual(fallback.state._thunderRewardFallback, { type: 'coins', amount: 20 });
  assert.deepEqual(fallback.state.artifacts.map(item => item.id).sort(), artifactIdsBefore);
  assert.equal(fallback.state.coins, coinsBeforeRewards + (content.rules.economy.artifact_decline_coins ?? 4) + 20);
  assert.equal(fallback.state.thunderChallenges[0].fallbackCoins, 20);
  assert.match(fallback.state.resultText, /改得20灵石/);
  assert.match(fallback.state.history.at(-1).text, /改得20灵石/);
  const saved = serializeRun(fallback);
  const restored = new ShanhaiGame(allExhausted, parseRunSave(allExhausted, saved));
  assert.deepEqual(restored.state._thunderRewardFallback, { type: 'coins', amount: 20 });
  assert.deepEqual(restored.state._talentQueue, fallback.state._talentQueue);
  const completed = structuredClone(restored.state);
  assert.throws(() => restored.dispatch({ type: 'reward', id: null }), /reward/i);
  assert.deepEqual(restored.state, completed);
  while (restored.state.phase === 'talent') {
    const choice = restored.availableTalents()[0];
    assert.ok(choice, 'every bonus XP talent queue item has a frozen choice');
    restored.dispatch({ type: 'talent', id: choice.id });
  }
  assert.equal(restored.state.phase, 'transition');
});

test('battle cue validation accepts and binds V2 rage-chain and companion sources', () => {
  const valid = cue => ({
    outcome: 'player',
    rounds: 1,
    playerHp: 1,
    enemyHp: 0,
    frames: [{
      round: 1,
      kind: 'reaction',
      actor: cue.owner,
      target: cue.owner === 'player' ? 'enemy' : 'player',
      source: cue.sourceId,
      cue,
    }],
    contributions: [],
  });
  assert.doesNotThrow(() => validateBattleResult(valid({
    kind: 'rage_chain', owner: 'player', sourceId: 'RKF01-RAGE-CHAIN', count: 2,
  })));
  assert.doesNotThrow(() => validateBattleResult(valid({
    kind: 'companion_assist', owner: 'player', sourceId: 'RKF02-COMPANION',
  })));
  assert.doesNotThrow(() => validateBattleResult(valid({
    kind: 'companion_assist', owner: 'enemy', sourceId: 'RKF02-COMPANION',
  })));
  for (const invalid of [
    { kind: 'rage_chain', owner: 'player', sourceId: 'RKF01-RAGE-CHAIN', count: 1 },
    { kind: 'rage_chain', owner: 'player', sourceId: 'RKF01-RAGE-CHAIN', count: 4 },
    { kind: 'rage_chain', owner: 'player', sourceId: 'RKF02-RAGE-CHAIN', count: 2, extra: true },
    { kind: 'companion_assist', owner: 'player', sourceId: 'RKF02-RAGE-CHAIN' },
  ]) {
    assert.throws(() => validateBattleResult(valid(invalid)), /cue|source|owner|reaction/i);
  }

  const game = make('cue-companion-owner');
  game.state.ownedMethods.push('RKF02');
  game.state.talents.RKF02 = [];
  prepareNode(game, 1, 'L');
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player) {
      return {
        outcome: 'player', rounds: 1, playerHp: player.hp, enemyHp: 0,
        frames: [{
          round: 1, kind: 'reaction', actor: 'player', target: 'enemy',
          source: 'RKF03-COMPANION',
          cue: { kind: 'companion_assist', owner: 'player', sourceId: 'RKF03-COMPANION' },
        }],
        contributions: [],
      };
    },
  });
  const beforeInvalidCue = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'fight' }), /companion-assist source/i);
  assert.deepEqual(game.state, beforeInvalidCue, 'a cue from another frozen companion cannot start the battle');

  const player = {
    name: '玩家', method: 'RKF01', n: 0, talents: [], artifacts: [], baseStats: byId.get('RKF01').stats,
    hp: 100, preparation: 0,
  };
  const enemy = {
    name: '敌人', method: 'RKF01', companion: 'RKF02', n: 0, talents: [], artifacts: [],
    baseStats: byId.get('RKF01').stats,
  };
  registerCombatWorker({
    calculateStats,
    simulateBattle() {
      return valid({ kind: 'companion_assist', owner: 'enemy', sourceId: 'RKF02-COMPANION' });
    },
  });
  assert.doesNotThrow(() => simulateBattle(content, player, enemy, 'enemy-companion-cue'));
  registerCombatWorker({
    calculateStats,
    simulateBattle() {
      return valid({ kind: 'companion_assist', owner: 'enemy', sourceId: 'RKF03-COMPANION' });
    },
  });
  assert.throws(() => simulateBattle(content, player, enemy, 'enemy-companion-cue-mismatch'), /frozen companion/i);
});
