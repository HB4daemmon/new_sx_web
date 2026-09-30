import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { ShanhaiGame } from '../build/shanhai/run.js';
import { serializeRun } from '../build/shanhai/persistence.js';
import { pauseNextReplay } from './shanhai-replay-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.BROWSER_URL || 'http://127.0.0.1:4173/';
const reportDir = process.env.SHANHAI_CASUAL_UI_REPORT_DIR
  ? path.resolve(process.env.SHANHAI_CASUAL_UI_REPORT_DIR)
  : '/tmp/suishi-casual-theme';
const screenshotDir = path.join(reportDir, 'screenshots');
const saveKey = 'suishi-shanhai-run-v1';
const replayKey = 'suishi-shanhai-replay-v1';
const viewports = [
  { width: 320, height: 760 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];
const checks = [];
const issues = [];
const browserErrors = [];
const themeCss = await readFile(path.join(root, 'src/shanhai/casual-theme.css'), 'utf8');
const themeLines = themeCss.split(/\r?\n/);

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

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';
const loadedContent = await loadContent();
const content = {
  version: loadedContent.manifest.content_version,
  entities: loadedContent.entities,
  byId: loadedContent.byId,
  rules: loadedContent.entities.find(entity => entity.id === 'RULES'),
};

class UiViolation extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UiViolation';
    this.details = details;
  }
}

function themeLine(selector, property) {
  const selectorIndex = themeLines.findIndex(line => line.includes(selector));
  if (selectorIndex < 0) return null;
  const declarationIndex = themeLines
    .slice(selectorIndex, Math.min(themeLines.length, selectorIndex + 12))
    .findIndex(line => line.includes(`${property}:`));
  return declarationIndex < 0 ? selectorIndex + 1 : selectorIndex + declarationIndex + 1;
}

function throwViolation(message, {
  severity = 'moderate',
  selector = '#shanhai-app',
  phase = null,
  measured = null,
  property = 'color',
  sourceSelector = selector,
  source = 'src/shanhai/casual-theme.css',
} = {}) {
  throw new UiViolation(message, {
    severity,
    file: source,
    line: source === 'src/shanhai/casual-theme.css'
      ? themeLine(sourceSelector, property)
      : null,
    selector,
    phase,
    measured,
  });
}

function entity(id) {
  return content.byId.get(id);
}

function makeGame(seed) {
  const game = ShanhaiGame.create(content, {
    seed,
    name: `轻松UI${seed}`,
    method: 'RKF03',
  });
  const method = entity(game.state.method);
  const cumulative = content.rules.cultivation?.cumulative ?? [];
  const selected = [1, 2, 3, 4].map(tier => {
    const talent = method.talents.find(item => item.tier === tier);
    assert.ok(talent, `缺少 ${method.id} 第 ${tier} 层天赋`);
    return talent.id;
  });
  const artifact = content.entities.find(item =>
    item.kind === 'artifact' && Number.isInteger(item.max_stacks) && item.max_stacks >= 1);
  assert.ok(artifact, '缺少可用法宝 UI fixture');

  game.state.n = 4;
  game.state.xp = cumulative[3] ?? 0;
  game.state.talents[game.state.method] = selected;
  game.state.artifacts = [{ id: artifact.id, stacks: 1 }];
  game.state.coins = 200;
  game.state.hp = game.stats.max_hp;
  return game;
}

function pathToType(game, types) {
  const route = game.state.routeMap;
  const byKey = new Map(route.nodes.map(node => [node.key, node]));
  const queue = game.availableNodes().map(node => [node.key]);
  const seen = new Set();
  while (queue.length) {
    const path = queue.shift();
    const node = byKey.get(path.at(-1));
    if (!node || seen.has(node.key)) continue;
    seen.add(node.key);
    if (types.includes(node.type)) return path;
    for (const next of node.next ?? []) queue.push([...path, next]);
  }
  return null;
}

function battleOutcome(game) {
  let attempts = 0;
  while (game.state.battle?.outcome === 'draw' && attempts++ < 4) {
    game.dispatch({ type: 'continue_battle' });
  }
  if (game.state.battle?.outcome === 'draw') {
    throw new Error('UI fixture battle stayed drawn after four legal horizon extensions');
  }
}

function settleCurrentNode(game) {
  let guard = 0;
  while (game.state.phase !== 'map' &&
    !['won', 'lost'].includes(game.state.phase) && guard++ < 32) {
    if (game.state.phase === 'preview') {
      game.dispatch({ type: 'fight' });
    } else if (game.state.phase === 'battle') {
      battleOutcome(game);
      game.dispatch({ type: 'battle_done' });
    } else if (game.state.phase === 'reward') {
      game.dispatch({ type: 'reward', id: null });
    } else if (game.state.phase === 'event') {
      const current = entity(game.node.id);
      const option = current.options.find(item =>
        !item.encounter && game.optionAvailability(item).available) ??
        current.options.find(item => game.optionAvailability(item).available);
      assert.ok(option, `fixture 事件 ${current.id} 没有可用选项`);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') {
      game.dispatch({ type: 'continue' });
    } else if (game.state.phase === 'shop') {
      game.dispatch({ type: 'leave_shop' });
    } else if (game.state.phase === 'rest') {
      game.dispatch({ type: 'rest', choice: 'heal' });
    } else if (game.state.phase === 'talent') {
      const choice = game.availableTalents()[0];
      assert.ok(choice, 'fixture 突破阶段没有可选天赋');
      game.dispatch({ type: 'talent', id: choice.id });
    } else if (game.state.phase === 'transition') {
      game.dispatch({ type: 'continue' });
    } else {
      throw new Error(`fixture 无法从 ${game.state.phase} 推进`);
    }
  }
  assert.ok(guard < 32, 'fixture 节点未能结算');
}

