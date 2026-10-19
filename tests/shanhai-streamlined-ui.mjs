import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
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
const pageErrors = [];

async function waitForPhase(page, phase) {
  await page.locator(`.game-page.phase-${phase}`).waitFor({ state: 'visible' });
}

async function currentSave(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, '缺少命途自动存档');
  return text;
}

async function noPageOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.scrollHeight,
    windowY: window.scrollY,
  }));
  assert.ok(metrics.documentWidth <= metrics.width + 1 &&
    metrics.bodyWidth <= metrics.width + 1,
  `${label}: 页面横向溢出 ${JSON.stringify(metrics)}`);
  assert.ok(metrics.documentHeight <= metrics.height + 1 &&
    metrics.bodyHeight <= metrics.height + 1,
  `${label}: 页面纵向溢出 ${JSON.stringify(metrics)}`);
  assert.equal(metrics.windowY, 0, `${label}: 页面本身发生纵向滚动`);
  return metrics;
}

async function assertFullHeightMap(page, label) {
  const geometry = await page.locator('.game-page.phase-map .map-scroll').evaluate(map => {
    const nav = document.querySelector('.bottom-nav');
    const navVisible = Boolean(nav?.getClientRects().length);
    const navTop = navVisible ? nav.getBoundingClientRect().top : window.innerHeight;
    const rect = map.getBoundingClientRect();
    return {
      fullMap: map.closest('.game-layout')?.classList.contains('full-map'),
      nodeCount: map.querySelectorAll('.map-node').length,
      mapBottom: rect.bottom,
      navVisible,
      navTop,
      windowHeight: window.innerHeight,
      oldMapChrome: document.querySelectorAll(
        '.game-page.phase-map .map-goal, .game-page.phase-map .map-note, .game-page.phase-map .node-description',
      ).length,
    };
  });
  assert.equal(geometry.fullMap, true, `${label}: 地图没有使用 full-map 布局`);
  assert.equal(geometry.nodeCount, 29, `${label}: 第一幕地图不是 29 个节点`);
  assert.equal(geometry.oldMapChrome, 0, `${label}: 地图仍显示重复目标或节点说明`);
  assert.ok(Math.abs(geometry.mapBottom - geometry.navTop) <= 3,
    `${label}: 地图没有填满导航之前的剩余高度 ${JSON.stringify(geometry)}`);
  await noPageOverflow(page, label);
  return geometry;
}

async function startRealRun(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[name="player-name"]').waitFor({ state: 'visible' });
  await page.locator('[data-action="start"]').click();
  await waitForPhase(page, 'map');
  await currentSave(page);
}

async function assertSettingsEntries(page) {
  const actions = await page.locator('.topbar .header-actions button').evaluateAll(buttons =>
    buttons.map(button => button.getAttribute('data-action')));
  assert.deepEqual(actions, ['talent-tree', 'settings'],
    '顶栏应只保留天赋树与设置两个工具');
  const tools = await page.locator('.topbar .header-actions button').evaluateAll(buttons =>
    buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, label: button.getAttribute('aria-label') };
    }));
  assert.ok(tools.every(tool => tool.width >= 44 && tool.height >= 44 && tool.label),
    `顶栏工具缺少触控区域或无障碍名称 ${JSON.stringify(tools)}`);

  const before = await currentSave(page);
  assert.equal(await page.locator('.game-page .chapter-strip').count(), 0,
    '幕次行程不应常驻在游戏主界面');
  await page.locator('.topbar [data-action="settings"]').click();
  const settings = page.locator('.settings-dialog[role="dialog"]');
  await settings.waitFor({ state: 'visible' });
  assert.equal(await settings.locator('[data-action="archives"]').count(), 1,
    '设置中缺少通关归档入口');
  assert.equal(await settings.locator('[data-action="archives"]').isVisible(), true,
    '设置中的通关归档入口不可见');
  assert.equal(await settings.locator('[data-action="restart"]').count(), 1,
    '设置中缺少重开入口');
  assert.equal(await settings.locator('[data-action="restart"]').isVisible(), true,
    '设置中的重开入口不可见');
  assert.equal(await page.locator('.topbar [data-action="archives"], .topbar [data-action="restart"]').count(), 0,
    '归档或重开仍重复出现在顶栏');
  const progress = settings.locator('details[data-details="chapter-progress"]');
  assert.equal(await progress.count(), 1, '设置中缺少幕次行程详情');
  assert.equal(await progress.evaluate(element => element.open), false,
    '幕次行程详情应默认收起');
  await progress.locator('summary').click();
  assert.equal(await progress.locator('.chapter-strip').isVisible(), true,
    '展开设置详情后没有显示幕次行程');
  await settings.locator('[data-action="modal-close"][data-autofocus]').click();
  assert.equal(await currentSave(page), before, '打开和关闭设置改写了命途存档');
}

