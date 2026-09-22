import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import {
  ShanhaiGame,
  registerCombatWorker,
} from '../build/shanhai/run.js';
import {
  SHANHAI_SAVE_KEY,
  loadRun,
  loadWinningBuilds,
  saveRun,
  saveWinningBuild,
  serializeRun,
} from '../build/shanhai/persistence.js';

const loaded = await loadContent();
const content = {
  version: loaded.manifest.content_version,
  entities: loaded.entities,
  byId: loaded.byId,
  rules: loaded.entities.find(entity => entity.id === 'RULES'),
};

function storage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

function installCombat({ outcome = 'player', drawUntil = 0, playerHp = null, onBattle, onStats } = {}) {
  registerCombatWorker({
    calculateStats(_content, loadout) {
      onStats?.(structuredClone(loadout));
      return structuredClone(loadout.baseStats);
    },
    simulateBattle(_content, player, enemy, seed, options = {}) {
      onBattle?.({ player: structuredClone(player), enemy: structuredClone(enemy), seed, options: structuredClone(options) });
      const drawn = options.roundLimit < drawUntil;
      const result = drawn ? 'draw' : outcome;
      return {
        outcome: result,
        rounds: options.roundLimit,
        playerHp: result === 'enemy' ? (playerHp ?? 0) : (playerHp ?? player.hp ?? 500),
        enemyHp: result === 'player' ? 0 : 100,
        frames: [],
        contributions: [],
        reason: drawn ? 'round_limit' : undefined,
      };
    },
  });
}

function make(seed = 'run-test') {
  return ShanhaiGame.create(content, { seed, name: '测试者', method: 'RKF01' });
}

function enterFirstBattle(game) {
  game.dispatch({ type: 'route', id: 'steady' });
  while (game.node?.type !== 'C') {
    game.dispatch({ type: 'enter' });
    if (game.state.phase === 'event') {
      const event = content.byId.get(game.node.id);
      const option = event.options.find(candidate => game.optionAvailability(candidate).available);
      game.dispatch({ type: 'event', id: option.id });
      if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    } else if (game.state.phase === 'shop') {
      game.dispatch({ type: 'leave_shop' });
    } else if (game.state.phase === 'rest') {
      if (game.state._restFromEvent) {
        const method = game.state.ownedMethods.find(id => id !== game.state.method);
        if (method) game.dispatch({ type: 'rest', choice: 'swap_method', method });
        else throw new Error('event offered a swap without another method');
      } else {
        game.dispatch({ type: 'rest', choice: 'heal' });
      }
    }
  }
  game.dispatch({ type: 'enter' });
}

function runToTerminal(game) {
  while (!['won', 'lost'].includes(game.state.phase)) {
    if (game.state.phase === 'route') {
      game.dispatch({ type: 'route', id: game.availableRoutes()[0].id });
    } else if (game.state.phase === 'map') {
      game.dispatch({ type: 'enter' });
    } else if (game.state.phase === 'preview') {
      game.dispatch({ type: 'fight' });
    } else if (game.state.phase === 'battle') {
      if (game.state.battle.outcome === 'draw') game.dispatch({ type: 'continue_battle' });
      else game.dispatch({ type: 'battle_done' });
    } else if (game.state.phase === 'reward') {
      game.dispatch({ type: 'reward', id: null });
    } else if (game.state.phase === 'event') {
      const event = content.byId.get(game.node.id);
      const option = event.options.find(candidate => game.optionAvailability(candidate).available);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') {
      game.dispatch({ type: 'continue' });
    } else if (game.state.phase === 'shop') {
      game.dispatch({ type: 'leave_shop' });
    } else if (game.state.phase === 'rest') {
      game.dispatch({ type: 'rest', choice: 'heal' });
    } else if (game.state.phase === 'talent') {
      game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
    } else if (game.state.phase === 'transition') {
      game.dispatch({ type: 'continue' });
    } else {
      throw new Error(`Unhandled phase ${game.state.phase}`);
    }
  }
}

test('route generation is deterministic and uses frozen pool draws', () => {
  installCombat();
  const a = make('same-seed');
  const b = make('same-seed');
  a.dispatch({ type: 'route', id: 'steady' });
  b.dispatch({ type: 'route', id: 'steady' });
  assert.deepEqual(a.state.nodes, b.state.nodes);
  assert.equal(a.state.nodes.length, 11);
  assert.equal(a.state.nodes.some(node => node.type === 'C' && node.id !== 'EN-A1-C1'), true);
  assert.equal(a.state.ordinaryCount, a.state.nodes.filter(node => node.type === 'C' || node.type === 'E').length);
});