function createPhaseFixture(target, seed) {
  const game = makeGame(seed);
  if (target === 'map') {
    return { phase: target, save: serializeRun(game), fixtureKind: 'legal seeded UI state' };
  }
  const targetTypes = {
    preview: ['C', 'L', 'B', 'F'],
    battle: ['C', 'L', 'B', 'F'],
    reward: ['C', 'L', 'B', 'F'],
    event: ['E', 'K'],
    shop: ['S'],
    rest: ['R'],
  }[target];
  assert.ok(targetTypes, `未知 fixture 阶段 ${target}`);
  let guard = 0;
  while (game.state.phase !== target && !['won', 'lost'].includes(game.state.phase) &&
    guard++ < 100) {
    if (game.state.phase === 'map') {
      const path = pathToType(game, targetTypes);
      assert.ok(path?.length, `当前路线没有可达 ${target} 节点`);
      const node = game.availableNodes().find(item => item.key === path[0]);
      assert.ok(node, `${target} fixture 第一步不可达`);
      game.dispatch({ type: 'enter', id: node.key });
    } else if (game.state.phase === 'preview') {
      game.dispatch({ type: 'fight' });
    } else if (game.state.phase === 'battle') {
      battleOutcome(game);
      game.dispatch({ type: 'battle_done' });
    } else if (game.state.phase === 'reward') {
      game.dispatch({ type: 'reward', id: null });
    } else if (game.state.phase === 'event') {
      const current = entity(game.node.id);
      const option = current.options.find(item =>
        !item.encounter && game.optionAvailability(item).available) ??
        current.options.find(item => game.optionAvailability(item).available);
      assert.ok(option, `fixture 事件 ${current.id} 没有可用选项`);
      game.dispatch({ type: 'event', id: option.id });
    } else if (game.state.phase === 'event_result') {
      game.dispatch({ type: 'continue' });
    } else {
      settleCurrentNode(game);
    }
  }
  assert.equal(game.state.phase, target, `${target} fixture ended at ${game.state.phase}`);
  if (target === 'reward') {
    assert.equal(game.state.battle?.outcome, 'player',
      'reward fixture must come from a simulated player victory');
  }
  return {
    phase: target,
    save: serializeRun(game),
    fixtureKind: 'seeded legal ShanhaiGame state for UI rendering; not a claimed end-to-end journey',
    outcome: target === 'battle' || target === 'reward' ? game.state.battle?.outcome : undefined,
  };
}

function createTalentFixture() {
  const game = makeGame('casual-ui-talent-reset');
  const shopPath = pathToType(game, ['S']);
  assert.ok(shopPath?.length, 'talent fixture requires a reachable shop');
  for (const key of shopPath) {
    const node = game.availableNodes().find(item => item.key === key);
    assert.ok(node, `talent fixture shop path node ${key} became unreachable`);
    game.dispatch({ type: 'enter', id: key });
    if (game.state.phase === 'shop') break;
    settleCurrentNode(game);
  }
  assert.equal(game.state.phase, 'shop', 'talent fixture did not reach a shop');
  const method = entity(game.state.method);
  game.state.talents[game.state.method] = method.talents
    .filter(item => item.tier === 1)
    .slice(0, 1)
    .map(item => item.id);
  game.state.hp = game.stats.max_hp;
  game.state.coins = 200;
  game.dispatch({ type: 'buy', id: 'talent_reset' });
  assert.equal(game.state.phase, 'talent');
  const firstChoice = game.availableTalents()[0];
  assert.ok(firstChoice, 'talent reset fixture has no first choice');
  game.dispatch({ type: 'talent', id: firstChoice.id });
  assert.equal(game.state.phase, 'talent', 'second tier should remain pending');
  return {
    phase: 'talent',
    save: serializeRun(game),
    fixtureKind: 'legal shop reset and talent selection UI state; not a claimed end-to-end journey',
  };
}

function createKarmaFixture() {
  const game = createPhaseFixture('event', 'casual-ui-karma').save;
  const fresh = new ShanhaiGame(content, JSON.parse(game).state);
  const event = entity(fresh.node.id);
  const option = event.options.find(item =>
    !item.encounter && fresh.optionAvailability(item).available) ??
    event.options.find(item => fresh.optionAvailability(item).available);
  assert.ok(option, 'karma fixture event has no available choice');
  fresh.dispatch({ type: 'event', id: option.id });
  settleCurrentNode(fresh);
  assert.equal(fresh.state.phase, 'map', 'karma fixture choice should return to the map');
  assert.ok(fresh.state.history.length > 0, 'karma fixture should retain an event history entry');
  return {
    phase: 'map',
    save: serializeRun(fresh),
    fixtureKind: 'legal event resolution UI state with recorded history',
  };
}

