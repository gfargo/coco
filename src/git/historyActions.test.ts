import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  amendHeadCommit,
  checkoutOrDeleteFromRef,
  cherryPickCommit,
  compareCommits,
  copyCommitHash,
  copyCommitMessage,
  createBranchFromCommit,
  createTagAtCommit,
  getReflogEntries,
  getRemoteCommitUrl,
  historyActionTestInternals,
  openCommitOnRemote,
  parseReflog,
  rewordHeadCommit,
  resetToCommit,
  revertCommit,
  autosquashRebase,
  createFixupCommit,
  startInteractiveRebase,
} from './historyActions'

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

  it('copies selected commit hash and message through the clipboard runner', async () => {
    const clipboard = jest.fn().mockResolvedValue(undefined)

    await expect(copyCommitHash(commit, clipboard)).resolves.toEqual({
      ok: true,
      message: 'Copied commit hash abcdef1',
    })
    await expect(copyCommitMessage(commit, clipboard)).resolves.toEqual({
      ok: true,
      message: 'Copied commit message abcdef1',
    })

    expect(clipboard).toHaveBeenNthCalledWith(1, commit.hash)
    expect(clipboard).toHaveBeenNthCalledWith(2, commit.message)
  })

  it('builds web commit URLs from common remote URL formats', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue('git@github.com:gfargo/coco.git\n'),
    }

    await expect(getRemoteCommitUrl(git as never, commit.hash)).resolves.toBe(
      'https://github.com/gfargo/coco/commit/abcdef1234567890'
    )
    expect(historyActionTestInternals.normalizeRemoteUrl('https://github.com/gfargo/coco.git')).toBe(
      'https://github.com/gfargo/coco'
    )
  })

  it('opens selected commits on the inferred remote URL', async () => {
    const openUrl = jest.fn().mockResolvedValue(undefined)
    const git = {
      raw: jest.fn().mockResolvedValue('git@github.com:gfargo/coco.git\n'),
    }

    await expect(openCommitOnRemote(git as never, commit, openUrl)).resolves.toEqual({
      ok: true,
      message: 'Opened abcdef1',
      details: ['https://github.com/gfargo/coco/commit/abcdef1234567890'],
    })
    expect(openUrl).toHaveBeenCalledWith('https://github.com/gfargo/coco/commit/abcdef1234567890')
  })

  it('compares two commits with a lazy diff stat', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(' src/a.ts | 2 ++\n 1 file changed, 2 insertions(+)\n'),
    }
    const target = {
      hash: 'fedcba9876543210',
      shortHash: 'fedcba9',
      message: 'fix: target',
    }

    await expect(compareCommits(git as never, commit, target)).resolves.toEqual({
      ok: true,
      message: 'Compared abcdef1..fedcba9',
      details: [
        'src/a.ts | 2 ++',
        '1 file changed, 2 insertions(+)',
      ],
    })
    expect(git.raw).toHaveBeenCalledWith([
      'diff',
      '--stat',
      '--color=never',
      'abcdef1234567890..fedcba9876543210',
    ])
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

  it('parses and loads reflog entries', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue('HEAD@{0}\x1fabc1234\x1fcommit: feat: one\nHEAD@{1}\x1fdef5678\x1freset: moving to HEAD~1\n'),
    }

    expect(parseReflog('HEAD@{0}\x1fabc1234\x1fcommit: feat: one\n')).toEqual([
      {
        selector: 'HEAD@{0}',
        hash: 'abc1234',
        subject: 'commit: feat: one',
      },
    ])
    await expect(getReflogEntries(git as never, 2)).resolves.toEqual([
      {
        selector: 'HEAD@{0}',
        hash: 'abc1234',
        subject: 'commit: feat: one',
      },
      {
        selector: 'HEAD@{1}',
        hash: 'def5678',
        subject: 'reset: moving to HEAD~1',
      },
    ])
    expect(git.raw).toHaveBeenCalledWith([
      'reflog',
      '--date=short',
      '--max-count=2',
      '--pretty=format:%gd%x1f%h%x1f%gs',
    ])
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
