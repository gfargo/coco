import { logSuccess } from './logSuccess'

type ResultHandler = (result: string) => Promise<void>

type HandleResultInput = {
  result: string
  interactiveModeCallback?: ResultHandler
  mode: 'interactive' | 'stdout'
}

export async function handleResult({ result, mode, interactiveModeCallback }: HandleResultInput) {
  switch (mode) {
    case 'interactive':
      if (interactiveModeCallback) {
        await interactiveModeCallback(result)
      } else {
        console.warn('No result handler provided for interactive mode.')
        logSuccess()
      }
      break
    case 'stdout':
    default:
      // Ensure we write the result to stdout in non-interactive mode
      process.stdout.write(result + '\n', 'utf8')
      break
  }

  if (process.env.NODE_ENV !== 'test') {
    process.exit(0)
  }
}
