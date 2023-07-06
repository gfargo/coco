/**
 * Extract the path from a file path string.
 * @param {string} filePath - The full file path.
 * @returns {string} The path portion of the file path.
 */
export function getPathFromFilePath(filePath: string): string {
  return filePath.split('/').slice(0, -1).join('/')
}
