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
  max_hp: 1_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const {
    talents = [],
    n = 4,
    hp,
    encounterId,
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
    ...(encounterId === undefined ? {} : { encounterId }),
  };
}

function enemy(overrides = {}) {
  const { method = 'RKF06', ...stats } = overrides;
  return makeLoadout(method, [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...stats,
  });
}

function patchContent(edit, base = content) {
  const entities = structuredClone(base.entities);
  edit(entities);
  return contentFromEntities(entities, base.version);
}

function convergenceContent(edit = () => {}) {
  return patchContent(entities => {
    entities.find(item => item.id === 'RC01').core_rule = {
      kind: 'basic_convergence',
      damage_ratio: 1.25,
    };
    edit(entities);
  });
}

function withOpeningRage(amount, base = convergenceContent()) {
  return patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = amount;
  }, base);
}

function damageFrom(result, source, actor, round) {
  return result.frames.filter(frame =>
    frame.kind === 'damage' &&
    frame.source === source &&
    (actor === undefined || frame.actor === actor) &&
    (round === undefined || frame.round === round));
}

function contribution(result, id) {
  const entry = result.contributions.find(item => item.id === id);
  assert.ok(entry, `expected contribution ${id}`);
  return entry;
}

function counter(result, side, id) {
  for (let index = result.frames.length - 1; index >= 0; index -= 1) {
    const value = result.frames[index][side].counters?.find(item => item.id === id);
    if (value) return value.value;
  }
  assert.fail(`expected ${side} counter ${id}`);
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

test('RC01 combines finalized split and returning-breath ratios before its separate max-stack awakening', () => {
  const activeContent = withOpeningRage(100);
  const player = makeLoadout('RKF02', [{ id: 'RC01', stacks: 5 }], {
    talents: ['V2-J2-C'],
    attack: 100,
    crit_rate: 1,
    speed: 30,
  });
  const opponent = enemy();
  const result = simulateBattle(activeContent, player, opponent, 'rc01-converges-returning-breath', {
    roundLimit: 2,
  });

  const rageHits = damageFrom(result, 'RKF02-RAGE-DAMAGE', 'player', 1);
  assert.equal(rageHits.length, 1, 'rage actions remain outside convergence');
  const plainContent = patchContent(entities => {
    delete entities.find(item => item.id === 'RC01').core_rule;
  }, activeContent);
  const plain = simulateBattle(plainContent, player, opponent, 'rc01-converges-returning-breath', {
    roundLimit: 1,
  });
  near(rageHits[0].amount, damageFrom(plain, 'RKF02-RAGE-DAMAGE', 'player', 1)[0].amount);
  const actionIndex = result.frames.findIndex(frame =>
    frame.round === 2 && frame.kind === 'action' && frame.actor === 'player' &&
    frame.source === 'RKF02-BASIC-DAMAGE');
  const markerIndex = result.frames.findIndex(frame =>
    frame.round === 2 && frame.kind === 'status' && frame.source === 'RC01-CORE');
  const baseHits = damageFrom(result, 'RKF02-BASIC-DAMAGE', 'player', 2);
  const awakeningHits = damageFrom(result, 'RC01-AWAKENING-1', 'player', 2);
  assert.equal(baseHits.length, 1);
  assert.equal(awakeningHits.length, 1, 'the max-stack awakening is a separate hit after the converged basic');
  assert.ok(actionIndex >= 0 && markerIndex > actionIndex);
  assert.ok(markerIndex < result.frames.indexOf(baseHits[0]));
  assert.ok(result.frames.indexOf(awakeningHits[0]) > result.frames.indexOf(baseHits[0]));
  assert.equal(result.frames[markerIndex].text, '凝锋：5段合一，不可暴击');
  assert.equal(result.frames[markerIndex].actor, 'player');
  assert.equal(result.frames[markerIndex].target, 'enemy');
  assert.equal(result.frames[markerIndex].amount, 5);
  assert.equal(baseHits[0].text.includes('暴击'), false);
  assert.equal(awakeningHits[0].text.includes('暴击'), false);

  const attack = calculateStats(activeContent, player).attack;
  const targetDefense = calculateStats(activeContent, opponent).defense + 8;
  const finalizedRatio = 5 * 1.55 * 0.6 * 0.55;
  near(baseHits[0].amount, attack * finalizedRatio * 1.25 * 100 / (100 + targetDefense));
  near(awakeningHits[0].amount, attack * 0.18 * 100 / (100 + targetDefense));
  assert.equal(contribution(result, 'RC01').triggers, 2,
    'RC01 records one convergence and one separate awakening trigger');
  near(contribution(result, 'RC01').damage, awakeningHits[0].amount);
  assert.ok(contribution(result, 'RKF02').damage >= baseHits[0].amount);

  const oneLayerPlayer = makeLoadout('RKF02', [{ id: 'RC01', stacks: 1 }], {
    talents: ['V2-J2-C'],
    attack: 100,
    crit_rate: 1,
    speed: 30,
  });
  const oneLayer = simulateBattle(activeContent, oneLayerPlayer, opponent, 'rc01-converges-returning-breath', {
    roundLimit: 2,
  });
  const oneLayerBaseHits = damageFrom(oneLayer, 'RKF02-BASIC-DAMAGE', 'player', 2);
  assert.equal(oneLayerBaseHits.length, 1);
  assert.equal(damageFrom(oneLayer, 'RC01-AWAKENING-1', 'player', 2).length, 0,
    'a one-layer copy exercises convergence without awakening');
  near(
    oneLayerBaseHits[0].amount / calculateStats(activeContent, oneLayerPlayer).attack,
    baseHits[0].amount / attack,
  );
  assert.equal(contribution(oneLayer, 'RC01').triggers, 1);
  near(contribution(oneLayer, 'RC01').damage, 0);
});

test('RC01 reports one segment and never creates a hit from a zero-segment basic', () => {
  const oneSegmentContent = withOpeningRage(0);
  const player = makeLoadout('RKF08', [{ id: 'RC01', stacks: 1 }], {
    crit_rate: 1,
    speed: 30,
  });
  const oneSegment = simulateBattle(
    oneSegmentContent,
    player,
    enemy({ method: 'RKF01' }),
    'rc01-one-segment',
    { roundLimit: 1 },
  );
  const oneMarker = oneSegment.frames.find(frame => frame.kind === 'status' && frame.source === 'RC01-CORE');
  assert.equal(oneMarker.text, '凝锋：1段合一，不可暴击');
  assert.equal(damageFrom(oneSegment, 'RKF08-BASIC-DAMAGE', 'player', 1).length, 1);
  assert.equal(damageFrom(oneSegment, 'RKF08-BASIC-DAMAGE', 'player', 1)[0].text.includes('暴击'), false);

  const zeroSegmentContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    entities.find(item => item.id === 'RKF08').actions.basic.effects
      .find(effect => effect.id === 'RKF08-BASIC-DAMAGE').params.segments = 0;
  });
  const zeroSegment = simulateBattle(
    zeroSegmentContent,
    player,
    enemy({ method: 'RKF01' }),
    'rc01-zero-segment',
    { roundLimit: 1 },
  );
  const zeroMarker = zeroSegment.frames.find(frame => frame.kind === 'status' && frame.source === 'RC01-CORE');
  assert.equal(zeroMarker.text, '凝锋：0段合一，不可暴击');
  assert.equal(damageFrom(zeroSegment, 'RKF08-BASIC-DAMAGE', 'player', 1).length, 0);
  assert.equal(contribution(zeroSegment, 'RC01').triggers, 1);
});

