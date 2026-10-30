import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadContent } from '../tools/content-kit/src/loader.mjs';

function buildModule(name) {
  const buildRoot = process.env.SHANHAI_BUILD_DIR
    ? resolve(process.env.SHANHAI_BUILD_DIR)
    : resolve(new URL('../build', import.meta.url).pathname);
  return pathToFileURL(resolve(buildRoot, 'shanhai', name)).href;
}

const [{ contentFromEntities }, { calculateStats, simulateBattle }] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
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

function makeLoadout(method, overrides = {}) {
  const {
    name = method,
    n = 4,
    talents = [],
    artifacts = [],
    companions,
    hp,
    preparation,
    ...stats
  } = overrides;
  return {
    name,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    companions: companions ?? [],
    ...(hp === undefined ? {} : { hp }),
    ...(preparation === undefined ? {} : { preparation }),
  };
}

function makeEnemy(overrides = {}) {
  return makeLoadout('RKF06', {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function patchContent(edit) {
  const entities = structuredClone(baseContent.entities);
  edit(entities);
  return contentFromEntities(entities, `${baseContent.version}-v2-overhaul-test`);
}

function insightEffect(entities, id) {
  const rules = entities.find(item => item.id === 'RULES');
  return rules.insights.find(insight => insight.id === id).effects[0];
}

function findFrame(result, predicate, message = 'expected battle frame was not found') {
  const found = result.frames.find(predicate);
  assert.ok(found, message);
  return found;
}

function sourceFrames(result, source) {
  return result.frames.filter(frame => frame.source === source);
}

function contribution(result, id) {
  const found = result.contributions.find(item => item.id === id);
  assert.ok(found, `expected contribution ${id}`);
  return found;
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

test('rage chain spends only rage gained by each living rage action and stops at three', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const hitRage = insightEffect(entities, 'V2-J3-A');
    hitRage.params.amount = 8;
  });
  const player = makeLoadout('RKF09', {
    speed: 10,
    max_hp: 10_000,
    talents: ['V2-J3-A'],
    artifacts: [
      { id: 'RL05', stacks: 1 },
      { id: 'RC10', stacks: 1 },
      { id: 'RR01', stacks: 1 },
      { id: 'RR08', stacks: 1 },
    ],
  });
  const enemy = makeEnemy({ attack: 100, speed: 50 });
  const first = simulateBattle(content, player, enemy, 'v2-overhaul-rage-chain', { roundLimit: 1 });
  const replay = simulateBattle(content, player, enemy, 'v2-overhaul-rage-chain', { roundLimit: 1 });
  assert.deepEqual(replay.frames, first.frames);

  const rageActions = first.frames.filter(frame => frame.round === 1 && frame.kind === 'action' &&
    frame.actor === 'player' && frame.text.includes('怒技'));
  assert.equal(rageActions.length, 3);
  const cues = first.frames.filter(frame => frame.cue?.kind === 'rage_chain' && frame.cue.owner === 'player');
  assert.deepEqual(cues.map(frame => frame.cue.count), [2, 3]);
  for (const cue of cues) {
    assert.match(cue.text, /怒技连斩/);
    const cueIndex = first.frames.indexOf(cue);
    assert.ok(first.frames.slice(cueIndex + 1).some(frame => frame.kind === 'action' &&
      frame.actor === 'player' && frame.text.includes('怒技')));
  }
  assert.equal(first.frames.some(frame => frame.cue?.kind === 'rage_chain' && frame.cue.count === 4), false);

  // The faster enemy gives the player an unrelated 10 rage before its turn.
  // Each completed RKF09 rage action makes 104 new rage from 3 hit-rage gains,
  // RC10's core refund, RL05's return, and RR01's first-hit gain. The first
  // two action-local amounts are consumed; the old 10 and third action's 104
  // remain for the ordinary round-end settlement, along with round-end +10,
  // the incoming direct hit's base +5, and RR08's +10.
  const settled = findFrame(first, frame => frame.round === 1 && frame.kind === 'rage' &&
    frame.source === 'RULES-RAGE-SETTLE' && frame.actor === 'player');
  near(settled.amount, 129);
  assert.ok(contribution(first, 'RC10').rage >= 60, 'the core refund contributes to all three rage actions');
  assert.ok(contribution(first, 'RR01').rage >= 30, 'first base hit rage contributes to all three rage actions');

  const enemyLoadout = makeLoadout('RKF09', {
    speed: 50,
    max_hp: 10_000,
    talents: ['V2-J3-A'],
    artifacts: [
      { id: 'RL05', stacks: 1 },
      { id: 'RC10', stacks: 1 },
      { id: 'RR01', stacks: 1 },
    ],
  });
  const enemyChain = simulateBattle(content, makeEnemy({ speed: 10, max_hp: 1_000_000 }),
    enemyLoadout, 'v2-overhaul-enemy-rage-chain', { roundLimit: 1 });
  assert.deepEqual(
    enemyChain.frames.filter(frame => frame.cue?.kind === 'rage_chain').map(frame => [
      frame.cue.owner,
      frame.cue.count,
    ]),
    [['enemy', 2], ['enemy', 3]],
  );
});

test('a forced next basic prevents a rage chain even when rage returns refill the cap', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    entities.find(item => item.id === 'RL05').effects[0].params.amount = 100;
  });
  const result = simulateBattle(content, makeLoadout('RKF02', {
    artifacts: [{ id: 'RL05', stacks: 1 }, { id: 'RC10', stacks: 1 }],
  }), makeEnemy(), 'v2-overhaul-forced-basic', { roundLimit: 2 });
  assert.equal(result.frames.filter(frame => frame.kind === 'action' && frame.actor === 'player' && frame.text.includes('怒技')).length, 1);
  assert.equal(result.frames.some(frame => frame.cue?.kind === 'rage_chain'), false);
  assert.ok(result.frames.some(frame => frame.round === 2 && frame.kind === 'action' &&
    frame.actor === 'player' && frame.text.includes('普攻')));
});

