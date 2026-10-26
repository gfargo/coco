import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { createSimpleGit } from './createSimpleGit'

describe('createSimpleGit', () => {
  let repoDir: string
  const originalAuthorName = process.env.GIT_AUTHOR_NAME
  const originalAuthorEmail = process.env.GIT_AUTHOR_EMAIL

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'coco-create-simple-git-'))
    await simpleGit(repoDir).init()
  })

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    process.env.GIT_AUTHOR_NAME = 'Ambient Probe'
    process.env.GIT_AUTHOR_EMAIL = 'ambient@example.com'
  })

  afterEach(() => {
    if (originalAuthorName === undefined) delete process.env.GIT_AUTHOR_NAME
    else process.env.GIT_AUTHOR_NAME = originalAuthorName
    if (originalAuthorEmail === undefined) delete process.env.GIT_AUTHOR_EMAIL
    else process.env.GIT_AUTHOR_EMAIL = originalAuthorEmail
  })

  it('passes ambient GIT_* variables through to git', async () => {
    const ident = await createSimpleGit(repoDir).raw(['var', 'GIT_AUTHOR_IDENT'])
    expect(ident).toContain('Ambient Probe <ambient@example.com>')
  })

  it('differs from bare simple-git, which strips guarded ambient variables', async () => {
    // Guards the reason this factory exists: if simple-git stops stripping
    // ambient variables, this wrapper can be simplified.
    const ident = await simpleGit(repoDir)
      .raw(['-c', 'user.name=Config Name', '-c', 'user.email=config@example.com', 'var', 'GIT_AUTHOR_IDENT'])
    expect(ident).not.toContain('Ambient Probe')
  })

  it('merges caller-supplied allowEnvironment entries', async () => {
    const git = createSimpleGit(repoDir, { allowEnvironment: ['GIT_COCO_EXTRA'] })
    await expect(git.raw(['var', 'GIT_AUTHOR_IDENT'])).resolves.toContain('Ambient Probe')
  })
})
