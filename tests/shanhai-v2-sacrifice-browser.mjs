import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { serializeRun } from '../build/shanhai/persistence.js';

function playwrightModule() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    '/opt/tools/browser-tools/node_modules/playwright',
    '/product/wxq/node_modules/playwright',
    '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Continue through the preinstalled browser harness locations.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const browserUrl = process.env.BROWSER_URL || 'http://localhost:4178/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const loaded = await loadContent();
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);
registerCombatWorker({ calculateStats, simulateBattle });

function makeSacrificeSave(kind, seed) {
  const game = ShanhaiGame.create(content, { seed, name: '立誓行者', method: 'RKF01' });
  const routeMap = game.state.routeMap;
  const target = routeMap.nodes.find(node => node.depth === 1 && node.type === 'E');
  assert.ok(target, 'the generated route includes an event node at depth one');
  target.id = 'RE037';
  const path = [target];
  while (path[0].depth > 0) {
    const parent = routeMap.nodes.find(node => node.next.includes(path[0].key));
    assert.ok(parent, `route path reaches ${path[0].key}`);
    path.unshift(parent);
  }
  routeMap.path = path.map(node => node.key);
  path.forEach((node, index) => { node.completed = index < path.length - 1; });
  game.state.nodes = path.map(node => ({ type: node.type, id: node.id, completed: node.completed }));
  game.state.step = path.length - 1;
  game.state.phase = 'event';
  game.dispatch({ type: 'event', id: `RE037-${kind === 'shattered_core' ? 'A' : 'C'}` });
  game.dispatch({ type: 'continue' });

  const battleNode = game.availableNodes().find(node => ['C', 'L', 'B'].includes(node.type));
  assert.ok(battleNode, 'the event leads to a reachable battle node');
  game.dispatch({ type: 'enter', id: battleNode.key });
  game.dispatch({ type: 'fight' });
  assert.equal(game.state.phase, 'battle');
  if (kind === 'shattered_core') {
    const start = game.state.battle.frames.find(frame => frame.kind === 'start');
    assert.ok(start);
    assert.equal(start.player.maxShield, game.state.permanentRule.originalMaxHp * 2.5);
  } else {
    assert.ok(game.state.battle.frames.some(frame => frame.kind === 'wait' && frame.actor === 'player'));
  }
  return serializeRun(game);
}

async function loadSave(page, serialized) {
  await page.goto(browserUrl, { waitUntil: 'networkidle' });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: saveKey,
    value: serialized,
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-battle .combatant.side-p').waitFor({ state: 'visible' });
}

test('RE037 UI shows its lasting rule, shattered-core shield capacity, and endless-chain wait report', async () => {
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const pageErrors = [];
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    const shatteredSave = makeSacrificeSave('shattered_core', 'sacrifice-ui-shattered');
    const shatteredState = JSON.parse(shatteredSave).state;
    const expectedShield = shatteredState.permanentRule.originalMaxHp * 2.5;
    await loadSave(page, shatteredSave);
    const shatteredRule = page.locator('.combatant.side-p .permanent-rule-state[data-permanent-rule="shattered_core"]');
    await shatteredRule.waitFor({ state: 'visible' });
    assert.match(await shatteredRule.innerText(), /攻击提高 80%/);
    assert.match(await shatteredRule.innerText(), /250%/);
    const shieldValues = (await page.locator('.combatant.side-p .shield-count').innerText())
      .match(/[\d,]+(?:\.\d+)?/g)
      .map(value => Number(value.replaceAll(',', '')));
    assert.deepEqual(shieldValues, [expectedShield, expectedShield]);

    const endlessSave = makeSacrificeSave('endless_chain', 'sacrifice-ui-endless');
    await loadSave(page, endlessSave);
    const endlessRule = page.locator('.combatant.side-p .permanent-rule-state[data-permanent-rule="endless_chain"]');
    await endlessRule.waitFor({ state: 'visible' });
    assert.match(await endlessRule.innerText(), /额外获得 80 怒气/);
    await page.locator('[data-action="battle-skip"]').click();
    await page.locator('[data-action="battle-details"][data-tab="log"]').click();
    const log = page.locator('.battle-detail-dialog .battle-log');
    await log.waitFor({ state: 'visible' });
    assert.match(await log.innerText(), /蓄气等待/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
    await browser.close();
  }
});
