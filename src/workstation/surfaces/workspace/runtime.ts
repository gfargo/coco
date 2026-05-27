/**
 * Workspace surface runtime (#880). Mounts a standalone Ink app for
 * the multi-repo workspace view. Independent of the existing log/ui
 * runtime so it can render before any repository is chosen.
 *
 * Boot sequence:
 *   1. Read disk cache and paint cached rows immediately.
 *   2. Mount Ink with the cached state (or an empty scan).
 *   3. Run discovery + per-repo summary in the background; dispatch
 *      `replace-overview` when fresh data lands.
 *   4. Fire `gh` PR-count fetch in parallel; dispatch when ready.
 *
 * Drill-in and add-repo intents fire callbacks the caller wired in;
 * the runtime doesn't know how those flows unfold (PR3 + PR4 own
 * them). For PR2 those callbacks are `undefined` and the intents
 * just show a footer hint.
 */

import type * as ReactTypes from 'react'

import {
  getWorkspaceOverview,
  type WorkspaceOverview,
  type WorkspaceRepoSummary,
} from '../../../git/workspaceData'
import {
  getWorkspacePullRequestCounts,
  type WorkspacePullRequestCounts,
} from '../../../git/workspacePullRequestData'
import {
  canStartLogInkTui,
  getLogInkRenderOptions,
} from '../../chrome/terminal'
import {
  createLogInkTheme,
  type LogInkTheme,
  type LogInkThemeConfig,
} from '../../chrome/theme'
import {
  readCachedWorkspace,
  writeCachedWorkspace,
} from '../../chrome/workspaceCache'
import { installTerminalLifecycle } from '../../chrome/terminalLifecycle'

import { renderWorkspaceApp } from './view'
import {
  applyWorkspaceAction,
  createWorkspaceState,
  selectFocusedRepo,
  type WorkspaceAction,
  type WorkspaceState,
} from './state'
import { resolveWorkspaceInput, type WorkspaceInputKey } from './input'
import {
  applyTabCompletion,
  completePath,
  expandHomePrefix,
  type PathCompletionResult,
} from './pathCompletion'
import {
  appendKnownRepo,
  readKnownRepos,
  removeKnownRepo,
} from '../../chrome/workspaceKnownRepos'
import {
  hasSeenWorkspaceOnboarding,
  markWorkspaceOnboardingSeen,
} from '../../chrome/workspaceOnboarding'
import {
  readWorkspacePreferences,
  writeWorkspacePreferences,
} from '../../chrome/workspacePreferences'
import { isGitWorkingTree } from '../../../git/workspaceData'

type DynamicImport = <T>(specifier: string) => Promise<T>
const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

export type WorkspaceInkRuntime = {
  ink: {
    Box: ReactTypes.ComponentType<Record<string, unknown>>
    Text: ReactTypes.ComponentType<Record<string, unknown>>
    render: (
      app: ReactTypes.ReactElement,
      options: {
        alternateScreen?: boolean
        exitOnCtrlC?: boolean
        patchConsole?: boolean
        stderr?: NodeJS.WriteStream
        stdin?: NodeJS.ReadStream
        stdout?: NodeJS.WriteStream
      }
    ) => {
      waitUntilExit: () => Promise<void>
      unmount: () => void
    }
    useApp: () => { exit: () => void }
    useInput: (handler: (input: string, key: WorkspaceInputKey) => void) => void
    useWindowSize: () => { columns: number; rows: number }
  }
  React: typeof ReactTypes
}

export type WorkspaceComponents = Pick<WorkspaceInkRuntime['ink'], 'Box' | 'Text'>

async function loadWorkspaceInkRuntime(): Promise<WorkspaceInkRuntime> {
  const [ink, React] = await Promise.all([
    dynamicImport<WorkspaceInkRuntime['ink']>('ink'),
    dynamicImport<typeof ReactTypes>('react'),
  ])
  return { ink, React }
}

export type WorkspaceExitResult =
  | { kind: 'quit' }
  | {
      kind: 'drill-in'
      repo: WorkspaceRepoSummary
      /** Last-rendered surface state — passed back when the caller relaunches workspace after the drill-in. */
      resume: {
        sortMode: WorkspaceState['sortMode']
        tab: WorkspaceState['tab']
        filter: WorkspaceState['filter']
        selectedRepoPath: string
      }
    }

