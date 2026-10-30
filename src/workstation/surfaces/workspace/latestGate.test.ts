import { createLatestGate } from './latestGate'

describe('createLatestGate (#2210)', () => {
  it('reports the only in-flight request as current', () => {
    const gate = createLatestGate()
    expect(gate.begin()()).toBe(true)
  })

  it('makes an older request stale once a newer one begins', () => {
    const gate = createLatestGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('lets an older request finishing last be dropped (overview race)', async () => {
    const gate = createLatestGate()
    const applied: string[] = []
    const load = async (label: string, ms: number) => {
      const isCurrent = gate.begin()
      await new Promise((resolve) => setTimeout(resolve, ms))
      if (isCurrent()) applied.push(label)
    }
    // "old" starts first but is slow; "new" starts second and lands first.
    await Promise.all([load('old', 30), load('new', 5)])
    expect(applied).toEqual(['new'])
  })
})
