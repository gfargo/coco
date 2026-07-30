import {
  MAX_UNDO_STACK_SIZE,
  findMostRecentUndoEntry,
  performUndo,
  popUndoEntry,
  pushUndoEntry,
  removeUndoEntry,
  type UndoEntry,
} from './undoStack'

function branchEntry(overrides: Partial<Extract<UndoEntry, { kind: 'delete-branch' }>> = {}): UndoEntry {
  return {
    kind: 'delete-branch',
    label: 'delete branch feature/test',
    depth: 0,
    name: 'feature/test',
    sha: 'abc1234',
    ...overrides,
  }
}

describe('undo stack (OSS-1606)', () => {
  describe('pushUndoEntry / popUndoEntry', () => {
    it('pushes onto the end and pops the most recently pushed entry (LIFO)', () => {
      let stack: UndoEntry[] = []
      stack = pushUndoEntry(stack, branchEntry({ name: 'a' }))
      stack = pushUndoEntry(stack, branchEntry({ name: 'b' }))

      const { entry, stack: popped } = popUndoEntry(stack)
      expect(entry).toEqual(branchEntry({ name: 'b' }))
      expect(popped).toEqual([branchEntry({ name: 'a' })])
    })

    it('pop on an empty stack is a no-op tuple', () => {
      const { entry, stack } = popUndoEntry([])
      expect(entry).toBeUndefined()
      expect(stack).toEqual([])
    })

    it('drops the oldest entry once the stack exceeds MAX_UNDO_STACK_SIZE', () => {
      let stack: UndoEntry[] = []
      for (let i = 0; i < MAX_UNDO_STACK_SIZE + 5; i += 1) {
        stack = pushUndoEntry(stack, branchEntry({ name: `branch-${i}` }))
      }

      expect(stack).toHaveLength(MAX_UNDO_STACK_SIZE)
      // The oldest 5 entries (0-4) were evicted; the stack starts at 5.
      expect(stack[0]).toEqual(branchEntry({ name: 'branch-5' }))
      expect(stack[stack.length - 1]).toEqual(
        branchEntry({ name: `branch-${MAX_UNDO_STACK_SIZE + 4}` })
      )
    })
  })

  describe('removeUndoEntry', () => {
    it('removes a specific entry by identity, even when it is not on top of the stack', () => {
      const bottom = branchEntry({ name: 'bottom' })
      const middle = branchEntry({ name: 'middle' })
      const top = branchEntry({ name: 'top' })
      const stack = [bottom, middle, top]

      expect(removeUndoEntry(stack, middle)).toEqual([bottom, top])
    })

    it('is a no-op when the entry is not present', () => {
      const stack = [branchEntry({ name: 'a' })]
      expect(removeUndoEntry(stack, branchEntry({ name: 'b' }))).toEqual(stack)
    })
  })

  describe('findMostRecentUndoEntry', () => {
    it('finds the most recently pushed entry of a given kind, ignoring other kinds pushed after it', () => {
      const drop = { kind: 'drop-stash' as const, label: 'drop stash@{0}', depth: 0, hash: 'deadbeef', message: 'WIP' }
      const stack: UndoEntry[] = [drop, branchEntry({ name: 'a' })]

      expect(findMostRecentUndoEntry(stack, 'drop-stash')).toEqual(drop)
    })

    it('returns undefined when no entry of that kind is on the stack', () => {
      expect(findMostRecentUndoEntry([branchEntry()], 'drop-stash')).toBeUndefined()
    })
  })

  describe('performUndo', () => {
    it('recreates a deleted branch at its recorded sha', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const result = await performUndo(git as never, branchEntry())
      expect(result).toEqual({ ok: true, message: 'Restored branch feature/test' })
      expect(git.raw).toHaveBeenCalledWith(['branch', 'feature/test', 'abc1234'])
    })

    it('restores a dropped stash by its recorded hash', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const entry: UndoEntry = {
        kind: 'drop-stash',
        label: 'drop stash@{0}',
        depth: 0,
        hash: 'deadbeef',
        message: 'WIP on main',
      }
      const result = await performUndo(git as never, entry)
      expect(result).toEqual({ ok: true, message: 'Restored dropped stash' })
      expect(git.raw).toHaveBeenCalledWith(['stash', 'store', '-m', 'WIP on main', 'deadbeef'])
    })

    it('resets --hard back to the recorded previous HEAD when the original reset was --hard', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }
      const entry: UndoEntry = {
        kind: 'reset-to-commit',
        label: 'reset --hard to abc1234',
        depth: 0,
        previousSha: 'deadbeef1234',
        mode: 'hard',
      }
      const result = await performUndo(git as never, entry)
      expect(result).toEqual({ ok: true, message: 'Restored HEAD to deadbee' })
      expect(git.raw).toHaveBeenCalledWith(['reset', '--hard', 'deadbeef1234'])
    })

    it('mirrors a --soft/--mixed original reset instead of forcing --hard', async () => {
      const git = {
        revparse: jest.fn().mockResolvedValue('/tmp/coco-missing-git-state'),
        raw: jest.fn().mockResolvedValue(''),
      }
      const entry: UndoEntry = {
        kind: 'reset-to-commit',
        label: 'reset --soft to abc1234',
        depth: 0,
        previousSha: 'deadbeef1234',
        mode: 'soft',
      }
      const result = await performUndo(git as never, entry)
      expect(result).toEqual({ ok: true, message: 'Restored HEAD to deadbee' })
      expect(git.raw).toHaveBeenCalledWith(['reset', '--soft', 'deadbeef1234'])
    })

    it('recreates a deleted tag at its recorded sha', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const entry: UndoEntry = {
        kind: 'delete-tag',
        label: 'delete tag v1.0.0',
        depth: 0,
        name: 'v1.0.0',
        sha: 'abc1234',
      }
      const result = await performUndo(git as never, entry)
      expect(result).toEqual({ ok: true, message: 'Restored tag v1.0.0' })
      expect(git.raw).toHaveBeenCalledWith(['tag', 'v1.0.0', 'abc1234'])
    })
  })
})
