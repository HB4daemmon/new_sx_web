import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from './serve.mjs';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = path.join(moduleRoot, 'public', 'assets');
const captureRoot = path.join(moduleRoot, 'captures', 'real-art');
const overviewCaptureRoot = path.join(moduleRoot, 'captures', 'style-overview');
const manifest = JSON.parse(await readFile(path.join(assetRoot, 'manifest.json'), 'utf8'));
const expectedAssets = [
  ['battle-scene', '/assets/scene-battle.webp', 'scene'],
  ['start-scene', '/assets/scene-start.webp', 'scene'],
  ['player', '/assets/player.png', 'character'],
  ['enemy', '/assets/enemy.png', 'character'],
  ['artifact-rr09', '/assets/artifact-rr09.png', 'artifact'],
  ['artifact-rr11', '/assets/artifact-rr11.png', 'artifact'],
  ['artifact-rr15', '/assets/artifact-rr15.png', 'artifact'],
];

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

assert.equal(manifest.schemaVersion, 1);
assert.deepEqual(manifest.approval, { status: 'pending', reviewedBy: null });
assert.equal(manifest.provenance.model, 'gpt-image-2.5');
assert.equal(manifest.provenance.generationInterface, 'bundled CLI');
assert.deepEqual(
  manifest.assets.map(asset => [asset.id, asset.src, asset.kind]),
  expectedAssets,
);

const assetFiles = await readdir(assetRoot);
assert.equal(assetFiles.some(filename => filename.endsWith('.svg')), false);
for (const [id, src, kind] of expectedAssets) {
  const asset = manifest.assets.find(item => item.id === id);
  const filename = src.slice('/assets/'.length);
  const file = path.join(assetRoot, filename);
  const info = await stat(file);
  assert.ok(info.isFile() && info.size > 1024, `${id}: exported asset is missing or too small`);
  assert.match(asset.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.processed.bytes, info.size, `${id}: manifest byte count`);
  assert.ok(asset.processed.dimensions.every(dimension => Number.isInteger(dimension) && dimension > 64));
  if (kind === 'scene') {
    assert.equal(asset.processed.format, 'webp');
    assert.ok(asset.processed.dimensions[0] <= 814, `${id}: scene width exceeds 814px`);
  } else if (kind === 'character') {
    assert.equal(asset.processed.format, 'png');
    assert.ok(Math.max(...asset.processed.dimensions) <= 768, `${id}: sprite exceeds 768px`);
    assert.equal(asset.processed.alphaExtrema[0], 0, `${id}: transparent margin was lost`);
  } else {
    assert.equal(asset.processed.format, 'png');
    assert.ok(Math.max(...asset.processed.dimensions) <= 512, `${id}: artifact exceeds 512px`);
    assert.equal(asset.processed.alphaExtrema[0], 0, `${id}: transparent margin was lost`);
  }
}

await mkdir(captureRoot, { recursive: true });
const { chromium } = playwrightModule();
const server = createPreviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
const browserErrors = [];

function instrument(page, label) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const location = message.location()?.url || '';
    const detail = `${label} console: ${message.text()}${location ? ` (${location})` : ''}`;
    browserErrors.push(detail);
  });
  page.on('pageerror', error => browserErrors.push(`${label} pageerror: ${error.message}`));
  page.on('requestfailed', request =>
    browserErrors.push(`${label} request failed: ${request.url()} (${request.failure()?.errorText})`));
  page.on('response', response => {
    if (response.status() >= 400) {
      browserErrors.push(`${label} response ${response.status()}: ${response.url()}`);
    }
  });
  return page.addInitScript(() => {
    window.__previewCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.__previewCspViolations.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
      });
    });
  });
}

