import { setDefaultResultOrder } from 'node:dns';
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { discoverScriptLinks, extractReferenceData } from './extract.mjs';
import { validateCatalog } from './validate.mjs';

const ENTRY_URL = 'https://www.datawxq.com/lineups';
const DATABASE_URL = 'https://www.datawxq.com/database';
const SOURCE_ORIGIN = new URL(ENTRY_URL).origin;
const MAX_ASSETS = 24;
const MAX_REQUESTS = 80;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 20000;
const RETRIES = 2;

setDefaultResultOrder('ipv4first');

function assertPublicPageUrl(value, expectedPath) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== SOURCE_ORIGIN || url.pathname !== expectedPath
    || url.username || url.password || url.search || url.hash) {
    throw new Error(`Only the public HTTPS ${expectedPath} page can be collected`);
  }
  return url;
}

function resolveAssetUrl(reference, baseUrl) {
  if (typeof reference !== 'string' || reference.length > 2048) return null;
  const normalizedReference = reference.startsWith('assets/') ? `/${reference}` : reference;
  let url;
  try {
    url = new URL(normalizedReference, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== SOURCE_ORIGIN || url.username || url.password
    || !/^\/assets\/[^/]+\.js$/.test(url.pathname) || url.search || url.hash
    || /admin|private|\/auth(?:\/|-|\.|$)/i.test(url.pathname)) {
    return null;
  }
  return url;
}

function moduleScriptUrls(html, pageUrl) {
  const links = [];
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = match[1];
    if (/\bnomodule\b/i.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if ((type?.[1] ?? type?.[2] ?? type?.[3] ?? '').toLowerCase() !== 'module') continue;
    const source = attributes.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = source?.[1] ?? source?.[2] ?? source?.[3];
    const url = raw && resolveAssetUrl(raw, pageUrl);
    if (url) links.push(url);
  }
  return links;
}

async function readLimitedBytes(response, limit, label) {
  const announcedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(announcedLength) && announcedLength > limit) {
    throw new Error(`${label} exceeds the ${limit} byte limit`);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error(`${label} exceeds the ${limit} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizedId(id) {
  return `${typeof id}:${String(id)}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIds(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return compareText(String(left), String(right));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareText)
      .map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalString(value) {
  return JSON.stringify(canonicalValue(value));
}

function collectReferenceObjects(talents, commanders) {
  const references = new Map();
  const add = (value, context) => {
    const id = value && typeof value === 'object' ? value.id : value;
    if (!(Number.isSafeInteger(id) || typeof id === 'string')) return;
    const key = normalizedId(id);
    const entry = references.get(key) ?? { id, records: [], names: new Set(), contexts: new Set() };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      entry.records.push(value);
      if (typeof value.name === 'string' && value.name) entry.names.add(value.name);
    }
    entry.contexts.add(context);
    references.set(key, entry);
  };

  for (const talent of talents) {
    for (const field of ['previewCards', 'sourceCards']) {
      for (const card of talent[field] ?? []) add(card, `talent:${talent.gameType}:${talent.id}:${field}`);
    }
  }
  for (const commander of commanders) {
    for (const section of commander.sections ?? []) {
      for (const entry of section.entries ?? []) {
        add(entry, `commander:${commander.id}:${section.type}:${section.level}`);
      }
    }
    for (const card of commander.relatedCards ?? []) {
      add(card, `commander:${commander.id}:relatedCards`);
    }
  }
  return references;
}

function buildRelatedCards(references, relatedSourceRecords) {
  const sourceRecords = new Map();
  for (const record of relatedSourceRecords) {
    const key = normalizedId(record.id);
    if (!references.has(key)) continue;
    const records = sourceRecords.get(key) ?? new Map();
    records.set(canonicalString(record), record);
    sourceRecords.set(key, records);
  }

  const related = new Map();
  const referenceOnly = [];
  const unresolved = [];
  let fullRecordCount = 0;

  for (const [key, reference] of references) {
    const full = sourceRecords.get(key);
    const foundFullRecords = full ? [...full.values()] : [];
    fullRecordCount += foundFullRecords.length;
    const combined = new Map();
    for (const record of foundFullRecords) combined.set(canonicalString(record), record);
    for (const record of reference.records) combined.set(canonicalString(record), record);

    if (foundFullRecords.length === 0 && reference.names.size > 0) {
      referenceOnly.push({
        id: reference.id,
        names: [...reference.names].sort(compareText),
      });
    } else if (foundFullRecords.length === 0 && combined.size === 0) {
      unresolved.push({
        id: reference.id,
        contexts: [...reference.contexts].sort(compareText),
      });
    }

    for (const [recordKey, record] of combined) related.set(`${key}:${recordKey}`, record);
  }

  const relatedCards = [...related.values()].sort((left, right) =>
    compareText(String(left.type ?? ''), String(right.type ?? ''))
      || compareText(String(left.gameType ?? ''), String(right.gameType ?? ''))
      || compareIds(left.id, right.id)
      || compareText(left.name, right.name));
  referenceOnly.sort((left, right) => compareIds(left.id, right.id));
  unresolved.sort((left, right) => compareIds(left.id, right.id));
  return {
    relatedCards,
    fullRecordCount,
    coverage: {
      reference_ids: references.size,
      full_records: fullRecordCount,
      reference_only: referenceOnly,
      unresolved,
    },
  };
}

function summarizeCounts(talents, commanders, relatedCards) {
  const talentsByMode = { wanxiang: 0, diamond: 0 };
  const talentsByQuality = { '1': 0, '2': 0, '3': 0 };
  const talentsByOfficialVisibility = { visible: 0, hidden: 0 };
  for (const talent of talents) {
    talentsByMode[talent.gameType] += 1;
    talentsByQuality[String(talent.quality)] += 1;
    talentsByOfficialVisibility[talent.visibleOnOfficialSite ? 'visible' : 'hidden'] += 1;
  }
  return {
    talents: talents.length,
    talents_by_mode: talentsByMode,
    talents_by_quality: talentsByQuality,
    talents_by_official_visibility: talentsByOfficialVisibility,
    commanders: commanders.length,
    related_cards: relatedCards.length,
  };
}

async function requestBytes(url, {
  fetchImpl,
  attempts,
  limit,
  label,
}) {
  let lastError;
  for (let retry = 0; retry <= RETRIES; retry += 1) {
    attempts.count += 1;
    if (attempts.count > MAX_REQUESTS) throw new Error(`Collection exceeded the ${MAX_REQUESTS} request limit`);
    try {
      const response = await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        headers: { accept: label === 'page' ? 'text/html' : 'text/javascript, application/javascript, */*;q=0.1' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = new Error(`${label} request returned HTTP ${response.status}: ${url.href}`);
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        const finalUrl = response.url ? new URL(response.url) : url;
        if (finalUrl.origin !== SOURCE_ORIGIN || finalUrl.protocol !== 'https:') {
          throw new Error(`${label} request left the public HTTPS source origin`);
        }
        return await readLimitedBytes(response, limit, url.href);
      }
    } catch (error) {
      if (/request returned HTTP 4\d\d/.test(error?.message ?? '')) throw error;
      lastError = error;
    }
    if (retry < RETRIES) await new Promise((resolve) => setTimeout(resolve, 250 * (retry + 1)));
  }
  throw new Error(`Could not fetch ${url.href} after ${RETRIES + 1} attempts`, { cause: lastError });
}

export async function collectCatalog({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  bundleUrls = [],
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const entryUrl = assertPublicPageUrl(ENTRY_URL, '/lineups');
  const databaseUrl = assertPublicPageUrl(DATABASE_URL, '/database');
  const attempts = { count: 0 };
  const pageTexts = [];

  for (const pageUrl of [entryUrl, databaseUrl]) {
    const bytes = await requestBytes(pageUrl, {
      fetchImpl,
      attempts,
      limit: MAX_PAGE_BYTES,
      label: 'page',
    });
    pageTexts.push({ url: pageUrl, text: new TextDecoder().decode(bytes) });
  }

  const pending = [];
  for (const page of pageTexts) pending.push(...moduleScriptUrls(page.text, page.url));
  for (const bundleUrl of bundleUrls) {
    const url = resolveAssetUrl(bundleUrl, entryUrl);
    if (!url) throw new Error(`Explicit --bundle must be a public same-origin /assets/*.js URL: ${bundleUrl}`);
    pending.push(url);
  }

  const visited = new Set();
  const assets = [];
  const parsedAssets = [];
  while (pending.length > 0) {
    const url = pending.shift();
    if (visited.has(url.href)) continue;
    if (visited.size >= MAX_ASSETS) throw new Error(`Collection exceeded the ${MAX_ASSETS} asset limit`);
    visited.add(url.href);
    const bytes = await requestBytes(url, {
      fetchImpl,
      attempts,
      limit: MAX_ASSET_BYTES,
      label: 'asset',
    });
    const source = new TextDecoder().decode(bytes);
    const data = extractReferenceData(source, { sourceUrl: url.href });
    assets.push({ url: url.href, sha256: sha256(bytes), bytes: bytes.byteLength });
    parsedAssets.push({ data, source, url: url.href });
    const talentModes = new Set(parsedAssets.flatMap(({ data: parsed }) =>
      parsed.talents.map(talent => talent.gameType)));
    const hasTalents = talentModes.has('wanxiang') && talentModes.has('diamond');
    const hasCommanders = parsedAssets.some(({ data: parsed }) => parsed.commanders.length > 0);
    if (hasTalents && hasCommanders) break;
    for (const link of discoverScriptLinks(source, { sourceUrl: url.href })) {
      const child = resolveAssetUrl(link, url);
      if (child && !visited.has(child.href)) pending.push(child);
    }
  }

  const talents = parsedAssets.flatMap(({ data }) => data.talents)
    .sort((left, right) => compareText(left.gameType, right.gameType) || left.id - right.id);
  const commanders = parsedAssets.flatMap(({ data }) => data.commanders)
    .sort((left, right) => left.lordId - right.lordId || left.roleIndex - right.roleIndex
      || compareText(left.id, right.id));
  if (talents.length === 0 || commanders.length === 0) {
    throw new Error('Discovered bundles did not contain both public talent and commander data arrays');
  }

  const references = collectReferenceObjects(talents, commanders);
  const relatedSourceRecords = parsedAssets.flatMap(({ data }) => data.relatedSourceRecords);
  const { relatedCards, coverage } = buildRelatedCards(references, relatedSourceRecords);
  const collectedAt = now();
  const retrievedAt = collectedAt instanceof Date ? collectedAt.toISOString() : new Date(collectedAt).toISOString();
  const catalog = {
    schema_version: 1,
    metadata: {
      source_name: '万象棋大数据',
      entry_url: ENTRY_URL,
      database_url: DATABASE_URL,
      retrieved_at: retrievedAt,
      source_assets: assets.sort((left, right) => compareText(left.url, right.url)),
      counts: summarizeCounts(talents, commanders, relatedCards),
      coverage: {
        talents: { complete: true, includes_hidden: true },
        commanders: { complete: true, sections_preserved: true },
        linked_cards: coverage,
      },
    },
    talents,
    commanders,
    related_cards: relatedCards,
  };
  return validateCatalog(catalog);
}

export async function collectAndWriteCatalog({ outputPath, ...options }) {
  if (!outputPath) throw new Error('outputPath is required');
  const catalog = await collectCatalog(options);
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${dirname(outputPath)}/.${basename(outputPath)}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, serialized, { flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return catalog;
}

export const collectorConstants = Object.freeze({
  entryUrl: ENTRY_URL,
  databaseUrl: DATABASE_URL,
  maxAssets: MAX_ASSETS,
});
