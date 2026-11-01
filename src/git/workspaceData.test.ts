import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { SimpleGit } from 'simple-git'

import {
  countPorcelainEntries,
  discoverRepos,
  discoverReposAsync,
  discoverReposInRoot,
  discoverReposInRootAsync,
  expandHome,
  getRepoSummary,
  getWorkspaceOverview,
  isGitWorkingTree,
  parseDivergence,
  parseHeadRef,
  parseLastCommit,
  parseStatusV2,
  WorkspaceRepoSummary,
} from './workspaceData'

function fakeGit(impl: (args: string[]) => Promise<string> | string): SimpleGit {
  return ({
    raw: jest.fn(async (args: string[]) => impl(args)),
  } as unknown) as SimpleGit
}

const FIELD_SEPARATOR = '\x1f'

describe('workspaceData parsers', () => {
  it('expands ~ to the user home directory', () => {
    expect(expandHome('~')).toBe(os.homedir())
    expect(expandHome('~/code')).toBe(path.join(os.homedir(), 'code'))
    // A plain absolute path is returned resolved (OS-native: `/tmp` on
    // POSIX, `<drive>:\tmp` on Windows) — build the expectation the same
    // way the implementation does so the assertion is platform-agnostic.
    expect(expandHome('/tmp')).toBe(path.resolve('/tmp'))
  })

  it('parses the HEAD ref line into branch + upstream', () => {
    expect(parseHeadRef(['main', 'origin/main'].join(FIELD_SEPARATOR))).toEqual({
      branch: 'main',
      upstream: 'origin/main',
    })
    expect(parseHeadRef(['feature', ''].join(FIELD_SEPARATOR))).toEqual({
      branch: 'feature',
      upstream: undefined,
    })
    expect(parseHeadRef('')).toEqual({ branch: undefined, upstream: undefined })
  })

  it('parses the last-commit line into hash/date/subject', () => {
    expect(
      parseLastCommit(
        ['abc1234', '2026-05-01T12:34:56-04:00', 'feat: thing'].join(FIELD_SEPARATOR)
      )
    ).toEqual({
      hash: 'abc1234',
      date: '2026-05-01T12:34:56-04:00',
      subject: 'feat: thing',
    })
    expect(parseLastCommit('')).toBeUndefined()
  })

  it('parses divergence as ahead/behind counts', () => {
    expect(parseDivergence('2\t5\n')).toEqual({ ahead: 5, behind: 2 })
    expect(parseDivergence('')).toEqual({ ahead: 0, behind: 0 })
  })

  it('counts porcelain entries from --porcelain output', () => {
    expect(countPorcelainEntries('')).toBe(0)
    expect(countPorcelainEntries(' M src/a.ts\n?? src/b.ts\n')).toBe(2)
  })
})

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coco-workspace-'))
}

function makeFakeRepo(root: string, name: string): string {
  const repo = path.join(root, name)
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
  return repo
}

