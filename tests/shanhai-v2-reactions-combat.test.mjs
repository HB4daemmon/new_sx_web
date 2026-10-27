import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const baseContent = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const {
    name = method,
    talents = [],
    n = 4,
    hp,
    preparation,
    firstStrike,
    encounterId,
    ...stats
  } = overrides;
  return {
    name,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
    ...(preparation === undefined ? {} : { preparation }),
    ...(firstStrike === undefined ? {} : { firstStrike }),
    ...(encounterId === undefined ? {} : { encounterId }),
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

function makeTrialEnemy(id, overrides = {}) {
  const authored = baseContent.byId[id];
  assert.ok(authored, `missing encounter ${id}`);
  const {
    artifacts = authored.artifacts ?? [],
    talents = authored.talents ?? [],
    n = authored.n ?? 0,
    hp,
    attack = authored.stats.attack,
    defense = authored.stats.defense,
    max_hp = authored.stats.max_hp,
    crit_rate = authored.stats.crit_rate,
    speed = authored.stats.speed,
  } = overrides;
  return makeLoadout(authored.method, artifacts, {
    name: authored.name,
    talents,
    n,
    hp,
    attack,
    defense,
    max_hp,
    crit_rate,
    speed,
    encounterId: id,
  });
}

function patchContent(edit) {
  const entities = structuredClone(baseContent.entities);
  edit(entities);
  return contentFromEntities(entities, baseContent.version);
}

function resonance(entities, id) {
  const owner = entities.find(item => item.id === id);
  const effects = owner.kind === 'method' ? owner.passives : owner.effects;
  const effect = effects.find(item => item.id === `${id}-V2-RESONANCE`);
  assert.ok(effect, `missing ${id} resonance`);
  return effect;
}

function withOpeningRage(amount) {
  return patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = amount;
  });
}

function framesForCue(result, kind, round) {
  return result.frames.filter(frame =>
    frame.kind === 'reaction' &&
    frame.cue?.kind === kind &&
    (round === undefined || frame.round === round));
}

function damageFrom(result, source, round) {
  return result.frames.filter(frame =>
    frame.kind === 'damage' &&
    frame.source === source &&
    (round === undefined || frame.round === round));
}

function frameCounter(frame, side, id) {
  const counter = (frame[side].counters ?? []).find(item => item.id === id);
  assert.ok(counter, `missing ${side} counter ${id}`);
  return counter;
}

function lastCounter(result, side, id) {
  for (let index = result.frames.length - 1; index >= 0; index--) {
    const counter = (result.frames[index][side].counters ?? []).find(item => item.id === id);
    if (counter) return counter;
  }
  assert.fail(`missing ${side} counter snapshots for ${id}`);
}

function expectedDerivedHit(activeContent, attacker, defender, ratio) {
  const attack = calculateStats(activeContent, attacker).attack;
  let defense = calculateStats(activeContent, defender).defense;
  const defenderMethod = activeContent.byId[defender.method];
  for (const effect of defenderMethod.passives ?? []) {
    if (effect.trigger !== 'battle_start' || effect.operation !== 'modify_stat' ||
        effect.params?.stat !== 'defense') continue;
    const amount = effect.params?.amount ?? effect.params?.flat ?? 0;
    defense = effect.params?.mode === 'percent_add'
      ? defense * (1 + amount)
      : defense + amount;
  }
  return attack * ratio * 100 / (100 + defense);
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

test('flying swords snapshot their opening count, grow on own basics, and volley once after hostile mains', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF05', [], {
    attack: 100,
    defense: 0,
    max_hp: 1_000,
    speed: 30,
  });
  const opponent = makeEnemy({ speed: 1 });
  const result = simulateBattle(activeContent, player, opponent, 'reaction-sword-volley', { roundLimit: 2 });
  const opening = result.frames.find(frame => frame.kind === 'start');
  const initialSword = opening.player.summons?.find(summon => summon.id === 'RKF05-V2-RESONANCE');

  assert.deepEqual(initialSword, {
    id: 'RKF05-V2-RESONANCE',
    kind: 'sword',
    count: 1,
    max: 3,
  });
  const volleys = framesForCue(result, 'sword_volley');
  assert.equal(volleys.length, 2);
  assert.deepEqual(volleys.map(frame => frame.round), [1, 2]);
  assert.ok(volleys.every(frame =>
    frame.actor === 'player' && frame.target === 'enemy' &&
    frame.cue.owner === 'player' && frame.cue.sourceId === 'RKF05-V2-RESONANCE'));

  const roundOne = damageFrom(result, 'RKF05-V2-RESONANCE', 1);
  const roundTwo = damageFrom(result, 'RKF05-V2-RESONANCE', 2);
  assert.equal(roundOne.length, 2, 'the basic action grows the opening sword before the enemy acts');
  assert.equal(roundTwo.length, 3, 'the persistent count stops at its authored cap');
  const expected = expectedDerivedHit(activeContent, player, opponent, 0.18);
  for (const hit of [...roundOne, ...roundTwo]) {
    near(hit.amount, expected);
    assert.equal(hit.cue?.kind, 'sword_volley');
  }
  assert.equal(result.frames.at(-1).player.summons[0].count, 3);
});

