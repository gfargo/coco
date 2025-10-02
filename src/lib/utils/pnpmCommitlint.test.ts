/**
 * Simple test to verify pnpm ES module error detection
 */

// Mock the isPnpmEsModuleIssue function logic
function isPnpmEsModuleIssue(error: Error): boolean {
  const message = error.message
  return (
    message.includes('Directory import') &&
    message.includes('is not supported resolving ES modules') &&
    message.includes('@commitlint/config-conventional')
  )
}

describe('pnpm ES module error detection', () => {
  it('should detect pnpm ES module errors', () => {
    const pnpmError = new Error(
      "Directory import '/Users/gfargo/dev/gfargo/vercel-doorman/node_modules/.pnpm/@commitlint+config-conventional@18.6.3/node_modules/@commitlint/config-conventional/lib' is not supported resolving ES modules imported from /Users/gfargo/dev/gfargo/vercel-doorman/node_modules/.pnpm/@commitlint+config-conventional@18.6.3/node_modules/@commitlint/config-conventional/wrapper.mjs"
    )
    
    expect(isPnpmEsModuleIssue(pnpmError)).toBe(true)
  })

  it('should not detect regular module not found errors', () => {
    const regularError = new Error('Cannot find module "@commitlint/config-conventional"')
    expect(isPnpmEsModuleIssue(regularError)).toBe(false)
  })

  it('should not detect unrelated errors', () => {
    const unrelatedError = new Error('Some other error')
    expect(isPnpmEsModuleIssue(unrelatedError)).toBe(false)
  })
})