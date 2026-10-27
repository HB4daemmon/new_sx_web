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
  defense: 100,
  max_hp: 10_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const {
    talents = [],
    n = 4,
    hp,
    preparation,
    journey,
    ...stats
  } = overrides;
  return {
    name: method,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
    ...(preparation === undefined ? {} : { preparation }),
    ...(journey === undefined ? {} : {
      journey: {
        coins: 0,
        coinsSpent: 0,
        eliteWins: 0,
        bossWins: 0,
        artifactKinds: 0,
        knownMethods: 0,
        ...journey,
      },
    }),
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

function resonanceEffect(entities, ownerId) {
  const owner = entities.find(item => item.id === ownerId);
  const effects = owner.kind === 'method' ? owner.passives : owner.effects;
  const effect = effects.find(item => item.id === `${ownerId}-V2-RESONANCE`);
  assert.ok(effect, `missing ${ownerId} resonance effect`);
  return effect;
}

function framesFrom(result, kind, source, round) {
  return result.frames.filter(frame =>
    frame.kind === kind &&
    frame.source === source &&
    (round === undefined || frame.round === round));
}

function damageFrom(result, source, round) {
  return framesFrom(result, 'damage', source, round);
}

function assertOneSpringResponseAfterHostileMain(result, round) {
  const blooms = damageFrom(result, 'RKF03-V2-RESONANCE', round);
  assert.equal(blooms.length, 1, `expected one spring response in round ${round}`);
  const bloom = blooms[0];
  assert.equal(bloom.actor, 'player');
  assert.equal(bloom.cue?.kind, 'spring_bloom');
  assert.equal(bloom.cue?.owner, 'player');
  assert.equal(bloom.cue?.sourceId, 'RKF03-V2-RESONANCE');

  const hostileMainIndex = result.frames.findIndex(frame =>
    frame.kind === 'action' &&
    frame.actor === 'enemy' &&
    frame.round === round);
  const reactionIndex = result.frames.findIndex(frame =>
    frame.kind === 'reaction' &&
    frame.cue?.kind === 'spring_bloom' &&
    frame.round === round);
  assert.ok(hostileMainIndex >= 0, `expected a hostile main action in round ${round}`);
  assert.ok(reactionIndex > hostileMainIndex,
    `expected spring to respond after the hostile main action in round ${round}`);
  assert.ok(
    result.frames[reactionIndex].player.hp > 0 &&
      result.frames[reactionIndex].enemy.hp > 0,
    `expected living fighters at the spring response in round ${round}`,
  );
  assert.ok(result.frames.indexOf(bloom) > reactionIndex,
    `expected spring damage after its reaction cue in round ${round}`);
  return bloom;
}

function maxCounter(result, side, id) {
  const values = result.frames.flatMap(frame =>
    (frame[side].counters ?? [])
      .filter(counter => counter.id === id)
      .map(counter => counter.value));
  assert.ok(values.length > 0, `expected counter snapshots for ${id}`);
  return Math.max(...values);
}

function lastCounter(result, side, id) {
  for (let index = result.frames.length - 1; index >= 0; index--) {
    const counter = (result.frames[index][side].counters ?? [])
      .find(item => item.id === id);
    if (counter) return counter.value;
  }
  assert.fail(`expected counter snapshots for ${id}`);
}

function lastCounterView(result, side, id) {
  for (let index = result.frames.length - 1; index >= 0; index--) {
    const counter = (result.frames[index][side].counters ?? [])
      .find(item => item.id === id);
    if (counter) return counter;
  }
  assert.fail(`expected counter snapshots for ${id}`);
}

function contribution(result, id) {
  const entry = result.contributions.find(item => item.id === id);
  assert.ok(entry, `missing contribution ${id}`);
  return entry;
}

function expectedDerivedHit(activeContent, attacker, defender, ratio) {
  const attack = calculateStats(activeContent, attacker).attack;
  let defense = calculateStats(activeContent, defender).defense;
  const defenderMethod = activeContent.entities.find(entity => entity.id === defender.method);
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

function assertBoundedCounters(result) {
  for (const frame of result.frames) {
    for (const side of ['player', 'enemy']) {
      for (const counter of frame[side].counters ?? []) {
        assert.equal(typeof counter.id, 'string');
        assert.equal(typeof counter.name, 'string');
        assert.ok(Number.isFinite(counter.value));
        assert.ok(Number.isFinite(counter.max));
        assert.ok(counter.max >= 0);
        assert.ok(counter.value >= 0 && counter.value <= counter.max);
      }
    }
  }
}

function simulate(activeContent, player, enemy = makeEnemy(), seed = 'v2-resonance', roundLimit = 1) {
  const result = simulateBattle(activeContent, player, enemy, seed, { roundLimit });
  assertBoundedCounters(result);
  return result;
}

test('runtime rejects malformed, noninteger, out-of-range and misplaced resonance rules', () => {
  const cases = [
    [
      'integer rage points',
      entities => { resonanceEffect(entities, 'RR09').params.rage_gain = 10.5; },
      /Noninteger V2 resonance count rage_gain/,
    ],
    [
      'fraction bounds',
      entities => { resonanceEffect(entities, 'RKF02').params.segment_ratio = 1.01; },
      /V2 resonance fraction exceeds one/,
    ],
    [
      'unknown parameters',
      entities => { resonanceEffect(entities, 'RKF01').params.extra_ratio = 0.1; },
      /Unknown V2 resonance parameter/,
    ],
    [
      'owner identity',
      entities => { resonanceEffect(entities, 'RR03').id = 'RR04-V2-RESONANCE'; },
      /Mismatched V2 resonance effect id/,
    ],
    [
      'allowed authored location',
      entities => {
        const method = entities.find(item => item.id === 'RKF01');
        method.actions.basic.effects.push(method.passives.pop());
      },
      /not an authored method_passive/,
    ],
    [
      'travel location',
      entities => {
        const method = entities.find(item => item.id === 'RKF01');
        method.travel.push(method.passives.pop());
      },
      /not an authored method_passive/,
    ],
  ];

  for (const [name, edit, expected] of cases) {
    const invalid = patchContent(edit);
    assert.throws(
      () => simulateBattle(invalid, makeLoadout('RKF01'), makeEnemy(), `invalid-${name}`),
      expected,
      name,
    );
  }
});

test('guard pressure records shield absorption and releases it at rage start', () => {
  const activeContent = withOpeningRage(100);
  const player = makeLoadout('RKF01', [], {
    preparation: 1_000,
    speed: 10,
  });
  const opponent = makeEnemy({ attack: 100, speed: 30 });
  const result = simulate(activeContent, player, opponent, 'guard-pressure', 1);

  assert.ok(damageFrom(result, 'RKF01-V2-RESONANCE').length > 0);
  assert.ok(maxCounter(result, 'player', 'RKF01-V2-RESONANCE') > 0);
  assert.ok(contribution(result, 'RKF01').damage > 0);
});

test('returning breath readies one basic and multiplies split segments by its authored ratio', () => {
  const activeContent = withOpeningRage(100);
  const player = makeLoadout('RKF02', [], {
    n: 2,
    talents: ['V2-J2-C'],
  });
  const result = simulate(activeContent, player, makeEnemy(), 'returning-breath', 2);
  const basics = damageFrom(result, 'RKF02-BASIC-DAMAGE', 2);

  assert.equal(basics.length, 5, 'one base, two split, and two returning-breath segments');
  const expectedSegment = expectedDerivedHit(activeContent, player, makeEnemy(), 1.55 * 0.6 * 0.55);
  assert.ok(basics.every(frame => Math.abs(frame.amount - expectedSegment) < 1e-8));
  assert.equal(maxCounter(result, 'player', 'RKF02-V2-RESONANCE'), 1);
  assert.ok(contribution(result, 'RKF02').rage >= 10);

  const withoutBonusContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    resonanceEffect(entities, 'RKF02').params.rage_bonus = 0;
  });
  const withoutBonus = simulate(withoutBonusContent, player, makeEnemy(), 'returning-breath', 2);
  const settledRage = (battle, round) => battle.frames.find(frame =>
    frame.kind === 'rage' &&
    frame.source === 'RULES-RAGE-SETTLE' &&
    frame.actor === 'player' &&
    frame.round === round)?.amount;
  assert.equal(settledRage(result, 1), settledRage(withoutBonus, 1));
  assert.equal(settledRage(result, 2) - settledRage(withoutBonus, 2), 10);

  const echoed = simulate(
    activeContent,
    makeLoadout('RKF02', [], { talents: ['V2-J3-B'] }),
    makeEnemy(),
    'returning-breath-echo',
    2,
  );
  assert.ok(damageFrom(echoed, 'RKF02-RAGE-DAMAGE-RAGE-ECHO', 1).length > 0);
  assert.equal(damageFrom(echoed, 'RKF02-BASIC-DAMAGE', 2).length, 3,
    'the rage echo does not ready a second returning-breath charge');
});

