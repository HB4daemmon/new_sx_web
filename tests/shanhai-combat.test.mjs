import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import {
  calculateStats,
  simulateBattle,
} from '../build/shanhai/combat.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 100,
  max_hp: 10_000,
  crit_rate: 0,
  speed: 10,
});

function makeLoadout(method = 'RKF01', branches = {}, artifacts = [], overrides = {}) {
  const entity = content.byId[method];
  const talents = Object.entries(branches).map(([tier, branch]) =>
    entity.talents.find(talent => talent.tier === Number(tier) && talent.branch === branch).id);
  return {
    name: method,
    method,
    n: 4,
    talents,
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...overrides },
  };
}

function syntheticDrainContent() {
  const template = content.byId.RR14;
  const makeArtifact = (id, trigger, amount) => {
    const artifact = structuredClone(template);
    artifact.id = id;
    artifact.name = id;
    artifact.attributes = { flat: {}, percent: {} };
    artifact.effects = [{
      ...structuredClone(template.effects[0]),
      id: `${id}-EFFECT`,
      trigger,
      params: {
        ...structuredClone(template.effects[0].params),
        amount,
      },
      text: `${id} synthetic drain`,
    }];
    return artifact;
  };
  return contentFromEntities([
    ...structuredClone(content.entities),
    makeArtifact('TEST-ROUND-DRAIN-A', 'action_end', 30),
    makeArtifact('TEST-ROUND-DRAIN-B', 'action_end', 30),
    makeArtifact('TEST-OPENING-DRAIN-A', 'battle_start', 30),
    makeArtifact('TEST-OPENING-DRAIN-B', 'battle_start', 30),
  ], `${content.version}-synthetic-drain`);
}

function firstFrame(result, predicate) {
  const frame = result.frames.find(predicate);
  assert.ok(frame, 'expected battle frame was not found');
  return frame;
}

function methodBuild(method, branchIndex) {
  const branches = {};
  for (let tier = 1; tier <= 4; tier++) branches[tier] = ['A', 'B', 'C'][Math.floor(branchIndex / (3 ** (tier - 1))) % 3];
  return makeLoadout(method.id, branches);
}

function contribution(result, id) {
  const item = result.contributions.find(entry => entry.id === id);
  assert.ok(item, `expected contribution ${id}`);
  return item;
}

function actionFrames(result, actor, source) {
  return result.frames.filter(frame => frame.kind === 'action' && frame.actor === actor && frame.source === source);
}

test('same seed is byte-for-byte deterministic and does not mutate inputs', () => {
  const player = makeLoadout('RKF05', { 1: 'A', 2: 'B', 3: 'C', 4: 'A' }, [{ id: 'RC01', stacks: 2 }, { id: 'RR10', stacks: 1 }]);
  const enemy = makeLoadout('RKF04', { 1: 'A', 2: 'A', 3: 'A', 4: 'A' }, [], { speed: 9, attack: 80 });
  const beforePlayer = structuredClone(player);
  const beforeEnemy = structuredClone(enemy);
  const beforeEntities = structuredClone(content.entities);
  const first = simulateBattle(content, player, enemy, 'deterministic-seed', { roundLimit: 8 });
  const second = simulateBattle(content, player, enemy, 'deterministic-seed', { roundLimit: 8 });
  assert.deepEqual(second, first);
  assert.deepEqual(player, beforePlayer);
  assert.deepEqual(enemy, beforeEnemy);
  assert.deepEqual(content.entities, beforeEntities);
});

test('all 10 x 3^4 complete talent builds calculate and simulate', () => {
  const methods = content.entities.filter(entity => entity.kind === 'method');
  assert.equal(methods.length, 10);
  let count = 0;
  for (const method of methods) {
    for (let branchIndex = 0; branchIndex < 81; branchIndex++) {
      const player = methodBuild(method, branchIndex);
      const stats = calculateStats(content, player);
      for (const value of Object.values(stats)) assert.equal(Number.isFinite(value), true);
      const result = simulateBattle(
        content,
        player,
        makeLoadout('RKF01', {}, [], { attack: 0, max_hp: 1_000_000, speed: 1 }),
        `all-builds-${method.id}-${branchIndex}`,
        { roundLimit: 4 },
      );
      assert.equal(['player', 'enemy', 'draw'].includes(result.outcome), true);
      assert.equal(Number.isFinite(result.playerHp), true);
      assert.equal(Number.isFinite(result.enemyHp), true);
      count += 1;
    }
  }
  assert.equal(count, 810);
});

