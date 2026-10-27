import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import {
  ShanhaiGame,
  registerCombatWorker,
  validateBattleResult,
  validateRunState,
} from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';

const loaded = await loadContent();
const entities = loaded.entities;
const byId = new Map(entities.map(entity => [entity.id, entity]));
const authoredRules = byId.get('RULES');
const content = {
  version: loaded.manifest.content_version,
  entities,
  byId,
  rules: authoredRules,
};

const testRules = structuredClone(authoredRules);
testRules.economy.reward_seeking = {
  price: 8,
  max_per_act: 1,
  families: {
    sword: ['RC02', 'RC03', 'RC04', 'RR02', 'RR03'],
    guard: ['RC03', 'RC04', 'RC05', 'RR03', 'RR04'],
    vitality: ['RC05', 'RC06', 'RR04'],
    affliction: ['RC01', 'RR01'],
  },
};
const testContent = { ...content, rules: testRules };

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

function make(seed, sourceContent = testContent) {
  installCombat();
  return ShanhaiGame.create(sourceContent, { seed, name: '寻缘测试', method: 'RKF01' });
}

function makeReward(seed, sourceContent = testContent) {
  const game = make(seed, sourceContent);
  game.state._coreRewardOffered = true;
  game.startAct(2);
  const node = game.availableNodes()[0];
  assert.equal(node.type, 'C');
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'reward');
  return game;
}

function firstCoreReward(seed) {
  const game = make(seed);
  const node = game.availableNodes()[0];
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  return game;
}

function withRules(sourceContent, rules) {
  return { ...sourceContent, rules };
}

test('authored reward-seeking config has exact families and real unique artifact references', () => {
  const config = authoredRules.economy.reward_seeking;
  assert.ok(config);
  assert.equal(config.price, 8);
  assert.equal(config.max_per_act, 1);
  assert.deepEqual(Object.keys(config.families).sort(), ['affliction', 'guard', 'sword', 'vitality']);
  for (const ids of Object.values(config.families)) {
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => byId.get(id)?.kind === 'artifact'));
  }
  assert.doesNotThrow(() => make('v2-seeking-authored-rules', content));

  const invalidConfigs = [
    { ...testRules.economy.reward_seeking, price: 8.5 },
    { ...testRules.economy.reward_seeking, max_per_act: 2 },
    {
      ...testRules.economy.reward_seeking,
      families: { ...testRules.economy.reward_seeking.families, extra: ['RC01'] },
    },
    {
      ...testRules.economy.reward_seeking,
      families: { ...testRules.economy.reward_seeking.families, sword: ['RC01', 'RC01'] },
    },
    {
      ...testRules.economy.reward_seeking,
      families: { ...testRules.economy.reward_seeking.families, sword: ['not-an-artifact'] },
    },
  ];
  for (const config of invalidConfigs) {
    const rules = structuredClone(testRules);
    rules.economy.reward_seeking = config;
    assert.throws(
      () => make(`v2-seeking-invalid-config-${invalidConfigs.indexOf(config)}`, withRules(content, rules)),
      /reward seeking/i,
    );
  }
});

test('the guaranteed initial core reward cannot be searched and failed commands are unchanged', () => {
  const game = firstCoreReward('v2-seeking-initial-core');
  const before = structuredClone(game.state);
  const preview = game.rewardSearchPreview('sword');

  assert.equal(preview.available, false);
  assert.equal(preview.reason, 'guaranteed-core-offer');
  assert.deepEqual(game.state, before);
  assert.throws(() => game.dispatch({ type: 'seek_reward', family: 'sword' }), /guaranteed-core-offer/);
  assert.deepEqual(game.state, before);
});

