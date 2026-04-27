import { simpleGit, SimpleGit } from 'simple-git'
import { commandExit } from '../utils/commandExit'

/**
 * Retrieves the SimpleGit instance for the repository.
 * @returns {SimpleGit} The SimpleGit instance.
 */
export const getRepo = () => {
  let git: SimpleGit
  
  try {
    git = simpleGit()
  } catch (e) {
    console.log('Error initializing git repo', e)
    commandExit(1)
  }

  return git
}
