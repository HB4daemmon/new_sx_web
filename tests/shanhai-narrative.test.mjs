import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { characterJourneys, eventEchoes } from '../build/shanhai/narrative.js';

const model = await loadContent();
const content = contentFromEntities(model.entities, model.manifest.content_version);

function runState(overrides = {}) {
  return {
    schema: 1,
    contentVersion: content.version,
    id: 'narrative-test',
    seed: 'narrative-test',
    name: '行者',
    phase: 'map',
    act: 1,
    step: 0,
    nodes: [],
    routes: [],
    method: 'RKF02',
    ownedMethods: ['RKF02'],
    talents: {},
    n: 0,
    hp: 100,
    xp: 0,
    coins: 0,
    artifacts: [],
    preparation: 0,
    flags: {},
    storyline: '',
    independentCore: null,
    history: [],
    seenEvents: [],
    completedCore: [],
    eventCommitments: [],
    extraElites: 0,
    ordinaryCount: 0,
    rewardCandidates: [],
    shop: [],
    resultText: '',
    ...overrides,
  };
}

const lines = [
  {
    id: 'RS01',
    initial: 'RK001',
    promise: 'RK001-reserve-medicine',
    refusal: 'RK001-take-small-gain',
    followUp: 'RK002',
    finish: 'RK002-pay-safe',
  },
  {
    id: 'RS02',
    initial: 'RK003',
    promise: 'RK003-pursue-trial',
    refusal: 'RK003-take-xp',
    followUp: 'RK004',
    finish: 'RK004-pay-route',
  },
  {
    id: 'RS03',
    initial: 'RK005',
    promise: 'RK005-carry-sight',
    refusal: 'RK005-take-xp',
    followUp: 'RK006',
    finish: 'RK006-pay-steady',
  },
  {
    id: 'RS04',
    initial: 'RK007',
    promise: 'RK007-forgo-growth',
    refusal: 'RK007-take-xp',
    followUp: 'RK008',
    finish: 'RK008-pay-work',
  },
  {
    id: 'RS05',
    initial: 'RK009',
    promise: 'RK009-enter-first-array',
    refusal: 'RK009-take-safe',
    followUp: 'RK010',
    finish: 'RK010-pay-artifact',
  },
  {
    id: 'RS06',
    initial: 'RK011',
    promise: 'RK011-carry-fire-cost',
    refusal: 'RK011-take-coins',
    followUp: 'RK012',
    finish: 'RK012-pay-wind',
  },
];

function entry(eventId, optionId, overrides = {}) {
  const event = content.byId[eventId];
  return {
    act: event.acts[0],
    step: 1,
    title: event.name,
    text: '',
    eventId,
    optionId,
    ...overrides,
  };
}

function lineJourney(line, initialOption, followUpOption, overrides = {}) {
  const initial = entry(line.initial, initialOption, line.id === 'RS05' ? { eventOutcome: 'success' } : {});
  const history = [initial];
  if (followUpOption) history.push(entry(line.followUp, followUpOption));
  const flags = initialOption === line.promise ? { [`${line.id}-promised`]: true } : {};
  return characterJourneys(content, runState({
    act: 1,
    history,
    flags,
    ...overrides,
  })).find(item => item.id === line.id);
}

test('all six actual storyline encounters report the selected promise and completed revisit', () => {
  for (const line of lines) {
    const journey = lineJourney(line, line.promise, line.finish);
    assert.ok(journey, `${line.id} should be based on its actual encounter history`);
    assert.equal(journey.status, line.id === 'RS04' ? '回访取助' : '回访交易', line.id);
    const followUp = content.byId[line.followUp];
    const expected = followUp.options.find(option => option.id === line.finish).story_echo;
    assert.ok(journey.text.includes(expected), line.id);
  }
});

test('all six actual initial branches that do not set the promise are reported without invented revisits', () => {
  for (const line of lines) {
    const journey = lineJourney(line, line.refusal);
    assert.ok(journey, `${line.id} initial meeting should be retained`);
    assert.equal(journey.status, '未应约', line.id);
    assert.equal(journey.text, content.byId[line.initial].options
      .find(option => option.id === line.refusal).story_echo);
  }
});

