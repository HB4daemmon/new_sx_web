import type { ArtifactStack, Stats } from './types.js';

export type EventCheckStat = keyof Stats | 'hp_ratio';

export type EventCheckBonus =
  | { type: 'stat'; stat: EventCheckStat; threshold: number; amount: number }
  | { type: 'method'; id: string; amount: number }
  | { type: 'artifact'; id: string; amount: number };

type EventCheckResourceBasis = 'flat' | 'reference_hp' | 'common_price' | 'next_xp';
export type EventCheckReward =
  | { type: 'resource'; resource: 'hp' | 'coins' | 'xp'; amount: number; basis: EventCheckResourceBasis }
  | { type: 'artifact'; id: string; count: number }
  | { type: 'method'; id: string }
  | { type: 'preparation'; effect: 'shield'; amount: number; basis: EventCheckResourceBasis }
  | { type: 'swap_method'; pool: 'owned_methods' };

export interface StatEventCheck {
  kind: 'stat';
  hint: string;
  stat: EventCheckStat;
  threshold: number;
  failure_rewards: EventCheckReward[];
  failure_outcome: string;
  failure_echo: string;
}

export interface ChanceEventCheck {
  kind: 'chance';
  hint: string;
  chance: number;
  bonuses?: EventCheckBonus[];
  failure_rewards: EventCheckReward[];
  failure_outcome: string;
  failure_echo: string;
}

export type EventCheck = StatEventCheck | ChanceEventCheck;

export interface EventCheckContext {
  seed: string;
  act: number;
  step: number;
  eventId: string;
  optionId: string;
  stats: Stats;
  hp: number;
  ownedMethods: string[];
  artifacts: ArtifactStack[];
}

export type EventCheckResult =
  | { kind: 'stat'; success: boolean; stat: EventCheckStat; value: number; threshold: number }
  | { kind: 'chance'; success: boolean; chance: number; roll: number };

const MIN_CHECK_CHANCE = 0.05;
const MAX_CHECK_CHANCE = 0.95;

export function assertEventCheckResult(value: unknown): asserts value is EventCheckResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid event check result');
  const result = value as Record<string, unknown>;
  const finite = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number);
  if (typeof result.success !== 'boolean') throw new Error('Invalid event check success');
  if (result.kind === 'stat') {
    if (!['attack', 'defense', 'max_hp', 'crit_rate', 'speed', 'hp_ratio'].includes(String(result.stat)) ||
      !finite(result.value) || !finite(result.threshold) ||
      result.success !== (result.value >= result.threshold)) throw new Error('Invalid event stat check');
  } else if (result.kind === 'chance') {
    if (!finite(result.chance) || result.chance < MIN_CHECK_CHANCE || result.chance > MAX_CHECK_CHANCE ||
      !finite(result.roll) || result.roll < 0 || result.roll >= 1 ||
      result.success !== (result.roll < result.chance)) throw new Error('Invalid event chance check');
  } else throw new Error('Invalid event check kind');
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function assertContext(context: EventCheckContext): void {
  if (typeof context.seed !== 'string' ||
    !Number.isInteger(context.act) || context.act < 1 || context.act > 4 ||
    !Number.isInteger(context.step) || context.step < 1 || context.step > 11 ||
    typeof context.eventId !== 'string' || context.eventId.trim() === '' ||
    typeof context.optionId !== 'string' || context.optionId.trim() === '') {
    throw new Error('Event check context needs a seed and named event position');
  }
  assertFinite(context.hp, 'context.hp');
  assertFinite(context.stats.max_hp, 'context.stats.max_hp');
  if (context.stats.max_hp <= 0) throw new Error('context.stats.max_hp must be positive');
  for (const [stat, value] of Object.entries(context.stats)) assertFinite(value, `context.stats.${stat}`);
  if (!Array.isArray(context.ownedMethods) || !Array.isArray(context.artifacts)) {
    throw new Error('Event check context needs owned methods and artifacts');
  }
}

function statValue(stat: EventCheckStat, context: EventCheckContext): number {
  if (stat === 'hp_ratio') return context.hp / context.stats.max_hp;
  const value = context.stats[stat];
  assertFinite(value, `context.stats.${stat}`);
  return value;
}

function satisfiedBonus(bonus: EventCheckBonus, context: EventCheckContext): boolean {
  if (bonus.type === 'stat') {
    assertFinite(bonus.threshold, 'bonus.threshold');
    return statValue(bonus.stat, context) >= bonus.threshold;
  }
  if (bonus.type === 'method') return context.ownedMethods.includes(bonus.id);
  if (bonus.type === 'artifact') {
    return context.artifacts.some((artifact) => artifact.id === bonus.id && artifact.stacks > 0);
  }
  throw new Error(`Unknown event check bonus: ${(bonus as { type?: string }).type}`);
}

export function eventCheckChance(check: ChanceEventCheck, context: EventCheckContext): number {
  if (check.kind !== 'chance') throw new Error('eventCheckChance requires a chance check');
  assertContext(context);
  assertFinite(check.chance, 'check.chance');
  if (check.chance < 0 || check.chance > 1) throw new Error('check.chance must be between 0 and 1');

  let chance = check.chance;
  for (const bonus of check.bonuses ?? []) {
    assertFinite(bonus.amount, 'bonus.amount');
    if (satisfiedBonus(bonus, context)) chance += bonus.amount;
  }
  return Math.min(MAX_CHECK_CHANCE, Math.max(MIN_CHECK_CHANCE, chance));
}

function namedRoll(context: EventCheckContext): number {
  const key = `${context.seed}\u0000${context.act}\u0000${context.step}\u0000${context.eventId}\u0000${context.optionId}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  let value = hash >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

export function resolveEventCheck(check: EventCheck, context: EventCheckContext): EventCheckResult {
  if (check.kind === 'stat') {
    assertContext(context);
    assertFinite(check.threshold, 'check.threshold');
    const value = statValue(check.stat, context);
    return {
      kind: 'stat',
      success: value >= check.threshold,
      stat: check.stat,
      value,
      threshold: check.threshold,
    };
  }

  const chance = eventCheckChance(check, context);
  const roll = namedRoll(context);
  return { kind: 'chance', success: roll < chance, chance, roll };
}
