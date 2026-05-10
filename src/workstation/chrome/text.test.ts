import { cellWidth, truncateCells, wrapCells } from './text'

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

  describe('wrapCells', () => {
    it('returns the input unchanged when it already fits', () => {
      expect(wrapCells('short', 20)).toEqual(['short'])
      expect(wrapCells('', 20)).toEqual([''])
    })

    it('breaks on whitespace when possible', () => {
      const lines = wrapCells('Add a blank line for improved readability and overall flow', 20)
      expect(lines.every((line) => cellWidth(line) <= 20)).toBe(true)
      // Word boundaries preserved — no word should be split across two lines.
      expect(lines.join(' ').replace(/\s+/g, ' ')).toBe(
        'Add a blank line for improved readability and overall flow'
      )
    })

    it('hard-splits a single word longer than the budget', () => {
      const lines = wrapCells('supercalifragilisticexpialidocious', 10)
      expect(lines.length).toBeGreaterThan(1)
      expect(lines.every((line) => cellWidth(line) <= 10)).toBe(true)
      expect(lines.join('')).toBe('supercalifragilisticexpialidocious')
    })

    it('respects wide-character cell counts', () => {
      const lines = wrapCells('変更 を加える branch', 6)
      expect(lines.every((line) => cellWidth(line) <= 6)).toBe(true)
    })
  })
})
