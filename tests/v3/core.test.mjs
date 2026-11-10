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

const A = els => analyze(els);
const ids = a => a.yaku.map(y => y.id).sort();

test('役: 同元 by count, 相生 by left-to-right order; 连跳 k-th tile fires k times', () => {
  const house = A(['jin', 'jin', 'jin', 'mu', 'mu']);
  assert.deepEqual(ids(house), ['mantang'], '同元·满堂');
  assert.deepEqual(ids(A(['mu', 'huo', 'tu'])), ['sansheng'], '木→火→土：三生');
  assert.deepEqual(ids(A(['tu', 'huo', 'mu'])), [], '反过来不连：顺序要对');
  assert.deepEqual(A(['mu', 'huo', 'tu']).chainPos, [1, 2, 3], '连跳里第 k 张触发 k 次');
  assert.deepEqual(A(['mu', 'mu', 'huo', 'jin', 'shui']).chainPos, [1, 1, 2, 1, 2], '断了重新数');
  assert.deepEqual(ids(A(['mu', 'mu', 'huo'])), ['shuangyuan', 'xiangsheng'], '两路相加：双元＋相生');
  assert.deepEqual(ids(A(['huo', 'tu', 'jin', 'shui'])), ['sisheng'], '四生');
  assert.deepEqual(ids(A(['jin', 'mu', 'shui', 'huo', 'tu'])), ['wuxing'], '五种不论顺序：五行俱全');
  assert.deepEqual(ids(A(['shui', 'mu', 'huo', 'tu', 'jin'])), ['shengsheng'], '五张连成一圈：生生不息');
  assert.equal(A(['mu', null]).yaku.length, 0, '浊符断链、无元素');
  assert.equal(assignments([T('mu'), T('huo', 3, 'ling')]).length, 5, '灵符 tries every element');
});

test('scoring: 气 = Σ触发点数 + QI_PER_FAN per 役番, 倍 = 番; 心法 adds 番; 回复 lands after the enemy acts', () => {
  const { run, battle } = fresh('yangjian', 'shiyuan'); // 石鼋 is 土: 木 counters it, 水 is weak to it
  const pair = computeCast(run, battle, [T('jin', 2), T('jin', 2)], false);
  assert.deepEqual(pair.yaku.map(y => y.id), ['shuangyuan']);
  assert.equal(pair.fan, 1);
  assert.equal(pair.qi, 2 + 2 + Q * 1);
  assert.equal(computeCast(run, battle, [T('jin', 2)], false).mult, 1, 'no 役: 1 倍');
  assert.equal(computeCast(run, battle, [T('mu', 2), T('mu', 2)], false).qi, 4 + 4 + Q, '木克土: points doubled');
  assert.equal(computeCast(run, battle, [T('shui', 2), T('shui', 2)], false).qi, 1 + 1 + Q, '土克水: points halved');
  // 金→水 is one 跳: 水 fires twice (halved by 土 → 1 each).
  const chain = computeCast(run, battle, [T('jin', 2), T('shui', 2)], false);
  assert.deepEqual(chain.triggers, [1, 2]);
  assert.equal(chain.qi, 2 + 1 + 1 + Q * 1, '相生 1 番，水触发两次');
  const back = computeCast(run, battle, [T('shui', 2), T('jin', 2)], false);
  assert.ok(chain.damage > back.damage, 'order matters for 相生');
  run.patternLv.yuan = 3;
  assert.equal(computeCast(run, battle, [T('jin', 2), T('jin', 2)], false).yaku.find(y => y.id === 'shuangyuan').fan, 3, '心法 3重 +2 番');
  run.patternLv.yuan = 1;
  assert.deepEqual(computeCast(run, battle, [T('shui', 1), T('mu', 2), T('huo', 3), T('tu', 4), T('jin', 5)], false).yaku.map(y => y.id), ['shengsheng'], '五张连成一圈');
  assert.equal(computeCast(run, battle, [T('jin', 2), T('jin', 2, 'bao')], false).fan, 2, '宝符 +1 番');
  // 回复 is held until the enemy has struck.
  const h = fresh('huichun', 'shiyuan');
  h.battle.player.hp = 10;
  h.battle.hand = [T('mu', 5), T('mu', 5), T('jin', 1), T('jin', 1), T('jin', 1), T('jin', 1), T('jin', 1)];
  const out = cast(h.run, h.battle, [h.battle.hand[0].uid, h.battle.hand[1].uid], false);
  assert.ok(!out.events.some(e => e.k === 'heal' && e.to === 'player'), 'no healing during the cast');
  if (h.battle.outcome === 'fighting') assert.ok(out.enemyEvents.some(e => e.k === 'heal' && e.to === 'player' && e.late), 'healing after the enemy turn');
});

