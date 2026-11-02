import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const buildDirectory = resolve(process.env.SHANHAI_V2_TEST_BUILD_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '../build/shanhai'));
const [{ calculateStats }, { ShanhaiGame, registerCombatWorker },
  { parseRunSave, serializeRun }] = await Promise.all([
  import(pathToFileURL(join(buildDirectory, 'combat.js')).href),
  import(pathToFileURL(join(buildDirectory, 'run.js')).href),
  import(pathToFileURL(join(buildDirectory, 'persistence.js')).href),
]);

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const byId = new Map(loaded.entities.map(entity => [entity.id, entity]));
const content = {
  version: loaded.manifest.content_version,
  entities: loaded.entities,
  byId,
  rules: byId.get('RULES'),
};

let nextOutcome = 'player';

function installCombat() {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player, enemy) {
      return {
        outcome: nextOutcome,
        rounds: 1,
        playerHp: nextOutcome === 'enemy' ? 0 : player.hp ?? player.baseStats.max_hp,
        enemyHp: nextOutcome === 'player' ? 0 : enemy.baseStats.max_hp,
        frames: [],
        contributions: [],
      };
    },
  });
}

function make(seed = 'v2-catalysis') {
  nextOutcome = 'player';
  installCombat();
  return ShanhaiGame.create(content, { seed, name: '炉火试炼者', method: 'RKF01' });
}

function routePath(routeMap, target) {
  const path = [target];
  while (path[0].depth > 0) {
    const parent = routeMap.nodes.find(node => node.next.includes(path[0].key));
    assert.ok(parent, `route node ${path[0].key} has a parent`);
    path.unshift(parent);
  }
  return path;
}

function prepareNode(game, act, type, idOverride) {
  game.startAct(act);
  const routeMap = game.state.routeMap;
  const target = routeMap.nodes.find(node => node.type === type && node.depth === 1) ??
    routeMap.nodes.find(node => node.type === type);
  assert.ok(target, `act ${act} route includes ${type}`);
  if (idOverride) target.id = idOverride;
  const path = routePath(routeMap, target);
  routeMap.path = path.map(node => node.key);
  path.forEach((node, index) => { node.completed = index < path.length - 1; });
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
  game.state._eventOutcome = undefined;
  game.state._pendingEvent = undefined;
  game.state.eventOption = undefined;
  game.dispatch({ type: 'enter', id: target.key });
  return target;
}

function giveFusionInputs(game) {
  game.state.artifacts = [{ id: 'RC14', stacks: 1 }, { id: 'RC15', stacks: 1 }];
  game.state.equipment = { slots: [] };
}

function makeOneFusionWin(seed) {
  const game = make(seed);
  giveFusionInputs(game);
  const target = prepareNode(game, 1, 'C');
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  assert.equal(game.state.fusionProgress.find(item => item.id === 'RL06').wins.length, 1);
  assert.equal(game.state.nodes[target.depth].completed, true);
  return game;
}

function prepareVowTalent(game) {
  game.state.xp = content.rules.cultivation.cumulative[0];
  game.state.phase = 'talent';
  const replacement = game.availableTalents().find(talent =>
    talent.tier === 1 && talent.id !== 'V2-J1-G');
  assert.ok(replacement, 'a non-vow tier-one talent is offered');
  game.dispatch({ type: 'talent', id: replacement.id });
  assert.equal(game.state.n, 1);
  assert.equal(game.state.talents.RKF01.includes(replacement.id), true);
  assert.equal(game.state.bloodVow, false);
  return replacement.id;
}

function installTreasure(game) {
  game.state.artifacts = [{ id: 'RL13', stacks: 1 }];
  game.state.equipment = { slots: ['RL13'] };
}

function encounterOption(act) {
  const event = loaded.entities.find(entity => entity.kind === 'event' && entity.acts?.includes(act) &&
    entity.options?.some(option => option.encounter && (option.requirements ?? []).length === 0));
  assert.ok(event, `act ${act} has an encounter event without authored requirements`);
  const option = event.options.find(candidate => candidate.encounter &&
    (candidate.requirements ?? []).length === 0);
  return { event, option };
}

