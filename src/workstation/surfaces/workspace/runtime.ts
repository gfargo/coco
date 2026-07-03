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

import * as nodeFs from 'node:fs'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import type * as ReactTypes from 'react'

// Ink is ESM-only and loaded at runtime via the dynamicImport smuggle
// below. Types are erased at compile time, so `import type` is safe
// here — ts-jest's CJS transform leaves type-only imports alone.
//
// Pulling the real prop shapes (BoxProps, TextProps) + hook return
// types (AppProps, WindowSize) + Key into the runtime gives the view
// layer actual prop checking instead of `Record<string, unknown>`.
import type {
  AppProps as InkAppProps,
  BoxProps,
  Instance,
  Key as InkKey,
  RenderOptions as InkRenderOptions,
  TextProps,
  WindowSize,
} from 'ink'

import {
  getWorkspaceOverview,
  type WorkspaceOverview,
  type WorkspaceRepoSummary,
} from '../../../git/workspaceData'
import {
  getWorkspacePullRequestCounts,
  type WorkspacePullRequestCounts,
} from '../../../git/workspacePullRequestData'
import { cloneRepo, deriveRepoName } from '../../../git/cloneRepo'
import {
  canStartLogInkTui,
  getLogInkRenderOptions,
} from '../../chrome/terminal'
import {
  createLogInkTheme,
  type LogInkTheme,
  type LogInkThemeConfig,
  type LogInkThemePreset,
} from '../../chrome/theme'
import { saveThemePreset } from '../../chrome/themePersistence'
import { getThemePickerSelectionFor } from '../../../workstation/runtime/inkViewModel'
import {
  readCachedWorkspace,
  writeCachedWorkspace,
} from '../../chrome/workspaceCache'
import { installTerminalLifecycle } from '../../chrome/terminalLifecycle'

