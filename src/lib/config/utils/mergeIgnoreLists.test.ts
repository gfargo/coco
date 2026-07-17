import { DEFAULT_IGNORED_EXTENSIONS, DEFAULT_IGNORED_FILES } from '../constants'
import { Config } from '../types'
import { mergeIgnoreLists } from './mergeIgnoreLists'

const baseConfig = (overrides: Partial<Config>) =>
  ({ ...overrides } as unknown as Config)

describe('mergeIgnoreLists (#851)', () => {
  it('returns the defaults when user has provided no custom lists', () => {
    const merged = mergeIgnoreLists(baseConfig({}))
    expect(merged.ignoredFiles).toEqual(DEFAULT_IGNORED_FILES)
    expect(merged.ignoredExtensions).toEqual(DEFAULT_IGNORED_EXTENSIONS)
  })

  it('appends user ignoredFiles after the defaults without duplicates', () => {
    const merged = mergeIgnoreLists(
      baseConfig({ ignoredFiles: ['mySecret.json', 'package-lock.json'] })
    )
    // Defaults first (full set, in original order)
    expect(merged.ignoredFiles?.slice(0, DEFAULT_IGNORED_FILES.length)).toEqual(
      DEFAULT_IGNORED_FILES
    )
    // Then user-only additions
    expect(merged.ignoredFiles).toContain('mySecret.json')
    // No duplicate of the existing default
    const counts = (merged.ignoredFiles as string[]).reduce<Record<string, number>>(
      (acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }),
      {}
    )
    expect(counts['package-lock.json']).toBe(1)
  })

  it('appends user ignoredExtensions after the defaults without duplicates', () => {
    const merged = mergeIgnoreLists(
      baseConfig({ ignoredExtensions: ['.snap', '.lock'] })
    )
    expect(merged.ignoredExtensions?.slice(0, DEFAULT_IGNORED_EXTENSIONS.length)).toEqual(
      DEFAULT_IGNORED_EXTENSIONS
    )
    expect(merged.ignoredExtensions).toContain('.snap')
    const counts = (merged.ignoredExtensions as string[]).reduce<Record<string, number>>(
      (acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }),
      {}
    )
    expect(counts['.lock']).toBe(1)
  })

  it('cannot drop a default — replacement attempts still keep all defaults', () => {
    // Repro of #851: a user that drops the lockfile entries from their
    // config used to wipe them; now the defaults are always present.
    const merged = mergeIgnoreLists(
      baseConfig({
        ignoredFiles: ['mySecret.json'],
        ignoredExtensions: ['.snap'],
      })
    )
    for (const fileName of DEFAULT_IGNORED_FILES) {
      expect(merged.ignoredFiles).toContain(fileName)
    }
    for (const ext of DEFAULT_IGNORED_EXTENSIONS) {
      expect(merged.ignoredExtensions).toContain(ext)
    }
  })

  // Regression (#1675): a loader that leaks a raw comma-separated string
  // (instead of splitting it into an array) used to be spread into
  // individual characters — a lone '*' character then matched every file.
  it('normalizes a stray string extras value instead of spreading it into characters', () => {
    const merged = mergeIgnoreLists(
      baseConfig({ ignoredFiles: '*.env,secrets' as unknown as string[] })
    )
    expect(merged.ignoredFiles).toContain('*.env')
    expect(merged.ignoredFiles).toContain('secrets')
    expect(merged.ignoredFiles).not.toContain('*')
    expect(merged.ignoredFiles).not.toContain('s')
    expect(merged.ignoredFiles?.length).toBe(DEFAULT_IGNORED_FILES.length + 2)
  })

  it('preserves other config fields untouched', () => {
    const config = baseConfig({
      ignoredFiles: ['extra.json'],
      defaultBranch: 'main',
      verbose: true,
    } as Partial<Config>)
    const merged = mergeIgnoreLists(config)
    expect((merged as Config).defaultBranch).toBe('main')
    expect((merged as Config).verbose).toBe(true)
  })
})
