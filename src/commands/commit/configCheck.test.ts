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

  // handler.ts:58 emits a structured `emitJson({ error })` payload when
  // `--json` is combined with `--split`/`--plan`/`--apply`, for machine
  // consumers. These combos must NOT throw here — check() runs before the
  // handler, so throwing would replace that JSON contract with a plain-text
  // yargs failure (#2039 review feedback).
  it('defers to the handler for --json + --plan + --apply instead of throwing', () => {
    expect(check({ json: true, plan: true, apply: true, _: [] })).toBe(true)
  })

  it('defers to the handler for --json + --apply without --split', () => {
    expect(check({ json: true, apply: true, _: [] })).toBe(true)
  })

  it('defers to the handler for --json + --apply + --strict-split without --split', () => {
    expect(check({ json: true, apply: true, strictSplit: true, _: [] })).toBe(true)
  })

  it('defers to the handler for --json + --print-message + --split', () => {
    expect(check({ json: true, printMessage: true, split: true, _: [] })).toBe(true)
  })

  // `--strict-split` alone isn't covered by handler.ts's json guard (it only
  // checks split/plan/apply), so it must still be validated here even under
  // `--json` — otherwise `coco commit --json --strict-split` would silently
  // fall into the draft-only path and drop `--strict-split` (the exact bug
  // #1889 was opened to fix).
  it('still rejects --json + --strict-split without --split or --plan', () => {
    expect(() => check({ json: true, strictSplit: true, _: [] })).toThrow(
      '--strict-split requires --split or --plan.'
    )
  })

  it('accepts --json alone', () => {
    expect(check({ json: true, _: [] })).toBe(true)
  })

  it('accepts --json + --split (handler enforces the json/split conflict)', () => {
    expect(check({ json: true, split: true, _: [] })).toBe(true)
  })
})

// yargs coerces an unparseable --withPreviousCommits value to NaN, and
// `NaN > 0` is false — so a typo silently dropped the requested commit
// history instead of failing loudly (#1893).
describe('commit config validation (#1893)', () => {
  const check = extractCheckFn()

  it('rejects an unparseable --withPreviousCommits (NaN)', () => {
    expect(() => check({ withPreviousCommits: NaN, _: [] })).toThrow(
      '--withPreviousCommits (-p) must be a non-negative integer'
    )
  })

  it('rejects a negative --withPreviousCommits', () => {
    expect(() => check({ withPreviousCommits: -1, _: [] })).toThrow(
      '--withPreviousCommits (-p) must be a non-negative integer'
    )
  })

  it('rejects a non-integer --withPreviousCommits', () => {
    expect(() => check({ withPreviousCommits: 2.5, _: [] })).toThrow(
      '--withPreviousCommits (-p) must be a non-negative integer'
    )
  })

  it('accepts the default --withPreviousCommits of 0', () => {
    expect(check({ withPreviousCommits: 0, _: [] })).toBe(true)
  })

  it('accepts a positive integer --withPreviousCommits', () => {
    expect(check({ withPreviousCommits: 5, _: [] })).toBe(true)
  })

  it('accepts --withPreviousCommits being undefined', () => {
    expect(check({ _: [] })).toBe(true)
  })
})
