/**
 * 役 —— 以符成役。只看元素，不用算点数：点数只是每张符的气（伤害底数）。
 *   同元：同一元素凑组（双元、两仪、三才、满堂、四象、五雷）。
 *   合丹连跳：同元素自动合成一丹，按元素首次点选的顺序排列；相邻丹左生右就连一跳。
 *         链里第 k 个丹，每张符触发 k 次；同元与相生两路番相加。
 * 两路各取最高的一个役，番相加，番数就是倍率。灵符同时算作每一种元素（同元里算进每一组）；
 * 在相生里它取最好的一种元素。另计：本门役（看战况）。
 * 每个役（含宝符与心法）每番另带 QI_PER_FAN 气。
 */
import { ELEMENTS, GEN, KE } from './elements.js';
/** 每番另带的气。 */
export const QI_PER_FAN = 10;
export const PATTERNS = {
    yuan: { id: 'yuan', name: '同元', alias: '同花', hint: '同一元素的符凑在一起：双元、两仪、三才、满堂、四象、五雷', short: '同元素凑组' },
    sheng: { id: 'sheng', name: '相生', alias: '合丹连跳', hint: '同元素自动合丹，按首次点选排丹；木→火→土→金→水→木，左丹生右丹就连一跳，第 k 丹每张符触发 k 次。点「理链」自动排', short: '同元素合丹，按相生连跳' },
};
export const PATTERN_ORDER = ['yuan', 'sheng'];
/** 心法 n 重：这一路成役时 +(n−1) 番。 */
export const patternValue = (_id, level) => ({ fan: Math.max(0, level - 1) });
const Y = (id, path, name, alias, fan, desc, method) => ({ id, path, name, alias, fan, desc, ...(method ? { method } : {}) });
export const YAKU = {
    shuangyuan: Y('shuangyuan', 'yuan', '双元', '两张同花', 1, '两张同元素'),
    liangyi: Y('liangyi', 'yuan', '两仪', '两组同花', 2, '两组各两张同元素'),
    sancai: Y('sancai', 'yuan', '三才', '三同花', 2, '三张同元素'),
    mantang: Y('mantang', 'yuan', '满堂', '同花葫芦', 4, '三张同元素＋两张另一元素'),
    sixiang: Y('sixiang', 'yuan', '四象', '四同花', 5, '四张同元素'),
    sancai2: Y('sancai2', 'yuan', '三才并立', '两组三同花', 5, '两种元素各凑成三张（要靠灵符同时算两边）'),
    sixiang2: Y('sixiang2', 'yuan', '四象双生', '两组四同花', 7, '两种元素各凑成四张（要靠灵符同时算两边）'),
    wulei: Y('wulei', 'yuan', '五雷', '清一色', 8, '五张同元素'),
    xiangsheng: Y('xiangsheng', 'sheng', '相生', '一跳', 1, '相邻两丹，左生右，如 木→火；火丹每张触发 2 次'),
    sansheng: Y('sansheng', 'sheng', '三生', '两跳', 2, '连续三丹依次相生，如 火→土→金；各丹每张分别触发 1、2、3 次'),
    sisheng: Y('sisheng', 'sheng', '四生', '三跳', 4, '连续四丹依次相生，如 火→土→金→水'),
    wuxing: Y('wuxing', 'sheng', '五行俱全', '五色', 4, '五种元素齐全（不论丹的顺序）'),
    shengsheng: Y('shengsheng', 'sheng', '生生不息', '四跳', 6, '五丹依次相生，走完五行一圈；各丹每张分别触发 1 至 5 次'),
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
export const YAKU_ORDER = Object.keys(YAKU);
function best(...cands) {
    for (const [ok, id] of cands)
        if (ok)
            return id;
    return null;
}
/** 相生连跳：左丹生右丹就连上（浊符断链）。 */
export const links = (a, b, ke = false) => !!a && !!b && (GEN[a] === b || (ke && KE[a] === b));
export function chainNodes(els, ke = false) {
    const nodes = [];
    const byEl = new Map();
    els.forEach((el, i) => {
        const existing = el ? byEl.get(el) : undefined;
        if (existing) {
            existing.tiles.push(i);
            return;
        }
        const prev = nodes[nodes.length - 1];
        const node = { el, tiles: [i], pos: prev && links(prev.el, el, ke) ? prev.pos + 1 : 1 };
        nodes.push(node);
        if (el)
            byEl.set(el, node);
    });
    return nodes;
}
function tilePositions(nodes, n) {
    const pos = new Array(n);
    nodes.forEach(node => node.tiles.forEach(i => { pos[i] = node.pos; }));
    return pos;
}
/** 保持逐张符的接口：同丹各符共享链位置。 */
export function chainPositions(els, ke = false) {
    return tilePositions(chainNodes(els, ke), els.length);
}
export function analyze(els, wilds = {}) {
    const ling = els.map((_, i) => !!wilds.ling?.[i]);
    // 同元：灵符同时算作每一种元素（火 火 木 木 灵 → 火3 木3）。
    const natural = new Map();
    els.forEach((el, i) => { if (el && !ling[i])
        natural.set(el, (natural.get(el) ?? 0) + 1); });
    const lingN = ling.filter(Boolean).length;
    const setEls = natural.size ? [...natural.entries()] : lingN ? [[els.find((e, i) => ling[i] && e), 0]] : [];
    const sets = setEls.map(([el, n]) => ({ el, size: n + lingN })).filter(x => x.size >= 2).sort((a, b) => b.size - a.size);
    const s = sets.map(x => x.size);
    const distinct = new Set(els.filter(Boolean)).size;
    const nodes = chainNodes(els, !!wilds.keLink);
    const chainPos = tilePositions(nodes, els.length);
    const chain = Math.max(0, ...nodes.map(node => node.pos));
    const linkN = nodes.filter(node => node.pos > 1).length;
    const picks = [
        best([s[0] >= 5, 'wulei'], [s[0] >= 4 && s[1] >= 4, 'sixiang2'], [s[0] === 4, 'sixiang'], [s[0] >= 3 && s[1] >= 3, 'sancai2'], [s[0] === 3 && s[1] === 2, 'mantang'], [s[0] === 3, 'sancai'], [s[0] === 2 && s[1] === 2, 'liangyi'], [s[0] === 2, 'shuangyuan']),
        best([chain >= 5, 'shengsheng'], [chain === 4, 'sisheng'], [distinct >= 5, 'wuxing'], [chain === 3, 'sansheng'], [chain === 2, 'xiangsheng']),
    ].filter(Boolean);
    const yaku = picks.map(id => ({ id, fan: YAKU[id].fan }));
    const tian = null;
    const head = tian ?? [...yaku].sort((a, b) => b.fan - a.fan)[0];
    return { els, sets, distinct, nodes, chainPos, chain, links: linkN, yaku, tian, combo: head?.id ?? 'san' };
}
/**
 * Every way to read the cast: 灵符 may be any element, 烛阴符 火 or 水.
 * The scorer keeps whichever reading hits hardest.
 */
export function assignments(tiles) {
    const elChoices = tiles.map(t => (t.el === 'zhuo' ? [null] : t.mod === 'ling' ? [...ELEMENTS] : t.sp === 'zhuyin' ? ['huo', 'shui'] : [t.el]));
    const valChoices = tiles.map(t => (t.el === 'zhuo' ? [0] : [t.v]));
    let out = [{ els: [], vals: [] }];
    tiles.forEach((_, i) => {
        out = out.flatMap(o => elChoices[i].flatMap(el => valChoices[i].map(v => ({ els: [...o.els, el], vals: [...o.vals, v] }))));
    });
    return out;
}
export const COMBOS = {
    san: { name: '散招', alias: '散牌', tier: 0 },
    ...Object.fromEntries(YAKU_ORDER.map(id => [id, { name: YAKU[id].name, alias: YAKU[id].alias, tier: YAKU[id].path === 'tian' ? 6 : YAKU[id].fan >= 8 ? 5 : YAKU[id].fan >= 5 ? 4 : YAKU[id].fan >= 3 ? 3 : YAKU[id].fan >= 2 ? 2 : 1 }])),
};
/** Tier of a whole cast by its 役番 (stamp size, 剑意, bot thresholds). */
export function fanTier(fan, tian) {
    if (tian)
        return 6;
    return fan >= 12 ? 5 : fan >= 8 ? 4 : fan >= 5 ? 3 : fan >= 3 ? 2 : fan >= 1 ? 1 : 0;
}
