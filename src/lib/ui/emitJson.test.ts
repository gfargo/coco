import { emitJson } from './emitJson'

describe('emitJson', () => {
  it('writes pretty-printed JSON with a trailing newline to stdout', () => {
    const writes: string[] = []
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)

    try {
      emitJson({ title: 'x', items: [1, 2] })
    } finally {
      spy.mockRestore()
    }

    expect(writes).toHaveLength(1)
    expect(writes[0].endsWith('\n')).toBe(true)
    expect(JSON.parse(writes[0])).toEqual({ title: 'x', items: [1, 2] })
    // pretty-printed (2-space indent), not single-line
    expect(writes[0]).toContain('\n  ')
  })

  it('serializes arrays and null', () => {
    const writes: string[] = []
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)

    try {
      emitJson([])
      emitJson(null)
    } finally {
      spy.mockRestore()
    }

    expect(JSON.parse(writes[0])).toEqual([])
    expect(JSON.parse(writes[1])).toBeNull()
  })
})
