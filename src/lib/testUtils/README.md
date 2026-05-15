# `testUtils/` — temp git repos + named scenarios

The test-infrastructure layer for spinning up git repositories in
known states. Two audiences:

1. **You're writing an integration test.** Use `spinUpScenario()` to
   start from a deterministic baseline instead of hand-building the
   same `tempGitRepo + writeFile + commitAll` setup every time.
2. **You're hand-testing the workstation (or anything else).** Use
   `npm run scenario create <name>` to materialize a scenario on disk
   and (optionally) launch `coco ui` against it in one command.

Both paths share the same nine scenarios.

## Quick start

### Manual testing — drive `coco ui` against a known state

```bash
# Spin up a feature branch ready to PR, launch coco ui against it
npm run scenario create feature-pr-ready -- --run-ui

# Spin up a dirty worktree with many files, launch coco ui
npm run scenario create dirty-many-files -- --run-ui

# Spin up an in-progress merge conflict
npm run scenario create mid-merge-conflict -- --run-ui
```

### Integration tests — start from a baseline

```ts
import { spinUpScenario } from 'src/lib/testUtils/spinUpScenario'

describe('changelog flow against a PR-ready branch', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await spinUpScenario('feature-pr-ready')
  })

  afterAll(async () => {
    await repo.cleanup()
  })

  it('generates a changelog vs main', async () => {
    // repo is on feat/widget-v2, 4 commits ahead of main, clean.
    // Run the thing under test from here.
  })
})
```

## Layout

```
testUtils/
├── README.md             (this file)
├── tempGitRepo.ts        (low-level: init + user config + main branch)
├── spinUpScenario.ts     (programmatic API for tests)
├── spinUpScenario.test.ts
└── scenarios/
    ├── types.ts          (Scenario type)
    ├── index.ts          (registry + lookup)
    ├── shared/
    │   └── seededFiles.ts (wrapper around __fixtures__/generators)
    ├── feature-pr-ready.ts
    ├── feature-branch-one-commit.ts
    ├── multi-commit-branch.ts
    ├── two-commit-feature.ts
    ├── single-staged-file.ts
    ├── dirty-many-files.ts
    ├── mid-bisect.ts
    ├── mid-merge-conflict.ts
    └── stashed-changes.ts
```

The CLI driver lives at `bin/scenario.ts` and is wired via the
`scenario` npm script.

## Available scenarios

Run `npm run scenario list` for the live list. Current set (10 scenarios across 5 kinds):

| Name | Kind | What you get |
|---|---|---|
| `feature-pr-ready` | branch | `feat/widget-v2` 4 commits ahead of `main`, clean worktree — for create-pr (`C`) and changelog (`L`) flows |
| `feature-branch-one-commit` | branch | `main` + `feat/x` (1 commit ahead, `src/feature.ts`) — minimal branch-vs-base shape |
| `multi-commit-branch` | branch | `feat/dashboard` with 8 varied commits — baseline for navigation / filter / yank |
| `two-commit-feature` | branch | baseline + a feat commit on `main`, clean worktree — for changelog / log / review smoke tests |
| `single-staged-file` | worktree | baseline + 1 staged README — minimum "ready to commit" shape |
| `dirty-many-files` | worktree | 12 staged + 6 unstaged + 3 untracked files across `src/`, `tests/`, `docs/` — for the future split flow |
| `mid-bisect` | operation | 20 commits + active `git bisect`, HEAD at midpoint — for the bisect view |
| `mid-merge-conflict` | operation | in-progress merge with 1 unresolved conflict on `src/widget.ts` — for the conflicts view |
| `rich-history-graph` | history | 20+ commits across 6 date buckets, 2 `--no-ff` merges, 1 live unmerged `feat/wip` — for compact + full-graph rendering (bucket dividers, type coloring, branch chips, lane topology) |
| `stashed-changes` | stash | clean `main` + 3 stashes (LIFO ordered, each touching a distinct file) — for the stash view |

`npm run scenario describe <name>` prints the full description and
the contract assertions for a single scenario.

## The CLI (manual testing)

```bash
npm run scenario list                              # show all scenarios grouped by kind
npm run scenario describe feature-pr-ready         # one-scenario detail + contract list
npm run scenario create feature-pr-ready           # materialize in /tmp/coco-git-test-<rand>
npm run scenario create feature-pr-ready -- --path ~/sandbox/widget   # custom location
npm run scenario create feature-pr-ready -- --run-ui                  # materialize + launch coco ui
npm run scenario create feature-pr-ready -- --ephemeral               # auto-clean on exit
npm run scenario create rich-history-graph -- --run-ui \
  --remote git@github.com:gfargo/coco.git           # add an origin so gi / gP have data
```

