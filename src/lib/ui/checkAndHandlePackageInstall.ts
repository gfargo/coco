import { confirm } from '@inquirer/prompts'
import { findProjectRoot } from '../utils/findProjectRoot'
import { installNpmPackage } from '../utils/installPackage'
import { isPackageInstalled } from '../utils/isPackageInstalled'
import { Logger } from '../utils/logger'

// TODO: QoL improvement to import this from `package.json`
const packageName = 'git-coco'

type CheckAndHandlePackageInstallationInput = {
  global?: boolean
  logger: Logger
}

export async function checkAndHandlePackageInstallation({
  global = false,
  logger,
}: CheckAndHandlePackageInstallationInput) {
  try {
    // Global installation
    if (global) {
      logger.startSpinner(`Installing '${packageName}' globally...`, { color: 'blue' })
      await installNpmPackage({ name: packageName, flags: ['-g'] })
      logger.stopSpinner(`Installed '${packageName}' globally`)
      return
    }

    // Project level installation
    const projectRoot = findProjectRoot(process.cwd())
    let shouldInstall = false
    if (isPackageInstalled(packageName, projectRoot)) {
      shouldInstall = await confirm({
        message: `'${packageName}' is already installed in '${projectRoot}/package.json', would you like to update?`,
        default: shouldInstall,
      })
    } else {
      shouldInstall = true
    }

    if (!shouldInstall) {
      return
    }

    logger.startSpinner(`Installing '${packageName}' in project...`, { color: 'blue' })
    await installNpmPackage({ name: packageName, cwd: projectRoot, flags: ['--save-dev'] })
    logger.stopSpinner(`Installed '${packageName}' in project`)
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`)
  }
}