test('spring bloom spends one threshold after a hostile main action with a two-threshold cap', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    resonanceEffect(entities, 'RKF03').params.threshold_hp_ratio = 0.02;
  });
  const result = simulate(activeContent, makeLoadout('RKF03'), makeEnemy(), 'spring-bloom', 1);
  const counter = lastCounterView(result, 'player', 'RKF03-V2-RESONANCE');
  const threshold = calculateStats(activeContent, makeLoadout('RKF03')).max_hp * 0.02;

  assertOneSpringResponseAfterHostileMain(result, 1);
  assert.ok(contribution(result, 'RKF03').damage > 0);
  assert.equal(counter.name, '春华');
  assert.equal(counter.value, 0);
  assert.ok(Math.abs(counter.max - threshold * 2) < 1e-8);
});

test('spring stores up to two thresholds and spends one after a hostile main action', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    resonanceEffect(entities, 'RKF03').params.threshold_hp_ratio = 0.02;
  });
  const player = makeLoadout('RKF03', [{ id: 'RC12', stacks: 1 }], { hp: 9_000 });
  const result = simulate(activeContent, player, makeEnemy(), 'spring-bloom-bank-cap', 1);
  const counter = lastCounterView(result, 'player', 'RKF03-V2-RESONANCE');
  const threshold = calculateStats(activeContent, player).max_hp * 0.02;

  assertOneSpringResponseAfterHostileMain(result, 1);
  assert.ok(Math.abs(counter.value - threshold) < 1e-8);
  assert.ok(Math.abs(counter.max - threshold * 2) < 1e-8);
  assert.equal(counter.name, '春华');
});

