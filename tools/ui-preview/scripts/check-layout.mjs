import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from './serve.mjs';

function playwrightModule() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    '/opt/tools/browser-tools/node_modules/playwright',
    '/product/wxq/node_modules/playwright',
    '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
    '/home/ubuntu/.npm/_npx/c61c9351a0dbcfa7/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Continue through the preinstalled browser harness locations.
    }
  }
  throw new Error('Playwright is not installed in the configured local caches');
}

const { chromium } = playwrightModule();
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captureRoot = path.join(moduleRoot, 'captures', 'layout');
const fixtureManifest = {
  schemaVersion: 1,
  approval: { status: 'approved', reviewedBy: 'user' },
  assets: [
    { id: 'battle-scene', src: '/assets/scene-battle.png', kind: 'scene', screen: 'battle', required: true },
    { id: 'start-scene', src: '/assets/scene-start.png', kind: 'scene', screen: 'start', required: true },
    { id: 'map-scene', src: '/assets/scene-map.png', kind: 'scene', screen: 'map', required: true },
    { id: 'player', src: '/assets/player.png', kind: 'character', screen: 'battle', required: true },
    { id: 'enemy', src: '/assets/enemy.png', kind: 'character', screen: 'battle', required: true },
    { id: 'artifact-rr09', src: '/assets/artifact-rr09.png', kind: 'artifact', target: 'artifact-rr09', contentId: 'RR09', required: true },
    { id: 'artifact-rr11', src: '/assets/artifact-rr11.png', kind: 'artifact', target: 'artifact-rr11', contentId: 'RR11', required: true },
    { id: 'artifact-rr15', src: '/assets/artifact-rr15.png', kind: 'artifact', target: 'artifact-rr15', contentId: 'RR15', required: true },
    { id: 'ui-panel', src: '/assets/ui-panel.png', kind: 'module', required: true },
    { id: 'ui-button-primary', src: '/assets/ui-button-primary.png', kind: 'module', required: true },
    { id: 'ui-button-secondary', src: '/assets/ui-button-secondary.png', kind: 'module', required: true },
    { id: 'ui-meter', src: '/assets/ui-meter.png', kind: 'module', required: true },
    { id: 'player-attack', src: '/assets/player-attack.png', kind: 'pose', required: true },
    { id: 'player-rage', src: '/assets/player-rage.png', kind: 'pose', required: true },
    { id: 'enemy-attack', src: '/assets/enemy-attack.png', kind: 'pose', required: true },
  ],
};
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1s8AAAAASUVORK5CYII=',
  'base64',
);
const server = createPreviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome',
  headless: true,
});

async function mockAssets(page, { missing = '', delayMs = 0 } = {}) {
  await page.route('**/assets/**', async route => {
    if (missing && route.request().url().endsWith(missing)) {
      return route.fulfill({ status: 404, body: '' });
    }
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    return route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
  });
  await page.route('**/assets/manifest.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fixtureManifest),
  }));
}

async function readyPage(viewport, url = `${origin}/`) {
  const page = await browser.newPage({ viewport });
  await mockAssets(page);
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.assetsReady === 'true',
  );
  return page;
}

async function rect(node) {
  return node.evaluate(element => {
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  });
}

async function assertPageFits(page, width, height, label) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
  }));
  assert.ok(dimensions.documentWidth <= width + 1, `${label}: document horizontal overflow`);
  assert.ok(dimensions.documentHeight <= height + 1, `${label}: document vertical overflow`);
  assert.ok(dimensions.bodyWidth <= width + 1, `${label}: body horizontal overflow`);
  assert.ok(dimensions.bodyHeight <= height + 1, `${label}: body vertical overflow`);
}

async function assertVisibleControlsFit(screen, screenRect, label) {
  const controls = await screen.locator('button, input').evaluateAll(nodes => nodes
    .filter(node => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    })
    .map(node => {
      const bounds = node.getBoundingClientRect();
      return {
        label: node.getAttribute('aria-label') || node.textContent.trim() || node.name,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        right: bounds.right,
        bottom: bounds.bottom,
      };
    }));
  assert.ok(controls.length > 0, `${label}: no visible controls`);
  assert.deepEqual(
    controls.filter(control =>
      control.width < 44 || control.height < 44 ||
      control.x < screenRect.x - 1 || control.right > screenRect.right + 1 ||
      control.y < screenRect.y - 1 || control.bottom > screenRect.bottom + 1),
    [],
    `${label}: controls must remain at least 44px and inside the game canvas`,
  );
}