function sourceDetailsForIssue(error, fallbackPhase) {
  if (error instanceof UiViolation) {
    return { ...error.details, phase: error.details.phase ?? fallbackPhase };
  }
  const text = error instanceof Error ? error.message : String(error);
  const match = text.match(/selector[=: ]+([.#\w[\]="'-]+)/i);
  const selector = match?.[1] || '#shanhai-app';
  return {
    severity: 'moderate',
    file: 'src/shanhai/casual-theme.css',
    line: themeLine(selector, 'color'),
    selector,
    phase: fallbackPhase,
    measured: text,
  };
}

async function check(name, phase, fn) {
  try {
    const measured = await fn();
    checks.push({ name, phase, ok: true, measured: measured ?? null });
  } catch (error) {
    const details = sourceDetailsForIssue(error, phase);
    const issue = {
      id: `CASUAL-${String(issues.length + 1).padStart(3, '0')}`,
      name,
      severity: details.severity,
      file: details.file,
      line: details.line,
      selector: details.selector,
      phase,
      reproduction: `${url} at phase=${phase}`,
      measured: details.measured,
      error: error instanceof Error ? error.message : String(error),
    };
    issues.push(issue);
    checks.push({ name, phase, ok: false, issue: issue.id });
    console.error(`${issue.id} ${issue.severity}: ${issue.error}`);
  }
}

async function installFixture(page, fixture, { pauseBattle = false } = {}) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (pauseBattle) await pauseNextReplay(page);
  await page.evaluate(({ key, save, replayKey }) => {
    localStorage.clear();
    localStorage.setItem(key, save);
    localStorage.removeItem(replayKey);
  }, { key: saveKey, save: fixture.save, replayKey });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator(`.game-page.phase-${fixture.phase}`).waitFor({ state: 'visible' });
  if (pauseBattle) await page.locator('.battle-shell[data-paused="true"]').waitFor();
}

async function clickAction(page, action, selector = `[data-action="${action}"]`) {
  const candidates = page.locator(selector);
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible()) || await candidate.isDisabled()) continue;
    await candidate.scrollIntoViewIfNeeded();
    await candidate.click();
    return candidate;
  }
  throw new Error(`找不到可见可用操作 ${selector}`);
}

async function noOverflow(page, phase) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  if (metrics.document > metrics.viewport + 1 || metrics.body > metrics.viewport + 1) {
    throwViolation('页面出现整体横向溢出', {
      severity: 'high',
      selector: 'html, body',
      phase,
      measured: metrics,
      property: 'overflow-x',
      sourceSelector: 'html, body',
    });
  }
  return metrics;
}

async function assertSurfaceBasics(page, phase) {
  const result = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden';
    };
    const visibleSvgs = [...document.querySelectorAll('svg')].filter(visible)
      .map(element => element.outerHTML.slice(0, 160));
    const imageResults = [...document.images].map(image => ({
      src: image.currentSrc || image.src,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      visible: visible(image),
    }));
    const backgroundSvg = [...document.querySelectorAll('*')].filter(visible)
      .map(element => ({
        selector: element.id ? `#${element.id}` : element.className?.toString().split(/\s+/).slice(0, 2).join('.'),
        image: getComputedStyle(element).backgroundImage,
      }))
      .filter(item => /data:image\/svg\+xml/i.test(item.image));
    return {
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      visibleSvgs,
      imageResults,
      backgroundSvg,
    };
  });
  if (!/\blight\b/i.test(result.colorScheme)) {
    throwViolation('computed color-scheme is not light', {
      severity: 'moderate',
      selector: ':root',
      phase,
      measured: { colorScheme: result.colorScheme },
      property: 'color-scheme',
      sourceSelector: ':root',
    });
  }
  if (result.visibleSvgs.length) {
    throwViolation('visible DOM contains SVG markup', {
      severity: 'moderate',
      selector: 'svg',
      phase,
      measured: result.visibleSvgs,
      source: 'src/shanhai/app.ts',
    });
  }
  if (result.backgroundSvg.length) {
    throwViolation('visible CSS background uses a data SVG', {
      severity: 'moderate',
      selector: result.backgroundSvg[0].selector || '*',
      phase,
      measured: result.backgroundSvg,
      property: 'background-image',
      sourceSelector: 'html, body',
    });
  }
  const broken = result.imageResults.filter(image =>
    !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0);
  if (broken.length) {
    throwViolation('PNG art did not finish loading with natural dimensions', {
      severity: 'high',
      selector: 'img',
      phase,
      measured: broken,
      property: 'background-image',
      source: 'src/art.ts',
    });
  }
  return {
    colorScheme: result.colorScheme,
    visibleImages: result.imageResults.filter(image => image.visible).length,
    imageCount: result.imageResults.length,
    visibleSvgCount: result.visibleSvgs.length,
    dataSvgBackgroundCount: result.backgroundSvg.length,
  };
}

