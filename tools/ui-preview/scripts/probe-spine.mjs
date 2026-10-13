import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Evaluate the vendor's own published player; do not embed or redistribute it.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  '/opt/tools/browser-tools/node_modules/playwright');
const output = new URL('../captures/spine-evaluation/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    '/opt/tools/ms-playwright/chromium-1228/chrome-linux/chrome',
  headless: true,
});
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto('https://esotericsoftware.com/spine-player', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const canvas = page.locator('#player-top canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForTimeout(1500);
    const metrics = await canvas.evaluate(element => {
      const gl = element.getContext('webgl2') || element.getContext('webgl');
      return {
        width: element.width,
        height: element.height,
        webgl: Boolean(gl),
        renderer: gl ? gl.getParameter(gl.RENDERER) : null,
      };
    });
    assert.ok(metrics.webgl && metrics.width > 0 && metrics.height > 0);
    const frameA = await canvas.screenshot({
      path: new URL(`official-${viewport.width}-a.png`, output).pathname,
    });
    await page.waitForTimeout(700);
    const frameB = await canvas.screenshot({
      path: new URL(`official-${viewport.width}-b.png`, output).pathname,
    });
    const hashes = [frameA, frameB].map(frame =>
      createHash('sha256').update(frame).digest('hex'));
    assert.notEqual(hashes[0], hashes[1], 'the official skeleton must actually move');
    results.push({ viewport, ...metrics, moving: true, frameHashes: hashes });
    await page.close();
  }
  const report = {
    checkedAt: new Date().toISOString(),
    source: 'https://esotericsoftware.com/spine-player',
    scope: 'vendor-hosted Web Player evaluation, not product integration or real-device certification',
    results,
  };
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
