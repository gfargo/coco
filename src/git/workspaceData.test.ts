import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { SimpleGit } from 'simple-git'

import {
  countPorcelainEntries,
  discoverRepos,
  discoverReposInRoot,
  expandHome,
  getRepoSummary,
  getWorkspaceOverview,
  isGitWorkingTree,
  parseDivergence,
  parseHeadRef,
  parseLastCommit,
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

describe('workspaceData per-repo summary', () => {
  it('captures branch, dirty count, divergence, and last commit', async () => {
    const git = fakeGit((args) => {
      if (args[0] === 'for-each-ref') {
        return ['main', 'origin/main'].join(FIELD_SEPARATOR) + '\n'
      }
      if (args[0] === 'status') {
        return ' M src/a.ts\n?? src/b.ts\n'
      }
      if (args[0] === 'log') {
        return (
          ['abc1234', '2026-05-01T12:34:56-04:00', 'feat: thing'].join(FIELD_SEPARATOR) +
          '\n'
        )
      }
      if (args[0] === 'rev-list') {
        return '1\t3\n'
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

  it('falls back to a short hash when HEAD is detached', async () => {
    const git = fakeGit((args) => {
      if (args[0] === 'for-each-ref') return ''
      if (args[0] === 'status') return ''
      if (args[0] === 'log') {
        return ['deadbee', '2026-05-01T00:00:00Z', 'wip'].join(FIELD_SEPARATOR) + '\n'
      }
      if (args[0] === 'rev-parse') return 'deadbee\n'
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
})
