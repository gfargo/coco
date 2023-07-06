export function getTruncatedFilePath(filePath: string, maxLength = 46): string {
  return `${filePath.slice(0, maxLength)}${filePath.length > maxLength ? '...' : ''}`
}
