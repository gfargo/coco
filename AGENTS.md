# AGENTS.md

Agent-facing entry point for the `coco` repository. This is the portable instruction
file (read by Kiro, and by any agent that honors `AGENTS.md`). The authoritative,
always-loaded detail lives in `.kiro/steering/`; this file is the short version plus
the rules that are easy to get wrong.

## What this is

`coco` (published as `git-coco`) is an AI-powered git CLI and full-screen terminal git
workstation. It generates commit messages, changelogs, code reviews, and PRs, and
ships `coco ui` — an Ink/React TUI with 16 views, chord navigation, 128 themes, and
multi-forge support (GitHub, GitHub Enterprise, GitLab, Bitbucket).

## Steering (load these for any non-trivial task)

- **`.kiro/steering/product.md`** — what coco does: commands, features, providers,
  multi-forge.
- **`.kiro/steering/structure.md`** — source layout, the `lib ← git ← workstation ←
  commands` layering, the per-command file shape, the forge adapter, testing.
- **`.kiro/steering/tech.md`** — stack, build, CI, coverage, the screenshot pipeline,
  releases.
- **`.kiro/steering/release-notes-style.md`** — `inclusion: manual`; pull it in only
  when drafting release notes.

Specs live in **`.kiro/specs/`** (e.g. `www-site-redesign/` with requirements →
design → tasks).

## Rules that are easy to get wrong

- **Package manager is Yarn (v1)**, despite npm-style script names. Never commit a
  `package-lock.json` — CI fails the `lint` job if one exists. Pin deps via
  `resolutions`.