test('reaction hits can feed one bounded artifact hit rule without a second response beat', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    resonance(entities, 'RR03').params.hit_threshold = 2;
  });
  const player = makeLoadout('RKF05', [{ id: 'RR03', stacks: 1 }], {
    attack: 100,
    defense: 0,
    max_hp: 1_000,
    speed: 30,
  });
  const opponent = makeEnemy({ speed: 1 });
  const result = simulateBattle(activeContent, player, opponent, 'reaction-artifact-budget', { roundLimit: 1 });
  const volley = framesForCue(result, 'sword_volley', 1);
  const poison = result.frames.filter(frame =>
    frame.kind === 'status' && frame.source === 'RR03-V2-RESONANCE');

  assert.equal(volley.length, 1);
  assert.equal(damageFrom(result, 'RKF05-V2-RESONANCE', 1).length, 2);
  assert.equal(poison.length, 1, 'the artifact threshold can fire only once in the shared volley budget');
  assert.equal(poison[0].amount, 2);
  assert.equal(poison[0].cue?.kind, 'sword_volley');
  assert.ok(result.frames.some(frame =>
    frame.kind === 'dot' && frame.source === 'RR03-V2-RESONANCE' && frame.round === 1));
  assert.ok(result.contributions.find(item => item.id === 'RR03')?.damage > 0);
});

test('preparation, echo, DoT settlement, and a dead defender do not schedule extra sword volleys', () => {
  const activeContent = withOpeningRage(100);
  const player = makeLoadout('RKF05', [], {
    attack: 10,
    defense: 1_000,
    max_hp: 100_000,
    speed: 5,
  });
  const echoedOpponent = makeLoadout('RKF09', [], {
    talents: ['V2-J3-B'],
    n: 3,
    attack: 10,
    defense: 0,
    max_hp: 1_000_000,
    speed: 30,
    firstStrike: 20,
  });
  const result = simulateBattle(activeContent, player, echoedOpponent, 'reaction-no-recursion', { roundLimit: 1 });
  assert.ok(result.frames.some(frame => frame.source === 'RKF05-TRAVEL-NEXT-STRIKE'));
  assert.ok(result.frames.some(frame => frame.source === 'RKF09-RAGE-DAMAGE-RAGE-ECHO'));
  assert.ok(result.frames.some(frame => frame.kind === 'dot' && frame.actor === 'enemy'));
  assert.equal(framesForCue(result, 'sword_volley').length, 1);
  assert.equal(damageFrom(result, 'RKF05-V2-RESONANCE').length, 1);

  const lethalPlayer = makeLoadout('RKF05', [], {
    attack: 10,
    defense: 0,
    max_hp: 1,
    hp: 1,
    speed: 5,
  });
  const lethalOpponent = makeEnemy({ attack: 10_000, speed: 30 });
  const lethal = simulateBattle(
    withOpeningRage(0),
    lethalPlayer,
    lethalOpponent,
    'reaction-no-postmortem',
    { roundLimit: 1 },
  );
  assert.equal(lethal.outcome, 'enemy');
  assert.equal(framesForCue(lethal, 'sword_volley').length, 0);
});

