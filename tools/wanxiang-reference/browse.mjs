#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertCatalogShape,
  catalogProvenance,
  catalogStats,
  DEFAULT_LIMIT,
  findShowMatches,
  paginateRecords,
  recordPayload,
  renderReferenceDocs,
  sanitizeTerminal,
  searchRecords,
} from "./lib/browse.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(MODULE_DIR, "../../references/wanxiangqi");
const CATALOG_PATH = resolve(DOCS_DIR, "catalog.json");
const VALID_TYPES = new Set(["talent", "commander", "related"]);
const VALID_MODES = new Set(["wanxiang", "diamond"]);
const QUALITY_NAMES = new Set(["gold", "silver", "bronze"]);

export const USAGE = [
  "Usage:",
  "  node tools/wanxiang-reference/browse.mjs stats [--json]",
  "  node tools/wanxiang-reference/browse.mjs search <query> [--type talent|commander|related] [--mode wanxiang|diamond] [--quality gold|silver|bronze] [--limit N] [--json]",
  "  node tools/wanxiang-reference/browse.mjs show <id-or-exact-name> [--type talent|commander|related] [--mode wanxiang|diamond] [--quality gold|silver|bronze] [--json]",
  "  node tools/wanxiang-reference/browse.mjs render [--json]",
  "  node tools/wanxiang-reference/browse.mjs check [--json]",
].join("\n");

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

function optionsForCommand(command) {
  if (command === "stats" || command === "render" || command === "check") {
    return new Set(["json"]);
  }
  if (command === "search") {
    return new Set(["type", "mode", "quality", "limit", "json"]);
  }
  if (command === "show") return new Set(["type", "mode", "quality", "json"]);
  return null;
}

export function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new UsageError("Missing command.");
  const supported = optionsForCommand(command);
  if (!supported) throw new UsageError(`Unknown command: ${sanitizeTerminal(command)}`);

  const options = {};
  const positional = [];
  const valueFlags = new Map([
    ["--type", "type"],
    ["--mode", "mode"],
    ["--quality", "quality"],
    ["--limit", "limit"],
  ]);

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--json") {
      if (!supported.has("json")) throw new UsageError(`Option --json is not valid for ${command}.`);
      if (options.json) throw new UsageError("Option --json may only be specified once.");
      options.json = true;
      continue;
    }
    if (argument.startsWith("--")) {
      const optionName = valueFlags.get(argument);
      if (!optionName) throw new UsageError(`Unknown option: ${sanitizeTerminal(argument)}`);
      if (!supported.has(optionName)) throw new UsageError(`Option ${argument} is not valid for ${command}.`);
      if (Object.hasOwn(options, optionName)) throw new UsageError(`Option ${argument} may only be specified once.`);
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`Option ${argument} requires a value.`);
      options[optionName] = value;
      index += 1;
      continue;
    }
    positional.push(argument);
  }

  if (options.type && !VALID_TYPES.has(options.type)) {
    throw new UsageError(`Invalid type "${options.type}". Expected talent, commander, or related.`);
  }
  if (options.mode && !VALID_MODES.has(options.mode)) {
    throw new UsageError(`Invalid mode "${options.mode}". Expected wanxiang or diamond.`);
  }
  if (options.quality && !QUALITY_NAMES.has(options.quality)) {
    throw new UsageError(`Invalid quality "${options.quality}". Expected gold, silver, or bronze.`);
  }
  if (options.limit !== undefined) {
    if (!/^\d+$/.test(options.limit) || !Number.isSafeInteger(Number(options.limit)) || Number(options.limit) < 1) {
      throw new UsageError("--limit must be a positive integer.");
    }
    options.limit = Number(options.limit);
  }

  if ((command === "search" || command === "show") && positional.length === 0) {
    throw new UsageError(`${command} requires a query or record ID/name.`);
  }
  if (["stats", "render", "check"].includes(command) && positional.length > 0) {
    throw new UsageError(`${command} does not accept positional arguments.`);
  }
  const target = positional.join(" ").trim();
  if ((command === "search" || command === "show") && !target) {
    throw new UsageError(`${command} requires a non-empty query or record ID/name.`);
  }

  return {
    command,
    target,
    options,
    filters: {
      ...(options.type ? { type: options.type } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.quality ? { quality: options.quality } : {}),
    },
  };
}

