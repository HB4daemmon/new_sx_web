import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';
import { ShanhaiGame, registerCombatWorker } from '../build/shanhai/run.js';
import { serializeRun } from '../build/shanhai/persistence.js';
import { pauseNextReplay } from './shanhai-replay-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.BROWSER_URL || 'http://localhost:4173/';
const reportDir = process.env.SHANHAI_THEME_REPORT_DIR
  ? path.resolve(process.env.SHANHAI_THEME_REPORT_DIR)
  : path.join(os.tmpdir(), 'shanhai-theme-browser');
const screenshotDir = path.join(reportDir, 'screenshots');
const themePath = path.join(root, 'src/shanhai/game-theme.css');
const useCandidateTheme = process.env.SHANHAI_THEME_CANDIDATE === '1';
const saveKey = 'suishi-shanhai-run-v1';
const replayKey = 'suishi-shanhai-replay-v1';
const checks = [];
const failures = [];
const pageErrors = [];

const loaded = await loadContent();
const content = {
  entities: loaded.entities,
  byId: loaded.byId,
  rules: loaded.entities.find(entity => entity.id === 'RULES'),
};

function playwrightModule() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
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

function talentsFor(methodId, n, branches = ['A', 'B', 'C', 'A']) {
  const method = content.byId.get(methodId);
  return Array.from({ length: n }, (_value, index) => {
    const tier = index + 1;
    const branch = branches[index % branches.length];
    const talent = method.talents.find(item =>
      item.tier === tier && item.branch === branch);
    assert.ok(talent, `缺少 ${methodId} 第 ${tier} 层 ${branch} 分支天赋`);
    return talent.id;
  });
}

function installFixtureCombat() {
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
}

function resolveCurrentNode(game) {
  let guard = 0;
  while (game.state.phase !== 'map' && !['won', 'lost'].includes(game.state.phase) &&
    guard++ < 32) {
    if (game.state.phase === 'preview') game.dispatch({ type: 'fight' });
    else if (game.state.phase === 'battle') game.dispatch({ type: 'battle_done' });
    else if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    else if (game.state.phase === 'event') {
      const event = content.byId.get(game.node.id);
      const option = event.options.find(candidate =>
        !candidate.encounter && game.optionAvailability(candidate).available) ??
        event.options.find(candidate => game.optionAvailability(candidate).available);
      assert.ok(option, `fixture 事件 ${event.id} 没有可用选项`);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    else if (game.state.phase === 'shop') game.dispatch({ type: 'leave_shop' });
    else if (game.state.phase === 'rest') game.dispatch({ type: 'rest', choice: 'heal' });
    else if (game.state.phase === 'talent') {
      const choice = game.availableTalents()[0];
      assert.ok(choice, 'fixture 突破阶段没有天赋可选');
      game.dispatch({ type: 'talent', id: choice.id });
    } else if (game.state.phase === 'transition') game.dispatch({ type: 'continue' });
    else throw new Error(`fixture 无法处理阶段 ${game.state.phase}`);
  }
  assert.ok(guard < 32, 'fixture 节点未能结算');
}

function shopPath(game) {
  const route = game.state.routeMap;
  const byKey = new Map(route.nodes.map(node => [node.key, node]));
  const queue = game.availableNodes().map(node => [node.key]);
  const seen = new Set();
  while (queue.length) {
    const path = queue.shift();
    const node = byKey.get(path.at(-1));
    if (!node || seen.has(node.key)) continue;
    seen.add(node.key);
    if (node.type === 'S') return path;
    for (const next of node.next ?? []) queue.push([...path, next]);
  }
  throw new Error('fixture 路线中没有可达坊市');
}

function makeShopFixture() {
  installFixtureCombat();
  const game = ShanhaiGame.create(content, {
    seed: 'theme-shop-fixture',
    name: '主题回归行者',
    method: 'RKF03',
  });
  for (const key of shopPath(game)) {
    if (game.state.phase !== 'map') resolveCurrentNode(game);
    const node = game.availableNodes().find(candidate => candidate.key === key);
    assert.ok(node, `fixture 路线节点 ${key} 当前不可达`);
    game.dispatch({ type: 'enter', id: key });
    if (node.type === 'S') break;
    resolveCurrentNode(game);
  }
  assert.equal(game.state.phase, 'shop', 'fixture 未能抵达坊市');

  const otherMethodId = 'RKF02';
  if (!game.state.ownedMethods.includes(otherMethodId)) {
    game.state.ownedMethods.push(otherMethodId);
  }
  game.state.n = 2;
  game.state.xp = content.rules.cultivation.cumulative[1];
  game.state.talents.RKF03 = talentsFor('RKF03', 2);
  game.state.talents[otherMethodId] = talentsFor(otherMethodId, 2, ['C', 'A']);
  game.state.coins = 200;
  game.state.hp = 1;
  game.state.preparation = 55;
  game.state.firstStrike = 7;
  game.state._talentQueue = [];
  game.state._returnPhase = undefined;
  game.state.returnPhase = undefined;
  return serializeRun(game);
}

function makeRewardFixture() {
  registerCombatWorker({ calculateStats, simulateBattle });
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const game = ShanhaiGame.create(content, {
      seed: `theme-reward-fixture-${attempt}`,
      name: '主题回归行者',
      method: 'RKF01',
    });
    const first = game.availableNodes()[0];
    assert.ok(first, 'reward fixture 没有开局行迹');
    game.dispatch({ type: 'enter', id: first.key });
    game.dispatch({ type: 'fight' });
    let draws = 0;
    while (game.state.battle?.outcome === 'draw' && draws++ < 8) {
      game.dispatch({ type: 'continue_battle' });
    }
    if (game.state.phase !== 'battle' || game.state.battle?.outcome !== 'player') continue;
    game.dispatch({ type: 'battle_done' });
    if (game.state.phase === 'reward' && game.state.rewardCandidates.length === 3) {
      return serializeRun(game);
    }
  }
  throw new Error('无法构造三选一奖励 fixture');
}

