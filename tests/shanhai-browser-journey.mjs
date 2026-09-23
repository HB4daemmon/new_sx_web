import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { parseRunSave } from '../build/shanhai/persistence.js';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { nextCommand } from './shanhai-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const reportOverride = process.env.BROWSER_REPORT_DIR || process.env.BROWSER_OUTPUT_DIR;
const reportDir = reportOverride
  ? path.resolve(reportOverride)
  : path.join(root, 'verification', 'shanhai', 'browser-journey');
const screenshotDir = path.join(reportDir, 'screenshots');
const saveKey = 'suishi-shanhai-run-v1';
const buildKey = 'suishi-shanhai-build-v1';
const seed = process.env.SHANHAI_JOURNEY_SEED || 'browser-journey-45';
const playerName = '真实浏览器行者';

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

function relativePath(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function safePart(value) {
  return String(value ?? 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function currentPhase(page) {
  return page.locator('.game-page').getAttribute('class').then(value =>
    value?.match(/phase-([a-z_]+)/)?.[1] || null);
}

async function waitForPhase(page, expected) {
  await page.locator('.game-page').waitFor({ state: 'visible' });
  await page.waitForFunction(
    phase => document.querySelector('.game-page')?.classList.contains(`phase-${phase}`),
    expected,
  );
}

async function waitForPhaseChange(page, previous) {
  await page.waitForFunction(
    phase => {
      const element = document.querySelector('.game-page');
      return Boolean(element && !element.classList.contains(`phase-${phase}`));
    },
    previous,
  );
}

async function waitForSaveChange(page, previousText) {
  await page.waitForFunction(
    ({ key, previous }) => window.localStorage.getItem(key) !== previous,
    { key: saveKey, previous: previousText },
  );
}

async function readSave(page) {
  const text = await page.evaluate(key => window.localStorage.getItem(key), saveKey);
  assert.ok(text, '浏览器没有自动存档');
  const record = JSON.parse(text);
  assert.equal(record?.key, saveKey, '自动存档 key 不正确');
  assert.ok(record?.state, '自动存档没有 state');
  return { text, record, state: record.state };
}

function restoreDecisionModel(content, saveText) {
  return new ShanhaiGame(content, parseRunSave(content, saveText));
}

async function clickMatchingAction(page, action, attributes = {}) {
  const candidates = page.locator(`[data-action="${action}"]`);
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    let matches = true;
    for (const [key, expected] of Object.entries(attributes)) {
      if ((await candidate.getAttribute(`data-${key}`)) !== String(expected)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      await candidate.scrollIntoViewIfNeeded();
      await candidate.waitFor({ state: 'visible' });
      await candidate.click();
      return;
    }
  }
  throw new Error(`找不到可见按钮 data-action=${action} ${JSON.stringify(attributes)}`);
}

async function clickAndWaitForDispatch(page, command, beforePhase, beforeSaveText) {
  switch (command.type) {
    case 'enter':
      assert.ok(command.id, '地图命令没有 route node key');
      await clickMatchingAction(page, 'enter', { id: command.id });
      break;
    case 'fight':
      await clickMatchingAction(page, 'fight');
      break;
    case 'battle_done':
      await clickMatchingAction(page, 'battle-finish');
      break;
    case 'continue_battle':
      await clickMatchingAction(page, 'continue-battle');
      break;
    case 'reward':
      await clickMatchingAction(page, 'reward', { id: command.id ?? '' });
      break;
    case 'event':
      await clickMatchingAction(page, 'event', { id: command.id });
      break;
    case 'continue':
      await clickMatchingAction(page, 'continue');
      break;
    case 'buy':
      await clickMatchingAction(page, 'buy', { id: command.id });
      break;
    case 'leave_shop':
      await clickMatchingAction(page, 'leave-shop');
      break;
    case 'rest':
      if (command.choice === 'swap_method') {
        assert.ok(command.method, '换法命令没有目标功法');
        await clickMatchingAction(page, 'rest-method', { id: command.method });
      } else {
        await clickMatchingAction(page, 'rest', { choice: command.choice });
      }
      break;
    case 'talent':
      await clickMatchingAction(page, 'talent', { id: command.id });
      break;
    case 'retire': {
      let dialogSeen = false;
      const dialogHandler = async dialog => {
        dialogSeen = true;
        await dialog.accept();
      };
      page.once('dialog', dialogHandler);
      await clickMatchingAction(page, 'retire');
      await page.waitForFunction(() => Boolean(document.querySelector('.game-page.phase-lost')));
      assert.equal(dialogSeen, true, '结束平局时没有出现确认对话框');
      break;
    }
    default:
      throw new Error(`无法映射策略命令 ${command.type}`);
  }

  if (command.type === 'retire') return;
  if (command.type === 'continue_battle' || command.type === 'buy') {
    await waitForSaveChange(page, beforeSaveText);
  } else {
    await waitForPhaseChange(page, beforePhase);
  }
}

async function noOverflow(page, label) {
  const result = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(result.documentWidth <= result.width + 1, `${label}: document overflow ${JSON.stringify(result)}`);
  assert.ok(result.bodyWidth <= result.width + 1, `${label}: body overflow ${JSON.stringify(result)}`);
  return result;
}

async function visibleAlerts(page, label) {
  const alerts = await page.locator('[role="alert"]:visible').allTextContents();
  assert.equal(alerts.length, 0, `${label}: 页面出现可见 alert：${alerts.join(' | ')}`);
}

function stateSnapshot(game) {
  const state = game.state;
  const battle = state.battle;
  const stats = game.stats;
  return {
    runId: state.id,
    phase: state.phase,
    act: state.act,
    step: state.step,
    nodeId: game.node?.id ?? null,
    nodeType: game.node?.type ?? null,
    seed: state.seed,
    method: state.method,
    n: state.n,
    hp: state.hp,
    maxHp: stats.max_hp,
    xp: state.xp,
    coins: state.coins,
    preparation: state.preparation,
    artifacts: state.artifacts.map(item => ({ id: item.id, stacks: item.stacks })),
    history: state.history.length,
    routes: [...state.routes],
    routeMapPath: [...(state.routeMap?.path ?? [])],
    battle: battle ? {
      outcome: battle.outcome,
      rounds: battle.rounds,
      playerHp: battle.playerHp,
      enemyHp: battle.enemyHp,
      roundLimit: state.battleInput?.roundLimit ?? null,
    } : null,
  };
}

async function assertRenderedState(page, model, label) {
  const rendered = await currentPhase(page);
  assert.equal(rendered, model.state.phase, `${label}: 页面阶段与自动存档不一致`);
  await noOverflow(page, label);
  await visibleAlerts(page, label);
}

async function takeScreenshot(page, record, label) {
  const file = path.join(screenshotDir, `${safePart(record.viewport)}-${safePart(label)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  record.screenshots.push(relativePath(file));
}

async function reloadAndWait(page, expectedPhase) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#shanhai-app').waitFor({ state: 'visible' });
  await waitForPhase(page, expectedPhase);
}

async function setupRun(page, record) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.landing-page').waitFor({ state: 'visible' });
  await page.locator('.method-choice').nth(4).waitFor({ state: 'visible' });
  const seedOptions = page.locator('details[data-details="seed-options"]');
  assert.equal(await seedOptions.getAttribute('open'), null, `${record.viewport}: 命数设置应默认折叠`);
  await seedOptions.locator('summary').click();
  assert.equal(await page.locator('.method-choice').count(), 5, `${record.viewport}: 开局功法不是五门`);
  await page.locator('[name="player-name"]').fill(playerName);
  await page.locator('[name="seed"]').fill(seed);
  const method = await page.locator('.method-choice').first().getAttribute('data-id');
  assert.ok(method, '开局功法没有 data-id');
  await page.locator('.method-choice').first().click();
  await clickMatchingAction(page, 'start');
  await waitForPhase(page, 'map');
  const saved = await readSave(page);
  assert.equal(saved.state.method, method, '真实开局选择的功法没有写入自动存档');
  assert.equal(saved.state.seed, seed, '真实开局种子没有写入自动存档');
  assert.equal(saved.state.routeMap?.nodes.length, 29, '新命途没有完整的 29 节点地图');
  assert.deepEqual(saved.state.routeMap?.path, [], '新命途开局不应预选路径');
  assert.deepEqual(saved.state.nodes, [], '新命途开局不应伪造已选行迹');
  assert.equal(await page.locator('.map-node.available:not([disabled])').count(), 1,
    '新命途开局没有唯一的合法首格');
  await assertRenderedState(page, restoreDecisionModel(record.content, saved.text), `${record.viewport} setup`);
  await takeScreenshot(page, record, 'setup');
}

async function reloadBattleOnce(page, record) {
  if (record.reloadedBattle) return;
  await reloadAndWait(page, 'battle');
  const saved = await readSave(page);
  assert.equal(saved.state.phase, 'battle', `${record.viewport}: 战斗 reload 后阶段改变`);
  record.reloadedBattle = true;
  record.reloads.push({ phase: 'battle', act: saved.state.act, step: saved.state.step });
  await assertRenderedState(page, restoreDecisionModel(record.content, saved.text), `${record.viewport} battle reload`);
}

async function reloadRewardOnce(page, record, candidateIds) {
  if (record.reloadedReward) return;
  const before = await page.locator('.reward-card').evaluateAll(cards =>
    cards.map(card => card.getAttribute('data-id')));
  assert.deepEqual(before, candidateIds, `${record.viewport}: 奖励候选在 reload 前已变化`);
  await reloadAndWait(page, 'reward');
  const after = await page.locator('.reward-card').evaluateAll(cards =>
    cards.map(card => card.getAttribute('data-id')));
  assert.deepEqual(after, candidateIds, `${record.viewport}: 奖励候选 reload 后变化`);
  record.reloadedReward = true;
  record.reloads.push({ phase: 'reward' });
  await assertRenderedState(page, restoreDecisionModel(record.content, (await readSave(page)).text),
    `${record.viewport} reward reload`);
}

async function exerciseBattleControls(page, record, model) {
  const battle = model.state.battle;
  assert.ok(battle, '斗法阶段没有 battle 结果');
  const battleRecord = {
    act: model.state.act,
    step: model.state.step,
    nodeId: model.node?.id ?? null,
    nodeType: model.node?.type ?? null,
    roundLimit: model.state.battleInput?.roundLimit ?? null,
    rounds: battle.rounds,
    outcome: battle.outcome,
    controls: [],
  };
  await clickMatchingAction(page, 'battle-speed', { speed: 2 });
  await page.locator('[data-action="battle-speed"][data-speed="2"][aria-pressed="true"]').waitFor();
  battleRecord.controls.push('speed-2');
  await clickMatchingAction(page, 'battle-pause');
  await page.locator('[data-action="battle-pause"][aria-pressed="true"]').waitFor();
  battleRecord.controls.push('pause');
  await clickMatchingAction(page, 'battle-pause');
  await page.locator('[data-action="battle-pause"][aria-pressed="false"]').waitFor();
  battleRecord.controls.push('continue');
  await clickMatchingAction(page, 'battle-skip');
  await page.locator('[data-action="battle-finish"], [data-action="continue-battle"]').first().waitFor();
  battleRecord.controls.push('skip');
  record.battles.push(battleRecord);
  if (record.battles.length <= 2) {
    await takeScreenshot(page, record, `battle-a${model.state.act}-s${model.state.step}-r${model.state.battleInput?.roundLimit ?? 0}`);
  }
}

async function recordStage(record, model) {
  const snapshot = stateSnapshot(model);
  record.phases.add(snapshot.phase);
  record.stages.push(snapshot);
}

async function runJourney(page, record, stopAfterFirstTransition) {
  await setupRun(page, record);
  const maxActions = 700;
  let actionCount = 0;
  while (actionCount < maxActions) {
    const saved = await readSave(page);
    const model = restoreDecisionModel(record.content, saved.text);
    const phase = await currentPhase(page);
    assert.equal(phase, model.state.phase, `${record.viewport}: 第 ${actionCount} 步页面与存档阶段不一致`);
    await assertRenderedState(page, model, `${record.viewport} ${phase} a${model.state.act} s${model.state.step}`);
    const visibleText = await page.locator('#shanhai-app').innerText();
    assert.doesNotMatch(visibleText, /[A-Za-z]/,
      `${record.viewport} ${phase}: 玩家可见页面不应包含英文`);
    await recordStage(record, model);

    if (phase === 'transition' && model.state.act === 1) {
      record.firstActTransition = {
        act: model.state.act,
        step: model.state.step,
        history: model.state.history.length,
      };
      await takeScreenshot(page, record, 'transition-act1');
      if (stopAfterFirstTransition) break;
    }

    if (phase === 'won') {
      record.terminal = stateSnapshot(model);
      await takeScreenshot(page, record, 'won');
      break;
    }
    if (phase === 'lost') {
      throw new Error(`${record.viewport}: 真实浏览器命途退场于 act ${model.state.act} step ${model.state.step}`);
    }

    if (phase === 'battle') {
      await reloadBattleOnce(page, record);
      const refreshed = await readSave(page);
      const refreshedModel = restoreDecisionModel(record.content, refreshed.text);
      await exerciseBattleControls(page, record, refreshedModel);
      const command = nextCommand(refreshedModel, 'steady');
      const beforePhase = await currentPhase(page);
      const beforeSaveText = refreshed.text;
      await clickAndWaitForDispatch(page, command, beforePhase, beforeSaveText);
      actionCount += 1;
      continue;
    }

    if (phase === 'reward') {
      const candidateIds = await page.locator('.reward-card').evaluateAll(cards =>
        cards.map(card => card.getAttribute('data-id')));
      assert.ok(candidateIds.length > 0, `${record.viewport}: reward 阶段没有可见候选`);
      await reloadRewardOnce(page, record, candidateIds);
    }

    const command = nextCommand(model, 'steady');
    const beforePhase = phase;
    const beforeSaveText = saved.text;
    await clickAndWaitForDispatch(page, command, beforePhase, beforeSaveText);
    actionCount += 1;
  }

  assert.ok(actionCount < maxActions, `${record.viewport}: 超过 ${maxActions} 次动作仍未结束`);
  if (stopAfterFirstTransition) {
    assert.equal(record.firstActTransition?.history, 11,
      `${record.viewport}: 第一幕 transition 前行迹不是 11 节点`);
    assert.equal(await currentPhase(page), 'transition',
      `${record.viewport}: 第一幕没有停在 transition`);
  } else {
    assert.equal(record.terminal?.phase, 'won', `${record.viewport}: 桌面没有真实通关`);
    assert.equal(record.terminal?.history, 45, `${record.viewport}: 通关行迹不是 45 节点`);
    assert.equal(record.terminal?.act, 5, `${record.viewport}: 通关幕数不是第 5 幕`);
    const buildText = await page.evaluate(key => window.localStorage.getItem(key), buildKey);
    assert.ok(buildText, `${record.viewport}: 胜局没有自动保存构筑`);
    const builds = JSON.parse(buildText);
    assert.ok(Array.isArray(builds) && builds.some(build => build.runId === record.terminal?.runId),
      `${record.viewport}: 自动构筑归档没有当前 runId`);
  }
  record.actionCount = actionCount;
}

async function run() {
  await mkdir(screenshotDir, { recursive: true });
  const model = await loadContent();
  const content = contentFromEntities(model.entities, model.manifest.content_version);
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const errors = [];
  const reports = [];
  const failures = [];
  const cases = [
    { viewport: 'desktop', size: { width: 1440, height: 1000 }, stopAfterFirstTransition: false },
    { viewport: 'mobile', size: { width: 390, height: 844 }, stopAfterFirstTransition: true },
  ];

  try {
    for (const item of cases) {
      const context = await browser.newContext({ viewport: item.size, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const record = {
        viewport: item.viewport,
        width: item.size.width,
        height: item.size.height,
        seed,
        playerName,
        contentVersion: content.version,
        policy: 'tests/shanhai-policy.mjs nextCommand',
        phases: new Set(),
        stages: [],
        battles: [],
        screenshots: [],
        reloads: [],
        reloadedBattle: false,
        reloadedReward: false,
        firstActTransition: null,
        terminal: null,
        errors: [],
        content,
      };
      const pageLabel = item.viewport;
      page.on('pageerror', error => {
        const value = { page: pageLabel, type: 'pageerror', error: error.message };
        errors.push(value);
        record.errors.push(value);
      });
      page.on('console', message => {
        if (message.type() !== 'error') return;
        const value = { page: pageLabel, type: 'console', error: message.text() };
        errors.push(value);
        record.errors.push(value);
      });
      try {
        await runJourney(page, record, item.stopAfterFirstTransition);
        assert.equal(record.errors.length, 0,
          `${record.viewport}: 浏览器 pageerror/console error：${JSON.stringify(record.errors)}`);
        record.phases = [...record.phases];
        delete record.content;
        reports.push(record);
      } catch (error) {
        record.phases = [...record.phases];
        const savedState = await page.evaluate(key => window.localStorage.getItem(key), saveKey)
          .catch(() => null);
        let savedStateSummary = null;
        try {
          const parsed = savedState ? JSON.parse(savedState) : null;
          const state = parsed?.state;
          savedStateSummary = state ? {
            phase: state.phase,
            act: state.act,
            step: state.step,
            nodeKey: state.routeMap?.path?.[state.step] ?? null,
            nodeId: state.nodes?.[state.step]?.id ?? null,
            nodeType: state.nodes?.[state.step]?.type ?? null,
            history: state.history?.length ?? null,
            routes: state.routes ?? null,
            routeMapPath: state.routeMap?.path ?? null,
            routeHistory: state._routeHistory ?? null,
            runId: state.id ?? null,
          } : null;
        } catch {
          savedStateSummary = { parseError: true };
        }
        record.failure = {
          message: error instanceof Error ? error.message : String(error),
          phase: await currentPhase(page).catch(() => null),
          savedStateSummary,
        };
        delete record.content;
        reports.push(record);
        failures.push({
          viewport: record.viewport,
          message: record.failure.message,
          phase: record.failure.phase,
          savedStateSummary,
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      seed,
      playerName,
      generatedAt: new Date().toISOString(),
      contentVersion: content.version,
      policy: 'tests/shanhai-policy.mjs nextCommand; Node-side read-only ShanhaiGame decisions; browser clicks only',
      reports,
      failures,
      errors,
    }, null, 2) + '\n');
  }
  if (failures.length) {
    throw new Error(`Browser journey failures: ${JSON.stringify(failures)}`);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
