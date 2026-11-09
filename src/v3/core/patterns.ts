/**
 * 役 —— 以符成役（不看出牌顺序）。
 * 把符看成牌：元素＝花色，点数＝牌面。六路各取最高的一个役，不同路的番相加，番数就是倍率。
 * 灵符同时算作每一种元素、幻符同时算作每一个点数（只用于同元、同数、破敌、三花聚顶）；
 * 五行俱全、连珠、洛书里它们只顶一张。
 *   同元（同花）· 同数（对子/刻子）· 连珠（顺子）· 五行（各不同色）· 破敌（克制当前敌人）· 洛书（凑点数）
 * 另计：河图得位（宝牌，每张 +1 番）；天成（役满，固定大倍率，不再相加）。
 * 每个役（含得位、宝符与心法）每番另带 QI_PER_FAN 气。
 */
import { counterOf, ELEMENTS, type El } from './elements.js';
import type { ComboId, PatternId, Tile, YakuId } from './types.js';

/** 每番另带的气。 */
export const QI_PER_FAN = 10;

/** 一路（可升重的心法）。 */
export interface PatternDef { id: PatternId; name: string; alias: string; hint: string; short: string }
export const PATTERNS: Record<PatternId, PatternDef> = {
  yuan: { id: 'yuan', name: '同元', alias: '同花', hint: '同一元素的符凑在一起：双元、两仪、三才、满堂、四象、五雷', short: '同元素凑组' },
  shu: { id: 'shu', name: '同数', alias: '对子', hint: '同一点数的符凑在一起：成双、成双成对、三清、紫金葫芦、四御', short: '同点数凑组' },
  lian: { id: 'lian', name: '连珠', alias: '顺子', hint: '点数连号：三连珠、四连珠、五连珠，正好 1–5 为一气化龙', short: '点数连号' },
  wuxing: { id: 'wuxing', name: '五行', alias: '杂色', hint: '元素各不相同：三花聚顶（三种元素同点数）、五行俱全（五种元素齐）', short: '元素各不相同' },
  podi: { id: 'podi', name: '破敌', alias: '克制', hint: '带克制当前敌人的符：两张破绽、三张破阵、四张以上破军', short: '带克制敌人的符' },
  luoshu: { id: 'luoshu', name: '洛书', alias: '凑数', hint: '只出两张、和为 10（十全）；只出三张、和为 15（洛书，九宫每行之和）', short: '两张凑十、三张凑十五' },
};
export const PATTERN_ORDER: PatternId[] = ['yuan', 'shu', 'lian', 'wuxing', 'podi', 'luoshu'];

/** 心法 n 重：这一路成役时 +(n−1) 番。 */
export const patternValue = (_id: PatternId, level: number) => ({ fan: Math.max(0, level - 1) });

