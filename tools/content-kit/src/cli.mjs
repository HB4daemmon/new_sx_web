import { formatValidationReport, validateContent } from './validator.mjs'
import { DOCUMENT_PATHS, checkDocuments, renderDocuments, writeDocuments } from './renderer.mjs'

function print(text) {
  process.stdout.write(`${text}\n`)
}

function fail(report) {
  process.stderr.write(`${formatValidationReport(report)}\n`)
  process.exitCode = 1
}

const command = process.argv[2] ?? 'validate'
const report = await validateContent()

if (command === 'validate') {
  if (!report.ok) {
    fail(report)
  } else {
    print(formatValidationReport(report))
  }
} else if (command === 'docs' || command === 'docs:check') {
  if (!report.ok) {
    fail(report)
  } else {
    try {
      const pages = renderDocuments(report)
      if (pages.size !== DOCUMENT_PATHS.length || DOCUMENT_PATHS.some((documentPath) => !pages.has(documentPath))) {
        throw new Error('renderer output does not match the fixed 32-page document set')
      }
      if (command === 'docs') {
        const result = await writeDocuments(pages)
        print(`generated ${result.paths.length} documents under ${result.outputRoot}`)
      } else {
        const result = await checkDocuments(pages)
        print(`docs check passed: ${result.paths.length} fixed documents; no generated content drift`)
      }
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    }
  }
} else {
  process.stderr.write(`unknown command ${command}; use validate, docs, or docs:check\n`)
  process.exitCode = 1
}
