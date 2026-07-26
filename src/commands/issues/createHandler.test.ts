import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler } from './createHandler'
import { IssuesCreateOptions } from './createConfig'
import { Config } from '../../commands/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getProviderOverview } from '../../git/providerData'
import { getForgeActions } from '../../git/forgeActions'
import { Logger } from '../../lib/utils/logger'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../git/providerData')
jest.mock('../../git/forgeActions')

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockOverview = getProviderOverview as jest.MockedFunction<typeof getProviderOverview>
const mockGetForgeActions = getForgeActions as jest.MockedFunction<typeof getForgeActions>

function okOverview(over: Record<string, unknown> = {}) {
  return {
    repository: { provider: 'github', remote: 'origin', owner: 'gfargo', name: 'coco' },
    authenticated: true,
    ...over,
  } as unknown as Awaited<ReturnType<typeof getProviderOverview>>
}

/** Feeds `raw` to `process.stdin` for the duration of `fn`, mirroring a piped `coco review --json`. */
async function withStdin<T>(raw: string, fn: () => Promise<T>): Promise<T> {
  const original = process.stdin
  const fake = {
    setEncoding: jest.fn(),
    [Symbol.asyncIterator]: async function* () {
      if (raw) yield raw
    },
  }
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'stdin', { value: original, configurable: true })
  }
}

describe('issues create command', () => {
  let argv: Arguments<IssuesCreateOptions>
  let logger: Logger
  let mockCreateIssue: jest.Mock

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['issues', 'create'],
      interactive: false,
      fromReview: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<IssuesCreateOptions>
    logger = { log: jest.fn(), verbose: jest.fn(), setConfig: jest.fn(), error: jest.fn() } as unknown as Logger

    mockApplyRepoFlag.mockReturnValue({} as SimpleGit)
    mockLoadConfig.mockReturnValue({ service: { provider: 'openai' } } as unknown as Config)
    mockOverview.mockResolvedValue(okOverview())

    mockCreateIssue = jest.fn().mockResolvedValue({ ok: true, message: 'Created issue: https://gh/issues/1', url: 'https://gh/issues/1' })
    mockGetForgeActions.mockReturnValue({ createIssue: mockCreateIssue } as unknown as ReturnType<typeof getForgeActions>)
  })

  afterEach(() => jest.clearAllMocks())

  it('creates an issue from explicit --title/--body', async () => {
    argv.title = 'Bug found'
    argv.body = 'Steps to repro...'
    await handler(argv, logger)
    expect(mockCreateIssue).toHaveBeenCalledWith({ title: 'Bug found', body: 'Steps to repro...' })
    expect(logger.log).toHaveBeenCalledWith('Created issue: https://gh/issues/1', { color: 'green' })
  })

  it('does not create on --dry-run', async () => {
    argv.title = 'Bug found'
    argv.body = 'body'
    argv.dryRun = true
    await handler(argv, logger)
    expect(mockCreateIssue).not.toHaveBeenCalled()
    expect(logger.log).toHaveBeenCalledWith('Bug found\n\nbody')
  })

  it('emits JSON and does not create on --json', async () => {
    argv.title = 'Bug found'
    argv.body = 'body'
    argv.json = true
    const writes: string[] = []
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((c: string) => {
      writes.push(String(c))
      return true
    }) as never)
    try {
      await handler(argv, logger)
    } finally {
      spy.mockRestore()
    }
    expect(mockCreateIssue).not.toHaveBeenCalled()
    const parsed = JSON.parse(writes.join(''))
    expect(parsed).toEqual({ title: 'Bug found', body: 'body' })
  })

  it('drafts title/body from the highest-severity --from-review finding on stdin', async () => {
    argv.fromReview = true
    const findings = [
      { title: 'Minor nit', summary: 'nit', severity: 2, category: 'style', filePath: 'a.ts' },
      { title: 'SQL injection', summary: 'Unsanitized input reaches the query.', severity: 9, category: 'security', filePath: 'b.ts' },
    ]
    await withStdin(JSON.stringify(findings), () => handler(argv, logger))
    expect(mockCreateIssue).toHaveBeenCalledWith({
      title: 'SQL injection',
      body: 'Unsanitized input reaches the query.\n\n- Severity: 9\n- Category: security\n- File: `b.ts`',
    })
  })

  it('exits non-zero when --from-review has no findings on stdin', async () => {
    argv.fromReview = true
    await withStdin('', () => expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 }))
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it('exits non-zero when --from-review stdin is not review-shaped JSON', async () => {
    argv.fromReview = true
    await withStdin('{"not":"an array"}', () => expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 }))
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it('exits non-zero when no title can be determined', async () => {
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it('exits non-zero for an unsupported provider', async () => {
    mockOverview.mockResolvedValue(okOverview({ repository: { provider: 'unsupported', message: 'No remote detected.' } }))
    argv.title = 'Bug found'
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it('exits non-zero when the forge CLI is not authenticated', async () => {
    mockOverview.mockResolvedValue(okOverview({ authenticated: false, message: 'run gh auth login' }))
    argv.title = 'Bug found'
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it('surfaces a forge createIssue failure', async () => {
    mockCreateIssue.mockResolvedValue({ ok: false, message: 'No Bitbucket project resolved' })
    argv.title = 'Bug found'
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(logger.error).toHaveBeenCalledWith('No Bitbucket project resolved', { color: 'red' })
  })
})
