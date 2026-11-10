import { YAKU } from './patterns.js';
import { counterOf, ELEMENTS, type El } from './elements.js';
import type { BattleState, ComboId, RunState, SpId, Tile } from './types.js';
import type { Analysis } from './patterns.js';

export interface ScoreCtx {
  run: RunState;
  battle: BattleState;
  tiles: Tile[];
  els: (El | null)[];
  pattern: ComboId;
  a: Analysis;
  qi: number;
  mult: number;
  rage: boolean;
  /** 1-based count of this cast within the battle. */
  castIndex: number;
  slot: number;
}

export interface Bump { qi?: number; mult?: number; x?: number; text?: string }

export type Rarity = 'common' | 'rare' | 'legend';

export interface RelicDef {
  id: string;
  name: string;
  glyph: string;
  rarity: Rarity;
  desc: string;
  score?: (ctx: ScoreCtx) => Bump | null;
  /** Static flags read by the engine. */
  flags?: Partial<Record<RelicFlag, number>>;
  onGain?: (run: RunState) => void;
  /** 道树 unlock that adds this relic to the pools. */
  unlock?: string;
  /** 本命法宝: only offered to this method (after 道行 2). */
  method?: string;
}

export type RelicFlag =
  | 'critPct' | 'startQi' | 'qiPerCast' | 'turnShield' | 'afterHeal' | 'afterGold'
  | 'burnDouble' | 'critX' | 'ignoreArmor' | 'rageX' | 'leiX' | 'overhealQi' | 'shieldQi' | 'drumQi'
  | 'swordCap' | 'burnTwice' | 'shieldBolt' | 'rageKeep' | 'springKeep' | 'dayNight'
  | 'resonance'
  | 'keLink' | 'trigX' | 'loop' | 'firstLinkX' | 'headTrig' | 'trigQi'
  | 'guardX' | 'guardCut' | 'tuGuard' | 'vulnX' | 'breakHeal' | 'breakQi';

const count = (ctx: ScoreCtx, el: El) => ctx.els.filter(e => e === el).length;
const missing = (ctx: ScoreCtx) => 1 - ctx.battle.player.hp / ctx.battle.player.maxHp;

