import { createLogInkState, type LogInkState } from '../../runtime/inkViewModel'
import { handleRebaseInput } from './input'

/**
 * Direct coverage for the rebase-plan input handler (#2222), the only extracted
 * surface handler without a test. The plan claims its letters while the view is
 * active, ahead of every other single-letter handler, so the tests pin both
 * what each key does and that nothing leaks past it.
 */
const row = (n: number, over: Record<string, unknown> = {}) => ({
  sha: `${n}`.repeat(40),
  shortSha: `${n}${n}${n}${n}${n}${n}${n}`,
  subject: `commit ${n}`,
  author: 'Coco',
  date: '2026-05-01',
  action: 'pick',
  ...over,
})

function rebaseState(over: Partial<LogInkState> = {}, plan: { rows?: unknown[]; selectedIndex?: number } = {}): LogInkState {
  return {
    ...createLogInkState([]),
    activeView: 'rebase',
    viewStack: ['history', 'rebase'],
    rebasePlan: { rows: [row(1), row(2), row(3)], selectedIndex: 1, ...plan },
    ...over,
  } as unknown as LogInkState
}

const only = (events: ReturnType<typeof handleRebaseInput>) => {
  expect(events).toHaveLength(1)
  expect(events?.[0]).toMatchObject({ type: 'action' })
  return (events?.[0] as { action: unknown }).action
}

const press = (state: LogInkState, input: string, key: Record<string, unknown> = {}) => handleRebaseInput(state, input, key, {})

describe('handleRebaseInput (#2222)', () => {
  describe('when it does not apply', () => {
    it.each(['history', 'branches', 'status', 'diff'] as const)('returns null on the %s view, so the router carries on', (activeView) => {
      expect(press(rebaseState({ activeView }), 'p')).toBeNull()
    })

    it('returns null on the rebase view with no plan loaded yet', () => {
      expect(press(rebaseState({ rebasePlan: undefined }), 'p')).toBeNull()
    })

    it('returns null for a key it does not own', () => {
      for (const input of ['x', 'q', 'g', 'z', '']) expect(press(rebaseState(), input)).toBeNull()
    })
  })

  describe('retagging the cursored commit', () => {
    it.each([
      ['p', 'pick'],
      ['s', 'squash'],
      ['f', 'fixup'],
      ['d', 'drop'],
      ['e', 'edit'],
    ])('%s sets the action to %s', (input, expected) => {
      expect(only(press(rebaseState(), input))).toEqual({ type: 'setRebaseAction', action: expected })
    })
  })

  describe('moving', () => {
    it('j and the down arrow move the cursor down, k and the up arrow up', () => {
      expect(only(press(rebaseState(), 'j'))).toEqual({ type: 'moveRebaseCursor', delta: 1 })
      expect(only(press(rebaseState(), '', { downArrow: true }))).toEqual({ type: 'moveRebaseCursor', delta: 1 })
      expect(only(press(rebaseState(), 'k'))).toEqual({ type: 'moveRebaseCursor', delta: -1 })
      expect(only(press(rebaseState(), '', { upArrow: true }))).toEqual({ type: 'moveRebaseCursor', delta: -1 })
    })

    it('J and K reorder the commit rather than moving the cursor: the capital is a different key', () => {
      expect(only(press(rebaseState(), 'J'))).toEqual({ type: 'moveRebaseRow', delta: 1 })
      expect(only(press(rebaseState(), 'K'))).toEqual({ type: 'moveRebaseRow', delta: -1 })
    })
  })

  describe('rewording', () => {
    it('opens a prompt for the cursored commit, seeded with its subject', () => {
      expect(only(press(rebaseState(), 'r'))).toEqual({
        type: 'openInputPrompt',
        kind: 'rebase-reword',
        label: 'New message for 2222222',
        initial: 'commit 2',
      })
    })

    it('seeds the prompt with the message already typed for that commit, ahead of its subject', () => {
      const state = rebaseState({}, { rows: [row(1), row(2, { newMessage: 'a better subject' })] })
      expect(only(press(state, 'r'))).toMatchObject({ initial: 'a better subject' })
    })

    it('still opens a prompt when the cursor is off the plan, with a generic label and an empty seed', () => {
      for (const plan of [{ rows: [] as unknown[], selectedIndex: 0 }, { selectedIndex: 9 }]) {
        expect(only(press(rebaseState({}, plan), 'r'))).toEqual({
          type: 'openInputPrompt',
          kind: 'rebase-reword',
          label: 'New message for commit',
          initial: '',
        })
      }
    })
  })

  describe('executing and leaving', () => {
    it('Enter asks to confirm before running the plan', () => {
      expect(only(press(rebaseState(), '', { return: true }))).toEqual({ type: 'setPendingConfirmation', value: 'execute-rebase-plan' })
    })

    it('Esc asks to confirm before throwing the plan away, when it would leave the view (#1446)', () => {
      expect(only(press(rebaseState(), '', { escape: true }))).toEqual({ type: 'setPendingConfirmation', value: 'discard-rebase-plan' })
    })

    it('Esc is left to the router when there is nowhere to go back to', () => {
      expect(press(rebaseState({ viewStack: ['rebase'] }), '', { escape: true })).toBeNull()
    })

    it('Esc wins over a letter in the same keypress', () => {
      expect(only(press(rebaseState(), 'p', { escape: true }))).toMatchObject({ type: 'setPendingConfirmation' })
    })
  })
})
