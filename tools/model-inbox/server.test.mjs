import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createInboxServer } from './server.mjs';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

async function makeFixture(t, { inboxDir, uploadIdleTimeoutMs, limits } = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'model-inbox-test-'));
  const storage = inboxDir ?? join(root, 'inbox');
  const publicDir = join(root, 'public');
  const lucidePath = join(root, 'lucide.js');
  const brandPath = join(root, 'brand.png');
  await fs.mkdir(publicDir, { recursive: true });
  await Promise.all([
    fs.writeFile(join(publicDir, 'index.html'), '<!doctype html><title>inbox</title>'),
    fs.writeFile(join(publicDir, 'app.js'), 'window.fixture = true;'),
    fs.writeFile(join(publicDir, 'style.css'), 'body { color: black; }'),
    fs.writeFile(lucidePath, 'window.lucideFixture = true;'),
    fs.writeFile(brandPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  ]);

  let app;
  const start = async () => {
    app = await createInboxServer({
      inboxDir: storage,
      publicDir,
      lucidePath,
      brandPath,
      ...(uploadIdleTimeoutMs === undefined ? {} : { uploadIdleTimeoutMs }),
      ...(limits === undefined ? {} : { limits }),
    });
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    const address = app.server.address();
    return {
      origin: `http://127.0.0.1:${address.port}`,
      token: app.token,
      server: app.server,
    };
  };
  const close = async () => {
    if (app?.server.listening) {
      await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  };
  t.after(async () => {
    await close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, storage, start, close };
}

function auth(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function upload(origin, token, name, body, { note = '', headers = {} } = {}) {
  return fetch(`${origin}/api/uploads`, {
    method: 'POST',
    headers: {
      ...auth(token),
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
      'X-Upload-Note': encodeURIComponent(note),
      ...headers,
    },
    body,
  });
}

function rawRequest(origin, path, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    let hasResponse = false;
    request.once('response', () => {
      hasResponse = true;
    });
    request.once('error', (error) => {
      if (!hasResponse) reject(error);
    });
    if (body) request.write(body);
    request.end();
  });
}

function openChunkedUpload(origin, token, name = 'chunked.bin') {
  const url = new URL('/api/uploads', origin);
  const request = httpRequest({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
      'Transfer-Encoding': 'chunked',
    },
  });
  const response = new Promise((resolve, reject) => {
    let hasResponse = false;
    request.once('response', (res) => {
      hasResponse = true;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.once('error', (error) => {
      if (!hasResponse) reject(error);
    });
  });
  request.flushHeaders();
  return { request, response };
}

test('all API routes require bearer auth and return bounded private usage', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();

  const unauthenticated = await fetch(`${origin}/api/uploads`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get('www-authenticate'), 'Bearer');
  assert.equal(unauthenticated.headers.get('access-control-allow-origin'), null);
  assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');
  assert.equal(unauthenticated.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(unauthenticated.headers.get('referrer-policy'), 'no-referrer');
  assert.match(unauthenticated.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(unauthenticated.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(unauthenticated.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.deepEqual(await unauthenticated.json(), { error: 'Bearer token required' });

  const listed = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), {
    files: [],
    limits: {
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES,
      maxFiles: 200,
    },
    usage: { bytes: 0, files: 0 },
  });
  const queryToken = await fetch(`${origin}/api/uploads?token=${encodeURIComponent(token)}`);
  assert.equal(queryToken.status, 401);
});

test('API rejects cross-site origins and fetch metadata but accepts the matching host origin', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();

  const crossOrigin = await fetch(`${origin}/api/uploads`, {
    headers: auth(token, { Origin: 'http://attacker.invalid' }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), { error: 'Request origin is not allowed' });

  const crossSite = await fetch(`${origin}/api/uploads`, {
    headers: auth(token, { 'Sec-Fetch-Site': 'cross-site' }),
  });
  assert.equal(crossSite.status, 403);

  const sameOrigin = await fetch(`${origin}/api/uploads`, {
    headers: auth(token, { Origin: origin, 'Sec-Fetch-Site': 'same-origin' }),
  });
  assert.equal(sameOrigin.status, 200);
});

test('Unicode uploads persist metadata, calculate SHA-256 and download only as an attachment', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();
  const name = '山海-模型🗻.html';
  const note = '由测试上传的样本';
  const contents = Buffer.from('<script>window.wasExecuted = true</script>', 'utf8');
  const response = await upload(origin, token, name, contents, { note });

  assert.equal(response.status, 201);
  const { file } = await response.json();
  assert.equal(file.originalName, name);
  assert.equal(file.note, note);
  assert.equal(file.size, contents.length);
  assert.equal(file.sha256, createHash('sha256').update(contents).digest('hex'));
  assert.match(file.id, /^[0-9a-f-]{36}$/);
  assert.ok(file.uploadedAt);

  const download = await fetch(`${origin}/api/uploads/${file.id}/download`, { headers: auth(token) });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), contents);

  const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
  assert.deepEqual((await listing.json()).files, [file]);
});

