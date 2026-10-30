/**
 * #2159 — stash plumbing ("index on …", "untracked files on …") no longer
 * fills the TUI's history graph. Real repo, real `git stash`.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { computeGraphLayout } from '../workstation/chrome/graphLayout'
import type { LogArgv } from '../commands/log/config'
import { getCommitRows, getLogRows, getLogRowsAnchoredOn, hideStashHelperCommits, type GitLogRow } from './logData'
import { getStashCommitHashes } from './stashData'
import { applyLogInkAction, createLogInkState } from '../workstation/runtime/inkViewModel'

jest.setTimeout(30_000)

describe('stash helper commits in TUI history (#2159)', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const write = (name: string, content: string) => writeFileSync(join(dir, name), content)
  const argv = { interactive: true, all: true } as LogArgv

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-stash-helpers-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    write('a.txt', 'one\n')
    git('add', '.')
    git('commit', '-q', '-m', 'chore: initial')
    write('a.txt', 'two\n')
    git('commit', '-qam', 'chore: baseline')
    write('a.txt', 'stash me\n')
    git('stash', 'push', '-q', '-m', 'experiment-a')
    write('a.txt', 'again\n')
    write('new.txt', 'untracked\n')
    git('stash', 'push', '-q', '-u', '-m', 'experiment-b')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps the stash tips and real commits in state, drops the helpers', async () => {
    const stashes = await getStashCommitHashes(simpleGit(dir))
    const rows = await getLogRows(simpleGit(dir), argv, { extraRefs: stashes })
    const state = createLogInkState(rows)
    const subjects = state.commits.map((commit) => commit.message)

    expect(subjects.some((s) => /^(index on|untracked files on) /.test(s))).toBe(false)
    expect(subjects.filter((s) => /^On main: experiment-/.test(s))).toHaveLength(2)
    expect(subjects).toEqual(expect.arrayContaining(['chore: initial', 'chore: baseline']))
    expect(state.commits).toHaveLength(4)
    for (const tip of state.commits.filter((c) => stashes.includes(c.hash))) expect(tip.parents).toHaveLength(1)
    expect(computeGraphLayout(state.commits).maxWidth).toBeLessThanOrEqual(3)
  })

  // Review follow-up: hiding inside getLogRows made a full page come back
  // short, which every caller reads as "no more history", so paging stopped
  // after the first page. getLogRows returns git's rows; the paging offset
  // counts them; only the graph hides the plumbing.
  it('keeps paging counts on git\'s rows, not the hidden ones', async () => {
    const stashes = await getStashCommitHashes(simpleGit(dir))
    const rows = await getLogRows(simpleGit(dir), argv, { extraRefs: stashes })
    const fetched = getCommitRows(rows).length
    expect(fetched).toBeGreaterThan(4)
    expect(createLogInkState(rows).mainHistoryCommitCount).toBe(fetched)

    const state = applyLogInkAction(createLogInkState([]), { type: 'replaceRows', rows })
    expect(state.mainHistoryCommitCount).toBe(fetched)
    expect(state.commits).toHaveLength(4)
  })

  it('hides the helpers when cursor-sync merges a stash-anchored load', async () => {
    const [tip] = await getStashCommitHashes(simpleGit(dir))
    const anchored = await getLogRowsAnchoredOn(simpleGit(dir), argv, tip)
    const state = applyLogInkAction(createLogInkState([]), { type: 'appendRows', rows: anchored })
    const subjects = state.commits.map((c) => c.message)
    expect(subjects[0]).toMatch(/^On main: experiment-b/)
    expect(subjects.some((s) => /^(index on|untracked files on) /.test(s))).toBe(false)
  })

  it('leaves plain coco log output alone (no stash roots)', async () => {
    const rows = await getLogRows(simpleGit(dir), { interactive: true } as LogArgv, {})
    expect(getCommitRows(rows).map((c) => c.message)).toEqual(['chore: baseline', 'chore: initial'])
  })
})

describe('hideStashHelperCommits', () => {
  const commit = (hash: string, message: string, parents: string[]): GitLogRow =>
    ({ type: 'commit', graph: '', shortHash: hash, hash, parents, date: '', author: '', refs: [], message })

  it('does not touch an ordinary merge', () => {
    const rows = [commit('m', "Merge branch 'feature'", ['a', 'b']), commit('a', 'feat: a', []), commit('b', 'feat: b', [])]
    expect(hideStashHelperCommits([...rows])).toEqual(rows)
  })

  it('does not treat a merge titled like a stash as one without a helper parent', () => {
    const rows = [commit('m', 'On main: release notes', ['a', 'b']), commit('a', 'x', []), commit('b', 'y', [])]
    expect(hideStashHelperCommits([...rows])).toEqual(rows)
  })
})
