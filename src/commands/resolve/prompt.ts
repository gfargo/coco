/**
 * Prompt for `coco resolve explain` — describes each conflict region without
 * proposing or writing any resolution text, unlike the resolution workflow's
 * `CONFLICT_PROMPT_TEMPLATE`.
 */
export const EXPLAIN_PROMPT_TEMPLATE = `You are explaining git merge conflicts in the file \`{path}\` during a {operation}.

For each conflict region below, describe what each side was trying to do and why they conflict. Do NOT propose a resolution or write any replacement code — only explain.

Rules:
- Return one explanation per region, numbered to match.
- \`oursIntent\` and \`theirsIntent\` each describe, in one or two sentences, what that side of the conflict is trying to accomplish.
- \`conflictNature\` explains in one or two sentences why the two sides conflict (e.g. same line changed differently, one side removed what the other modified, semantically incompatible changes).

{conflicts}

{format_instructions}`
