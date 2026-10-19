import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContent } from '../tools/content-kit/src/loader.mjs';
import {
  ShanhaiGame,
  registerCombatWorker,
} from '../build/shanhai/run.js';
import {
  loadRun,
  parseRunSave,
  saveRun,
  serializeRun,
} from '../build/shanhai/persistence.js';
import {
  characterJourneys,
  eventEchoes,
} from '../build/shanhai/narrative.js';

const loaded = await loadContent();
const content = {
  version: loaded.manifest.content_version,
  entities: loaded.entities,
  byId: loaded.byId,
  rules: loaded.entities.find(entity => entity.id === 'RULES'),
};
const narrativeContent = {
  ...content,
  byId: Object.fromEntries(loaded.byId),
};

function storage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

function installCombat({ outcome = 'player', playerHp, onBattle } = {}) {
  registerCombatWorker({
    calculateStats(_content, loadout) {
      return structuredClone(loadout.baseStats);
    },
    simulateBattle(_content, player, enemy, seed, options = {}) {
      onBattle?.({ player: structuredClone(player), enemy: structuredClone(enemy), seed, options });
      return {
        outcome,
        rounds: options.roundLimit ?? 1,
        playerHp: playerHp ?? (outcome === 'player' ? player.hp ?? player.baseStats.max_hp : 0),
        enemyHp: outcome === 'player' ? 0 : 100,
        frames: [],
        contributions: [],
      };
    },
  });
}

function make(seed = 'story-runtime', method = 'RKF01') {
  return ShanhaiGame.create(content, { seed, name: '测试者', method });
}

function makeWithStoryline(storyline, prefix) {
  for (let seed = 0; seed < 256; seed++) {
    const candidate = make(`${prefix}-${seed}`);
    if (candidate.state.storyline === storyline) return candidate;
  }
  throw new Error(`No seed selected storyline ${storyline}`);
}

function directOption(game) {
  const event = content.byId.get(game.node.id);
  const option = event.options.find(candidate =>
    !candidate.encounter && game.optionAvailability(candidate).available);
  assert.ok(option, `expected ${event.id} to offer an available direct choice`);
  return option;
}

function resolvingOption(game) {
  const event = content.byId.get(game.node.id);
  return event.options.find(candidate =>
    !candidate.encounter &&
    !candidate.rewards?.some(reward => ['method', 'swap_method'].includes(reward.type)) &&
    game.optionAvailability(candidate).available) ??
    event.options.find(candidate =>
      !candidate.encounter && game.optionAvailability(candidate).available) ??
    event.options.find(candidate => game.optionAvailability(candidate).available);
}

