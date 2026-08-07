import { Catalog } from './t'

/**
 * English message catalog — the fallback (and, for now, only) locale.
 * Keys are namespaced `<domain>.<subdomain>.<name>`. See README.md for the
 * migration pattern follow-on files should use.
 */
export const en: Catalog = {
  'ai.error.rateLimit':
    'Rate limited by your AI provider (429) — too many requests or quota exceeded. Wait a moment, then press I to retry.',
  'ai.error.auth':
    'AI provider rejected the request — check your API key (run `coco init`, or press gK to edit the global config).',
  'ai.error.contextLength':
    'The staged diff is too large for the model’s context window — stage fewer changes (or split the commit) and retry with I.',
  'ai.error.network': 'Network error reaching the AI provider — check your connection, then press I to retry.',
  'ai.error.empty': 'AI request failed.',

  'surfaceStates.loading': (a) => `Loading ${a.resource}…`,
  'surfaceStates.branches.filtered': (a) => `No branches match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.branches.empty':
    'No local branches. Press gh to return to history, or use git from the shell to create one.',
  'surfaceStates.tags.filtered': (a) => `No tags match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.tags.empty': 'No tags found. Tags created via git tag <name> will appear here.',
  'surfaceStates.stash.filtered': (a) => `No stashes match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.stash.empty': 'No stashes. Save WIP from the status view (gs) or run git stash from the shell.',
  'surfaceStates.history.filtered': 'No commits match the current filter. Press ctrl+u to clear.',
  'surfaceStates.history.emptyRepo': 'No commits yet. Make your first commit to populate the history.',
  'surfaceStates.history.emptyView': 'No commits in view.',
  'surfaceStates.status.clean': (a) =>
    `Worktree clean. Press gh for history, gb for branches, gz for stash.${a.sparseNote}`,
  'surfaceStates.status.sparseNote':
    ' This is a sparse checkout — paths outside your cone are omitted on purpose.',
  'surfaceStates.reflog.filtered': (a) => `No reflog entries match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.reflog.empty': 'No reflog entries. Activity in this repo will appear here over time.',
  'surfaceStates.compose.empty': 'No staged changes to commit. Press gs to stage files, then gc to come back here.',
  'surfaceStates.submodules.filtered': (a) => `No submodules match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.submodules.empty': 'No submodules registered. Add one with `git submodule add <url> <path>` from the shell.',
  'surfaceStates.remotes.filtered': (a) => `No remotes match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.remotes.empty': 'No remotes configured. Press a to add one.',
  'surfaceStates.worktrees.filtered': (a) => `No worktrees match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.worktrees.empty': 'No linked worktrees.',
  'surfaceStates.blame.failure': (a) => `Could not blame ${a.path}: ${a.failureMessage}. Press esc to go back.`,
  'surfaceStates.blame.empty': (a) => `No blame data for ${a.path} (empty or untracked). Press esc to go back.`,
  'surfaceStates.notes.empty': 'No note on this commit. Press enter to add one.',
  'surfaceStates.issues.filtered': (a) => `No issues match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.issues.empty': 'No issues match the current filter (default: open issues).',
  'surfaceStates.prTriage.filtered': (a) => `No ${a.noun} match filter '${a.filter}'. Press ctrl+u to clear.`,
  'surfaceStates.prTriage.empty': (a) => `No ${a.noun} match the current filter (default: open).`,
  'surfaceStates.forge.unauthenticatedAuthHint': (a) => `${a.resource} require ${a.forge} auth. ${a.authHint}`,
  'surfaceStates.forge.unauthenticated': (a) =>
    `${a.resource} require the ${a.forge} CLI. Install \`${a.cli}\` and run \`${a.cli} auth login\` to enable triage.`,
  'surfaceStates.forge.noRemote': (a) =>
    `${a.resource} require a ${a.forge} remote (origin or fallback). None detected for this repo.`,
  'surfaceStates.prDiff.error': (a) => `Could not load the diff: ${a.message} Press esc to go back, r to refresh.`,
  'surfaceStates.prDiff.empty': 'No diff to display for this pull request.',

  'idleTips.searchCommands': 'press : to search every command',
  'idleTips.home': 'g h returns home from anywhere',
  'idleTips.filterView': '/ filters the active view',
  'idleTips.fullKeymap': 'press ? to see the full keymap',
  'idleTips.sortCycle': 's cycles sort modes in branches and tags',
  'idleTips.stashView': 'gz opens the stash view',
  'idleTips.navBack': '< or esc walks the navigation stack back',
  'idleTips.splitCommits': 'S splits a large staged set into multiple commits',
  'idleTips.changelog': 'L generates a changelog for the current branch',
  'idleTips.createFromChangelog': 'C creates a {abbrev} seeded from the changelog',
  'idleTips.editorDraft': 'E opens the commit draft in $EDITOR or $VISUAL',
  'idleTips.aiCommitDraft': 'I drafts an AI commit message from staged changes',

  'forge.github.abbrev': 'PR',
  'forge.github.singular': 'Pull request',
  'forge.github.plural': 'Pull requests',
  'forge.github.singularLower': 'pull request',
  'forge.github.pluralLower': 'pull requests',
  'forge.github.name': 'GitHub',
  'forge.gitlab.abbrev': 'MR',
  'forge.gitlab.singular': 'Merge request',
  'forge.gitlab.plural': 'Merge requests',
  'forge.gitlab.singularLower': 'merge request',
  'forge.gitlab.pluralLower': 'merge requests',
  'forge.gitlab.name': 'GitLab',
  'forge.bitbucket.abbrev': 'PR',
  'forge.bitbucket.singular': 'Pull request',
  'forge.bitbucket.plural': 'Pull requests',
  'forge.bitbucket.singularLower': 'pull request',
  'forge.bitbucket.pluralLower': 'pull requests',
  'forge.bitbucket.name': 'Bitbucket',
  'forge.bitbucketServer.abbrev': 'PR',
  'forge.bitbucketServer.singular': 'Pull request',
  'forge.bitbucketServer.plural': 'Pull requests',
  'forge.bitbucketServer.singularLower': 'pull request',
  'forge.bitbucketServer.pluralLower': 'pull requests',
  'forge.bitbucketServer.name': 'Bitbucket Server',
  'forge.bitbucketServer.authHint':
    'Set BITBUCKET_SERVER_TOKEN (or BITBUCKET_SERVER_USERNAME + BITBUCKET_SERVER_PASSWORD) to enable triage.',
  'forge.gitea.abbrev': 'PR',
  'forge.gitea.singular': 'Pull request',
  'forge.gitea.plural': 'Pull requests',
  'forge.gitea.singularLower': 'pull request',
  'forge.gitea.pluralLower': 'pull requests',
  'forge.gitea.name': 'Gitea',
  'forge.gitea.authHint': 'Set the GITEA_TOKEN environment variable to enable triage.',
}
