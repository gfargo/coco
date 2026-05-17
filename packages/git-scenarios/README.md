# `@gfargo/git-scenarios` — temp git repos + named scenarios

The test-infrastructure layer for spinning up git repositories in
known states. Two audiences:

1. **You're writing an integration test.** Use `spinUpScenario()` to
   start from a deterministic baseline instead of hand-building the
   same `tempGitRepo + writeFile + commitAll` setup every time.
2. **You're hand-testing a git tool (workstation, lazygit, gitui, your
   own thing).** Use the CLI to materialize a scenario on disk and
   (optionally) launch a tool against it in one command.

Both paths share the same eleven scenarios.

> **Status (shadow-extracted).** This package lives inside the coco
> monorepo at `packages/git-scenarios/` while we validate the
> boundary. `private: true` in `package.json` keeps it off the npm
> registry. Coco's tests / CLI consume it via the
> `@gfargo/git-scenarios` alias (tsconfig + jest path mapping). When
> a second consumer wants it or the package stops needing churn,
> flip `private` off and publish.

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
import { spinUpScenario } from '@gfargo/git-scenarios'

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
packages/git-scenarios/
├── README.md               (this file)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            (public API — `spinUpScenario`, `createTempGitRepo`, registry)
│   ├── tempGitRepo.ts      (low-level: init + user config + main branch)
│   ├── spinUpScenario.ts   (programmatic API for tests)
│   ├── spinUpScenario.test.ts
│   ├── __fixtures__/
│   │   └── generators.ts   (vendored deterministic content generator)
│   └── scenarios/
│       ├── types.ts        (Scenario type)
│       ├── index.ts        (registry + lookup)
│       ├── shared/
│       │   └── seededFiles.ts (wrapper around the generator)
│       ├── feature-pr-ready.ts
│       ├── feature-branch-one-commit.ts
│       ├── multi-commit-branch.ts
│       ├── two-commit-feature.ts
│       ├── single-staged-file.ts
│       ├── dirty-many-files.ts
│       ├── mid-bisect.ts
│       ├── mid-merge-conflict.ts
│       ├── stashed-changes.ts
│       ├── rich-history-graph.ts
│       └── submodule-with-history.ts
└── bin/
    └── cli.ts              (the `git-scenarios` CLI, also reachable as `npm run scenario` inside coco)
```

The CLI driver lives at `bin/cli.ts` and is wired via the `scenario`
npm script inside the coco monorepo. When extracted, it becomes the
binary at `bin.git-scenarios` in `package.json`.

## Available scenarios

Run `npm run scenario list` for the live list. Current set (11 scenarios across 6 kinds):

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
| `submodule-with-history` | submodule | parent with 4 commits + `vendor/lib` submodule (clean pin, 4 commits, `branch = main`) — for recursive submodule navigation (#931) |

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
import { spinUpScenario } from '@gfargo/git-scenarios'

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
import { createTempGitRepo } from 'packages/git-scenarios/src/tempGitRepo'

const repo = await createTempGitRepo()
// fresh git repo with main branch + user config + commit.gpgsign=false
// no commits, no files — you build everything from here
```

If you find yourself reaching for `createTempGitRepo()` to build
something a future test will also want, **add a scenario instead**
(see "Adding a new scenario" below), or compose one inline from the
atom layer (see the next section).

## Atoms — compose any repo state from building blocks

Every registered scenario is built from small, single-purpose
**atoms**: functions that take a `TempGitRepo` and apply one
side-effect. Atoms are exported flat from the package, so you can
compose your own setups inline in tests — no registration needed —
or use them to write new registered scenarios.

```ts
import {
  addCommit,
  addRemote,
  chain,
  createTempGitRepo,
  seededFiles,
  startMerge,
  switchToBranch,
} from '@gfargo/git-scenarios'

const repo = await createTempGitRepo()
await chain(
  addCommit({ message: 'init', files: { 'README.md': '# repo' } }),
  addRemote('origin', 'git@example.com:org/repo.git'),
  seededFiles({ files: [{ path: 'src/widget.ts', tokens: 120 }], seed: 0xabc }),
  addCommit({ message: 'feat: widget' }),
  switchToBranch('feat/conflict'),
  addCommit({ message: 'theirs', files: { 'src/widget.ts': 'theirs\n' } }),
  // … flip back to main with a conflicting change, then attempt merge
)(repo)
```

The atom signature is uniform: every atom returns a `Step`,
`(repo: TempGitRepo) => Promise<void>`. That's the same type
`Scenario.setup` accepts, so `setup: chain(…)` works directly in
`defineScenario({…})`.

### Atom catalog

#### Control flow

| Atom | What it does |
|---|---|
| `chain(...steps)` | Sequence atoms; awaits each before the next. Short-circuits on rejection. |
| `repeat(n, factory)` | `chain(...Array.from({ length: n }, factory))` — readable "do this N times." |

#### Working tree

| Atom | What it does |
|---|---|
| `writeFiles({ 'path': content })` | Write literal content. Parent dirs created. Does NOT stage. |
| `seededFiles({ files, seed })` | Write procedurally-generated content (seeded, byte-stable across runs). |

