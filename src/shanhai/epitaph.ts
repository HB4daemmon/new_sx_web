import type { Entity, RunState } from './types.js';

type EpitaphState = Pick<
  RunState,
  | 'phase'
  | 'act'
  | 'step'
  | 'fusionHistory'
  | 'artifacts'
  | 'equipment'
  | 'ownedMethods'
  | 'eventCommitments'
  | 'bloodVow'
  | 'battle'
  | 'battleInput'
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
  if (!isRecord(state) || state.phase !== 'won' || typeof resolveEntity !== 'function') return [];

  const fusionNames = uniqueInOrder(records(state.fusionHistory)
    .filter(record => isAtOrBeforeEnd(record, state))
    .map(record => entityName(record.id, 'artifact', resolveEntity)));

  const equippedIds = new Set(
    isRecord(state.equipment) && Array.isArray(state.equipment.slots)
      ? state.equipment.slots.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      : [],
  );
  const fullStackArtifactNames = uniqueInOrder(records(state.artifacts).flatMap(record => {
    const id = record.id;
    if (typeof id !== 'string' || !equippedIds.has(id) || !Number.isInteger(record.stacks) ||
      (record.stacks as number) < 1) return [];
    const artifact = resolveEntity(id);
    const maxStacks = artifact?.max_stacks;
    if (artifact?.kind !== 'artifact' || !Number.isInteger(maxStacks) ||
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

  const finalBattleContributors = finalBattleDamageLeaders(state);
  const vowLine = state.bloodVow === true ? '背负断生之誓，战外禁疗。' : undefined;
  const craftAndEquipmentLine = [
    withNames('途中合炼出', fusionNames, '件', '，旧器在战火中重铸'),
    withNames('终局仍装备', fullStackArtifactNames, '件', '，皆已满层'),
  ].filter((line): line is string => Boolean(line)).join('；');

  return [
    craftAndEquipmentLine ? `${craftAndEquipmentLine}。` : undefined,
    [
      withNames('身怀', methodNames, '门'),
      vowLine,
    ].filter((line): line is string => Boolean(line)).join('；') || undefined,
    [
      withNames('兑现了', fulfilledCommitmentNames, '项', '留下的约定'),
      withNames('曾引雷战胜', thunderWinNames, '场'),
      finalBattleContributors.length === 1
        ? `终战伤敌最多：${finalBattleContributors[0]}`
        : finalBattleContributors.length > 1
          ? `终战伤敌并列最多：${compactNames(finalBattleContributors, '位')}`
          : undefined,
    ].filter((line): line is string => Boolean(line)).join('；') || undefined,
  ].filter((line): line is string => Boolean(line));
}

/** A final fight highlight is shown only when the complete player build can be checked. */
function finalBattleDamageLeaders(state: EpitaphState): string[] {
  const battle = state.battle;
  const input = state.battleInput;
  if (!isRecord(battle) || battle.outcome !== 'player' || !isRecord(input) ||
    !isRecord(input.player) || !Array.isArray(battle.contributions)) return [];

  const player = input.player;
  if (typeof player.method !== 'string' || !player.method.trim() ||
    !Array.isArray(player.talents) || !Array.isArray(player.artifacts)) return [];

  const sourceIds = new Set<string>([player.method]);
  for (const id of player.talents) {
    if (typeof id !== 'string' || !id.trim()) return [];
    sourceIds.add(id);
  }
  for (const artifact of player.artifacts) {
    if (!isRecord(artifact) || typeof artifact.id !== 'string' || !artifact.id.trim()) return [];
    sourceIds.add(artifact.id);
  }
  if (isRecord(player.permanentRule)) {
    const permanentSourceId = player.permanentRule.kind === 'shattered_core'
      ? 'RE037-A'
      : player.permanentRule.kind === 'blind_sword'
        ? 'RE037-B'
        : player.permanentRule.kind === 'endless_chain'
          ? 'RE037-C'
          : undefined;
    if (permanentSourceId) sourceIds.add(permanentSourceId);
  }
  for (const companion of Array.isArray(player.companions) ? player.companions : []) {
    if (typeof companion === 'string' && companion.trim()) {
      sourceIds.add(`${companion}-COMPANION`);
    }
  }

  const contributions = records(battle.contributions);
  if (contributions.length !== battle.contributions.length) return [];

  const seen = new Set<string>();
  let highestDamage = 0;
  const leaders: string[] = [];
  for (const contribution of contributions) {
    if (typeof contribution.id !== 'string' || !sourceIds.has(contribution.id) ||
      seen.has(contribution.id) || typeof contribution.name !== 'string' || !contribution.name.trim() ||
      typeof contribution.damage !== 'number' || !Number.isFinite(contribution.damage) ||
      contribution.damage < 0) return [];
    seen.add(contribution.id);
    if (contribution.damage > highestDamage) {
      highestDamage = contribution.damage;
      leaders.length = 0;
      leaders.push(contribution.name.trim());
    } else if (contribution.damage > 0 && contribution.damage === highestDamage) {
      leaders.push(contribution.name.trim());
    }
  }

  // Combat registers every player source, including sources that dealt zero damage.
  if (seen.size !== sourceIds.size || highestDamage <= 0) return [];
  return uniqueInOrder(leaders);
}
