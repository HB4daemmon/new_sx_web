/**
 * 天劫契: opt-in difficulty clauses. Each rank adds 劫数 (heat) and raises the
 * 道果 earned by the run. Players compose their own challenge.
 */
import type { RunState } from './types.js';

export interface PactDef { id: string; name: string; max: number; cost: number; desc: (rank: number) => string }

export const PACTS: PactDef[] = [
  { id: 'cloud', name: '劫云', max: 3, cost: 1, desc: r => `敌方气血 +${15 * r}%` },
  { id: 'thunder', name: '雷火', max: 3, cost: 1, desc: r => `敌方伤害 +${10 * r}%` },
  { id: 'murk', name: '浊世', max: 2, cost: 1, desc: r => `符袋起手混入 ${2 * r} 枚浊符` },
  { id: 'miser', name: '吝啬', max: 1, cost: 1, desc: () => '坊市价格 +30%' },
  { id: 'elite', name: '精英横行', max: 1, cost: 1, desc: () => '每幕多一名精英拦路' },
  { id: 'short', name: '短劫', max: 1, cost: 2, desc: () => '天劫提前 2 回合降临' },
  { id: 'awake', name: '首领觉醒', max: 1, cost: 2, desc: () => '首领攻击 +30%，且在 75% 气血就进入二阶段' },
  { id: 'lone', name: '断缘', max: 1, cost: 2, desc: () => '这一局不会遇到任何因缘（补天无望）' },
  { id: 'dull', name: '钝剑', max: 1, cost: 2, desc: () => '怒技只有 ×2' },
  { id: 'narrow', name: '少符', max: 1, cost: 3, desc: () => '手中符数上限 -1' },
];
export const PACT: Record<string, PactDef> = Object.fromEntries(PACTS.map(p => [p.id, p]));

export const pactRank = (run: Pick<RunState, 'pacts'>, id: string) => run.pacts?.[id] ?? 0;

export function pactHeat(pacts: Record<string, number>): number {
  return Object.entries(pacts).reduce((sum, [id, rank]) => sum + (PACT[id] ? PACT[id].cost * Math.min(rank, PACT[id].max) : 0), 0);
}

/** 道果 multiplier for the chosen clauses. */
export const pactMultiplier = (heat: number) => 1 + 0.12 * heat;

export function cleanPacts(pacts: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, rank] of Object.entries(pacts ?? {})) {
    const def = PACT[id];
    if (def && Number.isInteger(rank) && rank > 0) out[id] = Math.min(def.max, rank);
  }
  return out;
}
