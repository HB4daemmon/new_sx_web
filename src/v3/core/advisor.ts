/**
 * 荐：从手牌里挑出这一招该出的符，并排好顺序（相生连跳看顺序）。
 *  - 'max'  最高伤害：能斩杀就斩杀，否则伤害最高。
 *  - 'safe' 稳妥：伤害之外，把这一招能挡下、能回回来的气血也算进去（敌人要重击时更看重护盾）。
 * 同一份逻辑给界面的「荐」按钮和平衡模拟的机器人用。
 */
import { breakEffect, enemyAttack, previewCast } from './battle.js';
import { assignments, chainNodes, links, type DanNode, type Wilds } from './patterns.js';
import { MAX_CAST } from './battle.js';
import { relicFlag, type CastResult } from './score.js';
import type { BattleState, RunState, Tile } from './types.js';

export type AdviceMode = 'max' | 'safe';
export interface Advice { uids: number[]; result: CastResult; lethal: boolean; mode: AdviceMode }

function* subsets<T>(list: T[], max: number): Generator<T[]> {
  const n = list.length;
  const pick: T[] = [];
  function* rec(start: number): Generator<T[]> {
    if (pick.length) yield [...pick];
    if (pick.length === max) return;
    for (let i = start; i < n; i += 1) { pick.push(list[i]); yield* rec(i + 1); pick.pop(); }
  }
  yield* rec(0);
}

/** 按丹理链：先最长链，再比较各丹张数 × 链位置之和；同丹保留点选顺序。 */
export function arrange(tiles: Tile[], opts: Pick<Wilds, 'keLink'> = {}): Tile[] {
  if (tiles.length < 2) return tiles;
  let best = tiles, bestChain = -1, bestTotal = -1;
  for (const { els } of assignments(tiles)) {
    const nodes = chainNodes(els, !!opts.keLink);
    const perm = (rest: DanNode[], acc: DanNode[], pos: number, chain: number, total: number) => {
      if (!rest.length) {
        if (chain > bestChain || (chain === bestChain && total > bestTotal)) {
          bestChain = chain; bestTotal = total;
          best = acc.flatMap(node => node.tiles.map(i => tiles[i]));
        }
        return;
      }
      rest.forEach((node, i) => {
        const prev = acc[acc.length - 1];
        const p = prev && links(prev.el, node.el, !!opts.keLink) ? pos + 1 : 1;
        perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, node], p, Math.max(chain, p), total + p * node.tiles.length);
      });
    };
    perm(nodes, [], 0, 0, 0);
  }
  return best;
}

/** HP this cast would keep: shield that soaks the coming blow, plus healing that lands after it. */
function hpKept(run: RunState, battle: BattleState, r: CastResult) {
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

export function recommend(run: RunState, battle: BattleState, mode: AdviceMode = 'max', rage = false, opts: { minTiles?: number } = {}): Advice | null {
  const hand: Tile[] = battle.hand;
  const enemyHp = battle.enemy.hp + (battle.enemy.armor || 0);
  let best: { score: number; uids: number[]; r: CastResult } | null = null;
  for (const set of subsets(hand, MAX_CAST)) {
    if (opts.minTiles && set.length < opts.minTiles && hand.length >= opts.minTiles) continue;
    const uids = arrange(set, { keLink: !!relicFlag(run, 'keLink') }).map(t => t.uid);
    const r = previewCast(run, battle, uids, rage);
    if (!r) continue;
    const lethal = r.damage >= enemyHp;
    let score: number;
    if (mode === 'max') score = (lethal ? 1e15 : 0) + r.damage;
    else {
      const dmg = Math.min(1, r.damage / Math.max(1, enemyHp));
      score = (lethal ? 100 : 0) + dmg + 1.5 * (hpKept(run, battle, r) / Math.max(1, battle.player.maxHp));
    }
    // Ties: fewer tiles (keeps the hand readable), then more damage.
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && (uids.length < best.uids.length || r.damage > best.r.damage))) best = { score, uids, r };
  }
  if (!best) return null;
  return { uids: best.uids, result: best.r, lethal: best.r.damage >= enemyHp, mode };
}

/** Is a defensive play worth suggesting this turn? (the coming blow takes a real bite) */
export function dangerous(run: RunState, battle: BattleState) {
  const intent = battle.enemy.intent;
  if (!intent.atk) return false;
  const incoming = enemyAttack(run, battle) * (intent.hits ?? 1) - battle.player.shield;
  return incoming >= battle.player.hp * 0.3;
}
