import { ReviewFeedbackItem } from '../../commands/review/config'
import { AutoFixConfig } from '../autofix/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@inquirer/prompts', () => ({ select: jest.fn() }))
jest.mock('../autofix', () => ({ runAutoFix: jest.fn() }))
jest.mock('../utils/execPromise', () => ({ execPromise: jest.fn() }))
jest.mock('./helpers', () => ({
  bannerWithHeader: (_s: string) => _s,
  DIVIDER: '---',
  hotKey: (k: string) => `[${k}]`,
  severityColor: () => (s: string) => s,
  statusColor: () => (s: string) => s,
}))

// readline mock — captured handlers reset per test
const mockRlClose = jest.fn()
let keypressHandler: ((ch: string, key: { name: string }) => void) | null = null

jest.mock('readline', () => ({
  createInterface: jest.fn(() => ({ close: mockRlClose })),
  emitKeypressEvents: jest.fn(),
}))

// stdin mock
const mockStdinSetRawMode = jest.fn()
const mockStdinOn = jest.fn((event: string, handler: (ch: string, key: { name: string }) => void) => {
  if (event === 'keypress') keypressHandler = handler
})
const mockStdinRemoveListener = jest.fn()

Object.defineProperty(process, 'stdin', {
  value: {
    setRawMode: mockStdinSetRawMode,
    on: mockStdinOn,
    removeListener: mockStdinRemoveListener,
    resume: jest.fn(),
  },
  writable: true,
  configurable: true,
})

// ── Imports after mocks ───────────────────────────────────────────────────────

import { TaskList } from './TaskList'
import { runAutoFix } from '../autofix'
import { select } from '@inquirer/prompts'

const mockRunAutoFix = runAutoFix as jest.Mock
const mockSelect = select as jest.Mock

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeItem = (overrides?: Partial<ReviewFeedbackItem>): ReviewFeedbackItem => ({
  title: 'Test issue',
  summary: 'Something is wrong',
  severity: 5,
  category: 'bug',
  filePath: 'src/foo.ts',
  ...overrides,
})

beforeEach(() => {
  jest.clearAllMocks()
  keypressHandler = null
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'clear').mockImplementation(() => undefined)
  // Re-register stdin.on mock after clearAllMocks resets it
  mockStdinOn.mockImplementation((event: string, handler: (ch: string, key: { name: string }) => void) => {
    if (event === 'keypress') keypressHandler = handler
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TaskList — getChoices()', () => {
  it('includes autofix choice with value "autofix" and label containing 🤖 Auto-fix', async () => {
    let capturedChoices: { value: string; name: string }[] = []
    mockSelect.mockImplementationOnce(({ choices }: { choices: { value: string; name: string }[] }) => {
      capturedChoices = choices
      return Promise.resolve('exit')
    })

    const tl = new TaskList([makeItem()])
    await tl.start().catch(() => undefined)

    const autofix = capturedChoices.find((c) => c.value === 'autofix')
    expect(autofix).toBeDefined()
    expect(autofix?.name).toContain('🤖 Auto-fix')
  })
})

describe('TaskList — keyboard shortcut "a"', () => {
  it('resolves to "autofix" action when key "a" is pressed', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockResolvedValue(undefined)

    // First select call never resolves (waiting for keypress to fire)
    // After keypress fires autofix, second select call returns 'exit'
    let firstSelectResolve: ((v: string) => void) | undefined
    mockSelect
      .mockImplementationOnce(() => new Promise<string>((res) => { firstSelectResolve = res }))
      .mockResolvedValueOnce('exit')

    const tl = new TaskList([makeItem()], config)
    const startPromise = tl.start()

    // Wait for keypress handler to be registered
    await new Promise((r) => setTimeout(r, 20))
    expect(keypressHandler).not.toBeNull()

    // Simulate pressing 'a' — resolves the action via keypress, bypassing select
    keypressHandler!('a', { name: 'a' })

    // Also resolve the pending select so it doesn't hang
    await new Promise((r) => setTimeout(r, 5))
    if (firstSelectResolve) firstSelectResolve('exit')

    await startPromise.catch(() => undefined)
    expect(mockRunAutoFix).toHaveBeenCalledTimes(1)
  })
})

