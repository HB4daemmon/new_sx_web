/**
 * 荐：从手牌里挑出这一招该出的符，并排好顺序（相生连跳看顺序）。
 *  - 'max'  最高伤害：能斩杀就斩杀，否则伤害最高。
 *  - 'safe' 稳妥：伤害之外，把这一招能挡下、能回回来的气血也算进去（敌人要重击时更看重护盾）。
 * 同一份逻辑给界面的「荐」按钮和平衡模拟的机器人用。
 */
import { breakEffect, enemyAttack, previewCast } from './battle.js';
import { GEN } from './elements.js';
import { MAX_CAST } from './battle.js';
function* subsets(list, max) {
    const n = list.length;
    const pick = [];
    function* rec(start) {
        if (pick.length)
            yield [...pick];
        if (pick.length === max)
            return;
        for (let i = start; i < n; i += 1) {
            pick.push(list[i]);
            yield* rec(i + 1);
            pick.pop();
        }
    }
    yield* rec(0);
}
/** Orders a set of tiles for the longest 相生 runs (灵符 links with anything). */
export function arrange(tiles) {
    if (tiles.length < 2)
        return tiles;
    const link = (a, b) => a.el !== 'zhuo' && b.el !== 'zhuo' && (a.mod === 'ling' || b.mod === 'ling' || GEN[a.el] === b.el);
    let best = tiles, bestScore = -1;
    const perm = (rest, acc, pos, score) => {
        if (!rest.length) {
            if (score > bestScore) {
                bestScore = score;
                best = acc;
            }
            return;
        }
        rest.forEach((t, i) => {
            const p = acc.length && link(acc[acc.length - 1], t) ? pos + 1 : 1;
            perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, t], p, score + p);
        });
    };
    perm(tiles, [], 0, 0);
    return best;
}
/** HP this cast would keep: shield that soaks the coming blow, plus healing that lands after it. */
function hpKept(run, battle, r) {
    const intent = battle.enemy.intent;
    const incoming = intent.atk ? enemyAttack(run, battle) * (intent.hits ?? 1) : 0;
    // 破势：小怪的招被打断，精英与首领只剩一半。
    if (!battle.stacks.broken && r.damage * r.guardMult >= (battle.stacks.guard ?? Infinity)) {
        const boss = !breakEffect({ ...battle, stacks: { ...battle.stacks, broken: 1 } }).interrupt;
        return Math.min(battle.player.maxHp, boss ? incoming / 2 : incoming) + Math.min(r.heal, battle.player.maxHp - battle.player.hp);
    }
    const soak = Math.min(r.shield, Math.max(0, incoming - battle.player.shield));
    const hurt = Math.max(0, incoming - battle.player.shield - r.shield);
    const missing = Math.min(battle.player.maxHp, battle.player.maxHp - battle.player.hp + hurt);
    return soak + Math.min(r.heal, missing);
}
export function recommend(run, battle, mode = 'max', rage = false, opts = {}) {
    const hand = battle.hand;
    const enemyHp = battle.enemy.hp + (battle.enemy.armor || 0);
    let best = null;
    for (const set of subsets(hand, MAX_CAST)) {
        if (opts.minTiles && set.length < opts.minTiles && hand.length >= opts.minTiles)
            continue;
        const uids = arrange(set).map(t => t.uid);
        const r = previewCast(run, battle, uids, rage);
        if (!r)
            continue;
        const lethal = r.damage >= enemyHp;
        let score;
        if (mode === 'max')
            score = (lethal ? 1e15 : 0) + r.damage;
        else {
            const dmg = Math.min(1, r.damage / Math.max(1, enemyHp));
            score = (lethal ? 100 : 0) + dmg + 1.5 * (hpKept(run, battle, r) / Math.max(1, battle.player.maxHp));
        }
        // Ties: fewer tiles (keeps the hand readable), then more damage.
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && (uids.length < best.uids.length || r.damage > best.r.damage)))
            best = { score, uids, r };
    }
    if (!best)
        return null;
    return { uids: best.uids, result: best.r, lethal: best.r.damage >= enemyHp, mode };
}
/** Is a defensive play worth suggesting this turn? (the coming blow takes a real bite) */
export function dangerous(run, battle) {
    const intent = battle.enemy.intent;
    if (!intent.atk)
        return false;
    const incoming = enemyAttack(run, battle) * (intent.hits ?? 1) - battle.player.shield;
    return incoming >= battle.player.hp * 0.3;
}
