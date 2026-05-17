# `@gfargo/git-scenarios`

> **Spin up real git repositories in any state, deterministically.**
> Composable atoms for merge conflicts, out-of-date submodules,
> multiple remotes, in-progress operations, multi-contributor
> histories, linked worktrees, and more — for tests, demos, and tool
> development.

<!-- Badges will populate once published.
[![npm](https://img.shields.io/npm/v/@gfargo/git-scenarios.svg)](https://www.npmjs.com/package/@gfargo/git-scenarios)
[![license](https://img.shields.io/npm/l/@gfargo/git-scenarios.svg)](./LICENSE)
[![types](https://img.shields.io/npm/types/@gfargo/git-scenarios.svg)](#)
-->

## What this is

Real-world git tools — `coco`, `lazygit`, IDEs, custom dev tools —
behave differently against a feature-branch-ready-to-PR than against
a mid-merge-conflict than against an out-of-date submodule. Testing
those behaviors usually means hand-writing `git init` + `writeFile` +
`commitAll` setups in every test, or worse, checking real repos into
the test tree.

This package replaces both with:

- **A registry of curated scenarios** (`feature-pr-ready`,
  `mid-merge-conflict`, `submodule-with-history`, …) — call
  `spinUpScenario('name')` and you get a real temp git repo in the
  named state, ready to drive your tool against.
- **A composable atom layer** (`chain`, `addCommit`, `startMerge`,
  `addSubmodule`, `withAuthor`, …) — build your own scenarios inline
  in tests, or register custom ones for your project.
- **A tool-agnostic CLI** — `npx git-scenarios create
  <name> --run <command>` materializes a scenario and launches any
  tool against it. Tightest dev loop for "what does my tool do
  against state X?"

Every scenario is deterministic (same setup → byte-identical repo
state every run), so the tests built on top are deterministic too.

## Audiences

1. **You're writing an integration test.** Use `spinUpScenario()` to
   start from a deterministic baseline instead of hand-building the
   same `git init` + `writeFile` + `commitAll` setup every time.
2. **You're hand-testing a git tool** (your own, or someone else's).
   Use the CLI to materialize a scenario on disk and launch the tool
   against it in one command.
3. **You're building your own scenario library** for a tool that
   doesn't fit the curated set. Use the atom layer to compose
   anything from "single staged file" to "three-way nested submodule
   mid-rebase."

> **Status (shadow-extracted).** This package lives inside the
> [`gfargo/coco`](https://github.com/gfargo/coco) monorepo at
> `packages/git-scenarios/` while we validate the boundary.
> `private: true` keeps it off the npm registry. Coco's tests / CLI
> consume it via the `@gfargo/git-scenarios` alias (tsconfig + jest
> path mapping). When a second consumer wants it or the package
> stops needing churn, flip `private` off and publish.

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Common patterns (cookbook)](#common-patterns-cookbook)
- [Available scenarios](#available-scenarios)
- [The CLI](#the-cli)
- [Programmatic API](#programmatic-api)
- [Atoms — compose any repo state](#atoms--compose-any-repo-state-from-building-blocks)
- [Defining your own scenarios](#defining-your-own-scenarios)
- [TypeScript support](#typescript-support)
- [Debugging](#debugging)
- [Consumers beyond tests](#consumers-outside-of-tests)
- [Extraction discipline](#extraction-discipline)

## Installation

```bash
npm install --save-dev @gfargo/git-scenarios simple-git
# or
yarn add --dev @gfargo/git-scenarios simple-git
# or
pnpm add --save-dev @gfargo/git-scenarios simple-git
```

`simple-git` is a `peerDependency` — installed alongside so your
project picks the version compatible with both this package and any
other simple-git consumer you have.

**Node requirement**: `^22.22.2 || ^24.15.0 || >=26.0.0`. The
package ships ESM; CommonJS consumers should use `await import(...)`.

> Inside the coco monorepo today, no install is needed — the package
> is consumed via path mapping. See [coco's `CONTRIBUTING.md`](https://github.com/gfargo/coco/blob/main/CONTRIBUTING.md)
> for the in-monorepo workflow.

## Quick start

### Integration tests — start from a baseline

```ts
import { spinUpScenario, type TempGitRepo } from '@gfargo/git-scenarios'

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

### Manual testing — drive any tool against a known state

```bash
# Spin up a feature branch ready to PR, launch lazygit against it
npx git-scenarios create feature-pr-ready --run "lazygit"

# Spin up an in-progress merge conflict, drop into your IDE
npx git-scenarios create mid-merge-conflict --run "code -n"

# Spin up a dirty worktree without launching anything — get the path
npx git-scenarios create dirty-many-files
# → /var/folders/.../coco-git-test-xR2qwz
# cd in and run whatever you want against it
```

Inside coco's monorepo, `npm run scenario` is wired as a shortcut:

```bash
npm run scenario list
npm run scenario create feature-pr-ready -- --run-ui  # launches coco ui
```

### Inline composition — build a scenario right in a test

```ts
import {
  addCommit,
  addRemote,
  chain,
  createTempGitRepo,
  startMerge,
  switchToBranch,
} from '@gfargo/git-scenarios'

const repo = await createTempGitRepo()
await chain(
  addCommit({ message: 'base', files: { 'src/widget.ts': 'export const widget = () => null\n' } }),
  switchToBranch('feat/theirs'),
  addCommit({ message: 'theirs', files: { 'src/widget.ts': 'theirs\n' } }),
  switchToBranch('main'),
  addCommit({ message: 'ours', files: { 'src/widget.ts': 'ours\n' } }),
  startMerge('feat/theirs'),
  addRemote('origin', 'git@example.com:org/repo.git'),
)(repo)
// repo is now mid-merge with src/widget.ts conflicted, origin set
```

## Common patterns (cookbook)

### "I just need a repo with a few commits"

```ts
const repo = await spinUpScenario('two-commit-feature')
```

### "I need a repo my tool can stage / commit against"

```ts
const repo = await spinUpScenario('single-staged-file')
// repo has 1 staged README ready to commit
```

### "I need to test a merge-conflict flow"

```ts
const repo = await spinUpScenario('mid-merge-conflict')
// repo is mid-merge with `src/widget.ts` conflicted, MERGE_HEAD set
```

Or inline:

```ts
await chain(
  addCommit({ message: 'base', files: { 'x.ts': 'base\n' } }),
  switchToBranch('feat/theirs'),
  addCommit({ message: 'theirs', files: { 'x.ts': 'theirs\n' } }),
  switchToBranch('main'),
  addCommit({ message: 'ours', files: { 'x.ts': 'ours\n' } }),
  startMerge('feat/theirs'),
)(repo)
```

### "I need an out-of-date submodule"

```ts
await chain(
  addCommit({ message: 'init', files: { 'README.md': '# parent' } }),
  addSubmodule({
    path: 'vendor/lib',
    branch: 'main',
    setup: chain(
      addCommit({ message: 'init lib', files: { 'README.md': '# lib' } }),
    ),
  }),
  addCommit({ message: 'chore: pin submodule' }),
  // Commits inside the submodule that DON'T update the parent's pin
  insideSubmodule('vendor/lib', chain(
    addCommit({ message: 'feat: post-pin', files: { 'a.ts': 'a' } }),
  )),
)(repo)
// `git submodule status` now reports `+` modified
```

### "I need multi-contributor history for blame / triage tests"

```ts
await chain(
  addCommit({ message: 'init', files: { 'README.md': '# repo' } }),
  withAuthor({ name: 'Alice', email: 'alice@org', date: daysAgo(10) },
    addCommit({ message: 'feat: alice work', files: { 'a.ts': 'a' } }),
  ),
  withAuthor({ name: 'Bob', email: 'bob@org', date: daysAgo(5) },
    addCommit({ message: 'fix: bob work', files: { 'b.ts': 'b' } }),
  ),
)(repo)
```

### "I need a fork topology with origin + upstream"

```ts
await chain(
  addCommit({ message: 'init', files: { 'README.md': '# fork' } }),
  addRemote('origin', 'git@github.com:fork/repo.git'),
  addRemote('upstream', 'git@github.com:source/repo.git'),
)(repo)
```

### "I need linked worktrees"

```ts
await chain(
  addCommit({ message: 'init', files: { 'README.md': '# repo' } }),
  addWorktree('/tmp/feat-x', { branch: 'feat/x' }),
  // Second worktree on its own branch
)(repo)
```

### "I need a specific git config for my tool to detect"

```ts
await chain(
  addCommit({ message: 'init', files: { 'README.md': '# repo' } }),
  setConfig('commit.template', '.gitmessage'),
  setConfig('user.signingkey', 'ABC123'),
)(repo)
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

Run `git-scenarios list` (or `npm run scenario list` inside coco) for
the live list. Current set (**11 scenarios across 6 kinds**):

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
| `submodule-with-history` | submodule | parent with 4 commits + `vendor/lib` submodule (clean pin, 4 commits, `branch = main`) — for recursive submodule navigation |

`git-scenarios describe <name>` prints the full description and the
contract assertions for a single scenario.

## The CLI

```bash
# Outside coco (after `npm install --save-dev @gfargo/git-scenarios`):
npx git-scenarios list                                                  # show all scenarios grouped by kind
npx git-scenarios describe feature-pr-ready                             # one-scenario detail
npx git-scenarios create feature-pr-ready                               # materialize in /tmp
npx git-scenarios create feature-pr-ready --path ~/sandbox/widget       # custom location
npx git-scenarios create feature-pr-ready --run "lazygit"               # launch any tool against it
npx git-scenarios create feature-pr-ready --ephemeral                   # auto-clean on exit
npx git-scenarios create rich-history-graph \
  --run "lazygit" --remote git@github.com:org/repo.git                  # add an origin first

# Inside coco's monorepo, `npm run scenario` is wired as a shortcut:
npm run scenario list
npm run scenario create feature-pr-ready -- --run-ui                    # `--run-ui` launches coco ui
```

### Flags

| Flag | Behavior |
|---|---|
| `--path <dir>` | Materialize at `<dir>` instead of `/tmp`. Useful when you want to `cd` into it later and poke around. |
| `--run <cmd>` | After materializing, spawn `<cmd>` against the scenario dir (cwd = scenario dir). Examples: `--run "lazygit"`, `--run "gitui"`, `--run "code -n"` (open in VS Code). |
| `--run-ui` | Coco-monorepo back-compat alias — spawns coco's source-tree CLI (`tsx <coco>/src/index.ts ui`) against the scenario dir. External consumers use `--run "coco ui"` (or any other shell command) instead. |
| `--remote <url>` | Add `origin` pointing at `<url>` so gh-aware tools detect a remote on launch. Pass any gh-shaped URL. Use a real one to render the tool's views with live data; use a fake one to render against an empty / unauthenticated remote (no risk of accidental destructive actions). Without this flag the scenario repo is a bare `git init` with no remote. |
| `--ephemeral` | Auto-clean the temp dir on CLI exit. Skip for normal use — without `--ephemeral`, the dir persists so you can re-inspect after the launched tool quits. |

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

## Defining your own scenarios

Most projects want a few custom scenarios alongside the built-in
ones — repo shapes specific to your tool's domain (e.g. "monorepo
with two workspaces, one dirty"). Define them with `defineScenario`
and compose the setup from atoms:

```ts
// my-test-utils/scenarios/two-workspace-dirty.ts
import {
  addCommit,
  chain,
  defineScenario,
  stageFiles,
  switchToBranch,
  writeFiles,
} from '@gfargo/git-scenarios'

export const twoWorkspaceDirtyScenario = defineScenario({
  name: 'two-workspace-dirty',
  summary: 'monorepo w/ packages/app + packages/lib; lib is dirty',
  description: 'Two workspace packages on `main`; uncommitted edits in `packages/lib/src/foo.ts`.',
  kind: 'worktree',
  contracts: [
    'main has 2 commits',
    'packages/lib/src/foo.ts is unstaged',
  ],
  setup: chain(
    addCommit({
      message: 'chore: scaffold workspaces',
      files: {
        'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }, null, 2),
        'packages/app/package.json': '{ "name": "app" }',
        'packages/lib/package.json': '{ "name": "lib" }',
      },
    }),
    addCommit({
      message: 'feat: lib baseline',
      files: { 'packages/lib/src/foo.ts': 'export const foo = 1\n' },
    }),
    // Now make a worktree change without staging.
    writeFiles({ 'packages/lib/src/foo.ts': 'export const foo = 2\n' }),
  ),
})
```

Use it in a test directly (no registration needed):

```ts
import { createTempGitRepo } from '@gfargo/git-scenarios'
import { twoWorkspaceDirtyScenario } from './my-test-utils/scenarios/two-workspace-dirty'

describe('my-tool against dirty workspace', () => {
  it('detects the unstaged lib change', async () => {
    const repo = await createTempGitRepo()
    try {
      await twoWorkspaceDirtyScenario.setup(repo)
      // … exercise your tool against repo …
    } finally {
      await repo.cleanup()
    }
  })
})
```

Or build a local registry + helper that mirrors `spinUpScenario`:

```ts
// my-test-utils/scenarios/index.ts
import { createTempGitRepo, type Scenario, type TempGitRepo } from '@gfargo/git-scenarios'
import { twoWorkspaceDirtyScenario } from './two-workspace-dirty'
import { releaseReadyScenario } from './release-ready'

const localScenarios: Scenario[] = [twoWorkspaceDirtyScenario, releaseReadyScenario]

export async function spinUpLocalScenario(name: string): Promise<TempGitRepo> {
  const scenario = localScenarios.find((s) => s.name === name)
  if (!scenario) throw new Error(`Unknown local scenario "${name}"`)
  const repo = await createTempGitRepo()
  await scenario.setup(repo)
  return repo
}
```

### The `Scenario` shape

```ts
type Scenario = {
  /** Stable identifier — kebab-case. */
  name: string
  /** One-line summary shown in CLI list output. */
  summary: string
  /** Multi-line description shown in CLI describe output. */
  description: string
  /** Filtering category. */
  kind: 'branch' | 'worktree' | 'operation' | 'history' | 'stash' | 'submodule'
  /** Git-state factory — typically `chain(...)` of atoms. */
  setup: Step  // (repo: TempGitRepo) => Promise<void>
  /** Optional human-readable contract assertions. */
  contracts?: string[]
}
```

`defineScenario` validates the shape at module load time (kebab-case
name, kind enum, non-empty fields). Catches typos that would
otherwise blow up mid-test.

### Contributing a scenario to this package

If your custom scenario is generally useful (e.g. "stashed-with-untracked",
"rebase-mid-conflict"), open a PR against
[`gfargo/coco`](https://github.com/gfargo/coco/issues) adding:

1. `packages/git-scenarios/src/scenarios/<kebab-name>.ts` exporting
   the scenario.
2. `<kebab-name>.test.ts` next to it, asserting each contract line
   holds after setup.
3. Register in `packages/git-scenarios/src/scenarios/index.ts`.

The CLI picks it up automatically.

## TypeScript support

The package is **TypeScript-first** — all public APIs ship with full
type declarations and source maps. Types you'll commonly reach for:

```ts
import type {
  AuthorIdentity,     // { name, email, date? } for withAuthor
  FileMap,            // { 'path': content } for writeFiles
  Scenario,           // the registered-scenario shape
  ScenarioKind,       // 'branch' | 'worktree' | 'operation' | 'history' | 'stash' | 'submodule'
  SeededFileSpec,     // { path, tokens, seedOffset? } for seededFiles
  Step,               // (repo: TempGitRepo) => Promise<void> — the atom contract
  TempGitRepo,        // { path, git, writeFile, commitAll, cleanup }
} from '@gfargo/git-scenarios'
```

Every atom returns a `Step`, so writing your own helpers feels
identical to using the built-in ones:

```ts
import { addCommit, chain, type Step } from '@gfargo/git-scenarios'

// Custom helper composed from atoms — still a Step
export function scaffoldMonorepo(workspaces: string[]): Step {
  return chain(
    addCommit({
      message: 'chore: scaffold workspaces',
      files: {
        'package.json': JSON.stringify({ workspaces }, null, 2),
        ...Object.fromEntries(
          workspaces.map((w) => [`${w}/package.json`, `{ "name": "${w.split('/').pop()}" }`]),
        ),
      },
    }),
  )
}

// Use it like any built-in atom
await chain(
  scaffoldMonorepo(['packages/app', 'packages/lib']),
  addCommit({ message: 'feat: first feature', files: { 'packages/app/src/index.ts': '…' } }),
)(repo)
```

The atom factory pattern (returning a `Step`) means custom helpers
compose cleanly into `chain(...)` alongside the built-ins.

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

Inside the coco monorepo:

```bash
# All scenario tests
npm run test:jest -- --testPathPatterns scenarios

# A specific scenario
npm run test:jest -- --testPathPatterns feature-pr-ready
```

### Mocking external services (LLM / network / hooks) in scenario-based tests

Scenarios set up the **git state**; mocks set up everything else.
The standard pattern is to use your test framework's mocking
primitives to replace the network / LLM / hook layer your tool
calls into:

```ts
// jest example: mock a workflow handler the tool routes through
jest.mock('../commands/changelog/handler')
const mockedHandler = jest.mocked(changelogHandler)
mockedHandler.mockImplementation(async () => {
  process.stdout.write('feat: my deterministic title\n\nbody here.')
})

const repo = await spinUpScenario('feature-pr-ready')
const result = await runChangelogTextWorkflow({ branch: 'main' })
expect(result.text).toContain('feat: my deterministic title')
```

Together (scenario + mock) the test becomes deterministic top to
bottom — same git state every run, same external response every run.

## Consumers outside of tests

The scenario library doubles as a benchmark / eval input source
inside the coco monorepo — each scenario's commits are walked into
per-file diffs and fed through the parser pipeline as a deterministic
golden set:

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
