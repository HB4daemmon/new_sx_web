import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

function buildModule(name) {
  if (process.env.SHANHAI_BUILD_DIR) {
    return pathToFileURL(resolve(process.env.SHANHAI_BUILD_DIR, 'shanhai', name)).href;
  }
  return new URL(`../build/shanhai/${name}`, import.meta.url).href;
}

const [{ calculateStats, simulateBattle }, { contentFromEntities }] = await Promise.all([
  import(buildModule('combat.js')),
  import(buildModule('content.js')),
]);
const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 10_000,
  crit_rate: 0,
  speed: 10,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const { hp, preparation, ...baseStatOverrides } = overrides;
  return {
    name: method,
    method,
    n: 4,
    talents: [],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...baseStatOverrides },
    ...(hp === undefined ? {} : { hp }),
    ...(preparation === undefined ? {} : { preparation }),
  };
}

function framesFrom(result, predicate) {
  return result.frames.filter(predicate);
}

function contribution(result, id) {
  const item = result.contributions.find(entry => entry.id === id);
  assert.ok(item, `expected contribution ${id}`);
  return item;
}

function syntheticRoundDrainContent() {
  const makeArtifact = id => {
    const artifact = structuredClone(content.byId.RR14);
    artifact.id = id;
    artifact.name = id;
    artifact.attributes = { flat: {}, percent: {} };
    artifact.effects = [{
      id: `${id}-ACTION-END-DRAIN`,
      trigger: 'action_end',
      operation: 'rage_drain',
      target: 'enemy',
      params: { amount: 30 },
      requires: [],
      consumes: [],
      replaces: [],
      limit: { scope: 'action', count: 1 },
      text: 'Synthetic drain test source.',
    }];
    return artifact;
  };
  return contentFromEntities([
    ...structuredClone(content.entities),
    makeArtifact('TEST-AWAKENING-DRAIN-A'),
    makeArtifact('TEST-AWAKENING-DRAIN-B'),
  ], `${content.version}-awakening-drain`);
}

function withoutCoreRules(...ids) {
  const entities = structuredClone(content.entities);
  for (const id of ids) delete entities.find(item => item.id === id).core_rule;
  return contentFromEntities(entities, content.version);
}

function withRkf04ThreeHitBasic(...coreRuleIds) {
  const entities = structuredClone(content.entities);
  for (const id of coreRuleIds) delete entities.find(item => item.id === id).core_rule;
  const hitThreshold = content.byId.RR03.effects
    .find(effect => effect.id === 'RR03-V2-RESONANCE').params.hit_threshold;
  entities.find(item => item.id === 'RKF04').actions.basic.effects
    .find(effect => effect.id === 'RKF04-BASIC-DAMAGE').params.segments = hitThreshold;
  return contentFromEntities(entities, content.version);
}

test('RC09 awakens only at cap, applies once per round, and works on either side', () => {
  const authoredContent = withoutCoreRules('RC09');
  const battle = stacks => simulateBattle(
    authoredContent,
    makeLoadout('RKF01', [{ id: 'RC09', stacks }], { max_hp: 100_000, speed: 11 }),
    makeLoadout('RKF01', [{ id: 'RC09', stacks }], { max_hp: 100_000, speed: 10 }),
    `awakening-rc09-${stacks}`,
    { roundLimit: 2 },
  );

  const belowCap = battle(2);
  assert.equal(framesFrom(belowCap, frame => frame.source === 'RC09-AWAKENING-ARMOR-BREAK').length, 0);

  const atCap = battle(3);
  const applications = framesFrom(atCap, frame =>
    frame.kind === 'status' && frame.source === 'RC09-AWAKENING-ARMOR-BREAK');
  assert.deepEqual(applications.map(frame => frame.round), [1, 1, 2, 2]);
  assert.deepEqual(new Set(applications.map(frame => frame.target)), new Set(['player', 'enemy']));
  assert.equal(contribution(atCap, 'RC09').triggers, 8);
});