export type WorkspaceResumeState = {
  sortMode?: WorkspaceState['sortMode']
  tab?: WorkspaceState['tab']
  filter?: WorkspaceState['filter']
  selectedRepoPath?: string
}

export type WorkspaceStartOptions = {
  roots: ReadonlyArray<string>
  knownRepos?: ReadonlyArray<string>
  maxDepth?: number
  appLabel?: string
  theme?: LogInkThemeConfig
  /**
   * Optional resume seed — applied to the new state on mount.
   * Lets the drill-in loop re-anchor the cursor on the repo the
   * user just exited and preserve their sort / tab / filter.
   */
  resume?: WorkspaceResumeState
  /**
   * Test/PR4 seam: invoked when the user presses `a`. PR4 fills this
   * in with the fuzzy path prompt.
   */
  onAddRepo?: () => Promise<string | undefined>
  /** Override discovery (used by tests). */
  loadOverview?: (
    roots: ReadonlyArray<string>,
    knownRepos: ReadonlyArray<string>
  ) => Promise<WorkspaceOverview>
  /** Override gh PR-count fetch (used by tests + when caller already has data). */
  loadPullRequestCounts?: (
    repos: ReadonlyArray<WorkspaceRepoSummary>
  ) => Promise<WorkspacePullRequestCounts>
  streams?: {
    input?: NodeJS.ReadStream
    output?: NodeJS.WriteStream
    error?: NodeJS.WriteStream
  }
}

const EMPTY_OVERVIEW = (roots: ReadonlyArray<string>): WorkspaceOverview => ({
  roots: [...roots],
  repos: [],
  scannedAt: new Date(0).toISOString(),
})

export function mergeKnownRepos(
  configEntries: ReadonlyArray<string>,
  cachedEntries: ReadonlyArray<string>
): string[] {
  return [...new Set([...configEntries, ...cachedEntries])]
}

export async function startWorkspace(
  options: WorkspaceStartOptions
): Promise<WorkspaceExitResult> {
  installWorkspaceDebugHandlers()
  workspaceDebug(`startWorkspace called roots=${options.roots.join(',')} hasResume=${Boolean(options.resume)}`)
  const streams = options.streams ?? {}
  const input = streams.input ?? process.stdin
  const output = streams.output ?? process.stdout
  const error = streams.error ?? process.stderr
  const knownRepos = mergeKnownRepos(options.knownRepos ?? [], readKnownRepos())

  const loadOverview =
    options.loadOverview ??
    ((roots: ReadonlyArray<string>, repos: ReadonlyArray<string>) =>
      getWorkspaceOverview(roots, { knownRepos: repos, maxDepth: options.maxDepth }))

  const loadPullRequestCounts =
    options.loadPullRequestCounts ??
    ((repos: ReadonlyArray<WorkspaceRepoSummary>) =>
      getWorkspacePullRequestCounts(repos.map((entry) => entry.path)))

  const cached = readCachedWorkspace(options.roots) ?? EMPTY_OVERVIEW(options.roots)
  const persisted = readWorkspacePreferences(options.roots)
  // Resume (post-drill-in) takes precedence over the persisted store —
  // mid-session intent shouldn't lose to last-launch defaults.
  const effectiveResume: WorkspaceResumeState = {
    sortMode: options.resume?.sortMode ?? persisted.sortMode,
    tab: options.resume?.tab ?? persisted.tab,
    filter: options.resume?.filter ?? persisted.filter,
    selectedRepoPath: options.resume?.selectedRepoPath,
  }

  if (!canStartLogInkTui(input, output)) {
    // Non-TTY snapshot fallback. Print the visible repo list and
    // exit. Keeps `coco workspace` usable from a pipe / CI.
    const fresh = await loadOverview(options.roots, knownRepos)
    writeCachedWorkspace(options.roots, fresh)
    renderWorkspaceSnapshot(fresh, output)
    return { kind: 'quit' }
  }

  const runtime = await loadWorkspaceInkRuntime()
  const { ink, React } = runtime
  const theme = createLogInkTheme(options.theme)

  const resumeRef: { current: (() => void) | null } = { current: null }
  const exitRef: { current: WorkspaceExitResult } = { current: { kind: 'quit' } }

  const app = React.createElement(WorkspaceInkApp, {
    appLabel: options.appLabel ?? 'coco workspace',
    initialOverview: cached,
    roots: options.roots,
    knownRepos,
    loadOverview,
    loadPullRequestCounts,
    onAddRepo: options.onAddRepo,
    resume: effectiveResume,
    exitRef,
    ink,
    React,
    theme,
    resumeRef,
  })

  const instance = ink.render(
    app,
    getLogInkRenderOptions({ input, output, error })
  )

  const lifecycle = installTerminalLifecycle({
    input,
    output,
    instance,
    onResume: () => resumeRef.current?.(),
  })

  try {
    await instance.waitUntilExit()
  } finally {
    // Belt-and-suspenders: explicit unmount after waitUntilExit
    // resolves. Ink usually handles this, but on some terminals the
    // stdin handler outlives the resolution by a tick, which then
    // races with the next mount in runWorkspaceLoop and surfaces as
    // a TTY EIO. Calling unmount() here is idempotent.
    try {
      instance.unmount()
    } catch {
      // ignore — already unmounted
    }
    lifecycle.dispose()
  }
  workspaceDebug(`exit: kind=${exitRef.current.kind}`)
  return exitRef.current
}