test('burn-siphon healing banks spring without blooming during round-dot settlement', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    resonanceEffect(entities, 'RKF03').params.threshold_hp_ratio = 0.0001;
  });
  const player = makeLoadout('RKF03', [
    { id: 'RC12', stacks: 1 },
    { id: 'RC15', stacks: 1 },
  ], { hp: 9_000 });
  const result = simulate(activeContent, player, makeEnemy(), 'spring-bloom-dot-settlement', 2);
  const threshold = calculateStats(activeContent, player).max_hp * 0.0001;

  assertOneSpringResponseAfterHostileMain(result, 1);
  assertOneSpringResponseAfterHostileMain(result, 2);
  assert.ok(result.frames
    .flatMap(frame => frame.player.counters ?? [])
    .filter(counter => counter.id === 'RKF03-V2-RESONANCE')
    .every(counter => counter.name === '春华' && counter.value <= counter.max &&
      Math.abs(counter.max - threshold * 2) < 1e-8));
});

test('spring reaction hits feed resonance counters but round-dot settlement does not bloom', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    resonanceEffect(entities, 'RKF03').params.threshold_hp_ratio = 0.0001;
    resonanceEffect(entities, 'RL03').params.hit_threshold = 3;
  });
  const player = makeLoadout('RKF03', [
    { id: 'RL01', stacks: 1 },
    { id: 'RC15', stacks: 1 },
    { id: 'RL03', stacks: 1 },
  ]);
  const result = simulate(activeContent, player, makeEnemy(), 'round-dot-spring-hit', 1);
  const blooms = damageFrom(result, 'RKF03-V2-RESONANCE', 1);
  const storms = damageFrom(result, 'RL03-V2-RESONANCE', 1);

  assertOneSpringResponseAfterHostileMain(result, 1);
  assert.equal(blooms.length, 1);
  assert.equal(framesFrom(result, 'dot', 'RC15', 1).length, 1);
  assert.equal(storms.length, 0,
    'the single spring reaction leaves wheel storm below threshold; dot healing adds no bloom hit');
  assert.equal(lastCounter(result, 'player', 'RL03-V2-RESONANCE'), 2,
    'the spring reaction counts, while its later DoT settlement does not');
});

