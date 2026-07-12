import { BaseArgvOptions, BaseCommandOptions } from '../../../commands/types'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'
import { DEFAULT_IGNORED_EXTENSIONS, DEFAULT_IGNORED_FILES } from '../constants'
import { loadConfig } from './loadConfig'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveGitRepoRoot } from '../../utils/resolveGitRepoRoot'

jest.mock('fs')
jest.mock('os')
// Real implementation: the project-config loader joins the resolved repo
// root with the candidate filename via path.join (#1616) — nothing in
// this file asserts on a mocked path.join, so keeping the real behavior
// lets that join actually produce a path instead of `undefined`.
jest.mock('path', () => jest.requireActual('path'))
jest.mock('ini')
// Stubbed to a fixed fake root so these tests stay deterministic instead
// of resolving against whatever checkout happens to run them.
jest.mock('../../utils/resolveGitRepoRoot')

const mockFs = fs as jest.Mocked<typeof fs>
const mockOs = os as jest.Mocked<typeof os>
const mockResolveGitRepoRoot = resolveGitRepoRoot as jest.MockedFunction<typeof resolveGitRepoRoot>
const FAKE_REPO_ROOT = '/fake/repo/root'
// project.ts joins this with path.join, which is platform-native (`\` on
// Windows) — build it the same way here, or the comparisons below
// silently mismatch (and existsSync's mock returns false for everything)
// on Windows CI.
const PROJECT_CONFIG_PATH = path.join(FAKE_REPO_ROOT, '.coco.config.json')

describe('loadConfig', () => {
  beforeEach(() => {
    mockFs.existsSync.mockClear()
    mockFs.readFileSync.mockClear()
    mockResolveGitRepoRoot.mockReturnValue(FAKE_REPO_ROOT)
    // Real path.join (above) needs a real string from os.homedir(), which
    // is otherwise auto-mocked to return undefined.
    mockOs.homedir.mockReturnValue('/fake/home')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should correctly combine all config sources', () => {
    mockFs.existsSync.mockImplementation((filepath: fs.PathLike | undefined) => {
      return filepath
        ? ['.gitignore', '.ignore', 'config.json', '.gitconfig', PROJECT_CONFIG_PATH].includes(
            filepath.toString()
          )
        : false
    })

    mockFs.readFileSync.mockImplementation((filepath) => {
      switch (filepath.toString()) {
        case '.gitignore':
          return 'gitignorefile.txt\n'
        case '.ignore':
          return 'ignorefile.txt\n'
        case 'config.json':
          return JSON.stringify({ openAIApiKey: 'xdgConfigKey' })
        case '.gitconfig':
          return 'coco\nopenAIApiKey=gitConfigKey\ntokenLimit=250\n'
        case PROJECT_CONFIG_PATH:
          return JSON.stringify({ service: getDefaultServiceConfigFromAlias('ollama') })
        default:
          return ''
      }
    })

    process.env.OPENAI_API_KEY = 'envApiKey'
    process.env.COCO_TOKEN_LIMIT = '350'

    // TODO: Fix this empty object and underlying types
    const argv = {} as BaseArgvOptions

    const config = loadConfig<BaseCommandOptions>(argv)

    // Check that the configuration is correctly combined
    expect(config.service.provider).toBe('ollama')
    // expect(config.tokenLimit).toBe(450) // environment variable should be overwritten by cmd line flag
    expect(config.ignoredFiles).toContain('gitignorefile.txt')
    expect(config.ignoredFiles).toContain('ignorefile.txt')
    expect(config.mode).toBe('stdout')
    // Cleanup
    delete process.env.OPENAI_API_KEY
    delete process.env.COCO_TOKEN_LIMIT
  })

  it('keeps default ignored files / extensions when project config provides only a subset (#851)', () => {
    // Repro for #851: a user's `.coco.config.json` that includes
    // ignoredExtensions but omits the lockfile entries used to wipe
    // the canonical defaults. The merge step in loadConfig keeps the
    // defaults regardless of what the user provides.
    mockFs.existsSync.mockImplementation((filepath: fs.PathLike | undefined) => {
      return filepath
        ? [PROJECT_CONFIG_PATH].includes(filepath.toString())
        : false
    })
    mockFs.readFileSync.mockImplementation((filepath) => {
      if (filepath.toString() === PROJECT_CONFIG_PATH) {
        return JSON.stringify({
          ignoredExtensions: ['.snap'],
          ignoredFiles: ['mySecret.json'],
        })
      }
      return ''
    })

    const config = loadConfig<BaseCommandOptions>({} as BaseArgvOptions)

    // User additions are preserved.
    expect(config.ignoredExtensions).toContain('.snap')
    expect(config.ignoredFiles).toContain('mySecret.json')
    // Defaults are still present — this is the bug fix.
    for (const ext of DEFAULT_IGNORED_EXTENSIONS) {
      expect(config.ignoredExtensions).toContain(ext)
    }
    for (const fileName of DEFAULT_IGNORED_FILES) {
      expect(config.ignoredFiles).toContain(fileName)
    }
  })

  it('does not let an unset argv key clobber config-sourced verbose/includeBranchName (#1437)', () => {
    // Repro for #1437: yargs used to materialize `default:`-ed options
    // (verbose, includeBranchName) into argv on every run, so the final
    // `{ ...config, ...argv }` merge in loadConfig always overwrote the
    // documented config value with the yargs default. Once those
    // `default:` entries are removed, yargs omits the key from argv when
    // the flag isn't passed — argv here mirrors that post-fix shape.
    mockFs.existsSync.mockImplementation((filepath: fs.PathLike | undefined) => {
      return filepath ? [PROJECT_CONFIG_PATH].includes(filepath.toString()) : false
    })
    mockFs.readFileSync.mockImplementation((filepath) => {
      if (filepath.toString() === PROJECT_CONFIG_PATH) {
        return JSON.stringify({ verbose: true, includeBranchName: false })
      }
      return ''
    })

    const config = loadConfig<BaseCommandOptions>({} as BaseArgvOptions)

    expect(config.verbose).toBe(true)
    expect(config.includeBranchName).toBe(false)
  })

  it('still lets an explicitly-passed argv flag override config for verbose/includeBranchName (#1437)', () => {
    mockFs.existsSync.mockImplementation((filepath: fs.PathLike | undefined) => {
      return filepath ? [PROJECT_CONFIG_PATH].includes(filepath.toString()) : false
    })
    mockFs.readFileSync.mockImplementation((filepath) => {
      if (filepath.toString() === PROJECT_CONFIG_PATH) {
        return JSON.stringify({ verbose: true, includeBranchName: false })
      }
      return ''
    })

    const config = loadConfig<BaseCommandOptions>(({
      verbose: false,
      includeBranchName: true,
    } as unknown) as BaseArgvOptions)

    expect(config.verbose).toBe(false)
    expect(config.includeBranchName).toBe(true)
  })
})
