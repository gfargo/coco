import { ReviewFeedbackItem } from '../../commands/review/config'
import { AutoFixConfig } from '../autofix/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../autofix', () => ({ runAutoFix: jest.fn() }))
jest.mock('../utils/execPromise', () => ({ execPromise: jest.fn() }))
jest.mock('./helpers', () => ({
  bannerWithHeader: (_s: string) => _s,
  DIVIDER: '---',
  hotKey: (k: string) => `[${k}]`,
  severityColor: () => (s: string) => s,
  statusColor: () => (s: string) => s,
}))

const mockRlClose = jest.fn()
let keypressHandler: ((ch: string, key: { name: string }) => void) | null = null

jest.mock('readline', () => ({
  createInterface: jest.fn(() => ({ close: mockRlClose })),
  emitKeypressEvents: jest.fn(),
}))

const mockStdinSetRawMode = jest.fn()
const mockStdinOn = jest.fn((event: string, handler: (ch: string, key: { name: string }) => void) => {
  if (event === 'keypress') keypressHandler = handler
})
const mockStdinRemoveListener = jest.fn(
  (event: string, handler: (ch: string, key: { name: string }) => void) => {
    if (event === 'keypress' && keypressHandler === handler) keypressHandler = null
  }
)

Object.defineProperty(process, 'stdin', {
  value: {
    setRawMode: mockStdinSetRawMode,
    on: mockStdinOn,
    pause: jest.fn(),
    removeListener: mockStdinRemoveListener,
    resume: jest.fn(),
  },
  writable: true,
  configurable: true,
})

// ── Imports after mocks ───────────────────────────────────────────────────────

import { TaskList } from './TaskList'
import { runAutoFix } from '../autofix'
import { execPromise } from '../utils/execPromise'

const mockRunAutoFix = runAutoFix as jest.Mock
const mockExecPromise = execPromise as jest.Mock

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeItem = (overrides?: Partial<ReviewFeedbackItem>): ReviewFeedbackItem => ({
  title: 'Test issue',
  summary: 'Something is wrong',
  severity: 5,
  category: 'bug',
  filePath: 'src/foo.ts',
  ...overrides,
})

/** Fire a keypress and flush microtasks */
const press = async (key: string) => {
  for (let i = 0; i < 10 && !keypressHandler; i++) {
    await Promise.resolve()
  }
  keypressHandler?.('', { name: key })
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  keypressHandler = null
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'clear').mockImplementation(() => undefined)
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: (...args: unknown[]) => void) => {
    fn()
    return 0 as unknown as NodeJS.Timeout
  }) as typeof setTimeout)
  mockStdinOn.mockImplementation((event: string, handler: (ch: string, key: { name: string }) => void) => {
    if (event === 'keypress') keypressHandler = handler
  })
  mockStdinRemoveListener.mockImplementation(
    (event: string, handler: (ch: string, key: { name: string }) => void) => {
      if (event === 'keypress' && keypressHandler === handler) keypressHandler = null
    }
  )
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TaskList — getChoices()', () => {
  it('includes autofix choice label containing 🤖 Auto-fix', async () => {
    const tl = new TaskList([makeItem()])
    const startPromise = tl.start()
    await press('q')
    await startPromise.catch(() => undefined)

    const logCalls = (console.log as jest.Mock).mock.calls.flat()
    const hasAutofix = logCalls.some(
      (arg) => typeof arg === 'string' && arg.includes('🤖 Auto-fix')
    )
    expect(hasAutofix).toBe(true)
  })
})

describe('TaskList — keyboard shortcut "a"', () => {
  it('triggers autofix when key "a" is pressed', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockResolvedValue(undefined)

    const tl = new TaskList([makeItem()], config)
    const startPromise = tl.start()

    await press('a') // triggers autofix → markAsComplete → all done → exits
    await startPromise.catch(() => undefined)

    expect(mockRunAutoFix).toHaveBeenCalledTimes(1)
  })
})

