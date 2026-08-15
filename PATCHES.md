# Bailu patch ledger

All Bailu changes are recorded against the lock in `UPSTREAM.md`. Product
patches must identify their files, purpose, data-authority impact, tests, and
upstream conflict risk.

| Bailu commit | Area | Files | Data-authority impact | Verification | Upstream conflict risk |
|---|---|---|---|---|---|
| Baseline commit (this branch) | Governance only | `UPSTREAM.md`, `BRANDING.md`, `PATCHES.md`, `SMOKE.md`, `LICENSES/README.md` | None | `SMOKE.md` plus repository/remote checks | Low |
| PGE-007B white-label commit | Windows path baseline + presentation shell | `src/lib/{paths.ts,providers/stock-types.ts}`, focused tests, `src/components/app-shell.tsx`, `src/app/{layout.tsx,globals.css,start/page.tsx,settings/page.tsx}` and brand assets/i18n | None; ClipForge SQLite and main-platform authorities unchanged | 92 files / 1017 tests; lint 0 errors; Next build/TypeScript/45 pages; bilingual dark + light token browser probes | Medium (shell/start CSS and metadata assets) |
| PGE-007B-FIX repair commit | Packaged identity, export/error branding, preference compatibility, Windows local-media regression | `package.json`, `electron/{main.js,icon.png}`, icon generator, ad-template/export seams, compliance/style metadata, storage migration, stock-location helper and tests | None; stable appId, wire formats, database and Bridge unchanged | 93 files / 1028 tests; lint 0 errors; Next build/TypeScript/45 pages; precise user/export scan; 512×512 generated icon | Low (presentation strings and compatibility helpers) |
| PGE-007C2 service API commit | Signed Bailu project/compose/status edge and terminal recovery | `src/integrations/bailu/*`, `src/app/api/bailu/v1/*`, minimal compose lifecycle hooks, `src/lib/db/{index,schema}.ts`, Drizzle `0012` and meta | ClipForge remains project/draft/composition authority; the ledger stores transport idempotency, external task binding and callback delivery only. Main Campaign/workflow/Artifact/review facts are not copied. Contract source SHA-256 `4f27f79e847009411e322420c0f285ae453f925bb22e7db3177c30584ed211d7`. | focused 4 files / 28 tests; full 97 files / 1056 tests; lint/build/migration/leak scans in `SMOKE.md` | Medium (one narrow hook seam in the upstream compose route; no FFmpeg/TTS rewrite) |
| PGE-007C2-FIX evaluator repair commit | Output identity/media validation and fixed-callback hardening | `src/integrations/bailu/{manifest.ts,callback.ts,README.md}`, `src/lib/media-probe.ts`, real-MP4 fixture and service/route regression tests | None; wire, ledger and data authorities are unchanged. Manifest construction holds one opened file identity, rejects links/non-regular/drifting files, and requires an actual positive-duration video stream. Callback configuration rejects raw whitespace and any query/fragment marker before URL parsing. | focused 4 files / 39 tests; full 97 files / 1067 tests; TypeScript/lint/build/diff scans in `SMOKE.md` | Low (bounded validation and shared probe-result parser extraction only; compose chain unchanged) |
| PGE-007C4A signed content commit | ID-only signed output byte stream | additive `bailu.studio/1.0` mirror, `src/integrations/bailu/{manifest.ts,service.ts,route-handler.ts,README.md}`, exact content route and focused tests | None; terminal ledger/status is read-only apart from normal verified-nonce replay protection. No schema, migration, compose, ordinary output route or Artifact authority changes. Contract source SHA-256 `5b49fbdca56a56cdc790bf41841878268d8702270c3110b790a67411726f74ce`. | focused 5 files / 47 tests; full 98 files / 1075 tests; TypeScript/lint/build and real signed >1 MiB HTTP byte stream in `SMOKE.md` | Low (additive service route and extraction of the existing held-handle verifier) |

No business route, database schema, composition, provider, or integration patch
is included in PGE-007B.

PGE-007C2 adds the first business integration patch after the white-label work.
Its exact wire, signing, fixed callback, output-manifest and restart rules are
documented beside the implementation in `src/integrations/bailu/README.md`.

PGE-007C4A adds one read-only content route to that edge. It does not change
the ordinary `/api/output` product route or permit direct filesystem/SQLite
access from the main platform.

## Rules for future entries

- Keep the original AGPL license and `NOTICE` intact.
- Do not squash away the upstream lock or omit source paths.
- Mark generated files separately from hand-edited source.
- Database changes may affect only ClipForge's own SQLite authority.
- Main-platform communication must use the reviewed HTTP Bridge contract; no
  direct database or canonical-media-root writes.
- A failed upstream smoke may be fixed only under a separate bounded PGE card,
  never silently inside a branding or integration patch.