test('token survives restart and startup removes incomplete upload directories', async (t) => {
  const fixture = await makeFixture(t);
  const first = await fixture.start();
  const body = Buffer.from('persistent sample');
  const created = await upload(first.origin, first.token, 'sample.bin', body);
  const metadata = (await created.json()).file;
  await fixture.close();

  const partialId = randomUUID();
  const partialDir = join(fixture.storage, 'uploads', partialId);
  await fs.mkdir(partialDir, { recursive: true });
  await fs.writeFile(join(partialDir, 'payload.partial'), 'not complete');

  const second = await fixture.start();
  assert.equal(second.token, first.token);
  assert.equal((await fs.readFile(join(fixture.storage, 'access-token'), 'utf8')), first.token);
  const stat = await fs.stat(join(fixture.storage, 'access-token'));
  assert.equal(stat.mode & 0o777, 0o600);
  const listing = await fetch(`${second.origin}/api/uploads`, { headers: auth(second.token) });
  assert.deepEqual((await listing.json()).files, [metadata]);
  await assert.rejects(fs.lstat(partialDir), { code: 'ENOENT' });
});

test('full-length Chinese and emoji notes fit request headers and preserve all code points', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();
  const name = `${'山'.repeat(197)}.md`;
  for (const note of ['请'.repeat(2000), '🙂'.repeat(2000)]) {
    const response = await upload(origin, token, name, Buffer.from('note sample'), { note });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).file.note, note);
  }
  const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
  const { files } = await listing.json();
  assert.equal(files.length, 2);
  assert.notEqual(files[0].id, files[1].id, 'same names must not overwrite earlier uploads');
});

test('invalid content types, malformed headers, traversal and overlong names are rejected', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();

  for (const name of ['../secret', '..', 'a/b', 'a\\b', 'bad\u0000name', 'x'.repeat(201)]) {
    const response = await upload(origin, token, name, Buffer.from('ignored'));
    assert.equal(response.status, 400, name);
  }
  const malformed = await rawRequest(origin, '/api/uploads', {
    method: 'POST',
    headers: {
      ...auth(token),
      'Content-Type': 'application/octet-stream',
      'X-File-Name': '%E0%A4%A',
    },
  });
  assert.equal(malformed.status, 400);
  const wrongType = await upload(origin, token, 'payload.bin', Buffer.from('x'), {
    headers: { 'Content-Type': 'text/html' },
  });
  assert.equal(wrongType.status, 400);

  const note = await upload(origin, token, 'payload.bin', Buffer.from('x'), { note: 'n'.repeat(2001) });
  assert.equal(note.status, 400);
  const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
  assert.deepEqual((await listing.json()).files, []);
});

test('declared and streamed payload size limits reject uploads and clean partial files', async (t) => {
  const maxFileBytes = 1024;
  const fixture = await makeFixture(t, {
    limits: { maxFileBytes, maxTotalBytes: 2048 },
  });
  const { origin, token } = await fixture.start();
  const declared = await rawRequest(origin, '/api/uploads', {
    method: 'POST',
    headers: {
      ...auth(token),
      'Content-Type': 'application/octet-stream',
      'X-File-Name': 'large.bin',
      'Content-Length': String(maxFileBytes + 1),
    },
    body: Buffer.alloc(maxFileBytes + 1),
  });
  assert.equal(declared.status, 413);
  assert.deepEqual(JSON.parse(declared.body.toString()), { error: 'File is too large' });

  const streamed = openChunkedUpload(origin, token, 'streamed-large.bin');
  const chunk = Buffer.alloc(maxFileBytes);
  if (!streamed.request.write(chunk)) {
    await new Promise((resolve) => streamed.request.once('drain', resolve));
  }
  streamed.request.write(Buffer.from([0]));
  streamed.request.end();
  const result = await streamed.response;
  assert.equal(result.status, 413);
  assert.deepEqual(JSON.parse(result.body.toString()), { error: 'File is too large' });

  const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
  assert.deepEqual((await listing.json()).usage, { bytes: 0, files: 0 });
  assert.deepEqual(await fs.readdir(join(fixture.storage, 'uploads')), []);
});

test('aggregate byte and file-count quotas reject additional uploads', async (t) => {
  const limits = { maxFileBytes: 10, maxTotalBytes: 3, maxFiles: 2 };
  const fixture = await makeFixture(t, { limits });
  const { origin, token } = await fixture.start();

  const fullBytes = await upload(origin, token, 'three.bin', Buffer.from('123'));
  assert.equal(fullBytes.status, 201);
  const overBytes = await upload(origin, token, 'one-more.bin', Buffer.from('4'));
  assert.equal(overBytes.status, 507);
  assert.deepEqual(await overBytes.json(), { error: 'Inbox storage limit reached' });

  const empty = await upload(origin, token, 'empty.bin', Buffer.alloc(0));
  assert.equal(empty.status, 201);
  const overFiles = await upload(origin, token, 'too-many.bin', Buffer.alloc(0));
  assert.equal(overFiles.status, 507);
  assert.deepEqual(await overFiles.json(), { error: 'Inbox file limit reached' });

  const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
  assert.deepEqual((await listing.json()).usage, { bytes: 3, files: 2 });
});

