import { logSuccess } from './logSuccess'

type ResultHandler = (result: string) => Promise<void>

type HandleResultInput = {
  result: string
  interactiveHandler?: ResultHandler
  mode: 'interactive' | 'stdout'
}

export async function handleResult({ result, mode, interactiveHandler }: HandleResultInput) {
  switch (mode) {
    case 'interactive':
      if (interactiveHandler) {
        await interactiveHandler(result)
      } else {
        console.warn('No result handler provided for interactive mode.')
        logSuccess()
      }
      break
    case 'stdout':
    default:
      process.stdout.write(result, 'utf8')
      break
  }

  process.exit(0)
}
