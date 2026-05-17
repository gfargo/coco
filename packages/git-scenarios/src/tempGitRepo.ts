import { mkdir, mkdtemp, rm, writeFile as writeFileContent } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { simpleGit, SimpleGit } from 'simple-git'

export type TempGitRepo = {
  path: string
  git: SimpleGit
  writeFile: (filePath: string, content: string) => Promise<void>
  commitAll: (message: string) => Promise<void>
  cleanup: () => Promise<void>
}

export async function createTempGitRepo(): Promise<TempGitRepo> {
  const path = await mkdtemp(join(tmpdir(), 'coco-git-test-'))
  const git = simpleGit(path)

  await git.init()
  await git.addConfig('user.name', 'Coco Test')
  await git.addConfig('user.email', 'coco@example.com')
  await git.addConfig('commit.gpgsign', 'false')
  await git.raw(['checkout', '-b', 'main'])

  const writeFile = async (filePath: string, content: string) => {
    const absolutePath = join(path, filePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFileContent(absolutePath, content)
  }

  return {
    path,
    git,
    writeFile,
    commitAll: async (message: string) => {
      await git.add('.')
      await git.commit(message)
    },
    cleanup: async () => {
      await rm(path, { recursive: true, force: true })
    },
  }
}
