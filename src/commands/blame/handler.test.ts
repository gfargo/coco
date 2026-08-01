import { Arguments } from 'yargs'
import { CommandExitError } from '../../lib/utils/commandExit'
import { Logger } from '../../lib/utils/logger'
import { BlameOptions } from './config'
import type { BlameLine } from '../../git/blameData'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../git/blameData')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')

import { handler } from './handler'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { getBlame } from '../../git/blameData'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockGetBlame = getBlame as jest.MockedFunction<typeof getBlame>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>

// #OSS-1604 regression: the 400-line --explain cap was originally guarded by
// `if (!range && lines.length > MAX_EXPLAIN_LINES)`, so an explicit
// `--lines a:b` range that still exceeded the cap bypassed the friendly
// rejection and fell through to the LLM call. Fixed by dropping the `!range`
// condition — this test pins that an explicit over-cap range is still
// rejected.
function makeLines(count: number): BlameLine[] {
  return Array.from({ length: count }, (_, index) => ({
    hash: `${index}`.padStart(40, '0'),
    shortHash: `${index}`.padStart(8, '0'),
    author: 'Someone',
    authorTime: 0,
    lineNumber: index + 1,
    content: `line ${index + 1}`,
  }))
}

describe('blame handler --explain line cap', () => {
  let argv: Arguments<BlameOptions>
  let logger: Logger

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['blame'],
      file: 'src/example.ts',
      explain: true,
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    }

    logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger

    mockApplyRepoFlag.mockReturnValue({} as never)
    mockLoadConfig.mockReturnValue({
      mode: 'stdout',
      defaultBranch: 'main',
      service: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        authentication: {
          type: 'APIKey',
          credentials: { apiKey: 'mock-api-key' },
        },
      },
    } as never)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
    } as never)
  })

  it('rejects an explicit --lines range that still exceeds the 400-line cap', async () => {
    mockGetBlame.mockResolvedValue({
      ok: true,
      path: argv.file,
      lines: makeLines(401),
    })
    argv.lines = '1:401'

    await expect(handler(argv, logger)).rejects.toMatchObject({
      code: 1,
    } satisfies Partial<CommandExitError>)

    const printedLines = (logger.error as jest.Mock).mock.calls.map((call) => call[0]).join('\n')
    expect(printedLines).toContain('exceeds the 400-line cap')
    expect(printedLines).toContain('401 lines')
  })

  it('rejects --explain over the cap when no --lines range is given', async () => {
    mockGetBlame.mockResolvedValue({
      ok: true,
      path: argv.file,
      lines: makeLines(401),
    })

    await expect(handler(argv, logger)).rejects.toMatchObject({
      code: 1,
    } satisfies Partial<CommandExitError>)

    const printedLines = (logger.error as jest.Mock).mock.calls.map((call) => call[0]).join('\n')
    expect(printedLines).toContain('exceeds the 400-line cap')
  })
})
