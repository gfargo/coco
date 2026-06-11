import * as os from 'node:os'
import * as path from 'node:path'

// Mock node:fs but keep every real implementation — `writeFileSync` is
// wrapped in a jest.fn that delegates to the real impl by default, so
// individual tests can override it (e.g. to simulate an EACCES failure) in
// a deterministic, OS-agnostic way. Native module properties are
// non-configurable and the namespace import is getter-only under ts-jest,
// so neither jest.spyOn(fs, ...) nor direct reassignment works here.
jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs')
  return { ...actual, writeFileSync: jest.fn() }
})

import * as fs from 'node:fs'

const actualFs = jest.requireActual('node:fs') as typeof fs
const mockedWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>

// Default to the real implementation so every other test writes for real;
// individual tests override this to simulate write failures.
beforeEach(() => {
  mockedWriteFileSync.mockImplementation(
    (...args: Parameters<typeof actualFs.writeFileSync>) => actualFs.writeFileSync(...args)
  )
})

import { getSavedThemePreset, getXdgConfigPath, saveThemePreset } from './themePersistence'

describe('theme preset persistence', () => {
  let tmpRoot: string
  let originalXdgConfigHome: string | undefined

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-theme-pref-'))
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = tmpRoot
  })

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('resolves the config path under XDG_CONFIG_HOME', () => {
    expect(getXdgConfigPath()).toBe(path.join(tmpRoot, 'coco', 'config.json'))
  })

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME
    expect(getXdgConfigPath()).toBe(path.join(os.homedir(), '.config', 'coco', 'config.json'))
  })

  it('round-trips a saved preset', () => {
    expect(getSavedThemePreset()).toBeUndefined()
    expect(saveThemePreset('gruvbox')).toBe(true)
    expect(getSavedThemePreset()).toBe('gruvbox')

    expect(saveThemePreset('catppuccin')).toBe(true)
    expect(getSavedThemePreset()).toBe('catppuccin')
  })

  it('writes logTui.theme.preset into a fresh config', () => {
    saveThemePreset('tokyo-night')
    const written = JSON.parse(fs.readFileSync(getXdgConfigPath(), 'utf8'))
    expect(written).toEqual({ logTui: { theme: { preset: 'tokyo-night' } } })
  })

  it('preserves every other key in an existing config', () => {
    const file = getXdgConfigPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({
        $schema: './schema.json',
        mode: 'interactive',
        service: { provider: 'openai', model: 'gpt-4o' },
        logTui: { idleTips: true, theme: { borderStyle: 'single' } },
      })
    )

    expect(saveThemePreset('nord')).toBe(true)
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))
    // Existing top-level + logTui sibling keys survive; only the preset is added.
    expect(written.$schema).toBe('./schema.json')
    expect(written.mode).toBe('interactive')
    expect(written.service).toEqual({ provider: 'openai', model: 'gpt-4o' })
    expect(written.logTui.idleTips).toBe(true)
    expect(written.logTui.theme).toEqual({ borderStyle: 'single', preset: 'nord' })
  })

  it('accepts the monochrome + default baselines', () => {
    expect(saveThemePreset('monochrome')).toBe(true)
    expect(getSavedThemePreset()).toBe('monochrome')
    expect(saveThemePreset('default')).toBe(true)
    expect(getSavedThemePreset()).toBe('default')
  })

  it('rejects an unknown preset without writing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(saveThemePreset('not-a-real-theme' as any)).toBe(false)
    expect(fs.existsSync(getXdgConfigPath())).toBe(false)
  })

  it('ignores a malformed existing config rather than throwing', () => {
    const file = getXdgConfigPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{ this is not json')

    expect(() => saveThemePreset('dracula')).not.toThrow()
    expect(getSavedThemePreset()).toBe('dracula')
  })

  it('is best-effort: returns false (no throw) when the path cannot be written', () => {
    // Force the write to fail deterministically on every platform by
    // mocking the fs call the writer uses, rather than relying on an
    // OS-specific "unwritable" path (e.g. `/dev/null/forbidden`, which
    // is not unwritable on Windows).
    mockedWriteFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    expect(() => saveThemePreset('gruvbox')).not.toThrow()
    expect(saveThemePreset('gruvbox')).toBe(false)
  })
})
