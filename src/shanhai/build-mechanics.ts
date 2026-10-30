import type { Content, JourneyContext, Loadout, Stats } from './types.js';

export type BuildKind =
  | 'wealth_damage'
  | 'hunter'
  | 'speed_damage'
  | 'carapace'
  | 'spending_power'
  | 'collection_damage'
  | 'blood_vow'
  | 'bounty'
  | 'shop_discount'
  | 'basic_split'
  | 'hit_rage'
  | 'rage_echo'
  | 'veteran_shield'
  | 'wealth_shield'
  | 'trophy_damage';

export interface BuildMechanic {
  id: string;
  name: string;
  kind: BuildKind;
  params: Record<string, number | string>;
}

const BUILD_FIELDS: Record<BuildKind, string[]> = {
  wealth_damage: ['scale', 'half_saturation'],
  hunter: ['base_attack', 'base_defense', 'elite_attack', 'elite_defense', 'boss_attack', 'boss_defense'],
  speed_damage: ['speed_bonus', 'max_multiplier'],
  carapace: ['defense_per_hit', 'reflect_ratio'],
  spending_power: ['base_attack', 'attack_per_coin'],
  collection_damage: ['base_bonus', 'per_kind'],
  blood_vow: ['healing_multiplier', 'damage_multiplier'],
  bounty: ['attack_bonus', 'normal_coins', 'elite_coins', 'boss_coins'],
  shop_discount: ['ratio'],
  basic_split: ['extra_segments', 'segment_ratio'],
  hit_rage: ['amount'],
  rage_echo: ['ratio'],
  veteran_shield: ['base_ratio', 'elite_ratio', 'boss_ratio'],
  wealth_shield: ['base_shield', 'shield_per_coin'],
  trophy_damage: ['base_bonus', 'elite_bonus', 'boss_bonus'],
};

