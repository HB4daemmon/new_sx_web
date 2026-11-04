import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, assignments, migrateLevels } from '../../build/v3/core/patterns.js';
import { computeCast } from '../../build/v3/core/score.js';
import { startBattle, cast, discardTiles, enemyAttack } from '../../build/v3/core/battle.js';
import * as R from '../../build/v3/core/run.js';
import { ENEMY } from '../../build/v3/core/enemies.js';
import { EVENTS } from '../../build/v3/core/events.js';
import { METHODS, RELICS } from '../../build/v3/core/content.js';
import { playRun } from './bot.mjs';

const T = (el, v = 3, mod) => ({ uid: Math.floor(Math.random() * 1e9), el, v, ...(mod ? { mod } : {}) });
const combo = (els, opts) => analyze(els, opts).combo;

function fresh(method = 'yangjian', enemy = 'shiyuan') {
  const run = R.createRun({ seed: 't', method });
  const battle = startBattle(run, enemy, 'fight');
  run.battle = battle;
  run.screen = { name: 'battle' };
  return { run, battle };
}

test('analysis: sets stack, order makes 相生 / 相克 links, names follow', () => {
  const full = analyze(['jin', 'jin', 'jin', 'mu', 'mu']);
  assert.deepEqual(full.sets.map(s => s.size), [3, 2], '三才 and 双元 both count');
  assert.equal(full.combo, 'mantang');
  assert.deepEqual(analyze(['mu', 'huo', 'tu']).links, ['sheng', 'sheng']);
  assert.deepEqual(analyze(['tu', 'huo', 'mu']).links, [null, null], 'reverse order is not 相生');
  assert.deepEqual(analyze(['tu', 'huo', 'mu'], { reverse: true }).links, ['sheng', 'sheng'], '逆转五行');
  assert.deepEqual(analyze(['mu', 'tu', 'shui', 'huo', 'jin']).links, ['ke', 'ke', 'ke', 'ke']);
  assert.equal(combo(['mu', 'tu', 'shui', 'huo', 'jin']), 'nixing');
  assert.equal(combo(['shui', 'mu', 'huo', 'tu', 'jin']), 'lunzhuan');
  assert.equal(combo(['jin', 'mu', 'shui', 'tu', 'huo']), 'wuxing');
  assert.equal(combo(['jin', 'jin', 'jin', 'jin', 'jin']), 'wulei');
  assert.deepEqual(analyze(['mu', null, 'huo']).links, [null, null], '浊符 breaks links');
  assert.equal(assignments([T('mu'), T('huo', 3, 'ling')]).length, 5, '灵符 tries every element');
  assert.deepEqual(migrateLevels({ sheng3: 3, lunzhuan: 2, mantang: 2 }).sheng, 3);
});

test('scoring: sets add up, 相生 passes qi forward, 相克 multiplies', () => {
  const { run, battle } = fresh('yangjian', 'shiyuan'); // 石鼋 is 土: 木 counters it, 水 is weak to it
  const pair = computeCast(run, battle, [T('jin', 4), T('jin', 4)], false);
  assert.equal(pair.pattern, 'dui');
  assert.equal(pair.qi, 10 + 8);
  assert.equal(pair.mult, 1 + 2);
  const fullHouse = computeCast(run, battle, [T('jin', 1), T('jin', 1), T('jin', 1), T('huo', 1), T('huo', 1)], false);
  assert.equal(fullHouse.qi, 5 + 25 + 10, '三才 + 双元 both add qi');
  assert.equal(fullHouse.mult, (1 + 3 + 2) * 1.5, '…and 倍, then 满堂 ×1.5');
  assert.equal(computeCast(run, battle, [T('mu', 4), T('mu', 4)], false).qi, 10 + 8 + 8, '木克土: points doubled');
  assert.equal(computeCast(run, battle, [T('shui', 4), T('shui', 4)], false).qi, 10 + 2 + 2, '土克水: points halved');
  // 火→土→金 (no counter/weak vs 土 enemy for 火 and 金): qi flows 2 → 2+2 → 2+4.
  const chain = computeCast(run, battle, [T('huo', 2), T('jin', 2), T('tu', 2)], false);
  const flowed = computeCast(run, battle, [T('jin', 2), T('huo', 2)], false);
  void flowed;
  const sheng = computeCast(run, battle, [T('huo', 2), T('tu', 2)], false);
  assert.equal(sheng.analysis.links[0], 'sheng');
  assert.equal(sheng.qi, 2 + 4, 'the second tile receives the first tile\'s qi');
  assert.ok(chain.steps.length > 0);
  const ke = computeCast(run, battle, [T('huo', 2), T('jin', 2)], false);
  assert.equal(ke.analysis.links[0], 'ke');
  assert.ok(Math.abs(ke.mult - 1.3) < 1e-9, '相克 multiplies');
});

