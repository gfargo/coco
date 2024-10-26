import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(chalk.gray(`Created directory: ${dir}`))
  }
}

async function generateBuildInfo(): Promise<void> {
  console.log(chalk.blue.bold('⚡ Generating build info...'))
  
  try {
    const tsPath = path.join('src/lib/buildInfo.ts')
    ensureDirectoryExists(tsPath)
    
    const tsContent = `// This file is auto-generated - DO NOT EDIT
/* eslint-disable */

/**
 * Current build version from package.json
 */
export const BUILD_VERSION = ${JSON.stringify(process.env.npm_package_version)}
`

    fs.writeFileSync(tsPath, tsContent)
    console.log(chalk.green('✓'), `Generated ${chalk.cyan('buildInfo.ts')}`)

    console.log(chalk.green.bold('\n✨ Build info generation completed successfully!'))
  } catch (error) {
    console.error(chalk.red.bold('\n❌ Build info generation failed:'))
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
generateBuildInfo().catch((error) => {
  console.error(chalk.red.bold('Unexpected error:'), error)
  process.exit(1)
})