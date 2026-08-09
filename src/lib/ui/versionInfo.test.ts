import { buildVersionInfo, emitVersionJson } from './versionInfo'

describe('buildVersionInfo', () => {
  it('reports version, node, platform, arch, and a provider (or undefined)', () => {
    const info = buildVersionInfo()

    expect(typeof info.version).toBe('string')
    expect(info.version.length).toBeGreaterThan(0)
    expect(info.node).toBe(process.versions.node)
    expect(info.platform).toBe(process.platform)
    expect(info.arch).toBe(process.arch)
    expect(['string', 'undefined']).toContain(typeof info.provider)
  })
})

describe('emitVersionJson', () => {
  it('writes buildVersionInfo() as JSON to stdout', () => {
    const writes: string[] = []
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)

    try {
      emitVersionJson()
    } finally {
      spy.mockRestore()
    }

    expect(writes).toHaveLength(1)
    const parsed = JSON.parse(writes[0])
    expect(parsed).toEqual(buildVersionInfo())
  })
})