test('varied artifact categories survive ten-round smoke battles', () => {
  const methods = content.entities.filter(entity => entity.kind === 'method');
  const artifactCombos = [
    [],
    [{ id: 'RC09', stacks: 1 }, { id: 'RC11', stacks: 1 }],
    [{ id: 'RR01', stacks: 1 }, { id: 'RR10', stacks: 1 }],
    [{ id: 'RR13', stacks: 1 }, { id: 'RR15', stacks: 1 }],
    [{ id: 'RL01', stacks: 1 }, { id: 'RL04', stacks: 1 }],
    [{ id: 'RC24', stacks: 2 }, { id: 'RR05', stacks: 1 }],
  ];
  let count = 0;
  for (const method of methods) {
    for (let comboIndex = 0; comboIndex < artifactCombos.length; comboIndex++) {
      const branches = {};
      for (let tier = 1; tier <= 4; tier++) branches[tier] = ['A', 'B', 'C'][(comboIndex + tier) % 3];
      const player = makeLoadout(method.id, branches, artifactCombos[comboIndex], {
        attack: 100,
        defense: 100,
        max_hp: 1_000_000,
        crit_rate: 0.05,
        speed: 10,
      });
      const result = simulateBattle(
        content,
        player,
        makeLoadout('RKF01', {}, [], {
          attack: 10,
          defense: 100,
          max_hp: 1_000_000_000,
          speed: 9,
        }),
        `varied-artifacts-${method.id}-${comboIndex}`,
        { roundLimit: 10 },
      );
      assert.equal(['player', 'enemy', 'draw'].includes(result.outcome), true);
      assert.equal(Number.isFinite(result.playerHp), true);
      assert.equal(Number.isFinite(result.enemyHp), true);
      count += 1;
    }
  }
  assert.equal(count, 60);
});

test('rage is settled after both locked actions and opening rage locks both rage actions', () => {
  const player = makeLoadout('RKF01', {}, [{ id: 'RC22', stacks: 1 }, { id: 'RL04', stacks: 1 }], { max_hp: 1_000_000, speed: 10 });
  const enemy = makeLoadout('RKF01', {}, [{ id: 'RL04', stacks: 1 }], { max_hp: 1_000_000, speed: 9 });
  const rageRound = simulateBattle(content, player, enemy, 'locked-rage', { roundLimit: 1 });
  const rageActions = rageRound.frames.filter(frame => frame.kind === 'action' && frame.round === 1);
  assert.equal(rageActions.length, 2);
  assert.deepEqual(rageActions.map(frame => frame.source), ['RKF01-RAGE-DAMAGE', 'RKF01-RAGE-DAMAGE']);
  assert.equal(rageRound.contributions.find(item => item.id === 'RC22')?.rage, 15);
  assert.equal(rageRound.contributions.find(item => item.id === 'RL04')?.rage, 50);

  const basicRound = simulateBattle(
    content,
    makeLoadout('RKF01', {}, [], { max_hp: 1_000_000 }),
    makeLoadout('RKF01', {}, [], { max_hp: 1_000_000, attack: 0, speed: 9 }),
    'rage-settlement',
    { roundLimit: 2 },
  );
  const settlementIndex = basicRound.frames.findIndex(frame =>
    frame.round === 1 && frame.kind === 'rage' && frame.source === 'RULES-RAGE-SETTLE');
  const roundOneActions = basicRound.frames
    .map((frame, index) => ({ frame, index }))
    .filter(item => item.frame.round === 1 && item.frame.kind === 'action')
    .map(item => item.index);
  assert.ok(settlementIndex > Math.max(...roundOneActions));
});

test('base rage cadence is independent of speed and RKF02 refunds every actual 100-cost rage action', () => {
  const enemy = makeLoadout('RKF01', {}, [], {
    attack: 0,
    defense: 100,
    max_hp: 1_000_000_000,
    speed: 9,
  });
  for (const speed of [12, 8]) {
    const rkf01 = simulateBattle(
      content,
      makeLoadout('RKF01', {}, [], { max_hp: 1_000_000_000, speed }),
      enemy,
      `rkf01-cadence-${speed}`,
      { roundLimit: 11 },
    );
    assert.deepEqual(actionFrames(rkf01, 'player', 'RKF01-RAGE-DAMAGE').map(frame => frame.round), [3, 7, 11]);

    const rkf02 = simulateBattle(
      content,
      makeLoadout('RKF02', {}, [], { max_hp: 1_000_000_000, speed }),
      enemy,
      `rkf02-cadence-${speed}`,
      { roundLimit: 9 },
    );
    assert.deepEqual(actionFrames(rkf02, 'player', 'RKF02-RAGE-DAMAGE').map(frame => frame.round), [3, 6, 9]);
  }
});

test('incoming rage counts each effective direct segment but excludes derived damage and DOT', () => {
  const player = makeLoadout('RKF01', {}, [], {
    attack: 0,
    defense: 0,
    max_hp: 100_000,
    speed: 10,
  });

  const manySegments = simulateBattle(
    content,
    player,
    makeLoadout('RKF09', {}, [{ id: 'RL04', stacks: 1 }], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 9,
    }),
    'incoming-three-segments',
    { roundLimit: 1 },
  );
  assert.equal(contribution(manySegments, 'RKF01').rage, 50);

  const derived = simulateBattle(
    content,
    player,
    makeLoadout('RKF08', { 3: 'B' }, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 9,
    }),
    'incoming-derived-excluded',
    { roundLimit: 1 },
  );
  assert.equal(contribution(derived, 'RKF01').rage, 40);
  assert.ok(derived.frames.some(frame => frame.source === 'RKF08-J3-B-DAMAGE'));

  const dot = simulateBattle(
    content,
    player,
    makeLoadout('RKF04', {}, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 9,
    }),
    'incoming-dot-excluded',
    { roundLimit: 1 },
  );
  assert.equal(contribution(dot, 'RKF01').rage, 40);
  assert.ok(dot.frames.some(frame => frame.kind === 'dot'));

  const shielded = makeLoadout('RKF01', {}, [], {
    attack: 0,
    defense: 0,
    max_hp: 100_000,
    speed: 10,
  });
  shielded.preparation = 100;
  const directShield = simulateBattle(
    content,
    shielded,
    makeLoadout('RKF01', {}, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 9,
    }),
    'incoming-shield-absorption',
    { roundLimit: 1 },
  );
  assert.equal(contribution(directShield, 'RKF01').rage, 40);
  assert.equal(directShield.playerHp, 100_000);
  assert.ok(directShield.frames.some(frame => frame.kind === 'damage' && frame.actor === 'enemy' && frame.amount > 0));
});

