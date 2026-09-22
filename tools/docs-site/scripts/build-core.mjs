import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import {
  assertNoSymlinks,
  buildNavigation,
  discoverMarkdown,
  extractFirstH1,
  stagedPathFor,
} from './discovery.mjs'

const execFileAsync = promisify(execFile)

export const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = path.resolve(MODULE_ROOT, '..', '..')
export const SOURCE_ROOT = path.resolve(REPO_ROOT, 'docs', 'shanhai')
export const SITE_ROOT = path.resolve(MODULE_ROOT, 'site')
export const CONTENT_ROOT = path.resolve(SITE_ROOT, 'content')
export const CACHE_ROOT = path.resolve(MODULE_ROOT, 'cache')
export const VITEPRESS_DIST = path.resolve(CACHE_ROOT, 'vitepress-dist')
export const PUBLISHED_ROOT = path.resolve(MODULE_ROOT, 'published')
export const RELEASES_ROOT = path.resolve(PUBLISHED_ROOT, 'releases')
export const CURRENT_LINK = path.resolve(PUBLISHED_ROOT, 'current')
export const BUILD_LOCK = path.resolve(CACHE_ROOT, 'build.lock')
export const SIDEBAR_DATA = path.resolve(SITE_ROOT, '.vitepress', 'sidebar-data.mjs')

