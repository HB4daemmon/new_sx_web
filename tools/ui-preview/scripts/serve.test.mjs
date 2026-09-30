import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createPreviewServer, resolvePublicPath } from './serve.mjs';

const server = createPreviewServer();
let origin;

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('static path resolver only admits public UI and manifest files', () => {
  assert.match(resolvePublicPath('/'), /\/public\/index\.html$/);
  assert.match(resolvePublicPath('/styles.css'), /\/public\/styles\.css$/);
  assert.match(resolvePublicPath('/assets/scene-battle.webp'), /\/public\/assets\/scene-battle\.webp$/);
  assert.match(resolvePublicPath('/assets/artifact-tide-mirror.png'), /\/public\/assets\/artifact-tide-mirror\.png$/);
  assert.equal(resolvePublicPath('/package.json'), null);
  assert.equal(resolvePublicPath('/scripts/serve.mjs'), null);
  assert.equal(resolvePublicPath('/assets/CREDITS.txt'), null);
  assert.equal(resolvePublicPath('/assets/unknown.gif'), null);
});

test('static path resolver rejects traversal, encoded separators, and malformed escapes', () => {
  for (const target of [
    '/../package.json',
    '/%2e%2e/package.json',
    '/assets/%2e%2e/manifest.json',
    '/assets%2f..%2fmanifest.json',
    '/assets%5c..%5cmanifest.json',
    '/assets/%',
    '//example.com/package.json',
  ]) {
    assert.equal(resolvePublicPath(target), null, target);
  }
});

test('HTTP server serves only allowlisted files within public/', async () => {
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const html = await page.text();
  assert.match(html, /id="preview-app"/);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);

  for (const target of [
    '/package.json',
    '/scripts/serve.mjs',
    '/../package.json',
    '/%2e%2e/package.json',
    '/assets/manifest.json/../../package.json',
  ]) {
    const result = await fetch(`${origin}${target}`);
    assert.equal(result.status, 404, target);
  }
});

test('HTTP server serves JSON, PNG, and WebP with correct MIME types for GET and HEAD', async () => {
  for (const [target, contentType] of [
    ['/assets/manifest.json', 'application/json; charset=utf-8'],
    ['/assets/player.png', 'image/png'],
    ['/assets/scene-battle.webp', 'image/webp'],
  ]) {
    const get = await fetch(`${origin}${target}`);
    assert.equal(get.status, 200, `${target}: GET`);
    assert.equal(get.headers.get('content-type'), contentType, `${target}: GET MIME`);
    const body = await get.arrayBuffer();
    const contentLength = Number(get.headers.get('content-length'));
    assert.equal(body.byteLength, contentLength, `${target}: GET content length`);
    if (target.endsWith('.json')) {
      assert.ok(Array.isArray(JSON.parse(new TextDecoder().decode(body)).assets));
    } else {
      assert.ok(body.byteLength > 0, `${target}: expected image bytes`);
    }

    const head = await fetch(`${origin}${target}`, { method: 'HEAD' });
    assert.equal(head.status, 200, `${target}: HEAD`);
    assert.equal(head.headers.get('content-type'), contentType, `${target}: HEAD MIME`);
    assert.equal(Number(head.headers.get('content-length')), contentLength, `${target}: HEAD content length`);
    assert.equal((await head.arrayBuffer()).byteLength, 0, `${target}: HEAD body`);
  }
});
