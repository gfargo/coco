import { getCommitNote } from './notesData'

describe('getCommitNote', () => {
  it('returns the note body with the trailing newline stripped', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue('release blocked on #42\n'),
    }

    await expect(getCommitNote(git as never, 'abc123')).resolves.toBe('release blocked on #42')
    expect(git.raw).toHaveBeenCalledWith(['notes', 'show', 'abc123'])
  })

  it('preserves internal multi-line structure', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue('line one\nline two\n'),
    }

    await expect(getCommitNote(git as never, 'abc123')).resolves.toBe('line one\nline two')
  })

  it('resolves to undefined when the commit has no note', async () => {
    const git = {
      raw: jest.fn().mockRejectedValue(new Error('error: no note found for object abc123.')),
    }

    await expect(getCommitNote(git as never, 'abc123')).resolves.toBeUndefined()
  })

  it('resolves to undefined (best-effort) on any other failure', async () => {
    const git = {
      raw: jest.fn().mockRejectedValue(new Error('fatal: not a git repository')),
    }

    await expect(getCommitNote(git as never, 'abc123')).resolves.toBeUndefined()
  })
})
