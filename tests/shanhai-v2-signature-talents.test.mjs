import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { simulateBattle, tribulationRatio } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { calculateStats } from '../build/shanhai/combat.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

function player(method, talents, baseStats = {}, extra = {}) {
  return {
    name: '行者', method, n: 4, talents, artifacts: [],
    baseStats: { attack: 225, defense: 180, max_hp: 950, crit_rate: 0.1, speed: 10, ...baseStats },
    ...extra,
  };
}

function enemyOf(id) {
  const e = content.byId[id];
  return { name: e.name, id: e.id, method: e.method, n: e.n, talents: e.talents, artifacts: e.artifacts, baseStats: e.stats };
}

function dummy(baseStats = {}) {
  return { name: '木人', method: 'RKF01', n: 0, talents: [], artifacts: [],
    baseStats: { attack: 0, defense: 0, max_hp: 1_000_000, crit_rate: 0, speed: 1, ...baseStats } };
}

const sources = (result, id) => result.frames.filter(frame => frame.source === id);

test('every method has exactly one authored rule-bending signature talent', () => {
  const expected = {
    RKF01: ['RKF01-J4-A', 'shield_overflow_strike'],
    RKF02: ['RKF02-J4-A', 'rage_overflow_strike'],
    RKF03: ['RKF03-J4-B', 'cheat_death'],
    RKF04: ['RKF04-J4-B', 'burn_detonate'],
    RKF05: ['RKF05-J4-C', 'clear_mind'],
    RKF06: ['RKF06-J4-C', 'poison_backlash'],
    RKF07: ['RKF07-J4-A', 'heaven_bolt'],
    RKF08: ['RKF08-J4-C', 'eclipse_siphon'],
    RKF09: ['RKF09-J4-C', 'solar_crit'],
    RKF10: ['RKF10-J4-C', 'dragon_breath'],
  };
  for (const [method, [talentId, kind]] of Object.entries(expected)) {
    const talents = content.byId[method].talents.filter(talent =>
      talent.effects.some(effect => typeof effect.params?.signature === 'string'));
    assert.deepEqual(talents.map(talent => talent.id), [talentId], method);
    assert.equal(talents[0].effects[0].params.signature, kind);
    assert.match(talents[0].name, /^[一-鿿]{4}$/);
  }
});

test('盈盾化雷 lowers the shield cap and turns the overflow into damage instead of hoarding', () => {
  const tank = player('RKF01', ['RKF01-J1-A', 'RKF01-J2-C', 'RKF01-J3-B', 'RKF01-J4-A'], { defense: 2000 });
  const result = simulateBattle(content, tank, enemyOf('EN-A3-L2'), 'sig-overflow', { roundLimit: 4 });
  const sig = content.byId.RKF01.talents.find(t => t.id === 'RKF01-J4-A').effects[0].params;
  const cap = result.frames[0].player.maxHp * sig.shield_cap_ratio;
  assert.ok(result.frames.every(frame => frame.player.shield <= cap + 1e-6), 'shield never exceeds the lowered cap');
  const strikes = sources(result, 'RKF01-J4-A-OVERFLOW-STRIKE').filter(frame => frame.kind === 'damage');
  assert.ok(strikes.length > 0, 'overflowing shield strikes the enemy');
  assert.ok(strikes.every(frame => frame.actor === 'player' && frame.target === 'enemy'));
});

test('怒溢成锋 converts round-end rage past the cap into strikes', () => {
  const result = simulateBattle(content, player('RKF02', ['RKF02-J1-B', 'RKF02-J2-A', 'RKF02-J3-A', 'RKF02-J4-A']),
    enemyOf('EN-A3-L2'), 'sig-rage', { roundLimit: 6 });
  assert.ok(sources(result, 'RKF02-J4-A-OVERFLOW-STRIKE').some(frame => frame.kind === 'damage'));
  const without = simulateBattle(content, player('RKF02', ['RKF02-J1-B', 'RKF02-J2-A', 'RKF02-J3-A']),
    enemyOf('EN-A3-L2'), 'sig-rage', { roundLimit: 6 });
  assert.equal(sources(without, 'RKF02-J4-A-OVERFLOW-STRIKE').length, 0);
});

test('生死回春 prevents exactly the first lethal blow of each battle', () => {
  const fragile = player('RKF03', ['RKF03-J1-A', 'RKF03-J2-A', 'RKF03-J3-A', 'RKF03-J4-B'], { max_hp: 300, defense: 0 });
  const killer = { ...enemyOf('EN-A4-L2') };
  const result = simulateBattle(content, fragile, killer, 'sig-cheat', { roundLimit: 20 });
  const saves = sources(result, 'RKF03-J4-B-CHEAT-DEATH').filter(frame => frame.kind === 'heal');
  assert.equal(saves.length, 1, 'triggers once');
  assert.ok(saves[0].player.hp > 1, 'blooms back above 1 HP');
});

test('焚身成炎 detonates capped burn into a single burst and clears it', () => {
  const result = simulateBattle(content, player('RKF04', ['RKF04-J1-A', 'RKF04-J2-A', 'RKF04-J3-C', 'RKF04-J4-B']),
    dummy(), 'sig-burn', { roundLimit: 10 });
  const bursts = sources(result, 'RKF04-J4-B-DETONATE');
  const blast = bursts.find(frame => frame.kind === 'damage');
  assert.ok(blast && blast.amount > 0, 'a detonation damage frame exists');
  assert.equal(blast.enemy.statuses.burn ?? 0, 0, 'burn is consumed by the blast');
});