describe('workspaceData discovery', () => {
  let root: string

  beforeEach(() => {
    root = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('finds repos directly under the root', () => {
    const a = makeFakeRepo(root, 'project-a')
    const b = makeFakeRepo(root, 'project-b')
    fs.mkdirSync(path.join(root, 'not-a-repo'))

    const repos = discoverReposInRoot(root)
    expect(repos.sort()).toEqual([a, b].sort().map((p) => fs.realpathSync(p)))
  })

  it('treats both .git directories and .git pointer files as working trees', () => {
    const dir = path.join(root, 'submodule')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: ../../.git/modules/submodule\n')
    expect(isGitWorkingTree(dir)).toBe(true)
  })

  it('respects maxDepth', () => {
    const nested = path.join(root, 'a', 'b', 'c', 'deep')
    fs.mkdirSync(path.join(nested, '.git'), { recursive: true })

    expect(discoverReposInRoot(root, { maxDepth: 2 })).toEqual([])
    expect(discoverReposInRoot(root, { maxDepth: 4 })).toEqual([
      fs.realpathSync(nested),
    ])
  })

  it('prunes node_modules and hidden directories', () => {
    makeFakeRepo(root, 'node_modules/should-not-discover')
    makeFakeRepo(root, '.hidden/should-not-discover')
    const visible = makeFakeRepo(root, 'visible')

    expect(discoverReposInRoot(root)).toEqual([fs.realpathSync(visible)])
  })

  it('stops descending into a directory once it is identified as a repo', () => {
    const outer = makeFakeRepo(root, 'outer')
    // A nested .git inside an outer repo should not be discovered
    // separately during discovery — submodules show up via their own
    // listing later, not via root walking.
    fs.mkdirSync(path.join(outer, 'vendor', 'inner', '.git'), { recursive: true })

    expect(discoverReposInRoot(root)).toEqual([fs.realpathSync(outer)])
  })

  it('merges knownRepos into the discovered set and drops missing entries', () => {
    const inRoot = makeFakeRepo(root, 'in-root')
    const elsewhere = path.join(createTempDir(), 'elsewhere')
    fs.mkdirSync(path.join(elsewhere, '.git'), { recursive: true })
    const ghost = path.join(root, 'does-not-exist')

    const repos = discoverRepos([root], [elsewhere, ghost])
    expect(repos.sort()).toEqual([fs.realpathSync(inRoot), fs.realpathSync(elsewhere)].sort())
  })

  it('returns an empty list for a missing root', () => {
    expect(discoverReposInRoot('/this/path/should/not/exist')).toEqual([])
  })
})

describe('workspaceData async discovery (#2210)', () => {
  let root: string
  beforeEach(() => { root = createTempDir() })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  function buildTree() {
    makeFakeRepo(root, 'project-a')
    makeFakeRepo(root, 'group/project-b')
    makeFakeRepo(root, 'group/deeper/project-c')
    makeFakeRepo(root, 'node_modules/skipped')
    makeFakeRepo(root, '.hidden/skipped')
    const outer = makeFakeRepo(root, 'outer')
    fs.mkdirSync(path.join(outer, 'vendor', 'inner', '.git'), { recursive: true })
    fs.mkdirSync(path.join(root, 'plain', 'dir'), { recursive: true })
    const linkTarget = createTempDir()
    makeFakeRepo(linkTarget, 'linked-repo')
    fs.symlinkSync(linkTarget, path.join(root, 'link'))
    return linkTarget
  }

  it('finds the same repos as the sync walk, with and without followSymlinks', async () => {
    const linkTarget = buildTree()
    try {
      for (const followSymlinks of [false, true]) {
        for (const maxDepth of [1, 2, 3]) {
          const opts = { followSymlinks, maxDepth }
          expect((await discoverReposInRootAsync(root, opts)).sort()).toEqual(
            discoverReposInRoot(root, opts).sort()
          )
        }
      }
    } finally {
      fs.rmSync(linkTarget, { recursive: true, force: true })
    }
  })

  it('merges known repos and drops missing ones, like the sync version', async () => {
    const inRoot = makeFakeRepo(root, 'in-root')
    const elsewhere = path.join(createTempDir(), 'elsewhere')
    fs.mkdirSync(path.join(elsewhere, '.git'), { recursive: true })
    const ghost = path.join(root, 'does-not-exist')

    const repos = await discoverReposAsync([root], [elsewhere, ghost])
    expect(repos).toEqual([fs.realpathSync(inRoot), fs.realpathSync(elsewhere)].sort())
  })

  it('returns an empty list for a missing root', async () => {
    await expect(discoverReposInRootAsync('/this/path/should/not/exist')).resolves.toEqual([])
  })

  it('never calls a synchronous fs walker, so the event loop stays free', async () => {
    buildTree()
    const realFs = jest.requireActual<typeof import('fs')>('fs')
    const spies = (['readdirSync', 'realpathSync', 'lstatSync', 'statSync', 'existsSync'] as const).map((name) =>
      jest.spyOn(realFs, name)
    )
    try {
      // Control: the spies do fire for the synchronous walker.
      discoverRepos([root], [])
      expect(spies[0]).toHaveBeenCalled()
      spies.forEach((spy) => spy.mockClear())

      await discoverReposAsync([root], [])
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })

  it('lets timers run while it walks a wide tree', async () => {
    for (let i = 0; i < 300; i += 1) fs.mkdirSync(path.join(root, `dir-${i}`, 'sub'), { recursive: true })
    let ticks = 0
    const timer = setInterval(() => { ticks += 1 }, 1)
    try {
      await discoverReposInRootAsync(root, { maxDepth: 3 })
    } finally {
      clearInterval(timer)
    }
    expect(ticks).toBeGreaterThan(0)
  })
})

describe('getWorkspaceOverview followSymlinks (#2210)', () => {
  let root: string
  let target: string
  beforeEach(() => {
    root = createTempDir()
    target = createTempDir()
    makeFakeRepo(target, 'linked-repo')
    fs.symlinkSync(target, path.join(root, 'link'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  })

  const loadSummary = async (repoPath: string): Promise<WorkspaceRepoSummary> => ({
    path: repoPath, name: path.basename(repoPath), ahead: 0, behind: 0, dirty: 0,
  })

  it('does not follow symlinked directories by default', async () => {
    const overview = await getWorkspaceOverview([root], { loadSummary })
    expect(overview.repos).toEqual([])
  })

  it('follows them when the option is set, as the workspace config now allows', async () => {
    const overview = await getWorkspaceOverview([root], { loadSummary, followSymlinks: true })
    expect(overview.repos.map((entry) => entry.name)).toEqual(['linked-repo'])
  })
})

describe('hidden repositories (#2210)', () => {
  let root: string
  beforeEach(() => { root = createTempDir() })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('lists a dot-folder that is itself a repo (sync and async)', async () => {
    const dotfiles = makeFakeRepo(root, '.dotfiles')
    const visible = makeFakeRepo(root, 'project')
    const expected = [fs.realpathSync(dotfiles), fs.realpathSync(visible)].sort()

    expect(discoverReposInRoot(root).sort()).toEqual(expected)
    expect((await discoverReposInRootAsync(root)).sort()).toEqual(expected)
  })

  it('still does not descend into hidden directories that are not repos', async () => {
    // e.g. ~/.cache/<some clone>: the walk must stay cheap.
    makeFakeRepo(root, '.cache/some-clone')
    expect(discoverReposInRoot(root)).toEqual([])
    expect(await discoverReposInRootAsync(root)).toEqual([])
  })

  it('does not descend into a hidden repo to find repos nested in it', async () => {
    const dotfiles = makeFakeRepo(root, '.dotfiles')
    fs.mkdirSync(path.join(dotfiles, 'vendor', 'inner', '.git'), { recursive: true })
    expect(discoverReposInRoot(root)).toEqual([fs.realpathSync(dotfiles)])
    expect(await discoverReposInRootAsync(root)).toEqual([fs.realpathSync(dotfiles)])
  })

  it('keeps pruning named directories even when they are hidden repos', () => {
    makeFakeRepo(root, '.git-ignored-name')
    const out = discoverReposInRoot(root, { pruneDirs: new Set(['.git-ignored-name']) })
    expect(out).toEqual([])
  })
})

describe('workspaceData per-repo summary', () => {
  const v2 = (...records: string[]) => records.join('\0') + '\0'

  it('captures branch, dirty count, divergence, and last commit', async () => {
    const git = fakeGit((args) => {
      if (args[0] === 'status') {
        return v2(
          '# branch.oid abc1234abc1234abc1234abc1234abc1234abc12',
          '# branch.head main',
          '# branch.upstream origin/main',
          '# branch.ab +3 -1',
          '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
          '? src/b.ts'
        )
      }
      if (args[0] === 'log') {
        return (
          ['abc1234', '2026-05-01T12:34:56-04:00', 'feat: thing'].join(FIELD_SEPARATOR) +
          '\n'
        )
      }
      return ''
    })

    const summary = await getRepoSummary('/tmp/example-repo', { git })

    expect(summary).toMatchObject<Partial<WorkspaceRepoSummary>>({
      name: 'example-repo',
      branch: 'main',
      ahead: 3,
      behind: 1,
      dirty: 2,
      lastCommit: {
        hash: 'abc1234',
        date: '2026-05-01T12:34:56-04:00',
        subject: 'feat: thing',
      },
    })
    expect(summary.error).toBeUndefined()
  })

  it('shows a short hash when HEAD is detached', async () => {
    const git = fakeGit((args) => {
      if (args[0] === 'status') {
        return v2('# branch.oid deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '# branch.head (detached)')
      }
      return ''
    })

    const summary = await getRepoSummary('/tmp/detached', { git })
    expect(summary.branch).toBe('(deadbee)')
  })

  it('captures an error message without throwing when git invocation fails', async () => {
    const git = fakeGit(() => {
      throw new Error('not a git repository')
    })

    const summary = await getRepoSummary('/tmp/broken', { git })
    expect(summary.error).toBe('not a git repository')
    expect(summary.branch).toBeUndefined()
  })
})

describe('parseStatusV2 (#2210)', () => {
  const v2 = (...records: string[]) => records.join('\0') + '\0'

  it('counts a rename once and skips its original-path field', () => {
    const out = v2(
      '# branch.oid abc',
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts',
      'old.ts',
      '1 .M N... 100644 100644 100644 aaa bbb other.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts'
    )
    expect(parseStatusV2(out)).toMatchObject({ branch: 'main', dirty: 3 })
  })

  it('does not count ignored entries or headers', () => {
    expect(parseStatusV2(v2('# branch.oid abc', '# branch.head main', '! build/'))).toMatchObject({ dirty: 0 })
  })

  it('reports an unborn branch by name and no ahead/behind without an upstream', () => {
    expect(parseStatusV2(v2('# branch.oid (initial)', '# branch.head trunk'))).toEqual({
      branch: 'trunk',
      ahead: 0,
      behind: 0,
      dirty: 0,
      upstream: null,
      detached: false,
    })
  })

  it('has no branch for a detached HEAD on an unborn repo', () => {
    expect(parseStatusV2(v2('# branch.oid (initial)', '# branch.head (detached)')).branch).toBeUndefined()
  })
})

describe('getRepoSummary against a real repo (#2210)', () => {
  let dir: string
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-ws-summary-'))
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 't')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('shows the checked-out branch, not a sibling branch at the same commit', async () => {
    // "aaa-sibling" sorts before "main", which the old for-each-ref
    // --points-at=HEAD parse would have picked.
    run('branch', 'aaa-sibling')
    const summary = await getRepoSummary(dir)
    expect(summary.branch).toBe('main')
    expect(summary.error).toBeUndefined()
  })

  it('shows a short hash, not a branch name, for a detached HEAD at a branch tip', async () => {
    run('checkout', '-q', '--detach')
    const summary = await getRepoSummary(dir)
    expect(summary.branch).toMatch(/^\([0-9a-f]{7}\)$/)
  })

  it('computes ahead/behind against the checked-out branch\'s own upstream', async () => {
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-ws-remote-'))
    try {
      execFileSync('git', ['init', '-q', '--bare'], { cwd: remote })
      run('remote', 'add', 'origin', remote)
      run('push', '-q', '-u', 'origin', 'main')
      fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
      run('add', '.')
      run('commit', '-q', '-m', 'local only')
      run('branch', 'aaa-sibling') // no upstream; must not hide main's divergence
      const summary = await getRepoSummary(dir)
      expect(summary).toMatchObject({ branch: 'main', ahead: 1, behind: 0 })
    } finally {
      fs.rmSync(remote, { recursive: true, force: true })
    }
  })
})

describe('workspaceData overview', () => {
  it('runs the per-repo loader for every discovered path and returns a stable scan envelope', async () => {
    const root = createTempDir()
    try {
      const a = makeFakeRepo(root, 'project-a')
      const b = makeFakeRepo(root, 'project-b')

      const loadSummary = jest.fn(async (repoPath: string): Promise<WorkspaceRepoSummary> => ({
        path: repoPath,
        name: path.basename(repoPath),
        ahead: 0,
        behind: 0,
        dirty: 0,
      }))

      const overview = await getWorkspaceOverview([root], { loadSummary })

      expect(loadSummary).toHaveBeenCalledTimes(2)
      expect(overview.repos.map((entry) => entry.name).sort()).toEqual(['project-a', 'project-b'])
      expect(overview.roots).toEqual([fs.realpathSync(root)])
      expect(overview.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      // Ensure both fake paths showed up via discovery.
      expect(overview.repos.find((entry) => entry.path === fs.realpathSync(a))).toBeDefined()
      expect(overview.repos.find((entry) => entry.path === fs.realpathSync(b))).toBeDefined()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports each repo as it finishes instead of waiting for the slowest (#2210)', async () => {
    const root = createTempDir()
    try {
      makeFakeRepo(root, 'fast')
      makeFakeRepo(root, 'slow')
      let releaseSlow!: () => void
      const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve })
      const loadSummary = async (repoPath: string): Promise<WorkspaceRepoSummary> => {
        if (path.basename(repoPath) === 'slow') await slowGate
        return { path: repoPath, name: path.basename(repoPath), ahead: 0, behind: 0, dirty: 0 }
      }
      const seen: string[] = []

      const overviewPromise = getWorkspaceOverview([root], {
        loadSummary,
        onRepoSummary: (summary) => seen.push(summary.name),
      })

      // The fast repo is reported while the slow one is still hanging.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(seen).toEqual(['fast'])

      releaseSlow()
      const overview = await overviewPromise
      expect(seen).toEqual(['fast', 'slow'])
      expect(overview.repos.map((entry) => entry.name).sort()).toEqual(['fast', 'slow'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
