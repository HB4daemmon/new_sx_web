import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import {
  ShanhaiGame,
  registerCombatWorker,
  validateRunState,
} from '../build/shanhai/run.js';

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
testRules.economy.reward_refining = { max_per_act: 1 };
testRules.economy.reward_seeking = {
  price: 8,
  max_per_act: 1,
  families: {
    sword: ['RC02', 'RC03', 'RC04', 'RC05', 'RC06'],
    guard: ['RC03', 'RC04', 'RC05', 'RC06', 'RC07'],
    vitality: ['RC05', 'RC06', 'RC12', 'RC17', 'RC24'],
    affliction: ['RC01', 'RC14', 'RC15', 'RC18'],
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

function make(seed = 'v2-refining', sourceContent = testContent) {
  installCombat();
  return ShanhaiGame.create(sourceContent, {
    seed,
    name: '炼宝测试',
    method: 'RKF01',
  });
}

function equipRefiningPair(game, {
  source = 'RC02',
  sourceStacks = 1,
  target = 'RC17',
  targetStacks = 1,
} = {}) {
  game.state.artifacts = [
    { id: source, stacks: sourceStacks },
    { id: target, stacks: targetStacks },
  ];
  game.state.equipment = { slots: [target] };
  game.state.hp = game.stats.max_hp - 50;
}

function openReward(game, node) {
  assert.equal(node.type, 'C');
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'reward');
  assert.ok(game.state.rewardCandidates.length > 0);
  assert.ok(game.state.rewardCandidates.every(id => byId.get(id)?.rarity === 'common'));
}

function completeEvent(game, node) {
  assert.ok(node.type === 'E' || node.type === 'K');
  game.dispatch({ type: 'enter', id: node.key });
  const event = byId.get(node.id);
  const option = event.options.find(candidate =>
    !candidate.rewards?.some(reward => reward.type === 'swap_method') &&
    game.optionAvailability(candidate.id).available);
  assert.ok(option, `event ${event.id} must have an available non-swap choice`);
  game.dispatch({ type: 'event', id: option.id });
  if (game.state.phase === 'preview') {
    game.dispatch({ type: 'fight' });
    game.dispatch({ type: 'battle_done' });
  }
  assert.equal(game.state.phase, 'event_result');
  game.dispatch({ type: 'continue' });
  while (game.state.phase === 'talent') {
    game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
  }
}

function makeOrdinaryReward(seed = 'v2-refining-reward', act = 2, pair = {}) {
  const game = make(seed);
  game.state._coreRewardOffered = true;
  game.startAct(act);
  equipRefiningPair(game, pair);
  openReward(game, game.availableNodes()[0]);
  return game;
}

function assertAtomicRefineFailure(game, source, target, reason) {
  const before = structuredClone(game.state);
  const preview = game.rewardRefinePreview(source, target);
  assert.equal(preview.available, false);
  assert.equal(preview.reason, reason);
  assert.throws(
    () => game.dispatch({ type: 'refine_reward', source, target }),
    new RegExp(reason),
  );
  assert.deepEqual(game.state, before);
}

test('refining configuration is required and accepts only the exact authored limit', () => {
  assert.equal(make('v2-refining-authored-config').state.buildVersion, 5);
  for (const config of [
    undefined,
    {},
    { max_per_act: 2 },
    { max_per_act: 1.5 },
    { max_per_act: 1, extra: true },
  ]) {
    const rules = structuredClone(testRules);
    if (config === undefined) delete rules.economy.reward_refining;
    else rules.economy.reward_refining = config;
    assert.throws(
      () => make(`v2-refining-invalid-config-${JSON.stringify(config)}`, { ...testContent, rules }),
      /reward refining configuration/,
    );
  }
});

test('a frozen ordinary reward refines atomically, triggers the authored threshold, and reloads', () => {
  const game = makeOrdinaryReward('v2-refining-real-boundary', 2, {
    source: 'RC02',
    target: 'RC12',
    targetStacks: 2,
  });
  const offered = game.state.rewardCandidates.slice();
  const hpBefore = game.state.hp;
  const maxHpBefore = game.stats.max_hp;
  const coinsBefore = game.state.coins;
  const spentBefore = game.state.progress.coinsSpent;
  const previewState = structuredClone(game.state);
  const preview = game.rewardRefinePreview('RC02', 'RC12');

  assert.deepEqual(game.state, previewState, 'preview must not mutate the run');
  assert.deepEqual(preview, {
    available: true,
    reason: '',
    sourceStacks: 1,
    targetStacks: 2,
    nextStacks: 3,
    awakening: true,
    forfeited: offered,
  });

  game.dispatch({ type: 'refine_reward', source: 'RC02', target: 'RC12' });
  assert.equal(game.state.artifacts.some(stack => stack.id === 'RC02'), false,
    'the source last layer may disappear');
  assert.equal(game.state.artifacts.find(stack => stack.id === 'RC12')?.stacks, 3);
  assert.deepEqual(game.state.equipment.slots, ['RC12']);
  assert.equal(game.state.hp, hpBefore, 'a larger maximum HP does not heal');
  assert.equal(game.stats.max_hp, maxHpBefore + 10);
  assert.equal(game.state.coins, coinsBefore);
  assert.equal(game.state.progress.coinsSpent, spentBefore);
  assert.equal(game.state.rewardCandidates.length, 0);
  assert.equal(game.state.phase, 'map');
  assert.deepEqual(game.state.rewardRefinements, [{
    act: 2,
    step: 0,
    source: 'RC02',
    target: 'RC12',
    targetStacksBefore: 2,
    forfeited: offered,
  }]);
  assert.match(game.state.history.at(-1).text, /舍弃虎纹佩一层/);
  assert.match(game.state.history.at(-1).text, /回春瓶由2层炼至3层/);
  assert.ok(offered.every(id => game.state.history.at(-1).text.includes(byId.get(id).name)));
  assert.equal(game.player.journey.artifactKinds, 1);
  assert.doesNotThrow(() => validateRunState(testContent, game.state));

  const jsonReload = new ShanhaiGame(testContent, JSON.parse(JSON.stringify(game.state)));
  assert.deepEqual(jsonReload.state.rewardRefinements, game.state.rewardRefinements);
  assert.deepEqual(jsonReload.state.history, game.state.history);

  const consumedTarget = structuredClone(game.state);
  consumedTarget.artifacts = consumedTarget.artifacts.filter(stack => stack.id !== 'RC12');
  consumedTarget.equipment.slots = consumedTarget.equipment.slots.filter(id => id !== 'RC12');
  assert.doesNotThrow(() => validateRunState(testContent, consumedTarget),
    'historical sources and targets need not remain in inventory');
});

test('entry snapshots keep travel effects at the layers frozen before refinement', () => {
  const game = makeOrdinaryReward('v2-refining-entry-snapshot', 2, {
    source: 'RC02',
    target: 'RC17',
    targetStacks: 1,
  });
  const hpBefore = game.state.hp;
  const preview = game.rewardRefinePreview('RC02', 'RC17');
  assert.equal(preview.awakening, false);

  game.dispatch({ type: 'refine_reward', source: 'RC02', target: 'RC17' });

  assert.equal(game.state.artifacts.find(stack => stack.id === 'RC17')?.stacks, 2);
  assert.equal(game.state.hp, hpBefore + 2,
    'the newly added layer must not retroactively double the node-entry heal');
  assert.deepEqual(game.state._travelSnapshots.at(-1).artifacts, [
    { id: 'RC17', stacks: 1 },
  ]);
});

test('failed offers and invalid source/target pairs are rejected without mutation', () => {
  const base = makeOrdinaryReward('v2-refining-failures');

  const wrongPhase = makeOrdinaryReward('v2-refining-wrong-phase');
  wrongPhase.state.phase = 'map';
  assertAtomicRefineFailure(wrongPhase, 'RC02', 'RC17', 'not-reward-phase');

  const unsettled = makeOrdinaryReward('v2-refining-unsettled');
  unsettled.state._rewardSettled = false;
  assertAtomicRefineFailure(unsettled, 'RC02', 'RC17', 'reward-not-frozen');

  const empty = makeOrdinaryReward('v2-refining-empty');
  empty.state.rewardCandidates = [];
  assertAtomicRefineFailure(empty, 'RC02', 'RC17', 'empty-offer');

  const mixed = makeOrdinaryReward('v2-refining-mixed');
  mixed.state.rewardCandidates = ['RC01', 'RR01'];
  assertAtomicRefineFailure(mixed, 'RC02', 'RC17', 'common-only-offer-required');

  const equippedSource = makeOrdinaryReward('v2-refining-equipped-source');
  equippedSource.state.equipment.slots = ['RC02', 'RC17'];
  assertAtomicRefineFailure(equippedSource, 'RC02', 'RC17', 'source-equipped');

  const missingSource = makeOrdinaryReward('v2-refining-missing-source');
  missingSource.state.artifacts = missingSource.state.artifacts.filter(stack => stack.id !== 'RC02');
  assertAtomicRefineFailure(missingSource, 'RC02', 'RC17', 'source-not-owned');

  const missingTarget = makeOrdinaryReward('v2-refining-missing-target');
  missingTarget.state.artifacts = missingTarget.state.artifacts.filter(stack => stack.id !== 'RC17');
  missingTarget.state.equipment.slots = [];
  assertAtomicRefineFailure(missingTarget, 'RC02', 'RC17', 'target-not-owned');

  const unequippedTarget = makeOrdinaryReward('v2-refining-unequipped-target');
  unequippedTarget.state.equipment.slots = [];
  assertAtomicRefineFailure(unequippedTarget, 'RC02', 'RC17', 'target-not-equipped');

  const cappedTarget = makeOrdinaryReward('v2-refining-capped-target', 2, {
    source: 'RC02',
    target: 'RC05',
    targetStacks: 5,
  });
  assertAtomicRefineFailure(cappedTarget, 'RC02', 'RC05', 'target-capped');

  assertAtomicRefineFailure(base, 'RC02', 'RC02', 'same-artifact');
  assertAtomicRefineFailure(base, 'NOT-AN-ARTIFACT', 'RC17', 'invalid-artifact-reference');
});

test('one refinement is recorded independently in every eligible act', () => {
  const game = make('v2-refining-each-act');
  for (const act of [1, 2, 3, 4]) {
    if (act === 1) {
      equipRefiningPair(game);
      openReward(game, game.availableNodes()[0]);
      assert.equal(game.rewardRefinePreview('RC02', 'RC17').reason, 'guaranteed-core-offer');
      game.dispatch({ type: 'reward', id: null });
      completeEvent(game, game.availableNodes()[0]);
      const ordinary = game.availableNodes().find(node => node.type === 'C');
      assert.ok(ordinary, 'act one must expose a later common reward after its guaranteed core offer');
      equipRefiningPair(game);
      openReward(game, ordinary);
    } else {
      game.startAct(act);
      equipRefiningPair(game);
      openReward(game, game.availableNodes()[0]);
    }
    assert.equal(game.rewardRefinePreview('RC02', 'RC17').available, true);
    game.dispatch({ type: 'refine_reward', source: 'RC02', target: 'RC17' });
    assert.equal(game.state.rewardRefinements.at(-1).act, act);
    assert.doesNotThrow(() => validateRunState(testContent, game.state));
  }
  assert.deepEqual(game.state.rewardRefinements.map(record => record.act), [1, 2, 3, 4]);
});

test('a second ordinary reward in the same act cannot refine again', () => {
  const game = makeOrdinaryReward('v2-refining-act-limit');
  game.dispatch({ type: 'refine_reward', source: 'RC02', target: 'RC17' });
  completeEvent(game, game.availableNodes()[0]);
  const nextCommon = game.availableNodes().find(node => node.type === 'C');
  assert.ok(nextCommon, 'act two must expose another common reward after the event node');
  game.state.artifacts.push({ id: 'RC02', stacks: 1 });
  openReward(game, nextCommon);
  assertAtomicRefineFailure(game, 'RC02', 'RC17', 'already-used');
});

test('seeking before refining forfeits the searched set and resolves its paid record', () => {
  const game = makeOrdinaryReward('v2-refining-after-seek');
  const original = ['RC20', 'RC21', 'RC22'];
  game.state.rewardCandidates = original.slice();
  assert.equal(game.rewardSearchPreview('sword').available, true);
  const cost = testRules.economy.reward_seeking.price;
  const spentBefore = game.state.progress.coinsSpent;

  game.dispatch({ type: 'seek_reward', family: 'sword' });
  const searched = game.state.rewardCandidates.slice();
  assert.notDeepEqual(searched, original);
  assert.ok(searched.every(id => byId.get(id)?.rarity === 'common'));
  assert.equal(game.rewardRefinePreview('RC02', 'RC17').available, true);
  game.dispatch({ type: 'refine_reward', source: 'RC02', target: 'RC17' });

  assert.deepEqual(game.state.rewardRefinements[0].forfeited, searched);
  assert.equal(game.state.rewardSearches[0].resolved, true);
  assert.equal(game.state.progress.coinsSpent, spentBefore + cost,
    'refinement does not refund the paid search');
  assert.equal(game.state.rewardCandidates.length, 0);
  assert.notEqual(game.state.phase, 'reward');
  assert.doesNotThrow(() => validateRunState(testContent, game.state));
});

test('refinement records validate content, coordinates, common offers, and completed history', () => {
  const game = makeOrdinaryReward('v2-refining-record-validation');
  game.dispatch({ type: 'refine_reward', source: 'RC02', target: 'RC17' });
  const valid = structuredClone(game.state);
  assert.doesNotThrow(() => validateRunState(testContent, valid));
  assert.deepEqual(valid, game.state, 'validation must not mutate the run');

  const corruptions = [
    state => { delete state.rewardRefinements; },
    state => { state.rewardRefinements[0].source = 'RR01'; },
    state => { state.rewardRefinements[0].target = 'RR01'; },
    state => { state.rewardRefinements[0].source = 'RC17'; },
    state => { state.rewardRefinements[0].targetStacksBefore = 3; },
    state => { state.rewardRefinements[0].forfeited = []; },
    state => { state.rewardRefinements[0].forfeited = ['RC01', 'RC01']; },
    state => { state.rewardRefinements[0].forfeited = ['RR01']; },
    state => { state.rewardRefinements[0].forfeited = ['NOT-AN-ARTIFACT']; },
    state => { state.rewardRefinements[0].step = 1; },
    state => { state.rewardRefinements[0].act = 5; },
    state => { state.rewardRefinements[0].extra = true; },
    state => { state.history.at(-1).text = 'tampered'; },
    state => { state._travelSnapshots = []; },
  ];
  for (const corrupt of corruptions) {
    const invalid = structuredClone(valid);
    corrupt(invalid);
    assert.throws(() => validateRunState(testContent, invalid));
  }

  const duplicateAct = structuredClone(valid);
  duplicateAct.rewardRefinements.push({
    ...duplicateAct.rewardRefinements[0],
    step: 1,
  });
  assert.throws(() => validateRunState(testContent, duplicateAct), /refinement/i);
});