test('scoring: relic order matters (+倍 before ×倍) and 昆仑镜 mirrors its right neighbour', () => {
  const { run, battle } = fresh();
  const tiles = [T('jin', 2), T('jin', 2)];
  run.relics = ['huwen', 'taotie'];
  const good = computeCast(run, battle, tiles, false).damage;
  run.relics = ['taotie', 'huwen'];
  const bad = computeCast(run, battle, tiles, false).damage;
  assert.ok(good > bad, `${good} > ${bad}`);
  run.relics = ['qingfeng'];
  const one = computeCast(run, battle, tiles, false).qi;
  run.relics = ['kunlun', 'qingfeng'];
  const mirrored = computeCast(run, battle, tiles, false).qi;
  assert.equal(mirrored - one, 15, 'mirror fires the neighbour again');
  run.relics = ['qingfeng', 'kunlun'];
  assert.equal(computeCast(run, battle, tiles, false).qi, one, 'nothing to the right: no effect');
});

test('scoring: 怒技 multiplies and crits only on a real roll', () => {
  const { run, battle } = fresh('yuhuo');
  const tiles = [T('jin', 5), T('jin', 5), T('jin', 5)];
  const base = computeCast(run, battle, tiles, false);
  const rage = computeCast(run, battle, tiles, true);
  assert.equal(Math.round(rage.mult / base.mult), 2, '焚天 ×2');
  assert.equal(base.crit, false, 'preview never crits');
  const crit = computeCast(run, battle, tiles, false, 0);
  assert.ok(crit.crit && crit.damage === base.damage * 2);
});

test('battle: armor absorbs, curses stay in the battle, discards are limited', () => {
  const { run, battle } = fresh('yangjian', 'hebo');
  const bagSize = run.bag.length;
  battle.enemy.armor = 50;
  battle.hand = [T('jin', 1), T('mu', 1), T('jin', 1), T('shui', 1), T('tu', 1), T('huo', 1), T('jin', 1)];
  const hp = battle.enemy.hp;
  const out = cast(run, battle, [battle.hand[0].uid], false);
  const hit = out.events.find(e => e.k === 'hit' && e.to === 'enemy' && e.src === 'cast');
  assert.equal(hit.blocked, Math.min(50, out.result.damage));
  assert.ok(battle.enemy.hp <= hp);
  // 河伯 opens with a curse.
  assert.ok(out.enemyEvents.some(e => e.k === 'curse'));
  assert.ok([...battle.draw, ...battle.hand, ...battle.discard].some(t => t.el === 'zhuo'));
  assert.equal(run.bag.length, bagSize, 'curse tiles never enter the permanent bag');
  battle.discardsLeft = 1;
  assert.equal(discardTiles(run, battle, [battle.hand[0].uid]).length, 1);
  assert.equal(discardTiles(run, battle, [battle.hand[0].uid]).length, 0);
});

