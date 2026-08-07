import { Catalog, t } from './t'

const catalog: Catalog = {
  'greeting.hello': 'Hello!',
  'greeting.named': (args) => `Hello, ${args.name}!`,
}

describe('t', () => {
  it('returns a static string entry as-is', () => {
    expect(t(catalog, 'greeting.hello')).toBe('Hello!')
  })

  it('interpolates a function entry using args', () => {
    expect(t(catalog, 'greeting.named', { name: 'Ada' })).toBe('Hello, Ada!')
  })

  it('falls back to the key itself when the key is missing', () => {
    expect(t(catalog, 'greeting.missing')).toBe('greeting.missing')
  })

  it('calls a function entry with an empty object when args are omitted', () => {
    expect(t(catalog, 'greeting.named')).toBe('Hello, undefined!')
  })
})
