import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { CONTENT_ROOT, MANIFEST_PATH } from './constants.mjs'
import { readManifest } from './manifest.mjs'
import { parseYaml } from './yaml.mjs'

function contentIssue(code, message, sourcePath) {
  return { code, message, path: sourcePath }
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export async function loadContent({
  contentRoot = CONTENT_ROOT,
  manifestPath = MANIFEST_PATH,
} = {}) {
  const root = path.resolve(contentRoot)
  const manifestResult = await readManifest({ manifestPath })
  const issues = [...manifestResult.errors]
  const entities = []

  for (const entry of manifestResult.entries) {
    if (!entry || typeof entry.path !== 'string') {
      continue
    }
    const relativePath = entry.path.replaceAll('/', path.sep)
    const absolutePath = path.resolve(root, relativePath)
    if (!isWithin(root, absolutePath)) {
      issues.push(contentIssue('unsafe-path', `manifest path escapes content root: ${entry.path}`, entry.path))
      continue
    }

    let stat
    try {
      stat = await lstat(absolutePath)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        issues.push(contentIssue('missing', `missing manifest file ${entry.path}`, entry.path))
      } else {
        issues.push(contentIssue('read', `cannot stat ${entry.path}: ${error.message}`, entry.path))
      }
      continue
    }
    if (stat.isSymbolicLink()) {
      issues.push(contentIssue('symlink', `symlink content is not allowed: ${entry.path}`, entry.path))
      continue
    }
    if (!stat.isFile()) {
      issues.push(contentIssue('not-file', `manifest path is not a regular file: ${entry.path}`, entry.path))
      continue
    }

    let text
    try {
      text = await readFile(absolutePath, 'utf8')
    } catch (error) {
      issues.push(contentIssue('read', `cannot read ${entry.path}: ${error.message}`, entry.path))
      continue
    }
    if (text.trim().length === 0) {
      issues.push(contentIssue('empty', `manifest file is empty: ${entry.path}`, entry.path))
      continue
    }

    try {
      const entity = parseYaml(text, entry.path)
      entities.push({
        ...entity,
        __manifest: entry,
        __path: entry.path,
      })
    } catch (error) {
      issues.push(contentIssue('yaml', error.message, entry.path))
    }
  }

  const byId = new Map()
  const byKind = new Map()
  for (const entity of entities) {
    if (typeof entity.id !== 'string') {
      continue
    }
    if (!byId.has(entity.id)) {
      byId.set(entity.id, entity)
    }
    const list = byKind.get(entity.kind) ?? []
    list.push(entity)
    byKind.set(entity.kind, list)
  }

  return {
    manifest: manifestResult.manifest,
    manifestEntries: manifestResult.entries,
    entities,
    byId,
    byKind,
    issues,
  }
}
