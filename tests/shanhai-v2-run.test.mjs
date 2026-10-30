import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import { artifactRole, MAX_EQUIPMENT_SLOTS } from '../build/shanhai/equipment.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';

const loaded = await loadContent();
const coreIds = new Set([
  'RC09', 'RC10', 'RC11', 'RC12', 'RC14', 'RC15',
  'RL01', 'RL02', 'RL03', 'RL04', 'RL05',
]);
const entities = loaded.entities;
const byId = new Map(entities.map(entity => [entity.id, entity]));
const rules = byId.get('RULES');
const content = {
  version: loaded.manifest.content_version,
  entities,
  byId,
  rules,
};

function installCombat() {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, player) {
      return {
        outcome: 'player',
        rounds: 1,
        playerHp: player.hp ?? player.baseStats.max_hp,
        enemyHp: 0,
        frames: [],
        contributions: [],
      };
    },
  });
}

function make(seed = 'v2-run') {
  installCombat();
  return ShanhaiGame.create(content, { seed, name: '试炼者', method: 'RKF01' });
}

test('only equipped artifacts affect stats, node entry, and frozen battle inputs', () => {
  const game = make('v2-loadout');
  game.state.artifacts = [
    { id: 'RC01', stacks: 1 },
    { id: 'RC02', stacks: 1 },
  ];
  game.state.equipment = { slots: ['RC01'] };
  const emptyStats = calculateStats(game.content, { ...game.player, artifacts: [] });

  assert.deepEqual(game.equippedArtifacts(), [{ id: 'RC01', stacks: 1 }]);
  assert.deepEqual(game.player.artifacts, [{ id: 'RC01', stacks: 1 }]);
  assert.notDeepEqual(game.stats, emptyStats);

  const node = game.availableNodes()[0];
  assert.equal(node.type, 'C');
  game.dispatch({ type: 'enter', id: node.key });
  assert.deepEqual(game.state.nodeEntry.artifacts, [{ id: 'RC01', stacks: 1 }]);
  assert.equal(game.canChangeEquipment(), false);
  assert.throws(() => game.dispatch({ type: 'equip', id: 'RC02' }), /cannot change now/);
  game.dispatch({ type: 'fight' });
  assert.deepEqual(game.state.battleInput.player.artifacts, [{ id: 'RC01', stacks: 1 }]);
});

test('hunter challenge freezes an elite encounter on the current normal node and counts one victory', () => {
  const game = make('v2-hunter-challenge');
  game.state.n = 1;
  game.state.talents.RKF01 = ['V2-J1-B'];
  const node = game.availableNodes()[0];
  game.dispatch({ type: 'enter', id: node.key });
  const route = structuredClone(game.state.routeMap);
  assert.equal(game.canChallengeElite(), true);
  assert.equal(game.state.nodes.length, 1);

  game.dispatch({ type: 'challenge_elite' });
  const eliteId = game.state._challengeEliteEnemyId;
  assert.equal(byId.get(eliteId).tier, 'elite');
  assert.equal(game.canChallengeElite(), false);
  assert.equal(game.state.nodes.length, 1);
  assert.deepEqual(game.state.routeMap, route, 'challenge must not alter frozen route nodes');
  game.dispatch({ type: 'back' });
  game.dispatch({ type: 'enter', id: node.key });
  assert.equal(game.state._challengeEliteEnemyId, eliteId, 'back and re-entry must retain the selected elite');

  const saved = serializeRun(game);
  const restored = new ShanhaiGame(content, parseRunSave(content, saved));
  assert.equal(restored.canChallengeElite(), false);
  assert.equal(restored.state._challengeEliteEnemyId, eliteId);
  restored.dispatch({ type: 'fight' });
  assert.equal(restored.state.battleInput.enemy.name, byId.get(eliteId).name);
  assert.equal(restored.state.battleInput.player.journey.eliteWins, 0);
  assert.equal(restored.state.battleInput.player.journey.bossWins, 0);
  assert.equal(restored.state.battleInput.player.journey.coinsSpent, 0);
  assert.equal(restored.state.battleInput.player.journey.knownMethods, 1);
  const battleSave = serializeRun(restored);
  const battleReload = new ShanhaiGame(content, parseRunSave(content, battleSave));
  assert.deepEqual(battleReload.state.battleInput, restored.state.battleInput);
  assert.deepEqual(battleReload.state.battle, restored.state.battle);
  battleReload.dispatch({ type: 'battle_done' });
  assert.equal(battleReload.state.progress.eliteWins, 1);
  assert.equal(battleReload.state.progress.bossWins, 0);
  assert.equal(battleReload.state.nodes.length, 1);
  assert.equal(battleReload.state.phase, 'reward');
  battleReload.dispatch({ type: 'reward', id: null });
  assert.equal(battleReload.state.history.at(-1).title, byId.get(eliteId).name);
  assert.equal(battleReload.state._actEliteChallengeUsed, true);

  game.startAct(2);
  const nextActNode = game.availableNodes()[0];
  game.dispatch({ type: 'enter', id: nextActNode.key });
  assert.equal(game.canChallengeElite(), true, 'the invitation becomes available once in each act');
});

