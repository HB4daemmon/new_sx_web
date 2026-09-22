import type { Content, RunState, Stats } from './types.js';
import {
  ShanhaiGame,
  validateBattleResult,
  validateRunState,
  simulateBattle,
} from './run.js';

export const SHANHAI_SAVE_KEY = 'suishi-shanhai-run-v1';
export const SHANHAI_BUILD_KEY = 'suishi-shanhai-build-v1';
export const SAVE_KEY = SHANHAI_SAVE_KEY;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ShanhaiSaveRecord {
  schema: 1;
  key: typeof SHANHAI_SAVE_KEY;
  contentVersion: string;
  savedAt: string;
  state: RunState;
  replay?: 'deterministic-input-v1';
}

export interface ShanhaiBuildRecord {
  schema: 1;
  buildId: string;
  runId: string;
  contentVersion: string;
  savedAt: string;
  name: string;
  method: string;
  n: number;
  talents: string[];
  artifacts: RunState['artifacts'];
  stats: Stats;
}

function storageOrDefault(storage?: StorageLike): StorageLike {
  if (storage) return storage;
  const candidate = (globalThis as Record<string, unknown>).localStorage;
  if (!candidate || typeof (candidate as StorageLike).getItem !== 'function') {
    throw new Error('localStorage is unavailable; provide a storage adapter');
  }
  return candidate as StorageLike;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const RUN_PHASES = new Set([
  'route',
  'map',
  'preview',
  'battle',
  'reward',
  'event',
  'event_result',
  'shop',
  'rest',
  'talent',
  'transition',
  'won',
  'lost',
]);
const NODE_TYPES = new Set(['C', 'E', 'K', 'L', 'S', 'R', 'B', 'F']);
const SHOP_KINDS = new Set(['artifact', 'recovery', 'preparation']);

function allFiniteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFiniteNumbers);
  if (isObject(value)) return Object.values(value).every(allFiniteNumbers);
  return true;
}

function nonNegative(value: unknown): boolean {
  return finite(value) && value >= 0;
}

function assertLoadoutShapeWithoutContent(loadout: unknown): void {
  if (!isObject(loadout) || typeof loadout.name !== 'string' || typeof loadout.method !== 'string' ||
    !Number.isInteger(loadout.n) || loadout.n < 0 || loadout.n > 4 ||
    !Array.isArray(loadout.talents) || loadout.talents.some(id => typeof id !== 'string') ||
    !Array.isArray(loadout.artifacts)) {
    throw new Error('Invalid saved loadout');
  }
  if (loadout.hp !== undefined && !nonNegative(loadout.hp)) throw new Error('Invalid saved loadout HP');
  if (loadout.preparation !== undefined && !nonNegative(loadout.preparation)) {
    throw new Error('Invalid saved loadout preparation');
  }
  if (loadout.firstStrike !== undefined && !nonNegative(loadout.firstStrike)) {
    throw new Error('Invalid saved loadout first strike');
  }
  const talentIds = new Set(loadout.talents);
  if (talentIds.size !== loadout.talents.length) throw new Error('Duplicate saved talent');
  const artifactIds = new Set<string>();
  for (const stack of loadout.artifacts) {
    if (!isObject(stack) || typeof stack.id !== 'string' || !Number.isInteger(stack.stacks) ||
      stack.stacks <= 0 || artifactIds.has(stack.id)) {
      throw new Error('Invalid saved loadout artifact');
    }
    artifactIds.add(stack.id);
  }
  if (loadout.baseStats !== undefined &&
    (!isObject(loadout.baseStats) ||
      !['attack', 'defense', 'max_hp', 'crit_rate', 'speed'].every(key => finite(loadout.baseStats[key])) ||
      loadout.baseStats.max_hp < 0)) {
    throw new Error('Invalid saved loadout stats');
  }
}

