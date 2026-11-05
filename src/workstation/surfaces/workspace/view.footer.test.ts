import { flattenStatusText } from './view'

describe('flattenStatusText (#2166)', () => {
  it('turns newlines, carriage returns and whitespace runs into single spaces', () => {
    expect(flattenStatusText('line one\r\nline two\n\n  line   three')).toBe('line one line two line three')
  })

  it('leaves a one-line status alone', () => {
    expect(flattenStatusText('Fetched 3 repos.')).toBe('Fetched 3 repos.')
  })

  it('trims, and an empty status stays empty', () => {
    expect(flattenStatusText('  \n ')).toBe('')
    expect(flattenStatusText('')).toBe('')
  })
})