#### Staging + commits

| Atom | What it does |
|---|---|
| `stageFiles(...paths)` | `git add .` (no args) or `git add <paths>`. |
| `commit(message, { date? })` | Commit the staged set. Doesn't stage. |
| `addCommit({ message, files?, date? })` | Workhorse: write + stage all + commit. |
| `emptyCommit(message, { date? })` | `--allow-empty` commit. |
| `amendCommit({ message? })` | `--amend` the last commit. |

Every commit-producing atom accepts an optional `date` (any
`GIT_AUTHOR_DATE`-compatible ISO string). Pair with `daysAgo(n)` for
relative-time scenarios.

#### Branches

| Atom | What it does |
|---|---|
| `switchToBranch(name, { from? })` | `git checkout -b <name>` (optionally from a specific ref). |
| `checkoutBranch(name)` | `git checkout <name>` (existing). |
| `createBranch(name, { from? })` | `git branch <name>` (no checkout). |
| `deleteBranch(name, { force? })` | `git branch -d` / `-D`. |

#### Tags

| Atom | What it does |
|---|---|
| `createTag(name, { message?, sha? })` | Annotated when `message` is set, otherwise lightweight. |
| `deleteTag(name)` | `git tag -d`. |

#### Remotes

| Atom | What it does |
|---|---|
| `addRemote(name, url)` | Register a remote. URL stored as-is — no fetch. |
| `removeRemote(name)` | Drop a remote. |
| `renameRemote(from, to)` | Rename a remote (URL unchanged). |

#### Stash

| Atom | What it does |
|---|---|
| `stashChanges({ message?, includeUntracked?, keepIndex? })` | `git stash push` with the matching flags. |
| `applyStash({ ref? })` | `git stash apply`. |
| `popStash({ ref? })` | `git stash pop`. |
| `dropStash({ ref? })` | `git stash drop`. |

#### Operations (merge / cherry-pick / revert / bisect / reset)

| Atom | What it does |
|---|---|
| `startMerge(branch, { allowConflict?, noFastForward?, message?, date? })` | Merge — conflicts leave the repo mid-merge by default. |
| `abortMerge()` | `git merge --abort`. |
| `cherryPick(ref, { allowConflict?, date? })` | Cherry-pick — conflicts leave mid-cherry-pick by default. |
| `abortCherryPick()` | `git cherry-pick --abort`. |
| `revert(ref, { mainline?, allowConflict?, date? })` | Revert a commit (use `mainline` for merge commits). |
| `startBisect({ bad, good })` | Begin a bisect at HEAD's midpoint. |
| `bisectStep(verdict)` | `'good'` / `'bad'` / `'skip'`. |
| `resetBisect()` | `git bisect reset`. |
| `resetTo({ target, mode? })` | `git reset --soft/mixed/hard <target>`. |

#### Submodules

| Atom | What it does |
|---|---|
| `addSubmodule({ path, branch?, setup })` | Builds a source repo from `setup` (a `Step` — any atom composes), clones it in as a submodule. |
| `pinSubmodule(path, sha)` | Move the parent's recorded pin for the submodule. |

#### Linked worktrees

| Atom | What it does |
|---|---|
| `addWorktree(path, { branch? \| checkout?, detach?, from? })` | `git worktree add`. |
| `removeWorktree(path, { force? })` | `git worktree remove`. |

#### Config

| Atom | What it does |
|---|---|
| `setConfig(key, value, { unset? })` | Local `git config <key> <value>`, or `--unset` when `unset: true`. |

#### Scoping (apply atoms to a different context)

| Atom | What it does |
|---|---|
| `onBranch(name, step)` | Switch to `name`, run `step`, restore the previous branch (even on throw). |
| `insideSubmodule(path, step)` | Run `step` against the submodule's working tree. Any atom composes inside. |
| `withAuthor({ name, email, date? }, step)` | Run `step` with `GIT_AUTHOR_*` / `GIT_COMMITTER_*` pinned. |

#### Scenario definition

| Atom | What it does |
|---|---|
| `defineScenario({…})` | Validating wrapper for `Scenario` (kebab-case name, kind enum, non-empty fields). |
| `daysAgo(n)` | ISO timestamp at noon UTC N days before now. Pairs with the `date` option on commit atoms. |

### Worked example: "out-of-date submodule"

A scenario shape that's hard with the imperative API but reads
declaratively with atoms — the parent's pinned commit is older than
the submodule's HEAD:

```ts
import { addCommit, addSubmodule, chain, defineScenario, insideSubmodule } from '@gfargo/git-scenarios'

export const outOfDateSubmoduleScenario = defineScenario({
  name: 'out-of-date-submodule',
  summary: 'parent pinned at submodule HEAD~2, three post-pin commits inside',
  description: '…',
  kind: 'submodule',
  setup: chain(
    addCommit({ message: 'init', files: { 'README.md': '# parent' } }),
    addSubmodule({
      path: 'vendor/lib',
      branch: 'main',
      setup: chain(
        addCommit({ message: 'init lib', files: { 'README.md': '# lib' } }),
      ),
    }),
    addCommit({ message: 'chore: pin submodule' }),

    // Make commits INSIDE the submodule without updating the parent's pin.
    insideSubmodule('vendor/lib', chain(
      addCommit({ message: 'feat: post-pin A', files: { 'src/a.ts': 'a' } }),
      addCommit({ message: 'feat: post-pin B', files: { 'src/b.ts': 'b' } }),
      addCommit({ message: 'feat: post-pin C', files: { 'src/c.ts': 'c' } }),
    )),
    // Parent's `.gitmodules` pin is unchanged; `git submodule status`
    // reports `+` modified.
  ),
})
```

