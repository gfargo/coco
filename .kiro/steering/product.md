# Product Overview

`coco` (git-coco) is an AI-powered git assistant that automates tedious git workflows. It generates commit messages, creates changelogs, summarizes code changes, performs code reviews, and ships a full-screen Git workstation TUI.

## Core Commands

- `commit` - Generates commit messages based on staged changes with intelligent commitlint integration; `--split` mode plans multi-commit decompositions of large staged sets
- `amend` - Regenerates the last commit's message from its diff (folding in any staged changes) and rewrites it via `git commit --amend`; supports `-i`, `--dry-run`, `--json`, `-c`, `-a`, `-n`
- `changelog` - Creates changelogs for branches, commit ranges, or since-last-tag windows
- `pr create` - Generates a pull request title and body from the branch diff and opens it via the GitHub CLI (`gh`) on GitHub/GHE or the GitLab CLI (`glab`) on GitLab; supports `-b/--base`, `-d/--draft`, `--title`/`--body`, `-w/--web`, `-i`, `--dry-run`, `--json`
- `recap` - Summarizes changes from working tree or time-based ranges
- `review` - Performs code reviews on working directory changes; `--severity <n>` gates CI (non-zero exit at or above the threshold) and `--staged` scopes to the index
- `log` - Explores commit history with stdout/JSON modes and the interactive `coco log -i` Git TUI
- `ui` - Opens the full-screen Git workstation (16 views, chord-driven navigation, one-keystroke workflows for PR creation, changelog, split, $EDITOR)
- `cache` / `doctor` / `init` - Setup, diagnostics, and cache management; `coco doctor --cost` reports the per-task model routing profile plus aggregated token/latency usage by task, model, and repo, and `coco doctor --clear` wipes the local usage ledger. The ledger is opt-out (default-on for interactive users via `telemetry.usage`, set on first run or in `coco init`); `COCO_USAGE_LOG` overrides the config either way and the data stays entirely local

**Multi-forge (0.70+, Bitbucket 0.73+):** `prs`, `issues`, `pr create`, and the full `coco ui` workstation (PR/issue triage, inspectors, and every per-row mutating action) work across GitHub, GitHub Enterprise, GitLab, and Bitbucket Cloud. coco detects the forge from the remote host (host-agnostic `parseRemoteUrl` + `detectProvider`) and dispatches to the matching CLI/API: `gh` for GitHub/GHE, `glab` (via `glab api`) for GitLab, Node `fetch` for Bitbucket (no CLI binary required). A single provider-keyed forge adapter (`forgeActions.ts`) drives every loader/action, so the workstation picks the forge once from `context.provider`.

All commands inherit global flags: `--repo <dir>` (alias `--cwd`) targets an arbitrary repository without `cd`-ing first, `--json` requests machine-readable output where supported, and `--quiet` (`-q`) suppresses status chrome while leaving results on stdout.

## Key Features

- **Smart Commitlint Integration** - Automatically detects and validates against commitlint rules — extends to split commits too (every group's title respects commitlint + the conventional-commits spec)
- **Multiple AI Providers** - Seven first-class providers behind a provider registry: OpenAI, Anthropic, Ollama, Google Gemini, Mistral, native Azure OpenAI, and AWS Bedrock. Plus OpenAI-compatible endpoints (OpenRouter, custom `baseURL`). API keys resolve from config or environment variables (`OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `MISTRAL_API_KEY`, `AZURE_OPENAI_API_KEY`); Bedrock authenticates through the AWS credential chain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`).
- **Dynamic Model Routing** - Per-task model selection (`summarize` / `commit` / `commitSplit` / `changelog` / `review` / `recap` / `repair` / `largeDiff`) when `service.model: "dynamic"`, across `cost` / `balanced` / `quality` preferences. `coco doctor --cost` shows the resolved routing per task.
- **Flexible Output Modes** - stdout for scripting, interactive for manual review
- **Full Git Workstation TUI** - Ink-based `coco ui` covers history, status, diff, compose, branches, tags, stash, worktrees, pull-request, conflicts, reflog, bisect, and changelog as first-class surfaces. Chord-driven navigation, command palette (`:`), global search (`/`), idle tips, and a live-preview theme picker (`gC`) across 100+ presets.
- **One-keystroke Workflows** - `S` split staged changes / `L` generate a changelog / `C` create a PR seeded from changelog / `E` open the commit draft in `$EDITOR` / `I` AI-draft commit message
- **TUI LLM Streaming + Cancel** - Opt-in (`service.streaming.enabled: true`) live preview pane shows the AI commit draft building up token-by-token; `Esc` cancels the in-flight LLM call cleanly via `AbortController`. PR body draft (`C`) gets a soft-cancel Esc. Existing commits / drafts that the user has typed stage in a `pendingAiDraft` confirmation slot instead of being silently overwritten by the AI result (`R` to replace, `Esc` to keep typing).
- **Conventional Commits** - Built-in support; flows through to split commits
- **Branch Context** - Branch names and ticket IDs included in commit prompts when available
- **Resilient Config Loading** - Schema validation failures warn instead of crash; the loader merges incremental overrides rather than replacing wholesale, so `[coco]` git config sections don't wipe defaults
- **Scenario Testing Library** - `npm run scenario create <name>` spins up deterministic temp git repos for hand-testing the workstation against known states (PR-ready branch, dirty worktree, mid-bisect, merge conflict, stashes, etc.). The library was extracted to a standalone npm package — `@gfargo/git-scenarios`.
- **Screenshot & GIF Pipeline** - `npm run screenshot:sync` regenerates all marketing-site assets (150+ recipes: view screenshots, a theme-variant carousel auto-derived from the theme catalog, animated GIF demos) via VHS and copies them to `.www/public/screenshots/`. One command keeps the live site in sync with the codebase after any visual change. See `bin/screenshot/README.md`.
- **128 Theme Presets** (126 color themes + `default` + `monochrome`, 31 light) - `coco ui --theme <name>` / `coco workstation --theme <name>` / the in-app picker (`gC`). Covers the popular families end to end — Catppuccin (4 flavors), Rosé Pine (3), Kanagawa, the Nightfox siblings, Tokyo Night variants, Gruvbox + Gruvbox Material, Ayu, Material, all four Monokai Pro filters, the Selenized family — plus standalones like Dracula, Nord, Zenburn, Oxocarbon, Darcula, Eldritch, Bamboo, and City Lights. **Source of truth is `THEME_PRESET_COLORS` in `src/workstation/chrome/theme.ts`** — the CLI `--theme` choices, truecolor-vs-ANSI classification, screenshot carousel, and `.www` sync are all *derived* from it, so adding a theme is one entry there (12 hex tokens) plus a synced screenshot. Light and dark variants render correctly on both truecolor and downgraded terminals, and the selected row stays readable on every theme via auto-derived contrast foreground.

The tool is designed for zero-effort git commits while maintaining code quality and consistency. The workstation is the terminal-native Git client surface: deterministic core Git workflows first, with AI assistance as explicit opt-in actions.
