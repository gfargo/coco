import { handleConflictsInput } from './input'
import { createLogInkState } from '../../runtime/inkViewModel'
import type { GitLogRow } from '../../../git/logData'
import type { LogInkConflictProposal } from '../../runtime/conflictResolutionState'

/**
 * Direct coverage for the conflicts-view input handlers extracted out of
 * `inkInput.ts`'s router (#COCO-1064). `inkInput.test.ts` keeps its
 * existing conflicts cases too — those exercise the full
 * `getLogInkInputEvents` router and guard that it actually delegates
 * here at each of the four call sites; these tests pin down the
 * handler's own per-slot logic in isolation.
 */

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
    parents: [],
    date: '2026-04-29',
    author: 'Coco Test',
    refs: [],
    message: 'Initial commit',
  },
]

const conflictsState = () => {
  const state = createLogInkState(rows)
  return { ...state, activeView: 'conflicts' as const }
}

const proposal = (overrides: Partial<LogInkConflictProposal> = {}): LogInkConflictProposal => ({
  regionIndex: 0,
  resolution: 'resolved content',
  rationale: 'because',
  status: 'pending',
  region: {} as LogInkConflictProposal['region'],
  ...overrides,
})

describe('handleConflictsInput', () => {
  it('returns null outside the conflicts view for every slot', () => {
    const state = { ...conflictsState(), activeView: 'history' as const }
    expect(handleConflictsInput(state, 'o', {}, {}, 'row-action')).toBeNull()
    expect(handleConflictsInput(state, 'k', {}, {}, 'move')).toBeNull()
    expect(handleConflictsInput(state, '', { return: true }, {}, 'enter')).toBeNull()
    expect(handleConflictsInput(state, 'y', {}, {}, 'session')).toBeNull()
  })

  describe('session slot', () => {
    it('returns null when there is no active session', () => {
      expect(handleConflictsInput(conflictsState(), 'j', {}, {}, 'session')).toBeNull()
    })

    it('walks proposals with j/k and acts with y/Y/e/n, dismisses with esc', () => {
      const state = {
        ...conflictsState(),
        conflictResolution: {
          path: 'a.txt',
          status: 'ready' as const,
          proposals: [proposal()],
          selectedIndex: 0,
        },
      }

      expect(handleConflictsInput(state, 'j', {}, {}, 'session')).toEqual([
        { type: 'action', action: { type: 'moveConflictProposal', delta: 1 } },
      ])
      expect(handleConflictsInput(state, 'k', {}, {}, 'session')).toEqual([
        { type: 'action', action: { type: 'moveConflictProposal', delta: -1 } },
      ])
      expect(handleConflictsInput(state, 'y', {}, {}, 'session')).toEqual([
        { type: 'acceptConflictProposal' },
      ])
      expect(handleConflictsInput(state, 'Y', {}, {}, 'session')).toEqual([
        { type: 'acceptAllConflictProposals' },
      ])
      expect(handleConflictsInput(state, 'e', {}, {}, 'session')).toEqual([
        { type: 'editConflictProposal' },
      ])
      expect(handleConflictsInput(state, 'n', {}, {}, 'session')).toEqual([
        {
          type: 'action',
          action: { type: 'setConflictProposalStatus', regionIndex: 0, status: 'rejected' },
        },
      ])
      expect(handleConflictsInput(state, '', { escape: true }, {}, 'session')).toEqual([
        { type: 'action', action: { type: 'clearConflictResolution' } },
        {
          type: 'action',
          action: { type: 'setStatus', value: 'Proposals dismissed — file untouched.' },
        },
      ])
    })

    it('yields to global shortcuts on y/Y/e with ctrl or meta held', () => {
      const state = {
        ...conflictsState(),
        conflictResolution: {
          path: 'a.txt',
          status: 'ready' as const,
          proposals: [proposal()],
          selectedIndex: 0,
        },
      }
      expect(handleConflictsInput(state, 'y', { ctrl: true }, {}, 'session')).toBeNull()
      expect(handleConflictsInput(state, 'y', { meta: true }, {}, 'session')).toBeNull()
    })

    it('no-ops on n when the cursored proposal is not pending', () => {
      const state = {
        ...conflictsState(),
        conflictResolution: {
          path: 'a.txt',
          status: 'ready' as const,
          proposals: [proposal({ status: 'accepted' })],
          selectedIndex: 0,
        },
      }
      expect(handleConflictsInput(state, 'n', {}, {}, 'session')).toEqual([])
    })

    it('clears the session on esc from the error state', () => {
      const state = {
        ...conflictsState(),
        conflictResolution: {
          path: 'a.txt',
          status: 'error' as const,
          error: 'boom',
          proposals: [],
          selectedIndex: 0,
        },
      }
      expect(handleConflictsInput(state, '', { escape: true }, {}, 'session')).toEqual([
        { type: 'action', action: { type: 'clearConflictResolution' } },
      ])
    })
  })

  describe('move slot', () => {
    it('moves the conflict file cursor with up/k and down/j, no-ops without a file count', () => {
      const state = conflictsState()
      expect(handleConflictsInput(state, 'k', { upArrow: true }, { conflictFileCount: 3 }, 'move')).toEqual([
        { type: 'action', action: { type: 'moveConflictFile', delta: -1, count: 3 } },
      ])
      expect(handleConflictsInput(state, 'j', { downArrow: true }, { conflictFileCount: 3 }, 'move')).toEqual([
        { type: 'action', action: { type: 'moveConflictFile', delta: 1, count: 3 } },
      ])
      expect(handleConflictsInput(state, 'k', { upArrow: true }, {}, 'move')).toBeNull()
    })
  })

  describe('enter slot', () => {
    it('opens the diff for the selected conflict file', () => {
      const events = handleConflictsInput(
        conflictsState(),
        '',
        { return: true },
        { conflictFileCount: 1, conflictSelectedPath: 'a.txt' },
        'enter'
      )
      expect(events).toEqual([
        { type: 'runWorkflowAction', id: 'resolve-conflict-open-diff', payload: 'a.txt' },
      ])
    })

    it('no-ops without a selected path or file count', () => {
      expect(
        handleConflictsInput(conflictsState(), '', { return: true }, { conflictFileCount: 1 }, 'enter')
      ).toBeNull()
    })
  })

  describe('row-action slot', () => {
    const context = { conflictFileCount: 1, conflictSelectedPath: 'a.txt' }

    it('opens $EDITOR on o', () => {
      expect(handleConflictsInput(conflictsState(), 'o', {}, context, 'row-action')).toEqual([
        { type: 'openFileInEditor', path: 'a.txt' },
      ])
    })

    it('stages on s, keeps theirs on u, keeps ours on U', () => {
      expect(handleConflictsInput(conflictsState(), 's', {}, context, 'row-action')).toEqual([
        { type: 'runWorkflowAction', id: 'resolve-conflict-stage', payload: 'a.txt' },
      ])
      expect(handleConflictsInput(conflictsState(), 'u', {}, context, 'row-action')).toEqual([
        { type: 'runWorkflowAction', id: 'resolve-conflict-theirs', payload: 'a.txt' },
      ])
      expect(handleConflictsInput(conflictsState(), 'U', {}, context, 'row-action')).toEqual([
        { type: 'runWorkflowAction', id: 'resolve-conflict-ours', payload: 'a.txt' },
      ])
    })

    it('continues the operation on C once no conflicts remain', () => {
      expect(
        handleConflictsInput(conflictsState(), 'C', {}, { conflictFileCount: 0 }, 'row-action')
      ).toEqual([{ type: 'runWorkflowAction', id: 'continue-operation' }])
    })

    it('intercepts C with a warning while conflicts remain', () => {
      expect(handleConflictsInput(conflictsState(), 'C', {}, context, 'row-action')).toEqual([
        {
          type: 'action',
          action: { type: 'setStatus', value: 'Resolve all conflicts before continuing', kind: 'warning' },
        },
      ])
    })

    it('returns null for an unmatched key', () => {
      expect(handleConflictsInput(conflictsState(), 'q', {}, context, 'row-action')).toBeNull()
    })
  })
})