export const RELICS: RelicDef[] = [
  // —— common ——
  { id: 'qingfeng', name: '青锋石', glyph: '锋', rarity: 'common', desc: '每次出招 +15 气', score: () => ({ qi: 15 }) },
  { id: 'huwen', name: '虎纹佩', glyph: '虎', rarity: 'common', desc: '每次出招 倍率 +3', score: () => ({ mult: 3 }) },
  { id: 'jiansui', name: '剑穗', glyph: '穗', rarity: 'common', desc: '每枚金符 +10 气', score: c => (count(c, 'jin') ? { qi: 10 * count(c, 'jin') } : null) },
  { id: 'chaoxi', name: '潮汐珠', glyph: '潮', rarity: 'common', desc: '每枚水符 +10 气', score: c => (count(c, 'shui') ? { qi: 10 * count(c, 'shui') } : null) },
  { id: 'qingmu', name: '青木簪', glyph: '簪', rarity: 'common', desc: '每枚木符 倍率 +1', score: c => (count(c, 'mu') ? { mult: count(c, 'mu') } : null) },
  { id: 'houtu', name: '厚土环', glyph: '岳', rarity: 'common', desc: '每枚土符 倍率再 +1', score: c => (count(c, 'tu') ? { mult: count(c, 'tu') } : null) },
  { id: 'chiyan', name: '赤炎珠', glyph: '炎', rarity: 'common', desc: '火符施加的灼烧翻倍', flags: { burnDouble: 1 } },
  { id: 'shuangyu', name: '双鱼佩', glyph: '鱼', rarity: 'common', desc: '本招有两组同元时 ×2', score: c => (c.a.sets.length >= 2 ? { x: 2 } : null) },
  { id: 'xiangsheng', name: '相生环', glyph: '环', rarity: 'common', desc: '本招每一跳相生 +2 番', score: c => (c.a.links ? { mult: 2 * c.a.links } : null) },
  { id: 'nilin', name: '逆鳞', glyph: '鳞', rarity: 'rare', desc: '左边的符克右边的，也算连上一跳（相克也能连跳）', flags: { keLink: 1 } },
  { id: 'wunilian', name: '污泥莲', glyph: '莲', rarity: 'rare', desc: '本招每带一枚浊符 ×1.7 —— 出淤泥而不染', score: c => { const n = c.tiles.filter(t => t.el === 'zhuo').length; return n ? { x: 1.7 ** n } : null; } },
  { id: 'wusefan', name: '五色幡', glyph: '幡', rarity: 'rare', desc: '元素共鸣的效果再翻倍', flags: { resonance: 1 } },
  { id: 'mingmu', name: '明目珠', glyph: '目', rarity: 'common', desc: '暴击率 +20%', flags: { critPct: 20 } },
  { id: 'xianji', name: '先机符', glyph: '先', rarity: 'common', desc: '开战剑意 +50', flags: { startQi: 50 } },
  { id: 'yinqi', name: '引气符', glyph: '引', rarity: 'common', desc: '每次出招剑意 +10', flags: { qiPerCast: 10 } },
  { id: 'xuantie', name: '玄铁甲', glyph: '甲', rarity: 'common', desc: '每回合开始获得护盾（随境界成长）', flags: { turnShield: 6 } },
  { id: 'yangqi', name: '养气玉', glyph: '玉', rarity: 'common', desc: '获得时气血上限 +25', onGain: run => { run.maxHp += 25; run.hp += 25; } },
  { id: 'changming', name: '长明灯', glyph: '灯', rarity: 'common', desc: '每场胜后回复 10 气血', flags: { afterHeal: 10 } },
  { id: 'jucai', name: '聚财钱', glyph: '钱', rarity: 'common', desc: '每场胜后 +12 灵石', flags: { afterGold: 12 } },
  // —— rare ——
  { id: 'xuqi', name: '蓄气珠', glyph: '珠', rarity: 'rare', desc: '恰好出三枚符时 ×2', score: c => (c.tiles.length === 3 ? { x: 2 } : null) },
  { id: 'danqi', name: '单骑令', glyph: '单', rarity: 'rare', desc: '只出一枚符时 ×7 —— 一符破万法', score: c => (c.tiles.length === 1 ? { x: 7 } : null) },
  { id: 'wuse', name: '五色石', glyph: '娲', rarity: 'rare', desc: '出招含三种以上元素 ×1.6', score: c => (new Set(c.els.filter(Boolean)).size >= 3 ? { x: 1.6 } : null) },
  { id: 'xueyong', name: '血勇佩', glyph: '勇', rarity: 'rare', desc: '每损失 10% 气血 ×0.2', score: c => { const m = Math.floor(missing(c) * 10); return m > 0 ? { x: 1 + 0.2 * m } : null; } },
  { id: 'yinlei', name: '引雷针', glyph: '针', rarity: 'rare', desc: '暴击伤害 ×3（原为 ×2），暴击率 +10%', flags: { critX: 1, critPct: 10 } },
  { id: 'jiemai', name: '截脉针', glyph: '截', rarity: 'rare', desc: '无视敌方护甲；倍率 +2', flags: { ignoreArmor: 1 }, score: () => ({ mult: 2 }) },
  { id: 'zhenxin', name: '镇心玉', glyph: '镇', rarity: 'rare', desc: '自身没有护盾时 ×2', score: c => (c.battle.player.shield <= 0 ? { x: 2 } : null) },
  { id: 'ruyi', name: '如意钱', glyph: '如', rarity: 'rare', desc: '每持有 20 灵石 倍率 +1', score: c => { const n = Math.floor(c.run.gold / 20); return n ? { mult: n } : null; } },
  { id: 'leiwen', name: '雷纹印', glyph: '雷', rarity: 'rare', desc: '怒技 ×5（原为 ×3）', flags: { rageX: 2 } },
  { id: 'liekong', name: '裂空宝轮', glyph: '轮', rarity: 'rare', desc: '本场每第三次出招 ×3', score: c => (c.castIndex % 3 === 0 ? { x: 3 } : null) },
  { id: 'tiebi', name: '铁壁神铳', glyph: '铳', rarity: 'rare', desc: '当前护盾的一半计入气', flags: { shieldQi: 1 } },
  { id: 'yuye', name: '玉液回天壶', glyph: '壶', rarity: 'rare', desc: '溢出的治疗 ×3 计入下一招的气', flags: { overhealQi: 3 } },
  { id: 'zhenyue', name: '震岳鼓', glyph: '鼓', rarity: 'rare', desc: '护盾每吸收 1 点伤害，下一招 +3 气', flags: { drumQi: 3 } },
  // —— legendary ——
  { id: 'kunlun', name: '昆仑镜', glyph: '镜', rarity: 'legend', desc: '映照右侧相邻法宝，再触发一次它的效果' },
  { id: 'taotie', name: '饕餮鼎', glyph: '鼎', rarity: 'legend', desc: '每件其他法宝 ×0.3（四件即 ×2.2）', score: c => { const n = c.run.relics.length - 1; return n > 0 ? { x: 1 + 0.3 * n } : null; } },
  { id: 'xinhuo', name: '薪火宝炉', glyph: '炉', rarity: 'legend', desc: '敌方每 3 层灼烧 倍率 +1', score: c => { const n = Math.floor(c.battle.enemy.burn / 3); return n ? { mult: n } : null; } },
  { id: 'qiming', name: '启明玉', glyph: '启', rarity: 'legend', desc: '开战剑意全满', flags: { startQi: 100 } },
  { id: 'tianji', name: '天机落雷箓', glyph: '箓', rarity: 'legend', desc: '倍符 ×2（原为 ×1.5）', flags: { leiX: 1 } },
  { id: 'hetu', name: '河图', glyph: '图', rarity: 'legend', desc: '相生连跳里被生的符，触发次数 ×2', flags: { trigX: 1 } },
  { id: 'luoshu', name: '洛书', glyph: '书', rarity: 'legend', desc: '三张以上、最后一张又生第一张（首尾相生）时，每张符再触发一次', flags: { loop: 1 } },
  { id: 'wuyue', name: '五岳真形图', glyph: '岳', rarity: 'legend', desc: '四象、五雷 ×3', score: c => (c.a.sets[0]?.size >= 4 ? { x: 3 } : null) },
  { id: 'fantian', name: '翻天印', glyph: '印', rarity: 'legend', desc: '出满五枚符时 ×2', score: c => (c.tiles.length >= 5 ? { x: 2 } : null) },
  // —— 道树解锁：新器一 ——
  { id: 'zhaodan', name: '照胆镜', glyph: '照', rarity: 'common', unlock: 'relics1', desc: '每枚克制敌人的符再 +6 气', score: c => { const n = c.els.filter(e => e && e === counterOf(c.battle.enemy.el)).length; return n ? { qi: 6 * n } : null; } },
  { id: 'liuhe', name: '六合钱', glyph: '六', rarity: 'common', unlock: 'relics1', desc: '恰好出四枚符时 ×1.8', score: c => (c.tiles.length === 4 ? { x: 1.8 } : null) },
  { id: 'qiankun', name: '乾坤圈', glyph: '圈', rarity: 'common', unlock: 'relics1', desc: '每一组同元 倍率 +3', score: c => (c.a.sets.length ? { mult: 3 * c.a.sets.length } : null) },
  { id: 'baoyuan', name: '百宝囊', glyph: '囊', rarity: 'common', unlock: 'relics1', desc: '每持有一件法宝 +8 气', score: c => ({ qi: 8 * c.run.relics.length }) },
  // —— 新器二 ——
  { id: 'taiji', name: '太极图', glyph: '极', rarity: 'rare', unlock: 'relics2', desc: '每枚灵符 ×1.5', score: c => { const n = c.tiles.filter(t => t.mod === 'ling').length; return n ? { x: 1.5 ** n } : null; } },
  { id: 'fenghuo', name: '风火轮', glyph: '轮', rarity: 'rare', unlock: 'relics2', desc: '每场战斗第一回合 ×3', score: c => (c.battle.turn === 1 ? { x: 3 } : null) },
  { id: 'huntian', name: '混天绫', glyph: '绫', rarity: 'rare', unlock: 'relics2', desc: '敌人带着护甲时 ×2', score: c => (c.battle.enemy.armor > 0 ? { x: 2 } : null) },
  { id: 'bagua', name: '八卦炉', glyph: '卦', rarity: 'rare', unlock: 'relics2', desc: '每枚火符或金符 ×1.15', score: c => { const n = c.els.filter(e => e === 'huo' || e === 'jin').length; return n ? { x: 1.15 ** n } : null; } },
  // —— 新器三 ——
  { id: 'qibao', name: '七宝妙树', glyph: '树', rarity: 'rare', unlock: 'relics3', desc: '本招木符回复量的 4 倍计入气', score: c => { const v = c.tiles.reduce((s, t, i) => s + (c.els[i] === 'mu' ? t.v : 0), 0); return v ? { qi: v * 4 } : null; } },
  { id: 'dinghai', name: '定海神针', glyph: '针', rarity: 'legend', unlock: 'relics3', desc: '本回合没有换过符时 ×2.5', score: c => (!c.battle.stacks.discarded ? { x: 2.5 } : null) },
  { id: 'zhanxian', name: '斩仙飞刀', glyph: '刀', rarity: 'legend', unlock: 'relics3', desc: '敌人气血低于 35% 时 ×3', score: c => (c.battle.enemy.hp < c.battle.enemy.maxHp * 0.35 ? { x: 3 } : null) },
  { id: 'jiulong', name: '九龙神火罩', glyph: '罩', rarity: 'legend', unlock: 'relics3', desc: '敌方每 5 层灼烧 ×1.1（至多 ×4）', score: c => { const n = Math.floor(c.battle.enemy.burn / 5); return n ? { x: Math.min(4, 1.1 ** n) } : null; } },
  // —— 役之器：围绕新计分 ——
  { id: 'mingyun', name: '命运轮盘', glyph: '运', rarity: 'legend', desc: '每回合转出一种元素；本招有几张该元素的符，番就 ×几（至少两张）', score: c => { const el = ELEMENTS[c.battle.stacks.wheel ?? -1]; const k = el ? c.els.filter(e => e === el).length : 0; return k >= 2 ? { x: k } : null; } },
  { id: 'tianjiqian', name: '天机签', glyph: '签', rarity: 'common', desc: '每回合抽签定一种「吉」元素；本招每张吉元素符 +1 番', score: c => { const el = ELEMENTS[c.battle.stacks.omen ?? -1]; const n = el ? c.els.filter(e => e === el).length : 0; return n ? { mult: n } : null; } },
  { id: 'sanqingling', name: '三清铃', glyph: '铃', rarity: 'rare', desc: '破势时回复 10% 气血、剑意 +30', flags: { breakHeal: 10, breakQi: 30 } },
  { id: 'yuanyang', name: '鸳鸯镜', glyph: '鸳', rarity: 'common', desc: '成「两仪」或「满堂」时 +3 番', score: c => (c.a.yaku.some(y => y.id === 'liangyi' || y.id === 'mantang') ? { mult: 3 } : null) },
  { id: 'dengtian', name: '登天梯', glyph: '梯', rarity: 'rare', desc: '相生路的番再算一次', score: c => { const y = c.a.yaku.find(h => YAKU[h.id].path === 'sheng'); return y ? { mult: y.fan + Math.max(0, (c.run.patternLv.sheng ?? 1) - 1) } : null; } },
  { id: 'wufang', name: '五方旗', glyph: '旗', rarity: 'rare', desc: '成五行俱全时 ×2', score: c => (c.a.yaku.some(y => y.id === 'wuxing') ? { x: 2 } : null) },
  { id: 'jubao', name: '聚宝盆', glyph: '盆', rarity: 'rare', desc: '每张宝符再 +2 番', score: c => { const n = c.tiles.filter(t => t.mod === 'bao').length; return n ? { mult: 2 * n } : null; } },
  { id: 'yiyuan', name: '一元印', glyph: '元', rarity: 'legend', desc: '成五雷、四象双生时 ×2', score: c => (c.a.yaku.some(y => y.id === 'wulei' || y.id === 'sixiang2') ? { x: 2 } : null) },
  // —— 各路之器：每一路至少四件 ——
  { id: 'tongxin', name: '同心结', glyph: '结', rarity: 'common', desc: '本招第一次相生：被生的那张多触发 2 次', flags: { firstLinkX: 1 } },
  { id: 'jiulian', name: '九连环', glyph: '连', rarity: 'rare', desc: '成四生以上（含生生不息）时 ×2', score: c => (c.a.chain >= 4 ? { x: 2 } : null) },
  { id: 'suanpan', name: '算盘', glyph: '算', rarity: 'common', desc: '相生连跳每多触发一次，另 +6 气', flags: { trigQi: 1 } },
  { id: 'wuwei', name: '五味瓶', glyph: '瓶', rarity: 'common', desc: '本招有三种以上元素时，每种元素 +1 番', score: c => { const n = new Set(c.els.filter(Boolean)).size; return n >= 3 ? { mult: n } : null; } },
  { id: 'sanhuaguan', name: '三花冠', glyph: '冠', rarity: 'rare', desc: '每条相生链的链首也多触发 1 次', flags: { headTrig: 1 } },
  { id: 'pojia', name: '破甲锥', glyph: '锥', rarity: 'common', desc: '削罡气 +50%', flags: { guardX: 1 } },
  { id: 'zhanyao', name: '斩妖剑', glyph: '斩', rarity: 'legend', desc: '本招每张克制敌人的符 ×1.3', score: c => { const n = c.els.filter(e => e && e === counterOf(c.battle.enemy.el)).length; return n ? { x: 1.3 ** n } : null; } },
  { id: 'jiugong', name: '九宫格', glyph: '宫', rarity: 'common', desc: '敌人的罡气上限 −25%', flags: { guardCut: 1 } },
  { id: 'zhenyin', name: '镇岳印', glyph: '镇', rarity: 'common', desc: '每张土符削罡气再 +25%', flags: { tuGuard: 1 } },
  { id: 'zhantie', name: '斩铁', glyph: '铁', rarity: 'legend', desc: '破势后的那一招 ×3（原为 ×1.5）', flags: { vulnX: 1 } },
  { id: 'taiyi', name: '太一盘', glyph: '盘', rarity: 'rare', desc: '本场每破势一次，之后每招 +2 番', score: c => { const n = c.battle.stacks.poshi ?? 0; return n ? { mult: 2 * n } : null; } },
  // —— 单骑之器：把一张符养大，单张打出 ——
  { id: 'cuihuo', name: '淬火砧', glyph: '砧', rarity: 'rare', desc: '每次只出一张符，这张符永久 +2 点' },
  { id: 'wenyang', name: '温养玉', glyph: '温', rarity: 'common', desc: '每场胜后，符袋里点数最高的符 +2 点' },
  { id: 'benming', name: '本命符匣', glyph: '本', rarity: 'rare', desc: '每回合开局，符袋里点数最高的那张必定在手里' },
  { id: 'gufeng', name: '孤峰剑', glyph: '峰', rarity: 'legend', desc: '只出一张时，这张符每 10 点 +1 番', score: c => (c.tiles.length === 1 && c.tiles[0].v >= 10 ? { mult: Math.floor(c.tiles[0].v / 10) } : null) },
  // —— 本命法宝（功法道行 2 解锁，只为本门出现）——
  { id: 'wanjianxia', name: '万剑匣', glyph: '匣', rarity: 'legend', method: 'yangjian', desc: '飞剑上限 +10；每柄飞剑使出招倍率 +0.4', flags: { swordCap: 10 }, score: c => (c.battle.swords ? { mult: 0.4 * c.battle.swords } : null) },
  { id: 'zhurongzhong', name: '祝融火种', glyph: '种', rarity: 'legend', method: 'yuhuo', desc: '灼烧在敌方回合造成两次伤害', flags: { burnTwice: 1 } },
  { id: 'buhuai', name: '不坏金身', glyph: '身', rarity: 'legend', method: 'jingang', desc: '盈盾化雷：当前护盾计入气的比例由 30% 提升到 70%', flags: { shieldBolt: 1 } },
  { id: 'leigonggu', name: '雷公鼓', glyph: '鼓', rarity: 'legend', method: 'benlei', desc: '怒技之后剑意保留 50', flags: { rageKeep: 50 } },
  { id: 'qingdilu', name: '青帝露', glyph: '露', rarity: 'legend', method: 'huichun', desc: '春华出招后不再减半', flags: { springKeep: 1 } },
  { id: 'zhuyinmu', name: '烛阴目', glyph: '目', rarity: 'legend', method: 'zhulong', desc: '昼夜加成由 ×3.5 提升到 ×5', flags: { dayNight: 1 } },
];
export const SIGNATURE: Record<string, string> = Object.fromEntries(RELICS.filter(r => r.method).map(r => [r.method!, r.id]));
export const RELIC: Record<string, RelicDef> = Object.fromEntries(RELICS.map(r => [r.id, r]));
export const RELIC_PRICE: Record<Rarity, number> = { common: 55, rare: 95, legend: 160 };

