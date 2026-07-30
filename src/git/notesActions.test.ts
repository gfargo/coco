import { addOrEditCommitNote } from './notesActions'

describe('addOrEditCommitNote', () => {
  it('adds/overwrites the note with -f so add and edit share one code path', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(addOrEditCommitNote(git as never, 'abc123def', 'blocked on #42')).resolves.toEqual({
      ok: true,
      message: 'Saved note on abc123de',
    })
    expect(git.raw).toHaveBeenCalledWith(['notes', 'add', '-f', '-m', 'blocked on #42', 'abc123def'])
  })

  it('surfaces the raw git error on failure', async () => {
    const git = {
      raw: jest.fn().mockRejectedValue(new Error('fatal: unable to write note object')),
    }

    await expect(addOrEditCommitNote(git as never, 'abc123def', 'blocked on #42')).resolves.toEqual({
      ok: false,
      message: 'fatal: unable to write note object',
    })
  })
})
