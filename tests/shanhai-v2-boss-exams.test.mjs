import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const shanhaiBuildRoot = process.env.SHANHAI_BUILD_ROOT
  ? path.resolve(process.env.SHANHAI_BUILD_ROOT)
  : path.resolve(testsRoot, '../build/shanhai');
const [{ contentFromEntities }, { calculateStats, simulateBattle }] = await Promise.all([
  import(pathToFileURL(path.join(shanhaiBuildRoot, 'content.js')).href),
  import(pathToFileURL(path.join(shanhaiBuildRoot, 'combat.js')).href),
]);

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

function makeBoss(id, overrides = {}) {
  const authored = baseContent.byId[id];
  assert.ok(authored, `missing boss ${id}`);
  const {
    artifacts = [],
    talents = [],
    n = 0,
    hp,
    attack = 0,
    defense = 0,
    max_hp = 1_000,
    crit_rate = 0,
    speed = 1,
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

function counter(frame, side, id) {
  const item = (frame[side].counters ?? []).find(candidate => candidate.id === id);
  assert.ok(item, `missing ${side} counter ${id}`);
  return item;
}

function lastCounter(result, side, id) {
  for (let index = result.frames.length - 1; index >= 0; index -= 1) {
    const item = (result.frames[index][side].counters ?? []).find(candidate => candidate.id === id);
    if (item) return item;
  }
  assert.fail(`missing ${side} counter snapshots for ${id}`);
}

function withOpeningRage(amount) {
  return patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = amount;
    // Keep these shield-order fixtures independent of the authored boss balance.
    entities.find(item => item.id === 'EN-F1').phase_gate.shield_hp_ratio = 0.22;
  });
}

test('all mid-act bosses and both endings have a distinct, explicit counterplay trial', () => {
  const ids = [
    'EN-A2-B1', 'EN-A2-B2', 'EN-A3-B1', 'EN-A3-B2',
    'EN-A4-B1', 'EN-A4-B2', 'EN-F1', 'EN-F2',
  ];
  const kinds = new Set();
  for (const id of ids) {
    const authored = baseContent.byId[id];
    assert.ok(authored.trial, `${id} has a trial`);
    assert.ok(authored.counterplay.length >= 2, `${id} has multiple countermoves`);
    kinds.add(authored.trial.kind);
    const enemy = makeBoss(id);
    assert.ok(calculateStats(baseContent, enemy).max_hp > 0, `${id} loads through combat validation`);
  }
  assert.deepEqual([...kinds].sort(), [
    'blade_oath', 'ember_shell', 'rage_gale', 'reviving_mist', 'six_eye_gaze', 'tidal_charge',
  ]);
  for (const id of ['EN-F1', 'EN-F2']) {
    const gate = baseContent.byId[id].phase_gate;
    assert.equal(gate.kind, 'half_health_gate');
    assert.equal(gate.exposure_rounds, 1);
    assert.ok(gate.shield_hp_ratio > 0 && gate.shield_hp_ratio < 0.5);
    assert.ok(gate.exposure_damage_ratio > 1);
  }
});

test('new trials snapshot counterplay and release through ordinary status frames', () => {
  const player = makeLoadout('RKF08', [], {
    attack: 0,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
    firstStrike: 100,
  });
  const content = patchContent(entities => {
    const boss = entities.find(item => item.id === 'EN-A4-B1');
    boss.trial.period = 1;
  });
  const enemy = makeBoss('EN-A4-B1', { max_hp: 1_000_000, attack: 100, speed: 1 });
  const result = simulateBattle(content, player, enemy, 'boss-exam-status-cues', { roundLimit: 1 });
  const trialHit = result.frames.find(frame =>
    frame.kind === 'status' && frame.source === 'RKF05-TRAVEL-NEXT-STRIKE' &&
    frame.text.includes('剑誓准备'));
  const release = result.frames.find(frame =>
    frame.kind === 'status' && frame.source === 'EN-A4-B1' && frame.text.includes('剑誓释放'));
  const rearm = result.frames.find((frame, index) =>
    index > result.frames.indexOf(release) && frame.kind === 'status' &&
    frame.source === 'EN-A4-B1' && frame.text.includes('剑誓准备'));
  const oathDamage = result.frames.filter(frame => frame.kind === 'damage' && frame.source === 'EN-A4-B1');

  assert.ok(trialHit);
  assert.equal(counter(trialHit, 'enemy', 'EN-A4-B1-TRIAL-CHARGES').value, 2);
  assert.ok(release);
  assert.equal(counter(release, 'enemy', 'EN-A4-B1-TRIAL-CHARGES').value, 0);
  assert.equal(oathDamage.length, 1, 'the remaining three charges resolve as one sword strike');
  assert.ok(result.frames.every(frame => !['enemy_charge', 'enemy_release'].includes(frame.cue?.kind)));
  assert.ok(rearm, 'the living boss announces the rearmed preparation');
  assert.equal(counter(rearm, 'enemy', 'EN-A4-B1-TRIAL-CHARGES').value, 3);
  assert.equal(lastCounter(result, 'enemy', 'EN-A4-B1-TRIAL-CHARGES').value, 2,
    'the post-release first strike then removes one rearmed charge');
});

