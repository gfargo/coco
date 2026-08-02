import { Argv } from 'yargs'
import { builder } from './config'

// The builder's `.check()` callback enforces the mutually-exclusive split
// flag rules (#1889). Exercise it directly against a minimal yargs-chain
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

describe('commit config validation (#1889)', () => {
  const check = extractCheckFn()

  it('rejects --plan combined with --apply', () => {
    expect(() => check({ plan: true, apply: true, _: [] })).toThrow(
      '--plan and --apply cannot be combined — --plan previews, --apply commits.'
    )
  })

  it('rejects --print-message combined with --split', () => {
    expect(() => check({ printMessage: true, split: true, _: [] })).toThrow(
      '--print-message cannot be combined with --split, --plan, --apply, or --strict-split.'
    )
  })

  it('rejects --print-message combined with --plan', () => {
    expect(() => check({ printMessage: true, plan: true, _: [] })).toThrow(
      '--print-message cannot be combined with --split, --plan, --apply, or --strict-split.'
    )
  })

  it('rejects --apply without --split', () => {
    expect(() => check({ apply: true, _: [] })).toThrow(
      '--apply requires --split (it applies a split plan).'
    )
  })

  it('rejects --strict-split without --split or --plan', () => {
    expect(() => check({ strictSplit: true, _: [] })).toThrow(
      '--strict-split requires --split or --plan.'
    )
  })

  it('accepts --split --apply', () => {
    expect(check({ split: true, apply: true, _: [] })).toBe(true)
  })

  it('accepts --plan alone', () => {
    expect(check({ plan: true, _: [] })).toBe(true)
  })

  it('accepts the `split` positional with --apply', () => {
    expect(check({ apply: true, _: ['commit', 'split'] })).toBe(true)
  })

  it('accepts the `split` positional with --strict-split', () => {
    expect(check({ strictSplit: true, _: ['commit', 'split'] })).toBe(true)
  })

  it('accepts --print-message alone', () => {
    expect(check({ printMessage: true, _: [] })).toBe(true)
  })

  it('accepts no split-related flags', () => {
    expect(check({ _: [] })).toBe(true)
  })
})
