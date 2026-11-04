import { counterOf } from './elements.js';
const count = (ctx, el) => ctx.els.filter(e => e === el).length;
const missing = (ctx) => 1 - ctx.battle.player.hp / ctx.battle.player.maxHp;
export const RELICS = [
    // —— common ——
    { id: 'qingfeng', name: '青锋石', glyph: '锋', rarity: 'common', desc: '每次出招 +15 气', score: () => ({ qi: 15 }) },
    { id: 'huwen', name: '虎纹佩', glyph: '虎', rarity: 'common', desc: '每次出招 倍率 +3', score: () => ({ mult: 3 }) },
    { id: 'jiansui', name: '剑穗', glyph: '穗', rarity: 'common', desc: '每枚金符 +10 气', score: c => (count(c, 'jin') ? { qi: 10 * count(c, 'jin') } : null) },
    { id: 'chaoxi', name: '潮汐珠', glyph: '潮', rarity: 'common', desc: '每枚水符 +10 气', score: c => (count(c, 'shui') ? { qi: 10 * count(c, 'shui') } : null) },
    { id: 'qingmu', name: '青木簪', glyph: '簪', rarity: 'common', desc: '每枚木符 倍率 +1', score: c => (count(c, 'mu') ? { mult: count(c, 'mu') } : null) },
    { id: 'houtu', name: '厚土环', glyph: '岳', rarity: 'common', desc: '每枚土符 倍率再 +1', score: c => (count(c, 'tu') ? { mult: count(c, 'tu') } : null) },
    { id: 'chiyan', name: '赤炎珠', glyph: '炎', rarity: 'common', desc: '火符施加的灼烧翻倍', flags: { burnDouble: 1 } },
    { id: 'shuangyu', name: '双鱼佩', glyph: '鱼', rarity: 'common', desc: '本招有两组同元时 ×2', score: c => (c.a.sets.length >= 2 ? { x: 2 } : null) },
    { id: 'xiangsheng', name: '相生环', glyph: '环', rarity: 'common', desc: '每一次相生 倍率再 +1', flags: { linkMult: 1 } },
    { id: 'nilin', name: '逆鳞', glyph: '鳞', rarity: 'rare', desc: '本招有两次以上相克时 ×2', score: c => (c.a.links.filter(l => l === 'ke').length >= 2 ? { x: 2 } : null) },
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
    { id: 'tianji', name: '天机落雷箓', glyph: '箓', rarity: 'legend', desc: '雷符 ×2（原为 ×1.5）', flags: { leiX: 1 } },
    { id: 'hetu', name: '河图', glyph: '图', rarity: 'legend', desc: '相生传气翻倍（后一枚接过前一枚两倍的气）', flags: { flowX: 1 } },
    { id: 'luoshu', name: '洛书', glyph: '书', rarity: 'legend', desc: '每次相克的倍率再 +0.4', flags: { keX: 2 } },
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
    // —— 本命法宝（功法道行 2 解锁，只为本门出现）——
    { id: 'wanjianxia', name: '万剑匣', glyph: '匣', rarity: 'legend', method: 'yangjian', desc: '飞剑上限 +10；每柄飞剑使出招倍率 +0.4', flags: { swordCap: 10 }, score: c => (c.battle.swords ? { mult: 0.4 * c.battle.swords } : null) },
    { id: 'zhurongzhong', name: '祝融火种', glyph: '种', rarity: 'legend', method: 'yuhuo', desc: '灼烧在敌方回合造成两次伤害', flags: { burnTwice: 1 } },
    { id: 'buhuai', name: '不坏金身', glyph: '身', rarity: 'legend', method: 'jingang', desc: '盈盾化雷：当前护盾计入气的比例由 30% 提升到 70%', flags: { shieldBolt: 1 } },
    { id: 'leigonggu', name: '雷公鼓', glyph: '鼓', rarity: 'legend', method: 'benlei', desc: '怒技之后剑意保留 50', flags: { rageKeep: 50 } },
    { id: 'qingdilu', name: '青帝露', glyph: '露', rarity: 'legend', method: 'huichun', desc: '春华出招后不再减半', flags: { springKeep: 1 } },
    { id: 'zhuyinmu', name: '烛阴目', glyph: '目', rarity: 'legend', method: 'zhulong', desc: '昼夜加成由 ×3 提升到 ×5', flags: { dayNight: 1 } },
];
export const SIGNATURE = Object.fromEntries(RELICS.filter(r => r.method).map(r => [r.method, r.id]));
export const RELIC = Object.fromEntries(RELICS.map(r => [r.id, r]));
export const RELIC_PRICE = { common: 55, rare: 95, legend: 160 };
export const METHODS = [
    {
        id: 'yangjian', name: '养剑诀', title: '万剑', el: 'jin', art: 'hero-yangjian', hp: 70,
        blurb: '每一枚金符都是一柄剑。剑越多，每一招后的齐射越狠。',
        passive: ['每打出一枚金符，铸一柄飞剑（本场留存，上限 15）', '每次出招后，所有飞剑齐射，每柄造成 4 + 境界×4 伤害', '怒技时，飞剑齐射三轮'],
        extra: [{ el: 'jin', v: 3 }, { el: 'jin', v: 4 }],
    },
    {
        id: 'yuhuo', name: '御火诀', title: '焚天', el: 'huo', art: 'hero-yuhuo', hp: 70,
        blurb: '火只会越烧越旺。攒够了，一个怒技把它全部点爆。',
        passive: ['火符施加的灼烧翻倍', '敌方身上的灼烧不再衰减', '怒技时引爆灼烧：立即造成 灼烧层数×8 的伤害'],
        extra: [{ el: 'huo', v: 3 }, { el: 'huo', v: 4 }],
    },
    {
        id: 'jingang', name: '金刚功', title: '护法', el: 'shui', art: 'hero-jingang', hp: 90,
        blurb: '盾不会散，只会越叠越厚——然后砸到敌人脸上。',
        passive: ['护盾不会在回合开始时消散（上限为气血上限）', '每次出招，当前护盾的 30% 计入气'],
        extra: [{ el: 'shui', v: 3 }, { el: 'tu', v: 3 }],
    },
    {
        id: 'benlei', name: '奔雷诀', title: '连雷', el: 'jin', art: 'hero-benlei', hp: 75,
        blurb: '怒技一个接一个。每打出一次怒技，后面的每一招都更响。',
        passive: ['剑意获取 ×2', '每次怒技后，本场倍率永久 +3'],
        extra: [{ el: 'jin', v: 2, mod: 'lei' }],
    },
    {
        id: 'huichun', name: '回春功', title: '春华', el: 'mu', art: 'hero-huichun', hp: 100,
        blurb: '满血之后的每一口治疗都不会浪费，全部化作春华开成杀招。',
        passive: ['木符回复量 ×2', '溢出的治疗积为春华', '每次出招，春华全部计入气，随后减半'],
        extra: [{ el: 'mu', v: 3 }, { el: 'mu', v: 4 }],
    },
    {
        id: 'zhulong', name: '烛龙真经', title: '昼夜', el: 'huo', art: 'hero-zhulong', hp: 80,
        blurb: '睁目为昼，闭目为夜。跟着天色出符，气翻三倍。',
        passive: ['奇数回合为昼：金、火符气 ×3', '偶数回合为夜：水、木符气 ×3', '土符始终额外 倍率 +1'],
        extra: [{ el: 'tu', v: 4 }],
        locked: '任意功法渡劫成功一次后解锁',
    },
];
export const METHOD = Object.fromEntries(METHODS.map(m => [m.id, m]));
export const TALENTS = [
    { id: 'yiqi', name: '一气化三清', desc: '手中符数上限 +1' },
    { id: 'douzhuan', name: '斗转星移', desc: '每回合换符次数 +1' },
    { id: 'dongtian', name: '袖里乾坤', desc: '法宝栏位 +1' },
    { id: 'tongming', name: '剑意通明', desc: '剑意获取 ×1.5' },
    { id: 'guiyi', name: '五行归一', desc: '符袋中随机 4 枚符化为灵符（可当任意元素）', once: true },
    { id: 'nisheng', name: '逆转五行', desc: '相生链也可逆向连出（水→金→土→火→木）' },
    { id: 'shuangjue', name: '一念双诀', desc: '每回合第一次出招若不超过两枚符，不结束回合' },
    { id: 'yinjie', name: '引劫为用', desc: '天劫提前至第 5 回合，且只劈敌人' },
    { id: 'xueji', name: '血祭', desc: '每次出招失去 3 气血，倍率 ×1.6' },
    { id: 'jinshen', name: '金身', desc: '每场开战获得 20×境界 护盾' },
    { id: 'wanfa', name: '万法归宗', desc: '所有诀式等级 +1', once: true },
    { id: 'poyang', name: '破妄', desc: '克制加成由 ×2 提升为 ×3' },
    { id: 'changsheng', name: '长生', desc: '气血上限 +40 并回满', once: true },
    { id: 'leiyin', name: '雷引', desc: '每枚雷符额外暴击率 +25%' },
];
export const TALENT = Object.fromEntries(TALENTS.map(t => [t.id, t]));
export const REALMS = ['炼气', '筑基', '金丹', '元婴', '化神', '渡劫'];
export const VOWS = [
    { id: 'suidan', name: '碎丹燃血', desc: '气血上限 -40%；所有出招伤害 ×1.6' },
    { id: 'juenian', name: '绝念', desc: '再也不能换符；手中符数上限 +2' },
    { id: 'gujian', name: '孤剑', desc: '法宝栏位 -2（多出的法宝散去）；所有诀式等级 +2' },
];
export const VOW = Object.fromEntries(VOWS.map(v => [v.id, v]));
export const MOD_NAME = { lei: '雷', zhong: '重', ling: '灵', jing: '晶' };
export const MOD_DESC = {
    lei: '雷符：计分时倍率 ×1.5',
    zhong: '重符：气翻倍',
    ling: '灵符：可当作任意元素组成诀式',
    jing: '晶符：计分时倍率 +3',
};
