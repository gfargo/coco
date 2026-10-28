import { abortOperation } from './operationActions'
import { addOrEditCommitNote } from './notesActions'
import { addRemote } from './remoteActions'
import { checkoutReflogEntry } from './reflogActions'
import { initSubmodule } from './submoduleActions'
import { rebaseOnto } from './rebaseActions'
import { removeWorktree } from './worktreeActions'
import { setStackParent } from './stackActions'

// #2201 — every action module's runAction retries a transient lock
// collision (the user's own git in another terminal, a refresh) instead of
// surfacing it. One representative action per module; the fake git fails
// the targeted command once with the wording real git uses, then succeeds.
const INDEX_LOCK = "fatal: Unable to create '/repo/.git/index.lock': File exists."
const CONFIG_LOCK = 'error: could not lock config file .git/config: File exists'

function lockingGit(verb: string, message: string) {
  let failed = false
  const raw = jest.fn(async (args: string[]) => {
    if (args[0] === verb && !failed) {
      failed = true
      throw new Error(message)
    }
    return ''
  })
  // Pre-checks (in-progress operation guards) read git paths via revparse.
  const revparse = jest.fn(async () => '/tmp/coco-missing-git-state')
  return { git: { raw, revparse } as never, raw }
}

type Case = [name: string, verb: string, message: string, run: (git: never) => Promise<{ ok: boolean }>]

const CASES: Case[] = [
  ['rebaseActions', 'rebase', INDEX_LOCK, (git) => rebaseOnto(git, 'main')],
  ['remoteActions', 'remote', CONFIG_LOCK, (git) => addRemote(git, 'upstream', 'https://example.com/r.git')],
  ['submoduleActions', 'submodule', INDEX_LOCK, (git) => initSubmodule(git, { name: 'dep', path: 'libs/dep' } as never)],
  ['reflogActions', 'checkout', INDEX_LOCK, (git) => checkoutReflogEntry(git, { hash: 'abc1234', selector: 'HEAD@{1}' } as never)],
  ['worktreeActions', 'worktree', INDEX_LOCK, (git) => removeWorktree(git, { path: '/tmp/wt', current: false, dirty: false } as never)],
  ['notesActions', 'notes', INDEX_LOCK, (git) => addOrEditCommitNote(git, 'abc1234def', 'a note')],
  ['stackActions', 'config', CONFIG_LOCK, (git) => setStackParent(git, 'feature', 'main')],
  ['operationActions', 'rebase', INDEX_LOCK, (git) => abortOperation(git, 'rebase')],
]

describe('runAction lock retry across the action modules (#2201)', () => {
  it.each(CASES)('%s retries once and succeeds', async (_name, verb, message, run) => {
    const { git, raw } = lockingGit(verb, message)
    const result = await run(git)
    expect(result.ok).toBe(true)
    expect(raw.mock.calls.filter(([args]) => args[0] === verb)).toHaveLength(2)
  })

  it.each(CASES)('%s still reports a lock that never clears', async (_name, verb, message, run) => {
    const raw = jest.fn(async (args: string[]) => {
      if (args[0] === verb) throw new Error(message)
      return ''
    })
    const git = { raw, revparse: jest.fn(async () => '/tmp/coco-missing-git-state') } as never
    const result = await run(git)
    expect(result.ok).toBe(false)
    expect(raw.mock.calls.filter(([args]) => args[0] === verb)).toHaveLength(3) // first try + 2 retries
  })

  it('does not retry an unrelated failure', async () => {
    const raw = jest.fn(async (args: string[]) => {
      if (args[0] === 'remote') throw new Error('fatal: remote upstream already exists.')
      return ''
    })
    const result = await addRemote({ raw } as never, 'upstream', 'https://example.com/r.git')
    expect(result.ok).toBe(false)
    expect(raw.mock.calls.filter(([args]) => args[0] === 'remote')).toHaveLength(1)
  })
})
