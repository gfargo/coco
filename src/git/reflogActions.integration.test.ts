/**
 * Integration coverage for reflog global undo (#1361) against a REAL git
 * repository. The unit tests in reflogActions.test.ts mock `git.raw()`
 * entirely, which proves the control flow but never exercises `git`'s
 * actual `reflog` subject format — `planReflogUndo`'s checkout-detection
 * regex was written against documentation of that format, not a live
 * `git reflog` run. This file closes that gap: real commits, a real
 * branch switch, a real merge conflict, and real `reset --hard` /
 * `checkout` calls, all verified against the actual repo state after.
 */
import { createTempGitRepo, TempGitRepo } from '@gfargo/git-scenarios'
import { getReflogOverview } from './reflogData'
import { performReflogUndo, planReflogUndo } from './reflogActions'

jest.setTimeout(60000)

describe('reflog undo integration (#1361)', () => {
  const originalCwd = process.cwd()
  let repo: TempGitRepo

  beforeEach(async () => {
    repo = await createTempGitRepo()
    // getInProgressOperation resolves `git rev-parse --git-path <name>`,
    // which git returns as a path RELATIVE to the process cwd (not an
    // absolute path) — so the guard only sees the right `.git/` unless
    // the process is actually inside the repo. The real app always runs
    // from the repo root; this test replicates that instead of the
    // implicit assumption breaking silently.
    process.chdir(repo.path)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await repo.cleanup()
  })

  it('undoes a checkout by switching back to the previous branch', async () => {
    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')
    await repo.git.checkoutLocalBranch('feature')
    await repo.writeFile('feature.txt', 'work in progress\n')
    await repo.commitAll('feat: add feature file')
    await repo.git.checkout('main')

    const { entries } = await getReflogOverview(repo.git)
    // Real git reflog subject: "checkout: moving from feature to main" —
    // this is the exact format planReflogUndo's regex must match.
    expect(entries[0].subject).toBe('checkout: moving from feature to main')

    const plan = planReflogUndo(entries)
    expect(plan).toMatchObject({ kind: 'checkout', targetRef: 'feature' })

    const result = await performReflogUndo(repo.git, plan!)
    expect(result.ok).toBe(true)

    const branch = (await repo.git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    expect(branch).toBe('feature')
  })

  it('undoes a commit by resetting --hard to the previous HEAD', async () => {
    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')
    const beforeHash = (await repo.git.revparse(['HEAD'])).trim()

    await repo.writeFile('oops.txt', 'should be undone\n')
    await repo.commitAll('chore: oops commit')
    expect(await repo.exists('oops.txt')).toBe(true)

    const { entries } = await getReflogOverview(repo.git)
    const plan = planReflogUndo(entries)
    expect(plan?.kind).toBe('reset')

    const result = await performReflogUndo(repo.git, plan!)
    expect(result.ok).toBe(true)

    const afterHash = (await repo.git.revparse(['HEAD'])).trim()
    expect(afterHash).toBe(beforeHash)
    // reset --hard also restores the working tree, so the file the
    // undone commit added is gone, not just uncommitted.
    expect(await repo.exists('oops.txt')).toBe(false)
  })

  it('refuses to reset while a merge is in progress, leaving the conflict untouched', async () => {
    await repo.writeFile('shared.txt', 'main content\n')
    await repo.commitAll('chore: initial commit')

    await repo.git.checkoutLocalBranch('conflicting')
    await repo.writeFile('shared.txt', 'conflicting branch content\n')
    await repo.commitAll('feat: change on conflicting branch')

    await repo.git.checkout('main')
    await repo.writeFile('shared.txt', 'main branch content\n')
    await repo.commitAll('feat: change on main')

    // This merge fails with a real conflict, leaving MERGE_HEAD on disk —
    // exactly the state performReflogUndo's guard checks for.
    await expect(repo.git.merge(['conflicting'])).rejects.toThrow()
    expect(await repo.exists('.git/MERGE_HEAD')).toBe(true)

    const result = await performReflogUndo(repo.git, {
      description: 'x',
      commandPreview: 'git reset --hard HEAD@{1}',
      kind: 'reset',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('in-progress')
    // The guard must refuse BEFORE running reset — the conflict state
    // (and MERGE_HEAD) should be untouched, not silently discarded.
    expect(await repo.exists('.git/MERGE_HEAD')).toBe(true)
  })
})
