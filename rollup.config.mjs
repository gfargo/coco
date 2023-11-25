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
    output: [
      {
        file: 'dist/index.esm.mjs',
        sourcemap: enableBenchmarking,
        format: 'esm',
      },
      {
        file: 'dist/index.js',
        sourcemap: enableBenchmarking,
        format: 'cjs',
      },
    ],
    plugins: [
      peerDepsExternal({
        includeDependencies: true,
      }),
      eslint({
        throwOnError: true,
        throwOnWarning: true,
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
    // path to your declaration files root
    input: './dist/dts/index.d.ts',
    output: [{ file: 'dist/index.d.ts', format: 'es' }],
    plugins: [dts()],
  },
]

export default config
