import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const buildDirectory = resolve(process.env.SHANHAI_V2_TEST_BUILD_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '../build/shanhai'));
const [{ calculateStats }, { ShanhaiGame, registerCombatWorker, validateRunState },
  { parseRunSave, serializeRun }] = await Promise.all([
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

let nextOutcome = 'player';

function installCombat(stats = calculateStats) {
  registerCombatWorker({
    calculateStats: stats,
    simulateBattle(_content, player) {
      return {
        outcome: nextOutcome,
        rounds: 1,
        playerHp: player.hp ?? player.baseStats.max_hp,
        enemyHp: nextOutcome === 'player' ? 0 : 1,
        frames: [],
        contributions: [],
      };
    },
  });
}

function make(seed = 'v2-fusion') {
  nextOutcome = 'player';
  installCombat();
  return ShanhaiGame.create(content, { seed, name: '炼宝者', method: 'RKF01' });
}

function inventory(game, stacks, slots = []) {
  game.state.artifacts = stacks.map(([id, count = 1]) => ({ id, stacks: count }));
  game.state.equipment = { slots: slots.slice() };
}

function enterFight(game, node = game.availableNodes()[0]) {
  assert.ok(node);
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
}

function settleOrdinary(game) {
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'reward');
  game.dispatch({ type: 'reward', id: null });
}

function recipeProgress(game, id) {
  return game.state.fusionProgress.find(record => record.id === id);
}

test('held inventory counts while unequipped, while ingredients earned after entry do not', () => {
  const held = make('fusion-unequipped');
  inventory(held, [['RC14'], ['RC15']]);
  enterFight(held);
  assert.deepEqual(held.state._fusionBattleEntry.eligibleRecipes, ['RL06']);
  assert.deepEqual(held.state.battleInput.player.artifacts, []);
  held.dispatch({ type: 'battle_done' });
  assert.equal(recipeProgress(held, 'RL06').wins.length, 1);

  const earnedAfterEntry = make('fusion-not-retroactive');
  inventory(earnedAfterEntry, [['RC14']]);
  enterFight(earnedAfterEntry);
  earnedAfterEntry.state.artifacts.push({ id: 'RC15', stacks: 1 });
  earnedAfterEntry.dispatch({ type: 'battle_done' });
  assert.deepEqual(earnedAfterEntry.state._fusionBattleEntry.eligibleRecipes, []);
  assert.equal(recipeProgress(earnedAfterEntry, 'RL06').wins.length, 0);

  const absentAtSettlement = make('fusion-settlement-inventory');
  inventory(absentAtSettlement, [['RC14'], ['RC15']]);
  enterFight(absentAtSettlement);
  absentAtSettlement.state.artifacts = [{ id: 'RC14', stacks: 1 }];
  absentAtSettlement.dispatch({ type: 'battle_done' });
  assert.equal(recipeProgress(absentAtSettlement, 'RL06').wins.length, 0);
});

test('defeat and draw do not count; a continued draw counts only after its final victory', () => {
  const defeated = make('fusion-defeat');
  inventory(defeated, [['RC14'], ['RC15']]);
  nextOutcome = 'enemy';
  enterFight(defeated);
  defeated.dispatch({ type: 'battle_done' });
  assert.equal(defeated.state.phase, 'lost');
  assert.equal(recipeProgress(defeated, 'RL06').wins.length, 0);

  const drawn = make('fusion-draw');
  inventory(drawn, [['RC14'], ['RC15']]);
  nextOutcome = 'draw';
  enterFight(drawn);
  assert.throws(() => drawn.dispatch({ type: 'battle_done' }), /drawn battle/);
  assert.equal(recipeProgress(drawn, 'RL06').wins.length, 0);
  nextOutcome = 'player';
  drawn.dispatch({ type: 'continue_battle' });
  drawn.dispatch({ type: 'battle_done' });
  assert.equal(recipeProgress(drawn, 'RL06').wins.length, 1);
});

test('qualifying wins accumulate across separate battles and cannot be farmed from a settled battle', () => {
  const game = make('fusion-two-wins');
  inventory(game, [['RC14'], ['RC15']]);
  enterFight(game);
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.fusionStatus().find(item => item.id === 'RL06').wins, 1);
  const firstRewardSave = serializeRun(game);
  assert.throws(() => game.dispatch({ type: 'battle_done' }), /already settled|No battle result/);
  assert.equal(recipeProgress(game, 'RL06').wins.length, 1);
  game.dispatch({ type: 'reward', id: null });

  game.startAct(2);
  inventory(game, []);
  assert.equal(game.fusionStatus().find(item => item.id === 'RL06').wins, 1,
    'progress persists while ingredients are absent');
  inventory(game, [['RC14', 3], ['RC15', 2]]);
  enterFight(game);
  game.dispatch({ type: 'battle_done' });
  assert.equal(recipeProgress(game, 'RL06').wins.length, 2);
  assert.deepEqual(game.state.artifacts.filter(stack => ['RC14', 'RC15', 'RL06'].includes(stack.id)), [
    { id: 'RC14', stacks: 2 },
    { id: 'RC15', stacks: 1 },
    { id: 'RL06', stacks: 1 },
  ]);
  assert.equal(game.state.fusionHistory.length, 1);
  assert.deepEqual(game.state.fusionHistory[0], {
    id: 'RL06', act: 2, step: 0, title: byId.get('RL06').name,
    text: `融合完成：消耗${byId.get('RC14').name}×1、${byId.get('RC15').name}×1，获得${byId.get('RL06').name}。`,
  });
  assert.equal(game.state.rewardCandidates.includes('RL06'), false);
  assert.doesNotThrow(() => parseRunSave(content, firstRewardSave));
  assert.doesNotThrow(() => validateRunState(content, game.state));
});