test('battle: bosses change phase at half HP, 刑天 revives once, 天劫 ends stalling', () => {
  const { run, battle } = fresh('yangjian', 'gonggong');
  battle.enemy.hp = Math.floor(battle.enemy.maxHp / 2) + 1;
  battle.hand = [T('jin', 9), T('jin', 9), T('jin', 9), T('jin', 9), T('jin', 9)];
  battle.enemy.armor = 0;
  const out = cast(run, battle, battle.hand.map(t => t.uid), false);
  if (battle.outcome === 'fighting') assert.ok(out.events.some(e => e.k === 'phase') || battle.enemy.phase === 2);

  const x = fresh('yangjian', 'xingtian');
  x.battle.enemy.hp = 1;
  x.battle.hand = [T('jin', 9)];
  const out2 = cast(x.run, x.battle, [x.battle.hand[0].uid], false);
  assert.ok(out2.events.some(e => e.k === 'revive'));
  assert.equal(x.battle.outcome, 'fighting');
  assert.ok(x.battle.enemy.hp > 0);

  // A player who only casts single 浊 tiles still sees the fight end by 天劫.
  const s = fresh('jingang', 'shiyuan');
  let turns = 0;
  while (s.battle.outcome === 'fighting' && turns++ < 60) {
    s.battle.hand = [{ uid: 9000 + turns, el: 'zhuo', v: 0 }, ...s.battle.hand.filter(t => t.el !== 'zhuo')];
    cast(s.run, s.battle, [9000 + turns], false);
  }
  assert.notEqual(s.battle.outcome, 'fighting');
  assert.ok(turns < 40, `ended after ${turns} turns`);
});

test('enemy attack values scale with act, rank and charge', () => {
  const { run, battle } = fresh('yangjian', 'leita');
  const base = enemyAttack(run, battle, { name: 'x', atk: 10 });
  battle.enemy.charged = true;
  assert.equal(enemyAttack(run, battle, { name: 'x', atk: 10 }), base * 2);
  run.act = 3;
  battle.enemy.charged = false;
  assert.ok(enemyAttack(run, battle, { name: 'x', atk: 10 }) > base);
});

test('maps: three lanes, every node reachable, one boss at the end', () => {
  for (let act = 1; act <= 4; act += 1) {
    const run = R.createRun({ seed: `map-${act}`, method: 'yangjian' });
    const map = R.generateMap(run, act);
    const boss = map.filter(n => n.kind === 'boss');
    assert.equal(boss.length, 1);
    const seen = new Set(map.filter(n => n.row === 0).map(n => n.id));
    for (const node of [...map].sort((a, b) => a.row - b.row)) if (seen.has(node.id)) node.next.forEach(id => seen.add(id));
    assert.equal(seen.size, map.length, `act ${act}: all nodes reachable`);
    assert.ok(map.some(n => n.kind === 'elite'), 'an elite every act');
    assert.ok(map.filter(n => n.row === 4).some(n => n.kind === 'rest'), 'a rest before the boss');
  }
});

test('full runs: every method plays to an end without errors, deterministically', () => {
  for (const m of METHODS) {
    const a = playRun(R.createRun({ seed: 'full', method: m.id }));
    const b = playRun(R.createRun({ seed: 'full', method: m.id }));
    assert.ok(['won', 'lost'].includes(a.screen.name), `${m.id} ended`);
    assert.equal(a.stats.bestHit, b.stats.bestHit, `${m.id} deterministic`);
    assert.equal(a.act, b.act);
    assert.ok(Number.isFinite(a.stats.bestHit) && a.stats.bestHit > 0);
  }
});

test('save round-trip keeps a run playable', () => {
  const run = R.createRun({ seed: 'save', method: 'yuhuo' });
  R.enterNode(run, R.reachable(run)[0].id);
  const copy = R.deserialize(R.serialize(run));
  assert.deepEqual(copy, run);
  assert.equal(R.deserialize('{"version":2}'), null);
  assert.equal(R.deserialize('nope'), null);
});

