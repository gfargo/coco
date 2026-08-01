import { createConcurrencyLimit } from './createConcurrencyLimit'

describe('createConcurrencyLimit', () => {
  it('caps concurrency at the configured limit', async () => {
    const limit = createConcurrencyLimit(2)
    let active = 0
    let maxActive = 0

    const task = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
    }

    await Promise.all(Array.from({ length: 5 }, () => limit(task)))

    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('resolves with the operation result and propagates rejections', async () => {
    const limit = createConcurrencyLimit(2)

    await expect(limit(async () => 'ok')).resolves.toBe('ok')
    await expect(
      limit(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
  })

  it('never exceeds the limit when work is submitted incrementally', async () => {
    const limit = createConcurrencyLimit(2)
    let active = 0
    let maxActive = 0

    const task = async (ms: number) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, ms))
      active--
    }

    const initial = [limit(() => task(10)), limit(() => task(10))]

    // Submitted after the limiter is already saturated, mid-flight — this
    // is the scenario the old hand-rolled semaphore's `if (active >= limit)`
    // check (checked once, never re-checked after a waiter woke) allowed
    // through as an over-admission.
    await new Promise((resolve) => setTimeout(resolve, 1))
    const late = limit(() => task(5))

    await Promise.all([...initial, late])

    expect(maxActive).toBeLessThanOrEqual(2)
  })
})
