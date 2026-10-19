import type { NodeType } from './types.js';

export type EventCommitmentReward =
  | { type: 'artifact'; id: string; count: number }
  | { type: 'resource'; resource: 'hp' | 'coins' | 'xp'; amount: number; basis: 'flat' };

export interface EventCommitmentDefinition {
  name: string;
  after_nodes: 2 | 3;
  avoid_node_types: Array<'R' | 'S'>;
  rewards: EventCommitmentReward[];
  success_outcome: string;
  failure_outcome: string;
}

export type EventCommitmentStatus = 'active' | 'fulfilled' | 'broken' | 'expired';

export interface EventCommitmentRecord {
  eventId: string;
  optionId: string;
  originAct: number;
  originStep: number;
  remaining: number;
  status: EventCommitmentStatus;
  snapshot: EventCommitmentDefinition;
  processedNodes: string[];
  resultText?: string;
}

export interface EventCommitmentNode {
  act: number;
  step: number;
  type: NodeType;
}

export type EventCommitmentNodePhase = 'entered' | 'completed';

export interface EventCommitmentAdvance {
  eventCommitments: EventCommitmentRecord[];
  fulfilled: EventCommitmentRecord[];
  broken: EventCommitmentRecord[];
  expired: EventCommitmentRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function validateEventCommitmentDefinition(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['commitment must be an object'];
  if (!exactKeys(value, [
    'name',
    'after_nodes',
    'avoid_node_types',
    'rewards',
    'success_outcome',
    'failure_outcome',
  ])) errors.push('commitment has unknown or missing fields');
  if (typeof value.name !== 'string' || value.name.trim() === '') errors.push('name must be non-empty');
  if (value.after_nodes !== 2 && value.after_nodes !== 3) errors.push('after_nodes must be 2 or 3');
  if (
    !Array.isArray(value.avoid_node_types) ||
    value.avoid_node_types.length < 1 ||
    value.avoid_node_types.length > 2 ||
    value.avoid_node_types.some((type) => type !== 'R' && type !== 'S') ||
    new Set(value.avoid_node_types).size !== value.avoid_node_types.length
  ) errors.push('avoid_node_types must contain unique R and/or S node types');
  if (!Array.isArray(value.rewards) || value.rewards.length < 1 || value.rewards.length > 3) {
    errors.push('rewards must contain 1 to 3 supported rewards');
  } else {
    for (const [index, reward] of value.rewards.entries()) {
      if (!isRecord(reward)) {
        errors.push(`rewards[${index}] must be an object`);
        continue;
      }
      if (reward.type === 'artifact') {
        if (!exactKeys(reward, ['type', 'id', 'count'])) errors.push(`rewards[${index}] has unknown fields`);
        if (typeof reward.id !== 'string' || !/^(?:RC|RR|RL)\d{2}$/.test(reward.id)) {
          errors.push(`rewards[${index}].id must be an artifact ID`);
        }
        if (!Number.isInteger(reward.count) || (reward.count as number) < 1 || (reward.count as number) > 5) {
          errors.push(`rewards[${index}].count must be an integer from 1 to 5`);
        }
      } else if (reward.type === 'resource') {
        if (!exactKeys(reward, ['type', 'resource', 'amount', 'basis'])) {
          errors.push(`rewards[${index}] has unknown fields`);
        }
        if (!['hp', 'coins', 'xp'].includes(String(reward.resource))) {
          errors.push(`rewards[${index}].resource must be hp, coins, or xp`);
        }
        if (
          typeof reward.amount !== 'number' ||
          !Number.isFinite(reward.amount) ||
          reward.amount < 0 ||
          reward.amount > 1000
        ) errors.push(`rewards[${index}].amount must be finite and between 0 and 1000`);
        if (reward.basis !== 'flat') errors.push(`rewards[${index}].basis must be flat`);
      } else {
        errors.push(`rewards[${index}].type must be artifact or resource`);
      }
    }
  }
  if (typeof value.success_outcome !== 'string' || value.success_outcome.trim() === '') {
    errors.push('success_outcome must be non-empty');
  }
  if (typeof value.failure_outcome !== 'string' || value.failure_outcome.trim() === '') {
    errors.push('failure_outcome must be non-empty');
  }
  return errors;
}

export function assertEventCommitmentRecords(value: unknown): asserts value is EventCommitmentRecord[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 36) throw new Error('Invalid event commitments');
  const sources = new Set<string>();
  for (const record of value) {
    if (!isRecord(record) || typeof record.eventId !== 'string' ||
      typeof record.optionId !== 'string' || !record.optionId.startsWith(`${record.eventId}-`) ||
      !Number.isInteger(record.originAct) || Number(record.originAct) < 1 || Number(record.originAct) > 4 ||
      !Number.isInteger(record.originStep) || Number(record.originStep) < 1 || Number(record.originStep) > 11 ||
      !['active', 'fulfilled', 'broken', 'expired'].includes(String(record.status)) ||
      (record.resultText !== undefined && typeof record.resultText !== 'string') ||
      validateEventCommitmentDefinition(record.snapshot).length) {
      throw new Error('Invalid event commitment record');
    }
    const snapshot = record.snapshot as unknown as EventCommitmentDefinition;
    if (!Number.isInteger(record.remaining) || Number(record.remaining) < 0 ||
      Number(record.remaining) > snapshot.after_nodes ||
      (record.status === 'fulfilled') !== (record.remaining === 0) ||
      !Array.isArray(record.processedNodes) ||
      record.processedNodes.length !== snapshot.after_nodes - Number(record.remaining) ||
      new Set(record.processedNodes).size !== record.processedNodes.length) {
      throw new Error('Invalid event commitment progress');
    }
    let previousPosition = (Number(record.originAct) - 1) * 11 + Number(record.originStep);
    for (const key of record.processedNodes) {
      if (typeof key !== 'string' || !/^[1-4]:(?:[1-9]|10|11)$/.test(key)) {
        throw new Error('Invalid event commitment node');
      }
      const [act, step] = key.split(':').map(Number);
      const position = (act! - 1) * 11 + step!;
      if (position <= previousPosition) throw new Error('Invalid event commitment order');
      previousPosition = position;
    }
    const source = `${record.originAct}:${record.originStep}:${record.eventId}`;
    if (sources.has(source)) throw new Error('Duplicate event commitment');
    sources.add(source);
  }
}

