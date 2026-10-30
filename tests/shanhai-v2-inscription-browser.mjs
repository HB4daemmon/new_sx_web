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

async function installShopFixture(page, coins = 120) {
  return page.evaluate(async ({ saveKey, coins }) => {
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
      seed: 'v2-inscription-browser',
      name: '铭刻坊市验收',
      method: 'RKF01',
    });
    game.state.phase = 'shop';
    game.state.coins = coins;
    game.state.artifacts = [{ id: 'RC01', stacks: 1 }];
    game.state.equipment.slots = ['RC01'];
    game.state.shop = [];
    game.state._shopInscribed = false;
    const saved = persistence.saveRun(game);
    localStorage.clear();
    localStorage.setItem(saveKey, JSON.stringify(saved));
    return { artifactName: content.byId.RC01.name, inscriptionCost: game.inscriptionPrice() };
  }, { saveKey, coins });
}

const { chromium } = playwrightModule();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.landing-page, .game-page').first().waitFor({ state: 'visible' });
  const fixture = await installShopFixture(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-shop').waitFor({ state: 'visible' });

  const tool = page.locator('.inscription-tool');
  await tool.locator(':scope > summary').click();
  assert.equal(await tool.evaluate(element => element.open), true);
  assert.match(await tool.innerText(), /每间坊市限一件/);
  assert.match(await tool.innerText(), /同 ID 叠层保留原铭刻/);

  const artifactSelect = tool.locator('[data-inscription-artifact]');
  const inscriptionSelect = tool.locator('[data-inscription-choice]');
  await inscriptionSelect.selectOption('leech');
  assert.match(await tool.locator('.inscription-effect').innerText(), /实际造成敌方气血伤害.*15%/);
  assert.equal(await artifactSelect.inputValue(), 'RC01');
  const commit = tool.locator('[data-action="inscribe"]');
  assert.match(await commit.innerText(), new RegExp(`${fixture.inscriptionCost}.*灵石`));
  assert.equal(await commit.isDisabled(), false);

  const targetMetrics = await page.evaluate(() => {
    const selectors = ['[data-inscription-artifact]', '[data-inscription-choice]', '[data-action="inscribe"]'];
    const rects = selectors.map(selector => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect ? { selector, width: rect.width, height: rect.height, left: rect.left, right: rect.right } : null;
    }).filter(Boolean);
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      rects,
    };
  });
  assert.equal(targetMetrics.pageWidth, targetMetrics.viewportWidth, 'shop controls must not cause mobile page overflow');
  assert.ok(targetMetrics.rects.every(rect => rect.height >= 44), 'inscription controls need touch-sized targets');

  await commit.click();
  await page.waitForFunction(key => {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved?.state?.artifacts?.[0]?.inscription === 'leech';
  }, saveKey);
  const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(persisted.state.artifacts[0].inscription, 'leech');
  assert.equal(persisted.state.progress.coinsSpent, fixture.inscriptionCost);
  assert.match(await tool.innerText(), /本店已铭刻一次/);

  await page.locator('[data-action="tab"][data-id="build"]').last().click();
  const equipmentItem = page.locator('.equipment-slot-item[data-id="RC01"]');
  assert.match(await equipmentItem.innerText(), /铭刻噬血/);
  await equipmentItem.click();
  assert.match(await page.locator('.artifact-inscription-detail').innerText(), /古炉铭刻 · 噬血/);
  assert.match(await page.locator('.artifact-inscription-detail').innerText(), /回复伤害的 15%/);

  await installShopFixture(page, fixture.inscriptionCost - 1);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page.phase-shop').waitFor({ state: 'visible' });
  const poorTool = page.locator('.inscription-tool');
  await poorTool.locator(':scope > summary').click();
  assert.equal(await poorTool.locator('[data-action="inscribe"]').isDisabled(), true);
  assert.match(await poorTool.innerText(), /灵石不足/);

  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  await page.close();
} finally {
  await browser.close();
}

console.log('V2 inscription browser flow passed at a mobile viewport and verified equipment and artifact details.');