test('rage generated only by a rage echo waits for round end and cannot echo-chain', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    const extraInsight = insightEffect(entities, 'V2-J2-C');
    extraInsight.params = { build: 'hit_rage', amount: 20 };
  });
  const result = simulateBattle(content, makeLoadout('RKF09', {
    talents: ['V2-J2-C', 'V2-J3-B'],
    artifacts: [{ id: 'RC10', stacks: 1 }],
  }), makeEnemy(), 'v2-overhaul-echo-rage', { roundLimit: 1 });
  assert.equal(result.frames.some(frame => frame.cue?.kind === 'rage_chain'), false);
  assert.equal(result.frames.filter(frame => frame.kind === 'action' && frame.actor === 'player' && frame.text.includes('怒技')).length, 1);
  assert.ok(contribution(result, 'V2-J2-C').rage >= 120);
  const settled = findFrame(result, frame => frame.round === 1 && frame.source === 'RULES-RAGE-SETTLE' && frame.actor === 'player');
  near(settled.amount, 150);
});

test('companion output kinds resolve as real effects with one source-attributed assist per action', () => {
  const outputs = [
    { kind: 'damage', value: 0.2, frameKind: 'damage' },
    { kind: 'shield', value: 0.05, frameKind: 'shield' },
    { kind: 'heal', value: 0.05, frameKind: 'heal' },
    { kind: 'rage', value: 7, frameKind: 'rage' },
    { kind: 'poison', value: 1, frameKind: 'status' },
    { kind: 'burn', value: 1, frameKind: 'status' },
  ];
  for (const output of outputs) {
    const content = patchContent(entities => {
      const companion = entities.find(item => item.id === 'RKF02').companion;
      companion.trigger = 'hit';
      companion.effect = { kind: output.kind, value: output.value };
      companion.pair_bonuses = [];
    });
    const result = simulateBattle(content, makeLoadout('RKF05', {
      companions: ['RKF02'],
      hp: 500,
    }), makeEnemy(), `v2-overhaul-assist-${output.kind}`, { roundLimit: 1 });
    const cue = findFrame(result, frame => frame.cue?.kind === 'companion_assist' &&
      frame.cue.owner === 'player' && frame.cue.sourceId === 'RKF02-COMPANION');
    assert.match(cue.text, /伴生协力/);
    assert.equal(result.frames.filter(frame => frame.kind === 'reaction' &&
      frame.cue?.kind === 'companion_assist' &&
      frame.cue.sourceId === 'RKF02-COMPANION').length, 1);
    const outputFrame = findFrame(result, frame => frame.kind === output.frameKind &&
      frame.source === 'RKF02-COMPANION-ASSIST', `${output.kind} companion output did not occur`);
    assert.equal(outputFrame.cue?.kind, 'companion_assist');
    const credited = contribution(result, 'RKF02-COMPANION');
    assert.ok(credited.triggers > 0);
    if (output.kind === 'damage') assert.ok(credited.damage > 0);
    if (output.kind === 'shield') assert.ok(credited.shield > 0);
    if (output.kind === 'heal') assert.ok(credited.healing > 0);
    if (output.kind === 'rage') assert.equal(credited.rage, output.value);
  }
});