async function assertMapModalsDoNotAdvance(page) {
  const before = await currentSave(page);
  const phase = await page.locator('.game-page').getAttribute('data-phase');
  const route = page.locator('.map-node.available:not([disabled])').first();
  await route.click();
  const preview = page.locator('.node-preview-dialog[role="dialog"]');
  await preview.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), phase,
    '打开地图节点详情推进了命途阶段');
  assert.equal(await currentSave(page), before, '打开地图节点详情改写了存档');
  const encounter = preview.locator('details.node-preview-detail');
  assert.equal(await encounter.evaluate(element => element.open), false,
    '遭遇说明不应默认展开');
  await encounter.locator('summary').click();
  assert.equal(await encounter.locator('.node-preview-copy').isVisible(), true,
    '弹窗中的原生详情未能展开');
  assert.equal(await currentSave(page), before, '展开遭遇说明改写了存档');
  await preview.locator('[data-action="modal-close"]').first().click();

  await page.locator('.topbar .global-talent-tree').click();
  const tree = page.locator('.talent-tree-dialog[role="dialog"]');
  await tree.waitFor({ state: 'visible' });
  const futureNodes = tree.locator('.talent-tree-node.is-future');
  assert.ok(await futureNodes.count() > 0, '没有未解锁天赋供验证');
  assert.equal(await futureNodes.locator('small').count(), 0,
    '未解锁天赋说明应默认收起，不应直接铺满节点');
  const firstFuture = futureNodes.first();
  const talentName = (await firstFuture.locator('strong').innerText()).trim();
  await firstFuture.click();
  const detail = page.locator('.talent-dialog[role="dialog"]');
  await detail.waitFor({ state: 'visible' });
  assert.equal((await detail.locator('#dialog-title').innerText()).trim(), talentName,
    '打开的天赋详情与所选未解锁节点不一致');
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), phase,
    '打开未解锁天赋详情推进了命途阶段');
  assert.equal(await currentSave(page), before, '查看未解锁天赋说明改写了存档');
  await detail.locator('[data-action="modal-close"][data-autofocus]').click();
  await tree.waitFor({ state: 'visible' });
  await tree.locator('[data-action="modal-close"][data-autofocus]').click();
  assert.equal(await currentSave(page), before, '浏览未解锁天赋说明改写了存档');
}

async function assertScrollSurvivesResize(page, viewport, nextViewport) {
  const initial = await page.locator('.map-scroll').evaluate(map => {
    const target = Math.min(140, map.scrollHeight - map.clientHeight);
    map.scrollTop = target;
    return { target, actual: map.scrollTop };
  });
  assert.ok(initial.target > 0 && initial.actual > 0,
    `${viewport.width}: 地图没有可滚动内容 ${JSON.stringify(initial)}`);
  await page.setViewportSize(nextViewport);
  const afterResize = await page.locator('.map-scroll').evaluate(map => ({
    scrollTop: map.scrollTop,
    maxScroll: map.scrollHeight - map.clientHeight,
  }));
  assert.ok(afterResize.maxScroll >= initial.actual - 1,
    `${viewport.width}: resize 后地图滚动范围不足 ${JSON.stringify({ initial, afterResize, nextViewport })}`);
  assert.ok(Math.abs(afterResize.scrollTop - initial.actual) <= 1,
    `${viewport.width}: resize 丢失地图滚动位置 ${JSON.stringify({ initial, afterResize, nextViewport })}`);
  await assertFullHeightMap(page, `${nextViewport.width}x${nextViewport.height} resize`);
}

async function installPhaseFixture(page, target) {
  await page.evaluate(async ({ target, replayKey }) => {
    const [{ loadContent }, { ShanhaiGame, registerCombatWorker }, { calculateStats }, { saveRun }] =
      await Promise.all([
        import('/shanhai/content.js'),
        import('/shanhai/run.js'),
        import('/shanhai/combat.js'),
        import('/shanhai/persistence.js'),
      ]);
    const content = await loadContent('/content/');
    registerCombatWorker({
      calculateStats,
      simulateBattle(_content, player) {
        return {
          outcome: 'player',
          rounds: 1,
          playerHp: player.hp ?? 1,
          enemyHp: 0,
          frames: [],
          contributions: [],
        };
      },
    });
    const game = ShanhaiGame.create(content, {
      seed: `streamlined-${target}-ui-fixture`,
      name: '精简界面行者',
      method: 'RKF01',
    });

    if (target === 'rest') {
      game.state.phase = 'rest';
      game.state.ownedMethods = ['RKF01', 'RKF02'];
      game.state.talents.RKF02 = [];
    } else {
      const opening = game.availableNodes()[0];
      if (!opening) throw new Error('UI fixture 缺少首个地图节点');
      game.dispatch({ type: 'enter', id: opening.key });
      game.dispatch({ type: 'fight' });
      if (game.state.phase !== 'battle') throw new Error('UI fixture 未进入战斗结算');
      game.dispatch({ type: 'battle_done' });
      if (target === 'event') {
        game.dispatch({ type: 'reward', id: null });
        const event = game.availableNodes().find(node => node.type === 'E') ||
          game.availableNodes().find(node => node.type === 'K');
        if (!event) throw new Error('UI fixture 第二格没有事件节点');
        game.dispatch({ type: 'enter', id: event.key });
      }
    }

    if (game.state.phase !== target) {
      throw new Error(`UI fixture 目标阶段不匹配：${game.state.phase} != ${target}`);
    }
    saveRun(game);
    localStorage.removeItem(replayKey);
  }, { target, replayKey });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, target);
  return await currentSave(page);
}