test('event fusion catalysis records separate progress, completes atomically, and resumes after save', () => {
  const unqualified = make('catalysis-event-no-win');
  giveFusionInputs(unqualified);
  unqualified.state.coins = 500;
  prepareNode(unqualified, 2, 'E', 'RE012');
  const unqualifiedOption = byId.get('RE012').options.find(candidate => candidate.id === 'RE012-C');
  assert.deepEqual(unqualified.eventCatalysisTargets(unqualifiedOption), []);
  assert.equal(unqualified.optionAvailability(unqualifiedOption.id).reason, 'no-eligible-fusion-step');
  const unqualifiedBefore = structuredClone(unqualified.state);
  assert.throws(() => unqualified.dispatch({ type: 'event', id: unqualifiedOption.id }), /no-eligible-fusion-step/);
  assert.deepEqual(unqualified.state, unqualifiedBefore);

  const game = makeOneFusionWin('catalysis-event-fusion');
  giveFusionInputs(game);
  game.state.coins = 500;
  const event = prepareNode(game, 2, 'E', 'RE012');
  assert.equal(game.state.nodes[event.depth].id, 'RE012');
  const option = byId.get('RE012').options.find(candidate => candidate.id === 'RE012-C');
  assert.deepEqual(game.eventCatalysisTargets(option).map(target => target.id), ['RL06']);
  assert.equal(game.optionAvailability(option.id, 'RL06').available, true);
  assert.equal(game.optionAvailability(option.id, 'RL07').reason, 'invalid-catalysis-target');

  const beforeInvalid = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'event', id: option.id, targetId: 'RL07' }), /invalid-catalysis-target/);
  assert.deepEqual(game.state, beforeInvalid, 'an invalid target does not charge or advance the event');

  game.dispatch({ type: 'event', id: option.id, targetId: 'RL06' });
  assert.equal(game.state.phase, 'event_result');
  assert.equal(game.state.fusionProgress.find(item => item.id === 'RL06').wins.length, 1);
  assert.equal(game.fusionStatus().find(item => item.id === 'RL06').catalyses, 1);
  assert.equal(game.state.fusionHistory.some(item => item.id === 'RL06'), true);
  assert.equal(game.state.artifacts.some(item => ['RC14', 'RC15'].includes(item.id)), false);
  const eventSave = serializeRun(game);
  const resumed = new ShanhaiGame(content, parseRunSave(content, eventSave));
  assert.equal(resumed.state.catalyses[0].source, 'event');
  assert.equal(resumed.state.catalyses[0].targetId, 'RL06');
  assert.throws(() => resumed.dispatch({ type: 'event', id: option.id }), /No event is pending/);
  resumed.dispatch({ type: 'continue' });
  assert.match(resumed.state.history.at(-1).text, /合炼催化记录/);
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(resumed)));

  const forged = JSON.parse(eventSave);
  forged.state.catalyses[0].materials[0].id = 'RC01';
  assert.throws(() => parseRunSave(content, JSON.stringify(forged)), /catalysis|fusion/i);
});