function assertStateShapeWithoutContent(state: RunState): void {
  if (!isObject(state) || state.schema !== 1 || typeof state.contentVersion !== 'string' ||
    !state.contentVersion || typeof state.id !== 'string' || !state.id ||
    typeof state.seed !== 'string' || typeof state.name !== 'string' ||
    !RUN_PHASES.has(state.phase)) {
    throw new Error('Invalid Shanhai run state');
  }
  if (!Number.isInteger(state.act) || state.act < 1 || state.act > 5 ||
    !Number.isInteger(state.step) || state.step < 0) {
    throw new Error('Invalid Shanhai run position');
  }
  if (!Number.isInteger(state.n) || state.n < 0 || state.n > 4) {
    throw new Error('Invalid Shanhai realm');
  }
  if (typeof state.method !== 'string' || !Array.isArray(state.ownedMethods) ||
    state.ownedMethods.some(id => typeof id !== 'string') ||
    new Set(state.ownedMethods).size !== state.ownedMethods.length ||
    !state.ownedMethods.includes(state.method)) {
    throw new Error('Invalid Shanhai methods');
  }
  if (!isObject(state.talents)) throw new Error('Invalid Shanhai talents');
  for (const [method, talents] of Object.entries(state.talents)) {
    if (!state.ownedMethods.includes(method) || !Array.isArray(talents) ||
      talents.some(id => typeof id !== 'string') || new Set(talents).size !== talents.length) {
      throw new Error('Invalid Shanhai talents');
    }
  }
  if (![state.hp, state.xp, state.coins, state.preparation].every(nonNegative) ||
    (state.firstStrike !== undefined && !nonNegative(state.firstStrike))) {
    throw new Error('Invalid Shanhai run resources');
  }
  if (!Array.isArray(state.nodes) || state.nodes.some(node =>
    !isObject(node) || !NODE_TYPES.has(node.type) || typeof node.id !== 'string' ||
    typeof node.completed !== 'boolean')) {
    throw new Error('Invalid Shanhai nodes');
  }
  if (!Array.isArray(state.routes) || state.routes.some(route => typeof route !== 'string')) {
    throw new Error('Invalid Shanhai routes');
  }
  if (!Array.isArray(state.artifacts)) throw new Error('Invalid Shanhai artifacts');
  const artifactIds = new Set<string>();
  for (const stack of state.artifacts) {
    if (!isObject(stack) || typeof stack.id !== 'string' || !Number.isInteger(stack.stacks) ||
      stack.stacks <= 0 || artifactIds.has(stack.id)) {
      throw new Error('Invalid Shanhai artifact stack');
    }
    artifactIds.add(stack.id);
  }
  if (!Array.isArray(state.history) || state.history.some(entry =>
    !isObject(entry) || !Number.isInteger(entry.act) || entry.act < 1 || entry.act > 5 ||
    !Number.isInteger(entry.step) || entry.step < 0 ||
    typeof entry.title !== 'string' || typeof entry.text !== 'string')) {
    throw new Error('Invalid Shanhai history');
  }
  if (!isObject(state.flags) || Object.values(state.flags).some(value => typeof value !== 'boolean') ||
    !Array.isArray(state.seenEvents) || state.seenEvents.some(id => typeof id !== 'string') ||
    !Array.isArray(state.completedCore) || state.completedCore.some(id => typeof id !== 'string') ||
    !Array.isArray(state.rewardCandidates) || state.rewardCandidates.some(id => typeof id !== 'string')) {
    throw new Error('Invalid Shanhai event collections');
  }
  if (!Number.isInteger(state.extraElites) || state.extraElites < 0 ||
    !Number.isInteger(state.ordinaryCount) || state.ordinaryCount < 0) {
    throw new Error('Invalid Shanhai counters');
  }
  if (!Array.isArray(state.shop) || state.shop.some(item =>
    !isObject(item) || typeof item.id !== 'string' || !SHOP_KINDS.has(item.kind) ||
    !finite(item.price) || item.price < 0 || typeof item.sold !== 'boolean')) {
    throw new Error('Invalid Shanhai shop');
  }
  if (state.returnPhase !== undefined && !RUN_PHASES.has(state.returnPhase)) {
    throw new Error('Invalid Shanhai return phase');
  }
  const assertNodeEntry = (entry: unknown): void => {
    if (!isObject(entry) || typeof entry.method !== 'string' ||
      !Array.isArray(entry.talents) || !Array.isArray(entry.artifacts)) {
      throw new Error('Invalid Shanhai node entry');
    }
    assertLoadoutShapeWithoutContent({
      name: state.name,
      method: entry.method,
      n: state.n,
      talents: entry.talents,
      artifacts: entry.artifacts,
      hp: state.hp,
      preparation: state.preparation,
    });
  };
  if ((state.nodeEntry === undefined) !== (state._nodeEntry === undefined)) {
    throw new Error('Invalid Shanhai node entry');
  }
  if (state.nodeEntry !== undefined) {
    assertNodeEntry(state.nodeEntry);
    assertNodeEntry(state._nodeEntry);
    if (JSON.stringify(state.nodeEntry) !== JSON.stringify(state._nodeEntry)) {
      throw new Error('Invalid Shanhai node entry');
    }
  }
  if (state.battleInput !== undefined) {
    if (!isObject(state.battleInput) || typeof state.battleInput.seed !== 'string' ||
      !Number.isInteger(state.battleInput.roundLimit) || state.battleInput.roundLimit < 1 ||
      state.battleInput.roundLimit > 4096) {
      throw new Error('Invalid Shanhai battle input');
    }
    assertLoadoutShapeWithoutContent(state.battleInput.player);
    assertLoadoutShapeWithoutContent(state.battleInput.enemy);
  }
  if (state.battle !== undefined) validateBattleResult(state.battle);
  if (state._talentQueue !== undefined && (!Array.isArray(state._talentQueue) ||
    state._talentQueue.some(item => !isObject(item) || typeof item.method !== 'string' ||
      !Number.isInteger(item.tier) || item.tier < 1 || item.tier > 4 ||
      typeof item.advance !== 'boolean'))) {
    throw new Error('Invalid Shanhai talent queue');
  }
  if (state._returnPhase !== undefined && !RUN_PHASES.has(state._returnPhase)) {
    throw new Error('Invalid Shanhai return phase');
  }
  if (state._pendingTravelResources !== undefined &&
    (!isObject(state._pendingTravelResources) ||
      Object.values(state._pendingTravelResources).some(amount => !nonNegative(amount)))) {
    throw new Error('Invalid Shanhai pending travel resources');
  }
  if (state._pendingTravelResourceKinds !== undefined &&
    (!isObject(state._pendingTravelResourceKinds) ||
      Object.values(state._pendingTravelResourceKinds).some(kind => !['hp', 'coins', 'xp'].includes(kind)))) {
    throw new Error('Invalid Shanhai pending travel resource kinds');
  }
  if (state._pendingTravelResourceKinds !== undefined && state._pendingTravelResources === undefined) {
    throw new Error('Invalid Shanhai pending travel resource kinds');
  }
  if (state._pendingTravelResources !== undefined && state._pendingTravelResourceKinds !== undefined &&
    Object.keys(state._pendingTravelResourceKinds).some(key => !(key in (state._pendingTravelResources ?? {})))) {
    throw new Error('Invalid Shanhai pending travel resource kinds');
  }
  if (state._pendingTravelCoins !== undefined && !nonNegative(state._pendingTravelCoins)) {
    throw new Error('Invalid Shanhai pending travel coins');
  }
  if (state._methodConsecutiveNodes !== undefined &&
    (!isObject(state._methodConsecutiveNodes) ||
      Object.values(state._methodConsecutiveNodes).some(count => !Number.isInteger(count) || count < 0))) {
    throw new Error('Invalid Shanhai method travel counters');
  }
  if (state._travelSnapshots !== undefined && (!Array.isArray(state._travelSnapshots) ||
    state._travelSnapshots.some(snapshot => !isObject(snapshot) ||
      !Number.isInteger(snapshot.act) || snapshot.act < 1 || snapshot.act > 5 ||
      !Number.isInteger(snapshot.step) || snapshot.step < 0 || typeof snapshot.method !== 'string' ||
      !Array.isArray(snapshot.talents) || !Array.isArray(snapshot.artifacts) ||
      !RUN_PHASES.has(snapshot.phase)))) {
    throw new Error('Invalid Shanhai travel snapshots');
  }
  if (state._previewKind !== undefined && !['node', 'event'].includes(state._previewKind)) {
    throw new Error('Invalid Shanhai preview kind');
  }
  if (state._battleKind !== undefined && !['node', 'event'].includes(state._battleKind)) {
    throw new Error('Invalid Shanhai battle kind');
  }
  if (state._battleNodeType !== undefined && !NODE_TYPES.has(state._battleNodeType)) {
    throw new Error('Invalid Shanhai battle node type');
  }
  if (state._pendingEvent !== undefined &&
    (!isObject(state._pendingEvent) || typeof state._pendingEvent.eventId !== 'string' ||
      typeof state._pendingEvent.optionId !== 'string' || typeof state._pendingEvent.enemyId !== 'string' ||
      typeof state._pendingEvent.mode !== 'string' || !finite(state._pendingEvent.failureHpFloor) ||
      state._pendingEvent.failureHpFloor < 1 || !Array.isArray(state._pendingEvent.failureRewards) ||
      state._pendingEvent.failureRewards.some(reward => !isObject(reward)) ||
      (state._pendingEvent.failureOutcome !== undefined &&
        typeof state._pendingEvent.failureOutcome !== 'string'))) {
    throw new Error('Invalid Shanhai pending event');
  }
  if (state._pendingEvent !== undefined && !['preview', 'battle'].includes(state.phase)) {
    throw new Error('Invalid Shanhai pending event phase');
  }
  for (const key of [
    '_battleSettled',
    '_eventRewardApplied',
    '_swapAvailable',
    '_eventCostTravelApplied',
    '_rewardSettled',
    '_eventSettled',
    '_restFromEvent',
  ]) {
    if (state[key] !== undefined && typeof state[key] !== 'boolean') {
      throw new Error('Invalid Shanhai internal flag');
    }
  }
  if (!allFiniteNumbers(state)) throw new Error('Non-finite Shanhai run state');
}