test('RC11 grants one attributable shield after a real direct break per battle', () => {
  const authoredContent = withoutCoreRules('RC11');
  const battle = stacks => simulateBattle(
    authoredContent,
    makeLoadout('RKF01', [{ id: 'RC11', stacks }], {
      max_hp: 100_000,
      attack: 0,
      speed: 5,
      hp: 100_000,
      preparation: 50,
    }),
    makeLoadout('RKF01', [], {
      max_hp: 1_000_000,
      attack: 20_000,
      defense: 0,
      speed: 10,
    }),
    `awakening-rc11-${stacks}`,
    { roundLimit: 3 },
  );

  const belowCap = battle(2);
  assert.equal(framesFrom(belowCap, frame => frame.source === 'RC11-AWAKENING-SHIELD').length, 0);

  const atCap = battle(3);
  const shields = framesFrom(atCap, frame =>
    frame.kind === 'shield' && frame.source === 'RC11-AWAKENING-SHIELD');
  assert.equal(shields.length, 1);
  assert.equal(shields[0].actor, 'player');
  assert.equal(shields[0].amount, 100_000 * 0.06 * 1.18);
  assert.equal(contribution(atCap, 'RC11').shield, shields[0].amount);
});

test('RC12 cleanse is once per battle and coexists with a second formerly core artifact', () => {
  const authoredContent = withoutCoreRules('RC12');
  const battle = stacks => {
    const player = makeLoadout('RKF03', [
      { id: 'RC12', stacks },
    ], {
      attack: 0,
      max_hp: 1_000,
      speed: 10,
    });
    player.hp = calculateStats(content, player).max_hp - 10;
    return simulateBattle(
      authoredContent,
      player,
      makeLoadout('RKF06', [], {
        attack: 1,
        defense: 0,
        max_hp: 1_000_000,
        speed: 11,
      }),
      `awakening-rc12-${stacks}`,
      { roundLimit: 3 },
    );
  };

  const belowCap = battle(2);
  assert.equal(framesFrom(belowCap, frame => frame.source === 'RC12-AWAKENING-CLEANSE').length, 0);

  const atCap = battle(3);
  const cleanses = framesFrom(atCap, frame =>
    frame.kind === 'status' && frame.source === 'RC12-AWAKENING-CLEANSE');
  assert.equal(cleanses.length, 1);
  assert.ok(framesFrom(atCap, frame => frame.kind === 'heal').length > 0);

  const combinedPlayer = makeLoadout('RKF03', [
    { id: 'RC12', stacks: 1 },
    { id: 'RL01', stacks: 1 },
  ], { attack: 0, max_hp: 1_000, speed: 20 });
  combinedPlayer.hp = calculateStats(content, combinedPlayer).max_hp - 10;
  const combined = simulateBattle(
    content,
    combinedPlayer,
    makeLoadout('RKF01', [], { attack: 0, max_hp: 100_000, speed: 1 }),
    'awakening-rc12-and-rl01-generic-slots',
    { roundLimit: 1 },
  );
  assert.ok(framesFrom(combined, frame => frame.kind === 'shield' && frame.source === 'RC12').length > 0);
  assert.ok(framesFrom(combined, frame =>
    frame.kind === 'shield' && frame.source === 'RL01-HEAL-OVERFLOW-TO-SHIELD').length > 0);
});

