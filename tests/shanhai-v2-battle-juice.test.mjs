import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadContent } from '../tools/content-kit/src/loader.mjs';

const buildRoot = process.env.SHANHAI_BUILD_DIR
  ? resolve(process.env.SHANHAI_BUILD_DIR)
  : resolve(new URL('../build', import.meta.url).pathname);
function buildModule(name) {
  return pathToFileURL(resolve(buildRoot, 'shanhai', name)).href;
}

const [
  { contentFromEntities },
  { simulateBattle },
  { battleJuice, hitstopWallMs, RAGE_CUTIN_HOLD_MS, KO_HOLD_MS },
  { combatPresentationGroup, nextCombatPresentationCursor },
] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
  import(buildModule('battle-juice.js')),
  import(buildModule('battle-playback.js')),
]);

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

function fighter(name, overrides = {}) {
  return {
    name,
    method: 'RKF01',
    hp: 1_000,
    maxHp: 1_000,
    shield: 0,
    maxShield: 1_000,
    rage: 0,
    rageCap: 100,
    statuses: {},
    ...overrides,
  };
}

function frame({ kind, actor, target, text = '', player = fighter('玩家'), enemy = fighter('敌人') }) {
  return { kind, round: 1, actor, target, text, player, enemy };
}

function walk(frames) {
  const beats = [];
  for (let cursor = 0; cursor < frames.length - 1;) {
    beats.push({ cursor, juice: battleJuice(frames, cursor, combatPresentationGroup(frames, cursor)) });
    const next = nextCombatPresentationCursor(frames, cursor);
    if (next <= cursor) break;
    cursor = next;
  }
  return beats;
}

test('a rage action opens a cut-in with a dramatic hold', () => {
  const frames = [
    frame({ kind: 'start' }),
    frame({ kind: 'action', actor: 'player', text: '玩家施展怒技', player: fighter('玩家', { lockedAction: 'rage_action' }) }),
  ];
  const juice = battleJuice(frames, 1, combatPresentationGroup(frames, 1));
  assert.equal(juice.rageCutIn, 'player');
  assert.equal(juice.flash, 'rage');
  assert.equal(juice.hitstopMs, RAGE_CUTIN_HOLD_MS);
  assert.equal(juice.target, undefined);
});

test('heavier blows shake harder; the blow after a rage action is a rage impact', () => {
  const light = [
    frame({ kind: 'start' }),
    frame({ kind: 'action', actor: 'player', text: '普攻' }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', text: '伤害', enemy: fighter('敌人', { hp: 970 }) }),
    frame({ kind: 'round' }),
  ];
  const heavy = [
    frame({ kind: 'start' }),
    frame({ kind: 'action', actor: 'player', text: '怒技', player: fighter('玩家', { lockedAction: 'rage_action' }) }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', text: '伤害', enemy: fighter('敌人', { hp: 700 }) }),
    frame({ kind: 'round' }),
  ];
  const a = battleJuice(light, 2, combatPresentationGroup(light, 2));
  const b = battleJuice(heavy, 2, combatPresentationGroup(heavy, 2));
  assert.equal(a.target, 'enemy');
  assert.equal(a.attacker, 'player');
  assert.equal(a.rageImpact, false);
  assert.ok(a.shake >= 1 && a.shake < b.shake);
  assert.equal(b.rageImpact, true);
  assert.equal(b.shake, 3);
  assert.equal(b.flash, 'rage');
  assert.ok(b.hitstopMs > a.hitstopMs);
  assert.ok(Math.abs(b.ratio - .3) < 1e-9);
});

test('a lethal blow is a knockout with the longest hold', () => {
  const frames = [
    frame({ kind: 'start' }),
    frame({ kind: 'action', actor: 'player', text: '普攻' }),
    frame({ kind: 'damage', actor: 'player', target: 'enemy', text: '伤害', enemy: fighter('敌人', { hp: 0 }) }),
    frame({ kind: 'end' }),
  ];
  const juice = battleJuice(frames, 2, combatPresentationGroup(frames, 2));
  assert.equal(juice.knockout, 'enemy');
  assert.equal(juice.flash, 'ko');
  assert.equal(juice.hitstopMs, KO_HOLD_MS);
});

test('hit-stop is skipped for reduced motion and shrinks sub-linearly with speed', () => {
  const juice = { hitstopMs: 160 };
  assert.equal(hitstopWallMs(juice, 1, true), 0);
  assert.equal(hitstopWallMs(juice, 1), 160);
  assert.equal(hitstopWallMs(juice, 4), 80);
  assert.equal(hitstopWallMs({ hitstopMs: 0 }, 1), 0);
});

test('real battles only produce juice from real damage and never mutate frames', () => {
  const player = { name: '玩家', method: 'RKF02', n: 4, talents: [], artifacts: [], baseStats: { attack: 100, defense: 0, max_hp: 1_000, crit_rate: .3, speed: 20 } };
  const enemy = { name: '敌人', method: 'RKF04', n: 4, talents: [], artifacts: [], baseStats: { attack: 90, defense: 0, max_hp: 900, crit_rate: .2, speed: 18 } };
  const result = simulateBattle(content, player, enemy, 'juice-seed');
  const snapshot = JSON.stringify(result.frames);
  const beats = walk(result.frames);
  assert.ok(beats.some(beat => beat.juice.target));
  for (const { cursor, juice } of beats) {
    assert.ok([0, 1, 2, 3].includes(juice.shake));
    assert.ok(juice.hitstopMs >= 0 && juice.hitstopMs <= KO_HOLD_MS);
    if (juice.target) {
      const group = combatPresentationGroup(result.frames, cursor);
      assert.equal(juice.damage, group[juice.target].damage);
      assert.ok(juice.damage > 0);
    }
  }
  assert.equal(JSON.stringify(result.frames), snapshot);
});