test('burn acceleration ticks only live own burns that existed when rage began', () => {
  const activeContent = withOpeningRage(0);
  const result = simulate(
    activeContent,
    makeLoadout('RKF04'),
    makeEnemy(),
    'burn-accelerate',
    4,
  );

  const roundFourBurns = framesFrom(result, 'dot', 'RKF04-BASIC-BURN', 4);
  const rageFrameIndex = result.frames.findIndex(frame =>
    frame.kind === 'action' && frame.source === 'RKF04-RAGE-DAMAGE' && frame.round === 4);
  const accelerated = roundFourBurns.filter(frame =>
    result.frames.indexOf(frame) < rageFrameIndex);
  assert.equal(accelerated.length, 2, 'both still-live preexisting layers accelerate once');
  assert.deepEqual(accelerated.map(frame => frame.enemy.statuses.burn), [2, 1],
    'each accelerated tick consumes one remaining tick from its live layer');
  assert.equal(roundFourBurns.length, 3,
    'the third basic-burn frame is the surviving layer ticked at round end');
  assert.equal(framesFrom(result, 'dot', 'RKF04-RAGE-BURN', 4).length, 2);
  assert.ok(framesFrom(result, 'dot', 'RKF04-RAGE-BURN', 4).every(frame =>
    result.frames.indexOf(frame) > rageFrameIndex),
    'the newly applied rage burn still receives its ordinary round-end tick');
  assert.ok(contribution(result, 'RKF04').damage > 0);
});

test('sword array consumes only preexisting intent while artifact hits still add intent', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF05', [{ id: 'RC09', stacks: 1 }]);
  const result = simulate(activeContent, player, makeEnemy(), 'sword-array', 4);
  const swords = damageFrom(result, 'RKF05-V2-RESONANCE', 4);
  const rageActionIndex = result.frames.findIndex(frame =>
    frame.kind === 'action' &&
    frame.source === 'RKF05-RAGE-DAMAGE' &&
    frame.actor === 'player' &&
    frame.round === 4);
  const enemyActionIndex = result.frames.findIndex(frame =>
    frame.kind === 'action' &&
    frame.actor === 'enemy' &&
    frame.round === 4);
  const rageIntentHits = swords.filter(frame =>
    frame.cue === undefined &&
    result.frames.indexOf(frame) > rageActionIndex &&
    result.frames.indexOf(frame) < enemyActionIndex);
  const volleyHits = swords.filter(frame => frame.cue?.kind === 'sword_volley');

  assert.ok(rageActionIndex >= 0, 'expected a round-four rage action');
  assert.ok(enemyActionIndex >= 0, 'expected a round-four hostile main action');
  assert.equal(rageIntentHits.length, 3);
  assert.equal(volleyHits.length, 3, 'the persistent sword array also volleys after the enemy main');
  assert.ok(rageIntentHits.every(frame => frame.player.statuses.sword_intent === 2),
    'three preexisting stacks were spent while later artifact-generated intent remains');
  assert.ok(volleyHits.every(frame =>
    result.frames.indexOf(frame) > enemyActionIndex &&
    frame.cue.owner === 'player' &&
    frame.cue.sourceId === 'RKF05-V2-RESONANCE'));
  assert.ok(contribution(result, 'RKF05').damage > 0);
});

