import { ACT_ATK, ACT_HP, ENEMY, HEAT_ATK, HEAT_HP, RANK_ATK, RANK_HP } from './enemies.js';
import { GEN, type El } from './elements.js';
import { next, shuffle, int, type Rng } from './rng.js';
import { PATTERNS } from './patterns.js';
import { computeCast, defenseScale, has, relicFlag, type CastResult } from './score.js';
import type { BattleState, EnemyState, Move, NodeKind, RunState, Tile } from './types.js';

export type BEvent =
  | { k: 'hit'; to: 'enemy' | 'player'; amount: number; blocked: number; src: 'cast' | 'sword' | 'detonate' | 'enemy' | 'burn' | 'tribulation' | 'blood'; crit?: boolean; hitIndex?: number }
  | { k: 'heal'; to: 'enemy' | 'player'; amount: number; overflow?: number }
  | { k: 'shield'; to: 'player'; amount: number }
  | { k: 'armor'; amount: number }
  | { k: 'burn'; to: 'enemy' | 'player'; amount: number }
  | { k: 'move'; name: string; move: Move }
  | { k: 'curse'; n: number }
  | { k: 'charge' }
  | { k: 'buff'; amount: number }
  | { k: 'drain'; amount: number }
  | { k: 'phase'; name: string; text: string }
  | { k: 'revive'; hp: number }
  | { k: 'tribulation'; level: number }
  | { k: 'element'; el: El }
  | { k: 'swords'; count: number; forged: number }
  | { k: 'thunder'; total: number }
  | { k: 'turn'; turn: number }
  | { k: 'draw'; count: number }
  | { k: 'win' }
  | { k: 'lose' };

export const MAX_CAST = 5;
export const handSize = (run: RunState) => 7 + (has(run, 'yiqi') ? 1 : 0) + (run.vow === 'juenian' ? 2 : 0);
export const discardsPerTurn = (run: RunState) => (run.vow === 'juenian' ? 0 : 2 + (has(run, 'douzhuan') ? 1 : 0));
export const tribulationStart = (run: RunState) => (has(run, 'yinjie') ? 5 : 8);
export const swordDamage = (run: RunState) => 4 + run.realm * 4;

const actOf = (run: RunState) => Math.min(5, run.act);
function scaleAtk(run: RunState, battle: BattleState, base: number) {
  const rank = ENEMY[battle.enemyId].rank;
  return Math.round(base * ACT_ATK[actOf(run)] * RANK_ATK[rank] * (1 + HEAT_ATK * run.heat));
}

export function startBattle(run: RunState, enemyId: string, kind: NodeKind): BattleState {
  const def = ENEMY[enemyId];
  const hp = Math.round(def.hp * ACT_HP[actOf(run)] * RANK_HP[def.rank] * (1 + HEAT_HP * run.heat));
  const enemy: EnemyState = {
    id: def.id, el: def.el, hp, maxHp: hp, shield: 0, burn: 0, armor: 0, atkBonus: 0,
    charged: false, moveIndex: 0, phase: 1, revived: false, intent: def.moves[0],
  };
  const rng = run.rng;
  const battle: BattleState = {
    enemyId, kind, turn: 1, hand: [], draw: shuffle(rng, run.bag.map(tile => ({ ...tile }))), discard: [], exhausted: [],
    player: { hp: run.hp, maxHp: run.maxHp, shield: 0, burn: 0 }, enemy,
    qi: Math.min(100, relicFlag(run, 'startQi')), discardsLeft: discardsPerTurn(run), castsThisTurn: 0, freeCastUsed: false,
    castCount: 0, swords: 0, spring: 0, stacks: {}, outcome: 'fighting', bestHit: 0,
  };
  if (has(run, 'jinshen')) battle.player.shield += 20 * Math.max(1, run.realm);
  if (def.act === 5 && def.rank === 'boss') applyAssists(run, battle);
  turnStartShield(run, battle);
  drawTo(run, battle);
  return battle;
}

/** 因缘相助: completed threads show up for the final tribulation. */
function applyAssists(run: RunState, battle: BattleState) {
  const done = Object.entries(run.bonds ?? {}).filter(([, s]) => s === 'done').map(([id]) => id);
  battle.assists = done;
  for (const id of done) {
    if (id === 'jingwei') battle.stacks.noCurse = 1;
    if (id === 'yu') battle.stacks.calm = 1;
    if (id === 'houyi') battle.enemy.hp = Math.round(battle.enemy.hp * 0.85);
    if (id === 'shennong') { battle.player.hp = battle.player.maxHp; battle.player.shield += Math.round(battle.player.maxHp / 2); }
    if (id === 'nezha') { battle.qi = 100; battle.discardsLeft = discardsPerTurn(run) + 1; }
    if (id === 'tieshan') battle.enemy.burn += Math.round(battle.enemy.maxHp * 0.03);
  }
}

