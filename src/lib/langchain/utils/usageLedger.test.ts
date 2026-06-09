import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  clearUsageLog,
  getUsageLogPath,
  isUsageLoggingEnabled,
  readUsageRecords,
  recordUsage,
  summarizeUsageByModel,
  summarizeUsageByTask,
} from './usageLedger'

describe('usageLedger', () => {
  let dir: string
  let logPath: string
  const prevEnv = process.env.COCO_USAGE_LOG

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-usage-'))
    logPath = path.join(dir, 'usage.jsonl')
    process.env.COCO_USAGE_LOG = logPath
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.COCO_USAGE_LOG
    else process.env.COCO_USAGE_LOG = prevEnv
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('treats a path value as the ledger location and reports logging enabled', () => {
    expect(isUsageLoggingEnabled()).toBe(true)
    expect(getUsageLogPath()).toBe(logPath)
  })

  it('records and reads back usage entries', () => {
    recordUsage({ task: 'commit', command: 'commit', model: 'gpt-4o', promptTokens: 100, elapsedMs: 500 })
    recordUsage({ task: 'commit', command: 'commit', model: 'gpt-4o', promptTokens: 200, elapsedMs: 700 })
    recordUsage({ task: 'review', command: 'review', model: 'gpt-4.1', promptTokens: 50, elapsedMs: 1000 })

    const records = readUsageRecords()
    expect(records).toHaveLength(3)
  })

  it('does not record when logging is disabled', () => {
    process.env.COCO_USAGE_LOG = '0'
    recordUsage({ task: 'commit', promptTokens: 100 })
    expect(isUsageLoggingEnabled()).toBe(false)
    // path resolves to the default, not our temp file, and nothing was written
    expect(fs.existsSync(logPath)).toBe(false)
  })

  it('aggregates by task with totals and averages', () => {
    recordUsage({ task: 'commit', model: 'gpt-4o', promptTokens: 100, elapsedMs: 400 })
    recordUsage({ task: 'commit', model: 'gpt-4o', promptTokens: 300, elapsedMs: 600 })
    recordUsage({ task: 'review', model: 'gpt-4.1', promptTokens: 50, elapsedMs: 1000 })

    const byTask = summarizeUsageByTask(readUsageRecords())
    const commit = byTask.find((r) => r.key === 'commit')
    expect(commit).toMatchObject({ calls: 2, promptTokens: 400, totalMs: 1000, avgMs: 500 })

    const byModel = summarizeUsageByModel(readUsageRecords())
    expect(byModel.find((r) => r.key === 'gpt-4o')?.calls).toBe(2)
  })

  it('returns [] for a missing ledger and clears the file', () => {
    expect(readUsageRecords(path.join(dir, 'nope.jsonl'))).toEqual([])
    recordUsage({ task: 'commit', promptTokens: 1 })
    expect(fs.existsSync(logPath)).toBe(true)
    clearUsageLog()
    expect(fs.existsSync(logPath)).toBe(false)
  })

  it('skips malformed lines without throwing', () => {
    fs.writeFileSync(logPath, '{bad json\n{"task":"commit","promptTokens":5}\n', 'utf8')
    const records = readUsageRecords()
    expect(records).toHaveLength(1)
    expect(records[0].task).toBe('commit')
  })
})
