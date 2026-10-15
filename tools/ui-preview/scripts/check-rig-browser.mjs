import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { createPreviewServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/tools/browser-tools/node_modules/playwright');
const captures = new URL('../captures/frames/', import.meta.url);
await mkdir(captures, { recursive: true });
const server = createPreviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const library = JSON.parse(await readFile(new URL('../public/assets/library.json', import.meta.url)));
let browser;
const fingerprint = async canvas =>
  createHash('sha256').update(await canvas.evaluate(node => node.toDataURL())).digest('hex');
async function ready(page, query) {
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => document.querySelector('#preview-app').dataset.libraryReady === 'true');
}
async function pixelBounds(canvas) {
  return canvas.evaluate(node => {
    const copy = document.createElement('canvas');
    copy.width = node.width; copy.height = node.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(node, 0, 0);
    const { width, height } = node;
    const data = ctx.getImageData(0, 0, width, height).data;
    const sides = [{ left: width, top: height, right: 0, bottom: 0, count: 0 },
      { left: width, top: height, right: 0, bottom: 0, count: 0 }];
    let edgePixels = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 128) continue;
      if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) edgePixels++;
      const side = sides[x < width / 2 ? 0 : 1];
      side.count++;
      side.left = Math.min(side.left, x); side.top = Math.min(side.top, y);
      side.right = Math.max(side.right, x); side.bottom = Math.max(side.bottom, y);
    }
    return { width, height, sides, edgePixels };
  });
}

