import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'verification/shanhai/v2');
const BUILD_VERSION = 5;
const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 100_000,
  crit_rate: 0,
  speed: 30,
});
const SEEDS = Object.freeze({
  splitDamage: 'v2-forging-compare-rkf02-split',
  criticalTradeoff: 'v2-forging-compare-critical-tradeoff',
  hitEffects: 'v2-forging-compare-rkf06-hit-effects',
  carapace: 'v2-forging-compare-carapace',
  awakening: 'v2-forging-compare-rc14-awakening',
});

const loaded = await loadContent({
  contentRoot: path.join(ROOT, 'content/shanhai'),
  manifestPath: path.join(ROOT, 'content/shanhai/manifest.yaml'),
});
assert.deepEqual(loaded.issues, [], 'authored content must load cleanly');
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);
const rc01 = content.byId.RC01;
assert.deepEqual(rc01.core_rule, { kind: 'basic_convergence', damage_ratio: 1.25 });
const noConvergenceEntities = structuredClone(content.entities);
delete noConvergenceEntities.find(entity => entity.id === 'RC01').core_rule;
const noConvergenceContent = contentFromEntities(noConvergenceEntities, content.version);
const expectedNoConvergenceEntities = structuredClone(content.entities);
delete expectedNoConvergenceEntities.find(entity => entity.id === 'RC01').core_rule;
assert.deepEqual(noConvergenceContent.entities, expectedNoConvergenceEntities,
  'the control content may differ only by removal of RC01.core_rule');

const buildVersion = ShanhaiGame.create(content, {
  seed: 'v2-forging-build-version-check',
  name: 'controlled compare',
  method: 'RKF01',
}).state.buildVersion;
assert.equal(buildVersion, BUILD_VERSION, 'the loaded current build must be version 5');

function makeLoadout(method, artifacts = [], {
  talents = [],
  baseStats = BASE_STATS,
  hp,
} = {}) {
  return {
    name: method,
    method,
    n: 4,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...baseStats },
    ...(hp === undefined ? {} : { hp }),
  };
}

function makeEnemy({ talents = [], method = 'RKF01' } = {}) {
  return makeLoadout(method, [], {
    talents,
    baseStats: {
      attack: 0,
      defense: 0,
      max_hp: 1_000_000_000,
      crit_rate: 0,
      speed: 1,
    },
  });
}

function contribution(result, id) {
  return result.contributions.find(item => item.id === id) ?? {
    triggers: 0,
    damage: 0,
    rage: 0,
  };
}

function sumDamage(result, predicate) {
  return result.frames
    .filter(frame => frame.kind === 'damage' && predicate(frame))
    .reduce((sum, frame) => sum + (frame.amount ?? 0), 0);
}

function baseHits(result, source, round) {
  const hits = result.frames.filter(frame =>
    frame.kind === 'damage' &&
    frame.actor === 'player' &&
    frame.source === source &&
    frame.round === round);
  return {
    count: hits.length,
    totalDamage: hits.reduce((sum, frame) => sum + (frame.amount ?? 0), 0),
    criticalCount: hits.filter(frame => frame.text.includes('暴击')).length,
    damageByHit: hits.map(frame => frame.amount ?? 0),
  };
}

function hpLoss(result, player, enemy) {
  const playerStats = calculateStats(content, player);
  const enemyStats = calculateStats(content, enemy);
  return {
    player: (player.hp ?? playerStats.max_hp) - result.playerHp,
    enemy: (enemy.hp ?? enemyStats.max_hp) - result.enemyHp,
  };
}

function statusLayers(result, side, status) {
  return result.frames.at(-1)?.[side]?.statuses?.[status] ?? 0;
}

