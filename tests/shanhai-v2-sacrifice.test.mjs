import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';
import { nextCommand } from './shanhai-policy.mjs';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);
registerCombatWorker({ calculateStats, simulateBattle });

const BASE_STATS = {
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 200,
};

function makeContent(openingRage) {
  if (openingRage === undefined) return content;
  const entities = structuredClone(loaded.entities);
  entities.find(entity => entity.id === 'RULES').rage.opening = openingRage;
  return contentFromEntities(entities, loaded.manifest.content_version);
}

function loadout(method = 'RKF01', overrides = {}) {
  const {
    name = method,
    artifacts = [],
    talents = [],
    n = 4,
    hp,
    preparation = 0,
    firstStrike = 0,
    baseStats = {},
    permanentRule,
  } = overrides;
  return {
    name,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...baseStats },
    hp: hp ?? baseStats.max_hp ?? BASE_STATS.max_hp,
    preparation,
    firstStrike,
    journey: {
      coins: 0,
      coinsSpent: 0,
      eliteWins: 0,
      bossWins: 0,
      artifactKinds: artifacts.length,
      knownMethods: 1,
    },
    ...(permanentRule ? { permanentRule: structuredClone(permanentRule) } : {}),
  };
}

function contribution(result, id) {
  const entry = result.contributions.find(item => item.id === id);
  assert.ok(entry, `expected contribution ${id}`);
  return entry;
}

function dummy(overrides = {}) {
  return loadout('RKF01', {
    name: '木人',
    baseStats: {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000,
      crit_rate: 0,
      speed: 0,
      ...overrides.baseStats,
    },
    preparation: overrides.preparation ?? 0,
  });
}

function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
}

function selectRule(optionId, seed = optionId) {
  const game = ShanhaiGame.create(content, { seed, name: '立誓行者', method: 'RKF01' });
  const routeMap = game.state.routeMap;
  const target = routeMap.nodes.find(node => node.depth === 1 && node.type === 'E');
  assert.ok(target, 'the run route includes an event node at depth one');
  target.id = 'RE037';
  const path = [target];
  while (path[0].depth > 0) {
    const parent = routeMap.nodes.find(node => node.next.includes(path[0].key));
    assert.ok(parent, `route path reaches ${path[0].key}`);
    path.unshift(parent);
  }
  routeMap.path = path.map(node => node.key);
  path.forEach((node, index) => { node.completed = index < path.length - 1; });
  game.state.nodes = path.map(node => ({ type: node.type, id: node.id, completed: node.completed }));
  game.state.step = path.length - 1;
  game.state.phase = 'event';
  game.state.eventOption = undefined;
  game.state._eventOutcome = undefined;
  game.dispatch({ type: 'event', id: optionId });
  return game;
}

test('shattered core freezes one HP and grants a battle shield with the saved original-HP capacity', () => {
  const plain = loadout('RKF01');
  const originalMaxHp = calculateStats(content, plain).max_hp;
  const vowed = loadout('RKF01', {
    baseStats: plain.baseStats,
    permanentRule: { kind: 'shattered_core', originalMaxHp },
  });
  const stats = calculateStats(content, vowed);
  assert.equal(stats.max_hp, 1);
  assert.equal(stats.attack, 180);

  const result = simulateBattle(content, vowed, dummy(), 'sacrifice-shattered-core', { roundLimit: 1 });
  const start = result.frames.find(frame => frame.kind === 'start');
  assert.ok(start);
  assert.equal(start.player.hp, 1);
  assert.equal(start.player.maxHp, 1);
  assert.equal(start.player.maxShield, originalMaxHp * 2.5);
  assert.equal(start.player.shield, originalMaxHp * 2.5);
  assert.ok(result.frames.some(frame => frame.kind === 'shield' && frame.source === 'RE037-A'));
  assert.equal(contribution(result, 'RE037-A').shield, originalMaxHp * 2.5,
    'the permanent rule owns its actual opening shield contribution');
});