test('save/reload keeps frozen map and does not touch the legacy key', () => {
  installCombat();
  const game = make('save-seed');
  game.dispatch({ type: 'route', id: 'steady' });
  game.dispatch({ type: 'enter' });
  const before = structuredClone(game.state);
  const store = storage();
  saveRun(game, store);
  assert.ok(store.getItem(SHANHAI_SAVE_KEY));
  const loadedGame = loadRun(content, store);
  assert.deepEqual(loadedGame.state.nodes, before.nodes);
  assert.equal(loadedGame.state.phase, before.phase);
  assert.equal(store.getItem('fengshen-run'), null);
});

test('every major dispatch boundary survives serialize and reload', () => {
  installCombat();
  let game = make('boundary-seed');
  const store = storage();
  const reload = () => {
    saveRun(game, store);
    game = loadRun(content, store);
  };

  game.dispatch({ type: 'route', id: 'steady' });
  reload();
  assert.equal(game.state.phase, 'map');
  game.dispatch({ type: 'enter' });
  reload();
  assert.equal(game.state.phase, 'preview');
  game.dispatch({ type: 'fight' });
  reload();
  assert.equal(game.state.phase, 'battle');
  game.dispatch({ type: 'battle_done' });
  reload();
  assert.equal(game.state.phase, 'reward');
  game.dispatch({ type: 'reward', id: null });
  reload();
  assert.equal(game.state.phase, 'map');
});

test('shop inventory and node entry snapshot remain frozen across back and re-entry', () => {
  installCombat();
  const game = make('shop-freeze-seed');
  game.dispatch({ type: 'route', id: 'steady' });
  const shopIndex = game.state.nodes.findIndex(node => node.type === 'S');
  assert.notEqual(shopIndex, -1);
  game.state.step = shopIndex;
  game.state.coins = 100;
  game.dispatch({ type: 'enter' });
  assert.equal(game.state.phase, 'shop');
  const beforeEntry = structuredClone(game.state.nodeEntry);
  const service = game.state.shop.find(item => item.kind === 'recovery');
  assert.ok(service);
  game.dispatch({ type: 'buy', id: service.id });
  assert.equal(game.state.shop.find(item => item.id === service.id)?.sold, true);
  game.dispatch({ type: 'back' });
  assert.equal(game.state.phase, 'map');
  assert.deepEqual(game.state.nodeEntry, beforeEntry);
  game.dispatch({ type: 'enter' });
  assert.equal(game.state.phase, 'shop');
  assert.equal(game.state.shop.find(item => item.id === service.id)?.sold, true);
  assert.deepEqual(game.state.nodeEntry, beforeEntry);
});

test('invalid event options and costs are atomic', () => {
  installCombat();
  const game = make('event-atomic');
  game.dispatch({ type: 'route', id: 'steady' });
  const eventIndex = game.state.nodes.findIndex(node => node.type === 'E');
  game.state.step = eventIndex;
  game.dispatch({ type: 'enter' });
  const event = content.byId.get(game.node.id);
  const paid = event.options.find(option => option.costs?.length);
  assert.ok(paid, `expected ${event.id} to expose a paid option`);
  const before = structuredClone(game.state);
  game.state.coins = 0;
  game.state.hp = 0;
  game.state.xp = 0;
  assert.throws(() => game.dispatch({ type: 'event', id: paid.id }));
  assert.equal(game.state.phase, before.phase);
  assert.equal(game.state.eventOption, before.eventOption);
  assert.equal(game.state.coins, 0);
});

test('draw continuation reuses the same input and seed without charging twice', () => {
  installCombat({ drawUntil: 400 });
  const game = make('draw-seed');
  enterFirstBattle(game);
  game.dispatch({ type: 'fight' });
  assert.equal(game.state.battle.outcome, 'draw');
  const input = structuredClone(game.state.battleInput);
  const coins = game.state.coins;
  game.dispatch({ type: 'continue_battle' });
  assert.equal(game.state.battleInput.seed, input.seed);
  assert.equal(game.state.battleInput.player.hp, input.player.hp);
  assert.equal(game.state.coins, coins);
  assert.equal(game.state.battleInput.roundLimit, 512);
  assert.equal(game.state.battle.outcome, 'player');
});

