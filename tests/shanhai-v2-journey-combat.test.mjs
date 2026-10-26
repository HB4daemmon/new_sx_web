import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { buildMechanicViews as mechanicViews } from '../build/shanhai/build-mechanics.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const baseContent = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 10_000,
  crit_rate: 0,
  speed: 10,
});

function withBuilds(builds, editRules) {
  const entities = structuredClone(baseContent.entities);
  const rules = entities.find(entity => entity.id === 'RULES');
  for (const build of builds) {
    rules.insights.push({
      id: build.id,
      name: build.name ?? build.id,
      tier: build.tier,
      branch: build.branch ?? 'D',
      quick: 'Test build mechanic',
      category: 'build',
      effects: [{
        id: `${build.id}-RULE`,
        trigger: 'always',
        operation: 'modify_effect',
        target: 'self',
        params: { build: build.kind, ...build.params },
        requires: [],
        consumes: [],
        replaces: [],
        limit: { scope: 'permanent', count: 1 },
        text: 'Synthetic V2 journey build rule.',
      }],
    });
  }
  editRules?.(rules);
  return contentFromEntities(entities, baseContent.version);
}

function loadout(method = 'RKF01', talents = [], artifacts = [], overrides = {}) {
  const { hp, journey, ...stats } = overrides;
  return {
    name: method,
    method,
    n: 4,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
    ...(journey === undefined ? {} : { journey: structuredClone(journey) }),
  };
}

function enemy(overrides = {}) {
  const { tier, ...stats } = overrides;
  return {
    ...loadout('RKF01', [], [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 1, ...stats }),
    ...(tier ? { tier } : {}),
  };
}

function firstDamage(result, source = undefined) {
  const frame = result.frames.find(item =>
    item.kind === 'damage' && item.actor === 'player' &&
    (source === undefined || item.source === source));
  assert.ok(frame, `expected outgoing damage frame${source ? ` from ${source}` : ''}`);
  return frame;
}

