/**
 * Write machine-readable JSON to stdout.
 *
 * Deliberately bypasses the `Logger` — JSON output is *data*, not a log line,
 * so it must always reach stdout even when the logger is silenced (e.g. the
 * global `--quiet` flag, or a command's non-interactive mode). Mirrors how
 * `handleResult`'s stdout path writes results via `process.stdout.write`.
 */
export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Write a machine-readable `{ "error": "..." }` payload to stdout for a
 * `--json` caller that's about to exit non-zero. `commit` and `recap`
 * already followed this contract for their own failure paths (CMD-11) —
 * this is the same shape, extracted so every other `--json`-capable
 * command's failure branches can emit it too, instead of exiting 1 with
 * empty stdout and forcing the caller to scrape stderr.
 */
export function emitJsonError(error: string): void {
  emitJson({ error })
}
