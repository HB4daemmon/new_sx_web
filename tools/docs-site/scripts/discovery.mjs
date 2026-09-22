import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const MARKDOWN_EXTENSION = /\.md$/i
const PRIVATE_SEGMENT = /^[._]/
const NATURAL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export const DIRECTORY_LABELS = Object.freeze({
  artifacts: '法宝',
  content: '首发内容卡库',
  enemies: '敌人',
  events: '事件',
  methods: '功法',
  rules: '规则',
  storylines: '人物线',
})

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function compareNatural(left, right) {
  return NATURAL_COLLATOR.compare(left, right)
}

function comparePath(left, right) {
  const leftParts = left.split('/')
  const rightParts = right.split('/')
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const result = compareNatural(leftParts[index] ?? '', rightParts[index] ?? '')
    if (result !== 0) {
      return result
    }
  }
  return 0
}

function filePriority(filename) {
  const stem = filename.replace(MARKDOWN_EXTENSION, '').toLowerCase()
  if (stem === 'readme') {
    return 0
  }
  if (stem === 'index') {
    return 1
  }
  return 2
}

function compareDocumentPaths(left, right) {
  const directoryDifference = comparePath(path.posix.dirname(left), path.posix.dirname(right))
  if (directoryDifference !== 0) {
    return directoryDifference
  }
  const priorityDifference = filePriority(path.posix.basename(left)) - filePriority(path.posix.basename(right))
  if (priorityDifference !== 0) {
    return priorityDifference
  }
  return comparePath(left, right)
}

function titleFallback(sourceRelativePath) {
  return path.posix.basename(sourceRelativePath).replace(MARKDOWN_EXTENSION, '')
}

export function extractFirstH1(markdown, fallback) {
  const heading = markdown.match(/^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#?[ \t]*$/m)
  return heading?.[1]?.trim() || fallback
}

export function isPublicSourcePath(relativePath) {
  const normalized = toPosix(relativePath)
  return normalized
    .split('/')
    .every((segment) => segment.length > 0 && !PRIVATE_SEGMENT.test(segment))
}

export function stagedPathFor(sourceRelativePath) {
  const normalized = toPosix(sourceRelativePath)
  const sourceParts = normalized.split('/')
  const sourceRoot = sourceParts[0] === 'rework' ? 'rework' : 'history'
  const basename = sourceParts.pop()
  let stagedBasename = basename.replace(MARKDOWN_EXTENSION, '.md')
  if (/^index\.md$/i.test(stagedBasename)) {
    stagedBasename = 'index.md'
  }
  return path.posix.join(sourceRoot, ...sourceParts.slice(sourceRoot === 'rework' ? 1 : 0), stagedBasename)
}

export async function assertNoSymlinks(root) {
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Rejected symlink publish source: ${root}`)
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Publish source is not a directory: ${root}`)
  }

  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isSymbolicLink()) {
        const relative = toPosix(path.relative(root, entryPath)) || entry.name
        throw new Error(`Rejected symlink publish source: ${relative}`)
      }
      if (entry.isDirectory()) {
        pending.push(entryPath)
      }
    }
  }
}

export async function discoverMarkdown({ sourceRoot }) {
  const resolvedSourceRoot = path.resolve(sourceRoot)
  await assertNoSymlinks(resolvedSourceRoot)

  const documents = []
  const pending = [{ absolutePath: resolvedSourceRoot, relativeParts: [] }]
  while (pending.length > 0) {
    const current = pending.pop()
    const entries = await readdir(current.absolutePath, { withFileTypes: true })
    entries.sort((left, right) => compareNatural(left.name, right.name))

    for (const entry of entries) {
      if (PRIVATE_SEGMENT.test(entry.name)) {
        continue
      }

      const absolutePath = path.join(current.absolutePath, entry.name)
      const relativeParts = [...current.relativeParts, entry.name]
      if (entry.isDirectory()) {
        pending.push({ absolutePath, relativeParts })
        continue
      }
      if (!entry.isFile() || !MARKDOWN_EXTENSION.test(entry.name)) {
        continue
      }

      const source = relativeParts.join('/')
      const contents = await readFile(absolutePath, 'utf8')
      documents.push({
        absolutePath,
        contents,
        source,
        title: extractFirstH1(contents, titleFallback(source)),
      })
    }
  }

  documents.sort((left, right) => compareDocumentPaths(left.source, right.source))
  const sourcePaths = new Map()
  for (const document of documents) {
    const caseFoldedPath = document.source.toLocaleLowerCase()
    const previous = sourcePaths.get(caseFoldedPath)
    if (previous) {
      throw new Error(
        `Markdown source path differs only by case: ${previous.source} and ${document.source}`,
      )
    }
    sourcePaths.set(caseFoldedPath, document)
  }

  return documents
}

