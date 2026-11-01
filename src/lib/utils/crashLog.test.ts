import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { CRASH_LOGS_KEPT, getCrashLogDir, summarizeError, writeCrashLog } from './crashLog'

describe('crash log (#2206)', () => {
  const original = process.env.XDG_CACHE_HOME
  let cache: string

  beforeEach(() => {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-crash-'))
    process.env.XDG_CACHE_HOME = cache
  })

  afterEach(() => {
    if (original === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = original
    fs.rmSync(cache, { recursive: true, force: true })
  })

  it('writes the stack, the build and the platform, and returns the path', () => {
    const error = new Error('render blew up')
    const { logPath } = writeCrashLog({ source: 'render', error, componentStack: '\n    at Foo\n    at Bar' })

    expect(logPath && path.dirname(logPath)).toBe(getCrashLogDir())
    const text = fs.readFileSync(logPath as string, 'utf8')
    expect(text).toContain('source:   render')
    expect(text).toContain(`node:     ${process.version}`)
    expect(text).toContain('Error: render blew up')
    expect(text).toContain(String(error.stack).split('\n')[1].trim())
    expect(text).toContain('Component stack:')
    expect(text).toContain('at Foo')
  })

  it('writes an owner-only file in an owner-only directory', () => {
    const { logPath } = writeCrashLog({ source: 'render', error: new Error('x') })
    expect(fs.statSync(logPath as string).mode & 0o777).toBe(0o600)
    expect(fs.statSync(getCrashLogDir()).mode & 0o777).toBe(0o700)
  })

  it('records a thrown non-Error', () => {
    const { logPath } = writeCrashLog({ source: 'unhandledRejection', error: 'plain string' })
    expect(fs.readFileSync(logPath as string, 'utf8')).toContain('plain string')
  })

  it('does not record the environment or the arguments', () => {
    process.env.COCO_CRASH_TEST_SECRET = 'sk-should-not-appear'
    try {
      const { logPath } = writeCrashLog({ source: 'render', error: new Error('x') })
      const text = fs.readFileSync(logPath as string, 'utf8')
      expect(text).not.toContain('sk-should-not-appear')
      expect(text).not.toContain(process.argv.slice(2).join(' ') || '\u0000')
    } finally {
      delete process.env.COCO_CRASH_TEST_SECRET
    }
  })

  it('saves a commit draft beside the log, and nothing when there is none', () => {
    const withDraft = writeCrashLog({ source: 'render', error: new Error('x'), draft: 'feat: half written\n\nbody' })
    expect(fs.readFileSync(withDraft.draftPath as string, 'utf8')).toBe('feat: half written\n\nbody')
    expect(fs.statSync(withDraft.draftPath as string).mode & 0o777).toBe(0o600)

    expect(writeCrashLog({ source: 'render', error: new Error('y'), draft: '   ' }).draftPath).toBeUndefined()
    expect(writeCrashLog({ source: 'render', error: new Error('z') }).draftPath).toBeUndefined()
  })

  it('keeps only the newest logs and drafts', () => {
    for (let i = 0; i < CRASH_LOGS_KEPT + 3; i += 1) {
      writeCrashLog({ source: 'render', error: new Error(`e${i}`), draft: `d${i}`, now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) })
    }
    const names = fs.readdirSync(getCrashLogDir())
    expect(names.filter((name) => name.startsWith('crash-'))).toHaveLength(CRASH_LOGS_KEPT)
    expect(names.filter((name) => name.startsWith('draft-'))).toHaveLength(CRASH_LOGS_KEPT)
    // The oldest went; the newest stayed.
    expect(names.some((name) => name.includes('2026-01-01T00-00-00-000Z'))).toBe(false)
    expect(names.some((name) => name.includes(`00-00-${String(CRASH_LOGS_KEPT + 2).padStart(2, '0')}`))).toBe(true)
  })

  it('never throws when the cache directory cannot be written', () => {
    const blocker = path.join(cache, 'a-file')
    fs.writeFileSync(blocker, 'x')
    process.env.XDG_CACHE_HOME = blocker
    expect(writeCrashLog({ source: 'render', error: new Error('x'), draft: 'd' })).toEqual({})
  })

  describe('summarizeError', () => {
    it('is the first line of the message', () => {
      expect(summarizeError(new Error('first line\nsecond line'))).toBe('first line')
    })

    it('falls back for an empty message, a non-Error and nothing', () => {
      expect(summarizeError(new Error(''))).toBe('Error')
      expect(summarizeError('plain')).toBe('plain')
      expect(summarizeError(undefined)).toBe('undefined')
      expect(summarizeError('')).toBe('Unknown error')
    })
  })
})
