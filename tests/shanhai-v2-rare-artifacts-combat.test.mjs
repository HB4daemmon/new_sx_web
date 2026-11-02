import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

function buildModule(name) {
  const buildRoot = process.env.SHANHAI_BUILD_DIR
    ? resolve(process.env.SHANHAI_BUILD_DIR)
    : resolve(new URL('../build', import.meta.url).pathname);
  return pathToFileURL(resolve(buildRoot, 'shanhai', name)).href;
}

const [{ contentFromEntities }, { calculateStats, simulateBattle }, {
  ShanhaiGame,
  registerCombatWorker,
  simulateBattle: simulateRunBattle,
  validateBattleResult,
}] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
  import(buildModule('run.js')),
]);

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

function patchContent(edit) {
  const entities = structuredClone(loaded.entities);
  edit(entities);
  return contentFromEntities(entities, `${loaded.manifest.content_version}-rare-progression-fixture`);
}

function makeLoadout(method, artifacts = [], overrides = {}) {
  const { name = method, hp, permanentRule, n = 4, companions = [], talents = [], preparation, ...stats } = overrides;
  return {
    name,
    method,
    n,
    talents: [...talents],
    companions: [...companions],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
    ...(permanentRule === undefined ? {} : { permanentRule }),
    ...(preparation === undefined ? {} : { preparation }),
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

function lowIncomeContent(overrides = {}) {
  return patchContent(entities => {
    const rage = entities.find(item => item.id === 'RULES').rage;
    rage.opening = 50;
    rage.basic_completed = 0;
    rage.effective_incoming_segment = 0;
    rage.round_end = 0;
    Object.assign(rage, overrides);
  });
}

function effectFrames(result, source, kind) {
  return result.frames.filter(frame => frame.source === source && frame.kind === kind);
}

test('RR13 returns rage and creates shield from the capped actual drain only', () => {
  const content = lowIncomeContent({ round_drain_cap: 6 });
  const result = simulateBattle(
    content,
    makeLoadout('RKF01', [{ id: 'RR13', stacks: 1 }], { speed: 100 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr13-actual-cap',
    { roundLimit: 1 },
  );

  const drain = findFrame(result, frame => frame.source === 'RULES-RAGE-DRAIN' && frame.actor === 'enemy');
  assert.equal(drain.amount, 6, 'the round drain cap applies before RR13 responds');
  const returned = effectFrames(result, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'rage')
    .find(frame => frame.text.includes('截脉返息'));
  const shield = effectFrames(result, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'shield')
    .find(frame => frame.text.includes('截脉针返息成盾'));
  assert.ok(returned && shield);
  assert.equal(returned.amount, 6);
  assert.equal(shield.amount, 6);
});

test('RR13 respects resistance, empty enemy rage, the owner rage cap, and the shield cap', () => {
  const resisted = simulateBattle(
    lowIncomeContent(),
    makeLoadout('RKF01', [{ id: 'RR13', stacks: 1 }], { speed: 100 }),
    makeEnemy({ attack: 0, speed: 1 }, [{ id: 'RR15', stacks: 1 }]),
    'rare-artifact-rr13-rr15-resistance',
    { roundLimit: 1 },
  );
  assert.equal(findFrame(resisted, frame => frame.source === 'RULES-RAGE-DRAIN').amount, 5);
  assert.equal(effectFrames(resisted, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'rage')
    .find(frame => frame.text.includes('截脉返息'))?.amount, 5);
  assert.equal(effectFrames(resisted, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'shield')
    .find(frame => frame.text.includes('截脉针返息成盾'))?.amount, 5);
  assert.equal(effectFrames(resisted, 'RR15-EXTERNAL-RAGE-DRAIN-RESIST', 'shield')
    .find(frame => frame.text.includes('定心佩'))?.amount, 2.5);

  const cappedOwner = simulateBattle(
    lowIncomeContent({ base_cap: 60, basic_completed: 10 }),
    makeLoadout('RKF01', [{ id: 'RR13', stacks: 1 }], { speed: 100 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr13-owner-rage-cap',
    { roundLimit: 1 },
  );
  assert.equal(findFrame(cappedOwner, frame => frame.source === 'RULES-RAGE-DRAIN').amount, 10);
  assert.equal(effectFrames(cappedOwner, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'rage')
    .some(frame => frame.text.includes('截脉返息')), false,
  'a full owner rage cap prevents the return from adding virtual rage');

  const cappedShield = simulateBattle(
    lowIncomeContent(),
    makeLoadout('RKF01', [{ id: 'RR13', stacks: 1 }], { speed: 100, preparation: 999 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr13-shield-cap',
    { roundLimit: 1 },
  );
  assert.equal(effectFrames(cappedShield, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'shield')
    .find(frame => frame.text.includes('截脉针返息成盾'))?.amount, 1);

  const empty = simulateBattle(
    lowIncomeContent({ opening: 0 }),
    makeLoadout('RKF01', [{ id: 'RR13', stacks: 1 }], { speed: 100 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr13-empty-target',
    { roundLimit: 1 },
  );
  assert.equal(effectFrames(empty, 'RULES-RAGE-DRAIN', 'rage').length, 0);
  assert.equal(effectFrames(empty, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'rage')
    .some(frame => frame.text.includes('截脉返息')), false);
  assert.equal(effectFrames(empty, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'shield')
    .some(frame => frame.text.includes('截脉针返息成盾')), false);
});

test('RR13 returns actual rage drained by a Taiyin talent and RR14 in each settlement window', () => {
  const content = lowIncomeContent({ opening: 50 });
  const playerWithRR13 = makeLoadout('RKF08', [{ id: 'RR13', stacks: 1 }, { id: 'RR14', stacks: 1 }], {
    speed: 100,
    talents: ['RKF08-J2-A'],
  });
  const playerWithoutRR13 = makeLoadout('RKF08', [{ id: 'RR14', stacks: 1 }], {
    speed: 100,
    talents: ['RKF08-J2-A'],
  });
  const enemy = makeEnemy({ attack: 0, speed: 1 });
  const withRR13 = simulateBattle(content, playerWithRR13, enemy, 'rare-artifact-rr13-cross-source', { roundLimit: 1 });
  const withoutRR13 = simulateBattle(content, playerWithoutRR13, enemy, 'rare-artifact-rr13-cross-source-control', { roundLimit: 1 });

  assert.equal(findFrame(withRR13, frame => frame.source === 'RULES-OPENING-DRAIN' && frame.actor === 'enemy').amount, 30);
  assert.equal(findFrame(withRR13, frame => frame.source === 'RULES-RAGE-DRAIN' && frame.actor === 'enemy').amount, 20,
    'RR13 and RKF08-J2-A share the target round cap');
  assert.equal(findFrame(withoutRR13, frame => frame.source === 'RULES-OPENING-DRAIN' && frame.actor === 'enemy').amount, 30);
  assert.equal(findFrame(withoutRR13, frame => frame.source === 'RULES-RAGE-DRAIN' && frame.actor === 'enemy').amount, 12,
    'the control still applies Taiyin talent and moon-hex drain without RR13');

  const rr13Rage = effectFrames(withRR13, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'rage')
    .filter(frame => frame.text.includes('截脉返息'));
  const rr13Shield = effectFrames(withRR13, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'shield')
    .filter(frame => frame.text.includes('截脉针返息成盾'));
  assert.deepEqual(rr13Rage.map(frame => [frame.round, frame.amount]), [[0, 30], [1, 20]],
    'RR14 opening drain and combined basic-hit/talent drain each cause one full return');
  assert.deepEqual(rr13Shield.map(frame => [frame.round, frame.amount]), [[0, 30], [1, 20]],
    'each actual drain also creates an equal shield');
  assert.equal(effectFrames(withoutRR13, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'rage').length, 0);
  assert.equal(effectFrames(withoutRR13, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'shield').length, 0);
});

test('RR13 handles mirrored opening drains once and responds symmetrically for either holder', () => {
  const content = lowIncomeContent({ opening: 40 });
  const mirroredLoadout = makeLoadout('RKF01', [
    { id: 'RL08', stacks: 1 },
    { id: 'RR14', stacks: 1 },
    { id: 'RR13', stacks: 1 },
  ], { speed: 100 });
  const result = simulateBattle(
    content,
    mirroredLoadout,
    makeLoadout('RKF06', structuredClone(mirroredLoadout.artifacts), { attack: 0, speed: 1 }),
    'rare-artifact-rr13-mirrored-opening-symmetry',
    { roundLimit: 1 },
  );

  const openingDrains = effectFrames(result, 'RULES-OPENING-DRAIN', 'rage');
  assert.deepEqual(openingDrains.map(frame => [frame.actor, frame.amount]), [['player', 40], ['enemy', 40]]);
  for (const side of ['player', 'enemy']) {
    const returns = effectFrames(result, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'rage')
      .filter(frame => frame.round === 0 && frame.actor === side && frame.text.includes('截脉返息'));
    const shields = effectFrames(result, 'RR13-FIRST-BASIC-RAGE-DRAIN', 'shield')
      .filter(frame => frame.round === 0 && frame.actor === side && frame.text.includes('截脉针返息成盾'));
    assert.deepEqual(returns.map(frame => frame.amount), [40], `${side} receives one full actual-drain return`);
    assert.deepEqual(shields.map(frame => frame.amount), [40], `${side} receives one equal shield`);
  }
});

test('RR14 keeps opening drain and delays only the first trial release even when copied', () => {
  const content = lowIncomeContent({ opening: 100 });
  const enemy = makeLoadout('RKF10', [], { attack: 0, speed: 1, max_hp: 1_000_000_000 });
  enemy.encounterId = 'EN-A1-B1';
  const result = simulateBattle(
    content,
    makeLoadout('RKF01', [{ id: 'RL08', stacks: 1 }, { id: 'RR14', stacks: 1, inscription: 'twin' }], {
      attack: 0,
      speed: 100,
      max_hp: 1_000_000_000,
    }),
    enemy,
    'rare-artifact-rr14-one-trial-delay',
    { roundLimit: 7 },
  );
  const openingDrain = findFrame(result, frame => frame.source === 'RULES-OPENING-DRAIN' && frame.actor === 'enemy');
  assert.equal(openingDrain.amount, 50, 'mirrored opening drains still use the shared opening cap');
  const releases = result.frames.filter(frame => frame.cue?.kind === 'enemy_release' && frame.source === 'EN-A1-B1');
  assert.deepEqual([...new Set(releases.map(frame => frame.round))], [4, 7],
    'the first release moves by one round and later releases keep the original period');
  assert.equal(result.frames.filter(frame => frame.source === 'RR14-OPENING-RAGE-DRAIN' &&
    frame.text.includes('首轮试炼延后')).length, 1,
  'mirror and inscription copies do not repeat the trial delay');
});

test('RR10 extra ticks only the holder-owned poison and burn once per round without consuming or mirroring ticks', () => {
  const content = patchContent(entities => {
    const rage = entities.find(item => item.id === 'RULES').rage;
    rage.opening = 0;
    rage.basic_completed = 100;
    rage.effective_incoming_segment = 0;
    rage.round_end = 0;
    const poisonCompanion = entities.find(item => item.id === 'RKF06').companion;
    poisonCompanion.trigger = 'burn';
    poisonCompanion.effect = { kind: 'poison', value: 1 };
    poisonCompanion.pair_bonuses = [];
  });
  const player = makeLoadout('RKF09', [
    { id: 'RR10', stacks: 1 },
    { id: 'RL08', stacks: 1 },
    { id: 'RC08', stacks: 3, inscription: 'twin' },
  ], {
    speed: 100,
    crit_rate: 1,
    companions: ['RKF06'],
  });
  const result = simulateBattle(
    content,
    player,
    makeEnemy({ attack: 0, speed: 1, max_hp: 1_000_000_000 }),
    'rare-artifact-rr10-owned-dot-settlement',
    { roundLimit: 3 },
  );
  const cues = result.frames.filter(frame => frame.round === 2 &&
    frame.source === 'RR10-DIRECT-CRIT-RAGE' && frame.kind === 'status' &&
    frame.text.includes('引雷针引动自施加'));
  assert.equal(cues.length, 2, 'a multi-crit rage action settles each DOT type only once');
  assert.deepEqual(cues.map(frame => [frame.text, frame.amount]), [
    ['RKF09引雷针引动自施加的中毒各跳伤一次', 5],
    ['RKF09引雷针引动自施加的燃烧各跳伤一次', 1],
  ], 'all current owner layers, including mirror and twin layers, are eligible');
  const markerIndex = result.frames.indexOf(cues[0]);
  const firstMainHitAfterMarker = result.frames.findIndex((frame, index) => index > markerIndex &&
    frame.source === 'RKF09-RAGE-DAMAGE' && frame.kind === 'damage');
  const bonusTicks = result.frames.slice(markerIndex + 1, firstMainHitAfterMarker)
    .filter(frame => frame.kind === 'dot');
  assert.equal(bonusTicks.length, 6, 'all five poison layers and one burn layer follow their original tick once');
  assert.equal(bonusTicks.filter(frame => frame.source === 'RKF09-BASIC-BURN').length, 1);
  assert.equal(bonusTicks.filter(frame => frame.source === 'RKF06-COMPANION-ASSIST').length, 2,
    'separate companion-created poison layers both settle');
  assert.deepEqual(new Set(bonusTicks.map(frame => frame.source)), new Set([
    'RC08-AWAKENING-1',
    'RL08-MIRROR-AWAKENING-1',
    'RC08-AWAKENING-1-INSCRIPTION-TWIN',
    'RKF06-COMPANION-ASSIST',
    'RKF09-BASIC-BURN',
  ]));
  const burnMarkerIndex = result.frames.indexOf(cues[1]);
  assert.equal(result.frames.slice(burnMarkerIndex + 1, firstMainHitAfterMarker)
    .filter(frame => frame.kind === 'dot').length, 1);
  assert.equal(result.frames.filter(frame => frame.round === 2 && frame.source === 'RR10-DIRECT-CRIT-RAGE' &&
    frame.kind === 'damage').length, 1, 'the existing second-crit lightning still resolves once');
  assert.ok(result.frames.some(frame => frame.round === 3 && frame.source === 'RKF09-BASIC-BURN' &&
    frame.kind === 'dot'), 'extra ticks preserve the original layer and remaining duration');

  const empty = simulateBattle(
    patchContent(entities => {
      entities.find(item => item.id === 'RULES').rage.opening = 100;
      entities.find(item => item.id === 'RULES').rage.round_end = 0;
    }),
    makeLoadout('RKF01', [{ id: 'RR10', stacks: 1 }], { speed: 100, crit_rate: 1 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr10-no-dot-no-recursion',
    { roundLimit: 1 },
  );
  assert.equal(empty.frames.some(frame => frame.source === 'RR10-DIRECT-CRIT-RAGE' &&
    frame.kind === 'status' && frame.text.includes('引动自施加')), false,
  'a critical hit with no owned DOT does not emit or recursively create one');
});

test('RR01 stores one hit bead for the next rage action and RR07 converts a successful cap reduction into one basic followup', () => {
  const rr01Content = lowIncomeContent({ basic_completed: 35, round_end: 10 });
  const rr01 = simulateBattle(
    rr01Content,
    makeLoadout('RKF01', [{ id: 'RR01', stacks: 1 }], { speed: 100 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr01-stored-bead',
    { roundLimit: 2 },
  );
  const beadStrike = effectFrames(rr01, 'RR01-CHARGED-RAGE-STRIKE', 'damage');
  assert.equal(beadStrike.length, 1);
  assert.equal(beadStrike[0].round, 2);
  assert.ok(beadStrike[0].amount > 0);
  assert.ok(rr01.contributions.find(item => item.id === 'RR01')?.rage >= 10,
    'the base-hit rage effect is included in the artifact contribution');

  const rr07Content = lowIncomeContent({ opening: 100 });
  const rr07 = simulateBattle(
    rr07Content,
    makeLoadout('RKF01', [{ id: 'RR07', stacks: 1 }], { speed: 100 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr07-cap-to-basic',
    { roundLimit: 3 },
  );
  const capChange = findFrame(rr07, frame => frame.source === 'RR07-FIRST-RAGE-CAP-REDUCTION' &&
    frame.kind === 'rage' && frame.text.includes('上限调整'));
  assert.equal(capChange.round, 1);
  const followups = effectFrames(rr07, 'RR07-NEXT-BASIC-STRIKE', 'damage');
  assert.equal(followups.length, 1);
  assert.equal(followups[0].round, 2);
  assert.ok(followups[0].amount > 0);
});

test('RR08 bounded missing-health damage preserves the existing blood-valor retaliation', () => {
  const healthy = simulateBattle(
    baseContent,
    makeLoadout('RKF01', [{ id: 'RR08', stacks: 1 }], { speed: 100, hp: 1_030 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr08-full-health',
    { roundLimit: 1 },
  );
  const baselineHealthy = simulateBattle(
    baseContent,
    makeLoadout('RKF01', [{ id: 'RR08', stacks: 1 }], { speed: 100, hp: 1_030 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr08-full-health-baseline',
    { roundLimit: 1 },
  );
  const healthyHit = findFrame(healthy, frame => frame.source === 'RKF01-BASIC-DAMAGE' && frame.kind === 'damage');
  const baselineHit = findFrame(baselineHealthy, frame => frame.source === 'RKF01-BASIC-DAMAGE' && frame.kind === 'damage');
  assert.equal(healthyHit.amount, baselineHit.amount, 'full health has no missing-health bonus');

  const lowHealth = simulateBattle(
    baseContent,
    makeLoadout('RKF01', [{ id: 'RR08', stacks: 1 }], { speed: 100, hp: 1 }),
    makeEnemy({ attack: 0, speed: 1 }),
    'rare-artifact-rr08-low-health-cap',
    { roundLimit: 1 },
  );
  const lowHit = findFrame(lowHealth, frame => frame.source === 'RKF01-BASIC-DAMAGE' && frame.kind === 'damage');
  assert.ok(lowHit.amount <= healthyHit.amount * 1.2 + 1e-8);
  assert.ok(lowHit.amount > healthyHit.amount * 1.19,
    'near-zero health approaches but does not exceed the 20% bonus cap');
});
