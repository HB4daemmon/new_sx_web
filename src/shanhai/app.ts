import { loadContent } from './content.js';
import { calculateStats } from './combat.js';
import { battleBeatDuration, battlePresentationCue } from './battle-presentation.js';
import { ShanhaiGame } from './run.js';
import {
  localizeBattleText,
  localizeBranch,
  localizeError,
  localizeReason,
  localizeSourceId,
  localizeStatus,
  localizeTier,
  localizeVisibleText,
} from './localization.js';
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
  RouteMapNode,
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

type ModalKind =
  | 'restart'
  | 'corrupt-save'
  | 'archives'
  | 'node-preview'
  | 'settings'
  | 'character'
  | 'artifact'
  | 'talent'
  | 'method'
  | 'help'
  | 'error'
  | null;

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

function rarityLabel(value: unknown): string {
  const rarity = asText(value).toLowerCase();
  return RARITY_LABEL[rarity] || '普通';
}

function statLabel(value: string): string {
  return STAT_LABEL[value] || localizeVisibleText(value) || '属性';
}

function entitySummary(entity: Entity | undefined): string {
  return asText(entity?.summary || entity?.description || entity?.quick, '');
}

function effectText(effect: any, format: (value: unknown) => string = localizeVisibleText): string {
  if (!isRecord(effect)) return format(asText(effect));
  return format(asText(effect.text || effect.quick || effect.description || effect.operation, ''));
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
  return NODE_META[type] || { label: '未知节点', icon: 'help', tone: 'muted' };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

class ShanhaiApp {
  private readonly root: HTMLElement;
  private content: Content | null = null;
  private game: RuntimeGame | null = null;
  private view: 'journey' | 'build' | 'karma' = 'journey';
  private selectedMethod = '';
  private playerName = '';
  private seed = '';
  private notice = '';
  private error = '';
  private storageIssue = '';
  private archiveIssue = '';
  private archives: ShanhaiBuildRecord[] = [];
  private modal: ModalKind = null;
  private modalId = '';
  private modalMethodId = '';
  private buildFilter: 'owned' | 'all' = 'owned';
  private buildRarityFilter: 'all' | 'common' | 'rare' | 'legendary' = 'all';
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
  private focusSelector = '';
  private focusReturn = '';
  private battleLogTop = 0;
  private battleLogFollow = true;
  private battleLogKey = '';
  private detailedLog = false;
  private mapScrollTop = 0;
  private mapScrollKey = '';
  private renderedModal: ModalKind = null;
  private logScrollElement: HTMLElement | null = null;
  private restoreScrollTop = 0;
  private scrollToStageTop = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('resize', () => {
      const map = this.root.querySelector<HTMLElement>('.map-scroll');
      if (!map) return;
      this.fitMapScroller(map);
      this.mapScrollTop = map.scrollTop;
      this.mapScrollKey = map.dataset.mapKey || this.mapScrollKey;
    }, { passive: true });
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
      this.error = localizeError(cause instanceof Error ? cause.message : '', '山海内容尚未准备好。');
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

  private displayText(value: unknown, fallback = ''): string {
    return localizeVisibleText(asText(value, fallback), (source) => {
      const direct = this.byId(source);
      if (direct) return asText(direct.name);
      const talentPrefix = source.match(/^(RKF\d\d-J\d-[A-C])(?:-|$)/)?.[1];
      const talentMethod = talentPrefix?.slice(0, 5);
      const talent = talentMethod && this.talentEntity(talentMethod, talentPrefix);
      return talent ? asText(talent.name) : this.sourceLabel(source);
    });
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
        this.scrollToStageTop = true;
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
      this.storageIssue = `存档无法读取：${localizeError(cause instanceof Error ? cause.message : '', '存档内容无法校验。')}`;
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
      return `胜局构筑未能归档：${localizeError(cause instanceof Error ? cause.message : '', '存储空间不可用。')}`;
    }
  }

  private loadArchives(): void {
    try {
      this.archives = this.content ? loadWinningBuilds() : [];
      this.archiveIssue = '';
    } catch (cause) {
      this.archives = [];
      this.archiveIssue = `构筑归档无法读取：${localizeError(cause instanceof Error ? cause.message : '', '存档内容无法校验。')}`;
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
    this.seed = (seedInput?.value || this.seed || String(Date.now())).trim().slice(0, 48);
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
      this.scrollToStageTop = true;
      this.saveRun();
      this.render();
    } catch (cause) {
      this.error = localizeError(cause instanceof Error ? cause.message : '', '无法开启这局山海行。');
      this.render();
    }
  }

  private restart(): void {
    this.modal = null;
    this.modalId = '';
    this.view = 'journey';
    this.stopPlayback();
    this.scrollToStageTop = true;
    this.game = null;
    this.notice = '';
    this.error = '';
    this.seed = '';
    this.selectedMethod = this.startMethods()[0]?.id || this.selectedMethod;
    try {
      clearSavedRun();
      this.storageIssue = '';
    } catch (cause) {
      this.storageIssue = cause instanceof Error ? `旧命途仍在：${localizeError(cause.message)}` : '旧命途仍在。';
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

  private talentButton(
    talent: Entity,
    methodIdValue: unknown,
    className = 'profile-talent',
    label?: string,
  ): string {
    const name = asText(talent.name, '未名天赋');
    return `<button type="button" class="${esc(className)}" data-action="inspect-talent" data-id="${esc(talent.id)}" data-method="${esc(asText(methodIdValue))}" aria-label="查看${esc(name)}详录" aria-haspopup="dialog">${esc(label || name)}</button>`;
  }

  private talentDetailMarkup(talent: Entity, methodIdValue: unknown): string {
    const methodName = asText(this.methodEntity(methodIdValue)?.name, '当前功法');
    const effects = listOf<any>(talent.effects)
      .map((effect) => this.displayText(effectText(effect, (value) => this.displayText(value))))
      .filter(Boolean);
    return `<p class="eyebrow">${esc(methodName)} · 第 ${formatNumber(talent.tier, 1)} 层 · ${esc(localizeBranch(talent.branch))}分支</p>
      <p>${esc(this.displayText(asText(talent.description, asText(talent.quick, '长久修行所得'))))}</p>
      <div class="effect-list" aria-label="完整效果">${effects.map((effect) => `<p>${esc(effect)}</p>`).join('') || `<p>${esc(this.displayText(asText(talent.quick, '暂无额外效果说明。')))}</p>`}</div>`;
  }

  private sourceLabel(id: unknown): string {
    const source = asText(id);
    if (FRAME_SOURCE_LABEL[source]) return FRAME_SOURCE_LABEL[source];
    const direct = this.byId(source);
    if (direct) return direct.name;
    const talentPrefix = source.match(/^(RKF\d\d-J\d-[A-C])(?:-|$)/)?.[1];
    const talentMethodId = talentPrefix?.slice(0, 5);
    if (talentMethodId && talentPrefix) {
      const talent = this.talentEntity(talentMethodId, talentPrefix);
      if (talent) return asText(talent.name);
    }
    for (const method of this.entities('method')) {
      const talent = this.talentEntity(method.id, source);
      if (talent) return talent.name;
      const effectMethodId = source.match(/^(RKF\d\d)-/)?.[1];
      if (effectMethodId === method.id) {
        if (source.includes('-BASIC-')) return `${asText(method.actions?.basic?.name, '普攻')}效果`;
        if (source.includes('-RAGE-')) return `${asText(method.actions?.rage?.name, '怒技')}效果`;
        return `${asText(method.name)}效果`;
      }
    }
    const artifactEffectId = source.match(/^(RC\d\d|RR\d\d|RL\d\d)-/)?.[1];
    if (artifactEffectId) {
      const artifact = this.artifactEntity(artifactEffectId);
      if (artifact) return `${asText(artifact.name)}效果`;
    }
    const localized = localizeSourceId(source);
    return localized === '斗法规则' ? '天道助力' : localized;
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
    return `${resource} ${formatNumber(amount)}`;
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
    this.error = localizeError(cause instanceof Error ? cause.message : '', '这一步没有完成，请检查当前状态。');
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
    if (reason.startsWith('invalid-') || reason.startsWith('unknown-')) return '当前无法选择';
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

  private battleIdentity(state = this.gameState(), battle = this.battleResult()): string {
    return [
      asText(state?.id, 'run'),
      asNumber(state?.act),
      asNumber(state?.step),
      battle?.frames.length || 0,
    ].join(':');
  }

  private mapIdentity(state = this.gameState()): string {
    if (!state || state.phase !== 'map') return '';
    return [
      asText(state.id, 'run'),
      asNumber(state.act),
      asNumber(state.step),
      asText((state as any)._routeId || (state as any).route || listOf<string>(state.routes).at(-1)),
      state.nodes.map((node) => `${node.id}:${node.completed ? 1 : 0}`).join(','),
      listOf<string>((state as any).routeMap?.path).join(','),
    ].join(':');
  }

  private playbackEligible(): boolean {
    return this.view === 'journey' && this.gameState()?.phase === 'battle' && !this.modal;
  }

  private syncBattleState(): void {
    const state = this.gameState();
    const battle = this.battleResult();
    const frames = battle?.frames || [];
    const key = this.battleIdentity(state, battle);
    if (!key || this.battleKey === key) return;
    this.stopPlayback();
    this.battleKey = key;
    this.battleCursor = this.restoreReplay(key, frames.length);
    this.battleFinished = frames.length <= 1 || this.battleCursor >= frames.length - 1;
    this.battleLogTop = 0;
    this.battleLogFollow = true;
    this.battleLogKey = key;
    this.battlePaused = false;
  }

  private ensurePlayback(): void {
    const state = this.gameState();
    const battle = this.battleResult();
    const frames = battle?.frames || [];
    this.syncBattleState();
    if (this.playbackEligible() && !this.battleFinished && !this.battlePaused && frames.length > 1 && !this.rafId) {
      this.frameClock = performance.now();
      this.rafId = requestAnimationFrame((time) => this.advancePlayback(time));
    }
  }

  private advancePlayback(time: number): void {
    this.rafId = 0;
    if (!this.playbackEligible() || this.battlePaused || this.battleFinished) return;
    const frames = this.battleResult()?.frames || [];
    const nextCursor = Math.min(Math.max(0, frames.length - 1), this.battleCursor + 1);
    const delay = battleBeatDuration(frames[this.battleCursor] || frames[nextCursor], this.battleSpeed);
    if (time - this.frameClock >= delay) {
      this.frameClock = time;
      this.battleCursor = nextCursor;
      this.battleFinished = this.battleCursor >= frames.length - 1;
      this.saveReplay();
      const state = this.gameState();
      if (state && this.canRenderBattleInPlace(state)) {
        this.updateBattlePresentation(true);
        this.ensurePlayback();
      } else {
        this.render();
      }
      return;
    }
    this.rafId = requestAnimationFrame((next) => this.advancePlayback(next));
  }

  private stopPlayback(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private isAtLogEnd(log: HTMLElement): boolean {
    return log.scrollHeight - log.clientHeight - log.scrollTop < 32;
  }

  private focusSelectorFor(element: HTMLElement): string {
    const action = element.dataset.action;
    if (!action) return '';
    const selector = [`[data-action="${CSS.escape(action)}"]`];
    for (const key of ['id', 'method', 'filter', 'speed', 'choice', 'index'] as const) {
      const value = element.dataset[key];
      if (value !== undefined) selector.push(`[data-${key}="${CSS.escape(value)}"]`);
    }
    const scopes = ['modal', 'main-stage', 'player-rail', 'topbar', 'bottom-nav', 'landing-page'];
    const region = element.closest<HTMLElement>(scopes.map(scope => `.${scope}`).join(','));
    const scope = scopes.find(name => region?.classList.contains(name));
    return `${scope ? `.${scope} ` : ''}${selector.join('')}`;
  }

  private focusTarget(selector: string): HTMLElement | undefined {
    return Array.from(this.root.querySelectorAll<HTMLElement>(selector))
      .find((target) => {
        if (target.hasAttribute('disabled') || target.closest('[inert]') || !target.getClientRects().length) return false;
        for (let parent = target.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open &&
            !parent.querySelector(':scope > summary')?.contains(target)) return false;
        }
        return getComputedStyle(target).visibility === 'visible';
      });
  }

  private focusModal(): void {
    const modal = this.root.querySelector<HTMLElement>('.modal[role="dialog"]');
    if (!modal) return;
    const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    (modal.querySelector<HTMLElement>('[data-autofocus]') || focusable[0])?.focus({ preventScroll: true });
  }

  private syncModalIsolation(): void {
    const backdrop = this.root.querySelector<HTMLElement>('.modal-backdrop');
    const page = backdrop?.parentElement ||
      this.root.querySelector<HTMLElement>('.game-page, .landing-page');
    if (!page) return;
    for (const child of Array.from(page.children)) {
      if (child === backdrop) child.removeAttribute('inert');
      else if (this.modal) child.setAttribute('inert', '');
      else child.removeAttribute('inert');
    }
  }

  private captureUiState(): void {
    this.preserveDetails = new Set(
      Array.from(this.root.querySelectorAll<HTMLDetailsElement>('details[data-details]'))
        .filter(details => details.open)
        .map(details => details.dataset.details || ''),
    );
    const active = document.activeElement as HTMLElement | null;
    this.focusKey = active?.dataset.focusKey || '';
    this.focusSelector = active?.closest('.modal') ? this.focusSelectorFor(active) : '';
    const log = this.root.querySelector<HTMLElement>('.battle-log');
    if (log) {
      if (log.dataset.logKey === this.battleKey) {
        this.battleLogTop = log.scrollTop;
        this.battleLogFollow = this.isAtLogEnd(log);
      } else {
        this.battleLogTop = 0;
        this.battleLogFollow = true;
        this.battleLogKey = this.battleKey;
      }
    }
    const map = this.root.querySelector<HTMLElement>('.map-scroll');
    if (map) {
      this.mapScrollTop = map.scrollTop;
      this.mapScrollKey = map.dataset.mapKey || this.mapScrollKey;
    }
    this.restoreScrollTop = window.scrollY;
  }

  private fitMapScroller(map: HTMLElement): void {
    const bottomNav = this.root.querySelector<HTMLElement>('.bottom-nav');
    if (!bottomNav?.getClientRects().length) {
      map.style.maxHeight = '';
      map.style.minHeight = '';
      return;
    }

    const scrollTop = map.scrollTop;
    const availableHeight = Math.floor(
      bottomNav.getBoundingClientRect().top - map.getBoundingClientRect().top - 8,
    );
    if (availableHeight <= 0) return;

    map.style.maxHeight = '';
    map.style.minHeight = '';
    const styles = window.getComputedStyle(map);
    const naturalMax = Number.parseFloat(styles.maxHeight);
    const naturalMin = Number.parseFloat(styles.minHeight);
    const maxHeight = Math.max(1, Math.min(
      availableHeight,
      Number.isFinite(naturalMax) ? naturalMax : availableHeight,
    ));
    const minHeight = Math.max(1, Math.min(
      Number.isFinite(naturalMin) ? naturalMin : 0,
      maxHeight,
    ));
    map.style.maxHeight = `${maxHeight}px`;
    map.style.minHeight = `${minHeight}px`;
    map.scrollTop = scrollTop;
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
    const openingModal = Boolean(this.modal) && this.renderedModal !== this.modal;
    const closingModal = !this.modal && Boolean(this.renderedModal);
    if (openingModal) {
      this.focusModal();
    } else if (closingModal && this.focusReturn) {
      const selector = this.focusReturn;
      this.focusReturn = '';
      this.focusTarget(selector)?.focus({ preventScroll: true });
    } else if (this.focusSelector) {
      this.focusTarget(this.focusSelector)?.focus({ preventScroll: true });
    } else if (this.focusKey) {
      this.root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(this.focusKey)}"]`)?.focus({ preventScroll: true });
    }
    const log = this.root.querySelector<HTMLElement>('.battle-log');
    if (log) {
      if (log !== this.logScrollElement) {
        this.logScrollElement = log;
        log.addEventListener('scroll', () => {
          this.battleLogTop = log.scrollTop;
          this.battleLogFollow = this.isAtLogEnd(log);
          const follow = this.root.querySelector<HTMLElement>('.log-follow');
          if (follow) follow.hidden = this.battleLogFollow;
        }, { passive: true });
      }
      log.scrollTop = this.battleLogFollow ? log.scrollHeight : this.battleLogTop;
    }
    const map = this.root.querySelector<HTMLElement>('.map-scroll');
    if (map) {
      this.fitMapScroller(map);
      const key = this.mapIdentity();
      if (key && key === this.mapScrollKey && Number.isFinite(this.mapScrollTop)) {
        map.scrollTop = this.mapScrollTop;
      } else {
        const available = map.querySelector<HTMLElement>('.map-node.available:not([disabled])');
        if (available) map.scrollTop = Math.max(0, available.offsetTop - map.clientHeight * 0.6);
      }
    }
    this.renderedModal = this.modal;
  }

  private render(): void {
    if (this.gameState()?.phase === 'battle') {
      this.syncBattleState();
    } else {
      this.stopPlayback();
    }
    if (!this.playbackEligible()) this.stopPlayback();
    this.captureUiState();
    if (this.loading) {
      this.replaceRoot(`<div class="loading-screen">${landscape()}<div class="loading-mark">${sigil('gate', 'gold')}</div><p>山海卷轴载入中</p></div>`);
      return;
    }
    if (this.error && !this.content) {
      this.replaceRoot(`<main class="fatal-screen" role="alert"><div class="seal">${sigil('close', 'fire')}</div><h1>山海卷无法展开</h1><p>${esc(this.error)}</p><button class="button primary" data-action="retry">${icon('arrow', 16)}重试</button></main>`);
      return;
    }
    if (!this.game) {
      this.stopPlayback();
      this.replaceRoot(this.renderLanding());
      this.syncModalIsolation();
      this.restoreUiState();
      return;
    }
    const state = this.gameState();
    if (!state) {
      this.replaceRoot(this.renderErrorState('这一局没有可显示的状态。'));
      return;
    }
    if (this.canRenderBattleInPlace(state)) {
      this.updateBattlePresentation(false);
      this.syncModalMarkupInPlace();
      this.syncModalIsolation();
      this.restoreUiState();
      if (state.phase === 'battle') this.ensurePlayback();
      return;
    }
    this.replaceRoot(this.renderGame(state));
    this.syncModalIsolation();
    if (state.phase === 'battle') this.ensurePlayback();
    this.restoreUiState();
  }

  private replaceRoot(markup: string): void {
    this.logScrollElement = null;
    this.root.innerHTML = markup;
  }

  private canRenderBattleInPlace(state: RunState): boolean {
    const shell = this.root.querySelector<HTMLElement>('.battle-shell');
    return this.view === 'journey' && state.phase === 'battle' &&
      this.root.querySelector('.game-page.phase-battle') !== null &&
      shell?.dataset.battleKey === this.battleKey;
  }

  private syncModalMarkupInPlace(): void {
    const page = this.root.querySelector<HTMLElement>('.game-page');
    if (!page) return;
    const current = page.querySelector<HTMLElement>(':scope > .modal-backdrop');
    if (!this.modal) {
      current?.remove();
      return;
    }
    const template = document.createElement('template');
    template.innerHTML = this.modalMarkup();
    const next = template.content.firstElementChild;
    if (next) {
      if (current?.outerHTML === next.outerHTML) return;
      if (current) current.replaceWith(next);
      else page.append(next);
    }
  }

  private updateBattlePresentation(frameChanged: boolean): void {
    const frames = this.battleResult()?.frames || [];
    const cursor = Math.min(this.battleCursor, Math.max(0, frames.length - 1));
    const frame = frames[cursor];
    if (!frame) return;
    const shell = this.root.querySelector<HTMLElement>('.battle-shell');
    const arena = shell?.querySelector<HTMLElement>('.combat-arena');
    const log = shell?.querySelector<HTMLElement>('.battle-log');
    if (!shell || !arena || !log) return;

    const domCursor = Number(arena.dataset.frameIndex);
    const cursorChanged = Number.isInteger(domCursor) && domCursor !== cursor;
    const changed = frameChanged || cursorChanged;
    const previous = cursor > 0 ? frames[cursor - 1] : undefined;
    const cue = battlePresentationCue(frame, previous);
    shell.dataset.paused = String(this.battlePaused || Boolean(this.modal));
    shell.style.setProperty('--beat-duration', `${battleBeatDuration(frame, this.battleSpeed)}ms`);
    if (!changed) {
      this.updateBattleControls(shell);
      this.updateBattleLog(shell, log, frames, cursor, false);
      return;
    }

    const heading = shell.parentElement?.querySelector<HTMLElement>('.stage-heading[data-battle-heading]');
    if (heading) {
      const kicker = heading.querySelector<HTMLElement>('.eyebrow');
      const title = heading.querySelector<HTMLElement>('h1');
      if (kicker) kicker.textContent = '交锋';
      if (title) title.textContent = this.battleFinished
        ? this.battleResult()?.outcome === 'player' ? '此战告捷'
          : this.battleResult()?.outcome === 'draw' ? '胜负未分' : '此身入劫'
        : '斗法';
    }
    const context = shell.querySelector<HTMLElement>('[data-battle-round]');
    if (context) context.textContent = this.battleFinished
      ? `历 ${formatNumber(this.battleResult()?.rounds)} 回合`
      : `第 ${formatNumber(frame.round)} 回合`;
    const contextText = shell.querySelector<HTMLElement>('[data-battle-context]');
    if (contextText) {
      contextText.textContent = FRAME_KIND_LABEL[asText(frame.kind)] || '战斗';
    }

    const core = arena.querySelector<HTMLElement>('.battle-stage-core');
    if (core) {
      const seal = core.querySelector<HTMLElement>('.round-seal');
      const text = core.querySelector<HTMLElement>('[data-frame-text]');
      const source = core.querySelector<HTMLElement>('[data-frame-source]');
      const amount = core.querySelector<HTMLElement>('[data-battle-amount]');
      if (seal) seal.textContent = this.battleFinished
        ? this.battleResult()?.outcome === 'player' ? '胜' : this.battleResult()?.outcome === 'draw' ? '平' : '劫'
        : String(frame.round);
      if (text) text.textContent = localizeBattleText(asText(frame.text, '双方试探'));
      if (frame.source) {
        if (source) source.textContent = this.sourceLabel(frame.source);
        else text?.insertAdjacentHTML('afterend',
          `<small data-frame-source>${esc(this.sourceLabel(frame.source))}</small>`);
      } else {
        source?.remove();
      }
      if (amount) amount.innerHTML = this.battleAmountMarkup(frame, previous);
    }

    arena.dataset.frameIndex = String(cursor);
    arena.dataset.frameKind = asText(frame.kind);
    arena.dataset.actionKind = cue.actionKind;
    arena.dataset.motionTrigger = String(cursor % 2);
    arena.querySelectorAll<HTMLElement>('.combatant').forEach((combatant) => {
      const side = combatant.dataset.side === 'player' ? 'player' : 'enemy';
      this.updateCombatant(combatant, frame[side], side, frame, cue, cursor, changed);
    });
    if (changed) {
      arena.querySelectorAll('.combat-vfx, .combat-feedback-layer').forEach(element => element.remove());
      arena.insertAdjacentHTML('beforeend',
        this.battleVfx(frame, previous) + this.battleFeedback(frame, previous));
    }

    const progress = shell.querySelector<HTMLElement>('.replay-progress i');
    if (progress) {
      progress.style.width = `${frames.length <= 1 ? 100 : Math.round(cursor / Math.max(1, frames.length - 1) * 100)}%`;
    }
    this.updateBattleControls(shell);
    this.updateBattleSettlement(shell);
    this.updateBattleLog(shell, log, frames, cursor, changed);
  }

  private updateBattleControls(shell: HTMLElement): void {
    const speeds = shell.querySelectorAll<HTMLElement>('[data-action="battle-speed"]');
    speeds.forEach(button => {
      const pressed = String(asNumber(button.dataset.speed, 1) === this.battleSpeed);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    });
    const pause = shell.querySelector<HTMLElement>('[data-action="battle-pause"]');
    if (pause) {
      const pressed = String(this.battlePaused);
      const label = this.battlePaused ? '继续播放' : '暂停播放';
      const text = this.battlePaused ? '继续' : '暂停';
      if (pause.getAttribute('aria-pressed') !== pressed) pause.setAttribute('aria-pressed', pressed);
      if (pause.getAttribute('aria-label') !== label) pause.setAttribute('aria-label', label);
      if (pause.textContent !== text) pause.textContent = text;
    }
    const action = shell.querySelector<HTMLElement>('[data-control-cta]');
    const state = this.gameState();
    if (!action || !state) return;
    const template = document.createElement('template');
    template.innerHTML = this.battleControlAction(state);
    const expected = template.content.firstElementChild as HTMLElement | null;
    if (!expected) return;
    for (const attribute of ['data-action', 'class', 'aria-label', 'data-focus-key', 'data-autofocus']) {
      const value = expected.getAttribute(attribute);
      if (value === null) action.removeAttribute(attribute);
      else if (action.getAttribute(attribute) !== value) action.setAttribute(attribute, value);
    }
    const disabled = expected.hasAttribute('disabled');
    if (action.hasAttribute('disabled') !== disabled) action.toggleAttribute('disabled', disabled);
    if (action.innerHTML !== expected.innerHTML) action.innerHTML = expected.innerHTML;
  }

  private updateBattleSettlement(shell: HTMLElement): void {
    const existing = shell.querySelector<HTMLElement>('.battle-settlement');
    if (!this.battleFinished) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const logDisclosure = shell.querySelector<HTMLElement>('.battle-log-disclosure');
    if (logDisclosure) logDisclosure.insertAdjacentHTML('beforebegin', this.battleSettlementMarkup());
    else shell.insertAdjacentHTML('beforeend', this.battleSettlementMarkup());
  }

  private updateBattleLog(
    shell: HTMLElement,
    log: HTMLElement,
    frames: BattleFrame[],
    cursor: number,
    cursorChanged: boolean,
  ): void {
    const previousCursor = Number(log.dataset.frameIndex);
    const modeChanged = log.dataset.logMode !== String(this.detailedLog);
    const rewound = Number.isInteger(previousCursor) && cursor < previousCursor;
    const rebuild = modeChanged || log.dataset.logKey !== this.battleKey || rewound;
    const oldTop = log.scrollTop;
    const wasAtEnd = this.isAtLogEnd(log);
    if (rebuild) {
      const visible = frames.slice(0, cursor + 1).map((frame, index) => {
        return this.battleLogRow(frame, index > 0 ? frames[index - 1] : undefined);
      }).join('');
      log.innerHTML = visible || '<p class="simple-log-empty">双方蓄势。</p>';
      log.classList.toggle('detailed-mode', this.detailedLog);
      log.classList.toggle('simple-mode', !this.detailedLog);
    } else if (cursorChanged) {
      for (let index = Math.max(0, Number.isInteger(previousCursor) ? previousCursor + 1 : cursor); index <= cursor; index += 1) {
        const row = this.battleLogRow(frames[index], index > 0 ? frames[index - 1] : undefined);
        log.insertAdjacentHTML('beforeend', row);
      }
      log.querySelector('.simple-log-empty')?.remove();
    }
    log.dataset.logKey = this.battleKey;
    log.dataset.frameIndex = String(cursor);
    log.dataset.logMode = String(this.detailedLog);
    const followButton = shell.querySelector<HTMLElement>('.log-follow');
    if (cursorChanged && !rebuild) {
      this.battleLogFollow = wasAtEnd;
      if (!this.battleLogFollow) this.battleLogTop = oldTop;
    }
    if (cursorChanged && this.battleLogFollow) log.scrollTop = log.scrollHeight;
    else if (rebuild && !this.battleLogFollow) log.scrollTop = oldTop || this.battleLogTop;
    if (followButton) followButton.hidden = this.battleLogFollow;
    const modeButton = shell.querySelector<HTMLElement>('.log-mode');
    if (modeButton) {
      modeButton.setAttribute('aria-pressed', String(this.detailedLog));
      modeButton.textContent = this.detailedLog ? '详录' : '简录';
    }
  }

  private renderLanding(): string {
    const methods = this.startMethods();
    let hasSaved = false;
    try {
      hasSaved = Boolean(this.storageIssue.startsWith('存档无法读取')) || Boolean(localStorage.getItem('suishi-shanhai-run-v1'));
    } catch {
      hasSaved = Boolean(this.storageIssue.startsWith('存档无法读取'));
    }
    const selected = methods.find((method) => method.id === this.selectedMethod) || methods[0];
    return `<div class="landing-page immersion-cover">
      <div class="landing-atmosphere">${landscape()}</div>
      <header class="topbar landing-topbar">
        <button class="brand" aria-label="山海行"><span class="brand-mark">${icon('mountain', 22)}</span><strong>随时修仙<span class="gold">·</span>山海行</strong></button>
        <div class="top-tools">${this.archiveIssue ? `<span class="save-warning" role="status">${esc(this.archiveIssue)}</span>` : ''}<button class="icon-button" data-action="archives" title="历届通关构筑" aria-label="历届通关构筑">${icon('book', 19)}</button></div>
      </header>
      <main class="landing-inner">
        <section class="landing-copy"><p class="eyebrow">山海行</p><h1>随时修仙</h1>
          ${hasSaved && !this.storageIssue?.startsWith('存档无法读取') ? `<button class="resume-card" data-action="continue"><span><b>继续未完命途</b><small>${esc(asText(this.playerName, '上一局山海行'))}</small></span>${icon('arrow', 19)}</button>` : ''}
        </section>
        <div class="hero-card-stage"><div class="hero-back"></div><div class="hero-card">${portrait(this.visualKind({}, selected), true)}<div class="hero-card-label">${esc(asText(selected?.name, '开局功法'))}</div></div></div>
        <section class="setup" aria-labelledby="setup-title">
          <div class="setup-top"><div><h2 class="setup-title" id="setup-title">择一门功法</h2></div></div>
          <div class="setup-fields"><label class="field name-input"><span>道号</span><input name="player-name" maxlength="24" value="${esc(this.playerName)}" placeholder="无名行者" autocomplete="nickname"></label>
            <details class="seed-options disclosure" data-details="seed-options"><summary>命数设置</summary><div class="seed-options-body"><label class="field"><span>命数种子</span><input class="seed-input" name="seed" maxlength="48" value="${esc(this.seed)}" placeholder="留空则另起命数"></label><button class="seed-action" data-action="shuffle-seed" title="另择命数" aria-label="另择命数">${icon('mirror', 16)}</button></div></details>
          </div>
          <div class="method-grid">${methods.map((method, index) => this.methodChoice(method, index)).join('')}</div>
          <div class="method-detail">${this.methodQuickDetail(selected)}<details class="method-full-detail disclosure" data-details="landing-method"><summary>功法详录</summary>${this.methodDetail(selected)}</details></div>
          <div class="actions"><button class="button primary small" data-action="start" data-autofocus>入山海 ${icon('arrow', 17)}</button></div>
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
      <span class="method-copy"><b>${esc(method.name)}</b><em>${esc(this.displayText(role))}</em><small>${esc(this.displayText(asText(method.summary, entitySummary(method))))}</small></span>
      <span class="method-portrait">${portrait(art)}</span>
    </button>`;
  }

  private methodQuickDetail(method?: Entity): string {
    if (!method) return '<p class="empty-note">暂无开局功法。</p>';
    const basic = method.actions?.basic;
    const rage = method.actions?.rage;
    return `<div class="method-quick-actions"><span><b>普攻</b><small>${esc(this.displayText(asText(basic?.quick, '稳步出手。')))}</small></span><span><b>怒技</b><small>${esc(this.displayText(asText(rage?.quick, '蓄满怒气后释放。')))}</small></span></div>`;
  }

  private methodDetail(method?: Entity): string {
    if (!method) return '<p class="empty-note">暂无开局功法。</p>';
    const basic = method.actions?.basic;
    const rage = method.actions?.rage;
    const travel = listOf<any>(method.travel);
    return `<div class="method-detail-head"><span class="rarity-chip ${entityRarity(method)}">${esc(rarityLabel(entityRarity(method)))}</span><b>${esc(asText(method.name))}</b><span>${esc(this.displayText(asText(method.role, '修行方向')))}</span></div>
      <p>${esc(this.displayText(asText(method.description, entitySummary(method))))}</p>
      <div class="method-actions"><span><b>普攻</b>${esc(asText(basic?.name, '基础动作'))}<small>${esc(this.displayText(asText(basic?.quick, '稳步出手')))}</small></span><span><b>怒技</b>${esc(asText(rage?.name, '怒技'))}<small>${esc(this.displayText(asText(rage?.quick, '蓄满怒气后释放')))}</small></span><span><b>行旅</b><span class="method-travel-list">${travel.length ? travel.map((effect) => `<small>${esc(this.displayText(asText(effect?.text, '完成节点后获得门派助益')))}</small>`).join('') : '<small>完成节点后获得门派助益</small>'}</span></span></div>`;
  }

  private topbar(state: RunState): string {
    const tabs: Array<['journey' | 'build' | 'karma', string, string]> = [
      ['journey', 'mountain', '山河'],
      ['build', 'book', '命盘'],
      ['karma', 'lotus', '因缘'],
    ];
    return `<header class="topbar">
      <button class="brand" data-action="home" aria-label="返回山海封面"><span class="brand-mark">${icon('mountain', 22)}</span><strong>随时修仙<span class="gold">·</span>山海行</strong></button>
      <nav class="desktop-nav" aria-label="主导航">${tabs.map(([id, art, label]) => `<button class="nav-button ${this.view === id ? 'active' : ''}" data-action="tab" data-id="${id}" ${this.view === id ? 'aria-current="page"' : ''}>${icon(art, 19)}${label}</button>`).join('')}</nav>
      <div class="top-tools header-actions">
        ${this.storageIssue ? `<span class="save-warning" role="status">存档需留意</span>` : ''}
        <button class="icon-button" data-action="archives" title="历届通关构筑" aria-label="历届通关构筑">${icon('book', 19)}</button>
        <button class="icon-button" data-action="settings" title="设置" aria-label="设置">${icon('gear', 20)}</button>
      </div>
    </header>`;
  }

  private chapterStrip(state: RunState): string {
    const names = ['一', '二', '三', '四', '终'];
    const total = Math.max(5, state.act);
    return `<div class="chapter-strip" aria-label="幕次进度">${names.slice(0, total).map((name, index) => {
      const active = state.act === index + 1;
      const done = state.act > index + 1;
      const act = index === 4 ? this.byId('RF01') : this.byId(`RA0${index + 1}`);
      return `<span class="chapter ${active ? 'active' : ''} ${done ? 'done' : ''}" ${active ? 'aria-current="step"' : ''}><span>${name}</span><span class="chapter-name">${esc(asText(act?.name, index === 4 ? '终局' : `第${index + 1}幕`))}</span></span>`;
    }).join('<span class="chapter-separator">—</span>')}</div>`;
  }

  private mobileHud(state: RunState): string {
    if (this.view !== 'journey' || state.phase === 'battle') return '';
    const stats = this.stats();
    const hp = asNumber(state.hp, stats.max_hp);
    return `<div class="mobile-hud">
      <button class="hud-character" data-action="character" aria-label="查看人物全部属性"><span>${esc(state.name)}<small>${esc(this.realmName(state.n))}</small></span><strong>${formatNumber(hp)}<small> / ${formatNumber(stats.max_hp)}</small></strong><div class="bar"><span style="width:${pct(hp, stats.max_hp)}%"></span></div></button>
      <button class="hud-stats" data-action="character" aria-label="查看人物属性"><span>攻 <b>${formatNumber(stats.attack)}</b></span><span>防 <b>${formatNumber(stats.defense)}</b></span><span>速 <b>${formatNumber(stats.speed)}</b></span></button>
      <span class="mobile-gold">${icon('coin', 17)} ${formatNumber(state.coins)}</span>
    </div>`;
  }

  private bottomNav(): string {
    const tabs: Array<['journey' | 'build' | 'karma', string, string]> = [
      ['journey', 'mountain', '山河'],
      ['build', 'book', '命盘'],
      ['karma', 'lotus', '因缘'],
    ];
    return `<nav class="bottom-nav" aria-label="主导航">${tabs.map(([id, art, label]) => `<button class="${this.view === id ? 'active' : ''}" data-action="tab" data-id="${id}" ${this.view === id ? 'aria-current="page"' : ''}>${icon(art, 22)}${label}</button>`).join('')}</nav>`;
  }

  private renderGame(state: RunState): string {
    const phase = state.phase;
    const combat = this.view === 'journey' && phase === 'battle';
    const stage = this.view === 'build' ? this.buildView(state) : this.view === 'karma' ? this.karmaView(state) : this.phaseView(state);
    return `<div class="game-page phase-${esc(phase)} view-${this.view}" data-phase="${esc(phase)}">
      ${this.topbar(state)}
      ${this.chapterStrip(state)}
      ${this.mobileHud(state)}
      <div class="game-layout ${combat ? 'in-combat' : ''} ${this.view === 'build' ? 'view-build' : ''}">
        ${combat ? '' : `<aside class="sidebar player-rail">${this.profileRail(state)}</aside>`}
        <main class="main-stage">${stage}${phase === 'battle' && state.battle?.outcome === 'draw' && this.view === 'journey' ? '<div class="stage-actions"><button class="button quiet" data-action="retire">收手，结束本局</button></div>' : ''}</main>
      </div>
      ${this.bottomNav()}
      ${this.modalMarkup()}
    </div>`;
  }

  private gameHeader(state: RunState): string {
    const act = this.currentAct();
    const phase = PHASE_LABEL[state.phase] || state.phase;
    return `<header class="game-header">
      <div class="brand-lockup"><span class="brand-seal">${icon('mountain', 21)}</span><span><b>随时修仙</b><em>山海行</em></span></div>
      <div class="act-progress"><span class="eyebrow">第${String(state.act).padStart(2, '0')}幕</span><strong>${esc(asText(act.name, `第${state.act}幕`))}</strong><span class="phase-pill">${esc(phase)}</span></div>
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
    return `<section class="panel player-compact">
      <button class="player-identity" data-action="character" aria-label="查看人物属性">${portrait(this.visualKind(player, method))}<span><small>山海行者</small><strong>${esc(asText(state.name, '无名行者'))}</strong><em>${esc(this.realmName(state.n))}</em></span></button>
      <div class="panel-body">
        <div class="vital-title"><span>气血</span><strong>${formatNumber(hp)} / ${formatNumber(maxHp)}</strong></div><div class="bar hp"><span style="width:${pct(hp, maxHp)}%"></span></div>
        <div class="vital-title xp-label"><span>修为</span><span>${xpComplete ? '圆满' : `${formatNumber(state.xp)} / ${formatNumber(xpThreshold)}`}</span></div><div class="bar xp"><span style="width:${xpComplete ? 100 : pct(asNumber(state.xp), xpThreshold)}%"></span></div>
        <div class="resource-box"><span>${icon('coin', 15)}灵石</span><strong>${formatNumber(state.coins)}</strong></div>
        <details class="disclosure fate-detail" data-details="method-detail"><summary>${icon('book', 17)}${esc(asText(method?.name, '未知功法'))}</summary><p>${esc(this.displayText(asText(method?.summary, entitySummary(method))))}</p></details>
        <details class="disclosure" data-details="profile-details"><summary>属性与构筑</summary>
          <div class="stats-grid detailed">${(['attack', 'defense', 'crit_rate', 'speed'] as const).map((key) => `<div class="stat detailed-stat"><span>${icon(key === 'attack' ? 'sword' : key === 'defense' ? 'shield' : key === 'speed' ? 'feather' : 'star', 13)}${STAT_LABEL[key]}</span><b>${key === 'crit_rate' ? `${Math.round(asNumber(stats[key]) * 100)}%` : formatNumber(stats[key])}</b></div>`).join('')}</div>
          <div class="profile-build">
            <div class="profile-talents"><span class="eyebrow">已选天赋</span><div class="profile-talent-list">${selectedTalents.length ? selectedTalents.map((talent) => this.talentButton(talent, state.method)).join('') : '<span class="muted">未选天赋</span>'}</div></div>
            <div class="profile-actions"><span class="eyebrow">当前功法动作</span>${actionDetails.map(({ label, action }) => `<div class="profile-action"><b>${esc(label)} · ${esc(asText(action?.name, '动作'))}</b><small>${esc(this.displayText(asText(action?.quick, asText(action?.description, '暂无说明'))))}</small></div>`).join('')}</div>
          </div>
        </details>
      </div>
    </section>
    <section class="rail-board"><button class="side-section-title" data-action="tab" data-id="build">命盘 <span>${artifacts.length} 类 ${icon('arrow', 13)}</span></button><details class="disclosure" data-details="profile-artifacts"><summary>持有法宝</summary><div class="mini-build">${artifacts.slice(0, 8).map((stack) => this.artifactMini(stack)).join('') || '<p class="empty-note">尚未收纳法宝。</p>'}</div></details></section>`;
  }

  private artifactMini(stack: ArtifactStack): string {
    const artifact = this.artifactEntity(stack.id);
    const rarity = entityRarity(artifact);
    return `<button class="mini-card ${rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'shield' : 'jade'} rarity-${esc(rarity)}" data-action="inspect-artifact" data-id="${esc(stack.id)}" aria-label="${esc(asText(artifact?.name, stack.id))}，叠层 ${formatNumber(stack.stacks)}"><span class="slot-glyph">${sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : 'jade')}</span><span class="name">${esc(asText(artifact?.name, stack.id))}</span><span class="rank">×${formatNumber(stack.stacks)}</span></button>`;
  }

  private buildView(state: RunState): string {
    const method = this.methodEntity(state.method);
    const talents = listOf<string>(state.talents?.[state.method]).map((id) => this.talentEntity(state.method, id)).filter((item): item is Entity => Boolean(item));
    const owned = new Map(state.artifacts.map((item) => [item.id, item.stacks]));
    const visibleArtifacts = this.buildFilter === 'owned'
      ? state.artifacts.map((stack) => this.artifactEntity(stack.id)).filter((item): item is Entity => Boolean(item))
      : this.entities('artifact');
    const artifacts = this.buildRarityFilter === 'all'
      ? visibleArtifacts
      : visibleArtifacts.filter((artifact) => entityRarity(artifact) === this.buildRarityFilter);
    const actions = [method?.actions?.basic, method?.actions?.rage].filter((item) => isRecord(item));
    return `<section class="codex-page">
      ${this.stageHeading('当前命盘', asText(method?.name, state.method))}
      <section class="build-focus"><div class="build-focus-title"><strong>${esc(asText(method?.role, '修行方向'))}</strong><span class="gold">境界 · ${esc(this.realmName(state.n))}</span></div>
        <p class="build-description">${esc(this.displayText(asText(method?.description, entitySummary(method))))}</p>
        <div class="method-actions">${actions.map((action, index) => `<article><b>${index === 0 ? '普攻' : '怒技'}</b><strong>${esc(asText(action?.name, '动作'))}</strong><p>${esc(this.displayText(asText(action?.quick, asText(action?.description, '按功法规则结算。'))))}</p></article>`).join('')}</div>
      </section>
      <section class="build-section"><div class="section-heading"><h2>已选天赋</h2><span>${talents.length} 项</span></div><div class="talent-ledger">${talents.length ? talents.map((talent) => `<article><b>${this.talentButton(talent, state.method, 'talent-record-trigger')}</b><p>${esc(this.displayText(asText(talent.quick, asText(talent.description, ''))))}</p></article>`).join('') : '<p class="empty-note">尚未选择天赋。</p>'}</div></section>
      <section class="build-section"><div class="section-heading"><h2>法宝图鉴</h2><span>已持有 ${state.artifacts.length} 类 · 收录 ${this.entities('artifact').length} 件</span></div>
        <div class="filters" role="group" aria-label="法宝范围"><button class="${this.buildFilter === 'owned' ? 'active' : ''}" data-action="build-filter" data-filter="owned" aria-pressed="${this.buildFilter === 'owned'}">已持有</button><button class="${this.buildFilter === 'all' ? 'active' : ''}" data-action="build-filter" data-filter="all" aria-pressed="${this.buildFilter === 'all'}">全部法宝</button></div>
        <div class="filters" role="group" aria-label="按品阶筛选">${([
          ['all', '全部品阶'],
          ['common', '普通'],
          ['rare', '稀有'],
          ['legendary', '传奇'],
        ] as const).map(([rarity, label]) => `<button class="${this.buildRarityFilter === rarity ? 'active' : ''}" data-action="build-rarity-filter" data-rarity="${rarity}" aria-pressed="${this.buildRarityFilter === rarity}">${label}</button>`).join('')}</div>
        <div class="deck-grid">${artifacts.map((artifact) => {
        const stacks = owned.get(artifact.id) || 0;
        return this.artifactCard(artifact, stacks);
      }).join('') || `<p class="empty-note">${this.buildFilter === 'owned'
        ? this.buildRarityFilter === 'all'
          ? '尚未收纳法宝。'
          : `此身尚未收纳${RARITY_LABEL[this.buildRarityFilter]}法宝。`
        : '没有符合条件的法宝。'}</p>`}</div></section>
      ${this.inlineMessage()}
    </section>`;
  }

  private artifactCard(artifact: Entity, stacks: number): string {
    const rarity = entityRarity(artifact);
    return `<button type="button" class="ability-card rarity-${esc(rarity)} ${stacks ? 'owned' : ''}" data-action="inspect-artifact" data-id="${esc(artifact.id)}">
      <div class="card-top"><span class="rarity-label rarity-${esc(rarity)}">${esc(rarityLabel(rarity))}</span><span class="card-rank">${stacks ? `×${formatNumber(stacks)}` : '未持有'}</span></div>
      <div class="card-heading">${sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'shield' : 'jade')}<h3 class="card-title rarity-${esc(rarity)}">${esc(artifact.name)}</h3></div>
      <p class="ability-overview">${esc(this.displayText(entitySummary(artifact)) || '法宝效果详录可查看。')}</p>
      <div class="card-foot"><span class="gain">${stacks ? '已纳入命盘' : '尚未纳入命盘'}</span><span>查看详录 ${icon('arrow', 14)}</span></div>
    </button>`;
  }

  private karmaView(state: RunState): string {
    const history = listOf<any>(state.history).slice().reverse();
    const seenEvents = new Set(listOf<string>(state.seenEvents));
    const encounteredStories = this.entities('storyline').filter((story) =>
      listOf<string>(story.encounters).some((id) => seenEvents.has(id)) ||
      history.some((item) => asText(item.title) === asText(story.name)),
    );
    const storyline = encounteredStories.find((story) => story.id === state.storyline) || encounteredStories[0];
    const encounteredPeople = unique(encounteredStories.map((story) => asText(story.character, story.name))).filter(Boolean);
    const flagLabels = Object.entries(state.flags || {})
      .filter(([, value]) => value)
      .map(([id]) => this.flagLabel(id))
      .filter(Boolean);
    return `<section class="karma-page">
      ${this.stageHeading('因缘', '行迹与因果')}
      <section class="karma-ledger"><div class="karma-summary"><span>因缘</span><strong>${esc(asText(storyline?.name, '尚未相逢'))}</strong><p>${esc(this.displayText(entitySummary(storyline)) || '山河尚未留下这段因缘。')}</p></div><div class="karma-summary"><span>行迹记录</span><strong>${history.length}</strong><p>走过的节点与已经落定的选择。</p></div></section>
      ${encounteredPeople.length ? `<section class="build-section karma-characters"><div class="section-heading"><h2>相逢人物</h2><span>${encounteredPeople.length} 位</span></div><div class="build-tags">${encounteredPeople.map((name) => `<span>${esc(name)}</span>`).join('')}</div></section>` : ''}
      <section class="build-section"><div class="section-heading"><h2>留下的约定</h2><span>${flagLabels.length} 项</span></div><div class="build-tags">${flagLabels.map((label) => `<span>${esc(label)}</span>`).join('') || '<span>尚无约定</span>'}</div></section>
      <section class="timeline" aria-label="行迹记录">${history.length ? history.map((item, index) => `<article class="timeline-item"><span class="timeline-index">${String(history.length - index).padStart(2, '0')}</span><div><small>第${esc(asText(item.act))}幕 · 节点 ${formatNumber(asNumber(item.step) + 1)}</small><h3>${esc(this.displayText(asText(item.title, '山海一刻')))}</h3><p>${esc(this.displayText(asText(item.text, '')))}</p></div></article>`).join('') : '<p class="empty-note">山河初展，尚待第一笔记录。</p>'}</section>
      ${this.inlineMessage()}
    </section>`;
  }

  private flagLabel(id: string): string {
    const storyline = this.entities('storyline').find((story) => id === story.id || id.startsWith(`${story.id}-`));
    if (storyline) return `与${asText(storyline.character, storyline.name)}的约定`;
    for (const event of this.entities('event')) {
      if (listOf<any>(event.options).some((option) => isRecord(option?.set_flags) && option.set_flags[id] === true)) {
        return `${event.name}留下的约定`;
      }
    }
    return '';
  }

  private contextRail(state: RunState): string {
    const act = this.currentAct();
    const story = isRecord(act.story) ? act.story : {};
    const history = listOf<any>(state.history).slice(-3).reverse();
    const completed = state.nodes.filter((node) => node.completed).length;
    const total = state.act === 5 ? 1 : 11;
    return `<section class="goal-panel"><p class="eyebrow">第${String(state.act).padStart(2, '0')}幕</p><h2>${esc(asText(story.title || act.name, `第${state.act}幕`))}</h2><div class="node-count-line"><span>行程</span><b>${completed} / ${total}</b></div><div class="bar thin"><i style="width:${pct(completed, total)}%"></i></div></section>
      <section class="history-panel"><div class="rail-heading"><span>行迹</span><small>最近记录</small></div>${history.length ? history.map((item) => `<article><b>${esc(this.displayText(asText(item.title, '山海一刻')))}</b><p>${esc(this.displayText(asText(item.text, '')))}</p></article>`).join('') : '<p class="empty-note">第一笔行迹尚未落下。</p>'}</section>
      `;
  }

  private inventoryMarkup(artifacts: ArtifactStack[]): string {
    if (!artifacts.length) return '<p class="empty-note">尚未收纳法宝。</p>';
    return `<div class="inventory-list">${artifacts.map((stack) => {
      const artifact = this.artifactEntity(stack.id);
      const rarity = entityRarity(artifact);
      return `<div class="inventory-item rarity-${esc(rarity)}"><span class="item-sigil">${sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'shield' : 'jade')}</span><span><b>${esc(asText(artifact?.name, '未知法宝'))}</b><small>${esc(this.displayText(asText(artifact?.summary, entitySummary(artifact))))}</small></span><strong>×${formatNumber(stack.stacks, 0)}</strong></div>`;
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

  private stageHeading(kicker: string, title: string, description = '', battle = false): string {
    return `<div class="stage-heading" ${battle ? 'data-battle-heading' : ''}><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>`;
  }

  private routeView(state: RunState): string {
    const act = this.currentAct();
    const routes = this.routeObjects().slice(0, 6);
    return `${this.stageHeading(`第${state.act}幕`, asText(act.name, `第${state.act}幕`), '旧命途需补选本幕行路。')}
      <div class="route-grid">${routes.map((route, index) => this.routeCard(route, index)).join('')}</div>
      ${this.inlineMessage()}`;
  }

  private routeCard(route: any, index: number): string {
    const nodes = listOf<any>(route.nodes);
    const routeId = asText(route.id, `route-${index}`);
    return `<article class="route-card ${index === 0 ? 'route-recommended' : ''}">
      <div class="route-card-head"><span class="route-number">${String(index + 1).padStart(2, '0')}</span><div><h2>${esc(this.displayText(asText(route.name, `旧径 ${index + 1}`)))}</h2><p>${esc(this.displayText(asText(route.summary, '')))}</p></div>${index === 0 ? '<span class="route-tag">沿此而行</span>' : ''}</div>
      <div class="node-strip" aria-label="${esc(localizeVisibleText(asText(route.name, '山河旧径')))}节点">${nodes.slice(0, 11).map((node) => { const meta = nodeMeta(asText(node?.type)); return `<span class="node-strip-item tone-${meta.tone}" title="${esc(meta.label)}">${icon(meta.icon, 13)}<small>${esc(meta.label)}</small></span>`; }).join('')}</div>
      <div class="route-card-foot"><span>${nodes.length || 11} 节点 · ${esc(asText(route.count ? Object.entries(route.count).filter(([, value]) => asNumber(value) > 0).map(([key, value]) => `${nodeMeta(key).label} ${value}`).join(' · ') : '收益随行兑现'))}</span><button class="button small" data-action="route" data-id="${esc(routeId)}">行此旧径 ${icon('arrow', 14)}</button></div>
    </article>`;
  }

  private mapView(state: RunState): string {
    if (state.routeMap) return this.routeMapView(state, state.routeMap);

    const act = this.currentAct();
    const nodes = listOf<RunNode>(state.nodes);
    const currentIndex = clamp(asNumber(state.step, 0), 0, Math.max(0, nodes.length - 1));
    const orderedNodes = nodes
      .map((node, index) => ({ node, index }))
      .sort((left, right) => Number(right.index === currentIndex) - Number(left.index === currentIndex));
    const height = Math.max(760, nodes.length * 118);
    const y = (index: number): number => 58 + (nodes.length - 1 - index) * 112;
    const x = (index: number): number => 400 + (index % 2 === 0 ? -54 : 54);
    const connectors = nodes.slice(0, -1).map((node, index) => {
      const done = index < currentIndex || node.completed;
      return `<path d="M${x(index)} ${y(index)} C${x(index)} ${y(index) - 44} ${x(index + 1)} ${y(index + 1) + 44} ${x(index + 1)} ${y(index + 1)}" fill="none" stroke="${done ? '#d7bd7a' : '#9b9e75'}" stroke-width="${done ? 2.4 : 1.3}" stroke-dasharray="${done ? 'none' : '5 8'}" opacity="${done ? '.78' : '.35'}"/>`;
    }).join('');
    return `${this.stageHeading(`第${state.act}幕 · 山河图`, asText(act.name, `第${state.act}幕`))}
      <div class="map-goal"><span>${icon('flag', 17)}已选路线</span><b>${esc(this.routeName(state))}</b><span class="map-step">${Math.max(0, currentIndex) + 1} / ${nodes.length || 0}</span></div>
      <div class="map-scroll" data-map-key="${esc(this.mapIdentity(state))}" tabindex="0" aria-label="本幕路线，可上下滚动"><div class="map-wrap" style="height:${height}px">${landscape()}<svg class="map-lines" viewBox="0 0 800 ${height}" preserveAspectRatio="none" aria-hidden="true">${connectors}</svg>
        ${orderedNodes.map(({ node, index }) => {
          const meta = nodeMeta(node.type);
          const entity = this.byId(node.id);
          const label = asText(entity?.name, meta.label);
          const available = index === currentIndex && !node.completed;
          const done = index < currentIndex || node.completed;
          return `<button class="map-node ${available ? 'available' : ''} ${done ? 'done' : ''} ${node.type === 'B' || node.type === 'F' ? 'boss' : ''}" style="left:${x(index) / 8}%;top:${y(index) / height * 100}%" data-action="preview-node" data-id="${esc(node.id)}" data-node-type="${esc(node.type)}" ${available ? '' : 'disabled'} aria-label="${esc(`${label}，${meta.label}${available ? '，查看预览' : ''}`)}" title="${esc(meta.label)}"><span class="node-disc">${icon(done ? 'check' : meta.icon, node.type === 'B' || node.type === 'F' ? 28 : 22)}</span><span class="node-label">${esc(label)}</span></button>`;
        }).join('')}
        <div class="map-note"><span>${esc(asText(act.name, `第${state.act}幕`))}</span><span class="node-count">${Math.min(nodes.length, currentIndex + (nodes[currentIndex]?.completed ? 1 : 0))} / ${nodes.length}</span></div>
      </div></div>
      <details class="disclosure map-key" data-details="map-key"><summary>山河图记</summary><div class="map-legend">${Object.entries(NODE_META).slice(0, 7).map(([key, meta]) => `<span>${icon(meta.icon, 14)}${esc(meta.label)}</span>`).join('')}</div></details>
      ${this.inlineMessage()}`;
  }

  private routeMapView(state: RunState, routeMap: { nodes: RouteMapNode[]; path: string[] }): string {
    const act = this.currentAct();
    const nodes = routeMap.nodes.filter((node) => isRecord(node));
    const path = listOf<string>(routeMap.path);
    const traversed = new Set(path.slice(0, asNumber(state.step)));
    const available = new Set(this.game?.availableNodes().map((node) => node.key) ?? []);
    const maxDepth = Math.max(0, ...nodes.map((node) => asNumber(node.depth)));
    const height = Math.max(600, (maxDepth + 1) * 112 + 96);
    const x = (lane: number): number => 160 + clamp(lane, 0, 2) * 240;
    const y = (depth: number): number => 52 + (maxDepth - depth) * 108;
    const byKey = new Map(nodes.map((node) => [asText(node.key), node]));
    const connectors = nodes.flatMap((node) => listOf<string>(node.next)
      .map((nextKey) => byKey.get(nextKey))
      .filter((next): next is RouteMapNode => Boolean(next))
      .map((next) => {
        const completed = traversed.has(asText(node.key)) && traversed.has(asText(next.key));
        return `<path d="M${x(asNumber(node.lane))} ${y(asNumber(node.depth))} C${x(asNumber(node.lane))} ${y(asNumber(node.depth)) - 48} ${x(asNumber(next.lane))} ${y(asNumber(next.depth)) + 48} ${x(asNumber(next.lane))} ${y(asNumber(next.depth))}" fill="none" stroke="${completed ? '#d7bd7a' : '#9b9e75'}" stroke-width="${completed ? 2.4 : 1.3}" stroke-dasharray="${completed ? 'none' : '5 8'}" opacity="${completed ? '.78' : '.35'}"/>`;
      })).join('');
    const nodeTypeSummary: Record<string, string> = {
      C: '前路伏着敌手',
      E: '一段行旅',
      K: '因缘将至',
      L: '强敌守道',
      S: '坊市可交易',
      R: '山间可休整',
      B: '幕末守关',
      F: '终局一战',
    };
    const nodeMarkup = nodes.map((node) => {
      const key = asText(node.key);
      const meta = nodeMeta(asText(node.type));
      const entity = this.byId(node.id);
      const done = traversed.has(key) || Boolean(node.completed);
      const canEnter = available.has(key) && !done;
      const label = done || canEnter
        ? this.displayText(asText(node.label, asText(entity?.name, meta.label)))
        : meta.label;
      const description = done ? '已走过' : canEnter && node.description
        ? this.displayText(node.description)
        : nodeTypeSummary[node.type] || '前路未明';
      return `<button class="map-node ${canEnter ? 'available' : ''} ${done ? 'done' : ''} ${node.type === 'B' || node.type === 'F' ? 'boss' : ''}" style="left:${x(asNumber(node.lane)) / 8}%;top:${y(asNumber(node.depth)) / height * 100}%" data-action="preview-node" data-id="${esc(key)}" data-node-type="${esc(node.type)}" ${canEnter ? '' : 'disabled'} aria-label="${esc(`${label}，${description}${canEnter ? '，查看预览' : ''}`)}" title="${esc(description)}"><span class="node-disc">${icon(done ? 'check' : meta.icon, node.type === 'B' || node.type === 'F' ? 28 : 22)}</span><span class="node-label">${esc(label)}</span><small class="node-description">${esc(description)}</small></button>`;
    }).join('');
    const completed = state.nodes.filter((node) => node.completed).length;
    const progress = `${completed} / ${nodes.length ? maxDepth + 1 : 0}`;
    return `${this.stageHeading(`第${state.act}幕 · 山河图`, asText(act.name, `第${state.act}幕`))}
      <div class="map-goal"><span>${icon('flag', 17)}行程</span><b>${completed ? `已行 ${completed} 格` : '山河初展'}</b><span class="map-step">${progress}</span></div>
      <div class="map-scroll" data-map-key="${esc(this.mapIdentity(state))}" tabindex="0" aria-label="山河路线图"><div class="map-wrap" style="height:${height}px">${landscape()}<svg class="map-lines" viewBox="0 0 800 ${height}" preserveAspectRatio="none" aria-hidden="true">${connectors}</svg>${nodeMarkup}<div class="map-note"><span>${esc(asText(act.name, `第${state.act}幕`))}</span><span class="node-count">${progress}</span></div></div></div>
      <details class="disclosure map-key" data-details="map-key"><summary>山河图记</summary><div class="map-legend">${Object.entries(NODE_META).map(([, meta]) => `<span>${icon(meta.icon, 14)}${esc(meta.label)}</span>`).join('')}</div></details>
      ${this.inlineMessage()}`;
  }

  private reachableMapNode(id: string): RouteMapNode | undefined {
    if (!this.game || this.game.state.phase !== 'map') return undefined;
    const candidates = this.game.availableNodes().filter((node) => !node.completed);
    const byKey = candidates.find((node) => node.key === id);
    if (byKey) return byKey;
    const byId = candidates.filter((node) => node.id === id);
    return byId.length === 1 ? byId[0] : undefined;
  }

  private playerFacingSnippet(value: unknown, fallback: string): string {
    const text = this.displayText(value).trim();
    const internalLanguage = /(参考|配置|实现|设计|实测|首测|目标带|输入|读取|卡面|游戏原创|原创妖物|不承诺|静态|参数|数据|阶段列表|机制|隐藏阶段|公开组合|斗法规则|运行时|build|直接压力|普通压力|精英压力|首领压力|轮尾)/i;
    const clauses = text.split(/[，,。；;！？!?\n]/)
      .map((clause) => clause.trim())
      .filter((clause) => clause.length >= 5 && !internalLanguage.test(clause));
    return clauses.length ? `${clauses.slice(0, 2).join('，')}。` : fallback;
  }

  private nodePreviewMarkup(): string {
    const node = this.reachableMapNode(this.modalId);
    if (!node) {
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal node-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="node-preview-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">山河预览</p><h2 id="node-preview-title">前路已变</h2><p>这处行迹目前无法前往。</p><div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回山河</button></div></section></div>`;
    }
    const meta = nodeMeta(node.type);
    const entity = this.byId(node.id);
    const battleNode = ['C', 'L', 'B', 'F'].includes(node.type);
    const eventNode = node.type === 'E' || node.type === 'K';
    const enemyMethod = battleNode ? this.methodEntity(entity?.method) : undefined;
    const heading = battleNode
      ? asText(entity?.name, '前路敌手')
      : eventNode
        ? asText(entity?.name, meta.label)
        : meta.label;
    const body = battleNode
      ? this.playerFacingSnippet(
        entity?.identity,
        `${heading}守在山路前，修习${asText(enemyMethod?.name, '未知功法')}。`,
      )
      : eventNode
        ? this.playerFacingSnippet(entity?.scene || entity?.description || entity?.summary, '一段新的行旅即将展开。')
        : node.type === 'S'
          ? '前往坊市查看沿途可用之物。'
          : node.type === 'R'
            ? '前往山中歇息，为接下来的路程作准备。'
            : '前路尚未明朗。';
    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal node-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="node-preview-title" data-node-type="${esc(node.type)}">
      <button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button>
      <p class="eyebrow">${battleNode ? `${meta.label} · 对手功法` : eventNode ? '行旅预览' : '山河预览'}</p>
      <h2 id="node-preview-title">${esc(heading)}</h2>
      ${battleNode && enemyMethod ? `<p class="node-preview-method">所修功法 · ${esc(asText(enemyMethod.name))}</p>` : ''}
      <p class="node-preview-copy">${esc(body)}</p>
      <div class="dialog-actions node-preview-actions"><button class="button quiet" data-action="modal-close">返回山河</button><button class="button primary" data-action="confirm-node" data-autofocus>前往此处 ${icon('arrow', 15)}</button></div>
    </section></div>`;
  }

  private routeName(state: RunState): string {
    const routeId = listOf<string>(state.routes).at(-1) || (state as any).route;
    const route = this.routeObjects().find((item) => item.id === routeId);
    return localizeVisibleText(asText(route?.name, '山河旧径'));
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
    const playerHp = asNumber(state.hp, playerStats.max_hp);
    const profile = asText(enemy?.tier, node?.type === 'B' ? 'boss' : node?.type === 'L' ? 'elite' : 'normal');
    const profileLabel = localizeTier(profile);
    const enemyBrief = this.playerFacingSnippet(
      enemy?.identity,
      `${asText(enemy?.name, '前路敌手')}守在山路前。`,
    );
    const committedEvent = Boolean((state as any)._pendingEvent);
    return `${this.stageHeading(`战前预览 · ${profileLabel}`, asText(enemy?.name, '未知敌手'))}
      <section class="preview-arena preview-essentials"><div class="preview-side player-side">${portrait(this.visualKind(player, this.methodEntity(state.method)), true)}<div><span class="eyebrow">行者</span><h2>${esc(asText(state.name, '行者'))}</h2><small class="preview-vital">气血 ${formatNumber(playerHp)} / ${formatNumber(playerStats.max_hp)} · ${esc(asText(this.methodEntity(state.method)?.name, '当前功法'))}</small></div></div><div class="versus-seal">${sigil('swords', 'gold')}<span>斗法</span></div><div class="preview-side enemy-side">${portrait(this.visualKind(enemyLoadout, enemy), true)}<div><span class="eyebrow">${esc(profileLabel)}</span><h2>${esc(asText(enemy?.name, enemyLoadout.name || '敌手'))}</h2><small class="preview-vital">所修功法 · ${esc(asText(method?.name, '未知功法'))}</small><p class="preview-enemy-brief">${esc(enemyBrief)}</p></div></div></section>
      <details class="preview-preparation-details disclosure" data-details="battle-preparation-details">
        <summary>双方战力与对手招式</summary>
        <div class="preview-details"><div class="preview-column"><div class="detail-heading"><span>行者战力</span><b>${esc(asText(this.methodEntity(state.method)?.name, '当前功法'))}</b></div><div class="preview-stat-line">${this.previewStatsLine(playerStats)}</div></div>
        <div class="preview-column enemy-preview-column"><div class="detail-heading"><span>对手战力</span><b>${esc(asText(method?.name, '未知功法'))}</b></div><p>${esc(asText(method?.role, '修行方向'))}</p><div class="loadout-row"><span>普攻</span><div>${esc(this.displayText(method?.actions?.basic?.quick || '稳步出手。'))}</div></div><div class="loadout-row"><span>怒技</span><div>${esc(this.displayText(method?.actions?.rage?.quick || '蓄满怒气后释放。'))}</div></div><div class="loadout-row"><span>天赋</span><div>${listOf<string>(enemyLoadout.talents).map((talent) => { const item = this.talentEntity(enemyLoadout.method, talent); return `<span class="mini-chip">${esc(asText(item?.name, '未名天赋'))}</span>`; }).join('') || '<span class="muted">暂无天赋</span>'}</div></div><div class="loadout-row"><span>法宝</span><div>${loadoutArtifacts(enemyLoadout).map((stack) => this.artifactChip(stack)).join('') || '<span class="muted">未带法宝</span>'}</div></div><div class="loadout-row"><span>对手属性</span><div>${this.previewStatsLine(enemyStats)}</div></div></div>
        <div class="preview-column pressure-column"><div class="detail-heading"><span>对手特点</span><b>${esc(profileLabel)}</b></div><div class="tag-row">${listOf<any>(enemy?.pressure).map((value) => `<span class="pressure-tag">${esc(this.displayText(value))}</span>`).join('') || '<span class="muted">暂无特点</span>'}</div><h3 class="counterplay-heading">应对之法</h3><ul class="counterplay-list">${listOf<any>(enemy?.counterplay).slice(0, 2).map((value) => `<li>${esc(this.displayText(value))}</li>`).join('') || '<li>观察敌手的怒气，安排护盾与攻势。</li>'}</ul></div></div>
      </details>
      ${this.inlineMessage()}<div class="stage-actions">${committedEvent ? '<span class="playback-hint">这场机缘已经承诺，战斗不可回避。</span>' : `<button class="button quiet" data-action="back">${icon('arrow', 16)}返回地图</button>`}<button class="button primary" data-action="fight" data-autofocus>开始斗法 ${icon('sword', 16)}</button></div>`;
  }

  private previewStatsLine(stats: Stats): string {
    return `<span>攻 <b>${formatNumber(stats.attack)}</b></span><span>防 <b>${formatNumber(stats.defense)}</b></span><span>气血 <b>${formatNumber(stats.max_hp)}</b></span><span>速 <b>${formatNumber(stats.speed)}</b></span>`;
  }

  private artifactChip(stack: ArtifactStack): string {
    const item = this.artifactEntity(stack.id);
    return `<span class="artifact-chip"><b>${esc(asText(item?.name, '未知法宝'))}</b><small>×${formatNumber(stack.stacks)}</small></span>`;
  }

  private battleView(state: RunState): string {
    const result = this.battleResult();
    const frames = result?.frames || [];
    const frame = frames[Math.min(this.battleCursor, Math.max(0, frames.length - 1))];
    if (!frame) {
      return `${this.stageHeading('斗法载入', '双方蓄势')}<div class="empty-state">${icon('help', 34)}<p>暂无战斗记录。</p><button class="button" data-action="continue-battle">继续</button></div>`;
    }
    const frameKind = FRAME_KIND_LABEL[asText(frame.kind)] || '战斗';
    const previous = this.battleCursor > 0 ? frames[this.battleCursor - 1] : undefined;
    const cue = battlePresentationCue(frame, previous);
    const feedback = this.battleVfx(frame, previous) + this.battleFeedback(frame, previous);
    const visibleFrames = frames.slice(0, this.battleCursor + 1);
    const logRows = visibleFrames.map((item, index) => {
      const absolute = Math.max(0, this.battleCursor - visibleFrames.length + 1 + index);
      const previousFrame = absolute > 0 ? frames[absolute - 1] : undefined;
      return this.battleLogRow(item, previousFrame);
    }).join('');
    return `${this.stageHeading('交锋', this.battleFinished ? (result?.outcome === 'player' ? '此战告捷' : result?.outcome === 'draw' ? '胜负未分' : '此身入劫') : '斗法', '', true)}
      <section class="battle-shell" data-battle-key="${esc(this.battleKey)}" data-paused="${this.battlePaused || Boolean(this.modal)}" style="--beat-duration:${battleBeatDuration(frame, this.battleSpeed)}ms">
        <div class="battle-context"><span data-battle-round>${this.battleFinished ? `历 ${formatNumber(result?.rounds)} 回合` : `第 ${formatNumber(frame.round)} 回合`}</span><strong data-battle-context>${esc(frameKind)}</strong></div>
        <div class="combat-arena" data-frame-index="${this.battleCursor}" data-frame-kind="${esc(asText(frame.kind))}" data-action-kind="${cue.actionKind}" data-motion-trigger="${this.battleCursor % 2}">${landscape()}<span class="arena-vignette" aria-hidden="true"></span>${this.fighterMarkup(frame.player, 'player', frame.actor === 'player', frame, cue)}<div class="battle-stage-core"><span class="round-seal">${this.battleFinished ? (result?.outcome === 'player' ? '胜' : result?.outcome === 'draw' ? '平' : '劫') : frame.round}</span><strong data-frame-text>${esc(localizeBattleText(asText(frame.text, '双方试探')))}</strong>${frame.source ? `<small data-frame-source>${esc(this.sourceLabel(frame.source))}</small>` : ''}<span data-battle-amount>${this.battleAmountMarkup(frame, previous)}</span></div>${this.fighterMarkup(frame.enemy, 'enemy', frame.actor === 'enemy', frame, cue)}${feedback}</div>
        <div class="battle-controls"><div class="speeds" role="group" aria-label="战斗速度"><button data-action="battle-speed" data-speed="1" data-focus-key="battle-speed-1" aria-pressed="${this.battleSpeed === 1}" aria-label="一倍速">1×</button><button data-action="battle-speed" data-speed="2" data-focus-key="battle-speed-2" aria-pressed="${this.battleSpeed === 2}" aria-label="二倍速">2×</button><button data-action="battle-speed" data-speed="4" data-focus-key="battle-speed-4" aria-pressed="${this.battleSpeed === 4}" aria-label="四倍速">4×</button><button data-action="battle-pause" data-focus-key="battle-pause" aria-pressed="${this.battlePaused}" aria-label="${this.battlePaused ? '继续播放' : '暂停播放'}">${this.battlePaused ? '继续' : '暂停'}</button></div>${this.battleControlAction(state)}</div>
        <div class="replay-progress" aria-label="战斗播放进度"><i style="width:${frames.length <= 1 ? 100 : Math.round(this.battleCursor / Math.max(1, frames.length - 1) * 100)}%"></i></div>
        ${this.battleLoadout(state)}
        ${this.battleSettlementMarkup()}
        <details class="battle-log-disclosure disclosure" data-details="battle-log"><summary>战报</summary>
          <div class="battle-log-head"><span>战痕</span><button class="text-link log-follow" data-action="battle-log-follow" ${this.battleLogFollow ? 'hidden' : ''} aria-label="回到最新战报">回到最新 ↓</button><button class="text-link log-mode" data-action="battle-log-mode" aria-pressed="${this.detailedLog}">${this.detailedLog ? '详录' : '简录'}</button></div>
          <div class="battle-log ${this.detailedLog ? 'detailed-mode' : 'simple-mode'}" data-log-key="${esc(this.battleKey)}" data-frame-index="${this.battleCursor}" data-log-mode="${this.detailedLog}" tabindex="0" role="region" aria-label="可滚动战报">${logRows || '<p class="simple-log-empty">双方蓄势。</p>'}</div>
        </details>
      </section>${this.inlineMessage()}`;
  }

  private battleControlAction(state: RunState): string {
    const result = this.battleResult();
    const canContinue = result?.outcome === 'draw' && asNumber(state.battleInput?.roundLimit) < 4096;
    if (!this.battleFinished) {
      return `<button class="button small" data-control-cta data-action="battle-skip" data-focus-key="battle-skip" aria-label="跳过播放，跳至结算">跳至结算 ${icon('arrow', 15)}</button>`;
    }
    if (result?.outcome === 'draw') {
      return `<button class="button primary small" data-control-cta data-action="continue-battle" data-autofocus ${canContinue ? '' : 'disabled'}>${canContinue ? '继续战斗' : '已达 4096 轮上限'} ${icon('arrow', 15)}</button>`;
    }
    return `<button class="button primary small" data-control-cta data-action="battle-finish" data-autofocus>${result?.outcome === 'player' ? '收下战果' : '回望此局'} ${icon('arrow', 15)}</button>`;
  }

  private battleSettlementMarkup(): string {
    if (!this.battleFinished) return '';
    const result = this.battleResult();
    const note = result?.outcome === 'player'
      ? `留存气血 ${formatNumber(result?.playerHp)}`
      : result?.outcome === 'draw'
        ? asNumber(this.gameState()?.battleInput?.roundLimit) < 4096
          ? '胜负未分，可继续交锋。'
          : '僵持已久，可收手离去。'
        : '';
    return `<section class="battle-settlement" aria-label="斗法结算">${note ? `<p>${note}</p>` : ''}<details class="end-diagnostics" data-details="battle-diagnostics"><summary>斗法详录</summary>${this.battleDiagnostics(result)}</details></section>`;
  }

  private battleLoadout(state: RunState): string {
    const method = this.methodEntity(state.method);
    const selectedTalents = listOf<string>(state.talents?.[state.method])
      .map((id) => this.talentEntity(state.method, id))
      .filter((value): value is Entity => Boolean(value));
    const actions = [
      { label: '普攻', action: method?.actions?.basic },
      { label: '怒技', action: method?.actions?.rage },
    ];
    return `<details class="battle-loadout disclosure" data-details="battle-loadout" aria-label="当前构筑">
      <summary>当前构筑 · ${esc(asText(method?.name, state.method))}</summary>
      <div class="profile-build"><div class="profile-talents"><span class="eyebrow">已选天赋</span><div class="profile-talent-list">${selectedTalents.length ? selectedTalents.map((talent) => this.talentButton(talent, state.method)).join('') : '<span class="muted">未选天赋</span>'}</div></div>
      <div class="profile-actions"><span class="eyebrow">当前功法动作</span>${actions.map(({ label, action }) => `<div class="profile-action"><b>${esc(label)} · ${esc(asText(action?.name, '动作'))}</b><small>${esc(this.displayText(asText(action?.quick, asText(action?.description, '按功法规则结算。'))))}</small></div>`).join('')}</div></div>
    </details>`;
  }

  private fighterStatusMarkup(fighter: FighterView): string {
    const status = fighter.statuses || {};
    return Object.entries(status)
      .filter(([key, value]) => asNumber(value) > 0 && !(key === 'day_night' && fighter.method !== 'RKF10'))
      .map(([key, value]) => {
        const label = STATUS_LABEL[key] || localizeStatus(key);
        const display = key === 'day_night' ? (asNumber(value) === 2 ? '昼' : '夜') : formatNumber(value);
        return `<span title="${esc(label)}">${icon(STATUS_ICON[key] || 'star', 11)}${esc(label)} ${display}</span>`;
      }).join('') || '<span class="muted">无战斗状态</span>';
  }

  private fighterLockedMarkup(fighter: FighterView): string {
    const locked = fighter.lockedAction ? [fighter.lockedAction] : [];
    return locked.length ? `<div class="locked-actions"><span>锁定</span>${locked.map(action => `<b>${esc(this.actionLabel(fighter.method, action))}</b>`).join('')}</div>` : '';
  }

  private fighterMarkup(
    fighter: FighterView,
    side: 'player' | 'enemy',
    acting: boolean,
    frame?: BattleFrame,
    cue = battlePresentationCue(frame || { kind: '', text: '', round: 0 } as BattleFrame),
  ): string {
    const art = side === 'player' ? this.visualKind(this.game?.player, this.methodEntity(this.gameState()?.method)) : this.visualKind((this.gameState() as any)?.battleInput?.enemy, this.enemyEntity());
    const action = acting ? (fighter.lockedAction || this.frameAction(frame, side)) : undefined;
    const turnLabel = action === 'rage_action' ? '怒技' : action === 'basic_action' ? '普攻' : '出手';
    const stats = this.previewStats(this.game?.state.battleInput?.[side] || {}, this.methodEntity(fighter.method));
    const motion = cue[side === 'player' ? 'playerMotion' : 'enemyMotion'];
    const lowHealth = pct(fighter.hp, fighter.maxHp) <= 30;
    const rageReady = fighter.rageCap > 0 && fighter.rage >= fighter.rageCap;
    return `<article class="combatant ${side === 'player' ? 'side-p' : 'side-e enemy'} ${acting ? 'acting' : ''} ${lowHealth ? 'low-health' : ''} ${rageReady ? 'rage-ready' : ''}" data-side="${side}" data-motion="${motion}" data-motion-trigger="${this.battleCursor % 2}" data-frame-index="${this.battleCursor}" data-low-health="${lowHealth}" data-rage-ready="${rageReady}" aria-label="${esc(`${side === 'player' ? '我方' : '敌方'}战斗信息：${fighter.name}`)}">
      <div class="fighter-art"><span class="fighter-side-badge">${side === 'player' ? '我方' : '敌方'}</span>${portrait(art, true)}</div>
      <div class="fighter-identity"><h2>${esc(asText(fighter.name, side === 'player' ? '行者' : '敌手'))}</h2>${acting ? `<span class="turn-mark">${turnLabel}</span>` : ''}</div>
      <div class="fighter-bars">
        <div class="fighter-numbers"><span>生命 <b data-value="hp">${formatNumber(fighter.hp)}</b> / ${formatNumber(fighter.maxHp)}</span><span class="shield-count">${icon('shield', 12)}护盾 <b data-value="shield">${formatNumber(fighter.shield)}</b></span></div>
        <div class="bar hp" role="progressbar" aria-label="${esc(`${fighter.name}生命`)}" aria-valuemin="0" aria-valuemax="${fighter.maxHp}" aria-valuenow="${fighter.hp}"><span style="width:${pct(fighter.hp, fighter.maxHp)}%"></span></div>
        <div class="fighter-numbers"><span>怒气</span><span data-value="rage">${formatNumber(fighter.rage)} / ${formatNumber(fighter.rageCap)}</span></div>
        <div class="bar rage" role="progressbar" aria-label="${esc(`${fighter.name}怒气`)}" aria-valuemin="0" aria-valuemax="${fighter.rageCap}" aria-valuenow="${fighter.rage}"><span style="width:${pct(fighter.rage, fighter.rageCap)}%"></span></div>
      </div>
      <details class="fighter-detail disclosure" data-details="${side}-fighter-detail"><summary>状态与战力</summary>
        <div class="fighter-core-stats"><span>攻 <b>${formatNumber(stats.attack)}</b></span><span>防 <b>${formatNumber(stats.defense)}</b></span><span>速 <b>${formatNumber(stats.speed)}</b></span></div>
        <div class="combat-statuses">${this.fighterStatusMarkup(fighter)}</div>${this.fighterLockedMarkup(fighter)}
      </details>
    </article>`;
  }

  private updateCombatant(
    element: HTMLElement,
    fighter: FighterView,
    side: 'player' | 'enemy',
    frame: BattleFrame,
    cue: ReturnType<typeof battlePresentationCue>,
    cursor: number,
    changed: boolean,
  ): void {
    const hp = element.querySelector<HTMLElement>('[data-value="hp"]');
    const shield = element.querySelector<HTMLElement>('[data-value="shield"]');
    const rage = element.querySelector<HTMLElement>('[data-value="rage"]');
    if (hp) hp.textContent = formatNumber(fighter.hp);
    if (shield) shield.textContent = formatNumber(fighter.shield);
    if (rage) rage.textContent = `${formatNumber(fighter.rage)} / ${formatNumber(fighter.rageCap)}`;
    const hpBar = element.querySelector<HTMLElement>('.bar.hp');
    const rageBar = element.querySelector<HTMLElement>('.bar.rage');
    if (hpBar) {
      hpBar.setAttribute('aria-valuemax', String(fighter.maxHp));
      hpBar.setAttribute('aria-valuenow', String(fighter.hp));
      const fill = hpBar.querySelector<HTMLElement>('span');
      if (fill) fill.style.width = `${pct(fighter.hp, fighter.maxHp)}%`;
    }
    if (rageBar) {
      rageBar.setAttribute('aria-valuemax', String(fighter.rageCap));
      rageBar.setAttribute('aria-valuenow', String(fighter.rage));
      const fill = rageBar.querySelector<HTMLElement>('span');
      if (fill) fill.style.width = `${pct(fighter.rage, fighter.rageCap)}%`;
    }
    const lowHealth = String(pct(fighter.hp, fighter.maxHp) <= 30);
    const rageReady = String(fighter.rageCap > 0 && fighter.rage >= fighter.rageCap);
    element.classList.toggle('low-health', lowHealth === 'true');
    element.classList.toggle('rage-ready', rageReady === 'true');
    if (element.dataset.lowHealth !== lowHealth) element.dataset.lowHealth = lowHealth;
    if (element.dataset.rageReady !== rageReady) element.dataset.rageReady = rageReady;
    if (!changed) return;

    const acting = frame.actor === side;
    element.classList.toggle('acting', acting);
    element.dataset.frameIndex = String(cursor);
    element.dataset.motion = cue[side === 'player' ? 'playerMotion' : 'enemyMotion'];
    element.dataset.motionTrigger = String(cursor % 2);
    const identity = element.querySelector<HTMLElement>('.fighter-identity');
    if (identity) {
      const turnMark = identity.querySelector<HTMLElement>('.turn-mark');
      const action = acting ? (fighter.lockedAction || this.frameAction(frame, side)) : undefined;
      const label = action === 'rage_action' ? '怒技' : action === 'basic_action' ? '普攻' : '出手';
      if (acting && turnMark) turnMark.textContent = label;
      else if (acting) identity.insertAdjacentHTML('beforeend', `<span class="turn-mark">${label}</span>`);
      else turnMark?.remove();
    }
    const statuses = element.querySelector<HTMLElement>('.combat-statuses');
    if (statuses) statuses.innerHTML = this.fighterStatusMarkup(fighter);
    const locked = element.querySelector<HTMLElement>('.locked-actions');
    const lockedMarkup = this.fighterLockedMarkup(fighter);
    if (locked && lockedMarkup) locked.outerHTML = lockedMarkup;
    else if (locked) locked.remove();
    else if (lockedMarkup) element.insertAdjacentHTML('beforeend', lockedMarkup);
  }

  private frameAction(frame: BattleFrame | undefined, side: 'player' | 'enemy'): 'basic_action' | 'rage_action' | undefined {
    if (!frame || frame.actor !== side) return undefined;
    if (frame.kind === 'action' && /怒技/.test(asText(frame.text))) return 'rage_action';
    if (frame.kind === 'action' && /普攻/.test(asText(frame.text))) return 'basic_action';
    return undefined;
  }

  private trustedCrit(frame: BattleFrame): boolean {
    return /暴击|会心|critical|crit/i.test(asText(frame.text));
  }

  private frameDeltas(frame: BattleFrame, previous?: BattleFrame): string[] {
    if (!previous) return [];
    const deltas: string[] = [];
    for (const [key, name] of [['player', '行者'], ['enemy', '敌手']] as const) {
      const hp = frame[key].hp - previous[key].hp;
      const shield = frame[key].shield - previous[key].shield;
      const rage = frame[key].rage - previous[key].rage;
      if (hp < 0) deltas.push(`${name} 气血 -${formatNumber(-hp)}`);
      if (hp > 0) deltas.push(`${name} 治疗 +${formatNumber(hp)}`);
      if (shield < 0) deltas.push(`${name} ${frame.target === key && (frame.kind === 'damage' || frame.kind === 'dot') ? '护盾吸收' : '护盾'} ${formatNumber(-shield)}`);
      if (shield > 0) deltas.push(`${name} 护盾 +${formatNumber(shield)}`);
      if (rage < 0) deltas.push(`${name} 怒气 -${formatNumber(-rage)}`);
      if (rage > 0) deltas.push(`${name} 怒气 +${formatNumber(rage)}`);
    }
    return deltas;
  }

  private battleAmountMarkup(frame: BattleFrame, previous?: BattleFrame): string {
    if (!previous) return '';
    const deltas = this.frameDeltas(frame, previous);
    const hpLoss = (previous.player.hp - frame.player.hp) + (previous.enemy.hp - frame.enemy.hp);
    const shieldLoss = frame.target
      ? Math.max(0, previous[frame.target].shield - frame[frame.target].shield)
      : (previous.player.shield - frame.player.shield) + (previous.enemy.shield - frame.enemy.shield);
    const hpGain = (frame.player.hp - previous.player.hp) + (frame.enemy.hp - previous.enemy.hp);
    const shieldGain = (frame.player.shield - previous.player.shield) + (frame.enemy.shield - previous.enemy.shield);
    if (hpLoss > 0 && shieldLoss > 0) {
      return `<b class="battle-amount damage" data-amount-kind="${esc(asText(frame.kind))}">-${formatNumber(hpLoss)} · 护盾吸收 ${formatNumber(shieldLoss)}</b>`;
    }
    if (hpLoss > 0) return `<b class="battle-amount damage" data-amount-kind="${esc(asText(frame.kind))}">-${formatNumber(hpLoss)}</b>`;
    if (shieldLoss > 0) return `<b class="battle-amount shield-loss" data-amount-kind="${esc(asText(frame.kind))}">护盾吸收 ${formatNumber(shieldLoss)}</b>`;
    if (hpGain > 0) return `<b class="battle-amount gain" data-amount-kind="${esc(asText(frame.kind))}">+${formatNumber(hpGain)}</b>`;
    if (shieldGain > 0) return `<b class="battle-amount gain" data-amount-kind="${esc(asText(frame.kind))}">+${formatNumber(shieldGain)} 护盾</b>`;
    if (frame.kind === 'rage' && frame.amount !== undefined) {
      return `<b class="battle-amount neutral" data-amount-kind="rage">怒气 ${formatNumber(frame.amount)}</b>`;
    }
    return deltas.length ? '' : frame.amount === undefined ? '' : `<b class="battle-amount neutral" data-amount-kind="${esc(asText(frame.kind))}">${formatNumber(frame.amount)}</b>`;
  }

  private battleVfx(frame: BattleFrame, previous?: BattleFrame): string {
    if (!previous || this.battleFinished) return '';
    let target: 'player' | 'enemy' | undefined;
    let row = 0;
    let kind = '';
    for (const side of ['player', 'enemy'] as const) {
      const before = previous[side];
      const after = frame[side];
      if (after.hp < before.hp || (frame.target === side &&
          ['damage', 'dot'].includes(frame.kind) && after.shield < before.shield)) {
        target = side; kind = 'attack'; row = 0; break;
      }
      if (after.hp > before.hp) {
        target = side; kind = 'heal'; row = 1; break;
      }
      if (after.shield > before.shield) {
        target = side; kind = 'shield'; row = 2; break;
      }
    }
    if (!target) return '';
    const critical = kind === 'attack' && this.trustedCrit(frame);
    return `<div class="combat-vfx target-${target === 'player' ? 'p' : 'e'} kind-${kind} ${critical ? 'critical' : ''}" style="--fx-duration:${Math.max(170, battleBeatDuration(frame, this.battleSpeed))}ms" aria-hidden="true"><span class="vfx-sprite" style="--row:${row};background-image:url('./assets/generated/combat-vfx-atlas.webp')"></span></div>`;
  }

  private battleFeedback(frame: BattleFrame, previous?: BattleFrame): string {
    if (!previous) return '';
    const changes: Array<{ side: 'p' | 'e'; kind: string; text: string; crit?: boolean }> = [];
    const damageFrame = frame.kind === 'damage' || frame.kind === 'dot';
    for (const [key, side] of [['player', 'p'], ['enemy', 'e']] as const) {
      const before = previous[key];
      const after = frame[key];
      const hpDelta = after.hp - before.hp;
      const shieldDelta = after.shield - before.shield;
      if (hpDelta < 0) changes.push({ side, kind: 'damage', text: `-${formatNumber(-hpDelta)}`, crit: damageFrame && this.trustedCrit(frame) && frame.actor !== key });
      if (hpDelta > 0) changes.push({ side, kind: 'heal', text: `+${formatNumber(hpDelta)}` });
      if (shieldDelta > 0) changes.push({ side, kind: 'shield', text: `护盾 +${formatNumber(shieldDelta)}` });
      if (shieldDelta < 0) {
        const absorbed = damageFrame && frame.target === key;
        changes.push({ side, kind: 'shield-loss', text: absorbed ? `护盾吸收 ${formatNumber(-shieldDelta)}` : `护盾 -${formatNumber(-shieldDelta)}` });
      }
      for (const status of new Set([...Object.keys(before.statuses), ...Object.keys(after.statuses)])) {
        const delta = asNumber(after.statuses[status]) - asNumber(before.statuses[status]);
        if (delta > 0) changes.push({ side, kind: 'status-add', text: `${STATUS_LABEL[status] || localizeStatus(status)} +${delta}` });
        if (delta < 0) changes.push({ side, kind: 'status-use', text: `${STATUS_LABEL[status] || localizeStatus(status)} ${delta}` });
      }
    }
    const stacks = { p: 0, e: 0 };
    return `<div class="combat-feedback-layer" aria-hidden="true">${changes.slice(0, 10).map((item) => `<span class="combat-float side-${item.side} ${item.kind} ${item.crit ? 'crit' : ''}" style="--stack:${stacks[item.side]++}"><b>${esc(item.text)}</b></span>`).join('')}</div>`;
  }

  private battleLogRow(frame: BattleFrame, previous?: BattleFrame): string {
    const kind = FRAME_KIND_LABEL[asText(frame.kind)] || '战斗';
    const actor = frame.actor === 'player' ? '我方' : frame.actor === 'enemy' ? '敌方' : '天道';
    const source = frame.source ? ` · ${this.sourceLabel(frame.source)}` : '';
    const deltas = this.frameDeltas(frame, previous);
    const outcome = deltas.join('；') || (frame.kind === 'rage' && frame.amount !== undefined ? `怒气 ${formatNumber(frame.amount)}` : '');
    if (!this.detailedLog) {
      return `<p class="battle-log-row simple"><span>第${formatNumber(frame.round)}回合</span><b>${esc(actor)} · ${esc(kind)}${esc(source)}</b><em>${esc(localizeBattleText(asText(frame.text, '气机交锋')))}${outcome ? ` · ${esc(outcome)}` : ''}</em></p>`;
    }
    return `<p class="battle-log-row detailed"><span>第${formatNumber(frame.round)}回合</span><b>${esc(actor)} · ${esc(kind)}${esc(source)} · ${esc(localizeBattleText(asText(frame.text, '气机交锋')))}</b><em>${esc(outcome)}</em></p>`;
  }

  private actionLabel(methodIdValue: unknown, action: any): string {
    const id = asText(action?.id, action);
    const method = this.methodEntity(methodIdValue);
    const actions = [method?.actions?.basic, method?.actions?.rage];
    const found = actions.find(item => item?.id === id || item?.name === id);
    return asText(found?.name, id === 'rage_action' ? method?.actions.rage.name : id === 'basic_action' ? method?.actions.basic.name : '动作');
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
      `${formatNumber(item.triggers)} 次生效`,
    ].filter(Boolean).join(' · ');
    return `<div class="diagnostics"><div><span class="eyebrow">本局显效</span>${active.length ? active.map((item) => `<p><b>${esc(this.displayText(item.name, this.sourceLabel(item.id)))}</b><span>${summary(item)}</span></p>`).join('') : '<p class="muted">暂无显效记录</p>'}</div><div><span class="eyebrow">尚未显效</span>${zero.length ? zero.map((item) => `<p><b>${esc(this.displayText(item.name, this.sourceLabel(item.id)))}</b><span>${esc(this.contributionReason(item))}</span></p>`).join('') : '<p class="muted">没有其他记录</p>'}</div></div>`;
  }

  private contributionReason(item: any): string {
    const artifact = this.artifactEntity(item?.id);
    const attributes = isRecord(artifact?.attributes) ? artifact.attributes : {};
    const hasAttributes = Object.values(isRecord(attributes.flat) ? attributes.flat : {}).some((value) => asNumber(value) !== 0) ||
      Object.values(isRecord(attributes.percent) ? attributes.percent : {}).some((value) => asNumber(value) !== 0);
    const effects = listOf<any>(artifact?.effects);
    if (artifact && hasAttributes && effects.length === 0) return '属性已生效';
    const reason = localizeReason(item?.reason);
    if (reason === '本局未满足触发条件') return '本局没有遇到合适时机';
    if (reason === '被动修正本局未用到') return '本局没有用上';
    if (reason.includes('条件效果未触发')) return '本局没有遇到合适时机';
    return reason;
  }

  private rewardView(state: RunState): string {
    const candidates = unique(listOf<string>((state as any).rewardCandidates || (state as any).rewards || [])).slice(0, 3);
    return `${this.stageHeading('战后取舍', '收一件法宝')}
      <div class="reward-grid">${candidates.map((id) => this.rewardCard(id)).join('') || '<p class="empty-note">本节点没有候选法宝。</p>'}</div>
      <div class="stage-actions"><button class="button quiet" data-action="reward" data-id="">舍下法宝，领取 ${formatNumber(asNumber(this.rules().economy?.artifact_decline_coins, 4))} 灵石 ${icon('coin', 15)}</button></div>${this.inlineMessage()}`;
  }

  private rewardCard(id: string): string {
    const artifact = this.artifactEntity(id);
    const rarity = entityRarity(artifact);
    const owned = listOf<ArtifactStack>(this.gameState()?.artifacts).find((stack) => stack.id === id);
    return `<article class="reward-card compact-choice-card rarity-${esc(rarity)}" data-id="${esc(id)}">
      <div class="reward-card-top"><span class="rarity-chip ${esc(rarity)}">${esc(RARITY_LABEL[rarity] || '普通')}</span>${owned ? `<span class="stack-note">已有 ×${formatNumber(owned.stacks)} · 叠加后 ×${formatNumber(owned.stacks + 1)}</span>` : '<span class="stack-note">首次获得</span>'}</div>
      <span class="choice-emblem" aria-hidden="true">${sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'gold' : 'jade')}</span>
      <h2>${esc(asText(artifact?.name, '未名法宝'))}</h2><p>${esc(localizeVisibleText(entitySummary(artifact)))}</p>
      <div class="compact-choice-actions"><button class="button small primary" data-action="reward" data-id="${esc(id)}">纳入命盘 ${icon('arrow', 14)}</button><button class="button small quiet" data-action="inspect-artifact" data-id="${esc(id)}">查看详录</button></div>
    </article>`;
  }

  private eventView(state: RunState): string {
    const event = this.currentEvent();
    if (!event) return this.renderErrorState('找不到当前事件内容。');
    const resultPhase = state.phase === 'event_result';
    const options = listOf<Entity>(event.options);
    return `<section class="event-page"><div class="event-scene-head"><div class="event-portrait">${portrait(this.visualKind(event, event), true)}</div><div><span class="eyebrow">${esc(event.event_type === 'core' ? '人物机缘' : '行旅事件')}</span><h2>${esc(asText(event.name, '山海一刻'))}</h2></div></div>
      ${resultPhase ? `<div class="event-result"><p>${esc(this.displayText(asText(state.resultText, '选择已经落定。')))}</p></div>` : `<p class="story-text">${esc(this.displayText(asText(event.scene || event.description, '风声停在你面前。')))}</p><div class="story-choices">${options.map((option) => `<div class="story-choice-wrap">${this.eventOption(option)}</div>`).join('')}</div>`}
      ${resultPhase ? `<div class="actions"><button class="button primary" data-action="continue" data-autofocus>继续前行 ${icon('arrow', 16)}</button></div>` : ''}${this.inlineMessage()}</section>`;
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
    return `<button class="event-option ${check.available ? '' : 'disabled'}" data-action="event" data-id="${esc(option.id)}" ${check.available ? '' : 'disabled'}><span class="event-option-main"><b>${esc(this.displayText(asText(option.label, option.name)))}</b><small>${esc(this.displayText(asText(option.quick || option.description, '')))}</small>${costs.length ? `<span class="event-costs">${costs.map((cost) => `<i>${esc(this.effectLabel(cost, true))}</i>`).join('')}</span>` : ''}${rewards.length ? `<span class="event-rewards">${rewards.map((reward) => `<i>${esc(this.effectLabel(reward, false))}</i>`).join('')}</span>` : ''}${!check.available ? `<em class="disabled-reason">${esc(check.reason || '当前条件不满足')}</em>` : ''}</span>${icon(check.available ? 'arrow' : 'close', 18)}</button>`;
  }

  private effectLabel(effect: any, cost: boolean): string {
    if (!isRecord(effect)) return asText(effect);
    if (effect.type === 'resource') {
      const resource = effect.resource === 'hp' ? '气血' : effect.resource === 'coins' ? '灵石' : '修为';
      return `${cost ? '-' : '+'}${this.formatResolvedAmount(effect, resource)}`;
    }
    if (effect.type === 'artifact') return `${cost ? '失去' : '获得'}法宝 ${asText(this.artifactEntity(effect.id)?.name, '未名法宝')}${asNumber(effect.count, 1) > 1 ? ` ×${formatNumber(effect.count)}` : ''}`;
    if (effect.type === 'method') return `${cost ? '失去' : '获得'}功法 ${asText(this.methodEntity(effect.id)?.name, '未名功法')}`;
    if (effect.type === 'preparation') return `${cost ? '消耗' : '准备'}下一战护盾 ${formatNumber(this.resolveAmount(effect))}`;
    if (effect.type === 'pool') {
      const quality = ({ common_artifact: '普通', rare_artifact: '稀有', legendary_artifact: '传奇' } as Record<string, string>)[asText(effect.pool)] || '';
      return `${cost ? '失去' : '获得'}${quality}法宝 ×${formatNumber(asNumber(effect.count, 1))}`;
    }
    if (effect.type === 'swap_method') return '更换已学功法';
    return `${cost ? '消耗' : '获得'}机缘`;
  }

  private shopView(state: RunState): string {
    const items = listOf<any>(state.shop);
    return `${this.stageHeading('沿途补给', '坊市')}<div class="shop-balance"><span>${icon('coin', 18)}当前灵石 <b>${formatNumber(state.coins)}</b></span><span>库存 ${items.filter((item) => !item.sold).length} / ${items.length || 5}</span></div>
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
    const detailButton = artifact
      ? `<button class="button small quiet" data-action="inspect-artifact" data-id="${esc(asText(item.id))}">查看详录</button>`
      : '';
    const buyButton = sold ? '<span class="sold-stamp">售罄</span>' : `<button class="button small" data-action="buy" data-id="${esc(asText(item.id))}" title="${esc(disabledReason)}" ${canBuy ? '' : 'disabled'}>${icon('coin', 13)}${formatNumber(price)}</button>`;
    return `<article class="shop-item ${sold ? 'sold' : ''} ${artifact ? `rarity-${esc(entityRarity(artifact))}` : 'service-item'}"><div class="shop-item-art">${sigil(artifact ? this.artifactIcon(artifact) : kind === 'recovery' ? 'gourd' : 'shield', artifact ? 'jade' : 'shield')}</div><div class="shop-item-copy"><span class="rarity-chip ${artifact ? esc(entityRarity(artifact)) : ''}">${artifact ? esc(RARITY_LABEL[entityRarity(artifact)] || entityRarity(artifact)) : '服务'}</span><h2>${esc(label)}</h2><p>${esc(description)}</p>${!sold && !canBuy ? `<small class="shop-item-unavailable" role="status">${esc(disabledReason || '暂不可购买')}</small>` : ''}</div>${detailButton}${buyButton}</article>`;
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
    return `${this.stageHeading('途中歇息', '山中一息')}
      <section class="rest-summary"><div><span>当前气血</span><b>${formatNumber((this.game?.player as any)?.hp, 0)} / ${formatNumber(this.stats().max_hp)}</b></div><div><span>预备护盾</span><b>${formatNumber(state.preparation)}</b></div><div><span>当前功法</span><b>${esc(asText(currentMethod?.name, state.method))}</b></div></section>
      ${choices}${this.inlineMessage()}`;
  }

  private talentView(state: RunState): string {
    const talents = this.talentObjects();
    return `${this.stageHeading('修为突破', '一念悟道')}<div class="talent-grid">${talents.map((talent) => {
      return `<article class="talent-card compact-choice-card" data-id="${esc(talent.id)}">
        <span class="talent-tier">第 ${asNumber(talent.tier, 1)} 层 · ${localizeBranch(talent.branch)}</span>
        <span class="choice-emblem" aria-hidden="true">${sigil('book', 'gold')}</span>
        <h2>${esc(asText(talent.name, '未名天赋'))}</h2>
        <b>${esc(this.displayText(asText(talent.quick, '长久修行所得')))}</b>
        <div class="compact-choice-actions">${this.talentButton(talent, state.method, 'button small quiet talent-detail-trigger', '查看详录')}<button class="button small primary talent-select" data-action="talent" data-id="${esc(talent.id)}">悟得此法 ${icon('arrow', 14)}</button></div>
      </article>`;
    }).join('') || '<p class="empty-note">暂无可用天赋。</p>'}</div>${this.inlineMessage()}`;
  }

  private transitionView(state: RunState): string {
    const act = this.currentAct();
    const story = isRecord(act.story) ? act.story : {};
    return `${this.stageHeading('幕间', asText(story.title || act.name, `第${state.act}幕`))}<section class="transition-scene">${landscape()}<div><p>${esc(this.displayText(story.passage || story.boss_after || act.description, '你踏上下一段山海路。'))}</p></div></section><div class="stage-actions"><button class="button primary" data-action="continue" data-autofocus>进入下一幕 ${icon('arrow', 16)}</button></div>${this.inlineMessage()}`;
  }

  private endView(state: RunState): string {
    const win = state.phase === 'won';
    const result = state.battle;
    const artifacts = listOf<ArtifactStack>(state.artifacts);
    return `${this.stageHeading('行旅归档', asText(state.name, '无名行者'))}
      <p class="end-result-text">${esc(this.displayText(state.resultText, win ? '终战已毕。' : '失败不会抹去此行的选择。'))}</p>
      <section class="end-seal ${win ? 'win' : 'loss'}">${sigil(win ? 'sun' : 'moon', win ? 'gold' : 'fire')}<b>${win ? '通关' : '退场'}</b></section>
      <div class="end-summary"><div><span>行过节点</span><b>${state.history.length}</b></div><div><span>修为</span><b>${formatNumber(state.xp)}</b></div><div><span>灵石</span><b>${formatNumber(state.coins)}</b></div><div><span>法宝</span><b>${artifacts.reduce((total, item) => total + asNumber(item.stacks, 1), 0)}</b></div></div>
      ${result ? `<details class="end-diagnostics" data-details="end-diagnostics"><summary>最终斗法来源</summary>${this.battleDiagnostics(result)}</details>` : ''}<div class="stage-actions"><button class="button primary" data-action="export">${icon('arrow', 16)}导出命途记录</button><button class="button quiet" data-action="archives">查看通关构筑</button><button class="button quiet" data-action="new-run">重新起笔</button></div>${this.inlineMessage()}`;
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
    if (this.modal === 'node-preview') return this.nodePreviewMarkup();
    if (this.modal === 'archives') {
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal dialog-wide" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">山海行 · 归档</p><h2 id="dialog-title">通关构筑</h2><p>这里保存每一局走到终点的功法、天赋与法宝。</p>${this.archiveMarkup()}<div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    const state = this.gameState();
    if (this.modal === 'settings') {
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">静室</p><h2 id="dialog-title">设置</h2><div class="setting-row"><span>战报显示</span><button class="button small" data-action="battle-log-mode" aria-pressed="${this.detailedLog}">${this.detailedLog ? '详细' : '简明'}</button></div><div class="setting-row"><span>命途存档</span><div class="row"><button class="button small" data-action="export" ${state ? '' : 'disabled'}>导出</button><button class="button small" data-action="restart">重开</button></div></div><div class="setting-row"><span>帮助</span><button class="button small" data-action="help">查看</button></div><div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    if (this.modal === 'character' && state) {
      const method = this.methodEntity(state.method);
      const selectedTalents = listOf<string>(state.talents?.[state.method]).map((id) => this.talentEntity(state.method, id)).filter((item): item is Entity => Boolean(item));
      const stats = this.stats();
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">人物</p><h2 id="dialog-title">${esc(state.name)}</h2><p>${esc(asText(method?.name, state.method))} · ${esc(this.realmName(state.n))}</p><div class="character-stats">${(['max_hp', 'attack', 'defense', 'crit_rate', 'speed'] as const).map((key) => `<div><span>${STAT_LABEL[key]}</span><strong>${key === 'crit_rate' ? `${Math.round(asNumber(stats[key]) * 100)}%` : formatNumber(stats[key])}</strong></div>`).join('')}</div><div class="character-detail"><p>气血 ${formatNumber(state.hp)} / ${formatNumber(stats.max_hp)} · 修为 ${formatNumber(state.xp)} · 灵石 ${formatNumber(state.coins)}</p><p>已拥有功法：${state.ownedMethods.map((id) => esc(asText(this.methodEntity(id)?.name, id))).join('、') || '无'}</p><p>已选天赋：${selectedTalents.map((talent) => esc(asText(talent.name, talent.id))).join('、') || '无'}</p></div><div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    if (this.modal === 'artifact') {
      const artifact = this.artifactEntity(this.modalId);
      if (!artifact) return '';
      const owned = listOf<ArtifactStack>(state?.artifacts).find((item) => item.id === artifact.id);
      const attrs = isRecord(artifact.attributes) ? artifact.attributes : {};
      const flat = isRecord(attrs.flat) ? attrs.flat : {};
      const percent = isRecord(attrs.percent) ? attrs.percent : {};
      const effects = listOf<any>(artifact.effects);
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow item-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">法宝详录</p><h2 id="dialog-title">${esc(artifact.name)}</h2><p>${esc(rarityLabel(entityRarity(artifact)))}${owned ? ` · 当前叠层 ×${formatNumber(owned.stacks)}` : ' · 尚未持有'}</p><div class="item-dialog-art">${sigil(this.artifactIcon(artifact), entityRarity(artifact) === 'legendary' ? 'mythic' : 'jade')}</div><p>${esc(this.displayText(entitySummary(artifact)))}</p><div class="attribute-list">${Object.entries(flat).map(([key, value]) => `<span>${esc(statLabel(key))} <b>+${key === 'crit_rate' ? `${formatPercentPoints(value)}%` : formatNumber(value)}</b></span>`).join('')}${Object.entries(percent).map(([key, value]) => `<span>${esc(statLabel(key))} <b>+${formatPercentPoints(value)}%</b></span>`).join('')}</div><div class="effect-list">${effects.map((effect) => `<p>${esc(effectText(effect, (value) => this.displayText(value)))}</p>`).join('') || '<p class="muted">没有额外触发效果。</p>'}</div><div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    if (this.modal === 'talent') {
      const talent = this.talentEntity(this.modalMethodId, this.modalId);
      if (!talent) return '';
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow talent-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">天赋详录</p><h2 id="dialog-title">${esc(asText(talent.name, '未名天赋'))}</h2>${this.talentDetailMarkup(talent, this.modalMethodId)}<div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    if (this.modal === 'method') {
      const method = this.methodEntity(this.modalId || state?.method);
      if (!method) return '';
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">功法详录</p><h2 id="dialog-title">${esc(method.name)}</h2>${this.methodDetail(method)}<div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    if (this.modal === 'help') {
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">山海札</p><h2 id="dialog-title">行旅札记</h2><div class="help-text"><h3>山河</h3><p>路线和节点来自当前命途，完成眼前节点后才会推进。</p><h3>命盘</h3><p>这里查看当前功法的基础动作、怒技、天赋和法宝叠层。</p><h3>斗法</h3><p>战痕会随斗法展开；暂停、倍速和跳过只影响眼前回放。</p><h3>因缘</h3><p>此页只显示已经走过的行迹和留下的约定。</p></div><div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    const title = this.modal === 'restart' ? '重新起笔？' : this.modal === 'corrupt-save' ? '存档没有被覆盖' : '山海行提示';
    const body = this.modal === 'restart'
      ? '当前命途还没有结束。确认重新开始会用新命途替换自动存档。'
      : this.modal === 'corrupt-save'
        ? `${this.storageIssue || '自动存档无法通过校验。'} 你可以导出当前可见记录，或明确开始一局新的命途。`
        : this.error || '发生了一个未命名问题。';
    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">山海提示</p><h2 id="dialog-title">${esc(title)}</h2><p>${esc(body)}</p><div class="dialog-actions">${this.modal === 'restart' ? `<button class="button quiet" data-action="modal-close">先不重来</button><button class="button danger" data-action="confirm-restart" data-autofocus>确认重开</button>` : this.modal === 'corrupt-save' ? `<button class="button quiet" data-action="discard-save">清理损坏存档</button><button class="button primary" data-action="modal-close" data-autofocus>我知道了</button>` : `<button class="button primary" data-action="modal-close" data-autofocus>知道了</button>`}</div></section></div>`;
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

  private rememberModalTrigger(target: HTMLElement): void {
    if (this.modal && this.renderedModal) return;
    const selector = this.focusSelectorFor(target);
    if (selector) this.focusReturn = selector;
  }

  private closeModal(): void {
    this.modal = null;
    this.modalId = '';
    this.modalMethodId = '';
    this.render();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const modal = this.root.querySelector<HTMLElement>('.modal[role="dialog"]');
    if (modal && event.key === 'Tab') {
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first && last && (!modal.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last))) {
        event.preventDefault();
        (modal.contains(document.activeElement) && event.shiftKey ? last : first).focus();
      }
      return;
    }
    if (event.key === 'Escape' && this.modal) {
      event.preventDefault();
      this.closeModal();
      return;
    }
    if (event.code === 'Space' && !event.repeat && !this.modal && this.view === 'journey' && this.gameState()?.phase === 'battle') {
      const target = event.target as HTMLElement | null;
      if (!target?.matches('input, textarea, select, button, summary, [contenteditable="true"]')) {
        event.preventDefault();
        this.battlePaused = !this.battlePaused;
        this.render();
      }
    }
  }

  private onClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || target.hasAttribute('disabled')) return;
    const action = target.dataset.action;
    if (!action) return;
    if (this.modal && !target.closest('.modal') && action !== 'modal-backdrop') return;
    event.preventDefault();
    this.notice = '';
    switch (action) {
      case 'home':
        this.stopPlayback();
        this.view = 'journey';
        this.game = null;
        this.modal = null;
        this.modalId = '';
        this.scrollToStageTop = true;
        this.render();
        break;
      case 'tab': {
        const next = asText(target.dataset.id);
        if (next === 'journey' || next === 'build' || next === 'karma') {
          this.view = next;
          this.render();
        }
        break;
      }
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
        this.seed = `${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
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
        this.rememberModalTrigger(target);
        this.modal = 'restart';
        this.modalId = '';
        this.render();
        break;
      case 'settings':
        this.rememberModalTrigger(target);
        this.modal = 'settings';
        this.modalId = '';
        this.render();
        break;
      case 'character':
        this.rememberModalTrigger(target);
        this.modal = 'character';
        this.modalId = '';
        this.render();
        break;
      case 'inspect-artifact':
        this.rememberModalTrigger(target);
        this.modal = 'artifact';
        this.modalId = asText(target.dataset.id);
        this.render();
        break;
      case 'inspect-talent':
        this.rememberModalTrigger(target);
        this.modal = 'talent';
        this.modalId = asText(target.dataset.id);
        this.modalMethodId = asText(target.dataset.method);
        this.render();
        break;
      case 'inspect-method':
        this.rememberModalTrigger(target);
        this.modal = 'method';
        this.modalId = asText(target.dataset.id, this.gameState()?.method);
        this.render();
        break;
      case 'help':
        this.rememberModalTrigger(target);
        this.modal = 'help';
        this.modalId = '';
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
        this.closeModal();
        break;
      case 'archives':
        this.rememberModalTrigger(target);
        this.openArchives();
        break;
      case 'export-archive':
        this.exportArchive(asText(target.dataset.id));
        break;
      case 'modal-close':
      case 'modal-backdrop':
        if (action === 'modal-backdrop' && event.target !== target) return;
        this.closeModal();
        break;
      case 'route':
        this.send({ type: 'route', id: asText(target.dataset.id) });
        break;
      case 'preview-node': {
        const id = asText(target.dataset.id);
        if (!this.reachableMapNode(id)) {
          this.notice = '这处行迹目前无法前往。';
          this.render();
          break;
        }
        this.rememberModalTrigger(target);
        this.modal = 'node-preview';
        this.modalId = id;
        this.render();
        break;
      }
      case 'confirm-node': {
        const candidate = this.reachableMapNode(this.modalId);
        this.modal = null;
        this.modalId = '';
        if (!candidate) {
          this.notice = '前路已变，这处行迹目前无法前往。';
          this.render();
          break;
        }
        this.send({ type: 'enter', id: candidate.key });
        break;
      }
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
      case 'battle-log-mode':
        this.detailedLog = !this.detailedLog;
        this.render();
        break;
      case 'battle-log-follow':
        this.battleLogFollow = true;
        {
          const log = this.root.querySelector<HTMLElement>('.battle-log');
          if (log) {
            log.scrollTop = log.scrollHeight;
            this.battleLogTop = log.scrollTop;
          }
          target.hidden = true;
        }
        break;
      case 'build-filter':
        if (target.dataset.filter === 'owned' || target.dataset.filter === 'all') {
          this.buildFilter = target.dataset.filter;
          this.render();
        }
        break;
      case 'build-rarity-filter':
        if (target.dataset.rarity === 'all' || target.dataset.rarity === 'common' ||
          target.dataset.rarity === 'rare' || target.dataset.rarity === 'legendary') {
          this.buildRarityFilter = target.dataset.rarity;
          this.render();
        }
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
        this.stopPlayback();
        this.game = null;
        this.modal = null;
        this.modalId = '';
        this.view = 'journey';
        this.seed = '';
        this.scrollToStageTop = true;
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
