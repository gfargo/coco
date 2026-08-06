import { Argv } from 'yargs'
import { builder } from './config'

// The builder's `.check()` callback is what enforces the `--limit`
// validation (#1893). Exercise it directly against a minimal yargs-chain
// stub instead of a full `.parseSync()`, since yargs' default failure
// handler calls `process.exit` on a thrown check error rather than
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

describe('prs config validation (#1893)', () => {
  const check = extractCheckFn()

  it('rejects an unparseable --limit (NaN)', () => {
    expect(() => check({ limit: NaN })).toThrow('--limit must be a positive integer')
  })

  it('rejects a negative --limit', () => {
    expect(() => check({ limit: -3 })).toThrow('--limit must be a positive integer')
  })

  it('rejects a non-integer --limit', () => {
    expect(() => check({ limit: 2.5 })).toThrow('--limit must be a positive integer')
  })

  it('accepts a positive integer --limit', () => {
    expect(check({ limit: 5 })).toBe(true)
  })

  it('accepts --limit being undefined (passthrough to gh default)', () => {
    expect(check({})).toBe(true)
  })
})