test('DOT layers snapshot attack, expire independently, and do not refresh old layers', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF04', {}, [], {
      attack: 100,
      defense: 0,
      max_hp: 100_000,
      speed: 10,
    }),
    makeLoadout('RKF08', {}, [], {
      attack: 1,
      defense: 0,
      max_hp: 100_000_000,
      speed: 9,
    }),
    'dot-layer-snapshot',
    { roundLimit: 4 },
  );
  const basicBurns = result.frames.filter(frame =>
    frame.kind === 'dot' && frame.actor === 'player' && frame.source === 'RKF04-BASIC-BURN');
  const byRound = round => basicBurns.filter(frame => frame.round === round).map(frame => frame.amount);

  // RKF08 weakness lowers only layers applied after round one. The original
  // layer keeps its 10-point snapshot through its third and final tick.
  assert.deepEqual(byRound(1), [10]);
  assert.deepEqual(byRound(2), [10, 9.5]);
  assert.deepEqual(byRound(3), [10, 9.5]);
  assert.deepEqual(byRound(4), [9.5, 10]);
  assert.equal(basicBurns.filter(frame => frame.amount === 10 && frame.round <= 3).length, 3);
  assert.equal(result.frames.filter(frame => frame.kind === 'dot' && frame.actor === 'player').every(frame => frame.amount === 10 || frame.amount === 9.5), true);
});

test('rage drain uses additive resistance and opening drain has its own window', () => {
  const player = makeLoadout('RKF01', {}, [{ id: 'RR15', stacks: 1 }], {
    attack: 0,
    defense: 100,
    max_hp: 100_000,
    speed: 10,
  });
  const enemy = makeLoadout('RKF08', { 3: 'A' }, [{ id: 'RR13', stacks: 1 }], {
    attack: 100,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 9,
  });
  const resisted = simulateBattle(content, player, enemy, 'drain-resistance', { roundLimit: 2 });
  const drains = resisted.frames.filter(frame => frame.source === 'RULES-RAGE-DRAIN');
  assert.deepEqual(drains.map(frame => frame.amount), [9, 9]);

  const opening = simulateBattle(
    content,
    makeLoadout('RKF01', {}, [{ id: 'RR15', stacks: 1 }], {
      attack: 0,
      defense: 100,
      max_hp: 100_000,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [{ id: 'RR14', stacks: 1 }], {
      attack: 0,
      defense: 100,
      max_hp: 1_000_000_000,
      speed: 9,
    }),
    'opening-drain-resistance',
    { roundLimit: 1 },
  );
  const openingDrain = firstFrame(opening, frame => frame.source === 'RULES-OPENING-DRAIN');
  assert.equal(openingDrain.amount, 15);
  assert.equal(opening.frames.find(frame => frame.kind === 'start').player.rage, 35);
});

test('resistance is applied before the round and opening drain caps', () => {
  const synthetic = syntheticDrainContent();
  const target = makeLoadout('RKF01', {}, [{ id: 'RR15', stacks: 1 }], { attack: 0, max_hp: 100000 });
  const source = makeLoadout('RKF01', {}, [
    { id: 'TEST-ROUND-DRAIN-A', stacks: 1 },
    { id: 'TEST-ROUND-DRAIN-B', stacks: 1 },
    { id: 'TEST-OPENING-DRAIN-A', stacks: 1 },
    { id: 'TEST-OPENING-DRAIN-B', stacks: 1 },
  ], { attack: 0, max_hp: 100000, speed: 9 });
  const result = simulateBattle(synthetic, target, source, 'cap-after-resistance', { roundLimit: 1 });
  assert.equal(result.frames.find(frame => frame.source === 'RULES-OPENING-DRAIN').amount, 30);
  assert.equal(result.frames.find(frame => frame.source === 'RULES-RAGE-DRAIN').amount, 20);
});

test('synthetic drain sources obey the exact 20-per-round and 50-opening caps', () => {
  const synthetic = syntheticDrainContent();
  const round = simulateBattle(
    synthetic,
    makeLoadout('RKF01', {}, [
      { id: 'TEST-ROUND-DRAIN-A', stacks: 1 },
      { id: 'TEST-ROUND-DRAIN-B', stacks: 1 },
    ], {
      attack: 0,
      defense: 0,
      max_hp: 100_000,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 100_000,
      speed: 9,
    }),
    'synthetic-round-drain-cap',
    { roundLimit: 2 },
  );
  assert.deepEqual(
    round.frames.filter(frame => frame.source === 'RULES-RAGE-DRAIN').map(frame => frame.amount),
    [20, 20],
  );

  const opening = simulateBattle(
    synthetic,
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 100_000,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [
      { id: 'TEST-OPENING-DRAIN-A', stacks: 1 },
      { id: 'TEST-OPENING-DRAIN-B', stacks: 1 },
    ], {
      attack: 0,
      defense: 0,
      max_hp: 100_000,
      speed: 9,
    }),
    'synthetic-opening-drain-cap',
    { roundLimit: 1 },
  );
  assert.deepEqual(
    opening.frames.filter(frame => frame.source === 'RULES-OPENING-DRAIN').map(frame => frame.amount),
    [50],
  );
  assert.equal(firstFrame(opening, frame => frame.kind === 'start').player.rage, 0);
});

