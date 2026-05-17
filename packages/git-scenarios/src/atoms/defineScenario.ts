import type { Scenario, ScenarioKind } from '../scenarios/types'

const VALID_KINDS: readonly ScenarioKind[] = [
  'branch',
  'worktree',
  'operation',
  'history',
  'stash',
  'submodule',
]

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

/**
 * Wrapper around a `Scenario` definition that validates the shape at
 * load time. Catches the kinds of mistakes that would otherwise slip
 * through until a CLI run or test failure:
 *
 *   - non-kebab-case names (`mid_bisect` instead of `mid-bisect`)
 *   - unknown kinds (typo'd `'branche'` instead of `'branch'`)
 *   - empty summary / description / setup
 *   - contracts that are empty strings
 *
 * Throws synchronously at module load time, so a broken scenario fails
 * fast rather than mysteriously misbehaving inside a test fixture.
 *
 *   export const myScenario = defineScenario({
 *     name: 'my-scenario',
 *     summary: '…',
 *     description: '…',
 *     kind: 'branch',
 *     setup: chain(…),
 *     contracts: ['…'],
 *   })
 */
export function defineScenario(scenario: Scenario): Scenario {
  if (!scenario.name || !KEBAB_CASE.test(scenario.name)) {
    throw new Error(
      `defineScenario: name must be kebab-case (got ${JSON.stringify(scenario.name)})`,
    )
  }
  if (!VALID_KINDS.includes(scenario.kind)) {
    throw new Error(
      `defineScenario: kind must be one of ${VALID_KINDS.join(' | ')} (got ${JSON.stringify(scenario.kind)} for "${scenario.name}")`,
    )
  }
  if (!scenario.summary || scenario.summary.trim().length === 0) {
    throw new Error(`defineScenario: summary is required (scenario "${scenario.name}")`)
  }
  if (!scenario.description || scenario.description.trim().length === 0) {
    throw new Error(`defineScenario: description is required (scenario "${scenario.name}")`)
  }
  if (typeof scenario.setup !== 'function') {
    throw new Error(`defineScenario: setup must be a function (scenario "${scenario.name}")`)
  }
  if (scenario.contracts) {
    for (const [i, contract] of scenario.contracts.entries()) {
      if (typeof contract !== 'string' || contract.trim().length === 0) {
        throw new Error(
          `defineScenario: contracts[${i}] must be a non-empty string (scenario "${scenario.name}")`,
        )
      }
    }
  }
  return scenario
}