test('guard pressure releases once after threshold absorption or a real shield break, never from zero', () => {
  const activeContent = withOpeningRage(0);
  const breakDefender = makeLoadout('RKF01', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 5,
    preparation: 10,
  });
  const attacker = makeEnemy({ attack: 1_000, speed: 30 });
  const broken = simulateBattle(activeContent, breakDefender, attacker, 'guard-break-response', { roundLimit: 1 });
  const breakCue = framesForCue(broken, 'guard_counter', 1);
  const breakDamage = damageFrom(broken, 'RKF01-V2-RESONANCE', 1);

  assert.equal(breakCue.length, 1);
  assert.equal(breakDamage.length, 1);
  assert.equal(breakCue[0].cue.sourceId, 'RKF01-V2-RESONANCE');
  near(breakDamage[0].amount, 10 * 0.75 * 100 / (100 + calculateStats(activeContent, attacker).defense + 8));
  assert.equal(lastCounter(broken, 'player', 'RKF01-V2-RESONANCE').value, 0);

  const thresholdDefender = makeLoadout('RKF01', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 5,
    preparation: 1_000,
  });
  const threshold = simulateBattle(
    activeContent,
    thresholdDefender,
    attacker,
    'guard-threshold-response',
    { roundLimit: 1 },
  );
  const thresholdCue = framesForCue(threshold, 'guard_counter', 1);
  assert.equal(thresholdCue.length, 1);
  assert.ok(thresholdCue[0].player.shield > 0, 'this release was threshold-based, not a shield break');
  assert.equal(damageFrom(threshold, 'RKF01-V2-RESONANCE', 1).length, 1);

  const noShield = makeLoadout('RKF01', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 5,
  });
  const empty = simulateBattle(activeContent, noShield, attacker, 'guard-zero-pressure', { roundLimit: 1 });
  assert.equal(framesForCue(empty, 'guard_counter').length, 0);
  assert.equal(damageFrom(empty, 'RKF01-V2-RESONANCE').length, 0);
});

test('spring stores healing up to two thresholds and spends only one after a living hostile main action', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    const method = entities.find(item => item.id === 'RKF03');
    method.actions.basic.effects.find(item => item.id === 'RKF03-BASIC-HEAL').params.max_hp_ratio = 0.4;
  });
  const player = makeLoadout('RKF03', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    hp: 600,
    speed: 30,
  });
  const opponent = makeEnemy({ speed: 1 });
  const result = simulateBattle(activeContent, player, opponent, 'spring-reaction', { roundLimit: 1 });
  const springCue = framesForCue(result, 'spring_bloom', 1);
  const springDamage = damageFrom(result, 'RKF03-V2-RESONANCE', 1);
  const threshold = calculateStats(activeContent, player).max_hp * 0.2;

  assert.equal(springCue.length, 1);
  assert.equal(springDamage.length, 1);
  assert.equal(springCue[0].actor, 'player');
  assert.equal(springCue[0].cue.sourceId, 'RKF03-V2-RESONANCE');
  near(springDamage[0].amount, calculateStats(activeContent, player).max_hp *
    0.12 * 100 / (100 + calculateStats(activeContent, opponent).defense + 8));
  near(frameCounter(springCue[0], 'player', 'RKF03-V2-RESONANCE').value, threshold);
  near(lastCounter(result, 'player', 'RKF03-V2-RESONANCE').value, threshold);
  assert.equal(frameCounter(springCue[0], 'player', 'RKF03-V2-RESONANCE').max, threshold * 2);
});

test('tidal charge loses one count per effective direct hit and releases remaining segments at round three', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF06', [], {
    attack: 100,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
  });
  const opponent = makeTrialEnemy('EN-A1-B1', {
    artifacts: [],
    talents: [],
    n: 0,
    attack: 100,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
  });
  const result = simulateBattle(activeContent, player, opponent, 'tidal-charge-counterplay', { roundLimit: 3 });
  const chargeBreaks = result.frames.filter(frame =>
    frame.kind === 'status' &&
    frame.round < 3 &&
    frame.source === 'RKF06-BASIC-DAMAGE' &&
    frame.cue?.kind === 'enemy_charge' &&
    frame.cue.sourceId === 'EN-A1-B1');
  const release = framesForCue(result, 'enemy_release', 3);
  const releasedHits = damageFrom(result, 'EN-A1-B1', 3);
  const rearmed = result.frames.find((frame, index) =>
    index > result.frames.indexOf(release[0]) &&
    frame.kind === 'reaction' &&
    frame.cue?.kind === 'enemy_charge' &&
    frame.cue.sourceId === 'EN-A1-B1');

  assert.equal(chargeBreaks.length, 2);
  assert.equal(frameCounter(chargeBreaks[0], 'enemy', 'EN-A1-B1-TRIAL-CHARGES').value, 2);
  assert.equal(frameCounter(chargeBreaks[1], 'enemy', 'EN-A1-B1-TRIAL-CHARGES').value, 1);
  assert.equal(release.length, 1);
  assert.equal(frameCounter(release[0], 'enemy', 'EN-A1-B1-TRIAL-CHARGES').value, 0);
  assert.equal(frameCounter(release[0], 'enemy', 'EN-A1-B1-TRIAL-COUNTDOWN').value, 0);
  assert.equal(releasedHits.length, 1, 'the two earlier direct hits interrupt two of three charges');
  near(releasedHits[0].amount, expectedDerivedHit(activeContent, opponent, player, 0.45));
  assert.equal(releasedHits[0].cue?.kind, 'enemy_release');
  assert.ok(rearmed);
  assert.equal(frameCounter(rearmed, 'enemy', 'EN-A1-B1-TRIAL-CHARGES').value, 3);
});