### Worked example: multi-contributor history

```ts
import { addCommit, chain, daysAgo, withAuthor } from '@gfargo/git-scenarios'

await chain(
  addCommit({ message: 'init', files: { 'README.md': '# repo' } }),
  withAuthor({ name: 'Alice', email: 'alice@example.com', date: daysAgo(10) },
    addCommit({ message: 'feat: alice work', files: { 'a.ts': 'x' } }),
  ),
  withAuthor({ name: 'Bob', email: 'bob@example.com', date: daysAgo(5) },
    addCommit({ message: 'fix: bob work', files: { 'b.ts': 'y' } }),
  ),
)(repo)
```

`git log` now shows commits by Alice (10 days ago) and Bob (5 days
ago) — useful for testing blame, PR-triage-by-author, contributor
stats.

### Worked example: multi-remote fork topology

```ts
import { addCommit, addRemote, chain } from '@gfargo/git-scenarios'

await chain(
  addCommit({ message: 'init', files: { 'README.md': '# fork' } }),
  addRemote('origin', 'git@github.com:fork/repo.git'),
  addRemote('upstream', 'git@github.com:source/repo.git'),
)(repo)
```

## Adding a new scenario

1. Create `src/scenarios/<kebab-name>.ts` exporting a
   `Scenario`.
2. Register it in `src/scenarios/index.ts`.
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
  kind: 'branch' | 'worktree' | 'operation' | 'history' | 'stash' | 'submodule'
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
// src/scenarios/three-commit-feature.ts
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
// src/scenarios/three-commit-feature.test.ts
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
// src/scenarios/index.ts
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
`src/scenarios` and the public `findScenario` helper,
not from any individual scenario module. When the testUtils layer
moves out to its own package, the eval depends on the published
package the same way any other consumer would.

## Extraction discipline

This package is **shadow-extracted** — it lives at
`packages/git-scenarios/` inside the coco monorepo with
`private: true` until the extraction is validated by real use.
Coco's tests / CLI consume it via the `@gfargo/git-scenarios` alias
(tsconfig + jest path mapping). When ready, flip `private: false`
and `npm publish` is one step (`prepublishOnly` runs the build).

### Rules

- **No coco-specific imports inside the package.** Imports are
  limited to:
  - `simple-git`
  - Node stdlib (`fs`, `path`, `os`, `child_process`, `util`)
  - Sibling files inside the package (`./atoms`, `./scenarios`,
    `./tempGitRepo`, `./__fixtures__/generators`)
- **Scenario signatures are pure git-state factories.**
  `(repo: TempGitRepo) => Promise<void>`. No knowledge of which tool is
  testing them. A scenario named `mid-bisect` produces a mid-bisect
  repo — full stop.
- **Public surface = `index.ts`.** Tests import named symbols from
  the package root; nothing else should reach into individual files
  directly.
- **CLI (`bin/cli.ts`) is the public command surface.** The
  generalized `--run <cmd>` flag launches any tool; `--run-ui` is a
  coco-monorepo back-compat alias that resolves to launching coco's
  source-tree CLI. When the package publishes, external consumers
  use `--run` exclusively.

### When to publish

Trigger conditions:

- A second project we own wants to use it (e.g. `coco-vscode-extension`,
  `create-coco`).
- An external issue / discussion asks "is this published anywhere?"
- Keeping it in coco actively complicates something (e.g. scenario
  fixture data starts bloating the coco install).

### How publishing looks (when triggered)

The build setup + package metadata are already in place. To publish:

```bash
cd packages/git-scenarios
# 1. Flip private:true → false in package.json
# 2. Bump 0.0.0 → 0.1.0 (or higher)
# 3. (one-time) ensure you have publish rights on @gfargo

npm publish --access public
# prepublishOnly runs: npm run clean && npm run build
```

After publish, decide what to do with the vendored generators:

- **Option A**: have coco's parser fixtures import from
  `@gfargo/git-scenarios/__fixtures__/generators`. Removes the
  duplication; introduces a coco → package dep on the parsers side.
- **Option B**: extract generators to a third peer package
  (`@gfargo/seeded-content`) that both consume. Cleanest separation;
  one more package to maintain.

A parity test (`src/lib/parsers/default/__fixtures__/generatorsParity.test.ts`)
catches drift between the two copies in the meantime — if either
copy's generator implementation changes, the test fails loudly.

### Boundary discipline (kept strict)

Every coco-specific import added to this package is an extraction tax
we'll pay at publish time. The atoms / scenarios layer holds the line
today; keep it that way.
