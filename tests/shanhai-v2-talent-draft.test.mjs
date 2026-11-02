import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);
registerCombatWorker({
  calculateStats,
  simulateBattle() {
    throw new Error('Talent draft tests do not simulate battles');
  },
});

function make(seed, method = 'RKF01') {
  return ShanhaiGame.create(content, { seed, name: '选秀校验者', method });
}

function setPendingTalent(game, method, tier, advance) {
  game.state.phase = 'talent';
  game.state._returnPhase = 'map';
  game.state._talentQueue = [{ method, tier, advance }];
}

function assertDraftComposition(offered, method, tier) {
  const local = offered.filter(talent => talent.id.startsWith(`${method}-J${tier}-`));
  const shared = offered.filter(talent => talent.id.startsWith(`V2-J${tier}-`));
  assert.equal(local.length, tier === 1 ? 1 : 2);
  assert.equal(shared.length, 2);
  if (tier > 1) assert.equal(new Set(local.map(talent => talent.branch)).size, 2);
}

test('seeded drafts keep their first-tier mix, distinct later branches, reload, and reject forged candidates', () => {
  const game = make('talent-draft-stable');
  game.state.xp = content.rules.cultivation.cumulative[1];
  setPendingTalent(game, 'RKF01', 1, true);
  const first = game.availableTalents();
  assertDraftComposition(first, 'RKF01', 1);

  const sameSeed = make('talent-draft-stable');
  sameSeed.state.xp = content.rules.cultivation.cumulative[1];
  setPendingTalent(sameSeed, 'RKF01', 1, true);
  assert.deepEqual(sameSeed.availableTalents().map(talent => talent.id), first.map(talent => talent.id));

  game.dispatch({ type: 'talent', id: first[0].id });
  assert.equal(game.state.n, 1);
  assert.equal(game.state._talentQueue[0].tier, 2);
  const second = game.availableTalents();
  assertDraftComposition(second, 'RKF01', 2);

  const saved = serializeRun(game);
  const restored = new ShanhaiGame(content, parseRunSave(content, saved));
  assert.deepEqual(restored.availableTalents().map(talent => talent.id), second.map(talent => talent.id));

  const forged = JSON.parse(saved);
  const secondKey = 'RKF01:2:0';
  const offeredIds = forged.state.talentDrafts[secondKey];
  const unofferedShared = content.rules.insights.find(talent =>
    talent.tier === 2 && !offeredIds.includes(talent.id));
  assert.ok(unofferedShared);
  offeredIds[2] = unofferedShared.id;
  assert.throws(() => parseRunSave(content, JSON.stringify(forged)), /run seed/);

  game.state.talentDrafts[secondKey] = offeredIds;
  assert.throws(() => game.availableTalents(), /run seed/,
    'tampered in-memory candidates must not be exposed as a valid draft');
});

test('method swaps draw for the active method and respec generations remain deterministic through reload', () => {
  const swapped = make('talent-draft-method-swap');
  swapped.state.n = 1;
  swapped.state.xp = content.rules.cultivation.cumulative[0];
  swapped.state.ownedMethods.push('RKF02');
  swapped.state.talents.RKF02 = [];
  swapped.state.method = 'RKF02';
  setPendingTalent(swapped, 'RKF02', 1, false);
  const swappedOffers = swapped.availableTalents();
  assertDraftComposition(swappedOffers, 'RKF02', 1);
  const swappedReload = new ShanhaiGame(content, parseRunSave(content, serializeRun(swapped)));
  assert.deepEqual(swappedReload.availableTalents().map(talent => talent.id),
    swappedOffers.map(talent => talent.id));

  const game = make('talent-draft-respec');
  game.state.xp = content.rules.cultivation.cumulative[1];
  setPendingTalent(game, 'RKF01', 1, true);
  game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
  game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
  assert.equal(game.state.n, 2);

  const beforeReset = serializeRun(game);
  const sameReset = new ShanhaiGame(content, parseRunSave(content, beforeReset));
  for (const run of [game, sameReset]) {
    run.state.phase = 'shop';
    run.state.coins = 100;
    run.state._talentQueue = [];
    run.state._returnPhase = undefined;
    run.state.shop = [{ id: 'talent_reset', kind: 'talent_reset', price: 40, sold: false }];
    run.dispatch({ type: 'buy', id: 'talent_reset' });
  }

  assert.equal(game.state.talentDraftGeneration, 1);
  assertDraftComposition(game.availableTalents(), 'RKF01', 1);
  assert.deepEqual(game.state.talentDrafts['RKF01:1:1'], sameReset.state.talentDrafts['RKF01:1:1']);
  game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
  const resetTierTwo = game.availableTalents();
  assertDraftComposition(resetTierTwo, 'RKF01', 2);

  const afterReset = serializeRun(game);
  const resetReload = new ShanhaiGame(content, parseRunSave(content, afterReset));
  assert.deepEqual(resetReload.availableTalents().map(talent => talent.id),
    resetTierTwo.map(talent => talent.id));
});

test('incomplete local branch or shared insight pools fail with an explicit error', () => {
  const shortageCases = [
    {
      tier: 1,
      remove(entities) {
        const method = entities.find(entity => entity.id === 'RKF01');
        method.talents = method.talents.filter(talent => talent.tier !== 1);
      },
    },
    {
      tier: 1,
      remove(entities) {
        const rules = entities.find(entity => entity.id === 'RULES');
        rules.insights = rules.insights.filter(talent => talent.tier !== 1).slice(0, 1);
      },
    },
    {
      tier: 2,
      remove(entities) {
        const method = entities.find(entity => entity.id === 'RKF01');
        method.talents = method.talents.filter(talent => talent.tier !== 2 || talent.branch === 'A');
      },
    },
    {
      tier: 2,
      remove(entities) {
        const rules = entities.find(entity => entity.id === 'RULES');
        rules.insights = rules.insights.filter(talent => talent.tier !== 2).slice(0, 1);
      },
    },
  ];

  for (const [index, shortage] of shortageCases.entries()) {
    const entities = structuredClone(loaded.entities);
    shortage.remove(entities);
    const sparseContent = contentFromEntities(entities, loaded.manifest.content_version);
    const game = ShanhaiGame.create(sparseContent, {
      seed: `talent-draft-shortage-${index}`,
      name: '候选池校验者',
      method: 'RKF01',
    });
    game.state.n = shortage.tier - 1;
    game.state.xp = sparseContent.rules.cultivation.cumulative[shortage.tier - 1];
    setPendingTalent(game, 'RKF01', shortage.tier, true);
    assert.throws(() => game.availableTalents(),
      new RegExp(`Talent draft pool is incomplete for RKF01 tier ${shortage.tier}`));
  }
});
