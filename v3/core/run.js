import { cast as battleCast, discardTiles, startBattle } from './battle.js';
import { FATE, METHOD, RELIC, RELICS, RELIC_PRICE, TALENT, TALENTS, TALENT_TIER_ODDS, VOW } from './content.js';
import { ELEMENTS } from './elements.js';
import { ENEMIES, ENEMY } from './enemies.js';
import { EVENTS, EVENT } from './events.js';
import { PATTERN_ORDER } from './patterns.js';
import { BONDS, BOSS_STORY, ENDING } from './story.js';
import { cleanPacts, pactHeat, pactRank } from './pacts.js';
import { SIGNATURE, SPECIALS } from './content.js';
import { chance, int, next, pick, sample, seedFrom } from './rng.js';
export const SAVE_KEY = 'shanhai-v3-run';
export const MAX_RELIC_SLOTS = 8;
export function createRun(opts) {
    const seed = opts.seed ?? Math.random().toString(36).slice(2, 10);
    const method = METHOD[opts.method] ?? METHOD.yangjian;
    const pacts = cleanPacts(opts.pacts);
    const run = {
        version: 3, seed, rng: { state: seedFrom(seed) }, method: method.id, heat: pactHeat(pacts),
        act: 1, map: [], at: null, visited: [], hp: method.hp, maxHp: method.hp, gold: 30,
        bag: [], nextUid: 1, relics: [], relicSlots: 5,
        patternLv: Object.fromEntries(PATTERN_ORDER.map(id => [id, 1])),
        talents: [], vow: null, realm: 0, screen: { name: 'story', act: 1 }, battle: null,
        stats: { bestHit: 0, kills: 0, casts: 0, turns: 0, biggestPattern: null, floors: 0 }, log: [],
        plan: [], bonds: {}, deeds: [], ending: null,
        pacts, unlocks: [...new Set(opts.unlocks ?? [])], endless: 0, daily: opts.daily ?? null,
    };
    run.plan = pactRank(run, 'lone') ? [] : sample(run.rng, BONDS, 2).map(b => b.id);
    for (const el of ELEMENTS)
        for (let v = 1; v <= 5; v += 1)
            addTile(run, { el, v });
    for (const tile of method.extra)
        addTile(run, tile);
    const sp = Object.values(SPECIALS).find(x => x.method === method.id);
    if (sp)
        for (let i = 0; i < 2; i += 1)
            addTile(run, { el: sp.el, v: sp.v, sp: sp.id });
    applyStartPerks(run);
    applyFate(run, opts.fate ?? null, opts.fateEl ?? null);
    run.map = generateMap(run, 1);
    return run;
}
/** Every 灵石 the player pays at a shop or reward screen goes through here (点石成金 counts it). */
export function spend(run, amount) {
    run.gold -= amount;
    if (!run.talents.includes('dianshi'))
        return;
    const c = (run.counters ??= {});
    c.spent = (c.spent ?? 0) + amount;
    while (c.spent >= 50) {
        c.spent -= 50;
        const top = run.bag.filter(t => t.el !== 'zhuo').sort((a, b) => b.v - a.v)[0];
        if (top)
            top.v += 3;
    }
}
export const unlocked = (run, id) => run.unlocks?.includes(id) ?? false;
export const mastery = (run, level) => unlocked(run, `m:${run.method}:${level}`);
/** 道树 and 道行 perks, plus the 浊世 clause. All decided before the first node. */
function applyStartPerks(run) {
    if (unlocked(run, 'gold1'))
        run.gold += 30;
    if (unlocked(run, 'ling1'))
        addTile(run, { el: pick(run.rng, ELEMENTS), v: 4, mod: 'ling' });
    if (unlocked(run, 'pattern1')) {
        run.patternLv.yuan += 1;
        run.patternLv.sheng += 1;
    }
    if (unlocked(run, 'slot1'))
        run.relicSlots += 1;
    if (mastery(run, 3))
        addTile(run, { el: METHOD[run.method].el, v: 5, mod: 'ling' });
    if (mastery(run, 4) && SIGNATURE[run.method])
        run.relics.push(SIGNATURE[run.method]);
    for (let i = 0; i < 2 * pactRank(run, 'murk'); i += 1)
        addTile(run, { el: 'zhuo', v: 0 });
}
/** 命格：开局改写的规则。 */
export const fateIs = (run, id) => run.fate === id;
/** 化境：突破到金丹（第二次突破）起生效。 */
export const fateAwake = (run, id) => run.fate === id && run.realm >= 2;
function applyFate(run, fate, el) {
    if (!fate || !FATE[fate])
        return;
    run.fate = fate;
    if (fate === 'pianku') {
        run.fateEl = el && ELEMENTS.includes(el) ? el : METHOD[run.method].el;
        for (let v = 1; v <= 5; v += 1)
            addTile(run, { el: run.fateEl, v });
    }
    if (fate === 'guxing') {
        run.relicSlots = 3;
        run.relics = run.relics.slice(0, 3);
    }
    if (fate === 'tianyan') {
        run.maxHp = Math.round(run.maxHp * 0.85);
        run.hp = Math.min(run.hp, run.maxHp);
    }
    (run.counters ??= {}).reshape = fate === 'tianyan' ? 1 : 0;
}
export function addTile(run, tile) {
    const made = { ...tile, uid: run.nextUid++ };
    run.bag.push(made);
    return made;
}
// —— Map ——
export function generateMap(run, act) {
    const rng = run.rng;
    const nodes = [];
    const id = (row, col) => `${act}-${row}-${col}`;
    if (act === 5) {
        nodes.push({ id: id(0, 0), row: 0, col: 0, kind: 'shop', next: [id(1, 1)] });
        nodes.push({ id: id(0, 2), row: 0, col: 2, kind: 'rest', next: [id(1, 1)] });
        nodes.push({ id: id(1, 1), row: 1, col: 1, kind: 'boss', next: [], enemy: 'tianjie' });
        return nodes;
    }
    if (act > 5)
        return endlessMap(run, act);
    const pool = ENEMIES.filter(e => e.act === act && e.rank === 'fight').map(e => e.id);
    const elite = ENEMIES.find(e => e.act === act && e.rank === 'elite').id;
    const boss = ENEMIES.find(e => e.act === act && e.rank === 'boss').id;
    let shops = 0, elites = 0;
    for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 3; col += 1) {
            let kind;
            if (row === 0)
                kind = 'fight';
            else if (row === 4)
                kind = col === 1 ? 'rest' : pick(rng, ['rest', 'shop', 'event']);
            else {
                const options = [['fight', 44], ['event', 26], ['rest', 8], ['shop', shops < 1 ? 10 : 0], ['elite', row >= 2 && elites < 2 ? 14 : 0]];
                const total = options.reduce((s, [, w]) => s + w, 0);
                let roll = next(rng) * total;
                kind = 'fight';
                for (const [k, w] of options) {
                    roll -= w;
                    if (roll <= 0) {
                        kind = k;
                        break;
                    }
                }
            }
            if (kind === 'shop')
                shops += 1;
            if (kind === 'elite')
                elites += 1;
            const node = { id: id(row, col), row, col, kind, next: [] };
            if (kind === 'fight')
                node.enemy = pick(rng, pool);
            if (kind === 'elite')
                node.enemy = elite;
            if (kind === 'event')
                node.event = pick(rng, EVENTS.filter(e => (!e.once || !run.log.includes(`event:${e.id}`)) && (!e.unlock || unlocked(run, e.unlock)))).id;
            nodes.push(node);
        }
    }
    // Guarantee one elite per act for relic access.
    if (!elites) {
        const candidate = nodes.find(n => n.row === 3 && n.kind === 'fight') ?? nodes.find(n => (n.row === 2 || n.row === 3) && n.kind !== 'shop');
        if (candidate) {
            candidate.kind = 'elite';
            candidate.enemy = elite;
            delete candidate.event;
        }
    }
    if (pactRank(run, 'elite')) {
        const extra = nodes.find(n => n.row === 1 && n.kind === 'fight') ?? nodes.find(n => n.row === 1 && n.kind !== 'shop');
        if (extra) {
            extra.kind = 'elite';
            extra.enemy = elite;
            delete extra.event;
        }
    }
    // 因缘: the planned thread's meeting sits on row 2 — reachable, but a path can skip it.
    const thread = act <= 2 ? run.plan?.[act - 1] : run.plan?.[act - 3];
    const meet = !thread ? null : act <= 2 ? `bond-${thread}-1` : run.bonds?.[thread] === 'kept' ? `bond-${thread}-2` : null;
    if (meet) {
        const spots = sample(rng, nodes.filter(n => n.row === 2 && n.kind !== 'elite'), unlocked(run, 'guide') ? 2 : 1);
        for (const node of spots) {
            node.kind = 'event';
            node.event = meet;
            delete node.enemy;
        }
    }
    nodes.push({ id: id(5, 1), row: 5, col: 1, kind: 'boss', next: [], enemy: boss });
    for (const node of nodes) {
        if (node.row === 4) {
            node.next = [id(5, 1)];
            continue;
        }
        if (node.row === 5)
            continue;
        const targets = new Set([id(node.row + 1, node.col)]);
        for (const d of [-1, 1]) {
            const col = node.col + d;
            if (col >= 0 && col <= 2 && chance(rng, 0.35))
                targets.add(id(node.row + 1, col));
        }
        node.next = [...targets];
    }
    return nodes;
}
/** 无尽劫: elite → (rest | shop | event) → a random boss, deeper each layer. */
function endlessMap(run, act) {
    const rng = run.rng;
    const id = (row, col) => `${act}-${row}-${col}`;
    const elites = ENEMIES.filter(e => e.rank === 'elite').map(e => e.id);
    const bosses = ENEMIES.filter(e => e.rank === 'boss').map(e => e.id);
    const mid = ['rest', 'shop', 'event'];
    return [
        { id: id(0, 1), row: 0, col: 1, kind: 'elite', enemy: pick(rng, elites), next: mid.map((_, i) => id(1, i)) },
        ...mid.map((kind, i) => ({ id: id(1, i), row: 1, col: i, kind, next: [id(2, 1)], ...(kind === 'event' ? { event: pick(rng, EVENTS.filter(e => !e.once)).id } : {}) })),
        { id: id(2, 1), row: 2, col: 1, kind: 'boss', enemy: pick(rng, bosses), next: [] },
    ];
}
export function enterEndless(run) {
    if (run.screen.name !== 'won')
        return false;
    run.endless = 1;
    run.log = run.log.filter(l => l !== 'finished');
    run.at = null;
    run.map = generateMap(run, 5 + run.endless);
    run.hp = run.maxHp;
    run.screen = { name: 'map' };
    run.deeds.push('渡劫之后，你没有停下，走进了无尽天劫。');
    return true;
}
export const nodeById = (run, id) => run.map.find(node => node.id === id);
export function reachable(run) {
    if (!run.at)
        return run.map.filter(node => node.row === 0);
    const here = nodeById(run, run.at);
    return (here?.next ?? []).map(id => nodeById(run, id)).filter(Boolean);
}
export function enterNode(run, id) {
    if (run.screen.name !== 'map')
        return false;
    const node = reachable(run).find(n => n.id === id);
    if (!node)
        return false;
    run.at = node.id;
    run.visited.push(node.id);
    run.stats.floors += 1;
    switch (node.kind) {
        case 'fight':
        case 'elite':
        case 'boss':
            run.battle = startBattle(run, node.enemy, node.kind);
            run.screen = { name: 'battle' };
            break;
        case 'event':
            run.log.push(`event:${node.event}`);
            run.screen = { name: 'event', event: node.event };
            break;
        case 'shop':
            run.screen = makeShop(run);
            break;
        case 'rest':
            run.screen = { name: 'rest' };
            break;
    }
    return true;
}
// —— Battle wrappers ——
export function castTiles(run, uids, rage) {
    if (run.screen.name !== 'battle' || !run.battle)
        return null;
    const outcome = battleCast(run, run.battle, uids, rage);
    if (outcome)
        syncAfterBattleStep(run);
    return outcome;
}
export function discard(run, uids) {
    if (run.screen.name !== 'battle' || !run.battle)
        return [];
    return discardTiles(run, run.battle, uids);
}
function syncAfterBattleStep(run) {
    const battle = run.battle;
    run.hp = Math.max(0, Math.min(battle.player.hp, run.maxHp));
}
/** Called by the UI once the win/loss animation has played. */
export function concludeBattle(run) {
    const battle = run.battle;
    if (!battle || battle.outcome === 'fighting')
        return;
    journal(run, battle);
    if (battle.outcome === 'lost') {
        run.hp = 0;
        run.screen = { name: 'lost' };
        return;
    }
    run.stats.kills += 1;
    // 行险: a clean win pays more each time in a row; a bad scrape resets it.
    if (run.talents.includes('xingxian')) {
        const c = (run.counters ??= {});
        const lost = (battle.stacks.startHp ?? battle.player.hp) - battle.player.hp;
        if (lost <= 0) {
            c.streak = (c.streak ?? 0) + 1;
            run.gold += 10 * c.streak;
        }
        else if (lost > battle.player.maxHp / 2)
            c.streak = 0;
    }
    if (run.method === 'yangjian')
        run.swordsKept = Math.floor(battle.swords / 2);
    run.hp = Math.max(1, Math.min(run.maxHp, battle.player.hp));
    if (run.relics.includes('wenyang')) {
        const top = run.bag.filter(t => t.el !== 'zhuo').sort((a, b) => b.v - a.v)[0];
        if (top)
            top.v += 2;
    }
    const heal = RELICS.filter(r => run.relics.includes(r.id)).reduce((s, r) => s + (r.flags?.afterHeal ?? 0), 0);
    if (heal)
        run.hp = Math.min(run.maxHp, run.hp + heal);
    const kind = battle.kind;
    const enemyId = battle.enemyId;
    run.battle = null;
    if (kind === 'boss') {
        run.log.push(`boss:${enemyId}`);
        if (!run.endless)
            run.deeds.push(BOSS_DEED[enemyId] ?? `你击败了${ENEMY[enemyId].name}。`);
    }
    if (kind === 'boss' && run.act === 5 && !run.endless) {
        run.screen = { name: 'ending' };
        return;
    }
    const extraGold = RELICS.filter(r => run.relics.includes(r.id)).reduce((s, r) => s + (r.flags?.afterGold ?? 0), 0);
    const gold = ((kind === 'boss' ? 60 : kind === 'elite' ? 30 : int(run.rng, 12, 18)) + extraGold) * (fateIs(run, 'sanxiu') ? 2 : 1);
    run.gold += gold;
    const options = rewardOptions(run, fateIs(run, 'bailian') ? 2 : 3);
    const relicOptions = fateIs(run, 'sanxiu') ? [] : kind === 'fight' ? (chance(run.rng, 0.12) ? relicChoices(run, 1, kind) : []) : relicChoices(run, 3 + (unlocked(run, 'boss1') ? 1 : 0), kind);
    const next = kind !== 'boss' ? 'map' : run.endless ? 'endless' : 'breakthrough';
    run.screen = { name: 'reward', gold, options, relicOptions, picked: false, relicPicked: relicOptions.length === 0, next, story: kind === 'boss' && !run.endless ? BOSS_STORY[enemyId]?.after : undefined };
}
function journal(run, battle) {
    const s = battle.stacks;
    (run.journal ??= []).push({
        act: run.act, enemy: battle.enemyId, kind: battle.kind, won: battle.outcome === 'won',
        hpIn: s.startHp ?? run.hp, hpOut: Math.max(0, battle.player.hp), maxHp: battle.player.maxHp,
        turns: battle.turn, casts: battle.castCount, best: battle.bestHit,
        taken: { enemy: s.tkEnemy ?? 0, burn: s.tkBurn ?? 0, trib: s.tkTrib ?? 0, blood: s.tkBlood ?? 0 }, blocked: s.tkBlocked ?? 0,
        enemyMax: battle.enemy.maxHp, enemyLeft: Math.max(0, battle.enemy.hp),
    });
}
const BOSS_DEED = {
    gonggong: '你在潮口击退了共工的遗影，知道了水是被叫上山的。',
    xiangliu: '你在断桥斩了相柳，发现推着河倒流的是火。',
    xingtian: '你在火海两次击倒刑天，听他说了山顶的劫。',
    zhulong: '你让烛龙闭上了眼，天门在黑暗里打开。',
    tianjie: '你在天门渡过了渡厄真人炼了三百年的劫。',
};
export function endingAvailable(run, id) {
    const def = ENDING[id];
    return !!def && (!def.requires || def.requires(run));
}
export function chooseEnding(run, id) {
    if (run.screen.name !== 'ending' || !endingAvailable(run, id))
        return false;
    run.ending = id;
    run.deeds.push(`你选择了「${ENDING[id].name}」。`);
    run.screen = { name: 'won' };
    return true;
}
export function leaveStory(run) { if (run.screen.name === 'story')
    run.screen = { name: 'map' }; }
