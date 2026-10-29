import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(ROOT, 'src/shanhai/epitaph.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const entities = {
  RL06: { id: 'RL06', kind: 'artifact', name: '玉石山河印', max_stacks: 1 },
  RL07: { id: 'RL07', kind: 'artifact', name: '逆潮灯', max_stacks: 1 },
  RC14: { id: 'RC14', kind: 'artifact', name: '逐浪剑', max_stacks: 3, awakening: { at_stacks: 3 } },
  RC15: { id: 'RC15', kind: 'artifact', name: '守潮盾', max_stacks: 2, awakening: { at_stacks: 2 } },
  RC16: { id: 'RC16', kind: 'artifact', name: '破浪珠', max_stacks: 3 },
  RKF01: { id: 'RKF01', kind: 'method', name: '引气诀' },
  RKF02: { id: 'RKF02', kind: 'method', name: '逆潮功' },
  RE001: {
    id: 'RE001', kind: 'event', name: '潮痕药篓',
    options: [{ id: 'RE001-C', legacy_commitment: { name: '护送药箱' } }],
  },
  RE002: {
    id: 'RE002', kind: 'event', name: '石桥点斗',
    options: [{ id: 'RE002-A', commitment: { name: '再会之约' } }],
  },
  EN_A1_L1: { id: 'EN_A1_L1', kind: 'enemy', name: '雷门守将' },
  EN_A2_B1: { id: 'EN_A2_B1', kind: 'enemy', name: '山门旧将' },
};

const resolveEntity = id => entities[id];

function winningState(overrides = {}) {
  return {
    phase: 'won',
    act: 5,
    step: 0,
    fusionHistory: [],
    artifacts: [],
    ownedMethods: [],
    eventCommitments: [],
    thunderChallenges: [],
    ...overrides,
  };
}

test('writes three compact lines from content names and current-run records', () => {
  const lines = helper.buildVictoryEpitaph(winningState({
    fusionHistory: [
      { id: 'RL06', act: 2, step: 4, title: '虚构的成器名', text: '未发生的斩神事迹' },
    ],
    artifacts: [
      { id: 'RC14', stacks: 3 },
      { id: 'RC15', stacks: 2 },
      { id: 'RC16', stacks: 2 },
      { id: 'RL07', stacks: 1 },
    ],
    ownedMethods: ['RKF02', 'RKF01', 'RKF02'],
    eventCommitments: [
      { eventId: 'RE001', optionId: 'RE001-C', originAct: 1, originStep: 1, status: 'fulfilled' },
    ],
    thunderChallenges: [
      { act: 2, step: 5, enemyId: 'EN_A1_L1', outcome: 'win' },
    ],
  }), resolveEntity);

  assert.deepEqual(lines, [
    '途中合炼出玉石山河印，旧器在战火中重铸。',
    '最终持有的逐浪剑、守潮盾已至满层；身怀逆潮功、引气诀',
    '兑现了潮痕药篓留下的约定；曾引雷战胜雷门守将',
  ]);
  assert.equal(lines.length, 3);
  assert.doesNotMatch(lines.join('\n'), /虚构|斩神|最高|伤害占比/);
  assert.doesNotMatch(lines[1], /逆潮灯/);
});

test('shows no facts on a loss and leaves an empty victory record empty', () => {
  const populated = winningState({
    phase: 'lost',
    fusionHistory: [{ id: 'RL06', act: 2, step: 4, title: '假记录', text: '假记录' }],
    ownedMethods: ['RKF02'],
  });
  assert.deepEqual(helper.buildVictoryEpitaph(populated, resolveEntity), []);
  assert.deepEqual(helper.buildVictoryEpitaph(winningState(), resolveEntity), []);
});

test('keeps the existing journey disclosure on both outcomes and adds the epitaph only on victory', async () => {
  const app = await readFile(path.join(ROOT, 'src/shanhai/app.ts'), 'utf8');
  const endView = app.split('private endView(state: RunState): string {')[1]
    ?.split('private winningEpitaphMarkup(state: RunState): string {')[0];
  assert.ok(endView, 'endView should remain present before the victory epitaph renderer');
  assert.ok(endView.includes('${state.history.length ? `<details class="disclosure end-epilogue"'));
  assert.ok(endView.includes('${this.characterJourneyMarkup(state)}${this.storyEchoMarkup(state)}'));
  assert.ok(endView.includes("${win ? this.winningEpitaphMarkup(state) : ''}"));
});

test('keeps source order, skips unfulfilled or future records, and ignores event outcome prose', () => {
  const lines = helper.buildVictoryEpitaph(winningState({
    fusionHistory: [
      { id: 'RL07', act: 1, step: 1, title: 'ignored', text: 'ignored' },
      { id: 'RL06', act: 2, step: 1, title: 'ignored', text: 'ignored' },
      { id: 'RL07', act: 5, step: 1, title: 'future', text: 'future' },
    ],
    ownedMethods: ['RKF02', 'RKF01'],
    eventCommitments: [
      { eventId: 'RE002', optionId: 'RE002-A', originAct: 2, originStep: 3, status: 'fulfilled' },
      { eventId: 'RE001', optionId: 'RE001-C', originAct: 2, originStep: 4, status: 'active' },
      { eventId: 'RE001', optionId: 'RE001-C', originAct: 2, originStep: 5, status: 'broken' },
      { eventId: 'RE001', optionId: 'RE001-C', originAct: 2, originStep: 6, status: 'expired' },
      { eventId: 'RE001', optionId: 'RE001-C', originAct: 5, originStep: 1, status: 'fulfilled' },
    ],
    thunderChallenges: [
      { act: 2, step: 1, enemyId: 'EN_A2_B1', outcome: 'win' },
      { act: 2, step: 2, enemyId: 'EN_A1_L1', outcome: 'loss' },
      { act: 5, step: 1, enemyId: 'EN_A1_L1', outcome: 'win' },
    ],
    history: [
      { act: 5, step: 1, eventId: 'RE001', eventOutcome: 'success', text: '未遇之神的未来结局' },
    ],
  }), resolveEntity);

  assert.deepEqual(lines, [
    '途中合炼出逆潮灯、玉石山河印，旧器在战火中重铸。',
    '身怀逆潮功、引气诀',
    '兑现了石桥点斗留下的约定；曾引雷战胜山门旧将',
  ]);
  assert.doesNotMatch(lines.join('\n'), /护送药箱|未遇之神|未来结局|雷门守将/);
});

test('describes ending inventory and starting method without inventing when they were acquired', () => {
  const lines = helper.buildVictoryEpitaph(winningState({
    fusionHistory: [{ id: 'RL06', act: 5, step: 0 }],
    artifacts: [{ id: 'RC14', stacks: 3 }],
    ownedMethods: ['RKF01'],
  }), resolveEntity);

  assert.deepEqual(lines, [
    '途中合炼出玉石山河印，旧器在战火中重铸。',
    '最终持有的逐浪剑已至满层；身怀引气诀',
  ]);
  assert.doesNotMatch(lines.join('\n'), /登门时|此行习得/);
});
