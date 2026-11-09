// Greedy bot used by the balance simulation and smoke tests. Not a strong player:
// it is a floor for what a thoughtful human can do.
import { previewCast, canRage, enemyAttack } from '../../build/v3/core/battle.js';
import * as R from '../../build/v3/core/run.js';
import { fanTier } from '../../build/v3/core/patterns.js';
import { recommend } from '../../build/v3/core/advisor.js';
import { RELIC } from '../../build/v3/core/content.js';

/** The same picker the 「荐」 button uses; the casual bot only looks at 3+ tile plays. */
export function bestCast(run, battle, rage) {
  const casual = process.env.BOT === 'casual';
  const advice = recommend(run, battle, 'max', rage, casual ? { minTiles: 3 } : {});
  return advice && { r: advice.result, uids: advice.uids };
}

export const FIGHTS = [];
export const CASTS = [];
export function playBattle(run) {
  let guard = 0;
  const start = { casts: run.stats.casts, hp: run.hp, act: run.act, kind: run.battle.kind, enemy: run.battle.enemyId };
  while (run.screen.name === 'battle' && run.battle.outcome === 'fighting' && guard++ < 200) {
    const battle = run.battle;
    let best = bestCast(run, battle, false);
    const casual = process.env.BOT === 'casual';
    if (battle.discardsLeft > 0 && fanTier(best.r.fan, !!best.r.analysis.tian) < (casual ? 1 : 3) && best.r.damage < battle.enemy.hp) {
      const keep = new Set(best.uids);
      const toss = battle.hand.filter(t => !keep.has(t.uid) || t.el === 'zhuo').sort((a, b) => a.v - b.v).slice(0, 5).map(t => t.uid);
      const tossAll = toss.length ? toss : battle.hand.slice().sort((a, b) => a.v - b.v).slice(0, 3).map(t => t.uid);
      R.discard(run, tossAll);
      continue;
    }
    let rage = false;
    if (canRage(battle)) {
      const rb = bestCast(run, battle, true);
      if (fanTier(rb.r.fan, !!rb.r.analysis.tian) >= 3 || rb.r.damage >= battle.enemy.hp || battle.player.hp < enemyAttack(run, battle) * 2) { best = rb; rage = true; }
    }
    globalThis.__probe?.(run, battle, best.r, rage);
    const out = R.castTiles(run, best.uids, rage);
    if (out) CASTS.push({ act: start.act, dmg: out.result.damage, rage, combo: out.result.pattern, fan: out.result.fan, yaku: out.result.yaku.map(y => y.id) });
  }
  FIGHTS.push({ ...start, casts: run.stats.casts - start.casts, lost: start.hp - run.battle.player.hp, maxHp: run.maxHp, won: run.battle.outcome === 'won' });
  R.concludeBattle(run);
}

function chooseNode(run) {
  const options = R.reachable(run);
  const score = n => {
    const low = run.hp < run.maxHp * 0.45;
    if (n.event?.startsWith('bond-')) return 20;
    return ({ rest: low ? 10 : 2, shop: run.gold >= 90 ? 6 : 1, event: 4, fight: low ? 1 : 5, elite: low ? 0 : 6, boss: 9 })[n.kind];
  };
  return options.sort((a, b) => score(b) - score(a))[0];
}

export function playRun(run, log = () => {}) {
  let steps = 0;
  while (!['won', 'lost'].includes(run.screen.name) && steps++ < 4000) {
    const s = run.screen;
    switch (s.name) {
      case 'map': {
        const node = chooseNode(run);
        R.enterNode(run, node.id);
        if (run.screen.name === 'battle') log({ act: run.act, enemy: node.enemy, kind: node.kind, hp: run.hp });
        break;
      }
      case 'battle': playBattle(run); break;
      case 'reward': {
        if (!s.relicPicked) {
          const ok = R.takeReward(run, 'relic', 0, run.relics.length >= run.relicSlots ? 0 : undefined);
          if (!ok) s.relicPicked = true;
        }
        if (!s.picked && s.options.length) {
          const idx = s.options.findIndex(o => o.type === 'pattern');
          R.takeReward(run, 'main', idx >= 0 ? idx : 0);
        }
        R.leaveReward(run);
        break;
      }
      case 'breakthrough': R.chooseBreakthrough(run, 0); break;
      case 'story': R.leaveStory(run); break;
      case 'ending': R.chooseEnding(run, R.endingAvailable(run, 'pillar') ? 'pillar' : 'return'); if (process.env.ENDLESS) R.enterEndless(run); break;
      case 'shop': {
        s.items.forEach((item, i) => { if (!item.sold && run.gold >= item.price && (item.option.type === 'relic' ? run.relics.length < run.relicSlots : item.option.type === 'pattern')) R.buy(run, i); });
        R.leaveShop(run);
        break;
      }
      case 'rest': {
        if (s.done) R.leaveRest(run);
        else if (run.hp < run.maxHp * 0.6) R.restChoose(run, 'heal');
        else R.restChoose(run, 'insight', R.insightChoices(run)[0]);
        break;
      }
      case 'event': {
        if (s.resolved !== undefined) { R.leaveEvent(run); break; }
        const def = R.ENEMY && null;
        void def;
        R.chooseEvent(run, 0);
        if (run.screen.name === 'event' && run.screen.resolved === undefined) R.leaveEvent(run);
        break;
      }
      case 'pick-tile': {
        const pool = [...run.bag].sort((a, b) => (s.purpose === 'remove' ? (a.el === 'zhuo' ? -1 : a.v) - (b.el === 'zhuo' ? -1 : b.v) : b.v - a.v));
        R.pickTiles(run, pool.slice(0, s.count).map(t => t.uid));
        break;
      }
    }
  }
  return run;
}
export { RELIC };
