import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const reportOverride = process.env.SHANHAI_COMPACT_BROWSER_REPORT_DIR ||
  process.env.BROWSER_REPORT_DIR ||
  process.env.BROWSER_OUTPUT_DIR;
const reportDir = reportOverride
  ? path.resolve(reportOverride)
  : path.join(root, 'verification', 'shanhai', 'compact-browser');
const screenshotDir = path.join(reportDir, 'screenshots');
const saveKey = 'suishi-shanhai-run-v1';
const replayKey = 'suishi-shanhai-replay-v1';

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
const checks = [];
const errors = [];

async function check(name, fn) {
  try {
    const details = await fn();
    checks.push({ name, ok: true, ...(details ? { details } : {}) });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function waitForPhase(page, expected) {
  await page.waitForFunction(phase =>
    Boolean(document.querySelector(`.game-page.phase-${phase}`)), expected);
}

async function noOverflow(page, label) {
  const result = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(result.document <= result.viewport + 1,
    `${label}: document 横向溢出 ${JSON.stringify(result)}`);
  assert.ok(result.body <= result.viewport + 1,
    `${label}: body 横向溢出 ${JSON.stringify(result)}`);
  return result;
}

async function assertReadable(page, selector, label, minimum = 12) {
  const metrics = await page.locator(selector).evaluateAll(elements => elements
    .filter(element => element.getClientRects().length > 0)
    .map(element => ({
      text: (element.textContent || '').trim().slice(0, 36),
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    })));
  assert.ok(metrics.length > 0, `${label}: 缺少可见文本 ${selector}`);
  const small = metrics.filter(item => item.fontSize < minimum);
  assert.deepEqual(small, [],
    `${label}: 可读字号低于 ${minimum}px ${JSON.stringify(small)}`);
  return metrics;
}

async function assertNoVisibleEnglish(page, label) {
  const text = await page.locator('#shanhai-app').innerText();
  const englishLines = text.split(/\r?\n/).filter(line => /[A-Za-z]/.test(line));
  assert.deepEqual(englishLines, [],
    `${label}: 玩家可见界面包含拉丁字母：${englishLines.slice(0, 6).join(' | ')}`);
}

async function screenshot(page, width, name) {
  await page.screenshot({
    path: path.join(screenshotDir, `${width}-${name}.png`),
    fullPage: true,
  });
}

async function assertBattleLayout(page, width) {
  const geometry = await page.locator('.battle-shell').evaluate(shell => {
    const arena = shell.querySelector('.combat-arena')?.getBoundingClientRect();
    const controls = shell.querySelector('.battle-controls');
    const controlsRect = controls?.getBoundingClientRect();
    const buttons = [...(controls?.querySelectorAll('button') || [])]
      .filter(button => button.getClientRects().length > 0)
      .map(button => {
        const rect = button.getBoundingClientRect();
        return {
          action: button.getAttribute('data-action'),
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      });
    return {
      arenaBottom: arena?.bottom ?? 0,
      controls: controlsRect ? {
        x: controlsRect.x,
        y: controlsRect.y,
        right: controlsRect.right,
        bottom: controlsRect.bottom,
      } : null,
      buttons,
      combatants: [...shell.querySelectorAll('.combatant')].map(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, right: rect.right, width: rect.width };
      }),
    };
  });
  assert.ok(geometry.controls && geometry.buttons.length >= 5,
    `${width}: 斗法速度、暂停和主操作不完整 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.buttons.every(button =>
    button.width >= 44 && button.height >= 44 &&
    button.x >= geometry.controls.x - 1 &&
    button.right <= geometry.controls.right + 1 &&
    button.y >= geometry.controls.y - 1 &&
    button.bottom <= geometry.controls.bottom + 1),
  `${width}: 斗法操作触控区不足或超出控制栏 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.buttons.every((button, index, buttons) =>
    buttons.slice(index + 1).every(other =>
      button.right <= other.x + 1 || other.right <= button.x + 1 ||
      button.bottom <= other.y + 1 || other.bottom <= button.y + 1)),
  `${width}: 斗法按钮互相覆盖 ${JSON.stringify(geometry.buttons)}`);
  assert.ok(geometry.arenaBottom <= geometry.controls.y + 2,
    `${width}: 斗法控制栏覆盖战场 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.combatants.length === 2 &&
    geometry.combatants[0].right <= geometry.combatants[1].x + 1,
  `${width}: 双方资源栏互相覆盖 ${JSON.stringify(geometry.combatants)}`);
  await assertReadable(page, '.combatant h2, .battle-context strong, [data-battle-round]',
    `${width} battle resources`);
  await noOverflow(page, `${width} battle`);
  return geometry;
}

async function startRealRun(page, width, height) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  const seedOptions = page.locator('details[data-details="seed-options"]');
  assert.equal(await seedOptions.getAttribute('open'), null,
    `${width}: 命数设置没有默认折叠`);
  const start = page.locator('[data-action="start"]');
  await start.waitFor({ state: 'visible' });
  const startRect = await start.boundingBox();
  assert.ok(startRect, `${width}: 开局主按钮没有布局框`);
  assert.ok(startRect.y >= 0 && startRect.y + startRect.height <= height,
    `${width}: 首屏开局主按钮不可见 ${JSON.stringify(startRect)}`);
  assert.equal(await page.locator('.method-choice').count(), 5);
  for (const choice of await page.locator('.method-choice').all()) {
    const rect = await choice.boundingBox();
    assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= height,
      `${width}: 开局功法没有全部显示在首屏`);
  }
  await noOverflow(page, `${width} landing`);
  await assertNoVisibleEnglish(page, `${width} landing`);
  await screenshot(page, width, 'landing');

  await seedOptions.locator('summary').click();
  await page.locator('[name="player-name"]').fill('紧凑测试');
  await page.locator('[name="seed"]').fill('compact-probe-1');
  await page.locator('.method-choice').first().click();
  const landingCanScroll = await page.evaluate(() =>
    document.documentElement.scrollHeight > window.innerHeight + 1);
  if (landingCanScroll) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert.ok(await page.evaluate(() => window.scrollY) > 0,
      `${width}: 开局前未能滚动到首屏之外`);
    await start.evaluate(button => button.click());
  } else {
    await start.click();
  }
  await waitForPhase(page, 'map');
  if (landingCanScroll) {
    assert.equal(await page.evaluate(() => window.scrollY), 0,
      `${width}: 从滚动开局进入地图后没有回到页面顶部`);
  }
  const route = page.locator('.map-node.available:not([disabled])').first();
  await route.waitFor({ state: 'visible' });
  const routeKey = await route.getAttribute('data-id');
  const mapMetrics = await page.locator('.map-scroll').evaluate(element => ({
    nodeCount: element.querySelectorAll('.map-node').length,
    availableCount: element.querySelectorAll('.map-node.available:not([disabled])').length,
    documentWidth: document.documentElement.scrollWidth,
  }));
  assert.equal(mapMetrics.nodeCount, 29, `${width}: 第一幕路线图不是 29 节点`);
  assert.equal(mapMetrics.availableCount, 1, `${width}: 开局可选路线不是唯一首格`);
  await route.scrollIntoViewIfNeeded();
  const saveBeforePreview = await page.evaluate(key => localStorage.getItem(key), saveKey);
  await route.click();
  await page.locator('.node-preview-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), 'map',
    `${width}: 打开节点预览时不应推进命途`);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), saveBeforePreview,
    `${width}: 打开节点预览时不应写入存档`);
  await page.locator('[data-action="confirm-node"]').click();
  await waitForPhase(page, 'preview');
  const save = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), saveKey);
  assert.equal(save?.state?.routeMap?.path?.[0], routeKey,
    `${width}: 首格点击没有写入对应 route key`);
  assert.equal(save?.state?.nodes?.[0]?.id, save?.state?.routeMap?.nodes
    ?.find(node => node.key === routeKey)?.id,
  `${width}: 已选行迹与首格不一致`);
  const preparationDetails = page.locator('details[data-details="battle-preparation-details"]');
  assert.equal(await preparationDetails.getAttribute('open'), null,
    `${width}: 战前详录应默认折叠`);
  assert.ok(await page.locator('.preview-enemy-brief').isVisible(),
    `${width}: 战前首屏缺少对手简要信息`);
  await noOverflow(page, `${width} preview`);
  await assertNoVisibleEnglish(page, `${width} preview`);
  await screenshot(page, width, 'preview');
  await preparationDetails.locator('summary').click();
  assert.equal(await preparationDetails.getAttribute('open'), '',
    `${width}: 战前详录无法展开`);
  assert.ok(await page.locator('.counterplay-list li').count() > 0,
    `${width}: 战前详录缺少应对依据`);
  const fightButton = page.locator('[data-action="fight"]');
  await fightButton.waitFor({ state: 'visible' });
  assert.equal(await fightButton.isDisabled(), false,
    `${width}: 展开战前详录后开始斗法不可用`);
  const fightRect = await fightButton.boundingBox();
  assert.ok(fightRect && fightRect.width >= 44 && fightRect.height >= 44,
    `${width}: 开始斗法点击区域不足 44px ${JSON.stringify(fightRect)}`);

  await fightButton.click();
  await waitForPhase(page, 'battle');
  await page.locator('.battle-shell').waitFor({ state: 'visible' });
  await assertBattleLayout(page, width);
  await page.waitForTimeout(400);
  const skip = page.locator('[data-action="battle-skip"]');
  if (await skip.isVisible()) await skip.click();
  await page.locator('[data-action="battle-finish"], [data-action="continue-battle"]')
    .first().waitFor({ state: 'visible' });
  const log = page.locator('details[data-details="battle-log"]');
  assert.equal(await log.getAttribute('open'), null,
    `${width}: 战报应在进入战斗时默认折叠`);
  assert.equal(await page.locator('[data-details="battle-diagnostics"]').getAttribute('open'), null,
    `${width}: 斗法详录应默认折叠`);
  await screenshot(page, width, 'battle-compact');
  await log.locator('summary').click();
  assert.equal(await log.getAttribute('open'), '',
    `${width}: 战报摘要未能展开详录`);
  await page.locator('[data-action="battle-log-mode"]').click();
  await page.locator('.battle-log.detailed-mode').waitFor({ state: 'visible' });
  await noOverflow(page, `${width} expanded battle log`);
  await assertNoVisibleEnglish(page, `${width} expanded battle log`);
  await screenshot(page, width, 'battle-log-detailed');

  await page.locator('[data-action="battle-finish"]').click();
  await waitForPhase(page, 'reward');
  await page.locator('[data-action="reward"]').first().click();
  await waitForPhase(page, 'map');
  assert.equal((await page.locator('.map-step').innerText()).trim(), '1 / 11');
  assert.match(await page.locator('.map-goal').innerText(), /已行 1 格/);
  const choices = page.locator('.map-node.available:not([disabled])');
  assert.equal(await choices.count(), 3, `${width}: 第一战后没有三个可选节点`);
  const key = await choices.last().getAttribute('data-id');
  await screenshot(page, width, 'map-branch');
  const branchSaveBeforePreview = await page.evaluate(key => localStorage.getItem(key), saveKey);
  await choices.last().click();
  await page.locator('.node-preview-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), branchSaveBeforePreview,
    `${width}: 打开分岔预览时不应写入存档`);
  await page.locator('[data-action="confirm-node"]').click();
  const branchSave = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(branchSave.state.routeMap.path[1], key);
}

async function seedChoiceFixture(page, target, width) {
  const result = await page.evaluate(async ({ target, width, saveKey, replayKey }) => {
    const [{ loadContent }, { ShanhaiGame }, { saveRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    let accepted;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const game = ShanhaiGame.create(content, {
        seed: `compact-${width}-${target}-${attempt}`,
        name: `紧凑验收${width}`,
        method: 'RKF01',
      });
      const first = game.availableNodes()[0];
      if (!first) throw new Error('Choice fixture has no opening route node');
      game.dispatch({ type: 'enter', id: first.key });
      if (game.state.phase !== 'preview') throw new Error(`Choice fixture entered ${game.state.phase}`);
      game.dispatch({ type: 'fight' });
      let drawCount = 0;
      while (game.state.battle?.outcome === 'draw' && drawCount++ < 8) {
        game.dispatch({ type: 'continue_battle' });
      }
      if (game.state.phase !== 'battle' || game.state.battle?.outcome !== 'player') continue;
      game.dispatch({ type: 'battle_done' });
      if (game.state.phase !== 'reward') continue;
      if (target === 'talent') {
        game.state.xp = 120;
        game.dispatch({ type: 'reward', id: null });
        if (game.state.phase !== 'talent') continue;
      }
      saveRun(game);
      localStorage.removeItem(replayKey);
      accepted = {
        phase: game.state.phase,
        routeKey: game.state.routeMap.path[0],
        cardCount: target === 'reward'
          ? game.state.rewardCandidates.length
          : game.availableTalents().length,
      };
      break;
    }
    if (!accepted) throw new Error(`Could not create a winning ${target} fixture`);
    return accepted;
  }, { target, width, saveKey, replayKey });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, target);
  assert.equal(result.phase, target);
  assert.ok(result.routeKey, `${width} ${target}: 合法首格 key 丢失`);
  assert.equal(result.cardCount, 3, `${width} ${target}: 应有三个选择`);
}

async function assertThreeChoiceRow(page, target, width) {
  const grid = page.locator(target === 'reward' ? '.reward-grid' : '.talent-grid');
  const cardSelector = target === 'reward' ? '.reward-card' : '.talent-card';
  const geometry = await grid.evaluate((element, selector) => {
    const cards = [...element.querySelectorAll(selector)];
    const gridRect = element.getBoundingClientRect();
    const rects = cards.map(card => {
      const rect = card.getBoundingClientRect();
      const emblem = card.querySelector('.choice-emblem');
      const emblemRect = emblem?.getBoundingClientRect();
      const detail = card.querySelector(
        '.compact-choice-actions [data-action="inspect-artifact"], .compact-choice-actions [data-action="inspect-talent"]',
      );
      const detailRect = detail?.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        emblem: emblemRect ? {
          width: emblemRect.width,
          height: emblemRect.height,
          opacity: Number(getComputedStyle(emblem).opacity),
          pointerEvents: getComputedStyle(emblem).pointerEvents,
        } : null,
        detail: detailRect ? {
          x: detailRect.x,
          y: detailRect.y,
          width: detailRect.width,
          height: detailRect.height,
          right: detailRect.right,
          bottom: detailRect.bottom,
          fontSize: Number.parseFloat(getComputedStyle(detail).fontSize),
        } : null,
      };
    });
    return {
      display: getComputedStyle(element).display,
      columns: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      grid: { x: gridRect.x, right: gridRect.right, width: gridRect.width },
      cards: rects,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      visibleBottom: document.querySelector('.mobile-nav')?.getBoundingClientRect().top || window.innerHeight,
    };
  }, cardSelector);
  assert.equal(geometry.display, 'grid', `${width} ${target}: 选择区域不是 grid`);
  assert.equal(geometry.columns, 3, `${width} ${target}: 不是三列 ${JSON.stringify(geometry)}`);
  assert.equal(geometry.cards.length, 3, `${width} ${target}: 卡面数量不是三个`);
  assert.ok(geometry.cards.every(card => Math.abs(card.y - geometry.cards[0].y) <= 1),
    `${width} ${target}: 三张卡没有处于同一行 ${JSON.stringify(geometry.cards)}`);
  assert.ok(geometry.cards.every(card => card.x >= geometry.grid.x - 1 &&
    card.right <= geometry.grid.right + 1),
  `${width} ${target}: 卡面超出选择区域 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.documentWidth <= width + 1 && geometry.bodyWidth <= width + 1,
    `${width} ${target}: 选择页发生整体横向溢出 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.cards.every(card => card.bottom <= geometry.visibleBottom),
    `${width} ${target}: 三选一卡片超出首屏 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.cards.every(card => card.emblem?.width > 0 && card.emblem?.height > 0),
    `${width} ${target}: 卡片背景纹样未渲染`);
  assert.ok(geometry.cards.every(card => card.emblem.opacity > 0 &&
    card.emblem.pointerEvents === 'none'),
  `${width} ${target}: 背景纹样遮挡卡片交互 ${JSON.stringify(geometry.cards)}`);
  assert.ok(geometry.cards.every(card => card.detail &&
    card.detail.width >= 44 && card.detail.height >= 44 &&
    card.detail.x + card.detail.width / 2 >= card.x + card.width / 2 &&
    card.detail.bottom <= card.bottom + 1 && card.detail.fontSize >= 11),
  `${width} ${target}: 右下详录入口尺寸、位置或字号不合格 ${JSON.stringify(geometry.cards)}`);
  await assertNoVisibleEnglish(page, `${width} ${target}`);
  await screenshot(page, width, target);
  return geometry;
}

async function assertChoiceDetails(page, target, width) {
  const card = page.locator(target === 'reward' ? '.reward-card' : '.talent-card').first();
  const action = target === 'reward' ? 'inspect-artifact' : 'inspect-talent';
  const details = card.locator(`[data-action="${action}"]`);
  assert.equal(await details.count(), 1,
    `${width} ${target}: 卡面缺少详录入口`);
  const beforeSave = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(beforeSave, `${width} ${target}: 详录测试前缺少自动存档`);
  await details.focus();
  assert.equal(await details.evaluate(element => element === document.activeElement), true,
    `${width} ${target}: 详录入口不能键盘聚焦`);
  await page.keyboard.press('Enter');
  const dialog = page.locator(target === 'reward'
    ? '.item-dialog[role="dialog"][aria-modal="true"]'
    : '.talent-dialog[role="dialog"][aria-modal="true"]');
  await dialog.waitFor({ state: 'visible' });
  assert.ok(await dialog.locator('.effect-list p').count() > 0,
    `${width} ${target}: 详录没有展示完整效果`);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), beforeSave,
    `${width} ${target}: 打开详录改写了命途存档`);
  await dialog.locator('[data-action="modal-close"][data-autofocus]').click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')),
    action, `${width} ${target}: 关闭详录后焦点没有返回入口`);
}

