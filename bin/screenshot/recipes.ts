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
  theme?: string
  /**
   * When true, also emit a GIF (`.screenshots/<name>.gif`). Cost is
   * ~3-5x the PNG capture time, so opt-in per recipe rather than
   * default-on. Animated views (loading states, spinner ticks) are
   * the main candidates.
   */
  emitGif?: boolean
  /**
   * GIF-only: record the workstation *booting up* rather than starting
   * on the already-painted UI. Normal demo GIFs hide the launch and
   * start recording after the view has fully settled; a `recordFromBoot`
   * recipe instead captures the "loading commits" → fully-rendered
   * transition, for an authentic cold-start "boot" story (used by the
   * install/get-started section). Only meaningful when `emitGif` is true.
   * See BOOT_HIDDEN_MS / BOOT_VISIBLE_SETTLE_MS in tape.ts for timing.
   */
  recordFromBoot?: boolean
  /**
   * Add an `origin` remote with this URL to the scenario repo before
   * coco launches. Needed for GitHub-integration views — coco's
   * `getGitHubRepository` parses `github.com/<owner>/<repo>` out of the
   * origin URL. Use `git@github.com:owner/repo.git`.
   */
  githubRemote?: string
  /**
   * When true, prepend a deterministic mock `gh` (bin/screenshot/mock-gh)
   * to PATH so the pull-request / PR-triage / issues views render canned
   * data instead of shelling out to the real GitHub CLI. Pair with
   * `githubRemote`.
   */
  ghMock?: boolean
  /**
   * GitLab counterpart of `githubRemote`. Add an `origin` whose host coco
   * detects as GitLab so the forge layer routes to `glab`. Use
   * `git@gitlab.com:owner/repo.git`.
   */
  gitlabRemote?: string
  /**
   * When true, prepend a deterministic mock `glab` (bin/screenshot/mock-glab)
   * to PATH so the merge-request / MR-triage / issue views render canned data
   * instead of shelling out to the real GitLab CLI. Pair with `gitlabRemote`.
   */
  glabMock?: boolean
}

/**
 * Default snapshot `now` — frozen so relative dates ("3d ago", "2 mo")
 * stay stable across captures. Picked to be far enough in the future
 * of any committed scenario that "today" buckets and recent-relative
 * dates land in expected slots.
 */
export const SNAPSHOT_NOW = '2026-05-27T12:00:00Z'

/**
 * Theme presets added in the "color theme release" — each gets a history-view
 * gallery recipe generated below, mirroring the hand-authored entries for the
 * original presets. Kept as an explicit list (rather than diffing against the
 * existing recipes) so the generated set stays obvious and reviewable.
 */
