# Bailu patch ledger

All Bailu changes are recorded against the lock in `UPSTREAM.md`. Product
patches must identify their files, purpose, data-authority impact, tests, and
upstream conflict risk.

| Bailu commit | Area | Files | Data-authority impact | Verification | Upstream conflict risk |
|---|---|---|---|---|---|
| Baseline commit (this branch) | Governance only | `UPSTREAM.md`, `BRANDING.md`, `PATCHES.md`, `SMOKE.md`, `LICENSES/README.md` | None | `SMOKE.md` plus repository/remote checks | Low |
| PGE-007B white-label commit | Windows path baseline + presentation shell | `src/lib/{paths.ts,providers/stock-types.ts}`, focused tests, `src/components/app-shell.tsx`, `src/app/{layout.tsx,globals.css,start/page.tsx,settings/page.tsx}` and brand assets/i18n | None; ClipForge SQLite and main-platform authorities unchanged | 92 files / 1017 tests; lint 0 errors; Next build/TypeScript/45 pages; bilingual dark + light token browser probes | Medium (shell/start CSS and metadata assets) |

No business route, database schema, composition, provider, or integration patch
is included in PGE-007B.

## Rules for future entries

- Keep the original AGPL license and `NOTICE` intact.
- Do not squash away the upstream lock or omit source paths.
- Mark generated files separately from hand-edited source.
- Database changes may affect only ClipForge's own SQLite authority.
- Main-platform communication must use the reviewed HTTP Bridge contract; no
  direct database or canonical-media-root writes.
- A failed upstream smoke may be fixed only under a separate bounded PGE card,
  never silently inside a branding or integration patch.
