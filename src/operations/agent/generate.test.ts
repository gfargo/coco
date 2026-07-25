import { generateAgentSplitPlan } from './generate'
import { AgentOperationContext } from './context'
import { AgentTaskInput } from './schemas'

const mockResolveChangeSource = jest.fn()
const mockGetChanges = jest.fn()
const mockGenerateValidatedCommitSplitPlan = jest.fn()
const mockLoadConfig = jest.fn()
const mockGetLlm = jest.fn()
const mockGetTokenCounterForProvider = jest.fn()

jest.mock('./context', () => {
  const actual = jest.requireActual('./context')
  return {
    ...actual,
    resolveChangeSource: (...args: unknown[]) => mockResolveChangeSource(...args),
  }
})

jest.mock('../../lib/simple-git/getChanges', () => ({
  getChanges: (...args: unknown[]) => mockGetChanges(...args),
}))

jest.mock('../../commands/commit/splitPlanGenerator', () => {
  const actual = jest.requireActual('../../commands/commit/splitPlanGenerator')
  return {
    ...actual,
    generateValidatedCommitSplitPlan: (...args: unknown[]) => mockGenerateValidatedCommitSplitPlan(...args),
  }
})

jest.mock('../../lib/config/utils/loadConfig', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}))

jest.mock('../../lib/langchain/utils', () => ({
  getApiKeyForModel: jest.fn(() => 'test-key'),
  getModelAndProviderFromConfig: jest.fn(() => ({ provider: 'anthropic', model: 'claude-test' })),
}))

jest.mock('../../lib/langchain/utils/dynamicModels', () => ({
  resolveDynamicService: jest.fn((config: { service: Record<string, unknown> }) => config.service),
}))

jest.mock('../../lib/langchain/utils/getLlm', () => ({
  getLlm: (...args: unknown[]) => mockGetLlm(...args),
}))

jest.mock('../../lib/utils/tokenizer', () => ({
  getTokenCounterForProvider: (...args: unknown[]) => mockGetTokenCounterForProvider(...args),
}))

function baseInput(overrides: Partial<AgentTaskInput> = {}): AgentTaskInput {
  return {
    version: 1,
    source: { kind: 'repository', scope: { type: 'staged' } },
    options: {
      conventional: false,
      includeBranchName: false,
      previousCommitCount: 0,
      author: false,
      trustRepositoryConfig: false,
    },
    ...overrides,
  } as AgentTaskInput
}

function baseContext(): AgentOperationContext {
  return {
    repoRoot: '/repo',
    git: {} as never,
    logger: { setConfig: jest.fn(), verbose: jest.fn() } as never,
    surface: 'agent-cli',
    signal: undefined,
  }
}