test('actual lowered rage cap is floored at 60 and refund reads the locked paid cost once', () => {
  const result = simulateBattle(
    content,
    makeLoadout(
      'RKF02',
      { 1: 'A' },
      [
        { id: 'RC19', stacks: 3 },
        { id: 'RR07', stacks: 1 },
        { id: 'RL04', stacks: 1 },
        { id: 'RL05', stacks: 1 },
      ],
      { attack: 0, defense: 100, max_hp: 1_000_000_000, speed: 10 },
    ),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 100,
      max_hp: 1_000_000_000,
      speed: 9,
    }),
    'actual-paid-cost-floor',
    { roundLimit: 3 },
  );
  const costs = result.frames
    .filter(frame => frame.actor === 'player' && frame.source === 'RKF02-rage-cost')
    .map(frame => frame.amount);
  assert.deepEqual(costs, [75, 60, 60]);
  assert.equal(result.frames.filter(frame => frame.source === 'RR07-FIRST-RAGE-CAP-REDUCTION').length, 1);
  const secondSettlement = firstFrame(result, frame =>
    frame.round === 2 && frame.source === 'RULES-RAGE-SETTLE' && frame.actor === 'player');
  assert.equal(secondSettlement.amount, 72);
  assert.equal(secondSettlement.player.rageCap, 60);
});

test('prepared RKF05 first strike is a snapshotted direct segment with isolated consumption', () => {
  const player = makeLoadout('RKF05', { 3: 'C' }, [], {
    attack: 100,
    defense: 0,
    max_hp: 10_000,
    crit_rate: 1,
    speed: 10,
  });
  player.firstStrike = 20;
  player.preparation = 40;
  const enemy = makeLoadout('RKF01', {}, [], {
    attack: 0,
    defense: 0,
    max_hp: 100_000,
    speed: 9,
  });
  const before = structuredClone(player);
  const result = simulateBattle(content, player, enemy, 'prepared-first-strike', { roundLimit: 1 });
  assert.deepEqual(player, before);

  const strike = firstFrame(result, frame => frame.source === 'RKF05-TRAVEL-NEXT-STRIKE');
  assert.equal(strike.kind, 'damage');
  assert.equal(strike.amount, 30);
  const main = firstFrame(result, frame => frame.kind === 'action' && frame.actor === 'player');
  assert.ok(result.frames.indexOf(strike) < result.frames.indexOf(main));
  assert.equal(result.frames.filter(frame => frame.source === 'RKF05-J3-C-CRIT-FOLLOWUP').length, 1);
  assert.equal(result.frames.filter(frame => frame.kind === 'shield' && frame.source === 'RKF05').length, 1);
  const enemySettlement = firstFrame(result, frame =>
    frame.round === 1 && frame.source === 'RULES-RAGE-SETTLE' && frame.actor === 'enemy');
  assert.equal(enemySettlement.amount, 45);

  const killPlayer = makeLoadout('RKF05', {}, [], {
    attack: 100,
    defense: 0,
    max_hp: 10_000,
    crit_rate: 0,
    speed: 10,
  });
  killPlayer.firstStrike = 100;
  const killResult = simulateBattle(
    content,
    killPlayer,
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 100,
      speed: 9,
    }),
    'prepared-first-strike-kill',
    { roundLimit: 1 },
  );
  assert.equal(killResult.outcome, 'player');
  assert.equal(killResult.frames.some(frame => frame.kind === 'action' && frame.actor === 'player'), false);
  assert.equal(killResult.frames.some(frame => frame.source === 'RKF05-BASIC-INTENT'), false);
});

