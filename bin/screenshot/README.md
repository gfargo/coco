# Screenshot tooling

High-fidelity PNG / GIF captures of the coco TUI for documentation, marketing, and visual regression checks. Powered by [VHS](https://github.com/charmbracelet/vhs) (a real PTY + xterm.js + headless browser pipeline that produces output identical to what a user sees in their terminal).

## Quick start

```bash
brew install vhs                          # one-time setup
npm run screenshot                        # capture every recipe
npm run screenshot -- --list              # list available recipes
npm run screenshot -- --recipe ui-history-pr-ready
npm run screenshot -- --recipe foo --keep-tape  # leave the .tape file behind for debugging
```

Output lands in `.screenshots/<recipe-name>.png` (gitignored).

## How it works

Three components:

- **`bin/screenshot/recipes.ts`** — catalog of named scenes. Each recipe declares which `@gfargo/git-scenarios` scenario to spin up, which coco command to run, what keystrokes to send, and the terminal dimensions.
- **`bin/screenshot/tape.ts`** — converts a recipe into a [VHS tape file](https://github.com/charmbracelet/vhs#vhs-tapes) (the DSL that drives the PTY).
- **`bin/screenshot.ts`** — the driver: spins up the scenario, generates the tape, hands it to `vhs`, captures the PNG, cleans up.

## Determinism

The screenshots have to look identical between runs to be useful. The harness controls the major sources of drift:

- **Wall-clock relative dates** ("3d ago", "2 mo") — locked via `COCO_SNAPSHOT_NOW` env var, which the workstation's `getRenderNow()` helper honors. Set per-tape so every run renders against the same fixed moment.
- **Idle tip rotation** — off by default in coco; recipes don't enable it.
- **Spinner ticks** — only animate during loading states. Recipes wait for the view to settle before capture.
- **Theme colours** — recipes can lock to a specific preset (`default` / `monochrome` / `catppuccin` / `gruvbox`) via the `theme` field.
- **Terminal palette** — the VHS tape pins the *terminal's* theme to "Catppuccin Mocha" so the xterm.js render is consistent regardless of the upstream VHS default.

## Adding a recipe

Append to `RECIPES` in `bin/screenshot/recipes.ts`:

```ts
{
  name: 'ui-something-new',
  description: 'One-liner that surfaces in --list',
  scenario: 'feature-pr-ready',          // any @gfargo/git-scenarios name, or null
  command: 'ui --view diff',              // what coco command to run
  actions: [                              // optional keystrokes after launch
    { kind: 'sleep', ms: 800 },
    { kind: 'type', text: 'gz' },
  ],
  dimensions: { cols: 140, rows: 40 },   // optional, defaults to 140x40
  theme: 'catppuccin',                   // optional theme lock
  emitGif: false,                        // optional, true emits a .gif too
}
```

Then run `npm run screenshot -- --recipe ui-something-new` to capture. If the rendered image looks wrong, pass `--keep-tape` to inspect the generated tape file under `.screenshots/`.

## Scenarios

The list of named scenarios comes from `@gfargo/git-scenarios`. Run `npm run scenario list` to see them. Common picks for screenshot recipes:

- `feature-pr-ready` — feature branch with 4 commits, clean worktree, ready to PR
- `dirty-many-files` — 12 staged + 6 unstaged + 3 untracked files
- `rich-history-graph` — multi-branch with date-bucket coverage and lane topology
- `mid-bisect`, `mid-merge-conflict`, `mid-rebase-conflict` — in-progress operations
- `stashed-changes` — clean worktree + 3 stashes

## Marketing site (`.www/`)

The `.www/` Next.js site previously used hand-drawn artistic terminal mockups. Replace those with real captures from this pipeline. The PNGs are pixel-accurate, work in light + dark themes (different recipes), and update with the workstation rather than drifting out of sync.

For animated demos (e.g. workflow walk-throughs), set `emitGif: true` on the recipe — VHS produces both the still PNG and a GIF in one pass.

## Visual regression checks (future)

The pipeline output is well-suited to PR-level visual diffs (`pixelmatch` or `odiff`). When the recipe catalog matures, add a `npm run screenshot:check` step that compares current renders against `.screenshots/baseline/`. Run it as a manual-trigger CI job rather than on every push — too slow for the hot path, but invaluable for releases.