/**
 * Diagnostic logger toggled by COCO_DEBUG_WORKSPACE=1. Writes to a
 * file (NOT stderr) because alt-screen mode buries stderr output
 * under the rendered frames — by the time the user exits the alt
 * screen, scrollback usually loses the diagnostic lines.
 *
 * Each entry is timestamped relative to process start so the user
 * can spot timing-related restarts. Default path is
 * `/tmp/coco-workspace-debug.log`; override via the env var
 * `COCO_DEBUG_WORKSPACE_PATH`.
 *
 * One-time process-level handlers (installed on first call) log:
 *   - uncaught exceptions / unhandled rejections (the most likely
 *     restart trigger — panics from useInput callbacks)
 *   - process.exit codes (so we can tell whether tsx watch restarted
 *     us vs. we exited cleanly)
 *   - SIGINT / SIGTERM (terminal-driven kills)
 */

const WORKSPACE_DEBUG_START = Date.now()
let workspaceDebugPath: string | undefined
let workspaceDebugInstalled = false

function workspaceDebugEnabled(): boolean {
  return Boolean(process.env.COCO_DEBUG_WORKSPACE)
}

function resolveWorkspaceDebugPath(): string {
  if (workspaceDebugPath) return workspaceDebugPath
  workspaceDebugPath = process.env.COCO_DEBUG_WORKSPACE_PATH || '/tmp/coco-workspace-debug.log'
  return workspaceDebugPath
}

function installWorkspaceDebugHandlers(): void {
  if (workspaceDebugInstalled || !workspaceDebugEnabled()) return
  workspaceDebugInstalled = true
  process.on('uncaughtException', (err) => {
    workspaceDebug(`uncaughtException: ${err instanceof Error ? err.stack || err.message : String(err)}`)
  })
  process.on('unhandledRejection', (reason) => {
    workspaceDebug(`unhandledRejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`)
  })
  process.on('exit', (code) => {
    workspaceDebug(`process.exit code=${code}`)
  })
  process.on('SIGINT', () => workspaceDebug('SIGINT'))
  process.on('SIGTERM', () => workspaceDebug('SIGTERM'))
  process.on('SIGHUP', () => workspaceDebug('SIGHUP'))
  workspaceDebug(`debug log opened pid=${process.pid} cwd=${process.cwd()}`)
}

export function workspaceDebug(message: string): void {
  if (!workspaceDebugEnabled()) return
  installWorkspaceDebugHandlers()
  const ts = Date.now() - WORKSPACE_DEBUG_START
  const line = `[+${String(ts).padStart(6, ' ')}ms] ${message}\n`
  try {
    // appendFileSync is sync + creates the file if missing; on a panic
    // path this is the only way to guarantee the line lands before
    // process.exit fires.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs')
    fs.appendFileSync(resolveWorkspaceDebugPath(), line)
  } catch {
    // best-effort
  }
}

