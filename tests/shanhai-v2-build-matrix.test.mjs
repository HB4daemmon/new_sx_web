import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { MAX_EQUIPMENT_SLOTS } from '../build/shanhai/equipment.js';
import { buildMechanicViews } from '../build/shanhai/build-mechanics.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const METHODS = Array.from({ length: 10 }, (_, index) => `RKF${String(index + 1).padStart(2, '0')}`);
const INSIGHT_IDS = [
  'V2-J1-A', 'V2-J1-B', 'V2-J1-C', 'V2-J1-D', 'V2-J1-E', 'V2-J1-F',
  'V2-J2-A', 'V2-J2-B', 'V2-J2-C',
  'V2-J3-A', 'V2-J3-B', 'V2-J3-C',
  'V2-J4-A', 'V2-J4-B', 'V2-J4-C',
];
const INSIGHTS = new Map(content.rules.insights.map(insight => [insight.id, insight]));

const MATRIX_TALENTS = [
  ['V2-J1-A', 'V2-J2-A', 'V2-J3-A', 'V2-J4-A'],
  ['V2-J1-B', 'V2-J2-B', 'V2-J3-B', 'V2-J4-B'],
  ['V2-J1-C', 'V2-J2-C', 'V2-J3-C', 'V2-J4-C'],
  ['V2-J1-D', 'V2-J2-A', 'V2-J3-B', 'V2-J4-C'],
  ['V2-J1-E', 'V2-J2-B', 'V2-J3-C', 'V2-J4-A'],
  ['V2-J1-F', 'V2-J2-C', 'V2-J3-A', 'V2-J4-B'],
  ['V2-J1-A', 'V2-J2-A', 'V2-J3-B', 'V2-J4-C'],
  ['V2-J1-B', 'V2-J2-B', 'V2-J3-C', 'V2-J4-A'],
  ['V2-J1-C', 'V2-J2-C', 'V2-J3-A', 'V2-J4-B'],
  ['V2-J1-D', 'V2-J2-A', 'V2-J3-B', 'V2-J4-C'],
];

const MATRIX_ARTIFACTS = [
  { owned: [], equipped: [] },
  { owned: ['RC09'], equipped: ['RC09'] },
  { owned: ['RC09', 'RC10', 'RC12'], equipped: ['RC10'] },
  { owned: ['RC09', 'RC10', 'RC11', 'RC12', 'RC14'], equipped: ['RC09', 'RC10', 'RC11', 'RC12', 'RC14'] },
  { owned: ['RC14', 'RC15', 'RC18'], equipped: ['RC14', 'RC15'] },
  { owned: ['RC09', 'RC10', 'RC11', 'RC12'], equipped: ['RC09', 'RC12'] },
  { owned: ['RC10', 'RC11'], equipped: ['RC10', 'RC11'] },
  { owned: ['RC09', 'RC14', 'RC15', 'RC18'], equipped: ['RC09', 'RC14', 'RC15', 'RC18'] },
  { owned: ['RC11', 'RC12', 'RC14'], equipped: ['RC12', 'RC14'] },
  { owned: ['RC09', 'RC10', 'RC11', 'RC12'], equipped: ['RC09', 'RC10', 'RC11', 'RC12'] },
];

function buildParams(id) {
  const insight = INSIGHTS.get(id);
  assert.ok(insight, `missing authored insight ${id}`);
  assert.equal(insight.effects.length, 1, `${id} should have one authored build effect`);
  return insight.effects[0].params;
}

function registerFixtureWorker(outcome = 'draw') {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player, enemy) {
      return {
        outcome,
        rounds: 1,
        playerHp: player.hp ?? player.baseStats.max_hp,
        enemyHp: outcome === 'player' ? 0 : enemy.hp ?? enemy.baseStats.max_hp,
        frames: [],
        contributions: [],
        ...(outcome === 'draw' ? { reason: 'matrix snapshot' } : {}),
      };
    },
  });
}

function freezeRunBattle({
  method,
  talents,
  ownedArtifacts = [],
  equippedArtifacts = ownedArtifacts,
  seed,
  coins = 240,
  coinsSpent = 80,
  eliteWins = 2,
  bossWins = 1,
  knownMethods = ['RKF01', method],
  hpRatio = 1,
  outcome = 'draw',
}) {
  registerFixtureWorker(outcome);
  const game = ShanhaiGame.create(content, {
    seed,
    name: `matrix-${method}`,
    method: 'RKF01',
  });
  game.state.method = method;
  game.state.ownedMethods = [...new Set(knownMethods)];
  game.state.talents = { RKF01: [], [method]: [...talents] };
  game.state.n = 4;
  game.state.xp = 2040;
  game.state.coins = coins;
  game.state.progress = { coinsSpent, eliteWins, bossWins };
  game.state.artifacts = ownedArtifacts.map(id => ({ id, stacks: 1 }));
  game.state.equipment = { slots: [...equippedArtifacts] };
  game.state.hp = calculateStats(content, game.player).max_hp * hpRatio;

  const node = game.availableNodes().find(candidate => candidate.type === 'C');
  assert.ok(node, 'fixture run should expose a normal combat node');
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });

  assert.equal(game.state.phase, 'battle');
  assert.ok(game.state.battleInput);
  return { game, input: structuredClone(game.state.battleInput) };
}

