import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(MODULE_DIR, '../..');
const DEFAULT_INBOX_DIR = join(REPO_DIR, 'var', 'model-inbox');
const DEFAULT_PUBLIC_URL = 'http://localhost:4175/';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_ACTIVE_UPLOADS = 2;
const UPLOAD_IDLE_TIMEOUT_MS = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const FILE_FLAGS = fsConstants.O_RDONLY | NOFOLLOW;
const WRITE_FLAGS = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NOFOLLOW;
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});
const LIMITS = Object.freeze({
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxFiles: MAX_FILES,
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body, { close = false, headers = {} } = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    ...(close ? { Connection: 'close' } : {}),
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message, options) {
  sendJson(res, status, { error: message }, options);
}

function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

async function ensurePrivateDirectory(path) {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Invalid private storage directory');
  }
  await fs.chmod(path, 0o700);
}

async function loadOrCreateToken(inboxDir) {
  const tokenPath = join(inboxDir, 'access-token');
  try {
    const handle = await fs.open(tokenPath, FILE_FLAGS);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Invalid access token file');
      const token = (await handle.readFile({ encoding: 'utf8' })).trim();
      if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid access token file');
      await handle.chmod(0o600);
      return token;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const token = randomBytes(32).toString('base64url');
  let handle;
  try {
    handle = await fs.open(tokenPath, WRITE_FLAGS, 0o600);
    await handle.writeFile(token, 'utf8');
    await handle.sync();
    return token;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return loadOrCreateToken(inboxDir);
  } finally {
    await handle?.close();
  }
}

function isMetadata(value, expectedId, maxFileBytes) {
  return value
    && value.id === expectedId
    && typeof value.originalName === 'string'
    && Array.from(value.originalName).length > 0
    && Array.from(value.originalName).length <= 200
    && !/[\p{Cc}/\\]/u.test(value.originalName)
    && !value.originalName.includes('..')
    && typeof value.size === 'number'
    && Number.isSafeInteger(value.size)
    && value.size >= 0
    && value.size <= maxFileBytes
    && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.uploadedAt === 'string'
    && !Number.isNaN(Date.parse(value.uploadedAt))
    && typeof value.note === 'string'
    && Array.from(value.note).length <= 2000;
}

async function readRegularFile(path, maxBytes = Infinity) {
  const handle = await fs.open(path, FILE_FLAGS);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid file');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function removeEntry(path) {
  await fs.rm(path, { recursive: true, force: true });
}

async function loadUploads(uploadsDir, maxFileBytes) {
  await ensurePrivateDirectory(uploadsDir);
  const files = new Map();
  let bytes = 0;

  for (const entry of await fs.readdir(uploadsDir, { withFileTypes: true })) {
    const id = entry.name;
    const dir = join(uploadsDir, id);
    if (!UUID_PATTERN.test(id) || !entry.isDirectory() || entry.isSymbolicLink()) {
      await removeEntry(dir);
      continue;
    }

    try {
      const dirStat = await fs.lstat(dir);
      const payloadStat = await fs.lstat(join(dir, 'payload'));
      const metadataStat = await fs.lstat(join(dir, 'metadata.json'));
      const children = await fs.readdir(dir);
      if (
        !dirStat.isDirectory()
        || dirStat.isSymbolicLink()
        || !payloadStat.isFile()
        || payloadStat.isSymbolicLink()
        || !metadataStat.isFile()
        || metadataStat.isSymbolicLink()
        || children.length !== 2
        || !children.includes('payload')
        || !children.includes('metadata.json')
      ) {
        throw new Error('Incomplete upload');
      }
      const metadata = JSON.parse((await readRegularFile(join(dir, 'metadata.json'), 64 * 1024)).toString('utf8'));
      if (!isMetadata(metadata, id, maxFileBytes) || payloadStat.size !== metadata.size) {
        throw new Error('Invalid upload metadata');
      }
      await fs.chmod(dir, 0o700);
      await fs.chmod(join(dir, 'payload'), 0o600);
      await fs.chmod(join(dir, 'metadata.json'), 0o600);
      files.set(id, Object.freeze(metadata));
      bytes += metadata.size;
    } catch {
      await removeEntry(dir);
    }
  }

  return { files, bytes };
}

function isAuthorized(req, expectedTokenHash) {
  const authorization = req.headers.authorization;
  const match = typeof authorization === 'string'
    ? /^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(authorization)
    : null;
  const candidateHash = hashToken(match?.[1] ?? '');
  const authorized = timingSafeEqual(candidateHash, expectedTokenHash);
  return Boolean(match && authorized);
}

function isSameOriginRequest(req) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite.trim().toLowerCase() === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string' || origin === 'null') return false;

  try {
    const originUrl = new URL(origin);
    const host = req.headers.host;
    if (!host || originUrl.origin !== origin || originUrl.username || originUrl.password) return false;
    const requestUrl = new URL(`http://${host}`);
    if (requestUrl.username || requestUrl.password || requestUrl.host.toLowerCase() !== host.toLowerCase()) return false;
    return originUrl.protocol === 'http:' && originUrl.host.toLowerCase() === requestUrl.host.toLowerCase();
  } catch {
    return false;
  }
}