test('talent ratio additions and replacement outlets stay scoped to authored segments', () => {
  const basicTalent = simulateBattle(
    content,
    makeLoadout('RKF01', { 1: 'C' }, [], { attack: 100, defense: 0, max_hp: 1_000_000 }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf01-basic-talent-ratio',
    { roundLimit: 1 },
  );
  assert.ok(Math.abs(firstFrame(basicTalent, frame => frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE').amount - 110.2) < 1e-9);

  const basicTalentAndArtifact = simulateBattle(
    content,
    makeLoadout('RKF01', { 1: 'C' }, [{ id: 'RC09', stacks: 1 }], { attack: 98, defense: 0, max_hp: 1_000_000 }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf01-basic-talent-and-artifact-ratio',
    { roundLimit: 1 },
  );
  assert.ok(Math.abs(firstFrame(basicTalentAndArtifact, frame =>
    frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE').amount - 115.9) < 1e-9);

  const rageTalent = simulateBattle(
    content,
    makeLoadout('RKF02', { 1: 'C' }, [{ id: 'RL04', stacks: 1 }], { attack: 88, defense: 0, max_hp: 1_000_000 }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf02-rage-talent-ratio',
    { roundLimit: 1 },
  );
  assert.equal(firstFrame(rageTalent, frame =>
    frame.kind === 'damage' && frame.source === 'RKF02-RAGE-DAMAGE').amount, 170.8);

  const rageFormulaAndPercent = simulateBattle(
    content,
    makeLoadout('RKF02', { 1: 'C', 3: 'A', 4: 'B' }, [
      { id: 'RC22', stacks: 2 },
      { id: 'RL04', stacks: 1 },
    ], { attack: 84, defense: 0, max_hp: 1_000_000 }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf02-rage-formula-percent-scope',
    { roundLimit: 1 },
  );
  assert.ok(Math.abs(firstFrame(rageFormulaAndPercent, frame =>
    frame.kind === 'damage' && frame.source === 'RKF02-RAGE-DAMAGE').amount - 431.68) < 1e-9);

  const rageFormulaAndJ1C = simulateBattle(
    content,
    makeLoadout('RKF02', { 1: 'C', 3: 'A' }, [
      { id: 'RC22', stacks: 2 },
      { id: 'RL04', stacks: 1 },
    ], { attack: 84, defense: 0, max_hp: 1_000_000 }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf02-rage-formula-j1c-scope',
    { roundLimit: 1 },
  );
  assert.ok(Math.abs(firstFrame(rageFormulaAndJ1C, frame =>
    frame.kind === 'damage' && frame.source === 'RKF02-RAGE-DAMAGE').amount - 346.48) < 1e-9);

  const forcedBasic = simulateBattle(
    content,
    makeLoadout('RKF02', { 4: 'C' }, [{ id: 'RL04', stacks: 1 }], { attack: 88, defense: 0, max_hp: 1_000_000 }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf02-forced-basic-ratio',
    { roundLimit: 2 },
  );
  assert.equal(firstFrame(forcedBasic, frame =>
    frame.round === 2 && frame.kind === 'damage' && frame.source === 'RKF02-BASIC-DAMAGE').amount, 118);

  const shieldConvert = makeLoadout('RKF01', { 4: 'B' }, [{ id: 'RL04', stacks: 1 }], {
    attack: 100,
    defense: 100,
    max_hp: 1_000_000,
  });
  shieldConvert.preparation = 100;
  const converted = simulateBattle(
    content,
    shieldConvert,
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf01-shield-convert',
    { roundLimit: 1 },
  );
  assert.equal(firstFrame(converted, frame => frame.kind === 'damage' && frame.source === 'RKF01-RAGE-DAMAGE').amount, 188.7);
  assert.equal(converted.frames.some(frame => frame.source === 'RKF01-RAGE-SHIELD'), false);

  const segmentTalent = simulateBattle(
    content,
    makeLoadout('RKF04', { 4: 'A' }, [{ id: 'RL04', stacks: 1 }], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000,
    }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf04-rage-segments',
    { roundLimit: 1 },
  );
  const rageSegments = segmentTalent.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF04-RAGE-DAMAGE');
  assert.equal(rageSegments.length, 2);
  assert.equal(rageSegments.length, 2);
  assert.ok(rageSegments.every(frame => Math.abs(frame.amount - 98.56) < 1e-9));
});

test('RKF01 recoil bonuses add once and retain talent and artifact contributions', () => {
  const player = makeLoadout('RKF01', { 3: 'A', 4: 'C' }, [{ id: 'RC13', stacks: 1 }], {
    attack: 100,
    defense: 98,
    max_hp: 10_000,
    speed: 10,
  });
  player.preparation = 100;
  const result = simulateBattle(
    content,
    player,
    makeLoadout('RKF01', {}, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000,
      speed: 11,
    }),
    'rkf01-recoil-additive-bonuses',
    { roundLimit: 1 },
  );
  const recoil = firstFrame(result, frame =>
    frame.kind === 'damage' && frame.source === 'RKF01-PASSIVE-RECOIL');
  assert.ok(Math.abs(recoil.amount - ((100 * 0.38 + 100 * 0.22) * (1 + 0.28 + 0.06))) < 1e-9);
  assert.equal(contribution(result, 'RKF01-J3-A').triggers, 1);
  assert.equal(contribution(result, 'RC13').triggers, 1);
  assert.equal(result.frames.filter(frame => frame.source === 'RKF01-PASSIVE-RECOIL').length, 1);
});

test('RKF01 J1-A and RC11 combine on method shields, while preparation stays outside the talent scope', () => {
  const basic = simulateBattle(
    content,
    makeLoadout('RKF01', { 1: 'A', 2: 'C' }, [{ id: 'RC11', stacks: 1 }], {
      attack: 0,
      defense: 98,
      max_hp: 1_000,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 1 }),
    'rkf01-shield-additive-basic',
    { roundLimit: 1 },
  );
  const basicShield = firstFrame(basic, frame =>
    frame.kind === 'shield' && frame.source === 'RKF01-BASIC-SHIELD');
  assert.ok(Math.abs(basicShield.amount - ((100 * 0.42 + 1_000 * 0.12) * (1 + 0.18 + 0.06))) < 1e-9);
  assert.equal(contribution(basic, 'RKF01-J1-A').triggers, 1);
  assert.equal(contribution(basic, 'RC11').triggers, 1);

  const rage = simulateBattle(
    content,
    makeLoadout('RKF01', { 1: 'A', 2: 'C' }, [{ id: 'RC11', stacks: 1 }, { id: 'RL04', stacks: 1 }], {
      attack: 0,
      defense: 98,
      max_hp: 1_000,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 1 }),
    'rkf01-shield-additive-rage',
    { roundLimit: 1 },
  );
  const rageShield = firstFrame(rage, frame =>
    frame.kind === 'shield' && frame.source === 'RKF01-RAGE-SHIELD');
  assert.ok(Math.abs(rageShield.amount - ((100 * 0.55 + 1_000 * 0.12) * (1 + 0.18 + 0.06))) < 1e-9);

  const prepared = makeLoadout('RKF01', { 1: 'A' }, [{ id: 'RC11', stacks: 1 }], {
    attack: 0,
    defense: 98,
    max_hp: 1_000,
    speed: 10,
  });
  prepared.preparation = 100;
  const preparationResult = simulateBattle(
    content,
    prepared,
    makeLoadout('RKF01', {}, [], {
      attack: 5_000,
      defense: 0,
      max_hp: 1_000_000,
      speed: 11,
    }),
    'rkf01-shield-preparation-scope',
    { roundLimit: 1 },
  );
  const preparationShield = firstFrame(preparationResult, frame =>
    frame.kind === 'shield' && frame.source === 'RKF01');
  assert.equal(preparationShield.amount, 106);
  assert.equal(contribution(preparationResult, 'RKF01-J1-A').triggers, 0);
});

test('RKF03 rage healing sums J2-B and J4-A max-health inputs', () => {
  const player = makeLoadout('RKF03', { 2: 'B', 4: 'A' }, [{ id: 'RL04', stacks: 1 }], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 10,
  });
  player.hp = 500;
  const result = simulateBattle(
    content,
    player,
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 1 }),
    'rkf03-rage-heal-add-inputs',
    { roundLimit: 1 },
  );
  const heal = firstFrame(result, frame =>
    frame.kind === 'heal' && frame.source === 'RKF03-RAGE-HEAL');
  assert.ok(Math.abs(heal.amount - (1_000 * (0.24 + 0.10 + 0.14))) < 1e-9);
  assert.equal(contribution(result, 'RKF03-J2-B').triggers, 1);
  assert.equal(contribution(result, 'RKF03-J4-A').triggers, 1);
});

test('RKF03 J1-A uses its authored additive overflow percentage only on the default outlet', () => {
  const basePlayer = { attack: 0, defense: 0, max_hp: 1_000, speed: 10 };
  const enemy = makeLoadout('RKF01', {}, [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
  });

  const defaultOutlet = simulateBattle(
    content,
    makeLoadout('RKF03', { 1: 'A' }, [], basePlayer),
    enemy,
    'rkf03-j1a-overflow-default',
    { roundLimit: 1 },
  );
  const defaultDamage = firstFrame(defaultOutlet, frame =>
    frame.kind === 'damage' && frame.source === 'RKF03-J1-A-OVERFLOW');
  assert.equal(defaultDamage.amount, 95);

  const poisonOutlet = simulateBattle(
    content,
    makeLoadout('RKF03', { 1: 'A', 2: 'A' }, [], basePlayer),
    enemy,
    'rkf03-j1a-overflow-poison',
    { roundLimit: 1 },
  );
  assert.equal(poisonOutlet.frames.some(frame => frame.source === 'RKF03-J1-A-OVERFLOW'), false);
  assert.equal(poisonOutlet.frames.some(frame => frame.kind === 'status' && frame.source === 'RKF03-J2-A-POISON'), true);

  const directOutlet = simulateBattle(
    content,
    makeLoadout('RKF03', { 1: 'A', 4: 'C' }, [], basePlayer),
    enemy,
    'rkf03-j1a-overflow-direct-replacement',
    { roundLimit: 1 },
  );
  const directDamage = firstFrame(directOutlet, frame =>
    frame.kind === 'damage' && frame.source === 'RKF03-J4-C-DAMAGE');
  assert.ok(Math.abs(directDamage.amount - 110) < 1e-9);
  assert.equal(directOutlet.frames.some(frame => frame.source === 'RKF03-J1-A-OVERFLOW'), false);

  const shieldOutlet = simulateBattle(
    content,
    makeLoadout('RKF03', { 1: 'A' }, [{ id: 'RL01', stacks: 1 }], basePlayer),
    enemy,
    'rkf03-j1a-overflow-shield-replacement',
    { roundLimit: 1 },
  );
  const overflowShield = firstFrame(shieldOutlet, frame =>
    frame.kind === 'shield' && frame.source === 'RL01-HEAL-OVERFLOW-TO-SHIELD');
  assert.equal(overflowShield.amount, 112);
  assert.equal(shieldOutlet.frames.some(frame => frame.source === 'RKF03-J1-A-OVERFLOW'), false);
});

test('RKF06 J1-A adds only poison layers and keeps their authored duration and ratio', () => {
  const poisonContent = syntheticDrainContent();
  const result = simulateBattle(
    poisonContent,
    makeLoadout('RKF06', { 1: 'A' }, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [
      { id: 'TEST-ROUND-DRAIN-A', stacks: 1 },
      { id: 'TEST-ROUND-DRAIN-B', stacks: 1 },
    ], {
      attack: 1,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 1,
    }),
    'rkf06-j1-a-poison-input',
    { roundLimit: 4 },
  );
  const poisonTicks = result.frames.filter(frame =>
    frame.kind === 'dot' && frame.actor === 'player' && frame.source === 'RKF06-BASIC-POISON');
  const byRound = round => poisonTicks
    .filter(frame => frame.round === round)
    .reduce((sum, frame) => sum + frame.amount, 0);
  assert.deepEqual([1, 2, 3, 4].map(byRound), [16, 32, 48, 48]);

  const ratioResult = simulateBattle(
    content,
    makeLoadout('RKF06', { 1: 'B' }, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 1,
    }),
    'rkf06-j1-b-poison-ratio',
    { roundLimit: 1 },
  );
  const ratioTick = firstFrame(ratioResult, frame =>
    frame.kind === 'dot' && frame.actor === 'player' && frame.source === 'RKF06-BASIC-POISON');
  assert.equal(ratioTick.amount, 10);
});

test('RKF05 J1-A keeps sword-intent bonus in the same critical direct segment', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', { 1: 'A' }, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000_000,
      crit_rate: 1,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 1,
    }),
    'rkf05-j1-a-sword-bonus-segment',
    { roundLimit: 3 },
  );
  const rageDamage = result.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF05-RAGE-DAMAGE');
  assert.equal(rageDamage.length, 1);
  assert.ok(Math.abs(rageDamage[0].amount - 237) < 1e-9);
});

test('same-scope RKF05 percentage bonuses add once and scale non-crit sword intent', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', { 3: 'A', 4: 'C' }, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000_000,
      crit_rate: 0,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 1,
    }),
    'rkf05-same-scope-percent-addition',
    { roundLimit: 7 },
  );
  const rageDamage = firstFrame(result, frame =>
    frame.round === 7 && frame.kind === 'damage' &&
    frame.actor === 'player' && frame.source === 'RKF05-RAGE-DAMAGE');
  assert.ok(Math.abs(rageDamage.amount - 246.5) < 1e-9);
});