async function assertSurfaceRendering(screen, label) {
  const audit = await screen.evaluate(node => {
    const alpha = color => {
      const slash = color.match(/\/\s*([\d.]+)\s*\)/);
      if (slash) return Number(slash[1]);
      const comma = color.match(/,\s*([\d.]+)\s*\)$/);
      return comma ? Number(comma[1]) : 1;
    };
    const channels = color => color.startsWith('#')
      ? [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16))
      : (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = color => {
      const [red, green, blue] = channels(color).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const contrast = (foreground, background) => {
      const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    };
    const surfaceColor = element => {
      if (element.matches('.primary-action:not(:disabled)')) {
        return getComputedStyle(document.documentElement).getPropertyValue('--coral').trim();
      }
      for (let current = element; current; current = current.parentElement) {
        const color = getComputedStyle(current).backgroundColor;
        if (alpha(color) >= 0.98) return color;
      }
      throw new Error('Text has no known opaque backing surface');
    };
    const surfaces = {
      start: ['.start-heading', '.start-controls', '.method-options button', '.primary-action'],
      map: ['.map-status', '.map-title', '.map-node', '.node-label'],
      battle: ['.unit-status', '.battle-controls button'],
      choice: ['.choice-heading', '.artifact-select', '.artifact-details', '.choice-confirm'],
    }[node.dataset.screen];
    const surfaceMetrics = surfaces.map(selector => {
      const surface = node.querySelector(selector);
      const style = getComputedStyle(surface);
      return {
        selector,
        background: style.backgroundColor,
        alpha: alpha(surfaceColor(surface)),
        texture: style.backgroundImage,
      };
    });
    const pairs = [];
    const addPair = (text, surface, label = text?.id || text?.className || 'text node') => {
      if (!text || !surface) throw new Error(`Missing required ${label} contrast pair`);
      pairs.push({
        label: text.textContent.trim() || text.getAttribute('aria-label') || text.tagName,
        ratio: contrast(getComputedStyle(text).color, surfaceColor(surface)),
      });
    };
    if (node.dataset.screen === 'start') {
      for (const text of node.querySelectorAll('.start-heading h2, .start-profile, .quiet-button')) {
        addPair(text, text.closest('.start-heading'));
      }
      addPair(node.querySelector('.method-field legend'), node.querySelector('.start-controls'));
      addPair(node.querySelector('#method-cue'), node.querySelector('.start-controls'), '#method-cue');
      for (const button of node.querySelectorAll('.method-options button')) addPair(button, button);
      addPair(node.querySelector('.start-action'), node.querySelector('.start-action'));
    } else if (node.dataset.screen === 'map') {
      for (const text of node.querySelectorAll('.map-status b, .map-profile span')) {
        addPair(text, node.querySelector('.map-status'));
      }
      addPair(node.querySelector('.map-title'), node.querySelector('.map-title'));
      for (const text of node.querySelectorAll('.node-label, .future-node, .current-node')) {
        addPair(text, text);
      }
    } else if (node.dataset.screen === 'battle') {
      for (const unit of node.querySelectorAll('.unit-status')) {
        for (const text of unit.querySelectorAll('.unit-name, .unit-method, .unit-meter-labels span, .unit-meter-labels b, .rage-labels span, .rage-labels b')) {
          addPair(text, unit);
        }
      }
      for (const button of node.querySelectorAll('.battle-controls button')) addPair(button, button);
    } else {
      addPair(node.querySelector('.choice-heading h2'), node.querySelector('.choice-heading'));
      for (const option of node.querySelectorAll('.artifact-select')) {
        for (const text of option.querySelectorAll('.artifact-name, .artifact-stat span, .artifact-stat b, .artifact-cue')) {
          addPair(text, option);
        }
      }
      for (const button of node.querySelectorAll('.artifact-details, .choice-confirm')) addPair(button, button);
    }
    const assetRendering = [...node.querySelectorAll('img[data-asset-target]')].map(image => ({
      rendering: getComputedStyle(image).imageRendering,
      filter: getComputedStyle(image).filter,
    }));
    const contentFilters = [...node.querySelectorAll('img[data-asset-target]:not(.world-image)')]
      .map(image => getComputedStyle(image).filter);
    return {
      assetRendering,
      contentFilters,
      surfaceMetrics,
      contrastPairs: pairs,
    };
  });

  assert.ok(audit.surfaceMetrics.every(surface =>
    surface.alpha >= 0.98 && surface.texture === 'none'),
  `${label}: text must have a plain opaque backing surface`);
  assert.ok(audit.assetRendering.length > 0 &&
    audit.assetRendering.every(image => image.rendering === 'auto' && image.filter === 'none'),
  `${label}: artwork retains smooth ink rendering and its source colors`);
  assert.ok(audit.contentFilters.every(filter => filter === 'none'),
    `${label}: character and artifact art keeps full color`);
  assert.ok(audit.contrastPairs.length > 0 &&
    audit.contrastPairs.every(pair => pair.ratio >= 4.5),
  `${label}: rendered text contrast ${JSON.stringify(audit.contrastPairs)}`);
}