function contribution(result, id) {
  const item = result.contributions.find(entry => entry.id === id);
  assert.ok(item, `expected contribution from ${id}`);
  return item;
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

function buildMechanicViews(content, player) {
  return mechanicViews(content, player, calculateStats(content, player));
}

function openingRage(content, amount = 100) {
  const entities = structuredClone(content.entities);
  entities.find(entity => entity.id === 'RULES').rage.opening = amount;
  return contentFromEntities(entities, content.version);
}

test('wealth and actual paid spending use separate frozen journey facts', () => {
  const content = withBuilds([
    { id: 'TEST-WEALTH', tier: 1, kind: 'wealth_damage', params: { scale: 1.2, half_saturation: 150 } },
    { id: 'TEST-SPENDING', tier: 2, kind: 'spending_power', params: { base_attack: 8, attack_per_coin: 0.08 } },
  ]);
  const poor = loadout('RKF08', ['TEST-WEALTH', 'TEST-SPENDING'], [], {
    journey: { coins: 0, coinsSpent: 50, eliteWins: 0, bossWins: 0, artifactKinds: 0, knownMethods: 1 },
  });
  const deposited = loadout('RKF08', ['TEST-WEALTH', 'TEST-SPENDING'], [], {
    journey: { coins: 150, coinsSpent: 50, eliteWins: 0, bossWins: 0, artifactKinds: 0, knownMethods: 1 },
  });
  const spentLater = loadout('RKF08', ['TEST-WEALTH', 'TEST-SPENDING'], [], {
    journey: { coins: 150, coinsSpent: 100, eliteWins: 0, bossWins: 0, artifactKinds: 0, knownMethods: 1 },
  });
  const poorStats = calculateStats(content, poor);
  const depositedStats = calculateStats(content, deposited);
  const spentStats = calculateStats(content, spentLater);
  near(depositedStats.attack, poorStats.attack);
  near(spentStats.attack - depositedStats.attack, 4);

  const target = enemy();
  const poorDamage = firstDamage(simulateBattle(content, poor, target, 'journey-poor', { roundLimit: 1 }));
  const depositDamage = firstDamage(simulateBattle(content, deposited, target, 'journey-deposit', { roundLimit: 1 }));
  near(depositDamage.amount / poorDamage.amount, 1.6);
  const view = buildMechanicViews(content, deposited);
  assert.match(view.find(item => item.id === 'TEST-WEALTH').summary, /150/);
  assert.match(view.find(item => item.id === 'TEST-SPENDING').summary, /消费 50/);
});

test('hunter historical growth, speed damage, bounty attack, and trophy history are measured once', () => {
  const content = withBuilds([
    { id: 'TEST-HUNTER', tier: 1, kind: 'hunter', params: {
      base_attack: 8, base_defense: 6, elite_attack: 8, elite_defense: 6, boss_attack: 12, boss_defense: 8,
    } },
    { id: 'TEST-BOUNTY', tier: 2, kind: 'bounty', params: {
      attack_bonus: 8, normal_coins: 4, elite_coins: 20, boss_coins: 30,
    } },
    { id: 'TEST-SPEED', tier: 3, kind: 'speed_damage', params: { speed_bonus: 2, max_multiplier: 2.5 } },
    { id: 'TEST-TROPHY', tier: 4, kind: 'trophy_damage', params: {
      base_bonus: 0.12, elite_bonus: 0.1, boss_bonus: 0.15,
    } },
  ]);
  const player = loadout('RKF08', ['TEST-HUNTER', 'TEST-BOUNTY', 'TEST-SPEED', 'TEST-TROPHY'], [], {
    journey: { coins: 0, coinsSpent: 0, eliteWins: 2, bossWins: 1, artifactKinds: 0, knownMethods: 1 },
  });
  const plainEnemy = enemy({ speed: 20 });
  const eliteEnemy = enemy({ tier: 'elite', speed: 20 });
  const bossEnemy = enemy({ tier: 'boss', speed: 20 });
  const normalStats = calculateStats(content, player, plainEnemy);
  const eliteStats = calculateStats(content, player, eliteEnemy);
  const bossStats = calculateStats(content, player, bossEnemy);
  near(normalStats.attack, 144);
  near(normalStats.defense, 26);
  near(eliteStats.attack, normalStats.attack);
  near(eliteStats.defense, normalStats.defense);
  near(bossStats.attack, normalStats.attack);
  near(bossStats.defense, normalStats.defense);
  near(normalStats.speed, 12);
  const noVictoryStats = calculateStats(content, loadout(
    'RKF08',
    ['TEST-HUNTER', 'TEST-BOUNTY', 'TEST-SPEED', 'TEST-TROPHY'],
    [],
    { journey: { coins: 0, coinsSpent: 0, eliteWins: 0, bossWins: 0, artifactKinds: 0, knownMethods: 1 } },
  ));
  near(normalStats.attack - noVictoryStats.attack, 2 * 8 + 12);
  near(normalStats.defense - noVictoryStats.defense, 2 * 6 + 8);

  const normal = firstDamage(simulateBattle(content, player, plainEnemy, 'journey-speed-low', { roundLimit: 1 }));
  const fastTarget = firstDamage(simulateBattle(content, player, enemy({ speed: 4 }), 'journey-speed-high', { roundLimit: 1 }));
  near(normal.amount, normalStats.attack * 0.9 * 1.47);
  near(fastTarget.amount, normalStats.attack * 0.9 * 2.5 * 1.47);
  const hunterView = buildMechanicViews(content, player).find(item => item.id === 'TEST-HUNTER');
  assert.match(hunterView.summary, /精英胜 2 次再增攻击 \+16、防御 \+12/);
  assert.match(hunterView.summary, /首领胜 1 次再增攻击 \+12、防御 \+8/);
  assert.match(buildMechanicViews(content, player).find(item => item.id === 'TEST-TROPHY').summary, /精英胜 2、首领胜 1/);
  assert.match(buildMechanicViews(content, player).find(item => item.id === 'TEST-BOUNTY').summary, /实结 4\/20\/30 灵石/);
});

test('journey attack growth feeds percentage amplification, not a separate unscaled total', () => {
  const player = loadout('RKF08', ['V2-J1-E', 'V2-J4-C'], [], {
    journey: { coins: 0, coinsSpent: 100, eliteWins: 0, bossWins: 0, artifactKinds: 0, knownMethods: 1 },
  });
  const base = calculateStats(baseContent, { ...player, talents: [] }).attack;
  near(calculateStats(baseContent, player).attack, (base + 8 + 100 * 0.08) * 1.35);
  const noAmplifier = { ...player, talents: ['V2-J1-E'] };
  near(calculateStats(baseContent, player).attack, calculateStats(baseContent, noAmplifier).attack * 1.35);
});

test('carapace grows after each effective hostile direct segment and does not reflect DOT', () => {
  const content = withBuilds([
    { id: 'TEST-CARAPACE', tier: 1, kind: 'carapace', params: { defense_per_hit: 6, reflect_ratio: 0.24 } },
  ], rules => { rules.rage.opening = 100; });
  const defender = loadout('RKF08', ['TEST-CARAPACE'], [], {
    attack: 0, defense: 0, max_hp: 100_000, speed: 1,
  });
  defender.preparation = 100_000;
  const attacker = loadout('RKF09', [], [], {
    attack: 100, defense: 0, max_hp: 1_000_000, speed: 20,
  });
  const result = simulateBattle(content, defender, attacker, 'journey-carapace-segments', { roundLimit: 1 });
  const baseHits = result.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'enemy' && frame.source === 'RKF09-RAGE-DAMAGE');
  const reflects = result.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'TEST-CARAPACE-RULE');
  assert.equal(baseHits.length, 3);
  assert.equal(reflects.length, 3);
  near(reflects[0].amount, 14 * 0.24);
  near(reflects[1].amount, 20 * 0.24);
  near(reflects[2].amount, 26 * 0.24);
  assert.equal(result.frames.some(frame => frame.kind === 'dot' && frame.source === 'TEST-CARAPACE-RULE'), false);
  assert.match(buildMechanicViews(content, defender)[0].summary, /防御 \+6/);
});

