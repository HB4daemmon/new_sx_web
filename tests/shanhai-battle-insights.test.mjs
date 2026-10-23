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
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function frame(kind, source, actor, target, player, enemy, round = 1) {
  return { kind, source, actor, target, player, enemy, round, text: '' };
}

function fighter(hp, shield) {
  return { hp, shield, maxHp: 100, name: '', method: '', rage: 0, rageCap: 100, statuses: {} };
}

test('returns up to two separate measured build highlights without combining metric types', () => {
  const result = {
    frames: [],
    contributions: [
      { id: 'RC01', name: '甲', triggers: 3, damage: 48, healing: 0, shield: 40, rage: 0, absorbed: 100 },
      { id: 'RC02', name: '乙', triggers: 2, damage: 0, healing: 12, shield: 0, rage: 4, absorbed: 0 },
      { id: 'RC03', name: '纯属性', triggers: 0, damage: 0, healing: 0, shield: 0, rage: 0, absorbed: 0 },
    ],
  };

  const insights = helper.battleInsights(result);
  assert.deepEqual(insights.highlights, [
    { source: 'RC01', metric: 'damage', amount: 48 },
    { source: 'RC02', metric: 'healing', amount: 12 },
  ]);
  assert.equal(Object.hasOwn(insights.highlights[0], 'absorbed'), false);
  assert.equal(insights.highlights.length, 2);
});

test('keeps permanent-attribute-only sources quiet but retains measured damage without triggers', () => {
  const insights = helper.battleInsights({
    frames: [],
    contributions: [
      { id: 'RC01', triggers: 0, damage: 0, healing: 0, shield: 0, rage: 0, absorbed: 0 },
      { id: 'RKF01', triggers: 0, damage: 9, healing: 0, shield: 0, rage: 0, absorbed: 0 },
    ],
  });
  assert.deepEqual(insights.highlights, [
    { source: 'RKF01', metric: 'damage', amount: 9 },
  ]);
});

test('prefers the exact lethal damage frame and reports measured HP and shield loss', () => {
  const result = {
    contributions: [],
    frames: [
      frame('start', undefined, undefined, undefined, fighter(100, 0), fighter(80, 20)),
      frame('damage', 'RC01', 'player', 'enemy', fighter(100, 0), fighter(50, 0)),
      frame('dot', 'RC02', 'player', 'enemy', fighter(100, 0), fighter(0, 0), 2),
      frame('end', undefined, undefined, undefined, fighter(100, 0), fighter(0, 0), 2),
    ],
  };

  assert.deepEqual(helper.battleInsights(result).keyDamage, {
    source: 'RC02',
    actor: 'player',
    target: 'enemy',
    round: 2,
    kind: 'dot',
    hpLost: 50,
    shieldLost: 0,
    lethal: true,
  });
});

test('does not infer damage without an authored source or a real frame delta', () => {
  const result = {
    contributions: [],
    frames: [
      frame('start', undefined, undefined, undefined, fighter(100, 0), fighter(100, 0)),
      frame('damage', 'RC01', 'enemy', 'player', fighter(100, 0), fighter(100, 0)),
      frame('damage', undefined, 'enemy', 'player', fighter(90, 0), fighter(100, 0)),
    ],
  };
  assert.equal(helper.battleInsights(result).keyDamage, undefined);
});

test('uses the largest sourced nonlethal hit when no lethal frame exists', () => {
  const result = {
    contributions: [],
    frames: [
      frame('start', undefined, undefined, undefined, fighter(100, 0), fighter(100, 0)),
      frame('damage', 'RC01', 'enemy', 'player', fighter(95, 0), fighter(100, 0)),
      frame('damage', 'RC02', 'enemy', 'player', fighter(92, 0), fighter(100, 0)),
      frame('damage', 'RC03', 'enemy', 'player', fighter(82, 0), fighter(100, 0)),
    ],
  };
  assert.deepEqual(helper.battleInsights(result).keyDamage, {
    source: 'RC03',
    actor: 'enemy',
    target: 'player',
    round: 1,
    kind: 'damage',
    hpLost: 10,
    shieldLost: 0,
    lethal: false,
  });
});

test('does not attribute the gap after a folded summary frame to the next hit', () => {
  const result = {
    contributions: [],
    frames: [
      frame('start', undefined, undefined, undefined, fighter(100, 0), fighter(100, 0)),
      frame('summary', undefined, undefined, undefined, fighter(40, 0), fighter(60, 0), 8),
      frame('damage', 'RC01', 'player', 'enemy', fighter(40, 0), fighter(50, 0), 9),
    ],
  };
  assert.equal(helper.battleInsights(result).keyDamage, undefined);
});

test('reports a real shield-only damage frame from the shield delta', () => {
  const result = {
    contributions: [],
    frames: [
      frame('start', undefined, undefined, undefined, fighter(100, 0), fighter(100, 20)),
      frame('damage', 'RC01', 'player', 'enemy', fighter(100, 0), fighter(100, 5)),
    ],
  };
  assert.deepEqual(helper.battleInsights(result).keyDamage, {
    source: 'RC01',
    actor: 'player',
    target: 'enemy',
    round: 1,
    kind: 'damage',
    hpLost: 0,
    shieldLost: 15,
    lethal: false,
  });
});
