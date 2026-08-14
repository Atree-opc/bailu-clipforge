# Bailu branding boundary

Status: Bailu white-label shell implemented on `bailu/task7-clipforge-baseline`.

The application shell, default start-page palette, metadata, product
terminology, logo, favicon, Apple icon, and social preview now identify the
product as `电商视频工坊` / `Commerce Video Studio`. Changes remain
concentrated in presentation seams so upstream upgrades stay reviewable.

## Required outcome for the later task

- User-facing product name: `电商视频工坊` / `Commerce Video Studio`.
- Remove the upstream product name, old Chinese name, upstream logo, favicon,
  repository links, and author promotion from normal user-facing surfaces.
- Retain upstream copyright, AGPL license text, notices, source attribution,
  and the source-offer obligations required by AGPL. White-labeling must not
  conceal provenance.
- Reuse public Bailu design tokens/components only where compatible. Paid
  NextDevKit-derived blocks may be consumed solely through the private Bailu
  business kit and must retain their provenance record.
- Do not add a second Auth, billing, provider registry, workflow-run,
  Artifact/Lineage, Campaign, or canonical storage authority.

## Preserved boundary

- No database schema, business API, composition, LLM provider, Auth, Billing,
  Cloud, Bridge, callback, or canonical Artifact edits.
- No main-platform Bridge, callback, deployment, or public release.
- Upstream name and repository URL remain visible only in Settings → Open-source
  license, `LICENSE`, `NOTICE`, `UPSTREAM.md`, and governance records.
