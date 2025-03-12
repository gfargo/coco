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
}

export type CommitArgv = Arguments<CommitOptions>

const conventionalTypeRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?:/;

// Regular commit message schema with basic validation
export const CommitMessageResponseSchema = z.object({
  title: z.string(),
  body: z.string(),
});

// Conventional commit message schema with strict formatting rules
export const ConventionalCommitMessageResponseSchema = z.object({
  title: z.string()
    .max(50, "Title must be 50 characters or less")
    .refine(
      (title) => conventionalTypeRegex.test(title),
      "Title must follow Conventional Commits format (e.g., 'feat: add new feature' or 'fix(scope): fix bug')"
    ),
  body: z.string()
    .max(280, "Body must be 280 characters or less"),
});

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
    description: 'Append ticket ID from branch name to the commit message',
    type: 'boolean',
    alias: 't',
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
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
