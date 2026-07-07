/**
 * Conflicts surface — exposes the conflicted files for an in-progress
 * merge / rebase / cherry-pick / revert. Per-file actions (resolve
 * ours, resolve theirs, stage resolved) are wired in inkInput.ts; the
 * surface itself is read-only.
 *
 * Three states matter:
 *   - No operation in progress → reassuring "nothing to resolve" copy.
 *   - Operation in progress with all conflicts resolved → "press C to
 *     continue" hint.
 *   - Conflicts remain → list with windowed scrolling.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.3
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { clampListWindowStart } from '../../chrome/layout'
import { formatLogInkLoading } from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkConflictResolutionState } from '../../runtime/inkViewModel'
import type { LogInkComponents, SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

/**
 * AI conflict-resolution panel (#1369) — renders below the file list
 * while a proposal session is open. Shows the cursored region's
 * ours/proposed/theirs blocks (color-coded, capped) plus a per-region
 * status strip and the review-key hint. Proposals only ever apply via
 * the explicit accept keys wired in inkInput.
 */
function renderProposalPanel(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  session: LogInkConflictResolutionState,
  width: number,
  bodyRows: number,
  theme: LogInkTheme,
): ReactTypes.ReactElement[] {
  const budget = Math.max(10, width - 4)
  const out: ReactTypes.ReactElement[] = [h(Text, { key: 'ai-res-spacer' }, '')]

  if (session.status === 'loading') {
    out.push(h(Text, { key: 'ai-res-loading', color: theme.noColor ? undefined : theme.colors.accent },
      truncateCells(`Generating conflict resolutions for ${session.path}… (esc cancels)`, budget)))
    return out
  }
  if (session.status === 'error') {
    out.push(h(Text, { key: 'ai-res-error', color: theme.noColor ? undefined : theme.colors.danger },
      truncateCells(`AI resolution failed: ${session.error || 'unknown error'} — esc to dismiss`, budget)))
    return out
  }

  const proposal = session.proposals[
    Math.max(0, Math.min(session.selectedIndex, session.proposals.length - 1))
  ]
  if (!proposal) return out

  const mark = (status: 'pending' | 'accepted' | 'rejected'): string =>
    status === 'accepted' ? '✓' : status === 'rejected' ? '✗' : '·'
  const strip = session.proposals
    .map((p, i) => `${i === session.selectedIndex ? '❯' : ' '}${p.regionIndex + 1}${mark(p.status)}`)
    .join(' ')
  out.push(h(Text, { key: 'ai-res-title', bold: true }, truncateCells(
    `AI proposals — region ${proposal.regionIndex + 1} (lines ${proposal.region.startLine}-${proposal.region.endLine}) · ${strip}`,
    budget
  )))
  if (proposal.rationale) {
    out.push(h(Text, { key: 'ai-res-rationale', dimColor: true },
      truncateCells(`  ${proposal.rationale}`, budget)))
  }

  // Three capped blocks. The row budget splits across them so the
  // panel never outgrows the pane on small terminals.
  const blockCap = Math.max(2, Math.floor(Math.max(6, bodyRows - 12) / 3))
  const renderBlock = (
    key: string,
    label: string,
    lines: string[],
    color: string | undefined,
  ): ReactTypes.ReactElement[] => {
    const visible = lines.slice(0, blockCap)
    const hidden = lines.length - visible.length
    return [
      h(Text, { key: `${key}-label`, dimColor: true }, truncateCells(`  ${label}`, budget)),
      ...visible.map((line, i) => h(Text, {
        key: `${key}-${i}`,
        color: theme.noColor ? undefined : color,
      }, truncateCells(`    ${line}`, budget))),
      ...(hidden > 0
        ? [h(Text, { key: `${key}-more`, dimColor: true }, `    … +${hidden} more`)]
        : []),
    ]
  }
  const proposedLines = proposal.resolution === ''
    ? ['<delete block>']
    : proposal.resolution.replace(/\n$/, '').split('\n')
  out.push(
    ...renderBlock('ai-res-ours', `ours (${proposal.region.oursLabel || 'current'})`, proposal.region.ours, theme.colors.danger),
    ...renderBlock('ai-res-proposed', 'proposed', proposedLines, theme.colors.success),
    ...renderBlock('ai-res-theirs', `theirs (${proposal.region.theirsLabel || 'incoming'})`, proposal.region.theirs, theme.colors.warning),
    h(Text, { key: 'ai-res-hint', dimColor: true }, truncateCells(
      'y accept · e edit in $EDITOR · n reject · Y accept all · j/k region · esc dismiss',
      budget
    )),
  )
  return out
}

