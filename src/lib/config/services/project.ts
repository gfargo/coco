import * as fs from 'fs'
import { Config } from '../types'
import { SCHEMA_PUBLIC_URL, schema } from '../../schema'
import { ajv } from '../../ajv'

const validate = ajv.compile(schema)

/**
 * Load project config
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadProjectJsonConfig<ConfigType = Config>(config: Partial<Config>) {
  if (fs.existsSync('.coco.config.json')) {
    const projectConfig = JSON.parse(
      fs.readFileSync('.coco.config.json', 'utf-8')
    ) as Partial<Config>

    config = { ...config, ...projectConfig } as Config

    const isProjectConfigValid = validate(config)
    if (!isProjectConfigValid) {
      throw new Error('Invalid project config', { cause: validate.errors })
    }
  }
  return config as ConfigType
}

export const appendToProjectJsonConfig = (filePath: string, config: Partial<Config>) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '{}')
  }

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        $schema: SCHEMA_PUBLIC_URL,
        ...config,
      },
      null,
      2
    )
  )
}
