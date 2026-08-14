import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { classifyMaterial, scoreByFilename, scanLocalMaterials } from "@/lib/providers/local-stock";
import { downloadStockFile, isLocalStockLocation } from "@/lib/providers/stock-types";
import { searchStock } from "@/lib/providers/stock-registry";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipforge-local-"));
  await writeFile(join(dir, "kitchen_pour_over.mp4"), "v1");
  await writeFile(join(dir, "city_night.mov"), "v2");
  await writeFile(join(dir, "product_shot.jpg"), "img");
  await writeFile(join(dir, "notes.txt"), "ignore"); // not a media file, should be ignored
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

describe("classifyMaterial", () => {
  it("识别视频/图片，其余 null（大小写不敏感）", () => {
    expect(classifyMaterial("a.mp4")).toBe("video");
    expect(classifyMaterial("a.MOV")).toBe("video");
    expect(classifyMaterial("a.png")).toBe("image");
    expect(classifyMaterial("a.txt")).toBeNull();
    expect(classifyMaterial("noext")).toBeNull();
  });
});

describe("scoreByFilename", () => {
  it("文件名与检索词 token 交集计数", () => {
    expect(scoreByFilename("kitchen_pour_over.mp4", "pour over coffee")).toBe(2); // matches: pour + over
    expect(scoreByFilename("city_night.mov", "pour over")).toBe(0);
  });
});

describe("scanLocalMaterials", () => {
  it("过滤非素材、视频优先、相关度排序", async () => {
    const c = await scanLocalMaterials(dir, "pour over");
    expect(c.length).toBe(3); // txt filtered out
    expect(c.every((x) => x.source === "local")).toBe(true);
    expect(c[0].id).toBe("kitchen_pour_over.mp4"); // video priority + hits pour/over → ranked first
    expect(c[0].mediaType).toBe("video");
    expect(c[c.length - 1].mediaType).toBe("image"); // images ranked after videos
  });
  it("perPage 截断 + 目录不存在 → []", async () => {
    expect((await scanLocalMaterials(dir, "x", { perPage: 1 })).length).toBe(1);
    expect(await scanLocalMaterials(join(dir, "nope"), "x")).toEqual([]);
  });
  it("audio 请求 → []（本地不支持音频）", async () => {
    expect(await scanLocalMaterials(dir, "x", { mediaType: "audio" })).toEqual([]);
  });
});

describe("registry: searchStock('local')", () => {
  it("有 localDir → 扫池；无 localDir → []（不参与）", async () => {
    expect((await searchStock("local", "pour over", { localDir: dir })).length).toBe(3);
    expect(await searchStock("local", "pour over", {})).toEqual([]);
  });
});

describe("downloadStockFile 本地复制分支", () => {
  it("Windows 临时目录中的绝对路径素材真实复制且内容一致", async () => {
    const out = await mkdtemp(join(tmpdir(), "clipforge-out-"));
    try {
      const { filePath, bytes } = await downloadStockFile(join(dir, "kitchen_pour_over.mp4"), out, "copied_clip", "video");
      expect(filePath.endsWith("copied_clip.mp4")).toBe(true);
      expect(bytes).toBe(2); // "v1"
      expect(await readFile(filePath, "utf8")).toBe("v1");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("UNC、file URL 走本地分支，HTTPS 保持网络分支", () => {
    expect(isLocalStockLocation("\\\\server\\share\\clip.mp4")).toBe(true);
    expect(isLocalStockLocation(pathToFileURL(join(dir, "kitchen_pour_over.mp4")).href)).toBe(true);
    expect(isLocalStockLocation("https://cdn.example.com/clip.mp4")).toBe(false);
  });

  it("file URL 真实复制，HTTPS 通过 fetch 下载", async () => {
    const out = await mkdtemp(join(tmpdir(), "clipforge-out-"));
    try {
      const local = await downloadStockFile(pathToFileURL(join(dir, "kitchen_pour_over.mp4")).href, out, "from_url", "video");
      expect(await readFile(local.filePath, "utf8")).toBe("v1");

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("net", {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }));
      const remote = await downloadStockFile("https://cdn.example.com/clip.mp4", out, "from_https", "video");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(await readFile(remote.filePath, "utf8")).toBe("net");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
