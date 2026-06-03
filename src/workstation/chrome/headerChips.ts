/**
 * Header chip builder. Turns the workstation's title-bar state into an
 * ordered list of small visually-distinct chips:
 *
 *   coco · gfargo/coco · ⎇ main · ✓ clean · ⊘ no PR · [NORMAL]
 *
 * Pre-refactor the title bar concatenated every segment into a single
 * Text span, which made the eye read the whole thing as one run of
 * words (the same problem the footer had). Splitting into chips with a
 * fixed separator lets each segment carry its own color and lets the
 * user scan the bar in chunks — "what app, what repo, what branch,
 * how clean, what PR state, what mode" — instead of parsing left-to-
 * right.
 *
 * Why a separate module: the header runtime renders chips and handles
 * truncation; chip construction is pure transformation of state +
 * context + theme. Splitting them keeps the chips testable in
 * isolation and keeps the runtime small.
 *
 * Truncation strategy lives in the consumer, not here — when the total
 * width exceeds the column budget, the header falls back to the
 * pre-redesign single-fragment truncated string so the ellipsis can't
 * land mid-glyph. We always return the FULL chip list; the consumer
 * decides whether to drop chips, fall back, or render all of them.
 */

import { cellWidth } from './text'
import type { LogInkTheme } from './theme'
import { getPullRequestStateGlyph } from './iconography'

export type HeaderChip = {
  /**
   * The chip's primary identity — used by tests and snapshots. Stable
   * across theme / preset switches so a test can assert "the branch
   * chip says X" without coupling to color decisions.
   */
  id: HeaderChipId
  /**
   * The label text rendered to the user. Already includes any glyph
   * prefix the chip wants (so the cell-width math is honest about
   * what will actually appear). Glyphs come from `theme.ascii`-aware
   * helpers; consumers just render the label verbatim.
   */
  label: string
  /** Optional foreground color. `undefined` means default / inherit. */
  color: string | undefined
  /** Dim treatment — for chips that should fade into chrome (idle / muted). */
  dim: boolean
  /** Bold treatment — used on identity chips (app, branch, mode). */
  bold: boolean
}

export type HeaderChipId =
  | 'app'
  | 'repo'
  | 'branch'
  | 'dirty'
  | 'bisecting'
  | 'pr'
  | 'view'
  | 'loading'
  | 'mode'
  | 'search'

export type BuildHeaderChipsInput = {
  appLabel: string
  repo: string
  branch: string
  /**
   * Branch dirty/clean signal. The chip stays positive ("✓ clean") in
   * the clean case and switches to warning ("● dirty") in the dirty
   * case. Bisect mid-state gets its own chip — see `bisecting`.
   */
  dirty: boolean
  /** True when `context.bisect.active` — renders its own warning chip. */
  bisecting: boolean
  /**
   * Pull request state for the current branch, if any. `undefined`
   * omits the PR chip entirely (no "no PR" placeholder).
   */
  pullRequest: { number: number; state: string; isDraft?: boolean } | undefined
  /**
   * Combined repo + view breadcrumb (e.g. "submodule/lib › diff").
   * Rendered only when non-empty.
   */
  breadcrumb: string
  /** "loading commits" / "loading context" / "" — rendered only when non-empty. */
  loading: string
  /** Mode indicator: 'NORMAL' / 'EDIT' / 'FILTER'. Brackets are added here. */
  mode: 'NORMAL' | 'EDIT' | 'FILTER'
  /** Active filter / search input copy, '' when neither is active. */
  search: string
  theme: LogInkTheme
}

/**
 * Default separator inserted between chips by the consumer. Exported as
 * a constant so tests and width math agree on what they're measuring.
 * The trailing/leading spaces are part of the separator — `·` alone
 * would butt against adjacent chip labels.
 */
export const HEADER_CHIP_SEPARATOR = ' · '

/**
 * Build the ordered chip list for the header. Chips not relevant to the
 * current state (no PR loaded, no breadcrumb, no search input, …) are
 * omitted entirely rather than rendered as empty placeholders, so the
 * consumer can just `chips.map(render)` without checking for empties.
 */
