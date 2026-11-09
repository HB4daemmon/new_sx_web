import { RAGES, RELIC } from './content.js';
import { counterOf, KE } from './elements.js';
import { analyze, assignments, COMBOS, patternValue, QI_PER_FAN, YAKU } from './patterns.js';
import { pactRank } from './pacts.js';
export const has = (run, id) => run.talents.includes(id);
export const relicFlag = (run, flag) => run.relics.reduce((sum, id) => sum + (RELIC[id]?.flags?.[flag] ?? 0), 0);
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
/** Scores one reading of the cast (elements and values fixed): 点数成气 → 各路役番 → 得位 → 共鸣 → 倍符乘区. Order of tiles never matters. */
function stage(run, battle, tiles, els, vals, rage = false) {
    const a = analyze(els, vals, battle.enemy.el, { ling: tiles.map(t => t.mod === 'ling'), huan: tiles.map(t => t.mod === 'huan'), loose: has(run, 'huiyan') });
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
                tq *= relicFlag(run, 'dayNight') ? 5 : 3;
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
        let dFan = 0;
        const fx = { el };
        if (el === 'jin') {
            critChance += 12;
            fx.crit = 12;
            if (run.method === 'yangjian')
                swords += tile.sp === 'jian' ? 2 : 1;
        }
        if (el === 'mu') {
            const h = Math.round(tile.v * dScale * (run.method === 'huichun' ? 1.5 : 1) * (tile.sp === 'chunya' ? 2 : 1) * (resonant.has('mu') ? 3 * res : 1));
            heal += h;
            fx.heal = h;
        }
        if (el === 'shui') {
            const sh = Math.round(tile.v * 2 * dScale * (tile.sp === 'jingang' ? 3 : 1) * (resonant.has('shui') ? 3 * res : 1));
            shield += sh;
            fx.shield = sh;
        }
        if (tile.sp === 'jingang' && battle.player.shield > 0)
            tq += Math.round(battle.player.shield * 0.1);
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
            fx.burn = b;
        }
        if (el === 'tu')
            dFan += (run.method === 'zhulong' ? 1.5 : 0.5) * (resonant.has('tu') ? 2 * res : 1);
        qi += tq;
        fan += dFan;
        const label = tile.el === 'zhuo' ? '浊' : `+${tq}`;
        push({ k: 'tile', label, dQi: tq, dMult: dFan || undefined, index, tag, fx });
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
            const f = hit.fan + plus;
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
        if (a.dewei) {
            yakuFan += a.dewei;
            qi += QI_PER_FAN * a.dewei;
            fan += a.dewei;
            push({ k: 'bonus', label: `得位 ×${a.dewei} ${a.dewei}番`, dQi: QI_PER_FAN * a.dewei, dMult: a.dewei });
        }
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
    return { qi, mult: mult(), steps, critChance, heal, shield, burn, swords, a, intent, comboIntent, yaku, fan: yakuFan };
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
    });
    if (has(run, 'xueji'))
        push('bonus', '血祭 ×1.6', { x: 1.6 });
    if (run.vow === 'suidan')
        push('bonus', '碎丹燃血 ×1.6', { x: 1.6 });
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
        intentGain: Math.round(gain), rage,
    };
}
