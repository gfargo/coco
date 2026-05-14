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

  describe('tree-sitter subcommands (#933 phase 7)', () => {
    // Each test sets COCO_CACHE_DIR to the same tmpRoot the existing
    // tests use for XDG_CACHE_HOME, ensuring the tree-sitter cache
    // dir lives inside our isolated tmp dir and gets wiped by the
    // afterEach in the outer describe.
    beforeEach(() => {
      process.env.COCO_CACHE_DIR = path.join(tmpRoot, 'coco')
    })
    afterEach(() => {
      delete process.env.COCO_CACHE_DIR
    })

    it('parsers: lists every manifest language with cached/not-cached state', async () => {
      await handler({ subcommand: 'parsers' } as never, logger as never)
      const out = logger.log.mock.calls.map((args) => args[0]).join('\n')
      expect(out).toContain('Tree-sitter parser cache')
      expect(out).toContain('Python')
      expect(out).toContain('Rust')
      expect(out).toContain('Go')
      // Every entry is not-cached in this fresh tmp dir.
      expect(out).toContain('not cached')
    })

    it('prefetch: warns about unknown language tokens', async () => {
      // Bare unknown token → handler should warn then no-op (empty
      // resolved list → "Nothing to do").
      await handler({
        subcommand: 'prefetch',
        languages: ['fortran'],
      } as never, logger as never)
      const out = logger.log.mock.calls.map((args) => args[0]).join('\n')
      expect(out).toContain('ignoring unknown language(s): fortran')
      expect(out).toContain('Nothing to do')
    })

    it('clear-parsers: reports no-op when nothing is cached', async () => {
      await handler({ subcommand: 'clear-parsers' } as never, logger as never)
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('No tree-sitter parsers cached'),
      )
    })

    it('clear-parsers: removes cached .wasm files', async () => {
      // Seed two fake .wasm files in the cache dir to simulate a
      // populated cache without doing a real network download.
      const cacheDir = path.join(process.env.COCO_CACHE_DIR as string, 'tree-sitter')
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(path.join(cacheDir, 'tree-sitter-python.wasm'), 'fake')
      fs.writeFileSync(path.join(cacheDir, 'tree-sitter-rust.wasm'), 'fake')

      await handler({ subcommand: 'clear-parsers' } as never, logger as never)

      const out = logger.log.mock.calls.map((args) => args[0]).join('\n')
      expect(out).toContain('cleared Python')
      expect(out).toContain('cleared Rust')
      expect(fs.existsSync(path.join(cacheDir, 'tree-sitter-python.wasm'))).toBe(false)
      expect(fs.existsSync(path.join(cacheDir, 'tree-sitter-rust.wasm'))).toBe(false)
    })
  })
})
