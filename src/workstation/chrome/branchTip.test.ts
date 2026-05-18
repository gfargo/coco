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

  it('without remoteNames, falls back to "any slash = remote-like" heuristic', () => {
    // No remoteNames → feat/foo is treated as remote-like (legacy behavior
    // preserved for callers without branch overview data).
    expect(getBranchTipChip(['feat/foo']))
      .toEqual({ name: 'feat/foo', isHead: false, kind: 'remote' })
    expect(getBranchTipChip(['main']))
      .toEqual({ name: 'main', isHead: false, kind: 'local' })
  })

  it('with remoteNames, correctly classifies local feature branches with slashes', () => {
    // feat/foo is NOT prefixed by any known remote → kind: 'local'.
    expect(getBranchTipChip(['feat/foo'], ['origin']))
      .toEqual({ name: 'feat/foo', isHead: false, kind: 'local' })
    expect(getBranchTipChip(['release/2.0'], ['origin', 'upstream']))
      .toEqual({ name: 'release/2.0', isHead: false, kind: 'local' })
  })

  it('with remoteNames, classifies <remoteName>/X as remote', () => {
    expect(getBranchTipChip(['origin/main'], ['origin']))
      .toEqual({ name: 'origin/main', isHead: false, kind: 'remote' })
    expect(getBranchTipChip(['upstream/main'], ['origin', 'upstream']))
      .toEqual({ name: 'upstream/main', isHead: false, kind: 'remote' })
  })

  it('with remoteNames, prefers local over remote when both exist at the tip', () => {
    // The first non-remote ref wins — same precedence rule as before,
    // just with a sharper remote check.
    expect(getBranchTipChip(['feat/foo', 'origin/feat/foo'], ['origin']))
      .toEqual({ name: 'feat/foo', isHead: false, kind: 'local' })
  })

  it('falls back to a remote-tracking branch when nothing local is on the tip', () => {
    expect(getBranchTipChip(['origin/main']))
      .toEqual({ name: 'origin/main', isHead: false, kind: 'remote' })
    expect(getBranchTipChip(['origin/main'], ['origin']))
      .toEqual({ name: 'origin/main', isHead: false, kind: 'remote' })
  })

  it('marks slashless local branches with kind: "local"', () => {
    expect(getBranchTipChip(['develop']))
      .toEqual({ name: 'develop', isHead: false, kind: 'local' })
    expect(getBranchTipChip(['develop'], ['origin']))
      .toEqual({ name: 'develop', isHead: false, kind: 'local' })
  })

  it('treats empty remoteNames the same as undefined (legacy heuristic)', () => {
    expect(getBranchTipChip(['feat/foo'], []))
      .toEqual({ name: 'feat/foo', isHead: false, kind: 'remote' })
  })

  it('classifies slashed refs with unknown prefixes as local when remoteNames is supplied', () => {
    // `origin/main` + remoteNames=['upstream']: the only remote we
    // know about is `upstream`, so `origin/main` doesn't match the
    // remote check and falls into the local bucket. In practice this
    // happens with stale remote-tracking refs for a remote that's
    // since been removed — calling the result 'local' is technically
    // wrong but harmless (the chip still renders). The alternative
    // (treating unknown prefixes as remote-like) would make the
    // remoteNames parameter only partially trusted, which is more
    // surprising. Keep the contract crisp: when remoteNames is
    // supplied, ONLY those prefixes count as remote.
    expect(getBranchTipChip(['origin/main'], ['upstream']))
      .toEqual({ name: 'origin/main', isHead: false, kind: 'local' })
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
