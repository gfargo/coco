# Technology & Operations

The practical layer: stack, build, test, CI, the screenshot pipeline, and how
releases are cut. With this loaded, operational requests ("run the tests", "build
it", "regenerate the screenshots") don't need follow-up questions.

## Stack

- **Language:** TypeScript, ESM-first, bundled to ESM + CJS.
- **Runtime:** Node. `.nvmrc` pins `22.22.2`; `engines` allows
  `^22.22.2 || ^24.15.0 || >=26.0.0`. Node 22 is the floor — older Node (e.g. 16)
  fails the test toolchain.
- **Package manager:** **Yarn (v1)**, despite npm-style script names. `yarn.lock` is
  the lockfile; CI rejects a committed `package-lock.json`. Dependency pins go in
  `resolutions`.
- **TUI:** Ink 7 + React 19 (`coco ui`).
- **LLM:** LangChain provider packages — `@langchain/openai`, `@langchain/anthropic`,
  `@langchain/google-genai`, `@langchain/mistralai`, `@langchain/ollama`,
  `@langchain/aws` (Bedrock), `@langchain/community`. Token accounting via `tiktoken`.
- **Agent protocols:** Zod 4 strict schemas, a protocol-v1 JSON/stdin CLI, and
  `@modelcontextprotocol/sdk` 1.x for the local stdio MCP server. Both transports call
  `src/operations/agent/`; MCP is bound to one repository and exposes generation-only tools.
- **Git/diff:** `simple-git`, `diff`, `web-tree-sitter` (+ TS/TSX grammars) for syntax.
- **CLI/prompts:** `yargs`, `@inquirer/prompts`, `chalk`, `ora`.
- **Bundler:** Rollup 4. **Tests:** Jest 30 + ts-jest. **Lint:** ESLint. **Format:** Prettier.

## Everyday commands

```bash
npm run dev            # tsx watch src/index.ts (live reload)
npm run coco -- <args> # run the CLI from source (tsx src/index.ts)
npm run coco -- agent schema --task review  # print protocol-v1 schemas
npm run coco -- mcp --repo <dir>            # start local stdio MCP
npm run build          # rollup -c → dist/ (ESM + CJS + d.ts)
npm run lint           # eslint src bin
npm run lint:fix       # eslint --fix src
npm test               # full gate: test:jest && test:publish
npm run test:jest      # jest only (NODE_OPTIONS=--experimental-vm-modules)
npm run test:coverage  # jest with coverage thresholds enforced
npm run test:unit      # unit tests only
npm run test:integration  # integration tests (self-skip without secrets)
npm run scenario create <name>   # materialize a temp git scenario for hand-testing
npm run screenshot:sync          # regenerate all marketing assets → .www
```

> In a worktree, `npm run build`'s `postbuild` step (`copyTreeSitterWasm.mjs`) can
> exit non-zero because the WASM lives in the root `node_modules` — the rollup build
> itself is fine. Run binaries from the worktree cwd against the root `node_modules`.

## Build pipeline

`npm run build` runs `prebuild` → `rollup -c` → `postbuild`:

- **`prebuild`** = `build:schema` (`bin/generateSchema.ts` → `schema.json` from the
  config types) + `build:info` (`bin/generateBuildInfo.ts` → version/commit/timestamp).
- **`rollup -c`** (`rollup.config.mjs`): bundles `src/index.ts` to `dist/index.esm.mjs`
  (ESM, with an `import.meta.url` → `__dirname` shim) and `dist/index.js` (CJS).
  Tree-shaken, `inlineDynamicImports`, shebang preserved, output marked executable.
  A second pass merges declarations to `dist/index.d.ts` (`rollup-plugin-dts`).
- **`postbuild`** = `bin/copyTreeSitterWasm.mjs` copies the 3 tree-sitter WASM files
  into `dist/tree-sitter/`.

`schema.json` is committed and CI fails on drift — after changing config types, run
`npm run build` and commit the regenerated schema.

## CI (`.github/workflows/ci.yml`)

Four core jobs run in parallel (the workstation lints/tests/builds/smoke-tests on
every PR), plus an optional integration job. Concurrency cancels stale runs per ref.

- **`lint`** — `eslint src bin`; also asserts `yarn.lock` exists and
  `package-lock.json` does not (yarn-only guard).
- **`test`** — matrix: Ubuntu Node 22.22.2 + 24.15.0 (required), macOS Node 22.22.2
  (required), Windows Node 22.22.2 (experimental, `continue-on-error`). Runs
  `npm run test:coverage`; uploads coverage to Codecov once (Ubuntu/22).
- **`build`** — `npm run build`, asserts no `schema.json` drift, runs
  `release:dry-run`, and uploads `dist/` as an artifact the smoke job reuses.
- **`smoke`** (needs `build`) — downloads `dist/`, sets a git identity, runs
  `npm run test:cli` (`bin/smokeCli.ts`) against the real bundled output to catch
  packaging/export regressions tsc can't see.
- **`integration`** (non-blocking) — `npm run test:integration`; gated on
  `COCO_GITLAB_IT` / `COCO_GITLAB_TEST_PROJECT` secrets (self-skips without them).

Other workflows:

- **`devskim.yml`** — Microsoft DevSkim security scan (push/PR to main + weekly),
  SARIF → GitHub Security tab, with test/fixture/generated paths excluded.
- **`ai-review.yml`** — `anthropics/claude-code-action` review, gated on the
  `claude review` label; focuses on correctness, CLI-injection/secret-exposure
  security, and forge-abstraction parity. Needs `ANTHROPIC_API_KEY`.
- **`publish-release.yml`** — verify (`npm test` + dry-run) then `npm publish`,
  triggered manually with a `publish` input.
- **`update-homebrew-tap.yml`** — on release, polls npm for the new version,
  regenerates the formula (`bin/genHomebrewFormula.mjs`), and pushes to
  `gfargo/homebrew-tap` (`brew install gfargo/tap/coco`).

## Coverage (`jest.config.ts`)

- `preset: ts-jest`, `testEnvironment: node`, roots constrained to `src` + `bin`.
- Coverage excludes type-only modules, barrel `index.ts`, and generated files
  (`buildInfo.ts`, `schema.ts`).
- **Thresholds (CI-enforced):** statements 60%, branches 55%, functions 60%, lines 60%.

## Agent/MCP validation and local analytics

Agent integration tests are co-located with the contract and transports:

- `operations/agent/schemas.test.ts` — defaults, strictness, size limits, envelope and
  published MCP schema alternatives.
- `operations/agent/context.test.ts` — real temporary Git repositories, realpath/root
  boundaries, symlink escapes, revision safety, worktree trust, provenance, digest,
  limits, and cancellation.
- `commands/agent/handler.test.ts`, `commands/mcp/handler.test.ts`, and
  `mcp/server.test.ts` — protocol-safe output, telemetry arming, tool registration,
  annotations, repository binding, cancellation signals, and structured failures.
- `commands/utils/usageTelemetry.test.ts` and `lib/langchain/utils/usageLedger.test.ts`
  — config/env gating, invocation surfaces, aggregation, and the guarantee that
  prompts/diffs/code cannot be serialized.

For release validation, run those targeted suites first, then the normal full gate,
`npm run build`, `npm run test:cli`, and `npm pack --dry-run`. Smoke the bundled CLI's
schema output and MCP tool discovery because source-level tests do not catch packaging
or stdio regressions.

Machine transports never perform first-run consent or write config. They honor an
existing `telemetry.usage` preference or `COCO_USAGE_LOG`; enabled records are bounded
local JSONL metadata tagged `cli`, `agent-cli`, or `mcp`. They live in the user cache
(or the explicit env path), never the repository, and never contain prompts, diffs,
source code, filenames, generated content, or credentials. `coco doctor --cost` reports
usage by task/model/surface/repo and `coco doctor --clear` deletes it.

## Screenshot & GIF pipeline (`bin/screenshot/`)

VHS-driven, deterministic capture of every view, a theme carousel, and animated GIF
demos — one command keeps the marketing site in sync after any visual change. See
`bin/screenshot/README.md`.

- **Recipes** (`recipes.ts`): each recipe names a scenario (a `@gfargo/git-scenarios`
  state, or `null` for `--help`), a `command`, optional keystroke `actions`,
  `dimensions`, a `theme` lock, and flags — `emitGif`, `recordFromBoot`,
  `visibleCommand` (the pretty command shown to viewers), `env` (per-recipe overrides,
  e.g. model pinning), and forge mocks (`ghMock`/`glabMock` with mock `gh`/`glab`).
- **Driver/tape** (`screenshot.ts`, `tape.ts`): `COCO_CLI` points at the **built
  `dist/index.js`** (not `tsx`) so VHS shells start in ~200ms instead of a 2–3s
  cold-start. Timing constants: `POST_LAUNCH_SETTLE_MS` (PNG settle),
  `BOOT_HIDDEN_MS`, `BOOT_VISIBLE_SETTLE_MS` (boot-recorded GIFs).
- **Optimization** (best-effort; skip with a hint if the tool is missing): `pngquant`
  (visually lossless PNG, ~50–70% smaller) → `cwebp` (WebP variants) for stills;
  `gifsicle -O3 --lossy` for GIFs. The theme carousel is derived from
  `THEME_PRESET_COLORS`, so the catalog and screenshots stay in lockstep.
- **Sync** (`syncScreenshots.ts`): `npm run screenshot:sync` regenerates the curated
  site recipe set and copies outputs (with WebP variants) into
  `.www/public/screenshots/`. Pass recipe names to sync a subset.

## Releases (`.release-it.json`)

- `npm run release` runs `release-it` — releases only from `main`.
- `before:init`: `git pull --ff-only` → `npm run lint` → `npm test` (full gate).
- Bumps version, commits `chore: release v${version}`, tags, pushes, creates the
  GitHub release, and publishes to npm.
- `after:bump`: `bin/verifyRelease.mjs` + `auto-changelog`.
- The Homebrew tap and (manual) publish workflows pick up from the GitHub release.
- Local planning docs (`specs/ROADMAP.md`, `RELEASE_NOTES`) are gitignored — edit in
  place; they are not committed.
