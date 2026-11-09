import assert from 'node:assert/strict';
import test from 'node:test';
import * as R from '../../build/v3/core/run.js';
import { startBattle, cast, tribulationStart } from '../../build/v3/core/battle.js';
import { computeCast } from '../../build/v3/core/score.js';
import { FATES, TALENT, TALENTS, TALENT_TIER_ODDS } from '../../build/v3/core/content.js';

const T = (el, v = 3, mod) => ({ uid: Math.floor(Math.random() * 1e9), el, v, ...(mod ? { mod } : {}) });
function fight(opts = {}, enemy = 'shiyuan') {
  const run = R.createRun({ seed: opts.seed ?? 'f', method: 'yangjian', ...opts });
  const battle = startBattle(run, enemy, 'fight');
  run.battle = battle;
  run.screen = { name: 'battle' };
  return { run, battle };
}

test('天赋: every talent has a tier and a category; odds shift toward 仙 act by act', () => {
  for (const t of TALENTS) assert.ok(['common', 'rare', 'legend'].includes(t.tier) && t.cat, t.id);
  assert.ok(TALENTS.length >= 30);
  for (let act = 1; act <= 4; act += 1) {
    const o = TALENT_TIER_ODDS[act];
    assert.equal(o.common + o.rare + o.legend, 100);
  }
  assert.ok(TALENT_TIER_ODDS[4].legend > TALENT_TIER_ODDS[1].legend);
  // Draws: three distinct; act 4 leans 仙; act 2+ never three 凡.
  const tally = { 1: { common: 0, legend: 0 }, 4: { common: 0, legend: 0 } };
  for (let i = 0; i < 300; i += 1) {
    for (const act of [1, 2, 4]) {
      const run = R.createRun({ seed: `tc-${i}-${act}`, method: 'yangjian' });
      const ids = R.talentChoices(run, act);
      assert.equal(new Set(ids).size, 3);
      if (act >= 2) assert.ok(ids.some(id => TALENT[id].tier !== 'common'), 'act 2+: at least one 灵 or 仙');
      if (tally[act]) for (const id of ids) if (TALENT[id].tier in tally[act]) tally[act][TALENT[id].tier] += 1;
    }
  }
  assert.ok(tally[1].common > tally[4].common && tally[4].legend > tally[1].legend);
});

test('天赋效果: 步步为营 keeps +5 only via the killing blow; 温养 grows the top tile; 既济; 借势; 行险; 点石成金', () => {
  // 步步为营
  const b = fight({ seed: 'bubu' });
  b.run.talents = ['bubu'];
  const bb = startBattle(b.run, 'shiyuan', 'fight');
  b.run.battle = bb;
  const uid = bb.stacks.bubuUid;
  const bagTile = b.run.bag.find(t => t.uid === uid);
  const before = bagTile.v;
  bb.enemy.hp = 1; bb.enemy.armor = 0;
  cast(b.run, bb, [uid], false);
  assert.equal(bb.outcome, 'won');
  assert.equal(bagTile.v, before + 5, 'the killing blow used it: +5 for good');
  // 温养·圆满
  const w = R.createRun({ seed: 'wy', method: 'yangjian' });
  w.talents = ['wenyang3'];
  const top = Math.max(...w.bag.map(t => t.v));
  startBattle(w, 'shiyuan', 'fight');
  assert.equal(Math.max(...w.bag.map(t => t.v)), top + 3);
  // 土水相制: +6 番
  const j = fight({ seed: 'jj' });
  const tiles = [T('tu', 2), T('tu', 8), T('shui', 3), T('shui', 9)];
  const plain = computeCast(j.run, j.battle, tiles, false).fan;
  j.run.talents = ['jiji_tushui'];
  assert.equal(computeCast(j.run, j.battle, tiles, false).fan, plain + 6);
  // 借势: half the incoming blow joins the cast's 气
  const js = fight({ seed: 'js' }, 'leita');
  js.battle.stacks.incoming = 40;
  const q0 = computeCast(js.run, js.battle, [T('jin', 2)], false).qi;
  js.run.talents = ['jieshi'];
  assert.equal(computeCast(js.run, js.battle, [T('jin', 2)], false).qi, q0 + 20);
  // 点石成金
  const d = R.createRun({ seed: 'ds', method: 'yangjian' });
  d.talents = ['dianshi'];
  const t0 = Math.max(...d.bag.map(t => t.v));
  d.gold = 200;
  R.spend(d, 120);
  assert.equal(Math.max(...d.bag.map(t => t.v)), t0 + 6, 'two lots of 50 → +3 twice');
  assert.equal(d.counters.spent, 20);
});

