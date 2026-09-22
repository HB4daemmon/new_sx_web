import { loadContent } from './content.js';
import { calculateStats } from './combat.js';
import { ShanhaiGame } from './run.js';
import {
  clearSavedRun,
  loadRun,
  loadWinningBuilds,
  saveRun,
  saveWinningBuild,
} from './persistence.js';
import type {
  ArtifactStack,
  BattleFrame,
  BattleResult,
  Content,
  Entity,
  FighterView,
  Loadout,
  RunCommand,
  RunNode,
  RunPhase,
  RunState,
  Stats,
} from './types.js';
import type { ShanhaiBuildRecord } from './persistence.js';
import { esc, icon, landscape, portrait, sigil } from '../art.js';

const REPLAY_KEY = 'suishi-shanhai-replay-v1';
const CONTENT_BASE = './content/';
const NODE_META: Record<string, { label: string; icon: string; tone: string }> = {
  C: { label: '普通战', icon: 'sword', tone: 'jade' },
  E: { label: '事件', icon: 'eye', tone: 'jade' },
  K: { label: '机缘', icon: 'lotus', tone: 'violet' },
  L: { label: '精英战', icon: 'skull', tone: 'vermilion' },
  S: { label: '坊市', icon: 'coin', tone: 'gold' },
  R: { label: '休整', icon: 'camp', tone: 'jade' },
  B: { label: '首领战', icon: 'gate', tone: 'gold' },
  F: { label: '终战', icon: 'sun', tone: 'vermilion' },
};
const RARITY_LABEL: Record<string, string> = {
  common: '普通',
  rare: '稀有',
  legendary: '传奇',
};
const PHASE_LABEL: Record<string, string> = {
  route: '择路',
  map: '山河图',
  preview: '战前观敌',
  battle: '斗法',
  reward: '战后取舍',
  event: '行旅',
  event_result: '行旅结果',
  shop: '坊市',
  rest: '休整',
  talent: '悟道',
  transition: '幕间',
  won: '通关',
  lost: '退场',
};
const FRAME_KIND_LABEL: Record<string, string> = {
  start: '开场',
  round: '回合',
  action: '动作',
  damage: '伤害',
  dot: '持续伤害',
  heal: '治疗',
  shield: '护盾',
  status: '状态',
  rage: '怒气',
  phase: '昼夜',
  draw: '平局',
  end: '结束',
  summary: '折叠摘要',
};
const FRAME_SOURCE_LABEL: Record<string, string> = {
  'RULES-INCOMING-DIRECT': '受击回怒',
  'RULES-ROUND-END': '轮尾回怒',
  'RULES-RAGE-SETTLE': '轮尾回怒',
  'RULES-RAGE-DRAIN': '削怒',
  'RULES-OPENING-RAGE': '开场回怒',
  'RULES-OPENING-DRAIN': '开场削怒',
  'RR01-BASE-HIT-RAGE-GAIN': '法宝回怒',
  'RR10-DIRECT-CRIT-RAGE': '暴击回怒',
  'RC24-INCOMING-SEGMENT-RAGE': '受击回怒',
};
const STAT_LABEL: Record<string, string> = {
  attack: '攻击',
  defense: '防御',
  max_hp: '气血',
  crit_rate: '暴击',
  speed: '速度',
};
const STATUS_LABEL: Record<string, string> = {
  poison: '中毒',
  burn: '燃烧',
  weakness: '虚弱',
  armor_break: '破甲',
  sword_intent: '剑意',
  charge_luck: '蓄势',
  day_night: '昼夜',
};
const STATUS_ICON: Record<string, string> = {
  poison: 'jade',
  burn: 'flame',
  weakness: 'close',
  armor_break: 'sword',
  sword_intent: 'sword',
  charge_luck: 'pearl',
  day_night: 'sun',
};
const METHOD_ART = ['swordsman', 'hermit', 'guardian', 'nezha', 'sorcerer'];
const ARTIFACT_ICONS = ['jade', 'pearl', 'mirror', 'bell', 'gourd', 'ring', 'seal', 'feather', 'flame'];

type RuntimeGame = ShanhaiGame;

type ModalKind = 'restart' | 'corrupt-save' | 'archives' | 'error' | null;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function listOf<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function pct(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, value / total * 100));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function entityRarity(entity: Entity | undefined): string {
  return asText(entity?.rarity, 'common');
}

function entitySummary(entity: Entity | undefined): string {
  return asText(entity?.summary || entity?.description || entity?.quick, '');
}

function effectText(effect: any): string {
  if (!isRecord(effect)) return asText(effect);
  return asText(effect.text || effect.quick || effect.description || effect.operation, '');
}

