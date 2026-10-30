import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(ROOT, 'src/shanhai/battle-insights.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { battleInsights } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function frame(kind, source, actor, target, player, enemy, round = 1) {
  return { kind, source, actor, target, player, enemy, round, text: '' };
}

function fighter(hp, shield = 0) {
  return { hp, shield, maxHp: 100, name: '', method: '', rage: 0, rageCap: 100, statuses: {} };
}

function contribution(id, healing) {
  return { id, name: id, triggers: 1, damage: 0, healing, shield: 0, rage: 0, absorbed: 0 };
}

function result(outcome, frames, contributions = []) {
  return { outcome, rounds: 1, playerHp: 0, enemyHp: 50, frames, contributions };
}

test('ranks the three largest effective healing sources by healing alone', () => {
  const insights = battleInsights(result('player', [], [
    contribution('HEAL-A', 60),
    contribution('HEAL-B', 30),
    contribution('HEAL-C', 10),
    contribution('HEAL-D', 5),
    contribution('NO-HEAL', 0),
    contribution('', 100),
  ]));

  assert.deepEqual(insights.healingRanking, [
    { source: 'HEAL-A', amount: 60, share: 60 / 105 * 100 },
    { source: 'HEAL-B', amount: 30, share: 30 / 105 * 100 },
    { source: 'HEAL-C', amount: 10, share: 10 / 105 * 100 },
  ]);
});

test('does not create a healing ranking when no source recorded effective healing', () => {
  assert.deepEqual(battleInsights(result('player', [], [
    contribution('DAMAGE', 0),
    contribution('SHIELD', 0),
  ])).healingRanking, []);
});

test('only attributes a defeat hit to a sourced enemy frame targeting the player', () => {
  const insights = battleInsights(result('enemy', [
    frame('start', undefined, undefined, undefined, fighter(100), fighter(100)),
    frame('damage', 'PLAYER-LETHAL', 'player', 'enemy', fighter(100), fighter(0)),
  ]));

  assert.equal(insights.keyDamage?.source, 'PLAYER-LETHAL');
  assert.equal(insights.keyDamage?.lethal, true);
  assert.equal(insights.defeatHit, undefined);
});

test('prefers the enemy frame that actually reduces player health to zero', () => {
  const insights = battleInsights(result('enemy', [
    frame('start', undefined, undefined, undefined, fighter(100), fighter(100)),
    frame('damage', 'ENEMY-LARGE', 'enemy', 'player', fighter(70), fighter(100)),
    frame('damage', 'PLAYER-LARGE', 'player', 'enemy', fighter(70), fighter(25)),
    frame('dot', 'ENEMY-FATAL', 'enemy', 'player', fighter(0), fighter(25), 2),
  ]));

  assert.deepEqual(insights.defeatHit, {
    source: 'ENEMY-FATAL',
    actor: 'enemy',
    target: 'player',
    round: 2,
    kind: 'dot',
    hpLost: 70,
    shieldLost: 0,
    lethal: true,
  });
});

test('falls back to the largest sourced enemy hit on the player when no lethal hit is recorded', () => {
  const insights = battleInsights(result('enemy', [
    frame('start', undefined, undefined, undefined, fighter(100), fighter(100)),
    frame('damage', 'ENEMY-SMALL', 'enemy', 'player', fighter(92), fighter(100)),
    frame('damage', 'PLAYER-LARGE', 'player', 'enemy', fighter(92), fighter(15)),
    frame('damage', 'ENEMY-MAX', 'enemy', 'player', fighter(70), fighter(15), 2),
  ]));

  assert.deepEqual(insights.defeatHit, {
    source: 'ENEMY-MAX',
    actor: 'enemy',
    target: 'player',
    round: 2,
    kind: 'damage',
    hpLost: 22,
    shieldLost: 0,
    lethal: false,
  });
});

test('leaves defeat attribution empty when source or frame evidence is missing', () => {
  const insights = battleInsights(result('enemy', [
    frame('start', undefined, undefined, undefined, fighter(100), fighter(100)),
    frame('summary', undefined, undefined, undefined, fighter(0), fighter(40), 4),
    frame('damage', undefined, 'enemy', 'player', fighter(0), fighter(40), 5),
  ]));

  assert.equal(insights.defeatHit, undefined);
});
