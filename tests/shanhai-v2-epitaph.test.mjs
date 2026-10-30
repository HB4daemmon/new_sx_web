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
    equipment: { slots: [] },
    ownedMethods: [],
    eventCommitments: [],
    thunderChallenges: [],
    bloodVow: false,
    ...overrides,
  };
}

test('writes three compact lines from current-run craft, equipment, vow, journey, and final-battle facts', () => {
  const lines = helper.buildVictoryEpitaph(winningState({
    fusionHistory: [
      { id: 'RL06', act: 2, step: 4, title: '虚构的成器名', text: '未发生的斩神事迹' },
    ],
    artifacts: [
      { id: 'RC14', stacks: 3 },
      { id: 'RC15', stacks: 2 },
      { id: 'RC16', stacks: 3 },
      { id: 'RL07', stacks: 1 },
    ],
    equipment: { slots: ['RC14', 'RC15', 'RC16'] },
    ownedMethods: ['RKF02', 'RKF01', 'RKF02'],
    bloodVow: true,
    eventCommitments: [
      { eventId: 'RE001', optionId: 'RE001-C', originAct: 1, originStep: 1, status: 'fulfilled' },
    ],
    thunderChallenges: [
      { act: 2, step: 5, enemyId: 'EN_A1_L1', outcome: 'win' },
    ],
    battleInput: {
      player: { method: 'RKF02', talents: [], artifacts: [{ id: 'RC14', stacks: 3 }] },
    },
    battle: {
      outcome: 'player',
      contributions: [
        { id: 'RKF02', name: '逆潮功', damage: 40 },
        { id: 'RC14', name: '逐浪剑', damage: 150 },
      ],
    },
  }), resolveEntity);

  assert.deepEqual(lines, [
    '途中合炼出玉石山河印，旧器在战火中重铸；终局仍装备逐浪剑、守潮盾等共3件，皆已满层。',
    '身怀逆潮功、引气诀；背负断生之誓，战外禁疗。',
    '兑现了潮痕药篓留下的约定；曾引雷战胜雷门守将；终战伤敌最多：逐浪剑',
  ]);
  assert.equal(lines.length, 3);
  assert.doesNotMatch(lines.join('\n'), /虚构|斩神|最高|伤害占比/);
  assert.doesNotMatch(lines[0], /逆潮灯/);
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

test('describes ending equipment and known methods without inventing when they were acquired', () => {
  const lines = helper.buildVictoryEpitaph(winningState({
    fusionHistory: [{ id: 'RL06', act: 5, step: 0 }],
    artifacts: [{ id: 'RC14', stacks: 3 }],
    equipment: { slots: ['RC14'] },
    ownedMethods: ['RKF01'],
  }), resolveEntity);

  assert.deepEqual(lines, [
    '途中合炼出玉石山河印，旧器在战火中重铸；终局仍装备逐浪剑，皆已满层。',
    '身怀引气诀',
  ]);
  assert.doesNotMatch(lines.join('\n'), /登门时|此行习得/);
});

test('only calls the final battle damage leader when its complete player build is verifiable', () => {
  const build = {
    method: 'RKF02',
    talents: ['RKF02-T1'],
    artifacts: [{ id: 'RC14', stacks: 3 }],
    companions: ['RKF01', 'RKF03'],
  };
  const state = winningState({
    battleInput: { player: build },
    battle: {
      outcome: 'player',
      contributions: [
        { id: 'RKF02', name: '逆潮功', damage: 60 },
        { id: 'RKF02-T1', name: '引雷天赋', damage: 40 },
        { id: 'RC14', name: '逐浪剑', damage: 40 },
        { id: 'RKF01-COMPANION', name: '引气诀同修', damage: 5 },
        { id: 'RKF03-COMPANION', name: '春脉灵医同修', damage: 80 },
      ],
    },
  });
  const lines = helper.buildVictoryEpitaph(state, resolveEntity);
  assert.equal(lines.at(-1), '终战伤敌最多：春脉灵医同修');

  for (const battle of [
    { outcome: 'enemy', contributions: state.battle.contributions },
    { outcome: 'player', contributions: state.battle.contributions.slice(0, 2) },
    { outcome: 'player', contributions: [...state.battle.contributions, { id: 'ENEMY', name: '敌人', damage: 999 }] },
    { outcome: 'player' },
  ]) {
    const invalidLines = helper.buildVictoryEpitaph(winningState({
      battleInput: { player: build },
      battle,
    }), resolveEntity);
    assert.doesNotMatch(invalidLines.join('\n'), /终战伤敌/);
  }
});

test('includes only the permanent sacrifice law owned by the final battle build', () => {
  const player = {
    method: 'RKF02',
    talents: [],
    artifacts: [],
    permanentRule: { kind: 'blind_sword' },
  };
  const lawful = helper.buildVictoryEpitaph(winningState({
    battleInput: { player },
    battle: {
      outcome: 'player',
      contributions: [
        { id: 'RKF02', name: '逆潮功', damage: 40 },
        { id: 'RE037-B', name: '法则·盲眼剑圣', damage: 80 },
      ],
    },
  }), resolveEntity);
  assert.equal(lawful.at(-1), '终战伤敌最多：法则·盲眼剑圣');

  const forged = helper.buildVictoryEpitaph(winningState({
    battleInput: { player: { ...player, permanentRule: undefined } },
    battle: {
      outcome: 'player',
      contributions: [
        { id: 'RKF02', name: '逆潮功', damage: 40 },
        { id: 'RE037-B', name: '法则·盲眼剑圣', damage: 80 },
      ],
    },
  }), resolveEntity);
  assert.doesNotMatch(forged.join('\n'), /终战伤敌/,
    'a law not frozen in the battle build cannot be used as a final-battle source');
});

test('handles sparse and malformed victory records without creating unsupported facts', () => {
  assert.deepEqual(helper.buildVictoryEpitaph(undefined, resolveEntity), []);
  assert.deepEqual(helper.buildVictoryEpitaph({ phase: 'won' }, resolveEntity), []);
  assert.deepEqual(helper.buildVictoryEpitaph(winningState({
    fusionHistory: [null, { id: 'RL06', act: 5, step: '0' }],
    artifacts: [{ id: 'RC14', stacks: Infinity }],
    equipment: { slots: ['RC14'] },
    ownedMethods: [null, 'unknown'],
    eventCommitments: [null, { eventId: 'RE001', optionId: 'RE001-C', status: 'fulfilled' }],
    thunderChallenges: [{ act: 1, step: '0', enemyId: 'EN_A1_L1', outcome: 'win' }],
    battle: { outcome: 'player', contributions: [{ id: 'RKF01', name: '引气诀', damage: Infinity }] },
  }), resolveEntity), []);
});