test('rage gale drains the authored amount under the public round cap and does not cancel a locked action', () => {
  const content = patchContent(entities => {
    // Leave enough rage after the locked basic and round-end gain for the full
    // 15-point gale request to resolve instead of draining only the available 10.
    entities.find(item => item.id === 'RULES').rage.opening = 90;
    entities.find(item => item.id === 'EN-A3-B1').trial.period = 1;
  });
  const player = makeLoadout('RKF08', [], {
    attack: 0,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
  });
  const enemy = makeBoss('EN-A3-B1', { max_hp: 1_000_000, attack: 0, speed: 1 });
  const result = simulateBattle(content, player, enemy, 'rage-gale-counter', { roundLimit: 1 });
  const drain = result.frames.find(frame =>
    frame.kind === 'rage' && frame.source === 'RULES-RAGE-DRAIN' && frame.actor === 'player');
  const locked = result.frames.find(frame => frame.kind === 'action' && frame.actor === 'player');
  const release = result.frames.find(frame =>
    frame.kind === 'status' && frame.source === 'EN-A3-B1' && frame.text.includes('雷怒释放'));

  assert.ok(release);
  assert.ok(locked, 'rage gale settles after the player’s already locked action');
  assert.equal(locked.source, 'RKF08-BASIC-DAMAGE');
  assert.ok(drain);
  assert.equal(drain.amount, 15);
  assert.ok(result.frames.every(frame => !['enemy_charge', 'enemy_release'].includes(frame.cue?.kind)));
});

test('first lethal half-health crossing is capped once and opens a finite, deterministic gate shield', () => {
  const content = withOpeningRage(0);
  const player = makeLoadout('RKF08', [], {
    attack: 0,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
    firstStrike: 10_000,
  });
  const enemy = makeBoss('EN-F1', { max_hp: 1_000, attack: 0, speed: 1 });
  const first = simulateBattle(content, player, enemy, 'half-gate-crossing', { roundLimit: 1 });
  const repeated = simulateBattle(content, player, enemy, 'half-gate-crossing', { roundLimit: 1 });
  const gateOpenings = first.frames.filter(frame => frame.kind === 'status' && frame.text.includes('半血劫门开启'));
  const thresholdHit = first.frames.find(frame => frame.kind === 'damage' && frame.source === 'RKF05-TRAVEL-NEXT-STRIKE');
  const gateId = 'EN-F1-PHASE-GATE';

  assert.deepEqual(repeated, first);
  assert.equal(gateOpenings.length, 1);
  assert.equal(thresholdHit.enemy.hp, 500, 'the crossing hit cannot spill past the half-health line');
  assert.equal(thresholdHit.enemy.shield, 220);
  assert.equal(counter(thresholdHit, 'enemy', gateId).name, '二阶护罩');
  assert.equal(counter(thresholdHit, 'enemy', gateId).value, 220);
  assert.equal(first.enemyHp, 500);
  assert.ok(first.frames.every(frame => !['enemy_charge', 'enemy_release'].includes(frame.cue?.kind)));
});

