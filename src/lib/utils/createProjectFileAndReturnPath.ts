import fs from 'fs'
import { findProjectRoot } from './findProjectRoot'

export async function createProjectFileAndReturnPath(fileName: string, contents?: string) {
  const projectRoot = findProjectRoot(process.cwd())
  const configFile = `${projectRoot}/${fileName}`

  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, contents || '')
  }

  return configFile
}