function combatSummary(result, player, enemy, {
  baseSource,
  baseRound = 1,
  poisonSource,
  poisonApplicationSource,
  poisonStatusSide = 'enemy',
  hitRageSource,
  retaliationSource,
} = {}) {
  const applications = poisonApplicationSource
    ? result.frames.filter(frame =>
      frame.kind === 'status' && frame.source === poisonApplicationSource)
    : [];
  const poisonDamageFrames = poisonSource
    ? result.frames.filter(frame =>
      frame.kind === 'dot' && frame.actor === 'player' && frame.source === poisonSource)
    : [];
  const retaliations = retaliationSource
    ? result.frames.filter(frame =>
      frame.kind === 'damage' &&
      frame.actor === 'enemy' &&
      frame.target === 'player' &&
      frame.source === retaliationSource)
    : [];
  const convergenceMarkers = result.frames.filter(frame =>
    frame.kind === 'status' && frame.actor === 'player' && frame.source === 'RC01-CORE');
  const summary = {
    outcome: result.outcome,
    rounds: result.rounds,
    hpLoss: hpLoss(result, player, enemy),
    baseHits: baseSource ? baseHits(result, baseSource, baseRound) : null,
    convergence: {
      convertedActions: convergenceMarkers.length,
      segmentsMerged: convergenceMarkers.reduce((sum, frame) => sum + (frame.amount ?? 0), 0),
    },
    poison: {
      applicationLayers: applications.reduce((sum, frame) => sum + (frame.amount ?? 0), 0),
      layersAtEnd: statusLayers(result, poisonStatusSide, 'poison'),
      dotDamage: poisonDamageFrames.reduce((sum, frame) => sum + (frame.amount ?? 0), 0),
      dotDamageByTick: poisonDamageFrames.map(frame => frame.amount ?? 0),
    },
    hitRage: hitRageSource ? contribution(result, hitRageSource).rage : 0,
    retaliation: {
      count: retaliations.length,
      damage: retaliations.reduce((sum, frame) => sum + (frame.amount ?? 0), 0),
      damageByHit: retaliations.map(frame => frame.amount ?? 0),
    },
  };
  return summary;
}

function compareCore({ id, question, player, enemy, seed, roundLimit, metrics }) {
  const playerStatsWithoutConvergence = calculateStats(noConvergenceContent, player);
  const playerStatsWithConvergence = calculateStats(content, player);
  const enemyStatsWithoutConvergence = calculateStats(noConvergenceContent, enemy);
  const enemyStatsWithConvergence = calculateStats(content, enemy);
  assert.deepEqual(playerStatsWithConvergence, playerStatsWithoutConvergence,
    `${id}: RC01 core rule must not alter calculated player stats`);
  assert.deepEqual(enemyStatsWithConvergence, enemyStatsWithoutConvergence,
    `${id}: RC01 core rule must not alter calculated enemy stats`);
  const withoutResult = simulateBattle(noConvergenceContent, player, enemy, seed, { roundLimit });
  const withResult = simulateBattle(content, player, enemy, seed, { roundLimit });
  const without = combatSummary(withoutResult, player, enemy, metrics);
  const withCore = combatSummary(withResult, player, enemy, metrics);
  return {
    id,
    question,
    seed,
    roundLimit,
    controlledDifference: 'RC01 remains equipped with the same layer count; cloned content removes only RC01.core_rule.',
    fixture: {
      player: {
        method: player.method,
        talents: player.talents,
        artifacts: player.artifacts,
        baseStats: player.baseStats,
          calculatedStatsWithConvergence: playerStatsWithConvergence,
          calculatedStatsWithoutConvergence: playerStatsWithoutConvergence,
      },
      enemy: {
        method: enemy.method,
        talents: enemy.talents,
        artifacts: enemy.artifacts,
        baseStats: enemy.baseStats,
          calculatedStatsWithConvergence: enemyStatsWithConvergence,
          calculatedStatsWithoutConvergence: enemyStatsWithoutConvergence,
      },
      fixtureNote: 'Explicit high-HP, low-pressure stats are a controlled combat fixture, not normal progression strength.',
    },
    withoutConvergence: without,
    withConvergence: withCore,
    deltaWithMinusWithout: {
      playerHpLoss: withCore.hpLoss.player - without.hpLoss.player,
      enemyHpLoss: withCore.hpLoss.enemy - without.hpLoss.enemy,
      baseHitCount: withCore.baseHits?.count - without.baseHits?.count,
      segmentsMerged: withCore.convergence.segmentsMerged - without.convergence.segmentsMerged,
      baseDamage: withCore.baseHits
        ? withCore.baseHits.totalDamage - without.baseHits.totalDamage
        : null,
      poisonApplicationLayers: withCore.poison.applicationLayers - without.poison.applicationLayers,
      poisonLayersAtEnd: withCore.poison.layersAtEnd - without.poison.layersAtEnd,
      poisonDotDamage: withCore.poison.dotDamage - without.poison.dotDamage,
      hitRage: withCore.hitRage - without.hitRage,
      retaliationCount: withCore.retaliation.count - without.retaliation.count,
      retaliationDamage: withCore.retaliation.damage - without.retaliation.damage,
    },
  };
}

