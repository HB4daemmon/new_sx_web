import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import {
  artifactDevourRule,
  artifactDevouredCount,
  devouredDamageMultiplier,
} from '../build/shanhai/artifact-growth.js';
import {
  loadWinningBuilds,
  parseRunSave,
  saveWinningBuild,
  serializeRun,
} from '../build/shanhai/persistence.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);
registerCombatWorker({ calculateStats, simulateBattle });

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 200,
});

function makeGame(seed = 'v2-artifact-growth') {
  return ShanhaiGame.create(content, { seed, name: '饕餮行者', method: 'RKF01' });
}

function loadout(method = 'RKF01', overrides = {}) {
  const {
    name = method,
    artifacts = [],
    talents = [],
    n = 4,
    hp,
    preparation = 0,
    permanentRule,
    baseStats = {},
  } = overrides;
  const stats = { ...BASE_STATS, ...baseStats };
  return {
    name,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: stats,
    hp: hp ?? stats.max_hp,
    preparation,
    ...(permanentRule ? { permanentRule: structuredClone(permanentRule) } : {}),
  };
}

function dummy(overrides = {}) {
  return loadout('RKF06', {
    name: '木人',
    baseStats: { attack: 0, defense: 0, max_hp: 1_000_000_000, crit_rate: 0, speed: 1, ...overrides },
  });
}

function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
}

function damageFrames(result, source) {
  return result.frames.filter(frame => frame.kind === 'damage' && frame.actor === 'player' && frame.source === source);
}

function playerDamageTotal(result) {
  return result.frames
    .filter(frame => (frame.kind === 'damage' || frame.kind === 'dot') && frame.actor === 'player')
    .reduce((sum, frame) => sum + (frame.amount ?? 0), 0);
}

function contribution(result, id) {
  const entry = result.contributions.find(item => item.id === id);
  assert.ok(entry, `expected contribution ${id}`);
  return entry;
}

function assertDamageContributionsMatchFrames(result, message) {
  const total = result.contributions.reduce((sum, entry) => sum + entry.damage, 0);
  assert.ok(Math.abs(total - playerDamageTotal(result)) <= 1e-7,
    `${message}: contributions ${total}, damage frames ${playerDamageTotal(result)}`);
}

test('RL09 enters the legendary artifact pool and its growth multiplier is capped', () => {
  const legendaryPool = content.entities.filter(artifact => artifact.kind === 'artifact' &&
    artifact.rarity === 'legendary' && artifact.acquisition?.pools?.includes('legendary_artifact'));
  assert.ok(legendaryPool.some(artifact => artifact.id === 'RL09'));

  const rule = artifactDevourRule(content);
  assert.equal(artifactDevouredCount({ id: 'RL09', stacks: 1 }), 0);
  close(devouredDamageMultiplier(rule, 1), 1.1);
  close(devouredDamageMultiplier(rule, 100_000), rule.maximum_multiplier, 1e-3);
  assert.throws(() => devouredDamageMultiplier(rule, -1), /Invalid artifact devour growth input/);
  assert.throws(() => artifactDevouredCount({ id: 'RC05', stacks: 1, devoured: 1 }), /Invalid artifact stack devoured counter/);
});