async function assertReadableContrast(page, phase) {
  const metrics = await page.evaluate(() => {
    const skip = element => Boolean(element.closest('[aria-hidden="true"]'));
    const visibleRect = node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
    };
    const composite = (top, under) => {
      if (!top) return under;
      const alpha = top[3];
      return [
        top[0] * alpha + under[0] * (1 - alpha),
        top[1] * alpha + under[1] * (1 - alpha),
        top[2] * alpha + under[2] * (1 - alpha),
        1,
      ];
    };
    const parse = value => {
      const match = value.match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const values = match[1].split(',').map(part => Number.parseFloat(part.trim()));
      return values.length >= 3 && values.slice(0, 3).every(Number.isFinite)
        ? [values[0], values[1], values[2], Number.isFinite(values[3]) ? values[3] : 1]
        : null;
    };
    const luminance = rgb => {
      const channels = rgb.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const ratio = (first, second) => {
      const a = luminance(first);
      const b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const themeColorSelector = element => {
      const sheets = [...document.styleSheets]
        .filter(sheet => sheet.href?.includes('/shanhai/casual-theme.css'));
      const visit = (rules, target) => {
        let match = null;
        for (const rule of rules) {
          if (rule.cssRules) {
            match = visit(rule.cssRules, target) || match;
          } else if (rule.selectorText && rule.style?.getPropertyValue('color')) {
            try {
              if (target.matches(rule.selectorText)) match = rule.selectorText;
            } catch {
              // Ignore selectors unsupported by the current browser parser.
            }
          }
        }
        return match;
      };
      for (let target = element; target; target = target.parentElement) {
        for (const sheet of sheets) {
          try {
            const match = visit(sheet.cssRules, target);
            if (match) return match;
          } catch {
            // Inaccessible CSSOM rules cannot provide a source line.
          }
        }
      }
      return element.className?.toString().trim().split(/\s+/).filter(Boolean)
        .slice(0, 3).map(name => `.${name}`).join('') || element.tagName.toLowerCase();
    };
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue?.replace(/\s+/g, ' ').trim();
      const element = node.parentElement;
      if (!text || !element || skip(element) || !visibleRect(node)) continue;
      const style = getComputedStyle(element);
      if (style.opacity === '0' || style.display === 'none' || style.visibility === 'hidden') continue;
      const foreground = parse(style.color);
      if (!foreground) continue;
      let background = [255, 255, 255, 1];
      const ancestors = [];
      for (let current = element; current; current = current.parentElement) ancestors.push(current);
      for (const current of ancestors.reverse()) {
        const color = parse(getComputedStyle(current).backgroundColor);
        if (color && color[3] > 0) background = composite(color, background);
      }
      const renderedForeground = foreground[3] < 1
        ? composite(foreground, background)
        : foreground;
      const fontSize = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const minimum = fontSize >= 24 || (fontSize >= 18.67 && weight >= 700) ? 3 : 4.5;
      textNodes.push({
        text: text.slice(0, 48),
        selector: element.id ? `#${element.id}` :
          element.className?.toString().trim().split(/\s+/).filter(Boolean).slice(0, 3)
            .map(name => `.${name}`).join('') || element.tagName.toLowerCase(),
        foreground: style.color,
        background: `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`,
        ratio: Number(ratio(renderedForeground, background).toFixed(2)),
        minimum,
        fontSize,
        weight,
        sourceSelector: themeColorSelector(element),
      });
    }
    return textNodes;
  });
  const low = metrics.filter(metric => metric.ratio < metric.minimum);
  if (low.length) {
    const worst = low.toSorted((a, b) => a.ratio - b.ratio)[0];
    throwViolation('visible text contrast is below the required threshold', {
      severity: 'moderate',
      selector: worst.selector,
      phase,
      measured: { worst, count: low.length, examples: low.slice(0, 12) },
      property: 'color',
      sourceSelector: worst.sourceSelector,
    });
  }
  return {
    textNodeCount: metrics.length,
    minimumRatio: Number(Math.min(...metrics.map(metric => metric.ratio), 21).toFixed(2)),
    thresholds: '4.5:1 normal text; 3:1 large text',
  };
}

async function assertTouchAndFraming(page, phase) {
  const metrics = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden';
    };
    const radius = style => Math.max(...style.borderRadius
      .split(/\s+/)
      .map(value => Number.parseFloat(value) || 0));
    const buttons = [...document.querySelectorAll('button')]
      .filter(element => visible(element) && !element.disabled)
      .map(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          selector: element.getAttribute('data-action')
            ? `button[data-action="${element.getAttribute('data-action')}"]`
            : element.className?.toString().split(/\s+/).filter(Boolean).slice(0, 2)
              .map(name => `.${name}`).join('') || 'button',
          label: (element.getAttribute('aria-label') || element.innerText || '').trim().slice(0, 40),
          width: rect.width,
          height: rect.height,
          borderRadius: radius(style),
          insideBottomNav: Boolean(element.closest('.bottom-nav')),
          isMapNode: element.classList.contains('map-node'),
        };
      });
    const cards = [...document.querySelectorAll(
      '.method-choice, .reward-card, .ability-card, .shop-item, .event-option, .rest-choice, .talent-tree-node, .archive-item, .timeline-item',
    )].filter(visible).map(element => ({
      selector: `.${element.classList[0]}`,
      borderRadius: radius(getComputedStyle(element)),
    }));
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
      .filter(visible).map(element => ({
        selector: element.classList.length ? `.${[...element.classList].join('.')}` : '[role="dialog"]',
        borderRadius: radius(getComputedStyle(element)),
      }));
    const sections = [...document.querySelectorAll(
      '.game-page, .main-stage, .player-rail, .event-page, .karma-page, .build-focus, .build-section',
    )].filter(visible).map(element => {
      const style = getComputedStyle(element);
      const borders = [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ].map(value => Number.parseFloat(value) || 0);
      return {
        selector: element.classList.length
          ? `.${[...element.classList].slice(0, 3).join('.')}`
          : element.tagName.toLowerCase(),
        borderRadius: radius(style),
        shadow: style.boxShadow,
        borders,
        hasFullFrame: borders.every(width => width > 0),
      };
    });
    return { buttons, cards, dialogs, sections };
  });
  const shortButtons = metrics.buttons.filter(button =>
    button.width < 44 || button.height < 44);
  if (shortButtons.length) {
    throwViolation('visible enabled button has a touch target below 44x44 CSS pixels', {
      severity: 'moderate',
      selector: shortButtons[0].selector,
      phase,
      measured: shortButtons,
      property: 'min-height',
      sourceSelector: '.button',
    });
  }
  const roundedButtons = metrics.buttons.filter(button =>
    !button.isMapNode && button.borderRadius > 8);
  if (roundedButtons.length) {
    throwViolation('interactive button corner radius exceeds 8px', {
      severity: 'low',
      selector: roundedButtons[0].selector,
      phase,
      measured: roundedButtons,
      property: 'border-radius',
      sourceSelector: '.button',
    });
  }
  const overroundedCards = metrics.cards.filter(card => card.borderRadius > 8);
  if (overroundedCards.length) {
    throwViolation('repeated choice/item radius exceeds 8px', {
      severity: 'low',
      selector: overroundedCards[0].selector,
      phase,
      measured: overroundedCards,
      property: 'border-radius',
      sourceSelector: overroundedCards[0].selector,
    });
  }
  const overroundedDialogs = metrics.dialogs.filter(dialog => dialog.borderRadius > 8);
  if (overroundedDialogs.length) {
    throwViolation('modal corner radius exceeds 8px', {
      severity: 'low',
      selector: overroundedDialogs[0].selector,
      phase,
      measured: overroundedDialogs,
      property: 'border-radius',
      sourceSelector: '.dialog',
    });
  }
  const framedSections = metrics.sections.filter(section =>
    section.shadow !== 'none' || section.hasFullFrame);
  if (framedSections.length) {
    throwViolation('page section/player rail still has a full decorative frame', {
      severity: 'moderate',
      selector: framedSections[0].selector,
      phase,
      measured: framedSections,
      property: 'box-shadow',
      sourceSelector: framedSections[0].selector,
    });
  }
  return {
    visibleButtons: metrics.buttons.length,
    repeatedItems: metrics.cards.length,
    visibleDialogs: metrics.dialogs.length,
    pageSections: metrics.sections.length,
    minimumTouchTarget: shortButtons.length ? null : '44x44px',
    maxButtonRadius: Math.max(0, ...metrics.buttons.map(button => button.borderRadius)),
    maxRepeatedItemRadius: Math.max(0, ...metrics.cards.map(card => card.borderRadius)),
    decorativeFrames: framedSections.length,
  };
}

