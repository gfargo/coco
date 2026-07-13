import {
    coerceConfigValue,
    flattenToDottedPaths,
    getDottedPath,
    setDottedPath,
    splitDottedPath,
    unsetDottedPath,
} from './dottedPath'

describe('splitDottedPath', () => {
  it('splits on dots and drops empty segments', () => {
    expect(splitDottedPath('service.model')).toEqual(['service', 'model'])
    expect(splitDottedPath('a..b')).toEqual(['a', 'b'])
    expect(splitDottedPath('')).toEqual([])
  })
})

describe('getDottedPath', () => {
  it('reads a nested value', () => {
    expect(getDottedPath({ service: { model: 'gpt-4o' } }, 'service.model')).toBe('gpt-4o')
  })

  it('returns undefined when a segment is missing', () => {
    expect(getDottedPath({ service: {} }, 'service.model')).toBeUndefined()
    expect(getDottedPath({}, 'service.model')).toBeUndefined()
  })

  it('returns undefined when a segment is not an object', () => {
    expect(getDottedPath({ service: 'not-an-object' }, 'service.model')).toBeUndefined()
  })

  it('reads a top-level value', () => {
    expect(getDottedPath({ defaultBranch: 'main' }, 'defaultBranch')).toBe('main')
  })
})

describe('setDottedPath', () => {
  it('sets a top-level value', () => {
    const obj: Record<string, unknown> = {}
    setDottedPath(obj, 'defaultBranch', 'develop')
    expect(obj).toEqual({ defaultBranch: 'develop' })
  })

  it('creates intermediate objects as needed', () => {
    const obj: Record<string, unknown> = {}
    setDottedPath(obj, 'service.model', 'gpt-4o')
    expect(obj).toEqual({ service: { model: 'gpt-4o' } })
  })

  it('preserves sibling keys when setting a nested value', () => {
    const obj: Record<string, unknown> = { service: { provider: 'openai' } }
    setDottedPath(obj, 'service.model', 'gpt-4o')
    expect(obj).toEqual({ service: { provider: 'openai', model: 'gpt-4o' } })
  })

  it('overwrites a non-object intermediate value with an object', () => {
    const obj: Record<string, unknown> = { service: 'oops' }
    setDottedPath(obj, 'service.model', 'gpt-4o')
    expect(obj).toEqual({ service: { model: 'gpt-4o' } })
  })
})

describe('unsetDottedPath', () => {
  it('removes a top-level key', () => {
    const obj: Record<string, unknown> = { defaultBranch: 'main', mode: 'stdout' }
    unsetDottedPath(obj, 'defaultBranch')
    expect(obj).toEqual({ mode: 'stdout' })
  })

  it('removes a nested key, preserving siblings', () => {
    const obj: Record<string, unknown> = { service: { provider: 'openai', model: 'gpt-4o' } }
    unsetDottedPath(obj, 'service.model')
    expect(obj).toEqual({ service: { provider: 'openai' } })
  })

  it('is a no-op when the path does not exist', () => {
    const obj: Record<string, unknown> = { service: { provider: 'openai' } }
    unsetDottedPath(obj, 'service.nonexistent.deep')
    expect(obj).toEqual({ service: { provider: 'openai' } })
  })
})

describe('flattenToDottedPaths', () => {
  it('flattens nested objects into dotted keys', () => {
    expect(
      flattenToDottedPaths({ service: { provider: 'openai', model: 'gpt-4o' }, defaultBranch: 'main' })
    ).toEqual({
      'service.provider': 'openai',
      'service.model': 'gpt-4o',
      defaultBranch: 'main',
    })
  })

  it('skips undefined leaves rather than emitting the literal string "undefined"', () => {
    expect(flattenToDottedPaths({ service: { model: 'gpt-4o', baseURL: undefined } })).toEqual({
      'service.model': 'gpt-4o',
    })
  })

  it('keeps arrays as leaf values (does not recurse into them)', () => {
    expect(flattenToDottedPaths({ ignoredFiles: ['a', 'b'] })).toEqual({
      ignoredFiles: ['a', 'b'],
    })
  })
})

describe('coerceConfigValue', () => {
  it('coerces booleans', () => {
    expect(coerceConfigValue('true')).toBe(true)
    expect(coerceConfigValue('false')).toBe(false)
  })

  it('coerces null', () => {
    expect(coerceConfigValue('null')).toBeNull()
  })

  it('coerces numeric strings to numbers', () => {
    expect(coerceConfigValue('42')).toBe(42)
    expect(coerceConfigValue('0.7')).toBe(0.7)
  })

  it('parses JSON arrays and objects', () => {
    expect(coerceConfigValue('["a","b"]')).toEqual(['a', 'b'])
    expect(coerceConfigValue('{"a":1}')).toEqual({ a: 1 })
  })

  it('falls back to the raw string when not JSON/boolean/number', () => {
    expect(coerceConfigValue('gpt-4o')).toBe('gpt-4o')
    expect(coerceConfigValue('http://localhost:1234/v1')).toBe('http://localhost:1234/v1')
  })
})
