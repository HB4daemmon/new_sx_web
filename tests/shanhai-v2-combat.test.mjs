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

function makeLoadout(method = 'RKF08', artifacts = [], overrides = {}) {
  const { talents = [], n = 4, hp, ...stats } = overrides;
  return {
    name: method,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
  };
}

function contentPatch(edit) {
  const entities = structuredClone(content.entities);
  edit(entities);
  return contentFromEntities(entities, content.version);
}

function openingRage(amount = 100) {
  return contentPatch(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = amount;
  });
}

function withoutCoreRule(id, rageOpening) {
  return contentPatch(entities => {
    delete entities.find(item => item.id === id).core_rule;
    if (rageOpening !== undefined) entities.find(item => item.id === 'RULES').rage.opening = rageOpening;
  });
}

function withSupportDotHeal() {
  return contentPatch(entities => {
    const artifact = structuredClone(content.byId.RR11);
    artifact.id = 'TEST-SUPPORT-DOT-HEAL';
    artifact.name = 'Test support DOT heal';
    artifact.unique_group = null;
    artifact.effects = [{
      id: 'TEST-SUPPORT-DOT-HEAL-EFFECT',
      trigger: 'dot_resolved',
      operation: 'heal',
      target: 'self',
      params: { status: 'burn', ratio: 0.25 },
      requires: [],
      consumes: [],
      replaces: [],
      limit: { scope: 'round', count: 1 },
      text: 'Synthetic support healing outlet.',
    }];
    entities.push(artifact);
  });
}

