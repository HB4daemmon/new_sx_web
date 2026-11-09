import { ACT_ATK, ACT_HP, ENEMY, HEAT_ATK, HEAT_HP, RANK_ATK, RANK_HP } from './enemies.js';
import { GEN } from './elements.js';
import { next, shuffle, int } from './rng.js';
import { COMBOS, HETU, YAKU } from './patterns.js';
import { pactRank } from './pacts.js';
import { computeCast, defenseScale, has, relicFlag } from './score.js';
import { DODGE_CAP, REDUCE_CAP, SPECIALS } from './content.js';
export const MAX_CAST = 5;
export const handSize = (run) => 7 + (has(run, 'yiqi') ? 1 : 0) + (run.vow === 'juenian' ? 2 : 0) - (pactRank(run, 'narrow') ? 1 : 0);
export const discardsPerTurn = (run) => (run.vow === 'juenian' ? 0 : 2 + (has(run, 'douzhuan') ? 1 : 0));
/** 无尽天劫·限时斩敌: the last turn you get before the tribulation takes you instead. */
export const ENDLESS_LIMIT = 12;
/** 无尽天劫劈敌：每重 4% 气血上限，累计至多 60%。 */
export const ENDLESS_TRIB = 0.04;
export const ENDLESS_TRIB_CAP = 0.6;
export const endlessLimit = (_run) => ENDLESS_LIMIT;
/** 减伤 % and 闪避 % right now (守御天赋), already capped. */
export function defense(run, battle) {
    const t = (id) => run.talents.includes(id);
    let reduce = (t('tieyi') ? 10 : 0) + (t('tieyi2') ? 20 : 0);
    if (t('jianmu'))
        reduce += 3 * battle.swords;
    if (t('fenshen') && battle.enemy.burn >= battle.enemy.hp * 0.1)
        reduce += 35;
    if (t('budong') && battle.player.shield > 0)
        reduce += 30;
    if (t('yeyin'))
        reduce += battle.turn % 2 === 0 ? 50 : 20;
    let dodge = t('shenfa') ? 15 : 0;
    if (t('leidun'))
        dodge += 10 * (battle.stacks.rages ?? 0);
    // 雷遁: the turn you unleash a 怒技, nothing lands.
    if (t('leidun') && battle.stacks.rageTurn === battle.turn)
        return { reduce: Math.min(REDUCE_CAP, reduce), dodge: 100 };
    return { reduce: Math.min(REDUCE_CAP, reduce), dodge: Math.min(DODGE_CAP, dodge) };
}
export const tribulationStart = (run) => Math.max(3, (has(run, 'yinjie') ? 5 : 8) - (pactRank(run, 'short') ? 2 : 0) - (run.fate === 'yingjie' ? 2 : 0));
export const swordDamage = (run) => 4 + run.realm * 4;
/** Burn on enemies grows with realm so it keeps up with act HP. */
export const burnPower = (run) => 1 + run.realm;
/** One sword's share of a volley: a flat bite plus 5% of the cast that launched it. */
const swordVolley = (run, swords, castDamage) => Math.round(swords * (swordDamage(run) + castDamage * 0.06));
const actOf = (run) => Math.min(5, run.act);
/** Runs started before 天劫契 used a flat 劫数. */
const legacyHeat = (run) => run.heat > 0 && !Object.keys(run.pacts ?? {}).length;
/** Enemy HP / damage multipliers from 天劫契 (or legacy 劫数) and 无尽劫 depth. */
export function enemyHpScale(run) {
    const pact = legacyHeat(run) ? 1 + HEAT_HP * run.heat : 1 + 0.15 * pactRank(run, 'cloud');
    return pact * endlessHpScale(run);
}
export const ENDLESS_HP = 1.5;
export const endlessHpScale = (run) => (run.endless ? ENDLESS_HP ** run.endless : 1);
export function enemyAtkScale(run, rank) {
    const pact = legacyHeat(run) ? 1 + HEAT_ATK * run.heat : 1 + 0.1 * pactRank(run, 'thunder');
    return pact * (rank === 'boss' && pactRank(run, 'awake') ? 1.3 : 1) * (run.endless ? 1.1 ** run.endless : 1);
}
function scaleAtk(run, battle, base) {
    const rank = ENEMY[battle.enemyId].rank;
    return Math.round(base * ACT_ATK[actOf(run)] * RANK_ATK[rank] * enemyAtkScale(run, rank));
}
const swordCap = (run) => 15 + relicFlag(run, 'swordCap');
export function startBattle(run, enemyId, kind) {
    const def = ENEMY[enemyId];
    const hp = Math.round(def.hp * ACT_HP[actOf(run)] * RANK_HP[def.rank] * enemyHpScale(run));
    const enemy = {
        id: def.id, el: def.el, hp, maxHp: hp, shield: 0, burn: 0, armor: 0, atkBonus: 0,
        charged: false, moveIndex: 0, phase: 1, revived: false, intent: def.moves[0],
    };
    const rng = run.rng;
    const battle = {
        enemyId, kind, turn: 1, hand: [], draw: shuffle(rng, run.bag.map(tile => ({ ...tile }))), discard: [], exhausted: [],
        player: { hp: run.hp, maxHp: run.maxHp, shield: 0, burn: 0 }, enemy,
        qi: Math.min(100, relicFlag(run, 'startQi')), discardsLeft: discardsPerTurn(run), castsThisTurn: 0, freeCastUsed: false,
        castCount: 0, swords: 0, spring: 0, stacks: {}, outcome: 'fighting', bestHit: 0,
    };
    if (has(run, 'jinshen'))
        battle.player.shield += 20 * Math.max(1, run.realm);
    if (def.act === 5 && def.rank === 'boss' && !run.endless)
        applyAssists(run, battle);
    if (run.unlocks?.includes('discard1'))
        battle.discardsLeft += 1;
    battle.stacks.startHp = battle.player.hp;
    if (run.method === 'benlei')
        battle.stacks.rageCost = 60;
    if (run.method === 'yangjian')
        battle.swords = Math.min(swordCap(run), run.swordsKept ?? 0);
    if (has(run, 'huanhua')) {
        const pool = battle.draw.filter(t => t.el !== 'zhuo' && !t.mod);
        for (let i = 0; i < 2 && pool.length; i += 1)
            pool.splice(int(rng, 0, pool.length - 1), 1)[0].mod = 'huan';
    }
    // 星宿命: one 宿 per fight (two once awakened), each doubling one 路.
    if (run.fate === 'xingxiu') {
        battle.stacks.star = int(rng, 0, 5);
        if (run.realm >= 2)
            battle.stacks.star2 = (battle.stacks.star + 1 + int(rng, 0, 4)) % 6;
    }
    // 河图命 化境: two random tiles take their element's 河图数 for this fight.
    if (run.fate === 'hetu' && run.realm >= 2) {
        const pool = battle.draw.filter(t => t.el !== 'zhuo');
        for (let i = 0; i < 2 && pool.length; i += 1) {
            const t = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
            const n = HETU[t.el];
            t.v = t.v > 5 ? n + 5 : n;
        }
    }
    // 温养: the bag's biggest tile grows for good at the start of every fight.
    const grow = has(run, 'wenyang3') ? 3 : has(run, 'wenyang2') ? 2 : has(run, 'wenyang1') ? 1 : 0;
    if (grow) {
        const top = run.bag.filter(t => t.el !== 'zhuo').sort((a, b) => b.v - a.v)[0];
        if (top) {
            top.v += grow;
            const copy = battle.draw.find(t => t.uid === top.uid);
            if (copy)
                copy.v += grow;
        }
    }
    turnStartShield(run, battle);
    drawTo(run, battle);
    turnRolls(run, battle);
    if (has(run, 'bubu')) {
        const top = battle.hand.filter(t => t.el !== 'zhuo').sort((a, b) => b.v - a.v)[0];
        if (top) {
            top.v += 5;
            battle.stacks.bubuUid = top.uid;
        }
    }
    return battle;
}
/** 因缘相助: completed threads show up for the final tribulation. */
function applyAssists(run, battle) {
    const done = Object.entries(run.bonds ?? {}).filter(([, s]) => s === 'done').map(([id]) => id);
    battle.assists = done;
    for (const id of done) {
        if (id === 'jingwei')
            battle.stacks.noCurse = 1;
        if (id === 'yu')
            battle.stacks.calm = 1;
        if (id === 'houyi')
            battle.enemy.hp = Math.round(battle.enemy.hp * 0.85);
        if (id === 'shennong') {
            battle.player.hp = battle.player.maxHp;
            battle.player.shield += Math.round(battle.player.maxHp / 2);
        }
        if (id === 'nezha') {
            battle.qi = 100;
            battle.discardsLeft = discardsPerTurn(run) + 1;
        }
        if (id === 'tieshan')
            battle.enemy.burn += Math.round(battle.enemy.maxHp * 0.03);
    }
}
/** Things that are rolled fresh every turn: 命运轮盘's number, 天机签's lucky element, 空灵根's 灵 tile. */
function turnRolls(run, battle) {
    if (run.relics.includes('mingyun'))
        battle.stacks.wheel = int(run.rng, 1, 5);
    if (run.relics.includes('tianjiqian'))
        battle.stacks.omen = int(run.rng, 0, 4);
    if (has(run, 'kongling')) {
        const pile = [...battle.hand, ...battle.draw, ...battle.discard];
        const prev = pile.find(t => t.uid === battle.stacks.kongUid);
        if (prev && prev.mod === 'ling')
            delete prev.mod;
        const pool = battle.hand.filter(t => t.el !== 'zhuo' && !t.mod);
        const pickT = pool.length ? pool[int(run.rng, 0, pool.length - 1)] : null;
        if (pickT) {
            pickT.mod = 'ling';
            battle.stacks.kongUid = pickT.uid;
        }
        else
            battle.stacks.kongUid = 0;
    }
}
/** 护盾上限：金刚功为气血上限（不动明王 ×2），其余 ×1.5。 */
export const shieldCap = (run, battle) => battle.player.maxHp * (run.method === 'jingang' ? (run.talents.includes('budong') ? 2 : 1) : 1.5);
function turnStartShield(run, battle) {
    const plate = relicFlag(run, 'turnShield');
    if (plate)
        battle.player.shield += Math.round(plate * defenseScale(run));
    // 金刚功·护体: a tenth of max HP as shield every turn.
    if (run.method === 'jingang')
        battle.player.shield = Math.min(shieldCap(run, battle), battle.player.shield + Math.round(battle.player.maxHp * (run.talents.includes('budong') ? 0.15 : 0)));
    // 回灵: a little HP back every turn.
    if (run.talents.includes('huiling'))
        battle.player.hp = Math.min(battle.player.maxHp, battle.player.hp + Math.round(battle.player.maxHp * 0.06));
}
function drawTo(run, battle) {
    let drawn = 0;
    // 本命符匣: the bag's biggest tile always comes to hand (if it is not already there or spent this turn).
    if (run.relics.includes('benming') && battle.hand.length < handSize(run)) {
        const top = [...battle.draw, ...battle.discard].filter(t => t.el !== 'zhuo').sort((a, b) => b.v - a.v)[0];
        const inHand = battle.hand.some(t => t.el !== 'zhuo' && t.v >= (top?.v ?? 0));
        if (top && !inHand) {
            battle.draw = battle.draw.filter(t => t !== top);
            battle.discard = battle.discard.filter(t => t !== top);
            battle.hand.push(top);
            drawn += 1;
        }
    }
    while (battle.hand.length < handSize(run)) {
        if (!battle.draw.length) {
            if (!battle.discard.length)
                break;
            battle.draw = shuffle(run.rng, battle.discard);
            battle.discard = [];
        }
        battle.hand.push(battle.draw.pop());
        drawn += 1;
    }
    return drawn;
}
export function enemyAttack(run, battle, move = battle.enemy.intent) {
    if (!move.atk)
        return 0;
    return Math.round((scaleAtk(run, battle, move.atk) + battle.enemy.atkBonus) * (battle.enemy.charged ? 2 : 1) * (battle.stacks.calm ? 0.8 : 1));
}
export function discardTiles(run, battle, uids) {
    if (battle.outcome !== 'fighting' || battle.discardsLeft <= 0 || !uids.length)
        return [];
    const chosen = battle.hand.filter(tile => uids.includes(tile.uid));
    if (!chosen.length)
        return [];
    battle.hand = battle.hand.filter(tile => !uids.includes(tile.uid));
    battle.discard.push(...chosen);
    battle.discardsLeft -= 1;
    battle.stacks.discarded = 1;
    return [{ k: 'draw', count: drawTo(run, battle) }];
}
/** 剑意 needed for a 怒技 (奔雷诀 only needs 60). */
export const rageCost = (battle) => battle.stacks.rageCost || 100;
export const canRage = (battle) => battle.qi >= rageCost(battle);
/** What the enemy is about to deal this turn (read by 借势). */
function noteIncoming(run, battle) {
    const intent = battle.enemy.intent;
    battle.stacks.incoming = intent.atk ? enemyAttack(run, battle) * (intent.hits ?? 1) : 0;
}
export function previewCast(run, battle, uids, rage) {
    const tiles = uids.map(uid => battle.hand.find(tile => tile.uid === uid)).filter(Boolean);
    if (!tiles.length)
        return null;
    noteIncoming(run, battle);
    return computeCast(run, battle, tiles, rage && canRage(battle));
}
function damageEnemy(run, battle, amount, src, events, crit = false) {
    const enemy = battle.enemy;
    if (enemy.hp <= 0 || amount <= 0)
        return 0;
    let blocked = 0;
    if (enemy.armor > 0 && src !== 'burn' && src !== 'tribulation' && !relicFlag(run, 'ignoreArmor')) {
        blocked = Math.min(enemy.armor, amount);
        enemy.armor -= blocked;
    }
    const dealt = amount - blocked;
    enemy.hp -= dealt;
    events.push({ k: 'hit', to: 'enemy', amount: dealt, blocked, src, crit });
    checkEnemy(run, battle, events);
    return dealt;
}
function checkEnemy(run, battle, events) {
    const enemy = battle.enemy;
    const def = ENEMY[enemy.id];
    if (enemy.hp <= 0) {
        if (def.trait === 'revive' && !enemy.revived && def.phase2) {
            enemy.revived = true;
            enemy.hp = Math.round(enemy.maxHp * 0.3);
            enemy.burn = 0;
            enterPhase2(run, battle, events);
            events.push({ k: 'revive', hp: enemy.hp });
            return;
        }
        enemy.hp = 0;
        if (battle.outcome === 'fighting') {
            battle.outcome = 'won';
            events.push({ k: 'win' });
        }
        return;
    }
    const threshold = pactRank(run, 'awake') ? 0.75 : 0.5;
    if (def.phase2 && def.trait !== 'revive' && enemy.phase === 1 && enemy.hp <= enemy.maxHp * threshold)
        enterPhase2(run, battle, events);
}
function enterPhase2(run, battle, events) {
    const enemy = battle.enemy;
    const def = ENEMY[enemy.id];
    if (!def.phase2)
        return;
    enemy.phase = 2;
    enemy.moveIndex = 0;
    enemy.intent = def.phase2.moves[0];
    enemy.charged = false;
    if (def.phase2.buff)
        enemy.atkBonus += scaleAtk(run, battle, def.phase2.buff);
    events.push({ k: 'phase', name: def.phase2.name, text: def.phase2.text });
}
function damagePlayer(run, battle, amount, src, events, hitIndex) {
    const player = battle.player;
    if (amount <= 0 || battle.outcome !== 'fighting')
        return;
    if (src === 'enemy') {
        const d = defense(run, battle);
        if (d.dodge && next(run.rng) * 100 < d.dodge) {
            events.push({ k: 'dodge', hitIndex });
            return;
        }
        if (d.reduce)
            amount = Math.round(amount * (1 - d.reduce / 100));
    }
    // 龟息: no single blow takes more than 35% of max HP.
    if (src !== 'blood' && run.talents.includes('guixi'))
        amount = Math.min(amount, Math.round(player.maxHp * 0.35));
    let blocked = 0;
    if (src !== 'blood' && player.shield > 0) {
        blocked = Math.min(player.shield, amount);
        player.shield -= blocked;
        // 百折: a broken shield toughens you for good.
        if (player.shield <= 0 && run.talents.includes('baizhe')) {
            run.maxHp += 5;
            player.maxHp += 5;
        }
        const drum = relicFlag(run, 'drumQi');
        if (drum)
            battle.stacks.drum = (battle.stacks.drum ?? 0) + blocked * drum;
    }
    const dealt = amount - blocked;
    player.hp -= dealt;
    if (src === 'blood')
        player.hp = Math.max(1, player.hp);
    // For the 复盘: where the damage came from, and what shields soaked.
    const key = src === 'tribulation' ? 'tkTrib' : src === 'enemy' ? 'tkEnemy' : src === 'burn' ? 'tkBurn' : 'tkBlood';
    battle.stacks[key] = (battle.stacks[key] ?? 0) + Math.max(0, dealt);
    battle.stacks.tkBlocked = (battle.stacks.tkBlocked ?? 0) + blocked;
    events.push({ k: 'hit', to: 'player', amount: dealt, blocked, src, hitIndex });
    // 枯木逢春: once per fight, back on your feet at half HP.
    if (player.hp <= 0 && run.talents.includes('kumu') && !battle.stacks.kumu) {
        battle.stacks.kumu = 1;
        player.hp = Math.round(player.maxHp / 2);
        events.push({ k: 'save', name: '枯木逢春', hp: player.hp });
        return;
    }
    if (player.hp <= 0) {
        player.hp = 0;
        battle.outcome = 'lost';
        events.push({ k: 'lose' });
    }
}
export function cast(run, battle, uids, rageWanted) {
    if (battle.outcome !== 'fighting' || !uids.length || uids.length > MAX_CAST)
        return null;
    const tiles = uids.map(uid => battle.hand.find(tile => tile.uid === uid)).filter(Boolean);
    if (tiles.length !== uids.length)
        return null;
    const rage = rageWanted && canRage(battle);
    noteIncoming(run, battle);
    const result = computeCast(run, battle, tiles, rage, next(run.rng));
    const events = [];
    battle.hand = battle.hand.filter(tile => !uids.includes(tile.uid));
    battle.discard.push(...tiles);
    battle.castCount += 1;
    battle.castsThisTurn += 1;
    run.stats.casts += 1;
    if (has(run, 'xueji'))
        damagePlayer(run, battle, 3, 'blood', events);
    // Consumed one-shot bonuses.
    battle.stacks.overheal = 0;
    battle.stacks.drum = 0;
    if (run.method === 'huichun' && !relicFlag(run, 'springKeep'))
        battle.spring = Math.floor(battle.spring / 2);
    let total = damageEnemy(run, battle, result.damage, 'cast', events, result.crit);
    if (run.method === 'yangjian') {
        const forged = Math.min(swordCap(run) - battle.swords, result.swords);
        battle.swords += Math.max(0, forged);
        if (battle.swords > 0) {
            events.push({ k: 'swords', count: battle.swords, forged: Math.max(0, forged) });
            for (let volley = 0; volley < (rage ? 3 : 1) && battle.outcome === 'fighting'; volley += 1) {
                total += damageEnemy(run, battle, swordVolley(run, battle.swords, result.damage), 'sword', events);
            }
        }
    }
    if (run.method === 'yuhuo' && rage && battle.enemy.burn > 0 && battle.outcome === 'fighting') {
        total += damageEnemy(run, battle, battle.enemy.burn * 8 * burnPower(run), 'detonate', events);
    }
    // Tile effects. 回复 lands after the enemy has struck (盾在挨打前，血在挨打后).
    if (result.heal > 0)
        battle.stacks.pendingHeal = (battle.stacks.pendingHeal ?? 0) + result.heal;
    if (result.shield > 0) {
        battle.player.shield = Math.min(shieldCap(run, battle), battle.player.shield + result.shield);
        events.push({ k: 'shield', to: 'player', amount: result.shield });
    }
    // 御火诀: a cast with fire in it leaves 20% of its damage behind as burn.
    if (run.method === 'yuhuo' && result.els.includes('huo') && battle.outcome === 'fighting')
        result.burn += Math.round((result.damage * 0.45) / burnPower(run));
    if (result.burn > 0 && battle.outcome === 'fighting') {
        battle.enemy.burn += result.burn;
        events.push({ k: 'burn', to: 'enemy', amount: result.burn });
    }
    battle.qi = Math.min(100, (rage ? Math.max(relicFlag(run, 'rageKeep'), battle.qi - rageCost(battle)) : battle.qi) + result.intentGain);
    if (rage && run.method === 'jingang')
        battle.player.shield = 0;
    // Every 怒技 seeds two of the method's own tiles into the draw pile for this battle.
    if (rage) {
        const sp = Object.values(SPECIALS).find(x => x.method === run.method);
        if (sp) {
            for (let i = 0; i < 2; i += 1) {
                battle.stacks.spSeq = (battle.stacks.spSeq ?? 0) + 1;
                battle.draw.splice(int(run.rng, 0, battle.draw.length), 0, { uid: -900000 - battle.stacks.spSeq, el: sp.el, v: sp.v + run.realm, sp: sp.id });
            }
            events.push({ k: 'seed', sp: sp.id, n: 2 });
        }
    }
    if (rage) {
        battle.stacks.rages = (battle.stacks.rages ?? 0) + 1;
        battle.stacks.rageTurn = battle.turn;
    }
    if (rage && run.method === 'benlei') {
        battle.stacks.thunder = (battle.stacks.thunder ?? 0) + 4;
        events.push({ k: 'thunder', total: battle.stacks.thunder });
    }
    // 淬火砧: a lone tile grows for good (the bag copy and this battle's copy).
    if (tiles.length === 1 && run.relics.includes('cuihuo') && tiles[0].el !== 'zhuo') {
        tiles[0].v += 2;
        const own = run.bag.find(t => t.uid === tiles[0].uid);
        if (own)
            own.v += 2;
    }
    // 拓印: the turn's first cast leaves a copy of its biggest tile on top of the draw pile.
    if (has(run, 'tuoyin') && battle.castsThisTurn === 1) {
        const top = [...tiles].filter(t => t.el !== 'zhuo').sort((a, b) => b.v - a.v)[0];
        if (top) {
            battle.stacks.tempSeq = (battle.stacks.tempSeq ?? 0) + 1;
            battle.draw.push({ uid: -700000 - battle.stacks.tempSeq, el: top.el, v: top.v });
        }
    }
    // 法相天地: every 役 makes every tile in this battle +1.
    if (has(run, 'faxiang') && result.yaku.length)
        for (const t of [...battle.hand, ...battle.draw, ...battle.discard])
            if (t.el !== 'zhuo')
                t.v += result.yaku.length;
    // 步步为营: the boosted tile landing the killing blow keeps its +5.
    if (battle.outcome === 'won' && battle.stacks.bubuUid && uids.includes(battle.stacks.bubuUid)) {
        const own = run.bag.find(t => t.uid === battle.stacks.bubuUid);
        if (own)
            own.v += 5;
        battle.stacks.bubuKept = 1;
    }
    recordUse(run, result);
    battle.bestHit = Math.max(battle.bestHit, total);
    run.stats.bestHit = Math.max(run.stats.bestHit, total);
    const tierBest = run.stats.biggestPattern;
    if (!tierBest || patternTier(result.pattern) > patternTier(tierBest))
        run.stats.biggestPattern = result.pattern;
    let turnEnded = true;
    if (has(run, 'shuangjue') && !battle.freeCastUsed && tiles.length <= 2 && battle.outcome === 'fighting') {
        battle.freeCastUsed = true;
        turnEnded = false;
        drawTo(run, battle);
    }
    const enemyEvents = [];
    if (turnEnded && battle.outcome === 'fighting')
        enemyTurn(run, battle, enemyEvents);
    // A won fight still banks the healing.
    if (battle.outcome === 'won')
        settleHeal(run, battle, events);
    return { result, events, enemyEvents, turnEnded };
}
const patternTier = (id) => COMBOS[id].tier * 100 + (id in YAKU ? YAKU[id].fan : 0);
/** Applies the turn's delayed 回复; overflow feeds 春华 and 玉液回天壶 as before. */
function settleHeal(run, battle, events) {
    const amount = battle.stacks.pendingHeal ?? 0;
    if (amount <= 0)
        return;
    battle.stacks.pendingHeal = 0;
    const room = Math.max(0, battle.player.maxHp - battle.player.hp);
    const healed = Math.min(room, amount);
    const overflow = amount - healed;
    battle.player.hp += healed;
    if (overflow > 0) {
        if (run.method === 'huichun')
            battle.spring += overflow;
        const pot = relicFlag(run, 'overhealQi');
        if (pot)
            battle.stacks.overheal = overflow * pot;
    }
    events.push({ k: 'heal', to: 'player', amount: healed, overflow, late: true });
}
/** Counts which 诀 and elements actually carried the run (shown as 此行打法 and on rewards). */
function recordUse(run, result) {
    const use = (run.stats.use ??= {});
    for (const hit of result.yaku) {
        const path = YAKU[hit.id].path;
        if (path !== 'tian' && path !== 'ben')
            use[path] = (use[path] ?? 0) + 1;
    }
    const elUse = (run.stats.elUse ??= {});
    for (const el of result.els)
        if (el)
            elUse[el] = (elUse[el] ?? 0) + 1;
}
/** The enemy's heaviest single turn at this point of the run (charge doubles the next blow). For the map's risk labels. */
export function enemyThreat(run, enemyId) {
    const def = ENEMY[enemyId];
    if (!def)
        return 0;
    const moves = [...def.moves, ...(def.phase2?.moves ?? [])];
    const charge = moves.some(m => m.charge) ? 2 : 1;
    const top = Math.max(0, ...moves.map(m => (m.atk ?? 0) * (m.hits ?? 1)));
    return Math.round(top * charge * ACT_ATK[actOf(run)] * RANK_ATK[def.rank] * enemyAtkScale(run, def.rank));
}
function enemyTurn(run, battle, events) {
    const enemy = battle.enemy;
    const def = ENEMY[enemy.id];
    enemy.armor = 0;
    if (enemy.burn > 0) {
        damageEnemy(run, battle, enemy.burn * burnPower(run), 'burn', events);
        if (relicFlag(run, 'burnTwice') && battle.outcome === 'fighting')
            damageEnemy(run, battle, enemy.burn * burnPower(run), 'burn', events);
        if (run.method !== 'yuhuo')
            enemy.burn = Math.floor(enemy.burn * 0.6);
        if (battle.outcome !== 'fighting')
            return;
    }
    const move = enemy.intent;
    events.push({ k: 'move', name: move.name, move });
    if (move.atk) {
        const dmg = enemyAttack(run, battle, move);
        for (let i = 0; i < (move.hits ?? 1); i += 1)
            damagePlayer(run, battle, dmg, 'enemy', events, i);
        enemy.charged = false;
        if (battle.outcome !== 'fighting')
            return;
    }
    if (move.charge) {
        enemy.charged = true;
        events.push({ k: 'charge' });
    }
    if (move.armor) {
        enemy.armor += Math.round(move.armor * ACT_HP[actOf(run)] * RANK_HP[def.rank] * enemyHpScale(run));
        events.push({ k: 'armor', amount: enemy.armor });
    }
    if (move.burn) {
        battle.player.burn += Math.round(move.burn * ACT_ATK[actOf(run)]);
        events.push({ k: 'burn', to: 'player', amount: Math.round(move.burn * ACT_ATK[actOf(run)]) });
    }
    if (move.curse && battle.stacks.noCurse)
        events.push({ k: 'curse', n: 0 });
    else if (move.curse) {
        for (let i = 0; i < move.curse; i += 1) {
            const tile = { uid: -(battle.castCount * 10 + i + 1) - battle.turn * 1000, el: 'zhuo', v: 0 };
            battle.draw.splice(int(run.rng, 0, battle.draw.length), 0, tile);
        }
        events.push({ k: 'curse', n: move.curse });
    }
    if (move.drain) {
        const lost = Math.min(battle.qi, move.drain);
        battle.qi -= lost;
        events.push({ k: 'drain', amount: lost });
    }
    if (move.heal) {
        const h = Math.min(enemy.maxHp - enemy.hp, Math.round(enemy.maxHp * move.heal));
        enemy.hp += h;
        events.push({ k: 'heal', to: 'enemy', amount: h });
    }
    if (move.buff) {
        const b = scaleAtk(run, battle, move.buff);
        enemy.atkBonus += b;
        events.push({ k: 'buff', amount: b });
    }
    // 天劫: escalating sudden death keeps every fight short.
    const start = tribulationStart(run);
    if (battle.turn >= start) {
        const level = battle.turn - start + 1;
        events.push({ k: 'tribulation', level });
        let bolt = Math.round(enemy.maxHp * (run.endless ? ENDLESS_TRIB : 0.07) * level * (run.fate === 'yingjie' && run.realm >= 2 ? 2 : 1));
        // 无尽: the tribulation takes at most 60% of the foe; the rest is yours to cut.
        if (run.endless)
            bolt = Math.max(0, Math.min(bolt, Math.round(enemy.maxHp * (run.talents.includes('shijie') ? 0.85 : ENDLESS_TRIB_CAP)) - (battle.stacks.tribDealt ?? 0)));
        battle.stacks.tribDealt = (battle.stacks.tribDealt ?? 0) + bolt;
        if (bolt)
            damageEnemy(run, battle, bolt, 'tribulation', events);
        if (!has(run, 'yinjie') && battle.outcome === 'fighting') {
            const bolt = Math.round(battle.player.maxHp * 0.05 * level);
            // 应劫命: the bolt meant for you becomes a shield.
            if (run.fate === 'yingjie') {
                battle.player.shield += bolt;
                events.push({ k: 'shield', to: 'player', amount: bolt });
            }
            else
                damagePlayer(run, battle, bolt, 'tribulation', events);
        }
        if (battle.outcome !== 'fighting')
            return;
        // 无尽·限时斩敌: past the limit the tribulation takes you instead of the foe.
        if (run.endless && battle.turn >= endlessLimit(run)) {
            battle.stacks.tkTrib = (battle.stacks.tkTrib ?? 0) + battle.player.hp;
            events.push({ k: 'hit', to: 'player', amount: battle.player.hp, blocked: 0, src: 'tribulation' });
            battle.player.hp = 0;
            battle.outcome = 'lost';
            events.push({ k: 'lose' });
            return;
        }
    }
    // The cast's 回复 lands now that the enemy has struck.
    settleHeal(run, battle, events);
    // Next intent.
    const moves = enemy.phase === 2 && def.phase2 ? def.phase2.moves : def.moves;
    enemy.moveIndex = (enemy.moveIndex + 1) % moves.length;
    enemy.intent = moves[enemy.moveIndex];
    if (def.trait === 'alternate') {
        enemy.el = enemy.el === 'huo' ? 'shui' : 'huo';
        events.push({ k: 'element', el: enemy.el });
    }
    if (def.trait === 'cycle') {
        enemy.el = GEN[enemy.el];
        events.push({ k: 'element', el: enemy.el });
    }
    // Player turn start.
    battle.turn += 1;
    run.stats.turns += 1;
    events.push({ k: 'turn', turn: battle.turn });
    if (run.method !== 'jingang')
        battle.player.shield = 0;
    turnStartShield(run, battle);
    if (battle.player.burn > 0) {
        damagePlayer(run, battle, battle.player.burn, 'burn', events);
        battle.player.burn = Math.floor(battle.player.burn / 2);
        if (battle.outcome !== 'fighting')
            return;
    }
    battle.discardsLeft = discardsPerTurn(run);
    battle.stacks.discarded = 0;
    battle.castsThisTurn = 0;
    battle.freeCastUsed = false;
    // Every turn starts on a fresh hand: unplayed tiles go to the discard pile.
    battle.discard.push(...battle.hand);
    battle.hand = [];
    const drawn = drawTo(run, battle);
    turnRolls(run, battle);
    events.push({ k: 'draw', count: drawn });
}
