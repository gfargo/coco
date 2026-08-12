import { SimpleGit } from 'simple-git'
import { buildStack, getAllStackParents, getStackParent } from './stackData'

function makeGit(rawImpl: (args: string[]) => Promise<string>): SimpleGit {
  return { raw: jest.fn(rawImpl) } as unknown as SimpleGit
}

describe('getStackParent', () => {
  it('returns the configured parent', async () => {
    const git = makeGit(async (args) => {
      if (args[0] === 'config' && args[2] === 'branch.feature.coco-parent') return 'main\n'
      throw new Error(`unexpected call: ${args.join(' ')}`)
    })

    await expect(getStackParent(git, 'feature')).resolves.toBe('main')
  })

  it('returns undefined when the key is unset (non-zero exit)', async () => {
    const git = makeGit(async () => {
      throw new Error('exit code 1')
    })

    await expect(getStackParent(git, 'feature')).resolves.toBeUndefined()
  })

  it('round-trips: unset before set, set after set', async () => {
    let stored: string | undefined
    const git = makeGit(async (args) => {
      if (args[0] === 'config' && args[1] === '--get') {
        if (stored === undefined) throw new Error('exit code 1')
        return `${stored}\n`
      }
      if (args[0] === 'config') {
        stored = args[2]
        return ''
      }
      throw new Error(`unexpected call: ${args.join(' ')}`)
    })

    await expect(getStackParent(git, 'feature')).resolves.toBeUndefined()
    await git.raw(['config', 'branch.feature.coco-parent', 'main'])
    await expect(getStackParent(git, 'feature')).resolves.toBe('main')
  })
})

describe('getAllStackParents', () => {
  it('parses multi-line --get-regexp output, including a dotted branch name', async () => {
    const git = makeGit(async (args) => {
      if (args[0] === 'config' && args[1] === '--get-regexp') {
        return 'branch.a.coco-parent main\nbranch.feat/x.y.coco-parent a\n'
      }
      throw new Error(`unexpected call: ${args.join(' ')}`)
    })

    await expect(getAllStackParents(git)).resolves.toEqual({
      a: 'main',
      'feat/x.y': 'a',
    })
  })

  it('returns an empty object when no keys match (non-zero exit)', async () => {
    const git = makeGit(async () => {
      throw new Error('exit code 1')
    })

    await expect(getAllStackParents(git)).resolves.toEqual({})
  })
})

describe('buildStack', () => {
  function divergenceGit(divergences: Record<string, [number, number]>): SimpleGit {
    return makeGit(async (args) => {
      if (args[0] === 'rev-list') {
        const spec = args[3]
        const [upstream, branch] = spec.split('...')
        const key = `${branch}<-${upstream}`
        const [behind, ahead] = divergences[key] ?? [0, 0]
        return `${behind}\t${ahead}`
      }
      throw new Error(`unexpected call: ${args.join(' ')}`)
    })
  }

  it('walks a linear stack root -> ... -> current, ordered ancestor-first', async () => {
    const git = divergenceGit({
      'a<-main': [1, 2],
      'b<-a': [0, 3],
    })
    const parents = { b: 'a', a: 'main' }

    const stack = await buildStack(git, 'b', parents)

    expect(stack).toEqual([
      { branch: 'main', parent: undefined, ahead: 0, behind: 0 },
      { branch: 'a', parent: 'main', ahead: 2, behind: 1 },
      { branch: 'b', parent: 'a', ahead: 3, behind: 0 },
    ])
  })

  it('only walks the current chain when a parent has multiple children (siblings)', async () => {
    const git = divergenceGit({ 'b<-main': [0, 1] })
    // Both `b` and `c` point at `main`; walking from `b` must never touch `c`.
    const parents = { b: 'main', c: 'main' }

    const stack = await buildStack(git, 'b', parents)

    expect(stack.map((e) => e.branch)).toEqual(['main', 'b'])
  })

  it('terminates at an orphan branch with no recorded parent', async () => {
    const git = divergenceGit({})
    const stack = await buildStack(git, 'main', {})

    expect(stack).toEqual([{ branch: 'main', parent: undefined, ahead: 0, behind: 0 }])
  })

  it('degrades gracefully when a parent ref is dangling (rev-list throws)', async () => {
    const git = makeGit(async () => {
      throw new Error('unknown revision')
    })
    const parents = { feature: 'deleted-parent' }

    const stack = await buildStack(git, 'feature', parents)

    expect(stack).toEqual([
      { branch: 'deleted-parent', parent: undefined, ahead: 0, behind: 0 },
      { branch: 'feature', parent: 'deleted-parent', ahead: 0, behind: 0 },
    ])
  })

  it('terminates on cyclic config instead of hanging', async () => {
    const git = divergenceGit({})
    const parents = { a: 'b', b: 'a' }

    const stack = await buildStack(git, 'a', parents)

    // Visited-set stops the walk once a branch repeats.
    expect(stack.map((e) => e.branch)).toEqual(['b', 'a'])
  })
})