function decodeHeaderValue(value, { optional = false } = {}) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid encoded header');
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'Invalid encoded header');
  }
}

function validateFileName(encodedName) {
  const originalName = decodeHeaderValue(encodedName);
  const characterCount = Array.from(originalName).length;
  if (
    characterCount < 1
    || characterCount > 200
    || /[\p{Cc}/\\]/u.test(originalName)
    || originalName.includes('..')
  ) {
    throw new HttpError(400, 'Invalid file name');
  }
  return originalName;
}

function safeFileNameStar(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function getRequestUrl(req) {
  try {
    return new URL(req.url, 'http://model-inbox.invalid');
  } catch {
    throw new HttpError(400, 'Invalid request');
  }
}

function handleStatic(req, res, pathname, options) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Method not allowed', { headers: { Allow: 'GET, HEAD' } });
    req.resume();
    return;
  }

  const asset = options.staticAssets.get(pathname);
  if (!asset) {
    sendError(res, 404, 'Not found');
    req.resume();
    return;
  }

  void (async () => {
    let handle;
    try {
      handle = await fs.open(asset.path, FILE_FLAGS);
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Not a file');
      applySecurityHeaders(res);
      res.writeHead(200, {
        'Content-Type': asset.contentType,
        'Content-Length': info.size,
      });
      if (req.method === 'HEAD') {
        await handle.close();
        res.end();
        return;
      }

      const stream = handle.createReadStream({ autoClose: true });
      stream.on('error', () => {
        if (!res.headersSent) sendError(res, 404, 'Not found');
        else res.destroy();
      });
      res.once('close', () => stream.destroy());
      stream.pipe(res);
    } catch {
      await handle?.close().catch(() => {});
      if (res.headersSent) res.destroy();
      else sendError(res, 404, 'Not found');
    }
  })();
}

function requestContentLength(req, maxFileBytes) {
  const value = req.headers['content-length'];
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HttpError(400, 'Invalid content length');
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new HttpError(400, 'Invalid content length');
  if (length > maxFileBytes) throw new HttpError(413, 'File is too large');
  return length;
}

function validateUploadHeaders(req) {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/octet-stream') {
    throw new HttpError(400, 'Content-Type must be application/octet-stream');
  }
  const contentEncoding = req.headers['content-encoding'];
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    throw new HttpError(400, 'Content-Encoding is not supported');
  }

  const originalName = validateFileName(req.headers['x-file-name']);
  const note = decodeHeaderValue(req.headers['x-upload-note'], { optional: true });
  if (Array.from(note).length > 2000) throw new HttpError(400, 'Upload note is too long');
  return { originalName, note };
}