async function readyPage(viewport, label, url = `${origin}/`) {
  const page = await browser.newPage({ viewport });
  await instrument(page, label);
  const response = await page.goto(url);
  assert.equal(response.status(), 200, `${label}: page response`);
  const headers = response.headers();
  assert.match(headers['content-security-policy'], /style-src 'self'/);
  assert.doesNotMatch(headers['content-security-policy'], /unsafe-inline/);
  await page.waitForFunction(
    () => document.querySelector('#preview-app')?.dataset.assetsReady === 'true',
    null,
    { timeout: 15000 },
  );
  assert.equal(await page.locator('#preview-app').getAttribute('data-visual-approval'), 'pending');
  return page;
}

async function checkPageErrors(page, label) {
  await page.waitForTimeout(50);
  const cspViolations = await page.evaluate(() => window.__previewCspViolations);
  assert.deepEqual(cspViolations, [], `${label}: CSP violations`);
  assert.deepEqual(browserErrors, [], `${label}: browser errors`);
}

function assertNoOverlap(rects, label) {
  assert.equal(rects.length, 2, `${label}: expected two independent labels`);
  const [a, b] = rects;
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  assert.ok(overlapX <= 0 || overlapY <= 0, `${label}: label spans overlap`);
}

async function inspectScreen(page, screenName, width, { capture = true } = {}) {
  const metrics = await page.locator(`[data-screen="${screenName}"]`).evaluate((screen, screenName) => {
    const rect = screen.getBoundingClientRect();
    const visible = node => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const controls = [...screen.querySelectorAll('button, input')]
      .filter(visible)
      .map(node => {
        const bounds = node.getBoundingClientRect();
        return {
          label: node.getAttribute('aria-label') || node.textContent.trim() || node.name,
          width: bounds.width,
          height: bounds.height,
          left: bounds.left - rect.left,
          right: bounds.right - rect.left,
          top: bounds.top - rect.top,
          bottom: bounds.bottom - rect.top,
        };
      });
    const textNodes = {
      battle: '.unit-name, .unit-method, .unit-meter-labels span, .rage-labels span',
      start: '.start-title .eyebrow, .start-title h2, .start-subtitle, .start-fields label span, .method-field legend, .method-options button, .method-cue, .start-action',
      choice: '.choice-heading .eyebrow, .choice-heading h2, .choice-count, .artifact-name, .artifact-stat span, .artifact-stat b, .artifact-note, .artifact-details, .choice-confirm',
    }[screenName];
    const textIssues = [...screen.querySelectorAll(textNodes)]
      .filter(visible)
      .map(node => {
        const bounds = node.getBoundingClientRect();
        return {
          text: node.textContent.trim(),
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      })
      .filter(item =>
        item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1);
    const labelPairs = screenName === 'battle'
      ? [...screen.querySelectorAll('.unit-status')].flatMap(unit => [
        [...unit.querySelector('.unit-meter-labels').children].map(node => {
          const bounds = node.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
        }),
        [...unit.querySelector('.rage-labels').children].map(node => {
          const bounds = node.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
        }),
      ])
      : screenName === 'choice'
        ? [...screen.querySelectorAll('.artifact-stat')].map(row =>
          [...row.children].map(node => {
            const bounds = node.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
          }))
        : [];
    const cue = screenName === 'start' ? screen.querySelector('.method-cue') : null;
    const startAction = screenName === 'start' ? screen.querySelector('.start-action') : null;
    const overlaps = cue && startAction
      ? (() => {
        const a = cue.getBoundingClientRect();
        const b = startAction.getBoundingClientRect();
        return Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
          Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
      })()
      : false;
    return {
      screen: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      scroll: { width: screen.scrollWidth, height: screen.scrollHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
      },
      controls,
      textIssues,
      labelPairs,
      cueActionOverlap: overlaps,
    };
  }, screenName);

  if (capture) {
    const viewportHeight = await page.evaluate(() => innerHeight);
    assert.deepEqual(
      metrics.screen,
      { x: 0, y: 0, width, height: viewportHeight },
      `${screenName} capture must fill the viewport`,
    );
    assert.deepEqual(metrics.scroll, { width, height: viewportHeight });
    assert.ok(
      metrics.document.width <= width + 1 &&
      metrics.document.height <= viewportHeight + 1 &&
      metrics.document.bodyWidth <= width + 1 &&
      metrics.document.bodyHeight <= viewportHeight + 1,
      `${screenName}: capture viewport overflow`,
    );
  } else {
    assert.equal(metrics.screen.width, 320, `${screenName}: preview screen width`);
    assert.equal(metrics.screen.height, 760, `${screenName}: preview screen height`);
    assert.deepEqual(metrics.scroll, { width: 320, height: 760 });
  }
  assert.ok(metrics.controls.length > 0, `${screenName}: no visible controls`);
  const undersized = metrics.controls.filter(control =>
    control.width < 44 || control.height < 44 ||
    control.left < -1 || control.right > width + 1 ||
    control.top < -1 || control.bottom > metrics.screen.height + 1);
  assert.deepEqual(undersized, [], `${screenName}: controls below 44px or outside the screen`);
  assert.deepEqual(metrics.textIssues, [], `${screenName}: important text is clipped`);
  for (const [index, pair] of metrics.labelPairs.entries()) {
    assertNoOverlap(pair, `${screenName} labels ${index + 1}`);
  }
  assert.equal(metrics.cueActionOverlap, false, 'start method cue overlaps its action button');
  return metrics;
}

async function assertActualImages(page) {
  const result = await page.evaluate(async assets => {
    const stats = [];
    for (const asset of assets) {
      const image = new Image();
      image.src = asset.src;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error(`${asset.id}: decoded to an empty image`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const scale = Math.min(128 / image.naturalWidth, 128 / image.naturalHeight);
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, (128 - width) / 2, (128 - height) / 2, width, height);
      const pixels = context.getImageData(0, 0, 128, 128).data;
      let visiblePixels = 0;
      let opaquePixels = 0;
      const colors = new Set();
      for (let index = 0; index < pixels.length; index += 4) {
        const [red, green, blue, alpha] = pixels.slice(index, index + 4);
        if (alpha > 16) {
          visiblePixels += 1;
          colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
        }
        if (alpha > 240) opaquePixels += 1;
      }
      stats.push({
        id: asset.id,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        visiblePixels,
        opaquePixels,
        colorBuckets: colors.size,
      });
    }
    return stats;
  }, manifest.assets.map(asset => ({ id: asset.id, src: asset.src })));

  for (const item of result) {
    const asset = manifest.assets.find(entry => entry.id === item.id);
    assert.deepEqual(
      [item.naturalWidth, item.naturalHeight],
      asset.processed.dimensions,
      `${item.id}: decoded dimensions differ from manifest`,
    );
    assert.ok(item.visiblePixels > 500, `${item.id}: decoded pixels are effectively blank`);
    assert.ok(item.colorBuckets > 12, `${item.id}: decoded image has insufficient pixel variation`);
    if (asset.kind === 'scene') {
      assert.equal(item.opaquePixels, item.visiblePixels, `${item.id}: scene unexpectedly has transparency`);
    } else {
      assert.ok(item.opaquePixels > 250, `${item.id}: transparent art has no visible subject`);
    }
  }
  return result;
}

async function assertRenderedTargets(page) {
  const targets = await page.locator('img[data-asset-target]').evaluateAll(images =>
    images.map(image => ({
      target: image.dataset.assetTarget,
      hidden: image.hidden,
      decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
    })),
  );
  assert.equal(targets.length, 9, 'all placements, including repeated scene and player art, must exist');
  assert.ok(targets.every(image => !image.hidden && image.decoded), 'every actual asset target must render');
  assert.equal(targets.filter(image => image.target === 'battle-scene').length, 2);
  assert.equal(targets.filter(image => image.target === 'player').length, 2);
  return targets;
}

async function assertOverviewPreviews(page, viewport, label) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.overview-link img')]
      .every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
  );
  const metrics = await page.evaluate(async () => {
    const previews = [];
    for (const link of document.querySelectorAll('.overview-link')) {
      const image = link.querySelector('img');
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visiblePixels = 0;
      const colors = new Set();
      for (let index = 0; index < pixels.length; index += 4) {
        const [red, green, blue, alpha] = pixels.slice(index, index + 4);
        if (alpha > 16) {
          visiblePixels += 1;
          colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
        }
      }
      const rect = link.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      previews.push({
        label: link.getAttribute('aria-label'),
        imageAlt: image.alt,
        decoded: image.complete && image.naturalWidth === 320 && image.naturalHeight === 760,
        visiblePixels,
        colorBuckets: colors.size,
        link: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        image: { width: imageRect.width, height: imageRect.height },
      });
    }
    return {
      view: document.querySelector('#preview-app').dataset.view,
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
      },
      previews,
    };
  });

  assert.equal(metrics.view, 'overview', `${label}: expected overview view`);
  assert.ok(metrics.document.width <= viewport.width + 1, `${label}: horizontal page overflow`);
  assert.ok(metrics.document.height <= viewport.height + 1, `${label}: vertical page overflow`);
  assert.ok(metrics.document.bodyWidth <= viewport.width + 1, `${label}: horizontal body overflow`);
  assert.ok(metrics.document.bodyHeight <= viewport.height + 1, `${label}: vertical body overflow`);
  assert.equal(metrics.previews.length, 3);
  assert.ok(metrics.previews.every(item =>
    item.decoded &&
    item.imageAlt.length > 0 &&
    item.visiblePixels > 500 &&
    item.colorBuckets > 12 &&
    item.link.width >= 44 &&
    item.link.height >= 44 &&
    item.link.x >= -1 &&
    item.link.right <= viewport.width + 1 &&
    item.link.y >= -1 &&
    item.link.bottom <= viewport.height + 1),
  `${label}: overview previews must decode, show real pixels, and fit the first viewport`);

  if (viewport.width === 1440) {
    assert.deepEqual(metrics.previews.map(item => item.image.width), [320, 320, 320]);
    assert.deepEqual(metrics.previews.map(item => item.image.height), [760, 760, 760]);
  }

  await mkdir(overviewCaptureRoot, { recursive: true });
  await page.screenshot({
    path: path.join(overviewCaptureRoot, `${label}-${viewport.width}x${viewport.height}.png`),
  });
}