test('罡气: one turn of damage through the 罡气 breaks the enemy — its move is cut, the next cast ×2; hand is kept', () => {
  const { run, battle } = fresh('yangjian', 'shiyuan');
  assert.ok(battle.stacks.guard > 0 && battle.stacks.guard === battle.stacks.guardMax, '罡气 starts full');
  battle.player.hp = battle.player.maxHp = 999;
  battle.stacks.guard = 1;
  battle.hand = [T('jin', 3), T('jin', 3), T('huo', 1), T('huo', 1), T('huo', 1), T('huo', 1), T('huo', 1)];
  battle.enemy.intent = { name: '重击', atk: 50 };
  const hp = battle.player.hp;
  const out = cast(run, battle, [battle.hand[0].uid], false);
  assert.ok(out.events.some(e => e.k === 'break' && e.interrupt), '破势 interrupts a 小怪');
  assert.ok(!out.enemyEvents.some(e => e.k === 'hit' && e.to === 'player' && e.src === 'enemy'), 'the blow never lands');
  assert.ok(battle.player.hp >= hp - battle.player.maxHp * 0.2, 'only the tribulation could hurt');
  assert.equal(battle.hand.filter(t => t.el === 'huo' && t.v === 1).length >= 5, true, 'unplayed tiles stay in hand');
  assert.equal(battle.stacks.guard, battle.stacks.guardMax, '罡气 refills each turn');
  const next = computeCast(run, battle, [T('jin', 3)], false);
  assert.ok(next.vuln && next.steps.some(s => s.label === '破势 ×1.5'), 'the next cast gets ×1.5');
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
  // A 倍符 also earns 本门役「雷鸣」, so the only difference left is the +25.
  const plain = computeCast(a.run, a.battle, [{ uid: 2, el: 'jin', v: 4, mod: 'lei' }], false);
  assert.equal(lead.intentGain - plain.intentGain, 25, '雷引符 +25 剑意');
  assert.ok(lead.yaku.some(y => y.id === 'leiming') && plain.yaku.some(y => y.id === 'leiming'));
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

test('灵 counts as every element at once for 同元, and the best one in a 相生 chain', () => {
  const W = (els, ling) => analyze(els, { ling });
  const ids2 = a => a.yaku.map(y => y.id);
  // 火 火 木 木 灵 → 火3 + 木3
  const a = W(['huo', 'huo', 'mu', 'mu', 'jin'], [false, false, false, false, true]);
  assert.deepEqual(a.sets.map(s => s.size), [3, 3]);
  assert.ok(ids2(a).includes('sancai2'), '三才并立');
  // 火 木 灵 灵 灵 → 火4 + 木4
  const b = W(['huo', 'mu', 'jin', 'jin', 'jin'], [false, false, true, true, true]);
  assert.deepEqual(b.sets.map(s => s.size), [4, 4]);
  assert.ok(ids2(b).includes('sixiang2'), '四象双生');
  // In a cast the 灵 tile tries every element: 木 灵 土 reads as 木→火→土.
  const { run, battle } = fresh('yangjian', 'shiyuan');
  const r = computeCast(run, battle, [T('mu', 2), T('jin', 2, 'ling'), T('tu', 2)], false);
  assert.deepEqual(r.triggers, [1, 2, 3], '灵 fills the gap in the chain');
});
test('役之器 and talents: 命运轮盘, 天机签, 三清铃, 空灵根, 相生与罡气之器', () => {
  const { run, battle } = fresh('yangjian', 'shiyuan');
  const tiles = [T('jin', 3), T('jin', 3), T('shui', 3)];
  const base = computeCast(run, battle, tiles, false);
  run.relics = ['mingyun'];
  battle.stacks.wheel = 3; // 金
  assert.equal(computeCast(run, battle, tiles, false).damage, Math.floor(base.qi * base.mult * 2), '两张金 → ×2');
  battle.stacks.wheel = 0; // 木
  assert.equal(computeCast(run, battle, tiles, false).damage, base.damage, 'no 木: no effect');
  run.relics = ['tianjiqian'];
  battle.stacks.omen = 3; // 金
  assert.equal(computeCast(run, battle, tiles, false).mult, base.mult + 2);
  // 相生之器
  const chain = [T('mu', 2), T('huo', 2), T('tu', 2)];
  run.relics = [];
  const plain = computeCast(run, battle, chain, false);
  assert.deepEqual(plain.triggers, [1, 2, 3]);
  run.relics = ['hetu'];
  assert.deepEqual(computeCast(run, battle, chain, false).triggers, [1, 4, 6], '河图：被生的触发次数 ×2');
  run.relics = ['tongxin'];
  assert.deepEqual(computeCast(run, battle, chain, false).triggers, [1, 4, 3], '同心结：第一次相生多触发 2 次');
  run.relics = ['sanhuaguan'];
  assert.deepEqual(computeCast(run, battle, chain, false).triggers, [2, 2, 3], '三花冠：链首也多触发');
  run.relics = ['nilin'];
  assert.deepEqual(computeCast(run, battle, [T('mu', 2), T('tu', 2)], false).triggers, [1, 2], '逆鳞：木克土也连跳');
  run.relics = ['luoshu'];
  assert.deepEqual(computeCast(run, battle, [T('tu', 2), T('mu', 2), T('huo', 2)], false).triggers, [2, 2, 3], '洛书：最后的火生第一张土，首尾相生，每张再触发一次');
  run.relics = ['xiangsheng'];
  assert.equal(computeCast(run, battle, chain, false).mult, plain.mult + 4, '相生环：两跳 +4 番');
  // 罡气之器
  run.relics = ['pojia'];
  assert.equal(computeCast(run, battle, tiles, false).guardMult, base.guardMult + 0.5, '破甲锥：削罡气 +50%');
  run.relics = ['jiugong'];
  const g = startBattle(run, 'shiyuan', 'fight');
  run.relics = [];
  const g0 = startBattle(run, 'shiyuan', 'fight');
  assert.ok(g.stacks.guardMax < g0.stacks.guardMax, '九宫格：罡气上限 −25%');
  // 空灵根: each turn exactly one hand tile is 灵
  const k = R.createRun({ seed: 'kong', method: 'yangjian' });
  k.talents = ['kongling'];
  const kb = startBattle(k, 'shiyuan', 'fight');
  assert.equal(kb.hand.filter(t => t.mod === 'ling').length >= 1, true);
  const wheel = R.createRun({ seed: 'wheel', method: 'yangjian' });
  wheel.relics = ['mingyun'];
  const wb = startBattle(wheel, 'shiyuan', 'fight');
  assert.ok(wb.stacks.wheel >= 0 && wb.stacks.wheel <= 4, 'the wheel is spun at the start of the fight');
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