### Flags

| Flag | Behavior |
|---|---|
| `--path <dir>` | Materialize at `<dir>` instead of `/tmp`. Useful when you want to `cd` into it later and poke around. |
| `--run-ui` | After materializing, spawn `coco ui` against the scenario dir (cwd = scenario dir, not the coco repo). Tightest dev loop for trying workstation changes. |
| `--remote <url>` | Add `origin` pointing at `<url>` so the GitHub triage views (`gi` / `gP`) detect a remote on launch. Pass any gh-shaped URL. Use a real one (`git@github.com:gfargo/coco.git`) to render the views with live data; use a fake one (`git@github.com:coco-test/sample.git`) to render the views safely against an empty / gh-unauthenticated remote. Without this flag the triage views show "No GitHub remote detected" — the scenario repo is a bare `git init` by default. |
| `--ephemeral` | Auto-clean the temp dir on CLI exit. Skip for normal use — without `--ephemeral`, the dir persists so you can re-inspect after `coco ui` quits. |

### Cleanup

Without `--ephemeral`, scenarios persist. The CLI prints the path
and a cleanup hint at exit:

```
✓ Scenario "feature-pr-ready" ready at:
    /var/folders/.../coco-git-test-xR2qwz

When you're done, clean up with:
    rm -rf /var/folders/.../coco-git-test-xR2qwz
```

Over time, `/tmp` accumulates these dirs. Periodically clean them with:

```bash
rm -rf $(ls -d /var/folders/**/coco-git-test-* 2>/dev/null)
```

## Programmatic API (integration tests)

### `spinUpScenario(name)`

The single import point for tests. Returns a `TempGitRepo` already
brought into the named state:

```ts
import { spinUpScenario } from 'src/lib/testUtils/spinUpScenario'

const repo = await spinUpScenario('feature-pr-ready')
// repo is on feat/widget-v2, 4 commits ahead of main, clean worktree
```

Throws if the name doesn't match a registered scenario — typos
fail at setup time, not buried in an assertion.

### The `TempGitRepo` shape

```ts
type TempGitRepo = {
  path: string                                          // absolute filesystem path
  git: SimpleGit                                        // simple-git instance bound to path
  writeFile: (path: string, content: string) => Promise<void>
  commitAll: (message: string) => Promise<void>
  cleanup: () => Promise<void>
}
```

- **`path`** — absolute path to the temp dir. Use for shell-out
  operations or anywhere a string path is needed.
- **`git`** — pre-configured `simple-git` instance. User identity
  (`Coco Test <coco@example.com>`) and `commit.gpgsign=false` are
  already set. Use for any git command in your test.
- **`writeFile(rel, content)`** — write to a path relative to the
  repo root. Parent directories created automatically.
- **`commitAll(message)`** — `git add . && git commit -m <message>`
  in one call. Convenience for the common case.
- **`cleanup()`** — `rm -rf` the temp dir. Call in `afterAll` /
  `afterEach`. Idempotent (safe to call twice).

### Extending a scenario in your test

A scenario sets up the baseline. From there, do whatever your test
needs:

```ts
const repo = await spinUpScenario('feature-pr-ready')

// Add an extra commit on top of the 4 the scenario gave you
await repo.writeFile('src/widget-v3.ts', 'export const v3 = true\n')
await repo.commitAll('feat: widget v3 stub')

// Make the worktree dirty
await repo.writeFile('src/extra.ts', 'console.log("dirty")\n')

// Now exercise the thing under test against this state
const log = await getLogRows(repo.git, { branch: 'main' })
expect(log).toHaveLength(5)
```

### Reading state after the action

After exercising the code under test, inspect the repo with the
provided `git` instance:

```ts
// Inspect commits
const log = await repo.git.log()
expect(log.latest?.message).toBe('feat: my new feature')

// Inspect refs
const branches = await repo.git.branchLocal()
expect(branches.all).toContain('feat/added-by-test')

// Inspect file content
const content = await fs.promises.readFile(`${repo.path}/src/foo.ts`, 'utf8')
expect(content).toContain('updated')

// Inspect status
const status = await repo.git.status()
expect(status.staged).toEqual(['src/foo.ts'])
```

### Raw `createTempGitRepo()` — when scenarios don't fit

