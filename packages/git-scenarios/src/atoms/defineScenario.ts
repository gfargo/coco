import type { Scenario } from '../scenarios/types'

/**
 * Identity wrapper around a `Scenario` definition. Gives the caller
 * a clean place to attach `defineScenario(...)` for symmetry with
 * `defineConfig` patterns elsewhere in the ecosystem, and gives this
 * package a single chokepoint for future validation hooks (e.g.
 * "scenario names must be kebab-case", "kind must be in the enum",
 * "name must be unique within a registry").
 *
 * Today it's a passthrough — what you pass in is what you get back.
 * Use it because it reads better and because the validation upgrade
 * later is a one-line change without touching consumers:
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
  return scenario
}