test('RC14 and RC15 amplify only newly applied DOT layers under their condition', () => {
  const makeDotBattle = (artifactId, stacks) => simulateBattle(
    withRkf04ThreeHitBasic(artifactId),
    makeLoadout('RKF04', [
      { id: 'RR03', stacks: 1 },
      { id: artifactId, stacks },
    ], { max_hp: 1_000_000, attack: 100, speed: 11 }),
    makeLoadout('RKF01', [], {
      max_hp: 1_000_000_000,
      attack: 0,
      defense: 0,
      speed: 1,
    }),
    `awakening-${artifactId}-${stacks}`,
    { roundLimit: 2 },
  );

  const rc15BelowCap = makeDotBattle('RC15', 2);
  const rc15AtCap = makeDotBattle('RC15', 3);
  const rc15AtCapStats = calculateStats(content, makeLoadout('RKF04', [
    { id: 'RR03', stacks: 1 },
    { id: 'RC15', stacks: 3 },
  ], { max_hp: 1_000_000, attack: 100, speed: 11 }));
  const burnEffect = content.byId.RKF04.actions.basic.effects
    .find(effect => effect.id === 'RKF04-BASIC-BURN');
  const burnPassive = content.byId.RKF04.passives
    .find(effect => effect.id === 'RKF04-PASSIVE-BURN');
  const rc15Multiplier = content.byId.RC15.effects
    .find(effect => effect.id === 'RC15-SELF-BURN-BONUS').params.ratio;
  const rc15Awakening = content.byId.RC15.effects
    .find(effect => effect.id === 'RC15-AWAKENING-BURN-ON-POISON')
    .params.attack_ratio_per_stack_add;
  const rc15Stacks = 3;
  const firstBurn = framesFrom(rc15AtCap, frame =>
    frame.round === 1 && frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source === 'RKF04-BASIC-BURN');
  assert.equal(firstBurn.length, 1);
  assert.equal(firstBurn[0].amount, rc15AtCapStats.attack * (
    (burnEffect.params.attack_ratio_per_stack + burnPassive.params.attack_ratio_per_stack_add) *
      (1 + rc15Stacks * rc15Multiplier) +
    rc15Awakening
  ));
  assert.ok(contribution(rc15BelowCap, 'RC15').triggers > 0);
  assert.ok(contribution(rc15AtCap, 'RC15').triggers > contribution(rc15BelowCap, 'RC15').triggers);
  assert.equal(contribution(rc15AtCap, 'RC15').damage, 0);

  const rc14BelowCap = makeDotBattle('RC14', 2);
  const rc14AtCap = makeDotBattle('RC14', 3);
  const rc14AtCapStats = calculateStats(content, makeLoadout('RKF04', [
    { id: 'RR03', stacks: 1 },
    { id: 'RC14', stacks: 3 },
  ], { max_hp: 1_000_000, attack: 100, speed: 11 }));
  const poisonEffect = content.byId.RR03.effects
    .find(effect => effect.id === 'RR03-V2-RESONANCE');
  const rc14Multiplier = content.byId.RC14.effects
    .find(effect => effect.id === 'RC14-SELF-POISON-BONUS').params.ratio;
  const rc14Awakening = content.byId.RC14.effects
    .find(effect => effect.id === 'RC14-AWAKENING-POISON-ON-BURN')
    .params.attack_ratio_per_stack_add;
  const rc14Stacks = 3;
  const poisonTicks = framesFrom(rc14AtCap, frame =>
    frame.round === 2 && frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source === 'RR03-V2-RESONANCE').map(frame => frame.amount);
  assert.equal(poisonTicks.length, poisonEffect.params.poison_stacks * 2);
  const awakenedPoisonDamage = rc14AtCapStats.attack *
    (poisonEffect.params.attack_ratio * (1 + rc14Stacks * rc14Multiplier) + rc14Awakening);
  assert.ok(poisonTicks.some(amount => Math.abs(amount - awakenedPoisonDamage) < 1e-9));
  assert.ok(contribution(rc14BelowCap, 'RC14').triggers > 0);
  assert.ok(contribution(rc14AtCap, 'RC14').triggers > contribution(rc14BelowCap, 'RC14').triggers);
  assert.equal(contribution(rc14AtCap, 'RC14').damage, 0);
});

test('an enemy carrying fully awakened RC15 applies the same conditional DOT bonus', () => {
  const authoredContent = withRkf04ThreeHitBasic('RC15');
  const enemy = makeLoadout('RKF04', [
    { id: 'RR03', stacks: 1 },
    { id: 'RC15', stacks: 3 },
  ], { max_hp: 1_000_000, attack: 100, speed: 11 });
  const player = makeLoadout('RKF01', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
  });
  const result = simulateBattle(authoredContent, player, enemy, 'awakening-rc15-enemy', { roundLimit: 1 });
  const enemyBurn = framesFrom(result, frame =>
    frame.round === 1 && frame.kind === 'dot' && frame.actor === 'enemy' &&
    frame.source === 'RKF04-BASIC-BURN');
  const enemyAttack = calculateStats(content, enemy).attack;
  const burnEffect = content.byId.RKF04.actions.basic.effects
    .find(effect => effect.id === 'RKF04-BASIC-BURN');
  const burnPassive = content.byId.RKF04.passives
    .find(effect => effect.id === 'RKF04-PASSIVE-BURN');
  const rc15Multiplier = content.byId.RC15.effects
    .find(effect => effect.id === 'RC15-SELF-BURN-BONUS').params.ratio;
  const rc15Awakening = content.byId.RC15.effects
    .find(effect => effect.id === 'RC15-AWAKENING-BURN-ON-POISON')
    .params.attack_ratio_per_stack_add;
  const rc15Stacks = 3;
  assert.equal(enemyBurn.length, 1);
  assert.equal(enemyBurn[0].amount, enemyAttack * (
    (burnEffect.params.attack_ratio_per_stack + burnPassive.params.attack_ratio_per_stack_add) *
      (1 + rc15Stacks * rc15Multiplier) +
    rc15Awakening
  ));
});

