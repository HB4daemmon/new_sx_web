import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(ROOT, 'src/shanhai/battle-presentation.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function frame(overrides = {}) {
  const fighter = (values = {}) => ({
    name: 'fighter',
    method: 'method',
    hp: 100,
    maxHp: 100,
    shield: 0,
    rage: 0,
    rageCap: 100,
    statuses: {},
    ...values,
  });
  return {
    round: 1,
    kind: 'round',
    text: '回合',
    player: fighter(),
    enemy: fighter(),
    ...overrides,
  };
}

test('battle beat timing follows event type and replay speed', () => {
  assert.equal(helper.battleBeatDuration(frame({ kind: 'action', text: '普攻' })), 520);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'action', text: '怒技' })), 800);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'damage' })), 450);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'heal' })), 400);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'shield' })), 400);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'status' })), 220);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'rage' })), 220);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'round' })), 400);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'damage' }), 2), 225);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'damage' }), 4), 112.5);
  assert.equal(helper.battleBeatDuration(frame({ kind: 'damage' }), 0), 450);
});

test('battle cues distinguish damage, blocked hits, healing, shields, DOT, and trusted criticals', () => {
  const before = frame();
  assert.equal(helper.battlePresentationCue(frame({
    kind: 'damage',
    target: 'enemy',
    actor: 'player',
    text: '普通伤害',
    enemy: { ...before.enemy, hp: 70 },
  }), before).enemyMotion, 'hit');
  assert.equal(helper.battlePresentationCue(frame({
    kind: 'damage',
    target: 'enemy',
    actor: 'player',
    text: '护盾吸收',
    enemy: { ...before.enemy, shield: 0 },
  }), frame({ enemy: { ...before.enemy, shield: 20 } })).enemyMotion, 'block');
  assert.equal(helper.battlePresentationCue(frame({
    kind: 'damage',
    target: 'enemy',
    actor: 'player',
    text: '会心一击',
    enemy: { ...before.enemy, hp: 70 },
  }), before).critical, true);
  assert.equal(helper.battlePresentationCue(frame({
    kind: 'damage',
    target: 'enemy',
    actor: 'player',
    text: '普通伤害',
    enemy: { ...before.enemy, hp: 70 },
  }), before).critical, false);
  assert.equal(helper.battlePresentationCue(frame({
    kind: 'heal',
    target: 'player',
    text: '恢复',
    player: { ...before.player, hp: 120 },
  }), before).playerMotion, 'heal');
  assert.equal(helper.battlePresentationCue(frame({
    kind: 'shield',
    target: 'player',
    text: '护盾',
    player: { ...before.player, shield: 30 },
  }), before).playerMotion, 'shield');
  assert.equal(helper.battlePresentationCue(frame({
    kind: 'dot',
    target: 'player',
    text: '中毒',
    player: { ...before.player, hp: 90 },
  }), before).playerMotion, 'dot');
});

test('rage action is distinct from rage changes and cue helpers do not mutate frames', () => {
  const before = frame();
  const rageAction = frame({
    kind: 'action',
    actor: 'player',
    text: '释放怒技',
    player: { ...before.player, lockedAction: 'rage_action' },
  });
  const rageGain = frame({
    kind: 'rage',
    actor: 'player',
    text: '轮尾回怒',
    amount: 10,
    player: { ...before.player, rage: 10 },
  });
  const snapshots = structuredClone([before, rageAction, rageGain]);
  assert.deepEqual(helper.battlePresentationCue(rageAction, before), {
    actionKind: 'rage',
    playerMotion: 'rage',
    enemyMotion: 'idle',
    critical: false,
  });
  assert.deepEqual(helper.battlePresentationCue(rageGain, before), {
    actionKind: 'none',
    playerMotion: 'idle',
    enemyMotion: 'idle',
    critical: false,
  });
  helper.battleBeatDuration(rageGain, 4);
  assert.deepEqual([before, rageAction, rageGain], snapshots);
});