`spinUpScenario` is the right entry point for ~95% of tests. The
underlying `createTempGitRepo()` is exported too, for the rare case
where none of the named scenarios fit and you really do want to
build from `git init`:

```ts
import { createTempGitRepo } from 'src/lib/testUtils/tempGitRepo'

const repo = await createTempGitRepo()
// fresh git repo with main branch + user config + commit.gpgsign=false
// no commits, no files — you build everything from here
```

If you find yourself reaching for `createTempGitRepo()` to build
something a future test will also want, **add a scenario instead**
(see "Adding a new scenario" below). Future-you (and future-others)
will thank present-you.

## Adding a new scenario

1. Create `src/lib/testUtils/scenarios/<kebab-name>.ts` exporting a
   `Scenario`.
2. Register it in `src/lib/testUtils/scenarios/index.ts`.
3. Add `<kebab-name>.test.ts` next to it — at minimum, assert each
   `contract` line holds after setup.
4. The CLI picks it up automatically.

### The `Scenario` shape

```ts
export type Scenario = {
  /** Stable identifier — kebab-case. Used as the CLI argument. */
  name: string
  /** One-line summary shown in `npm run scenario list`. */
  summary: string
  /** Multi-line description shown in `npm run scenario describe <name>`. */
  description: string
  /** Filtering category for the list view. */
  kind: 'branch' | 'worktree' | 'operation' | 'history' | 'stash'
  /** The actual state factory. Mutates the given repo. */
  setup: (repo: TempGitRepo) => Promise<void>
  /**
   * Human-readable expectations the test layer verifies. Also
   * documents the scenario's contract — surfaced in
   * `npm run scenario describe`.
   */
  contracts?: string[]
}
```

### Worked example

```ts
// src/lib/testUtils/scenarios/three-commit-feature.ts
import type { Scenario } from './types'
import { seededFiles } from './shared/seededFiles'

export const threeCommitFeatureScenario: Scenario = {
  name: 'three-commit-feature',
  summary: 'feat/example with 3 commits, clean worktree',
  description: `
    Baseline scaffold on main, then \`feat/example\` branched off with
    three commits. Use for any test that wants a short feature-branch
    shape without the bigger \`multi-commit-branch\` setup.
  `,
  kind: 'branch',
  contracts: [
    'main has 1 commit',
    'feat/example is checked out',
    'feat/example is 3 commits ahead of main',
    'worktree is clean',
  ],
  async setup(repo) {
    // Use seededFiles for deterministic content
    await repo.writeFile('README.md', '# example\n')
    await repo.commitAll('chore: initial commit')

    await repo.git.raw(['checkout', '-b', 'feat/example'])

    const files = seededFiles('three-commit-feature', 3)
    for (let i = 0; i < files.length; i += 1) {
      await repo.writeFile(`src/feature-${i}.ts`, files[i])
      await repo.commitAll(`feat: add feature ${i}`)
    }
  },
}
```

```ts
// src/lib/testUtils/scenarios/three-commit-feature.test.ts
import { createTempGitRepo } from '../tempGitRepo'
import { threeCommitFeatureScenario } from './three-commit-feature'

describe('three-commit-feature scenario', () => {
  it('matches its contracts', async () => {
    const repo = await createTempGitRepo()
    await threeCommitFeatureScenario.setup(repo)

    const branches = await repo.git.branchLocal()
    expect(branches.current).toBe('feat/example')
    expect(branches.all).toContain('main')

    const log = await repo.git.log(['feat/example', '--not', 'main'])
    expect(log.total).toBe(3)

    const status = await repo.git.status()
    expect(status.isClean()).toBe(true)

    await repo.cleanup()
  })
})
```

Then add to the registry:

```ts
// src/lib/testUtils/scenarios/index.ts
import { threeCommitFeatureScenario } from './three-commit-feature'

export const allScenarios: Scenario[] = [
  // ...existing
  threeCommitFeatureScenario,
]
```

### Deterministic content via `seededFiles`

Scenarios are intentionally small (30–80 LOC each) and focus on git
state shape, not file content. When you need realistic-looking file
content, use `seededFiles(seed, count)` — it wraps the deterministic
generators in `src/lib/parsers/default/__fixtures__/generators.ts`.
The same seed always produces identical content, so two test runs
produce byte-identical scenario repos.

## Debugging

### "What state did the scenario leave the repo in?"

```bash
# Spin up without --ephemeral (default) so the dir persists
npm run scenario create feature-pr-ready

