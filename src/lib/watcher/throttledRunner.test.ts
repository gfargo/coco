import { createThrottledRunner, ThrottledRunnerScheduler } from './throttledRunner'

function createFakeScheduler(): ThrottledRunnerScheduler & { flush: (ms: number) => void } {
  type Pending = { id: number; due: number; callback: () => void }
  const pending: Pending[] = []
  let nextId = 1
  let now = 0

  return {
    now: () => now,
    setTimeout: (callback: () => void, ms: number): number => {
      const id = nextId++
      pending.push({ id, due: now + ms, callback })
      return id
    },
    clearTimeout: (handle: unknown): void => {
      const id = handle as number
      const index = pending.findIndex((entry) => entry.id === id)
      if (index >= 0) pending.splice(index, 1)
    },
    flush: (ms: number): void => {
      now += ms
      while (pending.length > 0 && pending[0].due <= now) {
        const next = pending.shift()!
        next.callback()
      }
    },
  }
}

describe('createThrottledRunner', () => {
  it('runs immediately on the first trigger', async () => {
    const scheduler = createFakeScheduler()
    const runs: number[] = []
    const run = jest.fn(async () => { runs.push(scheduler.now()) })
    const runner = createThrottledRunner(1000, run, scheduler)

    runner.trigger()
    await Promise.resolve()

    expect(runs).toEqual([0])
  })

  it('coalesces triggers that arrive within the cooldown into a single trailing run', async () => {
    const scheduler = createFakeScheduler()
    const runs: number[] = []
    const run = jest.fn(async () => { runs.push(scheduler.now()) })
    const runner = createThrottledRunner(1000, run, scheduler)

    runner.trigger()
    await Promise.resolve()
    expect(runs).toEqual([0])

    // Bursts of triggers inside the cooldown window shouldn't add extra runs.
    runner.trigger()
    runner.trigger()
    runner.trigger()
    expect(runs).toEqual([0])

    scheduler.flush(1000)
    await Promise.resolve()
    await Promise.resolve()

    expect(runs).toEqual([0, 1000])
  })

  it('never overlaps runs — a trigger during an in-flight run queues instead of starting concurrently', async () => {
    const scheduler = createFakeScheduler()
    let resolveFirst: () => void = () => {}
    const started: number[] = []
    const run = jest.fn(() => new Promise<void>((resolve) => {
      started.push(started.length)
      resolveFirst = resolve
    }))
    const runner = createThrottledRunner(0, run, scheduler)

    runner.trigger()
    runner.trigger()
    runner.trigger()
    expect(started).toEqual([0])
    expect(run).toHaveBeenCalledTimes(1)

    resolveFirst()
    await Promise.resolve()
    await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('close() cancels a pending cooldown run without firing it', async () => {
    const scheduler = createFakeScheduler()
    const run = jest.fn(async () => {})
    const runner = createThrottledRunner(1000, run, scheduler)

    runner.trigger()
    await Promise.resolve()
    runner.trigger()
    expect(run).toHaveBeenCalledTimes(1)

    runner.close()
    scheduler.flush(1000)
    await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(1)
  })
})