function extractState(payload: unknown): RunState {
  if (!isObject(payload)) throw new Error('Corrupted Shanhai save: expected object');
  const wrapped = Object.prototype.hasOwnProperty.call(payload, 'state');
  if (wrapped && (payload.schema !== 1 || payload.key !== SHANHAI_SAVE_KEY ||
    typeof payload.contentVersion !== 'string' || typeof payload.savedAt !== 'string' ||
    !payload.savedAt || !isObject(payload.state))) {
    throw new Error('Corrupted Shanhai save: invalid record header');
  }
  const state = wrapped ? payload.state : payload;
  if (state.schema !== 1 || typeof state.contentVersion !== 'string') {
    throw new Error('Corrupted Shanhai save: invalid record header');
  }
  if (wrapped && payload.contentVersion !== state.contentVersion) {
    throw new Error('Corrupted Shanhai save: content version mismatch');
  }
  return clone(state as RunState);
}

function assertStateForSave(content: Content | undefined, state: RunState): void {
  if (content) {
    validateRunState(content, state);
    return;
  }
  assertStateShapeWithoutContent(state);
}

function gameAndState(input: ShanhaiGame | { content: Content; state: RunState } | RunState): {
  content?: Content;
  state: RunState;
} {
  if (input instanceof ShanhaiGame) return { content: input.content, state: input.state };
  if (isObject(input) && isObject(input.state)) {
    return {
      content: isObject(input.content) ? input.content as Content : undefined,
      state: input.state as RunState,
    };
  }
  return { state: input as RunState };
}

