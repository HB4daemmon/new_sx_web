import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playbackSource = await readFile(path.join(ROOT, 'src/shanhai/battle-playback.ts'), 'utf8');
const appSource = await readFile(path.join(ROOT, 'src/shanhai/app.ts'), 'utf8');
const cssSource = await readFile(path.join(ROOT, 'src/shanhai/cartoon.css'), 'utf8');
const compiled = ts.transpileModule(playbackSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const playback = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fighter({ hp = 100, summons, counters } = {}) {
  return {
    name: 'fighter',
    method: 'method',
    hp,
    maxHp: 100,
    shield: 0,
    rage: 0,
    rageCap: 100,
    statuses: {},
    ...(summons ? { summons } : {}),
    ...(counters ? { counters } : {}),
  };
}

function frame(kind, {
  round = 1,
  actor,
  target,
  cue,
  player = fighter(),
  enemy = fighter(),
} = {}) {
  return { kind, round, actor, target, cue, text: kind, player, enemy };
}

test('reaction cue starts a distinct beat and keeps its following damage with it', () => {
  const cue = { kind: 'sword_volley', owner: 'player', sourceId: 'RKF05-SWORD-VOLLEY' };
  const frames = [
    frame('start'),
    frame('action', { actor: 'player' }),
    frame('damage', {
      actor: 'player',
      target: 'enemy',
      enemy: fighter({ hp: 95 }),
    }),
    frame('reaction', {
      cue,
      player: fighter({ summons: [{ id: 'flying-swords', kind: 'sword', count: 2, max: 3 }] }),
      enemy: fighter({ hp: 95 }),
    }),
    frame('damage', {
      actor: 'player',
      target: 'enemy',
      enemy: fighter({ hp: 85 }),
    }),
    frame('damage', {
      actor: 'player',
      target: 'enemy',
      enemy: fighter({ hp: 75 }),
    }),
    frame('action', { actor: 'enemy' }),
  ];

  const before = playback.combatPresentationGroup(frames, 2);
  const reaction = playback.combatPresentationGroup(frames, 3);
  const reactionDamage = playback.combatPresentationGroup(frames, 4);

  assert.equal(before.startIndex, 2);
  assert.equal(before.endIndex, 2);
  assert.equal(before.reaction, undefined);
  assert.equal(before.enemy.damage, 5);
  assert.equal(reaction.startIndex, 3);
  assert.equal(reaction.endIndex, 3);
  assert.deepEqual(reaction.reaction, cue);
  assert.deepEqual(reactionDamage.reaction, cue);
  assert.equal(reactionDamage.startIndex, 3);
  assert.equal(reactionDamage.endIndex, 4);
  assert.equal(reactionDamage.enemy.damage, 10);
  assert.equal(playback.nextCombatPresentationCursor(frames, 2), 5);
  assert.equal(playback.nextCombatPresentationCursor(frames, 3), 5);
  assert.equal(playback.nextCombatPresentationCursor(frames, 5), 6);
});

test('each authored reaction cue has its own short playback name', () => {
  const labels = {
    sword_volley: '飞剑齐射',
    guard_counter: '架势反击',
    spring_bloom: '春生回涌',
    enemy_charge: '首领蓄势',
    enemy_release: '首领释招',
    blood_valor: '血勇反击',
  };
  for (const [kind, label] of Object.entries(labels)) {
    assert.equal(
      playback.battleReactionLabel({ kind, owner: 'enemy', sourceId: 'trial-source' }),
      label,
    );
  }
  assert.equal(playback.battleReactionLabel(undefined), undefined);
});

test('a player interrupting boss charges is not presented as the boss preparing again', () => {
  const cue = { kind: 'enemy_charge', owner: 'enemy', sourceId: 'EN-A1-B1' };
  const interruption = frame('status', { actor: 'player', target: 'enemy', cue });
  assert.equal(playback.battleReactionCue(interruption), undefined);
  assert.deepEqual(playback.battleReactionCue(frame('reaction', { cue })), cue);
  const group = playback.combatPresentationGroup([frame('action'), interruption], 1);
  assert.equal(group.interruptedCharges, 1);
  assert.equal(group.reaction, undefined);
  const volley = { kind: 'sword_volley', owner: 'player', sourceId: 'RKF05-V2-RESONANCE' };
  assert.deepEqual(playback.battleReactionCue(interruption, { reaction: volley }), volley);
});

test('successive reaction loops stay as separate beats instead of collapsing into exchange', () => {
  const cues = [
    { kind: 'sword_volley', owner: 'player', sourceId: 'RKF05-SWORD-VOLLEY' },
    { kind: 'guard_counter', owner: 'player', sourceId: 'RKF01-GUARD-PRESSURE' },
    { kind: 'spring_bloom', owner: 'player', sourceId: 'RKF03-SPRING-BLOOM' },
  ];
  const frames = [
    frame('round'),
    frame('reaction', { cue: cues[0] }),
    frame('damage', { target: 'enemy', enemy: fighter({ hp: 90 }) }),
    frame('reaction', { cue: cues[1] }),
    frame('damage', { target: 'enemy', enemy: fighter({ hp: 80 }) }),
    frame('reaction', { cue: cues[2] }),
    frame('heal', { player: fighter({ hp: 105 }), enemy: fighter({ hp: 80 }) }),
    frame('action', { actor: 'enemy' }),
  ];

  assert.deepEqual(playback.combatPresentationGroup(frames, 2).reaction, cues[0]);
  assert.deepEqual(playback.combatPresentationGroup(frames, 4).reaction, cues[1]);
  assert.deepEqual(playback.combatPresentationGroup(frames, 6).reaction, cues[2]);
  assert.equal(playback.nextCombatPresentationCursor(frames, 1), 2);
  assert.equal(playback.nextCombatPresentationCursor(frames, 2), 4);
  assert.equal(playback.nextCombatPresentationCursor(frames, 4), 6);
  assert.equal(playback.nextCombatPresentationCursor(frames, 6), 7);
});

test('UI exposes paid seeking, authored trial details, persistent summons, and reduced-motion launch', () => {
  assert.match(appSource, /rewardSearchPreview/);
  assert.equal((appSource.match(/data-action="seek-reward"/g) || []).length, 1);
  assert.match(appSource, /type: 'seek_reward'/);
  assert.match(appSource, /data-trial-kind/);
  assert.match(appSource, /enemyEntity\(\).*trial/s);
  assert.match(appSource, /data-fighter-summons/);
  assert.match(appSource, /data-reaction-kind/);
  assert.match(appSource, /frame\.actor === 'player' && frame\.kind !== 'reaction'/);
  assert.match(appSource, /_travelSnapshots/);
  assert.match(appSource, /recentContributionLabel/);
  assert.match(cssSource, /\.game-page \.fighter-summons/);
  assert.match(cssSource, /\.game-page \.reaction-launch/);
  assert.match(cssSource, /\.game-page \.reward-search-confirm:disabled/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.game-page \.reaction-launch-sword/);
  assert.match(cssSource, /\.battle-shell\[data-paused="true"\] \.reaction-launch-sword/);
});
