import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getXdgConfigPath, loadXDGConfig, persistUsagePreference } from './xdg'

// Real-fs round-trip (separate file from xdg.test.ts, which mocks fs).
describe('persistUsagePreference (#0.69)', () => {
  let dir: string
  const prev = process.env.XDG_CONFIG_HOME

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-xdg-'))
    process.env.XDG_CONFIG_HOME = dir
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = prev
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('writes telemetry.usage to the global config and loadXDGConfig reads it back', () => {
    expect(persistUsagePreference(true)).toBe(true)

    const onDisk = JSON.parse(fs.readFileSync(getXdgConfigPath(), 'utf8'))
    expect(onDisk.telemetry.usage).toBe(true)

    const loaded = loadXDGConfig<{ telemetry?: { usage?: boolean } }>({})
    expect(loaded.telemetry?.usage).toBe(true)
  })

  it('merges into existing config without clobbering other keys', () => {
    fs.mkdirSync(path.dirname(getXdgConfigPath()), { recursive: true })
    fs.writeFileSync(
      getXdgConfigPath(),
      JSON.stringify({ logTui: { theme: { preset: 'dracula' } } })
    )

    expect(persistUsagePreference(false)).toBe(true)

    const onDisk = JSON.parse(fs.readFileSync(getXdgConfigPath(), 'utf8'))
    expect(onDisk.telemetry.usage).toBe(false)
    expect(onDisk.logTui.theme.preset).toBe('dracula')
  })
})
