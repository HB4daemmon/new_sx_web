const TOP_LEVEL_KEYS = ['schema_version', 'metadata', 'talents', 'commanders', 'related_cards'];
const METADATA_KEYS = [
  'source_name',
  'entry_url',
  'database_url',
  'retrieved_at',
  'source_assets',
  'counts',
  'coverage',
];
const COUNT_KEYS = [
  'talents',
  'talents_by_mode',
  'talents_by_quality',
  'talents_by_official_visibility',
  'commanders',
  'related_cards',
];
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} must contain exactly: ${keys.join(', ')}`);
}

function assertSafeTree(value, path = '$') {
  if (typeof value === 'number') {
    assert(Number.isFinite(value), `${path} must be finite`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeTree(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    assert(!DANGEROUS_KEYS.has(key), `${path} contains dangerous key ${key}`);
    assertSafeTree(child, `${path}.${key}`);
  }
}

function assertText(value, label, { allowEmpty = false } = {}) {
  assert(typeof value === 'string' && (allowEmpty || value.length > 0), `${label} must be a${allowEmpty ? '' : ' non-empty'} string`);
}

function validPublicUrl(value, expectedPath, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  assert(url.protocol === 'https:' && url.origin === 'https://www.datawxq.com'
    && url.pathname === expectedPath && !url.username && !url.password,
  `${label} must be the public HTTPS ${expectedPath} URL`);
}

function countTalents(talents) {
  const byMode = { wanxiang: 0, diamond: 0 };
  const byQuality = { '1': 0, '2': 0, '3': 0 };
  const byVisibility = { visible: 0, hidden: 0 };
  for (const talent of talents) {
    byMode[talent.gameType] += 1;
    byQuality[String(talent.quality)] += 1;
    byVisibility[talent.visibleOnOfficialSite ? 'visible' : 'hidden'] += 1;
  }
  return { byMode, byQuality, byVisibility };
}

function validateTalent(talent, index) {
  const label = `talents[${index}]`;
  assert(isRecord(talent), `${label} must be an object`);
  assert(Number.isSafeInteger(talent.id) && talent.id >= 0, `${label}.id must be a non-negative integer`);
  assertText(talent.name, `${label}.name`);
  assert(['wanxiang', 'diamond'].includes(talent.gameType), `${label}.gameType must be wanxiang or diamond`);
  assert(talent.type === 'talent', `${label}.type must be talent`);
  assertText(talent.typeName, `${label}.typeName`);
  assert([1, 2, 3].includes(talent.quality), `${label}.quality must be 1, 2, or 3`);
  assertText(talent.description, `${label}.description`, { allowEmpty: true });
  assertText(talent.cardGetDescription, `${label}.cardGetDescription`, { allowEmpty: true });
  assert(typeof talent.visibleOnOfficialSite === 'boolean', `${label}.visibleOnOfficialSite must be boolean`);
  assert(Array.isArray(talent.keywords), `${label}.keywords must be an array`);
  assert(Array.isArray(talent.labels), `${label}.labels must be an array`);
  assertText(talent.talentStageDescription, `${label}.talentStageDescription`, { allowEmpty: true });
  assert(Array.isArray(talent.previewCards), `${label}.previewCards must be an array`);
  assert(Array.isArray(talent.sourceCards), `${label}.sourceCards must be an array`);
}

function validateCommander(commander, index) {
  const label = `commanders[${index}]`;
  assert(isRecord(commander), `${label} must be an object`);
  assertText(commander.id, `${label}.id`);
  assert(commander.id.startsWith('commander-'), `${label}.id must identify a commander`);
  assert(Number.isSafeInteger(commander.lordId), `${label}.lordId must be an integer`);
  assert(Number.isSafeInteger(commander.roleIndex), `${label}.roleIndex must be an integer`);
  assertText(commander.name, `${label}.name`);
  assertText(commander.quote, `${label}.quote`, { allowEmpty: true });
  assert(Array.isArray(commander.sections), `${label}.sections must be an array`);
  for (const [sectionIndex, section] of commander.sections.entries()) {
    const sectionLabel = `${label}.sections[${sectionIndex}]`;
    assert(isRecord(section), `${sectionLabel} must be an object`);
    assertText(section.type, `${sectionLabel}.type`);
    if (Object.hasOwn(section, 'level')) {
      assert(Number.isSafeInteger(section.level) || typeof section.level === 'string',
        `${sectionLabel}.level must be a string or integer when present`);
    }
    assert(Array.isArray(section.entries), `${sectionLabel}.entries must be an array`);
    for (const [entryIndex, entry] of section.entries.entries()) {
      const entryLabel = `${sectionLabel}.entries[${entryIndex}]`;
      assert(isRecord(entry), `${entryLabel} must be an object`);
      if (Object.hasOwn(entry, 'id')) {
        assert(Number.isSafeInteger(entry.id) || typeof entry.id === 'string',
          `${entryLabel}.id must be a string or integer when present`);
      }
      assertText(entry.name, `${entryLabel}.name`);
      assertText(entry.description, `${entryLabel}.description`, { allowEmpty: true });
      if (Object.hasOwn(entry, 'cardImage')) {
        assertText(entry.cardImage, `${entryLabel}.cardImage`, { allowEmpty: true });
      }
    }
  }
  if (Object.hasOwn(commander, 'relatedCards')) {
    assert(Array.isArray(commander.relatedCards), `${label}.relatedCards must be an array when present`);
  }
}

function validateRelatedCard(card, index) {
  const label = `related_cards[${index}]`;
  assert(isRecord(card), `${label} must be an object`);
  assert(Number.isSafeInteger(card.id) || typeof card.id === 'string', `${label}.id must be a string or integer`);
  assertText(card.name, `${label}.name`);
}

export function validateCatalog(catalog) {
  assertExactKeys(catalog, TOP_LEVEL_KEYS, 'catalog');
  assert(catalog.schema_version === 1, 'schema_version must be 1');
  assert(Array.isArray(catalog.talents) && catalog.talents.length > 0, 'talents must be a non-empty array');
  assert(Array.isArray(catalog.commanders) && catalog.commanders.length > 0, 'commanders must be a non-empty array');
  assert(Array.isArray(catalog.related_cards), 'related_cards must be an array');
  assertSafeTree(catalog);

  const metadata = catalog.metadata;
  assertExactKeys(metadata, METADATA_KEYS, 'metadata');
  assert(metadata.source_name === '万象棋大数据', 'metadata.source_name is not recognized');
  validPublicUrl(metadata.entry_url, '/lineups', 'metadata.entry_url');
  validPublicUrl(metadata.database_url, '/database', 'metadata.database_url');
  assert(typeof metadata.retrieved_at === 'string' && !Number.isNaN(Date.parse(metadata.retrieved_at)),
    'metadata.retrieved_at must be an ISO date');
  assert(new Date(metadata.retrieved_at).toISOString() === metadata.retrieved_at,
    'metadata.retrieved_at must use canonical ISO UTC format');
  assert(Array.isArray(metadata.source_assets) && metadata.source_assets.length > 0,
    'metadata.source_assets must be a non-empty array');
  const assetUrls = new Set();
  for (const [index, asset] of metadata.source_assets.entries()) {
    const label = `metadata.source_assets[${index}]`;
    assertExactKeys(asset, ['url', 'sha256', 'bytes'], label);
    let url;
    try {
      url = new URL(asset.url);
    } catch {
      throw new Error(`${label}.url must be a valid URL`);
    }
    assert(url.protocol === 'https:' && url.origin === 'https://www.datawxq.com'
      && /^\/assets\/[^/]+\.js$/.test(url.pathname) && !url.username && !url.password,
    `${label}.url must be a public same-origin /assets/*.js URL`);
    assert(!assetUrls.has(url.href), `${label}.url must be unique`);
    assetUrls.add(url.href);
    assert(/^[a-f0-9]{64}$/.test(asset.sha256), `${label}.sha256 must be lowercase SHA-256`);
    assert(Number.isSafeInteger(asset.bytes) && asset.bytes > 0, `${label}.bytes must be a positive integer`);
  }

  const counts = metadata.counts;
  assertExactKeys(counts, COUNT_KEYS, 'metadata.counts');
  const talentCounts = countTalents(catalog.talents);
  assert(talentCounts.byMode.wanxiang > 0 && talentCounts.byMode.diamond > 0,
    'Both wanxiang and diamond talent collections are required');
  assert(counts.talents === catalog.talents.length, 'metadata.counts.talents does not match the catalog');
  assertExactKeys(counts.talents_by_mode, ['wanxiang', 'diamond'], 'metadata.counts.talents_by_mode');
  assertExactKeys(counts.talents_by_quality, ['1', '2', '3'], 'metadata.counts.talents_by_quality');
  assertExactKeys(counts.talents_by_official_visibility, ['visible', 'hidden'],
    'metadata.counts.talents_by_official_visibility');
  for (const [key, expected] of Object.entries(talentCounts.byMode)) {
    assert(counts.talents_by_mode[key] === expected, `metadata.counts.talents_by_mode.${key} is incorrect`);
  }
  for (const [key, expected] of Object.entries(talentCounts.byQuality)) {
    assert(counts.talents_by_quality[key] === expected, `metadata.counts.talents_by_quality.${key} is incorrect`);
  }
  for (const [key, expected] of Object.entries(talentCounts.byVisibility)) {
    assert(counts.talents_by_official_visibility[key] === expected,
      `metadata.counts.talents_by_official_visibility.${key} is incorrect`);
  }
  assert(counts.commanders === catalog.commanders.length, 'metadata.counts.commanders does not match the catalog');
  assert(counts.related_cards === catalog.related_cards.length,
    'metadata.counts.related_cards does not match the catalog');

  const talentKeys = new Set();
  catalog.talents.forEach((talent, index) => {
    validateTalent(talent, index);
    const key = `${talent.gameType}:${talent.id}`;
    assert(!talentKeys.has(key), `duplicate talent id ${key}`);
    talentKeys.add(key);
  });

  const commanderIds = new Set();
  catalog.commanders.forEach((commander, index) => {
    validateCommander(commander, index);
    assert(!commanderIds.has(commander.id), `duplicate commander id ${commander.id}`);
    commanderIds.add(commander.id);
  });
  catalog.related_cards.forEach(validateRelatedCard);

  const coverage = metadata.coverage;
  assertExactKeys(coverage, ['talents', 'commanders', 'linked_cards'], 'metadata.coverage');
  assertExactKeys(coverage.talents, ['complete', 'includes_hidden'], 'metadata.coverage.talents');
  assert(coverage.talents.complete === true && coverage.talents.includes_hidden === true,
    'metadata.coverage.talents must state full inclusion, including hidden records');
  assertExactKeys(coverage.commanders, ['complete', 'sections_preserved'], 'metadata.coverage.commanders');
  assert(coverage.commanders.complete === true && coverage.commanders.sections_preserved === true,
    'metadata.coverage.commanders must state full inclusion and preserved sections');
  assertExactKeys(coverage.linked_cards, ['reference_ids', 'full_records', 'reference_only', 'unresolved'],
    'metadata.coverage.linked_cards');
  assert(Number.isSafeInteger(coverage.linked_cards.reference_ids) && coverage.linked_cards.reference_ids >= 0,
    'metadata.coverage.linked_cards.reference_ids must be a non-negative integer');
  assert(Number.isSafeInteger(coverage.linked_cards.full_records) && coverage.linked_cards.full_records >= 0,
    'metadata.coverage.linked_cards.full_records must be a non-negative integer');
  assert(Array.isArray(coverage.linked_cards.reference_only), 'coverage reference_only must be an array');
  assert(Array.isArray(coverage.linked_cards.unresolved), 'coverage unresolved must be an array');
  for (const [index, item] of coverage.linked_cards.reference_only.entries()) {
    const label = `metadata.coverage.linked_cards.reference_only[${index}]`;
    assertExactKeys(item, ['id', 'names'], label);
    assert(Number.isSafeInteger(item.id) || typeof item.id === 'string', `${label}.id must be a string or integer`);
    assert(Array.isArray(item.names) && item.names.every((name) => typeof name === 'string'),
      `${label}.names must be an array of strings`);
  }
  for (const [index, item] of coverage.linked_cards.unresolved.entries()) {
    const label = `metadata.coverage.linked_cards.unresolved[${index}]`;
    assertExactKeys(item, ['id', 'contexts'], label);
    assert(Number.isSafeInteger(item.id) || typeof item.id === 'string', `${label}.id must be a string or integer`);
    assert(Array.isArray(item.contexts) && item.contexts.every((context) => typeof context === 'string'),
      `${label}.contexts must be an array of strings`);
  }

  return catalog;
}
