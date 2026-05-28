/**
 * Screenshot recipe catalog.
 *
 * A recipe describes a deterministic terminal scene we want a high-
 * fidelity screenshot of: which named scenario to spin up (so the
 * underlying git state is reproducible), which coco command to run,
 * what keystrokes to send before capture, and how big the terminal
 * should be.
 *
 * Add new recipes here. Each entry produces one PNG (and optionally a
 * GIF) under `.screenshots/<recipe.name>.png`.
 */

export type ScreenshotRecipeAction =
  | { kind: 'sleep'; ms: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string; count?: number }

export type ScreenshotRecipe = {
  /**
   * Stable filename (no extension). Used as the screenshot output
   * filename and as the recipe's CLI selector. Lowercase + hyphens.
   */
  name: string
  /**
   * One-line summary that surfaces in `--list` output and gets
   * embedded in the generated tape file as a comment.
   */
  description: string
  /**
   * Named scenario from `@gfargo/git-scenarios`. Spun up in a temp
   * dir; coco runs against this directory so the screenshot reflects
   * a known git state. Use `null` for recipes that don't need a git
   * repo (e.g. `--help` output).
   */
  scenario: string | null
  /**
   * Coco command + flags (without the leading `coco`). E.g.
   * `'ui --view history'`. Runs from the temp scenario directory.
   */
  command: string
  /**
   * Optional keystrokes after the command launches, before the final
   * frame is captured. Used to navigate into a specific view, open
   * a panel, etc.
   */
  actions?: ScreenshotRecipeAction[]
  /**
   * Terminal dimensions for the capture. Defaults to 140x40 — wide
   * enough for the workstation's standard 3-pane layout without
   * triggering tight-density fallbacks.
   */
  dimensions?: { cols: number; rows: number }
  /**
   * Theme preset to lock the capture to. Defaults to `default`.
   */
  theme?: 'default' | 'monochrome' | 'catppuccin' | 'gruvbox'
  /**
   * When true, also emit a GIF (`.screenshots/<name>.gif`). Cost is
   * ~3-5x the PNG capture time, so opt-in per recipe rather than
   * default-on. Animated views (loading states, spinner ticks) are
   * the main candidates.
   */
  emitGif?: boolean
}

/**
 * Default snapshot `now` — frozen so relative dates ("3d ago", "2 mo")
 * stay stable across captures. Picked to be far enough in the future
 * of any committed scenario that "today" buckets and recent-relative
 * dates land in expected slots.
 */
export const SNAPSHOT_NOW = '2026-05-27T12:00:00Z'

