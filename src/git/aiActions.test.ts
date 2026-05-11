import { handler as changelogHandler } from '../commands/changelog/handler'
import { runCommitWorkflow } from './commitWorkflowActions'
import {
  aiActionTestInternals,
  estimateLogAiActionImpact,
  runLogAiAction,
  runPullRequestBodyWorkflow,
} from './aiActions'

jest.mock('../commands/changelog/handler', () => ({
  handler: jest.fn(),
}))

jest.mock('./commitWorkflowActions', () => ({
  runCommitWorkflow: jest.fn(),
}))

const mockedChangelogHandler = changelogHandler as jest.MockedFunction<typeof changelogHandler>
const mockedRunCommitWorkflow = runCommitWorkflow as jest.MockedFunction<typeof runCommitWorkflow>

describe('log AI actions', () => {
  const selectedCommit = {
    hash: 'abcdef1234567890',
    shortHash: 'abcdef1',
    message: 'feat: add ai actions',
  }

  beforeEach(() => {
    mockedChangelogHandler.mockReset()
    mockedRunCommitWorkflow.mockReset()
  })

  it('estimates token impact before running AI actions', () => {
    expect(estimateLogAiActionImpact('summarize-commit', {
      selectedCommit,
    })).toEqual({
      action: 'summarize-commit',
      label: 'summarize commit',
      estimatedTokens: expect.any(Number),
      large: false,
      requiresConfirmation: true,
    })
  })

  it('routes selected commit summaries through bounded changelog ranges', async () => {
    mockedChangelogHandler.mockImplementation(async () => {
      process.stdout.write('AI commit summary\n\n- Changed the log UI.\n')
    })

    await expect(runLogAiAction('summarize-commit', {
      selectedCommit,
    })).resolves.toEqual({
      ok: true,
      message: 'AI commit summary',
      details: [],
      editable: 'AI commit summary\n- Changed the log UI.',
    })
    expect(mockedChangelogHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        _: ['changelog'],
        interactive: false,
        mode: 'stdout',
        range: 'abcdef1234567890^:abcdef1234567890',
      }),
      expect.anything()
    )
  })

  it('routes selected range summaries through changelog ranges', async () => {
    mockedChangelogHandler.mockImplementation(async () => {
      process.stdout.write('Range summary\n')
    })

    await expect(runLogAiAction('summarize-range', {
      selectedCommit,
      compareBase: {
        hash: '1111111',
        shortHash: '1111111',
        message: 'base',
      },
    })).resolves.toMatchObject({
      ok: true,
      message: 'Range summary',
    })
    expect(mockedChangelogHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        range: '1111111:abcdef1234567890',
      }),
      expect.anything()
    )
  })

  it('requires a compare base before range summaries', async () => {
    await expect(runLogAiAction('summarize-range', {
      selectedCommit,
    })).resolves.toEqual({
      ok: false,
      message: 'Select a compare base before summarizing a range.',
    })
    expect(mockedChangelogHandler).not.toHaveBeenCalled()
  })

  it('routes release notes through changelog tag summaries', async () => {
    mockedChangelogHandler.mockImplementation(async () => {
      process.stdout.write('Release notes\n')
    })

    await expect(runLogAiAction('release-notes', {
      selectedTag: '0.33.0',
    })).resolves.toMatchObject({
      ok: true,
      message: 'Release notes',
    })
    expect(mockedChangelogHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: '0.33.0',
        author: true,
      }),
      expect.anything()
    )
  })

  it('requires a selected tag before generating release notes', async () => {
    await expect(runLogAiAction('release-notes', {})).resolves.toEqual({
      ok: false,
      message: 'Select a tag before generating release notes.',
    })
    expect(mockedChangelogHandler).not.toHaveBeenCalled()
  })

  it('routes risk review through existing commit split analysis', async () => {
    mockedRunCommitWorkflow.mockResolvedValue({
      ok: true,
      message: 'Generated commit split plan.',
    })

    await expect(runLogAiAction('risk-review', {})).resolves.toEqual({
      ok: true,
      message: 'Risk review prepared from commit split analysis.',
    })
    expect(mockedRunCommitWorkflow).toHaveBeenCalledWith({
      action: 'split-plan',
    })
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
      mockedChangelogHandler.mockImplementation(async () => {
        process.stdout.write([
          'feat: workstation refactor',
          '',
          '- promote git data layer to src/git/',
          '- promote workstation chrome to src/workstation/',
          '- split inkRuntime into per-surface modules',
        ].join('\n'))
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

      // The handler was called with the base branch on the argv. Other
      // changelog options stay at their defaults from createChangelogArgv.
      const argv = mockedChangelogHandler.mock.calls[0][0]
      expect(argv).toMatchObject({ branch: 'main', mode: 'stdout' })
    })

    it('defaults the base branch to "main" when none is supplied', async () => {
      mockedChangelogHandler.mockImplementation(async () => {
        process.stdout.write('feat: x\n\nBody.')
      })

      await runPullRequestBodyWorkflow()

      const argv = mockedChangelogHandler.mock.calls[0][0]
      expect(argv.branch).toBe('main')
    })

    it('falls back to a single-line title when the changelog has no body', async () => {
      mockedChangelogHandler.mockImplementation(async () => {
        process.stdout.write('feat: tiny one-liner')
      })

      const result = await runPullRequestBodyWorkflow({ baseBranch: 'develop' })

      expect(result.ok).toBe(true)
      expect(result.title).toBe('feat: tiny one-liner')
      expect(result.body).toBe('')
    })

    it('propagates changelog failures without producing a title/body pair', async () => {
      mockedChangelogHandler.mockImplementation(async () => {
        throw new Error('no commits in range')
      })

      const result = await runPullRequestBodyWorkflow({ baseBranch: 'main' })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('no commits in range')
      // Title / body fields are absent on failure — the caller is expected
      // to open the prompt with empty fields and let the user author by
      // hand.
      expect(result.title).toBeUndefined()
      expect(result.body).toBeUndefined()
    })
  })
})
