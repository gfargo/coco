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

## Common commands

```bash
npm run coco -- <args>   # run the CLI from source
npm run lint             # eslint src bin
npm run test:jest        # jest
npm run build            # rollup → dist/ (regenerates schema.json)
npm run scenario create <name>   # temp git scenario for hand-testing the TUI
npm run screenshot:sync          # regenerate marketing assets → .www
```

## House style

- Match the surrounding code's idiom, naming, and comment density.
- Commit messages follow Conventional Commits + commitlint.
- Release notes follow `.kiro/steering/release-notes-style.md` (no em-dashes, no
  marketing language, verb-led bullets grouped by theme).
