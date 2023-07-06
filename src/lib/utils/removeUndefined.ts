/**
 * Returns a new object with all undefined keys removed
 * 
 * @param obj Object to remove undefined keys from
 * @returns 
 */
export function removeUndefined(obj: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined))
}
