const EPSILON = 1e-9;
const TARGETS = Object.freeze(['self', 'enemy']);
const DEFAULT_CHECKPOINTS = Object.freeze([3, 5, 10, 15]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function nonNegative(value, label) {
  const number = finite(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function positive(value, label) {
  const number = finite(value, label);
  if (number <= 0) throw new RangeError(`${label} must be positive`);
  return number;
}

function integer(value, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number)) throw new RangeError(`${label} must be an integer`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = integer(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function targetId(value, fallback = 'self') {
  const target = String(value ?? fallback);
  if (!TARGETS.includes(target)) {
    throw new RangeError(`target must be self or enemy, got ${target}`);
  }
  return target;
}

function stringValue(value, label, fallback = '') {
  const result = String(value ?? fallback);
  if (!result) throw new TypeError(`${label} must be a non-empty string`);
  return result;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function byRound(value, window) {
  const round = value == null ? 1 : finite(value, 'round');
  if (round < 1 || round > window) return null;
  return Math.max(1, Math.floor(round));
}

function emptyMetrics() {
  return {
    damage: {
      attempted: 0,
      effective: 0,
      enemyShieldAbsorbed: 0,
      enemyHpDamage: 0,
      overkill: 0,
      byCategory: {},
      bySource: {},
    },
    life: {
      incomingHpDamage: 0,
      selfDamage: 0,
      effectiveHeal: 0,
    },
    healing: {
      attempted: 0,
      corrected: 0,
      effective: 0,
      overflow: 0,
      overflowWasted: 0,
      overflowToShield: 0,
      overflowToDamage: 0,
      effectiveToShield: 0,
      bySource: {},
    },
    shield: {
      generated: 0,
      absorbed: 0,
      consumed: 0,
      expired: 0,
    },
    dot: {
      attempted: 0,
      effective: 0,
      overkill: 0,
    },
  };
}

function addByKey(map, key, amount) {
  map[key] = (map[key] ?? 0) + amount;
}

function normalizeCheckpointList(value, window) {
  const checkpoints = value == null ? [...DEFAULT_CHECKPOINTS] : value;
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throw new TypeError('checkpoints must be a non-empty array');
  }
  const normalized = checkpoints.map((item) => {
    const point = nonNegativeInteger(item, 'checkpoint');
    if (point <= 0) throw new RangeError('checkpoint must be positive');
    return point;
  });
  return [...new Set(normalized)].sort((a, b) => a - b);
}

function validateDuration(value, label) {
  if (value == null) return null;
  return nonNegative(value, label);
}

function validateMultiplier(value, label, minimum = 0) {
  const multiplier = nonNegative(value, label);
  if (multiplier < minimum) throw new RangeError(`${label} is below its minimum`);
  return multiplier;
}

function normalizeTags(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('status tags must be an array');
  return value.map((tag) => stringValue(tag, 'status tag'));
}

function normalizeAppliesTo(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('status appliesTo must be an object');
  }
  return clone(value);
}

function matchesFilter(filter, event) {
  if (filter == null) return true;
  if (typeof filter !== 'object' || Array.isArray(filter)) return false;
  return Object.entries(filter).every(([key, expected]) => {
    if (Array.isArray(expected)) return expected.includes(event[key]);
    return event[key] === expected;
  });
}

function statusValueFromSpec(spec, fallback = 0) {
  if (spec == null) return fallback;
  if (typeof spec === 'number') return finite(spec, 'status value');
  if (typeof spec === 'object' && !Array.isArray(spec)) {
    return finite(spec.value ?? fallback, 'status value');
  }
  throw new TypeError('status value must be a number or object');
}

function boundedFraction(value, label) {
  const fraction = finite(value, label);
  if (fraction < 0 || fraction > 1) {
    throw new RangeError(`${label} must be between 0 and 1`);
  }
  return fraction;
}

function modifierTotal(value, label) {
  if (value == null) return 0;
  if (typeof value === 'number') return nonNegative(value, label);
  if (Array.isArray(value)) {
    return sum(value.map((item) => modifierTotal(item, label)));
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${label} must be a number, array, or object`);
  }
  if (value.value != null) return nonNegative(value.value, label);
  if (value.amount != null) return nonNegative(value.amount, label);
  return sum([
    modifierTotal(value.increase, `${label}.increase`),
    modifierTotal(value.add, `${label}.add`),
    modifierTotal(value.decrease, `${label}.decrease`),
    modifierTotal(value.subtract, `${label}.subtract`),
  ]);
}

function modifierBuckets(value, label) {
  if (value == null) return {increase: 0, decrease: 0};
  if (typeof value === 'number') {
    return {increase: nonNegative(value, label), decrease: 0};
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => {
      const bucket = modifierBuckets(item, label);
      return {
        increase: total.increase + bucket.increase,
        decrease: total.decrease + bucket.decrease,
      };
    }, {increase: 0, decrease: 0});
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${label} must be a number, array, or object`);
  }
  const mode = String(value.mode ?? value.kind ?? value.modifier ?? 'increase');
  if (!['increase', 'decrease'].includes(mode)) {
    throw new RangeError(`${label} has unknown modifier kind ${mode}`);
  }
  const amount = value.value ?? value.amount;
  if (amount != null) {
    return {
      increase: mode === 'increase' ? nonNegative(amount, label) : 0,
      decrease: mode === 'decrease' ? nonNegative(amount, label) : 0,
    };
  }
  return {
    increase: modifierTotal(value.increase ?? value.add, `${label}.increase`),
    decrease: modifierTotal(value.decrease ?? value.subtract, `${label}.decrease`),
  };
}

function formulaReadsAttack(formula) {
  return formula?.readsAttack === true
    || (Array.isArray(formula?.reads) && formula.reads.includes('attack'))
    || (Array.isArray(formula?.readsAttributes) && formula.readsAttributes.includes('attack'));
}

/**
 * This is an intentionally explicit fixture formula. It is not the game's
 * global defense or resistance formula.
 *
 * `weakness` is an attack-input reduction, not a target-side damage
 * multiplier. Attack increases/decreases are combined before defense is
 * applied. `subtract` and `ratio` remain fixture-only formula shapes.
 */
export function sampleDamage({
  type = 'subtract',
  base,
  defense = 0,
  armorBreak = 0,
  weakness = 0,
  attackIncrease = 0,
  attackDecrease = 0,
  attackModifiers = [],
  ratio = 1,
  multiplier = 1,
} = {}) {
  const baseAmount = nonNegative(base, 'damage base');
  const defenseValue = nonNegative(defense, 'fixture defense');
  const armorBreakValue = nonNegative(armorBreak, 'fixture armor break');
  const weaknessValue = boundedFraction(weakness, 'fixture weakness');
  const attackModifierBuckets = modifierBuckets(attackModifiers, 'fixture attack modifiers');
  const attackIncreaseValue = modifierTotal(attackIncrease, 'fixture attack increase')
    + attackModifierBuckets.increase;
  const attackDecreaseValue = modifierTotal(attackDecrease, 'fixture attack decrease')
    + attackModifierBuckets.decrease;
  const ratioValue = nonNegative(ratio, 'fixture ratio');
  const multiplierValue = nonNegative(multiplier, 'fixture multiplier');
  const attackInput = baseAmount * Math.max(
    0,
    1 + attackIncreaseValue - attackDecreaseValue - weaknessValue,
  );
  let result;
  if (type === 'subtract') {
    result = Math.max(0, attackInput - Math.max(0, defenseValue - armorBreakValue));
  } else if (type === 'ratio') {
    result = attackInput * ratioValue;
  } else {
    throw new RangeError(`unknown fixture damage formula ${type}`);
  }
  return result * multiplierValue;
}

function normalizeDynamicDots(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('dynamicDots must be an object');
  }
  return Object.fromEntries(Object.entries(value).map(([key, amount]) => [
    key,
    nonNegative(amount, `dynamicDots.${key}`),
  ]));
}

function makeTarget({maxHp, hp}) {
  return {
    maxHp,
    hp,
    shieldBuckets: [],
    statuses: new Map(),
  };
}

function emptyCoverage(mode, key) {
  return {
    mode,
    key,
    denominatorAmount: 0,
    affectedAmount: 0,
    denominatorEvents: 0,
    affectedEvents: 0,
    activeTime: 0,
  };
}

function statusSummary(status) {
  return {
    id: status.id,
    kind: status.kind,
    effect: status.effect,
    stacks: status.stacks,
    maxStacks: status.maxStacks,
    active: status.active,
    appliedAt: status.appliedAt,
    updatedAt: status.updatedAt,
    closedAt: status.closedAt,
    closeReason: status.closeReason,
    expiresAt: status.expiresAt,
    duration: status.duration,
    remainingTicks: status.remainingTicks,
    unfulfilledAmount: status.unfulfilledAmount ?? 0,
    ticksApplied: status.ticksApplied,
    tags: [...status.tags],
    value: status.value,
    modifierKind: status.modifierKind ?? null,
    coverageKey: status.coverageKey,
    coverage: clone(status.coverage),
    activeSince: status.activeSince,
    dot: clone(status.dot),
    source: status.source,
  };
}

export class EffectBattle {
  constructor(config = {}) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('effect fixture config must be an object');
    }
    const window = nonNegativeInteger(config.window ?? 15, 'window');
    if (window <= 0) throw new RangeError('window must be positive');
    const maxHp = positive(config.maxHp ?? 100, 'maxHp');
    const hp = config.hp == null ? maxHp : nonNegative(config.hp, 'hp');
    if (hp > maxHp) throw new RangeError('hp cannot exceed maxHp');
    const enemyMaxHp = positive(config.enemyMaxHp ?? 1000, 'enemyMaxHp');
    const enemyHp = config.enemyHp == null
      ? enemyMaxHp
      : nonNegative(config.enemyHp, 'enemyHp');
    if (enemyHp > enemyMaxHp) throw new RangeError('enemyHp cannot exceed enemyMaxHp');
    const checkpoints = normalizeCheckpointList(config.checkpoints, window);

    this.config = {
      window,
      checkpoints,
      dynamicDots: normalizeDynamicDots(config.dynamicDots),
      maxHp,
      enemyMaxHp,
    };
    this.state = {
      currentTime: 0,
      finished: false,
      death: null,
      nextEventNumber: 1,
      nextRootNumber: 1,
      nextShieldNumber: 1,
    };
    this.targets = {
      self: makeTarget({maxHp, hp}),
      enemy: makeTarget({maxHp: enemyMaxHp, hp: enemyHp}),
    };
    this.metrics = emptyMetrics();
    this.ledger = [];
    this.statusHistory = {self: [], enemy: []};
    this.eventSnapshots = [];

    const initialSelfShield = config.initialShield ?? 0;
    const initialEnemyShield = config.enemyInitialShield ?? 0;
    if (initialSelfShield !== 0) {
      this._grantShield({
        target: 'self',
        amount: nonNegative(initialSelfShield, 'initialShield'),
        source: 'initial-shield',
        action: 'fixture-init',
        segment: 'initial',
        time: 0,
        rootId: 'initial',
        duration: null,
      });
    }
    if (initialEnemyShield !== 0) {
      this._grantShield({
        target: 'enemy',
        amount: nonNegative(initialEnemyShield, 'enemyInitialShield'),
        source: 'initial-enemy-shield',
        action: 'fixture-init',
        segment: 'initial',
        time: 0,
        rootId: 'initial',
        duration: null,
      });
    }
    if (hp === 0) this._markDeath('self', 0, 'initial', 'initial');
    else if (enemyHp === 0) this._markDeath('enemy', 0, 'initial', 'initial');
  }

  static fromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new TypeError('invalid effect battle snapshot');
    }
    const battle = new EffectBattle(snapshot.config);
    battle.state = clone(snapshot.state);
    battle.metrics = clone(snapshot.metrics);
    battle.ledger = clone(snapshot.ledger);
    battle.statusHistory = clone(snapshot.statusHistory);
    battle.eventSnapshots = clone(snapshot.eventSnapshots);
    battle.targets = {};
    for (const id of TARGETS) {
      const raw = snapshot.targets?.[id];
      if (!raw) throw new TypeError(`snapshot is missing ${id} target`);
      battle.targets[id] = {
        maxHp: raw.maxHp,
        hp: raw.hp,
        shieldBuckets: clone(raw.shieldBuckets ?? []),
        statuses: new Map((raw.statuses ?? []).map((status) => [status.id, status])),
      };
    }
    return battle;
  }

  snapshot() {
    const targets = {};
    for (const id of TARGETS) {
      targets[id] = {
        maxHp: this.targets[id].maxHp,
        hp: this.targets[id].hp,
        shieldBuckets: clone(this.targets[id].shieldBuckets),
        statuses: [...this.targets[id].statuses.values()].map((status) => clone(status)),
      };
    }
    return {
      version: 1,
      config: clone(this.config),
      state: clone(this.state),
      targets,
      metrics: clone(this.metrics),
      ledger: clone(this.ledger),
      statusHistory: clone(this.statusHistory),
      eventSnapshots: clone(this.eventSnapshots),
    };
  }

  _nextEventId(prefix = 'event') {
    const number = this.state.nextEventNumber;
    this.state.nextEventNumber += 1;
    return `${prefix}-${number}`;
  }

  _nextRootId() {
    const number = this.state.nextRootNumber;
    this.state.nextRootNumber += 1;
    return `root-${number}`;
  }

  _nextShieldId() {
    const number = this.state.nextShieldNumber;
    this.state.nextShieldNumber += 1;
    return `shield-${number}`;
  }

  _rootFields(event, time, rootId) {
    return {
      rootId,
      source: stringValue(event.source, 'source', 'fixture'),
      action: stringValue(event.action, 'action', String(event.type ?? 'event')),
      segment: String(event.segment ?? event.type ?? 'event'),
      time,
      round: byRound(event.round ?? time, this.config.window),
    };
  }

  _record(entry) {
    const record = {
      id: entry.id ?? this._nextEventId(),
      ...entry,
    };
    this.ledger.push(record);
    return record;
  }

  _activeStatuses(target) {
    return [...this.targets[target].statuses.values()].filter((status) => status.active);
  }

  _statusHistoryEntry(target, id) {
    return this.statusHistory[target].find((entry) => entry.id === id) ?? null;
  }

  _closeStatus(target, status, time, reason, rootId = 'system') {
    if (!status.active) return;
    if (status.coverage?.mode === 'time' && status.activeSince != null) {
      status.coverage.activeTime += Math.max(0, time - status.activeSince);
      status.activeSince = null;
    }
    if (
      status.kind === 'dot'
      && status.remainingTicks > 0
      && reason === 'duration'
    ) {
      status.unfulfilledAmount = status.remainingTicks * this._dotAmount(status);
    }
    status.active = false;
    status.stacks = 0;
    status.closedAt = time;
    status.closeReason = reason;
    const history = this._statusHistoryEntry(target, status.id);
    if (history) Object.assign(history, clone(status));
    this._record({
      ...this._rootFields({
        source: 'status-system',
        action: 'expire',
        segment: status.id,
      }, time, rootId),
      kind: 'status-expire',
      target,
      statusId: status.id,
      reason,
    });
  }

  _nextExpiryAt(afterTime, throughTime) {
    let next = null;
    for (const target of TARGETS) {
      for (const bucket of this.targets[target].shieldBuckets) {
        if (
          bucket.active
          && bucket.expiresAt != null
          && bucket.expiresAt >= afterTime - EPSILON
          && bucket.expiresAt <= throughTime + EPSILON
          && (next == null || bucket.expiresAt < next)
        ) {
          next = bucket.expiresAt;
        }
      }
      for (const status of this.targets[target].statuses.values()) {
        if (
          status.active
          && status.expiresAt != null
          && status.expiresAt >= afterTime - EPSILON
          && status.expiresAt <= throughTime + EPSILON
          && (next == null || status.expiresAt < next)
        ) {
          next = status.expiresAt;
        }
      }
    }
    return next;
  }

  _expireAt(time) {
    for (const target of TARGETS) {
      const state = this.targets[target];
      for (const bucket of state.shieldBuckets) {
        if (
          bucket.active
          && bucket.expiresAt != null
          && bucket.expiresAt <= time + EPSILON
          && bucket.remaining > EPSILON
        ) {
          const expired = bucket.remaining;
          bucket.expired += expired;
          bucket.remaining = 0;
          bucket.active = false;
          this.metrics.shield.expired += expired;
          this._record({
            id: this._nextEventId('shield-expire'),
            rootId: 'system',
            source: 'shield-system',
            action: 'expire',
            segment: bucket.id,
            time,
            round: byRound(time, this.config.window),
            kind: 'shield-expire',
            target,
            shieldId: bucket.id,
            amount: expired,
          });
        }
      }
      for (const status of state.statuses.values()) {
        if (
          status.active
          && status.expiresAt != null
          && status.expiresAt <= time + EPSILON
        ) {
          this._closeStatus(target, status, time, 'duration', 'system');
        }
      }
    }
  }

  _advanceTo(time) {
    if (time < this.state.currentTime - EPSILON) {
      throw new RangeError('events must be ordered by non-decreasing time');
    }
    let cursor = this.state.currentTime;
    while (true) {
      const expiry = this._nextExpiryAt(cursor, time);
      if (expiry == null) break;
      this.state.currentTime = expiry;
      const before = this.ledger.length;
      this._expireAt(expiry);
      if (this.ledger.length !== before) this._capture(expiry);
      cursor = expiry + EPSILON;
    }
    this.state.currentTime = time;
    this._expireAt(time);
    this.state.currentTime = time;
  }

  _capture(time) {
    const states = {};
    for (const target of TARGETS) {
      states[target] = {
        hp: this.targets[target].hp,
        maxHp: this.targets[target].maxHp,
        shield: this._remainingShield(target),
        statuses: this._publicStatuses(target),
      };
    }
    this.eventSnapshots.push({
      time,
      metrics: clone(this.metrics),
      states,
    });
  }

  _remainingShield(target) {
    return sum(this.targets[target].shieldBuckets
      .filter((bucket) => bucket.active)
      .map((bucket) => bucket.remaining));
  }

  _takeShield(target, requested, kind, rootFields) {
    let remaining = nonNegative(requested, 'shield request');
    const allocations = [];
    for (const bucket of this.targets[target].shieldBuckets) {
      if (!bucket.active || bucket.remaining <= EPSILON || remaining <= EPSILON) continue;
      const amount = Math.min(bucket.remaining, remaining);
      bucket.remaining -= amount;
      remaining -= amount;
      if (kind === 'absorbed') {
        bucket.absorbed += amount;
        this.metrics.shield.absorbed += amount;
      } else {
        bucket.consumed += amount;
        this.metrics.shield.consumed += amount;
      }
      if (bucket.remaining <= EPSILON) {
        bucket.remaining = 0;
        bucket.active = false;
      }
      allocations.push({shieldId: bucket.id, amount});
    }
    return {
      requested,
      actual: requested - remaining,
      shortfall: remaining,
      allocations,
      kind,
      ...rootFields,
    };
  }

  _grantShield({
    target,
    amount,
    source,
    action,
    segment,
    time,
    rootId,
    duration,
    reason = 'generated',
  }) {
    const generated = nonNegative(amount, 'shield amount');
    const expiresAt = duration == null ? null : time + validateDuration(duration, 'shield duration');
    const bucket = {
      id: this._nextShieldId(),
      target,
      source: stringValue(source, 'shield source', 'fixture'),
      generated,
      remaining: generated,
      absorbed: 0,
      consumed: 0,
      expired: 0,
      active: generated > EPSILON,
      createdAt: time,
      expiresAt,
    };
    this.targets[target].shieldBuckets.push(bucket);
    this.metrics.shield.generated += generated;
    this._record({
      id: this._nextEventId('shield'),
      rootId,
      source: bucket.source,
      action: stringValue(action, 'action', 'shield'),
      segment: String(segment ?? 'shield'),
      time,
      round: byRound(time, this.config.window),
      kind: 'shield-generate',
      target,
      shieldId: bucket.id,
      amount: generated,
      reason,
      duration,
      expiresAt,
    });
    return {
      shieldId: bucket.id,
      generated,
      expiresAt,
      remaining: generated,
    };
  }

  _markDeath(target, time, rootId, source) {
    if (this.state.finished) return;
    this.state.finished = true;
    this.state.death = {
      target,
      time,
      source,
    };
    this._record({
      id: this._nextEventId('death'),
      rootId,
      source,
      action: 'death',
      segment: target,
      time,
      round: byRound(time, this.config.window),
      kind: 'death',
      target,
    });
  }

  _statusValue(target, statusId, effect = null, event = null) {
    if (statusId == null) return 0;
    if (Array.isArray(statusId)) {
      return sum(statusId.map((id) => this._statusValue(target, id, effect, event)));
    }
    const status = this.targets[target].statuses.get(String(statusId));
    if (!status || !status.active) return 0;
    if (effect != null && status.effect !== effect) return 0;
    if (event && !this._statusApplies(status, event)) return 0;
    return status.value * status.stacks;
  }

  _resolveFormula(event, target, actor) {
    if (typeof event.damageFunction === 'function') {
      const amount = event.damageFunction({
        event: clone({...event, damageFunction: undefined}),
        target,
        actor,
        statuses: this._publicStatuses(target),
        actorStatuses: this._publicStatuses(actor),
      });
      return {
        amount: nonNegative(amount, 'damageFunction result'),
        details: {type: 'custom-function'},
      };
    }
    if (event.damageFunction != null) {
      if (typeof event.damageFunction !== 'object' || Array.isArray(event.damageFunction)) {
        throw new TypeError('damageFunction must be a function or object');
      }
      return this._resolveFormula({
        ...event,
        formula: event.damageFunction,
        damageFunction: undefined,
      }, target, actor);
    }
    if (event.formula == null) {
      return {
        amount: nonNegative(event.amount ?? event.baseAmount, 'damage amount'),
        details: {type: 'explicit'},
      };
    }
    if (typeof event.formula !== 'object' || Array.isArray(event.formula)) {
      throw new TypeError('damage formula must be an object');
    }
    const formula = event.formula;
    const armorBreak = statusValueFromSpec(formula.armorBreak, 0)
      + this._statusValue(
        target,
        formula.armorBreakStatus ?? formula.armorBreakStatuses,
        'armor-break',
        event,
      );
    const weakness = statusValueFromSpec(formula.weakness, 0)
      + this._statusValue(
        actor,
        formula.weaknessStatus ?? formula.weaknessStatuses,
        'weakness',
        event,
      );
    const weaknessValue = boundedFraction(weakness, 'fixture weakness');
    const readsAttack = formulaReadsAttack(formula);
    const attackStatusModifiers = readsAttack
      ? this._activeStatuses(actor)
        .filter((status) => (
          status.kind === 'buff'
          && status.effect === 'attack-attribute'
          && event.buffEligible !== false
          && this._statusApplies(status, event)
        ))
        .reduce((totals, status) => {
          const amount = status.value * status.stacks;
          if (status.modifierKind === 'decrease') totals.decrease += amount;
          else totals.increase += amount;
          return totals;
        }, {increase: 0, decrease: 0})
      : {increase: 0, decrease: 0};
    const attackIncrease = readsAttack
      ? modifierTotal(formula.attackIncrease, 'fixture attack increase')
        + attackStatusModifiers.increase
      : 0;
    const attackDecrease = readsAttack
      ? modifierTotal(formula.attackDecrease, 'fixture attack decrease')
        + attackStatusModifiers.decrease
      : 0;
    const amount = sampleDamage({
      type: formula.type,
      base: formula.base ?? event.baseAmount ?? event.amount,
      defense: formula.defense ?? 0,
      armorBreak,
      weakness: weaknessValue,
      attackIncrease,
      attackDecrease,
      attackModifiers: readsAttack ? formula.attackModifiers : [],
      ratio: formula.ratio ?? 1,
      multiplier: formula.multiplier ?? 1,
    });
    return {
      amount,
      details: {
        type: formula.type,
        base: formula.base ?? event.baseAmount ?? event.amount,
        defense: formula.defense ?? 0,
        armorBreak,
        weakness: weaknessValue,
        weaknessSource: formula.weaknessStatus == null ? null : 'actor',
        readsAttack,
        attackIncrease,
        attackDecrease,
        attackModifierStatusIds: readsAttack
          ? this._activeStatuses(actor)
            .filter((status) => (
              status.kind === 'buff'
              && status.effect === 'attack-attribute'
              && event.buffEligible !== false
              && this._statusApplies(status, event)
            ))
            .map((status) => status.id)
          : [],
        ratio: formula.ratio ?? 1,
        multiplier: formula.multiplier ?? 1,
      },
    };
  }

  _statusApplies(status, event) {
    if (!status.active) return false;
    if (!matchesFilter(status.appliesTo, event)) return false;
    if (status.coverageKey != null && event.coverageKey !== status.coverageKey) {
      return false;
    }
    return true;
  }

  _coverageStatusMatches(status, owner, actor, target, event, formula, requireActive = true) {
    if (requireActive && !status.active) return false;
    if (!status.coverage) return false;
    if (!matchesFilter(status.appliesTo, event)) return false;
    if (status.coverageKey != null && event.coverageKey !== status.coverageKey) {
      return false;
    }
    if (event.buffEligible === false && (
      status.effect === 'outgoing-damage'
      || status.effect === 'attack-attribute'
    )) {
      return false;
    }
    if (status.effect === 'outgoing-damage') {
      return owner === actor;
    }
    if (status.effect === 'attack-attribute') {
      return owner === actor && formulaReadsAttack(formula);
    }
    if (status.effect === 'weakness') {
      if (owner !== actor) return false;
      const ids = [
        formula?.weaknessStatus,
        ...(Array.isArray(formula?.weaknessStatuses) ? formula.weaknessStatuses : []),
      ].filter((id) => id != null).map(String);
      return ids.includes(status.id);
    }
    if (status.effect === 'armor-break') {
      if (owner !== target) return false;
      const ids = [
        formula?.armorBreakStatus,
        ...(Array.isArray(formula?.armorBreakStatuses) ? formula.armorBreakStatuses : []),
      ].filter((id) => id != null).map(String);
      return ids.includes(status.id);
    }
    return false;
  }

  _recordCoverage(actor, target, event, formula, baseAmount) {
    if (event.coverageKey == null) return;
    const denominator = nonNegative(baseAmount, 'coverage base amount');
    const seen = new Set();
    for (const owner of [actor, target]) {
      for (const history of this.statusHistory[owner]) {
        if (seen.has(`${owner}:${history.id}`)) continue;
        if (history.coverage?.key !== event.coverageKey) continue;
        const active = this.targets[owner].statuses.get(history.id);
        if (!active) continue;
        if (!this._coverageStatusMatches(
          history,
          owner,
          actor,
          target,
          event,
          formula,
          false,
        )) {
          continue;
        }
        seen.add(`${owner}:${history.id}`);
        history.coverage.denominatorAmount += denominator;
        history.coverage.denominatorEvents += 1;
        if (
          this._coverageStatusMatches(active, owner, actor, target, event, formula)
          && active.value * active.stacks > EPSILON
        ) {
          history.coverage.affectedAmount += denominator;
          history.coverage.affectedEvents += 1;
        }
        if (active.coverage && active.coverage !== history.coverage) {
          active.coverage.denominatorAmount = history.coverage.denominatorAmount;
          active.coverage.affectedAmount = history.coverage.affectedAmount;
          active.coverage.denominatorEvents = history.coverage.denominatorEvents;
          active.coverage.affectedEvents = history.coverage.affectedEvents;
        }
      }
    }
  }

  _resolveBuffs(actor, event, baseAmount) {
    const buffs = this._activeStatuses(actor).filter((status) => (
      status.kind === 'buff'
      && status.effect === 'outgoing-damage'
      && (event.buffEligible !== false)
      && this._statusApplies(status, event)
    ));
    const bonus = sum(buffs.map((status) => status.value * status.stacks));
    return {
      amount: baseAmount * (1 + bonus),
      bonus,
      statusIds: buffs.map((status) => status.id),
    };
  }

  _applyDamageRaw({
    target,
    raw,
    source,
    action,
    segment,
    time,
    rootId,
    category,
    sourceRole,
    formula,
    modifiers = {},
  }) {
    const amount = nonNegative(raw, 'damage amount');
    const shield = this._takeShield(target, amount, 'absorbed', {
      rootId,
      source,
      action,
      segment,
      time,
      round: byRound(time, this.config.window),
    });
    const hpBefore = this.targets[target].hp;
    const hpDamage = Math.min(hpBefore, Math.max(0, amount - shield.actual));
    this.targets[target].hp = hpBefore - hpDamage;
    const overkill = Math.max(0, amount - shield.actual - hpDamage);
    const effective = shield.actual + hpDamage;
    const kind = String(category ?? 'direct');
    const sourceName = stringValue(source, 'source', 'fixture');
    this.metrics.damage.attempted += amount;
    addByKey(this.metrics.damage.byCategory, kind, effective);
    addByKey(this.metrics.damage.bySource, sourceName, effective);
    this.metrics.damage.overkill += overkill;
    if (target === 'enemy') {
      this.metrics.damage.effective += effective;
      this.metrics.damage.enemyShieldAbsorbed += shield.actual;
      this.metrics.damage.enemyHpDamage += hpDamage;
    } else if (sourceRole === 'self' || sourceRole === 'self-damage') {
      this.metrics.life.selfDamage += hpDamage;
    } else if (sourceRole === 'external') {
      this.metrics.life.incomingHpDamage += hpDamage;
    }
    if (kind === 'dot') {
      this.metrics.dot.attempted += amount;
      this.metrics.dot.effective += effective;
      this.metrics.dot.overkill += overkill;
    }
    const record = this._record({
      id: this._nextEventId('damage'),
      rootId,
      source: sourceName,
      action: stringValue(action, 'action', 'damage'),
      segment: String(segment ?? 'damage'),
      time,
      round: byRound(time, this.config.window),
      kind: 'damage',
      target,
      category: kind,
      sourceRole,
      raw: amount,
      effective,
      shieldAbsorbed: shield.actual,
      hpDamage,
      overkill,
      formula: clone(formula),
      modifiers: clone(modifiers),
      hpBefore,
      hpAfter: this.targets[target].hp,
      shieldAllocations: clone(shield.allocations),
    });
    if (
      target === 'self'
      && sourceRole === 'external'
      && kind === 'direct'
      && effective > EPSILON
    ) {
      this.metrics.incomingSegments = this.metrics.incomingSegments ?? [];
      this.metrics.incomingSegments.push({
        time,
        round: byRound(time, this.config.window),
        kind: 'enemy-direct',
        hpDamage,
        shieldAbsorbed: shield.actual,
        source,
        segment,
      });
    }
    if (this.targets[target].hp <= EPSILON) {
      this.targets[target].hp = 0;
      this._markDeath(target, time, rootId, source);
    }
    return record;
  }

  _handleDamage(event, rootFields) {
    const target = targetId(event.target, event.sourceRole === 'external' ? 'self' : 'enemy');
    const actor = targetId(
      event.actor,
      target === 'enemy' ? 'self' : 'enemy',
    );
    const formula = this._resolveFormula(event, target, actor);
    this._recordCoverage(
      actor,
      target,
      event,
      event.formula ?? event.damageFunction ?? {},
      formula.details.base ?? formula.amount,
    );
    const buff = this._resolveBuffs(actor, event, formula.amount);
    const amount = buff.amount;
    const category = String(event.category ?? 'direct');
    const sourceRole = String(
      event.sourceRole
      ?? (target === 'enemy' ? 'self' : 'external'),
    );
    return this._applyDamageRaw({
      ...rootFields,
      target,
      raw: amount,
      category,
      sourceRole,
      formula: formula.details,
      modifiers: {
        buffBonus: buff.bonus,
        buffStatusIds: buff.statusIds,
      },
    });
  }

  _handleHeal(event, rootFields) {
    const target = targetId(event.target, 'self');
    const amount = nonNegative(event.amount ?? event.baseAmount, 'heal amount');
    const multiplier = validateMultiplier(event.multiplier ?? event.healMultiplier ?? 1, 'heal multiplier');
    const corrected = amount * multiplier;
    const hpBefore = this.targets[target].hp;
    const missing = Math.max(0, this.targets[target].maxHp - hpBefore);
    const effective = Math.min(missing, corrected);
    const overflow = Math.max(0, corrected - effective);
    this.targets[target].hp += effective;
    this.metrics.healing.attempted += amount;
    this.metrics.healing.corrected += corrected;
    this.metrics.healing.effective += effective;
    this.metrics.healing.overflow += overflow;
    addByKey(this.metrics.healing.bySource, rootFields.source, effective);
    if (target === 'self' && event.selfHeal !== false) {
      this.metrics.life.effectiveHeal += effective;
    }

    const outlet = event.overflowOutlet ?? 'none';
    let overflowResult = {kind: 'none', amount: overflow};
    if (typeof outlet === 'string') {
      if (outlet !== 'none') throw new RangeError(`unknown overflow outlet ${outlet}`);
      this.metrics.healing.overflowWasted += overflow;
    } else {
      if (!outlet || typeof outlet !== 'object' || Array.isArray(outlet)) {
        throw new TypeError('overflowOutlet must be none or an object');
      }
      const kind = String(outlet.kind ?? 'none');
      if (kind === 'shield') {
        const shieldBonus = nonNegative(outlet.shieldBonus ?? 0, 'overflow shield bonus');
        const shieldAmount = overflow * (1 + shieldBonus);
        const shield = this._grantShield({
          ...rootFields,
          target: outlet.target ?? target,
          amount: shieldAmount,
          source: `${rootFields.source}:overflow`,
          reason: 'healing-overflow',
          duration: outlet.duration,
        });
        this.metrics.healing.overflowToShield += shieldAmount;
        overflowResult = {
          kind,
          amount: overflow,
          shieldAmount,
          shieldBonus,
          shieldId: shield.shieldId,
        };
      } else if (kind === 'damage') {
        const damageMultiplier = nonNegative(outlet.multiplier ?? 1, 'overflow damage multiplier');
        const damage = this._applyDamageRaw({
          ...rootFields,
          target: outlet.target ?? 'enemy',
          raw: overflow * damageMultiplier,
          source: `${rootFields.source}:overflow`,
          category: 'overflow',
          sourceRole: 'self',
          formula: {type: 'overflow', multiplier: damageMultiplier},
          modifiers: {overflow},
        });
        this.metrics.healing.overflowToDamage += damage.effective;
        overflowResult = {
          kind,
          amount: overflow,
          damageAmount: overflow * damageMultiplier,
          effectiveDamage: damage.effective,
        };
      } else if (kind === 'none') {
        this.metrics.healing.overflowWasted += overflow;
      } else {
        throw new RangeError(`unknown overflow outlet ${kind}`);
      }
    }

    const effectiveToShield = event.effectiveToShield;
    let effectiveShieldResult = null;
    if (effectiveToShield != null) {
      if (
        typeof effectiveToShield !== 'object'
        || Array.isArray(effectiveToShield)
      ) {
        throw new TypeError('effectiveToShield must be an object');
      }
      const ratio = nonNegative(effectiveToShield.ratio ?? 0, 'effective-to-shield ratio');
      const shieldBonus = nonNegative(
        effectiveToShield.shieldBonus ?? 0,
        'effective-to-shield shield bonus',
      );
      const shieldAmount = effective * ratio * (1 + shieldBonus);
      const shield = this._grantShield({
        ...rootFields,
        target: effectiveToShield.target ?? target,
        amount: shieldAmount,
        source: `${rootFields.source}:effective`,
        reason: 'effective-heal-conversion',
        duration: effectiveToShield.duration,
      });
      this.metrics.healing.effectiveToShield += shieldAmount;
      effectiveShieldResult = {
        amount: effective,
        ratio,
        shieldBonus,
        shieldAmount,
        shieldId: shield.shieldId,
      };
    }
    const record = this._record({
      id: this._nextEventId('heal'),
      ...rootFields,
      kind: 'heal',
      target,
      actor: event.actor == null ? null : targetId(event.actor, 'self'),
      sourceRole: String(event.sourceRole ?? (event.actor === 'self' ? 'self' : 'external')),
      triggerContext: clone(event.triggerContext ?? null),
      inBattle: event.inBattle !== false,
      raw: amount,
      multiplier,
      corrected,
      missing,
      effective,
      overflow,
      overflowResult,
      effectiveShieldResult,
      hpBefore,
      hpAfter: this.targets[target].hp,
    });
    return record;
  }

  _handleShield(event, rootFields) {
    const target = targetId(event.target, 'self');
    const amount = nonNegative(event.amount, 'shield amount');
    const multiplier = validateMultiplier(event.multiplier ?? event.shieldMultiplier ?? 1, 'shield multiplier');
    const shieldBonus = nonNegative(event.shieldBonus ?? 0, 'shield bonus');
    return this._grantShield({
      ...rootFields,
      target,
      amount: amount * multiplier * (1 + shieldBonus),
      duration: event.duration,
      reason: event.reason ?? 'generated',
    });
  }

  _handleConsumeShield(event, rootFields) {
    const target = targetId(event.target, 'self');
    const consumed = this._takeShield(target, nonNegative(event.amount, 'shield consume amount'), 'consumed', {
      ...rootFields,
    });
    const record = this._record({
      id: this._nextEventId('shield-consume'),
      ...rootFields,
      kind: 'shield-consume',
      target,
      requested: consumed.requested,
      consumed: consumed.actual,
      shortfall: consumed.shortfall,
      allocations: consumed.allocations,
      reason: event.reason ?? 'active-consume',
    });
    const followUp = event.followUpDamage;
    let followUpResult = null;
    if (followUp != null) {
      if (!followUp || typeof followUp !== 'object' || Array.isArray(followUp)) {
        throw new TypeError('followUpDamage must be an object');
      }
      const perShield = nonNegative(
        followUp.amountPerShield ?? followUp.damagePerShield,
        'follow-up damage per shield',
      );
      if (consumed.actual > EPSILON && perShield > EPSILON && !this.state.finished) {
        followUpResult = this._applyDamageRaw({
          ...rootFields,
          target: followUp.target ?? 'enemy',
          raw: consumed.actual * perShield,
          source: followUp.source ?? `${rootFields.source}:shield-consume`,
          action: followUp.action ?? rootFields.action,
          segment: followUp.segment ?? `${rootFields.segment}:shield-consume`,
          category: followUp.category ?? 'direct',
          sourceRole: followUp.sourceRole ?? 'self',
          formula: {
            type: 'shield-consume',
            amountPerShield: perShield,
          },
          modifiers: {consumedShield: consumed.actual},
        });
      }
    }
    record.followUp = followUpResult ? followUpResult.id : null;
    return record;
  }

  _normalizeStatus(event, rootFields, existing = null) {
    const id = stringValue(event.id ?? event.statusId, 'status id');
    const kind = String(event.kind ?? 'debuff');
    if (!['dot', 'buff', 'debuff'].includes(kind)) {
      throw new RangeError(`unknown status kind ${kind}`);
    }
    const stacks = nonNegativeInteger(event.stacks ?? 1, 'status stacks');
    if (stacks <= 0) throw new RangeError('status stacks must be positive');
    const maxStacks = nonNegativeInteger(event.maxStacks ?? existing?.maxStacks ?? stacks, 'status maxStacks');
    if (maxStacks <= 0) throw new RangeError('status maxStacks must be positive');
    const duration = validateDuration(
      event.duration ?? existing?.duration,
      'status duration',
    );
    const expiresAt = duration == null ? null : rootFields.time + duration;
    const dotInput = event.dot ?? existing?.dot ?? null;
    let dot = null;
    if (kind === 'dot') {
      if (!dotInput || typeof dotInput !== 'object' || Array.isArray(dotInput)) {
        throw new TypeError('dot status requires a dot configuration');
      }
      const dotAmount = nonNegative(dotInput.amount, 'dot amount');
      const mode = String(dotInput.mode ?? 'snapshot');
      if (!['snapshot', 'dynamic'].includes(mode)) {
        throw new RangeError(`unknown dot mode ${mode}`);
      }
      dot = {
        amount: dotAmount,
        mode,
        key: dotInput.key == null ? id : stringValue(dotInput.key, 'dot dynamic key'),
        perStack: dotInput.perStack !== false,
        target: targetId(dotInput.target, rootFields.source === 'fixture' ? 'self' : 'enemy'),
        sourceRole: String(
          dotInput.sourceRole
          ?? (targetId(dotInput.target, 'self') === 'self' ? 'external' : 'self'),
        ),
        category: String(dotInput.category ?? 'dot'),
      };
    }
    const coverageInput = event.coverage
      ?? existing?.coverage
      ?? (event.coverageKey == null
        ? null
        : {mode: 'qualified-events', key: event.coverageKey});
    let coverage = null;
    if (coverageInput != null) {
      if (
        typeof coverageInput !== 'object'
        || Array.isArray(coverageInput)
      ) {
        throw new TypeError('status coverage must be an object');
      }
      const mode = String(coverageInput.mode ?? 'qualified-events');
      if (!['qualified-events', 'time'].includes(mode)) {
        throw new RangeError(`unknown coverage mode ${mode}`);
      }
      coverage = existing?.coverage
        ? clone(existing.coverage)
        : emptyCoverage(mode, stringValue(
          coverageInput.key ?? event.coverageKey ?? event.id,
          'coverage key',
        ));
      coverage.mode = mode;
    }
    const modifierKind = String(
      event.modifierKind
      ?? event.modifier
      ?? existing?.modifierKind
      ?? 'increase',
    );
    if (!['increase', 'decrease'].includes(modifierKind)) {
      throw new RangeError(`unknown status modifier kind ${modifierKind}`);
    }
    return {
      id,
      kind,
      effect: String(event.effect ?? existing?.effect ?? ''),
      stacks,
      maxStacks,
      active: true,
      appliedAt: existing?.active ? existing.appliedAt : rootFields.time,
      updatedAt: rootFields.time,
      closedAt: null,
      closeReason: null,
      expiresAt,
      duration,
      unfulfilledAmount: existing?.unfulfilledAmount ?? 0,
      remainingTicks: kind === 'dot'
        ? nonNegativeInteger(
          event.remainingTicks
          ?? event.ticks
          ?? existing?.remainingTicks
          ?? 0,
          'remainingTicks',
        )
        : null,
      ticksApplied: existing?.ticksApplied ?? 0,
      tags: normalizeTags(event.tags ?? existing?.tags),
      value: nonNegative(event.value ?? existing?.value ?? 0, 'status value'),
      modifierKind,
      source: stringValue(event.source, 'source', rootFields.source),
      appliesTo: normalizeAppliesTo(event.appliesTo ?? existing?.appliesTo),
      coverageKey: event.coverageKey ?? existing?.coverageKey ?? coverage?.key ?? null,
      coverage,
      activeSince: coverage?.mode === 'time'
        ? (existing?.activeSince ?? rootFields.time)
        : null,
      dot,
      snapshotAmount: kind === 'dot' && dot?.mode === 'snapshot'
        ? dot.amount
        : (existing?.snapshotAmount ?? null),
    };
  }

  _handleApplyStatus(event, rootFields) {
    const target = targetId(event.target, 'enemy');
    const id = stringValue(event.id ?? event.statusId, 'status id');
    const current = this.targets[target].statuses.get(id);
    const stackMode = String(event.stackMode ?? (current?.kind === 'dot' ? 'add' : 'replace'));
    if (!['add', 'replace', 'refresh'].includes(stackMode)) {
      throw new RangeError(`unknown status stack mode ${stackMode}`);
    }
    const incoming = this._normalizeStatus(
      event,
      rootFields,
      current?.active ? current : null,
    );
    let status;
    if (!current || !current.active) {
      status = incoming;
    } else if (stackMode === 'add') {
      status = incoming;
      status.stacks = Math.min(current.maxStacks, current.stacks + incoming.stacks);
      status.maxStacks = current.maxStacks;
      status.ticksApplied = current.ticksApplied;
      status.coverage = current.coverage ?? incoming.coverage;
      if (status.coverage?.mode === 'time') {
        status.activeSince = current.activeSince ?? current.appliedAt;
      }
      if (event.refresh !== true) {
        status.expiresAt = current.expiresAt;
        status.duration = current.duration;
      }
      if (event.refreshTicks !== true) {
        status.remainingTicks = current.remainingTicks;
      }
    } else if (stackMode === 'refresh') {
      status = clone(current);
      status.updatedAt = rootFields.time;
      status.active = true;
      status.expiresAt = incoming.expiresAt ?? current.expiresAt;
      status.duration = incoming.duration ?? current.duration;
      if (event.refreshTicks === true) status.remainingTicks = incoming.remainingTicks;
      if (event.refreshDot === true && incoming.dot) {
        status.dot = incoming.dot;
        status.snapshotAmount = incoming.snapshotAmount;
      }
      if (status.coverage?.mode === 'time' && status.activeSince == null) {
        status.activeSince = rootFields.time;
      }
    } else {
      status = incoming;
      status.stacks = Math.min(incoming.maxStacks, incoming.stacks);
    }
    status.id = id;
    status.maxStacks = Math.max(1, status.maxStacks);
    if (status.stacks > status.maxStacks) status.stacks = status.maxStacks;
    if (!status.coverage && current?.coverage) status.coverage = current.coverage;
    this.targets[target].statuses.set(id, status);
    const history = this._statusHistoryEntry(target, id);
    if (history) {
      Object.assign(history, clone(status));
    } else {
      this.statusHistory[target].push(clone(status));
    }
    const record = this._record({
      id: this._nextEventId('status'),
      ...rootFields,
      kind: 'status-apply',
      target,
      statusId: id,
      stackMode,
      beforeStacks: current?.stacks ?? 0,
      afterStacks: status.stacks,
      maxStacks: status.maxStacks,
      capped: current != null && current.stacks + incoming.stacks > status.maxStacks,
      status: statusSummary(status),
    });
    if (status.expiresAt != null && status.expiresAt <= rootFields.time + EPSILON) {
      this._expireAt(rootFields.time);
    }
    return record;
  }

  _handleStatusRemoval(event, rootFields, consume = false) {
    const target = targetId(event.target, 'enemy');
    const id = stringValue(event.id ?? event.statusId, 'status id');
    const status = this.targets[target].statuses.get(id);
    if (!status || !status.active) {
      return this._record({
        id: this._nextEventId('status-remove'),
        ...rootFields,
        kind: consume ? 'status-consume' : 'status-remove',
        target,
        statusId: id,
        removedStacks: 0,
      });
    }
    if (consume) {
      const amount = nonNegativeInteger(event.stacks ?? 1, 'status consume stacks');
      const removed = Math.min(amount, status.stacks);
      status.stacks -= removed;
      if (status.stacks <= 0) {
        status.stacks = 0;
        this._closeStatus(target, status, rootFields.time, 'consumed', rootFields.rootId);
      }
      const history = this._statusHistoryEntry(target, id);
      if (history) Object.assign(history, clone(status));
      return this._record({
        id: this._nextEventId('status-consume'),
        ...rootFields,
        kind: 'status-consume',
        target,
        statusId: id,
        removedStacks: removed,
        remainingStacks: status.stacks,
      });
    }
    const removed = status.stacks;
    this._closeStatus(target, status, rootFields.time, 'removed', rootFields.rootId);
    return this._record({
      id: this._nextEventId('status-remove'),
      ...rootFields,
      kind: 'status-remove',
      target,
      statusId: id,
      removedStacks: removed,
    });
  }

  _dotAmount(status) {
    const base = status.dot.mode === 'dynamic'
      ? this.config.dynamicDots[status.dot.key] ?? status.dot.amount
      : status.snapshotAmount;
    return nonNegative(base, `dot amount for ${status.id}`)
      * (status.dot.perStack ? status.stacks : 1);
  }

  _handleTick(event, rootFields) {
    const target = targetId(event.target, 'enemy');
    const id = stringValue(event.id ?? event.statusId, 'status id');
    const status = this.targets[target].statuses.get(id);
    const requested = nonNegativeInteger(event.ticks ?? 1, 'ticks');
    if (requested <= 0) throw new RangeError('ticks must be positive');
    if (!status || !status.active || status.kind !== 'dot') {
      return this._record({
        id: this._nextEventId('dot-tick'),
        ...rootFields,
        kind: 'dot-tick',
        target,
        statusId: id,
        requestedTicks: requested,
        appliedTicks: 0,
        skipped: true,
        reason: 'status-inactive',
      });
    }
    const ticks = Math.min(requested, status.remainingTicks);
    const results = [];
    let appliedTicks = 0;
    for (let index = 0; index < ticks; index += 1) {
      if (this.state.finished || !status.active) break;
      const amount = this._dotAmount(status);
      const damage = this._applyDamageRaw({
        ...rootFields,
        target: status.dot.target,
        raw: amount,
        source: status.source,
        action: event.action ?? 'dot-tick',
        segment: `${id}:tick-${status.ticksApplied + 1}`,
        category: status.dot.category,
        sourceRole: status.dot.sourceRole,
        formula: {
          type: status.dot.mode,
          amount,
          statusId: id,
        },
        modifiers: {
          dotMode: status.dot.mode,
          stacks: status.stacks,
        },
      });
      results.push(damage.id);
      appliedTicks += 1;
      status.remainingTicks -= 1;
      status.ticksApplied += 1;
      if (status.remainingTicks <= 0) {
        status.remainingTicks = 0;
        this._closeStatus(target, status, rootFields.time, 'ticks-exhausted', rootFields.rootId);
      }
      const history = this._statusHistoryEntry(target, id);
      if (history) Object.assign(history, clone(status));
    }
    const record = this._record({
      id: this._nextEventId('dot-tick'),
      ...rootFields,
      kind: 'dot-tick',
      target,
      statusId: id,
      requestedTicks: requested,
      appliedTicks,
      damageIds: results,
      remainingTicks: status.remainingTicks,
    });
    return record;
  }

  applyEvent(event = {}) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('effect event must be an object');
    }
    const type = stringValue(event.type, 'event type');
    const time = event.time == null
      ? this.state.currentTime
      : nonNegative(event.time, 'event time');
    if (time > this.config.window + EPSILON) {
      const rootId = this._nextRootId();
      const rootFields = this._rootFields(event, time, rootId);
      return this._record({
        id: this._nextEventId('skipped'),
        ...rootFields,
        kind: 'skipped',
        eventType: type,
        skipped: true,
        reason: 'outside-window',
      });
    }
    const rootId = this._nextRootId();
    const rootFields = this._rootFields(event, time, rootId);
    if (this.state.finished) {
      return this._record({
        id: this._nextEventId('skipped'),
        ...rootFields,
        kind: 'skipped',
        eventType: type,
        skipped: true,
        reason: 'battle-ended',
      });
    }
    this._advanceTo(time);
    this._record({
      id: rootId,
      ...rootFields,
      kind: 'event',
      eventType: type,
    });
    let result;
    if (type === 'damage') {
      result = this._handleDamage(event, rootFields);
    } else if (type === 'heal') {
      result = this._handleHeal(event, rootFields);
    } else if (type === 'shield') {
      result = this._handleShield(event, rootFields);
    } else if (type === 'consume-shield') {
      result = this._handleConsumeShield(event, rootFields);
    } else if (type === 'apply-status') {
      result = this._handleApplyStatus(event, rootFields);
    } else if (type === 'tick') {
      result = this._handleTick(event, rootFields);
    } else if (type === 'remove-status') {
      result = this._handleStatusRemoval(event, rootFields);
    } else if (type === 'consume-status') {
      result = this._handleStatusRemoval(event, rootFields, true);
    } else if (type === 'advance') {
      result = this._record({
        id: this._nextEventId('advance'),
        ...rootFields,
        kind: 'advance',
        time,
      });
    } else {
      throw new RangeError(`unknown effect event type ${type}`);
    }
    this._capture(time);
    return result;
  }

  _publicStatuses(target) {
    return [...this.statusHistory[target]].map((status) => statusSummary(status));
  }

  _shieldRows() {
    return TARGETS.flatMap((target) => this.targets[target].shieldBuckets.map((bucket) => ({
      ...clone(bucket),
      conservation: bucket.generated
        - bucket.absorbed
        - bucket.consumed
        - bucket.expired
        - bucket.remaining,
    })));
  }

  _statusCoverage() {
    const coverage = {};
    const coverageEnd = Math.min(this.config.window, this.state.currentTime);
    for (const target of TARGETS) {
      for (const status of this.statusHistory[target]) {
        if (!status.coverage) continue;
        const activeTime = status.coverage.mode === 'time'
          ? status.coverage.activeTime
            + (status.active && status.activeSince != null
              ? Math.max(0, coverageEnd - status.activeSince)
              : 0)
          : status.coverage.activeTime;
        const denominator = status.coverage.mode === 'time'
          ? this.config.window
          : status.coverage.denominatorAmount;
        const numerator = status.coverage.mode === 'time'
          ? activeTime
          : status.coverage.affectedAmount;
        coverage[`${target}:${status.id}`] = {
          target,
          statusId: status.id,
          mode: status.coverage.mode,
          denominator,
          numerator,
          ratio: denominator > EPSILON ? numerator / denominator : null,
          denominatorEvents: status.coverage.denominatorEvents,
          affectedEvents: status.coverage.affectedEvents,
          activeTime,
          key: status.coverage.key,
        };
      }
    }
    return coverage;
  }

  _dotUnfulfilled() {
    return TARGETS.reduce((total, target) => total + sum(
      this.statusHistory[target]
        .filter((status) => status.kind === 'dot')
        .map((status) => {
          if (!status.active) return status.unfulfilledAmount ?? 0;
          return status.remainingTicks * this._dotAmount(status);
        }),
    ), 0);
  }

  _checkpoint(point) {
    if (point > this.config.window) {
      return {
        time: point,
        available: false,
        observedAt: null,
        reason: 'outside-window',
        D: null,
        L: null,
        D_raw: null,
        L_raw: null,
        effectiveDamage: null,
        effectiveHeal: null,
        wastedHeal: null,
        shieldAbsorbed: null,
        shieldConsumed: null,
        states: null,
      };
    }
    if (point > this.state.currentTime + EPSILON) {
      return {
        time: point,
        available: false,
        observedAt: null,
        reason: this.state.death ? 'battle-ended' : 'actual-time-not-reached',
        D: null,
        L: null,
        D_raw: null,
        L_raw: null,
        effectiveDamage: null,
        effectiveHeal: null,
        wastedHeal: null,
        shieldAbsorbed: null,
        shieldConsumed: null,
        states: null,
      };
    }
    let candidate = null;
    for (const snapshot of this.eventSnapshots) {
      if (snapshot.time <= point + EPSILON) candidate = snapshot;
    }
    if (!candidate) {
      return {
        time: point,
        available: false,
        observedAt: null,
        reason: 'no-observation',
        D: null,
        L: null,
        D_raw: null,
        L_raw: null,
        effectiveDamage: null,
        effectiveHeal: null,
        wastedHeal: null,
        shieldAbsorbed: null,
        shieldConsumed: null,
        states: null,
      };
    }
    const metrics = candidate?.metrics ?? emptyMetrics();
    const life = metrics.life;
    const damage = metrics.damage.effective;
    const loss = life.incomingHpDamage + life.selfDamage - life.effectiveHeal;
    return {
      time: point,
      available: true,
      observedAt: candidate?.time ?? null,
      D: damage,
      L: loss,
      D_raw: damage,
      L_raw: loss,
      effectiveDamage: damage,
      effectiveHeal: life.effectiveHeal,
      wastedHeal: metrics.healing.overflowWasted,
      shieldAbsorbed: metrics.shield.absorbed,
      shieldConsumed: metrics.shield.consumed,
      states: clone(candidate?.states ?? null),
    };
  }

  result() {
    const life = this.metrics.life;
    const loss = life.incomingHpDamage + life.selfDamage - life.effectiveHeal;
    const shieldRows = this._shieldRows();
    const shieldConservation = sum(shieldRows.map((row) => row.conservation));
    const actualRounds = this.state.currentTime;
    const terminal = this.state.death;
    const selfDeath = terminal?.target === 'self' ? terminal : null;
    const victory = terminal?.target === 'enemy' ? terminal : null;
    const complete = !terminal && actualRounds >= this.config.window - EPSILON;
    const rageSource = {
      window: this.config.window,
      actualTime: actualRounds,
      earlyEnd: selfDeath ? 'death' : (victory ? 'victory' : (complete ? null : 'window-not-reached')),
      death: clone(selfDeath),
      victory: clone(victory),
      incomingSegments: clone(this.metrics.incomingSegments ?? []),
      ledger: clone(this.ledger),
    };
    const damageRaw = this.metrics.damage.effective;
    const lifeRaw = loss;
    const earlyEnd = selfDeath
      ? 'death'
      : (victory ? 'victory' : (complete ? null : 'window-not-reached'));
    return {
      version: 'effects-fixture-v1',
      window: this.config.window,
      actualTime: actualRounds,
      complete,
      active: !terminal,
      earlyEnd,
      death: clone(selfDeath),
      victory: clone(victory),
      D_raw: damageRaw,
      L_raw: lifeRaw,
      units: {
        D: 'raw-enemy-effective-damage',
        L: 'raw-net-effective-life-loss',
        D_raw: 'raw-enemy-effective-damage',
        L_raw: 'raw-net-effective-life-loss',
        powerScore: 'not-a-normalized-index',
      },
      // Compatibility aliases. These are raw fixture quantities, not
      // normalized values accepted by the formal powerScore audit.
      D: damageRaw,
      L: lifeRaw,
      damage: {
        ...clone(this.metrics.damage),
        unfulfilledDot: this._dotUnfulfilled(),
      },
      life: {
        ...clone(life),
        netLoss: loss,
      },
      healing: clone(this.metrics.healing),
      shield: {
        ...clone(this.metrics.shield),
        remaining: sum(shieldRows.map((row) => row.remaining)),
        conservation: shieldConservation,
        byTarget: Object.fromEntries(TARGETS.map((target) => [
          target,
          shieldRows
            .filter((row) => row.target === target)
            .map((row) => clone(row)),
        ])),
      },
      dot: {
        ...clone(this.metrics.dot),
        unfulfilled: this._dotUnfulfilled(),
      },
      states: Object.fromEntries(TARGETS.map((target) => [
        target,
        this._publicStatuses(target),
      ])),
      statusCoverage: this._statusCoverage(),
      checkpoints: Object.fromEntries(
        this.config.checkpoints.map((point) => [point, this._checkpoint(point)]),
      ),
      ledger: clone(this.ledger),
      incomingSegments: clone(this.metrics.incomingSegments ?? []),
      rageInputs: toRageRoundInputs(rageSource, {rounds: this.config.window}),
    };
  }
}

