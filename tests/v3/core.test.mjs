import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, assignments, QI_PER_FAN as Q } from '../../build/v3/core/patterns.js';
import { computeCast } from '../../build/v3/core/score.js';
import { startBattle, cast, discardTiles, enemyAttack } from '../../build/v3/core/battle.js';
import * as R from '../../build/v3/core/run.js';
import { ENEMY } from '../../build/v3/core/enemies.js';
import { EVENTS } from '../../build/v3/core/events.js';
import { METHODS, RELICS } from '../../build/v3/core/content.js';
import { playRun } from './bot.mjs';

const T = (el, v = 3, mod) => ({ uid: Math.floor(Math.random() * 1e9), el, v, ...(mod ? { mod } : {}) });

function fresh(method = 'yangjian', enemy = 'shiyuan') {
  const run = R.createRun({ seed: 't', method });
  const battle = startBattle(run, enemy, 'fight');
  run.battle = battle;
  run.screen = { name: 'battle' };
  return { run, battle };
}

const A = (pairs, enemy = null) => analyze(pairs.map(p => p[0]), pairs.map(p => p[1]), enemy);
const ids = a => a.yaku.map(y => y.id).sort();

test('役: each 路 takes its best 役, different 路 stack, order never matters', () => {
  const house = A([['jin', 1], ['jin', 1], ['jin', 1], ['mu', 2], ['mu', 2]]);
  assert.deepEqual(ids(house), ['hulu', 'mantang'], '同元·满堂 + 同数·紫金葫芦, nothing lower from the same 路');
  assert.equal(house.combo, 'hulu', 'headline is the biggest 役');
  const shuffled = A([['mu', 2], ['jin', 1], ['mu', 2], ['jin', 1], ['jin', 1]]);
  assert.deepEqual(ids(shuffled), ids(house), 'same tiles, any order, same 役');
  assert.deepEqual(ids(A([['jin', 2], ['huo', 3], ['tu', 4]])), ['lian3'], '三连珠');
  assert.deepEqual(ids(A([['jin', 1], ['mu', 1], ['shui', 1]])), ['sanhua', 'sanqing'], '金1 木1 水1: 三花聚顶 + 三清');
  assert.ok(ids(A([['jin', 1], ['mu', 3], ['shui', 5], ['huo', 2], ['tu', 4]])).includes('hualong'), '一气化龙 needs exactly 1–5');
  assert.ok(ids(A([['jin', 1], ['mu', 3], ['shui', 5], ['huo', 2], ['tu', 4]])).includes('wuxing'), '五行俱全');
  assert.deepEqual(ids(A([['mu', 2], ['mu', 9], ['mu', 7]], 'tu')).filter(id => id.startsWith('po')), ['pozhen'], '三张克制 土 敌人：破阵');
  assert.ok(ids(A([['jin', 4], ['huo', 5], ['tu', 6]])).includes('luoshu'), '总和 15：洛书');
  assert.ok(ids(A([['jin', 4], ['huo', 6]])).includes('shiquan'), '总和 10：十全');
  assert.ok(!ids(A([['jin', 4], ['huo', 6], ['tu', 9]])).includes('shiquan'), '十全 is exactly two tiles');
  assert.ok(!ids(A([['jin', 4], ['huo', 5], ['tu', 3], ['mu', 3]])).includes('luoshu'), '洛书 is exactly three tiles');
  assert.equal(A([['jin', 1], ['jin', 2], ['jin', 3], ['jin', 4], ['jin', 5]]).tian.id, 'jiutian', '同花顺');
  assert.equal(A([['shui', 5], ['jin', 4], ['tu', 3], ['huo', 2], ['mu', 1]]).tian.id, 'shengsheng');
  assert.equal(A([['shui', 3], ['jin', 3], ['tu', 3], ['huo', 3], ['mu', 3]]).tian.id, 'wuqi');
  assert.equal(A([['shui', 1], ['huo', 7], ['jin', 3], ['tu', 10]]).dewei, 3, '得位：水1、火7、土10');
  assert.equal(A([['mu', 4], [null, 0]]).yaku.length, 0, '浊符 has no element and no value');
  assert.equal(assignments([T('mu'), T('huo', 3, 'ling')]).length, 5, '灵符 tries every element');
  assert.equal(assignments([T('mu'), T('huo', 3, 'huan')]).length, 5, '幻符 tries every value 1–5');
});

