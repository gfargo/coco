import { resolveConfigKeySource } from './resolveConfigKeySource'
import { loadEnvConfig } from '../services/env'
import { loadGitConfig } from '../services/git'
import { loadProjectJsonConfig } from '../services/project'
import { loadXDGConfig } from '../services/xdg'

jest.mock('../services/env')
jest.mock('../services/git')
jest.mock('../services/project')
jest.mock('../services/xdg')

const mockLoadEnvConfig = loadEnvConfig as jest.MockedFunction<typeof loadEnvConfig>
const mockLoadGitConfig = loadGitConfig as jest.MockedFunction<typeof loadGitConfig>
const mockLoadProjectJsonConfig = loadProjectJsonConfig as jest.MockedFunction<typeof loadProjectJsonConfig>
const mockLoadXDGConfig = loadXDGConfig as jest.MockedFunction<typeof loadXDGConfig>

function noneActive() {
  mockLoadEnvConfig.mockReturnValue({ config: {}, active: false } as never)
  mockLoadProjectJsonConfig.mockReturnValue({ config: {}, path: undefined } as never)
  mockLoadGitConfig.mockReturnValue({ config: {}, path: undefined } as never)
  mockLoadXDGConfig.mockReturnValue({ config: {}, path: undefined } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  noneActive()
})

describe('resolveConfigKeySource', () => {
  it('falls back to default when no layer defines the key', () => {
    expect(resolveConfigKeySource('defaultBranch')).toEqual({ source: 'default' })
  })

  it('reports env when the env layer is active and defines the key', () => {
    mockLoadEnvConfig.mockReturnValue({
      config: { defaultBranch: 'from-env' },
      active: true,
    } as never)
    expect(resolveConfigKeySource('defaultBranch')).toEqual({ source: 'env' })
  })

  it('reports project (with path) when the project layer defines the key', () => {
    mockLoadProjectJsonConfig.mockReturnValue({
      config: { defaultBranch: 'from-project' },
      path: '/repo/.coco.json',
    } as never)
    expect(resolveConfigKeySource('defaultBranch')).toEqual({
      source: 'project',
      path: '/repo/.coco.json',
    })
  })

  it('reports git (with path) when the git layer defines the key', () => {
    mockLoadGitConfig.mockReturnValue({
      config: { defaultBranch: 'from-git' },
      path: '/home/user/.gitconfig',
    } as never)
    expect(resolveConfigKeySource('defaultBranch')).toEqual({
      source: 'git',
      path: '/home/user/.gitconfig',
    })
  })

  it('reports xdg (with path) when the xdg layer defines the key', () => {
    mockLoadXDGConfig.mockReturnValue({
      config: { defaultBranch: 'from-xdg' },
      path: '/home/user/.config/coco/config.json',
    } as never)
    expect(resolveConfigKeySource('defaultBranch')).toEqual({
      source: 'xdg',
      path: '/home/user/.config/coco/config.json',
    })
  })

  it('honors precedence — env wins over project, git, and xdg when all define the key', () => {
    mockLoadEnvConfig.mockReturnValue({ config: { defaultBranch: 'env' }, active: true } as never)
    mockLoadProjectJsonConfig.mockReturnValue({ config: { defaultBranch: 'project' }, path: '/p' } as never)
    mockLoadGitConfig.mockReturnValue({ config: { defaultBranch: 'git' }, path: '/g' } as never)
    mockLoadXDGConfig.mockReturnValue({ config: { defaultBranch: 'xdg' }, path: '/x' } as never)

    expect(resolveConfigKeySource('defaultBranch')).toEqual({ source: 'env' })
  })

  it('honors precedence — project wins over git and xdg when env does not define the key', () => {
    mockLoadProjectJsonConfig.mockReturnValue({ config: { defaultBranch: 'project' }, path: '/p' } as never)
    mockLoadGitConfig.mockReturnValue({ config: { defaultBranch: 'git' }, path: '/g' } as never)
    mockLoadXDGConfig.mockReturnValue({ config: { defaultBranch: 'xdg' }, path: '/x' } as never)

    expect(resolveConfigKeySource('defaultBranch')).toEqual({ source: 'project', path: '/p' })
  })

  it('resolves a nested dotted key', () => {
    mockLoadXDGConfig.mockReturnValue({
      config: { service: { model: 'gpt-4o' } },
      path: '/home/user/.config/coco/config.json',
    } as never)
    expect(resolveConfigKeySource('service.model')).toEqual({
      source: 'xdg',
      path: '/home/user/.config/coco/config.json',
    })
  })
})
