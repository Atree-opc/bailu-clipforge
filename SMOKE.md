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

## PGE-007B post-change verification

Environment remains the Windows/Node/pnpm lock recorded above. Commands were
rerun after the Windows fix and white-label shell:

| Command | Exit | Result |
|---|---:|---|
| focused branding + path tests | 0 | 3 files / 21 tests |
| `pnpm test` | 0 | 92/92 files; 1017/1017 tests |
| `pnpm lint` | 0 | 0 errors; 21 unchanged upstream warnings |
| `pnpm build` | 0 | Next.js/TypeScript passed; 45 static pages; only the existing NFT trace warning |
| visible-brand scan | 0 | upstream name appears only in the explicit Settings license attribution |
| `git diff --check` | 0 | no whitespace errors |

Real Chromium at 1440×900 verified the Chinese and English dark shell. A CDP
probe removed `.dark`, asserted computed light tokens `#f0f7f2`, `#1a3b26`,
and `#2d7a4b`, and captured the light render. Generated screenshots live under
ignored `.next/` and are verification evidence, not product source.

## PGE-007B-FIX post-evaluation repair

| Command | Exit | Result |
|---|---:|---|
| focused repair tests | 0 | 5 files / 105 tests: package/export branding, four-key migration, Windows/UNC/file URL/HTTPS paths, metadata composition |
| `pnpm test` | 0 | 93/93 files; 1028/1028 tests |
| `pnpm lint` | 0 | 0 errors; 21 unchanged upstream warnings |
| `pnpm build` | 0 | Next.js/TypeScript passed; 45 static pages; only the existing NFT trace warning |
| precise user/export scan | 0 | Electron shell, ad-template errors, export filenames, built-in authors and compliance defaults contain no upstream promotion; license/provenance and stable compatibility identifiers are preserved |
| `scripts/generate-electron-icon.ps1` | 0 | regenerated `electron/icon.png` at 512×512 from canonical `src/app/icon.svg`; SHA-256 `66E4095F60EA01F21E4755E304AC725C1EB62D52B18CD48027F69ADA85D6FF58` |

The local-media regression now verifies real byte-for-byte copying from a
Windows temporary file and file URL, classifies UNC paths as local, and keeps
HTTPS on a mocked network branch. The preference migration is table-tested for
all four keys, including new-value precedence, idempotence, and write failure.

## PGE-007C2 signed internal service API

The Bailu service edge reuses the existing project row and compose chain. It
does not expose a second workflow, Artifact or business-scope store.

| Command | Exit | Result |
|---|---:|---|
| `pnpm exec vitest run src/integrations/bailu/__tests__` | 0 | 4 files / 28 tests: raw-body HMAC, strict wire parser, nonce/idempotency, real SQLite 0011→0012 and restart, manifest, callback failure recovery, route vertical slice |
| `pnpm test` | 0 | 97/97 files; 1056/1056 tests |
| `pnpm lint` | 0 | 0 errors; 21 unchanged upstream warnings; no warning in changed TypeScript |
| focused eslint over Bailu, compose hook and DB seams | 0 | 0 errors and 0 warnings in changed TypeScript |
| `pnpm build` | 0 | Next.js/TypeScript passed; 45 static pages and three Bailu dynamic API routes; only the existing ingest NFT trace warning |
| `git diff --cached --check` | 0 | no whitespace errors across tracked and newly added files |

Migration verification applies the committed 0000–0011 journal to a real
SQLite database, upgrades it with 0012, and reruns migration after reopening.
It also applies all migrations twice to an empty database and scans 0012 for
destructive SQL. The request ledger is asserted not to contain organization,
workspace, Campaign, product, workflow or Artifact authority columns.

Signing and runtime configuration are specified in
`src/integrations/bailu/README.md`. Secrets are environment-only and are never
included in request/response bodies, SQLite rows or logs.

## PGE-007C2-FIX evaluator repair

The repair keeps the existing compose hook and service wire unchanged. Tests
generate a real 32x24 H.264 MP4 with the repository FFmpeg binary, pass it
through the production manifest builder and original terminal hook, then poll
the signed status handler to `succeeded`. Arbitrary byte strings are not used
as successful video fixtures.

