import fs from 'fs'
import os from 'os'
import path from 'path'
import {
    checkProjectScopeKeyTrust,
    readScopedConfigFile,
    resolveScopedConfigPath,
    writeScopedConfigFile,
} from './scopedConfigFile'
import { getXdgConfigPath } from '../services/xdg'
import { resolveGitRepoRoot } from '../../utils/resolveGitRepoRoot'

jest.mock('../services/xdg', () => ({
  getXdgConfigPath: jest.fn(),
}))
jest.mock('../../utils/resolveGitRepoRoot', () => ({
  resolveGitRepoRoot: jest.fn(),
}))

const mockGetXdgConfigPath = getXdgConfigPath as jest.MockedFunction<typeof getXdgConfigPath>
const mockResolveGitRepoRoot = resolveGitRepoRoot as jest.MockedFunction<typeof resolveGitRepoRoot>

describe('resolveScopedConfigPath', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-scoped-config-'))
    mockResolveGitRepoRoot.mockReturnValue(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns the XDG config path for global scope', () => {
    mockGetXdgConfigPath.mockReturnValue('/home/user/.config/coco/config.json')
    expect(resolveScopedConfigPath('global')).toBe('/home/user/.config/coco/config.json')
  })

  it('defaults to .coco.json for project scope when neither file exists', () => {
    expect(resolveScopedConfigPath('project')).toBe(path.join(dir, '.coco.json'))
  })

  it('prefers an existing .coco.json', () => {
    fs.writeFileSync(path.join(dir, '.coco.json'), '{}')
    expect(resolveScopedConfigPath('project')).toBe(path.join(dir, '.coco.json'))
  })

  it('falls back to an existing .coco.config.json when .coco.json is absent', () => {
    fs.writeFileSync(path.join(dir, '.coco.config.json'), '{}')
    expect(resolveScopedConfigPath('project')).toBe(path.join(dir, '.coco.config.json'))
  })
})

describe('readScopedConfigFile / writeScopedConfigFile', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-scoped-config-rw-'))
    filePath = path.join(dir, '.coco.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reads {} for a missing file', () => {
    expect(readScopedConfigFile(filePath)).toEqual({})
  })

  it('reads {} for an empty file', () => {
    fs.writeFileSync(filePath, '')
    expect(readScopedConfigFile(filePath)).toEqual({})
  })

  it('throws when the file root is not a JSON object', () => {
    fs.writeFileSync(filePath, '[1,2,3]')
    expect(() => readScopedConfigFile(filePath)).toThrow(/does not contain a JSON object/)
  })

  it('round-trips a config object with a $schema pointer added', () => {
    writeScopedConfigFile(filePath, { defaultBranch: 'develop' })
    const written = fs.readFileSync(filePath, 'utf8')
    expect(written).toContain('"$schema"')
    expect(readScopedConfigFile(filePath)).toEqual({
      $schema: expect.stringContaining('schema.json'),
      defaultBranch: 'develop',
    })
  })

  it('replaces a pre-existing $schema value rather than duplicating it', () => {
    writeScopedConfigFile(filePath, { $schema: 'https://stale.example/old.json', defaultBranch: 'main' })
    const written = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    expect(written.$schema).not.toBe('https://stale.example/old.json')
    expect(Object.keys(written).filter((k) => k === '$schema')).toHaveLength(1)
  })
})

describe('checkProjectScopeKeyTrust', () => {
  it('allows non-service keys', () => {
    expect(checkProjectScopeKeyTrust('defaultBranch')).toBeUndefined()
    expect(checkProjectScopeKeyTrust('logTui.theme.preset')).toBeUndefined()
  })

  it('allows trusted service keys', () => {
    expect(checkProjectScopeKeyTrust('service.model')).toBeUndefined()
    expect(checkProjectScopeKeyTrust('service.tokenLimit')).toBeUndefined()
    expect(checkProjectScopeKeyTrust('service.provider')).toBeUndefined()
  })

  it('rejects untrusted service keys that control where requests go or what credentials they carry', () => {
    expect(checkProjectScopeKeyTrust('service.baseURL')).toBeDefined()
    expect(checkProjectScopeKeyTrust('service.endpoint')).toBeDefined()
    expect(checkProjectScopeKeyTrust('service.authentication')).toBeDefined()
    expect(checkProjectScopeKeyTrust('service.authentication.credentials.apiKey')).toBeDefined()
  })

  it('includes the rejected key and a --scope global suggestion in the error message', () => {
    const message = checkProjectScopeKeyTrust('service.baseURL')
    expect(message).toContain('service.baseURL')
    expect(message).toContain('--scope global')
  })
})
