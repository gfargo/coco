import { filterChippedRefs, getBranchTipChip } from './branchTip'

describe('getBranchTipChip', () => {
  it('returns the HEAD branch when refs include HEAD -> X', () => {
    expect(getBranchTipChip(['HEAD -> main']))
      .toEqual({ name: 'main', isHead: true, kind: 'head' })
    expect(getBranchTipChip(['HEAD -> feat/foo', 'origin/feat/foo']))
      .toEqual({ name: 'feat/foo', isHead: true, kind: 'head' })
  })

  it('prefers HEAD over plain branch tips even when both are present', () => {
    expect(getBranchTipChip(['other', 'HEAD -> main']))
      .toEqual({ name: 'main', isHead: true, kind: 'head' })
  })

  it('returns the first plain local branch when HEAD is not present', () => {
    expect(getBranchTipChip(['feat/foo']))
      // feat/foo contains a slash so it is treated as remote-like;
      // falls through to the third loop and is labeled 'remote'. The
      // chip system can't tell a local-branch-with-slash from an actual
      // remote ref without a list of remote names to compare against.
      .toEqual({ name: 'feat/foo', isHead: false, kind: 'remote' })
    expect(getBranchTipChip(['main']))
      .toEqual({ name: 'main', isHead: false, kind: 'local' })
  })

  it('falls back to a remote-tracking branch when nothing local is on the tip', () => {
    expect(getBranchTipChip(['origin/main']))
      .toEqual({ name: 'origin/main', isHead: false, kind: 'remote' })
  })

  it('marks slashless local branches with kind: "local"', () => {
    expect(getBranchTipChip(['develop']))
      .toEqual({ name: 'develop', isHead: false, kind: 'local' })
  })

  it('marks remote-tracking refs with kind: "remote"', () => {
    expect(getBranchTipChip(['upstream/main']))
      .toEqual({ name: 'upstream/main', isHead: false, kind: 'remote' })
  })

  it('ignores tags entirely', () => {
    expect(getBranchTipChip(['tag: v1.0.0'])).toBeUndefined()
    expect(getBranchTipChip(['tag: v1.0.0', 'tag: latest'])).toBeUndefined()
  })

  it('ignores bare HEAD (detached)', () => {
    expect(getBranchTipChip(['HEAD'])).toBeUndefined()
  })

  it('returns undefined for an empty refs list', () => {
    expect(getBranchTipChip([])).toBeUndefined()
  })

  it('skips a HEAD -> with an empty branch name', () => {
    expect(getBranchTipChip(['HEAD -> '])).toBeUndefined()
  })
})

describe('filterChippedRefs', () => {
  it('removes HEAD -> X and bare X when X is the chip', () => {
    const refs = ['HEAD -> main', 'main', 'origin/main', 'origin/HEAD']
    const chip = { name: 'main', isHead: true, kind: 'head' as const }
    expect(filterChippedRefs(refs, chip)).toEqual(['origin/main', 'origin/HEAD'])
  })

  it('removes only the exact chip name for non-HEAD tips', () => {
    const refs = ['claude/issues-prs-cli', 'origin/claude/issues-prs-cli']
    const chip = { name: 'claude/issues-prs-cli', isHead: false, kind: 'remote' as const }
    expect(filterChippedRefs(refs, chip)).toEqual(['origin/claude/issues-prs-cli'])
  })

  it('removes the chip ref entirely when it is the only ref', () => {
    const refs = ['origin/claude/issues-prs-cache']
    const chip = { name: 'origin/claude/issues-prs-cache', isHead: false, kind: 'remote' as const }
    expect(filterChippedRefs(refs, chip)).toEqual([])
  })

  it('returns refs unchanged when there is no chip', () => {
    const refs = ['HEAD -> main', 'origin/main']
    expect(filterChippedRefs(refs, undefined)).toEqual(refs)
  })

  it('preserves tags even when they appear alongside the chipped branch', () => {
    const refs = ['HEAD -> main', 'main', 'tag: v1.0.0', 'origin/main']
    const chip = { name: 'main', isHead: true, kind: 'head' as const }
    expect(filterChippedRefs(refs, chip)).toEqual(['tag: v1.0.0', 'origin/main'])
  })

  it('strips bare HEAD only when the chip is the HEAD branch', () => {
    const refs = ['HEAD', 'main']
    const headChip = { name: 'main', isHead: true, kind: 'head' as const }
    expect(filterChippedRefs(refs, headChip)).toEqual([])
    const nonHeadChip = { name: 'main', isHead: false, kind: 'local' as const }
    expect(filterChippedRefs(refs, nonHeadChip)).toEqual(['HEAD'])
  })
})
