/**
 * 荐：从手牌里挑出这一招该出的符（不看顺序，只挑哪几张）。
 *  - 'max'  最高伤害：能斩杀就斩杀，否则伤害最高。
 *  - 'safe' 稳妥：伤害之外，把这一招能挡下、能回回来的气血也算进去（敌人要重击时更看重护盾）。
 * 同一份逻辑给界面的「荐」按钮和平衡模拟的机器人用。
 */
import { enemyAttack, previewCast } from './battle.js';
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
/** HP this cast would keep: shield that soaks the coming blow, plus healing that lands after it. */
function hpKept(run, battle, r) {
    const intent = battle.enemy.intent;
    const incoming = intent.atk ? enemyAttack(run, battle) * (intent.hits ?? 1) : 0;
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
        const uids = set.map(t => t.uid);
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
