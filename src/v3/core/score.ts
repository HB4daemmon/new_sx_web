import { RELIC, type ScoreCtx, type Bump } from './content.js';
import { counterOf, KE, type El } from './elements.js';
import { detectPatterns, patternValue, PATTERNS, type PatternMatch } from './patterns.js';
import type { BattleState, PatternId, RunState, Tile } from './types.js';

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
  tag?: '克' | '被克' | '昼' | '夜';
  fx?: { el: El | null; heal?: number; shield?: number; burn?: number; crit?: number };
}

export interface CastResult {
  tiles: Tile[];
  pattern: PatternId;
  chain: number[];
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
  run.relics.reduce((sum, id) => sum + (RELIC[id]?.flags?.[flag as never] ?? 0), 0);
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

interface TileStage { qi: number; mult: number; steps: Step[]; critChance: number; heal: number; shield: number; burn: number; swords: number }

function tileStage(run: RunState, battle: BattleState, tiles: Tile[], match: PatternMatch): TileStage {
  const level = run.patternLv[match.id] ?? 1;
  const base = patternValue(match.id, level);
  let qi = base.qi;
  let mult = base.mult;
  const steps: Step[] = [{ k: 'pattern', label: `${PATTERNS[match.id].name}${level > 1 ? ` ${level}重` : ''}`, qi, mult, dQi: base.qi, dMult: base.mult }];
  const enemyEl = battle.enemy.el;
  const counter = counterOf(enemyEl);
  const weak = KE[enemyEl];
  const dScale = defenseScale(run);
  let critChance = 5 + relicFlag(run, 'critPct');
  let heal = 0, shield = 0, burn = 0, swords = 0;
  tiles.forEach((tile, index) => {
    const el = match.assigned[index];
    let tq = tile.v * (tile.mod === 'zhong' ? 2 : 1);
    let tag: Step['tag'];
    if (el && el === counter) { tq *= has(run, 'poyang') ? 3 : 2; tag = '克'; }
    else if (el && el === weak) { tq *= 0.5; tag = '被克'; }
    if (run.method === 'zhulong' && el) {
      const day = isDay(battle);
      if ((day && (el === 'jin' || el === 'huo')) || (!day && (el === 'shui' || el === 'mu'))) { tq *= 3; tag = day ? '昼' : '夜'; }
    }
    tq = Math.round(tq);
    let dMult = 0;
    let x = 1;
    const fx: Step['fx'] = { el };
    if (el === 'jin') { critChance += 12; fx.crit = 12; if (run.method === 'yangjian') swords += 1; }
    if (el === 'mu') { const h = Math.round(tile.v * dScale * (run.method === 'huichun' ? 2 : 1)); heal += h; fx.heal = h; }
    if (el === 'shui') { const s = Math.round(tile.v * 2 * dScale); shield += s; fx.shield = s; }
    if (el === 'huo') { const b = tile.v * (relicFlag(run, 'burnDouble') ? 2 : 1) * (run.method === 'yuhuo' ? 2 : 1); burn += b; fx.burn = b; }
    if (el === 'tu') dMult += run.method === 'zhulong' ? 1.5 : 0.5;
    if (tile.mod === 'jing') dMult += 3;
    if (tile.mod === 'lei') { x = relicFlag(run, 'leiX') ? 2 : 1.5; if (has(run, 'leiyin')) { critChance += 25; fx.crit = (fx.crit ?? 0) + 25; } }
    qi += tq;
    mult = (mult + dMult) * x;
    steps.push({ k: 'tile', label: tile.el === 'zhuo' ? '浊' : `+${tq}`, qi, mult, dQi: tq, dMult: dMult || undefined, x: x !== 1 ? x : undefined, index, tag, fx });
  });
  return { qi, mult, steps, critChance, heal, shield, burn, swords };
}

/**
 * Scores a cast. Pure apart from the optional crit `roll` (0..1); without a roll
 * the result is a preview and never crits.
 */
export function computeCast(run: RunState, battle: BattleState, tiles: Tile[], rage: boolean, roll?: number): CastResult {
  const matches = detectPatterns(tiles, { reverse: has(run, 'nisheng') });
  let best: { match: PatternMatch; stage: TileStage } | null = null;
  for (const match of matches) {
    const stage = tileStage(run, battle, tiles, match);
    if (!best || stage.qi * stage.mult > best.stage.qi * best.stage.mult ||
      (stage.qi * stage.mult === best.stage.qi * best.stage.mult && PATTERNS[match.id].tier > PATTERNS[best.match.id].tier)) {
      best = { match, stage };
    }
  }
  const { match, stage } = best!;
  const steps = [...stage.steps];
  let { qi, mult } = stage;
  const push = (k: StepKind, label: string, bump: Bump, extra: Partial<Step> = {}) => {
    ({ qi, mult } = applyBump(qi, mult, bump));
    steps.push({ k, label: label || bumpLabel(bump), qi, mult, dQi: bump.qi, dMult: bump.mult, x: bump.x, ...extra });
  };
  const castIndex = battle.castCount + 1;

  // Method & persistent battle bonuses.
  if (run.method === 'jingang' && battle.player.shield > 0) {
    const add = Math.round(battle.player.shield * 0.3);
    if (add) push('bonus', `盈盾化雷 +${add} 气`, { qi: add });
  }
  if (run.method === 'huichun' && battle.spring > 0) push('bonus', `春华 +${Math.round(battle.spring)} 气`, { qi: Math.round(battle.spring) });
  if (run.method === 'benlei' && battle.stacks.thunder) push('bonus', `雷引 +${battle.stacks.thunder} 倍`, { mult: battle.stacks.thunder });
  if (relicFlag(run, 'shieldQi') && battle.player.shield > 0) push('bonus', `铁壁神铳 +${Math.round(battle.player.shield / 2)} 气`, { qi: Math.round(battle.player.shield / 2) });
  if (battle.stacks.overheal) push('bonus', `玉液 +${battle.stacks.overheal} 气`, { qi: battle.stacks.overheal });
  if (battle.stacks.drum) push('bonus', `震岳 +${battle.stacks.drum} 气`, { qi: battle.stacks.drum });

  // Relics fire left to right — order matters.
  const ctxBase = { run, battle, tiles, els: match.assigned, pattern: match.id, rage, castIndex };
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
  });

  if (has(run, 'xueji')) push('bonus', '血祭 ×1.6', { x: 1.6 });
  if (run.vow === 'suidan') push('bonus', '碎丹燃血 ×1.6', { x: 1.6 });
  if (rage) push('rage', `怒技 ×${3 + relicFlag(run, 'rageX')}`, { x: 3 + relicFlag(run, 'rageX') });

  const critChance = Math.min(100, stage.critChance);
  const crit = roll !== undefined && roll * 100 < critChance;
  if (crit) push('crit', `暴击 ×${relicFlag(run, 'critX') ? 3 : 2}`, { x: relicFlag(run, 'critX') ? 3 : 2 });

  let gain = PATTERNS[match.id].intent * (run.method === 'benlei' ? 2 : 1) * (has(run, 'tongming') ? 1.5 : 1) + relicFlag(run, 'qiPerCast');
  return {
    tiles, pattern: match.id, chain: match.chain, els: match.assigned, steps,
    qi, mult, critChance, crit, damage: Math.floor(qi * mult),
    heal: stage.heal, shield: stage.shield, burn: stage.burn, swords: stage.swords,
    intentGain: Math.round(gain), rage,
  };
}