async function assertNavigationAndModal(page, phase, { modal = false } = {}) {
  const result = await page.evaluate(({ modal }) => {
    const visible = element => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden';
    };
    const header = document.querySelector('.topbar');
    const bottom = document.querySelector('.bottom-nav');
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    const primary = modal
      ? dialog?.querySelector('.dialog-actions button')
      : document.querySelector('.main-stage button:not([disabled])');
    const rect = element => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, bottom: value.bottom };
    };
    let topHit = null;
    if (dialog && primary && visible(primary)) {
      const box = primary.getBoundingClientRect();
      topHit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        ?.closest('button') === primary;
    }
    return {
      header: rect(header),
      headerVisible: visible(header),
      bottom: rect(bottom),
      bottomVisible: visible(bottom),
      viewportHeight: window.innerHeight,
      dialog: rect(dialog),
      dialogVisible: visible(dialog),
      primary: rect(primary),
      primaryVisible: visible(primary),
      primaryHit: topHit,
    };
  }, { modal });
  const isMobile = result.viewportHeight > 0 && (await page.evaluate(() => innerWidth)) < 1050;
  if (!result.headerVisible) {
    throwViolation('topbar is not visible', {
      severity: 'moderate',
      selector: '.topbar',
      phase,
      measured: result,
      property: 'position',
      sourceSelector: '.topbar',
    });
  }
  if (isMobile && phase !== 'landing' && !result.bottomVisible) {
    throwViolation('mobile bottom navigation is not visible', {
      severity: 'moderate',
      selector: '.bottom-nav',
      phase,
      measured: result,
      property: 'position',
      sourceSelector: '.bottom-nav',
    });
  }
  if (modal) {
    if (!result.dialogVisible || !result.dialog ||
      result.dialog.x < -1 || result.dialog.y < -1 ||
      result.dialog.x + result.dialog.width > await page.evaluate(() => innerWidth) + 1 ||
      result.dialog.bottom > result.viewportHeight + 1) {
      throwViolation('modal does not fit within the viewport', {
        severity: 'high',
        selector: '[role="dialog"][aria-modal="true"]',
        phase,
        measured: result,
        property: 'max-height',
        sourceSelector: '.dialog',
      });
    }
    if (!result.primaryVisible || result.primaryHit === false) {
      throwViolation('modal primary action is hidden or occluded', {
        severity: 'high',
        selector: '.dialog-actions button',
        phase,
        measured: result,
        property: 'z-index',
        sourceSelector: '.modal-backdrop',
      });
    }
  } else if (isMobile && result.primary && result.bottom &&
    result.primary.bottom > result.bottom.y + 1) {
    throwViolation('bottom navigation overlaps the first visible main-stage action', {
      severity: 'moderate',
      selector: '.main-stage button:not([disabled])',
      phase,
      measured: result,
      property: 'padding-bottom',
      sourceSelector: '.main-stage',
    });
  }
  return result;
}

