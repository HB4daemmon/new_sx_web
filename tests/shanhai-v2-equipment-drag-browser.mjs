import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4178/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const pageErrors = [];
const consoleErrors = [];

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
      // Keep looking for the preinstalled browser harness module.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';

async function installLegalFixture(page, scenario = 'five-slots') {
  return page.evaluate(async ({ saveKey, replayKey, scenario }) => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const { ShanhaiGame, registerCombatWorker, validateRunState } = run;
    const { calculateStats } = combat;
    const { saveRun } = persistence;
    registerCombatWorker({
      calculateStats,
      simulateBattle(_content, player, enemy) {
        const playerStats = calculateStats(content, player);
        return {
          outcome: 'player',
          rounds: 1,
          playerHp: player.hp ?? playerStats.max_hp,
          enemyHp: 0,
          frames: [],
          contributions: [],
        };
      },
    });

    // Clearly labeled, legally validated fixture: use authored equipable artifacts,
    // then validate the five-slot state before saving it for the browser UI.
    const equipable = content.entities.filter(entity =>
      entity.kind === 'artifact' && ['core', 'support'].includes(entity.equipment_role));
    if (equipable.length < 6) throw new Error('Five-slot fixture needs six authored equipable artifacts');
    const ids = equipable.slice(0, 6).map(entity => entity.id);
    const rewardScenario = scenario === 'reward-four';
    const occupiedCount = rewardScenario ? 4 : 5;
    const ownedCount = rewardScenario ? 4 : 6;
    const game = ShanhaiGame.create(content, {
      seed: `v2-five-slots-${scenario}`,
      name: '五格装备验收',
      method: 'RKF01',
    });
    game.state.artifacts = ids.slice(0, ownedCount).map(id => ({ id, stacks: 1 }));
    game.state.equipment.slots = ids.slice(0, occupiedCount);
    game.state.hp = 1;
    game.state.coins = 80;

    if (scenario === 'preview' || scenario === 'battle' || rewardScenario) {
      const node = game.availableNodes().find(candidate => candidate.type === 'C');
      if (!node) throw new Error('Five-slot fixture has no reachable common battle');
      game.dispatch({ type: 'enter', id: node.key });
      if (game.state.phase !== 'preview') throw new Error('Fixture did not reach battle preview');
      if (scenario === 'battle' || rewardScenario) {
        game.dispatch({ type: 'fight' });
        if (game.state.phase !== 'battle') throw new Error('Fixture did not enter battle');
        if (rewardScenario) {
          game.dispatch({ type: 'battle_done' });
          if (game.state.phase !== 'reward') throw new Error('Fixture did not reach reward');
          game.state.rewardCandidates = [ids[4]];
        }
      }
    }

    if (typeof game.canChangeEquipment !== 'function') {
      throw new Error('Runtime does not expose equipment phase legality');
    }
    const expectedCanChange = !['preview', 'battle'].includes(game.state.phase);
    if (game.canChangeEquipment() !== expectedCanChange) {
      throw new Error(`Unexpected equipment lock for fixture phase ${game.state.phase}`);
    }
    validateRunState(content, game.state);
    localStorage.removeItem(saveKey);
    localStorage.removeItem(replayKey);
    saveRun(game);
    return { ids, phase: game.state.phase, slots: [...game.state.equipment.slots] };
  }, { saveKey, replayKey, scenario });
}

async function loadFixture(page, scenario) {
  await page.goto(url, { waitUntil: 'networkidle' });
  const fixture = await installLegalFixture(page, scenario);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const game = document.querySelector('.game-page');
    return game && !game.classList.contains('phase-loading');
  });
  return fixture;
}

async function readSave(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, 'Missing V2 run save');
  return JSON.parse(text);
}

