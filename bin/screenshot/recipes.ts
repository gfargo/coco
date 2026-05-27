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
  // `coco log` — stdout / non-interactive renders
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'log-stdout-feature',
    description: 'Stdout `coco log` against a multi-commit feature branch',
    scenario: 'two-commit-feature',
    command: 'log --limit 10 --no-color',
    dimensions: { cols: 120, rows: 24 },
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
]

export function findRecipe(name: string): ScreenshotRecipe | undefined {
  return RECIPES.find((r) => r.name === name)
}

export function listRecipeNames(): string[] {
  return RECIPES.map((r) => r.name)
}