test('two recipes can complete together and equipped last stacks are cleaned up before auto-equip', () => {
  const game = make('fusion-both');
  inventory(game, [['RC14'], ['RC15'], ['RC01'], ['RC09']]);
  enterFight(game);
  game.dispatch({ type: 'battle_done' });
  assert.deepEqual(game.fusionStatus().map(item => [item.id, item.wins]), [['RL06', 1], ['RL07', 1]]);
  game.dispatch({ type: 'reward', id: null });
  game.startAct(2);
  inventory(game,
    [['RC14'], ['RC15'], ['RC01'], ['RC09'], ['RC02'], ['RC03']],
    ['RC01', 'RC09', 'RC14', 'RC15']);
  enterFight(game);
  game.dispatch({ type: 'battle_done' });

  assert.deepEqual(game.fusionStatus().map(item => [item.id, item.wins, item.complete]), [
    ['RL06', 2, true],
    ['RL07', 2, true],
  ]);
  assert.equal(game.state.artifacts.some(stack => ['RC14', 'RC15', 'RC01', 'RC09'].includes(stack.id)), false);
  assert.equal(game.state.artifacts.some(stack => stack.id === 'RL06'), true);
  assert.equal(game.state.artifacts.some(stack => stack.id === 'RL07'), true);
  assert.deepEqual(game.state.equipment.slots, ['RL06', 'RL07']);
  assert.deepEqual(game.state.fusionHistory.map(({ id, act, step }) => [id, act, step]), [
    ['RL06', 2, 0],
    ['RL07', 2, 0],
  ]);
});

test('fusion clamps max HP after equipment changes and does not heal the player', () => {
  const hpStats = (_content, loadout) => {
    const stats = calculateStats(_content, loadout);
    const ids = new Set(loadout.artifacts.map(stack => stack.id));
    return {
      ...stats,
      max_hp: 100 + (ids.has('RC14') ? 80 : 0) + (ids.has('RL06') ? 40 : 0),
    };
  };
  const game = make('fusion-no-heal');
  installCombat(hpStats);
  inventory(game, [['RC14'], ['RC15']], ['RC14', 'RC15']);
  enterFight(game);
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  game.startAct(2);
  inventory(game, [['RC14'], ['RC15']], ['RC14', 'RC15']);
  game.state.hp = 170;
  enterFight(game);
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.stats.max_hp, 140);
  assert.equal(game.state.hp, 140);
  assert.ok(game.state.hp < 170, 'fusion must clamp HP when its equipment lowers max HP');
});

