import { existsSync } from 'fs'
import { spawnSync } from 'child_process'

const wikiDir = '.wiki'
const wikiRemote = 'git@github.com:gfargo/coco.wiki.git'

type WikiCommand = 'clone' | 'pull' | 'push' | 'status' | 'help'

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  process.exit(result.status ?? 0)
}

function ensureWikiCheckout(): void {
  if (!existsSync(`${wikiDir}/.git`)) {
    console.error(`Wiki checkout not found at ${wikiDir}. Run: npm run wiki:clone`)
    process.exit(1)
  }
}

function printHelp(): void {
  console.log(`Usage: tsx bin/wiki.ts <command>

Commands:
  clone   Clone the GitHub wiki into ${wikiDir}
  help    Show this help
  status  Show wiki checkout status
  pull    Pull wiki updates with --ff-only
  push    Push committed wiki updates
`)
}

const command = (process.argv[2] || 'help') as WikiCommand

switch (command) {
  case 'clone':
    if (existsSync(`${wikiDir}/.git`)) {
      console.log(`Wiki checkout already exists at ${wikiDir}`)
      process.exit(0)
    }
    run('git', ['clone', wikiRemote, wikiDir])
    break
  case 'status':
    ensureWikiCheckout()
    run('git', ['-C', wikiDir, 'status', '--short', '--branch'])
    break
  case 'pull':
    ensureWikiCheckout()
    run('git', ['-C', wikiDir, 'pull', '--ff-only'])
    break
  case 'push':
    ensureWikiCheckout()
    run('git', ['-C', wikiDir, 'push'])
    break
  case 'help':
  default:
    printHelp()
    break
}
