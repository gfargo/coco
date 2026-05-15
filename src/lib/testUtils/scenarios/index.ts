/**
 * Scenario registry for `src/lib/testUtils/scenarios/`.
 *
 * Each named scenario produces a deterministic git-repo state useful
 * for testing the workstation, integration tests, and manual demos.
 * See `src/lib/testUtils/README.md` for the boundary rules and the
 * extraction plan to a standalone `git-scenarios` package.
 *
 * EXTRACTION DISCIPLINE: this file is the public surface. The registry
 * is the only thing consumers should depend on; individual scenario
 * modules can be re-shaped without breaking the API.
 */

import type { Scenario } from './types'
import { dirtyManyFilesScenario } from './dirty-many-files'
import { featureBranchOneCommitScenario } from './feature-branch-one-commit'
import { featurePrReadyScenario } from './feature-pr-ready'
import { midBisectScenario } from './mid-bisect'
import { midMergeConflictScenario } from './mid-merge-conflict'
import { multiCommitBranchScenario } from './multi-commit-branch'
import { richHistoryGraphScenario } from './rich-history-graph'
import { singleStagedFileScenario } from './single-staged-file'
import { stashedChangesScenario } from './stashed-changes'
import { twoCommitFeatureScenario } from './two-commit-feature'

/**
 * Ordered list of all available scenarios. The order is shown in
 * `npm run scenario list` so we group related ones together —
 * branch-y scenarios first, then worktree, then operations, then stash.
 */
export const allScenarios: readonly Scenario[] = [
  // branch shapes
  featurePrReadyScenario,
  featureBranchOneCommitScenario,
  multiCommitBranchScenario,
  twoCommitFeatureScenario,
  // worktree shapes
  singleStagedFileScenario,
  dirtyManyFilesScenario,
  // in-progress operations
  midBisectScenario,
  midMergeConflictScenario,
  // history shapes
  richHistoryGraphScenario,
  // stash shapes
  stashedChangesScenario,
]

/**
 * Lookup helper. Returns undefined for an unknown name so callers can
 * surface a helpful error (CLI prints the list; programmatic API
 * throws with a suggestion).
 */
export function findScenario(name: string): Scenario | undefined {
  return allScenarios.find((s) => s.name === name)
}

export type { Scenario, ScenarioKind } from './types'
export { dirtyManyFilesScenario } from './dirty-many-files'
export { featureBranchOneCommitScenario } from './feature-branch-one-commit'
export { featurePrReadyScenario } from './feature-pr-ready'
export { midBisectScenario } from './mid-bisect'
export { midMergeConflictScenario } from './mid-merge-conflict'
export { multiCommitBranchScenario } from './multi-commit-branch'
export { richHistoryGraphScenario } from './rich-history-graph'
export { singleStagedFileScenario } from './single-staged-file'
export { stashedChangesScenario } from './stashed-changes'
export { twoCommitFeatureScenario } from './two-commit-feature'
