import assert from 'node:assert/strict';
import test from 'node:test';
import {
  difficultyCommand,
  normalizeEnemyMultipliers,
  parseDifficultyArgs,
  scaleEnemyBaseStats,
} from './shanhai-difficulty.mjs';
import {
  aggregateDifficultyRuns,
  rateSummary,
  summarizeBattles,
  wilson95,
} from './shanhai-difficulty-metrics.mjs';
import { nextCommand } from './shanhai-policy.mjs';

const methods = ['RKF01', 'RKF02'];

function run({
  seed,
  method,
  result,
  enteredActs = [1],
  clearedActs = [],
  battles = [],
  finalBattle = null,
  fatal = null,
  error = null,
}) {
  return {
    seed,
    method,
    result,
    enteredActs,
    clearedActs,
    battles,
    finalBattle,
    fatal,
    error,
  };
}

test('Wilson intervals handle empty and boundary samples', () => {
  assert.equal(wilson95(0, 0), null);
  assert.deepEqual(rateSummary(0, 5), {
    successes: 0,
    total: 5,
    rate: 0,
    wilson95: { lower: 0, upper: wilson95(0, 5).upper },
  });
  assert.ok(wilson95(5, 5).lower > 0.5);
  assert.equal(wilson95(5, 5).upper, 1);
  assert.throws(() => wilson95(6, 5), /0 <= successes <= total/);
});

test('cumulative passage keeps the fixed cohort denominator while conditional passage uses act entrants', () => {
  const rows = [
    run({ seed: 'one', method: 'RKF01', result: 'won', enteredActs: [1, 2, 3, 4, 5], clearedActs: [1, 2, 3, 4], finalBattle: { result: 'won' } }),
    run({ seed: 'two', method: 'RKF01', result: 'lost', enteredActs: [1, 2], clearedActs: [1], fatal: { act: 2, nodeType: 'C', nodeId: 'EN-A2-C1', enemyId: 'EN-A2-C1' } }),
    run({ seed: 'three', method: 'RKF02', result: 'error', enteredActs: [1], clearedActs: [], error: { message: 'fixture' } }),
    run({ seed: 'four', method: 'RKF02', result: 'lost', enteredActs: [1, 2, 3], clearedActs: [1, 2], fatal: { act: 3, nodeType: 'B', nodeId: 'EN-A3-B1', enemyId: 'EN-A3-B1' } }),
  ];
  const metrics = aggregateDifficultyRuns(rows, methods);

  assert.equal(metrics.acts['1'].cumulative.total, 4);
  assert.equal(metrics.acts['1'].cumulative.successes, 3);
  assert.equal(metrics.acts['2'].cumulative.total, 4);
  assert.equal(metrics.acts['2'].cumulative.successes, 2);
  assert.equal(metrics.acts['2'].conditional.total, 3);
  assert.equal(metrics.acts['2'].conditional.successes, 2);
  assert.equal(metrics.acts['3'].cumulative.successes, 1);
  assert.equal(metrics.acts['3'].conditional.total, 2);
  assert.ok(
    metrics.acts['4'].cumulative.successes <= metrics.acts['3'].cumulative.successes &&
      metrics.acts['3'].cumulative.successes <= metrics.acts['2'].cumulative.successes &&
      metrics.acts['2'].cumulative.successes <= metrics.acts['1'].cumulative.successes,
  );
  assert.equal(metrics.finalBattle.eligibleRuns, 1);
  assert.equal(metrics.finalBattle.winRate.total, 1);
  assert.equal(metrics.deaths.total, 2);
  assert.equal(metrics.deaths.byAct['2'], 1);
  assert.equal(metrics.deaths.byEnemy['EN-A3-B1'], 1);
  assert.equal(metrics.errors.total, 1);
  assert.equal(metrics.outcomes.lost, 2);
  assert.equal(metrics.outcomes.error, 1);
});

test('battle summaries retain rounds and net HP cost distributions', () => {
  const summary = summarizeBattles([
    { result: 'won', rounds: 4, playerNetHpLoss: 30, playerNetHpLossPct: 5 },
    { result: 'lost', rounds: 6, playerNetHpLoss: 100, playerNetHpLossPct: 20 },
  ]);
  assert.equal(summary.battles, 2);
  assert.equal(summary.rounds.mean, 5);
  assert.equal(summary.playerNetHpLoss.total, 130);
  assert.equal(summary.playerNetHpLoss.p50, 30);
  assert.equal(summary.playerNetHpLossPct.max, 20);
  assert.deepEqual(summary.outcomes, { won: 1, lost: 1, undecided: 0, error: 0 });
});

