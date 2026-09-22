import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { installSafeDocumentAnchors } from '../scripts/markdown.mjs'
import {
  buildNavigation,
  discoverMarkdown,
  stagedPathFor,
} from '../scripts/discovery.mjs'

import {
  assertSourceRootIntegrity,
  createSerialBuildQueue,
  findCredentialPatterns,
  formatCredentialFindings,
  publishRelease,
  stageMarkdown,
} from '../scripts/build-core.mjs'

async function fixtureDirectory() {
  return mkdtemp(path.join(tmpdir(), 'suishi-docs-site-'))
}

test('docs site defaults to dark while retaining the native appearance switch', async () => {
  const [config, css, readme] = await Promise.all([
    readFile(path.join(process.cwd(), 'site/.vitepress/config.mts'), 'utf8'),
    readFile(path.join(process.cwd(), 'site/.vitepress/theme/custom.css'), 'utf8'),
    readFile(path.join(process.cwd(), 'README.md'), 'utf8'),
  ])

  assert.match(config, /appearance:\s*'dark'/)
  assert.match(config, /darkModeSwitchTitle:\s*'切换到暗色模式'/)
  assert.match(config, /lightModeSwitchTitle:\s*'切换到浅色模式'/)
  assert.match(config, /sidebar-data\.mjs/)
  assert.match(config, /ignoreDeadLinks:\s*false/)
  assert.doesNotMatch(config, /RKF01|RS01|history\/README/)
  assert.match(css, /\.dark\s*\{[\s\S]*--vp-c-bg:\s*#[0-9a-f]{6};/)
  assert.match(css, /html,\s*body\s*\{[\s\S]*background-color:\s*var\(--vp-c-bg\);/)
  assert.match(css, /\.VPDoc \.vp-doc\s*\{[\s\S]*color:\s*var\(--vp-c-text-1\);/)
  assert.doesNotMatch(css, /html,\s*body\s*\{[\s\S]*#ffffff/)
  assert.match(readme, /首次访问默认使用暗色模式/)
})

test('staging discovers every public Markdown file and preserves URL mappings', async () => {
  const root = await fixtureDirectory()
  const sourceRoot = path.join(root, 'source')
  const stagingRoot = path.join(root, 'staging')
  await mkdir(path.join(sourceRoot, 'rework', 'chapters', 'nested'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'rework', '_drafts'), { recursive: true })
  await mkdir(path.join(sourceRoot, '.private'), { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'rework', 'README.md'),
    '# 新版入口\n\n[章节](./chapters/INDEX.MD)\n',
  )
  await writeFile(path.join(sourceRoot, 'rework', 'chapters', 'INDEX.MD'), '# 章节索引\n')
  await writeFile(
    path.join(sourceRoot, 'rework', 'chapters', 'nested', 'NewPage.MD'),
    '# 动态页面\n',
  )
  await writeFile(path.join(sourceRoot, 'README.md'), '# 历史入口\n')
  await writeFile(path.join(sourceRoot, 'notes.txt'), 'not Markdown\n')
  await writeFile(path.join(sourceRoot, 'private.yaml'), 'secret: no\n')
  await writeFile(path.join(sourceRoot, 'rework', '_drafts', 'DRAFT.md'), '# 不公开\n')
  await writeFile(path.join(sourceRoot, '.private', 'HIDDEN.md'), '# 不公开\n')

  const result = await stageMarkdown({ sourceRoot, stagingRoot })

  assert.equal(result.sourceToStaged.get('rework/chapters/INDEX.MD'), 'rework/chapters/index.md')
  assert.equal(
    result.sourceToStaged.get('rework/chapters/nested/NewPage.MD'),
    'rework/chapters/nested/NewPage.md',
  )
  assert.equal(await readFile(path.join(stagingRoot, 'history', 'README.md'), 'utf8'), '# 历史入口\n')
  assert.equal(
    await readFile(path.join(stagingRoot, 'rework', 'chapters', 'index.md'), 'utf8'),
    '# 章节索引\n',
  )
  assert.equal(
    await readFile(path.join(stagingRoot, 'index.md'), 'utf8'),
    '# 新版入口\n\n[章节](./rework/chapters/index.md)\n',
  )
  await assert.rejects(readFile(path.join(stagingRoot, 'notes.txt')))
  await assert.rejects(readFile(path.join(stagingRoot, 'private.yaml')))
  await assert.rejects(readFile(path.join(stagingRoot, 'rework', '_drafts', 'DRAFT.md')))
  await assert.rejects(readFile(path.join(stagingRoot, '.private', 'HIDDEN.md')))
})

test('discovery derives titles, dynamic subdirectories, and preferred index entries', async () => {
  const root = await fixtureDirectory()
  const sourceRoot = path.join(root, 'source')
  await mkdir(path.join(sourceRoot, 'rework', 'chapters', 'nested'), { recursive: true })
  await writeFile(path.join(sourceRoot, 'rework', 'README.md'), '# 结构总纲\n')
  await writeFile(path.join(sourceRoot, 'rework', 'chapters', 'INDEX.md'), '# 章节索引\n')
  await writeFile(path.join(sourceRoot, 'rework', 'chapters', 'A2.md'), '# 第二章\n')
  await writeFile(path.join(sourceRoot, 'rework', 'chapters', 'A10.md'), '# 第十章\n')
  await writeFile(path.join(sourceRoot, 'rework', 'chapters', 'nested', 'untitled.md'), '正文\n')

  const documents = await discoverMarkdown({ sourceRoot })
  assert.equal(documents.find((document) => document.source.endsWith('untitled.md')).title, 'untitled')
  assert.equal(stagedPathFor('rework/chapters/INDEX.md'), 'rework/chapters/index.md')

  const stagedFiles = documents.map((document) => ({
    source: document.source,
    staged: stagedPathFor(document.source),
    title: document.title,
  }))
  stagedFiles.push({
    source: 'rework/README.md',
    staged: 'index.md',
    title: '结构总纲',
    generated: false,
  })
  const navigation = buildNavigation(stagedFiles)
  const reworkSection = navigation.sidebar.find((section) => section.text === '新版结构')
  const chapters = reworkSection.items.find((item) => item.text === 'chapters')
  assert.equal(chapters.link, '/rework/chapters/index')
  assert.deepEqual(
    chapters.items.map((item) => item.text),
    ['章节索引', '第二章', '第十章', 'nested'],
  )
  assert.equal(chapters.items.at(-1).items[0].text, 'untitled')
})

test('deleting a source document removes its staged file and navigation entry', async () => {
  const root = await fixtureDirectory()
  const sourceRoot = path.join(root, 'source')
  const stagingRoot = path.join(root, 'staging')
  await mkdir(path.join(sourceRoot, 'rework'), { recursive: true })
  await writeFile(path.join(sourceRoot, 'rework', 'README.md'), '# Home\n')
  const dynamicPath = path.join(sourceRoot, 'rework', 'NewPage.md')
  await writeFile(dynamicPath, '# New page\n')

  const first = await stageMarkdown({ sourceRoot, stagingRoot })
  assert.ok(first.stagedFiles.some((file) => file.staged === 'rework/NewPage.md'))
  assert.equal(await readFile(path.join(stagingRoot, 'rework', 'NewPage.md'), 'utf8'), '# New page\n')

  await rm(dynamicPath)
  const second = await stageMarkdown({ sourceRoot, stagingRoot })
  assert.equal(second.stagedFiles.some((file) => file.staged === 'rework/NewPage.md'), false)
  await assert.rejects(readFile(path.join(stagingRoot, 'rework', 'NewPage.md')))
  assert.doesNotMatch(JSON.stringify(buildNavigation(second.stagedFiles)), /New page/)
})

test('missing rework README gets a generated minimum homepage', async () => {
  const root = await fixtureDirectory()
  const sourceRoot = path.join(root, 'source')
  const stagingRoot = path.join(root, 'staging')
  await mkdir(path.join(sourceRoot, 'rework', 'new-section'), { recursive: true })
  await writeFile(path.join(sourceRoot, 'rework', 'new-section', 'page.md'), '# Page\n')

  const result = await stageMarkdown({ sourceRoot, stagingRoot })

  assert.equal(result.stagedFiles.at(-1).generated, true)
  assert.equal(result.sourceToStaged.has('rework/README.md'), false)
  assert.match(
    await readFile(path.join(stagingRoot, 'index.md'), 'utf8'),
    /^# 随时修仙·设计文档\n\n当前公开文档目录由源文件自动生成。\n$/,
  )
})

test('source and output path collisions are rejected before writing over files', async () => {
  const root = await fixtureDirectory()
  const sourceRoot = path.join(root, 'source')
  const stagingRoot = path.join(root, 'staging')
  await mkdir(path.join(sourceRoot, 'rework'), { recursive: true })
  await writeFile(path.join(sourceRoot, 'rework', 'INDEX.md'), '# upper\n')
  await writeFile(path.join(sourceRoot, 'rework', 'index.md'), '# lower\n')

  await assert.rejects(
    stageMarkdown({ sourceRoot, stagingRoot }),
    /differs only by case|output path collision/i,
  )
  await assert.rejects(readFile(path.join(stagingRoot, 'rework', 'index.md')))
})

test('staging rejects symlinks anywhere below the source root', async () => {
  const root = await fixtureDirectory()
  const sourceRoot = path.join(root, 'source')
  const stagingRoot = path.join(root, 'staging')
  const outside = path.join(root, 'outside.md')
  await mkdir(path.join(sourceRoot, 'rework', '_drafts'), { recursive: true })
  await writeFile(outside, '# outside\n')
  await writeFile(path.join(sourceRoot, 'rework', 'README.md'), '# readme\n')
  await symlink(outside, path.join(sourceRoot, 'rework', '_drafts', 'secret.md'))

  await assert.rejects(
    stageMarkdown({ sourceRoot, stagingRoot }),
    /Rejected symlink publish source/,
  )
})

test('source root integrity rejects symlink roots and paths outside the repository', async () => {
  const root = await fixtureDirectory()
  const sourceRoot = path.join(root, 'source')
  const linkedRoot = path.join(root, 'linked-source')
  await mkdir(sourceRoot, { recursive: true })
  await symlink(sourceRoot, linkedRoot)

  await assert.rejects(assertSourceRootIntegrity(linkedRoot), /Rejected symlink publish source/)
  await assert.rejects(assertSourceRootIntegrity(sourceRoot), /outside the repository/)
})

test('credential scanning reports only source names, never matching values', async () => {
  const root = await fixtureDirectory()
  const sourceRoot = path.join(root, 'source')
  const stagingRoot = path.join(root, 'staging')
  await mkdir(path.join(sourceRoot, 'rework'), { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'rework', 'README.md'),
    '# Home\n\nsecret_token: super-secret-value-1234\n',
  )

  const staged = await stageMarkdown({ sourceRoot, stagingRoot })
  const findings = await findCredentialPatterns({
    stagingRoot,
    stagedFiles: staged.stagedFiles,
  })
  const message = formatCredentialFindings(findings)
  assert.match(message, /rework\/README\.md/)
  assert.doesNotMatch(message, /super-secret-value-1234/)
})

test('generated content metadata stays in the source but is invisible in the reader', async () => {
  const { createMarkdownRenderer } = await import('vitepress')
  const metadata = '[//]: # (GENERATED BY tools/content-kit; DO NOT EDIT. content_version: test-version)'
  const md = await createMarkdownRenderer(process.cwd(), {
    html: false,
    config: installSafeDocumentAnchors,
  })
  const html = md.render(`${metadata}\n# Content\n`)
  assert.doesNotMatch(html, /GENERATED BY|content_version|DO NOT EDIT/)
  assert.match(html, /<h1[^>]*>Content/)
})

test('named document anchors work without enabling arbitrary source HTML', async () => {
  const { createMarkdownRenderer } = await import('vitepress')
  const md = await createMarkdownRenderer(process.cwd(), {
    html: false,
    config: installSafeDocumentAnchors,
  })
  const result = md.render(
    '<a id="N01"></a>\n\n<a id="bad" onclick="alert(1)"></a>\n\n<script>alert(1)</script>\n',
  )
  assert.match(result, /<a id="N01"><\/a>/)
  assert.doesNotMatch(result, /<a id="bad"/)
  assert.doesNotMatch(result, /<script>/)
})

test('serial build queue never overlaps work and drains a pending request', async () => {
  let active = 0
  let maximumActive = 0
  let calls = 0
  const queue = createSerialBuildQueue(async () => {
    calls += 1
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active -= 1
  })

  queue.request()
  queue.request()
  await queue.waitForIdle()

  assert.equal(maximumActive, 1)
  assert.equal(calls, 2)
})

test('publishing switches a relative current link and retains two releases', async () => {
  const root = await fixtureDirectory()
  const renderedRoot = path.join(root, 'rendered')
  const publishedRoot = path.join(root, 'published')
  const releasesRoot = path.join(publishedRoot, 'releases')
  const currentLink = path.join(publishedRoot, 'current')
  await mkdir(renderedRoot, { recursive: true })
  await writeFile(path.join(renderedRoot, 'index.html'), '<html></html>\n')

  await publishRelease({
    renderedRoot,
    publishedRoot,
    releasesRoot,
    currentLink,
    releaseName: 'release-2026-09-20T00-00-00-000Z-test-a',
  })
  await publishRelease({
    renderedRoot,
    publishedRoot,
    releasesRoot,
    currentLink,
    releaseName: 'release-2026-09-20T00-01-00-000Z-test-b',
  })
  await publishRelease({
    renderedRoot,
    publishedRoot,
    releasesRoot,
    currentLink,
    releaseName: 'release-2026-09-20T00-02-00-000Z-test-c',
  })

  assert.equal(await readlink(currentLink), 'releases/release-2026-09-20T00-02-00-000Z-test-c')
  assert.deepEqual((await readdir(releasesRoot)).sort(), [
    'release-2026-09-20T00-01-00-000Z-test-b',
    'release-2026-09-20T00-02-00-000Z-test-c',
  ])
})
