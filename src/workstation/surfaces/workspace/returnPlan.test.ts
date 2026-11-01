import { OVERVIEW_TTL_MS, planMountScan, PULL_REQUEST_TTL_MS } from './returnPlan'
import type { WorkspaceOverview } from '../../../git/workspaceData'

const now = new Date('2026-11-01T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const overview = (scannedAt: string, paths = ['/w/a', '/w/b']): WorkspaceOverview => ({
  roots: ['/w'],
  scannedAt,
  repos: paths.map((path) => ({ path, name: path.slice(3), ahead: 0, behind: 0, dirty: 0 })),
})
const prs = (fetchedAt: string) => ({ authenticated: true, counts: { '/w/a': 2 }, fetchedAt })

describe('planMountScan (#2211)', () => {
  it('rescans everything on a first launch, even with a fresh cache', () => {
    expect(planMountScan({
      returning: false, cached: overview(ago(1000)), cachedPullRequests: prs(ago(1000)), now,
    })).toEqual({ mode: 'full' })
  })

  it('rescans when there is no usable cache', () => {
    expect(planMountScan({ returning: true, cached: undefined, cachedPullRequests: undefined, now })).toEqual({ mode: 'full' })
    expect(planMountScan({ returning: true, cached: overview(ago(1000), []), cachedPullRequests: undefined, now })).toEqual({ mode: 'full' })
  })

  it('rescans when the cached overview is older than the TTL', () => {
    expect(planMountScan({
      returning: true, cached: overview(ago(OVERVIEW_TTL_MS + 1000)), cachedPullRequests: prs(ago(1000)), now,
    })).toEqual({ mode: 'full' })
  })

  it('on a return with a recent cache, re-reads only the drilled-into repo', () => {
    const plan = planMountScan({
      returning: true, selectedRepoPath: '/w/b', cached: overview(ago(30_000)), cachedPullRequests: prs(ago(60_000)), now,
    })
    expect(plan).toMatchObject({ mode: 'cheap', repoPath: '/w/b' })
    expect(plan.mode === 'cheap' && plan.pullRequestCounts?.counts).toEqual({ '/w/a': 2 })
  })

  it('drops PR counts past their TTL, and a selected repo that left the cache', () => {
    const plan = planMountScan({
      returning: true, selectedRepoPath: '/w/gone', cached: overview(ago(30_000)),
      cachedPullRequests: prs(ago(PULL_REQUEST_TTL_MS + 1000)), now,
    })
    expect(plan).toEqual({ mode: 'cheap', repoPath: undefined, pullRequestCounts: undefined })
  })
})
