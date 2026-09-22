import assert from 'node:assert/strict';
import {powerScore} from '../power-budget/audit.mjs';
const EPS = 1e-9;
const RES = ['S', 'XP', 'Heal'];
const NRES = ['coin', 'xp', 'heal'];
const RARITY = {common: 1, rare: 2.4, legendary: 4};
export const RARITY_BUDGET = Object.freeze(RARITY);
export const BUDGET_TARGETS = Object.freeze({common: {B: 1, range: [0.8, 1.2]}, rare: {B: 2.4, range: [2, 3]}, legendary: {B: 4, range: [3.6, 5]}});
export const SCORE_TEMPLATES = Object.freeze({
  combat: {A: [5, 12, 20], J: [0, 0, 0]},
  travel: {A: [1, 3, 5], J: [0.8, 1.8, 3]},
  hybrid: {A: [3, 7, 12], J: [0.4, 1, 1.6]},
});
export const NODE_TYPES = Object.freeze(['C', 'E', 'K', 'L', 'S', 'R', 'B']);
export const COMBAT_NODE_TYPES = Object.freeze(['C', 'L', 'B']);
export const TRAVEL_WINDOWS = Object.freeze({next3: {count: 3}, next11: {count: 11}, remaining: {count: null}});
const ITEM_RATES = {RC16: {resource: 'xp', amount: 1, scope: 'all'}, RC17: {resource: 'heal', amount: 2, scope: 'all'}, RC18: {resource: 'coin', amount: 2, scope: 'all'}, RR06: {resource: 'heal', amount: null, scope: 'combat'}};
const STACK_CAPS = Object.freeze({RC16: 3, RC17: 3, RC18: 3, RR06: 1});
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const nonneg = (v) => finite(v) && v >= 0;
const bad = (reason, extra = {}) => ({ok: false, value: null, reason, ...extra});
function finish(result, strict) {
  if (!result.ok && strict) throw new RangeError(result.reason);
  return result;
}
function close(a, b) { return Math.abs(a - b) <= EPS; }
function int(v) { return Number.isInteger(v); }
function readPower(value, label) {
  if (!value || typeof value !== 'object') return bad(`${label}_missing`);
  if (value.complete !== true) return bad(`${label}_incomplete`);
  if (!['D', 'L', 'H'].every((k) => finite(value[k]))) return bad(`${label}_not_finite`);
  if (value.L <= 0) return bad(`${label}_L_not_positive`);
  if (value.H <= 0) return bad(`${label}_H_not_positive`);
  if (value.D < 0) return bad(`${label}_D_negative`);
  try {
    const P = powerScore({...value, complete: true});
    return finite(P) ? {ok: true, P} : bad(`${label}_power_not_finite`);
  }
  catch (error) { return bad(`${label}_power_rejected`, {message: error.message}); }
}
export function compareCombat({without, withPower, with: alias, strict = false} = {}) {
  const base = readPower(without, 'without');
  if (!base.ok) return finish(base, strict);
  if (base.P <= 0) return finish(bad('P_without_not_positive'), strict);
  const measured = readPower(withPower ?? alias, 'with');
  if (!measured.ok) return finish(measured, strict);
  if (without?.referenceId != null && (withPower ?? alias)?.referenceId != null
    && without.referenceId !== (withPower ?? alias).referenceId) {
    return finish(bad('reference_fixture_mismatch'), strict);
  }
  const A = 100 * (measured.P / base.P - 1);
  if (!finite(A)) return finish(bad('combat_score_not_finite'), strict);
  return {ok: true, value: A, A, P_without: base.P, P_with: measured.P,
    reason: null};
}
export function combatA(input = {}) {
  const result = compareCombat(input);
  return result.ok ? result.A : null;
}
export function stackBudget({
  rarity = 'common', n, maxLayers, baselineP, currentP, previousA, previousP, strict = false,
} = {}) {
  if (!Object.hasOwn(RARITY, rarity)) return finish(bad('unknown_rarity'), strict);
  if (!int(n) || n < 0) return finish(bad('layer_count_not_integer'), strict);
  const cap = maxLayers ?? (rarity === 'common' ? 3 : 1);
  const allowedCaps = rarity === 'common' ? [3, 5] : [1];
  if (rarity !== 'common' && n > 1) return finish(bad('unique_rarity_single_item'), strict);
  if (!int(cap) || !allowedCaps.includes(cap)) return finish(bad('layer_cap_invalid'), strict);
  if (n > cap) return finish(bad('layer_cap_exceeded'), strict);
  if (!finite(baselineP) || baselineP <= 0) return finish(bad('baseline_not_positive'), strict);
  if (!finite(currentP) || currentP < 0) return finish(bad('current_not_non_negative'), strict);
  if (n === 0 && !close(currentP, baselineP)) {
    return finish(bad('zero_layer_must_equal_baseline'), strict);
  }
  const A = 100 * (currentP / baselineP - 1);
  if (!finite(A)) return finish(bad('layer_score_not_finite'), strict);
  let previous = 0;
  if (n > 0) {
    if (finite(previousA)) previous = previousA;
    else if (nonneg(previousP)) previous = 100 * (previousP / baselineP - 1);
    else return finish(bad('previous_layer_missing'), strict);
  }
  if (!finite(previous)) return finish(bad('previous_layer_not_finite'), strict);
  if (previous < -100) return finish(bad('previous_layer_below_zero_power'), strict);
  if (previousP !== undefined && (!nonneg(previousP)
    || !close(previous, 100 * (previousP / baselineP - 1)))) {
    return finish(bad('previous_layer_reference_mismatch'), strict);
  }
  if (n === 1 && !close(previous, 0)) {
    return finish(bad('first_layer_requires_zero_baseline'), strict);
  }
  const marginalA = A - previous;
  if (!finite(marginalA)) return finish(bad('marginal_score_not_finite'), strict);
  return {ok: true, value: A, A, marginalA, n, rarity, maxLayers: cap,
    reason: null};
}
function resource(value, label, allowNull = false) {
  if (!value || typeof value !== 'object') return bad(`${label}_missing`);
  const aliases = {S: ['S', 'coin', 'coins'], XP: ['XP', 'xp'], Heal: ['Heal', 'heal', 'healing']};
  const result = {};
  for (const key of RES) {
    const name = aliases[key].find((candidate) => Object.hasOwn(value, candidate));
    if (!name) return bad(`${label}_${key}_missing`);
    if (value[name] === null && allowNull) result[key] = null;
    else if (!nonneg(value[name])) return bad(`${label}_${key}_not_non_negative`);
    else result[key] = value[name];
  }
  return {ok: true, resources: result};
}
function xpMode(input) {
  if (input.nextRealm === 'none') return 'none';
  if (input.nextRealm === 'unknown' || input.nextRealmConfirmed === false
    || input.xpThresholdKnown === false || input.nextDemandKnown === false) return 'unknown';
  if (input.nextRealm === 'confirmed' || input.nextRealmConfirmed === true) return 'confirmed';
  return 'unknown';
}
function futureMode(value) {
  if (value === true || value === 'confirmed') return 'confirmed';
  if (value === false || value === 'none') return 'none';
  return 'unknown';
}
export function travelUtility({
  anchors = {}, raw, usable, waste, unknown, terminal = false, strict = false,
  xpDemandKind, xpIsGap = false, ...input
} = {}) {
  if (xpDemandKind === 'remaining-gap' || xpIsGap) {
    return finish(bad('X_must_be_complete_next_demand'), strict);
  }
  const rr = resource(raw, 'raw');
  const ur = resource(usable, 'usable', true);
  const wr = resource(waste, 'waste');
  const xr = unknown == null ? {ok: true, resources: {S: 0, XP: 0, Heal: 0}} : resource(unknown, 'unknown');
  for (const result of [rr, ur, wr, xr]) if (!result.ok) return finish(result, strict);
  for (const key of RES) {
    const u = ur.resources[key];
    const total = wr.resources[key] + xr.resources[key];
    if ((u === null && !close(rr.resources[key], total))
      || (u !== null && !close(rr.resources[key], u + total))) {
      return finish(bad(`resource_${key}_ledger_mismatch`), strict);
    }
  }
  const mode = xpMode(input);
  const X = anchors.X ?? anchors.nextXP ?? anchors.nextDemand;
  const future = input.futureUse ?? {};
  const coinFuture = futureMode(Object.hasOwn(input, 'coinFutureUse')
    ? input.coinFutureUse : future.coin);
  const use = {...ur.resources};
  const lost = {...wr.resources};
  const pending = {...xr.resources};
  const reasons = [];
  if (terminal) {
    for (const key of RES) {
      lost[key] = rr.resources[key];
      pending[key] = 0;
      use[key] = 0;
      if (rr.resources[key] > 0) reasons.push('terminal_output_not_usable');
    }
  } else {
    const modeFor = {S: coinFuture, XP: mode};
    for (const key of RES) {
      const remaining = rr.resources[key] - lost[key];
      if (close(remaining, 0)) {
        use[key] = 0;
        pending[key] = 0;
        continue;
      }
      if (remaining < 0) {
        return finish(bad(`resource_${key}_ledger_mismatch`), strict);
      }
      const validity = modeFor[key];
      if (validity === 'none') {
        if (use[key] !== null && use[key] > 0) {
          return finish(bad(key === 'S' ? 'coin_has_no_future_use'
            : 'xp_has_no_confirmed_next_realm'), strict);
        }
        use[key] = 0;
        lost[key] = rr.resources[key];
        pending[key] = 0;
        reasons.push(key === 'S' ? 'coin_no_future_use' : 'no_confirmed_next_realm');
      } else if (validity === 'unknown') {
        use[key] = null;
        pending[key] = remaining;
        reasons.push(key === 'S' ? 'coin_future_use_unknown' : 'xp_threshold_unknown');
      } else if (key === 'Heal' && use[key] === null) {
        pending[key] = remaining;
        reasons.push('hp_gap_unknown');
      } else if (key === 'Heal') {
        pending[key] = rr.resources[key] - use[key] - lost[key];
      } else {
        if (use[key] === null) {
          pending[key] = remaining;
        } else {
          pending[key] = rr.resources[key] - use[key] - lost[key];
        }
      }
    }
  }
  const C = anchors.C ?? anchors.coinPrice ?? anchors.commonPrice;
  const H = anchors.H ?? anchors.maxHp;
  const common = {
    ok: true, raw: rr.resources, usable: use, waste: lost, unknown: pending,
    anchors: {C: C ?? null, X: X ?? null, H: H ?? null},
    reasons: [...new Set(reasons)],
  };
  const contributions = {S: 0, XP: 0, Heal: 0};
  const anchorFor = {S: C, XP: X, Heal: H};
  const denominatorFor = {S: (value) => 0.5 * value, XP: (value) => 0.2 * value,
    Heal: (value) => 0.2 * value};
  const anchorReason = {S: 'anchor_C_not_positive', XP: 'anchor_X_not_positive',
    Heal: 'anchor_H_not_positive'};
  const unknownReason = {S: 'coin_future_use_unknown', XP: 'xp_threshold_unknown',
    Heal: 'hp_gap_unknown'};
  let uncertain = false;
  let firstReason = null;
  for (const key of RES) {
    const amount = use[key];
    if (amount === null) {
      contributions[key] = null;
      uncertain = true;
      reasons.push(unknownReason[key]);
      firstReason ??= unknownReason[key];
      continue;
    }
    if (amount === 0) {
      contributions[key] = 0;
      if (pending[key] > 0) {
        uncertain = true;
        reasons.push(unknownReason[key]);
        firstReason ??= unknownReason[key];
      }
      continue;
    }
    const anchor = anchorFor[key];
    if (!finite(anchor) || anchor <= 0) {
      contributions[key] = null;
      uncertain = true;
      firstReason ??= anchorReason[key];
      continue;
    }
    const denominator = denominatorFor[key](anchor);
    const contribution = amount / denominator;
    if (!finite(contribution)) {
      contributions[key] = null;
      uncertain = true;
      firstReason ??= anchorReason[key];
      continue;
    }
    contributions[key] = contribution;
    if (pending[key] > 0) {
      uncertain = true;
      reasons.push(unknownReason[key]);
      firstReason ??= unknownReason[key];
    }
  }
  common.reasons = [...new Set(reasons)];
  if (uncertain) return {...common, value: null, J: null, contributions,
    reason: firstReason};
  const J = contributions.S + contributions.XP + contributions.Heal;
  if (!finite(J)) return {...common, value: null, J: null, contributions,
    reason: 'travel_score_not_finite'};
  return {...common, value: J, J, contributions, reason: null};
}
export const calculateTravelJ = travelUtility;
function stacks(value, label) {
  if (value == null) return {ok: true, map: {}};
  if (typeof value !== 'object' || Array.isArray(value)) return bad(`${label}_not_object`);
  const map = {};
  for (const [id, count] of Object.entries(value)) {
    if (!int(count) || count < 0) return bad(`${label}_${id}_not_non_negative_integer`);
    if (Object.hasOwn(STACK_CAPS, id) && count > STACK_CAPS[id]) {
      return bad(`${label}_${id}_cap_exceeded`);
    }
    map[id] = count;
  }
  return {ok: true, map};
}
function gap(node) {
  if (node.hpGap !== undefined) return nonneg(node.hpGap) ? {known: true, value: node.hpGap} : {known: false};
  if (finite(node.maxHp) && finite(node.currentHp) && node.maxHp >= node.currentHp) {
    return {known: true, value: node.maxHp - node.currentHp};
  }
  return {known: false};
}
function empty() { return {coin: 0, xp: 0, heal: 0}; }
function add(target, key, value) {
  if (value === null) target[key] = null;
  else if (target[key] !== null) {
    const sum = target[key] + value;
    target[key] = finite(sum) ? sum : null;
  }
}
function nodeUse(options) {
  const f = options.futureUse ?? {};
  const coin = Object.hasOwn(options, 'coinFutureUse') ? options.coinFutureUse : f.coin;
  return {coin: futureMode(coin)};
}
function qualified(id, entry, exit) {
  if (!Object.hasOwn(entry, id) || !Object.hasOwn(exit, id)) return {count: null, reason: 'stack_snapshot_unknown'};
  if (exit[id] > entry[id]) return {count: null, reason: 'new_or_rebought_stack_not_old'};
  return {count: exit[id], reason: null};
}
function nodeLine(node, options) {
  const id = node.nodeId ?? node.id;
  const type = String(node.type ?? '').toUpperCase();
  const real = node.realNode !== false;
  const terminal = Boolean(node.isTerminal);
  const complete = node.completed !== false;
  const alive = node.alive !== false && node.dead !== true;
  const er = stacks(node.entryStacks, 'entryStacks');
  const xr = stacks(node.exitEligibleOriginalStacks, 'exitEligibleOriginalStacks');
  if (!er.ok) return er;
  if (!xr.ok) return xr;
  const entry = er.map; const exit = xr.map;
  const rates = Object.fromEntries(Object.entries(ITEM_RATES).map(([item, base]) => [
    item, {...base, ...(options.rates?.[item] ?? {}), ...(node.rates?.[item] ?? {})},
  ]));
  const ids = new Set([...Object.keys(entry), ...Object.keys(exit), ...Object.keys(node.rates ?? {})]);
  const eligible = real && NODE_TYPES.includes(type) && complete && alive;
  const counts = Object.fromEntries(Object.keys(ITEM_RATES)
    .filter((item) => !ids.has(item)).map((item) => [item, 0]));
  const triggerReasons = {};
  for (const item of ids) {
    const rate = rates[item];
    if (!rate) continue;
    if (!eligible) {
      counts[item] = 0;
      triggerReasons[item] = !real ? 'not_real_node' : !complete ? 'node_not_completed'
        : !alive ? 'node_dead' : 'invalid_node_type';
    } else if (rate.scope === 'combat' && !COMBAT_NODE_TYPES.includes(type)) {
      counts[item] = 0; triggerReasons[item] = 'not_a_qualifying_combat_node';
    } else {
      const q = qualified(item, entry, exit);
      counts[item] = q.count; if (q.reason) triggerReasons[item] = q.reason;
    }
  }
  const raw = empty(); const uncertain = {}; const reasons = Object.values(triggerReasons);
  for (const [item, count] of Object.entries(counts)) {
    const rate = rates[item];
    if (count === null) { uncertain[rate.resource] = true; continue; }
    if (count === 0) continue;
    const amount = item === 'RR06' ? node.rr06HealRawPerStack ?? options.rr06HealRawPerStack ?? rate.amount : rate.amount;
    if (!nonneg(amount)) { uncertain[rate.resource] = true; reasons.push('reward_amount_missing'); continue; }
    const reward = count * amount;
    if (!finite(reward)) {
      uncertain[rate.resource] = true;
      reasons.push('reward_amount_not_finite');
      continue;
    }
    const sum = raw[rate.resource] + reward;
    if (!finite(sum)) {
      uncertain[rate.resource] = true;
      reasons.push('resource_total_not_finite');
    } else {
      raw[rate.resource] = sum;
    }
  }
  for (const key of NRES) if (uncertain[key]) raw[key] = null;
  const nodeOptions = {...options, ...node};
  const use = empty(); const lost = empty(); const pending = empty(); const future = nodeUse(nodeOptions);
  const mode = xpMode(nodeOptions);
  for (const key of NRES) {
    if (terminal) {
      use[key] = 0; lost[key] = raw[key]; pending[key] = 0;
      if (raw[key] !== 0) reasons.push('terminal_output_not_usable');
      continue;
    }
    if (raw[key] === null) { use[key] = null; pending[key] = null; continue; }
    if (raw[key] === 0) { use[key] = 0; lost[key] = 0; pending[key] = 0; continue; }
    if (key === 'coin' && future.coin === 'none') { use[key] = 0; lost[key] = raw[key]; if (raw[key]) reasons.push('coin_no_future_use'); continue; }
    if (key === 'coin' && future.coin === 'unknown') { use[key] = null; pending[key] = raw[key]; reasons.push('coin_future_use_unknown'); continue; }
    if (key === 'xp' && mode === 'none') { use[key] = 0; lost[key] = raw[key]; if (raw[key]) reasons.push('no_confirmed_next_realm'); continue; }
    if (key === 'xp' && mode === 'unknown') { use[key] = null; pending[key] = raw[key]; reasons.push('xp_threshold_unknown'); continue; }
    if (key === 'heal') {
      const g = gap(node);
      if (!raw[key]) use[key] = lost[key] = 0;
      else if (!g.known) { use[key] = null; pending[key] = raw[key]; reasons.push('hp_gap_unknown'); }
      else { use[key] = Math.min(raw[key], g.value); lost[key] = raw[key] - use[key]; }
    } else use[key] = raw[key];
  }
  return {ok: true, nodeId: String(id ?? ''), type, realNode: real, isTerminal: terminal,
    completed: complete, alive, eligible, triggerCounts: counts, triggerReasons, raw,
    usable: use, waste: lost, unknown: pending, reasons: [...new Set(reasons.filter(Boolean))]};
}
export function buildNodeLedger(nodes = [], options = {}) {
  if (!Array.isArray(nodes)) return bad('nodes_not_array');
  const policy = options.duplicate ?? 'throw'; const seen = new Set(); const lines = []; const skipped = [];
  if (!['throw', 'skip'].includes(policy)) return bad('unknown_duplicate_policy');
  let routeStopped = false;
  for (const node of nodes) {
    const candidate = node ?? {};
    const candidateId = String(candidate.nodeId ?? candidate.id ?? '');
    if (!candidateId) return bad('node_id_missing');
    if (seen.has(candidateId)) {
      if (policy === 'throw') throw new RangeError(`duplicate_node:${candidateId}`);
      skipped.push(candidateId);
      continue;
    }
    seen.add(candidateId);
    if (routeStopped) continue;
    const line = nodeLine(candidate, options);
    if (!line.ok) return line;
    if (!line.nodeId) return bad('node_id_missing');
    lines.push(line);
    if (line.isTerminal || !line.alive) routeStopped = true;
  }
  const totals = {raw: empty(), usable: empty(), waste: empty(), unknown: empty()};
  const triggerCounts = {RC16: 0, RC17: 0, RC18: 0, RR06: 0};
  for (const line of lines) {
    if (line.skipped) continue;
    for (const key of NRES) {
      add(totals.raw, key, line.raw[key]); add(totals.waste, key, line.waste[key]);
      add(totals.unknown, key, line.unknown[key]); add(totals.usable, key, line.usable[key]);
    }
    for (const item of Object.keys(triggerCounts)) {
      if (line.triggerCounts[item] !== undefined) add(triggerCounts, item, line.triggerCounts[item]);
    }
  }
  const real = lines.filter((line) => !line.skipped && line.realNode);
  return {ok: true, nodes: lines, totals, counts: {
    allNodes: lines.filter((line) => !line.skipped).length,
    realNodes: real.length, combatNodes: real.filter((line) => COMBAT_NODE_TYPES.includes(line.type)).length,
    triggerCounts,
  }, skippedDuplicates: skipped, duplicatePolicy: policy, routeStopped};
}
export function selectTravelWindow(nodes = [], {
  name = 'next11', start = 0, includeTerminal = false, duplicate = 'throw',
} = {}) {
  if (!Array.isArray(nodes)) return bad('nodes_not_array');
  const window = TRAVEL_WINDOWS[name];
  if (!window) return bad('unknown_window');
  const candidates = []; const seen = new Set();
  const policy = duplicate;
  if (!['throw', 'skip'].includes(policy)) return bad('unknown_duplicate_policy');
  let routeStopped = false; const skippedDuplicates = [];
  for (const node of nodes) {
    const candidate = node ?? {};
    const id = String(candidate.nodeId ?? candidate.id ?? '');
    if (!id) return bad('node_id_missing');
    if (seen.has(id)) {
      if (policy === 'throw') throw new RangeError(`duplicate_node:${id}`);
      skippedDuplicates.push(id);
      continue;
    }
    seen.add(id);
    if (routeStopped || candidate?.realNode === false) continue;
    candidates.push(candidate);
    if (candidate?.isTerminal || candidate?.alive === false || candidate?.dead === true) routeStopped = true;
  }
  if (!finite(start)) return bad('window_start_not_finite');
  const offset = Math.max(0, Math.trunc(start));
  const available = candidates.filter((node) => includeTerminal || !node?.isTerminal);
  const selected = window.count === null ? available.slice(offset) : available.slice(offset, offset + window.count);
  return {ok: true, name, requestedCount: window.count, start: offset, actualCount: selected.length,
    nodeIds: selected.map((node) => String(node.nodeId ?? node.id ?? '')), nodes: selected, padded: false,
    routeStopped, skippedDuplicates};
}
export function purchaseSavings({oldPrice, paidPrice, purchased = true, strict = false} = {}) {
  if (!purchased) return {ok: true, savings: 0, value: 0, reason: 'not_purchased'};
  if (!nonneg(oldPrice) || !nonneg(paidPrice)) return finish(bad('purchase_price_not_non_negative'), strict);
  if (paidPrice > oldPrice) return finish(bad('paid_above_old_price'), strict);
  return {ok: true, savings: oldPrice - paidPrice, value: oldPrice - paidPrice, reason: null};
}
export function pickedOfferBudget(offers = [], pickedIndex = 0) {
  if (!Array.isArray(offers) || !int(pickedIndex) || pickedIndex < 0 || pickedIndex >= offers.length) {
    return bad('picked_offer_invalid');
  }
  const values = offers.map((offer) => typeof offer === 'number' ? offer : RARITY[offer] ?? RARITY[offer?.rarity]);
  if (values.some((value) => !finite(value) || value < 0)) return bad('offer_value_invalid');
  return {ok: true, value: values[pickedIndex], pickedIndex, offerCount: offers.length};
}
export function nominalOfferBudget({acts = 4, commonPerAct = 4, rarePerAct = 2} = {}) {
  if (![acts, commonPerAct, rarePerAct].every((v) => int(v) && v >= 0)) return bad('offer_count_invalid');
  const perAct = commonPerAct + rarePerAct * RARITY.rare;
  return {ok: true, perAct, fullRun: acts * perAct, commonTotal: acts * commonPerAct,
    rareTotal: acts * rarePerAct, legendaryReplacingRareDelta: 1.6, eliteReplacingCommonDelta: 1.4,
    nominalOnly: true, actualPowerPercent: null, reason: null};
}
export function totalBudget({A, J, rarity, strict = false} = {}) {
  if (!finite(A) || !finite(J)) return finish(bad('A_or_J_not_finite'), strict);
  if (J < 0) return finish(bad('J_negative'), strict);
  if (rarity !== undefined && !Object.hasOwn(BUDGET_TARGETS, rarity)) {
    return finish(bad('unknown_rarity'), strict);
  }
  const U = A / 5 + J;
  if (!finite(U)) return finish(bad('U_not_finite'), strict);
  const result = {ok: true, value: U, U, A, J,
    budgetAcceptance: rarity === undefined ? null : false,
    reason: rarity === undefined ? 'rarity_missing'
      : A < 0 ? 'negative_combat_offset_not_accepted' : null};
  if (rarity !== undefined) {
    const target = BUDGET_TARGETS[rarity];
    result.targetB = target.B;
    result.range = [...target.range];
    result.matchesTarget = close(U, target.B);
    result.inRange = U >= target.range[0] - EPS && U <= target.range[1] + EPS;
    result.budgetAcceptance = A >= 0 && result.inRange;
    if (!result.budgetAcceptance && A >= 0 && !result.inRange) result.reason = 'budget_out_of_range';
  }
  return result;
}
export function evaluateTemplate(kind, tierIndex = 0) {
  const t = SCORE_TEMPLATES[kind];
  if (!t || !int(tierIndex) || tierIndex < 0 || tierIndex > 2) return bad('template_or_tier_invalid');
  return totalBudget({A: t.A[tierIndex], J: t.J[tierIndex], rarity: ['common', 'rare', 'legendary'][tierIndex]});
}
const checks = [];
function check(name, fn) { try { fn(); checks.push({name, passed: true}); } catch (error) { checks.push({name, passed: false, error}); } }
function equal(a, b) { assert.equal(a, b); }
function near(a, b) { assert.ok(Math.abs(a - b) <= 1e-6, `${a} !== ${b}`); }
const power = (D, L, H = 100) => ({D, L, H, complete: true});
const nodes = ['C', 'E', 'C', 'R', 'E', 'S', 'C', 'E', 'C', 'L', 'B']
  .map((type, i) => ({nodeId: `N${i}`, type, hpGap: 10,
    entryStacks: {RC16: 1, RC17: 1, RC18: 1, RR06: 1},
    exitEligibleOriginalStacks: {RC16: 1, RC17: 1, RC18: 1, RR06: 1}}));
