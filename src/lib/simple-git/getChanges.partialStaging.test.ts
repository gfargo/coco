import { SimpleGit } from 'simple-git'
import { deriveStatus } from '../../test/builders/makeFakeGit'
import { getChanges } from './getChanges'

// #2129 — a file staged AND edited on disk used to land in `staged` and
// `unstaged` as the SAME object, so the second assignment overwrote the
// first's status/summary. Unmocked getStatus/getSummaryText on purpose.
describe('getChanges with a partially staged file', () => {
  it('keeps independent staged and unstaged entries (AM)', async () => {
    const git = {
      status: jest
        .fn()
        .mockResolvedValue(deriveStatus([{ path: 'new.txt', index: 'A', working_dir: 'M' }])),
    } as unknown as SimpleGit

    const { staged, unstaged } = await getChanges({ git })

    expect(staged).toHaveLength(1)
    expect(unstaged).toHaveLength(1)
    expect(staged[0]).not.toBe(unstaged[0])
    expect(staged[0].status).toBe('added')
    expect(unstaged[0].status).toBe('modified')
  })
})