test('five equipment slots ignore roles without healing or resetting route state', () => {
  assert.equal(MAX_EQUIPMENT_SLOTS, 5);
  const game = make('v2-equipment');
  const baseMaxHp = game.stats.max_hp;
  byId.get('RC01').attributes.flat.max_hp = 100;
  game.state.hp = baseMaxHp - 30;
  game.state.artifacts = [
    { id: 'RC01', stacks: 1 },
    { id: 'RC02', stacks: 1 },
    { id: 'RC03', stacks: 1 },
    { id: 'RC04', stacks: 1 },
    { id: 'RC05', stacks: 1 },
    { id: 'RC09', stacks: 1 },
    { id: 'RC10', stacks: 1 },
  ];
  const seed = game.state.seed;
  const path = structuredClone(game.state.routeMap.path);

  game.dispatch({ type: 'equip', id: 'RC01' });
  assert.equal(game.state.hp, baseMaxHp - 30, 'increased maximum HP does not heal');
  assert.equal(game.stats.max_hp, baseMaxHp + 100);
  game.state.hp = game.stats.max_hp;
  game.dispatch({ type: 'unequip', id: 'RC01' });
  assert.equal(game.state.hp, baseMaxHp, 'lower maximum HP clamps current HP');
  game.dispatch({ type: 'equip', id: 'RC01' });
  game.dispatch({ type: 'equip', id: 'RC02' });
  game.dispatch({ type: 'equip', id: 'RC03' });
  game.dispatch({ type: 'equip', id: 'RC04' });
  game.dispatch({ type: 'equip', id: 'RC05' });
  assert.equal(game.state.equipment.slots.length, MAX_EQUIPMENT_SLOTS);
  assert.throws(() => game.dispatch({ type: 'equip', id: 'RC09' }), /Equipment slots are full/);
  game.dispatch({ type: 'equip', id: 'RC09', replace: 'RC02' });
  assert.deepEqual(game.state.equipment.slots, ['RC01', 'RC09', 'RC03', 'RC04', 'RC05']);
  game.dispatch({ type: 'equip', id: 'RC10', replace: 'RC01' });
  assert.deepEqual(game.state.equipment.slots, ['RC10', 'RC09', 'RC03', 'RC04', 'RC05']);
  assert.equal(game.state.seed, seed);
  assert.deepEqual(game.state.routeMap.path, path);

  game.state.phase = 'preview';
  const before = structuredClone(game.state);
  assert.throws(() => game.dispatch({ type: 'unequip', id: 'RC03' }), /cannot change now/);
  assert.deepEqual(game.state, before, 'illegal equipment changes are atomic');

  for (const phase of ['map', 'reward', 'shop', 'rest', 'transition']) {
    game.state.phase = phase;
    assert.equal(game.canChangeEquipment(), true);
    if (!game.state.equipment.slots.includes('RC03')) {
      game.dispatch({ type: 'equip', id: 'RC03' });
    }
    game.dispatch({ type: 'unequip', id: 'RC03' });
    game.dispatch({ type: 'equip', id: 'RC03' });
  }
  for (const phase of ['preview', 'battle', 'event', 'event_result', 'talent', 'won', 'lost']) {
    game.state.phase = phase;
    assert.equal(game.canChangeEquipment(), false);
    assert.throws(() => game.dispatch({ type: 'unequip', id: 'RC04' }), /cannot change now/);
  }
});

