import type { Content, RunState, Stats } from './types.js';
import {
  ShanhaiGame,
  validateBattleResult,
  validateRunState,
  simulateBattle,
} from './run.js';
import { validateRouteMap } from './route-map.js';
import { assertEventCommitmentRecords } from './event-commitments.js';
import { assertEventCheckResult } from './event-checks.js';
import { MAX_EQUIPMENT_SLOTS } from './equipment.js';

export const SHANHAI_SAVE_KEY = 'suishi-shanhai-run-v2-overhaul';
export const SHANHAI_BUILD_KEY = 'suishi-shanhai-build-v2-overhaul';
export const SAVE_KEY = SHANHAI_SAVE_KEY;
const SHANHAI_CONTENT_VERSION = 'shanhai-content-0.2';

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
const SHOP_KINDS = new Set(['artifact', 'recovery', 'preparation', 'talent_reset']);

function allFiniteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFiniteNumbers);
  if (isObject(value)) return Object.values(value).every(allFiniteNumbers);
  return true;
}

function nonNegative(value: unknown): boolean {
  return finite(value) && value >= 0;
}

function assertFusionInventoryShape(value: unknown, label: string): void {
  const validArtifactId = (id: unknown): boolean =>
    typeof id === 'string' && /^(?:RC|RR|RL)\d\d$/.test(id);
  if (!Array.isArray(value) || value.length > 128) throw new Error(`Invalid ${label}`);
  const ids = new Set<string>();
  for (const stack of value) {
    if (!isObject(stack) || !validArtifactId(stack.id) ||
      !Number.isInteger(stack.stacks) || stack.stacks < 1 || stack.stacks > 16 || ids.has(stack.id)) {
      throw new Error(`Invalid ${label}`);
    }
    ids.add(stack.id);
  }
}

function assertFusionEvidenceShape(value: unknown): void {
  if (!isObject(value) || Object.keys(value).length !== 6 ||
    !['act', 'step', 'kind', 'enemyId', 'entryInventory', 'settlementInventory']
      .every(key => Object.prototype.hasOwnProperty.call(value, key)) ||
    !Number.isInteger(value.act) || value.act < 1 || value.act > 5 ||
    !Number.isInteger(value.step) || value.step < 0 || value.step > (value.act === 5 ? 0 : 10) ||
    !['node', 'event'].includes(value.kind) || typeof value.enemyId !== 'string' || !value.enemyId.trim()) {
    throw new Error('Invalid saved fusion win evidence');
  }
  assertFusionInventoryShape(value.entryInventory, 'saved fusion entry inventory');
  assertFusionInventoryShape(value.settlementInventory, 'saved fusion settlement inventory');
}

