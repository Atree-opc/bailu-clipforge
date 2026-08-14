# Bailu signed service edge

This directory is a runtime mirror of the minimum ClipForge-facing surface of
the main platform's `bailu.studio/1.0` contract. The authority file is:

```text
多自媒体平台管理中心/src/shared/contracts-studio.ts
SHA-256 4f27f79e847009411e322420c0f285ae453f925bb22e7db3177c30584ed211d7
```

The mirror is deliberately strict and cannot evolve independently. ClipForge
keeps its own project/edit/composition SQLite authority. The main platform
keeps Campaign, workflow-run, Artifact/Lineage, review and delivery authority.

## Runtime configuration

```text
BAILU_STUDIO_HMAC_KEY_ID       fixed service key identifier
BAILU_STUDIO_HMAC_SECRET       HMAC-SHA256 secret
BAILU_STUDIO_CALLBACK_URL      optional fixed terminal callback URL
```

The callback URL is environment-only. Request bodies cannot override it. Only
HTTP(S) URLs without credentials, query or fragment are accepted. The secret
is not written to SQLite, response bodies, browser code or logs.

## Signing

Every request requires these headers:

```text
x-bailu-key-id
x-bailu-timestamp
x-bailu-nonce
x-bailu-idempotency-key
x-bailu-body-sha256
x-bailu-signature
```

`timestamp` is Unix seconds and must be within ±300 seconds. `nonce` is
unpadded base64url encoding of at least 16 random bytes and is persisted only
after full signature verification. The signature is lowercase hex
HMAC-SHA256 over exactly seven newline-separated lines:

```text
bailu.studio/1.0
UPPERCASE_METHOD
URL_PATHNAME
UNIX_TIMESTAMP
NONCE
IDEMPOTENCY_KEY
LOWERCASE_RAW_BODY_SHA256
```

The raw body hash is verified before the signature. Signed `GET` requests have
an empty raw body and therefore use SHA-256 of zero bytes. The callback uses
the same algorithm, a fresh nonce and `callback-{external_task_id}` as its
idempotency key.

## Wire

Create:

```json
{"contract_version":"bailu.studio/1.0","studio_project_binding_id":"...","title":"..."}
```

Run:

```json
{"contract_version":"bailu.studio/1.0","studio_run_id":"...","operation":"compose","input_sha256":"<64 lowercase hex>","options":{}}
```

`options` allows only existing compose controls: `resolution`, `aspect_ratio`,
`render_preset`, `caption_preset`, `aigc_badge`, `free_tts`, `free_bgm`,
`bgm_duck`, `voice_ground`, `product_card`, `cta_text`, and `label`. Paths,
provider credentials, callback URLs and unknown fields are rejected.

Routes:

```text
POST /api/bailu/v1/projects
POST /api/bailu/v1/projects/:externalProjectId/runs
GET  /api/bailu/v1/runs/:externalTaskId
```

The terminal status/callback body is exact:

```json
{"contract_version":"bailu.studio/1.0","studio_run_id":"...","external_task_id":"...","state":"succeeded","outputs":[],"error_code":null,"error_summary":null}
```

Successful outputs contain only `output_id`, `role`, `relative_path`,
`content_sha256`, `size_bytes`, and `mime_type`. `relative_path` is a POSIX path
under `APP_DATA_DIR/output`; absolute `outputPath` values never cross the wire.

## Recovery

Run idempotency is written before compose starts. The existing compose route
binds its composition ID before launching its fire-and-forget work and calls a
narrow terminal hook after its own database update. A process restart never
blindly calls compose again: status reads the ledger and exact composition row,
then reconstructs and persists terminal status if the callback was lost.
Callback delivery is best effort and happens only after terminal payload/hash
are durable, so delivery failure cannot erase pollable status.