// —— Rewards ——
/** 普通符纹（宝、倍）常见，高级符纹（灵、幻）少见；品质越高，高级的比例越高。 */
export const RARE_MODS = ['ling'];
function pickMod(run, quality = 0) {
    const rare = 0.2 + 0.1 * Math.max(0, quality);
    return chance(run.rng, rare) ? pick(run.rng, RARE_MODS) : pick(run.rng, ['bao', 'lei']);
}
export function randomTile(run, quality = 0) {
    const el = pick(run.rng, ELEMENTS);
    const v = Math.min(9, int(run.rng, 3, 5) + Math.min(4, run.act - 1) + quality);
    const mod = chance(run.rng, 0.6 + quality * 0.1) ? pickMod(run, quality) : undefined;
    return mod ? { el, v, mod } : { el, v };
}
export function rewardOptions(run, n) {
    const out = [];
    const sp = Object.values(SPECIALS).find(x => x.method === run.method);
    if (sp && chance(run.rng, 0.25))
        out.push({ type: 'tile', tile: { el: sp.el, v: sp.v + Math.min(4, run.act - 1), sp: sp.id } });
    const patterns = sample(run.rng, PATTERN_ORDER, 2);
    out.push({ type: 'tile', tile: randomTile(run) });
    out.push({ type: 'pattern', pattern: patterns[0] });
    out.push(chance(run.rng, 0.5) ? { type: 'tile', tile: randomTile(run, 1) } : { type: 'pattern', pattern: patterns[1] });
    return out.slice(0, n);
}
function rarityWeights(kind) {
    if (kind === 'boss')
        return { common: 15, rare: 50, legend: 35 };
    if (kind === 'elite')
        return { common: 45, rare: 45, legend: 10 };
    if (kind === 'shop')
        return { common: 55, rare: 35, legend: 10 };
    return { common: 70, rare: 27, legend: 3 };
}
export function relicChoices(run, n, kind) {
    const weights = rarityWeights(kind);
    const pool = RELICS.filter(r => !run.relics.includes(r.id) && relicAvailable(run, r.id));
    return sample(run.rng, pool, n, r => (r.method ? 4 : 1) * weights[r.rarity]).map(r => ({ type: 'relic', relic: r.id }));
}
/** 道树 gates new relics; 本命法宝 only appear for their method after 道行 2. */
export function relicAvailable(run, id) {
    const def = RELIC[id];
    if (!def)
        return false;
    if (def.method)
        return def.method === run.method && mastery(run, 2);
    return !def.unlock || unlocked(run, def.unlock);
}
export function applyOption(run, option, replaceSlot) {
    switch (option.type) {
        case 'tile':
            addTile(run, option.tile);
            return true;
        case 'pattern':
            run.patternLv[option.pattern] = (run.patternLv[option.pattern] ?? 1) + 1;
            return true;
        case 'relic': return gainRelic(run, option.relic, replaceSlot);
        case 'talent': return gainTalent(run, option.talent);
        case 'heal':
            run.hp = Math.min(run.maxHp, run.hp + option.amount);
            return true;
        case 'gold':
            run.gold += option.amount;
            return true;
    }
}
export function gainRelic(run, id, replaceSlot) {
    const def = RELIC[id];
    if (!def || run.relics.includes(id))
        return false;
    if (run.relics.length >= run.relicSlots) {
        if (replaceSlot === undefined || replaceSlot < 0 || replaceSlot >= run.relics.length)
            return false;
        run.relics[replaceSlot] = id;
    }
    else
        run.relics.push(id);
    def.onGain?.(run);
    return true;
}
export function moveRelic(run, from, to) {
    if (from < 0 || from >= run.relics.length || to < 0 || to >= run.relics.length || from === to)
        return;
    const [item] = run.relics.splice(from, 1);
    run.relics.splice(to, 0, item);
}
export function gainTalent(run, id) {
    if (!TALENT[id] || run.talents.includes(id))
        return false;
    run.talents.push(id);
    if (id === 'dongtian')
        run.relicSlots = Math.min(MAX_RELIC_SLOTS, run.relicSlots + 1);
    if (id === 'wanfa')
        for (const key of PATTERN_ORDER)
            run.patternLv[key] += 1;
    if (id === 'changsheng') {
        run.maxHp += 40;
        run.hp = run.maxHp;
    }
    if (id === 'guiyi') {
        const candidates = run.bag.filter(t => t.el !== 'zhuo' && t.mod !== 'ling');
        for (const tile of sample(run.rng, candidates, 4))
            tile.mod = 'ling';
    }
    return true;
}
export function takeReward(run, group, index, replaceSlot) {
    const screen = run.screen;
    if (screen.name !== 'reward')
        return false;
    if (group === 'main') {
        if (screen.picked || !screen.options[index])
            return false;
        applyOption(run, screen.options[index]);
        screen.picked = true;
    }
    else {
        if (screen.relicPicked || !screen.relicOptions[index])
            return false;
        if (!applyOption(run, screen.relicOptions[index], replaceSlot))
            return false;
        screen.relicPicked = true;
    }
    return true;
}
/** 换一批: pay to see three different main rewards, once per reward screen. */
export const rerollPrice = (run) => 10 + 5 * Math.min(5, run.act);
export function rerollReward(run) {
    const screen = run.screen;
    if (screen.name !== 'reward' || screen.picked || screen.rerolled || !screen.options.length || run.gold < rerollPrice(run))
        return false;
    spend(run, rerollPrice(run));
    screen.options = rewardOptions(run, 3);
    screen.rerolled = true;
    run.stats.rerolls = (run.stats.rerolls ?? 0) + 1;
    return true;
}
/** 不取: leaving the main reward untouched keeps the bag lean and pays a little. */
export const skipGold = (run) => 6 + 2 * Math.min(5, run.act);
export function leaveReward(run) {
    const screen = run.screen;
    if (screen.name !== 'reward')
        return;
    if (!screen.picked && screen.options.length) {
        run.gold += skipGold(run);
        run.stats.skips = (run.stats.skips ?? 0) + 1;
        screen.picked = true;
    }
    if (screen.next === 'endless') {
        // 劫后悟道: every second layer cleared offers one more 天赋.
        if (run.endless % 2 === 0) {
            run.screen = { name: 'breakthrough', options: talentChoices(run, 4).map(id => ({ type: 'talent', talent: id })), endless: true };
            return;
        }
        nextEndless(run);
        return;
    }
    if (screen.next === 'breakthrough') {
        run.realm += 1;
        if (run.realm === 2 && fateIs(run, 'guxing'))
            run.relicSlots = Math.min(MAX_RELIC_SLOTS, run.relicSlots + 1);
        run.maxHp += 25;
        run.hp = run.maxHp;
        run.screen = { name: 'breakthrough', options: talentChoices(run, run.act).map(id => ({ type: 'talent', talent: id })) };
        return;
    }
    run.screen = { name: 'map' };
}
/** 突破三选一：每个选项按本幕的档位比例抽档（凡/灵/仙），不重复；第二幕起至少一个灵档以上。 */
export function talentChoices(run, act) {
    const odds = TALENT_TIER_ODDS[Math.max(1, Math.min(4, act))];
    const pool = TALENTS.filter(t => !run.talents.includes(t.id) && (!t.method || t.method.split(',').includes(run.method)) && !(t.id === 'dongtian' && run.relicSlots >= MAX_RELIC_SLOTS));
    const order = ['common', 'rare', 'legend'];
    const out = [];
    for (let i = 0; i < 3; i += 1) {
        let tier = pickWeighted(run, odds);
        if (i === 2 && act >= 2 && out.every(id => TALENT[id].tier === 'common') && tier === 'common')
            tier = 'rare';
        // Empty tier: try the neighbours, nearest first.
        const idx = order.indexOf(tier);
        const tries = [tier, order[idx + 1], order[idx - 1], order[idx + 2], order[idx - 2]].filter(Boolean);
        for (const t of tries) {
            const left = pool.filter(x => x.tier === t && !out.includes(x.id));
            if (left.length) {
                out.push(pick(run.rng, left).id);
                break;
            }
        }
    }
    return out;
}
function pickWeighted(run, weights) {
    const entries = Object.entries(weights);
    let roll = next(run.rng) * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) {
        roll -= w;
        if (roll <= 0)
            return k;
    }
    return entries[entries.length - 1][0];
}
export function chooseBreakthrough(run, index) {
    const screen = run.screen;
    if (screen.name !== 'breakthrough' || !screen.options[index])
        return;
    applyOption(run, screen.options[index]);
    if (screen.endless)
        nextEndless(run);
    else
        advanceAct(run);
}
function nextEndless(run) {
    run.endless += 1;
    run.at = null;
    run.map = generateMap(run, 5 + run.endless);
    run.screen = { name: 'map' };
}
export function advanceAct(run) {
    run.act += 1;
    if (fateIs(run, 'tianyan'))
        (run.counters ??= {}).reshape = fateAwake(run, 'tianyan') ? 2 : 1;
    run.at = null;
    run.map = generateMap(run, run.act);
    run.screen = { name: 'story', act: run.act };
}
// —— Shop ——
export function optionPrice(run, option) {
    const discount = fateIs(run, 'sanxiu') ? 0.7 : 1;
    switch (option.type) {
        case 'relic': return Math.round(RELIC_PRICE[RELIC[option.relic].rarity] * discount * (pactRank(run, 'miser') ? 1.3 : 1));
        case 'tile': return Math.round((30 + (option.tile.mod ? (RARE_MODS.includes(option.tile.mod) ? 35 : 15) : 0) + option.tile.v * 2) * discount * (pactRank(run, 'miser') ? 1.3 : 1));
        case 'pattern': return Math.round(45 * discount * (pactRank(run, 'miser') ? 1.3 : 1));
        case 'heal': return Math.round(30 * discount * (pactRank(run, 'miser') ? 1.3 : 1));
        default: return 0;
    }
}
function makeShop(run) {
    const options = [
        ...relicChoices(run, fateAwake(run, 'sanxiu') ? 4 : 3, 'shop'),
        { type: 'tile', tile: randomTile(run, 1) }, { type: 'tile', tile: randomTile(run, 1) }, { type: 'tile', tile: randomTile(run, 2) },
        ...sample(run.rng, PATTERN_ORDER, 2).map(pattern => ({ type: 'pattern', pattern })),
        { type: 'heal', amount: Math.round(run.maxHp * 0.35) },
    ];
    const items = options.map(option => ({ option, price: optionPrice(run, option), sold: false }));
    return { name: 'shop', items, removePrice: Math.round((40 + 15 * run.log.filter(l => l === 'removed').length) * (fateIs(run, 'sanxiu') ? 0.7 : 1)), removed: false };
}
export function buy(run, index, replaceSlot) {
    const screen = run.screen;
    if (screen.name !== 'shop')
        return false;
    const item = screen.items[index];
    if (!item || item.sold || run.gold < item.price)
        return false;
    if (!applyOption(run, item.option, replaceSlot))
        return false;
    spend(run, item.price);
    item.sold = true;
    return true;
}
/** 补货: once per shop, pay to replace everything still on the shelf. */
export const restockPrice = (run) => Math.round(25 * (pactRank(run, 'miser') ? 1.3 : 1) * (fateIs(run, 'sanxiu') ? 0.7 : 1));
export function restockShop(run) {
    const screen = run.screen;
    if (screen.name !== 'shop' || screen.restocked || run.gold < restockPrice(run))
        return false;
    spend(run, restockPrice(run));
    const fresh = makeShop(run);
    screen.items = screen.items.map((item, i) => (item.sold ? item : fresh.items[i]));
    screen.restocked = true;
    return true;
}
export function startRemove(run) {
    const screen = run.screen;
    if (screen.name !== 'shop' || run.gold < screen.removePrice)
        return;
    run.screen = { name: 'pick-tile', purpose: 'remove', count: 1, then: { ...screen }, title: `净符 · 花费 ${screen.removePrice} 灵石移除一枚符（可反复购买，每次 +20）`, price: screen.removePrice };
}
/** Instead of taking the main reward, purge one tile from the bag. */
export function rewardPurge(run) {
    const screen = run.screen;
    if (screen.name !== 'reward' || screen.picked)
        return;
    run.screen = { name: 'pick-tile', purpose: 'remove', count: 1, then: { ...screen, picked: true }, title: '净符 · 舍下这次奖励，移除一枚符' };
}
export function leaveShop(run) { if (run.screen.name === 'shop')
    run.screen = { name: 'map' }; }
