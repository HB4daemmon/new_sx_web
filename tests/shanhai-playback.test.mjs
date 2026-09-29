import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(ROOT, 'src/shanhai/battle-playback.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fighter({ hp = 100, shield = 0, rage = 0, statuses = {} } = {}) {
  return { name: 'fighter', method: 'method', hp, maxHp: 100, shield, rage, rageCap: 100, statuses };
}

function frame(kind, {
  round = 1,
  actor,
  target,
  text = kind,
  player = fighter(),
  enemy = fighter(),
} = {}) {
  return { kind, round, actor, target, text, player, enemy };
}

function base(...overrides) {
  return [
    frame('start'),
    frame('action', { actor: 'player', target: 'enemy', text: '玩家普攻' }),
    ...overrides,
  ];
}

test('aggregates direct multi-hit damage and recoil independently by recipient', () => {
  const frames = base(
    frame('damage', {
      actor: 'player',
      target: 'enemy',
      text: '造成暴击 10',
      enemy: fighter({ hp: 90 }),
    }),
    frame('damage', {
      actor: 'player',
      target: 'enemy',
      text: '造成伤害 10',
      enemy: fighter({ hp: 80 }),
    }),
    frame('damage', {
      actor: 'enemy',
      target: 'player',
      text: '反噬伤害 10',
      player: fighter({ hp: 90 }),
      enemy: fighter({ hp: 80 }),
    }),
    frame('action', { round: 1, actor: 'enemy', target: 'player', text: '敌人普攻' }),
  );
  const original = structuredClone(frames);
  const group = helper.combatPresentationGroup(frames, 4);

  assert.equal(group.startIndex, 2);
  assert.equal(group.endIndex, 4);
  assert.equal(group.enemy.damage, 20);
  assert.equal(group.enemy.hits, 2);
  assert.equal(group.enemy.critical, true);
  assert.equal(group.player.damage, 10);
  assert.equal(group.player.hits, 1);
  assert.equal(group.player.critical, false);
  assert.deepEqual(frames, original);
  assert.equal(helper.nextCombatPresentationCursor(frames, 1), 4);
  assert.equal(helper.nextCombatPresentationCursor(frames, 4), 5);
});

test('records simultaneous healing for each fighter without netting it away', () => {
  const frames = [
    frame('round', {
      player: fighter({ hp: 85 }),
      enemy: fighter({ hp: 75 }),
    }),
    frame('heal', {
      player: fighter({ hp: 90 }),
      enemy: fighter({ hp: 80 }),
    }),
    frame('heal', {
      player: fighter({ hp: 95 }),
      enemy: fighter({ hp: 88 }),
    }),
  ];
  const group = helper.combatPresentationGroup(frames, 2);

  assert.equal(group.player.healing, 10);
  assert.equal(group.enemy.healing, 13);
  assert.equal(group.player.damage, 0);
  assert.equal(group.enemy.damage, 0);
});

test('separates absorbed damage from shield consumption and generation', () => {
  const frames = [
    frame('round', { enemy: fighter({ shield: 10 }) }),
    frame('damage', {
      target: 'enemy',
      enemy: fighter({ hp: 100, shield: 7 }),
    }),
    frame('shield', {
      target: 'enemy',
      enemy: fighter({ hp: 100, shield: 12 }),
    }),
    frame('status', {
      target: 'enemy',
      enemy: fighter({ hp: 100, shield: 9 }),
    }),
  ];
  const group = helper.combatPresentationGroup(frames, 3);

  assert.equal(group.enemy.shieldAbsorbed, 3);
  assert.equal(group.enemy.shieldGenerated, 5);
  assert.equal(group.enemy.shieldConsumed, 3);
  assert.equal(group.enemy.damage, 0);
  assert.equal(group.enemy.hits, 1);
});

