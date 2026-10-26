#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { collectAndWriteCatalog } from './lib/collect.mjs';
import { validateCatalog } from './lib/validate.mjs';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(moduleRoot, '../../references/wanxiangqi/catalog.json');

function parseArguments(args) {
  const result = { check: false, bundleUrls: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') {
      result.check = true;
    } else if (argument === '--bundle' && args[index + 1]) {
      result.bundleUrls.push(args[++index]);
    } else if (argument.startsWith('--bundle=')) {
      result.bundleUrls.push(argument.slice('--bundle='.length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (result.check && result.bundleUrls.length > 0) {
    throw new Error('--bundle cannot be combined with --check');
  }
  return result;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.check) {
    const catalog = JSON.parse(await readFile(snapshotPath, 'utf8'));
    validateCatalog(catalog);
    console.log(`Catalog valid: ${catalog.talents.length} talents, ${catalog.commanders.length} commanders, ${catalog.related_cards.length} related cards`);
  } else {
    const catalog = await collectAndWriteCatalog({
      outputPath: snapshotPath,
      bundleUrls: options.bundleUrls,
    });
    console.log(`Collected ${catalog.talents.length} talents, ${catalog.commanders.length} commanders, ${catalog.related_cards.length} related cards`);
    console.log(JSON.stringify(catalog.metadata.counts, null, 2));
  }
} catch (error) {
  console.error(`wanxiang-reference: ${error.message}`);
  process.exitCode = 1;
}
