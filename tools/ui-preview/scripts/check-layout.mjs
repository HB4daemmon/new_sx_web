import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
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
const server = createPreviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const fixtureManifest = {
  schemaVersion: 1,
  approval: { status: 'approved', reviewedBy: 'test fixture' },
  assets: [
    { id: 'battle-scene', src: '/assets/scene-battle.webp', kind: 'scene', screen: 'battle', required: true },
    { id: 'start-scene', src: '/assets/scene-start.webp', kind: 'scene', screen: 'start', required: true },
    { id: 'player', src: '/assets/player.png', kind: 'character', screen: 'battle', required: true },
    { id: 'enemy', src: '/assets/enemy.png', kind: 'character', screen: 'battle', required: true },
    { id: 'artifact-rr09', src: '/assets/artifact-rr09.png', kind: 'artifact', target: 'artifact-rr09', contentId: 'RR09', required: true },
    { id: 'artifact-rr11', src: '/assets/artifact-rr11.png', kind: 'artifact', target: 'artifact-rr11', contentId: 'RR11', required: true },
    { id: 'artifact-rr15', src: '/assets/artifact-rr15.png', kind: 'artifact', target: 'artifact-rr15', contentId: 'RR15', required: true },
  ],
};
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1s8AAAAASUVORK5CYII=',
  'base64',
);
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
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: transparentPng,
    });
  });
  await page.route('**/assets/manifest.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fixtureManifest),
  }));
}

async function assertNoPageErrors(page, errors) {
  await page.waitForTimeout(30);
  assert.deepEqual(errors, []);
}

