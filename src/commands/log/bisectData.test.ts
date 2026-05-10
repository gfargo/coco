import { SimpleGit } from 'simple-git'
import { getBisectCompletion, getBisectStatus, parseBisectLog } from './bisectData'

jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(false),
  }
})

import { existsSync } from 'fs'
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>

describe('parseBisectLog', () => {
  it('returns an empty list for empty input', () => {
    expect(parseBisectLog('')).toEqual([])
    expect(parseBisectLog('\n\n')).toEqual([])
  })

  it('parses command rows for start / good / bad / skip', () => {
    const log = [
      'git bisect start',
      'git bisect bad abc1234',
      'git bisect good def5678',
      'git bisect skip 9012abcd',
    ].join('\n')

    expect(parseBisectLog(log)).toEqual([
      { kind: 'start', sha: undefined, raw: 'git bisect start' },
      { kind: 'bad', sha: 'abc1234', raw: 'git bisect bad abc1234' },
      { kind: 'good', sha: 'def5678', raw: 'git bisect good def5678' },
      { kind: 'skip', sha: '9012abcd', raw: 'git bisect skip 9012abcd' },
    ])
  })

  it('parses comment rows with the [sha] subject form', () => {
    const log = '# bad: [abc1234] feat: add the bug'

    expect(parseBisectLog(log)).toEqual([
      {
        kind: 'bad',
        sha: 'abc1234',
        subject: 'feat: add the bug',
        raw: '# bad: [abc1234] feat: add the bug',
      },
    ])
  })

  it('falls back to unknown kind for headers and free-form comments', () => {
    const log = [
      '# status: bisecting',
      '# first bad commit: [abc1234] commit subject',
      'random unparseable text',
    ].join('\n')

    expect(parseBisectLog(log)).toEqual([
      { kind: 'unknown', raw: '# status: bisecting' },
      { kind: 'unknown', raw: '# first bad commit: [abc1234] commit subject' },
      { kind: 'unknown', raw: 'random unparseable text' },
    ])
  })

  it('captures only the first ref token when a command lists multiple', () => {
    // git bisect start records a `start` line followed by command
    // rows; this guard means the parser doesn't accidentally swallow
    // an entire trailing list as one ref.
    const log = 'git bisect bad abc1234 def5678'
    expect(parseBisectLog(log)).toEqual([
      { kind: 'bad', sha: 'abc1234', raw: 'git bisect bad abc1234 def5678' },
    ])
  })

  it('parses a `git bisect start <bad> <good>` row with both refs, capturing only the first', () => {
    // The `start` command takes its own bad/good arguments. We capture
    // the first ref (the bad commit) for display purposes; downstream
    // surfaces don't currently render the start args, but the log
    // entry should still parse without falling into the 'unknown' bucket.
    const log = 'git bisect start abc1234 def5678'
    expect(parseBisectLog(log)).toEqual([
      { kind: 'start', sha: 'abc1234', raw: 'git bisect start abc1234 def5678' },
    ])
  })

  it('preserves subjects with quotes / parentheses / colons in comment rows', () => {
    // Real-world commit subjects routinely contain conventional-commit
    // scope parens, quoted strings, and colons. The regex must not
    // truncate at the first inline ':' or get confused by the quoting.
    const log = '# bad: [abc1234] feat(parser): handle "quoted" inputs (#42)'
    expect(parseBisectLog(log)).toEqual([
      {
        kind: 'bad',
        sha: 'abc1234',
        subject: 'feat(parser): handle "quoted" inputs (#42)',
        raw: '# bad: [abc1234] feat(parser): handle "quoted" inputs (#42)',
      },
    ])
  })

  it('falls through to unknown for `git bisect <verb>` rows we do not classify', () => {
    // git supports `git bisect run <cmd>`, `git bisect view`, `git bisect
    // visualize`, etc. The parser only classifies the four user-decision
    // verbs (start / good / bad / skip). Anything else stays as 'unknown'
    // so the surface can dim it without crashing on a custom verb.
    const log = [
      'git bisect view --oneline',
      'git bisect run npm test',
      'git bisect replay /tmp/log',
    ].join('\n')

    const parsed = parseBisectLog(log)
    expect(parsed).toHaveLength(3)
    expect(parsed.every((entry) => entry.kind === 'unknown')).toBe(true)
  })

  it('handles a multi-line log mixing command rows and comment rows in any order', () => {
    // git bisect log emits a mix of executable command rows + `#`-prefixed
    // comment rows that record what each step landed on. The parser must
    // keep them both, in order.
    const log = [
      '# status: bisecting',
      'git bisect start',
      '# bad: [abc1234] feat: introduces the bug',
      'git bisect bad abc1234',
      '# good: [def5678] feat: previous-known-good',
      'git bisect good def5678',
    ].join('\n')

    const parsed = parseBisectLog(log)
    expect(parsed.map((e) => e.kind)).toEqual([
      'unknown', 'start', 'bad', 'bad', 'good', 'good',
    ])
    // Comment rows keep their parsed sha + subject; command rows keep
    // only the sha.
    expect(parsed[2]).toMatchObject({ kind: 'bad', sha: 'abc1234', subject: 'feat: introduces the bug' })
    // Command-row entries (parsed[3]) have no subject field — only
    // comment rows carry the parsed subject text.
    expect(parsed[3]).toMatchObject({ kind: 'bad', sha: 'abc1234' })
    expect(parsed[3].subject).toBeUndefined()
  })
})

