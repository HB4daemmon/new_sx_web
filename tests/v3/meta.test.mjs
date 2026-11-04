import assert from 'node:assert/strict';
import test from 'node:test';
import { readMeta, recordRunEnd, writeMeta, META_KEY } from '../../build/v3/ui/meta.js';

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('meta: a win unlocks 烛龙 and the next 劫数; records only count real improvements', () => {
  const meta = readMeta(store());
  const first = recordRunEnd(meta, { won: false, method: 'yangjian', heat: 0, bestHit: 500 });
  assert.equal(first.newBest, false, 'first run has nothing to beat');
  const second = recordRunEnd(meta, { won: true, method: 'yangjian', heat: 0, bestHit: 900 });
  assert.equal(second.newBest, true);
  assert.equal(second.unlockedMethod, 'zhulong');
  assert.equal(second.unlockedHeat, 1);
  assert.equal(meta.maxHeat, 1);
  const third = recordRunEnd(meta, { won: true, method: 'yuhuo', heat: 0, bestHit: 100 });
  assert.equal(third.unlockedHeat, null, 'winning a lower 劫数 unlocks nothing new');
  assert.equal(meta.runs, 3);
  assert.equal(meta.wins, 2);
});

test('meta: survives corrupt storage', () => {
  assert.equal(readMeta(store({ [META_KEY]: 'garbage' })).runs, 0);
  const odd = readMeta(store({ [META_KEY]: '{"runs":-1,"maxHeat":99,"unlocked":[1,"zhulong"],"speed":2}' }));
  assert.equal(odd.runs, 0);
  assert.equal(odd.maxHeat, 30);
  assert.deepEqual(odd.unlocked, ['zhulong']);
  assert.equal(odd.speed, 2);
  const s = store();
  writeMeta(odd, s);
  assert.equal(readMeta(s).speed, 2);
});