test('event battle victories qualify and their settlement snapshots survive event reward settlement', () => {
  let game;
  let eventNode;
  let option;
  for (let index = 0; index < 128 && !eventNode; index++) {
    const candidate = make(`fusion-event-${index}`);
    const routeEvent = candidate.state.routeMap.nodes.find(node => {
      if (node.depth !== 1 || node.type !== 'E') return false;
      const event = byId.get(node.id);
      return event?.options?.some(item => item.encounter && (item.requirements ?? []).length === 0);
    });
    if (!routeEvent) continue;
    option = byId.get(routeEvent.id).options.find(item =>
      item.encounter && (item.requirements ?? []).length === 0);
    game = candidate;
    eventNode = routeEvent;
  }
  assert.ok(game && eventNode && option, 'expected an act-one accessible encounter event');

  inventory(game, [['RC14'], ['RC15']]);
  const first = game.availableNodes()[0];
  game.dispatch({ type: 'enter', id: first.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  assert.ok(game.availableNodes().some(node => node.key === eventNode.key));

  game.dispatch({ type: 'enter', id: eventNode.key });
  assert.equal(game.optionAvailability(option.id).available, true);
  game.dispatch({ type: 'event', id: option.id });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'event_result');
  assert.equal(recipeProgress(game, 'RL06').wins.length, 2);
  assert.ok(game.state.fusionHistory.some(record => record.id === 'RL06'));
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(game)));
});

test('thunder bonus snapshots remain valid when battle settlement consumes fusion inputs', () => {
  const game = make('x1');
  inventory(game, [['RC14'], ['RC15']]);
  const first = game.availableNodes()[0];
  game.dispatch({ type: 'enter', id: first.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });

  const elite = game.state.routeMap.nodes.find(node => node.depth === 2 && node.type === 'L');
  assert.ok(elite);
  const eventNode = game.state.routeMap.nodes.find(node => node.type === 'E' && node.next.includes(elite.key));
  assert.ok(eventNode);
  const event = byId.get(eventNode.id);
  const safeOption = event.options.find(item => !item.encounter && (item.requirements ?? []).length === 0);
  assert.ok(safeOption);
  game.dispatch({ type: 'enter', id: eventNode.key });
  game.dispatch({ type: 'event', id: safeOption.id });
  game.dispatch({ type: 'continue' });
  assert.ok(game.availableNodes().some(node => node.key === elite.key));

  game.dispatch({ type: 'enter', id: elite.key });
  assert.equal(game.canThunderChallenge(), true);
  game.dispatch({ type: 'thunder_challenge', enabled: true });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(recipeProgress(game, 'RL06').wins.length, 2);
  assert.equal(game.state.artifacts.some(stack => stack.id === 'RL06'), true);
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(game)));

  game.dispatch({ type: 'reward', id: null });
  const challenge = game.state.thunderChallenges[0];
  assert.ok(challenge.extraInventory.some(stack => stack.id === 'RL06'));
  assert.equal(challenge.extraCandidates.some(id => ['RL06', 'RL07'].includes(id)), false);
  if (challenge.extraCandidates.length) {
    game.dispatch({ type: 'reward', id: challenge.extraCandidates[0] });
  }
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(game)));
});

test('battle and reward restores preserve frozen eligibility and prevent replay double-counting', () => {
  const game = make('fusion-restore');
  inventory(game, [['RC14'], ['RC15']]);
  enterFight(game);
  const battleSave = serializeRun(game);
  const restoredBattle = new ShanhaiGame(content, parseRunSave(content, battleSave));
  assert.deepEqual(restoredBattle.state._fusionBattleEntry, game.state._fusionBattleEntry);
  restoredBattle.dispatch({ type: 'battle_done' });
  const rewardSave = serializeRun(restoredBattle);
  const restoredReward = new ShanhaiGame(content, parseRunSave(content, rewardSave));
  assert.equal(recipeProgress(restoredReward, 'RL06').wins.length, 1);
  assert.throws(() => restoredReward.dispatch({ type: 'battle_done' }), /already settled|No battle result/);
  assert.equal(recipeProgress(restoredReward, 'RL06').wins.length, 1);
  assert.deepEqual(restoredReward.state.fusionHistory, game.state.fusionHistory);
});