try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
      '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome',
    headless: true,
  });

  const sharedOverview = await readyPage(
    { width: 320, height: 760 },
    'overview-shareable',
    `${origin}/?screen=overview`,
  );
  await assertOverviewPreviews(
    sharedOverview,
    { width: 320, height: 760 },
    'overview-shareable',
  );
  await checkPageErrors(sharedOverview, 'overview-shareable');
  await sharedOverview.close();
  console.log('Explicit overview URL and real screenshot pixels OK');

  const privatePaths = [
    '/scripts/check-art.mjs',
    '/scripts/prepare-assets.py',
    '/package.json',
    '/output/imagegen/player.png',
    '/assets/not-an-asset.svg',
  ];
  for (const privatePath of privatePaths) {
    const response = await fetch(`${origin}${privatePath}`);
    assert.equal(response.status, 404, `${privatePath}: module-private path must remain unavailable`);
  }

  for (const viewport of [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
  ]) {
    for (const screen of ['battle', 'start', 'choice']) {
      const page = await readyPage(
        viewport,
        `capture-${screen}-${viewport.width}`,
        `${origin}/?screen=${screen}&capture=1`,
      );
      assert.equal(new URL(page.url()).searchParams.get('capture'), '1');
      assert.equal(await page.locator('#preview-app').getAttribute('data-capture'), 'true');
      assert.equal(await page.locator('#asset-status').isVisible(), false);
      await assertRenderedTargets(page);
      const reloadResponse = await page.reload();
      assert.equal(reloadResponse.status(), 200, `capture-${screen}-${viewport.width}: reload response`);
      assert.equal(new URL(page.url()).searchParams.get('capture'), '1');
      await page.waitForFunction(
        () => document.querySelector('#preview-app')?.dataset.assetsReady === 'true',
        null,
        { timeout: 15000 },
      );
      assert.equal(await page.locator('#preview-app').getAttribute('data-capture'), 'true');
      assert.equal(await page.locator('#preview-app').getAttribute('data-visual-approval'), 'pending');
      await assertRenderedTargets(page);
      const capturePath = path.join(captureRoot, `${screen}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: capturePath });
      const metrics = await inspectScreen(page, screen, viewport.width);
      if (screen === 'choice') {
        const cards = page.locator('.artifact-option');
        assert.equal(await cards.count(), 3);
        const bounds = await cards.evaluateAll(nodes =>
          nodes.map(node => {
            const rect = node.getBoundingClientRect();
            return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
          }),
        );
        assert.equal(bounds[0].y, bounds[1].y);
        assert.equal(bounds[1].y, bounds[2].y);
        assert.ok(bounds[0].right < bounds[1].x && bounds[1].right < bounds[2].x);
      }
      console.log(`Real-art capture OK ${viewport.width}x${viewport.height}: ${capturePath}`);
      console.log(`  ${screen} screen ${metrics.screen.width}x${metrics.screen.height}; controls ${metrics.controls.length}`);
      await checkPageErrors(page, `capture-${screen}-${viewport.width}`);
      await page.close();
    }
  }

  for (const viewport of [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
  ]) {
    const page = await readyPage(viewport, `workflow-${viewport.width}`);
    const decoded = await assertActualImages(page);
    const targets = await assertRenderedTargets(page);
    await assertOverviewPreviews(page, viewport, `overview-root-${viewport.width}`);
    assert.equal(await page.locator('svg').count(), 0, 'preview uses the actual raster assets, not SVG stand-ins');
    assert.equal(await page.locator('#asset-status').textContent(), '素材已载入，待视觉确认');

    await page.locator('.view-switcher')
      .getByRole('link', { name: '战斗', exact: true }).click();
    await inspectScreen(page, 'battle', viewport.width, { capture: false });
    const actor = page.locator('.battle-actors img').first();
    const transforms = [];
    for (let index = 0; index < 4; index += 1) {
      transforms.push(await actor.evaluate(node => getComputedStyle(node).transform));
      await page.waitForTimeout(300);
    }
    assert.ok(new Set(transforms).size > 1, 'battle actors must move at normal speed');
    await page.locator('[data-battle-control="pause"]').click();
    await page.waitForTimeout(100);
    const pausedTransform = await actor.evaluate(node => getComputedStyle(node).transform);
    await page.waitForTimeout(350);
    assert.equal(
      await actor.evaluate(node => getComputedStyle(node).transform),
      pausedTransform,
      'pause must stop actor animation',
    );
    await page.locator('[data-battle-control="pause"]').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await actor.evaluate(node => getComputedStyle(node).animationName),
      'none',
      'reduced motion must disable actor animation',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('[data-open-dialog="battle"]').click();
    await page.locator('#detail-dialog[open]').waitFor();
    await page.getByRole('button', { name: '关闭详情' }).click();
    console.log(`Battle animation and HUD labels OK ${viewport.width}x${viewport.height}`);

    await page.locator('.view-switcher')
      .getByRole('link', { name: '开局', exact: true }).click();
    const startMetrics = await inspectScreen(page, 'start', viewport.width, { capture: false });
    const methodCues = [
      ['RKF01', '按防御获得护盾，护盾能反击敌人。'],
      ['RKF02', '怒技返还怒气，加快后续出手。'],
      ['RKF03', '攻击同时治疗，气血越高回复越多。'],
      ['RKF04', '叠加燃烧，让敌人持续受伤。'],
      ['RKF05', '普攻积累剑势，越战越强。'],
    ];
    for (const [id, cue] of methodCues) {
      await page.locator(`[data-method="${id}"]`).click();
      assert.equal(await page.locator('#method-cue').textContent(), cue);
      const methodMetrics = await inspectScreen(page, 'start', viewport.width, { capture: false });
      assert.ok(methodMetrics.controls.length >= startMetrics.controls.length);
    }
    const seed = page.locator('input[name="seed"]');
    await seed.fill('real-art-seed-2026');
    await page.locator('[data-method="RKF05"]').click();
    assert.equal(await seed.inputValue(), 'real-art-seed-2026', 'method switching must preserve the seed');
    await page.getByRole('button', { name: '踏入山海' }).click();
    await page.locator('#detail-dialog[open]').waitFor();
    assert.match(await page.locator('#dialog-copy').textContent(), /命数种子 real-art-seed-2026 · 养剑诀/);
    await page.getByRole('button', { name: '关闭详情' }).click();
    console.log(`Method switching and seed persistence OK ${viewport.width}x${viewport.height}`);

    await page.locator('.view-switcher')
      .getByRole('link', { name: '法宝', exact: true }).click();
    const choiceMetrics = await inspectScreen(page, 'choice', viewport.width, { capture: false });
    assert.ok(choiceMetrics.controls.length >= 7);
    for (const name of ['震岳鼓', '余烬盏', '定心佩']) {
      await page.getByRole('button', { name: `查看${name}详情` }).click();
      await page.locator('#detail-dialog[open]').waitFor();
      assert.equal(await page.locator('#dialog-title').textContent(), name);
      await page.getByRole('button', { name: '关闭详情' }).click();
    }
    await page.locator('[data-artifact-choice="artifact-rr11"]').click();
    assert.equal(
      await page.locator('[data-artifact="artifact-rr11"]').getAttribute('class'),
      'artifact-option is-selected',
    );
    await page.getByRole('button', { name: '确认选择' }).click();
    assert.equal(await page.locator('#dialog-title').textContent(), '余烬盏');
    await page.getByRole('button', { name: '关闭详情' }).click();
    console.log(`Artifact cards and detail dialogs OK ${viewport.width}x${viewport.height}`);
    console.log(`  pixel checks: ${decoded.map(item => `${item.id} ${item.visiblePixels}px/${item.colorBuckets} colors`).join(', ')}`);
    console.log(`  rendered placements: ${targets.length}; 3 cards on one row`);

    await checkPageErrors(page, `workflow-${viewport.width}`);
    await page.close();
  }

  const desktop = await readyPage(
    { width: 1440, height: 900 },
    'desktop-comparison',
  );
  await assertOverviewPreviews(desktop, { width: 1440, height: 900 }, 'overview-root-desktop');
  await desktop.locator('.view-switcher')
    .getByRole('link', { name: '对比', exact: true }).click();
  const desktopCapture = path.join(captureRoot, 'comparison-1440x900.png');
  await desktop.screenshot({ path: desktopCapture });
  const comparison = await desktop.locator('.screen-deck').evaluate(node => ({
    width: node.scrollWidth,
    clientWidth: node.clientWidth,
    screens: [...node.querySelectorAll('.phone-screen')]
      .filter(screen => getComputedStyle(screen).display !== 'none')
      .map(screen => {
        const rect = screen.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
  }));
  assert.equal(comparison.screens.length, 3);
  assert.ok(comparison.width <= comparison.clientWidth + 1);
  assert.deepEqual(comparison.screens.map(screen => screen.width), [320, 320, 320]);
  assert.ok(comparison.screens.every(screen =>
    screen.x >= 0 && screen.x + screen.width <= 1440 && screen.height === 760));
  console.log(`Desktop comparison capture OK 1440x900: ${desktopCapture}`);
  await checkPageErrors(desktop, 'desktop-comparison');
  await desktop.close();

  console.log(`All real-art checks passed; approval remains ${manifest.approval.status}.`);
} finally {
  if (browser) await browser.close();
  server.close();
  await once(server, 'close');
}