export interface SpecialDef { id: SpId; name: string; glyph: string; method: string; el: El; v: number; desc: string }
/** 本门符: start with two; every 怒技 adds two more to the draw pile for the rest of the battle. */
export const SPECIALS: Record<SpId, SpecialDef> = {
  jian: { id: 'jian', name: '剑符', glyph: '剑', method: 'yangjian', el: 'jin', v: 5, desc: '金。一次铸两柄飞剑' },
  huozhong: { id: 'huozhong', name: '火种', glyph: '种', method: 'yuhuo', el: 'huo', v: 4, desc: '火。引燃：敌人现有灼烧的一半再加一遍' },
  jingang: { id: 'jingang', name: '金刚符', glyph: '刚', method: 'jingang', el: 'shui', v: 4, desc: '水。护盾 ×3，并把现有护盾的 10% 计入气' },
  leiyin: { id: 'leiyin', name: '雷引符', glyph: '引', method: 'benlei', el: 'jin', v: 4, desc: '金。打出时剑意 +25' },
  chunya: { id: 'chunya', name: '春芽', glyph: '芽', method: 'huichun', el: 'mu', v: 4, desc: '木。回复翻倍；满血时溢出全部化为春华' },
  zhuyin: { id: 'zhuyin', name: '烛阴符', glyph: '烛', method: 'zhulong', el: 'huo', v: 4, desc: '可当火或水，点数翻倍' },
};

