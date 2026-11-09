import { JIJI, RAGES, RELIC, TALENT, type ScoreCtx, type Bump } from './content.js';
import { counterOf, KE, type El } from './elements.js';
import { analyze, assignments, COMBOS, isDewei, patternValue, PATTERN_ORDER, PATTERNS, QI_PER_FAN, YAKU, type Analysis, type YakuHit } from './patterns.js';
import type { BattleState, ComboId, PatternId, RunState, Tile } from './types.js';
import { pactRank } from './pacts.js';

export type StepKind = 'pattern' | 'tile' | 'bonus' | 'relic' | 'rage' | 'crit';
export interface Step {
  k: StepKind;
  label: string;
  /** Running totals after this step. */
  qi: number;
  mult: number;
  dQi?: number;
  dMult?: number;
  x?: number;
  index?: number;
  relic?: string;
  tag?: '克' | '被克' | '昼' | '夜' | '孤';
  fx?: { el: El | null; heal?: number; shield?: number; burn?: number; crit?: number };
}

export interface CastResult {
  tiles: Tile[];
  pattern: ComboId;
  /** 役 actually scored (心法 included), and their 番 total (天成: its fixed 番). */
  yaku: YakuHit[];
  fan: number;
  analysis: Analysis;
  els: (El | null)[];
  steps: Step[];
  qi: number;
  mult: number;
  critChance: number;
  crit: boolean;
  damage: number;
  heal: number;
  shield: number;
  burn: number;
  swords: number;
  intentGain: number;
  rage: boolean;
}

export const has = (run: RunState, id: string) => run.talents.includes(id);
export const relicFlag = (run: RunState, flag: string) =>
  run.relics.reduce((sum, id) => sum + (RELIC[id]?.flags?.[flag as never] ?? 0), 0) * (run.fate === 'guxing' ? 2 : 1);
const awake = (run: RunState, id: string) => run.fate === id && run.realm >= 2;
export const defenseScale = (run: RunState) => 1 + 0.5 * run.realm;
export const isDay = (battle: BattleState) => battle.turn % 2 === 1;

function applyBump(qi: number, mult: number, bump: Bump) {
  const dQi = bump.qi ?? 0;
  const dMult = bump.mult ?? 0;
  const x = bump.x ?? 1;
  return { qi: qi + dQi, mult: (mult + dMult) * x };
}

function bumpLabel(bump: Bump): string {
  const parts: string[] = [];
  if (bump.qi) parts.push(`+${Math.round(bump.qi)} 气`);
  if (bump.mult) parts.push(`+${round1(bump.mult)} 倍`);
  if (bump.x && bump.x !== 1) parts.push(`×${round1(bump.x)}`);
  return bump.text ?? parts.join(' ');
}
export const round1 = (n: number) => Math.round(n * 10) / 10;

interface Stage { qi: number; mult: number; steps: Step[]; critChance: number; heal: number; shield: number; burn: number; swords: number; a: Analysis; intent: number; comboIntent: number; yaku: YakuHit[]; fan: number }