test('event artifact growth uses the entry equipment snapshot and rejects forged evidence', () => {
  const empty = make('catalysis-growth-no-target');
  empty.state.coins = 500;
  prepareNode(empty, 3, 'E', 'RE022');
  const emptyOption = byId.get('RE022').options.find(candidate => candidate.id === 'RE022-C');
  assert.deepEqual(empty.eventCatalysisTargets(emptyOption), []);
  assert.equal(empty.optionAvailability(emptyOption.id).reason, 'no-equipped-growth-target');
  const emptyBefore = structuredClone(empty.state);
  assert.throws(() => empty.dispatch({ type: 'event', id: emptyOption.id }), /no-equipped-growth-target/);
  assert.deepEqual(empty.state, emptyBefore);

  const game = make('catalysis-artifact-growth');
  game.startAct(3);
  game.state.artifacts = [{ id: 'RC01', stacks: 2 }];
  game.state.equipment = { slots: ['RC01'] };
  game.state.coins = 500;
  prepareNode(game, 3, 'E', 'RE022');
  const option = byId.get('RE022').options.find(candidate => candidate.id === 'RE022-C');
  assert.deepEqual(game.eventCatalysisTargets(option).map(target => target.id), ['RC01']);
  game.dispatch({ type: 'event', id: option.id, targetId: 'RC01' });
  assert.equal(game.state.artifacts.find(item => item.id === 'RC01').stacks, byId.get('RC01').max_stacks);
  assert.deepEqual(
    [game.state.catalyses[0].beforeStacks, game.state.catalyses[0].afterStacks],
    [2, byId.get('RC01').max_stacks],
  );
  const save = JSON.parse(serializeRun(game));
  const forged = structuredClone(save);
  forged.state.catalyses[0].beforeStacks = 1;
  assert.throws(() => parseRunSave(content, JSON.stringify(forged)), /catalysis|equipment/i);
  const resumed = new ShanhaiGame(content, parseRunSave(content, JSON.stringify(save)));
  resumed.dispatch({ type: 'continue' });
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(resumed)));
});

test('blood vow catalysis replaces a selected first-tier talent and binds its save evidence', () => {
  const game = make('catalysis-blood-vow');
  const replacedTalent = prepareVowTalent(game);
  game.startAct(3);
  game.state.coins = 500;
  prepareNode(game, 3, 'E', 'RE021');
  const option = byId.get('RE021').options.find(candidate => candidate.id === 'RE021-D');
  assert.deepEqual(game.eventCatalysisTargets(option).map(target => target.id), ['V2-J1-G']);
  game.dispatch({ type: 'event', id: option.id, targetId: 'V2-J1-G' });
  assert.equal(game.state.talents.RKF01.includes(replacedTalent), false);
  assert.equal(game.state.talents.RKF01.includes('V2-J1-G'), true);
  assert.equal(game.state.bloodVow, true);
  assert.equal(game.state.catalyses[0].replacedTalent, replacedTalent);

  const save = JSON.parse(serializeRun(game));
  const forged = structuredClone(save);
  forged.state.catalyses[0].replacedTalent = 'V2-J1-G';
  assert.throws(() => parseRunSave(content, JSON.stringify(forged)), /catalysis|talent/i);
  const resumed = new ShanhaiGame(content, parseRunSave(content, JSON.stringify(save)));
  assert.equal(resumed.state.bloodVow, true);
  resumed.dispatch({ type: 'continue' });
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(resumed)));
});

test('RE010 keeps a free fallback and grants methods without forcing a main-method swap', () => {
  const full = make('re010-full-method-catalog');
  prepareNode(full, 2, 'E', 'RE010');
  full.state.coins = 0;
  full.state.hp = 1;
  full.state.bloodVow = true;
  full.state.ownedMethods = loaded.entities.filter(entity => entity.kind === 'method').map(entity => entity.id);
  const oldMethod = full.state.method;
  assert.equal(full.optionAvailability('RE010-A').available, true,
    'the no-cost treatment branch remains selectable at low HP with healing sealed');
  assert.equal(full.optionAvailability('RE010-C').reason, 'method-already-known');
  assert.equal(full.optionAvailability('RE010-D').reason, 'method-already-known');
  full.dispatch({ type: 'event', id: 'RE010-A' });
  assert.equal(full.state.hp, 1);
  assert.ok(full.state.coins > 0, 'the blocked-healing branch still grants its small coin reward');
  assert.equal(full.state.method, oldMethod);

  const learn = make('re010-learn-without-swap');
  prepareNode(learn, 2, 'E', 'RE010');
  learn.state.coins = 0;
  const activeMethod = learn.state.method;
  assert.equal(learn.optionAvailability('RE010-C').available, true,
    'method acquisition does not require money');
  learn.dispatch({ type: 'event', id: 'RE010-C' });
  assert.equal(learn.state.ownedMethods.includes('RKF06'), true);
  assert.equal(learn.state.method, activeMethod, 'learning a method does not force an immediate swap');
  assert.equal(learn.state._swapAvailable, undefined);
});

