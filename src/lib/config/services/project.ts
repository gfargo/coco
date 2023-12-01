import * as fs from 'fs'
import { Config } from '../types'

/**
 * Load project config
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadProjectJsonConfig(config: Config): Config {
  // TODO: Add validation based of JSON schema?
  // @see https://github.com/acornejo/jjv
  if (fs.existsSync('.coco.config.json')) {
    const projectConfig = JSON.parse(fs.readFileSync('.coco.config.json', 'utf-8')) as Config
    config = { ...config, ...projectConfig }
  }
  return config
}

export const appendToProjectJsonConfig = (filePath: string, config: Partial<Config>) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '{}')
  }

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        $schema: 'https://git-co.co/schema.json',
        ...config,
      },
      null,
      2
    )
  )
}
