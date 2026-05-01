import { LogInkRefreshKind, createRefreshDebouncer } from './inkRefreshWatcher'

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
