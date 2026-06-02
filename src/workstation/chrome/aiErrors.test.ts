import { humanizeAiError } from './aiErrors'

describe('humanizeAiError', () => {
  it('classifies rate-limit / 429 / quota errors', () => {
    expect(humanizeAiError('executeChain: Chain execution failed: 429 You exceeded your current quota'))
      .toMatch(/Rate limited.*429.*retry/i)
    expect(humanizeAiError('Error: rate limit reached for requests')).toMatch(/Rate limited/i)
    expect(humanizeAiError('429 Too Many Requests')).toMatch(/Rate limited/i)
  })

  it('classifies auth / API key errors', () => {
    expect(humanizeAiError('401 Incorrect API key provided')).toMatch(/API key/i)
    expect(humanizeAiError('AuthenticationError: invalid api key')).toMatch(/API key/i)
  })

  it('classifies context-length errors', () => {
    expect(humanizeAiError("This model's maximum context length is 8192 tokens"))
      .toMatch(/context window.*stage fewer/i)
  })

  it('classifies network errors', () => {
    expect(humanizeAiError('FetchError: request to https://api… failed, reason: ETIMEDOUT'))
      .toMatch(/Network error.*retry/i)
    expect(humanizeAiError('socket hang up')).toMatch(/Network error/i)
  })

  it('strips the noisy chain-execution prefix for unknown errors', () => {
    expect(humanizeAiError('executeChain: Chain execution failed: Something weird happened'))
      .toBe('Something weird happened')
  })

  it('keeps only the first line of an unknown multi-line error', () => {
    expect(humanizeAiError('Boom\nstack frame 1\nstack frame 2')).toBe('Boom')
  })

  it('falls back gracefully for empty input', () => {
    expect(humanizeAiError('')).toBe('AI request failed.')
    expect(humanizeAiError(undefined)).toBe('AI request failed.')
  })
})