function formatNumber(value: unknown, decimals = 0): string {
  const number = asNumber(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(decimals);
}

function formatPercentPoints(value: unknown): string {
  return formatNumber(asNumber(value) * 100, 1);
}

function methodId(loadout: any, entity?: Entity): string {
  return asText(loadout?.method || loadout?.methodId || entity?.method, '');
}

function loadoutArtifacts(loadout: any): ArtifactStack[] {
  const artifacts = listOf<any>(loadout?.artifacts);
  return artifacts.map((item) => ({
    id: asText(item?.id),
    stacks: Math.max(1, asNumber(item?.stacks, 1)),
  })).filter((item) => item.id);
}

function loadoutStats(loadout: any, entity?: Entity): Stats {
  const base = loadout?.baseStats || loadout?.stats || entity?.stats || {
    attack: 0,
    defense: 0,
    max_hp: 0,
    crit_rate: 0,
    speed: 0,
  };
  return {
    attack: asNumber(base.attack),
    defense: asNumber(base.defense),
    max_hp: asNumber(base.max_hp),
    crit_rate: asNumber(base.crit_rate),
    speed: asNumber(base.speed),
  };
}

function integerNumber(value: unknown, fallback = 0): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function nodeMeta(type: string): { label: string; icon: string; tone: string } {
  return NODE_META[type] || { label: type || '未知', icon: 'help', tone: 'muted' };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

class ShanhaiApp {
  private readonly root: HTMLElement;
  private content: Content | null = null;
  private game: RuntimeGame | null = null;
  private selectedMethod = '';
  private playerName = '';
  private seed = '';
  private notice = '';
  private error = '';
  private storageIssue = '';
  private archiveIssue = '';
  private archives: ShanhaiBuildRecord[] = [];
  private modal: ModalKind = null;
  private loading = true;
  private battleCursor = 0;
  private battleSpeed = 1;
  private battlePaused = false;
  private battleFinished = false;
  private battleKey = '';
  private rafId = 0;
  private frameClock = 0;
  private busy = false;
  private preserveDetails = new Set<string>();
  private focusKey = '';
  private restoreScrollTop = 0;
  private scrollToStageTop = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('beforeunload', () => this.stopPlayback());
  }

  async boot(): Promise<void> {
    this.render();
    try {
      this.content = await loadContent(CONTENT_BASE);
      this.selectedMethod = this.startMethods()[0]?.id || '';
      this.loadArchives();
      this.loading = false;
      this.restoreSave();
    } catch (cause) {
      this.loading = false;
      this.error = cause instanceof Error ? cause.message : '山海内容尚未准备好';
      this.render();
    }
  }

  private gameState(): RunState | null {
    if (!this.game) return null;
    return this.game.state;
  }

  private stats(): Stats {
    if (!this.game) return { attack: 0, defense: 0, max_hp: 0, crit_rate: 0, speed: 0 };
    return this.game.stats;
  }

  private currentAct(): Entity {
    const state = this.gameState();
    return this.game?.actContent || this.byId(state ? (state.act === 5 ? 'RF01' : `RA0${state.act}`) : 'RA01') ||
      { id: 'RA01', name: '第一幕', kind: 'act' };
  }

  private entities(kind?: string): Entity[] {
    if (!this.content) return [];
    return this.content.entities.filter((entity) => !kind || entity.kind === kind);
  }

  private byId(id: unknown): Entity | undefined {
    if (!this.content || !id) return undefined;
    return this.content.byId[asText(id)];
  }

  private startMethods(): Entity[] {
    return this.entities('method')
      .filter((method) => {
        const acquisition = method.acquisition;
        return entityRarity(method) === 'common' && (!acquisition || acquisition.start !== false);
      })
      .slice(0, 5);
  }

  private restoreSave(): void {
    if (!this.content) {
      this.render();
      return;
    }
    try {
      const restored = loadRun(this.content);
      if (restored) {
        this.game = restored;
        const restoredState = this.gameStateOf(restored);
        if (!restoredState) throw new Error('存档没有有效状态');
        this.playerName = restoredState.name;
        this.seed = restoredState.seed;
        this.selectedMethod = restoredState.method;
        this.notice = restoredState.phase === 'won'
          ? '上一局已经通关。'
          : '已回到上次未完的山海行。';
      }
    } catch (cause) {
      this.storageIssue = cause instanceof Error ? `存档无法读取：${cause.message}` : '存档无法读取。';
      this.modal = 'corrupt-save';
    }
    this.render();
  }

  private gameStateOf(game: RuntimeGame): RunState | null {
    return game.state;
  }

  private saveRun(): void {
    const state = this.gameState();
    if (!state) return;
    try {
      if (!this.game) return;
      saveRun(this.game);
      this.storageIssue = '';
    } catch {
      this.storageIssue = '自动保存失败。请使用“导出命途”保存当前构筑，关闭页面前不要清理浏览器数据。';
    }
  }

  private send(command: RunCommand): void {
    if (!this.game || this.busy) return;
    this.busy = true;
    this.error = '';
    const beforePhase = this.game.state.phase;
    try {
      this.game.dispatch(command);
      if (this.game.state.phase !== beforePhase) this.scrollToStageTop = true;
      this.acceptDispatchResult();
    } catch (cause) {
      this.failDispatch(cause);
    }
  }

  private acceptDispatchResult(): void {
    this.busy = false;
    const archiveIssue = this.archiveIfWon();
    this.saveRun();
    if (archiveIssue) this.storageIssue = archiveIssue;
    this.loadArchives();
    this.render();
  }

  private archiveIfWon(): string {
    if (this.gameState()?.phase !== 'won' || !this.game) return '';
    try {
      saveWinningBuild(this.game);
      return '';
    } catch (cause) {
      return cause instanceof Error ? `胜局构筑未能归档：${cause.message}` : '胜局构筑未能归档。';
    }
  }

  private loadArchives(): void {
    try {
      this.archives = this.content ? loadWinningBuilds() : [];
      this.archiveIssue = '';
    } catch (cause) {
      this.archives = [];
      this.archiveIssue = cause instanceof Error ? `构筑归档无法读取：${cause.message}` : '构筑归档无法读取。';
    }
  }

  private createRun(force = false): void {
    if (!this.content) return;
    if (this.storageIssue.startsWith('存档无法读取')) {
      this.modal = 'corrupt-save';
      this.render();
      return;
    }
    if (this.game && !force) {
      this.modal = 'restart';
      this.render();
      return;
    }
    const nameInput = this.root.querySelector<HTMLInputElement>('[name="player-name"]');
    const seedInput = this.root.querySelector<HTMLInputElement>('[name="seed"]');
    this.playerName = (nameInput?.value || this.playerName || '无名行者').trim().slice(0, 24);
    this.seed = (seedInput?.value || this.seed || `shanhai-${Date.now().toString(36)}`).trim().slice(0, 48);
    if (!this.selectedMethod) {
      this.error = '请先选择一门开局功法。';
      this.render();
      return;
    }
    try {
      this.game = ShanhaiGame.create(this.content, {
        seed: this.seed,
        name: this.playerName,
        method: this.selectedMethod,
      });
      this.modal = null;
      this.error = '';
      this.notice = '命途已落笔。';
      this.saveRun();
      this.render();
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : '无法开启这局山海行。';
      this.render();
    }
  }

  private restart(): void {
    this.modal = null;
    this.stopPlayback();
    this.game = null;
    this.notice = '';
    this.error = '';
    this.seed = '';
    this.selectedMethod = this.startMethods()[0]?.id || this.selectedMethod;
    try {
      clearSavedRun();
      this.storageIssue = '';
    } catch (cause) {
      this.storageIssue = cause instanceof Error ? `旧命途仍在：${cause.message}` : '旧命途仍在。';
    }
    this.render();
  }

  private nodeForState(): RunNode | undefined {
    const state = this.gameState();
    if (!state) return undefined;
    return state.nodes[state.step];
  }

  private entityForNode(node = this.nodeForState()): Entity | undefined {
    return node ? this.byId(node.id) : undefined;
  }

  private enemyEntity(): Entity | undefined {
    const state = this.gameState();
    const node = this.nodeForState();
    const pending = (state as any)?._pendingEvent;
    const battleEnemy = state?.battleInput?.enemy;
    return (node && ['C', 'L', 'B', 'F'].includes(node.type) ? this.byId(node.id) : undefined) ||
      this.byId(pending?.enemyId) ||
      this.byId((battleEnemy as any)?.id);
  }

  private methodEntity(id: unknown): Entity | undefined {
    return this.byId(id);
  }

  private talentEntity(methodIdValue: unknown, talentId: unknown): Entity | undefined {
    const method = this.methodEntity(methodIdValue);
    return listOf<Entity>(method?.talents).find(talent => talent.id === asText(talentId));
  }

  private sourceLabel(id: unknown): string {
    const source = asText(id);
    if (FRAME_SOURCE_LABEL[source]) return FRAME_SOURCE_LABEL[source];
    const direct = this.byId(source);
    if (direct) return direct.name;
    const methodIdValue = source.match(/^(RKF\d\d)-J\d-[A-C]$/)?.[1];
    if (methodIdValue) return asText(this.talentEntity(methodIdValue, source)?.name, source);
    for (const method of this.entities('method')) {
      const talent = this.talentEntity(method.id, source);
      if (talent) return talent.name;
    }
    return source;
  }

  private artifactEntity(id: unknown): Entity | undefined {
    return this.byId(id);
  }

  private rules(): Record<string, any> {
    return (this.content?.rules || {}) as Record<string, any>;
  }

  private referenceHp(act = asNumber(this.gameState()?.act, 1)): number {
    const values = this.rules().economy?.reference_hp_by_act;
    return asNumber(values?.[Math.max(0, act - 1)], asNumber(this.stats().max_hp));
  }

  private commonPrice(act = asNumber(this.gameState()?.act, 1)): number {
    const values = this.rules().economy?.common_prices_by_act;
    return asNumber(values?.[Math.max(0, act - 1)], 40);
  }

  private nextXpRequirement(n = asNumber(this.gameState()?.n, 0)): number {
    const values = this.rules().cultivation?.requirements;
    return n >= 4 ? 0 : asNumber(values?.[Math.max(0, Math.min(3, n))]);
  }

  private xpThreshold(n = asNumber(this.gameState()?.n, 0)): number {
    const values = this.rules().cultivation?.cumulative;
    return n >= 4 ? asNumber(values?.at(-1), asNumber(this.gameState()?.xp)) :
      asNumber(values?.[Math.max(0, Math.min(3, n))], this.nextXpRequirement(n));
  }

  private realmName(n = asNumber(this.gameState()?.n, 0)): string {
    const names = listOf<string>(this.rules().cultivation?.realm_names);
    return names[n] || `第${n + 1}境`;
  }

  private resolveAmount(effect: any, act = asNumber(this.gameState()?.act, 1), n = asNumber(this.gameState()?.n, 0)): number {
    const amount = asNumber(effect?.amount);
    switch (effect?.basis) {
      case 'reference_hp': return amount * this.referenceHp(act);
      case 'common_price': return amount * this.commonPrice(act);
      case 'next_xp': return amount * this.nextXpRequirement(n);
      case 'flat':
      case undefined:
      default: return amount;
    }
  }

  private formatResolvedAmount(effect: any, resource: string): string {
    const amount = this.resolveAmount(effect);
    const label = resource === 'hp' ? '气血' : resource === 'coins' ? '灵石' : '修为';
    return `${label} ${formatNumber(amount)}`;
  }

  private enemyLoadout(entity?: Entity, source?: any): Loadout {
    const method = asText(source?.method, asText(entity?.method));
    const talents = listOf<any>(source?.talents ?? entity?.talents)
      .map(talent => asText(talent?.id, talent))
      .filter(Boolean);
    const baseStats = source?.baseStats || entity?.stats;
    return {
      name: asText(source?.name, asText(entity?.name, '敌手')),
      method,
      n: integerNumber(source?.n, integerNumber(entity?.n)),
      talents,
      artifacts: loadoutArtifacts(source || entity),
      baseStats: baseStats ? {
        attack: asNumber(baseStats.attack),
        defense: asNumber(baseStats.defense),
        max_hp: asNumber(baseStats.max_hp),
        crit_rate: asNumber(baseStats.crit_rate),
        speed: asNumber(baseStats.speed),
      } : undefined,
      hp: asNumber(source?.hp, asNumber(baseStats?.max_hp)),
      preparation: asNumber(source?.preparation),
    };
  }

  private archiveMarkup(): string {
    if (this.archiveIssue) return `<p class="empty-note">${esc(this.archiveIssue)}</p>`;
    if (!this.archives.length) return '<p class="empty-note">还没有通关构筑。</p>';
    return `<div class="archive-list">${this.archives.slice().reverse().map(record => `<article class="archive-item"><div><span class="eyebrow">${esc(record.savedAt.slice(0, 10))}</span><h3>${esc(record.name)}</h3><p>${esc(asText(this.methodEntity(record.method)?.name, record.method))} · ${esc(this.realmName(record.n))}</p><small>${esc(record.artifacts.map(item => `${asText(this.artifactEntity(item.id)?.name, item.id)} ×${item.stacks}`).join(' · ') || '无持有法宝')}</small></div><button class="button small" data-action="export-archive" data-id="${esc(record.buildId)}">${icon('arrow', 14)}导出</button></article>`).join('')}</div>`;
  }

  private openArchives(): void {
    this.loadArchives();
    this.modal = 'archives';
    this.render();
  }

  private exportArchive(buildId: string): void {
    const record = this.archives.find(item => item.buildId === buildId);
    if (!record) {
      this.error = '找不到这份通关构筑。';
      this.render();
      return;
    }
    this.downloadJson({
      format: 'suishi-shanhai-winning-build-v1',
      exportedAt: new Date().toISOString(),
      build: record,
    }, `shanhai-build-${record.name || record.runId}.json`, '构筑归档已导出。');
  }

  private downloadJson(value: unknown, filename: string, success: string): void {
    try {
      const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      this.notice = success;
      this.error = '';
      this.modal = null;
      this.render();
    } catch {
      this.error = '浏览器不允许下载文件；当前页面仍保留这份记录。';
      this.render();
    }
  }

  private failDispatch(cause: unknown): void {
    this.busy = false;
    this.error = cause instanceof Error ? cause.message : '这一步没有完成，请检查当前状态。';
    this.render();
  }


  private routeObjects(): any[] {
    const act = this.currentAct();
    const fallback = listOf<any>(act.routes);
    const raw = this.game?.availableRoutes() || [];
    const values = raw.length ? raw : fallback;
    return values.map((value) => {
      if (typeof value === 'string') return fallback.find((route) => route?.id === value) || { id: value, name: value };
      return value;
    }).filter((route) => isRecord(route));
  }

  private talentObjects(): Entity[] {
    return this.game?.availableTalents().slice(0, 3) || [];
  }

  private optionAvailability(option: Entity): { available: boolean; reason: string } {
    try {
      const value = this.game?.optionAvailability(option);
      if (!value) return { available: false, reason: '无法检查选项' };
      if (value.available) return value;
      return { ...value, reason: this.optionUnavailableReason(option, value.reason) };
    } catch {
      return { available: false, reason: '条件检查失败' };
    }
  }

  private optionUnavailableReason(option: Entity, reason: string): string {
    const requirements = listOf<any>(option.requirements);
    const artifactRequirement = requirements.find((item) =>
      isRecord(item) && ['capacity', 'owned_artifact'].includes(asText(item.type)) &&
      typeof item.id === 'string',
    );
    const artifactReward = listOf<any>(option.rewards).find((item) =>
      isRecord(item) && item.type === 'artifact' && typeof item.id === 'string',
    );
    const artifactName = (id: unknown): string =>
      asText(this.artifactEntity(id)?.name, asText(id, '法宝'));
    const methodName = (id: unknown): string =>
      asText(this.methodEntity(id)?.name, asText(id, '功法'));
    const requirementFlag = requirements.find((item) =>
      isRecord(item) && item.type === 'flag',
    );
    const costReason = (): string => {
      const state = this.gameState();
      const costs = listOf<any>(option.costs).filter((item) =>
        isRecord(item) && item.type === 'resource',
      );
      if (state && costs.length) {
        const insufficient = costs.find((cost) => {
          const amount = this.resolveAmount(cost);
          if (!Number.isFinite(amount)) return false;
          if (cost.resource === 'coins') return state.coins < amount;
          if (cost.resource === 'xp') return state.xp < amount;
          return cost.resource === 'hp' && cost.must_survive === true && state.hp - amount < 1;
        });
        if (insufficient?.resource === 'coins') return '灵石不足';
        if (insufficient?.resource === 'xp') return '修为不足';
        if (insufficient?.resource === 'hp') return '气血不足';
      }
      const resource = asText(costs[0]?.resource);
      if (resource === 'coins') return '灵石不足';
      if (resource === 'xp') return '修为不足';
      if (resource === 'hp') return '气血不足';
      return '所需资源不足';
    };

    if (reason === 'capacity') {
      return artifactRequirement ? this.artifactUnavailableReason(
        artifactRequirement.id,
        asNumber(artifactRequirement.count, 1),
      ) : '法宝叠层已满';
    }
    if (reason === 'required-artifact-missing') {
      if (!artifactRequirement) return '缺少指定法宝';
      const count = asNumber(artifactRequirement.count, 1);
      return `缺少${artifactName(artifactRequirement.id)}${count > 1 ? ` ×${formatNumber(count)}` : ''}`;
    }
    if (reason === 'cannot-pay') return costReason();
    if (reason === 'method-not-known') {
      const requirement = requirements.find((item) => isRecord(item) && item.type === 'known_method');
      return requirement ? `尚未学会${methodName(requirement.id)}` : '尚未学会所需功法';
    }
    if (reason === 'flag') {
      return requirementFlag && asText(requirementFlag.id).endsWith('-promised')
        ? '前置机缘未完成'
        : '前置条件未满足';
    }
    if (reason === 'artifact-capacity') {
      const id = artifactReward?.id || artifactRequirement?.id;
      const reward = artifactReward || artifactRequirement;
      return id ? this.artifactUnavailableReason(id, asNumber(reward?.count, 1)) : '法宝叠层已满';
    }
    if (reason === 'no-method-to-swap') return '暂无可切换功法';
    if (reason === 'method-pool-exhausted') return '可得功法已全部学会';
    if (reason === 'event-already-settled') return '本事件已结算';
    if (reason === 'not-event-phase') return '当前不可选择';
    if (reason === 'no-event') return '找不到当前事件';
    if (reason === 'unknown-option') return '选项不存在';
    if (reason.startsWith('invalid-') || reason.startsWith('unknown-')) return '选项配置异常';
    return '条件检查失败';
  }

  private artifactUnavailableReason(id: unknown, count: number): string {
    const artifact = this.artifactEntity(id);
    const name = asText(artifact?.name, asText(id, '法宝'));
    const state = this.gameState();
    const current = listOf<ArtifactStack>(state?.artifacts)
      .find((stack) => stack.id === asText(id));
    const maxStacks = asNumber(artifact?.max_stacks, 1);
    if ((current?.stacks ?? 0) + count > maxStacks) return `${name}已达叠层上限`;
    if (artifact?.unique_group && state?.artifacts.some((stack) => {
      if (stack.id === asText(id) || stack.stacks <= 0) return false;
      return this.artifactEntity(stack.id)?.unique_group === artifact.unique_group;
    })) {
      return '同类法宝已占用';
    }
    return `${name}无法收纳`;
  }

  private previewStats(loadout: any, entity?: Entity): Stats {
    if (!this.content) return loadoutStats(loadout, entity);
    return calculateStats(this.content, loadout);
  }

  private saveReplay(): void {
    if (!this.battleKey) return;
    try {
      localStorage.setItem(REPLAY_KEY, JSON.stringify({ key: this.battleKey, cursor: this.battleCursor }));
    } catch {
      // Replay progress is optional; the run save remains authoritative.
    }
  }

  private restoreReplay(key: string, length: number): number {
    try {
      const parsed = JSON.parse(localStorage.getItem(REPLAY_KEY) || 'null') as any;
      if (parsed?.key === key) return clamp(asNumber(parsed.cursor), 0, Math.max(0, length - 1));
    } catch {
      // Ignore malformed replay metadata without touching the run save.
    }
    return 0;
  }

  private battleResult(): BattleResult | undefined {
    return this.gameState()?.battle;
  }

  private ensurePlayback(): void {
    const state = this.gameState();
    const battle = this.battleResult();
    const frames = battle?.frames || [];
    const key = `${asText(state?.id, 'run')}:${asNumber(state?.act)}:${asNumber(state?.step)}:${frames.length}`;
    if (this.battleKey !== key) {
      this.stopPlayback();
      this.battleKey = key;
      this.battleCursor = this.restoreReplay(key, frames.length);
      this.battleFinished = frames.length <= 1 || this.battleCursor >= frames.length - 1;
      this.battlePaused = false;
    }
    if (!this.battleFinished && !this.battlePaused && frames.length > 1 && !this.rafId) {
      this.frameClock = performance.now();
      this.rafId = requestAnimationFrame((time) => this.advancePlayback(time));
    }
  }

  private advancePlayback(time: number): void {
    this.rafId = 0;
    if (!this.gameState() || this.gameState()?.phase !== 'battle' || this.battlePaused || this.battleFinished) return;
    const delay = 920 / this.battleSpeed;
    if (time - this.frameClock >= delay) {
      this.frameClock = time;
      const frames = this.battleResult()?.frames || [];
      this.battleCursor = Math.min(Math.max(0, frames.length - 1), this.battleCursor + 1);
      this.battleFinished = this.battleCursor >= frames.length - 1;
      this.saveReplay();
      this.render();
      return;
    }
    this.rafId = requestAnimationFrame((next) => this.advancePlayback(next));
  }

  private stopPlayback(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private captureUiState(): void {
    this.preserveDetails = new Set(
      Array.from(this.root.querySelectorAll<HTMLDetailsElement>('details[data-details]'))
        .filter(details => details.open)
        .map(details => details.dataset.details || ''),
    );
    const active = document.activeElement as HTMLElement | null;
    this.focusKey = active?.dataset.focusKey || '';
    this.restoreScrollTop = window.scrollY;
  }

  private restoreUiState(): void {
    for (const key of this.preserveDetails) {
      const details = this.root.querySelector<HTMLDetailsElement>(`details[data-details="${CSS.escape(key)}"]`);
      if (details) details.open = true;
    }
    if (this.scrollToStageTop) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      this.scrollToStageTop = false;
    } else if (Number.isFinite(this.restoreScrollTop)) {
      window.scrollTo({ top: this.restoreScrollTop, behavior: 'auto' });
    }
    if (this.focusKey) {
      this.root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(this.focusKey)}"]`)?.focus({ preventScroll: true });
    } else {
      this.root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    }
  }

  private render(): void {
    this.captureUiState();
    if (this.loading) {
      this.root.innerHTML = `<div class="loading-screen">${landscape()}<div class="loading-mark">${sigil('gate', 'gold')}</div><p>山海卷轴载入中</p></div>`;
      return;
    }
    if (this.error && !this.content) {
      this.root.innerHTML = `<main class="fatal-screen" role="alert"><div class="seal">${sigil('close', 'fire')}</div><h1>山海卷无法展开</h1><p>${esc(this.error)}</p><button class="button primary" data-action="retry">${icon('arrow', 16)}重试</button></main>`;
      return;
    }
    if (!this.game) {
      this.stopPlayback();
      this.root.innerHTML = this.renderLanding();
      this.restoreUiState();
      return;
    }
    const state = this.gameState();
    if (!state) {
      this.root.innerHTML = this.renderErrorState('运行时没有可显示的状态。');
      return;
    }
    if (state.phase !== 'battle') this.stopPlayback();
    this.root.innerHTML = this.renderGame(state);
    if (state.phase === 'battle') this.ensurePlayback();
    this.restoreUiState();
  }

  private renderLanding(): string {
    const methods = this.startMethods();
    let hasSaved = false;
    try {
      hasSaved = Boolean(this.storageIssue.startsWith('存档无法读取')) || Boolean(localStorage.getItem('suishi-shanhai-run-v1'));
    } catch {
      hasSaved = Boolean(this.storageIssue.startsWith('存档无法读取'));
    }
    return `<div class="landing-page">
      <div class="landing-atmosphere">${landscape()}</div>
      <header class="landing-bar">
        <div class="brand-lockup"><span class="brand-seal">${icon('mountain', 22)}</span><span><b>随时修仙</b><em>山海行</em></span></div>
        <div class="landing-actions">${this.archiveIssue ? `<span class="status-alert">${icon('help', 14)}${esc(this.archiveIssue)}</span>` : '<span class="status-ok"><i></i>山海行</span>'}<button class="icon-button" data-action="archives" title="历届通关构筑" aria-label="历届通关构筑">${icon('book', 18)}</button></div>
      </header>
      <main class="landing-main">
        <section class="setup-board" aria-labelledby="setup-title">
          <div class="setup-heading"><div><p class="eyebrow">山海行 · 新局</p><h1 id="setup-title">择一门功法</h1></div><span class="setup-index">01 / 01</span></div>
          <div class="setup-fields">
            <label class="field"><span>道号</span><input name="player-name" maxlength="24" value="${esc(this.playerName)}" placeholder="给这一局留个名字" autocomplete="nickname"></label>
            <label class="field"><span>命数种子</span><input name="seed" maxlength="48" value="${esc(this.seed)}" placeholder="可复制、可复现"></label>
            <button class="seed-action" data-action="copy-seed" title="复制命数种子" aria-label="复制命数种子">${icon('mirror', 16)}</button>
          </div>
          <div class="section-label"><span>开局功法</span><small>五门普通功法，先定方向</small></div>
          <div class="method-grid">${methods.map((method, index) => this.methodChoice(method, index)).join('')}</div>
          <div class="method-detail">${this.methodDetail(methods.find((method) => method.id === this.selectedMethod) || methods[0])}</div>
          <div class="setup-footer"><button class="button primary" data-action="start" data-autofocus>入山海 ${icon('arrow', 17)}</button></div>
        </section>
        <section class="landing-intro">
          <p class="eyebrow">随时修仙 · 山海行</p>
          <h2>潮声起，山门开。</h2>
          <p class="landing-tagline">从一门功法起步，沿四幕山河走到终战。</p>
          <div class="landing-principles">
            <span>${icon('mountain', 16)}四幕 · 十一节点</span>
            <span>${icon('jade', 16)}构筑可携 · 选择有代价</span>
          </div>
          ${hasSaved && !this.storageIssue?.startsWith('存档无法读取') ? `<button class="resume-line" data-action="continue"><span><b>继续未完命途</b><small>${esc(asText(this.gameState()?.name, '上一次山海行'))}</small></span>${icon('arrow', 19)}</button>` : ''}
          <div class="landing-archive"><div class="section-label"><span>通关构筑</span><small>${this.archives.length} 份</small></div>${this.archiveMarkup()}</div>
        </section>
      </main>
      ${this.modalMarkup()}
    </div>`;
  }

  private methodChoice(method: Entity, index: number): string {
    const selected = method.id === this.selectedMethod;
    const role = asText(method.role, asText(method.stat_focus?.primary, '修行者'));
    const art = METHOD_ART[index % METHOD_ART.length];
    return `<button class="method-choice ${selected ? 'selected' : ''}" data-action="method" data-id="${esc(method.id)}" aria-pressed="${selected}">
      <span class="method-mark">${sigil(index === 0 ? 'shield' : index === 1 ? 'flame' : index === 2 ? 'wave' : index === 3 ? 'spear' : 'sun', selected ? 'gold' : 'jade')}</span>
      <span class="method-copy"><b>${esc(method.name)}</b><em>${esc(role)}</em><small>${esc(asText(method.summary, entitySummary(method)))}</small></span>
      <span class="method-portrait">${portrait(art)}</span>
    </button>`;
  }

  private methodDetail(method?: Entity): string {
    if (!method) return '<p class="empty-note">暂无开局功法。</p>';
    const basic = method.actions?.basic;
    const rage = method.actions?.rage;
    const travel = listOf<any>(method.travel);
    return `<div class="method-detail-head"><span class="rarity-chip ${entityRarity(method)}">${esc(RARITY_LABEL[entityRarity(method)] || entityRarity(method))}</span><b>${esc(asText(method.name))}</b><span>${esc(asText(method.role, '修行方向'))}</span></div>
      <p>${esc(asText(method.description, entitySummary(method)))}</p>
      <div class="method-actions"><span><b>基础</b>${esc(asText(basic?.name, '基础动作'))}<small>${esc(asText(basic?.quick, '稳定推进'))}</small></span><span><b>怒技</b>${esc(asText(rage?.name, '怒技'))}<small>${esc(asText(rage?.quick, '积攒怒气后释放'))}</small></span><span><b>行旅</b><span class="method-travel-list">${travel.length ? travel.map((effect) => `<small>${esc(asText(effect?.text, '完成节点后兑现门派行旅'))}</small>`).join('') : '<small>完成节点后兑现门派行旅</small>'}</span></span></div>`;
  }

  private renderGame(state: RunState): string {
    const phase = state.phase;
    return `<div class="game-page phase-${esc(phase)}">
      ${this.gameHeader(state)}
      <div class="game-grid">
        <aside class="profile-rail">${this.profileRail(state)}</aside>
        <main class="main-stage">${this.phaseView(state)}${state.phase === 'battle' && state.battle?.outcome === 'draw' ? '<div class="stage-actions"><button class="button quiet" data-action="retire">收手，结束本局</button></div>' : ''}</main>
        <aside class="context-rail">${this.contextRail(state)}</aside>
      </div>
      ${this.modalMarkup()}
    </div>`;
  }

  private gameHeader(state: RunState): string {
    const act = this.currentAct();
    const phase = PHASE_LABEL[state.phase] || state.phase;
    return `<header class="game-header">
      <div class="brand-lockup"><span class="brand-seal">${icon('mountain', 21)}</span><span><b>随时修仙</b><em>山海行</em></span></div>
      <div class="act-progress"><span class="eyebrow">ACT ${String(state.act).padStart(2, '0')}</span><strong>${esc(asText(act.name, `第${state.act}幕`))}</strong><span class="phase-pill">${esc(phase)}</span></div>
      <div class="header-actions">${this.storageIssue ? `<span class="status-alert compact" title="${esc(this.storageIssue)}">${icon('help', 14)}未保存</span>` : `<span class="status-ok compact"><i></i>已保存</span>`}<button class="icon-button" data-action="archives" title="历届通关构筑" aria-label="历届通关构筑">${icon('book', 18)}</button><button class="icon-button" data-action="export" title="导出当前命途" aria-label="导出当前命途">${icon('arrow', 19)}</button><button class="icon-button" data-action="restart" title="重新开始" aria-label="重新开始">${icon('mirror', 19)}</button></div>
    </header>`;
  }

  private profileRail(state: RunState): string {
    const player = this.game?.player || {};
    const stats = this.stats();
    const hp = asNumber((player as any).hp, asNumber(state.hp, stats.max_hp));
    const maxHp = Math.max(1, asNumber(stats.max_hp, asNumber((player as any).baseStats?.max_hp, hp)));
    const artifacts = listOf<ArtifactStack>(state.artifacts);
    const method = this.methodEntity(state.method);
    const xpThreshold = this.xpThreshold(state.n);
    const xpComplete = state.n >= 4;
    const firstStrike = asNumber((state as any).firstStrike);
    const selectedTalents = listOf<string>(state.talents?.[state.method])
      .map((id) => this.talentEntity(state.method, id))
      .filter((value): value is Entity => Boolean(value));
    const actionDetails = [
      { label: '普攻', action: method?.actions?.basic },
      { label: '怒技', action: method?.actions?.rage },
    ].filter((item) => isRecord(item.action));
    return `<section class="profile-panel">
      <div class="profile-portrait">${portrait(this.visualKind(player, method), true)}<span class="portrait-caption"><b>${esc(asText(state.name, '无名行者'))}</b><small>${esc(asText(method?.name, state.method))}</small></span></div>
      <div class="profile-body">
        <div class="vital-row"><span>气血</span><b>${formatNumber(hp)} <i>/ ${formatNumber(maxHp)}</i></b></div><div class="bar hp"><i style="width:${pct(hp, maxHp)}%"></i></div>
        <div class="vital-row muted-row"><span>修为 · ${esc(this.realmName(state.n))}</span><b>${xpComplete ? '圆满' : `${formatNumber(state.xp)} / ${formatNumber(xpThreshold)}`}</b></div><div class="bar xp"><i style="width:${xpComplete ? 100 : pct(asNumber(state.xp), xpThreshold)}%"></i></div>
        <div class="stats-row">${(['attack', 'defense', 'crit_rate', 'speed'] as const).map((key) => `<span><small>${STAT_LABEL[key]}</small><b>${key === 'crit_rate' ? `${Math.round(asNumber(stats[key]) * 100)}%` : formatNumber(stats[key])}</b></span>`).join('')}</div>
        <div class="resource-row"><span>${icon('coin', 15)}灵石</span><b>${formatNumber(state.coins)}</b><span class="prep">${icon('shield', 14)}预备护盾 ${formatNumber(state.preparation)}</span>${firstStrike > 0 ? `<span class="prep first-strike">${icon('sword', 14)}首击 ${formatNumber(firstStrike)}</span>` : ''}</div>
        <div class="method-mini"><span class="eyebrow">CURRENT METHOD</span><b>${esc(asText(method?.name, state.method))}</b><small>${esc(asText(method?.role, '修行方向'))}</small></div>
        <div class="profile-build">
          <div class="profile-talents"><span class="eyebrow">已选天赋</span><div class="profile-talent-list">${selectedTalents.length ? selectedTalents.map((talent) => `<span class="profile-talent" title="${esc(asText(talent.quick, talent.description))}">${esc(asText(talent.name, talent.id))}</span>`).join('') : '<span class="muted">未选天赋</span>'}</div></div>
          <div class="profile-actions"><span class="eyebrow">当前功法动作</span>${actionDetails.map(({ label, action }) => `<div class="profile-action"><b>${esc(label)} · ${esc(asText(action?.name, '动作'))}</b><small>${esc(asText(action?.quick, asText(action?.description, '暂无说明')))}</small></div>`).join('')}</div>
        </div>
      </div>
    </section>
    <section class="inventory-panel"><div class="rail-heading"><span>法宝库存</span><small>${artifacts.length} 类</small></div>${this.inventoryMarkup(artifacts)}</section>`;
  }

  private contextRail(state: RunState): string {
    const act = this.currentAct();
    const story = isRecord(act.story) ? act.story : {};
    const history = listOf<any>(state.history).slice(-3).reverse();
    return `<section class="goal-panel"><p class="eyebrow">ACT ${String(state.act).padStart(2, '0')} / PURPOSE</p><h2>${esc(asText(story.title || act.name, `第${state.act}幕`))}</h2><p>${esc(asText(story.goal || act.summary, entitySummary(act)))}</p><div class="node-count-line"><span>当前进度</span><b>${asNumber(state.step, 0)} / ${listOf(state.nodes).length || 11}</b></div><div class="bar thin"><i style="width:${pct(asNumber(state.step, 0), listOf(state.nodes).length || 11)}%"></i></div></section>
      <section class="history-panel"><div class="rail-heading"><span>行迹</span><small>最近记录</small></div>${history.length ? history.map((item) => `<article><b>${esc(asText(item.title, '山海一刻'))}</b><p>${esc(asText(item.text, ''))}</p></article>`).join('') : '<p class="empty-note">第一笔行迹尚未落下。</p>'}</section>
      `;
  }

  private inventoryMarkup(artifacts: ArtifactStack[]): string {
    if (!artifacts.length) return '<p class="empty-note">尚未收纳法宝。</p>';
    return `<div class="inventory-list">${artifacts.map((stack) => {
      const artifact = this.artifactEntity(stack.id);
      const rarity = entityRarity(artifact);
      return `<div class="inventory-item rarity-${esc(rarity)}"><span class="item-sigil">${sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'shield' : 'jade')}</span><span><b>${esc(asText(artifact?.name, stack.id))}</b><small>${esc(asText(artifact?.summary, entitySummary(artifact)))}</small></span><strong>×${formatNumber(stack.stacks, 0)}</strong></div>`;
    }).join('')}</div>`;
  }

  private phaseView(state: RunState): string {
    switch (state.phase) {
      case 'route': return this.routeView(state);
      case 'map': return this.mapView(state);
      case 'preview': return this.previewView(state);
      case 'battle': return this.battleView(state);
      case 'reward': return this.rewardView(state);
      case 'event':
      case 'event_result': return this.eventView(state);
      case 'shop': return this.shopView(state);
      case 'rest': return this.restView(state);
      case 'talent': return this.talentView(state);
      case 'transition': return this.transitionView(state);
      case 'won':
      case 'lost': return this.endView(state);
      default: return this.renderErrorState(`未知阶段：${asText(state.phase)}`);
    }
  }

  private stageHeading(kicker: string, title: string, description = ''): string {
    return `<div class="stage-heading"><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>`;
  }

  private routeView(state: RunState): string {
    const act = this.currentAct();
    const routes = this.routeObjects().slice(0, 6);
    return `${this.stageHeading(`第${state.act}幕 · 选择路线`, asText(act.name, `第${state.act}幕`), asText(act.story?.goal || act.summary, '六条路线，各有一次完整的取舍。'))}
      <div class="route-intent"><span>${icon('flag', 18)}本幕目标</span><b>${esc(asText(act.story?.goal, act.summary))}</b></div>
      <div class="route-grid">${routes.map((route, index) => this.routeCard(route, index)).join('')}</div>
      ${this.inlineMessage()}`;
  }

  private routeCard(route: any, index: number): string {
    const nodes = listOf<any>(route.nodes);
    const routeId = asText(route.id, `route-${index}`);
    return `<article class="route-card ${index === 0 ? 'route-recommended' : ''}">
      <div class="route-card-head"><span class="route-number">${String(index + 1).padStart(2, '0')}</span><div><h2>${esc(asText(route.name, `路线 ${index + 1}`))}</h2><p>${esc(asText(route.summary, '沿此路前行，节点收益与压力不同。'))}</p></div>${index === 0 ? '<span class="route-tag">稳妥起笔</span>' : ''}</div>
      <div class="node-strip" aria-label="${esc(asText(route.name, '路线'))}节点">${nodes.slice(0, 11).map((node) => { const meta = nodeMeta(asText(node?.type)); return `<span class="node-strip-item tone-${meta.tone}" title="${esc(meta.label)}">${icon(meta.icon, 13)}<small>${esc(asText(node?.type))}</small></span>`; }).join('')}</div>
      <div class="route-card-foot"><span>${nodes.length || 11} 节点 · ${esc(asText(route.count ? Object.entries(route.count).filter(([, value]) => asNumber(value) > 0).map(([key, value]) => `${nodeMeta(key).label} ${value}`).join(' · ') : '收益按节点兑现'))}</span><button class="button small" data-action="route" data-id="${esc(routeId)}">走这条 ${icon('arrow', 14)}</button></div>
    </article>`;
  }

  private mapView(state: RunState): string {
    const act = this.currentAct();
    const nodes = listOf<RunNode>(state.nodes);
    const currentIndex = clamp(asNumber(state.step, 0), 0, Math.max(0, nodes.length - 1));
    return `${this.stageHeading(`第${state.act}幕 · 山河图`, asText(act.name, `第${state.act}幕`), '先看完整一幕，再决定是否踏入眼前这一格。')}
      <div class="map-goal"><span>${icon('flag', 17)}幕目标</span><b>${esc(asText(act.story?.goal, act.summary))}</b></div>
      <section class="map-panel"><div class="map-route-meta"><span>已选路线</span><b>${esc(this.routeName(state))}</b><span class="map-step">${Math.max(0, currentIndex) + 1} / ${nodes.length || 11}</span></div>
        <div class="map-list">${nodes.map((node, index) => this.mapNode(node, index, index === currentIndex, index < currentIndex)).join('')}</div>
      </section>
      ${this.inlineMessage()}`;
  }

  private routeName(state: RunState): string {
    const routeId = listOf<string>(state.routes).at(-1) || (state as any).route;
    const route = this.routeObjects().find((item) => item.id === routeId);
    return asText(route?.name, asText(routeId, '未命名路线'));
  }

  private mapNode(node: RunNode, index: number, current: boolean, done: boolean): string {
    const meta = nodeMeta(node.type);
    const entity = this.byId(node.id);
    const label = asText(entity?.name, meta.label);
    const actionable = current && !node.completed;
    return `<div class="map-row ${current ? 'current' : ''} ${done || node.completed ? 'done' : ''} ${index === 0 ? 'first' : ''}">
      <div class="map-index">${String(index + 1).padStart(2, '0')}</div><div class="map-connector"></div><div class="map-node-symbol tone-${meta.tone}">${icon(meta.icon, 19)}</div><div class="map-node-copy"><strong>${esc(label)}</strong><span>${esc(meta.label)}${entity?.summary ? ` · ${esc(asText(entity.summary))}` : ''}</span></div>${actionable ? `<button class="button small map-enter" data-action="enter" data-autofocus>查看此格 ${icon('arrow', 14)}</button>` : done ? '<span class="node-state">已行</span>' : '<span class="node-state">前路</span>'}</div>`;
  }

  private previewView(state: RunState): string {
    const node = this.nodeForState();
    const enemy = this.enemyEntity();
    const input = (state as any).battleInput || {};
    const enemyLoadout = this.enemyLoadout(enemy, input.enemy);
    const method = this.methodEntity(methodId(enemyLoadout, enemy));
    const enemyStats = this.previewStats(enemyLoadout, enemy);
    const player = this.game?.player || {};
    const playerStats = this.stats();
    const profile = asText(enemy?.tier, node?.type === 'B' ? 'boss' : node?.type === 'L' ? 'elite' : 'normal');
    const committedEvent = Boolean((state as any)._pendingEvent);
    return `${this.stageHeading(`战前预览 · ${profile === 'boss' ? '首领' : profile === 'elite' ? '精英' : '普通'}`, asText(enemy?.name, '未知敌手'), asText(enemy?.preview || enemy?.description, '先看压力与反制，再决定是否出手。'))}
      <section class="preview-arena"><div class="preview-side player-side">${portrait(this.visualKind(player, this.methodEntity(state.method)), true)}<div><span class="eyebrow">YOUR LOADOUT</span><h2>${esc(asText(state.name, '行者'))}</h2><div class="preview-stat-line">${this.previewStatsLine(playerStats)}</div></div></div><div class="versus-seal">${sigil('swords', 'gold')}<span>VS</span></div><div class="preview-side enemy-side">${portrait(this.visualKind(enemyLoadout, enemy), true)}<div><span class="eyebrow">${esc(profile.toUpperCase())}</span><h2>${esc(asText(enemy?.name, enemyLoadout.name || '敌手'))}</h2><div class="preview-stat-line">${this.previewStatsLine(enemyStats)}</div></div></div></section>
      <section class="preview-details"><div class="preview-column"><div class="detail-heading"><span>对手功法</span><b>${esc(asText(method?.name, methodId(enemyLoadout, enemy)))}</b></div><p>${esc(asText(method?.summary || method?.description, '先看它的路数，再决定如何应对。'))}</p><div class="loadout-row"><span>天赋</span><div>${listOf<string>(enemyLoadout.talents).map((talent) => { const item = this.talentEntity(enemyLoadout.method, talent); return `<span class="mini-chip">${esc(asText(item?.name, talent))}</span>`; }).join('') || '<span class="muted">未登记天赋</span>'}</div></div><div class="loadout-row"><span>法宝</span><div>${loadoutArtifacts(enemyLoadout).map((stack) => this.artifactChip(stack)).join('') || '<span class="muted">未登记法宝</span>'}</div></div><div class="loadout-row"><span>战力</span><div>${this.previewStatsLine(enemyStats)}</div></div></div><div class="preview-column pressure-column"><div class="detail-heading"><span>压力与反制</span><b>${esc(asText(enemy?.reward_profile, 'C'))} 级收益</b></div><div class="tag-row">${listOf<any>(enemy?.pressure).map((value) => `<span class="pressure-tag">${esc(asText(value))}</span>`).join('') || '<span class="muted">暂无标签</span>'}</div><ul class="counterplay-list">${listOf<any>(enemy?.counterplay).map((value) => `<li>${esc(asText(value))}</li>`).join('') || '<li>先观察其怒气，再安排护盾和输出的顺序。</li>'}</ul></div></section>
      ${this.inlineMessage()}<div class="stage-actions">${committedEvent ? '<span class="playback-hint">这场机缘已经承诺，战斗不可回避。</span>' : `<button class="button quiet" data-action="back">${icon('arrow', 16)}返回地图</button>`}<button class="button primary" data-action="fight" data-autofocus>开始斗法 ${icon('sword', 16)}</button></div>`;
  }

  private previewStatsLine(stats: Stats): string {
    return `<span>攻 <b>${formatNumber(stats.attack)}</b></span><span>防 <b>${formatNumber(stats.defense)}</b></span><span>气 <b>${formatNumber(stats.max_hp)}</b></span><span>速 <b>${formatNumber(stats.speed)}</b></span>`;
  }

  private artifactChip(stack: ArtifactStack): string {
    const item = this.artifactEntity(stack.id);
    return `<span class="artifact-chip"><b>${esc(asText(item?.name, stack.id))}</b><small>×${formatNumber(stack.stacks)}</small></span>`;
  }

  private battleView(state: RunState): string {
    const result = this.battleResult();
    const frames = result?.frames || [];
    const frame = frames[Math.min(this.battleCursor, Math.max(0, frames.length - 1))];
    if (!frame) {
      return `${this.stageHeading('斗法载入', '双方蓄势')}<div class="empty-state">${icon('help', 34)}<p>暂无战斗记录。</p><button class="button" data-action="continue-battle">继续</button></div>`;
    }
    const frameKind = FRAME_KIND_LABEL[asText(frame.kind)] || '战斗';
    const damageFrame = frame.kind === 'damage' || frame.kind === 'dot';
    const positiveFrame = frame.kind === 'heal' || frame.kind === 'shield';
    const amountClass = damageFrame ? 'damage' : positiveFrame ? 'gain' : 'neutral';
    const amountPrefix = damageFrame ? '-' : positiveFrame ? '+' : '';
    const canContinue = result?.outcome === 'draw' && asNumber(state.battleInput?.roundLimit) < 4096;
    return `${this.stageHeading(`斗法 · ${this.battleFinished ? '结算帧' : `第 ${frame.round} 回合`}`, this.battleFinished ? (result?.outcome === 'player' ? '此战告捷' : '战局已定') : asText(frame.text, '气机交锋'))}
      <section class="arena-panel"><div class="arena-topline"><span>${this.battleFinished ? 'REPLAY COMPLETE' : `FRAME ${this.battleCursor + 1} / ${frames.length}`}</span><span data-frame-kind="${esc(asText(frame.kind))}">${esc(frameKind)}${frame.actor ? ` · ${frame.actor === 'player' ? '行者' : '敌手'}出手` : ''}</span></div><div class="battle-arena">${landscape()}<div class="arena-vignette"></div>${this.fighterMarkup(frame.player, 'player', frame.actor === 'player') }<div class="arena-center"><span class="round-emblem">${this.battleFinished ? (result?.outcome === 'player' ? '胜' : '劫') : frame.round}</span><b>${esc(asText(frame.text, '双方试探'))}</b>${frame.source ? `<small>${esc(this.sourceLabel(frame.source))}</small>` : ''}${frame.amount !== undefined ? `<strong class="${amountClass}" data-amount-kind="${esc(asText(frame.kind))}">${amountPrefix}${formatNumber(frame.amount)}</strong>` : ''}</div>${this.fighterMarkup(frame.enemy, 'enemy', frame.actor === 'enemy')}</div></section>
      <div class="playback-controls"><div class="playback-group"><button class="icon-button" data-action="battle-speed" data-speed="1" data-focus-key="battle-speed-1" aria-pressed="${this.battleSpeed === 1}" title="一倍速">1×</button><button class="icon-button" data-action="battle-speed" data-speed="2" data-focus-key="battle-speed-2" aria-pressed="${this.battleSpeed === 2}" title="二倍速">2×</button><button class="icon-button" data-action="battle-speed" data-speed="4" data-focus-key="battle-speed-4" aria-pressed="${this.battleSpeed === 4}" title="四倍速">4×</button><button class="icon-button" data-action="battle-pause" data-focus-key="battle-pause" aria-pressed="${this.battlePaused}" title="${this.battlePaused ? '继续播放' : '暂停播放'}">${icon(this.battlePaused ? 'arrow' : 'sound', 16)}</button><button class="icon-button" data-action="battle-skip" data-focus-key="battle-skip" title="跳到结算">${icon('arrow', 16)}</button></div><span class="replay-progress"><i style="width:${pct(this.battleCursor, Math.max(1, frames.length - 1))}%"></i></span>${this.battleFinished ? result?.outcome === 'draw' ? `<button class="button primary small" data-action="continue-battle" data-autofocus ${canContinue ? '' : 'disabled'} title="${canContinue ? '继续推演' : '已达 4096 轮上限，请收手'}">${canContinue ? '继续战斗' : '已达 4096 轮上限'} ${icon('arrow', 15)}</button>` : `<button class="button primary small" data-action="battle-finish" data-autofocus>${result?.outcome === 'player' ? '收下战果' : '回望此局'} ${icon('arrow', 15)}</button>` : ''}</div>
      <details class="battle-log-disclosure" data-details="battle-diagnostics" ${this.battleFinished && result?.outcome !== 'draw' ? 'open' : ''}><summary>详细战报与诊断</summary><div class="battle-log">${frames.slice(0, this.battleCursor + 1).slice(-12).map((item) => `<p><span>第${item.round}回合</span><b>${esc(item.text)}</b>${item.amount !== undefined ? `<em>${formatNumber(item.amount)}</em>` : ''}</p>`).join('')}</div>${this.battleDiagnostics(result)}</details>${this.inlineMessage()}`;
  }

  private fighterMarkup(fighter: FighterView, side: 'player' | 'enemy', acting: boolean): string {
    const status = fighter.statuses || {};
    const art = side === 'player' ? this.visualKind(this.game?.player, this.methodEntity(this.gameState()?.method)) : this.visualKind((this.gameState() as any)?.battleInput?.enemy, this.enemyEntity());
    const method = this.methodEntity(fighter.method);
    const statusMarkup = Object.entries(status)
      .filter(([key, value]) => asNumber(value) > 0 && !(key === 'day_night' && fighter.method !== 'RKF10'))
      .map(([key, value]) => {
        const label = STATUS_LABEL[key] || key;
        const display = key === 'day_night' ? (asNumber(value) === 2 ? '昼' : '夜') : formatNumber(value);
        return `<span title="${esc(label)}">${icon(STATUS_ICON[key] || 'star', 11)}${esc(label)} ${display}</span>`;
      }).join('') || '<span class="muted">无战斗状态</span>';
    const locked = fighter.lockedAction ? [fighter.lockedAction] : [];
    const lockedMarkup = locked.length ? `<div class="locked-actions"><span>锁定</span>${locked.map(action => `<b>${esc(this.actionLabel(fighter.method, action))}</b>`).join('')}</div>` : '';
    return `<article class="fighter ${side} ${acting ? 'acting' : ''}"><div class="fighter-art">${portrait(art, true)}<span class="fighter-side">${side === 'player' ? '行者' : '敌手'}</span></div><div class="fighter-name"><h2>${esc(asText(fighter.name, side === 'player' ? '行者' : '敌手'))}</h2><small>${esc(asText(method?.name, fighter.method))}</small></div><div class="fighter-vitals"><div class="vital-row"><span>气血</span><b>${formatNumber(fighter.hp)} / ${formatNumber(fighter.maxHp)}</b></div><div class="bar hp"><i style="width:${pct(fighter.hp, fighter.maxHp)}%"></i></div><div class="vital-row"><span>${icon('shield', 12)}护盾</span><b>${formatNumber(fighter.shield)}</b></div><div class="bar shield"><i style="width:${pct(fighter.shield, fighter.maxHp)}%"></i></div><div class="vital-row"><span>怒气</span><b>${formatNumber(fighter.rage)} / ${formatNumber(fighter.rageCap)}</b></div><div class="bar rage"><i style="width:${pct(fighter.rage, fighter.rageCap)}%"></i></div></div><div class="status-row">${statusMarkup}</div>${lockedMarkup}</article>`;
  }

  private actionLabel(methodIdValue: unknown, action: any): string {
    const id = asText(action?.id, action);
    const method = this.methodEntity(methodIdValue);
    const actions = [method?.actions?.basic, method?.actions?.rage];
    const found = actions.find(item => item?.id === id || item?.name === id);
    return asText(found?.name, id === 'rage_action' ? method?.actions.rage.name : id === 'basic_action' ? method?.actions.basic.name : id || '动作');
  }

  private battleDiagnostics(result?: BattleResult): string {
    if (!result) return '';
    const contributions = listOf<any>(result.contributions);
    const active = contributions.filter((item) => asNumber(item.triggers) > 0).sort((a, b) =>
      (asNumber(b.damage) + asNumber(b.healing) + asNumber(b.shield) + asNumber(b.rage)) -
      (asNumber(a.damage) + asNumber(a.healing) + asNumber(a.shield) + asNumber(a.rage)),
    ).slice(0, 8);
    const zero = contributions.filter((item) => asNumber(item.triggers) === 0);
    const summary = (item: any): string => [
      asNumber(item.damage) > 0 ? `${formatNumber(item.damage)} 伤害` : '',
      asNumber(item.healing) > 0 ? `${formatNumber(item.healing)} 治疗` : '',
      asNumber(item.shield) > 0 ? `${formatNumber(item.shield)} 护盾` : '',
      asNumber(item.rage) > 0 ? `${formatNumber(item.rage)} 怒气` : '',
      `${formatNumber(item.triggers)} 次触发`,
    ].filter(Boolean).join(' · ');
    return `<div class="diagnostics"><div><span class="eyebrow">本局贡献</span>${active.length ? active.map((item) => `<p><b>${esc(asText(item.name, item.id))}</b><span>${summary(item)}</span></p>`).join('') : '<p class="muted">暂无触发来源</p>'}</div><div><span class="eyebrow">未触发</span>${zero.length ? zero.map((item) => `<p><b>${esc(asText(item.name, item.id))}</b><span>${esc(this.contributionReason(item))}</span></p>`).join('') : '<p class="muted">没有未触发记录</p>'}</div></div>`;
  }

  private contributionReason(item: any): string {
    const artifact = this.artifactEntity(item?.id);
    const attributes = isRecord(artifact?.attributes) ? artifact.attributes : {};
    const hasAttributes = Object.values(isRecord(attributes.flat) ? attributes.flat : {}).some((value) => asNumber(value) !== 0) ||
      Object.values(isRecord(attributes.percent) ? attributes.percent : {}).some((value) => asNumber(value) !== 0);
    const effects = listOf<any>(artifact?.effects);
    if (artifact && hasAttributes && effects.length === 0) return '属性已生效';
    const reason = asText(item?.reason);
    return ({
      'conditional trigger absent': '本局未满足触发条件',
      'permanent attributes applied': '属性已生效',
      'permanent attributes applied; conditional effect not triggered': '属性已生效；条件效果未触发',
      'passive modifier not used': '被动修正本局未用到',
    } as Record<string, string>)[reason] || (reason || '本局未满足触发条件');
  }

  private rewardView(state: RunState): string {
    const candidates = unique(listOf<string>((state as any).rewardCandidates || (state as any).rewards || [])).slice(0, 3);
    return `${this.stageHeading('战后取舍', '收一件法宝', '奖励只在这一步兑现；选中的法宝会进入库存并保留叠层。')}
      <div class="reward-grid">${candidates.map((id) => this.rewardCard(id)).join('') || '<p class="empty-note">本节点没有候选法宝。</p>'}</div>
      <div class="stage-actions"><button class="button quiet" data-action="reward" data-id="">舍下法宝，领取 ${formatNumber(asNumber(this.rules().economy?.artifact_decline_coins, 4))} 灵石 ${icon('coin', 15)}</button></div>${this.inlineMessage()}`;
  }

  private rewardCard(id: string): string {
    const artifact = this.artifactEntity(id);
    const rarity = entityRarity(artifact);
    const owned = listOf<ArtifactStack>(this.gameState()?.artifacts).find((stack) => stack.id === id);
    const attributes = isRecord(artifact?.attributes) ? artifact.attributes : {};
    const flat = isRecord(attributes.flat) ? attributes.flat : {};
    const percent = isRecord(attributes.percent) ? attributes.percent : {};
    const effects = listOf<any>(artifact?.effects);
    return `<button class="reward-card rarity-${esc(rarity)}" data-action="reward" data-id="${esc(id)}"><div class="reward-card-top"><span class="rarity-chip ${esc(rarity)}">${esc(RARITY_LABEL[rarity] || rarity)}</span>${owned ? `<span class="stack-note">已有 ×${formatNumber(owned.stacks)} · 叠加后 ×${formatNumber(owned.stacks + 1)}</span>` : '<span class="stack-note">新入库</span>'}</div>${sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'shield' : 'jade')}<h2>${esc(asText(artifact?.name, id))}</h2><p>${esc(entitySummary(artifact))}</p><div class="attribute-list">${Object.entries(flat).map(([key, value]) => `<span>${esc(STAT_LABEL[key] || key)} <b>+${key === 'crit_rate' ? `${formatPercentPoints(value)}%` : formatNumber(value)}</b></span>`).join('')}${Object.entries(percent).map(([key, value]) => `<span>${esc(STAT_LABEL[key] || key)} <b>+${formatPercentPoints(value)}%</b></span>`).join('')}</div><div class="effect-list">${effects.slice(0, 3).map((effect) => `<p>${esc(effectText(effect))}</p>`).join('') || '<p class="muted">没有额外触发效果</p>'}</div><span class="reward-link">纳入当前构筑 ${icon('arrow', 14)}</span></button>`;
  }

  private eventView(state: RunState): string {
    const event = this.currentEvent();
    if (!event) return this.renderErrorState('找不到当前事件内容。');
    const resultPhase = state.phase === 'event_result';
    const options = listOf<Entity>(event.options);
    return `${this.stageHeading(`${event.event_type === 'core' ? '人物机缘' : '行旅事件'}`, asText(event.name, '山海一刻'), asText(event.scene || event.description, '在此停步，做一个明白的选择。'))}
      <section class="event-scene"><div class="event-art">${portrait(this.visualKind(event, event), true)}</div><div class="event-copy"><span class="eyebrow">${esc(event.event_type === 'core' ? 'CORE ENCOUNTER' : 'ORDINARY EVENT')}</span><p>${esc(asText(event.scene || event.description, '风声停在你面前。'))}</p>${resultPhase ? `<div class="event-outcome"><span class="eyebrow">SETTLEMENT</span><p>${esc(asText(state.resultText, '选择已经落定。'))}</p></div>` : `<div class="event-options">${options.map((option) => this.eventOption(option)).join('')}</div>`}</div></section>
      ${resultPhase ? `<div class="stage-actions"><button class="button primary" data-action="continue" data-autofocus>继续前行 ${icon('arrow', 16)}</button></div>` : ''}${this.inlineMessage()}`;
  }

  private currentEvent(): Entity | undefined {
    const state = this.gameState();
    const node = this.nodeForState();
    const ids = [
      (state as any)?.eventId,
      (state as any)?.currentEventId,
      (state as any)?.eventOption,
      node?.id,
    ];
    for (const id of ids) {
      const entity = this.byId(id);
      if (entity?.kind === 'event') return entity;
    }
    return this.entities('event').find((event) => listOf<number>(event.acts).includes(asNumber(state?.act))) || this.entities('event')[0];
  }

  private eventOption(option: Entity): string {
    const check = this.optionAvailability(option);
    const costs = listOf<any>(option.costs);
    const rewards = listOf<any>(option.rewards);
    return `<button class="event-option ${check.available ? '' : 'disabled'}" data-action="event" data-id="${esc(option.id)}" ${check.available ? '' : 'disabled'}><span class="event-option-main"><b>${esc(asText(option.label, option.name))}</b><small>${esc(asText(option.quick || option.description, ''))}</small>${costs.length ? `<span class="event-costs">${costs.map((cost) => `<i>${esc(this.effectLabel(cost, true))}</i>`).join('')}</span>` : ''}${rewards.length ? `<span class="event-rewards">${rewards.map((reward) => `<i>${esc(this.effectLabel(reward, false))}</i>`).join('')}</span>` : ''}${!check.available ? `<em class="disabled-reason">${esc(check.reason || '当前条件不满足')}</em>` : ''}</span>${icon(check.available ? 'arrow' : 'close', 18)}</button>`;
  }

  private effectLabel(effect: any, cost: boolean): string {
    if (!isRecord(effect)) return asText(effect);
    if (effect.type === 'resource') {
      const resource = effect.resource === 'hp' ? '气血' : effect.resource === 'coins' ? '灵石' : '修为';
      return `${cost ? '-' : '+'}${this.formatResolvedAmount(effect, resource)}`;
    }
    if (effect.type === 'artifact') return `${cost ? '失去' : '获得'}法宝 ${asText(this.artifactEntity(effect.id)?.name, effect.id)}${asNumber(effect.count, 1) > 1 ? ` ×${formatNumber(effect.count)}` : ''}`;
    if (effect.type === 'method') return `${cost ? '失去' : '获得'}功法 ${asText(this.methodEntity(effect.id)?.name, effect.id)}`;
    if (effect.type === 'preparation') return `${cost ? '消耗' : '准备'}下一战护盾 ${formatNumber(this.resolveAmount(effect))}`;
    return `${cost ? '消耗' : '获得'} ${asText(effect.type, '机缘')}`;
  }

  private shopView(state: RunState): string {
    const items = listOf<any>(state.shop);
    return `${this.stageHeading('有限坊市', '云游坊市', '三件法宝与两项服务，一次访问，不刷新库存。')}<div class="shop-balance"><span>${icon('coin', 18)}当前灵石 <b>${formatNumber(state.coins)}</b></span><span>库存 ${items.filter((item) => !item.sold).length} / ${items.length || 5}</span></div>
      <div class="shop-grid">${items.map((item) => this.shopItem(item)).join('') || '<p class="empty-note">坊市没有可展示的库存。</p>'}</div><div class="stage-actions"><button class="button primary" data-action="leave-shop" data-autofocus>离开坊市 ${icon('arrow', 16)}</button></div>${this.inlineMessage()}`;
  }

  private shopItem(item: any): string {
    const artifact = this.artifactEntity(item.id);
    const kind = asText(item.kind, artifact ? 'artifact' : 'service');
    const price = asNumber(item.price);
    const sold = Boolean(item.sold);
    const state = this.gameState();
    const preparationHeld = kind === 'preparation' && asNumber(state?.preparation) > 0;
    const canBuy = !sold && asNumber(state?.coins) >= price && !preparationHeld;
    const label = artifact ? asText(artifact.name, item.id) : kind === 'recovery' ? '回春调息' : '护体准备';
    const amount = kind === 'recovery' ? 0.12 * this.referenceHp() : kind === 'preparation' ? 0.10 * this.referenceHp() : 0;
    const description = artifact ? entitySummary(artifact) : kind === 'recovery' ? `恢复 ${formatNumber(amount)} 气血。` : `为下一场战斗准备 ${formatNumber(amount)} 护盾。`;
    const disabledReason = sold ? '' : preparationHeld ? `已有 ${formatNumber(state?.preparation)} 预备护盾` : asNumber(state?.coins) < price ? '灵石不足' : '';
    return `<article class="shop-item ${sold ? 'sold' : ''} ${artifact ? `rarity-${esc(entityRarity(artifact))}` : 'service-item'}"><div class="shop-item-art">${sigil(artifact ? this.artifactIcon(artifact) : kind === 'recovery' ? 'gourd' : 'shield', artifact ? 'jade' : 'shield')}</div><div class="shop-item-copy"><span class="rarity-chip ${artifact ? esc(entityRarity(artifact)) : ''}">${artifact ? esc(RARITY_LABEL[entityRarity(artifact)] || entityRarity(artifact)) : '服务'}</span><h2>${esc(label)}</h2><p>${esc(description)}</p></div>${sold ? '<span class="sold-stamp">售罄</span>' : `<button class="button small" data-action="buy" data-id="${esc(asText(item.id))}" title="${esc(disabledReason)}" ${canBuy ? '' : 'disabled'}>${icon('coin', 13)}${formatNumber(price)}</button>`}</article>`;
  }

  private restView(state: RunState): string {
    const methods = listOf<string>(state.ownedMethods).map((id) => this.methodEntity(id)).filter((value): value is Entity => Boolean(value));
    const currentMethod = this.methodEntity(state.method);
    const fromEvent = Boolean((state as any)._restFromEvent);
    const healAmount = asNumber(this.rules().economy?.rest_heal_ratio, 0.25) * this.referenceHp();
    const prepAmount = 0.1 * this.referenceHp();
    const swapDisabled = methods.length <= 1;
    const swapList = methods.length > 1
      ? `<div class="method-swap-list"><span class="eyebrow">可切换功法</span>${methods.map((method) => `<button class="method-swap ${method.id === state.method ? 'current' : ''}" data-action="rest-method" data-id="${esc(method.id)}" ${method.id === state.method ? 'disabled' : ''}><b>${esc(method.name)}</b><small>${esc(asText(method.role, method.summary))}</small></button>`).join('')}</div>`
      : '';
    const choices = fromEvent
      ? `<div class="rest-event-note">这份机缘只留下换法的机会。</div>${swapList}`
      : `<div class="rest-grid"><button class="rest-choice" data-action="rest" data-choice="heal"><span>${sigil('gourd', 'shield')}</span><b>调息</b><p>恢复 ${formatNumber(healAmount)} 气血，不增加怒气。</p><small>占用本次休整</small></button><button class="rest-choice" data-action="rest" data-choice="preparation" ${state.preparation > 0 ? 'disabled' : ''}><span>${sigil('shield', 'jade')}</span><b>备战</b><p>为下一场战斗准备 ${formatNumber(prepAmount)} 护盾。</p><small>${state.preparation > 0 ? `已有 ${formatNumber(state.preparation)} 护盾` : '占用本次休整'}</small></button><button class="rest-choice" data-action="rest" data-choice="swap_method" ${swapDisabled ? 'disabled' : ''}><span>${sigil('book', 'gold')}</span><b>换法</b><p>${swapDisabled ? '还没有第二门已拥有的功法。' : '切换已拥有的功法，天赋各自保留。'}</p><small>${swapDisabled ? '暂不可用' : '先选换法，再点一门功法'}</small></button></div>${swapList}`;
    return `${this.stageHeading('节点休整', '山中一息', fromEvent ? '风停在山腰，换一门功法再走。' : '三项选择互相排斥，按眼前的气血与构筑取舍。')}
      <section class="rest-summary"><div><span>当前气血</span><b>${formatNumber((this.game?.player as any)?.hp, 0)} / ${formatNumber(this.stats().max_hp)}</b></div><div><span>预备护盾</span><b>${formatNumber(state.preparation)}</b></div><div><span>当前功法</span><b>${esc(asText(currentMethod?.name, state.method))}</b></div></section>
      ${choices}${this.inlineMessage()}`;
  }

  private talentView(state: RunState): string {
    const talents = this.talentObjects();
    return `${this.stageHeading('修为突破', '一念悟道', '三项天赋，取其一。')}<div class="talent-grid">${talents.map((talent) => `<button class="talent-card" data-action="talent" data-id="${esc(talent.id)}"><span class="talent-tier">第 ${asNumber(talent.tier, 1)} 层 · ${esc(asText(talent.branch, 'A'))}</span><h2>${esc(asText(talent.name, talent.id))}</h2><b>${esc(asText(talent.quick, '选择一项长期强化'))}</b><p>${esc(listOf<any>(talent.effects).map(effectText).join(' ') || asText(talent.description, ''))}</p><span class="talent-select">悟得此法 ${icon('arrow', 14)}</span></button>`).join('') || '<p class="empty-note">暂无可用天赋。</p>'}</div>${this.inlineMessage()}`;
  }

  private transitionView(state: RunState): string {
    const act = this.currentAct();
    const story = isRecord(act.story) ? act.story : {};
    return `${this.stageHeading('幕间', asText(story.title || act.name, `第${state.act}幕`), '潮声换了方向，下一幕的目标已经浮出水面。')}<section class="transition-scene">${landscape()}<div><span class="eyebrow">PASSAGE</span><p>${esc(asText(story.passage || story.boss_after || act.description, '你踏上下一段山海路。'))}</p></div></section><div class="stage-actions"><button class="button primary" data-action="continue" data-autofocus>进入下一幕 ${icon('arrow', 16)}</button></div>${this.inlineMessage()}`;
  }

  private endView(state: RunState): string {
    const win = state.phase === 'won';
    const result = state.battle;
    const artifacts = listOf<ArtifactStack>(state.artifacts);
    return `${this.stageHeading(win ? '山海行完成' : '此局止步', win ? '你写下了自己的道' : '这一次，山海先记住你', win ? '终战的结算已经完成，构筑与行迹都可以导出。' : asText(state.resultText, '失败不会抹去这一局做过的选择。'))}
      <section class="end-seal ${win ? 'win' : 'loss'}">${sigil(win ? 'sun' : 'moon', win ? 'gold' : 'fire')}<b>${win ? '通关' : '退场'}</b><span>${esc(asText(state.name, '无名行者'))} · 命数 ${esc(asText(state.seed))}</span></section>
      <div class="end-summary"><div><span>行过节点</span><b>${state.history.length}</b></div><div><span>修为</span><b>${formatNumber(state.xp)}</b></div><div><span>灵石</span><b>${formatNumber(state.coins)}</b></div><div><span>法宝</span><b>${artifacts.reduce((total, item) => total + asNumber(item.stacks, 1), 0)}</b></div></div>
      ${result ? `<details class="end-diagnostics" data-details="end-diagnostics" open><summary>最终斗法诊断</summary>${this.battleDiagnostics(result)}</details>` : ''}<div class="stage-actions"><button class="button primary" data-action="export">${icon('arrow', 16)}导出命途记录</button><button class="button quiet" data-action="archives">查看通关构筑</button><button class="button quiet" data-action="new-run">重新起笔</button></div>${this.inlineMessage()}`;
  }

  private renderErrorState(message: string): string {
    return `<section class="inline-error" role="alert"><span>${icon('close', 22)}</span><div><b>这一页暂时无法展开</b><p>${esc(message)}</p></div><button class="button small" data-action="back">返回 ${icon('arrow', 14)}</button></section>`;
  }

  private inlineMessage(): string {
    const message = this.error || this.notice || this.storageIssue;
    if (!message) return '';
    return `<div class="${this.error ? 'inline-error' : 'inline-notice'}" role="${this.error ? 'alert' : 'status'}">${icon(this.error ? 'close' : 'check', 16)}<span>${esc(message)}</span></div>`;
  }

  private modalMarkup(): string {
    if (!this.modal) return '';
    if (this.modal === 'archives') {
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">山海行 · 归档</p><h2 id="dialog-title">通关构筑</h2><p>这里保存每一局真正走到终点的功法、天赋与法宝。</p>${this.archiveMarkup()}<div class="dialog-actions"><button class="button primary" data-action="modal-close">返回</button></div></section></div>`;
    }
    const title = this.modal === 'restart' ? '重新起笔？' : this.modal === 'corrupt-save' ? '存档没有被覆盖' : '山海行提示';
    const body = this.modal === 'restart'
      ? '当前命途还没有结束。确认重新开始会用新命途替换自动存档。'
      : this.modal === 'corrupt-save'
        ? `${this.storageIssue || '自动存档无法通过校验。'} 你可以导出当前可见记录，或明确开始一局新的命途。`
        : this.error || '发生了一个未命名问题。';
    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">SHANHAI NOTICE</p><h2 id="dialog-title">${esc(title)}</h2><p>${esc(body)}</p><div class="dialog-actions">${this.modal === 'restart' ? `<button class="button quiet" data-action="modal-close">先不重来</button><button class="button danger" data-action="confirm-restart">确认重开</button>` : this.modal === 'corrupt-save' ? `<button class="button quiet" data-action="discard-save">清理损坏存档</button><button class="button primary" data-action="modal-close">我知道了</button>` : `<button class="button primary" data-action="modal-close">知道了</button>`}</div></section></div>`;
  }

  private visualKind(value: any, entity?: Entity): string {
    const text = `${asText(value?.portrait)} ${asText(value?.art)} ${asText(entity?.name)} ${listOf<any>(entity?.tags).join(' ')} ${asText(entity?.id)}`.toLowerCase();
    if (/fox|狐|魅/.test(text)) return 'fox';
    if (/golem|鼋|石|岩/.test(text)) return 'golem';
    if (/nezha|哪吒|火/.test(text)) return 'nezha';
    if (/peacock|孔雀/.test(text)) return 'peacock';
    if (/guardian|守|卫/.test(text)) return 'guardian';
    if (/demon|妖|魔|boss|首领/.test(text)) return 'demon';
    if (/swords|剑|斩/.test(text)) return 'swordsman';
    if (/sorcer|法|术/.test(text)) return 'sorcerer';
    return entity?.kind === 'enemy' ? 'guardian' : 'hermit';
  }

  private artifactIcon(artifact?: Entity): string {
    const text = `${asText(artifact?.name)} ${asText(artifact?.summary)} ${listOf<any>(artifact?.tags).join(' ')}`.toLowerCase();
    if (/盾|护|shield|防/.test(text)) return 'shield';
    if (/火|燃|sun|日/.test(text)) return 'flame';
    if (/气|怒|珠|rage/.test(text)) return 'pearl';
    if (/疗|药|回春|heal/.test(text)) return 'gourd';
    if (/速|风|羽|speed/.test(text)) return 'feather';
    return ARTIFACT_ICONS[Math.abs(asText(artifact?.id).split('').reduce((n, char) => n + char.charCodeAt(0), 0)) % ARTIFACT_ICONS.length];
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (!target) return;
    if (target.name === 'player-name') this.playerName = target.value;
    if (target.name === 'seed') this.seed = target.value;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.modal) {
      this.modal = null;
      this.render();
    }
  }

  private onClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || target.hasAttribute('disabled')) return;
    const action = target.dataset.action;
    if (!action) return;
    event.preventDefault();
    this.notice = '';
    switch (action) {
      case 'retry':
        this.loading = true;
        this.error = '';
        void this.boot();
        break;
      case 'method':
        this.selectedMethod = asText(target.dataset.id);
        this.render();
        break;
      case 'shuffle-seed':
        this.seed = `shanhai-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999).toString(36)}`;
        this.render();
        break;
      case 'start':
        this.createRun();
        break;
      case 'continue':
        if (this.game && ['event_result', 'transition'].includes(this.game.state.phase)) this.send({ type: 'continue' });
        else if (this.game) this.render();
        else this.restoreSave();
        break;
      case 'retire':
        if (window.confirm('结束这场僵持，并结束本局行旅？')) {
          this.stopPlayback();
          this.send({ type: 'retire' });
        }
        break;
      case 'restart':
        this.modal = 'restart';
        this.render();
        break;
      case 'confirm-restart':
        this.restart();
        break;
      case 'discard-save':
        try {
          clearSavedRun();
          this.storageIssue = '';
        } catch {
          this.storageIssue = '浏览器拒绝删除损坏存档，请在浏览器设置中手动清理。';
        }
        this.modal = null;
        this.render();
        break;
      case 'archives':
        this.openArchives();
        break;
      case 'export-archive':
        this.exportArchive(asText(target.dataset.id));
        break;
      case 'modal-close':
      case 'modal-backdrop':
        if (action === 'modal-backdrop' && event.target !== target) return;
        this.modal = null;
        this.render();
        break;
      case 'route':
        this.send({ type: 'route', id: asText(target.dataset.id) });
        break;
      case 'enter':
        this.send({ type: 'enter' });
        break;
      case 'back':
        this.send({ type: 'back' });
        break;
      case 'fight':
        this.send({ type: 'fight' });
        break;
      case 'battle-speed':
        this.battleSpeed = asNumber(target.dataset.speed, 1);
        this.render();
        break;
      case 'battle-pause':
        this.battlePaused = !this.battlePaused;
        this.render();
        break;
      case 'battle-skip':
        this.stopPlayback();
        this.battleCursor = Math.max(0, (this.battleResult()?.frames.length || 1) - 1);
        this.battleFinished = true;
        this.saveReplay();
        this.render();
        break;
      case 'battle-finish':
        this.stopPlayback();
        this.send({ type: 'battle_done' });
        break;
      case 'continue-battle':
        this.send({ type: 'continue_battle' });
        break;
      case 'reward':
        this.send({ type: 'reward', id: target.dataset.id || null });
        break;
      case 'event':
        this.send({ type: 'event', id: asText(target.dataset.id) });
        break;
      case 'buy':
        this.send({ type: 'buy', id: asText(target.dataset.id) });
        break;
      case 'leave-shop':
        this.send({ type: 'leave_shop' });
        break;
      case 'rest':
        if (target.dataset.choice === 'swap_method') {
          this.notice = '请在下方选择一门已拥有的功法。';
          this.render();
          break;
        }
        this.send({ type: 'rest', choice: (target.dataset.choice || 'heal') as 'heal' | 'preparation' | 'swap_method' });
        break;
      case 'rest-method':
        this.send({ type: 'rest', choice: 'swap_method', method: asText(target.dataset.id) });
        break;
      case 'talent':
        this.send({ type: 'talent', id: asText(target.dataset.id) });
        break;
      case 'new-run':
        this.game = null;
        this.modal = null;
        this.seed = '';
        this.selectedMethod = this.startMethods()[0]?.id || this.selectedMethod;
        try {
          clearSavedRun();
          this.storageIssue = '';
        } catch {
          this.storageIssue = '上一局仍保存在浏览器中，请确认后再开始新局。';
        }
        this.render();
        break;
      case 'export':
        this.exportRun();
        break;
      case 'copy-seed':
        void this.copySeed();
        break;
      case 'download':
        this.exportRun();
        break;
      default:
        this.error = '这一步暂时无法完成。';
        this.render();
        break;
    }
  }

  private async copySeed(): Promise<void> {
    const value = asText(this.gameState()?.seed, this.seed);
    try {
      await navigator.clipboard.writeText(value);
      this.notice = '命数种子已复制。';
    } catch {
      this.notice = `命数种子：${value}`;
    }
    this.render();
  }

  private exportRun(): void {
    const state = this.gameState();
    if (!state) {
      this.error = '当前没有可导出的命途。';
      this.render();
      return;
    }
    const record = {
      format: 'suishi-shanhai-run-v1',
      exportedAt: new Date().toISOString(),
      contentVersion: this.content?.version,
      state: structuredClone(state),
      player: this.game ? structuredClone(this.game.player) : undefined,
      stats: this.stats(),
      method: this.methodEntity(state.method)?.id,
      artifacts: listOf<ArtifactStack>(state.artifacts).map((stack) => ({ ...stack })),
    };
    const archiveIssue = this.archiveIfWon();
    if (archiveIssue) this.storageIssue = archiveIssue;
    this.downloadJson(record, `shanhai-${asText(state.seed, 'run')}.json`, '命途记录已导出。');
  }
}

const root = document.querySelector<HTMLElement>('#shanhai-app') || document.querySelector<HTMLElement>('shanhai-game');
if (root) {
  const app = new ShanhaiApp(root);
  void app.boot();
}
