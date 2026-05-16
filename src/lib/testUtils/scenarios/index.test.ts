import { allScenarios, findScenario } from './index'

describe('scenarios registry', () => {
  it('exposes a non-empty list of scenarios', () => {
    expect(allScenarios.length).toBeGreaterThan(0)
  })

  it('has unique scenario names', () => {
    const names = allScenarios.map((s) => s.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('uses kebab-case names', () => {
    for (const scenario of allScenarios) {
      expect(scenario.name).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it('every scenario has a non-empty summary and description', () => {
    for (const scenario of allScenarios) {
      expect(scenario.summary.trim()).not.toBe('')
      expect(scenario.description.trim()).not.toBe('')
    }
  })

  it('every scenario declares a valid kind', () => {
    const validKinds = new Set(['branch', 'worktree', 'operation', 'history', 'stash', 'submodule'])
    for (const scenario of allScenarios) {
      expect(validKinds.has(scenario.kind)).toBe(true)
    }
  })

  describe('findScenario', () => {
    it('returns the scenario for a known name', () => {
      const result = findScenario('feature-pr-ready')
      expect(result).toBeDefined()
      expect(result?.name).toBe('feature-pr-ready')
    })

    it('returns undefined for an unknown name', () => {
      expect(findScenario('does-not-exist')).toBeUndefined()
    })
  })
})