test('rest service catalysis needs a real win, charges once, completes, and survives reload', () => {
  const unqualified = make('catalysis-service-no-win');
  giveFusionInputs(unqualified);
  prepareNode(unqualified, 2, 'R');
  unqualified.state.coins = 500;
  assert.equal(unqualified.fusionCatalysisAvailability('RL06').reason, 'needs-real-win');
  const unqualifiedBefore = structuredClone(unqualified.state);
  assert.throws(() => unqualified.dispatch({ type: 'catalyze_fusion', id: 'RL06' }), /needs-real-win/);
  assert.deepEqual(unqualified.state, unqualifiedBefore);

  const game = makeOneFusionWin('catalysis-service');
  giveFusionInputs(game);
  const rest = prepareNode(game, 2, 'R');
  game.state.coins = 500;
  const offer = game.fusionCatalysisAvailability('RL06');
  assert.equal(offer.available, true);
  const before = game.state.coins;
  game.dispatch({ type: 'catalyze_fusion', id: 'RL06' });
  assert.equal(game.state.phase, 'map');
  assert.equal(game.state.coins, before - offer.price);
  assert.deepEqual(game.state.fusionHistory.map(item => item.id), ['RL06']);
  assert.equal(game.state.catalyses[0].source, 'rest');
  assert.equal(game.state.catalyses[0].step, rest.depth);
  assert.equal(game.state.artifacts.some(item => ['RC14', 'RC15'].includes(item.id)), false);
  const saved = serializeRun(game);
  const resumed = new ShanhaiGame(content, parseRunSave(content, saved));
  const replay = structuredClone(resumed.state);
  assert.throws(() => resumed.dispatch({ type: 'catalyze_fusion', id: 'RL06' }), /unavailable|not-service|already-complete/);
  assert.deepEqual(resumed.state, replay);

  const missingMaterials = makeOneFusionWin('catalysis-service-missing-materials');
  missingMaterials.state.artifacts = [];
  prepareNode(missingMaterials, 2, 'S');
  missingMaterials.state.coins = 500;
  assert.equal(missingMaterials.fusionCatalysisAvailability('RL06').reason, 'missing-materials');
  const missingBefore = structuredClone(missingMaterials.state);
  assert.throws(() => missingMaterials.dispatch({ type: 'catalyze_fusion', id: 'RL06' }), /missing-materials/);
  assert.deepEqual(missingMaterials.state, missingBefore);
});

test('every successful event and service catalysis keeps its own saved history record', () => {
  const game = make('catalysis-history-completeness');
  game.state.artifacts = [
    { id: 'RC14', stacks: 1 },
    { id: 'RC15', stacks: 1 },
    { id: 'RC01', stacks: 2 },
  ];
  game.state.equipment = { slots: ['RC01'] };
  game.state.coins = 500;

  prepareNode(game, 1, 'C');
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  assert.equal(game.state.fusionProgress.find(record => record.id === 'RL06').wins.length, 1);

  prepareNode(game, 2, 'R');
  game.state.coins = 500;
  game.dispatch({ type: 'catalyze_fusion', id: 'RL06' });
  assert.equal(game.state.catalyses[0].source, 'rest');

  game.state.coins = 500;
  prepareNode(game, 3, 'E', 'RE022');
  const growth = byId.get('RE022').options.find(option => option.id === 'RE022-C');
  game.dispatch({ type: 'event', id: growth.id, targetId: 'RC01' });
  game.dispatch({ type: 'continue' });
  assert.deepEqual(game.state.catalyses.map(record => [record.source, record.kind]), [
    ['rest', 'fusion_step'],
    ['event', 'artifact_growth'],
  ]);
  assert.ok(game.state.history.some(entry => entry.act === 2 && entry.nodeType === 'R' &&
    entry.text.includes('合炼催化记录：')));
  assert.ok(game.state.history.some(entry => entry.act === 3 && entry.eventId === 'RE022' &&
    entry.text.includes('装备点化记录：')));
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(game)));

  for (let index = 0; index < game.state.catalyses.length; index++) {
    const missing = JSON.parse(serializeRun(game));
    missing.state.catalyses.splice(index, 1);
    assert.throws(() => parseRunSave(content, JSON.stringify(missing)), /catalysis/i,
      `removing catalysis record ${index} must fail`);
    assert.throws(() => serializeRun(missing.state), /catalysis/i,
      `contentless saves must also catch missing catalysis record ${index}`);
  }
});