export interface YakuDef { id: YakuId; path: PatternId | 'tian' | 'ben'; name: string; alias: string; fan: number; desc: string; method?: string }
const Y = (id: YakuId, path: YakuDef['path'], name: string, alias: string, fan: number, desc: string, method?: string): YakuDef => ({ id, path, name, alias, fan, desc, ...(method ? { method } : {}) });
export const YAKU: Record<YakuId, YakuDef> = {
  shuangyuan: Y('shuangyuan', 'yuan', '双元', '两张同花', 1, '两张同元素'),
  liangyi: Y('liangyi', 'yuan', '两仪', '两组同花', 2, '两组各两张同元素'),
  sancai: Y('sancai', 'yuan', '三才', '三同花', 2, '三张同元素'),
  mantang: Y('mantang', 'yuan', '满堂', '同花葫芦', 4, '三张同元素＋两张另一元素'),
  sixiang: Y('sixiang', 'yuan', '四象', '四同花', 5, '四张同元素'),
  sancai2: Y('sancai2', 'yuan', '三才并立', '两组三同花', 5, '两种元素各凑成三张（要靠灵符同时算两边）'),
  sixiang2: Y('sixiang2', 'yuan', '四象双生', '两组四同花', 7, '两种元素各凑成四张（要靠灵符同时算两边）'),
  wulei: Y('wulei', 'yuan', '五雷', '清一色', 8, '五张同元素'),
  chengshuang: Y('chengshuang', 'shu', '成双', '对子', 1, '两张同点数'),
  shuangdui: Y('shuangdui', 'shu', '成双成对', '两对', 2, '两组各两张同点数'),
  sanqing: Y('sanqing', 'shu', '三清', '三条', 3, '三张同点数'),
  hulu: Y('hulu', 'shu', '紫金葫芦', '葫芦', 5, '三张同点数＋两张另一点数'),
  siyu: Y('siyu', 'shu', '四御', '四条', 6, '四张以上同点数'),
  sanqing2: Y('sanqing2', 'shu', '三清同辉', '两组三条', 6, '两个点数各凑成三张（要靠幻符同时算两边）'),
  siyu2: Y('siyu2', 'shu', '四御并尊', '两组四条', 9, '两个点数各凑成四张（要靠幻符同时算两边）'),
  lian3: Y('lian3', 'lian', '三连珠', '三连顺', 2, '三个连号点数'),
  lian4: Y('lian4', 'lian', '四连珠', '四连顺', 3, '四个连号点数'),
  lian5: Y('lian5', 'lian', '五连珠', '顺子', 5, '五个连号点数'),
  hualong: Y('hualong', 'lian', '一气化龙', '一条龙', 6, '点数正好 1、2、3、4、5'),
  sanhua: Y('sanhua', 'wuxing', '三花聚顶', '三色同点', 2, '三种元素各一张同点数，如 金1 木1 水1'),
  wuxing: Y('wuxing', 'wuxing', '五行俱全', '五门齐', 4, '五种元素各一张'),
  pozhan: Y('pozhan', 'podi', '破绽', '两张克制', 1, '两张克制当前敌人的符'),
  pozhen: Y('pozhen', 'podi', '破阵', '三张克制', 3, '三张克制当前敌人的符'),
  pojun: Y('pojun', 'podi', '破军', '四张克制', 5, '四张以上克制当前敌人的符'),
  shiquan: Y('shiquan', 'luoshu', '十全', '凑十', 1, '只出两张，点数和为 10'),
  luoshu: Y('luoshu', 'luoshu', '洛书', '凑十五', 3, '只出三张，点数和为 15（洛书九宫每行之和）'),
  jiutian: Y('jiutian', 'tian', '九天雷动', '同花顺', 30, '天成：五张同元素且点数连号'),
  shengsheng: Y('shengsheng', 'tian', '生生不息', '天和', 40, '天成：木1 火2 土3 金4 水5'),
  wuqi: Y('wuqi', 'tian', '五气朝元', '五色同刻', 30, '天成：五种元素各一张，点数相同'),
  // 本门役：每门功法自己的一路，看的是战况而不只是牌面；同样只算最高的一个，不受心法加成。
  jianzhen: Y('jianzhen', 'ben', '剑阵', '本门', 1, '本招有两张以上金符，且已有 5 柄以上飞剑', 'yangjian'),
  wanjian: Y('wanjian', 'ben', '万剑朝宗', '本门', 3, '本招有三张以上金符，且已有 10 柄以上飞剑', 'yangjian'),
  liaoyuan: Y('liaoyuan', 'ben', '燎原', '本门', 4, '本招带火符，且敌人的灼烧已达其当前气血的 5%', 'yuhuo'),
  fenyuan: Y('fenyuan', 'ben', '焚原', '本门', 8, '本招带火符，且敌人的灼烧已达其当前气血的 20%', 'yuhuo'),
  jinshen: Y('jinshen', 'ben', '金身', '本门', 3, '出招时护盾已达气血上限的 25%', 'jingang'),
  buhuai: Y('buhuai', 'ben', '金刚不坏', '本门', 6, '出招时护盾已达气血上限的 60%：护盾每有上限的 10% 算 1 番（6–10 番；不动明王至多 15）', 'jingang'),
  leiming: Y('leiming', 'ben', '雷鸣', '本门', 3, '本招带倍符或雷引符', 'benlei'),
  lianlei: Y('lianlei', 'ben', '连雷', '本门', 6, '开怒技出招，且本场已经开过怒技', 'benlei'),
  chunman: Y('chunman', 'ben', '春满', '本门', 1, '满血时出招', 'huichun'),
  wanmu: Y('wanmu', 'ben', '万木回春', '本门', 3, '出招时春华已达气血上限的一半', 'huichun'),
  zhouye: Y('zhouye', 'ben', '昼夜交辉', '本门', 6, '本招同时带昼元素（金、火）和夜元素（水、木）；烛阴符两边都算', 'zhulong'),
  riyue: Y('riyue', 'ben', '日月同天', '本门', 8, '本招昼元素、夜元素各两张以上', 'zhulong'),
};
export const YAKU_ORDER = Object.keys(YAKU) as YakuId[];

/** 河图数：天一生水、地二生火、天三生木、地四生金、天五生土（加五亦同）。 */
export const HETU: Record<El, number> = { shui: 1, huo: 2, mu: 3, jin: 4, tu: 5 };
export const isDewei = (el: El | null, v: number) => !!el && v > 0 && ((v - 1) % 5) + 1 === HETU[el];

