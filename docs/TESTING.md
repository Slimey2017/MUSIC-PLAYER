# FREQ Messaging Validation

## Automated checks completed

- `node --check server.js`
- syntax check of the main embedded JavaScript extracted from `index.html`
- static HTML ID check after excluding script-generated templates
- `npm test`, covering the existing rights-protection unit suite and the messaging/security regression suite
- transactional validation of the complete SQL migration against PostgreSQL 17
- live Supabase verification of all 19 new tables, RLS flags, revoked `anon`/`authenticated` access, one `freq_server_only` policy per table, and the private Storage bucket
- Supabase security and performance advisors after migration; no findings were attributable to the new tables after foreign-key indexes were added (fresh unused-index informational notices are expected until production traffic exercises them)

## Security scenarios covered by implementation and static regression tests

- duplicate direct-thread prevention via canonical `direct_key`
- request-stage message, link, attachment, spam, and receipt limits
- bidirectional block enforcement for requests and existing DMs
- verified artist badge sourced from existing artist verification records
- official fan-group ownership restricted to the verified artist owner
- private project membership and signed-download authorization
- audio attachments reuse the existing rights pipeline and never receive public URLs
- official notices are admin/server-created and protected-name identities are rejected
- feature restrictions are checked server-side, including DMs, posting, upload, MP, shop, follow, comment, publish, and DJ BOOM paths
- moderator snapshots remain after visible message deletion
- mobile list-first layout, Back control, details sheet, focus labels, and reduced-motion rules are present

## Manual staging checklist

Use dedicated staging accounts and non-production files for these end-to-end checks:

1. Listener A requests Listener B; B sees no read receipt before accepting, then accepts and replies.
2. Repeat with decline, block, and report. Confirm the sender receives no decline notification and cannot send again after blocking.
3. Test listener-to-artist and verified artist-to-artist DMs; verify badges and privacy modes.
4. Share a published song, release, playlist, and artist. Confirm cards open the existing FREQ player/profile and MP appears only when `/api/mp/listen-to-earn/offers` confirms eligibility.
5. Create a group, invite/accept members, change roles, enable slow mode, lock/announcement mode, pin a message, remove/ban a member, and report the group.
6. Create an official artist group as a verified owner; confirm unverified and unrelated accounts are rejected.
7. Create a project room and upload clean artwork, PDF, text, ZIP, and audio. Confirm unauthorized accounts receive no row or signed URL and that the rights review is logged without publishing the audio.
8. Create each official notice template from an admin account. Confirm an ordinary user cannot create or rename an identity to FREQ Notices.
9. Apply a temporary `can_send_messages = false` and `can_create_posts = false` restriction; confirm DMs and posts fail server-side while allowed listening still works. Submit and decide an appeal.
10. Open two authorized clients and verify polling updates messages, reactions, edits, unread counts, typing state, and notices without returning any conversation to a non-member.
11. Validate desktop, 760 px mobile, keyboard-only, screen-reader, and reduced-motion behavior.

The automated delivery run does not create synthetic production users or upload private fixtures to the live project. The manual account-to-account scenarios therefore remain a staging sign-off step.