export interface RageDef { name: string; desc: string }
/** Each method's own 怒技 (replaces the plain ×3). */
export const RAGES: Record<string, RageDef> = {
  yangjian: { name: '万剑归宗', desc: '本招 ×(1 + 0.25×飞剑数)，至少 ×2；飞剑齐射三轮' },
  yuhuo: { name: '焚天', desc: '本招 ×2，随后引爆灼烧：灼烧层数×8 的伤害（灼烧不消失）' },
  jingang: { name: '金刚伏魔', desc: '把全部护盾化为气，本招 ×2.5（护盾清空）' },
  benlei: { name: '奔雷', desc: '只需 60 剑意；本招 ×2.5，此后本场倍率永久 +4' },
  huichun: { name: '春雷', desc: '春华 ×3 计入气，本招 ×2，并回复 20% 气血' },
  zhulong: { name: '烛照九阴', desc: '本招 ×3，且昼夜加成对所有元素生效' },
};

export interface MethodDef {
  id: string;
  name: string;
  title: string;
  el: El;
  art: string;
  hp: number;
  blurb: string;
  passive: string[];
  /** Extra tiles added to the standard 25-tile bag. */
  extra: Omit<Tile, 'uid'>[];
  locked?: string;
  /** 1 = 上手, 2 = 进阶, 3 = 精通. */
  difficulty: number;
}

