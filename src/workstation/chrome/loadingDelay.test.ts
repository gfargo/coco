import {
  LOADING_TEXT_DELAY_MS,
  setLoadingDelayEnabled,
  settleLoadingEpisode,
  shouldShowLoadingText,
} from './loadingDelay'
import { formatLogInkLoading } from './surfaceStates'

afterEach(() => setLoadingDelayEnabled(false))

describe('delayed loading text (#2166)', () => {
  it('shows text immediately when the delay is off, which is the default for tests and non-TUI callers', () => {
    expect(shouldShowLoadingText(0)).toBe(true)
    expect(formatLogInkLoading({ resource: 'branches' })).toBe('Loading branches…')
  })

  describe('with the delay on', () => {
    beforeEach(() => setLoadingDelayEnabled(true))

    it('hides the text on the first render of an episode and says how long until it shows', () => {
      expect(shouldShowLoadingText(1000)).toBe(false)
      expect(settleLoadingEpisode(1000)).toEqual({ requested: true, remainingMs: LOADING_TEXT_DELAY_MS })
    })

    it('shows the text once the episode is old enough, not before', () => {
      shouldShowLoadingText(1000)
      settleLoadingEpisode(1000)
      shouldShowLoadingText(1000 + LOADING_TEXT_DELAY_MS - 1)
      expect(settleLoadingEpisode(1000 + LOADING_TEXT_DELAY_MS - 1)).toEqual({ requested: true, remainingMs: 1 })
      expect(shouldShowLoadingText(1000 + LOADING_TEXT_DELAY_MS - 1)).toBe(false)
      expect(shouldShowLoadingText(1000 + LOADING_TEXT_DELAY_MS)).toBe(true)
      expect(settleLoadingEpisode(1000 + LOADING_TEXT_DELAY_MS)).toEqual({ requested: true, remainingMs: 0 })
    })

    it('keeps the text visible for the rest of a long episode, however sparse the renders are', () => {
      shouldShowLoadingText(0)
      settleLoadingEpisode(0)
      expect(shouldShowLoadingText(5000)).toBe(true)
      settleLoadingEpisode(5000)
      expect(shouldShowLoadingText(60_000)).toBe(true)
    })

    it('never shows text for a load that finishes inside the delay', () => {
      shouldShowLoadingText(0)
      settleLoadingEpisode(0)
      // The load finished: the next render asks for no loading text.
      expect(settleLoadingEpisode(30)).toEqual({ requested: false, remainingMs: 0 })
    })

    it('starts a fresh episode, hidden again, after one ends', () => {
      shouldShowLoadingText(0)
      settleLoadingEpisode(0)
      shouldShowLoadingText(500)
      settleLoadingEpisode(500)
      expect(shouldShowLoadingText(600)).toBe(true)
      settleLoadingEpisode(600)
      // A commit where nobody asked for loading text ends the episode.
      expect(settleLoadingEpisode(700)).toEqual({ requested: false, remainingMs: 0 })
      expect(shouldShowLoadingText(800)).toBe(false)
      expect(settleLoadingEpisode(800)).toEqual({ requested: true, remainingMs: LOADING_TEXT_DELAY_MS })
    })

    it('counts every producer in a render toward one episode', () => {
      shouldShowLoadingText(0)
      shouldShowLoadingText(0)
      shouldShowLoadingText(0)
      expect(settleLoadingEpisode(0).requested).toBe(true)
      expect(settleLoadingEpisode(10).requested).toBe(false)
    })

    it('makes the shared formatter return blank, then the text', () => {
      const realNow = Date.now
      let now = 10_000
      Date.now = () => now
      try {
        expect(formatLogInkLoading({ resource: 'tags' })).toBe('')
        settleLoadingEpisode(now)
        now += LOADING_TEXT_DELAY_MS
        expect(formatLogInkLoading({ resource: 'tags' })).toBe('Loading tags…')
      } finally {
        Date.now = realNow
      }
    })

    it('resets the episode when the delay is toggled', () => {
      shouldShowLoadingText(0)
      settleLoadingEpisode(0)
      setLoadingDelayEnabled(true)
      expect(shouldShowLoadingText(10_000)).toBe(false)
    })
  })
})
