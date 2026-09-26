import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pauseNextReplay } from './shanhai-replay-fixture.mjs';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const saveKey = 'suishi-shanhai-run-v1';
const replayKey = 'suishi-shanhai-replay-v1';
const mobileNavBreakpoint = 1050;
const reportOverride = process.env.SHANHAI_CLASSIC_UI_REPORT_DIR ||
  process.env.BROWSER_REPORT_DIR ||
  process.env.BROWSER_OUTPUT_DIR;
const reportDir = reportOverride
  ? path.resolve(reportOverride)
  : await mkdtemp(path.join(os.tmpdir(), 'shanhai-classic-ui-'));
const screenshotDir = path.join(reportDir, 'screenshots');

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
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function waitForApp(page) {
  await page.locator('#shanhai-app').waitFor({ state: 'visible' });
  await page.locator('.game-page, .landing-page').first().waitFor({ state: 'visible' });
}

async function currentPhase(page) {
  return page.evaluate(() => {
    const gamePage = document.querySelector('.game-page');
    const classPhase = gamePage?.className.match(/(?:^|\s)phase-([a-z_]+)/)?.[1];
    return classPhase || gamePage?.getAttribute('data-phase') ||
      document.querySelector('[data-phase]')?.getAttribute('data-phase') || null;
  });
}

async function waitForPhase(page, expected) {
  await page.waitForFunction((phase) => {
    const gamePage = document.querySelector('.game-page');
    return Boolean(
      gamePage?.classList.contains(`phase-${phase}`) ||
      gamePage?.getAttribute('data-phase') === phase ||
      document.querySelector(`[data-phase="${phase}"]`),
    );
  }, expected);
}

async function waitForPhaseChange(page, previous) {
  await page.waitForFunction((phase) => {
    const gamePage = document.querySelector('.game-page');
    return Boolean(gamePage &&
      !gamePage.classList.contains(`phase-${phase}`) &&
      gamePage.getAttribute('data-phase') !== phase &&
      !document.querySelector(`[data-phase="${phase}"]`));
  }, previous);
}

async function clickVisibleAction(page, action, attributes = {}) {
  const candidates = page.locator(`[data-action="${action}"]`);
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible()) || await candidate.isDisabled()) continue;
    let matches = true;
    for (const [key, expected] of Object.entries(attributes)) {
      if ((await candidate.getAttribute(`data-${key}`)) !== String(expected)) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    await candidate.scrollIntoViewIfNeeded();
    await candidate.click();
    return candidate;
  }
  throw new Error(`找不到可见按钮 data-action=${action} ${JSON.stringify(attributes)}`);
}

async function storageSnapshot(page) {
  return page.evaluate(() => Object.fromEntries(
    Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]),
  ));
}

async function savedState(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, '浏览器没有自动存档');
  const record = JSON.parse(text);
  assert.equal(record.key, saveKey, '自动存档 key 不正确');
  assert.ok(record.state, '自动存档没有 state');
  return { text, record, state: record.state };
}

async function replayState(page) {
  return page.evaluate(key => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && Number.isInteger(value.cursor) ? value : null;
    } catch {
      return null;
    }
  }, replayKey);
}

