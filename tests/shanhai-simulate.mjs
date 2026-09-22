import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { parseRunSave, serializeRun } from '../build/shanhai/persistence.js';
import { nextCommand } from './shanhai-policy.mjs';

export async function simulateRuns(count = 5) {
  const model = await loadContent();
  const content = contentFromEntities(model.entities, model.manifest.content_version);
  const rows = [];
  for (const method of content.entities.filter(item => item.kind === 'method' && item.acquisition.start)) {
    for (let seed = 0; seed < count; seed++) {
      let game = ShanhaiGame.create(content, { seed: `acceptance-${seed}`, name: '回归行者', method: method.id });
      const phases = new Set(), battles = [];
      let steps = 0;
      while (!['won', 'lost'].includes(game.state.phase) && steps++ < 600) {
        phases.add(game.state.phase);
        const command = nextCommand(game, seed % 3 === 0 ? 'avoid' : seed % 3 === 1 ? 'steady' : 'tracking');
        game.dispatch(command);
        if (command.type === 'fight') battles.push({
          act: game.state.act, node: game.node.id, round: game.state.battle.rounds,
          result: game.state.battle.outcome, hpAfter: game.state.battle.playerHp,
        });
        const before = JSON.parse(JSON.stringify(game.state));
        game = new ShanhaiGame(content, parseRunSave(content, serializeRun(game)));
        assert.deepEqual(JSON.parse(JSON.stringify(game.state)), before);
      }
      assert.ok(steps < 600, 'Run did not reach a terminal phase');
      rows.push({
        seed: game.state.seed, method: method.id, result: game.state.phase,
        act: game.state.act, step: game.state.step, nodes: game.state.history.length,
        n: game.state.n, hp: game.state.hp, xp: game.state.xp,
        phases: [...phases], battles,
      });
    }
  }
  return {
    contentVersion: content.version, policy: 'tests/shanhai-policy.mjs',
    note: 'Real combat, unmodified authored numbers, deterministic heuristic decisions. Not a player win rate or a balance approval.',
    total: rows.length, wins: rows.filter(row => row.result === 'won').length,
    byMethod: Object.fromEntries([...new Set(rows.map(row => row.method))].map(id => [id, {
      runs: rows.filter(row => row.method === id).length,
      wins: rows.filter(row => row.method === id && row.result === 'won').length,
      furthestAct: Math.max(...rows.filter(row => row.method === id).map(row => row.act)),
    }])),
    runs: rows,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await simulateRuns(Number(process.env.SIM_SEEDS ?? 5));
  await mkdir('verification/shanhai', { recursive: true });
  await writeFile('verification/shanhai/simulation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ total: report.total, wins: report.wins, byMethod: report.byMethod }, null, 2));
}
