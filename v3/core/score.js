import { RELIC } from './content.js';
import { counterOf, KE } from './elements.js';
import { EL_NAME } from './elements.js';
import { analyze, assignments, COMBOS, patternValue, PATTERNS, SET_BY_SIZE } from './patterns.js';
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
const lv = (run, id) => patternValue(id, run.patternLv[id] ?? 1);
/** Scores one element assignment: sets → tiles in order (生 passes qi, 克 multiplies) → 五行 → 共鸣 → 链尾. */
function stage(run, battle, tiles, els) {
    const a = analyze(els, { reverse: has(run, 'nisheng') });
    let qi = 0;
    let mult = 1;
    const steps = [{ k: 'pattern', label: COMBOS[a.combo].name, qi, mult }];
    const push = (step) => steps.push({ ...step, qi, mult });
    // 1 —— 同元成组，可以叠加。
    for (const set of a.sets) {
        const id = SET_BY_SIZE[set.size];
        const v = lv(run, id);
        qi += v.qi;
        mult += v.mult;
        push({ k: 'bonus', label: `${PATTERNS[id].name}·${EL_NAME[set.el]} +${v.qi}气 +${round1(v.mult)}倍`, dQi: v.qi, dMult: v.mult });
    }
    if (a.sets.length >= 2) {
        const x = a.sets[0].size === 3 ? 1.5 : 1.25;
        mult *= x;
        push({ k: 'bonus', label: `${a.sets[0].size === 3 ? '满堂' : '两仪'} ×${x}`, x });
    }
    // 2 —— 依次出符：相生传气，相克乘倍。
    const enemyEl = battle.enemy.el;
    const counter = counterOf(enemyEl);
    const weak = KE[enemyEl];
    const dScale = defenseScale(run);
    const sheng = lv(run, 'sheng');
    const keX = lv(run, 'ke').mult + 0.2 * relicFlag(run, 'keX');
    const flowShare = sheng.qi * (relicFlag(run, 'flowX') ? 2 : 1);
    const tileQi = [];
    let critChance = 5 + relicFlag(run, 'critPct');
    let heal = 0, shield = 0, burn = 0, swords = 0;
    const resonant = new Set(a.sets.filter(st => st.size >= 3).map(st => st.el));
    const res = relicFlag(run, 'resonance') ? 2 : 1;
    tiles.forEach((tile, index) => {
        const el = els[index];
        let tq = tile.v * (tile.mod === 'zhong' ? 2 : 1);
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
            if ((day && (el === 'jin' || el === 'huo')) || (!day && (el === 'shui' || el === 'mu'))) {
                tq *= relicFlag(run, 'dayNight') ? 5 : 3;
                tag = day ? '昼' : '夜';
            }
        }
        const link = index > 0 ? a.links[index - 1] : null;
        let flow = 0;
        if (link === 'sheng')
            flow = Math.round(tileQi[index - 1] * flowShare);
        tq = Math.round(tq) + flow;
        tileQi.push(tq);
        let dMult = link === 'sheng' ? sheng.mult + relicFlag(run, 'linkMult') : 0;
        let x = link === 'ke' ? keX : 1;
        const fx = { el };
        if (el === 'jin') {
            critChance += 12;
            fx.crit = 12;
            if (run.method === 'yangjian')
                swords += 1;
        }
        if (el === 'mu') {
            const h = Math.round(tile.v * dScale * (run.method === 'huichun' ? 2 : 1) * (resonant.has('mu') ? 3 * res : 1));
            heal += h;
            fx.heal = h;
        }
        if (el === 'shui') {
            const sh = Math.round(tile.v * 2 * dScale * (resonant.has('shui') ? 3 * res : 1));
            shield += sh;
            fx.shield = sh;
        }
        if (el === 'huo') {
            const b = tile.v * (relicFlag(run, 'burnDouble') ? 2 : 1) * (run.method === 'yuhuo' ? 2 : 1) * (resonant.has('huo') ? 3 * res : 1);
            burn += b;
            fx.burn = b;
        }
        if (el === 'tu')
            dMult += (run.method === 'zhulong' ? 1.5 : 0.5) * (resonant.has('tu') ? 2 * res : 1);
        if (tile.mod === 'jing')
            dMult += 3;
        if (tile.mod === 'lei') {
            x *= relicFlag(run, 'leiX') ? 2 : 1.5;
            if (has(run, 'leiyin')) {
                critChance += 25;
                fx.crit = (fx.crit ?? 0) + 25;
            }
        }
        qi += tq;
        mult = (mult + dMult) * x;
        const label = tile.el === 'zhuo' ? '浊' : flow ? `+${tq - flow} 生+${flow}` : `+${tq}`;
        steps.push({ k: 'tile', label, qi, mult, dQi: tq, dMult: dMult || undefined, x: x !== 1 ? x : undefined, index, tag, fx, link: link ?? undefined });
    });
    // 3 —— 五行俱全。
    if (a.distinct === 5) {
        const v = lv(run, 'wuxing');
        const extra = a.combo === 'lunzhuan' || a.combo === 'nixing' ? 2 : 0;
        mult += v.mult + extra;
        push({ k: 'bonus', label: `${COMBOS[a.combo].name} +${round1(v.mult + extra)}倍`, dMult: v.mult + extra });
    }
    // 4 —— 共鸣：三枚以上同元。
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
    // 5 —— 相生链尾：一条链传到最后的气，放大链尾元素的效果。
    for (let i = 0; i < tiles.length; i += 1) {
        const endsHere = a.links[i - 1] === 'sheng' && a.links[i] !== 'sheng';
        if (!endsHere || !els[i])
            continue;
        const q = tileQi[i];
        const el = els[i];
        if (el === 'huo') {
            const b = Math.round(q * 0.6);
            burn += b;
            push({ k: 'bonus', label: `链尾·火 焚 +${b}`, index: i });
        }
        if (el === 'shui') {
            const sh = Math.round(q * dScale);
            shield += sh;
            push({ k: 'bonus', label: `链尾·水 盾 +${sh}`, index: i });
        }
        if (el === 'mu') {
            const hl = Math.round(q * 0.6 * dScale);
            heal += hl;
            push({ k: 'bonus', label: `链尾·木 回复 +${hl}`, index: i });
        }
        if (el === 'jin') {
            const c = Math.min(60, q * 2);
            critChance += c;
            push({ k: 'bonus', label: `链尾·金 暴击 +${c}%`, index: i });
        }
        if (el === 'tu') {
            const m = round1(q / 8);
            mult += m;
            push({ k: 'bonus', label: `链尾·土 +${m}倍`, index: i, dMult: m });
        }
    }
    return { qi, mult, steps, critChance, heal, shield, burn, swords, a };
}
/**
 * Scores a cast. Pure apart from the optional crit `roll` (0..1); without a roll
 * the result is a preview and never crits. 灵符 take whichever element scores best.
 */
