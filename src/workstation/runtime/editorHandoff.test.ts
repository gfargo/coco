/**
 * #1871 — keystrokes typed while a non-terminal editor (`code -w`) is open
 * used to be delivered to the workstation as commands once the spawn
 * returned. A real `PassThrough` stands in for the TTY so `'readable'` and
 * `read()` behave as Node's streams do, which Ink's input relies on.
 */
import { PassThrough } from 'node:stream'
import { EDITOR_HANDOFF_FLUSH_MS, runWithTerminalHandedOff } from './editorHandoff'

class FakeTty extends PassThrough {
  rawModeCalls: boolean[] = []
  setRawMode(value: boolean): this {
    this.rawModeCalls.push(value)
    return this
  }
}

function setup() {
  const tty = new FakeTty()
  tty.setEncoding('utf8')
  const received: string[] = []
  // Ink-style reader: a 'readable' listener draining stdin.read().
  const inkListener = () => {
    let chunk
    while ((chunk = tty.read()) !== null) received.push(chunk as string)
  }
  tty.on('readable', inkListener)
  const writes: string[] = []
  const out = { write: (data: string) => { writes.push(data); return true } }
  const io = { stdin: tty as unknown as NodeJS.ReadStream, out }
  return { tty, received, writes, io, inkListener }
}

/** Let queued stream events run (fake timers are on, so no real waiting). */
async function tick(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => process.nextTick(resolve))
}

describe('runWithTerminalHandedOff', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick'] }))
  afterEach(() => jest.useRealTimers())

  it('drops keystrokes typed while the editor was open, then delivers later ones', async () => {
    const { tty, received, io } = setup()

    runWithTerminalHandedOff(io, () => {
      // The editor does not read the terminal; the user types anyway.
      tty.write('xyz')
      tty.write('q\n')
    })
    await tick()
    jest.advanceTimersByTime(EDITOR_HANDOFF_FLUSH_MS + 1)
    await tick()

    expect(received).toEqual([])

    tty.write('j')
    await tick()
    expect(received).toEqual(['j'])
  })

  it('detaches the readable listeners while the editor runs and restores the same ones', async () => {
    const { tty, io, inkListener } = setup()
    let duringRun = -1

    runWithTerminalHandedOff(io, () => {
      duringRun = tty.listenerCount('readable')
    })
    expect(duringRun).toBe(0)

    jest.advanceTimersByTime(EDITOR_HANDOFF_FLUSH_MS + 1)
    expect(tty.listeners('readable')).toEqual([inkListener])
  })

  it('toggles raw mode off then on and brackets the run with the alt-screen escapes', () => {
    const { tty, writes, io } = setup()

    runWithTerminalHandedOff(io, () => writes.push('<editor>'))

    expect(tty.rawModeCalls).toEqual([false, true])
    expect(writes).toEqual(['\x1b[?25h\x1b[?1049l', '<editor>', '\x1b[?1049h\x1b[?25l'])
  })

  it('returns the editor result', () => {
    const { io } = setup()
    expect(runWithTerminalHandedOff(io, () => 42)).toBe(42)
  })

  it('gives the terminal back and restores the listeners even if the spawn throws', () => {
    const { tty, writes, io, inkListener } = setup()

    expect(() =>
      runWithTerminalHandedOff(io, () => {
        throw new Error('spawn failed')
      })
    ).toThrow('spawn failed')

    expect(tty.rawModeCalls).toEqual([false, true])
    expect(writes[writes.length - 1]).toBe('\x1b[?1049h\x1b[?25l')
    jest.advanceTimersByTime(EDITOR_HANDOFF_FLUSH_MS + 1)
    expect(tty.listeners('readable')).toEqual([inkListener])
  })

  it('works on a stdin without setRawMode (piped input)', () => {
    const { tty, io } = setup()
    const piped = { ...io, stdin: Object.assign(tty, { setRawMode: undefined }) as unknown as NodeJS.ReadStream }
    expect(() => runWithTerminalHandedOff(piped, () => undefined)).not.toThrow()
  })
})
