import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const saveKey = 'suishi-shanhai-run-v2-overhaul';

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
      // Check the next installed browser harness.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

async function installGrowthFixture(page) {
  return page.evaluate(async saveKey => {
    const [{ loadContent }, run, combat, persistence] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/combat.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    run.registerCombatWorker({
      calculateStats: combat.calculateStats,
      simulateBattle: combat.simulateBattle,
    });
    const game = run.ShanhaiGame.create(content, {
      seed: 'v2-artifact-growth-browser',
      name: '饕餮鼎吞噬验收',
      method: 'RKF01',
    });
    game.state.phase = 'map';
    game.state.artifacts = [
      { id: 'RL09', stacks: 1 },
      { id: 'RC05', stacks: 3, inscription: 'leech' },
      { id: 'RC07', stacks: 2 },
    ];
    game.state.equipment.slots = ['RL09', 'RC05'];
    game.state.hp = game.stats.max_hp;
    const initialHp = game.state.hp;
    const saved = persistence.saveRun(game);
    localStorage.clear();
    localStorage.setItem(saveKey, JSON.stringify(saved));
    return {
      initialHp,
      cauldronName: content.byId.RL09.name,
      equippedTargetName: content.byId.RC05.name,
      backpackTargetName: content.byId.RC07.name,
    };
  }, saveKey);
}

async function devourMetrics(page) {
  return page.evaluate(() => {
    const selectors = [
      '.cauldron-tool > summary',
      '[data-devour-target]',
      '[data-action="devour"]',
    ];
    return {
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      controls: selectors.map(selector => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        return rect ? {
          selector,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          right: rect.right,
        } : null;
      }).filter(Boolean),
    };
  });
}

const { chromium } = playwrightModule();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.landing-page, .game-page').first().waitFor({ state: 'visible' });
  const fixture = await installGrowthFixture(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });

  await page.locator('[data-action="tab"][data-id="build"]').last().click();
  await page.locator('.game-page.view-build .cauldron-tool').waitFor({ state: 'visible' });
  const tool = page.locator('.cauldron-tool');
  assert.equal(await tool.evaluate(element => element.open), false, 'the growth panel starts collapsed');
  await tool.locator(':scope > summary').click();
  assert.equal(await tool.evaluate(element => element.open), true);

  const targetSelect = tool.locator('[data-devour-target]');
  await targetSelect.selectOption('RC05');
  let preview = await tool.locator('.cauldron-devour-preview').innerText();
  assert.match(preview, new RegExp(fixture.equippedTargetName));
  assert.match(preview, /已装备/);
  assert.match(preview, /卸下该装备位.*气血钳制.*不会回血/);
  assert.match(preview, /×1(?:\.00)?\s*→\s*×1\.10/);

  await tool.locator('[data-devour-target]').selectOption('RC07');
  preview = await tool.locator('.cauldron-devour-preview').innerText();
  assert.match(preview, new RegExp(fixture.backpackTargetName));
  assert.match(preview, /背包未装备/);
  assert.match(preview, /从背包中移除/);

  for (const width of [360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await devourMetrics(page);
    assert.equal(metrics.pageWidth, metrics.viewportWidth, `the page must not overflow at ${width}px`);
    assert.equal(metrics.controls.length, 3);
    assert.ok(metrics.controls.every(control => control.height >= 44),
      `all growth controls must meet the touch target at ${width}px`);
    assert.ok(metrics.controls.every(control => control.left >= 0 && control.right <= metrics.viewportWidth),
      `growth controls must remain within the viewport at ${width}px`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await tool.locator('[data-devour-target]').selectOption('RC05');
  const commit = tool.locator('[data-action="devour"]');
  assert.equal(await commit.isDisabled(), false);
  await commit.click();
  const notice = page.locator('.inline-notice[role="status"]');
  await notice.waitFor({ state: 'visible' });
  assert.match(await notice.innerText(), new RegExp(`${fixture.equippedTargetName}整栈 ×3`));
  assert.match(await notice.innerText(), /累计吞 1 栈.*×1\.10/);

  const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(persisted.state.artifacts.find(stack => stack.id === 'RL09')?.devoured, 1);
  assert.equal(persisted.state.artifacts.some(stack => stack.id === 'RC05'), false);
  assert.deepEqual(persisted.state.equipment.slots, ['RL09']);
  assert.ok(persisted.state.hp <= fixture.initialHp, 'consumption cannot heal the player');

  const refreshedTool = page.locator('.cauldron-tool');
  await refreshedTool.locator(':scope > summary').click();
  assert.match(await refreshedTool.locator(':scope > summary').innerText(), /已吞 1 栈.*×1\.10/);
  assert.match(await refreshedTool.innerText(), /本局已装备生效/);
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  await context.close();
} finally {
  await browser.close();
}

console.log('V2 artifact growth browser flow passed on mobile and desktop-sized viewports.');
