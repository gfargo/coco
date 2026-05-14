import {
  getConventionalCommitColor,
  parseConventionalCommitPrefix,
} from './conventionalCommit'
import type { LogInkTheme } from './theme'

const theme: LogInkTheme = {
  ascii: false,
  noColor: false,
  borderStyle: 'round',
  colors: {
    accent: '#cba6f7',
    muted: '#7f849c',
    selection: '#313244',
    success: '#a6e3a1',
    warning: '#f9e2af',
    danger: '#f38ba8',
    info: '#89b4fa',
  },
}

describe('parseConventionalCommitPrefix', () => {
  it('parses a bare type prefix', () => {
    expect(parseConventionalCommitPrefix('feat: add login flow')).toEqual({
      prefix: 'feat: ',
      rest: 'add login flow',
      type: 'feat',
      scope: undefined,
      breaking: false,
    })
  })

  it('parses a typed prefix with a scope', () => {
    expect(parseConventionalCommitPrefix('feat(cli): wire --repo flag')).toEqual({
      prefix: 'feat(cli): ',
      rest: 'wire --repo flag',
      type: 'feat',
      scope: 'cli',
      breaking: false,
    })
  })

  it('captures the breaking marker without a scope', () => {
    expect(parseConventionalCommitPrefix('fix!: drop legacy field')).toMatchObject({
      type: 'fix',
      scope: undefined,
      breaking: true,
    })
  })

  it('captures the breaking marker with a scope', () => {
    expect(parseConventionalCommitPrefix('chore(deps)!: bump react')).toMatchObject({
      type: 'chore',
      scope: 'deps',
      breaking: true,
    })
  })

  it('returns undefined for unconventional subjects', () => {
    expect(parseConventionalCommitPrefix('Add login flow')).toBeUndefined()
    expect(parseConventionalCommitPrefix('Merge branch foo into bar')).toBeUndefined()
    expect(parseConventionalCommitPrefix('')).toBeUndefined()
  })

  it('does not match types with uppercase characters', () => {
    expect(parseConventionalCommitPrefix('Feat: add thing')).toBeUndefined()
    expect(parseConventionalCommitPrefix('FIX: typo')).toBeUndefined()
  })

  it('requires a space after the colon', () => {
    // Conventional spec: prefix is `type: ` with whitespace; without
    // the space we shouldn't claim a match (otherwise `noun: phrase`
    // sentences would all parse as a type).
    expect(parseConventionalCommitPrefix('feat:add thing')).toBeUndefined()
  })

  it('handles multi-character scopes including slashes', () => {
    expect(parseConventionalCommitPrefix('feat(parser/ts): bundle wasm')).toMatchObject({
      type: 'feat',
      scope: 'parser/ts',
    })
  })
})

describe('getConventionalCommitColor', () => {
  const parse = (msg: string) => parseConventionalCommitPrefix(msg)!

  it('maps feat to success', () => {
    expect(getConventionalCommitColor(parse('feat: x'), theme)).toBe(theme.colors.success)
  })

  it('maps fix to warning', () => {
    expect(getConventionalCommitColor(parse('fix: x'), theme)).toBe(theme.colors.warning)
  })

  it('maps docs / refactor / perf to info', () => {
    for (const msg of ['docs: x', 'refactor: x', 'perf: x']) {
      expect(getConventionalCommitColor(parse(msg), theme)).toBe(theme.colors.info)
    }
  })

  it('maps housekeeping types to muted', () => {
    for (const msg of ['test: x', 'style: x', 'build: x', 'ci: x', 'chore: x']) {
      expect(getConventionalCommitColor(parse(msg), theme)).toBe(theme.colors.muted)
    }
  })

  it('maps revert to danger', () => {
    expect(getConventionalCommitColor(parse('revert: x'), theme)).toBe(theme.colors.danger)
  })

  it('falls through to accent for unknown types', () => {
    expect(getConventionalCommitColor(parse('wip: x'), theme)).toBe(theme.colors.accent)
  })

  it('overrides type color with danger when the change is breaking', () => {
    // Breaking feat still reads as "stop and look" — the danger color
    // wins over the per-type mapping.
    expect(getConventionalCommitColor(parse('feat!: x'), theme)).toBe(theme.colors.danger)
    expect(getConventionalCommitColor(parse('chore(deps)!: x'), theme)).toBe(theme.colors.danger)
  })

  it('returns undefined under noColor regardless of type', () => {
    const noColorTheme = { ...theme, noColor: true }
    expect(getConventionalCommitColor(parse('feat: x'), noColorTheme)).toBeUndefined()
    expect(getConventionalCommitColor(parse('fix!: x'), noColorTheme)).toBeUndefined()
  })
})
