import { formatStashHeaderIdentity } from './stashHeader'
import { StashEntry } from '../../git/stashData'

const stashes: StashEntry[] = [
  {
    ref: 'stash@{2026-05-01 23:01:18 -0400}',
    hash: 'aaa1111',
    baseHash: 'base111',
    date: '2026-05-01',
    branch: 'main',
    message: 'WIP polish stash header',
    files: ['.gitignore'],
  },
  {
    ref: 'stash@{2026-05-01 23:00:01 -0400}',
    hash: 'bbb2222',
    baseHash: 'base222',
    date: '2026-05-01',
    branch: 'feat/x',
    message: 'experiment with carousel',
    files: ['src/carousel.tsx'],
  },
  {
    ref: 'stash@{2026-04-22 11:00:00 -0400}',
    hash: 'ccc3333',
    baseHash: 'base333',
    date: '2026-04-22',
    branch: '<unknown>',
    message: '',
    files: [],
  },
]

describe('formatStashHeaderIdentity', () => {
  it('returns a placeholder when no ref is active', () => {
    expect(formatStashHeaderIdentity(undefined, stashes)).toEqual({
      subtitle: 'no stash',
      bodyLine: 'Stash:',
    })
  })

  it('builds a human-readable subtitle from the matched stash entry', () => {
    // The user pen-arrowed at the panel title in #791 follow-up review
    // saying "Display stash ID that we're inspecting in header" — this
    // is what the right slot now shows: `@{N} <message> on <branch>`
    // instead of the timestamp ref noise.
    const identity = formatStashHeaderIdentity(stashes[0].ref, stashes)
    expect(identity.subtitle).toBe('@{0} WIP polish stash header on main')
    // Body line keeps the full ref so the user can still copy it for
    // `git stash apply <ref>` / inspection.
    expect(identity.bodyLine).toBe(
      'Stash: stash@{2026-05-01 23:01:18 -0400} on main — WIP polish stash header'
    )
  })

  it('uses the position in the stash list as the @{N} index', () => {
    expect(formatStashHeaderIdentity(stashes[1].ref, stashes).subtitle)
      .toBe('@{1} experiment with carousel on feat/x')
  })

  it('omits the "on <branch>" suffix when the branch is unknown', () => {
    // `parseStashSubject` returns `<unknown>` when the stash subject
    // does not match the WIP/On pattern. Skip the `on <unknown>` noise.
    const identity = formatStashHeaderIdentity(stashes[2].ref, stashes)
    expect(identity.subtitle).toBe('@{2} (no message)')
    expect(identity.bodyLine).toBe('Stash: stash@{2026-04-22 11:00:00 -0400} — (no message)')
  })

  it('falls back to the bare ref when the stash list is missing or stale', () => {
    // Race window: user opens diff, another process drops the stash
    // before our context refresh — render the ref so the surface stays
    // navigable instead of throwing.
    const ref = 'stash@{0}'
    expect(formatStashHeaderIdentity(ref, undefined)).toEqual({
      subtitle: ref,
      bodyLine: `Stash: ${ref}`,
    })
    expect(formatStashHeaderIdentity(ref, [])).toEqual({
      subtitle: ref,
      bodyLine: `Stash: ${ref}`,
    })
  })
})
