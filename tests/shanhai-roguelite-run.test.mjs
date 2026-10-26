import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';
import { eventEchoes } from '../build/shanhai/narrative.js';

const loaded = await loadContent();
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

function installStubCombat() {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player, enemy, seed, options = {}) {
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

function make(seed, method = 'RKF01') {
  return ShanhaiGame.create(content, { seed, name: '行者', method });
}

function resolveCurrentNode(game) {
  for (let guard = 0; game.state.phase !== 'map' && !['won', 'lost'].includes(game.state.phase); guard++) {
    assert.ok(guard < 32, `node did not resolve from ${game.state.phase}`);
    switch (game.state.phase) {
      case 'preview':
        game.dispatch({ type: 'fight' });
        break;
      case 'battle':
        if (game.state.battle.outcome === 'draw') game.dispatch({ type: 'continue_battle' });
        else game.dispatch({ type: 'battle_done' });
        break;
      case 'reward':
        game.dispatch({ type: 'reward', id: null });
        break;
      case 'event': {
        const event = content.byId[game.node.id];
        const direct = event.options.filter(candidate =>
          !candidate.encounter &&
          !candidate.commitment &&
          !candidate.legacy_commitment &&
          !candidate.rewards?.some(reward => ['method', 'swap_method'].includes(reward.type)) &&
          game.optionAvailability(candidate).available);
        const option = direct.find(candidate =>
          candidate.costs.length === 0 && candidate.rewards.length === 0) ??
          direct.find(candidate => candidate.costs.length === 0) ??
          direct[0];
        assert.ok(option, `${event.id} needs an available direct option`);
        game.dispatch({ type: 'event', id: option.id });
        break;
      }
      case 'event_result':
        game.dispatch({ type: 'continue' });
        break;
      case 'shop':
        game.dispatch({ type: 'leave_shop' });
        break;
      case 'rest':
        if (game.state._restFromEvent) {
          const otherMethod = game.state.ownedMethods.find(id => id !== game.state.method);
          assert.ok(otherMethod);
          game.dispatch({ type: 'rest', choice: 'swap_method', method: otherMethod });
        } else game.dispatch({ type: 'rest', choice: 'heal' });
        break;
      case 'talent':
        game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
        break;
      case 'transition':
        game.dispatch({ type: 'continue' });
        break;
      default:
        throw new Error(`Unhandled phase ${game.state.phase}`);
    }
  }
}

function routeToNode(game, predicate) {
  for (let guard = 0; guard < 80; guard++) {
    if (game.state.phase !== 'map') resolveCurrentNode(game);
    assert.ok(!['won', 'lost'].includes(game.state.phase), 'run ended before the requested node');

    const starts = game.availableNodes();
    const nodes = game.state.routeMap.nodes;
    const byKey = new Map(nodes.map(node => [node.key, node]));
    const queue = starts.map(node => [node.key]);
    const visited = new Set();
    let path;
    while (queue.length && !path) {
      const current = queue.shift();
      const key = current.at(-1);
      if (visited.has(key)) continue;
      visited.add(key);
      const node = byKey.get(key);
      if (node && predicate(node)) path = current;
      else for (const next of node?.next ?? []) queue.push([...current, next]);
    }
    assert.ok(path, 'no reachable node matches the requested predicate');
    const target = starts.find(node => node.key === path[0]);
    assert.ok(target);
    game.dispatch({ type: 'enter', id: target.key });
    if (predicate(target)) return target;
    resolveCurrentNode(game);
  }
  throw new Error('Node target was not reached');
}

function enterAuthoredEvent({ eventId, act = 1, seed = `event-${eventId}`, method = 'RKF01' }) {
  installStubCombat();
  const game = make(seed, method);
  if (act !== 1) game.startAct(act);
  const firstBattle = game.availableNodes()[0];
  assert.equal(firstBattle.type, 'C');
  game.dispatch({ type: 'enter', id: firstBattle.key });
  resolveCurrentNode(game);

  const eventNode = game.availableNodes().find(node => node.type === 'E');
  assert.ok(eventNode, `act ${act} should expose an ordinary event after its opening battle`);
  assert.ok(content.byId[eventId].acts.includes(act), `${eventId} is not available in act ${act}`);
  game.state.routeMap.nodes.find(node => node.key === eventNode.key).id = eventId;
  game.dispatch({ type: 'enter', id: eventNode.key });
  assert.equal(game.state.phase, 'event');
  return game;
}

function reload(game) {
  return new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
}

function actEventCost(game, option) {
  return option.costs.reduce((total, cost) => {
    if (cost.resource !== 'coins') return total;
    if (cost.basis === 'common_price') {
      return total + cost.amount * game.actContent.economy.shop.common_price;
    }
    return total + cost.amount;
  }, 0);
}

test('stat event checks persist the selected result, exact echo, and actual history', () => {
  for (const [seed, success] of [['stat-success', true], ['stat-failure', false]]) {
    let game = enterAuthoredEvent({ eventId: 'RE029', act: 4, seed });
    game.state.coins = 100;
    const option = content.byId.RE029.options.find(candidate => candidate.id === 'RE029-B');
    const initialHp = success ? game.stats.max_hp : Math.max(1, game.stats.max_hp * 0.2);
    game.state.hp = initialHp;
    const beforeCoins = game.state.coins;
    const beforeSpent = game.state.progress.coinsSpent;
    const price = actEventCost(game, option);

    game.dispatch({ type: 'event', id: option.id });
    const check = structuredClone(game.state.eventCheck);
    assert.equal(check.kind, 'stat');
    assert.equal(check.success, success);
    assert.equal(check.stat, 'hp_ratio');
    assert.equal(check.threshold, 0.55);
    assert.equal(game.state._eventOutcome, success ? 'success' : 'failure');
    assert.equal(game.state.coins, beforeCoins - price);
    assert.equal(game.state.progress.coinsSpent, beforeSpent + price);
    assert.equal(game.state.artifacts.some(stack => stack.id === 'RC04'), success);

    const pending = reload(game);
    assert.deepEqual(pending.state.eventCheck, check);
    assert.equal(pending.state.eventStoryEcho,
      success ? option.story_echo : option.check.failure_echo);
    assert.equal(pending.state.coins, beforeCoins - price);
    assert.equal(pending.state.progress.coinsSpent, beforeSpent + price);
    assert.throws(() => pending.dispatch({ type: 'event', id: option.id }), /No event is pending/);
    assert.equal(pending.state.coins, beforeCoins - price, 'reload must not charge a second time');
    assert.equal(pending.state.progress.coinsSpent, beforeSpent + price);

    pending.dispatch({ type: 'continue' });
    const entry = pending.state.history.at(-1);
    assert.deepEqual(entry.eventCheck, check);
    assert.equal(entry.eventOutcome, success ? 'success' : 'failure');
    assert.equal(entry.storyEcho, success ? option.story_echo : option.check.failure_echo);
    const [echo] = eventEchoes(content, pending.state);
    assert.equal(echo.id, 'RE029');
    assert.equal(echo.text, entry.storyEcho);
    assert.deepEqual(reload(pending).state.history.at(-1), entry);
  }
});

test('fixed-seed chance checks survive event back, reload, settlement, and paid failure', () => {
  for (const [seed, success, expectedRoll] of [
    ['fixed-chance-0', true, 0.18950353795662522],
    ['fixed-chance-1', false, 0.7197490809485316],
  ]) {
    let game = enterAuthoredEvent({ eventId: 'RE020', act: 3, seed });
    game.state.coins = 100;
    const eventKey = game.state.routeMap.path[game.state.step];
    const option = content.byId.RE020.options.find(candidate => candidate.id === 'RE020-A');
    const beforeCoins = game.state.coins;
    const price = actEventCost(game, option);

    game = reload(game);
    game.dispatch({ type: 'back' });
    assert.equal(game.state.phase, 'map');
    assert.equal(game.state.eventCheck, undefined);
    assert.equal(game.state.coins, beforeCoins);
    game.dispatch({ type: 'enter', id: eventKey });
    assert.equal(game.state.phase, 'event');

    game.dispatch({ type: 'event', id: option.id });
    const check = structuredClone(game.state.eventCheck);
    assert.equal(check.kind, 'chance');
    assert.equal(check.success, success);
    assert.equal(check.roll, expectedRoll);
    assert.equal(game.state.coins, beforeCoins - price);
    assert.equal(game.state.artifacts.some(stack => stack.id === 'RC09'), success,
      'a failed paid check must not grant the authored artifact');
    assert.equal(game.state.eventStoryEcho, success ? option.story_echo : option.check.failure_echo);

    game = reload(game);
    assert.deepEqual(game.state.eventCheck, check, 'reload must keep the original roll instead of drawing again');
    assert.equal(game.state.coins, beforeCoins - price);
    game.dispatch({ type: 'continue' });
    const entry = game.state.history.at(-1);
    assert.deepEqual(entry.eventCheck, check);
    assert.equal(entry.storyEcho, success ? option.story_echo : option.check.failure_echo);
    assert.equal(eventEchoes(content, game.state).at(-1).text, entry.storyEcho);
  }
});

test('all 52 events retain a safe legal choice at zero coins, one HP, full artifacts and all known methods', () => {
  const events = content.entities.filter(entity => entity.kind === 'event');
  assert.equal(events.length, 52);
  for (const event of events) {
    const act = event.acts[0];
    const game = enterAuthoredEvent({ eventId: `RE${String((act - 1) * 9 + 1).padStart(3, '0')}`, act,
      seed: `safe-exit-${event.id}` });
    // Exercise authored choices at a real event phase without requiring a
    // particular storyline to be randomly offered by this fixture.
    game.node.id = event.id;
    game.state.coins = 0;
    game.state.xp = 0;
    game.state.hp = 1;
    for (const option of event.options) {
      for (const requirement of option.requirements) {
        if (requirement.type === 'flag') game.state.flags[requirement.id] = requirement.value;
      }
    }
    const uniqueGroups = new Set();
    game.state.artifacts = content.entities.filter(entity => {
      if (entity.kind !== 'artifact') return false;
      if (entity.unique_group && uniqueGroups.has(entity.unique_group)) return false;
      if (entity.unique_group) uniqueGroups.add(entity.unique_group);
      return true;
    }).map(artifact => ({ id: artifact.id, stacks: artifact.max_stacks ?? 1 }));
    game.state.ownedMethods = content.entities.filter(entity => entity.kind === 'method').map(entity => entity.id);
    const safeChoice = event.options.find(option => !option.encounter && !option.check &&
      option.costs.length === 0 && game.optionAvailability(option).available);
    assert.ok(safeChoice, `${event.id} must retain a free, noncombat, nonrandom choice`);
    const artifacts = structuredClone(game.state.artifacts);
    game.dispatch({ type: 'event', id: safeChoice.id });
    assert.equal(game.state.phase, 'event_result', event.id);
    assert.ok(game.state.hp >= 1, event.id);
    assert.deepEqual(game.state.artifacts, artifacts, event.id);
  }
});

test('a method reward already owned is unavailable rather than duplicating ownership', () => {
  const game = enterAuthoredEvent({
    eventId: 'RE033',
    act: 4,
    seed: 'duplicate-method',
    method: 'RKF02',
  });
  game.state.coins = 200;
  const duplicate = content.byId.RE033.options.find(option => option.id === 'RE033-A');
  assert.equal(game.optionAvailability(duplicate).available, false);
  const before = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'event', id: duplicate.id }), /method-already-known/);
  assert.deepEqual(game.state, before);
  assert.equal(game.state.ownedMethods.filter(id => id === 'RKF02').length, 1);
});

