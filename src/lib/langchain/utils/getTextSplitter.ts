import {
  RecursiveCharacterTextSplitter,
  RecursiveCharacterTextSplitterParams
} from 'langchain/text_splitter';

/**
 * Get Recursive Character Text Splitter
 * 
 * @param options
 * @returns
 */
export function getTextSplitter(
  options: Partial<RecursiveCharacterTextSplitterParams> = {}
): RecursiveCharacterTextSplitter {
  return new RecursiveCharacterTextSplitter(options);
}
