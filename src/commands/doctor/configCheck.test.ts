import { Argv } from 'yargs'
import { builder } from './config'

// The builder's `.check()` callback enforces that --clear/--cost/--fix are
// mutually exclusive (#1889). Exercise it directly against a minimal
// yargs-chain stub instead of a full `.parseSync()`, since yargs' default
// failure handler calls `process.exit` on a thrown check error rather than
// propagating it to the test.
function extractCheckFn(): (argv: Record<string, unknown>) => boolean {
  let captured: ((argv: Record<string, unknown>) => boolean) | undefined
  const fakeYargs = {
    options: () => fakeYargs,
    check: (fn: (argv: Record<string, unknown>) => boolean) => {
      captured = fn
      return fakeYargs
    },
    usage: () => fakeYargs,
  }
  builder(fakeYargs as unknown as Argv)
  if (!captured) throw new Error('builder did not register a .check() callback')
  return captured
}

describe('doctor config validation (#1889)', () => {
  const check = extractCheckFn()

  it('rejects --clear combined with --cost', () => {
    expect(() => check({ clear: true, cost: true })).toThrow(
      'Options --clear, --cost cannot be used together.'
    )
  })

  it('rejects --clear combined with --fix', () => {
    expect(() => check({ clear: true, fix: true })).toThrow(
      'Options --clear, --fix cannot be used together.'
    )
  })

  it('rejects --cost combined with --fix', () => {
    expect(() => check({ cost: true, fix: true })).toThrow(
      'Options --cost, --fix cannot be used together.'
    )
  })

  it('accepts --clear alone', () => {
    expect(check({ clear: true })).toBe(true)
  })

  it('accepts --cost alone', () => {
    expect(check({ cost: true })).toBe(true)
  })

  it('accepts --fix alone', () => {
    expect(check({ fix: true })).toBe(true)
  })

  it('accepts no flags', () => {
    expect(check({})).toBe(true)
  })
})
