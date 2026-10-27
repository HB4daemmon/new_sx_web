import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats } from '../build/shanhai/combat.js';
import {
  ShanhaiGame,
  registerCombatWorker,
  validateRunState,
} from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';

const loaded = await loadContent();
const entities = loaded.entities;
const byId = new Map(entities.map(entity => [entity.id, entity]));
const content = {
  version: loaded.manifest.content_version,
  entities,
  byId,
  rules: byId.get('RULES'),
};
const combatTypes = new Set(['C', 'L', 'B', 'F']);

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

function make(seed, sourceContent = content) {
  installCombat();
  return ShanhaiGame.create(sourceContent, { seed, name: '遭遇路线测试', method: 'RKF01' });
}

function assertNoAdjacentCombatDuplicates(routeMap) {
  const byKey = new Map(routeMap.nodes.map(node => [node.key, node]));
  for (const parent of routeMap.nodes) {
    if (!combatTypes.has(parent.type)) continue;
    for (const key of parent.next) {
      const child = byKey.get(key);
      if (child && combatTypes.has(child.type)) {
        assert.notEqual(child.id, parent.id, `${parent.key} -> ${child.key}`);
      }
    }
  }
}

test('frozen route generation avoids repeated direct-parent combat enemies across acts', () => {
  for (const act of [1, 2, 3, 4]) {
    for (let index = 0; index < 128; index++) {
      const game = make(`v2-direct-parent-variety-${act}-${index}`);
      if (act > 1) {
        game.state._coreRewardOffered = true;
        game.startAct(act);
      }
      assertNoAdjacentCombatDuplicates(game.state.routeMap);
    }
  }
});

test('enter, back, and load retain the same already-frozen enemy map', () => {
  const game = make('v2-frozen-enemy-map');
  const originalMap = structuredClone(game.state.routeMap);
  const first = game.availableNodes()[0];
  assert.equal(first.type, 'C');

  game.dispatch({ type: 'enter', id: first.key });
  assert.equal(game.node.id, originalMap.nodes.find(node => node.key === first.key).id);
  originalMap.path.push(first.key);
  game.dispatch({ type: 'back' });
  assert.deepEqual(game.state.routeMap, originalMap);

  const resumed = game.availableNodes()[0];
  assert.equal(resumed.id, first.id);
  game.dispatch({ type: 'enter', id: resumed.key });
  game.dispatch({ type: 'back' });
  assert.deepEqual(game.state.routeMap, originalMap);

  const restored = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
  assert.deepEqual(restored.state.routeMap, originalMap);
  assert.equal(restored.availableNodes()[0].id, first.id);
});

test('trial enemy identities are explicit on enemy loadouts and rejected on player loadouts', () => {
  assert.deepEqual(byId.get('EN-A1-B1').trial, {
    kind: 'tidal_charge',
    period: 3,
    charges: 3,
    attack_ratio_per_charge: 0.45,
  });
  assert.deepEqual(byId.get('EN-A1-B2').trial, {
    kind: 'reviving_mist',
    period: 3,
    charges: 3,
    heal_hp_ratio_per_charge: 0.045,
  });

  const commonId = byId.get('RA01').pools.enemies.common_candidates[0];
  const trialEnemy = { ...byId.get(commonId), trial: { kind: 'identity_fixture' } };
  const trialEntities = entities.map(entity => entity.id === commonId ? trialEnemy : entity);
  const trialById = new Map(trialEntities.map(entity => [entity.id, entity]));
  const trialContent = { ...content, entities: trialEntities, byId: trialById };
  const game = make('v2-explicit-trial-identity', trialContent);
  const first = game.state.routeMap.nodes.find(node => node.depth === 0);
  first.id = commonId;

  game.dispatch({ type: 'enter', id: first.key });
  game.dispatch({ type: 'fight' });
  assert.equal(game.state.battleInput.enemy.encounterId, commonId);
  assert.equal(game.state.battleInput.player.encounterId, undefined);
  assert.doesNotThrow(() => validateRunState(trialContent, game.state));

  const noReference = structuredClone(game.state);
  delete noReference.battleInput.enemy.encounterId;
  assert.throws(() => validateRunState(trialContent, noReference), /selected encounter/);

  const guessedOnPlayer = structuredClone(game.state);
  guessedOnPlayer.battleInput.player.encounterId = commonId;
  assert.throws(() => validateRunState(trialContent, guessedOnPlayer), /encounter reference/);

  const restored = new ShanhaiGame(
    trialContent,
    parseRunSave(trialContent, serializeRun(game)),
  );
  assert.equal(restored.state.battleInput.enemy.encounterId, commonId);
});
