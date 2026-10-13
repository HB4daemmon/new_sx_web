import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { createPreviewServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  '/opt/tools/browser-tools/node_modules/playwright');
const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url)));
const output = new URL('../captures/cartoon-art/', import.meta.url);
await mkdir(output, { recursive: true });
const server = createPreviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

async function checkGeometry(page, screenName) {
  const issues = await page.locator(`[data-screen="${screenName}"]`).evaluate(screen => {
    const outer = screen.getBoundingClientRect();
    const failures = [];
    if (screen.scrollWidth > screen.clientWidth || screen.scrollHeight > screen.clientHeight) {
      failures.push('screen overflow');
    }
    for (const control of screen.querySelectorAll('button')) {
      const r = control.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) failures.push(`small target ${control.textContent}`);
      if (r.left < outer.left - 1 || r.right > outer.right + 1 ||
          r.top < outer.top - 1 || r.bottom > outer.bottom + 1) {
        failures.push(`outside screen ${control.textContent}`);
      }
    }
    for (const text of screen.querySelectorAll(
      '.artifact-name, .artifact-stat, .artifact-cue, .unit-name, .unit-method, #method-cue'
    )) {
      if (text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1) {
        failures.push(`clipped text ${text.textContent}`);
      }
    }
    const intersects = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    if (screen.dataset.screen === 'battle') {
      const readouts = screen.querySelector('.battle-readouts').getBoundingClientRect();
      const actors = [...screen.querySelectorAll('.battle-actors img')]
        .map(image => image.getBoundingClientRect());
      for (const actor of actors) {
        if (intersects(actor, readouts)) failures.push('actor/readout overlap');
      }
      if (intersects(...actors)) failures.push('actor/actor overlap');
      const controls = screen.querySelector('.battle-controls').getBoundingClientRect();
      for (const actor of actors) {
        if (intersects(actor, controls)) failures.push('actor/controls overlap');
      }
    }
    if (screen.dataset.screen === 'start' &&
        intersects(screen.querySelector('.start-figure img').getBoundingClientRect(),
          screen.querySelector('.start-controls').getBoundingClientRect())) {
      failures.push('start actor/controls overlap');
    }
    return failures;
  });
  assert.deepEqual(issues, [], `${screenName}: ${issues.join(', ')}`);
}