test('artifact roles are required content data and do not fall back by artifact ID', () => {
  const rolelessEntities = entities.map(entity => {
    if (entity.id !== 'RC01') return entity;
    const { equipment_role: _role, ...artifact } = entity;
    return artifact;
  });
  const rolelessContent = {
    ...content,
    entities: rolelessEntities,
    byId: new Map(rolelessEntities.map(entity => [entity.id, entity])),
  };

  assert.equal(artifactRole(rolelessContent, 'RC01'), undefined);
});

test('enemy loadouts allow five artifact roles and reject a sixth generic slot', () => {
  const game = make('v2-generic-enemy-slots');
  assert.equal(MAX_EQUIPMENT_SLOTS, 5);
  game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
  game.dispatch({ type: 'fight' });
  game.state.battleInput.enemy.artifacts = [
    { id: 'RC09', stacks: 1 },
    { id: 'RC10', stacks: 1 },
    { id: 'RC01', stacks: 1 },
    { id: 'RC02', stacks: 1 },
    { id: 'RC11', stacks: 1 },
  ];

  assert.doesNotThrow(() => serializeRun(game));
  game.state.battleInput.enemy.artifacts.push({ id: 'RC03', stacks: 1 });
  assert.throws(() => serializeRun(game), /enemy equipment slots/i);
  game.state.battleInput.enemy.artifacts.pop();
});

test('acquisition auto-fills empty compatible slots and the first ordinary reward replaces its normal pool', () => {
  const acquired = make('v2-auto-equip');
  acquired.state.phase = 'shop';
  acquired.state.shop = [
    { id: 'RC01', kind: 'artifact', price: 0, sold: false },
    { id: 'RC02', kind: 'artifact', price: 0, sold: false },
    { id: 'RC03', kind: 'artifact', price: 0, sold: false },
    { id: 'RC04', kind: 'artifact', price: 0, sold: false },
    { id: 'RC05', kind: 'artifact', price: 0, sold: false },
    { id: 'RC09', kind: 'artifact', price: 0, sold: false },
  ];
  acquired.dispatch({ type: 'buy', id: 'RC01' });
  acquired.dispatch({ type: 'buy', id: 'RC02' });
  acquired.dispatch({ type: 'buy', id: 'RC03' });
  acquired.dispatch({ type: 'buy', id: 'RC04' });
  acquired.dispatch({ type: 'buy', id: 'RC05' });
  acquired.dispatch({ type: 'buy', id: 'RC09' });
  assert.deepEqual(acquired.state.equipment,
    { slots: ['RC01', 'RC02', 'RC03', 'RC04', 'RC05'] });
  assert.ok(acquired.state.artifacts.some(stack => stack.id === 'RC04'));
  assert.equal(acquired.equippedArtifacts().some(stack => stack.id === 'RC04'), true);
  assert.ok(acquired.state.artifacts.some(stack => stack.id === 'RC09'),
    'the sixth acquired artifact must remain owned');
  assert.equal(acquired.equippedArtifacts().some(stack => stack.id === 'RC09'), false,
    'the sixth acquired artifact must stay unequipped when all five slots are filled');

  const mixed = make('v2-auto-equip-core');
  mixed.state.phase = 'shop';
  mixed.state.artifacts = [
    { id: 'RC01', stacks: 1 },
    { id: 'RC02', stacks: 1 },
    { id: 'RC03', stacks: 1 },
    { id: 'RC04', stacks: 1 },
  ];
  mixed.state.equipment = { slots: ['RC01', 'RC02', 'RC03', 'RC04'] };
  mixed.state.shop = [{ id: 'RC09', kind: 'artifact', price: 0, sold: false }];
  mixed.dispatch({ type: 'buy', id: 'RC09' });
  assert.deepEqual(mixed.state.equipment.slots, ['RC01', 'RC02', 'RC03', 'RC04', 'RC09'],
    'an acquisition must auto-equip into the fifth empty slot');

  const game = make('v2-first-core-reward');
  const node = game.availableNodes()[0];
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'reward');
  assert.equal(game.state.rewardCandidates.length, 3);
  assert.ok(game.state.rewardCandidates.every(id =>
    coreIds.has(id) && byId.get(id).rarity === 'common'));
  const selected = game.state.rewardCandidates[0];
  game.dispatch({ type: 'reward', id: selected });
  assert.deepEqual(game.state.equipment.slots, [selected]);
  assert.equal(game.state._coreRewardOffered, true);
  assert.equal(game.state.nodes.length, 1, 'core choice replaces the ordinary reward, not a route node');
});

