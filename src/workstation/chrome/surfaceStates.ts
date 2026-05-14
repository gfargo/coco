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

export type LogInkIssuesEmptyArgs = {
  filter: string
}

export function formatLogInkIssuesEmpty({ filter }: LogInkIssuesEmptyArgs): string {
  if (filter.trim()) {
    return `No issues match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No issues match the current GitHub filter (default: open issues).'
}

export type LogInkPullRequestTriageEmptyArgs = {
  filter: string
}

export function formatLogInkPullRequestTriageEmpty({
  filter,
}: LogInkPullRequestTriageEmptyArgs): string {
  if (filter.trim()) {
    return `No pull requests match filter '${filter}'. Press ctrl+u to clear.`
  }
  return 'No pull requests match the current GitHub filter (default: open PRs).'
}

export type LogInkGitHubUnauthenticatedArgs = {
  /** Short noun for the resource: "issues", "pull requests". */
  resource: string
}

/**
 * Surface-level fallback when the GitHub CLI is missing or not
 * authenticated. The triage views (#882) all share this empty-state
 * copy — the underlying problem is the same regardless of which
 * surface the user is on, and the recovery is identical.
 */
export function formatLogInkGitHubUnauthenticated({
  resource,
}: LogInkGitHubUnauthenticatedArgs): string {
  return `${resource} require the GitHub CLI. Install \`gh\` and run \`gh auth login\` to enable triage.`
}

/**
 * Surface-level fallback when the repo has no GitHub remote. Same
 * shared message across the triage surfaces.
 */
export function formatLogInkGitHubNoRemote({
  resource,
}: LogInkGitHubUnauthenticatedArgs): string {
  return `${resource} require a GitHub remote (origin or fallback). None detected for this repo.`
}
