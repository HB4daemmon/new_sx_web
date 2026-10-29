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

function openingRageContent(amount = 100) {
  const entities = structuredClone(content.entities);
  entities.find(entity => entity.id === 'RULES').rage.opening = amount;
  return contentFromEntities(entities, content.version);
}

function withRageCap(sourceContent, rageCap) {
  const entities = structuredClone(sourceContent.entities);
  entities.find(entity => entity.id === 'RULES').rage.base_cap = rageCap;
  return contentFromEntities(entities, sourceContent.version);
}

function effectParams(ownerId, effectId) {
  const owner = content.byId[ownerId];
  const effects = [
    ...Object.values(owner.actions ?? {}).flatMap(action => action.effects ?? []),
    ...(owner.passives ?? []),
    ...(owner.talents ?? []).flatMap(talent => talent.effects ?? []),
    ...(owner.effects ?? []),
  ];
  const effect = effects.find(item => item.id === effectId);
  assert.ok(effect, `expected authored effect ${effectId}`);
  return effect.params;
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
    [{ id: 'RC09', stacks: 1 }, { id: 'RC01', stacks: 1 }],
    [{ id: 'RR01', stacks: 1 }, { id: 'RR10', stacks: 1 }],
    [{ id: 'RR13', stacks: 1 }, { id: 'RR15', stacks: 1 }],
    [{ id: 'RL01', stacks: 1 }, { id: 'RR01', stacks: 1 }],
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
  const cappedOpeningContent = openingRageContent(0);
  const player = makeLoadout('RKF01', {}, [{ id: 'RC22', stacks: 1 }, { id: 'RL04', stacks: 1 }], { max_hp: 1_000_000, speed: 10 });
  const enemy = makeLoadout('RKF01', {}, [{ id: 'RL04', stacks: 1 }], { max_hp: 1_000_000, speed: 9 });
  const rageRound = simulateBattle(cappedOpeningContent, player, enemy, 'locked-rage', { roundLimit: 1 });
  const rageActions = rageRound.frames.filter(frame => frame.kind === 'action' && frame.round === 1);
  assert.equal(rageActions.length, 2);
  assert.deepEqual(rageActions.map(frame => frame.source), ['RKF01-RAGE-DAMAGE', 'RKF01-RAGE-DAMAGE']);
  const start = firstFrame(rageRound, frame => frame.kind === 'start');
  assert.equal(start.player.rage, 50);
  assert.equal(start.player.rageCap, 50);
  assert.equal(start.enemy.rage, 50);
  assert.equal(start.enemy.rageCap, 50);
  assert.equal(contribution(rageRound, 'RC22').rage, 15);
  assert.equal(contribution(rageRound, 'RL04').rage, 35);
  assert.deepEqual(
    rageRound.frames.filter(frame => frame.kind === 'rage' && frame.source === 'RKF01-rage-cost')
      .map(frame => [frame.actor, frame.amount]),
    [['player', 50], ['enemy', 50]],
  );

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
    withRageCap(content, 1_000),
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

  // A high rage cap keeps this snapshot fixture on basic actions. Weakness
  // lowers only later layers; the first layer still expires after its third tick.
  assert.deepEqual(byRound(1), [10]);
  assert.deepEqual(byRound(2), [10, 9.5]);
  assert.deepEqual(byRound(3), [10, 9.5, 9.5]);
  assert.deepEqual(byRound(4), [9.5, 9.5, 9.5]);
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
  const resisted = simulateBattle(
    content,
    player,
    enemy,
    'drain-resistance',
    { roundLimit: 2 },
  );
  const drains = resisted.frames.filter(frame => frame.source === 'RULES-RAGE-DRAIN');
  const rr13Drain = content.byId.RR13.effects[0].params.amount;
  const j3Drain = effectParams('RKF08', 'RKF08-J3-A-DRAIN').amount;
  const hexDrain = effectParams('RKF08', 'RKF08-V2-RESONANCE').drain_per_kind;
  const resistance = content.byId.RR15.effects[0].params.ratio;
  assert.deepEqual(drains.map(frame => frame.amount), [
    Math.floor((rr13Drain + j3Drain + hexDrain) * (1 - resistance)),
    Math.floor((rr13Drain + j3Drain + hexDrain) * (1 - resistance)),
  ]);

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
  const drainContent = syntheticDrainContent();
  const entities = structuredClone(drainContent.entities);
  entities.find(entity => entity.id === 'TEST-ROUND-DRAIN-A').equipment_role = 'core';
  const synthetic = contentFromEntities(entities, drainContent.version);
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
    openingRageContent(),
    makeLoadout(
      'RKF02',
      { 1: 'A' },
      [
        { id: 'RC19', stacks: 3 },
        { id: 'RR07', stacks: 1 },
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
  assert.deepEqual(costs, [75, 60]);
  assert.equal(result.frames.filter(frame => frame.source === 'RR07-FIRST-RAGE-CAP-REDUCTION').length, 1);
  const secondSettlement = firstFrame(result, frame =>
    frame.round === 3 && frame.source === 'RULES-RAGE-SETTLE' && frame.actor === 'player');
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
  const basicRatio = effectParams('RKF01', 'RKF01-BASIC-DAMAGE').attack_ratio;
  const basicTalentAdd = effectParams('RKF01', 'RKF01-J1-C-DAMAGE').damage_ratio_add;
  const basicTalentPlayer = makeLoadout(
    'RKF01',
    { 1: 'C' },
    [],
    { attack: 100, defense: 0, max_hp: 1_000_000 },
  );
  const basicTalent = simulateBattle(
    content,
    basicTalentPlayer,
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf01-basic-talent-ratio',
    { roundLimit: 1 },
  );
  assert.ok(Math.abs(firstFrame(basicTalent, frame =>
    frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE').amount -
    calculateStats(content, basicTalentPlayer).attack * basicRatio * (1 + basicTalentAdd)) < 1e-9);

  const basicTalentArtifactPlayer = makeLoadout(
    'RKF01',
    { 1: 'C' },
    [{ id: 'RC09', stacks: 1 }],
    { attack: 98, defense: 0, max_hp: 1_000_000 },
  );
  const basicTalentAndArtifact = simulateBattle(
    content,
    basicTalentArtifactPlayer,
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf01-basic-talent-and-artifact-ratio',
    { roundLimit: 1 },
  );
  const rc09BasicBonus = effectParams('RC09', 'RC09-BASIC-DIRECT-BONUS').ratio;
  assert.ok(Math.abs(firstFrame(basicTalentAndArtifact, frame =>
    frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE').amount -
    calculateStats(content, basicTalentArtifactPlayer).attack *
      basicRatio * (1 + basicTalentAdd + rc09BasicBonus)) < 1e-9);

  const rageTalentPlayer = makeLoadout(
    'RKF02',
    { 1: 'C' },
    [{ id: 'RL04', stacks: 1 }],
    { attack: 88, defense: 0, max_hp: 1_000_000 },
  );
  const rageTalent = simulateBattle(
    content,
    rageTalentPlayer,
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf02-rage-talent-ratio',
    { roundLimit: 1 },
  );
  const rageRatio = effectParams('RKF02', 'RKF02-RAGE-DAMAGE').attack_ratio;
  const rageTalentAdd = effectParams('RKF02', 'RKF02-J1-C-RAGE-DAMAGE').damage_ratio_add;
  assert.equal(firstFrame(rageTalent, frame =>
    frame.kind === 'damage' && frame.source === 'RKF02-RAGE-DAMAGE').amount,
  calculateStats(content, rageTalentPlayer).attack * rageRatio * (1 + rageTalentAdd));

  const formulaAndPercentPlayer = makeLoadout('RKF02', { 1: 'C', 3: 'A', 4: 'B' }, [
    { id: 'RC22', stacks: 2 },
    { id: 'RL04', stacks: 1 },
  ], { attack: 84, defense: 0, max_hp: 1_000_000 });
  const rageFormulaAndPercent = simulateBattle(
    content,
    formulaAndPercentPlayer,
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf02-rage-formula-percent-scope',
    { roundLimit: 1 },
  );
  const formulaAdd = effectParams('RKF02', 'RKF02-J3-A-HEAVY-HIT').attack_ratio_per_paid_rage;
  const percentAdd = effectParams('RKF02', 'RKF02-J4-B-RAGE-DAMAGE').damage_ratio_add;
  const paidRage = firstFrame(rageFormulaAndPercent, frame =>
    frame.kind === 'rage' && frame.source === 'RKF02-rage-cost').amount;
  assert.ok(Math.abs(firstFrame(rageFormulaAndPercent, frame =>
    frame.kind === 'damage' && frame.source === 'RKF02-RAGE-DAMAGE').amount -
    (calculateStats(content, formulaAndPercentPlayer).attack *
      (rageRatio + paidRage * formulaAdd) * (1 + rageTalentAdd + percentAdd))) < 1e-9);

  const formulaAndJ1CPlayer = makeLoadout('RKF02', { 1: 'C', 3: 'A' }, [
    { id: 'RC22', stacks: 2 },
    { id: 'RL04', stacks: 1 },
  ], { attack: 84, defense: 0, max_hp: 1_000_000 });
  const rageFormulaAndJ1C = simulateBattle(
    content,
    formulaAndJ1CPlayer,
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf02-rage-formula-j1c-scope',
    { roundLimit: 1 },
  );
  const j1cPaidRage = firstFrame(rageFormulaAndJ1C, frame =>
    frame.kind === 'rage' && frame.source === 'RKF02-rage-cost').amount;
  assert.ok(Math.abs(firstFrame(rageFormulaAndJ1C, frame =>
    frame.kind === 'damage' && frame.source === 'RKF02-RAGE-DAMAGE').amount -
    calculateStats(content, formulaAndJ1CPlayer).attack *
      (rageRatio + j1cPaidRage * formulaAdd) * (1 + rageTalentAdd)) < 1e-9);

  const forcedBasic = simulateBattle(
    content,
    makeLoadout('RKF02', { 4: 'C' }, [{ id: 'RL04', stacks: 1 }], { attack: 88, defense: 0, max_hp: 1_000_000 }),
    makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 1_000_000, speed: 9 }),
    'rkf02-forced-basic-ratio',
    { roundLimit: 2 },
  );
  const forcedBasicPlayer = makeLoadout(
    'RKF02',
    { 4: 'C' },
    [{ id: 'RL04', stacks: 1 }],
    { attack: 88, defense: 0, max_hp: 1_000_000 },
  );
  const forcedBasicFrames = forcedBasic.frames.filter(frame =>
    frame.round === 2 && frame.kind === 'damage' && frame.source === 'RKF02-BASIC-DAMAGE');
  const forcedBasicRatio = effectParams('RKF02', 'RKF02-BASIC-DAMAGE').attack_ratio *
    (1 + effectParams('RKF02', 'RKF02-J4-C-NEXT-BASIC').basic_damage_ratio_add);
  const breath = effectParams('RKF02', 'RKF02-V2-RESONANCE');
  assert.equal(forcedBasicFrames.length, 1 + breath.extra_segments);
  assert.ok(forcedBasicFrames.every(frame =>
    Math.abs(frame.amount - calculateStats(content, forcedBasicPlayer).attack *
      forcedBasicRatio * breath.segment_ratio) < 1e-9));

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
  const shieldConversion = effectParams('RKF01', 'RKF01-J4-B-CONSUME-SHIELD');
  const convertedAttack = calculateStats(content, shieldConvert).attack;
  const convertedRageRatio = effectParams('RKF01', 'RKF01-RAGE-DAMAGE').attack_ratio;
  const expectedShieldDamage = shieldConvert.preparation * shieldConversion.shield_consume_ratio *
    shieldConversion.extra_damage_per_shield_ratio;
  assert.equal(firstFrame(converted, frame =>
    frame.kind === 'damage' && frame.source === 'RKF01-RAGE-DAMAGE').amount,
  convertedAttack * convertedRageRatio + expectedShieldDamage);
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

test('RKF07 and RKF09 rage segment talents add one capped hit and keep one main action', () => {
  const target = makeLoadout('RKF01', {}, [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
  });
  const lightning = simulateBattle(
    content,
    makeLoadout('RKF07', { 3: 'A' }, [{ id: 'RL04', stacks: 1 }], {
      attack: 88,
      defense: 0,
      max_hp: 1_000_000,
      speed: 10,
    }),
    target,
    'rkf07-j3a-rage-segments',
    { roundLimit: 1 },
  );
  assert.equal(lightning.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF07-RAGE-DAMAGE').length, 4);
  assert.equal(actionFrames(lightning, 'player', 'RKF07-RAGE-DAMAGE').length, 1);
  assert.equal(contribution(lightning, 'RKF07-J3-A').triggers, 1);

  const cappedEntities = structuredClone(content.entities);
  const cappedTalent = cappedEntities.find(entity => entity.id === 'RKF07')
    .talents.find(talent => talent.id === 'RKF07-J3-A')
    .effects.find(effect => effect.id === 'RKF07-J3-A-SEGMENT');
  cappedTalent.params.value = 3;
  const cappedContent = contentFromEntities(cappedEntities, `${content.version}-segment-cap`);
  const cappedLightning = simulateBattle(
    cappedContent,
    makeLoadout('RKF07', { 3: 'A' }, [{ id: 'RL04', stacks: 1 }], {
      attack: 88,
      defense: 0,
      max_hp: 1_000_000,
      speed: 10,
    }),
    target,
    'rkf07-j3a-max-segments',
    { roundLimit: 1 },
  );
  assert.equal(cappedLightning.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF07-RAGE-DAMAGE').length, 4);

  const fire = simulateBattle(
    content,
    makeLoadout('RKF09', { 1: 'B' }, [{ id: 'RL04', stacks: 1 }], {
      attack: 88,
      defense: 0,
      max_hp: 1_000_000,
      speed: 10,
    }),
    target,
    'rkf09-j1b-rage-segments',
    { roundLimit: 1 },
  );
  assert.equal(fire.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF09-RAGE-DAMAGE').length, 4);
  assert.equal(fire.frames.filter(frame =>
    frame.kind === 'status' && frame.source === 'RKF09-RAGE-BURN' && frame.target === 'enemy').length, 4);
  assert.equal(fire.frames.at(-1).enemy.statuses.burn, 4);
  assert.equal(actionFrames(fire, 'player', 'RKF09-RAGE-DAMAGE').length, 1);
  assert.equal(contribution(fire, 'RKF09-J1-B').triggers, 1);

  const enemyLightning = simulateBattle(
    content,
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000,
      speed: 1,
    }),
    makeLoadout('RKF07', { 3: 'A' }, [{ id: 'RL04', stacks: 1 }], {
      attack: 88,
      defense: 0,
      max_hp: 1_000_000,
      speed: 10,
    }),
    'enemy-rkf07-j3a-rage-segments',
    { roundLimit: 1 },
  );
  assert.equal(enemyLightning.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'enemy' && frame.source === 'RKF07-RAGE-DAMAGE').length, 4);
  assert.equal(actionFrames(enemyLightning, 'enemy', 'RKF07-RAGE-DAMAGE').length, 1);
});

test('RKF01 recoil bonuses add once and retain the talent contribution', () => {
  const player = makeLoadout('RKF01', { 3: 'A', 4: 'C' }, [], {
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
  const playerStats = calculateStats(content, player);
  const recoilFormula = effectParams('RKF01', 'RKF01-J4-C-RECOIL-FORMULA');
  const recoilBonus = effectParams('RKF01', 'RKF01-J3-A-RECOIL').damage_ratio_add;
  assert.ok(Math.abs(recoil.amount -
    (playerStats.defense * recoilFormula.defense_ratio +
      playerStats.attack * recoilFormula.attack_ratio) * (1 + recoilBonus)) < 1e-9);
  assert.equal(contribution(result, 'RKF01-J3-A').triggers, 1);
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
  assert.ok(Math.abs(basicShield.amount - ((100 * 0.10 + 1_000 * 0.01) * (1 + 0.18 + 0.06))) < 1e-9);
  assert.equal(contribution(basic, 'RKF01-J1-A').triggers, 1);
  assert.equal(contribution(basic, 'RC11').triggers, 3);

  const twoCoreRules = simulateBattle(
    openingRageContent(0),
    makeLoadout('RKF01', { 1: 'A', 2: 'C' }, [
      { id: 'RC11', stacks: 1 },
      { id: 'RL04', stacks: 1 },
    ]),
    makeLoadout('RKF01'),
    'rkf01-rc11-rl04-two-cores',
    { roundLimit: 1 },
  );
  assert.ok(twoCoreRules.frames.some(frame => frame.kind === 'shield' && frame.source === 'RC11'));
  assert.ok(twoCoreRules.frames.some(frame => frame.kind === 'rage' && frame.source === 'RULES-OPENING-RAGE'));
  assert.ok(contribution(twoCoreRules, 'RC11').shield > 0);
  assert.equal(contribution(twoCoreRules, 'RL04').rage, 50);

  const rage = simulateBattle(
    openingRageContent(),
    makeLoadout('RKF01', { 1: 'A', 2: 'C' }, [{ id: 'RC11', stacks: 1 }], {
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
  assert.ok(Math.abs(rageShield.amount - ((100 * 0.18 + 1_000 * 0.01) * (1 + 0.18 + 0.06))) < 1e-9);

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

test('RKF01 J3-B grants its authored max-health shield after the first direct break', () => {
  const player = makeLoadout('RKF01', { 3: 'B' }, [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 1,
  });
  player.preparation = 1;
  const result = simulateBattle(
    content,
    player,
    makeLoadout('RKF01', {}, [], {
      attack: 100,
      defense: 0,
      max_hp: 100_000,
      speed: 10,
    }),
    'rkf01-j3b-recharge-ratio',
    { roundLimit: 1 },
  );
  const recharge = firstFrame(result, frame =>
    frame.kind === 'shield' && frame.source === 'RKF01-J3-B-RECHARGE');
  assert.equal(recharge.amount, 1_000 * 0.12);
  assert.equal(contribution(result, 'RKF01-J3-B').triggers, 1);
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
  assert.ok(Math.abs(heal.amount - (1_000 * (0.05 + 0.025 + 0.01))) < 1e-9);
  assert.equal(contribution(result, 'RKF03-J2-B').triggers, 1);
  assert.equal(contribution(result, 'RKF03-J4-A').triggers, 1);
});

test('RKF03 J1-B adds to basic max-health healing', () => {
  const player = makeLoadout('RKF03', { 1: 'B' }, [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 10,
  });
  player.hp = 500;
  const result = simulateBattle(
    content,
    player,
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 100_000,
      speed: 1,
    }),
    'rkf03-basic-heal-add-input',
    { roundLimit: 1 },
  );
  const heal = firstFrame(result, frame =>
    frame.kind === 'heal' && frame.source === 'RKF03-BASIC-HEAL');
  assert.equal(heal.amount, 1_000 * (0.02 + 0.01));
  assert.equal(contribution(result, 'RKF03-J1-B').triggers, 1);
});

test('RKF03 J3-C shields only the effective heal at its authored conversion ratio', () => {
  const player = makeLoadout('RKF03', { 3: 'C' }, [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000,
    speed: 10,
  });
  player.hp = 990;
  const result = simulateBattle(
    content,
    player,
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 100_000,
      speed: 1,
    }),
    'rkf03-effective-heal-shield-ratio',
    { roundLimit: 1 },
  );
  const shield = firstFrame(result, frame =>
    frame.kind === 'shield' && frame.source === 'RKF03-J3-C-SHIELD');
  assert.equal(shield.amount, 10 * 0.15);
  assert.equal(contribution(result, 'RKF03-J3-C').shield, 10 * 0.15);
});

test('RKF03 J1-A uses its authored additive overflow percentage only on the default outlet', () => {
  // Preserve a 100-point overflow so the poison outlet still applies a stack at the lower heal ratio.
  const basePlayer = { attack: 0, defense: 0, max_hp: 5_000, speed: 10 };
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
  assert.equal(defaultDamage.amount, 5_000 * 0.02 * (0.70 + 0.25));

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
  assert.ok(Math.abs(overflowShield.amount - (5_600 * 0.02)) < 1e-9);
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
  const rageAction = firstFrame(result, frame =>
    frame.kind === 'action' && frame.actor === 'player' && frame.source === 'RKF05-RAGE-DAMAGE');
  const rageRatio = effectParams('RKF05', 'RKF05-RAGE-DAMAGE').attack_ratio;
  const intentRatio = effectParams('RKF05', 'RKF05-PASSIVE-EDGE').sword_intent_ratio_per_stack;
  const talentIntentRatio = effectParams('RKF05', 'RKF05-J1-A-EDGE').sword_intent_ratio_per_stack_add;
  const intentStacks = rageAction.player.statuses.sword_intent;
  assert.equal(rageDamage.length, 1);
  assert.ok(Math.abs(rageDamage[0].amount -
    (100 * rageRatio * 1.5 + 100 * intentStacks * (intentRatio + talentIntentRatio))) < 1e-9);
});

test('RKF05 basic damage uses its authored ratio and per-stack sword-intent formula', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', {}, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000,
      crit_rate: 0,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 1,
    }),
    'rkf05-basic-damage-ratio',
    { roundLimit: 2 },
  );
  const firstBasic = firstFrame(result, frame =>
    frame.round === 1 && frame.kind === 'damage' && frame.source === 'RKF05-BASIC-DAMAGE');
  const secondBasic = firstFrame(result, frame =>
    frame.round === 2 && frame.kind === 'damage' && frame.source === 'RKF05-BASIC-DAMAGE');
  const basicRatio = effectParams('RKF05', 'RKF05-BASIC-DAMAGE').attack_ratio;
  const intentRatio = effectParams('RKF05', 'RKF05-PASSIVE-EDGE').sword_intent_ratio_per_stack;
  assert.ok(Math.abs(firstBasic.amount - 100 * basicRatio) < 1e-9);
  assert.ok(Math.abs(secondBasic.amount - 100 * (basicRatio + intentRatio)) < 1e-9);
});

test('RKF05 J4-A replaces rage damage with two authored sword-intent-scaled segments', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', { 4: 'A' }, [], {
      attack: 100,
      defense: 0,
      max_hp: 1_000_000,
      crit_rate: 0,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000_000,
      speed: 1,
    }),
    'rkf05-j4a-two-segments',
    { roundLimit: 3 },
  );
  const segments = result.frames.filter(frame =>
    frame.round === 3 && frame.kind === 'damage' &&
    frame.actor === 'player' && frame.source === 'RKF05-RAGE-DAMAGE');
  const rageAction = firstFrame(result, frame =>
    frame.round === 3 && frame.kind === 'action' &&
    frame.actor === 'player' && frame.source === 'RKF05-RAGE-DAMAGE');
  const rageSegmentRatio = effectParams('RKF05', 'RKF05-J4-A-RAGE-SEGMENTS').attack_ratio_per_segment;
  const intentRatio = effectParams('RKF05', 'RKF05-PASSIVE-EDGE').sword_intent_ratio_per_stack;
  const intentStacks = rageAction.player.statuses.sword_intent;
  assert.equal(segments.length, 2);
  assert.ok(segments.every(frame =>
    Math.abs(frame.amount - (100 * rageSegmentRatio + 100 * intentStacks * intentRatio)) < 1e-9));
});