export const METHODS: MethodDef[] = [
  {
    id: 'yangjian', name: '养剑诀', title: '万剑', el: 'jin', art: 'hero-yangjian', hp: 85, difficulty: 1,
    blurb: '每一枚金符都是一柄剑。剑越多，每一招后的齐射越狠。',
    passive: ['每打出一枚金符，铸一柄飞剑（上限 15）；战后飞剑养回剑匣，下一战带着一半出阵', '每次出招后，所有飞剑齐射：每柄造成 4 + 境界×4，再加本招伤害的 6%', '本门符「剑符」：一次铸两柄', '怒技「万剑归宗」：飞剑越多倍率越高，齐射三轮'],
    extra: [{ el: 'jin', v: 3 }, { el: 'jin', v: 4 }],
  },
  {
    id: 'yuhuo', name: '御火诀', title: '焚天', el: 'huo', art: 'hero-yuhuo', hp: 85, difficulty: 2,
    blurb: '火只会越烧越旺。攒够了，一个怒技把它全部点爆。',
    passive: ['火符施加的灼烧翻倍；带火符的一招，伤害的 45% 留作灼烧', '敌方身上的灼烧不再衰减（灼烧每层伤害随境界提升）', '本门符「火种」：把敌人现有灼烧的一半再加一遍', '怒技「焚天」：×2，并引爆灼烧（层数×8，不消失）'],
    extra: [{ el: 'huo', v: 3 }, { el: 'huo', v: 4 }],
  },
  {
    id: 'jingang', name: '金刚功', title: '护法', el: 'shui', art: 'hero-jingang', hp: 85, difficulty: 1,
    blurb: '盾不会散，只会越叠越厚——然后砸到敌人脸上。',
    passive: ['护盾不会在回合开始时消散（上限为气血上限）', '每次出招，当前护盾的 30% 计入气', '本门符「金刚符」：护盾 ×3', '怒技「金刚伏魔」：全部护盾化为气，×2.5'],
    extra: [{ el: 'shui', v: 3 }, { el: 'tu', v: 3 }],
  },
  {
    id: 'benlei', name: '奔雷诀', title: '连雷', el: 'jin', art: 'hero-benlei', hp: 85, difficulty: 3,
    blurb: '怒技一个接一个。每打出一次怒技，后面的每一招都更响。',
    passive: ['剑意获取 ×2', '本门符「雷引符」：打出时剑意 +25', '怒技「奔雷」：只需 60 剑意，×2.5，此后本场倍率永久 +4'],
    extra: [{ el: 'jin', v: 2, mod: 'lei' }, { el: 'shui', v: 3, mod: 'lei' }],
  },
  {
    id: 'huichun', name: '回春功', title: '春华', el: 'mu', art: 'hero-huichun', hp: 85, difficulty: 1,
    blurb: '满血之后的每一口治疗都不会浪费，全部化作春华开成杀招。',
    passive: ['溢出的治疗积为春华', '每次出招，春华全部计入气，随后减半', '本门符「春芽」：回复再翻倍', '怒技「春雷」：春华 ×3 计入气，×2，回复 20% 气血'],
    extra: [{ el: 'mu', v: 3 }, { el: 'mu', v: 4 }],
  },
  {
    id: 'zhulong', name: '烛龙真经', title: '昼夜', el: 'huo', art: 'hero-zhulong', hp: 85, difficulty: 3,
    blurb: '睁目为昼，闭目为夜。跟着天色出符，气翻三倍。',
    passive: ['奇数回合为昼：金、火符气 ×3.5；偶数回合为夜：水、木符气 ×3.5', '土符始终额外 倍率 +1', '本门符「烛阴符」：可当火或水，点数翻倍', '怒技「烛照九阴」：×3，昼夜加成对所有元素生效'],
    extra: [{ el: 'tu', v: 4 }],
    locked: '任意功法渡劫成功一次后解锁',
  },
];
export const METHOD: Record<string, MethodDef> = Object.fromEntries(METHODS.map(m => [m.id, m]));