| Command | Exit | Result |
|---|---:|---|
| `pnpm exec vitest run src/integrations/bailu/__tests__` | 0 | 4 files / 39 tests, including held-handle probing, hardlink, junction/symlink, non-regular, swap/drift and invalid-video rejection plus the real-MP4 signed handler/status chain |
| `pnpm exec tsc --noEmit` | 0 | TypeScript passed |
| `pnpm exec eslint src/integrations/bailu` | 0 | 0 errors and 0 warnings |
| `pnpm test` | 0 | 97/97 files; 1067/1067 tests |
| `pnpm lint` | 0 | 0 errors; 21 unchanged upstream warnings |
| `pnpm build` | 0 | Next.js/TypeScript passed; 45 static pages and three Bailu dynamic API routes; only the existing ingest NFT trace warning |
| `git diff --check` | 0 | no whitespace errors |

Manifest creation validates the same opened file before and after two hashes
and streams that held handle into a real `ffprobe`: regular file, one link,
nonzero stable size, stable
device/inode/timestamps, ISO-BMFF `ftyp`, an actual video stream, positive
duration, width and height. The fixed callback parser rejects raw leading or
trailing whitespace and every literal `?` or `#`, including empty query or
fragment forms, before constructing a URL.

## PGE-007C4A signed output content

The additive content route is ID-only and streams the already-manifested MP4
from the same handle used for request-time root, identity, hash, size, MIME,
`ftyp` and real-video verification. No Drizzle migration, ledger field,
ordinary `/api/output` behavior or compose behavior changed.

| Command | Exit | Result |
|---|---:|---|
| first red `pnpm exec vitest run src/integrations/bailu/__tests__/content-route.test.ts` | 1 | 1 file / 7 tests red: missing handler/opener and the prior large-pipe media probe gap |
| `pnpm exec vitest run src/integrations/bailu/__tests__` | 0 | 5 files / 47 tests: signature/time/replay, state/output selection, locator/Range rejection, link/non-file/drift/fake rejection, exact >1 MiB H.264 bytes and cancellation close |
| `pnpm exec tsc --noEmit` | 0 | TypeScript passed |
| focused eslint over Bailu and the new route | 0 | 0 errors and 0 warnings |
| `pnpm test` | 0 | 98/98 files; 1075/1075 tests |
| `pnpm lint` | 0 | 0 errors; 21 unchanged upstream warnings |
| `pnpm build` | 0 | Next.js/TypeScript passed; 45 static pages and four Bailu dynamic API routes; only the existing ingest NFT trace warning |
| real production HTTP signed stream | 0 | status 200; 1,286,435 exact H.264 bytes; exact length/hash/MIME/no-store/nosniff; no Location; run ledger row unchanged; one verified nonce row |
| main-platform `npm run typecheck` / `npm run build` | 0 | canonical additive contract passed server/web/test typecheck and 3,947-module build |

The real HTTP smoke used a temporary `APP_DATA_DIR`, the production standalone
Next server and a signed empty-body GET. It compared the response byte for byte
with the generated H.264 source and confirmed the content request did not
rewrite the terminal service request row.

## PGE-007C4A-FIX request-envelope repair

The content route now applies a stateless request-envelope gate before HMAC
verification or nonce claim: exact GET path, no non-empty query, no Range or
`Transfer-Encoding`, and `Content-Length` either absent or the canonical value
`0`. After verification it also asserts the signed raw body is empty before
claiming the nonce. Rejected envelopes leave both nonce and terminal ledgers
unchanged.

| Command | Exit | Result |
|---|---:|---|
| first red focused content-route test | 1 | 8 tests / 2 failures: bare query transport and nonzero/ambiguous body transports reached the old handler |
| `pnpm exec vitest run src/integrations/bailu/__tests__` | 0 | 5 files / 49 tests |
| `pnpm test -- --run` | 0 | 98/98 files; 1077/1077 tests |
| `pnpm exec tsc --noEmit` | 0 | TypeScript passed |
| `pnpm lint` | 0 | 0 errors; 21 unchanged upstream warnings |
| `pnpm build` | 0 | Next.js/TypeScript passed; 45 static pages and four Bailu dynamic API routes; only the existing ingest NFT trace warning |
| real production raw TCP | 0 | nonzero Content-Length body, chunked body, non-empty query and Range all 400 with nonce delta 0; wrong/expired signatures 401; legal missing-length and canonical-zero requests each streamed the exact 1,286,435 bytes; replay 409; terminal ledger unchanged |

Next 16 normalizes an original request target ending in a bare `?` before the
App Route handler: production `request.url`, `nextUrl`, headers and request
internals are identical to a request without the delimiter. The Planner accepts
those two forms as semantically equivalent and explicitly forbids a custom
server or proxy solely to retain the delimiter. A focused test constructs both
through `NextRequest` and asserts identical status, headers, exact bytes and
ledger behavior; any non-empty query remains rejected before nonce claim.
