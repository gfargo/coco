import { SimpleGit } from 'simple-git'
import { capDiffLines, MAX_DIFF_LINES } from './capDiffLines'
import { getCompareDiff } from './compareData'
import { getStashDiff } from './stashData'

const hugePatch = (extra: number) =>
  Array.from({ length: MAX_DIFF_LINES + extra }, (_, i) => `+line ${i}`).join('\n')

describe('capDiffLines (#2209)', () => {
  it('returns the same array when within the cap', () => {
    const lines = ['a', 'b']
    expect(capDiffLines(lines)).toBe(lines)
    const atCap = Array.from({ length: MAX_DIFF_LINES }, () => 'x')
    expect(capDiffLines(atCap)).toBe(atCap)
  })

  it('trims to the cap and appends a footer counting the dropped lines', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `l${i}`)
    const capped = capDiffLines(lines, 10)
    expect(capped.slice(0, 10)).toEqual(lines.slice(0, 10))
    expect(capped.slice(10)).toEqual(['', '… truncated (5 more lines — open in $EDITOR for the full diff)'])
  })
})

describe('compare and stash diffs are capped (#2209)', () => {
  it('getCompareDiff truncates a huge diff', async () => {
    const git = { raw: jest.fn().mockResolvedValue(hugePatch(300)) } as unknown as SimpleGit
    const lines = await getCompareDiff(git, 'main', 'feature')
    expect(lines).toHaveLength(MAX_DIFF_LINES + 2)
    expect(lines[lines.length - 1]).toMatch(/truncated \(300 more lines/)
  })

  it('getStashDiff truncates a huge diff', async () => {
    const git = { raw: jest.fn().mockResolvedValue(hugePatch(7)) } as unknown as SimpleGit
    const lines = await getStashDiff(git, 'stash@{0}')
    expect(lines).toHaveLength(MAX_DIFF_LINES + 2)
    expect(lines[lines.length - 1]).toMatch(/truncated \(7 more lines/)
  })

  it('leaves a normal diff untouched', async () => {
    const git = { raw: jest.fn().mockResolvedValue('a\nb') } as unknown as SimpleGit
    expect(await getStashDiff(git, 'stash@{0}')).toEqual(['a', 'b'])
  })
})
