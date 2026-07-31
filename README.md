# FREQ Copyright & Rights Protection System

This project extends the supplied FREQ upload, release, moderation, artist-verification, and Supabase architecture. The frontend remains embedded in `index.html`; the existing Express server remains the API boundary.

## Important limitation

Chromaprint, AcoustID, and MusicBrainz identify recordings and metadata. They do **not** prove copyright ownership, establish infringement, or make this system equivalent to YouTube Content ID. FREQ treats a match as an advisory signal and provides human review, information-request, evidence, and dispute paths.

## Implemented workflow

1. Validate the real file signature and audio stream with `ffprobe`.
2. Scan the temporary file with ClamAV before cloud storage.
3. Generate a SHA-256 checksum.
4. Generate encoded and raw Chromaprint fingerprints with `fpcalc`.
5. Query AcoustID when `ACOUSTID_API_KEY` is configured.
6. Retrieve MusicBrainz recording metadata when an MBID is available.
7. Check FREQ for exact hashes and similar raw Chromaprints.
8. Apply conservative rights rules.
9. Approve, hold, request information, or route to manual review.
10. Permit publishing only when the current review status is `approved`.

Files that are invalid or flagged by the security scanner are not saved. All other uploads remain private while rights questions are resolved.

## Setup

### 1. Install dependencies

Node.js 20 or newer is required.

```bash
npm ci
```

Install the open-source system tools:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg libchromaprint-tools clamav clamav-freshclam
sudo freshclam
```

The included `Dockerfile` installs the same tools for container deployment.

### 2. Apply the Supabase migration

Run this file in the Supabase SQL Editor or through the existing FREQ migration workflow:

```text
supabase/migrations/20260731120000_copyright_rights_protection.sql
```

The migration creates:

- `rights_reviews`
- `rights_evidence`
- `rights_disputes`
- `rights_claims`
- `rights_audit_log`
- the private `rights-evidence` Storage bucket
- RLS, explicit service-role-only grants, constraints, and queue/duplicate indexes

The new tables intentionally have no `anon` or `authenticated` Data API access. FREQ uses its existing custom sessions in `server.js`, then performs server-side Supabase operations with the service-role/secret key.

### 3. Configure environment variables

Copy `.env.example` into your hosting provider's environment settings. Never put `SUPABASE_SERVICE_ROLE_KEY` in browser code.

Required for production:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)
- `ACOUSTID_API_KEY` for AcoustID lookup
- a real contact address in `MUSICBRAINZ_USER_AGENT`
- working `ffprobe`, `fpcalc`, and ClamAV commands

Keep `RIGHTS_REQUIRE_CLAMAV=true`, `RIGHTS_REQUIRE_FFPROBE=true`, and `RIGHTS_REQUIRE_CHROMAPRINT=true` in production. If a required scanner or fingerprint tool is unavailable, the upload is rejected temporarily or held instead of silently bypassing the workflow.

### 4. Start and verify

```bash
npm test
npm run check
npm start
```

Open `/health`, upload a small recording through Cloud Files, inspect the ⚖ status badge, and confirm that only an approved upload can be published from the Artist Dashboard.

## API additions

Owner routes:

- `GET /api/rights/files/:cloudFileId`
- `POST /api/rights/files/:cloudFileId/scan`
- `POST /api/rights/files/:cloudFileId/declaration`
- `POST /api/rights/files/:cloudFileId/evidence`
- `POST /api/rights/files/:cloudFileId/disputes`
- `POST /api/rights/claims`

Admin routes (existing `requireAdmin` authorization):

- `GET /api/admin/rights/queue`
- `GET /api/admin/rights/claims`
- `POST /api/admin/rights/claims/:claimId/decision`
- `GET /api/admin/rights/:reviewId`
- `GET /api/admin/rights/evidence/:evidenceId`
- `POST /api/admin/rights/:reviewId/decision`

The existing routes were extended rather than replaced:

- `POST /api/cloud-files` now requires a rights declaration and automatically runs the pipeline.
- `GET /api/cloud-files` includes each file's rights status.
- `GET /api/artists/:id/publishable` includes rights status.
- `POST /api/artists/:id/publish` requires `rights_reviews.status = 'approved'`.

## Decision behavior

- An exact or strong internal match from another uploader is held or manually reviewed—not called infringement.
- A match from the same uploader requests clarification about a new master, edition, or re-release.
- Licensed, permitted, cover/remix, and public-domain declarations can include private evidence.
- AcoustID/MusicBrainz matches route to verification without becoming ownership conclusions.
- Rejected/not-cleared decisions can be disputed with additional explanation and evidence.
- Every automated transition, evidence event, dispute, admin decision, and evidence view is audited.

## Upgrading providers later

Provider-specific identification is isolated in `lib/rightsProtection.js`. A commercial fingerprint vendor can replace or supplement `lookupAcoustId()` while keeping the upload route, database record, moderation UI, decision states, and publishing gate unchanged.

## Operations

- Update ClamAV definitions regularly with `freshclam`.
- AcoustID requires a free application key.
- MusicBrainz calls are serialized to stay near its one-request-per-second public-service expectation.
- Uploaded audio is temporarily written with owner-only permissions and removed immediately after analysis.
- Supporting evidence is stored in a private bucket and can only be read through an authenticated, audited admin endpoint.