test('artifact stat, basic damage, and shield multipliers use authored values', () => {
  const plain = makeLoadout('RKF01', {}, [], { max_hp: 1000 });
  const withAttack = makeLoadout('RKF01', {}, [{ id: 'RC01', stacks: 2 }], { max_hp: 1000 });
  const stats = calculateStats(content, withAttack);
  assert.equal(stats.attack, 112);
  assert.equal(stats.defense, 100);

  const plainDamage = simulateBattle(content, plain, makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 100_000, speed: 1 }), 'rc09-damage-plain', { roundLimit: 1 });
  const rc09Damage = simulateBattle(content, makeLoadout('RKF01', {}, [{ id: 'RC09', stacks: 1 }], { max_hp: 1000 }), makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 100_000, speed: 1 }), 'rc09-damage-artifact', { roundLimit: 1 });
  const plainHit = firstFrame(plainDamage, frame => frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE');
  const rc09Hit = firstFrame(rc09Damage, frame => frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE');
  assert.ok(Math.abs(plainHit.amount - 95) < 1e-9);
  assert.ok(Math.abs(rc09Hit.amount - (102 * 0.95 * 1.06)) < 1e-9);

  const plainShield = simulateBattle(content, plain, makeLoadout('RKF01', {}, [], { attack: 0, max_hp: 100_000, speed: 1 }), 'rc11-shield-plain', { roundLimit: 1 });
  const rc11Shield = simulateBattle(content, makeLoadout('RKF01', {}, [{ id: 'RC11', stacks: 1 }], { max_hp: 1000 }), makeLoadout('RKF01', {}, [], { attack: 0, max_hp: 100_000, speed: 1 }), 'rc11-shield-artifact', { roundLimit: 1 });
  const plainShieldFrame = firstFrame(plainShield, frame => frame.kind === 'shield' && frame.source === 'RKF01-BASIC-SHIELD');
  const rc11ShieldFrame = firstFrame(rc11Shield, frame => frame.kind === 'shield' && frame.source === 'RKF01-BASIC-SHIELD');
  assert.ok(Math.abs(plainShieldFrame.amount - 42) < 1e-9);
  assert.ok(Math.abs(rc11ShieldFrame.amount - (102 * 0.42 * 1.06)) < 1e-9);
});

