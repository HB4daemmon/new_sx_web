import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadContent } from '../tools/content-kit/src/loader.mjs';

function buildModule(name) {
  const buildRoot = process.env.SHANHAI_BUILD_DIR
    ? resolve(process.env.SHANHAI_BUILD_DIR)
    : resolve(new URL('../build', import.meta.url).pathname);
  return pathToFileURL(resolve(buildRoot, 'shanhai', name)).href;
}

const [
  { contentFromEntities },
  { simulateBattle },
  { battleElementalFxCues },
  { elementalFxMarkup },
  { combatPresentationGroup },
  { validateBattleResult },
] = await Promise.all([
  import(buildModule('content.js')),
  import(buildModule('combat.js')),
  import(buildModule('battle-elemental-vfx.js')),
  import(buildModule('elemental-vfx-art.js')),
  import(buildModule('battle-playback.js')),
  import(buildModule('run.js')),
]);

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

const BASE_STATS = Object.freeze({
  attack: 100,
  defense: 0,
  max_hp: 1_000,
  crit_rate: 0,
  speed: 20,
});

function makeLoadout(method, artifacts = [], overrides = {}) {
  const { talents = [], n = 4, hp, journey, ...stats } = overrides;
  return {
    name: method,
    method,
    n,
    talents: [...talents],
    artifacts: structuredClone(artifacts),
    baseStats: { ...BASE_STATS, ...stats },
    ...(hp === undefined ? {} : { hp }),
    ...(journey === undefined ? {} : {
      journey: {
        coins: 0,
        coinsSpent: 0,
        eliteWins: 0,
        bossWins: 0,
        artifactKinds: 0,
        knownMethods: 0,
        ...journey,
      },
    }),
  };
}

function makeEnemy(overrides = {}) {
  return makeLoadout('RKF01', [], {
    attack: 0,
    defense: 0,
    max_hp: 1_000_000_000,
    speed: 1,
    ...overrides,
  });
}

function actualLoss(frame, previous, side) {
  return Math.max(0, previous[side].hp - frame[side].hp) +
    Math.max(0, previous[side].shield - frame[side].shield);
}

function fighterView(name, hp) {
  return {
    name,
    method: 'RKF01',
    hp,
    maxHp: 100,
    shield: 0,
    maxShield: 100,
    rage: 0,
    rageCap: 100,
    statuses: {},
  };
}

function simpleFrame({
  kind = 'damage',
  actor,
  target,
  source,
  dotStatus,
  playerHp = 100,
  enemyHp = 100,
  round = 1,
} = {}) {
  return {
    round,
    kind,
    actor,
    target,
    source,
    dotStatus,
    text: '',
    player: fighterView('玩家', playerHp),
    enemy: fighterView('敌人', enemyHp),
  };
}

test('real action frames cast the authored kind for all ten methods on both sides', () => {
  const expectedKind = new Map([
    ['RKF01', 'guard'],
    ['RKF02', 'energy'],
    ['RKF03', 'healing'],
    ['RKF04', 'fire'],
    ['RKF05', 'blade'],
    ['RKF06', 'poison'],
    ['RKF07', 'thunder'],
    ['RKF08', 'moon'],
    ['RKF09', 'sun'],
    ['RKF10', 'dragon'],
  ]);

  for (const [method, kind] of expectedKind) {
    const result = simulateBattle(
      content,
      makeLoadout(method, [], { speed: 30 }),
      makeEnemy(),
      `elemental-cast-${method}`,
      { roundLimit: 1 },
    );
    const index = result.frames.findIndex(frame => frame.kind === 'action' && frame.actor === 'player');
    assert.ok(index >= 0, `${method} must appear as a real player action`);
    assert.equal(result.frames[index].player.method, method);
    assert.deepEqual(battleElementalFxCues(result.frames, index), [{
      kind,
      owner: 'player',
      target: 'enemy',
      phase: 'cast',
      intensity: 'basic',
    }], `${method} must cast its own element from the player side`);
  }

  const enemyResult = simulateBattle(
    content,
    makeLoadout('RKF01', [], { attack: 0, speed: 1 }),
    makeLoadout('RKF04', [], { speed: 30 }),
    'elemental-cast-enemy-fire',
    { roundLimit: 1 },
  );
  const enemyAction = enemyResult.frames.findIndex(frame => frame.kind === 'action' && frame.actor === 'enemy');
  assert.ok(enemyAction >= 0, 'the opposing method must take a real action');
  assert.deepEqual(battleElementalFxCues(enemyResult.frames, enemyAction), [{
    kind: 'fire',
    owner: 'enemy',
    target: 'player',
    phase: 'cast',
    intensity: 'basic',
  }]);
});

