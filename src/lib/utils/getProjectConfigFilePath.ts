import { findProjectRoot } from './findProjectRoot'

export type ProjectConfigFileName = '.coco.config.json' | '.env'

export async function getProjectConfigFilePath(configFileName: ProjectConfigFileName) {
  const projectRoot = findProjectRoot(process.cwd())
  return `${projectRoot}/${configFileName}`
}
