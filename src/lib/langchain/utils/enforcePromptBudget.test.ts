import { PromptTemplate } from '@langchain/core/prompts'
import { enforcePromptBudget } from './enforcePromptBudget'

describe('enforcePromptBudget', () => {
  const tokenizer = (text: string) => text.length
  const prompt = new PromptTemplate({
    template: 'Instructions\n{summary}\nContext: {additional_context}',
    inputVariables: ['summary', 'additional_context'],
  })

  it('keeps variables unchanged when the rendered prompt fits', async () => {
    const variables = {
      summary: 'small diff',
      additional_context: 'ticket context',
    }

    const result = await enforcePromptBudget({
      prompt,
      variables,
      tokenizer,
      maxTokens: 100,
      responseTokenReserve: 10,
    })

    expect(result.truncated).toBe(false)
    expect(result.variables).toEqual(variables)
  })

  it('trims summary when prompt overhead pushes the rendered prompt over budget', async () => {
    const result = await enforcePromptBudget({
      prompt,
      variables: {
        summary: 'x'.repeat(200),
        additional_context: 'context',
      },
      tokenizer,
      maxTokens: 80,
      responseTokenReserve: 10,
    })

    expect(result.truncated).toBe(true)
    expect(result.variables.summary.length).toBeLessThan(200)
    expect(tokenizer(await prompt.format(result.variables))).toBeLessThanOrEqual(70)
  })

  it('throws when prompt overhead alone exceeds the budget', async () => {
    await expect(
      enforcePromptBudget({
        prompt,
        variables: {
          summary: 'diff',
          additional_context: 'context'.repeat(20),
        },
        tokenizer,
        maxTokens: 20,
        responseTokenReserve: 10,
      })
    ).rejects.toThrow('Rendered prompt exceeds token budget')
  })
})
