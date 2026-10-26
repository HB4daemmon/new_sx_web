import assert from 'node:assert/strict';
import test from 'node:test';
import { rateSummary } from './shanhai-difficulty-metrics.mjs';
import { renderDifficultyReport } from './shanhai-difficulty-report.mjs';

const emptyPass = () => ({
  cumulative: rateSummary(0, 0),
  conditional: rateSummary(0, 0),
});

function actPass(cumulativeWins, cumulativeRuns, conditionalWins, entrants) {
  return {
    cumulative: rateSummary(cumulativeWins, cumulativeRuns),
    conditional: rateSummary(conditionalWins, entrants),
  };
}

function emptyActs() {
  return Object.fromEntries([1, 2, 3, 4].map(act => [String(act), emptyPass()]));
}

function emptyMetrics() {
  return {
    outcomes: { won: 0, lost: 0, undecided: 0, error: 0 },
    acts: emptyActs(),
    byMethod: {},
    finalBattle: {
      eligibleRuns: 0,
      wins: 0,
      outcomes: { won: 0, lost: 0, undecided: 0, error: 0 },
      winRate: rateSummary(0, 0),
    },
    errors: { total: 0, records: [] },
  };
}

function baseReport(metrics = emptyMetrics()) {
  return {
    schemaVersion: 1,
    inputHash: 'fixture-input-hash',
    configuration: {
      experimentTrack: 'V2 experimental; shanhai-content-0.2; uncalibrated',
      sampleInterpretation: '仅报告当前批次的直接观测，不沿用 V1 校准结果。',
      contentVersion: 'fixture-content-v1',
      sourceContentHash: 'a'.repeat(64),
      seedPrefix: 'balance-holdout',
      split: 'holdout',
      seedsPerMethod: 2,
      methods: ['M01', 'M02'],
      seeds: [
        'balance-holdout-M01-0001',
        'balance-holdout-M01-0002',
        'balance-holdout-M02-0001',
        'balance-holdout-M02-0002',
      ],
      policy: 'steady',
      policySource: 'fixture-policy.mjs',
      policyContract: '仅使用当前可见信息，不读取隐藏奖励或未来战斗结果。',
      policyNotes: '示例策略说明。',
      runStepGuard: 600,
      battleRoundLimit: 4096,
      enemyStatAdjustment: {
        mode: 'offline_memory_enemy_entity_base_stats_only',
        fields: ['attack', 'defense', 'max_hp'],
        multipliers: {
          1: { attack: 1.1, defense: 1, max_hp: 1.05 },
          2: { attack: 1, defense: 1, max_hp: 1 },
          3: { attack: 1, defense: 1.1, max_hp: 1 },
          4: { attack: 1, defense: 1, max_hp: 1 },
          5: { attack: 1, defense: 1, max_hp: 1 },
        },
        note: '只调整内存中的敌人实体基础属性，不修改内容文件。',
      },
    },
    targets: {
      cumulativeActPassRates: { act1: 0.8, act2: 0.65, act3: 0.5, act4: 0.35 },
      finalAct: '仅统计进入第五幕的运行。',
      measuredContentFieldsRemainNull: true,
      interpretation: '胜率只适用于所选确定性策略，不是人类玩家胜率。',
    },
    metrics,
  };
}

test('zero-sample report renders missing intervals without presenting a zero rate', () => {
  const markdown = renderDifficultyReport(baseReport());

  assert.match(markdown, /0\/0（无样本）/);
  assert.match(markdown, /Wilson 95% CI/);
  assert.match(markdown, /无样本/);
  assert.doesNotMatch(markdown, /0\/0（0\.0%）/);
  assert.match(markdown, /measured: null/);
  assert.match(markdown, /不是人类玩家胜率/);
  assert.match(markdown, /V2 难度样本报告/);
  assert.match(markdown, /不沿用 V1 校准结果/);
});

test('normal report includes fixed-cohort and conditional rates, goals, metadata, and method breakdowns', () => {
  const metrics = {
    outcomes: { won: 1, lost: 1, undecided: 1, error: 1 },
    acts: {
      1: actPass(3, 4, 3, 4),
      2: actPass(2, 4, 2, 3),
      3: actPass(1, 4, 1, 2),
      4: actPass(1, 4, 1, 2),
    },
    byMethod: {
      M01: {
        runs: 2,
        acts: {
          1: actPass(2, 2, 2, 2),
          2: actPass(1, 2, 1, 2),
          3: actPass(1, 2, 1, 1),
          4: actPass(1, 2, 1, 1),
        },
      },
      M02: {
        runs: 2,
        acts: {
          1: actPass(1, 2, 1, 2),
          2: actPass(1, 2, 1, 1),
          3: actPass(0, 2, 0, 1),
          4: actPass(0, 2, 0, 1),
        },
      },
    },
    finalBattle: {
      eligibleRuns: 2,
      wins: 1,
      outcomes: { won: 1, lost: 0, undecided: 1, error: 0 },
      winRate: rateSummary(1, 2),
    },
    errors: { total: 1, records: [{ seed: 'seed-error', error: { message: 'fixture failure' } }] },
  };

  const markdown = renderDifficultyReport(baseReport(metrics));

  assert.match(markdown, /3\/4（75\.0%）/);
  assert.match(markdown, /80\.0%/);
  assert.match(markdown, /Wilson 95% CI/);
  assert.match(markdown, /累计样本数/);
  assert.match(markdown, /\[.*%, .*%\]/);
  assert.match(markdown, /2\/3（66\.7%）/);
  assert.match(markdown, /### M01/);
  assert.match(markdown, /### M02/);
  assert.match(markdown, /2\/2（100\.0%）/);
  assert.match(markdown, /balance-holdout-M01-0001/);
  assert.match(markdown, new RegExp('a{64}'));
  assert.match(markdown, /终战胜率：1\/2（50\.0%）/);
  assert.match(markdown, /仅统计进入第五幕的运行/);
  assert.match(markdown, /未决运行数：1/);
  assert.match(markdown, /错误运行数：1/);
  assert.match(markdown, /offline_memory_enemy_entity_base_stats_only/);
  assert.match(markdown, /1\.1/);
  assert.match(markdown, /仅使用当前可见信息/);
  assert.match(markdown, /measured: null/);
  assert.match(markdown, /不得写入内容的实测字段/);
});

test('undecided and error outcomes are shown separately from losses', () => {
  const metrics = {
    ...emptyMetrics(),
    outcomes: { won: 0, lost: 2, undecided: 3, error: 4 },
    errors: { total: 4, records: [] },
  };
  const markdown = renderDifficultyReport(baseReport(metrics));

  assert.match(markdown, /全部运行：通关 0 \/ 失败 2 \/ 未决 3 \/ 错误 4/);
  assert.match(markdown, /未决运行数：3/);
  assert.match(markdown, /错误运行数：4/);
});

test('renderer rejects objects without the difficulty metrics envelope', () => {
  assert.throws(() => renderDifficultyReport({}), /metrics object/);
});