function saveRecord(input: ShanhaiGame | { content: Content; state: RunState } | RunState): ShanhaiSaveRecord {
  const { content, state } = gameAndState(input);
  assertStateForSave(content, state);
  const record: ShanhaiSaveRecord = {
    schema: 1,
    key: SHANHAI_SAVE_KEY,
    contentVersion: state.contentVersion,
    savedAt: new Date().toISOString(),
    state: clone(state),
  };
  if (record.state.battle?.frames.length && record.state.battleInput) {
    record.replay = 'deterministic-input-v1';
    record.state.battle.frames = [];
  }
  return record;
}

export function serializeRun(
  input: ShanhaiGame | { content: Content; state: RunState } | RunState,
): string {
  return JSON.stringify(saveRecord(input));
}

export function saveRun(
  input: ShanhaiGame | { content: Content; state: RunState } | RunState,
  storage?: StorageLike,
): ShanhaiSaveRecord {
  const record = saveRecord(input);
  storageOrDefault(storage).setItem(SHANHAI_SAVE_KEY, JSON.stringify(record));
  return clone(record);
}

export function parseRunSave(content: Content, text: string): RunState {
  if (typeof text !== 'string' || text.length > 4_000_000) throw new Error('Corrupted Shanhai save');
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Corrupted Shanhai save: invalid JSON');
  }
  const state = extractState(payload);
  validateRunState(content, state);
  if (isObject(payload) && payload.replay !== undefined) {
    if (payload.replay !== 'deterministic-input-v1' || !state.battleInput || !state.battle) {
      throw new Error('Corrupted Shanhai replay input');
    }
    const input = state.battleInput;
    const replay = simulateBattle(content, input.player, input.enemy, input.seed, { roundLimit: input.roundLimit });
    for (const key of ['outcome', 'rounds', 'playerHp', 'enemyHp'] as const) {
      if (replay[key] !== state.battle[key]) throw new Error('Stored battle no longer matches its deterministic input');
    }
    state.battle = replay;
  }
  return state;
}

