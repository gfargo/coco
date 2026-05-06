import {
  generateContentForFile,
  generateJson,
  generateMarkdown,
  generatePython,
  generateTypeScript,
  generateYaml,
  seededRng,
} from './generators'

describe('bench fixture generators (#845)', () => {
  describe('seededRng', () => {
    it('produces identical sequences for the same seed', () => {
      const a = seededRng(12345)
      const b = seededRng(12345)
      const aValues = Array.from({ length: 10 }, () => a())
      const bValues = Array.from({ length: 10 }, () => b())
      expect(aValues).toEqual(bValues)
    })

    it('produces different sequences for different seeds', () => {
      const a = seededRng(1)
      const b = seededRng(2)
      const aValues = Array.from({ length: 10 }, () => a())
      const bValues = Array.from({ length: 10 }, () => b())
      expect(aValues).not.toEqual(bValues)
    })
  })

  describe('per-language generators', () => {
    const cases = [
      { name: 'TypeScript', generate: generateTypeScript, mustContain: ['import', 'export'] },
      { name: 'Python', generate: generatePython, mustContain: ['def ', 'import'] },
      { name: 'Markdown', generate: generateMarkdown, mustContain: ['#'] },
      { name: 'JSON', generate: generateJson, mustContain: ['{', '}', ':'] },
      { name: 'YAML', generate: generateYaml, mustContain: ['name:', 'jobs:'] },
    ]

    it.each(cases)('$name output is deterministic and contains expected markers', ({ generate, mustContain }) => {
      const a = generate(500, 42)
      const b = generate(500, 42)
      expect(a).toBe(b)
      mustContain.forEach((token) => expect(a).toContain(token))
    })

    it.each(cases)('$name output scales roughly with the requested token target', ({ generate }) => {
      const small = generate(100, 7)
      const large = generate(2000, 7)
      // The generators target chars/4, so large should be ~20x small.
      // Loose lower bound: at least 5x bigger to confirm scaling works.
      expect(large.length).toBeGreaterThan(small.length * 5)
    })
  })

  describe('generateContentForFile dispatcher', () => {
    it('routes by extension', () => {
      expect(generateContentForFile('foo.ts', 200, 1)).toContain('import')
      expect(generateContentForFile('foo.py', 200, 1)).toContain('def ')
      expect(generateContentForFile('foo.md', 200, 1)).toContain('#')
      expect(generateContentForFile('foo.json', 200, 1)).toContain('{')
      expect(generateContentForFile('foo.yml', 200, 1)).toContain('jobs:')
    })

    it('falls back to TypeScript for unknown extensions', () => {
      const out = generateContentForFile('foo.unknown', 200, 1)
      expect(out).toContain('import')
    })
  })
})