test('saved check results reject malformed numbers, contradictory outcomes and mismatched sources', () => {
  const game = enterAuthoredEvent({ eventId: 'RE020', act: 3, seed: 'saved-check-shape' });
  game.state.coins = 100;
  game.dispatch({ type: 'event', id: 'RE020-A' });
  for (const mutate of [
    state => { state.eventCheck.roll = 2; },
    state => { state.eventCheck.chance = -1; },
    state => { state.eventCheck.success = !state.eventCheck.success; },
    state => { state.eventOption = 'RE020-B'; },
    state => { state.eventStoryEcho = 123; },
  ]) {
    const payload = JSON.parse(serializeRun(game));
    mutate(payload.state);
    assert.throws(() => parseRunSave(content, JSON.stringify(payload)), /check|echo/i);
  }
});

test('reforge candidates are fixed, forged targets fail, payment and HP clamp are atomic', () => {
  installStubCombat();
  let game = make('reforge-fixed-shop');
  const shop = routeToNode(game, node => node.type === 'S');
  assert.equal(game.state.phase, 'shop');

  let sourceId;
  let options;
  let sourceMaxHp;
  let targetId;
  let targetMaxHp;
  for (const source of content.entities.filter(entity => entity.kind === 'artifact' && entity.rarity === 'common')) {
    game.state.artifacts = [{ id: source.id, stacks: 1 }];
    game.state.equipment = { slots: [source.id] };
    const candidates = game.reforgeOptions(source.id);
    if (candidates.length !== 3) continue;
    const currentMaxHp = calculateStats(content, game.player).max_hp;
    const lowerTarget = candidates.find(id => calculateStats(content, {
      ...game.player,
      artifacts: [{ id, stacks: 1 }],
    }).max_hp < currentMaxHp);
    if (!lowerTarget) continue;
    sourceId = source.id;
    options = candidates;
    sourceMaxHp = currentMaxHp;
    targetId = lowerTarget;
    targetMaxHp = calculateStats(content, {
      ...game.player,
      artifacts: [{ id: lowerTarget, stacks: 1 }],
    }).max_hp;
    break;
  }
  assert.ok(sourceId && options && targetId, 'expected three fixed candidates including a lower max-HP target');
  game.state.artifacts = [{ id: sourceId, stacks: 1 }];
  game.state.equipment = { slots: [sourceId] };
  game.state.coins = 100;
  game.state.hp = sourceMaxHp;
  assert.deepEqual(game.reforgeOptions(sourceId), options);
  assert.deepEqual(game.reforgeOptions(sourceId), options, 'asking again must not reroll the three targets');

  const forgedTarget = content.entities.find(entity =>
    entity.kind === 'artifact' && entity.rarity === 'common' &&
    entity.id !== sourceId && !options.includes(entity.id));
  assert.ok(forgedTarget);
  const beforeForgery = structuredClone(game.state);
  assert.throws(() => game.dispatch({
    type: 'reforge',
    source: sourceId,
    target: forgedTarget.id,
  }), /invalid-source-or-target/);
  assert.deepEqual(game.state, beforeForgery);

  game = reload(game);
  assert.deepEqual(game.reforgeOptions(sourceId), options, 'reload must preserve the fixed candidates');
  game.dispatch({ type: 'back' });
  game = reload(game);
  game.dispatch({ type: 'enter', id: shop.key });
  assert.deepEqual(game.reforgeOptions(sourceId), options, 'back and re-entry must not reroll candidates');

  const beforeCoins = game.state.coins;
  const beforeSpent = game.state.progress.coinsSpent;
  const price = game.reforgePrice();
  game.dispatch({ type: 'reforge', source: sourceId, target: targetId });
  assert.equal(game.state.coins, beforeCoins - price);
  assert.equal(game.state.progress.coinsSpent, beforeSpent + price);
  assert.equal(game.state.artifacts.some(stack => stack.id === sourceId), false);
  assert.equal(game.state.artifacts.find(stack => stack.id === targetId)?.stacks, 1);
  assert.equal(game.state.hp, targetMaxHp, 'removing the source clamps HP to the new maximum');
  assert.equal(game.stats.max_hp, targetMaxHp);

  const reloaded = reload(game);
  assert.equal(reloaded.state._shopReforged, true);
  assert.deepEqual(reloaded.reforgeOptions(sourceId), [], 'successful reforge removes the sole source stack');
  reloaded.dispatch({ type: 'back' });
  const guarded = reload(reloaded);
  guarded.dispatch({ type: 'enter', id: shop.key });
  assert.equal(guarded.state.phase, 'shop');
  assert.equal(guarded.reforgeAvailability(sourceId, targetId).available, false);
  const guardedCoins = guarded.state.coins;
  assert.throws(() => guarded.dispatch({ type: 'reforge', source: sourceId, target: targetId }),
    /already-reforged/);
  assert.equal(guarded.state.coins, guardedCoins);

  guarded.dispatch({ type: 'leave_shop' });
  guarded.startAct(2);
  guarded.state.coins = 100;
  routeToNode(guarded, node => node.type === 'S');
  guarded.state.artifacts.push({ id: sourceId, stacks: 1 });
  assert.equal(guarded.state._shopReforged, false);
  assert.equal(guarded.reforgeAvailability(sourceId, guarded.reforgeOptions(sourceId)[0]).available, true,
    'a different shop resets the one-reforge guard');
});

