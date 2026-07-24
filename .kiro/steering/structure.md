# Project Structure

How the `coco` source tree is organized, the layering between its parts, and the
conventions every command and surface follows. Read this before adding a feature
so new code lands in the right layer and follows the established shape.

## Top-level layout

```
src/
  commands/      CLI command implementations (the user-facing verbs and agent transport)
  operations/    Transport-neutral typed operations (currently agent generation)
  mcp/           Local stdio MCP server and tool registration
  git/           Git + forge operations: read actions, write actions, provider adapters
  workstation/   The Ink/React TUI: chrome, runtime, and per-view surfaces
  lib/           Shared foundations: config, LLM/langchain, parsers, simple-git wrappers, UI helpers
  index.ts       CLI entrypoint — yargs wiring that mounts every command
  test/          Shared test mocks (e.g. langchain provider stubs)
bin/             Build/dev tooling: schema gen, screenshot pipeline, scenario runner, release helpers
.kiro/           Steering files and specs (this directory)
.www/            Marketing site — SEPARATE git repo (gfargo/git-co.co), gitignored here
.wiki/           GitHub wiki — SEPARATE checkout, gitignored here
schema.json      Generated config JSON Schema (committed; CI fails on drift)
```

The core concerns under `src/` are the spine of the codebase:

- **`src/commands/`** — one directory per CLI verb (`commit`, `amend`, `changelog`,
  `pr create`, `recap`, `review`, `agent`, `mcp`, `log`, `ui`/`workstation`, `prs`, `issues`,
  `cache`, `doctor`, `init`). Each command parses flags, loads config, calls into
  the appropriate operation/`git`/`lib` layer, and renders output. Commands are the
  only layer that yargs knows about.
- **`src/operations/`** — typed application operations shared by multiple transports.
  `operations/agent/` owns protocol versioning, strict Zod schemas, success/failure
  envelopes, repository/source resolution, provenance, and dispatch for commit-draft,
  review, changelog, and recap. Keep transport-specific stdin/MCP behavior out of it.
- **`src/mcp/`** — the local stdio MCP adapter. It registers four generation tools,
  enforces client roots and one-repository binding, maps cancellation, and returns the
  same structured envelopes as `coco agent`. It must not grow generic shell or mutation
  tools; the canonical contract is documented in the wiki's Agent CLI and MCP page.
- **`src/git/`** — everything that talks to git or a forge. Read paths (history,
  status, diff, blame, bisect, reflog, branches, tags, stash, worktrees) and write
  paths (commit, the forge actions for PRs/MRs and issues). The multi-forge adapter
  lives here.
- **`src/workstation/`** — the `coco ui` terminal workstation, built on Ink + React
  19. Split into `chrome/` (pure rendering + theme), `runtime/` (the live Ink app,
  input/keymap, view models), and `surfaces/` (one folder per view).
- **`src/lib/`** — the shared foundation: config loading/validation, the langchain
  provider registry, diff/syntax parsers, `simple-git` wrappers, and reusable
  prompt/UI helpers.

## Layering and dependency direction

The intended dependency direction is one-way, lowest to highest:

```
lib/  ←  git/  ←  workstation/  ←  commands/
```

- `lib/` is the foundation. It should depend only on third-party packages and other
  `lib/` modules — never on `git/`, `workstation/`, or `commands/`.
- `git/` builds on `lib/`.
- `workstation/` builds on `git/` and `lib/`, and may pull data helpers from
  `commands/log/` (the history/data layer the workstation renders).
- `commands/` sits on top and wires everything into yargs.

**When adding code, respect this direction.** A new import from `lib/` up into
`commands/` or `workstation/` is a smell — it usually means a type or helper is
living in the wrong layer and should move down into `lib/`.

**Known exceptions (technical debt, not the target):** a handful of `lib/` modules
currently reach upward — e.g. `lib/ui/editPrompt.ts` and `lib/autofix/buildPrompt.ts`
import `ReviewFeedbackItem`/`COMMIT_PROMPT` from `commands/`, and
`lib/config/types.ts` imports `LogInkThemeConfig` from `workstation/chrome/theme`.
These are paydown targets (the shared types should sink into `lib/`), not patterns to
copy. Don't add new upward imports; prefer moving the shared symbol down.

## Anatomy of a command

Every command under `src/commands/<name>/` follows the same core shape:

- **`config.ts`** — the yargs command definition: `command`, `describe`, `builder`
  (flags), and the argv type. Pure declaration, no side effects.
