/**
 * One-time compatibility seam for preferences written before Bailu white-labeling.
 * The old keys are removed only after the current key is known to be available.
 */
export const BAILU_STORAGE_KEY_MIGRATIONS = [
  { legacyKey: "clipforge_daily_persona", currentKey: "bailu_commerce_studio_daily_persona" },
  { legacyKey: "clipforge_daily_last", currentKey: "bailu_commerce_studio_daily_last" },
  { legacyKey: "clipforge_guide_dismissed", currentKey: "bailu_commerce_studio_guide_dismissed" },
  { legacyKey: "clipforge_nav_collapsed", currentKey: "bailu_commerce_studio_nav_collapsed" },
] as const;

export function migrateBailuStorageKeys(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  for (const { legacyKey, currentKey } of BAILU_STORAGE_KEY_MIGRATIONS) {
    try {
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue === null) continue;
      if (storage.getItem(currentKey) === null) storage.setItem(currentKey, legacyValue);
      storage.removeItem(legacyKey);
    } catch {
      // Storage can be blocked or full. Preserve the legacy key and retry on a later mount.
    }
  }
}
