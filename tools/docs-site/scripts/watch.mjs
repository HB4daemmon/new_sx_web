import { buildSite, SOURCE_ROOT } from './build-core.mjs'
import { createSourceWatcher } from './watch-core.mjs'

const watcher = createSourceWatcher({
  build: buildSite,
  sourceRoot: SOURCE_ROOT,
  onError: () => {
    process.exitCode = 1
  },
})

async function stop() {
  await watcher.stop()
  process.exit(0)
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)

try {
  await watcher.start()
} catch {
  process.exitCode = 1
}