function assertFusionStateShape(state: RunState): void {
  const validFusionId = (id: unknown): boolean =>
    typeof id === 'string' && /^RL\d\d$/.test(id);
  if (!Array.isArray(state.fusionProgress) || state.fusionProgress.length > 16) {
    throw new Error('Invalid saved fusion progress');
  }
  const progressIds = new Set<string>();
  for (const progress of state.fusionProgress) {
    if (!isObject(progress) || Object.keys(progress).length !== 2 ||
      !['id', 'wins'].every(key => Object.prototype.hasOwnProperty.call(progress, key)) ||
      !validFusionId(progress.id) || progressIds.has(progress.id) ||
      !Array.isArray(progress.wins) || progress.wins.length > 16) {
      throw new Error('Invalid saved fusion progress');
    }
    progressIds.add(progress.id);
    let previousPosition = -1;
    const coordinates = new Set<string>();
    for (const win of progress.wins) {
      assertFusionEvidenceShape(win);
      const position = (win.act - 1) * 11 + win.step;
      const coordinate = `${win.act}:${win.step}`;
      if (position <= previousPosition || coordinates.has(coordinate)) {
        throw new Error('Invalid saved fusion win order');
      }
      previousPosition = position;
      coordinates.add(coordinate);
    }
  }
  if (!Array.isArray(state.fusionHistory) || state.fusionHistory.length > 16) {
    throw new Error('Invalid saved fusion history');
  }
  const historyIds = new Set<string>();
  for (const entry of state.fusionHistory) {
    if (!isObject(entry) || Object.keys(entry).length !== 5 ||
      !['id', 'act', 'step', 'title', 'text'].every(key => Object.prototype.hasOwnProperty.call(entry, key)) ||
      !validFusionId(entry.id) || historyIds.has(entry.id) ||
      !Number.isInteger(entry.act) || entry.act < 1 || entry.act > 5 ||
      !Number.isInteger(entry.step) || entry.step < 0 || entry.step > (entry.act === 5 ? 0 : 10) ||
      typeof entry.title !== 'string' || !entry.title.trim() ||
      typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 2000) {
      throw new Error('Invalid saved fusion history');
    }
    historyIds.add(entry.id);
  }
  if (state._fusionBattleEntry !== undefined) {
    const entry = state._fusionBattleEntry;
    const entryKeys = ['act', 'step', 'kind', 'enemyId', 'inventory', 'eligibleRecipes', 'settlementInventory'];
    const hasSettlementInventory = isObject(entry) &&
      Object.prototype.hasOwnProperty.call(entry, 'settlementInventory');
    if (!isObject(entry) ||
      Object.keys(entry).length !== (hasSettlementInventory ? 7 : 6) ||
      Object.keys(entry).some(key => !entryKeys.includes(key)) ||
      !['act', 'step', 'kind', 'enemyId', 'inventory', 'eligibleRecipes']
        .every(key => Object.prototype.hasOwnProperty.call(entry, key)) ||
      !Number.isInteger(entry.act) || entry.act < 1 || entry.act > 5 ||
      !Number.isInteger(entry.step) || entry.step < 0 || entry.step > (entry.act === 5 ? 0 : 10) ||
      !['node', 'event'].includes(entry.kind) || typeof entry.enemyId !== 'string' || !entry.enemyId.trim() ||
      !Array.isArray(entry.eligibleRecipes) || entry.eligibleRecipes.length > 16 ||
      entry.eligibleRecipes.some(id => !validFusionId(id)) ||
      new Set(entry.eligibleRecipes).size !== entry.eligibleRecipes.length) {
      throw new Error('Invalid saved fusion battle entry');
    }
    assertFusionInventoryShape(entry.inventory, 'saved fusion battle inventory');
    if (entry.settlementInventory !== undefined) {
      assertFusionInventoryShape(entry.settlementInventory, 'saved fusion settlement inventory');
    }
  }
}

