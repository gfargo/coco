import {
  LOG_INK_CONTEXT_KEYS,
  createLogInkContextStatus,
  isLogInkContextKeyLoading,
  isLogInkContextLoading,
  mergeRefreshedContext,
  updateLogInkContextStatus,
} from './context'

describe('log Ink context loading state', () => {
  it('creates consistent context status for every repository context source', () => {
    const status = createLogInkContextStatus('loading')

    expect(Object.keys(status)).toEqual([...LOG_INK_CONTEXT_KEYS])
    expect(isLogInkContextLoading(status)).toBe(true)
    expect(isLogInkContextKeyLoading(status, 'provider')).toBe(true)
  })

  it('updates one context source without mutating the rest', () => {
    const loading = createLogInkContextStatus('loading')
    const next = updateLogInkContextStatus(loading, 'branches', 'ready')

    expect(next.branches).toBe('ready')
    expect(next.provider).toBe('loading')
    expect(loading.branches).toBe('loading')
  })
})

describe('mergeRefreshedContext', () => {
  it('preserves lazy-loaded slices the fresh snapshot does not carry', () => {
    const previous = {
      branches: ['main'],
      pullRequestList: { items: [{ number: 962 }] },
      issueList: { items: [{ number: 1 }] },
    }
    const next = { branches: ['main', 'dev'] }

    const merged = mergeRefreshedContext(previous, next)

    expect(merged.pullRequestList).toBe(previous.pullRequestList)
    expect(merged.issueList).toBe(previous.issueList)
    expect(merged.branches).toEqual(['main', 'dev'])
  })

  it('overwrites boot-fetched keys even when the fresh value is undefined', () => {
    const previous = { branches: ['main'], pullRequestList: { items: [] } }
    const next = { branches: undefined }

    const merged = mergeRefreshedContext(previous, next)

    expect(merged.branches).toBeUndefined()
    expect(merged.pullRequestList).toBe(previous.pullRequestList)
  })
})