test('four generic artifact slots run every installed core rule independently', () => {
  const content = openingRage(baseContent);
  const player = loadout('RKF01', [], [
    { id: 'RC09', stacks: 1 },
    { id: 'RC10', stacks: 1 },
    { id: 'RC11', stacks: 1 },
    { id: 'RC12', stacks: 1 },
  ], { attack: 100, defense: 100, max_hp: 100_000, speed: 20 });
  const result = simulateBattle(content, player, enemy({ attack: 20, speed: 1 }), 'journey-four-cores', { roundLimit: 1 });
  assert.ok(result.frames.some(frame => frame.kind === 'shield' && frame.source === 'RC11'));
  assert.ok(result.frames.some(frame => frame.kind === 'damage' && frame.source === 'RC11'));
  assert.ok(result.frames.some(frame => frame.kind === 'damage' && frame.source === 'RKF01-RAGE-DAMAGE'));
  assert.ok(contribution(result, 'RC09').triggers > 0);
  assert.ok(contribution(result, 'RC10').rage > 0);
  assert.ok(contribution(result, 'RC11').shield > 0);
  assert.ok(contribution(result, 'RC12').triggers > 0);

  const dotContent = contentFromEntities(structuredClone(baseContent.entities), baseContent.version);
  const dotResult = simulateBattle(
    openingRage(dotContent, 0),
    loadout('RKF04', [], [
      { id: 'RC14', stacks: 1 },
      { id: 'RC15', stacks: 1 },
    ], { attack: 100, defense: 0, max_hp: 100_000, hp: 10, speed: 20 }),
    enemy({ attack: 0, max_hp: 1_000_000_000 }),
    'journey-core-dots',
    { roundLimit: 8 },
  );
  assert.ok(dotResult.frames.some(frame => frame.kind === 'damage' && frame.source === 'RC14'));
  assert.ok(dotResult.frames.some(frame => frame.kind === 'heal' && frame.source === 'RC15'));

  assert.throws(() => simulateBattle(content, loadout('RKF01', [], [
    { id: 'RC09', stacks: 1 },
    { id: 'RC10', stacks: 1 },
    { id: 'RC11', stacks: 1 },
    { id: 'RC12', stacks: 1 },
    { id: 'RC14', stacks: 1 },
  ]), enemy(), 'journey-five-artifacts', { roundLimit: 1 }), /four artifact slots/);
});

