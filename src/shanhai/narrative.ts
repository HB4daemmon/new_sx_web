import type { Content, Entity, RunState } from './types.js';

type EventOutcome = 'success' | 'failure';

interface NarrativeHistoryEntry {
  act: number;
  step: number;
  title: string;
  text: string;
  eventId?: string;
  optionId?: string;
  eventOutcome?: EventOutcome;
}

interface NarrativeCommitmentRecord {
  eventId: string;
  optionId: string;
  originAct: number;
  originStep: number;
  status: string;
  resultText?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function historyEntries(state: RunState): NarrativeHistoryEntry[] {
  return Array.isArray(state.history)
    ? state.history as unknown as NarrativeHistoryEntry[]
    : [];
}

function eventEntity(content: Content, id: string): Entity | undefined {
  const entity = content.byId[id];
  return entity?.kind === 'event' ? entity : undefined;
}

function selectedOption(content: Content, entry: NarrativeHistoryEntry): Entity | undefined {
  if (typeof entry.eventId !== 'string' || typeof entry.optionId !== 'string') return undefined;
  const event = eventEntity(content, entry.eventId);
  if (!event || !Array.isArray(event.options)) return undefined;
  return event.options.find((option: Entity) => option.id === entry.optionId);
}

function optionEcho(entry: NarrativeHistoryEntry, option: Entity): string | undefined {
  if (isRecord(option.encounter)) {
    if (entry.eventOutcome === 'success') {
      return typeof option.story_echo === 'string' && option.story_echo.trim()
        ? option.story_echo
        : undefined;
    }
    if (entry.eventOutcome === 'failure') {
      return typeof option.story_failure_echo === 'string' && option.story_failure_echo.trim()
        ? option.story_failure_echo
        : undefined;
    }
    return undefined;
  }

  return typeof option.story_echo === 'string' && option.story_echo.trim()
    ? option.story_echo
    : undefined;
}

function commitmentResult(
  state: RunState,
  entry: NarrativeHistoryEntry,
  option: Entity,
): string | undefined {
  if (!isRecord(option.commitment) || !Array.isArray(state.eventCommitments)) return undefined;
  const record = (state.eventCommitments as NarrativeCommitmentRecord[]).find(item =>
    item.eventId === entry.eventId &&
    item.optionId === entry.optionId &&
    item.originAct === entry.act &&
    item.originStep === entry.step + 1 &&
    (item.status === 'fulfilled' || item.status === 'broken') &&
    typeof item.resultText === 'string' &&
    item.resultText.trim(),
  );
  return record?.resultText;
}

function setTrueFlags(option: Entity): string[] {
  if (!isRecord(option.set_flags)) return [];
  return Object.entries(option.set_flags)
    .filter(([, value]) => value === true)
    .map(([id]) => id);
}

function expectedPromiseFlags(event: Entity): Set<string> {
  const flags = new Set<string>();
  if (!Array.isArray(event.options)) return flags;
  for (const option of event.options as Entity[]) {
    for (const id of setTrueFlags(option)) flags.add(id);
  }
  return flags;
}

function followUpDeadline(content: Content, encounterIds: string[]): number | undefined {
  let deadline: number | undefined;
  for (const id of encounterIds.slice(1)) {
    const acts = content.byId[id]?.acts;
    if (!Array.isArray(acts)) continue;
    for (const act of acts) {
      if (Number.isInteger(act)) deadline = Math.max(deadline ?? act, act);
    }
  }
  return deadline;
}

function journeyStatus(
  content: Content,
  state: RunState,
  encounterIds: string[],
  initialEntry: NarrativeHistoryEntry | undefined,
  initialOption: Entity | undefined,
  followUpEntry: NarrativeHistoryEntry | undefined,
  followUpOption: Entity | undefined,
): { status: string; note?: string } {
  if (followUpEntry && followUpOption) {
    if (isRecord(followUpOption.encounter)) {
      if (followUpEntry.eventOutcome === 'success') return { status: '回访完成' };
      if (followUpEntry.eventOutcome === 'failure') return { status: '试炼失手' };
      return { status: '回访结果不明', note: '回访试炼结果没有明确记录。' };
    }
    if (!Array.isArray(followUpOption.rewards) || !followUpOption.rewards.length) {
      return { status: '回访止步' };
    }
    return { status: Array.isArray(followUpOption.costs) && followUpOption.costs.length
      ? '回访交易' : '回访取助' };
  }

  if (!initialEntry || !initialOption) return { status: '行迹已记录' };

  const event = eventEntity(content, encounterIds[0] ?? '');
  const promisedFlags = event ? expectedPromiseFlags(event) : new Set<string>();
  const selectedFlags = setTrueFlags(initialOption).filter(id => promisedFlags.has(id));
  const initialEncounter = isRecord(initialOption.encounter);
  if (initialEncounter && initialEntry.eventOutcome === undefined) {
    return { status: '初遇结果不明', note: '初遇试炼结果没有明确记录。' };
  }
  if (selectedFlags.length > 0) {
    if (initialEncounter && initialEntry.eventOutcome === 'failure') {
      return { status: '试炼失手' };
    }
    const confirmed = selectedFlags.some(id => state.flags?.[id] === true);
    if (!confirmed) {
      if (initialEncounter && initialEntry.eventOutcome === undefined) {
        return { status: '初遇结果不明', note: '初遇试炼结果没有明确记录。' };
      }
      return { status: '约定状态不明', note: '初遇选项有记录，但约定状态没有明确凭据。' };
    }
    const deadline = followUpDeadline(content, encounterIds);
    if (deadline !== undefined && Number.isInteger(state.act) && state.act > deadline) {
      return { status: '未遇回访' };
    }
    if (state.phase === 'lost' || state.phase === 'won') return { status: '未竟之约' };
    return { status: '待回访' };
  }

  return { status: '未应约' };
}

export function eventEchoes(
  content: Content,
  state: RunState,
  act?: number,
  limit = 3,
): Array<{ id: string; title: string; text: string }> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const count = Math.floor(limit);
  if (count <= 0) return [];

