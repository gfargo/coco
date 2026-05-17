/**
 * Programmatic API for the scenario library — the one-line replacement
 * for hand-writing inline `tempGitRepo` setup in integration tests.
 *
 * Before:
 *   const repo = await createTempGitRepo()
 *   await repo.writeFile('.gitkeep', '\n')
 *   await repo.commitAll('chore: initial commit')
 *   await repo.writeFile('README.md', '# Temp repo\n')
 *   // ... 12 more lines ...
 *
 * After:
 *   const repo = await spinUpScenario('feature-pr-ready')
 *
 * The returned object is the same `TempGitRepo` shape (`path`, `git`,
 * `writeFile`, `commitAll`, `cleanup`) so tests can still poke the
 * worktree afterward for the specific edge they care about.
 *
 * EXTRACTION DISCIPLINE: this is the public programmatic API. When the
 * scenario library extracts to a standalone package, this is the entry
 * point consumers will import.
 */

import { createTempGitRepo, type TempGitRepo } from './tempGitRepo'
import { findScenario } from './scenarios'

/**
 * Spin up a temp git repo and run the named scenario's setup against
 * it. The repo is the standard `TempGitRepo` shape — caller is
 * responsible for `cleanup()` in test teardown.
 *
 * @throws if the scenario name is unknown — error message lists the
 *   available names so the typo is easy to spot.
 */
export async function spinUpScenario(name: string): Promise<TempGitRepo> {
  const scenario = findScenario(name)
  if (!scenario) {
    // Surface available names so the consumer can see the typo at a
    // glance. The list is small (currently 4 scenarios); we can prune
    // to fuzzy-match suggestions if it grows past ~20.
    const { allScenarios } = await import('./scenarios')
    const available = allScenarios.map((s) => s.name).join(', ')
    throw new Error(
      `Unknown scenario "${name}". Available: ${available}`
    )
  }

  const repo = await createTempGitRepo()
  await scenario.setup(repo)
  return repo
}
