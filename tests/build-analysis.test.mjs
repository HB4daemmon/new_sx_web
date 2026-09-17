import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game, SLOT_ORDER, abilityLoadoutSlot, fateOptions} from '../build/engine.js';
import {analyzeAbilityFit, collectBuildSources, compareLoadouts} from '../build/build-analysis.js';

const content = JSON.parse(readFileSync('data/game.json', 'utf8'));

function fresh(race = 'human', origin = 'wanderer', seed = 'BUILD-ANALYSIS') {
  return Game.create(content, seed, origin, fateOptions(content, seed)[0].id, '分析测试', '', race);
}

function equip(game, ids) {
  game.s.slots = Array(8).fill(null);
  for (const id of ids) {
    const ability = content.abilities.find(item => item.id === id);
    const role = abilityLoadoutSlot(ability);
    const index = SLOT_ORDER.findIndex((slot, i) => slot === role && !game.s.slots[i]);
    assert(index >= 0, `no slot for ${id}`);
    game.s.slots[index] = {id, rank: 0};
  }
}

function sourceById(collection, id) {
  return collection.sources.filter(source => source.sourceId === id);
}

test('collectBuildSources keeps concrete target-aware producers and basic rage rules', () => {
  const game = fresh();
  const sources = collectBuildSources(content, game.s);
  const fire = sourceById(sources, 'basic.thunder');
  assert(fire.some(source => source.produces.some(resource => resource.key === 'damage' && resource.target === 'enemy')));
  assert(fire.some(source => source.produces.some(resource => resource.key === 'rage' && resource.target === 'self')));
  assert(sources.sources.some(source => source.sourceId === 'rule.basic-rage' && source.produces.some(resource => resource.key === 'rage' && resource.amount === content.rules.basicRage)));
});

test('basic.fire is independently reachable and produces enemy burn', () => {
  const game = fresh();
  const basicIndex = game.s.slots.findIndex((item, index) => item && SLOT_ORDER[index] === 'basic');
  const fit = analyzeAbilityFit(content, game.s, 'basic.fire', basicIndex);
  assert.equal(fit.status, 'reachable');
  assert(fit.produces.some(resource => resource.status === 'burn' && resource.target === 'enemy'));
  assert.equal(fit.missing.length, 0);
});

test('spirit race is a real burn source, but its one-time amount does not prove ash threshold', () => {
  const game = fresh('spirit');
  const fit = analyzeAbilityFit(content, game.s, 'aux.ash');
  assert.equal(fit.status, 'threshold');
  assert(fit.sources.sources.some(source => source.sourceId === 'race.spirit'));
  const burn = fit.dependencies.find(item => item.resource.key === 'burn' && item.resource.target === 'enemy');
  assert(burn);
  assert.equal(burn.knownAmount, 2);
  assert.equal(burn.threshold, 5);
  assert(burn.producers.some(source => source.id === 'race.spirit'));
});

test('origin, fate, and selected talent sources are included while unselected talents are absent', () => {
  const game = fresh('spirit', 'alchemist');
  game.s.fate = 'fate.guard';
  game.s.talents = ['talent.spirit.fox'];
  const sources = collectBuildSources(content, game.s);
  assert(sources.sources.some(source => source.sourceId === 'origin.alchemist' && source.produces.some(resource => resource.key === 'shield' && resource.target === 'self')));
  assert(sources.sources.some(source => source.sourceId === 'fate.guard' && source.produces.some(resource => resource.key === 'shield' && resource.target === 'self')));
  assert(sources.sources.some(source => source.sourceId === 'talent.spirit.fox' && source.produces.some(resource => resource.status === 'burn' && resource.target === 'enemy')));
  assert(!sources.sources.some(source => source.sourceId === 'talent.spirit.sun'));
});

