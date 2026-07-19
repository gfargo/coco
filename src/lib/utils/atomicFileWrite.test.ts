import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeFileAtomic } from './atomicFileWrite'

describe('writeFileAtomic', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-atomic-write-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the target file and leaves no tmp file behind', () => {
    const file = join(dir, 'data.json')
    writeFileAtomic(file, '{"ok":true}')
    expect(readFileSync(file, 'utf8')).toBe('{"ok":true}')
    expect(readdirSync(dir)).toEqual(['data.json'])
  })

  it('overwrites an existing file', () => {
    const file = join(dir, 'data.json')
    writeFileAtomic(file, 'first')
    writeFileAtomic(file, 'second')
    expect(readFileSync(file, 'utf8')).toBe('second')
  })

  if (process.platform !== 'win32') {
    it('writes the final file 0600', () => {
      const file = join(dir, 'data.json')
      writeFileAtomic(file, 'x')
      expect(statSync(file).mode & 0o777).toBe(0o600)
    })

    it('preserveExistingMode keeps the destination mode on overwrite', () => {
      const file = join(dir, 'CHANGELOG.md')
      writeFileAtomic(file, 'first')
      chmodSync(file, 0o644)
      writeFileAtomic(file, 'second', { preserveExistingMode: true })
      expect(readFileSync(file, 'utf8')).toBe('second')
      expect(statSync(file).mode & 0o777).toBe(0o644)
    })

    it('preserveExistingMode uses a umask-derived default for a new file', () => {
      const file = join(dir, 'CHANGELOG.md')
      writeFileAtomic(file, 'first', { preserveExistingMode: true })
      expect(statSync(file).mode & 0o777).toBe(0o666 & ~process.umask())
    })
  }
})