test('fusion state rejects unknown recipes, impossible snapshots, and altered history', () => {
  const game = make('fusion-malformed');
  inventory(game, [['RC14'], ['RC15']]);
  enterFight(game);
  const missingProgress = structuredClone(game.state);
  delete missingProgress.fusionProgress;
  assert.throws(() => serializeRun(missingProgress), /fusion progress/i);
  const malformedEntryShape = structuredClone(game.state);
  malformedEntryShape._fusionBattleEntry.extra = true;
  assert.throws(() => serializeRun(malformedEntryShape), /fusion battle entry/i);
  const active = JSON.parse(serializeRun(game));

  const unknownEligibility = structuredClone(active);
  unknownEligibility.state._fusionBattleEntry.eligibleRecipes = ['RL99'];
  assert.throws(() => parseRunSave(content, JSON.stringify(unknownEligibility)), /fusion/i);

  const falseEligibility = structuredClone(active);
  falseEligibility.state._fusionBattleEntry.inventory = [{ id: 'RC14', stacks: 1 }];
  assert.throws(() => parseRunSave(content, JSON.stringify(falseEligibility)), /fusion/i);

  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  game.startAct(2);
  inventory(game, [['RC14'], ['RC15']]);
  enterFight(game);
  game.dispatch({ type: 'battle_done' });
  const completed = JSON.parse(serializeRun(game));
  const unknownProgress = structuredClone(completed);
  unknownProgress.state.fusionProgress[0].id = 'RL99';
  assert.throws(() => parseRunSave(content, JSON.stringify(unknownProgress)), /fusion/i);
  const impossibleWin = structuredClone(completed);
  impossibleWin.state.fusionProgress[0].wins[0].entryInventory = [{ id: 'RC14', stacks: 1 }];
  assert.throws(() => parseRunSave(content, JSON.stringify(impossibleWin)), /fusion/i);
  const falseHistory = structuredClone(completed);
  falseHistory.state.fusionHistory[0].text = '融合完成。';
  assert.throws(() => parseRunSave(content, JSON.stringify(falseHistory)), /fusion/i);
});

test('fusion completion is atomic on command failure and fused artifacts cannot enter shops or rewards', () => {
  const rollback = make('fusion-rollback');
  inventory(rollback, [['RC14'], ['RC15']]);
  enterFight(rollback);
  rollback.state.fusionProgress = [];
  const before = structuredClone(rollback.state);
  assert.throws(() => rollback.dispatch({ type: 'battle_done' }), /Missing fusion progress/);
  assert.deepEqual(rollback.state, before);

  const game = make('fusion-unacquirable');
  assert.equal(game.artifactPool('legendary').some(id => ['RL06', 'RL07'].includes(id)), false);
  game.state.phase = 'shop';
  game.generateShop();
  assert.equal(game.state.shop.some(item => ['RL06', 'RL07'].includes(item.id)), false);
  game.state.shop = [{ id: 'RL06', kind: 'artifact', price: 1, sold: false }];
  assert.throws(() => game.dispatch({ type: 'buy', id: 'RL06' }), /unavailable|capacity|artifact/i);

  const reward = make('fusion-unacquirable-reward');
  enterFight(reward);
  reward.dispatch({ type: 'battle_done' });
  reward.state.rewardCandidates = ['RL07'];
  const beforeReward = structuredClone(reward.state);
  assert.throws(() => reward.dispatch({ type: 'reward', id: 'RL07' }), /no longer available/);
  assert.deepEqual(reward.state, beforeReward);
});
