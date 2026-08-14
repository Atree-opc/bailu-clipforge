import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { messages } from "@/lib/i18n/messages";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const forbiddenBrand = /ClipForge|xixihhhh|github\.com\/xixihhhh/i;

describe("电商视频工坊白标壳", () => {
  it("中英文品牌和导航术语服从内部生产映射", () => {
    expect(messages.zh.common.productName).toBe("电商视频工坊");
    expect(messages.en.common.productName).toBe("Commerce Video Studio");
    expect(messages.zh.common.navProjects).toBe("视频项目");
    expect(messages.zh.common.navProducts).toBe("商品资产");
    expect(messages.zh.common.navPresenters).toBe("数字主播");
    expect(messages.zh.common.navClone).toBe("爆款复刻");
    expect(messages.zh.common.navBatch).toBe("批量出片");
    expect(messages.zh.common.uiModePro).toBe("专业模式");
  });

  it("默认壳、metadata 与社交图替代文本不暴露上游品牌", () => {
    const visibleShell = [
      read("src/components/app-shell.tsx"),
      read("src/app/layout.tsx"),
      read("src/app/start/page.tsx"),
      read("src/app/opengraph-image.alt.txt"),
    ].join("\n");
    expect(visibleShell).not.toMatch(forbiddenBrand);
    expect(visibleShell).toContain('t("productName")');
    expect(visibleShell).toContain("电商视频工坊");
  });

  it("用户文案只在设置许可项保留可追溯上游来源", () => {
    for (const locale of ["zh", "en"] as const) {
      for (const [namespace, entries] of Object.entries(messages[locale])) {
        for (const [key, value] of Object.entries(entries)) {
          if (namespace === "settings" && key.startsWith("license")) continue;
          expect(value, `${locale}.${namespace}.${key}`).not.toMatch(forbiddenBrand);
        }
      }
    }
    expect(messages.zh.settings.licenseAttribution).toContain("ClipForge");
    expect(messages.en.settings.licenseAttribution).toContain("ClipForge");
    expect(read("src/app/settings/page.tsx")).toContain("licenseAttribution");
    expect(read("src/app/settings/page.tsx")).toContain("https://github.com/xixihhhh/clipforge");
  });

  it("浅色和深色 token 均采用白鹿生产控制台色板", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("--background: #f0f7f2");
    expect(css).toContain("--foreground: #1a3b26");
    expect(css).toContain("--primary: #2d7a4b");
    expect(css).toContain("--background: #0b1510");
    expect(css).toContain("--primary: #63c987");
    expect(css).not.toMatch(/#6366f1|#8b5cf6|#d946ef/i);
    expect(read("src/app/start/page.tsx")).not.toMatch(/#6366f1|#8b5cf6|#d946ef|#a78bfa/i);

    const icon = read("src/app/icon.svg");
    expect(icon).toContain("#2d7a4b");
    expect(icon).not.toMatch(/#6366f1|#8b5cf6|#a78bfa/i);
  });
});
