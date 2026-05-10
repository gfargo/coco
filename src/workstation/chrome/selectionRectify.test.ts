import { rectifyPromotedSelectionIndex } from './selectionRectify'

describe('log Ink selection rectification (P4.5)', () => {
  describe('rectifyPromotedSelectionIndex', () => {
    it('preserves the cursor when the selected key is still in the filtered list', () => {
      const filtered = ['feat/alpha', 'feat/widget', 'main']
      expect(rectifyPromotedSelectionIndex(filtered, 'feat/widget')).toBe(1)
    })

    it('snaps to result[0] when the selected key dropped out', () => {
      const filtered = ['feat/alpha', 'main']
      expect(rectifyPromotedSelectionIndex(filtered, 'feat/widget')).toBe(0)
    })

    it('returns 0 when the filtered list is empty', () => {
      expect(rectifyPromotedSelectionIndex([], 'anything')).toBe(0)
      expect(rectifyPromotedSelectionIndex([], undefined)).toBe(0)
    })

    it('returns 0 when no previous selection key was provided', () => {
      expect(rectifyPromotedSelectionIndex(['a', 'b'], undefined)).toBe(0)
    })

    it('handles a single-item result set', () => {
      expect(rectifyPromotedSelectionIndex(['feat/widget'], 'feat/widget')).toBe(0)
      expect(rectifyPromotedSelectionIndex(['feat/widget'], 'main')).toBe(0)
    })
  })
})
