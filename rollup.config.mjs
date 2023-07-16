import typescript from 'rollup-plugin-typescript2'
import commonjs from '@rollup/plugin-commonjs'
import peerDepsExternal from "rollup-plugin-peer-deps-external"
import resolve from '@rollup/plugin-node-resolve'
import { visualizer } from "rollup-plugin-visualizer";
import eslint from '@rollup/plugin-eslint';
import { preserveShebangs } from 'rollup-plugin-preserve-shebangs';
import executable from "rollup-plugin-executable"
import json from '@rollup/plugin-json';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.esm.mjs',
      format: 'esm',
      sourcemap: true,
    },
    {
      file: 'dist/index.js',
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
      filename: 'dist/stats.html',
      template: 'network',
      brotliSize: true,
    }),    
    executable(),
  ],
}
