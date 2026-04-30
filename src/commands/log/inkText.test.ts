import { cellWidth, truncateCells } from './inkText'

describe('log Ink text helpers', () => {
  it('measures wide and emoji characters by terminal cell width', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('変更')).toBe(4)
    expect(cellWidth('fix ✨')).toBe(6)
  })

  it('truncates without splitting wide characters past the target width', () => {
    expect(truncateCells('src/変更-summary.ts', 10)).toBe('src/変...')
    expect(cellWidth(truncateCells('emoji ✨ commit message', 12))).toBeLessThanOrEqual(12)
  })
})
