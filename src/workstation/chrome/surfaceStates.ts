/**
 * Empty- and loading-state messages for each TUI surface.
 *
 * Pure helpers — no Ink, no React. Surfaces call into these so empty/
 * loading copy stays consistent and testable. Each empty-state helper
 * gives the user a tailored hint pointing at the next sensible action,
 * so a blank list never feels like a dead end.
 */

import { en } from '../../lib/i18n/en'
import { t } from '../../lib/i18n/t'

export type LogInkSurfaceLoadingArgs = {
  /** Short noun for the resource: "branches", "tags", etc. */
  resource: string
}

/**
 * Standardized leading glyph for loading lines so the eye picks them up
 * consistently across surfaces. ASCII-safe — never relies on color.
 */
export function formatLogInkLoading({ resource }: LogInkSurfaceLoadingArgs): string {
  return t(en, 'surfaceStates.loading', { resource })
}

export type LogInkBranchesEmptyArgs = {
  filter: string
}

export function formatLogInkBranchesEmpty({ filter }: LogInkBranchesEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.branches.filtered', { filter })
  }
  return t(en, 'surfaceStates.branches.empty')
}

export type LogInkTagsEmptyArgs = {
  filter: string
}

export function formatLogInkTagsEmpty({ filter }: LogInkTagsEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.tags.filtered', { filter })
  }
  return t(en, 'surfaceStates.tags.empty')
}

export type LogInkStashEmptyArgs = {
  filter: string
}

export function formatLogInkStashEmpty({ filter }: LogInkStashEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.stash.filtered', { filter })
  }
  return t(en, 'surfaceStates.stash.empty')
}

export type LogInkHistoryEmptyArgs = {
  filter: string
  totalCommits: number
}

export function formatLogInkHistoryEmpty(args: LogInkHistoryEmptyArgs): string {
  if (args.filter.trim()) {
    return t(en, 'surfaceStates.history.filtered')
  }
  if (args.totalCommits === 0) {
    return t(en, 'surfaceStates.history.emptyRepo')
  }
  return t(en, 'surfaceStates.history.emptyView')
}

export type LogInkStatusEmptyArgs = {
  /** Whether the worktree currently has any pending changes (staged/unstaged/untracked). */
  hasChanges: boolean
  /**
   * Whether the working tree is a partial (sparse) checkout (OSS-2056).
   * When true, the clean-tree hint notes it so an empty status view
   * doesn't leave the user wondering whether files are missing.
   */
  sparse?: boolean
}

export function formatLogInkStatusEmpty({ hasChanges, sparse }: LogInkStatusEmptyArgs): string | undefined {
  if (hasChanges) {
    return undefined
  }
  const sparseNote = sparse ? t(en, 'surfaceStates.status.sparseNote') : ''
  return t(en, 'surfaceStates.status.clean', { sparseNote })
}

export type LogInkReflogEmptyArgs = {
  filter: string
}

export function formatLogInkReflogEmpty({ filter }: LogInkReflogEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.reflog.filtered', { filter })
  }
  return t(en, 'surfaceStates.reflog.empty')
}

export type LogInkComposeEmptyArgs = {
  /** Whether the worktree has any staged changes ready to commit. */
  hasStaged: boolean
}

export function formatLogInkComposeEmpty({ hasStaged }: LogInkComposeEmptyArgs): string | undefined {
  if (hasStaged) {
    return undefined
  }
  return t(en, 'surfaceStates.compose.empty')
}

export type LogInkSubmodulesEmptyArgs = {
  filter: string
}

export function formatLogInkSubmodulesEmpty({ filter }: LogInkSubmodulesEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.submodules.filtered', { filter })
  }
  return t(en, 'surfaceStates.submodules.empty')
}

export type LogInkRemotesEmptyArgs = {
  filter: string
}

export function formatLogInkRemotesEmpty({ filter }: LogInkRemotesEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.remotes.filtered', { filter })
  }
  return t(en, 'surfaceStates.remotes.empty')
}

export type LogInkWorktreesEmptyArgs = {
  filter: string
}

export function formatLogInkWorktreesEmpty({ filter }: LogInkWorktreesEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.worktrees.filtered', { filter })
  }
  return t(en, 'surfaceStates.worktrees.empty')
}

export type LogInkBlameEmptyArgs = {
  /** Repo-relative path being blamed, for a path-aware message. */
  path?: string
  /** Best-effort failure message when `git blame` couldn't run. */
  failureMessage?: string
}