const BUILD_NAMES: Record<BuildKind, string> = {
  wealth_damage: '财能通神',
  hunter: '破军战骨',
  speed_damage: '动若脱兔',
  carapace: '猬甲护身',
  spending_power: '挥金如土',
  collection_damage: '万宝朝宗',
  blood_vow: '断生入魔',
  bounty: '战利生财',
  shop_discount: '市井仙缘',
  basic_split: '剑丸成阵',
  hit_rage: '战意不息',
  rage_echo: '身外化身',
  veteran_shield: '百战护体',
  wealth_shield: '锦衣护道',
  trophy_damage: '百战封侯',
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function journeyFacts(loadout: Loadout): JourneyContext {
  if (loadout.journey === undefined) {
    return { coins: 0, coinsSpent: 0, eliteWins: 0, bossWins: 0, artifactKinds: 0, knownMethods: 0 };
  }
  const facts = loadout.journey as unknown;
  if (!isObject(facts)) throw new Error('Invalid loadout journey context');
  for (const key of ['coins', 'coinsSpent', 'eliteWins', 'bossWins', 'artifactKinds', 'knownMethods']) {
    if (!finite(facts[key]) || facts[key] < 0) throw new Error(`Invalid journey context ${key}`);
  }
  for (const key of ['eliteWins', 'bossWins', 'artifactKinds', 'knownMethods']) {
    if (!Number.isInteger(facts[key])) throw new Error(`Invalid journey context ${key}`);
  }
  return facts as JourneyContext;
}

export function selectedBuildMechanics(content: Content, loadout: Loadout): BuildMechanic[] {
  const facts = journeyFacts(loadout);
  void facts;
  const insights = content.rules.insights;
  const shared = Array.isArray(insights)
    ? insights
    : isObject(insights) ? Object.values(insights) : [];
  const byId = new Map(shared.filter((item: any) => item && typeof item.id === 'string')
    .map((item: any) => [item.id, item]));
  const selected: BuildMechanic[] = [];
  for (const id of loadout.talents) {
    const talent = byId.get(id) as Record<string, any> | undefined;
    if (!talent || !Array.isArray(talent.effects)) continue;
    for (const effect of talent.effects) {
      const params = effect?.params;
      if (!isObject(params) || params.build === undefined) continue;
      if (effect.trigger !== 'always' || effect.operation !== 'modify_effect' ||
          effect.target !== 'self' || !Array.isArray(effect.requires) ||
          effect.requires.length !== 0 || !Array.isArray(effect.consumes) ||
          effect.consumes.length !== 0 || !Array.isArray(effect.replaces) ||
          effect.replaces.length !== 0) {
        throw new Error(`Invalid build mechanic effect (${effect.id ?? id})`);
      }
      const kind = params.build as BuildKind;
      const fields = BUILD_FIELDS[kind];
      if (!fields) throw new Error(`Unsupported build mechanic ${String(params.build)} (${id})`);
      if (!effect.limit || effect.limit.scope !== 'permanent' || effect.limit.count !== 1) {
        throw new Error(`Invalid build mechanic limit (${effect.id ?? id})`);
      }
      for (const key of Object.keys(params)) {
        if (key !== 'build' && !fields.includes(key)) {
          throw new Error(`Unsupported build mechanic parameter ${key} (${id})`);
        }
      }
      for (const field of fields) {
        if (!finite(params[field]) || params[field] < 0) {
          throw new Error(`Invalid build mechanic parameter ${field} (${id})`);
        }
      }
      if (kind === 'basic_split' &&
          (!Number.isInteger(params.extra_segments) || params.extra_segments < 1 ||
           params.segment_ratio > 1)) {
        throw new Error(`Invalid build mechanic parameter extra_segments (${id})`);
      }
      if (kind === 'speed_damage' && params.max_multiplier < 1) {
        throw new Error(`Invalid build mechanic parameter max_multiplier (${id})`);
      }
      if (kind === 'shop_discount' && params.ratio > 1) {
        throw new Error(`Invalid build mechanic parameter ratio (${id})`);
      }
      if (kind === 'hit_rage' && params.amount <= 0) {
        throw new Error(`Invalid build mechanic parameter amount (${id})`);
      }
      if (kind === 'rage_echo' && (params.ratio <= 0 || params.ratio > 1)) {
        throw new Error(`Invalid build mechanic parameter ratio (${id})`);
      }
      if (kind === 'wealth_damage' && params.scale > 0 && params.half_saturation === 0) {
        throw new Error(`Invalid build mechanic parameter half_saturation (${id})`);
      }
      if (kind === 'blood_vow' &&
          (params.healing_multiplier !== 1.5 || params.damage_multiplier !== 1.35)) {
        throw new Error(`Invalid build mechanic parameters for blood_vow (${id})`);
      }
      if (kind === 'veteran_shield' &&
          params.base_ratio + params.elite_ratio + params.boss_ratio > 1) {
        throw new Error(`Invalid build mechanic shield ratios (${id})`);
      }
      selected.push({
        id,
        name: typeof talent.name === 'string' ? talent.name : BUILD_NAMES[kind],
        kind,
        params: params as Record<string, number | string>,
      });
    }
  }
  return selected;
}

export function staticBuildStats(
  content: Content,
  loadout: Loadout,
): Partial<Stats> {
  const result: Partial<Stats> = {};
  const journey = journeyFacts(loadout);
  for (const mechanic of selectedBuildMechanics(content, loadout)) {
    const p = mechanic.params;
    const add = (stat: keyof Stats, amount: number) => {
      result[stat] = (result[stat] ?? 0) + amount;
    };
    if (mechanic.kind === 'hunter') {
      add('attack', (p.base_attack as number) +
        journey.eliteWins * (p.elite_attack as number) +
        journey.bossWins * (p.boss_attack as number));
      add('defense', (p.base_defense as number) +
        journey.eliteWins * (p.elite_defense as number) +
        journey.bossWins * (p.boss_defense as number));
    } else if (mechanic.kind === 'spending_power') {
      add('attack', (p.base_attack as number) + journey.coinsSpent * (p.attack_per_coin as number));
    } else if (mechanic.kind === 'speed_damage') {
      add('speed', p.speed_bonus as number);
    } else if (mechanic.kind === 'bounty') {
      add('attack', p.attack_bonus as number);
    }
  }
  return result;
}

function multiplierText(value: number): string {
  return `×${value.toFixed(2)}`;
}

function amountText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function buildMechanicViews(
  content: Content,
  loadout: Loadout,
  stats: Stats,
): { id: string; name: string; summary: string }[] {
  const facts = journeyFacts(loadout);
  const maxHp = stats.max_hp;
  return selectedBuildMechanics(content, loadout).map(mechanic => {
    const p = mechanic.params;
    let summary = '';
    switch (mechanic.kind) {
      case 'wealth_damage': {
        const denominator = facts.coins + (p.half_saturation as number);
        const multiplier = denominator > 0
          ? 1 + (p.scale as number) * facts.coins / denominator
          : 1;
        summary = `现有灵石 ${amountText(facts.coins)}，直伤/衍生倍率 ${multiplierText(multiplier)}`;
        break;
      }
      case 'hunter':
        summary = `基础攻击 +${p.base_attack}、防御 +${p.base_defense}；精英胜 ${facts.eliteWins} 次再增攻击 +${facts.eliteWins * (p.elite_attack as number)}、防御 +${facts.eliteWins * (p.elite_defense as number)}；首领胜 ${facts.bossWins} 次再增攻击 +${facts.bossWins * (p.boss_attack as number)}、防御 +${facts.bossWins * (p.boss_defense as number)}；解锁邀战精英`;
        break;
      case 'speed_damage':
        summary = `速度 +${p.speed_bonus}，伤害倍率最高 ${multiplierText(p.max_multiplier as number)}`;
        break;
      case 'carapace':
        summary = `每次承受有效直接段后防御 +${p.defense_per_hit}，按当前防御反击 ${((p.reflect_ratio as number) * 100).toFixed(0)}%`;
        break;
      case 'spending_power':
        summary = `累计消费 ${amountText(facts.coinsSpent)}，攻击 +${amountText((p.base_attack as number) + facts.coinsSpent * (p.attack_per_coin as number))}`;
        break;
      case 'collection_damage':
        summary = `持有 ${facts.artifactKinds} 类法宝，直伤/衍生倍率 ${multiplierText(1 + (p.base_bonus as number) + facts.artifactKinds * (p.per_kind as number))}`;
        break;
      case 'blood_vow':
        summary = `战外不可恢复气血；战斗内治疗 ${multiplierText(p.healing_multiplier as number)}、直伤/衍生伤害 ${multiplierText(p.damage_multiplier as number)}，不增强持续伤害与反伤`;
        break;
      case 'bounty':
        summary = `精英胜 ${facts.eliteWins}、首领胜 ${facts.bossWins}；攻击 +${p.attack_bonus}，胜利实结 ${p.normal_coins}/${p.elite_coins}/${p.boss_coins} 灵石（普/精/首领）`;
        break;
      case 'shop_discount':
        summary = `后续商店报价按 ${(p.ratio as number) * 100}% 计算，最低 1 灵石`;
        break;
      case 'basic_split':
        summary = `普攻额外 ${p.extra_segments} 段，每段为原基础段的 ${(p.segment_ratio as number) * 100}%`;
        break;
      case 'hit_rage':
        summary = `每次有效直接或衍生命中积累 ${p.amount} 怒气，轮尾结算`;
        break;
      case 'rage_echo':
        summary = `怒技本体以 ${(p.ratio as number) * 100}% 威力重演，不重复付怒或获得行动回怒`;
        break;
      case 'veteran_shield':
        summary = `当前战绩提供基础开场护盾 ${amountText(maxHp * ((p.base_ratio as number) + facts.eliteWins * (p.elite_ratio as number) + facts.bossWins * (p.boss_ratio as number)))}`;
        break;
      case 'wealth_shield':
        summary = `现有灵石 ${amountText(facts.coins)}，基础开场护盾 ${amountText((p.base_shield as number) + facts.coins * (p.shield_per_coin as number))}`;
        break;
      case 'trophy_damage': {
        const multiplier = 1 + (p.base_bonus as number) +
          facts.eliteWins * (p.elite_bonus as number) +
          facts.bossWins * (p.boss_bonus as number);
        summary = `精英胜 ${facts.eliteWins}、首领胜 ${facts.bossWins}，直伤/衍生倍率 ${multiplierText(multiplier)}`;
        break;
      }
    }
    return { id: mechanic.id, name: mechanic.name, summary };
  });
}
