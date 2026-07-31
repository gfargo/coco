import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  amendHeadCommit,
  checkoutOrDeleteFromRef,
  cherryPickCommit,
  cherryPickCommits,
  cherryPickRange,
  createBranchFromCommit,
  createTagAtCommit,
  defaultOpenUrlRunner,
  historyActionTestInternals,
  rewordHeadCommit,
  resetToCommit,
  restorePreviousHead,
  revertCommit,
  autosquashRebase,
  createFixupCommit,
  startInteractiveRebase,
} from './historyActions'

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: jest.fn(),
  spawn: jest.fn(),
}))

const mockedExecFile = execFile as unknown as jest.Mock

describe('log history actions', () => {
  const commit = {
    hash: 'abcdef1234567890',
    shortHash: 'abcdef1',
    message: 'feat: add history actions',
  }

  it('matches full and short selected hashes against HEAD', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890\n'),
    }

    await expect(historyActionTestInternals.isHeadCommit(git as never, 'abcdef1234567890')).resolves.toBe(true)
    await expect(historyActionTestInternals.isHeadCommit(git as never, 'abcdef1')).resolves.toBe(true)
    await expect(historyActionTestInternals.isHeadCommit(git as never, '1234567')).resolves.toBe(false)
  })

  describe('checkoutOrDeleteFromRef (#1383)', () => {
    // The ref-verify guard is the safety line: a stale selector
    // (`stash@{2}` after the stash list changed) used to be
    // indistinguishable from "path deleted at ref" and fell through
    // to `git rm --force`, deleting the user's file.
    it('refuses to touch the worktree when the ref does not resolve', async () => {
      const raw = jest.fn().mockImplementation(async (args: string[]) => {
        if (args[0] === 'rev-parse') {
          throw new Error("fatal: Needed a single revision")
        }
        return ''
      })
      const git = { raw }

      const result = await checkoutOrDeleteFromRef(git as never, 'stash@{2}', 'src/a.ts', 'stash@{2}')

      expect(result.ok).toBe(false)
      expect(result.message).toContain('no longer resolves')
      const destructive = raw.mock.calls.filter(([args]) => args[0] === 'rm' || args[0] === 'checkout')
      expect(destructive).toEqual([])
    })

    it('checks the file out when it exists at the ref', async () => {
      const raw = jest.fn().mockResolvedValue('')
      const git = { raw }

      const result = await checkoutOrDeleteFromRef(git as never, 'abc1234', 'src/a.ts', 'abc1234')

      expect(result).toEqual({ ok: true, message: 'Checked out src/a.ts from abc1234' })
      expect(raw).toHaveBeenCalledWith(['checkout', 'abc1234', '--', 'src/a.ts'])
    })

    it('mirrors a deletion only when the ref resolves but the path is absent', async () => {
      const raw = jest.fn().mockImplementation(async (args: string[]) => {
        if (args[0] === 'cat-file') {
          throw new Error('fatal: Not a valid object name')
        }
        return ''
      })
      const git = { raw }

      const result = await checkoutOrDeleteFromRef(git as never, 'abc1234', 'src/gone.ts', 'abc1234')

      expect(result).toEqual({
        ok: true,
        message: 'Removed src/gone.ts (mirrors deletion from abc1234)',
      })
      expect(raw).toHaveBeenCalledWith(['rm', '--force', '--quiet', '--', 'src/gone.ts'])
    })
  })

  it('amends HEAD with staged changes', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(amendHeadCommit(git as never, 'abcdef1')).resolves.toEqual({
      ok: true,
      message: 'Amended HEAD with staged changes',
    })

    expect(git.raw).toHaveBeenCalledWith(['commit', '--amend', '--no-edit'])
  })

  it('rewords HEAD with a trimmed message', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(rewordHeadCommit(git as never, 'abcdef1', '  feat: better title  ')).resolves.toEqual({
      ok: true,
      message: 'Reworded HEAD commit',
    })

    expect(git.raw).toHaveBeenCalledWith(['commit', '--amend', '-m', 'feat: better title'])
  })

  it('guards non-HEAD history edits', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn(),
    }

    await expect(amendHeadCommit(git as never, '1234567')).resolves.toEqual({
      ok: false,
      message: 'Amend is limited to HEAD. Select the latest commit first.',
    })
    await expect(rewordHeadCommit(git as never, '1234567', 'feat: title')).resolves.toEqual({
      ok: false,
      message: 'Reword is limited to HEAD. Select the latest commit first.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('rejects empty reword messages before invoking git', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn(),
    }

    await expect(rewordHeadCommit(git as never, 'abcdef1', '   ')).resolves.toEqual({
      ok: false,
      message: 'Reword cancelled: empty message.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('returns hook and validation failures as structured details', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn().mockRejectedValue(new Error([
        'commit-msg hook failed',
        'subject must be lower-case',
        'type must be one of feat, fix',
      ].join('\n'))),
    }

    await expect(amendHeadCommit(git as never, 'abcdef1')).resolves.toEqual({
      ok: false,
      message: 'commit-msg hook failed',
      details: [
        'subject must be lower-case',
        'type must be one of feat, fix',
      ],
    })
  })

  it('constructs cherry-pick and revert commands', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(cherryPickCommit(git as never, commit)).resolves.toEqual({
      ok: true,
      message: 'Cherry-picked abcdef1',
    })
    await expect(revertCommit(git as never, commit)).resolves.toEqual({
      ok: true,
      message: 'Reverted abcdef1',
    })

    expect(git.raw).toHaveBeenNthCalledWith(1, ['cherry-pick', commit.hash])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['revert', '--no-edit', commit.hash])
  })

  // #1361 — history is v-range only for multi-select; cherry-pick's own
  // range syntax replays the span in one command, unlike stash drop
  // there's no per-item ordering to get wrong here.
  describe('cherryPickRange', () => {
    const oldest = { hash: 'oldest1234567890', shortHash: 'oldest12', message: 'feat: oldest' }
    const newest = { hash: 'newest1234567890', shortHash: 'newest12', message: 'feat: newest' }

    it('constructs the oldest^..newest range command', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }
      await expect(cherryPickRange(git as never, oldest, newest)).resolves.toEqual({
        ok: true,
        message: 'Cherry-picked oldest12..newest12',
      })
      expect(git.raw).toHaveBeenCalledWith(['cherry-pick', 'oldest1234567890^..newest1234567890'])
    })

    it('delegates to the single-commit path when the range collapses to one commit', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }
      await expect(cherryPickRange(git as never, commit, commit)).resolves.toEqual({
        ok: true,
        message: 'Cherry-picked abcdef1',
      })
      expect(git.raw).toHaveBeenCalledWith(['cherry-pick', commit.hash])
    })

    it('blocks while another git operation is in progress, same guard as the single commit', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'coco-history-range-'))
      const mergeHead = join(tempDir, 'MERGE_HEAD')
      writeFileSync(mergeHead, oldest.hash)
      const git = {
        revparse: jest.fn().mockResolvedValue(mergeHead),
        raw: jest.fn(),
      }
      try {
        await expect(cherryPickRange(git as never, oldest, newest)).resolves.toEqual({
          ok: false,
          message: 'Finish or abort the in-progress merge before editing history.',
        })
        expect(git.raw).not.toHaveBeenCalled()
      } finally {
        rmSync(tempDir, { force: true, recursive: true })
      }
    })
  })

  // #1670 — used when a v-range display span isn't a contiguous ancestor
  // chain (e.g. rows interleaved from other branches); replays exactly
  // the given hashes instead of everything git would walk between them.
  describe('cherryPickCommits', () => {
    const oldest = { hash: 'oldest1234567890', shortHash: 'oldest12', message: 'feat: oldest' }
    const middle = { hash: 'middle1234567890', shortHash: 'middle12', message: 'feat: middle' }
    const newest = { hash: 'newest1234567890', shortHash: 'newest12', message: 'feat: newest' }

    it('constructs an explicit cherry-pick command, oldest-first', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }
      await expect(cherryPickCommits(git as never, [oldest, middle, newest])).resolves.toEqual({
        ok: true,
        message: 'Cherry-picked 3 commits',
      })
      expect(git.raw).toHaveBeenCalledWith(['cherry-pick', oldest.hash, middle.hash, newest.hash])
    })

    it('delegates to the single-commit path for one commit', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }
      await expect(cherryPickCommits(git as never, [commit])).resolves.toEqual({
        ok: true,
        message: 'Cherry-picked abcdef1',
      })
      expect(git.raw).toHaveBeenCalledWith(['cherry-pick', commit.hash])
    })

    it('reports no commit selected for an empty list', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn(),
      }
      await expect(cherryPickCommits(git as never, [])).resolves.toEqual({
        ok: false,
        message: 'No commit selected.',
      })
      expect(git.raw).not.toHaveBeenCalled()
    })

    it('blocks while another git operation is in progress, same guard as the range path', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'coco-history-explicit-'))
      const mergeHead = join(tempDir, 'MERGE_HEAD')
      writeFileSync(mergeHead, oldest.hash)
      const git = {
        revparse: jest.fn().mockResolvedValue(mergeHead),
        raw: jest.fn(),
      }
      try {
        await expect(cherryPickCommits(git as never, [oldest, middle, newest])).resolves.toEqual({
          ok: false,
          message: 'Finish or abort the in-progress merge before editing history.',
        })
        expect(git.raw).not.toHaveBeenCalled()
      } finally {
        rmSync(tempDir, { force: true, recursive: true })
      }
    })
  })

  it('constructs reset and rebase commands with recovery guidance', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(resetToCommit(git as never, commit, 'mixed')).resolves.toEqual({
      ok: true,
      message: 'Reset current branch to abcdef1 with --mixed',
      details: [
        'Recovery: use `git reflog` to find the previous HEAD.',
        'Then run `git reset --hard HEAD@{n}` if you need to undo this reset.',
      ],
    })
    await expect(startInteractiveRebase(git as never, commit)).resolves.toEqual({
      ok: true,
      message: 'Started interactive rebase from abcdef1',
      details: [
        'Recovery: use `git rebase --abort` while the rebase is in progress.',
        'After completion, use `git reflog` to recover the previous HEAD if needed.',
      ],
    })

    expect(git.raw).toHaveBeenNthCalledWith(1, ['reset', '--mixed', commit.hash])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['rebase', '-i', `${commit.hash}^`])
  })

  describe('restorePreviousHead (OSS-1606 undo-stack inverse for resetToCommit)', () => {
    it('defaults to --hard when no mode is given', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }

      await expect(restorePreviousHead(git as never, 'abcdef1234567890')).resolves.toEqual({
        ok: true,
        message: 'Restored HEAD to abcdef1',
      })
      expect(git.raw).toHaveBeenCalledWith(['reset', '--hard', 'abcdef1234567890'])
    })

    it.each(['soft', 'mixed', 'hard'] as const)(
      'mirrors a %s original reset with the matching mode',
      async (mode) => {
        const git = {
          revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
          raw: jest.fn().mockResolvedValue(''),
        }

        await expect(restorePreviousHead(git as never, 'abcdef1234567890', mode)).resolves.toEqual({
          ok: true,
          message: 'Restored HEAD to abcdef1',
        })
        expect(git.raw).toHaveBeenCalledWith(['reset', `--${mode}`, 'abcdef1234567890'])
      }
    )

    it('blocks while another git operation is in progress', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'coco-history-restore-'))
      const mergeHead = join(tempDir, 'MERGE_HEAD')
      writeFileSync(mergeHead, 'abcdef1234567890')
      const git = {
        revparse: jest.fn().mockResolvedValue(mergeHead),
        raw: jest.fn(),
      }
      try {
        await expect(restorePreviousHead(git as never, 'abcdef1234567890')).resolves.toEqual({
          ok: false,
          message: 'Finish or abort the in-progress merge before editing history.',
        })
        expect(git.raw).not.toHaveBeenCalled()
      } finally {
        rmSync(tempDir, { force: true, recursive: true })
      }
    })
  })

  it('creates a fixup commit targeting the cursored commit', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(createFixupCommit(git as never, commit)).resolves.toEqual({
      ok: true,
      message: 'Created fixup for abcdef1 — will squash on the next autosquash rebase',
    })
    expect(git.raw).toHaveBeenCalledWith(['commit', '--fixup', commit.hash])
  })

  it('autosquashes with the sequence editor disabled and recovery guidance', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(autosquashRebase(git as never, commit)).resolves.toEqual({
      ok: true,
      message: 'Autosquashed fixups into abcdef1',
      details: ['Recovery: `git reflog` holds the pre-rebase HEAD if you need it back.'],
    })
    // -c keeps the editor override scoped to this invocation — mutating
    // the shared instance env would break the user-facing `i` rebase.
    expect(git.raw).toHaveBeenCalledWith(
      ['-c', 'sequence.editor=true', 'rebase', '-i', '--autosquash', `${commit.hash}^`]
    )
  })

  it('fixup and autosquash refuse a missing target', async () => {
    const git = { revparse: jest.fn(), raw: jest.fn() }
    await expect(createFixupCommit(git as never, undefined)).resolves.toMatchObject({ ok: false })
    await expect(autosquashRebase(git as never, undefined)).resolves.toMatchObject({ ok: false })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('blocks destructive history edits while another git operation is in progress', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'coco-history-'))
    const mergeHead = join(tempDir, 'MERGE_HEAD')

    writeFileSync(mergeHead, commit.hash)

    const git = {
      revparse: jest.fn().mockResolvedValue(mergeHead),
      raw: jest.fn(),
    }

    try {
      await expect(cherryPickCommit(git as never, commit)).resolves.toEqual({
        ok: false,
        message: 'Finish or abort the in-progress merge before editing history.',
      })
      expect(git.raw).not.toHaveBeenCalled()
    } finally {
      rmSync(tempDir, {
        force: true,
        recursive: true,
      })
    }
  })

  // GitKraken-style "create branch here" / "create tag here" — the
  // user picks a historical commit, names the ref, and we mark the
  // commit without touching HEAD.
  describe('createBranchFromCommit / createTagAtCommit', () => {
    it('runs git branch <name> <sha> for a selected commit (does not switch)', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }

      await expect(createBranchFromCommit(git as never, 'feature/x', commit)).resolves.toEqual({
        ok: true,
        message: 'Created branch feature/x at abcdef1',
      })

      expect(git.raw).toHaveBeenCalledWith(['branch', 'feature/x', commit.hash])
    })

    it('runs git tag <name> <sha> for a selected commit (lightweight)', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }

      await expect(createTagAtCommit(git as never, 'v1.0.0', commit)).resolves.toEqual({
        ok: true,
        message: 'Created tag v1.0.0 at abcdef1',
      })

      expect(git.raw).toHaveBeenCalledWith(['tag', 'v1.0.0', commit.hash])
    })

    it('trims whitespace from the supplied name before invoking git', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }

      await expect(createBranchFromCommit(git as never, '  feature/x  ', commit)).resolves.toEqual({
        ok: true,
        message: 'Created branch feature/x at abcdef1',
      })

      expect(git.raw).toHaveBeenCalledWith(['branch', 'feature/x', commit.hash])
    })

    it('rejects missing commits and empty names without invoking git', async () => {
      const git = {
        revparse: jest.fn(),
        raw: jest.fn(),
      }

      await expect(createBranchFromCommit(git as never, 'feature/x', undefined)).resolves.toEqual({
        ok: false,
        message: 'No commit selected.',
      })
      await expect(createTagAtCommit(git as never, 'v1.0.0', undefined)).resolves.toEqual({
        ok: false,
        message: 'No commit selected.',
      })
      await expect(createBranchFromCommit(git as never, '   ', commit)).resolves.toEqual({
        ok: false,
        message: 'Branch name required.',
      })
      await expect(createTagAtCommit(git as never, '   ', commit)).resolves.toEqual({
        ok: false,
        message: 'Tag name required.',
      })
      expect(git.raw).not.toHaveBeenCalled()
    })

    it('rejects a flag-like name to avoid arg injection', async () => {
      const git = {
        revparse: jest.fn(),
        raw: jest.fn(),
      }

      await expect(createBranchFromCommit(git as never, '-D', commit)).resolves.toEqual({
        ok: false,
        message: "Branch name '-D' cannot start with '-'.",
      })
      await expect(createTagAtCommit(git as never, '-D', commit)).resolves.toEqual({
        ok: false,
        message: "Tag name '-D' cannot start with '-'.",
      })
      expect(git.raw).not.toHaveBeenCalled()
      expect(git.revparse).not.toHaveBeenCalled()
    })

    it('blocks while another git operation is in progress', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'coco-history-here-'))
      const mergeHead = join(tempDir, 'MERGE_HEAD')

      writeFileSync(mergeHead, commit.hash)

      const git = {
        revparse: jest.fn().mockResolvedValue(mergeHead),
        raw: jest.fn(),
      }

      try {
        await expect(createBranchFromCommit(git as never, 'feature/x', commit)).resolves.toEqual({
          ok: false,
          message: 'Finish or abort the in-progress merge before editing history.',
        })
        await expect(createTagAtCommit(git as never, 'v1.0.0', commit)).resolves.toEqual({
          ok: false,
          message: 'Finish or abort the in-progress merge before editing history.',
        })
        expect(git.raw).not.toHaveBeenCalled()
      } finally {
        rmSync(tempDir, {
          force: true,
          recursive: true,
        })
      }
    })

    it('surfaces git failures (e.g. ref already exists) as structured details', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockRejectedValue(new Error([
          "fatal: a branch named 'feature/x' already exists",
        ].join('\n'))),
      }

      await expect(createBranchFromCommit(git as never, 'feature/x', commit)).resolves.toMatchObject({
        ok: false,
        message: "fatal: a branch named 'feature/x' already exists",
      })
    })
  })
})

