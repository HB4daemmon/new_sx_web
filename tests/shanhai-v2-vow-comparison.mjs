// Paired deterministic runs, useful for observing this rule rather than estimating player win rates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';
import { nextCommand } from './shanhai-policy.mjs';

const model = await loadContent();
const content = contentFromEntities(model.entities, model.manifest.content_version);
const methods = content.entities.filter(item => item.kind === 'method' && item.acquisition.start);
const pairCount = Number(process.env.VOW_PAIR_COUNT ?? 3);
assert.ok(Number.isInteger(pairCount) && pairCount > 0 && pairCount <= 30);

function findSeeds(method) {
  const result = [];
  for (let index = 0; result.length < pairCount && index < 1000; index++) {
    const seed = `v2-vow-compare-${method}-${index}`;
    const probe = ShanhaiGame.create(content, { seed, name: '对照行者', method });
    probe.state.xp = content.rules.cultivation.cumulative[0];
    if (probe.availableTalents().some(talent => talent.id === 'V2-J1-G')) result.push(seed);
  }
  assert.equal(result.length, pairCount, `not enough offered seeds for ${method}`);
  return result;
}

function play(method, seed, takeVow, preference) {
  let game = ShanhaiGame.create(content, { seed, name: '对照行者', method });
  let selected = false;
  let actions = 0;
  const battles = [];
  while (!['won', 'lost'].includes(game.state.phase) && actions++ < 600) {
    let command = nextCommand(game, preference);
    if (!selected && game.state.phase === 'talent') {
      const choices = game.availableTalents();
      if (choices.some(talent => talent.id === 'V2-J1-G')) {
        command = takeVow
          ? { type: 'talent', id: 'V2-J1-G' }
          : command.id === 'V2-J1-G'
            ? { type: 'talent', id: choices.find(talent => talent.id !== 'V2-J1-G').id }
            : command;
        selected = true;
      }
    }
    game.dispatch(command);
    if (command.type === 'fight') battles.push({
      act: game.state.act,
      node: game.node.id,
      rounds: game.state.battle.rounds,
      outcome: game.state.battle.outcome,
    });
    if (['battle_done', 'event', 'rest', 'buy', 'talent'].includes(command.type)) {
      game = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
    }
  }
  assert.ok(actions < 600, `run exceeded action limit: ${method} ${seed}`);
  return {
    method, seed, takeVow, offeredAndSelected: selected,
    bloodVow: game.state.bloodVow, outcome: game.state.phase,
    act: game.state.act, step: game.state.step, nodes: game.state.history.length,
    actions, battles,
  };
}

const pairs = [];
for (const method of methods) {
  for (const [index, seed] of findSeeds(method.id).entries()) {
    const preference = ['avoid', 'steady', 'tracking'][index % 3];
    const baseline = play(method.id, seed, false, preference);
    const vowed = play(method.id, seed, true, preference);
    assert.equal(baseline.offeredAndSelected, vowed.offeredAndSelected);
    pairs.push({ method: method.id, seed, preference, baseline, vowed });
  }
}
const selectedPairs = pairs.filter(pair => pair.vowed.offeredAndSelected);
const report = {
  description: 'Same-seed, same-route-preference deterministic policy comparison; includes seeds that died before the offer. Not a player win-rate or balance estimate.',
  contentVersion: content.version,
  contentSha256: createHash('sha256').update(JSON.stringify(model.entities)).digest('hex'),
  contentHashInput: 'JSON.stringify of manifest-ordered loaded content entities',
  pairCount: pairs.length,
  reachedOffer: selectedPairs.length,
  baselineWins: pairs.filter(pair => pair.baseline.outcome === 'won').length,
  vowedWins: pairs.filter(pair => pair.vowed.outcome === 'won').length,
  baselineWinsAfterOffer: selectedPairs.filter(pair => pair.baseline.outcome === 'won').length,
  vowedWinsAfterOffer: selectedPairs.filter(pair => pair.vowed.outcome === 'won').length,
  pairs,
};
await mkdir('verification/shanhai/v2', { recursive: true });
await writeFile('verification/shanhai/v2/vow-comparison.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, pairs: undefined }, null, 2));