test('RKF05 J3-B shield uses the action-start sword-intent stack count', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', { 3: 'B' }, [], {
      attack: 0,
      defense: 100,
      max_hp: 1_000,
      speed: 10,
    }),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000,
      speed: 1,
    }),
    'rkf05-j3b-stack-shield',
    { roundLimit: 3 },
  );
  const thirdRoundShield = firstFrame(result, frame =>
    frame.round === 3 && frame.kind === 'shield' && frame.source === 'RKF05-J3-B-SHIELD');
  assert.equal(thirdRoundShield.amount, 100 * 0.16 + 1_000 * 2 * 0.012);
});

test('same-scope RKF05 percentage bonuses add once and scale non-crit sword intent', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', { 2: 'A', 3: 'A', 4: 'C' }, [], {
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
  const rageAction = firstFrame(result, frame =>
    frame.kind === 'action' && frame.round === 7 &&
    frame.actor === 'player' && frame.source === 'RKF05-RAGE-DAMAGE');
  const rageRatio = effectParams('RKF05', 'RKF05-RAGE-DAMAGE').attack_ratio;
  const intentRatio = effectParams('RKF05', 'RKF05-PASSIVE-EDGE').sword_intent_ratio_per_stack;
  const j3Bonus = effectParams('RKF05', 'RKF05-J3-A-RAGE-DAMAGE').damage_ratio_add;
  const j4Bonus = effectParams('RKF05', 'RKF05-J4-C-FULL-EDGE').damage_ratio_add;
  const intentStacks = rageAction.player.statuses.sword_intent;
  assert.equal(intentStacks, 5);
  const percentBonus = 1 + j3Bonus + j4Bonus;
  assert.ok(Math.abs(rageDamage.amount -
    (100 * rageRatio * percentBonus + 100 * intentStacks * intentRatio * percentBonus)) < 1e-9);
});

