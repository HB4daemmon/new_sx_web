import { cast as battleCast, discardTiles, startBattle } from './battle.js';
import { METHOD, RELIC, RELICS, RELIC_PRICE, TALENT, TALENTS, VOW } from './content.js';
import { ELEMENTS } from './elements.js';
import { ENEMIES, ENEMY } from './enemies.js';
import { EVENTS, EVENT } from './events.js';
import { PATTERN_ORDER, PATTERNS } from './patterns.js';
import { BONDS, BOSS_STORY, ENDING } from './story.js';
import { chance, int, next, pick, sample, seedFrom } from './rng.js';
export const SAVE_KEY = 'shanhai-v3-run';
export const MAX_RELIC_SLOTS = 8;
export function createRun(opts) {
    const seed = opts.seed ?? Math.random().toString(36).slice(2, 10);
    const method = METHOD[opts.method] ?? METHOD.yangjian;
    const run = {
        version: 3, seed, rng: { state: seedFrom(seed) }, method: method.id, heat: opts.heat ?? 0,
        act: 1, map: [], at: null, visited: [], hp: method.hp, maxHp: method.hp, gold: 30,
        bag: [], nextUid: 1, relics: [], relicSlots: 5,
        patternLv: Object.fromEntries(PATTERN_ORDER.map(id => [id, 1])),
        talents: [], vow: null, realm: 0, screen: { name: 'story', act: 1 }, battle: null,
        stats: { bestHit: 0, kills: 0, casts: 0, turns: 0, biggestPattern: null, floors: 0 }, log: [],
        plan: [], bonds: {}, deeds: [], ending: null,
    };
    run.plan = sample(run.rng, BONDS, 2).map(b => b.id);
    for (const el of ELEMENTS)
        for (let v = 1; v <= 5; v += 1)
            addTile(run, { el, v });
    for (const tile of method.extra)
        addTile(run, tile);
    run.map = generateMap(run, 1);
    return run;
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
                node.event = pick(rng, EVENTS.filter(e => !e.once || !run.log.includes(`event:${e.id}`))).id;
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
    // 因缘: the planned thread's meeting sits on row 2 — reachable, but a path can skip it.
    const thread = act <= 2 ? run.plan?.[act - 1] : run.plan?.[act - 3];
    const meet = !thread ? null : act <= 2 ? `bond-${thread}-1` : run.bonds?.[thread] === 'kept' ? `bond-${thread}-2` : null;
    if (meet) {
        const node = pick(rng, nodes.filter(n => n.row === 2 && n.kind !== 'elite'));
        if (node) {
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
    if (battle.outcome === 'lost') {
        run.hp = 0;
        run.screen = { name: 'lost' };
        return;
    }
    run.stats.kills += 1;
    run.hp = Math.max(1, Math.min(run.maxHp, battle.player.hp));
    const heal = RELICS.filter(r => run.relics.includes(r.id)).reduce((s, r) => s + (r.flags?.afterHeal ?? 0), 0);
    if (heal)
        run.hp = Math.min(run.maxHp, run.hp + heal);
    const kind = battle.kind;
    const enemyId = battle.enemyId;
    run.battle = null;
    if (kind === 'boss')
        run.deeds.push(BOSS_DEED[enemyId] ?? `你击败了${ENEMY[enemyId].name}。`);
    if (kind === 'boss' && run.act === 5) {
        run.screen = { name: 'ending' };
        return;
    }
    const extraGold = RELICS.filter(r => run.relics.includes(r.id)).reduce((s, r) => s + (r.flags?.afterGold ?? 0), 0);
    const gold = (kind === 'boss' ? 60 : kind === 'elite' ? 30 : int(run.rng, 12, 18)) + extraGold;
    run.gold += gold;
    const options = rewardOptions(run, 3);
    const relicOptions = kind === 'fight' ? (chance(run.rng, 0.12) ? relicChoices(run, 1, kind) : []) : relicChoices(run, 3, kind);
    run.screen = { name: 'reward', gold, options, relicOptions, picked: false, relicPicked: relicOptions.length === 0, next: kind === 'boss' ? 'breakthrough' : 'map', story: kind === 'boss' ? BOSS_STORY[enemyId]?.after : undefined };
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
const MODS = ['lei', 'zhong', 'ling', 'jing'];
export function randomTile(run, quality = 0) {
    const el = pick(run.rng, ELEMENTS);
    const v = Math.min(9, int(run.rng, 3, 5) + Math.min(4, run.act - 1) + quality);
    const mod = chance(run.rng, 0.6 + quality * 0.1) ? pick(run.rng, MODS) : undefined;
    return mod ? { el, v, mod } : { el, v };
}
export function rewardOptions(run, n) {
    const out = [];
    const patterns = sample(run.rng, PATTERN_ORDER.filter(id => id !== 'san'), 2, id => 6 - Math.abs(PATTERNS[id].tier - 3));
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
    const pool = RELICS.filter(r => !run.relics.includes(r.id));
    return sample(run.rng, pool, n, r => weights[r.rarity]).map(r => ({ type: 'relic', relic: r.id }));
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
export function leaveReward(run) {
    const screen = run.screen;
    if (screen.name !== 'reward')
        return;
    if (screen.next === 'breakthrough') {
        run.realm += 1;
        run.maxHp += 25;
        run.hp = run.maxHp;
        const pool = TALENTS.filter(t => !run.talents.includes(t.id) && !(t.id === 'dongtian' && run.relicSlots >= MAX_RELIC_SLOTS));
        run.screen = { name: 'breakthrough', options: sample(run.rng, pool, 3).map(t => ({ type: 'talent', talent: t.id })) };
        return;
    }
    run.screen = { name: 'map' };
}
export function chooseBreakthrough(run, index) {
    const screen = run.screen;
    if (screen.name !== 'breakthrough' || !screen.options[index])
        return;
    applyOption(run, screen.options[index]);
    advanceAct(run);
}
export function advanceAct(run) {
    run.act += 1;
    run.at = null;
    run.map = generateMap(run, run.act);
    run.screen = { name: 'story', act: run.act };
}
// —— Shop ——
export function optionPrice(run, option) {
    const discount = 1;
    switch (option.type) {
        case 'relic': return Math.round(RELIC_PRICE[RELIC[option.relic].rarity] * discount);
        case 'tile': return 30 + (option.tile.mod ? 15 : 0) + option.tile.v * 2;
        case 'pattern': return 45;
        case 'heal': return 30;
        default: return 0;
    }
}
function makeShop(run) {
    const options = [
        ...relicChoices(run, 3, 'shop'),
        { type: 'tile', tile: randomTile(run, 1) }, { type: 'tile', tile: randomTile(run, 1) }, { type: 'tile', tile: randomTile(run, 2) },
        ...sample(run.rng, PATTERN_ORDER.filter(id => id !== 'san'), 2).map(pattern => ({ type: 'pattern', pattern })),
        { type: 'heal', amount: Math.round(run.maxHp * 0.35) },
    ];
    const items = options.map(option => ({ option, price: optionPrice(run, option), sold: false }));
    return { name: 'shop', items, removePrice: 40 + 15 * run.log.filter(l => l === 'removed').length, removed: false };
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
    run.gold -= item.price;
    item.sold = true;
    return true;
}
export function startRemove(run) {
    const screen = run.screen;
    if (screen.name !== 'shop' || screen.removed || run.gold < screen.removePrice)
        return;
    run.screen = { name: 'pick-tile', purpose: 'remove', count: 1, then: { ...screen, removed: true }, title: `净符 · 花费 ${screen.removePrice} 灵石移除一枚符` };
}
export function leaveShop(run) { if (run.screen.name === 'shop')
    run.screen = { name: 'map' }; }
// —— Rest ——
export function restChoose(run, choice, pattern) {
    if (run.screen.name !== 'rest' || run.screen.done)
        return;
    if (choice === 'heal') {
        run.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.4));
        run.screen = { name: 'rest', done: true };
    }
    if (choice === 'forge')
        run.screen = { name: 'pick-tile', purpose: 'upgrade', count: 1, then: { name: 'rest', done: true }, title: '炼符 · 选一枚符：点数 +3，并附上一道符纹' };
    if (choice === 'insight' && pattern) {
        run.patternLv[pattern] += 1;
        run.screen = { name: 'rest', done: true };
    }
}
export function insightChoices(run) {
    const seed = { state: seedFrom(`${run.seed}:${run.at}`) };
    return sample(seed, PATTERN_ORDER.filter(id => id !== 'san'), 3);
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
        if (screen.then.name === 'shop') {
            run.gold -= screen.then.removePrice;
            run.log.push('removed');
        }
        run.bag = run.bag.filter(t => !uids.includes(t.uid));
    }
    if (screen.purpose === 'upgrade')
        for (const tile of tiles) {
            tile.v = Math.min(12, tile.v + 3);
            if (!tile.mod && tile.el !== 'zhuo')
                tile.mod = pick(run.rng, MODS);
        }
    if (screen.purpose === 'reforge')
        for (const tile of tiles)
            if (tile.el !== 'zhuo')
                tile.mod = 'zhong';
    run.screen = screen.then;
    return true;
}
export function cancelPick(run) {
    const screen = run.screen;
    if (screen.name !== 'pick-tile')
        return;
    if (screen.then.name === 'shop')
        run.screen = { ...screen.then, removed: false };
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
        // Runs saved before the story update.
        run.plan ??= [];
        run.bonds ??= {};
        run.deeds ??= [];
        run.ending ??= null;
        return run;
    }
    catch {
        return null;
    }
}
export const elName = (el) => (el === 'zhuo' ? '浊' : { jin: '金', mu: '木', shui: '水', huo: '火', tu: '土' }[el]);
export { ENEMY };
