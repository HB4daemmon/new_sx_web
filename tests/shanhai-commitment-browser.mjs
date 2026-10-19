import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/tools/browser-tools/node_modules/playwright');
const loaded = await loadContent();
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);
const reportDir = path.resolve(process.env.BROWSER_REPORT_DIR || 'verification/shanhai/commitments');
const saveKey = 'suishi-shanhai-run-v1';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const checks = [];
await mkdir(reportDir, { recursive: true });

async function state(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)).state, saveKey);
}

async function click(page, action, suffix = '') {
  await page.locator(`[data-action="${action}"]${suffix}:visible`).first().click();
}

async function checkLayout(page, label) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    document: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    body: document.body.scrollWidth,
    map: document.querySelector('.view-journey.phase-map .map-scroll')?.getBoundingClientRect().toJSON(),
    notice: document.querySelector('.view-journey.phase-map .inline-notice')?.getBoundingClientRect().toJSON(),
    nav: document.querySelector('.view-journey.phase-map .bottom-nav')?.getBoundingClientRect().toJSON(),
    terms: [...document.querySelectorAll('.event-commitment-terms, .journey-commitment, .commitment-warning')]
      .filter(element => element.getBoundingClientRect().width)
      .map(element => ({
        client: element.clientWidth, scroll: element.scrollWidth,
        left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      })),
  }));
  assert.ok(geometry.document <= geometry.width + 1, label);
  assert.ok(geometry.body <= geometry.width + 1, label);
  if (geometry.map) {
    assert.ok(geometry.documentHeight <= geometry.height + 1, `${label}: full-height map overflow`);
    assert.ok(geometry.map.height >= geometry.height * 0.45, `${label}: map collapsed`);
    if (geometry.notice) {
      assert.ok(geometry.map.bottom <= geometry.notice.top + 1, `${label}: notice overlaps map`);
      if (geometry.nav?.height) assert.ok(geometry.notice.bottom <= geometry.nav.top + 1, `${label}: notice overlaps nav`);
    }
  }
  for (const item of geometry.terms) {
    assert.ok(item.scroll <= item.client + 1 && item.left >= 0 && item.right <= geometry.width, label);
  }
  assert.equal(await page.locator('[role="alert"]:visible').count(), 0, label);
  checks.push({ label, geometry });
}

async function fixture(page, eventId) {
  await page.evaluate(async ({ eventId, content }) => {
    const [{ ShanhaiGame }, { saveRun }] = await Promise.all([
      import('/shanhai/run.js'), import('/shanhai/persistence.js'),
    ]);
    localStorage.clear();
    const game = ShanhaiGame.create(content, { seed: 'commitment-run', name: '行旅约定', method: 'RKF02' });
    game.dispatch({ type: 'enter', id: game.availableNodes()[0].key });
    game.dispatch({ type: 'fight' });
    game.dispatch({ type: 'battle_done' });
    game.dispatch({ type: 'reward', id: null });
    while (game.state.phase === 'talent') game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
    const node = game.availableNodes().find(node => node.type === 'E');
    game.state.routeMap.nodes.find(candidate => candidate.key === node.key).id = eventId;
    game.dispatch({ type: 'enter', id: node.key });
    saveRun(game);
  }, { eventId, content });
  await page.reload({ waitUntil: 'networkidle' });
  try {
    await page.locator('.phase-event').waitFor();
  } catch (error) {
    console.error(`Fixture ${eventId}: ${await page.locator('body').innerText()}`);
    throw error;
  }
}

// These fixtures use real combat and settlement; the general journey suite covers each combat UI action.
async function progress(page, count, pendingDelivery = false) {
  await page.evaluate(async ({ count, pendingDelivery, saveKey, content }) => {
    const [{ ShanhaiGame }, { saveRun, parseRunSave }] = await Promise.all([
      import('/shanhai/run.js'), import('/shanhai/persistence.js'),
    ]);
    const game = new ShanhaiGame(content, parseRunSave(content, localStorage.getItem(saveKey)));
    const target = game.state.history.length + count;
    for (let guard = 0; guard < 80; guard++) {
      if (game.state.phase === 'map' && game.state.history.length >= target && !pendingDelivery) break;
      if (pendingDelivery && game.state.history.length >= target && game.state.phase === 'event_result') break;
      switch (game.state.phase) {
        case 'map': {
          const node = game.availableNodes().find(node => node.type === 'C') ??
            game.availableNodes().find(node => node.type === 'E');
          if (!node) throw new Error('No safe route in commitment fixture');
          if (node.type === 'E') game.state.routeMap.nodes.find(candidate => candidate.key === node.key).id = 'RE006';
          game.dispatch({ type: 'enter', id: node.key });
          break;
        }
        case 'preview': game.dispatch({ type: 'fight' }); break;
        case 'battle': game.dispatch({ type: 'battle_done' }); break;
        case 'reward': game.dispatch({ type: 'reward', id: null }); break;
        case 'talent': game.dispatch({ type: 'talent', id: game.availableTalents()[0].id }); break;
        case 'event': {
          const option = content.byId[game.node.id].options.findLast(option =>
            !option.commitment && !option.encounter &&
            !option.rewards.some(reward => ['swap_method', 'method'].includes(reward.type)) &&
            game.optionAvailability(option).available);
          game.dispatch({ type: 'event', id: option.id });
          break;
        }
        case 'event_result': game.dispatch({ type: 'continue' }); break;
        default: throw new Error(`Unexpected commitment fixture phase: ${game.state.phase}`);
      }
    }
    if (pendingDelivery && game.state.phase !== 'event_result') throw new Error('Delivery fixture did not stop');
    saveRun(game);
  }, { count, pendingDelivery, saveKey, content });
  await page.reload({ waitUntil: 'networkidle' });
}

