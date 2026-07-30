import { PromptTemplate } from '@langchain/core/prompts'

import { CHANGELOG_PROMPT } from '../../commands/changelog/prompt'
import { COMMIT_PROMPT, CONVENTIONAL_COMMIT_PROMPT } from '../../commands/commit/prompt'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { RECAP_PROMPT } from '../../commands/recap/prompt'
import { REVIEW_PROMPT } from '../../commands/review/prompt'

const TEMPLATES: { name: string; template: PromptTemplate }[] = [
  { name: 'COMMIT_PROMPT', template: COMMIT_PROMPT },
  { name: 'CONVENTIONAL_COMMIT_PROMPT', template: CONVENTIONAL_COMMIT_PROMPT },
  { name: 'REVIEW_PROMPT', template: REVIEW_PROMPT },
  { name: 'CHANGELOG_PROMPT', template: CHANGELOG_PROMPT },
  { name: 'RECAP_PROMPT', template: RECAP_PROMPT },
]

// Mirrors how `executeStructured`/`generateCommitDraft` actually render these
// templates: `getPrompt` rebuilds them with `templateFormat: 'mustache'` so
// `{{var}}` placeholders interpolate. The raw exported PromptTemplate objects
// default to f-string format, where `{{var}}` is a literal escaped brace.
function renderableFor(template: PromptTemplate): PromptTemplate {
  return getPrompt({
    template: template.template as string,
    variables: template.inputVariables,
    fallback: template,
  })
}

describe('conventions_context prompt wiring (#1956)', () => {
  it.each(TEMPLATES)('$name declares conventions_context as an input variable', ({ template }) => {
    expect(template.inputVariables).toContain('conventions_context')
  })

  it.each(TEMPLATES)('$name renders with project conventions supplied', async ({ template }) => {
    const variables = Object.fromEntries(
      template.inputVariables.map((key) => [
        key,
        key === 'conventions_context'
          ? 'Follow these project conventions where they apply:\n\n## AGENTS.md\n\nHouse style.'
          : 'placeholder',
      ])
    )

    const rendered = await renderableFor(template).format(variables)
    expect(rendered).toContain('House style.')
  })

  it.each(TEMPLATES)('$name renders an empty conventions_context without throwing', async ({ template }) => {
    const variables = Object.fromEntries(
      template.inputVariables.map((key) => [key, key === 'conventions_context' ? '' : 'placeholder'])
    )

    await expect(renderableFor(template).format(variables)).resolves.toEqual(expect.any(String))
  })
})
