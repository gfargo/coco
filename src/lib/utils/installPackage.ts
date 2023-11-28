import { execPromise } from './execPromise'

type InstallPackageInput = {
  name: string
  flags?: string[]
  cwd?: string
}

/**
 * Installs a package using npm.
 *
 * @param {InstallPackageInput} options - The options for installing the package.
 * @returns {Promise<boolean>} - A promise that resolves to true if the package is installed successfully, false otherwise.
 */
export async function installNpmPackage({
  name,
  flags = [],
  cwd = process.cwd(),
}: InstallPackageInput) {
  const { stdout, stderr } = await execPromise(`npm i ${name} ${flags.join(' ')} --yes`, { cwd })

  if (stderr) {
    console.error(`Execution error: ${stderr}`)
    return false
  }

  console.log(stdout)
  console.error(stderr)

  return true
}
