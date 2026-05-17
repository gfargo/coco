/**
 * Public entry point for `@gfargo/git-scenarios`.
 *
 * Four concentric layers:
 *
 *   1. `spinUpScenario(name)` — the one-shot API for tests. Creates a
 *      temp repo, runs the named scenario, and returns the result.
 *      90% of test consumers want this.
 *   2. `createTempGitRepo()` — the raw primitive. A fresh git repo on
 *      disk with user identity + a `main` branch. Build whatever you
 *      need from there. For the rare case no named scenario fits.
 *   3. `allScenarios` / `findScenario` / `Scenario` / `ScenarioKind` —
 *      the registry surface. Tools that want to enumerate, describe,
 *      or filter scenarios (the CLI is one such consumer; the
 *      structural-extract eval harness is another) hit these.
 *   4. **Atom layer** (`chain`, `addCommit`, `switchToBranch`,
 *      `seededFiles`, `defineScenario`, …) — composable building
 *      blocks for assembling custom scenarios inline or registering
 *      new ones. See `./atoms` for the full set.
 *
 * Individual scenario exports are also re-exported from `./scenarios`
 * for fine-grained selection — e.g. running just `feature-pr-ready` in
 * a unit test without going through `spinUpScenario`.
 */

export { spinUpScenario } from './spinUpScenario'
export { createTempGitRepo, type TempGitRepo } from './tempGitRepo'

// Atom layer — see ./atoms/index.ts for the full catalog.
export {
  // Control flow
  chain,
  repeat,
  // Working tree
  writeFiles,
  seededFiles,
  // Staging + commits
  stageFiles,
  commit,
  addCommit,
  emptyCommit,
  amendCommit,
  // Branches
  switchToBranch,
  checkoutBranch,
  createBranch,
  deleteBranch,
  // Tags
  createTag,
  deleteTag,
  // Remotes
  addRemote,
  removeRemote,
  renameRemote,
  // Stash
  stashChanges,
  applyStash,
  popStash,
  dropStash,
  // Operations
  startMerge,
  abortMerge,
  cherryPick,
  abortCherryPick,
  revert,
  startBisect,
  bisectStep,
  resetBisect,
  resetTo,
  // Submodules
  addSubmodule,
  pinSubmodule,
  // Linked worktrees
  addWorktree,
  removeWorktree,
  // Config
  setConfig,
  // Scoping
  onBranch,
  insideSubmodule,
  withAuthor,
  // Scenarios
  defineScenario,
  // Time helpers
  daysAgo,
  // Types
  type Step,
  type FileMap,
  type SeededFileSpec,
  type AuthorIdentity,
} from './atoms'

export {
  allScenarios,
  findScenario,
  type Scenario,
  type ScenarioKind,
  // Individual scenarios — exported so consumers can opt out of the
  // registry and run just one scenario directly when that's what
  // their test wants.
  dirtyManyFilesScenario,
  featureBranchOneCommitScenario,
  featurePrReadyScenario,
  midBisectScenario,
  midMergeConflictScenario,
  multiCommitBranchScenario,
  richHistoryGraphScenario,
  singleStagedFileScenario,
  stashedChangesScenario,
  submoduleWithHistoryScenario,
  twoCommitFeatureScenario,
} from './scenarios'