test('RC01 leaves an artifact-derived basic echo outside its multiplier', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF08', [
    { id: 'RC01', stacks: 1 },
    { id: 'RC09', stacks: 1 },
  ], { speed: 30 });
  const result = simulateBattle(
    activeContent,
    player,
    enemy({ method: 'RKF01' }),
    'rc01-keeps-basic-echo-separate',
    { roundLimit: 1 },
  );

  const attack = calculateStats(activeContent, player).attack;
  const baseHit = damageFrom(result, 'RKF08-BASIC-DAMAGE', 'player', 1);
  const echo = damageFrom(result, 'RC09', 'player', 1);
  assert.equal(baseHit.length, 1);
  assert.equal(echo.length, 1);
  near(baseHit[0].amount, attack * 0.9 * 1.06 * 1.25);
  near(echo[0].amount, attack * activeContent.byId.RC09.core_rule.ratio);
  near(contribution(result, 'RC01').damage, 0);
  near(contribution(result, 'RC09').damage, echo[0].amount);
});

test('RC01 combines per-segment noncritical sword-intent bonuses before its multiplier', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF05', [{ id: 'RC01', stacks: 1 }], {
    talents: ['V2-J2-C'],
    crit_rate: 1,
    speed: 30,
  });
  const opponent = enemy({ method: 'RKF01' });
  const result = simulateBattle(activeContent, player, opponent, 'rc01-sword-intent-bonus', {
    roundLimit: 2,
  });
  const roundTwoHits = damageFrom(result, 'RKF05-BASIC-DAMAGE', 'player', 2);

  assert.equal(roundTwoHits.length, 1);
  assert.equal(roundTwoHits[0].text.includes('暴击'), false);
  assert.equal(result.frames.find(frame =>
    frame.round === 2 && frame.kind === 'status' && frame.source === 'RC01-CORE').text,
  '凝锋：3段合一，不可暴击');
  const attack = calculateStats(activeContent, player).attack;
  const ratioSum = 3 * 0.95 * 0.6;
  const bonusSum = 3 * 0.07 * 0.6;
  near(roundTwoHits[0].amount, attack * (ratioSum + bonusSum) * 1.25);
});

