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

    it('parses a rename with a shared suffix after the braces (mid-path compressed form)', () => {
      // git diff --stat format when a file moves between sibling directories
      // but keeps its name: "src/{old => new}/file.ts"
      const result = parseFileString('src/{old => new}/file.ts')
      expect(result.filePath).toBe('src/new/file.ts')
      expect(result.oldFilePath).toBe('src/old/file.ts')
    })

    it('parses a rename where one side of the brace is empty, normalizing doubled slashes', () => {
      const result = parseFileString('src/{ => sub}/file.ts')
      expect(result.filePath).toBe('src/sub/file.ts')
      expect(result.oldFilePath).toBe('src/file.ts')
    })
  })

  describe('rename paths without braces (no common prefix)', () => {
    it('parses a root-level rename', () => {
      // git diff --stat format when there's no common path prefix: "old.txt => new.txt"
      const result = parseFileString('old.txt => new.txt')
      expect(result.filePath).toBe('new.txt')
      expect(result.oldFilePath).toBe('old.txt')
    })

    it('parses a rename across different directories', () => {
      const result = parseFileString('dir/a.txt => other/b.txt')
      expect(result.filePath).toBe('other/b.txt')
      expect(result.oldFilePath).toBe('dir/a.txt')
    })

    it('trims extra whitespace around the paths', () => {
      const result = parseFileString('a.txt =>  b.txt ')
      expect(result.filePath).toBe('b.txt')
      expect(result.oldFilePath).toBe('a.txt')
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
