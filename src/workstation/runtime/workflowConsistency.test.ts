import { readFileSync } from 'fs'
import { join } from 'path'
import { HISTORY_MUTATING_WORKFLOW_IDS, HISTORY_REWRITE_WORKFLOW_IDS } from './hooks/useWorkflowAction'
import { getLogInkWorkflowActions } from './inkWorkflows'

/**
 * #2221: the workflow registry and the code that runs it are two hand-kept
 * lists. A registered id with nothing behind it shows up in the palette and
 * answers "not yet wired" when run; a handler whose id is not registered is
 * unreachable from the palette. This checks both lists against each other.
 */

const runtimeDir = __dirname
const read = (relative: string) => readFileSync(join(runtimeDir, relative), 'utf8')

// Where handlers live: the main table plus the two extracted ones.
const HANDLER_FILES = [
  'hooks/useWorkflowAction.ts',
  'hooks/useForgeTriageWorkflowActions.ts',
  'hooks/useSubmoduleRemoteWorkflowActions.ts',
]
// Where an id can be routed without a handler-table entry: confirm-only gates and
// palette special cases are resolved in the input router and the quit guard.
const ROUTER_FILES = ['inkInput.ts', 'quitGuard.ts', '../surfaces/rebase/input.ts']

/** Keys of the handler tables: a quoted id at the start of a line, then `async`, `(` or a reference. */
function handlerKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of HANDLER_FILES) {
    for (const match of read(file).matchAll(/^ {4,6}'([a-z0-9-]+)':\s*(?:async|\(|\{|[a-zA-Z])/gm)) keys.add(match[1])
  }
  return keys
}

const routerSource = ROUTER_FILES.map(read).join('\n')
const mentionedByRouter = (id: string) => routerSource.includes(`'${id}'`)

const registryIds = getLogInkWorkflowActions().map((action) => action.id)

// Handlers whose ids are submitted from an input prompt or a menu, so they are
// intentionally not palette entries. Each must really be submitted by the router.
const PROMPT_SUBMITTED_HANDLERS = ['edit-commit-note', 'add-worktree', 'stash-file']

describe('workflow registry and handlers agree (#2221)', () => {
  const handlers = handlerKeys()

  it('finds the handler tables (guards this test against its own regex rotting)', () => {
    expect(handlers.size).toBeGreaterThan(100)
    expect(handlers.has('checkout-branch')).toBe(true)
    expect(handlers.has('triage-pr-merge')).toBe(true)
  })

  it('gives every registered workflow something to run: a handler, or a route in the input router', () => {
    const unreachable = registryIds.filter((id) => !handlers.has(id) && !mentionedByRouter(id))
    expect(unreachable).toEqual([])
  })

  it('registers every handler, except the ones submitted from a prompt', () => {
    const registered = new Set(registryIds)
    const unregistered = [...handlers].filter((id) => !registered.has(id) && !PROMPT_SUBMITTED_HANDLERS.includes(id))
    expect(unregistered).toEqual([])
  })

  it('keeps the prompt-submitted list accurate: real handlers, really submitted by the router', () => {
    for (const id of PROMPT_SUBMITTED_HANDLERS) {
      expect(handlers.has(id)).toBe(true)
      expect(mentionedByRouter(id)).toBe(true)
      expect(registryIds).not.toContain(id)
    }
  })

  it('has no duplicate registry ids', () => {
    expect(registryIds.filter((id, index) => registryIds.indexOf(id) !== index)).toEqual([])
  })
})

describe('history id sets name real workflows (#2221)', () => {
  const registered = new Set(registryIds)

  it('HISTORY_REWRITE_WORKFLOW_IDS only lists registered ids, so a typo cannot disable its safeguard', () => {
    expect([...HISTORY_REWRITE_WORKFLOW_IDS].filter((id) => !registered.has(id))).toEqual([])
  })

  it('HISTORY_MUTATING_WORKFLOW_IDS only lists registered ids, so a typo cannot skip the post-op history refresh', () => {
    expect([...HISTORY_MUTATING_WORKFLOW_IDS].filter((id) => !registered.has(id))).toEqual([])
  })

  it('every history-rewriting workflow also refreshes history afterwards', () => {
    expect([...HISTORY_REWRITE_WORKFLOW_IDS].filter((id) => !HISTORY_MUTATING_WORKFLOW_IDS.has(id))).toEqual([])
  })
})
