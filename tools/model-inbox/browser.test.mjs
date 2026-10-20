import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInboxServer } from './server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/tools/browser-tools/node_modules/playwright');
const reportDir = path.resolve(process.env.BROWSER_REPORT_DIR || '/tmp/model-inbox-browser');
const temporary = await fs.mkdtemp(path.join(tmpdir(), 'model-inbox-browser-data-'));
let server;
let browser;
const report = { generatedAt: new Date().toISOString(), checks: [], viewports: [], errors: [] };

async function check(label, callback) {
  await callback();
  report.checks.push(label);
}

async function assertLayout(page, label) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    brandLoaded: document.querySelector('.brand-mark').naturalWidth > 0,
    icons: document.querySelectorAll('svg.lucide').length,
  }));
  assert.ok(geometry.document <= geometry.width + 1, `${label}: document overflow`);
  assert.ok(geometry.body <= geometry.width + 1, `${label}: body overflow`);
  assert.ok(geometry.brandLoaded, `${label}: brand asset blank`);
  assert.ok(geometry.icons > 0, `${label}: icons missing`);
  return geometry;
}

try {
  await fs.mkdir(reportDir, { recursive: true });
  const app = await createInboxServer({ inboxDir: temporary });
  server = app.server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
      '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/status of (401|503)/.test(message.text())) {
      report.errors.push(message.text());
    }
  });
  let apiRequests = 0;
  page.on('request', request => {
    if (request.url().includes('/api/')) apiRequests += 1;
  });

  await check('unauthenticated page makes no API requests and rejects an invalid key', async () => {
    await page.goto(origin);
    await page.locator('#auth-view').waitFor({ state: 'visible' });
    assert.equal(apiRequests, 0);
    await page.locator('#access-key').fill('wrong-key');
    await page.locator('#connect-button').click();
    await page.getByText('访问密钥无效或已失效，请检查后重试。', { exact: true }).waitFor();
  });

  await check('fragment connects, disappears from the URL and is not rendered in page text', async () => {
    await page.goto(`${origin}/#token=${app.token}`);
    await page.locator('#workspace-view').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).hash, '');
    assert.equal((await page.locator('body').innerText()).includes(app.token), false);
    assert.equal(await page.locator('#access-key').inputValue(), '');
  });

  const original = Buffer.from('# 模型修改样本\n仅保存在临时测试收件箱。\n');
  const html = Buffer.from('<script>window.inboxInjected = true</script>');
  const note = '<b>待审查</b>🙂';
  await check('multiple uploads preserve content and notes without interpreting HTML', async () => {
    await page.locator('#file-input').setInputFiles([
      { name: '构筑审查-山海.md', mimeType: 'text/markdown', buffer: original },
      { name: '未应用.html', mimeType: 'text/html', buffer: html },
    ]);
    await page.locator('#upload-note').fill(note);
    await page.locator('#upload-button').click();
    await page.waitForFunction(() => document.querySelectorAll('.queue-status.is-success').length === 2);
    await page.waitForFunction(() => document.querySelectorAll('.record-item').length === 2);
    assert.equal(await page.evaluate(() => window.inboxInjected), undefined);
    const records = await (await fetch(`${origin}/api/uploads`, {
      headers: { Authorization: `Bearer ${app.token}` },
    })).json();
    const record = records.files.find(file => file.originalName === '构筑审查-山海.md');
    assert.equal(record.sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(record.note, note);
    assert.deepEqual(await fs.readFile(path.join(temporary, 'uploads', record.id, 'payload')), original);
    const row = page.locator('.record-item').filter({ hasText: '构筑审查-山海.md' });
    await row.locator('summary').click();
    assert.equal(await row.locator('.record-note').textContent(), note);
    assert.equal(await row.locator('.record-note b').count(), 0);
  });

  await check('authenticated attachment download matches the uploaded bytes', async () => {
    const row = page.locator('.record-item').filter({ hasText: '构筑审查-山海.md' });
    const pending = page.waitForEvent('download');
    await row.getByRole('button', { name: '下载此附件' }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), '构筑审查-山海.md');
    assert.deepEqual(await fs.readFile(await download.path()), original);
  });

  await check('failed uploads retry without re-uploading successful queue entries', async () => {
    let failNext = true;
    await page.route('**/api/uploads', async route => {
      if (route.request().method() === 'POST' && failNext) {
        failNext = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test unavailable"}' });
      } else {
        await route.continue();
      }
    });
    await page.locator('#file-input').setInputFiles({
      name: '失败后重试.patch', mimeType: 'text/plain', buffer: Buffer.from('retry sample'),
    });
    await page.locator('#upload-button').click();
    const row = page.locator('.queue-item').filter({ hasText: '失败后重试.patch' });
    await row.locator('.queue-status.is-error').waitFor();
    await row.getByRole('button', { name: '重试上传' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.record-item').length === 3);
    assert.equal(await page.locator('.queue-status.is-success').count(), 3);
    await page.unroute('**/api/uploads');
  });

  await check('full-length Unicode notes upload without truncating a surrogate pair', async () => {
    const longNote = `${'请'.repeat(1999)}🙂`;
    await page.locator('#upload-note').fill(longNote);
    assert.equal(await page.locator('#note-count').textContent(), '2000 / 2000');
    await page.locator('#file-input').setInputFiles({
      name: '长备注.txt', mimeType: 'text/plain', buffer: Buffer.from('long note'),
    });
    await page.locator('#upload-button').click();
    await page.waitForFunction(() => document.querySelectorAll('.record-item').length === 4);
    const records = await (await fetch(`${origin}/api/uploads`, {
      headers: { Authorization: `Bearer ${app.token}` },
    })).json();
    assert.equal(records.files.find(file => file.originalName === '长备注.txt').note, longNote);
    await page.locator('#upload-note').fill('');
  });

  await check('cancelled uploads remain retryable and never create a record', async () => {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    await page.route('**/api/uploads', async route => {
      if (route.request().method() === 'POST') {
        await blocked;
        await route.abort().catch(() => {});
      } else {
        await route.continue();
      }
    });
    await page.locator('#file-input').setInputFiles({
      name: '取消测试.txt', mimeType: 'text/plain', buffer: Buffer.from('cancel'),
    });
    await page.locator('#upload-button').click();
    const row = page.locator('.queue-item').filter({ hasText: '取消测试.txt' });
    await row.getByRole('button', { name: '取消上传' }).click();
    await row.getByText('已取消，可重试', { exact: true }).waitFor();
    release();
    await page.unroute('**/api/uploads');
    await row.getByRole('button', { name: '移除此文件' }).click();
    assert.equal(await page.locator('.record-item').count(), 4);
  });

  await check('refresh in flight cannot reconnect after the user clears the access key', async () => {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    await page.route('**/api/uploads', async route => {
      await blocked;
      await route.continue();
    });
    await page.locator('#refresh-records').click();
    await page.locator('#change-key').click();
    release();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#workspace-view').isHidden(), true);
    await page.unroute('**/api/uploads');
    await page.goto(`${origin}/#token=${app.token}`);
    await page.locator('#workspace-view').waitFor({ state: 'visible' });
  });

  for (const [width, height] of [[360, 780], [390, 844], [1280, 720], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const label = `${width}x${height}`;
    report.viewports.push({ label, ...await assertLayout(page, label) });
    await page.screenshot({ path: path.join(reportDir, `${label}.png`), fullPage: true });
  }
  await check('refresh retains the current tab session', async () => {
    await page.reload();
    await page.locator('#workspace-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.record-item').count(), 4);
  });
  assert.deepEqual(report.errors, []);
  report.ok = true;
  console.log(`Model inbox browser: ${report.checks.length} checks, ${report.viewports.length} viewports passed.`);
} finally {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await fs.rm(temporary, { recursive: true, force: true });
}
