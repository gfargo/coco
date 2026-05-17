import {
  resolveCommitDiffDrillInTarget,
  resolveSubmoduleViewDrillInTarget,
} from './repoFrameDrillIn'

const baseOverview = {
  hasSubmodules: true,
  entries: [
    {
      name: 'vendor/lib',
      path: 'vendor/lib',
      pinnedSha: 'aaaaaaaa',
      flag: 'clean' as const,
      trackingBranch: 'main',
      url: '/abs/source/vendor/lib',
    },
    {
      name: 'tools',
      path: 'packages/tools',
      pinnedSha: 'bbbbbbbb',
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
          before: '11111111',
          after: '22222222',
        },
      },
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })
    expect(target).toEqual({
      label: 'vendor/lib',
      workdir: '/abs/coco/vendor/lib',
      entryRange: {
        oldSha: '11111111',
        newSha: '22222222',
      },
    })
  })

  it('resolves a submodule whose path nests under a subdirectory', () => {
    const target = resolveCommitDiffDrillInTarget({
      selectedFile: {
        path: 'packages/tools',
        submoduleChange: {
          kind: 'modified',
          before: 'cccccccc',
          after: 'dddddddd',
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
          after: '22222222',
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
          before: '11111111',
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

describe('resolveSubmoduleViewDrillInTarget (#931 PR 4)', () => {
  it('returns undefined when activeRepoRoot is unknown (boot in flight)', () => {
    expect(resolveSubmoduleViewDrillInTarget({
      selectedIndex: 0,
      submodules: baseOverview,
      activeRepoRoot: undefined,
    })).toBeUndefined()
  })

  it('returns undefined when the submodule overview is unknown', () => {
    expect(resolveSubmoduleViewDrillInTarget({
      selectedIndex: 0,
      submodules: undefined,
      activeRepoRoot: '/abs/coco',
    })).toBeUndefined()
  })

  it('returns undefined when no submodules are registered', () => {
    expect(resolveSubmoduleViewDrillInTarget({
      selectedIndex: 0,
      submodules: { hasSubmodules: false, entries: [] },
      activeRepoRoot: '/abs/coco',
    })).toBeUndefined()
  })

  it('returns undefined when the cursor is past the end of the entries', () => {
    expect(resolveSubmoduleViewDrillInTarget({
      selectedIndex: 99,
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })).toBeUndefined()
  })

  it('returns undefined when the cursored entry has no path', () => {
    const overview = {
      hasSubmodules: true,
      entries: [{
        name: 'orphan',
        path: '',
        pinnedSha: 'cccccccc',
        flag: 'clean' as const,
      }],
    }
    expect(resolveSubmoduleViewDrillInTarget({
      selectedIndex: 0,
      submodules: overview,
      activeRepoRoot: '/abs/coco',
    })).toBeUndefined()
  })

  it('resolves the first entry with label + absolute workdir', () => {
    expect(resolveSubmoduleViewDrillInTarget({
      selectedIndex: 0,
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })).toEqual({
      label: 'vendor/lib',
      workdir: '/abs/coco/vendor/lib',
    })
  })

  it('resolves a nested-path entry against the active repo root', () => {
    expect(resolveSubmoduleViewDrillInTarget({
      selectedIndex: 1,
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })).toEqual({
      label: 'tools',
      workdir: '/abs/coco/packages/tools',
    })
  })

  it('never carries an entryRange — the submodules view has no diff context', () => {
    const target = resolveSubmoduleViewDrillInTarget({
      selectedIndex: 0,
      submodules: baseOverview,
      activeRepoRoot: '/abs/coco',
    })
    expect(target).not.toHaveProperty('entryRange')
  })
})