describe('generateAgentSplitPlan', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveChangeSource.mockResolvedValue({
      text: 'diff --git a/a.ts b/a.ts',
      meta: { kind: 'repository', digest: 'sha256:x', repositoryHead: 'abc', verification: 'repository-derived' },
    })
    mockLoadConfig.mockReturnValue({
      service: { authentication: { type: 'None' }, tokenLimit: 4096, provider: 'anthropic', model: 'claude-test' },
    })
    mockGetLlm.mockResolvedValue({})
    mockGetTokenCounterForProvider.mockResolvedValue((text: string) => text.length)
  })

  it.each(['summary', 'files'] as const)('rejects the %s source with INVALID_SOURCE', async (kind) => {
    const source = kind === 'summary'
      ? { kind: 'summary' as const, summary: 'changed things' }
      : { kind: 'files' as const, files: [{ path: 'a.ts', status: 'modified' as const, summary: 'x' }] }

    await expect(generateAgentSplitPlan(baseInput({ source }), baseContext()))
      .rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    expect(mockGetChanges).not.toHaveBeenCalled()
  })

  it('rejects a non-staged repository scope with INVALID_SOURCE', async () => {
    const source = { kind: 'repository' as const, scope: { type: 'worktree' as const } }

    await expect(generateAgentSplitPlan(baseInput({ source }), baseContext()))
      .rejects.toMatchObject({ code: 'INVALID_SOURCE' })
  })

  it('throws NO_CHANGES when the staged set is empty', async () => {
    mockGetChanges.mockResolvedValue({ staged: [] })

    await expect(generateAgentSplitPlan(baseInput(), baseContext()))
      .rejects.toMatchObject({ code: 'NO_CHANGES' })
    expect(mockGenerateValidatedCommitSplitPlan).not.toHaveBeenCalled()
  })

  it('maps unclaimed groups to ungrouped and returns no validation errors on a clean plan', async () => {
    mockGetChanges.mockResolvedValue({
      staged: [
        { filePath: 'a.ts', status: 'modified', summary: 'changed a' },
        { filePath: 'b.ts', status: 'modified', summary: 'changed b' },
      ],
    })
    mockGenerateValidatedCommitSplitPlan.mockResolvedValue({
      plan: {
        groups: [
          { title: 'feat: add a', body: 'body a', files: ['a.ts'], rationale: 'core change' },
          {
            title: 'Left for you — not committed',
            body: 'note',
            files: ['b.ts'],
            hunks: [],
            unclaimed: true,
          },
        ],
      },
      attempts: 1,
    })

    const result = await generateAgentSplitPlan(baseInput(), baseContext())

    expect(result.data).toEqual({
      groups: [{ title: 'feat: add a', body: 'body a', files: ['a.ts'], rationale: 'core change' }],
      ungrouped: ['b.ts'],
      validationErrors: [],
    })
    expect(result.operation).toBe('split-plan')
  })

  it('folds the fallback reason into validationErrors when the planner falls back', async () => {
    mockGetChanges.mockResolvedValue({
      staged: [{ filePath: 'a.ts', status: 'modified', summary: 'changed a' }],
    })
    mockGenerateValidatedCommitSplitPlan.mockResolvedValue({
      plan: {
        groups: [{ title: 'chore: combined commit', body: 'fallback body', files: ['a.ts'] }],
      },
      attempts: 3,
      fallback: {
        reason: 'LLM exhausted 3 planning attempts; final validator issues: missing files: a.ts',
        lastIssues: {
          unknownFiles: [],
          duplicateFiles: [],
          unknownHunks: [],
          duplicateHunks: [],
          mixedFiles: [],
          partiallyCoveredFiles: [],
          missingFiles: [],
        },
      },
    })

    const result = await generateAgentSplitPlan(baseInput(), baseContext())

    expect(result.data.validationErrors).toEqual([
      'LLM exhausted 3 planning attempts; final validator issues: missing files: a.ts',
    ])
  })

  it('derives file changes from a supplied patch source instead of reading staged git state', async () => {
    const patch = [
      'diff --git a/new-file.ts b/new-file.ts',
      'new file mode 100644',
      'index 0000000..e69de29',
      '--- /dev/null',
      '+++ b/new-file.ts',
      '@@ -0,0 +1 @@',
      '+export const x = 1',
      '',
    ].join('\n')
    mockResolveChangeSource.mockResolvedValue({
      text: patch,
      meta: { kind: 'patch', digest: 'sha256:y', verification: 'provided-unverified' },
    })
    mockGenerateValidatedCommitSplitPlan.mockResolvedValue({
      plan: { groups: [{ title: 'feat: add new-file', body: '', files: ['new-file.ts'] }] },
      attempts: 1,
    })

    const result = await generateAgentSplitPlan(baseInput({ source: { kind: 'patch', patch } }), baseContext())

    expect(mockGetChanges).not.toHaveBeenCalled()
    expect(mockGenerateValidatedCommitSplitPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        staged: [{ filePath: 'new-file.ts', status: 'added', summary: '' }],
      }),
    )
    expect(result.data.groups).toEqual([{ title: 'feat: add new-file', body: '', files: ['new-file.ts'] }])
  })
})