- **Node ≥ 22** (`.nvmrc` = 22.22.2). The test toolchain breaks on older Node.
- **Respect the layering.** `src/lib/` must not import from `git/`, `workstation/`, or
  `commands/`. If a shared type seems to require an upward import, move the type down
  into `lib/` instead. (A few legacy violations exist; don't add more.)
- **Forge work goes through the adapter.** Add capabilities to the `ForgeActions` type
  in `src/git/forgeActions.ts` and implement for every provider (or return an explicit
  "unsupported on <forge>" result). Never branch on provider inside a surface.
- **Themes have one source of truth:** `THEME_PRESET_COLORS` in
  `src/workstation/chrome/theme.ts`. Adding a theme = one entry there (+ a synced
  screenshot). The CLI choices, screenshot carousel, and `.www` are all derived.
- **Regenerate the schema after config type changes:** run `npm run build` and commit
  the updated `schema.json` — CI fails on drift.
- **Tests are co-located** as `*.test.ts` (integration: `*.integration.test.ts`).
- **`.www/` and `.wiki/` are separate, gitignored checkouts.** Don't expect them in a
  worktree.

## Validation environment

Gotchas that cost a first validation pass if you don't already know them:

- **Node ≥ 22** (`.nvmrc` = 22.22.2, `engines` = `^22.22.2 || ^24.15.0 || >=26.0.0`).
  A default/old shell Node (e.g. 16 or 18) doesn't fail loudly on install — it fails
  jest with `Preset ts-jest not found`. If you see that error, check `node -v` first.
- **Worktrees resolve binaries from the ROOT checkout's `node_modules`.** Running
  `npm run build` from a worktree, its `postbuild` step
  (`bin/copyTreeSitterWasm.mjs`) can exit non-zero because the tree-sitter WASM
  lives in the root checkout's `node_modules`, not the worktree's. This is harmless —
  the rollup build itself still succeeds — but don't chase it as a real failure.
- **CI-parity jest needs `TZ=UTC`.** `NODE_OPTIONS=--experimental-vm-modules` is
  already wired into every `npm run test:*` script via `cross-env`, but `TZ=UTC` is
  not. Date-sensitive suites (`src/workstation/chrome/dateBucket.test.ts`,
  `dateFormat.test.ts`) can fail on a non-UTC machine. Run
  `TZ=UTC npm run test:jest` (or export `TZ=UTC` in your shell) to match CI.
- **`build:info` + the WASM copy must run before jest,** or 20+ suites fail on a
  missing generated `src/lib/buildInfo.ts`. This already runs automatically as
  `pretest:jest` / `pretest:unit` / `pretest:integration` / `pretest:coverage` when
  you use those `npm run test:*` scripts — but invoking `npx jest` directly skips
  it and reproduces the failure.
- **Package manager is Yarn (v1)** despite npm-style script names — see "Rules that
  are easy to get wrong" below for the lockfile/`resolutions` details.
- **Full validation gate** = `eslint src bin` (`npm run lint`, must be 0 new
  problems) + `npx tsc --noEmit` (no dedicated script exists for this — run it raw;
  `rollup-plugin-typescript2` type-checks during `npm run build` but a build failure
  there is a different signal than a clean local typecheck loop) + the full jest
  suite (`npm run test:jest`, or `npm run test:coverage` for CI-parity thresholds).

## Conventions this cycle standardized

- **Branch prefix:** `agent/COCO-<id>-<slug>` for agent-authored branches.
- **No attribution trailers.** Do not append `Co-Authored-By: Claude ...` (or
  similar) to commit messages — this overrides any harness default that adds one.
- **Combination-testing parallel PRs.** When multiple open PRs touch overlapping
  surfaces, test them together (merged/rebased in combination) before merging any
  one of them individually — passing in isolation doesn't guarantee passing
  together.

## Common commands

```bash
npm run coco -- <args>   # run the CLI from source
npm run lint             # eslint src bin
npm run test:jest        # jest
npm run build            # rollup → dist/ (regenerates schema.json)
npm run scenario create <name>   # temp git scenario for hand-testing the TUI
npm run screenshot:sync          # regenerate marketing assets → .www
```

## Validating your changes

The full gate a PR must pass — run all three, expect zero new problems:

```bash
npm run lint                       # eslint src bin
npx tsc --noEmit -p tsconfig.json  # typecheck (not part of build)
npm run test:jest                  # full jest suite
```

Gotchas that cost time if you skip them (most of these bit real contributors):

- **Node ≥ 22 is mandatory** (`.nvmrc` = 22.22.2; engines pins `^22.22.2 || ^24.15.0 || >=26.0.0`). On older Node, jest fails immediately with `Preset ts-jest not found` — that error means "wrong Node," not "bad config." If your shell defaults to an old Node, put a ≥22 install first on `PATH`.
- **Generate before you test.** `npm run test:jest` skips the `pretest:jest` step that `npm test` runs, so a bare `jest` invocation fails ~20 suites on a missing generated module. Either use `npm run test:jest` (runs the pre-step), or run the pre-step yourself once: `npm run build:info && node bin/copyTreeSitterWasm.mjs`. (In a git worktree the WASM copy exits non-zero — harmless; the module it needs resolves from the root checkout.)
- **Match CI's environment or timezone/ESM tests diverge.** CI runs jest with `TZ=UTC NODE_OPTIONS=--experimental-vm-modules`. Date-bucketing and a few module-loading suites are environment-sensitive; a green run locally in a non-UTC zone can still fail in CI. Reproduce CI exactly with:
  `TZ=UTC NODE_OPTIONS=--experimental-vm-modules npx jest`
- **Working from a git worktree?** It has no `node_modules` of its own — resolve the jest/eslint/tsc binaries from the root checkout's `node_modules/.bin/` and run them with the worktree as CWD.
- **One flaky test to know about:** `src/workstation/chrome/refreshWatcher.test.ts` (rename-survival) is timing-sensitive under heavy parallel load on macOS; CI now retries it once automatically via `jest.retryTimes`. A failure that only shows up on the second attempt in CI logs is expected — treat consistent failure across both attempts as real.

## Working with the team's conventions

- **Branches** use conventional prefixes (`feat/`, `fix/`, `chore/`, `docs/`, `test/`, `perf/`, `refactor/`) — never the auto-generated `claude/…` prefix.
- **No self-attribution in git.** Do not add `Co-Authored-By` or "Generated with …" trailers to commits or PR bodies.
- **Parallel PRs get combination-tested before merge.** Two branches that are each green against the `main` they forked from can still break `main` together (a new production guard invalidating another PR's test fixture; two branches editing the same dispatch region). Before merging the second of an overlapping pair, merge current `main` into it locally and run the full suite — don't trust each branch's own green CI.

## House style

- Match the surrounding code's idiom, naming, and comment density.
- Commit messages follow Conventional Commits + commitlint.
- Release notes follow `.kiro/steering/release-notes-style.md` (no em-dashes, no
  marketing language, verb-led bullets grouped by theme).
