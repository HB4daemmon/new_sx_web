import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const { name = method, talents = [], n = 4, hp, ...stats } = overrides;
  return {
    name,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
  };
}

function makeEnemy(overrides = {}) {
  return makeLoadout('RKF06', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function patchContent(edit) {
  const entities = structuredClone(content.entities);
  edit(entities);
  return contentFromEntities(entities, content.version);
}

function withOpeningRage(amount) {
  return patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = amount;
  });
}

function resonance(entities, id) {
  const artifact = entities.find(item => item.id === id);
  const effect = artifact.effects.find(item => item.id === `${id}-V2-RESONANCE`);
  assert.ok(effect, `missing ${id} resonance`);
  return effect;
}

function framesFrom(result, kind, source, actor) {
  return result.frames.filter(frame =>
    frame.kind === kind && frame.source === source &&
    (actor === undefined || frame.actor === actor));
}

function damageFrom(result, source, actor) {
  return framesFrom(result, 'damage', source, actor);
}

function contribution(result, id) {
  const item = result.contributions.find(entry => entry.id === id);
  assert.ok(item, `missing contribution ${id}`);
  return item;
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

function combatDefense(activeContent, loadout) {
  let defense = calculateStats(activeContent, loadout).defense;
  const method = activeContent.byId[loadout.method];
  for (const effect of method.passives ?? []) {
    if (effect.trigger !== 'battle_start' || effect.operation !== 'modify_stat' ||
        effect.params?.stat !== 'defense') continue;
    const amount = effect.params?.amount ?? effect.params?.flat ?? 0;
    defense = effect.params?.mode === 'percent_add' ? defense * (1 + amount) : defense + amount;
  }
  return Math.max(0, defense);
}

function expectedDerivedDamage(activeContent, attacker, defender, ratio) {
  const attack = calculateStats(activeContent, attacker).attack;
  const defense = combatDefense(activeContent, defender);
  return attack * ratio * 100 / (100 + defense);
}

test('RL06 detonates one owned poison and burn layer before RR11 consumes the next pair', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const venom = resonance(entities, 'RR03');
    venom.params.hit_threshold = 1;
    venom.params.poison_stacks = 2;
    venom.params.max_per_action = 1;
  });
  const player = makeLoadout('RKF09', [
    { id: 'RL06', stacks: 1 },
    { id: 'RR03', stacks: 1 },
    { id: 'RR11', stacks: 1 },
  ], { attack: 100, speed: 30 });
  const result = simulateBattle(activeContent, player, makeEnemy(), 'fusion-toxic-rr11-order', { roundLimit: 1 });
  const attack = calculateStats(activeContent, player).attack;
  const defense = combatDefense(activeContent, makeEnemy());
  const oneLayerRemaining = attack * 0.08 * 3;
  const rl06 = damageFrom(result, 'RL06', 'player');
  const rr11 = damageFrom(result, 'RR11-V2-RESONANCE', 'player');

  assert.equal(rl06.length, 1);
  assert.equal(rr11.length, 1);
  near(rl06[0].amount, oneLayerRemaining * 2 * 1.2 * 100 / (100 + defense));
  near(rr11[0].amount, oneLayerRemaining * 2 * 0.8 * 100 / (100 + defense));
  assert.ok(result.frames.findIndex(frame => frame === rl06[0]) <
    result.frames.findIndex(frame => frame === rr11[0]), 'RL06 resolves before RR11');
  assert.equal(result.frames.at(-1).enemy.statuses.poison ?? 0, 0);
  assert.equal(result.frames.at(-1).enemy.statuses.burn, 1,
    'only the third burn layer remains after RL06 and RR11 consume one each');
  near(contribution(result, 'RL06').damage, rl06[0].amount);
  assert.ok(contribution(result, 'RR11').rage >= 8);
  assert.deepEqual(
    result,
    simulateBattle(activeContent, player, makeEnemy(), 'fusion-toxic-rr11-order', { roundLimit: 1 }),
    'the fusion sequence is deterministic for a replay seed',
  );
});

test('RL06 resolves with the same damage when equipped by the enemy', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const venom = resonance(entities, 'RR03');
    venom.params.hit_threshold = 1;
    venom.params.poison_stacks = 2;
    venom.params.max_per_action = 1;
  });
  const playerOwner = makeLoadout('RKF09', [
    { id: 'RL06', stacks: 1 },
    { id: 'RR03', stacks: 1 },
  ], { speed: 30 });
  const enemyOwner = makeLoadout('RKF09', [
    { id: 'RL06', stacks: 1 },
    { id: 'RR03', stacks: 1 },
  ], { speed: 30 });
  const playerRun = simulateBattle(
    activeContent,
    playerOwner,
    makeEnemy(),
    'fusion-toxic-player-owner',
    { roundLimit: 1 },
  );
  const enemyRun = simulateBattle(
    activeContent,
    makeLoadout('RKF06', [], { speed: 1 }),
    enemyOwner,
    'fusion-toxic-enemy-owner',
    { roundLimit: 1 },
  );
  const playerHit = damageFrom(playerRun, 'RL06', 'player');
  const enemyHit = damageFrom(enemyRun, 'RL06', 'enemy');

  assert.equal(playerHit.length, 1);
  assert.equal(enemyHit.length, 1);
  near(enemyHit[0].amount, playerHit[0].amount);
  assert.ok(contribution(playerRun, 'RL06').damage > 0);
  assert.equal(enemyRun.contributions.some(item => item.id === 'RL06'), false);
});

