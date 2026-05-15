// Jest setup — silence the specific class of unhandled-rejection that
// fires after a test file's VM context is torn down while a dynamic
// `import('web-tree-sitter')` is still in flight (see
// `src/lib/parsers/default/__tree_sitter__/runtime.ts`). The tracking
// issue for the proper fix is gfargo/coco#979; this hook is the
// minimum-surgery workaround that lets CI exit 0 instead of 1 even
// though all 1933 tests pass.
//
// Scoped narrowly: the matcher checks for the exact ReferenceError
// message Jest throws ("You are trying to `import` a file after the
// Jest environment has been torn down"). Any other unhandled
// rejection still surfaces, so we keep the safety net for real
// test-introduced async leaks.
//
// CommonJS because Jest evaluates `setupFiles` before its ESM
// integration kicks in. `.cjs` is the unambiguous extension.
process.on('unhandledRejection', (reason) => {
  if (
    reason &&
    typeof reason === 'object' &&
    'message' in reason &&
    typeof reason.message === 'string' &&
    reason.message.includes('after the Jest environment has been torn down')
  ) {
    // Swallow. This is the post-teardown ESM dynamic-import rejection
    // documented in #979.
    return
  }
  // Re-raise everything else so legitimate async leaks still fail
  // the run.
  throw reason
})
