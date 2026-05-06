import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  diffSummaryKey,
  getDiffSummaryCachePath,
  writeDiffSummary,
} from '../../lib/parsers/default/utils/diffSummaryCache'
import { handler } from './handler'

describe('coco cache <subcommand>', () => {
  let tmpRoot: string
  let originalXdgCacheHome: string | undefined
  let logger: { log: jest.Mock }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-cache-cmd-'))
    originalXdgCacheHome = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = tmpRoot
    logger = { log: jest.fn() }
  })

  afterEach(() => {
    if (originalXdgCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdgCacheHome
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('clear: removes the cache file when present', async () => {
    const key = diffSummaryKey('diff', 'gpt', 'p')
    writeDiffSummary(process.cwd(), key, { summary: 's', model: 'gpt', tokens: 5 })
    expect(fs.existsSync(getDiffSummaryCachePath(process.cwd()))).toBe(true)

    await handler({ subcommand: 'clear' } as never, logger as never)

    expect(fs.existsSync(getDiffSummaryCachePath(process.cwd()))).toBe(false)
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Cleared'))
  })

  it('clear: reports no-op when the cache is cold', async () => {
    await handler({ subcommand: 'clear' } as never, logger as never)
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('No diff-summary cache'))
  })

  it('info: reports entry count + on-disk size when warm', async () => {
    const key = diffSummaryKey('diff', 'gpt', 'p')
    writeDiffSummary(process.cwd(), key, { summary: 'summary text', model: 'gpt', tokens: 9 })

    await handler({ subcommand: 'info' } as never, logger as never)

    const lines = logger.log.mock.calls.map((args) => args[0]).join('\n')
    expect(lines).toContain('entries')
    expect(lines).toContain('1')
    expect(lines).toContain('summary tokens')
  })

  it('info: notes a missing cache instead of erroring', async () => {
    await handler({ subcommand: 'info' } as never, logger as never)
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('No diff-summary cache'))
  })

  it('rejects unknown subcommands and sets exit code', async () => {
    const previousExit = process.exitCode
    await handler({ subcommand: 'panic' } as never, logger as never)
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Unknown cache subcommand'))
    expect(process.exitCode).toBe(1)
    process.exitCode = previousExit
  })
})