function turnStartShield(run: RunState, battle: BattleState) {
  const plate = relicFlag(run, 'turnShield');
  if (plate) battle.player.shield += Math.round(plate * defenseScale(run));
}

function drawTo(run: RunState, battle: BattleState): number {
  let drawn = 0;
  while (battle.hand.length < handSize(run)) {
    if (!battle.draw.length) {
      if (!battle.discard.length) break;
      battle.draw = shuffle(run.rng, battle.discard);
      battle.discard = [];
    }
    battle.hand.push(battle.draw.pop()!);
    drawn += 1;
  }
  return drawn;
}

export function enemyAttack(run: RunState, battle: BattleState, move: Move = battle.enemy.intent) {
  if (!move.atk) return 0;
  return Math.round((scaleAtk(run, battle, move.atk) + battle.enemy.atkBonus) * (battle.enemy.charged ? 2 : 1) * (battle.stacks.calm ? 0.8 : 1));
}

export function discardTiles(run: RunState, battle: BattleState, uids: number[]): BEvent[] {
  if (battle.outcome !== 'fighting' || battle.discardsLeft <= 0 || !uids.length || uids.length > MAX_CAST) return [];
  const chosen = battle.hand.filter(tile => uids.includes(tile.uid));
  if (!chosen.length) return [];
  battle.hand = battle.hand.filter(tile => !uids.includes(tile.uid));
  battle.discard.push(...chosen);
  battle.discardsLeft -= 1;
  return [{ k: 'draw', count: drawTo(run, battle) }];
}

export const canRage = (battle: BattleState) => battle.qi >= 100;

export function previewCast(run: RunState, battle: BattleState, uids: number[], rage: boolean): CastResult | null {
  const tiles = uids.map(uid => battle.hand.find(tile => tile.uid === uid)).filter(Boolean) as Tile[];
  if (!tiles.length) return null;
  return computeCast(run, battle, tiles, rage && canRage(battle));
}

function damageEnemy(run: RunState, battle: BattleState, amount: number, src: 'cast' | 'sword' | 'detonate' | 'burn' | 'tribulation', events: BEvent[], crit = false) {
  const enemy = battle.enemy;
  if (enemy.hp <= 0 || amount <= 0) return 0;
  let blocked = 0;
  if (enemy.armor > 0 && src !== 'burn' && src !== 'tribulation' && !relicFlag(run, 'ignoreArmor')) {
    blocked = Math.min(enemy.armor, amount);
    enemy.armor -= blocked;
  }
  const dealt = amount - blocked;
  enemy.hp -= dealt;
  events.push({ k: 'hit', to: 'enemy', amount: dealt, blocked, src, crit });
  checkEnemy(run, battle, events);
  return dealt;
}

function checkEnemy(run: RunState, battle: BattleState, events: BEvent[]) {
  const enemy = battle.enemy;
  const def = ENEMY[enemy.id];
  if (enemy.hp <= 0) {
    if (def.trait === 'revive' && !enemy.revived && def.phase2) {
      enemy.revived = true;
      enemy.hp = Math.round(enemy.maxHp * 0.4);
      enemy.burn = 0;
      enterPhase2(run, battle, events);
      events.push({ k: 'revive', hp: enemy.hp });
      return;
    }
    enemy.hp = 0;
    if (battle.outcome === 'fighting') { battle.outcome = 'won'; events.push({ k: 'win' }); }
    return;
  }
  if (def.phase2 && def.trait !== 'revive' && enemy.phase === 1 && enemy.hp <= enemy.maxHp / 2) enterPhase2(run, battle, events);
}

function enterPhase2(run: RunState, battle: BattleState, events: BEvent[]) {
  const enemy = battle.enemy;
  const def = ENEMY[enemy.id];
  if (!def.phase2) return;
  enemy.phase = 2;
  enemy.moveIndex = 0;
  enemy.intent = def.phase2.moves[0];
  enemy.charged = false;
  if (def.phase2.buff) enemy.atkBonus += scaleAtk(run, battle, def.phase2.buff);
  events.push({ k: 'phase', name: def.phase2.name, text: def.phase2.text });
}