test('sword-array artifact hits honor the seven-stack J2-A cap', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    resonanceEffect(entities, 'RKF05').params.artifact_intent_limit = 4;
  });
  const player = makeLoadout('RKF05', [
    { id: 'RC09', stacks: 1 },
    { id: 'RR04', stacks: 1 },
  ], {
    talents: ['RKF05-J2-A'],
    journey: { coins: 200 },
  });
  const result = simulate(activeContent, player, makeEnemy(), 'sword-array-j2-a-cap', 2);

  assert.equal(result.frames.at(-1).player.statuses.sword_intent, 7);
  assert.ok(damageFrom(result, 'RR04-V2-RESONANCE').length > 0);
});

test('thunder induction reacts to eligible artifact hits without counting its own bolt', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    const method = entities.find(item => item.id === 'RKF07');
    method.actions.basic.effects.find(item => item.id === 'RKF07-BASIC-CHAIN').params.chance = 0;
  });
  const player = makeLoadout('RKF07', [{ id: 'RR04', stacks: 1 }], {
    journey: { coins: 100 },
  });
  const result = simulate(activeContent, player, makeEnemy(), 'thunder-induction', 1);

  assert.equal(damageFrom(result, 'RKF07-V2-RESONANCE').length, 1);
  assert.equal(lastCounter(result, 'player', 'RKF07-V2-RESONANCE'), 0);
  const counter = lastCounterView(result, 'player', 'RKF07-V2-RESONANCE');
  assert.equal(counter.name, '雷引');
  assert.equal(counter.max, 3, 'display the authored firing threshold');
  assert.equal(counter.value, 0);
  const expectedBolt = expectedDerivedHit(activeContent, player, makeEnemy(), 0.45);
  const expectedWealth = expectedDerivedHit(activeContent, player, makeEnemy(), 0.22);
  assert.ok(Math.abs(damageFrom(result, 'RKF07-V2-RESONANCE')[0].amount -
    expectedBolt) < 1e-8);
  const wealthHits = damageFrom(result, 'RR04-V2-RESONANCE');
  assert.equal(wealthHits.length, 2);
  assert.ok(wealthHits.every(frame => Math.abs(frame.amount - expectedWealth) < 1e-8));
  assert.equal(contribution(result, 'RR04').damage,
    wealthHits.reduce((sum, frame) => sum + frame.amount, 0));
  assert.ok(contribution(result, 'RKF07').damage > 0);
});

test('derived wealth hits can feed another resonance once and retain artifact attribution', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF08', [
    { id: 'RR03', stacks: 1 },
    { id: 'RR04', stacks: 1 },
  ], { journey: { coins: 200 } });
  const result = simulate(activeContent, player, makeEnemy(), 'wealth-feeds-venom-pin', 1);
  const wealthHits = damageFrom(result, 'RR04-V2-RESONANCE');
  const venom = framesFrom(result, 'status', 'RR03-V2-RESONANCE', 1);
  const expectedWealth = expectedDerivedHit(activeContent, player, makeEnemy(), 0.22);
  const expectedPoisonTick = calculateStats(activeContent, player).attack * 0.08;

  assert.equal(wealthHits.length, 3);
  assert.ok(wealthHits.every(frame => frame.actor === 'player' && frame.target === 'enemy' &&
    Math.abs(frame.amount - expectedWealth) < 1e-8));
  assert.equal(venom.length, 1);
  assert.equal(venom[0].amount, 2);
  const venomCounter = lastCounterView(result, 'player', 'RR03-V2-RESONANCE');
  assert.equal(venomCounter.name, '毒针');
  assert.equal(venomCounter.max, 3);
  assert.ok(venomCounter.value >= 0 && venomCounter.value < 3);
  const poisonTicks = framesFrom(result, 'dot', 'RR03-V2-RESONANCE', 1);
  assert.equal(poisonTicks.length, 2);
  assert.ok(poisonTicks.every(frame => Math.abs(frame.amount - expectedPoisonTick) < 1e-8));
  assert.equal(contribution(result, 'RR04').damage,
    wealthHits.reduce((sum, frame) => sum + frame.amount, 0));
});