try {
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await mockAssets(page);
    const response = await page.goto(origin);
    const csp = response.headers()['content-security-policy'];
    assert.match(csp, /style-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    await page.waitForFunction(() => document.querySelector('#preview-app')?.dataset.assetsReady === 'true');

    const metrics = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      screenCount: document.querySelectorAll('.phone-screen').length,
      screenBounds: [...document.querySelectorAll('.phone-screen')]
        .filter(node => getComputedStyle(node).display !== 'none')
        .map(node => {
          const { width, height } = node.getBoundingClientRect();
          return { width, height };
        }),
      captureDisabled: document.querySelector('#capture-preview').disabled,
      assetStatus: document.querySelector('#asset-status').textContent,
      assetsReady: document.querySelector('#preview-app').dataset.assetsReady === 'true',
      visualApproval: document.querySelector('#preview-app').dataset.visualApproval,
      images: [...document.querySelectorAll('img[data-asset-target]')].map(image => ({
        target: image.dataset.assetTarget,
        hidden: image.hidden,
        decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
      })),
      inlineStyles: document.querySelectorAll('[style]').length,
    }));
    assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1, `${viewport.width}: document overflow`);
    assert.ok(metrics.bodyWidth <= metrics.viewportWidth + 1, `${viewport.width}: body overflow`);
    assert.equal(metrics.screenCount, 3);
    assert.deepEqual(metrics.screenBounds, [{ width: 320, height: 760 }]);
    assert.equal(metrics.captureDisabled, false);
    assert.equal(metrics.assetsReady, true);
    assert.equal(metrics.visualApproval, 'pending', 'asset loading must not approve visual assets');
    assert.equal(metrics.assetStatus, '素材已载入，待视觉确认');
    assert.equal(metrics.inlineStyles, 0, 'CSP disallows inline styles');
    assert.ok(metrics.images.every(image => !image.hidden && image.decoded), 'all repeated targets must decode');
    assert.equal(metrics.images.filter(image => image.target === 'battle-scene').length, 2);
    assert.equal(metrics.images.filter(image => image.target === 'player').length, 2);

    for (const screen of ['battle', 'start', 'choice']) {
      await page.getByRole('button', {
        name: screen === 'choice' ? '法宝' : screen === 'start' ? '开局' : '战斗',
        exact: true,
      }).click();
      const viewportState = await page.locator(`[data-screen="${screen}"]`).evaluate(node => {
        const screenRect = node.getBoundingClientRect();
        const controls = [...node.querySelectorAll(
          'button, input',
        )].filter(control => getComputedStyle(control).display !== 'none').map(control => {
          const rect = control.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            left: rect.left - screenRect.left,
            right: rect.right - screenRect.left,
            top: rect.top - screenRect.top,
            bottom: rect.bottom - screenRect.top,
          };
        });
        return {
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          controls,
        };
      });
      assert.equal(viewportState.scrollWidth, viewportState.clientWidth, `${screen}: screen overflow`);
      assert.ok(viewportState.controls.length > 0, `${screen}: expected controls`);
      assert.ok(viewportState.controls.every(control =>
        control.width >= 44 && control.height >= 44 &&
        control.left >= -1 && control.right <= 321 && control.top >= -1 && control.bottom <= 761),
      `${screen}: control outside screen or below touch target size`);

      if (screen === 'battle') {
        const bars = await page.locator('.unit-status').evaluateAll(units =>
          units.map(unit => {
            const combined = unit.querySelector('.combined-meter');
            return {
              name: unit.querySelector('.unit-name').textContent,
              method: unit.querySelector('.unit-method').textContent,
              bars: unit.querySelectorAll('.meter').length,
              hpShieldSegments: unit.querySelectorAll('.combined-meter .meter-segment').length,
              hpShieldMaximum: combined.getAttribute('aria-valuemax'),
              hpShieldValue: combined.getAttribute('aria-valuenow'),
              labels: [...unit.querySelector('.unit-meter-labels').children]
                .map(label => label.textContent.trim()),
            };
          }),
        );
        assert.deepEqual(bars, [
          {
            name: '方寄云', method: '金刚功', bars: 2, hpShieldSegments: 2,
            hpShieldMaximum: '1100', hpShieldValue: '820', labels: ['气血 640/920', '护盾 180'],
          },
          {
            name: '养锋石卫', method: '养剑诀', bars: 2, hpShieldSegments: 2,
            hpShieldMaximum: '500', hpShieldValue: '394', labels: ['气血 344/450', '护盾 50'],
          },
        ]);
        const segmentFractions = await page.locator('.combined-meter').evaluateAll(meters =>
          meters.map(meter => {
            const width = meter.getBoundingClientRect().width;
            return [...meter.querySelectorAll('.meter-segment')]
              .map(segment => segment.getBoundingClientRect().width / width);
          }),
        );
        const expectedFractions = [[640 / 1100, 180 / 1100], [344 / 500, 50 / 500]];
        for (const [index, fractions] of segmentFractions.entries()) {
          fractions.forEach((fraction, segmentIndex) => {
            assert.ok(
              Math.abs(fraction - expectedFractions[index][segmentIndex]) < 0.005,
              `unit ${index + 1} meter segment ${segmentIndex + 1}: expected current value over combined maximum`,
            );
          });
        }
        assert.equal(await page.locator('button button').count(), 0);

        const speed = page.locator('[data-battle-control="speed"]');
        await speed.click();
        assert.equal(await page.locator('#preview-app').getAttribute('data-preview-speed'), 'fast');
        assert.equal(await speed.getAttribute('aria-label'), '恢复常速');
        await page.locator('[data-battle-control="pause"]').click();
        assert.equal(await page.locator('#preview-app').getAttribute('data-preview-paused'), 'true');
        assert.equal(await page.locator('[data-battle-control="pause"]').textContent(), '继续');
        await page.locator('[data-battle-control="skip"]').click();
        assert.equal(await page.locator('[data-battle-control="skip"]').getAttribute('data-skip-feedback'), 'true');
        await page.locator('[data-open-dialog="battle"]').click();
        await page.locator('#detail-dialog[open]').waitFor();
        assert.match(await page.locator('#dialog-copy').textContent(), /静态界面示例/);
        await page.getByRole('button', { name: '关闭详情' }).click();

        await page.emulateMedia({ reducedMotion: 'reduce' });
        const animation = await page.locator('.battle-actors img').first().evaluate(node =>
          getComputedStyle(node).animationName,
        );
        assert.equal(animation, 'none');
      } else if (screen === 'start') {
        assert.deepEqual(await page.locator('[data-method]').allTextContents(), [
          '金刚功', '归元诀', '回春功', '御火诀', '养剑诀',
        ]);
        const seed = page.locator('input[name="seed"]');
        assert.equal(await seed.getAttribute('type'), 'text');
        assert.equal(await seed.inputValue(), '山海初行');
        assert.equal(await page.locator('input[name="lives"]').count(), 0);
        const cues = [
          ['RKF01', '按防御获得护盾，护盾能反击敌人。'],
          ['RKF02', '怒技返还怒气，加快后续出手。'],
          ['RKF03', '攻击同时治疗，气血越高回复越多。'],
          ['RKF04', '叠加燃烧，让敌人持续受伤。'],
          ['RKF05', '普攻积累剑势，越战越强。'],
        ];
        for (const [id, cue] of cues) {
          await page.locator(`[data-method="${id}"]`).click();
          assert.equal(await page.locator('#method-cue').textContent(), cue);
        }
        await seed.fill('自定义种子-01');
        await page.getByRole('button', { name: '养剑诀', exact: true }).click();
        assert.match(await page.locator('#method-cue').textContent(), /积累剑势/);
        await page.getByRole('button', { name: '踏入山海' }).click();
        await page.locator('#detail-dialog[open]').waitFor();
        assert.match(await page.locator('#dialog-copy').textContent(), /命数种子 自定义种子-01 · 养剑诀/);
        await page.getByRole('button', { name: '关闭详情' }).click();
      } else {
        const cards = page.locator('.artifact-option');
        assert.equal(await cards.count(), 3);
        const cardText = (await cards.allTextContents()).map(text => text.replace(/\s+/g, ' '));
        assert.match(cardText[0], /震岳鼓 防御\+8 盾返后回怒/);
        assert.match(cardText[1], /余烬盏 最大气血\+30 毒燃伤害回怒/);
        assert.match(cardText[2], /定心佩 最大气血\+30 外来削怒减半/);
        const cardBounds = await cards.evaluateAll(options => options.map(option => {
          const { x, y, width, height } = option.getBoundingClientRect();
          return { x, y, width, height };
        }));
        assert.ok(cardBounds[0].y === cardBounds[1].y && cardBounds[1].y === cardBounds[2].y);
        assert.ok(cardBounds[0].x < cardBounds[1].x && cardBounds[1].x < cardBounds[2].x);
        assert.equal(await page.locator('.artifact-details').count(), 3);

        const expectedDetails = [
          ['震岳鼓', /此法宝不提供反击效果/],
          ['余烬盏', /伤害被护盾完全吸收时不触发/],
          ['定心佩', /最高降低100%/],
        ];
        for (const [name, detailPattern] of expectedDetails) {
          await page.getByRole('button', { name: `查看${name}详情` }).click();
          await page.locator('#detail-dialog[open]').waitFor();
          assert.equal(await page.locator('#dialog-title').textContent(), name);
          assert.match(await page.locator('#dialog-copy').textContent(), detailPattern);
          await page.getByRole('button', { name: '关闭详情' }).click();
        }
        await page.getByRole('button', { name: '确认选择' }).click();
        assert.equal(await page.locator('#dialog-title').textContent(), '震岳鼓');
        await page.getByRole('button', { name: '关闭详情' }).click();
      }
    }

    await assertNoPageErrors(page, pageErrors);
    await page.close();
    console.log(`Layout and interaction OK ${viewport.width}x${viewport.height}`);
  }

  const captureNavigationPage = await browser.newPage({ viewport: { width: 320, height: 760 } });
  await mockAssets(captureNavigationPage, { delayMs: 500 });
  await captureNavigationPage.goto(`${origin}/?screen=battle&capture=1`);
  await captureNavigationPage.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.assetsReady === 'false',
  );
  await captureNavigationPage.getByRole('button', { name: '开局', exact: true }).click();
  await captureNavigationPage.waitForFunction(() =>
    document.querySelector('#preview-app')?.dataset.assetsReady === 'true',
  );
  assert.equal(new URL(captureNavigationPage.url()).searchParams.has('capture'), false);
  assert.equal(await captureNavigationPage.locator('#preview-app').getAttribute('data-capture'), null);
  assert.equal(await captureNavigationPage.locator('#preview-app').getAttribute('data-view'), 'start');
  await captureNavigationPage.close();
  console.log('Toolbar navigation clears pending capture mode');

  for (const viewport of [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    await mockAssets(page);
    await page.goto(`${origin}/?screen=choice&capture=1`);
    await page.waitForFunction(() =>
      document.querySelector('#preview-app')?.dataset.capture === 'true',
    );
    const capture = await page.evaluate(() => {
      const screen = document.querySelector('[data-screen="choice"]');
      const bounds = screen.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        screenScrollWidth: screen.scrollWidth,
        screenClientWidth: screen.clientWidth,
        toolbarDisplay: getComputedStyle(document.querySelector('.preview-toolbar')).display,
      };
    });
    assert.deepEqual(
      { width: capture.width, height: capture.height },
      viewport,
      `capture must fill ${viewport.width}x${viewport.height}`,
    );
    assert.ok(capture.documentWidth <= viewport.width + 1);
    assert.ok(capture.bodyWidth <= viewport.width + 1);
    assert.equal(capture.screenScrollWidth, capture.screenClientWidth);
    assert.equal(capture.toolbarDisplay, 'none');
    await page.close();
    console.log(`Capture viewport OK ${viewport.width}x${viewport.height}`);
  }

  const failedAssetPage = await browser.newPage({ viewport: { width: 320, height: 760 } });
  await mockAssets(failedAssetPage, { missing: '/assets/enemy.png' });
  await failedAssetPage.goto(origin);
  await failedAssetPage.waitForFunction(() =>
    document.querySelector('#asset-status')?.textContent === '待装入正式素材',
  );
  assert.equal(await failedAssetPage.locator('#preview-app').getAttribute('data-assets-ready'), 'false');
  assert.equal(await failedAssetPage.locator('#preview-app').getAttribute('data-visual-approval'), 'pending');
  assert.equal(await failedAssetPage.locator('#capture-preview').isDisabled(), true);
  await failedAssetPage.close();
  console.log('Failed asset readiness gate OK');

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await mockAssets(page);
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#preview-app')?.dataset.assetsReady === 'true');
  await page.getByRole('button', { name: '对比' }).click();
  const comparison = await page.locator('.screen-deck').evaluate(node => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    visibleScreens: [...node.querySelectorAll('.phone-screen')]
      .filter(screen => getComputedStyle(screen).display !== 'none').length,
    screenWidths: [...node.querySelectorAll('.phone-screen')]
      .filter(screen => getComputedStyle(screen).display !== 'none')
      .map(screen => screen.getBoundingClientRect().width),
  }));
  assert.equal(comparison.visibleScreens, 3);
  assert.deepEqual(comparison.screenWidths, [320, 320, 320]);
  assert.ok(comparison.scrollWidth <= comparison.clientWidth + 1);
  await page.close();
  console.log('Desktop comparison OK 1440x900');
} finally {
  await browser.close();
  server.close();
  await once(server, 'close');
}
