#!/usr/bin/env node

/*
 * Focused player-facing UI audit. This intentionally uses the same offline
 * build as browser-node.mjs, but drives independent legal fixtures so a
 * single happy-path run cannot hide regressions in secondary screens.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HTML = path.join(ROOT, 'dist', 'PLAY.html');
const DEFAULT_OUTPUT = '/tmp/fengshen-ui-review/audit';
const DEFAULT_CHROMIUM = '/opt/tools/ms-playwright/chromium-1228/chrome-linux/chrome';
const DEFAULT_PLAYWRIGHT = '/opt/tools/browser-tools/node_modules/playwright';
const SAVE_KEY = 'fengshen-run-v44';
const WIDTHS = [320, 360, 390, 430, 1440];

const HELP = `Usage: node tests/ui-browser-audit.mjs [options]

Options:
  --html PATH       Standalone HTML file (default: dist/PLAY.html)
  --url URL         HTTP URL to validate instead of setContent
  --output PATH     Report and screenshot directory (default: /tmp/fengshen-ui-review/audit)
  --chromium PATH   Chromium executable
  --playwright PATH Playwright package directory or package name
  --help            Show this help

Environment:
  PLAY_HTML_PATH, PLAY_HTML, BROWSER_OUTPUT_DIR, CHROMIUM_PATH,
  PLAYWRIGHT_MODULE
`;

class AuditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditError';
  }
}

function parseArgs(argv) {
  const config = {
    html: process.env.PLAY_HTML_PATH || process.env.PLAY_HTML || DEFAULT_HTML,
    url: '',
    output: process.env.BROWSER_OUTPUT_DIR || DEFAULT_OUTPUT,
    chromium: process.env.CHROMIUM_PATH || DEFAULT_CHROMIUM,
    playwright: process.env.PLAYWRIGHT_MODULE || DEFAULT_PLAYWRIGHT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      config.help = true;
      continue;
    }
    const match = arg.match(/^--(html|url|output|chromium|playwright)(?:=(.*))?$/);
    if (!match) {
      throw new AuditError(`Unknown option: ${arg}\n\n${HELP}`);
    }
    const value = match[2] ?? argv[i + 1];
    if (!value || (match[2] === undefined && value.startsWith('--'))) {
      throw new AuditError(`Missing value for ${arg}\n\n${HELP}`);
    }
    if (match[2] === undefined) {
      i += 1;
    }
    config[match[1]] = value;
  }
  return config;
}

function resolvePath(value) {
  return path.resolve(ROOT, value.startsWith('~/') ? path.join(process.env.HOME || '', value.slice(2)) : value);
}

function isFile(value) {
  try {
    return statSync(value).isFile();
  } catch {
    return false;
  }
}

function moduleEntry(value) {
  if (isFile(value)) {
    return value;
  }
  if (!existsSync(value)) {
    return null;
  }
  const packageJson = path.join(value, 'package.json');
  if (isFile(packageJson)) {
    const metadata = JSON.parse(readFileSync(packageJson, 'utf8'));
    const entry = metadata.module || metadata.main || 'index.mjs';
    if (isFile(path.join(value, entry))) {
      return path.join(value, entry);
    }
  }
  for (const filename of ['index.mjs', 'index.js']) {
    if (isFile(path.join(value, filename))) {
      return path.join(value, filename);
    }
  }
  return null;
}

async function loadPlaywright(value) {
  const specifier = path.isAbsolute(value) || value.startsWith('.') ? pathToFileURL(moduleEntry(resolvePath(value))).href : value;
  const imported = await import(specifier);
  const playwright = imported.chromium ? imported : imported.default ?? imported;
  if (!playwright?.chromium?.launch) {
    throw new AuditError(`Playwright module has no chromium API: ${value}`);
  }
  return playwright;
}

function makeStorageScript() {
  return () => {
    const data = Object.create(null);
    const storage = {
      get length() {
        return Object.keys(data).length;
      },
      key(index) {
        return Object.keys(data)[index] ?? null;
      },
      getItem(key) {
        return data[key] ?? null;
      },
      setItem(key, value) {
        data[key] = String(value);
      },
      removeItem(key) {
        delete data[key];
      },
      clear() {
        for (const key of Object.keys(data)) {
          delete data[key];
        }
      },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  };
}

async function loadFixtures() {
  const output = execFileSync(process.execPath, ['tests/immersion-fixtures.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const fixtures = JSON.parse(output);
  const content = JSON.parse(readFileSync(path.join(ROOT, 'data', 'game.json'), 'utf8'));
  const { Game, fateOptions, simulateBattle } = await import(pathToFileURL(path.join(ROOT, 'build', 'engine.js')).href);
  const enriched = Game.create(
    content,
    'UI-AUDIT-SHIELD',
    'alchemist',
    fateOptions(content, 'UI-AUDIT-SHIELD')[0].id,
    '审查斗者',
  );
  const roles = ['basic', 'rage', 'component', 'component', 'component', 'component', 'relic', 'strategy'];
  const ids = ['basic.spring', 'rage.spring', 'aux.breath', 'art.herbal_basket', 'myth.basin'];
  enriched.s.slots = Array(8).fill(null);
  for (const id of ids) {
    const ability = content.abilities.find((item) => item.id === id);
    const role = ability.equipRole
      ?? (['basic', 'rage', 'strategy', 'relic'].includes(ability.slot)
        ? ability.slot
        : ability.slot === 'artifact' && ability.rarity === 'mythic' ? 'relic' : 'component');
    const slot = roles.findIndex((candidate, index) => candidate === role && !enriched.s.slots[index]);
    enriched.s.slots[slot] = { id, rank: 0 };
  }
  const node = enriched.available()[0];
  enriched.enter(node.id);
  const enemy = structuredClone(content.enemies.find((item) => item.id === enriched.s.battle.enemyId));
  enemy.stats = { ...enemy.stats, hp: 3200, attack: 10, defense: 0, speed: 1, hit: 0, dodge: 0 };
  enriched.s.battle = simulateBattle(content, enriched.s, enemy);
  const firstShieldFrame = enriched.s.battle.frames.findIndex((frame, index) => (
    index > 0 && (frame.p.shield > 0 || frame.e.shield > 0)
  ));
  enriched.s.battle.cursor = Math.min(Math.max(70, firstShieldFrame), enriched.s.battle.frames.length - 1);
  fixtures['battle-effects'] = structuredClone(enriched.s);
  const replacement = Game.create(
    content,
    'UI-AUDIT-REPLACE',
    'wanderer',
    fateOptions(content, 'UI-AUDIT-REPLACE')[0].id,
    '替换审查',
  );
  replacement.s.slots = [
    { id: 'basic.sword', rank: 1 },
    { id: 'rage.thunder', rank: 1 },
    { id: 'aux.qi', rank: 1 },
    { id: 'aux.fire', rank: 0 },
    { id: 'art.jade', rank: 0 },
    { id: 'art.flag', rank: 0 },
    { id: 'myth.ring', rank: 0 },
    { id: 'strategy.rage', rank: 0 },
  ];
  replacement.s.act = 3;
  replacement.s.row = 0;
  replacement.s.phase = 'event';
  replacement.s.eventId = 'major.3';
  replacement.s.eventPhase = 'decision';
  replacement.s.seenEvents['major.3'] = 1;
  replacement.s.current = replacement.s.route.find((node) => node.act === 3 && node.type === 'major');
  replacement.chooseEvent('defy');
  fixtures.replacement = structuredClone(replacement.s);
  const fullSlots = [
    { id: 'basic.sword', rank: 1 },
    { id: 'rage.thunder', rank: 1 },
    { id: 'aux.qi', rank: 1 },
    { id: 'aux.fire', rank: 0 },
    { id: 'art.jade', rank: 0 },
    { id: 'art.flag', rank: 0 },
    { id: 'myth.ring', rank: 0 },
    { id: 'strategy.rage', rank: 0 },
  ];
  const rewardReplacement = Game.create(
    content,
    'UI-AUDIT-REWARD-REPLACE',
    'wanderer',
    fateOptions(content, 'UI-AUDIT-REWARD-REPLACE')[0].id,
    '奖励焦点审查',
  );
  rewardReplacement.s.slots = structuredClone(fullSlots);
  rewardReplacement.s.phase = 'reward';
  rewardReplacement.s.reward = ['basic.thunder', 'basic.fire', 'basic.spring'];
  rewardReplacement.s.rewardInfo = { gold: 25, xp: 20 };
  fixtures['reward-replacement'] = structuredClone(rewardReplacement.s);
  const shopReplacement = Game.create(
    content,
    'UI-AUDIT-SHOP-REPLACE',
    'wanderer',
    fateOptions(content, 'UI-AUDIT-SHOP-REPLACE')[0].id,
    '坊市焦点审查',
  );
  shopReplacement.s.slots = structuredClone(fullSlots);
  shopReplacement.s.phase = 'shop';
  shopReplacement.s.gold = 100;
  shopReplacement.s.stock = [
    { kind: 'ability', id: 'basic.thunder', price: 35, sold: false },
    { kind: 'ability', id: 'basic.fire', price: 35, sold: false },
    { kind: 'ability', id: 'basic.spring', price: 35, sold: false },
  ];
  fixtures['shop-replacement'] = structuredClone(shopReplacement.s);
  const eventGift = Game.create(
    content,
    'UI-AUDIT-EVENT-GIFT',
    'wanderer',
    fateOptions(content, 'UI-AUDIT-EVENT-GIFT')[0].id,
    '赠礼契约审查',
  );
  eventGift.s.slots = structuredClone(fullSlots);
  eventGift.s.act = 3;
  eventGift.s.row = 0;
  eventGift.s.phase = 'event';
  eventGift.s.eventId = 'character.ziya.3';
  eventGift.s.eventPhase = 'root';
  eventGift.s.seenEvents['character.ziya.3'] = 1;
  eventGift.s.facts.met_ziya = true;
  eventGift.s.facts.ziya_promise_fulfilled = true;
  eventGift.s.promises['ziya.reserve_currency'] = {
    definitionId: 'ziya.reserve_currency',
    status: 'fulfilled',
    acceptedAt: { act: 0, row: 0, nodeId: 'legacy' },
    evidenceNodeId: 'legacy',
    finalRewardOffered: false,
    settlementClaimed: true,
  };
  fixtures['event-gift-choice'] = structuredClone(eventGift.s);
  eventGift.chooseEvent('borrow');
  fixtures['event-gift'] = structuredClone(eventGift.s);
  const tracking = structuredClone(fixtures.returning);
  tracking.phase = 'map';
  tracking.current = undefined;
  tracking.pending = undefined;
  tracking.trackedCharacter = undefined;
  fixtures.tracking = tracking;
  return fixtures;
}

async function getFixtures() {
  /*
   * The audit runs after npm run build, so importing the generated engine keeps
   * these legal fixtures independent of source-only test helpers.
   */
  return loadFixtures();
}