function assertLoadoutShapeWithoutContent(loadout: unknown, side: 'player' | 'enemy' = 'player'): void {
  if (!isObject(loadout) || typeof loadout.name !== 'string' || typeof loadout.method !== 'string' ||
    !Number.isInteger(loadout.n) || loadout.n < 0 || loadout.n > 4 ||
    !Array.isArray(loadout.talents) || loadout.talents.some(id => typeof id !== 'string') ||
    !Array.isArray(loadout.artifacts) || loadout.artifacts.length > MAX_EQUIPMENT_SLOTS) {
    throw new Error('Invalid saved loadout');
  }
  if (loadout.companion !== undefined &&
    (typeof loadout.companion !== 'string' || !loadout.companion.trim())) {
    throw new Error('Invalid saved companion reference');
  }
  if (loadout.thunderChallenge !== undefined &&
    (side !== 'enemy' || loadout.thunderChallenge !== true)) {
    throw new Error('Invalid saved thunder challenge marker');
  }
  if (loadout.encounterId !== undefined &&
    (side !== 'enemy' || typeof loadout.encounterId !== 'string' || !loadout.encounterId.trim())) {
    throw new Error('Invalid saved enemy encounter reference');
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
  if (loadout.journey !== undefined &&
    (!isObject(loadout.journey) ||
      !nonNegative(loadout.journey.coins) ||
      !nonNegative(loadout.journey.coinsSpent) ||
      !Number.isInteger(loadout.journey.eliteWins) || loadout.journey.eliteWins < 0 ||
      !Number.isInteger(loadout.journey.bossWins) || loadout.journey.bossWins < 0 ||
      !Number.isInteger(loadout.journey.artifactKinds) || loadout.journey.artifactKinds < 0 ||
      !Number.isInteger(loadout.journey.knownMethods) || loadout.journey.knownMethods < 0)) {
    throw new Error('Invalid saved journey context');
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
  if (state.bloodVow === undefined) state.bloodVow = false;
  if (typeof state.bloodVow !== 'boolean') throw new Error('Invalid saved blood vow marker');
  if (state.contentVersion !== SHANHAI_CONTENT_VERSION) {
    throw new Error('V2 save requires shanhai-content-0.2');
  }
  if (!Number.isInteger(state.act) || state.act < 1 || state.act > 5 ||
    !Number.isInteger(state.step) || state.step < 0) {
    throw new Error('Invalid Shanhai run position');
  }
  if (!Number.isInteger(state.n) || state.n < 0 || state.n > 4) {
    throw new Error('Invalid Shanhai realm');
  }
  if (state.buildVersion !== 5) {
    throw new Error('Invalid saved build version');
  }
  assertFusionStateShape(state);
  if (!isObject(state.progress) ||
    !nonNegative(state.progress.coinsSpent) ||
    !Number.isInteger(state.progress.eliteWins) || state.progress.eliteWins < 0 ||
    !Number.isInteger(state.progress.bossWins) || state.progress.bossWins < 0) {
    throw new Error('Invalid saved run progress');
  }
  if (typeof state.method !== 'string' || !Array.isArray(state.ownedMethods) ||
    state.ownedMethods.some(id => typeof id !== 'string') ||
    new Set(state.ownedMethods).size !== state.ownedMethods.length ||
    !state.ownedMethods.includes(state.method)) {
    throw new Error('Invalid Shanhai methods');
  }
  if (typeof state._thunderChallenge !== 'boolean' ||
    !['normal', 'bonus', undefined].includes(state._thunderRewardStage) ||
    !Array.isArray(state._thunderRewardCandidates) ||
    state._thunderRewardCandidates.length > 3 ||
    state._thunderRewardCandidates.some(id => typeof id !== 'string') ||
    new Set(state._thunderRewardCandidates).size !== state._thunderRewardCandidates.length ||
    (state._thunderRewardFallback !== undefined &&
      (!isObject(state._thunderRewardFallback) || Object.keys(state._thunderRewardFallback).length !== 2 ||
        state._thunderRewardFallback.type !== 'coins' || state._thunderRewardFallback.amount !== 20))) {
    throw new Error('Invalid saved thunder challenge state');
  }
  if (!Array.isArray(state.thunderChallenges) || state.thunderChallenges.length > 44) {
    throw new Error('Invalid saved thunder challenge history');
  }
  const challengeCoordinates = new Set<string>();
  let previousChallengePosition = -1;
  const validArtifactId = (id: unknown): id is string =>
    typeof id === 'string' && /^(?:RC|RR|RL)\d\d$/.test(id);
  for (const record of state.thunderChallenges) {
    if (!isObject(record) || Object.keys(record).length !== 14 ||
      !['act', 'step', 'nodeType', 'enemyId', 'outcome', 'xpBonus', 'normalCandidates',
        'normalSettled', 'normalReward', 'extraRarity', 'extraInventory', 'extraCandidates',
        'extraReward', 'fallbackCoins'].every(key => Object.prototype.hasOwnProperty.call(record, key)) ||
      !Number.isInteger(record.act) || record.act < 1 || record.act > 4 || record.act > state.act ||
      !Number.isInteger(record.step) || record.step < 0 || record.step > 10 ||
      !['L', 'B'].includes(record.nodeType) || typeof record.enemyId !== 'string' || !record.enemyId.trim() ||
      !['win', 'loss'].includes(record.outcome) || !nonNegative(record.xpBonus) ||
      !Array.isArray(record.normalCandidates) || record.normalCandidates.length > 3 ||
      record.normalCandidates.some(id => !validArtifactId(id)) ||
      new Set(record.normalCandidates).size !== record.normalCandidates.length ||
      typeof record.normalSettled !== 'boolean' ||
      (record.normalReward !== null && !validArtifactId(record.normalReward)) ||
      ![null, 'rare', 'legendary'].includes(record.extraRarity) ||
      !Array.isArray(record.extraInventory) || record.extraInventory.length > 128 ||
      record.extraInventory.some(stack => !isObject(stack) || !validArtifactId(stack.id) ||
        !Number.isInteger(stack.stacks) || stack.stacks < 1 || stack.stacks > 4) ||
      new Set(record.extraInventory.map(stack => stack.id)).size !== record.extraInventory.length ||
      !Array.isArray(record.extraCandidates) || record.extraCandidates.length > 3 ||
      record.extraCandidates.some(id => !validArtifactId(id)) ||
      new Set(record.extraCandidates).size !== record.extraCandidates.length ||
      (record.extraReward !== null && !validArtifactId(record.extraReward)) ||
      !Number.isInteger(record.fallbackCoins) || ![0, 20].includes(record.fallbackCoins)) {
      throw new Error('Invalid saved thunder challenge record');
    }
    const position = (record.act - 1) * 11 + record.step;
    const coordinate = `${record.act}:${record.step}`;
    if (position <= previousChallengePosition || challengeCoordinates.has(coordinate)) {
      throw new Error('Invalid saved thunder challenge order');
    }
    previousChallengePosition = position;
    challengeCoordinates.add(coordinate);
    if (record.normalReward !== null && !record.normalCandidates.includes(record.normalReward)) {
      throw new Error('Invalid saved thunder normal reward');
    }
    if (record.extraCandidates.length &&
      (!record.extraRarity || record.extraCandidates.some(id =>
        record.extraRarity === 'rare' ? !id.startsWith('RR') : !id.startsWith('RL')))) {
      throw new Error('Invalid saved thunder bonus rarity');
    }
    if (record.outcome === 'loss') {
      if (record.xpBonus !== 0 || record.normalCandidates.length || record.normalSettled ||
        record.normalReward !== null || record.extraRarity !== null || record.extraInventory.length ||
        record.extraCandidates.length || record.extraReward !== null || record.fallbackCoins !== 0) {
        throw new Error('Invalid failed thunder challenge settlement');
      }
    } else if (!record.normalSettled) {
      if (record.normalReward !== null || record.extraRarity !== null || record.extraInventory.length ||
        record.extraCandidates.length || record.extraReward !== null || record.fallbackCoins !== 0) {
        throw new Error('Invalid pending thunder normal reward');
      }
    } else if (record.extraCandidates.length) {
      if (record.extraRarity === null || record.fallbackCoins !== 0 ||
        (record.extraReward !== null && !record.extraCandidates.includes(record.extraReward))) {
        throw new Error('Invalid pending thunder bonus reward');
      }
    } else if (record.extraRarity !== null || record.extraReward !== null || record.fallbackCoins !== 20) {
      throw new Error('Invalid thunder challenge fallback settlement');
    }
  }
  if (state._thunderRewardStage === undefined && state._thunderRewardCandidates.length) {
    throw new Error('Thunder bonus candidates without an active stage');
  }
  if (state._thunderRewardStage !== undefined) {
    const challenge = state.thunderChallenges.find(record =>
      record.act === state.act && record.step === state.step);
    if (!state._thunderChallenge || !['reward', 'lost'].includes(state.phase) ||
      !challenge || challenge.outcome !== 'win' ||
      (state._thunderRewardStage === 'normal' &&
        (challenge.normalSettled || state._thunderRewardCandidates.length ||
          JSON.stringify(challenge.normalCandidates) !== JSON.stringify(state.rewardCandidates))) ||
      (state._thunderRewardStage === 'bonus' &&
        (!challenge.normalSettled || !challenge.extraCandidates.length || challenge.extraReward !== null ||
          JSON.stringify(challenge.extraCandidates) !== JSON.stringify(state._thunderRewardCandidates) ||
          JSON.stringify(challenge.extraCandidates) !== JSON.stringify(state.rewardCandidates)))) {
      throw new Error('Inconsistent active thunder challenge reward stage');
    }
  }
  if (!isObject(state.talents)) throw new Error('Invalid Shanhai talents');
  for (const [method, talents] of Object.entries(state.talents)) {
    if (!state.ownedMethods.includes(method) || !Array.isArray(talents) ||
      talents.some(id => typeof id !== 'string') || new Set(talents).size !== talents.length) {
      throw new Error('Invalid Shanhai talents');
    }
  }
  if (!state.bloodVow && Object.values(state.talents).some(talents => talents.includes('V2-J1-G'))) {
    throw new Error('Selected blood vow is missing its permanent run marker');
  }
  if (!isObject(state.equipment) || !Array.isArray(state.equipment.slots) ||
    state.equipment.slots.length > MAX_EQUIPMENT_SLOTS ||
    state.equipment.slots.some(id => typeof id !== 'string') ||
    new Set(state.equipment.slots).size !== state.equipment.slots.length) {
    throw new Error('Invalid Shanhai equipment');
  }
  if (!Number.isInteger(state.talentDraftGeneration) || state.talentDraftGeneration < 0 ||
    !isObject(state.talentDrafts) || Object.entries(state.talentDrafts).some(([key, ids]) => {
      const match = /^RKF\d{2}:[1-4]:(0|[1-9]\d*)$/.exec(key);
      return !match || Number(match[1]) > state.talentDraftGeneration ||
        !Array.isArray(ids) || ids.length !== 3 ||
        ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length;
    })) {
    throw new Error('Invalid Shanhai talent drafts');
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
  if (state._routeMapVersion !== undefined && state._routeMapVersion !== 1) {
    throw new Error('Invalid saved route map version');
  }
  if (state._routeMapLegacy !== undefined && typeof state._routeMapLegacy !== 'boolean') {
    throw new Error('Invalid saved legacy route map marker');
  }
  if (!state.routeMap) throw new Error('Invalid route map: saved route map is missing');
  validateRouteMap(state.routeMap, state.act, state.nodes, state.step, state.phase, state._routeMapLegacy === true);
  if (state._thunderChallenge === true) {
    const challengeNode = state.nodes[state.step];
    if (state.act > 4 || !challengeNode || !['L', 'B'].includes(challengeNode.type) ||
      challengeNode.completed || !['map', 'preview', 'battle', 'reward', 'lost'].includes(state.phase)) {
      throw new Error('Invalid active thunder challenge node');
    }
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
  if (state.equipment.slots.some(id => !artifactIds.has(id))) {
    throw new Error('Invalid Shanhai equipment ownership');
  }
  if (!Array.isArray(state.history) || state.history.some(entry =>
    !isObject(entry) || !Number.isInteger(entry.act) || entry.act < 1 || entry.act > 5 ||
    !Number.isInteger(entry.step) || entry.step < 0 ||
    typeof entry.title !== 'string' || typeof entry.text !== 'string')) {
    throw new Error('Invalid Shanhai history');
  }
  for (const entry of state.history) {
    if (entry.eventCheck !== undefined) assertEventCheckResult(entry.eventCheck);
    if (entry.storyEcho !== undefined && (typeof entry.storyEcho !== 'string' ||
      entry.storyEcho.length > 2000)) throw new Error('Invalid saved story echo');
  }
  if (state.eventCheck !== undefined) assertEventCheckResult(state.eventCheck);
  if (state.eventStoryEcho !== undefined && (typeof state.eventStoryEcho !== 'string' ||
    state.eventStoryEcho.length > 2000)) throw new Error('Invalid saved event echo');
  assertEventCommitmentRecords(state.eventCommitments);
  if (!isObject(state.flags) || Object.values(state.flags).some(value => typeof value !== 'boolean') ||
    !Array.isArray(state.seenEvents) || state.seenEvents.some(id => typeof id !== 'string') ||
    !Array.isArray(state.completedCore) || state.completedCore.some(id => typeof id !== 'string') ||
    !Array.isArray(state.rewardCandidates) || state.rewardCandidates.some(id => typeof id !== 'string')) {
    throw new Error('Invalid Shanhai event collections');
  }
  if (!Array.isArray(state.rewardSearches)) throw new Error('Invalid reward search history');
  const searchedActs = new Set<number>();
  const rewardFamilies = new Set(['sword', 'guard', 'vitality', 'affliction']);
  for (const record of state.rewardSearches) {
    if (!isObject(record) || Object.keys(record).length !== 6 ||
      !['act', 'step', 'family', 'cost', 'candidates', 'resolved']
        .every(key => Object.prototype.hasOwnProperty.call(record, key)) ||
      !Number.isInteger(record.act) || record.act < 1 || record.act > 4 ||
      !Number.isInteger(record.step) || record.step < 0 || record.step > 10 ||
      !rewardFamilies.has(record.family) ||
      !Number.isInteger(record.cost) || record.cost <= 0 ||
      !Array.isArray(record.candidates) || record.candidates.length < 1 || record.candidates.length > 3 ||
      record.candidates.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(record.candidates).size !== record.candidates.length ||
      typeof record.resolved !== 'boolean' ||
      searchedActs.has(record.act)) {
      throw new Error('Invalid reward search record');
    }
    if (record.act > state.act || (record.act === state.act && record.step > state.step)) {
      throw new Error('Invalid future reward search coordinate');
    }
    searchedActs.add(record.act);
  }
  if (!Array.isArray(state.rewardRefinements) || state.rewardRefinements.length > 4) {
    throw new Error('Invalid reward refinement history');
  }
  let previousRefinedAct = 0;
  const commonId = (id: unknown): id is string =>
    typeof id === 'string' && /^RC(0[1-9]|1\d|2[0-4])$/.test(id);
  for (const record of state.rewardRefinements) {
    if (!isObject(record) || Object.keys(record).length !== 6 ||
      !['act', 'step', 'source', 'target', 'targetStacksBefore', 'forfeited']
        .every(key => Object.prototype.hasOwnProperty.call(record, key)) ||
      !Number.isInteger(record.act) || record.act <= previousRefinedAct ||
      record.act > 4 || record.act > state.act ||
      !Number.isInteger(record.step) || record.step < 0 || record.step > 10 ||
      !commonId(record.source) || !commonId(record.target) || record.source === record.target ||
      !Number.isInteger(record.targetStacksBefore) || record.targetStacksBefore < 1 ||
      record.targetStacksBefore > 4 ||
      !Array.isArray(record.forfeited) || record.forfeited.length < 1 || record.forfeited.length > 3 ||
      record.forfeited.some(id => !commonId(id)) ||
      new Set(record.forfeited).size !== record.forfeited.length) {
      throw new Error('Invalid reward refinement record');
    }
    const entry = state.history.filter(item => item.act === record.act && item.step === record.step);
    const completed = state.nodes[record.step];
    const snapshot = Array.isArray(state._travelSnapshots) && state._travelSnapshots.some((item: unknown) =>
      isObject(item) && item.act === record.act && item.step === record.step && item.phase === 'map');
    if (entry.length !== 1 || !snapshot ||
      (record.act === state.act &&
        (completed?.type !== 'C' || !completed.completed ||
          record.step > state.step ||
          (record.step === state.step && !['won', 'lost'].includes(state.phase))))) {
      throw new Error('Reward refinement does not match a completed ordinary node');
    }
    previousRefinedAct = record.act;
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
    const battleInput = state.battleInput;
    if (!isObject(battleInput) || typeof battleInput.seed !== 'string' ||
      !Number.isInteger(battleInput.roundLimit) || battleInput.roundLimit < 1 ||
      battleInput.roundLimit > 4096) {
      throw new Error('Invalid Shanhai battle input');
    }
    assertLoadoutShapeWithoutContent(battleInput.player, 'player');
    assertLoadoutShapeWithoutContent(battleInput.enemy, 'enemy');
    if (battleInput.player.companion !== undefined &&
      (!state.ownedMethods.includes(battleInput.player.companion) ||
        battleInput.player.companion === battleInput.player.method ||
        state.ownedMethods.find(id => id !== battleInput.player.method) !==
          battleInput.player.companion)) {
      throw new Error('Invalid saved battle companion owner');
    }
    if (battleInput.enemy.companion !== undefined) {
      throw new Error('Invalid frozen enemy companion');
    }
    if (state.phase === 'battle' &&
      battleInput.player.companion !==
        state.ownedMethods.find(id => id !== battleInput.player.method)) {
      throw new Error('Invalid frozen battle companion');
    }
    if ((battleInput.enemy.thunderChallenge === true) !== (state._thunderChallenge === true)) {
      throw new Error('Frozen enemy challenge state mismatch');
    }
    if (battleInput.rules !== undefined && battleInput.rules !== 'awakening-v1') throw new Error('Invalid saved battle rules');
  }
  if (state.phase === 'battle') {
    const journey = state.battleInput?.player?.journey;
    const expected = {
      coins: state.coins,
      coinsSpent: state.progress.coinsSpent,
      eliteWins: state.progress.eliteWins,
      bossWins: state.progress.bossWins,
      artifactKinds: new Set(state.artifacts.map(stack => stack.id)).size,
      knownMethods: new Set(state.ownedMethods).size,
    };
    if (!journey || journey.coins !== expected.coins ||
      journey.coinsSpent !== expected.coinsSpent ||
      journey.eliteWins !== expected.eliteWins ||
      journey.bossWins !== expected.bossWins ||
      journey.artifactKinds !== expected.artifactKinds ||
      journey.knownMethods !== expected.knownMethods) {
      throw new Error('Frozen battle journey context mismatch');
    }
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
  if (state._coreRewardOffered !== undefined && typeof state._coreRewardOffered !== 'boolean') {
    throw new Error('Invalid Shanhai core reward marker');
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
    '_shopReforged',
  ]) {
    if (state[key] !== undefined && typeof state[key] !== 'boolean') {
      throw new Error('Invalid Shanhai internal flag');
    }
  }
  if (!allFiniteNumbers(state)) throw new Error('Non-finite Shanhai run state');
}

function extractState(payload: unknown): RunState {
  if (!isObject(payload)) throw new Error('Corrupted Shanhai save: expected object');
  if (payload.key === 'suishi-shanhai-run-v1') {
    throw new Error('V1 Shanhai saves cannot be loaded by V2');
  }
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
  let state = extractState(payload);
  validateRunState(content, state);
  const game = new ShanhaiGame(content, state);
  state = game.state;
  if (isObject(payload) && payload.replay !== undefined) {
    if (payload.replay !== 'deterministic-input-v1' || !state.battleInput || !state.battle) {
      throw new Error('Corrupted Shanhai replay input');
    }
    const input = state.battleInput;
    const replay = simulateBattle(game.content, input.player, input.enemy, input.seed, {
      roundLimit: input.roundLimit, artifactAwakenings: input.rules === 'awakening-v1',
    });
    for (const key of ['outcome', 'rounds', 'playerHp', 'enemyHp'] as const) {
      if (replay[key] !== state.battle[key]) throw new Error('Stored battle no longer matches its deterministic input');
    }
    state.battle = replay;
    validateRunState(game.content, state);
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
      record.artifacts.length > MAX_EQUIPMENT_SLOTS ||
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
  const artifacts = game.equippedArtifacts();
  const buildId = `${state.id}:${state.method}:${state.n}:${state.talents[state.method]?.join(',') ?? ''}:${artifacts.map(item => `${item.id}x${item.stacks}`).join(',')}`;
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
    artifacts: clone(artifacts),
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
