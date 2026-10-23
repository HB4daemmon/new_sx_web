import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';

const START_METHODS = Object.freeze(['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05']);
const METHOD_BRANCHES = Object.freeze({
  RKF01: 'A',
  RKF02: 'B',
  RKF03: 'B',
  RKF04: 'C',
  RKF05: 'B',
});
const clone = value => structuredClone(value);

async function loadGameContent() {
  const model = await loadContent();
  assert.deepEqual(model.issues, []);
  return contentFromEntities(model.entities, model.manifest.content_version);
}

function referenceLoadouts(content, enemy, method) {
  const n = Math.min(4, Math.max(0, enemy.n));
  const player = {
    name: `第一幕参照-${method}`,
    method,
    n,
    talents: content.byId[method].talents
      .filter(talent => talent.tier <= n && talent.branch === METHOD_BRANCHES[method])
      .map(talent => talent.id),
    artifacts: [],
    baseStats: clone(content.rules.cultivation.base_stats_by_tier[n]),
    preparation: 0,
    firstStrike: 0,
  };
  player.hp = calculateStats(content, player).max_hp;

  const target = {
    name: enemy.name,
    method: enemy.method,
    n: enemy.n,
    talents: clone(enemy.talents ?? []),
    artifacts: clone(enemy.artifacts ?? []),
    baseStats: clone(enemy.stats),
    preparation: 0,
    firstStrike: 0,
  };
  target.hp = calculateStats(content, target).max_hp;
  return { player, target };
}

test('all five starting methods have a viable fixed-reference answer to every act-one enemy', async () => {
  const content = await loadGameContent();
  const enemies = content.entities.filter(entity =>
    entity.kind === 'enemy' && entity.acts.includes(1));
  assert.equal(enemies.length, 8);

  for (const enemy of enemies) {
    for (const method of START_METHODS) {
      const { player, target } = referenceLoadouts(content, enemy, method);
      for (let seedIndex = 0; seedIndex < 5; seedIndex += 1) {
        const seed = `calibration-${enemy.id}-${method}-${seedIndex}`;
        const result = simulateBattle(content, player, target, seed, { roundLimit: 256 });
        assert.equal(result.outcome, 'player', `${enemy.id} / ${method} / ${seed}`);
        assert.ok(result.playerHp > 0, `${enemy.id} / ${method} / ${seed} survival`);
      }
    }
  }
});

test('act-one pressure mechanisms appear in actual battle frames', async () => {
  const content = await loadGameContent();

  const lightning = content.byId['EN-A1-C2'];
  const lightningLoadouts = referenceLoadouts(content, lightning, 'RKF02');
  // A durable, low-output observer lets the authored rage cycle complete.
  lightningLoadouts.player.baseStats.attack = 20;
  lightningLoadouts.player.baseStats.max_hp = 10_000;
  lightningLoadouts.player.hp = 10_000;
  const lightningResult = simulateBattle(
    content,
    lightningLoadouts.player,
    lightningLoadouts.target,
    'calibration-EN-A1-C2-RKF02-0',
    { roundLimit: 256 },
  );
  const lightningRageHits = lightningResult.frames.filter(frame =>
    frame.source === 'RKF07-RAGE-DAMAGE' && frame.text.startsWith('敌人造成'));
  assert.ok(lightningRageHits.length >= 3, '雷獭怒技 should show its multiple direct segments');

  const reflector = content.byId['EN-A1-C4'];
  const reflectorLoadouts = referenceLoadouts(content, reflector, 'RKF02');
  reflectorLoadouts.player.baseStats.attack = 20;
  reflectorLoadouts.player.baseStats.max_hp = 10_000;
  reflectorLoadouts.player.hp = 10_000;
  const reflectorResult = simulateBattle(
    content,
    reflectorLoadouts.player,
    reflectorLoadouts.target,
    'calibration-EN-A1-C4-RKF02-0',
    { roundLimit: 256 },
  );
  assert.ok(reflectorResult.frames.some(frame =>
    frame.source === 'RKF01-PASSIVE-RECOIL' && frame.text.includes('盾返')),
  '甲蜥 shield absorption should produce its authored reflection');

  const healer = content.byId['EN-A1-B2'];
  const healerLoadouts = referenceLoadouts(content, healer, 'RKF02');
  healerLoadouts.player.baseStats.attack = 20;
  healerLoadouts.player.baseStats.max_hp = 10_000;
  healerLoadouts.player.hp = 10_000;
  const healerResult = simulateBattle(
    content,
    healerLoadouts.player,
    healerLoadouts.target,
    'calibration-EN-A1-B2-RKF02-0',
    { roundLimit: 256 },
  );
  assert.ok(healerResult.rounds >= 6, 'the healer should show a sustained recovery loop');
  assert.ok(healerResult.frames.some(frame =>
    frame.source === 'RKF03-BASIC-HEAL' && frame.kind === 'heal'),
  'the healer basic-action recovery should be visible');
  assert.ok(healerResult.frames.some(frame =>
    frame.source === 'RKF03-RAGE-HEAL' && frame.kind === 'heal'),
  'the healer rage-action recovery should be visible');

  const wheelBoss = content.byId['EN-A1-B1'];
  assert.ok(wheelBoss.artifacts.some(stack => stack.id === 'RL03'),
    'the boss retains the authored two-hit wheel follow-up');
  assert.equal(wheelBoss.artifacts.some(stack => stack.id === 'RL05'), false,
    'the boss does not compound the wheel with fixed rage returns');
});