test('a successful initial staged trial can remain pending until a real revisit is recorded', () => {
  const nezha = lines.find(line => line.id === 'RS05');
  const journey = lineJourney(nezha, nezha.promise, undefined, { act: 2 });
  assert.equal(journey.status, '待回访');
  assert.match(journey.text, /第二阵资格/);
});

test('trial failure uses only the failure echo and never counts as completed core success', () => {
  const nezha = lines.find(line => line.id === 'RS05');
  const failedHistory = [entry(nezha.initial, nezha.promise, { eventOutcome: 'failure' })];
  const state = runState({
    history: failedHistory,
    flags: {},
    completedCore: ['RK009'],
  });
  const journey = characterJourneys(content, state).find(item => item.id === 'RS05');
  const failureEcho = content.byId[nezha.initial].options
    .find(option => option.id === nezha.promise).story_failure_echo;

  assert.equal(journey.status, '试炼失手');
  assert.equal(journey.text, failureEcho);
  assert.deepEqual(eventEchoes(content, state, 2), [{
    id: nezha.initial,
    title: content.byId[nezha.initial].name,
    text: failureEcho,
  }]);
});

test('an internal battle uses its success echo only with an explicit success result', () => {
  const nezha = lines.find(line => line.id === 'RS05');
  const state = runState({
    act: 2,
    history: [entry(nezha.initial, nezha.promise, { eventOutcome: 'success' })],
    flags: { 'RS05-promised': true },
  });
  const successEcho = content.byId[nezha.initial].options
    .find(option => option.id === nezha.promise).story_echo;

  assert.equal(eventEchoes(content, state)[0].text, successEcho);
  assert.equal(characterJourneys(content, state).find(item => item.id === 'RS05').status, '待回访');
});

test('failed revisit trials are distinct from completed revisits', () => {
  const jingwei = lines.find(line => line.id === 'RS02');
  const state = runState({
    act: 3,
    history: [
      entry(jingwei.initial, jingwei.promise),
      entry(jingwei.followUp, 'RK004-clear-reef', { eventOutcome: 'failure' }),
    ],
    flags: { 'RS02-promised': true },
  });
  const journey = characterJourneys(content, state).find(item => item.id === 'RS02');
  assert.equal(journey.status, '试炼失手');
  assert.ok(journey.text.includes(content.byId.RK004.options
    .find(option => option.id === 'RK004-clear-reef').story_failure_echo));
});

test('preselection and storyline metadata alone do not create a meeting', () => {
  const state = runState({
    storyline: 'RS01',
    _plannedStoryline: 'RS01',
    history: [],
  });
  assert.deepEqual(characterJourneys(content, state), []);
  assert.deepEqual(eventEchoes(content, state), []);
});

test('legacy encounter histories without an explicit result do not infer a win', () => {
  const nezha = lines.find(line => line.id === 'RS05');
  const state = runState({
    act: 2,
    history: [entry(nezha.initial, nezha.promise)],
    flags: {},
  });
  assert.deepEqual(eventEchoes(content, state), []);
  const journey = characterJourneys(content, state).find(item => item.id === 'RS05');
  assert.equal(journey.status, '初遇结果不明');
  assert.doesNotMatch(journey.text, /闯过|获胜|第二阵资格/);
});

test('a legacy revisit battle without a result stays indeterminate', () => {
  const yu = lines.find(line => line.id === 'RS04');
  const state = runState({
    act: 4,
    history: [
      entry(yu.initial, yu.promise),
      entry(yu.followUp, 'RK008-hold-dike'),
    ],
    flags: { 'RS04-promised': true },
  });
  const echoes = eventEchoes(content, state);
  assert.equal(echoes.length, 1);
  assert.equal(echoes[0].id, yu.initial);
  assert.doesNotMatch(echoes[0].text, /守住堤口|长明灯/);
  const journey = characterJourneys(content, state).find(item => item.id === 'RS04');
  assert.equal(journey.status, '回访结果不明');
  assert.match(journey.text, /回访试炼结果没有明确记录/);
});

