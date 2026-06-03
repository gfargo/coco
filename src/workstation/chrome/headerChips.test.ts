/**
 * Tests for the header chip builder. Snapshots aren't appropriate here
 * — chip semantics (which kind, what color category) matter more than
 * exact pixel-level layout, and a snapshot would discourage tweaking
 * label copy (e.g. swapping ⊘ for ◯). Instead the tests assert on
 * chip IDs, colors-by-role, and edge cases that have bitten before.
 */
import { createLogInkTheme } from './theme'
import {
  HEADER_CHIP_SEPARATOR,
  buildHeaderChips,
  measureHeaderChipsWidth,
  type BuildHeaderChipsInput,
} from './headerChips'

function makeInput(overrides: Partial<BuildHeaderChipsInput> = {}): BuildHeaderChipsInput {
  const theme = overrides.theme || createLogInkTheme({ noColor: false })
  return {
    appLabel: 'coco',
    repo: 'gfargo/coco',
    branch: 'main',
    dirty: false,
    bisecting: false,
    pullRequest: undefined,
    breadcrumb: '',
    loading: '',
    mode: 'NORMAL',
    search: '',
    theme,
    ...overrides,
  }
}

describe('buildHeaderChips', () => {
  it('emits the baseline chip set in identity → state → mode order', () => {
    // Default state: clean repo, no PR, no breadcrumb, NORMAL mode.
    // The chip order is load-bearing for scan-ability — identity chips
    // (app/repo/branch) come first, then state (dirty/PR), then
    // navigation (breadcrumb/loading), then mode. With no PR loaded the
    // PR chip is omitted entirely (no "no PR" placeholder).
    const chips = buildHeaderChips(makeInput())
    expect(chips.map((c) => c.id)).toEqual([
      'app',
      'repo',
      'branch',
      'dirty',
      'mode',
    ])
  })

  it('flips the dirty chip to warning when the worktree is dirty', () => {
    const clean = buildHeaderChips(makeInput({ dirty: false }))
    const dirty = buildHeaderChips(makeInput({ dirty: true }))
    const cleanChip = clean.find((c) => c.id === 'dirty')!
    const dirtyChip = dirty.find((c) => c.id === 'dirty')!
    expect(cleanChip.label).toBe('✓ clean')
    expect(cleanChip.color).toBe('green') // theme.colors.success
    expect(dirtyChip.label).toBe('● dirty')
    expect(dirtyChip.color).toBe('yellow') // theme.colors.warning
  })

  it('inserts a BISECTING chip with warning color when bisect is active', () => {
    // Critical for users entering the TUI mid-bisect — they need to
    // see the state immediately, before they hunt for `gB`.
    const chips = buildHeaderChips(makeInput({ bisecting: true }))
    const bisect = chips.find((c) => c.id === 'bisecting')!
    expect(bisect).toBeDefined()
    expect(bisect.label).toBe('⚠ BISECTING')
    expect(bisect.color).toBe('yellow')
    expect(bisect.bold).toBe(true)
  })

  it('omits the bisect chip when bisect is not active', () => {
    const chips = buildHeaderChips(makeInput({ bisecting: false }))
    expect(chips.find((c) => c.id === 'bisecting')).toBeUndefined()
  })

  it('omits the PR chip entirely when no pull request is loaded', () => {
    const chips = buildHeaderChips(makeInput({ pullRequest: undefined }))
    expect(chips.find((c) => c.id === 'pr')).toBeUndefined()
  })

  it('renders the PR chip with state and glyph when a pull request is loaded', () => {
    const chips = buildHeaderChips(makeInput({
      pullRequest: { number: 1234, state: 'open' },
    }))
    const pr = chips.find((c) => c.id === 'pr')!
    expect(pr.label).toContain('PR #1234')
    expect(pr.label).toContain('OPEN')
    expect(pr.color).toBe('green') // theme.colors.success for OPEN
  })

  it('uses DRAFT label when the pull request is a draft', () => {
    const chips = buildHeaderChips(makeInput({
      pullRequest: { number: 99, state: 'open', isDraft: true },
    }))
    const pr = chips.find((c) => c.id === 'pr')!
    expect(pr.label).toContain('DRAFT')
    expect(pr.label).not.toContain('OPEN')
  })

  it('omits the breadcrumb chip when no view is pushed', () => {
    const chips = buildHeaderChips(makeInput({ breadcrumb: '' }))
    expect(chips.find((c) => c.id === 'view')).toBeUndefined()
  })

  it('inserts the breadcrumb chip after PR when a view is pushed', () => {
    const chips = buildHeaderChips(makeInput({
      breadcrumb: 'diff · stash',
      pullRequest: { number: 1, state: 'open' },
    }))
    const ids = chips.map((c) => c.id)
    expect(ids.indexOf('view')).toBe(ids.indexOf('pr') + 1)
    expect(chips.find((c) => c.id === 'view')!.label).toBe('diff · stash')
  })

  it('renders the loading chip dim when boot/context loading is in flight', () => {
    const chips = buildHeaderChips(makeInput({ loading: 'loading commits' }))
    const loading = chips.find((c) => c.id === 'loading')!
    expect(loading.label).toBe('loading commits')
    expect(loading.dim).toBe(true)
  })

  it('colors the mode chip accent when NORMAL, warning when EDIT or FILTER', () => {
    // Users should sense at a glance "your keystrokes mean something
    // different right now" — that's why EDIT/FILTER share the warning
    // color with the dirty / bisect chips.
    const normal = buildHeaderChips(makeInput({ mode: 'NORMAL' })).find((c) => c.id === 'mode')!
    const edit = buildHeaderChips(makeInput({ mode: 'EDIT' })).find((c) => c.id === 'mode')!
    const filter = buildHeaderChips(makeInput({ mode: 'FILTER' })).find((c) => c.id === 'mode')!
    expect(normal.label).toBe('[NORMAL]')
    expect(normal.color).toBe('cyan') // theme.colors.accent
    expect(edit.color).toBe('yellow') // theme.colors.warning
    expect(filter.color).toBe('yellow')
  })

  it('appends the search chip when there is search/filter input', () => {
    const chips = buildHeaderChips(makeInput({ search: 'filter: foo' }))
    const search = chips.find((c) => c.id === 'search')!
    expect(search).toBeDefined()
    expect(search.dim).toBe(true)
    // Search comes after mode — the input is a transient overlay on
    // the otherwise-stable header state.
    const ids = chips.map((c) => c.id)
    expect(ids.indexOf('search')).toBe(ids.indexOf('mode') + 1)
  })

  it('omits the search chip when neither filter nor search input is active', () => {
    const chips = buildHeaderChips(makeInput({ search: '' }))
    expect(chips.find((c) => c.id === 'search')).toBeUndefined()
  })

  describe('ASCII mode', () => {
    it('substitutes printable single-char glyphs for the dirty / clean / bisect / branch chips', () => {
      const theme = createLogInkTheme({ noColor: false, ascii: true })
      // Clean + no PR + no bisect — the most common state.
      const baseline = buildHeaderChips(makeInput({ theme }))
      const branch = baseline.find((c) => c.id === 'branch')!
      const dirty = baseline.find((c) => c.id === 'dirty')!
      expect(branch.label).toBe('git: main')
      expect(dirty.label).toBe('+ clean')

      // Dirty branch ASCII fallback.
      const dirtyChips = buildHeaderChips(makeInput({ theme, dirty: true }))
      expect(dirtyChips.find((c) => c.id === 'dirty')!.label).toBe('* dirty')

      // Bisect ASCII fallback.
      const bisectChips = buildHeaderChips(makeInput({ theme, bisecting: true }))
      expect(bisectChips.find((c) => c.id === 'bisecting')!.label).toBe('! BISECTING')
    })
  })
})

