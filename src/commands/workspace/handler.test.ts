import {
  resolveWorkspaceKnownRepos,
  resolveWorkspaceMaxDepth,
  resolveWorkspaceRoots,
} from './handler'
import type { WorkspaceArgv } from './config'

function argv(overrides: Partial<WorkspaceArgv> = {}): WorkspaceArgv {
  return ({
    _: ['workspace'],
    $0: 'coco',
    interactive: true,
    verbose: false,
    version: false,
    help: false,
    ...overrides,
  } as unknown) as WorkspaceArgv
}

describe('workspace handler argv resolution', () => {
  it('prefers explicit --root over config and default', () => {
    expect(
      resolveWorkspaceRoots(argv({ root: ['/tmp/a', '/tmp/b'] }), {
        workspace: { roots: ['~/code'] },
      })
    ).toEqual(['/tmp/a', '/tmp/b'])
  })

  it('falls back to config.workspace.roots when --root is missing', () => {
    expect(
      resolveWorkspaceRoots(argv(), { workspace: { roots: ['~/work', '~/oss'] } })
    ).toEqual(['~/work', '~/oss'])
  })

  it('defaults to [~/code] when no config and no flag are present', () => {
    expect(resolveWorkspaceRoots(argv(), {})).toEqual(['~/code'])
  })

  it('passes through known repos from config', () => {
    expect(
      resolveWorkspaceKnownRepos({
        workspace: { knownRepos: ['~/tmp/one'] },
      })
    ).toEqual(['~/tmp/one'])
    expect(resolveWorkspaceKnownRepos({})).toEqual([])
  })

  it('prefers --max-depth over config and rejects zero/negative values', () => {
    expect(
      resolveWorkspaceMaxDepth(argv({ maxDepth: 4 }), { workspace: { maxDepth: 2 } })
    ).toBe(4)
    expect(
      resolveWorkspaceMaxDepth(argv(), { workspace: { maxDepth: 2 } })
    ).toBe(2)
    expect(resolveWorkspaceMaxDepth(argv(), {})).toBeUndefined()
    expect(resolveWorkspaceMaxDepth(argv({ maxDepth: 0 }), { workspace: { maxDepth: 2 } })).toBe(2)
  })
})
