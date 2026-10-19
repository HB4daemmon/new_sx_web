import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/tools/browser-tools/node_modules/playwright');
const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const reportDir = path.resolve(process.env.BROWSER_REPORT_DIR || '/tmp/shanhai-story-browser');
const saveKey = 'suishi-shanhai-run-v1';
const contentModel = await loadContent();
const content = contentFromEntities(contentModel.entities, contentModel.manifest.content_version);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const report = {
  url,
  contentVersion: content.version,
  generatedAt: new Date().toISOString(),
  viewports: [],
  checks: [],
  errors: [],
};

const viewportCases = [
  { name: '360x780', width: 360, height: 780 },
  { name: '390x844', width: 390, height: 844 },
  { name: '1440x900', width: 1440, height: 900 },
];

async function phase(page) {
  const classes = await page.locator('.game-page').getAttribute('class');
  return classes?.match(/phase-([a-z_]+)/)?.[1] ?? null;
}

async function readSaved(page) {
  const text = await page.evaluate(key => localStorage.getItem(key), saveKey);
  assert.ok(text, '页面没有可读取的命途存档');
  const record = JSON.parse(text);
  assert.equal(record.key, saveKey);
  assert.ok(record.state);
  return { text, state: record.state };
}

function resourceFingerprint(state) {
  return {
    seed: state.seed,
    phase: state.phase,
    act: state.act,
    step: state.step,
    hp: state.hp,
    xp: state.xp,
    coins: state.coins,
    n: state.n,
    artifacts: state.artifacts,
    rewardCandidates: state.rewardCandidates,
    historyLength: state.history.length,
    eventCommitments: state.eventCommitments,
  };
}

async function assertUnchanged(page, before, label) {
  const after = await readSaved(page);
  assert.equal(after.text, before.text, `${label}: 阅读 UI 改写了自动存档`);
  assert.deepEqual(resourceFingerprint(after.state), resourceFingerprint(before.state),
    `${label}: 阅读 UI 改变了命途资源、阶段、种子或行迹`);
  assert.equal(await phase(page), before.state.phase, `${label}: 阅读 UI 改变了页面阶段`);
}

