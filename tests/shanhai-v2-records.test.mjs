import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyRecords, finishRun, readRecords, recordHit, writeRecords, RECORDS_KEY } from '../build/shanhai/records.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
}

test('a finished run is counted exactly once, even after reloads', () => {
  const records = emptyRecords();
  recordHit(records, 'run-a', 120);
  const first = finishRun(records, { runId: 'run-a', won: true, act: 5, method: 'RKF01' });
  assert.equal(first.counted, true);
  assert.equal(first.runBestHit, 120);
  assert.equal(first.firstWinWithMethod, true);
  const again = finishRun(records, { runId: 'run-a', won: true, act: 5, method: 'RKF01' });
  assert.equal(again.counted, false);
  assert.equal(records.runs, 1);
  assert.equal(records.wins, 1);
  assert.equal(records.furthestAct, 5);
});

test('best hits and furthest act are tracked across runs with honest "new record" flags', () => {
  const records = emptyRecords();
  assert.equal(recordHit(records, 'run-1', 300), false, 'the very first hit is not a "new record"');
  finishRun(records, { runId: 'run-1', won: false, act: 2, method: 'RKF02' });
  assert.equal(recordHit(records, 'run-2', 200), false);
  assert.equal(recordHit(records, 'run-2', 450), true, 'beating the stored best is flagged');
  assert.equal(recordHit(records, 'run-2', 600), false, 'announced only once per run');
  const report = finishRun(records, { runId: 'run-2', won: false, act: 3, method: 'RKF02' });
  assert.equal(report.newBestHit, true);
  assert.equal(report.newFurthestAct, true);
  assert.equal(report.firstWinWithMethod, false);
  assert.equal(records.bestHit, 600);
  assert.equal(records.runs, 2);
  assert.equal(records.wins, 0);
});

test('records survive storage round-trips and ignore corrupt data', () => {
  const storage = memoryStorage();
  const records = emptyRecords();
  recordHit(records, 'run-x', 99);
  writeRecords(records, storage);
  assert.equal(readRecords(storage).bestHit, 99);
  const corrupt = memoryStorage({ [RECORDS_KEY]: '{"runs":-3,"bestHit":"lots","finalized":[1,"ok"]}' });
  const read = readRecords(corrupt);
  assert.equal(read.runs, 0);
  assert.equal(read.bestHit, 0);
  assert.deepEqual(read.finalized, ['ok']);
  assert.deepEqual(readRecords(memoryStorage({ [RECORDS_KEY]: 'not json' })), emptyRecords());
});

test('a first run never pops "new record", and growth within a run does not spam it', () => {
  const records = emptyRecords();
  for (const amount of [50, 80, 120, 300]) assert.equal(recordHit(records, 'first', amount), false);
  const first = finishRun(records, { runId: 'first', won: false, act: 2, method: 'RKF01' });
  assert.equal(first.newBestHit, false, 'nothing to beat yet');
  const pops = [100, 250, 310, 400, 900].map(amount => recordHit(records, 'second', amount));
  assert.deepEqual(pops, [false, false, true, false, false]);
  assert.equal(finishRun(records, { runId: 'second', won: false, act: 2, method: 'RKF01' }).newBestHit, true);
  assert.equal(records.bestHit, 900);
});
