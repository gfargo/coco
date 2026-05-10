import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  getOnboardingMarkerPath,
  hasSeenOnboarding,
  markOnboardingSeen,
} from './onboarding'

describe('onboarding marker', () => {
  let tempCacheDir: string
  let originalXdgCacheHome: string | undefined

  beforeEach(() => {
    tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-onboarding-'))
    originalXdgCacheHome = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = tempCacheDir
  })

  afterEach(() => {
    if (originalXdgCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdgCacheHome
    }
    fs.rmSync(tempCacheDir, { recursive: true, force: true })
  })

  it('reports unseen on a fresh cache', () => {
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('persists the marker after markOnboardingSeen', () => {
    markOnboardingSeen()
    expect(hasSeenOnboarding()).toBe(true)
    expect(fs.existsSync(getOnboardingMarkerPath())).toBe(true)
  })

  it('creates the cache directory if it does not exist', () => {
    const markerPath = getOnboardingMarkerPath()
    expect(fs.existsSync(path.dirname(markerPath))).toBe(false)
    markOnboardingSeen()
    expect(fs.existsSync(path.dirname(markerPath))).toBe(true)
  })

  it('routes through XDG_CACHE_HOME when set', () => {
    expect(getOnboardingMarkerPath().startsWith(tempCacheDir)).toBe(true)
  })
})
