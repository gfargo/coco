import { DefaultLogFields, ListLogLine } from 'simple-git'
import { formatSingleCommit } from './formatSingleCommit'

type CommitEntry = DefaultLogFields & ListLogLine

const base: CommitEntry = {
  hash: 'a1b2c3d4e5f6789',
  date: '2024-01-15',
  message: 'feat: add login page',
  body: '',
  author_name: 'Jane Dev',
  author_email: 'jane@example.com',
  refs: '',
}

describe('formatSingleCommit', () => {
  it('truncates hash to 7 characters', () => {
    const result = formatSingleCommit(base)
    expect(result).toContain('Commit: a1b2c3d')
    expect(result).not.toContain('a1b2c3d4e5f6789')
  })

  it('includes author name', () => {
    expect(formatSingleCommit(base)).toContain('Author: Jane Dev')
  })

  it('includes date', () => {
    expect(formatSingleCommit(base)).toContain('Date: 2024-01-15')
  })

  it('includes message', () => {
    expect(formatSingleCommit(base)).toContain('Message: feat: add login page')
  })

  it('omits Details section when body is empty', () => {
    const result = formatSingleCommit({ ...base, body: '' })
    expect(result).not.toContain('Details:')
  })

  it('includes Details section when body is present', () => {
    const result = formatSingleCommit({ ...base, body: 'Some extra context here.' })
    expect(result).toContain('Details: Some extra context here.')
  })

  it('handles a hash shorter than 7 characters without throwing', () => {
    // substring(0, 7) on a short string just returns the whole string
    const result = formatSingleCommit({ ...base, hash: 'abc' })
    expect(result).toContain('Commit: abc')
  })

  it('handles special characters in message and body', () => {
    const result = formatSingleCommit({
      ...base,
      message: 'fix: handle `null` & <undefined>',
      body: 'Fixes issue #42 — see PR "foo/bar"',
    })
    expect(result).toContain('fix: handle `null` & <undefined>')
    expect(result).toContain('Fixes issue #42')
  })
})
