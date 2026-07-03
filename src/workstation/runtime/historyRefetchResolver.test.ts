import type { LogArgv } from '../../commands/log/config'
import {
  buildHistoryRefetchArgv,
  resolveHistoryRefetch,
} from './historyRefetchResolver'

const argv = (over: Partial<LogArgv> = {}): LogArgv =>
  ({
    $0: 'coco',
    _: ['log'],
    interactive: true,
    ...over,
  }) as LogArgv

describe('buildHistoryRefetchArgv', () => {
  it('applies the full-graph view AND the server-side filter in one argv', () => {
    const merged = buildHistoryRefetchArgv(argv(), true, { author: 'alice' })

    expect(merged.view).toBe('full')
    expect(merged.author).toBe('alice')
  })

  it('keeps the active filter when deriving the compact view (old graph effect dropped it)', () => {
    const merged = buildHistoryRefetchArgv(argv(), false, { path: 'src/' })

    expect(merged.view).toBe('compact')
    expect(merged.path).toBe('src/')
  })

  it('keeps the graph mode when the filter clears (old filter effect dropped it)', () => {
    const merged = buildHistoryRefetchArgv(argv({ view: 'compact' }), false, undefined)

    expect(merged.view).toBe('compact')
    expect(merged.author).toBeUndefined()
    expect(merged.path).toBeUndefined()
  })

  it('preserves the base argv path when no path filter is active', () => {
    const merged = buildHistoryRefetchArgv(argv({ path: 'docs/' }), true, { author: 'bob' })

    expect(merged.path).toBe('docs/')
    expect(merged.author).toBe('bob')
  })
})

describe('resolveHistoryRefetch', () => {
  it('uses the filter copy when the fetch args changed (author)', () => {
    const plan = resolveHistoryRefetch({
      logArgv: argv(),
      fullGraph: true,
      fetchArgs: { author: 'alice' },
      fetchArgsChanged: true,
      fullGraphChanged: false,
    })

    expect(plan.trigger).toBe('filter')
    expect(plan.pendingStatus).toBe('Refetching with author:alice')
    expect(plan.errorStatus).toBe('Failed to refetch with active filter')
    expect(plan.successStatus(12)).toBe('Showing 12 commits matching author:alice')
  })

  it('uses the restore copy when the fetch args cleared', () => {
    const plan = resolveHistoryRefetch({
      logArgv: argv(),
      fullGraph: true,
      fetchArgs: undefined,
      fetchArgsChanged: true,
      fullGraphChanged: false,
    })

    expect(plan.trigger).toBe('filter')
    expect(plan.pendingStatus).toBe('Restoring full log')
    expect(plan.successStatus(40)).toBe('Showing full log')
  })

  it('uses the graph copy when only fullGraph changed', () => {
    const full = resolveHistoryRefetch({
      logArgv: argv(),
      fullGraph: true,
      fetchArgs: undefined,
      fetchArgsChanged: false,
      fullGraphChanged: true,
    })
    expect(full.trigger).toBe('graph')
    expect(full.pendingStatus).toBe('Loading full topology…')
    expect(full.errorStatus).toBe('Failed to refetch graph rows')
    expect(full.successStatus(7)).toBe('Showing 7 commits across all branches')

    const compact = resolveHistoryRefetch({
      logArgv: argv(),
      fullGraph: false,
      fetchArgs: undefined,
      fetchArgsChanged: false,
      fullGraphChanged: true,
    })
    expect(compact.pendingStatus).toBe('Loading compact history…')
    expect(compact.successStatus(7)).toBe('Showing 7 commits (compact)')
  })

  it('treats a run where neither input changed as a repo-frame switch', () => {
    const plan = resolveHistoryRefetch({
      logArgv: argv(),
      fullGraph: true,
      fetchArgs: undefined,
      fetchArgsChanged: false,
      fullGraphChanged: false,
    })

    expect(plan.trigger).toBe('frame')
    expect(plan.pendingStatus).toBe('Loading history…')
    expect(plan.errorStatus).toBe('Failed to load history')
    expect(plan.successStatus(30)).toBe('Showing 30 commits')
  })

  it('a filter change wins the copy when both inputs changed', () => {
    const plan = resolveHistoryRefetch({
      logArgv: argv(),
      fullGraph: false,
      fetchArgs: { path: 'src/' },
      fetchArgsChanged: true,
      fullGraphChanged: true,
    })

    expect(plan.trigger).toBe('filter')
    // The argv still honors BOTH dimensions regardless of the copy.
    expect(plan.argv.view).toBe('compact')
    expect(plan.argv.path).toBe('src/')
  })

  it('always derives the argv from the merged picture, whatever the trigger', () => {
    const plan = resolveHistoryRefetch({
      logArgv: argv(),
      fullGraph: true,
      fetchArgs: { author: 'alice' },
      fetchArgsChanged: false,
      fullGraphChanged: false,
    })

    // Frame-switch refetch keeps the live filter AND the graph mode.
    expect(plan.trigger).toBe('frame')
    expect(plan.argv.view).toBe('full')
    expect(plan.argv.author).toBe('alice')
  })
})
