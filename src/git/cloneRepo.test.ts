import { promises as fsp } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { cloneRepo, deriveRepoName, validateCloneUrl } from './cloneRepo'

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

describe('validateCloneUrl', () => {
  it('accepts common transports', () => {
    expect(validateCloneUrl('https://github.com/gfargo/coco.git')).toBeUndefined()
    expect(validateCloneUrl('git://github.com/gfargo/coco.git')).toBeUndefined()
    expect(validateCloneUrl('ssh://git@github.com/gfargo/coco.git')).toBeUndefined()
    expect(validateCloneUrl('git@github.com:gfargo/coco.git')).toBeUndefined()
  })

  it('rejects a leading-dash remote (flag injection)', () => {
    expect(validateCloneUrl('--upload-pack=touch /tmp/pwned')).toMatch(/cannot start with/)
    expect(validateCloneUrl('-o ProxyCommand=x')).toMatch(/cannot start with/)
  })

  it('rejects ext:: remote-helper transports', () => {
    expect(validateCloneUrl("ext::sh -c 'touch /tmp/pwned'")).toMatch(/transport helper/)
  })

  it('rejects file:: and file:// transports', () => {
    expect(validateCloneUrl('file::/etc/passwd')).toMatch(/transport helper/)
    expect(validateCloneUrl('file:///etc/passwd')).toMatch(/unsupported scheme/)
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

  it('rejects a hostile leading-dash remote before touching git', async () => {
    const dest = path.join(dir, 'out')
    const result = await cloneRepo('--upload-pack=touch /tmp/pwned', dest)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/cannot start with/)
  })

  it('refuses to clobber an existing path', async () => {
    const existing = path.join(dir, 'taken')
    await fsp.mkdir(existing)
    const result = await cloneRepo('https://github.com/gfargo/coco.git', existing)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/already exists/)
  })
})