test('sword-pill segments and converged blades follow real hits across methods', () => {
  const fireSword = makeLoadout('RKF04', [], { speed: 30, talents: ['V2-J2-C'] });
  const directHits = result => result.frames.map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.kind === 'damage' && frame.actor === 'player' &&
      frame.source === 'RKF04-BASIC-DAMAGE');
  const battle = simulateBattle(content, fireSword, makeEnemy(), 'fire-sword-pill', { roundLimit: 1 });
  const hits = directHits(battle);
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map(({ frame }) => frame.strikeVisual), [undefined, 'sword_pill', 'sword_pill']);
  assert.deepEqual(battleElementalFxCues(battle.frames, hits[0].index).map(cue => cue.kind), ['fire'],
    'the original fire strike must not announce future sword pills');
  const firstSword = battleElementalFxCues(battle.frames, hits[1].index).find(cue => cue.kind === 'blade');
  assert.equal(firstSword?.count ?? 1, 1);
  const finalCues = battleElementalFxCues(battle.frames, hits[2].index);
  assert.ok(finalCues.some(cue => cue.kind === 'fire'), 'the real fire attack stays visible');
  assert.equal(finalCues.find(cue => cue.kind === 'blade')?.count, 2,
    'both resolved bonus hits produce swords, not extra fire projectiles');
  assert.deepEqual(finalCues, battleElementalFxCues(battle.frames.slice(0, hits[2].index + 1), hits[2].index));
  assert.doesNotThrow(() => validateBattleResult(battle));

  const lethal = simulateBattle(content, fireSword, makeEnemy({ max_hp: 100 }), 'fire-sword-pill', { roundLimit: 1 });
  const lethalHits = directHits(lethal);
  assert.equal(lethal.outcome, 'player');
  assert.equal(lethalHits.length, 2, 'the final sword never hits after the first sword kills');
  assert.equal(battleElementalFxCues(lethal.frames, lethalHits[1].index)
    .find(cue => cue.kind === 'blade')?.count ?? 1, 1);

  const converged = simulateBattle(content,
    makeLoadout('RKF04', [{ id: 'RC01', stacks: 1 }], { speed: 30, talents: ['V2-J2-C'] }),
    makeEnemy(), 'fire-sword-pill', { roundLimit: 1 });
  const convergedHits = directHits(converged);
  assert.equal(convergedHits.length, 1, 'RC01 combines all three actual segments');
  assert.equal(convergedHits[0].frame.strikeVisual, 'converged_blade');
  const convergedCues = battleElementalFxCues(converged.frames, convergedHits[0].index);
  assert.equal(convergedCues.find(cue => cue.kind === 'blade')?.count ?? 1, 1);
  assert.ok(!convergedCues.some(cue => cue.kind === 'fire'), 'the combined hit is one blade, not two attacks');
  assert.doesNotThrow(() => validateBattleResult(converged));

  const invalid = structuredClone(battle);
  invalid.frames[hits[1].index].strikeVisual = 'imaginary';
  assert.throws(() => validateBattleResult(invalid), /Invalid battle strike visual/);
  invalid.frames[hits[1].index].strikeVisual = 'sword_pill';
  invalid.frames[hits[1].index].source = 'RL07';
  assert.throws(() => validateBattleResult(invalid), /Invalid battle strike visual/);
});