async function assertRewardDetails(page) {
  const before = await installPhaseFixture(page, 'reward');
  const cards = page.locator('.reward-card');
  assert.equal(await cards.count(), 3, '奖励页应显示三张法宝卡');
  const first = cards.first();
  const inspect = first.locator('.reward-inspect');
  assert.equal(await inspect.locator('h2').count(), 1,
    '奖励详录入口应由图像与标题组成');
  assert.equal(await inspect.locator('p, small').count(), 0,
    '奖励详录入口不应重复展开法宝说明');
  assert.ok(await inspect.locator('.artifact-art, .sigil').count() > 0,
    '奖励详录入口缺少法宝图像');
  assert.equal(await first.locator('.compact-choice-actions [data-action="reward"]').count(), 1,
    '奖励卡应只保留一个收入操作');
  assert.equal(await first.locator('.compact-choice-actions [data-action="inspect-artifact"]').count(), 0,
    '奖励卡仍有重复的独立详录按钮');
  await inspect.click();
  const dialog = page.locator('.item-dialog[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), 'reward',
    '查看法宝详情推进了奖励阶段');
  assert.equal(await currentSave(page), before, '查看法宝详情改写了命途存档');
  await dialog.locator('[data-action="modal-close"][data-autofocus]').click();
  assert.equal(await currentSave(page), before, '关闭法宝详情改写了命途存档');
}

async function assertEventPassageDetails(page) {
  const before = await installPhaseFixture(page, 'event');
  const shortText = (await page.locator('.story-text').innerText()).trim();
  const details = page.locator('details.event-passage');
  assert.equal(await details.count(), 1, '事件短句缺少前情详录入口');
  assert.equal(await details.evaluate(element => element.open), false,
    '事件完整前情不应默认展开');
  const passage = (await details.locator('p').textContent()).trim();
  assert.ok(passage.length > shortText.length,
    '事件详情应包含比首屏短句更完整的前情');
  await details.locator('summary').click();
  assert.equal(await details.evaluate(element => element.open), true,
    '前情详录没有按需展开');
  assert.equal(await details.locator('p').isVisible(), true,
    '展开后仍看不到完整事件前情');
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), 'event',
    '展开事件前情推进了命途阶段');
  assert.equal(await currentSave(page), before, '展开事件前情改写了命途存档');
}

async function assertRestSwapDisclosure(page) {
  const before = await installPhaseFixture(page, 'rest');
  const details = page.locator('details.rest-swap');
  assert.equal(await details.count(), 1, '换法入口应收在休整详情中');
  assert.equal(await details.evaluate(element => element.open), false,
    '换法选项不应默认占据休整界面');
  const choices = details.locator('.method-swap:not(.current)');
  assert.equal(await choices.count(), 1, '换法详录应列出唯一的其他已学功法');
  assert.equal(await choices.first().isVisible(), false,
    '展开换法前不应显示可选功法列表');
  await details.locator('summary').click();
  assert.equal(await choices.first().isVisible(), true,
    '展开换法后没有显示可选功法');
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), 'rest',
    '展开换法列表推进了休整阶段');
  assert.equal(await currentSave(page), before, '展开换法列表改写了命途存档');
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  try {
    for (const viewport of [
      { width: 360, height: 780 },
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        isMobile: viewport.width < 700,
        hasTouch: viewport.width < 700,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => pageErrors.push(`${viewport.width}: ${error.message}`));
      await startRealRun(page);
      await assertSettingsEntries(page);
      await assertFullHeightMap(page, `${viewport.width}x${viewport.height}`);
      await assertMapModalsDoNotAdvance(page);

      const nextViewport = viewport.width === 360
        ? { width: 390, height: 844 }
        : viewport.width === 390
          ? { width: 360, height: 780 }
          : { width: 1280, height: 720 };
      await assertScrollSurvivesResize(page, viewport, nextViewport);
      await context.close();
    }

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => pageErrors.push(`details: ${error.message}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await assertRewardDetails(page);
    await assertEventPassageDetails(page);
    await assertRestSwapDisclosure(page);
    await context.close();

    assert.deepEqual(pageErrors, [], `页面运行时报错：${pageErrors.join(' | ')}`);
    console.log('ok - 精简 UI 地图布局、入口与按需详情');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
