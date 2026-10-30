import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities, seededRandom } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);
const VOW = 'V2-J1-G';
const BASE_STATS = {
  attack: 100,
  defense: 200,
  max_hp: 1000,
  crit_rate: 0,
  speed: 200,
};

registerCombatWorker({ calculateStats, simulateBattle });

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
}

function loadout(method, talents = [], options = {}) {
  const baseStats = { ...BASE_STATS, ...(options.baseStats ?? {}) };
  return {
    name: options.name ?? '试炼者',
    method,
    n: 1,
    talents,
    artifacts: [],
    baseStats,
    hp: options.hp ?? baseStats.max_hp,
    preparation: 0,
    journey: {
      coins: 0,
      coinsSpent: 0,
      eliteWins: 0,
      bossWins: 0,
      artifactKinds: 0,
      knownMethods: 1,
    },
  };
}

function trainingDummy(options = {}) {
  return loadout('RKF01', [], {
    name: '木人',
    baseStats: {
      attack: options.attack ?? 0,
      defense: options.defense ?? 0,
      max_hp: options.maxHp ?? 1_000_000,
      crit_rate: 0,
      speed: options.speed ?? 0,
    },
  });
}

function damageFrame(result, source, actor = 'player') {
  const frame = result.frames.find(item =>
    item.kind === 'damage' && item.actor === actor && item.source === source);
  assert.ok(frame, `expected damage from ${source}`);
  return frame;
}

function hpReference(game) {
  return game.content.rules.economy.reference_hp_by_act[game.state.act - 1];
}

function selectVow(seedPrefix = 'blood-vow-selection', method = 'RKF03') {
  const requiredXp = content.rules.cultivation.cumulative[0];
  for (let index = 0; index < 4096; index++) {
    const game = ShanhaiGame.create(content, {
      seed: `${seedPrefix}-${index}`,
      name: '断生试炼者',
      method,
    });
    game.state.n = 1;
    game.state.xp = requiredXp;
    const offered = game.availableTalents();
    if (!offered.some(talent => talent.id === VOW)) continue;
    game.state.phase = 'talent';
    game.dispatch({ type: 'talent', id: VOW });
    assert.equal(game.state.bloodVow, true);
    return game;
  }
  throw new Error(`No deterministic first-tier draft offered ${VOW}`);
}