export interface YakuHit { id: YakuId; fan: number }
export interface Analysis {
  els: (El | null)[];
  /** 牌面点数（幻符已取定的点数；浊符为 0）。 */
  vals: number[];
  /** Same-element groups of two or more, largest first. */
  sets: { el: El; size: number }[];
  distinct: number;
  /** 每路最高的役（未加心法）。 */
  yaku: YakuHit[];
  /** 天成（役满），有则倍率固定。 */
  tian: YakuHit | null;
  /** 得位张数。 */
  dewei: number;
  /** 标题：天成或番数最高的役，没有为 'san'（散牌）。 */
  combo: ComboId;
}

function best<T extends YakuId>(...cands: [boolean, T][]): T | null {
  for (const [ok, id] of cands) if (ok) return id;
  return null;
}

/** Which tiles are wild: 灵 counts as every element at once, 幻 as every value at once (for the set-type 路). */
export interface Wilds { ling?: boolean[]; huan?: boolean[]; /** 慧眼：点数与河图数差 1 也算得位。 */ loose?: boolean }

/** Counts per key where every wild joins every group that already exists (or forms one group on its own). */
function wildCounts<K>(keys: (K | null)[], wild: boolean[]): number[] {
  const count = new Map<K, number>();
  let w = 0;
  keys.forEach((k, i) => { if (wild[i]) w += 1; else if (k !== null) count.set(k, (count.get(k) ?? 0) + 1); });
  const sizes = count.size ? [...count.values()].map(n => n + w) : w ? [w] : [];
  return sizes.filter(n => n >= 2).sort((a, b) => b - a);
}

export function analyze(els: (El | null)[], vals: number[], enemyEl: El | null = null, wilds: Wilds = {}): Analysis {
  const ling = els.map((_, i) => !!wilds.ling?.[i]);
  const huan = els.map((_, i) => !!wilds.huan?.[i]);
  // 同元：灵符同时算作每一种元素（火 火 木 木 灵 → 火3 木3）。
  const natural = new Map<El, number>();
  els.forEach((el, i) => { if (el && !ling[i]) natural.set(el, (natural.get(el) ?? 0) + 1); });
  const lingN = ling.filter(Boolean).length;
  const setEls = natural.size ? [...natural.entries()] : lingN ? [[els.find((e, i) => ling[i] && e) as El, 0] as [El, number]] : [];
  const sets = setEls.map(([el, n]) => ({ el, size: n + lingN })).filter(x => x.size >= 2).sort((a, b) => b.size - a.size);
  const s = sets.map(x => x.size);
  // 同数：幻符同时算作每一个点数。
  const ranked = vals.filter(v => v > 0);
  const ks = wildCounts(vals.map((v, i) => (v > 0 ? v : null)), huan.map((h, i) => h && vals[i] > 0));
  // 五行俱全：每张灵符只补一种缺的元素。
  const distinct = Math.min(5, natural.size + lingN);
  const total = ranked.reduce((a, b) => a + b, 0);

  // 连珠：最长连号（幻符只取一个点数，由读法枚举决定）。
  const uniq = [...new Set(ranked)].sort((a, b) => a - b);
  let run = 0, longest = 0;
  uniq.forEach((v, i) => { run = i > 0 && v === uniq[i - 1] + 1 ? run + 1 : 1; longest = Math.max(longest, run); });
  const isDragon = ranked.length === 5 && uniq.length === 5 && uniq[0] === 1 && uniq[4] === 5;

  // 三花聚顶：同一点数下有三种以上不同元素（灵符各补一种）。
  const colorsByValue = new Map<number, { els: Set<El>; wild: number }>();
  els.forEach((el, i) => {
    if (vals[i] <= 0 || (!el && !ling[i])) return;
    const slot = colorsByValue.get(vals[i]) ?? { els: new Set<El>(), wild: 0 };
    if (ling[i]) slot.wild += 1; else slot.els.add(el!);
    colorsByValue.set(vals[i], slot);
  });
  const sanhua = [...colorsByValue.values()].some(x => Math.min(5, x.els.size + x.wild) >= 3);
  // 破敌：灵符也算克制符。
  const counter = enemyEl ? counterOf(enemyEl) : null;
  const hits = counter ? els.filter((el, i) => ling[i] || el === counter).length : 0;

  const picks = [
    best([s[0] >= 5, 'wulei'], [s[0] >= 4 && s[1] >= 4, 'sixiang2'], [s[0] === 4, 'sixiang'], [s[0] >= 3 && s[1] >= 3, 'sancai2'],
      [s[0] === 3 && s[1] === 2, 'mantang'], [s[0] === 3, 'sancai'], [s[0] === 2 && s[1] === 2, 'liangyi'], [s[0] === 2, 'shuangyuan']),
    best([ks[0] >= 4 && ks[1] >= 4, 'siyu2'], [ks[0] >= 4, 'siyu'], [ks[0] >= 3 && ks[1] >= 3, 'sanqing2'], [ks[0] === 3 && ks[1] === 2, 'hulu'],
      [ks[0] === 3, 'sanqing'], [ks[0] === 2 && ks[1] === 2, 'shuangdui'], [ks[0] === 2, 'chengshuang']),
    best([isDragon, 'hualong'], [longest >= 5, 'lian5'], [longest === 4, 'lian4'], [longest === 3, 'lian3']),
    best([distinct === 5, 'wuxing'], [sanhua, 'sanhua']),
    best([hits >= 4, 'pojun'], [hits === 3, 'pozhen'], [hits === 2, 'pozhan']),
    best([vals.length === 3 && ranked.length === 3 && total === 15, 'luoshu'], [vals.length === 2 && ranked.length === 2 && total === 10, 'shiquan']),
  ].filter(Boolean) as YakuId[];
  const yaku = picks.map(id => ({ id, fan: YAKU[id].fan }));

  const fiveSame = ranked.length === 5 && uniq.length === 1;
  const sheng = ['mu', 'huo', 'tu', 'jin', 'shui'] as El[];
  const isShengSheng = els.length === 5 && sheng.every((el, i) => els.some((e, j) => e === el && vals[j] === i + 1));
  const tianId = best([isShengSheng, 'shengsheng'], [s[0] >= 5 && longest === 5, 'jiutian'], [fiveSame && distinct === 5, 'wuqi']);
  const tian = tianId ? { id: tianId, fan: YAKU[tianId].fan } : null;
  const dewei = els.filter((el, i) => isDewei(el, vals[i]) || (!!wilds.loose && !!el && vals[i] > 0 && Math.abs(((vals[i] - 1) % 5) + 1 - HETU[el]) === 1)).length;
  const head = tian ?? [...yaku].sort((a, b) => b.fan - a.fan)[0];
  return { els, vals, sets, distinct, yaku, tian, dewei, combo: head?.id ?? 'san' };
}

