/**
 * Signature status for a commit (#2214), read from `%G?` / `%GS` / `%GK`.
 *
 * Only the commit detail asks git to verify: `%G?` runs gpg or ssh-keygen per
 * commit, which the history list cannot afford for thousands of rows. An
 * unsigned commit costs nothing (git sees no signature header and skips it).
 */

export type CommitSignature = {
  /** Git's one-letter status: G B U X Y R E (N, none, is not stored). */
  status: string
  signer?: string
  key?: string
}

/** Parse the three trailing detail fields; undefined when the commit is unsigned. */
export function parseCommitSignature(
  status: string | undefined,
  signer: string | undefined,
  key: string | undefined
): CommitSignature | undefined {
  const letter = (status ?? '').trim()
  if (!letter || letter === 'N') return undefined
  return {
    status: letter,
    signer: signer?.trim() || undefined,
    key: key?.trim() || undefined,
  }
}

const GOOD = new Set(['G', 'U', 'X', 'Y'])

/** Whether the signature is a problem worth drawing attention to. */
export function isSignatureProblem(signature: CommitSignature): boolean {
  return signature.status === 'B' || signature.status === 'R'
}

/** One line for the inspector, e.g. `✓ signed by Alice (ABCD1234)`. */
export function describeSignature(signature: CommitSignature, ascii = false): string {
  const ok = ascii ? '[ok]' : '✓'
  const bad = ascii ? '[!]' : '✗'
  const who = signature.signer ? ` by ${signature.signer}` : ''
  const key = signature.key ? ` (${signature.key.slice(-16)})` : ''
  switch (signature.status) {
    case 'G': return `${ok} signed${who}${key}`
    case 'U': return `${ok} signed${who}${key}, key not trusted`
    case 'X': return `${ok} signed${who}${key}, signature expired`
    case 'Y': return `${ok} signed${who}${key}, key expired`
    case 'R': return `${bad} signed${who}${key}, key revoked`
    case 'B': return `${bad} BAD signature${who}${key}`
    case 'E': return `? signed${key}, cannot verify (key missing)`
    default: return `? signature status ${signature.status}`
  }
}

export function isSignatureVerified(signature: CommitSignature): boolean {
  return GOOD.has(signature.status)
}
