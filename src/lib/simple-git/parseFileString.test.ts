import { parseFileString } from './parseFileString'

describe('parseFileString', () => {
  describe('simple paths (no rename)', () => {
    it('returns the trimmed path as filePath', () => {
      expect(parseFileString('src/index.ts')).toEqual({
        filePath: 'src/index.ts',
        oldFilePath: undefined,
      })
    })

    it('trims leading/trailing whitespace', () => {
      expect(parseFileString('  src/index.ts  ')).toEqual({
        filePath: 'src/index.ts',
        oldFilePath: undefined,
      })
    })

    it('handles a file at the root level', () => {
      expect(parseFileString('README.md')).toEqual({
        filePath: 'README.md',
        oldFilePath: undefined,
      })
    })

    it('handles deeply nested paths', () => {
      expect(parseFileString('a/b/c/d/file.ts')).toEqual({
        filePath: 'a/b/c/d/file.ts',
        oldFilePath: undefined,
      })
    })
  })

  describe('rename paths (contains " => ")', () => {
    it('parses a simple rename at root level', () => {
      // git diff --stat format: "src/{old.ts => new.ts}"
      const result = parseFileString('src/{old.ts => new.ts}')
      expect(result.filePath).toBe('src/new.ts')
      expect(result.oldFilePath).toBe('src/old.ts')
    })

    it('parses a rename with a shared root prefix', () => {
      const result = parseFileString('src/lib/{utils.ts => helpers.ts}')
      expect(result.filePath).toBe('src/lib/helpers.ts')
      expect(result.oldFilePath).toBe('src/lib/utils.ts')
    })

    it('parses a rename where the directory changes', () => {
      const result = parseFileString('src/{old/file.ts => new/file.ts}')
      expect(result.filePath).toBe('src/new/file.ts')
      expect(result.oldFilePath).toBe('src/old/file.ts')
    })
  })

  describe('edge cases', () => {
    it('handles a path that is just whitespace after trim', () => {
      expect(parseFileString('   ')).toEqual({
        filePath: '',
        oldFilePath: undefined,
      })
    })

    it('does not treat a path containing "=>" (no spaces) as a rename', () => {
      // Only " => " (with spaces) is the separator
      const result = parseFileString('src/a=>b.ts')
      expect(result.filePath).toBe('src/a=>b.ts')
      expect(result.oldFilePath).toBeUndefined()
    })
  })
})
