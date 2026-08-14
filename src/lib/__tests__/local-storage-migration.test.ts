import { describe, expect, it } from "vitest";
import {
  BAILU_STORAGE_KEY_MIGRATIONS,
  migrateBailuStorageKeys,
} from "@/lib/local-storage-migration";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe("白标 localStorage 一次性迁移", () => {
  it.each(BAILU_STORAGE_KEY_MIGRATIONS)("迁移并清理 $legacyKey", ({ legacyKey, currentKey }) => {
    const storage = new MemoryStorage();
    storage.setItem(legacyKey, `legacy:${legacyKey}`);

    migrateBailuStorageKeys(storage);

    expect(storage.getItem(currentKey)).toBe(`legacy:${legacyKey}`);
    expect(storage.getItem(legacyKey)).toBeNull();
    migrateBailuStorageKeys(storage);
    expect(storage.getItem(currentKey)).toBe(`legacy:${legacyKey}`);
  });

  it.each(BAILU_STORAGE_KEY_MIGRATIONS)("新值不被 $legacyKey 覆盖", ({ legacyKey, currentKey }) => {
    const storage = new MemoryStorage();
    storage.setItem(legacyKey, "stale");
    storage.setItem(currentKey, "current");

    migrateBailuStorageKeys(storage);

    expect(storage.getItem(currentKey)).toBe("current");
    expect(storage.getItem(legacyKey)).toBeNull();
  });

  it("写入失败时保留旧键供下次重试", () => {
    const storage = new MemoryStorage();
    const { legacyKey, currentKey } = BAILU_STORAGE_KEY_MIGRATIONS[0];
    storage.setItem(legacyKey, "recoverable");
    const failing = new Proxy(storage, {
      get(target, property, receiver) {
        if (property === "setItem") return () => { throw new Error("quota"); };
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    migrateBailuStorageKeys(failing);

    expect(storage.getItem(currentKey)).toBeNull();
    expect(storage.getItem(legacyKey)).toBe("recoverable");
  });
});
