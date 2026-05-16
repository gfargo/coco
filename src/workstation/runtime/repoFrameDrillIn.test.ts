import { resolveCommitDiffDrillInTarget } from './repoFrameDrillIn'

const baseOverview = {
  hasSubmodules: true,
  entries: [
    {
      name: 'vendor/lib',
      path: 'vendor/lib',
      pinnedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      flag: 'clean' as const,
      trackingBranch: 'main',
      url: '/abs/source/vendor/lib',
    },
    {
      name: 'tools',
      path: 'packages/tools',
      pinnedSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      flag: 'clean' as const,
    },
  ],
}

describe('resolveCommitDiffDrillInTarget', () => {
  it('returns undefined when activeRepoRoot is unknown (boot in flight)', () => {
    expect(resolveCommitDiffDrillInTarget({
      selectedFile: { path: 'vendor/lib' },
      submodules: baseOverview,
      activeRepoRoot: undefined,
    })).toBeUndefined()
  })

  it('returns undefined when submodules overview is unknown', () => {
    expect(resolveCommitDiffDrillInTarget({
      selectedFile: { path: 'vendor/lib' },
      submodules: undefined,
      activeRepoRoot: '/abs/coco',
    })).toBeUndefined()
  })

  it('returns undefined when no submodules are registered', () => {
    expect(resolveCommitDiffDrillInTarget({
      selectedFile: { path: 'vendor/lib' },
      submodules: { hasSubmodules: false, entries: [] },
      activeRepoRoot: '/abs/coco',
    })).toBeUndefined()
  })

  it('returns undefined when the cursored path is not a submodule', () => {
    expect(resolveCommitDiffDrillInTarget({
      selectedFile: { path: 'src/index.ts' },
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })).toBeUndefined()
  })

  it('resolves a modified-submodule entry with label / workdir / entryRange', () => {
    const target = resolveCommitDiffDrillInTarget({
      selectedFile: {
        path: 'vendor/lib',
        submoduleChange: {
          kind: 'modified',
          before: '1111111111111111111111111111111111111111',
          after: '2222222222222222222222222222222222222222',
        },
      },
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })
    expect(target).toEqual({
      label: 'vendor/lib',
      workdir: '/abs/coco/vendor/lib',
      entryRange: {
        oldSha: '1111111111111111111111111111111111111111',
        newSha: '2222222222222222222222222222222222222222',
      },
    })
  })

  it('resolves a submodule whose path nests under a subdirectory', () => {
    const target = resolveCommitDiffDrillInTarget({
      selectedFile: {
        path: 'packages/tools',
        submoduleChange: {
          kind: 'modified',
          before: 'cccccccccccccccccccccccccccccccccccccccc',
          after: 'dddddddddddddddddddddddddddddddddddddddd',
        },
      },
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })
    expect(target?.workdir).toBe('/abs/coco/packages/tools')
    expect(target?.label).toBe('tools')
  })

  it('omits entryRange for an added submodule (no before sha)', () => {
    const target = resolveCommitDiffDrillInTarget({
      selectedFile: {
        path: 'vendor/lib',
        submoduleChange: {
          kind: 'added',
          after: '2222222222222222222222222222222222222222',
        },
      },
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })
    expect(target?.entryRange).toBeUndefined()
    expect(target?.label).toBe('vendor/lib')
    expect(target?.workdir).toBe('/abs/coco/vendor/lib')
  })

  it('omits entryRange for a removed submodule (no after sha)', () => {
    const target = resolveCommitDiffDrillInTarget({
      selectedFile: {
        path: 'vendor/lib',
        submoduleChange: {
          kind: 'removed',
          before: '1111111111111111111111111111111111111111',
        },
      },
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })
    expect(target?.entryRange).toBeUndefined()
  })

  it('omits entryRange when submoduleChange is missing entirely', () => {
    // Possible when the file preview hasn't been fetched yet but the
    // user still triggers Enter. We resolve the frame label / workdir
    // from the overview so the drill-in can proceed without the range.
    const target = resolveCommitDiffDrillInTarget({
      selectedFile: { path: 'vendor/lib' },
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })
    expect(target?.entryRange).toBeUndefined()
    expect(target?.label).toBe('vendor/lib')
  })
})