test('an ordinary opening shield is absorbed before the half-health gate creates its own shield', () => {
  const content = withOpeningRage(0);
  const player = makeLoadout('RKF08', [], {
    attack: 0,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
    firstStrike: 1_000,
  });
  const enemy = { ...makeBoss('EN-F1', { max_hp: 1_000, attack: 0, speed: 1 }), thunderChallenge: true };
  const result = simulateBattle(content, player, enemy, 'ordinary-shield-before-phase-gate', { roundLimit: 1 });
  const openingShield = result.frames.find(frame => frame.kind === 'shield' && frame.source === 'THUNDER-CHALLENGE');
  const crossing = result.frames.find(frame => frame.kind === 'damage' && frame.source === 'RKF05-TRAVEL-NEXT-STRIKE');
  const gateOpening = result.frames.filter(frame => frame.kind === 'status' && frame.text.includes('半血劫门开启'));

  assert.ok(openingShield, 'the boss receives its normal challenge shield before the first hit');
  assert.equal(openingShield.amount, 150);
  assert.ok(crossing);
  assert.equal(crossing.enemy.hp, 500, 'the crossing hit first absorbs the old shield, then stops at half health');
  assert.equal(crossing.enemy.shield, 220, 'only the newly created phase shield remains');
  assert.equal(counter(crossing, 'enemy', 'EN-F1-PHASE-GATE').value, 220);
  assert.equal(gateOpening.length, 1);
});

test('a normal shield gained after the gate stays ahead of its phase shield under a critical hit', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    entities.find(item => item.id === 'EN-F1').method = 'RKF01';
    entities.find(item => item.id === 'EN-F1').phase_gate.shield_hp_ratio = 0.22;
    entities.find(item => item.id === 'RKF08').actions.basic.effects
      .find(effect => effect.id === 'RKF08-BASIC-DAMAGE').params.attack_ratio = 1;
  });
  const player = makeLoadout('RKF08', [], {
    attack: 1_100,
    defense: 0,
    max_hp: 10_000,
    crit_rate: 1,
    speed: 20,
    firstStrike: 3_666.666667,
  });
  const enemy = makeLoadout('RKF01', [], {
    name: '雷劫化身',
    n: 0,
    attack: 0,
    defense: 1_000,
    max_hp: 1_000,
    crit_rate: 0,
    speed: 30,
    encounterId: 'EN-F1',
  });
  const result = simulateBattle(content, player, enemy, 'phase-shield-under-new-ordinary-shield', { roundLimit: 1 });
  const crossing = result.frames.find(frame => frame.kind === 'damage' && frame.source === 'RKF05-TRAVEL-NEXT-STRIKE');
  const newOrdinaryShield = result.frames.find(frame => frame.kind === 'shield' && frame.source === 'RKF01-BASIC-SHIELD');
  const criticalHit = result.frames.find(frame =>
    frame.kind === 'damage' && frame.source === 'RKF08-BASIC-DAMAGE' && frame.round === 1);
  const breaks = result.frames.filter(frame => frame.kind === 'status' && frame.text.includes('二阶护罩破开'));

  assert.ok(crossing);
  assert.equal(crossing.enemy.hp, 500);
  assert.equal(counter(crossing, 'enemy', 'EN-F1-PHASE-GATE').value, 220);
  assert.ok(newOrdinaryShield, 'the faster boss gains an ordinary shield after the gate opens');
  assert.equal(newOrdinaryShield.amount, 100);
  assert.equal(newOrdinaryShield.enemy.shield, 320);
  assert.equal(counter(newOrdinaryShield, 'enemy', 'EN-F1-PHASE-GATE').value, 220);
  assert.ok(criticalHit);
  assert.match(criticalHit.text, /暴击/);
  assert.equal(criticalHit.amount, 150, 'the critical hit consumes 100 ordinary shield and 50 phase shield');
  assert.equal(criticalHit.enemy.shield, 170);
  assert.equal(counter(criticalHit, 'enemy', 'EN-F1-PHASE-GATE').name, '二阶护罩');
  assert.equal(counter(criticalHit, 'enemy', 'EN-F1-PHASE-GATE').value, 170);
  assert.equal(breaks.length, 0, 'crossing the normal shield alone does not expose the boss');
});