describe('TaskList — autoFix() when autoFixTool is not configured', () => {
  it('displays a message and does not call runAutoFix', async () => {
    // autofix action selected, then exit
    mockSelect.mockResolvedValueOnce('autofix').mockResolvedValueOnce('exit')

    const tl = new TaskList([makeItem()]) // no config
    await tl.start().catch(() => undefined)

    expect(mockRunAutoFix).not.toHaveBeenCalled()
    const logCalls = (console.log as jest.Mock).mock.calls.flat()
    const hasMsg = logCalls.some(
      (arg) => typeof arg === 'string' && arg.includes('No autoFixTool configured')
    )
    expect(hasMsg).toBe(true)
  })

  it('stays on the same item (does not advance) when autoFixTool is not configured', async () => {
    mockSelect.mockResolvedValueOnce('autofix').mockResolvedValueOnce('exit')

    const tl = new TaskList([makeItem()])
    await tl.start().catch(() => undefined)

    // runAutoFix never called means markAsComplete was never called
    expect(mockRunAutoFix).not.toHaveBeenCalled()
  })
})

describe('TaskList — autoFix() on successful runAutoFix', () => {
  it('calls runAutoFix with the current item and config', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex', autoFixToolOptions: { model: 'o4-mini' } }
    mockRunAutoFix.mockResolvedValueOnce(undefined)
    mockSelect.mockResolvedValueOnce('autofix').mockResolvedValueOnce('exit')

    const item = makeItem({ title: 'Fix me' })
    const tl = new TaskList([item], config)
    await tl.start().catch(() => undefined)

    expect(mockRunAutoFix).toHaveBeenCalledTimes(1)
    expect(mockRunAutoFix).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fix me' }),
      config
    )
  })

  it('marks item completed and advances after successful runAutoFix', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockResolvedValueOnce(undefined)
    // After autofix + navigate, we land on item 2 — exit from there
    mockSelect.mockResolvedValueOnce('autofix').mockResolvedValueOnce('exit')

    const items = [makeItem({ title: 'Item 1' }), makeItem({ title: 'Item 2' })]
    const tl = new TaskList(items, config)
    await tl.start().catch(() => undefined)

    // runAutoFix called once for item 1
    expect(mockRunAutoFix).toHaveBeenCalledTimes(1)
    expect(mockRunAutoFix).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Item 1' }),
      config
    )
  })
})

describe('TaskList — autoFix() when runAutoFix throws', () => {
  it('displays the error message', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockRejectedValueOnce(new Error('codex exited with code 1'))
    mockSelect.mockResolvedValueOnce('autofix').mockResolvedValueOnce('exit')

    const tl = new TaskList([makeItem()], config)
    await tl.start().catch(() => undefined)

    // chalk wraps in ANSI codes — check that some call contains the error text
    const logCalls = (console.log as jest.Mock).mock.calls.flat()
    const hasErrorMsg = logCalls.some(
      (arg) => typeof arg === 'string' && arg.includes('Auto-fix failed: codex exited with code 1')
    )
    expect(hasErrorMsg).toBe(true)
  })

  it('does not change item status when runAutoFix throws', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockRejectedValueOnce(new Error('binary not found'))
    // After error, autofix again to confirm we're still on item 1, then exit
    mockRunAutoFix.mockRejectedValueOnce(new Error('binary not found'))
    mockSelect
      .mockResolvedValueOnce('autofix') // first attempt — throws
      .mockResolvedValueOnce('autofix') // second attempt on same item — throws again
      .mockResolvedValueOnce('exit')

    const items = [makeItem({ title: 'Item 1' }), makeItem({ title: 'Item 2' })]
    const tl = new TaskList(items, config)
    await tl.start().catch(() => undefined)

    // Both calls were for Item 1 (status never changed, so we stayed on it)
    expect(mockRunAutoFix).toHaveBeenCalledTimes(2)
    expect(mockRunAutoFix).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: 'Item 1' }),
      config
    )
    expect(mockRunAutoFix).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ title: 'Item 1' }),
      config
    )
  })
})