function snapshotDefinition(definition: EventCommitmentDefinition): EventCommitmentDefinition {
  return {
    name: definition.name,
    after_nodes: definition.after_nodes,
    avoid_node_types: [...definition.avoid_node_types],
    rewards: definition.rewards.map((reward) => ({ ...reward })),
    success_outcome: definition.success_outcome,
    failure_outcome: definition.failure_outcome,
  };
}

export function createEventCommitment(
  eventId: string,
  optionId: string,
  origin: { act: number; step: number },
  definition: EventCommitmentDefinition,
): EventCommitmentRecord {
  const errors = validateEventCommitmentDefinition(definition);
  if (errors.length > 0) throw new Error(`Invalid event commitment: ${errors.join('; ')}`);
  if (!eventId.trim() || !optionId.trim()) throw new Error('Event commitment source IDs must be non-empty');
  if (!Number.isInteger(origin.act) || origin.act < 1 || origin.act > 4) {
    throw new Error('Event commitment origin act must be between 1 and 4');
  }
  if (!Number.isInteger(origin.step) || origin.step < 1 || origin.step > 11) {
    throw new Error('Event commitment origin step must be between 1 and 11');
  }
  return {
    eventId,
    optionId,
    originAct: origin.act,
    originStep: origin.step,
    remaining: definition.after_nodes,
    status: 'active',
    snapshot: snapshotDefinition(definition),
    processedNodes: [],
  };
}

function copyRecord(record: EventCommitmentRecord): EventCommitmentRecord {
  return {
    ...record,
    snapshot: snapshotDefinition(record.snapshot),
    processedNodes: [...(record.processedNodes ?? [])],
  };
}

function nodeKey(node: EventCommitmentNode): string {
  return `${node.act}:${node.step}`;
}

function isAfterOrigin(record: EventCommitmentRecord, node: EventCommitmentNode): boolean {
  return node.act > record.originAct || (node.act === record.originAct && node.step > record.originStep);
}

export function advanceEventCommitments(
  records: readonly EventCommitmentRecord[] | undefined,
  node: EventCommitmentNode,
  phase: EventCommitmentNodePhase,
): EventCommitmentAdvance {
  if (!Number.isInteger(node.act) || !Number.isInteger(node.step) || node.step < 1) {
    throw new Error('Event commitment node needs an integer act and positive step');
  }
  if (phase !== 'entered' && phase !== 'completed') throw new Error(`Unknown node phase: ${phase}`);

  const eventCommitments = (records ?? []).map(copyRecord);
  const fulfilled: EventCommitmentRecord[] = [];
  const broken: EventCommitmentRecord[] = [];
  const expired: EventCommitmentRecord[] = [];
  const key = nodeKey(node);

  for (const record of eventCommitments) {
    if (record.status !== 'active' || !isAfterOrigin(record, node)) continue;
    if (phase === 'entered') {
      if (node.type === 'F') {
        record.status = 'expired';
        expired.push(record);
      } else if (record.snapshot.avoid_node_types.includes(node.type as 'R' | 'S')) {
        record.status = 'broken';
        broken.push(record);
      }
      continue;
    }

    if (node.type === 'F') {
      record.status = 'expired';
      expired.push(record);
      continue;
    }
    if (record.snapshot.avoid_node_types.includes(node.type as 'R' | 'S')) {
      record.status = 'broken';
      broken.push(record);
      continue;
    }
    if (record.processedNodes.includes(key)) continue;

    record.processedNodes.push(key);
    record.remaining = Math.max(0, record.remaining - 1);
    if (record.remaining === 0) {
      record.status = 'fulfilled';
      fulfilled.push(record);
    }
  }

  return { eventCommitments, fulfilled, broken, expired };
}
