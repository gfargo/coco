import {
  BLAME_HYDRATION_DELAY_MS,
  DETAIL_HYDRATION_DELAY_MS,
  shouldHydrate,
} from './useDetailHydration'

/**
 * Unit tests for the pure `shouldHydrate` core (0.72 app.ts decomposition,
 * PR 7). No React harness — the hook (`useDetailHydration`) is a verbatim
 * lift of three debounced effects, validated by the green build; only the
 * extracted "fetch only if not already cached" decision is exercised here.
 */
describe('shouldHydrate', () => {
  it('hydrates (true) when the cache is undefined', () => {
    expect(shouldHydrate(42, undefined)).toBe(true)
    expect(shouldHydrate('src/app.ts', undefined)).toBe(true)
  })

  it('hydrates (true) when the key is absent from the cache', () => {
    const cache = new Map<number, unknown>([[1, {}]])
    expect(shouldHydrate(2, cache)).toBe(true)
  })

  it('skips (false) when the key is already cached', () => {
    const cache = new Map<number, unknown>([[7, {}]])
    expect(shouldHydrate(7, cache)).toBe(false)
  })

  it('skips (false) for a cached path key', () => {
    const cache = new Map<string, unknown>([['src/app.ts', {}]])
    expect(shouldHydrate('src/app.ts', cache)).toBe(false)
  })

  it('treats a key cached with a falsy value as present (skip)', () => {
    // `.has` is what the guard keys off, not the stored value — a cached
    // entry whose value is falsy must still suppress a refetch.
    const cache = new Map<number, unknown>([[0, undefined]])
    expect(shouldHydrate(0, cache)).toBe(false)
  })
})

describe('debounce constants', () => {
  it('preserves the issue / PR detail debounce window verbatim', () => {
    expect(DETAIL_HYDRATION_DELAY_MS).toBe(250)
  })

  it('preserves the blame debounce window verbatim', () => {
    expect(BLAME_HYDRATION_DELAY_MS).toBe(150)
  })
})
