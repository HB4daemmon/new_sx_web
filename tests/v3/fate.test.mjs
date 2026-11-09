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

test('本门役: each method has its own 路 that reads the fight', async () => {
  const { YAKU } = await import('../../build/v3/core/patterns.js');
  const own = m => Object.values(YAKU).filter(y => y.method === m).length;
  for (const m of ['yangjian', 'yuhuo', 'jingang', 'benlei', 'huichun', 'zhulong']) assert.equal(own(m), 2, m);
  const mk = (method, enemy = 'shiyuan') => { const run = R.createRun({ seed: 'bm', method }); const battle = startBattle(run, enemy, 'fight'); run.battle = battle; return { run, battle }; };
  const ids = (c, tiles, rage = false) => computeCast(c.run, c.battle, tiles, rage).yaku.map(y => y.id);
  // 养剑诀: 剑阵 needs swords already out.
  const y = mk('yangjian');
  y.battle.swords = 0;
  assert.ok(!ids(y, [T('jin', 2), T('jin', 5)]).includes('jianzhen'));
  y.battle.swords = 6;
  assert.ok(ids(y, [T('jin', 2), T('jin', 5)]).includes('jianzhen'));
  y.battle.swords = 12;
  assert.ok(ids(y, [T('jin', 2), T('jin', 5), T('jin', 1)]).includes('wanjian'));
  // 御火诀: burn against the foe's current HP.
  const f = mk('yuhuo');
  f.battle.enemy.burn = Math.ceil(f.battle.enemy.hp * 0.25);
  assert.ok(ids(f, [T('huo', 2)]).includes('fenyuan'));
  assert.ok(!ids(f, [T('jin', 2)]).some(id => id === 'fenyuan' || id === 'liaoyuan'), 'needs a 火 tile');
  // 金刚功: 金刚不坏 grows with the shield.
  const j = mk('jingang');
  j.battle.player.shield = j.battle.player.maxHp;
  const hit = computeCast(j.run, j.battle, [T('jin', 2)], false).yaku.find(h => h.id === 'buhuai');
  assert.equal(hit.fan, 10);
  j.battle.player.shield = Math.ceil(j.battle.player.maxHp * 0.3);
  assert.ok(ids(j, [T('jin', 2)]).includes('jinshen'));
  // 烛龙真经: day and night elements together.
  const z = mk('zhulong');
  assert.ok(ids(z, [T('huo', 2), T('shui', 3)]).includes('zhouye'));
  assert.ok(ids(z, [T('huo', 2), T('jin', 3), T('shui', 1), T('mu', 4)]).includes('riyue'));
  assert.ok(!ids(z, [T('huo', 2), T('jin', 3)]).some(id => id === 'zhouye' || id === 'riyue'));
  // 回春功: full HP.
  const h = mk('huichun');
  h.battle.player.hp = h.battle.player.maxHp;
  assert.ok(ids(h, [T('mu', 2)]).includes('chunman'));
  h.battle.spring = h.battle.player.maxHp;
  assert.ok(ids(h, [T('mu', 2)]).includes('wanmu'));
  // Not another method's.
  assert.ok(!ids(mk('yangjian'), [T('huo', 2), T('shui', 3)]).includes('zhouye'));
});

test('无尽: 天劫 takes at most 60% of the foe, and the fight is lost after turn 12', async () => {
  const { endlessLimit, ENDLESS_TRIB_CAP } = await import('../../build/v3/core/battle.js');
  const run = R.createRun({ seed: 'el', method: 'zhulong' });
  run.endless = 2;
  run.act = 7;
  run.talents = ['yinjie'];
  const battle = startBattle(run, 'gonggong', 'boss');
  run.battle = battle;
  assert.equal(endlessLimit(run), 12);
  battle.player.maxHp = battle.player.hp = 99999;
  battle.player.shield = 0;
  const small = () => [...battle.hand].sort((a, b) => a.v - b.v)[0].uid;
  while (battle.turn < 12 && battle.outcome === 'fighting') {
    battle.enemy.intent = { name: 'idle' };
    battle.enemy.hp = battle.enemy.maxHp; // keep it standing; tribDealt tracks the tribulation alone
    cast(run, battle, [small()], false);
  }
  assert.ok(battle.stacks.tribDealt <= Math.round(battle.enemy.maxHp * ENDLESS_TRIB_CAP), 'capped at 60%');
  assert.ok(battle.stacks.tribDealt >= battle.enemy.maxHp * 0.55, '引劫为用 reaches the cap in time');
  assert.equal(battle.outcome, 'fighting');
  battle.enemy.intent = { name: 'idle' };
  battle.enemy.hp = battle.enemy.maxHp;
  cast(run, battle, [small()], false);
  assert.equal(battle.outcome, 'lost', 'past turn 12 the tribulation takes you');
});

test('守御天赋: reduction and dodge are capped; 龟息 and 枯木逢春 stop one-shots', async () => {
  const { defense } = await import('../../build/v3/core/battle.js');
  const { REDUCE_CAP, DODGE_CAP, TALENT } = await import('../../build/v3/core/content.js');
  const run = R.createRun({ seed: 'gd', method: 'yangjian' });
  const battle = startBattle(run, 'shiyuan', 'fight');
  run.battle = battle;
  run.talents = ['tieyi', 'tieyi2', 'jianmu', 'shenfa'];
  battle.swords = 15;
  const d = defense(run, battle);
  assert.equal(d.reduce, REDUCE_CAP);
  assert.equal(d.dodge, 15);
  run.method = 'benlei'; run.talents = ['shenfa', 'leidun']; battle.stacks.rages = 5;
  assert.equal(defense(run, battle).dodge, DODGE_CAP);
  // Method talents only show up for their method.
  for (let i = 0; i < 200; i += 1) {
    const r = R.createRun({ seed: `tm-${i}`, method: 'yuhuo' });
    for (const id of R.talentChoices(r, 4)) assert.ok(!TALENT[id].method || TALENT[id].method.split(',').includes('yuhuo'), id);
  }
  // 龟息 / 枯木逢春 against a huge blow.
  const g = R.createRun({ seed: 'gx2', method: 'huichun' });
  g.talents = ['guixi', 'kumu'];
  const gb = startBattle(g, 'shiyuan', 'fight');
  g.battle = gb;
  gb.player.shield = 0;
  gb.enemy.intent = { name: 'big', atk: 9999 };
  const hp0 = gb.player.hp;
  cast(g, gb, [[...gb.hand].sort((a, b) => a.v - b.v)[0].uid], false);
  assert.ok(hp0 - gb.player.hp <= Math.round(gb.player.maxHp * 0.35) + 1, '龟息 caps the blow');
  g.talents = ['kumu'];
  gb.player.hp = 5; gb.player.shield = 0;
  gb.enemy.intent = { name: 'big', atk: 9999 };
  gb.enemy.hp = gb.enemy.maxHp;
  cast(g, gb, [[...gb.hand].sort((a, b) => a.v - b.v)[0].uid], false);
  assert.equal(gb.outcome, 'fighting');
  assert.ok(gb.player.hp > 0 && gb.stacks.kumu === 1, '枯木逢春 once');
});