/**
 * Every way to read the cast: 灵符 may be any element, 烛阴符 火 or 水, 幻符 any value 1–5.
 * The scorer keeps whichever reading hits hardest.
 */
export function assignments(tiles: Tile[]): { els: (El | null)[]; vals: number[] }[] {
  const elChoices = tiles.map(t => (t.el === 'zhuo' ? [null] : t.mod === 'ling' ? [...ELEMENTS] : t.sp === 'zhuyin' ? (['huo', 'shui'] as El[]) : [t.el]));
  const valChoices = tiles.map(t => (t.el === 'zhuo' ? [0] : t.mod === 'huan' ? [1, 2, 3, 4, 5] : [t.v]));
  let out: { els: (El | null)[]; vals: number[] }[] = [{ els: [], vals: [] }];
  tiles.forEach((_, i) => {
    out = out.flatMap(o => elChoices[i].flatMap(el => valChoices[i].map(v => ({ els: [...o.els, el], vals: [...o.vals, v] }))));
  });
  return out;
}

/** Named result of a cast, for the stamp, records and 悟道. Tier follows the cast's total 役番. */
export interface ComboDef { name: string; alias: string; tier: number }
export const COMBOS: Record<ComboId, ComboDef> = {
  san: { name: '散招', alias: '散牌', tier: 0 },
  ...(Object.fromEntries(YAKU_ORDER.map(id => [id, { name: YAKU[id].name, alias: YAKU[id].alias, tier: YAKU[id].path === 'tian' ? 6 : YAKU[id].fan >= 8 ? 5 : YAKU[id].fan >= 5 ? 4 : YAKU[id].fan >= 3 ? 3 : YAKU[id].fan >= 2 ? 2 : 1 }])) as Record<YakuId, ComboDef>),
};

/** Tier of a whole cast by its 役番 (stamp size, 剑意, bot thresholds). */
export function fanTier(fan: number, tian: boolean) {
  if (tian) return 6;
  return fan >= 12 ? 5 : fan >= 8 ? 4 : fan >= 5 ? 3 : fan >= 3 ? 2 : fan >= 1 ? 1 : 0;
}