test('basic_split produces real base segments and hit_rage is settled once at round end', () => {
  const content = withBuilds([
    { id: 'TEST-SPLIT', tier: 1, kind: 'basic_split', params: { extra_segments: 2, segment_ratio: 0.6 } },
    { id: 'TEST-HIT-RAGE', tier: 2, kind: 'hit_rage', params: { amount: 3 } },
  ], rules => { rules.rage.opening = 0; });
  const player = loadout('RKF09', ['TEST-SPLIT', 'TEST-HIT-RAGE'], [], {
    attack: 100, defense: 0, max_hp: 100_000, speed: 20,
  });
  const result = simulateBattle(content, player, enemy(), 'journey-split-rage', { roundLimit: 1 });
  const baseHits = result.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF09-BASIC-DAMAGE');
  assert.deepEqual(baseHits.map(frame => frame.amount), [60, 60, 60]);
  assert.equal(result.frames.filter(frame => frame.kind === 'action' && frame.actor === 'player').length, 1);
  assert.equal(contribution(result, 'TEST-HIT-RAGE').rage, 9);
  assert.ok(result.frames.some(frame =>
    frame.kind === 'rage' && frame.source === 'RULES-RAGE-SETTLE' && frame.amount === 44));

  const segmentedEntities = structuredClone(content.entities);
  segmentedEntities.find(entity => entity.id === 'RKF09').actions.basic.effects
    .find(effect => effect.id === 'RKF09-BASIC-DAMAGE').params.segments = 3;
  const multisegmentContent = contentFromEntities(segmentedEntities, content.version);
  const multisegment = simulateBattle(
    multisegmentContent,
    player,
    enemy(),
    'journey-split-multisegment',
    { roundLimit: 1 },
  );
  const multisegmentHits = multisegment.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF09-BASIC-DAMAGE');
  assert.deepEqual(multisegmentHits.map(frame => frame.amount), [60, 60, 60, 60, 60]);
  assert.equal(contribution(multisegment, 'TEST-HIT-RAGE').rage, 15);
});

