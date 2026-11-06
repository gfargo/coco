/* eslint-disable @typescript-eslint/no-var-requires -- Jest loads transformers via CommonJS require */
// Jest transformer that compiles ESM-only dependencies to CommonJS.
//
// ts-jest runs suites through CommonJS `require`. On Node < 24.9, jest cannot
// `require()` an ES module, so suites that load ESM-only packages such as
// yargs 18 fail with "Must use import to load ES Module". `jest.config.ts`
// routes the affected `node_modules` packages through this transformer, which
// compiles them to CommonJS instead. CI (and `engines`) still cover Node 22.
//
// On Node >= 24.9 with `--experimental-vm-modules`, jest instead loads those
// files natively as ES modules, and tells the transformer so through
// `options.supportsStaticESM`. Converting them to CommonJS there leaves
// `require` undefined inside a module scope ("ReferenceError: require is not
// defined" at yargs/index.mjs), so the source is passed through untouched.
// Runtime and build are unaffected; they consume the real ESM packages.
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { transformSync, version: esbuildVersion } = require('esbuild')

const IMPORT_META_URL = '__cocoImportMetaUrl'
const TRANSFORMER_SOURCE = readFileSync(__filename, 'utf8')

module.exports = {
  getCacheKey(sourceText, sourcePath, transformOptions) {
    return createHash('sha256')
      .update(TRANSFORMER_SOURCE)
      .update(esbuildVersion)
      // The same file transforms to different output depending on whether jest
      // loads it as native ESM, so the two must not share a cache entry.
      .update(transformOptions?.supportsStaticESM ? 'esm' : 'cjs')
      .update(sourcePath)
      .update(sourceText)
      .digest('hex')
  },
  process(sourceText, sourcePath, transformOptions) {
    // jest will load this file as a native ES module (Node >= 24.9): leave it as ESM.
    if (transformOptions?.supportsStaticESM) return { code: sourceText }
    const { code, map } = transformSync(sourceText, {
      loader: 'js',
      format: 'cjs',
      target: 'node22',
      // esbuild switches to Node-compat interop for `.mjs` names, which
      // re-wraps sibling modules this transformer already converted (their
      // default import becomes `{ default }`). Every ESM file in the tree
      // goes through here, so `__esModule` interop is the correct mode.
      sourcefile: sourcePath.replace(/\.mjs$/, '.js'),
      sourcemap: 'inline',
      // esbuild leaves `import.meta` empty under CJS output; yargs reads
      // `import.meta.url` to resolve its locale files.
      define: { 'import.meta.url': IMPORT_META_URL },
      // ESM sources may declare their own top-level `__dirname` / `require`
      // (yargs does), which collide with the CJS wrapper's parameters. A
      // function scope lets those declarations shadow them legally.
      banner: `var ${IMPORT_META_URL} = require('node:url').pathToFileURL(__filename).href;(function () {`,
      footer: '})();',
    })
    return { code, map }
  },
}