function damagePlayer(run: RunState, battle: BattleState, amount: number, src: 'enemy' | 'burn' | 'tribulation' | 'blood', events: BEvent[], hitIndex?: number) {
  const player = battle.player;
  if (amount <= 0 || battle.outcome !== 'fighting') return;
  let blocked = 0;
  if (src !== 'blood' && player.shield > 0) {
    blocked = Math.min(player.shield, amount);
    player.shield -= blocked;
    const drum = relicFlag(run, 'drumQi');
    if (drum) battle.stacks.drum = (battle.stacks.drum ?? 0) + blocked * drum;
  }
  const dealt = amount - blocked;
  player.hp -= dealt;
  if (src === 'blood') player.hp = Math.max(1, player.hp);
  events.push({ k: 'hit', to: 'player', amount: dealt, blocked, src, hitIndex });
  if (player.hp <= 0) { player.hp = 0; battle.outcome = 'lost'; events.push({ k: 'lose' }); }
}

export interface CastOutcome { result: CastResult; events: BEvent[]; enemyEvents: BEvent[]; turnEnded: boolean }

export function cast(run: RunState, battle: BattleState, uids: number[], rageWanted: boolean): CastOutcome | null {
  if (battle.outcome !== 'fighting' || !uids.length || uids.length > MAX_CAST) return null;
  const tiles = uids.map(uid => battle.hand.find(tile => tile.uid === uid)).filter(Boolean) as Tile[];
  if (tiles.length !== uids.length) return null;
  const rage = rageWanted && canRage(battle);
  const result = computeCast(run, battle, tiles, rage, next(run.rng));
  const events: BEvent[] = [];
  battle.hand = battle.hand.filter(tile => !uids.includes(tile.uid));
  battle.discard.push(...tiles);
  battle.castCount += 1;
  battle.castsThisTurn += 1;
  run.stats.casts += 1;

  if (has(run, 'xueji')) damagePlayer(run, battle, 3, 'blood', events);
  // Consumed one-shot bonuses.
  battle.stacks.overheal = 0;
  battle.stacks.drum = 0;
  if (run.method === 'huichun') battle.spring = Math.floor(battle.spring / 2);

  let total = damageEnemy(run, battle, result.damage, 'cast', events, result.crit);

  if (run.method === 'yangjian') {
    const forged = Math.min(15 - battle.swords, result.swords);
    battle.swords += Math.max(0, forged);
    if (battle.swords > 0) {
      events.push({ k: 'swords', count: battle.swords, forged: Math.max(0, forged) });
      for (let volley = 0; volley < (rage ? 3 : 1) && battle.outcome === 'fighting'; volley += 1) {
        total += damageEnemy(run, battle, battle.swords * swordDamage(run), 'sword', events);
      }
    }
  }
  if (run.method === 'yuhuo' && rage && battle.enemy.burn > 0 && battle.outcome === 'fighting') {
    total += damageEnemy(run, battle, battle.enemy.burn * 8, 'detonate', events);
  }

  // Tile effects.
  if (result.heal > 0) {
    const room = battle.player.maxHp - battle.player.hp;
    const healed = Math.min(room, result.heal);
    const overflow = result.heal - healed;
    battle.player.hp += healed;
    if (overflow > 0) {
      if (run.method === 'huichun') battle.spring += overflow;
      const pot = relicFlag(run, 'overhealQi');
      if (pot) battle.stacks.overheal = overflow * pot;
    }
    events.push({ k: 'heal', to: 'player', amount: healed, overflow });
  }
  if (result.shield > 0) {
    battle.player.shield = Math.min(battle.player.maxHp * (run.method === 'jingang' ? 1 : 2), battle.player.shield + result.shield);
    events.push({ k: 'shield', to: 'player', amount: result.shield });
  }
  if (result.burn > 0 && battle.outcome === 'fighting') {
    battle.enemy.burn += result.burn;
    events.push({ k: 'burn', to: 'enemy', amount: result.burn });
  }
  battle.qi = Math.min(100, (rage ? 0 : battle.qi) + result.intentGain);
  if (rage && run.method === 'benlei') {
    battle.stacks.thunder = (battle.stacks.thunder ?? 0) + 3;
    events.push({ k: 'thunder', total: battle.stacks.thunder });
  }
  battle.bestHit = Math.max(battle.bestHit, total);
  run.stats.bestHit = Math.max(run.stats.bestHit, total);
  const tierBest = run.stats.biggestPattern;
  if (!tierBest || patternTier(result.pattern) > patternTier(tierBest)) run.stats.biggestPattern = result.pattern;

  let turnEnded = true;
  if (has(run, 'shuangjue') && !battle.freeCastUsed && tiles.length <= 2 && battle.outcome === 'fighting') {
    battle.freeCastUsed = true;
    turnEnded = false;
    drawTo(run, battle);
  }
  const enemyEvents: BEvent[] = [];
  if (turnEnded && battle.outcome === 'fighting') enemyTurn(run, battle, enemyEvents);
  return { result, events, enemyEvents, turnEnded };
}