async function assertNoHorizontalOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
  }));
  assert.ok(geometry.documentWidth <= geometry.width + 1,
    `${label}: 文档横向溢出 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.bodyWidth <= geometry.width + 1,
    `${label}: 页面横向溢出 ${JSON.stringify(geometry)}`);
  assert.equal(await page.locator('[role="alert"]:visible').count(), 0, `${label}: 页面出现错误提示`);
  return geometry;
}

async function assertStoryTextFits(page, label) {
  const overflowing = await page.evaluate(() => [...document.querySelectorAll(
    '.chapter-stakes, .chapter-aftermath, .chapter-passage, .story-journey, .story-echoes, .chapter-dialog',
  )].filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && (element.scrollWidth > element.clientWidth + 1 ||
      rect.left < -1 || rect.right > innerWidth + 1);
  }).map(element => ({
    selector: element.className,
    client: element.clientWidth,
    scroll: element.scrollWidth,
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
  })));
  assert.deepEqual(overflowing, [], `${label}: 剧情文字超出容器 ${JSON.stringify(overflowing)}`);
}

async function loadFixture(page, fixtureText, expectedPhase, label) {
  await page.evaluate(({ key, text }) => {
    localStorage.clear();
    localStorage.setItem(key, text);
  }, { key: saveKey, text: fixtureText });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.game-page').waitFor({ state: 'visible' });
  assert.equal(await phase(page), expectedPhase, `${label}: fixture 阶段不符`);
  const saved = await readSaved(page);
  assert.equal(saved.state.phase, expectedPhase, `${label}: 页面和存档阶段不符`);
  return saved;
}

async function screenshot(page, viewportName, label) {
  const filename = `${viewportName}-${label}.png`;
  await page.screenshot({
    path: path.join(reportDir, filename),
    fullPage: true,
    animations: 'disabled',
  });
  report.checks.push({ viewport: viewportName, screenshot: filename });
}

function recordCheck(viewportName, name, details = {}) {
  report.checks.push({ viewport: viewportName, name, ...details });
}

async function assertModalBounds(page, label) {
  const bounds = await page.locator('.modal[role="dialog"]').boundingBox();
  assert.ok(bounds, `${label}: 对话框不可见`);
  const viewport = page.viewportSize();
  assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1,
    `${label}: 对话框横向超出视口 ${JSON.stringify({ bounds, viewport })}`);
  assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1,
    `${label}: 对话框纵向超出视口 ${JSON.stringify({ bounds, viewport })}`);
}

async function inspectChapter(page, expected, before, viewportName, label) {
  const trigger = page.locator('.map-heading [data-action="chapter"]');
  await trigger.click();
  const dialog = page.locator('.chapter-dialog');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getAttribute('aria-modal'), 'true', `${label}: 前情对话框未声明模态`);
  assert.equal((await dialog.locator('h2').innerText()).trim(), expected.name, `${label}: 幕名不符`);
  assert.equal((await dialog.locator('.chapter-dialog-goal').innerText()).trim(),
    expected.goal, `${label}: 前情目标不符`);
  const paragraphs = await dialog.locator(':scope > p:not(.eyebrow)').allInnerTexts();
  assert.deepEqual(paragraphs.map(text => text.trim()), [
    expected.goal,
    expected.prelude,
    expected.ordinaryRoute,
  ], `${label}: 前情内容不符`);
  await assertModalBounds(page, label);
  const autofocus = await page.evaluate(() =>
    document.activeElement?.matches('.chapter-dialog .dialog-actions [data-autofocus]') ?? false);
  assert.equal(autofocus, true, `${label}: 打开前情后焦点没有进入模态框`);
  await screenshot(page, viewportName, `chapter-act${expected.act}`);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() =>
    document.activeElement?.matches('.chapter-dialog .dialog-close') ?? false),
  true, `${label}: Tab 未限制在模态框内`);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() =>
    document.activeElement?.matches('.chapter-dialog .dialog-actions [data-autofocus]') ?? false),
  true, `${label}: Shift+Tab 未限制在模态框内`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() =>
    document.activeElement?.matches('.map-heading [data-action="chapter"]') ?? false),
  true, `${label}: 关闭前情后焦点没有返回触发按钮`);
  await assertUnchanged(page, before, label);
  await assertNoHorizontalOverflow(page, label);
}

async function inspectMapNodeDetails(page, before, viewportName) {
  const trigger = page.locator('.map-node.available[data-action="preview-node"]').first();
  const triggerId = await trigger.getAttribute('data-id');
  assert.ok(triggerId, '地图没有可预览的可达节点');
  await trigger.click();
  const dialog = page.locator('.node-preview-dialog');
  await dialog.waitFor({ state: 'visible' });
  const details = dialog.locator('.node-preview-detail');
  assert.equal(await details.count(), 1, '地图节点预览缺少按需详情');
  assert.equal(await details.evaluate(element => element.open), false, '节点详情应默认收起');
  await details.locator('summary').click();
  assert.equal(await details.evaluate(element => element.open), true, '节点详情没有展开');
  assert.ok((await details.innerText()).trim().length > 10, '节点展开详情为空');
  await assertModalBounds(page, `${viewportName} map-node-detail`);
  await screenshot(page, viewportName, 'map-node-detail');
  await assertUnchanged(page, before, `${viewportName} map-node-detail`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(id => {
    const active = document.activeElement;
    return active?.getAttribute('data-id') === id &&
      active?.getAttribute('data-action') === 'preview-node';
  }, triggerId), true, '关闭节点详情后焦点没有返回地图触发项');
  await assertUnchanged(page, before, `${viewportName} close-map-node-detail`);
}

async function inspectMap(page, fixtureText, expected, viewportName, includeNodeDetails = false) {
  const label = `${viewportName} map-act${expected.act}`;
  const before = await loadFixture(page, fixtureText, 'map', label);
  assert.equal(before.state.act, expected.act, `${label}: 幕次不符`);
  assert.equal(before.state.step, 0, `${label}: 不是幕初地图`);
  assert.equal((await page.locator('.map-heading h1').innerText()).trim(), expected.name,
    `${label}: 地图幕名不符`);
  assert.equal((await page.locator('.chapter-goal').innerText()).trim(), expected.goal,
    `${label}: 地图入幕目标不符`);
  const geometry = await page.evaluate(() => {
    const map = document.querySelector('.map-scroll');
    const heading = document.querySelector('.map-heading');
    const nav = document.querySelector('.bottom-nav');
    return {
      width: innerWidth,
      height: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      map: map?.getBoundingClientRect().toJSON(),
      heading: heading?.getBoundingClientRect().toJSON(),
      nav: nav?.getBoundingClientRect().toJSON(),
      mapClientHeight: map?.clientHeight ?? 0,
      mapScrollHeight: map?.scrollHeight ?? 0,
    };
  });
  assert.ok(geometry.documentHeight <= geometry.height + 1,
    `${label}: 地图不再保持全屏 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.map && geometry.map.height >= geometry.height * 0.45,
    `${label}: 地图滚动区高度不足 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.heading && geometry.map.top >= geometry.heading.bottom - 1,
    `${label}: 地图滚动区与标题重叠`);
  assert.ok(geometry.map.bottom <= geometry.height + 1,
    `${label}: 地图滚动区超出视口 ${JSON.stringify(geometry)}`);
  if (geometry.nav?.height > 0) {
    assert.ok(geometry.map.bottom <= geometry.nav.top + 1,
      `${label}: 地图滚动区与底部导航重叠`);
  }
  if (expected.act < 5) {
    assert.ok(geometry.mapScrollHeight > geometry.mapClientHeight,
      `${label}: 路线未在地图滚动区内滚动 ${JSON.stringify(geometry)}`);
  } else {
    assert.ok(geometry.mapScrollHeight >= geometry.mapClientHeight,
      `${label}: 终局地图内容超出滚动区 ${JSON.stringify(geometry)}`);
  }
  const mapScroll = page.locator('.map-scroll');
  if (geometry.mapScrollHeight > geometry.mapClientHeight) {
    await mapScroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(40);
    assert.ok(await mapScroll.evaluate(element => element.scrollTop > 0), `${label}: 地图无法内部滚动`);
    await mapScroll.evaluate(element => { element.scrollTop = 0; });
  }
  await assertNoHorizontalOverflow(page, label);
  await screenshot(page, viewportName, `map-act${expected.act}`);
  await inspectChapter(page, expected, before, viewportName, label);
  if (includeNodeDetails) await inspectMapNodeDetails(page, before, viewportName);
  recordCheck(viewportName, 'full-height-scrollable-map', {
    act: expected.act,
    geometry,
  });
}

async function inspectBossPreview(page, fixtureText, expected, viewportName) {
  const label = `${viewportName} boss-act${expected.act}-preview`;
  const before = await loadFixture(page, fixtureText, 'preview', label);
  assert.equal(before.state.act, expected.act);
  assert.equal(before.state.nodes[before.state.step].id, expected.bossId);
  assert.equal(before.state.nodes[before.state.step].type, 'B');
  assert.equal((await page.locator('.chapter-stakes').innerText()).trim(), expected.bossBefore,
    `${label}: 首领战前剧情不符`);
  assert.equal((await page.locator('.preview-contender.enemy-side h2 .preview-detail-trigger').innerText()).trim(),
    expected.bossName, `${label}: 实际首领变体不符`);
  await assertNoHorizontalOverflow(page, label);
  await assertStoryTextFits(page, label);
  await screenshot(page, viewportName, `boss-act${expected.act}-preview`);

  const trigger = page.locator('[data-action="battle-details"][data-tab="enemy"]');
  await trigger.click();
  const dialog = page.locator('.battle-detail-dialog');
  await dialog.waitFor({ state: 'visible' });
  await assertModalBounds(page, label);
  assert.equal(await phase(page), 'preview', `${label}: 查看战力详情推进了阶段`);
  await assertUnchanged(page, before, label);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() =>
    document.activeElement?.matches('[data-action="battle-details"][data-tab="enemy"]') ?? false),
  true, `${label}: 关闭首领详情后焦点未返回`);
  await assertUnchanged(page, before, `${label} close-details`);
}

async function inspectBossReward(page, fixtureText, expected, viewportName) {
  const label = `${viewportName} boss-act${expected.act}-reward`;
  const before = await loadFixture(page, fixtureText, 'reward', label);
  assert.equal(before.state.act, expected.act);
  assert.equal(before.state.nodes[before.state.step].id, expected.bossId);
  assert.equal((await page.locator('.chapter-aftermath').innerText()).trim(), expected.bossVariant,
    `${label}: 首领战后回声不符`);
  await assertNoHorizontalOverflow(page, label);
  await assertStoryTextFits(page, label);
  await screenshot(page, viewportName, `boss-act${expected.act}-reward`);
}

async function inspectTransition(page, fixtureText, expected, viewportName) {
  const label = `${viewportName} transition-act${expected.act}`;
  const before = await loadFixture(page, fixtureText, 'transition', label);
  assert.equal(before.state.act, expected.act);
  const boss = before.state.nodes.find(node => node.type === 'B' && node.completed);
  assert.equal(boss?.id, expected.bossId, `${label}: 幕间没有使用本局完成的首领`);
  assert.equal((await page.locator('.transition-scene p').innerText()).trim(), expected.bossVariant,
    `${label}: 幕间没有使用实际首领变体`);
  assert.equal((await page.locator('.chapter-passage').innerText()).trim(), expected.passage,
    `${label}: 幕间去向不符`);
  const echoCount = await page.locator('.story-echoes article').count();
  assert.ok(echoCount <= 2, `${label}: 显示了超过两条本幕行迹`);
  await assertNoHorizontalOverflow(page, label);
  await assertStoryTextFits(page, label);
  await screenshot(page, viewportName, `transition-act${expected.act}`);
  recordCheck(viewportName, 'boss-transition-actual-variant-and-passage', {
    act: expected.act,
    bossId: expected.bossId,
    echoCount,
  });
}

async function inspectFinalNodePreview(page, fixtureText, expected, viewportName) {
  const label = `${viewportName} final-map-node-preview`;
  const before = await loadFixture(page, fixtureText, 'map', label);
  const trigger = page.locator('.map-node.available[data-node-type="F"]');
  assert.equal(await trigger.count(), 1, `${label}: 终局地图应只有一个可达劫相`);
  await trigger.click();
  const dialog = page.locator('.node-preview-dialog');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getAttribute('data-node-type'), 'F');
  assert.equal((await dialog.locator('h2').innerText()).trim(), expected.finalName);
  await assertModalBounds(page, label);
  await screenshot(page, viewportName, 'final-map-node-preview');
  await assertUnchanged(page, before, label);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() =>
    document.activeElement?.matches('.map-node.available[data-node-type="F"]') ?? false),
  true, `${label}: 关闭终局预览后焦点未返回`);
  await assertUnchanged(page, before, `${label} close`);
}

async function inspectFinalPreview(page, fixtureText, expected, viewportName) {
  const label = `${viewportName} final-preview`;
  const before = await loadFixture(page, fixtureText, 'preview', label);
  assert.equal(before.state.act, 5);
  assert.equal(before.state.nodes[before.state.step].type, 'F');
  assert.equal((await page.locator('.chapter-stakes').innerText()).trim(), expected.finalBefore,
    `${label}: 终战前情不符`);
  assert.equal((await page.locator('.preview-contender.enemy-side h2 .preview-detail-trigger').innerText()).trim(),
    expected.finalName, `${label}: 终战敌人不符`);
  await assertNoHorizontalOverflow(page, label);
  await assertStoryTextFits(page, label);
  await screenshot(page, viewportName, 'final-preview');
}

async function inspectEnd(page, fixtureText, expectedPhase, expected, viewportName) {
  const label = `${viewportName} end-${expectedPhase}`;
  const before = await loadFixture(page, fixtureText, expectedPhase, label);
  const won = expectedPhase === 'won';
  assert.equal(before.state.act, 5);
  assert.equal((await page.locator('.end-seal').innerText()).trim(), won ? '通关' : '退场');
  const result = (await page.locator('.end-result-text').innerText()).trim();
  if (won) {
    assert.ok(result.includes(expected.finalVariant), `${label}: 终战胜利没有叙述实际劫相`);
    assert.ok(result.includes(expected.victory), `${label}: 缺少共同归途收束`);
  } else {
    assert.ok(result.includes(expected.defeat), `${label}: 败北没有使用终局未竟叙述`);
    assert.ok(result.includes(expected.finalName), `${label}: 败北没有记录实际劫相`);
  }
  await assertNoHorizontalOverflow(page, label);
  await assertStoryTextFits(page, label);
  const details = page.locator('details.end-epilogue');
  assert.equal(await details.count(), 1, `${label}: 缺少按需展开的此行因缘`);
  assert.equal(await details.evaluate(element => element.open), false, `${label}: 终局行迹应默认收起`);
  await screenshot(page, viewportName, `end-${expectedPhase}`);
  await details.locator('summary').click();
  assert.equal(await details.evaluate(element => element.open), true, `${label}: 终局行迹没有展开`);
  const journeys = page.locator('.end-epilogue .story-journey');
  assert.deepEqual(await journeys.evaluateAll(elements => elements.map(element => ({
    id: element.getAttribute('data-storyline'),
    text: element.innerText,
  }))), [{ id: 'RS02', text: await journeys.first().innerText() }],
  `${label}: 结局只应叙述实际遇见的精卫人物线`);
  assert.match(await journeys.first().innerText(), /回访交易/);
  await assertStoryTextFits(page, label);
  await assertUnchanged(page, before, label);
  await screenshot(page, viewportName, `end-${expectedPhase}-epilogue`);
  recordCheck(viewportName, 'terminal-result-and-history-only-epilogue', {
    phase: expectedPhase,
    journeyCount: await journeys.count(),
  });
}

async function inspectKarma(page, fixtureText, expected, viewportName, label) {
  const before = await loadFixture(page, fixtureText, 'map', `${viewportName} karma-${label}`);
  await page.locator('[data-action="tab"][data-id="karma"]:visible').first().click();
  await page.locator('.karma-page').waitFor({ state: 'visible' });
  const journeys = page.locator('.story-journey');
  if (expected.status === null) {
    assert.equal(await journeys.count(), 0, `${label}: 预选人物不能冒充相逢`);
    assert.equal((await page.locator('.karma-summary').first().innerText()).includes('尚未相逢'), true);
    for (const name of expected.characterNames) {
      assert.equal((await page.locator('.karma-page').innerText()).includes(name), false,
        `${label}: 显示了未相逢人物 ${name}`);
    }
  } else {
    assert.equal(await journeys.count(), 1, `${label}: 只应显示一条真实人物线`);
    const journey = journeys.first();
    assert.equal(await journey.getAttribute('data-storyline'), 'RS02');
    assert.match(await journey.innerText(), new RegExp(expected.status));
    assert.ok((await journey.innerText()).includes(expected.echo),
      `${label}: 没有叙述已选择的实际结果`);
  }
  assert.deepEqual(await journeys.evaluateAll(elements =>
    elements.map(element => element.getAttribute('data-storyline'))),
  expected.status === null ? [] : ['RS02'], `${label}: 出现幻影人物线`);
  await assertNoHorizontalOverflow(page, `${viewportName} karma-${label}`);
  await assertStoryTextFits(page, `${viewportName} karma-${label}`);
  await screenshot(page, viewportName, `karma-${label}`);
  await assertUnchanged(page, before, `${viewportName} karma-${label}`);
  recordCheck(viewportName, 'karma-uses-completed-history', { label, status: expected.status });
}

async function buildFixtureBundle(page) {
  return page.evaluate(async ({ content, saveKey }) => {
    const [{ ShanhaiGame }, { saveRun }] = await Promise.all([
      import('/shanhai/run.js'),
      import('/shanhai/persistence.js'),
    ]);
    const fixtures = {};
    const acts = {};
    const runName = '山海剧情验收';
    const storyLineId = 'RS02';
    const storyLine = content.byId[storyLineId];
    const firstChoice = storyLine?.encounters?.[0] ?? 'RK003';
    const followUp = storyLine?.encounters?.[1] ?? 'RK004';
    const firstEvent = content.byId[firstChoice];
    const followUpEvent = content.byId[followUp];
    const initialOptionId = 'RK003-pursue-trial';
    const branchOptionIds = {
      trade: 'RK004-pay-route',
      stop: 'RK004-stop',
      failure: 'RK004-clear-reef',
    };

    function saveFixture(name, game) {
      let text = '';
      const storage = {
        getItem: () => text || null,
        setItem: (_key, value) => { text = value; },
        removeItem: () => { text = ''; },
      };
      saveRun(game, storage);
      fixtures[name] = text;
    }

    function createPlannedRun(seed, plannedStoryline = '') {
      let game = ShanhaiGame.create(content, { seed, name: runName, method: 'RKF01' });
      if (plannedStoryline) {
        game.state.storyline = plannedStoryline;
        game.state._plannedStoryline = plannedStoryline;
      }
      game.state.routeMap = undefined;
      game.state._routeMapVersion = undefined;
      game.state._routeMapLegacy = false;
      game = new ShanhaiGame(content, game.state);
      return game;
    }

    function distanceToTarget(game, predicate) {
      const map = game.state.routeMap;
      const byKey = new Map(map.nodes.map(node => [node.key, node]));
      const memo = new Map();
      const distance = node => {
        if (predicate(node)) return 0;
        if (memo.has(node.key)) return memo.get(node.key);
        const next = node.next.map(key => byKey.get(key)).filter(Boolean);
        const result = next.length ? 1 + Math.min(...next.map(distance)) : Infinity;
        memo.set(node.key, result);
        return result;
      };
      const available = game.availableNodes()
        .map(node => ({ node, distance: distance(byKey.get(node.key) ?? node) }))
        .filter(item => Number.isFinite(item.distance))
        .sort((left, right) => left.distance - right.distance || left.node.key.localeCompare(right.node.key));
      if (!available.length) throw new Error(`No reachable route to target in act ${game.state.act}`);
      return available[0].node;
    }

    function fixtureBattle(game, outcome = 'player') {
      const state = game.state;
      const node = game.node;
      if (!node) throw new Error('Fixture battle has no active node');
      const pending = state._pendingEvent;
      const playerHp = outcome === 'player' ? Math.max(1, Math.min(state.hp, game.stats.max_hp)) : 0;
      state.phase = 'battle';
      state._battleKind = pending ? 'event' : 'node';
      state._battleNodeType = node.type;
      state._battleRewardType = node.type === 'C' ? 'common'
        : node.type === 'L' ? 'elite'
          : node.type === 'B' ? 'boss' : undefined;
      state.battle = {
        outcome,
        rounds: 1,
        playerHp,
        enemyHp: outcome === 'player' ? 0 : 100,
        frames: [],
        contributions: [],
      };
      game.dispatch({ type: 'battle_done' });
    }

    function settle(game) {
      if (game.state.phase === 'preview') {
        fixtureBattle(game, 'player');
      } else if (game.state.phase === 'battle') {
        fixtureBattle(game, 'player');
      } else if (game.state.phase === 'reward') {
        game.dispatch({ type: 'reward', id: null });
      } else if (game.state.phase === 'event') {
        const event = content.byId[game.node.id];
        const available = event.options.filter(option => game.optionAvailability(option).available);
        const option = available.find(candidate => !candidate.encounter) ?? available[0];
        if (!option) throw new Error(`No available event option for ${event.id}`);
        game.dispatch({ type: 'event', id: option.id });
      } else if (game.state.phase === 'event_result') {
        game.dispatch({ type: 'continue' });
      } else if (game.state.phase === 'shop') {
        game.dispatch({ type: 'leave_shop' });
      } else if (game.state.phase === 'rest') {
        if (game.state._restFromEvent) {
          const method = game.state.ownedMethods.find(id => id !== game.state.method);
          if (!method) throw new Error('Fixture event rest has no alternate method');
          game.dispatch({ type: 'rest', choice: 'swap_method', method });
        } else {
          game.dispatch({ type: 'rest', choice: 'heal' });
        }
      } else if (game.state.phase === 'talent') {
        const talent = game.availableTalents()[0];
        if (!talent) throw new Error('Fixture talent phase has no available choice');
        game.dispatch({ type: 'talent', id: talent.id });
      } else if (game.state.phase === 'transition') {
        game.dispatch({ type: 'continue' });
      } else {
        throw new Error(`Fixture cannot advance from ${game.state.phase}`);
      }
    }

    function driveTo(game, target) {
      for (let guard = 0; guard < 180; guard += 1) {
        if (target.reached(game)) return;
        if (game.state.phase === 'map') {
          const node = distanceToTarget(game, target.routeNode);
          game.dispatch({ type: 'enter', id: node.key });
        } else {
          settle(game);
        }
      }
      throw new Error(`Fixture did not reach target in act ${game.state.act} (${game.state.phase})`);
    }

    function finishMapToBoss(game, act) {
      driveTo(game, {
        routeNode: node => node.type === 'B',
        reached: current => current.state.act === act &&
          current.state.phase === 'preview' && current.node?.type === 'B',
      });
    }

    function snapshotBossPreviewAndTransition(game, act) {
      finishMapToBoss(game, act);
      const bossId = game.node.id;
      const enemy = content.byId[bossId];
      const actEntity = content.byId[`RA0${act}`];
      const story = actEntity.story;
      const expected = {
        act,
        name: actEntity.name,
        goal: story.goal,
        prelude: story.prelude,
        ordinaryRoute: story.ordinary_route,
        bossId,
        bossName: enemy.name,
        bossBefore: story.boss_before,
        bossVariant: story.boss_variants[bossId],
        passage: story.passage,
      };
      acts[act] = expected;
      saveFixture(`boss-act${act}-preview`, game);
      fixtureBattle(game, 'player');
      if (game.state.phase !== 'reward') throw new Error(`Act ${act} boss did not reach reward`);
      saveFixture(`boss-act${act}-reward`, game);
      game.dispatch({ type: 'reward', id: null });
      for (let guard = 0; guard < 10 && game.state.phase === 'talent'; guard += 1) settle(game);
      if (game.state.phase !== 'transition') {
        throw new Error(`Act ${act} boss did not reach transition: ${game.state.phase}`);
      }
      saveFixture(`transition-act${act}`, game);
      return expected;
    }

    const game = createPlannedRun('story-browser-main', storyLineId);
    const initialAct = content.byId.RA01;
    acts[1] = {
      act: 1,
      name: initialAct.name,
      goal: initialAct.story.goal,
      prelude: initialAct.story.prelude,
      ordinaryRoute: initialAct.story.ordinary_route,
    };
    saveFixture('map-act1', game);

    driveTo(game, {
      routeNode: node => node.id === firstChoice,
      reached: current => current.state.phase === 'event' && current.node?.id === firstChoice,
    });
    const initialOption = firstEvent.options.find(option => option.id === initialOptionId);
    if (!initialOption || !game.optionAvailability(initialOption).available) {
      throw new Error('Fixture initial character promise is unavailable');
    }
    game.dispatch({ type: 'event', id: initialOptionId });
    game.dispatch({ type: 'continue' });
    saveFixture('karma-initial', game);

    snapshotBossPreviewAndTransition(game, 1);
    game.dispatch({ type: 'continue' });
    const act2 = content.byId.RA02;
    acts[2] = {
      act: 2,
      name: act2.name,
      goal: act2.story.goal,
      prelude: act2.story.prelude,
      ordinaryRoute: act2.story.ordinary_route,
    };
    saveFixture('map-act2', game);
    snapshotBossPreviewAndTransition(game, 2);
    game.dispatch({ type: 'continue' });
    const act3 = content.byId.RA03;
    acts[3] = {
      act: 3,
      name: act3.name,
      goal: act3.story.goal,
      prelude: act3.story.prelude,
      ordinaryRoute: act3.story.ordinary_route,
    };
    saveFixture('map-act3', game);
    driveTo(game, {
      routeNode: node => node.id === followUp,
      reached: current => current.state.phase === 'event' && current.node?.id === followUp,
    });
    if (game.state.coins < 20) game.state.coins = 20;
    saveFixture('karma-followup-event', game);

    const followUpState = structuredClone(game.state);
    const failureEcho = followUpEvent.options
      .find(option => option.id === branchOptionIds.failure).story_failure_echo;
    for (const [name, optionId] of Object.entries(branchOptionIds)) {
      const branch = new ShanhaiGame(content, structuredClone(followUpState));
      const option = followUpEvent.options.find(candidate => candidate.id === optionId);
      if (!option || !branch.optionAvailability(option).available) {
        throw new Error(`Fixture revisit option is unavailable: ${optionId}`);
      }
      branch.dispatch({ type: 'event', id: optionId });
      if (name === 'failure') {
        if (branch.state.phase !== 'preview') throw new Error('Fixture failed trial has no battle preview');
        fixtureBattle(branch, 'enemy');
        if (branch.state.phase !== 'event_result') throw new Error('Fixture trial did not record a failure');
      }
      branch.dispatch({ type: 'continue' });
      saveFixture(`karma-${name}`, branch);
    }

    const trade = followUpEvent.options.find(option => option.id === branchOptionIds.trade);
    game.dispatch({ type: 'event', id: trade.id });
    game.dispatch({ type: 'continue' });
    const tradeEcho = trade.story_echo;
    const initialEcho = initialOption.story_echo;
    const stopEcho = followUpEvent.options
      .find(option => option.id === branchOptionIds.stop).story_echo;
    const tradeState = saveFixture('karma-trade', game);
    void tradeState;

    snapshotBossPreviewAndTransition(game, 3);
    game.dispatch({ type: 'continue' });
    const act4 = content.byId.RA04;
    acts[4] = {
      act: 4,
      name: act4.name,
      goal: act4.story.goal,
      prelude: act4.story.prelude,
      ordinaryRoute: act4.story.ordinary_route,
    };
    saveFixture('map-act4', game);
    snapshotBossPreviewAndTransition(game, 4);
    game.dispatch({ type: 'continue' });

    const finalAct = content.byId.RF01;
    const finalEnemy = game.state.routeMap.nodes.find(node => node.type === 'F');
    if (!finalEnemy) throw new Error('Fixture final map has no劫相');
    const finalExpected = {
      name: finalAct.name,
      goal: finalAct.story.goal,
      prelude: finalAct.story.prelude,
      ordinaryRoute: finalAct.story.ordinary_route,
      finalId: finalEnemy.id,
      finalName: content.byId[finalEnemy.id].name,
      finalBefore: finalAct.story.boss_before,
      finalVariant: finalAct.story.boss_variants[finalEnemy.id],
      victory: finalAct.story.victory,
      defeat: finalAct.story.defeat,
    };
    acts[5] = { act: 5, ...finalExpected };
    saveFixture('map-act5', game);
    game.dispatch({ type: 'enter', id: finalEnemy.key });
    if (game.state.phase !== 'preview' || game.node.id !== finalEnemy.id) {
      throw new Error('Fixture final enemy did not enter its actual battle preview');
    }
    saveFixture('final-preview', game);

    const winningGame = new ShanhaiGame(content, structuredClone(game.state));
    fixtureBattle(winningGame, 'player');
    if (winningGame.state.phase !== 'won') throw new Error('Fixture did not produce a final win');
    saveFixture('end-won', winningGame);
    const losingGame = new ShanhaiGame(content, structuredClone(game.state));
    fixtureBattle(losingGame, 'enemy');
    if (losingGame.state.phase !== 'lost') throw new Error('Fixture did not produce a final loss');
    saveFixture('end-lost', losingGame);

    return {
      fixtures,
      acts,
      finalExpected,
      lineage: {
        characterNames: content.entities.filter(entity => entity.kind === 'storyline')
          .map(line => line.character ?? line.name),
        initialEcho,
        tradeEcho,
        stopEcho,
        failureEcho,
      },
      fixturePhases: Object.fromEntries(Object.entries(fixtures).map(([name, text]) =>
        [name, JSON.parse(text).state.phase])),
      saveKey,
    };
  }, { content, saveKey });
}

try {
  await mkdir(reportDir, { recursive: true });
  const fixtureContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const fixturePage = await fixtureContext.newPage();
  fixturePage.setDefaultTimeout(15000);
  await fixturePage.goto(url, { waitUntil: 'networkidle' });
  const bundle = await buildFixtureBundle(fixturePage);
  await fixtureContext.close();
  report.fixturePhases = bundle.fixturePhases;
  report.storyline = bundle.lineage;

  for (const viewport of viewportCases) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push({
      viewport: viewport.name,
      type: 'pageerror',
      message: error.message,
    }));
    page.on('console', message => {
      if (message.type() === 'error') {
        report.errors.push({
          viewport: viewport.name,
          type: 'console',
          message: message.text(),
        });
      }
    });
    await page.goto(url, { waitUntil: 'networkidle' });

    for (const act of [1, 2, 3, 4, 5]) {
      await inspectMap(page, bundle.fixtures[`map-act${act}`], bundle.acts[act],
        viewport.name, act === 1);
    }
    await inspectFinalNodePreview(page, bundle.fixtures['map-act5'], bundle.finalExpected, viewport.name);

    for (const act of [1, 2, 3, 4]) {
      await inspectBossPreview(page, bundle.fixtures[`boss-act${act}-preview`], bundle.acts[act], viewport.name);
      await inspectBossReward(page, bundle.fixtures[`boss-act${act}-reward`], bundle.acts[act], viewport.name);
      await inspectTransition(page, bundle.fixtures[`transition-act${act}`], bundle.acts[act], viewport.name);
    }

    await inspectFinalPreview(page, bundle.fixtures['final-preview'], bundle.finalExpected, viewport.name);
    await inspectEnd(page, bundle.fixtures['end-won'], 'won', bundle.finalExpected, viewport.name);
    await inspectEnd(page, bundle.fixtures['end-lost'], 'lost', bundle.finalExpected, viewport.name);

    await inspectKarma(page, bundle.fixtures['map-act1'], {
      status: null,
      characterNames: bundle.lineage.characterNames,
    }, viewport.name, 'no-meeting');
    await inspectKarma(page, bundle.fixtures['karma-initial'], {
      status: '待回访',
      echo: bundle.lineage.initialEcho,
    }, viewport.name, 'initial');
    await inspectKarma(page, bundle.fixtures['karma-trade'], {
      status: '回访交易',
      echo: bundle.lineage.tradeEcho,
    }, viewport.name, 'trade');
    await inspectKarma(page, bundle.fixtures['karma-stop'], {
      status: '回访止步',
      echo: bundle.lineage.stopEcho,
    }, viewport.name, 'stop');
    await inspectKarma(page, bundle.fixtures['karma-failure'], {
      status: '试炼失手',
      echo: bundle.lineage.failureEcho,
    }, viewport.name, 'trial-failure');

    await context.close();
    report.viewports.push(viewport);
  }

  assert.deepEqual(report.errors, [], `浏览器出现运行错误：${JSON.stringify(report.errors)}`);
  report.ok = true;
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Story browser checks passed: ${report.checks.filter(item => item.name).length}`);
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.stack : String(error);
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}
