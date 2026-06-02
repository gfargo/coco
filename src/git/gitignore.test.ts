import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { addToGitignore } from './gitignore'

// Minimal SimpleGit stub — only `revparse(['--show-toplevel'])` is used.
function fakeGit(root: string | null) {
  return {
    revparse: jest.fn(async () => (root === null ? Promise.reject(new Error('not a repo')) : `${root}\n`)),
  } as never
}

describe('addToGitignore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coco-gitignore-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const readIgnore = () => fs.readFile(path.join(dir, '.gitignore'), 'utf8')

  it('creates .gitignore when it does not exist', async () => {
    const result = await addToGitignore(fakeGit(dir), '.www/')
    expect(result.ok).toBe(true)
    expect(result.message).toContain('Added .www/')
    expect(await readIgnore()).toBe('.www/\n')
  })

  it('appends to an existing file, adding a separating newline when missing', async () => {
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules') // no trailing newline
    await addToGitignore(fakeGit(dir), '*.log')
    expect(await readIgnore()).toBe('node_modules\n*.log\n')
  })

  it('does not duplicate an already-present pattern', async () => {
    await fs.writeFile(path.join(dir, '.gitignore'), 'dist/\n*.log\n')
    const result = await addToGitignore(fakeGit(dir), '*.log')
    expect(result.ok).toBe(true)
    expect(result.message).toContain('already in .gitignore')
    expect(await readIgnore()).toBe('dist/\n*.log\n') // unchanged
  })

  it('trims surrounding whitespace before writing/matching', async () => {
    await fs.writeFile(path.join(dir, '.gitignore'), '  *.log  \n')
    const result = await addToGitignore(fakeGit(dir), '*.log')
    expect(result.message).toContain('already in .gitignore')
  })

  it('rejects an empty pattern', async () => {
    const result = await addToGitignore(fakeGit(dir), '   ')
    expect(result.ok).toBe(false)
    expect(result.message).toBe('No pattern to add.')
  })

  it('fails gracefully when the repo root cannot be resolved', async () => {
    const result = await addToGitignore(fakeGit(null), '*.log')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('repository root')
  })
})
