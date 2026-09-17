#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXIT = Object.freeze({ PASS: 0, CHECK: 1, USAGE: 2, ENVIRONMENT: 3 });
const SAVE_KEY = 'fengshen-run-v44';
const HELP = `Usage: node tests/browser-node.mjs [options]

Options:
  --html PATH       Standalone HTML file (default: dist/PLAY.html)
  --output PATH     Report and screenshot directory
  --chromium PATH   Chromium executable (default: CHROMIUM_PATH or discovery)
  --playwright PATH Playwright package name or module path
  --help            Show this help

Environment:
  PLAYWRIGHT_MODULE  Playwright package name or module path
  CHROMIUM_PATH      Chromium executable path
  PLAY_HTML_PATH     HTML path (PLAY_HTML is also accepted)
  BROWSER_OUTPUT_DIR Report and screenshot directory
`;

class HarnessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}

class CheckError extends HarnessError {
  constructor(id, details = '') {
    super(EXIT.CHECK, details ? `${id}: ${details}` : id);
    this.name = 'CheckError';
    this.id = id;
  }
}

function parseArgs(argv) {
  const config = {
    html: process.env.PLAY_HTML_PATH || process.env.PLAY_HTML || path.join(ROOT, 'dist', 'PLAY.html'),
    output: process.env.BROWSER_OUTPUT_DIR || path.join(ROOT, 'verification', 'browser-node'),
    chromium: process.env.CHROMIUM_PATH || '',
    playwright: process.env.PLAYWRIGHT_MODULE || '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      config.help = true;
      continue;
    }
    const match = argument.match(/^--(html|play-html|output|chromium|playwright)(?:=(.*))?$/);
    if (!match) {
      throw new HarnessError(EXIT.USAGE, `Unknown option: ${argument}\n\n${HELP}`);
    }
    const key = match[1] === 'play-html' ? 'html' : match[1];
    const value = match[2] ?? argv[index + 1];
    if (!value || (match[2] === undefined && value.startsWith('--'))) {
      throw new HarnessError(EXIT.USAGE, `Missing value for ${argument}\n\n${HELP}`);
    }
    if (match[2] === undefined) {
      index += 1;
    }
    config[key] = value;
  }
  return config;
}

function resolvePath(value) {
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  return path.resolve(ROOT, expanded);
}

function isFile(value) {
  try {
    return statSync(value).isFile();
  } catch {
    return false;
  }
}