test('RL13 freezes battle eligibility and settles only a final victory, including event battles', () => {
  const control = make('treasure-win-control');
  prepareNode(control, 1, 'C');
  control.dispatch({ type: 'fight' });
  control.dispatch({ type: 'battle_done' });

  const win = make('treasure-win');
  installTreasure(win);
  prepareNode(win, 1, 'C');
  win.dispatch({ type: 'fight' });
  assert.equal(win.state._treasureBattleEntry.eligible, true);
  const activeSave = serializeRun(win);
  assert.doesNotThrow(() => parseRunSave(content, activeSave),
    'an eligible battle can be saved before its settlement record exists');
  const forgedActive = JSON.parse(activeSave);
  forgedActive.state._treasureBattleEntry.eligible = false;
  assert.throws(() => parseRunSave(content, JSON.stringify(forgedActive)), /treasure|battle/i);
  win.dispatch({ type: 'battle_done' });
  assert.equal(win.state._treasureBattleEntry.coins, 12);
  assert.equal(win.state.coins, control.state.coins + 12,
    'RL13 adds 12 coins on top of the ordinary battle settlement');
  assert.equal(win.state.treasureBattleRewards[0].outcome, 'player');
  assert.match(win.state.resultText, /RL13财宝战利/);
  const settled = structuredClone(win.state);
  assert.throws(() => win.dispatch({ type: 'battle_done' }), /battle/i);
  assert.deepEqual(win.state, settled, 'a settled victory cannot grant the bonus twice');
  const restored = new ShanhaiGame(content, parseRunSave(content, serializeRun(win)));
  assert.equal(restored.state.coins, control.state.coins + 12);
  assert.equal(restored.state.treasureBattleRewards[0].coins, 12);

  const loss = make('treasure-loss');
  installTreasure(loss);
  prepareNode(loss, 1, 'C');
  const lossCoinsBefore = loss.state.coins;
  nextOutcome = 'enemy';
  loss.dispatch({ type: 'fight' });
  loss.dispatch({ type: 'battle_done' });
  assert.equal(loss.state.phase, 'lost');
  assert.equal(loss.state._treasureBattleEntry.coins, 0);
  assert.equal(loss.state.treasureBattleRewards[0].outcome, 'enemy');
  assert.equal(loss.state.coins, lossCoinsBefore, 'a defeat receives no RL13 coins');
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(loss)));

  const drawn = make('treasure-draw');
  installTreasure(drawn);
  prepareNode(drawn, 1, 'C');
  nextOutcome = 'draw';
  drawn.dispatch({ type: 'fight' });
  assert.throws(() => drawn.dispatch({ type: 'battle_done' }), /drawn battle/);
  assert.equal(drawn.state._treasureBattleEntry.coins, undefined);
  assert.equal(drawn.state.treasureBattleRewards.length, 0);
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(drawn)),
    'a live draw has no settlement record until it is continued');
  nextOutcome = 'player';
  drawn.dispatch({ type: 'continue_battle' });
  drawn.dispatch({ type: 'battle_done' });
  assert.equal(drawn.state._treasureBattleEntry.coins, 12);
  assert.equal(drawn.state.treasureBattleRewards.length, 1);
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(drawn)));

  const eventGame = make('treasure-event-win');
  installTreasure(eventGame);
  const { event, option } = encounterOption(1);
  prepareNode(eventGame, 1, 'E', event.id);
  assert.equal(eventGame.optionAvailability(option.id).available, true);
  eventGame.dispatch({ type: 'event', id: option.id });
  eventGame.dispatch({ type: 'fight' });
  eventGame.dispatch({ type: 'battle_done' });
  assert.equal(eventGame.state.phase, 'event_result');
  assert.equal(eventGame.state.treasureBattleRewards[0].kind, 'event');
  assert.equal(eventGame.state.treasureBattleRewards[0].coins, 12);
  const eventResume = new ShanhaiGame(content, parseRunSave(content, serializeRun(eventGame)));
  eventResume.dispatch({ type: 'continue' });
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(eventResume)));
  const missingEventReward = JSON.parse(serializeRun(eventResume));
  missingEventReward.state.treasureBattleRewards.pop();
  assert.throws(() => parseRunSave(content, JSON.stringify(missingEventReward)), /treasure.*missing|missing.*treasure/i,
    'a completed eligible event battle also requires its history record');
});