test('preview is pure; a paid search preserves rarity and legendary slots and is frozen across load', () => {
  const first = makeReward('v2-seeking-frozen');
  const second = makeReward('v2-seeking-frozen');
  const original = ['RC01', 'RR01', 'RL01'];
  first.state.rewardCandidates = original.slice();
  second.state.rewardCandidates = original.slice();

  const beforePreview = structuredClone(first.state);
  const preview = first.rewardSearchPreview('sword');
  assert.deepEqual(first.rewardSearchPreview('sword'), preview);
  assert.deepEqual(first.state, beforePreview);
  assert.deepEqual(second.rewardSearchPreview('sword'), preview);
  assert.equal(preview.available, true);
  assert.equal(preview.cost, testRules.economy.reward_seeking.price);
  assert.equal(preview.candidates.length, original.length);
  assert.equal(byId.get(preview.candidates[0]).rarity, 'common');
  assert.equal(byId.get(preview.candidates[1]).rarity, 'rare');
  assert.equal(preview.candidates[2], 'RL01', 'an offered legendary is preserved in its slot');
  assert.ok(preview.candidates[0] !== original[0]);
  assert.ok(preview.candidates[1] !== original[1]);
  assert.ok(preview.candidates.every(id =>
    testRules.economy.reward_seeking.families.sword.includes(id) || id === 'RL01'));

  const coinsBefore = first.state.coins;
  const spentBefore = first.state.progress.coinsSpent;
  first.dispatch({ type: 'seek_reward', family: 'sword' });
  assert.equal(first.state.coins, coinsBefore - preview.cost);
  assert.equal(first.state.progress.coinsSpent, spentBefore + preview.cost);
  assert.deepEqual(first.state.rewardCandidates, preview.candidates);
  assert.deepEqual(first.state.rewardSearches, [{
    act: 2,
    step: 0,
    family: 'sword',
    cost: 8,
    candidates: preview.candidates,
    resolved: false,
  }]);
  assert.equal(first.rewardSearchPreview('guard').reason, 'already-used');
  const afterPaidSearch = structuredClone(first.state);
  assert.throws(() => first.dispatch({ type: 'seek_reward', family: 'guard' }), /already-used/);
  assert.deepEqual(first.state, afterPaidSearch);

  validateRunState(testContent, first.state);
  const saved = serializeRun(first);
  const loadedState = parseRunSave(testContent, saved);
  assert.deepEqual(loadedState.rewardCandidates, preview.candidates);
  assert.deepEqual(loadedState.rewardSearches, first.state.rewardSearches);
  assert.deepEqual(new ShanhaiGame(testContent, loadedState).state.rewardCandidates, preview.candidates);

  const restored = new ShanhaiGame(testContent, loadedState);
  restored.dispatch({ type: 'reward', id: preview.candidates[0] });
  assert.equal(restored.state.rewardSearches[0].resolved, true);
  assert.ok(restored.state.artifacts.some(stack => stack.id === preview.candidates[0]));
  const resolvedSave = serializeRun(restored);
  const resolvedState = parseRunSave(testContent, resolvedSave);
  assert.equal(resolvedState.rewardSearches[0].resolved, true);
  assert.ok(resolvedState.artifacts.some(stack => stack.id === preview.candidates[0]));

  restored.startAct(3);
  const nextNode = restored.availableNodes()[0];
  restored.dispatch({ type: 'enter', id: nextNode.key });
  restored.dispatch({ type: 'fight' });
  restored.dispatch({ type: 'battle_done' });
  restored.state.rewardCandidates = original.slice();
  assert.equal(restored.rewardSearchPreview('sword').available, true,
    'a resolved act-two search does not consume act three use');
  restored.dispatch({ type: 'seek_reward', family: 'sword' });
  assert.deepEqual(restored.state.rewardSearches.map(record => record.act), [2, 3]);
});

test('an exhausted family and insufficient funds are unavailable without payment or mutation', () => {
  const unchanged = makeReward('v2-seeking-unchanged');
  unchanged.state.rewardCandidates = ['RC01', 'RR01'];
  const noChange = unchanged.rewardSearchPreview('affliction');
  assert.equal(noChange.available, false);
  assert.equal(noChange.reason, 'no-different-candidates');
  assert.deepEqual(noChange.candidates, unchanged.state.rewardCandidates);
  const beforeNoChange = structuredClone(unchanged.state);
  assert.throws(
    () => unchanged.dispatch({ type: 'seek_reward', family: 'affliction' }),
    /no-different-candidates/,
  );
  assert.deepEqual(unchanged.state, beforeNoChange);

  const fewerRules = structuredClone(testRules);
  fewerRules.economy.reward_seeking.families.affliction = ['RC01'];
  const fewer = makeReward('v2-seeking-fewer', withRules(testContent, fewerRules));
  fewer.state.rewardCandidates = ['RC01', 'RC02', 'RL01'];
  const fewerPreview = fewer.rewardSearchPreview('affliction');
  assert.equal(fewerPreview.available, true);
  assert.deepEqual(fewerPreview.candidates, ['RC01', 'RL01']);
  assert.equal(fewerPreview.candidates.length, 2, 'an exhausted slot is not filled with unrelated loot');

  const emptyRules = structuredClone(testRules);
  emptyRules.economy.reward_seeking.families.affliction = [];
  const empty = makeReward('v2-seeking-empty', withRules(testContent, emptyRules));
  empty.state.rewardCandidates = ['RC01', 'RR01'];
  const emptyPreview = empty.rewardSearchPreview('affliction');
  assert.equal(emptyPreview.available, false);
  assert.equal(emptyPreview.reason, 'no-different-candidates');
  assert.deepEqual(emptyPreview.candidates, []);

  const unaffordable = makeReward('v2-seeking-unaffordable');
  unaffordable.state.rewardCandidates = ['RC01', 'RR01', 'RL01'];
  unaffordable.state.coins = 7;
  const beforePaymentAttempt = structuredClone(unaffordable.state);
  assert.equal(unaffordable.rewardSearchPreview('sword').reason, 'cannot-pay');
  assert.throws(() => unaffordable.dispatch({ type: 'seek_reward', family: 'sword' }), /cannot-pay/);
  assert.deepEqual(unaffordable.state, beforePaymentAttempt);
});

