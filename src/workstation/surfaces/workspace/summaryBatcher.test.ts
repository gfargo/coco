import type { WorkspaceRepoSummary } from '../../../git/workspaceData'
import { createSummaryBatcher } from './summaryBatcher'

const repo = (name: string): WorkspaceRepoSummary => ({ path: `/r/${name}`, name, ahead: 0, behind: 0, dirty: 0 })

function fakeScheduler() {
  let pending: (() => void) | undefined
  return {
    schedule: (fn: () => void) => { pending = fn; return 1 },
    unschedule: () => { pending = undefined },
    fire: () => { const fn = pending; pending = undefined; fn?.() },
    hasPending: () => pending !== undefined,
  }
}

describe('createSummaryBatcher (#2210)', () => {
  it('coalesces pushes into one emit per interval', () => {
    const emit = jest.fn()
    const clock = fakeScheduler()
    const batcher = createSummaryBatcher(emit, clock)

    batcher.push(repo('a'))
    batcher.push(repo('b'))
    batcher.push(repo('c'))
    expect(emit).not.toHaveBeenCalled()

    clock.fire()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].map((r: WorkspaceRepoSummary) => r.name)).toEqual(['a', 'b', 'c'])
  })

  it('re-arms for pushes that arrive after a flush', () => {
    const emit = jest.fn()
    const clock = fakeScheduler()
    const batcher = createSummaryBatcher(emit, clock)

    batcher.push(repo('a'))
    clock.fire()
    batcher.push(repo('b'))
    expect(clock.hasPending()).toBe(true)
    clock.fire()
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('flush emits immediately and disarms the timer', () => {
    const emit = jest.fn()
    const clock = fakeScheduler()
    const batcher = createSummaryBatcher(emit, clock)

    batcher.push(repo('a'))
    batcher.flush()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(clock.hasPending()).toBe(false)
  })

  it('cancel drops queued summaries without emitting', () => {
    const emit = jest.fn()
    const clock = fakeScheduler()
    const batcher = createSummaryBatcher(emit, clock)

    batcher.push(repo('a'))
    batcher.cancel()
    clock.fire()
    batcher.flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not emit empty batches', () => {
    const emit = jest.fn()
    createSummaryBatcher(emit, fakeScheduler()).flush()
    expect(emit).not.toHaveBeenCalled()
  })
})
