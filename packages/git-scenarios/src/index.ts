/**
 * Public entry point for `@gfargo/git-scenarios`.
 *
 * Three concentric layers:
 *
 *   1. `spinUpScenario(name)` — the one-shot API for tests. Creates a
 *      temp repo, runs the named scenario, and returns the result.
 *      99% of test consumers want this.
 *   2. `createTempGitRepo()` — the raw primitive. A fresh git repo on
 *      disk with user identity + a `main` branch. Build whatever you
 *      need from there. For the rare case no named scenario fits.
 *   3. `allScenarios` / `findScenario` / `Scenario` / `ScenarioKind` —
 *      the registry surface. Tools that want to enumerate, describe,
 *      or filter scenarios (the CLI is one such consumer; the
 *      structural-extract eval harness is another) hit these.
 *
 * Individual scenario exports are also re-exported from `./scenarios`
 * for fine-grained selection — e.g. running just `feature-pr-ready` in
 * a unit test without going through `spinUpScenario`.
 */

export { spinUpScenario } from './spinUpScenario'
export { createTempGitRepo, type TempGitRepo } from './tempGitRepo'

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
