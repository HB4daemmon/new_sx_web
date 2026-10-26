export const DEFAULT_LIMIT = 20;

export const QUALITY_VALUES = Object.freeze({
  gold: 3,
  silver: 2,
  bronze: 1,
});

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const ANSI_SEQUENCES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export function assertCatalogShape(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new TypeError("Catalog must be a JSON object.");
  }
  if (catalog.schema_version !== 1) {
    throw new TypeError(`Unsupported or missing catalog schema_version: ${String(catalog.schema_version)}.`);
  }
  if (!catalog.metadata || typeof catalog.metadata !== "object" || Array.isArray(catalog.metadata)) {
    throw new TypeError("Catalog metadata must be an object.");
  }
  for (const field of ["talents", "commanders", "related_cards"]) {
    if (!Array.isArray(catalog[field])) {
      throw new TypeError(`Catalog field "${field}" must be an array.`);
    }
  }
  return catalog;
}

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function compareText(left, right) {
  const a = normalizeSearchText(left);
  const b = normalizeSearchText(right);
  if (a < b) return -1;
  if (a > b) return 1;
  const rawA = String(left ?? "");
  const rawB = String(right ?? "");
  return rawA < rawB ? -1 : rawA > rawB ? 1 : 0;
}

function recordMode(record) {
  const value = record?.gameType ?? record?.mode;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numericQuality(record) {
  const value = Number(record?.quality);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function modeOrder(mode) {
  if (mode === "wanxiang") return 0;
  if (mode === "diamond") return 1;
  return 2;
}

function compareRecords(left, right) {
  const leftMode = recordMode(left.record);
  const rightMode = recordMode(right.record);
  return modeOrder(leftMode) - modeOrder(rightMode)
    || compareText(leftMode ?? "", rightMode ?? "")
    || compareText(left.record.name ?? "", right.record.name ?? "")
    || compareText(left.id, right.id)
    || compareText(left.type, right.type)
    || compareText(JSON.stringify(stableValue(left.record)), JSON.stringify(stableValue(right.record)));
}

export function catalogRecords(catalog) {
  assertCatalogShape(catalog);
  return [
    ...catalog.talents.map((record) => ({ type: "talent", record })),
    ...catalog.commanders.map((record) => ({ type: "commander", record })),
    ...catalog.related_cards.map((record) => ({ type: "related", record })),
  ]
    .map((entry) => ({
      ...entry,
      id: String(entry.record?.id ?? ""),
      mode: recordMode(entry.record),
      quality: numericQuality(entry.record),
    }))
    .sort(compareRecords);
}

function stringValues(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringValues(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringValues(item, output);
  }
  return output;
}

export function matchesSearch(record, query) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return false;
  const corpus = normalizeSearchText(stringValues(record).join(" "));
  return terms.every((term) => corpus.includes(term));
}

function passesFilters(entry, filters = {}) {
  if (filters.type && entry.type !== filters.type) return false;
  if (filters.mode && entry.mode !== filters.mode) return false;
  if (filters.quality && (
    !Object.hasOwn(QUALITY_VALUES, filters.quality)
    || entry.quality !== QUALITY_VALUES[filters.quality]
  )) return false;
  return true;
}

export function searchRecords(catalog, query, filters = {}) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) throw new TypeError("Search query must not be empty.");
  return catalogRecords(catalog)
    .filter((entry) => passesFilters(entry, filters))
    .filter((entry) => matchesSearch(entry.record, normalizedQuery));
}

export function paginateRecords(records, limit = DEFAULT_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("Search result limit must be a positive integer.");
  }
  const results = records.slice(0, limit);
  return {
    total: records.length,
    shown: results.length,
    has_more: records.length > results.length,
    results,
  };
}

export function findShowMatches(catalog, identifier, filters = {}) {
  const exact = String(identifier ?? "");
  if (!exact) throw new TypeError("Record ID or exact name must not be empty.");
  return catalogRecords(catalog)
    .filter((entry) => passesFilters(entry, filters))
    .filter((entry) => entry.id === exact || String(entry.record?.name ?? "") === exact);
}

function recordTab(entry) {
  if (entry.type === "talent") return "talents";
  if (entry.type === "commander") return "commanders";
  return {
    hero: "heroes", effect: "effects", equipment: "equipments", talent: "talents",
    1: "heroes", 2: "effects", 5: "equipments", 6: "talents",
  }[entry.record?.type] ?? "commanders";
}

export function sourceUrlFor(entry) {
  const url = new URL("https://www.datawxq.com/database");
  url.searchParams.set("tab", recordTab(entry));
  if (entry.mode) url.searchParams.set("gameType", entry.mode);
  url.searchParams.set("keyword", String(entry.record?.name ?? entry.id ?? ""));
  return url.href;
}