- **`handler.ts`** — the entrypoint yargs calls. Loads config, resolves the repo,
  orchestrates `git/` + `lib/` calls, renders output. This is where the work happens.
- **`prompt.ts`** *(optional)* — the LLM prompt template, present only for commands
  that call a model (`commit`, `review`, …). Commands with no AI step omit it.
- **`index.ts`** — a thin re-export so `src/index.ts` can mount the command.
- **`*.test.ts`** — co-located unit tests (see Testing).

Thin commands (`amend`, `review`) are exactly this. Larger commands add focused
auxiliary modules beside the core trio rather than bloating `handler.ts`:

- `commit/` adds `generateCommitDraft.ts`, `split.ts`, `splitPlanGenerator.ts`,
  `splitPlanValidation.ts` (the `--split` decomposition engine).
- `log/` adds `data.ts` (the row model the workstation also consumes), `interactive.ts`,
  `commitCompose.ts`, `render.ts`.

Pattern: keep `config.ts`/`handler.ts` as the stable skeleton; factor real logic into
named siblings with their own tests.

## Agent operations and MCP

The agent integration is deliberately split into a domain contract and thin transports:

```
JSON/stdin (`commands/agent`) ─┐
                               ├─→ operations/agent ─→ existing LLM generators
stdio MCP (`mcp/server`) ──────┘
```

- `operations/agent/schemas.ts` is the protocol-v1 source of truth: operation names,
  strict requests, change-source variants, options, result data, and discriminated
  envelopes. MCP publishes top-level object schemas with explicit success/failure
  `oneOf` metadata because the SDK requires object outputs.
- `operations/agent/context.ts` owns root normalization, safe Git execution, revision
  verification, the 2 MiB context cap, SHA-256 digests, provenance, and worktree trust.
- `operations/agent/generate.ts` dispatches the four operations and frames supplied or
  repository-derived content as untrusted model data. It intentionally reuses the
  existing command generators/prompts so interactive and agent behavior do not drift;
  shared prompt/result types should eventually sink toward `lib/` rather than adding
  more upward dependencies.
- `commands/agent/handler.ts` handles JSON files/stdin, schema publication, protocol-only
  stdout, SIGINT cancellation, and noninteractive telemetry setup.
- `mcp/server.ts` owns tool registration, client-root checks, repository binding, MCP
  cancellation, annotations, and structured error mapping. `commands/mcp/handler.ts`
  only resolves/binds the repository and starts the server.

Safety invariants are part of the public contract: MCP tools generate only; one process
binds one real Git root; external diff/textconv and optional-lock side effects are
disabled; refs reject option prefixes; untrusted worktrees and repository-defined
prompts/commitlint are rejected; supplied content carries digest/provenance metadata.
Local analytics may write only gated metadata to the user cache, never prompts, diffs,
code, filenames, generated output, credentials, repository files, or forge state.

