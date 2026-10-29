import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4178/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';
const replayKey = 'suishi-shanhai-replay-v2-overhaul';
const viewports = [360, 390, 430, 1440];
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

async function assertResponsiveBoard(page, width) {
  await openBuild(page);
  const layout = await page.evaluate(() => {
    const board = document.querySelector('.equipment-section');
    const grid = board?.querySelector('.equipment-slot-grid');
    if (!board || !grid) return null;
    const slots = [...grid.querySelectorAll('.equipment-slot')].map(slot => {
      const rect = slot.getBoundingClientRect();
      const item = slot.querySelector('.equipment-slot-item');
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        itemOverflows: Boolean(item && item.scrollWidth > item.clientWidth + 1),
      };
    });
    const gridStyle = getComputedStyle(grid);
    return {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      boardWidth: board.clientWidth,
      boardScrollWidth: board.scrollWidth,
      gridWidth: grid.clientWidth,
      gridScrollWidth: grid.scrollWidth,
      columns: gridStyle.gridTemplateColumns.trim().split(/\s+/).length,
      slots,
      reorderButtonsInBoard: board.querySelectorAll('[data-action="equipment-reorder"]').length,
    };
  });
  assert.ok(layout, `${width}: equipment board is missing`);
  assert.ok(layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1,
    `${width}: page has horizontal overflow ${JSON.stringify(layout)}`);
  assert.ok(layout.boardScrollWidth <= layout.boardWidth + 1 &&
    layout.gridScrollWidth <= layout.gridWidth + 1,
  `${width}: equipment board has horizontal overflow ${JSON.stringify(layout)}`);
  assert.equal(layout.slots.length, 5, `${width}: expected five numbered slots`);
  assert.equal(await page.locator('.equipment-section .section-heading span').innerText(),
    '已装备 5 / 5');
  assert.deepEqual(await page.locator('.equipment-slot-head b').allTextContents(),
    ['装备位 1', '装备位 2', '装备位 3', '装备位 4', '装备位 5']);
  assert.equal(layout.columns, width > 900 ? 5 : 2,
    `${width}: equipment slot grid did not use its responsive column count`);
  assert.equal(layout.reorderButtonsInBoard, 0,
    `${width}: reorder controls should appear only in artifact details`);
  assert.ok(layout.slots.every(slot => slot.width > 0 && !slot.itemOverflows),
    `${width}: equipment slot content overlaps or overflows ${JSON.stringify(layout)}`);
  for (let first = 0; first < layout.slots.length; first++) {
    for (let second = first + 1; second < layout.slots.length; second++) {
      const a = layout.slots[first];
      const b = layout.slots[second];
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      assert.ok(overlapX <= 1 || overlapY <= 1,
        `${width}: equipment slots overlap (${first + 1}, ${second + 1})`);
    }
  }
}

async function openArtifactDetails(page, id) {
  await page.locator(`.equipment-section [data-action="inspect-artifact"][data-id="${id}"]`).click();
  const detail = page.locator('.item-dialog[role="dialog"]');
  await detail.waitFor({ state: 'visible' });
  return detail;
}

