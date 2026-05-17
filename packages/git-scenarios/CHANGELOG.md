# Changelog

All notable changes to `@gfargo/git-scenarios` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semver](https://semver.org/).

## [Unreleased]

(none — staged for the v0.1.0 cut)

## [0.1.0] — Not yet published

Initial public release. Shadow-extracted from the
[`coco`](https://github.com/gfargo/coco) monorepo where it lived at
`src/lib/testUtils/` from coco v0.43.0 onward.

### Features

- **Eleven curated scenarios** covering common git states: feature
  branches (ready-to-PR, one-commit, two-commit, multi-commit), dirty
  worktrees (single staged, many files), in-progress operations
  (mid-bisect, mid-merge-conflict), stash state, multi-branch history
  graphs, and submodule history. See the README's *Available
  scenarios* table for the full list.
- **Atom layer** — composable Step factories (`(repo: TempGitRepo) =>
  Promise<void>`) for building scenarios inline or registering custom
  ones:
  - **Control flow**: `chain`, `repeat`
  - **Working tree**: `writeFiles`, `seededFiles`
  - **Staging + commits**: `stageFiles`, `commit`, `addCommit`,
    `emptyCommit`, `amendCommit` (with optional `date` pinning on
    every commit-producing atom)
  - **Branches**: `switchToBranch`, `checkoutBranch`, `createBranch`,
    `deleteBranch`
  - **Tags**: `createTag` (annotated / lightweight / on specific sha),
    `deleteTag`
  - **Remotes**: `addRemote`, `removeRemote`, `renameRemote` —
    multi-remote scenarios fully supported
  - **Stash**: `stashChanges`, `applyStash`, `popStash`, `dropStash`
  - **Operations**: `startMerge` (with `allowConflict` / `noFastForward`
    / `message` / `date`), `abortMerge`, `cherryPick`, `abortCherryPick`,
    `revert`, `startBisect`, `bisectStep`, `resetBisect`, `resetTo`
  - **Submodules**: `addSubmodule` (with `setup` as a Step), `pinSubmodule`
  - **Linked worktrees**: `addWorktree`, `removeWorktree`
  - **Config**: `setConfig` (set or unset local config keys)
  - **Scoping**: `onBranch(name, step)`, `insideSubmodule(path, step)`,
    `withAuthor({ name, email, date? }, step)`
  - **Time helpers**: `daysAgo(n)` for deterministic relative dates
  - **Validation**: `defineScenario` validates kebab-case names, kind
    enum, non-empty summary / description / contracts at module load
    time
- **CLI** (`git-scenarios`): `list` / `describe` / `create` with
  `--path`, `--run <cmd>` (tool-agnostic launcher), `--remote`, and
  `--ephemeral` flags.
- **Programmatic API**: `spinUpScenario(name)` returns a fully-built
  `TempGitRepo` for tests; `createTempGitRepo()` exposes the raw
  primitive for the rare case no scenario fits.

### Testing

100+ unit tests across the atom layer, every scenario's contract
assertions, and a generators-parity test ensuring the vendored content
generators stay byte-identical with the coco-side copy until the
duplication is resolved post-publish.

### Notes

- `peerDependencies`: `simple-git ^3.0.0`
- Node: `^22.22.2 || ^24.15.0 || >=26.0.0`
- License: MIT

[Unreleased]: https://github.com/gfargo/coco/tree/main/packages/git-scenarios
[0.1.0]: https://github.com/gfargo/coco/tree/main/packages/git-scenarios