test('poison and burn pass through a new ordinary shield before breaking the phase shield once', () => {
  for (const { method, status, dotSource } of [
    { method: 'RKF06', status: 'poison', dotSource: 'RKF06-BASIC-POISON' },
    { method: 'RKF09', status: 'burn', dotSource: 'RKF09-BASIC-BURN' },
  ]) {
    const content = patchContent(entities => {
      entities.find(item => item.id === 'RULES').rage.opening = 0;
      entities.find(item => item.id === 'EN-F1').method = 'RKF01';
      entities.find(item => item.id === 'EN-F1').phase_gate.shield_hp_ratio = 0.22;
      const methodEntity = entities.find(item => item.id === method);
      methodEntity.actions.basic.effects.find(effect => effect.id === `${method}-BASIC-DAMAGE`)
        .params.attack_ratio = 0.011;
      methodEntity.actions.basic.effects.find(effect => effect.id === dotSource)
        .params.attack_ratio_per_stack = 0.12;
    });
    const player = makeLoadout(method, [], {
      attack: 3_000,
      defense: 0,
      max_hp: 10_000,
      crit_rate: 0,
      speed: 20,
      firstStrike: 5_500,
    });
    const enemy = makeLoadout('RKF01', [], {
      name: '雷劫化身',
      n: 0,
      attack: 0,
      defense: 1_000,
      max_hp: 1_000,
      crit_rate: 0,
      speed: 30,
      encounterId: 'EN-F1',
    });
    const result = simulateBattle(content, player, enemy, `phase-gate-${status}-through-stacked-shields`, { roundLimit: 2 });
    const crossing = result.frames.find(frame => frame.kind === 'damage' && frame.source === 'RKF05-TRAVEL-NEXT-STRIKE');
    const newOrdinaryShield = result.frames.find(frame => frame.kind === 'shield' && frame.source === 'RKF01-BASIC-SHIELD');
    const basicHit = result.frames.find(frame =>
      frame.kind === 'damage' && frame.source === `${method}-BASIC-DAMAGE` && frame.round === 1);
    const dotHit = result.frames.find(frame => frame.kind === 'dot' && frame.source === dotSource && frame.round === 1);
    const openings = result.frames.filter(frame => frame.kind === 'status' && frame.text.includes('半血劫门开启'));
    const breaks = result.frames.filter(frame => frame.kind === 'status' && frame.text.includes('二阶护罩破开'));

    assert.ok(crossing);
    assert.equal(crossing.enemy.hp, 500);
    assert.equal(counter(crossing, 'enemy', 'EN-F1-PHASE-GATE').value, 220);
    assert.ok(newOrdinaryShield);
    assert.equal(newOrdinaryShield.enemy.shield, 320);
    assert.equal(counter(newOrdinaryShield, 'enemy', 'EN-F1-PHASE-GATE').value, 220);
    assert.ok(basicHit, `${status} is applied by a real basic hit`);
    assert.equal(basicHit.enemy.shield, 317, 'the small direct hit only reduces the ordinary pool');
    assert.equal(counter(basicHit, 'enemy', 'EN-F1-PHASE-GATE').value, 220);
    assert.ok(dotHit, `${status} resolves as a real damage-over-time frame`);
    assert.equal(dotHit.amount, 360);
    assert.equal(dotHit.enemy.shield, 0, 'the tick consumes the remaining ordinary shield, then the phase shield');
    assert.equal(dotHit.enemy.hp, 457, 'damage beyond both shields spills into health');
    assert.equal(counter(dotHit, 'enemy', 'EN-F1-PHASE-GATE').name, '破门窗口');
    assert.equal(counter(dotHit, 'enemy', 'EN-F1-PHASE-GATE').value, 1);
    assert.equal(openings.length, 1);
    assert.equal(breaks.length, 1, 'later poison or burn ticks cannot break or open the one-time phase shield again');
    assert.equal(lastCounter(result, 'enemy', 'EN-F1-PHASE-GATE').name, '破门窗口');
  }
});

test('a multi-segment rage can open and break the half-health gate without retriggering it', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const gate = entities.find(item => item.id === 'EN-F1').phase_gate;
    gate.shield_hp_ratio = 0.45;
    gate.exposure_damage_ratio = 1.5;
    const thunder = entities.find(item => item.id === 'RKF07');
    thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-DAMAGE').params = {
      ...thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-DAMAGE').params,
      attack_ratio: 0.5,
      segments: 2,
    };
    thunder.actions.rage.effects.find(effect => effect.id === 'RKF07-RAGE-CHAIN').params.chance = 0;
    thunder.actions.basic.effects.find(effect => effect.id === 'RKF07-BASIC-DAMAGE').params.attack_ratio = 0.4;
    thunder.actions.basic.effects.find(effect => effect.id === 'RKF07-BASIC-CHAIN').params.chance = 0;
  });
  const player = makeLoadout('RKF07', [], {
    attack: 1_000,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
  });
  const enemy = makeBoss('EN-F1', { max_hp: 1_000, attack: 0, defense: 0, speed: 1 });
  const result = simulateBattle(content, player, enemy, 'multi-segment-half-gate', { roundLimit: 2 });
  const openings = result.frames.filter(frame => frame.kind === 'status' && frame.text.includes('半血劫门开启'));
  const breaks = result.frames.filter(frame => frame.kind === 'status' && frame.text.includes('二阶护罩破开'));
  const rageHits = result.frames.filter(frame =>
    frame.kind === 'damage' && frame.actor === 'player' && frame.source === 'RKF07-RAGE-DAMAGE');
  const followup = result.frames.find(frame =>
    frame.kind === 'damage' && frame.actor === 'player' &&
    frame.source === 'RKF07-BASIC-DAMAGE' && frame.round === 2);

  assert.equal(openings.length, 1);
  assert.equal(breaks.length, 1);
  assert.equal(rageHits.length, 2, 'the locked rage resolves both base segments');
  assert.equal(rageHits[0].enemy.hp, 500, 'the first segment stops exactly at the half-health line');
  assert.equal(rageHits[0].enemy.shield, 450);
  assert.equal(rageHits[1].enemy.hp, 450);
  assert.equal(rageHits[1].enemy.shield, 0, 'the second segment breaks the gate shield');
  assert.equal(counter(rageHits[1], 'enemy', 'EN-F1-PHASE-GATE').name, '破门窗口');
  assert.ok(followup, 'the next-round basic lands during the open-gate window');
  assert.equal(followup.enemy.hp, 0, 'the exposure bonus makes this hit lethal; base damage alone would leave 50 HP');
  assert.equal(result.outcome, 'player');
});