test('RKF03 and RKF06 companion pair bonuses work in either main-method direction', () => {
  const healToPoison = simulateBattle(baseContent, makeLoadout('RKF03', {
    companions: ['RKF06'],
    hp: 500,
  }), makeEnemy(), 'v2-overhaul-pair-heal-poison', { roundLimit: 1 });
  const poisonCue = findFrame(healToPoison, frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF06-COMPANION' && frame.cue.owner === 'player');
  assert.match(poisonCue.text, /与回春功合练/);
  assert.ok(findFrame(healToPoison, frame => frame.kind === 'status' &&
    frame.source === 'RKF06-COMPANION-ASSIST').enemy.statuses.poison >= 1);
  assert.ok(contribution(healToPoison, 'RKF06-COMPANION').triggers > 0);

  const poisonToHeal = simulateBattle(baseContent, makeLoadout('RKF06', {
    companions: ['RKF03'],
    hp: 500,
  }), makeEnemy(), 'v2-overhaul-pair-poison-heal', { roundLimit: 1 });
  const healCue = findFrame(poisonToHeal, frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF03-COMPANION' && frame.cue.owner === 'player');
  assert.match(healCue.text, /与五毒经合练/);
  assert.equal(sourceFrames(poisonToHeal, 'RKF03-COMPANION-ASSIST').filter(frame => frame.kind === 'heal').length, 1);
  assert.ok(contribution(poisonToHeal, 'RKF03-COMPANION').healing > 0);
});

test('RKF01 and RKF04 companion pair bonuses cross shield and fire in either direction', () => {
  const shieldToBurn = simulateBattle(baseContent, makeLoadout('RKF01', {
    companions: ['RKF04'],
    defense: 200,
  }), makeEnemy(), 'v2-overhaul-pair-shield-burn', { roundLimit: 1 });
  const burnCue = findFrame(shieldToBurn, frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF04-COMPANION' && frame.cue.owner === 'player');
  assert.match(burnCue.text, /与金刚功合练/);
  assert.ok(findFrame(shieldToBurn, frame => frame.kind === 'status' &&
    frame.source === 'RKF04-COMPANION-ASSIST').enemy.statuses.burn >= 1);
  assert.ok(contribution(shieldToBurn, 'RKF04-COMPANION').triggers > 0);

  const burnToShield = simulateBattle(baseContent, makeLoadout('RKF04', {
    companions: ['RKF01'],
  }), makeEnemy(), 'v2-overhaul-pair-burn-shield', { roundLimit: 1 });
  const shieldCue = findFrame(burnToShield, frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF01-COMPANION' && frame.cue.owner === 'player');
  assert.match(shieldCue.text, /与御火诀合练/);
  assert.ok(sourceFrames(burnToShield, 'RKF01-COMPANION-ASSIST').some(frame =>
    frame.kind === 'shield' && frame.player.shield > 0));
  assert.ok(contribution(burnToShield, 'RKF01-COMPANION').shield > 0);
});

test('enemy-side companions assist their own main fighter when explicitly supplied', () => {
  const enemy = makeLoadout('RKF03', {
    companions: ['RKF06'],
    hp: 5_000,
    max_hp: 10_000,
    speed: 1,
  });
  const result = simulateBattle(baseContent, makeLoadout('RKF05', { max_hp: 1_000_000 }), enemy,
    'v2-overhaul-enemy-companion', { roundLimit: 1 });
  const cue = findFrame(result, frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.owner === 'enemy' && frame.cue.sourceId === 'RKF06-COMPANION');
  assert.match(cue.text, /伴生协力/);
  assert.ok(findFrame(result, frame => frame.kind === 'status' &&
    frame.source === 'RKF06-COMPANION-ASSIST').player.statuses.poison >= 1);
});

test('thunder challenge adds opening rage and 15 percent final max-HP shield only to its enemy', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 50;
  });
  const player = makeLoadout('RKF05', { speed: 20 });
  const ordinary = makeEnemy({ method: 'RKF01', max_hp: 2_000 });
  const challenge = { ...ordinary, thunderChallenge: true };
  const normal = simulateBattle(content, player, ordinary, 'v2-overhaul-normal-enemy', { roundLimit: 1 });
  const tested = simulateBattle(content, player, challenge, 'v2-overhaul-thunder-enemy', { roundLimit: 1 });
  const normalStart = findFrame(normal, frame => frame.kind === 'start');
  const challengeStart = findFrame(tested, frame => frame.kind === 'start');
  near(normalStart.enemy.rage, 50);
  near(challengeStart.enemy.rage, 70);
  assert.equal(sourceFrames(normal, 'THUNDER-CHALLENGE').length, 0);
  const openingShield = findFrame(tested, frame => frame.kind === 'shield' &&
    frame.actor === 'enemy' && frame.source === 'THUNDER-CHALLENGE');
  near(openingShield.amount, calculateStats(content, challenge).max_hp * 0.15);

  const playerFlagOnly = simulateBattle(content, { ...player, thunderChallenge: true }, ordinary,
    'v2-overhaul-player-flag-ignored', { roundLimit: 1 });
  assert.equal(sourceFrames(playerFlagOnly, 'THUNDER-CHALLENGE').length, 0);
  near(findFrame(playerFlagOnly, frame => frame.kind === 'start').player.rage, 50);
});

test('max-stack awakenings resolve every declared effect once on the matching living main action', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RC01').awakening = {
      at_stacks: 5,
      name: '六效觉醒',
      quick: '普攻后执行六项有实际战斗结果的效果。',
      trigger: 'basic',
      effects: [
        { kind: 'damage', value: 0.2 },
        { kind: 'shield', value: 0.1 },
        { kind: 'heal', value: 0.1 },
        { kind: 'rage', value: 7 },
        { kind: 'poison', value: 1 },
        { kind: 'burn', value: 1 },
      ],
    };
  });
  const player = makeLoadout('RKF03', {
    hp: 500,
    artifacts: [{ id: 'RC01', stacks: 5 }],
  });
  const result = simulateBattle(content, player, makeEnemy(), 'v2-overhaul-awakening-effects', { roundLimit: 1 });
  for (let index = 1; index <= 6; index++) {
    assert.ok(sourceFrames(result, `RC01-AWAKENING-${index}`).length > 0, `effect ${index} should resolve`);
  }
  for (const [index, kind] of ['damage', 'shield', 'heal', 'rage', 'status', 'status'].entries()) {
    assert.ok(sourceFrames(result, `RC01-AWAKENING-${index + 1}`).some(frame => frame.kind === kind),
      `awakening effect ${index + 1} must emit its actual ${kind} resolution`);
  }
  assert.ok(sourceFrames(result, 'RC01-AWAKENING-5').some(frame => frame.enemy.statuses.poison > 0));
  assert.ok(sourceFrames(result, 'RC01-AWAKENING-6').some(frame => frame.enemy.statuses.burn > 0));
  assert.ok(contribution(result, 'RC01').damage > 0);
  assert.ok(contribution(result, 'RC01').shield > 0);
  assert.ok(contribution(result, 'RC01').healing > 0);
  assert.equal(contribution(result, 'RC01').rage, 7);
  assert.equal(result.frames.some(frame => frame.cue?.kind === 'companion_assist'), false,
    'awakening output does not borrow companion cues');
});