async function checkOverview(viewport, explicit = false) {
  const page = await readyPage(
    viewport,
    explicit ? `${origin}/?screen=overview` : origin,
  );
  assert.equal(new URL(page.url()).searchParams.get('screen'), 'overview');
  assert.equal(await page.locator('.view-switcher a').count(), 6);

  const toolbarBounds = await rect(page.locator('.preview-toolbar'));
  assert.deepEqual(
    { x: toolbarBounds.x, y: toolbarBounds.y, width: toolbarBounds.width, height: toolbarBounds.height },
    { x: 0, y: 0, width: viewport.width, height: 100 },
    'overview toolbar must remain fully visible in the first viewport',
  );
  const navRects = await page.locator('.view-switcher a').evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
  }));
  assert.ok(navRects.every(item =>
    item.width >= 44 && item.height >= 44 &&
    item.x >= -1 && item.right <= viewport.width + 1 &&
    item.y >= toolbarBounds.y - 1 && item.bottom <= toolbarBounds.bottom + 1));

  const tiles = page.locator('.overview-tile');
  assert.equal(await tiles.count(), 4);
  const galleryBounds = await rect(page.locator('.overview-gallery'));
  const columns = await page.locator('.overview-gallery').evaluate(node =>
    getComputedStyle(node).gridTemplateColumns.split(' ').length,
  );
  const tileResults = await tiles.evaluateAll(nodes => {
    const results = [];
    for (const node of nodes) {
      const link = node.querySelector('.overview-link');
      const mount = node.querySelector('.overview-screen-mount');
      const screen = mount.querySelector('.game-screen');
      const tileBounds = node.getBoundingClientRect();
      const linkBounds = link.getBoundingClientRect();
      const mountBounds = mount.getBoundingClientRect();
      const screenBounds = screen.getBoundingClientRect();
      results.push({
        href: new URL(link.href).searchParams.get('screen'),
        label: link.getAttribute('aria-label'),
        title: link.textContent.trim(),
        tile: {
          x: tileBounds.x, y: tileBounds.y, right: tileBounds.right, bottom: tileBounds.bottom,
          width: tileBounds.width, height: tileBounds.height,
        },
        link: {
          x: linkBounds.x, y: linkBounds.y, right: linkBounds.right, bottom: linkBounds.bottom,
          width: linkBounds.width, height: linkBounds.height,
        },
        mount: {
          x: mountBounds.x, y: mountBounds.y, right: mountBounds.right, bottom: mountBounds.bottom,
          width: mountBounds.width, height: mountBounds.height,
        },
        screen: {
          name: screen.dataset.screen,
          x: screenBounds.x, y: screenBounds.y, right: screenBounds.right, bottom: screenBounds.bottom,
          width: screenBounds.width, height: screenBounds.height,
          baseWidth: screen.offsetWidth,
          baseHeight: screen.offsetHeight,
          scale: Number.parseFloat(getComputedStyle(mount).getPropertyValue('--overview-scale')),
          display: getComputedStyle(screen).display,
          pointerEvents: getComputedStyle(screen).pointerEvents,
          inert: screen.inert,
          ariaHidden: screen.getAttribute('aria-hidden'),
        },
      });
    }
    return results;
  });
  assert.deepEqual(tileResults.map(item => item.href), ['start', 'map', 'battle', 'choice']);
  assert.deepEqual(tileResults.map(item => item.screen.name), ['start', 'map', 'battle', 'choice']);
  assert.ok(tileResults.every(item =>
    item.label && item.title &&
    item.tile.width >= 44 && item.tile.height >= 88 &&
    item.tile.x >= -1 && item.tile.right <= viewport.width + 1 &&
    item.tile.y >= toolbarBounds.bottom - 1 && item.tile.bottom <= viewport.height + 1 &&
    item.link.width >= 44 && item.link.height >= 44 &&
    item.link.x >= -1 && item.link.right <= viewport.width + 1 &&
    item.link.y >= toolbarBounds.bottom - 1 && item.link.bottom <= viewport.height + 1 &&
    item.mount.width > 0 && item.mount.height > 0 &&
    item.screen.baseWidth === 390 && item.screen.baseHeight === 760 &&
    item.screen.scale > 0 && item.screen.scale <= 1 &&
    Math.abs(item.screen.width - 390 * item.screen.scale) < 1 &&
    Math.abs(item.screen.height - 760 * item.screen.scale) < 1 &&
    item.screen.x >= item.mount.x - 1 && item.screen.right <= item.mount.right + 1 &&
    item.screen.y >= item.mount.y - 1 && item.screen.bottom <= item.mount.bottom + 1 &&
    item.screen.display !== 'none' && item.screen.pointerEvents === 'none' &&
    item.screen.inert && item.screen.ariaHidden === 'true'),
  JSON.stringify({ viewport, tileResults }));

  assert.equal(await page.locator('.overview-tile img[src^="/previews/"]').count(), 0,
    'overview thumbnails must not use exported preview PNGs');
  assert.equal(await page.locator('iframe, frame').count(), 0,
    'overview uses the original screen DOM, not embedded pages');
  const previewRequests = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .map(entry => new URL(entry.name).pathname)
      .filter(pathname => pathname.startsWith('/previews/')),
  );
  assert.deepEqual(previewRequests, [], 'overview must not request exported preview PNGs');

  if (viewport.width <= 767) {
    assert.equal(columns, 2, 'mobile overview uses two columns');
    assert.ok(galleryBounds.height > 0 && galleryBounds.bottom <= viewport.height + 1);
    assert.ok(Math.abs(tileResults[0].tile.x - tileResults[2].tile.x) <= 1);
    assert.ok(Math.abs(tileResults[1].tile.x - tileResults[3].tile.x) <= 1);
    assert.ok(tileResults[1].tile.x > tileResults[0].tile.x);
    assert.ok(Math.abs(tileResults[0].tile.y - tileResults[1].tile.y) <= 1);
    assert.ok(Math.abs(tileResults[2].tile.y - tileResults[3].tile.y) <= 1);
    assert.ok(tileResults[2].tile.y > tileResults[0].tile.y);
  } else if (viewport.width >= 768) {
    assert.equal(columns, 4, 'desktop overview keeps four columns');
    assert.ok(tileResults.every(item =>
      Math.abs(item.tile.y - tileResults[0].tile.y) <= 1));
    assert.ok(tileResults.every((item, index) =>
      index === 0 || item.tile.x > tileResults[index - 1].tile.x));
  }

  console.log(
    `Overview ${viewport.width}x${viewport.height}: gallery ` +
    `${galleryBounds.width.toFixed(1)}x${galleryBounds.height.toFixed(1)}, ` +
    `screen ${tileResults[0].screen.width.toFixed(1)}x${tileResults[0].screen.height.toFixed(1)}`,
  );
  await assertPageFits(page, viewport.width, viewport.height, `overview ${viewport.width}`);

  const filename = path.join(captureRoot, `overview-${viewport.width}x${viewport.height}.png`);
  await mkdir(captureRoot, { recursive: true });
  await page.screenshot({ path: filename });

  const methodBounds = await page.locator('.overview-screen-mount[data-overview-slot="start"] [data-method="RKF02"]')
    .evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
  await page.mouse.click(methodBounds.x, methodBounds.y);
  assert.equal(await page.locator('#preview-app').getAttribute('data-view'), 'overview',
    'overview game controls must not navigate');
  assert.equal(
    await page.locator('[data-method][aria-pressed="true"]').getAttribute('data-method'),
    'RKF01',
    'overview game controls must not execute',
  );

  await page.locator('.overview-link[data-view-link="map"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'map',
  );
  assert.equal(await page.locator('.screen-deck > .game-screen').count(), 4);
  assert.equal(await page.locator('.overview-screen-mount > .game-screen').count(), 0);
  await page.goBack();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'overview',
  );
  assert.equal(await page.locator('.overview-screen-mount > .game-screen').count(), 4);
  assert.equal(await page.locator('.screen-deck > .game-screen').count(), 0);
  await page.goForward();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'map',
  );
  assert.equal(await page.locator('.screen-deck > [data-screen="map"]').count(), 1);
  assert.equal(new URL(page.url()).searchParams.get('screen'), 'map');
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'map',
  );
  await page.close();
  console.log(`Overview layout and route history OK ${viewport.width}x${viewport.height}`);
}