test('thunder induction counts as one capped lightning followup for its talent', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const resonance = resonanceEffect(entities, 'RKF07');
    resonance.params.hit_threshold = 1;
    resonance.params.attack_ratio = 0.37;
    resonance.params.max_per_action = 2;
    const method = entities.find(item => item.id === 'RKF07');
    method.actions.rage.effects.find(item => item.id === 'RKF07-RAGE-CHAIN').params.chance = 0;
  });
  const player = makeLoadout('RKF07', [], { talents: ['RKF07-J3-C'] });
  const result = simulate(activeContent, player, makeEnemy(), 'induction-followup-limit', 1);
  const bolts = damageFrom(result, 'RKF07-V2-RESONANCE');
  const expectedBolt = expectedDerivedHit(activeContent, player, makeEnemy(), 0.37);

  assert.equal(bolts.length, 2);
  assert.ok(bolts.every(frame => Math.abs(frame.amount - expectedBolt) < 1e-8));
  assert.equal(contribution(result, 'RKF07-J3-C').rage, 8);
  assert.equal(lastCounter(result, 'player', 'RKF07-V2-RESONANCE'), 0);
});
test('moon hex hits once for a live debuff type and requests the authored rage drain', () => {
  const activeContent = withOpeningRage(100);
  const result = simulate(
    activeContent,
    makeLoadout('RKF08'),
    makeEnemy(),
    'moon-hex',
    1,
  );

  assert.equal(damageFrom(result, 'RKF08-V2-RESONANCE').length, 1);
  assert.ok(result.frames.some(frame =>
    frame.kind === 'rage' && frame.source === 'RULES-RAGE-DRAIN' && frame.amount === 2));
  assert.ok(contribution(result, 'RKF08').damage > 0);
});

test('shield retort counts shield-only absorption and attributes its reflect to RC13', () => {
  const activeContent = withOpeningRage(100);
  const player = makeLoadout('RKF08', [{ id: 'RC13', stacks: 2 }], {
    preparation: 1_000,
    speed: 10,
  });
  const opponent = makeEnemy({ attack: 100, speed: 30 });
  const result = simulate(activeContent, player, opponent, 'shield-retort', 1);
  const retorts = damageFrom(result, 'RC13-V2-RESONANCE');

  assert.equal(retorts.length, 1);
  assert.ok(retorts[0].amount > 0);
  assert.ok(contribution(result, 'RC13').damage > 0);
});

test('a lethal shield-absorbed hit cannot trigger postmortem retaliation', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF08', [
    { id: 'RC13', stacks: 1 },
    { id: 'RR09', stacks: 1 },
  ], {
    hp: 1,
    preparation: 100,
    speed: 10,
  });
  const opponent = makeLoadout('RKF07', [], {
    attack: 10_000,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 30,
  });
  const result = simulate(activeContent, player, opponent, 'no-postmortem-retaliation', 1);

  assert.equal(result.outcome, 'enemy');
  assert.ok(result.frames.some(frame =>
    frame.kind === 'damage' && frame.actor === 'enemy' && frame.player.hp === 0));
  assert.equal(damageFrom(result, 'RC13-V2-RESONANCE').length, 0);
  assert.equal(result.frames.some(frame =>
    frame.source === 'RR09-V2-RESONANCE' && ['shield', 'rage'].includes(frame.kind)), false);
});

test('venom pin keeps only below-threshold hits and activates once per main action', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF02', [
    { id: 'RR03', stacks: 1 },
    { id: 'RR04', stacks: 1 },
  ], {
    n: 2,
    talents: ['V2-J2-C'],
    journey: { coins: 200 },
  });
  const result = simulate(activeContent, player, makeEnemy(), 'venom-pin-limit', 1);
  const poisonApplications = framesFrom(result, 'status', 'RR03-V2-RESONANCE');

  assert.equal(poisonApplications.length, 1);
  assert.equal(poisonApplications[0].amount, 2);
  assert.equal(lastCounter(result, 'player', 'RR03-V2-RESONANCE'), 0);
  assert.ok(contribution(result, 'RR03').damage > 0);
  assert.ok(contribution(result, 'RR04').damage > 0);
});

