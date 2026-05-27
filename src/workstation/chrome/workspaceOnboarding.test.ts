import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  getWorkspaceOnboardingMarkerPath,
  hasSeenWorkspaceOnboarding,
  markWorkspaceOnboardingSeen,
} from './workspaceOnboarding'

describe('workspaceOnboarding', () => {
  let tmpHome: string
  let originalXdg: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-ws-onboarding-'))
    originalXdg = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = tmpHome
  })

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdg
    }
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('reports unseen until the marker is written', () => {
    expect(hasSeenWorkspaceOnboarding()).toBe(false)
    markWorkspaceOnboardingSeen()
    expect(hasSeenWorkspaceOnboarding()).toBe(true)
    expect(fs.existsSync(getWorkspaceOnboardingMarkerPath())).toBe(true)
  })

  it('uses a distinct marker filename so the ui surface stays independent', () => {
    expect(getWorkspaceOnboardingMarkerPath()).toMatch(/workspace-onboarding\.seen$/)
  })

  it('swallows write failures silently', () => {
    const blocker = path.join(tmpHome, 'blocker')
    fs.writeFileSync(blocker, '')
    process.env.XDG_CACHE_HOME = blocker
    expect(() => markWorkspaceOnboardingSeen()).not.toThrow()
  })
})