describe('defaultOpenUrlRunner', () => {
  const originalPlatform = process.platform

  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform })
  }

  beforeEach(() => {
    mockedExecFile.mockReset()
    mockedExecFile.mockImplementation((_command, _args, callback) => callback(null))
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  it('rejects non-http(s) URLs before launching anything', async () => {
    await expect(defaultOpenUrlRunner('javascript:alert(1)')).rejects.toThrow(/unsupported URL/)
    await expect(defaultOpenUrlRunner('not a url')).rejects.toThrow(/invalid URL/)
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it('opens Windows URLs via rundll32 instead of `cmd /c start`, avoiding cmd.exe shell parsing (#1900)', async () => {
    setPlatform('win32')

    // A remote-derived URL containing shell metacharacters (e.g. `&calc`)
    // must never reach cmd.exe, which would parse it as a second command.
    const url = 'https://example.com/a&calc/b'
    await defaultOpenUrlRunner(url)

    expect(mockedExecFile).toHaveBeenCalledTimes(1)
    const [command, args] = mockedExecFile.mock.calls[0]
    expect(command).toBe('rundll32')
    expect(args).toEqual(['url.dll,FileProtocolHandler', url])
    expect(command).not.toBe('cmd')
  })

  it('opens macOS URLs via `open`', async () => {
    setPlatform('darwin')

    await defaultOpenUrlRunner('https://example.com/repo')

    expect(mockedExecFile).toHaveBeenCalledWith('open', ['https://example.com/repo'], expect.any(Function))
  })

  it('opens Linux URLs via `xdg-open`', async () => {
    setPlatform('linux')

    await defaultOpenUrlRunner('https://example.com/repo')

    expect(mockedExecFile).toHaveBeenCalledWith('xdg-open', ['https://example.com/repo'], expect.any(Function))
  })
})

describe('historyActionTestInternals.assertOpenableUrl', () => {
  it('accepts well-formed http(s) URLs', () => {
    expect(() => historyActionTestInternals.assertOpenableUrl('https://github.com/gfargo/coco')).not.toThrow()
    expect(() => historyActionTestInternals.assertOpenableUrl('http://example.com')).not.toThrow()
  })

  it('rejects unparseable and non-http(s) URLs', () => {
    expect(() => historyActionTestInternals.assertOpenableUrl('not a url')).toThrow(/invalid URL/)
    expect(() => historyActionTestInternals.assertOpenableUrl('file:///etc/passwd')).toThrow(/unsupported URL/)
    expect(() => historyActionTestInternals.assertOpenableUrl('javascript:alert(1)')).toThrow(/unsupported URL/)
  })
})