test('rest tempering pays one price, adds one stack, and consumes the entire rest node', () => {
  installStubCombat();
  const game = make('temper-rest');
  const rest = routeToNode(game, node => node.type === 'R');
  game.state.artifacts = [{ id: 'RC05', stacks: 1 }];
  game.state.coins = 100;
  const warmCost = game.warmCost();
  const beforeStep = game.state.step;
  const beforeCoins = game.state.coins;
  const beforeSpent = game.state.progress.coinsSpent;

  game.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC05' });
  assert.equal(game.state.phase, 'map');
  assert.equal(game.state.step, beforeStep + 1);
  assert.equal(game.state.coins, beforeCoins - warmCost);
  assert.equal(game.state.progress.coinsSpent, beforeSpent + warmCost);
  assert.equal(game.state.artifacts.find(stack => stack.id === 'RC05').stacks, 2);
  assert.equal(game.state.nodes[rest.depth].completed, true);
  assert.throws(() => game.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC05' }), /Rest is not available/);
});

test('temper refuses full layers, insufficient coins, and event-granted method-swap rests', () => {
  installStubCombat();
  const full = make('temper-full-layer');
  routeToNode(full, node => node.type === 'R');
  const maxStacks = content.byId.RC05.max_stacks;
  full.state.artifacts = [{ id: 'RC05', stacks: maxStacks }];
  const fullBefore = structuredClone(full.state);
  assert.equal(full.warmableArtifacts().includes('RC05'), false);
  assert.throws(() => full.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC05' }),
    /Artifact cannot be tempered/);
  assert.deepEqual(full.state, fullBefore);

  const poor = make('temper-no-coins');
  routeToNode(poor, node => node.type === 'R');
  poor.state.artifacts = [{ id: 'RC05', stacks: 1 }];
  poor.state.coins = poor.warmCost() - 1;
  const poorBefore = structuredClone(poor.state);
  assert.throws(() => poor.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC05' }),
    /Cannot afford tempering/);
  assert.deepEqual(poor.state, poorBefore);

  const eventRest = enterAuthoredEvent({ eventId: 'RE008', seed: 'event-swap-no-temper' });
  eventRest.state.ownedMethods.push('RKF02');
  eventRest.state.talents.RKF02 = [];
  eventRest.state.artifacts = [{ id: 'RC05', stacks: 1 }];
  eventRest.state.coins = 100;
  eventRest.dispatch({ type: 'event', id: 'RE008-A' });
  assert.equal(eventRest.state.phase, 'event_result');
  eventRest.dispatch({ type: 'continue' });
  assert.equal(eventRest.state.phase, 'rest');
  assert.equal(eventRest.state._restFromEvent, true);
  const eventBefore = structuredClone(eventRest.state);
  assert.throws(() => eventRest.dispatch({ type: 'rest', choice: 'temper', artifact: 'RC05' }),
    /only grants a method swap/);
  assert.deepEqual(eventRest.state, eventBefore);
});

test('shop discount freezes reduced quotes and charges only the quoted amount', () => {
  installStubCombat();
  const game = make('shop-discount-ledger');
  game.state.n = 2;
  game.state.xp = 600;
  game.state.talents.RKF01 = ['V2-J1-A', 'V2-J2-B'];
  game.state.coins = 1000;
  const shop = routeToNode(game, node => node.type === 'S');
  const actPrices = game.actContent.economy.shop;

  for (const item of game.state.shop) {
    const undiscounted = item.kind === 'artifact'
      ? content.byId[item.id].rarity === 'rare' ? actPrices.rare_price : actPrices.common_price
      : content.rules.economy.non_artifact_prices[item.kind].price;
    assert.equal(item.price, Math.max(1, Math.floor(undiscounted * 0.75)), item.id);
  }

  const service = game.state.shop.find(item => item.kind === 'recovery');
  const beforeCoins = game.state.coins;
  const beforeSpent = game.state.progress.coinsSpent;
  game.dispatch({ type: 'buy', id: service.id });
  assert.equal(game.state.coins, beforeCoins - service.price);
  assert.equal(game.state.progress.coinsSpent, beforeSpent + service.price);
  const frozenPrice = service.price;
  game.dispatch({ type: 'back' });
  game.dispatch({ type: 'enter', id: shop.key });
  assert.equal(game.state.shop.find(item => item.id === service.id).price, frozenPrice);
  const spentAfterPurchase = game.state.progress.coinsSpent;
  assert.throws(() => game.dispatch({ type: 'buy', id: service.id }), /sold/);
  assert.equal(game.state.progress.coinsSpent, spentAfterPurchase);
});

test('bounty counts settled normal, elite, and boss victories but never pays the terminal win', () => {
  installStubCombat();
  const game = make('bounty-settlement');
  game.state.n = 2;
  game.state.xp = 600;
  game.state.talents.RKF01 = ['V2-J1-A', 'V2-J2-A'];

  routeToNode(game, node => node.type === 'C');
  game.state.coins = 0;
  const normalCoins = content.rules.economy.ordinary_coins_by_act[0];
  game.dispatch({ type: 'fight' });
  assert.deepEqual(game.state.battleInput.player.journey, {
    coins: 0,
    coinsSpent: game.state.progress.coinsSpent,
    eliteWins: 0,
    bossWins: 0,
    artifactKinds: 0,
    knownMethods: 1,
  });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.coins, normalCoins + 4);
  assert.equal(game.state.progress.eliteWins, 0);
  assert.equal(game.state.progress.bossWins, 0);
  assert.throws(() => game.dispatch({ type: 'battle_done' }), /No battle result/);
  const settled = reload(game);
  assert.equal(settled.state.coins, normalCoins + 4, 'reload must not settle bounty twice');
  settled.dispatch({ type: 'reward', id: null });

  for (let act = 1; act <= 4; act++) {
    routeToNode(settled, node => node.type === 'B');
    settled.state.coins = 0;
    settled.dispatch({ type: 'fight' });
    settled.dispatch({ type: 'battle_done' });
    assert.equal(settled.state.progress.bossWins, act);
    assert.equal(settled.state.coins,
      content.rules.economy.boss_coins_by_act[act - 1] + 30);
    resolveCurrentNode(settled);
  }

  const final = routeToNode(settled, node => node.type === 'F');
  assert.equal(final.type, 'F');
  const terminalCoins = settled.state.coins;
  settled.dispatch({ type: 'fight' });
  settled.dispatch({ type: 'battle_done' });
  assert.equal(settled.state.phase, 'won');
  assert.equal(settled.state.progress.bossWins, 5);
  assert.equal(settled.state.coins, terminalCoins, 'terminal win has no bounty payout');
});

