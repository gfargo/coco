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

## VHS shell environment (critical gotchas)

VHS spawns a fresh `bash` shell that does NOT inherit the parent process's environment. This caused several hard-to-debug issues during development:

1. **PATH must use unquoted `$PATH`** — VHS's `Type "..."` command types literal characters. If you single-quote the PATH export (`'...:$PATH'`), bash treats `$PATH` as a literal string and the shell loses access to `git`, `sleep`, and all system binaries. The tape uses `export PATH=.../node_modules/.bin:.../node/bin:$PATH` (no quotes around the value) so `$PATH` expands correctly.

2. **Settle time must account for tsx cold-start** — Inside VHS, tsx takes 2-3 seconds to cold-start (vs ~500ms in a warm terminal). The `POST_LAUNCH_SETTLE_MS` constant (currently 5000ms) gives enough time for tsx boot + the workstation's async git data load. If screenshots show "loading commits" or empty state, increase this value.

3. **macOS `/var` → `/private/var` symlink** — Temp dirs created by Node live at `/var/folders/...` but the real path is `/private/var/folders/...`. Git's `safe.directory` checks can fail on the symlinked path. The driver resolves symlinks via `realpathSync()` and the tape runs `git config --global --add safe.directory '*'` in the hidden setup.

4. **`--repo` flag is required** — VHS's `cd` command changes the shell's cwd, but coco's `process.chdir()` in the `--repo` handler is what actually binds the git instance. Always pass `--repo <path>` explicitly rather than relying on cwd.

5. **`Screenshot` vs `Output`** — VHS's `Output "foo.png"` records the entire session as a frame-sequence directory. Use `Screenshot filename.png` (bare filename, no path) to capture a single frame. The driver runs VHS with `cwd` set to the scenario dir so the screenshot lands there, then moves it to the final output path.

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
