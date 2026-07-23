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
  noVerify: boolean
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
    default: false,
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
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
