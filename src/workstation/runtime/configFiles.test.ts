import { promises as fsp } from 'fs'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  ensureConfigFile,
  getProjectConfigPath,
  resolveConfigPath,
} from './configFiles'

describe('config file resolution + scaffolding', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'coco-config-'))
  })
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  describe('getProjectConfigPath', () => {
    it('defaults to .coco.json when no config exists', () => {
      expect(getProjectConfigPath(dir)).toBe(path.join(dir, '.coco.json'))
    })

    it('prefers an existing .coco.json', () => {
      fs.writeFileSync(path.join(dir, '.coco.json'), '{}')
      expect(getProjectConfigPath(dir)).toBe(path.join(dir, '.coco.json'))
    })

    it('falls back to the legacy .coco.config.json when only it exists', () => {
      fs.writeFileSync(path.join(dir, '.coco.config.json'), '{}')
      expect(getProjectConfigPath(dir)).toBe(path.join(dir, '.coco.config.json'))
    })
  })

  describe('resolveConfigPath', () => {
    it('routes project scope to the repo root', () => {
      expect(resolveConfigPath('project', dir)).toBe(path.join(dir, '.coco.json'))
    })
    it('routes global scope to the XDG path (ignores repo root)', () => {
      const prev = process.env.XDG_CONFIG_HOME
      process.env.XDG_CONFIG_HOME = dir
      try {
        expect(resolveConfigPath('global', '/some/repo')).toBe(
          path.join(dir, 'coco', 'config.json')
        )
      } finally {
        if (prev === undefined) delete process.env.XDG_CONFIG_HOME
        else process.env.XDG_CONFIG_HOME = prev
      }
    })
  })

  describe('ensureConfigFile', () => {
    it('scaffolds a starter file (with $schema) when missing', () => {
      const file = path.join(dir, '.coco.json')
      const result = ensureConfigFile(file)
      expect(result.created).toBe(true)
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      expect(parsed.$schema).toContain('schema.json')
      expect(parsed.logTui.theme.preset).toBe('default')
    })

    it('creates missing parent directories', () => {
      const file = path.join(dir, 'nested', 'deep', 'config.json')
      expect(ensureConfigFile(file).created).toBe(true)
      expect(fs.existsSync(file)).toBe(true)
    })

    it('does not overwrite an existing file', () => {
      const file = path.join(dir, '.coco.json')
      fs.writeFileSync(file, '{"conventionalCommits":true}')
      const result = ensureConfigFile(file)
      expect(result.created).toBe(false)
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ conventionalCommits: true })
    })
  })
})