export function computeCast(run, battle, tiles, rage, roll) {
    let best = null;
    for (const els of assignments(tiles)) {
        const r = finish(run, battle, tiles, stage(run, battle, tiles, els), rage, roll);
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
    const rageX = (pactRank(run, 'dull') ? 2 : 3) + relicFlag(run, 'rageX');
    if (rage)
        push('rage', `怒技 ×${rageX}`, { x: rageX });
    // 污泥莲 and friends see the finished qi/mult; crit is decided last.
    const critChance = Math.min(100, stage.critChance);
    const crit = roll !== undefined && roll * 100 < critChance;
    if (crit)
        push('crit', `暴击 ×${relicFlag(run, 'critX') ? 3 : 2}`, { x: relicFlag(run, 'critX') ? 3 : 2 });
    const gain = COMBOS[match.combo].intent * (run.method === 'benlei' ? 2 : 1) * (has(run, 'tongming') ? 1.5 : 1) + relicFlag(run, 'qiPerCast');
    return {
        tiles, pattern: match.combo, chain: match.shengIdx, keIdx: match.keIdx, analysis: match, els: match.els, steps,
        qi, mult, critChance, crit, damage: Math.floor(qi * mult),
        heal: stage.heal, shield: stage.shield, burn: stage.burn, swords: stage.swords,
        intentGain: Math.round(gain), rage,
    };
}