export const RECIPES: ScreenshotRecipe[] = [
  // ─────────────────────────────────────────────────────────────────
  // `coco ui` — workstation across representative scenarios
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'ui-history-pr-ready',
    description: 'Workstation history view on a PR-ready feature branch',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
  },
  {
    name: 'ui-status-dirty-worktree',
    description: 'Workstation status view with mixed staged/unstaged/untracked files',
    scenario: 'dirty-many-files',
    command: 'ui --view status',
  },
  {
    name: 'ui-history-rich-graph',
    description: 'Workstation history with full multi-ref graph (branches, tags, stashes)',
    scenario: 'rich-history-graph',
    command: 'ui --view history',
  },
  {
    name: 'ui-bisect-in-progress',
    description: 'Workstation history during an active bisect',
    scenario: 'mid-bisect',
    command: 'ui --view history',
  },
  {
    name: 'ui-stash-list',
    description: 'Workstation sidebar Stashes tab with multiple stashes',
    scenario: 'stashed-changes',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gz' },
      { kind: 'sleep', ms: 400 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // `coco ui` — additional views and scenarios
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'ui-branches-sync-showcase',
    description: 'Branches view showing 5 branches in different upstream sync states',
    scenario: 'branch-sync-showcase',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gb' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-diff-feature-branch',
    description: 'Diff view showing a commit diff on a feature branch',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff',
  },
  {
    name: 'ui-merge-conflict',
    description: 'Workstation during an active merge conflict',
    scenario: 'mid-merge-conflict',
    command: 'ui --view history',
  },
  {
    name: 'ui-rebase-conflict',
    description: 'Workstation during an active rebase conflict',
    scenario: 'mid-rebase-conflict',
    command: 'ui --view history',
  },
  {
    name: 'ui-multi-commit-branch',
    description: 'History view with 8 varied conventional commits (feat/fix/chore/docs/refactor/test)',
    scenario: 'multi-commit-branch',
    command: 'ui --view history --no-all',
  },
  {
    name: 'ui-large-repo',
    description: 'History view with 115 commits across 3 branches — pagination stress test',
    scenario: 'large-repo',
    command: 'ui --view history',
  },
  {
    name: 'ui-worktrees',
    description: 'Worktrees view showing 3 linked worktrees on different branches',
    scenario: 'multiple-worktrees',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gw' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-submodule',
    description: 'History view of a repo with a submodule',
    scenario: 'submodule-with-history',
    command: 'ui --view history --no-all',
  },
  {
    name: 'ui-detached-head',
    description: 'Workstation in detached HEAD state',
    scenario: 'detached-head',
    command: 'ui --view history --no-all',
  },

  // ─────────────────────────────────────────────────────────────────
  // `coco ui` — remaining view surfaces for full coverage
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'ui-compose',
    description: 'Compose view with staged changes ready to commit',
    scenario: 'single-staged-file',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gc' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-tags',
    description: 'Tags view on a repo with tagged releases',
    scenario: 'large-repo',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gt' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-conflicts-merge',
    description: 'Conflicts view during an active merge conflict',
    scenario: 'mid-merge-conflict',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gx' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-reflog',
    description: 'Reflog view showing HEAD movement history',
    scenario: 'rich-history-graph',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gr' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-bisect-view',
    description: 'Bisect surface showing the active bisect state and decision log',
    scenario: 'mid-bisect',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gB' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-changelog',
    description: 'Changelog view for a feature branch',
    scenario: 'feature-pr-ready',
    command: 'ui --no-all',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'L' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-submodules-view',
    description: 'Submodules view showing registered submodules with status',
    scenario: 'submodule-with-history',
    command: 'ui',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gM' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-help-overlay',
    description: 'Help overlay showing all keybindings grouped by category',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: '?' },
      { kind: 'sleep', ms: 400 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // `coco workspace` — multi-repo workspace view
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'workspace-multi-repo',
    description: 'Workspace view scanning a directory with 3 repos in different states',
    scenario: '_workspace',
    command: 'workspace --root . --maxDepth 1',
    dimensions: { cols: 140, rows: 40 },
  },

  // ─────────────────────────────────────────────────────────────────
  // Utility commands — non-interactive stdout captures
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'cmd-help',
    description: 'Top-level coco --help output',
    scenario: null,
    command: '--help',
    dimensions: { cols: 100, rows: 30 },
  },
  {
    name: 'cmd-doctor',
    description: 'coco doctor output showing environment checks',
    scenario: 'feature-pr-ready',
    command: 'doctor',
    dimensions: { cols: 100, rows: 30 },
  },
  {
    name: 'cmd-init-dry-run',
    description: 'coco init --dry-run showing the setup wizard preview',
    scenario: 'feature-pr-ready',
    command: 'init --dry-run --scope project',
    dimensions: { cols: 100, rows: 30 },
  },

  // ─────────────────────────────────────────────────────────────────
  // `coco log` — stdout / non-interactive renders
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'log-stdout-feature',
    description: 'Stdout `coco log` against a multi-commit feature branch',
    scenario: 'two-commit-feature',
    command: 'log --limit 10 --no-color',
    dimensions: { cols: 120, rows: 24 },
  },
  {
    name: 'log-stdout-rich-graph',
    description: 'Stdout `coco log` with full graph on a multi-branch repo',
    scenario: 'rich-history-graph',
    command: 'log --limit 20 --all --no-color',
    dimensions: { cols: 140, rows: 30 },
  },

  // ─────────────────────────────────────────────────────────────────
  // Theme variants — same scene, different theme presets
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'ui-history-theme-catppuccin',
    description: 'History view rendered with the catppuccin theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme catppuccin',
    theme: 'catppuccin',
  },
  {
    name: 'ui-history-theme-gruvbox',
    description: 'History view rendered with the gruvbox theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme gruvbox',
    theme: 'gruvbox',
  },
  {
    name: 'ui-history-theme-monochrome',
    description: 'History view rendered with the monochrome theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme monochrome',
    theme: 'monochrome',
  },

  // Theme variants across different views — shows how each theme
  // adapts to status, diff, and branches surfaces
  {
    name: 'ui-status-theme-catppuccin',
    description: 'Status view with catppuccin theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme catppuccin',
    theme: 'catppuccin',
  },
  {
    name: 'ui-status-theme-gruvbox',
    description: 'Status view with gruvbox theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme gruvbox',
    theme: 'gruvbox',
  },
  {
    name: 'ui-branches-theme-catppuccin',
    description: 'Branches view with catppuccin theme showing sync indicators',
    scenario: 'branch-sync-showcase',
    command: 'ui --theme catppuccin',
    theme: 'catppuccin',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gb' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-branches-theme-gruvbox',
    description: 'Branches view with gruvbox theme showing sync indicators',
    scenario: 'branch-sync-showcase',
    command: 'ui --theme gruvbox',
    theme: 'gruvbox',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'gb' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-diff-theme-catppuccin',
    description: 'Diff view with catppuccin theme',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff --theme catppuccin',
    theme: 'catppuccin',
  },
  {
    name: 'ui-diff-theme-gruvbox',
    description: 'Diff view with gruvbox theme',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff --theme gruvbox',
    theme: 'gruvbox',
  },

  // ─────────────────────────────────────────────────────────────────
  // `coco ui` — interactive overlays and focus states
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'ui-command-palette',
    description: 'Command palette overlay showing searchable command list',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: ':' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-search-filter',
    description: 'History view with an active search filter narrowing commits',
    scenario: 'multi-commit-branch',
    command: 'ui --view history --no-all',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: '/' },
      { kind: 'sleep', ms: 300 },
      { kind: 'type', text: 'feat' },
      { kind: 'sleep', ms: 400 },
    ],
  },
  {
    name: 'ui-inspector-focused',
    description: 'History view with the inspector panel focused via tab',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'key', key: 'Tab' },
      { kind: 'sleep', ms: 400 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // Subcommand help outputs — useful for docs reference pages
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'cmd-commit-help',
    description: 'coco commit --help showing all commit options',
    scenario: null,
    command: 'commit --help',
    dimensions: { cols: 100, rows: 35 },
  },
  {
    name: 'cmd-changelog-help',
    description: 'coco changelog --help showing all changelog options',
    scenario: null,
    command: 'changelog --help',
    dimensions: { cols: 100, rows: 30 },
  },
  {
    name: 'cmd-log-help',
    description: 'coco log --help showing all log options',
    scenario: null,
    command: 'log --help',
    dimensions: { cols: 100, rows: 35 },
  },
]

export function findRecipe(name: string): ScreenshotRecipe | undefined {
  return RECIPES.find((r) => r.name === name)
}

export function listRecipeNames(): string[] {
  return RECIPES.map((r) => r.name)
}