export function runFixture(config = {}) {
  const battle = new EffectBattle(config);
  const events = config.events ?? [];
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  for (const event of events) battle.applyEvent(event);
  return battle.result();
}

export function restoreEffectBattle(snapshot) {
  return EffectBattle.fromSnapshot(snapshot);
}

function legalSelfHeal(entry) {
  if (
    entry.kind !== 'heal'
    || entry.target !== 'self'
    || entry.actor !== 'self'
    || entry.sourceRole !== 'self'
    || entry.inBattle === false
    || !(entry.effective > EPSILON)
  ) {
    return false;
  }
  const context = entry.triggerContext;
  if (typeof context === 'string') {
    return ['main-action', 'main-action-derived'].includes(context);
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) return false;
  const kind = String(context.kind ?? context.type ?? context.trigger ?? '');
  if (['main-action', 'main-action-derived'].includes(kind)) {
    return context.owner !== 'enemy';
  }
  if (['derived', 'action-derived'].includes(kind)) {
    const parent = String(
      context.parent
      ?? context.parentType
      ?? context.parentKind
      ?? context.from
      ?? '',
    );
    return ['main-action', 'self-main-action'].includes(parent)
      && context.owner !== 'enemy';
  }
  return false;
}

/**
 * Converts actual effect results to the input shape consumed by the existing
 * resource-only rage audit. No rage value is inferred here; only actual
 * direct incoming segments, effective self-heals, and effective DOT output
 * are copied as conditions.
 */
