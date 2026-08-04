import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isPathWithinRoot, confineRepoPath } from './pathWithinRoot'

// Helper: create a temp directory and return its realpath
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-pathtest-'))
  return fs.realpathSync(dir)
}

describe('isPathWithinRoot', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('returns true for a file directly inside root', () => {
    const file = path.join(root, 'inside.txt')
    fs.writeFileSync(file, 'hello')
    expect(isPathWithinRoot(file, root)).toBe(true)
  })

  it('returns true for root itself', () => {
    expect(isPathWithinRoot(root, root)).toBe(true)
  })

  it('returns true for a nested subdirectory', () => {
    const sub = path.join(root, 'a', 'b', 'c')
    fs.mkdirSync(sub, { recursive: true })
    expect(isPathWithinRoot(sub, root)).toBe(true)
  })

  it('returns false for a path outside root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-outside-'))
    try {
      const file = path.join(outside, 'secret.txt')
      fs.writeFileSync(file, 'secret')
      expect(isPathWithinRoot(file, root)).toBe(false)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('returns false for a nonexistent path', () => {
    expect(isPathWithinRoot(path.join(root, 'does-not-exist.txt'), root)).toBe(false)
  })

  it('returns false for a symlink inside root pointing outside', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-outside-'))
    try {
      const target = path.join(outside, 'secret.txt')
      fs.writeFileSync(target, 'secret')
      const link = path.join(root, 'escape-link.txt')
      fs.symlinkSync(target, link)
      expect(isPathWithinRoot(link, root)).toBe(false)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('returns true for a symlink inside root pointing inside root', () => {
    const target = path.join(root, 'real.txt')
    fs.writeFileSync(target, 'hello')
    const link = path.join(root, 'link.txt')
    fs.symlinkSync(target, link)
    expect(isPathWithinRoot(link, root)).toBe(true)
  })
})

describe('confineRepoPath', () => {
  let root: string

  beforeEach(() => {
    root = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('accepts a relative in-root path that exists', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'file.ts'), 'const x = 1')
    const result = confineRepoPath('src/file.ts', root)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.absPath).toBe(path.join(root, 'src', 'file.ts'))
    }
  })

  it('accepts a relative in-root path that does not exist (not-found branch)', () => {
    const result = confineRepoPath('src/nonexistent.ts', root)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.absPath).toBe(path.join(root, 'src', 'nonexistent.ts'))
    }
  })

  it('rejects an absolute path', () => {
    const result = confineRepoPath('/etc/passwd', root)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('absolute')
    }
  })

  it('rejects a path with a .. segment', () => {
    const result = confineRepoPath('../outside.txt', root)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('traversal')
    }
  })

  it('rejects a deeper .. traversal', () => {
    const result = confineRepoPath('src/../../etc/passwd', root)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('traversal')
    }
  })

  it('rejects a symlink inside root pointing outside', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-outside-'))
    try {
      const target = path.join(outside, 'secret.txt')
      fs.writeFileSync(target, 'secret')
      const link = path.join(root, 'escape-link.txt')
      fs.symlinkSync(target, link)
      const result = confineRepoPath('escape-link.txt', root)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('outside-root')
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('accepts a symlink inside root pointing to another in-root file', () => {
    const target = path.join(root, 'real.txt')
    fs.writeFileSync(target, 'hello')
    const link = path.join(root, 'link.txt')
    fs.symlinkSync(target, link)
    const result = confineRepoPath('link.txt', root)
    expect(result.ok).toBe(true)
  })
})
