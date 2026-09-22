import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { loadWinningBuilds, parseRunSave, saveWinningBuild, serializeRun } from '../build/shanhai/persistence.js';
import { nextCommand } from './shanhai-policy.mjs';

const model = await loadContent();
const content = contentFromEntities(model.entities, model.manifest.content_version);

function atRest(method = 'RKF01') {
  const game = ShanhaiGame.create(content, { seed: 'travel-contract', name: '旅行测试', method: 'RKF01' });
  game.state.ownedMethods = [...new Set(['RKF01', method])];
  game.state.method = method;
  game.state.talents[method] = [];
  game.dispatch({ type: 'route', id: 'steady' });
  const step = game.state.nodes.findIndex(node => node.type === 'R');
  game.state.nodes.slice(0, step).forEach(node => { node.completed = true; });
  game.state.step = step;
  game.state.hp = 100;
  game.dispatch({ type: 'enter' });
  return game;
}

test('all ten methods complete a travel node using their authored effects', () => {
  for (const method of content.entities.filter(entity => entity.kind === 'method')) {
    const game = atRest(method.id);
    game.dispatch({ type: 'rest', choice: 'heal' });
    assert.ok(game.state.hp <= game.stats.max_hp && game.state.hp > 0, method.id);
    assert.doesNotThrow(() => parseRunSave(content, serializeRun(game)), method.id);
  }
});

test('RKF10 travel alternates healing and XP without consulting its combat phase', () => {
  const game = atRest('RKF10');
  game.dispatch({ type: 'rest', choice: 'heal' });
  assert.equal(game.state.hp, 100 + 625 * 0.25 + 500 * 0.08);
  assert.equal(game.state.xp, 0);
  game.state.nodes[game.state.step] = { type: 'R', id: 'R-TEST-SECOND', completed: false };
  game.dispatch({ type: 'enter' });
  const hp = game.state.hp;
  game.dispatch({ type: 'rest', choice: 'preparation' });
  assert.equal(game.state.hp, hp);
  assert.equal(game.state.xp, 9);
});

test('real combat replays are saved as inputs and rebuilt exactly on reload', () => {
  const game = ShanhaiGame.create(content, { seed: 'compact-save', name: '存档测试', method: 'RKF01' });
  game.dispatch({ type: 'route', id: 'steady' });
  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'fight' });
  const replay = structuredClone(game.state.battle);
  const save = serializeRun(game);
  const record = JSON.parse(save);
  assert.equal(record.replay, 'deterministic-input-v1');
  assert.equal(record.state.battle.frames.length, 0);
  assert.ok(save.length < 100000);
  assert.deepEqual(parseRunSave(content, save).battle, replay);
});

test('ordinary event results advance exactly one node with real state and travel', () => {
  const game = ShanhaiGame.create(content, { seed: 'event-flow', name: '行者', method: 'RKF02' });
  game.dispatch({ type: 'route', id: 'steady' });
  game.state.step = 1;
  game.state.nodes[0].completed = true;
  game.dispatch({ type: 'enter' });
  const event = content.byId[game.node.id];
  const option = event.options.findLast(item => !item.encounter && game.optionAvailability(item).available);
  assert.ok(option);
  game.dispatch({ type: 'event', id: option.id });
  assert.equal(game.state.phase, 'event_result');
  const oldStep = game.state.step;
  game.dispatch({ type: 'continue' });
  assert.equal(game.state.step, oldStep + 1);
  assert.throws(() => game.dispatch({ type: 'continue' }));
});

test('a real 45-node journey survives every save boundary and archives once', () => {
  let game = ShanhaiGame.create(content, { seed: 'acceptance-0', name: '贯通测试', method: 'RKF01' });
  let commands = 0;
  let crossedFinalEntry = false;
  while (!['won', 'lost'].includes(game.state.phase) && commands++ < 600) {
    const finalEntry = game.state.act === 4 && game.state.phase === 'transition';
    const before = structuredClone(game.state);
    game.dispatch(nextCommand(game, 'steady'));
    const expected = JSON.parse(JSON.stringify(game.state));
    game = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
    assert.deepEqual(JSON.parse(JSON.stringify(game.state)), expected);
    if (finalEntry) {
      crossedFinalEntry = true;
      assert.equal(game.state.act, 5);
      assert.equal(game.state.phase, 'map');
      assert.deepEqual(game.state.routes, ['steady', 'steady', 'steady', 'steady', 'final']);
      assert.deepEqual(game.state._routeHistory, game.state.routes);
      assert.equal(game.state._routeId, 'final');
      assert.equal(game.state.nodes.length, 1);
      assert.equal(game.state.nodes[0].type, 'F');
      for (const resource of ['hp', 'xp', 'coins', 'preparation']) {
        assert.equal(game.state[resource], before[resource], resource);
      }
      assert.deepEqual(game.state.artifacts, before.artifacts);
    }
  }
  assert.ok(commands < 600);
  assert.equal(crossedFinalEntry, true);
  assert.equal(game.state.phase, 'won');
  assert.equal(game.state.history.length, 45);
  assert.equal(game.state.history.filter(entry => entry.act === 5).length, 1);
  const records = new Map();
  const storage = {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key),
  };
  saveWinningBuild(game, storage);
  saveWinningBuild(game, storage);
  const builds = loadWinningBuilds(storage);
  assert.equal(builds.length, 1);
  assert.equal(builds[0].runId, game.state.id);
  assert.deepEqual(builds[0].artifacts, game.state.artifacts);
  assert.deepEqual(builds[0].talents, game.state.talents[game.state.method]);
});