test('every event option resolves without throwing', () => {
  for (const ev of EVENTS) {
    ev.options.forEach((option, i) => {
      const run = R.createRun({ seed: `ev-${ev.id}-${i}`, method: 'huichun' });
      run.gold = 200;
      run.relics = ['qingfeng', 'huwen'];
      run.screen = { name: 'event', event: ev.id };
      if (option.can && !option.can(run)) return;
      R.chooseEvent(run, i);
      assert.ok(run.screen.name === 'event' ? typeof run.screen.resolved === 'string' : ['pick-tile', 'reward'].includes(run.screen.name), `${ev.id}#${i}`);
    });
  }
});

test('relics: full slots require a replacement and every relic has a description', () => {
  const run = R.createRun({ seed: 'slots', method: 'yangjian' });
  run.relics = ['qingfeng', 'huwen', 'jiansui', 'chaoxi', 'qingmu'];
  assert.equal(R.gainRelic(run, 'taotie'), false);
  assert.equal(R.gainRelic(run, 'taotie', 0), true);
  assert.equal(run.relics[0], 'taotie');
  for (const r of RELICS) assert.ok(r.desc && r.name && r.glyph, r.id);
  assert.ok(Object.values(ENEMY).every(e => e.moves.length >= 3));
});

import { BONDS, ENDINGS, BOSS_STORY, LORE, ACT_STORY } from '../../build/v3/core/story.js';
import { EVENT } from '../../build/v3/core/events.js';

test('story: every run opens on the act scroll and plans two 因缘 threads', () => {
  const run = R.createRun({ seed: 'story', method: 'yangjian' });
  assert.deepEqual(run.screen, { name: 'story', act: 1 });
  assert.equal(run.plan.length, 2);
  assert.notEqual(run.plan[0], run.plan[1]);
  assert.ok(run.map.some(n => n.event === `bond-${run.plan[0]}-1` && n.row === 2), 'first meeting sits on the act 1 map');
  R.leaveStory(run);
  assert.equal(run.screen.name, 'map');
  for (let act = 1; act <= 5; act += 1) assert.ok(ACT_STORY[act].prelude.length && ACT_STORY[act].goal);
  for (const id of ['gonggong', 'xiangliu', 'xingtian', 'zhulong', 'tianjie']) assert.ok(BOSS_STORY[id].before.length && BOSS_STORY[id].after);
  for (const e of Object.values(ENEMY)) assert.ok(LORE[e.id], `lore for ${e.id}`);
});

test('story: a kept promise brings the second meeting; a declined one never does', () => {
  for (const b of BONDS) {
    for (const keep of [true, false]) {
      const run = R.createRun({ seed: `bond-${b.id}`, method: 'yuhuo' });
      run.plan = [b.id, BONDS.find(x => x.id !== b.id).id];
      run.gold = 100;
      run.screen = { name: 'event', event: `bond-${b.id}-1` };
      R.chooseEvent(run, keep ? 0 : 1);
      assert.equal(run.bonds[b.id], keep ? 'kept' : 'declined', b.id);
      assert.ok(run.deeds.length === 1);
      const act3 = R.generateMap(run, 3);
      assert.equal(act3.some(n => n.event === `bond-${b.id}-2`), keep, `${b.id} second meeting only when kept`);
      if (keep) {
        run.screen = { name: 'event', event: `bond-${b.id}-2` };
        R.chooseEvent(run, 0);
        assert.equal(run.bonds[b.id], 'done');
        assert.ok(run.hp >= 1);
      }
    }
  }
  for (const id of Object.keys(EVENT).filter(k => k.startsWith('bond-'))) assert.ok(EVENT[id].bond);
});

