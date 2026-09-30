import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from './serve.mjs';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(moduleRoot, 'public', 'previews');

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

await mkdir(outputRoot, { recursive: true });
const { chromium } = playwrightModule();
const server = createPreviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
const browserErrors = [];

try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
      '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome',
    headless: true,
  });

  for (const screen of ['start', 'battle', 'choice']) {
    const page = await browser.newPage({ viewport: { width: 320, height: 760 } });
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(`${screen} console: ${message.text()}`);
    });
    page.on('pageerror', error => browserErrors.push(`${screen} pageerror: ${error.message}`));
    page.on('requestfailed', request =>
      browserErrors.push(`${screen} request failed: ${request.url()}`));

    const response = await page.goto(`${origin}/?screen=${screen}&capture=1`);
    assert.equal(response.status(), 200, `${screen}: sample page response`);
    await page.waitForFunction(() =>
      document.querySelector('#preview-app')?.dataset.assetsReady === 'true',
    );

    const rendered = await page.evaluate(screenName => {
      const app = document.querySelector('#preview-app');
      const toolbar = document.querySelector('.preview-toolbar');
      const sample = document.querySelector(`[data-screen="${screenName}"]`);
      const bounds = sample.getBoundingClientRect();
      return {
        view: app.dataset.view,
        capture: app.dataset.capture,
        approval: app.dataset.visualApproval,
        toolbar: getComputedStyle(toolbar).display,
        sample: { width: bounds.width, height: bounds.height },
        decodedTargets: [...document.querySelectorAll('img[data-asset-target]')]
          .filter(image => !image.hidden && image.complete && image.naturalWidth > 0).length,
      };
    }, screen);
    assert.equal(rendered.view, screen);
    assert.equal(rendered.capture, 'true');
    assert.equal(rendered.approval, 'pending');
    assert.equal(rendered.toolbar, 'none');
    assert.deepEqual(rendered.sample, { width: 320, height: 760 });
    assert.equal(rendered.decodedTargets, 9);

    const filename = path.join(outputRoot, `${screen}.png`);
    const png = await page.screenshot({ path: filename });
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual(
      [png.readUInt32BE(16), png.readUInt32BE(20)],
      [320, 760],
      `${screen}: screenshot dimensions`,
    );
    console.log(`Captured real ${screen} sample: ${filename}`);
    await page.close();
  }

  assert.deepEqual(browserErrors, []);
} finally {
  if (browser) await browser.close();
  server.close();
  await once(server, 'close');
}