test('wealth strikes use frozen coins and append capped derived segments without spending coins', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF08', [{ id: 'RR04', stacks: 1 }], {
    journey: { coins: 240 },
  });
  const result = simulate(activeContent, player, makeEnemy(), 'wealth-strikes', 1);

  assert.equal(damageFrom(result, 'RR04-V2-RESONANCE').length, 3);
  assert.ok(contribution(result, 'RR04').damage > 0);
});

test('rebound guard rewards the first effective reflected hit of a hostile action', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF01', [{ id: 'RR09', stacks: 1 }], {
    preparation: 1_000,
    speed: 10,
  });
  const opponent = makeEnemy({ attack: 100, speed: 30 });
  const result = simulate(activeContent, player, opponent, 'rebound-guard', 1);

  assert.ok(result.frames.some(frame => frame.kind === 'shield' && frame.source === 'RR09-V2-RESONANCE'));
  assert.ok(contribution(result, 'RR09').shield > 0);
  assert.equal(contribution(result, 'RR09').rage, 10);
});

test('toxic furnace consumes the oldest live own poison and burn layers together', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF09', [
    { id: 'RC14', stacks: 1 },
    { id: 'RR11', stacks: 1 },
  ]);
  const result = simulate(activeContent, player, makeEnemy(), 'toxic-furnace', 1);

  assert.equal(damageFrom(result, 'RR11-V2-RESONANCE').length, 1);
  assert.equal(contribution(result, 'RR11').rage, 8);
  assert.ok(contribution(result, 'RR11').damage > 0);
});

test('moon hex resolves before toxic furnace consumes the live debuffs', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF08', [
    { id: 'RC14', stacks: 1 },
    { id: 'RC15', stacks: 1 },
    { id: 'RR11', stacks: 1 },
  ]);
  const result = simulate(activeContent, player, makeEnemy(), 'moon-before-toxic-furnace', 1);
  const seals = damageFrom(result, 'RKF08-V2-RESONANCE', 1);
  const furnace = damageFrom(result, 'RR11-V2-RESONANCE', 1);
  const lastSealIndex = Math.max(...seals.map(frame => result.frames.indexOf(frame)));
  const furnaceIndex = result.frames.indexOf(furnace[0]);

  assert.equal(seals.length, 3, 'poison, burn, and weakness are all live for moon hex');
  assert.equal(furnace.length, 1);
  assert.ok(furnaceIndex > lastSealIndex);
  assert.equal(result.frames.at(-1).enemy.statuses.poison, undefined);
  assert.equal(result.frames.at(-1).enemy.statuses.burn, undefined);
  assert.equal(result.frames.at(-1).enemy.statuses.weakness, 1);
});

test('healing blades reserve effective healing for the next basic and ignore pure overflow', () => {
  const activeContent = withOpeningRage(0);
  const hurt = makeLoadout('RKF03', [{ id: 'RR12', stacks: 1 }], { hp: 9_000 });
  const healed = simulate(activeContent, hurt, makeEnemy(), 'healing-blades', 2);

  assert.equal(damageFrom(healed, 'RR12-V2-RESONANCE', 2).length, 1);
  assert.ok(maxCounter(healed, 'player', 'RR12-V2-RESONANCE') > 0);
  assert.ok(contribution(healed, 'RR12').damage > 0);

  const full = makeLoadout('RKF03', [{ id: 'RR12', stacks: 1 }]);
  const overflowOnly = simulate(activeContent, full, makeEnemy(), 'healing-blades-overflow', 2);
  assert.equal(damageFrom(overflowOnly, 'RR12-V2-RESONANCE').length, 0);
  assert.equal(maxCounter(overflowOnly, 'player', 'RR12-V2-RESONANCE'), 0);
});

