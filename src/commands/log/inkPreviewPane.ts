/**
 * Preview-pane content formatters for the promoted views (P4.1).
 *
 * Each formatter turns an existing context entry into a list of lines the
 * detail panel renders on the right. Pure — no git calls, no React — so the
 * shape is easy to assert in unit tests and the renderer stays a simple map
 * over the result.
 *
 * Designed to mirror what `lazygit` / `yazi` show in their preview pane:
 * the answer to "what am I about to act on" without forcing a checkout / show.
 */

import { BranchRef } from './branchData'
import { StashEntry } from './stashData'
import { GitTagRef } from './tagData'

export type PreviewLineEmphasis = 'heading' | 'dim'

export type PreviewLine = {
  text: string
  emphasis?: PreviewLineEmphasis
}

const heading = (text: string): PreviewLine => ({ text, emphasis: 'heading' })
const dim = (text: string): PreviewLine => ({ text, emphasis: 'dim' })
const line = (text: string): PreviewLine => ({ text })
const blank = (): PreviewLine => ({ text: '' })

function shortHash(hash: string | undefined): string {
  return hash ? hash.slice(0, 7) : '<none>'
}

/* ------------------------------- branch -------------------------------- */

function describeBranchDivergence(branch: Pick<BranchRef, 'ahead' | 'behind'>): string {
  if (branch.ahead === 0 && branch.behind === 0) {
    return 'in sync'
  }
  return `${branch.ahead} ahead, ${branch.behind} behind`
}

export function formatBranchPreview(branch: BranchRef | undefined): PreviewLine[] {
  if (!branch) {
    return [dim('Select a branch to preview.')]
  }

  const out: PreviewLine[] = [
    heading(branch.shortName),
    blank(),
    line(`Tip:    ${shortHash(branch.hash)}`),
    line(`Date:   ${branch.date || '<unknown>'}`),
    line(`Subject: ${branch.subject || '<no subject>'}`),
    blank(),
  ]

  if (branch.upstream) {
    out.push(line(`Upstream: ${branch.upstream}`))
    out.push(line(`Status:   ${describeBranchDivergence(branch)}`))
  } else {
    out.push(dim('No upstream tracking.'))
  }

  if (branch.current) {
    out.push(blank())
    out.push(dim('* current branch'))
  }

  return out
}

/* --------------------------------- tag --------------------------------- */

export function formatTagPreview(tag: GitTagRef | undefined): PreviewLine[] {
  if (!tag) {
    return [dim('Select a tag to preview.')]
  }

  return [
    heading(tag.name),
    blank(),
    line(`Commit:  ${shortHash(tag.hash)}`),
    line(`Date:    ${tag.date || '<unknown>'}`),
    blank(),
    line('Subject:'),
    line(`  ${tag.subject || '<no subject>'}`),
  ]
}

/* -------------------------------- stash -------------------------------- */

export type StashPreviewOptions = {
  /** Cap on listed file paths in the preview. */
  fileCap?: number
}

export function formatStashPreview(
  stash: StashEntry | undefined,
  options: StashPreviewOptions = {}
): PreviewLine[] {
  if (!stash) {
    return [dim('Select a stash to preview.')]
  }

  const cap = options.fileCap ?? 10
  const out: PreviewLine[] = [
    heading(stash.ref),
    blank(),
    line(`On:      ${stash.branch || '<unknown>'}`),
    line(`Commit:  ${shortHash(stash.hash)}`),
    line(`Date:    ${stash.date || '<unknown>'}`),
    blank(),
    line('Message:'),
    line(`  ${stash.message || '<no message>'}`),
  ]

  const files = stash.files || []
  if (files.length > 0) {
    out.push(blank())
    out.push(line(`Files (${files.length}):`))
    files.slice(0, cap).forEach((path) => out.push(line(`  ${path}`)))
    if (files.length > cap) {
      out.push(dim(`  … ${files.length - cap} more`))
    }
  } else {
    out.push(blank())
    out.push(dim('No files in stash.'))
  }

  return out
}