/** Scores one reading of the cast (elements and values fixed): 点数成气 → 各路役番 → 得位 → 共鸣 → 倍符乘区. Order of tiles never matters. */
function stage(run: RunState, battle: BattleState, tiles: Tile[], els: (El | null)[], vals: number[], rage = false): Stage {
  const a = analyze(els, vals, battle.enemy.el, { ling: tiles.map(t => t.mod === 'ling'), huan: tiles.map(t => t.mod === 'huan'), loose: has(run, 'huiyan') });
  let qi = 0;
  let fan = 0;
  let x = 1;
  const mult = () => Math.max(1, fan) * x;
  const steps: Step[] = [{ k: 'pattern', label: COMBOS[a.combo].name, qi, mult: 1 }];
  const push = (step: Omit<Step, 'qi' | 'mult'>) => steps.push({ ...step, qi, mult: mult() });
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
    let tag: Step['tag'];
    if (el && el === counter) { tq *= has(run, 'poyang') ? 3 : 2; tag = '克'; }
    else if (el && el === weak) { tq *= 0.5; tag = '被克'; }
    if (run.method === 'zhulong' && el) {
      const day = isDay(battle);
      // 烛照九阴: during the 怒技 every element shines.
      if (rage || (day && (el === 'jin' || el === 'huo')) || (!day && (el === 'shui' || el === 'mu'))) { tq *= relicFlag(run, 'dayNight') ? 5 : 3; tag = day ? '昼' : '夜'; }
    }
    if (tile.sp === 'zhuyin') tq *= 2;
    if (tiles.length === 1 && has(run, 'guzhu')) { tq *= 3; tag = tag ?? '孤'; }
    tq = Math.round(tq);
    // 河图命: tiles off their 河图数 lose a point; 偏枯命: the 本命元素 +2, the rest −1.
    if (run.fate === 'hetu' && el && !isDewei(el, vals[index])) tq = Math.max(0, tq - 1);
    if (run.fate === 'pianku' && el) tq = Math.max(0, tq + (el === run.fateEl ? 2 : -1));
    let dFan = 0;
    const fx: Step['fx'] = { el };
    if (el === 'jin') { critChance += 12; fx.crit = 12; if (run.method === 'yangjian') swords += tile.sp === 'jian' ? 2 : 1; }
    if (el === 'mu') { const h = Math.round(tile.v * dScale * (run.method === 'huichun' ? 1.5 : 1) * (tile.sp === 'chunya' ? 2 : 1) * (resonant.has('mu') ? 3 * res : 1)); heal += h; fx.heal = h; }
    if (el === 'shui') { const sh = Math.round(tile.v * 2 * dScale * (tile.sp === 'jingang' ? 3 : 1) * (resonant.has('shui') ? 3 * res : 1)); shield += sh; fx.shield = sh; }
    if (tile.sp === 'jingang' && battle.player.shield > 0) tq += Math.round(battle.player.shield * 0.1);
    if (tile.sp === 'huozhong' && battle.enemy.burn > 0) { const b = Math.round(battle.enemy.burn / 2); burn += b; fx.burn = (fx.burn ?? 0) + b; }
    if (tile.sp === 'leiyin') intent += 25;
    if (el === 'huo') { const b = tile.v * (relicFlag(run, 'burnDouble') ? 2 : 1) * (run.method === 'yuhuo' ? 2 : 1) * (resonant.has('huo') ? 3 * res : 1); burn += b; fx.burn = b; }
    if (el === 'tu') dFan += (run.method === 'zhulong' ? 1.5 : 0.5) * (resonant.has('tu') ? 2 * res : 1);
    qi += tq;
    fan += dFan;
    const label = tile.el === 'zhuo' ? '浊' : `+${tq}`;
    push({ k: 'tile', label, dQi: tq, dMult: dFan || undefined, index, tag, fx });
  });
  // 2 —— 各路最高的役（心法每重 +1 番），每番另带 10 气。
  const yaku: YakuHit[] = [];
  let yakuFan = 0;
  if (a.tian) {
    yaku.push(a.tian);
    qi += QI_PER_FAN * 10;
    fan += a.tian.fan;
    yakuFan = a.tian.fan;
    push({ k: 'bonus', label: `天成·${YAKU[a.tian.id].name} ${a.tian.fan}番`, dQi: QI_PER_FAN * 10, dMult: a.tian.fan });
  } else {
    for (const hit of a.yaku) {
      const def = YAKU[hit.id];
      const plus = patternValue(def.path as PatternId, run.patternLv[def.path as PatternId] ?? 1).fan;
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
      const df = a.dewei * (run.fate === 'hetu' ? 2 : 1);
      yakuFan += df;
      qi += QI_PER_FAN * df;
      fan += df;
      push({ k: 'bonus', label: `得位 ×${a.dewei} ${df}番${run.fate === 'hetu' ? '（河图命）' : ''}`, dQi: QI_PER_FAN * df, dMult: df });
    }
    // 星宿命: this battle's 宿 doubles one 路.
    for (const star of [battle.stacks.star, battle.stacks.star2]) {
      if (star === undefined || run.fate !== 'xingxiu') continue;
      const path = PATTERN_ORDER[star];
      const hit = yaku.find(y => YAKU[y.id].path === path);
      if (!hit) continue;
      yakuFan += hit.fan; qi += QI_PER_FAN * hit.fan; fan += hit.fan;
      push({ k: 'bonus', label: `星宿·${PATTERNS[path].name} 再 ${hit.fan}番`, dQi: QI_PER_FAN * hit.fan, dMult: hit.fan });
    }
    // 偏枯命 化境 / 守拙命 化境.
    if (awake(run, 'pianku') && els.filter(e => e === run.fateEl).length >= 3) { yakuFan += 3; qi += QI_PER_FAN * 3; fan += 3; push({ k: 'bonus', label: '偏枯·化境 3番', dQi: QI_PER_FAN * 3, dMult: 3 }); }
    if (awake(run, 'shouzhuo') && tiles.length >= 5) { yakuFan += 2; qi += QI_PER_FAN * 2; fan += 2; push({ k: 'bonus', label: '守拙·化境 2番', dQi: QI_PER_FAN * 2, dMult: 2 }); }
  }
  // 既济：一组相克元素各 2 张以上（天赋）。
  for (const [id, j] of Object.entries(JIJI)) {
    if (!has(run, id) || els.filter(e => e === j.a).length < 2 || els.filter(e => e === j.b).length < 2) continue;
    const f = id === 'jiji_tushui' ? 6 : 4;
    yakuFan += f; qi += QI_PER_FAN * f; fan += f;
    if (id === 'jiji_shuihuo') { shield *= 2; burn *= 2; }
    if (id === 'jiji_jinmu') critChance += 30;
    if (id === 'jiji_mutu') heal *= 2;
    if (id === 'jiji_huojin') x *= 1.2;
    push({ k: 'bonus', label: `${TALENT[id].name} ${f}番${j.extra && id !== 'jiji_tushui' ? `，${j.extra}` : ''}`, dQi: QI_PER_FAN * f, dMult: f });
  }
  // 3 —— 共鸣：三张以上同元素。
  if (resonant.has('jin')) { const c = (a.sets.find(st => st.el === 'jin')!.size >= 4 ? 100 : 50) * res; critChance += c; push({ k: 'bonus', label: `共鸣·金 暴击 +${c}%` }); }
  if (resonant.has('mu')) push({ k: 'bonus', label: `共鸣·木 回复 ×${3 * res}` });
  if (resonant.has('shui')) push({ k: 'bonus', label: `共鸣·水 护盾 ×${3 * res}` });
  if (resonant.has('huo')) push({ k: 'bonus', label: `共鸣·火 灼烧 ×${3 * res}` });
  if (resonant.has('tu')) push({ k: 'bonus', label: `共鸣·土 镇 ×${2 * res}` });
  // 4 —— 倍符：乘区。
  tiles.forEach((tile, index) => {
    if (tile.mod !== 'lei') return;
    const lx = relicFlag(run, 'leiX') ? 2 : 1.5;
    x *= lx;
    if (has(run, 'leiyin')) critChance += 25;
    push({ k: 'bonus', label: `倍符 ×${lx}`, x: lx, index });
  });
  const comboIntent = a.tian ? 50 : Math.min(50, 8 + 3 * yakuFan);
  return { qi, mult: mult(), steps, critChance, heal, shield, burn, swords, a, intent, comboIntent, yaku, fan: yakuFan };
}

