/**
 * 复盘：把一局的失败翻译成玩家能讨论、下一局能试的东西。
 * 只读 run.journal 与 run.stats，不改变任何结果；每条结论都基于真实发生的数字。
 */
import { tribulationStart } from './battle.js';
import { ENEMY } from './enemies.js';
import { PATTERNS, PATTERN_ORDER } from './patterns.js';
import { counterOf, KE } from './elements.js';
const EL_NAME = { jin: '金', mu: '木', shui: '水', huo: '火', tu: '土' };
const pct = (n) => Math.round(n * 100);
/** The run's build as actually played: “相生 · 火”. Null until a few casts are in. */
export function playStyle(run) {
    const use = run.stats.use ?? {};
    const top = topPattern(run);
    const elUse = Object.entries(run.stats.elUse ?? {});
    if (!top || (run.stats.casts ?? 0) < 3)
        return null;
    const [el, n] = elUse.sort((a, b) => b[1] - a[1])[0] ?? [];
    const total = elUse.reduce((s, [, v]) => s + v, 0);
    const elPart = el && n / total >= 0.28 ? ` · ${EL_NAME[el]}` : '';
    return `${PATTERNS[top].name}${elPart}（${use[top]} 次）`;
}
export function topPattern(run) {
    const use = run.stats.use ?? {};
    let best = null;
    for (const id of PATTERN_ORDER)
        if ((use[id] ?? 0) > (best ? use[best] ?? 0 : 0))
            best = id;
    return best;
}
/** Patterns the player has cast at least twice, most-used first: rewards for these get a 常用 tag. */
export function favouritePatterns(run) {
    const use = run.stats.use ?? {};
    return PATTERN_ORDER.filter(id => (use[id] ?? 0) >= 2).sort((a, b) => (use[b] ?? 0) - (use[a] ?? 0)).slice(0, 2);
}
export function favouriteElement(run) {
    const elUse = Object.entries(run.stats.elUse ?? {});
    const total = elUse.reduce((s, [, v]) => s + v, 0);
    const [el, n] = elUse.sort((a, b) => b[1] - a[1])[0] ?? [];
    return el && total >= 6 && n / total >= 0.28 ? el : null;
}
export function reviewRun(run) {
    const journal = run.journal ?? [];
    const last = [...journal].reverse().find(f => !f.won) ?? null;
    const findings = [];
    let nearMiss = null;
    if (last) {
        const name = ENEMY[last.enemy]?.name ?? '敌人';
        const avg = last.casts ? (last.enemyMax - last.enemyLeft) / last.casts : 0;
        nearMiss = { left: last.enemyLeft, pct: last.enemyLeft / last.enemyMax, casts: avg > 0 ? Math.ceil(last.enemyLeft / avg) : 0 };
        const taken = last.taken.enemy + last.taken.burn + last.taken.trib + last.taken.blood;
        // 1. 拖进天劫: the fight outlasted the sudden-death clock.
        const trib = tribulationStart(run);
        if (last.turns >= trib && last.taken.trib > 0) {
            findings.push({
                id: 'slow', weight: 3 + last.taken.trib / Math.max(1, taken),
                title: run.endless ? '没能限时斩敌' : '拖进了天劫',
                detail: run.endless
                    ? `无尽天劫限时斩敌：与${name}打到第 ${last.turns} 回合还没斩敌，天劫落到了你身上。`
                    : `与${name}打到第 ${last.turns} 回合，天劫从第 ${trib} 回合起两边都劈，你因此掉了 ${last.taken.trib} 气血。`,
                tryNext: '输出要在天劫前结束战斗：把心法升重集中到最常成役的一路上，少拿分散的新符。',
            });
        }
        // 2. 输出不足: even the best hit was small against this enemy.
        if (last.best > 0 && last.best < last.enemyMax / 5) {
            findings.push({
                id: 'output', weight: 2.5 + (last.enemyMax / 5 - last.best) / (last.enemyMax / 5),
                title: '输出没跟上',
                detail: `这场最强一招 ${last.best}，只有${name}气血的 ${pct(last.best / last.enemyMax)}%。`,
                tryNext: '同元和相生可以同时成立：比如 木木→火→土，既是双元又连两跳；精英与首领给的法宝优先拿“乘倍”的。',
            });
        }
        // 3. 防御没撑住: enemy blows did most of the damage and shields soaked little.
        if (last.taken.enemy >= last.maxHp * 0.5 && last.blocked < last.taken.enemy * 0.3) {
            findings.push({
                id: 'defense', weight: 2 + last.taken.enemy / last.maxHp,
                title: '防御没撑起来',
                detail: `${name}的攻击打掉你 ${last.taken.enemy} 气血，护盾只挡下 ${last.blocked}。`,
                tryNext: '看敌人意图：重击来之前那一招带上水符（护盾），或用木符回血。',
            });
        }
        // 4. 带伤进场: the route spent HP the decisive fight needed.
        if (last.hpIn < last.maxHp * 0.55) {
            const before = journal.slice(0, journal.indexOf(last)).filter(f => f.act === last.act);
            const elites = before.filter(f => f.kind === 'elite');
            const lost = before.reduce((s, f) => s + Math.max(0, f.hpIn - f.hpOut), 0);
            findings.push({
                id: 'route', weight: 2.2 + (1 - last.hpIn / last.maxHp),
                title: elites.length ? '路线贪了' : '带伤进场',
                detail: `进这场时只剩 ${last.hpIn}/${last.maxHp} 气血。${before.length ? `这一幕前面 ${before.length} 战共掉 ${lost} 血${elites.length ? `，其中精英 ${elites.length} 场` : ''}。` : ''}`,
                tryNext: elites.length ? '血线不够时绕开精英，首领前留一个洞府调息。' : '首领前那一格优先走洞府调息；坊市也能买回春丹。',
            });
        }
    }
    // 5. 符袋太杂: lots of tiles (or curses) dilute the sets a build needs.
    const bag = run.bag.length;
    const murk = run.bag.filter(t => t.el === 'zhuo').length;
    if (bag >= 34 || murk >= 3) {
        findings.push({
            id: 'bag', weight: 1.5 + Math.max(0, bag - 30) / 10 + murk * 0.3,
            title: '符袋太杂',
            detail: `结束时符袋 ${bag} 枚${murk ? `，其中浊符 ${murk} 枚` : ''}；想凑的同花、对子、顺子更难同时摸到。`,
            tryNext: '战后奖励不合打法就“不取”或“净符”；坊市与洞府都能净符。',
        });
    }
    // 6. 心法分散: no 诀 got deep while several got a level each.
    const levels = PATTERN_ORDER.map(id => run.patternLv[id] ?? 1);
    const deepest = Math.max(...levels);
    const spread = levels.filter(lv => lv >= 2).length;
    if (run.act >= 2 && deepest <= 2 && spread >= 3) {
        findings.push({
            id: 'spread', weight: 1.6,
            title: '心法升得太散',
            detail: `${spread} 路心法各升了一点，最高只有 ${deepest} 重。`,
            tryNext: `盯住一路往上升${topPattern(run) ? `（你这局最常打的是「${PATTERNS[topPattern(run)].name}」）` : ''}，倍率才会滚起来。`,
        });
    }
    // 7. 法宝栏空着: relics are the biggest multipliers in the game.
    if (run.act >= 2 && run.relics.length <= Math.max(1, run.act - 1)) {
        findings.push({
            id: 'relics', weight: 1.4,
            title: '法宝太少',
            detail: `到第 ${run.act} 幕只带了 ${run.relics.length} 件法宝（栏位 ${run.relicSlots}）。`,
            tryNext: '血量健康时去打精英拿法宝；坊市灵石优先买法宝。',
        });
    }
    // Always leave at least one concrete lever: what this enemy is weak to.
    if (!findings.length && last && ENEMY[last.enemy]) {
        const def = ENEMY[last.enemy];
        findings.push({
            id: 'counter', weight: 1,
            title: `${def.name}属${EL_NAME[def.el]}`,
            detail: `${EL_NAME[counterOf(def.el)]}符克它，点数翻倍；${EL_NAME[KE[def.el]]}符被它克，点数减半。${def.traitText ? def.traitText : ''}`,
            tryNext: `去${def.name}所在的一幕前，多留几枚${EL_NAME[counterOf(def.el)]}符，克制符削罡气 +50%，凑够了就能破势、打断它的重击。`,
        });
    }
    findings.sort((a, b) => b.weight - a.weight);
    return { last, nearMiss, findings: findings.slice(0, 3), style: playStyle(run) };
}