async function assertDetailLayout(page, detail, width) {
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector('.item-dialog');
    const actions = dialog?.querySelector('.equipment-detail-actions');
    const controls = actions?.querySelector('.equipment-order-controls');
    const buttons = [...(controls?.querySelectorAll('button') ?? [])].map(button => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
    });
    const dialogRect = dialog?.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      dialogWidth: dialog?.clientWidth,
      dialogScrollWidth: dialog?.scrollWidth,
      dialogLeft: dialogRect?.left,
      dialogRight: dialogRect?.right,
      buttons,
      buttonText: [...(controls?.querySelectorAll('button') ?? [])].map(button => button.innerText.trim()),
    };
  });
  assert.ok(layout.dialogWidth && layout.dialogWidth > 0, `${width}: artifact detail did not render`);
  assert.ok(layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1,
    `${width}: artifact modal causes page overflow ${JSON.stringify(layout)}`);
  assert.ok(layout.dialogScrollWidth <= layout.dialogWidth + 1,
    `${width}: artifact detail overflows horizontally ${JSON.stringify(layout)}`);
  assert.ok(layout.dialogLeft >= -1 && layout.dialogRight <= width + 1,
    `${width}: artifact detail is outside the viewport ${JSON.stringify(layout)}`);
  assert.ok(layout.buttons.length === 2 && layout.buttons.every(button =>
    button.width >= 44 && button.height >= 44),
  `${width}: reorder touch targets are too small ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.buttonText, ['', ''], 'Reorder controls should remain icon-only');
}

async function assertOnlySlotsChanged(page, before, expectedSlots) {
  const after = await readSave(page);
  const unchanged = structuredClone(before.state);
  unchanged.equipment.slots = expectedSlots;
  assert.deepEqual(after.state, unchanged, 'Reordering changed artifact stacks or unrelated run state');
  assert.deepEqual(after.state.equipment.slots, expectedSlots);
  return after;
}

async function assertReorderAndResponsive(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const fixture = await loadFixture(page, 'five-slots');
  assert.equal(fixture.phase, 'map');
  assert.equal(fixture.slots.length, 5);
  const selectedId = fixture.ids[2];
  const initial = await readSave(page);
  assert.deepEqual(initial.state.equipment.slots, fixture.ids.slice(0, 5));

  for (const width of viewports) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await assertResponsiveBoard(page, width);
    const detail = await openArtifactDetails(page, selectedId);
    assert.equal(await detail.locator('.equipment-order-button').count(), 2);
    assert.match(await detail.locator('.equipment-status').innerText(), /已装备 · 装备位 3/);
    assert.ok(await detail.locator('[data-direction="left"]').getAttribute('aria-label'));
    assert.ok(await detail.locator('[data-direction="left"]').getAttribute('title'));
    await assertDetailLayout(page, detail, width);
    await detail.locator('.dialog-close[data-action="modal-close"]').click();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const detail = await openArtifactDetails(page, selectedId);
  let slots = [...initial.state.equipment.slots];
  let before = initial;
  await detail.locator('[data-direction="left"]').click();
  [slots[1], slots[2]] = [slots[2], slots[1]];
  let after = await assertOnlySlotsChanged(page, before, slots);
  before = after;
  assert.match(await page.locator('.item-dialog .equipment-status').innerText(), /装备位 2/);

  await page.locator('.item-dialog [data-direction="left"]').click();
  [slots[0], slots[1]] = [slots[1], slots[0]];
  after = await assertOnlySlotsChanged(page, before, slots);
  before = after;
  assert.equal(await page.locator('.item-dialog [data-direction="left"]').isDisabled(), true,
    'First occupied slot should disable earlier movement');
  assert.match(await page.locator('.item-dialog .equipment-status').innerText(), /装备位 1/);

  for (let index = 0; index < 4; index++) {
    await page.locator('.item-dialog [data-direction="right"]').click();
    [slots[index], slots[index + 1]] = [slots[index + 1], slots[index]];
    after = await assertOnlySlotsChanged(page, before, slots);
    before = after;
  }
  assert.match(await page.locator('.item-dialog .equipment-status').innerText(), /装备位 5/);
  assert.equal(await page.locator('.item-dialog [data-direction="right"]').isDisabled(), true,
    'Last occupied slot should disable later movement');

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page').waitFor({ state: 'visible' });
  await openBuild(page);
  assert.deepEqual((await readSave(page)).state.equipment.slots, slots,
    'Equipment order was not persisted across reload');
  const reloadedDetail = await openArtifactDetails(page, selectedId);
  assert.match(await reloadedDetail.locator('.equipment-status').innerText(), /装备位 5/);
  assert.equal(await reloadedDetail.locator('[data-direction="right"]').isDisabled(), true);
  assert.equal(await reloadedDetail.locator('[data-direction="left"]').isDisabled(), false);
  await reloadedDetail.locator('.dialog-close[data-action="modal-close"]').click();
  await context.close();
}

async function assertReplacementAndAutoEquip(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const replacementFixture = await loadFixture(page, 'five-slots');
  await openBuild(page);
  const hpBefore = (await readSave(page)).state.hp;
  const incomingId = replacementFixture.ids[5];
  await page.locator(`.deck-grid [data-action="inspect-artifact"][data-id="${incomingId}"]`).click();
  await page.locator('.item-dialog [data-action="equipment-equip"]').click();
  const replaceDialog = page.locator('.equipment-replace-dialog[role="dialog"]');
  await replaceDialog.waitFor({ state: 'visible' });
  assert.equal(await replaceDialog.locator('[data-action="equipment-confirm"]').count(), 5,
    'Replacing an item should offer all five occupied positions');
  assert.match(await replaceDialog.innerText(), /装备位 5/);
  const replaceId = replacementFixture.ids[3];
  await replaceDialog.locator(`[data-action="equipment-confirm"][data-replace="${replaceId}"]`).click();
  const replaced = await readSave(page);
  assert.deepEqual(replaced.state.equipment.slots,
    [...replacementFixture.ids.slice(0, 3), incomingId, replacementFixture.ids[4]]);
  assert.equal(replaced.state.hp, hpBefore, 'Replacing an artifact changed current HP');
  assert.ok(replaced.state.artifacts.some(artifact => artifact.id === replaceId),
    'The replaced artifact was not retained in inventory');
  assert.ok(replaced.state.artifacts.some(artifact => artifact.id === incomingId),
    'The incoming artifact was lost');

  const rewardFixture = await loadFixture(page, 'reward-four');
  assert.equal(rewardFixture.phase, 'reward');
  await page.locator(`.reward-card[data-id="${rewardFixture.ids[4]}"]`).waitFor({ state: 'visible' });
  assert.match(await page.locator(`.reward-card[data-id="${rewardFixture.ids[4]}"] .reward-equipment-status`).innerText(),
    /取得后自动装备至空位/);
  await page.locator(`.reward-card[data-id="${rewardFixture.ids[4]}"] [data-action="reward"]`).click();
  const acquired = await readSave(page);
  assert.deepEqual(acquired.state.equipment.slots, rewardFixture.ids.slice(0, 5),
    'The fifth acquired artifact was not equipped into the empty slot');
  await page.locator('.inline-notice[role="status"]').filter({ hasText: /自动装备至装备位 5/ }).waitFor();
  await context.close();
}

async function assertEquipmentLocks(browser, scenario) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const fixture = await loadFixture(page, scenario);
  assert.equal(fixture.phase, scenario);
  await openBuild(page);
  const detail = await openArtifactDetails(page, fixture.ids[0]);
  assert.equal(await detail.locator('.equipment-order-button').count(), 2);
  assert.equal(await detail.locator('.equipment-order-button:not(:disabled)').count(), 0,
    `${scenario}: movement controls should be locked`);
  assert.deepEqual((await readSave(page)).state.equipment.slots, fixture.slots,
    `${scenario}: opening artifact details changed equipment`);
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await assertReorderAndResponsive(browser);
    await assertReplacementAndAutoEquip(browser);
    await assertEquipmentLocks(browser, 'preview');
    await assertEquipmentLocks(browser, 'battle');
    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('\n')}`);
    assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join('\n')}`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
