import { Argv } from 'yargs'
import { builder } from './config'

// Mirrors review/config.test.ts's approach: exercise the builder's
// .check() directly against a minimal yargs-chain stub, since yargs'
// default failure handler calls process.exit on a thrown check error
// rather than propagating it to the test.
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

describe('lint config validation', () => {
  const check = extractCheckFn()

  it('rejects --since combined with --range', () => {
    expect(() => check({ since: 'origin/main', range: 'a..b' })).toThrow(
      '--since and --range are mutually exclusive — pass one or the other.'
    )
  })

  it('rejects --force without --fix', () => {
    expect(() => check({ force: true })).toThrow('--force has no effect without --fix.')
  })

  it('accepts --force with --fix', () => {
    expect(check({ force: true, fix: true })).toBe(true)
  })

  it('accepts --since alone', () => {
    expect(check({ since: 'origin/main' })).toBe(true)
  })

  it('accepts --range alone', () => {
    expect(check({ range: 'a..b' })).toBe(true)
  })

  it('accepts neither flag', () => {
    expect(check({})).toBe(true)
  })
})
