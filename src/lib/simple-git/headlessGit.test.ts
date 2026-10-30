import { applyHeadlessGitEnv, interactiveGitEnv, resetHeadlessGitEnvForTests } from './headlessGit'

const noConfig = { readSshCommandConfig: () => undefined }

describe('applyHeadlessGitEnv (#2199, #2201)', () => {
  it('disables git terminal prompts and optional index locks', () => {
    const env: NodeJS.ProcessEnv = {}
    applyHeadlessGitEnv(env, noConfig)
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GCM_INTERACTIVE).toBe('never')
    expect(env.GIT_OPTIONAL_LOCKS).toBe('0')
    expect(env.GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes')
  })

  it('keeps a user-set GIT_SSH_COMMAND and appends BatchMode once', () => {
    const env: NodeJS.ProcessEnv = { GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' }
    applyHeadlessGitEnv(env, noConfig)
    applyHeadlessGitEnv(env, noConfig)
    expect(env.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work -o BatchMode=yes')
  })

  it('does not duplicate a BatchMode the user already set', () => {
    const env: NodeJS.ProcessEnv = { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -p 2222' }
    applyHeadlessGitEnv(env, noConfig)
    expect(env.GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes -p 2222')
  })

  it('overrides a user value that would let git prompt on the tty', () => {
    const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '1' }
    applyHeadlessGitEnv(env, noConfig)
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  // Final review: GIT_SSH_COMMAND outranks both core.sshCommand and GIT_SSH,
  // so setting it unconditionally replaced the user's SSH setup.
  it('extends a configured core.sshCommand instead of replacing it', () => {
    const env: NodeJS.ProcessEnv = {}
    applyHeadlessGitEnv(env, { readSshCommandConfig: () => 'ssh -J bastion -i ~/.ssh/work' })
    expect(env.GIT_SSH_COMMAND).toBe('ssh -J bastion -i ~/.ssh/work -o BatchMode=yes')
  })

  it('leaves a user-set GIT_SSH program alone', () => {
    const env: NodeJS.ProcessEnv = { GIT_SSH: '/usr/local/bin/plink' }
    applyHeadlessGitEnv(env, { readSshCommandConfig: () => 'ssh -J bastion' })
    expect(env.GIT_SSH_COMMAND).toBeUndefined()
    expect(env.GIT_SSH).toBe('/usr/local/bin/plink')
  })
})

describe('interactiveGitEnv', () => {
  const saved = { ...process.env }
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
    resetHeadlessGitEnvForTests()
  })

  it('undoes the guards for processes the user drives, keeping their own values', () => {
    delete process.env.GIT_TERMINAL_PROMPT
    delete process.env.GIT_OPTIONAL_LOCKS
    delete process.env.GCM_INTERACTIVE
    process.env.GIT_SSH_COMMAND = 'ssh -i ~/.ssh/work'
    applyHeadlessGitEnv(process.env, noConfig)
    expect(process.env.GIT_TERMINAL_PROMPT).toBe('0')

    const env = interactiveGitEnv()
    expect(env.GIT_TERMINAL_PROMPT).toBeUndefined()
    expect(env.GIT_OPTIONAL_LOCKS).toBeUndefined()
    expect(env.GCM_INTERACTIVE).toBeUndefined()
    expect(env.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work')
    expect(env.PATH).toBe(process.env.PATH)
  })

  it('returns the env unchanged when no guards were applied', () => {
    expect(interactiveGitEnv(process.env)).toBe(process.env)
  })
})
