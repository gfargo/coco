import { SimpleGit } from 'simple-git'
import { clearStackParent, createStackedBranch, setStackParent } from './stackActions'

function makeGit(rawImpl: (args: string[]) => Promise<string> = async () => ''): SimpleGit {
  return { raw: jest.fn(rawImpl) } as unknown as SimpleGit
}

describe('setStackParent', () => {
  it('issues `git config branch.<name>.coco-parent <parent>` and returns ok', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit

    const result = await setStackParent(git, 'feature', 'main')

    expect(raw).toHaveBeenCalledWith(['config', 'branch.feature.coco-parent', 'main'])
    expect(result).toEqual({ ok: true, message: 'Set stack parent of feature to main' })
  })

  it('rejects a flag-like branch name without touching git', async () => {
    const raw = jest.fn()
    const git = { raw } as unknown as SimpleGit

    const result = await setStackParent(git, '-feature', 'main')

    expect(result.ok).toBe(false)
    expect(raw).not.toHaveBeenCalled()
  })

  it('rejects a flag-like parent name without touching git', async () => {
    const raw = jest.fn()
    const git = { raw } as unknown as SimpleGit

    const result = await setStackParent(git, 'feature', '--force')

    expect(result.ok).toBe(false)
    expect(raw).not.toHaveBeenCalled()
  })

  it('surfaces the git error when the config write fails', async () => {
    const git = makeGit(async () => {
      throw new Error('not a git repository')
    })

    const result = await setStackParent(git, 'feature', 'main')

    expect(result).toEqual({ ok: false, message: 'not a git repository' })
  })
})

describe('clearStackParent', () => {
  it('issues `git config --unset branch.<name>.coco-parent` and returns ok', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit

    const result = await clearStackParent(git, 'feature')

    expect(raw).toHaveBeenCalledWith(['config', '--unset', 'branch.feature.coco-parent'])
    expect(result).toEqual({ ok: true, message: 'Cleared stack parent of feature' })
  })

  it('treats an already-unset key as success (idempotent)', async () => {
    const git = makeGit(async () => {
      throw new Error('exit code 5')
    })

    const result = await clearStackParent(git, 'feature')

    expect(result).toEqual({ ok: true, message: 'Cleared stack parent of feature' })
  })

  it('rejects a flag-like branch name without touching git', async () => {
    const raw = jest.fn()
    const git = { raw } as unknown as SimpleGit

    const result = await clearStackParent(git, '-feature')

    expect(result.ok).toBe(false)
    expect(raw).not.toHaveBeenCalled()
  })
})

describe('createStackedBranch', () => {
  it('creates the branch (via createBranch) then links it as a stack child', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit

    const result = await createStackedBranch(git, 'feature', 'main')

    expect(raw).toHaveBeenNthCalledWith(1, ['branch', 'feature', 'main'])
    expect(raw).toHaveBeenNthCalledWith(2, ['config', 'branch.feature.coco-parent', 'main'])
    expect(result).toEqual({ ok: true, message: 'Created feature stacked on main' })
  })

  it('rejects a flag-like name without touching git', async () => {
    const raw = jest.fn()
    const git = { raw } as unknown as SimpleGit

    const result = await createStackedBranch(git, '-feature', 'main')

    expect(result.ok).toBe(false)
    expect(raw).not.toHaveBeenCalled()
  })

  it('propagates a createBranch failure (e.g. duplicate branch name) without linking', async () => {
    const raw = jest.fn(async (args: string[]) => {
      if (args[0] === 'branch') throw new Error("fatal: A branch named 'feature' already exists.")
      throw new Error(`unexpected call: ${args.join(' ')}`)
    })
    const git = { raw } as unknown as SimpleGit

    const result = await createStackedBranch(git, 'feature', 'main')

    expect(result).toEqual({ ok: false, message: "fatal: A branch named 'feature' already exists." })
    expect(raw).toHaveBeenCalledTimes(1)
  })
})
