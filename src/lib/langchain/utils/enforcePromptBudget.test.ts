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

  it('never truncates mid-line — snaps back to the last complete line (#1843)', async () => {
    // Reproduces the issue's real failure mode: a naive character-prefix
    // binary search cut mid-identifier (`handler184` truncated to
    // `handler18`), handing the model a syntactically broken diff tail.
    const line1 = 'line one of the diff'
    const line2 = 'const handler184 = (input: Request) => {'
    const line3 = 'more content that must not survive'
    const summary = `${line1}\n${line2}\n${line3}`
    const additionalContext = 'context'
    const responseTokenReserve = 10

    const overheadTokenCount = tokenizer(
      await prompt.format({ summary: '', additional_context: additionalContext })
    )
    // Force the binary search to land mid-identifier: "const handler18",
    // one character short of the real "handler184" identifier.
    const cutPoint = line1.length + 1 + 'const handler18'.length
    const tokenBudget = overheadTokenCount + cutPoint
    const maxTokens = tokenBudget + responseTokenReserve

    const result = await enforcePromptBudget({
      prompt,
      variables: { summary, additional_context: additionalContext },
      tokenizer,
      maxTokens,
      responseTokenReserve,
    })

    expect(result.truncated).toBe(true)
    // The naive cut (verified by the pre-fix binary search landing exactly
    // here) would have handed the model "...\nconst handler18" — a broken
    // identifier. The snap must remove it entirely, not just leave it.
    expect(result.variables.summary).not.toContain('handler1')
    expect(result.variables.summary).not.toContain('const')
    expect(result.variables.summary).not.toContain(line3)
    // What survives is exactly the last complete line, nothing partial.
    expect(result.variables.summary).toBe(line1)
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

  it('throws honoring the reserve even when overhead alone is within maxTokens but not the request budget', async () => {
    // overhead ("Instructions\n\nContext: " + "context") = 30 tokens, which sits
    // strictly between tokenBudget (35 - 10 = 25) and maxTokens (35). Before the
    // fix, only `overhead > maxTokens` was checked, so this case would have
    // silently returned an empty summary with no room reserved for the response.
    await expect(
      enforcePromptBudget({
        prompt,
        variables: {
          summary: 'diff',
          additional_context: 'context',
        },
        tokenizer,
        maxTokens: 35,
        responseTokenReserve: 10,
      })
    ).rejects.toThrow('Rendered prompt exceeds token budget before adding summary: 30 > 25')
  })

  it('ships a prompt untouched when it lands exactly on the reserve-adjusted budget', async () => {
    const variables = {
      summary: 'd',
      additional_context: 'c',
    }

    const result = await enforcePromptBudget({
      prompt,
      variables,
      tokenizer,
      maxTokens: 30,
      responseTokenReserve: 5,
    })

    expect(result.truncated).toBe(false)
    expect(result.variables).toEqual(variables)
    expect(result.promptTokenCount).toBe(25)
  })

  it('trims a prompt one token over the reserve-adjusted budget instead of waving it through', async () => {
    const result = await enforcePromptBudget({
      prompt,
      variables: {
        summary: 'dd',
        additional_context: 'c',
      },
      tokenizer,
      maxTokens: 30,
      responseTokenReserve: 5,
    })

    expect(result.truncated).toBe(true)
    expect(tokenizer(await prompt.format(renderVariables(result.variables)))).toBeLessThanOrEqual(25)
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
    // Ends in a newline so the line-boundary snap (#1843) is a no-op here —
    // this test is about surrogate-pair safety specifically, not the snap.
    const prefix = `${'a'.repeat(39)}\n`
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
    // .trimEnd() (pre-existing, unrelated to the line-boundary snap) strips
    // the trailing newline `prefix` was given to make the snap a no-op.
    expect(result.variables.summary).toBe(prefix.trimEnd())
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
    // Ends in a newline so the line-boundary snap (#1843) is a no-op here —
    // this test is about surrogate-pair safety specifically, not the snap.
    const prefix = `* changes in "/src/auth"\n\n${FILE_BULLET_PREFIX}${'a'.repeat(19)}\n`
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
