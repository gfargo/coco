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
import { featurePrReadyScenario } from './feature-pr-ready'
import { midBisectScenario } from './mid-bisect'
import { multiCommitBranchScenario } from './multi-commit-branch'

/**
 * Ordered list of all available scenarios. The order is shown in
 * `npm run scenario list` so we group related ones together —
 * branch-y scenarios first, then worktree, then operations.
 */
export const allScenarios: readonly Scenario[] = [
  // branch shapes
  featurePrReadyScenario,
  multiCommitBranchScenario,
  // worktree shapes
  dirtyManyFilesScenario,
  // in-progress operations
  midBisectScenario,
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
export { featurePrReadyScenario } from './feature-pr-ready'
export { midBisectScenario } from './mid-bisect'
export { multiCommitBranchScenario } from './multi-commit-branch'
