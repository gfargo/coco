import { LOG_INK_KEY_BINDINGS, getLogInkPaletteCommands } from './inkKeymap'
import { getLogInkInputEvents, getLogInkPaletteExecuteEvents, type LogInkInputEvent } from './inkInput'
import { applyLogInkAction, createLogInkState, type LogInkView } from './inkViewModel'

/**
 * #2220: the palette executor is a second switch next to the keyboard router,
 * and nothing kept them agreeing. 29 binding entries ran nothing at all, with
 * no message. These tests pin the contract between the two.
 */

const row = {
  type: 'commit', graph: '*', shortHash: 'abc1234', hash: 'abc123456789',
  parents: [], date: '2026-04-29', author: 'A', refs: [], message: 'm',
} as never

const NON_VIEW_CONTEXTS = new Set(['normal', 'search', 'commits', 'sidebar', 'detail', 'main'])
const views = [...new Set(LOG_INK_KEY_BINDINGS.flatMap((binding) => binding.contexts as string[]))]
  .filter((context) => !NON_VIEW_CONTEXTS.has(context)) as LogInkView[]

// Entries where doing nothing is correct: the palette is already open.
const INTENTIONALLY_EMPTY = new Set(['commandPalette'])

const run = (command: Parameters<typeof getLogInkPaletteExecuteEvents>[0]) =>
  getLogInkPaletteExecuteEvents(command, createLogInkState([row]), {})

describe('palette executor (#2220)', () => {
  it('has views to check (guards the loops below against matching nothing)', () => {
    expect(views.length).toBeGreaterThan(10)
  })

  it('never silently does nothing: every palette entry in every view emits at least one event', () => {
    const silent = new Map<string, Set<string>>()
    for (const view of [undefined, ...views]) {
      for (const command of getLogInkPaletteCommands(view)) {
        if (INTENTIONALLY_EMPTY.has(command.id)) continue
        if (run(command).length === 0) {
          silent.set(`${command.kind}:${command.id}`, (silent.get(`${command.kind}:${command.id}`) ?? new Set()).add(view ?? '(any)'))
        }
      }
    }
    expect([...silent.keys()]).toEqual([])
  })

  it('keeps the intentionally-empty list honest: real entries that really emit nothing', () => {
    for (const id of INTENTIONALLY_EMPTY) {
      const command = getLogInkPaletteCommands().find((entry) => entry.id === id)
      expect(command).toBeDefined()
      expect(run(command!)).toEqual([])
    }
  })

  describe('entries that can only run from their own key', () => {
    const statusOf = (id: string, view?: LogInkView) => {
      const command = getLogInkPaletteCommands(view).find((entry) => entry.id === id && entry.kind === 'binding')
      expect(command).toBeDefined()
      const [event] = run(command!)
      expect(event).toMatchObject({ type: 'action', action: { type: 'setStatus', kind: 'warning' } })
      return (event as { action: { value: string } }).action.value
    }

    it('says which key to press, and where when the entry belongs to one view', () => {
      expect(statusOf('workflowUndoLastAction')).toBe('undo needs its own key: press gu.')
      expect(statusOf('navigateBlame')).toBe('blame needs its own key: press b.')
      expect(statusOf('workflowBisectReset')).toBe('reset bisect needs its own key: press x in the bisect view.')
      expect(statusOf('viewSyncBranch')).toBe('sync needs its own key: press S in the branches view.')
    })

    it('makes no claim about what the entry acts on, since that varies (undo is global, sync takes the cursored branch)', () => {
      expect(statusOf('workflowUndoLastAction')).not.toMatch(/cursor/i)
    })
  })

  // The keyboard is the reference. For the `g` chords both paths are plain
  // navigation with no cursor context, so they must produce the same event.
  // The router also resets the pending chord key, which the palette (not in a
  // chord) has no reason to emit, so that bookkeeping is dropped before comparing.
  describe('agrees with the keyboard on the g-chord navigation entries', () => {
    const withoutChordReset = (events: LogInkInputEvent[]) =>
      events.filter((event) => !(event.type === 'action' && event.action.type === 'setPendingKey'))

    const chordBindings = LOG_INK_KEY_BINDINGS.filter((binding) => /^g[a-zA-Z]$/.test(binding.keys[0]) && binding.id.startsWith('navigate'))

    it('finds the chord bindings', () => {
      expect(chordBindings.length).toBeGreaterThan(10)
    })

    it.each(chordBindings.map((binding) => [binding.id, binding.keys[0]] as const))('%s (%s)', (id, keys) => {
      const command = getLogInkPaletteCommands('history').find((entry) => entry.id === id && entry.kind === 'binding')
      expect(command).toBeDefined()

      let state = createLogInkState([row])
      state = applyLogInkAction(state, { type: 'setPendingKey', value: 'g' })
      const viaKeyboard = withoutChordReset(getLogInkInputEvents(state, keys[1], {}, {}))
      const viaPalette = withoutChordReset(run(command!))

      expect(viaPalette).toEqual(viaKeyboard)
    })
  })
})