function directoryLabel(name) {
  return DIRECTORY_LABELS[name.toLowerCase()] ?? name
}

function publicLink(stagedPath) {
  const withoutExtension = stagedPath.replace(/\.md$/i, '')
  return withoutExtension === 'index' ? '/' : `/${withoutExtension}`
}

function itemSortKey(item) {
  return item.kind === 'file' ? item.path : `${item.path}/`
}

function compareItems(left, right) {
  const leftPriority = left.kind === 'file' ? filePriority(path.posix.basename(left.path)) : 2
  const rightPriority = right.kind === 'file' ? filePriority(path.posix.basename(right.path)) : 2
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority
  }
  return comparePath(itemSortKey(left), itemSortKey(right))
}

function directItems(stagedFiles, directory) {
  const prefix = directory ? `${directory}/` : ''
  const children = new Map()
  for (const file of stagedFiles) {
    if (file.staged === 'index.md' || !file.staged.startsWith(prefix)) {
      continue
    }

    const remainder = file.staged.slice(prefix.length)
    if (remainder.length === 0) {
      continue
    }
    const [name, ...rest] = remainder.split('/')
    if (rest.length === 0) {
      children.set(`file:${file.staged}`, {
        kind: 'file',
        path: file.staged,
        item: {
          text: file.title,
          link: publicLink(file.staged),
        },
      })
      continue
    }

    const childPath = `${prefix}${name}`.replace(/\/$/, '')
    children.set(`directory:${childPath}`, {
      kind: 'directory',
      path: childPath,
      item: {
        text: directoryLabel(name),
        collapsed: true,
        items: directItems(stagedFiles, childPath),
      },
    })
  }

  const items = [...children.values()]
  for (const child of items) {
    if (child.kind !== 'directory') {
      continue
    }
    const indexFile = stagedFiles
      .filter((file) => {
        if (!file.staged.startsWith(`${child.path}/`)) {
          return false
        }
        const remainder = file.staged.slice(child.path.length + 1)
        return !remainder.includes('/')
      })
      .sort((left, right) => compareDocumentPaths(left.staged, right.staged))[0]
    if (indexFile && filePriority(path.posix.basename(indexFile.staged)) < 2) {
      child.item.link = publicLink(indexFile.staged)
    }
  }

  items.sort(compareItems)
  return items.map((entry) => entry.item)
}

function firstPreferredItem(items) {
  if (items.length === 0) {
    return null
  }
  const linkedItem = items.find((item) => typeof item.link === 'string')
  return linkedItem ?? firstPreferredItem(items[0].items ?? [])
}

export function buildNavigation(stagedFiles) {
  const reworkSidebar = directItems(stagedFiles, 'rework')
  const historySidebar = directItems(stagedFiles, 'history')
  const homeFile = stagedFiles.find((file) => file.staged === 'index.md')

  const sidebar = []
  if (homeFile || reworkSidebar.length > 0) {
    sidebar.push({
      text: '新版结构',
      items: [
        ...(homeFile
          ? [
              {
                text: homeFile.title,
                link: '/',
              },
            ]
          : []),
        ...reworkSidebar,
      ],
    })
  }
  if (historySidebar.length > 0) {
    sidebar.push({
      text: '历史稿与资料',
      collapsed: true,
      items: historySidebar,
    })
  }

  const nav = [
    {
      text: '新版结构',
      link: '/',
    },
  ]
  const historyHome = firstPreferredItem(historySidebar)
  if (historyHome?.link) {
    nav.push({
      text: '历史资料',
      link: historyHome.link,
    })
  }

  return {
    nav,
    sidebar,
    reworkSidebar,
    historySidebar,
  }
}
