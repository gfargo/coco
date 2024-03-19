import fs from 'fs'
import path from 'path'

/**
 * Checks if a package is installed in a project.
 * 
 * @param packageName - The name of the package to check.
 * @param projectPath - The path to the project.
 * @returns True if the package is installed, false otherwise.
 */
export function isPackageInstalled(packageName: string, projectPath: string) {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

    const dependencies = packageJson.dependencies || {}
    const devDependencies = packageJson.devDependencies || {}

    return dependencies.hasOwnProperty(packageName) || devDependencies.hasOwnProperty(packageName)
  } catch (error) {
    console.error(`Error checking package installation: ${(error as Error).message}`)
    return false
  }
}
