import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CONTENT_ROOT,
  CONTENT_VERSION,
  EXPECTED_MANIFEST_ENTRIES,
  MANIFEST_PATH,
  SCHEMA_VERSION,
} from './constants.mjs'
import { parseYaml } from './yaml.mjs'

function issue(code, message, pathName = 'manifest.yaml') {
  return { code, message, path: pathName }
}

export async function readManifest({ manifestPath = MANIFEST_PATH } = {}) {
  const errors = []
  let manifest
  try {
    const text = await readFile(manifestPath, 'utf8')
    manifest = parseYaml(text, manifestPath)
  } catch (error) {
    errors.push(issue('manifest-parse', error.message, path.relative(CONTENT_ROOT, manifestPath)))
    return { manifest: null, entries: [], errors }
  }

  if (manifest.schema_version !== SCHEMA_VERSION) {
    errors.push(issue('manifest-schema', `schema_version must be ${SCHEMA_VERSION}`))
  }
  if (manifest.content_version !== CONTENT_VERSION) {
    errors.push(issue('manifest-version', `content_version must be ${CONTENT_VERSION}`))
  }
  if (manifest.status !== 'design_target') {
    errors.push(issue('manifest-status', 'status must be design_target'))
  }
  if (!Array.isArray(manifest.files)) {
    errors.push(issue('manifest-files', 'files must be an explicit array'))
    return { manifest, entries: [], errors }
  }

  const seenIds = new Set()
  const seenPaths = new Set()
  for (const [index, entry] of manifest.files.entries()) {
    const location = `manifest.yaml:files[${index}]`
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(issue('manifest-entry', 'each files entry must be a mapping', location))
      continue
    }
    for (const field of ['id', 'kind', 'path']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        errors.push(issue('manifest-entry-field', `${field} must be a non-empty string`, location))
      }
    }
    if (typeof entry.id === 'string' && seenIds.has(entry.id)) {
      errors.push(issue('manifest-duplicate-id', `duplicate manifest id ${entry.id}`, location))
    }
    if (typeof entry.path === 'string' && seenPaths.has(entry.path)) {
      errors.push(issue('manifest-duplicate-path', `duplicate manifest path ${entry.path}`, location))
    }
    if (typeof entry.id === 'string') seenIds.add(entry.id)
    if (typeof entry.path === 'string') seenPaths.add(entry.path)
    if (typeof entry.path === 'string') {
      const normalized = path.posix.normalize(entry.path.replaceAll(path.sep, '/'))
      if (normalized !== entry.path || normalized.startsWith('../') || normalized.startsWith('/')) {
        errors.push(issue('manifest-unsafe-path', `unsafe manifest path ${entry.path}`, location))
      }
      if (path.posix.basename(entry.path, '.yaml') !== entry.id) {
        errors.push(issue('manifest-id-file', `manifest id ${entry.id} must match its YAML filename`, location))
      }
    }
  }

  const actual = manifest.files.map(({ id, kind, path: filePath }) => `${id}|${kind}|${filePath}`)
  const expected = EXPECTED_MANIFEST_ENTRIES.map(({ id, kind, path: filePath }) => `${id}|${kind}|${filePath}`)
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  for (const value of expected) {
    if (!actualSet.has(value)) {
      errors.push(issue('manifest-missing-entry', `missing explicit manifest entry ${value}`))
    }
  }
  for (const value of actual) {
    if (!expectedSet.has(value)) {
      errors.push(issue('manifest-extra-entry', `unexpected manifest entry ${value}`))
    }
  }

  const expectedCounts = {
    methods: 10,
    artifacts: 44,
    ordinary_events: 36,
    core_events: 16,
    storylines: 6,
    act_enemies: 32,
    final_enemies: 2,
    acts: 5,
  }
  if (manifest.counts == null || typeof manifest.counts !== 'object' || Array.isArray(manifest.counts)) {
    errors.push(issue('manifest-counts', 'counts must be a mapping'))
  } else {
    for (const [key, expectedCount] of Object.entries(expectedCounts)) {
      if (manifest.counts[key] !== expectedCount) {
        errors.push(issue('manifest-count', `counts.${key} must be ${expectedCount}`))
      }
    }
  }

  return { manifest, entries: manifest.files, errors }
}