export function buildHeaderChips(input: BuildHeaderChipsInput): HeaderChip[] {
  const { theme } = input
  const chips: HeaderChip[] = []

  // App label — the constant identity. Accent + bold so it anchors the
  // left edge of the bar.
  chips.push({
    id: 'app',
    label: input.appLabel,
    color: theme.colors.accent,
    dim: false,
    bold: true,
  })

  // Repo. Default color — it's contextual but not the headline.
  chips.push({
    id: 'repo',
    label: input.repo,
    color: undefined,
    dim: false,
    bold: false,
  })

  // Branch. Carries the branch glyph (⎇ / ASCII fallback) so the chip
  // is identifiable even when the branch name is generic ("main" /
  // "master").
  const branchGlyph = theme.ascii ? 'git:' : '⎇'
  chips.push({
    id: 'branch',
    label: `${branchGlyph} ${input.branch}`,
    color: theme.colors.accent,
    dim: false,
    bold: true,
  })

  // Dirty/clean. Positive framing on clean (success color + ✓), warning
  // on dirty (warning color + ●). ASCII fallbacks keep the chip
  // identifiable on dumb terminals.
  const dirtyChip: HeaderChip = input.dirty
    ? {
      id: 'dirty',
      label: theme.ascii ? '* dirty' : '● dirty',
      color: theme.colors.warning,
      dim: false,
      bold: false,
    }
    : {
      id: 'dirty',
      label: theme.ascii ? '+ clean' : '✓ clean',
      color: theme.colors.success,
      dim: false,
      bold: false,
    }
  chips.push(dirtyChip)

  // Bisect — only when active. Distinct chip so users entering the TUI
  // mid-bisect see it immediately (#784). Warning color because bisect
  // is an "in progress, requires user action" state.
  if (input.bisecting) {
    chips.push({
      id: 'bisecting',
      label: theme.ascii ? '! BISECTING' : '⚠ BISECTING',
      color: theme.colors.warning,
      dim: false,
      bold: true,
    })
  }

  // PR state. Shown only when a PR actually exists — the chip uses the
  // PR-state glyph + a short label ("PR #1234 OPEN" / "PR #1234 DRAFT").
  // The old always-on "no PR" chip spent a permanent header segment to
  // report a negative default state on every screen; dropping it keeps
  // the state cluster about what *is* true (TUI audit).
  if (input.pullRequest) {
    const prGlyph = getPullRequestStateGlyph(
      { ...input.pullRequest, isDraft: Boolean(input.pullRequest.isDraft) },
      theme
    )
    const stateLabel = input.pullRequest.isDraft
      ? 'DRAFT'
      : input.pullRequest.state.toUpperCase()
    const label = prGlyph.glyph
      ? `${prGlyph.glyph} PR #${input.pullRequest.number} ${stateLabel}`
      : `PR #${input.pullRequest.number} ${stateLabel}`
    chips.push({
      id: 'pr',
      label,
      color: prGlyph.color,
      dim: prGlyph.dim,
      bold: false,
    })
  }

  // View breadcrumb. Rendered only when there's content (`coco ui`
  // root view → no breadcrumb chip; pushed into a sub-view → chip
  // appears). Comes AFTER PR so the "state" group (app/repo/branch/
  // dirty/PR) reads as one cluster and the "navigation" group (view
  // breadcrumb / loading) reads as a separate cluster.
  if (input.breadcrumb) {
    chips.push({
      id: 'view',
      label: input.breadcrumb,
      color: theme.colors.muted,
      dim: true,
      bold: false,
    })
  }

  if (input.loading) {
    chips.push({
      id: 'loading',
      label: input.loading.trim(),
      color: theme.colors.muted,
      dim: true,
      bold: false,
    })
  }

  // Mode — the explicit input-mode indicator (#P2.2). Always present
  // so users never wonder why `q` doesn't quit while they're editing.
  // EDIT / FILTER use the warning color to signal "your keystrokes
  // mean something different right now"; NORMAL uses accent (matches
  // the app chip's home base).
  const modeColor = input.mode === 'NORMAL'
    ? theme.colors.accent
    : theme.colors.warning
  chips.push({
    id: 'mode',
    label: `[${input.mode}]`,
    color: modeColor,
    dim: false,
    bold: true,
  })

  // Search — only when active. Dim so it doesn't compete with the
  // identity chips for attention; the user knows it's there because
  // they're typing into it.
  if (input.search) {
    chips.push({
      id: 'search',
      label: input.search,
      color: theme.colors.muted,
      dim: true,
      bold: false,
    })
  }

  return chips
}

/**
 * Total rendered width of a chip list assuming `HEADER_CHIP_SEPARATOR`
 * between every pair. Used by the consumer to decide whether the
 * chip layout fits the column budget or whether to fall back to the
 * single-fragment truncated path.
 */
export function measureHeaderChipsWidth(chips: ReadonlyArray<HeaderChip>): number {
  if (chips.length === 0) return 0
  const labels = chips.map((chip) => cellWidth(chip.label))
  const separators = (chips.length - 1) * cellWidth(HEADER_CHIP_SEPARATOR)
  return labels.reduce((sum, w) => sum + w, 0) + separators
}
