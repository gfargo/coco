import { checkoutReflogEntry } from './reflogActions'
import { ReflogViewEntry } from './reflogData'

function entry(overrides: Partial<ReflogViewEntry> = {}): ReflogViewEntry {
  return {
    selector: 'HEAD@{2}',
    hash: 'abc1234',
    relativeDate: '2 hours ago',
    subject: 'commit: earlier work',
    ...overrides,
  }
}

describe('reflog actions', () => {
  it('checks out the entry commit (detaches HEAD)', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    const result = await checkoutReflogEntry(git as never, entry())
    expect(git.raw).toHaveBeenCalledWith(['checkout', 'abc1234'])
    expect(result).toEqual({
      ok: true,
      message: 'Checked out HEAD@{2} (abc1234) — HEAD is now detached.',
    })
  })

  it('returns a friendly result when no entry is provided', async () => {
    const git = { raw: jest.fn() }
    const result = await checkoutReflogEntry(git as never, undefined as never)
    expect(result.ok).toBe(false)
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('surfaces git errors as ok: false', async () => {
    const git = { raw: jest.fn().mockRejectedValue(new Error('pathspec did not match')) }
    const result = await checkoutReflogEntry(git as never, entry())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('pathspec did not match')
  })
})