test('artifact stat, basic damage, and shield multipliers use authored values', () => {
  const plain = makeLoadout('RKF01', {}, [], { max_hp: 1000 });
  const withAttack = makeLoadout('RKF01', {}, [{ id: 'RC01', stacks: 2 }], { max_hp: 1000 });
  const stats = calculateStats(content, withAttack);
  assert.equal(stats.attack, 112);
  assert.equal(stats.defense, 100);

  const rc09Player = makeLoadout('RKF01', {}, [{ id: 'RC09', stacks: 1 }], { max_hp: 1000 });
  const plainDamage = simulateBattle(content, plain, makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 100_000, speed: 1 }), 'rc09-damage-plain', { roundLimit: 1 });
  const rc09Damage = simulateBattle(content, rc09Player, makeLoadout('RKF01', {}, [], { attack: 0, defense: 0, max_hp: 100_000, speed: 1 }), 'rc09-damage-artifact', { roundLimit: 1 });
  const plainHit = firstFrame(plainDamage, frame => frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE');
  const rc09Hit = firstFrame(rc09Damage, frame => frame.kind === 'damage' && frame.source === 'RKF01-BASIC-DAMAGE');
  const basicRatio = effectParams('RKF01', 'RKF01-BASIC-DAMAGE').attack_ratio;
  const rc09BasicBonus = effectParams('RC09', 'RC09-BASIC-DIRECT-BONUS').ratio;
  assert.ok(Math.abs(plainHit.amount - calculateStats(content, plain).attack * basicRatio) < 1e-9);
  assert.ok(Math.abs(rc09Hit.amount - calculateStats(content, rc09Player).attack *
    basicRatio * (1 + rc09BasicBonus)) < 1e-9);

  const plainShield = simulateBattle(content, plain, makeLoadout('RKF01', {}, [], { attack: 0, max_hp: 100_000, speed: 1 }), 'rc11-shield-plain', { roundLimit: 1 });
  const rc11Player = makeLoadout('RKF01', {}, [{ id: 'RC11', stacks: 1 }], { max_hp: 1000 });
  const rc11Shield = simulateBattle(content, rc11Player, makeLoadout('RKF01', {}, [], { attack: 0, max_hp: 100_000, speed: 1 }), 'rc11-shield-artifact', { roundLimit: 1 });
  const plainShieldFrame = firstFrame(plainShield, frame => frame.kind === 'shield' && frame.source === 'RKF01-BASIC-SHIELD');
  const rc11ShieldFrame = firstFrame(rc11Shield, frame => frame.kind === 'shield' && frame.source === 'RKF01-BASIC-SHIELD');
  const shieldParams = effectParams('RKF01', 'RKF01-BASIC-SHIELD');
  const rc11ShieldBonus = content.byId.RC11.effects
    .find(effect => effect.id === 'RC11-SHIELD-GAIN-BONUS').params.ratio;
  assert.ok(Math.abs(plainShieldFrame.amount -
    calculateStats(content, plain).defense * shieldParams.defense_ratio) < 1e-9);
  assert.ok(Math.abs(rc11ShieldFrame.amount - calculateStats(content, rc11Player).defense *
    shieldParams.defense_ratio * (1 + rc11ShieldBonus)) < 1e-9);
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
  const baseDamage = calculateStats(content, enemy).attack *
    effectParams('RKF01', 'RKF01-BASIC-DAMAGE').attack_ratio * 100 /
    (100 + calculateStats(content, player).defense);
  const reduction = effectParams('RKF03', 'RKF03-J3-B-REDUCE').multiplier;
  assert.equal(enemyHits.length >= 2, true);
  assert.ok(Math.abs(enemyHits[0].amount - baseDamage) < 1e-9);
  assert.ok(Math.abs(enemyHits[1].amount - baseDamage * reduction) < 1e-9);
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

test('RKF10 day shield talents add per shield while night actions do not create shields', () => {
  const baseEnemy = makeLoadout('RKF01', {}, [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000,
    speed: 1,
  });
  const j1Basic = simulateBattle(
    content,
    makeLoadout('RKF10', { 1: 'A' }, [], {
      attack: 100,
      defense: 100,
      max_hp: 1_000_000,
      speed: 10,
    }),
    baseEnemy,
    'rkf10-j1a-day-basic-shield',
    { roundLimit: 1 },
  );
  const j1Shield = firstFrame(j1Basic, frame =>
    frame.kind === 'shield' && frame.actor === 'player' && frame.source === 'RKF10-BASIC-SHIELD-DAY');
  assert.equal(j1Shield.amount, 38);
  assert.equal(contribution(j1Basic, 'RKF10-J1-A').triggers, 1);

  const stacked = simulateBattle(
    content,
    makeLoadout('RKF10', { 2: 'C', 4: 'A' }, [], {
      attack: 100,
      defense: 100,
      max_hp: 1_000_000,
      speed: 10,
    }),
    baseEnemy,
    'rkf10-j2c-j4a-shield-stack',
    { roundLimit: 2 },
  );
  const dayShield = firstFrame(stacked, frame =>
    frame.round === 1 && frame.kind === 'shield' && frame.actor === 'player' &&
    frame.source === 'RKF10-BASIC-SHIELD-DAY');
  assert.ok(Math.abs(dayShield.amount - 56) < 1e-9);
  assert.equal(stacked.frames.some(frame =>
    frame.round === 2 && frame.kind === 'shield' && frame.actor === 'player' &&
    frame.source === 'RKF10-BASIC-SHIELD-DAY'), false);
  assert.ok(Math.abs(firstFrame(stacked, frame =>
    frame.round === 2 && frame.kind === 'damage' && frame.actor === 'player' &&
    frame.source === 'RKF10-BASIC-DAMAGE').amount - 140) < 1e-9);
  assert.ok(contribution(stacked, 'RKF10-J2-C').triggers >= 2);
  assert.ok(contribution(stacked, 'RKF10-J4-A').triggers >= 2);

  const nightRage = simulateBattle(
    content,
    makeLoadout('RKF10', { 2: 'C', 3: 'A', 4: 'A' }, [{ id: 'RC22', stacks: 1 }], {
      attack: 98,
      defense: 100,
      max_hp: 1_000_000,
      speed: 10,
    }),
    baseEnemy,
    'rkf10-night-rage-no-shield',
    { roundLimit: 2 },
  );
  assert.equal(actionFrames(nightRage, 'player', 'RKF10-RAGE-DAMAGE')
    .some(frame => frame.round === 2), true);
  assert.equal(nightRage.frames.some(frame =>
    frame.round === 2 && frame.kind === 'shield' && frame.actor === 'player' &&
    frame.source === 'RKF10-RAGE-SHIELD-DAY'), false);
  assert.ok(Math.abs(firstFrame(nightRage, frame =>
    frame.round === 2 && frame.kind === 'damage' && frame.actor === 'player' &&
    frame.source === 'RKF10-RAGE-DAMAGE').amount - 185) < 1e-9);
});

test('RKF10 enemy day rage applies stacked shield talent additions', () => {
  // Keep this 100-cost fixture independent of RL04's 50-cap and defense penalty.
  const result = simulateBattle(
    openingRageContent(100),
    makeLoadout('RKF01', {}, [], {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000,
      speed: 1,
    }),
    makeLoadout('RKF10', { 2: 'C', 4: 'A' }, [], {
      attack: 88,
      defense: 100,
      max_hp: 1_000_000,
      speed: 9,
    }),
    'enemy-rkf10-day-rage-shield-stack',
    { roundLimit: 1 },
  );
  const shield = firstFrame(result, frame =>
    frame.kind === 'shield' && frame.actor === 'enemy' && frame.source === 'RKF10-RAGE-SHIELD-DAY');
  assert.equal(firstFrame(result, frame => frame.kind === 'start').enemy.rageCap, 100);
  assert.equal(firstFrame(result, frame =>
    frame.kind === 'rage' && frame.actor === 'enemy' && frame.source === 'RKF10-rage-cost').amount, 100);
  assert.ok(Math.abs(shield.amount - 70) < 1e-9);
  assert.equal(actionFrames(result, 'enemy', 'RKF10-RAGE-DAMAGE').length, 1);
});