test('consume-only ash does not self-source burn and target mismatch is not accepted', () => {
  const game = fresh();
  equip(game, ['basic.sword', 'rage.thunder', 'aux.ash']);
  const before = structuredClone(game.s);
  const sources = collectBuildSources(content, game.s);
  const ash = sourceById(sources, 'aux.ash');
  assert(ash.some(source => source.consumes.some(resource => resource.status === 'burn' && resource.target === 'enemy')));
  assert(!ash.some(source => source.produces.some(resource => resource.status === 'burn')));
  const fit = analyzeAbilityFit(content, game.s, 'aux.ash');
  assert.equal(fit.status, 'missing-input');
  assert(fit.missing.some(item => item.resource.status === 'burn' && item.resource.target === 'enemy'));
  assert.deepEqual(game.s, before);
});

test('a payoff that applies burn after reading it cannot prove its own input', () => {
  const game = fresh();
  const rageIndex = game.s.slots.findIndex((item, index) => item && SLOT_ORDER[index] === 'rage');
  const fit = analyzeAbilityFit(content, game.s, 'rage.lotus', rageIndex);
  assert.equal(fit.status, 'missing-input');
  const burn = fit.missing.find(item => item.resource.status === 'burn' && item.resource.target === 'enemy');
  assert(burn);
  assert(!burn.producers.some(source => source.id === 'rage.lotus'));
});

test('requiresTags are checked against the triggering action source, not broad board tags', () => {
  const game = fresh();
  const basicIndex = game.s.slots.findIndex((item, index) => item && SLOT_ORDER[index] === 'basic');
  game.s.slots[basicIndex] = {id: 'basic.fist', rank: 0};
  const fit = analyzeAbilityFit(content, game.s, 'art.path.scale', 2);
  const tagGate = fit.gates.find(gate => gate.kind === 'requires-tags');
  assert.equal(fit.status, 'reachable');
  assert.equal(tagGate?.status, 'reachable');
  assert(fit.sources.events.some(event => event.event === 'on_damage' && event.sourceId === 'basic.fist' && event.tags.includes('counter')));
});

test('event dependencies reject a producer aimed at the wrong fighter', () => {
  const altered = structuredClone(content);
  const fist = altered.abilities.find(item => item.id === 'basic.fist');
  fist.effects.find(effect => effect.type === 'damage').target = 'self';
  const game = Game.create(altered, 'BUILD-TARGET-MISMATCH', 'wanderer', fateOptions(altered, 'BUILD-TARGET-MISMATCH')[0].id, '分析测试', '', 'human');
  game.s.slots = Array(8).fill(null);
  game.s.slots[0] = {id: 'basic.fist', rank: 0};
  const fit = analyzeAbilityFit(altered, game.s, 'art.path.scale', 2);
  const eventGate = fit.gates.find(gate => gate.kind === 'event' && gate.event === 'on_damage');
  assert.equal(eventGate?.status, 'unreachable');
  assert.match(eventGate?.reason ?? '', /目标方/);
  assert.equal(fit.status, 'missing-input');
});

test('full component replacement reports lost and retained concrete producers', () => {
  const game = fresh();
  equip(game, ['basic.fire', 'rage.fire', 'aux.fire', 'aux.ash']);
  const fireIndex = game.s.slots.findIndex(item => item?.id === 'aux.fire');
  const comparison = compareLoadouts(content, game.s, 'aux.stone', fireIndex);
  assert.equal(comparison.outgoing?.id, 'aux.fire');
  assert(comparison.lostSources.some(source => source.id === 'aux.fire'));
  assert(comparison.gainedSources.some(source => source.id === 'aux.stone'));
  assert(comparison.resourceChanges.some(change =>
    change.resource.status === 'burn' &&
    change.lostSources.some(source => source.id === 'aux.fire') &&
    change.remainingSources.some(source => source.id === 'basic.fire'),
  ));
  assert(comparison.retainedSources.some(source => source.id === 'basic.fire'));
});

test('full slot without a placement does not pretend the incoming ability is installed', () => {
  const game = fresh();
  equip(game, ['basic.fire', 'rage.fire', 'aux.fire', 'aux.ash', 'aux.stone', 'aux.guard', 'strategy.fire']);
  const comparison = compareLoadouts(content, game.s, 'aux.last');
  assert.equal(comparison.status, 'replace-required');
  assert.equal(comparison.after.sources.some(source => source.sourceId === 'aux.last'), false);
});