async function runViewport(browser, { width, height }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: width < 700,
    hasTouch: width < 700,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(`${width}: pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${width}: console: ${message.text()}`);
  });
  try {
    await check(`${width} landing, legal route choice, and localized detailed battle log`, async () => {
      await startRealRun(page, width, height);
      return await noOverflow(page, `${width} battle log`);
    });
    for (const target of ['reward', 'talent']) {
      let geometry;
      await check(`${width} ${target} three-column compact choice layout`, async () => {
        await seedChoiceFixture(page, target, width);
        await noOverflow(page, `${width} ${target}`);
        geometry = await assertThreeChoiceRow(page, target, width);
        await assertChoiceDetails(page, target, width);
        return geometry;
      });
    }
  } finally {
    await context.close();
  }
}

async function run() {
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 360, height: 780 },
      { width: 320, height: 760 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
    ]) {
      await runViewport(browser, viewport);
    }
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      reportDir,
      generatedAt: new Date().toISOString(),
      viewports: [
        { width: 390, height: 844 },
        { width: 360, height: 780 },
        { width: 320, height: 760 },
        { width: 1280, height: 720 },
        { width: 1440, height: 900 },
      ],
      checks,
      errors,
    }, null, 2) + '\n');
  }
  if (errors.length) throw new Error(`Compact browser errors: ${JSON.stringify(errors)}`);
  const failures = checks.filter(checkResult => !checkResult.ok);
  if (failures.length) {
    throw new Error(`Compact browser failures: ${JSON.stringify(failures)}`);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
