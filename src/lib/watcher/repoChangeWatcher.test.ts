import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepoChangeKind, createRepoChangeDebouncer, createRepoChangeWatcher } from './repoChangeWatcher'

/**
 * How long a test waits for a real `fs.watch` event before giving up. A passing
 * test returns the moment the event arrives, so a generous ceiling costs
 * nothing; it exists because macOS FSEvents can deliver seconds late when the
 * machine is busy (a release-it run on a loaded laptop failed on 5 s). A
 * watcher that is genuinely orphaned never fires, so it still fails, just later.
 */
const FS_EVENT_WAIT_MS = 20000

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

describe('createRepoChangeDebouncer', () => {
  it('emits exactly one onSettle per debounce window', () => {
    const fake = createFakeScheduler()
    const settles: RepoChangeKind[] = []

    const debouncer = createRepoChangeDebouncer({
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
    const settles: RepoChangeKind[] = []

    const debouncer = createRepoChangeDebouncer({
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
    const settles: RepoChangeKind[] = []

    const debouncer = createRepoChangeDebouncer({
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
    const settles: RepoChangeKind[] = []

    const debouncer = createRepoChangeDebouncer({
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
    const settles: RepoChangeKind[] = []

    const debouncer = createRepoChangeDebouncer({
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
describe('createRepoChangeWatcher rename survival', () => {
  // Environment-sensitive residue: real fs.watch + real timing under a
  // loaded CI runner can still drop an individual replacement's events
  // outright (see the comment on `waitFor` below). Retry once so a single
  // environment-driven flake doesn't stall the whole CI run — a genuine
  // regression fails both attempts.
  jest.retryTimes(1, { logErrorsBeforeRetry: true })

  // Poll until the watcher has fired, up to a generous ceiling. A fixed
  // 150ms sleep between replacements was timing-flaky under CI load
  // (macOS + coverage): the two replacements' events coalesced into a
  // single debounce settle, or the second settle hadn't landed before
  // close(). Waiting for each settle BEFORE issuing the next
  // replacement makes the sequencing deterministic — and if the
  // watcher genuinely orphans after the first rename (the regression),
  // the wait times out and the count assertion still fails.
  const waitFor = async (predicate: () => boolean, timeoutMs = FS_EVENT_WAIT_MS): Promise<void> => {
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

    const kinds: RepoChangeKind[] = []
    const watcher = createRepoChangeWatcher({
      repoRoot,
      gitDir,
      debounceMs: 20,
      onChange: (kind) => kinds.push(kind),
    })

    try {
      writeFileSync(join(gitDir, 'index.lock'), 'v1')
      renameSync(join(gitDir, 'index.lock'), join(gitDir, 'index'))
      await waitFor(() => kinds.length >= 1)

      // Post-first-rename replacements are the regression: an inode-
      // following fs.watch is orphaned by the first rename and never
      // fires again. macOS under coverage load can DROP an individual
      // replacement's events outright (observed in CI even with the
      // settle-wait), so issue up to five replacements, each with its
      // own settle window — the invariant is "the watcher keeps firing
      // after renames", which any one of them proves. A genuinely
      // orphaned watcher fires for none of them and the count
      // assertion below still fails.
      for (let attempt = 2; attempt <= 6 && kinds.length < 2; attempt += 1) {
        writeFileSync(join(gitDir, 'index.lock'), `v${attempt}`)
        renameSync(join(gitDir, 'index.lock'), join(gitDir, 'index'))
        await waitFor(() => kinds.length >= 2, FS_EVENT_WAIT_MS / 2)
      }
    } finally {
      watcher.close()
      rmSync(repoRoot, { recursive: true, force: true })
    }

    // One settle per replacement — the second rename is the regression.
    expect(kinds.length).toBeGreaterThanOrEqual(2)
    expect(kinds).toContain('worktree')
  }, 90000)
})

/**
 * #2205 — in a linked worktree the per-worktree git dir has no `refs/`;
 * branch refs live in the common dir. A commit made in ANOTHER worktree
 * moves `<common>/refs/heads/<branch>`, which the watcher must see.
 */
describe('createRepoChangeWatcher in a linked worktree (#2205)', () => {
  // Same environment-sensitivity as the rename-survival suite above.
  jest.retryTimes(1, { logErrorsBeforeRetry: true })

  const waitFor = async (predicate: () => boolean, timeoutMs = FS_EVENT_WAIT_MS): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (!predicate() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  const layout = () => {
    const root = mkdtempSync(join(tmpdir(), 'coco-wt-watch-'))
    const common = join(root, 'main', '.git')
    const worktreeGitDir = join(common, 'worktrees', 'feature')
    mkdirSync(join(common, 'refs', 'heads'), { recursive: true })
    mkdirSync(worktreeGitDir, { recursive: true })
    writeFileSync(join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/feature\n')
    const repoRoot = join(root, 'feature-checkout')
    mkdirSync(repoRoot)
    return { root, common, worktreeGitDir, repoRoot }
  }

  it('fires when another worktree moves a branch ref in the common dir', async () => {
    const { root, common, worktreeGitDir, repoRoot } = layout()
    const kinds: RepoChangeKind[] = []
    const watcher = createRepoChangeWatcher({
      repoRoot,
      gitDir: worktreeGitDir,
      commonGitDir: common,
      debounceMs: 50,
      onChange: (kind) => kinds.push(kind),
    })
    try {
      // Let events from the setup writes above (FSEvents can deliver ones
      // from just before the watch began) settle, then start from zero so
      // only the ref write below can satisfy the assertion.
      await new Promise((resolve) => setTimeout(resolve, 400))
      kinds.length = 0
      writeFileSync(join(common, 'refs', 'heads', 'main'), 'abc123\n')
      await waitFor(() => kinds.length > 0)
      expect(kinds).toContain('full')
    } finally {
      watcher.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('still defaults to gitDir/refs/heads for a plain repo (no commonGitDir)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coco-plain-watch-'))
    const gitDir = join(root, '.git')
    mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
    const kinds: RepoChangeKind[] = []
    const watcher = createRepoChangeWatcher({
      repoRoot: root,
      gitDir,
      debounceMs: 50,
      onChange: (kind) => kinds.push(kind),
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 400))
      kinds.length = 0
      writeFileSync(join(gitDir, 'refs', 'heads', 'main'), 'abc123\n')
      await waitFor(() => kinds.length > 0)
      expect(kinds).toContain('full')
    } finally {
      watcher.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