# CLI prints the path; cd in and look around
cd /var/folders/.../coco-git-test-XXXXXX
git log --oneline
git status
git branch
```

### "My test fails — what does the repo look like at that point?"

Comment out `repo.cleanup()` temporarily, then re-run the test. The
temp dir survives the run; the failure message includes `repo.path`
when you log it:

```ts
afterAll(async () => {
  // await repo.cleanup()   // ← comment out to inspect
})

it('does the thing', async () => {
  // ...
  console.log('repo path:', repo.path)   // log so you can cd in
  // assertion that fails
})
```

After inspecting, restore `cleanup()` so subsequent runs don't
accumulate dirs.

### "How do I run just one scenario's test?"

```bash
# All scenario tests
npm run test:jest -- --testPathPatterns scenarios

# A specific scenario
npm run test:jest -- --testPathPatterns feature-pr-ready
```

### Mocking the LLM in scenario-based tests

If your test exercises a workflow that hits the LLM (`runCommitDraftWorkflow`,
`runChangelogTextWorkflow`, etc.), mock the handler the workflow calls
into. The pattern is captured in `src/git/aiActions.test.ts`:

```ts
jest.mock('../commands/changelog/handler')

const mockedChangelogHandler = jest.mocked(changelogHandler)
mockedChangelogHandler.mockImplementation(async () => {
  process.stdout.write('feat: my deterministic title\n\nbody here.')
})

const result = await runChangelogTextWorkflow({ branch: 'main' })
expect(result.text).toContain('feat: my deterministic title')
```

The scenario sets up the git state; the mock sets up the LLM output.
Together they make the workflow test deterministic top to bottom.

## Consumers outside of tests

The scenario library is also the golden-set provider for the
structural-extract eval harness (#934). Each scenario's commits are
walked into per-file diffs and fed through the parser pipeline with
the language-aware fast path toggled on vs. off; the harness reports
LLM-calls-saved + fast-path hit rate per input.

```bash
npm run eval:structural-extract                 # all scenarios + fixtures
npm run eval:structural-extract -- --scenario feature-pr-ready
npm run eval:structural-extract -- --fixtures-only
```

The adapter lives at
`src/lib/parsers/default/__evals__/scenarioInputs.ts` and the
extraction-boundary rule still holds: it imports from
`src/lib/testUtils/scenarios` and the public `findScenario` helper,
not from any individual scenario module. When the testUtils layer
moves out to its own package, the eval depends on the published
package the same way any other consumer would.

## Extraction discipline

This layer is intentionally **git-tool-agnostic** and a candidate for
extraction to a standalone `git-scenarios` package on npm once the
abstractions stabilize. The boundary rules below are what keeps that
extraction path open.

### Rules

- **No coco-specific imports inside `scenarios/`.** Imports are
  limited to:
  - `simple-git`
  - Node stdlib (`fs`, `path`, `os`)
  - `../tempGitRepo` (the base helper — also extractable)
  - `../../parsers/default/__fixtures__/generators` (git-agnostic
    content generators — extractable as peer dependency or co-moved)
- **Scenario signatures are pure git-state factories.**
  `(repo: TempGitRepo) => Promise<void>`. No knowledge of which tool is
  testing them. A scenario named `mid-bisect` produces a mid-bisect
  repo — full stop.
- **`spinUpScenario.ts` is the public programmatic surface.** Tests
  import from it; nothing else in coco should reach into
  `scenarios/*.ts` directly.
- **The CLI (`bin/scenario.ts`) is the public command surface.** Its
  `--run-ui` flag is the only piece that knows about coco; when
  extracted, that becomes `--run <command>` for arbitrary downstream
  tools.

### When to extract

Roughly: after 3–6 months of in-coco use, when at least one of these is
true:

- A second project we own wants to use it (e.g. `coco-vscode-extension`,
  `create-coco`).
- An external issue / discussion asks "is this published anywhere?"
- Keeping it in coco actively complicates something (e.g. scenario
  fixture data starts bloating the coco install).

### How extraction looks

Mechanical:

```bash
mkdir git-scenarios && cd git-scenarios
cp -r ../coco/src/lib/testUtils/scenarios ./src
cp ../coco/src/lib/testUtils/tempGitRepo.ts ./src/
cp ../coco/src/lib/testUtils/spinUpScenario.ts ./src/
cp ../coco/bin/scenario.ts ./bin/cli.ts
# generators come with as a peer dep or co-moved
# add package.json / README / LICENSE
npm publish
```

The boundary rules above are what make that `cp` work. Until then, keep
the discipline strict — every coco-specific import added to this
directory tree is an extraction tax we'll pay later.