test('RKF05 volley projectiles follow only already visible real hits and stop on a kill', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF05', [], { attack: 100, speed: 20 }),
    makeEnemy({ speed: 30 }),
    'elemental-volley-visible-count',
    { roundLimit: 4 },
  );
  const volleyStart = result.frames.findIndex(frame =>
    frame.kind === 'reaction' && frame.cue?.kind === 'sword_volley' && frame.text.includes('3 柄'));
  assert.ok(volleyStart >= 0, 'the real method must eventually gather three flying swords');
  const volleyFrames = [];
  for (let index = volleyStart + 1; index < result.frames.length; index += 1) {
    const frame = result.frames[index];
    if (frame.cue?.kind !== 'sword_volley') break;
    if (frame.kind === 'damage' && frame.source === frame.cue.sourceId) volleyFrames.push(index);
  }
  assert.equal(volleyFrames.length, 3, 'three actual flying swords produce three damage frames');
  assert.ok(volleyFrames.every(index => actualLoss(
    result.frames[index], result.frames[index - 1], 'enemy') > 0));

  const wholeBeat = combatPresentationGroup(result.frames, volleyFrames.at(-1));
  assert.ok(wholeBeat);
  const widenedBeat = { ...wholeBeat, endIndex: volleyFrames.at(-1) };
  assert.deepEqual(battleElementalFxCues(result.frames, volleyStart), [],
    'the reaction label alone does not draw swords before a hit exists');

  for (const [visibleCount, index] of volleyFrames.entries()) {
    const cues = battleElementalFxCues(result.frames, index, widenedBeat);
    const volley = cues.find(cue => cue.kind === 'volley');
    assert.ok(volley);
    assert.equal(volley.owner, 'player');
    assert.equal(volley.target, 'enemy');
    assert.equal(volley.phase, 'travel');
    assert.equal(volley.count ?? 1, visibleCount + 1,
      'a caller-supplied later beat boundary must not reveal future projectiles');
  }

  const lethal = simulateBattle(
    content,
    makeLoadout('RKF05', [], { attack: 20, speed: 20 }),
    makeEnemy({ max_hp: 24, speed: 30 }),
    'elemental-volley-interrupted-kill',
    { roundLimit: 4 },
  );
  assert.equal(lethal.outcome, 'player');
  assert.equal(lethal.enemyHp, 0);
  const interruptedStart = lethal.frames.findIndex(frame =>
    frame.kind === 'reaction' && frame.cue?.kind === 'sword_volley' && frame.text.includes('2 柄'));
  assert.ok(interruptedStart >= 0, 'the kill fixture reaches a two-sword volley');
  const interruptedDamage = lethal.frames.map((frame, index) => ({ frame, index }))
    .filter(({ frame, index }) => index > interruptedStart &&
      frame.cue?.kind === 'sword_volley' && frame.kind === 'damage' &&
      frame.source === frame.cue.sourceId);
  assert.equal(interruptedDamage.length, 1, 'combat stops the second volley as soon as its first sword kills');
  const finalCue = battleElementalFxCues(lethal.frames, interruptedDamage[0].index)
    .find(cue => cue.kind === 'volley');
  assert.ok(finalCue);
  assert.equal(finalCue.count ?? 1, 1, 'the interrupted sword must not draw its unplayed partner');
});

test('companion sword, lightning, and fire retain their own real effect instead of the main method', () => {
  const player = {
    ...makeLoadout('RKF01', [], { defense: 40, speed: 30 }),
    companions: ['RKF05', 'RKF07', 'RKF04'],
  };
  const result = simulateBattle(content, player, makeEnemy(), 'elemental-companion-elements', { roundLimit: 1 });
  for (const [method, kind, frameKind] of [
    ['RKF05', 'blade', 'damage'],
    ['RKF07', 'thunder', 'damage'],
    ['RKF04', 'fire', 'status'],
  ]) {
    const index = result.frames.findIndex(frame => frame.kind === frameKind &&
      frame.source === `${method}-COMPANION-ASSIST` && frame.actor === 'player');
    assert.ok(index > 0, `${method} companion must produce a real ${frameKind} frame`);
    const cue = battleElementalFxCues(result.frames, index).find(item => item.kind === kind);
    assert.ok(cue, `${method} companion must use ${kind}, not the main method's guard effect`);
    assert.equal(cue.owner, 'player');
    assert.equal(cue.target, 'enemy');
  }
});

