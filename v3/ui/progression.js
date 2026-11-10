/**
 * 局外成长：道果、道树、悟道（成就）、功法道行、每日一劫。
 * Everything here lives in the browser profile and only reaches a run through
 * the unlock list copied into it at the start.
 */
import { METHODS } from '../core/content.js';
import { PACTS, pactMultiplier } from '../core/pacts.js';
import { COMBOS } from '../core/patterns.js';
import { seedFrom, sample, pick } from '../core/rng.js';
import { bondsDone, ENDING } from '../core/story.js';
export const TREE = [
    { id: 'relics1', branch: '器', name: '新器 · 一', desc: '照胆镜、六合钱、乾坤圈、百宝囊进入法宝池', cost: 40 },
    { id: 'relics2', branch: '器', name: '新器 · 二', desc: '太极图、风火轮、混天绫、八卦炉进入法宝池', cost: 90, requires: 'relics1' },
    { id: 'boss1', branch: '器', name: '宝光', desc: '精英与首领的法宝候选 +1', cost: 130, requires: 'relics2' },
    { id: 'relics3', branch: '器', name: '新器 · 三', desc: '七宝妙树、定海神针、斩仙飞刀、九龙神火罩进入法宝池', cost: 180, requires: 'boss1' },
    { id: 'slot1', branch: '器', name: '洞天 · 一格', desc: '法宝栏位 +1', cost: 320, requires: 'relics3' },
    { id: 'ling1', branch: '符', name: '灵根', desc: '每局起手多一枚灵符', cost: 30 },
    { id: 'pattern1', branch: '符', name: '家传心法', desc: '每局起手「同元」「相生」心法各 +1 重', cost: 70, requires: 'ling1' },
    { id: 'discard1', branch: '符', name: '先手换符', desc: '每场战斗多一次换符', cost: 120, requires: 'pattern1' },
    { id: 'events2', branch: '符', name: '奇遇新卷', desc: '扶桑、瑶池、夸父之杖、补天石加入奇遇', cost: 160, requires: 'discard1' },
    { id: 'gold1', branch: '路', name: '盘缠', desc: '每局起手多 30 灵石', cost: 25 },
    { id: 'rest1', branch: '路', name: '洞府深眠', desc: '洞府调息回复 40% → 55%', cost: 60, requires: 'gold1' },
    { id: 'guide', branch: '路', name: '因缘指引', desc: '因缘相遇在地图上出现两处，更容易遇见', cost: 110, requires: 'rest1' },
    { id: 'fate:guxing', branch: '命', name: '孤星命', desc: '每件法宝触发两次，法宝栏只有 3 格', cost: 50 },
    { id: 'fate:sanxiu', branch: '命', name: '散修命', desc: '灵石 ×2、坊市七折，战后不给法宝', cost: 80, requires: 'fate:guxing' },
    { id: 'fate:yingjie', branch: '命', name: '应劫命', desc: '天劫提前，劈你的化为护盾', cost: 110, requires: 'fate:sanxiu' },
    { id: 'fate:bailian', branch: '命', name: '百炼命', desc: '炼符熔符多 +2，洞府做两件事', cost: 140, requires: 'fate:yingjie' },
    { id: 'fate:tunfu', branch: '命', name: '吞符命', desc: '胜后吞符，点数分给同元素', cost: 170, requires: 'fate:bailian' },
    { id: 'fate:shouzhuo', branch: '命', name: '守拙命', desc: '出满五张 ×1.5，两张以下 ×0.6', cost: 200, requires: 'fate:tunfu' },
];
export const TREE_NODE = Object.fromEntries(TREE.map(n => [n.id, n]));
export function canBuy(meta, id) {
    const node = TREE_NODE[id];
    return !!node && !meta.unlocks.includes(id) && (!node.requires || meta.unlocks.includes(node.requires)) && meta.daoguo >= node.cost;
}
export function buyNode(meta, id) {
    if (!canBuy(meta, id))
        return false;
    meta.daoguo -= TREE_NODE[id].cost;
    meta.unlocks.push(id);
    return true;
}
/** The cheapest thing not yet owned whose prerequisite is met — the carrot on the end screen. */
export function nextGoal(meta) {
    return TREE.filter(n => !meta.unlocks.includes(n.id) && (!n.requires || meta.unlocks.includes(n.requires))).sort((a, b) => a.cost - b.cost)[0] ?? null;
}
// —— 功法道行 ——
export const MASTERY_XP = [0, 40, 120, 260, 480];
export const MASTERY_PERKS = ['入门', '本命法宝进入法宝池', '起手多一枚本门灵符', '起手即持本命法宝', '道成：本门全部解锁'];
export function masteryLevel(xp) { let lv = 1; for (let i = 1; i < MASTERY_XP.length; i += 1)
    if (xp >= MASTERY_XP[i])
        lv = i + 1; return lv; }
