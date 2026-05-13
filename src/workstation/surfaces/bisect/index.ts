/**
 * Bisect workflow surface (#784). Shows the current candidate commit
 * (HEAD), a parsed view of recent decisions from `git bisect log`, and
 * the four action keys (g good, b bad, s skip, x reset).
 *
 * When bisect is inactive, the surface renders an empty-state hint
 * pointing the user at the CLI to start one. The view stays
 * navigable so the user can read the documentation before starting
 * — they can't break anything from here.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.1
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { GitCommitDetail } from '../../../commands/log/data'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import { getBisectCompletion } from '../../../git/bisectData'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderBisectSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  candidateDetail: GitCommitDetail | undefined,
  candidateLoading: boolean,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'bisect')
  const bisect = context.bisect
  const accent = theme.noColor ? undefined : theme.colors.accent
  // #879 item 3 — detect git's "first bad commit" terminator so we
  // can swap the in-flight UI for a completion panel. The session is
  // technically still active until `git bisect reset`, so the answer
  // panel piggy-backs on the same `bisect.active` branch.
  const completion = bisect?.active ? getBisectCompletion(bisect.log) : undefined

  const lines: ReactTypes.ReactNode[] = []

  if (loading) {
    lines.push(h(Text, { key: 'bisect-loading', dimColor: true },
      truncateCells('· Loading bisect status…', width - 4)))
  } else if (!bisect?.active) {
    // Empty-state explainer (#879). Teaches the bisect workflow in
    // ~30 seconds: what it is, how it works, how to start one (CLI
    // entry remains the supported on-ramp until the in-TUI start
    // child item lands), and a tip about picking the good anchor.
    // Bisect is a rarely-used feature even for experienced users —
    // shipping it with terse copy assumes muscle memory the median
    // user doesn't have.
    const empty: Array<{ key: string; text: string; opts?: { bold?: boolean; dim?: boolean; accent?: boolean } }> = [
      { key: 'title', text: 'Bisect — find the commit that introduced a bug.', opts: { bold: true } },
      { key: 'spacer-1', text: '' },
      { key: 'how-h', text: 'How it works', opts: { bold: true } },
      { key: 'how-1', text: '  Binary search through history. You mark commits as "good" (bug' },
      { key: 'how-2', text: '  not present) or "bad" (bug present); git narrows the range until' },
      { key: 'how-3', text: '  it identifies the first bad commit.' },
      { key: 'spacer-2', text: '' },
      { key: 'start-h', text: 'How to start', opts: { bold: true } },
      { key: 'start-1', text: '  From your shell:' },
      { key: 'start-2', text: '    git bisect start <bad-ref> <good-ref>', opts: { accent: true } },
      { key: 'start-3', text: '  Then come back here — coco picks up the active bisect and gives' },
      { key: 'start-4', text: '  you single-keystroke controls:' },
      { key: 'start-5', text: '    g  mark good      s  skip (e.g. doesn\'t build)', opts: { accent: true } },
      { key: 'start-6', text: '    b  mark bad       x  reset / cancel', opts: { accent: true } },
      { key: 'spacer-3', text: '' },
      { key: 'tip-h', text: 'Tip', opts: { bold: true } },
      { key: 'tip-1', text: '  Pick a recent release tag as your "good" anchor if you don\'t' },
      { key: 'tip-2', text: '  remember when the bug appeared. Tags are visible from the tags' },
      { key: 'tip-3', text: '  view (g t).' },
    ]
    for (const row of empty) {
      lines.push(h(Text, {
        key: `bisect-empty-${row.key}`,
        bold: row.opts?.bold,
        dimColor: row.opts?.dim,
        color: row.opts?.accent ? accent : undefined,
      }, truncateCells(row.text, width - 4)))
    }
  } else if (completion) {
    // Bisect terminated: git emitted the "first bad commit" line into
    // BISECT_LOG. Render a dedicated answer panel rather than leaving
    // the surface in the same shape as a regular decision step. HEAD
    // is parked on the first-bad commit at this point, so the
    // candidateDetail loaded via #879 item 2 carries the right
    // author / date / file stats — we reuse it instead of issuing
    // another git-show round-trip.
    const shortSha = completion.sha.slice(0, 8)
    lines.push(h(Text, { key: 'bisect-complete-title', bold: true, color: accent },
      truncateCells('✓ Bisect complete — first bad commit identified', width - 4)))
    lines.push(h(Text, { key: 'bisect-complete-spacer-1' }, ''))

    // Headline: short sha + subject, prominent.
    const subjectText = completion.subject || candidateDetail?.message || '<subject unavailable>'
    lines.push(h(Text, { key: 'bisect-complete-sha', bold: true },
      truncateCells(`  ${shortSha}  ${subjectText}`, width - 4)))

    if (candidateLoading) {
      lines.push(h(Text, { key: 'bisect-complete-loading', dimColor: true },
        truncateCells('  loading commit detail…', width - 4)))
    } else if (candidateDetail) {
      lines.push(h(Text, { key: 'bisect-complete-author', dimColor: true },
        truncateCells(`  ${candidateDetail.author} · ${candidateDetail.date}`, width - 4)))
      const { stats, files } = candidateDetail
      lines.push(h(Text, { key: 'bisect-complete-stats' },
        truncateCells(
          `  ${stats.filesChanged} file${stats.filesChanged === 1 ? '' : 's'} · +${stats.insertions} / -${stats.deletions}`,
          width - 4,
        )))
      const sampleFiles = files.slice(0, 3).map((file) => file.path)
      if (sampleFiles.length > 0) {
        const overflow = files.length > sampleFiles.length ? ` (+${files.length - sampleFiles.length} more)` : ''
        lines.push(h(Text, { key: 'bisect-complete-files', dimColor: true },
          truncateCells(`    ${sampleFiles.join(', ')}${overflow}`, width - 4)))
      }
    }

    lines.push(h(Text, { key: 'bisect-complete-spacer-2' }, ''))
    lines.push(h(Text, { key: 'bisect-complete-next-h', bold: true },
      truncateCells('Next', width - 4)))
    lines.push(h(Text, { key: 'bisect-complete-next-1' },
      truncateCells('  y  yank short sha       x  reset / exit bisect', width - 4)))
    lines.push(h(Text, { key: 'bisect-complete-next-2', dimColor: true },
      truncateCells('  <  back to history      esc  back', width - 4)))
    lines.push(h(Text, { key: 'bisect-complete-spacer-3' }, ''))
    lines.push(h(Text, { key: 'bisect-complete-tip', dimColor: true },
      truncateCells('Tip: `git bisect log > /tmp/replay` saves the session for later replay.', width - 4)))
  } else {
    // Active bisect. Three-section body: current candidate (sha +
    // commit summary so the user can judge the diff at a glance),
    // recent decisions, action hints. Action keys live in the footer.
    const headerSha = bisect.currentSha ? bisect.currentSha.slice(0, 8) : '<unknown>'
    lines.push(h(Text, { key: 'bisect-active-title', bold: true },
      truncateCells(`Bisecting · current candidate ${headerSha}`, width - 4)))

    // #879 (item 2) — render commit detail for the current candidate.
    // Lets the user judge "does this look like it would cause the bug?"
    // before they run their tests, instead of dropping to shell to
    // git show. Loading is brief (one git show invocation) and the
    // surface falls back to just the sha header when the detail
    // hasn't arrived yet (or git rejected the lookup).
    if (candidateLoading) {
      lines.push(h(Text, { key: 'bisect-candidate-loading', dimColor: true },
        truncateCells('  loading commit detail…', width - 4)))
    } else if (candidateDetail) {
      const { author, date, message, body, stats, files } = candidateDetail
      lines.push(h(Text, { key: 'bisect-candidate-subject' },
        truncateCells(`  ${message}`, width - 4)))
      lines.push(h(Text, { key: 'bisect-candidate-author', dimColor: true },
        truncateCells(`  ${author} · ${date}`, width - 4)))
      // Body line — first non-empty line of the commit body, truncated.
      // Skip the noisy preamble (subject + blank line) by taking the
      // first paragraph after the title; body===subject is common for
      // single-line commits and we filter that out.
      const firstBodyLine = (body || '')
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0 && line !== message)
      if (firstBodyLine) {
        lines.push(h(Text, { key: 'bisect-candidate-body', dimColor: true },
          truncateCells(`  ${firstBodyLine}`, width - 4)))
      }
      // Stats summary: total file count + +/- numbers, then a few
      // file names so the user sees scope at a glance. Cap the
      // file-name list at 3 entries to keep the section bounded.
      lines.push(h(Text, { key: 'bisect-candidate-stats' },
        truncateCells(`  ${stats.filesChanged} file${stats.filesChanged === 1 ? '' : 's'} · +${stats.insertions} / -${stats.deletions}`, width - 4)))
      const sampleFiles = files.slice(0, 3).map((file) => file.path)
      if (sampleFiles.length > 0) {
        const overflow = files.length > sampleFiles.length ? ` (+${files.length - sampleFiles.length} more)` : ''
        lines.push(h(Text, { key: 'bisect-candidate-files', dimColor: true },
          truncateCells(`    ${sampleFiles.join(', ')}${overflow}`, width - 4)))
      }
    }
    // Spacer separates the candidate section from decisions.
    lines.push(h(Text, { key: 'bisect-active-spacer' }, ''))

    const decisions = bisect.log.filter((entry) =>
      entry.kind === 'good' || entry.kind === 'bad' || entry.kind === 'skip'
    )

    if (decisions.length === 0) {
      lines.push(h(Text, { key: 'bisect-no-decisions', dimColor: true },
        truncateCells('No decisions logged yet — press g (good) or b (bad) to record one.', width - 4)))
    } else {
      lines.push(h(Text, { key: 'bisect-decisions-header', bold: true },
        truncateCells(`Decisions (${decisions.length}):`, width - 4)))
      const recent = decisions.slice(-Math.max(4, bodyRows - 8))
      for (const entry of recent) {
        const kindLabel = entry.kind.toUpperCase().padEnd(5)
        const sha = (entry.sha || '<unknown>').padEnd(8)
        const subject = entry.subject || ''
        const text = `  ${kindLabel} ${sha} ${subject}`
        lines.push(h(Text, {
          key: `bisect-entry-${entry.raw}`,
          dimColor: entry.kind === 'skip',
          bold: entry.kind === 'bad',
        }, truncateCells(text, width - 4)))
      }
    }

    lines.push(h(Text, { key: 'bisect-action-spacer' }, ''))
    lines.push(h(Text, { key: 'bisect-action-hint', dimColor: true },
      truncateCells('Actions: g good · b bad · s skip · x reset', width - 4)))
  }

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Bisect', focused)),
    h(Text, { dimColor: true },
      completion ? 'COMPLETE' : bisect?.active ? 'BISECTING' : 'inactive')
  ),
  ...lines)
}