test('tidal charge ignores DoT ticks and shield reflections', () => {
  const activeContent = withOpeningRage(100);
  const poisonPlayer = makeLoadout('RKF06', [], {
    attack: 100,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
  });
  const poisonTarget = makeTrialEnemy('EN-A1-B1', {
    artifacts: [],
    talents: [],
    n: 0,
    attack: 0,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
  });
  const poisoned = simulateBattle(
    activeContent,
    poisonPlayer,
    poisonTarget,
    'tidal-dot-is-not-an-interrupt',
    { roundLimit: 1 },
  );
  const poisonTicks = poisoned.frames.filter(frame =>
    frame.kind === 'dot' && frame.source === 'RKF06-RAGE-POISON');

  assert.equal(poisonTicks.length, 2);
  assert.ok(poisonTicks.every(frame =>
    frameCounter(frame, 'enemy', 'EN-A1-B1-TRIAL-CHARGES').value === 2));
  assert.equal(lastCounter(poisoned, 'enemy', 'EN-A1-B1-TRIAL-CHARGES').value, 2);

  const reflectingPlayer = makeLoadout('RKF01', [], {
    attack: 0,
    defense: 100,
    max_hp: 1_000,
    speed: 5,
    preparation: 1_000,
  });
  const reflectedTarget = makeTrialEnemy('EN-A1-B1', {
    artifacts: [],
    talents: [],
    n: 0,
    attack: 100,
    defense: 0,
    max_hp: 1_000_000,
    speed: 30,
  });
  const reflected = simulateBattle(
    withOpeningRage(0),
    reflectingPlayer,
    reflectedTarget,
    'tidal-reflect-is-not-an-interrupt',
    { roundLimit: 1 },
  );
  const recoil = reflected.frames.find(frame =>
    frame.kind === 'damage' && frame.source === 'RKF01-PASSIVE-RECOIL');

  assert.ok(recoil);
  assert.equal(frameCounter(recoil, 'enemy', 'EN-A1-B1-TRIAL-CHARGES').value, 3);
});

test('broken tidal preparations announce the empty release, while names never select trials', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const method = entities.find(item => item.id === 'RKF07');
    method.actions.rage.effects.find(item => item.id === 'RKF07-RAGE-CHAIN').params.chance = 0;
  });
  const player = makeLoadout('RKF07', [], {
    attack: 100,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
  });
  const opponent = makeTrialEnemy('EN-A1-B1', {
    artifacts: [],
    talents: [],
    n: 0,
    attack: 10,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
  });
  const broken = simulateBattle(activeContent, player, opponent, 'tidal-broken-preparation', { roundLimit: 3 });
  const release = framesForCue(broken, 'enemy_release', 3);

  assert.equal(release.length, 1);
  assert.ok(release[0].text.length > 0);
  assert.equal(release[0].amount, undefined);
  assert.equal(frameCounter(release[0], 'enemy', 'EN-A1-B1-TRIAL-CHARGES').value, 0);
  assert.equal(damageFrom(broken, 'EN-A1-B1', 3).length, 0);

  const disguised = makeLoadout('RKF10', [], {
    name: baseContent.byId['EN-A1-B1'].name,
    attack: 10,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
  });
  const noLookup = simulateBattle(activeContent, makeLoadout('RKF08', [], { attack: 0 }), disguised,
    'trial-name-is-not-lookup', { roundLimit: 3 });
  assert.equal(framesForCue(noLookup, 'enemy_release').length, 0);
  assert.equal(noLookup.frames.some(frame =>
    (frame.enemy.counters ?? []).some(counter => counter.id === 'EN-A1-B1-TRIAL-CHARGES')), false);
});

