import typescript from 'rollup-plugin-typescript2'
import commonjs from '@rollup/plugin-commonjs'
import peerDepsExternal from 'rollup-plugin-peer-deps-external'
import resolve from '@rollup/plugin-node-resolve'
import { visualizer } from 'rollup-plugin-visualizer'
import eslint from '@rollup/plugin-eslint'
import { preserveShebangs } from 'rollup-plugin-preserve-shebangs'
import executable from 'rollup-plugin-executable'
import json from '@rollup/plugin-json'
import dts from 'rollup-plugin-dts'

const enableBenchmarking = false

const config = [
  {
    input: 'src/index.ts',
    treeshake: true,
    output: [
      {
        file: 'dist/index.esm.mjs',
        sourcemap: enableBenchmarking,
        inlineDynamicImports: true,
        format: 'esm',
        // ESM has no built-in `__dirname` — it's a CJS construct.
        // The tree-sitter runtime (and any future filesystem-relative
        // code) reads `__dirname` to locate bundled assets like
        // `dist/tree-sitter/*.wasm`. This intro derives the equivalent
        // from `import.meta.url` so source code can stay format-
        // agnostic. The CJS output below gets `__dirname` for free
        // and needs no shim. ts-jest tests compile to CJS so they
        // also get `__dirname` natively. tsx (dev mode) provides
        // its own `__dirname` shim. (#933 phase 1.1)
        intro: [
          "import { fileURLToPath as __cocoFileURLToPath } from 'node:url'",
          "import { dirname as __cocoDirname } from 'node:path'",
          "const __filename = __cocoFileURLToPath(import.meta.url)",
          "const __dirname = __cocoDirname(__filename)",
        ].join('\n'),
      },
      {
        file: 'dist/index.js',
        sourcemap: enableBenchmarking,
        inlineDynamicImports: true,
        format: 'cjs',
      },
    ],
    plugins: [
      peerDepsExternal({
        includeDependencies: true,
      }),
      eslint({
        throwOnError: true,
        // Warnings are advisory (e.g. react-hooks/exhaustive-deps) and must not
        // fail the build; errors (e.g. react-hooks/rules-of-hooks) still do.
        throwOnWarning: false,
        include: ['src/**/*.ts'],
        exclude: ['node_modules/**', 'dist/**'],
      }),
      resolve(),
      typescript({
        useTsconfigDeclarationDir: true,
        check: true,
        tsconfigOverride: {
          exclude: ['__test__', '**/__test__/', '**/*.test.*'],
        },
      }),
      commonjs(),
      json(),
      preserveShebangs(),
      visualizer({
        title: 'git-coco rollup visualizer',
        filename: 'coverage/stats.html',
        template: 'network',
        sourcemap: enableBenchmarking,
      }),
      executable(),
    ],
  },
  {
    input: './dist/dts/index.d.ts',
    output: [
      {
        file: 'dist/index.d.ts',
        format: 'es',
      },
    ],
    plugins: [dts()],
  },
]

export default config
