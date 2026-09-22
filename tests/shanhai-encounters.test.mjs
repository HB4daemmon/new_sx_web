import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import {
  START_METHODS,
  buildEncounterCalibration,
  runFullCalibration,
} from './shanhai-calibrate.mjs';

async function calibratedContent() {
  const model = await loadContent();
  return contentFromEntities(model.entities, model.manifest.content_version);
}

test('all 34 authored enemies have fixed legal five-dimensional inputs', async () => {
  const content = await calibratedContent();
  const enemies = content.entities.filter(entity => entity.kind === 'enemy');
  assert.equal(enemies.length, 34);
  assert.deepEqual(
    enemies.filter(enemy => enemy.tier === 'final').map(enemy => enemy.acts),
    [[5], [5]],
  );
  for (const enemy of enemies) {
    assert.equal(enemy.balance?.measured ?? enemy.measured, null, enemy.id);
    const expectedTier = enemy.tier === 'final'
      ? 4
      : /-C[12]$/.test(enemy.id)
        ? enemy.acts[0] - 1
        : enemy.acts[0];
    assert.equal(enemy.n, expectedTier, enemy.id);
    for (const key of ['attack', 'defense', 'max_hp', 'crit_rate', 'speed']) {
      assert.equal(typeof enemy.stats[key], 'number', `${enemy.id}.${key}`);
      assert.ok(Number.isFinite(enemy.stats[key]) && enemy.stats[key] > 0, `${enemy.id}.${key}`);
    }
    assert.ok(enemy.counterplay.length >= 2, `${enemy.id} counterplay`);
    assert.ok(enemy.preview.length > 0, `${enemy.id} preview`);
  }
});

test('fixed reference board uses authored early/late tiers and traces its input hash', async () => {
  const content = await calibratedContent();
  const report = buildEncounterCalibration(content, 1);
  const enemies = content.entities.filter(entity => entity.kind === 'enemy');
  assert.equal(report.input.mode, 'fixed_reference_board');
  assert.match(report.inputHash, /^[a-f0-9]{64}$/);
  assert.equal(report.inputHash, report.records[0].inputHash);
  assert.equal(report.input.matrix.length, enemies.length * START_METHODS.length);
  for (const row of report.records) {
    const enemy = content.byId[row.enemyId];
    assert.equal(row.referenceTier, enemy.n, row.enemyId);
    assert.equal(row.segment, enemy.tier === 'final'
      ? 'final'
      : /-C[12]$/.test(row.enemyId)
        ? 'early'
        : /-C[34]$/.test(row.enemyId)
          ? 'late'
          : /-L[12]$/.test(row.enemyId)
            ? 'elite'
            : 'boss_entry', row.enemyId);
    assert.equal(row.entry.player.hp, row.playerEntryHp);
    assert.equal(row.entry.player.maxHp, row.playerEntryMaxHp);
    assert.equal(row.postBattle.player.hp, row.playerHp);
    assert.equal(row.entry.enemy.hp, row.enemyEntryHp);
    assert.equal(row.entry.enemy.maxHp, row.enemyEntryMaxHp);
    assert.equal(row.postBattle.enemy.hp, row.enemyHp);
    for (const key of [
      'playerNetHpLossPct',
      'playerMinimumHp',
      'maxSingleRoundNetLossPct',
    ]) {
      assert.equal(typeof row[key], 'number', `${row.enemyId}.${key}`);
      assert.ok(Number.isFinite(row[key]), `${row.enemyId}.${key}`);
    }
  }
});

test('recovery and shield-wall authored fixtures have no fixed 256-round draw', async () => {
  const content = await calibratedContent();
  const report = buildEncounterCalibration(content, 2);
  assert.equal(report.records.length, 34 * START_METHODS.length * 2);
  assert.equal(report.records.filter(row => row.result === 'undecided').length, 0);
  assert.equal(report.records.filter(row => row.result === 'error').length, 0);
  for (const enemy of content.entities.filter(entity => entity.kind === 'enemy')) {
    const summary = report.byEnemy[enemy.id];
    assert.equal(summary.samples, START_METHODS.length * 2);
    assert.ok(summary.outcomes.won > 0, `${enemy.id} has no canonical winning sample`);
    assert.equal(summary.outcomes.won + summary.outcomes.lost + summary.outcomes.undecided + summary.outcomes.error, summary.samples);
  }
});

test('B2 and later recovery exits stay within the authored loadout boundary', async () => {
  const content = await calibratedContent();
  const artifactIds = id => content.byId[id].artifacts.map(stack => stack.id);
  assert.deepEqual(artifactIds('EN-A1-B2').includes('RL01'), false);
  assert.deepEqual(artifactIds('EN-A1-B2').includes('RR02'), false);
  assert.deepEqual(artifactIds('EN-A2-L1').includes('RR12'), false);
  assert.deepEqual(artifactIds('EN-A3-C3').includes('RR12'), false);
  assert.deepEqual(artifactIds('EN-A4-L1').includes('RR02'), false);
});

test('enemy cards do not claim removed shield outlets or inflated player-facing pressure', async () => {
  const content = await calibratedContent();
  const b2 = content.byId['EN-A1-B2'];
  const b2Text = [b2.summary, b2.description, b2.identity, ...b2.counterplay, b2.preview].join('\n');
  assert.equal(b2.tags.includes('shield'), false);
  assert.deepEqual(b2.pressure, ['恢复']);
  assert.doesNotMatch(b2Text, /治疗后护盾|溢疗转盾|有效治疗转盾|护盾出口/);

  const c1 = content.byId['EN-A1-C1'];
  assert.match(c1.description, /低于.*玩家/);
  assert.equal(c1.stats.max_hp < 500, true);

  const l1 = content.byId['EN-A4-L1'];
  const l1Text = [l1.summary, l1.description, l1.identity, ...l1.counterplay, l1.preview].join('\n');
  assert.equal(l1.tags.includes('shield'), false);
  assert.equal(l1.pressure.includes('稳打护盾'), false);
  assert.doesNotMatch(l1Text, /甘露护盾|治疗后.*护盾/);
});

test('each opening method has a real 45-node winning sample', async () => {
  const content = await calibratedContent();
  const report = runFullCalibration(content, 1);
  assert.deepEqual(report.outcomes, { won: 5, lost: 0, undecided: 0, error: 0 });
  assert.match(report.inputHash, /^[a-f0-9]{64}$/);
  for (const method of START_METHODS) {
    const row = report.runs.find(item => item.method === method);
    assert.ok(row, method);
    assert.equal(row.result, 'won', method);
    assert.equal(row.act, 5, method);
    assert.equal(row.nodes, 45, method);
  }
});
