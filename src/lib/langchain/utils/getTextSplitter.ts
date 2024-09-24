import {
  RecursiveCharacterTextSplitter,
  type RecursiveCharacterTextSplitterParams,
} from '@langchain/textsplitters'

/**
 * Get Recursive Character Text Splitter
 *
 * @param options
 * @returns
 */
export function getTextSplitter(
  options: Partial<RecursiveCharacterTextSplitterParams> = {}
): RecursiveCharacterTextSplitter {
  return new RecursiveCharacterTextSplitter(options)
}
