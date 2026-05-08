import { FileDiff } from '../../../types'
import { isMarkdownFile, summarizeMarkdownDiff } from './markdownDiff'

const buildDiff = (file: string, body: string): FileDiff => ({
  file,
  diff: `diff --git a/${file} b/${file}\nindex aaa..bbb 100644\n--- a/${file}\n+++ b/${file}\n@@ -1,5 +1,8 @@\n${body}`,
  summary: '',
  tokenCount: 100,
})

describe('isMarkdownFile', () => {
  it('matches .md, .mdx, .markdown (case-insensitive)', () => {
    expect(isMarkdownFile('README.md')).toBe(true)
    expect(isMarkdownFile('docs/intro.MDX')).toBe(true)
    expect(isMarkdownFile('CHANGELOG.markdown')).toBe(true)
    expect(isMarkdownFile('src/index.ts')).toBe(false)
    expect(isMarkdownFile('src/app.tsx')).toBe(false)
    expect(isMarkdownFile('config.yaml')).toBe(false)
  })
})

describe('summarizeMarkdownDiff', () => {
  it('returns undefined for non-markdown files', () => {
    const diff = buildDiff('src/index.ts', '+const foo = 1\n-const foo = 0\n')
    expect(summarizeMarkdownDiff(diff)).toBeUndefined()
  })

  it('returns undefined for markdown diffs without heading changes', () => {
    // Paragraph-only edit — no `+##` / `-##` lines. Fall through to LLM.
    const diff = buildDiff(
      'README.md',
      ' some unchanged context\n-the old wording\n+the new wording\n+another line of new text\n'
    )
    expect(summarizeMarkdownDiff(diff)).toBeUndefined()
  })

  it('emits a templated summary when sections are added', () => {
    const diff = buildDiff(
      'docs/configuration.md',
      ' some context\n+## Authentication\n+New auth section content\n+## Rate limits\n+How rate limiting works\n'
    )
    const summary = summarizeMarkdownDiff(diff)
    expect(summary).toMatch(/^Updated markdown `docs\/configuration\.md`/)
    expect(summary).toContain('new sections: Authentication, Rate limits')
    expect(summary).toContain('+4/-0 lines')
  })

  it('emits a templated summary when sections are removed', () => {
    const diff = buildDiff(
      'docs/old.md',
      '-## Deprecated section\n-Some explanation that no longer applies\n+## Migration notes\n+How to move off it\n'
    )
    const summary = summarizeMarkdownDiff(diff)
    expect(summary).toContain('new sections: Migration notes')
    expect(summary).toContain('removed sections: Deprecated section')
    expect(summary).toContain('+2/-2 lines')
  })

  it('treats a heading appearing in both add and remove as an update', () => {
    const diff = buildDiff(
      'README.md',
      '-## Setup\n-old setup body\n+## Setup\n+new setup body\n+more new content\n'
    )
    const summary = summarizeMarkdownDiff(diff)
    expect(summary).toContain('updated sections: Setup')
    expect(summary).not.toContain('new sections: Setup')
    expect(summary).not.toContain('removed sections: Setup')
  })

  it('truncates long heading lists with a remainder count', () => {
    const additions = Array.from({ length: 9 }, (_, i) => `+## Section ${i + 1}`).join('\n')
    const diff = buildDiff('docs/big.md', `${additions}\n`)
    const summary = summarizeMarkdownDiff(diff)
    expect(summary).toMatch(/Section 1, Section 2, Section 3, Section 4, Section 5, Section 6 \(\+3 more\)/)
  })

  it('counts heading levels h1-h6 but ignores arbitrary `#` strings inside text', () => {
    const diff = buildDiff(
      'docs/levels.md',
      '+# Top\n+## Sub\n+### Sub-sub\n+###### Deepest\n+a sentence with #hashtag in the middle\n'
    )
    const summary = summarizeMarkdownDiff(diff)
    // All 4 heading lines should be picked up; the inline #hashtag should NOT.
    expect(summary).toContain('new sections: Top, Sub, Sub-sub, Deepest')
  })

  it('returns undefined when the diff has no content changes (only context)', () => {
    const diff = buildDiff('docs/empty.md', ' some context line only\n some more context\n')
    expect(summarizeMarkdownDiff(diff)).toBeUndefined()
  })
})
