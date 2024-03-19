export interface ParsedFilePaths {
  filePath: string
  oldFilePath?: string
}

/**
 * Parses a file string and returns the parsed file paths.
 * If the file string contains a separator, it splits the string into root path, file path, and old file path.
 * If the file string doesn't contain the separator, it assumes the file string itself is the file path and old file path is undefined.
 * @param file The file string to parse.
 * @returns The parsed file paths.
 */
export function parseFileString(file: string): ParsedFilePaths {
  const separator = ' => '

  if (file.includes(separator)) {
    const [oldFilePathWithRoot, filePath] = file.split(separator)

    const [rootPath, oldFilePath] = oldFilePathWithRoot.split('{')

    return {
      filePath: rootPath + filePath.trim().replace('{', '').replace('}', ''),
      oldFilePath: rootPath + oldFilePath.trim().replace('{', '').replace('}', ''),
    }
  } else {
    return {
      filePath: file.trim(),
      oldFilePath: undefined,
    }
  }
}
