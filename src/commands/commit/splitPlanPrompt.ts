import { PromptTemplate } from '@langchain/core/prompts'

/**
 * Inline conventional-commits ruleset that gets spliced into the
 * split prompt's `commit_message_rules` slot when the user has
 * conventional commits enabled in config or via `--conventional`.
 *
 * This is the same ruleset used by the regular `coco commit`
 * conventional path (`CONVENTIONAL_TEMPLATE` in `./prompt.ts`),
 * adapted to apply per-group inside the split JSON output: every
 * `title` field in the plan must follow the spec, not just the
 * overall commit message.
 */
export const CONVENTIONAL_COMMITS_RULES = `Each group's "title" MUST follow the Conventional Commits 1.0.0 spec:
- Format: <type>(<scope>)<!>: <subject>
- type is one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- scope is optional but encouraged when it adds clarity (file/module name)
- "!" before ":" marks a breaking change
- subject is imperative mood, no trailing period, <72 chars
- For breaking changes, the body must include a "BREAKING CHANGE:" footer explaining the break.`

export const COMMIT_SPLIT_PROMPT = PromptTemplate.fromTemplate(`You are helping split staged git changes into a small sequence of coherent commits.

Return ONLY valid JSON matching this schema:
{{
  "groups": [
    {{
      "title": "commit subject line",
      "body": "commit body (optional)",
      "rationale": "why these files belong together (internal; not the commit message)",
      "files": ["relative/path.ts"],
      "hunks": ["relative/path.ts::hunk-1"]
    }}
  ]
}}

Structural rules:
- Every staged file MUST be assigned exactly once across all groups, either via "files" OR via every one of its hunk IDs (never both).
- A SINGLE file is EITHER fully claimed via "files" (its name appears in one group's "files" array) OR fully claimed via "hunks" (every one of its hunk IDs is split across one or more groups). NEVER mix the two modes for the same file. If a file appears in any group's "files" array, that file's hunk IDs MUST NOT appear in any group's "hunks" array.
- If you assign any hunk for a file, you MUST assign EVERY hunk for that file across the groups — partial coverage is invalid.
- Do not list the same file in "files" of more than one group, and do not assign the same hunk ID to more than one group.
- Only use file paths listed in the staged file inventory. Do not invent files.
- Only use hunk IDs LITERALLY copied from the "Staged hunk inventory" section below. Do not invent or guess hunk IDs.
- If the hunk inventory says "No hunk-level inventory available" then EVERY group's "hunks" array MUST be empty (use only "files"). Do not write hunk IDs like "path::hunk-1" when no hunk inventory exists — those are not valid.
- Prefer 2-5 commits unless the changes are truly all one topic.
- Order the groups in the sequence they would logically be built — foundational changes first, consumers after. If group B uses a symbol, function, type, or file introduced in group A, A MUST appear before B in the array. The applier commits in array order, so this order becomes the git history. Example: a "feat: add helpers" group that introduces \`formatX()\` must come before a "feat: wire helpers into renderer" group that calls \`formatX()\`, even if the staged diff is presented in the opposite order. When two groups have no dependency relationship, prefer the one closer to a "scaffold" (types, config, new files) before the one closer to a "use site" (existing files modified to consume the new code).

Commit message style:
- Write each "title" in the imperative mood ("add", not "added"), under 72 chars.
- Avoid phrases like "this commit" / "this change" — refer to functions, variables, or classes by name in backticks.
- "body" is optional; when present, wrap at 72 chars and describe WHY the change exists, not what (the diff shows what).
{commit_message_rules}

{branch_name_context}

{commitlint_rules_context}

Staged file inventory:
{file_inventory}

Staged hunk inventory:
{hunk_inventory}

Condensed staged diff:
{summary}

Additional context:
{additional_context}

Feedback on previous attempt (fix every item before responding):
{previous_attempt_feedback}`)
