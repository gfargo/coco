import { PromptTemplate } from '@langchain/core/prompts'

/**
 * Template for generating git commit messages based on code changes
 *
 * Variables:
 * - summary: Contains the diff summary of staged changes
 * - format_instructions: Instructions for the output format (JSON with title and body)
 * - additional_context: Optional user-provided context to guide the commit message generation
 * - commit_history: Optional history of previous commits for context
 * - branch_name_context: String containing formatted branch name (or empty if disabled)
 */
export const template = `Write informative git commit message, in the imperative, based on the diffs & file changes provided in the "Diff Summary" section.
Commit Messages must have a short description that is less than 50 characters and a longer detailed summary around 300 characters, the shorter and more concise the better.

Please follow the guidelines below when writing your commit message:

- Write concisely using an informal tone
- Avoid phrases like "this commit", "this change", "this function", etc. Instead refer to the function, variable, or class by name
- Avoid referencing specific files names or long paths in the commit message
- DO NOT include any diffs or file changes in the commit message
- Wrap variable, class, function, components, and dependency names in back ticks e.g. \`variable\`

""""""
{{summary}}
""""""

{{branch_name_context}}

{{commitlint_rules_context}}

{{format_instructions}}

{{commit_history}}

{{additional_context}}
`

// Define the variables that will be passed to the prompt template
const inputVariables = ['summary', 'format_instructions', 'additional_context', 'commit_history', 'branch_name_context', 'commitlint_rules_context']

export const COMMIT_PROMPT = new PromptTemplate({
  template,
  inputVariables,
})

export const CONVENTIONAL_TEMPLATE = `Generate a commit message that strictly adheres to the Conventional Commits specification. Follow these rules precisely:

1. Type Selection:
   - Choose ONE of these types based on the changes:
     * feat: A new feature
     * fix: A bug fix
     * docs: Documentation only changes
     * style: Changes that don't affect the code's meaning (white-space, formatting, etc)
     * refactor: Code changes that neither fix a bug nor add a feature
     * perf: Code changes that improve performance
     * test: Adding missing tests or correcting existing tests
     * build: Changes that affect the build system or external dependencies
     * ci: Changes to CI configuration files and scripts
     * chore: Other changes that don't modify src or test files
     * revert: Reverts a previous commit

2. Format Requirements:
   - Title format: <type>(<optional-scope>): <description>
   - Title must be 50 characters or less
   - Description should be in imperative mood (e.g., "add" not "adds/added")
   - Body MUST be 280 characters or less
   - Separate body from title with a blank line
   - Body should explain the motivation for the change and contrast it with previous behavior

3. Scope Guidelines:
   - If the change affects a specific component/area, include it as a scope
   - Scope should be a noun in parentheses (e.g., (parser), (ui), (config))
   - Omit scope if the change is broad or affects multiple areas

CRITICAL: You must respond with ONLY valid JSON. All string values must be properly quoted.

Based on the following diff summary, generate a conventional commit message that follows these rules exactly:

""""""
{{summary}}
""""""

{{branch_name_context}}

{{commitlint_rules_context}}

{{format_instructions}}

{{commit_history}}

{{additional_context}}`

const conventionalInputVariables = [
  'summary',
  'additional_context',
  'commit_history',
  'format_instructions',
  'branch_name_context',
  'commitlint_rules_context',
]

export const CONVENTIONAL_COMMIT_PROMPT = new PromptTemplate({
  template: CONVENTIONAL_TEMPLATE,
  inputVariables: conventionalInputVariables,
})
