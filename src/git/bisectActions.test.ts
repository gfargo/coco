import { SimpleGit } from 'simple-git'
import {
  bisectBad,
  bisectGood,
  bisectReset,
  bisectSkip,
  bisectStart,
  extractBisectRemainingHint,
} from './bisectActions'

describe('bisect action wrappers', () => {
  it('bisectStart invokes `git bisect start <bad> <good>`', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit
    await bisectStart(git, 'main', 'v1.0')
    expect(raw).toHaveBeenCalledWith(['bisect', 'start', 'main', 'v1.0'])
  })

  it('bisectGood / bisectBad / bisectSkip omit the ref when not provided', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit
    await bisectGood(git)
    await bisectBad(git)
    await bisectSkip(git)
    expect(raw.mock.calls).toEqual([
      [['bisect', 'good']],
      [['bisect', 'bad']],
      [['bisect', 'skip']],
    ])
  })

  it('bisectGood / bisectBad / bisectSkip pass the ref through when provided', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit
    await bisectGood(git, 'abc1234')
    await bisectBad(git, 'def5678')
    await bisectSkip(git, '9012abcd')
    expect(raw.mock.calls).toEqual([
      [['bisect', 'good', 'abc1234']],
      [['bisect', 'bad', 'def5678']],
      [['bisect', 'skip', '9012abcd']],
    ])
  })

  it('bisectReset invokes `git bisect reset`', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit
    await bisectReset(git)
    expect(raw).toHaveBeenCalledWith(['bisect', 'reset'])
  })
})

describe('extractBisectRemainingHint', () => {
  it('returns the canonical "Bisecting: N revisions left ..." line', () => {
    const stdout = [
      'Bisecting: 5 revisions left to test after this (roughly 2 steps)',
      '[abc1234567890] some commit subject',
    ].join('\n')
    expect(extractBisectRemainingHint(stdout))
      .toBe('Bisecting: 5 revisions left to test after this (roughly 2 steps)')
  })

  it('returns the "first bad commit" terminator when the run completed', () => {
    const stdout = [
      'abc1234567890 is the first bad commit',
      'commit abc1234567890',
      'Author: Coco Test',
    ].join('\n')
    expect(extractBisectRemainingHint(stdout))
      .toBe('abc1234567890 is the first bad commit')
  })

  it('returns undefined when neither marker appears (e.g. on bisect skip with no progress)', () => {
    expect(extractBisectRemainingHint('')).toBeUndefined()
    expect(extractBisectRemainingHint('some unrelated stdout')).toBeUndefined()
  })

  it('prefers the most recent marker when multiple are present', () => {
    // Defensive: a stale "Bisecting:" line earlier in the output
    // shouldn't shadow a later "first bad commit" terminator. The
    // function scans last-to-first so the latest hint wins.
    const stdout = [
      'Bisecting: 5 revisions left to test after this (roughly 2 steps)',
      'abc1234567890 is the first bad commit',
    ].join('\n')
    expect(extractBisectRemainingHint(stdout))
      .toBe('abc1234567890 is the first bad commit')
  })
})
