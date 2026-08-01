import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { readBaseline } from './readBaseline'

describe('readBaseline', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-bench-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reports missing when the file does not exist', () => {
    const result = readBaseline(path.join(dir, 'nope.json'))
    expect(result).toEqual({ status: 'missing' })
  })

  it('reports invalid on unparseable JSON', () => {
    const file = path.join(dir, 'baseline.json')
    fs.writeFileSync(file, '{ not json')

    const result = readBaseline(file)

    expect(result.status).toBe('invalid')
    expect((result as { reason: string }).reason).toContain('invalid JSON')
  })

  it('reports invalid when "results" is missing', () => {
    const file = path.join(dir, 'baseline.json')
    fs.writeFileSync(file, JSON.stringify({ capturedAt: 'now' }))

    const result = readBaseline(file)

    expect(result.status).toBe('invalid')
    expect((result as { reason: string }).reason).toContain('results')
  })

  it('reports invalid when "results" is not an array', () => {
    const file = path.join(dir, 'baseline.json')
    fs.writeFileSync(file, JSON.stringify({ results: 'nope' }))

    const result = readBaseline(file)

    expect(result.status).toBe('invalid')
  })

  it('returns the parsed results on a valid baseline', () => {
    const file = path.join(dir, 'baseline.json')
    const results = [{ fixture: 'tiny', fileCount: 1, approxTokens: 10, durationMs: 1, llmCalls: 0, llmTotalMs: 0, llmTotalPromptTokens: 0 }]
    fs.writeFileSync(file, JSON.stringify({ results }))

    const result = readBaseline(file)

    expect(result).toEqual({ status: 'ok', results })
  })
})