test('blind sword converts basic and derived hits to true damage, and the shield still absorbs it', () => {
  const player = loadout('RKF01', {
    baseStats: { crit_rate: 0.2 },
    permanentRule: { kind: 'blind_sword' },
  });
  const enemy = dummy({ baseStats: { defense: 1_000, speed: 300 } });
  const result = simulateBattle(content, player, enemy, 'sacrifice-blind-sword', { roundLimit: 1 });
  const converted = result.frames.filter(frame => frame.kind === 'damage' && frame.source === 'RE037-B');
  assert.ok(converted.length >= 1);
  assert.ok(contribution(result, 'RE037-B').damage > 0,
    'the legal blind-sword source remains in the battle result');
  close(converted[0].amount, 48);
  assert.equal(result.frames.some(frame => /暴击/.test(frame.text)), false);
  const shieldCreated = result.frames.find(frame => frame.kind === 'shield' && frame.actor === 'enemy');
  const normalHit = result.frames.find(frame => frame.kind === 'damage' &&
    frame.actor === 'player' && frame.source === 'RKF01-BASIC-DAMAGE');
  assert.ok(shieldCreated && normalHit);
  close(
    shieldCreated.enemy.shield - converted[0].enemy.shield,
    normalHit.amount + converted[0].amount,
  );
  assert.equal(converted[0].enemy.hp, shieldCreated.enemy.hp,
    'the enemy shield absorbs both the defense-reduced hit and converted true damage');

  const echoPlayer = loadout('RKF01', {
    artifacts: [{ id: 'RC09', stacks: 1 }],
    baseStats: { crit_rate: 0.2 },
    permanentRule: { kind: 'blind_sword' },
  });
  const echoed = simulateBattle(content, echoPlayer, dummy(), 'sacrifice-blind-sword-derived', { roundLimit: 1 });
  assert.ok(
    echoed.frames.filter(frame => frame.kind === 'damage' && frame.source === 'RE037-B').length >= 2,
    'the converted damage applies to both the basic hit and its derived echo',
  );

  const prepared = simulateBattle(content, loadout('RKF01', {
    firstStrike: 100,
    baseStats: { crit_rate: 1 },
    permanentRule: { kind: 'blind_sword' },
  }), dummy(), 'sacrifice-blind-sword-unbound-hit', { roundLimit: 1 });
  const firstStrike = prepared.frames.find(frame => frame.source === 'RKF05-TRAVEL-NEXT-STRIKE');
  assert.ok(firstStrike);
  assert.doesNotMatch(firstStrike.text, /暴击/,
    'blind sword prevents a direct critical hit even outside its own main-action context');
  const firstPlayerAction = prepared.frames.findIndex(frame => frame.kind === 'action' && frame.actor === 'player');
  const convertedAfterAction = prepared.frames.findIndex(frame => frame.kind === 'damage' && frame.source === 'RE037-B');
  assert.ok(firstPlayerAction >= 0 && convertedAfterAction > firstPlayerAction,
    'the later basic hit may convert crit chance, but the unbound travel hit does not');
});

test('blind sword leaves damage-over-time outside the conversion', () => {
  const plain = loadout('RKF04', { baseStats: { crit_rate: 0.2 } });
  const vowed = loadout('RKF04', {
    baseStats: { crit_rate: 0.2 },
    permanentRule: { kind: 'blind_sword' },
  });
  const target = dummy();
  const normal = simulateBattle(content, plain, target, 'sacrifice-blind-dot', { roundLimit: 2 });
  const converted = simulateBattle(content, vowed, target, 'sacrifice-blind-dot', { roundLimit: 2 });
  const dots = result => result.frames
    .filter(frame => frame.kind === 'dot' && frame.source === 'RKF04-BASIC-BURN')
    .map(frame => [frame.round, frame.amount]);
  assert.ok(dots(normal).length > 0);
  assert.deepEqual(dots(converted), dots(normal));
});

