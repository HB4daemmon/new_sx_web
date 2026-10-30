import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const combatModule = process.env.SHANHAI_COMBAT_MODULE
  ? pathToFileURL(path.resolve(process.env.SHANHAI_COMBAT_MODULE)).href
  : new URL('../build/shanhai/combat.js', import.meta.url).href;
const contentModule = process.env.SHANHAI_CONTENT_MODULE
  ? pathToFileURL(path.resolve(process.env.SHANHAI_CONTENT_MODULE)).href
  : new URL('../build/shanhai/content.js', import.meta.url).href;
const [{ calculateStats, simulateBattle }, { contentFromEntities }] = await Promise.all([
  import(combatModule),
  import(contentModule),
]);

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const baseContent = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 10_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, overrides = {}) {
  const {
    name = method,
    talents = [],
    artifacts = [],
    n = 4,
    hp,
    companions,
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
    companions: companions ?? [],
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
  return contentFromEntities(entities, baseContent.version);
}

function assistFrames(result, side) {
  return result.frames.filter(frame => frame.source === 'RKF10-COMPANION-ASSIST' &&
    frame.actor === side && ['shield', 'damage'].includes(frame.kind));
}

function contribution(result, id) {
  const found = result.contributions.find(item => item.id === id);
  assert.ok(found, `expected contribution ${id}`);
  return found;
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

function battleStats(content, loadout) {
  const stats = calculateStats(content, loadout);
  for (const effect of content.byId[loadout.method].passives ?? []) {
    if (effect.trigger !== 'battle_start' || effect.operation !== 'modify_stat') continue;
    const stat = effect.params?.stat;
    if (!Object.hasOwn(stats, stat)) continue;
    const amount = effect.params?.amount ?? effect.params?.flat ?? 0;
    stats[stat] = effect.params?.mode === 'percent_add'
      ? stats[stat] * (1 + amount)
      : stats[stat] + amount;
  }
  return stats;
}

function expectedCompanionDamage(content, target, mainMethod = 'RKF05') {
  const attack = battleStats(content, makeLoadout(mainMethod, { companions: ['RKF10'] })).attack;
  const defense = battleStats(content, target).defense;
  const constant = content.rules.combat.direct_defense_constant;
  return 0.25 * attack * constant / (constant + defense);
}

test('RKF10 companion alternates shield, derived damage, shield on a different main method', () => {
  const player = makeLoadout('RKF05', { companions: ['RKF10'] });
  const enemy = makeEnemy();
  const result = simulateBattle(baseContent, player, enemy, 'rkf10-companion-live-cycle', { roundLimit: 3 });
  const replay = simulateBattle(baseContent, player, enemy, 'rkf10-companion-live-cycle', { roundLimit: 3 });
  const actions = result.frames.filter(frame => frame.kind === 'action' && frame.actor === 'player');
  const outputs = assistFrames(result, 'player');

  assert.equal(actions.length, 3);
  assert.equal(result.frames.filter(frame => frame.kind === 'reaction' &&
    frame.cue?.kind === 'companion_assist' && frame.cue.sourceId === 'RKF10-COMPANION' &&
    frame.cue.owner === 'player').length, 3);
  assert.deepEqual(outputs.map(frame => frame.kind), ['shield', 'damage', 'shield']);
  near(outputs[0].amount, 250);
  const derivedDamage = expectedCompanionDamage(baseContent, enemy);
  near(outputs[1].amount, derivedDamage);
  near(outputs[2].amount, 250);
  assert.match(outputs[1].text, new RegExp(`伤害 ${Math.round(derivedDamage)}$`));
  assert.doesNotMatch(outputs[1].text, /暴击/);
  assert.equal(outputs[1].cue?.kind, 'companion_assist');
  near(contribution(result, 'RKF10-COMPANION').damage, derivedDamage);
  assert.equal(contribution(result, 'RKF10-COMPANION').shield, 500);
  assert.deepEqual(result, replay, 'the same seed must reproduce every frame and contribution');
});

test('four learned companions all assist one main hit in acquisition order with separate ledgers', () => {
  const companions = ['RKF02', 'RKF03', 'RKF04', 'RKF06'];
  const content = patchContent(entities => {
    companions.forEach((id, index) => {
      const config = entities.find(entity => entity.id === id).companion;
      config.trigger = 'hit';
      config.effect = { kind: 'damage', value: 0.08 + index * 0.03 };
      config.pair_bonuses = [];
      delete config.alternate_effect;
    });
  });
  const player = makeLoadout('RKF05', { companions });
  const enemy = makeEnemy();
  const result = simulateBattle(content, player, enemy, 'four-live-companions', { roundLimit: 1 });
  const replay = simulateBattle(content, player, enemy, 'four-live-companions', { roundLimit: 1 });
  const cues = result.frames.filter(frame => frame.kind === 'reaction' &&
    frame.cue?.kind === 'companion_assist' && frame.cue.owner === 'player');

  assert.deepEqual(cues.map(frame => frame.cue.sourceId), companions.map(id => `${id}-COMPANION`));
  for (const id of companions) {
    const source = `${id}-COMPANION-ASSIST`;
    assert.ok(result.frames.some(frame => frame.source === source && frame.kind === 'damage'),
      `${id} did not produce its authored companion damage`);
    const ledger = contribution(result, `${id}-COMPANION`);
    assert.equal(ledger.triggers, 1);
    assert.ok(ledger.damage > 0, `${id} was omitted from the independent damage ledger`);
  }
  assert.deepEqual(result, replay, 'multi-companion frames and ledgers must replay deterministically');
});

test('combat rejects malformed, duplicate, main-method, unknown, and legacy companion fields', () => {
  for (const companions of [
    null,
    [null],
    [7],
    ['RKF05'],
    ['RKF02', 'RKF02'],
    ['NOT-A-METHOD'],
  ]) {
    const player = makeLoadout('RKF05');
    player.companions = companions;
    assert.throws(() => simulateBattle(baseContent, player, makeEnemy(), 'invalid-companion-list'), /companion|method/i);
  }
  const legacy = makeLoadout('RKF05');
  legacy.companion = 'RKF02';
  assert.throws(() => simulateBattle(baseContent, legacy, makeEnemy(), 'legacy-companion-field'), /single companion/i);
});

test('each alternating companion keeps its own output state', () => {
  const content = patchContent(entities => {
    const first = entities.find(entity => entity.id === 'RKF10').companion;
    first.trigger = 'hit';
    first.effect = { kind: 'shield', value: 0.02 };
    first.alternate_effect = { kind: 'damage', value: 0.25 };
    first.pair_bonuses = [];

    const second = entities.find(entity => entity.id === 'RKF09').companion;
    second.trigger = 'hit';
    second.effect = { kind: 'rage', value: 3 };
    second.alternate_effect = { kind: 'shield', value: 0.01 };
    second.pair_bonuses = [];
  });
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', { companions: ['RKF10', 'RKF09'], max_hp: 1_000_000 }),
    makeEnemy(),
    'independent-companion-alternation',
    { roundLimit: 3 },
  );
  const outputs = id => result.frames.filter(frame =>
    frame.source === `${id}-COMPANION-ASSIST` && ['shield', 'damage', 'rage'].includes(frame.kind));
  assert.deepEqual(outputs('RKF10').map(frame => frame.kind), ['shield', 'damage', 'shield']);
  assert.deepEqual(outputs('RKF09').map(frame => frame.kind), ['rage', 'shield', 'rage']);
  assert.equal(contribution(result, 'RKF10-COMPANION').triggers, 3);
  assert.equal(contribution(result, 'RKF09-COMPANION').triggers, 3);
});

test('each fighter has an independent companion cycle, including a full-shield output', () => {
  const bothSides = simulateBattle(
    baseContent,
    makeLoadout('RKF05', { companions: ['RKF10'], max_hp: 1_000_000_000 }),
    makeLoadout('RKF05', { companions: ['RKF10'], max_hp: 1_000_000_000 }),
    'rkf10-companion-side-cycles',
    { roundLimit: 3 },
  );
  assert.deepEqual(assistFrames(bothSides, 'player').map(frame => frame.kind), ['shield', 'damage', 'shield']);
  assert.deepEqual(assistFrames(bothSides, 'enemy').map(frame => frame.kind), ['shield', 'damage', 'shield']);

  const fullShieldContent = patchContent(entities => {
    const insight = entities.find(entity => entity.id === 'RULES').insights.find(item => item.id === 'V2-J4-A');
    insight.effects[0].params = { build: 'wealth_shield', base_shield: 10_000, shield_per_coin: 0 };
  });
  const fullShield = simulateBattle(
    fullShieldContent,
    makeLoadout('RKF05', { companions: ['RKF10'], talents: ['V2-J4-A'] }),
    makeEnemy(),
    'rkf10-companion-full-shield',
    { roundLimit: 2 },
  );
  const outputFrames = assistFrames(fullShield, 'player');
  assert.deepEqual(outputFrames.map(frame => frame.kind), ['shield', 'damage']);
  near(outputFrames[0].amount, 0);
  near(outputFrames[1].amount, expectedCompanionDamage(fullShieldContent, makeEnemy()));
  near(calculateStats(fullShieldContent, makeLoadout('RKF05', {
    companions: ['RKF10'],
    talents: ['V2-J4-A'],
  })).max_hp, 10_000);
});

test('a selected pair bonus does not advance RKF10 companion alternation', () => {
  const content = patchContent(entities => {
    const companion = entities.find(entity => entity.id === 'RKF10').companion;
    companion.trigger = 'hit';
    companion.effect = { kind: 'shield', value: 0.01 };
    companion.alternate_effect = { kind: 'damage', value: 0.25 };
    companion.pair_bonuses = [{
      with: 'RKF03',
      trigger: 'heal',
      effect: { kind: 'rage', value: 7 },
    }];
  });
  const result = simulateBattle(
    content,
    makeLoadout('RKF03', { companions: ['RKF06', 'RKF10'], hp: 9_999 }),
    makeEnemy(),
    'rkf10-companion-pair-does-not-advance',
    { roundLimit: 3 },
  );
  const assistKinds = result.frames.filter(frame => frame.source === 'RKF10-COMPANION-ASSIST' &&
    frame.actor === 'player' && ['rage', 'shield', 'damage'].includes(frame.kind))
    .map(frame => frame.kind);

  assert.deepEqual(assistKinds, ['rage', 'shield', 'damage']);
  assert.equal(result.frames.filter(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF10-COMPANION' && frame.text.includes('合练')).length, 1);
  assert.equal(result.frames.filter(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF06-COMPANION' && frame.text.includes('合练')).length, 1,
  'the second companion applies its own RKF03 pair bonus on the same action');
  near(result.frames.find(frame => frame.source === 'RKF10-COMPANION-ASSIST' && frame.kind === 'damage').amount,
    expectedCompanionDamage(content, makeEnemy(), 'RKF03'));
  assert.ok(contribution(result, 'RKF06-COMPANION').triggers > 0);
});

test('a lethal first companion stops later companions on that main action', () => {
  const content = patchContent(entities => {
    const lethal = entities.find(entity => entity.id === 'RKF02').companion;
    lethal.trigger = 'hit';
    lethal.effect = { kind: 'damage', value: 100 };
    lethal.pair_bonuses = [];
    const later = entities.find(entity => entity.id === 'RKF03').companion;
    later.trigger = 'hit';
    later.effect = { kind: 'rage', value: 12 };
    later.pair_bonuses = [];
  });
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', { companions: ['RKF02', 'RKF03'], attack: 1 }),
    makeEnemy({ max_hp: 50, defense: 0 }),
    'companion-death-truncation',
    { roundLimit: 1 },
  );
  assert.ok(result.frames.some(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF02-COMPANION'));
  assert.equal(result.frames.some(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF03-COMPANION'), false);
  assert.equal(contribution(result, 'RKF03-COMPANION').triggers, 0);
});

test('dead fighters and actions with no effective hit do not trigger or recurse companion output', () => {
  const dead = simulateBattle(
    baseContent,
    makeLoadout('RKF05', { companions: ['RKF10'], hp: 0 }),
    makeEnemy(),
    'rkf10-companion-dead-owner',
    { roundLimit: 1 },
  );
  assert.equal(dead.frames.some(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF10-COMPANION'), false);

  const noHit = simulateBattle(
    baseContent,
    makeLoadout('RKF05', { companions: ['RKF10'], attack: 0 }),
    makeEnemy(),
    'rkf10-companion-no-effective-hit',
    { roundLimit: 1 },
  );
  assert.equal(noHit.frames.some(frame => frame.cue?.kind === 'companion_assist' &&
    frame.cue.sourceId === 'RKF10-COMPANION'), false);
  assert.equal(contribution(noHit, 'RKF10-COMPANION').triggers, 0);
  assert.equal(contribution(noHit, 'RKF10-COMPANION').damage, 0);
  assert.equal(contribution(noHit, 'RKF10-COMPANION').shield, 0);

  const ordinary = simulateBattle(
    baseContent,
    makeLoadout('RKF05', { companions: ['RKF02'] }),
    makeEnemy(),
    'rkf02-companion-legacy-output',
    { roundLimit: 1 },
  );
  const legacyOutput = ordinary.frames.find(frame => frame.source === 'RKF02-COMPANION-ASSIST' && frame.kind === 'rage');
  assert.ok(legacyOutput, 'companions without alternate_effect keep their authored output');
  near(legacyOutput.amount, 5);
});
