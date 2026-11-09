import assert from 'node:assert/strict';
import test from 'node:test';
import * as R from '../../build/v3/core/run.js';
import { enemyThreat } from '../../build/v3/core/battle.js';
import { reviewRun, playStyle, favouritePatterns } from '../../build/v3/core/review.js';
import { playBattle, playRun } from './bot.mjs';

/** Plays from the start until the first reward screen. */
function toFirstReward(seed = 'rv') {
  const run = R.createRun({ seed, method: 'yangjian' });
  R.leaveStory(run);
  R.enterNode(run, R.reachable(run)[0].id);
  playBattle(run);
  assert.equal(run.screen.name, 'reward');
  return run;
}

test('every battle leaves a journal line with HP in/out, damage sources and casts', () => {
  const run = toFirstReward();
  const [rec] = run.journal;
  assert.equal(run.journal.length, 1);
  assert.equal(rec.won, true);
  assert.equal(rec.act, 1);
  assert.ok(rec.casts >= 1 && rec.turns >= 1 && rec.best > 0);
  assert.equal(rec.enemyLeft, 0);
  assert.equal(rec.hpOut <= rec.hpIn || rec.hpOut === rec.maxHp, true);
  assert.ok(Object.values(run.stats.use).reduce((a, b) => a + b, 0) >= 1, '诀 usage counted');
});

test('换一批 costs gold, replaces the main options, once per reward', () => {
  const run = toFirstReward();
  run.gold = 100;
  const before = JSON.stringify(run.screen.options);
  assert.equal(R.rerollReward(run), true);
  assert.equal(run.gold, 100 - R.rerollPrice(run));
  assert.notEqual(JSON.stringify(run.screen.options), before);
  assert.equal(R.rerollReward(run), false, 'only once');
  const poor = toFirstReward('rv2');
  poor.gold = 0;
  assert.equal(R.rerollReward(poor), false, 'needs the gold');
});

test('不取 pays a little gold; taking a reward does not', () => {
  const skip = toFirstReward();
  const g = skip.gold;
  R.leaveReward(skip);
  assert.equal(skip.gold, g + R.skipGold(skip));
  assert.equal(skip.stats.skips, 1);
  const take = toFirstReward();
  R.takeReward(take, 'main', 0);
  const g2 = take.gold;
  R.leaveReward(take);
  assert.equal(take.gold, g2);
});

test('坊市补货 replaces unsold items once and keeps sold ones', () => {
  const run = R.createRun({ seed: 'shop', method: 'yangjian' });
  run.gold = 999;
  run.screen = { name: 'map' };
  run.map = [{ id: 'x', row: 0, col: 0, kind: 'shop', next: [] }];
  R.enterNode(run, 'x');
  const shop = run.screen;
  const tileIdx = shop.items.findIndex(i => i.option.type === 'tile');
  R.buy(run, tileIdx);
  const sold = JSON.stringify(shop.items[tileIdx]);
  assert.equal(R.restockShop(run), true);
  assert.equal(JSON.stringify(run.screen.items[tileIdx]), sold);
  assert.equal(R.restockShop(run), false);
});

test('复盘 explains a lost run: near-miss, at least one finding with a next step', () => {
  let checked = 0;
  for (let i = 0; i < 12 && checked < 3; i += 1) {
    const run = playRun(R.createRun({ seed: `lose-${i}`, method: 'huichun' }));
    if (run.screen.name !== 'lost') continue;
    const review = reviewRun(run);
    assert.ok(review.last && !review.last.won);
    assert.ok(review.nearMiss.pct > 0 && review.nearMiss.pct <= 1);
    assert.ok(review.findings.length >= 1 && review.findings.length <= 3);
    for (const f of review.findings) assert.ok(f.title && f.detail && f.tryNext);
    assert.ok(playStyle(run));
    checked += 1;
  }
  assert.ok(checked >= 1, 'the bot loses at least one of these runs');
});

test('map threat grows with the act and 最常用诀 shows up as favourite', () => {
  const run = R.createRun({ seed: 't', method: 'yangjian' });
  const a1 = enemyThreat(run, 'shiyuan');
  run.act = 3;
  assert.ok(enemyThreat(run, 'shiyuan') > a1 && a1 > 0);
  run.stats.use = { lian: 5, yuan: 1, podi: 3 };
  assert.deepEqual(favouritePatterns(run), ['lian', 'podi']);
});