test('legal awakened loadout preserves rage cadence and four formerly core artifacts operate together', () => {
  const authoredContent = withoutCoreRules('RC09', 'RC11', 'RC12', 'RC14', 'RC15');
  const enemy = makeLoadout('RKF01', [], { max_hp: 1_000_000_000, attack: 0, speed: 9 });
  const plain = simulateBattle(
    authoredContent,
    makeLoadout('RKF01', [], { max_hp: 100_000, attack: 0, speed: 10 }),
    enemy,
    'awakening-rage-contract',
    { roundLimit: 3 },
  );
  const zeroOpeningEntities = structuredClone(content.entities);
  zeroOpeningEntities.find(entity => entity.id === 'RULES').rage.opening = 0;
  const zeroOpeningContent = contentFromEntities(zeroOpeningEntities, content.version);
  const fourCoreLoadout = makeLoadout('RKF06', [
    { id: 'RC09', stacks: 3 },
    { id: 'RC11', stacks: 3 },
    { id: 'RC12', stacks: 3 },
    { id: 'RC14', stacks: 3 },
  ], { max_hp: 100_000, attack: 0, speed: 10 });
  const multiCoreResult = simulateBattle(
    zeroOpeningContent,
    fourCoreLoadout,
    enemy,
    'awakening-four-core-rules',
    { roundLimit: 5 },
  );
  assert.ok(contribution(multiCoreResult, 'RC09').triggers > 0);
  assert.ok(contribution(multiCoreResult, 'RC11').shield > 0);
  assert.ok(contribution(multiCoreResult, 'RC12').triggers > 0);
  assert.ok(contribution(multiCoreResult, 'RC14').damage > 0);
  assert.throws(() => simulateBattle(
    content,
    makeLoadout('RKF01', [
      { id: 'RC09', stacks: 1 },
      { id: 'RC11', stacks: 1 },
      { id: 'RC12', stacks: 1 },
      { id: 'RC14', stacks: 1 },
      { id: 'RC15', stacks: 1 },
      { id: 'RC10', stacks: 1 },
    ]),
    enemy,
    'awakening-over-five-artifacts',
    { roundLimit: 3 },
  ), /Loadout exceeds 5 artifact slots/);
  const awakened = simulateBattle(
    authoredContent,
    makeLoadout('RKF01', [
      { id: 'RC09', stacks: 3 },
      { id: 'RC01', stacks: 1 },
      { id: 'RC02', stacks: 1 },
      { id: 'RC03', stacks: 1 },
    ], { max_hp: 100_000, attack: 0, speed: 10 }),
    enemy,
    'awakening-rage-contract',
    { roundLimit: 3 },
  );
  const actions = result => result.frames
    .filter(frame => frame.kind === 'action' && frame.actor === 'player')
    .map(({ round, actor, source }) => ({ round, actor, source }));
  const rageSettlements = result => result.frames
    .filter(frame => frame.source === 'RULES-RAGE-SETTLE' && frame.actor === 'player')
    .map(({ round, actor, amount }) => ({ round, actor, amount }));
  assert.deepEqual(actions(awakened), actions(plain));
  assert.deepEqual(rageSettlements(awakened), rageSettlements(plain));
});

test('the 20-per-round rage drain cap holds with one fully awakened core and legal supports', () => {
  const drainContent = syntheticRoundDrainContent();
  const result = simulateBattle(
    drainContent,
    makeLoadout('RKF01', [
      { id: 'RC15', stacks: 3 },
      { id: 'RR03', stacks: 1 },
      { id: 'TEST-AWAKENING-DRAIN-A', stacks: 1 },
      { id: 'TEST-AWAKENING-DRAIN-B', stacks: 1 },
    ], { attack: 0, max_hp: 100_000, speed: 10 }),
    makeLoadout('RKF01', [], { attack: 0, max_hp: 1_000_000_000, speed: 9 }),
    'awakening-drain-cap',
    { roundLimit: 2 },
  );
  assert.deepEqual(
    framesFrom(result, frame => frame.source === 'RULES-RAGE-DRAIN').map(frame => frame.amount),
    [20, 20],
  );
});