test('devouring removes a target stack and its inscription, unequips it, and clamps HP without healing', () => {
  const game = makeGame('v2-artifact-growth-consume');
  game.state.artifacts = [
    { id: 'RL09', stacks: 1 },
    { id: 'RC05', stacks: 3, inscription: 'leech' },
  ];
  game.state.equipment.slots = ['RL09', 'RC05'];
  const beforeMaxHp = game.stats.max_hp;
  game.state.hp = beforeMaxHp;
  game.state.nodeEntry = {
    method: game.state.method,
    talents: [],
    artifacts: game.equippedArtifacts(),
  };
  game.state._nodeEntry = structuredClone(game.state.nodeEntry);
  const historyBefore = structuredClone(game.state.history);
  const fusionBefore = structuredClone(game.state.fusionProgress);
  assert.equal(game.devourAvailability('RC05').available, true);

  game.dispatch({ type: 'devour', id: 'RC05' });

  assert.deepEqual(game.state.artifacts, [{ id: 'RL09', stacks: 1, devoured: 1 }]);
  assert.deepEqual(game.state.equipment.slots, ['RL09']);
  assert.equal(artifactDevouredCount(game.state.artifacts[0]), 1,
    'the whole three-layer stack adds one growth count');
  assert.equal(game.stats.max_hp, beforeMaxHp - 75);
  assert.equal(game.state.hp, game.stats.max_hp, 'HP is clamped to the lower cap without recovery');
  assert.deepEqual(game.state.nodeEntry.artifacts, [
    { id: 'RL09', stacks: 1 },
    { id: 'RC05', stacks: 3, inscription: 'leech' },
  ], 'the earlier node snapshot keeps the old equipment and inscription');
  assert.deepEqual(game.state._nodeEntry, game.state.nodeEntry);
  assert.deepEqual(game.state.history, historyBefore);
  assert.deepEqual(game.state.fusionProgress, fusionBefore);

  const oneHpGame = makeGame('v2-artifact-growth-one-hp');
  oneHpGame.state.artifacts = [
    { id: 'RL09', stacks: 1 },
    { id: 'RC05', stacks: 1 },
  ];
  oneHpGame.state.equipment.slots = ['RL09', 'RC05'];
  oneHpGame.state.hp = 1;
  oneHpGame.dispatch({ type: 'devour', id: 'RC05' });
  assert.equal(oneHpGame.state.hp, 1, 'consumption at one HP does not heal or kill the player');
});

test('devour rejects self, missing, malformed, growth-capped, and unsafe-phase targets atomically', () => {
  const game = makeGame('v2-artifact-growth-invalid');
  game.state.artifacts = [{ id: 'RL09', stacks: 1 }, { id: 'RC05', stacks: 1 }];
  game.state.equipment.slots = ['RL09'];
  for (const [target, error] of [
    ['RL09', /cannot-devour-self/],
    ['RR01', /target-not-owned/],
  ]) {
    const before = structuredClone(game.state);
    assert.equal(game.devourAvailability(target).available, false);
    assert.throws(() => game.dispatch({ type: 'devour', id: target }), error);
    assert.deepEqual(game.state, before);
  }

  game.state.artifacts[1].devoured = 1;
  const malformed = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'devour', id: 'RC05' }), /Invalid devour target devoured counter/);
  assert.deepEqual(game.state, malformed);
  delete game.state.artifacts[1].devoured;

  game.state.artifacts[0].devoured = 100_000;
  assert.equal(game.devourAvailability('RC05').reason, 'growth-limit-reached');
  const capped = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'devour', id: 'RC05' }), /growth-limit-reached/);
  assert.deepEqual(game.state, capped);

  game.state.artifacts[0].devoured = 0;
  game.state.phase = 'battle';
  const locked = structuredClone(game.state);
  assert.equal(game.devourAvailability('RC05').reason, 'equipment-locked');
  assert.throws(() => game.dispatch({ type: 'devour', id: 'RC05' }), /equipment-locked/);
  assert.deepEqual(game.state, locked);
});

