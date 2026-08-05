import { SimpleGit } from 'simple-git'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { validateConventionalCommitMessage } from '../../lib/utils/commitlintValidator'
import { AgentOperationContext } from './context'
import { runLint } from './generate'
import { LintRequestSchema } from './schemas'

jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/utils/commitlintValidator')

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockValidateConventionalCommitMessage = validateConventionalCommitMessage as jest.MockedFunction<
  typeof validateConventionalCommitMessage
>

const SEP = '\x1f'
const REC = '\x1e'

function record(fields: string[]): string {
  return `${fields.join(SEP)}${REC}\n`
}

function makeGit(log: string, options: { failLog?: boolean } = {}): SimpleGit {
  const raw = jest.fn(async (args: string[]) => {
    if (args[0] === 'log') {
      if (options.failLog) throw new Error("fatal: bad revision 'nope..HEAD'")
      return log
    }
    return ''
  })
  return { raw } as unknown as SimpleGit
}

function makeContext(git: SimpleGit | undefined): AgentOperationContext {
  return {
    repoRoot: '/repo',
    git,
    logger: { setConfig: jest.fn(), verbose: jest.fn() } as unknown as AgentOperationContext['logger'],
    surface: 'mcp',
  }
}

describe('runLint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadConfig.mockReturnValue({ defaultBranch: 'main' } as never)
    mockValidateConventionalCommitMessage.mockResolvedValue({ valid: true, errors: [], warnings: [] })
  })

  it('throws INVALID_REPOSITORY when the context has no git binding', async () => {
    const input = LintRequestSchema.parse({})
    await expect(runLint(input, makeContext(undefined))).rejects.toMatchObject({ code: 'INVALID_REPOSITORY' })
  })

  it('throws INVALID_INPUT when since and range are both set', async () => {
    const input = LintRequestSchema.parse({ since: 'abc', range: 'a..b' })
    await expect(runLint(input, makeContext(makeGit('')))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('throws INVALID_REVISION when the commit range cannot be read', async () => {
    const input = LintRequestSchema.parse({})
    await expect(runLint(input, makeContext(makeGit('', { failLog: true })))).rejects.toMatchObject({
      code: 'INVALID_REVISION',
    })
  })

  it('returns an empty result set when there are no commits in range', async () => {
    const input = LintRequestSchema.parse({})
    const result = await runLint(input, makeContext(makeGit('')))

    expect(result.data).toEqual({ results: [], summary: { passing: 0, failing: 0, warning: 0, skipped: 0 } })
    expect(mockValidateConventionalCommitMessage).not.toHaveBeenCalled()
  })

  it('marks merge commits as skipped without validating them', async () => {
    const log = record(['abc123', 'abc1', 'parent1 parent2', 'Someone', '2026-01-01', 'merge stuff', ''])
    const input = LintRequestSchema.parse({})
    const result = await runLint(input, makeContext(makeGit(log)))

    expect(mockValidateConventionalCommitMessage).not.toHaveBeenCalled()
    expect(result.data.results).toEqual([{
      sha: 'abc123', shortSha: 'abc1', subject: 'merge stuff', status: 'skipped', errors: [], warnings: [],
    }])
    expect(result.data.summary).toEqual({ passing: 0, failing: 0, warning: 0, skipped: 1 })
  })

  it('reports pass/warn/fail status per commit and computes summary counts', async () => {
    const log = [
      record(['sha1', 's1', '', 'A', '2026-01-01', 'feat: add thing', '']),
      record(['sha2', 's2', '', 'A', '2026-01-01', 'bad subject', '']),
      record(['sha3', 's3', '', 'A', '2026-01-01', 'feat: warn subject', '']),
    ].join('')
    mockValidateConventionalCommitMessage.mockImplementation(async (message: string) => {
      if (message.startsWith('bad subject')) return { valid: false, errors: ['type-empty'], warnings: [] }
      if (message.startsWith('feat: warn subject')) return { valid: true, errors: [], warnings: ['body-max-line-length'] }
      return { valid: true, errors: [], warnings: [] }
    })

    const input = LintRequestSchema.parse({})
    const result = await runLint(input, makeContext(makeGit(log)))

    expect(result.data.results.map((r) => r.status)).toEqual(['pass', 'fail', 'warn'])
    expect(result.data.summary).toEqual({ passing: 1, failing: 1, warning: 1, skipped: 0 })
  })

  it('counts warnings toward failing when severity is "warning"', async () => {
    const log = record(['sha1', 's1', '', 'A', '2026-01-01', 'feat: warn subject', ''])
    mockValidateConventionalCommitMessage.mockResolvedValue({ valid: true, errors: [], warnings: ['body-max-line-length'] })

    const input = LintRequestSchema.parse({ severity: 'warning' })
    const result = await runLint(input, makeContext(makeGit(log)))

    expect(result.data.summary).toEqual({ passing: 0, failing: 1, warning: 1, skipped: 0 })
  })

  it('resolves the commit range from since/range/defaultBranch', async () => {
    const raw = jest.fn(async () => '')
    const git = { raw } as unknown as SimpleGit

    await runLint(LintRequestSchema.parse({}), makeContext(git))
    expect(raw).toHaveBeenCalledWith(expect.arrayContaining(['main..HEAD']))

    raw.mockClear()
    await runLint(LintRequestSchema.parse({ since: 'v1.0.0' }), makeContext(git))
    expect(raw).toHaveBeenCalledWith(expect.arrayContaining(['v1.0.0..HEAD']))

    raw.mockClear()
    await runLint(LintRequestSchema.parse({ range: 'abc..def' }), makeContext(git))
    expect(raw).toHaveBeenCalledWith(expect.arrayContaining(['abc..def']))
  })
})
