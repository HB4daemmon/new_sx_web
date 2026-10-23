import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';

const model = await loadContent();
const content = contentFromEntities(model.entities, model.manifest.content_version);
const legacyEntities = structuredClone(model.entities);
for (const [eventId, optionId] of [['RE001', 'RE001-C'], ['RE002', 'RE002-B']]) {
  const option = legacyEntities.find(entity => entity.id === eventId).options
    .find(candidate => candidate.id === optionId);
  option.commitment = structuredClone(option.legacy_commitment);
  option.story_echo = option.legacy_story_echo;
  option.rewards = [];
  delete option.check;
}
const legacyContent = contentFromEntities(legacyEntities, model.manifest.content_version);
let loseNextBattle = false;
registerCombatWorker({
  calculateStats,
  simulateBattle(_content, player) {
    if (loseNextBattle) {
      return { outcome: 'enemy', rounds: 1, playerHp: 0, enemyHp: 1, frames: [], contributions: [] };
    }
    return { outcome: 'player', rounds: 1, playerHp: player.hp, enemyHp: 0, frames: [], contributions: [] };
  },
});

function finish(game) {
  for (let guard = 0; !['map', 'transition', 'won', 'lost'].includes(game.state.phase); guard++) {
    assert.ok(guard < 30);
    switch (game.state.phase) {
      case 'preview': game.dispatch({ type: 'fight' }); break;
      case 'battle': game.dispatch({ type: 'battle_done' }); break;
      case 'reward': game.dispatch({ type: 'reward', id: null }); break;
      case 'event':
        game.dispatch({ type: 'event', id: content.byId[game.node.id].options.findLast(option =>
          !option.encounter && !option.commitment &&
          !option.rewards.some(reward => ['method', 'swap_method'].includes(reward.type)) &&
          game.optionAvailability(option).available).id });
        break;
      case 'event_result': game.dispatch({ type: 'continue' }); break;
      case 'talent': game.dispatch({ type: 'talent', id: game.availableTalents()[0].id }); break;
      case 'shop': game.dispatch({ type: 'leave_shop' }); break;
      case 'rest': game.dispatch({ type: 'rest', choice: 'preparation' }); break;
      default: throw new Error(game.state.phase);
    }
  }
}

function enter(game, desiredType) {
  const candidates = game.availableNodes();
  const selected = candidates.find(node => node.type === desiredType) ??
    candidates.find(node => !['R', 'S', 'K'].includes(node.type)) ?? candidates[0];
  // Fixtures keep the real graph and settlement, but select a known authored event.
  if (selected.type === 'E') game.state.routeMap.nodes.find(node => node.key === selected.key).id = 'RE006';
  game.dispatch({ type: 'enter', id: selected.key });
  return selected;
}

function atEvent(eventId, gameContent = content) {
  const game = ShanhaiGame.create(gameContent, { seed: 'commitment-run', name: '行者', method: 'RKF02' });
  enter(game, 'C');
  finish(game);
  const event = game.availableNodes().find(node => node.type === 'E');
  assert.ok(event);
  game.state.routeMap.nodes.find(node => node.key === event.key).id = eventId;
  game.dispatch({ type: 'enter', id: event.key });
  return game;
}

function atCommitment(eventId = 'RE001', optionId = 'RE001-C') {
  const legacyGame = atEvent(eventId, legacyContent);
  const beforeCoins = legacyGame.state.coins;
  legacyGame.dispatch({ type: 'event', id: optionId });
  assert.ok(legacyGame.state.coins < beforeCoins);
  assert.equal(legacyGame.state.eventCommitments[0].remaining, eventId === 'RE001' ? 3 : 2);
  const savedLegacyPayment = serializeRun(legacyGame);
  const game = new ShanhaiGame(content, parseRunSave(content, savedLegacyPayment));
  assert.doesNotThrow(() => parseRunSave(content, savedLegacyPayment), 'legacy paid result must restore with current content');
  assert.equal(game.state.artifacts.some(item => item.id === (eventId === 'RE001' ? 'RC17' : 'RC19')), false);
  finish(game);
  return game;
}

function reload(game) {
  return new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
}

test('a real event commitment survives saves, excludes its origin, and grants travel items only after delivery', () => {
  let game = atCommitment();
  assert.equal(game.state.eventCommitments[0].remaining, 3);
  assert.equal(game.state.artifacts.some(item => item.id === 'RC17'), false);
  game.state.hp = 100;
  for (const remaining of [2, 1, 0]) {
    enter(game, 'C');
    finish(game);
    assert.equal(game.state.eventCommitments[0].remaining, remaining);
    game = reload(game);
  }
  assert.equal(game.state.eventCommitments[0].status, 'fulfilled');
  assert.equal(game.state.artifacts.find(item => item.id === 'RC17').stacks, 2);
  assert.equal(game.state.hp, 100, 'new travel items cannot heal retroactively on the delivery node');
  assert.match(game.state.history.at(-1).text, /药箱送达/);
  enter(game, 'C');
  finish(game);
  assert.equal(game.state.hp, 104);
  assert.equal(reload(game).state.artifacts.find(item => item.id === 'RC17').stacks, 2);
});