describe('TaskList — keyboard shortcuts', () => {
  it('opens the current file when key "o" is pressed', async () => {
    mockExecPromise.mockResolvedValue(undefined)
    const expectedEditor = process.env.EDITOR || 'code'

    const tl = new TaskList([makeItem({ filePath: 'src/open-me.ts' })])
    const startPromise = tl.start()

    await press('o')
    await press('q')
    await startPromise.catch(() => undefined)

    expect(mockExecPromise).toHaveBeenCalledWith(`${expectedEditor} src/open-me.ts`)
  })

  it.each([
    ['d', 'completed: 1'],
    ['s', 'skipped: 1'],
    ['x', 'omitted: 1'],
  ])('updates summary counts when key "%s" is pressed', async (key, expectedStatusCount) => {
    const tl = new TaskList([makeItem({ title: 'Item 1' }), makeItem({ title: 'Item 2' })])
    const startPromise = tl.start()

    await press(key)
    await press('q')
    await startPromise.catch(() => undefined)

    const logCalls = (console.log as jest.Mock).mock.calls.flat()
    const found = logCalls.some((arg) => typeof arg === 'string' && arg.includes(expectedStatusCount))
    expect(found).toBe(true)
  })

  it('moves to the next item when the right arrow key is pressed', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockResolvedValue(undefined)

    const tl = new TaskList([makeItem({ title: 'Item 1' }), makeItem({ title: 'Item 2' })], config)
    const startPromise = tl.start()

    await press('right')
    await press('a')
    await press('q')
    await startPromise.catch(() => undefined)

    expect(mockRunAutoFix).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Item 2' }),
      config
    )
  })

  it('moves to the previous item when the left arrow key is pressed', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockResolvedValue(undefined)

    const tl = new TaskList([makeItem({ title: 'Item 1' }), makeItem({ title: 'Item 2' })], config)
    const startPromise = tl.start()

    await press('right')
    await press('left')
    await press('a')
    await press('q')
    await startPromise.catch(() => undefined)

    expect(mockRunAutoFix).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Item 1' }),
      config
    )
  })

  it('ignores unknown keys until a supported action is pressed', async () => {
    const tl = new TaskList([makeItem()])
    const startPromise = tl.start()

    await press('enter')
    await press('q')
    await startPromise.catch(() => undefined)

    expect(mockRunAutoFix).not.toHaveBeenCalled()
    expect(mockExecPromise).not.toHaveBeenCalled()
    expect(mockRlClose).toHaveBeenCalledTimes(1)
  })
})

describe('TaskList — autoFix() when autoFixTool is not configured', () => {
  it('displays a message and does not call runAutoFix', async () => {
    const tl = new TaskList([makeItem()]) // no config
    const startPromise = tl.start()

    await press('a') // autofix with no tool configured
    await press('q') // exit
    await startPromise.catch(() => undefined)

    expect(mockRunAutoFix).not.toHaveBeenCalled()
    const logCalls = (console.log as jest.Mock).mock.calls.flat()
    const hasMsg = logCalls.some(
      (arg) => typeof arg === 'string' && arg.includes('No autoFixTool configured')
    )
    expect(hasMsg).toBe(true)
  })
})

describe('TaskList — autoFix() on successful runAutoFix', () => {
  it('calls runAutoFix with the current item and config', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex', autoFixToolOptions: { model: 'o4-mini' } }
    mockRunAutoFix.mockResolvedValue(undefined)

    const item = makeItem({ title: 'Fix me' })
    const tl = new TaskList([item], config)
    const startPromise = tl.start()

    await press('a')
    await startPromise.catch(() => undefined)

    expect(mockRunAutoFix).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fix me' }),
      config
    )
  })

  it('marks item completed and advances after successful runAutoFix', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockResolvedValue(undefined)

    const items = [makeItem({ title: 'Item 1' }), makeItem({ title: 'Item 2' })]
    const tl = new TaskList(items, config)
    const startPromise = tl.start()

    await press('a') // fix item 1 → advances to item 2
    await press('q') // exit from item 2
    await startPromise.catch(() => undefined)

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

    const tl = new TaskList([makeItem()], config)
    const startPromise = tl.start()

    await press('a') // throws
    await press('q') // exit
    await startPromise.catch(() => undefined)

    const logCalls = (console.log as jest.Mock).mock.calls.flat()
    const hasErrorMsg = logCalls.some(
      (arg) => typeof arg === 'string' && arg.includes('Auto-fix failed: codex exited with code 1')
    )
    expect(hasErrorMsg).toBe(true)
  })

  it('does not change item status when runAutoFix throws', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }
    mockRunAutoFix.mockRejectedValue(new Error('binary not found'))

    const items = [makeItem({ title: 'Item 1' }), makeItem({ title: 'Item 2' })]
    const tl = new TaskList(items, config)
    const startPromise = tl.start()

    await press('a') // throws — stays on item 1
    await press('a') // throws again — still item 1
    await press('q') // exit
    await startPromise.catch(() => undefined)

    expect(mockRunAutoFix).toHaveBeenCalledTimes(2)
    expect(mockRunAutoFix).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: 'Item 1' }), config)
    expect(mockRunAutoFix).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'Item 1' }), config)
  })
})