test('rage_echo replays scaled rage damage and healing without payment, action income, or recursion', () => {
  const content = openingRage(withBuilds([
    { id: 'TEST-ECHO', tier: 1, kind: 'rage_echo', params: { ratio: 0.45 } },
    { id: 'TEST-ECHO-HIT-RAGE', tier: 3, kind: 'hit_rage', params: { amount: 3 } },
  ]));
  const player = loadout('RKF03', ['TEST-ECHO', 'RKF03-J2-C', 'TEST-ECHO-HIT-RAGE'], [], {
    attack: 100, defense: 0, max_hp: 1_000, hp: 500, speed: 20,
  });
  const result = simulateBattle(content, player, enemy(), 'journey-echo-heal', { roundLimit: 1 });
  const damage = result.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' &&
    (frame.source === 'RKF03-RAGE-DAMAGE' || frame.source === 'RKF03-RAGE-DAMAGE-RAGE-ECHO'));
  assert.equal(damage.length, 2);
  near(damage[1].amount / damage[0].amount, 0.45);
  const heals = result.frames.filter(frame =>
    frame.kind === 'heal' && (frame.source === 'RKF03-RAGE-HEAL' || frame.source === 'RKF03-RAGE-HEAL-RAGE-ECHO'));
  assert.equal(heals.length, 2);
  near(heals[1].amount / heals[0].amount, 0.45);
  near(contribution(result, 'TEST-ECHO').damage, damage[1].amount);
  near(contribution(result, 'TEST-ECHO').healing, heals[1].amount);
  near(contribution(result, 'RKF03').damage, damage[0].amount);
  near(contribution(result, 'RKF03').healing, heals[0].amount);
  near(result.playerHp, 572.5);
  assert.equal(result.frames.filter(frame => frame.kind === 'action' && frame.actor === 'player').length, 1);
  assert.equal(result.frames.filter(frame => frame.kind === 'rage' && frame.source === 'RKF03-rage-cost').length, 1);
  assert.equal(result.frames.filter(frame => frame.kind === 'rage' && frame.source === 'RULES-RAGE-SETTLE' && frame.actor === 'player').length, 1);
  assert.equal(contribution(result, 'TEST-ECHO-HIT-RAGE').rage, 6);
  near(contribution(result, 'RKF03-J2-C').rage, 12.5);
  assert.equal(result.frames.find(frame =>
    frame.kind === 'rage' && frame.source === 'RULES-RAGE-SETTLE' && frame.actor === 'player').amount, 28.5);

  const lethal = simulateBattle(
    content,
    loadout('RKF03', ['TEST-ECHO'], [], { attack: 10_000, max_hp: 1_000, speed: 20 }),
    enemy({ max_hp: 1 }),
    'journey-echo-lethal-stop',
    { roundLimit: 1 },
  );
  assert.equal(lethal.frames.some(frame => frame.source?.endsWith('-RAGE-ECHO')), false);
});

test('rage_echo scales method status and shield outputs for different methods', () => {
  const content = openingRage(withBuilds([
    { id: 'TEST-ECHO', tier: 1, kind: 'rage_echo', params: { ratio: 0.45 } },
  ]));
  const poisonBattle = simulateBattle(
    content,
    loadout('RKF06', ['TEST-ECHO'], [], { attack: 100, defense: 0, max_hp: 100_000, speed: 20 }),
    enemy(),
    'journey-echo-poison',
    { roundLimit: 1 },
  );
  const poisonApply = poisonBattle.frames.filter(frame =>
    frame.kind === 'status' && frame.target === 'enemy' &&
    (frame.source === 'RKF06-RAGE-POISON' || frame.source === 'RKF06-RAGE-POISON-RAGE-ECHO'));
  assert.deepEqual(poisonApply.map(frame => frame.amount), [2, 1]);
  const echoPoisonTick = poisonBattle.frames.find(frame =>
    frame.kind === 'dot' && frame.actor === 'player' && frame.source === 'RKF06-RAGE-POISON-RAGE-ECHO');
  assert.ok(echoPoisonTick);
  const ordinaryPoisonTick = poisonBattle.frames.find(frame =>
    frame.kind === 'dot' && frame.actor === 'player' && frame.source === 'RKF06-RAGE-POISON');
  near(echoPoisonTick.amount, ordinaryPoisonTick.amount * 0.45);
  const echoDamage = poisonBattle.frames.filter(frame =>
    ['damage', 'dot'].includes(frame.kind) && frame.actor === 'player' &&
    frame.source?.endsWith('-RAGE-ECHO')).reduce((sum, frame) => sum + frame.amount, 0);
  near(contribution(poisonBattle, 'TEST-ECHO').damage, echoDamage);

  const shieldBattle = simulateBattle(
    content,
    loadout('RKF01', ['TEST-ECHO'], [], { attack: 0, defense: 100, max_hp: 100_000, speed: 20 }),
    enemy(),
    'journey-echo-shield',
    { roundLimit: 1 },
  );
  const shields = shieldBattle.frames.filter(frame =>
    frame.kind === 'shield' && frame.actor === 'player' &&
    (frame.source === 'RKF01-RAGE-SHIELD' || frame.source === 'RKF01-RAGE-SHIELD-RAGE-ECHO'));
  assert.equal(shields.length, 2);
  near(shields[1].amount / shields[0].amount, 0.45);
  near(contribution(shieldBattle, 'TEST-ECHO').shield, shields[1].amount);
});

