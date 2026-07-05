import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit, type SimpleGit } from 'simple-git'
import {
  applyConflictResolution,
  getConflictFileRegions,
  parseConflictRegions,
} from './conflictRegionActions'

const CONFLICT = [
  'line 1',
  '<<<<<<< HEAD',
  'ours A',
  '=======',
  'theirs A',
  '>>>>>>> feature/x',
  'line 2',
  '<<<<<<< HEAD',
  'ours B1',
  'ours B2',
  '=======',
  'theirs B',
  '>>>>>>> feature/x',
  'line 3',
  '',
].join('\n')

describe('parseConflictRegions', () => {
  it('parses multiple regions with labels, sides, and 1-based line spans', () => {
    const { regions } = parseConflictRegions(CONFLICT)
    expect(regions).toHaveLength(2)
    expect(regions[0]).toMatchObject({
      index: 0,
      startLine: 2,
      endLine: 6,
      oursLabel: 'HEAD',
      theirsLabel: 'feature/x',
      ours: ['ours A'],
      theirs: ['theirs A'],
    })
    expect(regions[0].base).toBeUndefined()
    expect(regions[1]).toMatchObject({
      index: 1,
      ours: ['ours B1', 'ours B2'],
      theirs: ['theirs B'],
    })
  })

  it('captures the diff3 base section when present', () => {
    const { regions } = parseConflictRegions([
      '<<<<<<< HEAD',
      'ours',
      '||||||| merged common ancestors',
      'base line',
      '=======',
      'theirs',
      '>>>>>>> other',
      '',
    ].join('\n'))
    expect(regions).toHaveLength(1)
    expect(regions[0].base).toEqual(['base line'])
    expect(regions[0].ours).toEqual(['ours'])
    expect(regions[0].theirs).toEqual(['theirs'])
  })

  it('ignores an unterminated trailing region instead of mis-attributing the tail', () => {
    const { regions } = parseConflictRegions('<<<<<<< HEAD\nours only\n=======\nno closer\n')
    expect(regions).toHaveLength(0)
  })

  it('returns no regions for a clean file', () => {
    expect(parseConflictRegions('a\nb\nc\n').regions).toHaveLength(0)
  })

  it('does not treat content lines starting with marker characters as markers (#1395)', () => {
    // A setext underline (8+ '=') and a divider comment inside "ours"
    // used to flip the parser into theirs early — the real separator
    // then landed inside theirs, and accept-ours/theirs (and the AI
    // resolver) operated on wrong side contents.
    const { regions } = parseConflictRegions([
      '<<<<<<< HEAD',
      'Title',
      '========',
      '//======= divider comment',
      'ours tail',
      '=======',
      'theirs line',
      '>>>>>>> feature/x',
      '',
    ].join('\n'))
    expect(regions).toHaveLength(1)
    expect(regions[0].ours).toEqual(['Title', '========', '//======= divider comment', 'ours tail'])
    expect(regions[0].theirs).toEqual(['theirs line'])
  })

  it('does not open a region on 8+ angle brackets, and tolerates CRLF markers', () => {
    const clean = parseConflictRegions('<<<<<<<< not a marker\nplain\n')
    expect(clean.regions).toHaveLength(0)

    const crlf = parseConflictRegions(
      '<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> other\r\n'
    )
    expect(crlf.regions).toHaveLength(1)
    expect(crlf.regions[0].oursLabel).toBe('HEAD')
    expect(crlf.regions[0].theirsLabel).toBe('other')
  })
})

describe('apply/read against a real worktree file', () => {
  let dir: string
  let git: SimpleGit

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-conflict-'))
    execFileSync('git', ['init'], { cwd: dir })
    writeFileSync(join(dir, 'app.txt'), CONFLICT)
    git = simpleGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('getConflictFileRegions reads and parses the worktree file', async () => {
    const result = await getConflictFileRegions(git, 'app.txt')
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.regions).toHaveLength(2)
  })

  it('replaces one region by content identity and reports the remainder', async () => {
    const { regions } = parseConflictRegions(CONFLICT)
    const result = await applyConflictResolution(git, 'app.txt', regions[0], 'resolved A\n')
    expect(result).toMatchObject({ ok: true, remainingRegions: 1 })

    const written = readFileSync(join(dir, 'app.txt'), 'utf8')
    expect(written).toContain('line 1\nresolved A\nline 2')
    expect(written).not.toContain('theirs A')
    // Second region untouched.
    expect(written).toContain('ours B1')
    expect(written).toContain('>>>>>>> feature/x')
  })

  it('survives accepting regions in any order (content match, not line numbers)', async () => {
    const { regions } = parseConflictRegions(CONFLICT)
    // Accept the SECOND region first — the first region's line span is
    // then stale, which is exactly why matching is by content.
    expect(await applyConflictResolution(git, 'app.txt', regions[1], 'resolved B')).toMatchObject({
      ok: true,
      remainingRegions: 1,
    })
    expect(await applyConflictResolution(git, 'app.txt', regions[0], 'resolved A')).toMatchObject({
      ok: true,
      remainingRegions: 0,
    })
    const written = readFileSync(join(dir, 'app.txt'), 'utf8')
    expect(written).toBe('line 1\nresolved A\nline 2\nresolved B\nline 3\n')
  })

  it('refuses when the region no longer exists on disk', async () => {
    const { regions } = parseConflictRegions(CONFLICT)
    writeFileSync(join(dir, 'app.txt'), 'totally different\n')
    const result = await applyConflictResolution(git, 'app.txt', regions[0], 'resolved')
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('changed on disk') })
  })

  it('an empty resolution deletes the whole block', async () => {
    const { regions } = parseConflictRegions(CONFLICT)
    const result = await applyConflictResolution(git, 'app.txt', regions[0], '')
    expect(result).toMatchObject({ ok: true })
    const written = readFileSync(join(dir, 'app.txt'), 'utf8')
    expect(written).toContain('line 1\nline 2')
  })

  it('refuses to read a path that escapes the worktree root', async () => {
    const result = await getConflictFileRegions(git, '../outside.txt')
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('outside worktree root'),
    })
  })

  it('refuses to write a path that escapes the worktree root', async () => {
    const { regions } = parseConflictRegions(CONFLICT)
    const result = await applyConflictResolution(git, '../outside.txt', regions[0], 'resolved')
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('outside worktree root'),
    })
  })
})
