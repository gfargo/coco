import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
    clearUsageLog,
    getUsageLogPath,
    isUsageLoggingEnabled,
    readUsageRecords,
    recordUsage,
    resetUsageLedgerState,
    setUsageConfigPreference,
    setUsageRepoTag,
    summarizeUsageByModel,
    summarizeUsageByRepo,
    summarizeUsageBySurface,
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

  it('persists and aggregates the invocation surface while treating legacy records as CLI', () => {
    recordUsage({ task: 'commit', surface: 'agent-cli', promptTokens: 30, completionTokens: 3, elapsedMs: 300 })
    recordUsage({ task: 'review', surface: 'mcp', promptTokens: 20, completionTokens: 2, elapsedMs: 200 })
    fs.appendFileSync(logPath, `${JSON.stringify({ t: Date.now(), task: 'legacy', promptTokens: 10, elapsedMs: 100 })}\n`)

    const records = readUsageRecords()
    expect(records.map((record) => record.surface)).toEqual(['agent-cli', 'mcp', undefined])
    expect(summarizeUsageBySurface(records)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'agent-cli', calls: 1, promptTokens: 30, completionTokens: 3 }),
      expect.objectContaining({ key: 'mcp', calls: 1, promptTokens: 20, completionTokens: 2 }),
      expect.objectContaining({ key: 'cli', calls: 1, promptTokens: 10 }),
    ]))
  })

  it('serializes metadata only and cannot persist prompt, diff, or code fields', () => {
    const sensitive = {
      prompt: 'SECRET_PROMPT_CONTENT',
      diff: 'SECRET_DIFF_CONTENT',
      code: 'SECRET_CODE_CONTENT',
      messages: ['SECRET_MESSAGE_CONTENT'],
      variables: { source: 'SECRET_VARIABLE_CONTENT' },
    }
    recordUsage({
      task: 'review',
      command: 'agent-review',
      surface: 'mcp',
      provider: 'openai',
      model: 'gpt-test',
      promptTokens: 42,
      completionTokens: 7,
      elapsedMs: 123,
      ...sensitive,
    } as Parameters<typeof recordUsage>[0])

    const serialized = fs.readFileSync(logPath, 'utf8')
    const parsed = JSON.parse(serialized.trim()) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual([
      'command',
      'completionTokens',
      'elapsedMs',
      'model',
      'promptTokens',
      'provider',
      'surface',
      't',
      'task',
    ])
    expect(serialized).not.toContain('SECRET_')
    expect(parsed).not.toHaveProperty('prompt')
    expect(parsed).not.toHaveProperty('diff')
    expect(parsed).not.toHaveProperty('code')
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

describe('usageLedger config-driven enablement (#0.69)', () => {
  let dir: string
  let defaultLogPath: string
  const prevUsage = process.env.COCO_USAGE_LOG
  const prevCache = process.env.XDG_CACHE_HOME

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-usage-cfg-'))
    delete process.env.COCO_USAGE_LOG
    process.env.XDG_CACHE_HOME = dir
    defaultLogPath = path.join(dir, 'coco', 'usage.jsonl')
    resetUsageLedgerState()
  })

  afterEach(() => {
    if (prevUsage === undefined) delete process.env.COCO_USAGE_LOG
    else process.env.COCO_USAGE_LOG = prevUsage
    if (prevCache === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = prevCache
    resetUsageLedgerState()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('is off when neither the env var nor a config preference is set', () => {
    expect(isUsageLoggingEnabled()).toBe(false)
  })

  it('records when the config preference is on and no env var is set', () => {
    setUsageConfigPreference(true)
    expect(isUsageLoggingEnabled()).toBe(true)
    recordUsage({ task: 'commit', model: 'gpt-4o', promptTokens: 10 })
    expect(readUsageRecords(defaultLogPath)).toHaveLength(1)
  })

  it('stays off when the config preference is explicitly off', () => {
    setUsageConfigPreference(false)
    expect(isUsageLoggingEnabled()).toBe(false)
  })

  it('lets COCO_USAGE_LOG=0 force recording off despite the config being on', () => {
    setUsageConfigPreference(true)
    process.env.COCO_USAGE_LOG = '0'
    expect(isUsageLoggingEnabled()).toBe(false)
  })

  it('lets COCO_USAGE_LOG=1 force recording on despite the config being off', () => {
    setUsageConfigPreference(false)
    process.env.COCO_USAGE_LOG = '1'
    expect(isUsageLoggingEnabled()).toBe(true)
  })

  it('stamps the active repo tag onto records and aggregates by repo', () => {
    setUsageConfigPreference(true)
    setUsageRepoTag('gfargo/coco')
    recordUsage({ task: 'commit', model: 'gpt-4o', promptTokens: 10 })
    setUsageRepoTag('gfargo/git-co.co')
    recordUsage({ task: 'review', model: 'gpt-4o', promptTokens: 20 })

    const records = readUsageRecords(defaultLogPath)
    expect(records.map((r) => r.repo).sort()).toEqual(['gfargo/coco', 'gfargo/git-co.co'])
    const byRepo = summarizeUsageByRepo(records)
    expect(byRepo.find((r) => r.key === 'gfargo/coco')?.calls).toBe(1)
    expect(byRepo.find((r) => r.key === 'gfargo/git-co.co')?.promptTokens).toBe(20)
  })

  it('leaves repo off the record when no tag is set', () => {
    setUsageConfigPreference(true)
    recordUsage({ task: 'commit', promptTokens: 5 })
    expect(readUsageRecords(defaultLogPath)[0].repo).toBeUndefined()
  })
})

describe('usageLedger rotation (#0.69)', () => {
  let dir: string
  let logPath: string
  const prevEnv = process.env.COCO_USAGE_LOG

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-usage-rot-'))
    logPath = path.join(dir, 'usage.jsonl')
    process.env.COCO_USAGE_LOG = logPath
    resetUsageLedgerState()
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.COCO_USAGE_LOG
    else process.env.COCO_USAGE_LOG = prevEnv
    resetUsageLedgerState()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('caps an oversized ledger to its most recent records on write', () => {
    // Seed a ledger over the 5 MB cap and past the 20k-record trim threshold,
    // with a recognizable oldest line that rotation should drop.
    const filler = 'x'.repeat(240)
    const lines: string[] = [JSON.stringify({ t: 1, task: 'OLDEST', model: filler })]
    for (let i = 0; i < 22000; i++) {
      lines.push(JSON.stringify({ t: i + 2, task: 'commit', model: filler }))
    }
    fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8')
    expect(fs.statSync(logPath).size).toBeGreaterThan(5 * 1024 * 1024)

    recordUsage({ task: 'NEWEST', promptTokens: 1 })

    const records = readUsageRecords()
    expect(records.length).toBeLessThanOrEqual(20000)
    expect(records.some((r) => r.task === 'OLDEST')).toBe(false)
    expect(records[records.length - 1].task).toBe('NEWEST')
  })
})
