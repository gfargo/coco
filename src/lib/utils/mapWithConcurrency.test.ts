import { mapWithConcurrency } from './mapWithConcurrency'

describe('mapWithConcurrency', () => {
  it('runs every input through fn and preserves order', async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10)
    expect(result).toEqual([10, 20, 30, 40, 50])
  })

  it('respects the concurrency limit', async () => {
    let active = 0
    let peak = 0
    const inputs = Array.from({ length: 12 }, (_, i) => i)
    await mapWithConcurrency(inputs, 3, async (n) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return n
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('handles empty input without spawning workers', async () => {
    const fn = jest.fn()
    const result = await mapWithConcurrency<number, number>([], 4, fn)
    expect(result).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('propagates rejections from any worker', async () => {
    const fn = async (n: number) => {
      if (n === 2) throw new Error('boom')
      return n
    }
    await expect(mapWithConcurrency([1, 2, 3], 2, fn)).rejects.toThrow('boom')
  })

  it('clamps the worker pool when limit > inputs.length', async () => {
    const result = await mapWithConcurrency([1, 2], 100, async (n) => n)
    expect(result).toEqual([1, 2])
  })
})