test('DOT type follows its resolved status across mixed sources, mirrors, and identical RL06 sources', () => {
  const result = simulateBattle(
    content,
    makeLoadout('RKF06', [{ id: 'RL06', stacks: 1 }], { speed: 30 }),
    makeEnemy(),
    'elemental-dot-mixed-rl06',
    { roundLimit: 4 },
  );
  const methodPoison = result.frames.findIndex(frame => frame.kind === 'dot' &&
    frame.source === 'RKF06-BASIC-POISON' && frame.dotStatus === 'poison');
  const artifactBurn = result.frames.findIndex(frame => frame.kind === 'dot' &&
    frame.source === 'RL06' && frame.dotStatus === 'burn');
  assert.ok(methodPoison >= 0, 'RKF06 must resolve a poison tick from its real status layer');
  assert.ok(artifactBurn >= 0, 'RL06 must resolve a burn tick from its real status layer');
  assert.deepEqual(battleElementalFxCues(result.frames, methodPoison).map(cue => cue.kind), ['poison']);
  assert.deepEqual(new Set(battleElementalFxCues(result.frames, artifactBurn).map(cue => cue.kind)),
    new Set(['poison', 'fire']), 'the visible mixed-source tick group shows both actual DOT types');
  assert.ok(result.frames.some(frame => frame.kind === 'status' && frame.source === 'RL06' &&
    frame.text.includes('引爆')));
  const explosion = result.frames.findIndex(frame => frame.kind === 'damage' && frame.source === 'RL06');
  assert.ok(explosion >= 0);
  assert.ok(result.frames[explosion].enemy.hp < result.frames[explosion - 1].enemy.hp,
    'the RL06 effect cue is backed by actual resolved damage');
  assert.ok(battleElementalFxCues(result.frames, explosion).some(cue =>
    cue.kind === 'poison_fire' && cue.phase === 'impact'));
  assert.doesNotThrow(() => validateBattleResult(result),
    'real poison and burn metadata must pass battle-result validation');

  const invalidMetadata = structuredClone(result);
  invalidMetadata.frames[methodPoison].dotStatus = 'flame';
  assert.throws(() => validateBattleResult(invalidMetadata), /Invalid battle DOT status/);
  const invalidPlacement = structuredClone(result);
  invalidPlacement.frames[artifactBurn].kind = 'damage';
  assert.throws(() => validateBattleResult(invalidPlacement), /Invalid battle DOT status/);

  const mirrored = simulateBattle(
    content,
    makeLoadout('RKF04', [
      { id: 'RL08', stacks: 1 },
      { id: 'RC14', stacks: 3 },
    ], { speed: 30 }),
    makeEnemy(),
    'elemental-dot-mirrored-poison',
    { roundLimit: 2 },
  );
  const mirroredPoison = mirrored.frames.findIndex(frame => frame.kind === 'dot' &&
    frame.source === 'RL08-MIRROR-RC14' && frame.dotStatus === 'poison');
  assert.ok(mirroredPoison >= 0, 'the mirror must produce a real copied poison tick');
  assert.deepEqual(battleElementalFxCues(mirrored.frames, mirroredPoison).map(cue => cue.kind), ['poison'],
    'a mirrored source remains poison when the runtime says the tick was poison');

  const sameArtifactSource = [
    simpleFrame({ kind: 'round', round: 1 }),
    simpleFrame({ kind: 'dot', actor: 'player', target: 'enemy', source: 'RL06',
      dotStatus: 'poison', enemyHp: 90 }),
    simpleFrame({ kind: 'dot', actor: 'player', target: 'enemy', source: 'RL06',
      dotStatus: 'burn', enemyHp: 80 }),
  ];
  assert.deepEqual(battleElementalFxCues(sameArtifactSource, 2).map(cue => [cue.kind, cue.phase]), [
    ['poison', 'impact'],
    ['fire', 'impact'],
  ], 'one RL06 source can render both status elements when its frames identify distinct resolved DOTs');
});