test('selected but inactive sources remain in contributions with zero values', () => {
  const player = makeLoadout('RKF01', { 3: 'B' }, [{ id: 'RC13', stacks: 1 }]);
  const result = simulateBattle(
    content,
    player,
    makeLoadout('RKF01', {}, [], { attack: 0, max_hp: 100_000, speed: 1 }),
    'zero-contribution',
    { roundLimit: 1 },
  );
  const talent = result.contributions.find(item => item.id === 'RKF01-J3-B');
  const artifact = result.contributions.find(item => item.id === 'RC13');
  const talentEntity = content.byId.RKF01.talents.find(item => item.id === 'RKF01-J3-B');
  assert.deepEqual(talent, {
    id: 'RKF01-J3-B',
    name: talentEntity.name,
    triggers: 0,
    damage: 0,
    healing: 0,
    shield: 0,
    absorbed: 0,
    rage: 0,
    reason: 'conditional trigger absent',
  });
  assert.deepEqual(artifact, {
    id: 'RC13',
    name: content.byId.RC13.name,
    triggers: 0,
    damage: 0,
    healing: 0,
    shield: 0,
    absorbed: 0,
    rage: 0,
    reason: 'permanent attributes applied; conditional effect not triggered',
  });
});

test('killing a target stops artifact and derived followups', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF01', {}, [{ id: 'RL03', stacks: 1 }, { id: 'RR04', stacks: 1 }]),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1, speed: 1 }),
    'kill-followups',
    { roundLimit: 1 },
  );
  assert.equal(result.outcome, 'player');
  assert.equal(result.frames.filter(frame => frame.source === 'RL03-BASIC-HIT-TWO-FOLLOWUPS').length, 0);
  assert.equal(result.frames.filter(frame => frame.source === 'RR04-BASIC-HIT-CHANCE-FOLLOWUP').length, 0);

  const derived = simulateBattle(
    content,
    makeLoadout('RKF08', { 3: 'B' }, [{ id: 'RL04', stacks: 1 }]),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 150, speed: 1 }),
    'kill-derived-followup',
    { roundLimit: 1 },
  );
  assert.equal(derived.frames.filter(frame => frame.source === 'RKF08-J3-B-DAMAGE').length, 1);
  assert.equal(derived.outcome, 'player');
});

