import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createSourceWatcher,
  isPublicSourcePath,
  shouldScheduleBuild,
} from '../scripts/watch-core.mjs'

const quietLogger = Object.freeze({
  log() {},
  error() {},
})

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(message)
    }
    await delay(2)
  }
}

async function temporarySourceRoot() {
  return mkdtemp(path.join(tmpdir(), 'suishi-docs-watch-'))
}

function createInjectedWatch() {
  let callback
  const listeners = new Map()
  const calls = []
  const watcher = {
    closed: false,
    on(eventName, listener) {
      listeners.set(eventName, listener)
      return this
    },
    close() {
      this.closed = true
    },
  }

  return {
    calls,
    watcher,
    factory(sourceRoot, options, onChange) {
      calls.push({ sourceRoot, options })
      callback = onChange
      return watcher
    },
    emit(eventType, filename) {
      assert.equal(typeof callback, 'function', 'watch callback has not been installed')
      callback(eventType, filename)
    },
    fail(error) {
      const listener = listeners.get('error')
      assert.equal(typeof listener, 'function', 'watch error listener has not been installed')
      listener(error)
    },
  }
}

async function startWatcher(options = {}) {
  const sourceRoot = options.sourceRoot ?? (await temporarySourceRoot())
  const injectedWatch = options.injectedWatch ?? createInjectedWatch()
  const controller = createSourceWatcher({
    sourceRoot,
    watchFactory: injectedWatch.factory,
    debounceMs: options.debounceMs ?? 5,
    logger: quietLogger,
    ...options,
  })
  await controller.start()
  return { controller, injectedWatch, sourceRoot }
}

test('source event filtering ignores private paths and unrelated changes', () => {
  const sourceRoot = '/tmp/docs/shanhai'

  assert.equal(isPublicSourcePath('rework/README.md', sourceRoot), true)
  assert.equal(isPublicSourcePath('rework/.draft.md', sourceRoot), false)
  assert.equal(isPublicSourcePath('_cache/README.md', sourceRoot), false)
  assert.equal(isPublicSourcePath('rework/_generated/README.md', sourceRoot), false)
  assert.equal(isPublicSourcePath('/tmp/other/README.md', sourceRoot), false)

  assert.equal(shouldScheduleBuild('change', 'rework/README.md', sourceRoot), true)
  assert.equal(shouldScheduleBuild('rename', 'rework/content', sourceRoot), true)
  assert.equal(shouldScheduleBuild('change', 'rework/notes.txt', sourceRoot), false)
  assert.equal(shouldScheduleBuild('change', '.draft.md', sourceRoot), false)
  assert.equal(shouldScheduleBuild('rename', '_drafts', sourceRoot), false)
  assert.equal(shouldScheduleBuild('rename', null, sourceRoot), true)
})

test('a watcher requires an explicit build operation and cannot publish by default', () => {
  assert.throws(() => createSourceWatcher(), /watch build must be a function/)
})

test('startup builds once and captures Markdown changes and directory moves', async (t) => {
  const sourceRoot = await temporarySourceRoot()
  const builds = []
  const started = await startWatcher({
    sourceRoot,
    build: async ({ sourceRoot: receivedRoot }) => {
      builds.push(receivedRoot)
      return { releaseDir: `release-${builds.length}` }
    },
  })
  t.after(() => started.controller.stop())

  assert.deepEqual(builds, [sourceRoot])
  assert.equal(started.injectedWatch.calls.length, 1)
  assert.equal(started.injectedWatch.calls[0].sourceRoot, sourceRoot)
  assert.deepEqual(started.injectedWatch.calls[0].options, { recursive: true })

  started.injectedWatch.emit('rename', 'new.md')
  await waitFor(() => builds.length === 2, 'new Markdown file did not trigger a build')

  started.injectedWatch.emit('change', 'new.md')
  await waitFor(() => builds.length === 3, 'changed Markdown file did not trigger a build')

  started.injectedWatch.emit('rename', 'new.md')
  await waitFor(() => builds.length === 4, 'deleted Markdown file did not trigger a build')

  started.injectedWatch.emit('rename', 'moved-directory')
  await waitFor(() => builds.length === 5, 'directory move did not trigger a build')
})

test('a new directory and its later Markdown file both invalidate the site', async (t) => {
  const builds = []
  const started = await startWatcher({
    build: async () => {
      builds.push(Date.now())
    },
  })
  t.after(() => started.controller.stop())

  started.injectedWatch.emit('rename', 'new-directory')
  await waitFor(() => builds.length === 2, 'new directory did not trigger a build')

  started.injectedWatch.emit('rename', 'new-directory/page.md')
  await waitFor(() => builds.length === 3, 'Markdown in new directory did not trigger a build')
})

