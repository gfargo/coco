/**
 * Ink runtime entry point for `coco log -i` and `coco ui`.
 *
 * This file is the boot sequence — it picks the TTY vs non-TTY path,
 * dynamically imports the ESM-only `ink` + `react` modules, mounts the
 * `LogInkApp` component (which lives in `src/workstation/runtime/app.ts`),
 * and installs SIGTSTP / SIGCONT lifecycle handlers around the Ink
 * instance.
 *
 * Every render concern — surfaces, chrome, overlays, dispatchers — lives
 * under `src/workstation/`. This file is intentionally small: anything
 * the user can see is in workstation/.
 */

import type * as ReactTypes from 'react'
import { SimpleGit } from 'simple-git'
import { GitLogRow } from './data'
import { startInteractiveLog } from './interactive'
import { LogInkView } from './inkViewModel'
import { LogInkApp } from '../../workstation/runtime/app'
import { createLogInkTheme, LogInkThemeConfig } from '../../workstation/chrome/theme'
import { installTerminalLifecycle } from '../../workstation/chrome/terminalLifecycle'
import { canStartLogInkTui, getLogInkRenderOptions } from '../../workstation/chrome/terminal'
import type { LogInkRuntime } from '../../workstation/runtime/types'
import { LogArgv } from './config'

type DynamicImport = <T>(specifier: string) => Promise<T>
const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

type LogInkStreams = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  error?: NodeJS.WriteStream
}

type LogInkOptions = {
  appLabel?: string
  /**
   * P4.3 — opt-in idle tip rotation. Forwarded from `logTui.idleTips` in the
   * user's config. The runtime starts a tip cycle when `state.statusMessage`
   * is empty for >10s; the tip lives in the footer's status slot until the
   * next user action sets a real message.
   */
  idleTips?: boolean
  initialView?: LogInkView
  logArgv?: LogArgv
  /**
   * Deferred commit-log loader (#808). When set, the runtime mounts
   * Ink immediately with whatever `rows` was passed (typically `[]`)
   * and runs `loadRows` in a useEffect. The history surface shows a
   * "Loading commits…" placeholder while the load is in flight; the
   * loader's result is dispatched via `replaceRows` which clears the
   * boot flag. Without this option the runtime keeps the previous
   * eager behavior (caller awaits the rows before mount).
   */
  loadRows?: () => Promise<GitLogRow[]>
  theme?: LogInkThemeConfig
}

async function loadInkRuntime(): Promise<LogInkRuntime> {
  const [ink, React] = await Promise.all([
    dynamicImport<LogInkRuntime['ink']>('ink'),
    dynamicImport<typeof ReactTypes>('react'),
  ])

  return {
    ink,
    React,
  }
}

export async function startInkInteractiveLog(
  git: SimpleGit,
  rows: GitLogRow[],
  streams: LogInkStreams = {},
  options: LogInkOptions = {}
): Promise<void> {
  const input = streams.input || process.stdin
  const output = streams.output || process.stdout
  const error = streams.error || process.stderr

  // Non-TTY fallback (CI logs, piped output) needs the rows up-front
  // because the renderer just dumps a static snapshot. Run the
  // deferred loader synchronously here when present so callers get
  // the same shape regardless of the entry path.
  if (!canStartLogInkTui(input, output)) {
    const fallbackRows = options.loadRows && rows.length === 0
      ? await options.loadRows()
      : rows
    await startInteractiveLog(git, fallbackRows, {
      appLabel: options.appLabel,
      input,
      output,
    })
    return
  }

  const runtime = await loadInkRuntime()
  const { ink, React } = runtime

  // Forward declared so the lifecycle handler can call back into the React
  // tree on SIGCONT to force a repaint after the user `fg`s.
  const resumeRef: { current: (() => void) | null } = { current: null }

  const app = React.createElement(LogInkApp, {
    appLabel: options.appLabel || 'coco log',
    git,
    idleTipsEnabled: Boolean(options.idleTips),
    ink,
    initialView: options.initialView || 'history',
    logArgv: options.logArgv,
    loadRows: options.loadRows,
    React,
    rows,
    theme: createLogInkTheme(options.theme),
    resumeRef,
  })
  const instance = ink.render(app, getLogInkRenderOptions({ input, output, error }))

  const lifecycle = installTerminalLifecycle({
    input,
    output,
    instance,
    onResume: () => resumeRef.current?.(),
  })

  try {
    await instance.waitUntilExit()
  } finally {
    lifecycle.dispose()
  }
}