try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
      '/opt/tools/ms-playwright/chromium-1228/chrome-linux/chrome',
    headless: true,
  });
  for (const viewport of [
    { width: 320, height: 568 }, { width: 320, height: 760 },
    { width: 390, height: 844 }, { width: 1440, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`${origin}/?screen=overview`);
    await page.waitForFunction(() => document.querySelector('#preview-app').dataset.libraryReady === 'true');
    const decoded = await page.evaluate(async assets => {
      const results = [];
      for (const asset of assets) {
        const image = new Image();
        image.src = asset.src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0;
        let partialAlpha = 0;
        for (let i = 3; i < rgba.length; i += 4) {
          if (rgba[i]) visible++;
          if (rgba[i] !== 0 && rgba[i] !== 255) partialAlpha++;
        }
        results.push({ id: asset.id, dimensions: [image.naturalWidth, image.naturalHeight],
          visible, partialAlpha });
      }
      return results;
    }, manifest.assets);
    for (const result of decoded) {
      const asset = manifest.assets.find(item => item.id === result.id);
      assert.deepEqual(result.dimensions, asset.processed.dimensions);
      assert.ok(result.visible > 120, `${result.id}: nonblank decoded pixels`);
      if (asset.kind === 'character' || asset.kind === 'pose') {
        assert.ok(result.partialAlpha > 0, `${result.id}: smooth silhouette`);
      }
    }
    assert.equal(await page.locator('.overview-screen-mount > .game-screen').count(), 4);
    assert.equal(await page.locator('iframe, svg').count(), 0);
    await page.screenshot({ path: new URL(`overview-${viewport.width}x${viewport.height}.png`, output).pathname });
    for (const screenName of ['start', 'map', 'battle', 'choice']) {
      const capture = viewport.width <= 390;
      if (capture) {
        await page.goto(`${origin}/?screen=${screenName}`);
        await page.waitForFunction(() => document.querySelector('#preview-app').dataset.libraryReady === 'true');
        await checkGeometry(page, screenName);
        await page.screenshot({
          path: new URL(`framed-${screenName}-${viewport.width}x${viewport.height}.png`, output).pathname,
        });
      }
      await page.goto(`${origin}/?screen=${screenName}${capture ? '&capture=1' : ''}`);
      await page.waitForFunction(() => document.querySelector('#preview-app').dataset.libraryReady === 'true');
      await checkGeometry(page, screenName);
      assert.equal(await page.locator('#preview-app').getAttribute('data-visual-approval'), 'pending');
      const rendering = await page.locator(`[data-screen="${screenName}"] img`).evaluateAll(images =>
        images.map(image => getComputedStyle(image).imageRendering));
      assert.ok(rendering.every(mode => mode === 'auto'));
      await page.screenshot({ path: new URL(`${screenName}-${viewport.width}x${viewport.height}.png`, output).pathname });
    }
    if (viewport.width <= 390) {
      await page.goto(`${origin}/?screen=battle&capture=1`);
      await page.waitForFunction(() => document.querySelector('#preview-app').dataset.libraryReady === 'true');
      await page.locator('.battle-feedback:not([hidden])').waitFor();
      assert.equal(await page.locator('#preview-app').getAttribute('data-animation-kind'), 'cutout-skeletal');
      assert.equal(await page.locator('.combat-rig').isVisible(), true);
      await page.screenshot({ path: new URL(`attack-${viewport.width}.png`, output).pathname });
      assert.equal(await page.locator('.battle-feedback').textContent(), '普攻 · 合计 92');
      assert.equal(await page.locator('.enemy-status .health-value').textContent(), '302/450');
      assert.equal(await page.locator('.enemy-status .shield-value').textContent(), '0');
      await page.locator('[data-battle-control="pause"]').click();
      const pausedPose = await page.locator('.combat-rig').evaluate(canvas => canvas.toDataURL());
      const hp = await page.locator('.battle-readouts').innerText();
      await page.waitForTimeout(2600);
      assert.equal(await page.locator('.battle-readouts').innerText(), hp, 'paused playback must not advance');
      assert.equal(await page.locator('.combat-rig').evaluate(canvas => canvas.toDataURL()), pausedPose,
        'pause freezes the actual skeletal canvas as well as the numbers');
      await page.locator('[data-open-dialog="battle"]').click();
      await page.locator('#detail-dialog[open]').waitFor();
      assert.match(await page.locator('#dialog-stats').innerText(), /302\/450/);
      await page.screenshot({ path: new URL(`details-${viewport.width}.png`, output).pathname });
      await page.getByRole('button', { name: '关闭详情' }).click();
      await page.locator('[data-battle-control="speed"]').click();
      await page.locator('[data-battle-control="pause"]').click();
      await page.waitForFunction(() => document.querySelector('.battle-feedback').textContent === '盾挡 · 合计 54');
      assert.equal(await page.locator('.player-status .shield-value').textContent(), '126');
      await page.locator('[data-open-dialog="battle"]').click();
      const modalPose = await page.locator('.combat-rig').evaluate(canvas => canvas.toDataURL());
      const modalStats = await page.locator('.battle-readouts').innerText();
      await page.waitForTimeout(1500);
      assert.equal(await page.locator('.battle-readouts').innerText(), modalStats,
        'details freeze playback without requiring manual pause');
      assert.equal(await page.locator('.combat-rig').evaluate(canvas => canvas.toDataURL()), modalPose,
        'details freeze the skeleton too');
      await page.getByRole('button', { name: '关闭详情' }).click();
      await page.waitForFunction(() => document.querySelector('.battle-feedback').textContent === '怒技 · 合计 138');
      await page.screenshot({ path: new URL(`rage-hit-${viewport.width}.png`, output).pathname });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() =>
        document.querySelector('.combat-rig').dataset.playerAction === 'idle');
      assert.equal(await page.locator('.battle-actors img').first()
        .evaluate(image => getComputedStyle(image).animationName), 'none');
      await page.locator('[data-battle-control="skip"]').click();
      await page.locator('[data-artifact-detail="artifact-rr09"]').click();
      assert.equal(await page.locator('.artifact-select[aria-pressed="true"]').count(), 0);
      await page.getByRole('button', { name: '关闭详情' }).click();
      await page.locator('[data-artifact-choice="artifact-rr11"]').click();
      await page.locator('.choice-confirm').click();
      assert.equal(new URL(page.url()).searchParams.get('screen'), 'map');
      await page.locator('[data-map-node="coast"]').click();
      await page.locator('#detail-dialog[open]').waitFor();
      assert.equal(await page.locator('#dialog-title').textContent(), '养锋石卫');
      await page.getByRole('button', { name: '确认前往' }).click();
      assert.equal(new URL(page.url()).searchParams.get('screen'), 'battle');
    }
    assert.deepEqual(errors, [], 'no browser, CSP or network errors');
    await page.close();
    console.log(`Cartoon art, poses, layout, controls and playback passed ${viewport.width}x${viewport.height}`);
  }
  for (const privatePath of ['/output/imagegen-cartoon-kit/player-v2.png', '/prompts/cartoon-kit.jsonl',
    '/scripts/prepare-cartoon-assets.py', '/assets/ui-unknown.png', '/assets/player-unknown.png']) {
    assert.equal((await fetch(origin + privatePath)).status, 404);
  }
} finally {
  if (browser) await browser.close();
  server.close();
  await once(server, 'close');
}
