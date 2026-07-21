import { handleChangelogInput } from './input'
import { createLogInkState } from '../../runtime/inkViewModel'
import type { GitLogRow } from '../../../git/logData'

/**
 * Direct coverage for the changelog-view input handler extracted out of
 * `inkInput.ts`'s router (mirrors #1625 bisect surface). `inkInput.test.ts`
 * keeps its existing changelog cases too — those exercise the full
 * `getLogInkInputEvents` router and guard that it actually delegates
 * here; these tests pin down the handler's own logic in isolation.
 */

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
    parents: [],
    date: '2026-04-29',
    author: 'Coco Test',
    refs: [],
    message: 'Initial commit',
  },
]

const changelogState = () => createLogInkState(rows, { activeView: 'changelog' })

describe('handleChangelogInput', () => {
  it('returns null outside the changelog view', () => {
    const state = { ...changelogState(), activeView: 'history' as const }
    expect(handleChangelogInput(state, 'j', {}, { changelogLineCount: 50 })).toBeNull()
  })

  it('scrolls one line at a time on j/k', () => {
    expect(handleChangelogInput(changelogState(), 'j', {}, { changelogLineCount: 50 })).toEqual([
      { type: 'action', action: { type: 'pageChangelog', delta: 1, lineCount: 50 } },
    ])
    expect(handleChangelogInput(changelogState(), 'k', {}, { changelogLineCount: 50 })).toEqual([
      { type: 'action', action: { type: 'pageChangelog', delta: -1, lineCount: 50 } },
    ])
  })

  it('treats arrow keys as synonyms for j/k', () => {
    expect(handleChangelogInput(changelogState(), '', { downArrow: true }, { changelogLineCount: 50 })).toEqual([
      { type: 'action', action: { type: 'pageChangelog', delta: 1, lineCount: 50 } },
    ])
    expect(handleChangelogInput(changelogState(), '', { upArrow: true }, { changelogLineCount: 50 })).toEqual([
      { type: 'action', action: { type: 'pageChangelog', delta: -1, lineCount: 50 } },
    ])
  })

  it('scrolls by 10 lines on pgup/pgdn', () => {
    expect(handleChangelogInput(changelogState(), '', { pageDown: true }, { changelogLineCount: 50 })).toEqual([
      { type: 'action', action: { type: 'pageChangelog', delta: 10, lineCount: 50 } },
    ])
    expect(handleChangelogInput(changelogState(), '', { pageUp: true }, { changelogLineCount: 50 })).toEqual([
      { type: 'action', action: { type: 'pageChangelog', delta: -10, lineCount: 50 } },
    ])
  })

  it('swallows scroll keys instead of falling through while no content is loaded', () => {
    expect(handleChangelogInput(changelogState(), 'j', {}, {})).toEqual([])
    expect(handleChangelogInput(changelogState(), 'k', {}, {})).toEqual([])
    expect(handleChangelogInput(changelogState(), '', { pageDown: true }, {})).toEqual([])
    expect(handleChangelogInput(changelogState(), '', { pageUp: true }, {})).toEqual([])
  })

  it('dispatches y/E/c/r workflow events', () => {
    expect(handleChangelogInput(changelogState(), 'y', {}, {})).toEqual([{ type: 'yankChangelog' }])
    expect(handleChangelogInput(changelogState(), 'E', {}, {})).toEqual([{ type: 'openChangelogInEditor' }])
    expect(handleChangelogInput(changelogState(), 'c', {}, {})).toEqual([{ type: 'startCreatePullRequest' }])
    expect(handleChangelogInput(changelogState(), 'r', {}, {})).toEqual([{ type: 'regenerateChangelog' }])
  })

  it('returns null for an unmatched key', () => {
    expect(handleChangelogInput(changelogState(), 'q', {}, {})).toBeNull()
  })
})
