import { watch as fsWatch } from 'node:fs'
import path from 'node:path'

import { createSerialBuildQueue, SOURCE_ROOT } from './build-core.mjs'

export const DEFAULT_DEBOUNCE_MS = 250

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeFilename(filename) {
  if (filename === null || filename === undefined) {
    return null
  }
  if (Buffer.isBuffer(filename)) {
    return filename.toString()
  }
  return String(filename)
}

function relativeEventPath(sourceRoot, filename) {
  const normalized = normalizeFilename(filename)
  if (normalized === null || normalized === '') {
    return normalized
  }

  const portable = normalized.replaceAll('\\', '/')
  const looksAbsolute = path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(portable)
  if (!looksAbsolute) {
    return portable
  }

  const root = path.resolve(sourceRoot)
  const candidate = path.resolve(normalized)
  return path.relative(root, candidate).replaceAll('\\', '/')
}

/**
 * Return whether an fs.watch filename can refer to an approved source path.
 *
 * A null filename is deliberately treated as public: fs.watch uses it when
 * the platform cannot identify the changed path, so skipping it could miss a
 * source change. Known dot- and underscore-prefixed paths are ignored because
 * they are private/editor metadata rather than public documents.
 */
export function isPublicSourcePath(filename, sourceRoot = SOURCE_ROOT) {
  const relative = relativeEventPath(sourceRoot, filename)
  if (relative === null || relative === '') {
    return true
  }

  const segments = relative.split(/[\\/]+/).filter(Boolean)
  if (segments.length === 0) {
    return true
  }
  if (path.isAbsolute(relative) || segments.some((segment) => segment === '..')) {
    return false
  }
  return !segments.some((segment) => segment.startsWith('.') || segment.startsWith('_'))
}

/**
 * Decide whether an fs.watch event should invalidate the published site.
 *
 * Markdown changes are unambiguous. A rename event without a Markdown suffix
 * is intentionally conservative because fs.watch does not tell us whether
 * that path was a directory; it may represent a subtree moving into or out
 * of the source tree. Ordinary non-Markdown change events remain ignored.
 */
export function shouldScheduleBuild(eventType, filename, sourceRoot = SOURCE_ROOT) {
  if (!isPublicSourcePath(filename, sourceRoot)) {
    return false
  }

  const normalized = normalizeFilename(filename)
  if (normalized === null || normalized === '') {
    return true
  }

  if (normalized.toLowerCase().replaceAll('\\', '/').endsWith('.md')) {
    return true
  }

  return String(eventType).toLowerCase() === 'rename'
}

export function createSourceWatcher({
  build,
  sourceRoot = SOURCE_ROOT,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  watchFactory = fsWatch,
  queueFactory = createSerialBuildQueue,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  logger = console,
  onError,
} = {}) {
  if (typeof build !== 'function') {
    throw new TypeError('watch build must be a function')
  }
  if (typeof watchFactory !== 'function') {
    throw new TypeError('watchFactory must be a function')
  }
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new RangeError('watch debounceMs must be a non-negative number')
  }

  const log = typeof logger?.log === 'function' ? logger.log.bind(logger) : () => {}
  const logError =
    typeof logger?.error === 'function' ? logger.error.bind(logger) : () => {}

  let watcher = null
  let watcherClosed = false
  let debounceTimer = null
  let startPromise = null
  let stopPromise = null
  let started = false
  let stopping = false
  let stopped = false
  let watcherError = null
  let errorReported = false

  const queue = queueFactory(async () => {
    try {
      const result = await build({ sourceRoot })
      if (result?.releaseDir) {
        log(`[watch] Published ${result.releaseDir}`)
      }
    } catch (error) {
      logError(
        `[watch] Build failed; previous release remains active: ${errorMessage(error)}`,
      )
    }
  })

  if (
    !queue ||
    typeof queue.request !== 'function' ||
    typeof queue.waitForIdle !== 'function'
  ) {
    throw new TypeError('queueFactory must return a serial build queue')
  }

  function clearDebounceTimer() {
    if (debounceTimer !== null) {
      clearTimeoutFn(debounceTimer)
      debounceTimer = null
    }
  }

  function scheduleBuild() {
    if (stopping) {
      return false
    }

    clearDebounceTimer()
    debounceTimer = setTimeoutFn(() => {
      debounceTimer = null
      if (!stopping) {
        queue.request()
      }
    }, debounceMs)
    return true
  }

  function handleEvent(eventType, filename) {
    if (stopping || !shouldScheduleBuild(eventType, filename, sourceRoot)) {
      return false
    }
    return scheduleBuild()
  }

  function closeWatcher() {
    if (watcherClosed || !watcher) {
      return
    }
    watcherClosed = true
    try {
      watcher.close()
    } catch (error) {
      logError(`[watch] Failed to close watcher: ${errorMessage(error)}`)
    }
  }

  function reportWatcherError(error) {
    if (watcherError) {
      return
    }
    watcherError = error instanceof Error ? error : new Error(String(error))
    logError(`[watch] Watcher error: ${watcherError.message}`)
    void stop().then(
      () => {
        if (errorReported || typeof onError !== 'function') {
          return
        }
        errorReported = true
        try {
          onError(watcherError)
        } catch (callbackError) {
          logError(`[watch] Watcher error callback failed: ${errorMessage(callbackError)}`)
        }
      },
      (stopError) => {
        logError(`[watch] Failed to stop after watcher error: ${errorMessage(stopError)}`)
      },
    )
  }

  async function start() {
    if (startPromise) {
      return startPromise
    }

    startPromise = (async () => {
      if (stopping || stopped) {
        throw new Error('Cannot start a stopped source watcher')
      }

      try {
        watcher = watchFactory(sourceRoot, { recursive: true }, handleEvent)
        if (!watcher || typeof watcher.close !== 'function') {
          throw new TypeError('watchFactory must return a watcher with close()')
        }
        if (typeof watcher.on === 'function') {
          watcher.on('error', reportWatcherError)
        }
      } catch (error) {
        stopping = true
        clearDebounceTimer()
        closeWatcher()
        logError(`[watch] Failed to start watcher for ${sourceRoot}: ${errorMessage(error)}`)
        throw error
      }

      started = true
      log(`[watch] Initial build for ${sourceRoot}`)
      queue.request()
      await queue.waitForIdle()

      if (!stopping) {
        log(`[watch] Watching ${sourceRoot} (debounce ${debounceMs}ms)`)
      }
      return controller
    })()

    return startPromise
  }

  async function stop() {
    if (stopPromise) {
      return stopPromise
    }

    stopPromise = (async () => {
      stopping = true
      clearDebounceTimer()
      closeWatcher()
      await queue.waitForIdle()
      stopped = true
      if (started) {
        log('[watch] Stopped')
      }
    })()
    return stopPromise
  }

  const controller = {
    handleEvent,
    scheduleBuild,
    start,
    stop,
    waitForIdle: () => queue.waitForIdle(),
    get queue() {
      return queue
    },
    get watcher() {
      return watcher
    },
    get watcherError() {
      return watcherError
    },
    get stopping() {
      return stopping
    },
  }

  return controller
}