test('awakenings require max stacks and honor trigger, disabled mode, echo exclusion, and death', () => {
  const awakeningContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 100;
    entities.find(item => item.id === 'RC01').awakening = {
      at_stacks: 5,
      name: '怒技觉醒',
      quick: '怒技后造成派生伤害。',
      trigger: 'rage',
      effects: [{ kind: 'damage', value: 0.2 }],
    };
  });
  const artifactPlayer = makeLoadout('RKF09', {
    talents: ['V2-J3-B'],
    artifacts: [{ id: 'RC01', stacks: 5 }],
  });
  const result = simulateBattle(awakeningContent, artifactPlayer, makeEnemy(),
    'v2-overhaul-awakening-rage-once', { roundLimit: 1 });
  assert.equal(sourceFrames(result, 'RC01-AWAKENING-1').filter(frame => frame.kind === 'damage').length, 1,
    'rage echo cannot repeat awakening effects');

  const belowMax = simulateBattle(awakeningContent, {
    ...artifactPlayer,
    artifacts: [{ id: 'RC01', stacks: 4 }],
  }, makeEnemy(), 'v2-overhaul-awakening-below-max', { roundLimit: 1 });
  assert.equal(sourceFrames(belowMax, 'RC01-AWAKENING-1').length, 0);

  const disabled = simulateBattle(awakeningContent, artifactPlayer, makeEnemy(),
    'v2-overhaul-awakening-disabled', { roundLimit: 1, artifactAwakenings: false });
  assert.equal(sourceFrames(disabled, 'RC01-AWAKENING-1').length, 0);

  const lethalContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 50;
    const artifact = entities.find(item => item.id === 'RC01');
    delete artifact.core_rule;
    artifact.awakening = {
      at_stacks: 5,
      name: '止步觉醒',
      quick: '首项伤害击败敌方后，后续效果不执行。',
      effects: [
        { kind: 'damage', value: 1 },
        { kind: 'shield', value: 0.1 },
      ],
    };
  });
  const lethal = simulateBattle(lethalContent, makeLoadout('RKF03', {
    artifacts: [{ id: 'RC01', stacks: 5 }],
  }), makeEnemy({ hp: 160 }), 'v2-overhaul-awakening-no-post-death', { roundLimit: 1 });
  assert.equal(lethal.outcome, 'player');
  assert.ok(sourceFrames(lethal, 'RC01-AWAKENING-1').length > 0);
  assert.equal(sourceFrames(lethal, 'RC01-AWAKENING-2').length, 0);
});
