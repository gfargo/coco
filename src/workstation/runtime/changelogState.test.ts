import {
  DEFAULT_CHANGELOG_VIEW_STATE,
  applyChangelogAction,
  createChangelogState,
} from './changelogState'

/**
 * Coverage for the changelog slice extracted out of `inkViewModel.ts`
 * (#1723). Pure to `changelogView` + `changelogCache`; the composition
 * root only wires `pendingKey` clearing and per-repo cache resets
 * (`pushRepoFrame`/`popRepoFrame`, covered in `inkViewModel.test.ts`).
 */
describe('changelog slice', () => {
  it('starts idle with an empty cache', () => {
    const state = createChangelogState()
    expect(state.changelogView).toEqual(DEFAULT_CHANGELOG_VIEW_STATE)
    expect(state.changelogCache).toEqual({})
  })

  it('setChangelogLoading resets the view to a loading shape', () => {
    const state = applyChangelogAction(createChangelogState(), {
      type: 'setChangelogLoading',
      branch: 'main',
      baseLabel: 'origin/main',
    })
    expect(state.changelogView).toEqual({
      status: 'loading',
      branch: 'main',
      baseLabel: 'origin/main',
      scrollOffset: 0,
    })
  })

  it('setChangelogReady populates the view and caches the entry by branch', () => {
    const state = applyChangelogAction(createChangelogState(), {
      type: 'setChangelogReady',
      branch: 'main',
      baseLabel: 'origin/main',
      text: '## Changes',
      generatedAt: 1750000000000,
    })
    expect(state.changelogView).toEqual({
      status: 'ready',
      text: '## Changes',
      branch: 'main',
      baseLabel: 'origin/main',
      scrollOffset: 0,
    })
    expect(state.changelogCache.main).toEqual({
      text: '## Changes',
      baseLabel: 'origin/main',
      generatedAt: 1750000000000,
    })
  })

  it('setChangelogError puts the view in an error state without touching the cache', () => {
    let state = applyChangelogAction(createChangelogState(), {
      type: 'setChangelogReady',
      branch: 'main',
      baseLabel: 'origin/main',
      text: '## Changes',
      generatedAt: 1,
    })
    state = applyChangelogAction(state, {
      type: 'setChangelogError',
      branch: 'main',
      baseLabel: 'origin/main',
      error: 'LLM unreachable',
    })
    expect(state.changelogView).toEqual({
      status: 'error',
      branch: 'main',
      baseLabel: 'origin/main',
      error: 'LLM unreachable',
      scrollOffset: 0,
    })
    expect(state.changelogCache.main).toBeDefined()
  })

  it('setChangelogText edits the ready view and its cache entry', () => {
    let state = applyChangelogAction(createChangelogState(), {
      type: 'setChangelogReady',
      branch: 'main',
      baseLabel: 'origin/main',
      text: '## Changes',
      generatedAt: 1,
    })
    state = applyChangelogAction(state, {
      type: 'setChangelogText',
      text: '## Edited changes',
      generatedAt: 2,
    })
    expect(state.changelogView.text).toBe('## Edited changes')
    expect(state.changelogCache.main).toEqual({
      text: '## Edited changes',
      baseLabel: 'origin/main',
      generatedAt: 2,
    })
  })

  it('setChangelogText is a no-op when the view is not ready', () => {
    const loading = applyChangelogAction(createChangelogState(), {
      type: 'setChangelogLoading',
      branch: 'main',
      baseLabel: 'origin/main',
    })
    const state = applyChangelogAction(loading, { type: 'setChangelogText', text: 'ignored', generatedAt: 1 })
    expect(state).toBe(loading)
  })

  it('pageChangelog scrolls within the line-count bounds', () => {
    let state = applyChangelogAction(createChangelogState(), {
      type: 'setChangelogReady',
      branch: 'main',
      baseLabel: 'origin/main',
      text: '## Changes',
      generatedAt: 1,
    })
    state = applyChangelogAction(state, { type: 'pageChangelog', delta: 5, lineCount: 20 })
    expect(state.changelogView.scrollOffset).toBe(5)

    state = applyChangelogAction(state, { type: 'pageChangelog', delta: -100, lineCount: 20 })
    expect(state.changelogView.scrollOffset).toBe(0)

    state = applyChangelogAction(state, { type: 'pageChangelog', delta: 999, lineCount: 20 })
    expect(state.changelogView.scrollOffset).toBe(19)
  })

  it('clearChangelogCache drops a single branch when one is given', () => {
    let state = applyChangelogAction(createChangelogState(), {
      type: 'setChangelogReady',
      branch: 'main',
      baseLabel: 'origin/main',
      text: '## Changes',
      generatedAt: 1,
    })
    state = applyChangelogAction(state, {
      type: 'setChangelogReady',
      branch: 'feature/x',
      baseLabel: 'origin/main',
      text: '## Feature changes',
      generatedAt: 2,
    })
    state = applyChangelogAction(state, { type: 'clearChangelogCache', branch: 'main' })
    expect(state.changelogCache.main).toBeUndefined()
    expect(state.changelogCache['feature/x']).toBeDefined()
  })

  it('clearChangelogCache wipes everything when no branch is given', () => {
    let state = applyChangelogAction(createChangelogState(), {
      type: 'setChangelogReady',
      branch: 'main',
      baseLabel: 'origin/main',
      text: '## Changes',
      generatedAt: 1,
    })
    state = applyChangelogAction(state, { type: 'clearChangelogCache' })
    expect(state.changelogCache).toEqual({})
  })
})
