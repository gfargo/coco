import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { WorkspaceOverview } from '../../git/workspaceData'

import {
  getWorkspaceCachePath,
  readCachedWorkspace,
  workspaceCacheKey,
  writeCachedWorkspace,
} from './workspaceCache'

const baseOverview: WorkspaceOverview = {
  roots: ['/home/me/code'],
  scannedAt: '2026-05-26T12:00:00.000Z',
  repos: [
    {
      path: '/home/me/code/proj',
      name: 'proj',
      branch: 'main',
      ahead: 0,
      behind: 0,
      dirty: 0,
    },
  ],
}

describe('workspaceCacheKey', () => {
  it('is stable under root reordering and whitespace', () => {
    expect(workspaceCacheKey(['~/code', '~/work'])).toBe(workspaceCacheKey(['~/work', '~/code']))
    expect(workspaceCacheKey([' ~/code ', '~/work'])).toBe(workspaceCacheKey(['~/code', '~/work']))
  })

  it('differs when the set of roots differs', () => {
    expect(workspaceCacheKey(['~/code'])).not.toBe(workspaceCacheKey(['~/code', '~/work']))
  })

  it('is stable across spellings of the same directory', () => {
    // `~/x` and its absolute expansion must share a key — hashing the
    // raw string split one directory's cache across spellings.
    expect(workspaceCacheKey(['~/code'])).toBe(workspaceCacheKey([`${os.homedir()}/code`]))
  })

  it('differs for the same relative root launched from different directories', () => {
    // A relative `--root ./code` resolves against the process cwd —
    // hashing the raw "./code" string collided every launch directory
    // into one cache, so boot painted the OTHER workspace's repo list.
    expect(workspaceCacheKey(['./code'])).toBe(
      workspaceCacheKey([`${process.cwd()}/code`])
    )
    expect(workspaceCacheKey(['./code'])).not.toBe(workspaceCacheKey(['/somewhere-else/code']))
  })
})

describe('workspace cache read/write', () => {
  let tmpHome: string
  let originalXdg: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-workspace-cache-'))
    originalXdg = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = tmpHome
  })

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdg
    }
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('round-trips an overview through the cache', () => {
    const roots = ['~/code']
    expect(readCachedWorkspace(roots)).toBeUndefined()

    writeCachedWorkspace(roots, baseOverview)

    const cachePath = getWorkspaceCachePath(roots)
    expect(fs.existsSync(cachePath)).toBe(true)
    expect(readCachedWorkspace(roots)).toEqual(baseOverview)
  })

  it('treats a schema mismatch as no cache', () => {
    const roots = ['~/code']
    const cachePath = getWorkspaceCachePath(roots)
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ version: 999, savedAt: '2020-01-01', overview: baseOverview })
    )

    expect(readCachedWorkspace(roots)).toBeUndefined()
  })

  it('returns undefined when the envelope is malformed', () => {
    const roots = ['~/code']
    const cachePath = getWorkspaceCachePath(roots)
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, 'not json')

    expect(readCachedWorkspace(roots)).toBeUndefined()
  })

  it('swallows write failures silently', () => {
    // Point XDG at a path inside a file rather than a directory so
    // mkdirSync throws — the cache write should swallow.
    const blocker = path.join(tmpHome, 'blocker')
    fs.writeFileSync(blocker, '')
    process.env.XDG_CACHE_HOME = blocker

    expect(() => writeCachedWorkspace(['~/code'], baseOverview)).not.toThrow()
  })
})
