import { findProjectRoot } from './findProjectRoot'
import { PROJECT_CONFIG_CANDIDATES } from '../config/utils/scopedConfigFile'

// `.env` was removed as a project-config storage option (#1623): the
// writer emitted un-prefixed flattened names the env loader never read
// (COCO_* prefix expected), and nothing loaded a `.env` file into
// process.env in the first place — the option produced a file coco could
// never consume. `.coco.json` is the recommended, actually-working format.
export type ProjectConfigFileName = (typeof PROJECT_CONFIG_CANDIDATES)[number]

export async function getProjectConfigFilePath(configFileName: ProjectConfigFileName) {
  const projectRoot = findProjectRoot(process.cwd())
  return `${projectRoot}/${configFileName}`
}