test('one converged base hit grants one poison layer and one hit-rage reward without phantom wheel or venom hits', () => {
  const activeContent = convergenceContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    entities.find(item => item.id === 'RL03').effects[0].params.hit_threshold = 2;
    entities.find(item => item.id === 'RR03').effects[0].params.hit_threshold = 2;
  });
  const player = makeLoadout('RKF06', [
    { id: 'RC01', stacks: 1 },
    { id: 'RL03', stacks: 1 },
    { id: 'RR03', stacks: 1 },
    { id: 'RR01', stacks: 1 },
  ], {
    talents: ['V2-J2-C', 'V2-J3-A'],
    speed: 30,
  });
  const result = simulateBattle(activeContent, player, enemy(), 'rc01-converged-hit-effects', {
    roundLimit: 1,
  });

  assert.equal(damageFrom(result, 'RKF06-BASIC-DAMAGE', 'player', 1).length, 1);
  assert.equal(damageFrom(result, 'RC01-AWAKENING-1', 'player', 1).length, 0,
    'the one-layer comparison excludes the separate awakening hit');
  assert.equal(result.frames.filter(frame =>
    frame.kind === 'status' && frame.source === 'RKF06-BASIC-POISON' && frame.amount === 1).length, 1);
  assert.equal(result.frames.at(-1).enemy.statuses.poison, 1);
  near(contribution(result, 'V2-J3-A').rage, 3);
  near(contribution(result, 'RR01').rage, 10);
  assert.equal(counter(result, 'player', 'RL03-V2-RESONANCE'), 1);
  assert.equal(counter(result, 'player', 'RR03-V2-RESONANCE'), 1);
  assert.equal(damageFrom(result, 'RL03-V2-RESONANCE').length, 0);
  assert.equal(result.frames.some(frame =>
    frame.source === 'RR03-V2-RESONANCE' && frame.kind === 'status'), false);
  assert.equal(contribution(result, 'RC01').triggers, 1);
});

test('convergence keeps the independent RKF07 chain as one unscaled follow-up', () => {
  const activeContent = convergenceContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    entities.find(item => item.id === 'RKF07').actions.basic.effects
      .find(effect => effect.id === 'RKF07-BASIC-CHAIN').params.chance = 1;
  });
  const player = makeLoadout('RKF07', [{ id: 'RC01', stacks: 1 }], {
    talents: ['V2-J2-C'],
    speed: 30,
  });
  const result = simulateBattle(
    activeContent,
    player,
    enemy({ method: 'RKF01' }),
    'rc01-independent-chain',
    { roundLimit: 1 },
  );

  const baseHits = damageFrom(result, 'RKF07-BASIC-DAMAGE', 'player', 1);
  const chainHits = damageFrom(result, 'RKF07-BASIC-CHAIN', 'player', 1);
  assert.equal(baseHits.length, 1);
  assert.equal(chainHits.length, 1);
  assert.equal(result.frames.find(frame => frame.kind === 'status' && frame.source === 'RC01-CORE').text,
    '凝锋：3段合一，不可暴击');
  assert.equal(counter(result, 'player', 'RKF07-V2-RESONANCE'), 2);
  assert.equal(damageFrom(result, 'RKF07-V2-RESONANCE').length, 0);
  const attack = calculateStats(activeContent, player).attack;
  near(chainHits[0].amount, attack * 0.48);
  near(baseHits[0].amount, attack * 0.75 * 3 * 0.6 * 1.25);
});

