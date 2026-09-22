import assert from 'node:assert/strict';

/**
 * This file is intentionally a resource-only model. It does not resolve
 * damage, victories, deaths from damage, or any runtime combat state.
 */

export const CONTRACT = Object.freeze({
  baseCap: 100,
  capFloor: 60,
  openingRage: 50,
  basicGain: 25,
  enemyDirectSegmentGain: 5,
  roundEndGain: 10,
  drainCap: 20,
  openingDrainCap: 50,
});

const SIDE_IDS = Object.freeze(['A', 'B']);
const EPSILON = 1e-9;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(finiteNumber(value, fallback));
}

function nonNegative(value) {
  return Math.max(0, finiteNumber(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sortedByKey(values, key) {
  return [...values].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

function sum(values) {
  return values.reduce((total, value) => total + finiteNumber(value), 0);
}

function asArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function normalizeDrainRequests(value, defaultKind = 'generic', defaultSource = 'input') {
  if (value == null) return [];
  if (typeof value === 'number') {
    return [{source: defaultSource, kind: defaultKind, amount: nonNegative(value)}];
  }
  if (!Array.isArray(value) && typeof value === 'object') {
    return Object.entries(value).flatMap(([kind, amount]) => (
      [{source: defaultSource, kind, amount: nonNegative(amount)}]
    ));
  }
  return asArray(value).flatMap((item, index) => {
    if (typeof item === 'number') {
      return [{source: `${defaultSource}-${index + 1}`, kind: defaultKind, amount: nonNegative(item)}];
    }
    if (!item || typeof item !== 'object') return [];
    return [{
      source: String(item.source ?? defaultSource),
      kind: String(item.kind ?? defaultKind),
      amount: nonNegative(item.amount),
    }];
  }).filter((item) => item.amount > 0);
}

function normalizeResistances(value) {
  return asArray(value).flatMap((item, index) => {
    if (typeof item === 'number') {
      return [{source: `resistance-${index + 1}`, kind: 'generic', value: finiteNumber(item)}];
    }
    if (!item || typeof item !== 'object') return [];
    return [{
      source: String(item.source ?? `resistance-${index + 1}`),
      kind: String(item.kind ?? 'generic'),
      value: finiteNumber(item.value),
    }];
  }).filter((item) => item.value !== 0);
}

/**
 * Same-kind resistance is additive, then clamped. Different kinds retain
 * their own bucket so a request can be reduced by the matching category.
 */
export function combineResistances(value) {
  const byKind = {};
  for (const item of normalizeResistances(value)) {
    byKind[item.kind] = clamp((byKind[item.kind] ?? 0) + item.value, 0, 1);
  }
  return {
    byKind,
    total: clamp(sum(Object.values(byKind)), 0, 1),
  };
}

export function resolveDrain(requests, resistances = [], cap = CONTRACT.drainCap) {
  const normalized = normalizeDrainRequests(requests);
  const combined = combineResistances(resistances);
  let adjusted = 0;
  for (const request of normalized) {
    const resistance = combined.byKind[request.kind] ?? combined.byKind.generic ?? 0;
    adjusted += request.amount * (1 - resistance);
  }
  const effective = Math.min(cap, Math.max(0, Math.floor(adjusted + EPSILON)));
  return {
    requests: sortedByKey(normalized, 'source'),
    raw: sum(normalized.map((request) => request.amount)),
    adjusted,
    resistance: clone(combined),
    effective,
  };
}

export function settleFormula({
  roundStartRage,
  paid = 0,
  pendingIncome = 0,
  cap = CONTRACT.baseCap,
  drainRequests = [],
  resistances = [],
  drainCap = CONTRACT.drainCap,
}) {
  const base = finiteNumber(roundStartRage) - finiteNumber(paid) + finiteNumber(pendingIncome);
  const drain = resolveDrain(drainRequests, resistances, drainCap);
  return {
    base,
    drain,
    end: Math.min(finiteNumber(cap), Math.max(0, base - drain.effective)),
  };
}

function normalizeBasicDrainSources(value) {
  return asArray(value).flatMap((item, index) => {
    if (typeof item === 'number') {
      return [{source: `basic-drain-${index + 1}`, kind: 'generic', amount: nonNegative(item)}];
    }
    if (!item || typeof item !== 'object') return [];
    return [{
      source: String(item.source ?? `basic-drain-${index + 1}`),
      kind: String(item.kind ?? 'generic'),
      amount: nonNegative(item.amount),
    }];
  }).filter((item) => item.amount > 0);
}

function normalizeRates(value) {
  return asArray(value).map((rate) => finiteNumber(rate)).filter((rate) => rate > 0);
}

function normalizeSources(raw = {}) {
  const rageRefundRates = normalizeRates(raw.rageRefundRates ?? raw.rageRefundRate);
  const basicDrainSources = normalizeBasicDrainSources(
    raw.basicDrainSources ?? raw.drainOnBasicHit,
  );
  // RR01 used the old `basicHitRefund` name before the input contract
  // distinguished a base attack from a basic-only hit.
  const baseAttackHitRefund = raw.baseAttackHitRefund ?? raw.basicHitRefund;
  return {
    basicExtraPerAction: nonNegative(raw.basicExtraPerAction),
    baseAttackHitRefund: nonNegative(baseAttackHitRefund),
    roundEndExtra: nonNegative(raw.roundEndExtra),
    rageFixedRefund: nonNegative(raw.rageFixedRefund),
    rageRefundRates,
    firstRageCapDelta: finiteNumber(raw.firstRageCapDelta),
    enemyTrueHpLossRefund: nonNegative(raw.enemyTrueHpLossRefund),
    shieldReturnRefund: nonNegative(raw.shieldReturnRefund),
    directCritRefund: nonNegative(raw.directCritRefund),
    poisonFireRefund: nonNegative(raw.poisonFireRefund),
    selfHealRefund: nonNegative(raw.selfHealRefund),
    extraPerEffectiveIncomingSegment: nonNegative(raw.extraPerEffectiveIncomingSegment),
    basicDrainSources,
    forceBasicAfterRage: Boolean(raw.forceBasicAfterRage),
    basicExtraAfterRage: nonNegative(raw.basicExtraAfterRage),
  };
}

function normalizeSide(raw = {}, id) {
  const sources = normalizeSources(raw.sources ?? raw);
  const capDelta = finiteNumber(raw.capDelta ?? raw.initialCapDelta);
  const forceBasicRounds = asArray(raw.forceBasicRounds ?? raw.forceBasicRound)
    .map((round) => integer(round))
    .filter((round) => round > 0);
  return {
    id,
    capDelta,
    openingBonus: finiteNumber(raw.openingBonus),
    openingDrainToOpponent: normalizeDrainRequests(
      raw.openingDrainToOpponent,
      'opening',
      `${id}-opening`,
    ),
    resistances: normalizeResistances(raw.resistances ?? raw.drainResistances ?? raw.resistance),
    forceBasicRounds,
    sources,
  };
}

function currentCap(sideState) {
  return clamp(
    CONTRACT.baseCap + sideState.config.capDelta + sideState.tempCapDelta,
    CONTRACT.capFloor,
    CONTRACT.baseCap,
  );
}

function normalizeSegment(segment) {
  if (segment == null) return {kind: 'enemy-direct', hpDamage: 0, shieldAbsorbed: 0};
  if (typeof segment === 'number') {
    return {kind: 'enemy-direct', hpDamage: nonNegative(segment), shieldAbsorbed: 0};
  }
  return {
    kind: String(segment.kind ?? 'enemy-direct'),
    hpDamage: nonNegative(segment.hpDamage),
    shieldAbsorbed: nonNegative(segment.shieldAbsorbed),
    evaded: Boolean(segment.evaded),
    valid: segment.valid == null ? undefined : Boolean(segment.valid),
  };
}

function isEffectiveEnemyDirectSegment(segment) {
  const item = normalizeSegment(segment);
  if (item.valid === false || item.evaded) return false;
  if (item.kind !== 'enemy-direct') return false;
  return item.hpDamage > 0 || item.shieldAbsorbed > 0;
}

function normalizeRoundInput(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const sides = input.sides && typeof input.sides === 'object' ? input.sides : input;
  return {
    sides: {
      A: clone(sides.A ?? {}),
      B: clone(sides.B ?? {}),
    },
    battleContinues: input.battleContinues !== false && input.continues !== false,
  };
}

function sideInput(roundInput, id) {
  return normalizeRoundInput(roundInput).sides[id];
}

function addIncome(round, source, amount, details = {}) {
  const value = nonNegative(amount);
  if (value <= 0) return;
  round.pendingIncome.push({
    source,
    amount: value,
    ...details,
  });
}

function addDrain(round, request) {
  if (!request || request.amount <= 0) return;
  round.pendingDrain.push({
    source: String(request.source ?? 'input'),
    kind: String(request.kind ?? 'generic'),
    amount: nonNegative(request.amount),
  });
}

function sortRoundInputs(round) {
  round.pendingIncome = sortedByKey(round.pendingIncome, 'source');
  round.pendingDrain = sortedByKey(round.pendingDrain, 'source');
}

function summarizeIncome(entries) {
  const bySource = {};
  for (const entry of entries) {
    bySource[entry.source] = (bySource[entry.source] ?? 0) + entry.amount;
  }
  return {
    total: sum(entries.map((entry) => entry.amount)),
    bySource,
  };
}

function defaultScenarioConfig(config = {}) {
  const rawSides = config.sides ?? {};
  const sides = {
    A: normalizeSide(rawSides.A ?? {}, 'A'),
    B: normalizeSide(rawSides.B ?? {}, 'B'),
  };
  return {
    rounds: Math.max(0, integer(config.rounds ?? 20)),
    sideOrder: (config.sideOrder ?? SIDE_IDS).map((id) => String(id)),
    sides,
    defaultRoundInput: clone(config.defaultRoundInput ?? config.roundInput ?? {}),
    roundInputs: Array.isArray(config.roundInputs) ? clone(config.roundInputs) : null,
  };
}

export class RageBattle {
  constructor(config = {}) {
    this.config = defaultScenarioConfig(config);
    this.state = {
      version: 1,
      initialized: false,
      finished: false,
      nextRound: 1,
      initialization: null,
      activeRound: null,
      trace: [],
      sides: {
        A: {
          id: 'A',
          config: clone(this.config.sides.A),
          rage: 0,
          tempCapDelta: 0,
          firstRageCapChangeConsumed: false,
          pendingForceBasic: false,
          round: null,
        },
        B: {
          id: 'B',
          config: clone(this.config.sides.B),
          rage: 0,
          tempCapDelta: 0,
          firstRageCapChangeConsumed: false,
          pendingForceBasic: false,
          round: null,
        },
      },
    };
  }

  static fromSnapshot(snapshot) {
    assert(snapshot && snapshot.config && snapshot.state, 'invalid RageBattle snapshot');
    const battle = new RageBattle(snapshot.config);
    battle.config = clone(snapshot.config);
    battle.state = clone(snapshot.state);
    return battle;
  }

  snapshot() {
    return {
      version: 1,
      config: clone(this.config),
      state: clone(this.state),
    };
  }

  initialize() {
    if (this.state.initialized) return this;
    const incoming = {A: [], B: []};
    for (const id of SIDE_IDS) {
      const opponent = id === 'A' ? 'B' : 'A';
      incoming[id].push(...clone(this.state.sides[opponent].config.openingDrainToOpponent));
    }

    const opening = {};
    for (const id of SIDE_IDS) {
      const side = this.state.sides[id];
      const cap = currentCap(side);
      const drain = resolveDrain(incoming[id], side.config.resistances, CONTRACT.openingDrainCap);
      const start = Math.min(
        cap,
        Math.max(0, CONTRACT.openingRage + side.config.openingBonus - drain.effective),
      );
      side.rage = start;
      opening[id] = {
        cap,
        base: CONTRACT.openingRage + side.config.openingBonus,
        openingBonus: side.config.openingBonus,
        drain,
        rage: start,
      };
    }
    this.state.initialized = true;
    this.state.initialization = opening;
    return this;
  }

  lockRound(roundNumber = this.state.nextRound) {
    this.initialize();
    assert(!this.state.finished, 'cannot lock a finished battle');
    assert(!this.state.activeRound, 'a round is already active');
    assert.equal(roundNumber, this.state.nextRound, 'rounds must lock sequentially');
    const locked = {};
    for (const id of SIDE_IDS) {
      const side = this.state.sides[id];
      const cap = currentCap(side);
      const forcedByRage = Boolean(side.pendingForceBasic);
      const forcedBasic = forcedByRage || side.config.forceBasicRounds.includes(roundNumber);
      const action = forcedBasic || side.rage < cap ? 'basic' : 'rage';
      const cost = action === 'rage' ? cap : 0;
      side.round = {
        number: roundNumber,
        rageAtStart: side.rage,
        capAtStart: cap,
        action,
        lockedCost: cost,
        paid: 0,
        executed: false,
        pendingIncome: [],
        pendingDrain: [],
        pendingCapDelta: 0,
        forcedBasicAfterRage: forcedByRage,
      };
      side.pendingForceBasic = false;
      locked[id] = {
        action,
        cost,
        rageAtStart: side.rage,
        cap,
        forcedBasic,
        forcedBasicAfterRage: forcedByRage,
      };
    }
    this.state.activeRound = {
      number: roundNumber,
      locked,
    };
    return clone(locked);
  }

  executeSide(id, rawInput = {}) {
    assert(SIDE_IDS.includes(id), `unknown side ${id}`);
    assert(this.state.activeRound, 'lockRound must run before executeSide');
    const side = this.state.sides[id];
    const round = side.round;
    assert(round && !round.executed, `${id} has already executed this round`);
    const input = rawInput && typeof rawInput === 'object' ? rawInput : {};

    round.paid = round.lockedCost;
    side.rage = Math.max(0, round.rageAtStart - round.paid);
    if (round.action === 'basic') {
      addIncome(round, 'basic-action', CONTRACT.basicGain);
      if (side.config.sources.basicExtraPerAction > 0) {
        addIncome(round, 'basic-extra', side.config.sources.basicExtraPerAction);
      }
      if (
        round.forcedBasicAfterRage
        && side.config.sources.basicExtraAfterRage > 0
      ) {
        addIncome(
          round,
          'rage-after-basic-extra',
          side.config.sources.basicExtraAfterRage,
        );
      }
    } else {
      const rate = sum(side.config.sources.rageRefundRates);
      if (rate > 0) {
        addIncome(round, 'rage-ratio-refund', Math.floor(round.paid * rate / 100 + EPSILON), {
          rate,
          paid: round.paid,
        });
      }
      if (side.config.sources.rageFixedRefund > 0) {
        addIncome(round, 'rage-fixed-refund', side.config.sources.rageFixedRefund);
      }
      if (
        side.config.sources.firstRageCapDelta !== 0
        && !side.firstRageCapChangeConsumed
      ) {
        round.pendingCapDelta += side.config.sources.firstRageCapDelta;
        side.firstRageCapChangeConsumed = true;
      }
      if (side.config.sources.forceBasicAfterRage) {
        side.pendingForceBasic = true;
      }
    }

    const effectiveBaseAttackHit = Math.min(
      1,
      Math.max(0, integer(input.baseAttackEffectiveHits)),
    );
    if (
      (round.action === 'basic' || round.action === 'rage')
      && effectiveBaseAttackHit > 0
      && side.config.sources.baseAttackHitRefund > 0
    ) {
      addIncome(
        round,
        'base-attack-hit-refund',
        side.config.sources.baseAttackHitRefund,
      );
    }

    const effectiveBasicHit = Math.min(
      1,
      Math.max(0, integer(input.basicEffectiveHits)),
    );
    if (round.action === 'basic' && effectiveBasicHit > 0) {
      for (const request of side.config.sources.basicDrainSources) {
        addDrain(this.state.sides[id === 'A' ? 'B' : 'A'].round, {
          ...request,
          source: request.source,
        });
      }
    }

    const segments = asArray(input.incomingSegments);
    for (const rawSegment of segments) {
      const segment = normalizeSegment(rawSegment);
      if (!isEffectiveEnemyDirectSegment(segment)) continue;
      addIncome(round, 'enemy-direct-segment', CONTRACT.enemyDirectSegmentGain, {
        kind: segment.kind,
        shieldAbsorbed: segment.shieldAbsorbed,
        hpDamage: segment.hpDamage,
      });
      if (side.config.sources.extraPerEffectiveIncomingSegment > 0) {
        addIncome(
          round,
          'effective-segment-extra',
          side.config.sources.extraPerEffectiveIncomingSegment,
        );
      }
    }

    const trueHpLossActions = Math.max(0, integer(input.trueEnemyHpLossActions));
    if (trueHpLossActions > 0 && side.config.sources.enemyTrueHpLossRefund > 0) {
      addIncome(
        round,
        'true-hp-loss-refund',
        trueHpLossActions * side.config.sources.enemyTrueHpLossRefund,
      );
    }

    const shieldReturnActions = Math.max(0, integer(input.effectiveShieldReturnActions));
    if (shieldReturnActions > 0 && side.config.sources.shieldReturnRefund > 0) {
      addIncome(
        round,
        'shield-return-refund',
        shieldReturnActions * side.config.sources.shieldReturnRefund,
      );
    }

    const directCrits = Math.min(2, Math.max(0, integer(input.directCrits)));
    if (directCrits > 0 && side.config.sources.directCritRefund > 0) {
      addIncome(
        round,
        'direct-crit-refund',
        directCrits * side.config.sources.directCritRefund,
        {count: directCrits},
      );
    }

    const poisonFireTicks = Math.min(1, Math.max(0, integer(input.poisonFireTicks)));
    if (poisonFireTicks > 0 && side.config.sources.poisonFireRefund > 0) {
      addIncome(round, 'poison-fire-refund', side.config.sources.poisonFireRefund);
    }

    const selfHealActions = Math.min(1, Math.max(0, integer(input.selfHealActions)));
    if (selfHealActions > 0 && side.config.sources.selfHealRefund > 0) {
      addIncome(round, 'self-heal-refund', side.config.sources.selfHealRefund);
    }

    for (const entry of asArray(input.extraIncome)) {
      if (!entry || typeof entry !== 'object') continue;
      addIncome(round, String(entry.source ?? 'explicit-income'), entry.amount);
    }
    for (const request of normalizeDrainRequests(input.drainRequests)) {
      addDrain(round, request);
    }

    round.executed = true;
    sortRoundInputs(round);
    return clone({
      action: round.action,
      paid: round.paid,
      pendingIncome: round.pendingIncome,
      pendingDrain: round.pendingDrain,
    });
  }

  executeRound(actionOrder = this.config.sideOrder, rawRoundInput = {}) {
    assert(this.state.activeRound, 'lockRound must run before executeRound');
    const input = normalizeRoundInput(rawRoundInput);
    const order = actionOrder.map((id) => String(id));
    assert.deepEqual([...order].sort(), [...SIDE_IDS].sort(), 'actionOrder must contain A and B');
    for (const id of order) this.executeSide(id, input.sides[id]);
    return this;
  }

  settleRound(options = {}) {
    assert(this.state.activeRound, 'no active round to settle');
    for (const id of SIDE_IDS) {
      assert(this.state.sides[id].round?.executed, `${id} has not executed this round`);
    }
    const battleContinues = options.battleContinues !== false;
    const number = this.state.activeRound.number;
    const settled = {};

    for (const id of SIDE_IDS) {
      const side = this.state.sides[id];
      const round = side.round;
      addIncome(round, 'natural-round-end', CONTRACT.roundEndGain);
      if (side.config.sources.roundEndExtra > 0) {
        addIncome(round, 'round-end-extra', side.config.sources.roundEndExtra);
      }
      sortRoundInputs(round);
      const income = summarizeIncome(round.pendingIncome);
      const capBefore = round.capAtStart;
      const capAfterDelta = round.pendingCapDelta;
      side.tempCapDelta += capAfterDelta;
      const capAfter = currentCap(side);
      const drain = resolveDrain(round.pendingDrain, side.config.resistances);
      const base = round.rageAtStart - round.paid + income.total;
      const end = battleContinues
        ? Math.min(capAfter, Math.max(0, base - drain.effective))
        : 0;
      side.rage = end;
      settled[id] = {
        number,
        action: round.action,
        forcedBasicAfterRage: round.forcedBasicAfterRage,
        rageAtStart: round.rageAtStart,
        capAtStart: capBefore,
        lockedCost: round.lockedCost,
        paid: round.paid,
        pendingIncome: clone(round.pendingIncome),
        pendingIncomeTotal: income.total,
        incomeBySource: income.bySource,
        pendingDrain: clone(drain.requests),
        drainRaw: drain.raw,
        drainAdjusted: drain.adjusted,
        drainResistance: drain.resistance,
        effectiveDrain: drain.effective,
        pendingCapDelta: capAfterDelta,
        capAfter,
        baseBeforeDrain: base,
        rageAtEnd: end,
        settled: battleContinues,
        discardedPendingIncome: battleContinues ? 0 : income.total,
      };
      side.round = null;
    }

    this.state.trace.push({
      number,
      sides: settled,
      settled: battleContinues,
    });
    this.state.activeRound = null;
    this.state.nextRound += 1;
    if (!battleContinues) this.state.finished = true;
    return clone(settled);
  }

  result() {
    const sideResult = {};
    for (const id of SIDE_IDS) {
      const side = this.state.sides[id];
      sideResult[id] = {
        rage: side.rage,
        cap: currentCap(side),
        rounds: this.state.trace.map((entry) => entry.sides[id]),
        opening: this.state.initialization?.[id] ?? null,
      };
    }
    return {
      initialized: this.state.initialized,
      finished: this.state.finished,
      roundsCompleted: this.state.trace.length,
      trace: clone(this.state.trace),
      sides: sideResult,
    };
  }
}

export function runScenario(config = {}) {
  const battle = new RageBattle(config);
  battle.initialize();
  const rounds = battle.config.roundInputs ?? Array.from(
    {length: battle.config.rounds},
    () => battle.config.defaultRoundInput,
  );
  for (let index = 0; index < rounds.length; index += 1) {
    if (battle.state.finished) break;
    battle.lockRound(index + 1);
    const input = rounds[index] ?? {};
    const normalized = normalizeRoundInput(input);
    battle.executeRound(battle.config.sideOrder, normalized);
    battle.settleRound({battleContinues: normalized.battleContinues});
  }
  return battle.result();
}

export function restoreBattle(snapshot) {
  return RageBattle.fromSnapshot(snapshot);
}

function normalizeLayerCount(value, name) {
  const count = Number(value ?? 0);
  assert(
    Number.isInteger(count) && count >= 0 && count <= 3,
    `${name} layers must be an integer from 0 to 3`,
  );
  return count;
}

export function makePath({J1, J2, J4, RC21 = 0, RC23 = 0} = {}) {
  const allowed = {
    J1: new Set(['A', 'B', 'C', undefined]),
    J2: new Set(['A', 'B', 'C', undefined]),
    J4: new Set(['A', 'B', 'C', undefined]),
  };
  for (const [tier, choice] of Object.entries({J1, J2, J4})) {
    assert(allowed[tier].has(choice), `${tier} has more than one or an invalid choice`);
  }
  const rc21Layers = normalizeLayerCount(RC21, 'RC21');
  const rc23Layers = normalizeLayerCount(RC23, 'RC23');
  const path = {
    capDelta: J1 === 'A' ? -10 : 0,
    rageRefundRates: [J2 === 'C' ? 40 : 20],
    basicExtraPerAction: J1 === 'B' ? 10 : 0,
    baseAttackHitRefund: J2 === 'A' ? 10 : 0,
    roundEndExtra: J2 === 'B' ? 10 : 0,
    J1,
    J2,
    J4,
  };
  if (J4 === 'A') path.rageRefundRates.push(20);
  if (J4 === 'C') {
    path.forceBasicAfterRage = true;
    path.basicExtraAfterRage = 15;
  }
  if (rc21Layers > 0) path.roundEndExtra += 5 * rc21Layers;
  if (rc23Layers > 0) path.rageFixedRefund = 5 * rc23Layers;
  return path;
}

function repeatInput(rounds, inputA = {}, inputB = inputA, extra = {}) {
  return Array.from({length: rounds}, () => ({
    sides: {
      A: clone(inputA),
      B: clone(inputB),
    },
    ...clone(extra),
  }));
}

function validSegments(count) {
  return Array.from({length: count}, () => ({kind: 'enemy-direct', hpDamage: 1}));
}

function baselineConfig({
  rounds = 20,
  segments = 1,
  sideA = {},
  sideB = sideA,
  inputA = {},
  inputB = inputA,
  extra = {},
} = {}) {
  return {
    rounds,
    sides: {A: sideA, B: sideB},
    roundInputs: repeatInput(
      rounds,
      {incomingSegments: validSegments(segments), ...inputA},
      {incomingSegments: validSegments(segments), ...inputB},
      extra,
    ),
  };
}

function rageRounds(result, side = 'A') {
  return result.sides[side].rounds.filter((round) => round.action === 'rage').map((round) => round.number);
}

function firstRages(result, side = 'A', count = 3) {
  return rageRounds(result, side).slice(0, count);
}

function endValues(result, side = 'A', count = 7) {
  return result.sides[side].rounds.slice(0, count).map((round) => round.rageAtEnd);
}

function incomeBySource(round) {
  return Object.fromEntries(
    round.pendingIncome.map((entry) => [entry.source, entry.amount]),
  );
}

function orderPair(config) {
  const forward = runScenario({...clone(config), sideOrder: ['A', 'B']});
  const reverse = runScenario({...clone(config), sideOrder: ['B', 'A']});
  assert.deepEqual(
    forward.trace,
    reverse.trace,
    'swapping side execution order changed the complete settled trace',
  );
  assert.deepEqual(forward.sides.A.rounds, reverse.sides.A.rounds);
  assert.deepEqual(forward.sides.B.rounds, reverse.sides.B.rounds);
  return forward;
}

function sourceScenario({
  sourceSide = {},
  inputSide = {},
  rounds = 20,
  segments = 1,
} = {}) {
  return baselineConfig({
    rounds,
    segments,
    sideA: sourceSide,
    sideB: sourceSide,
    inputA: inputSide,
    inputB: inputSide,
  });
}

function directHitInputs(rounds, field, value = 1) {
  return repeatInput(
    rounds,
    {incomingSegments: validSegments(1), [field]: value},
  );
}

const checks = [];
const coreRows = [];
let scenarioCount = 0;

function check(name, fn, core = false) {
  try {
    const value = fn();
    checks.push({name, passed: true});
    if (core && value) coreRows.push(value);
    return value;
  } catch (error) {
    checks.push({name, passed: false, error});
    return null;
  }
}

function scenario(name, config, assertion, core = false) {
  scenarioCount += 1;
  return check(name, () => {
    const result = orderPair(config);
    assertion(result);
    if (!core) return null;
    return {
      scenario: name,
      first: firstRages(result).join('/'),
      tail: endValues(result).join('/'),
      cap: result.sides.A.cap,
    };
  }, core);
}

function expectRages(result, expected, side = 'A') {
  assert.deepEqual(firstRages(result, side, expected.length), expected);
}

function expectIncomeTotal(result, roundNumber, side, expected) {
  assert.equal(result.sides[side].rounds[roundNumber - 1].pendingIncomeTotal, expected);
}

// Core rhythm: the one-hit baseline is the explicit 90/100/15/55/95/100/15 ledger.
scenario(
  'baseline-18-one-hit',
  baselineConfig({rounds: 18}),
  (result) => {
    expectRages(result, [3, 7, 11]);
    assert.deepEqual(endValues(result), [90, 100, 15, 55, 95, 100, 15]);
  },
  true,
);
scenario(
  'baseline-20-one-hit',
  baselineConfig({rounds: 20}),
  (result) => {
    expectRages(result, [3, 7, 11]);
    assert.deepEqual(endValues(result), [90, 100, 15, 55, 95, 100, 15]);
  },
  true,
);
scenario(
  'baseline-no-hit',
  baselineConfig({rounds: 12, segments: 0}),
  (result) => expectRages(result, [3, 7]),
  true,
);
scenario(
  'baseline-two-segments',
  baselineConfig({rounds: 12, segments: 2}),
  (result) => expectRages(result, [3, 6]),
  true,
);
scenario(
  'baseline-three-segments',
  baselineConfig({rounds: 12, segments: 3}),
  (result) => expectRages(result, [2, 5]),
  true,
);

for (const layers of [1, 2, 3]) {
  scenario(
    `RC19-cap-minus-${layers * 5}`,
    baselineConfig({
      sideA: {capDelta: -5 * layers},
      sideB: {capDelta: -5 * layers},
    }),
    (result) => expectRages(result, layers === 1 ? [3, 6] : [2, 5]),
    true,
  );
  scenario(
    `RC20-basic-extra-${layers * 5}`,
    baselineConfig({
      sideA: {sources: {basicExtraPerAction: 5 * layers}},
      sideB: {sources: {basicExtraPerAction: 5 * layers}},
    }),
    (result) => expectRages(result, layers === 1 ? [3, 6] : [2, 5]),
    true,
  );
  scenario(
    `RC21-round-extra-${layers * 5}`,
    baselineConfig({
      sideA: {sources: {roundEndExtra: 5 * layers}},
      sideB: {sources: {roundEndExtra: 5 * layers}},
    }),
    (result) => expectRages(result, layers === 1 ? [3, 6] : [2, 5]),
    true,
  );
  scenario(
    `RC22-opening-extra-${layers * 15}`,
    baselineConfig({
      sideA: {openingBonus: 15 * layers},
      sideB: {openingBonus: 15 * layers},
    }),
    (result) => expectRages(result, [2, 6]),
    true,
  );
  scenario(
    `RC23-fixed-refund-${layers * 5}`,
    baselineConfig({
      sideA: {sources: {rageFixedRefund: 5 * layers}},
      sideB: {sources: {rageFixedRefund: 5 * layers}},
    }),
    (result) => expectRages(result, [3, 6]),
    true,
  );
}

scenario(
  'RC24-effective-segment-extra',
  baselineConfig({
    sideA: {sources: {extraPerEffectiveIncomingSegment: 2 * 3}},
    sideB: {sources: {extraPerEffectiveIncomingSegment: 2 * 3}},
  }),
  (result) => {
    expectRages(result, [3, 6]);
    assert.equal(result.sides.A.rounds[0].incomeBySource['effective-segment-extra'], 6);
    assert.equal(result.sides.A.rounds[0].pendingIncomeTotal, 46);
  },
  true,
);

scenario(
  'RR01-basic-hit-explicit',
  sourceScenario({
    sourceSide: {sources: {baseAttackHitRefund: 10}},
    inputSide: {baseAttackEffectiveHits: 1},
  }),
  (result) => {
    expectRages(result, [2, 5]);
    assert.equal(result.sides.A.rounds[0].incomeBySource['base-attack-hit-refund'], 10);
    assert.equal(result.sides.A.rounds[1].incomeBySource['base-attack-hit-refund'], 10);
  },
  true,
);
scenario(
  'RR01-no-input-no-refund',
  sourceScenario({
    sourceSide: {sources: {baseAttackHitRefund: 10}},
    inputSide: {poisonFireTicks: 1},
  }),
  (result) => {
    expectRages(result, [3, 7]);
    assert.equal(result.sides.A.rounds[0].incomeBySource['base-attack-hit-refund'], undefined);
  },
);
scenario(
  'RR01-rage-base-attack-hit-explicit',
  baselineConfig({
    rounds: 1,
    sideA: {openingBonus: 50, sources: {basicHitRefund: 10}},
    sideB: {openingBonus: 50, sources: {basicHitRefund: 10}},
    inputA: {baseAttackEffectiveHits: 1},
    inputB: {baseAttackEffectiveHits: 1},
  }),
  (result) => {
    const round = result.sides.A.rounds[0];
    assert.equal(round.action, 'rage');
    assert.equal(round.incomeBySource['base-attack-hit-refund'], 10);
    assert.equal(round.pendingIncomeTotal, 25);
  },
  true,
);
scenario(
  'RR01-basic-only-input-does-not-trigger-on-rage',
  baselineConfig({
    rounds: 1,
    sideA: {openingBonus: 50, sources: {baseAttackHitRefund: 10}},
    sideB: {openingBonus: 50, sources: {baseAttackHitRefund: 10}},
    inputA: {basicEffectiveHits: 1},
    inputB: {basicEffectiveHits: 1},
  }),
  (result) => {
    const round = result.sides.A.rounds[0];
    assert.equal(round.action, 'rage');
    assert.equal(round.incomeBySource['base-attack-hit-refund'], undefined);
    assert.equal(round.pendingIncomeTotal, 15);
  },
);
scenario(
  'RR07-first-rage-cap-change',
  baselineConfig({
    sideA: {sources: {firstRageCapDelta: -15}},
    sideB: {sources: {firstRageCapDelta: -15}},
  }),
  (result) => {
    expectRages(result, [3, 6]);
    assert.equal(result.sides.A.rounds[2].paid, 100);
    assert.equal(result.sides.A.rounds[2].capAfter, 85);
    assert.equal(result.sides.A.rounds[5].paid, 85);
  },
  true,
);

for (const [name, sourceKey, inputKey, expected] of [
  ['RR08-true-hp-loss-explicit', 'enemyTrueHpLossRefund', 'trueEnemyHpLossActions', [2, 5]],
  ['RR09-shield-return-explicit', 'shieldReturnRefund', 'effectiveShieldReturnActions', [2, 5]],
  ['RR10-direct-crit-max-two', 'directCritRefund', 'directCrits', [2, 5]],
  ['RR11-poison-fire-explicit', 'poisonFireRefund', 'poisonFireTicks', [2, 5]],
  ['RR12-self-heal-explicit', 'selfHealRefund', 'selfHealActions', [2, 5]],
]) {
  const sourceAmount = sourceKey === 'directCritRefund' ? 5 : 10;
  scenario(
    name,
    sourceScenario({
      sourceSide: {sources: {[sourceKey]: sourceAmount}},
      inputSide: {[inputKey]: inputKey === 'directCrits' ? 3 : 1},
    }),
    (result) => {
      expectRages(result, expected);
      const roundOne = result.sides.A.rounds[0];
      assert.equal(roundOne.pendingIncomeTotal, 50);
      assert.ok(roundOne.pendingIncome.some((entry) => entry.source.endsWith('refund')));
      if (inputKey === 'directCrits') {
        assert.equal(roundOne.incomeBySource['direct-crit-refund'], 10);
      }
    },
    true,
  );
}

scenario(
  'RL04-opening-plus-fifty',
  baselineConfig({
    sideA: {openingBonus: 50},
    sideB: {openingBonus: 50},
  }),
  (result) => expectRages(result, [1, 5, 9]),
  true,
);
scenario(
  'RL05-fixed-fifty-refund',
  baselineConfig({
    sideA: {sources: {rageFixedRefund: 50}},
    sideB: {sources: {rageFixedRefund: 50}},
  }),
  (result) => expectRages(result, [3, 5, 7]),
  true,
);
scenario(
  'base-rage-refund-rate-twenty',
  baselineConfig({
    sideA: {sources: {rageRefundRates: [20]}},
    sideB: {sources: {rageRefundRates: [20]}},
  }),
  (result) => expectRages(result, [3, 6, 9]),
  true,
);

const mediumPath = makePath({J1: 'A', J2: 'C'});
scenario(
  'path-medium-J1A-J2C',
  baselineConfig({
    sideA: mediumPath,
    sideB: mediumPath,
  }),
  (result) => expectRages(result, [2, 4, 6]),
  true,
);

const highPath = makePath({J1: 'A', J2: 'C', J4: 'A', RC21: 3, RC23: 3});
scenario(
  'path-high-J4A-RC21-RC23',
  baselineConfig({
    sideA: highPath,
    sideB: highPath,
  }),
  (result) => {
    expectRages(result, [2, 3, 4]);
    const rageRound = result.sides.A.rounds[1];
    assert.equal(rageRound.paid, 90);
    assert.equal(rageRound.pendingIncomeTotal, 99);
    assert.equal(rageRound.incomeBySource['rage-ratio-refund'], 54);
    assert.equal(
      rageRound.incomeBySource['natural-round-end']
      + rageRound.incomeBySource['rage-fixed-refund'],
      25,
    );
    assert.equal(rageRound.incomeBySource['round-end-extra'], 15);
    assert.equal(rageRound.incomeBySource['enemy-direct-segment'], 5);
  },
  true,
);

check('path-one-choice-per-tier-and-no-J2B-leak', () => {
  const path = makePath({J1: 'A', J2: 'C'});
  assert.equal(path.capDelta, -10);
  assert.deepEqual(path.rageRefundRates, [40]);
  assert.equal(path.roundEndExtra, 0);
  const J2B = makePath({J1: 'A', J2: 'B'});
  assert.equal(J2B.roundEndExtra, 10);
  assert.deepEqual(J2B.rageRefundRates, [20]);
  const J1B = makePath({J1: 'B'});
  assert.equal(J1B.basicExtraPerAction, 10);
  const J2A = makePath({J2: 'A'});
  assert.equal(J2A.baseAttackHitRefund, 10);
  const J4A = makePath({J4: 'A'});
  assert.deepEqual(J4A.rageRefundRates, [20, 20]);
  assert.throws(() => makePath({J2: ['A', 'C']}), /J2 has more than one/);
  assert.throws(() => makePath({RC21: 4}), /RC21 layers/);
  assert.throws(() => makePath({RC23: 3.5}), /RC23 layers/);
});

scenario(
  'path-J4C-forced-basic-and-plus-fifteen',
  baselineConfig({
    rounds: 8,
    sideA: makePath({J4: 'C'}),
    sideB: makePath({J4: 'C'}),
  }),
  (result) => {
    assert.deepEqual(
      result.sides.A.rounds.slice(0, 5).map((round) => round.action),
      ['basic', 'basic', 'rage', 'basic', 'basic'],
    );
    const forced = result.sides.A.rounds[3];
    assert.equal(forced.forcedBasicAfterRage, true);
    assert.equal(forced.incomeBySource['basic-action'], 25);
    assert.equal(forced.incomeBySource['rage-after-basic-extra'], 15);
    assert.equal(forced.pendingIncomeTotal, 55);
  },
  true,
);

for (const [name, sideOverrides, expected] of [
  ['pressure-bare', {}, [4, 10, 16]],
  ['pressure-high', highPath, [3, 5, 7]],
]) {
  scenario(
    name,
    baselineConfig({
      sideA: sideOverrides,
      sideB: sideOverrides,
      extra: {},
      inputA: {drainRequests: [{source: 'worst-case-pressure', kind: 'pressure', amount: 20}]},
      inputB: {drainRequests: [{source: 'worst-case-pressure', kind: 'pressure', amount: 20}]},
    }),
    (result) => expectRages(result, expected),
    true,
  );
}
scenario(
  'pressure-cancelled-by-round-end-twenty',
  baselineConfig({
    sideA: {sources: {roundEndExtra: 20}},
    sideB: {sources: {roundEndExtra: 20}},
    inputA: {drainRequests: [{source: 'pressure', kind: 'pressure', amount: 20}]},
    inputB: {drainRequests: [{source: 'pressure', kind: 'pressure', amount: 20}]},
  }),
  (result) => expectRages(result, [3, 7]),
  true,
);

scenario(
  'actual-loadout-RR13-plus-J2A',
  baselineConfig({
    sideA: {
      sources: {
        basicDrainSources: [
          {source: 'RR13', kind: 'sever', amount: 10},
          {source: 'J2A', kind: 'sever', amount: 10},
        ],
      },
    },
    sideB: {},
    inputA: {basicEffectiveHits: 1},
    inputB: {basicEffectiveHits: 1},
  }),
  (result) => {
    expectRages(result, [3, 7], 'A');
    assert.ok(rageRounds(result, 'B').length > 0);
    assert.equal(result.sides.B.rounds[0].effectiveDrain, 20);
    assert.equal(result.sides.A.rounds[0].effectiveDrain, 0);
    assert.equal(result.sides.B.rounds[2].effectiveDrain, 0);
  },
  true,
);
scenario(
  'actual-loadout-with-RR15-half-resistance',
  baselineConfig({
    sideA: {
      sources: {
        basicDrainSources: [
          {source: 'RR13', kind: 'sever', amount: 10},
          {source: 'J2A', kind: 'sever', amount: 10},
        ],
      },
    },
    sideB: {resistances: [{source: 'RR15', kind: 'sever', value: 0.5}]},
    inputA: {basicEffectiveHits: 1},
    inputB: {basicEffectiveHits: 1},
  }),
  (result) => {
    assert.equal(result.sides.B.rounds[0].drainRaw, 20);
    assert.equal(result.sides.B.rounds[0].effectiveDrain, 10);
    expectRages(result, [3, 7], 'B');
  },
  true,
);

scenario(
  'opening-plus-fifty-versus-opening-minus-thirty',
  baselineConfig({
    sideA: {openingBonus: 50},
    sideB: {openingDrainToOpponent: [{source: 'RR14', kind: 'opening', amount: 30}]},
  }),
  (result) => {
    assert.equal(result.sides.A.opening.rage, 70);
    assert.equal(result.sides.A.opening.drain.effective, 30);
    expectRages(result, [2, 6], 'A');
  },
  true,
);
scenario(
  'opening-minus-thirty-without-bonus',
  baselineConfig({
    sideB: {openingDrainToOpponent: [{source: 'RR14', kind: 'opening', amount: 30}]},
  }),
  (result) => {
    assert.equal(result.sides.A.opening.rage, 20);
    expectRages(result, [3, 7], 'A');
  },
);
scenario(
  'both-direction-opening-effects-order-independent',
  baselineConfig({
    sideA: {
      openingBonus: 50,
      openingDrainToOpponent: [{source: 'A-opening', kind: 'opening', amount: 30}],
    },
    sideB: {
      openingBonus: 50,
      openingDrainToOpponent: [{source: 'B-opening', kind: 'opening', amount: 30}],
    },
  }),
  (result) => {
    assert.equal(result.sides.A.opening.rage, 70);
    assert.equal(result.sides.B.opening.rage, 70);
  },
);

check('same-kind-resistance-adds-and-clamps', () => {
  const combined = combineResistances([
    {kind: 'sever', value: 0.3},
    {kind: 'sever', value: 0.3},
    {kind: 'other', value: 0.8},
    {kind: 'other', value: 0.8},
  ]);
  assert.equal(combined.byKind.sever, 0.6);
  assert.equal(combined.byKind.other, 1);
  assert.equal(resolveDrain([{kind: 'sever', amount: 20}], [
    {kind: 'sever', value: 0.3},
    {kind: 'sever', value: 0.3},
  ]).effective, 8);
});

scenario(
  'multi-source-drain-cap-twenty',
  baselineConfig({
    inputA: {
      drainRequests: [
        {source: 'one', kind: 'pressure', amount: 10},
        {source: 'two', kind: 'pressure', amount: 15},
        {source: 'three', kind: 'pressure', amount: 20},
      ],
    },
    inputB: {
      drainRequests: [
        {source: 'one', kind: 'pressure', amount: 10},
        {source: 'two', kind: 'pressure', amount: 15},
        {source: 'three', kind: 'pressure', amount: 20},
      ],
    },
  }),
  (result) => {
    assert.equal(result.sides.A.rounds[0].drainRaw, 45);
    assert.equal(result.sides.A.rounds[0].effectiveDrain, 20);
    assert.equal(result.sides.A.rounds[0].pendingDrain.length, 3);
  },
);
scenario(
  'drain-cap-after-resistance',
  baselineConfig({
    sideA: {resistances: [{kind: 'pressure', value: 0.5}]},
    sideB: {resistances: [{kind: 'pressure', value: 0.5}]},
    inputA: {
      drainRequests: [
        {source: 'one', kind: 'pressure', amount: 30},
        {source: 'two', kind: 'pressure', amount: 30},
      ],
    },
    inputB: {
      drainRequests: [
        {source: 'one', kind: 'pressure', amount: 30},
        {source: 'two', kind: 'pressure', amount: 30},
      ],
    },
  }),
  (result) => {
    assert.equal(result.sides.A.rounds[0].drainRaw, 60);
    assert.equal(result.sides.A.rounds[0].drainAdjusted, 30);
    assert.equal(result.sides.A.rounds[0].effectiveDrain, 20);
  },
);

check('settlement-drain-happens-before-final-cap-clamp', () => {
  const result = settleFormula({
    roundStartRage: 130,
    paid: 0,
    pendingIncome: 0,
    cap: 100,
    drainRequests: [{amount: 20, kind: 'pressure'}],
  });
  assert.equal(result.base, 130);
  assert.equal(result.drain.effective, 20);
  assert.equal(result.end, 100);
});
check('zero-lower-bound', () => {
  const result = settleFormula({
    roundStartRage: 5,
    paid: 0,
    pendingIncome: 0,
    cap: 100,
    drainRequests: [{amount: 999, kind: 'pressure'}],
  });
  assert.equal(result.end, 0);
});

scenario(
  'force-basic-at-full-rage',
  baselineConfig({
    sideA: {openingBonus: 50, forceBasicRounds: [1]},
    sideB: {openingBonus: 50, forceBasicRounds: [1]},
  }),
  (result) => {
    assert.equal(result.sides.A.opening.rage, 100);
    assert.equal(result.sides.A.rounds[0].action, 'basic');
    assert.equal(result.sides.A.rounds[1].action, 'rage');
  },
);
scenario(
  'locked-rage-survives-same-round-drain',
  baselineConfig({
    sideA: {openingBonus: 50},
    sideB: {openingBonus: 50},
    inputA: {drainRequests: [{source: 'late-drain', kind: 'pressure', amount: 20}]},
    inputB: {drainRequests: [{source: 'late-drain', kind: 'pressure', amount: 20}]},
  }),
  (result) => {
    assert.equal(result.sides.A.rounds[0].action, 'rage');
    assert.equal(result.sides.A.rounds[0].lockedCost, 100);
    assert.equal(result.sides.A.rounds[0].paid, 100);
    assert.equal(result.sides.A.rounds[0].effectiveDrain, 20);
    assert.equal(result.sides.A.rounds[0].rageAtEnd, 0);
  },
);

scenario(
  'valid-segment-is-counted-once',
  baselineConfig({
    inputA: {
      incomingSegments: [{
        kind: 'enemy-direct',
        hpDamage: 2,
        shieldAbsorbed: 3,
      }],
    },
    inputB: {
      incomingSegments: [{
        kind: 'enemy-direct',
        hpDamage: 2,
        shieldAbsorbed: 3,
      }],
    },
  }),
  (result) => {
    assert.equal(result.sides.A.rounds[0].incomeBySource['enemy-direct-segment'], 5);
  },
);
scenario(
  'zero-evade-poison-recoil-self-and-event-do-not-count',
  baselineConfig({
    inputA: {
      incomingSegments: [
        {kind: 'enemy-direct', hpDamage: 0, shieldAbsorbed: 0},
        {kind: 'enemy-direct', hpDamage: 1, evaded: true},
        {kind: 'poison', hpDamage: 10},
        {kind: 'recoil', hpDamage: 10},
        {kind: 'self', hpDamage: 10},
        {kind: 'event', hpDamage: 10},
        {kind: 'enemy-direct', hpDamage: 1},
      ],
    },
    inputB: {
      incomingSegments: [
        {kind: 'enemy-direct', hpDamage: 0, shieldAbsorbed: 0},
        {kind: 'enemy-direct', hpDamage: 1, evaded: true},
        {kind: 'poison', hpDamage: 10},
        {kind: 'recoil', hpDamage: 10},
        {kind: 'self', hpDamage: 10},
        {kind: 'event', hpDamage: 10},
        {kind: 'enemy-direct', hpDamage: 1},
      ],
    },
  }),
  (result) => {
    assert.equal(result.sides.A.rounds[0].incomeBySource['enemy-direct-segment'], 5);
  },
);

scenario(
  'no-drain-steal-and-no-permanent-lock-under-zero-hit-drain',
  baselineConfig({
    rounds: 20,
    segments: 0,
    inputA: {drainRequests: [{source: 'pressure', kind: 'pressure', amount: 20}]},
    inputB: {drainRequests: [{source: 'pressure', kind: 'pressure', amount: 20}]},
  }),
  (result) => {
    assert.ok(rageRounds(result, 'A').length > 0);
    assert.equal(result.sides.A.rounds[0].incomeBySource['enemy-direct-segment'], undefined);
    assert.equal(result.sides.A.rounds[0].effectiveDrain, 20);
  },
);

scenario(
  'terminal-round-drops-pending-income',
  baselineConfig({
    rounds: 1,
    extra: {battleContinues: false},
    sideA: {sources: {rageFixedRefund: 50}},
    sideB: {sources: {rageFixedRefund: 50}},
  }),
  (result) => {
    const round = result.sides.A.rounds[0];
    assert.equal(result.finished, true);
    assert.equal(round.settled, false);
    assert.ok(round.pendingIncomeTotal > 0);
    assert.equal(round.discardedPendingIncome, round.pendingIncomeTotal);
    assert.equal(result.sides.A.rage, 0);
  },
);

check('snapshot-preserves-lock-paid-pending-and-drain', () => {
  const config = baselineConfig({
    rounds: 1,
    sideA: {
      openingBonus: 50,
      sources: {
        rageRefundRates: [20],
        rageFixedRefund: 5,
      },
    },
    sideB: {openingBonus: 50},
    inputA: {drainRequests: [{source: 'saved-drain', kind: 'pressure', amount: 7}]},
    inputB: {drainRequests: [{source: 'saved-drain', kind: 'pressure', amount: 7}]},
  });
  const original = new RageBattle(config);
  original.initialize();
  original.lockRound(1);
  original.executeRound(['A', 'B'], config.roundInputs[0]);
  const snapshot = original.snapshot();
  assert.equal(snapshot.state.sides.A.round.lockedCost, 100);
  assert.equal(snapshot.state.sides.A.round.paid, 100);
  assert.ok(snapshot.state.sides.A.round.pendingIncome.length > 0);
  assert.equal(snapshot.state.sides.A.round.pendingDrain.length, 1);
  const resumed = restoreBattle(snapshot);
  const first = original.settleRound();
  const second = resumed.settleRound();
  assert.deepEqual(first, second);
  assert.deepEqual(original.result().trace, resumed.result().trace);
});

scenario(
  'fixed-and-ratio-refund-not-repeated',
  baselineConfig({
    sideA: {openingBonus: 50, sources: {rageRefundRates: [20, 20], rageFixedRefund: 5}},
    sideB: {openingBonus: 50, sources: {rageRefundRates: [20, 20], rageFixedRefund: 5}},
  }),
  (result) => {
    const round = result.sides.A.rounds[0];
    assert.equal(round.action, 'rage');
    assert.equal(round.incomeBySource['rage-ratio-refund'], 40);
    assert.equal(round.incomeBySource['rage-fixed-refund'], 5);
    assert.equal(round.pendingIncome.filter((entry) => entry.source === 'rage-ratio-refund').length, 1);
    assert.equal(round.pendingIncome.filter((entry) => entry.source === 'rage-fixed-refund').length, 1);
  },
);

check('battle-initializes-once', () => {
  const battle = new RageBattle(baselineConfig({rounds: 1}));
  battle.initialize();
  const first = clone(battle.state.initialization);
  battle.initialize();
  assert.deepEqual(battle.state.initialization, first);
  assert.equal(battle.state.sides.A.rage, first.A.rage);
});

check('cap-floor-sixty', () => {
  const result = orderPair(baselineConfig({
    sideA: {capDelta: -100},
    sideB: {capDelta: -100},
  }));
  assert.equal(result.sides.A.cap, 60);
  assert.equal(result.sides.A.rounds[1].paid, 60);
});

check('income-stays-pending-until-round-end', () => {
  const battle = new RageBattle(baselineConfig({rounds: 1}));
  battle.initialize();
  battle.lockRound(1);
  battle.executeRound(['A', 'B'], battle.config.roundInputs[0]);
  assert.equal(battle.state.sides.A.rage, 50);
  assert.ok(battle.state.sides.A.round.pendingIncomeTotal === undefined);
  assert.equal(
    sum(battle.state.sides.A.round.pendingIncome.map((entry) => entry.amount)),
    30,
  );
  battle.settleRound();
  assert.equal(battle.state.sides.A.rage, 90);
});

export function audit() {
  const passed = checks.filter((checkResult) => checkResult.passed).length;
  const failed = checks.filter((checkResult) => !checkResult.passed);
  return {
    total: checks.length,
    scenarios: scenarioCount,
    passed,
    failed: failed.map((item) => ({
      name: item.name,
      message: item.error?.message ?? String(item.error),
    })),
    coreRows: clone(coreRows),
  };
}

function printAudit(report) {
  console.log('rage-economy resource audit');
  console.log(`checks: ${report.total}`);
  console.log(`scenarios: ${report.scenarios}`);
  if (report.coreRows.length > 0) {
    console.table(report.coreRows);
  }
  for (const failure of report.failed) {
    console.error(`FAIL ${failure.name}: ${failure.message}`);
  }
  console.log(`PASS ${report.passed}/${report.total}`);
  if (report.failed.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printAudit(audit());
}
