# Bailu branding boundary

Status: baseline only. No product branding was changed in this commit.

The later white-label task may replace the application shell, theme tokens,
product terminology, logo, icons, and user-facing upstream links. Those
changes must stay concentrated in presentation and adapter seams so upstream
upgrades remain reviewable.

## Required outcome for the later task

- User-facing product name: Bailu commerce-video studio (final Chinese wording
  is chosen by the product owner during white-label review).
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

## Out of scope for this baseline

- No source, asset, manifest, metadata, route, or database edits.
- No iframe integration with the upstream UI.
- No main-platform Bridge, callback, deployment, or public release.