export function toRageRoundInputs(resultOrBattle, {
  rounds,
  subjectSide = 'A',
} = {}) {
  const result = resultOrBattle instanceof EffectBattle
    ? resultOrBattle.result()
    : resultOrBattle;
  if (!result || typeof result !== 'object') throw new TypeError('invalid effect result');
  const count = nonNegativeInteger(rounds ?? result.window ?? 15, 'rounds');
  if (count <= 0) throw new RangeError('rounds must be positive');
  if (!['A', 'B'].includes(subjectSide)) throw new RangeError('subjectSide must be A or B');
  const opponentSide = subjectSide === 'A' ? 'B' : 'A';
  const grouped = Array.from({length: count}, () => ({
    incomingSegments: [],
    poisonFireTicks: 0,
    selfHealActions: 0,
  }));
  for (const segment of result.incomingSegments ?? []) {
    const round = segment.round ?? byRound(segment.time, count);
    if (round == null || round < 1 || round > count) continue;
    grouped[round - 1].incomingSegments.push({
      kind: 'enemy-direct',
      hpDamage: nonNegative(segment.hpDamage, 'incoming hp damage'),
      shieldAbsorbed: nonNegative(segment.shieldAbsorbed, 'incoming shield absorbed'),
    });
  }
  for (const entry of result.ledger ?? []) {
    if (
      entry.kind === 'damage'
      && entry.category === 'dot'
      && entry.target === 'enemy'
      && entry.sourceRole === 'self'
      && entry.hpDamage > EPSILON
    ) {
      const round = entry.round ?? byRound(entry.time, count);
      if (round != null && round >= 1 && round <= count) {
        grouped[round - 1].poisonFireTicks += 1;
      }
    }
    if (legalSelfHeal(entry)) {
      const round = entry.round ?? byRound(entry.time, count);
      if (round != null && round >= 1 && round <= count) {
        grouped[round - 1].selfHealActions += 1;
      }
    }
  }
  const terminalRound = result.earlyEnd === 'death' || result.earlyEnd === 'victory'
    ? Math.max(1, Math.floor(nonNegative(result.actualTime ?? 0, 'actualTime')))
    : null;
  return grouped.map((input, index) => ({
    battleContinues: terminalRound == null || index + 1 < terminalRound,
    death: clone(result.death ?? null),
    victory: clone(result.victory ?? null),
    earlyEnd: result.earlyEnd ?? null,
    sides: {
      [subjectSide]: input,
      [opponentSide]: {},
    },
  }));
}
