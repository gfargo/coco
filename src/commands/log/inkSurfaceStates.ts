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
