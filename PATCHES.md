# Bailu patch ledger

All Bailu changes are recorded against the lock in `UPSTREAM.md`. Product
patches must identify their files, purpose, data-authority impact, tests, and
upstream conflict risk.

| Bailu commit | Area | Files | Data-authority impact | Verification | Upstream conflict risk |
|---|---|---|---|---|---|
| Baseline commit (this branch) | Governance only | `UPSTREAM.md`, `BRANDING.md`, `PATCHES.md`, `SMOKE.md`, `LICENSES/README.md` | None | `SMOKE.md` plus repository/remote checks | Low |

There are no Bailu product-source patches at this baseline.

## Rules for future entries

- Keep the original AGPL license and `NOTICE` intact.
- Do not squash away the upstream lock or omit source paths.
- Mark generated files separately from hand-edited source.
- Database changes may affect only ClipForge's own SQLite authority.
- Main-platform communication must use the reviewed HTTP Bridge contract; no
  direct database or canonical-media-root writes.
- A failed upstream smoke may be fixed only under a separate bounded PGE card,
  never silently inside a branding or integration patch.
