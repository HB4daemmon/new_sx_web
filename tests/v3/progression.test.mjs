import assert from 'node:assert/strict';
import test from 'node:test';
import * as R from '../../build/v3/core/run.js';
import { startBattle, handSize, tribulationStart } from '../../build/v3/core/battle.js';
import { pactHeat, PACTS } from '../../build/v3/core/pacts.js';
import { RELICS, SIGNATURE } from '../../build/v3/core/content.js';
import { readMeta } from '../../build/v3/ui/meta.js';
import { ACHIEVEMENTS, buyNode, canBuy, checkAchievements, dailySetup, masteryLevel, nextGoal, runUnlocks, settle, TREE } from '../../build/v3/ui/progression.js';
import { playRun } from './bot.mjs';

const freshMeta = () => readMeta({ getItem: () => null });

test('天劫契: heat sums clause costs and each clause actually bites', () => {
  assert.equal(pactHeat({ cloud: 3, short: 1, narrow: 1, bogus: 4 }), 3 + 2 + 3);
  const plain = R.createRun({ seed: 'p', method: 'yangjian' });
  const hard = R.createRun({ seed: 'p', method: 'yangjian', pacts: { cloud: 2, thunder: 1, murk: 2, short: 1, narrow: 1, lone: 1, cloudy: 9 } });
  assert.equal(hard.heat, 2 + 1 + 2 + 2 + 3 + 2);
  assert.deepEqual(hard.plan, [], '断缘: no threads');
  assert.equal(hard.bag.filter(t => t.el === 'zhuo').length, 4, '浊世 ×2');
  assert.equal(handSize(hard), handSize(plain) - 1);
  assert.equal(tribulationStart(hard), tribulationStart(plain) - 2);
  const a = startBattle(plain, 'shiyuan', 'fight'), b = startBattle(hard, 'shiyuan', 'fight');
  assert.ok(Math.abs(b.enemy.maxHp / a.enemy.maxHp - 1.3) < 0.01);
  for (const p of PACTS) assert.ok(p.desc(1) && p.cost > 0);
});

test('道树 gates new relics; 本命法宝 only for their method after 道行 2', () => {
  const locked = R.createRun({ seed: 'u', method: 'yangjian' });
  const gated = RELICS.filter(r => r.unlock);
  assert.ok(gated.length >= 12);
  for (const r of gated) assert.equal(R.relicAvailable(locked, r.id), false, r.id);
  assert.equal(R.relicAvailable(locked, SIGNATURE.yangjian), false);
  const open = R.createRun({ seed: 'u', method: 'yangjian', unlocks: ['relics1', 'relics2', 'relics3', 'm:yangjian:2'] });
  for (const r of gated) assert.equal(R.relicAvailable(open, r.id), true, r.id);
  assert.equal(R.relicAvailable(open, SIGNATURE.yangjian), true);
  assert.equal(R.relicAvailable(open, SIGNATURE.yuhuo), false, "another method's signature never shows");
  const lv4 = R.createRun({ seed: 'u', method: 'yuhuo', unlocks: ['m:yuhuo:2', 'm:yuhuo:3', 'm:yuhuo:4', 'gold1', 'ling1', 'slot1'] });
  assert.ok(lv4.relics.includes(SIGNATURE.yuhuo), '道行 4 starts with it');
  assert.equal(lv4.gold, 60);
  assert.equal(lv4.relicSlots, 6);
  assert.equal(lv4.bag.filter(t => t.mod === 'ling').length, 2);
});

test('道树 purchase rules and the next goal', () => {
  const meta = freshMeta();
  assert.equal(canBuy(meta, 'relics1'), false, 'no 道果 yet');
  meta.daoguo = 1000;
  assert.equal(canBuy(meta, 'relics2'), false, 'prerequisite first');
  assert.ok(buyNode(meta, 'relics1'));
  assert.ok(buyNode(meta, 'relics2'));
  assert.equal(meta.daoguo, 1000 - 40 - 90);
  assert.equal(buyNode(meta, 'relics1'), false, 'never twice');
  assert.ok(nextGoal(meta));
  for (const node of TREE) if (node.requires) assert.ok(TREE.some(n => n.id === node.requires));
  meta.mastery.yangjian = 130;
  assert.equal(masteryLevel(130), 3);
  assert.deepEqual(runUnlocks(meta, 'yangjian').filter(u => u.startsWith('m:')), ['m:yangjian:2', 'm:yangjian:3']);
});

test('a full run settles 道果 once, achievements pay on the spot, endless continues and pays only the difference', () => {
  const meta = freshMeta();
  process.env.ENDLESS = '1';
  let run;
  for (let i = 0; i < 12 && !(run && run.endless); i += 1) run = playRun(R.createRun({ seed: `endless-${i}`, method: 'benlei' }));
  delete process.env.ENDLESS;
  assert.ok(run.endless >= 1, 'a winning run continued into 无尽天劫');
  assert.equal(run.screen.name, 'lost');
  assert.ok(run.log.filter(l => l.startsWith('boss:')).length >= 5);
  const got = checkAchievements(meta, { kind: 'end', run, won: true, meta });
  assert.ok(got.length > 0);
  const before = meta.daoguo;
  const first = settle(meta, run, true);
  assert.ok(first.total > 0 && meta.daoguo === before + first.total);
  const again = settle(meta, run, false);
  assert.equal(again.total, 0, 'never paid twice');
  assert.equal(again.achievements, 0);
  assert.equal(checkAchievements(meta, { kind: 'end', run, won: true, meta }).length, 0, 'each 悟道 once');
  assert.ok(ACHIEVEMENTS.every(a => a.reward > 0));
});

test('每日一劫 is the same for everyone on a day', () => {
  assert.deepEqual(dailySetup('2026-11-04'), dailySetup('2026-11-04'));
  const days = new Set(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'].map(d => JSON.stringify(dailySetup(d))));
  assert.ok(days.size > 1);
  const d = dailySetup('2026-11-04');
  const a = R.createRun({ seed: d.seed, method: d.method, pacts: d.pacts, daily: '2026-11-04' });
  const b = R.createRun({ seed: d.seed, method: d.method, pacts: d.pacts, daily: '2026-11-04' });
  assert.deepEqual(a, b);
  assert.ok(a.heat > 0);
});