export function renderConflictsSurface(ctx: SurfaceRenderContext): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'operation')
  const operation = context.operation
  const conflictedFiles = operation?.conflictedFiles || []
  const operationType = operation?.operation || 'none'

  // If no operation is in progress, show a fallback message.
  if (!loading && operationType === 'none') {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Conflicts', focused)),
      h(Text, { dimColor: true }, 'no operation in progress')
    ),
    h(Text, { key: 'conflicts-empty', dimColor: true },
      'No merge, rebase, cherry-pick, or revert in progress.'
    ))
  }

  // All conflicts resolved — show the "continue" hint.
  if (!loading && conflictedFiles.length === 0 && operationType !== 'none') {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Conflicts', focused)),
      h(Text, { dimColor: true }, `${operationType} — all conflicts resolved`)
    ),
    h(Text, { key: 'conflicts-hint', dimColor: true },
      `All conflicts resolved. Press C to continue the ${operationType}, or < to go back.`
    ))
  }

  const selected = Math.max(0, Math.min(state.selectedConflictFileIndex, Math.max(0, conflictedFiles.length - 1)))
  // With an AI proposal session open (#1369), the panel below the list
  // takes the majority of the pane — the file list shrinks to a
  // context strip.
  const session = state.conflictResolution
  // The context-strip cap (3, was 4) leaves room for the panel's own
  // border, which the proposal panel's block budget below floors at a
  // minimum size and can't shrink further to compensate.
  const listRows = session
    ? Math.max(2, Math.min(3, bodyRows - 4))
    : Math.max(4, bodyRows - 4)
  const startIndex = clampListWindowStart(selected, conflictedFiles.length, listRows)
  const visible = conflictedFiles.slice(startIndex, startIndex + listRows)
  const remaining = conflictedFiles.length
  const headerRight = loading
    ? 'Loading conflicts…'
    : `${operationType} — ${remaining} ${remaining === 1 ? 'conflict' : 'conflicts'} remaining`

  const statusLabel = (file: { indexStatus: string; worktreeStatus: string }): string => {
    const code = `${file.indexStatus}${file.worktreeStatus}`
    switch (code) {
      case 'UU': return 'both modified'
      case 'AA': return 'added by both'
      case 'DD': return 'both deleted'
      case 'AU': case 'UA': return 'added by one'
      case 'DU': return 'deleted by us'
      case 'UD': return 'deleted by them'
      default: return code
    }
  }

  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'conflicts-loading', dimColor: true }, formatLogInkLoading({ resource: 'conflicts' }))]
    : visible.map((file, offset) => {
      const index = startIndex + offset
      const isSelected = index === selected
      const cursor = isSelected ? '>' : ' '
      const code = `${file.indexStatus}${file.worktreeStatus}`
      const label = statusLabel(file)
      return h(Text, {
        key: `conflict-${index}`,
        bold: isSelected,
        dimColor: !isSelected,
      }, truncateCells(
        `${cursor} ${code} ${file.path}  (${label})`,
        width - 4
      ))
    })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Conflicts', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...lines,
  ...(session ? renderProposalPanel(h, Text, session, width, bodyRows, theme) : []))
}