test('equipped growth multiplies direct hits, DOT ticks, and player shield-reflection damage', () => {
  const plain = simulateBattle(content,
    loadout('RKF01'), dummy(), 'v2-devour-direct', { roundLimit: 1 });
  const grown = simulateBattle(content,
    loadout('RKF01', { artifacts: [{ id: 'RL09', stacks: 1, devoured: 1 }] }),
    dummy(), 'v2-devour-direct', { roundLimit: 1 });
  const plainHit = damageFrames(plain, 'RKF01-BASIC-DAMAGE')[0];
  const grownHit = damageFrames(grown, 'RKF01-BASIC-DAMAGE')[0];
  assert.ok(plainHit && grownHit);
  close(grownHit.amount / plainHit.amount, 1.1);

  const firePlain = simulateBattle(content, loadout('RKF04'), dummy(), 'v2-devour-dot', { roundLimit: 3 });
  const fireGrown = simulateBattle(content,
    loadout('RKF04', { artifacts: [{ id: 'RL09', stacks: 1, devoured: 1 }] }),
    dummy(), 'v2-devour-dot', { roundLimit: 3 });
  const plainTicks = firePlain.frames.filter(frame => frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source === 'RKF04-BASIC-BURN');
  const grownTicks = fireGrown.frames.filter(frame => frame.kind === 'dot' && frame.actor === 'player' &&
    frame.source === 'RKF04-BASIC-BURN');
  assert.ok(plainTicks.length > 0 && grownTicks.length > 0);
  assert.deepEqual(grownTicks.map(frame => frame.amount), plainTicks.map(frame => frame.amount * 1.1));

  const reflector = artifacts => loadout('RKF01', {
    artifacts,
    preparation: 1_000,
    baseStats: { defense: 50, speed: 10 },
  });
  const attackingDummy = dummy({ attack: 100, speed: 100 });
  const reflectPlain = simulateBattle(content,
    reflector([{ id: 'RC13', stacks: 1 }]), attackingDummy, 'v2-devour-reflect', { roundLimit: 1 });
  const reflectGrown = simulateBattle(content,
    reflector([{ id: 'RL09', stacks: 1, devoured: 1 }, { id: 'RC13', stacks: 1 }]),
    attackingDummy, 'v2-devour-reflect', { roundLimit: 1 });
  const plainReflect = damageFrames(reflectPlain, 'RC13-V2-RESONANCE')[0];
  const grownReflect = damageFrames(reflectGrown, 'RC13-V2-RESONANCE')[0];
  assert.ok(plainReflect && grownReflect);
  close(grownReflect.amount / plainReflect.amount, 1.1);
});

test('damage contributions partition cauldron growth, blind true damage, shields, and lethal caps', () => {
  const plain = simulateBattle(content, loadout('RKF01'), dummy(),
    'v2-devour-attribution', { roundLimit: 1 });
  assertDamageContributionsMatchFrames(plain, 'ordinary attack sources add up to their damage frames');

  const blindBuild = devoured => loadout('RKF01', {
    artifacts: [{ id: 'RL09', stacks: 1, devoured }],
    baseStats: { crit_rate: 0.2 },
    permanentRule: { kind: 'blind_sword' },
  });
  const baseline = simulateBattle(content, blindBuild(0), dummy(),
    'v2-devour-attribution-blind', { roundLimit: 1 });
  const grown = simulateBattle(content, blindBuild(1), dummy(),
    'v2-devour-attribution-blind', { roundLimit: 1 });
  assertDamageContributionsMatchFrames(baseline, 'blind sword baseline sources match their frames');
  assertDamageContributionsMatchFrames(grown, 'blind sword and cauldron sources do not overlap');
  close(contribution(grown, 'RL09').damage, playerDamageTotal(grown) - playerDamageTotal(baseline));
  assert.ok(contribution(grown, 'RE037-B').damage > 0,
    'unscaled converted true damage remains attributed to the owned permanent law');

  const shieldedEnemy = loadout('RKF06', {
    artifacts: [{ id: 'RC11', stacks: 3 }],
    baseStats: { attack: 0, defense: 0, max_hp: 1_000_000_000, crit_rate: 0, speed: 1 },
  });
  const shieldBaseline = simulateBattle(content, blindBuild(0), shieldedEnemy,
    'v2-devour-attribution-shield', { roundLimit: 1 });
  const shieldGrown = simulateBattle(content, blindBuild(1), shieldedEnemy,
    'v2-devour-attribution-shield', { roundLimit: 1 });
  const openingShield = shieldGrown.frames.find(frame => frame.kind === 'shield' && frame.source === 'RC11');
  const absorbedTrueDamage = shieldGrown.frames.find(frame => frame.kind === 'damage' && frame.source === 'RE037-B');
  assert.ok(openingShield && absorbedTrueDamage && absorbedTrueDamage.enemy.shield < openingShield.enemy.shield,
    'the blind true-damage frame is absorbed by the enemy opening shield');
  assertDamageContributionsMatchFrames(shieldBaseline, 'shield absorption is counted once without growth');
  assertDamageContributionsMatchFrames(shieldGrown, 'shield absorption and cauldron bonus partition the frames');
  close(contribution(shieldGrown, 'RL09').damage,
    playerDamageTotal(shieldGrown) - playerDamageTotal(shieldBaseline));

  const lethal = simulateBattle(content, blindBuild(1), dummy({ max_hp: 1, hp: 1 }),
    'v2-devour-attribution-lethal', { roundLimit: 1 });
  assert.equal(lethal.enemyHp, 0);
  assertDamageContributionsMatchFrames(lethal, 'a truncated killing hit has no phantom cauldron damage');
  assert.equal(contribution(lethal, 'RL09').damage, 0);
});

