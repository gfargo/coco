import { rebaseOnto } from './rebaseActions'

describe('rebaseOnto', () => {
  it('runs a non-interactive `git rebase <ref>` (no -i, no editor)', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await rebaseOnto(git as never, 'main')
    expect(git.raw).toHaveBeenCalledWith(['rebase', 'main'])
    // Guard against an accidental interactive flag sneaking in — that
    // would shell into $GIT_EDITOR and hang the TUI.
    expect(git.raw.mock.calls[0][0]).not.toContain('-i')
    expect(git.raw.mock.calls[0][0]).not.toContain('--interactive')
  })

  it('trims whitespace around the ref', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await rebaseOnto(git as never, '  origin/main  ')
    expect(git.raw).toHaveBeenCalledWith(['rebase', 'origin/main'])
  })

  it('returns a friendly success message', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(rebaseOnto(git as never, 'develop')).resolves.toEqual({
      ok: true,
      message: 'Rebased onto develop',
    })
  })

  it('maps a conflict / failure to an error result carrying git\'s message', async () => {
    const git = {
      raw: jest.fn().mockRejectedValue(new Error('CONFLICT (content): Merge conflict in app.ts')),
    }
    await expect(rebaseOnto(git as never, 'main')).resolves.toEqual({
      ok: false,
      message: 'CONFLICT (content): Merge conflict in app.ts',
    })
  })

  it('rejects an empty ref without calling git', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(rebaseOnto(git as never, '   ')).resolves.toEqual({
      ok: false,
      message: 'Rebase target ref required.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('rejects a flag-like ref to avoid arg injection', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(rebaseOnto(git as never, '--onto=evil')).resolves.toEqual({
      ok: false,
      message: "Rebase target '--onto=evil' cannot start with '-'.",
    })
    expect(git.raw).not.toHaveBeenCalled()
  })
})