test('unresolved search records reject tampering without mutating validated saves', () => {
  const game = makeReward('v2-seeking-tamper');
  game.state.rewardCandidates = ['RC01', 'RR01', 'RL01'];
  game.dispatch({ type: 'seek_reward', family: 'sword' });
  const snapshot = structuredClone(game.state);
  validateRunState(testContent, game.state);
  assert.deepEqual(game.state, snapshot);

  const corruptions = [
    state => { state.rewardSearches[0].cost += 1; },
    state => { state.rewardSearches[0].candidates[0] = 'RC01'; },
    state => { state.rewardSearches[0].candidates.push('RC04'); },
    state => { state.rewardSearches[0].resolved = true; },
    state => { state.rewardSearches.push(structuredClone(state.rewardSearches[0])); },
    state => { delete state.rewardSearches; },
  ];
  for (const corrupt of corruptions) {
    const corrupted = structuredClone(snapshot);
    corrupt(corrupted);
    assert.throws(() => validateRunState(testContent, corrupted));
  }

  const save = JSON.parse(serializeRun(game));
  save.state.rewardSearches[0].candidates[0] = 'RC01';
  assert.throws(() => parseRunSave(testContent, JSON.stringify(save)));
});

test('declining a searched reward also resolves its paid record', () => {
  const game = makeReward('v2-seeking-decline');
  game.state.rewardCandidates = ['RC01', 'RR01', 'RL01'];
  game.dispatch({ type: 'seek_reward', family: 'sword' });
  game.dispatch({ type: 'reward', id: null });
  assert.equal(game.state.rewardSearches.length, 1);
  assert.equal(game.state.rewardSearches[0].resolved, true);
  assert.ok(game.state.history.some(entry =>
    entry.act === game.state.rewardSearches[0].act &&
    entry.step === game.state.rewardSearches[0].step));
  assert.doesNotThrow(() => parseRunSave(testContent, serializeRun(game)));
});