test('endless chain waits below the real rage cap, then spends the full cap without basic actions', () => {
  const player = loadout('RKF01', {
    artifacts: [{ id: 'RL04', stacks: 1 }],
    permanentRule: { kind: 'endless_chain' },
  });
  const rageDrainingEnemy = loadout('RKF01', {
    name: '封元木人',
    artifacts: [{ id: 'RR14', stacks: 1 }],
    baseStats: { attack: 0, defense: 0, max_hp: 1_000_000, crit_rate: 0, speed: 0 },
  });
  const result = simulateBattle(content, player, rageDrainingEnemy, 'sacrifice-endless-chain', { roundLimit: 3 });
  const start = result.frames.find(frame => frame.kind === 'start');
  assert.equal(start.player.rage, 20, 'enemy opening drain places the player below RL04’s 50-point cap');
  const waits = result.frames.filter(frame => frame.kind === 'wait' && frame.actor === 'player');
  assert.equal(waits.length, 1);
  assert.equal(waits[0].player.lockedAction, 'wait');
  const secondRound = result.frames.find(frame => frame.kind === 'round' && frame.round === 2);
  assert.ok(secondRound);
  assert.equal(secondRound.player.rageCap, 50, 'the equipped artifact sets the real rage cap');
  assert.equal(secondRound.player.lockedAction, 'rage_action');
  assert.ok(result.frames.some(frame => frame.kind === 'action' && frame.round === 2 && frame.actor === 'player' && /怒技/.test(frame.text)));
  assert.ok(contribution(result, 'RE037-C').rage > 0,
    'the actual endless-chain rule remains in the battle result');
  assert.equal(result.frames.some(frame => frame.kind === 'action' && frame.actor === 'player' && /普攻/.test(frame.text)), false);

  const opened = makeContent(100);
  const forcedPlayer = loadout('RKF02', {
    artifacts: [{ id: 'RL04', stacks: 1 }],
    permanentRule: { kind: 'endless_chain' },
  });
  const forcedPlain = loadout('RKF02', { artifacts: [{ id: 'RL04', stacks: 1 }] });
  const forcedEnemy = dummy();
  const lawResult = simulateBattle(opened, forcedPlayer, forcedEnemy, 'sacrifice-forced-basic', { roundLimit: 2 });
  const plainResult = simulateBattle(opened, forcedPlain, forcedEnemy, 'sacrifice-forced-basic', { roundLimit: 2 });
  assert.equal(
    plainResult.frames.some(frame => frame.kind === 'action' && frame.round === 2 && frame.actor === 'player' && /普攻/.test(frame.text)),
    true,
    'the comparison build receives RKF02 forced basic after its opening rage action',
  );
  assert.equal(
    lawResult.frames.some(frame => frame.kind === 'action' && frame.actor === 'player' && /普攻/.test(frame.text)),
    false,
    'the permanent rule intercepts the forced basic action',
  );
  assert.ok(lawResult.frames.some(frame => frame.kind === 'action' && frame.round === 2 && frame.actor === 'player' && /怒技/.test(frame.text)));
});