/** 天赋档位：凡 / 灵 / 仙（与法宝品阶同名）。分类只用于整理与展示。 */
export type TalentTier = 'common' | 'rare' | 'legend';
export type TalentCat = '节奏' | '成役' | '百搭' | '成长' | '守御' | '行险' | '经营';
/** method: 本门天赋，只为这些功法出现（逗号分隔）。 */
export interface TalentDef { id: string; name: string; desc: string; tier: TalentTier; cat: TalentCat; once?: boolean; method?: string }
const T = (id: string, name: string, tier: TalentTier, cat: TalentCat, desc: string, once?: boolean, method?: string): TalentDef => ({ id, name, desc, tier, cat, ...(once ? { once } : {}), ...(method ? { method } : {}) });
/** 减伤与闪避的上限。 */
export const REDUCE_CAP = 60;
export const DODGE_CAP = 40;
/** 五组相克元素各一张「既济」：同一招里两种元素各 2 张以上，额外 4 番，并附一个小效果。 */
export const JIJI: Record<string, { a: El; b: El; extra: string }> = {
  jiji_shuihuo: { a: 'shui', b: 'huo', extra: '护盾与灼烧各 ×2' },
  jiji_jinmu: { a: 'jin', b: 'mu', extra: '暴击率 +30%' },
  jiji_mutu: { a: 'mu', b: 'tu', extra: '回复 ×2' },
  jiji_tushui: { a: 'tu', b: 'shui', extra: '再 +2 番' },
  jiji_huojin: { a: 'huo', b: 'jin', extra: '伤害 ×1.2' },
};
export const TALENTS: TalentDef[] = [
  // —— 节奏 ——
  T('douzhuan', '斗转星移', 'common', '节奏', '每回合换符次数 +1'),
  T('yiqi', '一气化三清', 'rare', '节奏', '手中符数上限 +1'),
  T('tuoyin', '拓印', 'rare', '节奏', '每回合第一招后，下回合多摸一张与这一招里最大那张同元素、同点数的临时符'),
  T('shuangjue', '一念双诀', 'legend', '节奏', '每回合第一次出招若不超过两张，不结束回合'),
  // —— 成役 ——
  T('poyang', '破妄', 'rare', '成役', '克制加成由 ×2 提升为 ×3'),
  T('lianhuan', '连环', 'rare', '成役', '相生连跳里被生的符，每张多触发 1 次'),
  T('yuansheng', '源生', 'common', '成役', '每一跳相生回复 3 气血'),
  T('gangjin', '罡劲', 'common', '成役', '削罡气 +30%'),
  T('pozhu', '势如破竹', 'legend', '节奏', '一招打出破势后不结束回合，可以再出一招（每回合一次）'),
  T('zhenhun', '震魂', 'rare', '成役', '每破势一次，敌人本场攻击 −10%（至多 −50%）'),
  T('jiji_shuihuo', '水火既济', 'rare', '成役', '同一招里水、火各 2 张以上：额外 4 番，护盾与灼烧各 ×2'),
  T('jiji_jinmu', '金木交并', 'rare', '成役', '同一招里金、木各 2 张以上：额外 4 番，暴击率 +30%'),
  T('jiji_mutu', '木土相持', 'rare', '成役', '同一招里木、土各 2 张以上：额外 4 番，回复 ×2'),
  T('jiji_tushui', '土水相制', 'rare', '成役', '同一招里土、水各 2 张以上：额外 6 番'),
  T('jiji_huojin', '火金相炼', 'rare', '成役', '同一招里火、金各 2 张以上：额外 4 番，伤害 ×1.2'),
  T('wanfa', '万法归宗', 'legend', '成役', '所有心法 +1 重', true),
  T('faxiang', '法相天地', 'legend', '成役', '本场每成一个役，本场所有符 +1 点'),
  // —— 百搭 ——
  T('leiyin', '倍引', 'common', '百搭', '每张倍符额外暴击率 +25%'),
  T('kongling', '空灵根', 'legend', '百搭', '每回合手里随机一张符化为灵符（当任意元素，当回合有效）'),
  T('guiyi', '五行归一', 'legend', '百搭', '符袋中随机 4 张符永久化为灵符', true),
  // —— 成长 ——
  T('wenyang1', '温养·小成', 'common', '成长', '每场开战，符袋里点数最大的符永久 +1'),
  T('wenyang2', '温养·大成', 'rare', '成长', '每场开战，符袋里点数最大的符永久 +2'),
  T('wenyang3', '温养·圆满', 'legend', '成长', '每场开战，符袋里点数最大的符永久 +3'),
  T('guzhu', '孤注', 'rare', '成长', '只出一张符时，它的点数 ×3 计入气'),
  T('bubu', '步步为营', 'rare', '成长', '每场开战，手里最大的符临时 +5；斩杀敌人的那一招用到了它，+5 转为永久'),
  // —— 守御 ——
  T('jinshen', '金身', 'common', '守御', '每场开战获得 20×境界 护盾'),
  T('changsheng', '长生', 'common', '守御', '气血上限 +40 并回满', true),
  T('baizhe', '百折', 'rare', '守御', '护盾被打破时，气血上限永久 +5'),
  T('jieshi', '借势', 'legend', '守御', '敌人本回合要打出的伤害，有一半计入你这一招的气'),
  T('tieyi', '铁衣', 'common', '守御', '受到敌人的伤害 −10%（减伤上限 60%）'),
  T('tieyi2', '玄铁衣', 'rare', '守御', '受到敌人的伤害 −20%（减伤上限 60%）'),
  T('shenfa', '身法', 'rare', '守御', '敌人每一击有 15% 机会闪开（闪避上限 40%）'),
  T('huiling', '回灵', 'rare', '守御', '每回合开始回复气血上限的 6%'),
  T('guixi', '龟息', 'legend', '守御', '单次受到的伤害至多为气血上限的 35%'),
  // 本门守御：每门功法一条自己的活路。
  T('jianmu', '剑幕', 'rare', '守御', '每柄飞剑使受到的伤害 −3%（减伤上限 60%）', false, 'yangjian'),
  T('fenshen', '焚身', 'rare', '守御', '敌人身上的灼烧达其当前气血的 10% 时，受到它的伤害 −35%（减伤上限 60%）', false, 'yuhuo'),
  T('budong', '不动明王', 'legend', '守御', '护盾上限变为气血上限 ×2；每回合开始获得气血上限 15% 的护盾；有护盾时受到的伤害 −30%（减伤上限 60%）；金刚不坏至多 15 番', false, 'jingang'),
  T('leidun', '雷遁', 'rare', '守御', '开怒技的那一回合，敌人的攻击全部闪开；本场每开过一次怒技，闪避 +10%（闪避上限 40%）', false, 'benlei'),
  T('kumu', '枯木逢春', 'legend', '守御', '每场一次：气血归零时以一半气血复苏', false, 'huichun'),
  T('shijie', '以身饲劫', 'legend', '守御', '无尽天劫中，天劫劈敌的累计上限由六成提到八成五（配「引劫为用」最好）', false, 'jingang,huichun'),
  T('yeyin', '夜隐', 'rare', '守御', '昼回合受到的伤害 −20%，夜回合（偶数回合）−50%（减伤上限 60%）', false, 'zhulong'),
  // —— 行险 ——
  T('xingxian', '行险', 'common', '行险', '不掉血赢下一场，额外灵石 +10 并连续累加；某场掉血超过一半则清零'),
  T('xueji', '血祭', 'rare', '行险', '每次出招失去 3 气血，伤害 ×1.6'),
  T('yinjie', '引劫为用', 'legend', '行险', '天劫提前至第 5 回合，且只劈敌人'),
  // —— 经营 ——
  T('tongming', '剑意通明', 'common', '经营', '剑意获取 ×1.5'),
  T('dianshi', '点石成金', 'common', '经营', '在坊市和斩获页每花 50 灵石，符袋里点数最大的符 +3'),
  T('dongtian', '袖里乾坤', 'rare', '经营', '法宝栏位 +1'),
];
/** 每次突破，三选一的每个选项按此抽档（键为刚打完的幕）。 */
export const TALENT_TIER_ODDS: Record<number, Record<TalentTier, number>> = {
  1: { common: 60, rare: 35, legend: 5 },
  2: { common: 40, rare: 45, legend: 15 },
  3: { common: 25, rare: 45, legend: 30 },
  4: { common: 10, rare: 40, legend: 50 },
};
export const TIER_NAME: Record<TalentTier, string> = { common: '凡', rare: '灵', legend: '仙' };
export const TALENT: Record<string, TalentDef> = Object.fromEntries(TALENTS.map(t => [t.id, t]));

