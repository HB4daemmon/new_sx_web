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

test('head floats pop, rise and fade from the shared beat progress', () => {
  assert.deepEqual(helper.battleFloatPresentation(0), { rise: 0, scale: 1.18, opacity: 1 });
  const middle = helper.battleFloatPresentation(.5);
  assert.ok(middle.rise > 20 && middle.rise < 30);
  assert.equal(middle.scale, 1);
  assert.equal(middle.opacity, 1);
  assert.ok(helper.battleFloatPresentation(.9).opacity < 1);
  assert.deepEqual(helper.battleFloatPresentation(1), { rise: 30, scale: 1, opacity: 0 });
  assert.deepEqual(helper.battleFloatPresentation(Number.NaN), helper.battleFloatPresentation(0));
  assert.deepEqual(helper.battleFloatPresentation(-1), helper.battleFloatPresentation(0));
  for (const progress of [0, .3, .8, 1, 2]) {
    assert.deepEqual(helper.battleFloatPresentation(progress, true), { rise: 0, scale: 1, opacity: 1 });
  }
});

test('blood and shield share a capacity based on actual max HP and full shield', () => {
  const presentation = helper.bloodShieldPresentation({
    hp: 320,
    maxHp: 500,
    shield: 120,
  });

  assert.equal(presentation.capacity, 620);
  assert.equal(presentation.hp, 320);
  assert.equal(presentation.shield, 120);
  assert.equal(presentation.hpPercent, 320 / 620 * 100);
  assert.equal(presentation.shieldPercent, 120 / 620 * 100);
  assert.equal(presentation.total, 440);
});

test('blood and shield presentation preserves shield above max HP', () => {
  const presentation = helper.bloodShieldPresentation({
    hp: 500,
    maxHp: 500,
    shield: 750,
  });

  assert.equal(presentation.capacity, 1250);
  assert.equal(presentation.hpPercent, 40);
  assert.equal(presentation.shieldPercent, 60);
  assert.equal(presentation.total, 1250);
});

test('blood percentage is clamped without changing displayed HP and zero capacity stays finite', () => {
  const overMaxHp = helper.bloodShieldPresentation({
    hp: 900,
    maxHp: 500,
    shield: 0,
  });
  assert.equal(overMaxHp.capacity, 500);
  assert.equal(overMaxHp.hp, 900);
  assert.equal(overMaxHp.hpPercent, 100);
  assert.equal(overMaxHp.total, 900);

  assert.deepEqual(helper.bloodShieldPresentation({
    hp: 0,
    maxHp: 0,
    shield: 0,
  }), {
    capacity: 1,
    hp: 0,
    shield: 0,
    hpPercent: 0,
    shieldPercent: 0,
    total: 0,
  });
});

test('battle action beats end on the preview attack and rage contact poses', () => {
  const attack = {
    kind: 'action',
    text: '',
    round: 1,
    actor: 'player',
    player: { lockedAction: 'basic_action' },
  };
  const rage = {
    kind: 'action',
    text: '',
    round: 1,
    actor: 'enemy',
    enemy: { lockedAction: 'rage_action' },
  };

  assert.equal(helper.BASIC_ACTION_CONTACT_MS, 19 * 1000 / 60);
  assert.equal(helper.RAGE_ACTION_CONTACT_MS, 26 * 1000 / 60);
  assert.equal(helper.battleBeatDuration(attack), 19 * 1000 / 60);
  assert.equal(helper.battleBeatDuration(rage), 26 * 1000 / 60);
  assert.equal(helper.battleBeatDuration(attack, 2), 19 * 1000 / 120);
  assert.equal(helper.battleBeatDuration(rage, 4), 26 * 1000 / 240);
});