test('RE037 choices persist their source, keep the permanent marker, and reject forged save state', () => {
  const pending = selectRule('RE037-A', 'sacrifice-save-pending');
  const originalMaxHp = pending.state.permanentRule.originalMaxHp;
  assert.equal(pending.state.hp, 1);
  assert.equal(pending.stats.max_hp, 1);
  assert.equal(pending.player.permanentRule.originalMaxHp, originalMaxHp);

  const pendingSave = JSON.parse(serializeRun(pending));
  const missingMarker = structuredClone(pendingSave);
  delete missingMarker.state.permanentRule;
  assert.throws(() => parseRunSave(content, JSON.stringify(missingMarker)), /Permanent sacrifice rule/);
  const wrongKind = structuredClone(pendingSave);
  wrongKind.state.permanentRule = { kind: 'blind_sword' };
  assert.throws(() => parseRunSave(content, JSON.stringify(wrongKind)), /Permanent sacrifice rule/);

  const repeated = selectRule('RE037-A', 'sacrifice-save-repeat');
  repeated.state.phase = 'event';
  repeated.state.eventOption = undefined;
  repeated.state._eventOutcome = undefined;
  assert.equal(
    repeated.optionAvailability(content.byId.RE037.options.find(option => option.id === 'RE037-B')).reason,
    'sacrifice-already-chosen',
  );

  pending.dispatch({ type: 'continue' });
  assert.equal(pending.state.history.at(-1).eventId, 'RE037');
  assert.equal(pending.state.history.at(-1).sacrificeRule.originalMaxHp, originalMaxHp);
  const completedSave = serializeRun(pending);
  const restored = new ShanhaiGame(content, parseRunSave(content, completedSave));
  assert.equal(restored.state.permanentRule.originalMaxHp, originalMaxHp);
  assert.equal(restored.state.history.at(-1).sacrificeRule.kind, 'shattered_core');

  const tampered = JSON.parse(completedSave);
  tampered.state.permanentRule.originalMaxHp += 1;
  assert.throws(() => parseRunSave(content, JSON.stringify(tampered)), /Permanent sacrifice rule/);
});


test('endless chain ignores returning-breath forced basic while retaining three-rage limit', () => {
  const opened = makeContent(100);
  const player = loadout('RKF02', {
    artifacts: [{ id: 'RL04', stacks: 1 }, { id: 'RL05', stacks: 1 }],
    permanentRule: { kind: 'endless_chain' },
  });
  const result = simulateBattle(opened, player, dummy(), 'endless-returning-breath', { roundLimit: 1 });
  const actions = result.frames.filter(frame => frame.kind === 'action' && frame.actor === 'player');
  assert.equal(actions.length, 3, 'real rage refunds allow at most three rage actions in one round');
  assert.ok(actions.every(frame => /怒技/.test(frame.text)), 'forced basic does not disable rage chains or cause a basic');
});

test('settled battle replay rejects a changed permanent law snapshot', () => {
  const game = selectRule('RE037-A', 'sacrifice-replay-snapshot');
  game.dispatch({ type: 'continue' });
  for (let i = 0; i < 80 && game.state.phase !== 'battle' && game.state.phase !== 'lost'; i++) {
    game.dispatch(nextCommand(game, 'steady'));
  }
  assert.equal(game.state.phase, 'battle', 'the normal route reaches a battle after the sacrifice');
  assert.notEqual(game.state.battle.outcome, 'draw');
  game.dispatch({ type: 'battle_done' });
  assert.ok(game.state.battleInput, 'the settled battle keeps its frozen input');
  const payload = JSON.parse(serializeRun(game));
  payload.state.battleInput.player.permanentRule.originalMaxHp += 1;
  assert.throws(() => parseRunSave(content, JSON.stringify(payload)), /Frozen battle sacrifice rule/);
});

test('each RE037 law maps to one persistent choice and the exit grants none', () => {
  for (const [optionId, kind] of [
    ['RE037-A', 'shattered_core'],
    ['RE037-B', 'blind_sword'],
    ['RE037-C', 'endless_chain'],
  ]) {
    const game = selectRule(optionId, `sacrifice-kind-${kind}`);
    assert.equal(game.state.permanentRule.kind, kind);
    const otherOption = content.byId.RE037.options.find(option => option.id !== optionId && option.sacrifice_rule);
    game.state.phase = 'event';
    game.state.eventOption = undefined;
    game.state._eventOutcome = undefined;
    assert.equal(game.optionAvailability(otherOption).reason, 'sacrifice-already-chosen');
  }
  const exit = selectRule('RE037-D', 'sacrifice-clean-exit');
  assert.equal(exit.state.permanentRule, undefined);
  assert.match(exit.state.resultText, /没有立誓/);
});
