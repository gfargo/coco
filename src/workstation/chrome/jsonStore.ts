/**
 * Moved to `lib/utils/jsonStore` so `lib/` code (the update check) can use it
 * without importing from `workstation/` (#2218). Re-exported for existing importers.
 */
export * from '../../lib/utils/jsonStore'