function advanceBattleFixture(game) {
  let guard = 0;
  while (game.state.phase !== 'battle' && !['won', 'lost'].includes(game.state.phase) &&
    guard++ < 100) {
    if (game.state.phase === 'map') {
      const node = game.availableNodes().find(candidate =>
        ['C', 'L', 'B', 'F'].includes(candidate.type)) || game.availableNodes()[0];
      assert.ok(node, 'battle fixture 当前没有可前往节点');
      game.dispatch({ type: 'enter', id: node.key });
    } else if (game.state.phase === 'preview') game.dispatch({ type: 'fight' });
    else if (game.state.phase === 'reward') game.dispatch({ type: 'reward', id: null });
    else if (game.state.phase === 'event') {
      const event = content.byId.get(game.node.id);
      const option = event.options.find(candidate =>
        !candidate.encounter && game.optionAvailability(candidate).available) ??
        event.options.find(candidate => game.optionAvailability(candidate).available);
      assert.ok(option, `battle fixture 事件 ${event.id} 没有可用选项`);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') game.dispatch({ type: 'continue' });
    else if (game.state.phase === 'shop') game.dispatch({ type: 'leave_shop' });
    else if (game.state.phase === 'rest') game.dispatch({ type: 'rest', choice: 'heal' });
    else if (game.state.phase === 'talent') {
      const choice = game.availableTalents()[0];
      assert.ok(choice, 'battle fixture 突破阶段没有天赋可选');
      game.dispatch({ type: 'talent', id: choice.id });
    } else if (game.state.phase === 'transition') game.dispatch({ type: 'continue' });
    else throw new Error(`battle fixture 无法从 ${game.state.phase} 推进`);
  }
  assert.equal(game.state.phase, 'battle', '没有构建有效的进行中战斗 fixture');
}

function makeBattleFixture() {
  registerCombatWorker({ calculateStats, simulateBattle });
  const game = ShanhaiGame.create(content, {
    seed: 'theme-active-battle-fixture',
    name: '主题回归行者',
    method: 'RKF03',
  });
  game.state.n = 2;
  game.state.xp = content.rules.cultivation.cumulative[1];
  game.state.talents.RKF03 = talentsFor('RKF03', 2);
  game.state.hp = game.stats.max_hp;
  advanceBattleFixture(game);
  return serializeRun(game);
}

async function check(name, run) {
  try {
    const details = await run();
    checks.push({ name, ok: true, ...(details ? { details } : {}) });
    console.log(`ok - ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name, error: message });
    checks.push({ name, ok: false, error: message });
    throw error;
  }
}

async function applyCandidateTheme(page) {
  if (useCandidateTheme) await page.addStyleTag({ path: themePath });
}

async function screenshot(page, width, label) {
  await page.screenshot({
    path: path.join(screenshotDir, `${width}-${label}.png`),
    fullPage: true,
  });
}

async function installSave(page, save, phase) {
  await page.evaluate(({ saveKey, replayKey, save }) => {
    localStorage.clear();
    localStorage.setItem(saveKey, save);
    localStorage.removeItem(replayKey);
  }, { saveKey, replayKey, save });
  await page.reload({ waitUntil: 'networkidle' });
  await applyCandidateTheme(page);
  await page.locator(`.game-page.phase-${phase}`).waitFor({ state: 'visible' });
}

async function assertNoOverflow(page, width, label) {
  const result = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(result.document <= width + 1 && result.body <= width + 1,
    `${label}: 页面横向溢出 ${JSON.stringify(result)}`);
  return result;
}

async function portraitPixels(page, selector = '.landing-page .method-portrait .portrait') {
  return page.locator(selector).first().evaluate(async portrait => {
    const svg = portrait.cloneNode(true);
    svg.setAttribute('width', '240');
    svg.setAttribute('height', '280');
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 280;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, 240, 280);
      let opaquePixels = 0;
      let figurePixels = 0;
      for (let y = 0; y < 280; y += 1) {
        for (let x = 0; x < 240; x += 1) {
          const alpha = data[(y * 240 + x) * 4 + 3];
          if (alpha > 0) opaquePixels += 1;
          if (x >= 45 && x <= 195 && y >= 55 && y <= 252 && alpha > 0) {
            figurePixels += 1;
          }
        }
      }
      const cornerAlpha = [0, 239, 240 * 279, 240 * 279 + 239]
        .map(index => data[index * 4 + 3]);
      const bodySample = data[(170 * 240 + 120) * 4 + 3];
      return {
        opaquePixels,
        figurePixels,
        cornerAlpha,
        bodySample,
        borderWidth: getComputedStyle(portrait).borderWidth,
        background: getComputedStyle(portrait).backgroundColor,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  });
}

async function assertLanding(page, width, height) {
  await page.locator('.landing-page').waitFor({ state: 'visible' });
  const art = await portraitPixels(page);
  assert.ok(art.opaquePixels > 1000 && art.figurePixels > 1000,
    `${width}: 人物 SVG 主体像素不足 ${JSON.stringify(art)}`);
  assert.ok(art.cornerAlpha.every(alpha => alpha === 0),
    `${width}: 人物 SVG 画布应保持透明 ${JSON.stringify(art)}`);
  assert.equal(art.borderWidth, '0px', `${width}: 人物 SVG 被加边框`);
  assert.equal(art.background, 'rgba(0, 0, 0, 0)',
    `${width}: 人物 SVG 背景不透明`);

  const start = page.locator('[data-action="start"]');
  await start.waitFor({ state: 'visible' });
  const startBox = await start.boundingBox();
  assert.ok(startBox && startBox.y >= 0 && startBox.y + startBox.height <= height,
    `${width}: 首屏开局按钮不可见 ${JSON.stringify(startBox)}`);
  assert.equal(await page.locator('.method-choice').count(), 5);
  const typography = await page.evaluate(() => ({
    noiseOpacity: getComputedStyle(document.body, '::before').opacity,
    headingSpacing: getComputedStyle(document.querySelector('.landing-copy h1')).letterSpacing,
    actionSpacing: getComputedStyle(document.querySelector('[data-action="start"]')).letterSpacing,
    sceneOpacity: Number.parseFloat(getComputedStyle(
      document.querySelector('.landing-atmosphere .landscape'),
    ).opacity),
    zeroSpacingRule: [...document.styleSheets].some(sheet => {
      try {
        return [...sheet.cssRules].some(rule =>
          rule.selectorText === '.landing-page *, .game-page *' &&
          rule.style.getPropertyValue('letter-spacing') === '0px' &&
          rule.style.getPropertyPriority('letter-spacing') === 'important');
      } catch {
        return false;
      }
    }),
  }));
  assert.equal(typography.noiseOpacity, '0', `${width}: 全屏装饰噪声未关闭`);
  assert.ok(['normal', '0px'].includes(typography.headingSpacing) &&
    ['normal', '0px'].includes(typography.actionSpacing) &&
    typography.zeroSpacingRule,
  `${width}: 全局零字距声明未生效 ${JSON.stringify(typography)}`);
  assert.ok(typography.sceneOpacity >= 0.75,
    `${width}: 封面山水场景不够可见 ${typography.sceneOpacity}`);
  await assertNoOverflow(page, width, `${width} landing`);
  return { art, startBox, typography };
}

async function assertThemeOrder(page, width) {
  const links = await page.locator('link[rel="stylesheet"]').evaluateAll(elements =>
    elements.map(element => new URL(element.href).pathname));
  const base = links.findIndex(href => href.endsWith('/shanhai/style.css'));
  const theme = links.findIndex(href => href.endsWith('/shanhai/game-theme.css'));
  assert.ok(base >= 0 && theme > base,
    `${width}: 主题 CSS 必须在运行时基础样式之后 ${JSON.stringify(links)}`);
  return links;
}

async function assertLayerContract(page, width, { modal = false } = {}) {
  const styles = await page.evaluate(() => {
    const read = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        position: style.position,
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
      };
    };
    const result = {
      world: read('.game-world'),
      topbar: read('.game-page > .topbar'),
      chapter: read('.game-page > .chapter-strip'),
      layout: read('.game-page > .game-layout'),
      bottomNav: read('.game-page > .bottom-nav'),
      backdrop: read('.game-page > .modal-backdrop'),
      worldVeilPointerEvents: getComputedStyle(
        document.querySelector('.game-world'), '::after',
      ).pointerEvents,
    };
    return result;
  });
  assert.equal(styles.world.position, 'fixed');
  assert.equal(styles.world.pointerEvents, 'none');
  assert.equal(styles.worldVeilPointerEvents, 'none');
  assert.equal(styles.topbar.position, 'sticky');
  assert.equal(styles.topbar.zIndex, '30');
  assert.equal(styles.chapter.position, 'relative');
  assert.equal(styles.chapter.zIndex, '1');
  assert.equal(styles.layout.position, 'relative');
  assert.equal(styles.layout.zIndex, '1');
  if (width < 1051) {
    assert.equal(styles.bottomNav.position, 'fixed',
      `${width}: 手机导航必须继续固定在视口底部`);
    assert.equal(styles.bottomNav.zIndex, '50');
  }
  if (modal) {
    assert.equal(styles.backdrop.position, 'fixed',
      `${width}: 弹层背景必须保持 fixed`);
    assert.equal(styles.backdrop.zIndex, '100');
    assert.equal(styles.backdrop.pointerEvents, 'auto');
  }
  return styles;
}

async function assertMapPreview(page, width) {
  const map = page.locator('.game-page.phase-map');
  await map.waitFor({ state: 'visible' });
  const layers = await assertLayerContract(page, width);
  const themeSurface = await page.evaluate(() => {
    const activeNav = [...document.querySelectorAll(
      '.game-page .desktop-nav [aria-current="page"], .game-page .bottom-nav [aria-current="page"]',
    )].find(element => element.getClientRects().length > 0);
    const style = activeNav && getComputedStyle(activeNav);
    return {
      activeLabel: activeNav?.textContent?.trim(),
      navBorder: style?.borderColor,
      navBackgroundImage: style?.backgroundImage,
      sceneOpacity: Number.parseFloat(getComputedStyle(
        document.querySelector('.game-world > .landscape'),
      ).opacity),
      sceneVeil: getComputedStyle(document.querySelector('.game-world'), '::after').backgroundImage,
    };
  });
  assert.ok(['山河', '命盘', '因缘'].includes(themeSurface.activeLabel),
    `${width}: 当前导航名称或状态缺失 ${JSON.stringify(themeSurface)}`);
  assert.ok(themeSurface.navBorder && !themeSurface.navBorder.includes('0)') &&
    themeSurface.navBackgroundImage !== 'none',
  `${width}: 当前导航缺少印记材质 ${JSON.stringify(themeSurface)}`);
  assert.ok(themeSurface.sceneOpacity >= 0.75,
    `${width}: 命途山水场景不够可见 ${themeSurface.sceneOpacity}`);
  await screenshot(page, width, 'map');

  const route = page.locator('.map-node.available:not([disabled])').first();
  await route.waitFor({ state: 'visible' });
  await route.scrollIntoViewIfNeeded();
  const before = await page.evaluate(key => localStorage.getItem(key), saveKey);
  const id = await route.getAttribute('data-id');
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await route.click();
  const dialog = page.locator('.node-preview-dialog[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  await assertLayerContract(page, width, { modal: true });
  assert.equal(await dialog.getAttribute('aria-modal'), 'true');
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), 'map',
    `${width}: 节点预览不应推进命途`);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), before,
    `${width}: 节点预览不应写入存档`);
  await screenshot(page, width, 'node-preview');
  await page.locator('.node-preview-dialog [data-action="modal-close"]').first().click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.game-page').getAttribute('data-phase'), 'map');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), before,
    `${width}: 取消节点预览改变了存档`);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')),
    'preview-node', `${width}: 关闭预览后焦点未返回节点`);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-id')), id);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore,
    `${width}: 关闭节点预览后页面滚动位置改变`);

  await route.click();
  await page.locator('.node-preview-dialog [data-action="confirm-node"]').click();
  await page.locator('.game-page.phase-preview .preview-matchup').waitFor({ state: 'visible' });
  const matchup = await page.locator('.game-page.phase-preview .preview-matchup').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const portraits = [...element.querySelectorAll('.preview-contender > .portrait')]
      .map(portrait => {
        const box = portrait.getBoundingClientRect();
        const portraitStyle = getComputedStyle(portrait);
        return {
          width: box.width,
          height: box.height,
          borderWidth: portraitStyle.borderWidth,
          background: portraitStyle.backgroundColor,
        };
      });
    return {
      borderWidth: style.borderWidth,
      background: style.backgroundColor,
      width: rect.width,
      portraits,
    };
  });
  assert.equal(matchup.borderWidth, '0px', `${width}: 战前对阵仍有完整面板边框`);
  assert.equal(matchup.background, 'rgba(0, 0, 0, 0)',
    `${width}: 战前对阵仍有实心面板背景`);
  const portraitMin = width <= 360 ? 56 : width <= 600 ? 72 : 108;
  assert.ok(matchup.portraits.length === 2 &&
    matchup.portraits.every(portrait => portrait.width >= portraitMin - 1 &&
      portrait.borderWidth === '0px' && portrait.background === 'rgba(0, 0, 0, 0)'),
  `${width}: 战前人物尺寸、透明背景或无框状态异常 ${JSON.stringify(matchup)}`);
  await assertNoOverflow(page, width, `${width} preview`);
  await screenshot(page, width, 'preview');
}

async function assertBattleStage(page, width) {
  await page.locator('.battle-shell .combat-arena').waitFor({ state: 'visible' });
  await page.waitForFunction(() =>
    document.querySelector('.battle-shell')?.getAttribute('data-paused') === 'true');
  const geometry = await page.locator('.battle-shell .combat-arena').evaluate(arena => {
    const arenaStyle = getComputedStyle(arena);
    const core = arena.querySelector('.battle-stage-core');
    const combatants = [...arena.querySelectorAll('.combatant')].map(combatant => {
      const box = combatant.getBoundingClientRect();
      const art = combatant.querySelector('.fighter-art');
      const artStyle = art && getComputedStyle(art);
      const resources = [...combatant.querySelectorAll('.fighter-bars .bar')].map(bar => {
        const rect = bar.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
      });
      return {
        side: combatant.getAttribute('data-side'),
        x: box.x,
        right: box.right,
        resources,
        art: artStyle ? {
          borderWidth: artStyle.borderWidth,
          background: artStyle.backgroundColor,
          boxShadow: artStyle.boxShadow,
        } : null,
      };
    });
    const coreStyle = core && getComputedStyle(core);
    return {
      columns: arenaStyle.gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      borderWidth: arenaStyle.borderWidth,
      background: arenaStyle.backgroundColor,
      terrainOpacity: Number.parseFloat(getComputedStyle(arena.querySelector('.landscape')).opacity),
      combatants,
      core: coreStyle ? {
        borderWidth: coreStyle.borderWidth,
        background: coreStyle.backgroundColor,
      } : null,
    };
  });
  assert.equal(geometry.columns, 3, `${width}: 斗法舞台不再是三列`);
  assert.equal(geometry.borderWidth, '0px', `${width}: 斗法舞台仍有完整矩形边框`);
  assert.equal(geometry.background, 'rgba(0, 0, 0, 0)',
    `${width}: 斗法舞台仍有实心面板背景`);
  assert.equal(geometry.combatants.length, 2, `${width}: 斗法双方人物不完整`);
  assert.ok(geometry.terrainOpacity >= 0.8,
    `${width}: 斗法山水场景不够可见 ${geometry.terrainOpacity}`);
  assert.ok(geometry.combatants.every(fighter => fighter.resources.length === 2 &&
    fighter.art?.borderWidth === '0px' &&
    fighter.art.background === 'rgba(0, 0, 0, 0)' &&
    fighter.art.boxShadow === 'none'),
  `${width}: 角色无框、透明主体或两条资源栏契约失败 ${JSON.stringify(geometry.combatants)}`);
  assert.ok(geometry.combatants[0].right <= geometry.combatants[1].x + 1,
    `${width}: 斗法双方离开原三列站位 ${JSON.stringify(geometry.combatants)}`);
  assert.equal(geometry.core?.borderWidth, '0px',
    `${width}: 战斗说明仍被绘制成有边框的小卡`);
  assert.equal(geometry.core?.background, 'rgba(0, 0, 0, 0)',
    `${width}: 战斗说明仍有实心小卡背景`);
  const pixels = await portraitPixels(page, '.battle-shell .combatant .portrait');
  assert.ok(pixels.opaquePixels > 1000 && pixels.figurePixels > 1000 &&
    pixels.cornerAlpha.every(alpha => alpha === 0),
  `${width}: 斗法人物 SVG 主体或透明画布异常 ${JSON.stringify(pixels)}`);
  await assertNoOverflow(page, width, `${width} battle`);
  await screenshot(page, width, 'battle');
  return { geometry, pixels };
}

async function assertRewardLayout(page, width, height) {
  const geometry = await page.locator('.reward-grid').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const cards = [...element.querySelectorAll('.reward-card')].map(card => {
      const box = card.getBoundingClientRect();
      const text = [...card.querySelectorAll('h2, p, small, .rarity-chip, .stack-note, .attribute-list span')]
        .filter(node => node.getClientRects().length > 0)
        .map(node => ({
          text: (node.textContent || '').trim().slice(0, 24),
          fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
        }));
      const emblem = card.querySelector('.choice-emblem');
      return {
        x: box.x,
        y: box.y,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        text,
        emblem: emblem ? {
          opacity: Number.parseFloat(getComputedStyle(emblem).opacity),
          pointerEvents: getComputedStyle(emblem).pointerEvents,
        } : null,
      };
    });
    const nav = document.querySelector('.bottom-nav');
    return {
      display: getComputedStyle(element).display,
      columns: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      grid: { left: rect.left, right: rect.right },
      cards,
      visibleBottom: nav?.getClientRects().length
        ? nav.getBoundingClientRect().top
        : window.innerHeight,
    };
  });
  assert.equal(geometry.display, 'grid');
  assert.equal(geometry.columns, 3, `${width}: 奖励必须保持三列`);
  assert.equal(geometry.cards.length, 3, `${width}: 三件奖励不完整`);
  assert.ok(geometry.cards.every(card => Math.abs(card.y - geometry.cards[0].y) <= 1),
    `${width}: 奖励卡未保持横排 ${JSON.stringify(geometry.cards)}`);
  assert.ok(geometry.cards.every(card => card.x >= geometry.grid.left - 1 &&
    card.right <= geometry.grid.right + 1 && card.bottom <= geometry.visibleBottom + 1),
  `${width}: 奖励卡溢出容器或没有完整留在首屏 ${JSON.stringify(geometry)}`);
  assert.ok(geometry.cards.every(card => card.text.length > 0 &&
    card.text.every(item => item.fontSize >= 12)),
  `${width}: 奖励正文缺失或小于 12px ${JSON.stringify(geometry.cards)}`);
  assert.ok(geometry.cards.every(card => card.emblem?.opacity > 0 &&
    card.emblem.pointerEvents === 'none'),
  `${width}: 奖励水印缺失或挡住交互`);
  await assertNoOverflow(page, width, `${width} reward`);
  await screenshot(page, width, 'reward');
  return geometry;
}

async function assertTreeAndRespec(page, width) {
  await page.locator('.game-page.phase-shop').waitFor({ state: 'visible' });
  const trigger = page.locator('.topbar [data-action="talent-tree"]');
  const beforeTree = await page.evaluate(key => localStorage.getItem(key), saveKey);
  const scrollBeforeTree = await page.evaluate(() => window.scrollY);
  await trigger.click();
  const dialog = page.locator('.talent-tree-dialog[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  await assertLayerContract(page, width, { modal: true });
  const tree = dialog.locator('.talent-tree-readonly');
  assert.equal(await tree.locator('.talent-tier-row').count(), 4);
  assert.equal(await tree.locator('.talent-tree-node[data-talent-id]').count(), 12);
  assert.equal(await tree.locator('.talent-tier-row').evaluateAll(rows =>
    rows.map(row => row.querySelectorAll('.talent-tree-node').length).join(',')), '3,3,3,3');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), beforeTree,
    `${width}: 只读天赋树不能修改存档`);
  await screenshot(page, width, 'talent-tree');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')),
    'talent-tree', `${width}: 关闭天赋树后焦点未返回入口`);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBeforeTree,
    `${width}: 关闭天赋树后滚动位置改变`);

  const buy = page.locator(
    '.shop-item.service-talent_reset [data-action="buy"][data-id="talent_reset"]',
  );
  await buy.click();
  const resetDialog = page.locator('.talent-reset-dialog[role="dialog"]');
  await resetDialog.waitFor({ state: 'visible' });
  await assertLayerContract(page, width, { modal: true });
  const beforeCancel = await page.evaluate(key => localStorage.getItem(key), saveKey);
  await screenshot(page, width, 'respec-confirmation');
  await resetDialog.locator('[data-action="talent-reset-cancel"]').click();
  await resetDialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), beforeCancel,
    `${width}: 取消洗髓没有保持存档原样`);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')),
    'buy', `${width}: 取消洗髓后焦点未返回购买入口`);

  await buy.click();
  await page.locator('.talent-reset-dialog [data-action="confirm-talent-reset"]').click();
  const selectingTree = page.locator('.game-page.phase-talent .talent-tree-selecting');
  await selectingTree.waitFor({ state: 'visible' });
  const firstTier = selectingTree.locator('.talent-tier-row[data-tier="1"]');
  assert.equal(await firstTier.locator('[data-action="talent"]').count(), 3,
    `${width}: 洗髓第一阶没有三个选择`);
  const firstGeometry = await firstTier.evaluate(row => {
    const rect = row.getBoundingClientRect();
    const cards = [...row.querySelectorAll('.talent-tree-node')].map(node => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    });
    return {
      columns: getComputedStyle(row).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      row: { left: rect.left, right: rect.right },
      cards,
    };
  });
  assert.equal(firstGeometry.columns, 3, `${width}: 洗髓天赋没有维持三列网格`);
  assert.ok(firstGeometry.cards.every(card => card.width >= 44 && card.height >= 44 &&
    card.left >= firstGeometry.row.left - 1 && card.right <= firstGeometry.row.right + 1),
  `${width}: 洗髓天赋节点超出网格或触控区域不足 ${JSON.stringify(firstGeometry)}`);
  await assertNoOverflow(page, width, `${width} respec`);
  await screenshot(page, width, 'respec-choice');
  await page.locator('.game-page.phase-talent [data-action="talent"]').first().click();
  await page.locator('.game-page.phase-talent [data-action="talent"]').first().click();
  await page.locator('.game-page.phase-shop').waitFor({ state: 'visible' });
  const completed = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), saveKey);
  assert.equal(completed?.state?.shop?.find(item => item.id === 'talent_reset')?.sold, true,
    `${width}: 洗髓丹完成后未标记为已售`);
}

async function runViewport(browser, viewport, fixtures) {
  const { width, height } = viewport;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: width < 700,
    hasTouch: width < 700,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(`${width}: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(`${width}: ${message.text()}`);
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await applyCandidateTheme(page);
    await check(`${width}x${height} theme order, transparent character, and first-screen CTA`, async () => {
      const links = await assertThemeOrder(page, width);
      const landing = await assertLanding(page, width, height);
      await screenshot(page, width, 'landing');
      return { links, ...landing };
    });

    await check(`${width}x${height} fixed/sticky layers and side-effect-free map preview`, async () => {
      await page.locator('[name="player-name"]').fill('主题回归行者');
      await page.locator('[name="seed"]').fill(`theme-${width}`);
      await page.locator('[data-action="start"]').click();
      await page.locator('.game-page.phase-map').waitFor({ state: 'visible' });
      await assertMapPreview(page, width);
      return await assertLayerContract(page, width);
    });

    await installSave(page, fixtures.reward, 'reward');
    await check(`${width}x${height} complete three-column reward row`, async () =>
      await assertRewardLayout(page, width, height));

    await installSave(page, fixtures.shop, 'shop');
    await check(`${width}x${height} talent tree focus and wash-marrow flow`, async () =>
      await assertTreeAndRespec(page, width));

    await pauseNextReplay(page);
    await installSave(page, fixtures.battle, 'battle');
    await check(`${width}x${height} open combat stage and two-sided resources`, async () =>
      await assertBattleStage(page, width));
  } finally {
    await context.close();
  }
}

async function run() {
  await mkdir(screenshotDir, { recursive: true });
  const fixtures = {
    reward: makeRewardFixture(),
    shop: makeShopFixture(),
    battle: makeBattleFixture(),
  };
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  try {
    for (const viewport of [
      { width: 320, height: 760 },
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await runViewport(browser, viewport, fixtures);
    }
  } finally {
    await browser.close();
    await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
      url,
      reportDir,
      candidateOverlay: useCandidateTheme ? themePath : null,
      fixtureKind: 'seeded runtime fixtures; real reward and battle simulation; stubbed combat only for shop traversal',
      generatedAt: new Date().toISOString(),
      viewports: [
        { width: 320, height: 760 },
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ],
      checks,
      failures,
      pageErrors,
    }, null, 2) + '\n');
  }
  if (pageErrors.length) {
    throw new Error(`Theme browser runtime errors: ${JSON.stringify(pageErrors)}`);
  }
  if (failures.length) {
    throw new Error(`Theme browser failures: ${JSON.stringify(failures)}`);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