/**
 * Scores a cast. Pure apart from the optional crit `roll` (0..1); without a roll
 * the result is a preview and never crits. 灵符 take whichever element scores best.
 */
export function computeCast(run: RunState, battle: BattleState, tiles: Tile[], rage: boolean, roll?: number): CastResult {
  let best: CastResult | null = null;
  for (const { els, vals } of assignments(tiles)) {
    const r = finish(run, battle, tiles, stage(run, battle, tiles, els, vals, rage), rage, roll);
    if (!best || r.damage > best.damage) best = r;
  }
  return best!;
}

function finish(run: RunState, battle: BattleState, tiles: Tile[], st: Stage, rage: boolean, roll?: number): CastResult {
  const match = st.a;
  const stage = st;
  const steps = [...stage.steps];
  let { qi, mult } = stage;
  const push = (k: StepKind, label: string, bump: Bump, extra: Partial<Step> = {}) => {
    ({ qi, mult } = applyBump(qi, mult, bump));
    steps.push({ k, label: label || bumpLabel(bump), qi, mult, dQi: bump.qi, dMult: bump.mult, x: bump.x, ...extra });
  };
  const castIndex = battle.castCount + 1;

  // Method & persistent battle bonuses.
  if (run.method === 'jingang' && battle.player.shield > 0) {
    const add = Math.round(battle.player.shield * (relicFlag(run, 'shieldBolt') ? 0.7 : 0.3));
    if (add) push('bonus', `盈盾化雷 +${add} 气`, { qi: add });
  }
  if (run.method === 'huichun' && battle.spring > 0) push('bonus', `春华 +${Math.round(battle.spring)} 气`, { qi: Math.round(battle.spring) });
  if (run.method === 'benlei' && battle.stacks.thunder) push('bonus', `雷引 +${battle.stacks.thunder} 倍`, { mult: battle.stacks.thunder });
  if (relicFlag(run, 'shieldQi') && battle.player.shield > 0) push('bonus', `铁壁神铳 +${Math.round(battle.player.shield / 2)} 气`, { qi: Math.round(battle.player.shield / 2) });
  if (battle.stacks.overheal) push('bonus', `玉液 +${battle.stacks.overheal} 气`, { qi: battle.stacks.overheal });
  if (battle.stacks.drum) push('bonus', `震岳 +${battle.stacks.drum} 气`, { qi: battle.stacks.drum });
  if (has(run, 'jieshi') && battle.stacks.incoming) push('bonus', `借势 +${Math.round(battle.stacks.incoming / 2)} 气`, { qi: Math.round(battle.stacks.incoming / 2) });

  // Relics fire left to right — order matters.
  const ctxBase = { run, battle, tiles, els: match.els, pattern: match.combo, a: match, rage, castIndex };
  run.relics.forEach((id, slot) => {
    let def = RELIC[id];
    if (!def) return;
    let label = '';
    if (id === 'kunlun') {
      const right = RELIC[run.relics[slot + 1]];
      if (!right?.score || right.id === 'kunlun') return;
      def = right;
      label = `镜映·${right.name}`;
    }
    if (!def.score) return;
    const ctx: ScoreCtx = { ...ctxBase, qi, mult, slot };
    const bump = def.score(ctx);
    if (!bump) return;
    push('relic', label ? `${label} ${bumpLabel(bump)}` : bumpLabel(bump), bump, { relic: id, index: slot });
    // 孤星命: every relic fires twice.
    if (run.fate === 'guxing') push('relic', `孤星·再 ${bumpLabel(bump)}`, bump, { relic: id, index: slot });
  });

  if (run.fate === 'shouzhuo' && tiles.length >= 5) push('bonus', '守拙 ×1.5', { x: 1.5 });
  if (run.fate === 'shouzhuo' && tiles.length <= 2) push('bonus', '守拙 ×0.6', { x: 0.6 });
  if (has(run, 'xueji')) push('bonus', '血祭 ×1.6', { x: 1.6 });
  if (run.vow === 'suidan') push('bonus', '碎丹燃血 ×1.6', { x: 1.6 });
  let rageHeal = 0;
  if (rage) {
    const dull = pactRank(run, 'dull') ? 1 : 0;
    const extra = relicFlag(run, 'rageX') - dull;
    const def = RAGES[run.method];
    let x = 3;
    if (run.method === 'yangjian') x = Math.max(2, 1 + 0.25 * Math.min(battle.swords + stage.swords, 15 + relicFlag(run, 'swordCap')));
    if (run.method === 'yuhuo') x = 2;
    if (run.method === 'jingang') { x = 2.5; if (battle.player.shield > 0) push('bonus', `金刚伏魔 护盾化气 +${Math.round(battle.player.shield)}`, { qi: Math.round(battle.player.shield) }); }
    if (run.method === 'benlei') x = 2.5;
    if (run.method === 'huichun') { x = 2; if (battle.spring > 0) push('bonus', `春雷 春华×3 +${Math.round(battle.spring * 3)}`, { qi: Math.round(battle.spring * 3) }); rageHeal = Math.round(battle.player.maxHp * 0.2); }
    x = Math.max(1.5, round1(x + extra));
    push('rage', `${def?.name ?? '怒技'} ×${x}`, { x });
  }

  // 污泥莲 and friends see the finished qi/mult; crit is decided last.
  const critChance = Math.min(100, stage.critChance);
  const crit = roll !== undefined && roll * 100 < critChance;
  if (crit) push('crit', `暴击 ×${relicFlag(run, 'critX') ? 3 : 2}`, { x: relicFlag(run, 'critX') ? 3 : 2 });

  const gain = stage.comboIntent * (run.method === 'benlei' ? 2 : 1) * (has(run, 'tongming') ? 1.5 : 1) + relicFlag(run, 'qiPerCast') + stage.intent;
  return {
    tiles, pattern: match.combo, yaku: stage.yaku, fan: stage.fan, analysis: match, els: match.els, steps,
    qi, mult, critChance, crit, damage: Math.floor(qi * mult),
    heal: stage.heal + rageHeal, shield: stage.shield, burn: stage.burn, swords: stage.swords,
    intentGain: Math.round(gain), rage,
  };
}
