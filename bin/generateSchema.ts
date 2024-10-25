import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as TJS from 'ts-json-schema-generator';

interface SchemaConfig extends TJS.Config {
  outputDir?: string;
  skipTypeCheck: boolean;
}

const CONFIG: SchemaConfig = {
  tsconfig: 'tsconfig.json',
  type: 'ConfigWithServiceObject',
  schemaId: 'http://git-co.co/schema.json',
  skipTypeCheck: false,
  outputDir: '.'
}

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(chalk.gray(`Created directory: ${dir}`))
  }
}

async function generateSchema(config: SchemaConfig): Promise<void> {
  console.log(chalk.blue.bold('⚡ Generating JSON Schema...'))
  
  try {
    // Validate config
    if (!fs.existsSync(config?.tsconfig || 'tsconfig.json')) {
      throw new Error(`TSConfig file not found: ${config.tsconfig}`)
    }

    // Generate schema
    console.log(chalk.gray(`Using type: ${config.type}`))
    const generator = TJS.createGenerator(config)
    const schema = generator.createSchema(config.type)
    
    if (!schema) {
      throw new Error('Failed to generate schema')
    }

    const schemaString = JSON.stringify(schema, null, 2)
    const outputDir = config.outputDir || '.'

    // Write schema.json
    const schemaPath = path.join(outputDir, 'schema.json')
    ensureDirectoryExists(schemaPath)
    fs.writeFileSync(schemaPath, schemaString)
    console.log(chalk.green('✓'), `Generated ${chalk.cyan('schema.json')}`)

    // Write schema.ts
    const tsPath = path.join(outputDir, 'src/lib/schema.ts')
    ensureDirectoryExists(tsPath)
    
    const tsContent = `// This file is auto-generated - DO NOT EDIT
/* eslint-disable */

/**
 * Schema ID for JSON validation
 */
export const SCHEMA_PUBLIC_URL = ${JSON.stringify(schema.$id)}

/**
 * Current build version from package.json
 */
export const BUILD_VERSION = ${JSON.stringify(process.env.npm_package_version)}

/**
 * Generated JSON schema
 */
export const schema = ${schemaString} as const`

    fs.writeFileSync(tsPath, tsContent)
    console.log(chalk.green('✓'), `Generated ${chalk.cyan('schema.ts')}`)

    console.log(chalk.green.bold('\n✨ Schema generation completed successfully!'))
  } catch (error) {
    console.error(chalk.red.bold('\n❌ Schema generation failed:'))
    if (error instanceof Error) {
      console.error(chalk.red(`  ${error.message}`))
      if (error.stack) {
        console.error(chalk.gray(error.stack.split('\n').slice(1).join('\n')))
      }
    } else {
      console.error(chalk.red(String(error)))
    }
    process.exit(1)
  }
}

// Execute the generator
generateSchema(CONFIG).catch((error) => {
  console.error(chalk.red.bold('Unexpected error:'), error)
  process.exit(1)
})