function enemy(overrides = {}) {
  return makeLoadout('RKF06', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function matchingFrame(result, predicate) {
  const match = result.frames.find(predicate);
  assert.ok(match, 'expected battle frame was not found');
  return match;
}

function contribution(result, id) {
  const match = result.contributions.find(entry => entry.id === id);
  assert.ok(match, `expected contribution ${id}`);
  return match;
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

test('RC09 adds one data-driven derived basic echo and weakens rage base damage', () => {
  const player = makeLoadout('RKF08', [{ id: 'RC09', stacks: 1 }]);
  const basic = simulateBattle(content, player, enemy(), 'v2-rc09-basic', { roundLimit: 1 });
  const stats = calculateStats(content, player);
  const echo = matchingFrame(basic, frame =>
    frame.round === 1 && frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RC09');
  near(echo.amount, stats.attack * content.byId.RC09.core_rule.ratio * 100 / 108);
  assert.equal(basic.frames.filter(frame =>
    frame.round === 1 && frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RC09').length, 1);
  near(contribution(basic, 'RC09').damage, echo.amount);

  const rageContent = openingRage();
  const core = simulateBattle(rageContent, player, enemy(), 'v2-rc09-rage-core', { roundLimit: 1 });
  const plain = simulateBattle(withoutCoreRule('RC09', 100), player, enemy(), 'v2-rc09-rage-plain', { roundLimit: 1 });
  const coreHit = matchingFrame(core, frame => frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF08-RAGE-DAMAGE');
  const plainHit = matchingFrame(plain, frame => frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF08-RAGE-DAMAGE');
  near(coreHit.amount / plainHit.amount, content.byId.RC09.core_rule.rage_damage_ratio);
});

test('RC10 refunds completed rage and increases incoming direct damage', () => {
  const rageContent = openingRage();
  const player = makeLoadout('RKF08', [{ id: 'RC10', stacks: 1 }]);
  const core = simulateBattle(rageContent, player, enemy({ attack: 100 }), 'v2-rc10-core', { roundLimit: 1 });
  const plain = simulateBattle(withoutCoreRule('RC10', 100), player, enemy({ attack: 100 }), 'v2-rc10-plain', { roundLimit: 1 });
  const coreIncoming = matchingFrame(core, frame =>
    frame.kind === 'damage' && frame.actor === 'enemy' && frame.target === 'player' && frame.source === 'RKF06-RAGE-DAMAGE');
  const plainIncoming = matchingFrame(plain, frame =>
    frame.kind === 'damage' && frame.actor === 'enemy' && frame.target === 'player' && frame.source === 'RKF06-RAGE-DAMAGE');
  near(coreIncoming.amount / plainIncoming.amount, content.byId.RC10.core_rule.incoming_damage_ratio);
  near(contribution(core, 'RC10').rage, content.byId.RC10.core_rule.rage_refund);

  const lethal = simulateBattle(
    rageContent,
    player,
    enemy({ max_hp: 1 }),
    'v2-rc10-lethal-no-refund',
    { roundLimit: 1 },
  );
  near(contribution(lethal, 'RC10').rage, 0);
  assert.equal(lethal.frames.some(frame => frame.source === 'RC10' && frame.kind === 'rage'), false);
});

test('RC11 opens with capped shield and rage consumes only actual shield without a break trigger', () => {
  const shieldContent = contentPatch(entities => {
    entities.find(item => item.id === 'RC11').core_rule.shield_ratio = 1;
    entities.find(item => item.id === 'RULES').rage.opening = 100;
  });
  const player = makeLoadout('RKF01', [{ id: 'RC11', stacks: 1 }], {
    talents: ['RKF01-J3-B'],
  });
  const result = simulateBattle(shieldContent, player, enemy(), 'v2-rc11', { roundLimit: 1 });
  const openingShield = matchingFrame(result, frame => frame.kind === 'shield' && frame.source === 'RC11');
  const burst = matchingFrame(result, frame => frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RC11');
  const targetDefense = calculateStats(content, enemy()).defense + 8;
  near(openingShield.amount, calculateStats(content, player).max_hp *
    content.byId.RC11.core_rule.opening_shield_ratio * 1.06);
  near(burst.amount, openingShield.amount * content.byId.RC11.core_rule.damage_ratio * 100 /
    (100 + targetDefense));
  assert.equal(result.frames.some(frame => frame.source === 'RKF01-J3-B-RECHARGE'), false);
  assert.equal(result.frames.filter(frame => frame.kind === 'action' && frame.actor === 'player').length, 1);
  assert.ok(contribution(result, 'RC11').damage > 0);
});

test('RC12 converts every positive effective heal once and weakens direct damage', () => {
  const player = makeLoadout('RKF08', [{ id: 'RC12', stacks: 1 }], { hp: 1_000 });
  const result = simulateBattle(content, player, makeLoadout('RKF01', [], {
    attack: 0,
    defense: 0,
    speed: 1,
    max_hp: 1_000_000,
  }), 'v2-rc12', { roundLimit: 1 });
  const stats = calculateStats(content, player);
  const direct = matchingFrame(result, frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF08-BASIC-DAMAGE');
  const healing = matchingFrame(result, frame => frame.kind === 'heal' && frame.source === 'RC12');
  const shield = matchingFrame(result, frame => frame.kind === 'shield' && frame.source === 'RC12');
  near(direct.amount, stats.attack * content.byId.RKF08.actions.basic.effects[0].params.attack_ratio *
    content.byId.RC12.core_rule.direct_damage_ratio);
  near(healing.amount, 10);
  near(shield.amount, healing.amount * content.byId.RC12.core_rule.shield_ratio);
  near(contribution(result, 'RC12').healing, healing.amount);
  near(contribution(result, 'RC12').shield, shield.amount);

  const sharedContent = contentPatch(entities => {
    entities.find(item => item.id === 'RULES').insights.push({
      id: 'TEST-SHARED-HEAL',
      tier: 2,
      branch: 'A',
      name: 'Synthetic shared healing',
      effects: [{
        id: 'TEST-SHARED-HEAL-ACTION',
        trigger: 'action_end',
        operation: 'heal',
        target: 'self',
        params: { max_hp_ratio: 0.02 },
        requires: [],
        consumes: [],
        replaces: [],
        limit: { scope: 'action', count: 1 },
        text: 'Synthetic shared healing outlet.',
      }],
    });
  });
  const shared = simulateBattle(
    sharedContent,
    makeLoadout('RKF08', [{ id: 'RC12', stacks: 1 }], {
      talents: ['TEST-SHARED-HEAL'],
      n: 2,
      hp: 900,
    }),
    enemy(),
    'v2-rc12-shared-heal-conversion',
    { roundLimit: 1 },
  );
  const sharedMaxHp = calculateStats(sharedContent, makeLoadout('RKF08', [{ id: 'RC12', stacks: 1 }])).max_hp;
  const sharedHeals = shared.frames.filter(frame => frame.kind === 'heal');
  const sharedShields = shared.frames.filter(frame => frame.kind === 'shield' && frame.source === 'RC12');
  near(sharedHeals.find(frame => frame.source === 'TEST-SHARED-HEAL-ACTION').amount, sharedMaxHp * 0.02 * 1.06);
  near(
    sharedShields.reduce((sum, frame) => sum + frame.amount, 0),
    sharedHeals.reduce((sum, frame) => sum + frame.amount, 0) * sharedContent.byId.RC12.core_rule.shield_ratio,
  );
  near(contribution(shared, 'TEST-SHARED-HEAL').healing, sharedMaxHp * 0.02 * 1.06);

  const methodHealing = simulateBattle(
    content,
    makeLoadout('RKF03', [
      { id: 'RC12', stacks: 1 },
      { id: 'RR02', stacks: 1 },
    ], { hp: 900 }),
    enemy(),
    'v2-rc12-method-heal-conversion',
    { roundLimit: 1 },
  );
  const methodHeals = methodHealing.frames.filter(frame => frame.kind === 'heal');
  const methodHeal = matchingFrame(methodHealing, frame =>
    frame.kind === 'heal' && frame.source === 'RKF03-BASIC-HEAL');
  const methodCoreShields = methodHealing.frames
    .filter(frame => frame.kind === 'shield' && frame.source === 'RC12');
  const supportShield = matchingFrame(methodHealing, frame =>
    frame.kind === 'shield' && frame.source === 'RR02-FIRST-SELF-HEAL-SHIELD');
  near(
    methodCoreShields.reduce((sum, frame) => sum + frame.amount, 0),
    methodHeals.reduce((sum, frame) => sum + frame.amount, 0) * content.byId.RC12.core_rule.shield_ratio,
  );
  near(supportShield.amount, methodHeal.amount * 0.35);
  near(contribution(methodHealing, 'RKF03').healing, methodHeal.amount);
  near(contribution(methodHealing, 'RR02').shield, supportShield.amount);

  const artifactContent = withSupportDotHeal();
  const artifactHeal = simulateBattle(
    artifactContent,
    makeLoadout('RKF04', [
      { id: 'RC12', stacks: 1 },
      { id: 'TEST-SUPPORT-DOT-HEAL', stacks: 1 },
    ], { hp: 500 }),
    enemy(),
    'v2-rc12-artifact-heal-conversion',
    { roundLimit: 1 },
  );
  const supportHealing = matchingFrame(artifactHeal, frame =>
    frame.kind === 'heal' && frame.source === 'TEST-SUPPORT-DOT-HEAL-EFFECT');
  const supportDotDamage = matchingFrame(artifactHeal, frame =>
    frame.kind === 'dot' && frame.actor === 'player' && frame.target === 'enemy');
  const supportHealShield = artifactHeal.frames
    .filter(frame => frame.kind === 'shield' && frame.source === 'RC12')
    .reduce((sum, frame) => sum + frame.amount, 0);
  near(supportHealing.amount, supportDotDamage.amount * 0.25 * 1.06);
  near(
    supportHealShield,
    artifactHeal.frames.filter(frame => frame.kind === 'heal')
      .reduce((sum, frame) => sum + frame.amount, 0) * content.byId.RC12.core_rule.shield_ratio,
  );
  near(contribution(artifactHeal, 'TEST-SUPPORT-DOT-HEAL').healing, supportHealing.amount);
  assert.ok(contribution(artifactHeal, 'RC12').shield >= supportHealing.amount * content.byId.RC12.core_rule.shield_ratio);
});

test('RC14 detonates every action-start owned poison layer and leaves rage-added layers intact', () => {
  const player = makeLoadout('RKF06', [{ id: 'RC14', stacks: 1 }]);
  const result = simulateBattle(content, player, enemy(), 'v2-rc14-ticks', { roundLimit: 3 });
  const stats = calculateStats(content, player);
  const poisonRatio = content.rules.statuses.poison.attack_ratio_per_stack;
  const legacyRatio = content.byId.RC14.effects[0].params.ratio;
  const targetDefense = calculateStats(content, enemy()).defense + 8;
  const expected = stats.attack * poisonRatio * (1 + legacyRatio) * 6 *
    content.byId.RC14.core_rule.damage_ratio * 100 / (100 + targetDefense);
  const detonation = matchingFrame(result, frame =>
    frame.round === 3 && frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RC14');
  near(detonation.amount, expected);
  assert.equal(result.frames.at(-1).enemy.statuses.poison, 2);
  assert.equal(result.frames.filter(frame => frame.kind === 'action' && frame.actor === 'player').length, 3);
  assert.equal(result.frames.filter(frame => frame.round <= 2 && frame.kind === 'status' && frame.source === 'RC14').length, 2);
  assert.equal(result.frames.filter(frame =>
    frame.round === 3 && frame.actor === 'player' && frame.target === 'enemy' &&
    frame.kind === 'status' && frame.source === 'RKF06-RAGE-POISON')
    .reduce((sum, frame) => sum + frame.amount, 0), 2);
  assert.ok(contribution(result, 'RC14').damage >= detonation.amount);
});

test('RC15 applies burn, heals from actual burn HP damage once per round, and weakens rage damage', () => {
  const player = makeLoadout('RKF08', [{ id: 'RC15', stacks: 1 }], { hp: 900 });
  const result = simulateBattle(content, player, enemy(), 'v2-rc15-siphon', { roundLimit: 3 });
  const dotFrames = result.frames.filter(frame => frame.kind === 'dot' && frame.actor === 'player' && frame.source === 'RC15');
  const healFrames = result.frames.filter(frame => frame.kind === 'heal' && frame.source === 'RC15');
  assert.equal(healFrames.length, 3);
  for (const heal of healFrames) {
    const roundDamage = dotFrames
      .filter(frame => frame.round === heal.round)
      .reduce((sum, frame) => sum + frame.amount, 0);
    near(heal.amount, roundDamage * content.byId.RC15.core_rule.heal_ratio);
  }
  const stats = calculateStats(content, player);
  const rageHit = matchingFrame(result, frame =>
    frame.round === 3 && frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF08-RAGE-DAMAGE');
  const targetDefense = calculateStats(content, enemy()).defense + 8;
  near(rageHit.amount, stats.attack * content.byId.RKF08.actions.rage.effects[0].params.attack_ratio *
    content.byId.RC15.core_rule.rage_damage_ratio * 100 / (100 + targetDefense));
  near(contribution(result, 'RC15').healing, healFrames.reduce((sum, frame) => sum + frame.amount, 0));
});

test('RC15 pays its burn window before opposing DOTs and never heals from shield absorption', () => {
  const fastSiphon = simulateBattle(
    content,
    makeLoadout('RKF04', [{ id: 'RC15', stacks: 1 }], {
      attack: 1_000,
      defense: 50_000,
      max_hp: 1_000,
      hp: 100,
      speed: 11,
    }),
    makeLoadout('RKF04', [], {
      attack: 1_600,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 10,
    }),
    'v2-rc15-fast-window-before-lethal-opponent-dot',
    { roundLimit: 3 },
  );
  const fastHeals = fastSiphon.frames.filter(frame =>
    frame.kind === 'heal' && frame.actor === 'player' && frame.source === 'RC15');
  assert.ok(fastHeals.some(frame => frame.round === 1));
  const roundOneHealIndex = fastSiphon.frames.findIndex(frame =>
    frame.round === 1 && frame.kind === 'heal' && frame.actor === 'player' && frame.source === 'RC15');
  const lethalOpponentDotIndex = fastSiphon.frames.findIndex(frame =>
    frame.round === 1 && frame.kind === 'dot' && frame.actor === 'enemy' && frame.target === 'player');
  assert.ok(roundOneHealIndex >= 0 && roundOneHealIndex < lethalOpponentDotIndex);
  assert.equal(fastSiphon.outcome, 'enemy');

  const slowSiphon = simulateBattle(
    content,
    makeLoadout('RKF04', [{ id: 'RC15', stacks: 1 }], {
      attack: 100,
      defense: 50_000,
      max_hp: 1_000,
      hp: 100,
      speed: 9,
    }),
    makeLoadout('RKF04', [], {
      attack: 500,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 11,
    }),
    'v2-rc15-slow-window-after-nonlethal-opponent-dot',
    { roundLimit: 1 },
  );
  assert.ok(slowSiphon.frames.some(frame =>
    frame.round === 1 && frame.kind === 'heal' && frame.actor === 'player' && frame.source === 'RC15'));

  const fullyShielded = simulateBattle(
    content,
    makeLoadout('RKF04', [{ id: 'RC15', stacks: 1 }], {
      attack: 100,
      defense: 0,
      max_hp: 1_000,
      hp: 500,
      speed: 11,
    }),
    makeLoadout('RKF01', [], {
      attack: 0,
      defense: 10_000,
      max_hp: 1_000_000,
      speed: 10,
    }),
    'v2-rc15-shield-absorbs-all-burn',
    { roundLimit: 1 },
  );
  assert.ok(fullyShielded.frames.some(frame =>
    frame.round === 1 && frame.kind === 'dot' && frame.actor === 'player' && frame.amount > 0));
  assert.equal(fullyShielded.frames.some(frame => frame.kind === 'heal' && frame.source === 'RC15'), false);
  near(contribution(fullyShielded, 'RC15').healing, 0);
});

test('shared insights use current build rules across methods and enforce one selection per tier', () => {
  const stats = calculateStats(content, makeLoadout('RKF08', [], { talents: ['V2-J4-C'] }));
  near(stats.attack, BASE_STATS.attack * 1.35);
  const statBattle = simulateBattle(
    content,
    makeLoadout('RKF08', [], { talents: ['V2-J4-C'] }),
    enemy(),
    'v2-insight-attack-stat',
    { roundLimit: 1 },
  );
  const statHit = matchingFrame(statBattle, frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF08-BASIC-DAMAGE');
  near(statHit.amount, stats.attack * content.byId.RKF08.actions.basic.effects[0].params.attack_ratio * 100 / 108);

  const openingShield = simulateBattle(
    content,
    makeLoadout('RKF08', [], { talents: ['V2-J3-C'] }),
    enemy(),
    'v2-insight-opening-shield',
    { roundLimit: 1 },
  );
  assert.ok(openingShield.frames.some(frame => frame.source === 'V2-J3-C-BUILD' && frame.amount === 60));
  assert.ok(contribution(openingShield, 'V2-J3-C').shield > 0);

  const roundRage = simulateBattle(
    openingRage(0),
    makeLoadout('RKF08', [], { talents: ['V2-J3-A'] }),
    enemy(),
    'v2-insight-round-rage',
    { roundLimit: 1 },
  );
  near(contribution(roundRage, 'V2-J3-A').rage, 3);

  const openingWealthShield = simulateBattle(
    content,
    makeLoadout('RKF08', [], { talents: ['V2-J4-A'] }),
    enemy(),
    'v2-insight-opening-wealth-shield',
    { roundLimit: 1 },
  );
  near(contribution(openingWealthShield, 'V2-J4-A').shield, 30);
  assert.ok(openingWealthShield.frames.some(frame => frame.source === 'V2-J4-A-BUILD'));

  const localTierOne = content.byId.RKF08.talents.find(talent => talent.tier === 1);
  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF08', [], { talents: [localTierOne.id, 'V2-J1-A'] }),
    enemy(),
    'v2-insight-tier-conflict',
    { roundLimit: 1 },
  ), /More than one talent selected at tier 1/);

  const invalidInsightContent = contentPatch(entities => {
    entities.find(item => item.id === 'RULES').insights
      .find(talent => talent.id === 'V2-J1-A').effects[0].operation = 'apply_status';
  });
  assert.throws(() => simulateBattle(
    invalidInsightContent,
    makeLoadout('RKF08', [], { talents: ['V2-J1-A'] }),
    enemy(),
    'v2-insight-unsupported-operation',
    { roundLimit: 1 },
  ), /Unsupported shared insight effect/);
});

test('lethal core burn ends combat without granting post-battle siphon healing', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF08', [{ id: 'RC15', stacks: 1 }], { hp: 500 }),
    enemy({ max_hp: 90, hp: 90 }),
    'v2-burn-lethal',
    { roundLimit: 1 },
  );
  assert.equal(result.outcome, 'player');
  assert.ok(result.frames.some(frame =>
    frame.kind === 'dot' && frame.source === 'RC15' && frame.enemy.hp === 0));
  assert.equal(result.frames.some(frame => frame.kind === 'heal' && frame.source === 'RC15'), false);
  near(contribution(result, 'RC15').healing, 0);
});

test('four generic artifact slots accept any role mix and reject a fifth unique artifact', () => {
  const fourCores = simulateBattle(
    openingRage(),
    makeLoadout('RKF01', [
      { id: 'RC09', stacks: 1 },
      { id: 'RC10', stacks: 1 },
      { id: 'RC11', stacks: 1 },
      { id: 'RC12', stacks: 1 },
    ]),
    enemy({ speed: 1 }),
    'v2-four-core-rules',
    { roundLimit: 1 },
  );
  for (const id of ['RC09', 'RC10', 'RC11', 'RC12']) {
    assert.ok(contribution(fourCores, id).triggers > 0, `expected ${id} to operate in a generic slot`);
  }
  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF08', [{ id: 'RC09', stacks: 1 }, { id: 'RC09', stacks: 1 }]),
    enemy(),
    'v2-duplicate-artifact-id',
    { roundLimit: 1 },
  ), /Duplicate artifact ID RC09/);
  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF08', ['RC01', 'RC02', 'RC03', 'RC04', 'RC05'].map(id => ({ id, stacks: 1 }))),
    enemy(),
    'v2-five-supports',
    { roundLimit: 1 },
  ), /four artifact slots/);

  const fourSupportsLoadout = makeLoadout('RKF08', ['RC01', 'RC02', 'RC03', 'RC04']
    .map(id => ({ id, stacks: 1 })));
  const fourSupportStats = calculateStats(content, fourSupportsLoadout);
  assert.ok(fourSupportStats.attack > BASE_STATS.attack);
  const fourSupports = simulateBattle(
    content,
    fourSupportsLoadout,
    enemy(),
    'v2-four-supports',
    { roundLimit: 1 },
  );
  assert.ok(fourSupports.frames.some(frame => frame.kind === 'action' && frame.actor === 'player'));

  const rolelessEntities = structuredClone(content.entities);
  for (const artifact of rolelessEntities.filter(item => item.kind === 'artifact')) {
    delete artifact.equipment_role;
  }
  const legacyFixtures = contentFromEntities(rolelessEntities, 'shanhai-content-0.1');
  assert.throws(() => simulateBattle(
    legacyFixtures,
    makeLoadout('RKF08', [{ id: 'RC09', stacks: 1 }]),
    enemy(),
    'v1-roleless-fixture',
    { roundLimit: 1 },
  ), /Missing equipment role/);
  const rolelessV2 = contentFromEntities(rolelessEntities, content.version);
  assert.throws(() => simulateBattle(
    rolelessV2,
    makeLoadout('RKF08', [{ id: 'RC09', stacks: 1 }]),
    enemy(),
    'v2-roleless-content',
    { roundLimit: 1 },
  ), /Missing equipment role/);
});
