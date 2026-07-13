/**
 * Coverage for the submodule/remote workflow handlers extracted out of
 * `useWorkflowAction.ts` (#1636 first domain slice). The git action layer
 * is mocked so each handler resolves without touching a real repo; these
 * tests pin down the guard messages and selection/parsing behavior that
 * was previously only exercised indirectly through the god-hook.
 */
import { createSubmoduleRemoteWorkflowHandlers } from './useSubmoduleRemoteWorkflowActions'
import {
  initSubmodule,
  syncSubmodule,
  updateSubmodule,
} from '../../../git/submoduleActions'
import { addRemote, pruneRemote, removeRemote, setRemoteUrl } from '../../../git/remoteActions'
import type { LogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'
import type { SubmoduleEntry } from '../../../git/submoduleData'
import type { RemoteEntry } from '../../../git/remoteData'

jest.mock('../../../git/submoduleActions', () => ({
  initSubmodule: jest.fn().mockResolvedValue({ ok: true, message: 'submodule initialized' }),
  updateSubmodule: jest.fn().mockResolvedValue({ ok: true, message: 'submodule updated' }),
  syncSubmodule: jest.fn().mockResolvedValue({ ok: true, message: 'submodule synced' }),
}))

jest.mock('../../../git/remoteActions', () => ({
  addRemote: jest.fn().mockResolvedValue({ ok: true, message: 'remote added' }),
  setRemoteUrl: jest.fn().mockResolvedValue({ ok: true, message: 'remote url set' }),
  removeRemote: jest.fn().mockResolvedValue({ ok: true, message: 'remote removed' }),
  pruneRemote: jest.fn().mockResolvedValue({ ok: true, message: 'remote pruned' }),
}))

const initSubmoduleMock = initSubmodule as jest.MockedFunction<typeof initSubmodule>
const updateSubmoduleMock = updateSubmodule as jest.MockedFunction<typeof updateSubmodule>
const syncSubmoduleMock = syncSubmodule as jest.MockedFunction<typeof syncSubmodule>
const addRemoteMock = addRemote as jest.MockedFunction<typeof addRemote>
const setRemoteUrlMock = setRemoteUrl as jest.MockedFunction<typeof setRemoteUrl>
const removeRemoteMock = removeRemote as jest.MockedFunction<typeof removeRemote>
const pruneRemoteMock = pruneRemote as jest.MockedFunction<typeof pruneRemote>

const git = {} as never

const submodule: SubmoduleEntry = {
  name: 'vendor/lib',
  path: 'vendor/lib',
  pinnedSha: 'abc1234',
  flag: 'clean',
} as SubmoduleEntry

const remote: RemoteEntry = {
  name: 'origin',
  fetchUrl: 'git@example.com:acme/repo.git',
  pushUrl: 'git@example.com:acme/repo.git',
}

const stateWithSelection = (): LogInkState =>
  ({
    filter: '',
    selectedSubmoduleId: submodule.path,
    selectedSubmoduleIndex: 0,
    selectedRemoteId: remote.name,
    selectedRemoteIndex: 0,
  }) as unknown as LogInkState

const emptyState = (): LogInkState =>
  ({
    filter: '',
    selectedSubmoduleId: undefined,
    selectedSubmoduleIndex: 0,
    selectedRemoteId: undefined,
    selectedRemoteIndex: 0,
  }) as unknown as LogInkState

const contextWithEntries = (): LogInkContext =>
  ({
    submodules: { entries: [submodule] },
    remotes: { entries: [remote] },
  }) as unknown as LogInkContext

const emptyContext = (): LogInkContext =>
  ({
    submodules: { entries: [] },
    remotes: { entries: [] },
  }) as unknown as LogInkContext

beforeEach(() => {
  jest.clearAllMocks()
})

describe('submodule handlers', () => {
  it('inits, updates, and syncs the selected submodule', async () => {
    const handlers = createSubmoduleRemoteWorkflowHandlers({
      git,
      state: stateWithSelection(),
      context: contextWithEntries(),
    })

    await handlers['submodule-init']()
    expect(initSubmoduleMock).toHaveBeenCalledWith(git, submodule)

    await handlers['submodule-update']()
    expect(updateSubmoduleMock).toHaveBeenCalledWith(git, submodule, { init: true })

    await handlers['submodule-sync']()
    expect(syncSubmoduleMock).toHaveBeenCalledWith(git, submodule)
  })

  it('guards each submodule handler when nothing is selected', async () => {
    const handlers = createSubmoduleRemoteWorkflowHandlers({
      git,
      state: emptyState(),
      context: emptyContext(),
    })

    await expect(handlers['submodule-init']()).resolves.toEqual({
      ok: false,
      message: 'No submodule selected',
    })
    await expect(handlers['submodule-update']()).resolves.toEqual({
      ok: false,
      message: 'No submodule selected',
    })
    await expect(handlers['submodule-sync']()).resolves.toEqual({
      ok: false,
      message: 'No submodule selected',
    })
    expect(initSubmoduleMock).not.toHaveBeenCalled()
    expect(updateSubmoduleMock).not.toHaveBeenCalled()
    expect(syncSubmoduleMock).not.toHaveBeenCalled()
  })
})

describe('remote handlers', () => {
  it('parses the "name url" payload for remote-add', async () => {
    const handlers = createSubmoduleRemoteWorkflowHandlers({
      git,
      state: stateWithSelection(),
      context: contextWithEntries(),
      payload: '  upstream   git@example.com:acme/upstream.git  ',
    })

    await handlers['remote-add']()
    expect(addRemoteMock).toHaveBeenCalledWith(
      git,
      'upstream',
      'git@example.com:acme/upstream.git',
    )
  })

  it('rejects an empty remote-add payload without calling addRemote', async () => {
    const handlers = createSubmoduleRemoteWorkflowHandlers({
      git,
      state: stateWithSelection(),
      context: contextWithEntries(),
      payload: '   ',
    })

    await expect(handlers['remote-add']()).resolves.toEqual({
      ok: false,
      message: 'Remote name and URL required',
    })
    expect(addRemoteMock).not.toHaveBeenCalled()
  })

  it('sets, removes, and prunes the selected remote', async () => {
    const handlers = createSubmoduleRemoteWorkflowHandlers({
      git,
      state: stateWithSelection(),
      context: contextWithEntries(),
      payload: 'git@example.com:acme/repo-new.git',
    })

    await handlers['remote-set-url']()
    expect(setRemoteUrlMock).toHaveBeenCalledWith(
      git,
      remote.name,
      'git@example.com:acme/repo-new.git',
    )

    await handlers['remote-remove']()
    expect(removeRemoteMock).toHaveBeenCalledWith(git, remote.name)

    await handlers['remote-prune']()
    expect(pruneRemoteMock).toHaveBeenCalledWith(git, remote.name)
  })

  it('guards each remote handler when nothing is selected', async () => {
    const handlers = createSubmoduleRemoteWorkflowHandlers({
      git,
      state: emptyState(),
      context: emptyContext(),
    })

    await expect(handlers['remote-set-url']()).resolves.toEqual({
      ok: false,
      message: 'No remote selected',
    })
    await expect(handlers['remote-remove']()).resolves.toEqual({
      ok: false,
      message: 'No remote selected',
    })
    await expect(handlers['remote-prune']()).resolves.toEqual({
      ok: false,
      message: 'No remote selected',
    })
    expect(setRemoteUrlMock).not.toHaveBeenCalled()
    expect(removeRemoteMock).not.toHaveBeenCalled()
    expect(pruneRemoteMock).not.toHaveBeenCalled()
  })
})
