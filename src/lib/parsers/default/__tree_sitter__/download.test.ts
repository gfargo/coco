import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Per-test-file cache override — keeps parallel jest workers from
// racing on a shared `~/.cache/coco/tree-sitter/`. Must be set
// BEFORE the cache module is imported so its first read picks it up.
process.env.COCO_CACHE_DIR = mkdtempSync(join(tmpdir(), 'coco-cache-download-test-'))

import { downloadTreeSitterParser, formatDownloadOutcome, treeSitterMirrorUrls } from './download'
import { getCachedWasmPath, getTreeSitterCacheDir } from './cache'
import { TREE_SITTER_MANIFEST } from './manifest'

const PY_BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef])
// SHA-256 of the PY_BYTES fixture above — recomputed if PY_BYTES changes.
const PY_HASH = 'b600e3f7b5cc87bc0f00020de1d51f557e628e659eb02fd5e18aac9871a3e479'

describe('downloadTreeSitterParser', () => {
  let originalSha: string

  beforeAll(() => {
    // Stub the manifest sha to match our fake-bytes hash so the
    // verify step accepts our test payload. Restore in afterAll.
    originalSha = TREE_SITTER_MANIFEST.python.sha256
    TREE_SITTER_MANIFEST.python.sha256 = PY_HASH
  })

  afterAll(() => {
    TREE_SITTER_MANIFEST.python.sha256 = originalSha
    // Wipe the whole test-file cache once at end.
    try {
      rmSync(process.env.COCO_CACHE_DIR as string, { recursive: true, force: true })
    } catch {
      // ignore — best effort
    }
  })

  afterEach(() => {
    // Wipe the per-language cache between tests so each starts
    // from empty (but leave the dir itself in place for the next
    // test's write).
    try {
      rmSync(getTreeSitterCacheDir(), { recursive: true, force: true })
    } catch {
      // First-time runs may not have created it
    }
  })

  it('writes the cached wasm and returns ok when the hash matches', async () => {
    const fakeFetch: typeof globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => PY_BYTES.buffer,
    } as unknown as Response)

    const outcome = await downloadTreeSitterParser('python', { fetchImpl: fakeFetch })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.path).toBe(getCachedWasmPath('python'))
    expect(outcome.bytes).toBe(PY_BYTES.byteLength)
    const onDisk = readFileSync(outcome.path)
    expect(onDisk.equals(Buffer.from(PY_BYTES))).toBe(true)
  })

  it('refuses to write when the SHA doesn\'t match the manifest', async () => {
    const tamperedBytes = new Uint8Array([...PY_BYTES, 0xff])
    const fakeFetch: typeof globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => tamperedBytes.buffer,
    } as unknown as Response)

    const outcome = await downloadTreeSitterParser('python', { fetchImpl: fakeFetch })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('sha-mismatch')
  })

  it('returns a network error on non-2xx responses', async () => {
    const fakeFetch: typeof globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response)

    const outcome = await downloadTreeSitterParser('python', { fetchImpl: fakeFetch })
    expect(outcome.ok).toBe(false)
    if (outcome.ok || outcome.reason !== 'network') {
      throw new Error('expected a network outcome')
    }
    expect(outcome.message).toContain('404')
  })

  it('returns a network error when fetch itself throws', async () => {
    const fakeFetch: typeof globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED')
    }

    const outcome = await downloadTreeSitterParser('python', { fetchImpl: fakeFetch })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    if (outcome.reason !== 'network') throw new Error('expected network reason')
    expect(outcome.message).toBe('ECONNREFUSED')
  })

  it('falls back to a mirror when the primary CDN fails (#1247)', async () => {
    const tried: string[] = []
    const fakeFetch: typeof globalThis.fetch = async (input) => {
      const url = String(input)
      tried.push(url)
      // jsdelivr (primary) is down; a mirror serves the bytes.
      if (url.startsWith('https://cdn.jsdelivr.net/')) {
        throw new Error('ENOTFOUND cdn.jsdelivr.net')
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => PY_BYTES.buffer,
      } as unknown as Response
    }

    const outcome = await downloadTreeSitterParser('python', { fetchImpl: fakeFetch })
    expect(outcome.ok).toBe(true)
    // primary attempted first, then a mirror
    expect(tried[0]).toContain('cdn.jsdelivr.net')
    expect(tried.length).toBeGreaterThanOrEqual(2)
    expect(tried[1]).toMatch(/fastly\.jsdelivr\.net|unpkg\.com/)
  })

  it('tries every mirror before giving up, surfacing the last failure', async () => {
    const tried: string[] = []
    const fakeFetch: typeof globalThis.fetch = async (input) => {
      tried.push(String(input))
      throw new Error('ECONNREFUSED')
    }

    const outcome = await downloadTreeSitterParser('python', { fetchImpl: fakeFetch })
    expect(outcome.ok).toBe(false)
    if (outcome.ok || outcome.reason !== 'network') throw new Error('expected network failure')
    // all three sources attempted
    expect(tried).toHaveLength(3)
  })
})

describe('treeSitterMirrorUrls', () => {
  it('derives Fastly + unpkg mirrors from a jsdelivr npm URL', () => {
    const urls = treeSitterMirrorUrls(
      'https://cdn.jsdelivr.net/npm/tree-sitter-python@0.23.6/tree-sitter-python.wasm',
    )
    expect(urls).toEqual([
      'https://cdn.jsdelivr.net/npm/tree-sitter-python@0.23.6/tree-sitter-python.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-python@0.23.6/tree-sitter-python.wasm',
      'https://unpkg.com/tree-sitter-python@0.23.6/tree-sitter-python.wasm',
    ])
  })

  it('returns just the original for a non-jsdelivr URL', () => {
    const urls = treeSitterMirrorUrls('https://example.com/custom.wasm')
    expect(urls).toEqual(['https://example.com/custom.wasm'])
  })
})

describe('formatDownloadOutcome', () => {
  it('renders a check + cache path on success', () => {
    const line = formatDownloadOutcome('python', { ok: true, path: '/tmp/x.wasm', bytes: 1024 })
    expect(line).toMatch(/✓ Python parser cached/)
    expect(line).toContain('/tmp/x.wasm')
  })

  it('renders an x + reason on network failure', () => {
    const line = formatDownloadOutcome('python', { ok: false, reason: 'network', message: 'oops' })
    expect(line).toMatch(/✗ Python: network error/)
    expect(line).toContain('oops')
  })

  it('renders a hash-mismatch warning with short hashes', () => {
    const line = formatDownloadOutcome('python', {
      ok: false,
      reason: 'sha-mismatch',
      expected: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      actual: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    expect(line).toMatch(/SHA-256 mismatch/)
    expect(line).toContain('aaaaaaaaaaaa')
    expect(line).toContain('bbbbbbbbbbbb')
  })
})
