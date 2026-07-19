import { generateChangelogResult } from '../commands/changelog/handler'
import { CommandExitError } from '../lib/utils/commandExit'
import {
  aiActionTestInternals,
  runChangelogTextWorkflow,
  runPullRequestBodyWorkflow,
} from './aiActions'

jest.mock('../commands/changelog/handler', () => ({
  generateChangelogResult: jest.fn(),
}))

const mockedGenerateChangelogResult = generateChangelogResult as jest.MockedFunction<typeof generateChangelogResult>

describe('log AI actions', () => {
  beforeEach(() => {
    mockedGenerateChangelogResult.mockReset()
  })

  it('extracts telemetry while keeping generated text editable', () => {
    expect(aiActionTestInternals.formatCapturedAiOutput([
      '[llm] task=changelog command=changelog',
      'Generated title',
      'Generated body',
      '[llm:summary] command=changelog calls=1 promptTokens=123',
    ].join('\n'))).toEqual({
      message: 'Generated title',
      details: ['[llm:summary] command=changelog calls=1 promptTokens=123'],
      editable: 'Generated title\nGenerated body',
    })
  })

  describe('runPullRequestBodyWorkflow', () => {
    it('runs the changelog against the base branch and splits title from body', async () => {
      mockedGenerateChangelogResult.mockResolvedValue({
        text: [
          'feat: workstation refactor',
          '',
          '- promote git data layer to src/git/',
          '- promote workstation chrome to src/workstation/',
          '- split inkRuntime into per-surface modules',
        ].join('\n'),
        structured: undefined,
      })

      await expect(runPullRequestBodyWorkflow({ baseBranch: 'main' })).resolves.toEqual({
        ok: true,
        message: 'feat: workstation refactor',
        details: [],
        editable: [
          'feat: workstation refactor',
          '',
          '- promote git data layer to src/git/',
          '- promote workstation chrome to src/workstation/',
          '- split inkRuntime into per-surface modules',
        ].join('\n'),
        title: 'feat: workstation refactor',
        body: [
          '- promote git data layer to src/git/',
          '- promote workstation chrome to src/workstation/',
          '- split inkRuntime into per-surface modules',
        ].join('\n'),
      })

      // The core was called with the base branch on the argv. Other
      // changelog options stay at their defaults from createChangelogArgv.
      const argv = mockedGenerateChangelogResult.mock.calls[0][0]
      expect(argv).toMatchObject({ branch: 'main', mode: 'stdout' })
    })

    it('defaults the base branch to "main" when none is supplied', async () => {
      mockedGenerateChangelogResult.mockResolvedValue({
        text: 'feat: x\n\nBody.',
        structured: undefined,
      })

      await runPullRequestBodyWorkflow()

      const argv = mockedGenerateChangelogResult.mock.calls[0][0]
      expect(argv.branch).toBe('main')
    })

    it('falls back to a single-line title when the changelog has no body', async () => {
      mockedGenerateChangelogResult.mockResolvedValue({
        text: 'feat: tiny one-liner',
        structured: undefined,
      })

      const result = await runPullRequestBodyWorkflow({ baseBranch: 'develop' })

      expect(result.ok).toBe(true)
      expect(result.title).toBe('feat: tiny one-liner')
      expect(result.body).toBe('')
    })

    it('propagates changelog failures without producing a title/body pair', async () => {
      mockedGenerateChangelogResult.mockRejectedValue(new Error('no commits in range'))

      const result = await runPullRequestBodyWorkflow({ baseBranch: 'main' })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('no commits in range')
      // Title / body fields are absent on failure — the caller is expected
      // to open the prompt with empty fields and let the user author by
      // hand.
      expect(result.title).toBeUndefined()
      expect(result.body).toBeUndefined()
    })

    it('renders a human message instead of the generic sentinel text for a clean CommandExitError(0) (#1604)', async () => {
      // changelog's noResult path throws this sentinel (default message
      // "Command exited with code 0") when the branch has no commits ahead
      // of base — relaying it verbatim used to render as a confusing red
      // error instead of an explanation.
      mockedGenerateChangelogResult.mockRejectedValue(new CommandExitError(0))

      const result = await runPullRequestBodyWorkflow({ baseBranch: 'main' })

      expect(result.ok).toBe(false)
      expect(result.message).not.toContain('Command exited with code')
      expect(result.message).toContain('no commits ahead of base')
    })

    it('still propagates the real error message for a non-zero-code CommandExitError', async () => {
      mockedGenerateChangelogResult.mockRejectedValue(new CommandExitError(1, 'a genuine failure'))

      const result = await runPullRequestBodyWorkflow({ baseBranch: 'main' })

      expect(result.ok).toBe(false)
      expect(result.message).toBe('a genuine failure')
    })

    it('does not monkey-patch process.stdout.write during generation', async () => {
      const originalWrite = process.stdout.write
      mockedGenerateChangelogResult.mockResolvedValue({
        text: 'feat: no stdout pollution\n\nBody.',
        structured: undefined,
      })

      await runPullRequestBodyWorkflow({ baseBranch: 'main' })

      // The global stdout write function must be the same reference
      // after the call — no patching should have occurred.
      expect(process.stdout.write).toBe(originalWrite)
    })
  })

  describe('runChangelogTextWorkflow', () => {
    it('returns the raw changelog output with blank lines + section structure intact', async () => {
      mockedGenerateChangelogResult.mockResolvedValue({
        text: [
          'feat: workstation v0.49.0',
          '',
          '## Highlights',
          '',
          '- create-pr now seeds the body from coco changelog',
          '- new `L` keystroke generates a changelog for the current branch',
        ].join('\n'),
        structured: undefined,
      })

      const result = await runChangelogTextWorkflow({ branch: 'main' })

      expect(result.ok).toBe(true)
      // The text field preserves blank lines — UI surfaces want the full prose.
      expect(result.text).toBe([
        'feat: workstation v0.49.0',
        '',
        '## Highlights',
        '',
        '- create-pr now seeds the body from coco changelog',
        '- new `L` keystroke generates a changelog for the current branch',
      ].join('\n'))
      expect(result.message).toBe('feat: workstation v0.49.0')

      const argv = mockedGenerateChangelogResult.mock.calls[0][0]
      expect(argv).toMatchObject({ branch: 'main', mode: 'stdout' })
    })

    it('skips leading blank lines when computing the first-line message', async () => {
      mockedGenerateChangelogResult.mockResolvedValue({
        text: '\n\nfeat: x\n',
        structured: undefined,
      })

      const result = await runChangelogTextWorkflow({ sinceLastTag: true })

      expect(result.ok).toBe(true)
      expect(result.message).toBe('feat: x')
    })

    it('surfaces an empty-output result when the changelog produces nothing', async () => {
      mockedGenerateChangelogResult.mockResolvedValue({
        text: '   \n\n  ',
        structured: undefined,
      })

      const result = await runChangelogTextWorkflow({ branch: 'main' })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('No changelog output')
      expect(result.text).toBeUndefined()
    })

    it('propagates changelog handler errors', async () => {
      mockedGenerateChangelogResult.mockRejectedValue(new Error('LLM provider not configured'))

      const result = await runChangelogTextWorkflow({ branch: 'main' })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('LLM provider not configured')
      expect(result.text).toBeUndefined()
    })

    it('accepts the full set of changelog argv shapes (sinceLastTag, tag, range)', async () => {
      mockedGenerateChangelogResult.mockResolvedValue({
        text: 'feat: changelog',
        structured: undefined,
      })

      await runChangelogTextWorkflow({ sinceLastTag: true })
      await runChangelogTextWorkflow({ tag: 'v1.0.0' })
      await runChangelogTextWorkflow({ range: 'abc..def' })

      // Each invocation forwards the input through createChangelogArgv,
      // leaving the rest of the argv at its defaults (mode: 'stdout',
      // interactive: false, etc.).
      const calls = mockedGenerateChangelogResult.mock.calls
      expect(calls[0][0]).toMatchObject({ sinceLastTag: true, mode: 'stdout' })
      expect(calls[1][0]).toMatchObject({ tag: 'v1.0.0', mode: 'stdout' })
      expect(calls[2][0]).toMatchObject({ range: 'abc..def', mode: 'stdout' })
    })

    it('does not monkey-patch process.stdout.write during generation', async () => {
      const originalWrite = process.stdout.write
      mockedGenerateChangelogResult.mockResolvedValue({
        text: 'feat: no stdout pollution',
        structured: undefined,
      })

      await runChangelogTextWorkflow({ branch: 'main' })

      expect(process.stdout.write).toBe(originalWrite)
    })
  })
})