test('scoring: 气 = points + QI_PER_FAN per 役番, 倍 = 番; 心法 adds 番; 回复 lands after the enemy acts', () => {
  const { run, battle } = fresh('yangjian', 'shiyuan'); // 石鼋 is 土: 木 counters it, 水 is weak to it
  const pair = computeCast(run, battle, [T('jin', 2), T('jin', 2)], false);
  assert.deepEqual(pair.yaku.map(y => y.id).sort(), ['chengshuang', 'shuangyuan']);
  assert.equal(pair.fan, 2);
  assert.equal(pair.qi, 2 + 2 + Q * 2);
  assert.equal(pair.mult, 2);
  assert.equal(computeCast(run, battle, [T('jin', 2)], false).mult, 1, 'no 役: 1 倍');
  assert.equal(computeCast(run, battle, [T('mu', 2), T('mu', 2)], false).qi, 4 + 4 + Q * 3, '木克土: points doubled, and two counters make 破绽');
  assert.equal(computeCast(run, battle, [T('shui', 2), T('shui', 2)], false).qi, 1 + 1 + Q * 2, '土克水: points halved');
  const a = computeCast(run, battle, [T('jin', 2), T('huo', 3), T('tu', 4)], false);
  const b = computeCast(run, battle, [T('tu', 4), T('jin', 2), T('huo', 3)], false);
  assert.equal(a.damage, b.damage, 'order never matters');
  run.patternLv.yuan = 3;
  assert.equal(computeCast(run, battle, [T('jin', 2), T('jin', 2)], false).yaku.find(y => y.id === 'shuangyuan').fan, 3, '心法 3重 +2 番');
  assert.ok(computeCast(run, battle, [T('jin', 1), T('jin', 2), T('jin', 3), T('jin', 4), T('jin', 5)], false).mult >= 30, '天成');
  run.patternLv.yuan = 1;
  assert.equal(computeCast(run, battle, [T('jin', 2), T('jin', 2, 'bao')], false).fan, 3, '宝符 +1 番');
  // 回复 is held until the enemy has struck.
  const h = fresh('huichun', 'shiyuan');
  h.battle.player.hp = 10;
  h.battle.hand = [T('mu', 5), T('mu', 5), T('jin', 1), T('jin', 1), T('jin', 1), T('jin', 1), T('jin', 1)];
  const out = cast(h.run, h.battle, [h.battle.hand[0].uid, h.battle.hand[1].uid], false);
  assert.ok(!out.events.some(e => e.k === 'heal' && e.to === 'player'), 'no healing during the cast');
  if (h.battle.outcome === 'fighting') assert.ok(out.enemyEvents.some(e => e.k === 'heal' && e.to === 'player' && e.late), 'healing after the enemy turn');
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

test('灵 counts as every element at once, 幻 as every value; 五行 / 连珠 / 洛书 still take one', () => {
  const W = (pairs, wild) => analyze(pairs.map(p => p[0]), pairs.map(p => p[1]), null, wild);
  const ids2 = a => a.yaku.map(y => y.id);
  // 火 火 木 木 灵 → 火3 + 木3
  const a = W([['huo', 2], ['huo', 7], ['mu', 3], ['mu', 9], ['jin', 4]], { ling: [false, false, false, false, true] });
  assert.deepEqual(a.sets.map(s => s.size), [3, 3]);
  assert.ok(ids2(a).includes('sancai2'), '三才并立');
  // 火 木 灵 灵 灵 → 火4 + 木4
  const b = W([['huo', 2], ['mu', 3], ['jin', 4], ['jin', 5], ['jin', 9]], { ling: [false, false, true, true, true] });
  assert.deepEqual(b.sets.map(s => s.size), [4, 4]);
  assert.ok(ids2(b).includes('sixiang2'), '四象双生');
  assert.ok(ids2(b).includes('wuxing'), '三张灵补齐五行俱全（每张只顶一种）');
  // 一张灵 + 四种元素各一：五行俱全，但同元只是两张
  const c = W([['huo', 2], ['mu', 3], ['tu', 6], ['shui', 8], ['jin', 9]], { ling: [false, false, false, false, true] });
  assert.ok(ids2(c).includes('wuxing'));
  // 幻：3 3 5 5 幻 → 两组三条
  const d = W([['huo', 3], ['mu', 3], ['tu', 5], ['shui', 5], ['jin', 1]], { huan: [false, false, false, false, true] });
  assert.ok(ids2(d).includes('sanqing2'), '三清同辉');
  // 灵 counts as a counter for 破敌
  const e = analyze(['mu', 'mu', 'jin'], [2, 3, 9], 'tu', { ling: [false, false, true] });
  assert.ok(e.yaku.some(y => y.id === 'pozhen'), '两张木 + 灵 vs 土 → 破阵');
});

test('役之器 and talents: 命运轮盘, 天机签, 三清铃, 空灵根, 慧眼', () => {
  const { run, battle } = fresh('yangjian', 'shiyuan');
  const tiles = [T('jin', 3), T('huo', 3), T('shui', 3)];
  const base = computeCast(run, battle, tiles, false);
  run.relics = ['mingyun'];
  battle.stacks.wheel = 3;
  assert.equal(computeCast(run, battle, tiles, false).damage, Math.floor(base.qi * base.mult * 3), '三张 3 点 → 番 ×3');
  battle.stacks.wheel = 5;
  assert.equal(computeCast(run, battle, tiles, false).damage, base.damage, 'no 5s: no effect');
  run.relics = ['sanqingling'];
  assert.equal(computeCast(run, battle, tiles, false).damage, base.damage, '三清 alone is not enough');
  const house = [T('jin', 3), T('huo', 3), T('shui', 3), T('tu', 5), T('mu', 5)];
  const plainHouse = (run.relics = [], computeCast(run, battle, house, false));
  run.relics = ['sanqingling'];
  assert.equal(computeCast(run, battle, house, false).mult, plainHouse.mult * 2, '葫芦 ×2');
  run.relics = ['tianjiqian'];
  battle.stacks.omen = 3; // 金
  assert.equal(computeCast(run, battle, tiles, false).mult, base.mult + 1);
  run.relics = [];
  // 慧眼: 金 3 is one off 金's 4 → 得位
  assert.equal(computeCast(run, battle, [T('jin', 3)], false).analysis.dewei, 0);
  run.talents = ['huiyan'];
  assert.equal(computeCast(run, battle, [T('jin', 3)], false).analysis.dewei, 1);
  // 空灵根: each turn exactly one hand tile is 灵
  const k = R.createRun({ seed: 'kong', method: 'yangjian' });
  k.talents = ['kongling'];
  const kb = startBattle(k, 'shiyuan', 'fight');
  assert.equal(kb.hand.filter(t => t.mod === 'ling').length >= 1, true);
  const wheel = R.createRun({ seed: 'wheel', method: 'yangjian' });
  wheel.relics = ['mingyun'];
  const wb = startBattle(wheel, 'shiyuan', 'fight');
  assert.ok(wb.stacks.wheel >= 1 && wb.stacks.wheel <= 5, 'the wheel is spun at the start of the fight');
});

test('单骑流: 淬火砧 grows the lone tile for good, 本命符匣 always deals it, 孤注 / 孤峰剑 / 熔符', () => {
  const { run, battle } = fresh('yangjian', 'shiyuan');
  run.relics = ['cuihuo'];
  const big = run.bag[0];
  const copy = { ...big };
  battle.hand = [copy, T('jin', 1), T('jin', 1), T('jin', 1)];
  const before = big.v;
  cast(run, battle, [copy.uid], false);
  assert.equal(big.v, before + 2, '淬火砧: the bag tile itself grew');
  // 孤注: a lone tile's points ×3
  const g = fresh('yangjian', 'shiyuan');
  const plain = computeCast(g.run, g.battle, [T('huo', 6)], false).qi;
  g.run.talents = ['guzhu'];
  assert.equal(computeCast(g.run, g.battle, [T('huo', 6)], false).qi, plain * 3);
  // 孤峰剑: every 10 points of a lone tile is +1 番
  g.run.talents = []; g.run.relics = ['gufeng'];
  assert.equal(computeCast(g.run, g.battle, [T('huo', 25)], false).mult, 1 + 2);
  // 本命符匣: the biggest tile in the bag is always in the opening hand
  const b = R.createRun({ seed: 'bm', method: 'yangjian' });
  b.relics = ['benming'];
  b.bag[3].v = 40;
  for (let i = 0; i < 5; i += 1) {
    const bb = startBattle(b, 'shiyuan', 'fight');
    assert.ok(bb.hand.some(t => t.v === 40), 'the 40 is in hand');
  }
  // 温养玉: +2 to the bag's biggest tile after a win
  const w = fresh('yangjian', 'shiyuan');
  w.run.relics = ['wenyang'];
  const topBefore = Math.max(...w.run.bag.map(t => t.v));
  w.battle.outcome = 'won';
  R.concludeBattle(w.run);
  assert.equal(Math.max(...w.run.bag.map(t => t.v)), topBefore + 2);
  // 熔符 at the 洞府: two tiles become one with the summed value, no cap
  const f = R.createRun({ seed: 'fuse', method: 'yangjian' });
  f.screen = { name: 'rest' };
  R.restChoose(f, 'fuse');
  f.bag[0].v = 15; f.bag[1].v = 14;
  const n = f.bag.length;
  R.pickTiles(f, [f.bag[0].uid, f.bag[1].uid]);
  assert.equal(f.bag.length, n - 1);
  assert.ok(f.bag.some(t => t.v === 29 && t.mod === 'bao'));
});

test('三张归一: three tiles of the same element and value become one, value ×2, best mark kept; rest and shop', () => {
  const run = R.createRun({ seed: 'merge', method: 'yangjian' });
  run.bag = run.bag.filter(t => !(t.el === 'huo' && t.v === 4));
  const a = R.addTile(run, { el: 'huo', v: 4 }), b = R.addTile(run, { el: 'huo', v: 4, mod: 'ling' }), c = R.addTile(run, { el: 'huo', v: 4, mod: 'bao' });
  R.addTile(run, { el: 'huo', v: 5 });
  assert.ok(R.mergeGroups(run).some(g => g[0].el === 'huo' && g[0].v === 4 && g.length === 3), 'the three 火4 form a group');
  run.screen = { name: 'rest' };
  R.restChoose(run, 'merge');
  assert.equal(run.screen.purpose, 'merge');
  const odd = run.bag.find(t => t.el === 'huo' && t.v === 5);
  assert.equal(R.pickTiles(run, [a.uid, b.uid, odd.uid]), false, 'must match');
  const n = run.bag.length;
  assert.equal(R.pickTiles(run, [a.uid, b.uid, c.uid]), true);
  assert.equal(run.bag.length, n - 2);
  assert.ok(run.bag.some(t => t.el === 'huo' && t.v === 8 && t.mod === 'ling'), '灵 outranks 宝');
  // Shop: paid, once.
  const s = R.createRun({ seed: 'merge2', method: 'yangjian' });
  for (let i = 0; i < 3; i += 1) R.addTile(s, { el: 'jin', v: 9 });
  s.gold = 200;
  s.screen = { name: 'map' };
  s.map = [{ id: 'x', row: 0, col: 0, kind: 'shop', next: [] }];
  R.enterNode(s, 'x');
  R.startMerge(s);
  const trio = s.bag.filter(t => t.el === 'jin' && t.v === 9).map(t => t.uid);
  assert.equal(R.pickTiles(s, trio), true);
  assert.equal(s.gold, 200 - R.mergePrice(s));
  assert.equal(s.screen.name, 'shop');
  assert.equal(s.screen.merged, true);
  R.startMerge(s);
  assert.equal(s.screen.name, 'shop', 'once per shop');
});