test('enemy multipliers clone only authored enemy base stats and support per-act values', () => {
  const content = {
    version: 'fixture',
    entities: [
      { id: 'RULES', kind: 'rules', combat: { attack: 1 } },
      { id: 'RKF01', kind: 'method', stats: { attack: 900 } },
      { id: 'EN-A1-C1', kind: 'enemy', acts: [1], stats: { attack: 10, defense: 20, max_hp: 30, crit_rate: 0.1, speed: 8 } },
      { id: 'EN-F1', kind: 'enemy', acts: [5], stats: { attack: 50, defense: 60, max_hp: 70, crit_rate: 0.2, speed: 12 } },
    ],
    byId: {},
  };
  const originalStats = structuredClone(content.entities[2].stats);
  const adjusted = scaleEnemyBaseStats(content, {
    1: { attack: 2, defense: 0.5, max_hp: 1.5 },
    5: { attack: 1.1 },
  });

  assert.deepEqual(adjusted.byId['EN-A1-C1'].stats, {
    attack: 20,
    defense: 10,
    max_hp: 45,
    crit_rate: 0.1,
    speed: 8,
  });
  assert.deepEqual(adjusted.byId['EN-F1'].stats, {
    attack: 50 * 1.1,
    defense: 60,
    max_hp: 70,
    crit_rate: 0.2,
    speed: 12,
  });
  assert.deepEqual(adjusted.byId.RKF01.stats, { attack: 900 });
  assert.deepEqual(content.entities[2].stats, originalStats);
  assert.notEqual(adjusted.byId['EN-A1-C1'], content.entities[2]);
});

test('CLI options build distinct train and holdout prefixes and validate adjustment JSON', () => {
  const train = parseDifficultyArgs([
    '--split', 'train',
    '--seeds', '3',
    '--seed-prefix', 'candidate-a',
    '--policy', 'steady',
    '--output-file', '/tmp/train.json',
    '--summary-only',
  ]);
  const holdout = parseDifficultyArgs([
    '--split=holdout',
    '--seed-prefix=candidate-a',
    '--output-dir=/tmp/holdout',
    '--enemy-multipliers={"attack":1.1,"defense":1,"max_hp":1.05}',
  ]);
  assert.equal(train.seedCount, 3);
  assert.equal(train.outputFile, '/tmp/train.json');
  assert.equal(train.summaryOnly, true);
  assert.equal(parseDifficultyArgs([]).seedPrefix, 'v2-difficulty');
  assert.equal(parseDifficultyArgs([]).outputDir, 'verification/shanhai/v2/difficulty');
  assert.equal(holdout.enemyMultipliers['4'].attack, 1.1);
  assert.notEqual(`${train.seedPrefix}-${train.split}`, `${holdout.seedPrefix}-${holdout.split}`);
  assert.deepEqual(normalizeEnemyMultipliers({ 1: { attack: 1.2 } })['1'], {
    attack: 1.2,
    defense: 1,
    max_hp: 1,
  });
  assert.throws(() => parseDifficultyArgs(['--seeds', '0']), /positive integer/);
  assert.throws(() => parseDifficultyArgs(['--output-dir', '/tmp/a', '--output-file', '/tmp/b']), /mutually exclusive/);
  assert.throws(() => normalizeEnemyMultipliers({ attack: 0 }), /finite positive number/);
});

test('steady policy uses available recovery without inspecting future route nodes', () => {
  const game = {
    state: { phase: 'map', hp: 300, coins: 20 },
    stats: { max_hp: 500 },
    content: { rules: { economy: { non_artifact_prices: { recovery: { price: 15 } } } } },
    availableNodes: () => [
      { type: 'C', key: 'combat', lane: 0 },
      { type: 'R', key: 'rest', lane: 1 },
      { type: 'S', key: 'shop', lane: 2 },
    ],
  };
  assert.equal(difficultyCommand(game, 'steady').id, 'rest');
  game.state.hp = 500;
  assert.equal(difficultyCommand(game, 'steady').id, 'combat');
});

test('difficulty policy cannot read hinted event rewards or check outcomes', () => {
  const hinted = {
    id: 'hidden',
    reveal: 'hint',
    costs: [],
    get rewards() { throw new Error('hidden reward read'); },
    get check() { throw new Error('hidden check read'); },
  };
  const game = {
    state: { phase: 'event' },
    node: { id: 'event' },
    content: { byId: { event: { options: [hinted, { id: 'leave', costs: [], rewards: [] }] } } },
    optionAvailability: () => ({ available: true }),
  };
  assert.equal(difficultyCommand(game, 'steady').id, 'leave');
});

test('avoid route preference does not inspect route nodes beyond the current choices', () => {
  const state = { phase: 'map' };
  Object.defineProperty(state, 'routeMap', {
    get() { throw new Error('future route read'); },
  });
  const game = {
    state,
    stats: { max_hp: 500 },
    availableNodes: () => [
      { type: 'C', key: 'combat', lane: 0 },
      { type: 'R', key: 'rest', lane: 1 },
    ],
    canChangeEquipment: () => true,
    content: { byId: {} },
  };
  assert.ok(['combat', 'rest'].includes(nextCommand(game, 'avoid').id));
});