// —— Rest ——
// —— 三张归一 ——
/** Groups of three or more tiles sharing element and value (the only tiles 三张归一 accepts). */
export function mergeGroups(run) {
    const groups = new Map();
    for (const t of run.bag)
        if (t.el !== 'zhuo')
            groups.set(`${t.el}:${t.v}`, [...(groups.get(`${t.el}:${t.v}`) ?? []), t]);
    return [...groups.values()].filter(g => g.length >= 3);
}
export const mergePrice = (run) => Math.round(35 * (pactRank(run, 'miser') ? 1.3 : 1) * (fateIs(run, 'sanxiu') ? 0.7 : 1));
const MERGE_TITLE = '三张归一 · 选三张同元素、同点数的符，合成一张：点数 ×2，保留最好的符纹';
export function startMerge(run) {
    const screen = run.screen;
    if (screen.name !== 'shop' || screen.merged || run.gold < mergePrice(run) || !mergeGroups(run).length)
        return;
    run.screen = { name: 'pick-tile', purpose: 'merge', count: 3, then: { ...screen }, title: `${MERGE_TITLE}（花费 ${mergePrice(run)} 灵石）`, price: mergePrice(run) };
}
const MOD_RANK = { ling: 3, bao: 2, lei: 2 };
/** 百炼命: the 洞府 allows a second action. */
function restAfter(run) {
    const cur = run.screen;
    return fateIs(run, 'bailian') && cur.name === 'rest' && !cur.used ? { name: 'rest', used: 1 } : { name: 'rest', done: true };
}
export function restChoose(run, choice, pattern) {
    if (run.screen.name !== 'rest' || run.screen.done)
        return;
    const after = restAfter(run);
    const plus = fateIs(run, 'bailian') ? '（百炼：再 +2）' : '';
    if (choice === 'heal') {
        run.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * restHeal(run)));
        run.screen = after;
    }
    if (choice === 'forge')
        run.screen = { name: 'pick-tile', purpose: 'upgrade', count: 1, then: after, title: `炼符 · 选一枚符：点数 +3${plus}，并附上一道符纹` };
    if (choice === 'purge')
        run.screen = { name: 'pick-tile', purpose: 'remove', count: 2, then: after, title: '净符 · 选至多两枚符永久移除' };
    if (choice === 'merge' && mergeGroups(run).length)
        run.screen = { name: 'pick-tile', purpose: 'merge', count: 3, then: after, title: MERGE_TITLE + plus };
    if (choice === 'fuse')
        run.screen = { name: 'pick-tile', purpose: 'fuse', count: 2, then: after, title: `熔符 · 选两枚符熔成一枚：点数相加${plus}，元素取第一枚，并成宝符` };
    if (choice === 'insight' && pattern) {
        run.patternLv[pattern] += 1;
        run.screen = after;
    }
}
export const restHeal = (run) => (unlocked(run, 'rest1') ? 0.55 : 0.4);
export function insightChoices(run) {
    const seed = { state: seedFrom(`${run.seed}:${run.at}`) };
    return sample(seed, PATTERN_ORDER, 3);
}
export function leaveRest(run) { if (run.screen.name === 'rest')
    run.screen = { name: 'map' }; }