test('bounty pays no coins and records no victory after a lost battle', () => {
  installStubCombat();
  const game = make('bounty-loss');
  game.state.n = 2;
  game.state.xp = 600;
  game.state.talents.RKF01 = ['V2-J1-A', 'V2-J2-A'];
  routeToNode(game, node => node.type === 'C');
  const beforeCoins = game.state.coins;
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player) {
      return {
        outcome: 'enemy',
        rounds: 1,
        playerHp: 0,
        enemyHp: 1,
        frames: [],
        contributions: [],
      };
    },
  });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'lost');
  assert.equal(game.state.coins, beforeCoins);
  assert.deepEqual(game.state.progress, { coinsSpent: 0, eliteWins: 0, bossWins: 0 });
});

test('event-internal victories count their actual tier for bounty and milestones', () => {
  const resolveEventBattle = withBounty => {
    const game = enterAuthoredEvent({ eventId: 'RE005', seed: 'bounty-event-only' });
    game.state.n = 2;
    game.state.xp = 600;
    const localTierTwo = content.byId.RKF01.talents.find(talent => talent.tier === 2).id;
    game.state.talents.RKF01 = withBounty
      ? ['V2-J1-A', 'V2-J2-A']
      : ['V2-J1-A', localTierTwo];
    game.state.coins = 1000;
    game.dispatch({ type: 'event', id: 'RE005-A' });
    game.dispatch({ type: 'fight' });
    game.dispatch({ type: 'battle_done' });
    assert.equal(game.state.phase, 'event_result');
    assert.deepEqual(game.state.progress, { coinsSpent: 0, eliteWins: 0, bossWins: 0 });
    return game.state.coins;
  };

  assert.equal(resolveEventBattle(true), resolveEventBattle(false) + 4);

  const game = enterAuthoredEvent({ eventId: 'RE009', seed: 'bounty-event-elite' });
  game.state.n = 2;
  game.state.xp = 600;
  game.state.talents.RKF01 = ['V2-J1-A', 'V2-J2-A'];
  const beforeCoins = game.state.coins;
  game.dispatch({ type: 'event', id: 'RE009-A' });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.progress.eliteWins, 1);
  assert.equal(game.state.progress.bossWins, 0);
  assert.equal(game.state.coins, beforeCoins + 20);
  const settled = reload(game);
  assert.equal(settled.state.progress.eliteWins, 1, 'reload must not count the settled event victory twice');
  assert.equal(settled.state.coins, beforeCoins + 20, 'reload must not pay the event bounty twice');
  assert.throws(() => settled.dispatch({ type: 'battle_done' }), /No battle result/);

  installStubCombat();
  const bossEvent = make('bounty-event-boss');
  const coreNode = routeToNode(bossEvent, node => node.type === 'K');
  const currentKey = bossEvent.state.routeMap.path[bossEvent.state.step];
  bossEvent.state.nodes[bossEvent.state.step].id = 'RK013';
  bossEvent.state.routeMap.nodes.find(node => node.key === currentKey).id = 'RK013';
  bossEvent.state.n = 2;
  bossEvent.state.xp = 600;
  bossEvent.state.talents.RKF01 = ['V2-J1-A', 'V2-J2-A'];
  assert.equal(coreNode.type, 'K');
  const beforeBossCoins = bossEvent.state.coins;
  bossEvent.dispatch({ type: 'event', id: 'RK013-cross-broken-bridge' });
  bossEvent.dispatch({ type: 'fight' });
  bossEvent.dispatch({ type: 'battle_done' });
  assert.equal(bossEvent.state.progress.eliteWins, 0);
  assert.equal(bossEvent.state.progress.bossWins, 1);
  assert.equal(bossEvent.state.coins, beforeBossCoins + 30);
  const settledBossEvent = reload(bossEvent);
  assert.equal(settledBossEvent.state.progress.bossWins, 1, 'reload must not count the settled boss event twice');
  assert.equal(settledBossEvent.state.coins, beforeBossCoins + 30, 'reload must not pay the boss event bounty twice');
});

