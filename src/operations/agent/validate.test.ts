/**
 * #1845 — zero-token commit message tools. Validate a message the caller
 * wrote, list the rules, and never call a model, need a key, or load
 * repository commitlint config.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CommitlintRulesDataSchema, CommitValidateDataSchema, createAgentSuccessSchema } from './schemas'
import { runCommitlintRules, runCommitValidate } from './validate'

jest.mock('../../lib/langchain/utils/getLlm', () => ({
  getLlm: jest.fn(() => { throw new Error('commit-validate must not create an LLM') }),
}))
jest.mock('../../lib/langchain/utils/executeChain', () => ({
  executeChain: jest.fn(() => { throw new Error('commit-validate must not run a chain') }),
}))
jest.mock('../../lib/config/utils/loadConfig', () => ({
  loadConfig: jest.fn(() => { throw new Error('commit-validate must not load config') }),
}))

describe('runCommitValidate', () => {
  let repo: string
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'coco-validate-')) })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('passes a conforming message', async () => {
    const result = await runCommitValidate({ version: 1, message: 'feat(agent): add commit validation' }, repo)
    expect(result.data).toEqual({ valid: true, errors: [], warnings: [], rulesSource: 'built-in-conventional', repositoryConfig: 'absent' })
    expect(result.warnings).toEqual([])
    expect(createAgentSuccessSchema('commit-validate', CommitValidateDataSchema).safeParse(result).success).toBe(true)
  })

  it('names the rule a message breaks', async () => {
    const result = await runCommitValidate({ version: 1, message: `feat: ${'x'.repeat(120)}` }, repo)
    expect(result.data.valid).toBe(false)
    expect(result.data.errors.map((e) => e.rule)).toContain('header-max-length')
  })

  it('flags a pass as advisory when the repository has its own config, without executing it', async () => {
    // A config that would throw if it were ever loaded.
    writeFileSync(join(repo, 'commitlint.config.js'), "throw new Error('executed repository config')\n")
    const result = await runCommitValidate({ version: 1, message: 'fix: tidy' }, repo)
    expect(result.data).toMatchObject({ valid: true, repositoryConfig: 'detected' })
    expect(result.warnings[0]).toMatch(/does not load|do not load/)
  })

  it('reports unknown repository config without a repository', async () => {
    const result = await runCommitValidate({ version: 1, message: 'fix: tidy' }, undefined)
    expect(result.data.repositoryConfig).toBe('unknown')
  })
})

describe('runCommitlintRules', () => {
  it('lists the built-in rules as readable lines', async () => {
    const result = await runCommitlintRules({ version: 1 }, undefined)
    expect(result.data.rules.length).toBeGreaterThan(0)
    expect(result.data.rules.some((rule) => /Header/.test(rule))).toBe(true)
    expect(result.data).toMatchObject({ rulesSource: 'built-in-conventional', repositoryConfig: 'unknown' })
    expect(createAgentSuccessSchema('commitlint-rules', CommitlintRulesDataSchema).safeParse(result).success).toBe(true)
  })
})