test('剑心通明 raises crits only once sword intent is built', () => {
  const critShare = talents => {
    let crits = 0, hits = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const result = simulateBattle(content, player('RKF05', talents, { crit_rate: 0.05 }), dummy(), `sig-sword-${seed}`, { roundLimit: 6 });
      for (const frame of result.frames) {
        if (frame.kind !== 'damage' || frame.actor !== 'player') continue;
        hits += 1;
        if (/暴击/.test(frame.text)) crits += 1;
      }
    }
    return crits / hits;
  };
  const base = ['RKF05-J1-B', 'RKF05-J2-A', 'RKF05-J3-A'];
  assert.ok(critShare([...base, 'RKF05-J4-C']) > critShare(base) + 0.05);
});

test('天劫 sudden death ends stalemates: no battle outlives the escalating tribulation', () => {
  assert.equal(tribulationRatio(content, 11), 0);
  assert.ok(tribulationRatio(content, 12) > 0);
  assert.ok(tribulationRatio(content, 20) > tribulationRatio(content, 12));
  // Two immortal-looking walls of HP that cannot hurt each other.
  const wall = baseStats => ({ name: '石壁', method: 'RKF03', n: 0, talents: [], artifacts: [],
    baseStats: { attack: 1, defense: 10_000, max_hp: 5_000, crit_rate: 0, speed: 10, ...baseStats } });
  const result = simulateBattle(content, wall(), wall({ speed: 9 }), 'sig-tribulation');
  assert.notEqual(result.outcome, 'draw');
  assert.ok(result.rounds <= 40, `ended by round ${result.rounds}`);
  assert.ok(result.frames.some(frame => frame.source === 'RULES-TRIBULATION'));
});

test('百战封侯 trophy bonus is capped', () => {
  const trophy = content.rules.insights.find(talent => talent.id === 'V2-J4-B').effects[0].params;
  assert.ok(trophy.trophy_cap > 0 && trophy.trophy_cap <= 1);
  assert.ok(trophy.elite_bonus * 20 > trophy.trophy_cap, 'the cap binds for long runs');
});

test('战后调息 recovers a share of missing HP after a won map battle, never past max', () => {
  registerCombatWorker({
    calculateStats,
    simulateBattle(_content, playerLoadout) {
      return { outcome: 'player', rounds: 1, playerHp: playerLoadout.hp, enemyHp: 0, frames: [], contributions: [] };
    },
  });
  const game = ShanhaiGame.create(content, { seed: 'victory-recovery', name: '行者', method: 'RKF01' });
  const node = game.availableNodes().find(candidate => candidate.type === 'C');
  const max = game.stats.max_hp;
  game.state.hp = max * 0.5;
  game.dispatch({ type: 'enter', id: node.key });
  game.dispatch({ type: 'fight' });
  game.dispatch({ type: 'battle_done' });
  const ratio = content.rules.economy.victory_recovery.C;
  assert.ok(Math.abs(game.state.hp - (max * 0.5 + max * 0.5 * ratio)) < 1e-6);
  assert.ok(game.state.hp < max);
});

test('advanced signatures fire in real battles', () => {
  const enemy = enemyOf('EN-A3-L2');
  const fired = (method, talent, effectId, predicate = frame => frame.source === effectId) => {
    let count = 0;
    for (let seed = 0; seed < 6; seed += 1) {
      const result = simulateBattle(content, player(method, [`${method}-J1-A`, `${method}-J2-A`, `${method}-J3-A`, talent]), enemy, `adv-${seed}`);
      count += result.frames.filter(predicate).length;
    }
    return count;
  };
  assert.ok(fired('RKF06', 'RKF06-J4-C', 'RKF06-J4-C-BACKLASH') > 0, '蛊毒反噬');
  assert.ok(fired('RKF07', 'RKF07-J4-A', 'RKF07-J4-A-HEAVEN-BOLT') > 0, '雷引千钧');
  assert.ok(fired('RKF09', 'RKF09-J4-C', '', frame => frame.kind === 'dot' && frame.actor === 'player' && /暴击灼烧/.test(frame.text)) > 0, '金乌普照');
  assert.ok(fired('RKF10', 'RKF10-J4-C', 'RKF10-J4-C-DRAGON-BREATH') > 0, '昼夜同天');
});

test('月蚀夺魄 scales attack with the debuffs on the enemy', () => {
  const firstBasicAfterDebuff = talents => simulateBattle(content, player('RKF08', talents, { crit_rate: 0 }), dummy(), 'eclipse', { roundLimit: 2 })
    .frames.filter(frame => frame.kind === 'damage' && frame.source === 'RKF08-BASIC-DAMAGE')[1];
  const plain = firstBasicAfterDebuff(['RKF08-J1-A', 'RKF08-J2-A', 'RKF08-J3-A', 'RKF08-J4-B']);
  const eclipse = firstBasicAfterDebuff(['RKF08-J1-A', 'RKF08-J2-A', 'RKF08-J3-A', 'RKF08-J4-C']);
  const stacks = (plain.enemy.statuses.weakness ?? 0) + (plain.enemy.statuses.armor_break ?? 0);
  assert.ok(stacks > 0);
  assert.ok(eclipse.amount > plain.amount * 1.02, `${eclipse.amount} vs ${plain.amount}`);
});