test('groups a DOT cascade, including its healing proc, but ends at the next action', () => {
  const frames = [
    frame('round'),
    frame('dot', {
      actor: 'enemy',
      target: 'player',
      text: '中毒持续伤害',
      player: fighter({ hp: 90 }),
    }),
    frame('heal', {
      actor: 'enemy',
      target: 'enemy',
      enemy: fighter({ hp: 105 }),
    }),
    frame('dot', {
      actor: 'player',
      target: 'enemy',
      text: '燃烧持续伤害',
      player: fighter({ hp: 90 }),
      enemy: fighter({ hp: 95 }),
    }),
    frame('action', { actor: 'player', target: 'enemy', text: '玩家普攻' }),
  ];
  const group = helper.combatPresentationGroup(frames, 3);

  assert.equal(group.startIndex, 1);
  assert.equal(group.endIndex, 3);
  assert.equal(group.dot, true);
  assert.equal(group.player.dotDamage, 10);
  assert.equal(group.player.dotHits, 1);
  assert.equal(group.enemy.dotDamage, 10);
  assert.equal(group.enemy.dotHits, 1);
  assert.equal(group.enemy.healing, 5);
});

test('a DOT phase starts a new group after ordinary effects', () => {
  const frames = [
    frame('round'),
    frame('status', {
      target: 'enemy',
      enemy: fighter({ statuses: { weakness: 1 } }),
    }),
    frame('status', {
      target: 'enemy',
      enemy: fighter({ statuses: { weakness: 2 } }),
    }),
    frame('dot', {
      target: 'enemy',
      enemy: fighter({ hp: 90, statuses: { weakness: 2 } }),
    }),
    frame('heal', {
      target: 'player',
      player: fighter({ hp: 105 }),
      enemy: fighter({ hp: 90, statuses: { weakness: 2 } }),
    }),
  ];

  assert.equal(helper.combatPresentationGroup(frames, 2).dot, false);
  assert.equal(helper.combatPresentationGroup(frames, 2).enemy.statuses.weakness, 2);
  assert.equal(helper.combatPresentationStepEnd(frames, 1), 2);
  assert.equal(helper.combatPresentationGroup(frames, 4).startIndex, 3);
  assert.equal(helper.combatPresentationGroup(frames, 4).dot, true);
  assert.equal(helper.combatPresentationGroup(frames, 4).player.healing, 5);
});

test('round and action boundaries prevent aggregation from crossing turns', () => {
  const frames = [
    frame('round', { round: 1 }),
    frame('damage', { round: 1, target: 'enemy', enemy: fighter({ hp: 90 }) }),
    frame('round', { round: 2, enemy: fighter({ hp: 90 }) }),
    frame('damage', { round: 2, target: 'enemy', enemy: fighter({ hp: 80 }) }),
    frame('action', { round: 2, actor: 'enemy', target: 'player' }),
    frame('damage', { round: 2, target: 'player', player: fighter({ hp: 90 }) }),
  ];

  assert.equal(helper.combatPresentationGroup(frames, 3).enemy.damage, 10);
  assert.equal(helper.combatPresentationGroup(frames, 5).player.damage, 10);
  assert.equal(helper.nextCombatPresentationCursor(frames, 1), 2);
  assert.equal(helper.nextCombatPresentationCursor(frames, 4), 5);
});

test('start, draw, end, and summary markers also close effect beats', () => {
  for (const kind of ['start', 'draw', 'end', 'summary']) {
    const frames = [
      frame('damage', { target: 'enemy', enemy: fighter({ hp: 90 }) }),
      frame(kind, { enemy: fighter({ hp: 90 }) }),
      frame('damage', { target: 'enemy', enemy: fighter({ hp: 80 }) }),
    ];

    assert.equal(helper.combatPresentationStepEnd(frames, 0), 0, `${kind} boundary`);
    assert.equal(helper.combatPresentationGroup(frames, 2).enemy.damage, 10, `${kind} grouping`);
  }
});

test('a restored raw cursor summarizes only visible frames, not the rest of the cascade', () => {
  const frames = [
    frame('action', { actor: 'player', target: 'enemy' }),
    frame('damage', { target: 'enemy', enemy: fighter({ hp: 90 }) }),
    frame('damage', { target: 'enemy', enemy: fighter({ hp: 75 }) }),
    frame('end'),
  ];

  const restored = helper.combatPresentationGroup(frames, 1);
  assert.equal(restored.startIndex, 1);
  assert.equal(restored.endIndex, 1);
  assert.equal(restored.enemy.damage, 10);
  assert.equal(helper.nextCombatPresentationCursor(frames, 1), 2);
  assert.equal(helper.combatPresentationDuration(4), 400);
  assert.ok(helper.combatPresentationDuration(1) >= 850);
});
