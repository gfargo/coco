import { BaseCommandOptions } from '../../commands/types'
import { LogInkThemeConfig } from '../../workstation/chrome/theme'
import { LLMService } from '../langchain/types'

type BaseConfig = {
  /**
   * The output destination for the generated result.
   * - 'stdout': Prints the result to the standard output.  This is the default behavior.
   * - 'interactive': Provides an interactive prompt for editing the result & committing the changes.
   *
   * @default 'stdout'
   */
  mode: 'stdout' | 'interactive'

  /**
   * Whether to generate commit messages in Conventional Commits format.
   * When enabled, commit messages will follow the Conventional Commits specification.
   *
   * @see https://www.conventionalcommits.org/
   * @default false
   */
  conventionalCommits?: boolean

  /**
   * Enable verbose logging.
   *
   * @default false
   */
  verbose?: boolean

  /**
   * Open the commit message in an editor for editing before proceeding.
   *
   * @default false
   */
  openInEditor?: boolean

  /**
   * The prompt text used for generating results.
   */
  prompt?: string

  /**
   * The prompt text used specifically for generating summaries of large files.
   */
  summarizePrompt?: string

  /**
   * An array of file paths or patterns to be ignored during processing.
   *
   * Note: This is a list of patterns interpreted by the `minimatch` library.
   * @see https://github.com/isaacs/minimatch
   *
   * @example ['package-lock.json', 'node_modules']
   * @default ['package-lock.json', contents of .gitignore, contents of .ignore]
   */
  ignoredFiles?: string[]

  /**
   * An array of file extensions to be ignored during processing.
   *
   * @default ['.map', '.lock']
   */
  ignoredExtensions?: string[]

  /**
   * Default git branch for the repository.
   *
   * @default 'main'
   */
  defaultBranch: string

  /**
   * Whether to include the current branch name in the commit prompt for context.
   * When enabled, the current git branch name will be included in the prompt.
   *
   * @default true
   */
  includeBranchName?: boolean

  /**
   * Language for AI-generated output (commit messages, changelogs, recaps,
   * reviews) — free text, e.g. `'German'` or `'es'`. Conventional Commits
   * type/scope tokens (`feat`, `fix(parser)`, ...) always stay in English;
   * only the description/body localizes. Unset generates in English, the
   * existing default.
   *
   * @default undefined
   */
  language?: string

  /**
   * The AI CLI tool to use for auto-fixing review issues.
   * Must match a registered adapter key (e.g. "codex", "claude", "gemini").
   * When unset, the auto-fix action is disabled.
   */
  autoFixTool?: string

  /**
   * Additional key-value flags passed to the auto-fix CLI tool.
   * Keys are flag names (without leading dashes); values are flag values.
   * @example { "model": "o4-mini", "approval-mode": "auto-edit" }
   */
  autoFixToolOptions?: Record<string, string>

  /**
   * Interactive log TUI settings.
   */
  logTui?: {
    /**
     * Theme settings for `coco log -i`.
     */
    theme?: LogInkThemeConfig

    /**
     * Rotate short usage tips through the status line when the TUI has been
     * idle for >10s. Off by default so power users aren't distracted.
     */
    idleTips?: boolean

    /**
     * Group adjacent commits in the history surface under shared section
     * headers (`── Today ──`, `── Yesterday ──`, `── April 2026 ──`) and
     * drop the per-row date column in favor of the headers. On by default
     * because the bucketed view gives stronger temporal orientation at
     * a glance and the freed cells go to the commit subject. Flip off if
     * you prefer a date column on every row.
     *
     * Bucketing automatically suppresses itself while a search filter is
     * active (results aren't chronological), regardless of this setting.
     *
     * @default true
     */
    dateBucketing?: boolean

    /**
     * Syntax-highlight code in the diff view using tree-sitter. Built-in
     * languages (TypeScript / TSX / JavaScript) highlight immediately;
     * others lazy-download their grammar on first use — see
     * `TREE_SITTER_MANIFEST` (src/lib/parsers/default/__tree_sitter__/manifest.ts)
     * for the current supported-language list. On by default. Highlighting
     * degrades gracefully — unsupported languages, non-ASCII lines, and
     * parse failures fall back to the plain add/remove coloring — so the
     * only reason to disable it is preference or a very low-color
     * terminal. Set to `false` to opt out.
     *
     * @default true
     */
    syntaxHighlight?: boolean
  }

  /**
   * Multi-repo workspace surface settings (`coco workspace`).
   */
  workspace?: {
    /**
     * Directories to scan for git repositories. Each entry may use a
     * `~` prefix; resolved against the user's home directory. When
     * omitted (and no `--root` flag is passed), the workspace scans the
     * current working directory — so a bare `coco` / `coco ws` discovers
     * repos wherever you launched it. Set this to pin a fixed tree (e.g.
     * `["~/code"]`) regardless of where you run from.
     *
     * (No static `@default` — the effective default is the runtime cwd.)
     */
    roots?: string[]

    /**
     * Repositories outside the configured roots that should still
     * appear in the workspace view. Useful for one-off projects kept
     * somewhere other than the main `code` tree. Entries may use a
     * `~` prefix.
     *
     * @default []
     */
    knownRepos?: string[]

    /**
     * Maximum depth to recurse into each configured root when looking
     * for `.git/` directories. Stops descending as soon as a directory
     * is identified as a repo.
     *
     * @default 3
     */
    maxDepth?: number
  }

  /**
   * Local AI usage statistics. Everything here stays on this machine and is
   * never transmitted.
   */
  telemetry?: {
    /**
     * Keep a local, cross-run record of AI usage — prompt-token estimate and
     * latency per task / model / repo — that `coco doctor --cost` reads. The
     * ledger is a plain JSONL file under the cache directory and never leaves
     * the machine; it records no prompt, diff, or code content.
     *
     * `coco init` writes this preference, and on the first interactive command
     * with no preference set anywhere coco defaults it on and prints a one-time
     * notice (non-interactive / CI runs stay off). The `COCO_USAGE_LOG`
     * environment variable overrides this setting either way: set it to `0` /
     * `false` to force recording off, or to `1` / a file path to force it on.
     * Unset everywhere means off.
     *
     * @default false
     */
    usage?: boolean
  }

  /**
   * Map self-hosted git remote hosts to a forge so coco talks to the right CLI.
   * coco auto-detects github.com, gitlab.com, bitbucket.org, codeberg.org, and
   * hosts whose name contains `gitlab` / `github` / `bitbucket` / `gitea` /
   * `forgejo` / `codeberg`. For vanity hostnames that carry none of those
   * words (e.g. `git.acme.com`), set the mapping here so detection and
   * dispatch work.
   *
   * @example { "git.acme.com": "gitea", "code.internal": "github", "bb.corp.com": "bitbucket" }
   */
  forgeHosts?: Record<string, 'github' | 'gitlab' | 'bitbucket' | 'gitea'>
}

export type ConfigWithServiceObject = BaseConfig &
  Partial<BaseCommandOptions> & {
    service: LLMService
  }

export type Config = ConfigWithServiceObject
