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

  if (!file.includes(separator)) {
    return {
      filePath: file.trim(),
      oldFilePath: undefined,
    }
  }

  // git compresses renames sharing a prefix and/or suffix as `prefix{old => new}suffix`,
  // e.g. `src/{old => new}/file.ts`. The braced segment can be anywhere in the string, so
  // parse prefix/suffix around the braces rather than splitting on the separator first.
  const braceMatch = file.match(/^(.*)\{(.*)\}(.*)$/)

  if (braceMatch) {
    const [, prefix, braceContent, suffix] = braceMatch
    const [oldPart, newPart] = braceContent.split(separator)

    return {
      filePath: normalizeSlashes(prefix + (newPart ?? '').trim() + suffix),
      oldFilePath: normalizeSlashes(prefix + (oldPart ?? '').trim() + suffix),
    }
  }

  const [oldFilePathWithRoot, filePath] = file.split(separator)

  return {
    filePath: (filePath ?? '').trim(),
    oldFilePath: oldFilePathWithRoot.trim(),
  }
}

/** Collapses doubled slashes left behind when the old or new side of a brace is empty (e.g. `src/{ => sub}/file.ts`). */
function normalizeSlashes(path: string): string {
  return path.replace(/\/{2,}/g, '/')
}
