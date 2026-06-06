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
- **`bin/screenshot/terminalThemes.ts`** — resolves the VHS terminal palette for a coco preset (matching background/foreground per theme, ANSI slots derived from coco's own accents). See the "Terminal palette" note under Determinism.
- **`bin/screenshot.ts`** — the driver: spins up the scenario, generates the tape, hands it to `vhs`, captures the PNG, cleans up.

## Determinism

The screenshots have to look identical between runs to be useful. The harness controls the major sources of drift:

- **Wall-clock relative dates** ("3d ago", "2 mo") — locked via `COCO_SNAPSHOT_NOW` env var, which the workstation's `getRenderNow()` helper honors. Set per-tape so every run renders against the same fixed moment.
- **Idle tip rotation** — off by default in coco; recipes don't enable it.
- **Spinner ticks** — only animate during loading states. Recipes wait for the view to settle before capture.
- **Theme colours** — recipes can lock to a specific preset (`default` / `monochrome` / `catppuccin` / `gruvbox` / …) via the `theme` field, or by passing `--theme <preset>` in the command.
- **Terminal palette** — the VHS tape sets the *terminal's* palette to match coco's `--theme`. coco presets only carry foreground accents (no background), so without a matching terminal background every theme would render on the same surface and look near-identical. `terminalThemes.ts` pairs each preset with its canonical background/foreground and derives the ANSI slots from coco's own accent colours, keeping the terminal palette in sync with the app. The `default` and `monochrome` presets keep the named "Catppuccin Mocha" terminal theme.

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

## Authoring motion (GIF) demos

Animated demos are the same recipe shape with `emitGif: true`. They reward a different mindset than stills — a still freezes one moment, a GIF tells a short story — and they have one sharp gotcha (raw file size) that's easy to miss until a 19 MB asset lands in a PR. The conventions and lessons below come from building the demo catalog.

**Conventions**

- **Name them `demo-*`** (motion) vs `ui-*` (stills). The `demo-` prefix is how the catalog, the sync list, and reviewers tell the two apart at a glance.
- **One story per demo.** A demo should make a single point and end. `demo-view-keys` opens the `g?` strip on history, then on branches — the whole story is "the list is per-view." Resist tacking on extra beats; each one costs both attention and bytes.
- **Show contrast, not completeness.** Two views proving a behavior changes beats six views enumerating it. The `?` help overlay, theme pickers, and other full-pane takeovers are tempting but dilute the point (and balloon the file — see below).
- **Register it** in `bin/syncScreenshots.ts` (`SITE_RECIPES` + `FILENAME_MAP`) only if it's used on the marketing site, then `npm run screenshot:sync`.

**Timing**

- GIFs don't need the long PNG settle. Stills use ~3500ms so the single frame is crisp and fully loaded; GIFs record from boot, so a 1200–1500ms lead-in is fine — the early "loading commits" frames read as natural startup, not a bug.
- Budget **read time** after each action: ~2400–2600ms to let a viewer actually read an overlay, ~1200–1300ms for a view switch, ~500–800ms between quick keystrokes. Too fast and the demo is unreadable; too slow and it drags (and grows).
- Chords type as one `type` action (`{ kind: 'type', text: 'g?' }`). The brief chord-pending flash that produces is a feature — it shows the relationship between the keys.
- Don't bake a trailing `q` to quit — the tape builder strips it for GIFs so the recording ends on the last rendered UI frame, not an empty shell prompt.

**Recording the boot-up (`recordFromBoot`)**

By default a GIF hides the *entire* launch and starts recording on the already-painted UI — boot is dead air you don't want. Set `recordFromBoot: true` (GIF-only) to instead capture the workstation *coming to life*: the tape stays hidden just long enough to skip the tsx cold-start, then Shows + starts recording while coco is still painting its loading state, so the recording opens on `⎇ <branch> · loading commits` and fills in on camera. This is the install/get-started story (`demo-boot-workstation`).

The timing is sensitive — see `BOOT_HIDDEN_MS` / `BOOT_VISIBLE_SETTLE_MS` in `tape.ts`. Too short and the recording opens on the raw `tsx …/index.ts` shell line (ugly absolute paths); too long and the data has already loaded (no boot reveal). If a regenerated boot GIF opens on the shell command line, your local tsx cold-start is slower than when it was tuned — nudge `BOOT_HIDDEN_MS` up until frame-0 is coco's loading screen again.

**File size — the one that bites**

VHS writes **full, undeduplicated frames**, so size scales with `duration × framerate × changing-pixel area`. A short demo routinely lands at 10–20 MB raw — far too heavy for a web page. Three levers, in order of impact:

1. **Optimize losslessly (automatic).** The driver runs `gifsicle -O3 --batch` on every emitted GIF as a final step: **lossless** inter-frame transparency optimization (no `--lossy`, no colour quantization), typically a **20–30× reduction with zero pixel changes** (`demo-view-keys`: 15 MB → 0.4 MB). This is in the pipeline — not a manual post-step — so `screenshot:sync` regenerations stay small. `gifsicle` is best-effort: if it isn't on PATH the raw GIF is kept and you'll see an install hint (`brew install gifsicle`). This single step is why recent demos are ~300 KB while older, pre-optimization ones in the asset history are still 18 MB.
2. **Trim the story.** Less duration and fewer full-pane redraws = fewer/cheaper frames *before* optimization even runs. Dropping a full-help-overlay beat from `demo-view-keys` took it 19 MB → 13 MB raw on its own; gifsicle then finished the job.
3. **Shrink dimensions** only as a last resort — it costs legibility and breaks visual consistency with the other demos on the site (keep `150×38` / the `140×40` default unless there's a reason).

Rule of thumb: author for the *story* and timing; let the lossless pass handle the bytes. If a synced GIF is still multi-MB after optimization, the recipe is doing too much — tighten the story rather than reaching for `--lossy`.

## Scenarios

The list of named scenarios comes from `@gfargo/git-scenarios`. Run `npm run scenario list` to see them. Common picks for screenshot recipes:

- `feature-pr-ready` — feature branch with 4 commits, clean worktree, ready to PR
- `dirty-many-files` — 12 staged + 6 unstaged + 3 untracked files
- `rich-history-graph` — multi-branch with date-bucket coverage and lane topology
- `mid-bisect`, `mid-merge-conflict`, `mid-rebase-conflict` — in-progress operations
- `stashed-changes` — clean worktree + 3 stashes
- `_workspace` — special: creates 3 repos in subdirectories for workspace command

## Full recipe catalog

Run `npm run screenshot -- --list` for the live list. Current catalog:

### Workstation views (22 screenshots)
| Recipe | View | Scenario |
|--------|------|----------|
| `ui-history-pr-ready` | History | feature-pr-ready |
| `ui-history-rich-graph` | History (full graph) | rich-history-graph |
| `ui-multi-commit-branch` | History (varied commits) | multi-commit-branch |
| `ui-large-repo` | History (115 commits) | large-repo |
| `ui-bisect-in-progress` | History (mid-bisect) | mid-bisect |
| `ui-detached-head` | History (detached) | detached-head |
| `ui-merge-conflict` | History (merge conflict) | mid-merge-conflict |
| `ui-rebase-conflict` | History (rebase conflict) | mid-rebase-conflict |
| `ui-status-dirty-worktree` | Status | dirty-many-files |
| `ui-diff-feature-branch` | Diff | feature-pr-ready |
| `ui-compose` | Compose | single-staged-file |
| `ui-branches-sync-showcase` | Branches | branch-sync-showcase |
| `ui-tags` | Tags | large-repo |
| `ui-stash-list` | Stash | stashed-changes |
| `ui-worktrees` | Worktrees | multiple-worktrees |
| `ui-conflicts-merge` | Conflicts | mid-merge-conflict |
| `ui-reflog` | Reflog | rich-history-graph |
| `ui-bisect-view` | Bisect | mid-bisect |
| `ui-changelog` | Changelog | feature-pr-ready |
| `ui-submodules-view` | Submodules | submodule-with-history |
| `ui-submodule` | History (with submodule) | submodule-with-history |
| `ui-help-overlay` | Help overlay | feature-pr-ready |

### Interactive overlays (3 screenshots)
| Recipe | What it shows |
|--------|--------------|
| `ui-command-palette` | `:` command palette |
| `ui-search-filter` | `/feat` live filter |
| `ui-inspector-focused` | Tab-focused inspector |
| `ui-which-key` | `g`-chord which-key overlay |
| `ui-view-keys` | `g?` per-view single-key strip (#1137) |

### Workspace (1 screenshot)
| Recipe | What it shows |
|--------|--------------|
| `workspace-multi-repo` | 3 repos in different states |

### Theme variants (one `ui-history-theme-*` screenshot per preset)
Every selectable preset except the bare `default` gets a
`ui-history-theme-<name>` recipe, each captured with its matching terminal
palette (see Determinism → Terminal palette). As of the color-theme release
that's **108 themes** (`monochrome` + 107 color themes) — the full set is
enumerated by `getLogInkThemePresets()`.

This list is **not maintained by hand**: both `recipes.ts` (the recipe
catalog) and `syncScreenshots.ts` (the `.www` sync) derive the theme carousel
from `THEME_PRESET_COLORS` in `src/workstation/chrome/theme.ts`. Add a theme
there — plus a terminal surface in `terminalThemes.ts` — and its recipe,
screenshot, and site image all follow automatically. `monochrome` and
`default` ride the named "Catppuccin Mocha" terminal palette; every other
preset gets a palette derived from its own accents.

### Stdout / utility (8 screenshots)
| Recipe | What it shows |
|--------|--------------|
| `log-stdout-feature` | `coco log` table output |
| `log-stdout-rich-graph` | `coco log --all` graph output |
| `cmd-help` | `coco --help` |
| `cmd-commit-help` | `coco commit --help` |
| `cmd-changelog-help` | `coco changelog --help` |
| `cmd-log-help` | `coco log --help` |
| `cmd-doctor` | `coco doctor` |
| `cmd-init-dry-run` | `coco init --dry-run` |

### GIF demos (animated recordings)
| Recipe | What it shows | Duration |
|--------|--------------|----------|
| `demo-boot-workstation` | Cold boot: `coco ui` comes to life (`⎇ main · loading commits` → rich graph → walk history → open a diff). Install/get-started hero — the only `recordFromBoot` recipe. | ~9s |
| `demo-workstation-tour` | Workspace multi-repo browsing | ~8s |
| `demo-ui-view-switching` | Chord navigation between views | ~8s |
| `demo-hunk-staging` | Stage files from status view | ~7s |
| `demo-help-overlay` | Open/scroll/close help | ~7s |
| `demo-search-filter` | Live filter with `/` | ~5s |
| `demo-workspace-to-ui` | Workspace → repo → ui → quit back | ~12s |
| `demo-commit-flow` | `coco commit --dry-run` | ~5s |
| `demo-changelog` | `coco changelog --branch main` | ~5s |
| `demo-view-keys` | `g?` per-view key strip, list changes per view (#1137) | ~9s |

## Environment variables

The driver loads `.env` from the project root before running VHS. This means you can put API keys there for AI-powered demo GIFs:

```bash
# .env (gitignored)
OPENAI_API_KEY=sk-...
```

The following keys are forwarded into the VHS shell when present:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OLLAMA_HOST`
- `OPENROUTER_API_KEY`
- `COCO_SERVICE_PROVIDER`
- `COCO_SERVICE_MODEL`
- `COCO_SERVICE_BASE_URL`
- `COCO_SERVICE_ENDPOINT`

Keys already in your shell environment take precedence over `.env` values.

## Marketing site (`.www/`)

The `.www/` Next.js site previously used hand-drawn artistic terminal mockups. Replace those with real captures from this pipeline. The PNGs are pixel-accurate, work in light + dark themes (different recipes), and update with the workstation rather than drifting out of sync.

For animated demos (e.g. workflow walk-throughs), set `emitGif: true` on the recipe — VHS produces both the still PNG and a GIF in one pass. The driver then optimizes every GIF losslessly so synced assets stay web-ready (typically 20–30× smaller, zero quality loss); see [Authoring motion (GIF) demos](#authoring-motion-gif-demos) for that and the recipe-design rules that keep demos small and on-point.

### Syncing assets to `.www/`

`bin/syncScreenshots.ts` regenerates the site recipes and copies them into `.www/public/screenshots/` under their site filenames (the `FILENAME_MAP`). Two modes:

```bash
# Full sweep — regenerate and sync every recipe in SITE_RECIPES (~150 captures).
npm run screenshot:sync          # or the explicit alias: npm run screenshot:sync:all

# Subset — regenerate and sync only the named recipes. Much faster after a
# change that only touched a view or two. Leaves the other captures in place
# (no clean of .screenshots/). Unknown names abort with a hint.
npm run screenshot:sync -- ui-stash-list demo-stash-workflow
```

Pass recipe **names** (the `name` field from `recipes.ts`), not site filenames. Only recipes listed in `SITE_RECIPES` can be synced — others live in `.screenshots/` for local use but aren't part of the site. After a subset sync, `cd .www && yarn dev` to preview just the assets you refreshed.

## Visual regression checks (future)

The pipeline output is well-suited to PR-level visual diffs (`pixelmatch` or `odiff`). When the recipe catalog matures, add a `npm run screenshot:check` step that compares current renders against `.screenshots/baseline/`. Run it as a manual-trigger CI job rather than on every push — too slow for the hot path, but invaluable for releases.
