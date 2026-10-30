import { loadContent } from './content.js';
import { calculateStats } from './combat.js';
import {
  battleBeatGameDuration,
  battleBeatDuration,
  battleFloatPresentation,
  battlePresentationCue,
  bloodShieldPresentation,
} from './battle-presentation.js';
import {
  battleReactionCue,
  battleReactionLabel,
  combatPresentationDuration,
  combatPresentationGroup,
  combatPresentationMotion,
  nextCombatPresentationCursor,
} from './battle-playback.js';
import type { CombatPresentationGroup } from './battle-playback.js';
import { ShanhaiGame } from './run.js';
import { characterJourneys, eventEchoes } from './narrative.js';
import {
  localizeBattleText,
  localizeBranch,
  localizeError,
  localizeReason,
  localizeSourceId,
  localizeStatus,
  localizeTier,
  talentSourceReference,
  localizeVisibleText,
} from './localization.js';
import {
  clearSavedRun,
  hasSavedRun,
  loadRun,
  loadWinningBuilds,
  saveRun,
  saveWinningBuild,
  SHANHAI_SAVE_KEY,
} from './persistence.js';
import { semanticTextMarkup } from './ui-text.js';
import { GameArt } from './game-art.js';
import { battleInsights, type BattleInsightContribution } from './battle-insights.js';
import { compareArtifactRemoval, type ArtifactBattleComparison } from './battle-comparison.js';
import { buildMechanicViews } from './build-mechanics.js';
import { buildVictoryEpitaph } from './epitaph.js';
import { MAX_EQUIPMENT_SLOTS } from './equipment.js';
import {
  DEVOURING_ARTIFACT_ID,
  artifactDevouredCount,
  devouredMultiplierForContent,
} from './artifact-growth.js';
import {
  artifactArt,
  characterArt,
  mapArt,
  sceneArt,
} from './art-assets.js';
import type {
  ArtifactRewardFamily,
  ArtifactInscription,
  ArtifactStack,
  BattleFrame,
  BattleResult,
  Content,
  Entity,
  FighterView,
  Loadout,
  PermanentSacrificeRule,
  RunCommand,
  RunNode,
  RouteMapNode,
  RunPhase,
  RunState,
  Stats,
} from './types.js';
import type { ShanhaiBuildRecord } from './persistence.js';
import { esc, icon, landscape, sigil } from '../art.js';

const REPLAY_KEY = 'suishi-shanhai-replay-v2-overhaul';
const INSCRIPTION_COPY: Record<ArtifactInscription, { label: string; effect: string }> = {
  twin: { label: '双生', effect: '法宝触发的伤害、治疗、护盾、怒气和状态输出额外结算一次。' },
  leech: { label: '噬血', effect: '该法宝实际造成敌方气血伤害时，回复伤害的 15%。' },
  swift: { label: '疾行', effect: '首回合法宝触发的伤害、治疗、护盾、怒气和状态输出额外结算一次。' },
};
const PERMANENT_RULE_COPY: Record<PermanentSacrificeRule['kind'], { label: string; detail: string }> = {
  shattered_core: {
    label: '碎丹化婴',
    detail: '气血上限与当前气血锁为 1；攻击提高 80%；每战以立誓时原气血上限的 250% 获得护盾。',
  },
  blind_sword: {
    label: '盲眼剑圣',
    detail: '不能暴击；普攻与怒技的直接、派生伤害按原暴击率转为无视防御、仍由护盾吸收的真实伤害。',
  },
  endless_chain: {
    label: '断普连诀',
    detail: '禁用普攻；每回合额外获得 80 怒气，达到当下怒气上限才施放怒技。',
  },
};
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
  reaction: '独立应变',
  phase: '昼夜',
  draw: '平局',
  end: '结束',
  summary: '折叠摘要',
  wait: '蓄气等待',
};
const FRAME_SOURCE_LABEL: Record<string, string> = {
  'RE037-A': '法则·碎丹化婴',
  'RE037-B': '法则·盲眼剑圣',
  'RE037-C': '法则·断普连诀',
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
const ARTIFACT_ICONS = ['jade', 'pearl', 'mirror', 'bell', 'gourd', 'ring', 'seal', 'feather', 'flame'];
const REWARD_FAMILY_LABEL: Record<ArtifactRewardFamily, string> = {
  sword: '御剑',
  guard: '护御',
  vitality: '生机',
  affliction: '侵蚀',
};
const REWARD_FAMILIES: ArtifactRewardFamily[] = ['sword', 'guard', 'vitality', 'affliction'];
const DEFAULT_PLAYER_NAME = '无名行者';
const RANDOM_PLAYER_NAMES = [
  '沈听澜', '陆清衡', '顾行舟', '苏照夜', '林怀玉', '谢长风',
  '云知微', '柳归尘', '宁问川', '叶临渊', '江望舒', '秦映雪',
  '宋疏影', '温见山', '白沐青', '许星河', '洛明霄', '楚云岫',
  '方闻溪', '程远山', '季南枝', '萧清和', '孟青岚', '夏初霁',
];

type RuntimeGame = ShanhaiGame;

type ModalKind =
  | 'restart'
  | 'corrupt-save'
  | 'archives'
  | 'node-preview'
  | 'battle-details'
  | 'settings'
  | 'chapter'
  | 'character'
  | 'artifact'
  | 'talent'
  | 'talent-tree'
  | 'talent-reset-confirm'
  | 'equipment-replace'
  | 'elite-challenge-confirm'
  | 'method'
  | 'help'
  | 'error'
  | null;

type BattleDetailTab = 'player' | 'enemy' | 'log' | 'result';
type FighterSummonSnapshot = NonNullable<FighterView['summons']>[number];
type UiEquipmentCommand =
  | { type: 'equip'; id: string; replace?: string }
  | { type: 'unequip'; id: string };

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

function normalizedPlayerName(value: unknown): string {
  return asText(value).trim().slice(0, 24) || DEFAULT_PLAYER_NAME;
}

function randomPlayerName(previous = ''): string {
  const choices = RANDOM_PLAYER_NAMES.filter((name) => name !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

function normalizedSeed(value: unknown): string {
  return asText(value).trim().slice(0, 48);
}

function freshSeed(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
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
    ...(isArtifactInscription(item?.inscription) ? { inscription: item.inscription } : {}),
    ...(typeof item?.devoured === 'number' ? { devoured: item.devoured } : {}),
  })).filter((item) => item.id);
}