export const REALMS = ['炼气', '筑基', '金丹', '元婴', '化神', '渡劫'];

export interface VowDef { id: string; name: string; desc: string }
export const VOWS: VowDef[] = [
  { id: 'suidan', name: '碎丹燃血', desc: '气血上限 -40%；所有出招伤害 ×1.6' },
  { id: 'juenian', name: '绝念', desc: '再也不能换符；手中符数上限 +2' },
  { id: 'gujian', name: '孤剑', desc: '法宝栏位 -2（多出的法宝散去）；所有心法 +2 重' },
];
export const VOW: Record<string, VowDef> = Object.fromEntries(VOWS.map(v => [v.id, v]));

export const MOD_NAME: Record<string, string> = { ling: '灵', bao: '宝', lei: '倍' };
/** One line for cards; the full rule is MOD_DESC (诀谱 · 符纹). */
export const MOD_SHORT: Record<string, string> = { ling: '灵 · 百搭元素（高级）', bao: '宝 · +1 番', lei: '倍 · 伤害 ×1.5' };
export const MOD_DESC: Record<string, string> = {
  ling: '高级符纹 · 灵：当任意元素（百搭花色），同时算进每一组同元；在相生链里取最好的一种',
  bao: '普通符纹 · 宝：自己就是宝牌，+1 番',
  lei: '普通符纹 · 倍：本招伤害 ×1.5',
};

