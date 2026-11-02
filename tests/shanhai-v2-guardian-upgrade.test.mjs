import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { loadContent } from '../tools/content-kit/src/loader.mjs';

function buildModule(name) {
  const buildRoot = process.env.SHANHAI_BUILD_DIR
    ? resolve(process.env.SHANHAI_BUILD_DIR)
    : resolve(new URL('../build', import.meta.url).pathname);
  return pathToFileURL(resolve(buildRoot, 'shanhai', name)).href;
}

const [{ contentFromEntities }, { simulateBattle }] = await Promise.all([
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

function patchContent(edit = () => {}) {
  const entities = structuredClone(baseContent.entities);
  edit(entities);
  return contentFromEntities(entities, `${baseContent.version}-guardian-upgrade`);
}

function makeLoadout(method, overrides = {}) {
  const {
    name = method,
    n = 2,
    companions = [],
    artifacts = [],
    hp,
    ...stats
  } = overrides;
  return {
    name,
    method,
    n,
    talents: [],
    companions: [...companions],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
  };
}

function enemy(overrides = {}) {
  return makeLoadout('RKF06', {
    attack: 0,
    speed: 1,
    max_hp: 1_000_000_000,
    ...overrides,
  });
}

function outputFrame(result, source, kind, predicate = () => true) {
  const frame = result.frames.find(item => item.source === source && item.kind === kind && predicate(item));
  assert.ok(frame, `expected ${kind} output from ${source}`);
  return frame;
}

function companionResult(content, method, companion, tier, overrides = {}, seed = 'guardian-output') {
  return simulateBattle(
    content,
    makeLoadout(method, { n: tier, companions: [companion], speed: 100, ...overrides }),
    enemy(),
    `${seed}-${tier}`,
    { roundLimit: 2 },
  );
}

test('ordinary guardian damage, shield, healing, and rage values double from master tier n3', () => {
  const damage2 = companionResult(baseContent, 'RKF01', 'RKF05', 2);
  const damage3 = companionResult(baseContent, 'RKF01', 'RKF05', 3);
  const damage2Frame = outputFrame(damage2, 'RKF05-COMPANION-ASSIST', 'damage');
  const damage3Frame = outputFrame(damage3, 'RKF05-COMPANION-ASSIST', 'damage');
  assert.ok(damage2Frame.amount > 0);
  assert.ok(Math.abs(damage3Frame.amount - damage2Frame.amount * 2) < 1e-8,
    'n3 doubles the resolved companion damage');

  const shieldContent = patchContent(entities => {
    entities.find(item => item.id === 'RKF05').companion = {
      name: '护盾测试灵使',
      quick: '命中后造盾。',
      trigger: 'hit',
      effect: { kind: 'shield', value: 0.05 },
      pair_bonuses: [],
    };
  });
  const shield2 = companionResult(shieldContent, 'RKF02', 'RKF05', 2);
  const shield3 = companionResult(shieldContent, 'RKF02', 'RKF05', 3);
  assert.equal(outputFrame(shield2, 'RKF05-COMPANION-ASSIST', 'shield').amount, 50);
  assert.equal(outputFrame(shield3, 'RKF05-COMPANION-ASSIST', 'shield').amount, 100);

  const heal2 = companionResult(baseContent, 'RKF06', 'RKF03', 2, { hp: 500 });
  const heal3 = companionResult(baseContent, 'RKF06', 'RKF03', 3, { hp: 500 });
  assert.equal(outputFrame(heal2, 'RKF03-COMPANION-ASSIST', 'heal').amount, 40);
  assert.equal(outputFrame(heal3, 'RKF03-COMPANION-ASSIST', 'heal').amount, 80);

  const rageContent = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
  });
  const rage2 = companionResult(rageContent, 'RKF01', 'RKF02', 2);
  const rage3 = companionResult(rageContent, 'RKF01', 'RKF02', 3);
  assert.equal(outputFrame(rage2, 'RKF02-COMPANION-ASSIST', 'rage').amount, 5);
  assert.equal(outputFrame(rage3, 'RKF02-COMPANION-ASSIST', 'rage').amount, 10);
  const rageAssistCount = (result) => result.frames.filter(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF02-COMPANION').length;
  assert.ok(rageAssistCount(rage2) > 0);
  assert.equal(rageAssistCount(rage3), rageAssistCount(rage2),
    'tier scaling leaves companion trigger counts and reaction limits unchanged');
});

test('dual-method pair bonuses double poison and burn layers without doubling their use count', () => {
  const poison2 = companionResult(baseContent, 'RKF03', 'RKF06', 2, { hp: 500 });
  const poison3 = companionResult(baseContent, 'RKF03', 'RKF06', 3, { hp: 500 });
  const poisonFrame2 = outputFrame(poison2, 'RKF06-COMPANION-ASSIST', 'status', frame =>
    frame.text.includes('获得poison'));
  const poisonFrame3 = outputFrame(poison3, 'RKF06-COMPANION-ASSIST', 'status', frame =>
    frame.text.includes('获得poison'));
  assert.equal(poisonFrame2.amount, 1);
  assert.equal(poisonFrame3.amount, 2);
  const poisonAssistCount = (result) => result.frames.filter(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF06-COMPANION').length;
  assert.ok(poisonAssistCount(poison2) > 0);
  assert.equal(poisonAssistCount(poison3), poisonAssistCount(poison2));

  const burn2 = companionResult(baseContent, 'RKF01', 'RKF04', 2, { defense: 100 });
  const burn3 = companionResult(baseContent, 'RKF01', 'RKF04', 3, { defense: 100 });
  const burnFrame2 = outputFrame(burn2, 'RKF04-COMPANION-ASSIST', 'status', frame =>
    frame.text.includes('获得burn'));
  const burnFrame3 = outputFrame(burn3, 'RKF04-COMPANION-ASSIST', 'status', frame =>
    frame.text.includes('获得burn'));
  assert.equal(burnFrame2.amount, 1);
  assert.equal(burnFrame3.amount, 2);
  assert.match(burn3.frames.find(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF04-COMPANION').text, /合练/);
});

test('alternating guardian effects scale both branches, and n0/n2 remain unchanged', () => {
  const content = patchContent(entities => {
    const rage = entities.find(item => item.id === 'RULES').rage;
    rage.opening = 0;
    rage.basic_completed = 0;
    rage.round_end = 0;
  });
  const n0 = companionResult(content, 'RKF01', 'RKF10', 0, {}, 'guardian-alternate');
  const n2 = companionResult(content, 'RKF01', 'RKF10', 2, {}, 'guardian-alternate');
  const n3 = companionResult(content, 'RKF01', 'RKF10', 3, {}, 'guardian-alternate');
  const shield0 = outputFrame(n0, 'RKF10-COMPANION-ASSIST', 'shield');
  const shield2 = outputFrame(n2, 'RKF10-COMPANION-ASSIST', 'shield');
  const shield3 = outputFrame(n3, 'RKF10-COMPANION-ASSIST', 'shield');
  assert.equal(shield0.amount, 25);
  assert.equal(shield2.amount, 25);
  assert.equal(shield3.amount, 50);

  const damage2 = outputFrame(n2, 'RKF10-COMPANION-ASSIST', 'damage');
  const damage3 = outputFrame(n3, 'RKF10-COMPANION-ASSIST', 'damage');
  assert.ok(damage2.amount > 0);
  assert.ok(Math.abs(damage3.amount - damage2.amount * 2) < 1e-8,
    'n3 doubles the resolved alternating damage branch');
  const assistCount = (result) => result.frames.filter(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF10-COMPANION').length;
  assert.equal(assistCount(n3), assistCount(n2),
    'doubling does not add a reaction or consume the alternate branch twice');
});

test('n3 companion behavior is enemy-symmetric and deterministic', () => {
  const content = patchContent(entities => {
    entities.find(item => item.id === 'RULES').rage.opening = 0;
  });
  const player = makeLoadout('RKF01', { n: 3, companions: ['RKF05'], speed: 100 });
  const rival = makeLoadout('RKF01', { n: 3, companions: ['RKF05'], speed: 1 });
  const first = simulateBattle(content, player, rival, 'guardian-enemy-symmetry', { roundLimit: 1 });
  const replay = simulateBattle(content, player, rival, 'guardian-enemy-symmetry', { roundLimit: 1 });
  assert.deepEqual(replay.frames, first.frames);
  const playerAssist = outputFrame(first, 'RKF05-COMPANION-ASSIST', 'damage', frame => frame.actor === 'player');
  const enemyAssist = first.frames.find(frame => frame.source === 'RKF05-COMPANION-ASSIST' &&
    frame.kind === 'damage' && frame.actor === 'enemy');
  assert.ok(enemyAssist, 'the opposing tier-three companion resolves through the same path');
  assert.equal(playerAssist.amount, 44);
  assert.equal(enemyAssist.amount, 44);
});