function createUploadHandler(state, req, res) {
  let contentLength;
  let metadataFields;
  try {
    contentLength = requestContentLength(req, state.limits.maxFileBytes);
    metadataFields = validateUploadHeaders(req);
  } catch (error) {
    req.resume();
    sendError(res, error instanceof HttpError ? error.status : 400, error instanceof HttpError ? error.message : 'Invalid upload', { close: true });
    return;
  }

  if (state.activeUploads >= MAX_ACTIVE_UPLOADS) {
    req.resume();
    sendError(res, 429, 'Too many active uploads', { close: true });
    return;
  }
  if (state.files.size + state.reservedFiles >= state.limits.maxFiles) {
    req.resume();
    sendError(res, 507, 'Inbox file limit reached', { close: true });
    return;
  }
  if (contentLength !== null && state.bytes + state.reservedBytes + contentLength > state.limits.maxTotalBytes) {
    req.resume();
    sendError(res, 507, 'Inbox storage limit reached', { close: true });
    return;
  }

  state.activeUploads += 1;
  state.reservedFiles += 1;
  req.setTimeout(state.uploadIdleTimeoutMs, () => {
    sendError(res, 408, 'Upload timed out', { close: true });
    res.once('finish', () => req.destroy());
  });

  void (async () => {
    let uploadDir;
    let handle;
    let reserved = 0;
    let committed = false;
    let actualSize = 0;
    let uploadError;
    let responseError;
    const hash = createHash('sha256');
    try {
      const id = randomUUID();
      uploadDir = join(state.uploadsDir, id);
      await fs.mkdir(uploadDir, { mode: 0o700 });
      const temporaryPayloadPath = join(uploadDir, 'payload.partial');
      handle = await fs.open(temporaryPayloadPath, WRITE_FLAGS, 0o600);

      for await (const chunk of req) {
        if (uploadError) continue;
        if (res.destroyed || req.destroyed) throw new HttpError(408, 'Upload interrupted');
        const nextSize = actualSize + chunk.length;
        if (nextSize > state.limits.maxFileBytes) {
          uploadError = new HttpError(413, 'File is too large');
          continue;
        }
        if (state.bytes + state.reservedBytes + chunk.length > state.limits.maxTotalBytes) {
          uploadError = new HttpError(507, 'Inbox storage limit reached');
          continue;
        }

        state.reservedBytes += chunk.length;
        reserved += chunk.length;
        try {
          await handle.writeFile(chunk);
        } catch (error) {
          uploadError = error?.code === 'ENOSPC'
            ? new HttpError(507, 'Inbox storage is unavailable')
            : new HttpError(500, 'Upload could not be stored');
          continue;
        }
        hash.update(chunk);
        actualSize = nextSize;
      }

      if (uploadError) {
        responseError = uploadError;
      } else if (contentLength !== null && contentLength !== actualSize) {
        throw new HttpError(400, 'Content length does not match upload');
      } else if (req.aborted) {
        throw new HttpError(400, 'Upload interrupted');
      } else {
        await handle.sync();
        await handle.close();
        handle = null;
        const payloadPath = join(uploadDir, 'payload');
        await fs.rename(join(uploadDir, 'payload.partial'), payloadPath);

        const metadata = Object.freeze({
          id,
          originalName: metadataFields.originalName,
          size: actualSize,
          sha256: hash.digest('hex'),
          uploadedAt: new Date().toISOString(),
          note: metadataFields.note,
        });
        const metadataTemp = join(uploadDir, 'metadata.partial');
        const metadataHandle = await fs.open(metadataTemp, WRITE_FLAGS, 0o600);
        try {
          await metadataHandle.writeFile(JSON.stringify(metadata), 'utf8');
          await metadataHandle.sync();
        } finally {
          await metadataHandle.close();
        }
        await fs.rename(metadataTemp, join(uploadDir, 'metadata.json'));

        state.files.set(id, metadata);
        state.bytes += actualSize;
        state.reservedBytes -= reserved;
        reserved = 0;
        state.reservedFiles -= 1;
        committed = true;
        sendJson(res, 201, { file: metadata });
      }
    } catch (error) {
      responseError = error instanceof HttpError
        ? error
        : error?.code === 'ENOSPC'
          ? new HttpError(507, 'Inbox storage is unavailable')
          : new HttpError(500, 'Upload could not be stored');
    } finally {
      await handle?.close().catch(() => {});
      state.activeUploads -= 1;
      state.reservedFiles -= committed ? 0 : 1;
      state.reservedBytes -= reserved;
      if (!committed && uploadDir) {
        try {
          await removeEntry(uploadDir);
        } catch {
          console.error('Temporary upload cleanup failed.');
        }
      }
    }
    if (responseError && !req.aborted && !res.destroyed) {
      sendError(res, responseError.status, responseError.message, { close: responseError.status >= 500 });
    }
  })();
}

