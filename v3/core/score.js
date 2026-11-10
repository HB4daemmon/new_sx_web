import { JIJI, RAGES, RELIC, TALENT } from './content.js';
import { counterOf, KE } from './elements.js';
import { analyze, assignments, COMBOS, links, patternValue, PATTERN_ORDER, PATTERNS, QI_PER_FAN, YAKU } from './patterns.js';
import { pactRank } from './pacts.js';
export const has = (run, id) => run.talents.includes(id);
export const relicFlag = (run, flag) => run.relics.reduce((sum, id) => sum + (RELIC[id]?.flags?.[flag] ?? 0), 0) * (run.fate === 'guxing' ? 2 : 1);
const awake = (run, id) => run.fate === id && run.realm >= 2;
export const defenseScale = (run) => 1 + 0.5 * run.realm;
export const isDay = (battle) => battle.turn % 2 === 1;
function applyBump(qi, mult, bump) {
    const dQi = bump.qi ?? 0;
    const dMult = bump.mult ?? 0;
    const x = bump.x ?? 1;
    return { qi: qi + dQi, mult: (mult + dMult) * x };
}
function bumpLabel(bump) {
    const parts = [];
    if (bump.qi)
        parts.push(`+${Math.round(bump.qi)} 气`);
    if (bump.mult)
        parts.push(`+${round1(bump.mult)} 倍`);
    if (bump.x && bump.x !== 1)
        parts.push(`×${round1(bump.x)}`);
    return bump.text ?? parts.join(' ');
}
export const round1 = (n) => Math.round(n * 10) / 10;
/**
 * How many times each tile fires: 相生连跳 makes the k-th tile of a chain fire k times,
 * and relics / talents / 命格 bend that.
 */