import { renderWorkspaceApp, workspaceHelpMaxOffset } from './view'
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
/**
 * `import()` smuggle. ts-jest's CJS transform downgrades a bare
 * `await import(spec)` into `require(spec)`, which fails for the
 * ESM-only `ink` / `react` packages with "A dynamic import callback
 * was invoked without --experimental-vm-modules". Wrapping the
 * import in a `new Function('return import(...)')` body keeps the
 * import expression as a string at compile time — the runtime then
 * eval-parses it as native ESM dynamic import.
 *
 * Same trick `src/workstation/runtime/inkRuntime.ts` uses; documented in
 * `src/workstation/README.md`.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

export type WorkspaceInkRuntime = {
  ink: {
    Box: ReactTypes.ComponentType<BoxProps>
    Text: ReactTypes.ComponentType<TextProps>
    render: (app: ReactTypes.ReactElement, options: InkRenderOptions) => Instance
    useApp: () => InkAppProps
    useInput: (handler: (input: string, key: InkKey) => void) => void
    useWindowSize: () => WindowSize
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
  /**
   * Override gh PR-count fetch (used by tests + when caller already
   * has data). Second arg lets the runtime watch per-repo completion
   * so the surface can clear the per-row spinner the moment each
   * repo's count lands, instead of waiting for the whole batch.
   */
  loadPullRequestCounts?: (
    repos: ReadonlyArray<WorkspaceRepoSummary>,
    onRepoComplete?: (path: string, count: number | undefined) => void
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
  workspaceDebug(`startWorkspace roots=${options.roots.join(',')} hasResume=${Boolean(options.resume)}`)
  const streams = options.streams ?? {}
  const input = streams.input ?? process.stdin
  const output = streams.output ?? process.stdout
  const error = streams.error ?? process.stderr
  const knownRepos = mergeKnownRepos(options.knownRepos ?? [], readKnownRepos())

  const loadOverview =
    options.loadOverview ??
    ((roots: ReadonlyArray<string>, repos: ReadonlyArray<string>) =>
      getWorkspaceOverview(roots, { knownRepos: repos, maxDepth: options.maxDepth }))

  const loadPullRequestCounts: (
    repos: ReadonlyArray<WorkspaceRepoSummary>,
    onRepoComplete?: (path: string, count: number | undefined) => void
  ) => Promise<WorkspacePullRequestCounts> =
    options.loadPullRequestCounts ??
    ((repos, onRepoComplete) =>
      getWorkspacePullRequestCounts(
        repos.map((entry) => entry.path),
        { onRepoComplete }
      ))

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
    themeConfig: options.theme,
    resumeRef,
  })

  // Override exitOnCtrlC. Ink's default ctrl+c handler reaches into
  // process.kill, which on some terminals races with stdin teardown
  // and surfaces as TTY EIO. We handle ctrl+c in our own useInput
  // handler so the quit path is the same as `q`.
  const renderOptions = {
    ...getLogInkRenderOptions({ input, output, error }),
    exitOnCtrlC: false,
  }
  const instance = ink.render(app, renderOptions)

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
 * Diagnostic ring-buffer (toggled by COCO_DEBUG_WORKSPACE=1).
 *
 * Why a ring buffer rather than live file writes:
 *   - Live file writes during the session can trigger overzealous
 *     file watchers (we've been bitten by this on /tmp).
 *   - stderr writes interleave with Ink's alt-screen output and get
 *     destroyed on screen restore.
 *
 * Strategy:
 *   - Append in-memory only during the session (last 500 events).
 *   - Flush to ~/.cache/coco/workspace-trace.log ONCE at exit
 *     (process.on('exit') handler, plus an explicit flush in the
 *     startWorkspace finally block as a belt-and-suspenders).
 *
 * Override the path with COCO_DEBUG_WORKSPACE_PATH.
 */

const WORKSPACE_DEBUG_START = Date.now()
const WORKSPACE_DEBUG_BUFFER: string[] = []
const WORKSPACE_DEBUG_MAX = 500
let workspaceDebugInstalled = false
let workspaceDebugFlushed = false

function workspaceDebugEnabled(): boolean {
  return Boolean(process.env.COCO_DEBUG_WORKSPACE)
}

function resolveWorkspaceTracePath(): string {
  if (process.env.COCO_DEBUG_WORKSPACE_PATH) {
    return process.env.COCO_DEBUG_WORKSPACE_PATH
  }
  const xdg = process.env.XDG_CACHE_HOME
  // Default lives under the cache dir the user already confirmed
  // their tsx watcher ignores.
  const cacheRoot = xdg && xdg.trim() ? xdg : nodePath.join(nodeOs.homedir(), '.cache')
  return nodePath.join(cacheRoot, 'coco', 'workspace-trace.log')
}

export function flushWorkspaceTrace(): void {
  if (!workspaceDebugEnabled() || workspaceDebugFlushed) return
  workspaceDebugFlushed = true
  if (WORKSPACE_DEBUG_BUFFER.length === 0) return
  try {
    const target = resolveWorkspaceTracePath()
    nodeFs.mkdirSync(nodePath.dirname(target), { recursive: true })
    nodeFs.writeFileSync(target, WORKSPACE_DEBUG_BUFFER.join('\n') + '\n')
  } catch {
    // best-effort
  }
}

function installWorkspaceDebugHandlers(): void {
  if (workspaceDebugInstalled || !workspaceDebugEnabled()) return
  workspaceDebugInstalled = true
  process.on('uncaughtException', (err) => {
    workspaceDebug(`uncaughtException: ${err instanceof Error ? err.stack || err.message : String(err)}`)
    flushWorkspaceTrace()
  })
  process.on('unhandledRejection', (reason) => {
    workspaceDebug(`unhandledRejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`)
    flushWorkspaceTrace()
  })
  process.on('exit', (code) => {
    workspaceDebug(`process.exit code=${code}`)
    flushWorkspaceTrace()
  })
  process.on('SIGINT', () => { workspaceDebug('SIGINT'); flushWorkspaceTrace() })
  process.on('SIGTERM', () => { workspaceDebug('SIGTERM'); flushWorkspaceTrace() })
  workspaceDebug(`debug buffer opened pid=${process.pid} cwd=${process.cwd()}`)
}

export function workspaceDebug(message: string): void {
  if (!workspaceDebugEnabled()) return
  const ts = Date.now() - WORKSPACE_DEBUG_START
  WORKSPACE_DEBUG_BUFFER.push(`[+${String(ts).padStart(6, ' ')}ms] ${message}`)
  if (WORKSPACE_DEBUG_BUFFER.length > WORKSPACE_DEBUG_MAX) {
    WORKSPACE_DEBUG_BUFFER.shift()
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
    repos: ReadonlyArray<WorkspaceRepoSummary>,
    onRepoComplete?: (path: string, count: number | undefined) => void
  ) => Promise<WorkspacePullRequestCounts>
  onAddRepo?: () => Promise<string | undefined>
  resume?: WorkspaceResumeState
  exitRef: { current: WorkspaceExitResult }
  ink: WorkspaceInkRuntime['ink']
  React: typeof ReactTypes
  theme: LogInkTheme
  /** Theme config the built `theme` came from — lets the picker rebuild a
   *  live preview preserving ascii/border/noColor semantics. */
  themeConfig?: LogInkThemeConfig
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
  // Clone-repo modal (`c`). Two fields: the remote URL and the
  // destination path. `cloneField` tracks which is active; `cloneTarget`
  // auto-derives `<cwd>/<repo-name>` from the URL until the user edits it
  // (`cloneTargetEdited`). `cloning` blocks input + shows a spinner while
  // `git clone` runs. The boot cwd is captured once at mount so it stays
  // the directory the workspace launched in even after drill-in.
  const bootCwdRef = React.useRef<string>(process.cwd())
  const [cloneUrl, setCloneUrl] = React.useState<string>('')
  const [cloneTarget, setCloneTarget] = React.useState<string>('')
  const [cloneField, setCloneField] = React.useState<'url' | 'target'>('url')
  const [cloneTargetEdited, setCloneTargetEdited] = React.useState<boolean>(false)
  const [cloneCompletion, setCloneCompletion] = React.useState<PathCompletionResult>(() =>
    completePath('~/')
  )
  const [cloning, setCloning] = React.useState<boolean>(false)
  // Tick counter for the per-row PR-fetch spinner. Bumped on a
  // setInterval that only runs while at least one row is mid-fetch
  // (see effect below) so idle workspaces don't burn CPU on animation
  // frames.
  const [spinnerTick, setSpinnerTick] = React.useState(0)

  // Theme picker (`T`) — reactive theme so the chrome live-previews the
  // cursored theme. `themePreviewPreset` follows the picker cursor while
  // open; `themeSessionPreset` is the applied choice. The effective theme
  // rebuilds from the original config; when neither is set we use the
  // static `props.theme` unchanged (mirrors `coco ui`).
  const [themePreviewPreset, setThemePreviewPreset] = React.useState<LogInkThemePreset | undefined>(undefined)
  const [themeSessionPreset, setThemeSessionPreset] = React.useState<LogInkThemePreset | undefined>(undefined)
  const effectiveThemePreset = themePreviewPreset ?? themeSessionPreset
  const theme = React.useMemo(
    () =>
      effectiveThemePreset
        ? createLogInkTheme({ ...props.themeConfig, preset: effectiveThemePreset })
        : props.theme,
    [effectiveThemePreset, props.themeConfig, props.theme]
  )

  const dispatch = React.useCallback((action: WorkspaceAction) => {
    setState((prev) => applyWorkspaceAction(prev, action))
  }, [])

  // Spinner tick — only ticks while at least one row is fetching a
  // PR count. Stops as soon as the fetching set empties so the
  // workspace idles at zero render cost.
  const fetchingCount = state.pullRequestFetching.length
  React.useEffect(() => {
    if (fetchingCount === 0) return
    const id = setInterval(() => setSpinnerTick((tick) => (tick + 1) % 1000), 80)
    return () => clearInterval(id)
  }, [fetchingCount])

  // Track an unmount flag in a ref so async work scheduled by the
  // input handler (refresh, drillIn, etc.) can short-circuit when the
  // user has already quit. Without this, a pending gh call from `r`
  // could keep the event loop alive after the user hit `q`, making
  // the process linger and stdin race against the next loop iteration.
  const unmountedRef = React.useRef(false)

  // Mirror state into a ref so the input handler can read the
  // latest values without us having to put `state` in its
  // useCallback deps. Without this trick, the handler closure
  // changes every render → Ink unsubscribes + re-subscribes
  // stdin on every keystroke → stdin can race with itself and the
  // surface visibly judders. Same pattern coco ui uses.
  const stateRef = React.useRef(state)
  stateRef.current = state
  const rowsRef = React.useRef(rows)
  rowsRef.current = rows
  const filterDraftRef = React.useRef(filterDraft)
  filterDraftRef.current = filterDraft
  const addRepoDraftRef = React.useRef(addRepoDraft)
  addRepoDraftRef.current = addRepoDraft
  const addRepoCompletionRef = React.useRef(addRepoCompletion)
  addRepoCompletionRef.current = addRepoCompletion
  const cloneUrlRef = React.useRef(cloneUrl)
  cloneUrlRef.current = cloneUrl
  const cloneTargetRef = React.useRef(cloneTarget)
  cloneTargetRef.current = cloneTarget
  const cloneFieldRef = React.useRef(cloneField)
  cloneFieldRef.current = cloneField
  const cloneTargetEditedRef = React.useRef(cloneTargetEdited)
  cloneTargetEditedRef.current = cloneTargetEdited
  const cloneCompletionRef = React.useRef(cloneCompletion)
  cloneCompletionRef.current = cloneCompletion
  const cloningRef = React.useRef(cloning)
  cloningRef.current = cloning

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
        // Mark every repo as "fetching PRs" up front so the row
        // spinners light up immediately. As each repo's gh call
        // completes, mark-pull-request-fetched clears just that row.
        dispatch({
          type: 'set-pull-request-fetching',
          paths: overview.repos.map((entry) => entry.path),
        })
        const pr = await props.loadPullRequestCounts(overview.repos, (path) => {
          if (cancelled || unmountedRef.current) return
          dispatch({ type: 'mark-pull-request-fetched', path })
        })
        if (cancelled || unmountedRef.current) return
        dispatch({
          type: 'replace-pull-request-counts',
          counts: pr.counts,
          authenticated: pr.authenticated,
        })
        // Belt-and-suspenders: clear any stragglers in the fetching set
        // (e.g. repos without a GitHub remote that the data layer
        // skipped silently in older versions).
        dispatch({ type: 'set-pull-request-fetching', paths: [] })
        if (!pr.authenticated) {
          dispatch({
            type: 'set-status',
            status: '`gh` unavailable — PR counts hidden.',
          })
        }
      } catch (err) {
        if (cancelled || unmountedRef.current) return
        dispatch({ type: 'set-pull-request-fetching', paths: [] })
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
    // Capture the cursored repo BEFORE the overview lands: the default
    // sort is recency, so a refresh routinely reorders the list, and
    // `replace-overview` only clamps the numeric index — the cursor
    // stayed on the same ROW NUMBER but a different repo, and Enter
    // drilled into the wrong one. Every other list-mutating flow
    // (add / clone / resume) already anchors by path.
    const focusedPath = selectFocusedRepo(stateRef.current)?.path
    dispatch({ type: 'set-loading', loading: true })
    try {
      const overview = await props.loadOverview(props.roots, props.knownRepos)
      if (unmountedRef.current) return
      writeCachedWorkspace(props.roots, overview)
      dispatch({ type: 'replace-overview', overview })
      if (focusedPath) {
        dispatch({ type: 'anchor-cursor-by-path', path: focusedPath })
      }
      dispatch({ type: 'set-status', status: `Refreshed ${overview.repos.length} repos.` })
      dispatch({
        type: 'set-pull-request-fetching',
        paths: overview.repos.map((entry) => entry.path),
      })
      const pr = await props.loadPullRequestCounts(overview.repos, (path) => {
        if (unmountedRef.current) return
        dispatch({ type: 'mark-pull-request-fetched', path })
      })
      if (unmountedRef.current) return
      dispatch({
        type: 'replace-pull-request-counts',
        counts: pr.counts,
        authenticated: pr.authenticated,
      })
      dispatch({ type: 'set-pull-request-fetching', paths: [] })
    } catch (err) {
      if (unmountedRef.current) return
      dispatch({ type: 'set-loading', loading: false })
      dispatch({
        type: 'set-status',
        status: err instanceof Error ? err.message : 'Discovery failed.',
      })
    }
  }, [dispatch, props])

  const refreshRow = React.useCallback(async () => {
    const focused = selectFocusedRepo(stateRef.current)
    if (!focused) return
    dispatch({ type: 'set-pull-request-fetching', paths: [focused.path] })
    dispatch({ type: 'set-status', status: `Refreshing ${focused.name}…` })
    try {
      const pr = await props.loadPullRequestCounts([focused], (path) => {
        if (unmountedRef.current) return
        dispatch({ type: 'mark-pull-request-fetched', path })
      })
      if (unmountedRef.current) return
      // Merge into existing counts rather than replacing them — a
      // per-row refresh shouldn't clobber other rows' counts.
      const merged: Record<string, number> = { ...stateRef.current.pullRequestCounts }
      if (typeof pr.counts[focused.path] === 'number') {
        merged[focused.path] = pr.counts[focused.path]
      } else {
        delete merged[focused.path]
      }
      dispatch({
        type: 'replace-pull-request-counts',
        counts: merged,
        authenticated: pr.authenticated,
      })
      dispatch({ type: 'set-pull-request-fetching', paths: [] })
      dispatch({ type: 'set-status', status: `Refreshed ${focused.name}.` })
    } catch (err) {
      if (unmountedRef.current) return
      dispatch({ type: 'set-pull-request-fetching', paths: [] })
      dispatch({
        type: 'set-status',
        status: err instanceof Error ? err.message : 'Row refresh failed.',
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

  // Default destination for a clone URL: `<bootCwd>/<repo-name>`.
  const cloneTargetFor = React.useCallback((url: string): string => {
    return nodePath.join(bootCwdRef.current, deriveRepoName(url))
  }, [])

  const openClone = React.useCallback(() => {
    setCloneUrl('')
    setCloneTarget('')
    setCloneField('url')
    setCloneTargetEdited(false)
    setCloneCompletion(completePath(`${bootCwdRef.current}/`))
    dispatch({ type: 'set-focus', focus: 'clone-repo' })
  }, [dispatch])

  const commitClone = React.useCallback(async () => {
    const url = cloneUrlRef.current.trim()
    const target = expandHomePrefix(cloneTargetRef.current.trim().replace(/\/+$/, ''))
    if (!url) {
      dispatch({ type: 'set-status', status: 'Enter a remote URL.' })
      return
    }
    if (!target) {
      dispatch({ type: 'set-status', status: 'Enter a destination path.' })
      return
    }
    setCloning(true)
    dispatch({ type: 'set-status', status: `Cloning ${deriveRepoName(url)}…` })
    const result = await cloneRepo(url, target)
    if (unmountedRef.current) return
    setCloning(false)
    if (!result.ok) {
      // Keep the modal open so the user can fix the URL / path and retry.
      dispatch({ type: 'set-status', status: result.message })
      return
    }
    const updated = appendKnownRepo(target)
    dispatch({ type: 'replace-known-repos', paths: updated })
    dispatch({ type: 'set-focus', focus: 'list' })
    dispatch({ type: 'set-status', status: result.message })
    dispatch({ type: 'set-loading', loading: true })
    try {
      const merged = mergeKnownRepos(props.knownRepos, readKnownRepos())
      const overview = await props.loadOverview(props.roots, merged)
      writeCachedWorkspace(props.roots, overview)
      dispatch({ type: 'replace-overview', overview })
      dispatch({ type: 'anchor-cursor-by-path', path: target })
    } catch (err) {
      dispatch({ type: 'set-loading', loading: false })
      dispatch({
        type: 'set-status',
        status: err instanceof Error ? err.message : 'Refresh failed.',
      })
    }
  }, [dispatch, props])

  // Callback refs so the stable input handler can reach the latest
  // closure without taking them in deps.
  const commitAddRepoRef = React.useRef(commitAddRepo)
  commitAddRepoRef.current = commitAddRepo
  const drillInRef = React.useRef(drillIn)
  drillInRef.current = drillIn
  const refreshRef = React.useRef(refresh)
  refreshRef.current = refresh
  const refreshRowRef = React.useRef(refreshRow)
  refreshRowRef.current = refreshRow
  const openAddRepoRef = React.useRef(openAddRepo)
  openAddRepoRef.current = openAddRepo
  const openCloneRef = React.useRef(openClone)
  openCloneRef.current = openClone
  const commitCloneRef = React.useRef(commitClone)
  commitCloneRef.current = commitClone
  const requestDeleteRef = React.useRef(requestDelete)
  requestDeleteRef.current = requestDelete
  const confirmDeleteRef = React.useRef(confirmDelete)
  confirmDeleteRef.current = confirmDelete
  const exitRefHolder = React.useRef(props.exitRef)
  exitRefHolder.current = props.exitRef
  const exitFnRef = React.useRef(exit)
  exitFnRef.current = exit

  // Stable input handler. All reads go through refs so the closure
  // identity never changes — Ink's useInput effect re-runs zero
  // times after mount, eliminating per-keystroke stdin churn that
  // was likely contributing to the visible flicker / restart effect.
  const handleInput = React.useCallback((rawInput: string, key: WorkspaceInputKey) => {
    const state = stateRef.current
    const filterDraft = filterDraftRef.current
    const addRepoDraft = addRepoDraftRef.current
    const addRepoCompletion = addRepoCompletionRef.current

    // Diagnostic: log every key with the raw byte code + key flags +
    // current focus + onboarding/help state. This is the forensic
    // trail we need to chase restart bugs.
    const charCode = rawInput ? rawInput.charCodeAt(0) : -1
    const flags = Object.entries(key)
      .filter(([, value]) => value)
      .map(([name]) => name)
      .join(',') || '(none)'
    workspaceDebug(
      `key raw="${JSON.stringify(rawInput)}" code=${charCode} flags=${flags} focus=${state.focus} showOnboarding=${state.showOnboarding} showHelp=${state.showHelp}`
    )

    // Ctrl+C quits from ANYWHERE — checked before the modal focus
    // branches below, which used to `return` first and leave Ctrl+C
    // inert inside the filter / add-repo / clone prompts (and made a
    // hung `git clone` unabortable from the UI, since the clone branch
    // swallows every key while in flight).
    if (key.ctrl && (rawInput === 'c' || rawInput === '')) {
      exitRefHolder.current.current = { kind: 'quit' }
      exitFnRef.current()
      return
    }

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
        void commitAddRepoRef.current()
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

    if (state.focus === 'clone-repo') {
      // While the clone is running, swallow everything except Esc
      // (which is a no-op here — the clone is already in flight).
      if (cloningRef.current) return
      if (key.escape) {
        dispatch({ type: 'set-focus', focus: 'list' })
        return
      }
      const field = cloneFieldRef.current
      const url = cloneUrlRef.current
      const target = cloneTargetRef.current
      const targetEdited = cloneTargetEditedRef.current

      if (key.return) {
        if (field === 'url') {
          if (!url.trim()) {
            dispatch({ type: 'set-status', status: 'Enter a remote URL.' })
            return
          }
          // Advance to the (pre-filled, editable) destination field.
          const derived = targetEdited ? target : cloneTargetFor(url)
          setCloneTarget(derived)
          setCloneCompletion(completePath(derived))
          setCloneField('target')
          return
        }
        void commitCloneRef.current()
        return
      }
      if (key.tab && field === 'target') {
        const next = applyTabCompletion(target, cloneCompletionRef.current)
        setCloneTarget(next)
        setCloneTargetEdited(true)
        setCloneCompletion(completePath(next))
        return
      }
      if (key.backspace || key.delete) {
        if (field === 'url') {
          const next = url.slice(0, -1)
          setCloneUrl(next)
          if (!targetEdited) setCloneTarget(next ? cloneTargetFor(next) : '')
        } else {
          const next = target.slice(0, -1)
          setCloneTarget(next)
          setCloneTargetEdited(true)
          setCloneCompletion(completePath(next || '~/'))
        }
        return
      }
      if (rawInput && !key.ctrl && !key.meta) {
        if (field === 'url') {
          const next = url + rawInput
          setCloneUrl(next)
          if (!targetEdited) setCloneTarget(cloneTargetFor(next))
        } else {
          const next = target + rawInput
          setCloneTarget(next)
          setCloneTargetEdited(true)
          setCloneCompletion(completePath(next))
        }
      }
      return
    }

    const intent = resolveWorkspaceInput(rawInput, key, state)
    workspaceDebug(
      `intent=${intent.kind}${intent.kind === 'action' ? ` action=${intent.action.type}` : ''}`
    )
    switch (intent.kind) {
      case 'action':
        // Keep the local prompt draft in lockstep with the committed
        // filter (#1347): opening the prompt seeds the draft from the
        // active filter (so a resume-seeded or previously-applied
        // filter shows in the prompt instead of a stale/empty draft),
        // and the list-level Esc clear resets the draft along with it.
        if (intent.action.type === 'set-focus' && intent.action.focus === 'filter') {
          setFilterDraft(state.filter ?? '')
        } else if (intent.action.type === 'clear-filter') {
          setFilterDraft('')
        }
        // Attach the scroll ceiling (terminal-height dependent, so the
        // reducer can't compute it) — see the scroll-help reducer case.
        if (intent.action.type === 'scroll-help') {
          dispatch({ ...intent.action, maxOffset: workspaceHelpMaxOffset(rowsRef.current) })
          break
        }
        dispatch(intent.action)
        break
      case 'apply-theme':
        // Apply for the session + persist to the global config (best-effort),
        // then close the picker (clearing the preview via the sync effect).
        setThemeSessionPreset(intent.preset as LogInkThemePreset)
        saveThemePreset(intent.preset as LogInkThemePreset)
        dispatch({ type: 'toggle-theme-picker' })
        break
      case 'quit':
        workspaceDebug('→ exit() called from quit intent')
        exitRefHolder.current.current = { kind: 'quit' }
        exitFnRef.current()
        break
      case 'drill-in':
        workspaceDebug('→ drillIn() called from drill-in intent')
        drillInRef.current()
        break
      case 'refresh':
        void refreshRef.current()
        break
      case 'refresh-row':
        void refreshRowRef.current()
        break
      case 'add-repo':
        openAddRepoRef.current()
        break
      case 'clone-repo':
        openCloneRef.current()
        break
      case 'request-delete':
        requestDeleteRef.current()
        break
      case 'confirm-delete':
        void confirmDeleteRef.current()
        break
      case 'noop':
      default:
        break
    }
    // Empty deps intentional — every reference goes through a ref so
    // the closure identity never changes. Ink's useInput effect runs
    // exactly once.
  }, [])

  useInput(handleInput)

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

  // Keep the live preview in sync with the preset under the picker cursor
  // while the overlay is open; clear it on close so the theme reverts to
  // the applied session preset (or the original config theme).
  const themePickerSelection = state.showThemePicker
    ? getThemePickerSelectionFor(state.themePickerFilter, state.themePickerIndex)
    : undefined
  React.useEffect(() => {
    setThemePreviewPreset(state.showThemePicker ? themePickerSelection : undefined)
  }, [state.showThemePicker, themePickerSelection])

  return renderWorkspaceApp({
    React,
    ink: { Box: ink.Box, Text: ink.Text },
    state,
    theme,
    appLabel: props.appLabel,
    filterDraft,
    addRepoDraft,
    addRepoCompletion,
    cloneUrl,
    cloneTarget,
    cloneField,
    cloneCompletion,
    cloning,
    columns,
    rows,
    spinnerTick,
  })
}
