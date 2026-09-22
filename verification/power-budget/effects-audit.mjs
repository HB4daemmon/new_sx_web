import assert from 'node:assert/strict';
import {powerScore} from './audit.mjs';
import {runScenario} from '../rage-economy/audit.mjs';
import {
  EffectBattle,
  restoreEffectBattle,
  runFixture,
  sampleDamage,
  toRageRoundInputs,
} from './effects.mjs';

const EPSILON = 1e-6;
const checks = [];
const fixtureRows = [];

function close(actual, expected, label, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label}: ${actual} !== ${expected}`,
  );
}

function check(name, fn, row = null) {
  try {
    const value = fn();
    checks.push({name, passed: true});
    if (row) fixtureRows.push(typeof row === 'function' ? row(value) : row);
    return value;
  } catch (error) {
    checks.push({name, passed: false, error});
    return null;
  }
}

function damageLedger(result) {
  return result.ledger.filter((entry) => entry.kind === 'damage');
}

check('shield-absorption-and-heal-count-once', () => {
  const result = runFixture({
    window: 1,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {type: 'shield', time: 0, target: 'self', amount: 30, source: 'fixture-shield'},
      {
        type: 'damage',
        time: 1,
        target: 'self',
        sourceRole: 'external',
        category: 'direct',
        amount: 100,
        source: 'enemy',
        action: 'strike',
      },
      {type: 'heal', time: 1, target: 'self', amount: 20, source: 'self', action: 'heal'},
    ],
  });
  assert.equal(result.D, 0);
  assert.equal(result.D_raw, 0);
  assert.equal(result.L_raw, 50);
  assert.equal(result.units.D, 'raw-enemy-effective-damage');
  assert.equal(result.units.L, 'raw-net-effective-life-loss');
  close(result.L, 50, 'shield 30 + hp loss 70 - heal 20');
  close(result.shield.absorbed, 30, 'shield absorbed');
  close(result.life.incomingHpDamage, 70, 'actual incoming hp');
  close(result.life.effectiveHeal, 20, 'effective heal');
  close(result.shield.conservation, 0, 'shield conservation');
  assert.equal(result.ledger.filter((entry) => entry.kind === 'damage').length, 1);
  return result;
}, (result) => ({
  fixture: 'shield-heal',
  D: result.D,
  L: result.L,
  shieldAbsorbed: result.shield.absorbed,
  effectiveHeal: result.life.effectiveHeal,
}));

check('healing-overflow-is-not-effective-restoration', () => {
  const result = runFixture({
    window: 1,
    maxHp: 100,
    hp: 90,
    events: [
      {type: 'heal', time: 1, target: 'self', amount: 30, source: 'self'},
    ],
  });
  close(result.healing.corrected, 30, 'corrected healing');
  close(result.healing.effective, 10, 'effective healing');
  close(result.healing.overflow, 20, 'overflow');
  close(result.healing.overflowWasted, 20, 'wasted overflow');
  close(result.life.effectiveHeal, 10, 'life effective healing');
  close(result.L, -10, 'net life loss');
  assert.throws(() => powerScore({D: 0, L: result.L, H: 100}), /L must be > 0/);
  return result;
});

check('effective-heal-and-overflow-use-disjoint-conversions', () => {
  const result = runFixture({
    window: 1,
    maxHp: 100,
    hp: 80,
    events: [
      {
        type: 'heal',
        time: 1,
        target: 'self',
        amount: 30,
        source: 'self',
        overflowOutlet: {kind: 'shield', shieldBonus: 0.1},
        effectiveToShield: {ratio: 0.5, shieldBonus: 0.2},
      },
    ],
  });
  close(result.healing.effective, 20, 'effective heal');
  close(result.healing.overflow, 10, 'overflow');
  close(result.healing.effectiveToShield, 12, 'effective heal shield');
  close(result.healing.overflowToShield, 11, 'overflow shield');
  close(result.shield.generated, 23, 'disjoint shield conversions');
  close(result.healing.effective + result.healing.overflow, 30, 'single healing split');
  return result;
});

check('shield-absorb-consume-expire-and-follow-up-damage', () => {
  const result = runFixture({
    window: 4,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {type: 'shield', time: 0, target: 'self', amount: 30, source: 'guard'},
      {
        type: 'damage',
        time: 1,
        target: 'self',
        sourceRole: 'external',
        category: 'direct',
        amount: 10,
        source: 'enemy',
      },
      {
        type: 'consume-shield',
        time: 1,
        target: 'self',
        amount: 10,
        source: 'self',
        action: 'rage',
        followUpDamage: {target: 'enemy', amountPerShield: 1},
      },
      {
        type: 'damage',
        time: 2,
        target: 'self',
        sourceRole: 'external',
        category: 'direct',
        amount: 20,
        source: 'enemy',
      },
      {type: 'shield', time: 2, target: 'self', amount: 5, duration: 1, source: 'temporary'},
      {
        type: 'damage',
        time: 3,
        target: 'self',
        sourceRole: 'external',
        category: 'direct',
        amount: 5,
        source: 'enemy',
      },
    ],
  });
  close(result.shield.generated, 35, 'shield generated');
  close(result.shield.absorbed, 20, 'shield absorbed only');
  close(result.shield.consumed, 10, 'shield consumed only');
  close(result.shield.expired, 5, 'shield expired only');
  close(result.shield.remaining, 0, 'shield remaining');
  close(result.shield.conservation, 0, 'shield conservation');
  close(result.D, 10, 'shield consumption follow-up output');
  close(result.life.incomingHpDamage, 15, 'post-consumption hp damage');
  assert.equal(result.ledger.filter((entry) => entry.kind === 'shield-consume')[0].consumed, 10);
  return result;
});

check('incoming-rage-segment-requires-effective-direct-hit', () => {
  const result = runFixture({
    window: 2,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {type: 'shield', time: 0, target: 'self', amount: 30, source: 'guard'},
      {
        type: 'damage',
        time: 1,
        target: 'self',
        sourceRole: 'external',
        category: 'direct',
        amount: 30,
        source: 'enemy',
      },
      {
        type: 'damage',
        time: 1,
        target: 'self',
        sourceRole: 'external',
        category: 'direct',
        amount: 0,
        source: 'enemy',
      },
      {
        type: 'damage',
        time: 1.5,
        target: 'self',
        sourceRole: 'external',
        category: 'dot',
        amount: 5,
        source: 'poison',
      },
      {
        type: 'damage',
        time: 2,
        target: 'self',
        sourceRole: 'external',
        category: 'reflect',
        amount: 5,
        source: 'reflect',
      },
    ],
  });
  assert.equal(result.incomingSegments.length, 1);
  close(result.incomingSegments[0].shieldAbsorbed, 30, 'shield-only direct segment');
  close(result.incomingSegments[0].hpDamage, 0, 'shield-only direct hp');
  assert.equal(result.rageInputs[0].sides.A.incomingSegments.length, 1);
  assert.equal(result.rageInputs[0].sides.A.poisonFireTicks, 0);
  return result;
});

check('dot-window-only-counts-actual-ticks', () => {
  const result = runFixture({
    window: 3,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'poison',
        kind: 'dot',
        stacks: 1,
        maxStacks: 2,
        remainingTicks: 3,
        duration: 5,
        source: 'poison',
        dot: {amount: 20, mode: 'snapshot', target: 'enemy', sourceRole: 'self'},
      },
      {type: 'tick', time: 1, target: 'enemy', id: 'poison', ticks: 1},
      {type: 'tick', time: 2, target: 'enemy', id: 'poison', ticks: 1},
    ],
  });
  close(result.D, 40, 'two poison ticks');
  close(result.dot.effective, 40, 'effective dot');
  close(result.dot.unfulfilled, 20, 'unfulfilled third tick');
  close(result.damage.unfulfilledDot, 20, 'unfulfilled dot damage');
  assert.equal(damageLedger(result).length, 2);
  return result;
});

check('dot-death-stops-future-ticks-and-heals', () => {
  const result = runFixture({
    window: 3,
    maxHp: 10,
    hp: 10,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'poison',
        kind: 'dot',
        remainingTicks: 3,
        duration: 5,
        source: 'enemy-poison',
        dot: {amount: 20, mode: 'snapshot', target: 'self', sourceRole: 'external'},
      },
      {type: 'tick', time: 1, target: 'self', id: 'poison', ticks: 1},
      {type: 'tick', time: 2, target: 'self', id: 'poison', ticks: 1},
      {type: 'heal', time: 2, target: 'self', amount: 10, source: 'late-heal'},
    ],
  });
  assert.equal(result.earlyEnd, 'death');
  assert.equal(result.death.target, 'self');
  close(result.life.incomingHpDamage, 10, 'actual dot hp loss');
  close(result.dot.effective, 10, 'dot effective damage capped by hp');
  close(result.dot.unfulfilled, 40, 'future ticks unfulfilled');
  assert.equal(result.ledger.filter((entry) => entry.kind === 'heal').length, 0);
  assert.equal(
    result.ledger.filter((entry) => entry.kind === 'skipped').length,
    2,
  );
  return result;
});

check('status-stack-cap-refresh-and-consume', () => {
  const result = runFixture({
    window: 4,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'poison',
        kind: 'dot',
        stacks: 2,
        maxStacks: 3,
        remainingTicks: 4,
        duration: 2,
        source: 'poison',
        dot: {amount: 5, mode: 'snapshot', target: 'enemy', sourceRole: 'self'},
      },
      {
        type: 'apply-status',
        time: 1,
        target: 'enemy',
        id: 'poison',
        kind: 'dot',
        stackMode: 'add',
        stacks: 2,
        maxStacks: 3,
        remainingTicks: 4,
        duration: 2,
        refresh: true,
        refreshTicks: true,
        source: 'poison',
        dot: {amount: 5, mode: 'snapshot', target: 'enemy', sourceRole: 'self'},
      },
      {
        type: 'consume-status',
        time: 1.5,
        target: 'enemy',
        id: 'poison',
        stacks: 2,
      },
      {type: 'tick', time: 2, target: 'enemy', id: 'poison', ticks: 1},
      {type: 'remove-status', time: 2.5, target: 'enemy', id: 'poison'},
      {type: 'tick', time: 3, target: 'enemy', id: 'poison', ticks: 1},
    ],
  });
  const state = result.states.enemy.find((status) => status.id === 'poison');
  assert.equal(state.maxStacks, 3);
  assert.equal(state.stacks, 0);
  assert.equal(state.closeReason, 'removed');
  assert.equal(state.ticksApplied, 1);
  close(result.D, 5, 'one post-consume dot tick');
  assert.equal(damageLedger(result).length, 1);
  return result;
});

check('snapshot-and-dynamic-dot-values-diverge-only-when-declared', () => {
  const battle = new EffectBattle({
    window: 2,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    dynamicDots: {dynamic: 10},
  });
  battle.applyEvent({
    type: 'apply-status',
    time: 0,
    target: 'enemy',
    id: 'snapshot',
    kind: 'dot',
    remainingTicks: 1,
    source: 'snapshot',
    dot: {amount: 10, mode: 'snapshot', target: 'enemy', sourceRole: 'self'},
  });
  battle.applyEvent({
    type: 'apply-status',
    time: 0,
    target: 'enemy',
    id: 'dynamic',
    kind: 'dot',
    remainingTicks: 1,
    source: 'dynamic',
    dot: {
      amount: 10,
      mode: 'dynamic',
      key: 'dynamic',
      target: 'enemy',
      sourceRole: 'self',
    },
  });
  const snapshot = battle.snapshot();
  const resumed = restoreEffectBattle(snapshot);
  resumed.config.dynamicDots.dynamic = 20;
  resumed.applyEvent({type: 'tick', time: 1, target: 'enemy', id: 'snapshot'});
  resumed.applyEvent({type: 'tick', time: 1, target: 'enemy', id: 'dynamic'});
  close(resumed.result().D, 30, 'snapshot 10 + dynamic 20');
  close(resumed.result().dot.effective, 30, 'dot effective total');
  assert.equal(resumed.result().ledger.filter((entry) => entry.kind === 'damage').length, 2);
  return resumed.result();
});

check('buff-qualified-coverage-uses-actual-source-amount', () => {
  const result = runFixture({
    window: 2,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'damage-buff',
        kind: 'buff',
        effect: 'outgoing-damage',
        value: 0.25,
        coverage: {mode: 'qualified-events', key: 'basic'},
        coverageKey: 'basic',
        source: 'buff',
        duration: 1.1,
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        action: 'basic',
        category: 'direct',
        baseAmount: 40,
        coverageKey: 'basic',
        source: 'player',
      },
      {
        type: 'damage',
        time: 1.5,
        target: 'enemy',
        actor: 'self',
        action: 'basic',
        category: 'direct',
        baseAmount: 60,
        coverageKey: 'basic',
        source: 'player',
      },
    ],
  });
  close(result.D, 110, '40 covered by 25 percent buff');
  const coverage = result.statusCoverage['self:damage-buff'];
  close(coverage.denominator, 100, 'qualified source denominator');
  close(coverage.numerator, 40, 'qualified source numerator');
  close(coverage.ratio, 0.4, 'qualified source ratio');
  close(result.damage.bySource.player, 110, 'damage by source');
  assert.equal(result.states.self[0].active, false);
  close(result.states.self[0].stacks, 0, 'expired buff has no active layers');
  return result;
});

check('time-coverage-has-a-distinct-time-denominator', () => {
  const result = runFixture({
    window: 4,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 1,
        target: 'self',
        id: 'timed-buff',
        kind: 'buff',
        effect: 'outgoing-damage',
        value: 0.1,
        coverage: {mode: 'time', key: 'timed'},
        coverageKey: 'timed',
        source: 'timed-buff',
        duration: 1,
      },
      {
        type: 'damage',
        time: 1.5,
        target: 'enemy',
        actor: 'self',
        category: 'direct',
        amount: 10,
        source: 'before-expiry',
        coverageKey: 'timed',
      },
      {
        type: 'damage',
        time: 3,
        target: 'enemy',
        actor: 'self',
        category: 'direct',
        amount: 10,
        source: 'after-expiry',
        coverageKey: 'timed',
      },
    ],
  });
  const coverage = result.statusCoverage['self:timed-buff'];
  close(coverage.denominator, 4, 'time denominator');
  close(coverage.numerator, 1, 'active time numerator');
  close(coverage.ratio, 0.25, 'active time ratio');
  close(result.D, 21, 'time fixture applies only before expiry');
  return result;
});

check('coverage-requires-declared-read-and-real-application', () => {
  const result = runFixture({
    window: 4,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'attack-qualified',
        kind: 'buff',
        effect: 'attack-attribute',
        value: 0.25,
        coverage: {mode: 'qualified-events', key: 'attack'},
        coverageKey: 'attack',
        source: 'fixture',
        appliesTo: {action: 'basic'},
      },
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'outgoing-qualified',
        kind: 'buff',
        effect: 'outgoing-damage',
        value: 0.25,
        coverage: {mode: 'qualified-events', key: 'attack'},
        coverageKey: 'attack',
        source: 'fixture',
        appliesTo: {action: 'basic'},
      },
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'armor-qualified',
        kind: 'debuff',
        effect: 'armor-break',
        value: 10,
        coverage: {mode: 'qualified-events', key: 'attack'},
        coverageKey: 'attack',
        source: 'fixture',
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        action: 'basic',
        coverageKey: 'attack',
        baseAmount: 100,
        category: 'direct',
        formula: {
          type: 'subtract',
          base: 100,
          defense: 40,
          readsAttack: true,
          armorBreakStatus: 'armor-qualified',
        },
        source: 'qualified',
      },
      {
        type: 'damage',
        time: 2,
        target: 'enemy',
        actor: 'self',
        action: 'not-basic',
        coverageKey: 'attack',
        baseAmount: 100,
        category: 'dot',
        amount: 10,
        source: 'filtered',
        buffEligible: false,
      },
    ],
  });
  for (const id of ['attack-qualified', 'outgoing-qualified', 'armor-qualified']) {
    const coverage = result.statusCoverage[`${
      id === 'armor-qualified' ? 'enemy' : 'self'
    }:${id}`];
    assert.ok(coverage);
    close(coverage.denominatorEvents, 1, `${id} only counts qualified event`);
    close(coverage.numerator, 100, `${id} records actual application`);
  }
  return result;
});

check('buff-applied-after-action-only-affects-later-action', () => {
  const result = runFixture({
    window: 2,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        action: 'basic',
        category: 'direct',
        amount: 10,
        source: 'first',
      },
      {
        type: 'apply-status',
        time: 1,
        target: 'self',
        id: 'late-buff',
        kind: 'buff',
        effect: 'outgoing-damage',
        value: 0.25,
        source: 'late',
      },
      {
        type: 'damage',
        time: 2,
        target: 'enemy',
        actor: 'self',
        action: 'basic',
        category: 'direct',
        amount: 10,
        source: 'second',
      },
    ],
  });
  close(result.D, 22.5, 'later action only');
  close(damageLedger(result)[0].effective, 10, 'first action unaffected');
  close(damageLedger(result)[1].effective, 12.5, 'second action buffed');
  return result;
});

check('armor-break-reads-target-and-increases-fixture-damage', () => {
  const baseline = runFixture({
    window: 1,
    enemyMaxHp: 1000,
    events: [{
      type: 'damage',
      time: 1,
      target: 'enemy',
      actor: 'self',
      category: 'direct',
      formula: {type: 'subtract', base: 100, defense: 40},
    }],
  });
  const modified = runFixture({
    window: 1,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'armor-break',
        kind: 'debuff',
        effect: 'armor-break',
        value: 10,
        source: 'debuff',
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        category: 'direct',
        formula: {
          type: 'subtract',
          base: 100,
          defense: 40,
          armorBreakStatus: 'armor-break',
        },
      },
    ],
  });
  close(baseline.D, 60, 'baseline sample damage');
  close(modified.D, 70, 'armor break sample damage');
  assert.equal(damageLedger(modified).length, 1);
  assert.equal(modified.states.enemy.filter((status) => status.kind === 'debuff').length, 1);
  return modified;
});

check('weakness-reads-actor-and-reduces-our-life-loss', () => {
  const baseline = runFixture({
    window: 1,
    hp: 100,
    enemyMaxHp: 1000,
    events: [{
      type: 'damage',
      time: 1,
      target: 'self',
      actor: 'enemy',
      sourceRole: 'external',
      category: 'direct',
      formula: {type: 'subtract', base: 100, defense: 0},
    }],
  });
  const weakenedEnemy = runFixture({
    window: 1,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'enemy-weakness',
        kind: 'debuff',
        effect: 'weakness',
        value: 0.25,
        source: 'fixture',
      },
      {
        type: 'damage',
        time: 1,
        target: 'self',
        actor: 'enemy',
        sourceRole: 'external',
        category: 'direct',
        formula: {
          type: 'subtract',
          base: 100,
          defense: 0,
          weaknessStatus: 'enemy-weakness',
        },
      },
    ],
  });
  close(baseline.L, 100, 'baseline incoming loss');
  close(weakenedEnemy.L, 75, 'enemy weakness reduces attack input');
  return weakenedEnemy;
});

check('weakness-on-target-does-not-reduce-our-attack', () => {
  const result = runFixture({
    window: 1,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'wrong-side-weakness',
        kind: 'debuff',
        effect: 'weakness',
        value: 0.25,
        source: 'fixture',
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        category: 'direct',
        formula: {
          type: 'subtract',
          base: 100,
          defense: 40,
          weaknessStatus: 'wrong-side-weakness',
        },
      },
    ],
  });
  close(result.D, 60, 'target-side weakness is ignored');
  return result;
});

check('attack-attribute-is-pre-defense-and-outgoing-is-post-defense', () => {
  const attackAttribute = runFixture({
    window: 1,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'attack-plus',
        kind: 'buff',
        effect: 'attack-attribute',
        value: 0.25,
        source: 'fixture',
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        category: 'direct',
        formula: {
          type: 'subtract',
          base: 100,
          defense: 40,
          readsAttack: true,
        },
      },
    ],
  });
  const outgoing = runFixture({
    window: 1,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'outgoing-plus',
        kind: 'buff',
        effect: 'outgoing-damage',
        value: 0.25,
        source: 'fixture',
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        category: 'direct',
        formula: {
          type: 'subtract',
          base: 100,
          defense: 40,
        },
      },
    ],
  });
  const amountOnly = runFixture({
    window: 1,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'attack-plus',
        kind: 'buff',
        effect: 'attack-attribute',
        value: 0.25,
        source: 'fixture',
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        category: 'dot',
        amount: 40,
        source: 'dot',
      },
    ],
  });
  const combined = runFixture({
    window: 1,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'attack-plus',
        kind: 'buff',
        effect: 'attack-attribute',
        value: 0.25,
        source: 'fixture',
      },
      {
        type: 'apply-status',
        time: 0,
        target: 'self',
        id: 'attack-minus',
        kind: 'buff',
        effect: 'attack-attribute',
        modifier: 'decrease',
        value: 0.1,
        source: 'fixture',
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        category: 'direct',
        formula: {
          type: 'subtract',
          base: 100,
          defense: 40,
          readsAttack: true,
        },
      },
    ],
  });
  close(attackAttribute.D, 85, 'attack attribute before defense');
  close(outgoing.D, 75, 'outgoing modifier after defense');
  close(amountOnly.D, 40, 'attack attribute does not amplify amount or dot');
  close(combined.D, 75, 'same-class attack increase/decrease combine before defense');
  return {attackAttribute, outgoing, amountOnly, combined};
});

check('l-boundary-and-early-death-reject-power-score', () => {
  const noLoss = runFixture({
    window: 1,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [{type: 'heal', time: 1, target: 'self', amount: 10}],
  });
  assert.ok(noLoss.L <= 0);
  assert.throws(() => powerScore({D: 100, L: noLoss.L, H: 100}), /L must be > 0/);
  const early = runFixture({
    window: 2,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'damage',
        time: 1,
        target: 'self',
        sourceRole: 'external',
        category: 'direct',
        amount: 200,
      },
      {type: 'heal', time: 2, target: 'self', amount: 100},
    ],
  });
  assert.equal(early.earlyEnd, 'death');
  assert.equal(early.complete, false);
  assert.throws(
    () => powerScore({D: early.D, L: early.L, H: 100, complete: early.complete}),
    /complete-survival/,
  );
  return {noLoss, early};
});

check('sparse-advance-records-real-expiry-and-checkpoint-availability', () => {
  const result = runFixture({
    window: 5,
    maxHp: 100,
    enemyMaxHp: 1000,
    checkpoints: [1, 3, 5, 10],
    events: [
      {
        type: 'apply-status',
        time: 1,
        target: 'self',
        id: 'short-buff',
        kind: 'buff',
        effect: 'outgoing-damage',
        value: 0.1,
        coverage: {mode: 'time', key: 'short'},
        coverageKey: 'short',
        duration: 1,
        source: 'fixture',
      },
      {type: 'shield', time: 1, target: 'self', amount: 5, duration: 1, source: 'fixture'},
      {type: 'advance', time: 4, source: 'clock'},
    ],
  });
  const status = result.states.self.find((item) => item.id === 'short-buff');
  assert.equal(status.active, false);
  assert.equal(status.closedAt, 2);
  close(result.statusCoverage['self:short-buff'].activeTime, 1, 'real time coverage');
  close(result.shield.expired, 5, 'shield expires at its own timestamp');
  assert.equal(result.checkpoints[1].available, true);
  assert.equal(result.checkpoints[3].available, true);
  assert.equal(result.checkpoints[3].states.self.statuses[0].active, false);
  assert.equal(result.checkpoints[5].available, false);
  assert.equal(result.checkpoints[5].D, null);
  assert.equal(result.checkpoints[5].reason, 'actual-time-not-reached');
  assert.equal(result.checkpoints[10].available, false);
  assert.equal(result.checkpoints[10].reason, 'outside-window');
  assert.equal(
    result.ledger.filter((entry) => entry.kind === 'shield-expire').length,
    1,
  );
  assert.equal(
    result.ledger.filter((entry) => entry.kind === 'status-expire').length,
    1,
  );
  return result;
});

check('result-is-pure-snapshot-and-does-not-fake-window-checkpoints', () => {
  const result = runFixture({
    window: 1,
    maxHp: 100,
    enemyMaxHp: 1000,
    checkpoints: [1, 3, 5, 10, 15],
    events: [{
      type: 'apply-status',
      time: 0,
      target: 'self',
      id: 'unadvanced',
      kind: 'buff',
      effect: 'outgoing-damage',
      value: 0.1,
      source: 'fixture',
    }],
  });
  assert.equal(result.actualTime, 0);
  assert.equal(result.complete, false);
  assert.equal(result.earlyEnd, 'window-not-reached');
  for (const point of [1, 3, 5, 10, 15]) {
    assert.equal(result.checkpoints[point].available, false);
    assert.equal(result.checkpoints[point].D, null);
  }
  return result;
});

check('expired-dot-keeps-unfulfilled-tick-value', () => {
  const result = runFixture({
    window: 5,
    enemyMaxHp: 1000,
    events: [
      {
        type: 'apply-status',
        time: 1,
        target: 'enemy',
        id: 'short-dot',
        kind: 'dot',
        remainingTicks: 3,
        duration: 1,
        source: 'self-dot',
        dot: {amount: 4, mode: 'snapshot', target: 'enemy', sourceRole: 'self'},
      },
      {type: 'advance', time: 4, source: 'clock'},
    ],
  });
  assert.equal(result.states.enemy[0].active, false);
  assert.equal(result.states.enemy[0].closedAt, 2);
  close(result.dot.unfulfilled, 12, 'expired remaining DOT ticks stay unfulfilled');
  close(result.damage.unfulfilledDot, 12, 'damage unfulfilled DOT matches status asset');
  return result;
});

check('enemy-death-is-victory-and-retains-unfulfilled-dot-assets', () => {
  const result = runFixture({
    window: 3,
    maxHp: 100,
    enemyMaxHp: 10,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'future-poison',
        kind: 'dot',
        remainingTicks: 3,
        duration: 10,
        source: 'self-poison',
        dot: {amount: 4, mode: 'snapshot', target: 'enemy', sourceRole: 'self'},
      },
      {
        type: 'damage',
        time: 1,
        target: 'enemy',
        actor: 'self',
        amount: 10,
        source: 'finisher',
      },
      {type: 'tick', time: 2, target: 'enemy', id: 'future-poison'},
    ],
  });
  assert.equal(result.earlyEnd, 'victory');
  assert.equal(result.victory.target, 'enemy');
  assert.equal(result.death, null);
  assert.equal(result.complete, false);
  assert.equal(result.active, false);
  close(result.dot.unfulfilled, 12, 'remaining poison is unfulfilled asset');
  assert.equal(result.ledger.filter((entry) => entry.kind === 'damage').length, 1);
  assert.equal(result.ledger.at(-1).reason, 'battle-ended');
  return result;
});

check('fifteen-round-curves-provide-3-5-10-15-checkpoints', () => {
  const events = [];
  for (let round = 1; round <= 15; round += 1) {
    events.push({
      type: 'damage',
      time: round,
      target: 'enemy',
      actor: 'self',
      category: 'direct',
      amount: 7,
      source: 'round-damage',
      action: 'basic',
    });
    events.push({
      type: 'damage',
      time: round,
      target: 'self',
      sourceRole: 'external',
      category: 'direct',
      amount: 1,
      source: 'round-hit',
      action: 'strike',
    });
  }
  const result = runFixture({
    window: 15,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events,
  });
  assert.equal(result.complete, true);
  close(result.checkpoints[3].D, 21, 'D at 3');
  close(result.checkpoints[5].D, 35, 'D at 5');
  close(result.checkpoints[10].D, 70, 'D at 10');
  close(result.checkpoints[15].D, 105, 'D at 15');
  close(result.checkpoints[15].L, 15, 'L at 15');
  return result;
}, (result) => ({
  fixture: 'fifteen-round-curve',
  D3: result.checkpoints[3].D,
  D5: result.checkpoints[5].D,
  D10: result.checkpoints[10].D,
  D15: result.checkpoints[15].D,
  L15: result.checkpoints[15].L,
}));

check('rage-audit-consumes-only-actual-effect-inputs', () => {
  const result = runFixture({
    window: 3,
    maxHp: 100,
    hp: 100,
    enemyMaxHp: 1000,
    events: [
      {type: 'shield', time: 0, target: 'self', amount: 30, source: 'guard'},
      {
        type: 'damage',
        time: 1,
        target: 'self',
        sourceRole: 'external',
        category: 'direct',
        amount: 30,
        source: 'enemy',
      },
      {
        type: 'apply-status',
        time: 1,
        target: 'enemy',
        id: 'poison',
        kind: 'dot',
        remainingTicks: 1,
        source: 'player-poison',
        dot: {amount: 15, mode: 'snapshot', target: 'enemy', sourceRole: 'self'},
      },
      {type: 'tick', time: 1.5, target: 'enemy', id: 'poison'},
      {type: 'damage', time: 2, target: 'self', sourceRole: 'external', category: 'dot', amount: 5},
      {
        type: 'heal',
        time: 2,
        target: 'self',
        amount: 5,
        source: 'self',
        actor: 'self',
        sourceRole: 'self',
        triggerContext: 'main-action',
      },
    ],
  });
  const inputs = toRageRoundInputs(result, {rounds: 3});
  const rage = runScenario({
    rounds: 3,
    sides: {
      A: {sources: {poisonFireRefund: 10, selfHealRefund: 10}},
      B: {},
    },
    roundInputs: inputs,
  });
  const first = rage.sides.A.rounds[0];
  assert.equal(first.incomeBySource['enemy-direct-segment'], 5);
  assert.equal(first.incomeBySource['poison-fire-refund'], 10);
  const second = rage.sides.A.rounds[1];
  assert.equal(second.incomeBySource['self-heal-refund'], 10);
  assert.equal(inputs[0].sides.A.incomingSegments[0].shieldAbsorbed, 30);
  assert.equal(inputs[0].sides.A.poisonFireTicks, 1);
  return {result, rage};
});

check('rage-bridge-requires-owned-dot-hp-loss-and-legal-self-heal', () => {
  const result = runFixture({
    window: 2,
    hp: 50,
    maxHp: 100,
    enemyMaxHp: 1000,
    enemyInitialShield: 10,
    events: [
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'owned-shielded-dot',
        kind: 'dot',
        remainingTicks: 1,
        source: 'self-dot',
        dot: {amount: 15, mode: 'snapshot', target: 'enemy', sourceRole: 'self'},
      },
      {
        type: 'apply-status',
        time: 0,
        target: 'enemy',
        id: 'foreign-dot',
        kind: 'dot',
        remainingTicks: 1,
        source: 'enemy-dot',
        dot: {amount: 5, mode: 'snapshot', target: 'enemy', sourceRole: 'enemy'},
      },
      {type: 'tick', time: 1, target: 'enemy', id: 'owned-shielded-dot'},
      {type: 'tick', time: 1, target: 'enemy', id: 'foreign-dot'},
      {
        type: 'heal',
        time: 1,
        target: 'self',
        amount: 5,
        actor: 'enemy',
        sourceRole: 'external',
        triggerContext: 'main-action',
        source: 'enemy-gift',
      },
      {
        type: 'heal',
        time: 1,
        target: 'self',
        amount: 5,
        actor: 'self',
        sourceRole: 'self',
        triggerContext: 'enemy-action',
        source: 'bad-trigger',
      },
      {
        type: 'heal',
        time: 1,
        target: 'self',
        amount: 5,
        actor: 'self',
        sourceRole: 'self',
        triggerContext: 'out-of-battle',
        source: 'bad-context',
      },
      {
        type: 'heal',
        time: 1,
        target: 'self',
        amount: 5,
        actor: 'self',
        sourceRole: 'self',
        triggerContext: 'main-action',
        source: 'owned-heal',
      },
    ],
  });
  const inputs = toRageRoundInputs(result, {rounds: 2});
  assert.equal(inputs[0].sides.A.poisonFireTicks, 1);
  assert.equal(inputs[0].sides.A.selfHealActions, 1);
  close(result.damage.enemyHpDamage, 10, 'owned and foreign dot hp damage are ledgered separately');
  return {result, inputs};
});

check('rage-bridge-terminal-round-drops-pending-income', () => {
  const result = runFixture({
    window: 3,
    hp: 10,
    maxHp: 10,
    enemyMaxHp: 1000,
    events: [{
      type: 'damage',
      time: 1,
      target: 'self',
      actor: 'enemy',
      sourceRole: 'external',
      amount: 20,
      source: 'enemy',
    }],
  });
  assert.equal(result.earlyEnd, 'death');
  assert.equal(result.rageInputs[0].battleContinues, false);
  const rage = runScenario({
    rounds: 3,
    sides: {
      A: {sources: {selfHealRefund: 10}},
      B: {},
    },
    roundInputs: result.rageInputs,
  });
  const terminal = rage.sides.A.rounds[0];
  assert.equal(terminal.settled, false);
  assert.ok(terminal.pendingIncomeTotal > 0);
  assert.equal(terminal.discardedPendingIncome, terminal.pendingIncomeTotal);
  assert.equal(rage.sides.A.rage, 0);
  assert.equal(rage.roundsCompleted, 1);
  return {result, rage};
});

check('object-damage-function-delegates-once-to-explicit-formula', () => {
  const result = runFixture({
    window: 1,
    events: [{
      type: 'damage',
      time: 1,
      target: 'enemy',
      damageFunction: {type: 'subtract', base: 100, defense: 40},
    }],
  });
  close(result.D_raw, 60, 'object formula has no recursive delegation');
});

check('ineligible-attack-buff-is-neither-applied-nor-counted', () => {
  const result = runFixture({
    window: 1,
    events: [
      {
        type: 'apply-status', time: 0, target: 'self', id: 'attack',
        kind: 'buff', effect: 'attack-attribute', value: 0.25,
        coverage: {mode: 'qualified-events', key: 'attack'},
      },
      {
        type: 'damage', time: 1, target: 'enemy', actor: 'self',
        buffEligible: false, coverageKey: 'attack',
        formula: {type: 'subtract', base: 100, defense: 40, readsAttack: true},
      },
    ],
  });
  close(result.D_raw, 60, 'excluded attack buff cannot change damage');
  assert.equal(result.statusCoverage['self:attack'].affectedEvents, 0);
});

check('conditional-debuff-filters-match-damage-and-coverage', () => {
  const result = runFixture({
    window: 2,
    events: [
      {
        type: 'apply-status', time: 0, target: 'enemy', id: 'armor',
        kind: 'debuff', effect: 'armor-break', value: 10,
        appliesTo: {action: 'rage'},
        coverage: {mode: 'qualified-events', key: 'armor'},
      },
      ...['basic', 'rage'].map((action, index) => ({
        type: 'damage', time: index + 1, target: 'enemy', actor: 'self',
        action, coverageKey: 'armor',
        formula: {type: 'subtract', base: 100, defense: 40, armorBreakStatus: 'armor'},
      })),
    ],
  });
  assert.deepEqual(damageLedger(result).map((entry) => entry.effective), [60, 70]);
  assert.equal(result.statusCoverage['enemy:armor'].denominatorEvents, 1);
  assert.equal(result.statusCoverage['enemy:armor'].affectedEvents, 1);
});

check('invalid-negative-nan-and-out-of-order-inputs-are-rejected', () => {
  assert.throws(
    () => runFixture({window: 1, events: [{type: 'damage', time: 1, target: 'enemy', amount: -1}]}),
    /non-negative/,
  );
  assert.throws(
    () => runFixture({window: 1, events: [{type: 'damage', time: 1, target: 'enemy', amount: Number.NaN}]}),
    /finite/,
  );
  assert.throws(
    () => runFixture({
      window: 2,
      events: [
        {type: 'damage', time: 2, target: 'enemy', amount: 1},
        {type: 'damage', time: 1, target: 'enemy', amount: 1},
      ],
    }),
    /ordered/,
  );
  close(sampleDamage({
    type: 'subtract',
    base: 100,
    defense: 40,
    armorBreak: 10,
    weakness: 0.25,
  }), 45, 'explicit fixture damage formula');
  assert.throws(
    () => sampleDamage({type: 'subtract', base: 100, weakness: 1.1}),
    /between 0 and 1/,
  );
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
    fixtures: fixtureRows,
  };
}

function printAudit(report) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length > 0) process.exitCode = 1;
    return;
  }
  console.log('power-budget effects fixture audit');
  console.log(`checks: ${report.total}`);
  for (const failure of report.failed) {
    console.error(`FAIL ${failure.name}: ${failure.message}`);
  }
  if (report.fixtures.length > 0) console.table(report.fixtures);
  console.log(`PASS ${report.passed}/${report.total}`);
  if (report.failed.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printAudit(audit());
}
