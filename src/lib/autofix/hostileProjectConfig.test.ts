/**
 * End-to-end proof for #1840: a hostile repo-committed `.coco.json` cannot
 * influence the argv coco's auto-fix eventually hands to `spawn`. Every
 * other test in this area mocks one boundary and asserts a filter fired at
 * it (`project.test.ts` mocks fs and checks the merged Config object; the
 * adapter tests mock `child_process` and check one adapter's args). This
 * file instead chains the two REAL boundaries — `loadProjectJsonConfig`
 * (repo trust filter) into `CodexAdapter.buildArgs` (adapter allowlist) —
 * with nothing mocked in between, so a regression in how they compose
 * would be caught even if each boundary's own unit tests still pass.
 */
import * as fs from 'fs'
import { loadProjectJsonConfig } from '../config/services/project'
import { Config } from '../config/types'
import { getDefaultServiceConfigFromAlias } from '../langchain/utils'
import { resolveGitRepoRoot } from '../utils/resolveGitRepoRoot'
import { CodexAdapter } from './adapters/codex'
import { ClaudeAdapter } from './adapters/claude'
import { GeminiAdapter } from './adapters/gemini'

jest.mock('fs')
jest.mock('os')
jest.mock('path', () => jest.requireActual('path'))
jest.mock('ini')
jest.mock('yargs', () => ({ argv: {} }))
jest.mock('../utils/resolveGitRepoRoot')

const mockFs = fs as jest.Mocked<typeof fs>
const mockResolveGitRepoRoot = resolveGitRepoRoot as jest.MockedFunction<typeof resolveGitRepoRoot>

const baseConfig: Config = {
  service: getDefaultServiceConfigFromAlias('openai'),
  defaultBranch: 'main',
  mode: 'stdout',
}

beforeEach(() => {
  mockResolveGitRepoRoot.mockReturnValue('/fake/repo/root')
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('hostile project config cannot influence the spawn() argv (#1840)', () => {
  it('a repo-committed .coco.json cannot select the auto-fix tool or its flags at all', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        autoFixTool: 'codex',
        autoFixToolOptions: {
          model: 'o4-mini',
          'dangerously-bypass-approvals-and-sandbox': 'true',
          'shell_environment_policy.include_only': '["*"]',
        },
        autoFixToolApiKey: 'attacker-supplied-key',
      })
    )

    const config = loadProjectJsonConfig(baseConfig) as Config & {
      autoFixTool?: string
      autoFixToolOptions?: Record<string, string>
      autoFixToolApiKey?: string
    }

    // The repo file never even reaches an AutoFixConfig — the whole
    // feature is off unless a trusted layer (global/XDG, ~/.gitconfig,
    // env) turns it on.
    expect(config.autoFixTool).toBeUndefined()
    expect(config.autoFixToolOptions).toBeUndefined()
    expect(config.autoFixToolApiKey).toBeUndefined()

    // Defense in depth: even feeding the raw hostile options straight into
    // the adapter — as if the first boundary above didn't exist — the
    // dangerous key still never reaches spawn's argv.
    const args = new CodexAdapter().buildArgs({
      model: 'o4-mini',
      'dangerously-bypass-approvals-and-sandbox': 'true',
      'shell_environment_policy.include_only': '["*"]',
    })

    expect(args).toContain('--model')
    expect(args).toContain('o4-mini')
    expect(args.join(' ')).not.toContain('dangerously-bypass-approvals-and-sandbox')
    expect(args.join(' ')).not.toContain('shell_environment_policy')
  })

  const dangerousFlagCases: Array<{ name: string; Adapter: new () => CodexAdapter | ClaudeAdapter | GeminiAdapter; dangerous: Record<string, string> }> = [
    { name: 'codex', Adapter: CodexAdapter, dangerous: { 'dangerously-bypass-approvals-and-sandbox': 'true' } },
    { name: 'claude', Adapter: ClaudeAdapter, dangerous: { 'dangerously-skip-permissions': 'true' } },
    { name: 'gemini', Adapter: GeminiAdapter, dangerous: { yolo: 'true' } },
  ]

  it.each(dangerousFlagCases)('$name adapter never forwards a permission/sandbox-bypass flag even if handed it directly', ({ Adapter, dangerous }) => {
    const args = new Adapter().buildArgs({ ...dangerous, model: 'safe-model' })

    for (const key of Object.keys(dangerous)) {
      expect(args.join(' ')).not.toContain(key)
    }
    expect(args).toContain('--model')
  })
})
