import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { MAX_EQUIPMENT_SLOTS } from '../build/shanhai/equipment.js';
import {
  FUNCTIONAL_WIN_SEEDS,
  START_METHODS,
  buildEncounterCalibration,
  REFERENCE_EQUIPMENT,
  runFullCalibration,
} from './shanhai-calibrate.mjs';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { equipmentCommand, nextCommand } from './shanhai-policy.mjs';

// Handpicked functional winning fixtures only; this seed set is not a win-rate cohort.
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
  assert.equal(report.calibrationStatus, 'uncalibrated V2 sample; observations do not modify authored measured fields');
  assert.equal(Object.hasOwn(report, 'statsChanges'), false);
  assert.equal(Object.hasOwn(report.input, 'loadoutChanges'), false);
  assert.match(report.inputHash, /^[a-f0-9]{64}$/);
  assert.equal(report.inputHash, report.records[0].inputHash);
  assert.deepEqual(report.input.referenceEquipment, REFERENCE_EQUIPMENT);
  assert.equal(MAX_EQUIPMENT_SLOTS, 5);
  assert.equal(report.input.referenceEquipment.length, MAX_EQUIPMENT_SLOTS);
  assert.equal(report.input.referenceEquipment.filter(id =>
    content.byId[id].equipment_role === 'core').length, 3);
  assert.equal(report.input.referenceEquipment.filter(id =>
    content.byId[id].equipment_role === 'support').length, 2);
  assert.match(report.policy, /5-slot reference loadouts/);
  assert.equal(report.input.matrix.length, enemies.length * START_METHODS.length);
  for (const row of report.input.matrix) {
    assert.equal(row.enemy.encounterId,
      content.byId[row.enemyId].trial ? row.enemyId : undefined,
      `${row.enemyId} retains its authored trial in the reference board`);
    assert.equal(row.player.encounterId, undefined);
    for (const side of [row.player, row.enemy]) {
      const ids = side.artifacts.map(stack => stack.id);
      assert.ok(ids.length <= MAX_EQUIPMENT_SLOTS,
        `${row.enemyId}/${row.method} has at most ${MAX_EQUIPMENT_SLOTS} generic slots`);
      assert.equal(new Set(ids).size, ids.length, `${row.enemyId}/${row.method} has unique artifact slots`);
      assert.ok(ids.every(id => ['core', 'support'].includes(content.byId[id]?.equipment_role)),
        `${row.enemyId}/${row.method} retains descriptive artifact roles`);
    }
    assert.equal(row.player.artifacts.length, MAX_EQUIPMENT_SLOTS,
      `${row.enemyId}/${row.method} reference player loadout fills all five slots`);
  }
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

test('simulation equipment policy fills an empty fifth slot before considering replacement', async () => {
  const content = await calibratedContent();
  const game = ShanhaiGame.create(content, {
    seed: 'policy-fifth-slot-priority',
    name: '第五槽策略夹具',
    method: 'RKF01',
  });
  const ids = ['RC01', 'RC02', 'RC03', 'RC04', 'RC05', 'RC06'];
  game.state.phase = 'map';
  game.state.artifacts = ids.map(id => ({ id, stacks: 1 }));
  game.state.equipment = { slots: ids.slice(0, MAX_EQUIPMENT_SLOTS - 1) };
  content.byId.RC06.attributes.flat.attack = 1000;

  const fillCommand = equipmentCommand(game);
  assert.deepEqual(fillCommand, { type: 'equip', id: 'RC06' },
    'a high-scoring owned item should fill the empty fifth slot without replacing an equipped item');

  game.state.equipment.slots = ids.slice(0, MAX_EQUIPMENT_SLOTS);
  const replaceCommand = equipmentCommand(game);
  assert.equal(replaceCommand.id, 'RC06');
  assert.ok(game.state.equipment.slots.includes(replaceCommand.replace),
    'once all five slots are occupied, an upgrade must target an equipped item');
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
  const c1Text = [c1.summary, c1.description, c1.identity, ...c1.counterplay, c1.preview].join('\n');
  assert.equal(c1.stats.max_hp, 280);
  assert.doesNotMatch(c1Text, /(?:气血|生命值).{0,12}(?:低于|高于).{0,12}(?:玩家|行者)/);

  const l1 = content.byId['EN-A4-L1'];
  const l1Text = [l1.summary, l1.description, l1.identity, ...l1.counterplay, l1.preview].join('\n');
  assert.equal(l1.tags.includes('shield'), false);
  assert.equal(l1.pressure.includes('稳打护盾'), false);
  assert.doesNotMatch(l1Text, /甘露护盾|治疗后.*护盾/);
});

test('five-run calibration smoke reaches terminal outcomes without errors', async () => {
  const content = await calibratedContent();
  const report = runFullCalibration(content, 1);
  assert.equal(report.runs.length, 5);
  assert.equal(report.experimentTrack, 'V2 second overhaul; buildVersion 5; shanhai-content-0.2; uncalibrated');
  assert.deepEqual(report.input.functionalWinSeeds, FUNCTIONAL_WIN_SEEDS);
  assert.deepEqual(report.runs.map(row => row.method), START_METHODS);
  assert.equal(report.outcomes.error, 0);
  assert.equal(report.outcomes.won + report.outcomes.lost + report.outcomes.undecided, 5);
  for (const row of report.runs) {
    assert.equal(row.seed, 'acceptance-0');
    assert.ok(['won', 'lost'].includes(row.result), `${row.method}: ${row.result}`);
  }
});

test('each opening method has an explicit legal 45-node winning fixture', async () => {
  const content = await calibratedContent();
  assert.deepEqual(Object.keys(FUNCTIONAL_WIN_SEEDS), START_METHODS);

  for (const method of START_METHODS) {
    const seed = FUNCTIONAL_WIN_SEEDS[method];
    const game = ShanhaiGame.create(content, { seed, name: '功能胜局夹具', method });
    let actions = 0;
    while (!['won', 'lost'].includes(game.state.phase) && actions < 600) {
      game.dispatch(nextCommand(game, 'steady'));
      actions += 1;
    }
    assert.ok(actions < 600, `${method} exceeded the run-step guard`);
    assert.equal(game.state.phase, 'won', `${method} / ${seed}`);
    assert.equal(game.state.act, 5, `${method} / ${seed}`);
    assert.equal(game.state.history.length, 45, `${method} / ${seed}`);
  }
});