test('ownership conditions still see held but unequipped artifacts', () => {
  const game = make('v2-owned-condition');
  game.state.act = 2;
  game.state.phase = 'event';
  game.state.nodes = [{ type: 'K', id: 'RK005', completed: false }];
  game.state.artifacts = [{ id: 'RC07', stacks: 1 }];
  game.state.equipment = { slots: [] };
  const option = byId.get('RK005').options.find(candidate => candidate.id === 'RK005-carry-sight');

  assert.equal(game.optionAvailability(option).available, true);
  game.state.artifacts = [];
  assert.equal(game.optionAvailability(option).available, false);
});

test('event artifact chance bonuses require an equipped artifact', () => {
  const option = byId.get('RE001').options.find(candidate => candidate.id === 'RE001-C');
  const resolve = (equipped) => {
    const game = make(`v2-event-chance-${equipped}`);
    game.state.act = 1;
    game.state.phase = 'event';
    game.state.nodes = [{ type: 'E', id: 'RE001', completed: false }];
    game.state.artifacts = [{ id: 'RC08', stacks: 1 }];
    game.state.equipment = { slots: equipped ? ['RC08'] : [] };
    game.state.coins = 1000;
    game.dispatch({ type: 'event', id: option.id });
    return game.state.eventCheck.chance;
  };

  assert.equal(resolve(false), 0.4);
  assert.equal(resolve(true), 0.5);
});

test('reforging synchronizes equipment after consuming a held stack', () => {
  const game = make('v2-reforge-equipment');
  game.state.phase = 'shop';
  game.state.coins = 1000;
  game.state.artifacts = [{ id: 'RC01', stacks: 1 }];
  game.state.equipment = { slots: ['RC01'] };
  game.state._shopReforged = false;
  const target = game.reforgeOptions('RC01')[0];

  game.dispatch({ type: 'reforge', source: 'RC01', target });
  assert.equal(game.state.artifacts.some(stack => stack.id === 'RC01'), false);
  assert.equal(game.equippedArtifacts().some(stack => stack.id === 'RC01'), false);
  assert.ok(game.state.artifacts.some(stack => stack.id === target));
  assert.ok(game.equippedArtifacts().some(stack => stack.id === target));
});

