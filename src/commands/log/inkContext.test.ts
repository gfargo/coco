import {
  LOG_INK_CONTEXT_KEYS,
  createLogInkContextStatus,
  isLogInkContextKeyLoading,
  isLogInkContextLoading,
  updateLogInkContextStatus,
} from './inkContext'

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
