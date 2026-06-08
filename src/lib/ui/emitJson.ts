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