test('rage_echo never reuses consumed shield, sword intent, or burn resources', () => {
  const content = openingRage(withBuilds([
    { id: 'TEST-ECHO', tier: 1, kind: 'rage_echo', params: { ratio: 0.45 } },
  ]));
  const coreShield = simulateBattle(
    content,
    loadout('RKF01', ['TEST-ECHO'], [{ id: 'RC11', stacks: 1 }], {
      attack: 100, defense: 0, max_hp: 1_000, speed: 20,
    }),
    enemy(),
    'journey-echo-core-shield-cost',
    { roundLimit: 1 },
  );
  assert.equal(coreShield.frames.filter(frame => frame.kind === 'damage' && frame.source === 'RC11').length, 1);
  assert.equal(coreShield.frames.some(frame => frame.source === 'RC11-RAGE-ECHO'), false);

  const shieldPlayer = loadout('RKF01', ['TEST-ECHO', 'RKF01-J4-B'], [], {
    attack: 100, defense: 0, max_hp: 1_000, speed: 20,
  });
  shieldPlayer.preparation = 200;
  const shieldConvert = simulateBattle(
    content,
    shieldPlayer,
    enemy(),
    'journey-echo-method-shield-cost',
    { roundLimit: 1 },
  );
  const shieldMain = firstDamage(shieldConvert, 'RKF01-RAGE-DAMAGE');
  const shieldEcho = firstDamage(shieldConvert, 'RKF01-RAGE-DAMAGE-RAGE-ECHO');
  const consumedShield = 200 * content.byId.RKF01.talents
    .find(talent => talent.id === 'RKF01-J4-B')
    .effects[0].params.shield_consume_ratio;
  const consumedShieldDamage = consumedShield * content.byId.RKF01.talents
    .find(talent => talent.id === 'RKF01-J4-B')
    .effects[0].params.extra_damage_per_shield_ratio;
  near(shieldMain.amount, calculateStats(content, shieldPlayer).attack *
    content.byId.RKF01.actions.rage.effects.find(effect => effect.id === 'RKF01-RAGE-DAMAGE').params.attack_ratio +
    consumedShieldDamage);
  near(
    shieldEcho.amount,
    calculateStats(content, shieldPlayer).attack *
      content.byId.RKF01.actions.rage.effects.find(effect => effect.id === 'RKF01-RAGE-DAMAGE').params.attack_ratio *
      0.45,
  );

  const noOpening = openingRage(withBuilds([
    { id: 'TEST-ECHO', tier: 1, kind: 'rage_echo', params: { ratio: 0.45 } },
  ]), 0);
  const swordPlayer = loadout('RKF05', ['TEST-ECHO', 'RKF05-J2-B'], [], {
    attack: 100, defense: 0, max_hp: 1_000, speed: 20,
  });
  const swordBattle = simulateBattle(
    noOpening,
    swordPlayer,
    enemy(),
    'journey-echo-sword-cost',
    { roundLimit: 5 },
  );
  assert.equal(swordBattle.frames.filter(frame =>
    frame.kind === 'damage' && frame.source === 'RKF05-J2-B-CONSUME').length, 1);
  assert.equal(swordBattle.frames.some(frame => frame.source === 'RKF05-J2-B-CONSUME-RAGE-ECHO'), false);
  assert.equal(swordBattle.frames.filter(frame =>
    frame.kind === 'rage' && frame.source === 'RKF05-rage-cost').length, 1);

  const burnPlayer = loadout('RKF09', ['TEST-ECHO', 'RKF09-J4-B'], [], {
    attack: 100, defense: 0, max_hp: 1_000, speed: 20,
  });
  const burnBattle = simulateBattle(
    noOpening,
    burnPlayer,
    enemy(),
    'journey-echo-burn-cost',
    { roundLimit: 5 },
  );
  assert.equal(burnBattle.frames.filter(frame =>
    frame.kind === 'damage' && frame.source === 'RKF09-J4-B-DAMAGE').length, 1);
  assert.equal(burnBattle.frames.some(frame => frame.source === 'RKF09-J4-B-DAMAGE-RAGE-ECHO'), false);
});