function resolveCurrentNode(game) {
  let guard = 0;
  while (game.state.phase !== 'map' && !['won', 'lost'].includes(game.state.phase) && guard++ < 40) {
    if (game.state.phase === 'preview') game.dispatch({ type: 'fight' });
    else if (game.state.phase === 'battle') {
      if (game.state.battle.outcome === 'draw') game.dispatch({ type: 'continue_battle' });
      else game.dispatch({ type: 'battle_done' });
    } else if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    else if (game.state.phase === 'event') {
      const option = resolvingOption(game);
      assert.ok(option, `expected ${game.node.id} to expose an available option`);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    else if (game.state.phase === 'shop') game.dispatch({ type: 'leave_shop' });
    else if (game.state.phase === 'rest') {
      if (game.state._restFromEvent) {
        const method = game.state.ownedMethods.find(id => id !== game.state.method);
        assert.ok(method, 'event method swap requires another owned method');
        game.dispatch({ type: 'rest', choice: 'swap_method', method });
      } else game.dispatch({ type: 'rest', choice: 'heal' });
    } else if (game.state.phase === 'talent') {
      game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
    } else if (game.state.phase === 'transition') game.dispatch({ type: 'continue' });
    else throw new Error(`Unhandled phase ${game.state.phase}`);
  }
  assert.ok(guard < 40, 'node did not resolve');
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
    const target = starts.find(node => node.key === path[0]);
    assert.ok(target, 'planned route node is no longer reachable');
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

function reload(game, store) {
  saveRun(game, store);
  const result = loadRun(content, store);
  assert.ok(result);
  return result;
}

function economySnapshot(state) {
  return {
    xp: state.xp,
    coins: state.coins,
    artifacts: structuredClone(state.artifacts),
    n: state.n,
    method: state.method,
    talents: structuredClone(state.talents),
    rewardCandidates: structuredClone(state.rewardCandidates),
    ordinaryCount: state.ordinaryCount,
  };
}

test('a direct event choice is stored as a successful completed history entry', () => {
  installCombat();
  const game = make('direct-event-history');
  routeToNode(game, node => node.type === 'E');
  const eventId = game.node.id;
  const option = directOption(game);

  game.dispatch({ type: 'event', id: option.id });
  assert.equal(game.state.phase, 'event_result');
  assert.equal(game.state._eventOutcome, 'success');
  game.dispatch({ type: 'continue' });

  const entry = game.state.history.at(-1);
  assert.equal(entry.eventId, eventId);
  assert.equal(entry.optionId, option.id);
  assert.equal(entry.eventOutcome, 'success');
});

function completeRS05FirstEncounter(outcome) {
  installCombat();
  let game = makeWithStoryline('RS05', `rs05-${outcome}`);
  reachAct(game, 2);
  routeToNode(game, node => node.type === 'K' && node.id === 'RK009');
  assert.equal(game.state.phase, 'event');

  const store = storage();
  const optionId = 'RK009-enter-first-array';
  game.dispatch({ type: 'event', id: optionId });
  assert.equal(game.state.phase, 'preview');
  assert.equal(game.state._eventOutcome, undefined);
  game = reload(game, store);
  assert.equal(game.state._pendingEvent.eventId, 'RK009');
  assert.equal(game.state._pendingEvent.optionId, optionId);

  installCombat({
    outcome,
    playerHp: outcome === 'player' ? 431 : 0,
  });
  game.dispatch({ type: 'fight' });
  assert.equal(game.state.phase, 'battle');
  game = reload(game, store);
  assert.equal(game.state._pendingEvent.eventId, 'RK009');

  const thresholds = [120, 600, 1200, 2040];
  assert.ok(game.state.n < 4, 'the second-act encounter should leave a talent tier available');
  game.state.xp = Math.max(game.state.xp, thresholds[game.state.n]);
  game.dispatch({ type: 'battle_done' });

  const expectedOutcome = outcome === 'player' ? 'success' : 'failure';
  assert.equal(game.state.phase, 'talent');
  assert.equal(game.state._eventOutcome, expectedOutcome);
  assert.equal(game.state.flags['RS05-promised'] ?? false, outcome === 'player');
  game = reload(game, store);
  assert.equal(game.state.phase, 'talent');
  assert.equal(game.state._eventOutcome, expectedOutcome);
  assert.equal(game.state.flags['RS05-promised'] ?? false, outcome === 'player');

  const talent = game.availableTalents()[0];
  assert.ok(talent, 'the encounter result should preserve its pending talent choice');
  game.dispatch({ type: 'talent', id: talent.id });
  assert.equal(game.state.phase, 'event_result');
  game = reload(game, store);
  assert.equal(game.state._eventOutcome, expectedOutcome);

  game.dispatch({ type: 'continue' });
  const entry = game.state.history.find(item => item.eventId === 'RK009');
  assert.ok(entry);
  assert.equal(entry.optionId, optionId);
  assert.equal(entry.eventOutcome, expectedOutcome);
  assert.equal(game.state.flags['RS05-promised'] ?? false, outcome === 'player');
  game = reload(game, store);
  assert.equal(game.state.history.find(item => item.eventId === 'RK009').eventOutcome, expectedOutcome);
  return game;
}

test('RS05 internal battle success and failure survive saves, talent boundary, and completed history', () => {
  const won = completeRS05FirstEncounter('player');
  assert.equal(won.state.flags['RS05-promised'], true);

  const failed = completeRS05FirstEncounter('enemy');
  assert.notEqual(failed.state.flags['RS05-promised'], true);
  assert.equal(failed.state.hp, 1, 'the failed first trial remains nonlethal at its authored floor');
});

test('legacy event history without an outcome remains readable and indeterminate', () => {
  const failed = completeRS05FirstEncounter('enemy');
  const payload = JSON.parse(serializeRun(failed));
  const entry = payload.state.history.find(item => item.eventId === 'RK009');
  delete entry.eventOutcome;
  delete payload.state.flags['RS05-promised'];

  const restored = parseRunSave(content, JSON.stringify(payload));
  const restoredEntry = restored.history.find(item => item.eventId === 'RK009');
  assert.equal(restoredEntry.eventOutcome, undefined);
  const echoes = eventEchoes(narrativeContent, restored, 2, 36);
  assert.ok(!echoes.some(echo => echo.id === 'RK009'));
  const journey = characterJourneys(narrativeContent, restored).find(item => item.id === 'RS05');
  assert.equal(journey.status, '初遇结果不明');
  assert.doesNotMatch(journey.text, /闯过|获胜|第二阵资格/);
});

test('invalid event outcomes in saved history and active state are rejected', () => {
  const failed = completeRS05FirstEncounter('enemy');

  const invalidHistory = JSON.parse(serializeRun(failed));
  invalidHistory.state.history.find(item => item.eventId === 'RK009').eventOutcome = 'unknown';
  assert.throws(
    () => parseRunSave(content, JSON.stringify(invalidHistory)),
    /Invalid event history outcome/,
  );

  const invalidActiveOutcome = JSON.parse(serializeRun(failed));
  invalidActiveOutcome.state._eventOutcome = 'unknown';
  assert.throws(
    () => parseRunSave(content, JSON.stringify(invalidActiveOutcome)),
    /Invalid event outcome/,
  );
});

test('a battle entered immediately after an event clears the event result text', () => {
  installCombat();
  const game = make('event-then-battle');
  const eventRouteNode = routeToNode(game, node => node.type === 'E' &&
    node.next.some(key => ['C', 'L', 'B'].includes(game.state.routeMap.nodes
      .find(candidate => candidate.key === key)?.type)));
  const priorNode = game.node;
  const eventId = priorNode.id;
  const option = directOption(game);
  game.dispatch({ type: 'event', id: option.id });
  const oldResult = game.state.resultText;
  assert.ok(oldResult);
  resolveCurrentNode(game);
  assert.equal(game.state.history.at(-1).eventId, eventId);

  const nextBattle = game.state.routeMap.nodes
    .filter(node => eventRouteNode.next.includes(node.key) && ['C', 'L', 'B'].includes(node.type))
    .find(node => game.availableNodes().some(available => available.key === node.key));
  assert.ok(nextBattle, 'the event should be directly followed by a reachable battle');
  game.dispatch({ type: 'enter', id: nextBattle.key });
  assert.equal(game.state.resultText, '');
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  const key = nextBattle.type === 'B' ? 'boss' : nextBattle.type === 'L' ? 'elite' : 'common';
  assert.equal(game.state.resultText, game.actContent.story.battle_after[key] ??
    game.actContent.story.boss_variants[nextBattle.id]);
  assert.notEqual(game.state.resultText, oldResult);
});

test('all four acts use the matching short text for each actual battle node type', () => {
  installCombat();
  const game = make('four-act-battle-story');
  for (let act = 1; act <= 4; act++) {
    if (game.state.act < act) reachAct(game, act);
    for (const type of ['C', 'L', 'B']) {
      const target = routeToNode(game, node => node.type === type);
      assert.equal(game.state.act, act);
      assert.equal(game.node.type, type);
      const enemyId = game.node.id;
      game.dispatch({ type: 'fight' });
      game.dispatch({ type: 'battle_done' });

      const story = content.byId.get(`RA0${act}`).story;
      const expected = type === 'C'
        ? story.battle_after.common
        : type === 'L'
          ? story.battle_after.elite
          : story.boss_variants[enemyId];
      assert.ok(expected, `act ${act} needs authored ${type} story for ${enemyId}`);
      assert.equal(game.state.resultText, expected, `act ${act} ${type} ${enemyId}`);
      if (type === 'B') {
        for (const [otherId, otherText] of Object.entries(story.boss_variants)) {
          if (otherId !== enemyId) assert.ok(!game.state.resultText.includes(otherText));
        }
      }
      resolveCurrentNode(game);
    }
  }
  assert.equal(game.state.act, 5);
});

function enterFinalBattle(seed) {
  installCombat();
  const game = make(seed);
  reachAct(game, 5);
  const finalNode = routeToNode(game, node => node.type === 'F');
  assert.equal(finalNode.type, 'F');
  return game;
}

test('final victory uses the actual final variant plus shared victory text without new economy', () => {
  const game = enterFinalBattle('final-story-win');
  const enemyId = game.node.id;
  const enemy = content.byId.get(enemyId);
  const story = content.byId.get('RF01').story;
  const before = economySnapshot(game.state);
  const nodeCount = game.state.nodes.length;

  installCombat({ outcome: 'player', playerHp: 317 });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });

  const expected = `${story.boss_variants[enemyId]} ${story.victory}`;
  assert.equal(game.state.phase, 'won');
  assert.equal(game.state.resultText, expected);
  assert.equal(game.state.history.at(-1).text, expected);
  assert.equal(game.state.history.at(-1).title, enemy.name);
  assert.equal(game.state.hp, 317);
  assert.equal(game.state.nodes.length, nodeCount);
  assert.deepEqual(economySnapshot(game.state), before);
  for (const [otherId, otherText] of Object.entries(story.boss_variants)) {
    if (otherId !== enemyId) assert.ok(!game.state.resultText.includes(otherText));
  }
});

test('final defeat uses defeat text and grants no victory history or economy', () => {
  const game = enterFinalBattle('final-story-loss');
  const enemyId = game.node.id;
  const enemy = content.byId.get(enemyId);
  const story = content.byId.get('RF01').story;
  const before = economySnapshot(game.state);
  const historyLength = game.state.history.length;
  const nodeCount = game.state.nodes.length;

  installCombat({ outcome: 'enemy', playerHp: 23 });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });

  assert.equal(game.state.phase, 'lost');
  assert.equal(game.state.resultText, `你在${enemy.name}前倒下。${story.defeat}`);
  assert.equal(game.state.hp, 23);
  assert.equal(game.state.history.length, historyLength);
  assert.equal(game.state.nodes.length, nodeCount);
  assert.deepEqual(economySnapshot(game.state), before);
  assert.doesNotMatch(game.state.resultText, /终于有了出口|散作细雨|昼夜劫相消散/);
  assert.ok(!story.boss_variants[enemyId] || !game.state.resultText.includes(story.boss_variants[enemyId]));
});