test('one merged hit breaks one boss charge and causes one carapace retaliation', () => {
  const activeContent = withOpeningRage(0);
  const player = makeLoadout('RKF02', [{ id: 'RC01', stacks: 1 }], {
    talents: ['V2-J2-C'],
    speed: 30,
  });
  const boss = makeLoadout('RKF10', [], {
    attack: 0,
    defense: 100,
    max_hp: 1_000_000,
    speed: 1,
    talents: ['V2-J1-D'],
    encounterId: 'EN-A1-B1',
  });
  const result = simulateBattle(activeContent, player, boss, 'rc01-boss-single-charge-break', {
    roundLimit: 1,
  });

  const baseHits = damageFrom(result, 'RKF02-BASIC-DAMAGE', 'player', 1);
  assert.equal(baseHits.length, 1);
  assert.equal(result.frames.filter(frame =>
    frame.kind === 'status' && frame.text.includes('潮汐蓄势被打断')).length, 1);
  assert.equal(counter(result, 'enemy', 'EN-A1-B1-TRIAL-CHARGES'), 2);
  const retaliations = result.frames.filter(frame =>
    frame.kind === 'damage' && frame.source === 'V2-J1-D-BUILD' &&
    frame.actor === 'enemy' && frame.target === 'player');
  assert.equal(retaliations.length, 1);
  assert.ok(retaliations[0].amount > 0);
});

test('an enemy-side RC01 converges its own basic action symmetrically', () => {
  const activeContent = withOpeningRage(0);
  const player = enemy({ method: 'RKF01', attack: 0, speed: 1, max_hp: 1_000_000 });
  const opponent = makeLoadout('RKF06', [{ id: 'RC01', stacks: 2 }], {
    talents: ['V2-J2-C'],
    attack: 100,
    crit_rate: 1,
    speed: 30,
  });
  const result = simulateBattle(activeContent, player, opponent, 'rc01-enemy-side', {
    roundLimit: 1,
  });

  const marker = result.frames.find(frame =>
    frame.kind === 'status' && frame.source === 'RC01-CORE' && frame.actor === 'enemy');
  assert.ok(marker);
  assert.equal(marker.text, '凝锋：3段合一，不可暴击');
  const baseHits = damageFrom(result, 'RKF06-BASIC-DAMAGE', 'enemy', 1);
  assert.equal(baseHits.length, 1);
  assert.equal(baseHits[0].text.includes('暴击'), false);
  assert.equal(result.contributions.some(item => item.id === 'RC01'), false);
});

test('a lethal converged hit stops the action before its independent chain can resolve', () => {
  const activeContent = convergenceContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    entities.find(item => item.id === 'RKF07').actions.basic.effects
      .find(effect => effect.id === 'RKF07-BASIC-CHAIN').params.chance = 1;
  });
  const player = makeLoadout('RKF07', [{ id: 'RC01', stacks: 1 }], {
    talents: ['V2-J2-C'],
    speed: 30,
  });
  const attack = calculateStats(activeContent, player).attack;
  const lethalDamage = attack * 0.75 * 3 * 0.6 * 1.25;
  const opponent = enemy({
    method: 'RKF01',
    max_hp: 1_000_000,
    hp: lethalDamage - 1e-6,
  });
  const result = simulateBattle(activeContent, player, opponent, 'rc01-lethal-stop', {
    roundLimit: 1,
  });

  assert.equal(result.outcome, 'player');
  assert.equal(damageFrom(result, 'RKF07-BASIC-DAMAGE', 'player', 1).length, 1);
  assert.equal(damageFrom(result, 'RKF07-BASIC-CHAIN', 'player', 1).length, 0);
  assert.equal(result.frames.at(-1).kind, 'end');
  assert.equal(result.frames.slice(result.frames.findIndex(frame =>
    frame.kind === 'damage' && frame.source === 'RKF07-BASIC-DAMAGE') + 1)
    .some(frame => frame.kind === 'damage'), false);
});

test('RC01 rejects malformed or unknown convergence core parameters', () => {
  const cases = [
    ['missing damage ratio', { kind: 'basic_convergence' }, /Invalid core_rule parameter damage_ratio/],
    ['negative damage ratio', { kind: 'basic_convergence', damage_ratio: -0.1 }, /Invalid core_rule parameter damage_ratio/],
    ['nonfinite damage ratio', { kind: 'basic_convergence', damage_ratio: Number.NaN }, /Invalid core_rule parameter damage_ratio/],
    ['unknown parameter', { kind: 'basic_convergence', damage_ratio: 1.25, stacks: 2 }, /Unknown core_rule parameter/],
    ['unknown rule kind', { kind: 'unsupported_convergence', damage_ratio: 1.25 }, /Unsupported core_rule/],
  ];

  for (const [name, coreRule, expected] of cases) {
    const invalid = patchContent(entities => {
      entities.find(item => item.id === 'RC01').core_rule = coreRule;
    });
    assert.throws(
      () => simulateBattle(
        invalid,
        makeLoadout('RKF08', [{ id: 'RC01', stacks: 1 }]),
        enemy(),
        `rc01-invalid-${name}`,
        { roundLimit: 1 },
      ),
      expected,
      name,
    );
  }
});
