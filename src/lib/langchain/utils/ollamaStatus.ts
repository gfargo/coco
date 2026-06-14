import { spawn } from 'child_process'

import { execPromise } from '../../utils/execPromise'

/** Fallback endpoint when none is configured — matches the Ollama default and
 * the provider's own `DEFAULT_OLLAMA_ENDPOINT`. */
export const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434'

/**
 * The starter model first-run users are pointed at. It's coco's cost-tier
 * `commit` default and ~4.7 GB — large enough for solid commit messages, small
 * enough to pull and run on a typical laptop. (The `balanced`/`quality` dynamic
 * defaults reach for bigger coder models; we deliberately recommend the small
 * one for the very first pull.)
 */
export const RECOMMENDED_STARTER_MODEL = 'llama3.1:8b'

export interface OllamaStatus {
  /** The daemon answered at the endpoint. */
  reachable: boolean
  /** The `ollama` binary resolved on PATH (best-effort). A reachable endpoint
   * counts as installed, since a remote daemon needs no local binary. */
  installed: boolean
  /** Names of locally-pulled models (empty when unreachable). */
  models: string[]
}

/**
 * Raised when Ollama can't be used as configured and the user opted not to fix
 * it inline. `coco init` catches this to re-offer the provider picker instead
 * of aborting the whole session (the old behavior hard-exited via
 * `commandExit(1)`, discarding every prior answer).
 */
export class OllamaNotReadyError extends Error {
  constructor(message = 'Ollama is not ready') {
    super(message)
    this.name = 'OllamaNotReadyError'
  }
}

/**
 * Probe a local (or remote) Ollama instance over its HTTP API. Cross-platform
 * (no `awk`/shell pipes), and a single call tells us reachability *and* the
 * pulled-model list. Falls back to a PATH probe only to distinguish
 * "not installed" from "installed but not running" for the guidance copy.
 */
export async function getOllamaStatus(
  endpoint: string = DEFAULT_OLLAMA_ENDPOINT,
): Promise<OllamaStatus> {
  let reachable = false
  let models: string[] = []

  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    })
    if (res.ok) {
      reachable = true
      const data = (await res.json()) as { models?: Array<{ name?: string }> }
      models = (data.models ?? [])
        .map((m) => m.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
    }
  } catch {
    reachable = false
  }

  const installed = reachable || (await isOllamaBinaryPresent())
  return { reachable, installed, models }
}

async function isOllamaBinaryPresent(): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where ollama' : 'command -v ollama'
  try {
    await execPromise(probe)
    return true
  } catch {
    return false
  }
}

/**
 * Run `ollama pull <model>` with live progress (inherited stdio) so the user
 * sees the download bar. Resolves on success; rejects on spawn error or
 * non-zero exit.
 */
export function pullOllamaModel(model: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ollama', ['pull', model], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ollama pull exited with code ${code}`)),
    )
  })
}