// —— 命格：先天命数。开局改写一条规则、带一个代价；突破到金丹时「化境」再变一次。 ——
export interface FateDef { id: string; name: string; gift: string; cost: string; awaken: string; play: string; unlock?: string }
export const FATES: FateDef[] = [
  { id: 'liansheng', name: '连生命', gift: '相生连跳里被生的符，每张多触发 1 次', cost: '同元的役番数 −1', awaken: '每一跳相生 +1 番', play: '相生排序' },
  { id: 'pianku', name: '偏枯命', gift: '选一种本命元素：符袋多 5 张；本命元素的符气 +2', cost: '其余元素的符，气 −1', awaken: '本命元素三张以上时，额外 +3 番', play: '同元' },
  { id: 'xingxiu', name: '星宿命', gift: '每场开战抽一宿，本场某一路的番 ×2', cost: '每场主打的路都不同', awaken: '每场抽两宿', play: '随机应变' },
  { id: 'tianyan', name: '天眼命', gift: '地图上奇遇的名字可见；每幕可以把一个节点改成别的类型', cost: '气血上限 −15%', awaken: '每幕可改两个节点', play: '规划路线' },
  { id: 'guxing', name: '孤星命', gift: '每件法宝都触发两次', cost: '法宝栏只有 3 格', awaken: '法宝栏 +1', play: '少而精的法宝', unlock: 'fate:guxing' },
  { id: 'sanxiu', name: '散修命', gift: '战斗所得灵石 ×2，坊市七折', cost: '战后不再给法宝选择（精英、首领也一样）', awaken: '每个坊市多上一件法宝', play: '坊市经营', unlock: 'fate:sanxiu' },
  { id: 'yingjie', name: '应劫命', gift: '天劫提前 2 回合；劈到你身上的天劫化为护盾', cost: '回合一长，敌人也被劈', awaken: '天劫劈敌伤害 ×2', play: '以守代攻', unlock: 'fate:yingjie' },
  { id: 'bailian', name: '百炼命', gift: '炼符、熔符、三张归一每次额外 +2 点；洞府可以做两件事', cost: '战后的符奖励少一个选项', awaken: '炼符时附上高级符纹（灵）', play: '养大一张符', unlock: 'fate:bailian' },
  { id: 'tunfu', name: '吞符命', gift: '每场胜后可吞一张符：永久移除，它的点数平分给同元素的其他符', cost: '符袋越吞越薄，元素越来越偏', awaken: '吞符时，它的符纹转给同元素点数最大的那张', play: '精简符袋', unlock: 'fate:tunfu' },
  { id: 'shouzhuo', name: '守拙命', gift: '出满五张时伤害 ×1.5', cost: '出两张以下时伤害 ×0.6', awaken: '出满五张时额外 +2 番', play: '大手牌多叠役', unlock: 'fate:shouzhuo' },
];
export const FATE: Record<string, FateDef> = Object.fromEntries(FATES.map(f => [f.id, f]));