check('rarity-and-template-B', () => {
  equal(JSON.stringify(RARITY), JSON.stringify({common: 1, rare: 2.4, legendary: 4}));
  for (const kind of Object.keys(SCORE_TEMPLATES)) [1, 2.4, 4].forEach((b, i) => {
    const r = evaluateTemplate(kind, i); equal(r.ok, true); near(r.U, b); equal(r.budgetAcceptance, true);
  });
});
check('combat-ratio-and-boundaries', () => {
  near(combatA({without: power(100, 100), withPower: power(105, 100)}), 5);
  near(combatA({without: power(200, 100), withPower: power(210, 100)}), 5);
  near(compareCombat({without: power(100, 100), withPower: power(0, 100)}).A, -100);
  equal(Object.hasOwn(compareCombat({without: power(100, 100), withPower: power(0, 100)}), 'budgetAcceptance'), false);
  equal(combatA({without: power(0, 100), withPower: power(100, 100)}), null);
  equal(combatA({without: power(100, 0), withPower: power(100, 100)}), null);
  equal(combatA({without: {...power(100, 100), complete: undefined}, withPower: power(100, 100)}), null);
  equal(compareCombat({without: {...power(100, 100), complete: false}, withPower: power(100, 100)}).reason, 'without_incomplete');
});
check('pure-defense-and-mixed-DHL', () => {
  [100, 80, 100 / 1.5, 100 / 1.75, 50].forEach((L, i) => near(combatA({
    without: power(100, 100), withPower: power(100, L),
  }), [0, 25, 50, 75, 100][i]));
  near(compareCombat({without: power(100, 100), withPower: power(110, 88)}).A, 25);
});
check('stack-linear-caps-and-unique', () => {
  near(stackBudget({n: 3, maxLayers: 3, baselineP: 100, currentP: 115, previousA: 10}).A, 15);
  near(stackBudget({n: 5, maxLayers: 5, baselineP: 100, currentP: 125, previousA: 20}).A, 25);
  equal(stackBudget({n: 4, maxLayers: 3, baselineP: 100, currentP: 120, previousA: 15}).reason, 'layer_cap_exceeded');
  equal(stackBudget({rarity: 'rare', n: 2, maxLayers: 1, baselineP: 100, currentP: 120, previousA: 10}).reason, 'unique_rarity_single_item');
  equal(stackBudget({rarity: 'common', n: 0, maxLayers: 3, baselineP: 100, currentP: 101}).reason,
    'zero_layer_must_equal_baseline');
  equal(stackBudget({rarity: 'common', n: 1, maxLayers: 4, baselineP: 100, currentP: 105, previousA: 0}).reason,
    'layer_cap_invalid');
  equal(Object.hasOwn(stackBudget({n: 1, baselineP: 100, currentP: 105, previousA: 0}), 'budgetAcceptance'), false);
});
check('travel-formula-and-validation', () => {
  const r = travelUtility({anchors: {C: 40, X: 100, H: 200}, raw: {S: 20, XP: 20, Heal: 40},
    usable: {S: 20, XP: 20, Heal: 40}, waste: {S: 0, XP: 0, Heal: 0},
    coinFutureUse: true, nextRealm: 'confirmed'});
  near(r.J, 3); near(r.contributions.S, 1); near(r.contributions.XP, 1); near(r.contributions.Heal, 1);
  equal(travelUtility({anchors: {C: 40, H: 200}, raw: {S: 0, XP: 0, Heal: 0},
    usable: {S: 0, XP: 0, Heal: 0}, waste: {S: 0, XP: 0, Heal: 0}}).J, 0);
  equal(travelUtility({anchors: {C: 40, X: 20, H: 200}, raw: {S: 0, XP: 0, Heal: 0},
    usable: {S: 0, XP: 0, Heal: 0}, waste: {S: 0, XP: 0, Heal: 0}, xpIsGap: true}).reason,
  'X_must_be_complete_next_demand');
  const unknownCoin = travelUtility({raw: {S: 20, XP: 0, Heal: 0},
    usable: {S: null, XP: 0, Heal: 0}, waste: {S: 0, XP: 0, Heal: 0},
    unknown: {S: 20, XP: 0, Heal: 0}, coinFutureUse: true});
  equal(unknownCoin.J, null); equal(unknownCoin.contributions.S, null);
  equal(unknownCoin.reason, 'coin_future_use_unknown');
  const unknownZeroXP = travelUtility({raw: {S: 0, XP: 0, Heal: 0},
    usable: {S: 0, XP: null, Heal: 0}, waste: {S: 0, XP: 0, Heal: 0},
    unknown: {S: 0, XP: 0, Heal: 0}, nextRealm: 'unknown'});
  equal(unknownZeroXP.J, 0);
});
check('travel-no-next-and-unknown-XP', () => {
  const none = travelUtility({anchors: {C: 40, H: 200}, raw: {S: 20, XP: 50, Heal: 0},
    usable: {S: 20, XP: 0, Heal: 0}, waste: {S: 0, XP: 50, Heal: 0},
    coinFutureUse: true, nextRealm: 'none'});
  near(none.J, 1); equal(none.usable.XP, 0);
  const unknown = travelUtility({anchors: {C: 40, H: 200}, raw: {S: 0, XP: 50, Heal: 0},
    usable: {S: 0, XP: null, Heal: 0}, waste: {S: 0, XP: 0, Heal: 0},
    unknown: {S: 0, XP: 50, Heal: 0}, coinFutureUse: true, nextRealm: 'unknown'});
  equal(unknown.J, null); equal(unknown.unknown.XP, 50);
});
check('node-count-and-trigger-scope', () => {
  const r = buildNodeLedger(nodes, {rr06HealRawPerStack: 3, coinFutureUse: true, nextRealm: 'confirmed'});
  equal(r.counts.realNodes, 11); equal(r.counts.combatNodes, 6);
  equal(r.counts.triggerCounts.RC16, 11); equal(r.counts.triggerCounts.RR06, 6);
  equal(r.totals.raw.xp, 11); equal(r.totals.raw.heal, 40);
});
check('node-acquire-remove-rebuy-and-duplicate', () => {
  const r = buildNodeLedger([
    {nodeId: 'a', type: 'E', entryStacks: {RC16: 0}, exitEligibleOriginalStacks: {RC16: 0}},
    {nodeId: 'b', type: 'E', entryStacks: {RC16: 1}, exitEligibleOriginalStacks: {RC16: 1}},
    {nodeId: 'c', type: 'E', entryStacks: {RC18: 1}, exitEligibleOriginalStacks: {RC18: 0}},
    {nodeId: 'd', type: 'E', entryStacks: {RC18: 0}, exitEligibleOriginalStacks: {RC18: 1}},
  ]);
  equal(r.nodes[0].triggerCounts.RC16, 0); equal(r.nodes[1].triggerCounts.RC16, 1);
  equal(r.nodes[2].triggerCounts.RC18, 0); equal(r.nodes[3].triggerCounts.RC18, null);
  assert.throws(() => buildNodeLedger([{nodeId: 'x'}, {nodeId: 'x'}]), /duplicate_node:x/);
});
check('node-death-terminal-heal-and-event', () => {
  const dead = buildNodeLedger([
    {nodeId: 'before', type: 'E', hpGap: 10, entryStacks: {RC17: 1}, exitEligibleOriginalStacks: {RC17: 1}},
    {nodeId: 'dead', type: 'C', alive: false, hpGap: 100, entryStacks: {RC17: 1}, exitEligibleOriginalStacks: {RC17: 1}},
    {nodeId: 'after-death', type: 'E', hpGap: 10, entryStacks: {RC17: 1}, exitEligibleOriginalStacks: {RC17: 1}},
  ], {coinFutureUse: true, nextRealm: 'confirmed'});
  equal(dead.nodes.map((line) => line.nodeId).join(','), 'before,dead');
  equal(dead.totals.raw.heal, 2); equal(dead.totals.usable.heal, 2);
  equal(dead.nodes[1].raw.heal, 0); equal(dead.routeStopped, true);

  const terminal = buildNodeLedger([
    {nodeId: 'partial', type: 'E', hpGap: 1, entryStacks: {RC17: 1}, exitEligibleOriginalStacks: {RC17: 1}},
    {nodeId: 'full', type: 'E', hpGap: 0, entryStacks: {RC17: 1}, exitEligibleOriginalStacks: {RC17: 1}},
    {nodeId: 'terminal', type: 'B', isTerminal: true, hpGap: 100,
      entryStacks: {RC17: 1, RC18: 1, RR06: 0},
      exitEligibleOriginalStacks: {RC17: 1, RC18: 1, RR06: 0}},
    {nodeId: 'event', type: 'K', internalBattles: 2, entryStacks: {RR06: 1},
      exitEligibleOriginalStacks: {RR06: 1}, rr06HealRawPerStack: 10},
  ], {rr06HealRawPerStack: 10, coinFutureUse: true, nextRealm: 'confirmed'});
  equal(terminal.totals.raw.heal, 6); equal(terminal.totals.usable.heal, 1);
  equal(terminal.nodes[2].usable.heal, 0); equal(terminal.nodes[2].waste.heal, 2);
  equal(terminal.nodes[2].usable.coin, 0); equal(terminal.nodes[2].waste.coin, 2);
  equal(terminal.nodes[2].triggerCounts.RR06, 0); equal(terminal.routeStopped, true);
  equal(terminal.nodes.length, 3);
});
check('node-future-use-unknown-and-windows', () => {
  const coin = buildNodeLedger([{nodeId: 'c', type: 'E', entryStacks: {RC18: 1}, exitEligibleOriginalStacks: {RC18: 1}}], {coinFutureUse: false});
  equal(coin.totals.usable.coin, 0); equal(coin.totals.waste.coin, 2);
  const unknownCoin = buildNodeLedger([{nodeId: 'c-unknown', type: 'E', entryStacks: {RC18: 1},
    exitEligibleOriginalStacks: {RC18: 1}}]);
  equal(unknownCoin.totals.usable.coin, null); equal(unknownCoin.totals.unknown.coin, 2);
  const xp = buildNodeLedger([{nodeId: 'x', type: 'E', entryStacks: {RC16: 1}, exitEligibleOriginalStacks: {RC16: 1}}],
    {coinFutureUse: true, nextRealm: 'unknown'});
  equal(xp.totals.usable.xp, null); equal(xp.totals.unknown.xp, 1);
  equal(selectTravelWindow(nodes, {name: 'next3'}).actualCount, 3);
  equal(selectTravelWindow(nodes, {name: 'next11'}).actualCount, 11);
  equal(selectTravelWindow(nodes.slice(0, 3), {name: 'next11'}).actualCount, 3);
});
check('node-input-caps-conservation-and-window-stop', () => {
  const emptyNode = buildNodeLedger([{nodeId: 'empty', type: 'E'}], {coinFutureUse: true, nextRealm: 'confirmed'});
  equal(emptyNode.nodes[0].triggerCounts.RC16, 0);
  equal(emptyNode.nodes[0].triggerCounts.RR06, 0);
  const zeroRR06 = buildNodeLedger([{nodeId: 'zero-rr06', type: 'C',
    entryStacks: {RR06: 0}, exitEligibleOriginalStacks: {RR06: 0}}]);
  equal(zeroRR06.nodes[0].triggerCounts.RR06, 0);
  equal(zeroRR06.nodes[0].raw.heal, 0);
  equal(buildNodeLedger([{nodeId: 'too-many', type: 'E',
    entryStacks: {RC16: 4}, exitEligibleOriginalStacks: {RC16: 4}}]).reason,
  'entryStacks_RC16_cap_exceeded');

  const route = [
    {nodeId: 'first', type: 'E'},
    {nodeId: 'death', type: 'C', alive: false},
    {nodeId: 'after-death', type: 'E'},
    {nodeId: 'after-death', type: 'E'},
  ];
  const window = selectTravelWindow(route, {name: 'remaining', duplicate: 'skip'});
  equal(window.nodeIds.join(','), 'first,death');
  equal(window.skippedDuplicates.join(','), 'after-death');
  const ledger = buildNodeLedger(route, {duplicate: 'skip'});
  equal(ledger.nodes.map((line) => line.nodeId).join(','), 'first,death');
  for (const key of NRES) {
    equal(ledger.totals.raw[key], ledger.totals.usable[key]
      + ledger.totals.waste[key] + ledger.totals.unknown[key]);
  }
});
check('purchase-and-nominal-offers', () => {
  equal(purchaseSavings({oldPrice: 100, paidPrice: 70}).savings, 30);
  equal(purchaseSavings({oldPrice: 100, paidPrice: 70, purchased: false}).savings, 0);
  const n = nominalOfferBudget(); near(n.perAct, 8.8); near(n.fullRun, 35.2);
  near(n.legendaryReplacingRareDelta, 1.6); near(n.eliteReplacingCommonDelta, 1.4);
  equal(n.nominalOnly, true); equal(pickedOfferBudget(['common', 'rare', 'legendary'], 1).value, 2.4);
});
check('negative-A-cannot-subsidize-travel', () => {
  const r = totalBudget({A: -5, J: 2, rarity: 'common'});
  equal(r.U, 1); equal(r.budgetAcceptance, false); equal(r.reason, 'negative_combat_offset_not_accepted');
  equal(totalBudget({A: 100, J: 100, rarity: 'common'}).budgetAcceptance, false);
  equal(totalBudget({A: 5, J: 0}).budgetAcceptance, null);
  equal(totalBudget({A: 5, J: 0, rarity: 'mythic'}).reason, 'unknown_rarity');
});
check('first-layer-reference-and-previous-power', () => {
  equal(stackBudget({n: 1, baselineP: 100, currentP: 105, previousP: 200}).reason,
    'first_layer_requires_zero_baseline');
  equal(stackBudget({n: 2, baselineP: 100, currentP: 110, previousA: 5, previousP: 120}).reason,
    'previous_layer_reference_mismatch');
  equal(stackBudget({n: 2, baselineP: 100, currentP: 110, previousA: -101}).reason,
    'previous_layer_below_zero_power');
  near(stackBudget({n: 1, baselineP: 100, currentP: 105, previousP: 100}).marginalA, 5);
});
check('terminal-unknown-amount-and-unknown-trigger-count', () => {
  const end = buildNodeLedger([{nodeId: 'end', type: 'B', isTerminal: true,
    entryStacks: {RR06: 1}, exitEligibleOriginalStacks: {RR06: 1}}]);
  equal(end.totals.raw.heal, null);
  equal(end.totals.usable.heal, 0);
  equal(end.totals.waste.heal, null);
  equal(end.totals.unknown.heal, 0);
  const unresolved = buildNodeLedger([{nodeId: 'unknown-stack', type: 'E',
    entryStacks: {RC16: 1}}]);
  equal(unresolved.counts.triggerCounts.RC16, null);
  equal(unresolved.totals.raw.xp, null);
});
check('node-specific-future-use-and-realm-state', () => {
  const snapshot = {type: 'E', entryStacks: {RC16: 1, RC18: 1},
    exitEligibleOriginalStacks: {RC16: 1, RC18: 1}};
  const route = buildNodeLedger([
    {...snapshot, nodeId: 'before-last-shop'},
    {...snapshot, nodeId: 'after-last-shop', coinFutureUse: false, nextRealm: 'none'},
    {...snapshot, nodeId: 'uncertain-future', coinFutureUse: null, nextRealm: 'unknown'},
  ], {coinFutureUse: true, nextRealm: 'confirmed'});
  equal(route.nodes[0].usable.coin, 2);
  equal(route.nodes[1].usable.coin, 0);
  equal(route.nodes[1].waste.coin, 2);
  equal(route.nodes[1].usable.xp, 0);
  equal(route.nodes[1].waste.xp, 1);
  equal(route.nodes[2].usable.coin, null);
  equal(route.nodes[2].unknown.coin, 2);
  equal(route.nodes[2].usable.xp, null);
  for (const line of route.nodes) for (const key of NRES) {
    equal(line.raw[key], (line.usable[key] ?? 0) + line.waste[key] + line.unknown[key]);
  }
});
check('travel-partial-unknown-and-terminal-conservation', () => {
  const zero = {S: 0, XP: 0, Heal: 0};
  const input = {anchors: {C: 40, X: 100, H: 200}, coinFutureUse: true, nextRealm: 'confirmed',
    raw: {S: 20, XP: 0, Heal: 10}, usable: {S: 10, XP: 0, Heal: null},
    waste: zero, unknown: {S: 10, XP: 0, Heal: 10}};
  const partial = travelUtility(input);
  equal(partial.J, null);
  equal(partial.usable.S, 10);
  near(partial.contributions.S, 0.5);
  equal(partial.contributions.Heal, null);
  const terminal = travelUtility({...input, terminal: true});
  equal(terminal.J, 0);
  for (const key of RES) {
    equal(terminal.usable[key], 0);
    equal(terminal.waste[key], input.raw[key]);
    equal(terminal.unknown[key], 0);
  }
  const unconfirmed = travelUtility({anchors: {X: 100}, nextRealmConfirmed: false,
    raw: {...zero, XP: 10}, usable: {...zero, XP: 10}, waste: zero});
  equal(unconfirmed.J, null);
  equal(unconfirmed.unknown.XP, 10);
});
export function audit() {
  const failed = checks.filter((item) => !item.passed);
  return {total: checks.length, passed: checks.length - failed.length,
    failed: failed.map((item) => ({name: item.name, message: item.error?.message ?? String(item.error)}))};
}
function printAudit(report) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2)); if (report.failed.length) process.exitCode = 1; return;
  }
  console.log('artifact-budget arithmetic audit'); console.log(`checks: ${report.total}`);
  for (const failure of report.failed) console.error(`FAIL ${failure.name}: ${failure.message}`);
  console.log(`PASS ${report.passed}/${report.total}`); if (report.failed.length) process.exitCode = 1;
}
if (import.meta.url === `file://${process.argv[1]}`) printAudit(audit());