export function tileTriggers(run, chainPos, els) {
    const n = chainPos.length;
    const t = chainPos.map(p => p);
    const extra = (has(run, 'lianhuan') ? 1 : 0) + (run.fate === 'liansheng' ? 1 : 0);
    chainPos.forEach((p, i) => { if (p >= 2)
        t[i] += extra; });
    if (relicFlag(run, 'trigX'))
        chainPos.forEach((p, i) => { if (p >= 2)
            t[i] *= 2; });
    const first = chainPos.indexOf(2);
    if (first >= 0 && relicFlag(run, 'firstLinkX'))
        t[first] += 2 * relicFlag(run, 'firstLinkX');
    if (relicFlag(run, 'headTrig'))
        chainPos.forEach((p, i) => { if (p === 1 && chainPos[i + 1] === 2)
            t[i] += relicFlag(run, 'headTrig'); });
    // 洛书：首尾相生（最后一张生第一张）时，每张再触发一次。
    if (relicFlag(run, 'loop') && n >= 3 && links(els[n - 1], els[0]))
        for (let i = 0; i < n; i += 1)
            t[i] += 1;
    return t;
}
/** Scores one reading of the cast (elements and values fixed): 每张符按相生连跳逐次触发 → 各路役番 → 共鸣 → 倍符乘区. Order matters for 相生. */
function stage(run, battle, tiles, els, vals, rage = false) {
    const a = analyze(els, { ling: tiles.map(t => t.mod === 'ling'), keLink: !!relicFlag(run, 'keLink') });
    const triggers = tileTriggers(run, a.chainPos, els);
    let qi = 0;
    let fan = 0;
    let x = 1;
    const mult = () => Math.max(1, fan) * x;
    const steps = [{ k: 'pattern', label: COMBOS[a.combo].name, qi, mult: 1 }];
    const push = (step) => steps.push({ ...step, qi, mult: mult() });
    const enemyEl = battle.enemy.el;
    const counter = counterOf(enemyEl);
    const weak = KE[enemyEl];
    const dScale = defenseScale(run);
    let critChance = 5 + relicFlag(run, 'critPct');
    let heal = 0, shield = 0, burn = 0, swords = 0, intent = 0;
    const resonant = new Set(a.sets.filter(st => st.size >= 3).map(st => st.el));
    const res = relicFlag(run, 'resonance') ? 2 : 1;
    // 1 —— 每张符：点数成气，元素各有效果。
    tiles.forEach((tile, index) => {
        const el = els[index];
        let tq = vals[index];
        let tag;
        if (el && el === counter) {
            tq *= has(run, 'poyang') ? 3 : 2;
            tag = '克';
        }
        else if (el && el === weak) {
            tq *= 0.5;
            tag = '被克';
        }
        if (run.method === 'zhulong' && el) {
            const day = isDay(battle);
            // 烛照九阴: during the 怒技 every element shines.
            if (rage || (day && (el === 'jin' || el === 'huo')) || (!day && (el === 'shui' || el === 'mu'))) {
                tq *= relicFlag(run, 'dayNight') ? 5 : 3.5;
                tag = day ? '昼' : '夜';
            }
        }
        if (tile.sp === 'zhuyin')
            tq *= 2;
        if (tiles.length === 1 && has(run, 'guzhu')) {
            tq *= 3;
            tag = tag ?? '孤';
        }
        tq = Math.round(tq);
        // 偏枯命: the 本命元素 +2, the rest −1.
        if (run.fate === 'pianku' && el)
            tq = Math.max(0, tq + (el === run.fateEl ? 2 : -1));
        const times = Math.max(1, triggers[index]);
        for (let rep = 1; rep <= times; rep += 1) {
            let dFan = 0;
            const fx = { el };
            if (el === 'jin') {
                critChance += 12;
                fx.crit = 12;
                if (run.method === 'yangjian')
                    swords += tile.sp === 'jian' ? 2 : 1;
            }
            if (el === 'mu') {
                const h = Math.round(tile.v * dScale * 1 * (tile.sp === 'chunya' ? 2 : 1) * (resonant.has('mu') ? 3 * res : 1));
                heal += h;
                fx.heal = h;
            }
            if (el === 'shui') {
                const sh = Math.round(tile.v * 2 * dScale * (tile.sp === 'jingang' ? 3 : 1) * (resonant.has('shui') ? 3 * res : 1));
                shield += sh;
                fx.shield = sh;
            }
            let q = tq;
            if (tile.sp === 'jingang' && battle.player.shield > 0)
                q += Math.round(battle.player.shield * 0.1);
            if (tile.sp === 'huozhong' && battle.enemy.burn > 0) {
                const b = Math.round(battle.enemy.burn / 2);
                burn += b;
                fx.burn = (fx.burn ?? 0) + b;
            }
            if (tile.sp === 'leiyin')
                intent += 25;
            if (el === 'huo') {
                const b = tile.v * (relicFlag(run, 'burnDouble') ? 2 : 1) * (run.method === 'yuhuo' ? 2 : 1) * (resonant.has('huo') ? 3 * res : 1);
                burn += b;
                fx.burn = (fx.burn ?? 0) + b;
            }
            if (el === 'tu')
                dFan += (run.method === 'zhulong' ? 1.5 : 0.5) * (resonant.has('tu') ? 2 * res : 1);
            // 算盘：每次再触发另加气；源生：每一跳回复气血。
            if (rep > 1)
                q += 6 * relicFlag(run, 'trigQi');
            if (rep === 1 && a.chainPos[index] >= 2 && has(run, 'yuansheng')) {
                heal += 3;
                fx.heal = (fx.heal ?? 0) + 3;
            }
            qi += q;
            fan += dFan;
            const label = tile.el === 'zhuo' ? '浊' : rep > 1 ? `+${q} 连跳` : `+${q}`;
            push({ k: 'tile', label, dQi: q, dMult: dFan || undefined, index, tag, fx, rep });
        }
    });
    // 2 —— 各路最高的役（心法每重 +1 番），每番另带 10 气。
    const yaku = [];
    let yakuFan = 0;
    if (a.tian) {
        yaku.push(a.tian);
        qi += QI_PER_FAN * 10;
        fan += a.tian.fan;
        yakuFan = a.tian.fan;
        push({ k: 'bonus', label: `天成·${YAKU[a.tian.id].name} ${a.tian.fan}番`, dQi: QI_PER_FAN * 10, dMult: a.tian.fan });
    }
    else {
        for (const hit of a.yaku) {
            const def = YAKU[hit.id];
            const plus = patternValue(def.path, run.patternLv[def.path] ?? 1).fan;
            // 连生命：同元的役番数 −1。
            const f = Math.max(0, hit.fan + plus - (run.fate === 'liansheng' && def.path === 'yuan' ? 1 : 0));
            yaku.push({ id: hit.id, fan: f });
            yakuFan += f;
            qi += QI_PER_FAN * f;
            fan += f;
            push({ k: 'bonus', label: `${def.name} ${f}番${plus ? `（心法+${plus}）` : ''}`, dQi: QI_PER_FAN * f, dMult: f });
        }
        const bao = tiles.filter(t => t.mod === 'bao').length;
        if (bao) {
            yakuFan += bao;
            qi += QI_PER_FAN * bao;
            fan += bao;
            push({ k: 'bonus', label: `宝符 ×${bao} ${bao}番`, dQi: QI_PER_FAN * bao, dMult: bao });
        }
        // 连生命 化境：每一跳 +1 番。
        if (awake(run, 'liansheng') && a.links) {
            yakuFan += a.links;
            qi += QI_PER_FAN * a.links;
            fan += a.links;
            push({ k: 'bonus', label: `连生·化境 ${a.links}番`, dQi: QI_PER_FAN * a.links, dMult: a.links });
        }
        // 星宿命: this battle's 宿 doubles one 路.
        for (const star of [battle.stacks.star, battle.stacks.star2]) {
            if (star === undefined || run.fate !== 'xingxiu')
                continue;
            const path = PATTERN_ORDER[star];
            const hit = yaku.find(y => YAKU[y.id].path === path);
            if (!hit)
                continue;
            yakuFan += hit.fan;
            qi += QI_PER_FAN * hit.fan;
            fan += hit.fan;
            push({ k: 'bonus', label: `星宿·${PATTERNS[path].name} 再 ${hit.fan}番`, dQi: QI_PER_FAN * hit.fan, dMult: hit.fan });
        }
        // 本门役: the method's own 路 — reads the fight, not just the tiles.
        const ben = benmenYaku(run, battle, tiles, els, rage);
        if (ben) {
            yaku.push(ben);
            yakuFan += ben.fan;
            qi += QI_PER_FAN * ben.fan;
            fan += ben.fan;
            push({ k: 'bonus', label: `本门·${YAKU[ben.id].name} ${ben.fan}番`, dQi: QI_PER_FAN * ben.fan, dMult: ben.fan });
        }
        // 偏枯命 化境 / 守拙命 化境.
        if (awake(run, 'pianku') && els.filter(e => e === run.fateEl).length >= 3) {
            yakuFan += 3;
            qi += QI_PER_FAN * 3;
            fan += 3;
            push({ k: 'bonus', label: '偏枯·化境 3番', dQi: QI_PER_FAN * 3, dMult: 3 });
        }
        if (awake(run, 'shouzhuo') && tiles.length >= 5) {
            yakuFan += 2;
            qi += QI_PER_FAN * 2;
            fan += 2;
            push({ k: 'bonus', label: '守拙·化境 2番', dQi: QI_PER_FAN * 2, dMult: 2 });
        }
    }
    // 既济：一组相克元素各 2 张以上（天赋）。
    for (const [id, j] of Object.entries(JIJI)) {
        if (!has(run, id) || els.filter(e => e === j.a).length < 2 || els.filter(e => e === j.b).length < 2)
            continue;
        const f = id === 'jiji_tushui' ? 6 : 4;
        yakuFan += f;
        qi += QI_PER_FAN * f;
        fan += f;
        if (id === 'jiji_shuihuo') {
            shield *= 2;
            burn *= 2;
        }
        if (id === 'jiji_jinmu')
            critChance += 30;
        if (id === 'jiji_mutu')
            heal *= 2;
        if (id === 'jiji_huojin')
            x *= 1.2;
        push({ k: 'bonus', label: `${TALENT[id].name} ${f}番${j.extra && id !== 'jiji_tushui' ? `，${j.extra}` : ''}`, dQi: QI_PER_FAN * f, dMult: f });
    }
    // 3 —— 共鸣：三张以上同元素。
    if (resonant.has('jin')) {
        const c = (a.sets.find(st => st.el === 'jin').size >= 4 ? 100 : 50) * res;
        critChance += c;
        push({ k: 'bonus', label: `共鸣·金 暴击 +${c}%` });
    }
    if (resonant.has('mu'))
        push({ k: 'bonus', label: `共鸣·木 回复 ×${3 * res}` });
    if (resonant.has('shui'))
        push({ k: 'bonus', label: `共鸣·水 护盾 ×${3 * res}` });
    if (resonant.has('huo'))
        push({ k: 'bonus', label: `共鸣·火 灼烧 ×${3 * res}` });
    if (resonant.has('tu'))
        push({ k: 'bonus', label: `共鸣·土 镇 ×${2 * res}` });
    // 4 —— 倍符：乘区。
    tiles.forEach((tile, index) => {
        if (tile.mod !== 'lei')
            return;
        const lx = relicFlag(run, 'leiX') ? 2 : 1.5;
        x *= lx;
        if (has(run, 'leiyin'))
            critChance += 25;
        push({ k: 'bonus', label: `倍符 ×${lx}`, x: lx, index });
    });
    const comboIntent = a.tian ? 50 : Math.min(50, 8 + 3 * yakuFan);
    // 罡气：克制敌人的符每张削罡气 +50%，土符 +25%（镇岳印再 +25%）。
    const nCounter = els.filter(e => e && e === counter).length;
    const nTu = els.filter(e => e === 'tu').length;
    const guardMult = 1 + 0.5 * nCounter + (0.25 + 0.25 * relicFlag(run, 'tuGuard')) * nTu + 0.5 * relicFlag(run, 'guardX') + (has(run, 'gangjin') ? 0.3 : 0);
    return { qi, mult: mult(), steps, critChance, heal, shield, burn, swords, a, intent, comboIntent, yaku, fan: yakuFan, triggers, guardMult };
}
/** The best 本门役 this cast earns for the run's method (null if none). */
export function benmenYaku(run, battle, tiles, els, rage) {
    const n = (...want) => els.filter(e => e && want.includes(e)).length;
    const hit = (id) => ({ id, fan: YAKU[id].fan });
    const p = battle.player, e = battle.enemy;
    switch (run.method) {
        case 'yangjian':
            if (n('jin') >= 3 && battle.swords >= 10)
                return hit('wanjian');
            if (n('jin') >= 2 && battle.swords >= 5)
                return hit('jianzhen');
            return null;
        case 'yuhuo':
            if (!n('huo') || e.burn <= 0)
                return null;
            if (e.burn >= e.hp * 0.2)
                return hit('fenyuan');
            if (e.burn >= e.hp * 0.05)
                return hit('liaoyuan');
            return null;
        case 'jingang':
            if (p.shield >= p.maxHp * 0.6)
                return { id: 'buhuai', fan: Math.min(has(run, 'budong') ? 15 : 10, Math.floor((p.shield / p.maxHp) * 10)) };
            if (p.shield >= p.maxHp * 0.25)
                return hit('jinshen');
            return null;
        case 'benlei':
            if (rage && battle.stacks.thunder)
                return hit('lianlei');
            if (tiles.some(t => t.mod === 'lei' || t.sp === 'leiyin'))
                return hit('leiming');
            return null;
        case 'huichun':
            if (battle.spring >= p.maxHp / 2)
                return hit('wanmu');
            if (p.hp >= p.maxHp)
                return hit('chunman');
            return null;
        case 'zhulong': {
            // 烛阴符 counts on both sides.
            const zhuyin = tiles.filter(t => t.sp === 'zhuyin').length;
            const side = (want) => tiles.filter((t, i) => t.sp !== 'zhuyin' && els[i] && want.includes(els[i])).length + zhuyin;
            const day = side(['jin', 'huo']), night = side(['shui', 'mu']);
            if (tiles.length < 2)
                return null;
            if (day >= 2 && night >= 2)
                return hit('riyue');
            if (day && night)
                return hit('zhouye');
            return null;
        }
    }
    return null;
}
/**
 * Scores a cast. Pure apart from the optional crit `roll` (0..1); without a roll
 * the result is a preview and never crits. 灵符 take whichever element scores best.
 */