async function assertLastChoiceAboveBottomNav(page, phase) {
  const metrics = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    const stage = document.querySelector('.main-stage');
    const buttons = [...(stage?.querySelectorAll('button:not([disabled])') ?? [])]
      .filter(button => button.getClientRects().length > 0);
    if (!nav || getComputedStyle(nav).display === 'none' || !buttons.length) return null;
    const button = buttons.at(-1);
    window.scrollTo(0, document.documentElement.scrollHeight);
    const navRect = nav.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      button: {
        action: button.getAttribute('data-action'),
        text: (button.innerText || '').trim().slice(0, 40),
        top: buttonRect.top,
        bottom: buttonRect.bottom,
      },
      nav: { top: navRect.top, bottom: navRect.bottom },
      viewportHeight: window.innerHeight,
    };
  });
  if (metrics && metrics.button.bottom > metrics.nav.top + 1) {
    throwViolation('mobile bottom navigation overlaps the last main-stage choice', {
      severity: 'high',
      selector: '.main-stage button:not([disabled])',
      phase,
      measured: metrics,
      property: 'padding-bottom',
      sourceSelector: '.main-stage',
    });
  }
  return metrics;
}

async function assertRewardFirstScreen(page, phase) {
  const metrics = await page.evaluate(() => {
    const grid = document.querySelector('.reward-grid');
    const cards = [...(grid?.querySelectorAll('.reward-card') ?? [])];
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const nav = document.querySelector('.bottom-nav');
    const navTop = nav && getComputedStyle(nav).display !== 'none'
      ? nav.getBoundingClientRect().top
      : innerHeight;
    const rects = cards.map(card => {
      const rect = card.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    });
    const tracks = gridStyle?.gridTemplateColumns
      .split(/\s+(?![^()]*\))/).filter(Boolean) ?? [];
    return { count: cards.length, tracks: tracks.length, rects, navTop, viewportHeight: innerHeight };
  });
  if (metrics.count !== 3 || metrics.tracks !== 3) {
    throwViolation('reward first screen must keep exactly three visible choice columns', {
      severity: 'moderate',
      selector: '.reward-grid',
      phase,
      measured: metrics,
      property: 'grid-template-columns',
      sourceSelector: '.reward-grid',
    });
  }
  const firstRow = metrics.rects;
  if (firstRow.length !== 3 || firstRow.some(rect =>
    rect.y < 0 || rect.bottom > metrics.navTop + 1 || rect.bottom > metrics.viewportHeight + 1)) {
    throwViolation('three reward choices do not fit above the fold and bottom navigation', {
      severity: 'moderate',
      selector: '.reward-grid > .reward-card',
      phase,
      measured: metrics,
      property: 'grid-template-columns',
      sourceSelector: '.reward-grid',
    });
  }
  return metrics;
}

async function assertCanvas(page, canvasSelector, hostSelector, metadataSelector, phase, kind) {
  await waitForVisualStability(page);
  const metrics = await page.locator(canvasSelector).evaluate(
    (canvas, { hostSelector, metadataSelector }) => {
      const host = canvas.closest(hostSelector);
      if (!host) throw new Error(`Canvas host not found: ${hostSelector}`);
      const rect = host.getBoundingClientRect();
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgbaPixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
      let paintedPixels = 0;
      if (rgbaPixels) {
        for (let alpha = 3; alpha < rgbaPixels.length; alpha += 4) {
          if (rgbaPixels[alpha] > 0) paintedPixels += 1;
        }
      }
      const metadata = [...host.querySelectorAll(metadataSelector)].map(element => {
        const fromKey = element.getAttribute('data-from-key') ??
          element.getAttribute('data-from-index') ?? element.getAttribute('data-from-id');
        const toKey = element.getAttribute('data-to-key') ??
          element.getAttribute('data-to-index') ?? element.getAttribute('data-to-id');
        const pointData = JSON.parse(element.getAttribute('data-points') || '[]');
        const findNode = key => {
          if (element.hasAttribute('data-from-id')) {
            return host.querySelector(`[data-talent-id="${CSS.escape(key)}"]`);
          }
          return host.querySelector(`[data-map-node-key="${CSS.escape(key)}"], [data-map-node-index="${CSS.escape(key)}"]`);
        };
        const from = findNode(fromKey);
        const to = findNode(toKey);
        return { fromKey, toKey, points: pointData, hasFrom: Boolean(from), hasTo: Boolean(to) };
      });
      const canvasRect = canvas.getBoundingClientRect();
      return {
        hostWidth: rect.width,
        hostHeight: rect.height,
        dpr: window.devicePixelRatio || 1,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        canvasWidth: canvasRect.width,
        canvasHeight: canvasRect.height,
        paintedPixels,
        metadataCount: metadata.length,
        metadata,
      };
    }, { hostSelector, metadataSelector });
  if (metrics.metadataCount <= 0 || metrics.paintedPixels <= 0) {
    throwViolation(`${kind} connector Canvas is empty or has no endpoint metadata`, {
      severity: 'high',
      selector: canvasSelector,
      phase,
      measured: metrics,
      property: 'width',
      sourceSelector: canvasSelector,
    });
  }
  if (metrics.metadata.some(item => !item.hasFrom || !item.hasTo || item.points.length !== 4 ||
    item.points.some((point, index) => index > 0 &&
      point[0] !== item.points[index - 1][0] && point[1] !== item.points[index - 1][1]))) {
    throwViolation(`${kind} connector metadata does not map to four-point orthogonal edges`, {
      severity: 'high',
      selector: metadataSelector,
      phase,
      measured: metrics.metadata,
      property: 'content',
      sourceSelector: metadataSelector,
    });
  }
  if (metrics.backingWidth !== Math.round(metrics.canvasWidth * metrics.dpr) ||
    metrics.backingHeight !== Math.round(metrics.canvasHeight * metrics.dpr)) {
    throwViolation(`${kind} Canvas backing dimensions do not match the visible canvas and DPR`, {
      severity: 'moderate',
      selector: canvasSelector,
      phase,
      measured: metrics,
      property: 'width',
      sourceSelector: canvasSelector,
    });
  }
  return {
    paintedPixels: metrics.paintedPixels,
    edgeCount: metrics.metadataCount,
    canvas: [metrics.backingWidth, metrics.backingHeight],
  };
}