try {
  browser = await chromium.launch({
    executablePath: '/opt/tools/ms-playwright/chromium-1228/chrome-linux/chrome', headless: true,
  });
  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await ready(page, 'screen=start&capture=1');
    const portraits = new Set();
    const portraitHeights = [];
    for (const id of ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05']) {
      await page.locator(`[data-method="${id}"]`).click();
      await page.waitForFunction(expected => document.querySelector('.start-rig').dataset.skin === expected, id);
      portraits.add(await fingerprint(page.locator('.start-rig')));
      const portrait = await pixelBounds(page.locator('.start-rig'));
      portraitHeights.push(Math.max(...portrait.sides.filter(side => side.count > 0)
        .map(side => side.bottom)) - Math.min(...portrait.sides.filter(side => side.count > 0)
        .map(side => side.top)) + 1);
      await page.screenshot({ path: new URL(`start-${id}-${viewport.width}.png`, captures).pathname });
    }
    assert.equal(portraits.size, 5, 'method selection changes the actual rendered character');
    assert.ok(Math.max(...portraitHeights) - Math.min(...portraitHeights) <= 3,
      `method portraits share a calibrated visible height: ${portraitHeights}`);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#preview-app').dataset.libraryReady === 'true');
    assert.equal(await page.locator('.start-rig').getAttribute('data-skin'), 'RKF05');
    await page.locator('.start-action').click();
    assert.equal(await page.locator('[data-map-method]').textContent(), '养剑诀');
    assert.equal(await page.locator('[data-map-art]:visible').count(), 5);
    await page.screenshot({ path: new URL(`map-${viewport.width}.png`, captures).pathname });
    await page.locator('[data-map-node="coast"]').click();
    assert.equal(await page.locator('#dialog-title').textContent(), '养锋石卫');
    assert.equal(await page.locator('#dialog-stats').innerText(), '地点\n古道\n功法\n养剑诀');
    await page.getByRole('button', { name: '确认前往' }).click();
    const canvas = page.locator('.combat-rig');
    assert.equal(await page.locator('#preview-app').getAttribute('data-animation-kind'), 'drawn-frames');
    assert.equal(await canvas.getAttribute('data-engine'), 'drawn-frames');
    assert.equal(await page.locator('.unit-status .meter').count(), 4);
    await page.locator('[data-battle-control="pause"]').click();
    const idle = await pixelBounds(canvas);
    assert.ok(idle.sides.every(side => side.count > 1800), 'both characters render substantial pixels');
    assert.equal(idle.edgePixels, 0, 'idle characters fit inside the transparent canvas');
    const still = await fingerprint(canvas);
    await page.waitForTimeout(300);
    assert.equal(await fingerprint(canvas), still, 'pause freezes actual canvas pixels');
    await page.screenshot({ path: new URL(`battle-idle-${viewport.width}.png`, captures).pathname });
    await page.locator('[data-battle-control="speed"]').click();
    await page.locator('[data-battle-control="pause"]').click();
    const moving = await fingerprint(canvas);
    const movingClock = Number(await canvas.getAttribute('data-clock'));
    await page.waitForFunction(clock =>
      Number(document.querySelector('.combat-rig').dataset.clock) > clock + 120, movingClock);
    assert.notEqual(await fingerprint(canvas), moving, 'drawn-character idle really moves');
    await page.waitForFunction(() => document.querySelector('.combat-rig').dataset.playerAction === 'attack');
    // The first feedback belongs to the impact, not to the start of the windup.
    assert.equal(await page.locator('.enemy-status .health-value').textContent(), '344/450');
    await page.waitForFunction(() => document.querySelector('.battle-feedback').textContent === '普攻 · 合计 92');
    const stageBounds = await canvas.boundingBox();
    const feedbackBounds = await page.locator('.battle-feedback').boundingBox();
    assert.ok(stageBounds.y + stageBounds.height + 6 <= feedbackBounds.y,
      'action feedback stays below the character canvas, including short phones');
    assert.equal(await page.locator('.enemy-status .health-value').textContent(), '302/450');
    assert.equal(await page.locator('.enemy-status .shield-value').textContent(), '0');
    await page.locator('[data-battle-control="pause"]').click();
    await page.screenshot({ path: new URL(`battle-attack-${viewport.width}.png`, captures).pathname });
    const paused = await fingerprint(canvas);
    const stats = await page.locator('.battle-readouts').innerText();
    await page.waitForTimeout(800);
    assert.equal(await fingerprint(canvas), paused);
    assert.equal(await page.locator('.battle-readouts').innerText(), stats);
    await page.locator('[data-open-dialog="battle"]').click();
    assert.match(await page.locator('#dialog-stats').innerText(), /302\/450/);
    await page.waitForTimeout(200);
    assert.equal(await fingerprint(canvas), paused);
    await page.getByRole('button', { name: '关闭详情' }).click();
    await page.locator('[data-battle-control="pause"]').click();
    await page.waitForFunction(() => document.querySelector('.battle-feedback').textContent === '盾挡 · 合计 54');
    assert.equal(await page.locator('.player-status .shield-value').textContent(), '126');
    await page.locator('[data-open-dialog="battle"]').click();
    const modal = await fingerprint(canvas);
    await page.waitForTimeout(800);
    assert.equal(await fingerprint(canvas), modal, 'modal freezes both characters');
    await page.getByRole('button', { name: '关闭详情' }).click();
    await page.waitForFunction(() => document.querySelector('.battle-feedback').textContent === '怒技 · 合计 138');
    assert.equal(await page.locator('.enemy-status .health-value').textContent(), '164/450');
    await page.screenshot({ path: new URL(`battle-rage-${viewport.width}.png`, captures).pathname });
    await page.waitForFunction(() => document.querySelector('.combat-rig').dataset.enemyAction === 'artifact');
    await page.waitForTimeout(120);
    await page.screenshot({ path: new URL(`battle-artifact-${viewport.width}.png`, captures).pathname });
    await page.waitForFunction(() => document.querySelector('.combat-rig').dataset.playerAction === 'heal');
    await page.waitForTimeout(120);
    await page.screenshot({ path: new URL(`battle-heal-${viewport.width}.png`, captures).pathname });
    await page.waitForFunction(() => document.querySelector('.battle-feedback').textContent === '恢复 · 气血 +36');
    assert.equal(await page.locator('.player-status .health-value').textContent(), '676/920');
    assert.equal(await page.locator('.battle-feedback').evaluate(node => getComputedStyle(node).color),
      'rgb(56, 100, 79)', 'healing uses the recovery color');
    await page.waitForFunction(() => document.querySelector('.combat-rig').dataset.enemyAction === 'rage');
    await page.screenshot({ path: new URL(`enemy-rage-${viewport.width}.png`, captures).pathname });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.combat-rig').dataset.playerAction === 'idle' &&
      document.querySelector('.combat-rig').dataset.enemyAction === 'idle');
    assert.equal(await page.locator('.player-status .health-value').textContent(), '650/920');
    assert.equal(await page.locator('.player-status .shield-value').textContent(), '0');
    const reduced = await fingerprint(canvas);
    await page.waitForTimeout(220);
    assert.equal(await fingerprint(canvas), reduced, 'reduced motion keeps a stable rig');
    await page.locator('[data-battle-control="skip"]').click();
    const clock = await canvas.getAttribute('data-clock');
    await page.waitForTimeout(300);
    assert.equal(await canvas.getAttribute('data-clock'), clock, 'leaving battle cancels the animation clock');
    await page.locator('[data-artifact-choice="artifact-rr09"]').click();
    await page.locator('.choice-confirm').click();
    await page.screenshot({ path: new URL(`map-collected-${viewport.width}.png`, captures).pathname });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Drawn-frame actions, method skins, real canvas pixels and timing passed ${viewport.width}x${viewport.height}`);
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await ready(page, 'screen=overview');
  const decoded = await page.evaluate(async assets => {
    const results = [];
    for (const asset of assets) {
      const image = new Image();
      image.src = asset.src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0, transparent = 0, edges = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i]) visible++; else transparent++;
        if (pixels[i] > 0 && pixels[i] < 255) edges++;
      }
      results.push({ id: asset.id, visible, transparent, edges });
    }
    return results;
  }, library.assets);
  assert.ok(decoded.every(image => image.visible > 1000 && image.transparent > 1000 && image.edges > 0),
    'every new atlas and icon has nonblank, antialiased, truly transparent pixels');
  await page.getByRole('button', { name: '法宝图鉴' }).click();
  assert.equal(await page.locator('[data-catalog-id]').count(), 44);
  await page.screenshot({ path: new URL('catalog.png', captures).pathname });
  for (const id of ['RC01', 'RR05', 'RL01', 'RL05']) {
    await page.locator(`[data-catalog-id="${id}"]`).click();
    assert.equal(await page.locator('#dialog-title').textContent(), library.artifacts[id].name);
    await page.getByRole('button', { name: '返回图鉴' }).click();
  }
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.screenshot({ path: new URL('overview.png', captures).pathname });
  const lost = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const lossErrors = [];
  lost.on('pageerror', error => lossErrors.push(error.message));
  await ready(lost, 'screen=battle&capture=1');
  await lost.waitForFunction(() => document.querySelector('.combat-rig').dataset.playerAction === 'attack' &&
    document.querySelector('.enemy-status .health-value').textContent === '344/450');
  await lost.evaluate(() => {
    document.querySelector('[data-battle-control="pause"]').click();
    const canvas = document.querySelector('.combat-rig');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await lost.waitForFunction(() => document.querySelector('#preview-app').dataset.libraryReady === 'false');
  assert.equal(await lost.locator('.player-art').isVisible(), true);
  assert.equal(await lost.locator('.enemy-status .health-value').textContent(), '344/450',
    'context loss while paused must defer the pending impact');
  await lost.locator('[data-battle-control="pause"]').click();
  assert.equal(await lost.locator('.enemy-status .health-value').textContent(), '302/450');
  await lost.waitForTimeout(200);
  assert.equal(await lost.locator('.enemy-status .health-value').textContent(), '302/450');
  await lost.locator('[data-battle-control="skip"]').click();
  assert.deepEqual(lossErrors, []);
  await lost.close();
  console.log('WebGL loss falls back without losing or duplicating a paused impact');
  // Texture loading and 2D rendering failures both preserve the static fallback.
  for (const mode of ['texture', 'canvas']) {
    const fallback = await browser.newPage({ viewport: { width: 320, height: 568 } });
    const fallbackErrors = [];
    fallback.on('pageerror', error => fallbackErrors.push(error.message));
    if (mode === 'texture') {
      await fallback.route('**/assets/frames-rkf01.png', route => route.fulfill({ status: 404, body: '' }));
    } else {
      await fallback.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args) {
          return this.classList.contains('combat-rig') &&
            ['webgl', 'webgl2', 'experimental-webgl'].includes(args[0]) ? null : original.apply(this, args);
        };
      });
    }
    await fallback.goto(`${origin}/?screen=battle`);
    await fallback.waitForFunction(() => document.querySelector('#preview-app').dataset.assetsReady === 'true');
    await fallback.waitForTimeout(250);
    assert.equal(await fallback.locator('#preview-app').getAttribute('data-library-ready'), 'false');
    assert.equal(await fallback.locator('.player-art').isVisible(), true);
    assert.equal(await fallback.locator('.combat-rig').isVisible(), false);
    assert.equal(await fallback.locator('#preview-app').getAttribute('data-animation-kind'), 'illustrated-poses');
    await fallback.locator('[data-battle-control="speed"]').click();
    await fallback.waitForFunction(() => document.querySelector('.battle-feedback').textContent === '怒技 · 合计 152');
    assert.deepEqual(fallbackErrors, [], 'the full fallback cycle has no missing enemy rage pose error');
    await fallback.locator('[data-battle-control="skip"]').click();
    assert.equal(new URL(fallback.url()).searchParams.get('screen'), 'choice');
    await fallback.close();
  }
  await ready(page, 'screen=start&method=__proto__');
  assert.equal(await page.locator('.start-rig').getAttribute('data-skin'), 'RKF01');
  await page.close();
  console.log('44-item catalog, back navigation and missing-texture/canvas fallback passed');
} finally {
  if (browser) await browser.close();
  server.close();
  await once(server, 'close');
}
