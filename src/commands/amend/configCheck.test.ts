import { Argv } from 'yargs'
import { builder } from './config'

// The builder's `.check()` callback enforces --dry-run/--apply mutual
// exclusion (#1889). Exercise it directly against a minimal yargs-chain
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

describe('amend config validation (#1889)', () => {
  const check = extractCheckFn()

  it('rejects --dry-run combined with --apply', () => {
    expect(() => check({ dryRun: true, apply: true })).toThrow(
      '--dry-run and --apply cannot be combined — --dry-run previews, --apply amends.'
    )
  })

  it('accepts --dry-run alone', () => {
    expect(check({ dryRun: true })).toBe(true)
  })

  it('accepts --apply alone', () => {
    expect(check({ apply: true })).toBe(true)
  })

  it('accepts neither flag', () => {
    expect(check({})).toBe(true)
  })
})