function renderWorkspaceSnapshot(
  overview: WorkspaceOverview,
  output: NodeJS.WriteStream
): void {
  if (overview.repos.length === 0) {
    output.write('No repositories discovered.\n')
    return
  }
  for (const repo of overview.repos) {
    const tokens: string[] = [repo.name]
    if (repo.branch) {
      tokens.push(`(${repo.branch})`)
    }
    if (repo.dirty > 0) {
      tokens.push(`●${repo.dirty}`)
    }
    if (repo.ahead > 0) {
      tokens.push(`↑${repo.ahead}`)
    }
    if (repo.behind > 0) {
      tokens.push(`↓${repo.behind}`)
    }
    if (repo.lastCommit) {
      tokens.push(repo.lastCommit.date.slice(0, 10))
    }
    output.write(`${tokens.join('  ')}\n`)
  }
}

type WorkspaceInkAppProps = {
  appLabel: string
  initialOverview: WorkspaceOverview
  roots: ReadonlyArray<string>
  knownRepos: ReadonlyArray<string>
  loadOverview: (
    roots: ReadonlyArray<string>,
    knownRepos: ReadonlyArray<string>
  ) => Promise<WorkspaceOverview>
  loadPullRequestCounts: (
    repos: ReadonlyArray<WorkspaceRepoSummary>
  ) => Promise<WorkspacePullRequestCounts>
  onAddRepo?: () => Promise<string | undefined>
  resume?: WorkspaceResumeState
  exitRef: { current: WorkspaceExitResult }
  ink: WorkspaceInkRuntime['ink']
  React: typeof ReactTypes
  theme: LogInkTheme
  resumeRef: { current: (() => void) | null }
}

