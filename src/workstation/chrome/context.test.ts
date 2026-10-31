import {
  LOG_INK_CONTEXT_KEYS,
  createLogInkContextStatus,
  isLogInkContextKeyLoading,
  isLogInkContextLoading,
  mergeRefreshedContext,
  updateLogInkContextStatus,
} from './context'

describe('log Ink context loading state', () => {
  it('creates consistent context status for every repository context source', () => {
    const status = createLogInkContextStatus('loading')

    expect(Object.keys(status)).toEqual([...LOG_INK_CONTEXT_KEYS])
    expect(isLogInkContextLoading(status)).toBe(true)
    expect(isLogInkContextKeyLoading(status, 'provider')).toBe(true)
  })

  it('updates one context source without mutating the rest', () => {
    const loading = createLogInkContextStatus('loading')
    const next = updateLogInkContextStatus(loading, 'branches', 'ready')

    expect(next.branches).toBe('ready')
    expect(next.provider).toBe('loading')
    expect(loading.branches).toBe('loading')
  })
})

describe('mergeRefreshedContext', () => {
  it('preserves lazy-loaded slices the fresh snapshot does not carry', () => {
    const previous = {
      branches: ['main'],
      pullRequestList: { items: [{ number: 962 }] },
      issueList: { items: [{ number: 1 }] },
    }
    const next = { branches: ['main', 'dev'] }

    const merged = mergeRefreshedContext(previous, next)

    expect(merged.pullRequestList).toBe(previous.pullRequestList)
    expect(merged.issueList).toBe(previous.issueList)
    expect(merged.branches).toEqual(['main', 'dev'])
  })

  // #2209: a refresh lists stashes without their files, so it must not blank
  // the files the stash view already loaded.
  describe('stash files', () => {
    const stash = (hash: string, files?: string[]) => ({
      ref: 'stash@{0}', hash, baseHash: 'b', date: '', branch: 'main', message: 'm', ...(files ? { files } : {}),
    })

    it('carries loaded files over to the fresh entry for the same stash', () => {
      const previous = { stashes: { stashes: [stash('aaa', ['a.ts']), stash('bbb', ['b.ts'])] } }
      const next = { stashes: { stashes: [stash('aaa'), stash('bbb')] } }
      const merged = mergeRefreshedContext(previous, next)
      expect(merged.stashes.stashes.map((entry) => entry.files)).toEqual([['a.ts'], ['b.ts']])
    })

    it('matches by hash, so a shifted index does not mix files up', () => {
      const previous = { stashes: { stashes: [stash('aaa', ['a.ts']), stash('bbb', ['b.ts'])] } }
      // A new stash was pushed on top: the old ones moved down.
      const next = { stashes: { stashes: [stash('ccc'), stash('aaa'), stash('bbb')] } }
      const merged = mergeRefreshedContext(previous, next)
      expect(merged.stashes.stashes.map((entry) => entry.files)).toEqual([undefined, ['a.ts'], ['b.ts']])
    })

    it('does not overwrite files the fresh entry already has', () => {
      const previous = { stashes: { stashes: [stash('aaa', ['old.ts'])] } }
      const next = { stashes: { stashes: [stash('aaa', ['new.ts'])] } }
      expect(mergeRefreshedContext(previous, next).stashes.stashes[0].files).toEqual(['new.ts'])
    })

    it('leaves the context alone when no files were loaded or no stashes came back', () => {
      const previous = { stashes: { stashes: [stash('aaa')] } }
      const next = { stashes: { stashes: [stash('aaa')] } }
      expect(mergeRefreshedContext(previous, next).stashes).toBe(next.stashes)
      expect(mergeRefreshedContext({ stashes: { stashes: [stash('aaa', ['a.ts'])] } }, { stashes: { stashes: [] } }).stashes.stashes).toEqual([])
    })
  })

  it('overwrites boot-fetched keys even when the fresh value is undefined', () => {
    const previous = { branches: ['main'], pullRequestList: { items: [] } }
    const next = { branches: undefined }

    const merged = mergeRefreshedContext(previous, next)

    expect(merged.branches).toBeUndefined()
    expect(merged.pullRequestList).toBe(previous.pullRequestList)
  })
})
