import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  appendKnownRepo,
  getKnownReposStorePath,
  readKnownRepos,
  writeKnownRepos,
} from './workspaceKnownRepos'

describe('workspaceKnownRepos persistence', () => {
  let tmpHome: string
  let originalXdg: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-known-repos-'))
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

  it('returns an empty list when the store has not been initialized', () => {
    expect(readKnownRepos()).toEqual([])
  })

  it('round-trips paths through the store', () => {
    writeKnownRepos(['/a', '/b', '/a'])
    expect(readKnownRepos()).toEqual(['/a', '/b'])
    expect(fs.existsSync(getKnownReposStorePath())).toBe(true)
  })

  it('treats a schema mismatch as no store', () => {
    fs.mkdirSync(path.dirname(getKnownReposStorePath()), { recursive: true })
    fs.writeFileSync(
      getKnownReposStorePath(),
      JSON.stringify({ version: 99, paths: ['/x'], updatedAt: '2020-01-01' })
    )
    expect(readKnownRepos()).toEqual([])
  })

  it('appendKnownRepo de-dupes', () => {
    appendKnownRepo('/a')
    expect(appendKnownRepo('/a')).toEqual(['/a'])
    expect(appendKnownRepo('/b')).toEqual(['/a', '/b'])
  })

  it('swallows write failures silently', () => {
    const blocker = path.join(tmpHome, 'blocker-file')
    fs.writeFileSync(blocker, '')
    process.env.XDG_CACHE_HOME = blocker
    expect(() => writeKnownRepos(['/c'])).not.toThrow()
  })
})
