import { SimpleGit } from 'simple-git'
import { getBisectStatus, parseBisectLog } from './bisectData'

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
})
