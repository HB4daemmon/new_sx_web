import assert from 'node:assert/strict';
import {makePath, runScenario} from '../rage-economy/audit.mjs';

const RARITY = Object.freeze({
  common: 1,
  rare: 1.1,
  legendary: 1.25,
});

const BASIC_TARGETS = Object.freeze([
  {id: 'jingang', D: 90, L: 90, H: 100, P: 100},
  {id: 'guiyuan', D: 100, L: 100, H: 100, P: 100},
  {id: 'huichun', D: 85, L: 85, H: 100, P: 100},
  {id: 'yuhuo', D: 100, L: 100, H: 100, P: 100},
  {id: 'yangjian', D: 100, L: 100, H: 100, P: 100},
  {id: 'wudu', D: 104.5, L: 95, H: 100, P: 110},
  {id: 'benlei', D: 110, L: 100, H: 100, P: 110},
  {id: 'taiyin', D: 99, L: 90, H: 100, P: 110},
  {id: 'jinwu', D: 125, L: 100, H: 100, P: 125},
  {id: 'zhulong', D: 112.5, L: 90, H: 100, P: 125},
]);

const CURVES = Object.freeze({
  common: [100, 125, 150, 175, 200],
  rare: [110, 137.5, 165, 192.5, 220],
  legendary: [125, 156.25, 187.5, 218.75, 250],
});

export function powerScore({D, L, H = 100, complete = true}) {
  assert(complete, 'only a complete-survival comparison may be scored');
  assert(Number.isFinite(D) && Number.isFinite(L) && Number.isFinite(H));
  if (L <= 0) throw new RangeError('net effective life loss L must be > 0');
  assert(D >= 0, 'effective output index D must be non-negative');
  assert(H > 0, 'maximum HP index H must be positive');
  return D * H / L;
}

export function targetScore(rarity, n) {
  assert(Object.hasOwn(RARITY, rarity), `unknown rarity: ${rarity}`);
  assert(Number.isInteger(n) && n >= 0 && n <= 4, 'talent tier n must be 0..4');
  return 100 * RARITY[rarity] * (1 + 0.25 * n);
}

function close(actual, expected, message = '', epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}${actual} !== ${expected}`);
}

function fifteenRoundInputs() {
  return Array.from({length: 15}, () => ({
    sides: {
      A: {incomingSegments: [{kind: 'enemy-direct', hpDamage: 1}]},
      B: {incomingSegments: [{kind: 'enemy-direct', hpDamage: 1}]},
    },
  }));
}

function actionCounts(path) {
  const result = runScenario({
    rounds: 15,
    sides: {A: path, B: path},
    roundInputs: fifteenRoundInputs(),
  });
  const rounds = result.sides.A.rounds;
  const counts = rounds.reduce(
    (counts, round) => ({...counts, [round.action]: counts[round.action] + 1}),
    {basic: 0, rage: 0},
  );
  return {
    ...counts,
    rageRounds: rounds.filter((round) => round.action === 'rage').map((round) => round.number),
  };
}

const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push({name, passed: true});
  } catch (error) {
    checks.push({name, passed: false, error});
  }
}

for (const row of BASIC_TARGETS) {
  check(`basic-target-${row.id}`, () => {
    close(powerScore(row), row.P, row.id);
  });
}

check('rarity-target-curves', () => {
  for (const [rarity, expected] of Object.entries(CURVES)) {
    close(RARITY[rarity], expected[0] / 100, `${rarity} multiplier: `);
    expected.forEach((value, n) => close(targetScore(rarity, n), value, `${rarity}/${n}: `));
  }
});

check('pure-defense-curve', () => {
  const losses = [100, 80, 66.6667, 57.1429, 50];
  losses.forEach((loss, n) => close(
    powerScore({D: 100, L: loss}),
    CURVES.common[n],
    `tier ${n}: `,
    1e-3,
  ));
  close(powerScore({D: 100, L: 75}), 133.33333333333334, '100 -> 75: ');
});

check('mixed-output-life-and-hp', () => {
  close(powerScore({D: 110, L: 88, H: 100}), 125);
  close(powerScore({D: 100, L: 100, H: 125}), 125);
});

check('score-boundaries-do-not-invent-a-rating', () => {
  assert.equal(powerScore({D: 0, L: 100, H: 100}), 0);
  assert.throws(() => powerScore({D: 100, L: 0, H: 100}), /L must be > 0/);
  assert.throws(() => powerScore({D: 100, L: -1, H: 100}), /L must be > 0/);
  assert.throws(() => powerScore({D: 100, L: 100, H: 100, complete: false}), /complete-survival/);
  assert.throws(() => powerScore({D: -1, L: 100}), /non-negative/);
  assert.throws(() => powerScore({D: 100, L: 100, H: 0}), /must be positive/);
});

check('rarity-is-one-total-budget', () => {
  close(targetScore('common', 0), 100);
  close(targetScore('rare', 0), 110);
  close(targetScore('legendary', 0), 125);
  assert.notEqual(targetScore('rare', 0), 121);
  assert.notEqual(targetScore('legendary', 0), 156.25);
});

check('rage-action-counts-use-the-resource-audit', () => {
  assert.deepEqual(actionCounts({}), {basic: 11, rage: 4, rageRounds: [3, 7, 11, 15]});
  assert.deepEqual(
    actionCounts(makePath({})),
    {basic: 10, rage: 5, rageRounds: [3, 6, 9, 12, 15]},
  );
  assert.deepEqual(
    actionCounts(makePath({J1: 'A'})),
    {basic: 10, rage: 5, rageRounds: [2, 5, 8, 11, 14]},
  );
  assert.deepEqual(
    actionCounts(makePath({J1: 'A', J2: 'C'})),
    {basic: 8, rage: 7, rageRounds: [2, 4, 6, 8, 10, 12, 14]},
  );
});

check('illustrative-output-arithmetic', () => {
  const output = (basic, rage, basicDamage, rageDamage) => (
    basic * basicDamage + rage * rageDamage
  );
  assert.equal(output(11, 4, 4, 14), 100);
  assert.equal(output(10, 5, 4, 14) - output(11, 4, 4, 14), 10);
  assert.equal((25 / 4), 6.25);
  assert.equal(output(10, 5, 4, 12), 100);
  assert.equal(output(8, 7, 4, 12), 116);
  assert.notEqual(output(8, 7, 4, 12), 150);
});

export function audit() {
  const failed = checks.filter((item) => !item.passed);
  return {
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.map((item) => ({
      name: item.name,
      message: item.error?.message ?? String(item.error),
    })),
  };
}

function printAudit(report) {
  console.log('power-budget arithmetic audit');
  console.log(`checks: ${report.total}`);
  for (const failure of report.failed) {
    console.error(`FAIL ${failure.name}: ${failure.message}`);
  }
  console.log(`PASS ${report.passed}/${report.total}`);
  if (report.failed.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printAudit(audit());
}
