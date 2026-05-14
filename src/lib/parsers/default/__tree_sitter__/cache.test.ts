import { platform } from 'node:os'
import {
  getCacheRootDir,
  getCachedWasmPath,
  getTreeSitterCacheDir,
} from './cache'

describe('cache directory resolution', () => {
  describe('getCacheRootDir', () => {
    afterEach(() => {
      delete process.env.XDG_CACHE_HOME
      delete process.env.LOCALAPPDATA
    })

    it('honors XDG_CACHE_HOME on Unix when set', () => {
      if (platform() === 'win32') return
      process.env.XDG_CACHE_HOME = '/tmp/xdg-cache-test'
      expect(getCacheRootDir()).toBe('/tmp/xdg-cache-test/coco')
    })

    it('falls back to ~/.cache/coco on Unix when XDG is unset', () => {
      if (platform() === 'win32') return
      delete process.env.XDG_CACHE_HOME
      expect(getCacheRootDir()).toMatch(/\.cache\/coco$/)
    })

    it('uses LOCALAPPDATA on Windows when set', () => {
      if (platform() !== 'win32') return
      process.env.LOCALAPPDATA = 'C:\\Users\\Test\\AppData\\Local'
      expect(getCacheRootDir()).toMatch(/coco[\\/]+Cache$/)
    })
  })

  describe('getTreeSitterCacheDir', () => {
    it('is the tree-sitter subdir of the cache root', () => {
      const root = getCacheRootDir()
      const sub = getTreeSitterCacheDir()
      expect(sub).toBe(`${root}/tree-sitter`.replace(/\//g, platform() === 'win32' ? /[\\/]/.source : '/').replace(/\[.+\]/, '/'))
      // Loose check that handles platform separator without
      // rebuilding the path: tree-sitter subdir must startWith
      // the root and end with `tree-sitter`.
      expect(sub.startsWith(root)).toBe(true)
      expect(sub).toMatch(/tree-sitter$/)
    })
  })

  describe('getCachedWasmPath', () => {
    it('returns a path under the tree-sitter cache dir', () => {
      const path = getCachedWasmPath('python')
      expect(path).toMatch(/tree-sitter[\\/]+tree-sitter-python\.wasm$/)
      expect(path.startsWith(getTreeSitterCacheDir())).toBe(true)
    })
  })
})