test('battle validation bounds optional summons and checks cue source and owner sides', () => {
  const fighter = (method, summons) => ({
    name: method,
    method,
    hp: 100,
    maxHp: 100,
    shield: 0,
    rage: 0,
    rageCap: 100,
    statuses: {},
    ...(summons === undefined ? {} : { summons }),
  });
  const reaction = {
    round: 1,
    kind: 'reaction',
    actor: 'player',
    target: 'enemy',
    source: 'RKF05-V2-RESONANCE',
    text: 'volley',
    cue: { kind: 'sword_volley', owner: 'player', sourceId: 'RKF05-V2-RESONANCE' },
    player: fighter('RKF05', [{
      id: 'RKF05-V2-RESONANCE',
      kind: 'sword',
      count: 1,
      max: 3,
    }]),
    enemy: fighter('RKF06'),
  };
  const result = frames => ({
    outcome: 'player',
    rounds: 1,
    playerHp: 100,
    enemyHp: 0,
    frames,
    contributions: [],
  });

  assert.doesNotThrow(() => validateBattleResult(result([reaction])));
  const charge = {
    ...reaction,
    actor: 'enemy',
    target: 'enemy',
    source: 'EN-A1-B1',
    cue: { kind: 'enemy_charge', owner: 'enemy', sourceId: 'EN-A1-B1' },
    player: fighter('RKF06'),
    enemy: fighter('RKF01'),
  };
  assert.doesNotThrow(() => validateBattleResult(result([charge])));
  const chargeInterrupt = {
    ...charge,
    kind: 'status',
    actor: 'player',
    source: 'RKF06-RAGE-POISON',
  };
  assert.doesNotThrow(() => validateBattleResult(result([chargeInterrupt])));

  const invalidFrames = [
    {
      ...reaction,
      player: fighter('RKF01', reaction.player.summons),
    },
    {
      ...reaction,
      player: fighter('RKF05', [{ ...reaction.player.summons[0], count: 4 }]),
    },
    {
      ...reaction,
      player: fighter('RKF05', [{
        ...reaction.player.summons[0],
        max: Number.MAX_SAFE_INTEGER + 1,
      }]),
    },
    {
      ...reaction,
      cue: { ...reaction.cue, sourceId: 'RKF01-V2-RESONANCE' },
    },
    {
      ...reaction,
      actor: 'enemy',
    },
    {
      ...charge,
      cue: { ...charge.cue, sourceId: 'EN-A1-C1' },
    },
    {
      ...charge,
      cue: { ...charge.cue, owner: 'player' },
    },
    {
      ...chargeInterrupt,
      target: 'player',
    },
    {
      ...reaction,
      cue: { ...reaction.cue, extra: true },
    },
    {
      ...reaction,
      cue: { ...reaction.cue, sourceId: '' },
    },
    {
      ...reaction,
      cue: undefined,
    },
  ];
  for (const frame of invalidFrames) {
    assert.throws(() => validateBattleResult(result([frame])));
  }
});

test('settled event battles validate after pending event data is cleared', () => {
  let game;
  let target;
  let option;
  for (let index = 0; index < 128 && !target; index++) {
    const candidate = make(`v2-settled-event-battle-${index}`);
    const routeNodes = candidate.state.routeMap.nodes;
    for (const node of routeNodes) {
      if (node.depth !== 1 || node.type !== 'E') continue;
      const event = byId.get(node.id);
      const encounterOption = event?.options?.find(item =>
        item.encounter && (item.requirements ?? []).length === 0);
      if (encounterOption) {
        game = candidate;
        target = node;
        option = encounterOption;
        break;
      }
    }
  }
  assert.ok(game && target && option, 'expected an act-one route with an accessible encounter event');

  const first = game.availableNodes()[0];
  game.dispatch({ type: 'enter', id: first.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  assert.ok(game.availableNodes().some(node => node.key === target.key));

  game.dispatch({ type: 'enter', id: target.key });
  assert.equal(game.optionAvailability(option.id).available, true);
  game.dispatch({ type: 'event', id: option.id });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'event_result');
  assert.equal(game.state._pendingEvent, undefined);
  assert.equal(game.state._eventSettled, true);
  assert.doesNotThrow(() => validateRunState(testContent, game.state));
});

test('reward search history is tied to paid coordinates without rechecking acquired items', () => {
  const game = makeReward('v2-seeking-history-integrity');
  game.state.rewardCandidates = ['RC01', 'RR01', 'RL01'];
  game.dispatch({ type: 'seek_reward', family: 'sword' });
  const original = structuredClone(game.state);

  const invalid = [
    state => { state.rewardSearches[0].step = 1; },
    state => { state.rewardSearches[0].act = 4; },
    state => { state.rewardSearches[0].family = 'vitality'; },
    state => { state.progress.coinsSpent = 0; },
  ];
  for (const corrupt of invalid) {
    const corrupted = structuredClone(original);
    corrupt(corrupted);
    assert.throws(() => validateRunState(testContent, corrupted));
  }

  const acquiredHistoricalCandidate = structuredClone(original);
  acquiredHistoricalCandidate.artifacts.push({
    id: acquiredHistoricalCandidate.rewardSearches[0].candidates[0],
    stacks: 1,
  });
  assert.doesNotThrow(() => validateRunState(testContent, acquiredHistoricalCandidate));

  const initial = firstCoreReward('v2-seeking-forged-first-offer');
  const forgedInitialSearch = structuredClone(initial.state);
  forgedInitialSearch.rewardCandidates = ['RC02'];
  forgedInitialSearch.rewardSearches = [{
    act: 1,
    step: 0,
    family: 'sword',
    cost: testRules.economy.reward_seeking.price,
    candidates: ['RC02'],
    resolved: false,
  }];
  forgedInitialSearch.progress.coinsSpent = testRules.economy.reward_seeking.price;
  assert.throws(() => validateRunState(testContent, forgedInitialSearch));
});