test('stopping a revisit is not reported as completing its trial or trade', () => {
  for (const line of lines) {
    const option = content.byId[line.followUp].options.find(item =>
      !item.encounter && item.rewards.length === 0);
    const journey = lineJourney(line, line.promise, option.id);
    assert.equal(journey.status, '回访止步', line.id);
    assert.ok(journey.text.includes(option.story_echo));
  }
});

test('legacy initial trial flags do not substitute for an explicit battle result', () => {
  const line = lines.find(item => item.id === 'RS05');
  const state = runState({
    history: [entry(line.initial, line.promise)],
    flags: { 'RS05-promised': true },
  });
  assert.deepEqual(eventEchoes(content, state), []);
  assert.equal(characterJourneys(content, state)[0].status, '初遇结果不明');
});

test('ordinary event choices can use their authored echo in legacy history and respect act and limit', () => {
  const state = runState({
    history: [
      entry('RE001', 'RE001-A', { act: 1, step: 2 }),
      entry('RE015', 'RE015-C', { act: 3, step: 5 }),
      entry('RE036', 'RE036-B', { act: 4, step: 8 }),
    ],
  });
  assert.deepEqual(eventEchoes(content, state, 3, 1), [{
    id: 'RE015',
    title: content.byId.RE015.name,
    text: content.byId.RE015.options.find(option => option.id === 'RE015-C').story_echo,
  }]);
  assert.equal(eventEchoes(content, state, undefined, 2).length, 2);
  assert.deepEqual(eventEchoes(content, state, undefined, 0), []);
});

test('commitment echoes report only matching fulfilled or broken results and never mutate state', () => {
  const echo = content.byId.RE001.options.find(option => option.id === 'RE001-C').legacy_story_echo;
  const active = {
    eventId: 'RE001',
    optionId: 'RE001-C',
    originAct: 1,
    originStep: 3,
    remaining: 2,
    status: 'active',
    resultText: 'not yet',
  };
  const fulfilled = { ...active, status: 'fulfilled', resultText: '护送药箱已兑现：行医囊×2。' };
  const broken = { ...active, status: 'broken', resultText: '护送药箱失约，盘缠不退。' };

  for (const record of [active, fulfilled, broken]) {
    const state = runState({
      history: [entry('RE001', 'RE001-C', { act: 1, step: 2 })],
      eventCommitments: [record],
    });
    const before = structuredClone(state);
    const [result] = eventEchoes(content, state);
    assert.equal(result.text, record.status === 'active'
      ? echo
      : `${echo} 后来，${record.resultText}`);
    assert.deepEqual(state, before);
  }
});

test('only the originating commitment record may append its actual result text', () => {
  const state = runState({
    history: [entry('RE001', 'RE001-C', { act: 1, step: 2 })],
    eventCommitments: [{
      eventId: 'RE001',
      optionId: 'RE001-C',
      originAct: 1,
      originStep: 4,
      remaining: 0,
      status: 'fulfilled',
      resultText: 'unrelated result',
    }],
  });
  const [result] = eventEchoes(content, state);
  assert.equal(result.text, content.byId.RE001.options
    .find(option => option.id === 'RE001-C').legacy_story_echo);
});

test('both narrative readers leave the complete run state unchanged', () => {
  const state = runState({
    act: 2,
    history: [
      entry('RK009', 'RK009-enter-first-array', { eventOutcome: 'success' }),
      entry('RE001', 'RE001-C', { act: 2, step: 4 }),
    ],
    flags: { 'RS05-promised': true },
    eventCommitments: [{
      eventId: 'RE001',
      optionId: 'RE001-C',
      originAct: 2,
      originStep: 5,
      remaining: 2,
      status: 'active',
      resultText: undefined,
    }],
  });
  const before = structuredClone(state);

  eventEchoes(content, state);
  characterJourneys(content, state);

  assert.deepEqual(state, before);
});

test('a terminal run does not offer a pending revisit that can no longer happen', () => {
  const line = lines[0];
  const journey = lineJourney(line, line.promise, undefined, { phase: 'lost', act: 2 });
  assert.equal(journey.status, '未竟之约');
  assert.ok(journey.text.includes('留下'));
});
