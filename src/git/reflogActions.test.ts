import { checkoutReflogEntry, performReflogUndo, planReflogUndo, ReflogUndoPlan } from './reflogActions'
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

describe('planReflogUndo (#1361 global undo)', () => {
  it('returns undefined for an empty reflog', () => {
    expect(planReflogUndo([])).toBeUndefined()
  })

  it('inverts a checkout to switching back to the previous branch', () => {
    const plan = planReflogUndo([entry({ subject: 'checkout: moving from main to feature' })])
    expect(plan).toEqual({
      description: "Undo checkout: switch back to 'main' (currently on 'feature').",
      commandPreview: 'git checkout main',
      kind: 'checkout',
      targetRef: 'main',
    })
  })

  it('inverts a commit to reset --hard HEAD@{1}', () => {
    const plan = planReflogUndo([entry({ subject: 'commit: fix the thing' })])
    expect(plan).toEqual({
      description: 'Undo commit (fix the thing): reset --hard to the previous HEAD.',
      commandPreview: 'git reset --hard HEAD@{1}',
      kind: 'reset',
    })
  })

  it('inverts a rebase, merge, reset, or any other verb to reset --hard HEAD@{1}', () => {
    const plan = planReflogUndo([entry({ subject: 'rebase (finish): returning to refs/heads/feature' })])
    expect(plan?.kind).toBe('reset')
    expect(plan?.commandPreview).toBe('git reset --hard HEAD@{1}')
  })

  it('falls back to reset when a checkout subject does not match the expected shape', () => {
    // Defensive: an unusual/localized reflog subject shouldn't crash the
    // parse, just fall through to the always-safe reset inverse.
    const plan = planReflogUndo([entry({ subject: 'checkout: something unexpected' })])
    expect(plan?.kind).toBe('reset')
  })

  it('only looks at the reflog tip (most recent entry)', () => {
    const plan = planReflogUndo([
      entry({ subject: 'commit: latest' }),
      entry({ subject: 'checkout: moving from main to feature' }),
    ])
    expect(plan?.kind).toBe('reset')
  })
})

describe('performReflogUndo (#1361 global undo)', () => {
  // getInProgressOperation checks a handful of `.git/<state-file>` paths
  // via `git.revparse(['--git-path', ...])` — pointing every one at a
  // path that can't exist makes it resolve 'none', matching the
  // established mocking pattern in historyActions.test.ts.
  function gitMock(rawResult: unknown = '') {
    return {
      revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
      raw: jest.fn().mockResolvedValue(rawResult),
    }
  }

  it('checks out the target ref for a checkout-kind plan (no in-progress-operation check)', async () => {
    const git = { raw: jest.fn().mockResolvedValue(''), revparse: jest.fn() }
    const plan: ReflogUndoPlan = {
      description: 'x', commandPreview: 'git checkout main', kind: 'checkout', targetRef: 'main',
    }
    const result = await performReflogUndo(git as never, plan)
    expect(git.raw).toHaveBeenCalledWith(['checkout', 'main'])
    expect(git.revparse).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('runs reset --hard HEAD@{1} for a reset-kind plan', async () => {
    const git = gitMock()
    const plan: ReflogUndoPlan = { description: 'x', commandPreview: 'git reset --hard HEAD@{1}', kind: 'reset' }
    const result = await performReflogUndo(git as never, plan)
    expect(git.raw).toHaveBeenCalledWith(['reset', '--hard', 'HEAD@{1}'])
    expect(result.ok).toBe(true)
  })

  it('refuses to reset while a rebase/merge/etc. is in progress', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
      revparse: jest.fn().mockImplementation((args: string[]) =>
        args[1] === 'rebase-merge' ? Promise.resolve(__dirname) : Promise.resolve('/tmp/coco-missing-git-state')
      ),
    }
    const plan: ReflogUndoPlan = { description: 'x', commandPreview: 'git reset --hard HEAD@{1}', kind: 'reset' }
    const result = await performReflogUndo(git as never, plan)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('in-progress')
    expect(git.raw).not.toHaveBeenCalledWith(['reset', '--hard', 'HEAD@{1}'])
  })

  it('surfaces git errors as ok: false', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
      raw: jest.fn().mockRejectedValue(new Error('fatal: ambiguous argument')),
    }
    const plan: ReflogUndoPlan = { description: 'x', commandPreview: 'git reset --hard HEAD@{1}', kind: 'reset' }
    const result = await performReflogUndo(git as never, plan)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('fatal: ambiguous argument')
  })
})