async function saveScreenshot(page, viewport, phase) {
  const file = path.join(screenshotDir, `${viewport.width}x${viewport.height}-${phase}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(reportDir, file);
}

async function waitForVisualStability(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const runningFiniteAnimations = () => document.getAnimations().filter(animation => {
      const timing = animation.effect?.getComputedTiming();
      return timing && Number.isFinite(timing.iterations) &&
        (animation.playState === 'running' || animation.playState === 'pending');
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const active = runningFiniteAnimations();
      if (active.length) {
        await Promise.all(active.map(animation => animation.finished.catch(() => undefined)));
      }
      await nextFrame();
      await nextFrame();
      if (!runningFiniteAnimations().length) return;
    }
    throw new Error('Timed out waiting for finite UI animations to settle');
  });
}

async function validatePhase(page, viewport, phase, screenshots) {
  await waitForVisualStability(page);
  await check(`${viewport.width}x${viewport.height} ${phase} light/art/no-svg`, phase,
    () => assertSurfaceBasics(page, phase));
  await check(`${viewport.width}x${viewport.height} ${phase} contrast`, phase,
    () => assertReadableContrast(page, phase));
  await check(`${viewport.width}x${viewport.height} ${phase} geometry/touch/framing`, phase,
    () => assertTouchAndFraming(page, phase));
  await check(`${viewport.width}x${viewport.height} ${phase} overflow`, phase,
    () => noOverflow(page, phase));
  if (phase !== 'map' && phase !== 'battle' && phase !== 'nodepreview' && phase !== 'modal') {
    await check(`${viewport.width}x${viewport.height} ${phase} last choice/bottom nav`, phase,
      () => assertLastChoiceAboveBottomNav(page, phase));
  }
  await check(`${viewport.width}x${viewport.height} ${phase} shell/modal occlusion`, phase,
    () => assertNavigationAndModal(page, phase, { modal: phase === 'nodepreview' || phase === 'modal' }));
  try {
    screenshots.push(await saveScreenshot(page, viewport, phase));
  } catch (error) {
    const details = sourceDetailsForIssue(error, phase);
    issues.push({
      id: `CASUAL-${String(issues.length + 1).padStart(3, '0')}`,
      name: 'screenshot capture',
      severity: 'low',
      file: details.file,
      line: details.line,
      selector: details.selector,
      phase,
      reproduction: `${url} at phase=${phase}`,
      measured: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runViewport(browser, viewport, fixtures) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let activePhase = null;
  page.on('pageerror', error => browserErrors.push({
    viewport: `${viewport.width}x${viewport.height}`,
    type: 'pageerror',
    error: error.message,
    phase: activePhase,
    file: 'src/shanhai/app.ts',
    line: null,
    selector: '#shanhai-app',
  }));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push({
      viewport: `${viewport.width}x${viewport.height}`,
      type: 'console',
      error: message.text(),
      phase: activePhase,
      file: /assets\/casual\//.test(message.text()) ? 'src/art.ts' : 'src/shanhai/app.ts',
      line: null,
      selector: /assets\/casual\//.test(message.text()) ? 'img' : '#shanhai-app',
    });
  });
  const screenshots = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.landing-page').waitFor({ state: 'visible' });
    activePhase = 'landing';
    await validatePhase(page, viewport, 'landing', screenshots);

    await installFixture(page, fixtures.map);
    activePhase = 'map';
    await validatePhase(page, viewport, 'map', screenshots);
    await check(`${viewport.width}x${viewport.height} map Canvas connectors`, 'map',
      () => assertCanvas(page, '.map-lines', '.map-wrap', '.map-connection', 'map', 'map'));

    try {
      const node = page.locator('.map-node.available').first();
      await node.click();
      await page.locator('.node-preview-dialog[role="dialog"]').waitFor({ state: 'visible' });
      activePhase = 'nodepreview';
      await validatePhase(page, viewport, 'nodepreview', screenshots);
      await page.keyboard.press('Escape');
      await page.locator('.node-preview-dialog').waitFor({ state: 'detached' });
    } catch (error) {
      await check(`${viewport.width}x${viewport.height} node preview and preview transitions`, 'nodepreview',
        async () => { throw error; });
    }

    try {
      await installFixture(page, fixtures.preview);
      activePhase = 'preview';
      await validatePhase(page, viewport, 'preview', screenshots);
    } catch (error) {
      await check(`${viewport.width}x${viewport.height} preview fixture render`, 'preview',
        async () => { throw error; });
    }

    await installFixture(page, fixtures.battle, { pauseBattle: true });
    activePhase = 'battle';
    await validatePhase(page, viewport, 'battle', screenshots);
    try {
      await clickAction(page, 'battle-skip');
      await page.locator('[data-action="battle-finish"], [data-action="continue-battle"]')
        .first().waitFor({ state: 'visible' });
      const runText = await page.evaluate(key => localStorage.getItem(key), saveKey);
      assert.ok(runText, 'battle completion fixture lost its serialized run');
      const outcome = JSON.parse(runText).state.battle?.outcome;
      assert.equal(outcome, 'player', 'reward screen requires a simulated player victory');
      await clickAction(page, 'battle-finish');
      await page.locator('.game-page.phase-reward').waitFor({ state: 'visible' });
      activePhase = 'reward';
      await validatePhase(page, viewport, 'reward', screenshots);
      await check(`${viewport.width}x${viewport.height} reward three-column first screen`, 'reward',
        () => assertRewardFirstScreen(page, 'reward'));
    } catch (error) {
      await check(`${viewport.width}x${viewport.height} battle-to-reward flow`, 'battle',
        async () => { throw error; });
    }

    for (const phase of ['event', 'shop', 'rest', 'talent']) {
      const fixture = fixtures[phase];
      try {
        await installFixture(page, fixture);
        activePhase = phase;
        await validatePhase(page, viewport, phase, screenshots);
        if (phase === 'talent') {
          await check(`${viewport.width}x${viewport.height} selectable talent Canvas connectors`, phase,
            () => assertCanvas(page, '.talent-tree-connectors', '.talent-tree',
              '.talent-tree-connection', phase, 'talent'));
        }
      } catch (error) {
        await check(`${viewport.width}x${viewport.height} ${phase} fixture render`, phase,
          async () => { throw error; });
      }
    }

    try {
      await installFixture(page, fixtures.map);
      await clickAction(page, 'tab', '[data-action="tab"][data-id="build"]');
      await page.locator('.game-layout.view-build').waitFor({ state: 'visible' });
      activePhase = 'build';
      await validatePhase(page, viewport, 'build', screenshots);

      await clickAction(page, 'tab', '[data-action="tab"][data-id="karma"]');
      await page.locator('.karma-page').waitFor({ state: 'visible' });
      activePhase = 'karma';
      await validatePhase(page, viewport, 'karma', screenshots);

      await clickAction(page, 'tab', '[data-action="tab"][data-id="journey"]');
      await page.locator('.game-page.view-journey').waitFor({ state: 'visible' });
      await clickAction(page, 'settings');
      await page.locator('.modal-backdrop [role="dialog"]').waitFor({ state: 'visible' });
      activePhase = 'modal';
      await validatePhase(page, viewport, 'modal', screenshots);
      await page.keyboard.press('Escape');

      await clickAction(page, 'talent-tree');
      await page.locator('.talent-tree-dialog').waitFor({ state: 'visible' });
      await check(`${viewport.width}x${viewport.height} read-only talent Canvas connectors`, 'modal',
        () => assertCanvas(page, '.talent-tree-connectors', '.talent-tree',
          '.talent-tree-connection', 'modal', 'talent'));
      screenshots.push(await saveScreenshot(page, viewport, 'talent-tree-modal'));
      await page.keyboard.press('Escape');
    } catch (error) {
      await check(`${viewport.width}x${viewport.height} build/karma/modal render`, 'modal',
        async () => { throw error; });
    }
  } finally {
    await context.close();
  }
  return {
    viewport,
    screenshots,
    pageErrors: browserErrors.filter(error =>
      error.viewport === `${viewport.width}x${viewport.height}`),
  };
}

async function writeReport(results = []) {
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({
    suite: 'shanhai-casual-ui',
    url,
    reportDir,
    generatedAt: new Date().toISOString(),
    visualReview: 'not performed; screenshots are archived for human review',
    fixtureKind: 'legal seeded ShanhaiGame states rendered for UI acceptance; no claimed end-to-end journey',
    viewports,
    checks,
    issues,
    browserErrors,
    results,
  }, null, 2) + '\n');
}

async function run() {
  const fixtures = {
    map: createPhaseFixture('map', 'casual-ui-map'),
    preview: createPhaseFixture('preview', 'casual-ui-preview'),
    battle: createPhaseFixture('battle', 'casual-ui-battle'),
    event: createPhaseFixture('event', 'casual-ui-event'),
    shop: createPhaseFixture('shop', 'casual-ui-shop'),
    rest: createPhaseFixture('rest', 'casual-ui-rest'),
    talent: createTalentFixture(),
    karma: createKarmaFixture(),
  };
  if (process.env.SHANHAI_CASUAL_FIXTURES_ONLY === '1') {
    console.log(JSON.stringify(Object.fromEntries(
      Object.entries(fixtures).map(([name, fixture]) => [name, {
        phase: fixture.phase,
        outcome: fixture.outcome ?? null,
        fixtureKind: fixture.fixtureKind,
        saveBytes: Buffer.byteLength(fixture.save),
      }]),
    ), null, 2));
    return;
  }
  await mkdir(screenshotDir, { recursive: true });
  const { chromium } = playwrightModule();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  const results = [];
  try {
    for (const viewport of viewports) {
      results.push(await runViewport(browser, viewport, fixtures));
    }
  } finally {
    await browser.close();
    await writeReport(results);
  }
  if (issues.length || browserErrors.length) {
    throw new Error(`Casual UI acceptance found ${issues.length} UI issue(s) and ${browserErrors.length} browser error(s); report: ${path.join(reportDir, 'report.json')}`);
  }
  console.log(`Casual UI report: ${path.join(reportDir, 'report.json')}`);
}

run().catch(async error => {
  await writeReport();
  console.error(error);
  process.exitCode = 1;
});