test('reviving mist counts only poison or burn ticks that damage enemy HP', () => {
  const activeContent = withOpeningRage(100);
  const player = makeLoadout('RKF06', [], {
    attack: 100,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
  });
  const opponent = makeTrialEnemy('EN-A1-B2', {
    artifacts: [],
    talents: [],
    n: 0,
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 1,
  });
  const result = simulateBattle(activeContent, player, opponent, 'mist-hp-dot-interrupt', { roundLimit: 1 });
  const dotInterrupts = result.frames.filter(frame =>
    frame.kind === 'status' &&
    frame.source === 'RKF06-RAGE-POISON' &&
    frame.cue?.kind === 'enemy_charge');

  assert.equal(dotInterrupts.length, 2);
  assert.equal(frameCounter(dotInterrupts[0], 'enemy', 'EN-A1-B2-TRIAL-CHARGES').value, 2);
  assert.equal(frameCounter(dotInterrupts[1], 'enemy', 'EN-A1-B2-TRIAL-CHARGES').value, 1);
  assert.equal(lastCounter(result, 'enemy', 'EN-A1-B2-TRIAL-CHARGES').value, 1);

  const shieldedEnemy = makeTrialEnemy('EN-A1-B2', {
    artifacts: [{ id: 'RC11', stacks: 1 }],
    talents: [],
    n: 0,
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 1,
  });
  const tinyDotPlayer = makeLoadout('RKF06', [], {
    attack: 1,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
  });
  const shielded = simulateBattle(
    activeContent,
    tinyDotPlayer,
    shieldedEnemy,
    'mist-shield-only-dot',
    { roundLimit: 1 },
  );
  assert.equal(framesForCue(shielded, 'enemy_charge').filter(frame =>
    frame.kind === 'status' && frame.source === 'RKF06-RAGE-POISON').length, 0);
  assert.equal(lastCounter(shielded, 'enemy', 'EN-A1-B2-TRIAL-CHARGES').value, 3);
});

test('reviving mist releases the authored heal at round three and re-arms while alive', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF08', [], {
    attack: 0,
    defense: 0,
    max_hp: 10_000,
    speed: 20,
  });
  const opponent = makeTrialEnemy('EN-A1-B2', {
    artifacts: [],
    talents: [],
    n: 0,
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    hp: 1,
    speed: 1,
  });
  const result = simulateBattle(activeContent, player, opponent, 'mist-release', { roundLimit: 3 });
  const release = framesForCue(result, 'enemy_release', 3);
  const heal = result.frames.find(frame =>
    frame.kind === 'heal' && frame.source === 'EN-A1-B2' &&
    frame.round === 3 && frame.cue?.kind === 'enemy_release');
  const rearmed = result.frames.find((frame, index) =>
    index > result.frames.indexOf(release[0]) &&
    frame.kind === 'reaction' && frame.cue?.kind === 'enemy_charge' &&
    frame.cue.sourceId === 'EN-A1-B2');

  assert.equal(release.length, 1);
  assert.ok(heal);
  near(heal.amount, heal.enemy.maxHp * 0.045 * 3);
  assert.equal(frameCounter(release[0], 'enemy', 'EN-A1-B2-TRIAL-CHARGES').value, 0);
  assert.ok(rearmed);
  assert.equal(frameCounter(rearmed, 'enemy', 'EN-A1-B2-TRIAL-CHARGES').value, 3);
  assert.equal(frameCounter(rearmed, 'enemy', 'EN-A1-B2-TRIAL-COUNTDOWN').value, 3);
});