const CREDENTIAL_PATTERNS = Object.freeze([
  {
    type: 'private-key-block',
    expression: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
  },
  {
    type: 'aws-access-key',
    expression: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    type: 'provider-token',
    expression: /\b(?:sk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}\b/i,
  },
  {
    type: 'bearer-token',
    expression: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  },
  {
    type: 'credential-assignment',
    expression:
      /\b(?:api|access|secret|private)[ _-]?key\s*[:=]\s*["'`]?[A-Za-z0-9_./+=-]{12,}/i,
  },
  {
    type: 'token-assignment',
    expression:
      /\b(?:access|auth|refresh|secret)[ _-]?token\s*[:=]\s*["'`]?[A-Za-z0-9_./+=-]{12,}/i,
  },
  {
    type: 'password-assignment',
    expression: /\bpass(?:word|wd)\s*[:=]\s*["'`]?[^\s"'`]{8,}/i,
  },
])

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function assertSafeRelativePath(relativePath, label) {
  const normalized = path.posix.normalize(toPosix(relativePath))
  if (normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe ${label} path: ${relativePath}`)
  }
  return normalized
}

async function resetDirectory(directory) {
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
}

function splitMarkdownDestination(rawDestination) {
  const trimmed = rawDestination.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (trimmed.startsWith('<')) {
    const closing = trimmed.indexOf('>')
    if (closing === -1) {
      return null
    }
    return {
      url: trimmed.slice(1, closing),
      suffix: trimmed.slice(closing + 1),
      wrapped: true,
    }
  }

  const match = trimmed.match(/^(\S+)([\s\S]*)$/)
  if (!match) {
    return null
  }
  return { url: match[1], suffix: match[2], wrapped: false }
}

function rewriteMarkdownLinks(markdown, sourceRelativePath, stagedRelativePath, sourceToStaged) {
  return markdown.replace(/\]\(([^)\n]+)\)/g, (whole, rawDestination) => {
    const destination = splitMarkdownDestination(rawDestination)
    if (!destination) {
      return whole
    }

    const hashIndex = destination.url.indexOf('#')
    const pathPart = hashIndex === -1 ? destination.url : destination.url.slice(0, hashIndex)
    const anchor = hashIndex === -1 ? '' : destination.url.slice(hashIndex)
    if (!/\.md$/i.test(pathPart) || pathPart.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(pathPart)) {
      return whole
    }

    const targetSourcePath = path.posix.normalize(
      path.posix.join(path.posix.dirname(sourceRelativePath), toPosix(pathPart)),
    )
    const targetStagedPath =
      sourceToStaged.get(targetSourcePath) ??
      [...sourceToStaged.entries()].find(
        ([sourcePath]) => sourcePath.toLocaleLowerCase() === targetSourcePath.toLocaleLowerCase(),
      )?.[1]
    if (!targetStagedPath) {
      return whole
    }

    let relativeTarget = path.posix.relative(path.posix.dirname(stagedRelativePath), targetStagedPath)
    if (relativeTarget === '') {
      relativeTarget = path.posix.basename(targetStagedPath)
    }
    if (!relativeTarget.startsWith('.')) {
      relativeTarget = `./${relativeTarget}`
    }

    const rewrittenUrl = destination.wrapped ? `<${relativeTarget}${anchor}>` : `${relativeTarget}${anchor}`
    const leadingWhitespace = rawDestination.match(/^\s*/)?.[0] ?? ''
    return `](${leadingWhitespace}${rewrittenUrl}${destination.suffix})`
  })
}

async function writeStagedFile(stagingRoot, relativePath, contents) {
  const absolutePath = path.resolve(stagingRoot, relativePath)
  if (!isWithin(stagingRoot, absolutePath)) {
    throw new Error(`Generated path escapes staging directory: ${relativePath}`)
  }
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, contents, 'utf8')
}

export async function stageMarkdown({
  sourceRoot = SOURCE_ROOT,
  stagingRoot = CONTENT_ROOT,
} = {}) {
  const resolvedSourceRoot = path.resolve(sourceRoot)
  await assertNoSymlinks(resolvedSourceRoot)
  const documents = await discoverMarkdown({ sourceRoot: resolvedSourceRoot })
  const sourceToStaged = new Map()
  const stagedPathOwners = new Map()
  for (const document of documents) {
    const safeSourcePath = assertSafeRelativePath(document.source, 'source')
    const stagedPath = assertSafeRelativePath(stagedPathFor(safeSourcePath), 'generated')
    const caseFoldedStagedPath = stagedPath.toLocaleLowerCase()
    const previousSourcePath = stagedPathOwners.get(caseFoldedStagedPath)
    if (previousSourcePath) {
      throw new Error(
        `Markdown output path collision (including case conflict): ${previousSourcePath} and ${safeSourcePath} -> ${stagedPath}`,
      )
    }
    stagedPathOwners.set(caseFoldedStagedPath, safeSourcePath)
    sourceToStaged.set(safeSourcePath, stagedPath)
  }

  await resetDirectory(stagingRoot)
  const stagedFiles = []
  for (const document of documents) {
    const stagedRelativePath = sourceToStaged.get(document.source)
    const stagedText = rewriteMarkdownLinks(
      document.contents,
      document.source,
      stagedRelativePath,
      sourceToStaged,
    )
    await writeStagedFile(stagingRoot, stagedRelativePath, stagedText)
    stagedFiles.push({
      source: document.source,
      staged: stagedRelativePath,
      title: document.title,
    })
  }

  const reworkReadme = documents.find(
    (document) => document.source.toLocaleLowerCase() === 'rework/readme.md',
  )
  const homeText = reworkReadme
    ? rewriteMarkdownLinks(
        reworkReadme.contents,
        reworkReadme.source,
        'index.md',
        sourceToStaged,
      )
    : '# 随时修仙·设计文档\n\n当前公开文档目录由源文件自动生成。\n'
  await writeStagedFile(stagingRoot, 'index.md', homeText)
  stagedFiles.push({
    source: reworkReadme?.source ?? '(generated index)',
    staged: 'index.md',
    title: reworkReadme?.title ?? '随时修仙·设计文档',
    generated: !reworkReadme,
  })

  return { sourceToStaged, stagedFiles, documents }
}

export async function findCredentialPatterns({ stagingRoot = CONTENT_ROOT, stagedFiles } = {}) {
  const findings = []
  for (const file of stagedFiles) {
    const stagedPath = path.resolve(stagingRoot, file.staged)
    const contents = await readFile(stagedPath, 'utf8')
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.expression.test(contents)) {
        findings.push({ file: file.source, type: pattern.type })
      }
      pattern.expression.lastIndex = 0
    }
  }
  return findings
}

export function formatCredentialFindings(findings) {
  return [
    'Credential-like patterns found in publish documents; no matching values were printed:',
    ...findings.map((finding) => `- ${finding.file} (${finding.type})`),
  ].join('\n')
}

export async function writeSidebarData(stagedFiles) {
  const navigation = buildNavigation(stagedFiles)

  await mkdir(path.dirname(SIDEBAR_DATA), { recursive: true })
  await writeFile(
    SIDEBAR_DATA,
    [
      `export const nav = ${JSON.stringify(navigation.nav, null, 2)}`,
      `export const sidebar = ${JSON.stringify(navigation.sidebar, null, 2)}`,
      `export const reworkSidebar = ${JSON.stringify(navigation.reworkSidebar, null, 2)}`,
      `export const historySidebar = ${JSON.stringify(navigation.historySidebar, null, 2)}`,
      '',
    ].join('\n'),
    'utf8',
  )
  return navigation
}

async function runVitePressBuild() {
  const binaryName = process.platform === 'win32' ? 'vitepress.cmd' : 'vitepress'
  const vitepressBinary = path.resolve(MODULE_ROOT, 'node_modules', '.bin', binaryName)
  const result = await execFileAsync(vitepressBinary, ['build', SITE_ROOT], {
    cwd: MODULE_ROOT,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
}

async function listFiles(root) {
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(absolutePath)
      } else if (entry.isFile()) {
        files.push(absolutePath)
      }
    }
  }
  return files
}

async function assertRenderedSite(renderedRoot) {
  const files = await listFiles(renderedRoot)
  const htmlFiles = files.filter((file) => file.endsWith('.html'))
  if (!htmlFiles.some((file) => path.basename(file) === 'index.html')) {
    throw new Error('VitePress output did not contain a root index.html')
  }
  if (!files.some((file) => file.includes(`${path.sep}assets${path.sep}`) && file.endsWith('.js'))) {
    throw new Error('VitePress output did not contain JavaScript assets')
  }

  // Relative document references such as "docs/shanhai" are content, not
  // filesystem disclosure. Only reject absolute paths from this workspace.
  const forbiddenStrings = [MODULE_ROOT, SOURCE_ROOT]
  for (const file of files) {
    if (!/\.(?:html|js|css|json|svg|txt)$/.test(file)) {
      continue
    }
    const contents = await readFile(file, 'utf8')
    for (const forbidden of forbiddenStrings) {
      if (contents.includes(forbidden)) {
        throw new Error(`Generated site leaked a filesystem path: ${forbidden}`)
      }
    }
  }
  return { files, htmlFiles }
}

async function retainReleases(releasesRoot = RELEASES_ROOT, keep = 2) {
  await mkdir(releasesRoot, { recursive: true })
  const entries = await readdir(releasesRoot, { withFileTypes: true })
  const releases = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('release-')) {
      continue
    }
    releases.push(entry.name)
  }
  releases.sort().reverse()
  for (const release of releases.slice(keep)) {
    await rm(path.resolve(releasesRoot, release), { recursive: true, force: true })
  }
}

export async function publishRelease({
  renderedRoot = VITEPRESS_DIST,
  publishedRoot = PUBLISHED_ROOT,
  releasesRoot = RELEASES_ROOT,
  currentLink = CURRENT_LINK,
  releaseName = `release-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`,
  keep = 2,
} = {}) {
  const renderedStat = await lstat(renderedRoot)
  if (!renderedStat.isDirectory()) {
    throw new Error(`Cannot publish missing VitePress output: ${renderedRoot}`)
  }
  await mkdir(publishedRoot, { recursive: true })
  await mkdir(releasesRoot, { recursive: true })

  const releaseDir = path.resolve(releasesRoot, releaseName)
  await rm(releaseDir, { recursive: true, force: true })
  await cp(renderedRoot, releaseDir, { recursive: true, errorOnExist: true })

  const temporaryLink = path.resolve(
    publishedRoot,
    `.current-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const relativeTarget = toPosix(path.relative(publishedRoot, releaseDir))
  await symlink(relativeTarget, temporaryLink, 'dir')
  try {
    await rename(temporaryLink, currentLink)
  } catch (error) {
    await rm(temporaryLink, { force: true })
    throw error
  }

  await retainReleases(releasesRoot, keep)
  return {
    releaseDir,
    currentLink,
    relativeTarget,
  }
}

async function withBuildLock(task) {
  await mkdir(CACHE_ROOT, { recursive: true })
  try {
    await mkdir(BUILD_LOCK)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('A documentation build is already running')
    }
    throw error
  }

  try {
    return await task()
  } finally {
    await rm(BUILD_LOCK, { recursive: true, force: true })
  }
}

export async function buildSite({
  sourceRoot = SOURCE_ROOT,
  stagingRoot = CONTENT_ROOT,
  renderedRoot = VITEPRESS_DIST,
} = {}) {
  return withBuildLock(async () => {
    const verifiedSourceRoot = await assertSourceRootIntegrity(sourceRoot)
    const staged = await stageMarkdown({ sourceRoot: verifiedSourceRoot, stagingRoot })
    const findings = await findCredentialPatterns({
      stagingRoot,
      stagedFiles: staged.stagedFiles,
    })
    if (findings.length > 0) {
      throw new Error(formatCredentialFindings(findings))
    }

    await writeSidebarData(staged.stagedFiles)
    await rm(renderedRoot, { recursive: true, force: true })
    await runVitePressBuild()
    await assertRenderedSite(renderedRoot)
    return publishRelease({ renderedRoot })
  })
}

export function createSerialBuildQueue(task) {
  let pending = false
  let running = false
  const idleWaiters = []

  const resolveIdle = () => {
    while (idleWaiters.length > 0) {
      idleWaiters.shift()()
    }
  }

  const drain = async () => {
    if (running) {
      return
    }
    running = true
    while (pending) {
      pending = false
      try {
        await task()
      } catch {
        // The watcher logs failures in its task wrapper and keeps serving the
        // last successful release.
      }
    }
    running = false
    resolveIdle()
  }

  return {
    request() {
      pending = true
      void drain()
    },
    waitForIdle() {
      if (!running && !pending) {
        return Promise.resolve()
      }
      return new Promise((resolve) => idleWaiters.push(resolve))
    },
    get running() {
      return running
    },
  }
}

export async function assertSourceRootIntegrity(sourceRoot = SOURCE_ROOT) {
  const candidate = path.resolve(sourceRoot)
  const candidateStat = await lstat(candidate)
  if (candidateStat.isSymbolicLink()) {
    throw new Error(`Rejected symlink publish source: ${candidate}`)
  }
  const resolved = await realpath(candidate)
  if (!isWithin(REPO_ROOT, resolved)) {
    throw new Error(`Publish source is outside the repository: ${sourceRoot}`)
  }
  const expectedSourceRoot = await realpath(SOURCE_ROOT)
  if (resolved !== expectedSourceRoot) {
    throw new Error(`Publish source must be docs/shanhai: ${sourceRoot}`)
  }
  await assertNoSymlinks(resolved)
  return resolved
}