async function loadCatalog() {
  let raw;
  try {
    raw = await readFile(CATALOG_PATH, "utf8");
  } catch (error) {
    throw new Error(`Unable to read catalog at ${CATALOG_PATH}: ${error.message}`);
  }
  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Catalog is not valid JSON: ${error.message}`);
  }
  return assertCatalogShape(catalog);
}

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function recordLabel(entry) {
  const name = sanitizeTerminal(entry.record?.name ?? "(unnamed)");
  const id = sanitizeTerminal(entry.id);
  const mode = sanitizeTerminal(entry.mode ?? "mode unspecified");
  return `${entry.type} ${name} [${id}] (${mode})`;
}

function printStats(catalog, stdout, json) {
  const stats = catalogStats(catalog);
  const result = {
    stats,
    provenance: catalogProvenance(catalog),
    metadata_counts: catalog.metadata.counts ?? null,
  };
  if (json) {
    writeJson(stdout, result);
    return;
  }
  stdout.write(`Catalog: ${sanitizeTerminal(result.provenance.source_name ?? "unknown source")}\n`);
  stdout.write(`Retrieved at: ${sanitizeTerminal(result.provenance.retrieved_at ?? "not specified")}\n`);
  stdout.write(`Total: ${stats.total} records\n`);
  stdout.write(`Talents: ${stats.talents}; commanders: ${stats.commanders}; related cards: ${stats.related_cards}\n`);
  stdout.write(`Modes: wanxiang ${stats.by_mode.wanxiang}; diamond ${stats.by_mode.diamond}; unspecified ${stats.by_mode.unspecified}\n`);
  stdout.write(`Talent quality: gold ${stats.talent_quality.gold}; silver ${stats.talent_quality.silver}; bronze ${stats.talent_quality.bronze}; unspecified ${stats.talent_quality.unspecified}\n`);
}

function printSearch(catalog, query, filters, limit, stdout, json) {
  const matches = searchRecords(catalog, query, filters);
  const page = paginateRecords(matches, limit);
  const results = page.results;
  const result = {
    query,
    filters: {
      type: filters.type ?? null,
      mode: filters.mode ?? null,
      quality: filters.quality ?? null,
      limit,
    },
    total: page.total,
    shown: page.shown,
    has_more: page.has_more,
    results: results.map((entry) => recordPayload(catalog, entry)),
    provenance: catalogProvenance(catalog),
  };
  if (json) {
    writeJson(stdout, result);
    return;
  }
  stdout.write(`Matches: ${result.total}; showing ${result.shown}.\n`);
  for (const entry of results) {
    stdout.write(`- ${recordLabel(entry)}\n`);
  }
  if (result.has_more) stdout.write(`More matches omitted; use --limit N to show additional results.\n`);
}

function printShow(catalog, identifier, filters, stdout, stderr, json) {
  const matches = findShowMatches(catalog, identifier, filters);
  if (!matches.length) {
    stderr.write(`No exact record ID or name matched: ${sanitizeTerminal(identifier)}\n`);
    return 1;
  }
  if (matches.length > 1) {
    stderr.write(`Ambiguous record "${sanitizeTerminal(identifier)}"; add --type or --mode to select one:\n`);
    for (const entry of matches) stderr.write(`- ${recordLabel(entry)}\n`);
    return 1;
  }
  const [entry] = matches;
  const result = recordPayload(catalog, entry);
  if (json) {
    writeJson(stdout, result);
    return 0;
  }
  stdout.write(`${recordLabel(entry)}\n`);
  stdout.write(`Source: ${result.source_url}\n`);
  stdout.write(`${JSON.stringify(entry.record, null, 2)}\n`);
  return 0;
}

async function render(catalog, stdout, json) {
  const docs = renderReferenceDocs(catalog);
  await mkdir(DOCS_DIR, { recursive: true });
  const paths = [];
  for (const [filename, content] of Object.entries(docs)) {
    const path = resolve(DOCS_DIR, filename);
    await writeFile(path, content, "utf8");
    paths.push(path);
  }
  if (json) writeJson(stdout, { rendered: paths });
  else stdout.write(`Rendered ${paths.length} reference pages to ${DOCS_DIR}.\n`);
}

async function validationErrors(catalog) {
  let validator;
  try {
    validator = await import("./lib/validate.mjs");
  } catch (error) {
    throw new Error(`Unable to load catalog validator (./lib/validate.mjs): ${error.message}`);
  }
  if (typeof validator.validateCatalog !== "function") {
    throw new Error("Catalog validator does not export validateCatalog().");
  }
  const result = await validator.validateCatalog(catalog);
  if (result === false) return ["validateCatalog returned false"];
  if (Array.isArray(result) && result.length) return result.map(String);
  if (result && typeof result === "object") {
    if (result.ok === false || result.valid === false) {
      const errors = result.errors ?? result.issues ?? ["catalog validation failed"];
      return Array.isArray(errors) ? errors.map(String) : [String(errors)];
    }
    if (Array.isArray(result.errors) && result.errors.length) return result.errors.map(String);
  }
  return [];
}

async function check(catalog, stdout, stderr, json) {
  const errors = await validationErrors(catalog);
  if (errors.length) {
    if (json) writeJson(stderr, { ok: false, errors });
    else {
      stderr.write("Catalog validation failed:\n");
      for (const error of errors) stderr.write(`- ${sanitizeTerminal(error)}\n`);
    }
    return 1;
  }

  const docs = renderReferenceDocs(catalog);
  const mismatches = [];
  for (const [filename, expected] of Object.entries(docs)) {
    const path = resolve(DOCS_DIR, filename);
    let actual;
    try {
      actual = await readFile(path, "utf8");
    } catch {
      mismatches.push({ filename, reason: "missing" });
      continue;
    }
    if (actual !== expected) mismatches.push({ filename, reason: "stale" });
  }
  if (mismatches.length) {
    if (json) writeJson(stderr, { ok: false, mismatches });
    else {
      stderr.write("Generated reference pages do not match the catalog:\n");
      for (const item of mismatches) stderr.write(`- ${item.filename}: ${item.reason}\n`);
    }
    return 1;
  }
  if (json) writeJson(stdout, { ok: true, checked: Object.keys(docs) });
  else stdout.write(`Catalog valid; ${Object.keys(docs).length} generated pages match the catalog.\n`);
  return 0;
}

export async function runCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    stderr.write(`${sanitizeTerminal(error.message)}\n${USAGE}\n`);
    return 2;
  }

  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (error) {
    stderr.write(`${sanitizeTerminal(error.message)}\n`);
    return 1;
  }

  const json = parsed.options.json === true;
  try {
    switch (parsed.command) {
      case "stats":
        printStats(catalog, stdout, json);
        return 0;
      case "search":
        printSearch(
          catalog,
          parsed.target,
          parsed.filters,
          parsed.options.limit ?? DEFAULT_LIMIT,
          stdout,
          json,
        );
        return 0;
      case "show":
        return printShow(catalog, parsed.target, parsed.filters, stdout, stderr, json);
      case "render":
        await render(catalog, stdout, json);
        return 0;
      case "check":
        return await check(catalog, stdout, stderr, json);
      default:
        throw new Error(`Unsupported command: ${parsed.command}`);
    }
  } catch (error) {
    stderr.write(`${sanitizeTerminal(error.message)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli();
}
