import type { Entity, RunState } from './types.js';

type EpitaphState = Pick<
  RunState,
  'phase' | 'act' | 'step' | 'fusionHistory' | 'artifacts' | 'ownedMethods' | 'eventCommitments'
> & { thunderChallenges?: unknown };

type EpitaphEntity = Entity & { max_stacks?: unknown; options?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function entityName(
  id: unknown,
  kind: string,
  resolveEntity: (id: string) => EpitaphEntity | undefined,
): string | undefined {
  if (typeof id !== 'string' || !id.trim()) return undefined;
  const entity = resolveEntity(id);
  const name = typeof entity?.name === 'string' ? entity.name.trim() : '';
  return entity?.kind === kind && name ? name : undefined;
}

function isAtOrBeforeEnd(record: Record<string, unknown>, state: EpitaphState): boolean {
  const act = record.act;
  const step = record.step;
  if (!Number.isInteger(act) || !Number.isInteger(step) ||
    !Number.isInteger(state.act) || !Number.isInteger(state.step)) return false;
  if ((act as number) < 1 || (step as number) < 0 || state.act < 1 || state.step < 0) return false;
  return (act as number) < state.act ||
    ((act as number) === state.act && (step as number) <= state.step);
}

function uniqueInOrder(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function compactNames(names: string[], unit: string): string {
  if (names.length <= 2) return names.join('、');
  return `${names[0]}、${names[1]}等共${names.length}${unit}`;
}

function withNames(prefix: string, names: string[], unit: string, suffix = ''): string | undefined {
  return names.length ? `${prefix}${compactNames(names, unit)}${suffix}` : undefined;
}

/** Builds up to three short, current-run facts for the victory screen. */
export function buildVictoryEpitaph(
  state: EpitaphState,
  resolveEntity: (id: string) => EpitaphEntity | undefined,
): string[] {
  if (state.phase !== 'won') return [];

  const fusionNames = uniqueInOrder(records(state.fusionHistory)
    .filter(record => isAtOrBeforeEnd(record, state))
    .map(record => entityName(record.id, 'artifact', resolveEntity)));

  const fullStackArtifactNames = uniqueInOrder(records(state.artifacts).flatMap(record => {
    const id = record.id;
    if (typeof id !== 'string' || !Number.isInteger(record.stacks) || (record.stacks as number) < 1) return [];
    const artifact = resolveEntity(id);
    const maxStacks = artifact?.max_stacks;
    if (artifact?.kind !== 'artifact' || !isRecord(artifact.awakening) || !Number.isInteger(maxStacks) ||
      (maxStacks as number) < 1 || (record.stacks as number) < (maxStacks as number)) return [];
    const name = typeof artifact.name === 'string' ? artifact.name.trim() : '';
    return name ? [name] : [];
  }));

  const methodNames = uniqueInOrder(Array.isArray(state.ownedMethods)
    ? state.ownedMethods.map(id => entityName(id, 'method', resolveEntity))
    : []);

  const fulfilledCommitmentNames = uniqueInOrder(records(state.eventCommitments)
    .filter(record => record.status === 'fulfilled' && isAtOrBeforeEnd({
      act: record.originAct,
      step: record.originStep,
    }, state))
    .flatMap(record => {
      const name = entityName(record.eventId, 'event', resolveEntity);
      if (!name || typeof record.optionId !== 'string') return [];
      const event = resolveEntity(record.eventId as string);
      const option = records(event?.options).find(item => item.id === record.optionId);
      return option && (isRecord(option.commitment) || isRecord(option.legacy_commitment)) ? [name] : [];
    }));

  const thunderWinNames = uniqueInOrder(records(state.thunderChallenges)
    .filter(record => record.outcome === 'win' && isAtOrBeforeEnd(record, state))
    .map(record => entityName(record.enemyId, 'enemy', resolveEntity)));

  return [
    withNames('途中合炼出', fusionNames, '件', '，旧器在战火中重铸。'),
    [
      withNames('最终持有的', fullStackArtifactNames, '件', '已至满层'),
      withNames('身怀', methodNames, '门'),
    ].filter((line): line is string => Boolean(line)).join('；') || undefined,
    [
      withNames('兑现了', fulfilledCommitmentNames, '项', '留下的约定'),
      withNames('曾引雷战胜', thunderWinNames, '场'),
    ].filter((line): line is string => Boolean(line)).join('；') || undefined,
  ].filter((line): line is string => Boolean(line));
}
