import { getStatus } from './getStatus'
import { FileStatusResult } from 'simple-git'

describe('getStatus', () => {
  describe('FileStatusResult (index / working_dir)', () => {
    const file: FileStatusResult = { path: 'file.txt', index: 'A', working_dir: 'M' }

    it('returns added for index "A"', () => {
      expect(getStatus({ ...file, index: 'A' })).toBe('added')
    })

    it('returns deleted for index "D"', () => {
      expect(getStatus({ ...file, index: 'D' })).toBe('deleted')
    })

    it('returns modified for index "M"', () => {
      expect(getStatus({ ...file, index: 'M' })).toBe('modified')
    })

    it('returns renamed for index "R"', () => {
      expect(getStatus({ ...file, index: 'R' })).toBe('renamed')
    })

    it('returns untracked for index "?"', () => {
      expect(getStatus({ ...file, index: '?' })).toBe('untracked')
    })

    it('returns unknown for unrecognised index code', () => {
      expect(getStatus({ ...file, index: 'Z' })).toBe('unknown')
    })

    it('reads from working_dir when location is specified', () => {
      expect(getStatus({ ...file, working_dir: 'M' }, 'working_dir')).toBe('modified')
      expect(getStatus({ ...file, working_dir: 'D' }, 'working_dir')).toBe('deleted')
    })
  })

  describe('DiffResultTextFile / DiffResultBinaryFile (changes / binary)', () => {
    const textFile = { file: 'file.ts', binary: false as const, changes: 5, insertions: 3, deletions: 2 }
    const binaryFile = { file: 'image.png', binary: true as const, changes: 1, insertions: 0, deletions: 0 }

    it('returns added when only insertions', () => {
      expect(getStatus({ ...textFile, insertions: 5, deletions: 0 })).toBe('added')
    })

    it('returns deleted when only deletions', () => {
      expect(getStatus({ ...textFile, insertions: 0, deletions: 5 })).toBe('deleted')
    })

    it('returns modified when both insertions and deletions', () => {
      expect(getStatus({ ...textFile, insertions: 3, deletions: 2 })).toBe('modified')
    })

    it('returns modified when changes > 0 with zero insertions and deletions', () => {
      expect(getStatus({ ...textFile, insertions: 0, deletions: 0, changes: 1 })).toBe('modified')
    })

    it('returns untracked when changes === 0', () => {
      expect(getStatus({ ...textFile, changes: 0, insertions: 0, deletions: 0 })).toBe('untracked')
    })

    it('returns renamed when file path contains "=>"', () => {
      expect(getStatus({ ...textFile, file: 'src/{old.ts => new.ts}', changes: 3 })).toBe('renamed')
    })

    it('returns untracked for a binary file with no changes', () => {
      const binaryNoChange = { file: 'image.png', binary: true as const, before: 0, after: 0 }
      expect(getStatus(binaryNoChange)).toBe('untracked')
    })

    it('returns added for a new binary file', () => {
      const binaryAdded = { file: 'image.png', binary: true as const, before: 0, after: 1024 }
      expect(getStatus(binaryAdded)).toBe('added')
    })

    it('returns deleted for a removed binary file', () => {
      const binaryDeleted = { file: 'image.png', binary: true as const, before: 1024, after: 0 }
      expect(getStatus(binaryDeleted)).toBe('deleted')
    })

    it('returns modified for a changed binary file', () => {
      const binaryModified = { file: 'image.png', binary: true as const, before: 512, after: 1024 }
      expect(getStatus(binaryModified)).toBe('modified')
    })

    it('returns renamed for a binary file with "=>" in path', () => {
      const binaryRenamed = { file: 'assets/{old.png => new.png}', binary: true as const, before: 512, after: 512 }
      expect(getStatus(binaryRenamed)).toBe('renamed')
    })
  })

  describe('invalid file type', () => {
    it('throws for an object that matches neither shape', () => {
      expect(() => getStatus({} as never)).toThrow('Invalid file type')
    })
  })
})