/**
 * Reads the Shanhai key only.  Invalid data is reported to the caller and is
 * deliberately left in storage so a later save cannot silently destroy it.
 */
export function loadRun(
  content: Content,
  storage?: StorageLike,
): ShanhaiGame | null {
  const text = storageOrDefault(storage).getItem(SHANHAI_SAVE_KEY);
  if (text === null) return null;
  const state = parseRunSave(content, text);
  return new ShanhaiGame(content, state);
}

export function loadRunState(
  content: Content,
  storage?: StorageLike,
): RunState | null {
  const text = storageOrDefault(storage).getItem(SHANHAI_SAVE_KEY);
  if (text === null) return null;
  return parseRunSave(content, text);
}

export const loadSavedRun = loadRun;
export const saveSavedRun = saveRun;

export function hasSavedRun(storage?: StorageLike): boolean {
  return storageOrDefault(storage).getItem(SHANHAI_SAVE_KEY) !== null;
}

export function clearSavedRun(storage?: StorageLike): void {
  storageOrDefault(storage).removeItem(SHANHAI_SAVE_KEY);
}

function readBuildRecords(storage?: StorageLike): ShanhaiBuildRecord[] {
  const text = storageOrDefault(storage).getItem(SHANHAI_BUILD_KEY);
  if (text === null) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Corrupted Shanhai build records: invalid JSON');
  }
  if (!Array.isArray(payload)) throw new Error('Corrupted Shanhai build records');
  return payload.map(record => {
    if (!isObject(record) || record.schema !== 1 || typeof record.buildId !== 'string' ||
      typeof record.runId !== 'string' || typeof record.contentVersion !== 'string' ||
      typeof record.name !== 'string' || typeof record.method !== 'string' ||
      !Number.isInteger(record.n) || !Array.isArray(record.talents) || !Array.isArray(record.artifacts) ||
      !isObject(record.stats) || !finite(record.stats.attack) || !finite(record.stats.defense) ||
      !finite(record.stats.max_hp) || !finite(record.stats.crit_rate) || !finite(record.stats.speed)) {
      throw new Error('Corrupted Shanhai build records');
    }
    return clone(record as ShanhaiBuildRecord);
  });
}

export function saveWinningBuild(
  game: ShanhaiGame,
  storage?: StorageLike,
): ShanhaiBuildRecord | null {
  if (game.state.phase !== 'won') return null;
  const state = game.state;
  const buildId = `${state.id}:${state.method}:${state.n}:${state.talents[state.method]?.join(',') ?? ''}:${state.artifacts.map(item => `${item.id}x${item.stacks}`).join(',')}`;
  const record: ShanhaiBuildRecord = {
    schema: 1,
    buildId,
    runId: state.id,
    contentVersion: state.contentVersion,
    savedAt: new Date().toISOString(),
    name: state.name,
    method: state.method,
    n: state.n,
    talents: clone(state.talents[state.method] ?? []),
    artifacts: clone(state.artifacts),
    stats: clone(game.stats),
  };
  const target = storageOrDefault(storage);
  const records = readBuildRecords(target);
  const index = records.findIndex(existing => existing.buildId === buildId);
  if (index >= 0) records[index] = { ...records[index], ...record };
  else records.push(record);
  target.setItem(SHANHAI_BUILD_KEY, JSON.stringify(records));
  return clone(record);
}

export const saveBuildRecord = saveWinningBuild;

export function loadWinningBuilds(storage?: StorageLike): ShanhaiBuildRecord[] {
  return readBuildRecords(storage).map(clone);
}

export const loadBuildRecords = loadWinningBuilds;