async function sendDownload(state, res, id) {
  const metadata = state.files.get(id);
  if (!metadata) {
    sendError(res, 404, 'Not found');
    return;
  }

  let handle;
  try {
    const directory = await fs.lstat(join(state.uploadsDir, id));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Invalid upload directory');
    handle = await fs.open(join(state.uploadsDir, id, 'payload'), FILE_FLAGS);
    const info = await handle.stat();
    if (!info.isFile() || info.size !== metadata.size) throw new Error('Invalid payload');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/octet-stream',
      'Content-Length': metadata.size,
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${safeFileNameStar(metadata.originalName)}`,
    });
    const stream = handle.createReadStream({ autoClose: true });
    stream.on('error', () => res.destroy());
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  } catch {
    await handle?.close().catch(() => {});
    if (res.headersSent) res.destroy();
    else sendError(res, 404, 'Not found');
  }
}

async function handleApi(state, req, res, pathname) {
  if (!isSameOriginRequest(req)) {
    sendError(res, 403, 'Request origin is not allowed');
    req.resume();
    return;
  }
  if (!isAuthorized(req, state.expectedTokenHash)) {
    sendError(res, 401, 'Bearer token required', { headers: { 'WWW-Authenticate': 'Bearer' } });
    req.resume();
    return;
  }

  if (pathname === '/api/uploads' && req.method === 'GET') {
    const files = [...state.files.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.id.localeCompare(a.id));
    sendJson(res, 200, {
      files,
      limits: state.limits,
      usage: {
        bytes: state.bytes + state.reservedBytes,
        files: state.files.size + state.reservedFiles,
      },
    });
    return;
  }

  if (pathname === '/api/uploads' && req.method === 'POST') {
    createUploadHandler(state, req, res);
    return;
  }

  const downloadMatch = /^\/api\/uploads\/([0-9a-f-]+)\/download$/.exec(pathname);
  if (downloadMatch && req.method === 'GET') {
    const id = downloadMatch[1];
    if (!UUID_PATTERN.test(id)) {
      sendError(res, 404, 'Not found');
      return;
    }
    await sendDownload(state, res, id);
    return;
  }

  if (pathname === '/api/uploads' || /^\/api\/uploads\/.+\/download$/.test(pathname)) {
    sendError(res, 405, 'Method not allowed');
    req.resume();
    return;
  }
  sendError(res, 404, 'Not found');
  req.resume();
}

export async function createInboxServer({
  inboxDir = process.env.INBOX_DIR || DEFAULT_INBOX_DIR,
  publicDir = join(MODULE_DIR, 'public'),
  lucidePath = join(MODULE_DIR, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.js'),
  brandPath = join(REPO_DIR, 'tools', 'ui-preview', 'public', 'assets', 'icon-lamp.png'),
  uploadIdleTimeoutMs = UPLOAD_IDLE_TIMEOUT_MS,
  limits = LIMITS,
} = {}) {
  const storageDir = resolve(inboxDir);
  const activeLimits = { ...LIMITS, ...limits };
  if (Object.values(activeLimits).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Invalid inbox limits');
  }
  await ensurePrivateDirectory(storageDir);
  const uploadsDir = join(storageDir, 'uploads');
  const [token, loaded] = await Promise.all([
    loadOrCreateToken(storageDir),
    loadUploads(uploadsDir, activeLimits.maxFileBytes),
  ]);
  const staticAssets = new Map([
    ['/', { path: join(publicDir, 'index.html'), contentType: 'text/html; charset=utf-8' }],
    ['/app.js', { path: join(publicDir, 'app.js'), contentType: 'text/javascript; charset=utf-8' }],
    ['/style.css', { path: join(publicDir, 'style.css'), contentType: 'text/css; charset=utf-8' }],
    ['/lucide.js', { path: lucidePath, contentType: 'text/javascript; charset=utf-8' }],
    ['/brand.png', { path: brandPath, contentType: 'image/png' }],
  ]);
  const state = {
    uploadsDir,
    files: loaded.files,
    bytes: loaded.bytes,
    reservedBytes: 0,
    reservedFiles: 0,
    activeUploads: 0,
    expectedTokenHash: hashToken(token),
    uploadIdleTimeoutMs,
    limits: Object.freeze(activeLimits),
  };

  const server = createServer({ maxHeaderSize: 32 * 1024 }, (req, res) => {
    applySecurityHeaders(res);
    let url;
    try {
      url = getRequestUrl(req);
    } catch (error) {
      sendError(res, error.status ?? 400, error.message ?? 'Invalid request');
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      void handleApi(state, req, res, url.pathname).catch(() => {
        sendError(res, 500, 'Request could not be completed', { close: true });
      });
      return;
    }
    handleStatic(req, res, url.pathname, { staticAssets });
  });

  server.headersTimeout = 15_000;
  server.requestTimeout = 5 * 60_000;
  server.keepAliveTimeout = 5_000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return { server, token };
}

async function listen(server, port, host) {
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let server;
  try {
    const port = Number(process.env.PORT || 4175);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('Invalid PORT');
    }
    const host = process.env.HOST || '0.0.0.0';
    const app = await createInboxServer();
    server = app.server;
    await listen(server, port, host);

    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const publicUrl = new URL(process.env.PUBLIC_URL || DEFAULT_PUBLIC_URL);
    if (!process.env.PUBLIC_URL) publicUrl.port = String(actualPort);
    publicUrl.hash = `token=${app.token}`;
    console.log(`Model inbox: ${publicUrl.toString()}`);
  } catch {
    console.error('Model inbox failed to start.');
    if (server?.listening) server.close();
    process.exitCode = 1;
  }
}