test('fifteen rounds end in a draw without automatic defeat', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 100, max_hp: 100_000, speed: 10 }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 100, max_hp: 100_000, speed: 9 }),
    'round-limit',
    { roundLimit: 15 },
  );
  assert.equal(result.outcome, 'draw');
  assert.equal(result.rounds, 15);
  assert.equal(result.reason, 'round_limit_15');
  assert.equal(result.playerHp > 0, true);
  assert.equal(result.enemyHp > 0, true);
});

test('RKF03 with RL01 routes overflow to shield without default damage or poison', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF03', {}, [{ id: 'RL01', stacks: 1 }], { max_hp: 1000, speed: 10 }),
    makeLoadout('RKF01', {}, [], { attack: 0, max_hp: 100_000, speed: 1 }),
    'overflow-shield',
    { roundLimit: 1 },
  );
  assert.ok(result.frames.some(frame => frame.source === 'RL01-HEAL-OVERFLOW-TO-SHIELD' && frame.kind === 'shield'));
  assert.equal(result.frames.some(frame => frame.source === 'RKF03-PASSIVE-OVERFLOW'), false);
  assert.equal(result.frames.some(frame => frame.source === 'RKF03-J1-A-OVERFLOW'), false);
  assert.equal(result.frames.some(frame => frame.kind === 'status' && frame.text.includes('poison')), false);
});

test('RKF03 J3-B reduction starts after healing and lasts through the next round', () => {
  const player = makeLoadout('RKF03', { 3: 'B' }, [], { max_hp: 1000, speed: 10 });
  player.hp = 500;
  const enemy = makeLoadout('RKF01', {}, [], { max_hp: 100_000, speed: 11 });
  const result = simulateBattle(content, player, enemy, 'heal-reduction', { roundLimit: 2 });
  const enemyHits = result.frames.filter(frame =>
    frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE' && frame.actor === 'enemy');
  assert.equal(enemyHits.length >= 2, true);
  assert.ok(Math.abs(enemyHits[0].amount - 47.5) < 1e-9);
  assert.ok(Math.abs(enemyHits[1].amount - 41.8) < 1e-9);
});

test('RKF07 reservation consumes preexisting charge luck once and reads J4-C defense ratio', () => {
  const baseEnemy = makeLoadout('RKF01', {}, [], { attack: 0, defense: 100, max_hp: 100_000, speed: 1 });
  const result = simulateBattle(
    content,
    makeLoadout('RKF07', { 3: 'B', 4: 'C' }, [], { max_hp: 1000, speed: 10 }),
    baseEnemy,
    'luck-0',
    { roundLimit: 2 },
  );
  assert.ok(result.frames.some(frame => frame.round === 1 && frame.kind === 'status' && frame.text.includes('charge_luck')));
  const shield = firstFrame(result, frame =>
    frame.round === 2 && frame.kind === 'shield' && frame.source === 'RKF07-J4-C-CHAIN');
  assert.ok(Math.abs(shield.amount - 30) < 1e-9);
  assert.equal(result.frames.some(frame =>
    frame.round === 2 && frame.kind === 'damage' && frame.source === 'RKF07-BASIC-CHAIN'), false);
});

test('RKF10 changes day/night exactly once per main action', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF10', {}, [], { attack: 0, max_hp: 100_000, speed: 10 }),
    makeLoadout('RKF01', {}, [], { attack: 0, max_hp: 100_000, speed: 1 }),
    'phase-sequence',
    { roundLimit: 4 },
  );
  const phases = result.frames
    .filter(frame => ['RKF10-BASIC-PHASE', 'RKF10-RAGE-PHASE'].includes(frame.source) && frame.actor === 'player')
    .map(frame => frame.player.statuses.day_night);
  assert.deepEqual(phases, [1, 2, 1, 2]);
});
