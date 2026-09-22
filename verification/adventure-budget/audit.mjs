import assert from 'node:assert/strict';
import {resolve} from 'node:path'; import {fileURLToPath} from 'node:url';
import {RARITY_BUDGET, nominalOfferBudget} from '../artifact-budget/audit.mjs';
const EPS = 1e-9, TYPES = new Set(['C', 'E', 'K', 'L', 'S', 'R', 'B']);
const CUMULATIVE_XP = [120, 600, 1200, 2040], LOSS = Object.freeze({C: 8, L: 22, B: 32, F: 44});
const XP = Object.freeze({C: [60, 80, 100, 120], L: [100, 120, 150, 180], B: [120, 160, 200, 240]});
const finite = (v) => typeof v === 'number' && Number.isFinite(v), nonneg = (v) => finite(v) && v >= 0;
const integer = Number.isInteger, close = (a, b) => Math.abs(a - b) <= EPS, clone = structuredClone;
const ok = (extra = {}) => ({...SCHEMA, ok: true, ...extra});
const bad = (reason, extra = {}) => ({...SCHEMA, ok: false, value: null, reason, ...extra});
function finish(result, strict) { if (!result.ok && strict) throw new RangeError(result.reason); return result; }
export const SCHEMA = Object.freeze({target: 'adventure-budget-design-target', example_only: true, measured: null});
export const XP_REQUIREMENTS = Object.freeze([120, 480, 600, 840]);
export const ROUTE_PATHS = Object.freeze({
  steady: Object.freeze('C E C R E S C E C L B'.split(' ')),
  elite: Object.freeze('C E C R L E S L E C B'.split(' ')),
  tracking: Object.freeze('C K C E L R C S E C B'.split(' ')),
  saving: Object.freeze('C E C R E L E E C C B'.split(' ')),
  hard: Object.freeze('C E C E S L E E C C B'.split(' ')),
  avoid: Object.freeze('C E C R E S C E C C B'.split(' ')),
});
export const PATHS = ROUTE_PATHS;
export const PATH_COMBAT_B = Object.freeze({steady: 8.8, elite: 10.2, tracking: 8.8, saving: 8.8, hard: 8.8, avoid: 7.4});
export const TERMINAL_NODE = Object.freeze({
  nodeId: 'F', type: 'F', isTerminal: true, loss: 44,
});
function normalizeNode(raw, act, index) {
  const item = typeof raw === 'string' ? {type: raw} : (raw ?? {});
  const type = typeof item.type === 'string' ? item.type.toUpperCase() : '';
  return {...item, type, nodeId: String(item.nodeId ?? item.id ?? `A${act}N${index}`), act, nodeIndex: index};
}
function parseRoute(input) {
  if (input && !Array.isArray(input) && Array.isArray(input.acts)) {
    if (input.acts.some((act) => !Array.isArray(act))) return bad('act_not_array');
    return {acts: input.acts.map((a, i) => a.map((n, j) => normalizeNode(n, i + 1, j + 1))),
      finale: input.finale ? normalizeNode(input.finale, 5, 45) : null};
  }
  const source = Array.isArray(input) ? input : input?.nodes;
  if (!Array.isArray(source)) return bad('route_not_array');
  if (Array.isArray(source[0])) {
    if (source.some((act) => !Array.isArray(act))) return bad('act_not_array');
    return {acts: source.map((a, i) => a.map((n, j) => normalizeNode(n, i + 1, j + 1))), finale: null};
  }
  const acts = []; let current = []; let finale = null;
  for (const raw of source) {
    const node = normalizeNode(raw, acts.length + 1, current.length + 1);
    if (node.type === 'F') { if (finale) return bad('terminal_count_not_one'); finale = node; continue; }
    if (finale) return bad('nodes_after_terminal_F');
    current.push(node); if (node.type === 'B') { acts.push(current); current = []; }
  }
  if (current.length) acts.push(current);
  return {acts, finale};
}
export function validateFinale(node = {}, {strict = false} = {}) {
  const item = normalizeNode(node, 5, 45);
  if (item.type !== 'F') return finish(bad('terminal_type_not_F'), strict);
  const metadata = new Set(['nodeId', 'id', 'type', 'isTerminal', 'loss', 'act', 'nodeIndex', 'globalIndex', 'sourceType']);
  const zeroResources = new Set(['heal', 'rawHeal', 'coins', 'xp', 'common', 'rare']);
  for (const [key, value] of Object.entries(item)) {
    if (metadata.has(key)) continue;
    if (zeroResources.has(key) && value === 0) continue;
    if (['choices', 'offers', 'drops'].includes(key) && Array.isArray(value) && value.length === 0) continue;
    return finish(bad('terminal_extra_reward'), strict);
  }
  return ok({value: item, type: 'F', choices: [], reason: null});
}
function validateAct(act, index) {
  if (!Array.isArray(act) || act.length !== 11) return bad(`act_${index}_length_not_11`);
  const nodes = act.map((n, i) => normalizeNode(n, index, i + 1));
  if (nodes.some((n) => !TYPES.has(n.type))) return bad(`act_${index}_unknown_node_type`);
  if (nodes.at(-1).type !== 'B') return bad(`act_${index}_must_end_B`);
  const counts = Object.fromEntries([...TYPES].map((type) => [type, 0]));
  nodes.forEach((n) => { counts[n.type] += 1; });
  if (counts.B !== 1) return bad(`act_${index}_boss_count_not_one`);
  if (counts.C < 3) return bad(`act_${index}_needs_three_C`);
  if (counts.K > 1) return bad(`act_${index}_K_above_1`);
  if (Math.max(0, counts.L - 1) > 1) return bad(`act_${index}_extra_L_limit`);
  return {ok: true, nodes, counts, extraL: Math.max(0, counts.L - 1)};
}
export function validateRoute(input, {fullRun = false, strict = false} = {}) {
  const parsed = parseRoute(input);
  if (parsed?.ok === false) return finish(parsed, strict);
  const {acts, finale} = parsed;
  if (!acts.length) return finish(bad('route_has_no_act'), strict);
  if (acts.length > 4) return finish(bad('route_above_four_acts'), strict);
  if (fullRun && acts.length !== 4) return finish(bad('full_route_needs_four_acts'), strict);
  if (finale && acts.length !== 4) return finish(bad('terminal_requires_four_acts'), strict);
  const checked = [], ids = new Set();
  for (const [i, act] of acts.entries()) {
    const result = validateAct(act, i + 1);
    if (!result.ok) return finish(result, strict);
    for (const node of result.nodes) {
      if (ids.has(node.nodeId)) return finish(bad(`duplicate_node_id:${node.nodeId}`), strict);
      ids.add(node.nodeId);
    }
    checked.push(result);
  }
  if (finale) {
    if (ids.has(finale.nodeId)) return finish(bad(`duplicate_node_id:${finale.nodeId}`), strict);
    ids.add(finale.nodeId);
    const result = validateFinale(finale);
    if (!result.ok) return finish(result, strict);
  } else if (fullRun) return finish(bad('full_route_needs_terminal_F'), strict);
  if (fullRun || acts.length > 1) {
    const ordinary = checked.reduce((sum, a) => sum + a.counts.C + a.counts.E, 0);
    const k = checked.reduce((sum, a) => sum + a.counts.K, 0), extraL = checked.reduce((sum, a) => sum + a.extraL, 0);
    if (acts.length === 4 && ordinary < 22) return finish(bad('global_C_plus_E_below_22'), strict);
    if (k > 3) return finish(bad('global_K_above_3'), strict);
    if (extraL > 3) return finish(bad('global_extra_L_above_3'), strict);
    const positions = checked.flatMap((a) => a.nodes).flatMap((n, i) => n.type === 'K' ? [i] : []);
    if (positions.some((position, i) => i > 0 && position - positions[i - 1] - 1 < 2)) return finish(bad('K_nodes_need_two_non_K_between'), strict);
  }
  const counts = Object.fromEntries([...TYPES].map((type) => [type, 0]));
  checked.forEach((a) => Object.entries(a.counts).forEach(([type, count]) => { counts[type] += count; }));
  return ok({value: {acts: checked.map((a) => a.nodes), finale}, acts: checked.length, nodeCount: ids.size, counts, reason: null});
}
export const validatePath = validateRoute; export function validateRoutes(paths = [ROUTE_PATHS.steady, ROUTE_PATHS.steady, ROUTE_PATHS.steady, ROUTE_PATHS.steady], options = {}) { if (!Array.isArray(paths)) return bad('paths_not_array'); if (paths.length === 6) return validatePaths(paths); if (paths.length !== 4) return bad('four_act_paths_required'); return validateRoute(paths, {...options, fullRun: false}); }
export function validatePaths(paths = Object.values(ROUTE_PATHS)) {
  if (!Array.isArray(paths)) return bad('paths_not_array'); const results = paths.map((path) => validateRoute(path)); return results.every((result) => result.ok) ? ok({paths: results, reason: null}) : bad('path_invalid', {paths: results});
}
export function makeFullRoute(paths = [ROUTE_PATHS.steady, ROUTE_PATHS.steady, ROUTE_PATHS.steady, ROUTE_PATHS.steady]) { return Array.isArray(paths) && paths.length === 4 ? [...paths.flat(), clone(TERMINAL_NODE)] : null; }
function pathKey(path) {
  if (typeof path === 'string' && Object.hasOwn(ROUTE_PATHS, path)) return path;
  const values = Array.isArray(path) ? path.map((n) => typeof n === 'string' ? n : n?.type) : [];
  return Object.entries(ROUTE_PATHS).find(([, candidate]) => candidate.join(',') === values.join(','))?.[0];
}
export function routeBudget(path, {eventGrantCommon = 0, eventPurchaseCommon = 0} = {}) {
  const name = pathKey(path);
  if (!name) return bad('unknown_route_path');
  if (![eventGrantCommon, eventPurchaseCommon].every((v) => integer(v) && v >= 0)) return bad('event_budget_count_invalid');
  const reference = nominalOfferBudget({acts: 1, commonPerAct: 4, rarePerAct: 2});
  const eventGrantB = eventGrantCommon * RARITY_BUDGET.common;
  const eventPurchaseB = eventPurchaseCommon * RARITY_BUDGET.common;
  const combatB = ROUTE_PATHS[name].reduce((sum, type) => sum
    + (type === 'C' ? RARITY_BUDGET.common : ['L', 'B'].includes(type) ? RARITY_BUDGET.rare : 0), 0);
  const totalB = combatB + eventGrantB + eventPurchaseB;
  return ok({value: totalB, path: name, combatB, eventGrantB, eventPurchaseB, totalB,
    nominalReference: reference.perAct, reason: null});
}
export function bossCombatBudget(acts = 4) {
  if (!integer(acts) || acts < 0) return bad('act_count_invalid');
  const reference = nominalOfferBudget({acts: 1, commonPerAct: 4, rarePerAct: 2});
  const pre = reference.perAct - RARITY_BUDGET.rare, post = reference.perAct;
  const series = (first, later) => Array.from({length: acts}, (_, i) => Number((first + later * i).toFixed(10)));
  return ok({value: {preBoss: series(pre, post), postBoss: series(post, post)}, perAct: {preBoss: pre, postBoss: post}, reason: null});
}
function initialState(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('initial_state_invalid');
  const state = {hp: 200, maxHp: 200, coins: 20, xp: 0, n: 0, common: 0, rare: 0, alive: true, dead: false};
  for (const key of ['hp', 'maxHp', 'coins', 'xp', 'n', 'common', 'rare']) {
    if (Object.hasOwn(input, key)) state[key] = input[key];
  }
  if (['hp', 'maxHp', 'coins', 'xp', 'n', 'common', 'rare'].some((key) => !nonneg(state[key]))) return bad('initial_state_not_non_negative');
  if (state.hp <= 0 || state.maxHp <= 0 || state.hp > state.maxHp
    || !['n', 'common', 'rare'].every((key) => integer(state[key])) || state.n > 4
    || input.alive === false || input.dead === true) return bad('initial_state_invalid');
  if (state.n !== CUMULATIVE_XP.filter((threshold) => state.xp >= threshold).length) return bad('initial_realm_xp_mismatch');
  return {ok: true, state};
}
function snapshot(state) {
  return {hp: state.hp, maxHp: state.maxHp, coins: state.coins, xp: state.xp, n: state.n, common: state.common, rare: state.rare, alive: state.alive, dead: state.dead};
}
export function applyMaxHpChange(current, delta) {
  if (!current || typeof current !== 'object') return bad('state_missing');
  if (!finite(delta)) return bad('max_hp_delta_not_finite');
  if (!finite(current.maxHp) || current.maxHp <= 0 || !nonneg(current.hp) || current.hp > current.maxHp) return bad('state_hp_invalid');
  const maxHp = current.maxHp + delta;
  if (!finite(maxHp) || maxHp <= 0) return bad('max_hp_must_stay_positive');
  const state = {...current, maxHp, hp: Math.min(current.hp, maxHp)};
  return ok({value: state, state, currentUnchangedOnGrowth: delta > 0 ? close(state.hp, current.hp) : null,
    clamped: state.hp !== current.hp, reason: null});
}
export function applyAdventureEvent(current, event = {}) {
  if (!current || typeof current !== 'object' || !finite(current.hp)) return bad('state_missing');
  if (current.hp <= 0 || !finite(current.maxHp) || current.hp > current.maxHp) return bad('state_hp_invalid');
  if (!event || typeof event !== 'object') return bad('event_missing');
  const kind = String(event.kind ?? event.type ?? '').toLowerCase();
  if (kind === 'challenge' || kind === 'nonfatal-challenge') return ok({value: {...current}, state: {...current},
    declaration: clone(event.input ?? event.declaration ?? null), simulated: false, reason: null});
  if (kind === 'skip-rest') return ok({value: {...current}, state: {...current}, skipped: true, simulated: false, reason: null});
  if (kind === 'damage' || kind === 'loss') {
    const amount = Object.hasOwn(event, 'amount') ? event.amount : event.loss;
    if (!finite(amount) || amount < 0) return bad('event_damage_not_finite');
    if (current.hp - amount <= 0) return bad('event_damage_requires_hp_above_zero');
    const state = {...current, hp: current.hp - amount}; return ok({value: state, state, applied: amount, simulated: true, reason: null});
  }
  if (kind === 'max-hp' || kind === 'maxhp') return applyMaxHpChange(current, event.delta);
  if (kind === 'purchase' || kind === 'buy') {
    const cost = event.cost, reward = event.reward === undefined ? {} : event.reward;
    if (!reward || typeof reward !== 'object' || Array.isArray(reward)
      || Object.keys(reward).some((key) => !['common', 'rare'].includes(key))) return bad('purchase_reward_invalid');
    const common = Object.hasOwn(reward, 'common') ? reward.common : 0;
    const rare = Object.hasOwn(reward, 'rare') ? reward.rare : 0;
    if (!nonneg(current.coins) || !['common', 'rare'].every((key) => integer(current[key]) && current[key] >= 0)) return bad('purchase_state_invalid');
    if (!nonneg(cost)) return bad('purchase_cost_not_finite');
    if (current.coins < cost) return bad('insufficient_coins');
    if (![common, rare].every((v) => integer(v) && v >= 0) || common + rare > 1) return bad('purchase_must_grant_one_or_zero_item');
    const state = {...current, coins: current.coins - cost, common: current.common + common, rare: current.rare + rare};
    return ok({value: state, state, paid: cost, reason: null});
  }
  return bad('unknown_event_kind');
}
export function makePostAcquisitionFixture({skipR = false, nodeOverrides = []} = {}) {
  const nodes = [];
  for (let act = 1; act <= 4; act += 1) ROUTE_PATHS.steady.forEach((sourceType, offset) => {
    const nodeIndex = offset + 1, nodeId = `A${act}N${nodeIndex}`, isRest = sourceType === 'R';
    const type = skipR && isRest ? 'E' : sourceType;
    const node = {nodeId, act, nodeIndex, globalIndex: (act - 1) * 11 + nodeIndex, type, sourceType, loss: LOSS[type] ?? 0, xp: 0};
    if (type === 'C') Object.assign(node, {coins: 4, common: 1, xp: XP.C[act - 1]});
    else if (type === 'L') Object.assign(node, {coins: 6, rare: 1, xp: XP.L[act - 1]});
    else if (type === 'B') Object.assign(node, {coins: 10, rare: 1, xp: XP.B[act - 1]});
    else if (type === 'R') node.rawHeal = 50;
    else if (sourceType === 'R' && skipR) Object.assign(node, {rawHeal: 0, replacement: 'no-treatment-E'});
    else if (nodeIndex === 2) Object.assign(node, {choices: ['common', 'coins', 'heal'], choice: 'common', common: 1});
    else if (nodeIndex === 5) Object.assign(node, {choices: ['common', 'coins', 'heal'], choice: 'coins', coins: 20});
    else if (nodeIndex === 8) Object.assign(node, {choices: ['common', 'coins', 'heal'], choice: 'heal', rawHeal: 40});
    if (type === 'S') node.cost = 40;
    nodes.push(node);
  });
  for (const patch of nodeOverrides) {
    const id = String(patch?.nodeId ?? patch?.id); if (id === 'F') continue;
    const index = nodes.findIndex((node) => node.nodeId === id);
    if (index < 0) return {nodes, invalid: bad('node_override_target_missing')}; nodes[index] = {...nodes[index], ...clone(patch)};
  }
  nodes.push({...clone(TERMINAL_NODE), globalIndex: 45});
  for (const patch of nodeOverrides) if (String(patch?.nodeId ?? patch?.id) === 'F') Object.assign(nodes.at(-1), clone(patch));
  return {schema: SCHEMA, nodes, initialState: {hp: 200, maxHp: 200, coins: 20, xp: 0, n: 0, common: 0, rare: 0}};
}
export const makeFixture = makePostAcquisitionFixture; export function skipRestEvents() { return [1, 2, 3, 4].map((act) => ({nodeId: `A${act}N4`, type: 'skip-rest'})); }
function validateLoss(node) {
  if (!Object.hasOwn(node, 'loss')) return bad(`loss_missing:${node.nodeId}`);
  return nonneg(node.loss) ? {ok: true} : bad(`loss_not_finite:${node.nodeId}`);
}
function addHeal(state, raw) {
  if (!nonneg(raw)) return bad('heal_not_finite');
  const effective = Math.min(raw, state.maxHp - state.hp);
  return ok({state: {...state, hp: state.hp + effective}, raw, effective, wasted: raw - effective, reason: null});
}
function addXp(state, amount, node) {
  if (!nonneg(amount)) return bad('xp_not_finite');
  const next = {...state, xp: state.xp + amount}, breakthroughs = [];
  while (next.n < CUMULATIVE_XP.length && next.xp + EPS >= CUMULATIVE_XP[next.n]) {
    next.n += 1; breakthroughs.push({n: next.n, nodeId: node.nodeId, act: node.act,
      nodeIndex: node.nodeIndex, globalIndex: node.globalIndex});
  }
  return {ok: true, state: next, breakthroughs};
}
function validateNodeChoice(node) {
  if (node.type !== 'E') return {ok: true};
  const choices = node.choices === undefined ? [] : node.choices;
  const values = {common: node.common ?? 0, coins: node.coins ?? 0, heal: node.rawHeal ?? 0};
  if (!Array.isArray(choices) || (choices.length > 0
    && (choices.length !== 3 || new Set(choices).size !== 3 || choices.some((v) => !['common', 'coins', 'heal'].includes(v))))) return bad('event_choice_candidates_not_three');
  if (['xp', 'rare', 'cost'].some((key) => Object.hasOwn(node, key) && node[key] !== 0)) return bad('event_reward_outside_fixture');
  if (Array.isArray(node.choice)) return bad('one_choice_cannot_grant_all_branches');
  const positive = Object.values(values).filter((v) => v !== 0).length;
  if (positive && node.choice == null) return bad('event_choice_missing');
  if (node.choice != null && !['common', 'coins', 'heal', 'none'].includes(node.choice)) return bad('event_choice_invalid');
  if (node.choice != null && node.choice !== 'none' && !choices.includes(node.choice)) return bad('event_choice_not_offered');
  if (node.choice === 'common' && (values.coins !== 0 || values.heal !== 0)) return bad('event_choice_grants_multiple');
  if (node.choice === 'coins' && (values.common !== 0 || values.heal !== 0)) return bad('event_choice_grants_multiple');
  if (node.choice === 'heal' && (values.common !== 0 || values.coins !== 0)) return bad('event_choice_grants_multiple');
  if (node.choice === 'none' && positive) return bad('event_choice_grants_multiple');
  return {ok: true};
}
function settleNode(state, node) {
  const choice = validateNodeChoice(node);
  if (!choice.ok) return choice;
  const next = {...state}, earned = {coins: 0, common: 0, rare: 0, rawHeal: 0, xp: 0};
  if (node.type === 'F') {
    const terminal = validateFinale(node);
    return terminal.ok ? ok({state: next, earned, breakthroughs: [], reason: null}) : terminal;
  }
  for (const key of ['coins', 'common', 'rare']) if (Object.hasOwn(node, key) && (!integer(node[key]) || node[key] < 0)) return bad(`${key}_reward_invalid`);
  if (node.type === 'S') {
    if (node.cost !== 40) return bad('shop_cost_must_be_40'); if (next.coins < node.cost) return bad('insufficient_coins');
    next.coins -= node.cost; earned.coins = -node.cost; next.common += 1; earned.common = 1;
  } else {
    for (const key of ['coins', 'common', 'rare']) { const value = node[key] ?? 0; next[key] += value; earned[key] += value; }
    const rawHeal = node.rawHeal ?? 0;
    if (!nonneg(rawHeal)) return bad('heal_not_finite');
    if (rawHeal > 0) {
      const healed = addHeal(next, rawHeal); if (!healed.ok) return healed;
      next.hp = healed.state.hp; Object.assign(earned, {rawHeal, effectiveHeal: healed.effective, wastedHeal: healed.wasted});
    }
  }
  const xp = ['C', 'L', 'B'].includes(node.type) ? node.xp : (node.xp ?? 0);
  const leveled = addXp(next, xp, node);
  return leveled.ok ? ok({state: leveled.state, earned: {...earned, xp}, breakthroughs: leveled.breakthroughs, reason: null}) : leveled;
}
function eventMap(events, nodes) {
  if (events == null) return {ok: true, map: new Map()};
  if (!Array.isArray(events)) return bad('events_not_array');
  const ids = new Set(nodes.map((node) => node.nodeId)), map = new Map();
  for (const event of events) {
    const id = String(event?.nodeId ?? event?.id ?? event?.at ?? '');
    if (!id || !ids.has(id)) return bad(`event_node_missing:${id}`);
    if (nodes.find((node) => node.nodeId === id)?.type === 'F') return bad('terminal_event_forbidden');
    if (['purchase', 'buy'].includes(String(event.kind ?? event.type).toLowerCase())) return bad('inline_purchase_not_supported');
    if (!map.has(id)) map.set(id, []); map.get(id).push(event);
  }
  return {ok: true, map};
}
export function settleAdventure({fixture = makePostAcquisitionFixture(), events, strict = false} = {}) {
  if (fixture?.invalid) return finish(fixture.invalid, strict);
  const inputNodes = fixture?.nodes ?? fixture;
  if (!Array.isArray(inputNodes)) return finish(bad('fixture_nodes_not_array'), strict);
  const route = validateRoute(inputNodes, {fullRun: true});
  if (!route.ok) return finish(route, strict);
  const ids = new Set();
  for (const node of inputNodes) {
    const id = String(node?.nodeId ?? node?.id ?? '');
    if (!id) return finish(bad('node_id_missing'), strict);
    if (ids.has(id)) return finish(bad(`duplicate_node_id:${id}`), strict);
    ids.add(id);
    const lossResult = validateLoss(node), choice = validateNodeChoice(node);
    if (!lossResult.ok) return finish(lossResult, strict);
    if (!choice.ok) return finish(choice, strict);
    for (const key of ['coins', 'common', 'rare', 'rawHeal', 'xp']) {
      if (Object.hasOwn(node, key) && !nonneg(node[key])) return finish(bad(`${key}_reward_invalid`), strict);
    }
    for (const key of ['coins', 'common', 'rare']) {
      if (Object.hasOwn(node, key) && !integer(node[key])) return finish(bad(`${key}_reward_invalid`), strict);
    }
    if (node.type === 'S' && ['coins', 'common', 'rare', 'rawHeal', 'xp'].some((key) => Object.hasOwn(node, key) && node[key] !== 0)) {
      return finish(bad('shop_reward_outside_fixture'), strict);
    }
    if (['C', 'L', 'B'].includes(node.type) && !nonneg(node.xp)) return finish(bad('xp_reward_invalid'), strict);
  }
  const nodes = [...route.value.acts.flat(), route.value.finale]
    .map((node, index) => ({...node, globalIndex: index + 1}));
  const mapped = eventMap(events === undefined ? fixture.events : events, nodes);
  const base = initialState(Object.hasOwn(fixture, 'initialState') ? fixture.initialState : {});
  if (!mapped.ok) return finish(mapped, strict);
  if (!base.ok) return finish(base, strict);
  let state = base.state;
  const lines = [], actEndHp = [], xpByAct = [0, 0, 0, 0], coinsByAct = [], breakthroughs = [];
  const heal = {raw: 0, effective: 0, wasted: 0};
  let externalLoss = 0, requestedExternalLoss = 0, eventDamage = 0, hpCapLoss = 0;
  let stoppedAt = null, terminalReached = false;
  for (const node of nodes) {
    if (!state.alive) break;
    if (!['C', 'E', 'K', 'L', 'S', 'R', 'B', 'F'].includes(node.type)) return finish(bad('unknown_node_type'), strict);
    const lossResult = validateLoss(node), choice = validateNodeChoice(node);
    if (!lossResult.ok) return finish(lossResult, strict);
    if (!choice.ok) return finish(choice, strict);
    const before = snapshot(state), eventRecords = [];
    let skipRest = false;
    for (const event of mapped.map.get(node.nodeId) ?? []) {
      const applied = applyAdventureEvent(state, event);
      if (!applied.ok) return finish({...applied, nodeId: node.nodeId}, strict);
      const capLoss = applied.clamped ? state.hp - applied.state.hp : 0;
      eventDamage += applied.applied ?? 0; hpCapLoss += capLoss;
      state = applied.state; skipRest ||= applied.skipped === true;
      eventRecords.push({kind: event.kind ?? event.type, simulated: applied.simulated ?? false,
        declaration: applied.declaration ?? null, amount: applied.applied ?? null, hpCapLoss: capLoss});
    }
    const afterEvent = snapshot(state), loss = node.loss, actualHpLost = Math.min(state.hp, loss);
    state = {...state, hp: state.hp - loss}; externalLoss += actualHpLost; requestedExternalLoss += loss;
    const survived = state.hp > 0, after = snapshot(state);
    const line = {nodeId: node.nodeId, type: node.type, act: node.act, nodeIndex: node.nodeIndex,
      globalIndex: node.globalIndex, lossSource: 'external_input', loss, actualHpLost, eventRecords, before, afterEvent, after,
      settled: null, rewardApplied: false, alive: survived};
    if (!survived) {
      state = {...state, hp: Math.max(0, state.hp), alive: false, dead: true};
      line.after = snapshot(state); line.settled = snapshot(state); lines.push(line);
      if (node.type === 'B') { actEndHp[node.act - 1] = state.hp; coinsByAct[node.act - 1] = state.coins; }
      stoppedAt = node.nodeId; break;
    }
    const effectiveNode = skipRest && node.type === 'R'
      ? {...node, type: 'E', rawHeal: 0, choice: 'none', common: 0, coins: 0, rare: 0,
        choices: ['common', 'coins', 'heal']} : node;
    const settled = settleNode(state, effectiveNode);
    if (!settled.ok) return finish({...settled, nodeId: node.nodeId}, strict);
    state = {...settled.state, alive: true, dead: false};
    line.type = effectiveNode.type; line.settled = snapshot(state); line.rewardApplied = true;
    line.earned = settled.earned; line.breakthroughs = settled.breakthroughs;
    breakthroughs.push(...settled.breakthroughs);
    if (effectiveNode.type !== 'F') xpByAct[node.act - 1] += settled.earned.xp;
    heal.raw += settled.earned.rawHeal ?? 0; heal.effective += settled.earned.effectiveHeal ?? 0;
    heal.wasted += settled.earned.wastedHeal ?? 0; lines.push(line);
    if (effectiveNode.type === 'B') { actEndHp[node.act - 1] = state.hp; coinsByAct[node.act - 1] = state.coins; }
    if (effectiveNode.type === 'F') { terminalReached = true; stoppedAt = node.nodeId; break; }
  }
  const totalThreshold = XP_REQUIREMENTS.reduce((sum, value) => sum + value, 0);
  const cumulativeXp = xpByAct.reduce((all, value) => { all.push((all.at(-1) ?? 0) + value); return all; }, []);
  const sumEarned = (types, key) => lines.filter((line) => types.includes(line.type))
    .reduce((sum, line) => sum + (line.earned?.[key] ?? 0), 0);
  const combatCommon = sumEarned(['C', 'L', 'B'], 'common');
  const eventGrantCommon = sumEarned(['E', 'K', 'R'], 'common');
  const eventPurchaseCommon = sumEarned(['S'], 'common');
  const combatB = combatCommon * RARITY_BUDGET.common + sumEarned(['C', 'L', 'B'], 'rare') * RARITY_BUDGET.rare;
  const plannedCombatB = nodes.filter((node) => ['C', 'L', 'B'].includes(node.type))
    .reduce((sum, node) => sum + (node.common ?? 0) * RARITY_BUDGET.common + (node.rare ?? 0) * RARITY_BUDGET.rare, 0);
  const initialB = base.state.common * RARITY_BUDGET.common + base.state.rare * RARITY_BUDGET.rare;
  const summary = ok({
    finalHp: state.hp, finalCoins: state.coins, finalXp: state.xp, finalN: state.n, actEndHp, coinsByAct,
    xpByAct, cumulativeXp, plannedExternalLoss: nodes.reduce((sum, n) => sum + n.loss, 0),
    externalLoss, requestedExternalLoss, eventDamage, hpCapLoss,
    rawHeal: heal.raw, effectiveHeal: heal.effective, wastedHeal: heal.wasted, breakthroughs,
    breakthroughGlobalIndexes: breakthroughs.map((item) => item.globalIndex), xpThresholds: [...CUMULATIVE_XP],
    xpOverflow: Math.max(0, state.xp - totalThreshold), usableXp: terminalReached || state.n === 4 ? 0 : null,
    nextRealm: terminalReached || state.n === 4 ? 'none' : 'unknown', common: state.common,
    commonBreakdown: {initial: base.state.common, combat: combatCommon, eventGrant: eventGrantCommon, eventPurchase: eventPurchaseCommon},
    rare: state.rare, combatB, plannedCombatB, initialB,
    eventGrantB: eventGrantCommon * RARITY_BUDGET.common + sumEarned(['E', 'K', 'R'], 'rare') * RARITY_BUDGET.rare,
    eventPurchaseB: eventPurchaseCommon * RARITY_BUDGET.common + sumEarned(['S'], 'rare') * RARITY_BUDGET.rare,
    totalAcquiredB: state.common * RARITY_BUDGET.common + state.rare * RARITY_BUDGET.rare - initialB,
    finalCoinLedger: terminalReached ? {raw: state.coins, usable: 0, reason: 'no_future_shop'} : null,
    stoppedAt, terminalReached, reason: null});
  return ok({value: summary, state: snapshot(state), nodes: lines, summary, expectedSchema: SCHEMA, reason: null});
}
export const runPostAcquisition = settleAdventure;
const checks = [];
function check(name, fn) { try { fn(); checks.push({name, passed: true}); } catch (error) { checks.push({name, passed: false, error}); }}
function near(a, b) { assert.ok(close(a, b), `${a} !== ${b}`); }
check('route-shapes-and-global-rules', () => {
  for (const path of Object.values(ROUTE_PATHS)) assert.equal(validateRoute(path).ok, true);
  const full = validateRoute(makeFullRoute(), {fullRun: true}); assert.equal(full.ok, true); assert.equal(full.value.finale.type, 'F');
  assert.deepEqual(Object.values(PATH_COMBAT_B), [8.8, 10.2, 8.8, 8.8, 8.8, 7.4]);
});
check('route-negative-cases-and-no-terminal-offer', () => {
  assert.equal(validateRoute([...ROUTE_PATHS.steady.slice(0, -1), 'L']).reason, 'act_1_must_end_B');
  const duplicate = makeFullRoute().map((node, i) => typeof node === 'string' ? {type: node, nodeId: `N${i}`} : ({...node, nodeId: i === 44 ? 'F' : node.nodeId}));
  duplicate[1].nodeId = 'dup'; duplicate[2].nodeId = 'dup'; assert.match(validateRoute(duplicate, {fullRun: true}).reason, /duplicate_node_id/);
  assert.deepEqual(validateFinale(TERMINAL_NODE).choices, []);
  assert.equal(validateFinale({...TERMINAL_NODE, choices: [{items: [{id: 'free'}]}]}).reason, 'terminal_extra_reward');
  assert.equal(validateRoute([...makeFullRoute(), {type: 'E', nodeId: 'after-F'}]).reason, 'nodes_after_terminal_F');
  assert.equal(validateRoutes(Array.from({length: 4}, () => ROUTE_PATHS.tracking)).reason, 'global_K_above_3');
  assert.equal(validateRoute(['C', 'K', 'C', 'K', 'C', 'E', 'C', 'E', 'C', 'L', 'B']).reason, 'act_1_K_above_1');
});
check('budget-reuses-artifact-anchors', () => {
  assert.equal(RARITY_BUDGET.common, 1); assert.equal(RARITY_BUDGET.rare, 2.4); near(nominalOfferBudget().perAct, 8.8);
  near(routeBudget('steady').combatB, 8.8); near(routeBudget('steady', {eventGrantCommon: 1, eventPurchaseCommon: 1}).totalB, 10.8);
  assert.deepEqual(bossCombatBudget().value.preBoss, [6.4, 15.2, 24, 32.8]); assert.deepEqual(bossCombatBudget().value.postBoss, [8.8, 17.6, 26.4, 35.2]);
  for (const [name, expected] of Object.entries(PATH_COMBAT_B)) near(routeBudget(name).combatB, expected);
});
check('baseline-post-acquisition-ledger', () => {
  const result = settleAdventure(); assert.equal(result.ok, true); assert.deepEqual(result.summary.actEndHp, [138, 138, 138, 138]);
  assert.equal(result.summary.finalHp, 94); assert.equal(result.summary.externalLoss, 388);
  assert.deepEqual([result.summary.rawHeal, result.summary.effectiveHeal, result.summary.wastedHeal], [360, 282, 78]);
  assert.deepEqual(result.summary.xpByAct, [460, 600, 750, 900]); assert.deepEqual(result.summary.cumulativeXp, [460, 1060, 1810, 2710]);
  assert.deepEqual(result.summary.breakthroughGlobalIndexes, [3, 14, 25, 36]); assert.equal(result.summary.xpOverflow, 670);
  assert.deepEqual(result.summary.coinsByAct, [32, 44, 56, 68]); assert.equal(result.summary.common, 24); assert.equal(result.summary.rare, 8);
  assert.equal(result.summary.totalAcquiredB, 43.2); assert.equal(result.summary.finalCoinLedger.usable, 0);
  near(result.summary.combatB, 35.2); near(result.summary.plannedCombatB, 35.2);
});
check('reward-order-and-single-event-branch', () => {
  const result = settleAdventure(), first = result.nodes[0], e2 = result.nodes[1];
  assert.equal(first.before.common, 0); assert.equal(first.after.common, 0); assert.equal(first.before.coins, 20); assert.equal(first.after.coins, 20);
  assert.equal(first.settled.common, 1); assert.equal(first.settled.coins, 24); assert.equal(e2.settled.common, 2);
  assert.equal(result.nodes[4].settled.coins, 48); assert.equal(result.nodes[7].earned.rawHeal, 40); assert.equal(result.nodes[9].earned.rare, 1); assert.equal(result.nodes[10].earned.rare, 1);
});
check('skip-rest-death-stops-boss-and-finale', () => {
  const result = settleAdventure({events: skipRestEvents()});
  assert.equal(result.ok, true); assert.deepEqual(result.summary.actEndHp, [138, 92, 46, 0]); assert.equal(result.nodes.length, 44);
  assert.equal(result.summary.stoppedAt, 'A4N11'); assert.equal(result.summary.terminalReached, false); assert.equal(result.nodes.at(-1).rewardApplied, false); assert.equal(result.summary.rare, 7);
  near(result.summary.combatB, 32.8); near(result.summary.plannedCombatB, 35.2);
  near(result.summary.totalAcquiredB, 40.8); assert.equal(result.summary.usableXp, 0);
  assert.equal(result.summary.nextRealm, 'none');
});
check('explicit-events-and-max-hp-boundary', () => {
  const challenged = settleAdventure({events: [{nodeId: 'A1N4', type: 'challenge', input: {difficulty: 3}}]});
  assert.equal(challenged.ok, true); assert.equal(challenged.nodes[3].eventRecords[0].simulated, false);
  const damaged = settleAdventure({events: [{nodeId: 'A1N4', type: 'damage', amount: 10}]});
  assert.equal(damaged.ok, true); assert.equal(damaged.nodes[3].before.hp, 184); assert.equal(applyMaxHpChange({hp: 100, maxHp: 200}, 50).state.hp, 100);
  assert.deepEqual([applyMaxHpChange({hp: 180, maxHp: 200}, -100).state.hp, applyMaxHpChange({hp: 180, maxHp: 200}, -100).state.maxHp], [100, 100]);
  assert.equal(applyAdventureEvent({hp: 20, maxHp: 200}, {type: 'damage', amount: 20}).reason, 'event_damage_requires_hp_above_zero');
});
check('negative-ledger-inputs-are-not-defaulted', () => {
  assert.equal(settleAdventure({fixture: makePostAcquisitionFixture({nodeOverrides: [{nodeId: 'A1N1', loss: null}]})}).reason, 'loss_not_finite:A1N1');
  assert.equal(settleAdventure({fixture: makePostAcquisitionFixture({nodeOverrides: [{nodeId: 'A1N1', loss: '8'}]})}).reason, 'loss_not_finite:A1N1');
  assert.equal(applyAdventureEvent({hp: 100, maxHp: 200, coins: 20, common: 0, rare: 0}, {type: 'purchase', cost: 999}).reason, 'insufficient_coins');
  const terminalExtra = makePostAcquisitionFixture({nodeOverrides: [{nodeId: 'F', heal: 1}]});
  assert.equal(settleAdventure({fixture: terminalExtra}).reason, 'terminal_extra_reward');
  const duplicate = makePostAcquisitionFixture(); duplicate.nodes[1].nodeId = duplicate.nodes[0].nodeId;
  assert.match(settleAdventure({fixture: duplicate}).reason, /duplicate_node_id/);
  const allBranches = makePostAcquisitionFixture({nodeOverrides: [{nodeId: 'A1N2', coins: 2}]});
  assert.equal(settleAdventure({fixture: allBranches}).reason, 'event_choice_grants_multiple');
});
check('partial-routes-and-malformed-acts', () => {
  assert.equal(validateRoute({acts: [null]}).reason, 'act_not_array');
  assert.equal(validateRoute([ROUTE_PATHS.steady, null]).reason, 'act_not_array');
  assert.equal(validateRoute([ROUTE_PATHS.steady, ROUTE_PATHS.steady]).ok, true);
  const twoBosses = [...ROUTE_PATHS.steady]; twoBosses[1] = 'B';
  assert.equal(validateRoute({acts: [twoBosses]}).reason, 'act_1_boss_count_not_one');
  assert.equal(validateRoute([...ROUTE_PATHS.steady, TERMINAL_NODE]).reason, 'terminal_requires_four_acts');
});
check('terminal-rejects-rewards-and-preparation', () => {
  for (const patch of [{choices: ['a', 'b', 'c']}, {offers: ['a']}, {rawHeal: 1}, {xp: 1}, {common: 1},
    {rare: 1}, {coins: 1}, {shop: true}, {preparation: 'shield'}, {reward: {common: 1}}, {rawHeal: null}]) {
    assert.equal(validateFinale({...TERMINAL_NODE, ...patch}).reason, 'terminal_extra_reward');
    assert.equal(settleAdventure({fixture: makeFixture({nodeOverrides: [{nodeId: 'F', ...patch}]})}).ok, false);
  }
  for (const event of [{type: 'purchase', cost: 0, reward: {common: 1}}, {type: 'max-hp', delta: 50},
    {type: 'skip-rest'}, {type: 'challenge'}]) {
    assert.equal(settleAdventure({events: [{nodeId: 'F', ...event}]}).reason, 'terminal_event_forbidden');
  }
});
check('invalid-initial-values-and-max-hp-are-rejected', () => {
  for (const key of ['hp', 'maxHp', 'coins', 'xp', 'n', 'common', 'rare']) {
    const fixture = makeFixture(); fixture.initialState[key] = null;
    assert.equal(settleAdventure({fixture}).ok, false);
  }
  for (const patch of [{hp: 0}, {n: 5}, {common: 1.5}, {n: 1, xp: 0}, {dead: true}]) {
    const fixture = makeFixture(); Object.assign(fixture.initialState, patch);
    assert.equal(settleAdventure({fixture}).ok, false);
  }
  const fixture = makeFixture(); fixture.initialState = null;
  assert.equal(settleAdventure({fixture}).reason, 'initial_state_invalid');
  assert.equal(applyMaxHpChange({hp: 10, maxHp: 200}, -200).reason, 'max_hp_must_stay_positive');
  assert.equal(applyMaxHpChange({hp: 10, maxHp: 200}, -250).ok, false);
});
check('event-branch-and-purchase-boundaries', () => {
  for (const patch of [{xp: 10}, {rare: 1}, {cost: 1}, {rawHeal: null}, {common: null}, {choices: ['coins', 'coins', 'heal']}]) {
    assert.equal(settleAdventure({fixture: makeFixture({nodeOverrides: [{nodeId: 'A1N2', ...patch}]})}).ok, false);
  }
  assert.equal(settleAdventure({events: [{nodeId: 'A1N2', type: 'purchase', cost: 0, reward: {common: 1}}]}).reason, 'inline_purchase_not_supported');
  assert.equal(applyAdventureEvent({hp: 20, maxHp: 200}, {type: 'purchase', cost: 0}).reason, 'purchase_state_invalid');
  const bought = applyAdventureEvent({hp: 20, maxHp: 200, coins: 40, common: 0, rare: 0},
    {type: 'purchase', cost: 40, reward: {common: 1}});
  assert.equal(bought.ok, true); assert.equal(bought.state.coins, 0); assert.equal(bought.state.common, 1);
});
check('actual-acquisitions-loss-and-unknown-inputs', () => {
  const earlyDeath = settleAdventure({fixture: makeFixture({nodeOverrides: [{nodeId: 'A1N1', loss: 250}]})});
  assert.equal(earlyDeath.ok, true); assert.equal(earlyDeath.summary.externalLoss, 200);
  assert.equal(earlyDeath.summary.requestedExternalLoss, 250);
  assert.equal(earlyDeath.summary.combatB, 0); assert.equal(earlyDeath.summary.totalAcquiredB, 0);
  const missing = makeFixture(); delete missing.nodes[43].loss;
  assert.equal(settleAdventure({fixture: missing}).reason, 'loss_missing:A4N11');
  const doubled = settleAdventure({fixture: makeFixture({nodeOverrides: [{nodeId: 'A1N2', common: 2}]})});
  assert.equal(doubled.summary.commonBreakdown.eventGrant, 5); near(doubled.summary.totalAcquiredB, 44.2);
  const owned = makeFixture(); owned.initialState.common = 2;
  const result = settleAdventure({fixture: owned});
  assert.equal(result.summary.initialB, 2); assert.equal(result.summary.commonBreakdown.initial, 2);
  near(result.summary.totalAcquiredB, 43.2);
});
check('event-loss-ledger-and-complete-xp-summaries', () => {
  const result = settleAdventure({events: [
    {nodeId: 'A1N4', type: 'damage', amount: 10},
    {nodeId: 'A2N2', type: 'max-hp', delta: -80},
  ]});
  assert.equal(result.ok, true); assert.equal(result.summary.eventDamage, 10);
  assert.equal(result.summary.hpCapLoss, 10);
  assert.equal(200 - result.summary.externalLoss - result.summary.eventDamage - result.summary.hpCapLoss
    + result.summary.effectiveHeal, result.summary.finalHp);
  const core = settleAdventure({fixture: makeFixture({nodeOverrides: [
    {nodeId: 'A1N2', type: 'K', xp: 10},
  ]})});
  assert.equal(core.ok, true); assert.equal(core.summary.xpByAct[0], 470);
  assert.equal(core.summary.cumulativeXp.at(-1), core.summary.finalXp);
  assert.equal(settleAdventure({fixture: makeFixture({nodeOverrides: [
    {nodeId: 'A1N6', rare: 1},
  ]})}).reason, 'shop_reward_outside_fixture');
  assert.equal(settleAdventure({fixture: makeFixture({nodeOverrides: [
    {nodeId: 'A4N11', rare: 1.5},
  ]})}).reason, 'rare_reward_invalid');
});
export function audit() {
  const failed = checks.filter((item) => !item.passed);
  const baseline = settleAdventure();
  const summary = baseline.ok ? {finalHp: baseline.summary.finalHp, externalLoss: baseline.summary.externalLoss,
    effectiveHeal: baseline.summary.effectiveHeal, wastedHeal: baseline.summary.wastedHeal, xpOverflow: baseline.summary.xpOverflow,
    totalAcquiredB: baseline.summary.totalAcquiredB} : {error: baseline.reason};
  return {...SCHEMA, module: 'adventure-budget', total: checks.length, passed: checks.length - failed.length,
    failed: failed.map((item) => ({name: item.name, message: item.error?.message ?? String(item.error)})), summary};
}
function printAudit(report) {
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('adventure-budget arithmetic audit', `checks: ${report.total}`);
    for (const failure of report.failed) console.error(`FAIL ${failure.name}: ${failure.message}`);
    console.log(`PASS ${report.passed}/${report.total}`);
    console.log(`core: hp=${report.summary.finalHp} loss=${report.summary.externalLoss} heal=${report.summary.effectiveHeal}/${report.summary.wastedHeal} xpOverflow=${report.summary.xpOverflow} B=${report.summary.totalAcquiredB}`);
  }
  if (report.failed.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) printAudit(audit());
