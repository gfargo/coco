import {
  applyStash,
  applyStashKeepIndex,
  createStash,
  dropStash,
  dropStashes,
  popStash,
  renameStash,
  restoreStash,
  stashBranch,
} from './stashActions'
import { StashEntry } from './stashData'

const stash: StashEntry = {
  ref: 'stash@{0}',
  hash: 'abc123',
  baseHash: 'base111',
  date: '2026-04-28',
  branch: 'main',
  message: 'save docs',
  files: ['src/a.ts'],
}

function stashAt(index: number, overrides: Partial<StashEntry> = {}): StashEntry {
  return {
    ref: `stash@{${index}}`,
    hash: `hash${index}`,
    baseHash: `base${index}`,
    date: '2026-04-28',
    branch: 'main',
    message: `stash ${index}`,
    files: [],
    ...overrides,
  }
}

describe('log stash actions', () => {
  it('creates, applies, pops, and drops stashes with explicit refs', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await createStash(git as never, ' save docs ')
    await applyStash(git as never, stash)
    await popStash(git as never, stash)
    await dropStash(git as never, stash)

    expect(git.raw).toHaveBeenNthCalledWith(1, ['stash', 'push', '-u', '-m', 'save docs'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['stash', 'apply', 'stash@{0}'])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['stash', 'pop', 'stash@{0}'])
    expect(git.raw).toHaveBeenNthCalledWith(4, ['stash', 'drop', 'stash@{0}'])
  })

  it('creates a quick WIP stash (no -m) when the message is empty', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(createStash(git as never, '   ')).resolves.toEqual({
      ok: true,
      message: 'Created WIP stash',
    })
    // Empty message → bare `git stash push -u`; git supplies its own
    // "WIP on <branch>" subject. Naming is optional, not required.
    expect(git.raw).toHaveBeenCalledWith(['stash', 'push', '-u'])
  })

  it('builds create-stash args for the option variants', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }

    await createStash(git as never, 'wip', { keepIndex: true })
    expect(git.raw).toHaveBeenLastCalledWith(['stash', 'push', '-u', '--keep-index', '-m', 'wip'])

    await createStash(git as never, 'idx', { stagedOnly: true })
    // --staged is index-only: no -u, no --keep-index.
    expect(git.raw).toHaveBeenLastCalledWith(['stash', 'push', '--staged', '-m', 'idx'])

    await createStash(git as never, '', { paths: ['src/a.ts', 'src/b.ts'] })
    expect(git.raw).toHaveBeenLastCalledWith(['stash', 'push', '-u', '--', 'src/a.ts', 'src/b.ts'])

    // A single path containing spaces stays ONE pathspec (#1397) —
    // whitespace tokenization used to split it, and a fragment could
    // match a real directory and stash far more than asked.
    await createStash(git as never, '', { paths: ['my file.ts'] })
    expect(git.raw).toHaveBeenLastCalledWith(['stash', 'push', '-u', '--', 'my file.ts'])
  })

  it('applies with --index to restore the staged split', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(applyStashKeepIndex(git as never, stash)).resolves.toMatchObject({ ok: true })
    expect(git.raw).toHaveBeenCalledWith(['stash', 'apply', '--index', 'stash@{0}'])
  })

  it('creates a branch from a stash', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(stashBranch(git as never, stash, ' feat/x ')).resolves.toMatchObject({ ok: true })
    expect(git.raw).toHaveBeenCalledWith(['stash', 'branch', 'feat/x', 'stash@{0}'])
  })

  it('rejects a stash-branch with an empty name without touching git', async () => {
    const git = { raw: jest.fn() }
    await expect(stashBranch(git as never, stash, '   ')).resolves.toMatchObject({ ok: false })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('renames a stash: drop the original entry first, then re-store the commit under the new message', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    const at2: StashEntry = { ...stash, ref: 'stash@{2}', hash: 'deadbeef' }

    await expect(renameStash(git as never, at2, ' better name ')).resolves.toMatchObject({ ok: true })
    // Drop FIRST — `git stash store` no-ops while the commit is still in
    // the reflog, so storing first would do nothing and this drop would
    // hit the wrong entry. Dropping frees the reflog ref…
    expect(git.raw).toHaveBeenNthCalledWith(1, ['stash', 'drop', 'stash@{2}'])
    // …then store re-adds the same commit under the new message, keeping
    // git's `On <branch>:` prefix so the renamed stash retains its origin
    // branch (fixture branch = 'main') instead of rendering `on <unknown>`.
    expect(git.raw).toHaveBeenNthCalledWith(2, ['stash', 'store', '-m', 'On main: better name', 'deadbeef'])
  })

  it('renames without a branch prefix when the origin branch is unknown', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    const orphan: StashEntry = { ...stash, ref: 'stash@{0}', hash: 'cafef00d', branch: '<unknown>' }

    await expect(renameStash(git as never, orphan, 'just a name')).resolves.toMatchObject({ ok: true })
    expect(git.raw).toHaveBeenNthCalledWith(2, ['stash', 'store', '-m', 'just a name', 'cafef00d'])
  })

  it('refuses to rename with an empty message or missing hash', async () => {
    const git = { raw: jest.fn() }
    await expect(renameStash(git as never, stash, '  ')).resolves.toMatchObject({ ok: false })
    await expect(renameStash(git as never, { ...stash, hash: '' }, 'x')).resolves.toMatchObject({ ok: false })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('restores a dropped stash by hash (undo)', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(restoreStash(git as never, 'abc123', 'save docs')).resolves.toMatchObject({ ok: true })
    expect(git.raw).toHaveBeenCalledWith(['stash', 'store', '-m', 'save docs', 'abc123'])
  })

  // #1361 — batch drop for multi-select. The core correctness trap:
  // dropping stash@{0} renumbers every later entry down by one, so an
  // ascending or unordered loop would drop the wrong stash from the
  // second call onward.
  describe('dropStashes', () => {
    it('drops in descending stash@{N} order regardless of input order', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      // Passed in ASCENDING order on purpose — the function must
      // reorder before dropping.
      await dropStashes(git as never, [stashAt(0), stashAt(1), stashAt(2)])
      expect(git.raw).toHaveBeenNthCalledWith(1, ['stash', 'drop', 'stash@{2}'])
      expect(git.raw).toHaveBeenNthCalledWith(2, ['stash', 'drop', 'stash@{1}'])
      expect(git.raw).toHaveBeenNthCalledWith(3, ['stash', 'drop', 'stash@{0}'])
    })

    it('summarizes on full success', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const result = await dropStashes(git as never, [stashAt(0), stashAt(2)])
      expect(result).toEqual({ ok: true, message: 'Dropped 2 stashes: stash@{2}, stash@{0}' })
    })

    it('continues past a refusal and reports the raw per-stash failure in details', async () => {
      const git = {
        raw: jest.fn()
          .mockResolvedValueOnce('') // stash@{2} succeeds
          .mockRejectedValueOnce(new Error('fatal: could not drop stash')) // stash@{1} fails
          .mockResolvedValueOnce(''), // stash@{0} succeeds
      }
      const result = await dropStashes(git as never, [stashAt(0), stashAt(1), stashAt(2)])
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Dropped 2 of 3 stashes — 1 refused')
      expect(result.details).toEqual(['stash@{1}: fatal: could not drop stash'])
      // The refusal did NOT stop the batch — all three attempts ran.
      expect(git.raw).toHaveBeenCalledTimes(3)
    })

    it('a batch of one delegates to the single-stash behavior verbatim', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const result = await dropStashes(git as never, [stash])
      expect(result).toEqual({ ok: true, message: 'Dropped stash@{0}' })
    })

    it('refuses an empty batch without touching git', async () => {
      const git = { raw: jest.fn() }
      const result = await dropStashes(git as never, [])
      expect(result.ok).toBe(false)
      expect(git.raw).not.toHaveBeenCalled()
    })
  })
})