describe('getBisectStatus', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockExistsSync.mockReturnValue(false)
  })

  it('returns inactive status when BISECT_LOG does not exist', async () => {
    const revparse = jest.fn().mockResolvedValue('/repo/.git/BISECT_LOG\n')
    mockExistsSync.mockReturnValue(false)
    const git = { revparse } as unknown as SimpleGit

    const status = await getBisectStatus(git)

    expect(status).toEqual({ active: false, currentSha: '', log: [] })
  })

  it('returns active status with parsed log when BISECT_LOG exists', async () => {
    mockExistsSync.mockReturnValue(true)
    const revparse = jest.fn()
      .mockResolvedValueOnce('/repo/.git/BISECT_LOG\n')
      .mockResolvedValueOnce('abc1234567890\n')
    const raw = jest.fn().mockResolvedValue(
      [
        'git bisect start',
        'git bisect bad abc1234',
        'git bisect good def5678',
      ].join('\n')
    )
    const git = { revparse, raw } as unknown as SimpleGit

    const status = await getBisectStatus(git)

    expect(status.active).toBe(true)
    expect(status.currentSha).toBe('abc1234567890')
    expect(status.log).toHaveLength(3)
    expect(status.log[1]).toEqual({ kind: 'bad', sha: 'abc1234', raw: 'git bisect bad abc1234' })
  })

  it('treats a bisect log read failure as "active but empty" rather than inactive', async () => {
    mockExistsSync.mockReturnValue(true)
    const revparse = jest.fn()
      .mockResolvedValueOnce('/repo/.git/BISECT_LOG\n')
      .mockResolvedValueOnce('abc1234\n')
    const raw = jest.fn().mockRejectedValue(new Error('not a bisect'))
    const git = { revparse, raw } as unknown as SimpleGit

    const status = await getBisectStatus(git)

    expect(status.active).toBe(true)
    expect(status.currentSha).toBe('abc1234')
    expect(status.log).toEqual([])
  })

  it('tolerates HEAD lookup failure by returning an empty currentSha', async () => {
    mockExistsSync.mockReturnValue(true)
    const revparse = jest.fn()
      .mockResolvedValueOnce('/repo/.git/BISECT_LOG\n')
      .mockRejectedValueOnce(new Error('detached'))
    const raw = jest.fn().mockResolvedValue('git bisect start\n')
    const git = { revparse, raw } as unknown as SimpleGit

    const status = await getBisectStatus(git)

    expect(status.active).toBe(true)
    expect(status.currentSha).toBe('')
    expect(status.log).toHaveLength(1)
  })

  it('treats an empty BISECT_LOG file as "active but no decisions yet"', async () => {
    // git can create BISECT_LOG with the start command and no
    // subsequent decisions. The file exists but `git bisect log` returns
    // an empty string (or just whitespace). Surface should still
    // route to the bisect view with the badge so the user knows the
    // session is active.
    mockExistsSync.mockReturnValue(true)
    const revparse = jest.fn()
      .mockResolvedValueOnce('/repo/.git/BISECT_LOG\n')
      .mockResolvedValueOnce('abc1234\n')
    const raw = jest.fn().mockResolvedValue('   \n\n')
    const git = { revparse, raw } as unknown as SimpleGit

    const status = await getBisectStatus(git)

    expect(status.active).toBe(true)
    expect(status.currentSha).toBe('abc1234')
    expect(status.log).toEqual([])
  })

  it('treats `git rev-parse --git-path` returning empty as inactive', async () => {
    // Defensive — if --git-path can't resolve the BISECT_LOG location
    // for some reason (worktree edge case, permissions), don't crash.
    // Treat as inactive rather than throwing.
    mockExistsSync.mockReturnValue(true)
    const revparse = jest.fn().mockResolvedValueOnce('\n')
    const git = { revparse } as unknown as SimpleGit

    const status = await getBisectStatus(git)

    expect(status.active).toBe(false)
  })
})

describe('getBisectCompletion', () => {
  it('returns undefined for a log without the first-bad terminator', () => {
    const log = parseBisectLog([
      'git bisect start',
      '# bad: [abc1234] feat: introduces the bug',
      'git bisect bad abc1234',
      '# good: [def5678] fix: previous state',
      'git bisect good def5678',
    ].join('\n'))
    expect(getBisectCompletion(log)).toBeUndefined()
  })

  it('extracts the sha + subject from the first-bad terminator', () => {
    const log = parseBisectLog([
      'git bisect start',
      'git bisect bad abc1234',
      'git bisect good def5678',
      '# first bad commit: [abc1234] feat: introduces the bug',
    ].join('\n'))
    expect(getBisectCompletion(log)).toEqual({
      sha: 'abc1234',
      subject: 'feat: introduces the bug',
    })
  })

  it('returns the most recent terminator when multiple are present', () => {
    // Defensive — a session that was completed, partially edited, and
    // re-completed could in principle have two `# first bad commit`
    // markers. Walk last-to-first so the latest one wins.
    const log = parseBisectLog([
      '# first bad commit: [abc1234] earlier conclusion',
      'git bisect start',
      '# first bad commit: [9999fff] later conclusion',
    ].join('\n'))
    expect(getBisectCompletion(log)?.sha).toBe('9999fff')
  })

  it('handles a terminator without subject text', () => {
    const log = parseBisectLog('# first bad commit: [abc1234]')
    expect(getBisectCompletion(log)).toEqual({
      sha: 'abc1234',
      subject: undefined,
    })
  })

  it('returns undefined for an empty log', () => {
    expect(getBisectCompletion([])).toBeUndefined()
  })
})
