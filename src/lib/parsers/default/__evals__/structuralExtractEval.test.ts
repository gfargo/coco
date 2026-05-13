import type { FileDiff } from '../../../types'
import {
  renderEvalReportMarkdown,
  runStructuralExtractEval,
} from './structuralExtractEval'

function fileDiff(file: string, diff: string, tokenCount = 600): FileDiff {
  return { file, diff, summary: '', tokenCount }
}

describe('runStructuralExtractEval', () => {
  it('reports zero LLM saves when only one config is supplied', async () => {
    const diff = [
      '@@ -1,1 +1,1 @@',
      '-export function legacyParse() {}',
      '+export function parseRequest(input: string) {}',
    ].join('\n')

    const report = await runStructuralExtractEval(
      [fileDiff('src/parser.ts', diff)],
      [{ label: 'languageAware-on', fastPath: { languageAware: { enabled: true } } }],
    )

    expect(report.inputFileCount).toBe(1)
    expect(report.runs).toHaveLength(1)
    expect(report.runs[0].label).toBe('languageAware-on')
    expect(report.runs[0].llmCalls).toBe(0)
    expect(report.runs[0].files[0].outcome).toBe('languageAware')
    expect(report.deltas).toEqual([])
  })

  it('counts LLM calls in the baseline and computes saves vs an enabled config', async () => {
    const tsDiff = [
      '@@ -1,1 +1,1 @@',
      '-export function legacyParse() {}',
      '+export function parseRequest(input: string) {}',
    ].join('\n')
    const mdDiff = [
      '@@ -1,1 +1,2 @@',
      '-old paragraph copy that was here before',
      '+## New section',
      '+plenty of new prose lines making this large',
    ].join('\n')

    const diffs = [
      fileDiff('src/parser.ts', tsDiff),
      fileDiff('docs/intro.md', mdDiff),
    ]

    const report = await runStructuralExtractEval(diffs, [
      { label: 'baseline' },
      { label: 'fast-paths-on', fastPath: { markdown: true, languageAware: { enabled: true } } },
    ])

    expect(report.runs).toHaveLength(2)
    // Baseline: both files exceed the threshold and have no fast path,
    // so each fires one LLM call.
    expect(report.runs[0].llmCalls).toBe(2)
    expect(report.runs[0].files.every((f) => f.outcome === 'llm')).toBe(true)
    // Fast paths on: TS file hits the language-aware extractor;
    // markdown file hits the templated extract. Both skip the LLM.
    expect(report.runs[1].llmCalls).toBe(0)
    expect(report.runs[1].files.find((f) => f.file.endsWith('.ts'))?.outcome).toBe('languageAware')
    expect(report.runs[1].files.find((f) => f.file.endsWith('.md'))?.outcome).toBe('markdown')

    expect(report.deltas).toHaveLength(1)
    expect(report.deltas[0]).toMatchObject({
      against: 'baseline',
      label: 'fast-paths-on',
      llmCallsSaved: 2,
      fastPathHitCount: 2,
    })
    // tokenReduction is reported but intentionally NOT asserted with a
    // sign — the templated summary can be longer OR shorter than the
    // mock LLM summary depending on the input shape. The load-bearing
    // metric for #934 is `llmCallsSaved`; tokenReduction is informational.
    expect(typeof report.deltas[0].tokenReduction).toBe('number')
  })

  it('honors the languages allowlist (TS-only opt-in skips Python)', async () => {
    const tsDiff = [
      '@@ -1,1 +1,1 @@',
      '-export function legacyParse() {}',
      '+export function parseRequest(input: string) {}',
    ].join('\n')
    const pyDiff = [
      '@@ -1,1 +1,1 @@',
      '-def parse(input):',
      '+def parse(input, schema):',
    ].join('\n')

    const report = await runStructuralExtractEval(
      [fileDiff('a.ts', tsDiff), fileDiff('a.py', pyDiff)],
      [
        { label: 'baseline' },
        { label: 'ts-only', fastPath: { languageAware: { enabled: true, languages: ['ts'] } } },
      ],
    )

    expect(report.runs[1].files.find((f) => f.file === 'a.ts')?.outcome).toBe('languageAware')
    // Python falls through to the LLM because it's not in the allowlist.
    expect(report.runs[1].files.find((f) => f.file === 'a.py')?.outcome).toBe('llm')
    expect(report.deltas[0].llmCallsSaved).toBe(1)
  })

  it('throws when no configs are supplied', async () => {
    await expect(runStructuralExtractEval([fileDiff('a.ts', '+x')], [])).rejects.toThrow(
      /at least one config/i,
    )
  })
})

describe('renderEvalReportMarkdown', () => {
  it('renders a per-run totals table and a delta table when deltas exist', async () => {
    const tsDiff = [
      '@@ -1,1 +1,1 @@',
      '-export function legacyParse() {}',
      '+export function parseRequest(input: string) {}',
    ].join('\n')

    const report = await runStructuralExtractEval([fileDiff('a.ts', tsDiff)], [
      { label: 'baseline' },
      { label: 'on', fastPath: { languageAware: { enabled: true } } },
    ])

    const md = renderEvalReportMarkdown(report, 'Test eval')
    expect(md).toContain('# Test eval')
    expect(md).toContain('Input files: 1')
    expect(md).toContain('## Per-run totals')
    expect(md).toMatch(/\| baseline \|/)
    expect(md).toMatch(/\| on \|/)
    expect(md).toContain('## Deltas vs baseline')
  })

  it('omits the delta table when only one run is present', async () => {
    const tsDiff = '@@ -1,1 +1,1 @@\n-x\n+y'
    const report = await runStructuralExtractEval([fileDiff('a.ts', tsDiff)], [{ label: 'only' }])
    const md = renderEvalReportMarkdown(report, 'Single')
    expect(md).not.toContain('## Deltas vs baseline')
  })
})