function enemyLoadout(id) {
  const enemy = content.byId[id];
  assert.ok(enemy && enemy.kind === 'enemy', `missing enemy ${id}`);
  return {
    name: enemy.name,
    method: enemy.method,
    n: enemy.n,
    talents: [...(enemy.talents ?? [])],
    artifacts: structuredClone(enemy.artifacts ?? []),
    baseStats: structuredClone(enemy.stats),
  };
}

function firstPlayerDamage(result, source) {
  const frame = result.frames.find(item =>
    item.kind === 'damage' && item.actor === 'player' && item.source === source);
  assert.ok(frame, `expected outgoing damage from ${source}`);
  return frame.amount;
}

function assertFiniteBattle(result) {
  assert.ok(['player', 'enemy', 'draw'].includes(result.outcome));
  assert.ok(Number.isInteger(result.rounds) && result.rounds >= 0);
  assert.ok(Number.isFinite(result.playerHp) && result.playerHp >= 0);
  assert.ok(Number.isFinite(result.enemyHp) && result.enemyHp >= 0);
  for (const frame of result.frames) {
    if (frame.amount !== undefined) assert.ok(Number.isFinite(frame.amount));
    for (const side of ['player', 'enemy']) {
      assert.ok(Number.isFinite(frame[side].hp));
      assert.ok(Number.isFinite(frame[side].maxHp));
      assert.ok(Number.isFinite(frame[side].shield));
      assert.ok(Number.isFinite(frame[side].rage));
    }
  }
  for (const item of result.contributions) {
    for (const key of ['triggers', 'damage', 'healing', 'shield', 'absorbed', 'rage']) {
      assert.ok(Number.isFinite(item[key]), `${item.id}.${key} must be finite`);
    }
  }
}

function assertDeterministicBattle(player, enemy, seed, roundLimit) {
  const options = { roundLimit };
  const first = simulateBattle(content, player, enemy, seed, options);
  const second = simulateBattle(content, player, enemy, seed, options);
  assertFiniteBattle(first);
  assert.deepEqual(second, first);
  return first;
}

test('authored insights form legal four-tier builds across all methods with frozen journey inputs', () => {
  assert.equal(MAX_EQUIPMENT_SLOTS, 5);
  const covered = new Set();

  for (const [index, method] of METHODS.entries()) {
    const talents = MATRIX_TALENTS[index];
    const artifacts = MATRIX_ARTIFACTS[index];
    for (const id of talents) covered.add(id);

    assert.deepEqual(talents.map(id => INSIGHTS.get(id)?.tier), [1, 2, 3, 4], `${method} tier selection`);
    assert.ok(artifacts.equipped.length <= MAX_EQUIPMENT_SLOTS);
    const { game, input } = freezeRunBattle({
      method,
      talents,
      ownedArtifacts: artifacts.owned,
      equippedArtifacts: artifacts.equipped,
      seed: `authored-matrix-${method}`,
      coins: 240 + index * 10,
      coinsSpent: 80 + index * 5,
      knownMethods: [method, 'RKF01', 'RKF02'],
    });

    assert.deepEqual(input.player.talents, talents);
    assert.deepEqual(input.player.artifacts, artifacts.equipped.map(id => ({ id, stacks: 1 })));
    if (artifacts.equipped.length === MAX_EQUIPMENT_SLOTS) {
      assert.equal(input.player.artifacts[MAX_EQUIPMENT_SLOTS - 1].id, 'RC14',
        `${method} must retain its fifth equipped artifact in the frozen battle input`);
    }
    assert.deepEqual(input.player.journey, {
      coins: 240 + index * 10,
      coinsSpent: 80 + index * 5,
      eliteWins: 2,
      bossWins: 1,
      artifactKinds: artifacts.owned.length,
      knownMethods: new Set([method, 'RKF01', 'RKF02']).size,
    });
    assert.equal(input.player.method, method);
    assert.equal(input.enemy.name, content.byId[game.node.id].name);
    assert.equal(input.enemy.method, content.byId[game.node.id].method);
    const views = buildMechanicViews(content, input.player, calculateStats(content, input.player));
    const viewBackedTalents = talents.filter(id =>
      INSIGHTS.get(id).effects.some(effect => effect.params?.build !== undefined));
    assert.deepEqual(views.map(view => view.id).sort(), viewBackedTalents.sort());

    const result = assertDeterministicBattle(input.player, input.enemy, input.seed, 8);
    assertFiniteBattle(result);
  }

  assert.deepEqual([...covered].sort(), [...INSIGHT_IDS].sort());
});

