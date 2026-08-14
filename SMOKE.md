# Locked upstream smoke

Baseline date: 2026-08-15 (Asia/Shanghai)

Environment:

```text
Windows / PowerShell
Node v24.14.0
pnpm 10.33.0 (packageManager lock)
Upstream commit 74bae61fdcced6c795f629e997d63680749fbfc4
```

The commands below were run before any Bailu product-source change. Every
install/test/lint/build command had a 120-second hard limit.

| Command | Time | Exit | Result |
|---|---:|---:|---|
| `pnpm install --frozen-lockfile` | 49.1 s | 0 | 942 packages installed; `better-sqlite3` and `ffmpeg-static` install scripts completed |
| `pnpm test` | 73.8 s | 1 | 89/91 files passed; 1009/1011 tests passed; two Windows path failures described below |
| `pnpm lint` | 97.4 s | 0 | 0 errors, 21 warnings |
| `pnpm build` | 39.6 s | 0 | Next.js 16.2.1 production build and TypeScript passed; 45 static pages generated |

## Known upstream test failures on Windows

1. `src/lib/__tests__/local-stock.test.ts` — “绝对路径素材按复制处理，落到目标目录”
   reaches `fetchWithTimeout` and fails with `TypeError: fetch failed`, caused
   by `unknown scheme`. The test's absolute path is not recognized as a local
   path on Windows.
2. `src/lib/__tests__/paths.test.ts` — “注入 APP_DATA_DIR 时所有可写路径都迁过去（Electron 打包关键）”
   expects `/tmp/daihuo-userdata/uploads`; Windows path joining returns
   `\tmp\daihuo-userdata\uploads`.

No source fix is included in this baseline. A later correction requires its
own bounded task and cross-platform assertions.

## Non-blocking warnings

- pnpm 10.33.0 reports that the `pnpm.onlyBuiltDependencies` field in
  `package.json` is ignored and points to the newer configuration location.
- Install skipped scripts for `electron-winstaller` and `msw` under pnpm's
  build-script approval policy.
- Lint reports 21 warnings, including generated
  `integrations/infinite-canvas/dist/clipforge.js`, React hook dependencies,
  one `img` optimization warning, and unused symbols. It reports no errors.
- Build reports one Turbopack NFT tracing warning through
  `src/app/api/ingest/product/route.ts` and `metadataBase` warnings. The build
  still exits 0.

## E2E status

`e2e/smoke.spec.ts` contains five Playwright tests, but this lock does not
declare `@playwright/test` as a direct dependency and provides no E2E package
script, Playwright config, or web-server lifecycle. It is therefore recorded
as non-runnable rather than reported as passing.

## Required repeatable checks

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
git diff --check
git status --short --branch
```

Before promotion, also verify that local `HEAD`, the pushed Bailu branch, and
the recorded commit agree; `origin/main` must remain the locked upstream
commit, and `origin`/`upstream` must match `UPSTREAM.md`.