test('trial references are enemy-only, exact, and bound to the referenced enemy entity', () => {
  const player = makeLoadout('RKF08');
  const genericEnemy = makeEnemy();
  const validTrial = makeTrialEnemy('EN-A1-B1');

  assert.throws(
    () => simulateBattle(baseContent, { ...player, encounterId: 'EN-A1-B1' }, genericEnemy, 'trial-on-player'),
    /enemy-only/,
  );
  assert.throws(
    () => simulateBattle(baseContent, player, { ...genericEnemy, encounterId: 'EN-UNKNOWN' }, 'unknown-trial'),
    /Unknown Shanhai content ID/,
  );
  assert.throws(
    () => simulateBattle(baseContent, player, { ...validTrial, method: 'RKF03' }, 'mismatched-trial'),
    /does not match method/,
  );
  assert.throws(
    () => simulateBattle(patchContent(entities => {
      entities.find(item => item.id === 'EN-A1-B1').trial.extra = true;
    }), player, validTrial, 'unknown-trial-parameter'),
    /Unknown or missing enemy trial parameter/,
  );
  assert.throws(
    () => simulateBattle(patchContent(entities => {
      entities.find(item => item.id === 'EN-A1-C1').trial =
        structuredClone(entities.find(item => item.id === 'EN-A1-B1').trial);
    }), player, genericEnemy, 'trial-on-other-entity'),
    /Unsupported enemy trial owner/,
  );
});

test('trial parameters accept legal tuning and reject out-of-range values', () => {
  const player = makeLoadout('RKF08', [], { speed: 30, attack: 0 });
  const tidal = makeTrialEnemy('EN-A1-B1');
  const mist = makeTrialEnemy('EN-A1-B2');
  const tuned = patchContent(entities => {
    entities.find(item => item.id === 'EN-A1-B1').trial = {
      kind: 'tidal_charge',
      period: 4,
      charges: 2,
      attack_ratio_per_charge: 0.7,
    };
    entities.find(item => item.id === 'EN-A1-B2').trial = {
      kind: 'reviving_mist',
      period: 5,
      charges: 7,
      heal_hp_ratio_per_charge: 0.08,
    };
  });

  assert.ok(calculateStats(tuned, tidal).attack > 0);
  assert.ok(calculateStats(tuned, mist).max_hp > 0);
  const tidalResult = simulateBattle(tuned, player, tidal, 'tuned-tidal-trial', { roundLimit: 1 });
  const mistResult = simulateBattle(tuned, player, mist, 'tuned-mist-trial', { roundLimit: 1 });
  assert.equal(frameCounter(tidalResult.frames[0], 'enemy', 'EN-A1-B1-TRIAL-CHARGES').max, 2);
  assert.equal(frameCounter(mistResult.frames[0], 'enemy', 'EN-A1-B2-TRIAL-CHARGES').max, 7);

  const invalidTrials = [
    { kind: 'tidal_charge', period: 0, charges: 2, attack_ratio_per_charge: 0.7 },
    { kind: 'tidal_charge', period: 11, charges: 2, attack_ratio_per_charge: 0.7 },
    { kind: 'tidal_charge', period: 1.5, charges: 2, attack_ratio_per_charge: 0.7 },
    { kind: 'tidal_charge', period: 4, charges: 0, attack_ratio_per_charge: 0.7 },
    { kind: 'tidal_charge', period: 4, charges: 11, attack_ratio_per_charge: 0.7 },
    { kind: 'tidal_charge', period: 4, charges: 2.5, attack_ratio_per_charge: 0.7 },
    { kind: 'tidal_charge', period: 4, charges: 2, attack_ratio_per_charge: 0 },
    { kind: 'tidal_charge', period: 4, charges: 2, attack_ratio_per_charge: 1.01 },
    { kind: 'reviving_mist', period: 4, charges: 2, attack_ratio_per_charge: 0.7 },
  ];
  for (const trial of invalidTrials) {
    const invalid = patchContent(entities => {
      entities.find(item => item.id === 'EN-A1-B1').trial = trial;
    });
    assert.throws(
      () => calculateStats(invalid, tidal),
      /enemy trial (?:kind|parameter)/i,
      JSON.stringify(trial),
    );
  }
});

test('guard counter threshold must be a positive ratio no greater than one', () => {
  const player = makeLoadout('RKF01');
  const enemy = makeEnemy();
  for (const ratio of [0, -0.01, 1.01]) {
    const invalid = patchContent(entities => {
      resonance(entities, 'RKF01').params.counter_threshold_hp_ratio = ratio;
    });
    assert.throws(
      () => simulateBattle(invalid, player, enemy, `invalid-counter-threshold-${ratio}`),
      /V2 resonance/i,
    );
  }
});
