/**
 * Shared types for the Ink workstation runtime.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` so per-surface modules
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
import type { SubmoduleOverview } from '../../git/submoduleData'
import type { GitOperationOverview } from '../../git/operationData'
import type { ProviderOverview } from '../../git/providerData'
import type { IssueDetail } from '../../git/issueDetailData'
import type { IssueListOverview } from '../../git/issuesListData'
import type { PullRequestDetail } from '../../git/pullRequestDetailData'
import type { PullRequestOverview } from '../../git/pullRequestData'
import type { PullRequestListOverview } from '../../git/pullRequestListData'
import type { ReflogOverview } from '../../git/reflogData'
import type { StashOverview } from '../../git/stashData'
import type { TagOverview } from '../../git/tagData'
import type { WorktreeOverview } from '../../git/statusData'
import type { WorktreeOverview as WorktreeListOverview } from '../../git/worktreeData'
import type { ClipboardRunner } from '../../git/historyActions'
import type { LogArgv } from '../../commands/log/config'
import type { GitLogRow } from '../../commands/log/data'
import type { LogInkState, LogInkView } from '../../workstation/runtime/inkViewModel'
import type { LogInkInputKey } from '../../workstation/runtime/inkInput'
import type { LogInkContextStatus } from '../chrome/context'
import type { LogInkTheme, LogInkThemeConfig } from '../chrome/theme'

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
  /**
   * Multi-PR triage list (#882). Hydrated on entry to the
   * `pull-request-triage` view. Distinct from `pullRequest` (single,
   * current-branch) so the two surfaces don't clobber each other and
   * the disk cache (`coco prs`) can stay separate from the
   * `gh pr view` cache the single-PR panel uses.
   */
  pullRequestList?: PullRequestListOverview
  /**
   * Issues triage list (#882). Hydrated on entry to the `issues` view.
   */
  issueList?: IssueListOverview
  /**
   * Per-issue detail cache keyed by issue number (#882 inspector
   * hydration). Filled on demand when the user rests the cursor on
   * an issue row in the triage list. Cursoring back to a
   * previously-fetched issue shows the cached entry immediately.
   * The list fetcher deliberately omits bodies / comments — they're
   * expensive to fetch + render, so the lazy hydration keeps the
   * list snappy.
   */
  issueDetailByNumber?: Map<number, IssueDetail>
  /**
   * Per-PR detail cache keyed by pull-request number (#882
   * inspector hydration). Mirrors `issueDetailByNumber` — fetched
   * via `gh pr view <#>` and cached per session.
   */
  pullRequestDetailByNumber?: Map<number, PullRequestDetail>
  reflog?: ReflogOverview
  stashes?: StashOverview
  /**
   * Submodule overview (#884). Carries per-submodule metadata
   * (name / path / pinned commit / status flag / tracking branch /
   * url) parsed from `.gitmodules` + `git submodule status`. The
   * inspector and diff renderers use this to format submodule rows
   * with real context instead of raw `Subproject commit` lines.
   */
  submodules?: SubmoduleOverview
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

/**
 * The bundle every `render*Surface` helper needs (#1136). Collapses the
 * eight values that were threaded as positional props through
 * `app → mainPanel → render<View>Surface` into one object so adding a
 * surface-wide value stops meaning "thread one more arg through every
 * signature".
 *
 * This is the render-side sibling of `LogInkRuntimeContextValue`: it
 * carries the render primitives (`h` / `components`) and the
 * layout-derived `bodyRows` / `width` the surfaces actually consume,
 * rather than the whole `layout` / `dispatch` the React Context holds.
 * Surfaces with extra needs (diff hunks, file previews, spinner frames)
 * take this bundle plus their own explicit params.
 */
export type SurfaceRenderContext = {
  h: typeof ReactTypes.createElement
  components: LogInkComponents
  state: LogInkState
  context: LogInkContext
  contextStatus: LogInkContextStatus
  bodyRows: number
  width: number
  theme: LogInkTheme
}

export type LogInkComponentDeps = LogInkRuntime & {
  appLabel: string
  git: SimpleGit
  /** Drives P4.3 idle status-line tip rotation when truthy. */
  idleTipsEnabled?: boolean
  /**
   * Toggle the history surface's date bucket headers. Defaults to
   * `true` upstream in `inkRuntime.ts`; the property remains optional
   * so test seams and other callers can omit it (the surface then
   * sees `undefined` which it treats as "off" — caller-friendly
   * default since tests rarely care about bucket rendering).
   */
  dateBucketingEnabled?: boolean
  /**
   * Enable tree-sitter syntax highlighting in the diff view (#1117
   * follow-up). Optional; defaults to ON upstream in `inkRuntime.ts`
   * unless `logTui.syntaxHighlight` is `false`. Highlighting degrades
   * gracefully (no grammar / non-ASCII / parse error → plain line).
   */
  syntaxHighlightEnabled?: boolean
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
   * The original theme *config* (preset + ascii/borderStyle/colors) the
   * built `theme` was derived from. The theme picker rebuilds the live
   * theme from this (`createLogInkTheme({ ...themeConfig, preset })`) so a
   * preview preserves ascii/border/noColor semantics. Optional — absent in
   * older callers, in which case the picker just falls back to `theme`.
   */
  themeConfig?: LogInkThemeConfig
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
