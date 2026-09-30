import { createServer as createHttpServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_ROOT = path.join(moduleRoot, 'public');
const STATIC_FILES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['assets/manifest.json', 'application/json; charset=utf-8'],
]);
const ASSET_NAME = /^assets\/(?:scene-(?:battle|start)|player|enemy|artifact-[a-z0-9-]+)\.(?:png|webp)$/;
const PREVIEW_NAME = /^previews\/(?:start|battle|choice)\.png$/;
const ROOT_MARKER = `${path.sep}public${path.sep}`;

export function resolvePublicPath(requestTarget, publicRoot = PUBLIC_ROOT) {
  if (typeof requestTarget !== 'string' || !requestTarget.startsWith('/') || requestTarget.startsWith('//')) {
    return null;
  }

  const rawPath = requestTarget.split(/[?#]/, 1)[0];
  if (rawPath.includes('\\') || /[\u0000-\u001f\u007f]/.test(rawPath)) return null;

  let segments;
  try {
    segments = rawPath.split('/').slice(1).map(segment => decodeURIComponent(segment));
  } catch {
    return null;
  }

  if (segments.some(segment =>
    segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(segment))) {
    return null;
  }

  const relativePath = segments.filter(Boolean).join('/');
  const normalizedPath = relativePath || 'index.html';
  if (
    !STATIC_FILES.has(normalizedPath) &&
    !ASSET_NAME.test(normalizedPath) &&
    !PREVIEW_NAME.test(normalizedPath)
  ) return null;

  const resolvedRoot = path.resolve(publicRoot);
  const candidate = path.resolve(resolvedRoot, normalizedPath);
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return candidate;
}

function contentTypeFor(filename) {
  const relativePath = path.relative(PUBLIC_ROOT, filename).split(path.sep).join('/');
  const staticContentType = STATIC_FILES.get(relativePath);
  if (staticContentType) return staticContentType;
  if (relativePath.startsWith('assets/')) {
    return filename.endsWith('.webp') ? 'image/webp' : 'image/png';
  }
  if (relativePath.startsWith('previews/')) return 'image/png';
  return undefined;
}

export function createPreviewServer() {
  return createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    const filename = resolvePublicPath(request.url);
    if (!filename) {
      response.writeHead(404).end();
      return;
    }

    try {
      const [root, target, info] = await Promise.all([
        realpath(PUBLIC_ROOT),
        realpath(filename),
        stat(filename),
      ]);
      if (!target.startsWith(`${root}${path.sep}`) || !info.isFile()) {
        response.writeHead(404).end();
        return;
      }

      const contents = request.method === 'HEAD' ? null : await readFile(target);
      response.writeHead(200, {
        'Content-Type': contentTypeFor(filename),
        'Cache-Control': 'no-store',
        'Content-Length': info.size,
      });
      response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isDirectExecution()) {
  const server = createPreviewServer();
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 4174);

  server.listen(port, host, () => {
    console.log(`UI preview listening at http://${host}:${port}/`);
  });
}
