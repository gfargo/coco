import GPT3NodeTokenizer from "gpt3-tokenizer"

/**
 * Wrapper around GPT3NodeTokenizer to handle default export.
 * 
 * @see https://github.com/botisan-ai/gpt3-tokenizer/issues/18
 * 
 * @returns {GPT3NodeTokenizer} The GPT3NodeTokenizer instance.
 */
export const getTokenizer = () => {
  let tokenizer: GPT3NodeTokenizer

  // eslint-disable-next-line
  // @ts-ignore
  if (GPT3NodeTokenizer.default) {
    // eslint-disable-next-line
    // @ts-ignore
    tokenizer = new GPT3NodeTokenizer.default({ type: 'gpt3' })
  } else {
    tokenizer = new GPT3NodeTokenizer({ type: 'gpt3' })
  }

  return tokenizer
}