export function computeCast(run, battle, tiles, rage, roll) {
    let best = null;
    for (const { els, vals } of assignments(tiles)) {
        const r = finish(run, battle, tiles, stage(run, battle, tiles, els, vals, rage), rage, roll);
        if (!best || r.damage > best.damage)
            best = r;
    }
    return best;
}
function finish(run, battle, tiles, st, rage, roll) {
    const match = st.a;
    const stage = st;
    const steps = [...stage.steps];
    let { qi, mult } = stage;
    const push = (k, label, bump, extra = {}) => {
        ({ qi, mult } = applyBump(qi, mult, bump));
        steps.push({ k, label: label || bumpLabel(bump), qi, mult, dQi: bump.qi, dMult: bump.mult, x: bump.x, ...extra });
    };
    const castIndex = battle.castCount + 1;
    // Method & persistent battle bonuses.
    if (run.method === 'jingang' && battle.player.shield > 0) {
        const add = Math.round(battle.player.shield * (relicFlag(run, 'shieldBolt') ? 0.7 : 0.3));
        if (add)
            push('bonus', `盈盾化雷 +${add} 气`, { qi: add });
    }
    if (run.method === 'huichun' && battle.spring > 0)
        push('bonus', `春华 +${Math.round(battle.spring)} 气`, { qi: Math.round(battle.spring) });
    if (run.method === 'benlei' && battle.stacks.thunder)
        push('bonus', `雷引 +${battle.stacks.thunder} 倍`, { mult: battle.stacks.thunder });
    if (relicFlag(run, 'shieldQi') && battle.player.shield > 0)
        push('bonus', `铁壁神铳 +${Math.round(battle.player.shield / 2)} 气`, { qi: Math.round(battle.player.shield / 2) });
    if (battle.stacks.overheal)
        push('bonus', `玉液 +${battle.stacks.overheal} 气`, { qi: battle.stacks.overheal });
    if (battle.stacks.drum)
        push('bonus', `震岳 +${battle.stacks.drum} 气`, { qi: battle.stacks.drum });
    if (has(run, 'jieshi') && battle.stacks.incoming)
        push('bonus', `借势 +${Math.round(battle.stacks.incoming / 2)} 气`, { qi: Math.round(battle.stacks.incoming / 2) });
    // Relics fire left to right — order matters.
    const ctxBase = { run, battle, tiles, els: match.els, pattern: match.combo, a: match, rage, castIndex };
    run.relics.forEach((id, slot) => {
        let def = RELIC[id];
        if (!def)
            return;
        let label = '';
        if (id === 'kunlun') {
            const right = RELIC[run.relics[slot + 1]];
            if (!right?.score || right.id === 'kunlun')
                return;
            def = right;
            label = `镜映·${right.name}`;
        }
        if (!def.score)
            return;
        const ctx = { ...ctxBase, qi, mult, slot };
        const bump = def.score(ctx);
        if (!bump)
            return;
        push('relic', label ? `${label} ${bumpLabel(bump)}` : bumpLabel(bump), bump, { relic: id, index: slot });
        // 孤星命: every relic fires twice.
        if (run.fate === 'guxing')
            push('relic', `孤星·再 ${bumpLabel(bump)}`, bump, { relic: id, index: slot });
    });
    if (run.fate === 'shouzhuo' && tiles.length >= 5)
        push('bonus', '守拙 ×1.5', { x: 1.5 });
    if (run.fate === 'shouzhuo' && tiles.length <= 2)
        push('bonus', '守拙 ×0.6', { x: 0.6 });
    if (has(run, 'xueji'))
        push('bonus', '血祭 ×1.6', { x: 1.6 });
    if (run.vow === 'suidan')
        push('bonus', '碎丹燃血 ×1.6', { x: 1.6 });
    const vuln = !!battle.stacks.vuln;
    if (vuln) {
        const vx = relicFlag(run, 'vulnX') ? 3 : 1.5;
        push('bonus', `破势 ×${vx}`, { x: vx });
    }
    let rageHeal = 0;
    if (rage) {
        const dull = pactRank(run, 'dull') ? 1 : 0;
        const extra = relicFlag(run, 'rageX') - dull;
        const def = RAGES[run.method];
        let x = 3;
        if (run.method === 'yangjian')
            x = Math.max(2, 1 + 0.25 * Math.min(battle.swords + stage.swords, 15 + relicFlag(run, 'swordCap')));
        if (run.method === 'yuhuo')
            x = 2;
        if (run.method === 'jingang') {
            x = 2.5;
            if (battle.player.shield > 0)
                push('bonus', `金刚伏魔 护盾化气 +${Math.round(battle.player.shield)}`, { qi: Math.round(battle.player.shield) });
        }
        if (run.method === 'benlei')
            x = 2.5;
        if (run.method === 'huichun') {
            x = 2;
            if (battle.spring > 0)
                push('bonus', `春雷 春华×3 +${Math.round(battle.spring * 3)}`, { qi: Math.round(battle.spring * 3) });
            rageHeal = Math.round(battle.player.maxHp * 0.2);
        }
        x = Math.max(1.5, round1(x + extra));
        push('rage', `${def?.name ?? '怒技'} ×${x}`, { x });
    }
    // 污泥莲 and friends see the finished qi/mult; crit is decided last.
    const critChance = Math.min(100, stage.critChance);
    const crit = roll !== undefined && roll * 100 < critChance;
    if (crit)
        push('crit', `暴击 ×${relicFlag(run, 'critX') ? 3 : 2}`, { x: relicFlag(run, 'critX') ? 3 : 2 });
    const gain = stage.comboIntent * (run.method === 'benlei' ? 2 : 1) * (has(run, 'tongming') ? 1.5 : 1) + relicFlag(run, 'qiPerCast') + stage.intent;
    return {
        tiles, pattern: match.combo, yaku: stage.yaku, fan: stage.fan, analysis: match, els: match.els, steps,
        qi, mult, critChance, crit, damage: Math.floor(qi * mult),
        heal: stage.heal + rageHeal, shield: stage.shield, burn: stage.burn, swords: stage.swords,
        intentGain: Math.round(gain), rage, triggers: stage.triggers, guardMult: stage.guardMult, vuln,
    };
}
