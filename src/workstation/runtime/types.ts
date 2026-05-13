/**
 * Shared types for the Ink workstation runtime.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` so per-surface modules
 * (planned under `src/workstation/surfaces/<view>/`) and chrome render
 * helpers (planned under `src/workstation/runtime/`) can speak the same
 * type vocabulary without re-importing the giant inkRuntime module.
 *
 * `LogInkRuntime['ink']` carries Ink's ESM-only surface; we type it
 * structurally (rather than importing from 'ink') so the rest of the
 * codebase compiles without bundling Ink. The actual module is loaded
 * via dynamicImport at runtime.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { BisectStatus } from '../../git/bisectData'
import type { BranchOverview } from '../../git/branchData'
import type { LfsAttributeStatus } from '../../git/lfsAttributes'
import type { GitOperationOverview } from '../../git/operationData'
import type { ProviderOverview } from '../../git/providerData'
import type { PullRequestOverview } from '../../git/pullRequestData'
import type { ReflogOverview } from '../../git/reflogData'
import type { StashOverview } from '../../git/stashData'
import type { TagOverview } from '../../git/tagData'
import type { WorktreeOverview } from '../../git/statusData'
import type { WorktreeOverview as WorktreeListOverview } from '../../git/worktreeData'
import type { ClipboardRunner } from '../../git/historyActions'
import type { LogArgv } from '../../commands/log/config'
import type { GitLogRow } from '../../commands/log/data'
import type { LogInkView } from '../../commands/log/inkViewModel'
import type { LogInkInputKey } from '../../commands/log/inkInput'
import type { LogInkTheme } from '../chrome/theme'

export type LogInkContext = {
  bisect?: BisectStatus
  branches?: BranchOverview
  /**
   * Repository-wide LFS attribute status (#884). When present, the
   * UI flags LFS-tracked rows with an "LFS" badge even before any
   * change has been made to them; the per-patch pointer detection
   * in `lfsPointer.ts` continues to handle modified rows.
   */
  lfs?: LfsAttributeStatus
  operation?: GitOperationOverview
  provider?: ProviderOverview
  pullRequest?: PullRequestOverview
  reflog?: ReflogOverview
  stashes?: StashOverview
  tags?: TagOverview
  worktree?: WorktreeOverview
  worktreeList?: WorktreeListOverview
}

export type LogInkRuntime = {
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
    useApp: () => {
      exit: () => void
    }
    useInput: (handler: (input: string, key: LogInkInputKey) => void) => void
    useWindowSize: () => {
      columns: number
      rows: number
    }
  }
  React: typeof ReactTypes
}

export type LogInkComponents = Pick<LogInkRuntime['ink'], 'Box' | 'Text'>

export type LogInkComponentDeps = LogInkRuntime & {
  appLabel: string
  git: SimpleGit
  /** Drives P4.3 idle status-line tip rotation when truthy. */
  idleTipsEnabled?: boolean
  initialView: LogInkView
  logArgv?: LogArgv
  rows: GitLogRow[]
  /**
   * Optional deferred commit-log loader (#808). When set, the React
   * tree mounts with `rows` (typically `[]`) and runs the loader on
   * mount, dispatching `replaceRows` on completion. Boot UX is the
   * sole motivator — for a moderately large repo, awaiting `git log`
   * before mount produces 1-3 seconds of black terminal that reads as
   * "is this hanging?".
   */
  loadRows?: () => Promise<GitLogRow[]>
  theme: LogInkTheme
  /**
   * Mutable ref the runtime fills with a force-render callback. The
   * terminal-lifecycle module invokes it on `SIGCONT` so users land on a
   * painted screen after `fg` instead of an empty alt buffer.
   */
  resumeRef?: { current: (() => void) | null }
  /**
   * Test seam — when set, the yank-to-clipboard handler uses this runner
   * instead of `defaultClipboardRunner`. Lets unit tests assert that the
   * right value reached the clipboard without spawning pbcopy/wl-copy.
   */
  clipboardRunner?: ClipboardRunner
}
