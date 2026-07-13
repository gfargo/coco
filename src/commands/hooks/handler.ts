import { CommandHandler } from '../../lib/types'
import { emitJson } from '../../lib/ui/emitJson'
import { commandExit } from '../../lib/utils/commandExit'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { HooksArgv } from './config'
import { getHooksStatus, installHooks, uninstallHooks } from './manageHooks'

export const handler: CommandHandler<HooksArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)

  switch (argv.action) {
    case 'install': {
      const result = await installHooks({ git, force: Boolean(argv.force) })
      if (argv.json) {
        emitJson(result)
      } else {
        logger.log(result.message, { color: result.ok ? 'green' : 'red' })
      }
      if (!result.ok) {
        commandExit(1)
      }
      return
    }
    case 'uninstall': {
      const result = await uninstallHooks({ git })
      if (argv.json) {
        emitJson(result)
      } else {
        logger.log(result.message, { color: result.ok ? 'green' : 'yellow' })
      }
      if (!result.ok) {
        commandExit(1)
      }
      return
    }
    case 'status': {
      const status = await getHooksStatus({ git })
      if (argv.json) {
        emitJson(status)
        return
      }
      logger.log(status.message, {
        color: status.installed && status.managedByCoco ? 'green' : 'yellow',
      })
      return
    }
    default: {
      logger.error(`Unknown hooks action: ${String(argv.action)}`, { color: 'red' })
      commandExit(1)
    }
  }
}
