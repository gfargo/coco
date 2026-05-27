import { getRenderNow, isSnapshotMode } from './snapshotMode'

describe('snapshotMode', () => {
  // Each test sets/clears its own env to avoid bleeding state into the
  // next case. Console warnings are captured so the bad-input case
  // doesn't pollute test output.
  const originalEnv = process.env.COCO_SNAPSHOT_NOW

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.COCO_SNAPSHOT_NOW
    } else {
      process.env.COCO_SNAPSHOT_NOW = originalEnv
    }
  })

  describe('getRenderNow', () => {
    it('returns a fresh Date when COCO_SNAPSHOT_NOW is unset', () => {
      delete process.env.COCO_SNAPSHOT_NOW
      const before = Date.now()
      const result = getRenderNow()
      const after = Date.now()
      expect(result.getTime()).toBeGreaterThanOrEqual(before)
      expect(result.getTime()).toBeLessThanOrEqual(after + 1)
    })

    it('returns the pinned date when COCO_SNAPSHOT_NOW is a parseable ISO string', () => {
      process.env.COCO_SNAPSHOT_NOW = '2026-05-27T12:00:00.000Z'
      const result = getRenderNow()
      expect(result.toISOString()).toBe('2026-05-27T12:00:00.000Z')
    })

    it('returns the same pinned value across consecutive calls (no drift)', () => {
      process.env.COCO_SNAPSHOT_NOW = '2026-01-01T00:00:00.000Z'
      const a = getRenderNow()
      const b = getRenderNow()
      expect(a.toISOString()).toBe(b.toISOString())
    })

    it('falls back to live wall clock and warns when the env value is unparseable', () => {
      process.env.COCO_SNAPSHOT_NOW = 'not a date'
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const before = Date.now()
        const result = getRenderNow()
        const after = Date.now()
        expect(result.getTime()).toBeGreaterThanOrEqual(before)
        expect(result.getTime()).toBeLessThanOrEqual(after + 1)
        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy.mock.calls[0][0]).toContain('COCO_SNAPSHOT_NOW')
      } finally {
        warnSpy.mockRestore()
      }
    })
  })

  describe('isSnapshotMode', () => {
    it('returns false when COCO_SNAPSHOT_NOW is unset', () => {
      delete process.env.COCO_SNAPSHOT_NOW
      expect(isSnapshotMode()).toBe(false)
    })

    it('returns true when COCO_SNAPSHOT_NOW is set (regardless of validity)', () => {
      process.env.COCO_SNAPSHOT_NOW = '2026-05-27T12:00:00Z'
      expect(isSnapshotMode()).toBe(true)
      // Even an invalid value still counts as "snapshot mode requested"
      // — callers may use this to disable other animations even if
      // the date itself failed to parse.
      process.env.COCO_SNAPSHOT_NOW = 'whatever'
      expect(isSnapshotMode()).toBe(true)
    })
  })
})
