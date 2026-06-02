import { promises as fsp } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { cloneRepo, deriveRepoName } from './cloneRepo'

describe('deriveRepoName', () => {
  it('parses https URLs', () => {
    expect(deriveRepoName('https://github.com/gfargo/coco')).toBe('coco')
    expect(deriveRepoName('https://github.com/gfargo/coco.git')).toBe('coco')
    expect(deriveRepoName('https://github.com/gfargo/coco.git/')).toBe('coco')
  })

  it('parses SSH specs', () => {
    expect(deriveRepoName('git@github.com:gfargo/coco.git')).toBe('coco')
    expect(deriveRepoName('git@gitlab.com:group/sub/thing.git')).toBe('thing')
  })

  it('handles trailing slashes and nested paths', () => {
    expect(deriveRepoName('https://example.com/a/b/c.git/')).toBe('c')
  })

  it('falls back to "repo" for unusable input', () => {
    expect(deriveRepoName('')).toBe('repo')
    expect(deriveRepoName('   ')).toBe('repo')
  })
})

describe('cloneRepo', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'coco-clone-'))
  })
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('rejects an empty URL or destination', async () => {
    expect((await cloneRepo('', '/tmp/x')).ok).toBe(false)
    expect((await cloneRepo('https://x/y.git', '   ')).ok).toBe(false)
  })

  it('refuses to clobber an existing path', async () => {
    const existing = path.join(dir, 'taken')
    await fsp.mkdir(existing)
    const result = await cloneRepo('https://github.com/gfargo/coco.git', existing)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/already exists/)
  })
})