test('only two uploads may be active at once', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();
  const first = openChunkedUpload(origin, token, 'first.bin');
  first.request.write(Buffer.from('a'));
  await delay(25);
  const second = openChunkedUpload(origin, token, 'second.bin');
  second.request.write(Buffer.from('b'));
  await delay(25);

  const third = await upload(origin, token, 'third.bin', Buffer.from('c'));
  assert.equal(third.status, 429);
  assert.deepEqual(await third.json(), { error: 'Too many active uploads' });

  first.request.end();
  second.request.end();
  const results = await Promise.all([first.response, second.response]);
  assert.deepEqual(results.map((result) => result.status), [201, 201]);
});

test('disconnecting during an upload removes temporary data and releases quota', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();
  const stalled = openChunkedUpload(origin, token, 'interrupted.bin');
  stalled.response.catch(() => {});
  stalled.request.write(Buffer.alloc(1024));
  await delay(30);
  stalled.request.destroy();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(20);
    const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
    if ((await listing.json()).usage.files === 0) break;
  }
  const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
  assert.deepEqual((await listing.json()).usage, { bytes: 0, files: 0 });
  assert.deepEqual(await fs.readdir(join(fixture.storage, 'uploads')), []);
});

test('slow uploads time out and release active reservations', async (t) => {
  const fixture = await makeFixture(t, { uploadIdleTimeoutMs: 50 });
  const { origin, token } = await fixture.start();
  const stalled = openChunkedUpload(origin, token, 'slow.bin');
  const response = await stalled.response;
  assert.equal(response.status, 408);
  assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Upload timed out' });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
    const { usage } = await listing.json();
    if (usage.files === 0 && (await fs.readdir(join(fixture.storage, 'uploads'))).length === 0) break;
    await delay(20);
  }
  const listing = await fetch(`${origin}/api/uploads`, { headers: auth(token) });
  assert.deepEqual((await listing.json()).usage, { bytes: 0, files: 0 });
  assert.deepEqual(await fs.readdir(join(fixture.storage, 'uploads')), []);
});

test('public routing is explicit and private storage and symlinks are never served', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();
  const staticPaths = ['/', '/app.js', '/style.css', '/lucide.js', '/brand.png'];
  for (const route of staticPaths) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const route of ['/uploads/secret', '/access-token', '/var/model-inbox/access-token', '/%2e%2e/server.mjs']) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 404, route);
  }

  const sentinel = join(fixture.root, 'outside-secret.html');
  await fs.writeFile(sentinel, 'private sentinel');
  const created = await upload(origin, token, 'safe.txt', Buffer.from('original'));
  const { file } = await created.json();
  const payloadPath = join(fixture.storage, 'uploads', file.id, 'payload');
  await fs.unlink(payloadPath);
  await fs.symlink(sentinel, payloadPath);

  const download = await fetch(`${origin}/api/uploads/${file.id}/download`, { headers: auth(token) });
  assert.equal(download.status, 404);
  assert.notEqual(await download.text(), 'private sentinel');
});

test('unknown and delete routes do not expose stored files or add a deletion API', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();
  const created = await upload(origin, token, 'keep.bin', Buffer.from('keep'));
  const { file } = await created.json();

  const deleted = await fetch(`${origin}/api/uploads/${file.id}`, {
    method: 'DELETE',
    headers: auth(token),
  });
  assert.equal(deleted.status, 404);
  const malformedId = await fetch(`${origin}/api/uploads/../../access-token/download`, { headers: auth(token) });
  assert.notEqual(malformedId.status, 200);
  const download = await fetch(`${origin}/api/uploads/${file.id}/download`, { headers: auth(token) });
  assert.equal(download.status, 200);
});

test('download rejects a symlink replacing the upload directory', async (t) => {
  const fixture = await makeFixture(t);
  const { origin, token } = await fixture.start();
  const created = await upload(origin, token, 'safe.txt', Buffer.from('private'));
  const { file } = await created.json();
  const outside = join(fixture.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(join(outside, 'payload'), 'private');
  const directory = join(fixture.storage, 'uploads', file.id);
  await fs.rm(directory, { recursive: true });
  await fs.symlink(outside, directory);
  const response = await fetch(`${origin}/api/uploads/${file.id}/download`, { headers: auth(token) });
  assert.equal(response.status, 404);
  assert.notEqual(await response.text(), 'private');
});