Changes to this surface require co-located schema/context/generation/handler/server tests
and should keep the agent CLI and MCP envelopes behaviorally identical. See
[Agent CLI and MCP](https://github.com/gfargo/coco/wiki/Agent-CLI-and-MCP) for the canonical
user-facing contract.

## The workstation (`src/workstation/`)

Three sub-layers:

- **`chrome/`** — pure, mostly side-effect-free rendering and presentation. The theme
  system lives here: **`THEME_PRESET_COLORS` in `src/workstation/chrome/theme.ts` is
  the single source of truth for all 128 theme presets** (12 hex/ANSI tokens each).
  The CLI `--theme` choices, truecolor-vs-ANSI classification, the screenshot theme
  carousel, and the `.www` sync are all *derived* from it — adding a theme is one
  entry here plus a synced screenshot. Also in `chrome/`: text/width measurement,
  layout/density, the commit-graph renderer (`graphLanes`/`graphLayout`/`graphOrtho`),
  date bucketing, iconography, hyperlinks, and `forgeNouns.ts` (maps the active forge
  to display nouns — GitHub/Bitbucket "PR", GitLab "MR").
- **`runtime/`** — the live Ink app. `app.ts` wires the React tree; `inkViewModel.ts`
  holds view state and transitions; `inkInput.ts` + `inkKeymap.ts` implement
  chord-driven navigation, the command palette (`:`), and global search (`/`);
  `overlays.ts` renders modals. Custom hooks live in `runtime/hooks/`.
- **`surfaces/`** — one directory per view (history, status, diff, blame, branches,
  tags, stash, worktrees, remotes, submodules, reflog, conflicts, changelog, compose,
  detail, pullRequest, pullRequestTriage, issuesTriage, fileHistory, workspace). Each
  surface is largely a single `index.ts` with co-located tests.

## The multi-forge adapter (`src/git/`)

coco targets GitHub, GitHub Enterprise, GitLab, and Bitbucket Cloud through one
abstraction so the workstation never branches on provider at the call site:

- **`parseRemoteUrl(url)`** (in `git/githubCli.ts`) is a host-agnostic remote parser:
  scp-style ssh, ssh/git URLs, and https — for any host — returning `{ host, owner,
  name }` and preserving multi-segment owners (GitLab subgroups).
- **`detectProvider(host)`** (in `git/providerData.ts`) maps a host to
  `'github' | 'gitlab' | 'bitbucket' | 'unsupported'`, honoring config host overrides
  for self-hosted/GHE/vanity domains.
- **`ForgeActions`** (in `git/forgeActions.ts`) is the provider-keyed adapter: a single
  interface covering PR/MR list + detail, every PR/MR mutation (comment, label,
  assign, merge, close, approve, request-changes, create, open — by-number and
  current-branch), and issue list/detail/mutations. `getForgeActions(provider, opts)`
  returns the right implementation **once**; loaders and per-row actions then call
  `forge.method(...)` with no further provider branching.
- Dispatch per provider: `gh` for GitHub/GHE, `glab api` for GitLab, and **raw Node
  `fetch`** for Bitbucket (no CLI binary; auth via `BITBUCKET_ACCESS_TOKEN` or
  `BITBUCKET_USERNAME`+`BITBUCKET_APP_PASSWORD`). Bitbucket-specific code is split
  across `bitbucketCli.ts` (REST runner), `bitbucketListData.ts`, `bitbucketDetailData.ts`,
  `bitbucketPullRequestActions.ts`, and `bitbucketIssueActions.ts`.

When adding a forge capability, add the method to the `ForgeActions` type first, then
implement it for all providers (or return an explicit "unsupported on <forge>" result),
then wire the single call site. Never special-case a provider inside a surface.

## Testing

- **Co-located.** Tests sit next to the code they cover (`foo.ts` → `foo.test.ts`).
  There is no `__tests__/` convention. ~300 `.test.ts` files across `src/`.
- **Naming.** `*.test.ts` for unit tests; `*.integration.test.ts` for integration
  tests (which self-skip when their gating secrets/binaries are absent).
- **Mocking.** Unit tests mock collaborators with `jest.mock()`; langchain providers
  are stubbed via `moduleNameMapper` (see `src/test/mocks/`).
- **Property-based tests.** The marketing site (`.www`) uses `fast-check` for the
  correctness properties defined in the `www-site-redesign` spec (slug derivation,
  manifest merge, changelog version round-trip). See `.kiro/specs/www-site-redesign/`.
- **Scenario library.** `npm run scenario create <name>` (wrapping the standalone
  `@gfargo/git-scenarios` package via `bin/scenarioRunner.ts`) materializes
  deterministic temp git repos in known states — PR-ready branch, dirty worktree,
  mid-bisect, merge conflict, stashes — for hand-testing the workstation. The same
  scenarios drive the screenshot pipeline.

## Where things live (quick map)

| Need to touch…                       | Go to…                                            |
|--------------------------------------|---------------------------------------------------|
| A CLI flag or new command            | `src/commands/<name>/config.ts` + `handler.ts`    |
| Agent protocol/schema/source behavior | `src/operations/agent/`                           |
| Agent JSON/stdin transport            | `src/commands/agent/`                             |
| MCP tool registration/root policy     | `src/mcp/server.ts` + `src/commands/mcp/`         |
| An LLM prompt                        | `src/commands/<name>/prompt.ts`                   |
| Git read/write logic                 | `src/git/`                                         |
| A forge (PR/issue) capability        | `src/git/forgeActions.ts` + provider files        |
| A TUI view                           | `src/workstation/surfaces/<view>/`                |
| Theme colors / a new theme           | `THEME_PRESET_COLORS` in `workstation/chrome/theme.ts` |
| Keybindings / navigation             | `src/workstation/runtime/inkInput.ts` / `inkKeymap.ts` |
| Config schema / validation           | `src/lib/config/` (regenerate `schema.json`)      |
| Provider registry / model routing    | `src/lib/langchain/`                              |