function WorkspaceInkApp(props: WorkspaceInkAppProps): ReactTypes.ReactElement {
  const { React, ink } = props
  const { useApp, useInput, useWindowSize } = ink
  const { exit } = useApp()
  const { columns, rows } = useWindowSize()

  const [state, setState] = React.useState<WorkspaceState>(() =>
    createWorkspaceState({
      overview: props.initialOverview,
      roots: props.roots,
      loading: props.initialOverview.repos.length === 0,
      sortMode: props.resume?.sortMode,
      tab: props.resume?.tab,
      filter: props.resume?.filter,
      selectedRepoPath: props.resume?.selectedRepoPath,
      showOnboarding: !hasSeenWorkspaceOnboarding(),
      knownRepoPaths: readKnownRepos(),
    })
  )

  const [filterDraft, setFilterDraft] = React.useState<string>('')
  const [addRepoDraft, setAddRepoDraft] = React.useState<string>('~/')
  const [addRepoCompletion, setAddRepoCompletion] = React.useState<PathCompletionResult>(() =>
    completePath('~/')
  )

  const dispatch = React.useCallback((action: WorkspaceAction) => {
    setState((prev) => applyWorkspaceAction(prev, action))
  }, [])

  // Track an unmount flag in a ref so async work scheduled by the
  // input handler (refresh, drillIn, etc.) can short-circuit when the
  // user has already quit. Without this, a pending gh call from `r`
  // could keep the event loop alive after the user hit `q`, making
  // the process linger and stdin race against the next loop iteration.
  const unmountedRef = React.useRef(false)

  // Background discovery + PR-count refresh on mount.
  React.useEffect(() => {
    let cancelled = false
    dispatch({ type: 'set-loading', loading: true })
    void (async () => {
      try {
        const overview = await props.loadOverview(props.roots, props.knownRepos)
        if (cancelled || unmountedRef.current) return
        writeCachedWorkspace(props.roots, overview)
        dispatch({ type: 'replace-overview', overview })
        if (props.resume?.selectedRepoPath) {
          dispatch({ type: 'anchor-cursor-by-path', path: props.resume.selectedRepoPath })
        }
        const pr = await props.loadPullRequestCounts(overview.repos)
        if (cancelled || unmountedRef.current) return
        dispatch({
          type: 'replace-pull-request-counts',
          counts: pr.counts,
          authenticated: pr.authenticated,
        })
        if (!pr.authenticated) {
          dispatch({
            type: 'set-status',
            status: '`gh` unavailable — PR counts hidden.',
          })
        }
      } catch (err) {
        if (cancelled || unmountedRef.current) return
        dispatch({ type: 'set-loading', loading: false })
        dispatch({
          type: 'set-status',
          status: err instanceof Error ? err.message : 'Discovery failed.',
        })
      }
    })()
    return () => {
      cancelled = true
      unmountedRef.current = true
    }
    // Mount-only effect. Refreshes go through the input handler.
  }, [])

  const refresh = React.useCallback(async () => {
    dispatch({ type: 'set-loading', loading: true })
    try {
      const overview = await props.loadOverview(props.roots, props.knownRepos)
      if (unmountedRef.current) return
      writeCachedWorkspace(props.roots, overview)
      dispatch({ type: 'replace-overview', overview })
      dispatch({ type: 'set-status', status: `Refreshed ${overview.repos.length} repos.` })
      const pr = await props.loadPullRequestCounts(overview.repos)
      if (unmountedRef.current) return
      dispatch({
        type: 'replace-pull-request-counts',
        counts: pr.counts,
        authenticated: pr.authenticated,
      })
    } catch (err) {
      if (unmountedRef.current) return
      dispatch({ type: 'set-loading', loading: false })
      dispatch({
        type: 'set-status',
        status: err instanceof Error ? err.message : 'Discovery failed.',
      })
    }
  }, [dispatch, props])

  const drillIn = React.useCallback(() => {
    const focused = selectFocusedRepo(state)
    if (!focused) {
      return
    }
    props.exitRef.current = {
      kind: 'drill-in',
      repo: focused,
      resume: {
        sortMode: state.sortMode,
        tab: state.tab,
        filter: state.filter,
        selectedRepoPath: focused.path,
      },
    }
    exit()
  }, [exit, props.exitRef, state])

  const requestDelete = React.useCallback(() => {
    const focused = selectFocusedRepo(state)
    if (!focused) {
      return
    }
    if (!state.knownRepoPaths.includes(focused.path)) {
      dispatch({
        type: 'set-status',
        status: 'Only repos added via `a` can be removed. Edit workspace.roots in config to drop a discovered repo.',
      })
      return
    }
    dispatch({ type: 'request-delete', path: focused.path })
  }, [dispatch, state])

  const confirmDelete = React.useCallback(async () => {
    const target = state.pendingDeletePath
    if (!target) {
      return
    }
    const updated = removeKnownRepo(target)
    dispatch({ type: 'replace-known-repos', paths: updated })
    dispatch({ type: 'cancel-delete' })
    dispatch({ type: 'set-status', status: `Removed ${target}.` })
    // Refresh discovery so the deleted entry drops out of the list.
    dispatch({ type: 'set-loading', loading: true })
    try {
      const merged = mergeKnownRepos(props.knownRepos, updated)
      const overview = await props.loadOverview(props.roots, merged)
      writeCachedWorkspace(props.roots, overview)
      dispatch({ type: 'replace-overview', overview })
    } catch (err) {
      dispatch({ type: 'set-loading', loading: false })
      dispatch({
        type: 'set-status',
        status: err instanceof Error ? err.message : 'Refresh failed.',
      })
    }
  }, [dispatch, props, state.pendingDeletePath])

  const openAddRepo = React.useCallback(() => {
    setAddRepoDraft('~/')
    setAddRepoCompletion(completePath('~/'))
    dispatch({ type: 'set-focus', focus: 'add-repo' })
  }, [dispatch])

  const commitAddRepo = React.useCallback(async () => {
    const candidate = expandHomePrefix(addRepoDraft.trim().replace(/\/+$/, ''))
    if (!candidate) {
      dispatch({ type: 'set-status', status: 'Enter a path.' })
      return
    }
    if (!isGitWorkingTree(candidate)) {
      dispatch({ type: 'set-status', status: `${candidate} is not a git repo.` })
      return
    }
    const updated = appendKnownRepo(candidate)
    dispatch({ type: 'replace-known-repos', paths: updated })
    dispatch({ type: 'set-focus', focus: 'list' })
    dispatch({ type: 'set-status', status: `Added ${candidate}.` })
    // Refresh discovery so the new repo lands in the list and the
    // cursor anchors onto it.
    dispatch({ type: 'set-loading', loading: true })
    try {
      const merged = mergeKnownRepos(props.knownRepos, readKnownRepos())
      const overview = await props.loadOverview(props.roots, merged)
      writeCachedWorkspace(props.roots, overview)
      dispatch({ type: 'replace-overview', overview })
      dispatch({ type: 'anchor-cursor-by-path', path: candidate })
    } catch (err) {
      dispatch({ type: 'set-loading', loading: false })
      dispatch({
        type: 'set-status',
        status: err instanceof Error ? err.message : 'Refresh failed.',
      })
    }
  }, [addRepoDraft, dispatch, props])

  useInput((rawInput: string, key: WorkspaceInputKey) => {
    // Diagnostic: log every keypress with its raw bytes + flags +
    // current focus + visible repo count. Without this, restart bugs
    // are guesswork — this gives us a forensic trail.
    const charCode = rawInput ? rawInput.charCodeAt(0) : -1
    const flags = Object.entries(key)
      .filter(([, value]) => value)
      .map(([name]) => name)
      .join(',') || '(none)'
    workspaceDebug(
      `useInput rawInput="${rawInput}" code=${charCode} flags=${flags} focus=${state.focus} showOnboarding=${state.showOnboarding} showHelp=${state.showHelp}`
    )
    // First-run onboarding is non-modal — any keypress dismisses it
    // and persists the marker. The keypress still flows through to
    // the normal handler below so the user's first action isn't
    // wasted.
    if (state.showOnboarding) {
      markWorkspaceOnboardingSeen()
      dispatch({ type: 'dismiss-onboarding' })
    }
    if (state.focus === 'filter') {
      if (key.escape) {
        setFilterDraft('')
        dispatch({ type: 'clear-filter' })
        return
      }
      if (key.return) {
        dispatch({ type: 'set-filter', filter: filterDraft })
        dispatch({ type: 'set-focus', focus: 'list' })
        return
      }
      if (key.backspace || key.delete) {
        setFilterDraft((prev) => prev.slice(0, -1))
        return
      }
      if (rawInput && !key.ctrl && !key.meta) {
        setFilterDraft((prev) => prev + rawInput)
      }
      return
    }

    if (state.focus === 'add-repo') {
      if (key.escape) {
        dispatch({ type: 'set-focus', focus: 'list' })
        return
      }
      if (key.return) {
        void commitAddRepo()
        return
      }
      if (key.tab) {
        const next = applyTabCompletion(addRepoDraft, addRepoCompletion)
        setAddRepoDraft(next)
        setAddRepoCompletion(completePath(next))
        return
      }
      if (key.backspace || key.delete) {
        const next = addRepoDraft.slice(0, -1)
        setAddRepoDraft(next)
        setAddRepoCompletion(completePath(next || '~/'))
        return
      }
      if (rawInput && !key.ctrl && !key.meta) {
        const next = addRepoDraft + rawInput
        setAddRepoDraft(next)
        setAddRepoCompletion(completePath(next))
      }
      return
    }

    const intent = resolveWorkspaceInput(rawInput, key, state)
    workspaceDebug(
      `resolved intent=${intent.kind}${intent.kind === 'action' ? ` actionType=${intent.action.type}` : ''}`
    )
    switch (intent.kind) {
      case 'action':
        dispatch(intent.action)
        break
      case 'quit':
        workspaceDebug('intent=quit → calling exit()')
        props.exitRef.current = { kind: 'quit' }
        exit()
        break
      case 'drill-in':
        workspaceDebug('intent=drill-in → calling drillIn()')
        drillIn()
        break
      case 'refresh':
        void refresh()
        break
      case 'add-repo':
        openAddRepo()
        break
      case 'request-delete':
        requestDelete()
        break
      case 'confirm-delete':
        void confirmDelete()
        break
      case 'noop':
      default:
        break
    }
  })

  React.useEffect(() => {
    props.resumeRef.current = () => {
      // Force a no-op state update on SIGCONT so the screen repaints.
      setState((prev) => ({ ...prev }))
    }
    return () => {
      props.resumeRef.current = null
    }
  }, [props.resumeRef])

  // Persist user preferences whenever a relevant slice changes. The
  // disk write is best-effort and synchronous; the cost is sub-ms on
  // a typical SSD so we don't bother with a debounce.
  React.useEffect(() => {
    writeWorkspacePreferences(props.roots, {
      sortMode: state.sortMode,
      tab: state.tab,
      filter: state.filter,
    })
  }, [props.roots, state.sortMode, state.tab, state.filter])

  return renderWorkspaceApp({
    React,
    ink: { Box: ink.Box, Text: ink.Text },
    state,
    theme: props.theme,
    appLabel: props.appLabel,
    filterDraft,
    addRepoDraft,
    addRepoCompletion,
    columns,
    rows,
  })
}