test('non-lethal encounter loss floors HP and grants no event reward', () => {
  installCombat({ outcome: 'enemy', playerHp: 0 });
  const game = make('nonlethal-seed');
  game.dispatch({ type: 'route', id: 'steady' });
  const index = game.state.nodes.findIndex(node => {
    if (node.type !== 'E') return false;
    const event = content.byId.get(node.id);
    return event.options?.some(option => option.encounter);
  });
  assert.notEqual(index, -1);
  game.state.step = index;
  game.dispatch({ type: 'enter' });
  const event = content.byId.get(game.node.id);
  const option = event.options.find(candidate =>
    candidate.encounter && game.optionAvailability(candidate).available);
  assert.ok(option, `expected ${event.id} to expose an available encounter option`);
  const artifacts = structuredClone(game.state.artifacts);
  game.dispatch({ type: 'event', id: option.id });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'event_result');
  assert.equal(game.state.hp, 1);
  assert.deepEqual(game.state.artifacts, artifacts);
  game.dispatch({ type: 'continue' });
  assert.equal(game.state.phase, 'map');
});

test('battle input keeps enemy HP initialization with the combat worker', () => {
  let seen;
  installCombat({
    onBattle(value) {
      seen = value;
    },
  });
  const game = make('enemy-hp-seed');
  enterFirstBattle(game);
  game.dispatch({ type: 'fight' });
  assert.ok(seen);
  assert.equal(seen.enemy.hp, undefined);
  assert.ok(seen.enemy.baseStats.max_hp > 0);
  assert.equal(game.state.battleInput.enemy.hp, undefined);
});

test('draw continuation doubles the horizon through 4096 and requires explicit retirement', () => {
  installCombat({ drawUntil: 5000 });
  const game = make('long-draw-seed');
  enterFirstBattle(game);
  game.dispatch({ type: 'fight' });
  for (const horizon of [256, 512, 1024, 2048, 4096]) {
    assert.equal(game.state.battle.outcome, 'draw');
    assert.equal(game.state.battleInput.roundLimit, horizon);
    if (horizon < 4096) game.dispatch({ type: 'continue_battle' });
  }
  assert.throws(() => game.dispatch({ type: 'continue_battle' }), /4096/);
  assert.equal(game.state.phase, 'battle');
  assert.equal(game.state.battleInput.roundLimit, 4096);
});

test('RKF05 prepares first strike on nodes 2 and 4, preserves it across a method swap, and consumes it once', () => {
  const battles = [];
  installCombat({
    onBattle(value) {
      battles.push(value);
    },
  });
  const game = make('first-strike-seed');
  game.state.ownedMethods.push('RKF05');
  game.state.talents.RKF05 = [];
  game.state.method = 'RKF05';
  game.state.nodes = [
    { type: 'R', id: 'R-1', completed: false },
    { type: 'R', id: 'R-2', completed: false },
    { type: 'C', id: 'EN-A1-C1', completed: false },
    { type: 'R', id: 'R-3', completed: false },
    { type: 'R', id: 'R-4', completed: false },
    { type: 'C', id: 'EN-A1-C2', completed: false },
  ];
  game.state.step = 0;
  game.state.phase = 'map';

  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'rest', choice: 'heal' });
  assert.equal(game.state.firstStrike, 0);
  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'rest', choice: 'heal' });
  assert.ok(game.state.firstStrike > 0);

  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'fight' });
  assert.ok(battles[0].player.firstStrike > 0);
  assert.equal(game.state.firstStrike, 0);
  game.dispatch({ type: 'battle_done' });
  game.dispatch({ type: 'reward', id: null });

  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'rest', choice: 'heal' });
  assert.ok(game.state.firstStrike > 0);
  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'rest', choice: 'swap_method', method: 'RKF01' });
  assert.ok(game.state.firstStrike > 0);
  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'fight' });
  assert.ok(battles[1].player.firstStrike > 0);
  assert.equal(game.state.firstStrike, 0);
});

test('preparation rewards and rest preparation are additive', () => {
  installCombat();
  const game = make('preparation-seed');
  game.state.nodes = [
    { type: 'R', id: 'R-1', completed: false },
    { type: 'R', id: 'R-2', completed: false },
  ];
  game.state.step = 0;
  game.state.phase = 'map';
  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'rest', choice: 'preparation' });
  const first = game.state.preparation;
  assert.ok(first > 0);
  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'rest', choice: 'preparation' });
  assert.ok(game.state.preparation > first);
});

test('travel artifacts use their authored stack and max-hp parameters', () => {
  installCombat({ playerHp: 100 });
  const game = make('travel-artifacts-seed');
  game.state.artifacts = [
    { id: 'RC16', stacks: 2 },
    { id: 'RC17', stacks: 1 },
    { id: 'RC18', stacks: 3 },
    { id: 'RR06', stacks: 1 },
  ];
  game.state.hp = 100;
  game.state.xp = 0;
  game.state.coins = 0;
  game.state.nodes = [
    { type: 'R', id: 'R-1', completed: false },
    { type: 'C', id: 'EN-A1-C1', completed: false },
  ];
  game.state.step = 0;
  game.state.phase = 'map';
  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'rest', choice: 'preparation' });
  assert.equal(game.state.xp, 26);
  assert.equal(game.state.coins, 6);
  assert.equal(game.state.hp, 102);
  game.dispatch({ type: 'enter' });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  const afterBattle = game.state.hp;
  game.dispatch({ type: 'reward', id: null });
  assert.ok(game.state.hp > afterBattle);
  assert.ok(game.state.hp <= game.stats.max_hp);
});