test('travel artifact effects require entry equipment that remains owned and equipped', () => {
  const game = make('v2-travel-equipment');
  game.state.coins = 0;
  const entry = {
    method: 'RKF01',
    talents: [],
    artifacts: [{ id: 'RC16', stacks: 1 }],
  };
  const node = { type: 'S', id: 'SHOP', completed: true };
  game.state.artifacts = [
    { id: 'RC16', stacks: 2 },
    { id: 'RC18', stacks: 1 },
  ];
  game.state.equipment = { slots: ['RC16'] };

  game.state.equipment.slots.push('RC18');
  game.applyTravel(node, entry);
  assert.equal(game.state.xp, 1, 'post-entry RC16 stacks do not increase travel rewards');
  assert.equal(game.state.coins, 0, 'post-entry equipment does not add travel rewards');

  game.state.xp = 0;
  game.state.coins = 0;
  game.state.phase = 'map';
  game.dispatch({ type: 'unequip', id: 'RC16' });
  game.applyTravel(node, entry);
  assert.equal(game.state.xp, 0, 'unequipped entry artifacts stop granting travel rewards');

  game.state.xp = 0;
  game.state.coins = 0;
  game.state.phase = 'shop';
  game.state.artifacts = [
    { id: 'RC16', stacks: 1 },
    { id: 'RC18', stacks: 1 },
  ];
  game.state.equipment = { slots: ['RC16'] };
  game.state._shopReforged = false;
  game.state.coins = 1000;
  const target = game.reforgeOptions('RC16')[0];
  game.dispatch({ type: 'reforge', source: 'RC16', target });
  game.state.xp = 0;
  game.state.coins = 0;
  game.applyTravel(node, entry);
  assert.equal(game.state.xp, 0, 'reforging cannot resurrect the sacrificed entry artifact');
});

test('first breakthrough freezes three shared choices, later tiers offer one local and two shared', () => {
  const game = make('v2-frozen-draft');
  game.state.xp = 120;
  game.state.phase = 'talent';
  game.state._talentQueue = [{ method: 'RKF01', tier: 1, advance: true }];
  const initial = game.availableTalents();
  const key = 'RKF01:1:0';
  const offeredIds = game.state.talentDrafts[key];
  assert.equal(content.rules.insights.filter(talent => talent.tier === 1).length, 7);
  assert.equal(offeredIds.length, 3);
  assert.ok(initial.every(talent => talent.id.startsWith('V2-J1-')));
  assert.equal(new Set(offeredIds).size, 3);
  const stable = structuredClone(offeredIds);

  game.availableTalents();
  assert.deepEqual(game.state.talentDrafts[key], stable);
  assert.equal(game.state.talentDraftGeneration, 0);
  const unoffered = byId.get('RKF01').talents.find(talent =>
    talent.tier === 1 && !offeredIds.includes(talent.id));
  assert.ok(unoffered);
  assert.throws(() => game.dispatch({ type: 'talent', id: unoffered.id }), /not offered/);
  const shared = initial.find(talent => talent.id.startsWith('V2-J1-'));
  game.dispatch({ type: 'talent', id: shared.id });
  assert.deepEqual(game.state.talents.RKF01, [shared.id]);
  assert.equal(game.state.talentDraftGeneration, 0);

  game.state.xp = 600;
  game.state.phase = 'talent';
  game.state._talentQueue = [{ method: 'RKF01', tier: 2, advance: true }];
  const secondTier = game.availableTalents();
  assert.equal(secondTier.filter(talent => talent.id.startsWith('RKF01-J2-')).length, 1);
  assert.equal(secondTier.filter(talent => talent.id.startsWith('V2-J2-')).length, 2);
  const secondTierDraft = structuredClone(game.state.talentDrafts['RKF01:2:0']);
  game.availableTalents();
  assert.deepEqual(game.state.talentDrafts['RKF01:2:0'], secondTierDraft);

  game.state.phase = 'shop';
  game.state.coins = 100;
  game.state._talentQueue = [];
  game.state._returnPhase = undefined;
  game.state.shop = [{ id: 'talent_reset', kind: 'talent_reset', price: 40, sold: false }];
  game.state._talentQueue = [];
  game.state._returnPhase = undefined;
  game.dispatch({ type: 'buy', id: 'talent_reset' });
  assert.equal(game.state.talentDraftGeneration, 1);
  assert.ok(game.state.talentDrafts['RKF01:1:1']);
  assert.deepEqual(game.state.talentDrafts[key], stable, 'previous generations remain frozen');
  assert.equal(game.availableTalents().length, 3);
});