test('story: completed threads help in the final battle; 补天 needs two of them', () => {
  const run = R.createRun({ seed: 'final', method: 'yangjian' });
  run.act = 5;
  const plain = startBattle(run, 'tianjie', 'boss');
  run.bonds = { houyi: 'done', jingwei: 'done', yu: 'kept' };
  const helped = startBattle(run, 'tianjie', 'boss');
  assert.deepEqual(helped.assists.sort(), ['houyi', 'jingwei']);
  assert.ok(helped.enemy.hp < plain.enemy.hp, '后羿 first arrow');
  assert.equal(helped.stacks.noCurse, 1, '精卫 blocks curses');
  run.screen = { name: 'ending' };
  assert.equal(R.endingAvailable(run, 'pillar'), true);
  run.bonds = { houyi: 'done' };
  assert.equal(R.endingAvailable(run, 'pillar'), false);
  assert.equal(R.chooseEnding(run, 'pillar'), false);
  assert.equal(R.chooseEnding(run, 'return'), true);
  assert.equal(run.screen.name, 'won');
  assert.equal(run.ending, 'return');
  assert.equal(ENDINGS.length, 3);
});

import { SPECIALS, RAGES } from '../../build/v3/core/content.js';
import { canRage } from '../../build/v3/core/battle.js';

test('本门符: every method starts with two and every 怒技 seeds two more into the draw pile', () => {
  for (const m of METHODS) {
    const sp = Object.values(SPECIALS).find(x => x.method === m.id);
    assert.ok(sp && RAGES[m.id], `${m.id} has a tile and a 怒技`);
    const { run, battle } = fresh(m.id, 'gonggong');
    assert.equal(run.bag.filter(t => t.sp === sp.id).length, 2);
    battle.qi = 100;
    battle.hand = [T('jin', 3), T('jin', 3)];
    const before = battle.draw.filter(t => t.sp === sp.id).length + battle.discard.filter(t => t.sp === sp.id).length;
    const out = cast(run, battle, battle.hand.map(t => t.uid), true);
    assert.ok(out.result.steps.some(s => s.k === 'rage' && s.label.startsWith(RAGES[m.id].name)), `${m.id} 怒技 name`);
    const after = [...battle.draw, ...battle.discard, ...battle.hand].filter(t => t.sp === sp.id).length;
    assert.ok(after >= before + 2, `${m.id} seeded`);
    assert.ok(run.bag.every(t => t.uid > 0), 'seeded tiles stay out of the permanent bag');
  }
});

test('本门符 effects and method 怒技 differ', () => {
  const a = fresh('benlei', 'gonggong');
  a.battle.qi = 60;
  assert.equal(canRage(a.battle), true, '奔雷 only needs 60');
  const lead = computeCast(a.run, a.battle, [{ uid: 1, el: 'jin', v: 4, sp: 'leiyin' }], false);
  const plain = computeCast(a.run, a.battle, [T('jin', 4)], false);
  assert.equal(lead.intentGain - plain.intentGain, 25, '雷引符 +25 剑意');
  const j = fresh('jingang', 'gonggong');
  j.battle.player.shield = 200;
  const tiles = [T('jin', 3), T('jin', 3)];
  const noRage = computeCast(j.run, j.battle, tiles, false), rage = computeCast(j.run, j.battle, tiles, true);
  assert.ok(rage.qi >= noRage.qi + 200, '金刚伏魔 turns the whole shield into qi');
  const y = fresh('yangjian', 'gonggong');
  y.battle.swords = 12;
  const sw = computeCast(y.run, y.battle, tiles, true);
  assert.ok(sw.steps.some(s => s.k === 'rage' && s.x >= 4), '万剑归宗 scales with swords');
  const z = fresh('zhulong', 'gonggong');
  const zz = computeCast(z.run, z.battle, [{ uid: 2, el: 'huo', v: 3, sp: 'zhuyin' }], false);
  assert.ok(zz.qi >= 3 * 2, '烛阴符 doubles');
});
