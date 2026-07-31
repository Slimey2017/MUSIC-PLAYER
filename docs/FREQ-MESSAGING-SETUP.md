# FREQ Messaging Setup and Operations

## Architecture

FREQ continues to use its existing server-issued bearer sessions. The browser never receives a Supabase service-role key and never queries the messaging tables or private Storage directly. `server.js` validates the FREQ session, account restriction, block state, conversation membership, role, privacy setting, upload context, and requested resource on every protected route.

Because these are custom FREQ sessions rather than Supabase Auth JWTs, the new tables are intentionally server-only at the Data API layer. RLS is enabled on every messaging table; `anon` and `authenticated` privileges are revoked; a restrictive `freq_server_only` policy denies those roles; trusted server operations use the existing service-role client.

## Database and Storage

Apply:

`supabase/migrations/20260731_freq_messaging.sql`

The migration creates 19 tables:

- Core: `conversations`, `conversation_members`, `messages`, `message_requests`, `message_reactions`, `message_reads`, `message_attachments`
- Privacy and groups: `user_blocks`, `user_message_settings`, `group_invites`, `conversation_bans`
- Projects: `project_rooms`, `project_files`
- Safety and notices: `message_reports`, `freq_notices`, `notice_reads`, `account_restrictions`, `restriction_appeals`, `moderation_message_actions`

It also creates the private `freq-private-messaging` bucket with a 50 MiB server-side limit. Image, short-video, PDF, text, and project ZIP objects use this bucket. Audio continues through the existing private `cloud-audio` bucket and `lib/rightsProtection.js` pipeline. Private files are never returned as public URLs; the server issues five-minute signed download URLs only after a fresh membership and permission check.

## Existing environment variables

Messaging adds no new environment-variable names. Keep the existing server values shown in `.env.example`, especially:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or the existing `SUPABASE_SECRET_KEY`
- `ACOUSTID_API_KEY`
- `FFPROBE_COMMAND`, `FPCALC_COMMAND`, and `CLAMAV_COMMAND`
- the existing rights-policy and timeout variables

Never place service-role, AcoustID, email, Premium-provider, or other secrets in `index.html`.

## Roles and permissions

Regular groups use Owner, Admin, Moderator, Member, and Read-only. Project rooms use Project Owner, Artist, Featured Artist, Producer, Engineer, Writer, Manager, Designer, and Viewer. Server-side role checks control invites, settings, moderation, message pinning, uploads, removals, bans, and downloads.

Only the verified artist record owner may create an official artist fan group. Official status is database-controlled. “FREQ Notices” is reserved at signup and for profile, artist, and group names; the real inbox uses `sender_key = 'freq_notices'` and only trusted admin/server code can insert notices.

## Moderation controls

Admin routes require the existing `requireAdmin` middleware:

- `POST /api/admin/notices`
- `POST /api/admin/restrictions`
- `PATCH /api/admin/restrictions/:id`
- `PATCH /api/admin/restrictions/appeals/:id`
- `GET /api/admin/messages/reports`
- `PATCH /api/admin/messages/reports/:id`

Restrictions are enforced before protected `/api` handlers and again by messaging helpers where relevant. Supported capability flags are `can_publish_music`, `can_create_posts`, `can_send_messages`, `can_create_groups`, `can_upload_files`, `can_use_dj_boom`, `can_comment`, `can_follow`, `can_earn_mp`, and `can_purchase_items`.

Message reports preserve a snapshot at report time even if the visible message is later deleted. Private moderation notes are returned only through admin routes. Group locks, slow mode, announcement mode, member bans, and report resolution write moderation action records.

## Files and rights protection

The Multer filter is only an early rejection layer. `detectPrivateAttachment` independently checks the extension, actual file signature/container, permitted conversation context, and size. Non-audio files run through the existing malware scanner. Artist/project audio calls the existing `analyzeAndStoreCloudAudio`, which delegates validation, hashing, Chromaprint, AcoustID, MusicBrainz lookup, duplicate comparison, declaration normalization, scanning, and decisioning to `lib/rightsProtection.js`.

An AcoustID or internal match is evidence for human/rights review, not an accusation. Private project audio remains private and is not published, monetized, added to Discovery, charts, or Listen to Earn. Publishing remains a separate existing workflow with its own rights decision.

## Realtime and fallback

The supplied app uses custom FREQ sessions, so the browser does not receive a Supabase JWT that could safely authorize per-conversation Realtime subscriptions. The UI therefore uses scoped five-second polling only while Messages is open and a slower unread-count poll while signed in. Polling requests still pass the same server membership checks, and timers are cleared when Messages closes or the user logs out.

## Operational limits

Limits are intentionally server-controlled and are not exhaustively disclosed in the UI. They cover new-account/request messages, repeated identical messages, message velocity, group creation, project creation, invitations, member caps, attachment contexts, and request-stage links/files. Tune internal constants only after reviewing abuse and capacity metrics.

## Known limitations

- Realtime uses safe scoped polling because the current custom FREQ session is not a Supabase Auth JWT. Moving to websocket subscriptions later requires a server-authorized channel design, not a browser service key.
- Typing state is process-local and is therefore best-effort across multi-instance deployments; messages, unread state, reactions, and notices remain database-backed.
- Scheduled artist-group posts and native polls are not included in this first messaging release; Q&A, slow mode, announcements, pinned releases/messages, and existing listening-party/player entry points are supported.
- The ZIP contains no credentials. The two pre-existing client-side EmailJS public identifiers were deliberately redacted; configure those through the deployment’s existing frontend configuration process if direct browser EmailJS support/moderation mail is still used. Server-side verification mail reads the existing environment variables.
- Full account-to-account, assistive-technology, and rights-tool end-to-end sign-off should be run in staging with real FREQ sessions and installed `ffprobe`, `fpcalc`, and `clamscan`; the delivery does not create synthetic users or upload fixtures to production.