function textOf(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function main(config) {
  if (config.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const htmlPath = resolvePath(config.html);
  if (!config.url && !isFile(htmlPath)) {
    throw new AuditError(`HTML build not found: ${htmlPath}. Run npm run build first.`);
  }
  const outputPath = resolvePath(config.output);
  await mkdir(outputPath, { recursive: true });
  const fixtures = await getFixtures();
  const report = {
    passed: false,
    checks: [],
    errors: [],
    consoleErrors: [],
    overflow: [],
    screenshots: [],
    coverage: {
      creation: false,
      map: false,
      build: false,
      battle: false,
      reward: false,
      replacement: false,
      shop: false,
      rest: false,
      events: false,
      characterTracking: false,
      final: false,
    },
    config: {
      html: htmlPath,
      url: config.url || null,
      output: outputPath,
      chromium: config.chromium,
      playwright: config.playwright,
      widths: WIDTHS,
    },
  };
  const playwright = await loadPlaywright(config.playwright);
  if (!isFile(config.chromium)) {
    throw new AuditError(`Chromium executable not found: ${config.chromium}`);
  }
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: config.chromium,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(makeStorageScript());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      report.consoleErrors.push(message.text());
    }
  });

  const check = (id, condition, details = undefined) => {
    const item = { id, passed: Boolean(condition) };
    if (details !== undefined) {
      item.details = details;
    }
    report.checks.push(item);
  };
  const waitForState = async (phase) => {
    await page.waitForFunction((expected) => document.querySelector('fengshen-game')?.game?.s?.phase === expected, phase);
  };
  const state = async () => page.evaluate(() => document.querySelector('fengshen-game')?.game?.s ?? null);
  const screenshot = async (name) => {
    const filename = path.join(outputPath, `${name}.png`);
    await page.screenshot({ path: filename, fullPage: true });
    report.screenshots.push(filename);
  };
  const noOverflow = async (id) => {
    const dimensions = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body?.scrollWidth ?? 0,
    }));
    report.overflow.push({ id, ...dimensions });
    check(id, dimensions.documentWidth <= dimensions.viewportWidth + 1, dimensions);
  };
  const loadPage = async () => {
    if (config.url) {
      await page.goto(config.url, { waitUntil: 'networkidle' });
    } else {
      const html = await readFile(htmlPath, 'utf8');
      await page.setContent(html, { waitUntil: 'load' });
    }
    await page.waitForSelector('fengshen-game');
    await page.waitForSelector('[data-action="race"]');
  };
  const loadFixture = async (name, view = 'journey') => {
    const fixture = fixtures[name];
    if (!fixture) {
      throw new AuditError(`Unknown fixture: ${name}`);
    }
    await page.evaluate(([saved, nextView]) => {
      const root = document.querySelector('fengshen-game');
      root.game = root.game.constructor.load(root.content, JSON.stringify(saved));
      root.home = false;
      root.view = nextView;
      root.modal = '';
      root.restMode = '';
      root.paused = true;
      root.speed = 2;
      root.detailedLog = false;
      root.logFollow = true;
      root.logTop = 0;
      root.render();
    }, [fixture, view]);
    await page.waitForFunction((expected) => document.querySelector('fengshen-game')?.game?.s?.phase === expected, fixture.phase);
  };
  const visible = (selector) => page.locator(`${selector}:visible`);
  const focusAction = async (selector) => {
    await page.locator(selector).focus();
    return page.evaluate(() => ({
      action: document.activeElement?.dataset?.action ?? '',
      tag: document.activeElement?.tagName ?? '',
    }));
  };
  const viewport = async (width, height = 844) => {
    await page.setViewportSize({ width, height });
    await noOverflow(`responsive-${width}`);
  };
  const touchSize = async (id, selector) => {
    const sizes = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, label: element.getAttribute('aria-label') || element.textContent?.trim() };
    }));
    check(id, sizes.length > 0 && sizes.every((item) => item.width >= 44 && item.height >= 44), sizes);
  };

  try {
    await loadPage();
    check('reduced-motion-request-honored', await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
    check('initial-page-no-errors', report.errors.length === 0, report.errors);
    report.coverage.creation = true;

    const creationKinds = [
      ['race', '[data-action="race"]'],
      ['origin', '[data-action="origin"]'],
    ];
    for (const [kind, selector] of creationKinds) {
      const options = page.locator(selector);
      check(`${kind}-choices-visible`, await options.count() > 0);
      for (let i = 0; i < await options.count(); i += 1) {
        const option = options.nth(i);
        const label = textOf(await option.locator('strong').first().innerText());
        await option.click();
        const insight = page.locator(`.creation-${kind}`);
        check(`${kind}-${i + 1}-qualitative-insight`, await insight.count() === 1 && Boolean(textOf(await insight.innerText())), label);
        check(`${kind}-${i + 1}-pressed-state`, await option.getAttribute('aria-pressed') === 'true', label);
      }
    }
    await page.locator('[data-action="fates"]').click();
    const fateOptions = page.locator('[data-action="fate"]');
    check('fate-choices-visible', await fateOptions.count() > 0);
    await fateOptions.first().click();
    check('fate-pressed-state', await fateOptions.first().getAttribute('aria-pressed') === 'true');
    check('start-is-enabled-after-fate', await page.locator('[data-action="start"]').isEnabled());
    await page.locator('[data-action="start"]').click();
    await waitForState('map');

    for (const width of WIDTHS) {
      await viewport(width);
      await loadFixture('map');
      report.coverage.map = true;
      check(`map-${width}-has-scroll-region`, await page.locator('.map-scroll[tabindex="0"][aria-label]').count() === 1);
      check(`map-${width}-has-reachable-node`, await page.locator('.map-node.available:not([disabled])').count() > 0);
      if (width <= 430) {
        await touchSize(`map-${width}-bottom-nav-touch`, '.bottom-nav:visible button');
        const bottom = page.locator('.bottom-nav:visible button');
        check(`map-${width}-bottom-nav-last-reachable`, await bottom.count() >= 3 && await bottom.last().isEnabled());
        await bottom.last().click();
        check(`map-${width}-bottom-nav-navigates`, (await page.locator('.main-stage').innerText()).includes('因缘'));
        await page.locator('.bottom-nav:visible [data-id="journey"]').click();
      }
    }
    await loadFixture('map');
    await page.locator('.map-key summary').click();
    check('map-details-open', await page.locator('details[data-panel="map-key"]').evaluate((node) => node.open));
    const mapNode = page.locator('.map-node.available').first();
    await mapNode.click();
    await waitForState('battle');
    check('map-node-actual-enter-reaches-battle', await page.locator('.battle-shell').count() === 1);

    await loadFixture('map', 'build');
    report.coverage.build = true;
    check('build-view-has-strategy-card', await page.locator('.deck-grid .slot-strategy').count() > 0);
    check('build-view-has-behavior-summary', await page.locator('.ability-behavior').count() > 0);
    const inspect = page.locator('[data-action="inspect"]').first();
    await inspect.click();
    await page.waitForSelector('.modal[role="dialog"]');
    check('ability-modal-has-dialog-semantics', await page.locator('.modal[role="dialog"][aria-modal="true"]').count() === 1);
    await page.keyboard.press('Escape');
    check('ability-modal-escape-closes', await page.locator('.modal').count() === 0);
    check('ability-modal-escape-restores-focus', await page.evaluate(() => document.activeElement?.dataset?.action) === 'inspect');
    await page.locator('.deck-grid details[data-panel="resonances"] summary, details[data-panel="resonances"] summary').first().click().catch(() => {});
    await noOverflow('build-desktop');

    await loadFixture('map');
    const characterButton = visible('[data-action="character"]').first();
    await characterButton.click();
    await page.waitForSelector('.modal[role="dialog"]');
    check('character-modal-shows-all-seven-stats', await page.locator('.character-stats > div').count() === 7);
    await page.locator('details[data-panel="stat-sources"] summary').click();
    check('character-modal-details-open', await page.locator('details[data-panel="stat-sources"]').evaluate((node) => node.open));
    await page.keyboard.press('Escape');
    check('character-modal-escape-restores-focus', await page.evaluate(() => document.activeElement?.dataset?.action) === 'character');

    await loadFixture('battle-effects');
    report.coverage.battle = true;
    check('battle-has-single-player-surface', await page.locator('.mobile-hud,.player-rail').count() === 0);
    check('battle-renders-both-combatants', await page.locator('.combatant.side-p,.combatant.side-e').count() === 2);
    check('battle-renders-fixed-side-identity', await page.locator('.fighter-side-badge').count() === 2
      && (await page.locator('.fighter-side-badge').allInnerTexts()).every((label) => ['我方', '敌方'].includes(textOf(label))));
    check('battle-has-health-and-rage-labels', await page.locator('.fighter-bars').allInnerTexts().then((texts) => texts.every((value) => value.includes('生命') && value.includes('怒气'))));
    check('battle-shield-has-player-facing-label', await page.locator('.shield-count').count() === 0
      || await page.locator('.shield-count').allInnerTexts().then((texts) => texts.every((value) => value.includes('护盾')))
      || await page.locator('.shield-count[aria-label*="护盾"]').count() > 0);
    check('battle-simple-log-has-non-damage-feedback', await page.locator('.battle-log .simple-status-list, .battle-log .simple-heal, .battle-log .simple-shield').count() > 0);
    check('battle-log-is-scrollable', await page.locator('.battle-log').evaluate((node) => node.scrollHeight > node.clientHeight));
    check('battle-pause-is-accessible', await page.locator('[data-action="pause"]').getAttribute('aria-label'));
    check('battle-speed-is-grouped', await page.locator('.speeds[role="group"][aria-label]').count() === 1);
    check('battle-speed-has-three-pressed-controls', await page.locator('.speeds [data-action="speed"][aria-pressed]').count() === 3);
    await touchSize('battle-main-controls-touch', '.battle-controls .speeds button, .battle-controls > .button');
    const initialBattle = await state();
    const initialCursor = initialBattle.battle.cursor;
    await page.locator('[data-action="pause"]').click();
    check('battle-continue-starts-playback', (await state()).battle.cursor === initialCursor && (await page.evaluate(() => document.querySelector('fengshen-game')?.paused)) === false);
    await page.waitForFunction((cursor) => document.querySelector('fengshen-game')?.game?.s?.battle?.cursor > cursor, initialCursor);
    await page.locator('[data-action="pause"]').click();
    check('battle-pause-stops-playback', await page.evaluate(() => document.querySelector('fengshen-game')?.paused) === true);
    await page.locator('[data-action="speed"][data-index="4"]').click();
    check('battle-fourfold-speed-selected', await page.locator('[data-action="speed"][data-index="4"]').getAttribute('aria-pressed') === 'true');
    check('battle-skip-names-settlement', (await page.locator('[data-action="skip"]').innerText()).includes('结算'));

    const log = page.locator('.battle-log');
    await log.evaluate((node) => {
      node.scrollTop = Math.min(16, node.scrollHeight);
      node.dispatchEvent(new Event('scroll'));
    });
    const oldLogTop = await log.evaluate((node) => node.scrollTop);
    await page.locator('[data-action="speed"][data-index="1"]').click();
    check('battle-log-scroll-position-preserved', Math.abs((await log.evaluate((node) => node.scrollTop)) - oldLogTop) < 4);
    check('battle-follow-latest-appears-after-reading-history', await visible('[data-action="followLog"]').count() === 1);
    await page.locator('[data-action="followLog"]').click();
    check('battle-follow-latest-returns-to-bottom', await log.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop < 4));

    const beforeSkip = await state();
    await page.locator('[data-action="skip"]').click();
    await page.waitForSelector('.battle-settlement');
    const afterSkip = await state();
    check('battle-skip-reaches-settlement', await page.locator('.battle-settlement').count() === 1 && afterSkip.battle.cursor === afterSkip.battle.frames.length - 1);
    check('battle-skip-keeps-deterministic-outcome', afterSkip.battle.won === beforeSkip.battle.won && JSON.stringify(afterSkip.battle.summary) === JSON.stringify(beforeSkip.battle.summary));
    check('battle-settlement-has-all-source-rows', await page.locator('.battle-settlement .battle-contributions .contribution-row').count() > 0
      && textOf(await page.locator('.battle-settlement .battle-contributions strong').first().innerText()) === '全部来源');
    check('battle-settlement-has-summary', await page.locator('.battle-summary').count() === 1);
    await screenshot('battle-effects-390');

    await loadFixture('battle-effects');
    await page.locator('.battle-log').focus();
    const pausedBeforeSpace = await page.evaluate(() => document.querySelector('fengshen-game')?.paused);
    await page.keyboard.press('Space');
    check('battle-space-toggles-only-when-log-focused', await page.evaluate(() => document.querySelector('fengshen-game')?.paused) !== pausedBeforeSpace);
    await page.keyboard.press('Space');
    check('battle-space-toggles-back', await page.evaluate(() => document.querySelector('fengshen-game')?.paused) === pausedBeforeSpace);
    await visible('[data-action="settings"]').click();
    await page.waitForSelector('.modal');
    const modalFocusables = page.locator('.modal button:not([disabled]), .modal summary, .modal input:not([hidden])');
    check('settings-modal-opens-with-focus', await modalFocusables.count() > 0 && await page.evaluate(() => !!document.activeElement?.closest('.modal')));
    await modalFocusables.last().focus();
    await page.keyboard.press('Tab');
    check('settings-modal-traps-forward-tab', await page.evaluate(() => !!document.activeElement?.closest('.modal')));
    await page.keyboard.press('Escape');
    check('settings-modal-escape-closes', await page.locator('.modal').count() === 0);
    check('settings-modal-escape-restores-focus', await page.evaluate(() => document.activeElement?.dataset?.action) === 'settings');
    await visible('[data-action="settings"]').click();
    await page.locator('[data-action="detailedLog"]').click();
    check('detailed-log-persists-setting', await page.evaluate(() => localStorage.getItem('fengshen-detailed-log') === 'true'));
    await page.keyboard.press('Escape');
    await loadFixture('battle-effects');
    await page.evaluate(() => {
      const root = document.querySelector('fengshen-game');
      root.detailedLog = true;
      root.render();
    });
    check('detailed-log-has-formula', await page.locator('.combat-formula').count() > 0);
    check('detailed-log-identifies-both-sides', await page.locator('.battle-log .log-side.player, .battle-log .log-side.enemy').count() > 0);
    for (const width of WIDTHS) {
      await viewport(width);
      check(`battle-${width}-combatant-labels-fit`, await page.locator('.fighter-numbers').evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth + 1)));
    }

    await loadFixture('reward');
    report.coverage.reward = true;
    check('reward-page-has-choices', await page.locator('.reward-cards .ability-card').count() >= 3);
    check('reward-page-has-skip-control', await page.locator('[data-action="skipReward"]').count() === 1);
    await page.locator('.reward-cards [data-action="inspect"]').first().click();
    await page.keyboard.press('Escape');
    check('reward-inspect-escape-returns', await page.locator('.modal').count() === 0);
    await page.locator('[data-action="skipReward"]').click();
    await waitForState('map');

    await loadFixture('reward-replacement');
    const rewardReplacementBefore = await state();
    const secondReward = page.locator('.reward-cards [data-action="reward"][data-index="1"]');
    await secondReward.focus();
    await secondReward.click();
    await page.waitForSelector('.replacement-modal');
    check('reward-replacement-opens-for-second-candidate', (await state()).pending?.source === 'reward');
    await page.locator('.replacement-modal [data-action="cancelReplacement"]').first().click();
    const rewardReplacementAfter = await state();
    check('reward-replacement-cancel-restores-second-focus', await page.evaluate(() => ({
      action: document.activeElement?.dataset?.action,
      index: document.activeElement?.dataset?.index,
    })).then((focus) => focus.action === 'reward' && focus.index === '1'));
    check('reward-replacement-cancel-is-lossless', rewardReplacementAfter.pending === undefined
      && rewardReplacementAfter.gold === rewardReplacementBefore.gold
      && JSON.stringify(rewardReplacementAfter.slots) === JSON.stringify(rewardReplacementBefore.slots)
      && JSON.stringify(rewardReplacementAfter.reward) === JSON.stringify(rewardReplacementBefore.reward));

    await loadFixture('shop-replacement');
    const shopReplacementBefore = await state();
    const secondShop = page.locator('.shop-grid [data-action="buy"][data-index="1"]');
    await secondShop.focus();
    await secondShop.click();
    await page.waitForSelector('.replacement-modal');
    check('shop-replacement-opens-for-second-candidate', (await state()).pending?.source === 'shop');
    await page.locator('.replacement-modal [data-action="cancelReplacement"]').first().click();
    const shopReplacementAfter = await state();
    check('shop-replacement-cancel-restores-second-focus', await page.evaluate(() => ({
      action: document.activeElement?.dataset?.action,
      index: document.activeElement?.dataset?.index,
    })).then((focus) => focus.action === 'buy' && focus.index === '1'));
    check('shop-replacement-cancel-is-lossless', shopReplacementAfter.pending === undefined
      && shopReplacementAfter.gold === shopReplacementBefore.gold
      && JSON.stringify(shopReplacementAfter.slots) === JSON.stringify(shopReplacementBefore.slots)
      && JSON.stringify(shopReplacementAfter.stock) === JSON.stringify(shopReplacementBefore.stock));

    await loadFixture('event-gift-choice');
    await page.locator('[data-action="event"][data-id="borrow"]').click();
    await page.waitForSelector('.replacement-modal');
    report.coverage.replacement = true;
    check('event-gift-replacement-has-candidates', await page.locator('.replacement-candidates [data-action="replace"]').count() >= 1);
    check('event-gift-replacement-says-abandon', (await page.locator('.replacement-modal').innerText()).includes('放弃此赠礼'));
    const eventGiftBefore = await state();
    await page.keyboard.press('Escape');
    check('event-gift-escape-opens-confirmation', await page.locator('.modal:not(.replacement-modal)').count() === 1
      && (await page.locator('.modal:not(.replacement-modal)').innerText()).includes('放弃此赠礼'));
    check('event-gift-confirmation-defaults-to-keep', await page.evaluate(() => document.activeElement?.dataset?.action) === 'keepPendingGift');
    await page.keyboard.press('Escape');
    const eventGiftAfterKeep = await state();
    check('event-gift-second-escape-keeps-pending', await page.locator('.replacement-modal').count() === 1
      && eventGiftAfterKeep.pending?.source === 'event'
      && eventGiftAfterKeep.promises?.['ziya.reserve_currency']?.finalRewardOffered === true);
    check('event-gift-second-escape-preserves-committed-branch', JSON.stringify({
      hp: eventGiftAfterKeep.hp,
      gold: eventGiftAfterKeep.gold,
      xp: eventGiftAfterKeep.xp,
      facts: eventGiftAfterKeep.facts,
      threads: eventGiftAfterKeep.threads,
      storyLog: eventGiftAfterKeep.storyLog,
      actionLog: eventGiftAfterKeep.actionLog,
    }) === JSON.stringify({
      hp: eventGiftBefore.hp,
      gold: eventGiftBefore.gold,
      xp: eventGiftBefore.xp,
      facts: eventGiftBefore.facts,
      threads: eventGiftBefore.threads,
      storyLog: eventGiftBefore.storyLog,
      actionLog: eventGiftBefore.actionLog,
    }));
    await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } });
    check('event-gift-background-opens-confirmation', await page.locator('.modal:not(.replacement-modal)').count() === 1);
    await page.locator('[data-action="confirmPendingAbandon"]').click();
    await page.waitForSelector('.replacement-modal', { state: 'detached' });
    const eventGiftAfterAbandon = await state();
    check('event-gift-confirmed-abandon-clears-only-pending', eventGiftAfterAbandon.pending === undefined
      && eventGiftAfterAbandon.phase === 'event_result'
      && eventGiftAfterAbandon.promises?.['ziya.reserve_currency']?.finalRewardOffered === true);
    check('event-gift-confirmed-abandon-preserves-story-and-resources', JSON.stringify({
      hp: eventGiftAfterAbandon.hp,
      gold: eventGiftAfterAbandon.gold,
      xp: eventGiftAfterAbandon.xp,
      facts: eventGiftAfterAbandon.facts,
      threads: eventGiftAfterAbandon.threads,
      storyLog: eventGiftAfterAbandon.storyLog,
    }) === JSON.stringify({
      hp: eventGiftBefore.hp,
      gold: eventGiftBefore.gold,
      xp: eventGiftBefore.xp,
      facts: eventGiftBefore.facts,
      threads: eventGiftBefore.threads,
      storyLog: eventGiftBefore.storyLog,
    }));
    check('event-gift-save-preserves-abandoned-branch', await page.evaluate(() => {
      const root = document.querySelector('fengshen-game');
      const saved = JSON.parse(localStorage.getItem('fengshen-run-v44'));
      return saved?.pending === undefined
        && saved?.promises?.['ziya.reserve_currency']?.finalRewardOffered === true
        && saved?.storyLog?.length === root?.game?.s?.storyLog?.length;
    }));
    await page.evaluate(() => {
      const root = document.querySelector('fengshen-game');
      root.game.s.phase = 'event';
      root.game.s.eventPhase = 'root';
      root.render();
    });
    check('event-gift-cannot-reselect-after-abandon', await page.locator('[data-action="event"][data-id="borrow"]').isDisabled());

    await loadFixture('shop');
    report.coverage.shop = true;
    check('shop-page-has-stock-and-balance', await page.locator('.shop-grid .ability-card').count() >= 3 && await page.locator('.shop-balance').count() === 1);
    check('shop-leave-is-actual-action', await page.locator('[data-action="leaveShop"]').isEnabled());
    await page.locator('[data-action="leaveShop"]').click();
    await waitForState('map');

    await loadFixture('rest');
    report.coverage.rest = true;
    check('rest-page-has-rest-options', await page.locator('.rest-option').count() >= 3);
    const temper = page.locator('[data-action="restMode"][data-id="temper"]');
    if (await temper.isEnabled()) {
      await temper.click();
      check('rest-subchoice-has-stat-actions', await page.locator('.subchoices [data-action="rest"]').count() > 0);
      await page.locator('.subchoices [data-action="rest"]').first().click();
      await waitForState('map');
    } else {
      await page.locator('[data-action="rest"]').first().click();
      await waitForState('map');
    }

    await loadFixture('cost');
    report.coverage.events = true;
    check('locked-event-choice-explains-requirement', await page.locator('[data-action="event"][disabled] .lock-reason').count() >= 1);
    await loadFixture('returning');
    check('returning-event-shows-earned-branch', await page.locator('[data-action="event"][data-id="back"]').isEnabled());
    await page.locator('[data-action="event"][data-id="back"]').click();
    check('event-choice-produces-result-view', await page.locator('.event-result').count() === 1);
    await page.locator('[data-action="leaveEvent"]').click();
    await waitForState('map');

    await loadFixture('tracking', 'karma');
    report.coverage.characterTracking = true;
    check('karma-page-lists-known-character', await page.locator('.character-relation').count() >= 1);
    const track = page.locator('[data-action="trackCharacter"]').first();
    if (await track.count()) {
      await track.click();
      check('character-track-action-updates-state', Boolean((await state()).trackedCharacter));
      check('tracked-character-renders-clue', await page.locator('.character-clue').count() >= 1);
      const clear = page.locator('[data-action="trackCharacter"][data-track="clear"], [data-action="clearCharacterFollow"]').first();
      await clear.click();
      check('character-track-clear-action-updates-state', !(await state()).trackedCharacter);
    } else {
      check('character-track-action-present', false);
    }

    await loadFixture('final');
    report.coverage.final = true;
    check('final-page-renders-ending-and-stats', await page.locator('.final-page').count() === 1 && await page.locator('.final-stats > div').count() === 3);
    check('final-page-preserves-life-echoes', await page.locator('details[data-panel="life-echoes"]').count() === 1);
    await page.locator('details[data-panel="life-echoes"] summary').click();
    check('final-life-echoes-details-open', await page.locator('details[data-panel="life-echoes"]').evaluate((node) => node.open));

    for (const width of WIDTHS) {
      await viewport(width);
      for (const name of ['map', 'battle-effects', 'reward', 'shop', 'rest', 'returning', 'final']) {
        await loadFixture(name, name === 'returning' ? 'karma' : 'journey');
        check(`responsive-${width}-${name}-renders`, await page.locator('.main-stage').count() === 1 && Boolean(textOf(await page.locator('.main-stage').innerText())));
      }
    }

    check('no-page-errors', report.errors.length === 0, report.errors);
    check('no-console-errors', report.consoleErrors.length === 0, report.consoleErrors);
    report.passed = report.checks.every((item) => item.passed) && report.overflow.every((item) => item.documentWidth <= item.viewportWidth + 1);
  } catch (error) {
    report.passed = false;
    report.failure = error.message;
    try {
      const filename = path.join(outputPath, 'failure.png');
      await page.screenshot({ path: filename, fullPage: true });
      report.screenshots.push(filename);
    } catch {
      // Keep the assertion failure when a screenshot is unavailable.
    }
  } finally {
    await browser.close();
    report.config.checkCount = report.checks.length;
    report.config.failedChecks = report.checks.filter((item) => !item.passed).map((item) => item.id);
    report.config.coverage = report.coverage;
    await writeFile(path.join(outputPath, 'ui-browser-audit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      passed: report.passed,
      checks: report.checks.length,
      failed: report.checks.filter((item) => !item.passed).length,
      errors: report.errors.length,
      consoleErrors: report.consoleErrors.length,
      screenshots: report.screenshots.length,
    })}\n`);
  }
  return report.passed ? 0 : 1;
}

let exitCode = 0;
try {
  exitCode = await main(parseArgs(process.argv.slice(2)));
} catch (error) {
  exitCode = 3;
  process.stderr.write(`[ui-browser-audit] FAIL: ${error.message}\n`);
}
process.exitCode = exitCode;
