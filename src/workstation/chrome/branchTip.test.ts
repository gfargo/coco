import { getBranchTipChip } from './branchTip'

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
