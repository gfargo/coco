import { PromptTemplate } from '@langchain/core/prompts'
import { enforcePromptBudget } from './enforcePromptBudget'
import {
  DIRECTORY_BLOCK_SEPARATOR,
  FILE_BULLET_PREFIX,
} from '../../parsers/default/utils/summarizeDiffs'

describe('enforcePromptBudget', () => {
  const tokenizer = (text: string) => text.length
  const renderVariables = (variables: Record<string, string>) => ({
    summary: variables.summary,
    additional_context: variables.additional_context,
  })
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
    expect(tokenizer(await prompt.format(renderVariables(result.variables)))).toBeLessThanOrEqual(70)
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

  it('drops a large mechanical directory block before a small pointed one, and marks the omission', async () => {
    const bigBlockBody = `* changes in "/generated"\n\n${FILE_BULLET_PREFIX}${'x'.repeat(300)}\n\n`
    const smallBlockBody = `* changes in "/src/auth"\n\n${FILE_BULLET_PREFIX}fix auth token bug\n\n`
    const summary =
      `${DIRECTORY_BLOCK_SEPARATOR}${bigBlockBody}` +
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}`

    const additionalContext = 'context'
    const responseTokenReserve = 10

    // The budget that exactly fits the small block (plus omission marker) alone.
    const smallBlockOnlySummary =
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}\n\n[1 files omitted for length]\n`
    const smallBlockOnlyTokenCount = tokenizer(
      await prompt.format({ summary: smallBlockOnlySummary, additional_context: additionalContext })
    )
    const maxTokens = smallBlockOnlyTokenCount + responseTokenReserve

    const result = await enforcePromptBudget({
      prompt,
      variables: { summary, additional_context: additionalContext },
      tokenizer,
      maxTokens,
      responseTokenReserve,
    })

    expect(result.truncated).toBe(true)
    expect(result.variables.summary).toContain('fix auth token bug')
    expect(result.variables.summary).not.toContain('x'.repeat(300))
    expect(result.variables.summary).toContain('[1 files omitted for length]')
    expect(
      tokenizer(await prompt.format(renderVariables(result.variables)))
    ).toBeLessThanOrEqual(maxTokens - responseTokenReserve)
  })

  it('char-slices the last remaining block when it alone still exceeds budget after dropping others', async () => {
    const bigBlockBody = `* changes in "/generated"\n\n${FILE_BULLET_PREFIX}${'x'.repeat(300)}\n\n`
    const smallBlockBody = `* changes in "/src/auth"\n\n${FILE_BULLET_PREFIX}${'y'.repeat(100)}\n\n`
    const summary =
      `${DIRECTORY_BLOCK_SEPARATOR}${bigBlockBody}` +
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}`

    const additionalContext = 'context'
    const responseTokenReserve = 10
    const marker = '\n\n[1 files omitted for length]\n'

    const emptyLastBlockTokenCount = tokenizer(
      await prompt.format({
        summary: `${DIRECTORY_BLOCK_SEPARATOR}${marker}`,
        additional_context: additionalContext,
      })
    )
    const fullLastBlockCandidate = `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}${marker}`
    const fullLastBlockTokenCount = tokenizer(
      await prompt.format({ summary: fullLastBlockCandidate, additional_context: additionalContext })
    )

    // Pick a budget strictly between "empty block + marker" and "full block + marker"
    // so the remaining block must be partially (not fully) char-sliced.
    const tokenBudget =
      emptyLastBlockTokenCount +
      Math.floor((fullLastBlockTokenCount - emptyLastBlockTokenCount) / 2)
    const maxTokens = tokenBudget + responseTokenReserve

    const result = await enforcePromptBudget({
      prompt,
      variables: { summary, additional_context: additionalContext },
      tokenizer,
      maxTokens,
      responseTokenReserve,
    })

    expect(result.truncated).toBe(true)
    expect(result.variables.summary).toContain('[1 files omitted for length]')
    expect(result.variables.summary.length).toBeLessThan(fullLastBlockCandidate.length)
    expect(result.variables.summary).not.toContain('y'.repeat(100))
    expect(
      tokenizer(await prompt.format(renderVariables(result.variables)))
    ).toBeLessThanOrEqual(tokenBudget)
  })
})