function isDirectory(value) {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function addUnique(list, value, source) {
  if (!value || list.some((item) => item.value === value)) {
    return;
  }
  list.push({ value, source });
}

function entryPointForPackage(packagePath) {
  if (isFile(packagePath)) {
    return packagePath;
  }
  if (!isDirectory(packagePath)) {
    return null;
  }
  for (const filename of ['index.mjs', 'index.js']) {
    const candidate = path.join(packagePath, filename);
    if (isFile(candidate)) {
      return candidate;
    }
  }
  const packageJson = path.join(packagePath, 'package.json');
  if (isFile(packageJson)) {
    try {
      const metadata = JSON.parse(readFileSync(packageJson, 'utf8'));
      if (metadata.main && isFile(path.join(packagePath, metadata.main))) {
        return path.join(packagePath, metadata.main);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function knownPlaywrightCandidates() {
  const candidates = [];
  const require = createRequire(import.meta.url);
  for (const packageName of ['playwright', 'playwright-core']) {
    try {
      const resolved = require.resolve(packageName);
      addUnique(candidates, path.dirname(path.dirname(resolved)), 'node resolution');
    } catch {
      // The package can still be available in a cache outside Node's resolver.
    }
  }
  for (const nodePath of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
    addUnique(candidates, path.join(nodePath, 'playwright'), 'NODE_PATH');
    addUnique(candidates, path.join(nodePath, 'playwright-core'), 'NODE_PATH');
  }
  for (const packagePath of [
    path.join(ROOT, 'node_modules', 'playwright'),
    path.join(ROOT, 'node_modules', 'playwright-core'),
    '/opt/tools/browser-tools/node_modules/playwright',
    '/opt/tools/browser-tools/node_modules/playwright-core',
  ]) {
    addUnique(candidates, packagePath, 'known module path');
  }
  const cacheRoots = [
    process.env.npm_config_cache,
    path.join(os.homedir(), '.npm'),
    '/home/ubuntu/.npm',
    '/root/.npm',
  ].filter(Boolean);
  for (const cacheRoot of cacheRoots) {
    const npxRoot = path.join(cacheRoot, '_npx');
    if (!isDirectory(npxRoot)) {
      continue;
    }
    for (const entry of readdirSync(npxRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      addUnique(candidates, path.join(npxRoot, entry.name, 'node_modules', 'playwright'), 'npm cache');
      addUnique(candidates, path.join(npxRoot, entry.name, 'node_modules', 'playwright-core'), 'npm cache');
    }
  }
  return candidates;
}

async function loadPlaywright(config) {
  const attempts = [];
  const candidates = [];
  if (config.playwright) {
    const raw = config.playwright;
    if (raw.startsWith('file:')) {
      addUnique(candidates, raw, 'PLAYWRIGHT_MODULE');
    } else if (path.isAbsolute(raw) || raw.startsWith('.') || raw.startsWith('~') || existsSync(raw)) {
      addUnique(candidates, resolvePath(raw), 'PLAYWRIGHT_MODULE');
    } else {
      addUnique(candidates, raw, 'PLAYWRIGHT_MODULE');
    }
  }
  for (const candidate of knownPlaywrightCandidates()) {
    addUnique(candidates, candidate.value, candidate.source);
  }
  for (const candidate of candidates) {
    let specifier = candidate.value;
    if (!specifier.startsWith('file:') && (specifier.startsWith('/') || isDirectory(specifier) || isFile(specifier))) {
      const entry = entryPointForPackage(specifier);
      if (!entry) {
        attempts.push(`${candidate.source}: ${specifier} has no module entrypoint`);
        continue;
      }
      specifier = pathToFileURL(entry).href;
    }
    try {
      const imported = await import(specifier);
      const playwright = imported.chromium ? imported : imported.default ?? imported;
      if (playwright?.chromium?.launch) {
        return { playwright, source: candidate.source, specifier };
      }
      attempts.push(`${candidate.source}: ${specifier} has no chromium API`);
    } catch (error) {
      attempts.push(`${candidate.source}: ${specifier} (${error.message})`);
    }
  }
  throw new HarnessError(
    EXIT.ENVIRONMENT,
    `Playwright was not found. Set PLAYWRIGHT_MODULE to a Playwright package path or install it with npm.\nTried: ${attempts.join('; ') || 'no candidates'}`,
  );
}

function which(command) {
  const pathValue = process.env.PATH || '';
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    if (isFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function cachedChromiumCandidates() {
  const candidates = [];
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/tools/ms-playwright',
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    '/home/ubuntu/.cache/ms-playwright',
    '/root/.cache/ms-playwright',
  ].filter((value) => value && value !== '0');
  for (const root of roots) {
    if (!isDirectory(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('chromium-')) {
        continue;
      }
      addUnique(candidates, path.join(root, entry.name, 'chrome-linux', 'chrome'), 'browser cache');
      addUnique(candidates, path.join(root, entry.name, 'chrome-linux', 'headless_shell'), 'browser cache');
    }
  }
  return candidates;
}

function resolveChromium(config, playwright) {
  if (config.chromium) {
    const explicit = path.isAbsolute(config.chromium) || config.chromium.startsWith('.') || config.chromium.startsWith('~')
      ? resolvePath(config.chromium)
      : which(config.chromium);
    if (!explicit || !isFile(explicit)) {
      throw new HarnessError(EXIT.ENVIRONMENT, `Chromium was not found at CHROMIUM_PATH/--chromium: ${config.chromium}`);
    }
    return { path: explicit, source: 'CHROMIUM_PATH/--chromium' };
  }
  try {
    const managed = playwright.chromium.executablePath();
    if (managed && isFile(managed)) {
      return { path: managed, source: 'Playwright executablePath' };
    }
  } catch {
    // Fall through to the known cache and PATH locations.
  }
  for (const candidate of cachedChromiumCandidates()) {
    if (isFile(candidate.value)) {
      return { path: candidate.value, source: candidate.source };
    }
  }
  for (const command of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const executable = which(command);
    if (executable) {
      return { path: executable, source: 'PATH' };
    }
  }
  throw new HarnessError(
    EXIT.ENVIRONMENT,
    'Chromium was not found. Set CHROMIUM_PATH to an executable or install a Playwright Chromium browser.',
  );
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
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

async function main(config) {
  if (config.help) {
    process.stdout.write(HELP);
    return EXIT.PASS;
  }
  const htmlPath = resolvePath(config.html);
  const outputPath = resolvePath(config.output);
  const report = {
    passed: false,
    checks: [],
    errors: [],
    overflow: [],
    screenshots: [],
    config: {
      html: htmlPath,
      output: outputPath,
      chromium: config.chromium || 'discovery',
      playwright: config.playwright || 'discovery',
    },
  };
  let browser;
  let page;
  try {
    await mkdir(outputPath, { recursive: true });
    if (!isFile(htmlPath)) {
      throw new HarnessError(EXIT.ENVIRONMENT, `HTML build not found: ${htmlPath}. Run npm run build first.`);
    }
    const html = await readFile(htmlPath, 'utf8');
    const { playwright, source: playwrightSource } = await loadPlaywright(config);
    const chromium = resolveChromium(config, playwright);
    report.config.playwrightResolvedFrom = playwrightSource;
    report.config.chromiumResolvedFrom = chromium.source;
    report.config.chromium = chromium.path;
    try {
      browser = await playwright.chromium.launch({
        headless: true,
        executablePath: chromium.path,
        args: process.platform === 'win32' ? [] : ['--no-sandbox'],
      });
    } catch (error) {
      throw new HarnessError(EXIT.ENVIRONMENT, `Chromium failed to launch at ${chromium.path}: ${error.message}`);
    }
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
    });
    await context.addInitScript(makeStorageScript());
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForSelector('fengshen-game');
    await page.waitForSelector('[data-action="race"]');

    const check = (id, condition, details = undefined) => {
      const item = { id, passed: Boolean(condition) };
      if (details !== undefined) {
        item.details = details;
      }
      report.checks.push(item);
      if (!condition) {
        throw new CheckError(id, details ? JSON.stringify(details) : '');
      }
    };
    const visible = (selector) => page.locator(`${selector}:visible`);
    const clickTab = async (id) => {
      const selector = `[data-action="tab"][data-id="${id}"]`;
      const desktop = page.locator(`.desktop-nav ${selector}:visible`);
      const bottom = page.locator(`.bottom-nav ${selector}:visible`);
      if (await desktop.count()) {
        await desktop.first().click();
        return;
      }
      if (await bottom.count()) {
        await bottom.first().click();
        return;
      }
      throw new CheckError(`tab-${id}-visible`);
    };
    const state = async () => page.evaluate(() => {
      const root = document.querySelector('fengshen-game');
      return root?.game?.s ?? null;
    });
    const noOverflow = async (id) => {
      const dimensions = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body?.scrollWidth ?? 0,
      }));
      report.overflow.push({ id, ...dimensions });
      check(id, dimensions.documentWidth <= dimensions.viewportWidth + 1, dimensions);
    };
    const screenshot = async (name) => {
      const filename = path.join(outputPath, `${name}.png`);
      await page.screenshot({ path: filename, fullPage: true });
      report.screenshots.push(filename);
    };
    const checkCreationInsight = async (kind, selector) => {
      const options = page.locator(selector);
      const count = await options.count();
      check(`${kind}-options-present`, count > 0, { count });
      for (let index = 0; index < count; index += 1) {
        const option = options.nth(index);
        const name = (await option.locator('strong').first().innerText()).trim();
        await option.click();
        const insight = page.locator(`.creation-${kind}`);
        const insightCount = await insight.count();
        check(`${kind}-${index + 1}-insight-present`, insightCount === 1, { name, insightCount });
        const paragraphs = insightCount ? (await insight.first().locator('p, small').allInnerTexts()).map((text) => text.trim()).filter(Boolean) : [];
        check(`${kind}-${index + 1}-insight-qualitative`, paragraphs.length > 0, { name, paragraphs });
        const heading = insightCount ? (await insight.first().locator('h3').innerText()).trim() : '';
        check(`${kind}-${index + 1}-insight-selection`, heading === name, { name, heading });
      }
    };

    await checkCreationInsight('race', '[data-action="race"]');
    await checkCreationInsight('origin', '[data-action="origin"]');
    await page.locator('[data-action="race"]').first().click();
    await page.locator('[data-action="origin"]').first().click();
    await page.locator('[data-action="fates"]').click();
    await checkCreationInsight('fate', '[data-action="fate"]');
    await page.locator('[data-action="fate"]').first().click();
    check('fate-start-enabled', await page.locator('[data-action="start"]').isEnabled());
    await page.locator('[data-action="start"]').click();
    await page.waitForSelector('.map-node.available');
    await page.waitForFunction(() => document.querySelector('fengshen-game')?.game?.s?.phase === 'map');
    await noOverflow('desktop-map-no-overflow');
    await screenshot('desktop-map');

    await clickTab('build');
    const strategy = page.locator('.deck-grid .ability-card.slot-strategy');
    const strategyCount = await strategy.count();
    check('strategy-card-present', strategyCount > 0, { strategyCount });
    if (strategyCount > 0) {
      const behavior = (await strategy.first().locator('.ability-behavior').innerText()).trim();
      const ariaLabel = await strategy.first().locator('.ability-sections').getAttribute('aria-label');
      check('strategy-behavior-summary', Boolean(behavior), { behavior });
      check('strategy-behavior-label', Boolean(ariaLabel?.startsWith('\u884c\u4e3a\uff1a')), { ariaLabel });
    }
    await noOverflow('desktop-build-no-overflow');
    await screenshot('desktop-build');

    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow('mobile-build-no-overflow');
    await clickTab('journey');
    await page.waitForSelector('.map-node.available');
    await noOverflow('mobile-map-no-overflow');
    await screenshot('mobile-map');

    await page.locator('.map-node.available').first().click();
    await page.waitForSelector('.battle-shell');
    await page.locator('[data-action="pause"]').click();
    const runningState = await state();
    check('first-node-is-battle', runningState?.phase === 'battle', { phase: runningState?.phase });
    check(
      'settlement-hidden-before-final-frame',
      await page.locator('.battle-settlement').count() === 0 &&
        await page.locator('.battle-summary').count() === 0 &&
        await page.locator('[data-action="finishBattle"]').count() === 0,
    );
    await noOverflow('mobile-battle-running-no-overflow');
    await screenshot('mobile-battle-running');

    await page.locator('[data-action="skip"]').click();
    await page.waitForSelector('.battle-settlement');
    const settledState = await state();
    check('settlement-appears-at-final-frame', await page.locator('.battle-settlement').count() === 1, {
      phase: settledState?.phase,
      cursor: settledState?.battle?.cursor,
      frames: settledState?.battle?.frames?.length,
    });
    check('settlement-has-final-summary', await page.locator('.battle-summary').count() === 1);
    check('settlement-has-three-sections', await page.locator('.battle-settlement article').count() >= 3);
    check('finish-control-appears-after-settlement', await page.locator('[data-action="finishBattle"]').count() === 1);
    await noOverflow('mobile-battle-settlement-no-overflow');
    await screenshot('mobile-battle-settlement');

    await page.locator('[data-action="finishBattle"]').click();
    await page.waitForFunction(() => document.querySelector('fengshen-game')?.game?.s?.phase !== 'battle');
    const beforeExport = await page.evaluate((key) => window.localStorage.getItem(key), SAVE_KEY);
    check('save-present-before-export', Boolean(beforeExport));
    await visible('[data-action="settings"]').first().click();
    await page.waitForSelector('.modal');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.modal [data-action="export"]').click();
    const download = await downloadPromise;
    const downloadFailure = await download.failure();
    check('save-export-downloads', !downloadFailure, { failure: downloadFailure });
    const downloadPath = await download.path();
    check('save-export-has-json-file', Boolean(downloadPath) && download.suggestedFilename().endsWith('.json'), {
      filename: download.suggestedFilename(),
      path: downloadPath,
    });
    if (downloadPath) {
      const exported = JSON.parse(await readFile(downloadPath, 'utf8'));
      check(
        'save-export-matches-local-save',
        JSON.stringify(canonical(exported)) === JSON.stringify(canonical(JSON.parse(beforeExport))),
      );
    }

    const importedName = 'NODE-HARNESS-IMPORT';
    const importedSave = JSON.parse(beforeExport);
    importedSave.name = importedName;
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('.modal [data-action="import"]').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'node-harness-save.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(importedSave)),
    });
    await page.waitForFunction((name) => document.querySelector('fengshen-game')?.game?.s?.name === name, importedName);
    const importedLocalSave = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)), SAVE_KEY);
    check('save-import-updates-game', importedLocalSave?.name === importedName, { name: importedLocalSave?.name });
    check('save-import-closes-dialog', await page.locator('.modal').count() === 0);
    await noOverflow('mobile-after-import-no-overflow');
    check('no-page-errors', report.errors.length === 0, { errors: report.errors });
    report.passed = true;
    return EXIT.PASS;
  } catch (error) {
    report.passed = false;
    report.failure = { code: error.code ?? EXIT.CHECK, message: error.message };
    if (page) {
      try {
        await page.screenshot({ path: path.join(outputPath, 'failure.png'), fullPage: true });
        report.screenshots.push(path.join(outputPath, 'failure.png'));
      } catch {
        // Preserve the original failure when a browser screenshot is unavailable.
      }
    }
    const code = error.code ?? EXIT.CHECK;
    process.stderr.write(`[browser-node] FAIL (${code}): ${error.message}\n`);
    return code;
  } finally {
    if (browser) {
      await browser.close();
    }
    report.exitCode = report.passed ? EXIT.PASS : (report.failure?.code ?? EXIT.CHECK);
    await writeFile(path.join(outputPath, 'browser-node.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      passed: report.passed,
      exitCode: report.exitCode,
      checks: report.checks.length,
      errors: report.errors.length,
      screenshots: report.screenshots.length,
    })}\n`);
  }
}

let exitCode = EXIT.PASS;
try {
  const config = parseArgs(process.argv.slice(2));
  exitCode = await main(config);
} catch (error) {
  exitCode = error.code ?? EXIT.CHECK;
  process.stderr.write(`[browser-node] FAIL (${exitCode}): ${error.message}\n`);
}
process.exitCode = exitCode;