test('growth survives save, node snapshots, deterministic replay, and winning-build archives', () => {
  const game = makeGame('v2-artifact-growth-save');
  game.state.artifacts = [{ id: 'RL09', stacks: 1, devoured: 2 }];
  game.state.equipment.slots = ['RL09'];
  const restored = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
  assert.equal(artifactDevouredCount(restored.state.artifacts[0]), 2);

  const battleNode = restored.availableNodes().find(node => ['C', 'L', 'B'].includes(node.type));
  assert.ok(battleNode);
  restored.dispatch({ type: 'enter', id: battleNode.key });
  assert.equal(artifactDevouredCount(restored.state.nodeEntry.artifacts[0]), 2);
  restored.dispatch({ type: 'fight' });
  assert.equal(artifactDevouredCount(restored.state.battleInput.player.artifacts[0]), 2);
  const replayed = new ShanhaiGame(content, parseRunSave(content, serializeRun(restored)));
  assert.equal(artifactDevouredCount(replayed.state.battleInput.player.artifacts[0]), 2);
  assert.deepEqual(replayed.state.battle.frames, restored.state.battle.frames);

  replayed.state.phase = 'won';
  let saved;
  const storage = {
    getItem() { return saved ?? null; },
    setItem(_key, value) { saved = value; },
  };
  saveWinningBuild(replayed, storage);
  const archived = loadWinningBuilds(storage).at(-1);
  assert.equal(artifactDevouredCount(archived.artifacts[0]), 2);

  const forged = JSON.parse(serializeRun(game));
  forged.state.artifacts[0].devoured = -1;
  assert.throws(() => parseRunSave(content, JSON.stringify(forged)), /Invalid artifact stack devoured counter/);
});

test('mirror output scales once with cauldron growth, and lethal hits stop later output', () => {
  const entities = structuredClone(loaded.entities);
  entities.find(entity => entity.id === 'RULES').rage.opening = 100;
  const openRage = contentFromEntities(entities, `${content.version}-v2-devour-mirror`);
  const mirrorArtifacts = [
    { id: 'RL08', stacks: 1 },
    { id: 'RC19', stacks: 3 },
  ];
  const mirrored = simulateBattle(openRage, loadout('RKF01', {
    artifacts: [{ id: 'RL09', stacks: 1, devoured: 1 }, ...mirrorArtifacts],
  }), dummy(), 'v2-devour-mirror', { roundLimit: 1 });
  const unscaled = simulateBattle(openRage, loadout('RKF01', {
    artifacts: mirrorArtifacts,
  }), dummy(), 'v2-devour-mirror', { roundLimit: 1 });
  const mirrorFrames = mirrored.frames.filter(frame => frame.kind === 'damage' &&
    frame.source?.startsWith('RL08-MIRROR-AWAKENING'));
  assert.equal(mirrorFrames.length, 1, 'a mirrored awakening cannot recursively mirror itself');
  assert.equal(mirrored.frames.filter(frame => frame.kind === 'status' && /昆仑镜镜映/.test(frame.text)).length, 1);
  close(mirrorFrames[0].amount / unscaled.frames.find(frame => frame.kind === 'damage' &&
    frame.source === mirrorFrames[0].source)?.amount, 1.1);

  const lethal = simulateBattle(content, loadout('RKF01', {
    artifacts: [{ id: 'RL09', stacks: 1, devoured: 1 }],
  }), dummy({ max_hp: 1, hp: 1 }), 'v2-devour-lethal', { roundLimit: 1 });
  assert.equal(lethal.outcome, 'player');
  assert.equal(lethal.enemyHp, 0);
  const killingHit = damageFrames(lethal, 'RKF01-BASIC-DAMAGE')[0];
  assert.ok(killingHit);
  assert.equal(killingHit.enemy.hp, 0);
  assert.equal(lethal.frames.some(frame => frame.kind === 'dot'), false,
    'death ends the action chain before later damage-over-time output');
});
