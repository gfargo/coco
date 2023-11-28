import fs from 'fs'
import path from 'path'

/**
 * Finds the project root directory starting from the given current directory.
 * It checks if the `.git` directory or `package.json` file exists in the current directory or any of its parent directories.
 * If found, it returns the path to the project root directory.
 * If not found, it throws an error.
 *
 * @param currentDir - The current directory to start searching from.
 * @returns The path to the project root directory.
 * @throws Error if the project root directory cannot be found.
 */
export function findProjectRoot(currentDir: string) {
  const root = path.parse(currentDir).root

  while (currentDir !== root) {
    if (
      fs.existsSync(path.join(currentDir, '.git')) ||
      fs.existsSync(path.join(currentDir, 'package.json'))
    ) {
      return currentDir
    }

    currentDir = path.dirname(currentDir)
  }

  throw new Error('Unable to find project root. Are you in the right directory?')
}