test('RL06 adds only the missing status, and does nothing when neither owned status exists', () => {
  const poisonOnly = simulateBattle(
    withOpeningRage(100),
    makeLoadout('RKF06', [{ id: 'RL06', stacks: 1 }], { speed: 30 }),
    makeEnemy(),
    'fusion-poison-only',
    { roundLimit: 1 },
  );
  const addedBurn = framesFrom(poisonOnly, 'status', 'RL06', 'player');
  assert.equal(addedBurn.length, 1);
  assert.match(addedBurn[0].text, /补入1层燃烧/);
  assert.equal(addedBurn[0].enemy.statuses.poison, 2);
  assert.equal(addedBurn[0].enemy.statuses.burn, 1);
  assert.equal(damageFrom(poisonOnly, 'RL06').length, 0);

  const burnOnly = simulateBattle(
    withOpeningRage(0),
    makeLoadout('RKF09', [{ id: 'RL06', stacks: 1 }], { speed: 30 }),
    makeEnemy(),
    'fusion-burn-only',
    { roundLimit: 1 },
  );
  const addedPoison = framesFrom(burnOnly, 'status', 'RL06', 'player');
  assert.equal(addedPoison.length, 1);
  assert.match(addedPoison[0].text, /补入1层中毒/);
  assert.equal(addedPoison[0].enemy.statuses.poison, 1);
  assert.equal(addedPoison[0].enemy.statuses.burn, 1);
  assert.equal(damageFrom(burnOnly, 'RL06').length, 0);

  const neither = simulateBattle(
    withOpeningRage(0),
    makeLoadout('RKF01', [{ id: 'RL06', stacks: 1 }], { speed: 30 }),
    makeEnemy(),
    'fusion-no-status',
    { roundLimit: 1 },
  );
  assert.equal(neither.frames.some(frame => frame.source === 'RL06'), false);
  assert.equal(contribution(neither, 'RL06').triggers, 0);
  assert.equal(contribution(neither, 'RL06').damage, 0);

  const unequipped = simulateBattle(
    withOpeningRage(0),
    makeLoadout('RKF01', [], { speed: 30 }),
    makeEnemy(),
    'fusion-toxic-unequipped',
    { roundLimit: 1 },
  );
  assert.equal(unequipped.frames.some(frame => frame.source === 'RL06'), false);
  assert.equal(unequipped.contributions.some(item => item.id === 'RL06'), false);
});

test('RL06 fusion_rule validation rejects the wrong kind and unknown fields', () => {
  const player = makeLoadout('RKF01', [{ id: 'RL06', stacks: 1 }]);
  const enemy = makeEnemy();
  const wrongKind = patchContent(entities => {
    entities.find(item => item.id === 'RL06').fusion_rule.kind = 'twin_swords';
  });
  assert.throws(() => simulateBattle(wrongKind, player, enemy, 'fusion-invalid-kind'), /fusion_rule/);

  const unknownField = patchContent(entities => {
    entities.find(item => item.id === 'RL06').fusion_rule.extra = true;
  });
  assert.throws(() => simulateBattle(unknownField, player, enemy, 'fusion-unknown-field'), /fusion_rule/);
});

test('RL07 adds two noncritical 0.4 attack hits and those hits can trigger RR03', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    resonance(entities, 'RR03').params.hit_threshold = 3;
  });
  const player = makeLoadout('RKF01', [
    { id: 'RL07', stacks: 1 },
    { id: 'RR03', stacks: 1 },
  ], { attack: 100, speed: 30 });
  const result = simulateBattle(activeContent, player, makeEnemy(), 'fusion-twin-swords', { roundLimit: 1 });
  const followups = damageFrom(result, 'RL07', 'player');
  const reaction = framesFrom(result, 'status', 'RL07', 'player');

  assert.equal(reaction.length, 1);
  assert.match(reaction[0].text, /双剑追击/);
  assert.equal(reaction[0].amount, 2);
  assert.equal(followups.length, 2);
  for (const hit of followups) {
    near(hit.amount, expectedDerivedDamage(activeContent, player, makeEnemy(), 0.4));
  }
  assert.equal(result.frames.filter(frame =>
    frame.kind === 'status' && frame.source === 'RR03-V2-RESONANCE').length, 1,
  'both followups share the main action hit budget and trigger the bounded on-hit effect once');
  near(contribution(result, 'RL07').damage, followups.reduce((sum, hit) => sum + hit.amount, 0));
  assert.deepEqual(
    result,
    simulateBattle(activeContent, player, makeEnemy(), 'fusion-twin-swords', { roundLimit: 1 }),
  );
});

