import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker, simulateBattle as simulateRunBattle, validateBattleResult } from '../build/shanhai/run.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const baseContent = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const { name = method, hp, permanentRule, ...stats } = overrides;
  return {
    name,
    method,
    n: 4,
    talents: [],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
    ...(permanentRule === undefined ? {} : { permanentRule }),
  };
}

function makeEnemy(overrides = {}, artifacts = []) {
  return makeLoadout('RKF06', artifacts, {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function findFrame(result, predicate, message = 'expected battle frame was not found') {
  const found = result.frames.find(predicate);
  assert.ok(found, message);
  return found;
}

function counter(frame, side, id) {
  const found = (frame[side].counters ?? []).find(item => item.id === id);
  assert.ok(found, `expected ${side} counter ${id}`);
  return found;
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

function atEliteReward(seed) {
  const game = ShanhaiGame.create(baseContent, { seed, name: '稀有法宝试验者', method: 'RKF01' });
  game.startAct(1);
  const routeMap = game.state.routeMap;
  const target = routeMap.nodes.find(node => node.type === 'L');
  assert.ok(target, 'the route includes an elite battle');
  const nodesByKey = new Map(routeMap.nodes.map(node => [node.key, node]));
  const path = [target];
  while (path[0].depth > 0) {
    const parent = routeMap.nodes.find(node => node.next.includes(path[0].key));
    assert.ok(parent, `the elite node ${target.key} has a route to the entrance`);
    path.unshift(parent);
  }
  routeMap.path = path.map(node => node.key);
  for (let index = 0; index < path.length; index++) {
    const routeNode = nodesByKey.get(path[index].key);
    routeNode.completed = index < path.length - 1;
  }
  game.state.nodes = path.map((node, index) => ({
    type: node.type,
    id: node.id,
    completed: index < path.length - 1,
  }));
  game.state.step = path.length - 1;
  game.dispatch({ type: 'enter', id: target.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  assert.equal(game.state.phase, 'reward');
  return game;
}

test('RR02 restores health on a genuine enemy shield break and converts the healing to shield', () => {
  const player = makeLoadout('RKF01', [{ id: 'RR02', stacks: 1 }], {
    speed: 100,
    hp: 800,
    defense: 100,
  });
  const enemy = makeEnemy({ attack: 100, speed: 1 });
  const result = simulateBattle(baseContent, player, enemy, 'rare-artifact-rr02-break', { roundLimit: 1 });

  const heal = findFrame(result, frame => frame.kind === 'heal' &&
    frame.source === 'RR02-ENEMY-SHIELD-BREAK-HEAL');
  near(heal.amount, heal.player.maxHp * 0.03);
  assert.ok(result.frames.some(frame => frame.kind === 'shield' &&
    frame.source === 'RR02-FIRST-SELF-HEAL-SHIELD' && frame.amount > 0),
  'the break-triggered heal continues through RR02 self-heal conversion');
  assert.equal(result.frames.filter(frame => frame.source === 'RR02-ENEMY-SHIELD-BREAK-HEAL' &&
    frame.kind === 'heal').length, 1);
});

test('RR02 healing overflow still feeds RL01 and lethal shield breaks stop before healing', () => {
  const player = makeLoadout('RKF01', [
    { id: 'RL01', stacks: 1 },
    { id: 'RR02', stacks: 1 },
  ], { speed: 100, defense: 100, max_hp: 10_000 });
  const result = simulateBattle(
    baseContent,
    player,
    makeEnemy({ attack: 200, speed: 1 }),
    'rare-artifact-rr02-rl01-overflow',
    { roundLimit: 1 },
  );
  assert.ok(result.frames.some(frame => frame.kind === 'shield' &&
    frame.source === 'RL01-HEAL-OVERFLOW-TO-SHIELD' && frame.amount > 0),
  'RR02 break healing overflow remains eligible for RL01');

  const lethal = simulateBattle(
    baseContent,
    makeLoadout('RKF01', [{ id: 'RR02', stacks: 1 }], {
      speed: 100,
      hp: 20,
      defense: 100,
    }),
    makeEnemy({ attack: 10_000, speed: 1 }),
    'rare-artifact-rr02-death-cutoff',
    { roundLimit: 1 },
  );
  assert.equal(lethal.frames.some(frame => frame.source === 'RR02-ENEMY-SHIELD-BREAK-HEAL'), false);
});

test('RR02 break healing keeps mirror and inscription copies and converts their effective healing', () => {
  const result = simulateBattle(
    baseContent,
    makeLoadout('RKF01', [
      { id: 'RL08', stacks: 1 },
      { id: 'RR02', stacks: 1, inscription: 'twin' },
    ], { speed: 100, defense: 100, max_hp: 10_000 }),
    makeEnemy({ attack: 3_000, speed: 1 }),
    'rare-artifact-rr02-mirror-inscription',
    { roundLimit: 1 },
  );
  const heals = result.frames.filter(frame => frame.kind === 'heal' &&
    (frame.source === 'RR02-ENEMY-SHIELD-BREAK-HEAL' ||
      frame.source?.startsWith('RL08-MIRROR-RR02-ENEMY-SHIELD-BREAK-HEAL') ||
      frame.source?.startsWith('RR02-ENEMY-SHIELD-BREAK-HEAL-INSCRIPTION-TWIN')));
  assert.equal(heals.length, 3, 'the main heal, mirror output, and twin inscription each resolve');
  assert.ok(result.frames.some(frame => frame.kind === 'shield' &&
    frame.source === 'RR02-FIRST-SELF-HEAL-SHIELD' && frame.amount > 0),
  'RR02 converts effective healing across copied outputs after all copies resolve');
});

test('RR06 heals after actual enemy-action HP loss and only then applies its burn', () => {
  const player = makeLoadout('RKF06', [{ id: 'RR06', stacks: 1 }], {
    hp: 700,
    speed: 1,
  });
  const result = simulateBattle(
    baseContent,
    player,
    makeEnemy({ attack: 100, speed: 100 }),
    'rare-artifact-rr06-enemy-response',
    { roundLimit: 1 },
  );

  const heal = findFrame(result, frame => frame.kind === 'heal' &&
    frame.source === 'RR06-ENEMY-HP-LOSS-HEAL-BURN');
  near(heal.amount, heal.player.maxHp * 0.04);
  assert.ok(result.frames.some(frame => frame.kind === 'status' &&
    frame.source === 'RR06-ENEMY-HP-LOSS-HEAL-BURN' && frame.enemy.statuses.burn === 1));

  const shielded = simulateBattle(
    baseContent,
    makeLoadout('RKF01', [{ id: 'RR06', stacks: 1 }], {
      speed: 100,
      defense: 100,
      hp: 1_030,
    }),
    makeEnemy({ attack: 1, speed: 1 }),
    'rare-artifact-rr06-shield-only',
    { roundLimit: 1 },
  );
  assert.equal(shielded.frames.some(frame => frame.source === 'RR06-ENEMY-HP-LOSS-HEAL-BURN'), false,
    'a fully absorbed direct hit is not an enemy HP-loss trigger');

  const lethal = simulateBattle(
    baseContent,
    makeLoadout('RKF06', [{ id: 'RR06', stacks: 1 }], { hp: 20, speed: 1 }),
    makeEnemy({ attack: 100_000, speed: 100 }),
    'rare-artifact-rr06-death-cutoff',
    { roundLimit: 1 },
  );
  assert.equal(lethal.frames.some(frame => frame.source === 'RR06-ENEMY-HP-LOSS-HEAL-BURN'), false,
    'RR06 does not revive a fighter killed by the enemy action');
});

test('RR08 stores capped actual HP loss, gains rage, and retaliates once after its next damaging action', () => {
  const player = makeLoadout('RKF06', [
    { id: 'RR05', stacks: 1 },
    { id: 'RR08', stacks: 1 },
  ], { hp: 700, defense: 100, speed: 1 });
  const enemy = makeEnemy({ attack: 100, speed: 100 });
  const result = simulateBattle(baseContent, player, enemy, 'rare-artifact-rr08-valor', { roundLimit: 1 });
  const replay = simulateBattle(baseContent, player, enemy, 'rare-artifact-rr08-valor', { roundLimit: 1 });
  assert.deepEqual(replay.frames, result.frames, 'same-seed combat remains deterministic');
  assert.doesNotThrow(() => validateBattleResult(result), 'the real battle cue is accepted by run validation');
  registerCombatWorker({ calculateStats, simulateBattle });
  assert.doesNotThrow(() => simulateRunBattle(baseContent, player, enemy, 'rare-artifact-rr08-valor', { roundLimit: 1 }),
    'normal game battle entry accepts an equipped blood-valor source');
  const forged = structuredClone(result);
  forged.frames.find(frame => frame.cue?.kind === 'blood_valor').cue.sourceId = 'RR01-FAKE';
  assert.throws(() => validateBattleResult(forged), /invalid source/);

  const takenDamage = findFrame(result, frame => frame.kind === 'damage' &&
    frame.actor === 'enemy' && frame.target === 'player');
  const beforeDamage = result.frames[result.frames.indexOf(takenDamage) - 1];
  const actualHpLoss = beforeDamage.player.hp - takenDamage.player.hp;
  const stored = findFrame(result, frame => frame.kind === 'status' &&
    frame.source === 'RR08-ENEMY-ACTION-RAGE-GAIN' && frame.text.includes('血勇'));
  near(counter(stored, 'player', 'RR08-ENEMY-ACTION-RAGE-GAIN').value, actualHpLoss);
  assert.ok(result.frames.some(frame => frame.kind === 'reaction' &&
    frame.cue?.kind === 'blood_valor' && frame.actor === 'player'));
  const consumed = result.frames.findLast(frame =>
    counter(frame, 'player', 'RR08-ENEMY-ACTION-RAGE-GAIN').value === 0);
  assert.ok(consumed, 'blood valor storage clears after its one retaliation');
  assert.ok(result.frames.some(frame => frame.kind === 'damage' &&
    frame.source === 'RR08-ENEMY-ACTION-RAGE-GAIN' && frame.actor === 'player'));
  assert.equal(result.frames.filter(frame => frame.kind === 'reaction' &&
    frame.cue?.kind === 'blood_valor').length, 1, 'RR08 retaliates at most once per battle');

  const capped = simulateBattle(
    baseContent,
    makeLoadout('RKF06', [
      { id: 'RR05', stacks: 1 },
      { id: 'RR08', stacks: 1 },
    ], { hp: 900, defense: 100, speed: 1 }),
    makeEnemy({ attack: 1_000, speed: 100 }),
    'rare-artifact-rr08-storage-cap',
    { roundLimit: 1 },
  );
  const cappedStorage = findFrame(capped, frame => frame.kind === 'status' &&
    frame.source === 'RR08-ENEMY-ACTION-RAGE-GAIN' && frame.text.includes('血勇'));
  near(
    counter(cappedStorage, 'player', 'RR08-ENEMY-ACTION-RAGE-GAIN').value,
    counter(cappedStorage, 'player', 'RR08-ENEMY-ACTION-RAGE-GAIN').max,
  );

  const enemyOwner = simulateBattle(
    baseContent,
    makeLoadout('RKF06', [], { speed: 100 }),
    makeEnemy({ attack: 20, max_hp: 10_000, speed: 1 }, [{ id: 'RR08', stacks: 1 }]),
    'rare-artifact-rr08-enemy-symmetry',
    { roundLimit: 1 },
  );
  assert.ok(enemyOwner.frames.some(frame => frame.kind === 'reaction' &&
    frame.cue?.kind === 'blood_valor' && frame.actor === 'enemy'));
});

test('RR10 triggers on the second direct crit and stays suppressed by blind sword rules', () => {
  const player = makeLoadout('RKF09', [{ id: 'RR10', stacks: 1 }], {
    speed: 100,
    crit_rate: 1,
  });
  const entities = structuredClone(loaded.entities);
  entities.find(item => item.id === 'RULES').rage.opening = 100;
  const content = contentFromEntities(entities, loaded.manifest.content_version);
  const result = simulateBattle(
    content,
    player,
    makeEnemy({ max_hp: 1_000_000, speed: 1 }),
    'rare-artifact-rr10-second-crit',
    { roundLimit: 1 },
  );
  assert.ok(result.frames.some(frame => frame.kind === 'status' &&
    frame.source === 'RR10-DIRECT-CRIT-RAGE' && frame.text.includes('第二次直接暴击')));
  const rage = result.contributions.find(item => item.id === 'RR10');
  assert.ok(rage && rage.rage >= 10, 'two direct critical hits each grant rage');
  assert.ok(result.frames.some(frame => frame.kind === 'damage' &&
    frame.source === 'RR10-DIRECT-CRIT-RAGE' && frame.amount > 0),
  'the second direct critical hit creates its non-critical derived lightning');

  const suppressed = simulateBattle(
    content,
    {
      ...player,
      permanentRule: { kind: 'blind_sword' },
    },
    makeEnemy({ max_hp: 1_000_000, speed: 1 }),
    'rare-artifact-rr10-blind-sword',
    { roundLimit: 1 },
  );
  assert.equal(suppressed.frames.some(frame => frame.source === 'RR10-DIRECT-CRIT-RAGE'), false);
});

test('the four rare artifacts remain in the validated rare pool and can be acquired from a real elite reward', () => {
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
  for (const id of ['RR02', 'RR06', 'RR08', 'RR10']) {
    const artifact = baseContent.byId[id];
    assert.ok(artifact, `${id} is present in real content`);
    assert.deepEqual(artifact.acquisition.pools, ['rare_artifact']);
    assert.doesNotThrow(() => simulateBattle(
      baseContent,
      makeLoadout('RKF01', [{ id, stacks: 1 }]),
      makeEnemy(),
      `rare-artifact-real-equip-${id}`,
      { roundLimit: 1 },
    ));
  }

  const targets = new Set(['RR02', 'RR06', 'RR08', 'RR10']);
  const seedsByArtifact = new Map();
  for (let index = 0; index < 100 && seedsByArtifact.size < targets.size; index++) {
    const seed = `rare-artifact-real-pool-${index}`;
    const game = atEliteReward(seed);
    for (const id of game.state.rewardCandidates) {
      if (targets.has(id) && !seedsByArtifact.has(id)) seedsByArtifact.set(id, seed);
    }
  }
  assert.deepEqual([...seedsByArtifact.keys()].sort(), [...targets].sort(),
    'real elite reward generation can offer each target artifact');
  for (const id of targets) {
    const game = atEliteReward(seedsByArtifact.get(id));
    assert.ok(game.state.rewardCandidates.includes(id));
    game.dispatch({ type: 'reward', id });
    assert.equal(game.state.artifacts.find(stack => stack.id === id)?.stacks, 1,
      `${id} enters the player inventory through the reward command`);
  }
});
