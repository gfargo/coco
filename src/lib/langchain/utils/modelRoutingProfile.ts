import { Config } from '../../../commands/types'
import { DynamicModelTask } from '../types'
import { DYNAMIC_MODEL_TASKS, resolveDynamicModel } from './dynamicModels'

/** One row of the per-task model routing profile. */
export type ModelRoutingRow = {
  task: DynamicModelTask
  model: string
}

export type ModelRoutingProfile = {
  /** True when `service.model === 'dynamic'` (per-task routing active). */
  dynamic: boolean
  /** Active dynamic-model preference (only meaningful when `dynamic`). */
  preference: string
  provider: string
  rows: ModelRoutingRow[]
}

/**
 * Build the "which model runs which task" cost profile from config — the
 * resolved model for each of the dynamic-model task labels. When dynamic
 * routing is off, every task resolves to the single configured model; when it's
 * on, the active preference (cost / balanced / quality) plus any per-task
 * overrides decide each row. Pure (no I/O); drives the `coco doctor` cost report.
 */
export function buildModelRoutingProfile(config: Config): ModelRoutingProfile {
  const service = config.service
  const dynamic = service?.model === 'dynamic'
  const preference = service?.dynamicModelPreference || 'balanced'

  const rows: ModelRoutingRow[] = DYNAMIC_MODEL_TASKS.map((task) => {
    let model: string
    try {
      model = String(resolveDynamicModel(config, task))
    } catch {
      // Resolution can throw on a malformed dynamic-model profile; fall back to
      // the raw configured model so the report still renders.
      model = String(service?.model ?? 'unknown')
    }
    return { task, model }
  })

  return {
    dynamic,
    preference,
    provider: service?.provider || 'unknown',
    rows,
  }
}