const patternTier = (id: keyof typeof PATTERNS) => PATTERNS[id].tier * 100 + PATTERNS[id].mult;

function enemyTurn(run: RunState, battle: BattleState, events: BEvent[]) {
  const enemy = battle.enemy;
  const def = ENEMY[enemy.id];
  enemy.armor = 0;
  if (enemy.burn > 0) {
    damageEnemy(run, battle, enemy.burn, 'burn', events);
    if (run.method !== 'yuhuo') enemy.burn = Math.floor(enemy.burn * 0.6);
    if (battle.outcome !== 'fighting') return;
  }
  const move = enemy.intent;
  events.push({ k: 'move', name: move.name, move });
  if (move.atk) {
    const dmg = enemyAttack(run, battle, move);
    for (let i = 0; i < (move.hits ?? 1); i += 1) damagePlayer(run, battle, dmg, 'enemy', events, i);
    enemy.charged = false;
    if (battle.outcome !== 'fighting') return;
  }
  if (move.charge) { enemy.charged = true; events.push({ k: 'charge' }); }
  if (move.armor) { enemy.armor += Math.round(move.armor * ACT_HP[actOf(run)] * RANK_HP[def.rank] * (1 + HEAT_HP * run.heat)); events.push({ k: 'armor', amount: enemy.armor }); }
  if (move.burn) { battle.player.burn += Math.round(move.burn * ACT_ATK[actOf(run)]); events.push({ k: 'burn', to: 'player', amount: Math.round(move.burn * ACT_ATK[actOf(run)]) }); }
  if (move.curse && battle.stacks.noCurse) events.push({ k: 'curse', n: 0 });
  else if (move.curse) {
    for (let i = 0; i < move.curse; i += 1) {
      const tile: Tile = { uid: -(battle.castCount * 10 + i + 1) - battle.turn * 1000, el: 'zhuo', v: 0 };
      battle.draw.splice(int(run.rng, 0, battle.draw.length), 0, tile);
    }
    events.push({ k: 'curse', n: move.curse });
  }
  if (move.drain) { const lost = Math.min(battle.qi, move.drain); battle.qi -= lost; events.push({ k: 'drain', amount: lost }); }
  if (move.heal) { const h = Math.min(enemy.maxHp - enemy.hp, Math.round(enemy.maxHp * move.heal)); enemy.hp += h; events.push({ k: 'heal', to: 'enemy', amount: h }); }
  if (move.buff) { const b = scaleAtk(run, battle, move.buff); enemy.atkBonus += b; events.push({ k: 'buff', amount: b }); }

  // 天劫: escalating sudden death keeps every fight short.
  const start = tribulationStart(run);
  if (battle.turn >= start) {
    const level = battle.turn - start + 1;
    events.push({ k: 'tribulation', level });
    damageEnemy(run, battle, Math.round(enemy.maxHp * 0.07 * level), 'tribulation', events);
    if (!has(run, 'yinjie') && battle.outcome === 'fighting') damagePlayer(run, battle, Math.round(battle.player.maxHp * 0.05 * level), 'tribulation', events);
    if (battle.outcome !== 'fighting') return;
  }

  // Next intent.
  const moves = enemy.phase === 2 && def.phase2 ? def.phase2.moves : def.moves;
  enemy.moveIndex = (enemy.moveIndex + 1) % moves.length;
  enemy.intent = moves[enemy.moveIndex];
  if (def.trait === 'alternate') { enemy.el = enemy.el === 'huo' ? 'shui' : 'huo'; events.push({ k: 'element', el: enemy.el }); }
  if (def.trait === 'cycle') { enemy.el = GEN[enemy.el]; events.push({ k: 'element', el: enemy.el }); }

  // Player turn start.
  battle.turn += 1;
  run.stats.turns += 1;
  events.push({ k: 'turn', turn: battle.turn });
  if (run.method !== 'jingang') battle.player.shield = 0;
  turnStartShield(run, battle);
  if (battle.player.burn > 0) {
    damagePlayer(run, battle, battle.player.burn, 'burn', events);
    battle.player.burn = Math.floor(battle.player.burn / 2);
    if (battle.outcome !== 'fighting') return;
  }
  battle.discardsLeft = discardsPerTurn(run);
  battle.castsThisTurn = 0;
  battle.freeCastUsed = false;
  const drawn = drawTo(run, battle);
  events.push({ k: 'draw', count: drawn });
}
