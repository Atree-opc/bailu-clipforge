# Upstream baseline

This repository is Bailu's controlled fork of ClipForge for the internal
commerce-video studio.

| Field | Locked value |
|---|---|
| Upstream repository | `https://github.com/xixihhhh/clipforge.git` |
| Bailu repository | `https://github.com/Atree-opc/bailu-clipforge.git` |
| Upstream default branch | `main` |
| Locked upstream commit | `74bae61fdcced6c795f629e997d63680749fbfc4` |
| Locked upstream tree | `36c001c6afde96f4db6e28df382a940b6b26c4b1` |
| Bailu baseline branch | `bailu/task7-clipforge-baseline` |
| Package version at lock | `0.8.89` |
| License | `AGPL-3.0-only`; see `LICENSE`, `NOTICE`, and `LICENSES/README.md` |

The canonical remotes are:

```text
origin   https://github.com/Atree-opc/bailu-clipforge.git
upstream https://github.com/xixihhhh/clipforge.git
```

## Update discipline

1. Fetch `upstream` without changing either default branch.
2. Review the complete upstream diff from the locked commit, including
   database migrations, provider behavior, FFmpeg invocation, license files,
   generated integration bundles, and user-facing branding.
3. Update the lock only on a dedicated Bailu upgrade branch.
4. Re-run the commands and boundary checks in `SMOKE.md`.
5. Record every Bailu delta or conflict resolution in `PATCHES.md`.
6. Promote an upgrade only after an independent review. Never auto-follow
   upstream `main`.

ClipForge remains an independent process and owns only its own editing drafts
and SQLite data. This fork must not write the multimedia platform database or
canonical media roots directly; that integration belongs to the later thin
HTTP Bridge and Artifact Importer task.
