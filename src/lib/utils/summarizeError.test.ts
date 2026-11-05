import { homedir } from 'node:os'
import { DEFAULT_ERROR_SUMMARY_LENGTH, summarizeError } from './summarizeError'

describe('summarizeError (#2166)', () => {
  it('keeps the first line of a multi-line git error, not the advice after it', () => {
    const error = new Error(
      'ssh: connect to host 127.0.0.1 port 1: Connection refused\r\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.',
    )
    expect(summarizeError(error)).toBe('ssh: connect to host 127.0.0.1 port 1: Connection refused')
  })

  it('skips leading hint lines to reach the cause', () => {
    expect(summarizeError('hint: use --force\nerror: failed to push some refs')).toBe('failed to push some refs')
  })

  it('drops fatal:, error: and warning: prefixes, even stacked', () => {
    expect(summarizeError(new Error('fatal: not a git repository (or any of the parent directories): .git')))
      .toBe('not a git repository (or any of the parent directories): .git')
    expect(summarizeError('Error: fatal: boom')).toBe('boom')
    expect(summarizeError('warning: LF will be replaced')).toBe('LF will be replaced')
  })

  it('strips ANSI colors, OSC sequences and control characters', () => {
    expect(summarizeError('\u001b[31mfatal:\u001b[0m something\u0007 broke\u0000')).toBe('something broke')
    expect(summarizeError('\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007 text')).toBe('link text')
  })

  it('shortens the home directory to ~', () => {
    const home = homedir()
    if (home && home !== '/') {
      expect(summarizeError(`ENOENT: no such file or directory, scandir '${home}/dev/app'`)).toBe(
        "ENOENT: no such file or directory, scandir '~/dev/app'",
      )
    }
  })

  it('caps the length and ends in an ellipsis', () => {
    const summary = summarizeError('x'.repeat(500), { maxLength: 40 })
    expect(summary).toHaveLength(40)
    expect(summary.endsWith('…')).toBe(true)
    expect(summarizeError('y'.repeat(500))).toHaveLength(DEFAULT_ERROR_SUMMARY_LENGTH)
  })

  it('leaves a short message alone', () => {
    expect(summarizeError('gh: not found')).toBe('gh: not found')
  })

  it('uses the fallback for non-errors, empty messages and messages that were only noise', () => {
    expect(summarizeError(undefined, { fallback: 'Refresh failed.' })).toBe('Refresh failed.')
    expect(summarizeError(new Error(''), { fallback: 'Refresh failed.' })).toBe('Refresh failed.')
    expect(summarizeError('\u001b[0m  \n', { fallback: 'Refresh failed.' })).toBe('Refresh failed.')
    expect(summarizeError('fatal:', { fallback: 'Refresh failed.' })).toBe('Refresh failed.')
    expect(summarizeError({}, {})).toBe('unknown error')
  })

  it('accepts a plain string error', () => {
    expect(summarizeError('boom')).toBe('boom')
  })
})