test('RKF06 reduces one HP event cost and RKF08 refunds the actual paid amount', () => {
  const setup = method => {
    installCombat();
    const game = make(`event-cost-${method}`);
    game.state.ownedMethods.push(method);
    game.state.talents[method] = [];
    game.state.method = method;
    game.state.act = 3;
    game.state.hp = 500;
    game.state.nodes = [{ type: 'E', id: 'RE021', completed: false }];
    game.state.step = 0;
    game.state.phase = 'map';
    game.dispatch({ type: 'enter' });
    return game;
  };
  const reduced = setup('RKF06');
  const reducedBefore = reduced.state.hp;
  reduced.dispatch({ type: 'event', id: 'RE021-A' });
  assert.equal(reduced.state.hp, reducedBefore - (0.15 * 950 * 0.85));

  const refunded = setup('RKF08');
  const refundedBefore = refunded.state.hp;
  refunded.dispatch({ type: 'event', id: 'RE021-A' });
  assert.equal(refunded.state.hp, refundedBefore - (0.15 * 950) + (0.08 * 950));
});

test('malformed serialized internals and outer save headers are rejected', () => {
  installCombat();
  const game = make('corrupt-save-seed');
  game.dispatch({ type: 'route', id: 'steady' });
  const store = storage();
  const valid = JSON.parse(serializeRun(game));

  const badHeader = structuredClone(valid);
  badHeader.key = 'wrong-key';
  store.setItem(SHANHAI_SAVE_KEY, JSON.stringify(badHeader));
  assert.throws(() => loadRun(content, store), /record header/);

  const badQueue = structuredClone(valid);
  badQueue.state._talentQueue = [{ method: 'RKF99', tier: 1, advance: false }];
  store.setItem(SHANHAI_SAVE_KEY, JSON.stringify(badQueue));
  assert.throws(() => loadRun(content, store), /talent queue|method/);

  const badRoundLimit = structuredClone(valid);
  badRoundLimit.state.phase = 'battle';
  badRoundLimit.state._battleKind = 'node';
  badRoundLimit.state._battleNodeType = 'C';
  badRoundLimit.state.battleInput = {
    player: structuredClone(game.player),
    enemy: { name: 'enemy', method: 'RKF01', n: 0, talents: [], artifacts: [] },
    seed: 'bad',
    roundLimit: 8192,
  };
  badRoundLimit.state.battle = {
    outcome: 'draw',
    rounds: 1,
    playerHp: 1,
    enemyHp: 1,
    frames: [],
    contributions: [],
  };
  store.setItem(SHANHAI_SAVE_KEY, JSON.stringify(badRoundLimit));
  assert.throws(() => loadRun(content, store), /battle input|4096/);

  assert.throws(() => serializeRun({ ...game.state, firstStrike: Number.NaN }), /first strike|run resources|Non-finite/);
});

test('reward selection is single-use and respects artifact capacity', () => {
  installCombat();
  const game = make('reward-seed');
  enterFirstBattle(game);
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  const reward = game.state.rewardCandidates[0];
  game.dispatch({ type: 'reward', id: reward });
  assert.equal(game.state.artifacts.find(item => item.id === reward)?.stacks, 1);
  assert.throws(() => game.dispatch({ type: 'reward', id: reward }));

  const capped = make('capacity-seed');
  capped.state.artifacts = [{ id: 'RC01', stacks: 5 }];
  capped.state.nodes = [{ type: 'C', id: 'EN-A1-C1', completed: false }];
  capped.state.phase = 'reward';
  capped.state.battle = {
    outcome: 'player',
    rounds: 1,
    playerHp: capped.state.hp,
    enemyHp: 0,
    frames: [],
    contributions: [],
  };
  capped.state.rewardCandidates = ['RC01'];
  assert.throws(() => capped.dispatch({ type: 'reward', id: 'RC01' }));
});

test('full deterministic winning run records the actual build once', () => {
  installCombat();
  const game = make('full-seed');
  runToTerminal(game);
  assert.equal(game.state.phase, 'won');
  const store = storage();
  const first = saveWinningBuild(game, store);
  const second = saveWinningBuild(game, store);
  assert.ok(first);
  assert.equal(first.buildId, second.buildId);
  assert.equal(loadWinningBuilds(store).length, 1);
});