// —— Tile picking (remove / upgrade / reforge) ——
export function pickTiles(run, uids) {
    const screen = run.screen;
    if (screen.name !== 'pick-tile')
        return false;
    if (!uids.length || uids.length > screen.count)
        return false;
    const tiles = uids.map(uid => run.bag.find(t => t.uid === uid)).filter(Boolean);
    if (tiles.length !== uids.length)
        return false;
    if (screen.purpose === 'remove') {
        if (screen.then.name === 'shop' && screen.price) {
            if (run.gold < screen.price)
                return false;
            spend(run, screen.price);
            run.log.push('removed');
            screen.then.removePrice = screen.price + 20;
        }
        run.bag = run.bag.filter(t => !uids.includes(t.uid));
    }
    const craft = fateIs(run, 'bailian') ? 2 : 0;
    if (screen.purpose === 'upgrade')
        for (const tile of tiles) {
            tile.v += 3 + craft;
            if (tile.el === 'zhuo')
                continue;
            if (fateAwake(run, 'bailian') && !RARE_MODS.includes(tile.mod))
                tile.mod = pick(run.rng, RARE_MODS);
            else if (!tile.mod)
                tile.mod = pickMod(run, 1);
        }
    if (screen.purpose === 'reforge')
        for (const tile of tiles)
            if (tile.el !== 'zhuo')
                tile.mod = 'bao';
    if (screen.purpose === 'devour') {
        if (tiles.length !== 1)
            return false;
        devour(run, tiles[0]);
    }
    if (screen.purpose === 'merge') {
        if (tiles.length !== 3 || tiles.some(t => t.el === 'zhuo' || t.el !== tiles[0].el || t.v !== tiles[0].v))
            return false;
        if (screen.price) {
            if (run.gold < screen.price)
                return false;
            spend(run, screen.price);
            screen.then.merged = true;
        }
        run.bag = run.bag.filter(t => !uids.includes(t.uid));
        const best = [...tiles].sort((a, b) => (MOD_RANK[b.mod ?? ''] ?? 0) - (MOD_RANK[a.mod ?? ''] ?? 0))[0];
        addTile(run, { el: tiles[0].el, v: tiles[0].v * 2 + craft, mod: best.mod ?? 'bao', ...(best.sp ? { sp: best.sp } : {}) });
    }
    if (screen.purpose === 'fuse') {
        if (tiles.length !== 2)
            return false;
        run.bag = run.bag.filter(t => !uids.includes(t.uid));
        const el = tiles[0].el === 'zhuo' ? tiles[1].el : tiles[0].el;
        addTile(run, el === 'zhuo' ? { el, v: 0 } : { el, v: tiles[0].v + tiles[1].v + craft, mod: 'bao' });
    }
    run.screen = screen.then;
    return true;
}
// —— 吞符命 ——
export function startDevour(run) {
    const screen = run.screen;
    if (!fateIs(run, 'tunfu') || screen.name !== 'reward' || screen.devoured || run.bag.length < 2)
        return;
    run.screen = { name: 'pick-tile', purpose: 'devour', count: 1, then: { ...screen, devoured: true }, title: '吞符 · 选一张符永久吞下：它的点数平分给同元素的其他符' };
}
function devour(run, tile) {
    run.bag = run.bag.filter(t => t.uid !== tile.uid);
    const kin = run.bag.filter(t => t.el === tile.el && t.el !== 'zhuo').sort((a, b) => b.v - a.v);
    if (!kin.length)
        return;
    const share = Math.floor(tile.v / kin.length);
    kin.forEach(t => { t.v += share; });
    kin[0].v += tile.v - share * kin.length;
    // 化境: the mark goes to the biggest tile of that element.
    if (fateAwake(run, 'tunfu') && tile.mod && (!kin[0].mod || (MOD_RANK[tile.mod] ?? 0) > (MOD_RANK[kin[0].mod] ?? 0)))
        kin[0].mod = tile.mod;
}
// —— 天眼命 ——
export const reshapeLeft = (run) => (fateIs(run, 'tianyan') ? run.counters?.reshape ?? 0 : 0);
/** Turns a not-yet-visited, non-boss/elite node into another kind (斗法、奇遇、坊市、洞府). */
export function reshapeNode(run, id, kind) {
    const node = nodeById(run, id);
    const here = run.at ? nodeById(run, run.at) : null;
    if (run.screen.name !== 'map' || !node || reshapeLeft(run) <= 0 || run.visited.includes(id) || node.kind === 'boss' || node.kind === 'elite' || node.kind === kind)
        return false;
    if (here && node.row <= here.row)
        return false;
    if (node.event?.startsWith('bond-'))
        return false;
    delete node.enemy;
    delete node.event;
    node.kind = kind;
    if (kind === 'fight')
        node.enemy = pick(run.rng, ENEMIES.filter(e => e.act === Math.min(4, run.act) && e.rank === 'fight')).id;
    if (kind === 'event')
        node.event = pick(run.rng, EVENTS.filter(e => (!e.once || !run.log.includes(`event:${e.id}`)) && (!e.unlock || unlocked(run, e.unlock)) && !e.id.startsWith('bond-'))).id;
    run.counters.reshape -= 1;
    return true;
}
export function cancelPick(run) {
    const screen = run.screen;
    if (screen.name !== 'pick-tile')
        return;
    if (screen.purpose === 'devour' && screen.then.name === 'reward') {
        run.screen = { ...screen.then, devoured: false };
        return;
    }
    if (screen.then.name === 'reward' && screen.purpose === 'remove')
        run.screen = { ...screen.then, picked: false };
    else
        run.screen = screen.then;
}
// —— Events ——
export function chooseEvent(run, index) {
    const screen = run.screen;
    if (screen.name !== 'event' || screen.resolved !== undefined)
        return;
    const def = EVENT[screen.event];
    const option = def?.options[index];
    if (!option || (option.can && !option.can(run)))
        return;
    const result = option.apply(run);
    if (typeof result === 'string')
        run.screen = { name: 'event', event: screen.event, resolved: result };
    else
        run.screen = result;
}
export function leaveEvent(run) { if (run.screen.name === 'event')
    run.screen = { name: 'map' }; }
