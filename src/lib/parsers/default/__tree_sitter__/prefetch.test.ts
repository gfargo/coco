import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Per-test-file cache override — see download.test.ts for rationale.
process.env.COCO_CACHE_DIR = mkdtempSync(join(tmpdir(), 'coco-cache-prefetch-test-'))

import {
  parsePrefetchEnv,
  prefetchTreeSitterParsers,
  runPrefetchFromEnv,
} from './prefetch'
import { getTreeSitterCacheDir, isLanguageCached } from './cache'
import type { DownloadOutcome } from './download'

afterAll(() => {
  try {
    rmSync(process.env.COCO_CACHE_DIR as string, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe('parsePrefetchEnv', () => {
  it('returns empty when the env var is unset / empty', () => {
    expect(parsePrefetchEnv(undefined)).toEqual({ resolved: [], unknown: [] })
    expect(parsePrefetchEnv('')).toEqual({ resolved: [], unknown: [] })
    expect(parsePrefetchEnv('   ')).toEqual({ resolved: [], unknown: [] })
  })

  it('resolves short aliases to canonical language ids', () => {
    expect(parsePrefetchEnv('py')).toEqual({ resolved: ['python'], unknown: [] })
    expect(parsePrefetchEnv('python')).toEqual({ resolved: ['python'], unknown: [] })
  })

  it('expands `all` to every manifest language', () => {
    expect(parsePrefetchEnv('all').resolved).toContain('python')
  })

  it('deduplicates resolved languages', () => {
    expect(parsePrefetchEnv('py,python,py').resolved).toEqual(['python'])
  })

  it('flags unknown tokens but still returns recognized ones', () => {
    const { resolved, unknown } = parsePrefetchEnv('py,scala,xyz')
    expect(resolved).toEqual(['python'])
    expect(unknown).toEqual(['scala', 'xyz'])
  })
})

describe('prefetchTreeSitterParsers', () => {
  afterEach(() => {
    try {
      rmSync(getTreeSitterCacheDir(), { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('skips languages already cached', async () => {
    const fakeDownload = jest.fn<Promise<DownloadOutcome>, [unknown]>()
    // Pretend python is cached by creating the file ahead of time.
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    mkdirSync(getTreeSitterCacheDir(), { recursive: true })
    writeFileSync(join(getTreeSitterCacheDir(), 'tree-sitter-python.wasm'), 'fake')

    expect(isLanguageCached('python')).toBe(true)

    const result = await prefetchTreeSitterParsers(['python'], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      download: fakeDownload as any,
      writeLine: () => undefined,
    })
    expect(result.alreadyCached).toEqual(['python'])
    expect(result.downloaded).toEqual([])
    expect(fakeDownload).not.toHaveBeenCalled()
  })

  it('records a successful download', async () => {
    const fakeDownload = jest.fn(
      async (): Promise<DownloadOutcome> => ({ ok: true, path: '/tmp/x.wasm', bytes: 100 }),
    )
    const result = await prefetchTreeSitterParsers(['python'], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      download: fakeDownload as any,
      writeLine: () => undefined,
    })
    expect(result.downloaded).toEqual(['python'])
    expect(result.failed).toEqual([])
    expect(fakeDownload).toHaveBeenCalledWith('python')
  })

  it('records a failed download but continues processing', async () => {
    const fakeDownload = jest.fn(
      async (): Promise<DownloadOutcome> => ({ ok: false, reason: 'network', message: 'boom' }),
    )
    const result = await prefetchTreeSitterParsers(['python'], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      download: fakeDownload as any,
      writeLine: () => undefined,
    })
    expect(result.downloaded).toEqual([])
    expect(result.failed).toEqual(['python'])
  })
})

describe('runPrefetchFromEnv', () => {
  it('is a no-op when COCO_PREFETCH is unset', async () => {
    const fakeDownload = jest.fn()
    const result = await runPrefetchFromEnv({
      env: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      download: fakeDownload as any,
      writeLine: () => undefined,
    })
    expect(result.requested).toEqual([])
    expect(fakeDownload).not.toHaveBeenCalled()
  })

  it('runs downloads when COCO_PREFETCH names known languages', async () => {
    const fakeDownload = jest.fn(
      async (): Promise<DownloadOutcome> => ({ ok: true, path: '/tmp/x.wasm', bytes: 100 }),
    )
    const lines: string[] = []
    const result = await runPrefetchFromEnv({
      env: { COCO_PREFETCH: 'py' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      download: fakeDownload as any,
      writeLine: (line) => lines.push(line),
    })
    expect(result.requested).toEqual(['python'])
    expect(result.downloaded).toEqual(['python'])
    expect(lines.some((l) => l.includes('downloading'))).toBe(true)
    expect(lines.some((l) => l.includes('Python parser cached'))).toBe(true)
  })

  it('warns about unknown language tokens but still processes the recognized ones', async () => {
    const fakeDownload = jest.fn(
      async (): Promise<DownloadOutcome> => ({ ok: true, path: '/tmp/x.wasm', bytes: 100 }),
    )
    const lines: string[] = []
    const result = await runPrefetchFromEnv({
      env: { COCO_PREFETCH: 'py,scala' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      download: fakeDownload as any,
      writeLine: (line) => lines.push(line),
    })
    expect(result.unknown).toEqual(['scala'])
    expect(result.downloaded).toEqual(['python'])
    expect(lines.some((l) => l.includes('ignoring unknown language(s): scala'))).toBe(true)
  })
})
