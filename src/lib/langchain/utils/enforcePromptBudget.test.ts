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
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}\n\n[1 file across 1 directory omitted for length]\n`
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
    expect(result.variables.summary).toContain('[1 file across 1 directory omitted for length]')
    expect(
      tokenizer(await prompt.format(renderVariables(result.variables)))
    ).toBeLessThanOrEqual(maxTokens - responseTokenReserve)
  })

  it('counts every dropped directory block, not just its file bullets, in the omission marker', async () => {
    const bigBlockBodyA = `* changes in "/generated"\n\n${FILE_BULLET_PREFIX}${'x'.repeat(300)}\n\n${FILE_BULLET_PREFIX}${'x'.repeat(300)}\n\n`
    const bigBlockBodyB = `* changes in "/vendor"\n\n${FILE_BULLET_PREFIX}${'z'.repeat(300)}\n\n`
    const smallBlockBody = `* changes in "/src/auth"\n\n${FILE_BULLET_PREFIX}fix auth token bug\n\n`
    const summary =
      `${DIRECTORY_BLOCK_SEPARATOR}${bigBlockBodyA}` +
      `${DIRECTORY_BLOCK_SEPARATOR}${bigBlockBodyB}` +
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}`

    const additionalContext = 'context'
    const responseTokenReserve = 10

    // The budget that exactly fits the small block (plus omission marker) alone,
    // forcing both big blocks (3 file bullets across 2 directories) to be dropped.
    const smallBlockOnlySummary =
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}\n\n[3 files across 2 directories omitted for length]\n`
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
    expect(result.variables.summary).toContain('[3 files across 2 directories omitted for length]')
  })

  it('marks the omission even when the dropped block has zero file bullets', async () => {
    const bigBlockBody = `* changes in "/generated"\n\n${'x'.repeat(300)}\n\n`
    const smallBlockBody = `* changes in "/src/auth"\n\n${FILE_BULLET_PREFIX}fix auth token bug\n\n`
    const summary =
      `${DIRECTORY_BLOCK_SEPARATOR}${bigBlockBody}` +
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}`

    const additionalContext = 'context'
    const responseTokenReserve = 10

    // The dropped big block has no FILE_BULLET_PREFIX lines, so the omission
    // count is "0 files" -- but the directory itself was still dropped and
    // must still be reported.
    const smallBlockOnlySummary =
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}\n\n[0 files across 1 directory omitted for length]\n`
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
    expect(result.variables.summary).toContain('[0 files across 1 directory omitted for length]')
  })

  it('char-slices the last remaining block when it alone still exceeds budget after dropping others', async () => {
    const bigBlockBody = `* changes in "/generated"\n\n${FILE_BULLET_PREFIX}${'x'.repeat(300)}\n\n`
    const smallBlockBody = `* changes in "/src/auth"\n\n${FILE_BULLET_PREFIX}${'y'.repeat(100)}\n\n`
    const summary =
      `${DIRECTORY_BLOCK_SEPARATOR}${bigBlockBody}` +
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}`

    const additionalContext = 'context'
    const responseTokenReserve = 10
    const marker = '\n\n[1 file across 1 directory omitted for length]\n'

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
    expect(result.variables.summary).toContain('[1 file across 1 directory omitted for length]')
    expect(result.variables.summary.length).toBeLessThan(fullLastBlockCandidate.length)
    expect(result.variables.summary).not.toContain('y'.repeat(100))
    expect(
      tokenizer(await prompt.format(renderVariables(result.variables)))
    ).toBeLessThanOrEqual(tokenBudget)
  })

  it('never leaves an unpaired surrogate when char-slicing lands mid-emoji', async () => {
    const additionalContext = 'context'
    const responseTokenReserve = 10
    const prefix = 'a'.repeat(40)
    const summary = `${prefix}😀${'b'.repeat(40)}`

    const overheadTokenCount = tokenizer(
      await prompt.format({ summary: '', additional_context: additionalContext })
    )
    // Force the binary search to land exactly one code unit past `prefix`,
    // i.e. right after the emoji's lone high surrogate.
    const tokenBudget = overheadTokenCount + prefix.length + 1
    const maxTokens = tokenBudget + responseTokenReserve

    const result = await enforcePromptBudget({
      prompt,
      variables: { summary, additional_context: additionalContext },
      tokenizer,
      maxTokens,
      responseTokenReserve,
    })

    expect(result.truncated).toBe(true)
    expect(result.variables.summary).toBe(prefix)
    expect(/[\uD800-\uDBFF]$/.test(result.variables.summary)).toBe(false)
    expect(() => JSON.stringify(result.variables.summary)).not.toThrow()
  })

  it('throws when even an empty last block plus the omission marker exceeds budget', async () => {
    const bigBlockBody =
      `* changes in "/generated"\n\n${FILE_BULLET_PREFIX}${'x'.repeat(300)}\n\n` +
      `${FILE_BULLET_PREFIX}${'y'.repeat(300)}\n\n`
    const smallBlockBody = `* changes in "/src/auth"\n\n${FILE_BULLET_PREFIX}fix auth token bug\n\n`
    const summary =
      `${DIRECTORY_BLOCK_SEPARATOR}${bigBlockBody}` +
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}`

    const additionalContext = 'context'
    const responseTokenReserve = 10
    const marker = '\n\n[2 files omitted for length]\n'

    const emptyLastBlockTokenCount = tokenizer(
      await prompt.format({
        summary: `${DIRECTORY_BLOCK_SEPARATOR}${marker}`,
        additional_context: additionalContext,
      })
    )
    // A budget too tight even for an empty last block plus the marker -- the
    // binary search can never find a fitting candidate, so it must throw
    // rather than silently returning the unchecked initial (over-budget) guess.
    const tokenBudget = emptyLastBlockTokenCount - 1
    const maxTokens = tokenBudget + responseTokenReserve

    await expect(
      enforcePromptBudget({
        prompt,
        variables: { summary, additional_context: additionalContext },
        tokenizer,
        maxTokens,
        responseTokenReserve,
      })
    ).rejects.toThrow('Rendered prompt exceeds token budget')
  })

  it('never leaves an unpaired surrogate when the last-block char-slice fallback lands mid-emoji', async () => {
    const bigBlockBody = `* changes in "/generated"\n\n${FILE_BULLET_PREFIX}${'x'.repeat(300)}\n\n`
    const prefix = `* changes in "/src/auth"\n\n${FILE_BULLET_PREFIX}${'a'.repeat(20)}`
    const smallBlockBody = `${prefix}😀${'a'.repeat(20)}\n\n`
    const summary =
      `${DIRECTORY_BLOCK_SEPARATOR}${bigBlockBody}` +
      `${DIRECTORY_BLOCK_SEPARATOR}${smallBlockBody}`

    const additionalContext = 'context'
    const responseTokenReserve = 10
    const marker = '\n\n[1 file across 1 directory omitted for length]\n'

    const emptyLastBlockTokenCount = tokenizer(
      await prompt.format({
        summary: `${DIRECTORY_BLOCK_SEPARATOR}${marker}`,
        additional_context: additionalContext,
      })
    )
    // Force the binary search to land exactly one code unit past `prefix`,
    // i.e. right after the emoji's lone high surrogate.
    const tokenBudget = emptyLastBlockTokenCount + prefix.length + 1
    const maxTokens = tokenBudget + responseTokenReserve

    const result = await enforcePromptBudget({
      prompt,
      variables: { summary, additional_context: additionalContext },
      tokenizer,
      maxTokens,
      responseTokenReserve,
    })

    expect(result.truncated).toBe(true)
    expect(result.variables.summary).toContain(prefix)
    expect(/[\uD800-\uDBFF]$/.test(result.variables.summary.replace(marker.trimEnd(), ''))).toBe(
      false
    )
    expect(() => JSON.stringify(result.variables.summary)).not.toThrow()
  })
})
