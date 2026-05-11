# `testUtils/` — temp git repos + named scenarios

This directory hosts the test-infrastructure layer for spinning up git
repositories in known states. Two consumers:

1. **Integration tests** — `spinUpScenario('feature-pr-ready')` returns
   a `TempGitRepo` in a predictable state, so tests don't have to
   reinvent the same `writeFile / commitAll` setup boilerplate every
   time.
2. **Manual testing & demos** — `npm run scenario create <name>`
   materializes a scenario on disk for hand-testing the workstation
   (or any other git-related tool).

## Layout

```
testUtils/
├── README.md             (this file)
├── tempGitRepo.ts        (low-level: init + user config + main branch)
├── spinUpScenario.ts     (programmatic API for tests)
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

The CLI driver lives in `bin/scenario.ts` and is exposed via
`npm run scenario`.

## Available scenarios

Run `npm run scenario list` for the live list. Current set (9 scenarios across 4 kinds):

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
| `stashed-changes` | stash | clean `main` + 3 stashes (LIFO ordered, each touching a distinct file) — for the stash view |

## Programmatic API

```ts
import { spinUpScenario } from 'src/lib/testUtils/spinUpScenario'

describe('my integration test', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await spinUpScenario('feature-pr-ready')
  })

  afterAll(async () => {
    await repo.cleanup()
  })

  it('does the thing', async () => {
    // repo.path     — absolute filesystem path
    // repo.git      — simple-git instance bound to the path
    // repo.writeFile, repo.commitAll, repo.cleanup
    //
    // The scenario set up the baseline; from here add whatever
    // extra state the specific test needs.
  })
})
```

## CLI

```bash
# Show all scenarios grouped by kind
npm run scenario list

# Describe one (intent, contracts)
npm run scenario describe feature-pr-ready

# Materialize in /tmp (persisted — you clean up when done)
npm run scenario create feature-pr-ready

# Materialize at a specific path
npm run scenario create feature-pr-ready -- --path ~/sandbox/widget

# Materialize AND launch `coco ui` against it (manual testing)
npm run scenario create feature-pr-ready -- --run-ui

# Materialize + auto-clean on exit (one-shot smoke test)
npm run scenario create feature-pr-ready -- --ephemeral
```

## Adding a new scenario

1. Create `src/lib/testUtils/scenarios/<kebab-name>.ts` exporting a
   `Scenario` (see `types.ts`).
2. Add it to the registry in `src/lib/testUtils/scenarios/index.ts`.
3. Add `<kebab-name>.test.ts` next to it — at minimum, assert each
   `contract` line holds after setup. Use the existing scenario tests
   as templates.
4. The CLI picks it up automatically through the registry.

The scenarios are deliberately small (30–80 LOC each) and focus on git
state shape, not file content. File content comes from the deterministic
generators in `src/lib/parsers/default/__fixtures__/generators.ts` —
seeded so the same scenario name always produces identical content.

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