test('real twin swords, 如意钱, and 裂空宝轮 hits map to their distinct combat effects', () => {
  const twinSwords = simulateBattle(
    content,
    makeLoadout('RKF01', [{ id: 'RL07', stacks: 1 }], { speed: 30 }),
    makeEnemy(),
    'elemental-rl07-twin-swords',
    { roundLimit: 1 },
  );
  const twinHits = twinSwords.frames.map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.kind === 'damage' && frame.source === 'RL07');
  assert.equal(twinHits.length, 2, 'RL07 produces its two real follow-up sword hits');
  const twinCue = battleElementalFxCues(twinSwords.frames, twinHits.at(-1).index)
    .find(cue => cue.kind === 'blade');
  assert.ok(twinCue);
  assert.deepEqual([twinCue.owner, twinCue.target, twinCue.phase, twinCue.count],
    ['player', 'enemy', 'travel', 2]);

  const wealth = simulateBattle(
    content,
    makeLoadout('RKF01', [{ id: 'RR04', stacks: 1 }], {
      speed: 30,
      journey: { coins: 250 },
    }),
    makeEnemy(),
    'elemental-rr04-wealth-strikes',
    { roundLimit: 1 },
  );
  const wealthHits = wealth.frames.map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.kind === 'damage' && frame.source === 'RR04-V2-RESONANCE');
  assert.equal(wealthHits.length, 3, 'the frozen 250-coin loadout produces three actual wealth strikes');
  const wealthCue = battleElementalFxCues(wealth.frames, wealthHits.at(-1).index)
    .find(cue => cue.kind === 'fortune');
  assert.ok(wealthCue);
  assert.deepEqual([wealthCue.owner, wealthCue.target, wealthCue.phase, wealthCue.count],
    ['player', 'enemy', 'travel', 3]);

  const wheel = simulateBattle(
    content,
    makeLoadout('RKF01', [{ id: 'RL03', stacks: 1 }], { speed: 30 }),
    makeEnemy(),
    'elemental-rl03-wheel-storm',
    { roundLimit: 8 },
  );
  const wheelHits = wheel.frames.map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.kind === 'damage' && frame.source === 'RL03-V2-RESONANCE');
  assert.equal(wheelHits.length, 4, 'a charged real wheel releases four damage segments');
  const wheelCue = battleElementalFxCues(wheel.frames, wheelHits.at(-1).index)
    .find(cue => cue.kind === 'wheel');
  assert.ok(wheelCue);
  assert.deepEqual([wheelCue.owner, wheelCue.target, wheelCue.phase, wheelCue.count],
    ['player', 'enemy', 'travel', 4]);
});

test('empty, ungrounded, unchanged, and zero-damage frames do not invent elemental impacts', () => {
  assert.deepEqual(battleElementalFxCues([], 0), []);
  assert.deepEqual(battleElementalFxCues([
    simpleFrame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RL06' }),
  ], 0), [], 'a damage frame without a prior snapshot cannot prove an impact');

  const unchanged = [
    simpleFrame({ kind: 'round' }),
    simpleFrame({ kind: 'damage', actor: 'player', target: 'enemy', source: 'RL06' }),
    simpleFrame({ kind: 'status', actor: 'player', target: 'enemy', source: 'RL06' }),
  ];
  assert.deepEqual(battleElementalFxCues(unchanged, 1), [],
    'an authored source with zero actual HP or shield loss does not show an impact');
  assert.deepEqual(battleElementalFxCues(unchanged, 2), [],
    'a status frame with no corresponding status increase does not show an effect');
});

test('elemental markup accepts only safe cues and bounds cue, sword, and duration counts', () => {
  const allowed = { kind: 'volley', owner: 'player', target: 'enemy', phase: 'travel', intensity: 'reaction' };
  const bounded = elementalFxMarkup([
    { ...allowed, count: 99 },
    { kind: 'fire', owner: 'enemy', target: 'player', phase: 'impact' },
    { kind: 'poison', owner: 'player', target: 'enemy', phase: 'cast', label: '<img src=x onerror=alert(1)>' },
    { kind: 'blade', owner: 'player', target: 'enemy', phase: 'travel' },
  ], 900);
  assert.equal((bounded.match(/class="elemental-fx"/g) ?? []).length, 3,
    'at most three decorative cues are returned');
  assert.equal((bounded.match(/class="elemental-fx__projectile"/g) ?? []).length, 5,
    'a volley renders at most five sword projectiles');
  assert.match(bounded, /data-count="5"/);
  assert.match(bounded, /--fx-duration:480ms/);
  const twoSwords = elementalFxMarkup([{ ...allowed, count: 2 }], 260);
  assert.match(twoSwords, /--shot-start-offset:-30px/);
  assert.match(twoSwords, /--shot-start-offset:30px/);
  assert.doesNotMatch(bounded, /<img|onerror|alert\(1\)/i,
    'unrecognized cue fields are never interpolated as HTML');

  const invalid = [
    { ...allowed, kind: '<img src=x onerror=alert(1)>' },
    { ...allowed, owner: 'player" onmouseover="alert(1)' },
    { ...allowed, target: 'other' },
    { ...allowed, phase: 'approach' },
    { ...allowed, intensity: '<script>' },
    { ...allowed, count: Number.POSITIVE_INFINITY },
  ];
  assert.equal(elementalFxMarkup(invalid, 260), '', 'invalid enum and numeric values are discarded');
  assert.match(elementalFxMarkup([
    { kind: 'fire', owner: 'player', target: 'enemy', phase: 'impact' },
  ], 0), /--fx-duration:90ms/);
});
