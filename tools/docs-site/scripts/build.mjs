import { buildSite } from './build-core.mjs'

try {
  const result = await buildSite()
  console.log(`Published release: ${result.releaseDir}`)
  console.log(`Current link: ${result.currentLink} -> ${result.relativeTarget}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