function makeReplayBattle(seed, rules) {
  registerCombatWorker({ calculateStats, simulateBattle });
  const game = make(seed);
  game.state.artifacts = [{ id: 'RC09', stacks: 3 }];
  game.state.equipment = { slots: ['RC09'] };
  game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
  game.dispatch({ type: 'fight' });

  const input = structuredClone(game.state.battleInput);
  input.roundLimit = 4;
  input.player.n = 0;
  input.player.talents = [];
  input.player.baseStats = { attack: 40, defense: 0, max_hp: 100_000, crit_rate: 0, speed: 10 };
  input.player.hp = 100_000;
  input.enemy.n = 0;
  input.enemy.talents = [];
  input.enemy.artifacts = [];
  input.enemy.baseStats = { attack: 1, defense: 50, max_hp: 100_000, crit_rate: 0, speed: 1 };

  if (rules === undefined) delete input.rules;
  else input.rules = rules;
  game.state.battleInput = input;
  game.state.battle = simulateBattle(content, input.player, input.enemy, input.seed, {
    roundLimit: input.roundLimit,
    artifactAwakenings: input.rules === 'awakening-v1',
  });
  return game;
}

test('new awakening-marked and legacy unmarked battle replays restore with their original rules', () => {
  const current = makeReplayBattle('real-replay-rules', 'awakening-v1');
  const currentPayload = JSON.parse(serializeRun(current));
  assert.equal(currentPayload.replay, 'deterministic-input-v1');
  assert.equal(currentPayload.state.battleInput.rules, 'awakening-v1');
  assert.equal(parseRunSave(content, JSON.stringify(currentPayload)).battleInput.rules, 'awakening-v1');

  const legacy = makeReplayBattle('real-replay-rules', undefined);
  const legacyPayload = JSON.parse(serializeRun(legacy));
  assert.equal(legacyPayload.replay, 'deterministic-input-v1');
  assert.equal(legacyPayload.state.battleInput.rules, undefined);
  const replayedLegacy = parseRunSave(content, JSON.stringify(legacyPayload));
  assert.equal(replayedLegacy.battleInput.rules, undefined);
  assert.equal(replayedLegacy.battle.enemyHp, legacy.state.battle.enemyHp);
  assert.notEqual(current.state.battle.enemyHp, legacy.state.battle.enemyHp,
    'full RC09 awakening must produce a distinct real-combat result from legacy rules');
});
