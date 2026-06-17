import { CommandExitError } from '../utils/commandExit'
import { handleFatalError, isFatalDebug } from './handleFatalError'

describe('isFatalDebug', () => {
  it('is true with --verbose', () => {
    expect(isFatalDebug(['node', 'coco', 'commit', '--verbose'], {})).toBe(true)
  })

  it('is true with the -v alias', () => {
    expect(isFatalDebug(['node', 'coco', '-v'], {})).toBe(true)
  })

  it('is true with COCO_DEBUG set', () => {
    expect(isFatalDebug(['node', 'coco', 'commit'], { COCO_DEBUG: '1' })).toBe(true)
  })

  it('is false without either', () => {
    expect(isFatalDebug(['node', 'coco', 'commit'], {})).toBe(false)
  })
})

describe('handleFatalError', () => {
  function capture(error: unknown, opts: { debug?: boolean } = {}) {
    const out: string[] = []
    const code = handleFatalError(error, { ...opts, write: (line) => out.push(line) })
    return { code, text: out.join('\n') }
  }

  it('returns the exit code for an intentional CommandExitError without printing', () => {
    const out: string[] = []
    const code = handleFatalError(new CommandExitError(2), { write: (l) => out.push(l) })
    expect(code).toBe(2)
    // The handler that threw already printed friendly copy — we must not double up.
    expect(out).toHaveLength(0)
  })

  it('preserves a zero exit code from CommandExitError', () => {
    const out: string[] = []
    expect(handleFatalError(new CommandExitError(0), { write: (l) => out.push(l) })).toBe(0)
    expect(out).toHaveLength(0)
  })

  it('prints a friendly message + issue link and exits 1 for an unexpected error', () => {
    const { code, text } = capture(new Error('kaboom'), { debug: false })
    expect(code).toBe(1)
    expect(text).toContain('unexpected error')
    expect(text).toContain('kaboom')
    expect(text).toContain('https://github.com/gfargo/coco/issues/new/choose')
  })

  it('hides the stack by default and points at --verbose', () => {
    const err = new Error('kaboom')
    err.stack = 'Error: kaboom\n    at secret-internal (/private/path.ts:1:1)'
    const { text } = capture(err, { debug: false })
    expect(text).not.toContain('secret-internal')
    expect(text).toContain('--verbose')
  })

  it('includes the full stack when debug is on', () => {
    const err = new Error('kaboom')
    err.stack = 'Error: kaboom\n    at secret-internal (/private/path.ts:1:1)'
    const { text } = capture(err, { debug: true })
    expect(text).toContain('secret-internal')
  })

  it('handles a non-Error throw (string)', () => {
    const { code, text } = capture('just a string', { debug: false })
    expect(code).toBe(1)
    expect(text).toContain('just a string')
  })

  it('falls back to "Unknown error" for an empty message', () => {
    const { text } = capture(new Error(''), { debug: false })
    expect(text).toContain('Unknown error')
  })
})