test('seeded drafts can offer all six first-tier insights and all later shared choices', () => {
  const reached = new Set();

  for (let seedIndex = 0; seedIndex < 256 && reached.size < INSIGHT_IDS.length; seedIndex++) {
    const game = ShanhaiGame.create(content, {
      seed: `insight-reachability-${seedIndex}`,
      name: 'draft-check',
      method: 'RKF01',
    });
    game.state.n = 4;
    game.state.xp = 2040;
    game.state.phase = 'talent';

    for (let tier = 1; tier <= 4; tier++) {
      game.state._talentQueue = [{ method: 'RKF01', tier, advance: true }];
      const shared = game.availableTalents().filter(talent => talent.id.startsWith('V2-J'));
      assert.equal(shared.length, tier === 1 ? 3 : 2);
      if (tier > 1) {
        assert.equal(game.availableTalents().filter(talent => talent.id.startsWith('RKF01-J')).length, 1);
      }
      for (const talent of shared) reached.add(talent.id);
    }
  }

  assert.deepEqual([...reached].sort(), [...INSIGHT_IDS].sort());
});

test('rage echoes stay single-payment and do not copy artifact or sword resource bursts', () => {
  const boss = enemyLoadout('EN-A4-B1');
  const shieldCombo = ['RL04', 'RC11'];
  const fourCoreCombo = ['RL04', 'RC09', 'RC12', 'RC14'];

  for (const method of METHODS) {
    for (const [comboIndex, artifacts] of [shieldCombo, fourCoreCombo].entries()) {
      const tierTwo = 'V2-J2-C';
      const talents = ['V2-J1-C', tierTwo, 'V2-J3-B', 'V2-J4-C'];
      const { input } = freezeRunBattle({
        method,
        talents,
        ownedArtifacts: artifacts,
        equippedArtifacts: artifacts,
        seed: `rage-echo-${method}-${comboIndex}`,
        hpRatio: 1,
      });

      assert.equal(input.player.journey.artifactKinds, artifacts.length);
      const result = assertDeterministicBattle(
        input.player,
        boss,
        input.seed,
        8,
      );
      const rageActions = result.frames.filter(frame =>
        frame.kind === 'action' && frame.actor === 'player' &&
        frame.source === `${method}-RAGE-DAMAGE`);
      const payments = result.frames.filter(frame =>
        frame.kind === 'rage' && frame.actor === 'player' &&
        frame.source === `${method}-rage-cost`);
      const echoDamage = result.frames.filter(frame =>
        frame.kind === 'damage' && frame.actor === 'player' &&
        frame.source?.endsWith('-RAGE-ECHO'));

      assert.ok(rageActions.length > 0, `${method} combo ${comboIndex} should execute a rage action`);
      assert.equal(payments.length, rageActions.length, `${method} combo ${comboIndex} rage payment count`);
      assert.ok(echoDamage.length > 0, `${method} combo ${comboIndex} should emit an authored rage echo`);
      assert.equal(result.frames.some(frame =>
        frame.kind === 'rage' && frame.actor === 'player' &&
        frame.source?.endsWith('-RAGE-ECHO')), false, 'echo must not spend rage');
      assert.equal(result.frames.some(frame =>
        frame.source?.includes('RAGE-ECHO-RAGE-ECHO')), false, 'echo must not recurse');

      if (comboIndex === 0) {
        assert.equal(result.frames.filter(frame =>
          frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RC11').length, 1);
        assert.equal(result.frames.some(frame => frame.source === 'RC11-RAGE-ECHO'), false);
      } else {
        for (const artifact of artifacts) {
          const artifactEcho = result.frames.filter(frame => frame.source === `${artifact}-RAGE-ECHO`);
          if (method === 'RKF03' && artifact === 'RC12') {
            const echoShield = artifactEcho.filter(frame => frame.kind === 'shield');
            assert.ok(echoShield.length > 0, 'echoed healing should preserve RC12 artifact attribution');
            const attributed = result.contributions.find(item => item.id === 'RC12');
            assert.ok(attributed);
            assert.ok(attributed.shield >= echoShield.reduce((sum, frame) => sum + frame.amount, 0));
          } else {
            assert.equal(artifactEcho.length, 0, `${method} must not echo artifact output ${artifact}`);
          }
        }
      }

    }
  }

  const swordTalents = ['V2-J1-C', 'RKF05-J2-B', 'V2-J3-B', 'V2-J4-C'];
  const swordArtifacts = ['RC10', 'RC11', 'RC12', 'RC14'];
  const { input } = freezeRunBattle({
    method: 'RKF05',
    talents: swordTalents,
    ownedArtifacts: swordArtifacts,
    equippedArtifacts: swordArtifacts,
    seed: 'rage-echo-sword-consumption',
  });
  const swordBattle = assertDeterministicBattle(
    input.player,
    boss,
    input.seed,
    8,
  );
  const swordFollowups = swordBattle.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' &&
    frame.source === 'RKF05-J2-B-CONSUME');
  assert.equal(swordFollowups.length, 2);
  assert.equal(swordBattle.frames.some(frame =>
    frame.source === 'RKF05-J2-B-CONSUME-RAGE-ECHO'), false);
});

test('hunter history is independent of current enemy tier and ordinary wins do not become trophies', () => {
  const hunter = buildParams('V2-J1-B');
  const hunterPlayer = freezeRunBattle({
    method: 'RKF08',
    talents: ['V2-J1-B'],
    seed: 'hunter-history-tier-matrix',
  }).input.player;
  const targets = ['EN-A1-C1', 'EN-A1-L1', 'EN-A1-B1'].map(enemyLoadout);
  const hunterDeltas = targets.map(target => {
    const withHunter = calculateStats(content, hunterPlayer, target);
    const withoutHunter = calculateStats(content, { ...hunterPlayer, talents: [] }, target);
    return {
      attack: withHunter.attack - withoutHunter.attack,
      defense: withHunter.defense - withoutHunter.defense,
    };
  });
  const expectedHunterDelta = {
    attack: hunter.base_attack + 2 * hunter.elite_attack + hunter.boss_attack,
    defense: hunter.base_defense + 2 * hunter.elite_defense + hunter.boss_defense,
  };
  assert.deepEqual(hunterDeltas, [expectedHunterDelta, expectedHunterDelta, expectedHunterDelta]);

  const trophy = buildParams('V2-J4-B');
  const zeroHistory = freezeRunBattle({
    method: 'RKF08',
    talents: ['V2-J4-B'],
    seed: 'trophy-history-zero',
    eliteWins: 0,
    bossWins: 0,
  }).input.player;
  const pastHistory = freezeRunBattle({
    method: 'RKF08',
    talents: ['V2-J4-B'],
    seed: 'trophy-history-past',
    eliteWins: 2,
    bossWins: 1,
  }).input.player;
  assert.deepEqual(Object.keys(zeroHistory.journey).sort(), [
    'artifactKinds', 'bossWins', 'coins', 'coinsSpent', 'eliteWins', 'knownMethods',
  ]);
  const target = enemyLoadout('EN-A4-B1');
  const seed = 'trophy-history-comparison';
  const baseline = simulateBattle(content, { ...zeroHistory, talents: [] }, target, seed, { roundLimit: 1 });
  const zeroResult = simulateBattle(content, zeroHistory, target, seed, { roundLimit: 1 });
  const historyResult = simulateBattle(content, pastHistory, target, seed, { roundLimit: 1 });
  const baselineDamage = firstPlayerDamage(baseline, 'RKF08-BASIC-DAMAGE');
  near(firstPlayerDamage(zeroResult, 'RKF08-BASIC-DAMAGE') / baselineDamage, 1 + trophy.base_bonus);
  near(
    firstPlayerDamage(historyResult, 'RKF08-BASIC-DAMAGE') / baselineDamage,
    1 + trophy.base_bonus + 2 * trophy.elite_bonus + trophy.boss_bonus,
  );
});

test('a settled ordinary victory pays its authored bounty without adding elite or boss history', () => {
  const bounty = buildParams('V2-J2-A');
  const { game, input } = freezeRunBattle({
    method: 'RKF01',
    talents: ['V2-J1-B', 'V2-J2-A'],
    seed: 'ordinary-bounty-settlement',
    coins: 100,
    coinsSpent: 20,
    eliteWins: 0,
    bossWins: 0,
    outcome: 'player',
  });
  const ordinaryCoins = content.rules.economy.ordinary_coins_by_act[game.state.act - 1];

  assert.deepEqual(input.player.journey, {
    coins: 100,
    coinsSpent: 20,
    eliteWins: 0,
    bossWins: 0,
    artifactKinds: 0,
    knownMethods: 1,
  });
  game.dispatch({ type: 'battle_done' });

  assert.equal(game.state.phase, 'reward');
  assert.equal(game.state.coins, 100 + ordinaryCoins + bounty.normal_coins);
  assert.equal(game.state.progress.eliteWins, 0);
  assert.equal(game.state.progress.bossWins, 0);
  assert.equal(game.player.journey.eliteWins, 0);
  assert.equal(game.player.journey.bossWins, 0);
  assert.equal(Object.hasOwn(game.player.journey, 'normalWins'), false);
});

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}
