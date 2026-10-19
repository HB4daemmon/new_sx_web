import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pauseNextReplay } from './shanhai-replay-fixture.mjs';
import { setSetupSeed } from './shanhai-setup-fixture.mjs';

const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const reportDir = process.env.SHANHAI_RESTART_REPORT_DIR
  ? path.resolve(process.env.SHANHAI_RESTART_REPORT_DIR)
  : await mkdtemp(path.join(os.tmpdir(), 'shanhai-restart-'));
const saveKey = 'suishi-shanhai-run-v1';
const replayKey = 'suishi-shanhai-replay-v1';
const archiveKey = 'suishi-shanhai-build-v1';
const fallbackName = '无名行者';
const checks = [];

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

async function check(name, run) {
  try {
    await run();
    checks.push({ name, ok: true });
    console.log(`ok - ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function clickAction(page, action, selector = `[data-action="${action}"]`) {
  const candidates = page.locator(selector);
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible()) || await candidate.isDisabled()) continue;
    await candidate.click();
    return candidate;
  }
  throw new Error(`找不到可见操作 ${selector}`);
}

async function waitForPhase(page, phase) {
  await page.locator(`.game-page.phase-${phase}`).waitFor({ state: 'visible' });
}

async function storageSnapshot(page) {
  return page.evaluate(() => Object.fromEntries(
    Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]),
  ));
}

async function savedRun(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, '缺少本局自动存档');
  const record = JSON.parse(text);
  assert.equal(record.key, saveKey);
  return { text, record, state: record.state };
}

async function noOverflow(page, width) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(metrics.document <= metrics.viewport + 1,
    `${width}px 页面横向溢出 ${JSON.stringify(metrics)}`);
  assert.ok(metrics.body <= metrics.viewport + 1,
    `${width}px body 横向溢出 ${JSON.stringify(metrics)}`);
}

async function clearAndOpen(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[name="player-name"]').waitFor({ state: 'visible' });
}

async function startFromLanding(page) {
  const seedInput = page.locator('[name="seed"]');
  assert.equal(await seedInput.getAttribute('type'), 'hidden', '首页测试种子应为隐藏字段');
  const method = await page.locator('.method-choice').first().getAttribute('data-id');
  assert.ok(method, '没有可用的开局功法');
  await clickAction(page, 'start');
  await waitForPhase(page, 'map');
  return { method, ...(await savedRun(page)) };
}

async function confirmRestart(page) {
  await page.locator('.modal-backdrop .modal[role="dialog"]').waitFor({ state: 'visible' });
  await clickAction(page, 'confirm-restart');
}

async function openSettings(page) {
  await clickAction(page, 'settings', '.topbar [data-action="settings"]');
  await page.locator('.settings-dialog[role="dialog"]').waitFor({ state: 'visible' });
}

async function clickRestart(page) {
  await openSettings(page);
  await clickAction(page, 'restart', '.settings-dialog [data-action="restart"]');
}

async function assertRestartCancel(page, mode) {
  const before = await storageSnapshot(page);
  await clickRestart(page);
  const dialog = page.locator('.modal-backdrop .modal[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  assert.match(await dialog.textContent() || '', /结束当前命途|通关构筑保留/);
  assert.equal(await page.evaluate(() =>
    document.activeElement?.textContent?.trim()), '先不重来',
  '确认重开弹窗默认焦点应放在取消操作');
  if (mode === 'escape') {
    await page.keyboard.press('Escape');
  } else if (mode === 'backdrop') {
    await page.locator('.modal-backdrop').dispatchEvent('click');
  } else {
    await clickAction(page, 'modal-close',
      '.modal-backdrop [data-action="modal-close"][data-autofocus]');
  }
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await storageSnapshot(page), before,
    `${mode}取消重开不应改写任何 localStorage`);
}

async function buildBattleFixture(page) {
  await page.evaluate(async ({ saveKey, replayKey }) => {
    const [{ loadContent }, { ShanhaiGame }, { saveRun }] = await Promise.all([
      import('/shanhai/content.js'),
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const content = await loadContent('/content/');
    const game = ShanhaiGame.create(content, {
      seed: 'restart-browser-battle-fixture',
      name: '斗法行者',
      method: 'RKF01',
    });
    const advance = () => {
      if (game.state.phase === 'map') {
        const node = game.availableNodes().find(candidate =>
          ['C', 'L', 'B', 'F'].includes(candidate.type)) || game.availableNodes()[0];
        if (!node) throw new Error('战斗 fixture 没有可前往节点');
        game.dispatch({ type: 'enter', id: node.key });
      } else if (game.state.phase === 'preview') {
        game.dispatch({ type: 'fight' });
      } else if (game.state.phase === 'battle') {
        if (game.state.battle?.outcome === 'draw') game.dispatch({ type: 'continue_battle' });
        else game.dispatch({ type: 'battle_done' });
      } else if (game.state.phase === 'reward') {
        game.dispatch({ type: 'reward', id: null });
      } else if (game.state.phase === 'event') {
        const event = content.byId[game.node.id];
        const option = event.options.find(candidate => game.optionAvailability(candidate).available);
        if (!option) throw new Error('战斗 fixture 事件没有可用选项');
        game.dispatch({ type: 'event', id: option.id });
      } else if (game.state.phase === 'event_result') {
        game.dispatch({ type: 'continue' });
      } else if (game.state.phase === 'shop') {
        game.dispatch({ type: 'leave_shop' });
      } else if (game.state.phase === 'rest') {
        game.dispatch({ type: 'rest', choice: 'heal' });
      } else if (game.state.phase === 'talent') {
        game.dispatch({ type: 'talent', id: game.availableTalents()[0].id });
      } else if (game.state.phase === 'transition') {
        game.dispatch({ type: 'continue' });
      } else {
        throw new Error(`无法从 ${game.state.phase} 推进 battle fixture`);
      }
    };
    let guard = 0;
    while (game.state.phase !== 'battle' && !['won', 'lost'].includes(game.state.phase) &&
      guard++ < 200) advance();
    if (game.state.phase !== 'battle') throw new Error('没有生成战斗 fixture');
    saveRun(game);
    localStorage.removeItem(replayKey);
    localStorage.setItem('restart-worker-other-key', 'keep-me');
  }, { saveKey, replayKey });
  await pauseNextReplay(page);
  await page.reload({ waitUntil: 'networkidle' });
  await waitForPhase(page, 'battle');
  await page.locator('.battle-shell[data-paused="true"]').waitFor();
  await page.evaluate(replayKey => {
    const key = document.querySelector('.battle-shell')?.getAttribute('data-battle-key');
    const cursor = Number(document.querySelector('.combat-arena')?.getAttribute('data-frame-index') || 0);
    localStorage.setItem(replayKey, JSON.stringify({ key, cursor }));
  }, replayKey);
}

async function run() {
  await mkdir(reportDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  try {
    for (const width of [360, 390, 1440]) {
      const height = width === 360 ? 780 : width === 390 ? 844 : 900;
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await check(`${width}px 设置重开命令尺寸与布局`, async () => {
        await clearAndOpen(page);
        const initialName = await page.locator('[name="player-name"]').inputValue();
        assert.ok(initialName.trim(), '首页姓名输入框没有默认道号');
        assert.notEqual(initialName, fallbackName, '新访问不应固定使用无名行者');
        assert.match(initialName, /[\p{Script=Han}]{2,}/u, '默认道号不是中文');
        await startFromLanding(page);
        await openSettings(page);
        const restart = page.locator('.settings-dialog [data-action="restart"]');
        await restart.waitFor({ state: 'visible' });
        assert.equal(await restart.getAttribute('aria-label'), '重开',
          `${width}px: 设置中的重开命令缺少无障碍名称`);
        const rect = await restart.boundingBox();
        assert.ok(rect && rect.width >= 44 && rect.height >= 44,
          `重开按钮触控区域不足 44px ${JSON.stringify(rect)}`);
        const controls = await page.locator('.header-actions button').evaluateAll(buttons =>
          buttons.map(button => {
            const rect = button.getBoundingClientRect();
            return { label: button.getAttribute('aria-label') || button.textContent, width: rect.width, height: rect.height };
          }));
        assert.ok(controls.every(control => control.width >= 44 && control.height >= 44),
          `顶部按钮触控区域不足 44px ${JSON.stringify(controls)}`);
        await clickAction(page, 'modal-close',
          '.settings-dialog [data-action="modal-close"][data-autofocus]');
        await noOverflow(page, width);
      });
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await clearAndOpen(page);
    await check('随机道号可重抽且重渲染保留手动姓名', async () => {
      const nameInput = page.locator('[name="player-name"]');
      const seedInput = page.locator('[name="seed"]');
      const shuffle = page.locator('[data-action="shuffle-name"]');
      const initialName = await nameInput.inputValue();
      const initialSeed = await seedInput.inputValue();
      assert.ok(initialName.trim(), '首页没有生成默认道号');
      assert.notEqual(initialName, fallbackName, '新访问不应固定使用无名行者');
      assert.match(initialName, /[\p{Script=Han}]{2,}/u, '默认道号不是中文');
      assert.equal(await seedInput.getAttribute('type'), 'hidden',
        '命数种子必须使用隐藏字段');
      assert.equal(await seedInput.isVisible(), false, '命数种子字段不应可见');
      const visibleSeedLabels = await page.locator('label:has([name="seed"])')
        .evaluateAll(labels => labels.filter(label =>
          label.getClientRects().length > 0 &&
          getComputedStyle(label).visibility !== 'hidden').length);
      assert.equal(visibleSeedLabels, 0, '首页不应显示命数种子标签');
      assert.equal(await page.locator('[data-action="shuffle-seed"]').count(), 0,
        '首页不应显示另择命数操作');
      assert.equal((await page.locator('.landing-page').innerText()).includes('命数种子'), false,
        '首页不应出现可见命数种子文案');
      assert.equal(await shuffle.count(), 1, '首页缺少随机道号按钮');
      assert.equal(await shuffle.evaluate(element => element.tagName), 'BUTTON');
      assert.equal(await shuffle.getAttribute('title'), '随机道号');
      assert.equal(await shuffle.getAttribute('aria-label'), '随机道号');
      const shuffleRect = await shuffle.boundingBox();
      assert.ok(shuffleRect && shuffleRect.width >= 44 && shuffleRect.height >= 44,
        `随机道号按钮触控区域不足 44px ${JSON.stringify(shuffleRect)}`);

      const beforeShuffle = await storageSnapshot(page);
      let previousName = initialName;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await shuffle.click();
        const nextName = await nameInput.inputValue();
        assert.ok(nextName.trim(), '随机道号按钮生成了空姓名');
        assert.notEqual(nextName, previousName, '连续随机道号不能与当前姓名相同');
        assert.equal(await seedInput.inputValue(), initialSeed,
          '随机道号不应修改命数种子');
        assert.deepEqual(await storageSnapshot(page), beforeShuffle,
          '随机道号不应写入或修改存档');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), null,
          '随机道号不应创建本局存档');
        previousName = nextName;
      }

      const manualName = '手动留下的道号';
      await nameInput.fill(manualName);
      await page.locator('.method-choice').nth(1).click();
      assert.equal(await nameInput.inputValue(), manualName,
        '切换开局功法重渲染丢失手动姓名');
      const detail = page.locator('details[data-details="landing-method"]');
      await detail.locator('summary').click();
      await detail.waitFor({ state: 'visible' });
      assert.equal(await detail.evaluate(element => element.open), true,
        '功法详录没有展开');
      assert.equal(await nameInput.inputValue(), manualName,
        '展开功法详录重渲染丢失手动姓名');
    });

    await clearAndOpen(page);
    await check('随机默认道号可直接开局并生成新命数', async () => {
      const defaultName = await page.locator('[name="player-name"]').inputValue();
      assert.ok(defaultName.trim());
      assert.notEqual(defaultName, fallbackName);
      const first = await startFromLanding(page);
      assert.equal(first.state.name, defaultName);
      assert.ok(first.state.seed);
    });

    await page.evaluate(({ archiveKey }) => {
      localStorage.setItem(archiveKey, '[]');
      localStorage.setItem('restart-worker-other-key', 'keep-me');
      localStorage.setItem('suishi-shanhai-replay-v1',
        JSON.stringify({ key: 'stale-map-replay', cursor: 7 }));
    }, { archiveKey });
    await check('地图重开取消、Escape、遮罩均不改存档', async () => {
      await assertRestartCancel(page, 'button');
      await assertRestartCancel(page, 'escape');
      await assertRestartCancel(page, 'backdrop');
    });

    await check('存档删除失败保留当前局并显示错误', async () => {
      const before = await savedRun(page);
      await page.evaluate(key => {
        Storage.prototype.__restartWorkerOriginal = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function removeItem(target) {
          if (target === key) throw new DOMException('blocked', 'SecurityError');
          return Storage.prototype.__restartWorkerOriginal.call(this, target);
        };
      }, saveKey);
      await clickRestart(page);
      await confirmRestart(page);
      await page.locator('.modal-backdrop').waitFor({ state: 'visible' });
      assert.match(await page.locator('.modal-backdrop').innerText(), /删除本局存档失败/);
      assert.equal(await page.locator('.game-page.phase-map').count(), 1,
        '删除失败后当前局没有留在内存中');
      assert.equal((await savedRun(page)).text, before.text,
        '删除失败后主存档被修改');
      await page.evaluate(() => {
        const original = Storage.prototype.__restartWorkerOriginal;
        Object.defineProperty(Storage.prototype, 'removeItem', {
          configurable: true,
          writable: true,
          value: original,
        });
        delete Storage.prototype.__restartWorkerOriginal;
      });
      await page.keyboard.press('Escape');
    });

    await check('确认重开清本局存档和回放但保留归档与其他键', async () => {
      const old = await savedRun(page);
      const method = old.state.method;
      const oldSeed = old.state.seed;
      await clickRestart(page);
      await confirmRestart(page);
      await page.locator('.landing-page').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), null);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), replayKey), null);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), archiveKey), '[]');
      assert.equal(await page.evaluate(() =>
        localStorage.getItem('restart-worker-other-key')), 'keep-me');
      assert.equal(await page.locator('[name="player-name"]').inputValue(), old.state.name);
      assert.equal(await page.locator('[name="seed"]').inputValue(), '');
      assert.equal(await page.locator('[name="seed"]').getAttribute('type'), 'hidden');
      assert.equal(await page.locator('.method-choice[aria-pressed="true"]').getAttribute('data-id'),
        method);
      assert.equal(await page.locator('.resume-card').count(), 0);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.landing-page').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), null,
        '刷新后旧局存档重新出现');
      assert.equal(await page.locator('.resume-card').count(), 0,
        '刷新后旧局继续入口重新出现');
      const newName = await page.locator('[name="player-name"]').inputValue();
      assert.ok(newName.trim(), '刷新首页后没有随机默认道号');
      assert.notEqual(newName, fallbackName, '刷新首页后不应使用固定默认姓名');
      const next = await startFromLanding(page);
      assert.equal(next.state.name, newName, '刷新后开局没有使用首页显示的道号');
      assert.equal(next.state.method, method);
      assert.notEqual(next.state.seed, oldSeed);
    });

    await check('回首页新开自动换命数，继续旧局保留原命数', async () => {
      const before = await savedRun(page);
      await clickAction(page, 'home', '.topbar [data-action="home"]');
      await page.locator('.landing-page').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[name="seed"]').inputValue(), '',
        '回首页不应把旧局命数预填到新局');
      assert.equal((await savedRun(page)).text, before.text,
        '回首页清理种子预填值不应修改旧局存档');
      await clickAction(page, 'continue', '.resume-card[data-action="continue"]');
      await waitForPhase(page, 'map');
      assert.equal((await savedRun(page)).text, before.text,
        '继续旧局应保留原命数和存档');

      await clickAction(page, 'home', '.topbar [data-action="home"]');
      await page.locator('.landing-page').waitFor({ state: 'visible' });
      await clickAction(page, 'start');
      assert.equal((await savedRun(page)).text, before.text,
        '确认新开前不应改写旧局存档');
      await confirmRestart(page);
      await waitForPhase(page, 'map');
      const next = await savedRun(page);
      assert.equal(next.state.name, before.state.name, '新局应沿用当前道号');
      assert.ok(next.state.seed, '新局没有自动生成命数');
      assert.notEqual(next.state.seed, before.state.seed, '新局沿用了旧局命数');
    });

    await check('首页覆盖旧存档先确认并使用已选姓名、种子与功法', async () => {
      await clickAction(page, 'home', '.topbar [data-action="home"]');
      await page.locator('.landing-page').waitFor({ state: 'visible' });
      const prior = await savedRun(page);
      const chosenName = '新名'.repeat(14);
      const expectedName = chosenName.slice(0, 24);
      const method = await page.locator('.method-choice').nth(1).getAttribute('data-id');
      await page.locator('[name="player-name"]').fill(chosenName);
      await setSetupSeed(page, 'homepage-selected-seed');
      await page.locator('.method-choice').nth(1).click();
      await clickAction(page, 'start');
      assert.equal(await page.locator('.modal-backdrop').count(), 1,
        '首页有旧存档时没有要求确认覆盖');
      assert.match(await page.locator('.modal-backdrop').innerText(), /按当前选择开启新命途/,
        '首页覆盖确认应准确说明按当前选择开局');
      assert.equal((await savedRun(page)).text, prior.text,
        '确认覆盖前旧存档已被静默修改');
      await clickAction(page, 'modal-close',
        '.modal-backdrop [data-action="modal-close"][data-autofocus]');
      assert.equal((await savedRun(page)).text, prior.text,
        '取消首页覆盖改写了旧存档');
      await clickAction(page, 'start');
      await confirmRestart(page);
      await waitForPhase(page, 'map');
      const current = await savedRun(page);
      assert.equal(current.state.name, expectedName);
      assert.equal(current.state.seed, 'homepage-selected-seed');
      assert.equal(current.state.method, method);
      await page.reload({ waitUntil: 'networkidle' });
      await waitForPhase(page, 'map');
      const restored = await savedRun(page);
      assert.equal(restored.state.name, expectedName);
      assert.equal(restored.state.seed, 'homepage-selected-seed',
        '刷新后旧局覆盖了刚创建的新局');
    });

    await check('空白姓名回退且结算页 new-run 使用同一确认流程', async () => {
      await page.evaluate(async ({ saveKey }) => {
        const [{ loadContent }, { ShanhaiGame }, { saveRun }] = await Promise.all([
          import('/shanhai/content.js'),
          import('/shanhai/run.js'),
          import('/shanhai/persistence.js'),
        ]);
        const content = await loadContent('/content/');
        const game = ShanhaiGame.create(content, {
          seed: 'ended-new-run-fixture',
          name: '结算行者',
          method: 'RKF01',
        });
        game.dispatch({ type: 'retire' });
        saveRun(game);
        localStorage.removeItem('suishi-shanhai-replay-v1');
      }, { saveKey });
      await page.reload({ waitUntil: 'networkidle' });
      await waitForPhase(page, 'lost');
      const before = await savedRun(page);
      await clickAction(page, 'new-run');
      assert.equal(await page.locator('.modal-backdrop').count(), 1);
      await clickAction(page, 'modal-close',
        '.modal-backdrop [data-action="modal-close"][data-autofocus]');
      assert.equal((await savedRun(page)).text, before.text);
      await clickAction(page, 'new-run');
      await confirmRestart(page);
      await page.locator('.landing-page').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), null);
      assert.equal(await page.locator('[name="player-name"]').inputValue(), '结算行者');
      await page.locator('[name="player-name"]').fill('   ');
      await clickAction(page, 'start');
      await waitForPhase(page, 'map');
      assert.equal((await savedRun(page)).state.name, fallbackName);
    });
    await context.close();

    const battleContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const battlePage = await battleContext.newPage();
    battlePage.setDefaultTimeout(15000);
    await clearAndOpen(battlePage);
    await buildBattleFixture(battlePage);
    await check('战斗取消保持原暂停状态，播放状态关闭弹窗后恢复', async () => {
      const pausedSnapshot = await storageSnapshot(battlePage);
      await clickRestart(battlePage);
      assert.equal(await battlePage.locator('.battle-shell').getAttribute('data-paused'), 'true');
      await battlePage.waitForTimeout(250);
      assert.deepEqual(await storageSnapshot(battlePage), pausedSnapshot,
        '战斗弹窗暂停期间仍写入回放');
      await battlePage.keyboard.press('Escape');
      assert.equal(await battlePage.locator('.battle-shell').getAttribute('data-paused'), 'true',
        '取消重开后原暂停状态未保留');
      assert.deepEqual(await storageSnapshot(battlePage), pausedSnapshot,
        '取消战斗重开改变了存档或回放');

      await clickAction(battlePage, 'battle-pause');
      await battlePage.locator('.battle-shell[data-paused="false"]').waitFor();
      await clickRestart(battlePage);
      const held = await storageSnapshot(battlePage);
      const cursor = JSON.parse(held[replayKey] || 'null')?.cursor ?? 0;
      await battlePage.waitForTimeout(300);
      assert.deepEqual(await storageSnapshot(battlePage), held,
        '播放状态打开重开弹窗后仍推进了回放');
      await battlePage.keyboard.press('Escape');
      await battlePage.locator('.battle-shell[data-paused="false"]').waitFor();
      await battlePage.waitForFunction(({ replayKey, cursor }) => {
        try {
          const value = JSON.parse(localStorage.getItem(replayKey) || 'null');
          return Number.isInteger(value?.cursor) && value.cursor > cursor;
        } catch {
          return false;
        }
      }, { replayKey, cursor }, { timeout: 8000 });
    });

    await check('确认重开战斗后不会重写旧回放', async () => {
      await clickAction(battlePage, 'battle-pause');
      await battlePage.locator('.battle-shell[data-paused="true"]').waitFor();
      await battlePage.evaluate(key => {
        localStorage.setItem(key, '[]');
        localStorage.setItem('restart-worker-other-key', 'keep-me');
      }, archiveKey);
      await clickRestart(battlePage);
      await confirmRestart(battlePage);
      await battlePage.locator('.landing-page').waitFor({ state: 'visible' });
      await battlePage.waitForTimeout(350);
      assert.equal(await battlePage.evaluate(key => localStorage.getItem(key), saveKey), null);
      assert.equal(await battlePage.evaluate(key => localStorage.getItem(key), replayKey), null);
      assert.equal(await battlePage.evaluate(key => localStorage.getItem(key), archiveKey), '[]');
      assert.equal(await battlePage.evaluate(() =>
        localStorage.getItem('restart-worker-other-key')), 'keep-me');
      assert.equal(await battlePage.locator('[name="player-name"]').inputValue(), '斗法行者');
      assert.equal(await battlePage.locator('[name="seed"]').inputValue(), '');
      assert.equal(await battlePage.locator('[name="seed"]').getAttribute('type'), 'hidden');
    });
    await battleContext.close();
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      generatedAt: new Date().toISOString(),
      checks,
    }, null, 2) + '\n');
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