test('breaking the phase shield exposes the boss for a bounded round window, then expires', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
    const gate = entities.find(item => item.id === 'EN-F1').phase_gate;
    gate.shield_hp_ratio = 0.08;
    gate.exposure_damage_ratio = 1.5;
  });
  const player = makeLoadout('RKF08', [], {
    attack: 120,
    defense: 0,
    max_hp: 10_000,
    speed: 30,
    firstStrike: 600,
  });
  const enemy = makeBoss('EN-F1', { max_hp: 1_000, attack: 0, speed: 1 });
  const result = simulateBattle(content, player, enemy, 'phase-gate-opening-window', { roundLimit: 4 });
  const broken = result.frames.find(frame => frame.kind === 'status' && frame.text.includes('二阶护罩破开'));
  const expiry = result.frames.find(frame => frame.kind === 'status' && frame.text.includes('破门窗口结束'));

  assert.ok(broken, 'the finite shield can be depleted by ordinary attacks');
  assert.equal(broken.round, 1);
  assert.ok(expiry, 'the exposure ends after the configured extra round');
  assert.equal(expiry.round, 3);
  assert.equal(lastCounter(result, 'enemy', 'EN-F1-PHASE-GATE').name, '劫门已渡');
  assert.equal(lastCounter(result, 'enemy', 'EN-F1-PHASE-GATE').value, 0);
  assert.equal(result.frames.filter(frame => frame.kind === 'status' && frame.text.includes('二阶护罩破开')).length, 1);
  assert.equal(result.frames.filter(frame => frame.kind === 'status' && frame.text.includes('半血劫门开启')).length, 1);
});

test('phase gate validation rejects non-final, repeatable, and unbounded configurations', () => {
  const player = makeLoadout('RKF08');
  const enemy = makeBoss('EN-F1');
  const invalidGates = [
    { kind: 'half_health_gate', shield_hp_ratio: 0, exposure_damage_ratio: 1.25, exposure_rounds: 1 },
    { kind: 'half_health_gate', shield_hp_ratio: 0.2, exposure_damage_ratio: 1, exposure_rounds: 1 },
    { kind: 'half_health_gate', shield_hp_ratio: 0.2, exposure_damage_ratio: 1.25, exposure_rounds: 3 },
    { kind: 'half_health_gate', shield_hp_ratio: 0.2, exposure_damage_ratio: 1.25, exposure_rounds: 1, extra: true },
  ];
  for (const gate of invalidGates) {
    const content = patchContent(entities => {
      entities.find(item => item.id === 'EN-F1').phase_gate = gate;
    });
    assert.throws(() => simulateBattle(content, player, enemy, `invalid-phase-gate-${JSON.stringify(gate)}`),
      /enemy phase gate/i);
  }
  const foreign = patchContent(entities => {
    entities.find(item => item.id === 'EN-A2-B1').phase_gate = {
      kind: 'half_health_gate',
      shield_hp_ratio: 0.2,
      exposure_damage_ratio: 1.25,
      exposure_rounds: 1,
    };
  });
  assert.throws(() => simulateBattle(foreign, player, makeBoss('EN-A2-B1'), 'phase-gate-owner'),
    /Unsupported enemy phase gate owner/);
});