test('opening shields use frozen wealth and victory counts; missing facts mean zero and invalid facts fail', () => {
  const content = withBuilds([
    { id: 'TEST-VETERAN', tier: 1, kind: 'veteran_shield', params: {
      base_ratio: 0.06, elite_ratio: 0.02, boss_ratio: 0.03,
    } },
    { id: 'TEST-WEALTH-SHIELD', tier: 2, kind: 'wealth_shield', params: {
      base_shield: 30, shield_per_coin: 0.4,
    } },
  ]);
  const player = loadout('RKF08', ['TEST-VETERAN', 'TEST-WEALTH-SHIELD'], [], {
    attack: 0, defense: 0, max_hp: 1_000,
    journey: { coins: 100, coinsSpent: 70, eliteWins: 2, bossWins: 1, artifactKinds: 3, knownMethods: 2 },
  });
  const result = simulateBattle(content, player, enemy({ attack: 0 }), 'journey-opening-shields', { roundLimit: 1 });
  const expectedVeteranShield = calculateStats(content, player).max_hp * 0.13;
  const buildShields = result.frames.filter(frame =>
    frame.kind === 'shield' && frame.actor === 'player' &&
    (frame.source === 'TEST-VETERAN-RULE' || frame.source === 'TEST-WEALTH-SHIELD-RULE'));
  assert.deepEqual(buildShields.map(frame => frame.amount), [expectedVeteranShield, 70]);
  const views = buildMechanicViews(content, player);
  assert.match(views[0].summary, new RegExp(`战绩提供基础开场护盾 ${expectedVeteranShield}`));
  assert.match(views[1].summary, /现有灵石 100，基础开场护盾 70/);

  const noFacts = loadout('RKF08', ['TEST-WEALTH-SHIELD'], []);
  const noFactsBattle = simulateBattle(content, noFacts, enemy({ attack: 0 }), 'journey-no-facts', { roundLimit: 1 });
  assert.equal(noFactsBattle.frames.find(frame => frame.source === 'TEST-WEALTH-SHIELD-RULE').amount, 30);
  const invalid = loadout('RKF08', ['TEST-WEALTH-SHIELD'], [], {
    journey: { coins: Number.NaN, coinsSpent: 0, eliteWins: 0, bossWins: 0, artifactKinds: 0, knownMethods: 0 },
  });
  assert.throws(() => calculateStats(content, invalid), /journey context coins/);
});

test('build damage safely handles zero target speed and collection uses frozen distinct-kind count', () => {
  const content = withBuilds([
    { id: 'TEST-SPEED', tier: 1, kind: 'speed_damage', params: { speed_bonus: 2, max_multiplier: 2.5 } },
    { id: 'TEST-COLLECTION', tier: 2, kind: 'collection_damage', params: { base_bonus: 0.1, per_kind: 0.04 } },
  ]);
  const player = loadout('RKF08', ['TEST-SPEED', 'TEST-COLLECTION'], [], {
    attack: 100, defense: 0, max_hp: 10_000, speed: 10,
    journey: { coins: 0, coinsSpent: 0, eliteWins: 0, bossWins: 0, artifactKinds: 3, knownMethods: 1 },
  });
  const zeroSpeed = firstDamage(simulateBattle(content, player, enemy({ speed: 0 }), 'journey-zero-speed', { roundLimit: 1 }));
  near(zeroSpeed.amount, 100 * 0.9 * 2.5 * 1.22);
  const noJourney = loadout('RKF08', ['TEST-COLLECTION'], [], { attack: 100, speed: 10 });
  const noKinds = firstDamage(simulateBattle(content, noJourney, enemy(), 'journey-no-kinds', { roundLimit: 1 }));
  near(noKinds.amount, 99);
});