test('命格: every 命格 is selectable; the rules they rewrite', () => {
  assert.equal(FATES.length, 10);
  // 偏枯命: five extra 本命 tiles, 本命 +2 气, others −1.
  const p = fight({ seed: 'pk', fate: 'pianku', fateEl: 'huo' });
  assert.equal(p.run.bag.filter(t => t.el === 'huo').length, 5 + 5);
  const plain = fight({ seed: 'pk' });
  assert.equal(computeCast(p.run, p.battle, [T('huo', 4)], false).qi, computeCast(plain.run, plain.battle, [T('huo', 4)], false).qi + 2);
  // 河图命: 得位 +2 each; off-河图 tiles −1 气.
  const h = fight({ seed: 'ht', fate: 'hetu' });
  assert.equal(computeCast(h.run, h.battle, [T('shui', 1), T('jin', 4)], false).fan >= 4, true);
  // 孤星命: three slots, relics fire twice.
  const g = fight({ seed: 'gx', fate: 'guxing' });
  assert.equal(g.run.relicSlots, 3);
  g.run.relics = ['huwen'];
  const one = fight({ seed: 'gx' });
  one.run.relics = ['huwen'];
  const tiles = [T('jin', 2), T('jin', 2)];
  assert.equal(computeCast(g.run, g.battle, tiles, false).mult - computeCast(one.run, one.battle, tiles, false).mult, 3, '虎纹佩 +3 again');
  // 应劫命: earlier tribulation, and its bolt shields you.
  const y = fight({ seed: 'yj', fate: 'yingjie' });
  assert.equal(tribulationStart(y.run), tribulationStart(plain.run) - 2);
  // 守拙命: five tiles ×1.5, two or fewer ×0.6.
  const s = fight({ seed: 'sz', fate: 'shouzhuo' });
  const five = [T('jin', 1), T('mu', 2), T('shui', 3), T('huo', 4), T('tu', 5)];
  const sz = computeCast(s.run, s.battle, five, false).mult / computeCast(plain.run, plain.battle, five, false).mult;
  assert.ok(Math.abs(sz - 1.5) < 1e-9);
  // 散修命: no relic choices after battles, ×2 gold, cheaper shop.
  const x = fight({ seed: 'sx', fate: 'sanxiu' });
  x.battle.outcome = 'won'; x.battle.kind = 'elite';
  R.concludeBattle(x.run);
  assert.equal(x.run.screen.relicOptions.length, 0);
  assert.equal(x.run.screen.gold, 60);
  // 天眼命: one reshape per act, never the boss.
  const t = R.createRun({ seed: 'ty', method: 'yangjian', fate: 'tianyan' });
  R.leaveStory(t);
  assert.equal(R.reshapeLeft(t), 1);
  const boss = t.map.find(n => n.kind === 'boss');
  assert.equal(R.reshapeNode(t, boss.id, 'rest'), false);
  const target = t.map.find(n => n.row === 2 && n.kind !== 'elite' && !n.event?.startsWith('bond-') && n.kind !== 'shop');
  assert.equal(R.reshapeNode(t, target.id, 'shop'), true);
  assert.equal(target.kind, 'shop');
  assert.equal(R.reshapeLeft(t), 0);
  // 百炼命: two 洞府 actions, +2 to 炼符.
  const bl = R.createRun({ seed: 'bl', method: 'yangjian', fate: 'bailian' });
  bl.screen = { name: 'rest' };
  R.restChoose(bl, 'heal');
  assert.equal(bl.screen.name, 'rest');
  assert.ok(!bl.screen.done && bl.screen.used === 1, 'one more action');
  R.restChoose(bl, 'forge');
  const v0 = bl.bag[0].v;
  R.pickTiles(bl, [bl.bag[0].uid]);
  assert.equal(bl.bag[0].v, v0 + 5);
  assert.equal(bl.screen.done, true);
  // 吞符命: the eaten tile's points spread over its element.
  const tf = fight({ seed: 'tf', fate: 'tunfu' });
  tf.battle.outcome = 'won';
  R.concludeBattle(tf.run);
  const victim = tf.run.bag.find(t => t.el === 'mu' && t.v === 5);
  const muBefore = tf.run.bag.filter(t => t.el === 'mu').reduce((a, t) => a + t.v, 0);
  R.startDevour(tf.run);
  R.pickTiles(tf.run, [victim.uid]);
  assert.ok(!tf.run.bag.includes(victim));
  assert.equal(tf.run.bag.filter(t => t.el === 'mu').reduce((a, t) => a + t.v, 0), muBefore, 'points are kept, spread over 木');
  assert.equal(tf.run.screen.name, 'reward');
  assert.equal(tf.run.screen.devoured, true);
});
