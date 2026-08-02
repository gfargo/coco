import { Arguments, Argv, Options } from 'yargs';
import { z } from 'zod';
import { getCommandUsageHeader } from '../../lib/ui/helpers';
import { BaseCommandOptions } from '../types';

export interface CommitOptions extends BaseCommandOptions {
  interactive: boolean
  openInEditor: boolean
  ignoredFiles: string[]
  ignoredExtensions: string[]
  withPreviousCommits: number
  conventional: boolean
  includeBranchName: boolean
  noVerify?: boolean
  /** Free-text appended to the end of the generated commit message. */
  append?: string
  /** Append the ticket ID parsed from the branch name to the message. */
  appendTicket?: boolean
  /** Extra contextual information injected into the prompt. */
  additional?: string
  split?: boolean
  plan?: boolean
  apply?: boolean
  /**
   * When true, throw if the split planner exhausts its retry budget
   * with an invalid plan (pre-#1005 behaviour) instead of falling
   * back to a single-group plan that combines every staged file into
   * one commit. Default: false (fallback is enabled).
   */
  strictSplit?: boolean
  /**
   * Only pass basic "git status" result instead of providing the entire
   * diff to the LLM (reduces token usage for large changesets).
   */
  noDiff?: boolean
  /** Overrides the configured `language` for this invocation only. */
  language?: string
  /**
   * Generate a commit message draft and print it to stdout without
   * committing. Used by the `prepare-commit-msg` hook installed via
   * `coco hooks install` (#1591) to fill a plain `git commit`'s message.
   */
  printMessage?: boolean
}

export type CommitArgv = Arguments<CommitOptions>

const conventionalTypeRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:/;

// Regular commit message schema with basic validation
export const CommitMessageResponseSchema = z.object({
  title: z.string().describe("Title of the commit message"),
  body: z.string().describe("Body of the commit message"),
}).describe("Object with commit message 'title' and 'body'");

// Conventional commit message schema with strict formatting rules
export const ConventionalCommitMessageResponseSchema = z.object({
  title: z.string()
    .max(50, "Title must be 50 characters or less")
    .refine(
      (title) => conventionalTypeRegex.test(title),
      "Title must follow Conventional Commits format (e.g., 'feat: add new feature' or 'fix(scope): fix bug')"
    ).describe("Title of the commit message"),
  body: z.string().describe("Body of the commit message")
    // .max(280, "Body must be 280 characters or less"),
}).describe("Object with Conventional Commit message 'title' and 'body' adhering to Conventional Commits specification");

export type CommitMessageResponse = z.infer<typeof CommitMessageResponseSchema>;

export const command = 'commit'

/**
 * Command line options via yargs
 */
export const options = {
  i: {
    alias: 'interactive',
    description: 'Toggle interactive mode',
    type: 'boolean',
  },
  ignoredFiles: {
    description: 'Ignored files',
    type: 'array',
  },
  ignoredExtensions: {
    description: 'Ignored extensions',
    type: 'array',
  },
  append: {
    description: 'Add content to the end of the generated commit message',
    type: 'string',
  },
  appendTicket: {
    // No short alias: `-t` is reserved for `--tag` (changelog) to keep the
    // letter consistent across commands (#1245).
    description: 'Append ticket ID from branch name to the commit message',
    type: 'boolean',
  },
  additional: {
    description: 'Add extra contextual information to the prompt',
    type: 'string',
    alias: 'a',
  },
  withPreviousCommits: {
    description: 'Include previous commits as context (specify number of commits, 0 for none)',
    type: 'number',
    default: 0,
    alias: 'p',
  },
  conventional: {
    description: 'Generate commit message in Conventional Commits format',
    type: 'boolean',
    default: false,
    alias: 'c',
  },
  includeBranchName: {
    description: 'Include the current branch name in the commit prompt for context',
    type: 'boolean',
  },
  noDiff: {
    description: 'Only pass basic "git status" result instead of providing entire diff',
    type: 'boolean',
    default: false,
  },
  noVerify: {
    description: 'Skip pre-commit and commit-msg hooks (passes --no-verify to git commit)',
    type: 'boolean',
    alias: 'n',
  },
  language: {
    description: 'Write the commit message in this language, overriding the configured `language`.',
    type: 'string',
  },
  split: {
    description: 'Group staged changes into multiple commits — shows the plan and prompts to apply',
    type: 'boolean',
    default: false,
  },
  plan: {
    description: 'Print the split plan without prompting to apply (plan-only mode)',
    type: 'boolean',
    default: false,
  },
  apply: {
    description: 'Apply a split plan immediately without confirmation',
    type: 'boolean',
    default: false,
  },
  strictSplit: {
    description:
      'Fail loudly if the split planner exhausts its retry budget with an invalid plan (otherwise falls back to a single combined commit).',
    type: 'boolean',
    default: false,
  },
  printMessage: {
    description:
      'Generate a commit message draft and print it to stdout without committing (used by the `coco hooks install` prepare-commit-msg hook).',
    type: 'boolean',
    default: false,
  },
  // `--json` is a global flag (see src/index.ts). On `commit` it behaves like
  // `--print-message` — generate a draft, don't commit — but emits the result
  // as structured `{ "title", "body" }` for machine consumers.
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .options(options)
    .check((argv) => {
      const a = argv as {
        json?: boolean
        split?: boolean
        plan?: boolean
        apply?: boolean
        strictSplit?: boolean
        printMessage?: boolean
        _: Array<string | number>
      }
      const positionalSplit = a._.includes('split')
      const splitMode = Boolean(a.split || a.plan || positionalSplit)

      // handler.ts:58 already rejects `--json` combined with `--split`,
      // `--plan`, or `--apply` — emitting a structured `emitJson({ error })`
      // payload for machine consumers instead of exiting via yargs' plain-text
      // `.fail()` handler. `.check()` runs during yargs parsing, strictly
      // before the handler, so any of the rules below that only fire because
      // one of those three flags is set must defer to that handler-level
      // check instead of throwing here first. Rules that don't depend on
      // split/plan/apply (e.g. `--strict-split` with none of them set) aren't
      // covered by that handler guard, so they still validate here even
      // under `--json`.
      const jsonHandledByCommand = Boolean(a.json && (a.split || a.plan || a.apply))
      if (jsonHandledByCommand) {
        return true
      }

      if (a.plan && a.apply) {
        throw new Error('--plan and --apply cannot be combined — --plan previews, --apply commits.')
      }
      if (a.printMessage && (a.split || a.plan || a.apply || a.strictSplit)) {
        throw new Error('--print-message cannot be combined with --split, --plan, --apply, or --strict-split.')
      }
      if (a.apply && !splitMode) {
        throw new Error('--apply requires --split (it applies a split plan).')
      }
      if (a.strictSplit && !splitMode) {
        throw new Error('--strict-split requires --split or --plan.')
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
}