async function openBuild(page) {
  if (await page.locator('.game-layout.view-build .equipment-section').count()) return;
  const mobileTab = page.locator('.bottom-nav [data-action="tab"][data-id="build"]');
  const desktopTab = page.locator('.desktop-nav [data-action="tab"][data-id="build"]');
  const tab = await mobileTab.isVisible() ? mobileTab : desktopTab;
  await tab.click();
  await page.locator('.game-layout.view-build .equipment-section').waitFor({ state: 'visible' });
}


async function settle(page) {
  // Let the screen's ink-wipe entrance finish before hit-testing slots.
  await page.waitForFunction(() => document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .every(animation => animation.playState !== 'running'));
}

async function slotIds(page) {
  return page.$$eval('.equipment-slot-grid .equipment-slot', slots =>
    slots.map(slot => slot.querySelector('.equipment-slot-item[data-id]')?.dataset.id || null));
}

async function drag(page, fromSlot, toSlot, { touch = false } = {}) {
  await settle(page);
  const from = await page.locator(`.equipment-slot-grid .equipment-slot[data-slot="${fromSlot}"]`).boundingBox();
  const to = await page.locator(`.equipment-slot-grid .equipment-slot[data-slot="${toSlot}"]`).boundingBox();
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  if (touch) {
    // Pointer events from a touch-like pointer: dispatched on the element tree.
    await page.evaluate(({ start, end }) => {
      const fire = (type, point, target) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
        clientX: point.x, clientY: point.y,
      }));
      const source = document.elementFromPoint(start.x, start.y);
      fire('pointerdown', start, source);
      for (let step = 1; step <= 8; step += 1) {
        const point = { x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 };
        fire('pointermove', point, window);
      }
      fire('pointerup', end, window);
    }, { start, end });
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(start.x + (end.x - start.x) * step / 10, start.y + (end.y - start.y) * step / 10);
    }
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
}

const browser = await chromium.launch({ headless: true, executablePath });
try {
  for (const [width, touch] of [[1440, false], [390, true]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const fixture = await loadFixture(page, 'five-slots');
    await openBuild(page);
    const grid = page.locator('.equipment-slot-grid');
    assert.equal(await grid.getAttribute('data-equipment-drag'), 'enabled', `${width}: drag should be enabled on the map`);
    assert.ok(await page.locator('.equipment-drag-hint').count(), `${width}: missing drag hint`);
    const initial = await slotIds(page);
    assert.deepEqual(initial, fixture.slots);

    // Drag the first artifact to the tail: one batch of adjacent reorder commands.
    await drag(page, 1, 5, { touch });
    const expected = [...initial.slice(1), initial[0]];
    assert.deepEqual(await slotIds(page), expected, `${width}: front→tail drag`);
    assert.deepEqual((await readSave(page)).state.equipment.slots, expected, `${width}: drag must be saved`);
    assert.equal(await page.locator('.modal, .dialog[open], [role="dialog"]').count(), 0,
      `${width}: a drag must not open the artifact inspector`);
    assert.equal(await page.locator('.equipment-drag-ghost').count(), 0, `${width}: ghost should be removed`);

    // Drag back from tail to slot 2.
    await drag(page, 5, 2, { touch });
    const back = [expected[0], expected[4], ...expected.slice(1, 4)];
    assert.deepEqual(await slotIds(page), back, `${width}: tail→2 drag`);

    // A short press without movement is still a click that opens details.
    const box = await page.locator('.equipment-slot-grid .equipment-slot[data-slot="1"] .equipment-slot-item').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    assert.deepEqual(await slotIds(page), back, `${width}: click must not reorder`);
    await page.close();
  }

  // Equipment is locked during battle preview: no drag affordance.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await loadFixture(page, 'preview');
  await openBuild(page);
  assert.equal(await page.locator('.equipment-slot-grid').getAttribute('data-equipment-drag'), 'locked');
  await page.close();
} finally {
  await browser.close();
}

assert.deepEqual(pageErrors, []);
assert.deepEqual(consoleErrors, []);
console.log('Equipment drag reorder browser check passed (desktop mouse + touch pointer, saved, click preserved, locked in preview).');
