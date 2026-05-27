import {
  buildDrillInUiArgv,
  resolveWorkspaceKnownRepos,
  resolveWorkspaceMaxDepth,
  resolveWorkspaceRoots,
  runWorkspaceLoop,
  type WorkspaceLoopDeps,
} from './handler'
import type { WorkspaceArgv } from './config'
import type { WorkspaceExitResult } from '../../workstation/surfaces/workspace'

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

  it('buildDrillInUiArgv produces an interactive history argv', () => {
    const drill = buildDrillInUiArgv(argv({ theme: 'gruvbox', verbose: true }))
    expect(drill.interactive).toBe(true)
    expect(drill.all).toBe(true)
    expect(drill.theme).toBe('gruvbox')
    expect(drill.verbose).toBe(true)
  })
})

describe('runWorkspaceLoop', () => {
  function quit(): WorkspaceExitResult {
    return { kind: 'quit' }
  }

  function drillTo(path: string): WorkspaceExitResult {
    return {
      kind: 'drill-in',
      repo: { path, name: 'r', branch: 'main', ahead: 0, behind: 0, dirty: 0 },
      resume: { sortMode: 'recency', tab: 'all', filter: '', selectedRepoPath: path },
    }
  }

  it('returns immediately when the user quits the first mount', async () => {
    const startWorkspace: WorkspaceLoopDeps['startWorkspace'] = jest.fn(async () => quit())
    const runUiForRepo = jest.fn()
    const chdir = jest.fn()

    await runWorkspaceLoop({
      startWorkspace,
      runUiForRepo,
      chdir,
      baseCwd: '/start',
    })

    expect(startWorkspace).toHaveBeenCalledTimes(1)
    expect(runUiForRepo).not.toHaveBeenCalled()
    expect(chdir).not.toHaveBeenCalled()
  })

  it('chdirs into the drill-in target, runs ui, restores cwd, and loops back with the resume seed', async () => {
    const order: string[] = []
    let calls = 0
    const startWorkspace: WorkspaceLoopDeps['startWorkspace'] = jest.fn(
      async (resume) => {
        calls += 1
        order.push(`workspace(${resume?.selectedRepoPath ?? 'none'})`)
        if (calls === 1) {
          return drillTo('/repos/a')
        }
        return quit()
      }
    )
    const runUiForRepo = jest.fn(async (path: string) => {
      order.push(`ui(${path})`)
    })
    const chdir = jest.fn((target: string) => {
      order.push(`chdir(${target})`)
    })

    await runWorkspaceLoop({
      startWorkspace,
      runUiForRepo,
      chdir,
      baseCwd: '/start',
    })

    expect(order).toEqual([
      'workspace(none)',
      'chdir(/repos/a)',
      'ui(/repos/a)',
      'chdir(/start)',
      'workspace(/repos/a)',
    ])
  })

  it('restores cwd even when ui throws', async () => {
    const startWorkspace: WorkspaceLoopDeps['startWorkspace'] = jest.fn(async () =>
      drillTo('/repos/broken')
    )
    const runUiForRepo = jest.fn(async () => {
      throw new Error('boom')
    })
    const chdir = jest.fn()

    await expect(
      runWorkspaceLoop({
        startWorkspace,
        runUiForRepo,
        chdir,
        baseCwd: '/start',
      })
    ).rejects.toThrow('boom')

    expect(chdir).toHaveBeenNthCalledWith(1, '/repos/broken')
    expect(chdir).toHaveBeenLastCalledWith('/start')
  })
})