test('RL07 treats player and enemy equipment equally, requires an effective basic hit, and stops on death', () => {
  const activeContent = withOpeningRage(0);
  const playerSetup = simulateBattle(
    activeContent,
    makeLoadout('RKF01', [{ id: 'RL07', stacks: 1 }], { speed: 30 }),
    makeEnemy(),
    'fusion-twin-player',
    { roundLimit: 1 },
  );
  const enemySetup = simulateBattle(
    activeContent,
    makeLoadout('RKF06', [], { speed: 1 }),
    makeLoadout('RKF01', [{ id: 'RL07', stacks: 1 }], { speed: 30 }),
    'fusion-twin-enemy',
    { roundLimit: 1 },
  );
  const playerHits = damageFrom(playerSetup, 'RL07', 'player').map(frame => frame.amount);
  const enemyHits = damageFrom(enemySetup, 'RL07', 'enemy').map(frame => frame.amount);
  assert.equal(playerHits.length, 2);
  assert.deepEqual(enemyHits, playerHits);
  assert.equal(enemySetup.contributions.some(item => item.id === 'RL07'), false,
    'enemy damage stays out of player contribution attribution');

  const ineffective = simulateBattle(
    activeContent,
    makeLoadout('RKF01', [{ id: 'RL07', stacks: 1 }], { attack: 0, speed: 30 }),
    makeEnemy(),
    'fusion-twin-no-effective-base',
    { roundLimit: 1 },
  );
  assert.equal(ineffective.frames.some(frame => frame.source === 'RL07'), false);

  const attackerDies = simulateBattle(
    activeContent,
    makeLoadout('RKF01', [{ id: 'RL07', stacks: 1 }], { hp: 1, speed: 30 }),
    makeLoadout('RKF01', [{ id: 'RC11', stacks: 1 }], { attack: 0, defense: 100, speed: 1 }),
    'fusion-twin-no-postmortem',
    { roundLimit: 1 },
  );
  assert.equal(attackerDies.outcome, 'enemy');
  assert.equal(attackerDies.frames.some(frame => frame.source === 'RL07'), false,
    'a lethal shield retaliation prevents postmortem followups');

  const attacker = makeLoadout('RKF01', [{ id: 'RL07', stacks: 1 }], { attack: 100, speed: 30 });
  const uninjuredDefender = makeEnemy();
  const firstHitDamage = expectedDerivedDamage(activeContent, attacker, uninjuredDefender, 0.8);
  const defender = makeEnemy({ hp: firstHitDamage + 0.1 });
  const lethalAfterOneFollowup = simulateBattle(
    activeContent,
    attacker,
    defender,
    'fusion-twin-stops-on-target-death',
    { roundLimit: 1 },
  );
  const lethalFollowups = damageFrom(lethalAfterOneFollowup, 'RL07', 'player');
  near(firstHitDamage, 100 * 0.8 * 100 / (100 + combatDefense(activeContent, defender)));
  assert.equal(lethalFollowups.length, 1,
    'the first followup kills the target, so the second followup is not resolved');
  near(lethalFollowups[0].amount, 0.1);
});

test('RL07 has no effect when unequipped', () => {
  const result = simulateBattle(
    withOpeningRage(0),
    makeLoadout('RKF01', [], { speed: 30 }),
    makeEnemy(),
    'fusion-twin-unequipped',
    { roundLimit: 1 },
  );
  assert.equal(result.frames.some(frame => frame.source === 'RL07'), false);
  assert.equal(result.contributions.some(item => item.id === 'RL07'), false);
});

test('fusion rules do not re-enter through rage echoes or reaction actions', () => {
  const echoContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    resonance(entities, 'RR03').params.hit_threshold = 3;
  });
  const echoed = simulateBattle(
    echoContent,
    makeLoadout('RKF09', [
      { id: 'RL06', stacks: 1 },
      { id: 'RR03', stacks: 1 },
    ], { talents: ['V2-J3-B'], n: 3, speed: 30 }),
    makeEnemy(),
    'fusion-no-echo-reentry',
    { roundLimit: 1 },
  );
  assert.ok(echoed.frames.some(frame => frame.source?.endsWith('-RAGE-ECHO')));
  assert.equal(damageFrom(echoed, 'RL06', 'player').length, 1,
    'the completed main rage action can resolve RL06 once; its echo cannot resolve it again');

  const reactionContent = withOpeningRage(50);
  const reacted = simulateBattle(
    reactionContent,
    makeLoadout('RKF01', [], { speed: 30 }),
    makeLoadout('RKF05', [
      { id: 'RL07', stacks: 1 },
      { id: 'RL04', stacks: 1 },
    ], { speed: 1 }),
    'fusion-no-reaction-reentry',
    { roundLimit: 1 },
  );
  assert.ok(reacted.frames.some(frame => frame.kind === 'reaction' && frame.cue?.kind === 'sword_volley'));
  assert.equal(reacted.frames.some(frame => frame.source === 'RL07'), false,
    'the defender response and its later rage action are not RL07 basic actions');
});
