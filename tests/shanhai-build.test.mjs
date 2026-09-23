import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const EXPECTED_ENTITY_COUNT = 152;
const SHANHAI_MODULES = [
  'app.js',
  'battle-presentation.js',
  'combat.js',
  'content.js',
  'localization.js',
  'persistence.js',
  'route-map.js',
  'run.js',
  'types.js',
  'style.css',
];

async function walkTree(directory, relative = '') {
  const files = [];
  const directories = [];
  const symlinks = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      directories.push(entryRelative);
      const child = await walkTree(path.join(directory, entry.name), entryRelative);
      files.push(...child.files);
      directories.push(...child.directories);
      symlinks.push(...child.symlinks);
    } else if (entry.isFile()) {
      files.push(entryRelative);
    } else {
      symlinks.push(entryRelative);
    }
  }
  return { files, directories, symlinks };
}

function directoryPrefixes(files) {
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    parts.pop();
    for (let index = 1; index <= parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'));
    }
  }
  return [...directories].sort();
}

async function readDistributionManifest() {
  return JSON.parse(await readFile(path.join(DIST, 'content/manifest.json'), 'utf8'));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const { port } = address;
  await new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
  return port;
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function startServer(port) {
  const child = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });

  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        const ready = chunk => {
          stdout += chunk;
          if (stdout.includes(`http://localhost:${port}`)) {
            child.stdout.off('data', ready);
            resolve();
          }
        };
        child.stdout.on('data', ready);
        child.once('error', reject);
        child.once('exit', (code, signal) => {
          reject(new Error(`server exited before listening (${code ?? signal})\n${stderr}`));
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        `server did not announce port ${port}\n${stdout}\n${stderr}`,
      )), 5_000)),
    ]);
    return child;
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
}

test('dist contains only the Shanhai Pages artifact and all 152 manifest entities', async () => {
  const manifest = await readDistributionManifest();
  assert.equal(manifest.version, 'shanhai-content-0.1');
  assert.equal(manifest.files.length, EXPECTED_ENTITY_COUNT);
  assert.equal(new Set(manifest.files).size, EXPECTED_ENTITY_COUNT);
  assert.ok(manifest.files.every(file =>
    /^[a-zA-Z0-9/_-]+\.json$/.test(file) && !file.includes('..')));

  const entityFiles = manifest.files.map(file => `content/${file}`);
  const staticFiles = [
    '.nojekyll',
    'art.js',
    'assets/generated/combat-vfx-atlas.webp',
    'index.html',
    'content/manifest.json',
    ...SHANHAI_MODULES.map(file => `shanhai/${file}`),
  ];
  const expectedFiles = [...staticFiles, ...entityFiles].sort();
  const tree = await walkTree(DIST);

  assert.deepEqual(tree.symlinks, []);
  assert.deepEqual(tree.files.sort(), expectedFiles);
  assert.deepEqual(tree.directories.sort(), directoryPrefixes(expectedFiles));

  for (const file of manifest.files) {
    const entityPath = path.join(DIST, 'content', file);
    const entity = JSON.parse(await readFile(entityPath, 'utf8'));
    assert.equal(entity.id, path.basename(file, '.json'), file);
    assert.equal(Object.hasOwn(entity, '__manifest'), false, file);
    assert.equal(Object.hasOwn(entity, '__path'), false, file);
  }

  for (const forbidden of [
    'src',
    'data',
    'data/game.json',
    'PLAY.html',
    'docs',
    '.git',
    '.env',
    'verification',
  ]) {
    assert.equal(tree.files.some(file => file === forbidden || file.startsWith(`${forbidden}/`)), false, forbidden);
    assert.equal(tree.directories.some(directory =>
      directory === forbidden || directory.startsWith(`${forbidden}/`)), false, forbidden);
  }

  for (const forbiddenRootFile of ['PLAY.html', 'data/game.json']) {
    await assert.rejects(readFile(path.join(ROOT, forbiddenRootFile)), error => error?.code === 'ENOENT');
  }
});