function assertNear(actual, expected, message, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: got ${actual}, expected ${expected}`);
}

function findCoreComparison(report, id) {
  const comparison = report.find(item => item.id === id);
  assert.ok(comparison, `missing comparison ${id}`);
  return comparison;
}

const splitGear = [{ id: 'RC01', stacks: 1 }, { id: 'RL04', stacks: 1 }];
const splitDamage = compareCore({
  id: 'rkf02-split-total-base-damage',
  question: 'RKF02 plus 剑丸成阵: total basic base damage after returning-breath segments are finalized',
  player: makeLoadout('RKF02', splitGear, {
    talents: ['V2-J2-C'],
  }),
  enemy: makeEnemy(),
  seed: SEEDS.splitDamage,
  roundLimit: 2,
  metrics: { baseSource: 'RKF02-BASIC-DAMAGE', baseRound: 2 },
});

const criticalTradeoff = compareCore({
  id: 'full-crit-unavoidable-cost',
  question: 'At 100% critical rate, compare split critical hits with the converged noncritical hit',
  player: makeLoadout('RKF02', splitGear, {
    talents: ['V2-J2-C'],
    baseStats: { ...BASE_STATS, crit_rate: 1 },
  }),
  enemy: makeEnemy(),
  seed: SEEDS.criticalTradeoff,
  roundLimit: 2,
  metrics: { baseSource: 'RKF02-BASIC-DAMAGE', baseRound: 2 },
});

const hitEffects = compareCore({
  id: 'rkf06-poison-and-hit-rage-reduction',
  question: 'RKF06 with three-segment basics: poison applications and hit-rage rewards follow the effective hit count',
  player: makeLoadout('RKF06', [{ id: 'RC01', stacks: 1 }], {
    talents: ['V2-J2-C', 'V2-J3-A'],
  }),
  enemy: makeEnemy(),
  seed: SEEDS.hitEffects,
  roundLimit: 1,
  metrics: {
    baseSource: 'RKF06-BASIC-DAMAGE',
    poisonSource: 'RKF06-BASIC-POISON',
    poisonApplicationSource: 'RKF06-BASIC-POISON',
    hitRageSource: 'V2-J3-A',
  },
});

const carapace = compareCore({
  id: 'carapace-retaliations',
  question: 'Against 猬甲护身, compare the number and total damage of retaliation hits',
  player: makeLoadout('RKF02', [{ id: 'RC01', stacks: 1 }], {
    talents: ['V2-J2-C'],
  }),
  enemy: makeEnemy({ talents: ['V2-J1-D'] }),
  seed: SEEDS.carapace,
  roundLimit: 1,
  metrics: {
    baseSource: 'RKF02-BASIC-DAMAGE',
    retaliationSource: 'V2-J1-D-BUILD',
  },
});

const rc14Loadout = stacks => makeLoadout('RKF09', [{ id: 'RC14', stacks }]);
const rc14Enemy = makeEnemy();
function rc14Result(stacks, artifactAwakenings) {
  const player = rc14Loadout(stacks);
  const result = simulateBattle(content, player, rc14Enemy, SEEDS.awakening, {
    roundLimit: 1,
    artifactAwakenings,
  });
  const poisonDots = result.frames.filter(frame =>
    frame.kind === 'dot' && frame.actor === 'player' && frame.source === 'RC14');
  const enemyStartHp = calculateStats(content, rc14Enemy).max_hp;
  return {
    stacks,
    artifactAwakenings,
    baseStats: player.baseStats,
    calculatedStats: calculateStats(content, player),
    seed: SEEDS.awakening,
    outcome: result.outcome,
    rounds: result.rounds,
    hpLoss: {
      player: player.baseStats.max_hp - result.playerHp,
      enemy: enemyStartHp - result.enemyHp,
    },
    baseHits: baseHits(result, 'RKF09-BASIC-DAMAGE', 1),
    burnLayersAtEnd: statusLayers(result, 'enemy', 'burn'),
    poisonLayersAtEnd: statusLayers(result, 'enemy', 'poison'),
    poisonDotDamage: poisonDots.reduce((sum, frame) => sum + (frame.amount ?? 0), 0),
    poisonDotDamageByTick: poisonDots.map(frame => frame.amount ?? 0),
    rc14Contribution: contribution(result, 'RC14'),
  };
}

const rc14TwoOn = rc14Result(2, true);
const rc14TwoOff = rc14Result(2, false);
const rc14ThreeOn = rc14Result(3, true);
const rc14ThreeOff = rc14Result(3, false);
const rc14 = {
  id: 'rc14-awakening-two-to-three',
  question: 'Compare RC14 at two and three layers, and isolate the real three-layer awakening against the same loadout with awakenings disabled',
  fixture: {
    method: 'RKF09',
    enemyMethod: rc14Enemy.method,
    baseStats: BASE_STATS,
    roundLimit: 1,
    seed: SEEDS.awakening,
    condition: 'RKF09 basic applies burn before RC14 core applies poison during the same action.',
    fixtureNote: 'Explicit high-HP stats and one-round observation are controlled fixtures, not normal progression strength.',
  },
  twoStacks: {
    enabled: rc14TwoOn,
    disabled: rc14TwoOff,
    awakeningTriggerDelta: rc14TwoOn.rc14Contribution.triggers - rc14TwoOff.rc14Contribution.triggers,
    awakeningPoisonDamageDelta: rc14TwoOn.poisonDotDamage - rc14TwoOff.poisonDotDamage,
  },
  threeStacks: {
    enabled: rc14ThreeOn,
    disabled: rc14ThreeOff,
    awakeningTriggerDelta: rc14ThreeOn.rc14Contribution.triggers - rc14ThreeOff.rc14Contribution.triggers,
    awakeningPoisonDamageDelta: rc14ThreeOn.poisonDotDamage - rc14ThreeOff.poisonDotDamage,
  },
  stackComparison: {
    poisonDotDamageAtTwoStacks: rc14TwoOn.poisonDotDamage,
    poisonDotDamageAtThreeStacks: rc14ThreeOn.poisonDotDamage,
    poisonDotDamageDelta: rc14ThreeOn.poisonDotDamage - rc14TwoOn.poisonDotDamage,
  },
};

const splitComparison = findCoreComparison(
  [splitDamage, criticalTradeoff, hitEffects, carapace],
  'rkf02-split-total-base-damage',
);
assert.equal(splitComparison.withoutConvergence.baseHits.count, 5);
assert.equal(splitComparison.withConvergence.baseHits.count, 1);
assert.equal(splitComparison.withConvergence.convergence.convertedActions, 1);
assert.equal(splitComparison.withConvergence.convergence.segmentsMerged, 5);
assert.ok(splitComparison.withConvergence.baseHits.totalDamage >
  splitComparison.withoutConvergence.baseHits.totalDamage,
'the converged finalized RKF02 base segments must show a controlled damage benefit');
assertNear(
  splitComparison.withConvergence.baseHits.totalDamage /
    splitComparison.withoutConvergence.baseHits.totalDamage,
  1.25,
  'RC01 multiplier should apply once to the sum of finalized segments',
);

assert.equal(criticalTradeoff.withoutConvergence.baseHits.criticalCount, 5);
assert.equal(criticalTradeoff.withConvergence.baseHits.criticalCount, 0);
assert.ok(criticalTradeoff.withoutConvergence.baseHits.totalDamage >
  criticalTradeoff.withConvergence.baseHits.totalDamage,
'no-crit conversion must show the full-critical-rate tradeoff');

assert.equal(hitEffects.withoutConvergence.baseHits.count, 3);
assert.equal(hitEffects.withConvergence.baseHits.count, 1);
assert.equal(hitEffects.withoutConvergence.poison.applicationLayers, 3);
assert.equal(hitEffects.withConvergence.poison.applicationLayers, 1);
assert.equal(hitEffects.withoutConvergence.poison.layersAtEnd, 3);
assert.equal(hitEffects.withConvergence.poison.layersAtEnd, 1);
assert.equal(hitEffects.withoutConvergence.hitRage, 9);
assert.equal(hitEffects.withConvergence.hitRage, 3);

assert.equal(carapace.withoutConvergence.retaliation.count, 3);
assert.equal(carapace.withConvergence.retaliation.count, 1);
assert.ok(carapace.withoutConvergence.retaliation.damage >
  carapace.withConvergence.retaliation.damage);
assert.ok(carapace.withoutConvergence.hpLoss.player > carapace.withConvergence.hpLoss.player);

assert.equal(rc14TwoOn.burnLayersAtEnd, 1);
assert.equal(rc14TwoOn.poisonLayersAtEnd, 1);
assert.equal(rc14ThreeOn.burnLayersAtEnd, 1);
assert.equal(rc14ThreeOn.poisonLayersAtEnd, 1);
assert.equal(rc14.twoStacks.awakeningTriggerDelta, 0);
assertNear(rc14.twoStacks.awakeningPoisonDamageDelta, 0,
  'two RC14 layers must not activate the awakening');
assert.equal(rc14.threeStacks.awakeningTriggerDelta, 1);
assert.ok(rc14.threeStacks.awakeningPoisonDamageDelta > 0,
  'three RC14 layers with prior burn must produce actual extra poison damage');
assert.ok(rc14.stackComparison.poisonDotDamageDelta > 0);

const manifestBytes = await readFile(path.join(ROOT, 'content/shanhai/manifest.yaml'));
const sourceFiles = [
  { path: 'content/shanhai/manifest.yaml', bytes: manifestBytes },
  ...loaded.entities.map(async entity => ({
    path: `content/shanhai/${entity.__path}`,
    bytes: await readFile(path.join(ROOT, 'content/shanhai', entity.__path)),
  })),
];
const resolvedSourceFiles = await Promise.all(sourceFiles);
resolvedSourceFiles.sort((a, b) => a.path.localeCompare(b.path));
const sourceHashes = resolvedSourceFiles.map(file => ({
  path: file.path,
  sha256: createHash('sha256').update(file.bytes).digest('hex'),
}));
const contentHashInput = JSON.stringify({
  contentVersion: loaded.manifest.content_version,
  files: sourceHashes,
});
const report = {
  schemaVersion: 1,
  experiment: 'V2_FORGING_CONTROLLED_COMPARE',
  buildVersion,
  contentVersion: loaded.manifest.content_version,
  contentHash: {
    algorithm: 'SHA-256',
    scope: 'content/shanhai/manifest.yaml plus all manifest-listed entity YAML source bytes, path-delimited by the file digest list',
    value: createHash('sha256').update(contentHashInput).digest('hex'),
    fileCount: sourceHashes.length,
  },
  runtime: 'build/shanhai/combat.js (existing build; this script does not build)',
  controlDefinition: 'For RC01 pairs, both sides use the identical loadout, base stats, enemy, and seed. Control content is a structured clone with only RC01.core_rule removed.',
  caveat: 'All combat inputs use explicit fixture stats to keep targets alive and isolate measured mechanics. These deterministic fixtures are not normal run intensity, player outcomes, balance, or fun evidence.',
  comparisons: [splitDamage, criticalTradeoff, hitEffects, carapace],
  rc14Awakening: rc14,
  assertions: {
    controlledRkf02DamageBenefit: true,
    fullCritNoCritDamageCost: true,
    rkf06HitEffectsAndHitRageReduction: true,
    carapaceRetaliationReduction: true,
    rc14AwakeningThresholdAndActualDamage: true,
  },
};

function number(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : 'n/a';
}

function tableRow(name, summary) {
  return `| ${name} | ${number(summary.hpLoss.player)} | ${number(summary.hpLoss.enemy)} | ${summary.baseHits?.count ?? 'n/a'} | ${summary.convergence.segmentsMerged} | ${number(summary.baseHits?.totalDamage ?? 0)} | ${summary.baseHits?.criticalCount ?? 'n/a'} | ${summary.poison.applicationLayers} / ${summary.poison.layersAtEnd} | ${number(summary.poison.dotDamage)} | ${number(summary.hitRage)} | ${summary.retaliation.count} / ${number(summary.retaliation.damage)} |`;
}

function coreSection(item) {
  return [
    `### ${item.id}`,
    '',
    item.question,
    '',
    `Seed: \`${item.seed}\`; round limit: ${item.roundLimit}. ${item.controlledDifference}`,
    '',
    'Fixture player: ' +
      `\`${item.fixture.player.method}\`, talents \`${item.fixture.player.talents.join(', ')}\`, ` +
      `artifacts \`${item.fixture.player.artifacts.map(artifact => `${artifact.id} x${artifact.stacks}`).join(', ')}\`; ` +
      `base stats ${JSON.stringify(item.fixture.player.baseStats)}.`,
    '',
    'Fixture enemy: ' +
      `\`${item.fixture.enemy.method}\`, talents \`${item.fixture.enemy.talents.join(', ') || 'none'}\`; ` +
      `base stats ${JSON.stringify(item.fixture.enemy.baseStats)}.`,
    '',
    `Calculated stats match across arms: player ${JSON.stringify(item.fixture.player.calculatedStatsWithConvergence)}; ` +
      `enemy ${JSON.stringify(item.fixture.enemy.calculatedStatsWithConvergence)}.`,
    '',
    item.fixture.fixtureNote,
    '',
    '| Arm | Player HP loss | Enemy HP loss | Base hits | Merged segments | Base damage | Critical base hits | Poison added / final | Poison DOT | Hit rage | Retaliations / damage |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    tableRow('RC01 equipped, core rule removed', item.withoutConvergence),
    tableRow('RC01 equipped, convergence active', item.withConvergence),
    '',
    `With-core minus control: ${JSON.stringify(item.deltaWithMinusWithout)}.`,
    '',
  ].join('\n');
}