export function catalogProvenance(catalog) {
  const metadata = catalog.metadata ?? {};
  return {
    source_name: metadata.source_name ?? null,
    entry_url: metadata.entry_url ?? null,
    database_url: metadata.database_url ?? null,
    retrieved_at: metadata.retrieved_at ?? null,
    source_assets: Array.isArray(metadata.source_assets) ? metadata.source_assets : [],
  };
}

export function recordPayload(catalog, entry) {
  return {
    type: entry.type,
    id: entry.id,
    mode: entry.mode,
    quality: entry.quality,
    source_url: sourceUrlFor(entry),
    record: entry.record,
    provenance: catalogProvenance(catalog),
  };
}

export function catalogStats(catalog) {
  const entries = catalogRecords(catalog);
  const byMode = { wanxiang: 0, diamond: 0, unspecified: 0 };
  const talentQuality = { gold: 0, silver: 0, bronze: 0, unspecified: 0 };
  for (const entry of entries) {
    byMode[Object.hasOwn(byMode, entry.mode) ? entry.mode : "unspecified"] += 1;
    if (entry.type === "talent") {
      const label = Object.keys(QUALITY_VALUES).find((name) => QUALITY_VALUES[name] === entry.quality);
      talentQuality[label ?? "unspecified"] += 1;
    }
  }
  return {
    total: entries.length,
    talents: catalog.talents.length,
    commanders: catalog.commanders.length,
    related_cards: catalog.related_cards.length,
    by_mode: byMode,
    talent_quality: talentQuality,
  };
}

export function sanitizeTerminal(value) {
  return String(value ?? "")
    .replace(ANSI_SEQUENCES, "")
    .replace(/[\r\n\t]/g, " ")
    .replace(CONTROL_CHARACTERS, " ");
}