test('combat VFX atlas is copied intact to its runtime asset path', async () => {
  const source = await readFile(path.join(ROOT, 'assets/generated/combat-vfx-atlas.webp'));
  const output = await readFile(path.join(DIST, 'assets/generated/combat-vfx-atlas.webp'));

  assert.ok(source.byteLength > 0, 'source combat VFX atlas is empty');
  assert.deepEqual(output, source, 'built combat VFX atlas differs from its source');
  assert.equal(output.toString('ascii', 0, 4), 'RIFF');
  assert.equal(output.toString('ascii', 8, 12), 'WEBP');
});

test('index and ESM content URLs remain relative under a GitHub Pages subpath', async () => {
  const pageUrl = new URL('https://example.github.io/suishi-xiuxian/index.html');
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const scriptSource = html.match(/<script\s+type="module"\s+src="([^"]+)"/)?.[1];
  const stylesheetSource = html.match(/<link\s+rel="stylesheet"\s+href="([^"]+)"/)?.[1];
  assert.equal(scriptSource, './shanhai/app.js');
  assert.equal(stylesheetSource, './shanhai/style.css');
  assert.equal(new URL(scriptSource, pageUrl).pathname, '/suishi-xiuxian/shanhai/app.js');
  assert.equal(new URL(stylesheetSource, pageUrl).pathname, '/suishi-xiuxian/shanhai/style.css');

  const appUrl = new URL(scriptSource, pageUrl);
  const app = await readFile(path.join(DIST, 'shanhai/app.js'), 'utf8');
  const imports = [...app.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(imports.includes('./content.js'));
  assert.ok(imports.includes('../art.js'));
  for (const source of imports) {
    const resolved = new URL(source, appUrl);
    assert.equal(resolved.pathname.startsWith('/suishi-xiuxian/'), true, source);
  }

  const contentBase = app.match(/const CONTENT_BASE = ['"]([^'"]+)['"]/)?.[1];
  assert.equal(contentBase, './content/');
  assert.equal(
    new URL(`${contentBase}manifest.json`, pageUrl).pathname,
    '/suishi-xiuxian/content/manifest.json',
  );
});

test('temporary HTTP server serves public assets and rejects private or traversed paths', async () => {
  const port = await reservePort();
  assert.notEqual(port, 4173);
  const child = await startServer(port);
  const base = `http://127.0.0.1:${port}`;

  try {
    const html = await fetch(`${base}/index.html`);
    assert.equal(html.status, 200);
    assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');

    const manifest = await readDistributionManifest();
    const nestedPath = `/content/${manifest.files[0]}`;
    const nested = await fetch(`${base}${nestedPath}`);
    assert.equal(nested.status, 200);
    assert.equal(nested.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal((await nested.json()).id, path.basename(manifest.files[0], '.json'));

    const module = await fetch(`${base}/shanhai/app.js`);
    assert.equal(module.status, 200);
    assert.equal(module.headers.get('content-type'), 'text/javascript; charset=utf-8');

    const stylesheet = await fetch(`${base}/shanhai/style.css`);
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.headers.get('content-type'), 'text/css; charset=utf-8');

    const atlasSource = await readFile(path.join(ROOT, 'assets/generated/combat-vfx-atlas.webp'));
    const atlas = await fetch(`${base}/assets/generated/combat-vfx-atlas.webp`);
    assert.equal(atlas.status, 200);
    assert.equal(atlas.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await atlas.arrayBuffer()), atlasSource);

    for (const privatePath of [
      '/docs/shanhai/README.md',
      '/.env',
      '/.git/config',
      '/verification/shanhai/report.json',
      '/src/data/game.json',
      '/PLAY.html',
    ]) {
      const response = await fetch(`${base}${privatePath}`);
      assert.equal(response.status, 404, privatePath);
    }

    for (const traversalPath of [
      '/%2e%2e/%2e%2e/package.json',
      '/%2e%2e%2fpackage.json',
      '/%252e%252e/%252e%252e/package.json',
      '/content/%2e%2e%2fpackage.json',
    ]) {
      const response = await fetch(`${base}${traversalPath}`);
      assert.equal(response.status, 404, traversalPath);
    }
  } finally {
    await stopProcess(child);
  }
});