async function battleSnapshot(page) {
  return page.evaluate(async () => {
    const [{ loadContent }, { loadRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const game = loadRun(await loadContent('/content/'));
    const state = game?.state;
    if (!state?.battle?.frames.length) throw new Error('Replay fixture has no rebuilt battle frames');
    return {
      key: `${state.id}:${state.act}:${state.step}:${state.battle.frames.length}`,
      frames: state.battle.frames,
    };
  });
}

async function setReplayCursor(page, cursor, reload = true, pauseImmediately = false) {
  const snapshot = await battleSnapshot(page);
  await page.evaluate(({ replayKey, cursor, key, length }) => {
    localStorage.setItem(replayKey, JSON.stringify({
      key,
      cursor: Math.max(0, Math.min(length - 1, Math.floor(cursor))),
    }));
  }, { replayKey, cursor, key: snapshot.key, length: snapshot.frames.length });
  if (reload) {
    if (pauseImmediately) await pauseNextReplay(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await waitForPhase(page, 'battle');
    if (pauseImmediately) {
      await page.locator('.battle-shell[data-paused="true"]').waitFor();
    }
  }
}

async function noOverflow(page, label) {
  const result = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(result.documentWidth <= result.viewport + 1,
    `${label}: document 横向溢出 ${JSON.stringify(result)}`);
  assert.ok(result.bodyWidth <= result.viewport + 1,
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

async function assertTouchTarget(locator, label) {
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.boundingBox();
  assert.ok(rect && rect.width >= 44 && rect.height >= 44,
    `${label}: 点击区域不足 44px ${JSON.stringify(rect)}`);
  const navRect = await locator.evaluate(element => {
    if (element.closest('.bottom-nav')) return null;
    const nav = document.querySelector('.bottom-nav');
    if (!nav || !nav.getClientRects().length) return null;
    const value = nav.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  });
  assert.ok(!navRect || rect.y + rect.height <= navRect.y + 1,
    `${label}: 底部导航遮住了操作入口 ${JSON.stringify({ rect, navRect })}`);
  const fontSize = await locator.evaluate(element =>
    Number.parseFloat(getComputedStyle(element).fontSize));
  assert.ok(fontSize >= 13, `${label}: 按钮文字字号低于 13px (${fontSize}px)`);
  return rect;
}

async function assertVisualAssets(page, label) {
  const result = await page.evaluate(async () => {
    const images = [...document.images].map(image => ({
      src: image.currentSrc || image.src,
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
    const vectors = [...document.querySelectorAll('.landscape, .portrait, .fighter-art')]
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          width: rect.width,
          height: rect.height,
        };
      });
    const atlasResponse = await fetch('./assets/generated/combat-vfx-atlas.webp');
    return {
      images,
      vectors,
      atlas: {
        status: atlasResponse.status,
        contentType: atlasResponse.headers.get('content-type'),
        byteLength: (await atlasResponse.arrayBuffer()).byteLength,
      },
    };
  });
  const brokenImages = result.images.filter(image =>
    !image.complete || image.width === 0 || image.height === 0);
  assert.deepEqual(brokenImages, [], `${label}: 存在未加载图片 ${JSON.stringify(brokenImages)}`);
  assert.equal(result.atlas.status, 200, `${label}: 战斗特效图集 HTTP ${result.atlas.status}`);
  assert.equal(result.atlas.contentType, 'image/webp',
    `${label}: 战斗特效图集类型 ${result.atlas.contentType}`);
  assert.ok(result.atlas.byteLength > 0, `${label}: 战斗特效图集为空`);
  assert.ok(result.vectors.some(item => item.width > 0 && item.height > 0),
    `${label}: 没有可见山水/立绘素材`);
}

async function assertNoAlerts(page, label) {
  const alerts = await page.locator('[role="alert"]:visible').allTextContents();
  assert.deepEqual(alerts, [], `${label}: 出现可见错误 ${alerts.join(' | ')}`);
}

async function createFixture(page, target, seed = `classic-ui-${target}`, options = {}) {
  await page.evaluate(async ({ target, seed, selectedTalent, coins }) => {
    const [{ loadContent }, { ShanhaiGame }, { saveRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = ShanhaiGame.create(content, {
      seed,
      name: `经典UI${target}`,
      method: 'RKF01',
    });
    if (selectedTalent) {
      const method = content.byId[game.state.method];
      const talent = method.talents.find(candidate => candidate && candidate.tier === 1);
      const cumulative = content.byId.RULES?.cultivation?.cumulative;
      const requiredXp = Number.isFinite(cumulative?.[0]) ? cumulative[0] : 120;
      if (!talent) throw new Error('Battle fixture has no starting-method talent');
      game.state.n = Math.max(game.state.n, 1);
      game.state.xp = Math.max(game.state.xp, requiredXp);
      game.state.talents[game.state.method] = [talent.id];
    }

    const advance = () => {
      if (game.state.phase === 'map') {
        const available = game.availableNodes();
        const preferredTypes = target === 'event' && game.state.step === 1
          ? ['E', 'K']
          : target === 'rest' && game.state.step === 3
            ? ['R']
            : target === 'shop' && game.state.step === 5
              ? ['S']
              : [];
        const node = available.find(candidate => preferredTypes.includes(candidate.type)) || available[0];
        if (!node) throw new Error(`Fixture has no reachable node at step ${game.state.step}`);
        game.dispatch({ type: 'enter', id: node.key });
      } else if (game.state.phase === 'preview') {
        game.dispatch({ type: 'fight' });
      } else if (game.state.phase === 'battle') {
        if (game.state.battle?.outcome === 'draw') {
          game.dispatch({ type: 'continue_battle' });
        } else {
          game.dispatch({ type: 'battle_done' });
        }
      } else if (game.state.phase === 'reward') {
        game.dispatch({ type: 'reward', id: null });
      } else if (game.state.phase === 'event') {
        const event = content.byId[game.node.id];
        const option = event.options.find(candidate => game.optionAvailability(candidate).available);
        if (!option) throw new Error(`Fixture event has no available option for ${event.id}`);
        game.dispatch({ type: 'event', id: option.id });
      } else if (game.state.phase === 'event_result') {
        game.dispatch({ type: 'continue' });
      } else if (game.state.phase === 'shop') {
        game.dispatch({ type: 'leave_shop' });
      } else if (game.state.phase === 'rest') {
        game.dispatch({ type: 'rest', choice: 'heal' });
      } else if (game.state.phase === 'talent') {
        const talent = game.availableTalents()[0];
        if (!talent) throw new Error('Fixture talent phase has no choice');
        game.dispatch({ type: 'talent', id: talent.id });
      } else if (game.state.phase === 'transition') {
        game.dispatch({ type: 'continue' });
      } else {
        throw new Error(`Cannot advance fixture from ${game.state.phase}`);
      }
    };

    let guard = 0;
    while (game.state.phase !== target && !['won', 'lost'].includes(game.state.phase) &&
      guard++ < 260) advance();
    if (game.state.phase !== target) {
      throw new Error(`Fixture ${target} ended at ${game.state.phase}`);
    }
    if (Number.isFinite(coins)) game.state.coins = coins;
    saveRun(game);
    localStorage.removeItem('suishi-shanhai-replay-v1');
  }, { target, seed, selectedTalent: Boolean(options.selectedTalent), coins: options.coins });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
  await page.waitForTimeout(80);
  await waitForPhase(page, target);
}

async function setupRun(page, seed = 'classic-ui-navigation') {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.method-choice').first().waitFor({ state: 'visible' });
  const seedOptions = page.locator('details[data-details="seed-options"]');
  assert.equal(await seedOptions.getAttribute('open'), null, '命数设置应默认折叠');
  await seedOptions.locator('summary').click();
  await page.locator('[name="player-name"]').fill('经典UI行者');
  await page.locator('[name="seed"]').fill(seed);
  const method = await page.locator('.method-choice').first().getAttribute('data-id');
  assert.ok(method, '开局功法没有 data-id');
  await page.locator('.method-choice').first().click();
  await clickVisibleAction(page, 'start');
  await waitForPhase(page, 'map');
  return { method, save: await savedState(page) };
}

async function enterMap(page) {
  await waitForPhase(page, 'map');
}

async function assertNavigationShell(page, width) {
  assert.equal(await page.locator('.topbar').count(), 1, `${width}: 缺少 topbar`);
  assert.equal(await page.locator('.game-layout').count(), 1, `${width}: 缺少 game-layout`);
  assert.equal(await page.locator('.game-layout .player-rail').count(), 1,
    `${width}: 山河页面缺少左侧 player-rail`);
  assert.equal(await page.locator('.game-layout .main-stage').count(), 1,
    `${width}: 山河页面缺少 main-stage`);

  const ids = await page.locator('[data-action="tab"]').evaluateAll(buttons =>
    [...new Set(buttons.map(button => button.getAttribute('data-id')))]);
  assert.deepEqual(ids.sort(), ['build', 'journey', 'karma'], `${width}: 主导航 id 不完整`);
  for (const host of ['.desktop-nav', '.bottom-nav']) {
    const hostIds = await page.locator(`${host} [data-action="tab"]`).evaluateAll(buttons =>
      buttons.map(button => button.getAttribute('data-id')).sort());
    assert.deepEqual(hostIds, ['build', 'journey', 'karma'],
      `${width}: ${host} 三个 tab action 不完整`);
  }
  const desktop = page.locator('.desktop-nav');
  const bottom = page.locator('.bottom-nav');
  if (width >= mobileNavBreakpoint) {
    assert.ok(await desktop.isVisible(), `${width}: 桌面导航不可见`);
    assert.equal(await bottom.count(), 1, `${width}: 缺少 bottom-nav DOM`);
    assert.equal(await bottom.isVisible(), false, `${width}: 桌面错误显示 bottom-nav`);
  } else {
    assert.equal(await desktop.isVisible(), false, `${width}: 手机错误显示 desktop-nav`);
    assert.ok(await bottom.isVisible(), `${width}: 手机 bottom-nav 不可见`);
    const bottomRect = await bottom.boundingBox();
    assert.ok(bottomRect && bottomRect.height >= 48, `${width}: bottom-nav 点击区域过小`);
  }
  await assertVisualAssets(page, `${width} navigation`);
}

async function assertMapSurface(page, width) {
  assert.equal(await page.locator('.map-scroll').count(), 1, `${width}: 缺少 map-scroll`);
  assert.equal(await page.locator('.map-scroll > .map-wrap').count(), 1,
    `${width}: map-wrap 不是 map-scroll 的纵向内容`);
  const metrics = await page.locator('.map-scroll').evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    wrapHeight: element.querySelector('.map-wrap')?.clientHeight || 0,
    nodeCount: element.querySelectorAll('.map-node').length,
    available: element.querySelectorAll('.map-node.available:not([disabled])').length,
    future: element.querySelectorAll('.map-node:not(.available)[disabled]').length,
    diamonds: [...element.querySelectorAll('.node-disc')].filter(node =>
      getComputedStyle(node).transform !== 'none').length,
  }));
  assert.ok(metrics.scrollHeight > metrics.clientHeight,
    `${width}: map-scroll 没有纵向滚动空间 ${JSON.stringify(metrics)}`);
  assert.ok(metrics.wrapHeight > metrics.clientHeight,
    `${width}: map-wrap 没有纵向山河路线 ${JSON.stringify(metrics)}`);
  assert.equal(metrics.nodeCount, 29, `${width}: 第一幕完整地图节点数不正确 ${JSON.stringify(metrics)}`);
  assert.ok(metrics.available >= 1, `${width}: 当前节点不可进入 ${JSON.stringify(metrics)}`);
  assert.equal(metrics.available, 1, `${width}: 开局应只有一个首格可达 ${JSON.stringify(metrics)}`);
  assert.equal(metrics.future, 28, `${width}: 未选路线节点应全部禁用 ${JSON.stringify(metrics)}`);
  assert.ok(metrics.diamonds >= 1, `${width}: 地图节点不是菱形视觉结构`);

  const current = page.locator('.map-node.available:not([disabled])').first();
  const viewport = await page.locator('.map-scroll').evaluate(scroll => {
    const node = scroll.querySelector('.map-node.available:not([disabled])');
    if (!node) throw new Error('map-scroll 中没有当前节点');
    const scrollRect = scroll.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const bottomNav = document.querySelector('.bottom-nav');
    const navigationTop = bottomNav?.getClientRects().length
      ? bottomNav.getBoundingClientRect().top
      : window.innerHeight;
    return {
      scrollTop: scroll.scrollTop,
      scrollBottom: scroll.scrollTop + scroll.clientHeight,
      nodeTop: nodeRect.top - scrollRect.top + scroll.scrollTop,
      nodeBottom: nodeRect.bottom - scrollRect.top + scroll.scrollTop,
      nodeHeight: nodeRect.height,
      visibleTop: nodeRect.top,
      visibleBottom: nodeRect.bottom,
      navigationTop,
    };
  });
  assert.ok(viewport.nodeTop >= viewport.scrollTop - 1 &&
    viewport.nodeBottom <= viewport.scrollBottom + 1,
  `${width}: 初次进入地图时当前节点未在 map-scroll 可视窗口 ${JSON.stringify(viewport)}`);
  if (width < mobileNavBreakpoint) {
    assert.ok(viewport.visibleTop >= 0 && viewport.visibleBottom <= viewport.navigationTop - 8,
      `${width}: 当前节点超出手机视口或被底部导航遮挡 ${JSON.stringify(viewport)}`);
  }
  assert.ok(await current.isVisible(), `${width}: 当前地图节点不可见`);
  assert.equal(await page.locator('.map-node:not(.available)[disabled]').first().isDisabled(),
    true, `${width}: 未来地图节点未保持 disabled`);
  await assertVisualAssets(page, `${width} map`);
}

async function mapScrollTop(page) {
  return page.locator('.map-scroll').evaluate(element => element.scrollTop);
}

async function assertMapScrollPersistence(page, width) {
  const map = page.locator('.map-scroll');
  const range = await map.evaluate(element => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  assert.ok(range.scrollHeight > range.clientHeight + 20,
    `${width}: 地图没有可验证的滚动范围 ${JSON.stringify(range)}`);
  await map.evaluate(element => {
    element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) * 0.58);
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  const initial = await mapScrollTop(page);
  assert.ok(initial > 0, `${width}: 测试未能建立地图滚动位置`);

  // A same-view tab click is a real render without changing the run phase.
  await clickVisibleAction(page, 'tab', { id: 'journey' });
  await waitForPhase(page, 'map');
  assert.ok(Math.abs(await mapScrollTop(page) - initial) <= 2,
    `${width}: 地图滚动位置未跨重新渲染保留`);

  const trigger = await clickVisibleAction(page, 'settings');
  const triggerMeta = await trigger.evaluate(element => ({
    action: element.getAttribute('data-action'),
    id: element.getAttribute('data-id'),
    label: element.getAttribute('aria-label'),
  }));
  const dialog = page.locator('.modal-backdrop .modal[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getAttribute('aria-modal'), 'true',
    `${width}: modal 没有 aria-modal=true`);
  const focusableCount = await dialog.locator(
    'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
  ).count();
  assert.ok(focusableCount >= 2, `${width}: modal 可聚焦控件不足以验证焦点封闭`);
  assert.ok(await page.evaluate(() => {
    const modal = document.querySelector('.modal[role="dialog"]');
    return Boolean(modal && modal.contains(document.activeElement));
  }), `${width}: modal 打开后焦点没有进入对话框`);

  for (let index = 0; index < focusableCount + 1; index += 1) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => {
      const modal = document.querySelector('.modal[role="dialog"]');
      return Boolean(modal && modal.contains(document.activeElement));
    }), `${width}: Tab 焦点逃出 modal`);
  }
  for (let index = 0; index < focusableCount + 1; index += 1) {
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(() => {
      const modal = document.querySelector('.modal[role="dialog"]');
      return Boolean(modal && modal.contains(document.activeElement));
    }), `${width}: Shift+Tab 焦点逃出 modal`);
  }

  const tabHost = width > 1050 ? '.desktop-nav' : '.bottom-nav';
  const backgroundTab = page.locator(`${tabHost} [data-action="tab"][data-id="build"]`);
  const beforeModalClass = await page.locator('.game-page').getAttribute('class');
  // Dispatch directly: a physical click at this position hits the modal backdrop.
  await backgroundTab.dispatchEvent('click');
  assert.equal(await page.locator('.game-page').getAttribute('class'), beforeModalClass,
    `${width}: modal 打开时强制背景点击改变了 view`);
  assert.equal(await dialog.count(), 1, `${width}: 背景操作意外关闭 modal`);

  await dialog.locator('[data-action="modal-close"][data-autofocus]').click();
  await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
  assert.ok(await page.evaluate(({ action, id, label }) => {
    const active = document.activeElement;
    return active?.getAttribute('data-action') === action &&
      active?.getAttribute('data-id') === id &&
      active?.getAttribute('aria-label') === label;
  }, triggerMeta), `${width}: modal 关闭后焦点没有返回具体 trigger`);
  assert.ok(Math.abs(await mapScrollTop(page) - initial) <= 2,
    `${width}: 地图滚动位置未跨 modal render 保留`);

  await clickVisibleAction(page, 'tab', { id: 'build' });
  await page.locator('.game-layout.view-build').waitFor({ state: 'visible' });
  await clickVisibleAction(page, 'tab', { id: 'journey' });
  await waitForPhase(page, 'map');
  assert.ok(Math.abs(await mapScrollTop(page) - initial) <= 2,
    `${width}: 地图滚动位置未跨 build 往返保留`);
}

async function assertTabReadOnly(page, width) {
  const before = await storageSnapshot(page);
  const tabHost = width >= mobileNavBreakpoint ? '.desktop-nav' : '.bottom-nav';
  const expectedHeadings = {
    build: /命盘/,
    karma: /因缘/,
    journey: /山河|第一幕|地图/,
  };
  for (const id of ['build', 'karma', 'journey']) {
    const tab = await clickVisibleAction(page, 'tab', { id });
    await assertTouchTarget(tab, `${width} ${id} 导航`);
    await page.locator(`${tabHost} [data-action="tab"][data-id="${id}"][aria-current="page"]`)
      .waitFor({ state: 'visible' });
    const stageText = await page.locator('.main-stage').textContent();
    assert.match(stageText || '', expectedHeadings[id], `${width}: ${id} tab 没有渲染对应页面`);
    assert.equal(await currentPhase(page), 'map', `${width}: 查看 ${id} 改变了游戏 phase`);
    await noOverflow(page, `${width} ${id}`);
    await assertReadable(page, '.main-stage h1', `${width} ${id} 标题`);
    await assertNoAlerts(page, `${width} ${id} tab`);
  }
  const after = await storageSnapshot(page);
  assert.deepEqual(after, before, `${width}: 切 tab 改变了存档或本地状态`);
}

async function seedBuildDetails(page) {
  return page.evaluate(async () => {
    const [{ loadContent }, { loadRun, saveRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = loadRun(content);
    if (!game) throw new Error('Build fixture has no run');
    const state = game.state;
    const method = content.byId[state.method];
    const methodTalents = Array.isArray(method?.talents) ? method.talents : [];
    const talent = methodTalents.find(candidate => candidate && candidate.tier === 1);
    const artifact = content.entities.find(entity =>
      entity.kind === 'artifact' && Number.isInteger(entity.max_stacks) && entity.max_stacks >= 2);
    if (!talent || !artifact) throw new Error('Build fixture lacks talent or artifact content');
    const cumulative = content.byId.RULES?.cultivation?.cumulative;
    const tier = Number.isInteger(talent.tier) ? talent.tier : 1;
    const requiredXp = Number.isFinite(cumulative?.[tier - 1]) ? cumulative[tier - 1] : 120;
    // This is a UI-only fixture. Keep the saved state legal for the real run
    // validator: the selected embedded talent is unlocked by n/xp and the
    // artifact stack stays within the authored max_stacks.
    state.n = Math.max(state.n, tier);
    state.xp = Math.max(state.xp, requiredXp);
    state.talents[state.method] = [talent.id];
    state.artifacts = [{ id: artifact.id, stacks: Math.min(2, artifact.max_stacks) }];
    saveRun(game);
    return {
      methodId: state.method,
      methodName: content.byId[state.method]?.name || state.method,
      talentName: talent.name,
      artifactName: artifact.name,
      talentTier: tier,
      requiredXp,
    };
  });
}

async function assertBuildSurface(page, width) {
  const seeded = await seedBuildDetails(page);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
  await waitForPhase(page, 'map');
  await clickVisibleAction(page, 'tab', { id: 'build' });
  await page.locator('.game-layout.view-build').waitFor({ state: 'visible' });
  const text = await page.locator('.game-layout').textContent();
  assert.match(text || '', /命盘/, `${width}: 命盘页缺少标题`);
  assert.match(text || '', new RegExp(seeded.methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${width}: 命盘页没有展示当前功法`);
  assert.match(text || '', new RegExp(seeded.talentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${width}: 命盘页没有展示天赋`);
  assert.match(text || '', new RegExp(seeded.artifactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${width}: 命盘页没有展示法宝`);
  assert.match(text || '', /×\s*2|2\s*层|叠加后\s*×\s*2/,
    `${width}: 命盘页没有展示法宝叠层`);
  assert.ok(await page.locator('.deck-grid, .build-focus, .profile-build').count() > 0,
    `${width}: 命盘页缺少构筑内容区域`);
  await noOverflow(page, `${width} build`);
  await assertReadable(page, '.build-focus-title, .ability-card .card-title, .talent-ledger article p',
    `${width} build 内容`);

  const railTalentTrigger = page.locator('.player-rail .profile-talent').first();
  const talentTrigger = await railTalentTrigger.isVisible()
    ? railTalentTrigger
    : page.locator('.talent-ledger .talent-record-trigger').first();
  assert.equal(await talentTrigger.evaluate(element => element.tagName), 'BUTTON',
    `${width}: 玩家栏天赋详录入口不是按钮`);
  assert.match(await talentTrigger.getAttribute('aria-label') || '', /详录/,
    `${width}: 玩家栏天赋入口缺少明确的无障碍名称`);
  await talentTrigger.focus();
  const talentTriggerIdentity = await talentTrigger.evaluate(element => ({
    id: element.getAttribute('data-id'),
    method: element.getAttribute('data-method'),
    region: element.closest('.player-rail') ? 'rail' : 'main',
  }));
  await page.keyboard.press('Enter');
  const talentDialog = page.locator('.talent-dialog[role="dialog"][aria-modal="true"]');
  await talentDialog.waitFor({ state: 'visible' });
  assert.match(await talentDialog.locator('#dialog-title').textContent() || '',
    new RegExp(seeded.talentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${width}: 天赋详录没有展示对应天赋`);
  assert.ok(await talentDialog.locator('.effect-list p').count() > 0,
    `${width}: 天赋详录缺少完整效果`);
  await talentDialog.locator('[data-action="modal-close"][data-autofocus]').click();
  await page.locator('.talent-dialog').waitFor({ state: 'detached' });
  const restoredTalentFocus = await page.evaluate(({ id, method }) => {
    const active = document.activeElement;
    return {
      action: active?.getAttribute('data-action') || null,
      id: active?.getAttribute('data-id') || null,
      method: active?.getAttribute('data-method') || null,
      region: active?.closest('.player-rail') ? 'rail' : 'main',
      text: active?.textContent?.trim().slice(0, 40) || null,
      expectedId: id,
      expectedMethod: method,
    };
  }, talentTriggerIdentity);
  assert.equal(restoredTalentFocus.action, 'inspect-talent',
    `${width}: 关闭天赋详录后焦点没有返回原入口 ${JSON.stringify(restoredTalentFocus)}`);
  assert.equal(restoredTalentFocus.id, talentTriggerIdentity.id,
    `${width}: 天赋详录焦点返回了错误天赋 ${JSON.stringify(restoredTalentFocus)}`);
  assert.equal(restoredTalentFocus.method, talentTriggerIdentity.method,
    `${width}: 天赋详录焦点返回了错误功法入口 ${JSON.stringify(restoredTalentFocus)}`);
  assert.equal(restoredTalentFocus.region, talentTriggerIdentity.region,
    `${width}: 天赋详录焦点返回了错误的页面区域`);
  const profileDetails = page.locator('.player-rail details[data-details="profile-details"]');
  if (await profileDetails.isVisible()) {
    await profileDetails.locator('summary').click();
    const ledgerTalent = page.locator('.talent-ledger .talent-record-trigger').first();
    await ledgerTalent.click();
    await talentDialog.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await talentDialog.waitFor({ state: 'detached' });
    assert.equal(await ledgerTalent.evaluate(element => element === document.activeElement), true,
      `${width}: 同一天赋的侧栏入口可见时，焦点应返回命盘原入口`);
    await profileDetails.locator('summary').click();
  }
  await noOverflow(page, `${width} talent detail`);

  const filters = page.locator('[data-action="build-filter"]');
  assert.equal(await filters.count(), 2, `${width}: 命盘缺少 owned/all 筛选`);
  const filterValues = await filters.evaluateAll(buttons =>
    buttons.map(button => button.getAttribute('data-filter')).sort());
  assert.deepEqual(filterValues, ['all', 'owned'], `${width}: 命盘筛选值不是 owned/all`);
  const ownedFilter = page.locator('[data-action="build-filter"][data-filter="owned"]');
  const allFilter = page.locator('[data-action="build-filter"][data-filter="all"]');
  await assertTouchTarget(ownedFilter, `${width} 命盘持有筛选`);
  await assertTouchTarget(allFilter, `${width} 命盘图鉴筛选`);
  assert.equal(await ownedFilter.getAttribute('aria-pressed'), 'true',
    `${width}: 命盘默认筛选不是持有法宝`);
  const ownedEntries = await page.locator('.deck-grid > .ability-card:visible').count();
  assert.ok(ownedEntries >= 1, `${width}: 持有筛选没有展示已持有法宝`);
  await allFilter.click();
  await page.locator('[data-action="build-filter"][data-filter="all"][aria-pressed="true"]')
    .waitFor({ state: 'visible' });
  const allEntries = await page.locator('.deck-grid > .ability-card:visible').count();
  assert.ok(allEntries > ownedEntries,
    `${width}: all 筛选没有展开法宝图鉴 ${JSON.stringify({ ownedEntries, allEntries })}`);
  await ownedFilter.click();
  await page.locator('[data-action="build-filter"][data-filter="owned"][aria-pressed="true"]')
    .waitFor({ state: 'visible' });
  assert.equal(await page.locator('.deck-grid > .ability-card:visible').count(), ownedEntries,
    `${width}: owned 筛选返回后可见法宝数量改变`);

  const rarityGroup = page.locator('[role="group"][aria-label="按品阶筛选"]');
  assert.equal(await rarityGroup.locator('[data-action="build-rarity-filter"]').count(), 4,
    `${width}: 法宝图鉴缺少品阶筛选`);
  await allFilter.click();
  await page.locator('[data-action="build-filter"][data-filter="all"][aria-pressed="true"]')
    .waitFor({ state: 'visible' });
  await clickVisibleAction(page, 'build-rarity-filter', { rarity: 'rare' });
  await page.locator('[data-action="build-rarity-filter"][data-rarity="rare"][aria-pressed="true"]')
    .waitFor({ state: 'visible' });
  const rareCards = page.locator('.deck-grid > .ability-card:visible');
  assert.ok(await rareCards.count() > 0, `${width}: 稀有品阶筛选没有法宝`);
  assert.ok(await rareCards.evaluateAll(cards =>
    cards.every(card => card.classList.contains('rarity-rare'))),
  `${width}: 稀有筛选显示了其它品阶的法宝`);
  await clickVisibleAction(page, 'build-rarity-filter', { rarity: 'all' });
  await page.locator('[data-action="build-rarity-filter"][data-rarity="all"][aria-pressed="true"]')
    .waitFor({ state: 'visible' });

  const visibleArtifact = page.locator('.deck-grid [data-action="inspect-artifact"]').first();
  await visibleArtifact.waitFor({ state: 'visible' });
  await assertTouchTarget(visibleArtifact, `${width} 命盘法宝详录`);
  const saveBeforeArtifact = await savedState(page);
  await visibleArtifact.focus();
  await page.keyboard.press('Enter');
  const itemDialog = page.locator('.item-dialog[role="dialog"][aria-modal="true"]');
  await itemDialog.waitFor({ state: 'visible' });
  assert.ok(await itemDialog.locator('.effect-list p').count() > 0,
    `${width}: 法宝详录没有展示效果`);
  assert.equal((await savedState(page)).text, saveBeforeArtifact.text,
    `${width}: 查看命盘法宝详录改写了命途存档`);
  await itemDialog.locator('[data-action="modal-close"][data-autofocus]').click();
  await itemDialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')),
    'inspect-artifact', `${width}: 关闭命盘法宝详录后焦点没有返回入口`);
  await noOverflow(page, `${width} build item detail`);

  const visibleCopy = await page.locator('#shanhai-app').innerText();
  assert.doesNotMatch(visibleCopy, /行为|五维|有限坊市|节点休整|新入库|故事线|选项配置异常/,
    `${width}: 玩家界面仍包含内部术语`);
}

async function assertBottomNavDoesNotCoverLastChoice(page, width) {
  if (width >= mobileNavBreakpoint) return;
  const bottom = page.locator('.bottom-nav');
  const bottomRect = await bottom.boundingBox();
  assert.ok(bottomRect, `${width}: bottom-nav 没有布局框`);
  const last = page.locator('.main-stage button:visible').last();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(30);
  const lastRect = await last.boundingBox();
  assert.ok(lastRect, `${width}: 页面没有可滚动到的最后选择`);
  assert.ok(lastRect.y + lastRect.height <= bottomRect.y + 1,
    `${width}: bottom-nav 覆盖最后选择 ${JSON.stringify({ lastRect, bottomRect })}`);
}

async function assertKarmaHistory(page) {
  await createFixture(page, 'event', 'classic-ui-karma');
  const choice = page.locator('[data-action="event"]:not([disabled])').first();
  await choice.scrollIntoViewIfNeeded();
  await choice.click();
  const afterChoice = await currentPhase(page);
  if (afterChoice === 'preview') {
    await waitForPhase(page, 'preview');
    await clickVisibleAction(page, 'fight');
    await waitForPhase(page, 'battle');
    await clickVisibleAction(page, 'battle-skip');
    await page.locator('[data-action="battle-finish"]').waitFor({ state: 'visible' });
    await clickVisibleAction(page, 'battle-finish');
    await waitForPhase(page, 'event_result');
  } else {
    await waitForPhase(page, 'event_result');
  }
  await clickVisibleAction(page, 'continue');
  await waitForPhase(page, 'map');
  const saved = await savedState(page);
  assert.ok(saved.state.history.length > 0, '事件完成后没有真实行迹履历');
  const latest = saved.state.history.at(-1);
  await clickVisibleAction(page, 'tab', { id: 'karma' });
  const karmaText = await page.locator('.main-stage').textContent();
  assert.match(karmaText || '', /因缘/, '因缘页缺少标题');
  assert.ok(await page.locator('.timeline, .history-list, .story-memory, .history-panel').count() > 0,
    '因缘页缺少履历容器');
  assert.ok(karmaText?.includes(latest.title) || karmaText?.includes(latest.text),
    '因缘页没有展示最新真实履历');
  assert.match(await page.locator('.timeline-item').first().locator('small').textContent() || '',
    new RegExp(`节点\\s*${Number(latest.step) + 1}`),
    '因缘履历仍显示 0 起始的节点序号');
  await noOverflow(page, '因缘履历');
  await assertReadable(page, '.timeline-item h3, .timeline-item p, .timeline-item small',
    '因缘履历内容');
}

async function assertEventSurface(page, width) {
  await createFixture(page, 'event', `mature-ui-event-${width}`, { coins: 0 });
  await waitForPhase(page, 'event');
  await noOverflow(page, `${width} event`);
  await assertReadable(page, '.event-scene-head h2, .story-text, .event-option-main > b, .event-option-main > small',
    `${width} event copy`);
  const available = page.locator('[data-action="event"]:not([disabled])').first();
  await assertTouchTarget(available, `${width} 行旅选项`);
  const disabled = page.locator('[data-action="event"][disabled]');
  if (await disabled.count()) {
    const reason = disabled.first().locator('.disabled-reason');
    assert.ok((await reason.textContent())?.trim(),
      `${width}: 不可用行旅选项缺少可见原因`);
  }
}

async function assertRestSurface(page, width) {
  await createFixture(page, 'rest', `mature-ui-rest-${width}`);
  await waitForPhase(page, 'rest');
  await noOverflow(page, `${width} rest`);
  await assertReadable(page, '.rest-summary b, .rest-choice b, .rest-choice p',
    `${width} rest copy`);
  const available = page.locator('.rest-choice:not([disabled])').first();
  await assertTouchTarget(available, `${width} 休整主操作`);
  const disabled = page.locator('.rest-choice[disabled]');
  if (await disabled.count()) {
    assert.ok((await disabled.first().innerText()).trim().length > 0,
      `${width}: 不可用休整选项缺少原因`);
  }
}

async function assertCombatSurface(page, width) {
  await createFixture(page, 'battle', `classic-ui-battle-${width}`);
  assert.equal(await currentPhase(page), 'battle', `${width}: 战斗 fixture 阶段错误`);
  assert.equal(await page.locator('.game-page.phase-battle').count(), 1,
    `${width}: phase-battle 标记丢失`);
  assert.equal(await page.locator('[data-phase="battle"]').count(), 1,
    `${width}: data-phase=battle 标记丢失`);
  assert.equal(await page.locator('.game-layout.in-combat').count(), 1,
    `${width}: 战斗没有 in-combat 布局`);
  assert.equal(await page.locator('.game-layout.in-combat .player-rail').count(), 0,
    `${width}: 战斗仍显示人物侧栏`);
  assert.equal(await page.locator('.game-layout.in-combat .main-stage').count(), 1,
    `${width}: 战斗缺少主舞台`);
  assert.equal(await page.locator('.combatant').count(), 2, `${width}: 战斗没有双方立绘`);
  assert.equal(await page.locator('.combatant .fighter-art').count(), 2,
    `${width}: 双方立绘容器不完整`);
  assert.equal(await page.locator('.combatant .bar.hp').count(), 2,
    `${width}: 双方缺少气血条`);
  assert.equal(await page.locator('.combatant .bar.rage').count(), 2,
    `${width}: 双方缺少怒气条`);
  assert.equal(await page.locator('.combatant .shield-count').count(), 2,
    `${width}: 双方缺少护盾数值`);
  for (const action of ['battle-speed', 'battle-pause', 'battle-skip']) {
    assert.ok(await page.locator(`[data-action="${action}"]:visible`).count() > 0,
      `${width}: 缺少战斗动作 ${action}`);
  }
  assert.ok(await page.locator('[data-action="battle-speed"][data-speed="2"]:visible').count() > 0,
    `${width}: 缺少二倍速按钮`);
  const controlGeometry = await page.locator('.battle-controls').evaluate(element => {
    const parent = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll('button')].filter(button =>
      button.getClientRects().length > 0).map(button => {
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
      parent: { x: parent.x, y: parent.y, right: parent.right, bottom: parent.bottom },
      buttons,
      arenaBottom: document.querySelector('.combat-arena')?.getBoundingClientRect().bottom ?? 0,
    };
  });
  assert.ok(controlGeometry.buttons.length >= 5,
    `${width}: 斗法控制组缺少速度、暂停或主要操作`);
  assert.ok(controlGeometry.buttons.every(button =>
    button.width >= 44 && button.height >= 44 &&
    button.x >= controlGeometry.parent.x - 1 &&
    button.right <= controlGeometry.parent.right + 1 &&
    button.y >= controlGeometry.parent.y - 1 &&
    button.bottom <= controlGeometry.parent.bottom + 1),
  `${width}: 斗法控件触控面积不足或超出控制栏 ${JSON.stringify(controlGeometry)}`);
  assert.ok(controlGeometry.buttons.every((button, index, buttons) =>
    buttons.slice(index + 1).every(other =>
      button.right <= other.x + 1 || other.right <= button.x + 1 ||
      button.bottom <= other.y + 1 || other.bottom <= button.y + 1)),
  `${width}: 斗法控制按钮互相覆盖 ${JSON.stringify(controlGeometry.buttons)}`);
  assert.ok(controlGeometry.arenaBottom <= controlGeometry.parent.y + 2,
    `${width}: 斗法控制栏覆盖战斗场地 ${JSON.stringify(controlGeometry)}`);
  await assertReadable(page, '.combatant h2, .battle-context strong, [data-battle-round]',
    `${width} battle resources`);
  for (const button of await page.locator('.battle-controls button:visible').all()) {
    await assertTouchTarget(button, `${width} 斗法控制`);
  }
  await noOverflow(page, `${width} battle controls`);

  const logDisclosure = page.locator('details[data-details="battle-log"]');
  assert.equal(await logDisclosure.getAttribute('open'), null,
    `${width}: 战报应默认折叠`);
  await logDisclosure.locator('summary').click();
  assert.equal(await logDisclosure.getAttribute('open'), '',
    `${width}: 战报摘要没有展开战报`);

  await setReplayCursor(page, 0);
  const before = await savedState(page);
  const beforeText = before.text;
  const recordedFrames = (await battleSnapshot(page)).frames;
  const frameCount = recordedFrames.length;
  assert.ok(frameCount > 8, `${width}: 战斗帧过少，无法验收回放游标 ${frameCount}`);

  await clickVisibleAction(page, 'battle-speed', { speed: 2 });
  assert.equal(await page.locator('[data-action="battle-speed"][data-speed="2"]').getAttribute('aria-pressed'), 'true',
    `${width}: 二倍速没有生效`);
  assert.equal((await savedState(page)).text, beforeText,
    `${width}: 倍速改写了运行时存档`);

  await clickVisibleAction(page, 'battle-pause');
  await page.locator('[data-action="battle-pause"][aria-pressed="true"]').waitFor();
  const pausedFrame = await page.locator('.round-seal').textContent();
  const pausedCursor = (await replayState(page))?.cursor ?? 0;
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.round-seal').textContent(), pausedFrame,
    `${width}: 暂停后战斗帧仍在推进`);
  assert.equal((await replayState(page))?.cursor ?? 0, pausedCursor,
    `${width}: 暂停后回放游标仍在推进`);
  assert.equal((await savedState(page)).text, beforeText,
    `${width}: 暂停改写了运行时存档`);

  // Modal renders must freeze the same paused cursor and keep the pause
  // semantic when the user returns to the battle.
  await clickVisibleAction(page, 'settings');
  await page.locator('.modal-backdrop .modal[role="dialog"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(1100);
  assert.equal((await replayState(page))?.cursor ?? 0, pausedCursor,
    `${width}: 开 modal 后暂停游标发生变化`);
  await page.locator('.modal-backdrop .modal [data-action="modal-close"][data-autofocus]').click();
  await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-action="battle-pause"]').getAttribute('aria-pressed'), 'true',
    `${width}: 关闭 modal 后丢失用户暂停语义`);

  await clickVisibleAction(page, 'battle-speed', { speed: 4 });
  assert.equal((await savedState(page)).text, beforeText,
    `${width}: 暂停时倍速改写了运行时存档`);

  // A tab render must not advance the cursor while the battle view is away.
  await clickVisibleAction(page, 'battle-pause');
  await page.locator('[data-action="battle-pause"][aria-pressed="false"]').waitFor();
  await clickVisibleAction(page, 'tab', { id: 'build' });
  await page.locator('.game-layout.view-build').waitFor({ state: 'visible' });
  const awayCursor = (await replayState(page))?.cursor ?? 0;
  await page.waitForTimeout(1100);
  assert.equal((await replayState(page))?.cursor ?? 0, awayCursor,
    `${width}: 切到命盘后战斗游标仍在推进`);
  await clickVisibleAction(page, 'tab', { id: 'journey' });
  await waitForPhase(page, 'battle');
  assert.equal(await page.locator('[data-action="battle-pause"]').getAttribute('aria-pressed'), 'false',
    `${width}: 回到斗法后错误恢复为暂停`);
  await page.waitForFunction(({ replayKey, previous }) => {
    try {
      const value = JSON.parse(localStorage.getItem(replayKey) || 'null');
      return Number.isInteger(value?.cursor) && value.cursor > previous;
    } catch {
      return false;
    }
  }, { replayKey, previous: awayCursor });
  await clickVisibleAction(page, 'battle-pause');
  await page.locator('[data-action="battle-pause"][aria-pressed="true"]').waitFor();

  // Position the active replay in the middle so a real new frame exercises
  // log scroll preservation, then render the complete battle history.
  const middle = Math.min(20, frameCount - 2);
  await setReplayCursor(page, middle);
  const log = page.locator('.battle-log');
  const middleLog = await log.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert.ok(middleLog.scrollHeight > middleLog.clientHeight + 1,
    `${width}: 中途战报没有可滚动历史 ${JSON.stringify(middleLog)}`);
  await log.evaluate(element => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  const historyTop = await log.evaluate(element => element.scrollTop);
  const middleCursor = (await replayState(page))?.cursor ?? middle;
  assert.equal(await page.locator('[data-action="battle-pause"]').getAttribute('aria-pressed'), 'false',
    `${width}: 中途战报 fixture 意外处于暂停`);
  await page.waitForFunction(({ replayKey, previous }) => {
    try {
      const value = JSON.parse(localStorage.getItem(replayKey) || 'null');
      return Number.isInteger(value?.cursor) && value.cursor > previous;
    } catch {
      return false;
    }
  }, { replayKey, previous: middleCursor });
  assert.ok(Math.abs(await log.evaluate(element => element.scrollTop) - historyTop) <= 2,
    `${width}: 新帧渲染抢走了用户的战报滚动位置`);
  if (!(await logDisclosure.getAttribute('open'))) await logDisclosure.locator('summary').click();
  await clickVisibleAction(page, 'battle-log-mode');
  assert.ok(Math.abs(await log.evaluate(element => element.scrollTop) - historyTop) <= 2,
    `${width}: 战报模式重渲染抢走了历史滚动位置`);

  const outcomeBeforeSkip = (await savedState(page)).state.battle.outcome;
  await clickVisibleAction(page, 'battle-skip');
  await page.locator('[data-action="battle-finish"], [data-action="continue-battle"]').first()
    .waitFor({ state: 'visible' });
  assert.equal((await savedState(page)).state.battle.outcome, outcomeBeforeSkip,
    `${width}: 跳过播放改变了战斗胜负`);
  assert.equal((await savedState(page)).text, beforeText,
    `${width}: 跳过播放改写了运行时存档`);
  assert.ok(await page.locator('.battle-log').count() > 0, `${width}: 缺少战报`);
  assert.ok(await page.locator('.battle-log .battle-log-row').count() > 0,
    `${width}: 跳过后没有战报历史`);

  const logRows = await page.locator('.battle-log .battle-log-row').count();
  const logText = await log.textContent();
  if (logRows < recordedFrames.length) {
    const missing = recordedFrames
      .map(frame => frame.text)
      .filter(text => text && !logText?.includes(text));
    assert.deepEqual(missing, [], `${width}: 折叠战报丢失 recorded frame ${missing.join(' | ')}`);
  } else {
    assert.equal(logRows, recordedFrames.length,
      `${width}: 战报行数与 recorded frames 不一致`);
  }

  const logMetrics = await log.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert.ok(logMetrics.scrollHeight > logMetrics.clientHeight + 1,
    `${width}: 完整战报没有可滚动历史 ${JSON.stringify(logMetrics)}`);
  await log.evaluate(element => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  const follow = page.locator('[data-action="battle-log-follow"]');
  assert.ok(await follow.isVisible(), `${width}: 用户离开战报顶部后 follow 未立即可见`);
  await follow.click();
  await page.waitForFunction(() => {
    const element = document.querySelector('.battle-log');
    return element && element.scrollHeight - element.clientHeight - element.scrollTop < 2;
  });

  const ordinaryIndex = recordedFrames.findIndex((frame, index) =>
    index > 0 &&
    frame.kind === 'damage' &&
    frame.target === 'enemy' &&
    Number(frame.amount) > 0 &&
    frame.enemy.hp < recordedFrames[index - 1].enemy.hp &&
    !/暴击/.test(String(frame.text)));
  assert.ok(ordinaryIndex >= 1, `${width}: 没有可验证的普通非暴击伤害帧`);
  await setReplayCursor(page, ordinaryIndex, true, true);
  assert.equal(Number(await page.locator('.combat-arena').getAttribute('data-frame-index')),
    ordinaryIndex, `${width}: 普通伤害回放帧未能及时暂停`);
  assert.equal(await page.locator('[data-frame-kind="damage"]').count(), 1,
    `${width}: 普通伤害帧没有渲染`);
  assert.equal(await page.locator('.combat-float.damage.crit').count(), 0,
    `${width}: 普通非暴击 damage 出现暴击装饰`);

  await assertVisualAssets(page, `${width} battle`);
  if (await page.locator('[data-action="battle-finish"]:visible').count()) {
    await clickVisibleAction(page, 'battle-finish');
    await waitForPhaseChange(page, 'battle');
  }
  await noOverflow(page, `${width} battle`);
}

async function toggleDetailedBattleLog(page) {
  await createFixture(page, 'battle', 'classic-ui-log-mode');
  await clickVisibleAction(page, 'battle-pause');
  const logDisclosure = page.locator('details[data-details="battle-log"]');
  assert.equal(await logDisclosure.getAttribute('open'), null, '战报应默认折叠');
  await logDisclosure.locator('summary').click();
  await clickVisibleAction(page, 'battle-log-mode');
  assert.ok(await page.locator('.battle-log.detailed-mode').count() === 1 ||
    (await page.locator('.log-mode').textContent()).includes('详录'),
  '详略战报开关没有切换到详录');
}

async function assertBattleTalentDetails(page) {
  await createFixture(page, 'battle', 'classic-ui-battle-talent-details', { selectedTalent: true });
  await waitForPhase(page, 'battle');
  await setReplayCursor(page, 0, true, true);
  const currentBuild = page.locator('details[data-details="battle-loadout"]');
  assert.equal(await currentBuild.getAttribute('open'), null,
    '战斗当前构筑应默认折叠');
  await currentBuild.locator('summary').click();
  const battleTalent = currentBuild.locator('.profile-talent').first();
  assert.equal(await battleTalent.evaluate(element => element.tagName), 'BUTTON',
    '战斗构筑天赋详录入口不是按钮');
  await battleTalent.focus();
  await page.keyboard.press('Enter');
  const talentDialog = page.locator('.talent-dialog[role="dialog"][aria-modal="true"]');
  await talentDialog.waitFor({ state: 'visible' });
  assert.ok(await talentDialog.locator('.effect-list p').count() > 0,
    '战斗构筑天赋详录缺少完整效果');
  await talentDialog.locator('[data-action="modal-close"][data-autofocus]').click();
  await page.locator('.talent-dialog').waitFor({ state: 'detached' });
  assert.ok(await page.evaluate(() => document.activeElement?.getAttribute('data-action') === 'inspect-talent'),
    '关闭战斗天赋详录后焦点没有返回天赋入口');
  assert.equal(await page.locator('[data-action="battle-pause"]').getAttribute('aria-pressed'), 'true',
    '查看天赋详录后战斗没有保持暂停');
}

async function assertShopUnavailableReason(page) {
  await createFixture(page, 'shop', 'classic-ui-shop-unavailable', { coins: 0 });
  await waitForPhase(page, 'shop');
  await noOverflow(page, '坊市');
  await assertReadable(page, '.shop-item-copy h2, .shop-item-copy p, .shop-item-unavailable',
    '坊市内容');
  await assertTouchTarget(page.locator('[data-action="leave-shop"]'), '离开坊市');
  const disabledPurchase = page.locator('.shop-item:not(.sold) [data-action="buy"][disabled]').first();
  await disabledPurchase.waitFor({ state: 'visible' });
  assert.equal(await disabledPurchase.getAttribute('title'), '灵石不足',
    '坊市禁购原因没有保留辅助说明');
  const visibleReason = await disabledPurchase.evaluate(button =>
    button.closest('.shop-item')?.querySelector('.shop-item-unavailable')?.textContent?.trim());
  assert.equal(visibleReason, '灵石不足',
    '坊市禁购原因只放在 title 中，没有可见文案');
  const artifactDetail = page.locator('.shop-item:not(.sold) [data-action="inspect-artifact"]').first();
  await artifactDetail.waitFor({ state: 'visible' });
  await assertTouchTarget(artifactDetail, '坊市法宝详录');
  const beforeDetail = await savedState(page);
  await artifactDetail.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('.item-dialog[role="dialog"][aria-modal="true"]');
  await dialog.waitFor({ state: 'visible' });
  assert.ok(await dialog.locator('.effect-list p').count() > 0,
    '坊市法宝详录没有展示效果');
  assert.equal((await savedState(page)).text, beforeDetail.text,
    '查看坊市法宝详录改写了命途存档');
  await dialog.locator('[data-action="modal-close"][data-autofocus]').click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')),
    'inspect-artifact', '关闭坊市法宝详录后焦点没有返回入口');
  await noOverflow(page, '坊市法宝详录');
  const copy = await page.locator('#shanhai-app').innerText();
  assert.doesNotMatch(copy, /有限坊市/, '坊市仍显示内部阶段用语');
}

async function runViewport(browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'unknown',
  }));
  try {
    await check(`${width} setup shell`, async () => {
      await setupRun(page, `classic-ui-${width}`);
      await enterMap(page);
      await assertNavigationShell(page, width);
      await assertMapSurface(page, width);
      await assertMapScrollPersistence(page, width);
      await noOverflow(page, `${width} map`);
    });
    await check(`${width} read-only tabs and build`, async () => {
      await assertTabReadOnly(page, width);
      await assertBuildSurface(page, width);
      await assertBottomNavDoesNotCoverLastChoice(page, width);
    });
    await check(`${width} event, shop, and rest surfaces`, async () => {
      await assertEventSurface(page, width);
      await assertShopUnavailableReason(page);
      await assertRestSurface(page, width);
    });
    if ([390, 1280, 1440].includes(width)) {
      await check(`${width} karma history`, () => assertKarmaHistory(page));
      await check(`${width} combat controls`, () => assertCombatSurface(page, width));
    }
    if (width === 390) {
      await check(`${width} battle loadout talent details`, () => assertBattleTalentDetails(page));
      await check(`${width} detailed battle log`, () => toggleDetailedBattleLog(page));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `${width}-classic-ui.png`),
      fullPage: true,
    });
    assert.deepEqual(pageErrors, [], `${width}: 浏览器 pageerror ${JSON.stringify(pageErrors)}`);
    assert.deepEqual(consoleErrors, [], `${width}: 浏览器 console error ${JSON.stringify(consoleErrors)}`);
    assert.deepEqual(failedRequests, [], `${width}: 资源加载失败 ${JSON.stringify(failedRequests)}`);
  } catch (error) {
    failures.push({
      viewport: width,
      message: error instanceof Error ? error.message : String(error),
      phase: await currentPhase(page).catch(() => null),
    });
  } finally {
    await context.close();
  }
}

async function run() {
  await mkdir(reportDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  try {
    for (const [width, height] of [
      [320, 760],
      [360, 780],
      [390, 844],
      [1280, 720],
      [1440, 900],
    ]) {
      await runViewport(browser, width, height);
    }
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      reportDir,
      generatedAt: new Date().toISOString(),
      checks,
      failures,
    }, null, 2) + '\n');
  }
  if (failures.length) {
    throw new Error(`Classic UI browser failures: ${JSON.stringify(failures)}`);
  }
  console.log(`Classic UI report: ${reportDir}`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