export function escapeMarkdown(value) {
  const normalized = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(CONTROL_CHARACTERS, "");
  return normalized
    .split("\n")
    .map((line) => line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/[\\`*_{}\[\]()#+.!>|~-]/g, "\\$&"))
    .join("\n");
}

function scalarText(value) {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return String(value);
}

function sourceValueLines(value, depth = 1) {
  const indent = "  ".repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return [`${indent}- (empty)`];
    return value.flatMap((item, index) => {
      if (item && typeof item === "object") {
        return [`${indent}- Item ${index + 1}`, ...sourceValueLines(item, depth + 1)];
      }
      const lines = scalarText(item).replace(/\r\n?/g, "\n").split("\n");
      return lines.map((line, lineIndex) => `${indent}${lineIndex === 0 ? "- " : "  "}${escapeMarkdown(line)}`);
    });
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort(compareText);
    if (!keys.length) return [`${indent}- (empty object)`];
    return keys.flatMap((key) => {
      const child = value[key];
      const label = `${indent}- **${escapeMarkdown(key)}**`;
      if (child && typeof child === "object") return [label, ...sourceValueLines(child, depth + 1)];
      const lines = scalarText(child).replace(/\r\n?/g, "\n").split("\n");
      if (lines.length === 1) return [`${label}: ${escapeMarkdown(lines[0])}`];
      return [label, ...lines.map((line) => `${"  ".repeat(depth + 1)}> ${escapeMarkdown(line)}`)];
    });
  }
  const lines = scalarText(value).replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line) => `${indent}> ${escapeMarkdown(line)}`);
}

function sourceField(label, value) {
  return [
    `### Source: ${escapeMarkdown(label)}`,
    "",
    ...sourceValueLines(value),
    "",
  ];
}

function renderRemainingFields(record, renderedFields) {
  const remaining = Object.fromEntries(
    Object.entries(record ?? {}).filter(([key]) => !renderedFields.has(key)),
  );
  if (!Object.keys(remaining).length) return [];
  return [
    "### Additional Source Fields",
    "",
    ...sourceValueLines(remaining, 0),
    "",
  ];
}

function safeAnchorPart(value) {
  return String(value ?? "unspecified")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unspecified";
}

function entriesWithAnchors(entries, kind) {
  const counts = new Map();
  return entries.map((entry) => {
    const base = `${kind}-${safeAnchorPart(entry.mode)}-${safeAnchorPart(entry.id)}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return { ...entry, anchor: count === 1 ? base : `${base}-${count}` };
  });
}

function sourceLink(entry) {
  const url = sourceUrlFor(entry);
  return `[Original entry](<${url}>)`;
}

function sourceMetadataLines(entry) {
  return [
    `- Source ID: ${escapeMarkdown(entry.id)}`,
    `- Mode: ${escapeMarkdown(entry.mode ?? "not specified")}`,
    `- Source URL: ${sourceLink(entry)}`,
    "",
  ];
}

function relatedLinkIndex(entries) {
  const anchored = entriesWithAnchors(entries, "related");
  const byId = new Map();
  const byName = new Map();
  const byModeId = new Map();
  for (const entry of anchored) {
    const id = String(entry.record?.id ?? "");
    const name = String(entry.record?.name ?? "");
    const mode = recordMode(entry.record);
    if (id) byId.set(id, [...(byId.get(id) ?? []), entry]);
    if (name) byName.set(name, [...(byName.get(name) ?? []), entry]);
    if (id && mode) {
      const key = `${mode}\u0000${id}`;
      byModeId.set(key, [...(byModeId.get(key) ?? []), entry]);
    }
  }
  return { byId, byName, byModeId };
}

function linkedEntryFor(reference, index) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
  const id = String(reference.id ?? "");
  const mode = recordMode(reference);
  const name = String(reference.name ?? "");
  const modeMatches = mode && id ? index.byModeId.get(`${mode}\u0000${id}`) : null;
  if (modeMatches?.length === 1) return modeMatches[0];
  const idMatches = id ? index.byId.get(id) : null;
  if (idMatches?.length === 1) return idMatches[0];
  const nameMatches = name ? index.byName.get(name) : null;
  return nameMatches?.length === 1 ? nameMatches[0] : null;
}

function localReferenceLines(label, values, index) {
  const references = Array.isArray(values) ? values : [values];
  const targets = [];
  const seen = new Set();
  for (const reference of references) {
    const target = linkedEntryFor(reference, index);
    if (!target || seen.has(target.anchor)) continue;
    seen.add(target.anchor);
    targets.push(target);
  }
  if (!targets.length) return [];
  return [
    `### Local Links: ${escapeMarkdown(label)}`,
    "",
    ...targets.map((target) => (
      `- [${escapeMarkdown(target.record.name ?? target.id)}](RELATED_CARDS.md#${target.anchor})`
    )),
    "",
  ];
}

function pageToc(entries) {
  return entries.map((entry) => `- [${escapeMarkdown(entry.record.name ?? entry.id)}](#${entry.anchor})`).join("\n");
}

function renderTalent(entry, relatedIndex) {
  const record = entry.record ?? {};
  const fields = new Set(["id", "name", "gameType"]);
  const sections = [
    "",
    `<a id="${entry.anchor}"></a>`,
    `## ${escapeMarkdown(record.name ?? entry.id)}`,
    "",
    ...sourceMetadataLines(entry),
  ];
  for (const [label, field] of [["Record Type", "type"], ["Quality", "quality"]]) {
    if (Object.hasOwn(record, field)) {
      fields.add(field);
      sections.push(...sourceField(label, record[field]));
    }
  }
  const detailFields = [
    ["Type Name", "typeName"],
    ["Description", "description"],
    ["Acquisition Requirements", "cardGetDescription"],
    ["Official Site Visibility", "visibleOnOfficialSite"],
    ["Keywords", "keywords"],
    ["Labels", "labels"],
    ["Talent Stage Description", "talentStageDescription"],
    ["Group", "group"],
    ["Preview Cards", "previewCards"],
    ["Source Cards", "sourceCards"],
  ];
  for (const [label, field] of detailFields) {
    if (Object.hasOwn(record, field)) {
      fields.add(field);
      sections.push(...sourceField(label, record[field]));
      if (field === "previewCards" || field === "sourceCards") {
        sections.push(...localReferenceLines(label, record[field], relatedIndex));
      }
    }
  }
  sections.push(...renderRemainingFields(record, fields));
  return sections;
}

function renderCommander(entry, relatedIndex) {
  const record = entry.record ?? {};
  const fields = new Set(["id", "name", "gameType", "mode"]);
  const sections = [
    "",
    `<a id="${entry.anchor}"></a>`,
    `## ${escapeMarkdown(record.name ?? entry.id)}`,
    "",
    ...sourceMetadataLines(entry),
  ];
  for (const [label, field] of [["Lord ID", "lordId"], ["Role Index", "roleIndex"]]) {
    if (Object.hasOwn(record, field)) {
      fields.add(field);
      sections.push(...sourceField(label, record[field]));
    }
  }
  if (Object.hasOwn(record, "quote")) {
    fields.add("quote");
    sections.push(...sourceField("Quote", record.quote));
  }
  if (Object.hasOwn(record, "sections")) {
    fields.add("sections");
    if (Array.isArray(record.sections)) {
      for (const section of record.sections) {
        const label = section && typeof section === "object" && section.type
          ? String(section.type)
          : "Section";
        const level = section && typeof section === "object" && Object.hasOwn(section, "level")
          ? ` (level ${String(section.level)})`
          : "";
        sections.push(...sourceField(`${label}${level}`, section));
      }
    } else {
      sections.push(...sourceField("Sections", record.sections));
    }
  }
  if (Object.hasOwn(record, "relatedCards")) {
    fields.add("relatedCards");
    sections.push(...sourceField("Related Cards", record.relatedCards));
    sections.push(...localReferenceLines("Related Cards", record.relatedCards, relatedIndex));
  }
  sections.push(...renderRemainingFields(record, fields));
  return sections;
}

function renderRelated(entry) {
  const record = entry.record ?? {};
  return [
    "",
    `<a id="${entry.anchor}"></a>`,
    `## ${escapeMarkdown(record.name ?? entry.id)}`,
    "",
    ...sourceMetadataLines(entry),
    "### Full Source Record",
    "",
    ...sourceValueLines(record, 0),
    "",
  ];
}

function renderPage(title, entries, kind, renderEntry, provenance, stats) {
  const anchored = entriesWithAnchors(entries, kind);
  const contents = anchored.length ? `${pageToc(anchored)}\n` : "_No records._\n";
  return [
    `# ${title}`,
    "",
    `Source records: ${entries.length}.`,
    "",
    `- Source: ${escapeMarkdown(provenance.source_name ?? "not specified")}`,
    `- Retrieved at: ${escapeMarkdown(provenance.retrieved_at ?? "not specified")}`,
    `- Entry URL: ${escapeMarkdown(provenance.entry_url ?? "not specified")}`,
    `- Database URL: ${escapeMarkdown(provenance.database_url ?? "not specified")}`,
    `- Catalog by mode: wanxiang ${stats.by_mode.wanxiang}, diamond ${stats.by_mode.diamond}, unspecified ${stats.by_mode.unspecified}`,
    `- Talent quality: gold ${stats.talent_quality.gold}, silver ${stats.talent_quality.silver}, bronze ${stats.talent_quality.bronze}, unspecified ${stats.talent_quality.unspecified}`,
    "",
    "## Contents",
    "",
    contents.trimEnd(),
    ...anchored.flatMap(renderEntry),
  ].join("\n").replace(/[ \t]+$/gm, "").replace(/\n+$/g, "\n");
}

function formatCountLines(stats) {
  return [
    `- Total records: ${stats.total}`,
    `- Talents: ${stats.talents}`,
    `- Commanders: ${stats.commanders}`,
    `- Related cards: ${stats.related_cards}`,
    `- Modes: wanxiang ${stats.by_mode.wanxiang}, diamond ${stats.by_mode.diamond}, unspecified ${stats.by_mode.unspecified}`,
    `- Talent quality: gold ${stats.talent_quality.gold}, silver ${stats.talent_quality.silver}, bronze ${stats.talent_quality.bronze}, unspecified ${stats.talent_quality.unspecified}`,
  ];
}

export function renderReferenceDocs(catalog) {
  const records = catalogRecords(catalog);
  const talents = records.filter((entry) => entry.type === "talent");
  const commanders = records.filter((entry) => entry.type === "commander");
  const related = records.filter((entry) => entry.type === "related");
  const stats = catalogStats(catalog);
  const provenance = catalogProvenance(catalog);
  const relatedIndex = relatedLinkIndex(related);
  const counts = formatCountLines(stats);
  const index = [
    "# Wanxiangqi Reference Library",
    "",
    "## Source",
    "",
    `- Name: ${escapeMarkdown(provenance.source_name ?? "not specified")}`,
    `- Entry URL: ${escapeMarkdown(provenance.entry_url ?? "not specified")}`,
    `- Database URL: ${escapeMarkdown(provenance.database_url ?? "not specified")}`,
    `- Retrieved at: ${escapeMarkdown(provenance.retrieved_at ?? "not specified")}`,
    "",
    "## Catalog Counts",
    "",
    ...counts,
    "",
    "## Records",
    "",
    `- [Talents](TALENTS.md): ${talents.length}`,
    `- [Commanders](COMMANDERS.md): ${commanders.length}`,
    `- [Related Cards](RELATED_CARDS.md): ${related.length}`,
    "",
    "All record values in these pages are source data. No design classification or interpretation has been added.",
    "",
  ].join("\n").replace(/[ \t]+$/gm, "");
  return {
    "INDEX.md": index,
    "TALENTS.md": renderPage(
      "Talents",
      talents,
      "talent",
      (entry) => renderTalent(entry, relatedIndex),
      provenance,
      stats,
    ),
    "COMMANDERS.md": renderPage(
      "Commanders",
      commanders,
      "commander",
      (entry) => renderCommander(entry, relatedIndex),
      provenance,
      stats,
    ),
    "RELATED_CARDS.md": renderPage("Related Cards", related, "related", renderRelated, provenance, stats),
  };
}