try {
  for (const viewport of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.BROWSER_URL || 'http://localhost:4173/', { waitUntil: 'networkidle' });
    await fixture(page, 'RE001');
    const option = page.locator('[data-action="event"][data-id="RE001-C"]');
    assert.match(await option.innerText(), /3处后/);
    assert.match(await option.innerText(), /不进休整/);
    assert.match(await option.innerText(), /失约不退费/);
    await checkLayout(page, `${viewport.width}-event-terms`);
    await page.screenshot({ path: path.join(reportDir, `${viewport.width}-terms.png`), fullPage: true, animations: 'disabled' });
    const before = await state(page);
    await option.click();
    let current = await state(page);
    assert.equal(current.coins, before.coins - 12);
    assert.equal(current.eventCommitments[0].remaining, 3);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal((await state(page)).eventCommitments[0].remaining, 3);
    await click(page, 'continue');
    await click(page, 'tab', '[data-id="karma"]');
    assert.match(await page.locator('.journey-commitment').innerText(), /余 3 处/);
    await checkLayout(page, `${viewport.width}-active-ledger`);
    await click(page, 'tab', '[data-id="journey"]');
    await progress(page, 1);
    const rest = (await state(page)).routeMap.nodes.find(node => node.type === 'R');
    const savedBeforePreview = await page.evaluate(key => localStorage.getItem(key), saveKey);
    await click(page, 'preview-node', `[data-id="${rest.key}"]`);
    assert.match(await page.locator('.commitment-warning').innerText(), /中止「护送药箱」/);
    await checkLayout(page, `${viewport.width}-break-warning`);
    await page.screenshot({ path: path.join(reportDir, `${viewport.width}-warning.png`), fullPage: true, animations: 'disabled' });
    await click(page, 'modal-close');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), savedBeforePreview);
    await progress(page, 1, true);
    assert.equal((await state(page)).eventCommitments[0].remaining, 1);
    await click(page, 'continue');
    await page.locator('.inline-notice').waitFor();
    assert.match(await page.locator('.inline-notice').innerText(), /药箱送达/);
    await checkLayout(page, `${viewport.width}-delivery-notice-map`);
    await page.screenshot({ path: path.join(reportDir, `${viewport.width}-delivery-map.png`), animations: 'disabled' });
    current = await state(page);
    assert.equal(current.eventCommitments[0].status, 'fulfilled');
    assert.equal(current.artifacts.find(item => item.id === 'RC17').stacks, 2);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal((await state(page)).artifacts.find(item => item.id === 'RC17').stacks, 2);
    await click(page, 'tab', '[data-id="karma"]');
    assert.match(await page.locator('.journey-commitment').innerText(), /已兑现/);
    await checkLayout(page, `${viewport.width}-fulfilled-ledger`);
    await page.screenshot({ path: path.join(reportDir, `${viewport.width}-fulfilled.png`), fullPage: true, animations: 'disabled' });

    await fixture(page, 'RE001');
    await click(page, 'event', '[data-id="RE001-C"]');
    await click(page, 'continue');
    await progress(page, 1);
    const coins = (await state(page)).coins;
    await click(page, 'preview-node', `[data-id="${rest.key}"]`);
    await click(page, 'confirm-node');
    assert.equal((await state(page)).eventCommitments[0].status, 'broken');
    assert.equal((await state(page)).coins, coins);
    await checkLayout(page, `${viewport.width}-broken`);

    await fixture(page, 'RE002');
    assert.match(await page.locator('[data-id="RE002-B"]').innerText(), /2处后.*不进坊市/);
    await click(page, 'event', '[data-id="RE002-B"]');
    await click(page, 'continue');
    await progress(page, 2);
    current = await state(page);
    assert.equal(current.eventCommitments[0].status, 'fulfilled');
    assert.equal(current.artifacts.find(item => item.id === 'RC19').stacks, 2);
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({ ok: true, checks }, null, 2) + '\n');
  console.log(`Commitment browser checks passed: ${checks.length}`);
} finally {
  await browser.close();
}