export function applyVow(run, id) {
    if (!VOW[id] || run.vow)
        return;
    run.vow = id;
    run.deeds.push(`你在断生碑前立誓「${VOW[id].name}」。`);
    if (id === 'suidan') {
        run.maxHp = Math.round(run.maxHp * 0.6);
        run.hp = Math.min(run.hp, run.maxHp);
    }
    if (id === 'gujian') {
        run.relicSlots = Math.max(1, run.relicSlots - 2);
        run.relics = run.relics.slice(0, run.relicSlots);
        for (const key of PATTERN_ORDER)
            run.patternLv[key] += 2;
    }
}
// —— Persistence ——
export function serialize(run) { return JSON.stringify(run); }
export function deserialize(text) {
    if (!text)
        return null;
    try {
        const run = JSON.parse(text);
        if (run?.version !== 3 || !Array.isArray(run.bag) || !run.screen)
            return null;
        // Runs from before the 役 scoring are not carried over: start fresh.
        if (!run.patternLv || !PATTERN_ORDER.every(id => typeof run.patternLv[id] === 'number'))
            return null;
        // Runs saved before the story update.
        run.plan ??= [];
        run.bonds ??= {};
        run.deeds ??= [];
        run.ending ??= null;
        run.pacts ??= {};
        run.unlocks ??= [];
        run.endless ??= 0;
        run.daily ??= null;
        return run;
    }
    catch {
        return null;
    }
}
export const elName = (el) => (el === 'zhuo' ? '浊' : { jin: '金', mu: '木', shui: '水', huo: '火', tu: '土' }[el]);
export { ENEMY };
