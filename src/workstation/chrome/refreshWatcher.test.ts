import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogInkRefreshKind, createRefreshDebouncer, createRefreshWatcher } from './refreshWatcher'

/**
 * Synchronous fake scheduler so we can run debounce timing without
 * involving real timers. Tests step the clock by calling `flush(ms)`.
 */
function createFakeScheduler() {
  type Pending = { id: number; due: number; callback: () => void }
  const pending: Pending[] = []
  let nextId = 1
  let now = 0

  return {
    scheduler: {
      setTimeout: (callback: () => void, ms: number): number => {
        const id = nextId++
        pending.push({ id, due: now + ms, callback })
        return id
      },
      clearTimeout: (handle: unknown): void => {
        const id = handle as number
        const index = pending.findIndex((entry) => entry.id === id)
        if (index >= 0) {
          pending.splice(index, 1)
        }
      },
    },
    flush: (ms: number): void => {
      now += ms
      while (pending.length > 0 && pending[0].due <= now) {
        const next = pending.shift()!
        next.callback()
      }
    },
    pendingCount: () => pending.length,
  }
}

describe('createRefreshDebouncer', () => {
  it('emits exactly one onSettle per debounce window', () => {
    const fake = createFakeScheduler()
    const settles: LogInkRefreshKind[] = []

    const debouncer = createRefreshDebouncer({
      debounceMs: 100,
      scheduler: fake.scheduler,
      onSettle: (kind) => settles.push(kind),
    })

    debouncer.trigger('worktree')
    debouncer.trigger('worktree')
    debouncer.trigger('worktree')

    expect(settles).toEqual([])
    fake.flush(100)
    expect(settles).toEqual(['worktree'])
  })

  it('escalates to "full" when any trigger in the window is full', () => {
    const fake = createFakeScheduler()
    const settles: LogInkRefreshKind[] = []

    const debouncer = createRefreshDebouncer({
      debounceMs: 100,
      scheduler: fake.scheduler,
      onSettle: (kind) => settles.push(kind),
    })

    debouncer.trigger('worktree')
    debouncer.trigger('full')
    debouncer.trigger('worktree')

    fake.flush(100)
    expect(settles).toEqual(['full'])
  })

  it('does NOT downgrade once a "full" is queued in the window', () => {
    const fake = createFakeScheduler()
    const settles: LogInkRefreshKind[] = []

    const debouncer = createRefreshDebouncer({
      debounceMs: 100,
      scheduler: fake.scheduler,
      onSettle: (kind) => settles.push(kind),
    })

    debouncer.trigger('full')
    debouncer.trigger('worktree')
    debouncer.trigger('worktree')

    fake.flush(100)
    expect(settles).toEqual(['full'])
  })

  it('starts a fresh window after the previous one settles', () => {
    const fake = createFakeScheduler()
    const settles: LogInkRefreshKind[] = []

    const debouncer = createRefreshDebouncer({
      debounceMs: 100,
      scheduler: fake.scheduler,
      onSettle: (kind) => settles.push(kind),
    })

    debouncer.trigger('full')
    fake.flush(100)
    expect(settles).toEqual(['full'])

    debouncer.trigger('worktree')
    fake.flush(100)
    expect(settles).toEqual(['full', 'worktree'])
  })

  it('close() cancels any pending settle without firing it', () => {
    const fake = createFakeScheduler()
    const settles: LogInkRefreshKind[] = []

    const debouncer = createRefreshDebouncer({
      debounceMs: 100,
      scheduler: fake.scheduler,
      onSettle: (kind) => settles.push(kind),
    })

    debouncer.trigger('full')
    expect(fake.pendingCount()).toBe(1)

    debouncer.close()
    expect(fake.pendingCount()).toBe(0)

    fake.flush(500)
    expect(settles).toEqual([])
  })
})

/**
 * Integration coverage for the lock-file-rename survival: git updates
 * `.git/index` and `.git/HEAD` by writing `<file>.lock` and renaming over
 * the target, which orphans an inode-following `fs.watch` after the FIRST
 * replacement — the TUI silently stopped auto-refreshing after one
 * external `git add`. The watcher now watches the parent directory and
 * filters by filename, which survives any number of renames.
 */
describe('createRefreshWatcher rename survival', () => {
  // Poll until the watcher has fired, up to a generous ceiling. A fixed
  // 150ms sleep between replacements was timing-flaky under CI load
  // (macOS + coverage): the two replacements' events coalesced into a
  // single debounce settle, or the second settle hadn't landed before
  // close(). Waiting for each settle BEFORE issuing the next
  // replacement makes the sequencing deterministic — and if the
  // watcher genuinely orphans after the first rename (the regression),
  // the wait times out and the count assertion still fails.
  const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (!predicate() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  it('keeps firing for repeated lock+rename replacements of .git/index', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'coco-watch-'))
    const gitDir = join(repoRoot, '.git')
    mkdirSync(gitDir)
    writeFileSync(join(gitDir, 'index'), 'v0')

    const kinds: LogInkRefreshKind[] = []
    const watcher = createRefreshWatcher({
      repoRoot,
      gitDir,
      debounceMs: 20,
      onChange: (kind) => kinds.push(kind),
    })

    try {
      writeFileSync(join(gitDir, 'index.lock'), 'v1')
      renameSync(join(gitDir, 'index.lock'), join(gitDir, 'index'))
      await waitFor(() => kinds.length >= 1)

      // The second replacement is the regression: an inode-following
      // fs.watch is orphaned by the first rename and never fires again.
      writeFileSync(join(gitDir, 'index.lock'), 'v2')
      renameSync(join(gitDir, 'index.lock'), join(gitDir, 'index'))
      await waitFor(() => kinds.length >= 2)
    } finally {
      watcher.close()
      rmSync(repoRoot, { recursive: true, force: true })
    }

    // One settle per replacement — the second rename is the regression.
    expect(kinds.length).toBeGreaterThanOrEqual(2)
    expect(kinds).toContain('worktree')
  }, 15000)
})
