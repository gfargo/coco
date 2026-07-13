import { Argv } from 'yargs'
import { builder } from './config'

// The builder's `.check()` callback is what enforces the `--pr`/`--comment`/
// `--branch`/`--staged` combination rules (#1596). Exercise it directly
// against a minimal yargs-chain stub instead of a full `.parseSync()`, since
// yargs' default failure handler calls `process.exit` on a thrown check
// error rather than propagating it to the test.
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

describe('review config validation (#1596)', () => {
  const check = extractCheckFn()

  it('rejects --comment without --pr', () => {
    expect(() => check({ comment: true })).toThrow('--comment requires --pr <number>.')
  })

  it('rejects --pr combined with --branch', () => {
    expect(() => check({ pr: 3, branch: 'main' })).toThrow(
      '--pr cannot be combined with --branch or --staged.'
    )
  })

  it('rejects --pr combined with --staged', () => {
    expect(() => check({ pr: 3, staged: true })).toThrow(
      '--pr cannot be combined with --branch or --staged.'
    )
  })

  it('accepts --pr alone', () => {
    expect(check({ pr: 3 })).toBe(true)
  })

  it('accepts --pr with --comment', () => {
    expect(check({ pr: 3, comment: true })).toBe(true)
  })

  it('accepts neither --pr nor --comment', () => {
    expect(check({})).toBe(true)
  })
})
