const STATUS_LABELS: Record<string, string> = {
  poison: '中毒',
  burn: '燃烧',
  weakness: '虚弱',
  armor_break: '破甲',
  sword_intent: '剑意',
  charge_luck: '蓄势',
  day_night: '昼夜',
};

const TEXT_LABELS: Record<string, string> = {
  player: '我方',
  players: '我方',
  enemy: '敌方',
  enemies: '敌方',
  damage: '伤害',
  direct: '直接伤害',
  derived: '派生伤害',
  dot: '持续伤害',
  critical: '暴击',
  crit: '暴击',
  shield: '护盾',
  rage: '怒气',
  heal: '治疗',
  healing: '治疗',
  attack: '攻击',
  defense: '防御',
  speed: '速度',
  hp: '气血',
  max_hp: '气血',
  crit_rate: '暴击率',
  xp: '修为',
  coins: '灵石',
  recovery: '恢复',
  weakness: '虚弱',
  armor_break: '破甲',
  poison: '中毒',
  burn: '燃烧',
  charge_luck: '蓄势',
  sword_intent: '剑意',
  day_night: '昼夜',
  buff: '增益',
  debuff: '减益',
  phase: '昼夜变化',
  normal: '普通',
  elite: '精英',
  boss: '首领',
  final: '终局',
  common: '普通',
  rare: '稀有',
  legendary: '传奇',
  tier: '层',
  branch: '分支',
  json: '记录文件',
  modify_stat: '属性变化',
  apply_status: '施加状态',
  consume_status: '消耗状态',
  gain_rage: '获得怒气',
  lose_rage: '失去怒气',
  first_strike: '先手',
  damage_reduction: '减伤',
  damage_bonus: '伤害提升',
  critical_hit: '暴击命中',
  action_end: '动作结束',
  round_end: '回合结束',
  battle_start: '战斗开始',
  multihit: '多段',
  multi_segment: '多段',
  rage_drain: '削怒',
  stacking: '叠层',
  reflect: '反震',
  lightning: '雷击',
  water: '水系',
  sun: '日光',
  myth_adaptation: '神话化形',
  tick: '结算',
  ticks: '结算',
  build: '构筑',
};

const SOURCE_LABELS: Record<string, string> = {
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

const TOKENS = Object.keys(TEXT_LABELS).sort((left, right) => right.length - left.length);
// Status names can be directly followed by stack counts, such as "burn2层".
const TOKEN_PATTERN = new RegExp(`(?<![A-Za-z_])(${TOKENS.join('|')})(?![A-Za-z_])`, 'gi');
const EMBEDDED_SOURCE_PATTERN = /\b(RKF\d{2}(?:-[A-Z0-9_-]+)?|(?:RC|RR|RL)\d{2}(?:-[A-Z0-9_-]+)?|J\d-[A-C]|RULES-[A-Z0-9_-]+)\b/gi;

function genericSourceLabel(source: string): string {
  if (/^RKF\d{2}-J\d-[A-C]$/i.test(source)) return '功法天赋';
  if (/^RKF\d{2}-/i.test(source)) return '功法招式';
  if (/^(RC|RR|RL)\d{2}-/i.test(source)) return '法宝效果';
  if (/^RKF\d{2}$/i.test(source)) return '功法';
  if (/^(RC|RR|RL)\d{2}$/i.test(source)) return '法宝';
  if (/^J\d-[A-C]$/i.test(source)) return '天赋';
  if (/^RULES-/i.test(source)) return '斗法规则';
  return '战斗效果';
}

export function localizeVisibleText(
  value: unknown,
  resolveSource?: (source: string) => string | undefined,
): string {
  if (typeof value !== 'string') return typeof value === 'number' ? String(value) : '';
  return value
    .replace(/\bSHOP-A\d+-[A-Za-z0-9-]+\b/g, '云游坊市')
    .replace(/\bR-A\d+-[A-Za-z0-9-]+\b/g, '山中一息')
    .replace(EMBEDDED_SOURCE_PATTERN, (source) => resolveSource?.(source) || genericSourceLabel(source))
    .replace(/\bR(\d+)\b/g, (_match, round) => `第${round}回合`)
    .replace(TOKEN_PATTERN, (token) => TEXT_LABELS[token.toLowerCase()] || token);
}

export function localizeBattleText(value: unknown): string {
  return localizeVisibleText(value)
    .replaceAll('玩家', '我方')
    .replaceAll('敌人', '敌方');
}

export function localizeStatus(status: unknown): string {
  const key = typeof status === 'string' ? status.toLowerCase() : '';
  return STATUS_LABELS[key] || '战斗状态';
}

export function localizeTier(value: unknown): string {
  const key = typeof value === 'string' ? value.toLowerCase() : '';
  return TEXT_LABELS[key] || '普通';
}

export function localizeBranch(value: unknown): string {
  if (value === 'A') return '甲';
  if (value === 'B') return '乙';
  if (value === 'C') return '丙';
  return '自选';
}

export function localizeSourceId(value: unknown): string {
  const source = typeof value === 'string' ? value : '';
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  const embedded = source.match(EMBEDDED_SOURCE_PATTERN)?.[0];
  if (embedded) return genericSourceLabel(embedded);
  const localized = localizeVisibleText(source);
  if (localized !== source) return localized;
  if (/^[A-Z0-9]+(?:-[A-Z0-9_]+)*$/i.test(source)) return '战斗效果';
  return localized;
}

export function localizeReason(value: unknown): string {
  if (typeof value !== 'string' || !value) return '本局未满足触发条件';
  const reasons: Record<string, string> = {
    'conditional trigger absent': '本局未满足触发条件',
    'permanent attributes applied': '属性已生效',
    'permanent attributes applied; conditional effect not triggered': '属性已生效；条件效果未触发',
    'passive modifier not used': '被动修正本局未用到',
  };
  if (reasons[value]) return reasons[value];
  return /[A-Za-z]/.test(value) ? '本局未满足触发条件' : localizeVisibleText(value);
}

export function localizeError(value: unknown, fallback = '此处暂时无法展开，请重试。'): string {
  if (typeof value !== 'string' || !value) return fallback;
  return /[A-Za-z]/.test(value) ? fallback : localizeVisibleText(value);
}
