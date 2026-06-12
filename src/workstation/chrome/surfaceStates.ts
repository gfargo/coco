/**
 * Empty- and loading-state messages for each TUI surface.
 *
 * Pure helpers — no Ink, no React. Surfaces call into these so empty/
 * loading copy stays consistent and testable. Each empty-state helper
 * gives the user a tailored hint pointing at the next sensible action,
 * so a blank list never feels like a dead end.
 */

export type LogInkSurfaceLoadingArgs = {
  /** Short noun for the resource: "branches", "tags", etc. */
  resource: string
}

/**
 * Standardized leading glyph for loading lines so the eye picks them up
 * consistently across surfaces. ASCII-safe — never relies on color.
 */
export function formatLogInkLoading({ resource }: LogInkSurfaceLoadingArgs): string {
  return `· Loading ${resource}…`
}

export type LogInkBranchesEmptyArgs = {
  filter: string
}

export function formatLogInkBranchesEmpty({ filter }: LogInkBranchesEmptyArgs): string {
  if (filter.trim()) {
    return `No branches match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No local branches. Press gh to return to history, or use git from the shell to create one.'
}

export type LogInkTagsEmptyArgs = {
  filter: string
}

export function formatLogInkTagsEmpty({ filter }: LogInkTagsEmptyArgs): string {
  if (filter.trim()) {
    return `No tags match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No tags found. Tags created via git tag <name> will appear here.'
}

export type LogInkStashEmptyArgs = {
  filter: string
}

export function formatLogInkStashEmpty({ filter }: LogInkStashEmptyArgs): string {
  if (filter.trim()) {
    return `No stashes match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No stashes. Save WIP from the status view (gs) or run git stash from the shell.'
}

export type LogInkHistoryEmptyArgs = {
  filter: string
  totalCommits: number
}

export function formatLogInkHistoryEmpty(args: LogInkHistoryEmptyArgs): string {
  if (args.filter.trim()) {
    return `No commits match the current filter. Press ctrl+u to clear.`
  }
  if (args.totalCommits === 0) {
    return 'No commits yet. Make your first commit to populate the history.'
  }
  return 'No commits in view.'
}

export type LogInkStatusEmptyArgs = {
  /** Whether the worktree currently has any pending changes (staged/unstaged/untracked). */
  hasChanges: boolean
}

export function formatLogInkStatusEmpty({ hasChanges }: LogInkStatusEmptyArgs): string | undefined {
  if (hasChanges) {
    return undefined
  }
  return 'Worktree clean. Press gh for history, gb for branches, gz for stash.'
}

export type LogInkReflogEmptyArgs = {
  filter: string
}

export function formatLogInkReflogEmpty({ filter }: LogInkReflogEmptyArgs): string {
  if (filter.trim()) {
    return `No reflog entries match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No reflog entries. Activity in this repo will appear here over time.'
}

export type LogInkComposeEmptyArgs = {
  /** Whether the worktree has any staged changes ready to commit. */
  hasStaged: boolean
}

export function formatLogInkComposeEmpty({ hasStaged }: LogInkComposeEmptyArgs): string | undefined {
  if (hasStaged) {
    return undefined
  }
  return 'No staged changes to commit. Press gs to stage files, then gc to come back here.'
}

export type LogInkSubmodulesEmptyArgs = {
  filter: string
}

export function formatLogInkSubmodulesEmpty({ filter }: LogInkSubmodulesEmptyArgs): string {
  if (filter.trim()) {
    return `No submodules match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No submodules registered. Add one with `git submodule add <url> <path>` from the shell.'
}

export type LogInkRemotesEmptyArgs = {
  filter: string
}

export function formatLogInkRemotesEmpty({ filter }: LogInkRemotesEmptyArgs): string {
  if (filter.trim()) {
    return `No remotes match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No remotes configured. Press a to add one.'
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
    return `Could not blame ${path ?? 'this file'}: ${failureMessage}. Press esc to go back.`
  }
  return `No blame data for ${path ?? 'this file'} (empty or untracked). Press esc to go back.`
}

export type LogInkIssuesEmptyArgs = {
  filter: string
}

export function formatLogInkIssuesEmpty({ filter }: LogInkIssuesEmptyArgs): string {
  if (filter.trim()) {
    return `No issues match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No issues match the current filter (default: open issues).'
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
    return `No ${noun} match filter '${filter}'. Press ctrl+u to clear.`
  }
  return `No ${noun} match the current filter (default: open).`
}

export type LogInkForgeUnavailableArgs = {
  /** Short noun for the resource: "issues", "pull requests" / "merge requests". */
  resource: string
  /** Forge CLI binary ("gh" / "glab"). Defaults to the GitHub wording. */
  cli?: string
  /** Forge display name ("GitHub" / "GitLab"). Defaults to GitHub. */
  forge?: string
}

/**
 * Surface-level fallback when the forge CLI is missing or not
 * authenticated. The triage views (#882) all share this empty-state
 * copy — the underlying problem is the same regardless of which
 * surface the user is on, and the recovery is identical. `cli`/`forge`
 * default to the GitHub wording so GitHub callers stay correct; GitLab
 * surfaces pass `glab`/`GitLab`.
 */
export function formatLogInkForgeUnauthenticated({
  resource,
  cli = 'gh',
  forge = 'GitHub',
}: LogInkForgeUnavailableArgs): string {
  return `${resource} require the ${forge} CLI. Install \`${cli}\` and run \`${cli} auth login\` to enable triage.`
}

/**
 * Surface-level fallback when the repo has no remote for the active
 * forge. Same shared message across the triage surfaces.
 */
export function formatLogInkForgeNoRemote({
  resource,
  forge = 'GitHub',
}: LogInkForgeUnavailableArgs): string {
  return `${resource} require a ${forge} remote (origin or fallback). None detected for this repo.`
}