test('each settled RL13 battle needs its own record and uses frozen past equipment', () => {
  const game = make('treasure-history-completeness');
  installTreasure(game);
  game.state.artifacts.push({ id: 'RC01', stacks: 1 });
  game.state.equipment.slots.push('RC01');

  prepareNode(game, 1, 'C');
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  game.dispatch({ type: 'reorder_equipment', id: 'RC01', direction: 'left' });

  prepareNode(game, 2, 'C');
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });
  assert.equal(game.state.treasureBattleRewards.length, 2);
  assert.equal(game.state.history.length, 2);

  assert.deepEqual(game.state.equipment.slots, ['RC01', 'RL13']);
  assert.doesNotThrow(() => parseRunSave(content, serializeRun(game)),
    'past eligibility comes from battle-entry equipment after the current loadout changes');

  for (let index = 0; index < game.state.treasureBattleRewards.length; index++) {
    const missing = JSON.parse(serializeRun(game));
    missing.state.treasureBattleRewards.splice(index, 1);
    assert.throws(() => parseRunSave(content, JSON.stringify(missing)), /treasure.*missing|missing.*treasure/i,
      `removing treasure record ${index} must fail`);
    assert.throws(() => serializeRun(missing.state), /treasure.*missing|missing.*treasure/i,
      `contentless saves must also catch missing treasure record ${index}`);
  }
});

test('new save evidence ledgers are required and forged battle reward history is rejected', () => {
  const game = make('catalysis-legacy-save');
  const current = JSON.parse(serializeRun(game));
  const previousBuild = structuredClone(current);
  previousBuild.state.buildVersion = 5;
  assert.throws(() => parseRunSave(content, JSON.stringify(previousBuild)), /build version/i);

  const withoutCatalysis = structuredClone(current);
  delete withoutCatalysis.state.catalyses;
  assert.throws(() => parseRunSave(content, JSON.stringify(withoutCatalysis)), /catalysis/i);
  const withoutTreasureHistory = structuredClone(current);
  delete withoutTreasureHistory.state.treasureBattleRewards;
  assert.throws(() => parseRunSave(content, JSON.stringify(withoutTreasureHistory)), /treasure battle/i);

  const active = make('catalysis-missing-treasure-entry');
  installTreasure(active);
  prepareNode(active, 1, 'C');
  active.dispatch({ type: 'fight' });
  const withoutTreasureEntry = JSON.parse(serializeRun(active));
  delete withoutTreasureEntry.state._treasureBattleEntry;
  assert.throws(() => parseRunSave(content, JSON.stringify(withoutTreasureEntry)), /treasure battle entry/i);

  const win = make('treasure-forged-history');
  installTreasure(win);
  prepareNode(win, 1, 'C');
  win.dispatch({ type: 'fight' });
  win.dispatch({ type: 'battle_done' });
  const forged = JSON.parse(serializeRun(win));
  forged.state.treasureBattleRewards[0].coins = 0;
  assert.throws(() => parseRunSave(content, JSON.stringify(forged)), /treasure|battle/i);
});
