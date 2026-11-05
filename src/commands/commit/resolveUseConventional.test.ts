import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { commitlintImpliesConventional } from '../../lib/utils/hasCommitlintConfig'
import { resolveUseConventional } from './resolveUseConventional'

describe('commitlintImpliesConventional (#2130)', () => {
  let dir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), 'coco-commitlint-'))
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}')
    process.chdir(dir)
  })
  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it('is true for commitlint.config.js extending config-conventional (the issue repro)', async () => {
    writeFileSync(
      join(dir, 'commitlint.config.js'),
      "module.exports = { extends: ['@commitlint/config-conventional'] }\n"
    )
    expect(await commitlintImpliesConventional()).toBe(true)
  })

  it('is true for a package.json commitlint key with the conventional preset', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', commitlint: { extends: ['@commitlint/config-conventional'] } })
    )
    expect(await commitlintImpliesConventional()).toBe(true)
  })

  it('is true when the config sets a type rule without a preset', async () => {
    writeFileSync(join(dir, '.commitlintrc.json'), '{"rules":{"type-enum":[2,"always",["feat","fix"]]}}')
    expect(await commitlintImpliesConventional()).toBe(true)
  })

  it('is false for a commitlint config with only unrelated rules', async () => {
    writeFileSync(join(dir, '.commitlintrc.json'), '{"rules":{"subject-max-length":[2,"always",72]}}')
    expect(await commitlintImpliesConventional()).toBe(false)
  })

  it('is false when there is no commitlint config', async () => {
    expect(await commitlintImpliesConventional()).toBe(false)
  })
})

describe('resolveUseConventional (#2130)', () => {
  let dir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), 'coco-resolve-'))
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}')
    writeFileSync(join(dir, 'commitlint.config.js'), "module.exports = { extends: ['@commitlint/config-conventional'] }\n")
    process.chdir(dir)
  })
  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to conventional when commitlint requires it and nothing says otherwise', async () => {
    expect(await resolveUseConventional({})).toBe(true)
  })

  it('lets an explicit conventionalCommits: false opt out', async () => {
    expect(await resolveUseConventional({ configConventional: false })).toBe(false)
  })

  it('honors the --conventional flag', async () => {
    expect(await resolveUseConventional({ argvConventional: true, configConventional: false })).toBe(true)
  })

  it('does not read repository commitlint config when detection is disabled (untrusted path)', async () => {
    expect(await resolveUseConventional({ detectCommitlint: false })).toBe(false)
  })
})