  const echoes: Array<{ id: string; title: string; text: string }> = [];
  for (const entry of historyEntries(state)) {
    if (act !== undefined && entry.act !== act) continue;
    const option = selectedOption(content, entry);
    if (!option) continue;
    const echo = optionEcho(entry, option);
    if (!echo) continue;

    const result = commitmentResult(state, entry, option);
    const event = eventEntity(content, entry.eventId!);
    echoes.push({
      id: entry.eventId!,
      title: typeof event?.name === 'string' ? event.name : entry.eventId!,
      text: result ? `${echo} 后来，${result}` : echo,
    });
  }
  return echoes.slice(-count);
}

export function characterJourneys(
  content: Content,
  state: RunState,
): Array<{ id: string; name: string; status: string; text: string }> {
  const history = historyEntries(state);
  const journeys: Array<{ id: string; name: string; status: string; text: string }> = [];

  for (const line of content.entities.filter(entity => entity.kind === 'storyline')) {
    const encounterIds = Array.isArray(line.encounters)
      ? line.encounters.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    if (encounterIds.length === 0) continue;
    const encounterSet = new Set(encounterIds);
    const records = history.filter(entry =>
      typeof entry.eventId === 'string' &&
      typeof entry.optionId === 'string' &&
      encounterSet.has(entry.eventId) &&
      selectedOption(content, entry) !== undefined,
    );
    if (records.length === 0) continue;

    const initialEntry = records.find(entry => entry.eventId === encounterIds[0]);
    const followUpEntry = records.find(entry => encounterIds.slice(1).includes(entry.eventId ?? ''));
    const initialOption = initialEntry ? selectedOption(content, initialEntry) : undefined;
    const followUpOption = followUpEntry ? selectedOption(content, followUpEntry) : undefined;
    const result = journeyStatus(
      content,
      state,
      encounterIds,
      initialEntry,
      initialOption,
      followUpEntry,
      followUpOption,
    );
    const echoes = records
      .map(entry => {
        const option = selectedOption(content, entry);
        return option ? optionEcho(entry, option) : undefined;
      })
      .filter((text): text is string => Boolean(text));
    const text = [...echoes, result.note].filter((part): part is string => Boolean(part)).join(' ');

    journeys.push({
      id: line.id,
      name: typeof line.character === 'string' ? line.character : line.name,
      status: result.status,
      text,
    });
  }

  return journeys;
}