describe('measureHeaderChipsWidth', () => {
  it('returns 0 for an empty chip list', () => {
    expect(measureHeaderChipsWidth([])).toBe(0)
  })

  it('sums label widths plus N-1 separator widths', () => {
    // Three chips with simple ASCII labels: total = sum of labels +
    // 2 separators. The separator literal is " · " (3 cells with the
    // narrow midpoint). Use ASCII-safe input so the test is not
    // sensitive to font metrics across CI runners.
    const chips = buildHeaderChips(makeInput({
      appLabel: 'AB',
      repo: 'CD',
      branch: 'EF',
      theme: createLogInkTheme({ noColor: false, ascii: true }),
    }))
    // 'AB' (2) + ' · ' (3) + 'CD' (2) + ' · ' (3) + 'git: EF' (7) +
    // ' · ' (3) + '+ clean' (7) + ' · ' (3) + '[NORMAL]' (8) = 38.
    // No PR loaded → no PR chip (and no extra separator).
    expect(measureHeaderChipsWidth(chips)).toBe(38)
  })
})

describe('HEADER_CHIP_SEPARATOR', () => {
  it('exposes the literal so tests + width math + consumer all agree', () => {
    // If this constant ever moves, search for places that hardcoded
    // " · " — that's the trap to avoid.
    expect(HEADER_CHIP_SEPARATOR).toBe(' · ')
  })
})