const NEW_THEME_GALLERY_PRESETS = [
  'catppuccin-frappe', 'rose-pine-moon', 'kanagawa-dragon', 'kanagawa-lotus',
  'nordfox', 'duskfox', 'terafox', 'dawnfox', 'ayu-mirage', 'material-darker',
  'tokyo-night-moon', 'gruvbox-material', 'gruvbox-material-light', 'modus-vivendi',
  'zenburn', 'oxocarbon', 'tomorrow-night', 'monokai-pro', 'sonokai', 'doom-one',
  'andromeda', 'aura', 'cyberdream', 'nightfly', 'panda', 'hyper-snazzy',
  'apprentice', 'melange', 'melange-light', 'spaceduck', 'embark', 'bluloco-dark',
  'bluloco-light', 'papercolor-dark', 'base16-ocean', 'base16-eighties',
  'everblush', 'darcula', 'eldritch', 'edge-light', 'zenbones', 'iceberg-light',
  'github-dark-dimmed', 'edge-dark', 'selenized-dark', 'selenized-black',
  'selenized-light', 'monokai-pro-machine', 'monokai-pro-octagon',
  'monokai-pro-ristretto', 'monokai-pro-spectrum', 'base16-default-dark',
  'base16-default-light', 'tomorrow', 'tokyodark', 'spacemacs-dark', 'bamboo',
  'citylights', 'oxocarbon-light',
  'vscode-dark', 'vscode-light', 'xcode-dark', 'xcode-light', 'sublime-mariana',
  'github-dark-high-contrast', 'noctis', 'shades-of-purple', 'winter-is-coming',
  'tomorrow-night-bright', 'tomorrow-night-eighties', 'molokai', 'jellybeans',
  'railscasts', 'spacegray', 'srcery', 'alabaster',
  'challenger-deep', 'moonfly',
] as const

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
    description: 'Workstation Stashes view — aligned table (ref · age · branch · files · message) + inspector preview',
    scenario: 'stashed-changes',
    command: 'ui',
    actions: [
      // Cold-cache first paint shows "loading context" for a beat; wait it
      // out so `gz` lands after the stash context is ready and the promoted
      // view actually opens (otherwise the capture catches the history view).
      { kind: 'sleep', ms: 3500 },
      { kind: 'type', text: 'gz' },
      { kind: 'sleep', ms: 1200 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // `coco ui` — additional views and scenarios
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'ui-single-pane-narrow',
    description: 'Single-pane fallback at the 80×24 floor — sidebar pane full-width, Tab-cycled',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    // 80×24 is the supported floor and a common tmux-split / SSH size.
    // Below 100 cols the three-panel layout drops to a single full-width
    // pane (no 8-cell rails). Tab twice (commits → inspector → sidebar)
    // to land on the sidebar so the shot shows the full-width accordion
    // that replaced the rail, plus the footer's `tab: [sidebar] …` switcher.
    dimensions: { cols: 80, rows: 24 },
    actions: [
      // Wait out the cold-cache "loading context" beat before Tab-cycling,
      // else the capture lands on an empty/loading pane.
      { kind: 'sleep', ms: 3500 },
      { kind: 'key', key: 'Tab', count: 2 },
      { kind: 'sleep', ms: 800 },
    ],
  },
  {
    name: 'ui-single-pane-peek',
    description: 'Single-pane sidebar "peek" (v) at the 80×24 floor — momentary glance with v/esc → main',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    // `v` momentarily peeks the sidebar from the main pane without
    // losing your place — one key out, one key (v/esc) back. The shot
    // captures the full-width sidebar mid-glance plus the footer's
    // `v/esc → main` snap-back affordance that distinguishes a peek from
    // a Tab-cycle focus move.
    dimensions: { cols: 80, rows: 24 },
    actions: [
      // Wait out the cold-cache "loading context" beat before peeking,
      // else the capture lands on an empty/loading pane.
      { kind: 'sleep', ms: 3500 },
      { kind: 'type', text: 'v' },
      { kind: 'sleep', ms: 800 },
    ],
  },
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
    description: 'Side-by-side (split) diff view of a JavaScript refactor on a feature branch',
    // `diff-js-showcase` (registered in ./scenarios) puts a substantial
    // .js rewrite on the tip commit so the split diff fills with syntax
    // highlighting — keywords, strings, JSDoc, template literals.
    scenario: 'diff-js-showcase',
    command: 'ui --view diff',
    // Press `d` once to switch unified → side-by-side. Split needs the diff
    // panel ≥ MIN_SPLIT_DIFF_WIDTH (120) — and the diff view also shows the
    // sidebar + commit inspector, so the terminal has to be wide enough to
    // leave the diff column ≥ 120 after both.
    dimensions: { cols: 230, rows: 42 },
    actions: [
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'd' },
      { kind: 'sleep', ms: 500 },
    ],
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
    dimensions: { cols: 140, rows: 32 },
    theme: 'catppuccin',
  },
  {
    name: 'ui-history-theme-gruvbox',
    description: 'History view rendered with the gruvbox theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme gruvbox',
    dimensions: { cols: 140, rows: 32 },
    theme: 'gruvbox',
  },
  {
    name: 'ui-history-theme-monochrome',
    description: 'History view rendered with the monochrome theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme monochrome',
    dimensions: { cols: 140, rows: 32 },
    theme: 'monochrome',
  },
  {
    name: 'ui-history-theme-dracula',
    description: 'History view rendered with the dracula theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme dracula',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-nord',
    description: 'History view rendered with the nord theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme nord',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-solarized-dark',
    description: 'History view rendered with the solarized-dark theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme solarized-dark',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-tokyo-night',
    description: 'History view rendered with the tokyo-night theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme tokyo-night',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-one-dark',
    description: 'History view rendered with the one-dark theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme one-dark',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-rose-pine',
    description: 'History view rendered with the rose-pine theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme rose-pine',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-kanagawa',
    description: 'History view rendered with the kanagawa theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme kanagawa',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-everforest',
    description: 'History view rendered with the everforest theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme everforest',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-monokai',
    description: 'History view rendered with the monokai theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme monokai',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-synthwave',
    description: 'History view rendered with the synthwave theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme synthwave',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-ayu-dark',
    description: 'History view rendered with the ayu-dark theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme ayu-dark',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-palenight',
    description: 'History view rendered with the palenight theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme palenight',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-github-dark',
    description: 'History view rendered with the github-dark theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme github-dark',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-horizon',
    description: 'History view rendered with the horizon theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme horizon',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-nightfox',
    description: 'History view rendered with the nightfox theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme nightfox',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-carbonfox',
    description: 'History view rendered with the carbonfox theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme carbonfox',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-tokyonight-storm',
    description: 'History view rendered with the tokyonight-storm theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme tokyonight-storm',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-catppuccin-latte',
    description: 'History view rendered with the catppuccin-latte light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme catppuccin-latte',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-solarized-light',
    description: 'History view rendered with the solarized-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme solarized-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-github-light',
    description: 'History view rendered with the github-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme github-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-iceberg',
    description: 'History view rendered with the iceberg theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme iceberg',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-material-ocean',
    description: 'History view rendered with the material-ocean theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme material-ocean',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-moonlight',
    description: 'History view rendered with the moonlight theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme moonlight',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-poimandres',
    description: 'History view rendered with the poimandres theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme poimandres',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-vitesse-dark',
    description: 'History view rendered with the vitesse-dark theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme vitesse-dark',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-vesper',
    description: 'History view rendered with the vesper theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme vesper',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-flexoki',
    description: 'History view rendered with the flexoki theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme flexoki',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-mellow',
    description: 'History view rendered with the mellow theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme mellow',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-night-owl',
    description: 'History view rendered with the night-owl theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme night-owl',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-cobalt2',
    description: 'History view rendered with the cobalt2 theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme cobalt2',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-oceanic-next',
    description: 'History view rendered with the oceanic-next theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme oceanic-next',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-catppuccin-macchiato',
    description: 'History view rendered with the catppuccin-macchiato theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme catppuccin-macchiato',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-gruvbox-light',
    description: 'History view rendered with the gruvbox-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme gruvbox-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-tokyo-night-day',
    description: 'History view rendered with the tokyo-night-day theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme tokyo-night-day',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-one-light',
    description: 'History view rendered with the one-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme one-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-ayu-light',
    description: 'History view rendered with the ayu-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme ayu-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-rose-pine-dawn',
    description: 'History view rendered with the rose-pine-dawn theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme rose-pine-dawn',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-everforest-light',
    description: 'History view rendered with the everforest-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme everforest-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-vitesse-light',
    description: 'History view rendered with the vitesse-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme vitesse-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-dayfox',
    description: 'History view rendered with the dayfox theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme dayfox',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-night-owl-light',
    description: 'History view rendered with the night-owl-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme night-owl-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-flexoki-light',
    description: 'History view rendered with the flexoki-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme flexoki-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-material-lighter',
    description: 'History view rendered with the material-lighter theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme material-lighter',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-papercolor-light',
    description: 'History view rendered with the papercolor-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme papercolor-light',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-modus-operandi',
    description: 'History view rendered with the modus-operandi theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme modus-operandi',
    dimensions: { cols: 140, rows: 32 },
  },
  {
    name: 'ui-history-theme-quiet-light',
    description: 'History view rendered with the quiet-light theme preset',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --theme quiet-light',
    dimensions: { cols: 140, rows: 32 },
  },

  // Color theme release — history-view gallery recipes for the new presets,
  // generated from NEW_THEME_GALLERY_PRESETS so the catalog stays in one place.
  ...NEW_THEME_GALLERY_PRESETS.map((preset): ScreenshotRecipe => ({
    name: `ui-history-theme-${preset}`,
    description: `History view rendered with the ${preset} theme preset`,
    scenario: 'feature-pr-ready',
    command: `ui --view history --theme ${preset}`,
    dimensions: { cols: 140, rows: 32 },
    theme: preset,
  })),

  // Theme variants across different views — shows how each theme
  // adapts to status, diff, and branches surfaces
  {
    name: 'ui-status-theme-catppuccin',
    description: 'Status view with catppuccin theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme catppuccin',
    theme: 'catppuccin',
    // Status loads worktree + branches async; give it room past the
    // launch settle so the capture isn't of the loading placeholder.
    actions: [{ kind: 'sleep', ms: 3000 }],
  },
  {
    name: 'ui-status-theme-gruvbox',
    description: 'Status view with gruvbox theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme gruvbox',
    theme: 'gruvbox',
    // Status loads worktree + branches async; give it room past the
    // launch settle so the capture isn't of the loading placeholder.
    actions: [{ kind: 'sleep', ms: 3000 }],
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

  // Themed showcase set (#workstation marketing) — the diff and status
  // surfaces across a curated set of dark + light themes. The diff view
  // is the most color-rich surface (now syntax-highlighted), so it shows
  // off how a theme recolors code, additions, removals, and chrome.
  {
    name: 'ui-diff-theme-dracula',
    description: 'Diff view with dracula theme',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff --theme dracula',
    theme: 'dracula',
  },
  {
    name: 'ui-diff-theme-tokyo-night',
    description: 'Diff view with tokyo-night theme',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff --theme tokyo-night',
    theme: 'tokyo-night',
  },
  {
    name: 'ui-diff-theme-nord',
    description: 'Diff view with nord theme',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff --theme nord',
    theme: 'nord',
  },
  {
    name: 'ui-diff-theme-rose-pine',
    description: 'Diff view with rose-pine theme',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff --theme rose-pine',
    theme: 'rose-pine',
  },
  {
    name: 'ui-diff-theme-github-light',
    description: 'Diff view with github-light theme',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff --theme github-light',
    theme: 'github-light',
  },
  {
    name: 'ui-diff-theme-catppuccin-latte',
    description: 'Diff view with catppuccin-latte (light) theme',
    scenario: 'feature-pr-ready',
    command: 'ui --view diff --theme catppuccin-latte',
    theme: 'catppuccin-latte',
  },
  {
    name: 'ui-status-theme-dracula',
    description: 'Status view with dracula theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme dracula',
    theme: 'dracula',
    // Status loads worktree + branches async; give it room past the
    // launch settle so the capture isn't of the loading placeholder.
    actions: [{ kind: 'sleep', ms: 3000 }],
  },
  {
    name: 'ui-status-theme-tokyo-night',
    description: 'Status view with tokyo-night theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme tokyo-night',
    theme: 'tokyo-night',
    // Status loads worktree + branches async; give it room past the
    // launch settle so the capture isn't of the loading placeholder.
    actions: [{ kind: 'sleep', ms: 3000 }],
  },
  {
    name: 'ui-status-theme-nord',
    description: 'Status view with nord theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme nord',
    theme: 'nord',
    // Status loads worktree + branches async; give it room past the
    // launch settle so the capture isn't of the loading placeholder.
    actions: [{ kind: 'sleep', ms: 3000 }],
  },
  {
    name: 'ui-status-theme-rose-pine',
    description: 'Status view with rose-pine theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme rose-pine',
    theme: 'rose-pine',
    // Status loads worktree + branches async; give it room past the
    // launch settle so the capture isn't of the loading placeholder.
    actions: [{ kind: 'sleep', ms: 3000 }],
  },
  {
    name: 'ui-status-theme-github-light',
    description: 'Status view with github-light theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme github-light',
    theme: 'github-light',
    // Status loads worktree + branches async; give it room past the
    // launch settle so the capture isn't of the loading placeholder.
    actions: [{ kind: 'sleep', ms: 3000 }],
  },
  {
    name: 'ui-status-theme-catppuccin-latte',
    description: 'Status view with catppuccin-latte (light) theme',
    scenario: 'dirty-many-files',
    command: 'ui --view status --theme catppuccin-latte',
    theme: 'catppuccin-latte',
    // Status loads worktree + branches async; give it room past the
    // launch settle so the capture isn't of the loading placeholder.
    actions: [{ kind: 'sleep', ms: 3000 }],
  },

  {
    name: 'ui-staging-hunks',
    description: 'Worktree staging diff — per-hunk badges, selected-hunk bar, staged progress',
    scenario: 'dirty-many-files',
    command: 'ui --view status',
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 3200 },
      // Open an unstaged (modified) file so the ○ badge + bar read as
      // "ready to stage" rather than already-staged.
      { kind: 'key', key: 'Down', count: 14 },
      { kind: 'sleep', ms: 600 },
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 2200 },
    ],
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
    name: 'ui-theme-picker',
    description: 'Theme picker overlay (gC) — browse, filter & live-preview color themes',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    actions: [
      { kind: 'sleep', ms: 800 },
      // `gC` chord opens the picker; the workstation live-previews the
      // cursored theme underneath while the overlay lists every preset.
      { kind: 'type', text: 'gC' },
      { kind: 'sleep', ms: 500 },
      // Type a filter to show the fuzzy/substring narrowing in action.
      { kind: 'type', text: 'gruv' },
      { kind: 'sleep', ms: 500 },
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

  // ─────────────────────────────────────────────────────────────────
  // GIF demos — animated workflows for the marketing site
  // ─────────────────────────────────────────────────────────────────
  {
    name: 'demo-workstation-tour',
    description: 'Workspace → enter a repo → drill into a commit → open its diff → back out',
    scenario: '_workspace',
    command: 'workspace --root . --maxDepth 1',
    emitGif: true,
    actions: [
      // Browse the workspace and pick a repo
      { kind: 'sleep', ms: 1800 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 650 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 800 },
      // Enter it — drops into the repo's history view
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 3200 },
      // Walk down to a target commit
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 450 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 450 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 800 },
      // Enter on the commit opens its diff
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 2400 },
      // Scroll through the diff
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 380 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 380 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 1600 },
      // Back out of the diff, then quit to the workspace (clean loop)
      { kind: 'type', text: '<' },
      { kind: 'sleep', ms: 1000 },
      { kind: 'type', text: 'q' },
      { kind: 'sleep', ms: 1600 },
    ],
  },
  {
    name: 'demo-ui-view-switching',
    description: 'UI: cursor movement + open diff + scroll + chord navigation',
    scenario: 'rich-history-graph',
    command: 'ui --view history',
    emitGif: true,
    actions: [
      // Browse history — move cursor down
      { kind: 'sleep', ms: 800 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 400 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 400 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 600 },
      // Open diff for the selected commit
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 1200 },
      // Scroll down in the diff
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 300 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 300 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 300 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 800 },
      // Navigate to status
      { kind: 'type', text: 'gs' },
      { kind: 'sleep', ms: 1500 },
      // Navigate to branches
      { kind: 'type', text: 'gb' },
      { kind: 'sleep', ms: 1500 },
      // Back to history
      { kind: 'type', text: 'gh' },
      { kind: 'sleep', ms: 1000 },
    ],
  },
  {
    name: 'demo-hunk-staging',
    description: 'UI: navigate status files and stage with Space',
    scenario: 'dirty-many-files',
    command: 'ui --view status',
    emitGif: true,
    actions: [
      { kind: 'sleep', ms: 1500 },
      // Move down to a file
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 400 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 400 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 600 },
      // Stage it
      { kind: 'key', key: 'Space' },
      { kind: 'sleep', ms: 800 },
      // Move down and stage another
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 400 },
      { kind: 'key', key: 'Space' },
      { kind: 'sleep', ms: 800 },
      // Move down and stage one more
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 400 },
      { kind: 'key', key: 'Space' },
      { kind: 'sleep', ms: 1200 },
    ],
  },
  {
    name: 'demo-help-overlay',
    description: 'UI: open help overlay, scroll, close',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    emitGif: true,
    actions: [
      { kind: 'sleep', ms: 1200 },
      { kind: 'type', text: '?' },
      { kind: 'sleep', ms: 1500 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 300 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 300 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 300 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 300 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 1200 },
      { kind: 'type', text: '?' },
      { kind: 'sleep', ms: 1000 },
    ],
  },
  {
    name: 'demo-view-keys',
    description: 'UI: g? surfaces the single-key actions for the current view; the list changes per view (#1137)',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    emitGif: true,
    actions: [
      { kind: 'sleep', ms: 1500 },
      // g? opens the per-view strip on the history view (cherry-pick c,
      // revert R, reset Z, …). The brief g-chord flash shows the relationship.
      { kind: 'type', text: 'g?' },
      { kind: 'sleep', ms: 2600 },
      { kind: 'key', key: 'Escape' },
      { kind: 'sleep', ms: 600 },
      // Jump to the branches view, then g? again — the strip now lists a
      // different set (mark-compare m, sort s, yank y, …), proving it's
      // sourced live from the active view's bindings.
      { kind: 'type', text: 'gb' },
      { kind: 'sleep', ms: 1300 },
      { kind: 'type', text: 'g?' },
      { kind: 'sleep', ms: 2600 },
      { kind: 'key', key: 'Escape' },
      { kind: 'sleep', ms: 700 },
    ],
  },
  {
    name: 'demo-search-filter',
    description: 'UI: open search, type query, see results filter live, clear',
    scenario: 'multi-commit-branch',
    command: 'ui --view history --no-all',
    emitGif: true,
    actions: [
      { kind: 'sleep', ms: 1200 },
      { kind: 'type', text: '/' },
      { kind: 'sleep', ms: 500 },
      { kind: 'type', text: 'f' },
      { kind: 'sleep', ms: 300 },
      { kind: 'type', text: 'e' },
      { kind: 'sleep', ms: 300 },
      { kind: 'type', text: 'a' },
      { kind: 'sleep', ms: 300 },
      { kind: 'type', text: 't' },
      { kind: 'sleep', ms: 1500 },
      { kind: 'key', key: 'Escape' },
      { kind: 'sleep', ms: 1000 },
    ],
  },
  {
    name: 'demo-workspace-to-ui',
    description: 'Workspace → enter repo → switch views in ui → quit back to workspace',
    scenario: '_workspace',
    command: 'workspace --root . --maxDepth 1',
    emitGif: true,
    actions: [
      { kind: 'sleep', ms: 2000 },
      // Enter the first repo
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 3000 },
      // Switch to status
      { kind: 'type', text: 'gs' },
      { kind: 'sleep', ms: 1500 },
      // Switch to branches
      { kind: 'type', text: 'gb' },
      { kind: 'sleep', ms: 1500 },
      // Quit back to workspace
      { kind: 'type', text: 'q' },
      { kind: 'sleep', ms: 2000 },
    ],
  },
  {
    name: 'demo-commit-flow',
    description: 'coco commit: AI drafts a Conventional Commit message from staged code changes',
    scenario: 'partial-stage',
    command: 'commit --dry-run --conventional',
    emitGif: true,
    dimensions: { cols: 100, rows: 28 },
    actions: [
      // The scenario has no commitlint config, so coco asks how to proceed —
      // accept the default ("continue without validation") and let the model
      // draft the message.
      { kind: 'sleep', ms: 3500 },
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 6000 },
    ],
  },
  {
    name: 'demo-changelog',
    description: 'coco changelog: generate a changelog for a feature branch',
    scenario: 'feature-pr-ready',
    command: 'changelog --branch main',
    emitGif: true,
    dimensions: { cols: 100, rows: 24 },
    actions: [
      { kind: 'sleep', ms: 3000 },
    ],
  },
  {
    name: 'demo-commit-split',
    description: 'coco commit --split: AI groups a messy staging area into a multi-commit plan',
    scenario: 'dirty-many-files',
    command: 'commit --split --plan --conventional',
    emitGif: true,
    dimensions: { cols: 100, rows: 30 },
    actions: [
      { kind: 'sleep', ms: 4000 },
    ],
  },
  {
    name: 'demo-workspace-add-repo',
    description: 'Workspace → `a` add-a-repo prompt with tab path-completion',
    scenario: '_workspace',
    command: 'workspace --root . --maxDepth 1',
    emitGif: true,
    actions: [
      { kind: 'sleep', ms: 2000 },
      // Open the add-repo prompt (draft starts at `~/`).
      { kind: 'type', text: 'a' },
      { kind: 'sleep', ms: 900 },
      // Tab-complete the home directory to reveal the completion list.
      { kind: 'key', key: 'Tab' },
      { kind: 'sleep', ms: 1400 },
      // Type a fragment, then complete again to show it narrowing.
      { kind: 'type', text: 'd' },
      { kind: 'sleep', ms: 700 },
      { kind: 'key', key: 'Tab' },
      { kind: 'sleep', ms: 1400 },
      { kind: 'key', key: 'Escape' },
      { kind: 'sleep', ms: 700 },
      { kind: 'type', text: 'q' },
      { kind: 'sleep', ms: 1500 },
    ],
  },
  {
    name: 'demo-workspace-clone',
    description: 'Workspace → `c` clone a remote → URL prompt auto-derives the destination',
    scenario: '_workspace',
    command: 'workspace --root . --maxDepth 1',
    emitGif: true,
    actions: [
      { kind: 'sleep', ms: 2000 },
      // Open the clone prompt.
      { kind: 'type', text: 'c' },
      { kind: 'sleep', ms: 900 },
      // Type a remote URL — the destination derives as you type.
      { kind: 'type', text: 'git@github.com:gfargo/coco.git' },
      { kind: 'sleep', ms: 1600 },
      // Enter advances to the (auto-filled, editable) destination field.
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 1800 },
      { kind: 'key', key: 'Escape' },
      { kind: 'sleep', ms: 700 },
      { kind: 'type', text: 'q' },
      { kind: 'sleep', ms: 1500 },
    ],
  },
  {
    name: 'demo-workstation-using',
    description: 'Using the workstation: history → open a syntax-highlighted diff → status → branches → help',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    emitGif: true,
    dimensions: { cols: 150, rows: 40 },
    actions: [
      { kind: 'sleep', ms: 3200 },
      // Walk the history, then open a commit's (syntax-highlighted) diff.
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 600 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 600 },
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 2200 },
      // Back to history, then tour a couple of other surfaces.
      { kind: 'type', text: '<' },
      { kind: 'sleep', ms: 900 },
      { kind: 'type', text: 'gs' },
      { kind: 'sleep', ms: 1500 },
      { kind: 'type', text: 'gb' },
      { kind: 'sleep', ms: 1500 },
      // Help overlay, then close + quit.
      { kind: 'type', text: '?' },
      { kind: 'sleep', ms: 1800 },
      { kind: 'key', key: 'Escape' },
      { kind: 'sleep', ms: 500 },
      { kind: 'type', text: 'q' },
      { kind: 'sleep', ms: 1200 },
    ],
  },
  {
    name: 'demo-staging-hunks',
    description: 'Tactile hunk staging: open a changed file, see the ○ badge + selected-hunk bar, stage it (badge flips ●), file moves to Staged',
    scenario: 'dirty-many-files',
    command: 'ui --view status',
    emitGif: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 3200 },
      // Drop into the Unstaged group (past the staged files + headers).
      { kind: 'key', key: 'Down', count: 14 },
      { kind: 'sleep', ms: 800 },
      // Open the file's staging diff — ○ unstaged badge + accent hunk bar.
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 2400 },
      // Stage the cursored hunk — the ○ badge flips to ● and "0/1" → "1/1".
      { kind: 'type', text: ' ' },
      { kind: 'sleep', ms: 2000 },
      // Back out — the file has moved into the Staged group.
      { kind: 'type', text: '<' },
      { kind: 'sleep', ms: 1800 },
    ],
  },
  {
    name: 'demo-stash-workflow',
    description: 'Stash like a pro: open the Stashes view (aligned table — ref · age · branch · files · message), rename one (R), see the row update + inspector preview',
    scenario: 'stashed-changes',
    command: 'ui',
    emitGif: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      // Wait out the cold-cache "loading context" beat before the gz chord.
      { kind: 'sleep', ms: 4000 },
      // Jump to the Stashes view — an aligned table (ref · age · branch ·
      // files · message) with the inspector previewing contents.
      { kind: 'type', text: 'gz' },
      { kind: 'sleep', ms: 2600 },
      // Rename the cursored stash — git has no native rename, so coco
      // re-stores the commit under a new message and drops the old entry.
      { kind: 'type', text: 'R' },
      { kind: 'sleep', ms: 900 },
      { kind: 'type', text: 'auth refactor — wip' },
      { kind: 'sleep', ms: 900 },
      { kind: 'key', key: 'Enter' },
      // The row's message updates in place; the rest of the list is intact.
      { kind: 'sleep', ms: 2600 },
    ],
  },
  {
    name: 'demo-checkout-worktree-conflict',
    description: 'Worktree-aware checkout: enter on a branch checked out in another worktree raises a prompt — switch there (y), remove & checkout here (r), or remove & delete branch (x)',
    // multiple-worktrees: main here, feat/alpha · feat/beta · hotfix/urgent
    // each checked out in their own linked worktrees — so a checkout from
    // the branches view hits the "already checked out" conflict.
    scenario: 'multiple-worktrees',
    command: 'ui',
    emitGif: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      // Branches view, then cursor onto a worktree-held branch (row 1 —
      // main is pinned at row 0) and press Enter to attempt the checkout.
      { kind: 'type', text: 'gb' },
      { kind: 'sleep', ms: 1200 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 800 },
      { kind: 'key', key: 'Enter' },
      // The conflict prompt: y switch · r remove & checkout here · x
      // remove & delete branch · n cancel.
      { kind: 'sleep', ms: 2400 },
      // y switches into that worktree (opened as a nested repo frame),
      // landing on the branch where it actually lives.
      { kind: 'type', text: 'y' },
      { kind: 'sleep', ms: 2400 },
    ],
  },
  {
    name: 'ui-which-key',
    description: 'Which-key chord overlay — press g to see the live menu of g-chord view selectors',
    scenario: 'feature-pr-ready',
    command: 'ui',
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 3500 },
      // `g` enters chord-pending mode and pops the which-key overlay
      // listing every g-continuation (the discoverability surface).
      { kind: 'type', text: 'g' },
      { kind: 'sleep', ms: 900 },
    ],
  },
  {
    name: 'ui-view-keys',
    description: 'View-keys which-key strip (g?) — the single-key actions available in the current view (#1137)',
    scenario: 'feature-pr-ready',
    command: 'ui',
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 3500 },
      // `g?` opens the per-view strip listing the bare single keys
      // (cherry-pick c, revert R, …) live for the current view.
      { kind: 'type', text: 'g?' },
      { kind: 'sleep', ms: 900 },
    ],
  },
  {
    name: 'ui-compare-refs',
    description: 'Compare two refs — mark a branch with m, Enter on another to diff base..head (#779)',
    scenario: 'branch-sync-showcase',
    command: 'ui',
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 3500 },
      { kind: 'type', text: 'gb' },         // branches view
      { kind: 'sleep', ms: 1200 },
      { kind: 'type', text: 'm' },          // mark the cursored branch as compare base
      { kind: 'sleep', ms: 1000 },
      { kind: 'key', key: 'Down', count: 2 }, // move to another branch
      { kind: 'sleep', ms: 600 },
      { kind: 'key', key: 'Enter' },        // open the compare diff (git diff base..head)
      { kind: 'sleep', ms: 1800 },
    ],
  },
  {
    name: 'ui-stage-pathspec',
    description: 'Bulk staging — + opens a pathspec prompt to stage matching files at once (A stages everything)',
    scenario: 'dirty-many-files',
    command: 'ui --view status',
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 3500 },
      { kind: 'type', text: '+' },          // open the stage-by-pathspec prompt
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'src/*.ts' },   // a glob — goes straight to git, no shell
      { kind: 'sleep', ms: 1200 },
    ],
  },
  {
    name: 'ui-pull-request',
    description: 'Pull-request view (g p) — the current branch\'s PR with checks, reviews, and actions (mock gh)',
    scenario: 'feature-pr-ready',
    command: 'ui',
    githubRemote: 'git@github.com:gfargo/coco.git',
    ghMock: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gp' },
      { kind: 'sleep', ms: 2000 },
    ],
  },
  {
    name: 'ui-pr-triage',
    description: 'PR triage view (g P) — multi-PR list with state/draft/review badges + filter cycling (mock gh)',
    scenario: 'feature-pr-ready',
    command: 'ui',
    githubRemote: 'git@github.com:gfargo/coco.git',
    ghMock: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gP' },
      { kind: 'sleep', ms: 2000 },
    ],
  },
  {
    name: 'ui-issues',
    description: 'Issues view (g i) — open issues with labels/assignees + inspector body preview (mock gh)',
    scenario: 'feature-pr-ready',
    command: 'ui',
    githubRemote: 'git@github.com:gfargo/coco.git',
    ghMock: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gi' },
      { kind: 'sleep', ms: 2000 },
    ],
  },
  // GitLab-backed workstation views — same surfaces as the gh recipes above,
  // but the scenario remote is a GitLab host so coco routes through `glab`
  // (mocked deterministically by bin/screenshot/mock-glab).
  {
    name: 'ui-gitlab-mr-triage',
    description: 'GitLab MR triage (g P) — merge requests with draft / pipeline / approval badges, served via glab (mock glab)',
    scenario: 'feature-pr-ready',
    command: 'ui',
    gitlabRemote: 'git@gitlab.com:gfargo/coco.git',
    glabMock: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gP' },
      { kind: 'sleep', ms: 2000 },
    ],
  },
  {
    name: 'ui-gitlab-issues',
    description: 'GitLab issues (g i) — issues with labels / assignees + inspector, served via glab (mock glab)',
    scenario: 'feature-pr-ready',
    command: 'ui',
    gitlabRemote: 'git@gitlab.com:gfargo/coco.git',
    glabMock: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gi' },
      { kind: 'sleep', ms: 2000 },
    ],
  },
  {
    name: 'ui-gitlab-merge-request',
    description: 'GitLab merge request (g p) — current branch MR with pipeline status, approvals, and actions (mock glab)',
    scenario: 'feature-pr-ready',
    command: 'ui',
    gitlabRemote: 'git@gitlab.com:gfargo/coco.git',
    glabMock: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gp' },
      { kind: 'sleep', ms: 2000 },
    ],
  },
  {
    // Animated demo for the marketing site — GitLab MR triage in motion:
    // enter the triage list, browse rows (the inspector re-hydrates per MR),
    // then cycle the filter. Served via mock glab so it stays deterministic.
    name: 'demo-gitlab-mr-triage',
    description: 'GitLab MR triage in motion — open merge requests (g P), browse rows, inspector updates per MR, filter cycling (mock glab) [GIF]',
    scenario: 'feature-pr-ready',
    command: 'ui',
    gitlabRemote: 'git@gitlab.com:gfargo/coco.git',
    glabMock: true,
    dimensions: { cols: 150, rows: 38 },
    emitGif: true,
    actions: [
      // The MR-triage surface is only reachable via the `gP` chord (the --view
      // flag only exposes history/status/diff), so settle, then open it on
      // camera and browse. The GIF reads as "open coco ui -> g P -> merge
      // requests -> browse them".
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gP' },
      { kind: 'sleep', ms: 1800 },
      { kind: 'type', text: 'j' },
      { kind: 'sleep', ms: 1400 },
      { kind: 'type', text: 'j' },
      { kind: 'sleep', ms: 1400 },
      { kind: 'type', text: 'k' },
      { kind: 'sleep', ms: 1400 },
      { kind: 'type', text: 'f' },
      { kind: 'sleep', ms: 1700 },
    ],
  },
  {
    name: 'demo-single-pane',
    description: 'Narrow terminal in motion: at 80×24 the panes fold to one — Tab cycles sidebar→main→inspector, v peeks the sidebar',
    scenario: 'feature-pr-ready',
    command: 'ui --view history --no-all',
    emitGif: true,
    dimensions: { cols: 80, rows: 24 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'key', key: 'Tab' },     // main → inspector
      { kind: 'sleep', ms: 1500 },
      { kind: 'key', key: 'Tab' },     // inspector → sidebar
      { kind: 'sleep', ms: 1500 },
      { kind: 'key', key: 'Tab' },     // sidebar → main
      { kind: 'sleep', ms: 1500 },
      { kind: 'type', text: 'v' },     // peek the sidebar
      { kind: 'sleep', ms: 1700 },
      { kind: 'type', text: 'v' },     // snap back to main
      { kind: 'sleep', ms: 1200 },
    ],
  },
  {
    name: 'demo-conflicts',
    description: 'Resolve a merge conflict: keep theirs (u) on one file, keep ours (U) on the next, from the conflicts view',
    scenario: 'mid-merge-conflict',
    command: 'ui',
    emitGif: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gx' },    // conflicts view
      { kind: 'sleep', ms: 2000 },
      { kind: 'type', text: 'u' },     // keep theirs (incoming) on the cursored file
      { kind: 'sleep', ms: 1600 },
      { kind: 'key', key: 'Down' },    // next conflicted file
      { kind: 'sleep', ms: 800 },
      { kind: 'type', text: 'U' },     // keep ours (current branch) on this one
      { kind: 'sleep', ms: 1800 },
    ],
  },
  {
    name: 'demo-bisect',
    description: 'Bisect in motion: mark a commit bad (b) then good (g) and watch the range narrow',
    scenario: 'mid-bisect',
    command: 'ui',
    emitGif: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gB' },    // bisect view
      { kind: 'sleep', ms: 2000 },
      { kind: 'type', text: 'b' },     // mark the current candidate bad
      { kind: 'sleep', ms: 1900 },
      { kind: 'type', text: 'g' },     // mark the next candidate good
      { kind: 'sleep', ms: 1900 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────
  // Multi-step TOUR demos — complete-task journeys, vs the single-feature
  // clips above. Longer and more deliberate: each tells one end-to-end
  // story (the inner loop, the PR loop, recovery, many-repos). The lossy
  // pipeline collapses their idle sleep-frames, so even ~20s tours land
  // small. Sleep durations + key counts below are first-pass estimates —
  // tune them empirically against rendered output (see VHS gotchas in the
  // screenshot README) before wiring the GIFs into the site.
  // ───────────────────────────────────────────────────────────────────
  {
    name: 'demo-tour-ship-change',
    description:
      'Tour — ship a change (inner loop): status → open a file → stage a hunk → compose → the model drafts a Conventional Commit message, ready to review',
    scenario: 'dirty-many-files',
    command: 'ui --view status',
    emitGif: true,
    dimensions: { cols: 150, rows: 40 },
    actions: [
      { kind: 'sleep', ms: 3500 },
      // Walk into the Unstaged group and open a file's staging diff.
      { kind: 'key', key: 'Down', count: 14 },
      { kind: 'sleep', ms: 800 },
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 1800 },
      // Stage the cursored hunk — the ○ badge flips to ●.
      { kind: 'type', text: ' ' },
      { kind: 'sleep', ms: 1500 },
      { kind: 'type', text: '<' }, // back to status; the file is now Staged
      { kind: 'sleep', ms: 1400 },
      // Compose the commit and let the model draft the message.
      { kind: 'type', text: 'gc' }, // compose view
      { kind: 'sleep', ms: 1600 },
      { kind: 'type', text: 'I' }, // AI draft (compose footer: "I AI draft")
      { kind: 'sleep', ms: 900 },
      { kind: 'type', text: 'y' }, // confirm the AI action ("press y to confirm")
      { kind: 'sleep', ms: 7000 }, // model generates — Summary/Body stream in
      // The draft lands in edit mode; Esc exits editing (keeping the message)
      // so the closing frame is the finished, AI-written commit — the payoff.
      { kind: 'key', key: 'Escape' },
      { kind: 'sleep', ms: 2200 },
    ],
  },
  {
    name: 'demo-tour-review-pr',
    description:
      "Tour — review a PR (outer loop): open the current branch's PR (body, checks, reviews), then the multi-PR triage list and cycle the filter (mock gh)",
    scenario: 'feature-pr-ready',
    command: 'ui',
    githubRemote: 'git@github.com:gfargo/coco.git',
    ghMock: true,
    emitGif: true,
    dimensions: { cols: 150, rows: 40 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gp' }, // current branch's PR: body + checks + reviews
      { kind: 'sleep', ms: 2800 },
      // Cross to the triage list to show the breadth.
      { kind: 'type', text: 'gP' }, // PR triage (multi-PR)
      { kind: 'sleep', ms: 2000 },
      { kind: 'type', text: 'j' }, // browse rows — inspector re-hydrates per PR
      { kind: 'sleep', ms: 1400 },
      { kind: 'type', text: 'j' },
      { kind: 'sleep', ms: 1400 },
      { kind: 'type', text: 'f' }, // cycle the filter (open / draft / mine / …)
      { kind: 'sleep', ms: 1800 },
    ],
  },
  {
    name: 'demo-tour-find-regression',
    description:
      'Tour — recover / track down a regression: open bisect, mark bad → good → good and watch the candidate range collapse toward the culprit',
    scenario: 'mid-bisect',
    command: 'ui',
    emitGif: true,
    dimensions: { cols: 150, rows: 40 },
    actions: [
      { kind: 'sleep', ms: 4000 },
      { kind: 'type', text: 'gB' }, // bisect view
      { kind: 'sleep', ms: 2200 },
      { kind: 'type', text: 'b' }, // current candidate is bad
      { kind: 'sleep', ms: 1900 },
      { kind: 'type', text: 'g' }, // next candidate good — the range halves
      { kind: 'sleep', ms: 1900 },
      { kind: 'type', text: 'g' }, // narrow again toward the first bad commit
      { kind: 'sleep', ms: 2200 },
    ],
  },
  {
    name: 'demo-tour-workspace',
    description:
      'Tour — drive many repos: scan the multi-repo workspace (dirty / ahead-behind / PR state), browse the list, then Enter a repo to drive it as a full workstation and land on its history',
    scenario: '_workspace',
    command: 'workspace --root . --maxDepth 1',
    emitGif: true,
    dimensions: { cols: 150, rows: 40 },
    actions: [
      { kind: 'sleep', ms: 2600 },
      // Browse the repo overview — each row shows dirty / ahead-behind / open
      // PRs. Walking it IS the "many repos, one screen" beat.
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 900 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 900 },
      { kind: 'key', key: 'Up' },
      { kind: 'sleep', ms: 800 },
      // Drive the cursored repo — it opens as a full workstation (history).
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 3200 },
      // Walk the driven repo's history and settle there — the closing frame
      // reads as "I'm now driving this repo", and loops cleanly back to the
      // workspace list.
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 700 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 2200 },
    ],
  },

  {
    name: 'demo-boot-workstation',
    description:
      'Cold boot: `coco ui` comes to life on a real repo — loading commits → the full three-pane workstation paints in, then a live cursor walks the rich graph history (install/get-started hero)',
    scenario: 'rich-history-graph',
    command: 'ui --view history',
    emitGif: true,
    recordFromBoot: true,
    dimensions: { cols: 150, rows: 38 },
    actions: [
      // The recording opens mid-boot (loading → painted) via recordFromBoot;
      // by the time the first action fires the workstation is live. Let the
      // freshly-painted view breathe before touching anything.
      { kind: 'sleep', ms: 1100 },
      // Walk the rich multi-branch graph so it reads as a real, interactive
      // session — not a static screenshot. Unhurried so each row is legible.
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 700 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 700 },
      { kind: 'key', key: 'Down' },
      { kind: 'sleep', ms: 900 },
      // Open the cursored commit's diff — proof the workstation is doing real
      // work the instant it boots, then settle on it as the closing frame.
      { kind: 'key', key: 'Enter' },
      { kind: 'sleep', ms: 2400 },
    ],
  },
]

export function findRecipe(name: string): ScreenshotRecipe | undefined {
  return RECIPES.find((r) => r.name === name)
}

export function listRecipeNames(): string[] {
  return RECIPES.map((r) => r.name)
}
