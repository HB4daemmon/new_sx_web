import { parseDocument } from 'yaml'

function formatYamlError(error) {
  const message = error?.message ?? String(error)
  const line = error?.linePos?.[0]?.line
  const column = error?.linePos?.[0]?.col
  return line && column ? `${message} (${line}:${column})` : message
}

function walkNode(node, source, seen = new Set()) {
  if (node == null || typeof node !== 'object' || seen.has(node)) {
    return
  }
  seen.add(node)

  const nodeType = String(node.type ?? '').toUpperCase()
  if (nodeType === 'ALIAS' || node.constructor?.name === 'Alias') {
    throw new Error(`${source}: YAML aliases are not allowed`)
  }
  if (node.anchor) {
    throw new Error(`${source}: YAML anchors are not allowed`)
  }
  if (node.tag) {
    throw new Error(`${source}: explicit YAML tags are not allowed`)
  }

  if (Array.isArray(node.items)) {
    for (const item of node.items) {
      if (item?.key !== undefined || item?.value !== undefined) {
        walkNode(item.key, source, seen)
        walkNode(item.value, source, seen)
      } else {
        walkNode(item, source, seen)
      }
    }
  }
  if (node.key !== undefined) {
    walkNode(node.key, source, seen)
  }
  if (node.value !== undefined) {
    walkNode(node.value, source, seen)
  }
}

export function parseYaml(text, source = '<yaml>') {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error(`${source}: YAML document is empty`)
  }

  const document = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    uniqueKeys: true,
    stringKeys: true,
    maxAliasCount: 0,
    prettyErrors: false,
  })
  if (document.errors.length > 0) {
    throw new Error(`${source}: ${document.errors.map(formatYamlError).join('; ')}`)
  }
  if (document.warnings.length > 0) {
    throw new Error(`${source}: ${document.warnings.map(formatYamlError).join('; ')}`)
  }

  walkNode(document.contents, source)

  let value
  try {
    value = document.toJS({
      mapAsMap: false,
      maxAliasCount: 0,
    })
  } catch (error) {
    throw new Error(`${source}: ${formatYamlError(error)}`)
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source}: top-level YAML value must be a mapping`)
  }
  return value
}

export function parseYamlDocument(text, source = '<yaml>') {
  return parseYaml(text, source)
}