test('entering an avoided node breaks the promise before services and never refunds or grants', () => {
  let game = atCommitment();
  enter(game, 'C');
  finish(game);
  const beforeCoins = game.state.coins;
  const rest = game.availableNodes().find(node => node.type === 'R');
  assert.ok(rest, 'fixture seed has its early rest on this layer');
  game.dispatch({ type: 'enter', id: rest.key });
  assert.equal(game.state.eventCommitments[0].status, 'broken');
  assert.equal(game.state.coins, beforeCoins, 'entry cannot refund the upfront payment');
  finish(game);
  game = reload(game);
  assert.equal(game.state.artifacts.some(item => item.id === 'RC17'), false);
  assert.equal(game.state.eventCommitments[0].status, 'broken');
});

test('capacity changes while waiting fall back per missing layer and cannot double-pay on reload', () => {
  let game = atCommitment('RE002', 'RE002-B');
  game.state.artifacts = [{ id: 'RC19', stacks: 2 }];
  enter(game, 'C');
  finish(game);
  enter(game, 'C');
  const beforeCoins = game.state.coins;
  finish(game);
  assert.equal(game.state.eventCommitments[0].status, 'fulfilled');
  assert.equal(game.state.artifacts.find(item => item.id === 'RC19').stacks, 3);
  assert.equal(game.state.coins, beforeCoins + 12, 'battle and decline coins plus four fallback coins');
  assert.match(game.state.eventCommitments[0].resultText, /4灵石/);
  assert.match(game.state.eventCommitments[0].resultText, /凝气珠×1/);
  assert.doesNotMatch(game.state.eventCommitments[0].resultText, /两层/);
  const coins = game.state.coins;
  game = reload(game);
  assert.equal(game.state.coins, coins);
});

test('malformed or forged saved commitment progress and sources are rejected', () => {
  const game = atCommitment();
  for (const mutate of [
    state => { state.eventCommitments[0].remaining = -1; },
    state => { state.eventCommitments[0].snapshot.rewards[0].id = 'RL01'; },
    state => { state.eventCommitments[0].processedNodes = ['4:11']; state.eventCommitments[0].remaining = 2; },
    state => { state.eventCommitments.push(structuredClone(state.eventCommitments[0])); },
    state => { state.history[1].optionId = 'RE001-A'; },
    state => { delete state.history[1].eventId; },
    state => { state.eventCommitments = null; },
  ]) {
    const saved = JSON.parse(serializeRun(game));
    mutate(saved.state);
    assert.throws(() => parseRunSave(content, JSON.stringify(saved)), /commitment/i);
  }
  const legacy = JSON.parse(serializeRun(game));
  delete legacy.state.eventCommitments;
  assert.doesNotThrow(() => parseRunSave(content, JSON.stringify(legacy)));
  const unchosen = ShanhaiGame.create(content, { seed: 'unpaid', name: '行者', method: 'RKF02' });
  unchosen.state.eventCommitments = [structuredClone(game.state.eventCommitments[0])];
  unchosen.state.eventCommitments[0].originStep = 1;
  assert.throws(() => parseRunSave(content, serializeRun(unchosen)), /commitment/i);
});

test('death on a later battle does not progress or deliver the commitment', () => {
  const game = atCommitment();
  enter(game, 'C');
  loseNextBattle = true;
  try {
    game.dispatch({ type: 'fight' });
    game.dispatch({ type: 'battle_done' });
    assert.equal(game.state.phase, 'lost');
    assert.equal(game.state.eventCommitments[0].remaining, 3);
    assert.equal(game.state.eventCommitments[0].status, 'active');
    assert.equal(game.state.artifacts.some(item => item.id === 'RC17'), false);
    assert.equal(reload(game).state.eventCommitments[0].remaining, 3);
  } finally {
    loseNextBattle = false;
  }
});

test('the authored cultivation trade charges real XP and cannot grant a free breakthrough', () => {
  const game = atEvent('RE004');
  const option = content.byId.RE004.options[0];
  game.state.xp = 0;
  assert.equal(game.optionAvailability(option).available, false);
  const before = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'event', id: option.id }));
  assert.deepEqual(game.state, before);
  game.state.xp = 120;
  game.dispatch({ type: 'event', id: option.id });
  assert.equal(game.state.xp, 96);
  assert.equal(game.state.n, 0);
  assert.equal(game.state.phase, 'event_result');
  assert.equal(game.state.artifacts.find(item => item.id === 'RC12').stacks, 2);
  assert.doesNotThrow(() => reload(game));
});
