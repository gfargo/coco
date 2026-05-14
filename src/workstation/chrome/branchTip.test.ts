import { filterChippedRefs, getBranchTipChip } from './branchTip'

describe('getBranchTipChip', () => {
  it('returns the HEAD branch when refs include HEAD -> X', () => {
    expect(getBranchTipChip(['HEAD -> main'])).toEqual({ name: 'main', isHead: true })
    expect(getBranchTipChip(['HEAD -> feat/foo', 'origin/feat/foo']))
      .toEqual({ name: 'feat/foo', isHead: true })
  })

  it('prefers HEAD over plain branch tips even when both are present', () => {
    expect(getBranchTipChip(['other', 'HEAD -> main']))
      .toEqual({ name: 'main', isHead: true })
  })

  it('returns the first plain local branch when HEAD is not present', () => {
    expect(getBranchTipChip(['feat/foo'])).toEqual({ name: 'feat/foo', isHead: false })
    expect(getBranchTipChip(['feat/foo', 'origin/feat/foo']))
      // feat/foo contains a slash so it is treated as remote-like; first
      // truly-plain branch wins. With only slashy refs we fall through
      // to the remote-tracking fallback below.
      .toEqual({ name: 'feat/foo', isHead: false })
  })

  it('falls back to a remote-tracking branch when nothing local is on the tip', () => {
    expect(getBranchTipChip(['origin/main'])).toEqual({ name: 'origin/main', isHead: false })
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
    const chip = { name: 'main', isHead: true }
    expect(filterChippedRefs(refs, chip)).toEqual(['origin/main', 'origin/HEAD'])
  })

  it('removes only the exact chip name for non-HEAD tips', () => {
    const refs = ['claude/issues-prs-cli', 'origin/claude/issues-prs-cli']
    const chip = { name: 'claude/issues-prs-cli', isHead: false }
    expect(filterChippedRefs(refs, chip)).toEqual(['origin/claude/issues-prs-cli'])
  })

  it('removes the chip ref entirely when it is the only ref', () => {
    const refs = ['origin/claude/issues-prs-cache']
    const chip = { name: 'origin/claude/issues-prs-cache', isHead: false }
    expect(filterChippedRefs(refs, chip)).toEqual([])
  })

  it('returns refs unchanged when there is no chip', () => {
    const refs = ['HEAD -> main', 'origin/main']
    expect(filterChippedRefs(refs, undefined)).toEqual(refs)
  })

  it('preserves tags even when they appear alongside the chipped branch', () => {
    const refs = ['HEAD -> main', 'main', 'tag: v1.0.0', 'origin/main']
    const chip = { name: 'main', isHead: true }
    expect(filterChippedRefs(refs, chip)).toEqual(['tag: v1.0.0', 'origin/main'])
  })

  it('strips bare HEAD only when the chip is the HEAD branch', () => {
    const refs = ['HEAD', 'main']
    const headChip = { name: 'main', isHead: true }
    expect(filterChippedRefs(refs, headChip)).toEqual([])
    const nonHeadChip = { name: 'main', isHead: false }
    expect(filterChippedRefs(refs, nonHeadChip)).toEqual(['HEAD'])
  })
})