/**
 * Empty / failure copy for the on-demand blame view (#0.71). A failed
 * blame (binary file, path outside the repo) is the common "non-empty
 * but unrenderable" case, so the message leads with the git error when
 * present; a genuinely empty file falls through to the neutral hint.
 */
export function formatLogInkBlameEmpty({ path, failureMessage }: LogInkBlameEmptyArgs): string {
  if (failureMessage) {
    return t(en, 'surfaceStates.blame.failure', { path: path ?? 'this file', failureMessage })
  }
  return t(en, 'surfaceStates.blame.empty', { path: path ?? 'this file' })
}

/**
 * Empty-state copy for the history detail surface's [Notes] tab
 * (#OSS-2057) — no `refs/notes/commits` note is loaded for the cursored
 * commit. v1 only reads notes already fetched locally (it never fetches
 * `refs/notes/commits` from the remote), so this deliberately doesn't
 * claim the commit has no note anywhere — only that none is loaded here.
 */
export function formatLogInkNotesEmpty(): string {
  return t(en, 'surfaceStates.notes.empty')
}

export type LogInkIssuesEmptyArgs = {
  filter: string
}

export function formatLogInkIssuesEmpty({ filter }: LogInkIssuesEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.issues.filtered', { filter })
  }
  return t(en, 'surfaceStates.issues.empty')
}

export type LogInkPullRequestTriageEmptyArgs = {
  filter: string
  /**
   * Forge-aware plural noun ("pull requests" / "merge requests"). Defaults
   * to the GitHub wording so older callers stay correct.
   */
  noun?: string
}

export function formatLogInkPullRequestTriageEmpty({
  filter,
  noun = 'pull requests',
}: LogInkPullRequestTriageEmptyArgs): string {
  if (filter.trim()) {
    return t(en, 'surfaceStates.prTriage.filtered', { noun, filter })
  }
  return t(en, 'surfaceStates.prTriage.empty', { noun })
}

export type LogInkForgeUnavailableArgs = {
  /** Short noun for the resource: "issues", "pull requests" / "merge requests". */
  resource: string
  /** Forge CLI binary ("gh" / "glab"). Defaults to the GitHub wording. */
  cli?: string
  /** Forge display name ("GitHub" / "GitLab"). Defaults to GitHub. */
  forge?: string
  /**
   * Recovery instructions for forges with no CLI binary to install (Gitea/
   * Forgejo authenticate via a `GITEA_TOKEN` environment variable, not a CLI
   * login flow). When set, this replaces the "Install `cli`" wording.
   */
  authHint?: string
}

/**
 * Surface-level fallback when the forge CLI is missing or not
 * authenticated. The triage views (#882) all share this empty-state
 * copy — the underlying problem is the same regardless of which
 * surface the user is on, and the recovery is identical. `cli`/`forge`
 * default to the GitHub wording so GitHub callers stay correct; GitLab
 * surfaces pass `glab`/`GitLab`; forges with no CLI (Gitea) pass `authHint`.
 */
export function formatLogInkForgeUnauthenticated({
  resource,
  cli = 'gh',
  forge = 'GitHub',
  authHint,
}: LogInkForgeUnavailableArgs): string {
  if (authHint) return t(en, 'surfaceStates.forge.unauthenticatedAuthHint', { resource, forge, authHint })
  return t(en, 'surfaceStates.forge.unauthenticated', { resource, forge, cli })
}

/**
 * Surface-level fallback when the repo has no remote for the active
 * forge. Same shared message across the triage surfaces.
 */
export function formatLogInkForgeNoRemote({
  resource,
  forge = 'GitHub',
}: LogInkForgeUnavailableArgs): string {
  return t(en, 'surfaceStates.forge.noRemote', { resource, forge })
}

export type LogInkPullRequestDiffErrorArgs = {
  /** Failure message from the forge CLI patch fetch. */
  message: string
}

/**
 * Error copy for the PR diff drill-in (#1363). The fetch failures here
 * are actionable (auth expired, PR branch deleted, unsupported forge)
 * so the surface leads with the CLI's message instead of a generic
 * "no diff" hint that would read as an empty pull request.
 */
export function formatLogInkPullRequestDiffError({
  message,
}: LogInkPullRequestDiffErrorArgs): string {
  return t(en, 'surfaceStates.prDiff.error', { message })
}

/**
 * Empty copy for the PR diff drill-in (#1363): the fetch succeeded but
 * the patch is empty (e.g. an empty commit or a fully-reverted PR).
 */
export function formatLogInkPullRequestDiffEmpty(): string {
  return t(en, 'surfaceStates.prDiff.empty')
}