function rc14Section(item) {
  const line = result =>
    `| ${result.stacks} | ${result.artifactAwakenings} | ${number(result.hpLoss.player)} | ${number(result.hpLoss.enemy)} | ${result.burnLayersAtEnd} | ${result.poisonLayersAtEnd} | ${number(result.poisonDotDamage)} | ${result.rc14Contribution.triggers} |`;
  return [
    '### RC14 Awakening',
    '',
    item.question,
    '',
    `Seed: \`${item.fixture.seed}\`. ${item.fixture.condition}`,
    '',
    item.fixture.fixtureNote,
    '',
    '| Layers | Awakening enabled | Player HP loss | Enemy HP loss | Burn layers | Poison layers | RC14 poison DOT | RC14 contribution triggers |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    line(item.twoStacks.enabled),
    line(item.twoStacks.disabled),
    line(item.threeStacks.enabled),
    line(item.threeStacks.disabled),
    '',
    `At two layers, enabled-minus-disabled trigger delta is ${item.twoStacks.awakeningTriggerDelta} and poison DOT delta is ${number(item.twoStacks.awakeningPoisonDamageDelta)}.`,
    `At three layers, enabled-minus-disabled trigger delta is ${item.threeStacks.awakeningTriggerDelta} and poison DOT delta is ${number(item.threeStacks.awakeningPoisonDamageDelta)}.`,
    `Observed three-minus-two layer poison DOT delta with awakenings enabled: ${number(item.stackComparison.poisonDotDamageDelta)}.`,
    'The enabled/disabled pair holds content, loadout, stats, enemy, seed, and duration fixed; only the runtime awakening switch differs.',
    '',
  ].join('\n');
}