test('debounces bursts and ignores non-Markdown and private events', async (t) => {
  const builds = []
  const started = await startWatcher({
    debounceMs: 15,
    build: async () => {
      builds.push(Date.now())
    },
  })
  t.after(() => started.controller.stop())

  started.injectedWatch.emit('change', 'notes.txt')
  started.injectedWatch.emit('change', '.editor.md')
  started.injectedWatch.emit('rename', '_drafts')
  await delay(35)
  assert.equal(builds.length, 1)

  started.injectedWatch.emit('change', 'a.md')
  started.injectedWatch.emit('change', 'b.md')
  started.injectedWatch.emit('rename', 'directory')
  started.injectedWatch.emit('change', null)
  await waitFor(() => builds.length === 2, 'event burst did not produce a debounced build')
  await delay(30)
  assert.equal(builds.length, 2)
})

test('events arriving during a build are queued for a later serial build', async (t) => {
  let buildCount = 0
  let releaseRunningBuild
  const runningBuild = new Promise((resolve) => {
    releaseRunningBuild = resolve
  })
  const started = await startWatcher({
    build: async () => {
      buildCount += 1
      if (buildCount === 2) {
        await runningBuild
      }
    },
  })
  t.after(async () => {
    releaseRunningBuild()
    await started.controller.stop()
  })

  started.injectedWatch.emit('change', 'first.md')
  await waitFor(() => buildCount === 2, 'first rebuild did not start')

  started.injectedWatch.emit('change', 'second.md')
  started.injectedWatch.emit('change', 'third.md')
  await delay(20)
  assert.equal(buildCount, 2, 'a second build started before the first completed')

  releaseRunningBuild()
  await waitFor(() => buildCount === 3, 'event during build was lost')
})

test('a failed build leaves the queue usable for a later successful build', async (t) => {
  let buildCount = 0
  const started = await startWatcher({
    build: async () => {
      buildCount += 1
      if (buildCount === 2) {
        throw new Error('expected test failure')
      }
    },
  })
  t.after(() => started.controller.stop())

  started.injectedWatch.emit('change', 'fails.md')
  await waitFor(() => buildCount === 2, 'failed rebuild did not run')

  started.injectedWatch.emit('change', 'recovers.md')
  await waitFor(() => buildCount === 3, 'watcher did not recover after a failed build')
})

test('stop clears pending debounce, closes the watcher, and waits for an active build', async (t) => {
  let buildCount = 0
  let releaseRunningBuild
  const runningBuild = new Promise((resolve) => {
    releaseRunningBuild = resolve
  })
  const started = await startWatcher({
    debounceMs: 20,
    build: async () => {
      buildCount += 1
      if (buildCount === 2) {
        await runningBuild
      }
    },
  })

  started.injectedWatch.emit('change', 'running.md')
  await waitFor(() => buildCount === 2, 'active rebuild did not start')
  started.injectedWatch.emit('change', 'cancelled.md')

  let stopped = false
  const stopPromise = started.controller.stop().then(() => {
    stopped = true
  })
  await delay(35)
  assert.equal(stopped, false)
  assert.equal(buildCount, 2, 'stopping did not clear a pending debounce')
  assert.equal(started.injectedWatch.watcher.closed, true)

  releaseRunningBuild()
  await stopPromise
  assert.equal(stopped, true)
})

test('watch startup failures are surfaced', async () => {
  const sourceRoot = await temporarySourceRoot()
  const failure = new Error('source root unavailable')
  const controller = createSourceWatcher({
    sourceRoot,
    build: async () => {},
    watchFactory() {
      throw failure
    },
    logger: quietLogger,
  })

  await assert.rejects(controller.start(), failure)
  await controller.stop()
})

test('underlying watcher errors close the watcher and notify the caller', async (t) => {
  const errors = []
  const injectedWatch = createInjectedWatch()
  const started = await startWatcher({
    injectedWatch,
    build: async () => {},
    onError(error) {
      errors.push(error)
    },
  })
  t.after(() => started.controller.stop())

  const failure = new Error('watcher failed')
  injectedWatch.fail(failure)
  await waitFor(() => errors.length === 1, 'watcher error was not reported')

  assert.equal(errors[0], failure)
  assert.equal(started.controller.watcherError, failure)
  assert.equal(injectedWatch.watcher.closed, true)
})
