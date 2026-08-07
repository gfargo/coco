import { Catalog } from './t'

/**
 * English message catalog — the fallback (and, for now, only) locale.
 * Keys are namespaced `<domain>.<subdomain>.<name>`. See README.md for the
 * migration pattern follow-on files should use.
 */
export const en: Catalog = {
  'ai.error.rateLimit':
    'Rate limited by your AI provider (429) — too many requests or quota exceeded. Wait a moment, then press I to retry.',
  'ai.error.auth':
    'AI provider rejected the request — check your API key (run `coco init`, or press gK to edit the global config).',
  'ai.error.contextLength':
    'The staged diff is too large for the model’s context window — stage fewer changes (or split the commit) and retry with I.',
  'ai.error.network': 'Network error reaching the AI provider — check your connection, then press I to retry.',
  'ai.error.empty': 'AI request failed.',
}
