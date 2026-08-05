import { SimpleGit } from 'simple-git'

import { createCommit, PreCommitHookError } from '../../lib/simple-git/createCommit'
import { AgentOperationContext } from './context'
import { AgentOperationError } from './errors'
import { runCommitApply } from './generate'
import { CommitApplyRequest } from './schemas'

jest.mock('../../lib/simple-git/createCommit', () => {
  const actual = jest.requireActual('../../lib/simple-git/createCommit') as typeof import('../../lib/simple-git/createCommit')
  return {
    ...actual,
    createCommit: jest.fn(),
  }
})

const mockCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>

function makeGit(overrides: Partial<{ raw: jest.Mock; revparse: jest.Mock }> = {}): SimpleGit {
  return {
    raw: overrides.raw ?? jest.fn().mockResolvedValue(''),
    revparse: overrides.revparse ?? jest.fn().mockResolvedValue(''),
  } as unknown as SimpleGit
}

function makeContext(git: SimpleGit | undefined): AgentOperationContext {
  return {
    repoRoot: '/repo',
    git,
    logger: { setConfig: jest.fn(), verbose: jest.fn() } as unknown as AgentOperationContext['logger'],
    surface: 'mcp',
  }
}

const baseInput: CommitApplyRequest = {
  version: 1,
  title: 'feat: add thing',
  noVerify: false,
}

describe('runCommitApply', () => {
  afterEach(() => jest.clearAllMocks())

  it('throws INVALID_REPOSITORY when no git context is available', async () => {
    const context = makeContext(undefined)

    await expect(runCommitApply(baseInput, context)).rejects.toMatchObject({
      code: 'INVALID_REPOSITORY',
    })
    expect(mockCreateCommit).not.toHaveBeenCalled()
  })

  it('refuses when the index is empty, without staging or committing anything', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const context = makeContext(makeGit({ raw }))

    await expect(runCommitApply(baseInput, context)).rejects.toMatchObject({
      code: 'EMPTY_INDEX',
    })
    expect(raw).toHaveBeenCalledWith(['diff', '--cached', '--name-only', '-z'])
    expect(mockCreateCommit).not.toHaveBeenCalled()
  })

  it('composes a title-only message, commits, and resolves sha/shortSha/message', async () => {
    const raw = jest.fn()
      .mockResolvedValueOnce('file.txt\0')
      .mockResolvedValueOnce('feat: add thing\n')
    const revparse = jest.fn()
      .mockResolvedValueOnce('abc123def456\n')
      .mockResolvedValueOnce('abc123d\n')
    mockCreateCommit.mockResolvedValue({} as never)
    const git = makeGit({ raw, revparse })
    const context = makeContext(git)

    const result = await runCommitApply(baseInput, context)

    expect(mockCreateCommit).toHaveBeenCalledWith('feat: add thing', git, undefined, { noVerify: false })
    expect(result).toEqual({ sha: 'abc123def456', shortSha: 'abc123d', message: 'feat: add thing' })
  })

  it('composes a title+body message separated by a blank line', async () => {
    const raw = jest.fn()
      .mockResolvedValueOnce('file.txt\0')
      .mockResolvedValueOnce('feat: add thing\n\nSome detail.\n')
    const revparse = jest.fn().mockResolvedValue('sha\n')
    mockCreateCommit.mockResolvedValue({} as never)
    const git = makeGit({ raw, revparse })
    const context = makeContext(git)

    await runCommitApply({ ...baseInput, body: 'Some detail.' }, context)

    expect(mockCreateCommit).toHaveBeenCalledWith('feat: add thing\n\nSome detail.', git, undefined, { noVerify: false })
  })

  it('passes noVerify through to createCommit', async () => {
    const raw = jest.fn()
      .mockResolvedValueOnce('file.txt\0')
      .mockResolvedValueOnce('feat: add thing\n')
    const revparse = jest.fn().mockResolvedValue('sha\n')
    mockCreateCommit.mockResolvedValue({} as never)
    const git = makeGit({ raw, revparse })
    const context = makeContext(git)

    await runCommitApply({ ...baseInput, noVerify: true }, context)

    expect(mockCreateCommit).toHaveBeenCalledWith(expect.any(String), git, undefined, { noVerify: true })
  })

  it('wraps a PreCommitHookError as an AgentOperationError with code HOOK_FAILED', async () => {
    const raw = jest.fn().mockResolvedValueOnce('file.txt\0')
    mockCreateCommit.mockRejectedValue(new PreCommitHookError('lint failed'))
    const context = makeContext(makeGit({ raw }))

    const error = await runCommitApply(baseInput, context).catch((err) => err)

    expect(error).toBeInstanceOf(AgentOperationError)
    expect(error).toMatchObject({ code: 'HOOK_FAILED', message: 'lint failed' })
  })
})