function isArtifactInscription(value: unknown): value is ArtifactInscription {
  return value === 'twin' || value === 'leech' || value === 'swift';
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
  private playerName = randomPlayerName();
  private seed = '';
  private restartDestination: 'setup' | 'start' = 'setup';
  private notice = '';
  private error = '';
  private storageIssue = '';
  private archiveIssue = '';
  private archives: ShanhaiBuildRecord[] = [];
  private modal: ModalKind = null;
  private modalId = '';
  private modalMethodId = '';
  private battleDetailTab: BattleDetailTab = 'enemy';
  private pendingEquipmentId = '';
  private battleDetailsParent: { tab: BattleDetailTab; focusSelector: string } | null = null;
  private battleDetailReturnFocus = '';
  private talentTreeParent: { methodId: string; focusSelector: string } | null = null;
  private talentTreeReturnFocus = '';
  private pendingTalentResetItemId = '';
  private reforgeSourceId = '';
  private inscriptionArtifactId = '';
  private inscriptionChoice: ArtifactInscription = 'twin';
  private devourTargetId = '';
  private rewardRefineSourceId = '';
  private rewardRefineTargetId = '';
  private warmArtifactId = '';
  private buildFilter: 'owned' | 'all' = 'owned';
  private buildRarityFilter: 'all' | 'common' | 'rare' | 'legendary' = 'all';
  private rewardSearchFamily: ArtifactRewardFamily = 'sword';
  private loading = true;
  private battleCursor = 0;
  private battleSpeed = 1;
  private battlePaused = false;
  private battleFinished = false;
  private battleKey = '';
  private battleComparison: {
    key: string;
    artifactId: string;
    loading: boolean;
    result?: ArtifactBattleComparison;
    error?: string;
  } | null = null;
  private rafId = 0;
  private battleBeatElapsed = 0;
  private battleFloatProgress = 0;
  private lastPlaybackTime: number | null = null;
  private readonly gameArt = new GameArt();
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
    this.root.addEventListener('change', (event) => this.onChange(event));
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('resize', () => {
      const map = this.root.querySelector<HTMLElement>('.map-scroll');
      if (map) {
        this.fitMapScroller(map);
        this.mapScrollTop = map.scrollTop;
        this.mapScrollKey = map.dataset.mapKey || this.mapScrollKey;
      }
      this.syncTalentTreeConnectors();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopPlayback();
        this.gameArt.setBattlePaused(true);
      } else {
        this.syncGameArt();
        this.ensurePlayback();
      }
    });
    window.addEventListener('pagehide', (event) => {
      this.stopPlayback();
      if (event.persisted) this.gameArt.setBattlePaused(true);
      else this.gameArt.dispose();
    });
    window.addEventListener('pageshow', () => {
      this.syncGameArt();
      this.ensurePlayback();
    });
    window.addEventListener('beforeunload', () => {
      this.stopPlayback();
      this.gameArt.dispose();
    });
  }

  async boot(): Promise<void> {
    void this.gameArt.load().then((loaded) => {
      if (!loaded || this.loading) return;
      const state = this.gameState();
      if (state && this.canRenderBattleInPlace(state)) this.refreshBattleSceneArt();
      this.render();
    });
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
      const talentSource = talentSourceReference(source);
      const talent = talentSource &&
        this.talentEntity(talentSource.methodId, talentSource.talentId);
      return talent ? asText(talent.name) : this.sourceLabel(source);
    });
  }

  private textMarkup(value: unknown, fallback = ''): string {
    return semanticTextMarkup(this.displayText(value, fallback));
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
        this.playerName = normalizedPlayerName(restoredState.name);
        this.seed = restoredState.seed;
        this.selectedMethod = restoredState.method;
        this.notice = '';
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

  private send(command: RunCommand | UiEquipmentCommand): void {
    if (!this.game || this.busy) return;
    this.busy = true;
    this.error = '';
    this.notice = '';
    const beforePhase = this.game.state.phase;
    const equipmentBefore = this.equippedArtifacts().map((stack) => ({ ...stack }));
    const commitmentStatuses = this.game.state.eventCommitments?.map(record => record.status) ?? [];
    const acquiredId = command.type === 'reward' && command.id
      ? command.id
      : command.type === 'buy' && this.game.state.shop.find((item) =>
        item.id === command.id && item.kind === 'artifact',
      )
        ? command.id
        : '';
    const devourStack = command.type === 'devour'
      ? this.game.state.artifacts.find(stack => stack.id === command.id)
      : undefined;
    const devourTarget = devourStack ? { ...devourStack } : undefined;
    try {
      this.game.dispatch(command as unknown as RunCommand);
      const settled = this.game.state.eventCommitments?.filter((record, index) =>
        commitmentStatuses[index] === 'active' && record.status !== 'active') ?? [];
      if (settled.length) this.notice = settled.map(record =>
        `${record.snapshot.name}：${record.resultText || (record.status === 'fulfilled' ? '已兑现' : '已中止')}`,
      ).join(' ');
      if (command.type === 'equip') {
        this.appendNotice(this.equipmentResultNotice(command.id, equipmentBefore));
      } else if (command.type === 'unequip') {
        this.appendNotice(`已卸下${asText(this.artifactEntity(command.id)?.name, '法宝')}，仍收在背包；不会回血。`);
      } else if (command.type === 'devour' && devourTarget) {
        const cauldron = this.game.state.artifacts.find(stack => stack.id === DEVOURING_ARTIFACT_ID);
        const count = artifactDevouredCount(cauldron);
        const multiplier = devouredMultiplierForContent(this.content!, count);
        const active = this.game.state.equipment.slots.includes(DEVOURING_ARTIFACT_ID);
        this.appendNotice(
          `已吞噬${asText(this.artifactEntity(devourTarget.id)?.name, '法宝')}整栈 ×${formatNumber(devourTarget.stacks)}；` +
          `饕餮鼎累计吞 ${count} 栈，${active ? `装备时伤害乘区 ×${formatNumber(multiplier, 2)}` : `当前未装备，成长倍率 ×${formatNumber(multiplier, 2)} 暂不生效`}。`,
        );
      } else if (acquiredId) {
        this.appendNotice(this.acquisitionResultNotice(acquiredId, equipmentBefore));
      }
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

  private createRun(trigger?: HTMLElement): void {
    if (!this.content) return;
    if (this.storageIssue.startsWith('存档无法读取')) {
      this.modal = 'corrupt-save';
      this.render();
      return;
    }
    const nameInput = this.root.querySelector<HTMLInputElement>('[name="player-name"]');
    const seedInput = this.root.querySelector<HTMLInputElement>('[name="seed"]');
    this.playerName = normalizedPlayerName(nameInput?.value ?? this.playerName);
    this.seed = normalizedSeed(seedInput?.value ?? this.seed);
    if (!this.selectedMethod) {
      this.error = '请先选择一门开局功法。';
      this.render();
      return;
    }
    let savedRunExists = false;
    try {
      savedRunExists = hasSavedRun();
    } catch {
      this.error = '无法确认旧命途是否已保存，请检查浏览器存储后再试。';
      this.render();
      return;
    }
    if (this.game || savedRunExists) {
      if (trigger) this.rememberModalTrigger(trigger);
      this.restartDestination = 'start';
      this.modal = 'restart';
      this.render();
      return;
    }
    this.beginRun();
  }

  private beginRun(): void {
    if (!this.content) return;
    const nameInput = this.root.querySelector<HTMLInputElement>('[name="player-name"]');
    const seedInput = this.root.querySelector<HTMLInputElement>('[name="seed"]');
    this.playerName = normalizedPlayerName(nameInput?.value ?? this.playerName);
    this.seed = normalizedSeed(seedInput?.value ?? this.seed) || freshSeed();
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
      this.notice = '';
      this.scrollToStageTop = true;
      this.saveRun();
      this.render();
    } catch (cause) {
      this.error = localizeError(cause instanceof Error ? cause.message : '', '无法开启这局山海行。');
      this.render();
    }
  }

  private confirmRestart(): void {
    let previousSave: string | null | undefined;
    let previousReplay: string | null | undefined;
    try {
      previousSave = localStorage.getItem(SHANHAI_SAVE_KEY);
      previousReplay = localStorage.getItem(REPLAY_KEY);
      clearSavedRun();
      localStorage.removeItem(REPLAY_KEY);
    } catch {
      try {
        const restore = (key: string, previous: string | null | undefined): void => {
          if (previous === undefined) return;
          const current = localStorage.getItem(key);
          if (current === previous) return;
          if (previous === null) localStorage.removeItem(key);
          else localStorage.setItem(key, previous);
        };
        restore(SHANHAI_SAVE_KEY, previousSave);
        restore(REPLAY_KEY, previousReplay);
      } catch {
        // Keep the in-memory run even if browser storage also rejects rollback.
      }
      this.error = '删除本局存档失败，当前命途仍保留，尚未重开。';
      this.modal = 'error';
      this.render();
      return;
    }

    const destination = this.restartDestination;
    this.restartDestination = 'setup';
    this.playerName = normalizedPlayerName(this.gameState()?.name ?? this.playerName);
    this.modal = null;
    this.modalId = '';
    this.view = 'journey';
    this.stopPlayback();
    this.game = null;
    this.notice = '';
    this.error = '';
    this.storageIssue = '';
    this.scrollToStageTop = true;
    if (destination === 'setup') {
      this.seed = '';
      this.selectedMethod = this.startMethods()[0]?.id || this.selectedMethod;
      this.render();
      return;
    }
    this.beginRun();
  }

  private requestRestart(destination: 'setup' | 'start', trigger: HTMLElement): void {
    this.rememberModalTrigger(trigger);
    this.restartDestination = destination;
    this.modal = 'restart';
    this.modalId = '';
    this.render();
  }

  private discardCorruptSave(): void {
    try {
      clearSavedRun();
      this.storageIssue = '';
    } catch {
      this.storageIssue = '浏览器拒绝删除损坏存档，请在浏览器设置中手动清理。';
    }
    this.closeModal();
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
    return this.byId(battleEnemy?.encounterId) ||
      this.byId((state as any)?._challengeEliteEnemyId) ||
      (node && ['C', 'L', 'B', 'F'].includes(node.type) ? this.byId(node.id) : undefined) ||
      this.byId(pending?.enemyId) ||
      this.byId((battleEnemy as any)?.id);
  }

  private methodEntity(id: unknown): Entity | undefined {
    return this.byId(id);
  }

  private characterMarkup(value: any, entity?: Entity): string {
    const method = methodId(value, entity) ||
      (asText(entity?.id).startsWith('RKF') ? asText(entity?.id) : '') ||
      this.visualKind(value, entity);
    const enemyId = entity?.kind === 'enemy' ? asText(entity.id) : undefined;
    return characterArt(method, enemyId);
  }

  private artifactMarkup(artifact: Entity | undefined, fallback: string): string {
    return artifact ? artifactArt(asText(artifact.id)) || fallback : fallback;
  }

  private talentEntity(methodIdValue: unknown, talentId: unknown): Entity | undefined {
    const method = this.methodEntity(methodIdValue);
    const id = asText(talentId);
    return listOf<Entity>(method?.talents).find(talent => talent.id === id) ||
      listOf<Entity>(this.rules().insights).find(talent => talent.id === id);
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
    const shared = this.isSharedTalent(talent);
    const methodName = shared ? '山海共悟' : asText(this.methodEntity(methodIdValue)?.name, '当前功法');
    const effects = listOf<any>(talent.effects)
      .map((effect) => this.displayText(effectText(effect, (value) => this.displayText(value))))
      .filter(Boolean);
    return `<p class="eyebrow">${esc(methodName)} · 第 ${formatNumber(talent.tier, 1)} 层 · ${esc(shared ? '共通洞见' : `${localizeBranch(talent.branch)}分支`)}</p>
      <p>${this.textMarkup(asText(talent.description, asText(talent.quick, '长久修行所得')))}</p>
      ${shared ? this.buildMechanicMarkup(talent, this.isTalentCandidate(talent)) : ''}
      <div class="effect-list" aria-label="完整效果">${effects.map((effect) => `<p>${semanticTextMarkup(effect)}</p>`).join('') || `<p>${this.textMarkup(asText(talent.quick, '暂无额外效果说明。'))}</p>`}</div>`;
  }

  private resonanceEffect(entity?: Entity): any {
    if (!entity) return undefined;
    const id = `${entity.id}-V2-RESONANCE`;
    return [...listOf<any>(entity.passives), ...listOf<any>(entity.effects)]
      .find((effect) => isRecord(effect) && effect.id === id);
  }

  private resonanceBrief(entity?: Entity): string {
    const effect = this.resonanceEffect(entity);
    if (!effect) return '';
    return this.displayText(asText(
      entity?.summary,
      effectText(effect, (value) => this.displayText(value)),
    ));
  }

  private resonanceDetailsMarkup(entity?: Entity): string {
    const effect = this.resonanceEffect(entity);
    if (!effect) return '';
    const text = this.displayText(effectText(effect, (value) => this.displayText(value)));
    return text
      ? `<section class="resonance-details"><b>共鸣</b><p>${this.textMarkup(text)}</p></section>`
      : '';
  }

  private sourceLabel(id: unknown): string {
    const source = asText(id);
    if (source.endsWith('-RAGE-ECHO')) {
      return `身外化身 · ${this.sourceLabel(source.slice(0, -'-RAGE-ECHO'.length))}`;
    }
    const companionMethodId = source.endsWith('-COMPANION-ASSIST')
      ? source.slice(0, -'-COMPANION-ASSIST'.length)
      : source.endsWith('-COMPANION')
        ? source.slice(0, -'-COMPANION'.length)
        : undefined;
    if (companionMethodId) {
      const companionMethod = this.methodEntity(companionMethodId);
      const companionName = isRecord(companionMethod?.companion)
        ? companionMethod.companion.name
        : undefined;
      if (companionMethod) return asText(companionName, asText(companionMethod.name, companionMethod.id));
    }
    if (source.endsWith('-V2-RESONANCE')) {
      const owner = this.byId(source.slice(0, -'-V2-RESONANCE'.length));
      if (owner && (owner.kind === 'method' || owner.kind === 'artifact')) {
        return `${asText(owner.name, owner.id)}·共鸣`;
      }
    }
    if (FRAME_SOURCE_LABEL[source]) return FRAME_SOURCE_LABEL[source];
    const direct = this.byId(source);
    if (direct) {
      return direct.kind === 'artifact' && this.isCurrentCoreArtifact(source)
        ? `核心规则 · ${direct.name}`
        : direct.name;
    }
    const talentSource = talentSourceReference(source);
    if (talentSource) {
      const talent = this.talentEntity(talentSource.methodId, talentSource.talentId);
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
      if (artifact) {
        return this.isCurrentCoreArtifact(artifactEffectId)
          ? `核心规则 · ${asText(artifact.name)}`
          : `${asText(artifact.name)}效果`;
      }
    }
    const localized = localizeSourceId(source);
    return localized === '斗法规则' ? '天道助力' : localized;
  }

  private artifactEntity(id: unknown): Entity | undefined {
    return this.byId(id);
  }

  private isSharedTalent(talent: Entity | undefined): boolean {
    return Boolean(talent && listOf<Entity>(this.rules().insights).some(item => item.id === talent.id));
  }

  private equipmentState(state = this.gameState()): { slots: string[] } {
    const equipment: Record<string, any> = isRecord(state?.equipment) ? state.equipment : {};
    return {
      slots: listOf<string>(equipment.slots).filter((id) => typeof id === 'string'),
    };
  }

  private equippedArtifacts(): ArtifactStack[] {
    return this.game?.equippedArtifacts() ?? [];
  }

  private equipmentRole(artifact: Entity | undefined): 'core' | 'support' {
    return artifact?.equipment_role === 'core' ? 'core' : 'support';
  }

  private equipmentSlotLabel(id: string): string {
    const index = this.equipmentState().slots.indexOf(id);
    return index >= 0 ? `装备位 ${index + 1}` : '';
  }

  private isCurrentCoreArtifact(id: string): boolean {
    return this.currentBattleCoreIds().includes(id);
  }

  private artifactIdForSource(source: unknown): string {
    return asText(source).match(/^(RC\d\d|RR\d\d|RL\d\d)(?:-|$)/)?.[1] || '';
  }

  private replacementMaxHpDelta(incomingId: string, replacedId: string): number {
    const state = this.gameState();
    const loadout = this.game?.player;
    const incomingStack = state?.artifacts.find((item) => item.id === incomingId);
    if (!this.content || !loadout || !incomingStack) return 0;
    const artifacts = loadoutArtifacts(loadout).filter((stack) => stack.id !== replacedId);
    artifacts.push({ id: incomingId, stacks: incomingStack.stacks });
    return calculateStats(this.content, { ...loadout, artifacts }).max_hp - this.stats().max_hp;
  }

  private maxHpDeltaLabel(delta: number): string {
    if (Math.abs(delta) < 0.001) return '气血上限不变';
    return `气血上限 ${delta > 0 ? '+' : ''}${formatNumber(delta)}`;
  }

  private isCoreRuleArtifact(id: string): boolean {
    const artifact = this.artifactEntity(id);
    return this.equipmentRole(artifact) === 'core' || isRecord(artifact?.core_rule);
  }

  private currentBattleCoreIds(): string[] {
    const state = this.gameState();
    if (!state?.battleInput) {
      return this.equippedArtifacts()
        .map((stack) => stack.id)
        .filter((id) => this.isCoreRuleArtifact(id));
    }
    const playerArtifacts = loadoutArtifacts(state?.battleInput?.player);
    return playerArtifacts
      .map((stack) => stack.id)
      .filter((id) => this.isCoreRuleArtifact(id));
  }

  private isCurrentCoreSource(source: unknown, actor?: BattleFrame['actor']): boolean {
    const artifactId = this.artifactIdForSource(source);
    return actor === 'player' && Boolean(artifactId && this.currentBattleCoreIds().includes(artifactId));
  }

  private battleContributions(result?: BattleResult): BattleResult['contributions'] {
    const contributions = listOf<BattleResult['contributions'][number]>(result?.contributions);
    const state = this.gameState();
    const playerArtifacts = loadoutArtifacts(state?.battleInput?.player);
    const equippedIds = new Set(
      (state?.battleInput ? playerArtifacts : this.equippedArtifacts()).map((stack) => stack.id),
    );
    return contributions.filter((item) => {
      const artifactId = this.artifactIdForSource(item.id);
      return !artifactId || equippedIds.has(artifactId);
    });
  }

  private recentBattleBuildItems(): { artifacts: Set<string>; talents: Set<string> } {
    const state = this.gameState();
    const artifacts = new Set<string>();
    const talents = new Set<string>();
    const previousHistory = state?.history.at(-1);
    if (!state?.battleInput || !state.nodeEntry || !previousHistory ||
      previousHistory.act !== state.act || previousHistory.step + 1 !== state.step) {
      return { artifacts, talents };
    }
    const previous = listOf<any>((state as any)._travelSnapshots).slice().reverse().find((snapshot) =>
      snapshot.act === previousHistory.act && snapshot.step === previousHistory.step,
    );
    if (!isRecord(previous)) return { artifacts, talents };
    const current = state.battleInput.player;
    const beforeStacks = new Map(loadoutArtifacts(previous).map((item) => [item.id, item.stacks]));
    for (const item of loadoutArtifacts(state.nodeEntry)) {
      if (item.stacks > (beforeStacks.get(item.id) || 0)) artifacts.add(item.id);
    }
    if (previous.method === current.method && state.nodeEntry.method === current.method) {
      const beforeTalents = new Set(listOf<string>(previous.talents));
      for (const id of listOf<string>(current.talents)) {
        if (!beforeTalents.has(id)) talents.add(id);
      }
    }
    return { artifacts, talents };
  }

  private contributionHasMeasuredEffect(item: BattleResult['contributions'][number]): boolean {
    // Absorption is recorded on the victim's method, not on the shield's source.
    return [item.damage, item.healing, item.shield, item.rage]
      .some((value) => asNumber(value) > 0);
  }

  private recentContributionLabel(
    item: BattleResult['contributions'][number],
    recent: ReturnType<ShanhaiApp['recentBattleBuildItems']>,
  ): string {
    if (!this.contributionHasMeasuredEffect(item)) return '';
    const artifactId = this.artifactIdForSource(item.id);
    if (artifactId && recent.artifacts.has(artifactId)) return '近期入构';
    const methodIdValue = asText(this.gameState()?.battleInput?.player.method);
    const source = talentSourceReference(item.id);
    let talentId = '';
    if (source && (!source.methodId || source.methodId === methodIdValue)) {
      talentId = source.talentId;
    } else if (!source && this.talentEntity(methodIdValue, item.id)) {
      talentId = item.id;
    }
    return talentId && recent.talents.has(talentId) ? '近期新悟' : '';
  }

  private canChangeEquipment(): boolean {
    return this.game?.canChangeEquipment() ?? false;
  }

  private equipmentLockReason(): string {
    if (this.canChangeEquipment()) return '';
    const phase = this.gameState()?.phase;
    if (phase === 'battle') return '斗法进行中，当前装备保持不变。';
    if (phase === 'preview') return '战前观敌期间不能调整装备。';
    if (phase === 'event' || phase === 'event_result') return '行旅事件结束后才能调整装备。';
    if (phase === 'talent') return '完成本次悟道后才能调整装备。';
    if (phase === 'route') return '进入山河后才能调整装备。';
    if (phase === 'won' || phase === 'lost') return '本局已结束，装备不能再调整。';
    return '当前阶段暂不能调整装备。';
  }

  private equipmentItems(state = this.gameState()): string[] {
    return this.equipmentState(state).slots.slice(0, MAX_EQUIPMENT_SLOTS);
  }

  private equipmentSlotName(index: number): string {
    return `装备位 ${index + 1}`;
  }

  private acquisitionDisposition(id: string): string {
    const equipped = this.equippedArtifacts().find((stack) => stack.id === id);
    if (equipped) return '叠层后继续装备';

    return this.equipmentItems().length < MAX_EQUIPMENT_SLOTS
      ? '取得后自动装备至空位'
      : '收入背包 · 未装备不生效';
  }

  private appendNotice(message: string): void {
    if (!message) return;
    this.notice = [this.notice, message].filter(Boolean).join(' ');
  }

  private acquisitionResultNotice(id: string, previous: ArtifactStack[]): string {
    const artifactName = asText(this.artifactEntity(id)?.name, '法宝');
    const equipped = this.equippedArtifacts();
    const now = equipped.find((stack) => stack.id === id);
    const before = previous.find((stack) => stack.id === id);
    if (now && !before) {
      const slot = this.equipmentSlotLabel(id) || '装备位';
      return `已取得${artifactName}，自动装备至${slot}。`;
    }
    if (now) return `已取得${artifactName}并收入装备叠层。`;
    return `已取得${artifactName}，收入背包；未装备，不计入斗法。`;
  }

  private equipmentResultNotice(id: string, previous: ArtifactStack[]): string {
    const artifactName = asText(this.artifactEntity(id)?.name, '法宝');
    const now = this.equippedArtifacts().find((stack) => stack.id === id);
    if (!now) return `${artifactName}暂未进入装备位。`;
    const before = previous.find((stack) => stack.id === id);
    const slot = this.equipmentSlotLabel(id) || '装备位';
    const suffix = before ? '替换完成。' : '';
    return `${artifactName}已装备至${slot}。${suffix}`;
  }

  private coreRuleMarkup(artifact: Entity): string {
    if (!isRecord(artifact.core_rule)) return '';
    const rule = artifact.core_rule;
    const parameter = (key: string): number => {
      const value = rule[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`核心规则参数无效：${artifact.id}.${key}`);
      }
      return value;
    };
    const ratio = (key: string): string => `${formatNumber(parameter(key) * 100, 1)}%`;
    const value = (key: string): string => formatNumber(parameter(key));
    const ruleCopy: Record<string, () => { mechanism: string; tradeoff: string }> = {
      basic_convergence: () => ({
        mechanism: `仅将存活角色的主普攻本体（含各基础段修正与非暴击加成）合为一次直接命中，再乘以 ${formatNumber(parameter('damage_ratio'), 2)} 倍；不作暴击判定。`,
        tradeoff: '怒技、回响、飞剑、连锁与法宝派生伤害均独立结算，不并入本次合一。合并后只触发一次命中效果，零段普攻不生成命中。',
      }),
      basic_echo: () => ({
        mechanism: `普攻后追加一次派生攻击，伤害比例 ${ratio('ratio')}。`,
        tradeoff: `怒技基础伤害按 ${ratio('rage_damage_ratio')} 结算。`,
      }),
      rage_gambit: () => ({
        mechanism: `怒技结算后返还 ${value('rage_refund')} 点怒气。`,
        tradeoff: `受到的直接伤害提高 ${formatNumber((parameter('incoming_damage_ratio') - 1) * 100, 1)}%。`,
      }),
      shield_burst: () => ({
        mechanism: `开场获得气血上限 ${ratio('opening_shield_ratio')} 的护盾；怒技消耗当前护盾的 ${ratio('shield_ratio')}，依核心倍率 ${formatNumber(parameter('damage_ratio'), 2)} 转化为伤害。`,
        tradeoff: '爆发会消耗实际护盾；护盾不足时，怒技爆发也会变弱。',
      }),
      healing_guard: () => ({
        mechanism: `普攻恢复气血上限 ${ratio('heal_ratio')}；所有有效自疗额外转 ${ratio('shield_ratio')} 护盾，不含溢出。`,
        tradeoff: `直接伤害按 ${ratio('direct_damage_ratio')} 结算。`,
      }),
      poison_detonation: () => ({
        mechanism: `普攻施加 ${value('poison_stacks')} 层中毒；怒技消耗自身预存的全部中毒，按剩余结算次数 × ${formatNumber(parameter('damage_ratio'), 2)} 造成伤害。`,
        tradeoff: '毒层会提前结算并消失。',
      }),
      burn_siphon: () => ({
        mechanism: `普攻施加 ${value('burn_stacks')} 层燃烧；燃烧实际造成的气血损失按 ${ratio('heal_ratio')} 治疗自身。`,
        tradeoff: `怒技基础伤害按 ${ratio('rage_damage_ratio')} 结算。`,
      }),
    };
    const copy = ruleCopy[asText(rule.kind)]?.();
    if (!copy) {
      return `<section class="core-rule-detail"><h3>核心规律</h3><p>规则类型：${esc(asText(rule.kind, '未标记'))}</p><p>参数见本法宝原始规则。</p></section>`;
    }
    return `<section class="core-rule-detail"><h3>核心规律</h3><p>${esc(copy.mechanism)}</p><p><b>代价</b> · ${esc(copy.tradeoff)}</p></section>`;
  }

  private equipmentSlotMarkup(index: number, id: string | null): string {
    const label = this.equipmentSlotName(index);
    const artifact = id ? this.artifactEntity(id) : undefined;
    const stack = id
      ? this.equippedArtifacts().find((item) => item.id === id)
      : undefined;
    const rarity = entityRarity(artifact);
    const resonance = this.resonanceBrief(artifact);
    let equipmentEffect = '效果生效';
    if (isRecord(artifact?.mirror_rule) && artifact.mirror_rule.kind === 'neighbor_awakening') {
      const neighborId = this.equipmentItems()[index + 1];
      equipmentEffect = neighborId ? '镜映右侧战斗触发' : '右侧无器物';
    }
    const inscriptionLabel = stack?.inscription ? `铭刻${INSCRIPTION_COPY[stack.inscription].label}` : '';
    const inscription = inscriptionLabel ? ` · ${inscriptionLabel}` : '';
    const growth = this.artifactGrowthSummary(stack, true);
    return `<article class="equipment-slot ${id ? 'is-filled' : 'is-empty'}" data-slot="${index + 1}">
      <div class="equipment-slot-head"><b>${esc(label)}</b><span>${id ? '已装备' : '空位'}</span></div>
      ${id && artifact
      ? `<button type="button" class="equipment-slot-item rarity-${esc(rarity)}" data-action="inspect-artifact" data-id="${esc(id)}" aria-label="${esc(`${label} · ${asText(artifact.name, id)} · ${inscriptionLabel ? `${inscriptionLabel} · ` : ''}${growth ? `${growth} · ` : ''}查看详录`)}"><span class="equipment-slot-icon">${this.artifactMarkup(artifact, sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : 'jade'))}</span><span><strong>${esc(asText(artifact.name, '未知法宝'))}</strong><small>${esc(equipmentEffect)} · ×${formatNumber(stack?.stacks, 0)}${esc(inscription)}</small>${growth ? `<small class="artifact-growth-brief">${esc(growth)}</small>` : ''}${resonance ? `<small class="equipment-resonance-brief">${this.textMarkup(resonance)}</small>` : ''}</span>${icon('eye', 15)}</button>`
        : `<div class="equipment-slot-empty" aria-hidden="true">${icon('ring', 19)}</div>`}
    </article>`;
  }

  private equipmentBoardMarkup(state: RunState): string {
    const equipment = this.equipmentState(state);
    const equippedIds = equipment.slots.slice(0, MAX_EQUIPMENT_SLOTS);
    const lockedReason = this.equipmentLockReason();
    return `<section class="build-section equipment-section" aria-labelledby="equipment-title">
      <div class="section-heading"><h2 id="equipment-title">当前装备</h2><span>已装备 ${equippedIds.length} / ${MAX_EQUIPMENT_SLOTS}</span></div>
      <div class="equipment-slot-grid">
        ${Array.from({ length: MAX_EQUIPMENT_SLOTS }, (_, index) =>
          this.equipmentSlotMarkup(index, equippedIds[index] || null),
        ).join('')}
      </div>
      ${state.artifacts.some(stack => stack.id === DEVOURING_ARTIFACT_ID)
        ? this.cauldronToolMarkup(state)
        : ''}
      ${this.fusionLedgerMarkup(state)}
      ${lockedReason ? `<p class="equipment-lock" role="status">${icon('close', 15)}${esc(lockedReason)}</p>` : ''}
    </section>`;
  }

  private cauldronToolMarkup(state: RunState): string {
    const cauldron = state.artifacts.find(stack => stack.id === DEVOURING_ARTIFACT_ID);
    if (!cauldron || !this.content) return '';
    const count = artifactDevouredCount(cauldron);
    const multiplier = devouredMultiplierForContent(this.content, count);
    const active = state.equipment.slots.includes(DEVOURING_ARTIFACT_ID);
    const growthLabel = `已吞 ${count} 栈 · 伤害乘区 ×${formatNumber(multiplier, 2)}${active ? ' · 本局已装备生效' : ' · 当前未装备'}`;
    return `<details class="disclosure cauldron-tool" data-details="cauldron-devour">
      <summary>${icon('pearl', 16)}饕餮鼎吞噬 <span>${esc(growthLabel)}</span></summary>
      <div class="cauldron-tool-body" data-devour-controls>${this.devourControlsMarkup(state)}</div>
    </details>`;
  }

  private devourControlsMarkup(state: RunState): string {
    const cauldron = state.artifacts.find(stack => stack.id === DEVOURING_ARTIFACT_ID);
    if (!cauldron || !this.game || !this.content) return '<p class="empty-note">未持有饕餮鼎。</p>';
    const candidates = state.artifacts.filter(stack =>
      stack.id !== DEVOURING_ARTIFACT_ID && stack.stacks > 0 && Boolean(this.artifactEntity(stack.id)));
    const selectedId = candidates.some(stack => stack.id === this.devourTargetId)
      ? this.devourTargetId
      : asText(candidates[0]?.id);
    this.devourTargetId = selectedId;
    const count = artifactDevouredCount(cauldron);
    const multiplier = devouredMultiplierForContent(this.content, count);
    if (!selectedId) {
      return `<p class="cauldron-growth-summary" role="status">${esc(`已吞 ${count} 栈；装备本鼎时独立伤害乘区 ×${formatNumber(multiplier, 2)}。背包中没有其他可吞噬法宝。`)}</p>`;
    }
    const target = candidates.find(stack => stack.id === selectedId)!;
    const artifact = this.artifactEntity(selectedId);
    const availability = this.game.devourAvailability(selectedId);
    const inscription = target.inscription
      ? `铭刻「${INSCRIPTION_COPY[target.inscription].label}」`
      : '无铭刻';
    const equipped = this.equipmentSlotLabel(selectedId);
    const details = `${asText(artifact?.name, selectedId)}整栈 ×${formatNumber(target.stacks)} · ${inscription} · ${equipped ? `已装备${equipped}` : '背包未装备'}`;
    const afterMultiplier = availability.nextMultiplier;
    const resultLine = equipped
      ? '吞噬后会卸下该装备位，并将当前气血钳制到新上限；不会回血。'
      : '该法宝会从背包中移除。';
    const lockReason = this.equipmentLockReason();
    const unavailable = availability.available
      ? ''
      : availability.reason === 'growth-limit-reached'
        ? '饕餮鼎已达到卡面倍率上限。'
        : lockReason || '当前不能吞噬此法宝。';
    return `<div class="cauldron-devour-controls">
      <label for="cauldron-devour-target">选择牺牲法宝整栈</label>
      <select id="cauldron-devour-target" data-devour-target>${candidates.map(stack => {
        const item = this.artifactEntity(stack.id);
        const mark = stack.inscription ? ` · 铭刻${INSCRIPTION_COPY[stack.inscription].label}` : '';
        const slot = this.equipmentSlotLabel(stack.id);
        return `<option value="${esc(stack.id)}" ${stack.id === selectedId ? 'selected' : ''}>${esc(asText(item?.name, stack.id))} · ×${formatNumber(stack.stacks)}${esc(mark)}${slot ? ` · ${esc(slot)}` : ''}</option>`;
      }).join('')}</select>
      <div class="cauldron-devour-preview" aria-live="polite">
        <b>确认前核对</b>
        <p><span>牺牲</span><strong>${esc(details)}</strong></p>
        <p><span>倍率</span><strong>×${formatNumber(multiplier, 2)} → ×${formatNumber(afterMultiplier, 2)}</strong></p>
        <small>${esc(resultLine)}</small>
      </div>
      <p class="cauldron-devour-terms">整栈只计一次成长；已发生的行旅快照、合炼记录和事件结算不会改写。卸下饕餮鼎后伤害乘区暂停，成长保留。</p>
      ${unavailable ? `<p class="cauldron-devour-unavailable" role="status">${esc(unavailable)}</p>` : ''}
      <button type="button" class="button primary cauldron-devour-commit" data-action="devour" data-id="${esc(selectedId)}" ${availability.available ? '' : 'disabled'}>确认吞噬整栈</button>
    </div>`;
  }

  private equipmentActionMarkup(
    artifact: Entity,
    owned: boolean,
    inspectingEnemy: boolean,
  ): string {
    if (inspectingEnemy) return '';
    if (!owned) return `<p class="equipment-status">尚未取得 · 仅为典藏记录</p>`;
    const slot = this.equipmentSlotLabel(artifact.id);
    const slots = this.equipmentItems();
    const position = slots.indexOf(artifact.id);
    const earlierControlLabel = position > 0 ? `移至装备位 ${position}` : '已在最前装备位';
    const laterControlLabel = position >= 0 && position < slots.length - 1
      ? `移至装备位 ${position + 2}`
      : '已在最后装备位';
    const lockReason = this.equipmentLockReason();
    const action = slot ? 'equipment-unequip' : 'equipment-equip';
    const label = slot ? '卸下法宝' : this.acquisitionDisposition(artifact.id).includes('自动装备')
      ? '装备法宝'
      : '装备并选择替换位';
    const iconName = slot ? 'close' : 'sword';
    const orderControls = slot ? `<div class="equipment-order-controls" role="group" aria-label="法宝装备位顺序">
      <button type="button" class="equipment-order-button" data-action="equipment-reorder" data-id="${esc(artifact.id)}" data-direction="left" aria-label="${earlierControlLabel}" title="${earlierControlLabel}" ${lockReason || position <= 0 ? 'disabled' : ''}>${icon('arrow', 18)}</button>
      <button type="button" class="equipment-order-button" data-action="equipment-reorder" data-id="${esc(artifact.id)}" data-direction="right" aria-label="${laterControlLabel}" title="${laterControlLabel}" ${lockReason || position < 0 || position >= slots.length - 1 ? 'disabled' : ''}>${icon('arrow', 18)}</button>
    </div>` : '';
    return `<div class="equipment-detail-actions ${slot ? 'is-equipped' : ''}">
      <p class="equipment-status">${slot
        ? `已装备 · ${esc(slot)}`
        : '背包中 · 尚未生效'}</p>
      ${orderControls}
      ${lockReason ? `<p class="equipment-lock" role="status">${icon('close', 15)}${esc(lockReason)}</p>` : ''}
      <button type="button" class="button ${slot ? 'quiet' : 'primary'}" data-action="${action}" data-id="${esc(artifact.id)}" ${lockReason ? 'disabled' : ''}>${icon(iconName, 16)}${esc(label)}</button>
    </div>`;
  }

  private rules(): Record<string, any> {
    return (this.content?.rules || {}) as Record<string, any>;
  }

  private buildMechanicView(talent: Entity, includeCandidate: boolean): { id: string; name: string; summary: string } | undefined {
    if (!this.content || !this.game) return undefined;
    const state = this.game.state;
    const player = this.game.player;
    const currentTalents = listOf<string>(player.talents);
    const talents = includeCandidate && !currentTalents.includes(talent.id)
      ? [...currentTalents, talent.id]
      : currentTalents;
    const progress = state.progress;
    const loadout: Loadout = {
      ...player,
      talents,
      n: includeCandidate ? Math.max(player.n, asNumber(talent.tier)) : player.n,
      journey: {
        coins: asNumber(state.coins),
        coinsSpent: asNumber(progress.coinsSpent),
        eliteWins: asNumber(progress.eliteWins),
        bossWins: asNumber(progress.bossWins),
        artifactKinds: state.artifacts.length,
        knownMethods: state.ownedMethods.length,
      },
    };
    return buildMechanicViews(this.content, loadout, calculateStats(this.content, loadout))
      .find((view) => view.id === talent.id);
  }

  private buildMechanicMarkup(talent: Entity, includeCandidate: boolean): string {
    const view = this.buildMechanicView(talent, includeCandidate);
    if (!view) return '';
    return `<p class="talent-build-current ${includeCandidate ? 'is-preview' : ''}"><b>当前快照</b><span>${this.textMarkup(view.summary)}</span></p>`;
  }

  private isTalentCandidate(talent: Entity): boolean {
    return this.gameState()?.phase === 'talent' &&
      this.talentObjects().some((candidate) => candidate.id === talent.id);
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
      encounterId: asText(source?.encounterId) || undefined,
    };
  }

  private archiveMarkup(): string {
    if (this.archiveIssue) return `<p class="empty-note">${esc(this.archiveIssue)}</p>`;
    if (!this.archives.length) return '<p class="empty-note">还没有通关构筑。</p>';
    return `<div class="archive-list">${this.archives.slice().reverse().map(record => `<article class="archive-item"><div><span class="eyebrow">${esc(record.savedAt.slice(0, 10))}</span><h3>${esc(record.name)}</h3><p>${esc(asText(this.methodEntity(record.method)?.name, record.method))} · ${esc(this.realmName(record.n))}</p><small>${esc(record.artifacts.map(item => `${asText(this.artifactEntity(item.id)?.name, item.id)} ×${item.stacks}${item.inscription ? ` · 铭刻${INSCRIPTION_COPY[item.inscription].label}` : ''}${item.id === DEVOURING_ARTIFACT_ID ? ` · 已吞 ${artifactDevouredCount(item)} 栈 · 伤害 ×${formatNumber(devouredMultiplierForContent(this.content!, artifactDevouredCount(item)), 2)}` : ''}`).join(' · ') || '无持有法宝')}</small></div><button class="button small" data-action="export-archive" data-id="${esc(record.buildId)}">${icon('arrow', 14)}导出</button></article>`).join('')}</div>`;
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
      format: 'suishi-shanhai-winning-build-v2-overhaul',
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
    return this.game?.availableTalents() || [];
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
    return this.view === 'journey' && this.gameState()?.phase === 'battle' &&
      !this.modal && !document.hidden;
  }

  private battleTimelinePaused(): boolean {
    return this.battlePaused || Boolean(this.modal) || document.hidden ||
      this.view !== 'journey' || this.gameState()?.phase !== 'battle';
  }

  private syncBattleState(): void {
    const state = this.gameState();
    const battle = this.battleResult();
    const frames = battle?.frames || [];
    const key = this.battleIdentity(state, battle);
    if (!key || this.battleKey === key) return;
    this.stopPlayback();
    this.gameArt.cancelBattle();
    this.battleKey = key;
    this.battleCursor = this.restoreReplay(key, frames.length);
    this.battleBeatElapsed = 0;
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
    this.syncGameArt();
    if (this.playbackEligible() && !this.battleFinished && !this.battlePaused && frames.length > 1 && !this.rafId) {
      this.lastPlaybackTime = null;
      this.rafId = requestAnimationFrame((time) => this.advancePlayback(time));
    }
  }

  private advancePlayback(time: number): void {
    this.rafId = 0;
    if (!this.playbackEligible() || this.battlePaused || this.battleFinished) return;
    const frames = this.battleResult()?.frames || [];
    const wallDelta = this.lastPlaybackTime === null
      ? 0
      : Math.min(80, Math.max(0, time - this.lastPlaybackTime));
    this.lastPlaybackTime = time;
    let remainingGameTime = wallDelta * this.battleSpeed;
    let transitions = 0;
    while (remainingGameTime > 0 && transitions < 16 &&
      this.playbackEligible() && !this.battleFinished) {
      const frame = frames[this.battleCursor];
      if (!frame) break;
      const group = combatPresentationGroup(frames, this.battleCursor);
      const nextCursor = nextCombatPresentationCursor(frames, this.battleCursor);
      const impactCount = group ? group.player.hits + group.enemy.hits : 0;
      const beatGameDuration = group
        ? combatPresentationDuration(this.battleSpeed, impactCount) * this.battleSpeed
        : battleBeatGameDuration(frame);
      const remainingBeat = Math.max(0, beatGameDuration - this.battleBeatElapsed);
      const advanceBy = Math.min(remainingGameTime, remainingBeat);
      this.battleBeatElapsed += advanceBy;
      remainingGameTime -= advanceBy;
      this.gameArt.advanceBattle(advanceBy);
      this.syncBattleFloatPose(beatGameDuration);

      if (this.battleBeatElapsed + 0.001 < beatGameDuration) break;
      if (nextCursor <= this.battleCursor) {
        this.battleFinished = true;
        break;
      }

      this.battleCursor = nextCursor;
      this.battleBeatElapsed = 0;
      this.battleFinished = this.battleCursor >= frames.length - 1;
      this.saveReplay();
      const state = this.gameState();
      if (state && this.canRenderBattleInPlace(state)) {
        this.updateBattlePresentation(true);
        this.syncGameArt(true);
      } else {
        this.render();
      }
      transitions += 1;
      if (this.battleFinished) {
        this.gameArt.cancelBattle();
        break;
      }
    }
    if (this.playbackEligible() && !this.battleFinished) {
      this.rafId = requestAnimationFrame((next) => this.advancePlayback(next));
    }
  }

  private syncGameArt(cursorChanged = false): void {
    const startCanvas = this.root.querySelector<HTMLCanvasElement>('canvas[data-game-start]');
    this.gameArt.syncStart(startCanvas, this.selectedMethod || 'RKF01');

    const canvas = this.root.querySelector<HTMLCanvasElement>('canvas[data-game-battle]');
    const arena = canvas?.closest<HTMLElement>('.combat-arena') || null;
    const frames = this.battleResult()?.frames || [];
    const frame = frames[Math.min(this.battleCursor, Math.max(0, frames.length - 1))];
    const state = this.gameState();
    const enemy = this.enemyEntity();
    const enemyLoadout = state?.battleInput?.enemy;
    const enemyMethod = asText(frame?.enemy.method, methodId(enemyLoadout, enemy));
    const enemyId = asText((enemyLoadout as any)?.id, asText(enemy?.id));
    this.gameArt.syncBattle({
      canvas,
      arena,
      method: asText(frame?.player.method, asText(state?.method, 'RKF01')),
      enemyMethod,
      enemyId,
      paused: this.battleTimelinePaused(),
      cursorChanged,
      elapsed: this.battleBeatElapsed,
      frame,
      group: frame ? combatPresentationGroup(frames, this.battleCursor) : undefined,
    });
    if (frame) {
      const group = combatPresentationGroup(frames, this.battleCursor);
      const duration = group
        ? combatPresentationDuration(this.battleSpeed, group.player.hits + group.enemy.hits) * this.battleSpeed
        : battleBeatGameDuration(frame);
      this.syncBattleFloatPose(duration);
    }
  }

  private syncBattleFloatPose(duration: number): void {
    const shell = this.root.querySelector<HTMLElement>('.battle-shell');
    if (!shell) return;
    this.battleFloatProgress = this.battleBeatElapsed === 0 ? 0
      : Math.max(this.battleFloatProgress, this.battleBeatElapsed / Math.max(1, duration));
    const pose = battleFloatPresentation(
      this.battleFloatProgress,
      globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    );
    shell.style.setProperty('--float-rise', `${pose.rise.toFixed(2)}px`);
    shell.style.setProperty('--float-scale', pose.scale.toFixed(3));
    shell.style.setProperty('--float-opacity', pose.opacity.toFixed(3));
  }

  private refreshBattleSceneArt(): void {
    const arena = this.root.querySelector<HTMLElement>('.combat-arena');
    if (!arena || arena.querySelector(':scope > .game-scene')) return;
    const template = document.createElement('template');
    template.innerHTML = sceneArt('battle');
    const scene = template.content.firstElementChild;
    if (scene) arena.prepend(scene);
  }

  private stopPlayback(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastPlaybackTime = null;
  }

  private isAtLogEnd(log: HTMLElement): boolean {
    return log.scrollHeight - log.clientHeight - log.scrollTop < 32;
  }

  private focusSelectorFor(element: HTMLElement): string {
    const action = element.dataset.action;
    if (!action) return '';
    const selector = [`[data-action="${CSS.escape(action)}"]`];
    for (const key of ['id', 'method', 'filter', 'speed', 'choice', 'index', 'tab', 'direction'] as const) {
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
    if (map.closest('.view-journey.phase-map')) {
      map.style.maxHeight = '';
      map.style.minHeight = '';
      return;
    }
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
      const returnTarget = this.battleDetailReturnFocus;
      this.battleDetailReturnFocus = '';
      const talentTreeTarget = this.talentTreeReturnFocus;
      this.talentTreeReturnFocus = '';
      if (this.modal === 'talent-tree' && talentTreeTarget && this.focusTarget(talentTreeTarget)) {
        this.focusTarget(talentTreeTarget)?.focus({ preventScroll: true });
      } else if (this.modal === 'battle-details' && returnTarget && this.focusTarget(returnTarget)) {
        this.focusTarget(returnTarget)?.focus({ preventScroll: true });
      } else {
        this.focusModal();
      }
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
      this.syncGameArt();
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
      this.syncGameArt();
      this.syncTalentTreeConnectors();
      this.syncModalIsolation();
      this.restoreUiState();
      if (state.phase === 'battle') this.ensurePlayback();
      return;
    }
    this.replaceRoot(this.renderGame(state));
    this.syncGameArt();
    this.syncTalentTreeConnectors();
    this.syncModalIsolation();
    if (state.phase === 'battle') this.ensurePlayback();
    this.restoreUiState();
  }

  private replaceRoot(markup: string): void {
    this.logScrollElement = null;
    this.gameArt.dispose();
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
    const details = this.root.querySelector<HTMLElement>('.battle-detail-dialog');
    const log = details?.querySelector<HTMLElement>('.battle-log');
    if (!shell || !arena) return;

    const domCursor = Number(arena.dataset.frameIndex);
    const cursorChanged = Number.isInteger(domCursor) && domCursor !== cursor;
    const changed = frameChanged || cursorChanged;
    const previous = cursor > 0 ? frames[cursor - 1] : undefined;
    const group = combatPresentationGroup(frames, cursor);
    const impactCount = group ? group.player.hits + group.enemy.hits : 0;
    const beatDuration = group
      ? combatPresentationDuration(this.battleSpeed, impactCount)
      : battleBeatDuration(frame, this.battleSpeed);
    const baseCue = battlePresentationCue(frame, previous);
    const cue = group ? {
      ...baseCue,
      playerMotion: combatPresentationMotion(group.player, group.dot),
      enemyMotion: combatPresentationMotion(group.enemy, group.dot),
      critical: group.player.critical || group.enemy.critical,
    } : baseCue;
    shell.dataset.paused = String(this.battlePaused || Boolean(this.modal));
    shell.style.setProperty('--beat-duration', `${beatDuration}ms`);
    if (!changed) {
      this.updateBattleControls(shell);
      if (details && log) this.updateBattleLog(details, log, frames, cursor, false);
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
    const core = arena.querySelector<HTMLElement>('.battle-stage-core');
    if (core) {
      const seal = core.querySelector<HTMLElement>('.round-seal');
      const text = core.querySelector<HTMLElement>('[data-frame-text]');
      const source = core.querySelector<HTMLElement>('[data-frame-source]');
      const amount = core.querySelector<HTMLElement>('[data-battle-amount]');
      if (seal) seal.textContent = this.battleFinished
        ? this.battleResult()?.outcome === 'player' ? '胜' : this.battleResult()?.outcome === 'draw' ? '平' : '劫'
        : String(frame.round);
      if (text) text.textContent = this.battleFrameSummary(frame, cue, group);
      const sourceId = frame.source || group?.reaction?.sourceId;
      const sourceOwner = frame.actor || group?.reaction?.owner;
      const showSource = Boolean(sourceId && (!group || this.isCurrentCoreSource(sourceId, sourceOwner)));
      if (sourceId && showSource) {
        if (source) {
          source.textContent = this.sourceLabel(sourceId);
          source.classList.toggle('core-source', this.isCurrentCoreSource(sourceId, sourceOwner));
        } else text?.insertAdjacentHTML('afterend',
          `<small data-frame-source class="${this.isCurrentCoreSource(sourceId, sourceOwner) ? 'core-source' : ''}">${esc(this.sourceLabel(sourceId))}</small>`);
      } else {
        source?.remove();
      }
      if (amount) amount.innerHTML = this.battleAmountMarkup(frame, group);
    }

    arena.dataset.frameIndex = String(cursor);
    arena.dataset.frameKind = asText(frame.kind);
    arena.dataset.actionKind = cue.actionKind;
    arena.dataset.reactionKind = asText(battleReactionCue(frame, group)?.kind);
    arena.dataset.motionTrigger = String(cursor % 2);
    arena.querySelectorAll<HTMLElement>('.combatant').forEach((combatant) => {
      const side = combatant.dataset.side === 'player' ? 'player' : 'enemy';
      this.updateCombatant(combatant, frame[side], side, frame, cue, cursor, changed);
    });
    if (changed) {
      arena.querySelectorAll('.combat-vfx, .combat-feedback-layer, .combat-semantic-cue, .reaction-launch')
        .forEach(element => element.remove());
      arena.insertAdjacentHTML('beforeend',
        this.battleVfx(frame, previous, group) + this.battleFeedback(frame, previous, group));
    }

    const progress = shell.querySelector<HTMLElement>('.replay-progress i');
    if (progress) {
      progress.style.width = `${frames.length <= 1 ? 100 : Math.round(cursor / Math.max(1, frames.length - 1) * 100)}%`;
    }
    this.updateBattleControls(shell);
    this.updateBattleSettlement(shell);
    if (details && log) this.updateBattleLog(details, log, frames, cursor, changed);
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
    // A press begun on "skip" must not turn into "claim" when playback ends.
    if (action.dataset.action !== expected.dataset.action) {
      const focused = document.activeElement === action;
      action.replaceWith(expected);
      if (focused) expected.focus({ preventScroll: true });
      return;
    }
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
    const detailActions = shell.querySelector<HTMLElement>('.battle-detail-actions');
    const resultAction = detailActions?.querySelector<HTMLElement>('[data-tab="result"]');
    if (this.battleFinished && detailActions && !resultAction) {
      detailActions.insertAdjacentHTML('beforeend',
        `<button class="button small quiet" data-action="battle-details" data-tab="result" aria-label="打开战果" title="打开战果">${icon('eye', 18)}</button>`);
    } else if (!this.battleFinished) {
      resultAction?.remove();
    }
    const existing = shell.querySelector<HTMLElement>('.battle-settlement');
    if (!this.battleFinished) {
      existing?.remove();
      return;
    }
    if (existing) return;
    if (detailActions) detailActions.insertAdjacentHTML('beforebegin', this.battleSettlementMarkup());
    else shell.insertAdjacentHTML('beforeend', this.battleSettlementMarkup());
  }

  private updateBattleLog(
    details: HTMLElement,
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
    const followButton = details.querySelector<HTMLElement>('.log-follow');
    if (cursorChanged && !rebuild) {
      this.battleLogFollow = wasAtEnd;
      if (!this.battleLogFollow) this.battleLogTop = oldTop;
    }
    if (cursorChanged && this.battleLogFollow) log.scrollTop = log.scrollHeight;
    else if (rebuild && !this.battleLogFollow) log.scrollTop = oldTop || this.battleLogTop;
    if (followButton) followButton.hidden = this.battleLogFollow;
    const modeButton = details.querySelector<HTMLElement>('.log-mode');
    if (modeButton) {
      modeButton.setAttribute('aria-pressed', String(this.detailedLog));
      modeButton.textContent = this.detailedLog ? '详录' : '简录';
    }
  }

  private renderLanding(): string {
    const methods = this.startMethods();
    let hasSaved = false;
    try {
      hasSaved = Boolean(this.storageIssue.startsWith('存档无法读取')) || hasSavedRun();
    } catch {
      hasSaved = Boolean(this.storageIssue.startsWith('存档无法读取'));
    }
    const selected = methods.find((method) => method.id === this.selectedMethod) || methods[0];
    return `<div class="landing-page immersion-cover">
      <div class="landing-atmosphere">${sceneArt('start')}</div>
      <header class="topbar landing-topbar">
        <button class="brand" aria-label="山海行"><span class="brand-mark">${icon('mountain', 22)}</span><strong>随时修仙<span class="gold">·</span>山海行</strong></button><span class="edition-badge">V2 试验版</span>
        <div class="top-tools">${this.archiveIssue ? `<span class="save-warning" role="status">${esc(this.archiveIssue)}</span>` : ''}<button class="icon-button" data-action="archives" title="历届通关构筑" aria-label="历届通关构筑">${icon('book', 19)}</button></div>
      </header>
      <main class="landing-inner">
        <section class="landing-copy"><p class="eyebrow">V2 试验版 · 山海行</p><h1>随时修仙</h1>
          ${hasSaved && !this.storageIssue?.startsWith('存档无法读取') ? `<button class="resume-card" data-action="continue"><span><b>继续未完命途</b><small>${esc(asText(this.playerName, '上一局山海行'))}</small></span>${icon('arrow', 19)}</button>` : ''}
        </section>
        <div class="hero-card-stage" data-game-start-stage><div class="hero-back"></div>${characterArt(asText(selected?.id, 'RKF01'))}<canvas class="game-start-canvas" data-game-start role="img" aria-label="${esc(asText(selected?.name, '开局功法'))}"></canvas></div>
        <section class="setup" aria-labelledby="setup-title">
          <div class="setup-top"><div><h2 class="setup-title" id="setup-title">择一门功法</h2></div></div>
          <div class="setup-fields"><div class="name-field-row"><label class="field name-input"><span>道号</span><input name="player-name" maxlength="24" value="${esc(this.playerName)}" placeholder="无名行者" autocomplete="nickname"></label><button type="button" class="name-action" data-action="shuffle-name" title="随机道号" aria-label="随机道号">${icon('mirror', 18)}</button></div></div>
          <input type="hidden" name="seed" value="${esc(this.seed)}">
          <div class="method-grid">${methods.map((method, index) => this.methodChoice(method, index)).join('')}</div>
          <div class="method-detail">${this.methodQuickDetail(selected)}<details class="method-full-detail disclosure" data-details="landing-method"><summary>功法详录</summary>${this.methodDetail(selected)}</details></div>
          <div class="actions"><button class="button primary small" data-action="start" data-autofocus>入山海 ${icon('arrow', 17)}</button></div>${this.inlineMessage()}
        </section>
      </main>
      ${this.modalMarkup()}
    </div>`;
  }

  private methodChoice(method: Entity, index: number): string {
    const selected = method.id === this.selectedMethod;
    const role = asText(method.role, asText(method.stat_focus?.primary, '修行者'));
    return `<button class="method-choice ${selected ? 'selected' : ''}" data-action="method" data-id="${esc(method.id)}" aria-pressed="${selected}">
      <span class="method-mark">${sigil(index === 0 ? 'shield' : index === 1 ? 'flame' : index === 2 ? 'wave' : index === 3 ? 'spear' : 'sun', selected ? 'gold' : 'jade')}</span>
      <span class="method-copy"><b>${esc(method.name)}</b><em>${this.textMarkup(role)}</em></span>
      <span class="method-portrait">${characterArt(asText(method.id))}</span>
    </button>`;
  }

  private methodQuickDetail(method?: Entity): string {
    if (!method) return '<p class="empty-note">暂无开局功法。</p>';
    const basic = method.actions?.basic;
    const rage = method.actions?.rage;
    const resonance = this.resonanceBrief(method);
    return `<div class="method-quick-actions"><span><b>普攻</b><small>${this.textMarkup(asText(basic?.quick, '稳步出手。'))}</small></span><span><b>怒技</b><small>${this.textMarkup(asText(rage?.quick, '蓄满怒气后释放。'))}</small></span>${resonance ? `<span class="method-resonance-brief"><b>共鸣</b><small>${this.textMarkup(resonance)}</small></span>` : ''}</div>`;
  }

  private methodDetail(method?: Entity): string {
    if (!method) return '<p class="empty-note">暂无开局功法。</p>';
    const basic = method.actions?.basic;
    const rage = method.actions?.rage;
    const travel = listOf<any>(method.travel);
    return `<div class="method-detail-head"><span class="rarity-chip ${entityRarity(method)}">${esc(rarityLabel(entityRarity(method)))}</span><b>${esc(asText(method.name))}</b><span>${this.textMarkup(asText(method.role, '修行方向'))}</span></div>
      <p>${this.textMarkup(asText(method.description, entitySummary(method)))}</p>
      <div class="method-actions"><span><b>普攻</b>${esc(asText(basic?.name, '基础动作'))}<small>${this.textMarkup(asText(basic?.quick, '稳步出手'))}</small></span><span><b>怒技</b>${esc(asText(rage?.name, '怒技'))}<small>${this.textMarkup(asText(rage?.quick, '蓄满怒气后释放'))}</small></span><span><b>行旅</b><span class="method-travel-list">${travel.length ? travel.map((effect) => `<small>${this.textMarkup(asText(effect?.text, '完成节点后获得门派助益'))}</small>`).join('') : '<small>完成节点后获得门派助益</small>'}</span></span></div>
      ${this.resonanceDetailsMarkup(method)}`;
  }

  private topbar(state: RunState): string {
    const tabs: Array<['journey' | 'build' | 'karma', string, string]> = [
      ['journey', 'mountain', '山河'],
      ['build', 'book', '命盘'],
      ['karma', 'lotus', '因缘'],
    ];
    return `<header class="topbar">
      <button class="brand" data-action="home" aria-label="返回山海封面"><span class="brand-mark">${icon('mountain', 22)}</span><strong>随时修仙<span class="brand-edition"><span class="gold">·</span>山海行</span></strong></button><span class="edition-badge">V2 试验版</span>
      <nav class="desktop-nav" aria-label="主导航">${tabs.map(([id, art, label]) => `<button class="nav-button ${this.view === id ? 'active' : ''}" data-action="tab" data-id="${id}" ${this.view === id ? 'aria-current="page"' : ''}>${icon(art, 19)}${label}</button>`).join('')}</nav>
      ${this.headerRunSummary(state)}
      <div class="top-tools header-actions">
        ${this.storageIssue ? `<span class="save-warning" role="status">存档需留意</span>` : ''}
        <button class="icon-button global-talent-tree" data-action="talent-tree" title="天赋树" aria-label="查看当前功法天赋树">${icon('book', 18)}</button>
        <button class="icon-button" data-action="settings" title="设置" aria-label="设置">${icon('gear', 20)}</button>
      </div>
    </header>`;
  }

  private headerRunSummary(state: RunState): string {
    const stats = this.stats();
    const hp = asNumber(state.hp, stats.max_hp);
    const xpThreshold = this.xpThreshold(state.n);
    const xp = state.n >= 4 ? '圆满' : `${formatNumber(state.xp)} / ${formatNumber(xpThreshold)}`;
    return `<div class="header-run-summary" aria-label="当前行者状态">
      <button class="run-identity" data-action="character" aria-label="查看人物属性"><b>${esc(asText(state.name, '无名行者'))}</b><small>${esc(this.realmName(state.n))}</small></button>
      <span class="run-hp">${icon('heart', 14)}<span>${this.textMarkup(`${formatNumber(hp)} / ${formatNumber(stats.max_hp)}`)}</span></span>
      <span class="run-xp">${icon('star', 14)}<span>${this.textMarkup(xp)}</span></span>
      <span class="run-coins">${icon('coin', 14)}<span>${this.textMarkup(state.coins)}</span></span>
    </div>`;
  }

  private permanentRuleMarkup(
    rule: PermanentSacrificeRule | undefined,
    className = '',
  ): string {
    if (!rule) return '';
    const copy = PERMANENT_RULE_COPY[rule.kind];
    if (!copy) return '';
    return `<section class="permanent-rule-state ${esc(className)}" data-permanent-rule="${esc(rule.kind)}" aria-label="本局永久法则"><span>永久法则</span><b>${esc(copy.label)}</b><p>${this.textMarkup(copy.detail)}</p></section>`;
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
    const xpThreshold = this.xpThreshold(state.n);
    const xpComplete = state.n >= 4;
    return `<div class="mobile-hud">
      <button class="hud-character" data-action="character" aria-label="查看人物属性"><span><b>${esc(state.name)}</b><small>${esc(this.realmName(state.n))}</small></span></button>
      <span class="hud-resource hud-hp"><span>气血</span><b>${this.textMarkup(`${formatNumber(hp)} / ${formatNumber(stats.max_hp)}`)}</b><span class="bar"><span style="width:${pct(hp, stats.max_hp)}%"></span></span></span>
      <span class="hud-resource hud-xp"><span>修为</span><b>${this.textMarkup(xpComplete ? '圆满' : `${formatNumber(state.xp)} / ${formatNumber(xpThreshold)}`)}</b><span class="bar"><span style="width:${xpComplete ? 100 : pct(asNumber(state.xp), xpThreshold)}%"></span></span></span>
      <span class="mobile-gold">${icon('coin', 17)} ${this.textMarkup(state.coins)}</span>
      ${state.permanentRule ? this.permanentRuleMarkup(state.permanentRule, 'hud-permanent-rule') : ''}
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
    const fullMap = this.view === 'journey' && phase === 'map';
    const stage = this.view === 'build' ? this.buildView(state) : this.view === 'karma' ? this.karmaView(state) : this.phaseView(state);
    return `<div class="game-page phase-${esc(phase)} view-${this.view}" data-phase="${esc(phase)}">
      ${this.topbar(state)}
      ${this.mobileHud(state)}
      <div class="game-layout ${combat ? 'in-combat' : ''} ${fullMap ? 'full-map' : ''} ${this.view === 'build' ? 'view-build' : ''}">
        ${combat || fullMap ? '' : `<aside class="sidebar player-rail">${this.profileRail(state)}</aside>`}
        <main class="main-stage">${stage}</main>
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
    const artifacts = this.equippedArtifacts();
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
      <button class="player-identity" data-action="character" aria-label="查看人物属性">${characterArt(state.method)}<span><small>山海行者</small><strong>${esc(asText(state.name, '无名行者'))}</strong><em>${esc(this.realmName(state.n))}</em></span></button>
      <div class="panel-body">
        <div class="vital-title"><span>气血</span><strong>${this.textMarkup(`${formatNumber(hp)} / ${formatNumber(maxHp)}`)}</strong></div><div class="bar hp"><span style="width:${pct(hp, maxHp)}%"></span></div>
        ${this.permanentRuleMarkup(state.permanentRule, 'rail-permanent-rule')}
        <div class="vital-title xp-label"><span>修为</span><span>${this.textMarkup(xpComplete ? '圆满' : `${formatNumber(state.xp)} / ${formatNumber(xpThreshold)}`)}</span></div><div class="bar xp"><span style="width:${xpComplete ? 100 : pct(asNumber(state.xp), xpThreshold)}%"></span></div>
        <div class="resource-box"><span>${icon('coin', 15)}灵石</span><strong>${this.textMarkup(state.coins)}</strong></div>
        <button class="rail-method" data-action="inspect-method" data-id="${esc(state.method)}">${icon('book', 17)}${esc(asText(method?.name, '未知功法'))}${icon('eye', 15)}</button>
        <details class="disclosure" data-details="profile-details"><summary>属性与构筑</summary>
          <div class="stats-grid detailed">${(['attack', 'defense', 'crit_rate', 'speed'] as const).map((key) => `<div class="stat detailed-stat"><span>${icon(key === 'attack' ? 'sword' : key === 'defense' ? 'shield' : key === 'speed' ? 'feather' : 'star', 13)}${key === 'crit_rate' && state.permanentRule?.kind === 'blind_sword' ? '原暴击·转化' : STAT_LABEL[key]}</span><b>${this.textMarkup(key === 'crit_rate' ? `${Math.round(asNumber(stats[key]) * 100)}%` : formatNumber(stats[key]))}</b></div>`).join('')}</div>
          <div class="profile-build">
            <div class="profile-talents"><span class="eyebrow">已选天赋</span><div class="profile-talent-list">${selectedTalents.length ? selectedTalents.map((talent) => this.talentButton(talent, state.method)).join('') : '<span class="muted">未选天赋</span>'}</div></div>
            <div class="profile-actions"><span class="eyebrow">当前功法动作</span>${actionDetails.map(({ label, action }) => `<div class="profile-action"><b>${esc(label)} · ${esc(asText(action?.name, '动作'))}</b><small>${esc(this.displayText(asText(action?.quick, asText(action?.description, '暂无说明'))))}</small></div>`).join('')}</div>
            <div class="mini-build"><span class="mini-build-title">当前装备</span>${artifacts.map((stack) => this.artifactMini(stack)).join('') || '<p class="empty-note">装备位尚空。</p>'}</div>
          </div>
        </details>
        ${state.preparation > 0 || firstStrike > 0 ? `<p class="rail-preparation">${state.preparation > 0 ? `预备护盾 ${formatNumber(state.preparation)}` : ''}${firstStrike > 0 ? ` 首击 ${formatNumber(firstStrike)}` : ''}</p>` : ''}
      </div>
    </section>`;
  }

  private artifactMini(stack: ArtifactStack): string {
    const artifact = this.artifactEntity(stack.id);
    const rarity = entityRarity(artifact);
    const slot = this.equipmentSlotLabel(stack.id);
    const inscription = stack.inscription ? ` · 铭刻·${INSCRIPTION_COPY[stack.inscription].label}` : '';
    const growth = this.artifactGrowthSummary(stack, Boolean(slot));
    return `<button class="mini-card ${rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'shield' : 'jade'} rarity-${esc(rarity)}" data-action="inspect-artifact" data-id="${esc(stack.id)}" aria-label="${esc(asText(artifact?.name, stack.id))}，${esc(slot)}，叠层 ${formatNumber(stack.stacks)}${inscription}${growth ? `，${growth}` : ''}"><span class="slot-glyph">${this.artifactMarkup(artifact, sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : 'jade'))}</span><span class="name">${esc(asText(artifact?.name, stack.id))}</span><span class="rank">${esc(slot)} · ×${formatNumber(stack.stacks)}${esc(inscription)}</span>${growth ? `<small class="artifact-growth-brief">${esc(growth)}</small>` : ''}</button>`;
  }

  private artifactGrowthSummary(stack: ArtifactStack | undefined, equipped: boolean): string {
    if (stack?.id !== DEVOURING_ARTIFACT_ID || !this.content) return '';
    const count = artifactDevouredCount(stack);
    const multiplier = devouredMultiplierForContent(this.content, count);
    return `已吞 ${count} 栈 · 伤害 ×${formatNumber(multiplier, 2)} · ${equipped ? '装备生效' : '未装备'}`;
  }

  private buildView(state: RunState): string {
    const method = this.methodEntity(state.method);
    const resonance = this.resonanceBrief(method);
    const companion = this.activeCompanionMarkup(state);
    const talents = listOf<string>(state.talents?.[state.method]).map((id) => this.talentEntity(state.method, id)).filter((item): item is Entity => Boolean(item));
    const owned = new Map(state.artifacts.map((item) => [item.id, item.stacks]));
    const catalog = this.entities('artifact').filter((artifact) =>
      !this.fusionRecipe(artifact) || this.fusionRecipeKnown(artifact, state));
    const visibleArtifacts = this.buildFilter === 'owned'
      ? state.artifacts.map((stack) => this.artifactEntity(stack.id)).filter((item): item is Entity => Boolean(item))
      : catalog;
    const artifacts = this.buildRarityFilter === 'all'
      ? visibleArtifacts
      : visibleArtifacts.filter((artifact) => entityRarity(artifact) === this.buildRarityFilter);
    return `<section class="codex-page">
      ${this.stageHeading('当前命盘', asText(method?.name, state.method))}
      <section class="build-focus"><div class="build-focus-title"><strong>${esc(asText(method?.role, '修行方向'))}</strong><span class="gold">境界 · ${esc(this.realmName(state.n))}</span></div>
        ${resonance ? `<p class="build-resonance-brief"><b>共鸣</b><span>${this.textMarkup(resonance)}</span></p>` : ''}
        ${companion}
        ${state.bloodVow ? '<p class="build-resonance-brief"><b>断生之誓</b><span>本局战外无法回血，换法或洗点也不会解除。</span></p>' : ''}
        <button class="text-link method-inspect" data-action="inspect-method" data-id="${esc(state.method)}">${icon('eye', 16)}功法详录</button>
      </section>
      ${this.equipmentBoardMarkup(state)}
      <section class="build-section"><div class="section-heading"><h2>已选天赋</h2><span>${talents.length} 项</span></div><div class="talent-ledger">${talents.length ? talents.map((talent) => `<article class="${this.isSharedTalent(talent) ? 'is-shared' : ''}" data-id="${esc(talent.id)}"><b>${this.isSharedTalent(talent) ? `<span class="shared-talent-mark">${icon('star', 14)}共通洞见</span>` : ''}${this.talentButton(talent, state.method, 'talent-record-trigger')}</b><p>${esc(this.displayText(asText(talent.quick, asText(talent.description, ''))))}</p>${this.isSharedTalent(talent) ? this.buildMechanicMarkup(talent, false) : ''}</article>`).join('') : '<p class="empty-note">尚未选择天赋。</p>'}</div></section>
      <section class="build-section"><div class="section-heading"><h2>背包与图鉴</h2><span>背包 ${state.artifacts.length} 类 · 收录 ${catalog.length} 件</span></div>
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

  private activeCompanionMarkup(state: RunState): string {
    const companions = this.game?.player.companions ?? state.ownedMethods.filter(id => id !== state.method);
    return companions.filter(id => id !== state.method).map(companionId => {
      const method = this.methodEntity(companionId);
      const authored = isRecord(method?.companion) ? method.companion : undefined;
      if (!method || !authored) return '';
      const name = asText(authored.name, asText(method.name, '护道灵相'));
      const quick = asText(authored.quick, '');
      return `<p class="build-companion-brief" data-active-companion="${esc(companionId)}"><b>护道 · ${esc(name)}</b>${quick ? `<span>${this.textMarkup(quick)}</span>` : ''}</p>`;
    }).join('');
  }

  private artifactCard(artifact: Entity, stacks: number): string {
    const rarity = entityRarity(artifact);
    const equipmentSlot = this.equipmentSlotLabel(artifact.id);
    const resonance = this.resonanceBrief(artifact);
    const state = this.gameState();
    const fusionRecipe = this.fusionRecipe(artifact);
    const fusionStatus = fusionRecipe && state
      ? this.fusionStatus(artifact, state, fusionRecipe.fights)
      : undefined;
    const inventoryStatus = equipmentSlot
      ? `已装备 · ${equipmentSlot}`
      : stacks
        ? '背包中 · 未装备不生效'
        : '尚未取得';
    const inscription = listOf<ArtifactStack>(state?.artifacts)
      .find((stack) => stack.id === artifact.id)?.inscription;
    const overview = fusionRecipe && !stacks
      ? `融合进度 · 合格战斗胜利 ${formatNumber(fusionStatus?.wins ?? 0)} / ${formatNumber(fusionStatus?.requiredWins ?? fusionRecipe.fights)} · ${fusionStatus?.label ?? '尚未形成 · 未取得'}`
      : `${resonance || entitySummary(artifact) || '法宝效果详录可查看。'}${inscription ? ` 铭刻：${INSCRIPTION_COPY[inscription].label} · ${INSCRIPTION_COPY[inscription].effect}` : ''}`;
    const growth = artifact.id === DEVOURING_ARTIFACT_ID
      ? this.artifactGrowthSummary(state?.artifacts.find(stack => stack.id === artifact.id), Boolean(equipmentSlot))
      : '';
    return `<button type="button" class="ability-card rarity-${esc(rarity)} ${stacks ? 'owned' : ''}" data-action="inspect-artifact" data-id="${esc(artifact.id)}">
      <div class="card-top"><span class="rarity-label rarity-${esc(rarity)}">${esc(rarityLabel(rarity))} · 法宝</span><span class="card-rank">${stacks ? `×${formatNumber(stacks)}` : '未持有'}</span></div>
      <div class="card-heading">${this.artifactMarkup(artifact, sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'shield' : 'jade'))}<h3 class="card-title rarity-${esc(rarity)}">${esc(artifact.name)}</h3></div>
      <p class="ability-overview">${this.textMarkup(overview)}${growth ? `<span class="artifact-growth-brief">${esc(growth)}</span>` : ''}</p>
      <div class="card-foot"><span class="gain">${esc(inventoryStatus)}</span><span>查看详录 ${icon('arrow', 14)}</span></div>
    </button>`;
  }

  private fusionRecipe(artifact: Entity | undefined): { inputs: string[]; fights: number } | undefined {
    const recipe = artifact?.fusion_recipe;
    if (!isRecord(recipe)) return undefined;
    const inputs = unique(listOf<unknown>(recipe.inputs)
      .filter((id): id is string => typeof id === 'string' && Boolean(id)));
    const fights = Math.floor(asNumber(recipe.fights));
    return inputs.length > 0 && fights > 0 ? { inputs, fights } : undefined;
  }

  private fusionRecord(state: RunState, outputId: string): Record<string, any> | undefined {
    const records = listOf<any>((state as any).fusionProgress);
    return records.find((record) => isRecord(record) && record.id === outputId);
  }

  private fusionRecipeKnown(artifact: Entity, state: RunState): boolean {
    const recipe = this.fusionRecipe(artifact);
    if (!recipe) return false;
    const owned = new Set(state.artifacts.map((stack) => stack.id));
    return owned.has(artifact.id) || recipe.inputs.some((id) => owned.has(id)) ||
      listOf<any>(this.fusionRecord(state, artifact.id)?.wins).length > 0 ||
      listOf<any>(state.fusionHistory).some((entry) => entry.id === artifact.id);
  }

  private fusionStatus(
    artifact: Entity,
    state: RunState,
    requiredWins: number,
  ): { wins: number; requiredWins: number; formed: boolean; received: boolean; label: string } {
    const record = this.fusionRecord(state, artifact.id);
    let runtimeStatus: Record<string, any> | undefined;
    try {
      runtimeStatus = listOf<any>((this.game as any)?.fusionStatus?.())
        .find((item) => isRecord(item) && item.id === artifact.id);
    } catch {
      // Fall back to the saved evidence count if the runtime status is unavailable.
    }
    const winsFromEvidence = listOf<any>(record?.wins).length;
    const rawWins = Number.isFinite(runtimeStatus?.wins)
      ? asNumber(runtimeStatus?.wins)
      : winsFromEvidence;
    const actualRequiredWins = Math.max(1, Math.floor(asNumber(runtimeStatus?.requiredWins, requiredWins)));
    const received = listOf<ArtifactStack>(state.artifacts)
      .some((stack) => stack.id === artifact.id && asNumber(stack.stacks) > 0);
    const historyRecords = listOf<any>((state as any).fusionHistory);
    const formed = received || runtimeStatus?.complete === true ||
      historyRecords.some((entry) => isRecord(entry) && entry.id === artifact.id);
    const wins = clamp(Math.floor(asNumber(rawWins)), 0, actualRequiredWins);
    const label = received
      ? '已形成 · 已收入'
      : formed
        ? '已形成 · 尚未收入'
        : '尚未形成 · 未取得';
    return { wins, requiredWins: actualRequiredWins, formed, received, label };
  }

  private fusionInputMarkup(inputId: string, state: RunState): string {
    const input = this.artifactEntity(inputId);
    const stack = listOf<ArtifactStack>(state.artifacts)
      .find((item) => item.id === inputId && asNumber(item.stacks) > 0);
    const slot = this.equipmentSlotLabel(inputId);
    const holding = stack
      ? `${slot ? `已装备 · ${slot}` : '背包中'} · 叠层 ${formatNumber(stack.stacks)}`
      : '未持有';
    return `<li class="fusion-input" data-fusion-input="${esc(inputId)}"><span>${this.artifactMarkup(input, sigil(this.artifactIcon(input), 'jade'))}<b>${esc(asText(input?.name, inputId))}</b></span><small>${esc(holding)}</small></li>`;
  }

  private fusionRecipeMarkup(artifact: Entity, state: RunState, compact = false): string {
    const recipe = this.fusionRecipe(artifact);
    if (!recipe) return '';
    const status = this.fusionStatus(artifact, state, recipe.fights);
    return `<article class="fusion-recipe ${compact ? 'is-compact' : ''}" data-fusion-output="${esc(artifact.id)}" data-fusion-wins="${status.wins}">
      <header class="fusion-recipe-head"><b>${esc(asText(artifact.name, artifact.id))}</b><span>${esc(status.label)}</span></header>
      <p class="fusion-progress"><b>${formatNumber(status.wins)} / ${formatNumber(status.requiredWins)}</b><span>合格战斗胜利</span></p>
      <ul class="fusion-inputs">${recipe.inputs.map((id) => this.fusionInputMarkup(id, state)).join('')}</ul>
      ${compact ? '' : `<p class="fusion-rule-copy">战斗开始与胜利结算时都须持有每种材料各一层；事件中的战斗胜利也计入。</p>`}
    </article>`;
  }

  private fusionUsageMarkup(artifact: Entity, state: RunState): string {
    if (!state.artifacts.some((stack) => stack.id === artifact.id)) return '';
    const recipes = this.entities('artifact').filter((candidate) =>
      this.fusionRecipe(candidate)?.inputs.includes(artifact.id),
    );
    return recipes.length
      ? `<section class="fusion-usage" aria-label="融合材料用途"><h3>可用于融合</h3>${recipes.map((recipe) => this.fusionRecipeMarkup(recipe, state, true)).join('')}</section>`
      : '';
  }

  private fusionLedgerMarkup(state: RunState): string {
    const recipes = this.entities('artifact').filter((artifact) => this.fusionRecipeKnown(artifact, state));
    if (!recipes.length) return '';
    const summary = recipes.map((artifact) => {
      const recipe = this.fusionRecipe(artifact)!;
      const status = this.fusionStatus(artifact, state, recipe.fights);
      return `${asText(artifact.name, artifact.id)} ${formatNumber(status.wins)} / ${formatNumber(status.requiredWins)}`;
    }).join(' · ');
    return `<details class="disclosure fusion-ledger" data-details="fusion-ledger"><summary>融合进度 · ${esc(summary)}</summary><div class="fusion-ledger-body">${recipes.map((artifact) => this.fusionRecipeMarkup(artifact, state, true)).join('')}<p class="fusion-consumption-note">完成时各消耗材料一层，装备中的材料也会消耗；有空装备位时成品自动装备，否则收入背包。</p></div></details>`;
  }

  private fusionDetailMarkup(artifact: Entity, state: RunState | null, inspectingEnemy: boolean): string {
    if (inspectingEnemy || !state) return '';
    const recipe = this.fusionRecipe(artifact);
    if (recipe) {
      return `<section class="fusion-detail" aria-label="融合配方">${this.fusionRecipeMarkup(artifact, state)}<p class="fusion-consumption-note">完成时各消耗材料一层，装备中的材料也会消耗；有空装备位时成品自动装备，否则收入背包。</p></section>`;
    }
    return this.fusionUsageMarkup(artifact, state);
  }

  private journeyHistoryEntries(state: RunState): Array<Record<string, any>> {
    const routeEntries: Array<Record<string, any>> = listOf<any>(state.history)
      .filter(isRecord)
      .map((entry): Record<string, any> => ({ ...entry, _journeyKind: 'node' }));
    const fusionEntries: Array<Record<string, any>> = listOf<any>((state as any).fusionHistory)
      .filter(isRecord)
      .map((entry): Record<string, any> => ({ ...entry, _journeyKind: 'fusion' }));
    return [...routeEntries, ...fusionEntries].sort((left, right) =>
      asNumber(right.act) - asNumber(left.act) ||
      asNumber(right.step) - asNumber(left.step) ||
      Number(right._journeyKind === 'fusion') - Number(left._journeyKind === 'fusion'),
    );
  }

  private artifactStatMarkup(artifact: Entity, limit = 3): string {
    const attributes = isRecord(artifact.attributes) ? artifact.attributes : {};
    const values: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(isRecord(attributes.flat) ? attributes.flat : {})) {
      const amount = key === 'crit_rate' ? `${formatPercentPoints(value)}%` : formatNumber(value);
      values.push({ key, value: `+${amount}` });
    }
    for (const [key, value] of Object.entries(isRecord(attributes.percent) ? attributes.percent : {})) {
      values.push({ key, value: `+${formatPercentPoints(value)}%` });
    }
    return values.slice(0, limit).map(({ key, value }) =>
      `<span>${this.textMarkup(statLabel(key))} <b>${this.textMarkup(value)}</b></span>`,
    ).join('');
  }

  private artifactAwakeningMarkup(artifact: Entity | undefined, stacks: number): string {
    const awakening = isRecord(artifact?.awakening) ? artifact.awakening : undefined;
    if (!awakening) return '';
    const atStacks = Math.floor(asNumber(awakening.at_stacks));
    if (atStacks < 1) return '';
    const currentStacks = Math.max(0, Math.floor(stacks));
    const distance = Math.max(0, atStacks - currentStacks);
    const progress = distance ? `距觉醒还差 ${formatNumber(distance)} 层` : `已达第 ${formatNumber(atStacks)} 层`;
    const quick = this.displayText(asText(awakening.quick, ''));
    return `<div class="artifact-awakening"><b>觉醒 · ${esc(asText(awakening.name, '觉醒'))}</b><span>${esc(progress)}</span>${quick ? `<small>${esc(quick)}</small>` : ''}</div>`;
  }

  private artifactEffectMarkup(artifact: Entity, limit = 2): string {
    return listOf<any>(artifact.effects).slice(0, limit)
      .map((effect) => `<p>${this.textMarkup(effectText(effect, (value) => this.displayText(value)))}</p>`)
      .join('');
  }

  private karmaView(state: RunState): string {
    const history = this.journeyHistoryEntries(state);
    const journeys = characterJourneys(this.content!, state);
    const commitments = state.eventCommitments ?? [];
    return `<section class="karma-page">
      ${this.stageHeading('因缘', '行迹与因果')}
      <section class="karma-ledger"><div class="karma-summary"><span>相逢人物</span><strong>${journeys.length ? journeys.map(item => esc(item.name)).join('、') : '尚未相逢'}</strong></div><div class="karma-summary"><span>行迹记录</span><strong>${history.length}</strong></div></section>
      ${journeys.length ? `<section class="build-section karma-characters"><div class="section-heading"><h2>人物因缘</h2></div>${this.characterJourneyMarkup(state)}</section>` : ''}
      ${commitments.length ? `<section class="build-section journey-commitments"><div class="section-heading"><h2>行旅约定</h2><span>${commitments.filter(record => record.status === 'active').length} 项待兑现</span></div>${commitments.map(record => `<article class="journey-commitment" data-commitment-status="${record.status}"><h3>${esc(record.snapshot.name)}<small>${record.status === 'active' ? `余 ${record.remaining} 处` : ({ fulfilled: '已兑现', broken: '已失约', expired: '已过期' }[record.status])}</small></h3><p>${record.status === 'active' ? esc(`期间不进入${record.snapshot.avoid_node_types.map(type => nodeMeta(type).label).join('、')}；${record.snapshot.rewards.map(reward => this.effectLabel(reward, false)).join('，')}。失约不退费，终战前未兑现作废；满层或冲突部分每层折4灵石。`) : esc(record.resultText || record.snapshot.failure_outcome)}</p></article>`).join('')}</section>` : ''}
      ${this.storyEchoMarkup(state)}
      <details class="disclosure" data-details="journey-history"><summary>完整行迹 · ${history.length} 处</summary><section class="timeline" aria-label="行迹记录">${history.length ? history.map((item, index) => `<article class="timeline-item ${item._journeyKind === 'fusion' ? 'fusion-history' : ''}" data-history-kind="${item._journeyKind === 'fusion' ? 'fusion' : 'node'}"><span class="timeline-index">${String(history.length - index).padStart(2, '0')}</span><div><small>${item.act === 5 ? '天门' : `第${esc(asText(item.act))}幕`} · 节点 ${formatNumber(asNumber(item.step) + 1)}${item._journeyKind === 'fusion' ? ' · 融合完成' : ''}</small><h3>${esc(this.displayText(asText(item.title, '山海一刻')))}</h3><p>${esc(this.displayText(asText(item.text, '')))}</p></div></article>`).join('') : '<p class="empty-note">山河初展，尚待第一笔记录。</p>'}</section></details>
      ${this.inlineMessage()}
    </section>`;
  }

  private characterJourneyMarkup(state: RunState): string {
    return characterJourneys(this.content!, state).map(item =>
      `<article class="story-journey" data-storyline="${esc(item.id)}"><h3>${esc(item.name)}<small>${esc(item.status)}</small></h3>${item.text ? `<p>${esc(item.text)}</p>` : ''}</article>`,
    ).join('');
  }

  private storyEchoMarkup(state: RunState, act?: number, limit = 3): string {
    const echoes = eventEchoes(this.content!, state, act, limit);
    return echoes.length ? `<section class="story-echoes" aria-label="${act ? '本幕行迹' : '沿途回声'}">${echoes.map(item =>
      `<article><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></article>`,
    ).join('')}</section>` : '';
  }

  private contextRail(state: RunState): string {
    const act = this.currentAct();
    const story = isRecord(act.story) ? act.story : {};
    const history = this.journeyHistoryEntries(state).slice(0, 3);
    const completed = state.nodes.filter((node) => node.completed).length;
    const total = state.act === 5 ? 1 : 11;
    return `<section class="goal-panel"><p class="eyebrow">第${String(state.act).padStart(2, '0')}幕</p><h2>${esc(asText(story.title || act.name, `第${state.act}幕`))}</h2><div class="node-count-line"><span>行程</span><b>${completed} / ${total}</b></div><div class="bar thin"><i style="width:${pct(completed, total)}%"></i></div></section>
      <section class="history-panel"><div class="rail-heading"><span>行迹</span><small>最近记录</small></div>${history.length ? history.map((item) => `<article class="${item._journeyKind === 'fusion' ? 'fusion-history' : ''}" data-history-kind="${item._journeyKind === 'fusion' ? 'fusion' : 'node'}"><b>${esc(this.displayText(asText(item.title, '山海一刻')))}</b><p>${esc(this.displayText(asText(item.text, '')))}</p></article>`).join('') : '<p class="empty-note">第一笔行迹尚未落下。</p>'}</section>
      `;
  }

  private inventoryMarkup(artifacts: ArtifactStack[]): string {
    if (!artifacts.length) return '<p class="empty-note">尚未收纳法宝。</p>';
    return `<div class="inventory-list">${artifacts.map((stack) => {
      const artifact = this.artifactEntity(stack.id);
      const rarity = entityRarity(artifact);
      const inscription = stack.inscription ? ` · 铭刻·${INSCRIPTION_COPY[stack.inscription].label}` : '';
      return `<div class="inventory-item rarity-${esc(rarity)}"><span class="item-sigil">${this.artifactMarkup(artifact, sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'shield' : 'jade'))}</span><span><b>${esc(asText(artifact?.name, '未知法宝'))}</b><small>${esc(this.displayText(asText(artifact?.summary, entitySummary(artifact))))}${esc(inscription)}</small></span><strong>×${formatNumber(stack.stacks, 0)}</strong></div>`;
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
    return `<div class="stage-heading" ${battle ? 'data-battle-heading' : ''}>${kicker ? `<p class="eyebrow">${esc(kicker)}</p>` : ''}<h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>`;
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
    return `${this.mapHeading(state, asText(act.name), `${Math.max(0, currentIndex) + 1} / ${nodes.length || 0}`)}
      <div class="map-scroll" data-map-key="${esc(this.mapIdentity(state))}" tabindex="0" aria-label="本幕路线，可上下滚动"><div class="map-wrap" style="height:${height}px">${sceneArt('map')}<svg class="map-lines" viewBox="0 0 800 ${height}" preserveAspectRatio="none" aria-hidden="true">${connectors}</svg>
        ${orderedNodes.map(({ node, index }) => {
          const meta = nodeMeta(node.type);
          const entity = this.byId(node.id);
          const label = asText(entity?.name, meta.label);
          const available = index === currentIndex && !node.completed;
          const done = index < currentIndex || node.completed;
          return `<button class="map-node ${available ? 'available' : ''} ${done ? 'done' : ''} ${node.type === 'B' || node.type === 'F' ? 'boss' : ''}" style="left:${x(index) / 8}%;top:${y(index) / height * 100}%" data-action="preview-node" data-id="${esc(node.id)}" data-node-type="${esc(node.type)}" ${available ? '' : 'disabled'} aria-label="${esc(`${label}，${meta.label}${available ? '，查看预览' : ''}`)}" title="${esc(meta.label)}"><span class="node-disc">${mapArt(asText(node.type)) || icon(done ? 'check' : meta.icon, node.type === 'B' || node.type === 'F' ? 28 : 22)}</span><span class="node-label">${esc(label)}</span></button>`;
        }).join('')}
      </div></div>
      ${this.inlineMessage()}`;
  }

  private mapHeading(state: RunState, title: string, progress: string): string {
    const goal = asText(this.currentAct().story?.goal);
    return `<header class="stage-heading map-heading"><div><span class="map-act">${state.act === 5 ? '终局' : `第${state.act}幕`}</span><h1>${esc(title || '山河图')}</h1></div><div class="map-heading-actions"><span class="map-step" aria-label="本幕行程">${esc(progress)}</span><button class="icon-button" data-action="chapter" aria-label="查看本幕前情" title="本幕前情">${icon('book', 18)}</button></div></header>${state.step === 0 && goal ? `<p class="chapter-goal">${esc(goal)}</p>` : ''}`;
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
    const nodeMarkup = nodes.map((node) => {
      const key = asText(node.key);
      const meta = nodeMeta(asText(node.type));
      const entity = this.byId(node.id);
      const done = traversed.has(key) || Boolean(node.completed);
      const canEnter = available.has(key) && !done;
      const label = done || canEnter
        ? this.displayText(asText(node.label, asText(entity?.name, meta.label)))
        : meta.label;
      const description = done ? '已走过' : meta.label;
      return `<button class="map-node ${canEnter ? 'available' : ''} ${done ? 'done' : ''} ${node.type === 'B' || node.type === 'F' ? 'boss' : ''}" style="left:${x(asNumber(node.lane)) / 8}%;top:${y(asNumber(node.depth)) / height * 100}%" data-action="preview-node" data-id="${esc(key)}" data-node-type="${esc(node.type)}" ${canEnter ? '' : 'disabled'} aria-label="${esc(`${label}，${description}${canEnter ? '，查看预览' : ''}`)}" title="${esc(description)}"><span class="node-disc">${mapArt(asText(node.type)) || icon(done ? 'check' : meta.icon, node.type === 'B' || node.type === 'F' ? 28 : 22)}</span><span class="node-label">${esc(label)}</span>${done ? `<span class="node-completed" aria-hidden="true">${icon('check', 14)}</span>` : ''}</button>`;
    }).join('');
    const completed = state.nodes.filter((node) => node.completed).length;
    const progress = `${completed} / ${nodes.length ? maxDepth + 1 : 0}`;
    const bossHint = this.mapBossPressureHint(nodes);
    const routeSegment = this.routeSegmentMarkup(state, nodes, traversed);
    return `${this.mapHeading(state, asText(act.name), progress)}
      ${routeSegment}
      ${bossHint}
      <div class="map-scroll" data-map-key="${esc(this.mapIdentity(state))}" tabindex="0" aria-label="山河路线图"><div class="map-wrap" style="height:${height}px">${sceneArt('map')}<svg class="map-lines" viewBox="0 0 800 ${height}" preserveAspectRatio="none" aria-hidden="true">${connectors}</svg>${nodeMarkup}</div></div>
      ${this.inlineMessage()}`;
  }

  private routeSegmentMarkup(
    state: RunState,
    nodes: RouteMapNode[],
    traversed: Set<string>,
  ): string {
    if (state.act === 5 || !this.game) return '';
    const next = this.game.availableNodes()
      .filter((node) => !node.completed)
      .sort((left, right) => left.depth - right.depth)[0];
    const nextDepth = Math.max(1, asNumber(next?.depth, 1));
    if (nextDepth > 9) return '';
    const segmentIndex = Math.floor((nextDepth - 1) / 3);
    const firstDepth = segmentIndex * 3 + 1;
    const lastDepth = firstDepth + 2;
    const completed = nodes.filter((node) =>
      traversed.has(node.key) && node.depth >= firstDepth && node.depth <= lastDepth,
    ).length;
    const nextStep = clamp(nextDepth - firstDepth + 1, 1, 3);
    const steps = [1, 2, 3].map((step) => {
      const status = step <= completed ? 'done' : step === nextStep ? 'current' : '';
      return `<span class="route-segment-step ${status}" ${status === 'current' ? 'aria-current="step"' : ''}>${step}</span>`;
    }).join('');
    return `<div class="route-segment-status" aria-label="${esc(`第 ${segmentIndex + 1} 段，已走 ${completed} / 3 步`)}"><span>第 ${segmentIndex + 1} 段</span><div class="route-segment-steps" aria-hidden="true">${steps}</div><strong>${completed} / 3</strong></div>`;
  }

  private mapBossPressureHint(nodes: RouteMapNode[]): string {
    const bossNode = nodes.find(node => node.type === 'B');
    const boss = this.byId(bossNode?.id);
    if (!boss) return '';
    const pressure = listOf<unknown>(boss.pressure)
      .map(value => this.displayText(isRecord(value) ? value.quick || value.text || value.name : value))
      .filter(Boolean)[0]?.replace(/[。；;，,]+$/u, '');
    const counterplay = listOf<unknown>(boss.counterplay)
      .map(value => this.displayText(isRecord(value) ? value.quick || value.text || value.name : value))
      .filter(Boolean)[0]?.replace(/[。；;，,]+$/u, '');
    const trial = this.bossTrialMarkup(boss, true);
    if (!pressure && !trial) return '';
    const sentence = pressure
      ? `${asText(boss.name, '本幕首领')}的主要压力：${pressure}。`
      : `${asText(boss.name, '本幕首领')}的蓄备与破解方式`;
    return counterplay || trial
      ? `<details class="disclosure boss-map-hint" data-details="boss-pressure"><summary>${esc(sentence)}</summary>${counterplay ? `<p>${esc(counterplay)}。</p>` : ''}${trial}</details>`
      : `<p class="boss-map-hint">${esc(sentence)}</p>`;
  }

  private bossTrialInfo(entity?: Entity): {
    kind: string;
    title: string;
    period: number;
    charges: number;
    effect: string;
    counterplay: string;
  } | undefined {
    if (entity?.kind !== 'enemy' || !isRecord(entity.trial)) return undefined;
    const trial = entity.trial;
    const period = Math.max(1, Math.floor(asNumber(trial.period)));
    const charges = Math.max(0, Math.floor(asNumber(trial.charges)));
    if (trial.kind === 'tidal_charge') {
      return {
        kind: 'tidal_charge',
        title: '潮汐蓄击',
        period,
        charges,
        effect: `每格造成 ${formatNumber(asNumber(trial.attack_ratio_per_charge) * 100, 1)}% 攻击力伤害`,
        counterplay: '敌方每次承受有效直击或衍生攻击会失去 1 格；持续伤害与反噬不计。',
      };
    }
    if (trial.kind === 'reviving_mist') {
      return {
        kind: 'reviving_mist',
        title: '回雾复生',
        period,
        charges,
        effect: `每格回复最大气血的 ${formatNumber(asNumber(trial.heal_hp_ratio_per_charge) * 100, 1)}%`,
        counterplay: '中毒或燃烧跳伤实际扣到气血时削去 1 格；只伤护盾的持续伤害和直击不计。',
      };
    }
    return undefined;
  }

  private bossTrialMarkup(entity?: Entity, compact = false): string {
    const trial = this.bossTrialInfo(entity);
    if (!trial) return '';
    const summary = `每 ${formatNumber(trial.period)} 回合 · 初始准备 ${formatNumber(trial.charges)} 格`;
    return `<section class="boss-trial-brief ${compact ? 'compact' : ''}" data-trial-kind="${esc(trial.kind)}" aria-label="${esc(`${trial.title}首领准备`)}">
      <div class="boss-trial-heading"><span>${icon(trial.kind === 'tidal_charge' ? 'sword' : 'gourd', 16)}首领准备</span><strong>${esc(trial.title)}</strong></div>
      <p>${esc(summary)} · ${esc(trial.effect)}。</p>
      <p><b>破解</b> · ${esc(trial.counterplay)}</p>
    </section>`;
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
    const affectedCommitments = this.gameState()?.eventCommitments?.filter(record =>
      record.status === 'active' && (node.type === 'F' ||
        record.snapshot.avoid_node_types.includes(node.type as 'R' | 'S'))) ?? [];
    const trialMarkup = battleNode ? this.bossTrialMarkup(entity) : '';
    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal node-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="node-preview-title" data-node-type="${esc(node.type)}">
      <button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button>
      <p class="eyebrow">${battleNode ? `${meta.label} · 对手功法` : eventNode ? '行旅预览' : '山河预览'}</p>
      <h2 id="node-preview-title">${esc(heading)}</h2>
      ${battleNode && enemyMethod ? `<p class="node-preview-method">所修功法 · ${esc(asText(enemyMethod.name))}</p>` : ''}
      ${affectedCommitments.length ? `<p class="event-risk commitment-warning" role="status">前往此处将${node.type === 'F' ? '结束未兑现的' : '中止'}「${esc(affectedCommitments.map(record => record.snapshot.name).join('、'))}」，不发奖励且不退已付代价。</p>` : ''}
      <details class="disclosure node-preview-detail" data-details="node-preview-copy"><summary>遭遇详情</summary><p class="node-preview-copy">${esc(body)}</p></details>
      ${trialMarkup}
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
      <div class="map-index">${String(index + 1).padStart(2, '0')}</div><div class="map-connector"></div><div class="map-node-symbol tone-${meta.tone}">${mapArt(asText(node.type)) || icon(meta.icon, 19)}</div><div class="map-node-copy"><strong>${esc(label)}</strong><span>${esc(meta.label)}${entity?.summary ? ` · ${esc(asText(entity.summary))}` : ''}</span></div>${actionable ? `<button class="button small map-enter" data-action="enter" data-autofocus>查看此格 ${icon('arrow', 14)}</button>` : done ? '<span class="node-state">已行</span>' : '<span class="node-state">前路</span>'}</div>`;
  }

  private previewView(state: RunState): string {
    const node = this.nodeForState();
    const enemy = this.enemyEntity();
    const input = (state as any).battleInput || {};
    const enemyLoadout = this.enemyLoadout(enemy, input.enemy);
    if ((state as any)._thunderChallenge === true && input.enemy?.thunderChallenge !== true &&
      enemyLoadout.baseStats) {
      enemyLoadout.baseStats = {
        ...enemyLoadout.baseStats,
        max_hp: enemyLoadout.baseStats.max_hp * 1.25,
      };
    }
    const method = this.methodEntity(methodId(enemyLoadout, enemy));
    const player = this.game?.player || {};
    const playerStats = this.stats();
    const playerHp = asNumber(state.hp, playerStats.max_hp);
    const enemyStats = this.previewStats(enemyLoadout, method);
    const enemyHp = input.enemy?.hp === undefined
      ? enemyStats.max_hp
      : asNumber(input.enemy.hp, enemyStats.max_hp);
    const profile = asText(enemy?.tier, node?.type === 'B' ? 'boss' : node?.type === 'L' ? 'elite' : 'normal');
    const profileLabel = localizeTier(profile);
    const committedEvent = Boolean((state as any)._pendingEvent);
    const canChallengeElite = this.game?.canChallengeElite() ?? false;
    const stakes = !committedEvent && (node?.type === 'B' || node?.type === 'F')
      ? asText(this.currentAct().story?.boss_before) : '';
    const trialMarkup = this.bossTrialMarkup(enemy);
    return `${this.stageHeading(`战前预览 · ${profileLabel}`, '战前对阵')}
      ${stakes ? `<p class="chapter-stakes">${esc(stakes)}</p>` : ''}
      <section class="preview-matchup preview-essentials">
        <div class="preview-contender player-side">${characterArt(state.method)}<div><span class="eyebrow">行者</span><h2>${esc(asText(state.name, '行者'))}</h2><p>${esc(asText(this.methodEntity(state.method)?.name, '当前功法'))}</p><small class="preview-vital">气血 ${this.textMarkup(`${formatNumber(playerHp)} / ${formatNumber(playerStats.max_hp)}`)}</small></div></div>
        <div class="versus-seal">${sigil('swords', 'gold')}<span>斗法</span></div>
        <div class="preview-contender enemy-side">${characterArt(methodId(enemyLoadout, enemy) || asText(method?.id), asText(enemy?.id))}<div><span class="eyebrow">${esc(profileLabel)}</span><h2><button class="preview-detail-trigger" data-action="battle-details" data-tab="enemy" aria-label="对手战力与招式" title="对手战力与招式">${esc(asText(enemy?.name, enemyLoadout.name || '敌手'))}${icon('eye', 16)}</button></h2><p>${esc(asText(method?.name, '未知功法'))}</p><small class="preview-vital">气血 ${this.textMarkup(`${formatNumber(enemyHp)} / ${formatNumber(enemyStats.max_hp)}`)}</small></div></div>
      </section>
      ${trialMarkup}
      ${this.thunderChallengeMarkup(state)}
      ${this.inlineMessage()}<div class="stage-actions ${canChallengeElite ? 'has-elite-challenge' : ''}">${committedEvent ? '<span class="playback-hint">这场机缘已经承诺，战斗不可回避。</span>' : `<button class="button quiet" data-action="back">${icon('arrow', 16)}返回地图</button>`}${canChallengeElite ? `<button class="button danger invite-elite" data-action="invite-elite">${icon('skull', 16)}邀战精英</button>` : ''}<button class="button primary" data-action="fight" data-autofocus>开始斗法 ${icon('sword', 16)}</button></div>`;
  }

  private thunderChallengeMarkup(state: RunState): string {
    const game = this.game as (RuntimeGame & { canThunderChallenge?: () => boolean }) | null;
    if (!game || typeof game.canThunderChallenge !== 'function' || !game.canThunderChallenge()) return '';
    const enabled = (state as any)._thunderChallenge === true;
    return `<fieldset class="thunder-challenge" aria-describedby="thunder-challenge-details">
      <legend>雷劫邀战</legend>
      <label class="thunder-challenge-choice" for="thunder-challenge-toggle">
        <input id="thunder-challenge-toggle" type="checkbox" data-thunder-challenge aria-describedby="thunder-challenge-details" ${enabled ? 'checked' : ''}>
        <span class="thunder-challenge-copy"><b>${enabled ? '已启用雷劫邀战' : '启用雷劫邀战'}</b><small id="thunder-challenge-details">敌方基础气血 +25%；开场护盾为最终气血的 15%，并额外获得 20 怒气。</small><small>胜利后基础战斗经验 +50%，另选 1 件稀有或传奇法宝；这是额外选择，不会将普通奖励升为稀有。</small><small>符合品阶的候选耗尽时，额外奖励改为灵石。</small></span>
      </label>
    </fieldset>`;
  }

  private battleView(state: RunState): string {
    const result = this.battleResult();
    const frames = result?.frames || [];
    const frame = frames[Math.min(this.battleCursor, Math.max(0, frames.length - 1))];
    if (!frame) {
      return `${this.stageHeading('斗法载入', '双方蓄势')}<div class="empty-state">${icon('help', 34)}<p>暂无战斗记录。</p><button class="button" data-action="continue-battle">继续</button></div>`;
    }
    const previous = this.battleCursor > 0 ? frames[this.battleCursor - 1] : undefined;
    const group = combatPresentationGroup(frames, this.battleCursor);
    const impactCount = group ? group.player.hits + group.enemy.hits : 0;
    const beatDuration = group
      ? combatPresentationDuration(this.battleSpeed, impactCount)
      : battleBeatDuration(frame, this.battleSpeed);
    const baseCue = battlePresentationCue(frame, previous);
    const cue = group ? {
      ...baseCue,
      playerMotion: combatPresentationMotion(group.player, group.dot),
      enemyMotion: combatPresentationMotion(group.enemy, group.dot),
      critical: group.player.critical || group.enemy.critical,
    } : baseCue;
    const sourceId = frame.source || group?.reaction?.sourceId;
    const sourceOwner = frame.actor || group?.reaction?.owner;
    const feedback = this.battleVfx(frame, previous, group) + this.battleFeedback(frame, previous, group);
    return `${this.stageHeading('', this.battleFinished ? (result?.outcome === 'player' ? '此战告捷' : result?.outcome === 'draw' ? '胜负未分' : '此身入劫') : '斗法', '', true)}
      <section class="battle-shell" data-battle-key="${esc(this.battleKey)}" data-paused="${this.battlePaused || Boolean(this.modal)}" style="--beat-duration:${beatDuration}ms">
        <div class="combat-arena" data-frame-index="${this.battleCursor}" data-frame-kind="${esc(asText(frame.kind))}" data-action-kind="${cue.actionKind}" data-reaction-kind="${esc(asText(battleReactionCue(frame, group)?.kind))}" data-motion-trigger="${this.battleCursor % 2}">${sceneArt('battle')}<span class="arena-vignette" aria-hidden="true"></span><div class="game-battle-actors" aria-hidden="true"><canvas class="game-battle-canvas" data-game-battle></canvas></div>${this.fighterMarkup(frame.player, 'player', frame.actor === 'player' && frame.kind !== 'reaction', frame, cue)}<div class="battle-stage-core"><span class="round-seal">${this.battleFinished ? (result?.outcome === 'player' ? '胜' : result?.outcome === 'draw' ? '平' : '劫') : frame.round}</span><strong data-frame-text>${esc(this.battleFrameSummary(frame, cue, group))}</strong>${sourceId && (!group || this.isCurrentCoreSource(sourceId, sourceOwner)) ? `<small data-frame-source class="${this.isCurrentCoreSource(sourceId, sourceOwner) ? 'core-source' : ''}">${esc(this.sourceLabel(sourceId))}</small>` : ''}<span data-battle-amount>${this.battleAmountMarkup(frame, group)}</span></div>${this.fighterMarkup(frame.enemy, 'enemy', frame.actor === 'enemy' && frame.kind !== 'reaction', frame, cue)}${feedback}</div>
        <div class="battle-controls"><div class="speeds" role="group" aria-label="战斗速度"><button data-action="battle-speed" data-speed="1" data-focus-key="battle-speed-1" aria-pressed="${this.battleSpeed === 1}" aria-label="一倍速" title="一倍速">1×</button><button data-action="battle-speed" data-speed="2" data-focus-key="battle-speed-2" aria-pressed="${this.battleSpeed === 2}" aria-label="二倍速" title="二倍速">2×</button><button data-action="battle-speed" data-speed="4" data-focus-key="battle-speed-4" aria-pressed="${this.battleSpeed === 4}" aria-label="四倍速" title="四倍速">4×</button><button data-action="battle-pause" data-focus-key="battle-pause" aria-pressed="${this.battlePaused}" aria-label="${this.battlePaused ? '继续播放' : '暂停播放'}" title="${this.battlePaused ? '继续播放' : '暂停播放'}">${this.battlePaused ? '继续' : '暂停'}</button></div>${this.battleControlAction(state)}</div>
        <div class="replay-progress" aria-label="战斗播放进度"><i style="width:${frames.length <= 1 ? 100 : Math.round(this.battleCursor / Math.max(1, frames.length - 1) * 100)}%"></i></div>
        ${this.battleSettlementMarkup()}
        <div class="battle-detail-actions"><button class="button small quiet" data-action="battle-details" data-tab="log" aria-label="打开战报" title="打开战报">${icon('book', 18)}</button>${this.battleFinished ? `<button class="button small quiet" data-action="battle-details" data-tab="result" aria-label="打开战果" title="打开战果">${icon('eye', 18)}</button>` : ''}</div>
      </section>${this.inlineMessage()}`;
  }

  private battleFrameSummary(
    frame: BattleFrame,
    cue: ReturnType<typeof battlePresentationCue>,
    group: CombatPresentationGroup | undefined,
  ): string {
    const reaction = battleReactionCue(frame, group);
    const reactionLabel = battleReactionLabel(reaction);
    if (reactionLabel && reaction) {
      return `${reaction.owner === 'player' ? '我方' : '敌方'} · ${reactionLabel}`;
    }
    if (group?.interruptedCharges) {
      return `削减敌方蓄势 · ${formatNumber(group.interruptedCharges)}`;
    }
    const actor = frame.actor === 'player' ? '我方' : frame.actor === 'enemy' ? '敌方' : '';
    const labels: Record<string, string> = {
      start: '交锋开始',
      round: '回合开始',
      damage: cue.playerMotion === 'block' || cue.enemyMotion === 'block' ? '护盾吸收' : '受到攻击',
      dot: '持续伤害',
      heal: '治疗',
      shield: '护盾',
      status: '状态',
      rage: '怒气',
      phase: '昼夜流转',
      draw: '胜负未分',
      end: '斗法结束',
      summary: '战报摘要',
      wait: '蓄气等待',
    };
    const label = frame.kind === 'action'
      ? cue.actionKind === 'rage' ? '怒技' : cue.actionKind === 'basic' ? '普攻' : '出手'
      : labels[frame.kind] || '战斗';
    if (group) return group.dot ? '持续伤害' : '交锋结算';
    return (frame.kind === 'action' || frame.kind === 'wait') && actor ? `${actor} · ${label}` : label;
  }

  private availableBattleDetailTabs(): BattleDetailTab[] {
    const state = this.gameState();
    if (!state) return [];
    if (state.phase === 'preview') return ['player', 'enemy'];
    if (state.phase !== 'battle' && state.phase !== 'won' && state.phase !== 'lost') return [];
    const result = this.battleResult();
    const tabs: BattleDetailTab[] = ['player', 'enemy'];
    if (result?.frames.length) tabs.push('log');
    if (state.phase === 'won' || state.phase === 'lost' || this.battleFinished) tabs.push('result');
    return tabs;
  }

  private battleDetailsMarkup(): string {
    const tabs = this.availableBattleDetailTabs();
    if (!tabs.length) return '';
    if (!tabs.includes(this.battleDetailTab)) this.battleDetailTab = tabs[0];
    const tabLabels: Record<BattleDetailTab, string> = {
      player: '我方',
      enemy: '敌方',
      log: '战报',
      result: '战果',
    };
    const selected = this.battleDetailTab;
    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal dialog-wide battle-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="battle-detail-title">
      <button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button>
      <p class="eyebrow">斗法详录</p><h2 id="battle-detail-title">${esc(tabLabels[selected])}</h2>
      <div class="battle-detail-tabs" role="tablist" aria-label="斗法详情">${tabs.map((tab) => `<button type="button" role="tab" id="battle-detail-tab-${tab}" aria-controls="battle-detail-panel" aria-selected="${selected === tab}" tabindex="${selected === tab ? '0' : '-1'}" data-action="battle-detail-tab" data-tab="${tab}" ${selected === tab ? 'data-autofocus' : ''}>${esc(tabLabels[tab])}</button>`).join('')}</div>
      <div class="battle-detail-body" id="battle-detail-panel" role="tabpanel" aria-labelledby="battle-detail-tab-${selected}">${this.battleDetailBody(selected)}</div>
      <div class="dialog-actions"><button class="button quiet" data-action="modal-close" data-autofocus>返回</button></div>
    </section></div>`;
  }

  private battleDetailBody(tab: BattleDetailTab): string {
    if (tab === 'log') return this.battleLogMarkup();
    if (tab === 'result') return this.battleResultDetails();
    return this.battleFighterDetails(tab);
  }

  private battleFighterDetails(side: 'player' | 'enemy'): string {
    const state = this.gameState();
    const input = state?.battleInput;
    const entity = side === 'enemy' ? this.enemyEntity() : undefined;
    const loadout: any = side === 'enemy'
      ? input?.enemy || this.enemyLoadout(entity)
      : input?.player || this.game?.player || {};
    const methodIdValue = asText(loadout.method, side === 'player' ? state?.method : entity?.method);
    const method = this.methodEntity(methodIdValue);
    const stats = this.previewStats(loadout, method);
    const result = this.battleResult();
    const frames = result?.frames || [];
    const frame = state?.phase === 'preview'
      ? undefined
      : state?.phase === 'battle'
        ? frames[Math.min(this.battleCursor, Math.max(0, frames.length - 1))]
        : frames.at(-1);
    const fighter = frame?.[side];
    const currentHp = fighter?.hp ?? asNumber(loadout.hp, side === 'player' ? state?.hp : stats.max_hp);
    const currentShield = fighter?.shield ?? asNumber(loadout.preparation);
    const name = asText(fighter?.name, asText(loadout.name, side === 'player' ? '行者' : '敌手'));
    const talents = listOf<string>(loadout.talents)
      .map((id) => this.talentEntity(methodIdValue, id))
      .filter((talent): talent is Entity => Boolean(talent));
    const artifacts = loadoutArtifacts(loadout);
    const actions = [
      { label: '普攻', action: method?.actions?.basic },
      { label: '怒技', action: method?.actions?.rage },
    ];
    const frameResources = fighter
      ? `<div class="detail-stat-grid"><span>气血 <b>${formatNumber(fighter.hp)} / ${formatNumber(fighter.maxHp)}</b></span><span>护盾 <b>${formatNumber(fighter.shield)} / ${formatNumber(fighter.maxShield)}</b></span><span>怒气 <b>${formatNumber(fighter.rage)} / ${formatNumber(fighter.rageCap)}</b></span></div>`
      : `<div class="detail-stat-grid"><span>气血 <b>${formatNumber(currentHp)} / ${formatNumber(stats.max_hp)}</b></span><span>准备护盾 <b>${formatNumber(currentShield)}</b></span><span>怒气 <b>交锋开始后记录</b></span></div>`;
    const selectedActions = actions.map(({ label, action }) =>
      `<div class="detail-action"><b>${esc(label)} · ${esc(asText(action?.name, '动作'))}</b><span>${esc(this.displayText(asText(action?.quick, asText(action?.description, '按功法规则结算。'))))}</span></div>`,
    ).join('');
    const talentButtons = talents.map((talent) =>
      this.talentButton(talent, methodIdValue, 'detail-item', `查看 ${asText(talent.name, '未名天赋')}`),
    ).join('');
    const artifactButtons = artifacts.map((stack) => {
      const artifact = this.artifactEntity(stack.id);
      const artifactName = asText(artifact?.name, stack.id);
      return `<button type="button" class="detail-item" data-action="inspect-artifact" data-id="${esc(stack.id)}" aria-label="查看${esc(artifactName)}详录">${this.artifactMarkup(artifact, icon(this.artifactIcon(artifact), 15))}${esc(artifactName)} ×${formatNumber(stack.stacks)}</button>`;
    }).join('');
    const trialMarkup = side === 'enemy' ? this.bossTrialMarkup(entity) : '';
    const trialCounters = trialMarkup && fighter
      ? this.fighterCounterItemsMarkup(fighter)
      : '';
    const trialState = trialCounters
      ? `<div class="boss-trial-current" role="group" aria-label="首领准备当前计数">${trialCounters}</div>`
      : '';
    const previewOpponent = side === 'enemy' && state?.phase === 'preview'
      ? `<section class="detail-section"><h3>对手特点</h3><div class="tag-row">${listOf<any>(entity?.pressure).map((value) => `<span class="pressure-tag">${esc(this.displayText(value))}</span>`).join('') || '<span class="muted">暂无特点</span>'}</div><h4>应对之法</h4><ul class="counterplay-list">${listOf<any>(entity?.counterplay).slice(0, 2).map((value) => `<li>${esc(this.displayText(value))}</li>`).join('') || '<li>观察敌手的怒气，安排护盾与攻势。</li>'}</ul></section>`
      : '';
    return `<div class="battle-fighter-detail" data-detail-side="${side}">
      <div class="detail-character-art">${characterArt(methodIdValue, side === 'enemy' ? asText(entity?.id) : undefined)}</div>
      <section class="detail-section"><h3>${esc(name)} · ${esc(asText(method?.name, '未知功法'))}</h3>${frameResources}<div class="detail-stat-grid"><span>攻击 <b>${formatNumber(stats.attack)}</b></span><span>防御 <b>${formatNumber(stats.defense)}</b></span><span>气血上限 <b>${formatNumber(stats.max_hp)}</b></span><span>速度 <b>${formatNumber(stats.speed)}</b></span><span>${loadout.permanentRule?.kind === 'blind_sword' ? '原暴击·转化' : '暴击'} <b>${formatNumber(stats.crit_rate * 100)}%</b></span></div>${this.permanentRuleMarkup((loadout as any).permanentRule, 'battle-detail-rule')}</section>
      <section class="detail-section"><h3>战斗状态</h3><div class="combat-statuses">${fighter ? this.fighterStatusMarkup(fighter) : '<span class="muted">交锋开始后记录</span>'}</div>${fighter ? this.fighterLockedMarkup(fighter) || '<div class="locked-actions"><span>锁定动作</span><b>当前无锁定动作</b></div>' : '<div class="locked-actions"><span>锁定动作</span><b>交锋开始后记录</b></div>'}</section>
      ${trialMarkup}${trialState}
      <section class="detail-section"><h3>功法动作</h3><div class="detail-actions-list">${selectedActions}</div></section>
      <section class="detail-section"><h3>已选天赋</h3><div class="detail-item-list">${talentButtons || '<span class="muted">未选天赋</span>'}</div></section>
      <section class="detail-section"><h3>法宝</h3><div class="detail-item-list">${artifactButtons || '<span class="muted">未带法宝</span>'}</div></section>
      ${previewOpponent}
    </div>`;
  }

  private battleLogMarkup(): string {
    const state = this.gameState();
    const frames = this.battleResult()?.frames || [];
    const storedCursor = state?.phase === 'won' || state?.phase === 'lost'
      ? Math.max(0, frames.length - 1)
      : this.battleCursor;
    const cursor = Math.min(storedCursor, Math.max(0, frames.length - 1));
    const visible = frames.slice(0, cursor + 1);
    const logRows = visible.map((frame, index) =>
      this.battleLogRow(frame, index > 0 ? visible[index - 1] : undefined),
    ).join('');
    return `<div class="battle-log-panel">
      <div class="battle-log-head"><span>战痕</span><button class="text-link log-follow" data-action="battle-log-follow" ${this.battleLogFollow ? 'hidden' : ''} aria-label="回到最新战报">回到最新 ↓</button><button class="text-link log-mode" data-action="battle-log-mode" aria-pressed="${this.detailedLog}">${this.detailedLog ? '详录' : '简录'}</button></div>
      <div class="battle-log ${this.detailedLog ? 'detailed-mode' : 'simple-mode'}" data-log-key="${esc(this.battleKey)}" data-frame-index="${cursor}" data-log-mode="${this.detailedLog}" tabindex="0" role="region" aria-label="可滚动战报">${logRows || '<p class="simple-log-empty">双方蓄势。</p>'}</div>
    </div>`;
  }

  private battleResultDetails(): string {
    const state = this.gameState();
    const result = this.battleResult();
    if (!result || (state?.phase !== 'won' && state?.phase !== 'lost' && !this.battleFinished)) {
      return '<p class="empty-note">斗法尚未结束。</p>';
    }
    const outcome = result.outcome === 'player' ? '我方取胜' : result.outcome === 'draw' ? '胜负未分' : '我方落败';
    const resultActions = state?.phase === 'battle'
      ? result.outcome === 'draw'
        ? `<button class="button primary" data-action="continue-battle" ${asNumber(state.battleInput?.roundLimit) < 4096 ? '' : 'disabled'}>继续交锋 ${icon('arrow', 15)}</button><button class="button quiet" data-action="retire">收手结束本局</button>`
        : `<button class="button primary" data-action="battle-finish">${result.outcome === 'player' ? '收下战果' : '回望此局'} ${icon('arrow', 15)}</button>`
      : '';
    return `<div class="battle-result-detail"><section class="detail-section"><h3>最终结果</h3><div class="detail-stat-grid"><span>胜负 <b>${outcome}</b></span><span>回合 <b>${formatNumber(result.rounds)}</b></span><span>我方气血 <b>${formatNumber(result.playerHp)}</b></span><span>敌方气血 <b>${formatNumber(result.enemyHp)}</b></span></div></section>${this.battleGrowthMarkup()}${this.battleInsightsMarkup(result)}${this.battleComparisonMarkup()}<section class="detail-section"><h3>效果来源</h3>${this.battleDiagnostics(result)}</section>${resultActions ? `<div class="battle-result-actions">${resultActions}</div>` : ''}</div>`;
  }

  private battleGrowthMarkup(): string {
    const state = this.gameState();
    if (!state || !this.content) return '';
    const cauldron = state.artifacts.find(stack => stack.id === DEVOURING_ARTIFACT_ID);
    if (!cauldron) return '';
    const battleStack = loadoutArtifacts(state.battleInput?.player)
      .find(stack => stack.id === DEVOURING_ARTIFACT_ID);
    const count = artifactDevouredCount(battleStack ?? cauldron);
    const multiplier = devouredMultiplierForContent(this.content, count);
    return `<section class="detail-section battle-growth-summary" data-devoured="${count}" data-growth-active="${Boolean(battleStack)}"><h3>饕餮鼎吞噬成长</h3><p>已吞 ${count} 栈 · 伤害乘区 ×${formatNumber(multiplier, 2)} · ${battleStack ? '本战已装备，成长生效。' : '本战未装备，成长未生效。'}</p></section>`;
  }

  private battleInsightsMarkup(result?: BattleResult, detailed = true): string {
    if (!result) return '';
    const coreIds = this.currentBattleCoreIds();
    const filteredResult = { ...result, contributions: this.battleContributions(result) };
    const allInsights = battleInsights(filteredResult);
    const insights = battleInsights({
      ...filteredResult,
      contributions: filteredResult.contributions.filter((item) => !coreIds.includes(item.id)),
    });
    const metricLabels = {
      damage: '造成伤害',
      healing: '有效治疗',
      shield: '提供护盾',
      rage: '获得怒气',
    } as const;
    const recent = this.recentBattleBuildItems();
    const coreInsights = coreIds.map((id) => {
      const contribution = filteredResult.contributions.find((item) => item.id === id);
      const recentLabel = contribution
        ? this.recentContributionLabel(contribution, recent)
        : '';
      const metrics = contribution ? [
        asNumber(contribution.damage) > 0 ? `伤害 ${formatNumber(contribution.damage)}` : '',
        asNumber(contribution.healing) > 0 ? `有效治疗 ${formatNumber(contribution.healing)}` : '',
        asNumber(contribution.shield) > 0 ? `护盾 ${formatNumber(contribution.shield)}` : '',
        asNumber(contribution.rage) > 0 ? `怒气 ${formatNumber(contribution.rage)}` : '',
        asNumber(contribution.triggers) > 0 ? `触发 ${formatNumber(contribution.triggers)} 次` : '',
      ].filter(Boolean).join(' · ') : '';
      const name = asText(this.artifactEntity(id)?.name, '法宝');
      return `<div class="battle-core-insight"><h3>核心规则 · ${esc(name)}${recentLabel ? `<em class="contribution-recent">${recentLabel}</em>` : ''}</h3><p>${metrics
        ? this.textMarkup(metrics)
        : esc(contribution ? this.contributionReason(contribution) : '本局未记录规则触发。')}</p></div>`;
    }).join('');
    const coreInsight = coreInsights;
    const highlight = insights.highlights[0];
    const highlights = highlight
      ? `<li><b>${esc(this.sourceLabel(highlight.source))}</b><span>${metricLabels[highlight.metric]} ${formatNumber(highlight.amount)}</span></li>`
      : '';
    const failure = result.outcome === 'enemy';
    const hit = failure ? insights.defeatHit : allInsights.keyDamage;
    const damage = failure
      ? hit
        ? `<p class="battle-insight-hit"><b>${hit.lethal ? '致命一击' : '最大受击'} · 第 ${formatNumber(hit.round)} 回合</b><span>敌方 ${esc(this.sourceLabel(hit.source))}：我方气血 -${formatNumber(hit.hpLost)}${hit.shieldLost ? `，护盾 -${formatNumber(hit.shieldLost)}` : ''}</span></p>`
        : '<p class="battle-insight-hit"><b>败局受击</b><span>战报未记录可核对的敌方受击帧，无法确认致命来源或最大受击。</span></p>'
      : hit
        ? `<p class="battle-insight-hit"><b>关键伤害 · 第 ${formatNumber(hit.round)} 回合${hit.lethal ? ' · 致命帧' : ''}</b><span>${esc(this.sourceLabel(hit.source))}：气血 -${formatNumber(hit.hpLost)}${hit.shieldLost ? `，护盾 -${formatNumber(hit.shieldLost)}` : ''} · ${hit.target === 'player' ? '我方受击' : '敌方受击'}</span></p>`
        : '';
    const damageRanking = this.battleDamageRankingMarkup(result);
    const shieldRanking = detailed ? this.battleShieldRankingMarkup(result) : '';
    const healingRanking = detailed ? this.battleHealingRankingMarkup(filteredResult, allInsights.healingRanking) : '';
    if (!coreInsight && !highlights && !damage && !damageRanking && !shieldRanking && !healingRanking) return '';
    return `<section class="battle-insights" aria-label="斗法简报">${coreInsight}${damageRanking}${shieldRanking}${healingRanking}${highlights ? `<div><h3>构筑显效</h3><ul>${highlights}</ul></div>` : ''}${damage}</section>`;
  }

  private battleHealingRankingMarkup(
    result: BattleResult,
    entries: BattleInsightContribution[],
  ): string {
    if (!entries.length) return '';
    const names = new Map(this.battleContributions(result).map(item => [item.id, item.name]));
    return `<details class="disclosure battle-healing-ranking" data-details="battle-healing-ranking"><summary>治疗来源 · 前三</summary><div class="battle-healing-ranking-content" role="group" aria-label="有效治疗来源排行">${entries.map(({ source, amount, share }) => {
      const percent = Math.min(100, Math.max(0, share));
      const shownPercent = Math.round(percent);
      const name = this.displayText(names.get(source), this.sourceLabel(source));
      const label = `${name}：有效治疗 ${formatNumber(amount)}，占总有效治疗 ${shownPercent}%`;
      return `<div class="battle-damage-source"><div class="battle-damage-source-copy"><b>${esc(name)}</b><span>有效治疗 ${formatNumber(amount)} · ${shownPercent}%</span></div><div class="battle-damage-meter" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${shownPercent}" aria-valuetext="${esc(label)}"><i style="width:${percent.toFixed(2)}%"></i></div></div>`;
    }).join('')}</div></details>`;
  }

  private battleShieldRankingMarkup(result?: BattleResult): string {
    const entries = this.battleContributions(result)
      .map((item, index) => ({ item, index, shield: Math.max(0, asNumber(item.shield)) }))
      .filter(entry => entry.shield > 0);
    const total = entries.reduce((sum, entry) => sum + entry.shield, 0);
    if (total <= 0) return '';
    const top = entries.sort((left, right) => right.shield - left.shield || left.index - right.index).slice(0, 3);
    return `<details class="disclosure battle-shield-ranking" data-details="battle-shield-ranking"><summary>护盾来源 · 前三</summary><div class="battle-shield-ranking-content" role="group" aria-label="实际生成护盾排行">${top.map(({ item, shield }) => {
      const percent = Math.min(100, Math.max(0, shield / total * 100));
      const shownPercent = Math.round(percent);
      const name = this.displayText(item.name, this.sourceLabel(item.id));
      const label = `${name}：实际生成护盾 ${formatNumber(shield)}，占总计 ${shownPercent}%`;
      return `<div class="battle-damage-source"><div class="battle-damage-source-copy"><b>${esc(name)}</b><span>护盾 ${formatNumber(shield)} · ${shownPercent}%</span></div><div class="battle-damage-meter" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${shownPercent}" aria-valuetext="${esc(label)}"><i style="width:${percent.toFixed(2)}%"></i></div></div>`;
    }).join('')}</div></details>`;
  }

  private battleDamageRankingMarkup(result?: BattleResult): string {
    // Combat damage is recorded as HP loss plus shield absorbed. `absorbed` is
    // a separate defensive diagnostic, so adding it here would count the same
    // shield loss twice; healing and generated shield are different metrics.
    const damageEntries = this.battleContributions(result)
      .map((item, index) => ({ item, index, damage: Math.max(0, asNumber(item.damage)) }))
      .filter((entry) => entry.damage > 0);
    const total = damageEntries.reduce((sum, entry) => sum + entry.damage, 0);
    if (total <= 0) return '';
    const top = damageEntries.sort((a, b) => b.damage - a.damage || a.index - b.index).slice(0, 3);
    return `<div class="battle-damage-ranking" role="group" aria-label="伤害来源排行（含护盾吸收）"><h3>伤害来源 · 含护盾吸收</h3>${top.map(({ item, damage }) => {
      const percent = Math.min(100, Math.max(0, damage / total * 100));
      const shownPercent = Math.round(percent);
      const name = this.displayText(item.name, this.sourceLabel(item.id));
      const label = `${name}：伤害（含护盾吸收） ${formatNumber(damage)}，占总计 ${shownPercent}%`;
      return `<div class="battle-damage-source"><div class="battle-damage-source-copy"><b>${esc(name)}</b><span>伤害（含吸收） ${formatNumber(damage)} · ${shownPercent}%</span></div><div class="battle-damage-meter" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${shownPercent}" aria-valuetext="${esc(label)}"><i style="width:${percent.toFixed(2)}%"></i></div></div>`;
    }).join('')}</div>`;
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
    return `<section class="battle-settlement" aria-label="斗法结算">${note ? `<p>${note}</p>` : ''}${this.battleInsightsMarkup(result, false)}</section>`;
  }

  private battleComparisonMarkup(): string {
    const state = this.gameState();
    const artifacts = loadoutArtifacts(state?.battleInput?.player);
    if (!state || state.phase !== 'battle' || !this.battleFinished || artifacts.length === 0) return '';
    const key = this.battleIdentity(state);
    const comparison = this.battleComparison?.key === key ? this.battleComparison : null;
    const selected = comparison?.artifactId || artifacts[0].id;
    const result = comparison?.result;
    const scenario = (label: string, value: ArtifactBattleComparison['original']): string =>
      `<div><b>${label}</b><span>${esc(value.outcomeLabel)} · ${formatNumber(value.rounds)} 回合</span><span>我方气血 ${formatNumber(value.player.remainingHp)} / ${formatNumber(value.player.maxHp)} · 敌方气血 ${formatNumber(value.enemy.remainingHp)} / ${formatNumber(value.enemy.maxHp)}</span></div>`;
    const resultMarkup = result
      ? `<div class="battle-comparison-results" aria-live="polite"><p>移除 ${esc(this.artifactEntity(result.removedArtifact.id)?.name || result.removedArtifact.id)} ×${formatNumber(result.removedArtifact.stacks)} 后：</p>${scenario('本场', result.original)}${scenario('不带此宝', result.withoutArtifact)}</div>`
      : comparison?.loading
        ? '<p class="battle-comparison-message" role="status">正在试演这一场……</p>'
        : comparison?.error
          ? `<p class="battle-comparison-message" role="status">${esc(comparison.error)}</p>`
          : '';
    return `<details class="disclosure battle-comparison" data-details="battle-comparison"><summary>法宝试演 · 看看少一件会怎样</summary><div class="battle-comparison-body"><p>同一场战斗、同一命数，入场时移除所选法宝；试演不会改变命途。触发变化可能改变后续结果。</p><label for="battle-comparison-artifact">选择法宝</label><select id="battle-comparison-artifact" data-battle-comparison-artifact ${comparison?.loading ? 'disabled' : ''}>${artifacts.map(artifact => `<option value="${esc(artifact.id)}" ${artifact.id === selected ? 'selected' : ''}>${esc(this.artifactEntity(artifact.id)?.name || artifact.id)} ×${formatNumber(artifact.stacks)}</option>`).join('')}</select><button type="button" class="button quiet" data-action="battle-compare-artifact" ${comparison?.loading ? 'disabled' : ''}>试演不带此宝</button>${resultMarkup}</div></details>`;
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

  private fighterCounterItemsMarkup(fighter: FighterView): string {
    return listOf<any>(fighter.counters).map((counter) => {
      if (!isRecord(counter)) return '';
      const id = asText(counter.id);
      const name = asText(counter.name);
      const value = Number(counter.value);
      const max = Number(counter.max);
      if (!id || !name || !Number.isFinite(value) || !Number.isFinite(max) || max < 0) return '';
      const boundedValue = Math.min(max, Math.max(0, value));
      const progress = `${formatNumber(boundedValue, 1)} / ${formatNumber(max, 1)}`;
      return `<span class="fighter-counter" data-counter-id="${esc(id)}" title="${esc(`${name} ${progress}`)}"><b>${esc(name)}</b><i>${progress}</i></span>`;
    }).filter(Boolean).join('');
  }

  private fighterCountersMarkup(fighter: FighterView, side: 'player' | 'enemy'): string {
    const items = this.fighterCounterItemsMarkup(fighter);
    const label = side === 'enemy' && this.bossTrialInfo(this.enemyEntity())
      ? '敌方公开准备计数'
      : '战斗资源计数';
    return `<div class="fighter-counters" data-fighter-counters role="group" aria-label="${label}" ${items ? '' : 'hidden'}>${items}</div>`;
  }

  private fighterSummonItemsMarkup(fighter: FighterView): string {
    const swords = listOf<FighterSummonSnapshot>(fighter.summons)
      .filter((summon) => summon.kind === 'sword');
    if (!swords.length) return '';
    const sword = swords[0]!;
    const max = Math.max(0, Math.floor(asNumber(sword.max)));
    const count = Math.max(0, Math.min(max, Math.floor(asNumber(sword.count))));
    if (!max) return '';
    const icons = Array.from({ length: Math.min(5, max) }, (_, index) =>
      `<span class="summon-sword ${index < count ? 'active' : ''}" data-active="${index < count}" aria-hidden="true">${icon('sword', 13)}</span>`,
    ).join('');
    return `<span class="fighter-summon-name">${icon('sword', 14)}飞剑阵</span><span class="fighter-summon-array" aria-hidden="true">${icons}</span><strong>${count} / ${max}</strong>`;
  }

  private fighterSummonsMarkup(fighter: FighterView): string {
    const items = this.fighterSummonItemsMarkup(fighter);
    const label = listOf<FighterSummonSnapshot>(fighter.summons)
      .filter((summon) => summon.kind === 'sword')
      .map((summon) => `${Math.max(0, Math.floor(asNumber(summon.count)))} / ${Math.max(0, Math.floor(asNumber(summon.max)))}`)
      .at(0);
    return `<div class="fighter-summons" data-fighter-summons role="group" aria-label="${esc(label ? `${fighter.name}飞剑阵 ${label}` : `${fighter.name}飞剑阵`)}" ${items ? '' : 'hidden'}>${items}</div>`;
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
    const enemy = side === 'enemy' ? this.enemyEntity() : undefined;
    const action = acting ? (fighter.lockedAction || this.frameAction(frame, side)) : undefined;
    const turnLabel = action === 'rage_action' ? '怒技' : action === 'basic_action' ? '普攻' : action === 'wait' ? '蓄气等待' : '出手';
    const resources = bloodShieldPresentation(fighter);
    const motion = cue[side === 'player' ? 'playerMotion' : 'enemyMotion'];
    const lowHealth = pct(fighter.hp, fighter.maxHp) <= 30;
    const rageReady = fighter.rageCap > 0 && fighter.rage >= fighter.rageCap;
    return `<article class="combatant ${side === 'player' ? 'side-p' : 'side-e enemy'} ${acting ? 'acting' : ''} ${lowHealth ? 'low-health' : ''} ${rageReady ? 'rage-ready' : ''}" data-side="${side}" data-motion="${motion}" data-motion-trigger="${this.battleCursor % 2}" data-frame-index="${this.battleCursor}" data-low-health="${lowHealth}" data-rage-ready="${rageReady}" aria-label="${esc(`${side === 'player' ? '我方' : '敌方'}战斗信息：${fighter.name}`)}">
      <div class="fighter-art"><span class="fighter-side-badge">${side === 'player' ? '我方' : '敌方'}</span>${characterArt(asText(fighter.method, side === 'player' ? asText(this.gameState()?.method) : ''), asText(enemy?.id) || undefined)}</div>
      <div class="fighter-identity"><h2>${esc(asText(fighter.name, side === 'player' ? '行者' : '敌手'))}</h2><button type="button" class="fighter-detail-trigger" data-action="battle-details" data-tab="${side}" aria-label="${side === 'player' ? '我方详情' : '敌方详情'}" title="${side === 'player' ? '我方详情' : '敌方详情'}">${icon('eye', 16)}</button>${acting ? `<span class="turn-mark">${turnLabel}</span>` : ''}</div>
      <div class="fighter-bars">
        <div class="fighter-numbers"><span>生命</span><span><b data-value="hp">${formatNumber(resources.hp)}</b> / ${formatNumber(fighter.maxHp)} <span class="shield-count">${icon('shield', 12)} +<b data-value="shield">${formatNumber(resources.shield)}</b> / ${formatNumber(fighter.maxShield)}</span></span></div>
        <div class="bar hp" role="progressbar" aria-label="${esc(`${fighter.name}气血与护盾`)}" aria-valuemin="0" aria-valuemax="${resources.capacity}" aria-valuenow="${resources.total}" aria-valuetext="气血 ${formatNumber(resources.hp)} / ${formatNumber(fighter.maxHp)}，护盾 ${formatNumber(resources.shield)}"><span class="hp-fill" style="width:${resources.hpPercent}%"></span><span class="shield-fill" style="width:${resources.shieldPercent}%"></span></div>
        <div class="fighter-numbers"><span>怒气</span><span data-value="rage">${formatNumber(fighter.rage)} / ${formatNumber(fighter.rageCap)}</span></div>
        <div class="bar rage" role="progressbar" aria-label="${esc(`${fighter.name}怒气`)}" aria-valuemin="0" aria-valuemax="${fighter.rageCap}" aria-valuenow="${fighter.rage}"><span style="width:${pct(fighter.rage, fighter.rageCap)}%"></span></div>
      </div>
      ${this.fighterSummonsMarkup(fighter)}
      ${this.fighterCountersMarkup(fighter, side)}
      ${this.permanentRuleMarkup(fighter.permanentRule, 'combatant-permanent-rule')}
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
    const summons = element.querySelector<HTMLElement>('[data-fighter-summons]');
    const counters = element.querySelector<HTMLElement>('[data-fighter-counters]');
    if (hp) hp.textContent = formatNumber(fighter.hp);
    if (shield) shield.textContent = formatNumber(fighter.shield);
    if (rage) rage.textContent = `${formatNumber(fighter.rage)} / ${formatNumber(fighter.rageCap)}`;
    if (summons) {
      const markup = this.fighterSummonItemsMarkup(fighter);
      summons.innerHTML = markup;
      summons.hidden = !markup;
      const label = listOf<FighterSummonSnapshot>(fighter.summons)
        .filter((summon) => summon.kind === 'sword')
        .map((summon) => `${Math.max(0, Math.floor(asNumber(summon.count)))} / ${Math.max(0, Math.floor(asNumber(summon.max)))}`)
        .at(0);
      summons.setAttribute('aria-label', label ? `${fighter.name}飞剑阵 ${label}` : `${fighter.name}飞剑阵`);
    }
    if (counters) {
      const markup = this.fighterCounterItemsMarkup(fighter);
      counters.innerHTML = markup;
      counters.hidden = !markup;
    }
    const hpBar = element.querySelector<HTMLElement>('.bar.hp');
    const rageBar = element.querySelector<HTMLElement>('.bar.rage');
    if (hpBar) {
      const resources = bloodShieldPresentation(fighter);
      hpBar.setAttribute('aria-valuemax', String(resources.capacity));
      hpBar.setAttribute('aria-valuenow', String(resources.total));
      hpBar.setAttribute('aria-valuetext', `气血 ${formatNumber(resources.hp)} / ${formatNumber(fighter.maxHp)}，护盾 ${formatNumber(resources.shield)} / ${formatNumber(fighter.maxShield)}`);
      const hpFill = hpBar.querySelector<HTMLElement>('.hp-fill');
      const shieldFill = hpBar.querySelector<HTMLElement>('.shield-fill');
      if (hpFill) hpFill.style.width = `${resources.hpPercent}%`;
      if (shieldFill) shieldFill.style.width = `${resources.shieldPercent}%`;
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

    const acting = frame.actor === side && frame.kind !== 'reaction';
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
  }

  private frameAction(frame: BattleFrame | undefined, side: 'player' | 'enemy'): 'basic_action' | 'rage_action' | 'wait' | undefined {
    if (!frame || frame.actor !== side) return undefined;
    if (frame.kind === 'wait') return 'wait';
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

  private battleAmountMarkup(
    _frame: BattleFrame,
    _group: CombatPresentationGroup | undefined,
  ): string {
    return '';
  }

  private battleVfx(
    frame: BattleFrame,
    previous: BattleFrame | undefined,
    group: CombatPresentationGroup | undefined,
  ): string {
    if (!previous || this.battleFinished) return '';
    if (!group) return '';
    const duration = combatPresentationDuration(
      this.battleSpeed,
      group.player.hits + group.enemy.hits,
    );
    return (['player', 'enemy'] as const).map((side) => {
      const summary = group[side];
      const kind = summary.damage > 0 ? 'attack'
        : summary.shieldAbsorbed > 0 ? 'shield'
          : summary.healing > 0 ? 'heal'
            : summary.shieldGenerated > 0 ? 'shield' : '';
      if (!kind) return '';
      const row = kind === 'attack' ? 0 : kind === 'heal' ? 1 : 2;
      const critical = kind === 'attack' && summary.critical;
      return `<div class="combat-vfx target-${side === 'player' ? 'p' : 'e'} kind-${kind} ${critical ? 'critical' : ''}" style="--fx-duration:${duration}ms" aria-hidden="true"><span class="vfx-sprite" style="--row:${row};background-image:url('./assets/generated/combat-vfx-atlas.webp')"></span></div>`;
    }).join('');
  }

  private battleFeedback(
    frame: BattleFrame,
    previous: BattleFrame | undefined,
    group: CombatPresentationGroup | undefined,
  ): string {
    const reactionMarkup = this.battleReactionMarkup(frame, group);
    if (!previous || !group) return reactionMarkup;
    const duration = combatPresentationDuration(
      this.battleSpeed,
      group.player.hits + group.enemy.hits,
    );
    const changes: Array<{
      side: 'p' | 'e'; kind: string; text: string; crit?: boolean;
      amount?: string; label?: string; detail?: string;
    }> = [];
    for (const [key, side] of [['player', 'p'], ['enemy', 'e']] as const) {
      const summary = group[key];
      const isDotDamage = group.dot && summary.damage > 0 && summary.dotDamage === summary.damage;
      if (summary.damage > 0) {
        const detail = summary.hits > 1 ? ` · ${formatNumber(summary.hits)}段` : '';
        const label = isDotDamage ? '持续伤害 ' : summary.critical ? '暴击 ' : '';
        changes.push({
          side,
          kind: isDotDamage ? 'damage dot' : 'damage',
          text: `${label}-${formatNumber(summary.damage)}${detail}`,
          amount: `-${formatNumber(summary.damage)}`,
          label,
          detail,
          crit: summary.critical && !isDotDamage,
        });
      }

      const facts: string[] = [];
      if (summary.healing > 0) facts.push(`治疗 +${formatNumber(summary.healing)}`);
      if (summary.shieldAbsorbed > 0) facts.push(`护盾吸收 ${formatNumber(summary.shieldAbsorbed)}`);
      if (summary.shieldGenerated > 0) facts.push(`护盾 +${formatNumber(summary.shieldGenerated)}`);
      if (summary.shieldConsumed > 0) facts.push(`护盾消耗 ${formatNumber(summary.shieldConsumed)}`);
      if (side === 'p') {
        if (summary.rageGained > 0) facts.push(`怒气 +${formatNumber(summary.rageGained)}`);
        if (summary.rageSpent > 0) facts.push(`怒气 -${formatNumber(summary.rageSpent)}`);
      }
      if (facts.length) {
        const hasShieldChange = summary.shieldAbsorbed > 0 || summary.shieldGenerated > 0 || summary.shieldConsumed > 0;
        const kind = hasShieldChange ? 'shield' : summary.healing > 0 ? 'heal' : 'rage';
        changes.push({ side, kind: `detail ${kind}`, text: facts.join(' · ') });
      }

      const statusPriority = ['poison', 'burn', 'weakness', 'armor_break', 'sword_intent', 'charge_luck', 'day_night'];
      const statusChanges = Object.entries(summary.statuses)
        .filter(([, delta]) => delta !== 0)
        .sort(([left], [right]) => {
          const leftPriority = statusPriority.indexOf(left);
          const rightPriority = statusPriority.indexOf(right);
          return (leftPriority < 0 ? statusPriority.length : leftPriority) -
            (rightPriority < 0 ? statusPriority.length : rightPriority);
        });
      if (statusChanges.length) {
        const visibleStatuses = statusChanges.slice(0, 2).map(([status, delta]) =>
          `${STATUS_LABEL[status] || localizeStatus(status)} ${delta > 0 ? '+' : ''}${formatNumber(delta)}`);
        const remaining = statusChanges.length - visibleStatuses.length;
        if (remaining > 0) visibleStatuses.push(`另有 ${formatNumber(remaining)} 项状态`);
        changes.push({ side, kind: 'status-change', text: visibleStatuses.join(' · ') });
      }
    }
    if (!changes.length) return reactionMarkup;
    const sideMarkup = (side: 'p' | 'e') => {
      const messages = changes.filter(item => item.side === side);
      if (!messages.length) return '';
      return `<div class="combat-feedback-group side-${side}" data-side="${side === 'p' ? 'player' : 'enemy'}">${messages.map((item) =>
        `<span class="combat-float ${item.kind} ${item.crit ? 'crit' : ''}" style="--fx-duration:${duration}ms;animation-duration:${duration}ms">${item.amount
          ? `${item.label ? `<small>${esc(item.label)}</small>` : ''}<b>${esc(item.amount)}</b>${item.detail ? `<small>${esc(item.detail)}</small>` : ''}`
          : `<b>${esc(item.text)}</b>`}</span>`,
      ).join('')}</div>`;
    };
    return `${reactionMarkup}<div class="combat-feedback-layer" aria-hidden="true">${sideMarkup('p')}${sideMarkup('e')}</div>`;
  }

  private battleReactionMarkup(frame: BattleFrame, group?: CombatPresentationGroup): string {
    const reaction = battleReactionCue(frame, group);
    if (!reaction) return '';
    if (reaction.kind === 'sword_volley') {
      const count = listOf<FighterSummonSnapshot>(frame[reaction.owner].summons)
        .filter((summon) => summon.kind === 'sword')
        .reduce((total, summon) => Math.max(total, Math.floor(asNumber(summon.count))), 0);
      const icons = Array.from({ length: Math.max(1, Math.min(5, count)) }, (_, index) =>
        `<span class="reaction-launch-sword" style="--launch-index:${index}">${icon('sword', 18)}</span>`,
      ).join('');
      return `<div class="reaction-launch owner-${reaction.owner}" data-reaction-launch aria-hidden="true">${icons}</div>`;
    }
    if (reaction.kind === 'rage_chain') {
      if (reaction.count !== 2 && reaction.count !== 3) return '';
      return `<div class="combat-semantic-cue rage-chain owner-${reaction.owner}" data-combat-semantic-cue="rage_chain" role="status"><span>${icon('sword', 15)}<b>绝技连斩</b><strong>×${reaction.count}</strong></span></div>`;
    }
    if (reaction.kind === 'blood_valor') {
      return `<div class="combat-semantic-cue blood-valor owner-${reaction.owner}" data-combat-semantic-cue="blood_valor" role="status"><span>${icon('shield', 15)}<b>血勇反击</b></span></div>`;
    }
    if (reaction.kind === 'companion_assist') {
      const companionMethodId = reaction.sourceId.match(/^(RKF\d\d)-COMPANION$/)?.[1] || reaction.sourceId;
      const sourceMethod = this.methodEntity(companionMethodId);
      const authoredName = isRecord(sourceMethod?.companion) ? sourceMethod.companion.name : undefined;
      const sourceName = asText(authoredName, asText(sourceMethod?.name, this.sourceLabel(reaction.sourceId)));
      return `<div class="combat-semantic-cue companion-assist owner-${reaction.owner}" data-combat-semantic-cue="companion_assist" role="status"><span>${icon('star', 15)}<b>同伴助战</b><strong>${esc(sourceName)}</strong></span></div>`;
    }
    return '';
  }

  private battleLogRow(frame: BattleFrame, previous?: BattleFrame): string {
    const interrupted = frame.kind === 'status' && frame.cue?.kind === 'enemy_charge';
    const kind = interrupted ? '削减蓄势'
      : battleReactionLabel(battleReactionCue(frame)) || FRAME_KIND_LABEL[asText(frame.kind)] || '战斗';
    const logActor = frame.actor || frame.cue?.owner;
    const actor = logActor === 'player' ? '我方' : logActor === 'enemy' ? '敌方' : '天道';
    const sourceId = frame.source || frame.cue?.sourceId;
    const source = sourceId ? ` · ${this.sourceLabel(sourceId)}` : '';
    const deltas = this.frameDeltas(frame, previous);
    const outcome = deltas.join('；') || (frame.kind === 'rage' && frame.amount !== undefined ? `怒气 ${formatNumber(frame.amount)}` : '');
    if (!this.detailedLog) {
      return `<p class="battle-log-row simple"><span>第${semanticTextMarkup(formatNumber(frame.round))}回合</span><b>${esc(actor)} · ${esc(kind)}${esc(source)}</b><em>${semanticTextMarkup(localizeBattleText(asText(frame.text, '气机交锋')))}${outcome ? ` · ${semanticTextMarkup(outcome)}` : ''}</em></p>`;
    }
    return `<p class="battle-log-row detailed"><span>第${semanticTextMarkup(formatNumber(frame.round))}回合</span><b>${esc(actor)} · ${esc(kind)}${esc(source)} · ${semanticTextMarkup(localizeBattleText(asText(frame.text, '气机交锋')))}</b><em>${semanticTextMarkup(outcome)}</em></p>`;
  }

  private actionLabel(methodIdValue: unknown, action: any): string {
    const id = asText(action?.id, action);
    if (id === 'wait') return '蓄气等待';
    const method = this.methodEntity(methodIdValue);
    const actions = [method?.actions?.basic, method?.actions?.rage];
    const found = actions.find(item => item?.id === id || item?.name === id);
    return asText(found?.name, id === 'rage_action' ? method?.actions.rage.name : id === 'basic_action' ? method?.actions.basic.name : '动作');
  }

  private battleDiagnostics(result?: BattleResult): string {
    if (!result) return '';
    const contributions = this.battleContributions(result);
    const coreIds = new Set(this.currentBattleCoreIds());
    const recent = this.recentBattleBuildItems();
    const active = contributions.filter((item) =>
      asNumber(item.triggers) > 0 || this.contributionHasMeasuredEffect(item),
    ).sort((a, b) =>
      Number(coreIds.has(b.id)) - Number(coreIds.has(a.id)) ||
      asNumber(b.triggers) - asNumber(a.triggers),
    ).slice(0, 8);
    const zero = contributions.filter((item) => asNumber(item.triggers) === 0 &&
      !this.contributionHasMeasuredEffect(item) &&
      !this.isAttributeOnlyArtifact(item.id));
    const summary = (item: any): string => [
      asNumber(item.damage) > 0 ? `${formatNumber(item.damage)} 伤害` : '',
      asNumber(item.healing) > 0 ? `${formatNumber(item.healing)} 治疗` : '',
      asNumber(item.shield) > 0 ? `${formatNumber(item.shield)} 护盾` : '',
      asNumber(item.rage) > 0 ? `${formatNumber(item.rage)} 怒气` : '',
      `${formatNumber(item.triggers)} 次生效`,
    ].filter(Boolean).join(' · ');
    return `<div class="diagnostics"><div><span class="eyebrow">本局显效</span>${active.length ? active.map((item) => {
      const recentLabel = this.recentContributionLabel(item, recent);
      return `<p><b>${esc(this.displayText(item.name, this.sourceLabel(item.id)))}${recentLabel ? `<em class="contribution-recent">${recentLabel}</em>` : ''}</b><span>${this.textMarkup(summary(item))}</span></p>`;
    }).join('') : '<p class="muted">暂无显效记录</p>'}</div><div><span class="eyebrow">尚未显效</span>${zero.length ? zero.map((item) => `<p><b>${esc(this.displayText(item.name, this.sourceLabel(item.id)))}</b><span>${esc(this.contributionReason(item))}</span></p>`).join('') : '<p class="muted">没有其他记录</p>'}</div></div>`;
  }

  private contributionReason(item: any): string {
    if (this.isAttributeOnlyArtifact(asText(item?.id))) return '属性已生效';
    const reason = localizeReason(item?.reason);
    if (reason === '本局未满足触发条件') return '本局没有遇到合适时机';
    if (reason === '被动修正本局未用到') return '本局没有用上';
    if (reason.includes('条件效果未触发')) return '本局没有遇到合适时机';
    return reason;
  }

  private isAttributeOnlyArtifact(id: string): boolean {
    const artifact = this.artifactEntity(id);
    const attributes = isRecord(artifact?.attributes) ? artifact.attributes : {};
    const hasAttributes = Object.values(isRecord(attributes.flat) ? attributes.flat : {}).some((value) => asNumber(value) !== 0) ||
      Object.values(isRecord(attributes.percent) ? attributes.percent : {}).some((value) => asNumber(value) !== 0);
    return Boolean(artifact && hasAttributes && !artifact.core_rule &&
      listOf<any>(artifact.effects).length === 0);
  }

  private rewardRefineSources(state: RunState): ArtifactStack[] {
    const equipped = new Set(this.equipmentState(state).slots);
    return listOf<ArtifactStack>(state.artifacts).filter((stack) => {
      const artifact = this.artifactEntity(stack.id);
      return asNumber(stack.stacks) > 0 && !equipped.has(stack.id) &&
        Boolean(artifact) && entityRarity(artifact) === 'common';
    });
  }

  private rewardRefineTargets(state: RunState): ArtifactStack[] {
    const equipped = new Set(this.equipmentState(state).slots);
    return listOf<ArtifactStack>(state.artifacts).filter((stack) => {
      const artifact = this.artifactEntity(stack.id);
      const maxStacks = Math.max(1, asNumber(artifact?.max_stacks, 1));
      return asNumber(stack.stacks) > 0 && equipped.has(stack.id) &&
        Boolean(artifact) && entityRarity(artifact) === 'common' &&
        asNumber(stack.stacks) < maxStacks;
    });
  }

  private rewardRefineUsage(state: RunState): { used: number; limit: number; remaining: number } {
    const configured = Math.floor(asNumber(this.rules().economy?.reward_refining?.max_per_act, 1));
    const limit = Math.max(0, configured);
    const used = listOf<any>(state.rewardRefinements)
      .filter((record) => record?.act === state.act).length;
    return { used, limit, remaining: Math.max(0, limit - used) };
  }

  private rewardRefinePreview(source: string, target: string): {
    available: boolean;
    reason: string;
    sourceStacks: number;
    targetStacks: number;
    nextStacks: number;
    awakening: boolean;
    forfeited: string[];
  } {
    const unavailable = {
      available: false,
      reason: 'preview-unavailable',
      sourceStacks: 0,
      targetStacks: 0,
      nextStacks: 0,
      awakening: false,
      forfeited: [] as string[],
    };
    const api = (this.game as (RuntimeGame & {
      rewardRefinePreview?: (sourceId: string, targetId: string) => unknown;
    }) | null)?.rewardRefinePreview;
    if (!this.game || typeof api !== 'function' || !source || !target) return unavailable;
    try {
      const preview = api.call(this.game, source, target);
      if (!isRecord(preview)) return unavailable;
      return {
        available: preview.available === true,
        reason: asText(preview.reason),
        sourceStacks: Math.max(0, asNumber(preview.sourceStacks)),
        targetStacks: Math.max(0, asNumber(preview.targetStacks)),
        nextStacks: Math.max(0, asNumber(preview.nextStacks)),
        awakening: preview.awakening === true,
        forfeited: unique(listOf<string>(preview.forfeited)
          .filter((id) => typeof id === 'string')).slice(0, 3),
      };
    } catch {
      return unavailable;
    }
  }

  private rewardRefineReason(reason: string): string {
    if (!reason) return '';
    if (/[一-鿿]/.test(reason)) return reason;
    const key = reason.toLowerCase();
    if (/phase|not.?reward/.test(key)) return '仅限战后取舍阶段炼宝。';
    if (/act.?unavailable/.test(key)) return '本幕不支持炼宝。';
    if (/settled|frozen/.test(key)) return '战果尚未结算，暂不能炼宝。';
    if (/guaranteed|first.?core|core.?offer/.test(key)) return '首次必得核心法宝的候选不可炼宝。';
    if (/empty|candidate/.test(key)) return '本次奖励没有可放弃的候选。';
    if (/mixed|rarity|rare|legendary|not.?common|common-only/.test(key)) return '仅普通法宝奖励可炼宝。';
    if (/limit|used|exhaust/.test(key)) return '本幕炼宝次数已用尽。';
    if (/equipped.*source|source.*equipped/.test(key)) return '材料必须未装备。';
    if (/capped|full|target.*stack/.test(key)) return '目标法宝已达叠层上限。';
    if (/source|target|reference|artifact|invalid/.test(key)) return '材料或目标已变化，请重新选择。';
    return `当前无法炼宝：${this.displayText(reason)}`;
  }

  private rewardRefinePanelMarkup(state: RunState): string {
    const sources = this.rewardRefineSources(state);
    const source = sources.find((stack) => stack.id === this.rewardRefineSourceId) || sources[0];
    const sourceId = asText(source?.id);
    this.rewardRefineSourceId = sourceId;

    const targets = this.rewardRefineTargets(state);
    const target = targets.find((stack) => stack.id === this.rewardRefineTargetId) || targets[0];
    const targetId = asText(target?.id);
    this.rewardRefineTargetId = targetId;

    const usage = this.rewardRefineUsage(state);
    const preview = this.rewardRefinePreview(sourceId, targetId);
    const reason = usage.remaining === 0
      ? '本幕炼宝次数已用尽。'
      : !sources.length
        ? '需要一件未装备的普通法宝作材料。'
        : !targets.length
          ? '需要一件已装备且未满层的普通法宝作为目标。'
          : preview.available
            ? ''
            : this.rewardRefineReason(preview.reason) || '当前无法炼宝。';
    const available = preview.available && usage.remaining > 0 && Boolean(source && target);
    const candidates = preview.forfeited.length ? preview.forfeited : state.rewardCandidates;
    const candidateNames = candidates.map((id) =>
      asText(this.artifactEntity(id)?.name, id),
    );
    const sourceCurrent = source
      ? Math.max(0, preview.sourceStacks || asNumber(source.stacks))
      : 0;
    const targetCurrent = target
      ? Math.max(0, preview.targetStacks || asNumber(target.stacks))
      : 0;
    const targetNext = target
      ? (preview.nextStacks > targetCurrent ? preview.nextStacks : targetCurrent + 1)
      : 0;
    const maxStacks = Math.max(1, asNumber(this.artifactEntity(targetId)?.max_stacks, 1));
    const awakening = this.artifactEntity(targetId)?.awakening;
    const awakeningMarkup = preview.awakening && isRecord(awakening) &&
      Math.floor(asNumber(awakening.at_stacks)) === targetNext
      ? `<p class="reward-refine-awakening" role="status">达成觉醒 · ${esc(asText(awakening.name, '觉醒'))}${awakening.quick ? `：${this.textMarkup(awakening.quick)}` : ''}</p>`
      : '';
    return `<div class="reward-refine-body" data-refine-panel-content>
      <p class="reward-refine-usage" aria-live="polite">本幕炼宝 ${usage.remaining} / ${usage.limit} 次</p>
      <div class="reward-refine-selects">
        <label for="reward-refine-source">未装备材料
          <select id="reward-refine-source" data-refine-source ${sources.length ? '' : 'disabled'} aria-describedby="reward-refine-reason">${sources.map((stack) =>
            `<option value="${esc(stack.id)}" ${stack.id === sourceId ? 'selected' : ''}>${esc(asText(this.artifactEntity(stack.id)?.name, stack.id))} · ×${formatNumber(stack.stacks)}</option>`,
          ).join('') || '<option value="">没有可用材料</option>'}</select>
        </label>
        <label for="reward-refine-target">已装备目标
          <select id="reward-refine-target" data-refine-target ${targets.length ? '' : 'disabled'} aria-describedby="reward-refine-reason">${targets.map((stack) =>
            `<option value="${esc(stack.id)}" ${stack.id === targetId ? 'selected' : ''}>${esc(asText(this.artifactEntity(stack.id)?.name, stack.id))} · ×${formatNumber(stack.stacks)}</option>`,
          ).join('') || '<option value="">没有可用目标</option>'}</select>
        </label>
      </div>
      <div class="reward-refine-impact" aria-live="polite">
        <p><span>材料损失</span><b>${source ? `${esc(asText(this.artifactEntity(sourceId)?.name, sourceId))} ×${formatNumber(sourceCurrent)} → ×${formatNumber(Math.max(0, sourceCurrent - 1))}${sourceCurrent === 1 ? ' · 材料耗尽，收藏种类 -1' : ''}` : '消耗一层未装备普通法宝'}</b></p>
        <p><span>目标叠层</span><b>${target ? `${esc(asText(this.artifactEntity(targetId)?.name, targetId))} ${formatNumber(targetCurrent)} → ${formatNumber(targetNext)} / ${formatNumber(maxStacks)}` : '增加一层已装备普通法宝'}</b></p>
      </div>
      <section class="reward-refine-forfeit" aria-label="放弃的奖励">
        <b>确认后放弃本次整份奖励，不收入任何候选。</b>
        <ul>${candidateNames.map((name) => `<li>${esc(name)}</li>`).join('') || '<li>当前没有候选奖励</li>'}</ul>
      </section>
      <p class="reward-refine-no-coins">炼宝不消耗或获得灵石。</p>
      ${awakeningMarkup}
      <p class="reward-refine-reason" id="reward-refine-reason" role="status" ${reason ? '' : 'hidden'}>${esc(reason)}</p>
      <button type="button" class="button primary reward-refine-confirm" data-action="refine-reward" aria-describedby="reward-refine-reason" ${available ? '' : 'disabled'}>确认炼宝</button>
    </div>`;
  }

  private rewardRefineMarkup(state: RunState): string {
    const usage = this.rewardRefineUsage(state);
    return `<details class="disclosure reward-refine" data-details="reward-refine"><summary>${icon('mirror', 16)}炼宝 · 本幕余 ${usage.remaining} 次</summary><div data-refine-panel>${this.rewardRefinePanelMarkup(state)}</div></details>`;
  }

  private rewardView(state: RunState): string {
    const candidates = unique(listOf<string>((state as any).rewardCandidates || (state as any).rewards || [])).slice(0, 3);
    const thunderStage = (state as any)._thunderRewardStage;
    const bonus = thunderStage === 'bonus';
    const thunderNormal = thunderStage === 'normal';
    const kicker = bonus ? '雷劫邀战 · 额外奖励' : thunderNormal ? '雷劫邀战 · 普通战斗奖励' : '战后取舍';
    return `${this.stageHeading(kicker, bonus ? '另选一件稀有或传奇法宝' : '收一件法宝')}
      ${bonus ? '<p class="thunder-reward-note" role="status">普通战斗奖励已单独结算；这是邀战胜利后追加的一次选择。</p>' : ''}
      ${thunderNormal ? '<p class="thunder-reward-note" role="status">这是本场普通战斗奖励；选择后会进入另一阶段，单独选择雷劫加赏。</p>' : ''}
      ${state.resultText ? `<p class="chapter-aftermath">${esc(state.resultText)}</p>` : ''}
      <div class="reward-grid">${candidates.map((id) => this.rewardCard(id)).join('') || '<p class="empty-note">本节点没有候选法宝。</p>'}</div>
      ${bonus ? '' : `<details class="disclosure reward-search" data-details="reward-search"><summary>${icon('eye', 16)}寻缘 · ${formatNumber(this.rewardSearchPrice())} 灵石</summary><div data-seek-panel>${this.rewardSearchPanelMarkup(state, this.rewardSearchFamily)}</div></details>
      ${this.rewardRefineMarkup(state)}`}
      ${bonus ? '' : `<div class="stage-actions"><button class="button quiet" data-action="reward" data-id="">舍下法宝，领取 ${formatNumber(asNumber(this.rules().economy?.artifact_decline_coins, 4))} 灵石 ${icon('coin', 15)}</button></div>`}${this.inlineMessage()}`;
  }

  private rewardSearchPrice(): number {
    return Math.max(0, Math.floor(asNumber(this.rules().economy?.reward_seeking?.price, 8)));
  }

  private rewardSearchPreview(family: ArtifactRewardFamily): {
    available: boolean;
    reason: string;
    cost: number;
    candidates: string[];
  } {
    const api = (this.game as (RuntimeGame & {
      rewardSearchPreview?: (selected: ArtifactRewardFamily) => unknown;
    }) | null)?.rewardSearchPreview;
    if (!this.game || typeof api !== 'function') {
      return { available: false, reason: '寻缘预览暂不可用。', cost: this.rewardSearchPrice(), candidates: [] };
    }
    try {
      const preview = api.call(this.game, family);
      if (!isRecord(preview)) {
        return { available: false, reason: '寻缘预览暂不可用。', cost: this.rewardSearchPrice(), candidates: [] };
      }
      return {
        available: preview.available === true,
        reason: asText(preview.reason),
        cost: Math.max(0, asNumber(preview.cost, this.rewardSearchPrice())),
        candidates: unique(listOf<string>(preview.candidates).filter((id) => typeof id === 'string')).slice(0, 3),
      };
    } catch {
      return { available: false, reason: '寻缘预览暂不可用。', cost: this.rewardSearchPrice(), candidates: [] };
    }
  }

  private rewardSearchReason(reason: string): string {
    if (!reason) return '';
    if (!/[A-Za-z]/.test(reason)) return this.displayText(reason);
    if (/coin|afford|price|cannot-pay|cost/i.test(reason)) return '灵石不足，无法支付寻缘代价。';
    if (/initial|first.*core|core.*offer/i.test(reason)) return '首次必得核心法宝的候选不可寻缘。';
    if (/used|limit|per.?act|already/i.test(reason)) return '本幕已使用过一次寻缘。';
    if (/empty|unchanged|candidate|family|exhaust/i.test(reason)) return '此类法宝没有可替换的候选。';
    if (/act-unavailable/i.test(reason)) return '本幕不支持寻缘。';
    if (/reward-not-frozen/i.test(reason)) return '战果尚未结算，暂不能寻缘。';
    if (/phase|reward/i.test(reason)) return '仅在战后取舍阶段可寻缘。';
    if (/invalid-search-history/i.test(reason)) return '寻缘记录校验失败，本次未执行。';
    return `当前无法寻缘：${this.displayText(reason)}`;
  }

  private rewardSearchPanelMarkup(state: RunState, family: ArtifactRewardFamily): string {
    const preview = this.rewardSearchPreview(family);
    const price = preview.cost;
    const config = this.rules().economy?.reward_seeking;
    const maxPerAct = Math.max(1, Math.floor(asNumber(config?.max_per_act, 1)));
    const used = listOf<any>(state.rewardSearches).filter((record) => record.act === state.act).length;
    const remaining = Math.max(0, maxPerAct - used);
    const candidates = preview.candidates.map((id) => {
      const artifact = this.artifactEntity(id);
      return `<li><b>${esc(asText(artifact?.name, id))}</b><small>${esc(rarityLabel(entityRarity(artifact)))}</small></li>`;
    }).join('');
    const affordable = asNumber(state.coins) >= price;
    const available = preview.available && preview.candidates.length > 0 &&
      remaining > 0 && affordable;
    const reason = this.rewardSearchReason(preview.reason) ||
      (!preview.candidates.length ? '此类法宝没有可替换的候选。' :
        remaining === 0 ? '本幕已使用过一次寻缘。' :
          !affordable ? '灵石不足，无法支付寻缘代价。' : '');
    const reasonId = 'reward-search-reason';
    return `<div class="reward-search-panel">
      <div class="reward-search-controls">
        <label for="reward-search-family">法宝倾向</label>
        <select id="reward-search-family" data-seek-family>${REWARD_FAMILIES.map((option) =>
          `<option value="${option}" ${option === family ? 'selected' : ''}>${REWARD_FAMILY_LABEL[option]}</option>`,
        ).join('')}</select>
      </div>
      <p class="reward-search-state"><span>本幕已用</span><b>${used} / ${maxPerAct}</b><span>费用</span><b>${formatNumber(price)} 灵石</b></p>
      <div class="reward-search-preview" aria-live="polite">
        <span class="eyebrow">免费预览 · ${esc(REWARD_FAMILY_LABEL[family])}类</span>
        ${candidates ? `<ul>${candidates}</ul>` : '<p class="empty-note">暂无可替换候选</p>'}
        ${reason ? `<p class="reward-search-reason" id="${reasonId}" role="status">${esc(reason)}</p>` : `<p class="reward-search-reason" id="${reasonId}" role="status" hidden></p>`}
      </div>
      <button type="button" class="button primary reward-search-confirm" data-action="seek-reward" data-family="${family}" aria-describedby="${reasonId}" ${available ? '' : 'disabled'}>支付 ${formatNumber(price)} 灵石并替换候选</button>
    </div>`;
  }

  private coreRewardSummary(artifact: Entity | undefined): string {
    const rule = artifact?.core_rule;
    if (!isRecord(rule)) return '';
    const ratio = (key: string): string => `${formatNumber(asNumber(rule[key]) * 100, 1)}%`;
    const summaries: Record<string, string> = {
      basic_echo: `普攻追加 ${ratio('ratio')} 攻击伤害；怒技基础伤害降至 ${ratio('rage_damage_ratio')}`,
      basic_convergence: `主普攻本体归为一段、倍率 ${formatNumber(asNumber(rule.damage_ratio), 2)}，不可暴击；独立追击仍会结算`,
      rage_gambit: `怒技完成返怒 ${formatNumber(rule.rage_refund)}；承受直接伤害提高 ${formatNumber((asNumber(rule.incoming_damage_ratio) - 1) * 100)}%`,
      shield_burst: `开场护盾 ${ratio('opening_shield_ratio')}；怒技消耗 ${ratio('shield_ratio')} 护盾，转成 ${formatNumber(rule.damage_ratio, 1)} 倍伤害`,
      healing_guard: `普攻自疗 ${ratio('heal_ratio')}，有效自疗转 ${ratio('shield_ratio')} 护盾；直接伤害降至 ${ratio('direct_damage_ratio')}`,
      poison_detonation: `普攻施毒 ${formatNumber(rule.poison_stacks)} 层；怒技消耗全部预存毒层，引爆 ${formatNumber(rule.damage_ratio, 1)} 倍剩余伤害`,
      burn_siphon: `普攻燃烧 ${formatNumber(rule.burn_stacks)} 层，燃烧伤害吸血 ${ratio('heal_ratio')}；怒技基础伤害降至 ${ratio('rage_damage_ratio')}`,
    };
    return summaries[asText(rule.kind)] ?? '';
  }

  private rewardCard(id: string): string {
    const artifact = this.artifactEntity(id);
    const rarity = entityRarity(artifact);
    const resonance = this.resonanceBrief(artifact);
    const owned = listOf<ArtifactStack>(this.gameState()?.artifacts).find((stack) => stack.id === id);
    const maxStacks = Math.max(1, asNumber(artifact?.max_stacks, 1));
    const stackText = owned
      ? `叠层 ${formatNumber(owned.stacks)} → ${formatNumber(Math.min(maxStacks, owned.stacks + 1))} / ${formatNumber(maxStacks)}`
      : `叠层 1 / ${formatNumber(maxStacks)}`;
    const stats = artifact ? this.artifactStatMarkup(artifact, 2) : '';
    const summary = entitySummary(artifact);
    const summaryParts = summary.split(/[；;]/);
    const hasAttributes = Boolean(stats);
    const resonanceMechanism = resonance
      ? hasAttributes && summaryParts.length > 1
        ? summaryParts.slice(1).join('；').trim() || resonance
        : resonance
      : '';
    const mechanism = resonanceMechanism || this.coreRewardSummary(artifact) || (hasAttributes
      ? summaryParts.length > 1
        ? summaryParts.slice(1).join('；').trim()
        : this.displayText(asText(listOf<any>(artifact?.effects)[0]?.text))
      : summary);
    const disposition = this.acquisitionDisposition(id);
    const awakening = artifact?.awakening;
    const awakeningDistance = asNumber(awakening?.at_stacks) - (asNumber(owned?.stacks) + 1);
    const awakeningText = awakening
      ? awakeningDistance > 0 ? `距觉醒 ${formatNumber(awakeningDistance)} 层` : `觉醒 · ${asText(awakening.quick)}`
      : '';
    return `<article class="reward-card compact-choice-card rarity-${esc(rarity)}" data-id="${esc(id)}">
      <div class="reward-card-top"><span class="rarity-chip ${esc(rarity)}">${esc(RARITY_LABEL[rarity] || '普通')}</span><span class="stack-note">${this.textMarkup(stackText)}</span></div>
      <button type="button" class="reward-inspect" data-action="inspect-artifact" data-id="${esc(id)}" title="法宝详录" aria-label="查看${esc(asText(artifact?.name, '未名法宝'))}详录">
        ${this.artifactMarkup(artifact, sigil(this.artifactIcon(artifact), rarity === 'legendary' ? 'mythic' : rarity === 'rare' ? 'gold' : 'jade'))}
        <h2>${esc(asText(artifact?.name, '未名法宝'))}${icon('eye', 14)}</h2>
      </button>
      ${mechanism ? `<p class="reward-mechanic" title="${esc(mechanism)}">${this.textMarkup(mechanism)}</p>` : ''}
      <p class="reward-equipment-status">${icon(disposition.includes('背包') ? 'book' : 'shield', 15)}${esc(disposition)}</p>
      ${awakeningText ? `<small class="reward-awakening">${this.textMarkup(awakeningText)}</small>` : ''}
      ${stats ? `<div class="attribute-list">${stats}</div>` : ''}
      <div class="compact-choice-actions">
        <button type="button" class="button primary" data-action="reward" data-id="${esc(id)}" title="收入命盘" aria-label="收入${esc(asText(artifact?.name, '未名法宝'))}至命盘">收入</button>
      </div>
    </article>`;
  }

  private eventView(state: RunState): string {
    const event = this.currentEvent();
    if (!event) return this.renderErrorState('找不到当前事件内容。');
    const resultPhase = state.phase === 'event_result';
    const options = listOf<Entity>(event.options);
    const passage = this.displayText(asText(event.scene || event.description, '风声停在你面前。'));
    const brief = [...new Intl.Segmenter('zh', { granularity: 'sentence' }).segment(passage)][0]?.segment.trim() || passage;
    const eventCheck = isRecord((state as any).eventCheck) ? (state as any).eventCheck : undefined;
    const checkResult = typeof eventCheck?.success === 'boolean'
      ? `<span class="event-check-result ${eventCheck.success ? 'success' : 'failure'}">${eventCheck.success ? '检验成功' : '检验未成'}</span>`
      : '';
    return `<section class="event-page"><div class="event-scene-head"><div class="event-portrait">${this.characterMarkup(event, event)}</div><div><span class="eyebrow">${esc(event.event_type === 'core' ? '人物机缘' : '行旅事件')}</span><h2>${esc(asText(event.name, '山海一刻'))}</h2></div></div>
      ${resultPhase ? `<div class="event-result">${checkResult}<p>${this.textMarkup(asText(state.resultText, '选择已经落定。'))}</p></div>` : `<p class="story-text">${esc(brief)}</p>${brief !== passage ? `<details class="disclosure event-passage" data-details="event-passage"><summary>前情详录</summary><p>${esc(passage)}</p></details>` : ''}<div class="story-choices">${options.map((option) => `<div class="story-choice-wrap">${this.eventOption(option)}</div>`).join('')}</div>`}
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
    const label = this.textMarkup(asText(option.label, option.name));
    if (option.reveal === 'hint') {
      const hint = this.displayText(asText(option.check?.hint || option.quick, ''));
      return `<button class="event-option ${check.available ? '' : 'disabled'} event-option-hint" data-action="event" data-id="${esc(option.id)}" ${check.available ? '' : 'disabled'}><span class="event-option-main"><b>${label}</b>${hint ? `<small>${semanticTextMarkup(hint)}</small>` : ''}${costs.length ? `<span class="event-costs">${costs.map((cost) => `<i>${this.textMarkup(this.effectLabel(cost, true))}</i>`).join('')}</span>` : ''}</span>${icon(check.available ? 'arrow' : 'close', 18)}</button>`;
    }
    const hasResolvedEffects = costs.length > 0 || rewards.length > 0;
    const quick = this.displayText(asText(option.quick || option.description, ''));
    const encounter = isRecord(option.encounter) ? option.encounter : undefined;
    const risk = encounter
      ? encounter.mode === 'nonlethal'
        ? `比试 · 败后至少保留 ${formatNumber(asNumber(encounter.failure_hp_floor, 1))} 气血`
        : '斗法 · 落败将结束命途'
      : '';
    const commitment = option.commitment;
    const delayed = commitment
      ? `${commitment.after_nodes}处后：${listOf<any>(commitment.rewards).map(reward => this.effectLabel(reward, false)).join('，')}。期间不进${listOf<string>(commitment.avoid_node_types).map(type => nodeMeta(type).label).join('、')}，失约不退费，终战前未兑现作废。`
      : '';
    return `<button class="event-option ${check.available ? '' : 'disabled'}" data-action="event" data-id="${esc(option.id)}" ${check.available ? '' : 'disabled'}><span class="event-option-main"><b>${label}</b>${risk ? `<small class="event-risk">${this.textMarkup(risk)}</small>` : ''}${!hasResolvedEffects && quick && !commitment ? `<small>${semanticTextMarkup(quick)}</small>` : ''}${costs.length ? `<span class="event-costs">${costs.map((cost) => `<i>${this.textMarkup(this.effectLabel(cost, true))}</i>`).join('')}</span>` : ''}${rewards.length ? `<span class="event-rewards">${encounter ? '<span>胜后</span>' : ''}${rewards.map((reward) => `<i>${this.textMarkup(this.effectLabel(reward, false))}</i>`).join('')}</span>` : ''}${delayed ? `<small class="event-commitment-terms">${this.textMarkup(delayed)}</small>` : ''}${!check.available ? `<em class="disabled-reason">${esc(check.reason || '当前条件不满足')}</em>` : ''}</span>${icon(check.available ? 'arrow' : 'close', 18)}</button>`;
  }

  private effectLabel(effect: any, cost: boolean): string {
    if (!isRecord(effect)) return asText(effect);
    if (effect.type === 'resource') {
      const resource = effect.resource === 'hp' ? '气血' : effect.resource === 'coins' ? '灵石' : '修为';
      if (!cost && effect.resource === 'hp' && this.gameState()?.bloodVow && this.resolveAmount(effect) > 0) {
        return '断生之誓：气血无法恢复';
      }
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

  private reforgePrice(): number {
    try {
      return Math.max(0, asNumber(this.game?.reforgePrice()));
    } catch {
      return 0;
    }
  }

  private reforgeOptions(sourceId: string): string[] {
    try {
      const options = this.game?.reforgeOptions(sourceId);
      return unique(listOf<string>(options)).slice(0, 3);
    } catch {
      return [];
    }
  }

  private reforgeAvailability(sourceId: string, targetId: string): { available: boolean; reason: string } {
    try {
      const result = this.game?.reforgeAvailability(sourceId, targetId);
      if (isRecord(result)) {
        return { available: Boolean(result.available), reason: asText(result.reason) };
      }
    } catch {
      // Render this option as unavailable if the runtime cannot verify it.
    }
    return { available: false, reason: '当前无法确认此重铸' };
  }

  private reforgeReason(reason: string): string {
    const key = reason.toLowerCase();
    if (/[一-鿿]/.test(reason)) return reason;
    if (/already.?used|already.?reforged|once.?per.?shop/.test(key)) return '本店已重铸过一次';
    if (/coin|price|pay|fund/.test(key)) return '灵石不足';
    if (/full|capacity|stack/.test(key)) return '目标法宝已满层';
    if (/unique|conflict|group/.test(key)) return '与已有唯一法宝冲突';
    if (/owned|source|artifact/.test(key)) return '没有可献祭的普通法宝';
    return '当前无法重铸';
  }

  private reforgeSources(state: RunState): Array<{ id: string; name: string; stacks: number }> {
    return listOf<ArtifactStack>(state.artifacts)
      .filter(stack => asNumber(stack.stacks) > 0 &&
        Boolean(this.artifactEntity(stack.id)) &&
        entityRarity(this.artifactEntity(stack.id)) === 'common')
      .map(stack => ({
        id: stack.id,
        name: asText(this.artifactEntity(stack.id)?.name, stack.id),
        stacks: asNumber(stack.stacks),
      }));
  }

  private reforgeTargetsMarkup(state: RunState, sourceId: string): string {
    const source = this.artifactEntity(sourceId);
    const price = this.reforgePrice();
    const used = Boolean((state as any)._shopReforged);
    const options = this.reforgeOptions(sourceId);
    if (!sourceId) return '<p class="empty-note" role="status">尚无可献祭的普通法宝。</p>';
    if (!options.length) return '<p class="empty-note" role="status">没有可重铸目标，候选可能已满层或与唯一法宝冲突。</p>';
    return `<p class="reforge-sacrifice">献祭 ${esc(asText(source?.name, sourceId))} 1 层，支付 ${formatNumber(price)} 灵石；目标法宝增加 1 层。</p>${options.map(targetId => {
      const target = this.artifactEntity(targetId);
      const availability = this.reforgeAvailability(sourceId, targetId);
      const targetStack = state.artifacts.find(stack => stack.id === targetId);
      const maxStacks = Math.max(1, asNumber(target?.max_stacks, 1));
      const currentStacks = asNumber(targetStack?.stacks);
      const reason = used ? '本店已重铸过一次' :
        asNumber(state.coins) < price ? '灵石不足' :
          availability.available ? '' : this.reforgeReason(availability.reason);
      const canReforge = !used && asNumber(state.coins) >= price && availability.available;
      const description = entitySummary(target);
      return `<article class="reforge-option"><div><b>${esc(asText(target?.name, targetId))}</b><span>叠层 ${formatNumber(currentStacks)} → ${formatNumber(Math.min(maxStacks, currentStacks + 1))} / ${formatNumber(maxStacks)}</span>${description ? `<small>${this.textMarkup(description)}</small>` : ''}${reason ? `<em>${esc(reason)}</em>` : ''}</div><button class="button small primary" data-action="reforge" data-source="${esc(sourceId)}" data-target="${esc(targetId)}" ${canReforge ? '' : 'disabled'}>重铸</button></article>`;
    }).join('')}`;
  }

  private reforgeToolMarkup(state: RunState): string {
    const sources = this.reforgeSources(state);
    const sourceId = sources.some(source => source.id === this.reforgeSourceId)
      ? this.reforgeSourceId
      : asText(sources[0]?.id);
    this.reforgeSourceId = sourceId;
    const price = this.reforgePrice();
    const used = Boolean((state as any)._shopReforged);
    const balanceReason = asNumber(state.coins) < price ? '灵石不足' : '';
    return `<details class="disclosure reforge-tool" data-details="shop-reforge"><summary>${icon('mirror', 16)}重铸普通法宝</summary><div class="reforge-tool-body"><label for="reforge-source">献祭器物</label><select id="reforge-source" data-reforge-source ${sources.length ? '' : 'disabled'}>${sources.map(source => `<option value="${esc(source.id)}" ${source.id === sourceId ? 'selected' : ''}>${esc(source.name)} ×${formatNumber(source.stacks)}</option>`).join('') || '<option value="">没有普通法宝</option>'}</select>${!sources.length ? '<p class="reforge-unavailable" role="status">需要持有一件普通法宝。</p>' : ''}<p class="reforge-terms">本店限一次</p>${balanceReason ? `<p class="reforge-unavailable" role="status">${balanceReason}</p>` : ''}${used && !balanceReason ? '<p class="reforge-unavailable" role="status">本店已重铸过一次。</p>' : ''}<div class="reforge-targets" data-reforge-targets>${this.reforgeTargetsMarkup(state, sourceId)}</div></div></details>`;
  }

  private inscriptionAvailability(artifactId: string, inscription: ArtifactInscription): { available: boolean; reason: string } {
    try {
      const result = this.game?.inscriptionAvailability(artifactId, inscription);
      if (isRecord(result)) return { available: Boolean(result.available), reason: asText(result.reason) };
    } catch {
      // Keep the action unavailable if the run cannot verify its price or ownership.
    }
    return { available: false, reason: '铭刻状态暂不可确认' };
  }

  private inscriptionReason(reason: string): string {
    if (/[一-鿿]/.test(reason)) return reason;
    if (/already.?inscribed.?this.?shop/.test(reason)) return '本店已铭刻一次';
    if (/already.?inscribed/.test(reason)) return '这件法宝已有铭刻';
    if (/coin|price|pay|fund/.test(reason)) return '灵石不足';
    if (/owned|artifact/.test(reason)) return '没有持有这件法宝';
    if (/not.?shop/.test(reason)) return '坊市当前未开放';
    if (/invalid.?inscription/.test(reason)) return '铭刻类型无效';
    return '当前无法铭刻';
  }

  private inscriptionControlsMarkup(state: RunState): string {
    const held = listOf<ArtifactStack>(state.artifacts).filter(stack =>
      asNumber(stack.stacks) > 0 && Boolean(this.artifactEntity(stack.id)));
    const candidates = held.filter(stack => !stack.inscription);
    const selectedId = candidates.some(stack => stack.id === this.inscriptionArtifactId)
      ? this.inscriptionArtifactId
      : asText(candidates[0]?.id);
    this.inscriptionArtifactId = selectedId;
    const inscriptions = (this.game?.inscriptionOptions() ?? ['twin', 'leech', 'swift']) as ArtifactInscription[];
    if (!inscriptions.includes(this.inscriptionChoice)) this.inscriptionChoice = 'twin';
    const choice = this.inscriptionChoice;
    const price = Math.max(0, asNumber(this.game?.inscriptionPrice()));
    const availability = selectedId
      ? this.inscriptionAvailability(selectedId, choice)
      : { available: false, reason: 'artifact-not-owned' };
    const reason = availability.available ? '' : this.inscriptionReason(availability.reason);
    const noCandidate = candidates.length === 0;
    const noCandidateReason = held.length
      ? '持有法宝均已有铭刻。'
      : '尚未持有可铭刻法宝。';
    const used = Boolean(state._shopInscribed);
    const cauldron = held.find(stack => stack.id === DEVOURING_ARTIFACT_ID);
    const cauldronNote = cauldron
      ? `<p class="inscription-unavailable" role="note">饕餮鼎没有主动战斗触发；${cauldron.inscription ? `已记录的${INSCRIPTION_COPY[cauldron.inscription].label}铭刻` : '为其铭刻'}不会生效。</p>`
      : '';
    return `<div class="inscription-controls">
      <div class="inscription-selects">
        <label for="inscription-artifact">选择持有法宝</label>
        <select id="inscription-artifact" data-inscription-artifact ${candidates.length ? '' : 'disabled'}>${candidates.map(stack => {
          const artifact = this.artifactEntity(stack.id);
          const equipped = this.equipmentSlotLabel(stack.id);
          return `<option value="${esc(stack.id)}" ${stack.id === selectedId ? 'selected' : ''}>${esc(asText(artifact?.name, stack.id))} · ${equipped ? `已装备 ${equipped}` : '背包未装备'} · ×${formatNumber(stack.stacks)}</option>`;
        }).join('') || '<option value="">暂无未铭刻法宝</option>'}</select>
        <label for="inscription-choice">选择铭刻</label>
        <select id="inscription-choice" data-inscription-choice>${inscriptions.map(inscription =>
          `<option value="${inscription}" ${inscription === choice ? 'selected' : ''}>${INSCRIPTION_COPY[inscription].label} · ${INSCRIPTION_COPY[inscription].effect}</option>`,
        ).join('')}</select>
      </div>
      <p class="inscription-effect"><b>${INSCRIPTION_COPY[choice].label}</b><span>${INSCRIPTION_COPY[choice].effect}</span></p>
      <p class="inscription-terms">铭刻花费 ${formatNumber(price)} 灵石 · 每间坊市限一件 · 同 ID 叠层保留原铭刻</p>
      ${cauldronNote}
      ${noCandidate ? `<p class="inscription-unavailable" role="status">${noCandidateReason}</p>` : ''}
      ${used ? '<p class="inscription-unavailable" role="status">本店已铭刻一次。</p>' : ''}
      ${reason && !noCandidate && !used ? `<p class="inscription-unavailable" role="status">${esc(reason)}</p>` : ''}
      <button type="button" class="button primary inscription-commit" data-action="inscribe" data-artifact="${esc(selectedId)}" data-inscription="${choice}" title="${esc(reason)}" ${availability.available && !used ? '' : 'disabled'}>铭刻${INSCRIPTION_COPY[choice].label} · ${formatNumber(price)} 灵石</button>
    </div>`;
  }

  private inscriptionToolMarkup(state: RunState): string {
    const price = Math.max(0, asNumber(this.game?.inscriptionPrice()));
    return `<details class="disclosure inscription-tool" data-details="shop-inscription"><summary>${icon('pearl', 16)}古炉铭刻 <span>每店一次 · ${formatNumber(price)} 灵石</span></summary><div class="inscription-tool-body" data-inscription-controls>${this.inscriptionControlsMarkup(state)}</div></details>`;
  }

  private warmableArtifacts(): string[] {
    try {
      return unique(listOf<string>(this.game?.warmableArtifacts()))
        .filter(id => Boolean(this.artifactEntity(id)));
    } catch {
      return [];
    }
  }

  private warmCost(): number {
    try {
      return Math.max(0, asNumber(this.game?.warmCost()));
    } catch {
      return 0;
    }
  }

  private restTemperPanelMarkup(state: RunState): string {
    const artifactIds = this.warmableArtifacts();
    const artifactId = artifactIds.includes(this.warmArtifactId)
      ? this.warmArtifactId
      : asText(artifactIds[0]);
    this.warmArtifactId = artifactId;
    const cost = this.warmCost();
    const artifact = this.artifactEntity(artifactId);
    if (!artifactId || !artifact) {
      return '<p class="empty-note" role="status">暂无可温养的法宝，候选可能已满层或冲突。</p>';
    }
    const owned = state.artifacts.find(stack => stack.id === artifactId);
    const maxStacks = Math.max(1, asNumber(artifact.max_stacks, 1));
    const currentStacks = asNumber(owned?.stacks);
    const enoughCoins = asNumber(state.coins) >= cost;
    return `<label for="rest-temper-artifact">温养法宝</label><select id="rest-temper-artifact" data-temper-artifact>${artifactIds.map(id => {
      const entity = this.artifactEntity(id);
      return `<option value="${esc(id)}" ${id === artifactId ? 'selected' : ''}>${esc(asText(entity?.name, id))}</option>`;
    }).join('')}</select><p class="rest-temper-result">${esc(asText(artifact.name, artifactId))}：叠层 ${formatNumber(currentStacks)} → ${formatNumber(Math.min(maxStacks, currentStacks + 1))} / ${formatNumber(maxStacks)}</p><p class="reforge-terms">定向提升 1 层 · ${formatNumber(cost)} 灵石</p>${enoughCoins ? '' : '<p class="reforge-unavailable" role="status">灵石不足</p>'}<button class="button small primary" data-action="rest" data-choice="temper" data-artifact="${esc(artifactId)}" ${enoughCoins ? '' : 'disabled'}>温养此物</button>`;
  }

  private shopView(state: RunState): string {
    const items = listOf<any>(state.shop);
    return `<header class="shop-heading">${this.stageHeading('', '坊市')}<span class="shop-stock">库存 ${items.filter((item) => !item.sold).length} / ${items.length || 5}</span></header>
      <div class="shop-grid">${items.map((item) => this.shopItem(item)).join('') || '<p class="empty-note">坊市没有可展示的库存。</p>'}</div>${this.inscriptionToolMarkup(state)}${this.reforgeToolMarkup(state)}<div class="stage-actions"><button class="button primary" data-action="leave-shop" data-autofocus>离开坊市 ${icon('arrow', 16)}</button></div>${this.inlineMessage()}`;
  }

  private shopItem(item: any): string {
    const artifact = this.artifactEntity(item.id);
    const kind = asText(item.kind, artifact ? 'artifact' : 'service');
    const price = asNumber(item.price);
    const sold = Boolean(item.sold);
    const state = this.gameState();
    const preparationHeld = kind === 'preparation' && asNumber(state?.preparation) > 0;
    const selectedTalents = listOf<string>(state?.talents?.[state.method]);
    const talentResetUnavailable = kind === 'talent_reset' && selectedTalents.length === 0;
    const availability = this.game?.shopPurchaseAvailability(asText(item.id));
    const canBuy = !sold && asNumber(state?.coins) >= price && !preparationHeld && !talentResetUnavailable && (availability?.available ?? true);
    const label = artifact ? asText(artifact.name, item.id) : kind === 'recovery' ? '回春调息' : kind === 'talent_reset' ? '洗髓丹' : '护体准备';
    const amount = kind === 'recovery' ? 0.12 * this.referenceHp() : kind === 'preparation' ? 0.10 * this.referenceHp() : 0;
    const description = artifact
      ? entitySummary(artifact)
      : kind === 'recovery'
        ? `恢复 ${formatNumber(amount)} 气血。`
        : kind === 'talent_reset'
          ? '重选当前功法已悟天赋。'
          : `为下一场战斗准备 ${formatNumber(amount)} 护盾。`;
    const disabledReason = sold ? '' : availability?.reason === 'blood-vow-blocks-healing' ? '断生之誓：本局战外无法回血' : talentResetUnavailable ? '当前功法尚无已悟天赋' : preparationHeld ? `已有 ${formatNumber(state?.preparation)} 预备护盾` : asNumber(state?.coins) < price ? '灵石不足' : '';
    const contentTag = artifact ? 'button' : 'div';
    const inspectAttributes = artifact
      ? `data-action="inspect-artifact" data-id="${esc(asText(item.id))}" title="法宝详录" aria-label="查看${esc(asText(artifact.name, '法宝'))}详录"`
      : '';
    const motif = artifact ? this.artifactIcon(artifact) : kind === 'recovery' ? 'gourd' : kind === 'talent_reset' ? 'book' : 'shield';
    const buyButton = sold ? '<span class="sold-stamp">售罄</span>' : `<button class="button small" data-action="buy" data-id="${esc(asText(item.id))}" title="${esc(disabledReason)}" ${canBuy ? '' : 'disabled'}>${icon('coin', 13)}${this.textMarkup(price)}</button>`;
    return `<article class="shop-item ${sold ? 'sold' : ''} ${artifact ? `rarity-${esc(entityRarity(artifact))}` : `service-item service-${esc(kind)}`}"><${contentTag} class="shop-content ${artifact ? 'shop-inspect' : ''}" ${inspectAttributes}><div class="shop-item-art">${this.artifactMarkup(artifact, sigil(motif, artifact ? 'jade' : 'shield'))}</div><div class="shop-item-copy">${artifact ? `<span class="rarity-chip ${esc(entityRarity(artifact))}">${esc(rarityLabel(entityRarity(artifact)))}</span>` : ''}<h2>${esc(label)}${artifact ? icon('eye', 14) : ''}</h2><p>${this.textMarkup(description)}</p>${!sold && !canBuy ? `<small class="shop-item-unavailable" role="status">${this.textMarkup(disabledReason || '暂不可购买')}</small>` : ''}</div></${contentTag}>${buyButton}</article>`;
  }

  private restView(state: RunState): string {
    const methods = listOf<string>(state.ownedMethods).map((id) => this.methodEntity(id)).filter((value): value is Entity => Boolean(value));
    const currentMethod = this.methodEntity(state.method);
    const fromEvent = Boolean((state as any)._restFromEvent);
    const healAmount = asNumber(this.rules().economy?.rest_heal_ratio, 0.25) * this.referenceHp();
    const prepAmount = 0.1 * this.referenceHp();
    const healBlocked = this.game?.restChoiceAvailability('heal').reason === 'blood-vow-blocks-healing';
    const swapDisabled = methods.length <= 1;
    const swapList = methods.length > 1
      ? `<div class="method-swap-list"><span class="eyebrow">可切换功法</span>${methods.map((method) => `<button class="method-swap ${method.id === state.method ? 'current' : ''}" data-action="rest-method" data-id="${esc(method.id)}" ${method.id === state.method ? 'disabled' : ''}><b>${esc(method.name)}</b><small>${esc(asText(method.role, method.summary))}</small></button>`).join('')}</div>`
      : '';
    const choices = fromEvent
      ? `<div class="rest-event-note">这份机缘只留下换法的机会。</div>${swapList}`
      : `<p class="rest-limit">本次休整仅选一项</p><div class="rest-grid"><button class="rest-choice" data-action="rest" data-choice="heal" ${healBlocked ? 'disabled' : ''}><span>${sigil('gourd', 'shield')}</span><b>调息</b><p>${this.textMarkup(healBlocked ? '断生之誓：本局战外无法回血' : `恢复 ${formatNumber(healAmount)} 气血`)}</p></button><button class="rest-choice" data-action="rest" data-choice="preparation" ${state.preparation > 0 ? 'disabled' : ''}><span>${sigil('shield', 'jade')}</span><b>备战</b><p>${this.textMarkup(`下战护盾 +${formatNumber(prepAmount)}`)}</p>${state.preparation > 0 ? `<small>${this.textMarkup(`已有 ${formatNumber(state.preparation)} 护盾`)}</small>` : ''}</button>${swapDisabled ? '' : `<details class="rest-choice rest-swap" data-details="rest-swap"><summary>${sigil('book', 'gold')}<b>换法</b></summary>${swapList}</details>`}<details class="rest-choice rest-temper" data-details="rest-temper"><summary>${sigil('pearl', 'jade')}<b>温养</b><small>定向提升法宝一层</small></summary><div class="rest-temper-panel" data-temper-panel>${this.restTemperPanelMarkup(state)}</div></details></div><details class="disclosure rest-rules" data-details="rest-rules"><summary>休整详情</summary><p>调息不增加怒气。预备护盾用于下一场战斗，不能重复准备。温养定向提升一件可温养法宝一层并支付灵石。换法只切换已拥有的功法，各门天赋保留；完成任一选项同样消耗本次休整。</p></details>`;
    return `${this.stageHeading('途中歇息', '山中一息')}
      <section class="rest-summary"><div><span>预备护盾</span><b>${this.textMarkup(state.preparation)}</b></div><div><span>当前功法</span><b>${esc(asText(currentMethod?.name, state.method))}</b></div></section>
      ${choices}${this.inlineMessage()}`;
  }

  private talentTreeMarkup(methodIdValue: string, selectable = false, activeTalents: Entity[] = []): string {
    const method = this.methodEntity(methodIdValue);
    const talents = listOf<Entity>(method?.talents)
      .slice()
      .sort((left, right) => asNumber(left.tier) - asNumber(right.tier) ||
        asText(left.branch).localeCompare(asText(right.branch)));
    const state = this.gameState();
    const selectedIds = new Set(listOf<string>(state?.talents?.[methodIdValue]));
    const activeIds = new Set(activeTalents.map((talent) => talent.id));
    const maxUnlockedTier = Math.max(
      asNumber(state?.method === methodIdValue ? state.n : 0),
      ...[...selectedIds, ...activeIds].map((id) =>
        asNumber(talents.find((talent) => talent.id === id)?.tier),
      ),
    );
    return `<div class="talent-tree ${selectable ? 'talent-tree-selecting' : 'talent-tree-readonly'}" data-method="${esc(methodIdValue)}">
      <svg class="talent-tree-connectors" aria-hidden="true" focusable="false"></svg>
      ${[1, 2, 3, 4].map((tier) => {
        const currentTier = [...activeIds].some((id) =>
          asNumber(talents.find((talent) => talent.id === id)?.tier) === tier,
        );
        return `<div class="talent-tier-wrap">
          <header class="talent-tier-heading"><b class="talent-tier">第 ${tier} 层</b><span>${currentTier ? '当前突破' : tier <= maxUnlockedTier ? '已解锁' : '未解锁'}</span></header>
          <section class="talent-tier-row" data-tier="${tier}" data-current="${currentTier}">
            ${['A', 'B', 'C'].map((branch) => {
            const talent = talents.find((item) => asNumber(item.tier) === tier && asText(item.branch) === branch);
            if (!talent) return '<div class="talent-node-cell"><span class="talent-tree-node talent-tree-empty" data-future="true" aria-hidden="true"></span></div>';
            const selected = selectedIds.has(talent.id);
            const active = activeIds.has(talent.id);
            const locked = tier > maxUnlockedTier;
            const stateClass = selected ? 'is-selected' : active ? 'is-choice' : locked ? 'is-future' : '';
            const stateLabel = selected ? '已悟' : active ? '当前可选' : locked ? '未解锁' : '备选';
            const canSelect = selectable && active;
            return `<div class="talent-node-cell">
              <button type="button" class="talent-tree-node ${stateClass}" data-talent-id="${esc(talent.id)}" data-selected="${selected}" data-choice="${active ? 'current' : ''}" data-future="${locked}" aria-pressed="${selected}" data-action="inspect-talent" data-id="${esc(talent.id)}" data-method="${esc(methodIdValue)}" aria-label="查看${esc(asText(talent.name, '未名天赋'))}详录">
                <strong>${esc(asText(talent.name, '未名天赋'))}</strong>${selected || active ? `<small>${this.textMarkup(asText(talent.quick, asText(talent.description, '长久修行所得')))}</small>` : ''}<span class="talent-node-state">${stateLabel}</span>
              </button>
              ${canSelect ? `<button type="button" class="button small primary talent-select" data-action="talent" data-id="${esc(talent.id)}">悟得 ${icon('arrow', 13)}</button>` : ''}
            </div>`;
          }).join('')}
          </section>
        </div>`;
      }).join('')}
    </div>`;
  }

  private syncTalentTreeConnectors(): void {
    const svgNamespace = 'http://www.w3.org/2000/svg';
    this.root.querySelectorAll<HTMLElement>('.talent-tree').forEach((tree) => {
      const svg = tree.querySelector<SVGSVGElement>('.talent-tree-connectors');
      if (!svg) return;
      const treeRect = tree.getBoundingClientRect();
      if (treeRect.width <= 0 || treeRect.height <= 0) {
        svg.replaceChildren();
        return;
      }
      svg.setAttribute('viewBox', `0 0 ${treeRect.width} ${treeRect.height}`);
      const selectedByTier = new Map<number, HTMLElement>();
      const choices: HTMLElement[] = [];
      tree.querySelectorAll<HTMLElement>('.talent-tree-node[data-talent-id]').forEach((node) => {
        const tier = asNumber(node.closest<HTMLElement>('.talent-tier-row')?.dataset.tier);
        if (node.dataset.selected === 'true') selectedByTier.set(tier, node);
        if (node.dataset.choice === 'current') choices.push(node);
      });

      const nodePoint = (node: HTMLElement, edge: 'top' | 'bottom'): { x: number; y: number } => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2 - treeRect.left,
          y: (edge === 'top' ? rect.top : rect.bottom) - treeRect.top,
        };
      };
      const paths: SVGPathElement[] = [];
      const connect = (from: HTMLElement, to: HTMLElement, kind: 'earned' | 'next'): void => {
        const start = nodePoint(from, 'bottom');
        const end = nodePoint(to, 'top');
        const middleY = (start.y + end.y) / 2;
        const path = document.createElementNS(svgNamespace, 'path');
        path.setAttribute('d', `M ${start.x} ${start.y} C ${start.x} ${middleY}, ${end.x} ${middleY}, ${end.x} ${end.y}`);
        path.setAttribute(kind === 'earned' ? 'data-earned' : 'data-next', 'true');
        paths.push(path);
      };

      for (let tier = 2; tier <= 4; tier += 1) {
        const previous = selectedByTier.get(tier - 1);
        const selected = selectedByTier.get(tier);
        if (previous && selected) connect(previous, selected, 'earned');
      }
      for (const choice of choices) {
        const tier = asNumber(choice.closest<HTMLElement>('.talent-tier-row')?.dataset.tier);
        const previous = selectedByTier.get(tier - 1);
        if (previous) connect(previous, choice, 'next');
      }
      svg.replaceChildren(...paths);
    });
  }

  private talentView(state: RunState): string {
    const candidates = this.talentObjects();
    const selectedCount = listOf<string>(state.talents?.[state.method]).length;
    return `${this.stageHeading('修为突破', '一念悟道')}
      <p class="talent-method-summary"><b>${esc(asText(this.methodEntity(state.method)?.name, state.method))}</b><span>已悟 ${selectedCount} / 4 层</span></p>
      <section class="talent-candidate-section" aria-labelledby="talent-candidate-title"><div class="section-heading"><h2 id="talent-candidate-title">本次候选</h2><span>${candidates.length} 项</span></div><div class="talent-candidate-grid">${candidates.map((talent) => `<article class="talent-candidate ${this.isSharedTalent(talent) ? 'is-shared' : ''}" data-id="${esc(talent.id)}"><div class="talent-candidate-head"><span>${this.isSharedTalent(talent) ? `${icon('star', 14)}共通洞见` : `第 ${formatNumber(talent.tier, 1)} 层 · ${localizeBranch(talent.branch)}分支`}</span>${this.talentButton(talent, state.method, 'talent-candidate-inspect', `查看${asText(talent.name, '天赋')}详录`)}</div><p>${esc(this.displayText(asText(talent.quick, asText(talent.description, '长久修行所得'))))}</p>${this.isSharedTalent(talent) ? this.buildMechanicMarkup(talent, true) : ''}<button type="button" class="button primary talent-candidate-select" data-action="talent" data-id="${esc(talent.id)}">悟得此项 ${icon('arrow', 15)}</button></article>`).join('') || '<p class="empty-note">本次候选暂不可见，请重新打开命途。</p>'}</div></section>
      <details class="disclosure talent-tree-disclosure" data-details="talent-tree-preview"><summary>查看当前功法的天赋谱</summary>${this.talentTreeMarkup(state.method, false)}</details>
      ${this.inlineMessage()}`;
  }

  private transitionView(state: RunState): string {
    const act = this.currentAct();
    const story = isRecord(act.story) ? act.story : {};
    const boss = state.nodes.find(node => node.type === 'B' && node.completed);
    const aftermath = boss ? asText(story.boss_variants?.[boss.id], asText(story.boss_after)) : '';
    return `${this.stageHeading('幕间', asText(act.name, `第${state.act}幕`))}<section class="transition-scene">${landscape()}<div><p>${esc(aftermath)}</p></div></section><p class="chapter-passage">${esc(asText(story.passage, '你踏上下一段山海路。'))}</p>${this.storyEchoMarkup(state, state.act, 2)}<div class="stage-actions"><button class="button primary" data-action="continue" data-autofocus>${state.act === 4 ? '独入天门' : '进入下一幕'} ${icon('arrow', 16)}</button></div>${this.inlineMessage()}`;
  }

  private endView(state: RunState): string {
    const win = state.phase === 'won';
    const result = state.battle;
    const artifacts = listOf<ArtifactStack>(state.artifacts);
    return `${this.stageHeading('行旅归档', asText(state.name, '无名行者'))}
      <p class="end-result-text">${this.textMarkup(state.resultText, win ? '终战已毕。' : '失败不会抹去此行的选择。')}</p>
      <section class="end-seal ${win ? 'win' : 'loss'}">${sigil(win ? 'sun' : 'moon', win ? 'gold' : 'fire')}<b>${win ? '通关' : '退场'}</b></section>
      <div class="end-summary"><div><span>行过节点</span><b>${state.history.length}</b></div><div><span>修为</span><b>${formatNumber(state.xp)}</b></div><div><span>灵石</span><b>${formatNumber(state.coins)}</b></div><div><span>法宝</span><b>${artifacts.reduce((total, item) => total + asNumber(item.stacks, 1), 0)}</b></div></div>
      ${state.history.length ? `<details class="disclosure end-epilogue" data-details="end-epilogue"><summary>此行因缘</summary>${this.characterJourneyMarkup(state)}${this.storyEchoMarkup(state)}</details>` : ''}
      ${win ? this.winningEpitaphMarkup(state) : ''}
      ${result ? `<div class="stage-actions"><button class="button quiet" data-action="battle-details" data-tab="result" aria-label="查看最终斗法战果">${icon('eye', 16)}最终斗法战果</button></div>` : ''}<div class="stage-actions"><button class="button primary" data-action="export">${icon('arrow', 16)}导出命途记录</button><button class="button quiet" data-action="archives">查看通关构筑</button><button class="button quiet" data-action="new-run">重新起笔</button></div>${this.inlineMessage()}`;
  }

  private winningEpitaphMarkup(state: RunState): string {
    if (state.phase !== 'won') return '';
    const lines = buildVictoryEpitaph(state, id => this.byId(id));
    return `<section class="end-epitaph" aria-labelledby="end-epitaph-title"><p class="eyebrow">凡人逆潮 · 此局实录</p><h2 id="end-epitaph-title">破门纪传</h2>${lines.map(line => `<p class="end-epitaph-record">${esc(line)}</p>`).join('')}</section>`;
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
    if (this.modal === 'battle-details') return this.battleDetailsMarkup();
    if (this.modal === 'archives') {
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal dialog-wide" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">山海行 · 归档</p><h2 id="dialog-title">通关构筑</h2><p>这里保存每一局走到终点的功法、天赋与法宝。</p>${this.archiveMarkup()}<div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    const state = this.gameState();
    if (this.modal === 'elite-challenge-confirm') {
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow elite-challenge-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">精英邀战 · 风险确认</p><h2 id="dialog-title">邀战精英？</h2><p>当前普通战将升级为精英战。敌手更强，若落败仍会结束本次命途；胜利按精英战结算。路线与既定候选保持不变。</p><div class="dialog-actions"><button class="button quiet" data-action="modal-close" data-autofocus>再作准备</button><button class="button danger invite-elite" data-action="confirm-elite-challenge">${icon('skull', 16)}确认邀战</button></div></section></div>`;
    }
    if (this.modal === 'chapter' && state) {
      const act = this.currentAct();
      const story = isRecord(act.story) ? act.story : {};
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow chapter-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">${state.act === 5 ? '终局' : `第${state.act}幕`}</p><h2 id="dialog-title">${esc(asText(act.name))}</h2><p class="chapter-dialog-goal">${esc(asText(story.goal))}</p><p>${esc(asText(story.prelude))}</p><p>${esc(asText(story.ordinary_route))}</p><div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回山河</button></div></section></div>`;
    }
    if (this.modal === 'talent-tree' && state) {
      const methodIdValue = this.modalMethodId || state.method;
      const method = this.methodEntity(methodIdValue);
      if (!method) return '';
      const activeTalents = state.phase === 'talent' ? this.talentObjects() : [];
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal dialog-wide talent-tree-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">当前功法 · 天赋树</p><h2 id="dialog-title">${esc(asText(method.name, '当前功法'))}</h2><p class="talent-tree-summary">已悟 ${listOf<string>(state.talents?.[methodIdValue]).length} / 4 层</p>${this.talentTreeMarkup(methodIdValue, false, activeTalents)}<div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    if (this.modal === 'equipment-replace' && state) {
      const incoming = this.artifactEntity(this.pendingEquipmentId);
      if (!incoming) return '';
      const equippedIds = this.equipmentItems();
      const choices = equippedIds.map((id, index) => {
        const current = this.artifactEntity(id);
        if (!current) return '';
        const slot = this.equipmentSlotName(index);
        const hpDelta = this.maxHpDeltaLabel(this.replacementMaxHpDelta(incoming.id, id));
        return `<button type="button" class="equipment-replace-choice" data-action="equipment-confirm" data-id="${esc(incoming.id)}" data-replace="${esc(id)}" aria-label="${esc(`以${asText(incoming.name, '新法宝')}替换${asText(current.name, id)}，${slot}，${hpDelta}，当前气血不会回复`)}"><span class="equipment-replace-slot">${esc(slot)}</span><span class="equipment-replace-copy"><b>${esc(asText(current.name, id))}</b><small>离开装备位 · 收入背包 · ${esc(hpDelta)} · 当前气血不回补</small></span>${icon('arrow', 16)}</button>`;
      }).join('');
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal equipment-replace-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">装备替换 · 通用装备位</p><h2 id="dialog-title">替换装备</h2><p class="equipment-replace-incoming">装备 <b>${esc(asText(incoming.name, incoming.id))}</b>；当前气血不会回补。</p><div class="equipment-replace-list">${choices || '<p class="empty-note">当前没有可替换的装备。</p>'}</div><div class="dialog-actions"><button class="button quiet" data-action="equipment-replace-cancel" data-autofocus>暂不替换</button></div></section></div>`;
    }
    if (this.modal === 'talent-reset-confirm' && state) {
      const item = listOf<any>(state.shop).find((candidate) =>
        candidate.id === this.pendingTalentResetItemId && candidate.kind === 'talent_reset',
      );
      if (!item) return '';
      const method = this.methodEntity(state.method);
      const selected = listOf<string>(state.talents?.[state.method])
        .map((id) => this.talentEntity(state.method, id))
        .filter((talent): talent is Entity => Boolean(talent));
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow talent-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">坊市 · 洗髓丹</p><h2 id="dialog-title">重选已悟天赋？</h2><p>购买后会为当前功法重新开启天赋选择，不会清除其他功法的天赋。</p>${state.bloodVow ? '<p>断生之誓不会解除；不再选中断生入魔时，战斗增益也不再生效。</p>' : ''}<div class="talent-reset-summary"><span>当前功法</span><b>${esc(asText(method?.name, state.method))}</b><span>已悟天赋</span><b>${selected.map((talent) => esc(asText(talent.name, talent.id))).join('、') || '无'}</b><span>花费</span><b>${this.textMarkup(`${formatNumber(item.price)} 灵石`)}</b></div><div class="dialog-actions"><button class="button quiet" data-action="talent-reset-cancel" data-autofocus>取消</button><button class="button primary" data-action="confirm-talent-reset">购买并重选</button></div></section></div>`;
    }
    if (this.modal === 'settings') {
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow settings-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">静室</p><h2 id="dialog-title">设置</h2><div class="setting-row"><span>战报显示</span><button class="button small" data-action="battle-log-mode" aria-pressed="${this.detailedLog}">${this.detailedLog ? '详细' : '简明'}</button></div><div class="setting-row"><span>通关构筑</span><button class="button small" data-action="archives">${icon('book', 16)}查看归档</button></div><div class="setting-row"><span>命途存档</span><div class="row"><button class="button small" data-action="export" ${state ? '' : 'disabled'}>${icon('arrow', 16)}导出</button><button class="button small" data-action="restart" aria-label="重开">${icon('mirror', 16)}重开</button></div></div><details class="disclosure" data-details="chapter-progress"><summary>幕次行程</summary>${state ? this.chapterStrip(state) : ''}</details><div class="setting-row"><span>帮助</span><button class="button small" data-action="help">查看</button></div><div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    if (this.modal === 'character' && state) {
      const method = this.methodEntity(state.method);
      const selectedTalents = listOf<string>(state.talents?.[state.method]).map((id) => this.talentEntity(state.method, id)).filter((item): item is Entity => Boolean(item));
      const stats = this.stats();
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">人物</p><h2 id="dialog-title">${esc(state.name)}</h2><p>${esc(asText(method?.name, state.method))} · ${esc(this.realmName(state.n))}</p><div class="character-detail-art">${characterArt(state.method)}</div><div class="character-stats">${(['max_hp', 'attack', 'defense', 'crit_rate', 'speed'] as const).map((key) => `<div><span>${key === 'crit_rate' && state.permanentRule?.kind === 'blind_sword' ? '原暴击·转化' : STAT_LABEL[key]}</span><strong>${this.textMarkup(key === 'crit_rate' ? `${Math.round(asNumber(stats[key]) * 100)}%` : formatNumber(stats[key]))}</strong></div>`).join('')}</div><div class="character-detail"><p>气血 ${this.textMarkup(`${formatNumber(state.hp)} / ${formatNumber(stats.max_hp)}`)} · 修为 ${this.textMarkup(state.xp)} · 灵石 ${this.textMarkup(state.coins)}</p><p>已拥有功法：${state.ownedMethods.map((id) => esc(asText(this.methodEntity(id)?.name, id))).join('、') || '无'}</p><p>已选天赋：${selectedTalents.map((talent) => esc(asText(talent.name, talent.id))).join('、') || '无'}</p></div><div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
    }
    if (this.modal === 'artifact') {
      const artifact = this.artifactEntity(this.modalId);
      if (!artifact) return '';
      const inspectingEnemy = this.battleDetailsParent?.tab === 'enemy';
      const artifactStacks = inspectingEnemy
        ? loadoutArtifacts(state?.battleInput?.enemy || this.enemyLoadout(this.enemyEntity()))
        : listOf<ArtifactStack>(state?.artifacts);
      const owned = artifactStacks.find((item) => item.id === artifact.id);
      const maxStacks = Math.max(1, asNumber(artifact.max_stacks, 1));
      const ownership = `${inspectingEnemy ? '敌方叠层' : '当前叠层'} ${formatNumber(owned?.stacks || 0)} / ${formatNumber(maxStacks)}`;
      const fusionArtifact = Boolean(this.fusionRecipe(artifact));
      const hideUnownedFusionEffect = fusionArtifact && !owned;
      const stats = hideUnownedFusionEffect ? '' : this.artifactStatMarkup(artifact, 12);
      const effects = fusionArtifact && !owned ? [] : listOf<any>(artifact.effects)
        .map((effect) => this.textMarkup(effectText(effect, (value) => this.displayText(value))))
        .filter(Boolean);
      const awakeningMarkup = hideUnownedFusionEffect
        ? ''
        : this.artifactAwakeningMarkup(artifact, asNumber(owned?.stacks));
      const coreRuleMarkup = hideUnownedFusionEffect ? '' : this.coreRuleMarkup(artifact);
      const mirrorArtifact = isRecord(artifact.mirror_rule) && artifact.mirror_rule.kind === 'neighbor_awakening';
      const mirrorEquipment = inspectingEnemy
        ? loadoutArtifacts(state?.battleInput?.enemy || this.enemyLoadout(this.enemyEntity()))
        : this.equippedArtifacts();
      const mirrorIndex = mirrorEquipment.findIndex(stack => stack.id === artifact.id);
      const mirrorNeighbor = mirrorIndex >= 0 ? mirrorEquipment[mirrorIndex + 1] : undefined;
      const neighborEntity = mirrorNeighbor ? this.artifactEntity(mirrorNeighbor.id) : undefined;
      const mirrorStatus = !mirrorArtifact ? '' : mirrorIndex < 0 ? '装备后查看右侧镜映。'
        : !mirrorNeighbor ? '右侧没有装备法宝。'
          : `当前目标：${asText(neighborEntity?.name, mirrorNeighbor.id)}。其战斗输出触发时镜映；纯属性和静态规则不复制。`;
      const effectMarkup = hideUnownedFusionEffect
        ? ''
        : (fusionArtifact || mirrorArtifact) && effects.length === 0
          ? ''
          : `<div class="effect-list">${effects.map((effect) => `<p>${effect}</p>`).join('') || '<p class="muted">没有额外触发效果。</p>'}</div>`;
      const statsMarkup = hideUnownedFusionEffect
        ? ''
        : `<div class="attribute-list">${stats || '<span class="muted">无额外属性</span>'}</div>`;
      const summary = fusionArtifact && !owned
        ? '融合器物 · 配方与当前进度见下方。'
        : fusionArtifact || mirrorArtifact
          ? asText(artifact.description, entitySummary(artifact))
          : entitySummary(artifact);
      const equipped = this.equipmentSlotLabel(artifact.id);
      const inventoryLabel = inspectingEnemy
        ? '敌方装备'
        : owned
          ? equipped ? `已装备 · ${equipped}` : '背包中 · 未装备不生效'
          : '典藏记录 · 尚未取得';
      const growthMarkup = artifact.id === DEVOURING_ARTIFACT_ID && owned
        ? `<section class="artifact-growth-detail"><h3>吞噬成长</h3><p>${esc(this.artifactGrowthSummary(owned, Boolean(equipped)))}</p></section>`
        : '';
      const inscriptionMarkup = owned
        ? artifact.id === DEVOURING_ARTIFACT_ID
          ? `<section class="artifact-inscription-detail"><h3>${owned.inscription ? `古炉铭刻 · ${INSCRIPTION_COPY[owned.inscription].label}` : '古炉铭刻 · 尚未铭刻'}</h3><p>饕餮鼎没有主动战斗触发；${owned.inscription ? '此铭刻不会生效。' : '铭刻不会产生战斗效果。'}</p></section>`
          : `<section class="artifact-inscription-detail"><h3>${owned.inscription ? `古炉铭刻 · ${INSCRIPTION_COPY[owned.inscription].label}` : '古炉铭刻 · 尚未铭刻'}</h3><p>${owned.inscription ? INSCRIPTION_COPY[owned.inscription].effect : '此法宝尚无额外铭刻效果。'}</p></section>`
        : '';
      return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal narrow item-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><div class="item-dialog-head"><span class="item-dialog-motif">${this.artifactMarkup(artifact, sigil(this.artifactIcon(artifact), entityRarity(artifact) === 'legendary' ? 'mythic' : 'jade'))}</span><div><p class="eyebrow">${esc(rarityLabel(entityRarity(artifact)))} · 法宝 · ${this.textMarkup(ownership)}</p><h2 id="dialog-title">${esc(artifact.name)}</h2><small class="artifact-ownership">${esc(inventoryLabel)}</small></div></div><div class="item-dialog-art">${this.artifactMarkup(artifact, sigil(this.artifactIcon(artifact), entityRarity(artifact) === 'legendary' ? 'mythic' : 'jade'))}</div><p class="item-dialog-summary">${this.textMarkup(summary)}</p>${growthMarkup}${inscriptionMarkup}${mirrorStatus ? `<p class="mirror-target-status" role="status">${esc(mirrorStatus)}</p>` : ''}${this.fusionDetailMarkup(artifact, state, inspectingEnemy)}${coreRuleMarkup}${awakeningMarkup}${statsMarkup}${effectMarkup}${this.equipmentActionMarkup(artifact, Boolean(owned), inspectingEnemy)}<div class="dialog-actions"><button class="button primary" data-action="modal-close" data-autofocus>返回</button></div></section></div>`;
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
    const bodyMarkup = this.modal === 'restart'
      ? esc(this.restartDestination === 'start'
        ? '确认后将按当前选择开启新命途，替换本局存档与回放，通关构筑保留。'
        : '确认后将结束当前命途并返回开局，本局存档与回放会被清除，通关构筑保留。')
      : this.modal === 'corrupt-save'
        ? `${this.storageIssue ? this.textMarkup(this.storageIssue) : esc('自动存档无法通过校验。')} ${esc('你可以导出当前可见记录，或明确开始一局新的命途。')}`
        : this.error ? this.textMarkup(this.error) : esc('发生了一个未命名问题。');
    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="dialog modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button dialog-close modal-close" data-action="modal-close" aria-label="关闭">${icon('close', 18)}</button><p class="eyebrow">山海提示</p><h2 id="dialog-title">${esc(title)}</h2><p>${bodyMarkup}</p><div class="dialog-actions">${this.modal === 'restart' ? `<button class="button quiet" data-action="modal-close" data-autofocus>先不重来</button><button class="button danger" data-action="confirm-restart">确认重开</button>` : this.modal === 'corrupt-save' ? `<button class="button quiet" data-action="discard-save">清理损坏存档</button><button class="button primary" data-action="modal-close" data-autofocus>我知道了</button>` : `<button class="button primary" data-action="modal-close" data-autofocus>知道了</button>`}</div></section></div>`;
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

  private onChange(event: Event): void {
    const target = event.target as HTMLSelectElement | HTMLInputElement;
    if (!target) return;
    const state = this.gameState();
    if (!state) return;
    if (target.matches('[data-thunder-challenge]') && target instanceof HTMLInputElement) {
      this.send({ type: 'thunder_challenge', enabled: target.checked });
      return;
    }
    if (target.matches('[data-seek-family]')) {
      if (!REWARD_FAMILIES.includes(target.value as ArtifactRewardFamily)) return;
      this.rewardSearchFamily = target.value as ArtifactRewardFamily;
      const panel = target.closest<HTMLElement>('.reward-search-panel')?.parentElement;
      if (panel) {
        panel.innerHTML = this.rewardSearchPanelMarkup(state, this.rewardSearchFamily);
        panel.querySelector<HTMLSelectElement>('[data-seek-family]')?.focus({ preventScroll: true });
      }
    } else if (target.matches('[data-reforge-source]')) {
      this.reforgeSourceId = target.value;
      const panel = target.closest<HTMLElement>('.reforge-tool')?.querySelector<HTMLElement>('[data-reforge-targets]');
      if (panel) {
        panel.innerHTML = this.reforgeTargetsMarkup(state, target.value);
        target.focus({ preventScroll: true });
      }
    } else if (target.matches('[data-inscription-artifact]') || target.matches('[data-inscription-choice]')) {
      if (target.matches('[data-inscription-artifact]')) this.inscriptionArtifactId = target.value;
      if (target.matches('[data-inscription-choice]') && isArtifactInscription(target.value)) {
        this.inscriptionChoice = target.value;
      }
      const panel = target.closest<HTMLElement>('.inscription-tool')?.querySelector<HTMLElement>('[data-inscription-controls]');
      if (panel) {
        panel.innerHTML = this.inscriptionControlsMarkup(state);
        const selector = target.matches('[data-inscription-artifact]')
          ? '[data-inscription-artifact]'
          : '[data-inscription-choice]';
        panel.querySelector<HTMLSelectElement>(selector)?.focus({ preventScroll: true });
      }
    } else if (target.matches('[data-devour-target]')) {
      this.devourTargetId = target.value;
      const panel = target.closest<HTMLElement>('.cauldron-tool')?.querySelector<HTMLElement>('[data-devour-controls]');
      if (panel) {
        panel.innerHTML = this.devourControlsMarkup(state);
        panel.querySelector<HTMLSelectElement>('[data-devour-target]')?.focus({ preventScroll: true });
      }
    } else if (target.matches('[data-refine-source]')) {
      this.rewardRefineSourceId = target.value;
      const panel = target.closest<HTMLElement>('[data-refine-panel]');
      if (panel) {
        panel.innerHTML = this.rewardRefinePanelMarkup(state);
        panel.querySelector<HTMLSelectElement>('[data-refine-source]')?.focus({ preventScroll: true });
      }
    } else if (target.matches('[data-refine-target]')) {
      this.rewardRefineTargetId = target.value;
      const panel = target.closest<HTMLElement>('[data-refine-panel]');
      if (panel) {
        panel.innerHTML = this.rewardRefinePanelMarkup(state);
        panel.querySelector<HTMLSelectElement>('[data-refine-target]')?.focus({ preventScroll: true });
      }
    } else if (target.matches('[data-temper-artifact]')) {
      this.warmArtifactId = target.value;
      const panel = target.closest<HTMLElement>('.rest-temper')?.querySelector<HTMLElement>('[data-temper-panel]');
      if (panel) {
        panel.innerHTML = this.restTemperPanelMarkup(state);
        panel.querySelector<HTMLSelectElement>('[data-temper-artifact]')?.focus({ preventScroll: true });
      }
    }
  }

  private rememberModalTrigger(target: HTMLElement): void {
    if (this.modal && this.renderedModal) return;
    const selector = this.focusSelectorFor(target);
    if (selector) this.focusReturn = selector;
  }

  private rememberBattleDetailParent(target: HTMLElement): void {
    this.battleDetailsParent = {
      tab: this.battleDetailTab,
      focusSelector: this.focusSelectorFor(target),
    };
  }

  private dismissBattleDetails(): void {
    if (this.modal !== 'battle-details') return;
    this.modal = null;
    this.modalId = '';
    this.modalMethodId = '';
    this.battleDetailsParent = null;
    this.battleDetailReturnFocus = '';
  }

  private closeModal(): void {
    if (this.modal === 'equipment-replace') {
      this.pendingEquipmentId = '';
      this.modal = 'artifact';
      this.render();
      return;
    }
    if (this.talentTreeParent) {
      const parent = this.talentTreeParent;
      this.talentTreeParent = null;
      this.modal = 'talent-tree';
      this.modalId = '';
      this.modalMethodId = parent.methodId;
      this.talentTreeReturnFocus = parent.focusSelector;
      this.render();
      return;
    }
    if (this.battleDetailsParent) {
      const parent = this.battleDetailsParent;
      this.battleDetailsParent = null;
      this.modal = 'battle-details';
      this.modalId = '';
      this.modalMethodId = '';
      this.battleDetailTab = parent.tab;
      this.battleDetailReturnFocus = parent.focusSelector;
      this.render();
      return;
    }
    if (this.modal === 'talent-reset-confirm') this.pendingTalentResetItemId = '';
    this.modal = null;
    this.modalId = '';
    this.modalMethodId = '';
    this.battleDetailsParent = null;
    this.battleDetailReturnFocus = '';
    this.render();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const modal = this.root.querySelector<HTMLElement>('.modal[role="dialog"]');
    const activeTab = (event.target as HTMLElement | null)
      ?.closest<HTMLElement>('.battle-detail-tabs [role="tab"][data-action="battle-detail-tab"]');
    if (this.modal === 'battle-details' && activeTab &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = this.availableBattleDetailTabs();
      const currentIndex = tabs.indexOf(this.battleDetailTab);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      const next = tabs[nextIndex];
      if (next) {
        event.preventDefault();
        this.battleDetailTab = next;
        this.render();
        this.root.querySelector<HTMLElement>(
          `.battle-detail-tabs [data-tab="${next}"]`,
        )?.focus({ preventScroll: true });
      }
      return;
    }
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

  private requestEquipment(id: string): void {
    const state = this.gameState();
    if (!state || !this.game) return;
    if (!this.canChangeEquipment()) {
      this.notice = this.equipmentLockReason();
      this.render();
      return;
    }
    if (!state.artifacts.some((stack) => stack.id === id)) {
      this.notice = '尚未取得此法宝，不能装备。';
      this.render();
      return;
    }
    if (this.equipmentSlotLabel(id)) {
      this.notice = '此法宝已经装备。';
      this.render();
      return;
    }

    if (this.equipmentItems().length < MAX_EQUIPMENT_SLOTS) {
      this.modal = null;
      this.send({ type: 'equip', id });
      return;
    }

    this.pendingEquipmentId = id;
    this.modal = 'equipment-replace';
    this.render();
  }

  private confirmEquipment(id: string, replace: string): void {
    if (id !== this.pendingEquipmentId || !replace) {
      this.notice = '装备状态已变化，请重新选择。';
      this.pendingEquipmentId = '';
      this.modal = null;
      this.render();
      return;
    }
    if (!this.canChangeEquipment()) {
      this.notice = this.equipmentLockReason();
      this.pendingEquipmentId = '';
      this.modal = null;
      this.render();
      return;
    }
    this.pendingEquipmentId = '';
    this.modal = null;
    this.send({ type: 'equip', id, replace });
  }

  private onClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || target.hasAttribute('disabled')) return;
    const action = target.dataset.action;
    if (!action) return;
    if (this.modal && !target.closest('.modal') && action !== 'modal-backdrop') return;
    if (action === 'modal-backdrop' && event.target !== target) return;
    event.preventDefault();
    this.notice = '';
    switch (action) {
      case 'home':
        this.stopPlayback();
        this.view = 'journey';
        this.game = null;
        this.seed = '';
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
      case 'shuffle-name': {
        this.playerName = randomPlayerName(this.playerName.trim());
        const nameInput = this.root.querySelector<HTMLInputElement>('[name="player-name"]');
        if (nameInput) nameInput.value = this.playerName;
        break;
      }
      case 'start':
        this.createRun(target);
        break;
      case 'continue':
        if (this.game && ['event_result', 'transition'].includes(this.game.state.phase)) this.send({ type: 'continue' });
        else if (this.game) this.render();
        else this.restoreSave();
        break;
      case 'retire':
        if (window.confirm('结束这场僵持，并结束本局行旅？')) {
          this.dismissBattleDetails();
          this.stopPlayback();
          this.send({ type: 'retire' });
        }
        break;
      case 'restart':
        this.requestRestart('setup', target);
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
      case 'talent-tree':
        if (this.gameState()) {
          this.rememberModalTrigger(target);
          this.talentTreeReturnFocus = '';
          this.modal = 'talent-tree';
          this.modalId = '';
          this.modalMethodId = asText(this.gameState()?.method);
          this.render();
        }
        break;
      case 'inspect-artifact':
        if (this.modal === 'battle-details') this.rememberBattleDetailParent(target);
        else this.rememberModalTrigger(target);
        this.modal = 'artifact';
        this.modalId = asText(target.dataset.id);
        this.render();
        break;
      case 'inspect-talent':
        if (this.modal === 'battle-details') this.rememberBattleDetailParent(target);
        else if (this.modal === 'talent-tree') {
          this.talentTreeParent = {
            methodId: asText(target.dataset.method),
            focusSelector: this.focusSelectorFor(target),
          };
        } else this.rememberModalTrigger(target);
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
      case 'chapter':
        this.rememberModalTrigger(target);
        this.modal = 'chapter';
        this.modalId = '';
        this.render();
        break;
      case 'confirm-restart':
        this.confirmRestart();
        break;
      case 'discard-save':
        this.discardCorruptSave();
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
      case 'talent-reset-cancel':
        this.closeModal();
        break;
      case 'confirm-talent-reset':
        this.confirmTalentReset();
        break;
      case 'battle-details': {
        const requested = target.dataset.tab as BattleDetailTab;
        this.rememberModalTrigger(target);
        this.battleDetailsParent = null;
        this.battleDetailTab = this.availableBattleDetailTabs().includes(requested)
          ? requested
          : 'enemy';
        this.modal = 'battle-details';
        this.modalId = '';
        this.render();
        break;
      }
      case 'battle-detail-tab': {
        const requested = target.dataset.tab as BattleDetailTab;
        if (this.availableBattleDetailTabs().includes(requested)) {
          this.battleDetailTab = requested;
          this.render();
        }
        break;
      }
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
      case 'invite-elite':
        if (this.game?.canChallengeElite()) {
          this.rememberModalTrigger(target);
          this.modal = 'elite-challenge-confirm';
          this.render();
        } else {
          this.notice = '当前无法邀战精英。';
          this.render();
        }
        break;
      case 'confirm-elite-challenge':
        this.modal = null;
        if (!this.game?.canChallengeElite()) {
          this.notice = '邀战条件已变化，当前无法升级为精英战。';
          this.render();
          break;
        }
        this.send({ type: 'challenge_elite' });
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
        this.gameArt.cancelBattle();
        this.battleBeatElapsed = 0;
        this.battleCursor = Math.max(0, (this.battleResult()?.frames.length || 1) - 1);
        this.battleFinished = true;
        this.saveReplay();
        this.render();
        break;
      case 'battle-compare-artifact': {
        const state = this.gameState();
        const artifactId = this.root.querySelector<HTMLSelectElement>('[data-battle-comparison-artifact]')?.value || '';
        if (!state || state.phase !== 'battle' || !this.battleFinished || !state.battleInput || !this.content ||
          !loadoutArtifacts(state.battleInput.player).some(artifact => artifact.id === artifactId)) break;
        const key = this.battleIdentity(state);
        const input = structuredClone(state.battleInput);
        const content = this.content;
        this.battleComparison = { key, artifactId, loading: true };
        this.render();
        window.setTimeout(() => {
          if (this.gameState()?.phase !== 'battle' || this.battleIdentity() !== key) return;
          try {
            const result = compareArtifactRemoval(content, input, artifactId);
            this.battleComparison = { key, artifactId, loading: false, result };
          } catch {
            this.battleComparison = { key, artifactId, loading: false, error: '此场试演暂不可用，请查看战报。' };
          }
          this.render();
        }, 0);
        break;
      }
      case 'battle-finish':
        this.stopPlayback();
        this.dismissBattleDetails();
        this.send({ type: 'battle_done' });
        break;
      case 'continue-battle':
        this.dismissBattleDetails();
        this.send({ type: 'continue_battle' });
        break;
      case 'reward':
        this.send({ type: 'reward', id: target.dataset.id || null });
        break;
      case 'seek-reward': {
        const state = this.gameState();
        const family = asText(target.dataset.family) as ArtifactRewardFamily;
        if (!state || state.phase !== 'reward' || !REWARD_FAMILIES.includes(family)) {
          this.notice = '当前无法寻缘。';
          this.render();
          break;
        }
        const preview = this.rewardSearchPreview(family);
        const used = listOf<any>(state.rewardSearches).some((record) => record.act === state.act);
        if (!preview.available || !preview.candidates.length || used) {
          this.notice = this.rewardSearchReason(preview.reason) || '当前候选无法替换。';
          this.render();
          break;
        }
        if (asNumber(state.coins) < preview.cost) {
          this.notice = '灵石不足，无法支付寻缘代价。';
          this.render();
          break;
        }
        this.rewardSearchFamily = family;
        this.send({ type: 'seek_reward', family });
        break;
      }
      case 'refine-reward': {
        const state = this.gameState();
        const source = this.rewardRefineSourceId;
        const targetId = this.rewardRefineTargetId;
        const usage = state ? this.rewardRefineUsage(state) : undefined;
        const preview = this.rewardRefinePreview(source, targetId);
        if (!state || state.phase !== 'reward' || !usage || usage.remaining === 0 ||
          !preview.available || !source || !targetId) {
          this.notice = usage?.remaining === 0
            ? '本幕炼宝次数已用尽。'
            : this.rewardRefineReason(preview.reason) || '当前无法炼宝。';
          this.render();
          break;
        }
        this.send({ type: 'refine_reward', source, target: targetId });
        break;
      }
      case 'equipment-equip':
        this.requestEquipment(asText(target.dataset.id));
        break;
      case 'equipment-unequip':
        if (this.canChangeEquipment()) {
          this.send({ type: 'unequip', id: asText(target.dataset.id) });
        } else {
          this.notice = this.equipmentLockReason();
          this.render();
        }
        break;
      case 'equipment-reorder': {
        const id = asText(target.dataset.id);
        const direction = target.dataset.direction;
        if (direction !== 'left' && direction !== 'right') break;
        if (!this.canChangeEquipment()) {
          this.notice = this.equipmentLockReason();
          this.render();
          break;
        }
        const slots = this.equipmentItems();
        const index = slots.indexOf(id);
        const neighbor = index + (direction === 'left' ? -1 : 1);
        if (index < 0 || neighbor < 0 || neighbor >= slots.length) {
          this.notice = '装备状态已变化，请重新选择。';
          this.render();
          break;
        }
        this.send({ type: 'reorder_equipment', id, direction });
        break;
      }
      case 'equipment-confirm':
        this.confirmEquipment(asText(target.dataset.id), asText(target.dataset.replace));
        break;
      case 'equipment-replace-cancel':
        this.pendingEquipmentId = '';
        this.modal = 'artifact';
        this.render();
        break;
      case 'event':
        this.send({ type: 'event', id: asText(target.dataset.id) });
        break;
      case 'buy':
        {
          const id = asText(target.dataset.id);
          const item = this.gameState()?.shop.find((candidate) => candidate.id === id);
          if (item?.kind === 'talent_reset') {
            if (!listOf<string>(this.gameState()?.talents?.[this.gameState()?.method || '']).length) {
              this.notice = '当前功法尚无已悟天赋。';
              this.render();
              break;
            }
            this.rememberModalTrigger(target);
            this.pendingTalentResetItemId = id;
            this.modal = 'talent-reset-confirm';
            this.render();
            break;
          }
          this.send({ type: 'buy', id });
        }
        break;
      case 'reforge':
        {
          const state = this.gameState();
          const source = asText(target.dataset.source);
          const targetId = asText(target.dataset.target);
          const used = Boolean((state as any)?._shopReforged);
          const availability = this.reforgeAvailability(source, targetId);
          const reason = used ? '本店已重铸过一次' :
            !state || asNumber(state.coins) < this.reforgePrice() ? '灵石不足' :
              availability.available ? '' : this.reforgeReason(availability.reason);
          if (!state || state.phase !== 'shop' || !source || !targetId || reason) {
            this.notice = reason || '当前无法重铸。';
            this.render();
            break;
          }
          this.reforgeSourceId = '';
          this.send({ type: 'reforge', source, target: targetId });
        }
        break;
      case 'inscribe':
        {
          const artifact = asText(target.dataset.artifact);
          const inscription = target.dataset.inscription;
          const state = this.gameState();
          if (!state || state.phase !== 'shop' || !isArtifactInscription(inscription)) {
            this.notice = '坊市或铭刻选项已变化，请重新选择。';
            this.render();
            break;
          }
          const availability = this.inscriptionAvailability(artifact, inscription);
          if (!availability.available) {
            this.notice = this.inscriptionReason(availability.reason);
            this.render();
            break;
          }
          this.send({ type: 'inscribe', artifact, inscription });
        }
        break;
      case 'devour': {
        const id = asText(target.dataset.id);
        const state = this.gameState();
        if (!state || !this.game || !this.canChangeEquipment()) {
          this.notice = this.equipmentLockReason();
          this.render();
          break;
        }
        const availability = this.game.devourAvailability(id);
        if (!availability.available) {
          this.notice = availability.reason === 'growth-limit-reached'
            ? '饕餮鼎已达到卡面倍率上限。'
            : this.equipmentLockReason() || '吞噬目标已变化，请重新选择。';
          this.render();
          break;
        }
        this.send({ type: 'devour', id });
        break;
      }
      case 'leave-shop':
        this.send({ type: 'leave_shop' });
        break;
      case 'rest':
        if (target.dataset.choice === 'temper') {
          const state = this.gameState();
          const artifact = asText(target.dataset.artifact);
          const cost = this.warmCost();
          if (!state || state.phase !== 'rest' || !this.warmableArtifacts().includes(artifact)) {
            this.notice = '这件法宝目前无法温养。';
            this.render();
            break;
          }
          if (asNumber(state.coins) < cost) {
            this.notice = '灵石不足，温养没有执行。';
            this.render();
            break;
          }
          this.warmArtifactId = '';
          this.send({ type: 'rest', choice: 'temper', artifact });
          break;
        }
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
        this.requestRestart('setup', target);
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

  private confirmTalentReset(): void {
    const state = this.gameState();
    const item = state?.shop.find((candidate) =>
      candidate.id === this.pendingTalentResetItemId && candidate.kind === 'talent_reset',
    );
    const hasTalents = Boolean(state && listOf<string>(state.talents?.[state.method]).length);
    if (!state || state.phase !== 'shop' || !item || item.sold || !hasTalents ||
      asNumber(state.coins) < asNumber(item.price)) {
      this.pendingTalentResetItemId = '';
      this.modal = null;
      this.notice = !hasTalents ? '当前功法尚无已悟天赋。' : '洗髓丹已不可购买，灵石未扣除。';
      this.render();
      return;
    }

    const id = item.id;
    this.pendingTalentResetItemId = '';
    this.modal = null;
    this.modalId = '';
    this.send({ type: 'buy', id });
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
      format: 'suishi-shanhai-run-v2-overhaul',
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