async function checkSingleScreens(viewport) {
  const page = await readyPage(viewport);
  for (const name of ['start', 'map', 'battle', 'choice']) {
    await page.goto(`${origin}/?screen=${name}`);
    await page.waitForFunction(expected =>
      document.querySelector('#preview-app')?.dataset.view === expected &&
      document.querySelector('#preview-app')?.dataset.assetsReady === 'true',
    name);
    const screen = page.locator(`[data-screen="${name}"]`);
    const bounds = await rect(screen);
    const expectedWidth = viewport.width < 390 ? viewport.width : 390;
    const expectedHeight = Math.min(760, viewport.height - 100);
    assert.equal(bounds.width, expectedWidth, `${name}: regular canvas width`);
    assert.equal(bounds.height, expectedHeight, `${name}: regular canvas uses remaining viewport height`);
    assert.ok(bounds.y >= 99 && bounds.bottom <= viewport.height + 1, `${name}: canvas below toolbar`);
    await assertVisibleControlsFit(screen, bounds, `${name} ${viewport.width}`);
    await assertSurfaceRendering(screen, `${name} ${viewport.width}`);
    if (name === 'map') {
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas.route-lines');
        if (!canvas?.width || !canvas.height) return false;
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.some((value, index) => index % 4 === 3 && value > 0);
      });
    }

    const overflow = await screen.evaluate(node => ({
      width: node.scrollWidth,
      clientWidth: node.clientWidth,
      height: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
    assert.equal(overflow.width, overflow.clientWidth, `${name}: canvas horizontal overflow`);
    assert.equal(overflow.height, overflow.clientHeight, `${name}: canvas vertical overflow`);

    const filename = path.join(captureRoot, `${name}-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: filename });
  }
  await page.close();
  console.log(`Single-screen mobile/desktop canvases OK ${viewport.width}x${viewport.height}`);
}

async function checkCaptureMode(viewport) {
  const page = await readyPage(
    viewport,
    `${origin}/?screen=start&capture=1`,
  );
  for (const name of ['start', 'map', 'battle', 'choice']) {
    await page.goto(`${origin}/?screen=${name}&capture=1`);
    await page.waitForFunction(() =>
      document.querySelector('#preview-app')?.dataset.assetsReady === 'true' &&
      document.querySelector('#preview-app')?.dataset.capture === 'true',
    );
    const result = await page.evaluate(screenName => {
      const toolbar = document.querySelector('.preview-toolbar');
      const screen = document.querySelector(`[data-screen="${screenName}"]`);
      const bounds = screen.getBoundingClientRect();
      return {
        toolbar: getComputedStyle(toolbar).display,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        decoded: [...document.querySelectorAll('img[data-asset-target]')]
          .every(image => !image.hidden && image.complete && image.naturalWidth > 0),
      };
    }, name);
    assert.equal(result.toolbar, 'none', `${name}: capture hides external controls`);
    assert.deepEqual(
      { x: result.x, y: result.y, width: result.width, height: result.height },
      { x: 0, y: 0, width: viewport.width, height: viewport.height },
      `${name}: capture fills viewport`,
    );
    assert.equal(result.decoded, true);
    await assertPageFits(page, viewport.width, viewport.height, `${name} capture`);
  }
  await page.close();
  console.log(`Capture canvas dimensions OK ${viewport.width}x${viewport.height}`);
}

async function checkCompare() {
  const page = await readyPage({ width: 1440, height: 900 }, `${origin}/?screen=compare`);
  assert.equal(await page.locator('.game-screen:visible').count(), 4);
  const samples = await page.locator('.game-screen:visible').evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x, right: bounds.right, width: bounds.width, height: bounds.height };
  }));
  assert.deepEqual(samples.map(({ width, height }) => [width, height]), [
    [320, 760], [320, 760], [320, 760], [320, 760],
  ]);
  assert.ok(samples[0].x >= 0 && samples.at(-1).right <= 1440);
  await assertPageFits(page, 1440, 900, 'desktop comparison');
  await page.close();
  console.log('Four-screen desktop comparison fits 1440x900');
}

async function checkFlow() {
  const errors = [];
  const page = await readyPage({ width: 390, height: 844 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__gameStorageWrites = 0;
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.__gameStorageWrites += 1;
        return original.apply(this, args);
      };
    }
  });
  await page.goto(`${origin}/?screen=start`);
  await page.waitForFunction(() => document.querySelector('#preview-app')?.dataset.assetsReady === 'true');

  assert.equal(await page.locator('[data-method][aria-pressed="true"]').getAttribute('data-method'), 'RKF01');
  assert.equal(await page.locator('#method-cue').textContent(), '普攻、怒技后获得护盾。');
  await page.getByRole('button', { name: '行旅设置' }).click();
  await page.locator('#detail-dialog[open]').waitFor();
  await page.getByLabel('道号').fill('云中客');
  await page.getByLabel('命数（种子）').fill('自定义种子');
  await page.getByRole('button', { name: '保存' }).click();
  await page.locator('#detail-dialog[open]').waitFor({ state: 'hidden' });

  const methodCues = [
    ['RKF01', '普攻、怒技后获得护盾。'],
    ['RKF02', '怒技后按实际怒耗返气。'],
    ['RKF03', '以最大气血提高治疗。'],
    ['RKF04', '攻击施加持续燃烧。'],
    ['RKF05', '普攻积累剑势。'],
  ];
  for (const [id, cue] of methodCues) {
    await page.locator(`[data-method="${id}"]`).click();
    assert.equal(await page.locator('#method-cue').textContent(), cue);
  }
  await page.locator('.start-action').click();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'map',
  );
  assert.equal(new URL(page.url()).searchParams.get('screen'), 'map');
  assert.equal(await page.locator('[data-map-name]').textContent(), '云中客');
  assert.equal(await page.locator('[data-map-method]').textContent(), '养剑诀');
  assert.equal(await page.locator('[data-map-node]').count(), 2);
  assert.equal(await page.locator('[data-map-node][aria-pressed="true"]').count(), 0);

  await page.locator('[data-map-node="coast"]').click();
  await page.locator('#detail-dialog[open]').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('node'), 'coast');
  assert.equal(await page.locator('#dialog-title').textContent(), '养锋石卫');
  assert.match(await page.locator('#dialog-copy').textContent(), /潮路转弯处立着一尊磨损的石卫/);
  assert.deepEqual(await page.locator('.dialog-stats').innerText(), '地点\n古道\n功法\n养剑诀');
  assert.doesNotMatch(await page.locator('#dialog-copy').textContent(), /普通战|静态界面|示例数值/);

  await page.getByRole('button', { name: '暂不前往' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'map' &&
    !document.querySelector('#detail-dialog').open,
  );
  assert.equal(new URL(page.url()).searchParams.has('node'), false);

  await page.locator('[data-map-node="stone"]').click();
  await page.locator('#detail-dialog[open]').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('node'), 'stone');
  await page.getByRole('button', { name: '确认前往' }).click();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'battle',
  );
  assert.equal(new URL(page.url()).searchParams.get('screen'), 'battle');
  assert.equal(await page.locator('.unit-status').count(), 2);
  const combat = await page.locator('.unit-status').evaluateAll(nodes => nodes.map(unit => ({
    name: unit.querySelector('.unit-name').textContent,
    method: unit.querySelector('.unit-method').textContent,
    meterCount: unit.querySelectorAll('.meter').length,
    segments: unit.querySelectorAll('.combined-meter .meter-segment').length,
    hpMax: unit.querySelector('.combined-meter').getAttribute('aria-valuemax'),
    hpNow: unit.querySelector('.combined-meter').getAttribute('aria-valuenow'),
  })));
  assert.deepEqual(combat, [
    { name: '云中客', method: '养剑诀', meterCount: 2, segments: 2, hpMax: '1100', hpNow: '820' },
    { name: '养锋石卫', method: '养剑诀', meterCount: 2, segments: 2, hpMax: '500', hpNow: '394' },
  ]);
  const meterFractions = await page.locator('.combined-meter').evaluateAll(meters =>
    meters.map(meter => [...meter.querySelectorAll('.meter-segment')]
      .map(segment => segment.getBoundingClientRect().width / meter.clientWidth)),
  );
  const expectedFractions = [[640 / 1100, 180 / 1100], [344 / 500, 50 / 500]];
  for (const [unitIndex, fractions] of meterFractions.entries()) {
    fractions.forEach((value, segmentIndex) => {
      assert.ok(Math.abs(value - expectedFractions[unitIndex][segmentIndex]) < 0.01);
    });
  }

  await page.locator('[data-battle-control="speed"]').click();
  assert.equal(await page.locator('#preview-app').getAttribute('data-preview-speed'), 'fast');
  assert.equal(await page.locator('[data-battle-control="speed"]').textContent(), '2×');
  await page.locator('[data-battle-control="pause"]').click();
  assert.equal(await page.locator('#preview-app').getAttribute('data-preview-paused'), 'true');
  assert.equal(
    await page.locator('.battle-actors img').first().evaluate(node => getComputedStyle(node).animationPlayState),
    'paused',
  );
  await page.locator('[data-open-dialog="battle"]').click();
  await page.locator('#detail-dialog[open]').waitFor();
  assert.equal(await page.locator('#dialog-copy').isVisible(), false);
  assert.match(await page.locator('#dialog-stats').innerText(), /云中客 · 养剑诀[\s\S]*养锋石卫 · 养剑诀/);
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.locator('#detail-dialog[open]').waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.locator('.battle-actors img').first().evaluate(node => getComputedStyle(node).animationName),
    'none',
  );

  await page.locator('[data-battle-control="skip"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'choice',
  );
  assert.equal(await page.locator('.artifact-option').count(), 3);
  assert.equal(await page.locator('.artifact-select[aria-pressed="true"]').count(), 0);
  assert.equal(await page.locator('.choice-confirm').isDisabled(), true);
  const expectedArtifactText = [
    /震岳鼓[\s\S]*防御[\s\S]*\+8[\s\S]*盾返回怒/,
    /余烬盏[\s\S]*气血上限[\s\S]*\+30[\s\S]*毒燃回怒/,
    /定心佩[\s\S]*气血上限[\s\S]*\+30[\s\S]*削怒减半/,
  ];
  const options = page.locator('.artifact-option');
  const choiceText = (await options.allTextContents()).map(value => value.replace(/\s+/g, ' '));
  assert.ok(expectedArtifactText.every((pattern, index) => pattern.test(choiceText[index])));
  const artifactTitles = ['震岳鼓', '余烬盏', '定心佩'];
  for (const [index, id] of ['artifact-rr09', 'artifact-rr11', 'artifact-rr15'].entries()) {
    const details = page.locator(`[data-artifact-detail="${id}"]`);
    const before = await page.locator('.artifact-select[aria-pressed="true"]').count();
    await details.click();
    await page.locator('#detail-dialog[open]').waitFor();
    assert.equal(await page.locator('#dialog-title').textContent(), artifactTitles[index]);
    await page.getByRole('button', { name: '关闭详情' }).click();
    await page.locator('#detail-dialog[open]').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.artifact-select[aria-pressed="true"]').count(), before);
  }

  await page.locator('[data-artifact-choice="artifact-rr11"]').click();
  assert.equal(
    await page.locator('[data-artifact-choice="artifact-rr11"]').getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('[data-artifact-detail="artifact-rr15"]').click();
  await page.locator('#detail-dialog[open]').waitFor();
  assert.match(await page.locator('#dialog-copy').textContent(), /最高降低100%/);
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.locator('#detail-dialog[open]').waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('[data-artifact-choice="artifact-rr11"]').getAttribute('aria-pressed'),
    'true',
    'opening another item detail must not change the selection',
  );
  await page.locator('.choice-confirm').click();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'map',
  );
  assert.equal(new URL(page.url()).searchParams.get('screen'), 'map');
  assert.equal(await page.locator('#map-inventory').textContent(), '随身 · 余烬盏');
  assert.equal(await page.locator('#map-feedback').textContent(), '收下了余烬盏');
  const mapInfoBounds = await page.locator('#map-inventory, #map-feedback, .map-title').evaluateAll(nodes =>
    nodes.map(node => {
      const bounds = node.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    }),
  );
  for (let index = 0; index < mapInfoBounds.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < mapInfoBounds.length; otherIndex += 1) {
      const [first, second] = [mapInfoBounds[index], mapInfoBounds[otherIndex]];
      const overlapsX = first.left < second.right && second.left < first.right;
      const overlapsY = first.top < second.bottom && second.top < first.bottom;
      assert.equal(overlapsX && overlapsY, false, 'map collection feedback must not overlap inventory or heading');
    }
  }

  await page.goBack();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'choice',
  );
  assert.equal(await page.locator('[data-artifact-choice="artifact-rr11"]').getAttribute('aria-pressed'), 'true');
  await page.goForward();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'map',
  );
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.view === 'map',
  );
  assert.equal(await page.locator('#map-inventory').isVisible(), false, 'sample inventory is not persisted');
  assert.equal(await page.evaluate(() => window.__gameStorageWrites), 0);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.deepEqual(errors, []);
  await page.close();
  console.log('Start → map preview → battle → choice → map flow and history OK');
}

async function checkMissingAssetBlocksReady() {
  for (const missing of ['scene-map.png', 'ui-panel.png', 'player-attack.png']) {
    const page = await browser.newPage({ viewport: { width: 320, height: 760 } });
    await mockAssets(page, { missing });
    await page.goto(`${origin}/?screen=map`);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#preview-app').getAttribute('data-assets-ready'), 'false');
    assert.equal(await page.locator('#capture-preview').isDisabled(), true);
    assert.equal(await page.locator('#asset-status').textContent(), '待装入正式素材');
    await page.close();
  }
  console.log('Missing required scene, module or pose keeps capture disabled');
}

try {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 320, height: 760 },
    { width: 320, height: 1000 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await checkOverview(viewport);
  }
  await checkOverview({ width: 390, height: 844 }, true);
  await checkSingleScreens({ width: 320, height: 568 });
  await checkSingleScreens({ width: 320, height: 760 });
  await checkSingleScreens({ width: 390, height: 844 });
  await checkSingleScreens({ width: 1440, height: 900 });
  await checkCaptureMode({ width: 320, height: 760 });
  await checkCaptureMode({ width: 390, height: 844 });
  await checkCompare();
  await checkFlow();
  await checkMissingAssetBlocksReady();
} finally {
  await browser.close();
  server.close();
  await once(server, 'close');
}
