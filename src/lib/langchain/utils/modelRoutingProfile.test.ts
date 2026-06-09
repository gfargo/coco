import { Config } from '../../../commands/types'
import { DYNAMIC_MODEL_TASKS } from './dynamicModels'
import { buildModelRoutingProfile } from './modelRoutingProfile'

function config(service: Record<string, unknown>): Config {
  return {
    service: {
      authentication: { type: 'APIKey', credentials: { apiKey: 'k' } },
      maxConcurrent: 1,
      ...service,
    },
  } as unknown as Config
}

describe('buildModelRoutingProfile', () => {
  it('maps every dynamic-model task to the single configured model when routing is off', () => {
    const profile = buildModelRoutingProfile(config({ provider: 'openai', model: 'gpt-4o' }))
    expect(profile.dynamic).toBe(false)
    expect(profile.rows).toHaveLength(DYNAMIC_MODEL_TASKS.length)
    expect(profile.rows.every((r) => r.model === 'gpt-4o')).toBe(true)
  })

  it('resolves per-task models for the active preference when routing is dynamic', () => {
    const profile = buildModelRoutingProfile(
      config({ provider: 'openai', model: 'dynamic', dynamicModelPreference: 'cost' })
    )
    expect(profile.dynamic).toBe(true)
    expect(profile.preference).toBe('cost')
    // cost preference picks the cheap tier for summarize
    const summarize = profile.rows.find((r) => r.task === 'summarize')
    expect(summarize?.model).toBeTruthy()
    // commitSplit floors at a higher tier than summarize under cost
    const split = profile.rows.find((r) => r.task === 'commitSplit')
    expect(split?.model).not.toBe(summarize?.model)
  })

  it('honors per-task dynamicModels overrides', () => {
    const profile = buildModelRoutingProfile(
      config({
        provider: 'openai',
        model: 'dynamic',
        dynamicModelPreference: 'balanced',
        dynamicModels: { review: 'gpt-4.1' },
      })
    )
    expect(profile.rows.find((r) => r.task === 'review')?.model).toBe('gpt-4.1')
  })
})
