import { getLanguageContext } from './languageContext'

describe('getLanguageContext', () => {
  it('returns an empty string when language is unset', () => {
    expect(getLanguageContext(undefined, { taskDescription: 'commit message' })).toBe('')
  })

  it('returns an empty string for an empty-string language', () => {
    expect(getLanguageContext('', { taskDescription: 'commit message' })).toBe('')
  })

  it('builds a plain instruction sentence when set', () => {
    expect(getLanguageContext('German', { taskDescription: 'changelog' })).toBe(
      'Write the changelog in German.'
    )
  })

  it('appends the Conventional Commits token caveat when requested', () => {
    expect(
      getLanguageContext('Spanish', { taskDescription: 'commit message', preserveConventionalTokens: true })
    ).toBe(
      'Write the commit message in Spanish. Keep the Conventional Commits type/scope tokens (e.g. feat, fix, chore) in English.'
    )
  })

  it('omits the caveat when preserveConventionalTokens is false or unset', () => {
    expect(
      getLanguageContext('Spanish', { taskDescription: 'commit message', preserveConventionalTokens: false })
    ).toBe('Write the commit message in Spanish.')
    expect(getLanguageContext('Spanish', { taskDescription: 'commit message' })).toBe(
      'Write the commit message in Spanish.'
    )
  })
})
