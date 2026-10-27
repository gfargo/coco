import { applyHeadlessGitEnv } from './headlessGit'

describe('applyHeadlessGitEnv (#2199, #2201)', () => {
  it('disables git terminal prompts and optional index locks', () => {
    const env: NodeJS.ProcessEnv = {}
    applyHeadlessGitEnv(env)
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GCM_INTERACTIVE).toBe('never')
    expect(env.GIT_OPTIONAL_LOCKS).toBe('0')
    expect(env.GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes')
  })

  it('keeps a user-set GIT_SSH_COMMAND and appends BatchMode once', () => {
    const env: NodeJS.ProcessEnv = { GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' }
    applyHeadlessGitEnv(env)
    applyHeadlessGitEnv(env)
    expect(env.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work -o BatchMode=yes')
  })

  it('does not duplicate a BatchMode the user already set', () => {
    const env: NodeJS.ProcessEnv = { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -p 2222' }
    applyHeadlessGitEnv(env)
    expect(env.GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes -p 2222')
  })

  it('overrides a user value that would let git prompt on the tty', () => {
    const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '1' }
    applyHeadlessGitEnv(env)
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })
})