function oldFirstTierDraft(seed, key) {
  const pool = ['V2-J1-A', 'V2-J1-B', 'V2-J1-C', 'V2-J1-D', 'V2-J1-E', 'V2-J1-F'];
  const random = seededRandom(`${seed}:talent-draft:${key}:shared`);
  const result = [];
  while (pool.length && result.length < 3) {
    result.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return result;
}

test('断生入魔 amplifies real self-healing, overheal, direct damage, and derived overflow damage', () => {
  const plain = loadout('RKF03');
  const maximum = calculateStats(content, plain).max_hp;
  plain.hp = maximum - 30;
  const vowed = { ...plain, talents: [VOW] };
  const enemy = trainingDummy();

  const normal = simulateBattle(content, plain, enemy, 'blood-vow-heal', { roundLimit: 1 });
  const enhanced = simulateBattle(content, vowed, enemy, 'blood-vow-heal', { roundLimit: 1 });
  const normalHeal = normal.frames.find(frame => frame.kind === 'heal' && frame.source === 'RKF03-BASIC-HEAL');
  const enhancedHeal = enhanced.frames.find(frame => frame.kind === 'heal' && frame.source === 'RKF03-BASIC-HEAL');
  assert.ok(normalHeal && enhancedHeal);
  near(enhancedHeal.amount / normalHeal.amount, 1.5);
  near(
    damageFrame(enhanced, 'RKF03-BASIC-DAMAGE').amount /
      damageFrame(normal, 'RKF03-BASIC-DAMAGE').amount,
    1.35,
  );

  const overhealPlain = { ...plain, hp: maximum - 1 };
  const overhealVowed = { ...overhealPlain, talents: [VOW] };
  const overflowNormal = simulateBattle(content, overhealPlain, enemy, 'blood-vow-overflow', { roundLimit: 1 });
  const overflowEnhanced = simulateBattle(content, overhealVowed, enemy, 'blood-vow-overflow', { roundLimit: 1 });
  const normalOverflowDamage = damageFrame(overflowNormal, 'RKF03-PASSIVE-OVERFLOW').amount;
  const enhancedOverflowDamage = damageFrame(overflowEnhanced, 'RKF03-PASSIVE-OVERFLOW').amount;
  near(enhancedOverflowDamage / normalOverflowDamage, (29 / 19) * 1.35);
});

test('poison, burn ticks, and RKF01 shield reflection do not receive the vow damage multiplier', () => {
  for (const [method, dotSource] of [
    ['RKF04', 'RKF04-BASIC-BURN'],
    ['RKF06', 'RKF06-BASIC-POISON'],
  ]) {
    const plain = loadout(method);
    const vowed = { ...plain, talents: [VOW] };
    const enemy = trainingDummy();
    const normal = simulateBattle(content, plain, enemy, `blood-vow-dot-${method}`, { roundLimit: 2 });
    const enhanced = simulateBattle(content, vowed, enemy, `blood-vow-dot-${method}`, { roundLimit: 2 });
    const ticks = result => result.frames.filter(frame =>
      frame.kind === 'dot' && frame.actor === 'player' && frame.source === dotSource)
      .map(frame => frame.amount);
    assert.ok(ticks(normal).length > 0, `${method} should tick its damage over time`);
    assert.deepEqual(ticks(enhanced), ticks(normal));
  }

  const plain = loadout('RKF01');
  const vowed = { ...plain, talents: [VOW] };
  const attackingDummy = trainingDummy({ attack: 100, maxHp: 1_000_000 });
  const normal = simulateBattle(content, plain, attackingDummy, 'blood-vow-reflect', { roundLimit: 1 });
  const enhanced = simulateBattle(content, vowed, attackingDummy, 'blood-vow-reflect', { roundLimit: 1 });
  near(
    damageFrame(enhanced, 'RKF01-PASSIVE-RECOIL').amount,
    damageFrame(normal, 'RKF01-PASSIVE-RECOIL').amount,
  );
});

test('the run marker persists across save, talent reset, and method changes; ineffective healing stays unavailable', () => {
  const game = selectVow();
  const serialized = serializeRun(game);
  assert.equal(JSON.parse(serialized).state.bloodVow, true);
  const resumed = new ShanhaiGame(content, parseRunSave(content, serialized));
  assert.equal(resumed.state.bloodVow, true);
  assert.ok(resumed.state.talents.RKF03.includes(VOW));

  const reference = hpReference(resumed);
  resumed.state.hp = Math.min(resumed.stats.max_hp, resumed.state.hp) - 20;
  resumed.state.phase = 'shop';
  resumed.state.coins = 100;
  resumed.state.shop = [
    { id: 'recovery', kind: 'recovery', price: 15, sold: false },
    { id: 'preparation', kind: 'preparation', price: 12, sold: false },
    { id: 'talent_reset', kind: 'talent_reset', price: 40, sold: false },
  ];
  const hpBefore = resumed.state.hp;
  const coinsBefore = resumed.state.coins;
  const beforeFailedBuy = structuredClone(resumed.state);
  assert.equal(resumed.shopPurchaseAvailability('recovery').available, false);
  assert.throws(() => resumed.dispatch({ type: 'buy', id: 'recovery' }), /blood-vow-blocks-healing/);
  assert.deepEqual(resumed.state, beforeFailedBuy, 'failed recovery purchase is atomic');
  assert.equal(resumed.state.hp, hpBefore);
  assert.equal(resumed.state.coins, coinsBefore);

  const resetItem = resumed.state.shop.find(item => item.id === 'talent_reset');
  assert.equal(resumed.shopPurchaseAvailability('talent_reset').available, true);
  resumed.dispatch({ type: 'buy', id: 'talent_reset' });
  assert.equal(resumed.state.bloodVow, true);
  assert.equal(resumed.state.talents.RKF03.includes(VOW), false);
  assert.equal(resumed.state.phase, 'talent');
  const replacement = resumed.availableTalents().find(talent => talent.id !== VOW);
  assert.ok(replacement);
  resumed.dispatch({ type: 'talent', id: replacement.id });
  assert.equal(resetItem.sold, true, 'reset item in the live state was consumed');
  assert.equal(resumed.state.bloodVow, true, 'washing out the talent cannot remove its run cost');
  assert.equal(resumed.state.method, 'RKF03');
  resumed.state.phase = 'rest';
  const beforeFailedRest = structuredClone(resumed.state);
  assert.equal(resumed.restChoiceAvailability('heal').available, false);
  assert.throws(() => resumed.dispatch({ type: 'rest', choice: 'heal' }), /blood-vow-blocks-healing/);
  assert.deepEqual(resumed.state, beforeFailedRest, 'unavailable rest healing is atomic');
  assert.equal(resumed.restChoiceAvailability('preparation').available, true);

  // A real event option that only restores HP remains selectable so a full
  // inventory cannot strand the run; its healing is still blocked.
  resumed.state.phase = 'event';
  resumed.state.step = 0;
  resumed.state.nodes = [{ type: 'E', id: 'RE001', completed: false }];
  const healOption = content.byId.RE001.options.find(option => option.id === 'RE001-A');
  assert.equal(resumed.optionAvailability(healOption).available, true);
  resumed.dispatch({ type: 'event', id: 'RE001-A' });
  assert.equal(resumed.state.hp, hpBefore);
  assert.match(resumed.state.resultText, /气血无法恢复/);
  resumed.state.phase = 'event';

  resumed.state.nodes = [{ type: 'E', id: 'RE004', completed: false }];
  resumed.state.eventOption = undefined;
  const coinOption = content.byId.RE004.options.find(option => option.id === 'RE004-C');
  const coinsBeforeEvent = resumed.state.coins;
  assert.equal(resumed.optionAvailability(coinOption).available, true);
  resumed.dispatch({ type: 'event', id: 'RE004-C' });
  assert.ok(resumed.state.coins > coinsBeforeEvent);
  assert.equal(resumed.state.hp, hpBefore);

  // RKF08 normally refunds some paid event HP. The permanent vow suppresses
  // that healing, while the authored health cost remains in force.
  resumed.state.method = 'RKF08';
  resumed.state.ownedMethods.push('RKF08');
  resumed.state.talents.RKF08 = [];
  resumed.state.hp = resumed.stats.max_hp;
  resumed.state.phase = 'event';
  resumed.state.eventOption = undefined;
  resumed.state.nodes = [{ type: 'E', id: 'RE021', completed: false }];
  const paidOption = content.byId.RE021.options.find(option => option.id === 'RE021-A');
  const paidBefore = resumed.state.hp;
  assert.equal(resumed.optionAvailability(paidOption).available, true);
  resumed.dispatch({ type: 'event', id: 'RE021-A' });
  near(paidBefore - resumed.state.hp, 0.15 * reference);
  assert.equal(resumed.state.bloodVow, true);

  // Simulate the normal rest-swap completion boundary. RKF03's node_complete
  // heal and an already queued deferred HP grant are both suppressed.
  resumed.state.method = 'RKF03';
  resumed.state.talents.RKF03 = [replacement.id];
  resumed.state.talents.RKF08 = [];
  resumed.state.ownedMethods = ['RKF03', 'RKF02', 'RKF08'];
  resumed.state.method = 'RKF03';
  resumed.state.n = 1;
  resumed.state.hp = resumed.stats.max_hp - 20;
  resumed.state.nodes = [{ type: 'R', id: 'rest-fixture', completed: false }];
  resumed.state.step = 0;
  resumed.state.nodeEntry = { method: 'RKF03', talents: [replacement.id], artifacts: [] };
  resumed.state._nodeEntry = structuredClone(resumed.state.nodeEntry);
  resumed.state._pendingTravelResources = { delayedHp: 40 };
  resumed.state._pendingTravelResourceKinds = { delayedHp: 'hp' };
  resumed.state.phase = 'rest';
  assert.equal(resumed.restChoiceAvailability('swap_method', 'RKF02').available, true);
  const beforeSwap = resumed.state.hp;
  resumed.dispatch({ type: 'rest', choice: 'swap_method', method: 'RKF02' });
  assert.equal(resumed.state.method, 'RKF02');
  assert.equal(resumed.state.bloodVow, true);
  assert.ok(resumed.state.hp <= beforeSwap, 'method swap and node completion cannot restore HP');
  assert.deepEqual(resumed.state._pendingTravelResources, {});
});

test('legacy buildVersion 5 saves default the missing marker to false and retain frozen first-tier offers', () => {
  const game = ShanhaiGame.create(content, {
    seed: 'blood-vow-legacy-draft',
    name: '旧档试炼者',
    method: 'RKF01',
  });
  game.state.n = 1;
  game.state.xp = content.rules.cultivation.cumulative[0];
  game.state.phase = 'talent';
  const key = 'RKF01:1:0';
  const oldDraft = oldFirstTierDraft(game.state.seed, key);
  game.state.talentDrafts[key] = oldDraft;
  game.state._talentQueue = [{ method: 'RKF01', tier: 1, advance: false }];
  game.state._returnPhase = 'map';

  const oldRecord = JSON.parse(serializeRun(game));
  oldRecord.state.buildVersion = 5;
  delete oldRecord.state.bloodVow;
  const restored = new ShanhaiGame(content, parseRunSave(content, JSON.stringify(oldRecord)));
  assert.equal(restored.state.bloodVow, false);
  assert.equal(restored.state.buildVersion, 5);
  assert.deepEqual(restored.availableTalents().map(talent => talent.id), oldDraft);
  restored.dispatch({ type: 'talent', id: oldDraft[0] });
  assert.equal(restored.state.bloodVow, false);
});

test('the vow blocks healing without cancelling health loss or exposing a hidden event result', () => {
  const game = selectVow('blood-vow-hidden');
  game.state.hp = game.stats.max_hp - 30;
  const beforeLoss = game.state.hp;
  game.applyResource('hp', -7);
  assert.equal(game.state.hp, beforeLoss - 7, 'negative HP resource changes still apply');
  game.applyResource('hp', 7);
  assert.equal(game.state.hp, beforeLoss - 7, 'positive HP resource changes are blocked');

  game.state.phase = 'event';
  game.state.step = 0;
  game.state.nodes = [{ type: 'E', id: 'RE001', completed: false }];
  const option = content.byId.RE001.options.find(item => item.id === 'RE001-A');
  const oldReveal = option.reveal;
  option.reveal = 'hint';
  try {
    const beforeChoice = game.state.hp;
    assert.equal(game.optionAvailability(option).available, true, 'hidden results do not disable the choice');
    game.dispatch({ type: 'event', id: option.id });
    assert.equal(game.state.hp, beforeChoice);
    assert.match(game.state.resultText, /气血无法恢复/);
    assert.equal(game.state.eventStoryEcho, undefined, 'do not record an authored recovery that did not happen');
  } finally {
    if (oldReveal === undefined) delete option.reveal;
    else option.reveal = oldReveal;
  }
});

test('a full travel artifact cannot strand the player at a healing event', () => {
  const game = selectVow('blood-vow-full-event');
  game.state.act = 2;
  game.state.phase = 'event';
  game.state.step = 0;
  game.state.nodes = [{ type: 'E', id: 'RE010', completed: false }];
  game.state.artifacts = [{ id: 'RC17', stacks: content.byId.RC17.max_stacks }];
  const event = content.byId.RE010;
  assert.equal(game.optionAvailability(event.options.find(option => option.id === 'RE010-B')).available, false);
  const healingChoice = event.options.find(option => option.id === 'RE010-A');
  assert.equal(game.optionAvailability(healingChoice).available, true);
  const before = game.state.hp;
  game.dispatch({ type: 'event', id: healingChoice.id });
  assert.equal(game.state.hp, before);
  assert.match(game.state.resultText, /气血无法恢复/);
  assert.equal(game.state.phase, 'event_result');
});

test('continuing and reloading a real battle replays the vow loadout and RNG exactly', () => {
  const game = selectVow('blood-vow-replay');
  const normalNode = game.availableNodes().find(node => node.type === 'C');
  assert.ok(normalNode);
  game.dispatch({ type: 'enter', id: normalNode.key });
  game.dispatch({ type: 'fight' });
  assert.equal(game.state.phase, 'battle');
  assert.deepEqual(game.state.battleInput.player.talents, [VOW]);

  const input = game.state.battleInput;
  input.roundLimit = 1;
  game.state.battle = simulateBattle(game.content, input.player, input.enemy, input.seed, {
    roundLimit: 1,
    artifactAwakenings: true,
  });
  assert.equal(game.state.battle.outcome, 'draw');
  const saved = serializeRun(game);
  assert.equal(JSON.parse(saved).replay, 'deterministic-input-v1');
  const resumed = new ShanhaiGame(content, parseRunSave(content, saved));
  assert.deepEqual(resumed.state.battle, game.state.battle);

  resumed.dispatch({ type: 'continue_battle' });
  assert.equal(resumed.state.battleInput.roundLimit, 2);
  assert.equal(resumed.state.battle.outcome, 'draw');
  const continued = serializeRun(resumed);
  const reloaded = new ShanhaiGame(content, parseRunSave(content, continued));
  assert.deepEqual(reloaded.state.battleInput, resumed.state.battleInput);
  assert.deepEqual(reloaded.state.battle, resumed.state.battle);
  assert.equal(reloaded.state.bloodVow, true);
});

test('a real paired companion output is accepted, saved, and replayed', () => {
  const game = selectVow('blood-vow-companion');
  game.state.ownedMethods.push('RKF06');
  game.state.talents.RKF06 = [];
  game.state.hp = Math.max(1, game.stats.max_hp - 60);
  const node = game.availableNodes().find(candidate => candidate.type === 'C');
  assert.ok(node);
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  const result = game.state.battle;
  assert.ok(result.frames.some(frame => frame.kind === 'reaction' && frame.cue?.kind === 'companion_assist'));
  assert.ok(result.frames.some(frame => frame.kind === 'status' &&
    frame.source === 'RKF06-COMPANION-ASSIST' && frame.cue?.kind === 'companion_assist'));
  const restored = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
  assert.deepEqual(restored.state.battle, result);
});