test('ember furnace reserves previous own burn damage and divides it into three rage hits', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF09', [{ id: 'RL02', stacks: 1 }]);
  const result = simulate(activeContent, player, makeEnemy(), 'ember-furnace', 4);
  const furnaceHits = damageFrom(result, 'RL02-V2-RESONANCE', 4);

  assert.equal(furnaceHits.length, 3);
  assert.ok(furnaceHits.every(frame => frame.amount > 0));
  assert.ok(maxCounter(result, 'player', 'RL02-V2-RESONANCE') > 0);
  assert.ok(contribution(result, 'RL02').damage > 0);
});

test('wheel storm is capped at one discharge and rage echo hits do not recharge it', () => {
  const cappedContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const method = entities.find(item => item.id === 'RKF07');
    method.actions.rage.effects.find(item => item.id === 'RKF07-RAGE-DAMAGE').params.segments = 12;
    method.actions.rage.effects.find(item => item.id === 'RKF07-RAGE-CHAIN').params.chance = 0;
  });
  const capped = simulate(
    cappedContent,
    makeLoadout('RKF07', [{ id: 'RL03', stacks: 1 }]),
    makeEnemy(),
    'wheel-storm-action-limit',
    1,
  );
  assert.equal(damageFrom(capped, 'RL03-V2-RESONANCE').length, 4);
  assert.ok(contribution(capped, 'RL03').damage > 0);

  const echoContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const method = entities.find(item => item.id === 'RKF07');
    method.actions.rage.effects.find(item => item.id === 'RKF07-RAGE-CHAIN').params.chance = 0;
  });
  const player = makeLoadout('RKF07', [{ id: 'RL03', stacks: 1 }], {
    n: 3,
    talents: ['V2-J3-B'],
  });
  const result = simulate(echoContent, player, makeEnemy(), 'wheel-storm-echo', 1);

  assert.equal(damageFrom(result, 'RL03-V2-RESONANCE').length, 0);
  assert.equal(lastCounter(result, 'player', 'RL03-V2-RESONANCE'), 4);
  assert.ok(damageFrom(result, 'RKF07-RAGE-DAMAGE-RAGE-ECHO').length > 0);
});

test('an equipped resonance on the enemy side emits enemy-attributed hits', () => {
  const activeContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    resonanceEffect(entities, 'RL03').params.hit_threshold = 1;
  });
  const opponent = makeLoadout('RKF07', [{ id: 'RL03', stacks: 1 }], {
    attack: 200,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 30,
  });
  const result = simulate(
    activeContent,
    makeLoadout('RKF06'),
    opponent,
    'enemy-wheel-storm',
    1,
  );
  const storms = damageFrom(result, 'RL03-V2-RESONANCE');

  assert.equal(storms.length, 4);
  assert.ok(storms.every(frame => frame.actor === 'enemy' && frame.target === 'player'));
  assert.ok(result.frames.some(frame =>
    (frame.enemy.counters ?? []).some(counter =>
      counter.id === 'RL03-V2-RESONANCE' && counter.name === '轮势' && counter.max === 1)));
  assert.equal(result.contributions.some(item => item.id === 'RL03'), false,
    'enemy output is not attributed to player-owned contributions');
});

test('counter snapshots omit absent rules and remain finite and bounded', () => {
  const result = simulate(
    withOpeningRage(0),
    makeLoadout('RKF06', [{ id: 'RR03', stacks: 1 }]),
    makeEnemy(),
    'counter-snapshot',
    1,
  );

  const playerCounters = result.frames.flatMap(frame => frame.player.counters ?? []);
  assert.ok(playerCounters.some(counter => counter.id === 'RR03-V2-RESONANCE'));
  assert.equal(playerCounters.some(counter => counter.id === 'RKF07-V2-RESONANCE'), false);
  assert.equal(lastCounterView(result, 'player', 'RR03-V2-RESONANCE').name, '毒针');
  assert.equal(lastCounterView(result, 'player', 'RR03-V2-RESONANCE').max, 3);
});
