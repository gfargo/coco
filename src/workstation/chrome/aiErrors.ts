import { en } from '../../lib/i18n/en'
import { t } from '../../lib/i18n/t'

/**
 * Humanize raw AI-provider / LangChain error strings into a short,
 * actionable line for the compose surface.
 *
 * The underlying errors are verbose and developer-facing — e.g.
 * `executeChain: Chain execution failed: 429 You exceeded your current
 * quota …`. We classify the common failure modes (rate limit, auth,
 * network, context length) into a concise message that tells the user
 * what happened and what to do, and fall back to the original (trimmed)
 * text for anything we don't recognize. Pure + tested.
 */
export function humanizeAiError(raw: string | undefined): string {
  const message = (raw || '').trim()
  if (!message) return t(en, 'ai.error.empty')

  const lower = message.toLowerCase()

  // Rate limit / quota — the 429 in the screenshot.
  if (/\b429\b/.test(message) || /rate.?limit|too many requests|exceeded your current quota|quota/i.test(lower)) {
    return t(en, 'ai.error.rateLimit')
  }

  // Auth / API key problems.
  if (/\b401\b|\b403\b/.test(message) || /unauthor|forbidden|invalid api key|incorrect api key|no api key|authentication/i.test(lower)) {
    return t(en, 'ai.error.auth')
  }

  // Context window overflow.
  if (/context length|maximum context|too many tokens|reduce the length|context_length_exceeded/i.test(lower)) {
    return t(en, 'ai.error.contextLength')
  }

  // Network / connectivity.
  if (/etimedout|econnreset|enotfound|econnrefused|network error|fetch failed|socket hang up|timeout/i.test(lower)) {
    return t(en, 'ai.error.network')
  }

  // Unknown: strip the noisy `executeChain: Chain execution failed:`
  // prefix if present so the meaningful part leads, and keep it to one
  // line so it doesn't blow out the panel.
  const stripped = message.replace(/^.*?chain execution failed:\s*/i, '').trim() || message
  return stripped.split('\n')[0]
}