const markdown = [
  '# V2 Forging Controlled Combat Comparison',
  '',
  `- Build version: ${report.buildVersion}`,
  `- Content version: \`${report.contentVersion}\``,
  `- Content SHA-256: \`${report.contentHash.value}\` (${report.contentHash.fileCount} files, manifest plus listed entity YAML)`,
  `- Runtime: \`${report.runtime}\``,
  '- Reproduce with: `node tests/shanhai-v2-forging-compare.mjs`',
  '',
  report.caveat,
  '',
  'Every RC01 arm keeps RC01 equipped with the same number of layers. The paired control changes only `RC01.core_rule`; it does not unequip the artifact or alter stats.',
  '',
  ...report.comparisons.map(coreSection),
  rc14Section(rc14),
  '## Assertions',
  '',
  '- RKF02 finalized five-segment base damage increased by exactly the authored 1.25 multiplier.',
  '- At full critical rate, five split critical hits exceed the single converged noncritical base hit.',
  '- RKF06 poison layer additions and hit-rage gains track three effective base hits versus one.',
  '- The 猬甲 fixture reports fewer retaliation hits and lower player HP loss with convergence.',
  '- RC14 remains below awakening at two layers and produces an isolated extra poison DOT at three layers when pre-burned.',
  '',
  'These are mechanical observations under controlled fixture stats. They do not establish balance, typical progression strength, preference, or fun.',
  '',
].join('\n');

await mkdir(REPORT_DIR, { recursive: true });
await writeFile(path.join(REPORT_DIR, 'forging-comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(REPORT_DIR, 'forging-comparison.md'), markdown);
console.log(`Wrote ${path.relative(ROOT, path.join(REPORT_DIR, 'forging-comparison.json'))}`);
console.log(`Wrote ${path.relative(ROOT, path.join(REPORT_DIR, 'forging-comparison.md'))}`);