export function runUnlocks(meta, method) {
    const lv = masteryLevel(meta.mastery[method] ?? 0);
    return [...meta.unlocks, ...Array.from({ length: lv - 1 }, (_, i) => `m:${method}:${i + 2}`)];
}
const castIs = (c, f) => c.kind === 'cast' && f(c);
const winIs = (c, f) => c.kind === 'battle' && c.battle.outcome === 'won' && f(c);
const endIs = (c, f) => c.kind === 'end' && f(c);
const hit = (n) => (c) => castIs(c, x => x.total >= n);
const pat = (id) => (c) => castIs(c, x => x.result.pattern === id || x.result.yaku.some(y => y.id === id));
export const ACHIEVEMENTS = [
    { id: 'first', name: '初试锋芒', desc: '赢下第一场战斗', reward: 5, check: c => winIs(c, () => true) },
    { id: 'y-sansheng', name: '三生', desc: '打出「三生」（三张依次相生，如 木→火→土）', reward: 5, check: pat('sansheng') },
    { id: 'p-mantang', name: '满堂', desc: '打出「满堂」（同花葫芦）', reward: 8, check: pat('mantang') },
    { id: 'y-sisheng', name: '四生', desc: '打出「四生」（四张依次相生）', reward: 10, check: pat('sisheng') },
    { id: 'y-wuxing', name: '五行俱全', desc: '打出「五行俱全」（五种元素各一张）', reward: 10, check: pat('wuxing') },
    { id: 'y-lianji', name: '连跳', desc: '一招里有一张符触发 5 次以上', reward: 12, check: c => castIs(c, x => Math.max(...x.result.triggers) >= 5) },
    { id: 'y-poshi', name: '破势', desc: '一场战斗里破势三次', reward: 12, check: c => winIs(c, x => (x.battle.stacks.poshi ?? 0) >= 3) },
    { id: 'p-wulei', name: '五雷', desc: '打出「五雷」（清一色：五张同元素）', reward: 25, check: pat('wulei') },
    { id: 'p-sixiang', name: '四象', desc: '打出「四象」（四张同元素）', reward: 12, check: pat('sixiang') },
    { id: 't-shengsheng', name: '生生不息', desc: '打出「生生不息」（五张依次相生，连成一整圈）', reward: 30, check: pat('shengsheng') },
    { id: 'resonance', name: '共鸣', desc: '一招里触发元素共鸣（三枚以上同元）', reward: 5, check: c => castIs(c, x => x.result.analysis.sets.some(st => st.size >= 3)) },
    { id: 'mud', name: '出淤泥', desc: '带着浊符打出一万以上的一招', reward: 20, check: c => castIs(c, x => x.total >= 1e4 && x.result.tiles.some(t => t.el === 'zhuo')) },
    { id: 'h4', name: '万钧', desc: '一招伤害破一万', reward: 10, check: hit(1e4) },
    { id: 'h5', name: '十万钧', desc: '一招伤害破十万', reward: 20, check: hit(1e5) },
    { id: 'h6', name: '百万钧', desc: '一招伤害破百万', reward: 40, check: hit(1e6) },
    { id: 'h7', name: '千万钧', desc: '一招伤害破千万', reward: 60, check: hit(1e7) },
    { id: 'h8', name: '一亿', desc: '一招伤害破一亿', reward: 100, check: hit(1e8) },
    { id: 'onefu', name: '一符破万法', desc: '只出一枚符斩杀敌人', reward: 20, check: c => castIs(c, x => x.killed && x.result.tiles.length === 1) },
    { id: 'swords', name: '万剑归宗', desc: '养剑诀：飞剑攒到 15 柄', reward: 20, check: c => castIs(c, x => x.battle.swords >= 15) },
    { id: 'fentian', name: '焚天', desc: '御火诀：一次怒技打出五万以上', reward: 20, check: c => castIs(c, x => x.run.method === 'yuhuo' && x.result.rage && x.total >= 5e4) },
    { id: 'legend3', name: '仙器满身', desc: '同时持有三件仙品法宝', reward: 25, check: c => c.kind === 'cast' && c.run.relics.filter(id => ['kunlun', 'taotie', 'mingyun', 'yiyuan', 'xinhuo', 'qiming', 'tianji', 'hetu', 'fantian', 'dinghai', 'zhanxian', 'jiulong', 'wanjianxia', 'zhurongzhong', 'buhuai', 'leigonggu', 'qingdilu', 'zhuyinmu'].includes(id)).length >= 3 },
    { id: 'rage3', name: '怒发冲冠', desc: '一场战斗里打出三次怒技', reward: 15, check: c => winIs(c, x => (x.battle.stacks.rages ?? 0) >= 3) },
    { id: 'flawless', name: '不动如山', desc: '不损一滴气血击败首领', reward: 25, check: c => winIs(c, x => x.battle.kind === 'boss' && x.battle.player.hp >= (x.battle.stacks.startHp ?? Infinity)) },
    { id: 'oneshot', name: '一招定乾坤', desc: '第一招就斩杀首领', reward: 40, check: c => winIs(c, x => x.battle.kind === 'boss' && x.battle.castCount === 1) },
    { id: 'clutch', name: '绝境', desc: '气血不足一成时斩杀首领', reward: 25, check: c => winIs(c, x => x.battle.kind === 'boss' && x.battle.player.hp < x.battle.player.maxHp * 0.1) },
    { id: 'bond1', name: '守约', desc: '完成一条因缘', reward: 10, check: c => endIs(c, x => bondsDone(x.run) >= 1) || (c.kind === 'battle' && bondsDone(c.run) >= 1) },
    { id: 'bond2', name: '双缘', desc: '一局完成两条因缘', reward: 20, check: c => endIs(c, x => bondsDone(x.run) >= 2) || (c.kind === 'battle' && bondsDone(c.run) >= 2) },
    { id: 'e-ascend', name: '飞升', desc: '见到结局「飞升」', reward: 20, check: c => endIs(c, x => x.run.ending === 'ascend') },
    { id: 'e-return', name: '归水', desc: '见到结局「归水」', reward: 20, check: c => endIs(c, x => x.run.ending === 'return') },
    { id: 'e-pillar', name: '补天', desc: '见到结局「补天」', reward: 40, check: c => endIs(c, x => x.run.ending === 'pillar') },
    { id: 'vow', name: '誓不回头', desc: '立誓后渡劫成功', reward: 25, check: c => endIs(c, x => x.won && !!x.run.vow) },
    { id: 'murky', name: '浊而不污', desc: '符袋里带着五枚以上浊符渡劫', reward: 30, check: c => endIs(c, x => x.won && x.run.bag.filter(t => t.el === 'zhuo').length >= 5) },
    { id: 'heat3', name: '三重契', desc: '劫数 3 以上渡劫', reward: 30, check: c => endIs(c, x => x.won && x.run.heat >= 3) },
    { id: 'heat6', name: '六重契', desc: '劫数 6 以上渡劫', reward: 50, check: c => endIs(c, x => x.won && x.run.heat >= 6) },
    { id: 'heat10', name: '十重契', desc: '劫数 10 以上渡劫', reward: 100, check: c => endIs(c, x => x.won && x.run.heat >= 10) },
    { id: 'all5', name: '五门皆通', desc: '用五门不同功法渡劫', reward: 60, check: c => endIs(c, x => Object.keys(x.meta.heatWon).length >= 5) },
    { id: 'endless3', name: '劫外有劫', desc: '无尽天劫抵达第 3 层', reward: 25, check: c => c.run.endless >= 3 },
    { id: 'endless6', name: '劫海无涯', desc: '无尽天劫抵达第 6 层', reward: 50, check: c => c.run.endless >= 6 },
    { id: 'endless10', name: '万劫不磨', desc: '无尽天劫抵达第 10 层', reward: 100, check: c => c.run.endless >= 10 },
    { id: 'daily', name: '日日是劫', desc: '完成一次每日一劫', reward: 10, check: c => endIs(c, x => !!x.run.daily) },
];
export const ACH = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));
/** Unlocks every newly met 悟道 and credits its 道果 at once. Returns the new ones. */
export function checkAchievements(meta, ctx) {
    const got = [];
    for (const a of ACHIEVEMENTS) {
        if (meta.achievements.includes(a.id))
            continue;
        let ok = false;
        try {
            ok = a.check(ctx);
        }
        catch {
            ok = false;
        }
        if (!ok)
            continue;
        meta.achievements.push(a.id);
        meta.daoguo += a.reward;
        ctx.run.log.push(`ach:${a.id}`);
        got.push(a);
    }
    return got;
}
export function settle(meta, run, newEnding) {
    const lines = [];
    const add = (label, n) => { if (n > 0)
        lines.push([label, Math.round(n)]); };
    add(`行路 ${run.stats.floors} 处`, run.stats.floors);
    const bosses = run.log.filter(l => l.startsWith('boss:')).length;
    add(`斩首领 ${bosses} 位`, bosses * 10);
    add(`守约 ${bondsDone(run)} 人`, bondsDone(run) * 5);
    if (run.screen.name === 'won' || run.ending)
        add(`结局「${run.ending ? ENDING[run.ending].name : '渡劫'}」`, 15 + (newEnding ? 30 : 0));
    add(`无尽天劫 ${run.endless} 层`, Math.max(0, run.endless - 1) * 10);
    add(`最强一招 ${Math.round(run.stats.bestHit).toLocaleString('en-US')}`, Math.max(0, Math.log10(Math.max(1, run.stats.bestHit)) - 2) * 2);
    if (run.daily)
        add('每日一劫', 15);
    const base = lines.reduce((s, [, n]) => s + n, 0);
    const multiplier = pactMultiplier(run.heat);
    // A run can be settled twice (ending, then 无尽天劫): only pay what is new.
    const gross = Math.round(base * multiplier);
    const total = Math.max(0, gross - (run.stats.paid ?? 0));
    run.stats.paid = gross;
    const achAll = run.log.filter(l => l.startsWith('ach:')).reduce((s, l) => s + (ACH[l.slice(4)]?.reward ?? 0), 0);
    const achievements = Math.max(0, achAll - (run.stats.achPaid ?? 0));
    run.stats.achPaid = achAll;
    const xpBefore = meta.mastery[run.method] ?? 0;
    meta.daoguo += total;
    meta.mastery[run.method] = xpBefore + total + achievements;
    return { lines, base, multiplier, total, achievements, method: run.method, xpBefore, xpAfter: meta.mastery[run.method] };
}
// —— 每日一劫 ——
export function todayKey(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function dailySetup(key) {
    const rng = { state: seedFrom(`daily:${key}`) };
    const method = pick(rng, METHODS.filter(m => !m.locked)).id;
    const pacts = Object.fromEntries(sample(rng, PACTS.filter(p => p.id !== 'lone' && p.id !== 'narrow'), 2).map(p => [p.id, 1]));
    return { seed: `daily-${key}`, method, pacts };
}
export const patternName = (id) => COMBOS[id]?.name ?? id;
