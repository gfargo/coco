import { Argv } from 'yargs'
import { builder } from './config'

// The builder's `.check()` callback is what enforces both the `--tag`
// positional guard (#1613) and the "only one timeframe selector" rule
// (#1898). Exercise it directly against a minimal yargs-chain stub instead
// of a full `.parseSync()`, since yargs' default failure handler calls
// `process.exit` on a thrown check error rather than propagating it to the
// test (see review/config.test.ts for the same pattern).
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

describe('recap config validation (#1898)', () => {
  const check = extractCheckFn()

  it('rejects --yesterday combined with --timeframe', () => {
    expect(() => check({ yesterday: true, timeframe: 'last-week', _: ['recap'] })).toThrow(
      'Only one timeframe selector may be used at a time — got --yesterday, --timeframe.'
    )
  })

  it('rejects --yesterday combined with --last-week', () => {
    expect(() => check({ yesterday: true, 'last-week': true, _: ['recap'] })).toThrow(
      /Only one timeframe selector may be used at a time/
    )
  })

  it('rejects --last-month combined with --currentBranch, naming the flag as --currentBranch', () => {
    expect(() =>
      check({ 'last-month': true, currentBranch: true, _: ['recap'] })
    ).toThrow('Only one timeframe selector may be used at a time — got --last-month, --currentBranch.')
  })

  it('rejects --tag combined with --yesterday', () => {
    expect(() => check({ tag: true, yesterday: true, _: ['recap'] })).toThrow(
      'Only one timeframe selector may be used at a time — got --yesterday, --last-tag.'
    )
  })

  it('rejects the --week alias combined with --yesterday', () => {
    expect(() => check({ 'last-week': true, yesterday: true, _: ['recap'] })).toThrow(
      /Only one timeframe selector may be used at a time/
    )
  })

  it('accepts a single --yesterday selector', () => {
    expect(check({ yesterday: true, _: ['recap'] })).toBe(true)
  })

  it('accepts a single --timeframe selector', () => {
    expect(check({ timeframe: 'last-week', _: ['recap'] })).toBe(true)
  })

  it('accepts no timeframe selector at all', () => {
    expect(check({ _: ['recap'] })).toBe(true)
  })

  it('still rejects --tag with a stray positional value (#1613 regression)', () => {
    expect(() => check({ tag: true, _: ['recap', 'v1.0.0'] })).toThrow(
      /--tag on recap takes no value/
    )
  })

  describe('flag naming reflects the alias the user actually typed', () => {
    // yargs syncs alias values onto every name (`--tag` also sets `last-tag`
    // in the parsed argv), so the check can't tell which alias was typed from
    // argv alone — it falls back to scanning `process.argv`. Simulate that by
    // overriding it for the duration of each test.
    const withRawArgv = (rawArgs: string[], fn: () => void) => {
      const original = process.argv
      process.argv = ['node', 'coco', ...rawArgs]
      try {
        fn()
      } finally {
        process.argv = original
      }
    }

    it('names --tag when that is the alias the user typed', () => {
      withRawArgv(['recap', '--tag', '--yesterday'], () => {
        expect(() => check({ tag: true, 'last-tag': true, yesterday: true, _: ['recap'] })).toThrow(
          'Only one timeframe selector may be used at a time — got --yesterday, --tag.'
        )
      })
    })

    it('names --last-tag when that is the alias the user typed', () => {
      withRawArgv(['recap', '--last-tag', '--yesterday'], () => {
        expect(() => check({ tag: true, 'last-tag': true, yesterday: true, _: ['recap'] })).toThrow(
          'Only one timeframe selector may be used at a time — got --yesterday, --last-tag.'
        )
      })
    })

    it('names --week when that is the alias the user typed', () => {
      withRawArgv(['recap', '--week', '--yesterday'], () => {
        expect(() =>
          check({ 'last-week': true, yesterday: true, _: ['recap'] })
        ).toThrow('Only one timeframe selector may be used at a time — got --yesterday, --week.')
      })
    })
  })
})
