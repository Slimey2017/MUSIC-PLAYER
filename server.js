/**
 * FREQ — Universal Music Player
 * server.js  ·  v4.1  "The Extractor"
 *
 * © 2025–2026 FREQ / Slimey2017. All rights reserved.
 *
 * ─── API Endpoints ────────────────────────────────────────────────────────────
 * POST /api/resolve              { url: string }
 *   → { platform, type, embedUrl, id, title?, embedBlocked? }
 *
 * POST /api/import               { urls: string[] }
 *
 * POST /api/yt/tracks            { url: string }   ← NEW v4.1
 *   → { type:'playlist'|'video', title, tracks:[{ id, title, duration, thumb }] }
 *   Scrapes ytInitialData from YouTube page — zero API key.
 *   Works for: watch?v=, playlist?list=, /channel/, /@handle, youtu.be/
 *
 * GET  /api/yt/embed-check       ?id=<videoId>     ← NEW v4.1
 *   → { id, embeddable: bool, nocookie: bool }
 *   Checks YouTube oEmbed endpoint to detect embedding restrictions.
 *
 * GET  /health
 * GET  /redirect                 ?url=<encoded>&platform=<name>
 *
 * POST /api/auth/signup          { username, displayName?, password }
 * POST /api/auth/signin          { username, password }
 * POST /api/auth/token-refresh   { token }
 * POST /api/auth/sync            { token, playlists }
 * GET  /api/auth/pull
 * DELETE /api/auth/account       { token }
 *
 * GET    /api/profiles/:username            → public profile (404 if private/missing)
 * PATCH  /api/profiles/me        { token, bio?, displayName?, isPublic? }
 *
 * POST   /api/follows/:username              { token }  → follow
 * DELETE /api/follows/:username              { token }  → unfollow
 * GET    /api/follows/:username/followers    ?limit=&offset=
 * GET    /api/follows/:username/following    ?limit=&offset=
 *
 * POST   /api/playlists                      { token, name, description?, isPublic? }
 * GET    /api/playlists/:id                  ?token=
 * PATCH  /api/playlists/:id                  { token, name?, description?, isPublic? }
 * DELETE /api/playlists/:id                  { token }
 * GET    /api/playlists/mine                 ?token=
 * POST   /api/playlists/:id/tracks           { token, trackData }
 * DELETE /api/playlists/:id/tracks/:rowId    { token }
 * GET    /api/profiles/:username/playlists
 *
 * POST   /api/playlists/:id/like               { token }  → like (idempotent)
 * DELETE /api/playlists/:id/like               { token }  → unlike (idempotent)
 * GET    /api/playlists/liked                  ?token=    → playlists I've liked
 *
 * POST   /api/plays                            { originalUrl, platform?, title?, token? }
 * GET    /api/mp/wallet                        Authenticated Musi-Pixels balance
 * GET    /api/mp/ledger                        Authenticated immutable MP transaction ledger
 * GET    /api/mp/shop                          Catalog, seasonal collections, owned + active items
 * POST   /api/mp/shop/purchase                 Atomic MP purchase + grant/ownership
 * POST   /api/mp/shop/activate                 Equip/clear an owned cosmetic
 * POST   /api/mp/shop/gift                     Atomic MP gift purchase + recipient grant
 * GET    /api/mp/shop/gifts                    Sent and received item-gift history
 * GET    /api/mp/listen-to-earn/offers         Authenticated eligible discovery tracks
 * POST   /api/mp/listen-to-earn/heartbeat      Authenticated server-verified playback heartbeat
 * POST   /api/mp/listen-to-earn/stop           Ends an incomplete earning attempt
 * GET    /api/premium/status                   ?token=   → { isPremium, premiumStatus }  (checkout-return polling)
 * POST   /api/premium/verify                   Authenticated. Live provider lookup — activates Premium if an active
 *                                               membership is found for this account. No webhook dependency.
 * POST   /api/premium/sync                     Authenticated. Same live provider lookup as /verify, framed as
 *                                               "refresh my subscription state" — also revokes Premium if the
 *                                               provider reports no active membership.
 * GET    /api/premium/history                  ?token=   → { history: [...] }
 * GET    /api/premium/config                                → { checkoutUrl }  (Gumroad product URL, no secrets)
 * POST   /api/account/email                    Authenticated. { email } → sets/updates accounts.email. Used both
 *                                               by signup-era accounts adding a required email retroactively and
 *                                               as the general "change my email" endpoint.
 * POST   /api/presence/heartbeat                Authenticated. { } → refreshes this session's online status.
 *                                               Called automatically every ~30s by the frontend while visible.
 * POST   /api/analytics/page-view               { path } → logs a page view. Auth optional (guests included,
 *                                               username null). No IP/location ever recorded.
 * GET    /api/admin/presence                    requireAdmin. Who's online right now.
 * GET    /api/admin/presence/history             requireAdmin. ?username=&limit=  Join/leave log.
 * GET    /api/admin/page-views                  requireAdmin. ?username=&limit=  Recent page views.
 * GET    /api/admin/activity                    requireAdmin. ?limit=&before=  Who posted what, when.
 * GET    /api/rights/files/:cloudFileId          Owner-facing upload rights status
 * POST   /api/rights/files/:cloudFileId/scan     Backfill scan for older private uploads
 * POST   /api/rights/files/:cloudFileId/declaration  Update rights declaration and re-evaluate
 * POST   /api/rights/files/:cloudFileId/evidence     Private license/permission evidence
 * POST   /api/rights/files/:cloudFileId/disputes     Request human reconsideration
 * POST   /api/rights/claims                      Rights-owner claim intake; never auto-removes content
 * GET    /api/admin/rights/queue                 requireAdmin. Upload rights review queue
 * GET    /api/admin/rights/claims                requireAdmin. Rights-owner claim queue
 * GET    /api/charts/tracks                    ?window=all|7d&limit=
 *
 * GET    /api/discover/playlists                ?sort=likes|recent&limit=
 * GET    /api/discover/profiles                 ?limit=&token=
 *
 * ─── New in v4.1 ─────────────────────────────────────────────────────────────
 *   - POST /api/yt/tracks  — scrapes YouTube playlist/video tracks, no API key
 *   - GET  /api/yt/embed-check — detects embed-blocked videos via oEmbed
 *   - resolveYouTube now returns embedBlocked flag + nocookie fallback URL
 *   - All resolvers hardened with better error messages
 *   - Native fetch (Node v18+) for server-side HTTP (scraping)
 *   - User-Agent spoofing so YT page scrape actually works
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const multer   = require('multer');
// node-fetch not needed — Node v18+ has native fetch built in
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createSupabaseClientFromEnv, createFallbackSupabaseClient } = require('./server-config');
const { verifyPremiumNow, verifyPremiumIfDue } = require('./lib/premiumVerification');
const { getConfiguredProviders } = require('./lib/premium-providers');
const radio = require('./lib/radio');
const {
  RightsProcessingError,
  analyzeAudioUpload,
  decideRights,
  normalizeRightsDeclaration,
  scanBufferForMalware,
} = require('./lib/rightsProtection');

// ─── EmailJS (transactional email) ─────────────────────────────────────────
// Used for artist-verification emails (magic-link confirm + status updates).
// EmailJS's REST API takes service_id + template_id + a public key (safe to
// ship in code) and, for server-side/no-CAPTCHA sends, a private key that
// MUST stay in .env only. If any of these env vars are missing, sends are
// skipped and just logged (safe no-op for local dev / before setup).
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || 'service_gfpf5hf';
const EMAILJS_TEMPLATE_ID_VERIFY = process.env.EMAILJS_TEMPLATE_ID_VERIFY || 'template_hy427sb';
const EMAILJS_TEMPLATE_ID_STATUS = process.env.EMAILJS_TEMPLATE_ID_STATUS || process.env.EMAILJS_TEMPLATE_ID_VERIFY || 'template_hy427sb';
const EMAILJS_TEMPLATE_ID_ACCOUNT = process.env.EMAILJS_TEMPLATE_ID_ACCOUNT || 'template_524i64l';
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || '';
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || ''; // optional but recommended for server-side sends
const EMAILJS_ENABLED = Boolean(EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID_VERIFY && EMAILJS_PUBLIC_KEY);

if (!EMAILJS_ENABLED) {
  console.warn('[email] EMAILJS_SERVICE_ID not set; verification emails will only be logged, not sent.');
}

// Low-level EmailJS REST call. template_params keys must match the {{vars}}
// used inside the EmailJS template editor exactly.
async function sendEmailJs({ templateId, templateParams }) {
  if (!EMAILJS_ENABLED) {
    console.warn('[EmailJS] Skipped send — EMAILJS_ENABLED is false (missing service/template/public key).');
    return { skipped: true };
  }
  const body = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: templateId,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: templateParams,
  };
  if (EMAILJS_PRIVATE_KEY) body.accessToken = EMAILJS_PRIVATE_KEY;

  console.log(`[EmailJS] Sending via service=${EMAILJS_SERVICE_ID} template=${templateId} to=${templateParams?.email || 'unknown'} privateKeySet=${Boolean(EMAILJS_PRIVATE_KEY)}`);

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error(`[EmailJS] FAILED — status=${res.status} body=${text}`);
    throw new Error(`EmailJS send failed (${res.status}): ${text}`);
  }
  console.log(`[EmailJS] Sent OK — status=${res.status} body=${text}`);
  return { skipped: false };
}

let verificationCore;
try {
  verificationCore = require('./lib/verificationCore');
} catch (err) {
  console.warn('[verification] ./lib/verificationCore not found; using built-in fallback helpers.');
  verificationCore = {};
}

const fallbackVerificationCore = {
  EMAIL_TOKEN_TTL_HOURS: 24,
  CURRENT_CONSENT_VERSION: 'v1-2026-07',
  TERMINAL_STATUSES: new Set(['approved', 'rejected', 'revoked', 'expired']),
  classifyEmailDomainRisk(email) {
    const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
    if (!domain) return 'unknown';
    const free = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com']);
    return free.has(domain) ? 'free_provider' : 'unknown';
  },
  emailDomainMatchesAnyLink(email, links = []) {
    const emailDomain = String(email || '').split('@')[1]?.toLowerCase();
    if (!emailDomain) return false;
    return links.some(link => {
      try {
        const host = new URL(String(link)).hostname.toLowerCase().replace(/^www\./, '');
        return host === emailDomain || host.endsWith(`.${emailDomain}`);
      } catch (_) {
        return false;
      }
    });
  },
  // 3 attempts per rolling 24h window per user. Guards POST /verification/start
  // and POST /verification/:id/appeal — both create a new request row + send
  // an email, so this exists to stop accidental double-submits or deliberate
  // spam, not to throttle normal use (most users only ever call this 1-2x).
  // verification_rate_limits.username is the PK (one row per user, no
  // per-attempt history), so a fixed window is tracked directly on that row:
  // once window_started_at is more than WINDOW_MS in the past, the window
  // resets rather than accumulating forever.
  async checkAndBumpRateLimit(supabase, username) {
    const WINDOW_MS = 24 * 3600 * 1000;
    const MAX_ATTEMPTS = 3;
    const now = Date.now();

    const { data: existing, error: readErr } = await supabase
      .from('verification_rate_limits').select('*').eq('username', username).maybeSingle();
    if (readErr) { console.error('[verification rate limit] read:', readErr.message); return { allowed: true, retryAfterMs: 0 }; }

    const windowStartedAt = existing ? new Date(existing.window_started_at).getTime() : now;
    const windowExpired = (now - windowStartedAt) >= WINDOW_MS;

    if (!existing || windowExpired) {
      // No row yet, or the previous window has fully elapsed — start fresh.
      const { error: upsertErr } = await supabase.from('verification_rate_limits').upsert({
        username, attempt_count: 1, window_started_at: new Date(now).toISOString(), last_attempt_at: new Date(now).toISOString(),
      }, { onConflict: 'username' });
      if (upsertErr) { console.error('[verification rate limit] upsert:', upsertErr.message); return { allowed: true, retryAfterMs: 0 }; }
      return { allowed: true, retryAfterMs: 0 };
    }

    if (existing.attempt_count >= MAX_ATTEMPTS) {
      const retryAfterMs = Math.max(0, WINDOW_MS - (now - windowStartedAt));
      return { allowed: false, retryAfterMs };
    }

    const { error: bumpErr } = await supabase.from('verification_rate_limits')
      .update({ attempt_count: existing.attempt_count + 1, last_attempt_at: new Date(now).toISOString() })
      .eq('username', username);
    if (bumpErr) { console.error('[verification rate limit] bump:', bumpErr.message); return { allowed: true, retryAfterMs: 0 }; }

    return { allowed: true, retryAfterMs: 0 };
  },
  async detectDuplicates(supabase, { applicantUsername, legalName, contactEmail }) {
    const { data, error } = await supabase.from('artist_verification_requests')
      .select('id, artist_id')
      .or(`applicant_username.eq.${applicantUsername},legal_name.eq.${legalName},contact_email.eq.${contactEmail}`)
      .limit(10);
    if (error) {
      console.error('[verification duplicates]', error.message);
      return [];
    }
    return data || [];
  },
  async syncArtistVerificationStatus(supabase, artistId, requestId, status) {
    const patch = { verification_status: status, active_verification_request_id: requestId };
    if (status === 'approved') patch.is_verified = true;
    if (['rejected', 'revoked', 'expired'].includes(status)) patch.is_verified = false;
    const { error } = await supabase.from('artists').update(patch).eq('id', artistId);
    if (error) throw new Error(error.message);
  },
  async logAction(supabase, { requestId, actor, action, detail = {} }) {
    const { error } = await supabase.from('verification_review_log').insert({
      request_id: requestId, actor, action, detail,
    });
    if (error) console.error('[verification log]', error.message);
  },
  generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
  },
  hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
  },
  async sendVerificationEmail({ to, artistName, verifyUrl, expiresInHours }) {
    console.log(`[verification email] ${artistName} <${to}> (${expiresInHours}h): ${verifyUrl}`);
    try {
      await sendEmailJs({
        templateId: EMAILJS_TEMPLATE_ID_VERIFY,
        templateParams: {
          email: to,
          artistName: artistName || 'there',
          verifyUrl,
          expiresInHours: String(expiresInHours || 24),
        },
      });
    } catch (err) {
      console.error('[verification email] EmailJS send failed:', err?.message || err);
    }
  },
  async sendStatusUpdateEmail({ to, artistName, status, reason }) {
    console.log(`[verification status email] ${artistName} <${to}>: ${status}${reason ? ` - ${reason}` : ''}`);
    try {
      await sendEmailJs({
        templateId: EMAILJS_TEMPLATE_ID_STATUS,
        templateParams: {
          email: to,
          artistName: artistName || 'your artist page',
          status: status || '',
          reason: reason || '',
        },
      });
    } catch (err) {
      console.error('[verification status email] EmailJS send failed:', err?.message || err);
    }
  },
  async transitionStatus(supabase, requestId, fromStatus, toStatus, { actor = 'system', detail = {} } = {}) {
    const { data, error } = await supabase.from('artist_verification_requests')
      .update({ status: toStatus, updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await fallbackVerificationCore.logAction(supabase, { requestId, actor, action: 'status_changed', detail: { fromStatus, toStatus, ...detail } });
    return data;
  },
  async storeEncryptedDocument(supabase, { requestId, docType, mimeType, buffer, ownerUsername }) {
    // AES-256-GCM: the key never touches the DB or storage bucket, only the
    // per-document iv/authTag do (both required, no default, on
    // verification_documents — see schema). Ciphertext goes to a PRIVATE
    // bucket, never MEDIA_BUCKET/CLOUD_BUCKET (those are public/user-facing).
    const key = getVerificationDocKey();
    const iv = crypto.randomBytes(12); // 96-bit nonce, standard for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const storagePath = `${requestId}/${docType}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.enc`;
    const { error: uploadErr } = await supabase.storage.from(VERIFICATION_DOC_BUCKET).upload(storagePath, ciphertext, {
      contentType: 'application/octet-stream', // ciphertext is opaque; real mimeType is stored separately for decrypt-time use
      upsert: false,
    });
    if (uploadErr) throw new Error(uploadErr.message);

    const RETENTION_DAYS = 90; // matches typical KYC/AML minimum-retention practice; adjust if you have a specific policy
    const { data, error } = await supabase.from('verification_documents').insert({
      request_id: requestId,
      doc_type: docType,
      storage_path: storagePath,
      encryption_iv: iv.toString('base64'),
      encryption_tag: authTag.toString('base64'),
      mime_type: mimeType || null,
      size: buffer?.length || 0,
      retained_until: new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000).toISOString(),
      // last_accessed_by/at track REVIEW access (see getDecryptedDocumentForReview),
      // not upload — left null here on purpose. ownerUsername (the applicant)
      // isn't a "reviewer access" event.
    }).select().single();
    if (error) {
      // Storage upload already happened — clean up the orphaned object rather
      // than leaving ciphertext with no DB row (and no way to ever decrypt it,
      // since the row is what would carry the iv/tag needed to read it back).
      await supabase.storage.from(VERIFICATION_DOC_BUCKET).remove([storagePath]).catch(() => {});
      throw new Error(error.message);
    }
    return data;
  },
  generateLivenessPrompt() {
    const prompts = ['Turn your head left, then smile', 'Blink twice, then say your artist name', 'Look up, then back at the camera'];
    return prompts[Math.floor(Math.random() * prompts.length)];
  },
  // Mock adapters — no real face-comparison/liveness/manipulation-detection
  // provider is wired up yet. Each returns { result, confidence, signals }
  // shaped to match its OWN column's CHECK constraint exactly (they differ
  // per column — see artist_verification_requests schema). shouldForceManualReview()
  // being permanently true means these are advisory-only regardless of value;
  // swap the body for a real provider call later without touching the caller.
  async runFaceComparison() { return { result: 'needs_manual_review', confidence: null }; },
  async runLivenessCheck() { return { result: 'inconclusive', confidence: null }; },
  async runManipulationCheck() { return { result: 'manual_review_required', confidence: null, signals: [] }; },
  shouldForceManualReview() { return true; },
  generateOwnershipCode() {
    return `FREQ-VERIFY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  },
  async checkWebsiteForCode(url, code) {
    const res = await fetch(url);
    const text = await res.text();
    return { found: text.includes(code) };
  },
  async getDecryptedDocumentForReview(supabase, documentId, accessorUsername) {
    const { data, error } = await supabase.from('verification_documents').select('*').eq('id', documentId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Document not found.');
    if (data.deleted_at) throw new Error('Document has been purged.');

    const { data: fileBlob, error: dlErr } = await supabase.storage.from(VERIFICATION_DOC_BUCKET).download(data.storage_path);
    if (dlErr) throw new Error(dlErr.message);
    const ciphertext = Buffer.from(await fileBlob.arrayBuffer());

    const key = getVerificationDocKey();
    const iv = Buffer.from(data.encryption_iv, 'base64');
    const authTag = Buffer.from(data.encryption_tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const buffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Every review access gets recorded — this is exactly what
    // last_accessed_by/last_accessed_at exist for, and why this document
    // route is deliberately separate from the general request-detail route
    // (per the comment above app.get('/api/admin/verification/:requestId')).
    await supabase.from('verification_documents')
      .update({ last_accessed_by: accessorUsername || null, last_accessed_at: new Date().toISOString() })
      .eq('id', documentId);
    if (accessorUsername) {
      await fallbackVerificationCore.logAction(supabase, {
        requestId: data.request_id, actor: accessorUsername, action: 'document_accessed', detail: { documentId, docType: data.doc_type },
      });
    }

    return { buffer, mimeType: data.mime_type || 'application/octet-stream', docType: data.doc_type };
  },
  async purgeDocument(supabase, documentId, meta = {}) {
    const { data: doc } = await supabase.from('verification_documents').select('storage_path, request_id, doc_type').eq('id', documentId).maybeSingle();
    if (doc?.storage_path) {
      await supabase.storage.from(VERIFICATION_DOC_BUCKET).remove([doc.storage_path]).catch(() => {});
    }
    // Soft-delete (deleted_at) rather than hard DELETE — verification_review_log
    // and artist_verification_requests.id_document_file_id/selfie_file_id/
    // liveness_video_file_id may still reference this row by id via FK.
    const { error } = await supabase.from('verification_documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', documentId);
    if (error) throw new Error(error.message);

    if (doc?.request_id) {
      await fallbackVerificationCore.logAction(supabase, {
        requestId: doc.request_id, actor: meta.actor || 'system',
        action: 'document_purged', detail: { documentId, docType: doc.doc_type, reason: meta.reason || 'unspecified' },
      });
    }
  },
};
verificationCore = { ...fallbackVerificationCore, ...verificationCore };
if (!(verificationCore.TERMINAL_STATUSES instanceof Set)) {
  verificationCore.TERMINAL_STATUSES = fallbackVerificationCore.TERMINAL_STATUSES;
}

// ─── Supabase client (server-side only — uses service role key) ───────────────
const supabase = createSupabaseClientFromEnv(process.env) || createFallbackSupabaseClient();

// Private bucket for artist-verification evidence (government ID, selfie,
// liveness clip). NEVER reuse MEDIA_BUCKET/CLOUD_BUCKET/VIDEO_BUCKET here —
// those serve public/user content; this bucket must stay private with no
// public URL generation anywhere in the codebase. Create it once via the
// Supabase dashboard/CLI (private, no public access) before this code path
// runs — storeEncryptedDocument will fail with a clear storage error if the
// bucket doesn't exist yet, rather than silently writing somewhere public.
const VERIFICATION_DOC_BUCKET = 'verification-docs';

// AES-256-GCM key for verification_documents.encryption_iv/encryption_tag.
// Set VERIFICATION_DOC_ENCRYPTION_KEY in Render's env vars — any secret
// string works, it's hashed to exactly 32 bytes below. Rotating this key
// makes every previously-stored document undecryptable, so treat it like
// any other production secret: set once, back up securely, don't rotate
// casually. Throws loudly at call time (not at boot) if unset, since this
// only matters for the verification feature and shouldn't block server
// startup for everything else.
let _verificationDocKey = null;
function getVerificationDocKey() {
  if (_verificationDocKey) return _verificationDocKey;
  const secret = process.env.VERIFICATION_DOC_ENCRYPTION_KEY;
  if (!secret) throw new Error('VERIFICATION_DOC_ENCRYPTION_KEY is not set — cannot encrypt/decrypt verification documents.');
  _verificationDocKey = crypto.createHash('sha256').update(secret).digest(); // -> 32 bytes, exactly what aes-256-gcm needs
  return _verificationDocKey;
}

// ─── Google Gemini client (server-side only — powers DJ BOOM) ──────────────────
// GEMINI_API_KEY lives in Render's env vars, same as SUPABASE_SERVICE_KEY.
// If it's missing, DJ BOOM routes fail gracefully rather than crashing boot.
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const app  = express();
const PORT = process.env.PORT || 3000;

// Render and the production deployment sit behind one reverse proxy. Trusting
// exactly one hop lets req.ip identify the actual visitor instead of placing
// every FREQ user into the proxy server's shared rate-limit bucket.
app.set('trust proxy', 1);

// ─── Premium checkout config ────────────────────────────────────────────────
// The Gumroad *product* URL (not a secret — this is the public page/overlay
// target). Kept server-side and handed to the client via /api/premium/config
// instead of hardcoding it in index.html, so swapping products, adding a
// discount-coded variant, or moving providers later is a one-line env change
// rather than an HTML edit. Falls back to the current live product if the
// env var isn't set, so checkout doesn't silently break in an environment
// that hasn't been configured yet.
//
// NOTE: this URL is only where the *checkout page itself* lives. Premium
// activation no longer depends on Gumroad calling back to us at all — see
// lib/premiumVerification.js and POST /api/premium/verify below, which pull
// membership status directly from Gumroad's API instead of waiting on a
// webhook delivery.
const GUMROAD_CHECKOUT_URL = process.env.GUMROAD_CHECKOUT_URL || 'https://strickland717.gumroad.com/l/freq-premium';

// Where a Gumroad customer actually manages/cancels their own membership.
// Gumroad has no per-seller "customer billing portal" API (unlike Stripe's
// Billing Portal) — cancellation is entirely self-service on Gumroad's own
// site, via either the buyer's Library (if they made a Gumroad account) or
// the "Manage membership" link on their purchase receipt email. This is the
// one true destination for both, so FREQ points there rather than
// pretending to offer in-app cancellation it has no API to perform.
const GUMROAD_MANAGE_URL = 'https://app.gumroad.com/library';

// ─── Middleware ───────────────────────────────────────────────────────────────
const captureRawBody = (req, _res, buf, encoding) => {
  if (!buf || !buf.length) return;
  req.rawBodyBuffer = Buffer.isBuffer(buf) ? Buffer.from(buf) : Buffer.from(String(buf));
  req.rawBody = req.rawBodyBuffer.toString(encoding || 'utf8');
  req.rawBodyEncoding = encoding || 'utf8';
};

app.use(cors());

app.use(express.json({ limit: '35mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '35mb', verify: captureRawBody }));
app.use(express.static(__dirname));

// Account restrictions are enforced before every API route, including older
// FREQ routes that pre-date DMs. This is deliberately server-side: hiding a
// button in index.html is never treated as authorization. Read/listen routes,
// notice access, blocking, and appeals are intentionally not mapped here so a
// moderation decision can restrict publishing or messaging without turning a
// listener's whole account into a cosmetic dead end.
function restrictedCapabilityForRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const pathName = String(req.originalUrl || '').split('?')[0];
  if (method === 'POST' && /^\/api\/posts\/[^/]+\/comments$/.test(pathName)) return 'can_comment';
  if (/^(POST|PATCH|DELETE)$/.test(method) && /^\/api\/posts(?:\/|$)/.test(pathName)) return 'can_create_posts';
  if (method === 'POST' && (/^\/api\/follows\//.test(pathName) || /^\/api\/artists\/[^/]+\/follow$/.test(pathName))) return 'can_follow';
  if (method === 'POST' && /^\/api\/mp\/listen-to-earn\/(?:heartbeat)$/.test(pathName)) return 'can_earn_mp';
  if (method === 'POST' && (/^\/api\/mp\/shop\/(?:purchase|gift|crate\/open)$/.test(pathName) || /^\/api\/icon-packs\/purchase$/.test(pathName))) return 'can_purchase_items';
  if (method === 'POST' && /^\/api\/djboom\//.test(pathName)) return 'can_use_dj_boom';
  if (/^(POST|PATCH|DELETE)$/.test(method) && (
    /^\/api\/artists\/(?:create|claim)$/.test(pathName) ||
    /^\/api\/artists\/[^/]+\/(?:publish|releases)(?:\/|$)/.test(pathName) ||
    /^\/api\/tracks\/[^/]+(?:$|\/collaborators)/.test(pathName)
  )) return 'can_publish_music';
  if (method === 'POST' && (
    /^\/api\/cloud-files$/.test(pathName) || /^\/api\/videos\//.test(pathName) ||
    /^\/api\/motion-canvas\//.test(pathName) || /^\/api\/projects\/[^/]+\/files$/.test(pathName) ||
    /^\/api\/messages\/conversations\/[^/]+\/attachments$/.test(pathName)
  )) return 'can_upload_files';
  return null;
}

async function enforceAccountRestrictions(req, res, next) {
  const capability = restrictedCapabilityForRequest(req);
  if (!capability) return next();
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query?.token;
    if (!token) return next(); // The destination route still owns its 401.
    const sess = await dbGetSession(token);
    if (!sess) return next();
    const effective = await dbGetEffectiveAccountCapabilities(sess.username);
    req._session = req._session || sess;
    req._accountCapabilities = effective;
    if (effective[capability] === false) {
      return res.status(403).json({
        error: 'This account feature is currently restricted. Check FREQ Notices for the reason and appeal options.',
        code: 'account_feature_restricted',
        capability,
        restrictionId: effective.primaryRestrictionId || null,
        severity: effective.severity || null,
        endsAt: effective.endsAt || null,
      });
    }
    return next();
  } catch (error) {
    console.error('[account restriction middleware]', error);
    return res.status(503).json({ error: 'FREQ could not safely verify this account permission. Please try again.' });
  }
}

app.use('/api', enforceAccountRestrictions);

// ─── Multer — memory storage for cloud file uploads ───────────────────────────
// Files land in req.file.buffer; nothing touches disk on the server.
// 20 MB limit mirrors CLOUD_FILE_MAX_BYTES below.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1048576 },   // 20 MB
  fileFilter: (_req, file, cb) => {
    // Accept audio/* and the common container types that browsers may label
    // as application/octet-stream (e.g. .flac, .aiff from some OS pickers)
    const ok = file.mimetype.startsWith('audio/')
      || file.mimetype === 'application/octet-stream'
      || /\.(mp3|flac|aiff?|aac|ogg|opus|wav|m4a|wma|alac)$/i.test(file.originalname);
    cb(null, ok);
  },
});

// Separate multer instance for image uploads (avatars, covers, artist
// avatars/banners). Distinct from `upload` above because the size ceiling
// and accepted mimetypes are completely different from audio — a 20MB
// fileSize limit makes no sense for what should be a compressed profile
// picture, and accepting audio/* here would be wrong in the other direction.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1048576 },   // 5MB — generous for a compressed avatar/banner, not raw camera output
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\/(png|jpeg|jpg|webp|gif)$/.test(file.mimetype));
  },
});

// Rights evidence is private supporting material, not public cover art. Keep
// it on its own strict upload surface and in the private rights-evidence
// bucket created by the copyright migration.
const rightsEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1048576 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
      'text/plain', 'application/rtf',
    ]);
    cb(null, allowed.has(file.mimetype));
  },
});

// DMs and project rooms share one private attachment surface. Multer's filter
// is only the first pass; detectPrivateAttachment() below verifies signatures,
// extension, and content before anything reaches Supabase Storage. ZIP is
// accepted here only so the project-room route can make the final context-aware
// decision. Listener DMs reject ZIP and arbitrary documents.
const messagingAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1048576 },
  fileFilter: (_req, file, cb) => {
    const extensionAllowed = /\.(png|jpe?g|webp|gif|mp4|webm|pdf|txt|zip|mp3|wav|flac|m4a|aac|ogg)$/i.test(file.originalname || '');
    const mimeAllowed = /^(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm)|audio\/|application\/(?:pdf|zip|x-zip-compressed|octet-stream)|text\/plain)$/i.test(file.mimetype || '');
    cb(null, extensionAllowed && mimeAllowed);
  },
});

// ─── Media storage (public bucket: avatars, covers, artist art) ───────────────
// Separate bucket from CLOUD_AUDIO_BUCKET (private, signed-URL audio) — these
// objects are meant to be hot-linked directly as <img src> and in og:image
// meta tags, so the bucket is public and callers get back a plain
// getPublicUrl() string, never a signed URL needing re-resolution.
const MEDIA_BUCKET = 'media';

// One small helper reused by all four image-upload routes (profile avatar,
// profile cover, artist avatar, artist banner) rather than four near-copies
// of the same upload+getPublicUrl dance. `pathPrefix` namespaces objects
// within the single shared bucket (avatars/, covers/, artist-avatars/,
// artist-banners/) so nothing else needs its own bucket later.
async function uploadMediaImage(file, pathPrefix, id) {
  const ext = (file.mimetype.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const objectPath = `${pathPrefix}/${id}.${ext}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: true, // overwrite on re-upload — one avatar/banner per id, no versioning needed
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

// JS-side mirror of the Postgres slugify() function used in the artists
// migration — needed here so /api/artists/create can predict/generate a
// slug for a brand-new artist row without a round-trip just to read back
// what the DB-side default would have produced (there is no DB-side
// default; the column is NOT NULL with no default, by design, so every
// insert path must supply one explicitly).
function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Generates a unique slug by suffixing -2, -3, ... on collision. Small
// number of round-trips in the worst case (one per existing collision),
// acceptable because artist creation is a rare, user-initiated action, not
// a hot path like dbResolveArtist's per-play resolution.
async function dbGenerateUniqueArtistSlug(name) {
  const base = slugify(name) || 'artist';
  let candidate = base;
  let n = 2;
  while (true) {
    const { data } = await supabase.from('artists').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${n++}`;
  }
}

// ─── Supabase DB helpers ──────────────────────────────────────────────────────
// All auth state now lives in Supabase. No local file, no in-memory Maps.

// Single canonical normalizer for usernames — every place that turns raw
// user input into a lookup/storage key (signup, signin, profile lookups,
// etc.) MUST go through this function, never trim()+toLowerCase() on its
// own. Previously signup stripped spaces/special characters
// (.replace(/[^a-z0-9_]/g, '')) while signin only trimmed + lowercased —
// so an account created from "Slimey 2017" was stored as "slimey2017", but
// signing in with "Slimey 2017" produced the lookup key "slimey 2017",
// which never matched. That's exactly the "founder account not recognized
// unless I remove the space" regression. Centralizing the rule here means
// signup and signin (and anything else that needs a username key) can
// never drift apart again.
function normalizeUsername(username) {
  return (username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// “FREQ Notices” is a server-controlled identity, never a user, artist, or
// group display name. The official badge and dedicated inbox are the primary
// authenticity signal; this reservation also blocks obvious look-alike names.
function isProtectedFreqNoticeIdentity(value) {
  const compact = String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  return compact === 'freqnotice' || compact.startsWith('freqnotices');
}

async function refreshAccountAgeGroup(account) {
  if (!account?.birthdate) return account;
  try {
    const derived = computeAgeGroup(String(account.birthdate).slice(0, 10)).ageGroup;
    if (derived === account.age_group) return account;
    const { error } = await supabase.from('accounts').update({ age_group: derived }).eq('username', account.username);
    if (error) throw new Error(error.message);
    return { ...account, age_group: derived };
  } catch (err) {
    console.error('[db] refreshAccountAgeGroup:', err.message);
    return account;
  }
}

async function dbGetAccount(username) {
  // Always normalize through the single shared rule — see normalizeUsername
  // above for why this can't just be trim()+toLowerCase() anymore.
  const key = normalizeUsername(username);
  if (!key) return null;
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('username', key)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getAccount:', error.message);
  return data ? await refreshAccountAgeGroup(data) : null;
}

// Normalizes an email the same way for every lookup/write: trimmed,
// lowercased. Mirrors normalizeUsername's role for usernames — anything
// that turns raw email input into a comparison/storage value MUST go
// through this, so "User@X.com" at signup and "user@x.com" at a later
// lookup are always treated as the same address (this also matches the
// accounts_email_unique_idx migration, which indexes lower(email)).
function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

// Very loose shape check, shared by signup (where it gates account
// creation) and premium verify (where it only decides which email to
// search a provider by). Deliberately not strict RFC 5322 validation —
// the real confirmation that an email is genuine is that mail sent to it
// works, which this app doesn't (yet) verify via a confirmation link, and
// for premium verify the address is never trusted/stored unless a provider
// itself confirms it as the purchaser email on a matched sale. Just enough
// to reject empty/garbage input before it goes into a query or a fetch().
function looksLikeEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254;
}

// Used at signup to reject a duplicate email up front with a clean 409,
// the same pattern dbGetAccount()+the existing-username check already uses
// — see the accounts_email_unique_idx migration for the DB-level backstop
// this pre-check is meant to make unnecessary in the common case.
async function dbGetAccountByEmail(email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .ilike('email', key)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') console.error('[db] getAccountByEmail:', error.message);
  return data ? await refreshAccountAgeGroup(data) : null;
}

async function dbGetPremiumSubscription(provider, providerPurchaseId) {
  const { data, error } = await supabase
    .from('premium_subscriptions')
    .select('*')
    .eq('provider', provider)
    .eq('provider_purchase_id', providerPurchaseId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') console.error('[db] getPremiumSubscription:', error.message);
  return data || null;
}

async function dbCreatePremiumSubscription({ username, provider, providerCustomerId, providerPurchaseId, purchaserEmail, purchaseDate, plan, recurrence, isTestPurchase }) {
  const { data, error } = await supabase.from('premium_subscriptions').insert({
    username,
    provider,
    provider_customer_id: providerCustomerId,
    provider_purchase_id: providerPurchaseId,
    purchaser_email: purchaserEmail,
    purchase_date: purchaseDate ? new Date(purchaseDate).toISOString() : new Date().toISOString(),
    plan,
    recurrence: recurrence || null,
    is_test_purchase: !!isTestPurchase,
    created_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbActivatePremiumAccount(username, plan, provider, providerCustomerId, providerPurchaseId, purchaserEmail, purchaseDate, extra = {}) {
  const patch = {
    is_premium: extra.isPremium ?? true,
    premium_plan: plan,
    premium_provider: provider,
    premium_provider_customer_id: providerCustomerId,
    premium_provider_purchase_id: providerPurchaseId,
    premium_purchase_date: purchaseDate ? new Date(purchaseDate).toISOString() : new Date().toISOString(),
    premium_email: purchaserEmail,
  };
  if (extra.status) patch.premium_status = extra.status;
  if (extra.expiresAt) patch.premium_expires_at = new Date(extra.expiresAt).toISOString();
  if (extra.graceUntil) patch.premium_grace_until = new Date(extra.graceUntil).toISOString();
  if (extra.trialUntil) patch.premium_trial_until = new Date(extra.trialUntil).toISOString();
  if (extra.cancelledAt) patch.premium_cancelled_at = new Date(extra.cancelledAt).toISOString();
  if (extra.failureReason) patch.premium_failure_reason = extra.failureReason;
  if (extra.lastEventType) patch.premium_last_event = extra.lastEventType;
  // Billing cadence ('monthly'/'yearly'/etc), used only to project an
  // estimated next-renewal date client-side — never treated as an exact
  // provider-confirmed charge date. `extra.recurrence` is allowed to be
  // explicitly null (provider stopped reporting a recognizable interval,
  // e.g. after switching plans), so this checks `!== undefined` rather
  // than truthiness like the fields above.
  if (extra.recurrence !== undefined) patch.premium_recurrence = extra.recurrence;

  const { error } = await supabase.from('accounts').update(patch).eq('username', normalizeUsername(username));
  if (error) throw new Error(error.message);
}

async function dbUpdatePremiumSubscriptionMetadata({ username, provider, providerPurchaseId, status, cancelledAt, expiresAt, graceUntil, trialUntil, recurrence, failureReason, lastEventType }) {
  if (!providerPurchaseId) return;
  const patch = {};
  if (status) patch.status = status;
  if (cancelledAt) patch.canceled_at = new Date(cancelledAt).toISOString();
  if (expiresAt) patch.expires_at = new Date(expiresAt).toISOString();
  if (graceUntil) patch.grace_until = new Date(graceUntil).toISOString();
  if (trialUntil) patch.trial_until = new Date(trialUntil).toISOString();
  if (recurrence !== undefined) patch.recurrence = recurrence;
  if (failureReason) patch.failure_reason = failureReason;
  if (lastEventType) patch.last_event_type = lastEventType;
  if (username) patch.username = normalizeUsername(username);
  if (!Object.keys(patch).length) return;

  const { error } = await supabase.from('premium_subscriptions')
    .update(patch)
    .eq('provider', provider)
    .eq('provider_purchase_id', String(providerPurchaseId));
  if (error) console.warn('[db] updatePremiumSubscriptionMetadata:', error.message);
}

// Stamps accounts.premium_last_verified_at so verifyPremiumIfDue knows when
// an account was last checked against its provider. Best-effort by design:
// if the premium_last_verified_at column hasn't been migrated into the
// accounts table yet, Supabase returns a column-not-found error here, which
// is swallowed rather than thrown — every login simply re-verifies (correct
// behavior, just unthrottled) until the migration lands, instead of the
// whole login/pull path breaking on a missing column.
async function dbTouchPremiumVerifiedAt(username) {
  const key = normalizeUsername(username);
  if (!key) return;
  const { error } = await supabase
    .from('accounts')
    .update({ premium_last_verified_at: new Date().toISOString() })
    .eq('username', key);
  if (error) console.warn('[db] touchPremiumVerifiedAt (non-fatal, likely missing column):', error.message);
}

// Number of calendar months to advance for each recognized recurrence
// value — used only to *project* a next-renewal date from a known purchase
// date, never as a substitute for a real provider-reported charge date.
const RECURRENCE_MONTHS = {
  monthly: 1,
  quarterly: 3,
  biannually: 6,
  yearly: 12,
};

// Adds `months` calendar months to `date`, matching the way billing
// providers roll a subscription forward (e.g. Jan 31 + 1 month → Feb 28,
// not Mar 3). Used for both the "next renewal" projection (active
// subscriptions) and the "access ends" projection (cancelled ones), since
// both are "purchase date advanced by N billing periods."
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // If the day rolled over (e.g. Jan 31 -> Mar 3 because Feb has no 31st),
  // pull back to the last day of the intended month instead.
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
}

// Projects the next billing-cycle boundary strictly after `now` by walking
// forward from `purchaseDate` in `intervalMonths`-month steps. Used both to
// project when an *active* subscription will next renew, and — for a
// cancelled one — to project when the current (already-paid-for) period
// runs out, since Gumroad and most providers let a cancelled membership
// keep access until the end of the period it already paid for.
function projectNextBillingDate(purchaseDate, intervalMonths, now = new Date()) {
  if (!purchaseDate || !intervalMonths) return null;
  const start = new Date(purchaseDate);
  if (Number.isNaN(start.getTime())) return null;

  let next = start;
  // Bounded to 1000 iterations (83+ years of monthly cycles) purely as a
  // sanity backstop against a corrupt/garbage purchase date looping forever
  // — normal accounts resolve in a handful of steps.
  for (let i = 0; i < 1000; i++) {
    next = addMonths(next, intervalMonths);
    if (next.getTime() > now.getTime()) return next.toISOString();
  }
  return null;
}

function getPremiumStatusFromAccount(account) {
  const status = String(account?.premium_status || account?.premium_state || '').toLowerCase();
  const recurrence = account?.premium_recurrence || null;
  const intervalMonths = RECURRENCE_MONTHS[recurrence] || null;
  const purchaseDate = account?.premium_purchase_date || null;
  const cancelledAt = account?.premium_cancelled_at || null;
  const isActive = !!account?.is_premium;

  // Only project a date when we have both a known interval and a purchase
  // date to project from — otherwise leave it null rather than guessing,
  // so the frontend can show an honest "unavailable" state instead of a
  // fabricated one.
  const projectedDate = (isActive && purchaseDate && intervalMonths)
    ? projectNextBillingDate(purchaseDate, intervalMonths)
    : null;

  return {
    isActive,
    status: status || (isActive ? 'active' : 'inactive'),
    plan: account?.premium_plan || null,
    provider: account?.premium_provider || null,
    purchaseDate,
    expiresAt: account?.premium_expires_at || null,
    graceUntil: account?.premium_grace_until || null,
    trialUntil: account?.premium_trial_until || null,
    canceledAt: cancelledAt,
    recurrence,
    // isActive && !cancelledAt  → this is a forward "next charge" projection.
    // isActive && cancelledAt   → this is "when current access runs out"
    //                             (same math: purchase date + N periods),
    //                             since a cancelled Gumroad membership keeps
    //                             access through its already-paid period.
    // Either way it's an ESTIMATE derived from purchase date + recurrence,
    // not a value the provider hands back directly — the frontend must
    // label it as such.
    projectedRenewalOrEndDate: projectedDate,
    isEstimatedDate: !!projectedDate,
    failureReason: account?.premium_failure_reason || null,
    lastEventType: account?.premium_last_event || null,
    lastVerifiedAt: account?.premium_last_verified_at || null,
  };
}

// Small bundle of DB helpers handed to lib/premiumVerification.js, so that
// module can stay free of any direct Supabase/schema knowledge — it only
// ever calls these named functions, never touches `supabase` itself. Every
// key here is required by premiumVerification.js's destructuring; adding a
// new field there means adding the matching function/property here too.
const premiumDb = {
  normalizeUsername,
  dbGetAccount,
  dbGetPremiumSubscription,
  dbCreatePremiumSubscription,
  dbActivatePremiumAccount,
  dbUpdatePremiumSubscriptionMetadata,
  dbTouchPremiumVerifiedAt,
  getPremiumStatusFromAccount,
};

async function dbCreateAccount(username, displayName, salt, hash, email, extra = {}) {
  const patch = {
    username, display_name: displayName, salt, hash, email: email || null, created_at: new Date().toISOString()
  };
  // Part 7/9 signup fields — all optional at the DB level (existing
  // pre-Phase-4 accounts have none of these) but required going forward by
  // the signup route itself, same pattern as `email` above: the column
  // stays nullable so this function keeps working for any other future
  // caller, while POST /api/auth/signup is what actually enforces presence.
  if (extra.birthdate) patch.birthdate = extra.birthdate;
  if (extra.ageGroup) patch.age_group = extra.ageGroup;
  if (extra.country) patch.country = extra.country;
  if (extra.termsAcceptedAt) patch.terms_accepted_at = extra.termsAcceptedAt;
  if (extra.privacyAcceptedAt) patch.privacy_accepted_at = extra.privacyAcceptedAt;

  const { error } = await supabase.from('accounts').insert(patch);
  if (error) throw new Error(error.message);
}

// ─── Profiles (public-facing, deliberately separate from accounts) ───────────
// accounts holds salt/hash — credential material that must never be
// reachable via a "get public profile" code path. profiles holds only what's
// safe to show a stranger, so a careless select('*') here can't ever leak a
// password hash, today or after any future refactor.

// Creates a profile row at signup, public by default, seeded with the same
// display name the account starts with. This now THROWS on failure rather
// than logging and continuing — a previous version treated this as
// best-effort ("a missing profile row degrades gracefully"), but in
// practice a missing row doesn't degrade anything gracefully: the account
// works fine for playback/playlists, but silently never appears in Find a
// User or Discovery, and its own visibility/bio toggle has nothing to
// update. That's exactly what happened to one real account before this
// fix — confusing for the user, invisible to them, and only debuggable by
// querying the database directly. Better to fail signup loudly (the
// account row can simply be re-created by signing up again) than succeed
// with a half-broken account that looks fine until someone tries to find it.
async function dbCreateProfile(username, displayName) {
  const { error } = await supabase.from('profiles').insert({
    username, display_name: displayName,
  });
  if (error) throw new Error(error.message);
}

// Idempotent safety net: ensures a profile row exists for `username`,
// creating one with sane defaults if it's missing. Called on every signin
// (cheap — one indexed SELECT in the common case where the row already
// exists) so that if dbCreateProfile's signup-time throw is ever somehow
// bypassed, or a profile row is lost some other way in the future, the
// account self-heals on next login rather than staying invisible until
// someone notices and runs a manual SQL backfill.
async function dbEnsureProfile(username, displayName) {
  const existing = await dbGetProfile(username);
  if (existing) return;
  try {
    await dbCreateProfile(username, displayName);
    console.log(`[db] ensureProfile: backfilled missing profile row for ${username}`);
  } catch (err) {
    // Don't block signin over this — log loudly so it's noticed, but a
    // signin must still succeed even if the backfill attempt itself fails.
    console.error(`[db] ensureProfile: failed to backfill profile for ${username}:`, err.message);
  }
}

async function dbGetProfile(username) {
  const key = normalizeUsername(username);
  if (!key) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', key)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getProfile:', error.message);
  return data || null;
}

// Partial update — only fields present in `patch` are touched. Used by
// PATCH /api/profiles/me so the client can send just { bio } or just
// { isPublic } without clobbering the rest of the row.
async function dbUpdateProfile(username, patch) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('username', username)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ─── Follows ──────────────────────────────────────────────────────────────────
// follower_count/following_count on `profiles` are maintained by a Postgres
// trigger (trg_follow_counts) on every insert/delete here — never count(*)
// live from the server, the trigger already keeps profiles in sync.

// Returns true on a new follow, false if the follow already existed (treated
// as a harmless no-op by the route, not an error — clicking "follow" twice
// shouldn't surface a failure to the user).
async function dbFollowUser(followerUsername, followedUsername) {
  const { error } = await supabase.from('follows').insert({
    follower_username: followerUsername, followed_username: followedUsername,
  });
  if (error) {
    if (error.code === '23505') return false; // unique violation — already following
    throw new Error(error.message);
  }
  return true;
}

async function dbUnfollowUser(followerUsername, followedUsername) {
  const { error } = await supabase.from('follows')
    .delete()
    .eq('follower_username', followerUsername)
    .eq('followed_username', followedUsername);
  if (error) throw new Error(error.message);
}

async function dbIsFollowing(followerUsername, followedUsername) {
  const { data, error } = await supabase.from('follows')
    .select('follower_username')
    .eq('follower_username', followerUsername)
    .eq('followed_username', followedUsername)
    .maybeSingle();
  if (error) { console.error('[db] isFollowing:', error.message); return false; }
  return !!data;
}

// Paginated list of usernames following / followed by `username`, joined
// against profiles for display data. Simple offset pagination — follower
// lists don't grow anywhere near the size where keyset pagination's extra
// complexity would pay for itself at this app's scale.
//
// is_public is filtered IN THE QUERY (via the !inner embed hint), not after
// the fetch — filtering post-fetch would paginate over the unfiltered join
// and then trim the page down, which desyncs `offset` from what the caller
// thinks they've paged through (a page of 50 could come back with only a
// handful of public rows, and "load more" would skip or re-show users
// depending on where private accounts happened to fall in the order).
async function dbGetFollowers(username, { limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('follows')
    .select('follower_username, created_at, profiles:follower_username!inner(username, display_name, bio, is_public)')
    .eq('followed_username', username)
    .eq('profiles.is_public', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.error('[db] getFollowers:', error.message); return []; }
  return (data || []).map(r => r.profiles).filter(Boolean);
}

async function dbGetFollowing(username, { limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('follows')
    .select('followed_username, created_at, profiles:followed_username!inner(username, display_name, bio, is_public)')
    .eq('follower_username', username)
    .eq('profiles.is_public', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.error('[db] getFollowing:', error.message); return []; }
  return (data || []).map(r => r.profiles).filter(Boolean);
}

// ─── Playlists v2 (relational — for Public/Shared Playlists) ─────────────────
// `playlists_v2` + `playlist_tracks` already exist in the live schema with
// RLS read policies in place (public playlists + their tracks are
// SELECT-able by anyone; everything else is default-deny, bypassed here via
// the service role key same as every other table in this file). No write
// policies exist by design — every write goes through these helpers, never
// directly from the client.
//
// `track_data` stores the resolved track shape verbatim (the same
// { platform, type, embedUrl, id, title, ... } object your resolvers
// already produce) rather than a foreign key into a canonical tracks
// table. Deliberate scope cut: a canonical tracks table buys cross-
// playlist dedup and play counting, neither of which Public/Shared
// Playlists need. Revisit only if/when Charts needs to count plays across
// duplicate adds of the same track in different playlists.

async function dbCreatePlaylist(owner, { name, description, isPublic = false }) {
  const { data, error } = await supabase
    .from('playlists_v2')
    .insert({ owner, name, description: description || null, is_public: !!isPublic })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbGetPlaylist(id) {
  const { data, error } = await supabase
    .from('playlists_v2')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.error('[db] getPlaylist:', error.message); return null; }
  return data;
}

// Ownership-scoped update — filters by owner IN the query itself, never
// "fetch then check .owner === username in JS", matching the cloud_files
// discipline. Returns null if no row matched, which the caller treats as
// "not found or not yours" — same 404-not-403 logic as profiles, so a
// forged id in the URL can't be used to probe whether a playlist exists.
async function dbUpdatePlaylistMeta(id, owner, patch) {
  const { data, error } = await supabase
    .from('playlists_v2')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner', owner)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function dbDeletePlaylist(id, owner) {
  const { error } = await supabase
    .from('playlists_v2')
    .delete()
    .eq('id', id)
    .eq('owner', owner);
  if (error) throw new Error(error.message);
}

async function dbGetUserPlaylists(owner, { onlyPublic = false } = {}) {
  let q = supabase.from('playlists_v2').select('*').eq('owner', owner).order('updated_at', { ascending: false });
  if (onlyPublic) q = q.eq('is_public', true);
  const { data, error } = await q;
  if (error) { console.error('[db] getUserPlaylists:', error.message); return []; }
  return data || [];
}

async function dbGetPlaylistTracks(playlistId) {
  const { data, error } = await supabase
    .from('playlist_tracks')
    .select('id, position, track_data, added_by, added_at')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true });
  if (error) { console.error('[db] getPlaylistTracks:', error.message); return []; }
  return data || [];
}

// track_count is maintained here in application code, not via a Postgres
// trigger (unlike profiles.follower_count) — fine at this scale, but means
// any future bulk-import path that writes to playlist_tracks directly
// (bypassing this helper) will cause track_count to drift. Flagging as a
// conscious tradeoff rather than something to silently fix later.
async function dbAddTrackToPlaylist(playlistId, owner, trackData, addedBy) {
  const { count } = await supabase
    .from('playlist_tracks')
    .select('id', { count: 'exact', head: true })
    .eq('playlist_id', playlistId);
  const nextPosition = count || 0;

  const { data, error } = await supabase
    .from('playlist_tracks')
    .insert({ playlist_id: playlistId, position: nextPosition, track_data: trackData, added_by: addedBy })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await supabase.from('playlists_v2')
    .update({ track_count: nextPosition + 1, updated_at: new Date().toISOString() })
    .eq('id', playlistId).eq('owner', owner);
  return data;
}

// Returns the deleted row (pre-delete) so the caller can log a reversible
// edit-history entry with the exact track_data/position needed for undo —
// select-then-delete rather than delete-and-hope, since Postgres DELETE
// doesn't hand back the row unless asked via .select().
async function dbRemoveTrackFromPlaylist(playlistId, owner, trackRowId) {
  const { data: deletedRow, error } = await supabase
    .from('playlist_tracks')
    .delete()
    .eq('id', trackRowId)
    .eq('playlist_id', playlistId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);

  const { count } = await supabase
    .from('playlist_tracks')
    .select('id', { count: 'exact', head: true })
    .eq('playlist_id', playlistId);
  await supabase.from('playlists_v2')
    .update({ track_count: count || 0, updated_at: new Date().toISOString() })
    .eq('id', playlistId).eq('owner', owner);

  return deletedRow || null;
}

// Public playlists belonging to `username` — for the public profile viewer.
// No private playlists are ever returned by this helper, regardless of who
// is asking, since it's used by an endpoint with no concept of "viewing
// your own profile" auth bypass (that's `dbGetUserPlaylists` without
// onlyPublic, used only by the owner's own /api/playlists/mine route).
async function dbGetPublicPlaylistsForUser(username) {
  return dbGetUserPlaylists(username, { onlyPublic: true });
}

// ─── Playlist Likes ─────────────────────────────────────────────────────────
// playlist_likes is a pure join table (playlist_id, username) — no RLS write
// policies, same as playlist_tracks/playlists_v2; every write goes through
// these helpers via the service role. like_count on playlists_v2 is
// maintained here in application code rather than a trigger, matching the
// existing track_count tradeoff exactly (see comment above dbAddTrackToPlaylist).
//
// Liking is idempotent at the route level (liking an already-liked playlist
// is a no-op success, not an error) so the frontend heart button never has
// to track local "did I already like this" state before firing the request.

async function dbLikePlaylist(playlistId, username) {
  // Upsert avoids a duplicate-key error on double-click / multi-tab races;
  // ignoreDuplicates means a second insert of the same pair is silently a
  // no-op rather than an error, and below we only bump like_count when a
  // row was actually inserted (not on the no-op branch).
  const { data, error } = await supabase
    .from('playlist_likes')
    .upsert({ playlist_id: playlistId, username }, { onConflict: 'playlist_id,username', ignoreDuplicates: true })
    .select();
  if (error) throw new Error(error.message);
  const inserted = (data || []).length > 0;
  if (inserted) {
    const { count } = await supabase
      .from('playlist_likes')
      .select('username', { count: 'exact', head: true })
      .eq('playlist_id', playlistId);
    await supabase.from('playlists_v2').update({ like_count: count || 0 }).eq('id', playlistId);
    return count || 0;
  }
  // Already liked — return the current count without re-counting needlessly.
  const pl = await dbGetPlaylist(playlistId);
  return pl ? pl.like_count : 0;
}

async function dbUnlikePlaylist(playlistId, username) {
  const { error } = await supabase
    .from('playlist_likes')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('username', username);
  if (error) throw new Error(error.message);
  const { count } = await supabase
    .from('playlist_likes')
    .select('username', { count: 'exact', head: true })
    .eq('playlist_id', playlistId);
  await supabase.from('playlists_v2').update({ like_count: count || 0 }).eq('id', playlistId);
  return count || 0;
}

async function dbHasLiked(playlistId, username) {
  if (!username) return false;
  const { data, error } = await supabase
    .from('playlist_likes')
    .select('playlist_id')
    .eq('playlist_id', playlistId)
    .eq('username', username)
    .maybeSingle();
  if (error) { console.error('[db] hasLiked:', error.message); return false; }
  return !!data;
}

// Playlists `username` has liked — for the Liked Playlists panel.
// Joins through to playlists_v2 and filters out anything that's gone
// private or been deleted since the like was made, same defensive pattern
// as dbGetSharedWithMe filtering out playlists_v2-null rows.
async function dbGetLikedPlaylists(username) {
  const { data, error } = await supabase
    .from('playlist_likes')
    .select('created_at, playlists_v2(id, name, description, is_public, track_count, like_count, owner)')
    .eq('username', username)
    .order('created_at', { ascending: false });
  if (error) { console.error('[db] getLikedPlaylists:', error.message); return []; }
  return (data || [])
    .filter(r => r.playlists_v2 && r.playlists_v2.is_public)
    .map(r => ({
      likedAt: r.created_at,
      id: r.playlists_v2.id, name: r.playlists_v2.name,
      description: r.playlists_v2.description,
      trackCount: r.playlists_v2.track_count,
      likeCount: r.playlists_v2.like_count,
      owner: r.playlists_v2.owner,
      updatedAt: r.playlists_v2.updated_at,
    }));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ARTISTS
// ═══════════════════════════════════════════════════════════════════════════════
// An artist is EITHER an auto-created metadata row (account_id NULL — exists
// purely because tracks with that artist name have been played/uploaded; no
// one can sign in as it, its page is read-only to everyone) OR a claimed row
// (account_id set — a real FREQ account owns it and can edit name/bio/
// avatar/banner). Both are the exact same row shape and go through the exact
// same API — claiming is just an UPDATE, never a data migration. See the
// migration comments on the `artists` table for the full reasoning.
//
// normalizeArtistName is the dedup key generator: lowercase, trim, collapse
// internal whitespace, strip a leading "the " and trailing "(official)"/
// "- topic" noise that's common in scraped/ID3 metadata. This intentionally
// stays simple (no fuzzy/Levenshtein matching) — exact-after-normalization
// is the right tradeoff for now: it merges "Drake" / "drake " / "DRAKE"
// without any risk of merging two actually-different artists who happen to
// have similar names, which a fuzzy matcher could do silently and
// incorrectly.
function normalizeArtistName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^the\s+/, '');
  s = s.replace(/\s*-\s*topic$/, '');       // YouTube auto-generated "Artist - Topic" channels
  s = s.replace(/\s*\(official\)$/, '');
  s = s.trim();
  return s || null;
}

// Resolves an artist name to an artists.id, creating an unclaimed row if no
// existing artist (claimed or not) matches the normalized name. Read-first,
// same shape as dbGetOrCreateTrack just above this for the identical reason:
// this runs on every play that carries an artist name, so the common case
// (artist already exists) should cost one SELECT, not an upsert.
//
// Ties to a CLAIMED artist take priority over creating a new unclaimed row
// when both could match — in practice this only matters once claiming
// exists at all, but the query order (search all artists by
// normalized_name, not just unclaimed ones) means a claimed artist always
// "wins" their own name without any special-case code needed here.
async function dbResolveArtist(rawName) {
  const normalized = normalizeArtistName(rawName);
  if (!normalized) return null;

  const { data: existing } = await supabase
    .from('artists').select('id').eq('normalized_name', normalized).limit(1).maybeSingle();
  if (existing) return existing.id;

  // Plain insert + catch-the-unique-violation, NOT .upsert() — the
  // uniqueness guarantee here lives on a PARTIAL index
  // (idx_artists_normalized_name_unclaimed, WHERE account_id IS NULL), and
  // supabase-js's upsert() onConflict target can't express a WHERE clause,
  // so it can't target a partial index at all. A plain insert naturally
  // hits that same partial index's constraint and raises 23505 on conflict,
  // which is the same race-handling shape dbFollowUser already uses below
  // for an ordinary (non-partial) unique constraint.
  //
  // slug is NOT NULL + unique on `artists`, so every insert path (auto-
  // created here from a play, or explicit via /api/artists/create) must
  // generate one up front — there's no DB-side default to fall back on.
  const slug = await dbGenerateUniqueArtistSlug(rawName);
  const { data, error } = await supabase
    .from('artists')
    .insert({ name: rawName.trim(), normalized_name: normalized, slug })
    .select('id')
    .single();
  if (!error) {
    // No need to insert into artist_stats here — trg_seed_artist_stats
    // (AFTER INSERT on artists) already created that row atomically as
    // part of the insert above. An earlier version of this function
    // duplicated that insert manually, which meant every single new-artist
    // creation silently threw and discarded a primary-key-violation error
    // on a redundant round-trip. Removed rather than left as dead code.
    return data.id;
  }
  if (error.code !== '23505') { console.error('[db] resolveArtist:', error.message); return null; }
  // Lost the race to a concurrent request creating the same artist —
  // re-select rather than treat this as a failure.
  const { data: row2 } = await supabase
    .from('artists').select('id').eq('normalized_name', normalized).maybeSingle();
  return row2 ? row2.id : null;
}

async function dbGetArtist(idOrAccountUsername) {
  // Accepts either an artists.id (uuid) or, for the "view my own claimed
  // artist page" convenience case, an account username — callers that
  // already know which they have should prefer the more specific
  // dbGetArtistById/dbGetArtistByAccount below; this exists for the route
  // layer where a single :id path param could plausibly be either in a
  // future "vanity URL" sense. Today it's only ever called with a uuid.
  return dbGetArtistById(idOrAccountUsername);
}

async function dbGetArtistById(id) {
  const { data, error } = await supabase.from('artists').select('*').eq('id', id).maybeSingle();
  if (error) { console.error('[db] getArtistById:', error.message); return null; }
  return data;
}

async function dbGetArtistByAccount(username) {
  const { data, error } = await supabase.from('artists').select('*').eq('account_id', username).maybeSingle();
  if (error) { console.error('[db] getArtistByAccount:', error.message); return null; }
  return data;
}

async function dbGetArtistBySlug(slug) {
  const { data, error } = await supabase.from('artists').select('*').eq('slug', slug).maybeSingle();
  if (error) { console.error('[db] getArtistBySlug:', error.message); return null; }
  return data;
}

async function dbGetArtistStats(artistId) {
  const { data, error } = await supabase.from('artist_stats').select('*').eq('artist_id', artistId).maybeSingle();
  if (error) { console.error('[db] getArtistStats:', error.message); return null; }
  return data;
}

async function dbGetLiveArtistStats(artistId, cachedStats = null) {
  // NOTE: intentionally NOT filtered by is_published. play_count/play_count_7d
  // accrue on a track from the moment it's first played, which can happen
  // before the artist ever runs it through the publish flow (e.g. it was
  // played as a plain external-URL track, or as an unpublished upload via
  // direct link). recomputeArtistStats (the cron that seeds artist_stats)
  // sums ALL of an artist's tracks for exactly this reason. This function
  // used to filter to is_published=true here, which silently undercounted
  // — sometimes to zero — for any artist whose plays sat mostly on
  // not-yet-published tracks, even though the real totals (visible in
  // artist_stats / recomputeArtistStats) were correct all along. Matching
  // that same "count everything" logic here is what actually fixes it,
  // rather than just falling back to a cached number when this query
  // happens to look low.
  const [followerResult, trackRowsResult, monthlyRowsResult] = await Promise.all([
    supabase.from('artist_followers')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', artistId),
    supabase.from('tracks')
      .select('play_count, play_count_7d')
      .eq('artist_id', artistId),
    supabase.from('track_plays')
      .select('username, tracks!inner(artist_id)')
      .eq('tracks.artist_id', artistId)
      .gte('played_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .not('username', 'is', null),
  ]);

  if (followerResult.error) console.error('[db] liveArtistStats followers:', followerResult.error.message);
  if (trackRowsResult.error) console.error('[db] liveArtistStats tracks:', trackRowsResult.error.message);
  if (monthlyRowsResult.error) console.error('[db] liveArtistStats listeners:', monthlyRowsResult.error.message);

  const tracks = trackRowsResult.data || [];
  const listenerNames = new Set((monthlyRowsResult.data || []).map(r => r.username).filter(Boolean));
  const totalPlays = tracks.reduce((sum, t) => sum + (Number(t.play_count) || 0), 0);
  const totalPlays7d = tracks.reduce((sum, t) => sum + (Number(t.play_count_7d) || 0), 0);

  return {
    followerCount: followerResult.count || 0,
    totalPlays,
    totalPlays7d,
    monthlyListeners: listenerNames.size,
    totalLikesReceived: Number(cachedStats?.total_likes_received) || 0,
    chartRank: cachedStats?.chart_rank ?? null,
    chartRankPrev: cachedStats?.chart_rank_prev ?? null,
  };
}

// Paginated artist directory — GET /api/artists. Default sort is
// follower_count since that's the most legible "who matters here" signal
// without requiring a join into artist_stats for the common listing case;
// sort=trending joins artist_stats for total_plays_7d instead.
async function dbListArtists({ sort = 'followers', limit = 30, offset = 0, search = null } = {}) {
  if (sort === 'trending') {
    const { data, error } = await supabase
      .from('artist_stats')
      .select('artist_id, total_plays_7d, artists!inner(*)')
      .order('total_plays_7d', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) { console.error('[db] listArtists trending:', error.message); return []; }
    return (data || []).map(r => r.artists);
  }
  let q = supabase.from('artists').select('*');
  if (search) q = q.ilike('name', `%${search}%`);
  q = sort === 'recent' ? q.order('created_at', { ascending: false }) : q.order('follower_count', { ascending: false });
  const { data, error } = await q.range(offset, offset + limit - 1);
  if (error) { console.error('[db] listArtists:', error.message); return []; }
  return data || [];
}

async function dbUpdateArtist(artistId, patch) {
  const { data, error } = await supabase
    .from('artists').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', artistId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Artist tracks (top tracks / most liked / trending) ─────────────────────
// "Most liked tracks" is intentionally NOT wired to a real number yet — see
// the artist_stats migration comment: FREQ has playlist likes, not
// per-track likes, so there is no honest source for this today. Rather than
// fabricate a number, likeCount is always 0 here until a track-like feature
// ships; the field exists in the response shape now so the frontend/API
// contract doesn't change later, only the value starts becoming real.
async function dbGetArtistTracks(artistId, { sort = 'plays', limit = 20, allowedRatings = null } = {}) {
  const col = sort === 'trending' ? 'play_count_7d' : 'play_count';
  let query = supabase
    .from('tracks')
    .select('id, original_url, platform, title, description, play_count, play_count_7d, last_played_at, cover_url, cloud_file_id, published_at, like_count, is_explicit, content_rating, content_rating_tags, content_rating_locked')
    .eq('artist_id', artistId)
    .eq('is_published', true);
  if (allowedRatings) query = query.in('content_rating', allowedRatings);
  const { data, error } = await query.order(col, { ascending: false }).limit(limit);
  if (error) { console.error('[db] getArtistTracks:', error.message); return []; }
  return data || [];
}

// ── Artist follows ──────────────────────────────────────────────────────────
// Mirrors dbFollowUser/dbUnfollowUser/dbIsFollowing exactly, just against
// artist_followers instead of follows. follower_count itself is maintained
// by the trg_artist_follower_counts trigger (see migration), not here — these
// helpers only ever touch artist_followers; nothing here writes to
// artists.follower_count directly, by design, so there's exactly one place
// that number can be wrong: the trigger, not N call sites.
async function dbFollowArtist(followerUsername, artistId) {
  const { error } = await supabase.from('artist_followers').insert({
    artist_id: artistId, follower_username: followerUsername,
  });
  if (error) {
    if (error.code === '23505') return false; // already following
    throw new Error(error.message);
  }
  // Safety-net recount in case the trigger is missing or lagging —
  // counts actual rows rather than relying purely on the trigger path.
  const { count } = await supabase.from('artist_followers')
    .select('*', { count: 'exact', head: true }).eq('artist_id', artistId);
  if (count != null) {
    await supabase.from('artists').update({ follower_count: count }).eq('id', artistId);
  }
  return true;
}

async function dbUnfollowArtist(followerUsername, artistId) {
  const { error } = await supabase.from('artist_followers')
    .delete().eq('artist_id', artistId).eq('follower_username', followerUsername);
  if (error) throw new Error(error.message);
  // Safety-net recount
  const { count } = await supabase.from('artist_followers')
    .select('*', { count: 'exact', head: true }).eq('artist_id', artistId);
  if (count != null) {
    await supabase.from('artists').update({ follower_count: count }).eq('id', artistId);
  }
}

async function dbIsFollowingArtist(followerUsername, artistId) {
  const { data, error } = await supabase.from('artist_followers')
    .select('artist_id').eq('artist_id', artistId).eq('follower_username', followerUsername).maybeSingle();
  if (error) { console.error('[db] isFollowingArtist:', error.message); return false; }
  return !!data;
}

// ── Artist releases (discography) ───────────────────────────────────────────
async function dbGetArtistReleases(artistId, { type = null, includeNonPublic = false, allowedRatings = null } = {}) {
  let q = supabase.from('artist_releases').select('*').eq('artist_id', artistId);
  if (type) q = q.eq('release_type', type);
  if (allowedRatings) q = q.in('content_rating', allowedRatings);
  // Visitors only see public releases; owner dashboard passes includeNonPublic:true
  if (!includeNonPublic) q = q.eq('visibility', 'public');
  const { data, error } = await q.order('release_date', { ascending: false, nullsFirst: false });
  if (error) { console.error('[db] getArtistReleases:', error.message); return []; }
  return data || [];
}

async function dbCreateRelease(artistId, { title, releaseType, coverUrl, releaseDate, visibility = 'public' }) {
  const safeVisibility = ['public', 'private', 'unlisted'].includes(visibility) ? visibility : 'public';
  const safeType = ['single', 'ep', 'album', 'mixtape', 'compilation'].includes(releaseType) ? releaseType : 'single';
  const { data, error } = await supabase.from('artist_releases').insert({
    artist_id: artistId, title, release_type: safeType,
    cover_url: coverUrl || null, release_date: releaseDate || null,
    visibility: safeVisibility,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Content ratings (Part 1/2 — track + album ratings) ─────────────────────
// Single source of truth for the rating vocabulary + severity ordering, used
// by publish/edit routes, the release recompute below, and the admin lock/
// override endpoints. 'adult' is intentionally the worst/highest severity —
// see recomputeReleaseContentRating's "worst track wins" rule.
const CONTENT_RATINGS = ['clean', 'parental_guidance', 'adult'];
const CONTENT_RATING_SEVERITY = { clean: 0, parental_guidance: 1, adult: 2 };
const CONTENT_RATING_TAGS = [
  'explicit_language', 'sexual_content', 'drug_reference', 'violence',
  'graphic_violence', 'horror', 'self_harm_reference', 'strong_themes',
];

function isValidContentRating(r) {
  return CONTENT_RATINGS.includes(r);
}

function sanitizeContentRatingTags(tags) {
  if (!Array.isArray(tags)) return [];
  const set = new Set(tags.filter(t => CONTENT_RATING_TAGS.includes(t)));
  return Array.from(set);
}

// Recomputes an album/release's content_rating from its member tracks per
// the Part 2 rule: worst-of-tracks wins (any 18+ -> album is 18+; else any
// PG -> album is PG; else clean). This is the recompute_release_content_rating()
// referenced in the artist_releases.content_rating column comment — implemented
// here in app code rather than a DB trigger, matching the track_count pattern
// directly below (dbAddTrackToRelease/dbRemoveTrackFromRelease). Called after
// any operation that changes release membership or a member track's rating.
// A release with zero tracks defaults to 'clean' (nothing to warn about yet).
async function recomputeReleaseContentRating(releaseId) {
  const { data: rows, error } = await supabase
    .from('artist_release_tracks')
    .select('tracks(content_rating)')
    .eq('release_id', releaseId);
  if (error) { console.error('[recompute release rating]', error.message); return; }
  let worst = 'clean';
  for (const row of rows || []) {
    const r = row.tracks?.content_rating;
    if (r && CONTENT_RATING_SEVERITY[r] > CONTENT_RATING_SEVERITY[worst]) worst = r;
  }
  await supabase.from('artist_releases')
    .update({ content_rating: worst, updated_at: new Date().toISOString() })
    .eq('id', releaseId);
}

// Adds a track to a release at the next position, then refreshes the
// release's track_count — same maintained-in-app-code pattern as
// dbAddTrackToPlaylist's track_count, for the same reason (no trigger
// justified for a count this simple, see that function's comment).
async function dbAddTrackToRelease(releaseId, trackId) {
  const { count } = await supabase
    .from('artist_release_tracks').select('id', { count: 'exact', head: true }).eq('release_id', releaseId);
  const position = count || 0;
  const { error } = await supabase.from('artist_release_tracks').insert({
    release_id: releaseId, track_id: trackId, position,
  });
  if (error) throw new Error(error.message);
  await supabase.from('artist_releases').update({ track_count: position + 1, updated_at: new Date().toISOString() }).eq('id', releaseId);
  await recomputeReleaseContentRating(releaseId);
}

// Deletes the release row itself. artist_release_tracks rows pointing at it
// cascade-delete via their release_id FK (ON DELETE CASCADE — see migration),
// which only removes the *junction* rows, not the underlying tracks — a
// deleted release un-links its tracks back to standalone published tracks
// rather than deleting the music itself. That's deliberate: removing a
// release (e.g. an EP) shouldn't silently delete songs an artist still
// wants live on their page as standalone tracks.
async function dbDeleteRelease(releaseId) {
  const { error } = await supabase.from('artist_releases').delete().eq('id', releaseId);
  if (error) throw new Error(error.message);
}

// Partial update for release metadata — title, cover_url, release_date, and
// description are the only mutable fields. release_type is intentionally NOT
// patchable after creation (changing "Album" to "EP" post-hoc is confusing
// and rarely correct; delete + recreate is the right escape hatch for that).
async function dbUpdateRelease(releaseId, patch) {
  // Guard visibility against invalid values
  if (patch.visibility !== undefined) {
    patch.visibility = ['public', 'private', 'unlisted'].includes(patch.visibility)
      ? patch.visibility : 'public';
  }
  const { data, error } = await supabase
    .from('artist_releases')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', releaseId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Removes a single track from a release (junction row only — the track itself
// is not deleted). Recounts track_count after removal.
async function dbRemoveTrackFromRelease(releaseId, trackId) {
  const { error } = await supabase
    .from('artist_release_tracks')
    .delete()
    .eq('release_id', releaseId)
    .eq('track_id', trackId);
  if (error) throw new Error(error.message);
  const { count } = await supabase
    .from('artist_release_tracks')
    .select('id', { count: 'exact', head: true })
    .eq('release_id', releaseId);
  await supabase.from('artist_releases')
    .update({ track_count: count || 0, updated_at: new Date().toISOString() })
    .eq('id', releaseId);
  await recomputeReleaseContentRating(releaseId);
}

async function dbGetReleaseTracks(releaseId, { allowedRatings = null } = {}) {
  const { data, error } = await supabase
    .from('artist_release_tracks')
    .select('position, tracks(id, original_url, platform, title, play_count, like_count, cover_url, cloud_file_id, artist_id, artist_name, is_explicit, content_rating, content_rating_tags)')
    .eq('release_id', releaseId)
    .order('position', { ascending: true });
  if (error) { console.error('[db] getReleaseTracks:', error.message); return []; }
  const allowed = allowedRatings ? new Set(allowedRatings) : null;
  return (data || [])
    .filter(r => r.tracks && (!allowed || allowed.has(r.tracks.content_rating || 'clean')))
    .map(r => ({ ...r.tracks, position: r.position }));
}

// ── Track Lyrics ────────────────────────────────────────────────────────────
async function dbGetTrackLyrics(trackId) {
  const { data, error } = await supabase
    .from('track_lyrics').select('*').eq('track_id', trackId).maybeSingle();
  if (error) { console.error('[db] getTrackLyrics:', error.message); return null; }
  return data;
}

async function dbUpsertTrackLyrics(trackId, lyrics) {
  const { data, error } = await supabase
    .from('track_lyrics')
    .upsert({ track_id: trackId, lyrics, updated_at: new Date().toISOString() }, { onConflict: 'track_id' })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbDeleteTrackLyrics(trackId) {
  const { error } = await supabase.from('track_lyrics').delete().eq('track_id', trackId);
  if (error) throw new Error(error.message);
}

// ── Artist collaborations (Featured/Collaborator/Producer/Contributor) ─────
// XOR check (exactly one of track_id/release_id is set per row) — see
// migration create_artist_collaborations. collaborator_artist_id always
// points at an artists row regardless of whether that artist page has been
// claimed by an account, so an unclaimed/placeholder artist (e.g. a
// producer who hasn't signed up yet) can still be credited.
const COLLAB_ROLES = ['featured', 'collaborator', 'producer', 'contributor'];

// Shared select shape for both track and release collaborator lookups — the
// joined artists row gives the frontend everything it needs to render a
// credit (name/slug/avatar) without a second round trip per collaborator.
const COLLAB_SELECT = 'id, role, track_id, release_id, collaborator_artist_id, added_by, created_at, ' +
  'artists:collaborator_artist_id(id, name, slug, avatar_url, is_verified)';

async function dbGetTrackCollaborators(trackId) {
  const { data, error } = await supabase
    .from('artist_collaborations')
    .select(COLLAB_SELECT)
    .eq('track_id', trackId)
    .order('role', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) { console.error('[db] getTrackCollaborators:', error.message); return []; }
  return data || [];
}

async function dbGetReleaseCollaborators(releaseId) {
  const { data, error } = await supabase
    .from('artist_collaborations')
    .select(COLLAB_SELECT)
    .eq('release_id', releaseId)
    .order('role', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) { console.error('[db] getReleaseCollaborators:', error.message); return []; }
  return data || [];
}

// Batch lookup used by track-list endpoints (top tracks, search results) so
// rendering N tracks with their collaborator credits costs one query, not N.
// Returns a Map keyed by track_id -> array of collaborator rows.
async function dbGetCollaboratorsForTracks(trackIds) {
  if (!trackIds || !trackIds.length) return new Map();
  const { data, error } = await supabase
    .from('artist_collaborations')
    .select(COLLAB_SELECT)
    .in('track_id', trackIds)
    .order('role', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) { console.error('[db] getCollaboratorsForTracks:', error.message); return new Map(); }
  const map = new Map();
  for (const row of data || []) {
    if (!map.has(row.track_id)) map.set(row.track_id, []);
    map.get(row.track_id).push(row);
  }
  return map;
}

// addedByUsername is captured for audit purposes (artist_collaborations.added_by)
// — it's always the session username of whoever called the route, which the
// route handler has already verified owns the track/release being credited.
async function dbAddCollaborator({ trackId = null, releaseId = null, collaboratorArtistId, role, addedByUsername }) {
  const { data, error } = await supabase
    .from('artist_collaborations')
    .insert({
      track_id: trackId, release_id: releaseId,
      collaborator_artist_id: collaboratorArtistId, role,
      added_by: addedByUsername || null,
    })
    .select(COLLAB_SELECT)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('That artist already has this role on this item.');
    throw new Error(error.message);
  }
  return data;
}

async function dbRemoveCollaboration(collaborationId) {
  const { error } = await supabase.from('artist_collaborations').delete().eq('id', collaborationId);
  if (error) throw new Error(error.message);
}

async function dbGetCollaboration(collaborationId) {
  const { data, error } = await supabase
    .from('artist_collaborations').select('*').eq('id', collaborationId).maybeSingle();
  if (error) { console.error('[db] getCollaboration:', error.message); return null; }
  return data;
}

// Shapes a raw artist_collaborations row (with its joined artists row) into
// the flat credit object every API response below sends to the frontend.
function shapeCollaborator(row) {
  return {
    id: row.id,
    role: row.role,
    artistId: row.collaborator_artist_id,
    name: row.artists?.name || 'Unknown Artist',
    slug: row.artists?.slug || null,
    avatarUrl: row.artists?.avatar_url || null,
    isVerified: !!row.artists?.is_verified,
  };
}

// ── Periodic recompute: artist_stats + release rollups + artist chart rank ──
// Same philosophy as recomputeWeeklyPlayCounts: aggregate queries that don't
// need per-request freshness run on a timer instead of on every page view.
// Three things happen per pass:
//   1. total_plays / total_plays_7d per artist — summed from tracks, the
//      table that already carries both numbers per-track.
//   2. monthly_listeners — distinct usernames in track_plays over the
//      trailing 30 days, joined through tracks.artist_id. Anonymous plays
//      (username IS NULL) are correctly excluded — "listeners" means
//      identifiable people, an anonymous play has no listener to count.
//   3. chart_rank — every artist ranked by total_plays_7d descending;
//      chart_rank_prev is set to whatever chart_rank WAS before this pass
//      overwrites it, which is what makes "weekly movement" computable
//      (chart_rank_prev - chart_rank: positive = climbed, negative = fell).
async function recomputeArtistStats() {
  try {
    const { data: artists, error: artistsErr } = await supabase.from('artists').select('id, account_id');
    if (artistsErr) { console.error('[artists] recompute fetch artists:', artistsErr.message); return; }
    if (!artists || !artists.length) return;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Pull every artist's track totals in one query rather than N queries —
    // important here specifically because this job's cost scales with
    // artist count, unlike recomputeWeeklyPlayCounts which scales with
    // track count and was already doing this.
    const { data: trackRows, error: tracksErr } = await supabase
      .from('tracks').select('artist_id, play_count, play_count_7d').not('artist_id', 'is', null);
    if (tracksErr) { console.error('[artists] recompute fetch tracks:', tracksErr.message); return; }

    const totals = new Map(); // artist_id -> { plays, plays7d }
    for (const t of trackRows || []) {
      const cur = totals.get(t.artist_id) || { plays: 0, plays7d: 0 };
      cur.plays += t.play_count || 0;
      cur.plays7d += t.play_count_7d || 0;
      totals.set(t.artist_id, cur);
    }

    // Monthly listeners: distinct (artist_id, username) pairs from plays in
    // the last 30 days, joined through tracks. One query, grouped client-side
    // (Supabase's JS client has no GROUP BY; for this table's realistic size
    // — thousands, not millions, of rows per month — pulling raw rows and
    // reducing in Node is simpler and fast enough, the same tradeoff already
    // made in recomputeWeeklyPlayCounts).
    const { data: playRows, error: playsErr } = await supabase
      .from('track_plays')
      .select('username, tracks!inner(artist_id)')
      .gte('played_at', thirtyDaysAgo)
      .not('username', 'is', null);
    if (playsErr) { console.error('[artists] recompute fetch plays:', playsErr.message); return; }

    const listenerSets = new Map(); // artist_id -> Set(username)
    for (const p of playRows || []) {
      const aid = p.tracks?.artist_id;
      if (!aid) continue;
      if (!listenerSets.has(aid)) listenerSets.set(aid, new Set());
      listenerSets.get(aid).add(p.username);
    }

    // Rank by total_plays_7d desc for chart_rank. Artists with zero plays
    // get NULL rank (unranked), not a rank at the bottom of an arbitrary
    // tie-break order — "unranked" is a more honest state than "last place"
    // for an artist nobody has played yet.
    const ranked = [...totals.entries()]
      .filter(([, t]) => t.plays7d > 0)
      .sort((a, b) => b[1].plays7d - a[1].plays7d);
    const rankByArtist = new Map(ranked.map(([id], i) => [id, i + 1]));

    const { data: prevStats } = await supabase.from('artist_stats').select('artist_id, chart_rank');
    const prevRankByArtist = new Map((prevStats || []).map(r => [r.artist_id, r.chart_rank]));

    for (const artist of artists) {
      const t = totals.get(artist.id) || { plays: 0, plays7d: 0 };
      const monthlyListeners = listenerSets.get(artist.id)?.size || 0;
      const newRank = rankByArtist.get(artist.id) ?? null;
      const prevRank = prevRankByArtist.get(artist.id) ?? null;
      await supabase.from('artist_stats').upsert({
        artist_id: artist.id,
        total_plays: t.plays,
        total_plays_7d: t.plays7d,
        monthly_listeners: monthlyListeners,
        chart_rank: newRank,
        chart_rank_prev: prevRank,
        computed_at: new Date().toISOString(),
      }, { onConflict: 'artist_id' });

      // Write through to profiles.total_plays for claimed artists, so the
      // public profile page's "Total Plays" stat is real, not a separate
      // number that could drift from artist_stats. total_likes_received
      // stays at its existing default (0) here — there's no track-likes
      // table yet (see artist_stats.total_likes_received's own comment),
      // and writing a fabricated number would be worse than an honest 0.
      if (artist.account_id) {
        await supabase.from('profiles')
          .update({ total_plays: t.plays })
          .eq('username', artist.account_id);
      }
    }

    // Release rollups — total_plays per release, summed from the tracks
    // attached to it via artist_release_tracks. This column has existed on
    // artist_releases since the releases schema shipped, and this function's
    // own header comment already claimed to compute "release rollups", but
    // nothing ever actually wrote it — every release sat at a hardcoded 0
    // regardless of how many plays its tracks had. total_likes stays at its
    // existing default for the same reason totalLikesReceived does above:
    // there's no per-track likes table yet, so writing a real total_plays
    // but a fabricated total_likes would be inconsistent with that honesty
    // policy elsewhere in this function.
    const { data: releaseTrackRows, error: relTracksErr } = await supabase
      .from('artist_release_tracks')
      .select('release_id, tracks!inner(play_count)');
    if (relTracksErr) {
      console.error('[artists] recompute fetch release tracks:', relTracksErr.message);
    } else {
      const releasePlays = new Map(); // release_id -> summed play_count
      for (const row of releaseTrackRows || []) {
        const cur = releasePlays.get(row.release_id) || 0;
        releasePlays.set(row.release_id, cur + (row.tracks?.play_count || 0));
      }
      for (const [releaseId, plays] of releasePlays) {
        await supabase.from('artist_releases')
          .update({ total_plays: plays, updated_at: new Date().toISOString() })
          .eq('id', releaseId);
      }
    }
  } catch (err) {
    console.error('[artists] recompute failed:', err);
  }
}
// Same 10-minute cadence as recomputeWeeklyPlayCounts, and for the same
// reason — frequent enough that an artist page or chart feels responsive
// to recent activity without paying this query's cost on every request.
setInterval(recomputeArtistStats, 10 * 60 * 1000);
recomputeArtistStats(); // run once at boot

// Separate rate-limit bucket from followRateLimit (user follows) — an
// artist page realistically gets followed/unfollowed in quick succession
// while someone's browsing a directory of several artists, which is
// different traffic shape than following individual users one at a time.
// Same 30/min ceiling and same session-resolving structure either way.
async function artistFollowRateLimit(req, res, next) {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  req._followSession = sess;
  if (!sess) return next();
  const key = sess.username;
  const now = Date.now();
  const times = (artistFollowRateLimitHits.get(key) || []).filter(t => now - t < 60_000);
  times.push(now);
  artistFollowRateLimitHits.set(key, times);
  if (times.length > 30) {
    return res.status(429).json({ error: 'Too many follow/unfollow actions. Please slow down.' });
  }
  next();
}
const artistFollowRateLimitHits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of artistFollowRateLimitHits) {
    const fresh = times.filter(t => now - t < 60_000);
    if (!fresh.length) artistFollowRateLimitHits.delete(key); else artistFollowRateLimitHits.set(key, fresh);
  }
}, 300_000);

// ─── Community Charts (track plays) ─────────────────────────────────────────
// `tracks` is the first canonical-track table in FREQ — playlist_tracks
// deliberately stores track_data as verbatim jsonb (see the comment above
// dbCreatePlaylist), but ranking the same track across every playlist/queue
// it's ever been started from needs one stable row per track. originalUrl
// is that identity: it's already the frontend's own de-dup key
// (state.queue.some(q => q.originalUrl === item.originalUrl)), so this adds
// no new concept for the client — just a new place that URL gets POSTed.
//
// play_count is maintained in app code exactly like track_count/like_count
// elsewhere in this file. play_count_7d is different: it's a *rolling*
// window, so it can't just be incremented — it has to be recomputed from
// track_plays periodically (see recomputeWeeklyPlayCounts below), since an
// increment-only counter would never decrease as old plays age out of the
// window.

// Published FREQ tracks (platform:'freq'/'cloud') are looked up by their
// real tracks.id, never by originalUrl. The frontend's `cloud:<id>` string
// is a synthetic value built from whatever id the track-resolution endpoint
// handed back — but dbPublishTrack stores `cloud:<cloud_file_id>` as
// original_url, a DIFFERENT id than tracks.id. Matching on originalUrl for
// these tracks therefore always missed the real row and silently created a
// new phantom track per play (a second tracks row, never published, that
// absorbed every increment while the real row's play_count sat at 0
// forever — this is the root cause of "track plays don't increase"). A
// known trackId always wins over any originalUrl-based lookup/creation.
async function dbGetOrCreateTrack(originalUrl, platform, title, artistName, publishedTrackId) {
  if (publishedTrackId) {
    const { data: existing, error } = await supabase
      .from('tracks').select('id, artist_id, artist_name').eq('id', publishedTrackId).maybeSingle();
    if (error) { console.error('[db] getOrCreateTrack (by id):', error.message); return null; }
    // No fallback to originalUrl matching here on a miss — a trackId that
    // doesn't resolve means the track was deleted/unpublished mid-session,
    // and silently falling back to originalUrl would recreate the exact
    // phantom-row bug this branch exists to fix. dbLogPlay already returns
    // null cleanly for "no track" in that case.
    if (!existing) return null;
    if (!existing.artist_id && artistName) {
      const artistId = await dbResolveArtist(artistName);
      if (artistId) {
        await supabase.from('tracks').update({ artist_id: artistId, artist_name: artistName }).eq('id', existing.id);
      }
    }
    return existing.id;
  }

  // Try the read path first — this runs on every single play, so the common
  // case (track already exists) should be one SELECT, not an upsert churning
  // the row's defaults every time.
  const { data: existing } = await supabase
    .from('tracks').select('id, artist_id, artist_name').eq('original_url', originalUrl).maybeSingle();
  if (existing) {
    // Backfill artist linkage on a track that was first played before its
    // artist name was available (e.g. an old YouTube-resolved play, then
    // later the same originalUrl shows up again with ID3 data attached —
    // not how this actually happens today since URLs are platform-specific,
    // but cheap correctness insurance for any future source that re-plays
    // the same originalUrl with richer metadata than it had the first time).
    if (!existing.artist_id && artistName) {
      const artistId = await dbResolveArtist(artistName);
      if (artistId) {
        await supabase.from('tracks').update({ artist_id: artistId, artist_name: artistName }).eq('id', existing.id);
      }
    }
    return existing.id;
  }

  const artistId = artistName ? await dbResolveArtist(artistName) : null;
  const { data, error } = await supabase
    .from('tracks')
    .upsert({
      original_url: originalUrl, platform: platform || null, title: title || null,
      artist_name: artistName || null, artist_id: artistId,
    }, { onConflict: 'original_url', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data.id;
  // Lost the upsert race to a concurrent request — the row now exists, just
  // not in `data` because ignoreDuplicates skipped returning it. Re-select.
  const { data: row2 } = await supabase
    .from('tracks').select('id').eq('original_url', originalUrl).maybeSingle();
  return row2 ? row2.id : null;
}

// Per-(track, listener) cooldown so holding play/pause or spamming repeat
// can't farm chart position. Listener key is username when signed in,
// otherwise the caller passes an IP-derived key — either way this is a
// courtesy anti-gaming check, not a security boundary (a determined script
// can rotate keys), which is an acceptable tradeoff for a self-hosted music
// player's "what's popular" list.
const recentPlayKeys = new Map(); // `${trackId}:${listenerKey}` -> last play timestamp
const PLAY_COOLDOWN_MS = 30_000;
setInterval(() => {
  const cutoff = Date.now() - PLAY_COOLDOWN_MS;
  for (const [key, t] of recentPlayKeys) if (t < cutoff) recentPlayKeys.delete(key);
}, 120_000);

const PLAY_SOURCES = ['direct', 'discover', 'listen_to_earn', 'chart', 'search', 'dj_boom', 'artist_page', 'playlist', 'shared_link', 'demo'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function dbLogPlay(originalUrl, { platform, title, username, listenerKey, artistName, publishedTrackId, source }) {
  const trackId = await dbGetOrCreateTrack(originalUrl, platform, title, artistName, publishedTrackId);
  if (!trackId) return null;

  const cooldownKey = `${trackId}:${listenerKey || username || 'anon'}`;
  const last = recentPlayKeys.get(cooldownKey);
  if (last && Date.now() - last < PLAY_COOLDOWN_MS) {
    return { trackId, counted: false }; // within cooldown — silently skip, not an error
  }
  recentPlayKeys.set(cooldownKey, Date.now());

  // source is client-supplied (see POST /api/plays) and validated against
  // PLAY_SOURCES there before it ever reaches this function — falls back
  // to 'direct' for anything unrecognized or absent, matching the column's
  // DB-level default so Creator Insights never has to special-case nulls.
  const safeSource = PLAY_SOURCES.includes(source) ? source : 'direct';
  // .select().single() here (rather than a bare .insert()) so the row's id
  // comes back — Taste Graph's completed/skipped signal (see
  // dbMarkPlayOutcome below) needs to reach back and update THIS exact row
  // a little later, once the client knows how the track actually ended.
  const { data: playRow, error: insertErr } = await supabase
    .from('track_plays')
    .insert({ track_id: trackId, username: username || null, source: safeSource })
    .select('id')
    .single();
  if (insertErr) console.error('[db] logPlay insert:', insertErr.message);

  // Atomic increment via the increment_track_play_count() RPC (see migration)
  // rather than read-count-then-write, which would race under concurrent
  // plays of the same track and silently undercount.
  const { data, error } = await supabase.rpc('increment_track_play_count', {
    p_track_id: trackId, p_title: title || null,
  });
  if (error) { console.error('[db] logPlay increment:', error.message); return { trackId, counted: true, playRowId: playRow?.id || null }; }
  return { trackId, counted: true, playCount: data, playRowId: playRow?.id || null };
}

// Taste Graph's one honest signal beyond "this track was played": whether
// it was actually listened through or abandoned early. Nothing in FREQ
// tracked this before — the client can only know the outcome of a play
// AFTER it ends, by which point the next /api/plays call for the following
// track is what reports it (see POST /api/plays' `previousPlay` field), so
// this updates a row that was inserted moments earlier by dbLogPlay rather
// than being written at play-start time. Scoped to `username` as well as
// `id` purely as a safety check — a client can only ever report the
// outcome of ITS OWN previous play, never an arbitrary row id for someone
// else's listen.
async function dbMarkPlayOutcome(playRowId, username, completed) {
  if (!playRowId) return;
  await supabase.from('track_plays')
    .update({ completed: !!completed })
    .eq('id', playRowId)
    .eq('username', username || null);
}

// ─── Musi-Pixels · wallet + Listen to Earn (Phase 1) ──────────────────────
// FREQ already owns authentication, canonical tracks, play history, family
// filtering, and Supabase access. MP deliberately builds on those systems:
// usernames remain the wallet owner key, tracks.id/artist_id remain the
// reward identity, and only the server-side service-role client can touch
// economy rows. The browser never receives database credentials or writes a
// balance directly.
const MP_CONFIG_DEFAULTS = Object.freeze({
  enabled: true,
  mpPerTrack: 150,
  minPercentPlayed: 90,
  minSecondsFloor: 45,
  maxTracksPerArtistPerDay: 5,
  maxArtistsPerDay: 10,
  eligibleLifetimePlayCeiling: 20,
  eligibleRecencyDays: 30,
  heartbeatIntervalSeconds: 12,
  heartbeatGraceSeconds: 90,
  maxRewardPlaybackRate: 2,
});
let mpConfigCache = { value: MP_CONFIG_DEFAULTS, expiresAt: 0 };

// The browser starts /api/plays requests without blocking audio. If two track
// selections overlap, the older request can finish last; the start RPC replaces
// the user's active session, so that stale request would otherwise expire the
// newer, correct session before the client-side playToken could reject it.
// Track the newest token for each page lifetime and re-check it immediately
// before calling the replacement RPC.
const mpLatestPlayAttempts = new Map(); // `${username}|${pageId}` -> { token, seenAt }
function registerMpPlayAttempt(username, pageId, token) {
  const safePageId = typeof pageId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(pageId)
    ? pageId
    : null;
  const safeToken = Number.isSafeInteger(token) && token > 0 ? token : null;
  if (!safePageId || !safeToken) return null;
  const key = `${username}|${safePageId}`;
  const current = mpLatestPlayAttempts.get(key);
  if (!current || safeToken > current.token) {
    mpLatestPlayAttempts.set(key, { token: safeToken, seenAt: Date.now() });
  } else {
    current.seenAt = Date.now();
  }
  return { key, token: safeToken };
}
function isLatestMpPlayAttempt(attempt) {
  return !attempt || mpLatestPlayAttempts.get(attempt.key)?.token === attempt.token;
}
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, attempt] of mpLatestPlayAttempts) {
    if (attempt.seenAt < cutoff) mpLatestPlayAttempts.delete(key);
  }
}, 10 * 60 * 1000);

function mpConfigNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function dbGetMpConfig({ force = false } = {}) {
  if (!force && mpConfigCache.expiresAt > Date.now()) return mpConfigCache.value;
  const { data, error } = await supabase.from('app_config')
    .select('key, value').like('key', 'listen_to_earn.%');
  if (error) {
    console.error('[mp config]', error.message);
    return mpConfigCache.value;
  }
  const values = new Map((data || []).map(row => [row.key, row.value]));
  const cfg = {
    enabled: values.has('listen_to_earn.enabled')
      ? values.get('listen_to_earn.enabled') !== false
      : MP_CONFIG_DEFAULTS.enabled,
    mpPerTrack: mpConfigNumber(values.get('listen_to_earn.mp_per_track'), 150, 1, 1000000),
    minPercentPlayed: mpConfigNumber(values.get('listen_to_earn.min_percent_played'), 90, 1, 100),
    minSecondsFloor: mpConfigNumber(values.get('listen_to_earn.min_seconds_floor'), 45, 1, 86400),
    maxTracksPerArtistPerDay: mpConfigNumber(values.get('listen_to_earn.max_tracks_per_artist_per_day'), 5, 1, 100),
    maxArtistsPerDay: mpConfigNumber(values.get('listen_to_earn.max_artists_per_day'), 10, 1, 100),
    eligibleLifetimePlayCeiling: mpConfigNumber(values.get('listen_to_earn.eligible_lifetime_play_ceiling'), 20, 1, 1000000),
    eligibleRecencyDays: mpConfigNumber(values.get('listen_to_earn.eligible_recency_days'), 30, 1, 3650),
    heartbeatIntervalSeconds: mpConfigNumber(values.get('listen_to_earn.heartbeat_interval_seconds'), 12, 5, 60),
    heartbeatGraceSeconds: mpConfigNumber(values.get('listen_to_earn.heartbeat_grace_seconds'), 90, 15, 600),
    maxRewardPlaybackRate: mpConfigNumber(values.get('listen_to_earn.max_reward_playback_rate'), 2, 0.25, 4),
  };
  mpConfigCache = { value: Object.freeze(cfg), expiresAt: Date.now() + 60_000 };
  return mpConfigCache.value;
}

async function dbGetMpWallet(username) {
  const { data, error } = await supabase.from('wallet_balances')
    .select('balance_mp, lifetime_earned_mp, lifetime_spent_mp, updated_at')
    .eq('username', username).maybeSingle();
  if (error) throw new Error(error.message);
  return {
    balanceMp: Number(data?.balance_mp) || 0,
    lifetimeEarnedMp: Number(data?.lifetime_earned_mp) || 0,
    lifetimeSpentMp: Number(data?.lifetime_spent_mp) || 0,
    updatedAt: data?.updated_at || null,
  };
}

async function dbGetMpLedger(username, { limit = 30, before = null } = {}) {
  let query = supabase.from('wallet_transactions')
    .select('id, amount_mp, balance_after_mp, reason, ref_type, ref_id, note, created_at')
    .eq('username', username)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(row => ({
    id: row.id,
    amountMp: Number(row.amount_mp),
    balanceAfterMp: Number(row.balance_after_mp),
    reason: row.reason,
    refType: row.ref_type,
    refId: row.ref_id,
    note: row.note,
    createdAt: row.created_at,
  }));
}

// ─── Musi-Shop · Phases 2–4 ──────────────────────────────────────────────
// Catalog prices and grant sizes live in musi_shop_items so they can be
// tuned without deploying server/client code. Purchases reuse the Phase 1
// wallet and immutable ledger; the database RPC is the only place a debit
// and its grant can happen, keeping them in one transaction. Phase 3 adds
// permanent owned items, one active item per cosmetic slot, and atomic gifts.
// Phase 4 adds scheduled collections. A seasonal item reaches the normal
// catalog only while both the global switch and its collection window are live.
const MUSI_SHOP_COSMETIC_SLOTS = new Set([
  'app_theme', 'profile_frame', 'profile_background',
  'username_color', 'username_effect', 'profile_badge',
  'profile_banner_effect', 'status_emoji', 'favorite_genre_badge',
  'milestone_badge', 'achievement_showcase', 'chat_bubble_theme',
  'app_icon', 'loading_screen', 'cursor_theme', 'equalizer_skin',
  'player_skin', 'playlist_cover_template', 'radio_station_icon',
  'radio_theme', 'dj_boom_style', 'visualizer_style',
]);

async function dbGetMusiShopSettings() {
  const { data, error } = await supabase.from('app_config')
    .select('key, value').in('key', [
      'musi_shop.enabled',
      'musi_shop.seasonal_enabled',
      'musi_shop.seasonal_preview_enabled',
    ]);
  if (error) throw new Error(error.message);
  const values = new Map((data || []).map(row => [row.key, row.value]));
  return {
    enabled: values.has('musi_shop.enabled') ? values.get('musi_shop.enabled') !== false : true,
    seasonalEnabled: values.get('musi_shop.seasonal_enabled') === true,
    seasonalPreviewEnabled: values.has('musi_shop.seasonal_preview_enabled')
      ? values.get('musi_shop.seasonal_preview_enabled') === true
      : true,
  };
}

function shapeMusiShopItem(row) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const selections = Array.isArray(metadata.selections)
    ? metadata.selections.filter(value => typeof value === 'string').slice(0, 12)
    : [];
  const selectionLabels = metadata.selection_labels && typeof metadata.selection_labels === 'object'
    ? metadata.selection_labels
    : {};
  return {
    sku: row.sku,
    name: row.name,
    description: row.description || '',
    category: row.category,
    entitlementType: row.entitlement_type,
    priceMp: Number(row.price_mp) || 0,
    grantQuantity: Number(row.grant_quantity) || 0,
    grantUnit: row.grant_unit,
    icon: row.icon || '🟣',
    badge: row.badge || null,
    valueLabel: metadata.value_label || null,
    slot: metadata.slot || null,
    assetKey: metadata.asset_key || null,
    tier: metadata.tier || null,
    animated: metadata.animated === true,
    color: typeof metadata.color === 'string' ? metadata.color : null,
    cosmeticLabel: typeof metadata.label === 'string' ? metadata.label : null,
    cosmeticIcon: typeof metadata.icon === 'string' ? metadata.icon : null,
    collectionLabel: typeof metadata.collection_label === 'string' ? metadata.collection_label : null,
    eventExclusive: metadata.event_exclusive === true,
    rarity: typeof metadata.rarity === 'string'
      ? metadata.rarity
      : metadata.tier === 'legendary' ? 'legendary'
        : metadata.tier === 'premium' ? 'epic'
          : metadata.tier === 'basic' ? 'common' : 'common',
    unlockOnly: metadata.unlock_only === true,
    previewText: typeof metadata.preview_text === 'string' ? metadata.preview_text.slice(0, 160) : null,
    image: typeof metadata.image === 'string' && metadata.image.trim() ? metadata.image : null,
    limited: metadata.limited === true,
    iconPack: metadata.icon_pack === true,
    selections,
    selectionLabels,
    giftable: row.giftable !== false,
    seasonal: row.seasonal === true,
    seasonKey: row.season_key || null,
    availableFrom: row.available_from || null,
    availableUntil: row.available_until || null,
  };
}

async function dbGetMusiShopCatalog({ liveSeasonKeys = new Set() } = {}) {
  const { data, error } = await supabase.from('musi_shop_items')
    .select('sku, name, description, category, entitlement_type, price_mp, grant_quantity, grant_unit, icon, badge, sort_order, available_from, available_until, metadata, giftable, seasonal, season_key')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('sku', { ascending: true });
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data || []).filter(row => {
    const starts = row.available_from ? new Date(row.available_from).getTime() : null;
    const ends = row.available_until ? new Date(row.available_until).getTime() : null;
    return (!row.seasonal || liveSeasonKeys.has(row.season_key)) && (!starts || starts <= now) && (!ends || ends > now);
  }).map(shapeMusiShopItem);
}

// ─── Daily Musi-Shop rotation window ─────────────────────────────────────────
// The Daily Shop rotates once every 24 hours at 8:00 AM America/New_York.
// This must stay DST-safe (EST is UTC-5, EDT is UTC-4) and must never use a
// fixed UTC offset, since that would drift by an hour twice a year. We derive
// the boundary using Intl.DateTimeFormat against the IANA zone, which resolves
// the correct offset for any given instant automatically.
const MUSI_SHOP_ROTATION_TZ = 'America/New_York';
const MUSI_SHOP_ROTATION_HOUR = 8; // 8:00 AM local time in MUSI_SHOP_ROTATION_TZ

// Formats a UTC instant into its America/New_York wall-clock parts.
function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const { type, value } of fmt.formatToParts(date)) {
    if (type !== 'literal') parts[type] = value;
  }
  // Intl reports hour '24' at local midnight in some environments; normalize to 0.
  if (parts.hour === '24') parts.hour = '00';
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

// Given a UTC instant, finds the UTC instant of the next MUSI_SHOP_ROTATION_HOUR
// (00 minutes) wall-clock time in MUSI_SHOP_ROTATION_TZ that is <= that instant
// (the "rotation boundary this cycle started at"), by binary-searching the
// tz offset. We can't just construct `${y}-${m}-${d}T08:00:00` and slap on a
// fixed offset, since the EST/EDT offset for that local date is exactly the
// unknown we're solving for -- so instead we search for the UTC instant whose
// zoned wall-clock reads 08:00:00 on the intended local calendar day.
function findRotationBoundaryUtc(localYear, localMonth, localDay) {
  // Start from a guess assuming UTC-5 (EST); binary search converges regardless.
  let lo = Date.UTC(localYear, localMonth - 1, localDay, MUSI_SHOP_ROTATION_HOUR + 3, 0, 0, 0);
  let hi = Date.UTC(localYear, localMonth - 1, localDay, MUSI_SHOP_ROTATION_HOUR + 6, 0, 0, 0);
  // Widen until the zoned hour brackets MUSI_SHOP_ROTATION_HOUR correctly.
  for (let guard = 0; guard < 4; guard++) {
    const loParts = zonedParts(new Date(lo), MUSI_SHOP_ROTATION_TZ);
    if (loParts.hour <= MUSI_SHOP_ROTATION_HOUR && loParts.day === localDay) break;
    lo -= 3600000;
  }
  for (let guard = 0; guard < 4; guard++) {
    const hiParts = zonedParts(new Date(hi), MUSI_SHOP_ROTATION_TZ);
    if (hiParts.hour >= MUSI_SHOP_ROTATION_HOUR && hiParts.day === localDay) break;
    hi += 3600000;
  }
  for (let i = 0; i < 40; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const parts = zonedParts(new Date(mid), MUSI_SHOP_ROTATION_TZ);
    const midMinutes = parts.hour * 60 + parts.minute + parts.second / 60;
    const targetMinutes = MUSI_SHOP_ROTATION_HOUR * 60;
    if (parts.day < localDay || (parts.day === localDay && midMinutes < targetMinutes)) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return hi;
}

// Returns { rotationDate, expiresAt } for the Daily Shop cycle containing `date`.
// rotationDate is the America/New_York calendar date (YYYY-MM-DD) the current
// cycle's 8:00 AM boundary falls on -- this is what's stored in
// musi_shop_daily_rotation.rotation_date (a plain `date` column, so it must
// stay a calendar date, not a timestamp). expiresAt is the UTC instant of the
// *next* 8:00 AM America/New_York rotation, used by the frontend countdown.
function musiShopRotationWindow(date = new Date()) {
  const local = zonedParts(date, MUSI_SHOP_ROTATION_TZ);
  const todayBoundaryUtc = findRotationBoundaryUtc(local.year, local.month, local.day);
  const nowMs = date.getTime();

  let boundaryUtc = todayBoundaryUtc;
  let rotationLocal = local;
  if (nowMs < todayBoundaryUtc) {
    // We're before today's 8 AM ET rotation, so the *active* rotation is
    // still yesterday's. Step the local calendar date back by one.
    const prevDay = new Date(Date.UTC(local.year, local.month - 1, local.day - 1, 12, 0, 0));
    const prevParts = zonedParts(prevDay, MUSI_SHOP_ROTATION_TZ);
    boundaryUtc = findRotationBoundaryUtc(prevParts.year, prevParts.month, prevParts.day);
    rotationLocal = prevParts;
  }
  const nextBoundaryUtc = boundaryUtc + 24 * 60 * 60 * 1000;

  const rotationDate = `${rotationLocal.year}-${String(rotationLocal.month).padStart(2, '0')}-${String(rotationLocal.day).padStart(2, '0')}`;
  return { rotationDate, expiresAt: new Date(nextBoundaryUtc).toISOString() };
}

// Legacy name kept as an alias so any other call sites (if present) keep working.
function musiShopUtcDay(date = new Date()) {
  return musiShopRotationWindow(date);
}

function seededMusiShopOrder(items, seed) {
  return [...items].sort((a, b) => {
    const aHash = crypto.createHash('sha256').update(`${seed}|${a.sku}`).digest('hex');
    const bHash = crypto.createHash('sha256').update(`${seed}|${b.sku}`).digest('hex');
    return aHash.localeCompare(bHash) || String(a.sku).localeCompare(String(b.sku));
  });
}

// Builds the daily/legendary/deal rotation rows for a given rotationDate from
// the live catalog, using a seed derived from that date so the same date
// always reproduces the same picks (stable across repeated calls the same
// day, e.g. multiple app instances or retries).
function buildMusiShopRotationRows(catalog, rotationDate) {
  const cosmetics = (catalog || []).filter(item =>
    item.entitlementType === 'owned_item'
    && item.slot
    && MUSI_SHOP_COSMETIC_SLOTS.has(item.slot)
    && !item.seasonal
    && !item.unlockOnly
  );
  const legendary = cosmetics.filter(item => item.rarity === 'legendary' || item.rarity === 'animated_legendary');
  const regular = cosmetics.filter(item => item.rarity !== 'legendary' && item.rarity !== 'animated_legendary');
  const dailyItems = seededMusiShopOrder(regular.length >= 6 ? regular : cosmetics, `${rotationDate}|daily`).slice(0, 6);
  const used = new Set(dailyItems.map(item => item.sku));
  const legendaryItem = seededMusiShopOrder(
    legendary.filter(item => !used.has(item.sku)),
    `${rotationDate}|legendary`
  )[0];
  if (legendaryItem) used.add(legendaryItem.sku);
  const dealItem = seededMusiShopOrder(
    cosmetics.filter(item => !used.has(item.sku)),
    `${rotationDate}|deal`
  )[0];

  return [
    ...dailyItems.map((item, index) => ({
      rotation_date: rotationDate,
      placement: 'daily',
      sort_order: index,
      sku: item.sku,
      discount_percent: 0,
    })),
    ...(legendaryItem ? [{
      rotation_date: rotationDate,
      placement: 'legendary',
      sort_order: 0,
      sku: legendaryItem.sku,
      discount_percent: 0,
    }] : []),
    ...(dealItem ? [{
      rotation_date: rotationDate,
      placement: 'deal',
      sort_order: 0,
      sku: dealItem.sku,
      discount_percent: 25,
    }] : []),
  ];
}

// Writes rotation rows for rotationDate, replacing any existing rows for that
// date. Previous *other* dates are always left untouched, so purchase history
// (musi_shop_purchases references the sku, not the rotation row) stays intact
// and past rotations remain queryable in musi_shop_daily_rotation.
async function writeMusiShopRotationRows(rotationDate, generated) {
  const { error: deleteError } = await supabase.from('musi_shop_daily_rotation')
    .delete().eq('rotation_date', rotationDate);
  if (deleteError) throw new Error(deleteError.message);
  if (!generated.length) return;
  const { error: upsertError } = await supabase.from('musi_shop_daily_rotation')
    .upsert(generated, { onConflict: 'rotation_date,placement,sort_order' });
  if (upsertError) throw new Error(upsertError.message);
}

async function dbGetMusiShopDailyRotation(catalog) {
  const { rotationDate, expiresAt } = musiShopRotationWindow();
  let { data: rows, error } = await supabase.from('musi_shop_daily_rotation')
    .select('rotation_date, placement, sort_order, sku, discount_percent')
    .eq('rotation_date', rotationDate)
    .order('placement', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);

  // Only generate if today's rotation doesn't already exist. This is what
  // makes the rotation stable across server restarts and repeated requests:
  // rows are keyed by (rotation_date, placement, sort_order), so once today's
  // 8 rows exist, every subsequent read this cycle just re-reads them.
  if ((rows || []).length < 8) {
    const generated = buildMusiShopRotationRows(catalog, rotationDate);
    if (generated.length) {
      await writeMusiShopRotationRows(rotationDate, generated);
      rows = generated;
    }
  }

  const bySku = new Map((catalog || []).map(item => [item.sku, item]));
  const placementOrder = { daily: 0, legendary: 1, deal: 2 };
  const items = (rows || [])
    .map(row => {
      const item = bySku.get(row.sku);
      if (!item) return null;
      const discountPercent = Math.max(0, Math.min(80, Number(row.discount_percent) || 0));
      const originalPriceMp = Number(item.priceMp) || 0;
      const priceMp = discountPercent
        ? Math.max(1, Math.floor(originalPriceMp * (100 - discountPercent) / 100))
        : originalPriceMp;
      return {
        ...item,
        placement: row.placement,
        placementOrder: placementOrder[row.placement] ?? 9,
        rotationOrder: Number(row.sort_order) || 0,
        discountPercent,
        originalPriceMp,
        priceMp,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.placementOrder - b.placementOrder || a.rotationOrder - b.rotationOrder);
  return { rotationDate, expiresAt, items };
}

// Admin-only: force today's Daily Shop rotation to regenerate immediately,
// independent of the 8 AM ET schedule. Reuses the exact same generation path
// as the lazy auto-generate above (buildMusiShopRotationRows), so results are
// shaped identically -- this just skips the "only if missing" guard. Historical
// rotations for other dates are untouched (writeMusiShopRotationRows only
// deletes rows for the target rotationDate), so past purchase history stays
// intact. Logs the action to musi_shop_admin_actions for auditability.
async function dbResetMusiShopDailyRotation(actorUsername, catalog) {
  const { rotationDate, expiresAt } = musiShopRotationWindow();
  const generated = buildMusiShopRotationRows(catalog, rotationDate);
  await writeMusiShopRotationRows(rotationDate, generated);

  const { error: logError } = await supabase.from('musi_shop_admin_actions').insert({
    actor: actorUsername,
    action: 'daily_shop_manual_reset',
    detail: {
      rotation_date: rotationDate,
      item_count: generated.length,
      skus: generated.map(row => row.sku),
    },
  });
  if (logError) throw new Error(logError.message);

  return { rotationDate, expiresAt, itemCount: generated.length };
}

async function dbGetMusiShopAchievements(username) {
  const { error: syncError } = await supabase.rpc('sync_musi_shop_achievements', {
    p_username: username,
  });
  if (syncError) throw new Error(syncError.message);
  const [{ data: definitions, error: definitionsError }, { data: progressRows, error: progressError }] = await Promise.all([
    supabase.from('musi_shop_achievement_catalog')
      .select('achievement_key, name, description, icon, metric, target, reward_sku, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    supabase.from('musi_shop_user_achievements')
      .select('achievement_key, progress, unlocked_at')
      .eq('username', username),
  ]);
  if (definitionsError) throw new Error(definitionsError.message);
  if (progressError) throw new Error(progressError.message);
  const progressByKey = new Map((progressRows || []).map(row => [row.achievement_key, row]));
  return (definitions || []).map(row => {
    const progress = progressByKey.get(row.achievement_key);
    return {
      achievementKey: row.achievement_key,
      name: row.name,
      description: row.description || '',
      icon: row.icon || '🏆',
      metric: row.metric,
      target: Number(row.target) || 1,
      progress: Math.max(0, Number(progress?.progress) || 0),
      unlockedAt: progress?.unlocked_at || null,
      rewardSku: row.reward_sku || null,
    };
  });
}

async function dbOpenMusiShopCrate(username, tier, idempotencyKey) {
  const { data, error } = await supabase.rpc('open_musi_shop_crate', {
    p_username: username,
    p_tier: tier,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(error.message);
  return data || { ok: false, reason: 'crate_failed' };
}

function safeMusiShopGradient(value) {
  const gradient = String(value || '').slice(0, 300);
  return /^(linear-gradient|radial-gradient)\(/i.test(gradient)
      && gradient.endsWith(')')
      && !/[;<>]/.test(gradient)
      && !/url\s*\(/i.test(gradient)
    ? gradient
    : 'linear-gradient(135deg,#6b2bd1,#ef5ec8)';
}

async function dbGetMusiShopCollections(settings) {
  const [{ data: collectionRows, error: collectionError }, { data: itemRows, error: itemError }] = await Promise.all([
    supabase.from('musi_shop_collections')
      .select('collection_key, name, tagline, description, icon, hero_gradient, active, preview_enabled, preview_from, starts_at, ends_at, sort_order, metadata')
      .order('sort_order', { ascending: true })
      .order('collection_key', { ascending: true }),
    supabase.from('musi_shop_items')
      .select('sku, name, description, category, entitlement_type, price_mp, grant_quantity, grant_unit, icon, badge, sort_order, available_from, available_until, metadata, giftable, seasonal, season_key')
      .eq('active', true)
      .eq('seasonal', true)
      .order('sort_order', { ascending: true }),
  ]);
  if (collectionError) throw new Error(collectionError.message);
  if (itemError) throw new Error(itemError.message);

  const now = Date.now();
  const itemsByCollection = new Map();
  (itemRows || []).forEach(row => {
    if (!itemsByCollection.has(row.season_key)) itemsByCollection.set(row.season_key, []);
    itemsByCollection.get(row.season_key).push(shapeMusiShopItem(row));
  });

  return (collectionRows || []).map(row => {
    const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : null;
    const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : null;
    const previewFrom = row.preview_from ? new Date(row.preview_from).getTime() : null;
    let scheduledState = 'locked';
    if (row.active && startsAt && endsAt) {
      scheduledState = now < startsAt ? 'upcoming' : now >= endsAt ? 'ended' : 'live';
    }
    const state = settings.seasonalEnabled ? scheduledState : 'locked';
    const previewVisible = row.preview_enabled
      && (!previewFrom || previewFrom <= now)
      && (settings.seasonalPreviewEnabled || state === 'live');
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return {
      collectionKey: row.collection_key,
      name: row.name,
      tagline: row.tagline || '',
      description: row.description || '',
      icon: row.icon || '🎉',
      heroGradient: safeMusiShopGradient(row.hero_gradient),
      state,
      scheduledState,
      purchasable: state === 'live',
      previewVisible,
      startsAt: row.starts_at || null,
      endsAt: row.ends_at || null,
      nextChangeAt: state === 'upcoming' ? row.starts_at : state === 'live' ? row.ends_at : null,
      limited: metadata.limited === true,
      accent: typeof metadata.accent === 'string' ? metadata.accent : null,
      accent2: typeof metadata.accent2 === 'string' ? metadata.accent2 : null,
      items: itemsByCollection.get(row.collection_key) || [],
    };
  }).filter(collection => collection.previewVisible || collection.purchasable);
}

async function dbGetMusiShopActiveItems(username) {
  const { data: activeRows, error: activeError } = await supabase.from('musi_shop_active_items')
    .select('slot, sku, selection_key, activated_at, updated_at')
    .eq('username', username)
    .order('slot', { ascending: true });
  if (activeError) throw new Error(activeError.message);
  const skus = [...new Set((activeRows || []).map(row => row.sku))];
  let itemRows = [];
  if (skus.length) {
    const { data, error } = await supabase.from('musi_shop_items')
      .select('sku, name, description, category, entitlement_type, price_mp, grant_quantity, grant_unit, icon, badge, available_from, available_until, metadata, giftable, seasonal, season_key')
      .in('sku', skus);
    if (error) throw new Error(error.message);
    itemRows = data || [];
  }
  const itemsBySku = new Map(itemRows.map(row => [row.sku, shapeMusiShopItem(row)]));
  return (activeRows || []).map(row => ({
    slot: row.slot,
    sku: row.sku,
    selectionKey: row.selection_key,
    activatedAt: row.activated_at,
    updatedAt: row.updated_at,
    item: itemsBySku.get(row.sku) || null,
  }));
}

async function dbGetMusiShopInventory(username) {
  const [{ data: ownedRows, error: ownedError }, activeItems] = await Promise.all([
    supabase.from('musi_shop_owned_items')
      .select('sku, source, source_ref_id, acquired_at')
      .eq('username', username)
      .order('acquired_at', { ascending: false }),
    dbGetMusiShopActiveItems(username),
  ]);
  if (ownedError) throw new Error(ownedError.message);
  const skus = [...new Set((ownedRows || []).map(row => row.sku))];
  let itemRows = [];
  if (skus.length) {
    const { data, error } = await supabase.from('musi_shop_items')
      .select('sku, name, description, category, entitlement_type, price_mp, grant_quantity, grant_unit, icon, badge, available_from, available_until, metadata, giftable, seasonal, season_key')
      .in('sku', skus);
    if (error) throw new Error(error.message);
    itemRows = data || [];
  }
  const itemsBySku = new Map(itemRows.map(row => [row.sku, shapeMusiShopItem(row)]));
  return {
    ownedItems: (ownedRows || []).map(row => ({
      sku: row.sku,
      source: row.source,
      sourceRefId: row.source_ref_id,
      acquiredAt: row.acquired_at,
      item: itemsBySku.get(row.sku) || null,
    })).filter(row => row.item),
    activeItems,
  };
}

async function dbActivateMusiShopItem(username, slot, sku, selectionKey) {
  const { data, error } = await supabase.rpc('activate_musi_shop_item', {
    p_username: username,
    p_slot: slot,
    p_sku: sku || null,
    p_selection_key: selectionKey || null,
  });
  if (error) throw new Error(error.message);
  return data || { ok: false, reason: 'activation_failed' };
}

async function dbGiftMusiShopItem(senderUsername, recipientUsername, sku, idempotencyKey) {
  const { data, error } = await supabase.rpc('gift_musi_shop_item', {
    p_sender_username: senderUsername,
    p_recipient_username: recipientUsername,
    p_sku: sku,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(error.message);
  return data || { ok: false, reason: 'gift_failed' };
}

async function dbGetMusiShopGifts(username, limit = 50) {
  const columns = 'id, sender_username, recipient_username, sku, item_name, category, price_mp, grant_quantity, grant_unit, created_at';
  const [{ data: sent, error: sentError }, { data: received, error: receivedError }] = await Promise.all([
    supabase.from('musi_shop_gifts').select(columns).eq('sender_username', username).order('created_at', { ascending: false }).limit(limit),
    supabase.from('musi_shop_gifts').select(columns).eq('recipient_username', username).order('created_at', { ascending: false }).limit(limit),
  ]);
  if (sentError) throw new Error(sentError.message);
  if (receivedError) throw new Error(receivedError.message);
  return [
    ...(sent || []).map(row => ({ ...row, direction: 'sent' })),
    ...(received || []).map(row => ({ ...row, direction: 'received' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit).map(row => ({
    id: row.id,
    direction: row.direction,
    senderUsername: row.sender_username,
    recipientUsername: row.recipient_username,
    sku: row.sku,
    itemName: row.item_name,
    category: row.category,
    priceMp: Number(row.price_mp) || 0,
    grantQuantity: Number(row.grant_quantity) || 0,
    grantUnit: row.grant_unit,
    createdAt: row.created_at,
  }));
}

async function dbGetMusiShopEntitlements(username, isPremium = false) {
  const { data, error } = await supabase.from('musi_shop_entitlements')
    .select('entitlement_type, remaining_uses, expires_at, updated_at')
    .eq('username', username);
  if (error) throw new Error(error.message);
  const byType = new Map((data || []).map(row => [row.entitlement_type, row]));
  const djRow = byType.get('dj_boom_messages');
  const radioRow = byType.get('radio_access');
  const radioPassExpiresAt = radioRow?.expires_at || null;
  const radioPassActive = !!radioPassExpiresAt && new Date(radioPassExpiresAt).getTime() > Date.now();
  const djBoomMessagesRemaining = Math.max(0, Number(djRow?.remaining_uses) || 0);
  return {
    premiumUnlimited: !!isPremium,
    djBoomMessagesRemaining,
    djBoomAccess: !!isPremium || djBoomMessagesRemaining > 0,
    radioPassExpiresAt,
    radioPassActive,
    radioAccess: !!isPremium || radioPassActive,
  };
}

async function dbPurchaseMusiShopItem(username, sku, idempotencyKey) {
  const { data, error } = await supabase.rpc('purchase_musi_shop_item', {
    p_username: username,
    p_sku: sku,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(error.message);
  return data || { ok: false, reason: 'purchase_failed' };
}

// App Icon Packs are deliberately a thin, verified view over the existing
// owned-item catalog.  The existing purchase RPC still owns the MP debit and
// permanent inventory grant; this prevents a second wallet or inventory path.
async function dbGetIconPacks(username) {
  const [catalog, inventory] = await Promise.all([
    dbGetMusiShopCatalog({ liveSeasonKeys: new Set() }),
    dbGetMusiShopInventory(username),
  ]);
  const ownedSkus = new Set(inventory.ownedItems.map(row => row.sku));
  const equippedSku = inventory.activeItems.find(row => row.slot === 'app_icon')?.sku || null;
  return catalog.filter(item => item.slot === 'app_icon' && item.iconPack).map(item => ({
    id: item.sku, name: item.name, description: item.description, rarity: item.rarity,
    priceMp: item.priceMp, image: item.image, limited: item.limited,
    seasonal: item.seasonal || item.limited, owned: ownedSkus.has(item.sku),
    equipped: equippedSku === item.sku, sku: item.sku,
  }));
}

async function dbConsumeDjBoomMessage(username) {
  const { data, error } = await supabase.rpc('consume_dj_boom_message', {
    p_username: username,
  });
  if (error) throw new Error(error.message);
  return data || { ok: false, reason: 'dj_boom_pack_required' };
}

function mpRequestIdentity(req, username, clientDeviceId) {
  // HMACs make the stored anti-abuse identifiers useful for correlation
  // without retaining a session token, user-agent, or device id. IP is not
  // stored or used as a hard signal: legitimate Wi-Fi/mobile changes must
  // not invalidate a background listen.
  const secret = process.env.MP_ABUSE_SECRET || process.env.SUPABASE_SERVICE_KEY || 'freq-mp-local-development';
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const device = String(clientDeviceId || '').slice(0, 128);
  const hmac = value => crypto.createHmac('sha256', secret).update(value).digest('hex');
  return {
    deviceHash: hmac(`${username}|${device}|${ua}`),
    ipHash: null,
  };
}

async function dbGetListenToEarnOffers(username, allowedRatings, limit) {
  const config = await dbGetMpConfig();
  if (!config.enabled) return { config, offers: [], dailyArtistsUsed: 0, dailyTracksEarned: 0 };

  const today = new Date().toISOString().slice(0, 10); // UTC, same day key used by the payout RPC
  const [{ data: candidateRows, error: candidateErr }, { data: paidRows, error: paidErr }] = await Promise.all([
    supabase.from('tracks')
      .select('id, original_url, title, artist_id, artist_name, platform, cover_url, content_rating, is_explicit, play_count, published_at, cloud_file_id')
      .eq('is_published', true)
      .not('artist_id', 'is', null)
      .not('cloud_file_id', 'is', null)
      .in('content_rating', allowedRatings)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(150),
    supabase.from('listen_to_earn_daily_payouts')
      .select('artist_id, track_id, payout_date')
      .eq('username', username),
  ]);
  if (candidateErr) throw new Error(candidateErr.message);
  if (paidErr) throw new Error(paidErr.message);

  const candidates = candidateRows || [];
  if (!candidates.length) return { config, offers: [], dailyArtistsUsed: 0, dailyTracksEarned: 0 };

  const artistIds = [...new Set(candidates.map(row => row.artist_id).filter(Boolean))];
  const cloudIds = [...new Set(candidates.map(row => row.cloud_file_id).filter(Boolean))];
  const [artistsResult, cloudResult, artistTracksResult] = await Promise.all([
    supabase.from('artists').select('id, account_id').in('id', artistIds),
    supabase.from('cloud_files').select('id, duration').in('id', cloudIds),
    supabase.from('tracks').select('id, artist_id').in('artist_id', artistIds),
  ]);
  if (artistsResult.error) throw new Error(artistsResult.error.message);
  if (cloudResult.error) throw new Error(cloudResult.error.message);
  if (artistTracksResult.error) throw new Error(artistTracksResult.error.message);

  const ownerByArtist = new Map((artistsResult.data || []).map(row => [row.id, row.account_id]));
  const durationByCloud = new Map((cloudResult.data || []).map(row => [String(row.id), Number(row.duration)]));
  const historyTrackRows = artistTracksResult.data || [];
  const historyTrackIds = historyTrackRows.map(row => row.id);
  const artistByTrack = new Map(historyTrackRows.map(row => [row.id, row.artist_id]));

  let historyRows = [];
  if (historyTrackIds.length) {
    const { data, error } = await supabase.from('track_plays')
      .select('track_id, played_at')
      .eq('username', username)
      .in('track_id', historyTrackIds);
    if (error) throw new Error(error.message);
    historyRows = data || [];
  }

  const historyByArtist = new Map();
  for (const play of historyRows) {
    const artistId = artistByTrack.get(play.track_id);
    if (!artistId) continue;
    const current = historyByArtist.get(artistId) || { count: 0, lastPlayedAt: null };
    current.count += 1;
    if (!current.lastPlayedAt || play.played_at > current.lastPlayedAt) current.lastPlayedAt = play.played_at;
    historyByArtist.set(artistId, current);
  }

  const paidTrackIds = new Set((paidRows || []).map(row => row.track_id));
  const todayPaidRows = (paidRows || []).filter(row => String(row.payout_date) === today);
  const dailyArtistCounts = new Map();
  for (const row of todayPaidRows) dailyArtistCounts.set(row.artist_id, (dailyArtistCounts.get(row.artist_id) || 0) + 1);
  const dailyArtists = new Set(todayPaidRows.map(row => row.artist_id));
  const recencyCutoff = Date.now() - config.eligibleRecencyDays * 86400_000;

  const offers = candidates.filter(track => {
    if (ownerByArtist.get(track.artist_id) === username) return false;
    const duration = durationByCloud.get(String(track.cloud_file_id));
    if (!Number.isFinite(duration) || duration < config.minSecondsFloor) return false;
    if (paidTrackIds.has(track.id)) return false;
    if ((dailyArtistCounts.get(track.artist_id) || 0) >= config.maxTracksPerArtistPerDay) return false;
    if (dailyArtists.size >= config.maxArtistsPerDay && !dailyArtists.has(track.artist_id)) return false;
    const history = historyByArtist.get(track.artist_id) || { count: 0, lastPlayedAt: null };
    return history.count < config.eligibleLifetimePlayCeiling ||
      !history.lastPlayedAt || new Date(history.lastPlayedAt).getTime() < recencyCutoff;
  }).slice(0, limit);

  return {
    config,
    offers,
    dailyArtistsUsed: dailyArtists.size,
    dailyTracksEarned: todayPaidRows.length,
    dailyArtistCounts,
    durationByCloud,
  };
}

// ─── Creator Insights ──────────────────────────────────────────────────────
// Powers GET /api/artists/:id/insights (owner-only). Pulls raw track_plays
// rows for every track the artist owns and aggregates in JS rather than a
// SQL GROUP BY — at FREQ's current data volume this is simpler to read and
// debug than juggling several separate aggregate queries or a Postgres
// view, and it's a single indexed query (idx_track_plays_track_id_source /
// idx_track_plays_track_id_played_at from the migration) rather than N
// queries. Revisit with a real GROUP BY if an artist's play volume ever
// makes the in-memory reduce noticeably slow — not a concern at today's
// scale.
async function dbGetArtistInsights(artistId, { days = 30 } = {}) {
  const { data: tracks, error: tracksErr } = await supabase
    .from('tracks')
    .select('id, title, play_count, play_count_7d, cover_url')
    .eq('artist_id', artistId)
    .eq('is_published', true);
  if (tracksErr) { console.error('[db] getArtistInsights tracks:', tracksErr.message); return null; }
  if (!tracks || !tracks.length) {
    return { tracks: [], bySource: {}, byDay: [], totalPlays: 0 };
  }

  const trackIds = tracks.map(t => t.id);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data: plays, error: playsErr } = await supabase
    .from('track_plays')
    .select('track_id, source, played_at')
    .in('track_id', trackIds)
    .gte('played_at', since);
  if (playsErr) { console.error('[db] getArtistInsights plays:', playsErr.message); return null; }

  const bySource = {};
  const byDayMap = new Map(); // 'YYYY-MM-DD' -> count
  const byTrackMap = new Map(trackIds.map(id => [id, { bySource: {}, total: 0 }]));

  for (const row of plays || []) {
    const src = row.source || 'direct';
    bySource[src] = (bySource[src] || 0) + 1;

    const day = row.played_at.slice(0, 10);
    byDayMap.set(day, (byDayMap.get(day) || 0) + 1);

    const trackAgg = byTrackMap.get(row.track_id);
    if (trackAgg) {
      trackAgg.bySource[src] = (trackAgg.bySource[src] || 0) + 1;
      trackAgg.total++;
    }
  }

  // Zero-fill every day in the window so the frontend gets a continuous
  // series to chart rather than having to interpolate gaps itself.
  const byDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    byDay.push({ date: d, plays: byDayMap.get(d) || 0 });
  }

  return {
    totalPlays: (plays || []).length,
    bySource,
    byDay,
    tracks: tracks
      .map(t => ({
        id: t.id, title: t.title, coverUrl: t.cover_url,
        playCountAllTime: t.play_count || 0, playCount7d: t.play_count_7d || 0,
        playsInWindow: byTrackMap.get(t.id)?.total || 0,
        bySource: byTrackMap.get(t.id)?.bySource || {},
      }))
      .sort((a, b) => b.playsInWindow - a.playsInWindow),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TASTE GRAPH — recommendations built entirely from FREQ's own data.
//  GET /api/taste — see full route doc further below, near the route itself.
//
//  Sources used, and exactly which existing table backs each (per the
//  Phase 4 brief's own list):
//    Listening history   → track_plays (username, track_id, played_at)
//    Liked songs         → track_likes
//    Favorite artists    → artist_followers
//    Playlists           → playlists_v2 + playlist_tracks
//    Radio stations      → radio_recent_plays / radio_favorites (tags/country
//                          only — deliberately never joined into play-count-
//                          style weighting; see that table's own doc comment
//                          for why radio stays isolated from track_plays)
//    Skipped tracks      → track_plays.completed = false (new column, see
//                          migrations/create_taste_graph.sql and logPlay()
//                          client-side for how this gets populated)
//
//  No external ML, no embeddings, no third-party API. Everything below is
//  co-occurrence and recency arithmetic over rows FREQ already has,
//  computed in JS the same way dbGetArtistInsights above aggregates raw
//  track_plays rows rather than leaning on a SQL GROUP BY — consistent
//  with this file's existing "simple to read and debug at today's data
//  volume" preference. Revisit with real SQL aggregation if a user's row
//  counts ever make this noticeably slow; not a concern yet.
//
//  Every dbTaste* helper below degrades to an empty result for a user with
//  too little history rather than erroring — a brand new account should see
//  "keep listening to unlock recommendations", not a 500.
// ═══════════════════════════════════════════════════════════════════════════════

const TASTE_MIN_HISTORY_ROWS = 5; // below this, there's not enough signal to recommend anything meaningful

// Raw plays for one user in a lookback window, joined to the track's
// artist_id/artist_name/title/cover — the one query nearly every Taste
// Graph helper below starts from, so it's centralized here rather than
// each helper re-selecting the same join with slightly different columns.
async function dbTasteGetUserPlays(username, { days = 90, limit = 500 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('track_plays')
    .select('track_id, played_at, completed, tracks(id, title, artist_id, artist_name, cover_url, platform, original_url, is_explicit, content_rating)')
    .eq('username', username)
    .gte('played_at', since)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[db] tasteGetUserPlays:', error.message); return []; }
  // Supabase's embedded-resource join returns null for a track_plays row
  // whose track was since deleted (e.g. an unpublished/removed track) —
  // filter those out here once so every downstream helper can assume
  // row.tracks is always present rather than null-checking repeatedly.
  return (data || []).filter(row => row.tracks);
}

// Top artists by play frequency within a user's recent history — the seed
// for "similar artists" and "because you listened to". Excludes artists
// the user already follows when `excludeFollowed` is passed, since those
// two Taste Graph modules serve different purposes (one surfaces NEW
// artists, the other explicitly reinforces existing follows elsewhere).
function tasteTopArtistsFromPlays(plays, { limit = 10 } = {}) {
  const counts = new Map(); // artist_id -> { artistId, artistName, plays }
  for (const row of plays) {
    const t = row.tracks;
    if (!t.artist_id) continue; // unpublished/unresolved tracks have no artist link — nothing to graph
    const cur = counts.get(t.artist_id) || { artistId: t.artist_id, artistName: t.artist_name, plays: 0 };
    cur.plays++;
    counts.set(t.artist_id, cur);
  }
  return [...counts.values()].sort((a, b) => b.plays - a.plays).slice(0, limit);
}

// "Because you listened to {artist}" — for each of the user's top few
// artists, find OTHER listeners of that same artist (via track_plays) and
// surface tracks THEY played by DIFFERENT artists the requesting user
// hasn't played much. This is plain co-occurrence — "people who listened
// to X also listened to Y" — computed from real rows, not a trained model.
async function dbTasteBecauseYouListened(username, { seedLimit = 3, tracksPerSeed = 6, allowedRatings = null, restrictions = null } = {}) {
  const myPlays = await dbTasteGetUserPlays(username, { days: 90 });
  if (myPlays.length < TASTE_MIN_HISTORY_ROWS) return [];
  const myArtistIds = new Set(myPlays.map(r => r.tracks.artist_id).filter(Boolean));
  const seeds = tasteTopArtistsFromPlays(myPlays, { limit: seedLimit });
  if (!seeds.length) return [];

  const results = [];
  for (const seed of seeds) {
    // Other listeners of this seed artist, most recent first, capped —
    // this is a fan-out query per seed artist (at most seedLimit of them,
    // so 3 extra queries typically), not a full-table scan.
    const { data: coListeners, error } = await supabase
      .from('track_plays')
      .select('username, tracks!inner(artist_id)')
      .eq('tracks.artist_id', seed.artistId)
      .not('username', 'is', null)
      .neq('username', username)
      .order('played_at', { ascending: false })
      .limit(200);
    if (error || !coListeners?.length) continue;
    const otherUsernames = [...new Set(coListeners.map(r => r.username))].slice(0, 25);
    if (!otherUsernames.length) continue;

    // What ELSE those listeners played, excluding the seed artist itself
    // and anything the requesting user already has meaningful history
    // with — the point is surfacing something new, not echoing their own
    // top artist back at them.
    const { data: theirOtherPlays, error: err2 } = await supabase
      .from('track_plays')
      .select('track_id, tracks!inner(id, title, artist_id, artist_name, cover_url, platform, original_url, is_explicit, content_rating)')
      .in('username', otherUsernames)
      .neq('tracks.artist_id', seed.artistId)
      .order('played_at', { ascending: false })
      .limit(150);
    if (err2 || !theirOtherPlays?.length) continue;

    // Part 3: drop candidates outside the requester's allowed ratings
    // before they're even counted, so a filtered-out track can't win a
    // count-based ranking slot and then get silently swapped for runner-up.
    const eligiblePlays = await tasteFilterByAllowedRatings(theirOtherPlays, allowedRatings, undefined, restrictions);

    const trackCounts = new Map(); // track_id -> { track, count }
    for (const row of eligiblePlays) {
      const t = row.tracks;
      if (!t || myArtistIds.has(t.artist_id)) continue; // skip artists the user already knows well
      const cur = trackCounts.get(t.id) || { track: t, count: 0 };
      cur.count++;
      trackCounts.set(t.id, cur);
    }
    const topForSeed = [...trackCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, tracksPerSeed)
      .map(({ track }) => track);
    if (topForSeed.length) {
      results.push({ becauseOf: seed.artistName, tracks: topForSeed.map(tasteShapeTrack) });
    }
  }
  return results;
}

// "Similar artists" — other artists sharing a genre with the user's top
// artists (artists.genre is the one genre signal that exists today; see
// this module's header comment — Step 4's richer audio-analysis metadata
// will give this more to work with later without changing this function's
// shape, just its inputs). Ranked by follower_count as the best available
// "worth surfacing" signal, same ranking Discover → Artists already uses.
//
// Radio tags (radio_favorites + radio_recent_plays) widen the genre seed
// set beyond just the user's played artists — someone who favorites a lot
// of "lofi,chill" stations is expressing a real taste signal even if none
// of their track plays happen to have a matching artists.genre value yet.
// Matched with ILIKE rather than an exact set-membership check like the
// artist-derived genres above: Radio Browser's tags are free-text listener
// folksonomy ("hiphop", "hip-hop", "rap") and won't share exact strings
// with artists.genre, so a substring match is the honest way to connect
// the two vocabularies without either silently no-op-ing or forcing radio
// tags to be a controlled vocabulary they were never designed as. This
// still never touches track_plays/tracks — radio's play-count isolation
// (see the migration + this module's header comment) is preserved; radio
// only ever contributes genre/country TEXT here, nothing that could
// influence a play count or chart position.
async function dbTasteRadioGenreHints(username, { limit = 6 } = {}) {
  const [{ data: favs }, { data: recents }] = await Promise.all([
    supabase.from('radio_favorites').select('tags').eq('owner', username).limit(30),
    supabase.from('radio_recent_plays').select('tags').eq('owner', username).order('played_at', { ascending: false }).limit(30),
  ]);
  const raw = [...(favs || []), ...(recents || [])]
    .flatMap(r => (r.tags || '').split(',').map(t => t.trim().toLowerCase()))
    .filter(Boolean);
  // Most-common tags first, small vocabulary only — this is a hint to widen
  // an ILIKE search, not a ranked taste profile in its own right.
  const counts = new Map();
  for (const tag of raw) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag);
}

async function dbTasteSimilarArtists(username, { limit = 12 } = {}) {
  const myPlays = await dbTasteGetUserPlays(username, { days: 180 });
  if (myPlays.length < TASTE_MIN_HISTORY_ROWS) return [];
  const seeds = tasteTopArtistsFromPlays(myPlays, { limit: 5 });
  if (!seeds.length) return [];

  const { data: seedArtists, error } = await supabase
    .from('artists').select('id, genre').in('id', seeds.map(s => s.artistId));
  if (error) { console.error('[db] tasteSimilarArtists seeds:', error.message); return []; }
  const genres = [...new Set((seedArtists || []).map(a => a.genre).filter(Boolean))];

  const followedIds = new Set((await dbGetFollowedArtistIds(username)) || []);
  const knownIds = new Set(seeds.map(s => s.artistId));

  // Exact genre matches (from the user's own played artists) and radio-tag
  // substring matches are two different query shapes — run both and merge,
  // rather than trying to force one .in()/.ilike() call to do both jobs.
  const candidateRows = [];
  if (genres.length) {
    const { data, error: err2 } = await supabase
      .from('artists')
      .select('id, name, genre, avatar_url, follower_count, is_verified')
      .in('genre', genres)
      .order('follower_count', { ascending: false })
      .limit(limit + seeds.length + 10); // over-fetch to survive filtering out seeds/already-followed below
    if (err2) console.error('[db] tasteSimilarArtists candidates:', err2.message);
    else candidateRows.push(...(data || []));
  }

  const radioTags = await dbTasteRadioGenreHints(username);
  if (radioTags.length) {
    // One OR-of-ILIKE query across a small tag set, capped separately from
    // the exact-genre fetch above so a listener with lots of radio activity
    // but few played artists still gets real candidates back.
    const orExpr = radioTags.map(tag => `genre.ilike.%${tag.replace(/[%_,]/g, '')}%`).join(',');
    const { data, error: err3 } = await supabase
      .from('artists')
      .select('id, name, genre, avatar_url, follower_count, is_verified')
      .or(orExpr)
      .order('follower_count', { ascending: false })
      .limit(limit + 10);
    if (err3) console.error('[db] tasteSimilarArtists radio candidates:', err3.message);
    else candidateRows.push(...(data || []));
  }

  if (!candidateRows.length) return [];
  const seen = new Set();
  const merged = [];
  for (const a of candidateRows) {
    if (seen.has(a.id) || knownIds.has(a.id) || followedIds.has(a.id)) continue;
    seen.add(a.id);
    merged.push(a);
  }
  return merged
    .sort((a, b) => (b.follower_count || 0) - (a.follower_count || 0))
    .slice(0, limit)
    .map(a => ({
      id: a.id, name: a.name, genre: a.genre, avatarUrl: a.avatar_url,
      followerCount: a.follower_count || 0, isVerified: !!a.is_verified,
    }));
}

// "Similar playlists" — public playlists that contain at least one track
// by an artist the user actually listens to. playlist_tracks.track_data is
// jsonb (denormalized per-track snapshot, not a foreign key to `tracks` —
// see dbAddTrackToPlaylist), so this can't be a server-side join; it reads
// public playlists' track_data client-side-of-the-query (in JS, after
// fetching) and checks each one's artist field against the user's known
// artist names. Matches by artist NAME rather than artist_id because
// track_data is a point-in-time snapshot that was never guaranteed to
// carry artist_id even when the live tracks row has one.
async function dbTasteSimilarPlaylists(username, { limit = 8 } = {}) {
  const myPlays = await dbTasteGetUserPlays(username, { days: 180 });
  if (myPlays.length < TASTE_MIN_HISTORY_ROWS) return [];
  const myArtistNames = new Set(
    myPlays.map(r => (r.tracks.artist_name || '').toLowerCase().trim()).filter(Boolean)
  );
  if (!myArtistNames.size) return [];

  const { data: playlists, error } = await supabase
    .from('playlists_v2')
    .select('id, name, description, owner, cover_url, like_count, track_count')
    .eq('is_public', true)
    .gt('track_count', 0)
    .order('like_count', { ascending: false })
    .limit(60); // scan a bounded candidate set rather than every public playlist on the platform
  if (error) { console.error('[db] tasteSimilarPlaylists playlists:', error.message); return []; }
  if (!playlists?.length) return [];

  const scored = [];
  for (const pl of playlists) {
    const { data: tracks } = await supabase
      .from('playlist_tracks').select('track_data').eq('playlist_id', pl.id).limit(50);
    let matches = 0;
    for (const row of (tracks || [])) {
      const artist = (row.track_data?.artist || row.track_data?.artistName || '').toLowerCase().trim();
      if (artist && myArtistNames.has(artist)) matches++;
    }
    if (matches > 0) scored.push({ playlist: pl, matches });
  }
  return scored
    .sort((a, b) => b.matches - a.matches)
    .slice(0, limit)
    .map(({ playlist: p, matches }) => ({
      id: p.id, name: p.name, description: p.description, owner: p.owner,
      coverUrl: p.cover_url, likeCount: p.like_count || 0, trackCount: p.track_count || 0,
      matchingTracks: matches,
    }));
}

// "Trending in your taste" — tracks currently trending platform-wide
// (play_count_7d, same signal Charts uses) narrowed to artists the user
// already has history with, OR sharing a genre with their top artists.
// This is the intersection of "popular right now" and "matches your
// taste", not just a copy of the global trending chart.
async function dbTasteTrendingInTaste(username, { limit = 12, allowedRatings = null, restrictions = null } = {}) {
  const myPlays = await dbTasteGetUserPlays(username, { days: 90 });
  if (myPlays.length < TASTE_MIN_HISTORY_ROWS) return [];
  const myArtistIds = new Set(myPlays.map(r => r.tracks.artist_id).filter(Boolean));

  const { data: seedArtists } = await supabase
    .from('artists').select('genre').in('id', [...myArtistIds]).limit(20);
  const myGenres = new Set((seedArtists || []).map(a => a.genre).filter(Boolean));

  let trendingQuery = supabase
    .from('tracks')
    .select('id, title, artist_id, artist_name, cover_url, platform, original_url, play_count_7d, is_explicit, content_rating, artists(genre)')
    .eq('is_published', true)
    .gt('play_count_7d', 0);
  if (allowedRatings) trendingQuery = trendingQuery.in('content_rating', allowedRatings);
  const { data: trending, error } = await trendingQuery
    .order('play_count_7d', { ascending: false })
    .limit(80); // bounded candidate pool from the trending edge, then filtered down to taste-matches
  if (error) { console.error('[db] tasteTrendingInTaste:', error.message); return []; }

  const tasteMatched = (trending || [])
    .filter(t => myArtistIds.has(t.artist_id) || (t.artists?.genre && myGenres.has(t.artists.genre)));

  // Part 6: blocked artist/genre/track, same as every other Taste Graph
  // module — applied after the taste-match filter (cheaper: only checks
  // the rows that would actually be returned) but before the limit slice,
  // so a blocked track never occupies a slot a legitimate one should fill.
  const genreCache = new Map();
  const eligible = [];
  for (const t of tasteMatched) {
    const blocked = restrictions ? await isTrackBlockedByRestrictions(t, restrictions, genreCache) : false;
    if (!blocked) eligible.push(t);
    if (eligible.length >= limit) break;
  }

  return eligible.map(t => ({
    id: t.id, title: t.title, artistId: t.artist_id, artistName: t.artist_name,
    coverUrl: t.cover_url, platform: t.platform, originalUrl: t.original_url,
    playCount7d: t.play_count_7d, isExplicit: !!t.is_explicit,
    contentRating: t.content_rating || 'clean',
  }));
}

// Shared recency-bucket helper for "recently rediscovered" and "recently
// forgotten favorites" — both compare an OLDER window against a RECENT
// window of the same user's track_plays, just asking opposite questions
// of the same two buckets (played-then-quiet-then-played-again vs
// played-a-lot-then-gone-quiet). Centralizing the two-window fetch avoids
// four near-identical Supabase calls across the two functions below.
async function dbTasteGetPlayBuckets(username, { recentDays = 14, olderDays = 120, allowedRatings = null, restrictions = null } = {}) {
  const recentSince = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString();
  const olderSince  = new Date(Date.now() - olderDays  * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: recent, error: e1 }, { data: older, error: e2 }] = await Promise.all([
    supabase.from('track_plays')
      .select('track_id, played_at, tracks(id, title, artist_id, artist_name, cover_url, platform, original_url, is_explicit, content_rating)')
      .eq('username', username).gte('played_at', recentSince).order('played_at', { ascending: false }).limit(300),
    supabase.from('track_plays')
      .select('track_id, played_at, tracks(id, title, artist_id, artist_name, cover_url, platform, original_url, is_explicit, content_rating)')
      .eq('username', username).gte('played_at', olderSince).lt('played_at', recentSince).order('played_at', { ascending: false }).limit(300),
  ]);
  if (e1 || e2) { console.error('[db] tasteGetPlayBuckets:', e1?.message || e2?.message); return { recent: [], older: [] }; }
  // Part 3: these buckets feed "recently rediscovered/forgotten", which are
  // presented as recommendation-style nudges, not a plain history view — so
  // (unlike dbTasteGetUserPlays) they ARE filtered against the requester's
  // current allowed ratings before being handed to either module below.
  return {
    recent: await tasteFilterByAllowedRatings((recent || []).filter(r => r.tracks), allowedRatings, undefined, restrictions),
    older:  await tasteFilterByAllowedRatings((older  || []).filter(r => r.tracks), allowedRatings, undefined, restrictions),
  };
}

// "Recently rediscovered" — tracks played in the OLDER window, went quiet
// (no plays at all in the gap between older and recent), then got played
// again in the RECENT window. A real "oh, this again!" pattern rather than
// just "played twice recently".
async function dbTasteRecentlyRediscovered(username, { limit = 10, allowedRatings = null, restrictions = null } = {}) {
  const { recent, older } = await dbTasteGetPlayBuckets(username, { recentDays: 14, olderDays: 150, allowedRatings, restrictions });
  if (recent.length < 2 || older.length < 2) return [];
  // "Went quiet in between" is approximated by requiring the older play to
  // be from ≥30 days before the recent one — a true gap-detection would
  // need every play timestamp for the track, which the buckets already
  // discard by design (the two-window fetch above only fetches the
  // EDGES); a 30-day floor is deliberately conservative for a "quiet
  // enough to count as rediscovered" reading.
  const recentByTrack = new Map(recent.map(r => [r.track_id, r.played_at]));
  const olderByTrack  = new Map(older.map(r  => [r.track_id, r.played_at]));
  const rediscovered = [];
  for (const [trackId, recentAt] of recentByTrack) {
    const olderAt = olderByTrack.get(trackId);
    if (!olderAt) continue;
    const gapDays = (new Date(recentAt) - new Date(olderAt)) / (1000 * 60 * 60 * 24);
    if (gapDays >= 30) {
      const track = recent.find(r => r.track_id === trackId)?.tracks;
      if (track) rediscovered.push({ track, lastPlayedBefore: olderAt, playedAgainAt: recentAt });
    }
  }
  return rediscovered.slice(0, limit).map(r => ({
    ...tasteShapeTrack(r.track), lastPlayedBefore: r.lastPlayedBefore, playedAgainAt: r.playedAgainAt,
  }));
}

// "Recently forgotten favorites" — tracks the user clearly liked (either
// explicitly via track_likes, or implicitly via heavy play volume in the
// older window) that have had ZERO plays in the recent window. The
// opposite question from rediscovered: "you used to love this, where'd it go?"
async function dbTasteRecentlyForgotten(username, { limit = 10, allowedRatings = null, restrictions = null } = {}) {
  const { recent, older } = await dbTasteGetPlayBuckets(username, { recentDays: 21, olderDays: 180, allowedRatings, restrictions });
  const recentTrackIds = new Set(recent.map(r => r.track_id));

  // Older-window play counts per track — "heavy" is relative to this
  // user's own history (top quartile-ish), not a fixed global number, so
  // a light listener's favorites aren't held to a power-listener's bar.
  const olderCounts = new Map(); // track_id -> { track, count }
  for (const row of older) {
    const cur = olderCounts.get(row.track_id) || { track: row.tracks, count: 0 };
    cur.count++;
    olderCounts.set(row.track_id, cur);
  }
  const countsSorted = [...olderCounts.values()].sort((a, b) => b.count - a.count);
  const heavyThreshold = countsSorted.length >= 4
    ? countsSorted[Math.floor(countsSorted.length / 4)].count // top quartile cutoff
    : 2; // small history: anything played 2+ times counts as a "favorite"

  const forgottenFromPlays = countsSorted
    .filter(({ track, count }) => track && count >= heavyThreshold && !recentTrackIds.has(track.id));

  // Explicit likes are an even stronger signal than play volume — pull the
  // user's liked tracks and add any that have gone quiet, even if their
  // historical play count never crossed the heavy threshold above (someone
  // can like a track after just one or two plays).
  const { data: likedRows, error } = await supabase
    .from('track_likes').select('track_id, tracks(id, title, artist_id, artist_name, cover_url, platform, original_url, is_explicit, content_rating)')
    .eq('username', username).limit(200);
  if (error) console.error('[db] tasteRecentlyForgotten likes:', error.message);
  const eligibleLikedRows = await tasteFilterByAllowedRatings((likedRows || []).filter(row => row.tracks), allowedRatings, undefined, restrictions);
  const forgottenFromLikes = eligibleLikedRows
    .filter(row => !recentTrackIds.has(row.tracks.id))
    .map(row => ({ track: row.tracks, count: null }));

  const seen = new Set();
  const merged = [];
  for (const entry of [...forgottenFromLikes, ...forgottenFromPlays]) {
    if (!entry.track || seen.has(entry.track.id)) continue;
    seen.add(entry.track.id);
    merged.push(entry.track);
  }
  return merged.slice(0, limit).map(tasteShapeTrack);
}

// Consistent public shape for a `tracks` row wherever Taste Graph returns
// one — mirrors the field names Discover/Charts already use client-side
// (playFromDiscoverTracks-style rows) so the frontend can reuse the same
// resolveChartTrack() play/queue path without a parallel shape to handle.
function tasteShapeTrack(t) {
  return {
    id: t.id, title: t.title, artistId: t.artist_id, artistName: t.artist_name,
    coverUrl: t.cover_url, platform: t.platform, originalUrl: t.original_url,
    isExplicit: !!t.is_explicit, contentRating: t.content_rating || 'clean',
  };
}

// Part 3 enforcement for Taste Graph: every recommendation module below
// surfaces OTHER users' tracks (co-occurrence, trending-in-taste, etc.),
// which is exactly the "Recommendations" surface Part 3 calls out by name
// — unlike dbTasteGetUserPlays (the requester's OWN play history, which
// this deliberately does NOT filter; hiding someone's own past plays just
// because they flipped a filter afterward isn't what Part 3 asks for).
// Filtered at the row level (not via .in() inside the nested tracks(...)
// embed above) since Supabase JS can't reliably push a filter onto an
// embedded/joined table's column across client versions — filtering the
// flat array after fetch is the safe, version-independent approach.
// Part 3 rating filter AND Part 6 blocked artist/genre/track filter, in one
// pass — every Taste Graph module already funnels its candidate rows
// through this single function, so this is the one place both restrictions
// need to be threaded through rather than duplicating the check at each of
// the 5 call sites below. `restrictions` is optional and additive: passing
// null (the non-child default) skips the blocked-content pass entirely and
// this behaves exactly as it did before, rating-filter only.
async function tasteFilterByAllowedRatings(rows, allowedRatings, trackAccessor = r => r.tracks, restrictions = null) {
  let filtered = rows;
  if (allowedRatings) {
    const allowed = new Set(allowedRatings);
    filtered = filtered.filter(row => {
      const t = trackAccessor(row);
      return t && allowed.has(t.content_rating || 'clean');
    });
  }
  if (restrictions) {
    const genreCache = new Map();
    const kept = [];
    for (const row of filtered) {
      const t = trackAccessor(row);
      if (!t) continue;
      const blocked = await isTrackBlockedByRestrictions(t, restrictions, genreCache);
      if (!blocked) kept.push(row);
    }
    filtered = kept;
  }
  return filtered;
}

async function dbGetFollowedArtistIds(username) {
  const { data, error } = await supabase
    .from('artist_followers').select('artist_id').eq('follower_username', username);
  if (error) { console.error('[db] getFollowedArtistIds:', error.message); return []; }
  return (data || []).map(r => r.artist_id);
}

// Skipped tracks — the one Taste Graph source that's purely diagnostic
// rather than recommendation fuel: surfaced back to the user as "you tend
// to skip these" rather than fed into any of the modules above, since a
// skip is a much weaker/noisier signal than a play (someone can skip a
// track they like because they weren't in the mood, not because they
// dislike it) and treating it as strong negative signal would be a
// confident claim the data doesn't support.
async function dbTasteRecentlySkipped(username, { limit = 10, days = 30, allowedRatings = null, restrictions = null } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('track_plays')
    .select('track_id, played_at, tracks(id, title, artist_id, artist_name, cover_url, platform, original_url, is_explicit, content_rating)')
    .eq('username', username).eq('completed', false)
    .gte('played_at', since).order('played_at', { ascending: false }).limit(limit * 3);
  if (error) { console.error('[db] tasteRecentlySkipped:', error.message); return []; }
  const eligible = await tasteFilterByAllowedRatings((data || []).filter(r => r.tracks), allowedRatings, undefined, restrictions);
  const seen = new Set();
  const out = [];
  for (const row of eligible) {
    if (seen.has(row.tracks.id)) continue;
    seen.add(row.tracks.id);
    out.push(tasteShapeTrack(row.tracks));
    if (out.length >= limit) break;
  }
  return out;
}

async function dbGetTopTracks({ window = 'all', limit = 50, allowedRatings = null } = {}) {
  const col = window === '7d' ? 'play_count_7d' : 'play_count';
  let query = supabase
    .from('tracks')
    .select('id, original_url, platform, title, play_count, play_count_7d, last_played_at, cover_url, cloud_file_id, artist_id, artist_name, is_explicit, content_rating')
    .eq('is_published', true)
    .gt(col, 0);
  if (allowedRatings) query = query.in('content_rating', allowedRatings);
  const { data, error } = await query
    .order(col, { ascending: false })
    .order('last_played_at', { ascending: false }) // tiebreak: more recently played ranks higher
    .limit(limit);
  if (error) { console.error('[db] getTopTracks:', error.message); return []; }
  return data || [];
}

// Duration is stored on cloud_files, not tracks. Discovery needs it in
// charts and search rows, so resolve the small batch once per request rather
// than issuing an artwork-row-sized N+1 query.
async function dbDurationByCloudFile(rows) {
  const cloudIds = [...new Set((rows || []).map(row => row.cloud_file_id).filter(Boolean))];
  if (!cloudIds.length) return new Map();
  const { data, error } = await supabase.from('cloud_files')
    .select('id, duration').in('id', cloudIds);
  if (error) {
    console.error('[db] discovery durations:', error.message);
    return new Map();
  }
  return new Map((data || []).map(row => [String(row.id), Number(row.duration)]));
}

// Recompute the rolling 7-day count for every track that's had a play
// recently (and zero out any track that fell out of the window entirely —
// COALESCE handles tracks with no rows in the last 7 days). Run on a timer
// rather than per-request since this is a full aggregate over track_plays
// and doesn't need to be real-time-accurate to the second.
async function recomputeWeeklyPlayCounts() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent, error } = await supabase
      .from('track_plays')
      .select('track_id')
      .gte('played_at', sevenDaysAgo);
    if (error) { console.error('[charts] recompute fetch:', error.message); return; }

    const counts = new Map();
    for (const row of recent || []) counts.set(row.track_id, (counts.get(row.track_id) || 0) + 1);

    // Tracks with recent plays: write their fresh count.
    for (const [trackId, count] of counts) {
      await supabase.from('tracks').update({ play_count_7d: count }).eq('id', trackId);
    }
    // Tracks with a stale nonzero play_count_7d but no plays in the window
    // anymore need to be zeroed, or they'd never leave the Trending chart.
    const { data: stale } = await supabase
      .from('tracks').select('id').gt('play_count_7d', 0);
    for (const row of stale || []) {
      if (!counts.has(row.id)) await supabase.from('tracks').update({ play_count_7d: 0 }).eq('id', row.id);
    }
  } catch (err) {
    console.error('[charts] recompute failed:', err);
  }
}
// Every 10 minutes is frequent enough that Trending feels responsive
// without turning this into a per-request cost on every Charts page load.
setInterval(recomputeWeeklyPlayCounts, 10 * 60 * 1000);
recomputeWeeklyPlayCounts(); // run once at boot so play_count_7d isn't empty until the first interval fires

// ─── Discovery ───────────────────────────────────────────────────────────────
// Every existing playlist/profile query in this file is scoped to a single
// owner or username (dbGetUserPlaylists(owner), dbGetProfile(username),
// etc) — there has never been a "browse everything public" query, because
// nothing before Discovery needed one. These two helpers are the first
// cross-user reads in the app and lean on the partial indexes added
// alongside this feature (idx_playlists_v2_public_likes,
// idx_playlists_v2_public_recent, idx_profiles_public_followers).

function discoverSafeSearchTerm(value) {
  // PostgREST's raw `or` filter syntax uses commas and parentheses as
  // delimiters. Replace those delimiters in user text before interpolation;
  // percent/underscore are kept so ordinary SQL wildcard searches continue
  // to behave as users expect.
  return String(value || '').trim().slice(0, 100).replace(/[(),"]/g, ' ');
}

async function dbDiscoverPlaylists({ sort = 'likes', limit = 30, query = null } = {}) {
  let q = supabase.from('playlists_v2').select('*').eq('is_public', true);
  const safeQuery = discoverSafeSearchTerm(query);
  if (safeQuery) {
    q = q.or(`name.ilike.%${safeQuery}%,description.ilike.%${safeQuery}%,owner.ilike.%${safeQuery}%`);
  }
  q = sort === 'recent'
    ? q.order('updated_at', { ascending: false })
    : q.order('like_count', { ascending: false }).order('updated_at', { ascending: false });
  const { data, error } = await q.limit(limit);
  if (error) { console.error('[db] discoverPlaylists:', error.message); return []; }
  return data || [];
}

// Public profiles ranked by follower_count, as a simple "who's around"
// surface. Excludes the requester's own profile (seeing yourself on a
// "discover people" list is a known confusing pattern in other apps —
// nothing to discover about an account you already own) when a session is
// supplied; omitted entirely for anonymous requests.
async function dbDiscoverProfiles({ limit = 20, excludeUsername = null, query = null } = {}) {
  let q = supabase.from('profiles').select('*').eq('is_public', true)
    .order('follower_count', { ascending: false });
  const safeQuery = discoverSafeSearchTerm(query);
  if (safeQuery) {
    q = q.or(`username.ilike.%${safeQuery}%,display_name.ilike.%${safeQuery}%,bio.ilike.%${safeQuery}%`);
  }
  if (excludeUsername) q = q.neq('username', excludeUsername);
  const { data, error } = await q.limit(limit);
  if (error) { console.error('[db] discoverProfiles:', error.message); return []; }
  return data || [];
}

// ─── Artist Discovery ───────────────────────────────────────────────────────
// Three modes, all reading the same `artists` + `artist_stats` join (a left
// join via the FK, so a brand-new artist with no artist_stats row yet still
// comes back — stats fields just arrive null, handled at the mapping layer
// in the route, not here):
//
//   trending — ranked by chart_rank (set by recomputeArtistStats off
//              total_plays_7d), nulls last. This is "what's hot right now",
//              and an artist with zero plays in the last 7 days has no
//              chart_rank at all (see that function's comment), so they
//              correctly never appear here — that's what "trending" means.
//
//   new      — created within NEW_ARTIST_WINDOW_DAYS, ordered newest-first,
//              zero dependency on plays/followers/chart_rank. This is the
//              guaranteed-visibility path: every artist passes through this
//              list for a fixed window right after creation, independent of
//              whether anyone's listened yet.
//
//   search   — name ILIKE match, ranked by follower_count as a reasonable
//              relevance proxy among matches (no trigram/full-text index on
//              artists.name yet — exact-substring ILIKE is the right cost
//              for what's realistically a small table).
const NEW_ARTIST_WINDOW_DAYS = 30;

async function dbDiscoverArtists({ mode = 'trending', limit = 20, query = null } = {}) {
  let q = supabase.from('artists').select('*, artist_stats(*)');

  if (mode === 'search' && query) {
    q = q.ilike('name', `%${query}%`).order('follower_count', { ascending: false }).limit(limit);
  } else if (mode === 'new') {
    const cutoff = new Date(Date.now() - NEW_ARTIST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte('created_at', cutoff).order('created_at', { ascending: false }).limit(limit);
  } else {
    // trending — chart_rank lives on artist_stats, a related table, so it
    // can't be ordered via the embedded-select query builder directly;
    // pull a generous candidate set ordered by created_at (cheap, indexed)
    // and rank client-side instead. Candidate set is capped well above any
    // realistic `limit` so this stays correct without scaling badly.
    const { data, error } = await q.limit(500);
    if (error) { console.error('[db] discoverArtists (trending):', error.message); return []; }
    const ranked = (data || [])
      .filter(a => a.artist_stats?.chart_rank != null)
      .sort((a, b) => a.artist_stats.chart_rank - b.artist_stats.chart_rank)
      .slice(0, limit);
    return ranked;
  }

  const { data, error } = await q;
  if (error) { console.error('[db] discoverArtists:', mode, error.message); return []; }
  return data || [];
}

async function dbDiscoverReleases({ type = null, sort = 'recent', limit = 30, query = null, allowedRatings = null } = {}) {
  let q = supabase.from('artist_releases')
    .select('id, title, release_type, cover_url, release_date, track_count, total_plays, total_likes, content_rating, artist_id, artists(id, slug, name, avatar_url, is_verified)')
    .eq('visibility', 'public');
  if (type) q = q.eq('release_type', type);
  if (allowedRatings) q = q.in('content_rating', allowedRatings);

  const safeQuery = discoverSafeSearchTerm(query);
  if (safeQuery) {
    const artistMatches = await dbDiscoverArtists({ mode: 'search', query: safeQuery, limit: 50 });
    const artistIds = artistMatches.map(artist => artist.id).filter(Boolean);
    const filters = [`title.ilike.%${safeQuery}%`];
    if (artistIds.length) filters.push(`artist_id.in.(${artistIds.join(',')})`);
    q = q.or(filters.join(','));
  }

  q = sort === 'trending'
    ? q.order('total_plays', { ascending: false, nullsFirst: false }).order('release_date', { ascending: false, nullsFirst: false })
    : q.order('release_date', { ascending: false, nullsFirst: false });
  const { data, error } = await q.limit(limit);
  if (error) {
    console.error('[db] discoverReleases:', error.message);
    return [];
  }
  return data || [];
}

// ─── Collaboration helpers ─────────────────────────────────────────────────
// Role check: returns 'owner' | 'editor' | 'viewer' | null (no access)
async function dbGetCollabRole(playlistId, username) {
  const pl = await dbGetPlaylist(playlistId);
  if (!pl) return null;
  if (pl.owner === username) return 'owner';
  const { data, error } = await supabase
    .from('playlist_collaborators')
    .select('role')
    .eq('playlist_id', playlistId)
    .eq('username', username)
    .maybeSingle();
  if (error || !data) return null;
  return data.role; // 'editor' | 'viewer'
}

// Create an invite (pending). Idempotent — upserts on the (playlist, invitee) unique key.
async function dbInviteCollaborator(playlistId, invitedBy, invitee, role) {
  // Prevent inviting the owner
  const pl = await dbGetPlaylist(playlistId);
  if (!pl) throw new Error('Playlist not found.');
  if (pl.owner === invitee) throw new Error('Cannot invite the playlist owner as a collaborator.');
  // Upsert: if there's already a pending invite, update the role.
  const { data, error } = await supabase
    .from('playlist_invites')
    .upsert({ playlist_id: playlistId, invited_by: invitedBy, invitee, role },
             { onConflict: 'playlist_id,invitee' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Accept an invite: writes collaborator row, deletes invite row.
async function dbAcceptInvite(inviteId, invitee) {
  const { data: inv, error: invErr } = await supabase
    .from('playlist_invites')
    .select('*')
    .eq('id', inviteId)
    .eq('invitee', invitee)
    .maybeSingle();
  if (invErr || !inv) throw new Error('Invite not found or not yours.');
  // Upsert collaborator (handles re-accept of same playlist if somehow re-invited)
  const { error: collabErr } = await supabase
    .from('playlist_collaborators')
    .upsert({ playlist_id: inv.playlist_id, username: inv.invitee, role: inv.role },
             { onConflict: 'playlist_id,username' });
  if (collabErr) throw new Error(collabErr.message);
  await supabase.from('playlist_invites').delete().eq('id', inviteId);
  return { playlistId: inv.playlist_id, role: inv.role };
}

// Reject or cancel invite
async function dbDeclineInvite(inviteId, username) {
  // Allow both invitee (reject) and invited_by/owner (cancel)
  const { data: inv } = await supabase
    .from('playlist_invites')
    .select('*')
    .eq('id', inviteId)
    .maybeSingle();
  if (!inv) throw new Error('Invite not found.');
  if (inv.invitee !== username && inv.invited_by !== username) {
    throw new Error('Not authorised to cancel this invite.');
  }
  await supabase.from('playlist_invites').delete().eq('id', inviteId);
}

async function dbRemoveCollaborator(playlistId, owner, username) {
  const pl = await dbGetPlaylist(playlistId);
  if (!pl || pl.owner !== owner) throw new Error('Not the playlist owner.');
  await supabase.from('playlist_collaborators')
    .delete().eq('playlist_id', playlistId).eq('username', username);
}

async function dbUpdateCollaboratorRole(playlistId, owner, username, role) {
  const pl = await dbGetPlaylist(playlistId);
  if (!pl || pl.owner !== owner) throw new Error('Not the playlist owner.');
  const { error } = await supabase.from('playlist_collaborators')
    .update({ role })
    .eq('playlist_id', playlistId)
    .eq('username', username);
  if (error) throw new Error(error.message);
}

async function dbGetCollaborators(playlistId) {
  const { data, error } = await supabase
    .from('playlist_collaborators')
    .select('username, role')
    .eq('playlist_id', playlistId)
    .order('username', { ascending: true });
  if (error) { console.error('[db] getCollaborators:', error.message); return []; }
  return data || [];
}

async function dbGetPendingInvites(playlistId) {
  const { data, error } = await supabase
    .from('playlist_invites')
    .select('id, invitee, role, created_at')
    .eq('playlist_id', playlistId)
    .order('created_at', { ascending: true });
  if (error) { console.error('[db] getPendingInvites:', error.message); return []; }
  return data || [];
}

// ─── Playlist edit log (V2 depth feature) ──────────────────────────────────
// Durable, reversible log of track add/remove edits on a playlist — distinct
// from activity_feed, which is fire-and-forget and has no concept of "undo
// this exact operation." action ∈ 'add' | 'remove'. `snapshot` carries
// whatever's needed to reverse the action: for a 'remove' entry, the full
// track_data + original position of the row that was deleted, so undo can
// re-insert it; for an 'add' entry, just the rowId, since undoing an add is
// simply deleting that row. reverted_at is set once an entry has been
// undone, so it can't be undone twice and drops out of the "recent edits"
// list. Table: playlist_edit_log (playlist_id, actor, action, track_title,
// row_id, snapshot jsonb, created_at, reverted_at).
async function dbLogPlaylistEdit(playlistId, actor, action, { trackTitle, rowId, snapshot = null }) {
  const { data, error } = await supabase
    .from('playlist_edit_log')
    .insert({
      playlist_id: playlistId, actor, action,
      track_title: (trackTitle || 'Untitled').slice(0, 300),
      row_id: rowId, snapshot,
    })
    .select()
    .single();
  if (error) { console.error('[db] logPlaylistEdit:', error.message); return null; }
  return data;
}

async function dbGetPlaylistEditHistory(playlistId, { limit = 30 } = {}) {
  const { data, error } = await supabase
    .from('playlist_edit_log')
    .select('id, actor, action, track_title, row_id, reverted_at, created_at')
    .eq('playlist_id', playlistId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[db] getPlaylistEditHistory:', error.message); return []; }
  return data || [];
}

async function dbGetEditLogEntry(entryId) {
  const { data, error } = await supabase
    .from('playlist_edit_log')
    .select('*')
    .eq('id', entryId)
    .maybeSingle();
  if (error) { console.error('[db] getEditLogEntry:', error.message); return null; }
  return data;
}

async function dbMarkEditReverted(entryId) {
  await supabase.from('playlist_edit_log')
    .update({ reverted_at: new Date().toISOString() })
    .eq('id', entryId);
}

// Invites waiting for `username` to accept/reject — shown in their notification inbox.
async function dbGetMyPendingInvites(username) {
  const { data, error } = await supabase
    .from('playlist_invites')
    .select('id, playlist_id, invited_by, role, created_at, playlists_v2(name)')
    .eq('invitee', username)
    .order('created_at', { ascending: false });
  if (error) { console.error('[db] getMyPendingInvites:', error.message); return []; }
  return (data || []).map(r => ({
    id: r.id, playlistId: r.playlist_id,
    playlistName: r.playlists_v2?.name || '(deleted)',
    invitedBy: r.invited_by, role: r.role, createdAt: r.created_at,
  }));
}

// Playlists the user is a collaborator on (not owner — that's /mine)
async function dbGetSharedWithMe(username) {
  const { data, error } = await supabase
    .from('playlist_collaborators')
    .select('role, playlists_v2(id, name, description, is_public, track_count, owner, updated_at)')
    .eq('username', username);
  if (error) { console.error('[db] getSharedWithMe:', error.message); return []; }
  return (data || [])
    .filter(r => r.playlists_v2)
    .sort((a, b) => new Date(b.playlists_v2.updated_at || 0) - new Date(a.playlists_v2.updated_at || 0))
    .map(r => ({
      role: r.role,
      id: r.playlists_v2.id, name: r.playlists_v2.name,
      description: r.playlists_v2.description,
      isPublic: r.playlists_v2.is_public,
      trackCount: r.playlists_v2.track_count,
      owner: r.playlists_v2.owner,
      updatedAt: r.playlists_v2.updated_at,
    }));
}

// Unpaginated by design — account deletion needs every storage_path to clean
// up the bucket fully, not one page of dbGetCloudFiles' results. Selecting
// only storage_path (not '*') keeps this cheap even for large libraries.
async function dbGetAllCloudStoragePaths(username) {
  const { data, error } = await supabase
    .from('cloud_files')
    .select('storage_path')
    .eq('owner', username);
  if (error) { console.error('[db] getAllCloudStoragePaths:', error.message); return []; }
  return (data || []).map(r => r.storage_path).filter(Boolean);
}

async function dbDeleteAccount(username) {
  // Clean up Storage objects first — deleting the metadata rows without
  // this would orphan the actual audio files in the bucket forever.
  const paths = await dbGetAllCloudStoragePaths(username);
  if (paths.length) {
    const { error } = await supabase.storage.from(CLOUD_BUCKET).remove(paths);
    if (error) console.error('[db] deleteAccount storage cleanup:', error.message);
  }
  await supabase.from('cloud_files').delete().eq('owner', username);
  await supabase.from('sessions').delete().eq('username', username);
  await supabase.from('playlists').delete().eq('username', username);
  await supabase.from('accounts').delete().eq('username', username);
}

async function dbCreateSession(token, username, expiresAt) {
  const { error } = await supabase.from('sessions').insert({
    token, username, expires_at: new Date(expiresAt).toISOString()
  });
  if (error) throw new Error(error.message);
}

async function dbGetSession(token) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('token', token)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getSession:', error.message);
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await supabase.from('sessions').delete().eq('token', token);
    return null;
  }
  // Fetch is_admin/is_premium/email_verified_at/age_group from accounts
  // (cheap read, cached by Postgres for repeated calls). email_verified_at
  // and age_group were added for Part 8 (requireVerifiedEmail below) and
  // future age-gating middleware — same "resolve once here, every gate
  // reads off the session" shape as is_admin/is_premium already use.
  const { data: acct } = await supabase.from('accounts').select('is_admin, is_premium, email_verified_at, age_group').eq('username', data.username).maybeSingle();
  // Always return a normalized username — guards against any historical row that
  // somehow has trailing whitespace, mixed case, or stray characters drifting through.
  return {
    username:   normalizeUsername(data.username),
    expiresAt:  new Date(data.expires_at).getTime(),
    isAdmin:    !!(acct?.is_admin),
    isPremium:  !!(acct?.is_premium),
    emailVerified: !!(acct?.email_verified_at),
    ageGroup:   acct?.age_group || null,
  };
}

// ── Playback Filters (Part 3) ───────────────────────────────────────────────
// One row per account in playback_filter_settings (allow_clean/allow_pg/
// allow_adult, all true by default — see the table's own column defaults),
// which every content-serving surface (Charts, Discovery Track Finder,
// playlists, the stream route itself, and anything downstream of it like
// DJ BOOM's frontend-executed actions) is meant to respect per Part 3's
// "Everything should respect these settings." is_parent_enforced exists for
// Family Accounts flips on for a managed child account, at which point only
// the parent — not the child — can change these. The getter below repairs any
// drift from family_restrictions before returning effective settings.

// Returns { allowClean, allowParentalGuidance, allowAdult } for a username,
// creating nothing — a user who's never touched their settings simply gets
// the same all-true defaults the column defaults would give a fresh row.
async function dbGetPlaybackFilterSettings(username) {
  if (!username) return { allowClean: true, allowParentalGuidance: true, allowAdult: true };
  const { data, error } = await supabase
    .from('playback_filter_settings').select('*').eq('username', username).maybeSingle();
  if (error) { console.error('[db] getPlaybackFilterSettings:', error.message); return { allowClean: true, allowParentalGuidance: true, allowAdult: true }; }

  // Family restrictions are authoritative. Reading the effective playback
  // settings is also a repair point so an interrupted parent-dashboard write,
  // an older row, or a direct database update cannot leave the two tables out
  // of sync. This deliberately happens server-side; the child client never
  // gets a window in which it can submit looser values of its own.
  const restrictions = await dbGetEffectiveFamilyRestrictions(username);
  if (restrictions) {
    const enforced = playbackSettingsForMaximumRating(restrictions.max_content_rating);
    const hasDrift = !data ||
      data.allow_clean !== enforced.allowClean ||
      data.allow_parental_guidance !== enforced.allowParentalGuidance ||
      data.allow_adult !== enforced.allowAdult ||
      data.is_parent_enforced !== true;
    if (hasDrift) await syncChildPlaybackFilters(username, restrictions.max_content_rating);
    return { ...enforced, isParentEnforced: true };
  }

  // If a child leaves a family, do not leave the old parent lock stuck on the
  // account forever. Preserve the last allowed-rating choices but return
  // control of them to the account owner.
  if (data?.is_parent_enforced) {
    const { error: unlockError } = await supabase.from('playback_filter_settings')
      .update({ is_parent_enforced: false, updated_at: new Date().toISOString() })
      .eq('username', username);
    if (unlockError) console.error('[db] unlockPlaybackFilterSettings:', unlockError.message);
    data.is_parent_enforced = false;
  }

  if (!data) return { allowClean: true, allowParentalGuidance: true, allowAdult: true, isParentEnforced: false };
  return {
    allowClean: data.allow_clean !== false,
    allowParentalGuidance: data.allow_parental_guidance !== false,
    allowAdult: data.allow_adult !== false,
    isParentEnforced: !!data.is_parent_enforced,
  };
}

async function dbSetPlaybackFilterSettings(username, { allowClean, allowParentalGuidance, allowAdult }) {
  const { data, error } = await supabase.from('playback_filter_settings').upsert({
    username,
    allow_clean: allowClean !== false,
    allow_parental_guidance: allowParentalGuidance !== false,
    allow_adult: allowAdult !== false,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'username' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// Converts a settings object into the actual content_rating value list a
// Supabase .in('content_rating', [...]) filter needs. At least 'clean' is
// always included even if somehow all three were turned off client-side —
// an empty .in() array behaves inconsistently across the JS client (some
// versions treat it as "match nothing", others error), and silently showing
// zero results app-wide from a settings edge case is worse than the narrow
// inconsistency of always allowing Clean through.
function allowedRatingsFromSettings(settings) {
  const allowed = [];
  if (settings.allowClean !== false) allowed.push('clean');
  if (settings.allowParentalGuidance) allowed.push('parental_guidance');
  if (settings.allowAdult) allowed.push('adult');
  return allowed.length ? allowed : ['clean'];
}

// Single entry point every content-serving route uses to find out which
// ratings the CURRENT requester may see. Resolves the optional session from
// the request the same way requirePremium/requireAdmin do (works for
// logged-out visitors too — Charts/Discovery are intentionally
// unauthenticated-friendly, per their own route comments, so a visitor with
// no account just gets the all-true defaults rather than an error).
async function getAllowedRatingsForRequest(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = token ? await dbGetSession(token) : null;
  // A supplied-but-invalid token is not the same thing as a signed-out
  // visitor. Fail to the safest catalog view during expiry/race windows so
  // stale sessions cannot momentarily inherit anonymous all-rating access.
  if (token && !sess) return ['clean'];
  const settings = await dbGetPlaybackFilterSettings(sess?.username || null);
  return allowedRatingsFromSettings(settings);
}

// Companion check to getAllowedRatingsForRequest, for the specific-artist/
// specific-track/specific-genre blocks Part 6 also asks for
// (blocked_artist_ids/blocked_genres/blocked_track_ids on
// family_restrictions) — deliberately kept SEPARATE from the rating check
// rather than merged into allowedRatingsFromSettings, since rating is a
// simple set-membership test against a fixed 3-value enum while this needs
// the actual track row (for artist_id/id) and sometimes a join to
// artists.genre. Returns true if the track should be BLOCKED (named to
// read naturally at call sites: `if (await isTrackBlockedForRequest(...))`).
// Non-child requests and children with no restrictions row always resolve
// to false immediately — same fast-path philosophy as
// isFeatureDisabledForRequest above.
async function isTrackBlockedForRequest(req, track) {
  if (!track) return false;
  const restrictions = await getFamilyRestrictionsForRequest(req);
  if (!restrictions) return false;
  return await isTrackBlockedByRestrictions(track, restrictions);
}

async function isTrackVisibleForRequest(req, track) {
  if (!track || !track.is_published) return false;
  const allowedRatings = await getAllowedRatingsForRequest(req);
  if (!allowedRatings.includes(track.content_rating || 'clean')) return false;
  return !(await isTrackBlockedForRequest(req, track));
}

// Shared by isTrackBlockedForRequest and filterBlockedTracksForRequest so
// the two never resolve "which restrictions apply to this request" two
// different ways. Returns null for non-child requests / children with no
// restrictions row yet, same fast-path as dbGetFamilyRestrictions's own
// callers elsewhere.
async function getFamilyRestrictionsForRequest(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = token ? await dbGetSession(token) : null;
  if (!sess) return null;
  return await dbGetEffectiveFamilyRestrictions(sess.username);
}

// Pure check against an already-resolved restrictions row — split out from
// isTrackBlockedForRequest so the batch filter below can resolve
// restrictions ONCE per request and reuse this per-row, rather than
// re-fetching family_restrictions once per track in a list of 50.
async function isTrackBlockedByRestrictions(track, restrictions, cache = null) {
  if (!restrictions) return false;
  if (Array.isArray(restrictions.blocked_track_ids) && restrictions.blocked_track_ids.includes(track.id)) return true;
  if (track.artist_id && Array.isArray(restrictions.blocked_artist_ids) && restrictions.blocked_artist_ids.includes(track.artist_id)) return true;

  const genreCache = cache instanceof Map ? cache : cache?.genres;
  const adultArtistCache = cache?.adultArtists;

  if (restrictions.block_explicit_artists && track.artist_id) {
    let hasAdultCatalog;
    if (adultArtistCache?.has(track.artist_id)) {
      hasAdultCatalog = adultArtistCache.get(track.artist_id);
    } else {
      const { data: adultTrack } = await supabase.from('tracks')
        .select('id').eq('artist_id', track.artist_id).eq('is_published', true)
        .eq('content_rating', 'adult').limit(1).maybeSingle();
      hasAdultCatalog = !!adultTrack;
      adultArtistCache?.set(track.artist_id, hasAdultCatalog);
    }
    if (hasAdultCatalog) return true;
  }

  if (Array.isArray(restrictions.blocked_genres) && restrictions.blocked_genres.length && track.artist_id) {
    let genre;
    if (genreCache && genreCache.has(track.artist_id)) {
      genre = genreCache.get(track.artist_id);
    } else {
      const { data: artistRow } = await supabase.from('artists').select('genre').eq('id', track.artist_id).maybeSingle();
      genre = artistRow?.genre || null;
      if (genreCache) genreCache.set(track.artist_id, genre);
    }
    if (genre && restrictions.blocked_genres.includes(genre)) return true;
  }
  return false;
}

// Batch counterpart for list surfaces (Charts, Discover) — rows need an
// `id` and `artist_id` field, which every tracks-table row already carries.
// Non-child requests short-circuit to the input array unchanged (same
// "restrictions are additive, never assumed" philosophy as
// isFeatureDisabledForRequest), so this is a safe no-op wrapper to add
// around any existing list endpoint without behavior change for the
// overwhelming majority of requests.
async function filterBlockedTracksForRequest(req, rows) {
  const input = Array.isArray(rows) ? rows : [];
  if (!input.length) return input;
  const restrictions = await getFamilyRestrictionsForRequest(req);
  if (!restrictions) return input;

  const hasAnyBlockList = (restrictions.blocked_track_ids?.length || restrictions.blocked_artist_ids?.length || restrictions.blocked_genres?.length);
  if (!hasAnyBlockList && !restrictions.block_explicit_artists) return input;

  const blockCache = {
    genres: new Map(),       // artist_id -> genre
    adultArtists: new Map(), // artist_id -> has any published adult track
  };
  const kept = [];
  for (const row of input) {
    const blocked = await isTrackBlockedByRestrictions(row, restrictions, blockCache);
    if (!blocked) kept.push(row);
  }
  return kept;
}

// Relational playlists keep track payloads as JSON so they can also contain
// external providers. Only published FREQ ids have authoritative rating rows;
// batch-resolve those ids and remove blocked ones before returning the
// playlist. The stream route remains the final backstop for stale clients.
async function filterPlaylistTracksForRequest(req, rows) {
  const input = Array.isArray(rows) ? rows : [];
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const freqIds = [...new Set(input
    .map(row => row?.track_data)
    .filter(track => track?.platform === 'freq' && uuidRe.test(track.id || ''))
    .map(track => track.id))];
  if (!freqIds.length) return input;

  const allowedRatings = await getAllowedRatingsForRequest(req);
  const { data, error } = await supabase.from('tracks')
    .select('id, artist_id, content_rating')
    .in('id', freqIds)
    .eq('is_published', true);
  if (error) throw new Error(error.message);

  const restrictions = await getFamilyRestrictionsForRequest(req);
  const visibleIds = new Set();
  const allowed = new Set(allowedRatings);
  const blockCache = { genres: new Map(), adultArtists: new Map() };
  for (const track of data || []) {
    if (!allowed.has(track.content_rating || 'clean')) continue;
    if (await isTrackBlockedByRestrictions(track, restrictions, blockCache)) continue;
    visibleIds.add(track.id);
  }
  return input.filter(row => {
    const track = row?.track_data;
    if (track?.platform !== 'freq' || !uuidRe.test(track.id || '')) return true;
    return visibleIds.has(track.id);
  });
}

// ─── Family Accounts / Age-Gating (Phase 4, Parts 4-6) ─────────────────────
// family_restrictions is keyed 1:1 by username (one row per CHILD account,
// not per family) — see the table's own primary key. A row's mere existence
// means "this account is under parent-managed restrictions"; there's no
// separate is_child flag on accounts because family_members.role already
// carries that ('parent'/'child'), and a child's family_restrictions row is
// what the parent dashboard actually edits.

// Returns the family_restrictions row for a username, or null if the
// account isn't under any family's restrictions (either it's not a child,
// or a child account whose parent hasn't configured restrictions yet —
// treated as null either way since the caller's job is just "is this
// account restricted right now," not "should it be").
async function dbGetFamilyRestrictions(username) {
  if (!username) return null;
  const { data, error } = await supabase
    .from('family_restrictions').select('*').eq('username', username).maybeSingle();
  if (error) { console.error('[db] getFamilyRestrictions:', error.message); return null; }
  return data || null;
}

// True if this username is an ACTIVE child member of some family — the
// thing every "children cannot..." rule in Part 5 actually needs to check.
// Deliberately keyed off family_members.role/status rather than
// accounts.age_group: age_group is just a derived fact about a birthdate,
// but family membership is the real authorization boundary Part 4/5 draws
// ("Child accounts cannot change... Only parent can"). A teen or adult
// could theoretically be added as a family "child" member for parental
// oversight even though their own age_group says otherwise — the family
// relationship, not the raw age bracket, is what's enforced here.
async function dbIsActiveChildMember(username) {
  if (!username) return false;
  const { data, error } = await supabase
    .from('family_members').select('role, status').eq('username', username).eq('role', 'child').eq('status', 'active').maybeSingle();
  if (error) { console.error('[db] isActiveChildMember:', error.message); return false; }
  return !!data;
}

// A restriction row is effective only while the account is an active child
// member. Checking both tables prevents a stale family_restrictions row from
// disabling features after removal from a family.
async function dbGetEffectiveFamilyRestrictions(username) {
  if (!username) return null;
  const [isChildMember, restrictions, account] = await Promise.all([
    dbIsActiveChildMember(username),
    dbGetFamilyRestrictions(username),
    dbGetAccount(username),
  ]);
  if (isChildMember) return restrictions || { ...UNMANAGED_CHILD_DEFAULT_RESTRICTIONS, username };
  // A child account is safe from its first sign-in, even before a parent
  // redeems/approves a family invitation. This closes the old window where
  // an under-13 account had no family_restrictions row and therefore
  // inherited the adult "allow everything" playback defaults.
  if (account?.age_group === 'child') return { ...UNMANAGED_CHILD_DEFAULT_RESTRICTIONS, username };
  return null;
}

const UNMANAGED_CHILD_DEFAULT_RESTRICTIONS = Object.freeze({
  max_content_rating: 'clean',
  blocked_artist_ids: [], blocked_track_ids: [], blocked_genres: [],
  block_explicit_artists: true,
  disable_radio: true, disable_djboom: true, disable_discover: false,
  disable_social_feed: true, disable_following: false,
  disable_uploads: true, disable_artist_pages: true,
  disable_labs: true, disable_premium_purchases: true,
  daily_listening_limit_minutes: null,
  bedtime_start: null, bedtime_end: null,
  allowed_hours_start: null, allowed_hours_end: null,
  timezone: 'UTC',
});

function playbackSettingsForMaximumRating(rawMaximum) {
  const maximum = ['clean', 'parental_guidance', 'adult'].includes(rawMaximum)
    ? rawMaximum
    : 'clean';
  return {
    allowClean: true,
    allowParentalGuidance: maximum === 'parental_guidance' || maximum === 'adult',
    allowAdult: maximum === 'adult',
  };
}

// Pushes family_restrictions.max_content_rating down into
// playback_filter_settings for a child account, with is_parent_enforced
// locked on — this is the sync the Part 3 doc comment on
// dbGetPlaybackFilterSettings calls this whenever it detects drift, so
// playback_filter_settings — which content-serving routes actually read —
// converges immediately to the parent-configured maximum.
async function syncChildPlaybackFilters(username, maxContentRating) {
  const { allowClean, allowParentalGuidance, allowAdult } = playbackSettingsForMaximumRating(maxContentRating);
  const { error } = await supabase.from('playback_filter_settings').upsert({
    username,
    allow_clean: allowClean,
    allow_parental_guidance: allowParentalGuidance,
    allow_adult: allowAdult,
    is_parent_enforced: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'username' });
  if (error) throw new Error(error.message);
}

// Middleware: blocks the CURRENT session's account from self-modifying
// anything Part 5 reserves for a parent — content restrictions, birthdate,
// family membership, parent relationship. Birthdate is already immutable
// for everyone once set (see POST /api/account/birthdate) and content
// restrictions already check is_parent_enforced directly (see PATCH
// /api/playback-filters) — this middleware exists for the OTHER
// family-membership-shaped actions (leaving a family, changing an invite,
// etc.) where "is this account a locked-down child" is the whole check,
// with no other business logic to fold it into inline.
async function requireNotChild(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  // age_group is derived from the immutable birthdate and is the primary
  // age gate. Active family membership is also honored so a parent can keep
  // supervising a teen account without inventing a second account type.
  const membership = await dbGetFamilyMembership(sess.username);
  const isChild = sess.ageGroup === 'child' || membership?.role === 'child';
  if (isChild) {
    return res.status(403).json({ error: 'This action is managed by a parent or guardian and can\'t be done from a child account.', childAccountRestricted: true });
  }
  req._session = sess;
  next();
}

// Middleware factory: blocks a child account from a specific FEATURE per
// the disable_* columns on family_restrictions (Part 6 — "Disable Radio /
// Discover / Social Feed / Following / Uploads / Artist Pages / Labs /
// Premium purchases"). Non-child accounts, and child accounts with no
// family_restrictions row yet (parent hasn't configured anything),
// pass through untouched — a family_restrictions row only ever RESTRICTS,
// it never grants extra access, so its absence is just "nothing to
// enforce," not an error.
//
// featureKey must match one of the disable_* columns below, with the
// disable_ prefix stripped off (e.g. 'radio' checks disable_radio).
const FAMILY_FEATURE_COLUMNS = {
  radio: 'disable_radio',
  djboom: 'disable_djboom',
  discover: 'disable_discover',
  social_feed: 'disable_social_feed',
  following: 'disable_following',
  uploads: 'disable_uploads',
  artist_pages: 'disable_artist_pages',
  labs: 'disable_labs',
  premium_purchases: 'disable_premium_purchases',
};
function requireFeatureAllowed(featureKey, { allowAnonymous = false } = {}) {
  const column = FAMILY_FEATURE_COLUMNS[featureKey];
  if (!column) throw new Error(`requireFeatureAllowed: unknown featureKey "${featureKey}"`);
  return async function (req, res, next) {
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
    const sess = req._session || (token ? await dbGetSession(token) : null);
    if (!sess) {
      if (allowAnonymous && !token) return next();
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const restrictions = Object.prototype.hasOwnProperty.call(req, '_effectiveFamilyRestrictions')
      ? req._effectiveFamilyRestrictions
      : await dbGetEffectiveFamilyRestrictions(sess.username);
    req._effectiveFamilyRestrictions = restrictions;
    if (restrictions && restrictions[column]) {
      return res.status(403).json({
        error: 'This feature has been disabled by a parent or guardian on this account.',
        childAccountRestricted: true,
        feature: featureKey,
      });
    }
    // Live internet radio has no reliable per-song FREQ content_rating.
    // Treat it as unrated/adult for managed accounts instead of pretending
    // a station directory can guarantee Clean or PG programming.
    if (featureKey === 'radio' && restrictions && restrictions.max_content_rating !== 'adult') {
      return res.status(403).json({
        error: 'Live radio is unavailable under the current maximum content rating because live broadcasts are unrated.',
        childAccountRestricted: true,
        feature: featureKey,
      });
    }
    req._session = sess;
    next();
  };
}

// Non-middleware counterpart to requireFeatureAllowed, for routes like
// Discover that stay open to logged-out visitors (so a hard 401/403
// middleware would wrongly block anonymous browsing). Resolves whatever
// session is present the same way getAllowedRatingsForRequest does — no
// session just means "nothing to restrict," same reasoning as
// requireFeatureAllowed's own fallthrough for a child with no
// family_restrictions row yet.
async function isFeatureDisabledForRequest(req, featureKey) {
  const column = FAMILY_FEATURE_COLUMNS[featureKey];
  if (!column) return false;
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = req._session || (token ? await dbGetSession(token) : null);
  if (!sess) return !!token;
  req._session = sess;
  const restrictions = Object.prototype.hasOwnProperty.call(req, '_effectiveFamilyRestrictions')
    ? req._effectiveFamilyRestrictions
    : await dbGetEffectiveFamilyRestrictions(sess.username);
  req._effectiveFamilyRestrictions = restrictions;
  return !!(restrictions && restrictions[column]);
}

async function isFeatureDisabledForUsername(username, featureKey) {
  const column = FAMILY_FEATURE_COLUMNS[featureKey];
  if (!column || !username) return false;
  const restrictions = await dbGetEffectiveFamilyRestrictions(username);
  return !!restrictions?.[column];
}

// Safe, client-facing summary used by the existing auth restore responses.
// It intentionally exposes only capability booleans, never family ids,
// parent identity, invite data, blocked-item lists, or other private rows.
async function dbGetFamilyGateSummary(username) {
  if (!username) return { isChildAccount: false, parentManaged: false, maxContentRating: null, disabledFeatures: {} };
  const [isChildMember, account] = await Promise.all([
    dbIsActiveChildMember(username),
    dbGetAccount(username),
  ]);
  const isChildAccount = isChildMember || account?.age_group === 'child';
  const restrictions = isChildAccount ? await dbGetEffectiveFamilyRestrictions(username) : null;
  const disabledFeatures = {};
  for (const [feature, column] of Object.entries(FAMILY_FEATURE_COLUMNS)) {
    disabledFeatures[feature] = !!restrictions?.[column];
  }
  return {
    isChildAccount,
    parentManaged: isChildMember,
    maxContentRating: restrictions?.max_content_rating || null,
    disabledFeatures,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
//  FAMILY ACCOUNTS — CRUD (Phase 4, Parts 4-5)
// ═══════════════════════════════════════════════════════════════════════════
// Everything above this point (dbGetFamilyRestrictions, requireFeatureAllowed,
// syncChildPlaybackFilters, etc.) is the ENFORCEMENT layer and already reads
// these tables. This block is what actually WRITES families/family_members/
// family_invites/family_restrictions — until now nothing populated them.
//
// One adult account can be the parent of at most one family in this first
// pass (mirrors the spec's "Adult creates: Family" — singular). A family's
// membership roster lives in family_members; families itself just holds the
// name + owning parent_username.

function generateFamilyInviteCode() {
  // 8 chars, uppercase alphanumeric minus visually-ambiguous chars (0/O, 1/I/L)
  // — this gets typed by hand on a second device, so legibility matters more
  // than keyspace size. ~30 bits of entropy, plenty for a 7-day-expiring,
  // single-use, rate-limited code.
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

async function dbGetFamilyByParent(parentUsername) {
  const { data, error } = await supabase.from('families').select('*').eq('parent_username', parentUsername).maybeSingle();
  if (error) { console.error('[db] getFamilyByParent:', error.message); return null; }
  return data || null;
}

async function dbGetFamilyMembership(username) {
  const { data, error } = await supabase.from('family_members').select('*').eq('username', username).in('status', ['pending', 'active']).maybeSingle();
  if (error) { console.error('[db] getFamilyMembership:', error.message); return null; }
  return data || null;
}

// POST /api/family/create — an adult, non-child account starts a family and
// becomes its parent. requireNotChild covers "child accounts cannot..." for
// family membership itself; the age_group === 'adult' check below is the
// stronger rule specific to THIS route — a teen shouldn't be able to become
// a parent, even though requireNotChild alone wouldn't stop a non-child teen.
app.post('/api/family/create', requireNotChild, async (req, res) => {
  const sess = req._session;
  const { name } = req.body || {};
  try {
    const acct = await dbGetAccount(sess.username);
    if (acct?.age_group !== 'adult') {
      return res.status(403).json({ error: 'Only adult accounts can create a family.' });
    }
    const existing = await dbGetFamilyByParent(sess.username);
    if (existing) return res.status(409).json({ error: 'You already have a family.', familyId: existing.id });

    const { data: family, error } = await supabase.from('families').insert({
      parent_username: sess.username,
      name: (name || '').trim().slice(0, 60) || 'My Family',
    }).select().single();
    if (error) throw new Error(error.message);

    const { error: memberErr } = await supabase.from('family_members').insert({
      family_id: family.id, username: sess.username, role: 'parent', status: 'active',
    });
    if (memberErr) throw new Error(memberErr.message);

    return res.status(201).json({ family });
  } catch (err) {
    console.error('[family/create]', err);
    return res.status(500).json({ error: 'Could not create family.' });
  }
});

// POST /api/family/invite — parent generates a fresh invite code for their
// family. Any previously pending code is left alone (a parent might want
// several outstanding invites for several kids) rather than revoked, unlike
// account-email-verification tokens which are single-slot per account.
app.post('/api/family/invite', requireNotChild, async (req, res) => {
  const sess = req._session;
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'Create a family before inviting a child.' });

    // Small retry loop for the astronomically-unlikely invite_code collision
    // (unique constraint on family_invites.invite_code) rather than trusting
    // one shot — cheap insurance, this route isn't hot-path enough to matter.
    let invite, lastErr;
    for (let attempt = 0; attempt < 5 && !invite; attempt++) {
      const code = generateFamilyInviteCode();
      const { data, error } = await supabase.from('family_invites').insert({
        family_id: family.id, invite_code: code, created_by: sess.username,
      }).select().single();
      if (!error) { invite = data; break; }
      lastErr = error;
    }
    if (!invite) throw new Error(lastErr?.message || 'Could not generate a unique invite code.');

    return res.status(201).json({
      inviteCode: invite.invite_code,
      expiresAt: invite.expires_at,
    });
  } catch (err) {
    console.error('[family/invite]', err);
    return res.status(500).json({ error: 'Could not create invite.' });
  }
});

// POST /api/family/join  { inviteCode }
// The CHILD's account redeems a parent-generated code. requireNotChild is
// deliberately NOT used here — a brand-new child account joining a family
// for the first time isn't a family member yet, so there's nothing for that
// middleware to check; the real gates are all inline below (already in a
// family? invite valid/unexpired/unused?).
app.post('/api/family/join', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });

  const inviteCode = String(req.body?.inviteCode || '').trim().toUpperCase();
  if (!inviteCode) return res.status(400).json({ error: 'Invite code is required.' });

  try {
    const alreadyIn = await dbGetFamilyMembership(sess.username);
    if (alreadyIn) return res.status(409).json({ error: 'This account already belongs to a family.' });

    const { data: invite, error: inviteErr } = await supabase
      .from('family_invites').select('*').eq('invite_code', inviteCode).maybeSingle();
    if (inviteErr) throw new Error(inviteErr.message);
    if (!invite) return res.status(404).json({ error: 'Invalid invite code.' });
    if (invite.status !== 'pending') return res.status(410).json({ error: 'This invite has already been used or is no longer valid.' });
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await supabase.from('family_invites').update({ status: 'expired' }).eq('id', invite.id);
      return res.status(410).json({ error: 'This invite has expired. Ask for a new code.' });
    }

    // A parent shouldn't be able to redeem their own (or anyone else's
    // parent-role) invite into a second family_members row for themselves —
    // this route is specifically how a CHILD account joins.
    if (invite.created_by === sess.username) {
      return res.status(400).json({ error: "You can't join a family using your own invite code." });
    }

    // Joining submits a request; it does not silently create an active
    // parent/child relationship. The parent must approve it from Family
    // Controls. The migration's redeem_family_invite() function performs
    // the invite lock + membership insert + invite redemption atomically,
    // preventing two accounts from racing the same single-use code.
    const { data: joinedFamilyId, error: redeemErr } = await supabase.rpc('redeem_family_invite', {
      p_invite_code: inviteCode,
      p_username: sess.username,
    });
    if (redeemErr) throw new Error(redeemErr.message);

    // Age-derived child defaults already keep the account Clean-only while
    // approval is pending; this makes the playback row explicit as well.
    if (sess.ageGroup === 'child') await syncChildPlaybackFilters(sess.username, 'clean');

    return res.status(202).json({
      joined: false,
      pendingApproval: true,
      familyId: Array.isArray(joinedFamilyId) ? joinedFamilyId[0] : joinedFamilyId,
    });
  } catch (err) {
    console.error('[family/join]', err);
    return res.status(500).json({ error: 'Could not join family.' });
  }
});

// GET /api/family — parent dashboard: family info, member roster, and each
// active child's restrictions + today's listening time. requireNotChild
// blocks a child from pulling this (Part 5 — restrictions are parent-only
// to VIEW as well as edit, since the dashboard reveals other children's
// data too, not just the caller's own).
app.get('/api/family', requireNotChild, async (req, res) => {
  const sess = req._session;
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.json({ family: null, children: [] });

    const { data: members, error: membersErr } = await supabase
      .from('family_members').select('*').eq('family_id', family.id)
      .in('status', ['pending', 'active']).neq('username', sess.username);
    if (membersErr) throw new Error(membersErr.message);

    const childUsernames = (members || []).map(m => m.username);
    const [restrictionsRows, accountsRows] = await Promise.all([
      childUsernames.length
        ? supabase.from('family_restrictions').select('*').in('username', childUsernames).then(r => r.data || [])
        : [],
      childUsernames.length
        ? Promise.all(childUsernames.map(u => dbGetAccount(u)))
        : [],
    ]);
    const restrictionsByUser = new Map(restrictionsRows.map(r => [r.username, r]));
    const accountByUser = new Map(accountsRows.filter(Boolean).map(a => [a.username, a]));

    const activeMembers = (members || []).filter(m => m.status === 'active');
    const relevantDates = [...new Set(activeMembers.map(m =>
      dateKeyInTimeZone(new Date(), restrictionsByUser.get(m.username)?.timezone || 'UTC')
    ))];
    const { data: listeningRows } = activeMembers.length
      ? await supabase.from('family_listening_time').select('*')
          .in('username', activeMembers.map(m => m.username)).in('listen_date', relevantDates)
      : { data: [] };
    const listeningByUser = new Map((listeningRows || []).map(r => [`${r.username}:${r.listen_date}`, r]));

    const children = (members || []).map(m => {
      const acct = accountByUser.get(m.username);
      const restrictions = restrictionsByUser.get(m.username) || null;
      const listenDate = dateKeyInTimeZone(new Date(), restrictions?.timezone || 'UTC');
      const listening = listeningByUser.get(`${m.username}:${listenDate}`) || null;
      return {
        username: m.username,
        displayName: acct?.display_name || m.username,
        ageGroup: acct?.age_group || null,
        joinedAt: m.joined_at,
        status: m.status,
        restrictions,
        listeningMinutesToday: listening ? Math.round(listening.seconds_listened / 60) : 0,
      };
    });

    return res.json({
      family,
      children: children.filter(c => c.status === 'active'),
      pendingChildren: children.filter(c => c.status === 'pending'),
    });
  } catch (err) {
    console.error('[family get]', err);
    return res.status(500).json({ error: 'Could not load family.' });
  }
});

// Parent approval is a separate, explicit step after a child redeems an
// invite code. This prevents possession of a code alone from immediately
// establishing the parent relationship.
app.post('/api/family/child/:username/approve', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });
    const { data: membership, error: memberErr } = await supabase.from('family_members')
      .select('*').eq('family_id', family.id).eq('username', childUsername)
      .eq('role', 'child').eq('status', 'pending').maybeSingle();
    if (memberErr) throw new Error(memberErr.message);
    if (!membership) return res.status(404).json({ error: 'No pending child request was found.' });

    const { error: activateErr } = await supabase.from('family_members').update({
      status: 'active', approved_at: new Date().toISOString(), approved_by: sess.username,
    }).eq('id', membership.id).eq('status', 'pending');
    if (activateErr) throw new Error(activateErr.message);

    const { error: restrictionErr } = await supabase.from('family_restrictions').upsert({
      username: childUsername,
      family_id: family.id,
      max_content_rating: 'clean',
      block_explicit_artists: true,
      disable_radio: true,
      disable_djboom: true,
      disable_uploads: true,
      disable_artist_pages: true,
      disable_labs: true,
      disable_premium_purchases: true,
      timezone: 'UTC',
      updated_by: sess.username,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'username' });
    if (restrictionErr) throw new Error(restrictionErr.message);
    await syncChildPlaybackFilters(childUsername, 'clean');
    return res.json({ approved: true, username: childUsername });
  } catch (err) {
    console.error('[family child approve]', err);
    return res.status(500).json({ error: 'Could not approve this child.' });
  }
});

app.post('/api/family/child/:username/reject', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });
    const { data: membership, error: memberErr } = await supabase.from('family_members')
      .select('id').eq('family_id', family.id).eq('username', childUsername)
      .eq('role', 'child').eq('status', 'pending').maybeSingle();
    if (memberErr) throw new Error(memberErr.message);
    if (!membership) return res.status(404).json({ error: 'No pending child request was found.' });
    const { error } = await supabase.from('family_members').update({
      status: 'rejected', removed_at: new Date().toISOString(),
    }).eq('id', membership.id);
    if (error) throw new Error(error.message);
    return res.json({ rejected: true, username: childUsername });
  } catch (err) {
    console.error('[family child reject]', err);
    return res.status(500).json({ error: 'Could not reject this request.' });
  }
});

// Fields a parent is allowed to edit on family_restrictions. Whitelisted
// explicitly rather than spreading req.body — username/family_id/updated_at
// must never come from client input.
const FAMILY_RESTRICTION_EDITABLE_FIELDS = [
  'max_content_rating', 'blocked_artist_ids', 'blocked_genres', 'blocked_track_ids',
  'block_explicit_artists',
  'disable_radio', 'disable_djboom', 'disable_discover', 'disable_social_feed', 'disable_following',
  'disable_uploads', 'disable_artist_pages', 'disable_labs', 'disable_premium_purchases',
  'daily_listening_limit_minutes', 'bedtime_start', 'bedtime_end',
  'allowed_hours_start', 'allowed_hours_end', 'timezone',
];

function sanitizeFamilyIdList(value, fieldName) {
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array.`);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ids = [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))];
  if (ids.length > 200 || ids.some(id => !uuid.test(id))) {
    throw new Error(`${fieldName} must contain at most 200 valid IDs.`);
  }
  return ids;
}

function sanitizeFamilyGenreList(value) {
  if (!Array.isArray(value)) throw new Error('blocked_genres must be an array.');
  const genres = [...new Set(value.map(v => String(v || '').trim().slice(0, 60)).filter(Boolean))];
  if (genres.length > 100) throw new Error('blocked_genres must contain at most 100 genres.');
  return genres;
}

function isValidIanaTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format(); return true; }
  catch (_) { return false; }
}

// PATCH /api/family/child/:username/restrictions — the route
// dbGetPlaybackFilterSettings's own doc comment already pointed to. Parent-
// only (requireNotChild), and further scoped to children of THIS parent's
// family so one parent can't edit a stranger's kid by guessing a username.
app.patch('/api/family/child/:username/restrictions', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });

    const { data: membership, error: memErr } = await supabase
      .from('family_members').select('*').eq('family_id', family.id).eq('username', childUsername).eq('role', 'child').eq('status', 'active').maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!membership) return res.status(404).json({ error: 'No child with that username in your family.' });

    const patch = {};
    for (const field of FAMILY_RESTRICTION_EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) patch[field] = req.body[field];
    }
    if (patch.max_content_rating && !['clean', 'parental_guidance', 'adult'].includes(patch.max_content_rating)) {
      return res.status(400).json({ error: 'Invalid max_content_rating.' });
    }
    try {
      if (Object.prototype.hasOwnProperty.call(patch, 'blocked_artist_ids')) {
        patch.blocked_artist_ids = sanitizeFamilyIdList(patch.blocked_artist_ids, 'blocked_artist_ids');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'blocked_track_ids')) {
        patch.blocked_track_ids = sanitizeFamilyIdList(patch.blocked_track_ids, 'blocked_track_ids');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'blocked_genres')) {
        patch.blocked_genres = sanitizeFamilyGenreList(patch.blocked_genres);
      }
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }
    const booleanFields = FAMILY_RESTRICTION_EDITABLE_FIELDS.filter(f => f.startsWith('disable_') || f === 'block_explicit_artists');
    for (const field of booleanFields) {
      if (Object.prototype.hasOwnProperty.call(patch, field) && typeof patch[field] !== 'boolean') {
        return res.status(400).json({ error: `${field} must be true or false.` });
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'daily_listening_limit_minutes')) {
      if (patch.daily_listening_limit_minutes === null || patch.daily_listening_limit_minutes === '') {
        patch.daily_listening_limit_minutes = null;
      } else {
        const minutes = Number(patch.daily_listening_limit_minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
          return res.status(400).json({ error: 'daily_listening_limit_minutes must be between 1 and 1440.' });
        }
        patch.daily_listening_limit_minutes = minutes;
      }
    }
    for (const field of ['bedtime_start', 'bedtime_end', 'allowed_hours_start', 'allowed_hours_end']) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      if (patch[field] === '' || patch[field] === null) patch[field] = null;
      else if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(patch[field]))) {
        return res.status(400).json({ error: `${field} must be a valid 24-hour time.` });
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'timezone')) {
      if (!isValidIanaTimeZone(patch.timezone)) return res.status(400).json({ error: 'timezone must be a valid IANA time zone.' });
      patch.timezone = patch.timezone.trim();
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    patch.updated_by = sess.username;
    patch.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase.from('family_restrictions')
      .update(patch).eq('username', childUsername).select().single();
    if (error) throw new Error(error.message);

    // Keep playback_filter_settings in lockstep the moment max_content_rating
    // changes — dbGetPlaybackFilterSettings would self-heal this on next
    // read anyway (drift-repair), but syncing here means the child's very
    // next request already reflects the new limit instead of one stale read.
    if (Object.prototype.hasOwnProperty.call(patch, 'max_content_rating')) {
      await syncChildPlaybackFilters(childUsername, updated.max_content_rating);
    }

    return res.json({ restrictions: updated });
  } catch (err) {
    console.error('[family restrictions patch]', err);
    return res.status(500).json({ error: 'Could not update restrictions.' });
  }
});

// GET /api/family/child/:username/history?limit=&before=
// Parent-facing "Playback History" from the spec — raw track_plays rows for
// this child, most recent first, joined against tracks for a title/artist
// to show (a play row with no matching track — deleted/unpublished since —
// still appears, just with a fallback label, since a parent reviewing
// history shouldn't have entries silently vanish underneath them).
// Cursor-paginated via `before` (an ISO timestamp) rather than offset, same
// reasoning as everywhere else in this codebase that paginates played_at-
// ordered rows: stable under concurrent inserts, no page-drift.
const FAMILY_HISTORY_MAX_LIMIT = 100;
app.get('/api/family/child/:username/history', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), FAMILY_HISTORY_MAX_LIMIT);
  const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });

    const { data: membership, error: memErr } = await supabase
      .from('family_members').select('*').eq('family_id', family.id).eq('username', childUsername).eq('role', 'child').eq('status', 'active').maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!membership) return res.status(404).json({ error: 'No child with that username in your family.' });

    let query = supabase
      .from('track_plays')
      .select('id, track_id, played_at, source, completed, tracks(title, artist_name, cover_url, content_rating)')
      .eq('username', childUsername)
      .order('played_at', { ascending: false })
      .limit(limit);
    if (before) query = query.lt('played_at', before);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return res.json({
      plays: (data || []).map(p => ({
        id: p.id,
        playedAt: p.played_at,
        source: p.source,
        completed: p.completed,
        // tracks is null for a play whose track row no longer exists
        // (unpublished/deleted since) — surfaced honestly rather than
        // dropped, per this route's header comment.
        title: p.tracks?.title || 'Unknown track',
        artistName: p.tracks?.artist_name || null,
        coverUrl: p.tracks?.cover_url || null,
        contentRating: p.tracks?.content_rating || null,
      })),
      hasMore: (data || []).length === limit,
    });
  } catch (err) {
    console.error('[family child history]', err);
    return res.status(500).json({ error: 'Could not load playback history.' });
  }
});

// GET /api/family/child/:username/screen-time?days=
// Parent-facing "Screen Time" from the spec — daily listening minutes for
// the trailing N days from family_listening_time (reserved when playback
// access is granted), zero-filled for any day with no listening time
// rather than one with silent gaps.
app.get('/api/family/child/:username/screen-time', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });

    const { data: membership, error: memErr } = await supabase
      .from('family_members').select('*').eq('family_id', family.id).eq('username', childUsername).eq('role', 'child').eq('status', 'active').maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!membership) return res.status(404).json({ error: 'No child with that username in your family.' });

    const childRestrictions = await dbGetFamilyRestrictions(childUsername);
    const childToday = dateKeyInTimeZone(new Date(), childRestrictions?.timezone || 'UTC');
    const since = new Date(`${childToday}T12:00:00Z`);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const sinceStr = since.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('family_listening_time').select('listen_date, seconds_listened')
      .eq('username', childUsername).gte('listen_date', sinceStr)
      .order('listen_date', { ascending: true });
    if (error) throw new Error(error.message);

    const byDate = new Map((data || []).map(r => [r.listen_date, r.seconds_listened]));
    const daysOut = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(`${childToday}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      daysOut.push({ date: dateStr, minutes: Math.round((byDate.get(dateStr) || 0) / 60) });
    }
    const totalMinutes = daysOut.reduce((sum, d) => sum + d.minutes, 0);

    return res.json({ days: daysOut, totalMinutes, averageMinutesPerDay: Math.round(totalMinutes / days) });
  } catch (err) {
    console.error('[family child screen-time]', err);
    return res.status(500).json({ error: 'Could not load screen time.' });
  }
});

// POST /api/family/child/:username/remove — parent removes a child from the
// family. Sets family_members.status='removed' (soft, keeps history) rather
// than deleting the row. Deliberately does NOT delete family_restrictions —
// dbGetEffectiveFamilyRestrictions already treats a restrictions row as
// inert once dbIsActiveChildMember returns false, and
// dbGetPlaybackFilterSettings's unlock-on-leave path hands playback control
// back to the (former) child automatically on their next read.
app.post('/api/family/child/:username/remove', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });

    const { data: membership, error: memErr } = await supabase
      .from('family_members').select('*').eq('family_id', family.id).eq('username', childUsername).eq('role', 'child').eq('status', 'active').maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!membership) return res.status(404).json({ error: 'No child with that username in your family.' });

    const { error } = await supabase.from('family_members').update({
      status: 'removed', removed_at: new Date().toISOString(),
    }).eq('id', membership.id);
    if (error) throw new Error(error.message);

    return res.json({ removed: true, username: childUsername });
  } catch (err) {
    console.error('[family child remove]', err);
    return res.status(500).json({ error: 'Could not remove child from family.' });
  }
});

// GET /api/family/child/:username/devices — parent-facing device list, the
// read half of the DELETE below. Rows are populated by the listening
// heartbeat's device upsert —
// so a device only appears here once it's actually sent at least one
// heartbeat, which in practice means "played some audio while logged in,"
// a reasonable bar for "this is a real device in use."
app.get('/api/family/child/:username/devices', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });

    const { data: membership, error: memErr } = await supabase
      .from('family_members').select('*').eq('family_id', family.id).eq('username', childUsername).eq('role', 'child').eq('status', 'active').maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!membership) return res.status(404).json({ error: 'No child with that username in your family.' });

    const { data: devices, error } = await supabase
      .from('family_child_devices').select('id, device_label, first_seen_at, last_seen_at').eq('username', childUsername).order('last_seen_at', { ascending: false });
    if (error) throw new Error(error.message);

    return res.json({ devices: devices || [] });
  } catch (err) {
    console.error('[family child devices list]', err);
    return res.status(500).json({ error: 'Could not load devices.' });
  }
});

// DELETE /api/family/child/:username/devices/:deviceId — parent-facing
// "Remove Device" from the spec. family_child_devices rows are populated by
// POST /api/family/listening-heartbeat's device upsert (see that route) —
// this route only ever deletes, and also invalidates the underlying
// session so the removal actually logs the device out rather than just
// clearing a label from a list.
app.delete('/api/family/child/:username/devices/:deviceId', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });

    const { data: membership, error: memErr } = await supabase
      .from('family_members').select('*').eq('family_id', family.id).eq('username', childUsername).eq('role', 'child').eq('status', 'active').maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!membership) return res.status(404).json({ error: 'No child with that username in your family.' });

    const { data: device, error: devErr } = await supabase
      .from('family_child_devices').select('*').eq('id', req.params.deviceId).eq('username', childUsername).maybeSingle();
    if (devErr) throw new Error(devErr.message);
    if (!device) return res.status(404).json({ error: 'Device not found.' });

    if (device.session_token_hash) {
      // Device rows retain only a one-way hash of the session token. Resolve
      // the matching child session in memory, then delete the real token
      // from sessions without ever returning or storing it in the device UI.
      const { data: childSessions, error: sessionErr } = await supabase.from('sessions')
        .select('token').eq('username', childUsername);
      if (sessionErr) throw new Error(sessionErr.message);
      const matching = (childSessions || []).find(row =>
        crypto.createHash('sha256').update(String(row.token || '')).digest('hex') === device.session_token_hash
      );
      if (matching?.token) await supabase.from('sessions').delete().eq('token', matching.token);
    }
    const { error } = await supabase.from('family_child_devices').delete().eq('id', device.id);
    if (error) throw new Error(error.message);

    return res.json({ removed: true });
  } catch (err) {
    console.error('[family device remove]', err);
    return res.status(500).json({ error: 'Could not remove device.' });
  }
});

// POST /api/family/child/:username/signout — parent-facing "Sign Out Child."
// Invalidates ALL of the child's sessions (every device at once), distinct
// from the single-device DELETE .../devices/:deviceId above. Also clears
// their family_child_devices rows so the dashboard doesn't show stale
// now-signed-out devices as still active.
app.post('/api/family/child/:username/signout', requireNotChild, async (req, res) => {
  const sess = req._session;
  const childUsername = normalizeUsername(req.params.username);
  try {
    const family = await dbGetFamilyByParent(sess.username);
    if (!family) return res.status(404).json({ error: 'You do not have a family.' });

    const { data: membership, error: memErr } = await supabase
      .from('family_members').select('*').eq('family_id', family.id).eq('username', childUsername).eq('role', 'child').eq('status', 'active').maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!membership) return res.status(404).json({ error: 'No child with that username in your family.' });

    await supabase.from('sessions').delete().eq('username', childUsername);
    await supabase.from('family_child_devices').delete().eq('username', childUsername);

    return res.json({ signedOut: true, username: childUsername });
  } catch (err) {
    console.error('[family child signout]', err);
    return res.status(500).json({ error: 'Could not sign out child.' });
  }
});

// Checks a child's family_restrictions against "right now" — daily minutes
// used so far today, plus bedtime window — and returns whether playback
// should be allowed to continue. Pure function of (restrictions,
// secondsToday, now) so it's cheap to call on every heartbeat without
// re-deriving anything from the DB beyond what the caller already fetched.
function zonedClockParts(now, timeZone) {
  const zone = isValidIanaTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    timeZone: zone,
  };
}

function dateKeyInTimeZone(now, timeZone) {
  return zonedClockParts(now, timeZone).dateKey;
}

function timeFallsWithinWindow(nowStr, start, end) {
  if (!start || !end) return false;
  const normalizedStart = String(start).padEnd(8, ':00').slice(0, 8);
  const normalizedEnd = String(end).padEnd(8, ':00').slice(0, 8);
  return normalizedStart <= normalizedEnd
    ? (nowStr >= normalizedStart && nowStr < normalizedEnd)
    : (nowStr >= normalizedStart || nowStr < normalizedEnd);
}

function evaluateListeningAllowed(restrictions, secondsListenedToday, now) {
  if (!restrictions) return { allowed: true };

  if (restrictions.daily_listening_limit_minutes) {
    const usedMinutes = secondsListenedToday / 60;
    if (usedMinutes >= restrictions.daily_listening_limit_minutes) {
      return { allowed: false, reason: 'daily_limit', message: "Today's listening time limit has been reached." };
    }
  }

  // bedtime_start/bedtime_end are TIME columns (HH:MM:SS strings from
  // Supabase) compared against the server's local wall-clock time. A
  // bedtime window that WRAPS midnight (e.g. 21:00 -> 07:00) is the normal
  // case for this feature, so the "start > end" branch below is expected,
  // not an edge case — a same-day window (e.g. 13:00 -> 14:00 "quiet hour")
  // still works via the simpler branch.
  const clock = zonedClockParts(now, restrictions.timezone || 'UTC');
  if (restrictions.bedtime_start && restrictions.bedtime_end) {
    if (timeFallsWithinWindow(clock.time, restrictions.bedtime_start, restrictions.bedtime_end)) {
      return { allowed: false, reason: 'bedtime', message: 'This account is in its bedtime hours right now.' };
    }
  }

  if (restrictions.allowed_hours_start && restrictions.allowed_hours_end &&
      !timeFallsWithinWindow(clock.time, restrictions.allowed_hours_start, restrictions.allowed_hours_end)) {
    return { allowed: false, reason: 'outside_allowed_hours', message: 'Listening is not available during these hours.' };
  }

  return {
    allowed: true,
    secondsListenedToday,
    remainingSeconds: restrictions.daily_listening_limit_minutes
      ? Math.max(0, (restrictions.daily_listening_limit_minutes * 60) - secondsListenedToday)
      : null,
  };
}

async function getListeningAllowanceForRequest(req, { reserveSeconds = 0 } = {}) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = token ? await dbGetSession(token) : null;
  if (!sess) return { allowed: true, sess: null, restrictions: null };
  const restrictions = await dbGetEffectiveFamilyRestrictions(sess.username);
  if (!restrictions) return { allowed: true, sess, restrictions: null };
  const now = new Date();
  const listenDate = dateKeyInTimeZone(now, restrictions.timezone || 'UTC');
  const { data: usage, error } = await supabase.from('family_listening_time')
    .select('seconds_listened').eq('username', sess.username).eq('listen_date', listenDate).maybeSingle();
  if (error) throw new Error(error.message);
  const usedSeconds = usage?.seconds_listened || 0;
  const evaluation = evaluateListeningAllowed(restrictions, usedSeconds, now);
  if (!evaluation.allowed || reserveSeconds <= 0) return { ...evaluation, sess, restrictions };

  // A restricted playback URL is a short server-authorized lease. Reserve
  // its time atomically before minting the URL so disabling the client-side
  // heartbeat cannot bypass daily limits or screen-time accounting.
  const requested = Math.max(1, Math.min(Math.floor(reserveSeconds), 60));
  const leasedSeconds = evaluation.remainingSeconds == null
    ? requested
    : Math.min(requested, Math.floor(evaluation.remainingSeconds));
  if (leasedSeconds <= 0) {
    return { allowed: false, reason: 'daily_limit', message: "Today's listening time limit has been reached.", sess, restrictions };
  }
  const { data: newTotal, error: reserveErr } = await supabase.rpc('reserve_family_listening_seconds', {
    p_username: sess.username,
    p_listen_date: listenDate,
    p_seconds: leasedSeconds,
  });
  if (reserveErr) throw new Error(reserveErr.message);
  return {
    ...evaluation,
    secondsListenedToday: Number(newTotal) || (usedSeconds + leasedSeconds),
    streamLeaseSeconds: leasedSeconds,
    sess,
    restrictions,
  };
}

// POST /api/family/listening-heartbeat  { elapsedSeconds, deviceLabel? }
// Called periodically by the frontend player WHILE a child account has
// audio actively playing (not on every /api/plays call — this is about
// wall-clock listening time for Part 6's daily limit, not play-count).
// Listening seconds are reserved server-side when a short-lived media URL
// is issued. This heartbeat is advisory: it refreshes device presence and
// tells the player to stop if a schedule/limit changed mid-session.
app.post('/api/family/listening-heartbeat', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const restrictions = await dbGetEffectiveFamilyRestrictions(sess.username);
    if (!restrictions) return res.json({ allowed: true });
    const now = new Date();
    const today = dateKeyInTimeZone(now, restrictions?.timezone || 'UTC');
    const { data: existing } = await supabase
      .from('family_listening_time').select('seconds_listened').eq('username', sess.username).eq('listen_date', today).maybeSingle();
    const newTotal = existing?.seconds_listened || 0;

    // Best-effort device tracking (Part 4's "Remove Device" needs rows to
    // remove) — upserted here since a heartbeat is a reliable "this device
    // is actively in use right now" signal, unlike login (which only proves
    // a device connected once, not that it's still being used).
    const deviceLabel = typeof req.body?.deviceLabel === 'string' ? req.body.deviceLabel.slice(0, 120) : null;
    supabase.from('family_child_devices').upsert({
      username: sess.username,
      session_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
      device_label: deviceLabel,
      last_seen_at: now.toISOString(),
    }, { onConflict: 'session_token_hash' }).then(() => {}).catch(devErr => {
      console.error('[family heartbeat] device upsert failed (non-fatal):', devErr?.message || devErr);
    });

    const evaluation = evaluateListeningAllowed(restrictions, newTotal, now);
    return res.json({
      allowed: evaluation.allowed,
      reason: evaluation.reason || null,
      message: evaluation.message || null,
      secondsListenedToday: newTotal,
      dailyLimitMinutes: restrictions?.daily_listening_limit_minutes || null,
    });
  } catch (err) {
    console.error('[family listening-heartbeat]', err);
    // Fail OPEN, not closed — a transient DB hiccup on a background
    // heartbeat should never be the reason a child's music stops playing.
    // The daily limit is enforced on a best-effort basis by design; it's a
    // parental tool, not a security boundary.
    return res.json({ allowed: true });
  }
});


// Middleware: require an authenticated Premium session (used by DJ BOOM and
// any other Premium-gated route). Mirrors requireAdmin below it — same
// token-resolution order, same shape of response on failure — so the two
// gates behave identically from the client's point of view.
async function requirePremium(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  // Generic message since this middleware now gates more than one feature
  // (DJ BOOM, Real-Life Radio) — callers that want feature-specific upsell
  // copy show their own lock-card text client-side; the API response just
  // needs to be an unambiguous 403, not a marketing line.
  if (!sess.isPremium) return res.status(403).json({ error: 'This feature is available with FREQ Premium.' });
  req._premiumSession = sess;
  next();
}

// Phase 2 access layers sit beside requirePremium instead of weakening it:
// Premium accounts remain unlimited, while a non-Premium account may enter
// only the specific feature covered by an active Musi-Shop entitlement.
// Labs and every other Premium route continue to use requirePremium exactly
// as before.
async function requireDjBoomAccess(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const entitlements = await dbGetMusiShopEntitlements(sess.username, sess.isPremium);
    if (!entitlements.djBoomAccess) {
      return res.status(403).json({
        error: 'DJ BOOM requires FREQ Premium or a DJ BOOM message pack.',
        code: 'dj_boom_pack_required',
        shopAvailable: true,
      });
    }
    req._djBoomSession = sess;
    req._djBoomEntitlements = entitlements;
    next();
  } catch (err) {
    console.error('[djboom access]', err);
    return res.status(500).json({ error: 'Could not verify DJ BOOM access.' });
  }
}

async function requireRadioAccess(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const entitlements = await dbGetMusiShopEntitlements(sess.username, sess.isPremium);
    if (!entitlements.radioAccess) {
      return res.status(403).json({
        error: 'Real-Life Radio requires FREQ Premium or an active Radio Pass.',
        code: 'radio_pass_required',
        shopAvailable: true,
      });
    }
    req._radioSession = sess;
    req._radioEntitlements = entitlements;
    next();
  } catch (err) {
    console.error('[radio access]', err);
    return res.status(500).json({ error: 'Could not verify Radio access.' });
  }
}

// Middleware: require an authenticated session whose account email has been
// verified (Part 8). Same token-resolution/response shape as requirePremium
// above so every gate in this app behaves identically from the client's
// point of view — a plain 401 for "not signed in" vs a 403 with a specific
// reason for "signed in, but not allowed yet." Gates: upload, comment,
// publish, artist-page creation, Premium purchase, becoming a verified
// artist, and moderation tools, per the Part 8 spec. Does NOT gate browsing/
// playback — those stay open to unverified accounts by design.
async function requireVerifiedEmail(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address to continue.', emailVerificationRequired: true });
  req._verifiedSession = sess;
  next();
}

// Middleware: require an authenticated admin session. Also requires a
// verified email (Part 8: "use moderation tools" is one of the gated
// actions) — folded in here rather than added to every individual
// requireAdmin route below, since is_admin is granted manually (not through
// self-signup) and every moderation-tool route already goes through this
// one gate. An admin whose email somehow isn't verified should verify it
// via the same banner/flow as anyone else, not get a silent pass because
// they're an admin.
async function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  if (!sess.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address to use moderation tools.', emailVerificationRequired: true });
  req._adminSession = sess;
  next();
}

async function dbRefreshSession(token, expiresAt) {
  await supabase.from('sessions')
    .update({ expires_at: new Date(expiresAt).toISOString() })
    .eq('token', token);
}

async function dbDeleteSession(token) {
  await supabase.from('sessions').delete().eq('token', token);
}

async function dbGetPlaylists(username) {
  const { data, error } = await supabase
    .from('playlists')
    .select('data')
    .eq('username', username)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getPlaylists:', error.message);
  return data?.data || [];
}

async function dbSetPlaylists(username, playlists) {
  const { error } = await supabase.from('playlists').upsert(
    { username, data: playlists, updated_at: new Date().toISOString() },
    { onConflict: 'username' }
  );
  if (error) throw new Error(error.message);
}

// ─── Cloud Files (Supabase Storage + Postgres metadata) ───────────────────────
const CLOUD_BUCKET = 'cloud-audio';

// Columns the client is allowed to sort by, mapped to the actual DB column.
// 'name' sorts by filename since that's always populated; title is used as
// a secondary tiebreaker when present so ID3-tagged files still feel sorted
// by their real title where available.
const CLOUD_SORT_COLUMNS = {
  name:     'filename',
  artist:   'artist',
  date:     'uploaded_at',
  duration: 'duration',
};

// Cursor shape for keyset-capable columns: { v: <sort col value of last row
// of previous page>, id: <id of that row> }. id is always the tiebreaker so
// rows sharing an identical uploaded_at (batch uploads) or filename never
// get skipped or duplicated across page boundaries.
//
// Cursor shape for offset-fallback columns: { o: <row offset> }.
//
// Only 'date' and 'name' are keyset-paginated — backed by the two composite
// indexes added in migration_scale.sql (idx_cloud_files_owner_uploaded,
// idx_cloud_files_owner_filename). 'artist' and 'duration' have no dedicated
// composite index yet, so they fall back to offset pagination — slower at
// very large counts but still correct and unbounded, unlike capping at one
// page. Revisit with a real composite index if either becomes a hot sort.
function encodeCursor(row, col, keysetCapable) {
  return keysetCapable
    ? Buffer.from(JSON.stringify({ v: row[col], id: row.id })).toString('base64url')
    : null;
}
function encodeOffsetCursor(offset) {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}
function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed && (parsed.id != null || parsed.o != null)) return parsed;
  } catch (_) { /* malformed cursor — treat as no cursor, start from page 1 */ }
  return null;
}

const KEYSET_SORT_COLUMNS = new Set(['uploaded_at', 'filename']); // backed by composite indexes

async function dbGetCloudFiles(username, opts = {}) {
  const { folder, search, sort, dir, cursor, limit } = opts;

  function applyFolder(q) {
    // folder === undefined  → no filter (all files, any folder)
    // folder === ''  or '__unfiled__' → only files with no folder
    // folder === '<name>'   → only that folder
    if (folder === '__unfiled__' || folder === '') return q.is('folder', null);
    if (folder) return q.eq('folder', folder);
    return q;
  }

  const col = CLOUD_SORT_COLUMNS[sort] || 'uploaded_at';
  const ascending = dir === 'asc';
  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const decodedCursor = decodeCursor(cursor);
  const keysetCapable = KEYSET_SORT_COLUMNS.has(col);

  let q = supabase.from('cloud_files').select('*').eq('owner', username);
  q = applyFolder(q);

  if (search) {
    // Single full-text query against the generated tsvector column —
    // replaces the old 3x .ilike() merge-and-sort-in-JS approach. 'websearch'
    // mode gives free quoted-phrase and -exclude support with no extra
    // parsing on our end.
    q = q.textSearch('search_vector', search, { type: 'websearch' })
         .order('uploaded_at', { ascending: false })
         .limit(pageSize);
    const { data, error } = await q;
    if (error) { console.error('[db] getCloudFiles search:', error.message); return { rows: [], nextCursor: null }; }
    // Search result sets aren't paginated (ranked by FTS match, not a stable
    // sort column) — capped at one page, the right tradeoff since search
    // result sets are naturally small.
    return { rows: data || [], nextCursor: null };
  }

  q = q.order(col, { ascending }).order('id', { ascending });

  if (keysetCapable && decodedCursor?.id != null) {
    // Keyset predicate: (col, id) strictly past the cursor row, respecting
    // sort direction. Matches the composite index column order exactly.
    const op = ascending ? 'gt' : 'lt';
    const valLiteral = `"${String(decodedCursor.v).replace(/"/g, '\\"')}"`;
    q = q.or(
      `${col}.${op}.${valLiteral},and(${col}.eq.${valLiteral},id.${op}.${decodedCursor.id})`
    );
  }

  const offset = (!keysetCapable && decodedCursor?.o) ? decodedCursor.o : 0;
  if (!keysetCapable) {
    // No composite index for artist/duration — fall back to range() offset
    // paging. Unbounded and correct, just O(offset) scan cost server-side;
    // acceptable until one of these becomes a frequently-used sort.
    q = q.range(offset, offset + pageSize - 1);
  } else {
    q = q.limit(pageSize);
  }

  const { data, error } = await q;
  if (error) { console.error('[db] getCloudFiles:', error.message); return { rows: [], nextCursor: null }; }
  const rows = data || [];
  let nextCursor = null;
  if (rows.length === pageSize) {
    nextCursor = keysetCapable
      ? encodeCursor(rows[rows.length - 1], col, true)
      : encodeOffsetCursor(offset + pageSize);
  }
  return { rows, nextCursor };
}

async function dbGetCloudFolders(username) {
  const { data, error } = await supabase
    .from('cloud_files')
    .select('folder')
    .eq('owner', username)
    .not('folder', 'is', null);
  if (error) { console.error('[db] getCloudFolders:', error.message); return []; }
  const set = new Set(data.map(r => r.folder).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b));
}

async function dbGetCloudFile(id, username) {
  const { data, error } = await supabase
    .from('cloud_files')
    .select('*')
    .eq('id', id)
    .eq('owner', username)   // ownership enforced in the query itself, not just checked after
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getCloudFile:', error.message);
  return data || null;
}

// Fetches multiple files by id, scoped to owner. Used by bulk delete so we
// can resolve storage_paths for files that actually belong to the caller —
// any ids in the request that aren't theirs are silently dropped, not erred.
async function dbGetCloudFilesByIds(ids, username) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('cloud_files')
    .select('*')
    .in('id', ids)
    .eq('owner', username);
  if (error) { console.error('[db] getCloudFilesByIds:', error.message); return []; }
  return data || [];
}

async function dbInsertCloudFile(row) {
  const { data, error } = await supabase
    .from('cloud_files')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbDeleteCloudFile(id, username) {
  const { error } = await supabase
    .from('cloud_files')
    .delete()
    .eq('id', id)
    .eq('owner', username);  // same belt-and-suspenders ownership scoping
  if (error) throw new Error(error.message);
}

// Bulk delete by id, scoped to owner — same ownership guarantee as the
// single-file path, just expressed with .in() instead of .eq().
async function dbDeleteCloudFiles(ids, username) {
  if (!ids.length) return;
  const { error } = await supabase
    .from('cloud_files')
    .delete()
    .in('id', ids)
    .eq('owner', username);
  if (error) throw new Error(error.message);
}

// Partial update for rename / move-to-folder. Only the fields present in
// `patch` are touched. Returns the updated row.
async function dbUpdateCloudFile(id, username, patch) {
  const { data, error } = await supabase
    .from('cloud_files')
    .update(patch)
    .eq('id', id)
    .eq('owner', username)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// schedulePersist is a no-op now — kept so no call sites break
function schedulePersist() {}

// ─── Crypto helpers ───────────────────────────────────────────────────────────
const PBKDF2_ITERS  = 100_000;
const PBKDF2_KEYLEN = 64;

async function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, 'sha256', (err, key) => {
      if (err) reject(err); else resolve(key.toString('hex'));
    });
  });
}

function generateSalt()  { return crypto.randomBytes(16).toString('hex'); }
function generateToken() { return crypto.randomBytes(16).toString('hex'); }

const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

// ─── Age Group (Part 7 / Part 9) ───────────────────────────────────────────
// Age is ALWAYS derived server-side from a birthdate — the app never asks
// or accepts a self-reported "I'm 18" claim, per the Part 9 spec. This is
// the single source of truth every signup/birthdate-entry code path routes
// through so "child < 13, teen 13-17, adult 18+" is computed exactly once,
// the same way, everywhere. Matches the CHECK constraint on
// accounts.age_group (child/teen/adult) — this always returns one of those
// three, or throws for invalid input.

// Loose but real validation: rejects garbage strings, future dates, and
// dates implausibly far in the past, while staying lenient on exact format
// since the browser <input type="date"> already constrains what reaches us
// in the common case. Returns a plain YYYY-MM-DD string (never a Date
// object) since that's what the `date` column and the comparisons below
// expect.
function validateBirthdate(raw) {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime())) return null;

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (parsed.getTime() > todayUTC.getTime()) return null; // no future birthdates

  const earliestPlausible = new Date(Date.UTC(todayUTC.getUTCFullYear() - 120, 0, 1));
  if (parsed.getTime() < earliestPlausible.getTime()) return null; // nobody's 120+

  return value;
}

// Whole-years-elapsed age calculation (accounts for month/day, not just
// year subtraction). Takes an already-validated YYYY-MM-DD string.
function computeAgeFromBirthdate(birthdateStr) {
  const birth = new Date(birthdateStr + 'T00:00:00Z');
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let age = todayUTC.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = todayUTC.getUTCMonth() - birth.getUTCMonth();
  const dayDiff = todayUTC.getUTCDate() - birth.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age--;
  return age;
}

// The single function every signup/birthdate-update route calls. Takes a
// RAW (unvalidated) birthdate input and returns { birthdate, ageGroup } or
// throws with a user-facing message — callers just catch and surface
// err.message rather than duplicating the validation dance.
function computeAgeGroup(rawBirthdate) {
  const birthdate = validateBirthdate(rawBirthdate);
  if (!birthdate) throw new Error('Please enter a valid birthdate.');
  const age = computeAgeFromBirthdate(birthdate);
  if (age < 0) throw new Error('Please enter a valid birthdate.');
  const ageGroup = age < 13 ? 'child' : age < 18 ? 'teen' : 'adult';
  return { birthdate, ageGroup };
}

// resolveToken is now a thin alias for dbGetSession — kept for any call sites
// that were not auth routes (there are none, but just in case)
async function resolveToken(token) {
  if (!token) return null;
  return dbGetSession(token);
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Read polling, passive heartbeats, uploads, and real mutations use separate
// buckets. Previously they all shared one 120/minute IP counter, so the normal
// Messages poller and per-keystroke typing calls could consume the allowance
// before a user sent one message or uploaded one file. Route-specific limits
// below still provide the strict abuse controls for DMs, requests, invites,
// follows, likes, and other high-risk actions.
const GLOBAL_RATE_LIMIT_WINDOW_MS = 60_000;
const GLOBAL_RATE_LIMITS = Object.freeze({
  read: 600,
  passive: 600,
  upload: 30,
  mutation: 240,
});
const rateLimitMap = new Map();

function globalRateLimitBucket(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const pathName = String(req.originalUrl || req.url || '').split('?')[0];
  if (['GET','HEAD','OPTIONS'].includes(method)) return 'read';
  if (
    /^\/api\/messages\/conversations\/[^/]+\/(?:typing|read)$/.test(pathName)
    || /^\/api\/notices\/[^/]+\/read$/.test(pathName)
    || /^\/api\/(?:presence\/heartbeat|analytics\/page-view|mp\/listen-to-earn\/(?:heartbeat|stop)|auth\/token-refresh)$/.test(pathName)
  ) return 'passive';
  if (
    /\/(?:upload|attachments|files|avatar|cover|banner|evidence|documents)(?:\/|$)/.test(pathName)
    || /\/(?:track-cover)$/.test(pathName)
  ) return 'upload';
  return 'mutation';
}

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const bucket = globalRateLimitBucket(req);
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  const max = GLOBAL_RATE_LIMITS[bucket];
  const hits = (rateLimitMap.get(key) || []).filter(t => now - t < GLOBAL_RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  rateLimitMap.set(key, hits);
  if (hits.length > max) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.', code: 'rate_limit_exceeded', bucket });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateLimitMap) {
    const fresh = hits.filter(t => now - t < GLOBAL_RATE_LIMIT_WINDOW_MS);
    if (!fresh.length) rateLimitMap.delete(key); else rateLimitMap.set(key, fresh);
  }
}, 300_000);

// Generic factory for tighter, per-action limiters distinct from the global
// per-IP backstop above. Keyed by whatever `keyFn` returns for the request —
// for follow/unfollow that's the caller's username (set after dbGetSession
// resolves), not their IP, since a logged-in abuser can rotate IPs far more
// easily than usernames. Reusable for future per-action limits (likes,
// comments, chat) without duplicating the sliding-window logic each time.
function makeActionRateLimit({ windowMs, max, keyFn, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, times] of hits) {
      const fresh = times.filter(t => now - t < windowMs);
      if (!fresh.length) hits.delete(key); else hits.set(key, fresh);
    }
  }, Math.max(windowMs, 60_000));
  return function actionRateLimit(req, res, next) {
    const key = keyFn(req);
    if (!key) return next(); // no key yet (e.g. unauthenticated) — let the route's own auth check reject it
    const now = Date.now();
    const times = (hits.get(key) || []).filter(t => now - t < windowMs);
    times.push(now);
    hits.set(key, times);
    if (times.length > max) return res.status(429).json({ error: message || 'Rate limit exceeded. Please slow down.' });
    next();
  };
}

// Likes: same session-resolving, username-keyed pattern as followRateLimit
// and playlistRateLimit. 60/min is generous — a like is a single tap, and
// someone briskly liking through a profile's playlists shouldn't hit this,
// but a script hammering the endpoint should.
async function likeRateLimit(req, res, next) {
  const token = req.body?.token || req.query?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  req._session = sess; // route handler reuses this instead of resolving again
  if (!sess) return next(); // unauthenticated — the route's own 401 check handles this
  const key = sess.username;
  const now = Date.now();
  const times = (likeRateLimitHits.get(key) || []).filter(t => now - t < 60_000);
  times.push(now);
  likeRateLimitHits.set(key, times);
  if (times.length > 60) {
    return res.status(429).json({ error: 'Too many likes. Please slow down.' });
  }
  next();
}
const likeRateLimitHits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of likeRateLimitHits) {
    const fresh = times.filter(t => now - t < 60_000);
    if (!fresh.length) likeRateLimitHits.delete(key); else likeRateLimitHits.set(key, fresh);
  }
}, 60_000);

// Follow/unfollow specifically: tighter than the global 120/min-per-IP
// backstop. Keyed by the *caller's resolved username*, not their raw token —
// keying on the token would give a user with two active sessions (two
// devices, or a deliberately-opened second session) two independent 30/min
// buckets, which defeats the per-account intent. Resolving the session here
// means this middleware is async (dbGetSession hits the DB), and the route
// handler reuses req._followSession instead of resolving it a second time.
async function followRateLimit(req, res, next) {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  req._followSession = sess; // let the route handler skip a redundant dbGetSession call
  if (!sess) return next(); // unauthenticated — the route's own 401 check handles this
  const key = sess.username;
  const now = Date.now();
  const times = (followRateLimitHits.get(key) || []).filter(t => now - t < 60_000);
  times.push(now);
  followRateLimitHits.set(key, times);
  if (times.length > 30) {
    return res.status(429).json({ error: 'Too many follow/unfollow actions. Please slow down.' });
  }
  next();
}
const followRateLimitHits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of followRateLimitHits) {
    const fresh = times.filter(t => now - t < 60_000);
    if (!fresh.length) followRateLimitHits.delete(key); else followRateLimitHits.set(key, fresh);
  }
}, 60_000);

// Playlist writes (create/update/delete/add-track/remove-track): same
// session-resolving, username-keyed pattern as followRateLimit, for the
// same reason — keying on the raw token would let a multi-session user
// dodge the limit. Looser than follow (60/min vs 30/min) since legitimate
// use (building a 50-track playlist in one sitting) involves many more
// individual write calls than legitimate follow activity ever would.
async function playlistRateLimit(req, res, next) {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  req._session = sess; // route handler reuses this instead of resolving again
  if (!sess) return next(); // unauthenticated — the route's own 401 check handles this
  const key = sess.username;
  const now = Date.now();
  const times = (playlistRateLimitHits.get(key) || []).filter(t => now - t < 60_000);
  times.push(now);
  playlistRateLimitHits.set(key, times);
  if (times.length > 60) {
    return res.status(429).json({ error: 'Too many playlist changes. Please slow down.' });
  }
  next();
}
const playlistRateLimitHits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of playlistRateLimitHits) {
    const fresh = times.filter(t => now - t < 60_000);
    if (!fresh.length) playlistRateLimitHits.delete(key); else playlistRateLimitHits.set(key, fresh);
  }
}, 60_000);

// ─── HTTP fetch helper (spoofs browser UA so YT doesn't block) ────────────────
const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchHTML(url, timeoutMs = 8000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': YT_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        // Bypass GDPR/cookie consent gate that returns empty ytInitialData
        'Cookie': 'CONSENT=YES+; SOCS=CAESEwgDEgk0OTA3NzkzMjQaAmVuIAEaBgiAo_CmBg==',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ─── YouTube page scraper — extracts ytInitialData ────────────────────────────
/**
 * Parses YouTube's ytInitialData JSON embedded in the page source.
 * Returns parsed object or null.
 */
function extractYtInitialData(html) {
  // Strategy 1: find the var / window assignment, then balance braces to capture full JSON
  const starts = [
    /var ytInitialData\s*=\s*\{/,
    /window\["ytInitialData"\]\s*=\s*\{/,
    /ytInitialData\s*=\s*\{/,
  ];
  for (const pat of starts) {
    const m = html.search(pat);
    if (m === -1) continue;
    const start = html.indexOf('{', m);
    if (start === -1) continue;
    let depth = 0, i = start, inStr = false, escape = false;
    for (; i < html.length; i++) {
      const c = html[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    try { return JSON.parse(html.slice(start, i + 1)); } catch { continue; }
  }
  return null;
}

/**
 * Walks ytInitialData to find all videoRenderer / playlistVideoRenderer objects.
 * Returns array of { id, title, duration, thumb }.
 */
function extractTracksFromYtData(data) {
  const tracks = [];
  const seen   = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    // playlistVideoRenderer (playlist page)
    if (obj.playlistVideoRenderer) {
      const r  = obj.playlistVideoRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title    = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const durText  = r.lengthText?.simpleText || r.lengthText?.runs?.[0]?.text || null;
        const thumbs   = r.thumbnail?.thumbnails || [];
        const thumb    = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }
    // videoRenderer (search results / channel page)
    if (obj.videoRenderer) {
      const r  = obj.videoRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title   = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const durText = r.lengthText?.simpleText || null;
        const thumbs  = r.thumbnail?.thumbnails || [];
        const thumb   = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }
    // gridVideoRenderer (channel videos tab)
    if (obj.gridVideoRenderer) {
      const r  = obj.gridVideoRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title   = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const durText = r.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || null;
        const thumbs  = r.thumbnail?.thumbnails || [];
        const thumb   = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }
    // reelsItemRenderer (Shorts)
    if (obj.reelsItemRenderer) {
      const r  = obj.reelsItemRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title = r.headline?.simpleText || r.accessibility?.accessibilityData?.label || 'Short';
        const thumbs = r.thumbnail?.thumbnails || [];
        const thumb  = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: null, thumb });
      }
    }
    // richItemRenderer (home feed / shorts shelf)
    if (obj.richItemRenderer) walk(obj.richItemRenderer.content);

    // ── YouTube Music renderers ──────────────────────────────────────────────
    // musicVideoRenderer (YT Music search results / album tracks)
    if (obj.musicVideoRenderer) {
      const r  = obj.musicVideoRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title   = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const durText = r.lengthText?.runs?.[0]?.text || r.lengthText?.simpleText || null;
        const thumbs  = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
          || r.thumbnail?.thumbnails || [];
        const thumb   = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }
    // musicTwoRowItemRenderer (YT Music playlists / album grid)
    if (obj.musicTwoRowItemRenderer) {
      const r         = obj.musicTwoRowItemRenderer;
      const navEp     = r.navigationEndpoint?.watchEndpoint
        || r.navigationEndpoint?.watchPlaylistEndpoint;
      const id        = navEp?.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title   = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const thumbs  = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails
          || r.thumbnail?.thumbnails || [];
        const thumb   = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: null, thumb });
      }
    }
    // musicResponsiveListItemRenderer (YT Music queue / playlist page rows)
    if (obj.musicResponsiveListItemRenderer) {
      const r      = obj.musicResponsiveListItemRenderer;
      const ovEp   = r.overlay?.musicItemThumbnailOverlayRenderer
        ?.startMusicPlayCommand?.watchEndpoint;
      const flexEp = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
        ?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint;
      const id     = ovEp?.videoId || flexEp?.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const titleRun = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
          ?.text?.runs?.[0];
        const title    = titleRun?.text || 'Unknown';
        // Duration is usually in flexColumns[1] or fixedColumns[0]
        const durRun   = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer
          ?.text?.runs?.[0]
          || r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer
          ?.text?.runs?.[0];
        const durText  = durRun?.text || null;
        const thumbs   = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
          || r.thumbnail?.thumbnails || [];
        const thumb    = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }

    // Recurse into arrays and objects
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === 'object') walk(v);
    }
  }

  walk(data);
  return tracks;
}

/**
 * Extract playlist title from ytInitialData.
 */
function extractPlaylistTitle(data) {
  try {
    // playlist page: sidebar has metadata
    const header = data?.header?.playlistHeaderRenderer
      || data?.sidebar?.playlistSidebarRenderer?.items?.[0]?.playlistSidebarPrimaryInfoRenderer;
    if (header?.title?.runs?.[0]?.text) return header.title.runs[0].text;
    if (header?.title?.simpleText)      return header.title.simpleText;
    // microformat
    const mf = data?.microformat?.microformatDataRenderer;
    if (mf?.title) return mf.title;
  } catch {}
  return null;
}

// ─── YouTube oEmbed embed-check ───────────────────────────────────────────────
/**
 * Checks whether a YouTube video ID can be embedded.
 * Uses oEmbed endpoint — if it returns 401/403 or the response has
 * "Video not found" it means embedding is disabled.
 * Free, no API key.
 */
async function checkYtEmbeddable(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': YT_UA } });
    if (res.status === 401 || res.status === 403) return { embeddable: false };
    if (!res.ok) return { embeddable: false };
    const data = await res.json();
    // If the title is returned it's embeddable
    return { embeddable: true, title: data.title || null, thumb: data.thumbnail_url || null };
  } catch {
    return { embeddable: false };
  }
}

// ─── Platform Detection ───────────────────────────────────────────────────────
function detectPlatform(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^www\./, '');
    if (h === 'music.youtube.com')                          return 'ytmusic';
    if (h === 'youtube.com' || h === 'youtu.be')            return 'youtube';
    if (h === 'open.spotify.com')                           return 'spotify';
    if (h === 'tidal.com')                                  return 'tidal';
    if (h === 'soundcloud.com')                             return 'soundcloud';
    if (h === 'music.apple.com')                            return 'applemusic';
    if (h === 'music.amazon.com')                           return 'amazon';
    if (h === 'open.qobuz.com' || h === 'play.qobuz.com')  return 'qobuz';
    if (h === 'deezer.com' || h === 'www.deezer.com')       return 'deezer';
    if (h === 'last.fm' || h === 'www.last.fm')             return 'lastfm';
  } catch (_) {}
  return null;
}

// ─── Embed URL Builders ───────────────────────────────────────────────────────

/**
 * resolveYouTube — v4.1
 * - Returns both standard and nocookie embed URLs
 * - Detects playlist vs video
 * - Sets title from URL when possible
 */
function resolveYouTube(url) {
  const u = new URL(url);

  // YT Music browse paths  e.g. /browse/VLPL...
  const browsePath = u.pathname.match(/^\/browse\/(VL[A-Za-z0-9_-]+)/);
  if (browsePath) {
    const listId = browsePath[1].replace(/^VL/, '');
    return buildYtPlaylistResult(listId, url);
  }

  const listId  = u.searchParams.get('list');
  const videoId = u.searchParams.get('v')
    || (u.hostname === 'youtu.be' ? u.pathname.replace(/^\//, '').split('?')[0] : null);

  // Playlist (possibly with a starting video)
  if (listId && !videoId) return buildYtPlaylistResult(listId, url);

  // Video (possibly also in a playlist — treat as video)
  if (videoId && videoId.length >= 11) return buildYtVideoResult(videoId, listId, url);

  // Shorts /shorts/<id>
  const shortsMatch = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
  if (shortsMatch) return buildYtVideoResult(shortsMatch[1], null, url);

  // Channel / handle pages: not directly playable, return as link for track-fetch
  const channelMatch = u.pathname.match(/^\/@([^/]+)|^\/channel\/([A-Za-z0-9_-]+)/);
  if (channelMatch) {
    const handle = channelMatch[1] || channelMatch[2];
    return {
      type: 'channel',
      embedUrl: `/redirect?url=${encodeURIComponent(url)}&platform=youtube`,
      id: handle,
      title: `@${handle}`,
      canFetchTracks: true,
    };
  }

  return null;
}

function buildYtVideoResult(videoId, listId, originalUrl) {
  const params = new URLSearchParams({
    autoplay: '1', controls: '1', enablejsapi: '1', origin: 'https://freq.app',
    ...(listId ? { list: listId } : {}),
  });
  return {
    type:        'video',
    embedUrl:    `https://www.youtube.com/embed/${videoId}?${params}`,
    embedUrlNC:  `https://www.youtube-nocookie.com/embed/${videoId}?${params}`, // nocookie fallback
    id:          videoId,
    canFetchTracks: false,
  };
}

function buildYtPlaylistResult(listId, originalUrl) {
  const params = new URLSearchParams({ list: listId, autoplay: '1', controls: '1' });
  return {
    type:        'playlist',
    embedUrl:    `https://www.youtube.com/embed/videoseries?${params}`,
    embedUrlNC:  `https://www.youtube-nocookie.com/embed/videoseries?${params}`,
    id:          listId,
    canFetchTracks: true,
  };
}

function resolveSpotify(url) {
  const match = new URL(url).pathname.match(/^\/(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return { type, embedUrl:`https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`, id };
}

function resolveTidal(url) {
  const match = new URL(url).pathname.match(/\/(playlist|album|track)\/([^/?]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return { type, embedUrl:`https://embed.tidal.com/${type}s/${id}`, id };
}

function resolveSoundCloud(url) {
  const type = (url.includes('/sets/') || url.includes('/likes/')) ? 'playlist' : 'track';
  const params = new URLSearchParams({
    url, color:'%23ff5500', auto_play:'true', hide_related:'false',
    show_comments:'true', show_user:'true', show_reposts:'false', show_teaser:'true', visual:'true',
  });
  return { type, embedUrl:`https://w.soundcloud.com/player/?${params.toString()}`, id:url };
}

function resolveAppleMusic(url) {
  const u = new URL(url);
  // Strip locale path prefix if present (e.g. /us/album/...)
  // Normalise to global embed
  const playlistMatch = u.pathname.match(/^\/([a-z]{2})\/playlist\/(?:[^/]*\/)?(pl\.[A-Za-z0-9]+)/);
  if (playlistMatch) {
    const [, country, id] = playlistMatch;
    return { type:'playlist', embedUrl:`https://embed.music.apple.com/${country}/playlist/${id}`, id };
  }
  const albumMatch = u.pathname.match(/^\/([a-z]{2})\/(?:album|song)\/(?:[^/]*\/)?([\d]+)/);
  if (!albumMatch) {
    // try without locale
    const noLocale = u.pathname.match(/^\/((?:album|song|playlist)\/[^?]+)/);
    if (noLocale) return { type:'link', embedUrl:`https://embed.music.apple.com/${noLocale[1]}`, id:noLocale[1] };
    return null;
  }
  const [, country, id] = albumMatch;
  const trackId = u.searchParams.get('i');
  if (trackId) return { type:'track', embedUrl:`https://embed.music.apple.com/${country}/album/${id}?i=${trackId}`, id };
  return { type:'album', embedUrl:`https://embed.music.apple.com/${country}/album/${id}`, id };
}

function resolveAmazon(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(playlists?|albums?|tracks?|artists?)\/([^/?]+)/i);
  let type = 'link', id = url;
  if (match) { type = match[1].replace(/s$/, '').toLowerCase(); id = match[2]; }
  return { type, embedUrl:`/redirect?url=${encodeURIComponent(url)}&platform=amazon`, id };
}

function resolveQobuz(url) {
  const match = new URL(url).pathname.match(/\/(album|playlist|track)\/([^/?]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return { type, embedUrl:`/redirect?url=${encodeURIComponent(url)}&platform=qobuz`, id };
}

function resolveDeezer(url) {
  const u = new URL(url);
  const match = u.pathname.match(/(?:\/[a-z]{2})?\/?(track|playlist|album|artist|radio)\/([0-9]+)/i);
  if (!match) return null;
  const [, rawType, id] = match;
  const type = rawType.toLowerCase();
  return {
    type,
    embedUrl: `https://widget.deezer.com/widget/dark/${type}/${id}`,
    id,
  };
}

function resolveLastFm(url) {
  const u = new URL(url);
  const pathname = u.pathname;
  let type = 'link', id = url;

  const musicMatch = pathname.match(/^\/music\/([^/]+)(?:\/_\/([^/]+)|\/([^/]+))?/);
  const userMatch  = pathname.match(/^\/user\/([^/]+)/);
  const tagMatch   = pathname.match(/^\/tag\/([^/]+)/);

  if (musicMatch) {
    const [, artist, track, album] = musicMatch;
    if (track)      { type = 'track';  id = decodeURIComponent(artist) + ' — ' + decodeURIComponent(track); }
    else if (album) { type = 'album';  id = decodeURIComponent(artist) + ' · ' + decodeURIComponent(album); }
    else            { type = 'artist'; id = decodeURIComponent(artist); }
  } else if (userMatch) {
    type = 'profile'; id = decodeURIComponent(userMatch[1]);
  } else if (tagMatch) {
    type = 'tag'; id = decodeURIComponent(tagMatch[1]);
  }

  return {
    type,
    embedUrl: `/redirect?url=${encodeURIComponent(url)}&platform=lastfm`,
    id,
  };
}

// ─── Resolver Map ─────────────────────────────────────────────────────────────
const RESOLVERS = {
  youtube:    resolveYouTube,
  ytmusic:    resolveYouTube,
  spotify:    resolveSpotify,
  tidal:      resolveTidal,
  soundcloud: resolveSoundCloud,
  applemusic: resolveAppleMusic,
  amazon:     resolveAmazon,
  qobuz:      resolveQobuz,
  deezer:     resolveDeezer,
  lastfm:     resolveLastFm,
};

// ─── Redirect Brand Config ────────────────────────────────────────────────────
const REDIRECT_BRANDS = {
  amazon:  { name:'Amazon Music', color:'#00A8E1', bgColor:'#0f1923', emoji:'◈' },
  qobuz:   { name:'Qobuz',        color:'#05b8cc', bgColor:'#050f14', emoji:'◉' },
  lastfm:  { name:'Last.fm',      color:'#d51007', bgColor:'#0e0505', emoji:'⊕' },
  youtube: { name:'YouTube',      color:'#ff0000', bgColor:'#0a0000', emoji:'▶' },
};

app.get('/redirect', (req, res) => {
  const targetUrl = req.query.url    || '';
  const platform  = req.query.platform || 'amazon';
  const brand     = REDIRECT_BRANDS[platform] || REDIRECT_BRANDS.amazon;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="3;url=${encodeURI(decodeURIComponent(targetUrl))}">
  <title>${brand.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Unbounded:wght@700;900&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{background:${brand.bgColor};font-family:'Space Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:22px;color:#fff;padding:32px;}
    .icon{font-size:3rem;}
    .badge{background:${brand.color};color:#000;font-family:'Unbounded',sans-serif;font-weight:900;font-size:0.65rem;padding:5px 14px;border-radius:3px;letter-spacing:0.18em;text-transform:uppercase;}
    h2{font-family:'Unbounded',sans-serif;font-size:1.1rem;letter-spacing:-0.01em;text-align:center;}
    p{color:#778;font-size:0.75rem;text-align:center;line-height:1.8;}
    a{color:${brand.color};text-decoration:none;font-weight:700;}
    a:hover{text-decoration:underline;}
    .bar-wrap{width:220px;height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;}
    .bar-fill{height:100%;background:${brand.color};border-radius:2px;animation:fill 3s linear forwards;}
    @keyframes fill{from{width:0%;}to{width:100%;}}
    .note{font-size:0.62rem;color:#444;margin-top:8px;text-align:center;line-height:1.9;}
  </style>
</head>
<body>
  <div class="icon">${brand.emoji}</div>
  <div class="badge">${brand.name}</div>
  <h2>Opening in ${brand.name}…</h2>
  <div class="bar-wrap"><div class="bar-fill"></div></div>
  <p>Redirecting automatically.<br><a href="${decodeURIComponent(targetUrl)}" target="_blank">Click here</a> if it doesn't open.</p>
  <p class="note">${brand.name} doesn't support embedded playback in third-party apps.<br>Your link will open in a new tab.</p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  // Live account count from Supabase (best-effort — don't fail the health check)
  let accounts = 0;
  try {
    const { count } = await supabase.from('accounts').select('*', { count: 'exact', head: true });
    accounts = count || 0;
  } catch (_) {}
  res.json({
    status:   'ok',
    version:  '4.6',
    uptime:   Math.floor(process.uptime()),
    platform: process.platform,
    accounts,
  });
});

// ─── POST /api/resolve ────────────────────────────────────────────────────────
app.post('/api/resolve', rateLimit, (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ error: 'Request body must include a "url" string.' });

  const trimmed  = url.trim();
  const platform = detectPlatform(trimmed);
  if (!platform)
    return res.status(400).json({
      error: 'Unsupported platform. Paste a URL from YouTube, YT Music, Spotify, Tidal, SoundCloud, Apple Music, Amazon Music, Qobuz, Deezer, or Last.fm.',
    });

  try {
    const info = RESOLVERS[platform](trimmed);
    if (!info) return res.status(400).json({ error: `Could not extract a playable ID from this ${platform} URL. Check that the link is public and not a redirect.` });
    return res.json({ platform, originalUrl: trimmed, ...info });
  } catch (err) {
    console.error(`[resolve] ${platform}:`, err.message);
    return res.status(400).json({ error: `Could not parse this URL: ${err.message}` });
  }
});

// ─── POST /api/import (batch) ─────────────────────────────────────────────────
app.post('/api/import', rateLimit, (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || !urls.length)
    return res.status(400).json({ error: 'Request body must include a "urls" array.' });
  if (urls.length > 200)
    return res.status(400).json({ error: 'Maximum 200 URLs per import.' });

  const results = urls.map(rawUrl => {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { error:'Invalid URL', url:rawUrl };
    const trimmed  = rawUrl.trim();
    const platform = detectPlatform(trimmed);
    if (!platform) return { error:'Unsupported platform', url:trimmed };
    try {
      const info = RESOLVERS[platform](trimmed);
      if (!info) return { error:'Could not parse URL', url:trimmed };
      return { platform, originalUrl:trimmed, ...info };
    } catch (err) {
      return { error:err.message, url:trimmed };
    }
  });

  return res.json({
    succeeded: results.filter(r => !r.error),
    failed:    results.filter(r =>  r.error),
    total:     results.length,
  });
});

// ─── POST /api/yt/tracks  (NEW v4.1) ─────────────────────────────────────────
/**
 * Body: { url: string }
 * Returns: { type, title, tracks: [{ id, title, duration, thumb, embedUrl }] }
 *
 * Strategy:
 *   1. Fetch the YouTube page HTML with a browser UA
 *   2. Extract ytInitialData JSON
 *   3. Walk it to collect all video renderers
 *   4. Return track list — client decides which to queue
 *
 * Supports: watch?v=, playlist?list=, /shorts/, /@handle, /channel/
 */
app.post('/api/yt/tracks', rateLimit, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ error: '"url" required.' });

  const trimmed = url.trim();
  // Only allow YouTube URLs
  const platform = detectPlatform(trimmed);
  if (platform !== 'youtube' && platform !== 'ytmusic')
    return res.status(400).json({ error: 'Only YouTube / YT Music URLs are supported for track listing.' });

  // Normalise: ensure we're fetching the right page
  let fetchUrl = trimmed;
  try {
    const u = new URL(trimmed);
    // For a single video, fetch the video page — it shows related/playlist tracks
    // For a playlist, fetch playlist?list=...
    if (!u.searchParams.get('list') && !u.pathname.startsWith('/playlist')) {
      // Single video page — we'll get the "Up next" / playlist continuation
      // Just use the URL as-is
    }
    // YT Music → convert to regular youtube.com for scraping
    if (u.hostname === 'music.youtube.com') {
      u.hostname = 'www.youtube.com';
      fetchUrl = u.toString();
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  console.log(`[yt/tracks] Fetching: ${fetchUrl}`);

  try {
    const html = await fetchHTML(fetchUrl, 10000);

    if (!html || html.length < 1000) {
      return res.status(502).json({ error: 'YouTube returned an empty response. Try again.' });
    }

    if (html.includes('Sorry, something went wrong') || html.includes('Our systems have detected unusual traffic')) {
      return res.status(429).json({ error: 'YouTube rate limited. Please wait a moment and try again.' });
    }

    const ytData = extractYtInitialData(html);
    if (!ytData) {
      return res.status(502).json({ error: 'Could not parse YouTube page data. The page structure may have changed.' });
    }

    const tracks = extractTracksFromYtData(ytData);
    const title  = extractPlaylistTitle(ytData) || null;

    if (!tracks.length) {
      return res.status(404).json({ error: 'No tracks found on this page. The playlist may be private or empty.' });
    }

    // Build embedUrl for each track
    const tracksWithEmbed = tracks.map(t => ({
      ...t,
      embedBlocked: false,    // default; player updates via /api/yt/embed-check at playback time
      embedUrl:   `https://www.youtube.com/embed/${t.id}?autoplay=1&controls=1&enablejsapi=1`,
      embedUrlNC: `https://www.youtube-nocookie.com/embed/${t.id}?autoplay=1&controls=1&enablejsapi=1`,
      originalUrl: `https://www.youtube.com/watch?v=${t.id}`,
      platform:   'youtube',
      type:       'video',
    }));

    console.log(`[yt/tracks] Found ${tracksWithEmbed.length} tracks, title: "${title}"`);

    return res.json({
      type:   'playlist',
      title:  title || 'YouTube Playlist',
      tracks: tracksWithEmbed,
      total:  tracksWithEmbed.length,
      sourceUrl: trimmed,
    });

  } catch (err) {
    console.error('[yt/tracks] Error:', err.message);
    return res.status(502).json({ error: `Could not fetch YouTube page: ${err.message}` });
  }
});

// ─── GET /api/yt/embed-check  (NEW v4.1) ─────────────────────────────────────
/**
 * Query: ?id=<videoId>
 * Returns: { id, embeddable: bool, title?, thumb? }
 *
 * Uses YouTube's free oEmbed endpoint — no API key needed.
 * 401/403 = embedding disabled by uploader.
 */
app.get('/api/yt/embed-check', rateLimit, async (req, res) => {
  const { id } = req.query;
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
    return res.status(400).json({ error: 'Valid YouTube video ID required.' });

  try {
    const result = await checkYtEmbeddable(id);
    return res.json({ id, ...result });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// ─── GET /api/queue/health-check  (Dead-Link Doctor — batch embed check) ─────
/**
 * Query: ?ids=<comma-separated video IDs>  (max 40 per request)
 * Returns: { results: [{ id, embeddable, title?, thumb? }, ...] }
 *
 * Batches checkYtEmbeddable() across many queue items in one round trip, so
 * a full-queue scan doesn't mean the client firing dozens of sequential
 * requests at /api/yt/embed-check. Same oEmbed-based check under the hood —
 * this route is purely about making "scan my whole queue" affordable.
 * Bad/duplicate/malformed IDs are silently dropped rather than failing the
 * whole batch.
 */
app.get('/api/queue/health-check', rateLimit, async (req, res) => {
  const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
  const ids = [...new Set(raw.split(',').map(s => s.trim()).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)))].slice(0, 40);
  if (!ids.length) return res.status(400).json({ error: 'Provide "ids" as a comma-separated list of YouTube video IDs.' });

  try {
    const results = await Promise.all(ids.map(async id => {
      const result = await checkYtEmbeddable(id);
      return { id, ...result };
    }));
    return res.json({ results });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// ─── GET /api/yt/search  (Dead-Link Doctor — rematch source) ─────────────────
/**
 * Query: ?q=<search text>
 * Returns: { query, tracks: [{ id, title, duration, thumb, embedUrl, embedUrlNC, originalUrl, platform:'youtube', type:'video' }, ...] }
 *
 * Scrapes youtube.com/results the same way /api/yt/tracks scrapes playlist
 * pages — reuses fetchHTML/extractYtInitialData/extractTracksFromYtData
 * as-is, since a search results page is just another ytInitialData document
 * containing videoRenderer objects, which extractTracksFromYtData already
 * knows how to walk. This is what powers "find a replacement" when a track
 * turns out to be embed-blocked: search by the dead track's title, let the
 * user pick a working substitute without leaving the queue.
 */
app.get('/api/yt/search', rateLimit, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.status(400).json({ error: '"q" search text is required.' });
  if (q.length > 200) return res.status(400).json({ error: 'Search text too long.' });

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

  try {
    const html = await fetchHTML(searchUrl, 10000);
    if (!html || html.length < 1000)
      return res.status(502).json({ error: 'YouTube returned an empty response. Try again.' });
    if (html.includes('Sorry, something went wrong') || html.includes('Our systems have detected unusual traffic'))
      return res.status(429).json({ error: 'YouTube rate limited. Please wait a moment and try again.' });

    const ytData = extractYtInitialData(html);
    if (!ytData) return res.status(502).json({ error: 'Could not parse YouTube search results. The page structure may have changed.' });

    const tracks = extractTracksFromYtData(ytData).slice(0, 20).map(t => ({
      ...t,
      embedUrl:    `https://www.youtube.com/embed/${t.id}?autoplay=1&controls=1&enablejsapi=1`,
      embedUrlNC:  `https://www.youtube-nocookie.com/embed/${t.id}?autoplay=1&controls=1&enablejsapi=1`,
      originalUrl: `https://www.youtube.com/watch?v=${t.id}`,
      platform:    'youtube',
      type:        'video',
    }));

    return res.json({ query: q, tracks });
  } catch (err) {
    console.error('[yt/search] Error:', err.message);
    return res.status(502).json({ error: `Could not search YouTube: ${err.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES  — Supabase-backed
// ═══════════════════════════════════════════════════════════════════════════════

// ISO 3166-1 alpha-2 codes only — matches the <select> options on the
// frontend signup form exactly (frontend never free-types a country, so
// this whitelist is authoritative and rejects anything else outright,
// same spirit as the content_rating_tags CHECK constraint elsewhere in
// this codebase).
const VALID_COUNTRY_CODES = new Set([
  'US','CA','GB','AU','NZ','IE','DE','FR','ES','IT','PT','NL','BE','CH','AT','SE','NO','DK','FI','IS',
  'PL','CZ','SK','HU','RO','BG','GR','HR','SI','EE','LV','LT','LU','MT','CY',
  'JP','KR','CN','TW','HK','SG','MY','TH','VN','PH','ID','IN','PK','BD',
  'BR','MX','AR','CL','CO','PE','VE','UY','EC','BO','PY',
  'ZA','NG','EG','KE','MA','GH','ET','TZ','UG',
  'MX','IL','AE','SA','TR','RU','UA',
  'OTHER',
]);

app.post('/api/auth/signup', rateLimit, async (req, res) => {
  const { username, displayName, password, email, birthdate, country, termsAccepted, privacyAccepted } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const key = normalizeUsername(username);
  if (!key || key.length < 2)
    return res.status(400).json({ error: 'Username must be 2+ alphanumeric chars or underscores.' });
  if (isProtectedFreqNoticeIdentity(username) || isProtectedFreqNoticeIdentity(displayName))
    return res.status(400).json({ error: 'That identity is reserved for official FREQ Notices.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  // Email is required going forward — it's the one identifier a Premium
  // provider (Gumroad, etc.) can actually confirm, and username alone has
  // proven unreliable for that (see the "Already purchased?" flow in
  // lib/premiumVerification.js). Existing pre-email accounts are untouched
  // — this only gates *new* signups, not a forced migration for everyone
  // already on FREQ.
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail)
    return res.status(400).json({ error: 'Email is required.' });
  if (!looksLikeEmail(normalizedEmail))
    return res.status(400).json({ error: 'Please enter a valid email address.' });

  // Part 7/9 — birthdate is required going forward and is the ONLY source
  // of age_group; nothing here ever accepts a raw "I'm an adult" checkbox
  // instead. computeAgeGroup throws a user-facing message on anything
  // invalid (bad format, future date, implausible age), which the outer
  // catch below surfaces as-is.
  let birthdateResult;
  try {
    birthdateResult = computeAgeGroup(birthdate);
  } catch (ageErr) {
    return res.status(400).json({ error: ageErr.message });
  }

  const normalizedCountry = String(country || '').trim().toUpperCase();
  if (!VALID_COUNTRY_CODES.has(normalizedCountry))
    return res.status(400).json({ error: 'Please select a valid country.' });

  if (!termsAccepted)
    return res.status(400).json({ error: 'You must accept the Terms of Service to continue.' });
  if (!privacyAccepted)
    return res.status(400).json({ error: 'You must accept the Privacy Policy to continue.' });

  try {
    const existing = await dbGetAccount(key);
    if (existing) return res.status(409).json({ error: 'Username already taken.' });

    const existingEmail = await dbGetAccountByEmail(normalizedEmail);
    if (existingEmail) return res.status(409).json({ error: 'An account with that email already exists.' });

    const salt        = generateSalt();
    const hash        = await hashPassword(password, salt);
    const dName       = (displayName || '').trim() || key;
    const nowIso       = new Date().toISOString();
    await dbCreateAccount(key, dName, salt, hash, normalizedEmail, {
      birthdate: birthdateResult.birthdate,
      ageGroup: birthdateResult.ageGroup,
      country: normalizedCountry,
      termsAcceptedAt: nowIso,
      privacyAcceptedAt: nowIso,
    });
    try {
      await dbCreateProfile(key, dName);
    } catch (profileErr) {
      // dbCreateProfile now throws instead of silently logging (see the
      // comment above its definition) — this is exactly the failure mode
      // that previously left an account with no profile row, invisible to
      // Find a User/Discovery with no way for the user to tell why. Roll
      // the account back rather than leave that same half-created state:
      // accounts.username -> profiles.username is ON DELETE CASCADE, and
      // nothing else has been written yet (no session, no playlists row),
      // so this delete is a clean, complete undo of dbCreateAccount above.
      console.error('[signup] profile creation failed, rolling back account:', profileErr.message);
      await supabase.from('accounts').delete().eq('username', key);
      throw new Error('Could not finish creating your account. Please try again.');
    }
    await dbSetPlaylists(key, []);
    if (birthdateResult.ageGroup === 'child') {
      await syncChildPlaybackFilters(key, 'clean');
    }

    // Seed premium_email from the account's login email so a brand-new
    // signup already has an email on file for provider lookups (Gumroad
    // matches by purchaser email as a fallback to the FREQ Username custom
    // field — see lib/premium-providers/gumroad.js). This is only a
    // starting point: activateFromMembership in premiumVerification.js
    // will overwrite it with whatever email a provider actually confirms
    // once a real purchase is matched, so the two can diverge later if the
    // person pays with a different address.
    try {
      await supabase.from('accounts').update({ premium_email: normalizedEmail }).eq('username', key);
    } catch (seedErr) {
      // Non-fatal — worst case a brand-new account just falls back to
      // username-only matching until "Already purchased?" or a future
      // purchase fills premium_email in some other way.
      console.warn('[signup] could not seed premium_email (non-fatal):', seedErr?.message || seedErr);
    }

    const token     = generateToken();
    const expiresAt = Date.now() + TOKEN_TTL;
    await dbCreateSession(token, key, expiresAt);

    // Part 8: generate and send the verification link entirely server-side.
    // The raw token never reaches the browser or application logs.
    const acct = await dbGetAccount(key);
    let verificationEmailSent = false;
    let verifyExpiresInHours = null;
    try {
      const sent = await issueAndSendAccountVerification(req, acct);
      verificationEmailSent = true;
      verifyExpiresInHours = sent.expiresInHours;
    } catch (linkErr) {
      console.error('[signup] could not send verification email (non-fatal):', linkErr?.message || linkErr);
    }

    return res.status(201).json({
      token,
      username: key,
      displayName: dName,
      email: normalizedEmail,
      isPremium: !!acct?.is_premium,
      premiumStatus: getPremiumStatusFromAccount(acct),
      emailRequired: false,
      ageGroup: acct?.age_group || birthdateResult.ageGroup,
      birthdateRequired: false,
      emailVerified: false,
      familyControls: {
        isChildAccount: birthdateResult.ageGroup === 'child',
        parentManaged: false,
        maxContentRating: birthdateResult.ageGroup === 'child' ? 'clean' : null,
        disabledFeatures: birthdateResult.ageGroup === 'child' ? {
          radio: true, djboom: true, social_feed: true, uploads: true,
          artist_pages: true, labs: true, premium_purchases: true,
        } : {},
      },
      verificationEmailSent,
      verifyExpiresInHours,
    });
  } catch (err) {
    console.error('[signup]', err);
    return res.status(500).json({ error: 'Server error during signup.' });
  }
});

app.post('/api/auth/signin', rateLimit, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username or email and password required.' });

  // Accept either a username or an email in the same field — the frontend
  // still just calls it "username" (see #signinUsername), but the account
  // may have been found by whichever identifier the person typed. Try
  // username first since it's the more common/faster path (single indexed
  // lookup by primary key) and the shape check is cheap; fall back to an
  // email lookup only if that first attempt found nothing and the input
  // actually looks like an email, so a typo'd username doesn't silently
  // turn into an unnecessary second query for the common failure case.
  const rawIdentifier = String(username);
  const key = normalizeUsername(rawIdentifier);
  try {
    let acct = key ? await dbGetAccount(key) : null;
    if (!acct && looksLikeEmail(rawIdentifier)) {
      acct = await dbGetAccountByEmail(rawIdentifier);
    }
    if (!acct) return res.status(401).json({ error: 'No account found with that username or email.' });
    if (acct.is_banned) return res.status(403).json({ error: 'This account has been suspended.' });

    const hash = await hashPassword(password, acct.salt);
    if (hash !== acct.hash) return res.status(401).json({ error: 'Incorrect password.' });

    // The account's own username is the canonical key from here on —
    // sessions/playlists/etc are all keyed by it regardless of which
    // identifier was used to sign in.
    const acctKey = acct.username;

    const token     = generateToken();
    const expiresAt = Date.now() + TOKEN_TTL;
    await dbCreateSession(token, acctKey, expiresAt);
    const playlists = await dbGetPlaylists(acctKey);
    dbEnsureProfile(acctKey, acct.display_name); // fire-and-forget self-heal — see dbEnsureProfile's comment

    // Silently re-verify Premium against the provider if it's due (throttled
    // internally — see PREMIUM_REVERIFY_INTERVAL_MS). Covers: a cancelled
    // membership that should no longer show as Premium, and a purchase made
    // on another device that hasn't been pulled down here yet. Best-effort —
    // a provider hiccup here must never block sign-in.
    let acctForResponse = acct;
    try {
      const verifyResult = await verifyPremiumIfDue(premiumDb, acct);
      if (verifyResult) acctForResponse = await dbGetAccount(acctKey);
    } catch (verifyErr) {
      console.error('[signin] premium reverify failed (non-fatal):', verifyErr?.message || verifyErr);
    }

    const familyControls = await dbGetFamilyGateSummary(acctKey);
    return res.json({
      token,
      username: acctKey,
      displayName: acctForResponse.display_name,
      playlists,
      isPremium: !!acctForResponse.is_premium,
      premiumStatus: getPremiumStatusFromAccount(acctForResponse),
      // True for accounts created before email became required (or that
      // somehow still lack one) — lets the frontend show a one-time,
      // non-blocking "add your email" prompt after login rather than
      // gating sign-in itself. See POST /api/account/email.
      emailRequired: !acctForResponse.email,
      // Same idea for accounts created before birthdate collection existed
      // (Part 7/9) — but this ONE, unlike emailRequired, is meant to block
      // interaction with a non-dismissible prompt until resolved, per
      // Deidre's call: age-gating enforcement downstream needs a real
      // age_group on every account, not an indefinitely-postponable nudge.
      // See POST /api/account/birthdate.
      birthdateRequired: !acctForResponse.age_group,
      ageGroup: acctForResponse.age_group || null,
      emailVerified: !!acctForResponse.email_verified_at,
      familyControls,
    });
  } catch (err) {
    console.error('[signin]', err);
    return res.status(500).json({ error: 'Server error during sign in.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ACCOUNT EMAIL VERIFICATION (Part 8)
// ═══════════════════════════════════════════════════════════════════════════
// Server generates, hashes, stores, and emails the token. The browser never
// receives a raw verification link or token. Kept as its own small module
// rather than merged into the artist-verification code above because it's
// keyed by accounts.username, not a request row, and gates a different set
// of actions (upload/comment/publish/artist-page-creation/premium-purchase/
// becoming-verified-artist/moderation-tools per the Part 8 spec) — trying to
// share confirmVerificationEmail()'s requestId-shaped plumbing would make
// both flows harder to read for a difference that's only skin-deep.

const ACCOUNT_EMAIL_TOKEN_TTL_HOURS = 24; // same window as artist verification

function generateAccountVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashAccountVerificationToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

// Generates a fresh token, stores its hash + expiry on the account, and
// returns the raw verifyUrl only to the server-side email sender. Used by
// signup and resend so the two flows never drift out of sync.
async function issueAccountVerificationLink(req, username) {
  const rawToken = generateAccountVerificationToken();
  const { error } = await supabase.from('accounts').update({
    email_verification_token_hash: hashAccountVerificationToken(rawToken),
    email_verification_expires_at: new Date(Date.now() + ACCOUNT_EMAIL_TOKEN_TTL_HOURS * 3600 * 1000).toISOString(),
  }).eq('username', username);
  if (error) throw new Error(error.message);
  return {
    verifyUrl: `${req.protocol}://${req.get('host')}/verify-account-email?username=${encodeURIComponent(username)}&token=${rawToken}`,
    expiresInHours: ACCOUNT_EMAIL_TOKEN_TTL_HOURS,
  };
}

async function issueAndSendAccountVerification(req, account) {
  if (!account?.username || !account?.email) throw new Error('Account email is required.');
  const link = await issueAccountVerificationLink(req, account.username);
  await sendEmailJs({
    templateId: EMAILJS_TEMPLATE_ID_ACCOUNT,
    templateParams: {
      email: account.email,
      displayName: account.display_name || account.username,
      verifyUrl: link.verifyUrl,
      expiresInHours: String(link.expiresInHours),
    },
  });
  // The raw token/link intentionally dies inside this server-side call. It
  // is never logged and never returned to the browser, so proving control
  // of the email inbox is a real requirement rather than a client honor
  // system.
  return { expiresInHours: link.expiresInHours };
}

// Shared by POST /api/account/verify-email/confirm (programmatic) and
// GET /verify-account-email (the actual magic-link click target). Returns
// { ok: true, username } or { ok: false, httpStatus, error } so both routes
// can format the response their own way (JSON vs redirect) — same split as
// confirmVerificationEmail() above.
async function confirmAccountEmailVerification(username, token) {
  if (!username || !token) return { ok: false, httpStatus: 400, error: 'username and token are required.' };
  const acct = await dbGetAccount(username);
  if (!acct) return { ok: false, httpStatus: 404, error: 'Account not found.' };
  if (acct.email_verified_at) return { ok: true, username: acct.username, alreadyVerified: true };
  if (!acct.email_verification_expires_at || new Date(acct.email_verification_expires_at).getTime() < Date.now()) {
    return { ok: false, httpStatus: 410, error: 'This verification link has expired. Please request a new one.' };
  }
  if (hashAccountVerificationToken(token) !== acct.email_verification_token_hash) {
    return { ok: false, httpStatus: 403, error: 'Invalid verification link.' };
  }

  const { error } = await supabase.from('accounts').update({
    email_verified_at: new Date().toISOString(),
    // Clear the token once used — single-use, same as artist verification's
    // implicit behavior (a re-click just fails the status check above once
    // email_verified_at is set, thanks to the alreadyVerified early return).
    email_verification_token_hash: null,
    email_verification_expires_at: null,
  }).eq('username', acct.username);
  if (error) throw new Error(error.message);

  return { ok: true, username: acct.username, alreadyVerified: false };
}

// POST /api/account/verify-email/start — authenticated. Generates a fresh
// link for the CURRENT session's account. Signup also calls
// issueAccountVerificationLink directly (see /api/auth/signup above) so a
// brand-new account gets its first link without a separate round-trip; this
// route exists for "I'm signed in but never got the email" / re-triggering
// on demand from a verify-your-email banner.
app.post('/api/account/verify-email/start', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const acct = await dbGetAccount(sess.username);
    if (!acct) return res.status(401).json({ error: 'Authentication required.' });
    if (!acct.email) return res.status(400).json({ error: 'Add an email to your account before verifying it.' });
    if (acct.email_verified_at) return res.json({ alreadyVerified: true, email: acct.email });

    const { expiresInHours } = await issueAndSendAccountVerification(req, acct);

    return res.json({
      email: acct.email,
      displayName: acct.display_name,
      expiresInHours,
      sent: true,
    });
  } catch (err) {
    console.error('[account/verify-email/start]', err);
    return res.status(500).json({ error: 'Could not start email verification.' });
  }
});

// POST /api/account/verify-email/resend — identical to /start in practice
// (both regenerate a fresh token, invalidating any prior link), kept as a
// separate name only to match the resend/start split the frontend and
// artist-verification flow already use elsewhere, so the "Resend" button
// wiring is a drop-in copy of resendVerificationEmail()'s shape.
app.post('/api/account/verify-email/resend', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const acct = await dbGetAccount(sess.username);
    if (!acct) return res.status(401).json({ error: 'Authentication required.' });
    if (!acct.email) return res.status(400).json({ error: 'Add an email to your account before verifying it.' });
    if (acct.email_verified_at) return res.json({ alreadyVerified: true, email: acct.email });

    const { expiresInHours } = await issueAndSendAccountVerification(req, acct);

    return res.json({
      email: acct.email,
      displayName: acct.display_name,
      expiresInHours,
      sent: true,
    });
  } catch (err) {
    console.error('[account/verify-email/resend]', err);
    return res.status(500).json({ error: 'Could not resend verification email.' });
  }
});

// POST /api/account/verify-email/confirm  { username, token }
// Public route (no session needed) since the link is clicked from an email
// client — mirrors POST /api/verification/confirm-email.
app.post('/api/account/verify-email/confirm', rateLimit, async (req, res) => {
  const { username, token } = req.body || {};
  try {
    const result = await confirmAccountEmailVerification(normalizeUsername(username), token);
    if (!result.ok) return res.status(result.httpStatus).json({ error: result.error });
    return res.json({ username: result.username, alreadyVerified: !!result.alreadyVerified });
  } catch (err) {
    console.error('[account/verify-email/confirm]', err);
    return res.status(500).json({ error: 'Could not confirm email verification.' });
  }
});

// GET /verify-account-email?username=...&token=...
// The ACTUAL link target clicked from the confirmation email. Mirrors
// GET /verify-email above exactly — does the confirm server-side, then
// redirects into the SPA with a query flag so the frontend can show a
// toast/banner update once it boots. rateLimit intentionally omitted, same
// reasoning as /verify-email: the token itself is the auth (single-use,
// hashed, expires), and this is a GET a human clicks from their inbox.
app.get('/verify-account-email', async (req, res) => {
  const { username, token } = req.query || {};
  try {
    const result = await confirmAccountEmailVerification(normalizeUsername(username), token);
    if (!result.ok) {
      return res.redirect(`/?accountVerifyError=${encodeURIComponent(result.error)}`);
    }
    return res.redirect(`/?accountVerified=1`);
  } catch (err) {
    console.error('[verify-account-email link]', err);
    return res.redirect(`/?accountVerifyError=${encodeURIComponent('Could not confirm email verification.')}`);
  }
});

// Lets an existing (pre-email) account add the now-required email without
// needing to sign up again or lose any data. Also usable to update an
// account's email later in general — there's no separate "change email"
// endpoint, this is that endpoint. Requires an authenticated session;
// nothing here ever infers or guesses an email on the person's behalf.
app.post('/api/account/email', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });

  const normalizedEmail = normalizeEmail(req.body?.email);
  if (!normalizedEmail) return res.status(400).json({ error: 'Email is required.' });
  if (!looksLikeEmail(normalizedEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  try {
    const acct = await dbGetAccount(sess.username);
    if (!acct) return res.status(401).json({ error: 'Authentication required.' });

    const existingEmail = await dbGetAccountByEmail(normalizedEmail);
    if (existingEmail && existingEmail.username !== acct.username) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const { error } = await supabase.from('accounts').update({ email: normalizedEmail }).eq('username', acct.username);
    if (error) throw new Error(error.message);

    // Only backfill premium_email if the account doesn't already have one
    // — an account that's already linked to a confirmed purchaser email
    // (via activateFromMembership) shouldn't have that silently overwritten
    // just because the person updated their login email separately.
    if (!acct.premium_email) {
      try {
        await supabase.from('accounts').update({ premium_email: normalizedEmail }).eq('username', acct.username);
      } catch (seedErr) {
        console.warn('[account/email] could not seed premium_email (non-fatal):', seedErr?.message || seedErr);
      }
    }

    return res.json({ email: normalizedEmail });
  } catch (err) {
    console.error('[account/email]', err);
    return res.status(500).json({ error: 'Could not update email right now. Please try again.' });
  }
});

// Lets an existing (pre-Phase-4) account complete the Part 7 signup fields
// it was created without — birthdate, country, terms/privacy acceptance —
// so age_group can finally be computed. This is the ONE-TIME, NON-DISMISSIBLE
// prompt (see the birthdateRequired comment on /api/auth/signin above):
// Deidre's call was to force this rather than let it be postponed
// indefinitely like /api/account/email, since downstream age-gating
// enforcement needs every account to have a real age_group. Once set, an
// account's birthdate/age_group become locked per Part 5 ("Child accounts
// cannot change... Birthdate... Only parent can") — this route only ever
// WRITES when age_group is currently null, so it can't be used to alter an
// already-set birthdate. A future admin or parent-initiated correction
// path is out of scope for this route.
app.post('/api/account/birthdate', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });

  const { birthdate, country, termsAccepted, privacyAccepted } = req.body || {};

  let birthdateResult;
  try {
    birthdateResult = computeAgeGroup(birthdate);
  } catch (ageErr) {
    return res.status(400).json({ error: ageErr.message });
  }

  const normalizedCountry = String(country || '').trim().toUpperCase();
  if (!VALID_COUNTRY_CODES.has(normalizedCountry))
    return res.status(400).json({ error: 'Please select a valid country.' });
  if (!termsAccepted)
    return res.status(400).json({ error: 'You must accept the Terms of Service to continue.' });
  if (!privacyAccepted)
    return res.status(400).json({ error: 'You must accept the Privacy Policy to continue.' });

  try {
    const acct = await dbGetAccount(sess.username);
    if (!acct) return res.status(401).json({ error: 'Authentication required.' });

    if (acct.age_group) {
      // Already set — nothing to do. Not an error: a second tab or a retry
      // after a network blip shouldn't surface a scary failure message for
      // what is, from the person's point of view, "yeah I already did that."
      return res.json({ ageGroup: acct.age_group, alreadySet: true });
    }

    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('accounts').update({
      birthdate: birthdateResult.birthdate,
      age_group: birthdateResult.ageGroup,
      country: normalizedCountry,
      terms_accepted_at: nowIso,
      privacy_accepted_at: nowIso,
    }).eq('username', acct.username);
    if (error) throw new Error(error.message);

    return res.json({ ageGroup: birthdateResult.ageGroup, alreadySet: false });
  } catch (err) {
    console.error('[account/birthdate]', err);
    return res.status(500).json({ error: 'Could not save birthdate right now. Please try again.' });
  }
});

// ─── DJ BOOM (Premium or Musi-Shop message pack) ───────────────────────────
// Server-side only — the Gemini key never touches the client. Premium stays
// unlimited; requireDjBoomAccess also accepts a purchased message balance,
// and one message is consumed only after Gemini produces a usable reply.
//
// v2: DJ BOOM is now grounded in the caller's actual FREQ session instead of
// talking like a generic chatbot with no idea what's playing. The frontend
// sends a `context` object (current track, queue, playlists, playback state,
// etc — see buildDjBoomContextBlock below) alongside the message history.
// That context is rendered into a fenced block placed ahead of the
// conversation in the system instruction, and the model is told to only use
// what's in that block — never invent tracks, playlists, or counts.
//
// AI/action separation: DJ BOOM never "does" anything itself — it can only
// describe an action it wants performed and hand back a small, whitelisted
// action object. The frontend is the only thing that actually mutates
// playback/queue/library state, after checking the action type against its
// own switch statement. This route re-validates the action server-side
// too, against DJ_BOOM_ACTION_TYPES below, before it's allowed out the
// door — a malformed or hallucinated action degrades to "no action", not a
// crash or a pass-through of arbitrary model output.
const DJ_BOOM_ACTION_TYPES = new Set([
  'playLikedSongs',                  // no payload
  'shuffleLikedSongs',               // no payload
  'shuffleQueue',                    // no payload — reshuffles the current queue in place
  'skipTrack',                       // no payload
  'previousTrack',                   // no payload
  'togglePlayPause',                 // no payload
  'likeCurrentTrack',                // no payload — likes whatever's currently playing
  'playPlaylistByName',              // { name }
  'addCurrentTrackToPlaylistByName', // { name }
  'queueTrackSearch',                // { query } — searches FREQ's catalog and queues best match(es)
  'searchAndPlay',                   // { query } — same search, but replaces queue/plays immediately
  'startFreqRadio',                  // no payload — seeds a queue from the current track/artist
  'playCloudFiles',                  // no payload — queues the user's own uploaded cloud files
  'setRepeatMode',                   // { mode: 'off'|'all'|'one' }
]);

// ─── Experimental Labs hook: DJ BOOM Personalities ─────────────────────────
// The one Labs toggle wired to real behavior (see EXPERIMENTAL LABS section
// below). When a Premium user has enabled the 'dj-boom-personalities'
// experiment AND picked a persona (stored in experimental_user_settings'
// same enabled flag isn't enough to pick *which* persona, so the persona
// choice itself is persisted as experimental_user_settings.feature_id
// 'dj-boom-personalities' with a `persona` field tucked into a small JSON
// note -- see dbGetDjBoomPersona below), this text is appended to the base
// system prompt. Purely a tone/voice change -- it never alters the hard
// rules, the action whitelist, or the JSON response contract above it.
const DJ_BOOM_PERSONALITIES = {
  hype_mc: {
    label: 'Hype Hype MC',
    prompt: `PERSONA OVERLAY — Hype Hype MC:
Talk like a hype-man MC on a live mic — high energy, short punchy lines, occasional ad-libs ("let's go!", "yeah!"). Still follow every hard rule and the JSON response format exactly; this only changes tone, never substance.`,
  },
  lofi_host: {
    label: 'Chill Lo-Fi Host',
    prompt: `PERSONA OVERLAY — Chill Lo-Fi Host:
Talk like a laid-back late-night lo-fi radio host — unhurried, warm, a little dreamy. Still follow every hard rule and the JSON response format exactly; this only changes tone, never substance.`,
  },
  oldschool_dj: {
    label: 'Old-School Radio DJ',
    prompt: `PERSONA OVERLAY — Old-School Radio DJ:
Talk like a classic AM radio DJ from decades past — smooth, a little theatrical, calls the listener "folks" now and then. Still follow every hard rule and the JSON response format exactly; this only changes tone, never substance.`,
  },
};

const DJ_BOOM_SYSTEM_PROMPT_BASE = `You are DJ BOOM, FREQ's built-in in-app music assistant.
FREQ is a music streaming and social platform. You are not a generic chatbot
— you are wired into the user's live FREQ session and can see (via the
"FREQ SESSION CONTEXT" block provided with every message) what's currently
playing, their queue, their playlists, their liked songs, and their playback
state. Treat that block as ground truth about their account and this moment.

Hard rules:
1. NEVER invent or guess at tracks, artists, playlists, queue contents, like
   counts, or any other detail about the user's library. If the context
   block doesn't contain something, say you don't have that information
   rather than making it up. A null, empty, or missing field means that
   data is genuinely unavailable right now, not "go figure it out."
2. You cannot directly play, skip, queue, shuffle, like, or otherwise change
   anything yourself. When the user asks you to DO something playback- or
   library-related, respond with a short natural confirmation line AND a
   structured action for the app to execute afterward. Phrase confirmations
   as "Sure, doing that now" — not as if it's already finished — since the
   app performs the action only after your response is received.
3. Only use action types from this exact list — never invent a new one:
   ${[...DJ_BOOM_ACTION_TYPES].join(', ')}.
   If the request doesn't map cleanly to one of these, don't force it —
   just have a normal conversation, or ask one brief clarifying question.
4. For general music talk — lyric ideas, song titles, release planning,
   playlist concepts, "what should I listen to" recommendations — respond
   conversationally with no action. Base recommendations only on
   genres/artists actually visible in the provided context (liked songs,
   recent plays, queue), not on outside opinions about what's "good."
5. Keep replies short and conversational, like a DJ talking over a mic
   between tracks, not a formal assistant. You are not a substitute for
   legal, financial, or professional advice, and should say so plainly if a
   question strays into those areas.

Response format — this is critical:
Respond with ONLY a single JSON object, no markdown fences, no prose outside
the JSON, matching exactly this shape:
{"reply": "<what you'd say out loud>", "action": {"type": "<action type or null>", "payload": {"name": "<playlist or search text, if relevant>", "query": "<search text, if relevant>", "mode": "<off|all|one, if relevant>"}}}
Omit payload keys that don't apply to the chosen action type. If no action
applies, set "action" to null entirely — never invent an action whose type
isn't in the allowed list above.`;

// Renders the frontend-supplied session context into a fenced block the
// model is instructed to treat as ground truth. Every field is defensively
// coerced/truncated — this is user-influenced input (track titles, playlist
// names, etc. originate from whatever's in their library) — and rendered as
// inert JSON text rather than interpolated into instruction prose, so it
// can't smuggle extra instructions to the model.
function buildDjBoomContextBlock(context) {
  const c = context && typeof context === 'object' ? context : {};
  const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);
  const bool = v => (typeof v === 'boolean' ? v : null);
  const arr = (v, max = 25) => (Array.isArray(v) ? v.slice(0, max) : []);

  const safeContext = {
    username: str(c.username, 60) || 'unknown',
    isPremium: bool(c.isPremium),
    playback: {
      state: str(c.playback?.state, 20) || 'unknown', // playing | paused | idle
      shuffled: bool(c.playback?.shuffled),
      repeatMode: str(c.playback?.repeatMode, 10) || 'off', // off | all | one
    },
    currentTrack: c.currentTrack && typeof c.currentTrack === 'object' ? {
      title: str(c.currentTrack.title, 200) || 'Unknown',
      artist: str(c.currentTrack.artist, 200) || 'Unknown',
      platform: str(c.currentTrack.platform, 40) || 'unknown',
      isLikedByMe: bool(c.currentTrack.isLikedByMe),
    } : null, // null = nothing currently playing
    queue: arr(c.queue).map(t => ({
      title: str(t?.title, 150) || 'Unknown',
      artist: str(t?.artist, 150) || 'Unknown',
    })),
    queueLength: typeof c.queueLength === 'number' ? c.queueLength : arr(c.queue).length,
    recentlyPlayed: arr(c.recentlyPlayed, 15).map(t => ({
      title: str(t?.title, 150) || 'Unknown',
      artist: str(t?.artist, 150) || 'Unknown',
    })),
    likedSongsCount: typeof c.likedSongsCount === 'number' ? c.likedSongsCount : null,
    likedSongsSample: arr(c.likedSongsSample, 15).map(t => ({
      title: str(t?.title, 150) || 'Unknown',
      artist: str(t?.artist, 150) || 'Unknown',
    })),
    playlists: arr(c.playlists, 30).map(p => ({
      name: str(p?.name, 120) || 'Untitled',
      trackCount: typeof p?.trackCount === 'number' ? p.trackCount : null,
    })),
    currentPlaylist: str(c.currentPlaylist, 120),
    hasCloudFiles: bool(c.hasCloudFiles),
    cloudFileCount: typeof c.cloudFileCount === 'number' ? c.cloudFileCount : null,
  };

  return `FREQ SESSION CONTEXT (ground truth — do not contradict or embellish this):
${JSON.stringify(safeContext, null, 2)}
END FREQ SESSION CONTEXT`;
}

// Reads the user's chosen DJ BOOM persona, if the 'dj-boom-personalities'
// Labs experiment is both enabled for them AND they've picked a specific
// persona. Returns null on any missing/malformed state (experiment off,
// row missing, unrecognized persona key) rather than throwing — DJ BOOM
// chat should never fail because a Labs toggle read hiccupped.
async function dbGetDjBoomPersona(username) {
  if (!username) return null;
  try {
    const { data, error } = await supabase
      .from('experimental_user_settings')
      .select('enabled, persona')
      .eq('username', username)
      .eq('feature_id', 'dj-boom-personalities')
      .maybeSingle();
    if (error || !data || !data.enabled) return null;
    const persona = String(data.persona || '').trim();
    return DJ_BOOM_PERSONALITIES[persona] ? persona : null;
  } catch (_err) {
    return null;
  }
}

// Same rolling-window shape as artistFollowRateLimit above, but its own
// bucket and a tighter ceiling — LLM calls cost real money per request,
// unlike a follow/unfollow row write, so this deliberately throttles harder.
const djBoomRateLimitHits = new Map();
function djBoomRateLimit(req, res, next) {
  const sess = req._djBoomSession;
  const key = sess?.username || req.ip;
  const now = Date.now();
  const times = (djBoomRateLimitHits.get(key) || []).filter(t => now - t < 60_000);
  times.push(now);
  djBoomRateLimitHits.set(key, times);
  if (times.length > 15) {
    return res.status(429).json({ error: 'DJ BOOM is thinking too fast — give it a few seconds.' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of djBoomRateLimitHits) {
    const fresh = times.filter(t => now - t < 60_000);
    if (!fresh.length) djBoomRateLimitHits.delete(key); else djBoomRateLimitHits.set(key, fresh);
  }
}, 300_000);

async function finalizeDjBoomReplyAccess(req) {
  if (req._djBoomSession?.isPremium) {
    return { ok: true, premiumUnlimited: true, djBoomMessagesRemaining: null };
  }
  const consumed = await dbConsumeDjBoomMessage(req._djBoomSession?.username);
  if (!consumed.ok) return consumed;
  return {
    ok: true,
    premiumUnlimited: false,
    djBoomMessagesRemaining: Math.max(0, Number(consumed.djBoomMessagesRemaining) || 0),
  };
}

app.post('/api/djboom/chat', requireFeatureAllowed('djboom'), requireDjBoomAccess, djBoomRateLimit, async (req, res) => {
  if (!gemini) {
    console.error('[djboom] GEMINI_API_KEY not configured');
    return res.status(503).json({ error: 'DJ BOOM is temporarily unavailable.' });
  }

  const { messages, context } = req.body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: '"messages" must be a non-empty array.' });
  }
  if (messages.length > 40) {
    return res.status(400).json({ error: 'Conversation is too long for a single request.' });
  }
  const cleaned = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!cleaned.length) {
    return res.status(400).json({ error: 'No valid messages provided.' });
  }

  const contextBlock = buildDjBoomContextBlock(context);
  // Experimental Labs remains Premium-only. Message-pack access opens the
  // core assistant but does not silently unlock Premium Labs personalities.
  const personaKey = req._djBoomSession?.isPremium
    ? await dbGetDjBoomPersona(req._djBoomSession.username)
    : null;
  const personaOverlay = personaKey ? `\n\n${DJ_BOOM_PERSONALITIES[personaKey].prompt}` : '';
  const systemInstruction = `${DJ_BOOM_SYSTEM_PROMPT_BASE}${personaOverlay}\n\n${contextBlock}`;

  try {
    const model = gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });
    // Gemini roles are lowercase 'user' / 'model', not 'USER' / 'MODEL' —
    // the previous version of this route had this backwards, which silently
    // degraded every request to Gemini's default role handling.
    const contents = cleaned.map(message => ({
      role: message.role === 'user' ? 'user' : 'model',
      parts: [{ text: message.content }],
    }));
    const completion = await model.generateContent({
      contents,
      generationConfig: {
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
      systemInstruction,
    });
    const raw = completion.response.text() || '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      // Model didn't return valid JSON despite the instruction — fall back
      // to the raw text as a plain conversational reply instead of failing
      // the whole request. No action in this path since there's no
      // structured data to trust.
      console.error('[djboom] Non-JSON response from Gemini:', raw.slice(0, 300));
      const access = await finalizeDjBoomReplyAccess(req);
      if (!access.ok) {
        return res.status(403).json({
          error: 'Your DJ BOOM message pack is empty.',
          code: 'dj_boom_pack_required',
          shopAvailable: true,
        });
      }
      return res.json({
        reply: raw.trim() || "Sorry, I didn't catch that — can you try again?",
        action: null,
        access,
      });
    }

    const reply = typeof parsed?.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.slice(0, 2000)
      : "Sorry, I didn't catch that — can you try again?";

    // Re-validate the action server-side rather than trusting the model's
    // output verbatim — this is the actual boundary that keeps a
    // hallucinated or malformed action type from ever reaching the
    // frontend's executor.
    let action = null;
    const rawType = parsed?.action?.type;
    if (typeof rawType === 'string' && DJ_BOOM_ACTION_TYPES.has(rawType)) {
      const rawPayload = parsed.action.payload;
      let payload = null;
      if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
        payload = {};
        if (typeof rawPayload.name === 'string' && rawPayload.name.trim()) payload.name = rawPayload.name.slice(0, 120);
        if (typeof rawPayload.query === 'string' && rawPayload.query.trim()) payload.query = rawPayload.query.slice(0, 200);
        if (typeof rawPayload.mode === 'string' && ['off', 'all', 'one'].includes(rawPayload.mode)) {
          payload.mode = rawPayload.mode;
        }
        if (!Object.keys(payload).length) payload = null;
      }
      action = { type: rawType, payload };
    }

    const access = await finalizeDjBoomReplyAccess(req);
    if (!access.ok) {
      return res.status(403).json({
        error: 'Your DJ BOOM message pack is empty.',
        code: 'dj_boom_pack_required',
        shopAvailable: true,
      });
    }
    return res.json({ reply, action, access });
  } catch (err) {
    console.error('[djboom] Gemini API error:', err?.message || err);
    return res.status(502).json({ error: 'DJ BOOM is temporarily unavailable.' });
  }
});

app.post('/api/auth/token-refresh', async (req, res) => {
  const { token } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  const expiresAt = Date.now() + TOKEN_TTL;
  await dbRefreshSession(token, expiresAt);
  let acct = await dbGetAccount(sess.username);

  // This fires on every app load/session-restore, which is exactly the
  // "restore Premium on a new device / after reinstall / detect a
  // cancellation" path the automatic-verification requirement calls for.
  // verifyPremiumIfDue is internally throttled, so this doesn't turn into a
  // provider API call on every single page load — only when due.
  try {
    const verifyResult = await verifyPremiumIfDue(premiumDb, acct);
    if (verifyResult) acct = await dbGetAccount(sess.username);
  } catch (verifyErr) {
    console.error('[token-refresh] premium reverify failed (non-fatal):', verifyErr?.message || verifyErr);
  }

  const familyControls = await dbGetFamilyGateSummary(sess.username);
  return res.json({
    ok: true,
    expiresAt,
    username: sess.username,
    isPremium: !!acct?.is_premium,
    premiumStatus: getPremiumStatusFromAccount(acct),
    emailRequired: !acct?.email,
    birthdateRequired: !acct?.age_group,
    ageGroup: acct?.age_group || null,
    emailVerified: !!acct?.email_verified_at,
    familyControls,
  });
});

app.post('/api/auth/sync', async (req, res) => {
  const { token, playlists } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!Array.isArray(playlists)) return res.status(400).json({ error: '"playlists" must be an array.' });
  if (JSON.stringify(playlists).length > 2_000_000)
    return res.status(413).json({ error: 'Playlist data exceeds 2 MB limit.' });
  try {
    await dbSetPlaylists(sess.username, playlists);
    return res.json({ ok: true, synced: playlists.length, syncedAt: Date.now() });
  } catch (err) {
    console.error('[sync]', err);
    return res.status(500).json({ error: 'Sync failed.' });
  }
});

// ─── Premium verification (POST /api/premium/verify, POST /api/premium/sync) ──
// Both routes do the same underlying thing — call verifyPremiumNow, which
// does a live provider lookup and applies whatever it finds — but exist as
// two names for two different mental models the frontend needs:
//
//   /verify — "I just paid, activate my account." User-initiated from the
//             Premium Hub's "Verify Purchase" button. Framed around success.
//   /sync   — "Check if my subscription is still valid." Can be triggered
//             from anywhere Premium status might need a manual refresh
//             (e.g. a future "Refresh subscription" control). Framed around
//             confirming current state, including a cancellation.
//
// Both require an authenticated session — there is no guest path, and
// nothing here ever lets the client set is_premium directly. The only way
// Premium gets turned on is a provider lookup coming back with an active
// membership inside verifyPremiumNow/activateFromMembership.
async function handlePremiumVerifyRequest(req, res, routeLabel) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  // Part 8 gates *purchasing* Premium behind a verified email — but /sync
  // (checking an already-active subscription, including detecting a
  // cancellation) must keep working regardless, or an unverified account
  // that somehow already has Premium could never find out it lapsed.
  if (routeLabel === 'premium verify' && !sess.emailVerified) {
    return res.status(403).json({ error: 'Please verify your email address before purchasing Premium.', emailVerificationRequired: true });
  }

  try {
    const acct = await dbGetAccount(sess.username);
    if (!acct) return res.status(401).json({ error: 'Authentication required.' });

    if (!getConfiguredProviders().length) {
      // No provider has its env vars set in this deployment — nothing to
      // check against. Distinguish this from "checked and found nothing"
      // so the frontend doesn't show a misleading "no membership found"
      // when the real issue is server configuration.
      console.error(`[${routeLabel}] no premium providers configured`);
      return res.status(503).json({ error: 'Premium verification is temporarily unavailable. Please try again later.' });
    }

    // Optional: the customer typing in the email they actually paid with,
    // from the "Already purchased?" box. Covers the very common case where
    // someone's Gumroad purchase email differs from anything FREQ has on
    // file (e.g. bought with a work email, FREQ account uses a personal
    // one) — without this there was no way for that person to self-serve
    // at all. Silently ignored if malformed rather than erroring the whole
    // request, since the username-based match still gets a chance to run.
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const emailOverride = rawEmail && looksLikeEmail(rawEmail) ? rawEmail.toLowerCase() : null;

    const result = await verifyPremiumNow(premiumDb, acct, { emailOverride });

    if (result.erroredWithoutAnswer) {
      // Every configured provider errored out (network/outage/bad token) —
      // never expose that detail to the client; the spec is explicit that
      // API errors must not leak. Existing Premium status (if any) was left
      // untouched by verifyPremiumNow in this case.
      return res.status(502).json({
        error: 'Could not reach the payment provider right now. Please try again in a moment.',
        isPremium: result.isPremium,
        premiumStatus: result.premiumStatus,
      });
    }

    return res.json({
      verified: true,
      isPremium: result.isPremium,
      premiumStatus: result.premiumStatus,
      provider: result.provider,
    });
  } catch (err) {
    console.error(`[${routeLabel}]`, err?.message || err);
    return res.status(500).json({ error: 'Could not verify Premium status right now. Please try again.' });
  }
}

// User-initiated "I just paid" flow — deliberately eager and un-throttled,
// matching verifyPremiumNow's own doc comment: this is low-frequency by
// nature (one click after paying) so there's no need to rate-limit beyond
// the global per-IP limiter already applied via app-wide middleware.
app.post('/api/premium/verify', rateLimit, requireFeatureAllowed('premium_purchases'), (req, res) => handlePremiumVerifyRequest(req, res, 'premium verify'));

// Same underlying check, framed as "refresh my subscription state" rather
// than "activate my purchase" — see the comment above handlePremiumVerifyRequest.
app.post('/api/premium/sync', rateLimit, (req, res) => handlePremiumVerifyRequest(req, res, 'premium sync'));

app.get('/api/auth/pull', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    let acct        = await dbGetAccount(sess.username);
    const playlists = await dbGetPlaylists(sess.username);
    dbEnsureProfile(sess.username, acct?.display_name || sess.username); // fire-and-forget self-heal

    // Same throttled auto-reverify as token-refresh — pull is the other
    // "session restore" call site (authInit() calls token-refresh then pull
    // back to back), so covering both means Premium restoration/cancellation
    // detection doesn't depend on which one happens to run the check.
    try {
      const verifyResult = await verifyPremiumIfDue(premiumDb, acct);
      if (verifyResult) acct = await dbGetAccount(sess.username);
    } catch (verifyErr) {
      console.error('[pull] premium reverify failed (non-fatal):', verifyErr?.message || verifyErr);
    }

    const familyControls = await dbGetFamilyGateSummary(sess.username);
    return res.json({
      username:    sess.username,
      displayName: acct?.display_name || sess.username,
      isPremium:   !!acct?.is_premium,
      premiumStatus: getPremiumStatusFromAccount(acct),
      playlists,
      pulledAt:    Date.now(),
      birthdateRequired: !acct?.age_group,
      ageGroup: acct?.age_group || null,
      emailVerified: !!acct?.email_verified_at,
      familyControls,
    });
  } catch (err) {
    console.error('[pull]', err);
    return res.status(500).json({ error: 'Pull failed.' });
  }
});

app.delete('/api/auth/account', requireNotChild, async (req, res) => {
  const token = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = req._session || await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    await dbDeleteAccount(sess.username);
    return res.json({ ok: true, deleted: sess.username });
  } catch (err) {
    console.error('[delete-account]', err);
    return res.status(500).json({ error: 'Account deletion failed.' });
  }
});

// Public for signed-out visitors, but a supplied account token is honored so
// a parent-disabled Premium purchase flow cannot retrieve the checkout URL.
// The URL contains no secrets; this gate enforces account policy.
app.get('/api/premium/config', requireFeatureAllowed('premium_purchases', { allowAnonymous: true }), (_req, res) => {
  res.json({ checkoutUrl: GUMROAD_CHECKOUT_URL });
});

// Lightweight status check, built for the checkout-return polling loop —
// the frontend calls this every few seconds while "Activating Premium…" is
// showing. Deliberately doesn't touch dbRefreshSession/expiry (unlike
// token-refresh) since a poll shouldn't extend the session TTL, and stays
// a single cheap account read rather than the heavier /api/auth/pull
// (which also fetches playlists) so rapid polling stays inexpensive.
app.get('/api/premium/status', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    const acct = await dbGetAccount(sess.username);
    return res.json({
      isPremium: !!acct?.is_premium,
      premiumStatus: getPremiumStatusFromAccount(acct),
    });
  } catch (err) {
    console.error('[premium status]', err);
    return res.status(500).json({ error: 'Could not check Premium status.' });
  }
});

app.get('/api/premium/history', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    const { data, error } = await supabase
      .from('premium_subscriptions')
      .select('*')
      .eq('username', sess.username)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return res.json({ history: data || [] });
  } catch (err) {
    console.error('[premium history]', err);
    return res.status(500).json({ error: 'Could not load billing history.' });
  }
});

// Powers the Premium "Manage Subscription" dashboard (the Self Serve
// button). Deliberately read-only and side-effect-free — it does NOT
// re-verify against Gumroad (that's what "Refresh Subscription" /
// POST /api/premium/sync is for); this just hands back what FREQ already
// has on file, plus the one real "manage your subscription" destination
// that exists for a Gumroad-billed membership. There is no per-customer
// Gumroad billing-portal API to redirect into (Gumroad's own docs: buyers
// manage/cancel via their Library or their purchase receipt, not a URL a
// third-party app can deep-link a specific customer into) — so
// manageUrl is always the general Gumroad Library, which is accurate for
// every FREQ Premium customer regardless of which sale/email they used.
app.get('/api/premium/manage', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    const acct = await dbGetAccount(sess.username);
    if (!acct) return res.status(401).json({ error: 'Authentication required.' });

    const premiumStatus = getPremiumStatusFromAccount(acct);
    const provider = String(acct.premium_provider || '').toLowerCase();

    // Provider-specific management destination. Gumroad is the only
    // implemented provider today (see lib/premium-providers), so this is
    // effectively always the Gumroad Library — but kept as a lookup rather
    // than a hardcoded value so a future Stripe/Paddle provider (which DO
    // have real per-customer billing-portal APIs) can plug in a proper
    // session-scoped portal URL here without touching the frontend.
    const manageUrl = provider === 'gumroad' ? GUMROAD_MANAGE_URL : null;

    return res.json({
      isPremium: !!acct.is_premium,
      premiumStatus,
      manageUrl,
      // Tells the frontend whether cancellation can happen without leaving
      // FREQ. False for every provider today (including Gumroad) — kept
      // explicit rather than inferred from `provider` so the frontend
      // doesn't need its own copy of "which providers support what."
      supportsInAppCancellation: false,
    });
  } catch (err) {
    console.error('[premium manage]', err);
    return res.status(500).json({ error: 'Could not load subscription management info.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  REAL-LIFE RADIO (PTB) — Premium or active Radio Pass
//  Backed by the free Radio Browser directory (lib/radio.js) — FREQ never
//  stores the station catalog itself, only per-user favorites/recent-plays
//  rows that reference a station by its Radio Browser stationuuid.
//
//  Every route that can hand back a playable stream URL (search, popular,
//  favorites, recent, and the play/click endpoint) is gated by
//  requireRadioAccess — Premium remains unlimited; Phase 2 Radio Passes add
//  time-limited access without changing the Premium subscription model.
//  The API remains the authorization boundary, not the blurred client card.
//
//  Radio plays are DELIBERATELY never written to tracks/track_plays — see
//  radio_recent_plays in the migration — so Real-Life Radio never counts
//  toward artist/track play counts or Community Charts.
// ═══════════════════════════════════════════════════════════════════════════════

// Same rolling-window shape as djBoomRateLimit — search/browse calls hit
// Radio Browser's free public API, so this exists to keep FREQ a well-
// behaved consumer of it (and to keep one user from hammering it through
// FREQ), not because it costs FREQ money the way an LLM call does.
const radioRateLimitHits = new Map();
function radioRateLimit(req, res, next) {
  const sess = req._radioSession || req._premiumSession;
  const key = sess?.username || req.ip;
  const now = Date.now();
  const times = (radioRateLimitHits.get(key) || []).filter(t => now - t < 60_000);
  times.push(now);
  radioRateLimitHits.set(key, times);
  if (times.length > 60) {
    return res.status(429).json({ error: 'Too many radio requests — please slow down.' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of radioRateLimitHits) {
    const fresh = times.filter(t => now - t < 60_000);
    if (!fresh.length) radioRateLimitHits.delete(key); else radioRateLimitHits.set(key, fresh);
  }
}, 300_000);

function shapeStationForClient(s) {
  return {
    stationUuid: s.stationUuid,
    name: s.name,
    streamUrl: s.streamUrl,
    homepageUrl: s.homepageUrl,
    faviconUrl: s.faviconUrl,
    country: s.country,
    countryCode: s.countryCode,
    language: s.language,
    tags: s.tags,
    codec: s.codec,
    bitrate: s.bitrate,
    votes: s.votes,
  };
}

// GET /api/radio/search?token=&name=&tag=&country=&countryCode=&language=&limit=&offset=
app.get('/api/radio/search', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  try {
    const stations = await radio.searchStations({
      name: req.query.name,
      tag: req.query.tag,
      country: req.query.country,
      countryCode: req.query.countryCode,
      language: req.query.language,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ stations: stations.map(shapeStationForClient) });
  } catch (err) {
    console.error('[radio search]', err?.message || err);
    return res.status(502).json({ error: 'Could not reach the radio directory. Please try again.' });
  }
});

// GET /api/radio/popular?token=&limit=
app.get('/api/radio/popular', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  try {
    const stations = await radio.getPopularStations({ limit: req.query.limit });
    return res.json({ stations: stations.map(shapeStationForClient) });
  } catch (err) {
    console.error('[radio popular]', err?.message || err);
    return res.status(502).json({ error: 'Could not reach the radio directory. Please try again.' });
  }
});

// GET /api/radio/featured?token=&limit=  — top-voted stations, used for the
// Radio Home "Featured" rail, kept distinct from Popular (clickcount) since
// they're different signals (community votes vs. actual live listens).
app.get('/api/radio/featured', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  try {
    const stations = await radio.getTopVotedStations({ limit: req.query.limit });
    return res.json({ stations: stations.map(shapeStationForClient) });
  } catch (err) {
    console.error('[radio featured]', err?.message || err);
    return res.status(502).json({ error: 'Could not reach the radio directory. Please try again.' });
  }
});

// GET /api/radio/countries?limit=  — metadata only (names + counts), but still
// part of the disabled Radio surface, so it shares the family + Premium gate.
app.get('/api/radio/countries', requireFeatureAllowed('radio'), requireRadioAccess, rateLimit, async (req, res) => {
  try {
    const countries = await radio.getCountries({ limit: req.query.limit });
    return res.json({ countries });
  } catch (err) {
    console.error('[radio countries]', err?.message || err);
    return res.status(502).json({ error: 'Could not reach the radio directory. Please try again.' });
  }
});

// GET /api/radio/tags?limit=  — same family + Premium boundary as countries.
app.get('/api/radio/tags', requireFeatureAllowed('radio'), requireRadioAccess, rateLimit, async (req, res) => {
  try {
    const tags = await radio.getTags({ limit: req.query.limit });
    return res.json({ tags });
  } catch (err) {
    console.error('[radio tags]', err?.message || err);
    return res.status(502).json({ error: 'Could not reach the radio directory. Please try again.' });
  }
});

// GET /api/radio/spin-globe?token=  — Experimental Labs: Spin The Globe.
// Picks a random country from Radio Browser's own country list (weighted
// naturally by whichever countries have stations at all, since we only
// pick from countries that actually appear in getCountries()), then a
// random lastCheckOk station within it. Gated on requirePremium (like
// every Radio route) AND on the user having 'spin-the-globe' enabled in
// Experimental Labs — this is the one Labs experiment wired to a real
// backend route, so it enforces its own toggle rather than trusting the
// frontend to only call it when the switch is on.
app.get('/api/radio/spin-globe', requireFeatureAllowed('radio'), requirePremium, radioRateLimit, async (req, res) => {
  try {
    const { data: setting, error: settingErr } = await supabase
      .from('experimental_user_settings')
      .select('enabled')
      .eq('username', req._premiumSession.username)
      .eq('feature_id', 'spin-the-globe')
      .maybeSingle();
    if (settingErr) throw new Error(settingErr.message);
    if (!setting?.enabled) {
      return res.status(403).json({ error: "Turn on 'Spin The Globe' in Experimental Labs first." });
    }

    const countries = await radio.getCountries({ limit: 100 });
    if (!countries.length) return res.status(502).json({ error: 'Radio directory has no countries listed right now.' });

    // Try a handful of random countries in case the first pick has only
    // dead/offline stations after searchStations' own lastCheckOk filter —
    // bounded so a genuinely bad run of luck fails fast instead of hanging.
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const country = countries[Math.floor(Math.random() * countries.length)];
      const stations = await radio.searchStations({ country: country.name, limit: 20 });
      if (stations.length) {
        const station = stations[Math.floor(Math.random() * stations.length)];
        return res.json({ station, country: country.name });
      }
    }
    return res.status(502).json({ error: 'Could not find a live station after a few spins — try again.' });
  } catch (err) {
    console.error('[radio spin-globe]', err?.message || err);
    return res.status(502).json({ error: 'Could not reach the radio directory. Please try again.' });
  }
});


// Called right when the user hits Play (not on every search result render).
// Re-fetches the station by UUID server-side — never trusts a client-
// supplied streamUrl — so the actual stream link handed back always comes
// from Radio Browser directly, and registers the click with Radio Browser
// per their own usage guidance. This is the one route whose entire purpose
// is handing back a playable URL, so it's the most important to keep
// behind requireRadioAccess regardless of what the frontend does.
app.post('/api/radio/play', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  const { stationUuid } = req.body || {};
  if (!stationUuid) return res.status(400).json({ error: 'stationUuid is required.' });
  try {
    const station = await radio.getStationByUuid(stationUuid);
    if (!station) {
      return res.status(404).json({ error: 'This station is currently unavailable. Try another station.' });
    }
    radio.registerClick(stationUuid); // fire-and-forget, see lib/radio.js
    return res.json({ station: shapeStationForClient(station) });
  } catch (err) {
    console.error('[radio play]', err?.message || err);
    return res.status(502).json({ error: 'This station is currently unavailable. Try another station.' });
  }
});

// ─── Favorites ──────────────────────────────────────────────────────────

// GET /api/radio/favorites?token=
app.get('/api/radio/favorites', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('radio_favorites')
      .select('station_uuid, station_name, station_url, station_favicon, homepage_url, country, tags, codec, bitrate, created_at')
      .eq('owner', req._radioSession.username)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return res.json({
      favorites: (data || []).map(f => ({
        stationUuid: f.station_uuid,
        name: f.station_name,
        streamUrl: f.station_url,
        faviconUrl: f.station_favicon,
        homepageUrl: f.homepage_url,
        country: f.country,
        tags: f.tags,
        codec: f.codec,
        bitrate: f.bitrate,
        favoritedAt: f.created_at,
      })),
    });
  } catch (err) {
    console.error('[radio favorites get]', err?.message || err);
    return res.status(500).json({ error: 'Could not load favorites.' });
  }
});

// POST /api/radio/favorites   { token, station: { stationUuid, name, streamUrl, homepageUrl, faviconUrl, country, tags, codec, bitrate } }
// Takes the full station object from the client (as returned by search/
// popular/play above) rather than re-fetching by UUID — a station a user
// wants to favorite was already resolved once by one of those routes, and
// Radio Browser has no bulk "get station snapshot to persist" endpoint
// that would make a second round-trip meaningful here. Premium-gated like
// everything else radio, even though it doesn't hand back a stream URL
// itself, since favoriting is part of the same Premium feature surface.
app.post('/api/radio/favorites', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  const { station } = req.body || {};
  const stationUuid = station?.stationUuid;
  const name = station?.name;
  const streamUrl = station?.streamUrl;
  if (!stationUuid || !name || !streamUrl) {
    return res.status(400).json({ error: 'station.stationUuid, station.name, and station.streamUrl are required.' });
  }
  try {
    const row = {
      owner: req._radioSession.username,
      station_uuid: String(stationUuid).slice(0, 200),
      station_name: String(name).slice(0, 300),
      station_url: String(streamUrl).slice(0, 1000),
      station_favicon: station.faviconUrl ? String(station.faviconUrl).slice(0, 1000) : null,
      homepage_url: station.homepageUrl ? String(station.homepageUrl).slice(0, 1000) : null,
      country: station.country ? String(station.country).slice(0, 120) : null,
      tags: station.tags ? String(station.tags).slice(0, 500) : null,
      codec: station.codec ? String(station.codec).slice(0, 20) : null,
      bitrate: Number.isFinite(Number(station.bitrate)) ? Number(station.bitrate) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('radio_favorites')
      .upsert(row, { onConflict: 'owner,station_uuid' });
    if (error) throw new Error(error.message);
    return res.json({ favorited: true });
  } catch (err) {
    console.error('[radio favorites post]', err?.message || err);
    return res.status(500).json({ error: 'Could not save favorite.' });
  }
});

// DELETE /api/radio/favorites/:stationId   { token }
app.delete('/api/radio/favorites/:stationId', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  try {
    const { error } = await supabase
      .from('radio_favorites')
      .delete()
      .eq('owner', req._radioSession.username)
      .eq('station_uuid', req.params.stationId);
    if (error) throw new Error(error.message);
    return res.json({ favorited: false });
  } catch (err) {
    console.error('[radio favorites delete]', err?.message || err);
    return res.status(500).json({ error: 'Could not remove favorite.' });
  }
});

// ─── Recently Played ────────────────────────────────────────────────────

// GET /api/radio/recent?token=&limit=
// Returns distinct stations, most-recently-played first — a user bouncing
// between the same three stations shouldn't see the list clogged with
// repeats of the same station at different timestamps. Deduping is done
// in JS after a slightly larger fetch rather than in SQL (no DISTINCT ON
// helper on the query builder used elsewhere in this codebase — see
// server-config.js — so this stays consistent with how every other route
// here shapes results after a plain .select()).
app.get('/api/radio/recent', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  try {
    const { data, error } = await supabase
      .from('radio_recent_plays')
      .select('station_uuid, station_name, stream_url, homepage_url, favicon_url, country, tags, codec, bitrate, played_at')
      .eq('owner', req._radioSession.username)
      .order('played_at', { ascending: false })
      .limit(limit * 3); // over-fetch a bit to have enough left after de-duping by station
    if (error) throw new Error(error.message);

    const seen = new Set();
    const deduped = [];
    for (const row of (data || [])) {
      if (seen.has(row.station_uuid)) continue;
      seen.add(row.station_uuid);
      deduped.push(row);
      if (deduped.length >= limit) break;
    }

    return res.json({
      recent: deduped.map(r => ({
        stationUuid: r.station_uuid,
        name: r.station_name,
        streamUrl: r.stream_url,
        homepageUrl: r.homepage_url,
        faviconUrl: r.favicon_url,
        country: r.country,
        tags: r.tags,
        codec: r.codec,
        bitrate: r.bitrate,
        playedAt: r.played_at,
      })),
    });
  } catch (err) {
    console.error('[radio recent get]', err?.message || err);
    return res.status(500).json({ error: 'Could not load recently played stations.' });
  }
});

// POST /api/radio/recent   { token, station: {...} }
// Logs one play event. Called by the frontend right after a station
// actually starts playing (not on hover/search-result-render) — same
// timing as /api/radio/play, and typically fired alongside it.
app.post('/api/radio/recent', requireFeatureAllowed('radio'), requireRadioAccess, radioRateLimit, async (req, res) => {
  const { station } = req.body || {};
  const stationUuid = station?.stationUuid;
  const name = station?.name;
  const streamUrl = station?.streamUrl;
  if (!stationUuid || !name || !streamUrl) {
    return res.status(400).json({ error: 'station.stationUuid, station.name, and station.streamUrl are required.' });
  }
  try {
    const { error } = await supabase.from('radio_recent_plays').insert({
      owner: req._radioSession.username,
      station_uuid: String(stationUuid).slice(0, 200),
      station_name: String(name).slice(0, 300),
      stream_url: String(streamUrl).slice(0, 1000),
      homepage_url: station.homepageUrl ? String(station.homepageUrl).slice(0, 1000) : null,
      favicon_url: station.faviconUrl ? String(station.faviconUrl).slice(0, 1000) : null,
      country: station.country ? String(station.country).slice(0, 120) : null,
      tags: station.tags ? String(station.tags).slice(0, 500) : null,
      codec: station.codec ? String(station.codec).slice(0, 20) : null,
      bitrate: Number.isFinite(Number(station.bitrate)) ? Number(station.bitrate) : null,
    });
    if (error) throw new Error(error.message);
    return res.json({ logged: true });
  } catch (err) {
    console.error('[radio recent post]', err?.message || err);
    return res.status(500).json({ error: 'Could not log recently played station.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  🧪 EXPERIMENTAL LABS — Premium-only preview of upcoming FREQ features.
//  Backed by experimental_features (catalog), experimental_user_settings
//  (per-user toggle state + persona choice), experimental_feedback (log).
//
//  Every route below is gated by requirePremium — per "Protect every Labs
//  endpoint with requirePremium. Do not allow frontend-only protection,"
//  a non-Premium session gets a 403 straight from the API, not just a
//  blurred panel (same pattern as DJ BOOM / Real-Life Radio above).
//
//  Adding a new experiment is a database INSERT into experimental_features
//  (see the seed migration) — GET /api/labs/features reads that table
//  directly, so a new row appears in the UI with no frontend deploy.
//
//  GET  /api/labs                 → labs metadata (build badge info) + catalog + user state, in one call
//  GET  /api/labs/features        → catalog + this user's toggle state (no metadata wrapper)
//  POST /api/labs/toggle          { token, featureId, enabled, persona? }
//  POST /api/labs/feedback        { token, featureId, rating, feedback? }
// ═══════════════════════════════════════════════════════════════════════════════

const LABS_BUILD_INFO = { label: 'Internal Build', version: 'FREQ v2.8.0-dev' };

// Same rolling-window shape as radioRateLimit — Labs itself is just reads/
// writes against Supabase (cheap), but toggle/feedback spam from a client
// bug shouldn't be free to hammer the DB either.
const labsRateLimitHits = new Map();
function labsRateLimit(req, res, next) {
  const sess = req._premiumSession;
  const key = sess?.username || req.ip;
  const now = Date.now();
  const times = (labsRateLimitHits.get(key) || []).filter(t => now - t < 60_000);
  times.push(now);
  labsRateLimitHits.set(key, times);
  if (times.length > 60) {
    return res.status(429).json({ error: 'Too many requests — please slow down.' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of labsRateLimitHits) {
    const fresh = times.filter(t => now - t < 60_000);
    if (!fresh.length) labsRateLimitHits.delete(key); else labsRateLimitHits.set(key, fresh);
  }
}, 300_000);

function shapeLabsFeatureForClient(row, userSetting) {
  return {
    featureId: row.feature_id,
    featureName: row.feature_name,
    category: row.category,
    emoji: row.emoji,
    description: row.description,
    status: row.status,
    sortOrder: row.sort_order,
    whatsNew: row.whats_new,
    knownIssues: row.known_issues,
    version: row.version,
    lastUpdated: row.last_updated_note || row.updated_at,
    enabled: userSetting ? !!userSetting.enabled : !!row.default_enabled,
    persona: userSetting?.persona || null,
  };
}

// Loads the full active catalog plus this user's settings, merged into the
// client-facing shape above. Shared by GET /api/labs and GET /api/labs/features
// so both routes stay in sync by construction rather than by convention.
async function loadLabsFeaturesForUser(username) {
  const { data: features, error: featuresErr } = await supabase
    .from('experimental_features')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (featuresErr) throw new Error(featuresErr.message);

  const { data: settings, error: settingsErr } = await supabase
    .from('experimental_user_settings')
    .select('feature_id, enabled, persona, acknowledged_warning')
    .eq('username', username);
  if (settingsErr) throw new Error(settingsErr.message);

  const settingsByFeature = new Map((settings || []).map(s => [s.feature_id, s]));
  const acknowledgedWarning = (settings || []).some(s => s.acknowledged_warning);

  return {
    features: (features || []).map(row => shapeLabsFeatureForClient(row, settingsByFeature.get(row.feature_id))),
    acknowledgedWarning,
  };
}

// GET /api/labs?token=  — everything the Labs Home screen needs in one call:
// build badge metadata, the full catalog, and this user's toggle/persona
// state and warning-acknowledgement status.
app.get('/api/labs', requireFeatureAllowed('labs'), requirePremium, labsRateLimit, async (req, res) => {
  try {
    const { features, acknowledgedWarning } = await loadLabsFeaturesForUser(req._premiumSession.username);
    return res.json({ build: LABS_BUILD_INFO, features, acknowledgedWarning });
  } catch (err) {
    console.error('[labs get]', err?.message || err);
    return res.status(500).json({ error: 'Could not load Experimental Labs right now.' });
  }
});

// GET /api/labs/features?token=  — catalog + user state only, no build
// metadata wrapper. Kept separate from GET /api/labs so a future
// lighter-weight "just refresh the cards" call doesn't need to re-fetch
// the build badge every time.
app.get('/api/labs/features', requireFeatureAllowed('labs'), requirePremium, labsRateLimit, async (req, res) => {
  try {
    const { features } = await loadLabsFeaturesForUser(req._premiumSession.username);
    return res.json({ features });
  } catch (err) {
    console.error('[labs features get]', err?.message || err);
    return res.status(500).json({ error: 'Could not load experiments right now.' });
  }
});

// POST /api/labs/toggle   { token, featureId, enabled, persona?, acknowledgedWarning? }
// Upserts the user's per-feature toggle state. `persona` only does anything
// for feature_id === 'dj-boom-personalities' (validated against the known
// persona keys below) — sent as null/omitted for every other feature.
// `acknowledgedWarning`, when true, is written across this call only (not
// retroactively to other rows) — loadLabsFeaturesForUser treats "any row
// acknowledged" as "user has seen the warning," so one write is enough.
app.post('/api/labs/toggle', requireFeatureAllowed('labs'), requirePremium, labsRateLimit, async (req, res) => {
  const { featureId, enabled, persona, acknowledgedWarning } = req.body || {};
  const username = req._premiumSession.username;

  if (typeof featureId !== 'string' || !featureId.trim()) {
    return res.status(400).json({ error: 'featureId is required.' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean.' });
  }

  try {
    // Confirm the feature exists and is active before writing a settings
    // row for it — prevents orphaned settings rows for a typo'd or
    // deactivated featureId (the FK would also catch a truly nonexistent
    // one, but this gives a clean 404 instead of a raw constraint error).
    const { data: feature, error: featureErr } = await supabase
      .from('experimental_features')
      .select('feature_id, is_active, status')
      .eq('feature_id', featureId)
      .maybeSingle();
    if (featureErr) throw new Error(featureErr.message);
    if (!feature || !feature.is_active) {
      return res.status(404).json({ error: 'This experiment is not available.' });
    }
    // Mirrors the disabled toggle in the UI: a 'coming_soon' experiment has
    // nothing behind it yet, so it can't be turned on server-side either —
    // not just a frontend-only lock, which the brief explicitly calls out.
    if (feature.status === 'coming_soon' && enabled) {
      return res.status(409).json({ error: 'This experiment isn\'t available to enable yet.' });
    }

    let personaToStore = null;
    if (featureId === 'dj-boom-personalities' && typeof persona === 'string' && DJ_BOOM_PERSONALITIES[persona]) {
      personaToStore = persona;
    }

    const patch = {
      username,
      feature_id: featureId,
      enabled,
      updated_at: new Date().toISOString(),
    };
    if (personaToStore) patch.persona = personaToStore;
    if (acknowledgedWarning === true) patch.acknowledged_warning = true;

    const { data, error } = await supabase
      .from('experimental_user_settings')
      .upsert(patch, { onConflict: 'username,feature_id' })
      .select('feature_id, enabled, persona, acknowledged_warning')
      .single();
    if (error) throw new Error(error.message);

    return res.json({
      featureId: data.feature_id,
      enabled: !!data.enabled,
      persona: data.persona || null,
      acknowledgedWarning: !!data.acknowledged_warning,
    });
  } catch (err) {
    console.error('[labs toggle]', err?.message || err);
    return res.status(500).json({ error: 'Could not save that setting. Please try again.' });
  }
});

// POST /api/labs/feedback   { token, featureId, rating: 'love_it'|'needs_work', feedback? }
// Every submission is its own row (see migration comment) — this is a log,
// not a single mutable per-user rating.
app.post('/api/labs/feedback', requireFeatureAllowed('labs'), requirePremium, labsRateLimit, async (req, res) => {
  const { featureId, rating, feedback } = req.body || {};
  const username = req._premiumSession.username;

  if (typeof featureId !== 'string' || !featureId.trim()) {
    return res.status(400).json({ error: 'featureId is required.' });
  }
  if (rating !== 'love_it' && rating !== 'needs_work') {
    return res.status(400).json({ error: "rating must be 'love_it' or 'needs_work'." });
  }
  const cleanFeedback = typeof feedback === 'string' && feedback.trim() ? feedback.trim().slice(0, 1000) : null;

  try {
    const { data: feature, error: featureErr } = await supabase
      .from('experimental_features')
      .select('feature_id')
      .eq('feature_id', featureId)
      .maybeSingle();
    if (featureErr) throw new Error(featureErr.message);
    if (!feature) return res.status(404).json({ error: 'This experiment is not available.' });

    const { error } = await supabase.from('experimental_feedback').insert({
      username,
      feature_id: featureId,
      rating,
      feedback: cleanFeedback,
    });
    if (error) throw new Error(error.message);

    return res.json({ submitted: true });
  } catch (err) {
    console.error('[labs feedback]', err?.message || err);
    return res.status(500).json({ error: 'Could not submit feedback. Please try again.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PROFILES — public-facing profile data, backed by the `profiles` table
//  (separate from `accounts`, see dbCreateProfile comment — credentials
//  never live anywhere a "get public profile" code path could reach them)
//
//  GET   /api/profiles/:username   → { username, displayName, bio, isPublic }
//                                     404 if no profile, or profile is private
//                                     and requester isn't its owner
//  PATCH /api/profiles/me          { token, bio?, displayName?, isPublic? }
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/profiles/:username', async (req, res) => {
  const key = normalizeUsername(req.params.username);
  if (!key) return res.status(400).json({ error: 'Username required.' });
  try {
    const profile = await dbGetProfile(key);
    if (!profile) return res.status(404).json({ error: 'No profile found for that username.' });

    // Private profiles are only visible to their own owner — checked against
    // the requester's session, never against anything the client merely
    // claims. An expired/missing token on a private profile request is
    // treated the same as "not the owner": a 404, not a 401, so a private
    // profile's existence can't be probed by an unauthenticated request.
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    const sess  = await dbGetSession(token);
    if (!profile.is_public) {
      if (!sess || sess.username !== key) {
        return res.status(404).json({ error: 'No profile found for that username.' });
      }
    }

    // isFollowing is relative to whoever's asking — null (not false) for an
    // unauthenticated request, so the frontend can distinguish "you aren't
    // following them" from "we don't know, you're not signed in" and hide
    // the follow button rather than show it in a misleading state.
    const isFollowing = (sess && sess.username !== key) ? await dbIsFollowing(sess.username, key) : null;

    // isArtist/artistSlug drive the profile page's "Become an Artist" CTA
    // vs "View Artist Page" link — a profile read is the natural place a
    // visitor discovers someone has an artist page, so resolving it here
    // (one indexed lookup) beats making the frontend fire a second request
    // just to find out.
    const artist = await dbGetArtistByAccount(key);
    const artistStats = artist ? await dbGetLiveArtistStats(artist.id, await dbGetArtistStats(artist.id)) : null;
    const tracksUploaded = artist
      ? ((await supabase.from('tracks')
        .select('*', { count: 'exact', head: true })
        .eq('artist_id', artist.id)
        .eq('is_published', true)).count || 0)
      : 0;
    const profileCosmetics = (await dbGetMusiShopActiveItems(key))
      .filter(active => [
        'profile_frame', 'profile_background', 'username_color',
        'username_effect', 'profile_badge', 'profile_banner_effect',
        'status_emoji', 'favorite_genre_badge', 'milestone_badge',
        'achievement_showcase',
      ].includes(active.slot))
      .reduce((result, active) => {
        const item = active.item || {};
        result[active.slot] = {
          sku: active.sku,
          selectionKey: active.selectionKey,
          assetKey: item.assetKey || null,
          name: item.name || null,
          animated: item.animated === true,
          color: item.color || null,
          label: item.selectionLabels?.[active.selectionKey] || item.cosmeticLabel || null,
          icon: item.cosmeticIcon || null,
        };
        return result;
      }, {});

    return res.json({
      username:            profile.username,
      displayName:         profile.display_name,
      avatarUrl:           profile.avatar_url,
      coverImageUrl:       profile.cover_image_url,
      bio:                 profile.bio,
      isPublic:            profile.is_public,
      joinedAt:            profile.created_at,
      followerCount:       profile.follower_count,
      followingCount:      profile.following_count,
      publicPlaylistCount: profile.public_playlist_count,
      totalPlays:          Number(profile.total_plays) || 0,
      totalLikesReceived:  profile.total_likes_received || 0,
      isArtist:            !!artist,
      artistSlug:          artist ? artist.slug : null,
      artistId:            artist ? artist.id : null,
      artistFollowerCount: artistStats ? artistStats.followerCount : 0,
      artistTotalPlays:    artistStats ? artistStats.totalPlays : 0,
      tracksUploaded,
      cosmetics: profileCosmetics,
      isFollowing,
      isSelf: !!(sess && sess.username === key),
    });
  } catch (err) {
    console.error('[profiles get]', err);
    return res.status(500).json({ error: 'Could not load profile.' });
  }
});

app.patch('/api/profiles/me', rateLimit, async (req, res) => {
  const { token, bio, displayName, isPublic } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });

  const patch = {};
  if (bio !== undefined) {
    if (typeof bio !== 'string') return res.status(400).json({ error: '"bio" must be a string.' });
    const trimmed = bio.trim();
    if (trimmed.length > 280) return res.status(400).json({ error: 'Bio must be 280 characters or fewer.' });
    patch.bio = trimmed || null;
  }
  if (displayName !== undefined) {
    const trimmed = String(displayName).trim().slice(0, 60);
    if (!trimmed) return res.status(400).json({ error: 'Display name cannot be empty.' });
    if (isProtectedFreqNoticeIdentity(trimmed)) return res.status(400).json({ error: 'That identity is reserved for official FREQ Notices.' });
    patch.display_name = trimmed;
  }
  if (isPublic !== undefined) {
    if (typeof isPublic !== 'boolean') return res.status(400).json({ error: '"isPublic" must be a boolean.' });
    patch.is_public = isPublic;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });

  try {
    const updated = await dbUpdateProfile(sess.username, patch);
    return res.json({
      username:    updated.username,
      displayName: updated.display_name,
      bio:         updated.bio,
      isPublic:    updated.is_public,
    });
  } catch (err) {
    console.error('[profiles patch]', err);
    return res.status(500).json({ error: 'Could not update profile.' });
  }
});

// Profile avatar/cover upload — multipart, mirrors the cloud-files upload
// pattern but targets the public `media` bucket via uploadMediaImage()
// instead of the private cloud-audio bucket. Ownership is always resolved
// from the session token, never from anything the client claims, same
// discipline as every other mutating route in this file.
app.post('/api/profiles/me/avatar', rateLimit, imageUpload.single('file'), requireFeatureAllowed('uploads'), async (req, res) => {
  const sess = await dbGetSession(req.body?.token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading.', emailVerificationRequired: true });
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  try {
    const avatarUrl = await uploadMediaImage(req.file, 'avatars', sess.username);
    await dbUpdateProfile(sess.username, { avatar_url: avatarUrl });
    return res.json({ avatarUrl });
  } catch (err) {
    console.error('[profile avatar upload]', err);
    return res.status(500).json({ error: 'Could not upload avatar.' });
  }
});

app.post('/api/profiles/me/cover', rateLimit, imageUpload.single('file'), requireFeatureAllowed('uploads'), async (req, res) => {
  const sess = await dbGetSession(req.body?.token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading.', emailVerificationRequired: true });
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  try {
    const coverImageUrl = await uploadMediaImage(req.file, 'covers', sess.username);
    await dbUpdateProfile(sess.username, { cover_image_url: coverImageUrl });
    return res.json({ coverImageUrl });
  } catch (err) {
    console.error('[profile cover upload]', err);
    return res.status(500).json({ error: 'Could not upload cover image.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FOLLOWS — public, no RLS write policy (server-only via service key).
//  follower_count / following_count on `profiles` stay in sync via the
//  trg_follow_counts Postgres trigger — never recomputed here.
//
//  POST   /api/follows/:username             { token }  → follow
//  DELETE /api/follows/:username              { token }  → unfollow
//  GET    /api/follows/:username/followers    ?limit=&offset=
//  GET    /api/follows/:username/following    ?limit=&offset=
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/follows/:username', followRateLimit, requireFeatureAllowed('following'), async (req, res) => {
  const target = normalizeUsername(req.params.username);
  const sess = req._followSession; // resolved by followRateLimit — avoids a second dbGetSession round-trip
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!target) return res.status(400).json({ error: 'Username required.' });
  if (sess.username === target) return res.status(400).json({ error: "You can't follow yourself." });

  try {
    const account = await dbGetAccount(target);
    if (!account) return res.status(404).json({ error: 'No account found with that username.' });

    const created = await dbFollowUser(sess.username, target);
    if (created) {
      dbWriteActivity('follow', sess.username, target, {
        followedUsername: target,
      });
    }
    const profile = await dbGetProfile(target);
    return res.status(created ? 201 : 200).json({
      following: true,
      followerCount: profile?.follower_count ?? null,
    });
  } catch (err) {
    console.error('[follows create]', err);
    return res.status(500).json({ error: 'Could not follow user.' });
  }
});

app.delete('/api/follows/:username', followRateLimit, async (req, res) => {
  const target = normalizeUsername(req.params.username);
  const sess = req._followSession; // resolved by followRateLimit — avoids a second dbGetSession round-trip
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!target) return res.status(400).json({ error: 'Username required.' });

  try {
    await dbUnfollowUser(sess.username, target);
    const profile = await dbGetProfile(target);
    return res.json({
      following: false,
      followerCount: profile?.follower_count ?? null,
    });
  } catch (err) {
    console.error('[follows delete]', err);
    return res.status(500).json({ error: 'Could not unfollow user.' });
  }
});

// Followers/following lists only ever show public profiles, plus the
// requester's own profile if they happen to appear in their own list (e.g.
// viewing who follows you includes a private-profile follower's *public*
// fields only — we never leak someone's private bio/displayName choice
// through someone else's follower list. Simplest correct rule: filter to
// is_public, full stop, even for the list owner viewing their own followers.
app.get('/api/follows/:username/followers', requireFeatureAllowed('following', { allowAnonymous: true }), async (req, res) => {
  const key = normalizeUsername(req.params.username);
  if (!key) return res.status(400).json({ error: 'Username required.' });
  const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const rows = await dbGetFollowers(key, { limit, offset });
    return res.json({
      users: rows.map(p => ({
        username: p.username, displayName: p.display_name, bio: p.bio,
      })),
    });
  } catch (err) {
    console.error('[follows followers]', err);
    return res.status(500).json({ error: 'Could not load followers.' });
  }
});

app.get('/api/follows/:username/following', requireFeatureAllowed('following', { allowAnonymous: true }), async (req, res) => {
  const key = normalizeUsername(req.params.username);
  if (!key) return res.status(400).json({ error: 'Username required.' });
  const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const rows = await dbGetFollowing(key, { limit, offset });
    return res.json({
      users: rows.map(p => ({
        username: p.username, displayName: p.display_name, bio: p.bio,
      })),
    });
  } catch (err) {
    console.error('[follows following]', err);
    return res.status(500).json({ error: 'Could not load following.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PLAYLISTS v2 — relational playlists backing Public/Shared Playlists.
//  Separate from the legacy `playlists` JSON-blob table used by
//  /api/auth/sync — that table still owns the in-app queue/library sync
//  for now; new playlists created here are independent until a deliberate
//  migration/cutover, not silently merged with the old blob.
//
//  RLS on playlists_v2/playlist_tracks already grants public SELECT for
//  is_public=true rows (and their tracks) to the anon key — every route
//  below still goes through the service role, but a public playlist is
//  also directly readable via client-side Supabase calls if that's ever
//  useful for a future perf optimization.
//
//  POST   /api/playlists                         { token, name, description?, isPublic? }
//  GET    /api/playlists/:id                     ?token=   → 404 if private and not owner
//  PATCH  /api/playlists/:id                      { token, name?, description?, isPublic? }
//  DELETE /api/playlists/:id                      { token }
//  GET    /api/playlists/mine                     ?token=
//  GET    /api/profiles/:username/playlists       (public playlists only)
//
//  POST   /api/playlists/:id/tracks               { token, trackData }
//  DELETE /api/playlists/:id/tracks/:rowId        { token }
// ═══════════════════════════════════════════════════════════════════════════════

const PLAYLIST_NAME_MAX = 80;
const PLAYLIST_DESC_MAX = 280;

function validatePlaylistPatch(body) {
  const patch = {};
  if (body.name !== undefined) {
    const trimmed = String(body.name).trim().slice(0, PLAYLIST_NAME_MAX);
    if (!trimmed) return { error: 'Playlist name cannot be empty.' };
    patch.name = trimmed;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return { error: '"description" must be a string or null.' };
    }
    const trimmed = (body.description || '').trim();
    if (trimmed.length > PLAYLIST_DESC_MAX) {
      return { error: `Description must be ${PLAYLIST_DESC_MAX} characters or fewer.` };
    }
    patch.description = trimmed || null;
  }
  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== 'boolean') return { error: '"isPublic" must be a boolean.' };
    patch.is_public = body.isPublic;
  }
  return { patch };
}

app.post('/api/playlists', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });

  const name = String(req.body.name || '').trim().slice(0, PLAYLIST_NAME_MAX);
  if (!name) return res.status(400).json({ error: 'Playlist name is required.' });

  const { error: descErr, patch } = validatePlaylistPatch({ description: req.body.description, isPublic: req.body.isPublic });
  if (descErr) return res.status(400).json({ error: descErr });

  try {
    const playlist = await dbCreatePlaylist(sess.username, {
      name, description: patch.description, isPublic: patch.is_public,
    });
    if (playlist.is_public) {
      dbWriteActivity('playlist_created', sess.username, null, {
        playlistId: playlist.id, playlistName: playlist.name,
      });
    }
    return res.status(201).json({
      id: playlist.id, owner: playlist.owner, name: playlist.name,
      description: playlist.description, isPublic: playlist.is_public,
      trackCount: playlist.track_count,
    });
  } catch (err) {
    console.error('[playlists create]', err);
    return res.status(500).json({ error: 'Could not create playlist.' });
  }
});

app.get('/api/playlists/mine', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const rows = await dbGetUserPlaylists(sess.username);
    return res.json({
      playlists: rows.map(p => ({
        id: p.id, name: p.name, description: p.description,
        isPublic: p.is_public, trackCount: p.track_count, likeCount: p.like_count || 0,
        updatedAt: p.updated_at,
      })),
    });
  } catch (err) {
    console.error('[playlists mine]', err);
    return res.status(500).json({ error: 'Could not load your playlists.' });
  }
});

// Private playlist + non-owner request → 404, not 403, matching the
// profiles pattern exactly: existence of a private playlist must not be
// distinguishable from "no playlist with that id" by an unauthenticated
// or non-owner request.

app.patch('/api/playlists/:id', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });

  const { error, patch } = validatePlaylistPatch(req.body);
  if (error) return res.status(400).json({ error });
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });

  try {
    const updated = await dbUpdatePlaylistMeta(req.params.id, sess.username, patch);
    if (!updated) return res.status(404).json({ error: 'Playlist not found.' });
    if (updated.is_public) {
      dbWriteActivity('playlist_updated', sess.username, null, {
        playlistId: updated.id, playlistName: updated.name,
      });
    }
    return res.json({
      id: updated.id, name: updated.name, description: updated.description,
      isPublic: updated.is_public, trackCount: updated.track_count,
    });
  } catch (err) {
    console.error('[playlists patch]', err);
    return res.status(500).json({ error: 'Could not update playlist.' });
  }
});

app.delete('/api/playlists/:id', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    await dbDeletePlaylist(req.params.id, sess.username);
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[playlists delete]', err);
    return res.status(500).json({ error: 'Could not delete playlist.' });
  }
});

app.post('/api/playlists/:id/tracks', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  const { trackData } = req.body;
  if (!trackData || typeof trackData !== 'object') {
    return res.status(400).json({ error: '"trackData" object is required.' });
  }
  try {
    // Ownership OR editor-role check — editors can add tracks too.
    // dbAddTrackToPlaylist's track_count update is owner-scoped, so we pass
    // the real owner's username for that UPDATE; `addedBy` captures who
    // actually added the track for display in the collaborator track list.
    const playlist = await dbGetPlaylist(req.params.id);
    const editorRole = playlist && sess && (
      playlist.owner === sess.username ||
      await dbGetCollabRole(req.params.id, sess.username) === 'editor'
    );
    if (!playlist || !editorRole) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }
    const row = await dbAddTrackToPlaylist(req.params.id, playlist.owner, trackData, sess.username);
    const trackTitle = trackData.title || trackData.id || 'Untitled';
    // Emit activity when a collaborator (non-owner) adds a track, or it's a public playlist
    if (playlist.is_public || sess.username !== playlist.owner) {
      dbWriteActivity('track_added', sess.username, playlist.owner !== sess.username ? playlist.owner : null, {
        playlistId: playlist.id, playlistName: playlist.name,
        trackTitle, trackPlatform: trackData.platform || null,
      });
    }
    // Edit log: always recorded regardless of public/owner, since this
    // feeds "Romeo added Stronger"-style live activity + undo for every
    // collaborative playlist, not just public ones.
    dbLogPlaylistEdit(playlist.id, sess.username, 'add', { trackTitle, rowId: row.id });
    broadcastToPlaylist(playlist.id, {
      type: 'edit', payload: { action: 'add', actor: sess.username, trackTitle, rowId: row.id },
    });
    return res.status(201).json({ rowId: row.id, position: row.position });
  } catch (err) {
    console.error('[playlists add track]', err);
    return res.status(500).json({ error: 'Could not add track.' });
  }
});

app.delete('/api/playlists/:id/tracks/:rowId', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const playlist = await dbGetPlaylist(req.params.id);
    const editorRole = playlist && sess && (
      playlist.owner === sess.username ||
      await dbGetCollabRole(req.params.id, sess.username) === 'editor'
    );
    if (!playlist || !editorRole) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }
    const deletedRow = await dbRemoveTrackFromPlaylist(req.params.id, playlist.owner, req.params.rowId);
    const trackTitle = deletedRow?.track_data?.title || deletedRow?.track_data?.id || 'a track';

    // Previously only 'track_added' ever reached activity_feed — removals
    // were silent. Matching track_added's own gating (public playlist, or
    // a non-owner collaborator acting) keeps behavior symmetric rather than
    // introducing a new policy.
    if (deletedRow && (playlist.is_public || sess.username !== playlist.owner)) {
      dbWriteActivity('track_removed', sess.username, playlist.owner !== sess.username ? playlist.owner : null, {
        playlistId: playlist.id, playlistName: playlist.name, trackTitle,
      });
    }
    if (deletedRow) {
      dbLogPlaylistEdit(playlist.id, sess.username, 'remove', {
        trackTitle,
        rowId: deletedRow.id,
        snapshot: { track_data: deletedRow.track_data, position: deletedRow.position },
      });
      broadcastToPlaylist(playlist.id, {
        type: 'edit', payload: { action: 'remove', actor: sess.username, trackTitle, rowId: deletedRow.id },
      });
    }
    // Conflict resolution: if two editors remove the same track at nearly
    // the same time, the second DELETE simply finds no matching row
    // (dbRemoveTrackFromPlaylist's .maybeSingle() returns null) rather than
    // erroring — first-writer-wins, and the second caller's client already
    // gets the same "tracks changed" SSE event as everyone else, so nothing
    // is silently out of sync. `alreadyRemoved` lets the frontend skip
    // showing its own redundant "you removed X" toast in that case.
    return res.json({ removed: true, alreadyRemoved: !deletedRow });
  } catch (err) {
    console.error('[playlists remove track]', err);
    return res.status(500).json({ error: 'Could not remove track.' });
  }
});

// Undo a recent edit-log entry (add or remove). Editor-role gated, same as
// the add/remove routes themselves — undo is just "perform the inverse
// write," so it needs the same permission as the forward write would.
// A 'remove' entry is undone by re-inserting the snapshotted track_data at
// the end of the current list (not its original position — the list has
// likely moved on, and silently reshuffling everyone else's position on an
// undo would be more surprising than appending). An 'add' entry is undone
// by deleting the row it created, if it's still there untouched.
app.post('/api/playlists/:id/edit-log/:entryId/undo', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const playlist = await dbGetPlaylist(req.params.id);
    const editorRole = playlist && (
      playlist.owner === sess.username ||
      await dbGetCollabRole(req.params.id, sess.username) === 'editor'
    );
    if (!playlist || !editorRole) return res.status(404).json({ error: 'Playlist not found.' });

    const entry = await dbGetEditLogEntry(req.params.entryId);
    if (!entry || entry.playlist_id !== playlist.id) {
      return res.status(404).json({ error: 'Edit not found.' });
    }
    if (entry.reverted_at) return res.status(409).json({ error: 'This edit was already undone.' });

    if (entry.action === 'remove') {
      if (!entry.snapshot?.track_data) return res.status(400).json({ error: 'Nothing to restore for this edit.' });
      const restored = await dbAddTrackToPlaylist(playlist.id, playlist.owner, entry.snapshot.track_data, sess.username);
      await dbMarkEditReverted(entry.id);
      broadcastToPlaylist(playlist.id, {
        type: 'edit', payload: { action: 'add', actor: sess.username, trackTitle: entry.track_title, rowId: restored.id, isUndo: true },
      });
      return res.json({ undone: true, restoredRowId: restored.id });
    }

    if (entry.action === 'add') {
      await dbRemoveTrackFromPlaylist(playlist.id, playlist.owner, entry.row_id);
      await dbMarkEditReverted(entry.id);
      broadcastToPlaylist(playlist.id, {
        type: 'edit', payload: { action: 'remove', actor: sess.username, trackTitle: entry.track_title, rowId: entry.row_id, isUndo: true },
      });
      return res.json({ undone: true });
    }

    return res.status(400).json({ error: 'Unsupported edit type.' });
  } catch (err) {
    console.error('[playlists undo edit]', err);
    return res.status(500).json({ error: 'Could not undo edit.' });
  }
});

// GET /api/playlists/:id/edit-log — recent add/remove history for the
// playlist viewer's "Recent edits" panel. Same visibility rule as the
// collaborators list: owner, any accepted collaborator, or (read-only)
// anyone viewing a public playlist.
app.get('/api/playlists/:id/edit-log', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  const playlist = await dbGetPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
  const role = sess ? await dbGetCollabRole(req.params.id, sess.username) : null;
  const isOwner = !!(sess && sess.username === playlist.owner);
  if (!isOwner && !role && !playlist.is_public) return res.status(404).json({ error: 'Playlist not found.' });
  const history = await dbGetPlaylistEditHistory(req.params.id);
  return res.json({
    isEditor: isOwner || role === 'editor',
    entries: history.map(h => ({
      id: h.id, actor: h.actor, action: h.action, trackTitle: h.track_title,
      rowId: h.row_id, reverted: !!h.reverted_at, createdAt: h.created_at,
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TASTE GRAPH
//  GET /api/taste   ?token=   → { hasEnoughHistory, becauseYouListened, similarArtists,
//                                 similarPlaylists, trendingInTaste, recentlyRediscovered,
//                                 recentlyForgotten, recentlySkipped }
//
//  Auth required (recommendations are inherently per-user — there's no
//  meaningful anonymous version of "your taste"), but NOT Premium-gated:
//  this reads the same track_plays/track_likes/artist_followers data every
//  signed-in listener already generates just by using FREQ normally, same
//  "available to every account" spirit as Discover and Charts. Similar
//  Artists additionally widens its genre seed using radio_favorites/
//  radio_recent_plays TAGS ONLY (see dbTasteRadioGenreHints) — those two
//  tables happen to be Premium-only to WRITE, but nothing here requires
//  Premium to read a signal that already exists on the account.
//
//  All six modules are computed in parallel — they're independent reads
//  over different (or differently-windowed) slices of the same handful of
//  tables, not a pipeline where one depends on another's output, so there's
//  no reason to serialize them.
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/taste', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Sign in to see your Taste Graph.' });
  try {
    // Part 3: resolved once per request and threaded through every
    // recommendation module below (similarArtists excluded — it returns
    // artists, not tracks, and has no content_rating of its own to check).
    const allowedRatings = await getAllowedRatingsForRequest(req);
    // Part 6: same one-resolve-per-request pattern for blocked
    // artist/genre/track — null for non-child requests, which every taste
    // module already treats as "nothing to filter" via tasteFilterByAllowedRatings
    // and isTrackBlockedByRestrictions's own null-checks.
    const restrictions = await getFamilyRestrictionsForRequest(req);

    const recentPlays = await dbTasteGetUserPlays(sess.username, { days: 90, limit: 20 });
    // Taste Graph still uses raw history as its private recommendation
    // signal, but the newly surfaced Continue Listening list is a Discovery
    // UI output and therefore respects the same rating/block filters as
    // every other visible Discovery module.
    const visibleRecentPlays = await tasteFilterByAllowedRatings(recentPlays, allowedRatings, undefined, restrictions);
    const recentSeen = new Set();
    const recentlyPlayed = [];
    for (const row of visibleRecentPlays) {
      if (!row.tracks?.id || recentSeen.has(row.tracks.id)) continue;
      recentSeen.add(row.tracks.id);
      recentlyPlayed.push({ ...tasteShapeTrack(row.tracks), playedAt: row.played_at });
      if (recentlyPlayed.length >= 12) break;
    }
    const hasEnoughHistory = recentPlays.length >= TASTE_MIN_HISTORY_ROWS;
    if (!hasEnoughHistory) {
      // Cheap, honest early return — every module below needs at least
      // TASTE_MIN_HISTORY_ROWS to produce anything meaningful, so there's
      // no point firing ~6 more queries just to get empty arrays back.
      return res.json({
        hasEnoughHistory: false,
        becauseYouListened: [], similarArtists: [], similarPlaylists: [],
        trendingInTaste: [], recentlyRediscovered: [], recentlyForgotten: [], recentlySkipped: [],
        recentlyPlayed,
      });
    }

    const [
      becauseYouListened, similarArtists, similarPlaylists,
      trendingInTaste, recentlyRediscovered, recentlyForgotten, recentlySkipped,
    ] = await Promise.all([
      dbTasteBecauseYouListened(sess.username, { allowedRatings, restrictions }),
      dbTasteSimilarArtists(sess.username),
      dbTasteSimilarPlaylists(sess.username),
      dbTasteTrendingInTaste(sess.username, { allowedRatings, restrictions }),
      dbTasteRecentlyRediscovered(sess.username, { allowedRatings, restrictions }),
      dbTasteRecentlyForgotten(sess.username, { allowedRatings, restrictions }),
      dbTasteRecentlySkipped(sess.username, { allowedRatings, restrictions }),
    ]);

    return res.json({
      hasEnoughHistory: true,
      becauseYouListened, similarArtists, similarPlaylists,
      trendingInTaste, recentlyRediscovered, recentlyForgotten, recentlySkipped,
      recentlyPlayed,
    });
  } catch (err) {
    console.error('[taste graph]', err);
    return res.status(500).json({ error: 'Could not load your Taste Graph right now.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PLAYLIST LIKES
//  POST    /api/playlists/:id/like     { token }  → like (idempotent)
//  DELETE  /api/playlists/:id/like     { token }  → unlike (idempotent)
//  GET     /api/playlists/liked        ?token=    → playlists I've liked
//
//  Liking is only permitted on playlists the caller can actually see —
//  public playlists for anyone, or private/shared playlists for the owner
//  and accepted collaborators — using the exact same canView logic as
//  GET /api/playlists/:id, so a like can never be used to fish for whether
//  a private playlist id exists.
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/playlists/:id/like', likeRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const playlist = await dbGetPlaylist(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

    const isOwner = playlist.owner === sess.username;
    const collabRole = !isOwner ? await dbGetCollabRole(req.params.id, sess.username) : null;
    const canView = isOwner || collabRole !== null || playlist.is_public;
    if (!canView) return res.status(404).json({ error: 'Playlist not found.' });

    const likeCount = await dbLikePlaylist(req.params.id, sess.username);
    if (playlist.is_public && !isOwner) {
      dbWriteActivity('playlist_liked', sess.username, playlist.owner, {
        playlistId: playlist.id, playlistName: playlist.name,
      });
    }
    return res.json({ liked: true, likeCount });
  } catch (err) {
    console.error('[playlists like]', err);
    return res.status(500).json({ error: 'Could not like playlist.' });
  }
});

app.delete('/api/playlists/:id/like', likeRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const likeCount = await dbUnlikePlaylist(req.params.id, sess.username);
    return res.json({ liked: false, likeCount });
  } catch (err) {
    console.error('[playlists unlike]', err);
    return res.status(500).json({ error: 'Could not unlike playlist.' });
  }
});

// Pending invites waiting for the current user (MUST be before :id routes) ----
app.get('/api/playlists/invites/mine', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const invites = await dbGetMyPendingInvites(sess.username);
    return res.json({ invites });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load invites.' });
  }
});

app.get('/api/playlists/liked', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const playlists = await dbGetLikedPlaylists(sess.username);
    return res.json({ playlists });
  } catch (err) {
    console.error('[playlists liked]', err);
    return res.status(500).json({ error: 'Could not load liked playlists.' });
  }
});

// Playlists shared with the current user (accepted collabs) -------------------
app.get('/api/playlists/shared-with-me', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const playlists = await dbGetSharedWithMe(sess.username);
    return res.json({ playlists });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load shared playlists.' });
  }
});

app.get('/api/playlists/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const playlist = await dbGetPlaylist(id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    const sess  = await dbGetSession(token);
    const isOwner = !!(sess && sess.username === playlist.owner);
    const collabRole = (!isOwner && sess)
      ? await dbGetCollabRole(id, sess.username)
      : null;
    const isEditor = isOwner || collabRole === 'editor';
    const canView  = isOwner || collabRole !== null || playlist.is_public;

    if (!canView) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const tracks = await dbGetPlaylistTracks(id);
    const visibleTracks = await filterPlaylistTracksForRequest(req, tracks);
    let collaborators = [];
    let pendingInvites = [];
    if (isOwner) {
      [collaborators, pendingInvites] = await Promise.all([
        dbGetCollaborators(id),
        dbGetPendingInvites(id),
      ]);
    } else if (collabRole) {
      collaborators = await dbGetCollaborators(id);
    }
    const likedByMe = sess ? await dbHasLiked(id, sess.username) : false;
    return res.json({
      id: playlist.id, owner: playlist.owner, name: playlist.name,
      description: playlist.description, isPublic: playlist.is_public,
      trackCount: visibleTracks.length, isOwner,
      likeCount: playlist.like_count || 0, likedByMe,
      collabRole: collabRole || null, isEditor,
      collaborators, pendingInvites,
      tracks: visibleTracks.map(t => ({
        rowId: t.id, ...t.track_data, addedBy: t.added_by, addedAt: t.added_at,
      })),
    });
  } catch (err) {
    console.error('[playlists get]', err);
    return res.status(500).json({ error: 'Could not load playlist.' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
//  COMMUNITY CHARTS — play tracking + rankings
//  POST /api/plays                { originalUrl, platform?, title?, token?, trackId?, previousPlay? }
//  GET  /api/charts/tracks         ?window=all|7d&limit=
//
//  Logging a play does NOT require auth — anonymous listeners count toward
//  Charts too, same as a real radio audience. token is optional; when
//  present and valid it attaches a username to the track_plays row and
//  (new, Taste Graph) is required for previousPlay to be honored — the
//  cooldown key also follows a signed-in listener across IP changes. When
//  absent, the IP is used as the cooldown key instead.
//
//  previousPlay?: { rowId, completed } — best-effort report of how the
//  PREVIOUS track (not this one) actually ended: reached natural completion
//  vs abandoned early. See logPlay() client-side and dbMarkPlayOutcome
//  server-side. Response includes playRowId so the client can report THIS
//  play's outcome later, when the track after it starts.
//
//  This route deliberately sits on the generic per-IP `rateLimit` (120/min)
//  rather than a bespoke limiter — same tier as /api/resolve and
//  /api/import, the other anonymous-allowed write-ish endpoints in this
//  file. The real anti-gaming guard is the 30s per-(track,listener)
//  cooldown inside dbLogPlay, not this outer rate limit.
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/plays', rateLimit, async (req, res) => {
  const {
    originalUrl, platform, title, artist, token, trackId, source, previousPlay,
    listenToEarn, mpDeviceId, mpPlayPageId, mpPlayToken,
  } = req.body || {};
  if (!originalUrl || typeof originalUrl !== 'string') {
    return res.status(400).json({ error: '"originalUrl" is required.' });
  }
  // Validated against the same PLAY_SOURCES list the DB CHECK constraint
  // uses, so an unrecognized/absent value falls back to 'direct' here
  // rather than reaching dbLogPlay and relying on its own fallback —
  // belt-and-suspenders since this is client-supplied input.
  const safeSource = PLAY_SOURCES.includes(source) ? source : 'direct';
  // Published FREQ tracks send their real tracks.id alongside originalUrl —
  // see dbGetOrCreateTrack's comment for why originalUrl alone can't be
  // trusted to identify these rows. Must be a syntactically valid uuid or
  // we ignore it and fall back to the legacy originalUrl flow, rather than
  // letting a malformed value reach the database as a no-op filter.
  const publishedTrackId = (typeof trackId === 'string' && UUID_RE.test(trackId)) ? trackId : null;
  try {
    const sess = token ? await dbGetSession(token) : null;
    const listenerKey = sess ? sess.username : (req.ip || req.connection.remoteAddress || 'unknown');
    const mpPlayAttempt = listenToEarn === true && sess
      ? registerMpPlayAttempt(sess.username, mpPlayPageId, mpPlayToken)
      : null;

    // For cloud: URLs (published FREQ tracks), the artist name is already on
    // the tracks row. If the caller didn't supply it (the frontend only
    // sends item.artist which is the ID3 field, not always set on cloud items),
    // we look it up from the existing tracks row so artist_id backfill never
    // silently fails for published music. Looked up by trackId when we have
    // one — the same originalUrl-mismatch that broke play counting would
    // also make this lookup silently fail otherwise.
    let artistName = (typeof artist === 'string' && artist.trim()) ? artist.trim() : null;
    if (!artistName && publishedTrackId) {
      const { data: existingTrack } = await supabase
        .from('tracks').select('artist_name').eq('id', publishedTrackId).maybeSingle();
      if (existingTrack?.artist_name) artistName = existingTrack.artist_name;
    } else if (!artistName && typeof originalUrl === 'string' && originalUrl.startsWith('cloud:')) {
      const { data: existingTrack } = await supabase
        .from('tracks').select('artist_name').eq('original_url', originalUrl).maybeSingle();
      if (existingTrack?.artist_name) artistName = existingTrack.artist_name;
    }

    const result = await dbLogPlay(originalUrl, {
      platform: platform || null,
      title: title || null,
      artistName,
      username: sess ? sess.username : null,
      listenerKey,
      publishedTrackId,
      source: safeSource,
    });
    if (!result) return res.status(500).json({ error: 'Could not log play.' });

    // Taste Graph completion signal for the PREVIOUS track, piggybacked on
    // this request rather than a dedicated endpoint — see logPlay()
    // client-side for why this is the natural place to learn it (the
    // client only knows how a track ended once the NEXT one starts). Only
    // trusted for signed-in listeners reporting on their OWN previous row
    // (dbMarkPlayOutcome re-checks the username server-side too), and only
    // a well-formed uuid + boolean is accepted — silently ignored otherwise
    // rather than erroring, since this is a best-effort enrichment of an
    // already-successful play log, not something the response should fail
    // over.
    if (sess && previousPlay && UUID_RE.test(previousPlay.rowId || '') && typeof previousPlay.completed === 'boolean') {
      dbMarkPlayOutcome(previousPlay.rowId, sess.username, previousPlay.completed).catch(() => {});
    }

    // Listen to Earn starts through the existing canonical play request so
    // eligibility is checked against the exact tracks.id/track_plays row
    // already created above. It is opt-in only from Discovery's Earn MP
    // source; ordinary Charts, playlists, artist pages, Radio, DJ BOOM, and
    // arbitrary URL plays continue to behave exactly as before.
    //
    // The four conditions below used to be a single combined `if`, which
    // meant ANY of them silently failing (session not resolving, source
    // string not matching exactly, a missing/malformed trackId) produced
    // listenToEarn: null with no distinguishable reason — indistinguishable
    // client-side from "the client didn't ask for Listen to Earn at all".
    // Checked individually now so a genuine gate failure is always visible
    // as a real reason instead of silently doing nothing.
    let listenToEarnResult = null;
    if (listenToEarn === true) {
      if (!sess) {
        listenToEarnResult = { eligible: false, reason: 'not_signed_in', message: 'Sign in to earn MP from Listen to Earn.' };
      } else if (safeSource !== 'listen_to_earn') {
        console.error('[mp listen start] source mismatch', { source, safeSource });
        listenToEarnResult = { eligible: false, reason: 'source_mismatch', message: 'Listen to Earn could not start (source).' };
      } else if (!publishedTrackId) {
        console.error('[mp listen start] missing/invalid trackId', { trackId });
        listenToEarnResult = { eligible: false, reason: 'missing_track_id', message: 'Listen to Earn could not start (track id).' };
      } else {
        const identity = mpRequestIdentity(req, sess.username, mpDeviceId);
        if (!isLatestMpPlayAttempt(mpPlayAttempt)) {
          // The listener selected another track while this request was doing
          // its play-log lookups. Do not let the stale RPC replace that newer
          // session; the client also suppresses the stale response's toast.
          listenToEarnResult = { eligible: false, reason: 'stale_play_attempt' };
        } else {
          const { data: earnData, error: earnError } = await supabase.rpc('start_listen_to_earn_session', {
            p_username: sess.username,
            p_track_id: publishedTrackId,
            p_play_row_id: result.playRowId || null,
            p_device_hash: identity.deviceHash,
            p_ip_hash: identity.ipHash,
          });
          if (earnError) {
            console.error('[mp listen start] rpc error', earnError.message);
            listenToEarnResult = { eligible: false, reason: 'unavailable', message: 'Listen to Earn could not start.' };
          } else {
            listenToEarnResult = earnData || { eligible: false, reason: 'unavailable' };
          }
        }
      }
    }

    return res.json({
      counted: result.counted,
      playCount: result.playCount ?? null,
      playRowId: result.playRowId ?? null,
      listenToEarn: listenToEarnResult,
    });
  } catch (err) {
    console.error('[plays log]', err);
    return res.status(500).json({ error: 'Could not log play.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MUSI-PIXELS · PHASE 1 + MUSI-SHOP · PHASES 2–3
//  GET  /api/mp/wallet
//  GET  /api/mp/ledger?limit=&before=
//  GET  /api/mp/shop
//  POST /api/mp/shop/purchase
//  POST /api/mp/shop/activate
//  POST /api/mp/shop/gift
//  GET  /api/mp/shop/gifts
//  GET  /api/mp/listen-to-earn/offers?limit=
//  POST /api/mp/listen-to-earn/heartbeat
//  POST /api/mp/listen-to-earn/stop
//
//  All routes resolve the existing FREQ session token. No Supabase browser
//  auth, second account model, or client-writable balance is introduced.
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/mp/wallet', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const wallet = await dbGetMpWallet(sess.username);
    return res.json({ currency: 'MP', ...wallet });
  } catch (err) {
    console.error('[mp wallet]', err);
    return res.status(500).json({ error: 'Could not load your Musi-Pixels wallet.' });
  }
});

app.get('/api/mp/ledger', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const beforeCandidate = req.query.before ? new Date(String(req.query.before)) : null;
  const before = beforeCandidate && !Number.isNaN(beforeCandidate.getTime()) ? beforeCandidate.toISOString() : null;
  try {
    const transactions = await dbGetMpLedger(sess.username, { limit, before });
    return res.json({
      currency: 'MP',
      transactions,
      nextBefore: transactions.length === limit ? transactions[transactions.length - 1].createdAt : null,
    });
  } catch (err) {
    console.error('[mp ledger]', err);
    return res.status(500).json({ error: 'Could not load your Musi-Pixels ledger.' });
  }
});

app.get('/api/mp/shop', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const settings = await dbGetMusiShopSettings();
    const seasonalCollections = await dbGetMusiShopCollections(settings);
    // Sync first so newly earned Achievement/Prestige rewards are present in
    // the inventory read below on this same response.
    const achievements = await dbGetMusiShopAchievements(sess.username);
    const liveSeasonKeys = new Set(
      seasonalCollections.filter(collection => collection.purchasable).map(collection => collection.collectionKey)
    );
    const [catalog, wallet, entitlements, inventory] = await Promise.all([
      dbGetMusiShopCatalog({ liveSeasonKeys }),
      dbGetMpWallet(sess.username),
      dbGetMusiShopEntitlements(sess.username, sess.isPremium),
      dbGetMusiShopInventory(sess.username),
    ]);
    const dailyShop = await dbGetMusiShopDailyRotation(catalog);
    return res.json({
      enabled: settings.enabled,
      seasonalEnabled: settings.seasonalEnabled,
      seasonalPreviewEnabled: settings.seasonalPreviewEnabled,
      serverTime: new Date().toISOString(),
      seasonalCollections: settings.enabled ? seasonalCollections : [],
      currency: 'MP',
      catalog: settings.enabled ? catalog : [],
      dailyShop: settings.enabled ? dailyShop : { rotationDate: null, expiresAt: null, items: [] },
      achievements,
      wallet,
      entitlements,
      ...inventory,
    });
  } catch (err) {
    console.error('[musi-shop catalog]', err);
    return res.status(500).json({ error: 'Could not load the Musi-Shop.' });
  }
});

app.post('/api/mp/shop/purchase', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  const sku = String(req.body?.sku || '').trim();
  const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(sku) || !UUID_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid Musi-Shop purchase request.' });
  }

  try {
    const result = await dbPurchaseMusiShopItem(sess.username, sku, idempotencyKey);
    if (!result.ok) {
      const responses = {
        shop_disabled: [503, 'The Musi-Shop is temporarily unavailable.'],
        item_unavailable: [404, 'This shop item is no longer available.'],
        seasonal_locked: [409, 'This seasonal collection is not open yet.'],
        seasonal_upcoming: [409, 'This seasonal collection has not started yet.'],
        seasonal_ended: [409, 'This seasonal collection has ended.'],
        insufficient_mp: [409, 'You do not have enough MP for this item.'],
        included_with_premium: [409, 'This access is already included with FREQ Premium.'],
        already_owned: [409, 'You already own this item.'],
        authentication_required: [401, 'Authentication required.'],
        invalid_request: [400, 'Invalid Musi-Shop purchase request.'],
      };
      const [status, message] = responses[result.reason] || [409, 'This purchase could not be completed.'];
      return res.status(status).json({
        error: message,
        reason: result.reason || 'purchase_failed',
        balanceMp: Number(result.balanceMp) || 0,
        priceMp: Number(result.priceMp) || null,
      });
    }

    const [wallet, entitlements, inventory] = await Promise.all([
      dbGetMpWallet(sess.username),
      dbGetMusiShopEntitlements(sess.username, sess.isPremium),
      dbGetMusiShopInventory(sess.username),
    ]);
    return res.status(result.idempotent ? 200 : 201).json({
      success: true,
      idempotent: !!result.idempotent,
      purchase: {
        id: result.purchaseId,
        sku: result.sku,
        itemName: result.itemName,
        priceMp: Number(result.priceMp) || 0,
      },
      wallet,
      entitlements,
      ...inventory,
    });
  } catch (err) {
    console.error('[musi-shop purchase]', err);
    return res.status(500).json({ error: 'Could not complete this Musi-Shop purchase.' });
  }
});

app.post('/api/mp/shop/activate', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  const slot = String(req.body?.slot || '').trim();
  const sku = req.body?.sku == null ? null : String(req.body.sku).trim();
  const selectionKey = req.body?.selectionKey == null ? null : String(req.body.selectionKey).trim();
  if (!MUSI_SHOP_COSMETIC_SLOTS.has(slot)
      || (sku && !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(sku))
      || (selectionKey && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(selectionKey))) {
    return res.status(400).json({ error: 'Invalid cosmetic activation request.' });
  }
  try {
    const result = await dbActivateMusiShopItem(sess.username, slot, sku, selectionKey);
    if (!result.ok) {
      const responses = {
        not_owned: [403, 'You do not own this item.'],
        slot_mismatch: [400, 'This item cannot be used in that slot.'],
        invalid_slot: [400, 'Invalid cosmetic slot.'],
        invalid_selection: [400, 'That pack selection is not available.'],
        authentication_required: [401, 'Authentication required.'],
      };
      const [status, message] = responses[result.reason] || [409, 'This item could not be activated.'];
      return res.status(status).json({ error: message, reason: result.reason || 'activation_failed' });
    }
    const inventory = await dbGetMusiShopInventory(sess.username);
    return res.json({ success: true, activation: result, ...inventory });
  } catch (err) {
    console.error('[musi-shop activate]', err);
    return res.status(500).json({ error: 'Could not update your active cosmetic.' });
  }
});

// ─── App Icon Packs ───────────────────────────────────────────────────────
// Friendly category routes for launcher-icon clients.  They intentionally
// delegate to the established Musi-Shop RPCs so MP debits, duplicate checks,
// ownership and single-slot equipment remain atomic and authoritative.
app.get('/api/icon-packs', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try { return res.json({ currency: 'MP', packs: await dbGetIconPacks(sess.username) }); }
  catch (err) { console.error('[icon-packs catalog]', err); return res.status(500).json({ error: 'Could not load App Icon Packs.' }); }
});

app.get('/api/icon-packs/owned', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try { return res.json({ packs: (await dbGetIconPacks(sess.username)).filter(pack => pack.owned) }); }
  catch (err) { console.error('[icon-packs owned]', err); return res.status(500).json({ error: 'Could not load your icon pack inventory.' }); }
});

app.post('/api/icon-packs/purchase', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  const sku = String(req.body?.sku || req.body?.id || '').trim();
  const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  if (!UUID_RE.test(idempotencyKey)) return res.status(400).json({ error: 'A valid idempotency key is required.' });
  try {
    const pack = (await dbGetIconPacks(sess.username)).find(item => item.sku === sku);
    if (!pack) return res.status(404).json({ error: 'Icon pack not found or unavailable.' });
    const result = await dbPurchaseMusiShopItem(sess.username, sku, idempotencyKey);
    if (!result.ok) {
      const message = { already_owned: 'You already own this icon pack.', insufficient_mp: 'You do not have enough MP for this icon pack.', seasonal_locked: 'This limited icon pack is not available right now.' }[result.reason] || 'This icon pack could not be purchased.';
      return res.status(result.reason === 'already_owned' || result.reason === 'insufficient_mp' ? 409 : 400).json({ error: message, reason: result.reason });
    }
    return res.status(result.idempotent ? 200 : 201).json({ success: true, purchase: result, packs: await dbGetIconPacks(sess.username) });
  } catch (err) { console.error('[icon-packs purchase]', err); return res.status(500).json({ error: 'Could not purchase this icon pack.' }); }
});

app.post('/api/icon-packs/equip', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  const sku = String(req.body?.sku || req.body?.id || '').trim();
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const pack = (await dbGetIconPacks(sess.username)).find(item => item.sku === sku);
    if (!pack) return res.status(404).json({ error: 'Icon pack not found.' });
    const result = await dbActivateMusiShopItem(sess.username, 'app_icon', sku, pack.sku.replace(/^icon-pack-/, ''));
    if (!result.ok) return res.status(result.reason === 'not_owned' ? 403 : 400).json({ error: result.reason === 'not_owned' ? 'Purchase this icon pack before equipping it.' : 'Could not equip this icon pack.', reason: result.reason });
    return res.json({ success: true, equipped: sku, packs: await dbGetIconPacks(sess.username) });
  } catch (err) { console.error('[icon-packs equip]', err); return res.status(500).json({ error: 'Could not equip this icon pack.' }); }
});

app.post('/api/mp/shop/crate/open', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  const tier = String(req.body?.tier || '').trim().toLowerCase();
  const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
  if (!['common', 'rare', 'epic', 'legendary'].includes(tier) || !UUID_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid mystery crate request.' });
  }
  try {
    const result = await dbOpenMusiShopCrate(sess.username, tier, idempotencyKey);
    if (!result.ok) {
      const responses = {
        shop_disabled: [503, 'The Musi-Shop is temporarily unavailable.'],
        tier_complete: [409, `You already own every available ${tier} cosmetic.`],
        insufficient_mp: [409, 'You do not have enough MP for this crate.'],
        authentication_required: [401, 'Authentication required.'],
        invalid_request: [400, 'Invalid mystery crate request.'],
      };
      const [status, message] = responses[result.reason] || [409, 'This crate could not be opened.'];
      return res.status(status).json({
        error: message,
        reason: result.reason || 'crate_failed',
        balanceMp: Number(result.balanceMp) || 0,
        priceMp: Number(result.priceMp) || null,
      });
    }
    const [wallet, inventory] = await Promise.all([
      dbGetMpWallet(sess.username),
      dbGetMusiShopInventory(sess.username),
    ]);
    return res.status(result.idempotent ? 200 : 201).json({
      success: true,
      idempotent: !!result.idempotent,
      reward: {
        openId: result.openId,
        tier: result.tier,
        sku: result.sku,
        itemName: result.itemName,
        itemIcon: result.itemIcon,
        priceMp: Number(result.priceMp) || 0,
      },
      wallet,
      ...inventory,
    });
  } catch (err) {
    console.error('[musi-shop crate]', err);
    return res.status(500).json({ error: 'Could not open this mystery crate.' });
  }
});

app.post('/api/mp/shop/gift', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  const recipientUsername = normalizeUsername(req.body?.recipientUsername);
  const sku = String(req.body?.sku || '').trim();
  const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
  if (!recipientUsername || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(sku) || !UUID_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid gift request.' });
  }
  try {
    const result = await dbGiftMusiShopItem(sess.username, recipientUsername, sku, idempotencyKey);
    if (!result.ok) {
      const responses = {
        shop_disabled: [503, 'The Musi-Shop is temporarily unavailable.'],
        item_unavailable: [404, 'This item cannot be gifted right now.'],
        seasonal_locked: [409, 'This seasonal collection is not open yet.'],
        seasonal_upcoming: [409, 'This seasonal collection has not started yet.'],
        seasonal_ended: [409, 'This seasonal collection has ended.'],
        recipient_not_found: [404, 'No FREQ account was found with that username.'],
        recipient_has_premium: [409, 'That user already has this access through FREQ Premium.'],
        recipient_already_owns: [409, 'That user already owns this item.'],
        self_gift: [409, 'Choose another FREQ user to receive this gift.'],
        insufficient_mp: [409, 'You do not have enough MP to send this gift.'],
        authentication_required: [401, 'Authentication required.'],
        invalid_request: [400, 'Invalid gift request.'],
      };
      const [status, message] = responses[result.reason] || [409, 'This gift could not be sent.'];
      return res.status(status).json({
        error: message,
        reason: result.reason || 'gift_failed',
        balanceMp: Number(result.balanceMp) || 0,
        priceMp: Number(result.priceMp) || null,
      });
    }
    const wallet = await dbGetMpWallet(sess.username);
    return res.status(result.idempotent ? 200 : 201).json({
      success: true,
      idempotent: !!result.idempotent,
      gift: {
        id: result.giftId,
        sku: result.sku,
        itemName: result.itemName,
        recipientUsername: result.recipientUsername,
        priceMp: Number(result.priceMp) || 0,
      },
      wallet,
    });
  } catch (err) {
    console.error('[musi-shop gift]', err);
    return res.status(500).json({ error: 'Could not send this Musi-Shop gift.' });
  }
});

app.get('/api/mp/shop/gifts', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    return res.json({ gifts: await dbGetMusiShopGifts(sess.username, 50) });
  } catch (err) {
    console.error('[musi-shop gifts]', err);
    return res.status(500).json({ error: 'Could not load your gift history.' });
  }
});

app.get('/api/mp/listen-to-earn/offers', rateLimit, requireFeatureAllowed('discover'), async (req, res) => {
  const sess = req._session;
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  try {
    const allowedRatings = await getAllowedRatingsForRequest(req);
    const result = await dbGetListenToEarnOffers(sess.username, allowedRatings, Math.min(limit * 3, 100));
    // Family Controls' explicit track/artist/genre blocks are applied after
    // the rarity/daily-cap filter, exactly like Charts and Track Finder.
    const visible = (await filterBlockedTracksForRequest(req, result.offers)).slice(0, limit);
    return res.json({
      enabled: result.config.enabled,
      currency: 'MP',
      rewardMp: result.config.mpPerTrack,
      rules: {
        minPercentPlayed: result.config.minPercentPlayed,
        minSecondsFloor: result.config.minSecondsFloor,
        maxTracksPerArtistPerDay: result.config.maxTracksPerArtistPerDay,
        maxArtistsPerDay: result.config.maxArtistsPerDay,
        eligibleLifetimePlayCeiling: result.config.eligibleLifetimePlayCeiling,
        eligibleRecencyDays: result.config.eligibleRecencyDays,
        heartbeatIntervalSeconds: result.config.heartbeatIntervalSeconds,
      },
      dailyArtistsUsed: result.dailyArtistsUsed,
      dailyTracksEarned: result.dailyTracksEarned || 0,
      offers: visible.map(track => ({
        id: track.id,
        originalUrl: track.original_url,
        title: track.title || 'Untitled',
        artistId: track.artist_id,
        artistName: track.artist_name || 'Unknown Artist',
        platform: 'cloud',
        coverUrl: track.cover_url || null,
        contentRating: track.content_rating || 'clean',
        isExplicit: !!track.is_explicit,
        durationSeconds: result.durationByCloud.get(String(track.cloud_file_id)) || null,
        rewardMp: result.config.mpPerTrack,
        remainingForArtistToday: Math.max(0, result.config.maxTracksPerArtistPerDay - (result.dailyArtistCounts.get(track.artist_id) || 0)),
      })),
    });
  } catch (err) {
    console.error('[mp offers]', err);
    return res.status(500).json({ error: 'Could not load Listen to Earn offers.' });
  }
});

app.post('/api/mp/listen-to-earn/heartbeat', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  const { sessionId, currentTimeSeconds, playbackRate, mpDeviceId } = req.body || {};
  // Require actual JSON numbers. Number(null) and Number('') are both 0 and
  // previously allowed malformed clients to create valid-looking zero beats.
  const position = currentTimeSeconds;
  const rate = playbackRate;
  // TEMP DIAGNOSTIC — remove once Listen to Earn accrual is confirmed
  // working. Confirms the raw wire value the server received for
  // currentTimeSeconds, to rule out any client/server mismatch now that
  // the RPC itself has been verified correct via a direct manual call.
  console.log('[MP heartbeat debug] received', { sessionId, currentTimeSeconds, position, rate, username: sess.username });
  if (!UUID_RE.test(String(sessionId || '')) ||
      typeof position !== 'number' || !Number.isFinite(position) || position < 0 ||
      typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0.25 || rate > 16) {
    return res.status(400).json({ error: 'Invalid Listen to Earn heartbeat.' });
  }
  try {
    const identity = mpRequestIdentity(req, sess.username, mpDeviceId);
    const { data, error } = await supabase.rpc('record_listen_to_earn_heartbeat', {
      p_username: sess.username,
      p_session_id: sessionId,
      p_position_seconds: position,
      p_playback_rate: rate,
      p_device_hash: identity.deviceHash,
      p_ip_hash: identity.ipHash,
    });
    if (error) throw new Error(error.message);
    return res.json(data || { active: false, rewarded: false, reason: 'unavailable' });
  } catch (err) {
    console.error('[mp heartbeat]', err);
    return res.status(500).json({ error: 'Could not verify this Listen to Earn heartbeat.' });
  }
});

app.post('/api/mp/listen-to-earn/stop', rateLimit, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  const { sessionId } = req.body || {};
  if (!UUID_RE.test(String(sessionId || ''))) return res.status(400).json({ error: 'Invalid Listen to Earn session.' });
  try {
    const { error } = await supabase.from('listen_to_earn_sessions')
      .update({ status: 'expired', deny_reason: 'playback_stopped', completed_at: new Date().toISOString() })
      .eq('id', sessionId).eq('username', sess.username).eq('status', 'active');
    if (error) throw new Error(error.message);
    return res.json({ success: true });
  } catch (err) {
    console.error('[mp stop]', err);
    return res.status(500).json({ error: 'Could not stop the Listen to Earn session.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PLAYBACK FILTERS (Part 3)
//  GET   /api/playback-filters        → current user's settings
//  PATCH /api/playback-filters        { token, allowClean?, allowParentalGuidance?, allowAdult? }
//
//  Every content-serving route below (Charts, Discovery Track Finder, the
//  stream route, playlist track resolution) reads these via
//  getAllowedRatingsForRequest() — this pair of routes is just the settings
//  UI's read/write surface, not itself part of the enforcement.
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/playback-filters', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const settings = await dbGetPlaybackFilterSettings(sess.username);
    return res.json(settings);
  } catch (err) {
    console.error('[playback filters get]', err);
    return res.status(500).json({ error: 'Could not load playback filter settings.' });
  }
});

app.patch('/api/playback-filters', requireNotChild, async (req, res) => {
  const { token, allowClean, allowParentalGuidance, allowAdult } = req.body || {};
  const sess = req._session || await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    // Part 5/6: a locked-down child account cannot change its own content
    // restrictions — "Only parent can." is_parent_enforced is set by the
    // parent dashboard (Phase 4), not by this route, so checking it here
    // (rather than trusting the frontend to just not show the toggle) is
    // what actually makes that rule server-enforced instead of cosmetic.
    const current = await dbGetPlaybackFilterSettings(sess.username);
    if (current.isParentEnforced) {
      return res.status(403).json({ error: 'These settings are managed by a parent or guardian and can\'t be changed from this account.' });
    }
    const updated = await dbSetPlaybackFilterSettings(sess.username, { allowClean, allowParentalGuidance, allowAdult });
    return res.json({
      allowClean: updated.allow_clean, allowParentalGuidance: updated.allow_parental_guidance,
      allowAdult: updated.allow_adult, isParentEnforced: !!updated.is_parent_enforced,
    });
  } catch (err) {
    console.error('[playback filters patch]', err);
    return res.status(500).json({ error: 'Could not update playback filter settings.' });
  }
});

const CHARTS_MAX_LIMIT = 100;

app.get('/api/charts/tracks', async (req, res) => {
  const window = req.query.window === '7d' ? '7d' : 'all';
  const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), CHARTS_MAX_LIMIT);
  try {
    const allowedRatings = await getAllowedRatingsForRequest(req);
    const rawRows = await dbGetTopTracks({ window, limit, allowedRatings });
    // Part 6: specific artist/genre/track blocks on top of the rating
    // ceiling — a chart-topping track can still be individually blocked.
    const rows = await filterBlockedTracksForRequest(req, rawRows);
    const collabsByTrack = await dbGetCollaboratorsForTracks(rows.map(t => t.id));
    const durationByCloudId = await dbDurationByCloudFile(rows);
    return res.json({
      window,
      tracks: rows.map((t, i) => ({
        rank: i + 1,
        id: t.id,
        originalUrl: t.original_url,
        platform: t.platform,
        title: t.title || t.original_url,
        playCount: window === '7d' ? t.play_count_7d : t.play_count,
        allTimePlayCount: t.play_count,
        lastPlayedAt: t.last_played_at,
        coverUrl: t.cover_url || null,
        artistId: t.artist_id || null,
        artistName: t.artist_name || null,
        durationSeconds: durationByCloudId.get(String(t.cloud_file_id)) || null,
        isExplicit: !!t.is_explicit,
        contentRating: t.content_rating || 'clean',
        collaborators: (collabsByTrack.get(t.id) || []).map(shapeCollaborator),
      })),
    });
  } catch (err) {
    console.error('[charts tracks]', err);
    return res.status(500).json({ error: 'Could not load charts.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DISCOVERY
//  GET /api/discover/playlists   ?sort=likes|recent&limit=
//  GET /api/discover/profiles    ?limit=&token=
//
//  Both are read-only and intentionally unauthenticated-friendly — Discovery
//  is meant to work for a visitor who hasn't signed in yet, same philosophy
//  as Charts. token on /profiles is optional and only used to exclude the
//  requester's own profile from the result (see dbDiscoverProfiles).
// ═══════════════════════════════════════════════════════════════════════════════

const DISCOVER_MAX_LIMIT = 50;

app.get('/api/discover/playlists', async (req, res) => {
  const sort  = req.query.sort === 'recent' ? 'recent' : 'likes';
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), DISCOVER_MAX_LIMIT);
  const query = (req.query.q || '').toString().trim().slice(0, 100) || null;
  try {
    // Part 6/12: a child account with Discover disabled sees an empty
    // result, not an error — Part 12 wants restricted content to "pretend
    // it doesn't exist" rather than surfacing a visible lock/error state.
    if (await isFeatureDisabledForRequest(req, 'discover')) {
      return res.json({ sort, playlists: [] });
    }
    const rows = await dbDiscoverPlaylists({ sort, limit, query });
    return res.json({
      sort,
      playlists: rows.map(p => ({
        id: p.id, owner: p.owner, name: p.name, description: p.description,
        trackCount: p.track_count, likeCount: p.like_count || 0,
        coverUrl: p.cover_url || null, updatedAt: p.updated_at,
      })),
    });
  } catch (err) {
    console.error('[discover playlists]', err);
    return res.status(500).json({ error: 'Could not load discovery playlists.' });
  }
});

app.get('/api/discover/profiles', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), DISCOVER_MAX_LIMIT);
  const query = (req.query.q || '').toString().trim().slice(0, 100) || null;
  try {
    if (await isFeatureDisabledForRequest(req, 'discover')) {
      return res.json({ profiles: [] });
    }
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    const sess  = token ? await dbGetSession(token) : null;
    const rows  = await dbDiscoverProfiles({ limit, excludeUsername: sess ? sess.username : null, query });
    return res.json({
      profiles: rows.map(p => ({
        username: p.username, displayName: p.display_name, bio: p.bio,
        avatarUrl: p.avatar_url || null,
        followerCount: p.follower_count, followingCount: p.following_count,
      })),
    });
  } catch (err) {
    console.error('[discover profiles]', err);
    return res.status(500).json({ error: 'Could not load discovery profiles.' });
  }
});

// ─── Track Finder: GET /api/discover/tracks ──────────────────────────────────
// Searches published FREQ tracks by title or artist name, with sort and
// explicit filters. Backed by the same `tracks` table as Charts but exposed
// here for the Discovery Track Finder which is keyword-searchable rather than
// purely rank-ordered. Also returns like_count and isExplicit for UI display.
app.get('/api/discover/tracks', async (req, res) => {
  const q        = (req.query.q || '').toString().trim().slice(0, 100);
  const sort     = req.query.sort === 'recent' ? 'recent' : 'plays';
  const explicit = req.query.explicit === '1';
  const limit    = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const token    = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess     = token ? await dbGetSession(token) : null;

  try {
    // Part 6: a child account with Discover disabled sees no results —
    // checked before the Part 3 rating filter below since disabling the
    // whole surface is a stronger restriction than filtering within it.
    if (await isFeatureDisabledForRequest(req, 'discover')) {
      return res.json({ tracks: [] });
    }
    // Part 3 enforcement: search/discover must respect the requester's
    // playback filter settings (or the all-true defaults for a signed-out
    // visitor) the same way Charts does via getAllowedRatingsForRequest.
    const allowedRatings = await getAllowedRatingsForRequest(req);

    let query = supabase
      .from('tracks')
      .select('id, title, artist_id, artist_name, play_count, play_count_7d, like_count, is_explicit, published_at, cover_url, cloud_file_id, content_rating')
      .eq('is_published', true)
      .in('content_rating', allowedRatings);

    if (q) {
      // Title OR artist name match — Supabase's .or() with ilike
      query = query.or(`title.ilike.%${q}%,artist_name.ilike.%${q}%`);
    }
    if (explicit) query = query.eq('is_explicit', true);

    query = sort === 'recent'
      ? query.order('published_at', { ascending: false, nullsFirst: false })
      : query.order('play_count', { ascending: false });

    const { data: rawData, error } = await query.limit(limit);
    if (error) throw new Error(error.message);
    // Part 6: specific artist/genre/track blocks on top of the rating
    // ceiling above.
    const data = await filterBlockedTracksForRequest(req, rawData || []);

    // Batch-fetch liked status for the signed-in user
    let likedIds = new Set();
    if (sess && data?.length) {
      const ids = data.map(t => t.id);
      const { data: likes } = await supabase.from('track_likes')
        .select('track_id').eq('username', sess.username).in('track_id', ids);
      likedIds = new Set((likes || []).map(l => l.track_id));
    }

    // Batch-fetch which of these tracks have a music video attached, same
    // shape as the likes batch above — backs the "🎬 Video Available"
    // search badge requirement without an N+1 query per result row.
    let videoTrackIds = new Set();
    if (data?.length) {
      const ids = data.map(t => t.id);
      const { data: videos } = await supabase.from('track_videos')
        .select('track_id').in('track_id', ids);
      videoTrackIds = new Set((videos || []).map(v => v.track_id));
    }
    const durationByCloudId = await dbDurationByCloudFile(data || []);

    return res.json({
      tracks: (data || []).map(t => ({
        id: t.id, title: t.title, artistId: t.artist_id, artistName: t.artist_name,
        playCount: t.play_count || 0, playCount7d: t.play_count_7d || 0,
        likeCount: t.like_count || 0, isExplicit: !!t.is_explicit,
        contentRating: t.content_rating || 'clean',
        publishedAt: t.published_at, coverUrl: t.cover_url,
        durationSeconds: durationByCloudId.get(String(t.cloud_file_id)) || null,
        likedByMe: likedIds.has(t.id),
        hasVideo: videoTrackIds.has(t.id),
      })),
    });
  } catch (err) {
    console.error('[discover tracks]', err);
    return res.status(500).json({ error: 'Could not search tracks.' });
  }
});

// Album/single/EP discovery is the release-shaped companion to Track
// Finder. It stays read-only and anonymous-friendly, reusing the existing
// artist_releases table, content filters, and artist visibility rules.
app.get('/api/discover/releases', async (req, res) => {
  const type = ['single', 'album', 'ep', 'mixtape', 'compilation'].includes(req.query.type)
    ? req.query.type : null;
  const sort = req.query.sort === 'trending' ? 'trending' : 'recent';
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), DISCOVER_MAX_LIMIT);
  const query = (req.query.q || '').toString().trim().slice(0, 100) || null;
  try {
    if (await isFeatureDisabledForRequest(req, 'discover')) {
      return res.json({ type, sort, releases: [] });
    }
    const allowedRatings = await getAllowedRatingsForRequest(req);
    const rawRows = await dbDiscoverReleases({ type, sort, limit, query, allowedRatings });
    const artists = rawRows.map(row => row.artists).filter(Boolean);
    const visibleArtists = await filterBlockedArtistsForRequest(req, artists);
    const visibleArtistIds = new Set(visibleArtists.map(artist => artist.id));
    const rows = rawRows.filter(row => visibleArtistIds.has(row.artist_id));
    return res.json({
      type,
      sort,
      releases: rows.map(row => ({
        id: row.id,
        title: row.title || 'Untitled',
        releaseType: row.release_type,
        coverUrl: row.cover_url || null,
        releaseDate: row.release_date || null,
        trackCount: Number(row.track_count) || 0,
        totalPlays: Number(row.total_plays) || 0,
        totalLikes: Number(row.total_likes) || 0,
        contentRating: row.content_rating || 'clean',
        isExplicit: (row.content_rating || 'clean') !== 'clean',
        artistId: row.artist_id,
        artistSlug: row.artists?.slug || null,
        artistName: row.artists?.name || 'Unknown Artist',
        artistAvatarUrl: row.artists?.avatar_url || null,
        artistVerified: !!row.artists?.is_verified,
      })),
    });
  } catch (err) {
    console.error('[discover releases]', err);
    return res.status(500).json({ error: 'Could not load releases.' });
  }
});

// ?mode=trending|new|search (default trending). search requires ?q=.
// Unauthenticated-friendly like every other Discovery route — same
// philosophy as Charts, this is meant to work for a visitor browsing
// before signing in.
// Companion to filterBlockedTracksForRequest for ARTIST-shaped rows (the
// row itself is the artist, not a track referencing one) — Discover
// Artists needs blocked_artist_ids/blocked_genres checked against `id`/
// `genre` directly rather than `artist_id`. blocked_track_ids doesn't apply
// here at all, an artist listing has no individual track to check.
async function filterBlockedArtistsForRequest(req, rows) {
  const input = Array.isArray(rows) ? rows : [];
  if (!input.length) return input;
  const restrictions = await getFamilyRestrictionsForRequest(req);
  if (!restrictions) return input;
  const blockedIds = new Set(restrictions.blocked_artist_ids || []);
  const blockedGenres = new Set(restrictions.blocked_genres || []);
  if (!blockedIds.size && !blockedGenres.size && !restrictions.block_explicit_artists) return input;

  const adultArtistIds = new Set();
  if (restrictions.block_explicit_artists) {
    const artistIds = input.map(a => a.id).filter(Boolean);
    if (artistIds.length) {
      const { data, error } = await supabase.from('tracks')
        .select('artist_id').in('artist_id', artistIds).eq('is_published', true).eq('content_rating', 'adult');
      if (error) throw new Error(error.message);
      for (const row of data || []) if (row.artist_id) adultArtistIds.add(row.artist_id);
    }
  }
  return input.filter(a =>
    !blockedIds.has(a.id) &&
    !(a.genre && blockedGenres.has(a.genre)) &&
    !adultArtistIds.has(a.id)
  );
}

async function isArtistBlockedForRequest(req, artist) {
  if (!artist) return false;
  const visible = await filterBlockedArtistsForRequest(req, [artist]);
  return visible.length === 0;
}

app.get('/api/discover/artists', async (req, res) => {
  const mode  = ['trending', 'new', 'search'].includes(req.query.mode) ? req.query.mode : 'trending';
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), DISCOVER_MAX_LIMIT);
  const query = (req.query.q || '').toString().trim().slice(0, 100) || null;
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = token ? await dbGetSession(token) : null;
  if (mode === 'search' && !query) return res.json({ mode, artists: [] });
  try {
    if (await isFeatureDisabledForRequest(req, 'discover')) {
      return res.json({ mode, artists: [] });
    }
    const rawRows = await dbDiscoverArtists({ mode, limit, query });
    // Part 6: specific artist/genre blocks — dbDiscoverArtists selects `*`
    // so `genre` is already on each row; see filterBlockedArtistsForRequest.
    const rows = await filterBlockedArtistsForRequest(req, rawRows);
    let followedArtistIds = new Set();
    if (sess && rows.length) {
      const { data: followedRows, error: followedError } = await supabase.from('artist_followers')
        .select('artist_id')
        .eq('follower_username', sess.username)
        .in('artist_id', rows.map(artist => artist.id));
      if (followedError) throw new Error(followedError.message);
      followedArtistIds = new Set((followedRows || []).map(row => row.artist_id));
    }
    return res.json({
      mode,
      artists: rows.map(a => {
        const stats = a.artist_stats || {};
        return {
          id: a.id, slug: a.slug, name: a.name,
          avatarUrl: a.avatar_url, bannerUrl: a.banner_url,
          isVerified: a.is_verified, followerCount: a.follower_count,
          createdAt: a.created_at,
          isNew: (Date.now() - new Date(a.created_at).getTime()) < NEW_ARTIST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
          totalPlays: Number(stats.total_plays) || 0,
          totalPlays7d: stats.total_plays_7d || 0,
          monthlyListeners: stats.monthly_listeners || 0,
          chartRank: stats.chart_rank ?? null,
          isFollowing: followedArtistIds.has(a.id),
          isOwnedByMe: !!(sess && a.account_id === sess.username),
        };
      }),
    });
  } catch (err) {
    console.error('[discover artists]', err);
    return res.status(500).json({ error: 'Could not load discovery artists.' });
  }
});

// ─── Activity Feed DB helpers ─────────────────────────────────────────────────
// event_type values in use:
//   follow | collab_joined | track_added | playlist_created | playlist_updated
//   | playlist_liked
// (No DB-level CHECK constraint enforces this list — it's a convention
// followed by every dbWriteActivity call site in this file.)
//
// actor      = who did the thing
// target_user = who should see it in their personal feed
//               (NULL = global-only event; personal events always also appear globally)
// payload    = JSONB with event-specific fields, stored in the `meta` column
//              (the column is named meta, not payload — the parameter here
//              is named payload for readability at every call site, but it
//              must be written to .insert({ meta: payload }), not
//              { payload }. A prior version of this function wrote
//              { payload } directly, which silently failed on every single
//              call — Postgres/PostgREST has no `payload` column on
//              activity_feed to write to. This was confirmed live: 2 real
//              follow relationships existed in `follows` with zero
//              corresponding rows in `activity_feed`. Every dbWriteActivity
//              call in this file was failing silently before this fix.)

async function dbWriteActivity(eventType, actor, targetUser, payload = {}) {
  // Fire-and-forget — never block a route on feed writes.
  supabase.from('activity_feed').insert({
    event_type: eventType,
    actor,
    target_user: targetUser || null,
    meta: payload,
  }).then(({ error }) => {
    if (error) console.error('[activity write]', eventType, error.message);
  });
}

// Artist-originated events (new release, an artist's track went viral,
// etc) have no real account behind an unclaimed artist, and even a claimed
// one's activity here is artist-centric rather than user-centric — "Slimey
// dropped a new EP" reads as an artist action, not a personal one, even on
// a claimed page. So `actor` is set to a synthetic, never-a-real-username
// marker (artist:<uuid>) rather than left null or pointing at the claiming
// account, and meta.artistId carries the real link. dbGetFollowingFeed's
// meta->>artistId clause is what actually surfaces these to followers —
// the synthetic actor value is never matched against `follows`, by design,
// since an artist isn't a row in `accounts` and never will be for
// unclaimed artists.
async function dbWriteArtistActivity(eventType, artistId, payload = {}) {
  await dbWriteActivity(eventType, `artist:${artistId}`, null, { ...payload, artistId });
}

// Following feed: events where actor is someone `username` follows, OR
// target_user === username, OR the event's meta.artistId is an artist
// `username` follows. That last clause is new specifically for Artist
// Pages: artist-originated events (new release, etc) have no `actor`
// username to match against follows (an unclaimed artist has no account at
// all, and even a claimed one's activity is written as artist-centric, not
// user-centric — see dbWriteArtistActivity below) — without this clause,
// following an artist would never surface anything in this feed, only on
// the artist's own page, which defeats the point of "integrate with the
// existing Activity Feed system" for the personal/following view.
async function dbGetFollowingFeed(username, { limit = 30, before = null } = {}) {
  // Get the list of people this user follows
  const { data: followRows } = await supabase
    .from('follows')
    .select('followed_username')
    .eq('follower_username', username);
  const following = (followRows || []).map(r => r.followed_username);

  const { data: artistFollowRows } = await supabase
    .from('artist_followers')
    .select('artist_id')
    .eq('follower_username', username);
  const followedArtistIds = (artistFollowRows || []).map(r => r.artist_id);

  // Include events targeted at `username` directly (e.g. someone followed you)
  // plus events from people they follow, plus events from artists they follow
  let q = supabase
    .from('activity_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);

  const orClauses = [];
  if (following.length) orClauses.push(`actor.in.(${following.map(u => `"${u}"`).join(',')})`);
  orClauses.push(`target_user.eq.${username}`);
  if (followedArtistIds.length) orClauses.push(`meta->>artistId.in.(${followedArtistIds.map(id => `"${id}"`).join(',')})`);
  q = q.or(orClauses.join(','));

  const { data, error } = await q;
  if (error) { console.error('[activity following feed]', error.message); return []; }
  return data || [];
}

async function dbGetGlobalFeed({ limit = 30, before = null } = {}) {
  let q = supabase
    .from('activity_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) { console.error('[activity global feed]', error.message); return []; }
  return data || [];
}

async function dbGetUnreadCount(username, since) {
  // Unread = events in the following feed newer than `since`
  const { data: followRows } = await supabase
    .from('follows')
    .select('followed_username')
    .eq('follower_username', username);
  const following = (followRows || []).map(r => r.followed_username);
  let q = supabase
    .from('activity_feed')
    .select('id', { count: 'exact', head: true })
    .gt('created_at', since);
  if (following.length) {
    q = q.or(`actor.in.(${following.map(u => `"${u}"`).join(',')}),target_user.eq.${username}`);
  } else {
    q = q.eq('target_user', username);
  }
  const { count } = await q;
  return count || 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🔄 CROSS-DEVICE SYNC — Experimental Labs: "Faster Sync Engine"
//
//  Explicitly opt-in handoff, not continuous mirroring — nothing here ever
//  pushes a change to another device automatically. Each signed-in device
//  periodically reports its own now-playing snapshot (whole queue + active
//  index + position, per the product decision this replaced background
//  push/pull with), and a device only ever adopts another device's state
//  when the user deliberately picks it from a "Continue on this device"
//  list — the same mental model as Spotify Connect. That's also why this
//  needs no SSE/Realtime channel like Shared Playlists or the Activity
//  Feed below: reporting is a plain upsert, and pulling is a plain read,
//  both on request rather than pushed.
//
//  Local-file queue items carry blob: URLs that only exist on the device
//  that added them — those obviously can't follow to another device, so a
//  snapshot only stores durable identity (freqTrackId / cloudFileId / a
//  streaming platform + originalUrl for YouTube etc.), never a blobUrl.
//  The device pulling a snapshot is responsible for resolving each item
//  back into something playable (or skipping it) using its own normal
//  track-resolution paths — this endpoint doesn't guess playability.
//
//  Backed by a single now_playing_snapshots table, one row per
//  (username, device_id), upserted on every report. device_id is a
//  client-generated UUID persisted in that browser's localStorage (see
//  index.html) — there's no server-side device/user-agent tracking here,
//  the device supplies its own human-readable label.
//
//  Every route below is gated by requirePremium, same as DJ BOOM / Real-
//  Life Radio / the rest of Experimental Labs — a non-Premium session gets
//  a 403 straight from the API, not just a locked-looking panel.
//
//  POST /api/sync/now-playing         { deviceId, deviceLabel, queue, activeIndex, positionSeconds } (+ token)
//  GET  /api/sync/devices             ?token=&deviceId=   → this user's other reporting devices
//  POST /api/sync/now-playing/pull    { deviceId } (+ token)  → marks deviceId's snapshot consumed (best-effort housekeeping only)
// ═══════════════════════════════════════════════════════════════════════════════

// Cheap guardrails on report size — a queue is a JSON array of lightweight
// identity objects (no blobUrls), so 500KB is already generous; this just
// stops a client bug from writing something pathological.
const SYNC_MAX_QUEUE_BYTES = 500_000;
const SYNC_MAX_QUEUE_ITEMS = 2000;
// Snapshots older than this are considered stale and excluded from the
// device list — a device that's been closed for two weeks isn't a
// meaningful "continue here" target, and this also bounds table growth
// somewhat without a hard cron job (see dbPruneStaleNowPlayingSnapshots).
const SYNC_STALE_MS = 14 * 24 * 60 * 60 * 1000;

// Strips each queue item down to durable identity fields only — this is
// the enforcement point for "never store a blobUrl," rather than trusting
// the client to have omitted it. Unknown/malformed items are dropped
// rather than rejecting the whole report, since one bad item shouldn't
// block every other device from seeing an otherwise-good snapshot.
function sanitizeSyncQueueItem(item) {
  if (!item || typeof item !== 'object') return null;
  const platform = typeof item.platform === 'string' ? item.platform : null;
  if (!platform) return null;
  const base = {
    platform,
    title: typeof item.title === 'string' ? item.title.slice(0, 300) : '',
    customLabel: typeof item.customLabel === 'string' ? item.customLabel.slice(0, 300) : undefined,
  };
  if (platform === 'freq' && typeof item.freqTrackId === 'string') {
    return { ...base, freqTrackId: item.freqTrackId };
  }
  if (platform === 'local' && typeof item.cloudFileId === 'string') {
    // Only cloud-backed local files are resolvable on another device —
    // a true on-disk local file (no cloudFileId) has nothing durable to
    // sync, so it's dropped from the snapshot rather than stored as a
    // dead entry another device can never play.
    return { ...base, cloudFileId: item.cloudFileId };
  }
  if ((platform === 'youtube' || platform === 'ytmusic' || platform === 'spotify' || platform === 'tidal' || platform === 'soundcloud' || platform === 'applemusic')
      && typeof item.originalUrl === 'string') {
    return { ...base, originalUrl: item.originalUrl.slice(0, 2000) };
  }
  return null; // local blob-only file, or anything else with no durable identity
}

async function dbUpsertNowPlayingSnapshot(username, { deviceId, deviceLabel, queue, activeIndex, positionSeconds }) {
  const { error } = await supabase.from('now_playing_snapshots').upsert({
    username, device_id: deviceId,
    device_label: (deviceLabel || 'Unknown device').slice(0, 80),
    queue, active_index: activeIndex, position_seconds: positionSeconds,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'username,device_id' });
  if (error) throw new Error(error.message);
}

async function dbGetOtherNowPlayingSnapshots(username, excludeDeviceId) {
  const staleCutoff = new Date(Date.now() - SYNC_STALE_MS).toISOString();
  let q = supabase.from('now_playing_snapshots').select('*')
    .eq('username', username)
    .gte('updated_at', staleCutoff)
    .order('updated_at', { ascending: false });
  if (excludeDeviceId) q = q.neq('device_id', excludeDeviceId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

// Best-effort only — deletes the *puller's own* row after they've pulled
// someone else's snapshot into it, so a device that just adopted another
// device's queue doesn't immediately show up as its own separate stale
// "continue here" entry the next time it lists devices. Not deleting the
// *source* snapshot: the same source device staying in its own list (still
// playing, unaffected by someone else pulling a copy of its state) is
// correct — pulling is a copy, not a move.
async function dbDeleteNowPlayingSnapshot(username, deviceId) {
  await supabase.from('now_playing_snapshots').delete().eq('username', username).eq('device_id', deviceId);
}

// POST /api/sync/now-playing — report this device's current now-playing
// state. Called by the client on play/pause/track-change and on a slow
// interval while playing (see syncReportNowPlaying in index.html) — never
// on every timeupdate tick, to keep write volume sane. Premium-gated to
// match every other Experimental Labs feature being locked at the API
// layer, not just the panel UI (see requirePremium doc comment above).
app.post('/api/sync/now-playing', requirePremium, async (req, res) => {
  const { deviceId, deviceLabel, queue, activeIndex, positionSeconds } = req.body;
  const sess = req._premiumSession;
  if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 100)
    return res.status(400).json({ error: '"deviceId" is required.' });
  if (!Array.isArray(queue)) return res.status(400).json({ error: '"queue" must be an array.' });
  if (queue.length > SYNC_MAX_QUEUE_ITEMS)
    return res.status(413).json({ error: `Queue exceeds ${SYNC_MAX_QUEUE_ITEMS} items.` });

  const sanitizedQueue = queue.map(sanitizeSyncQueueItem).filter(Boolean);
  if (JSON.stringify(sanitizedQueue).length > SYNC_MAX_QUEUE_BYTES)
    return res.status(413).json({ error: 'Queue data too large to sync.' });

  const safeActiveIndex = Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < sanitizedQueue.length
    ? activeIndex : -1;
  const safePosition = Number.isFinite(positionSeconds) && positionSeconds >= 0 ? positionSeconds : 0;

  try {
    await dbUpsertNowPlayingSnapshot(sess.username, {
      deviceId: deviceId.trim(),
      deviceLabel: typeof deviceLabel === 'string' ? deviceLabel : null,
      queue: sanitizedQueue,
      activeIndex: safeActiveIndex,
      positionSeconds: safePosition,
    });
    return res.json({ ok: true, synced: sanitizedQueue.length, syncedAt: Date.now() });
  } catch (err) {
    console.error('[sync now-playing]', err?.message || err);
    return res.status(500).json({ error: 'Could not sync now-playing state.' });
  }
});

// GET /api/sync/devices?token=&deviceId= — list this user's *other*
// recently-active devices with their last-reported snapshot, for a
// "Continue on this device" picker. deviceId (this device's own id) is
// excluded from the results so a device never offers to hand off to
// itself.
app.get('/api/sync/devices', requirePremium, async (req, res) => {
  const sess = req._premiumSession;
  try {
    const rows = await dbGetOtherNowPlayingSnapshots(sess.username, req.query.deviceId);
    return res.json({
      devices: rows.map(r => ({
        deviceId: r.device_id,
        deviceLabel: r.device_label,
        queue: r.queue || [],
        activeIndex: r.active_index,
        positionSeconds: r.position_seconds,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('[sync devices]', err?.message || err);
    return res.status(500).json({ error: 'Could not load other devices.' });
  }
});

// POST /api/sync/now-playing/pull — housekeeping only (see
// dbDeleteNowPlayingSnapshot doc comment above). The actual "load this
// queue into my player" logic is entirely client-side once GET
// /api/sync/devices has already handed over the snapshot data; this call
// doesn't return playback state, it just cleans up the puller's own prior
// row. Safe to fire-and-forget from the client.
app.post('/api/sync/now-playing/pull', requirePremium, async (req, res) => {
  const { deviceId } = req.body;
  const sess = req._premiumSession;
  if (typeof deviceId !== 'string' || !deviceId.trim())
    return res.status(400).json({ error: '"deviceId" is required.' });
  try {
    await dbDeleteNowPlayingSnapshot(sess.username, deviceId.trim());
    return res.json({ ok: true });
  } catch (err) {
    console.error('[sync now-playing pull]', err?.message || err);
    return res.status(500).json({ error: 'Could not complete handoff cleanup.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SHARED PLAYLISTS — collaboration invites, roles, realtime SSE
//
//  POST   /api/playlists/:id/collaborators          { token, username, role }
//  GET    /api/playlists/:id/collaborators          ?token=
//  PATCH  /api/playlists/:id/collaborators/:user    { token, role }
//  DELETE /api/playlists/:id/collaborators/:user    { token }
//
//  POST   /api/playlists/:id/invites/accept/:inviteId  { token }
//  POST   /api/playlists/:id/invites/decline/:inviteId { token }
//  DELETE /api/playlists/:id/invites/:inviteId         { token }  (owner cancel)
//
//  GET    /api/playlists/invites/mine               ?token=   → pending invites for me
//  GET    /api/playlists/shared-with-me             ?token=   → playlists I'm a collaborator on
//
//  GET    /api/playlists/:id/realtime               SSE stream: track/collab/invite changes
//                                                    (Postgres Realtime) + presence_join/
//                                                    presence_leave/presence_snapshot/typing/edit
//                                                    (ephemeral, in-memory only — see below)
//  POST   /api/playlists/:id/typing                 { token }  → broadcast "I'm editing" ping
//
//  V2 — edit history + undo (playlist_edit_log table, distinct from activity_feed
//  which has no undo concept):
//  GET    /api/playlists/:id/edit-log                ?token=   → recent add/remove history
//  POST   /api/playlists/:id/edit-log/:entryId/undo  { token } → reverse that edit
// ═══════════════════════════════════════════════════════════════════════════════

// Invite a user to collaborate -------------------------------------------------
app.post('/api/playlists/:id/collaborators', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  const { username, role = 'viewer' } = req.body;
  if (!username) return res.status(400).json({ error: '"username" is required.' });
  if (!['editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'role must be "editor" or "viewer".' });
  const pl = await dbGetPlaylist(req.params.id);
  if (!pl || pl.owner !== sess.username) return res.status(404).json({ error: 'Playlist not found.' });
  // Verify the invitee exists
  const invitee = normalizeUsername(username);
  const inviteeProfile = await dbGetProfile(invitee);
  if (!inviteeProfile) return res.status(404).json({ error: `User @${invitee} not found.` });
  try {
    const invite = await dbInviteCollaborator(req.params.id, sess.username, invitee, role);
    return res.status(201).json({ inviteId: invite.id, invitee, role, status: 'pending' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// List collaborators (+ pending invites for owner) ----------------------------
app.get('/api/playlists/:id/collaborators', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  const pl = await dbGetPlaylist(req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found.' });
  const role = await dbGetCollabRole(req.params.id, sess.username);
  if (!role) return res.status(404).json({ error: 'Playlist not found.' });
  const collaborators = await dbGetCollaborators(req.params.id);
  const pendingInvites = role === 'owner' ? await dbGetPendingInvites(req.params.id) : [];
  return res.json({ collaborators, pendingInvites });
});

// Update a collaborator's role ------------------------------------------------
app.patch('/api/playlists/:id/collaborators/:user', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  const { role } = req.body;
  if (!['editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'role must be "editor" or "viewer".' });
  try {
    await dbUpdateCollaboratorRole(req.params.id, sess.username, req.params.user, role);
    return res.json({ updated: true });
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
});

// Remove a collaborator (owner only) ------------------------------------------
app.delete('/api/playlists/:id/collaborators/:user', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    await dbRemoveCollaborator(req.params.id, sess.username, req.params.user);
    return res.json({ removed: true });
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
});

// Accept an invite ------------------------------------------------------------
app.post('/api/playlists/:id/invites/accept/:inviteId', async (req, res) => {
  const { token } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const result = await dbAcceptInvite(req.params.inviteId, sess.username);
    // Notify the playlist owner and broadcast globally
    const joinedPlaylist = await dbGetPlaylist(result.playlistId);
    if (joinedPlaylist) {
      dbWriteActivity('collab_joined', sess.username, joinedPlaylist.owner, {
        playlistId: result.playlistId,
        playlistName: joinedPlaylist.name,
        role: result.role,
      });
    }
    return res.json({ accepted: true, ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Decline an invite (invitee) / cancel (owner) --------------------------------
app.post('/api/playlists/:id/invites/decline/:inviteId', async (req, res) => {
  const { token } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    await dbDeclineInvite(req.params.inviteId, sess.username);
    return res.json({ declined: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Owner cancel pending invite -------------------------------------------------
app.delete('/api/playlists/:id/invites/:inviteId', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    await dbDeclineInvite(req.params.inviteId, sess.username);
    return res.json({ cancelled: true });
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
});

// Pending invites waiting for the current user --------------------------------
// ─── Realtime SSE fan-out ────────────────────────────────────────────────────
// Clients subscribe to GET /api/playlists/:id/realtime (SSE). The server holds
// a Supabase Realtime channel per playlist-id and fans out track + collaborator
// change events to all connected browsers. No anon key is shipped to the client.

const playlistSseClients = new Map(); // playlistId → Set<res>
const playlistRealtimeChannels = new Map(); // playlistId → supabase channel

function getOrCreateRealtimeChannel(playlistId) {
  if (playlistRealtimeChannels.has(playlistId)) return;
  const channel = supabase
    .channel(`playlist:${playlistId}`)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'playlist_tracks', filter: `playlist_id=eq.${playlistId}` },
        (payload) => broadcastToPlaylist(playlistId, { type: 'tracks', payload }))
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'playlist_collaborators', filter: `playlist_id=eq.${playlistId}` },
        (payload) => broadcastToPlaylist(playlistId, { type: 'collaborators', payload }))
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'playlist_invites', filter: `playlist_id=eq.${playlistId}` },
        (payload) => broadcastToPlaylist(playlistId, { type: 'invites', payload }))
    .subscribe();
  playlistRealtimeChannels.set(playlistId, channel);
}

function broadcastToPlaylist(playlistId, data) {
  const clients = playlistSseClients.get(playlistId);
  if (!clients || !clients.size) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch (_) { /* client disconnected */ }
  }
}

function removeSseClient(playlistId, res) {
  const clients = playlistSseClients.get(playlistId);
  if (!clients) return;
  clients.delete(res);
  if (!clients.size) {
    // No more listeners — tear down the Supabase channel to free resources.
    const ch = playlistRealtimeChannels.get(playlistId);
    if (ch) { supabase.removeChannel(ch); playlistRealtimeChannels.delete(playlistId); }
    playlistSseClients.delete(playlistId);
    playlistPresence.delete(playlistId);
  } else if (res._presenceUsername) {
    // Someone left but others remain — drop them from presence and tell
    // the rest of the room, mirroring a Postgres DELETE fan-out above even
    // though presence itself never touches the database (see note below).
    dropPresence(playlistId, res._presenceUsername);
  }
}

// ─── Presence + typing (ephemeral, in-memory only) ──────────────────────────
// "Who's currently viewing this playlist" and "who's mid-edit right now"
// are not durable facts worth a table or a Postgres Realtime round-trip —
// they're pushed straight through the same playlistSseClients fan-out used
// for track/collaborator/invite changes above. One Map entry per playlist,
// keyed by username, holding a ref count (a user can have >1 tab/device
// open on the same playlist and should still show as present after closing
// one of them).
const playlistPresence = new Map(); // playlistId → Map<username, {count, label}>

function addPresence(playlistId, username, label) {
  if (!playlistPresence.has(playlistId)) playlistPresence.set(playlistId, new Map());
  const room = playlistPresence.get(playlistId);
  const existing = room.get(username);
  if (existing) { existing.count++; return; }
  room.set(username, { count: 1, label: label || username });
  broadcastToPlaylist(playlistId, { type: 'presence_join', payload: { username } });
}

function dropPresence(playlistId, username) {
  const room = playlistPresence.get(playlistId);
  if (!room || !room.has(username)) return;
  const entry = room.get(username);
  entry.count--;
  if (entry.count <= 0) {
    room.delete(username);
    broadcastToPlaylist(playlistId, { type: 'presence_leave', payload: { username } });
  }
  if (!room.size) playlistPresence.delete(playlistId);
}

app.get('/api/playlists/:id/realtime', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).end();

  const { id } = req.params;
  const pl = await dbGetPlaylist(id);
  const role = pl ? await dbGetCollabRole(id, sess.username) : null;
  // Must be owner, collaborator, OR viewing a public playlist to subscribe.
  if (!pl || (!role && !pl.is_public)) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  if (!playlistSseClients.has(id)) playlistSseClients.set(id, new Set());
  playlistSseClients.get(id).add(res);
  getOrCreateRealtimeChannel(id);

  // Tag this connection with who it belongs to so removeSseClient can drop
  // presence on disconnect, and hand the newly-joined client a snapshot of
  // who's already here (their own join event fires to *other* clients via
  // addPresence, but they still need the initial roster themselves).
  res._presenceUsername = sess.username;
  addPresence(id, sess.username);
  const room = playlistPresence.get(id);
  res.write(`data: ${JSON.stringify({
    type: 'presence_snapshot',
    payload: { usernames: room ? [...room.keys()] : [] },
  })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSseClient(id, res);
  });
});

// POST /api/playlists/:id/typing — fire-and-forget ephemeral ping, "I'm
// currently editing this playlist." No persistence, no rate-limit table of
// its own (playlistRateLimit's 60/min is already generous and this is a
// lightweight broadcast, not a write). Broadcasts to every OTHER connected
// client via the same SSE fan-out; the sender doesn't need their own ping
// echoed back.
app.post('/api/playlists/:id/typing', playlistRateLimit, async (req, res) => {
  const sess = req._session;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  const pl = await dbGetPlaylist(req.params.id);
  const role = pl ? await dbGetCollabRole(req.params.id, sess.username) : null;
  if (!pl || !role) return res.status(404).json({ error: 'Playlist not found.' });
  broadcastToPlaylist(req.params.id, { type: 'typing', payload: { username: sess.username } });
  return res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LISTENING PARTIES  (Phase 4 / Step 2)
//
//  Reuses rather than duplicates:
//   - PlaybackManager / playItem (client-side) — the party never touches
//     playback directly; it pushes track/play/pause/seek events and lets
//     each guest's existing player respond, exactly like a local queue
//     change would.
//   - The Shared-Playlists SSE pattern (in-memory Map<roomId, Set<res>>
//     fanned out by broadcastToPlaylist) — copied to a party-scoped room
//     instead of a playlist id, not reinvented. See playlistSseClients
//     above for the original.
//   - now_playing_snapshots — starting a party upserts the host's own
//     snapshot row (see dbUpsertNowPlayingSnapshot) so their other
//     signed-in devices see "Listening Party" in the existing multi-
//     device list, same mechanism as any other now-playing report.
//   - requirePremium — same Premium gate as DJ BOOM / Labs / multi-device
//     sync, enforced at the API layer.
//   - dbWriteActivity — party start/end and host-transfer events land in
//     the existing activity_feed, same as everything else social in FREQ.
//
//  New surface, backed by listening_parties / listening_party_members /
//  listening_party_queue / listening_party_chat (see migrations/
//  create_listening_parties.sql):
//
//  POST   /api/parties                        { token, title, isPublic? }        → create + auto-join as host
//  GET    /api/parties/discover                                                   → public, currently-live parties
//  GET    /api/parties/:id                    ?token=                             → full state (members, queue, playback)
//  POST   /api/parties/:id/join                { token, inviteCode? }             → join as guest (inviteCode required unless public)
//  POST   /api/parties/:id/leave               { token }
//  DELETE /api/parties/:id                     { token }                          → host ends the party
//
//  POST   /api/parties/:id/playback             { token, action, rowId?, positionSeconds? }  action: play|pause|seek|track_change
//  POST   /api/parties/:id/transfer-host        { token, toUsername }
//  PATCH  /api/parties/:id/permissions          { token, guestCanQueue?, queueRequiresApproval? }
//
//  POST   /api/parties/:id/queue                { token, trackData }              → add (auto-approved unless approval required)
//  POST   /api/parties/:id/queue/:rowId/approve  { token }
//  POST   /api/parties/:id/queue/:rowId/reject   { token }
//  DELETE /api/parties/:id/queue/:rowId          { token }
//
//  POST   /api/parties/:id/chat                  { token, message }
//  GET    /api/parties/:id/realtime              SSE — member/queue/playback/chat events
// ═══════════════════════════════════════════════════════════════════════════════

function generatePartyInviteCode() {
  // Short, shareable, avoids visually-ambiguous characters (0/O, 1/I/l) —
  // this is read aloud / typed by hand far more often than a playlist id
  // ever is, so it gets its own charset rather than reusing a uuid slice.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function dbCreateParty(host, { title, isPublic }) {
  let inviteCode, attempt = 0;
  // Collisions are astronomically unlikely at 32^6, but a unique-constraint
  // retry loop is cheap insurance rather than trusting probability alone.
  while (attempt < 5) {
    inviteCode = generatePartyInviteCode();
    const { data, error } = await supabase
      .from('listening_parties')
      .insert({ host, title: (title || 'Listening Party').slice(0, 120), is_public: !!isPublic, invite_code: inviteCode })
      .select()
      .single();
    if (!error) {
      await supabase.from('listening_party_members').insert({ party_id: data.id, username: host, role: 'host' });
      return data;
    }
    if (!/duplicate key/i.test(error.message)) throw new Error(error.message);
    attempt++;
  }
  throw new Error('Could not generate a unique invite code — please try again.');
}

async function dbGetParty(id) {
  const { data, error } = await supabase.from('listening_parties').select('*').eq('id', id).maybeSingle();
  if (error) { console.error('[db] getParty:', error.message); return null; }
  return data;
}

async function dbGetPartyByInviteCode(code) {
  const { data, error } = await supabase.from('listening_parties').select('*')
    .eq('invite_code', code.toUpperCase()).is('ended_at', null).maybeSingle();
  if (error) { console.error('[db] getPartyByInviteCode:', error.message); return null; }
  return data;
}

async function dbGetPartyMembers(partyId) {
  const { data, error } = await supabase.from('listening_party_members')
    .select('username, role, joined_at').eq('party_id', partyId).order('joined_at', { ascending: true });
  if (error) { console.error('[db] getPartyMembers:', error.message); return []; }
  return data || [];
}

async function dbGetPartyRole(partyId, username) {
  const { data, error } = await supabase.from('listening_party_members')
    .select('role').eq('party_id', partyId).eq('username', username).maybeSingle();
  if (error || !data) return null;
  return data.role;
}

async function dbAddPartyMember(partyId, username, role = 'guest') {
  const { error } = await supabase.from('listening_party_members')
    .upsert({ party_id: partyId, username, role }, { onConflict: 'party_id,username' });
  if (error) throw new Error(error.message);
}

async function dbRemovePartyMember(partyId, username) {
  await supabase.from('listening_party_members').delete().eq('party_id', partyId).eq('username', username);
}

async function dbEndParty(partyId, host) {
  const { error } = await supabase.from('listening_parties')
    .update({ ended_at: new Date().toISOString(), is_playing: false })
    .eq('id', partyId).eq('host', host);
  if (error) throw new Error(error.message);
}

async function dbTransferPartyHost(partyId, fromUsername, toUsername) {
  const party = await dbGetParty(partyId);
  if (!party || party.host !== fromUsername) throw new Error('Only the current host can transfer hosting.');
  const toRole = await dbGetPartyRole(partyId, toUsername);
  if (!toRole) throw new Error('That user is not in this party.');
  await supabase.from('listening_parties').update({ host: toUsername }).eq('id', partyId);
  await supabase.from('listening_party_members').update({ role: 'host' }).eq('party_id', partyId).eq('username', toUsername);
  await supabase.from('listening_party_members').update({ role: 'cohost' }).eq('party_id', partyId).eq('username', fromUsername);
}

async function dbUpdatePartyPermissions(partyId, host, patch) {
  const { error } = await supabase.from('listening_parties').update(patch).eq('id', partyId).eq('host', host);
  if (error) throw new Error(error.message);
}

// Playback state lives directly on listening_parties (one row, no history
// needed) — position_updated_at lets a client that joins mid-song
// extrapolate "the host was at 43s, 2s have passed since that push, so
// start around 45s" without a constant position-tick stream.
async function dbSetPartyPlayback(partyId, patch) {
  const { data, error } = await supabase.from('listening_parties')
    .update({ ...patch, position_updated_at: new Date().toISOString() })
    .eq('id', partyId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbGetPartyQueue(partyId) {
  const { data, error } = await supabase.from('listening_party_queue')
    .select('id, position, track_data, added_by, status, created_at')
    .eq('party_id', partyId).order('position', { ascending: true });
  if (error) { console.error('[db] getPartyQueue:', error.message); return []; }
  return data || [];
}

async function dbAddToPartyQueue(partyId, trackData, addedBy, status) {
  const { count } = await supabase.from('listening_party_queue')
    .select('id', { count: 'exact', head: true }).eq('party_id', partyId);
  const { data, error } = await supabase.from('listening_party_queue')
    .insert({ party_id: partyId, position: count || 0, track_data: trackData, added_by: addedBy, status })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbSetPartyQueueStatus(partyId, rowId, status) {
  const { data, error } = await supabase.from('listening_party_queue')
    .update({ status }).eq('id', rowId).eq('party_id', partyId).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function dbRemoveFromPartyQueue(partyId, rowId) {
  await supabase.from('listening_party_queue').delete().eq('id', rowId).eq('party_id', partyId);
}

async function dbGetPartyChat(partyId, { limit = 50 } = {}) {
  const { data, error } = await supabase.from('listening_party_chat')
    .select('id, username, message, created_at').eq('party_id', partyId)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('[db] getPartyChat:', error.message); return []; }
  return (data || []).reverse();
}

async function dbAddPartyChatMessage(partyId, username, message) {
  const { data, error } = await supabase.from('listening_party_chat')
    .insert({ party_id: partyId, username, message: message.slice(0, 500) })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbGetLivePublicParties({ limit = 30 } = {}) {
  const { data, error } = await supabase.from('listening_parties')
    .select('id, host, title, created_at')
    .eq('is_public', true).is('ended_at', null)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('[db] getLivePublicParties:', error.message); return []; }
  return data || [];
}

// ─── Realtime SSE fan-out — identical shape to playlistSseClients above,
// scoped to party id instead of playlist id. Two independent Maps rather
// than sharing playlistSseClients keyed by a combined id, since a party
// and a playlist are different trust boundaries (party membership isn't
// playlist collaboration) and mixing them would make removeSseClient's
// teardown logic ambiguous about which kind of room it's cleaning up.
const partySseClients = new Map(); // partyId → Set<res>

function broadcastToParty(partyId, data) {
  const clients = partySseClients.get(partyId);
  if (!clients || !clients.size) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch (_) { /* client disconnected */ }
  }
}

function removePartySseClient(partyId, res) {
  const clients = partySseClients.get(partyId);
  if (!clients) return;
  clients.delete(res);
  if (!clients.size) partySseClients.delete(partyId);
}

// POST /api/parties — create + auto-join as host.
app.post('/api/parties', requirePremium, async (req, res) => {
  const { title, isPublic } = req.body;
  try {
    const party = await dbCreateParty(req._premiumSession.username, { title, isPublic });
    // Reuse now_playing_snapshots: report a synthetic snapshot so this
    // host's other devices see "Listening Party" via the existing
    // multi-device list, same as any other now-playing state.
    dbUpsertNowPlayingSnapshot(req._premiumSession.username, {
      deviceId: `party:${party.id}`, deviceLabel: `Hosting: ${party.title}`,
      queue: [], activeIndex: -1, positionSeconds: 0,
    }).catch(() => {});
    dbWriteActivity('party_started', req._premiumSession.username, null, {
      partyId: party.id, partyTitle: party.title,
    });
    return res.status(201).json({
      id: party.id, title: party.title, isPublic: party.is_public,
      inviteCode: party.invite_code, host: party.host,
    });
  } catch (err) {
    console.error('[parties create]', err);
    return res.status(500).json({ error: 'Could not start a listening party.' });
  }
});

// GET /api/parties/discover — public, currently-live parties. No auth
// required to browse, matching Discovery/Charts' "works for a visitor
// before signing in" philosophy — joining still requires Premium.
app.get('/api/parties/discover', async (req, res) => {
  try {
    const rows = await dbGetLivePublicParties();
    return res.json({
      parties: rows.map(p => ({ id: p.id, host: p.host, title: p.title, startedAt: p.created_at })),
    });
  } catch (err) {
    console.error('[parties discover]', err);
    return res.status(500).json({ error: 'Could not load live parties.' });
  }
});

// GET /api/parties/:id — full state for the party viewer.
app.get('/api/parties/:id', requirePremium, async (req, res) => {
  try {
    const party = await dbGetParty(req.params.id);
    if (!party || party.ended_at) return res.status(404).json({ error: 'Party not found or has ended.' });
    const role = await dbGetPartyRole(party.id, req._premiumSession.username);
    if (!role && !party.is_public) return res.status(404).json({ error: 'Party not found.' });
    const [members, queue, chat] = await Promise.all([
      dbGetPartyMembers(party.id),
      dbGetPartyQueue(party.id),
      role ? dbGetPartyChat(party.id) : Promise.resolve([]),
    ]);
    return res.json({
      id: party.id, title: party.title, host: party.host, isPublic: party.is_public,
      guestCanQueue: party.guest_can_queue, queueRequiresApproval: party.queue_requires_approval,
      myRole: role || null,
      playback: {
        currentRowId: party.current_row_id, isPlaying: party.is_playing,
        positionSeconds: party.position_seconds, positionUpdatedAt: party.position_updated_at,
      },
      members: members.map(m => ({ username: m.username, role: m.role, joinedAt: m.joined_at })),
      queue: queue.map(q => ({ rowId: q.id, position: q.position, ...q.track_data, addedBy: q.added_by, status: q.status })),
      chat: chat.map(c => ({ id: c.id, username: c.username, message: c.message, createdAt: c.created_at })),
    });
  } catch (err) {
    console.error('[parties get]', err);
    return res.status(500).json({ error: 'Could not load party.' });
  }
});

// POST /api/parties/:id/join — inviteCode required for a private party;
// a public party can be joined directly from Discover with no code.
app.post('/api/parties/:id/join', requirePremium, async (req, res) => {
  const { inviteCode } = req.body;
  try {
    const party = await dbGetParty(req.params.id);
    if (!party || party.ended_at) return res.status(404).json({ error: 'Party not found or has ended.' });
    if (!party.is_public) {
      if (!inviteCode || inviteCode.toUpperCase() !== party.invite_code) {
        return res.status(403).json({ error: 'Invalid invite code.' });
      }
    }
    const existingRole = await dbGetPartyRole(party.id, req._premiumSession.username);
    if (!existingRole) await dbAddPartyMember(party.id, req._premiumSession.username, 'guest');
    broadcastToParty(party.id, { type: 'member_joined', payload: { username: req._premiumSession.username } });
    return res.json({ joined: true, role: existingRole || 'guest' });
  } catch (err) {
    console.error('[parties join]', err);
    return res.status(500).json({ error: 'Could not join party.' });
  }
});

// POST /api/parties/:id/leave
app.post('/api/parties/:id/leave', requirePremium, async (req, res) => {
  try {
    const party = await dbGetParty(req.params.id);
    if (!party) return res.status(404).json({ error: 'Party not found.' });
    if (party.host === req._premiumSession.username) {
      return res.status(400).json({ error: 'Transfer hosting or end the party instead of leaving as host.' });
    }
    await dbRemovePartyMember(party.id, req._premiumSession.username);
    broadcastToParty(party.id, { type: 'member_left', payload: { username: req._premiumSession.username } });
    return res.json({ left: true });
  } catch (err) {
    console.error('[parties leave]', err);
    return res.status(500).json({ error: 'Could not leave party.' });
  }
});

// DELETE /api/parties/:id — host ends the party for everyone.
app.delete('/api/parties/:id', requirePremium, async (req, res) => {
  try {
    await dbEndParty(req.params.id, req._premiumSession.username);
    broadcastToParty(req.params.id, { type: 'party_ended', payload: {} });
    dbWriteActivity('party_ended', req._premiumSession.username, null, { partyId: req.params.id });
    return res.json({ ended: true });
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
});

// POST /api/parties/:id/playback — host/cohost only. This is the entire
// sync mechanism: the caller pushes an intent, every connected guest
// receives it over SSE and drives their OWN PlaybackManager/playItem in
// response (see collabPartyHandlePlaybackEvent client-side) — the server
// never touches audio itself, it's just relaying host intent, same
// division of responsibility Shared Playlists already has between
// Postgres changes and client-side re-render.
app.post('/api/parties/:id/playback', requirePremium, async (req, res) => {
  const { action, rowId, positionSeconds } = req.body;
  if (!['play', 'pause', 'seek', 'track_change'].includes(action)) {
    return res.status(400).json({ error: 'Invalid playback action.' });
  }
  try {
    const party = await dbGetParty(req.params.id);
    if (!party || party.ended_at) return res.status(404).json({ error: 'Party not found or has ended.' });
    const role = await dbGetPartyRole(party.id, req._premiumSession.username);
    if (role !== 'host' && role !== 'cohost') return res.status(403).json({ error: 'Only the host can control playback.' });

    const patch = {};
    if (action === 'play') patch.is_playing = true;
    if (action === 'pause') patch.is_playing = false;
    if (action === 'seek') patch.position_seconds = Number.isFinite(positionSeconds) ? positionSeconds : 0;
    if (action === 'track_change') {
      patch.current_row_id = rowId || null;
      patch.position_seconds = 0;
      patch.is_playing = true;
    }
    const updated = await dbSetPartyPlayback(party.id, patch);
    broadcastToParty(party.id, {
      type: 'playback', payload: {
        action, rowId: updated.current_row_id, isPlaying: updated.is_playing,
        positionSeconds: updated.position_seconds, positionUpdatedAt: updated.position_updated_at,
        actor: req._premiumSession.username,
      },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[parties playback]', err);
    return res.status(500).json({ error: 'Could not update playback.' });
  }
});

// POST /api/parties/:id/transfer-host
app.post('/api/parties/:id/transfer-host', requirePremium, async (req, res) => {
  const { toUsername } = req.body;
  if (!toUsername) return res.status(400).json({ error: '"toUsername" is required.' });
  try {
    await dbTransferPartyHost(req.params.id, req._premiumSession.username, normalizeUsername(toUsername));
    broadcastToParty(req.params.id, {
      type: 'host_transferred',
      payload: { from: req._premiumSession.username, to: normalizeUsername(toUsername) },
    });
    return res.json({ transferred: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// PATCH /api/parties/:id/permissions — host only.
app.patch('/api/parties/:id/permissions', requirePremium, async (req, res) => {
  const { guestCanQueue, queueRequiresApproval } = req.body;
  const patch = {};
  if (typeof guestCanQueue === 'boolean') patch.guest_can_queue = guestCanQueue;
  if (typeof queueRequiresApproval === 'boolean') patch.queue_requires_approval = queueRequiresApproval;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No permission fields provided.' });
  try {
    await dbUpdatePartyPermissions(req.params.id, req._premiumSession.username, patch);
    broadcastToParty(req.params.id, { type: 'permissions', payload: patch });
    return res.json({ updated: true });
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
});

// POST /api/parties/:id/queue — add a track. Auto-approved unless the
// party has queue_requires_approval on AND the caller isn't host/cohost.
app.post('/api/parties/:id/queue', requirePremium, async (req, res) => {
  const { trackData } = req.body;
  if (!trackData || typeof trackData !== 'object') return res.status(400).json({ error: '"trackData" object is required.' });
  try {
    const party = await dbGetParty(req.params.id);
    if (!party || party.ended_at) return res.status(404).json({ error: 'Party not found or has ended.' });
    const role = await dbGetPartyRole(party.id, req._premiumSession.username);
    if (!role) return res.status(404).json({ error: 'Party not found.' });
    const isHostOrCohost = role === 'host' || role === 'cohost';
    if (!isHostOrCohost && !party.guest_can_queue) {
      return res.status(403).json({ error: 'The host has turned off guest song requests.' });
    }
    const status = (!isHostOrCohost && party.queue_requires_approval) ? 'pending' : 'approved';
    const row = await dbAddToPartyQueue(party.id, trackData, req._premiumSession.username, status);
    broadcastToParty(party.id, {
      type: 'queue_add', payload: {
        rowId: row.id, trackTitle: trackData.title || trackData.id || 'Untitled',
        addedBy: req._premiumSession.username, status,
      },
    });
    return res.status(201).json({ rowId: row.id, status });
  } catch (err) {
    console.error('[parties queue add]', err);
    return res.status(500).json({ error: 'Could not add to queue.' });
  }
});

// POST /api/parties/:id/queue/:rowId/approve — host/cohost only.
app.post('/api/parties/:id/queue/:rowId/approve', requirePremium, async (req, res) => {
  try {
    const party = await dbGetParty(req.params.id);
    const role = party ? await dbGetPartyRole(party.id, req._premiumSession.username) : null;
    if (!party || (role !== 'host' && role !== 'cohost')) return res.status(404).json({ error: 'Party not found.' });
    const row = await dbSetPartyQueueStatus(party.id, req.params.rowId, 'approved');
    if (row) broadcastToParty(party.id, { type: 'queue_approved', payload: { rowId: row.id } });
    return res.json({ approved: true });
  } catch (err) {
    console.error('[parties queue approve]', err);
    return res.status(500).json({ error: 'Could not approve request.' });
  }
});

// POST /api/parties/:id/queue/:rowId/reject — host/cohost only.
app.post('/api/parties/:id/queue/:rowId/reject', requirePremium, async (req, res) => {
  try {
    const party = await dbGetParty(req.params.id);
    const role = party ? await dbGetPartyRole(party.id, req._premiumSession.username) : null;
    if (!party || (role !== 'host' && role !== 'cohost')) return res.status(404).json({ error: 'Party not found.' });
    await dbRemoveFromPartyQueue(party.id, req.params.rowId);
    broadcastToParty(party.id, { type: 'queue_rejected', payload: { rowId: req.params.rowId } });
    return res.json({ rejected: true });
  } catch (err) {
    console.error('[parties queue reject]', err);
    return res.status(500).json({ error: 'Could not reject request.' });
  }
});

// DELETE /api/parties/:id/queue/:rowId — host/cohost, or the guest who
// added it, may remove it (same "owner or editor" spirit as playlist
// track removal above).
app.delete('/api/parties/:id/queue/:rowId', requirePremium, async (req, res) => {
  try {
    const party = await dbGetParty(req.params.id);
    if (!party) return res.status(404).json({ error: 'Party not found.' });
    const role = await dbGetPartyRole(party.id, req._premiumSession.username);
    if (!role) return res.status(404).json({ error: 'Party not found.' });
    const queue = await dbGetPartyQueue(party.id);
    const row = queue.find(q => q.id === req.params.rowId);
    const canRemove = role === 'host' || role === 'cohost' || row?.added_by === req._premiumSession.username;
    if (!row || !canRemove) return res.status(403).json({ error: 'Not authorised to remove this track.' });
    await dbRemoveFromPartyQueue(party.id, req.params.rowId);
    broadcastToParty(party.id, { type: 'queue_removed', payload: { rowId: req.params.rowId } });
    return res.json({ removed: true });
  } catch (err) {
    console.error('[parties queue remove]', err);
    return res.status(500).json({ error: 'Could not remove track.' });
  }
});

// POST /api/parties/:id/chat
const partyChatRateLimitHits = new Map();
app.post('/api/parties/:id/chat', requirePremium, async (req, res) => {
  const { message } = req.body;
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: '"message" is required.' });
  if (!req._premiumSession.emailVerified) return res.status(403).json({ error: 'Please verify your email address before chatting.', emailVerificationRequired: true });
  const key = req._premiumSession.username;
  const now = Date.now();
  const times = (partyChatRateLimitHits.get(key) || []).filter(t => now - t < 10_000);
  if (times.length >= 10) return res.status(429).json({ error: 'Sending messages too fast — slow down.' });
  times.push(now); partyChatRateLimitHits.set(key, times);
  try {
    const party = await dbGetParty(req.params.id);
    const role = party ? await dbGetPartyRole(party.id, req._premiumSession.username) : null;
    if (!party || !role) return res.status(404).json({ error: 'Party not found.' });
    const row = await dbAddPartyChatMessage(party.id, req._premiumSession.username, message.trim());
    broadcastToParty(party.id, {
      type: 'chat', payload: { id: row.id, username: row.username, message: row.message, createdAt: row.created_at },
    });
    return res.status(201).json({ sent: true });
  } catch (err) {
    console.error('[parties chat]', err);
    return res.status(500).json({ error: 'Could not send message.' });
  }
});
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of partyChatRateLimitHits) {
    const fresh = times.filter(t => now - t < 10_000);
    if (!fresh.length) partyChatRateLimitHits.delete(key); else partyChatRateLimitHits.set(key, fresh);
  }
}, 60_000);

// GET /api/parties/:id/realtime — SSE stream, same shape as
// GET /api/playlists/:id/realtime above (heartbeat, single Set<res> per
// room, teardown on close).
app.get('/api/parties/:id/realtime', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess || !sess.isPremium) return res.status(401).end();

  const { id } = req.params;
  const party = await dbGetParty(id);
  const role = party ? await dbGetPartyRole(id, sess.username) : null;
  if (!party || party.ended_at || (!role && !party.is_public)) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  if (!partySseClients.has(id)) partySseClients.set(id, new Set());
  partySseClients.get(id).add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removePartySseClient(id, res);
  });
});

// Public playlists for a profile — mounted under /api/profiles so it reads
// naturally from the profile viewer, but intentionally returns [] (not 404)
// for a private or nonexistent profile rather than erroring, since the
// profile route itself is what's responsible for surfacing "this profile
// doesn't exist/isn't public" — this endpoint is always a secondary call
// made after that check already passed.
app.get('/api/profiles/:username/playlists', async (req, res) => {
  const key = normalizeUsername(req.params.username);
  if (!key) return res.json({ playlists: [] });
  try {
    const rows = await dbGetPublicPlaylistsForUser(key);
    return res.json({
      playlists: rows.map(p => ({
        id: p.id, name: p.name, description: p.description, trackCount: p.track_count,
        likeCount: p.like_count || 0,
      })),
    });
  } catch (err) {
    console.error('[profile playlists]', err);
    return res.json({ playlists: [] });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CLOUD FILES  — Supabase Storage (private bucket) + Postgres metadata
//  POST   /api/cloud-files        { token, filename, mimeType, data }  data = base64 data URL
//  GET    /api/cloud-files        ?token=...   → list of { id, filename, size, mimeType, uploadedAt }
//  GET    /api/cloud-files/:id    ?token=...   → { ...metadata, url } url = short-lived signed URL
//  DELETE /api/cloud-files/:id    { token }
// ═══════════════════════════════════════════════════════════════════════════════

const CLOUD_FILE_MAX_BYTES = 20 * 1048576; // 20MB, matches client-side cap
const SIGNED_URL_TTL_SECONDS = 60 * 10;    // 10 minutes — long enough to start playback, short enough to limit exposure if a link leaks

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

// Folders are a flat, single-level string per file (no nested paths).
// Trims whitespace, collapses internal whitespace, caps length, and
// treats empty string the same as "no folder" (stored as null).
function normalizeFolderName(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(/\s+/g, ' ').slice(0, 100);
  return cleaned || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COPYRIGHT & RIGHTS PROTECTION
//
//  Chromaprint, AcoustID, and MusicBrainz identify recordings/metadata. They
//  do not establish legal ownership and are never treated as an infringement
//  verdict here. A match is stored as one review signal alongside the uploader's
//  declaration, internal FREQ duplicates, and any supporting evidence.
// ═══════════════════════════════════════════════════════════════════════════════

const RIGHTS_EVIDENCE_BUCKET = 'rights-evidence';
const RIGHTS_ALLOWED_EVIDENCE_TYPES = new Set([
  'license_or_permission', 'ownership_record', 'public_domain_source', 'dispute_support', 'other',
]);

function rightsDeclarationFromBody(body = {}, hasEvidence = false) {
  return normalizeRightsDeclaration({
    basis: body.rightsBasis || body.basis,
    rightsHolder: body.rightsHolder,
    territories: body.rightsTerritories || body.territories,
    licenseExpiry: body.rightsLicenseExpiry || body.licenseExpiry,
    notes: body.rightsNotes || body.notes,
    attested: body.rightsAttested ?? body.attested,
    hasEvidence,
  });
}

async function dbFindInternalRightsCandidates({ sha256, duration }) {
  const exactQuery = supabase
    .from('rights_reviews')
    .select('cloud_file_id, owner, sha256, duration_seconds, fingerprint_raw')
    .eq('sha256', sha256)
    .limit(20);

  let fingerprintQuery = null;
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) {
    const tolerance = Math.max(5, Number(duration) * 0.08);
    fingerprintQuery = supabase
      .from('rights_reviews')
      .select('cloud_file_id, owner, sha256, duration_seconds, fingerprint_raw')
      .not('fingerprint_raw', 'is', null)
      .gte('duration_seconds', Number(duration) - tolerance)
      .lte('duration_seconds', Number(duration) + tolerance)
      .limit(100);
  }

  const [exactResult, fingerprintResult] = await Promise.all([
    exactQuery,
    fingerprintQuery || Promise.resolve({ data: [], error: null }),
  ]);
  const queryError = exactResult.error || fingerprintResult.error;
  if (queryError) {
    if (queryError.code === '42P01' || /rights_reviews/i.test(queryError.message || '')) {
      throw Object.assign(new Error('The copyright database migration has not been applied.'), { code: 'RIGHTS_MIGRATION_REQUIRED' });
    }
    throw new Error(queryError.message);
  }

  const byCloudFile = new Map();
  for (const row of [...(exactResult.data || []), ...(fingerprintResult.data || [])]) {
    byCloudFile.set(String(row.cloud_file_id), row);
  }
  return [...byCloudFile.values()];
}

function shapeRightsReview(row, options = {}) {
  if (!row) return null;
  const publicSignals = Array.isArray(row.signals)
    ? row.signals.map(signal => {
        if (options.admin || signal?.sameUploader === true) return signal;
        const { matchedCloudFileId: _hiddenMatchedId, ...safeSignal } = signal || {};
        return safeSignal;
      })
    : [];
  const shaped = {
    id: row.id,
    cloudFileId: row.cloud_file_id,
    status: row.status,
    decisionCode: row.decision_code,
    basis: row.declaration_basis,
    rightsHolder: row.rights_holder,
    territories: row.territories,
    licenseExpiry: row.license_expiry,
    notes: row.declaration_notes,
    attested: !!row.attested,
    validationStatus: row.validation_status,
    securityScanStatus: row.security_scan_status,
    fingerprintStatus: row.fingerprint_status,
    acoustidStatus: row.acoustid_status,
    musicbrainzStatus: row.musicbrainz_status,
    externalMatchScore: row.acoustid_match_score,
    externalRecordingId: row.acoustid_recording_id,
    externalMatches: row.acoustid_matches || [],
    musicbrainzRecording: row.musicbrainz_recording || null,
    internalMatchType: row.internal_match_type,
    matchedCloudFileId: options.admin || row.matched_same_owner ? row.matched_cloud_file_id : null,
    matchedSameOwner: row.matched_same_owner,
    signals: publicSignals,
    message: row.user_message,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disclaimer: 'Recording matches are identification signals only. They do not prove copyright ownership or infringement.',
  };
  if (options.admin) {
    shaped.owner = row.owner;
    shaped.riskScore = row.risk_score;
    shaped.sha256 = row.sha256;
    shaped.internalMatchScore = row.internal_match_score;
    shaped.securityScanDetail = row.security_scan_detail;
    shaped.providerVersions = row.provider_versions || {};
    shaped.reviewerNote = row.reviewer_note;
    shaped.reviewedBy = row.reviewed_by;
  }
  return shaped;
}

async function dbGetRightsReviewForOwner(cloudFileId, owner) {
  const { data, error } = await supabase
    .from('rights_reviews')
    .select('*')
    .eq('cloud_file_id', cloudFileId)
    .eq('owner', owner)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function dbGetRightsReviewMap(cloudFileIds, owner) {
  if (!cloudFileIds.length) return new Map();
  const { data, error } = await supabase
    .from('rights_reviews')
    .select('*')
    .eq('owner', owner)
    .in('cloud_file_id', cloudFileIds);
  if (error) throw new Error(error.message);
  return new Map((data || []).map(row => [String(row.cloud_file_id), row]));
}

async function dbLogRightsAction({ reviewId = null, claimId = null, actor, action, fromStatus = null, toStatus = null, detail = {} }) {
  const { error } = await supabase.from('rights_audit_log').insert({
    review_id: reviewId,
    claim_id: claimId,
    actor,
    action,
    from_status: fromStatus,
    to_status: toStatus,
    detail,
  });
  if (error) console.error('[rights audit]', error.message);
}

async function dbPersistRightsReview(cloudFileId, owner, analysis) {
  const row = {
    cloud_file_id: cloudFileId,
    owner,
    status: analysis.decision.status,
    decision_code: analysis.decision.code,
    risk_score: analysis.decision.riskScore,
    declaration_basis: analysis.declaration.basis,
    rights_holder: analysis.declaration.rightsHolder,
    territories: analysis.declaration.territories,
    license_expiry: analysis.declaration.licenseExpiry,
    declaration_notes: analysis.declaration.notes,
    attested: analysis.declaration.attested,
    attested_at: analysis.declaration.attested ? analysis.analyzedAt : null,
    sha256: analysis.sha256,
    detected_container: analysis.validation.container,
    detected_format: analysis.validation.formatName,
    audio_codec: analysis.validation.audioCodec,
    duration_seconds: analysis.validation.duration || analysis.fingerprint.duration,
    validation_status: analysis.validation.status,
    security_scan_status: analysis.security.status,
    security_scanner: analysis.security.scanner,
    security_scan_detail: analysis.security.detail,
    fingerprint_status: analysis.fingerprint.status,
    fingerprint: analysis.fingerprint.fingerprint,
    fingerprint_raw: analysis.fingerprint.raw,
    fingerprint_duration: analysis.fingerprint.duration ? Math.round(analysis.fingerprint.duration) : null,
    acoustid_status: analysis.acoustid.status,
    acoustid_match_score: analysis.acoustid.best?.score || null,
    acoustid_recording_id: analysis.acoustid.best?.recordingId || null,
    acoustid_matches: analysis.acoustid.matches || [],
    musicbrainz_status: analysis.musicbrainz.status,
    musicbrainz_recording: analysis.musicbrainz.recording,
    internal_match_type: analysis.internalMatch?.type || null,
    internal_match_score: analysis.internalMatch?.score || null,
    matched_cloud_file_id: analysis.internalMatch?.cloudFileId || null,
    matched_same_owner: analysis.internalMatch?.sameOwner ?? null,
    signals: analysis.decision.signals || [],
    provider_versions: analysis.providerVersions,
    user_message: analysis.decision.message,
    updated_at: analysis.analyzedAt,
  };
  const { data, error } = await supabase.from('rights_reviews').insert(row).select().single();
  if (error) throw new Error(error.message);
  await dbLogRightsAction({
    reviewId: data.id,
    actor: 'system',
    action: 'upload_analyzed',
    fromStatus: 'processing',
    toStatus: data.status,
    detail: { decisionCode: data.decision_code, riskScore: data.risk_score },
  });
  return data;
}

async function analyzeAndStoreCloudAudio({ owner, buffer, filename, mimeType, folder, title, artist, duration, rightsBody }) {
  const declaration = rightsDeclarationFromBody(rightsBody);
  const analysis = await analyzeAudioUpload({
    buffer,
    filename,
    mimeType,
    declaredDuration: duration,
    declaration,
    owner,
    findInternalCandidates: dbFindInternalRightsCandidates,
    env: process.env,
  });

  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150) || 'audio';
  const storagePath = `${owner}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
  let cloudFile = null;
  let storageUploaded = false;
  try {
    const { error: uploadError } = await supabase.storage.from(CLOUD_BUCKET).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);
    storageUploaded = true;

    cloudFile = await dbInsertCloudFile({
      owner,
      filename: String(filename).slice(0, 255),
      mime_type: mimeType,
      size: buffer.length,
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      folder,
      title,
      artist,
      duration: analysis.validation.duration || (Number.isFinite(Number(duration)) ? Number(duration) : null),
    });
    const rightsReview = await dbPersistRightsReview(cloudFile.id, owner, analysis);
    return { cloudFile, rightsReview };
  } catch (error) {
    // The recording and its review state are one logical upload. If either DB
    // write fails, remove every piece already created so an unreviewed object
    // can never be published later by accident.
    if (cloudFile) await dbDeleteCloudFile(cloudFile.id, owner).catch(() => {});
    if (storageUploaded) await supabase.storage.from(CLOUD_BUCKET).remove([storagePath]).catch(() => {});
    throw error;
  }
}

app.post('/api/cloud-files', rateLimit, (req, res, next) => {
  // ── multipart path (new) ──────────────────────────────────────────────────
  // Content-Type: multipart/form-data  →  fields: token, filename(optional)
  //                                        file:   the audio file
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    upload.single('file')(req, res, async (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: 'File exceeds 20 MB limit.' });
      if (err) return res.status(400).json({ error: err.message });

      const token    = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
      const sess     = await dbGetSession(token);
      if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
      if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading.', emailVerificationRequired: true });
      if (await isFeatureDisabledForUsername(sess.username, 'uploads')) {
        return res.status(403).json({ error: 'Uploads have been disabled by a parent or guardian on this account.', childAccountRestricted: true, feature: 'uploads' });
      }

      if (!req.file) return res.status(400).json({ error: 'No file received.' });

      const originalName = req.body.filename || req.file.originalname || 'audio';
      const mimeType     = req.file.mimetype === 'application/octet-stream'
        ? guessMimeFromName(originalName)
        : req.file.mimetype;

      // Optional ID3 metadata, read client-side and sent alongside the file.
      // All are optional — anything missing just lands as null in the row.
      const folder   = normalizeFolderName(req.body.folder);
      const title    = (req.body.title  || '').trim().slice(0, 255) || null;
      const artist   = (req.body.artist || '').trim().slice(0, 255) || null;
      const duration = req.body.duration != null && req.body.duration !== ''
        ? Number(req.body.duration) : null;

      try {
        const { cloudFile: row, rightsReview } = await analyzeAndStoreCloudAudio({
          owner: sess.username,
          buffer: req.file.buffer,
          filename: originalName,
          mimeType,
          folder,
          title,
          artist,
          duration,
          rightsBody: req.body,
        });

        return res.status(201).json({
          id: row.id, filename: row.filename, size: row.size,
          mimeType: row.mime_type, uploadedAt: row.uploaded_at,
          folder: row.folder, title: row.title, artist: row.artist, duration: row.duration,
          rights: shapeRightsReview(rightsReview),
        });
      } catch (e) {
        console.error('[cloud-files multipart upload]', e);
        if (e instanceof RightsProcessingError) {
          return res.status(e.httpStatus || 400).json({ error: e.publicMessage, code: e.code });
        }
        if (e.code === 'RIGHTS_MIGRATION_REQUIRED') {
          return res.status(503).json({ error: 'Copyright protection is not ready until the Supabase rights migration is applied.', code: e.code });
        }
        return res.status(500).json({ error: 'Upload failed: ' + e.message });
      }
    });
    return; // multer handles the response above
  }

  // ── base64 / JSON path (legacy fallback) ─────────────────────────────────
  // Content-Type: application/json  →  { token, filename, data: "data:audio/...;base64,..." }
  next();
}, async (req, res) => {
  const { token, filename, data, folder, title, artist, duration } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading.', emailVerificationRequired: true });
  if (await isFeatureDisabledForUsername(sess.username, 'uploads')) {
    return res.status(403).json({ error: 'Uploads have been disabled by a parent or guardian on this account.', childAccountRestricted: true, feature: 'uploads' });
  }
  if (!filename || !data) return res.status(400).json({ error: '"filename" and "data" are required.' });

  const parsed = parseDataUrl(data);
  if (!parsed) return res.status(400).json({ error: '"data" must be a base64 data URL.' });
  if (parsed.buffer.length > CLOUD_FILE_MAX_BYTES)
    return res.status(413).json({ error: `File exceeds ${CLOUD_FILE_MAX_BYTES / 1048576}MB limit.` });

  const folderClean   = normalizeFolderName(folder);
  const titleClean    = (title  || '').trim().slice(0, 255) || null;
  const artistClean   = (artist || '').trim().slice(0, 255) || null;
  const durationClean = duration != null && duration !== '' && Number.isFinite(Number(duration))
    ? Number(duration) : null;

  try {
    const { cloudFile: row, rightsReview } = await analyzeAndStoreCloudAudio({
      owner: sess.username,
      buffer: parsed.buffer,
      filename,
      mimeType: parsed.mimeType,
      folder: folderClean,
      title: titleClean,
      artist: artistClean,
      duration: durationClean,
      rightsBody: req.body,
    });

    return res.status(201).json({
      id: row.id, filename: row.filename, size: row.size,
      mimeType: row.mime_type, uploadedAt: row.uploaded_at,
      folder: row.folder, title: row.title, artist: row.artist, duration: row.duration,
      rights: shapeRightsReview(rightsReview),
    });
  } catch (err) {
    console.error('[cloud-files upload]', err);
    if (err instanceof RightsProcessingError) {
      return res.status(err.httpStatus || 400).json({ error: err.publicMessage, code: err.code });
    }
    if (err.code === 'RIGHTS_MIGRATION_REQUIRED') {
      return res.status(503).json({ error: 'Copyright protection is not ready until the Supabase rights migration is applied.', code: err.code });
    }
    return res.status(500).json({ error: 'Upload failed.' });
  }
});

app.get('/api/cloud-files', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    // folder: omit = all files; '' or '__unfiled__' = no-folder files only; '<name>' = that folder
    // search: full-text match against filename / title / artist (single page, not paginated)
    // sort:   name | artist | date | duration   (default: date)
    // dir:    asc | desc                        (default: desc)
    // cursor: opaque string from a previous response's nextCursor — omit for page 1
    // limit:  page size, 1-200 (default: 50)
    const { rows, nextCursor } = await dbGetCloudFiles(sess.username, {
      folder: req.query.folder,
      search: (req.query.search || '').trim() || undefined,
      sort:   req.query.sort,
      dir:    req.query.dir,
      cursor: req.query.cursor || undefined,
      limit:  req.query.limit,
    });
    const rightsByFile = await dbGetRightsReviewMap(rows.map(row => row.id), sess.username);
    return res.json({
      files: rows.map(f => ({
        id: f.id, filename: f.filename, size: f.size,
        mimeType: f.mime_type, uploadedAt: f.uploaded_at,
        folder: f.folder, title: f.title, artist: f.artist, duration: f.duration,
        rights: shapeRightsReview(rightsByFile.get(String(f.id))) || {
          status: 'scan_required',
          message: 'This older upload needs a rights scan before it can be published.',
        },
      })),
      nextCursor,
    });
  } catch (err) {
    console.error('[cloud-files list]', err);
    return res.status(500).json({ error: 'Could not load cloud files.' });
  }
});

// GET /api/cloud-files/folders  — distinct folder names for the signed-in user,
// used to populate folder nav / a "move to folder" picker on the client.
// Registered before the /:id routes so 'folders' is never read as an id.
app.get('/api/cloud-files/folders', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const folders = await dbGetCloudFolders(sess.username);
    return res.json({ folders });
  } catch (err) {
    console.error('[cloud-files folders]', err);
    return res.status(500).json({ error: 'Could not load folders.' });
  }
});

// DELETE /api/cloud-files  { token, ids: [1,2,3] }  — bulk delete.
// Registered before /:id so this exact path (no id segment) matches first.
app.delete('/api/cloud-files', async (req, res) => {
  const token = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });

  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(n => Number.isFinite(Number(n))) : [];
  if (!ids.length) return res.status(400).json({ error: '"ids" must be a non-empty array.' });

  try {
    // Resolve to rows the caller actually owns first — ids for someone else's
    // files (or ids that don't exist) are dropped here, not erred on, since a
    // mixed-ownership bulk request shouldn't fail the whole batch.
    const files = await dbGetCloudFilesByIds(ids, sess.username);
    if (!files.length) return res.status(404).json({ error: 'No matching files found.' });

    const paths = files.map(f => f.storage_path);
    const { error: removeErr } = await supabase.storage.from(CLOUD_BUCKET).remove(paths);
    if (removeErr) console.error('[cloud-files bulk delete] storage:', removeErr.message);

    await dbDeleteRightsEvidenceForCloudFiles(files.map(f => f.id), sess.username);
    await dbDeleteCloudFiles(files.map(f => f.id), sess.username);
    return res.json({ ok: true, deleted: files.length, filenames: files.map(f => f.filename) });
  } catch (err) {
    console.error('[cloud-files bulk delete]', err);
    return res.status(500).json({ error: 'Bulk delete failed.' });
  }
});

// PATCH /api/cloud-files/:id  { token, filename?, folder? }  — rename and/or move.
// Registered before the generic /:id GET/DELETE just for readability; method
// differs so there's no actual routing ambiguity.
app.patch('/api/cloud-files/:id', async (req, res) => {
  const token = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });

  const patch = {};
  if (req.body.filename != null) {
    const name = String(req.body.filename).trim().slice(0, 255);
    if (!name) return res.status(400).json({ error: 'Filename cannot be empty.' });
    patch.filename = name;
  }
  if (req.body.folder !== undefined) {
    patch.folder = normalizeFolderName(req.body.folder);
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });

  try {
    const existing = await dbGetCloudFile(req.params.id, sess.username);
    if (!existing) return res.status(404).json({ error: 'File not found.' });

    const row = await dbUpdateCloudFile(req.params.id, sess.username, patch);
    return res.json({
      id: row.id, filename: row.filename, folder: row.folder,
      title: row.title, artist: row.artist, duration: row.duration,
    });
  } catch (err) {
    console.error('[cloud-files patch]', err);
    return res.status(500).json({ error: 'Update failed.' });
  }
});

app.get('/api/cloud-files/:id', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    // .eq('owner', sess.username) is inside dbGetCloudFile itself — a file that
    // exists but belongs to someone else returns null here, identically to a
    // file that doesn't exist at all. No way to distinguish the two by probing.
    const file = await dbGetCloudFile(req.params.id, sess.username);
    if (!file) return res.status(404).json({ error: 'File not found.' });
    const rightsReview = await dbGetRightsReviewForOwner(file.id, sess.username);

    const { data, error } = await supabase.storage
      .from(CLOUD_BUCKET)
      .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(error.message);

    return res.json({
      id: file.id, filename: file.filename, size: file.size,
      mimeType: file.mime_type, uploadedAt: file.uploaded_at,
      folder: file.folder, title: file.title, artist: file.artist, duration: file.duration,
      url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS,
      rights: shapeRightsReview(rightsReview) || {
        status: 'scan_required',
        message: 'This older upload needs a rights scan before it can be published.',
      },
    });
  } catch (err) {
    console.error('[cloud-files signed-url]', err);
    return res.status(500).json({ error: 'Could not generate playback URL.' });
  }
});

app.delete('/api/cloud-files/:id', async (req, res) => {
  const token = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    const file = await dbGetCloudFile(req.params.id, sess.username);
    if (!file) return res.status(404).json({ error: 'File not found.' });

    const { error: removeErr } = await supabase.storage.from(CLOUD_BUCKET).remove([file.storage_path]);
    if (removeErr) console.error('[cloud-files delete] storage:', removeErr.message);

    await dbDeleteRightsEvidenceForCloudFiles([file.id], sess.username);
    await dbDeleteCloudFile(req.params.id, sess.username);
    return res.json({ ok: true, deleted: file.filename });
  } catch (err) {
    console.error('[cloud-files delete]', err);
    return res.status(500).json({ error: 'Delete failed.' });
  }
});

async function dbDeleteRightsEvidenceForCloudFiles(cloudFileIds, owner) {
  if (!cloudFileIds.length) return;
  const { data: reviews, error: reviewError } = await supabase
    .from('rights_reviews')
    .select('id')
    .eq('owner', owner)
    .in('cloud_file_id', cloudFileIds);
  if (reviewError) {
    console.error('[rights evidence cleanup] review lookup:', reviewError.message);
    return;
  }
  const reviewIds = (reviews || []).map(review => review.id);
  if (!reviewIds.length) return;
  const { data: evidence, error: evidenceError } = await supabase
    .from('rights_evidence')
    .select('storage_path')
    .in('review_id', reviewIds);
  if (evidenceError) {
    console.error('[rights evidence cleanup] evidence lookup:', evidenceError.message);
    return;
  }
  const storagePaths = (evidence || []).map(item => item.storage_path).filter(Boolean);
  if (storagePaths.length) {
    const { error: storageError } = await supabase.storage.from(RIGHTS_EVIDENCE_BUCKET).remove(storagePaths);
    if (storageError) console.error('[rights evidence cleanup] storage:', storageError.message);
  }
}

async function dbCountRightsEvidence(reviewId) {
  const { count, error } = await supabase
    .from('rights_evidence')
    .select('*', { count: 'exact', head: true })
    .eq('review_id', reviewId);
  if (error) throw new Error(error.message);
  return count || 0;
}

async function dbReevaluateRightsReview(review, evidenceCount) {
  const externalMatches = Array.isArray(review.acoustid_matches) ? review.acoustid_matches : [];
  const decision = decideRights({
    declaration: {
      basis: review.declaration_basis,
      rightsHolder: review.rights_holder,
      territories: review.territories,
      licenseExpiry: review.license_expiry,
      notes: review.declaration_notes,
      attested: review.attested,
      hasEvidence: evidenceCount > 0,
    },
    security: { status: review.security_scan_status },
    fingerprint: { status: review.fingerprint_status },
    acoustid: { best: externalMatches[0] || null },
    internalMatch: review.internal_match_type ? {
      type: review.internal_match_type,
      score: Number(review.internal_match_score) || 0,
      cloudFileId: review.matched_cloud_file_id,
      sameOwner: !!review.matched_same_owner,
    } : null,
    evidenceCount,
    env: process.env,
  });
  const { data, error } = await supabase
    .from('rights_reviews')
    .update({
      status: decision.status,
      decision_code: decision.code,
      risk_score: decision.riskScore,
      signals: decision.signals,
      user_message: decision.message,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', review.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  await dbLogRightsAction({
    reviewId: review.id,
    actor: review.owner,
    action: 'rights_information_reevaluated',
    fromStatus: review.status,
    toStatus: data.status,
    detail: { evidenceCount, decisionCode: data.decision_code },
  });
  return data;
}

// Owner-visible status and supporting material. Raw fingerprints, other
// uploaders' identities, evidence storage paths, and internal admin notes are
// intentionally not returned.
app.get('/api/rights/files/:cloudFileId', rateLimit, async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    const cloudFile = await dbGetCloudFile(req.params.cloudFileId, sess.username);
    if (!cloudFile) return res.status(404).json({ error: 'File not found.' });
    const review = await dbGetRightsReviewForOwner(cloudFile.id, sess.username);
    if (!review) {
      return res.json({
        cloudFileId: cloudFile.id,
        status: 'scan_required',
        message: 'This older upload needs a rights scan before it can be published.',
        disclaimer: 'Recording matches are identification signals only. They do not prove copyright ownership or infringement.',
      });
    }
    const [{ data: evidence, error: evidenceError }, { data: disputes, error: disputesError }] = await Promise.all([
      supabase.from('rights_evidence').select('id, evidence_type, filename, mime_type, size_bytes, description, created_at').eq('review_id', review.id).order('created_at', { ascending: false }),
      supabase.from('rights_disputes').select('id, statement, status, resolution_note, resolved_at, created_at').eq('review_id', review.id).order('created_at', { ascending: false }),
    ]);
    if (evidenceError || disputesError) throw new Error((evidenceError || disputesError).message);
    return res.json({
      review: shapeRightsReview(review),
      evidence: (evidence || []).map(item => ({
        id: item.id, type: item.evidence_type, filename: item.filename,
        mimeType: item.mime_type, size: item.size_bytes, description: item.description,
        createdAt: item.created_at,
      })),
      disputes: (disputes || []).map(item => ({
        id: item.id, statement: item.statement, status: item.status,
        resolutionNote: item.resolution_note, resolvedAt: item.resolved_at, createdAt: item.created_at,
      })),
    });
  } catch (error) {
    console.error('[rights status]', error);
    return res.status(500).json({ error: 'Could not load the rights review.' });
  }
});

// Backfill route for uploads created before the rights migration. It downloads
// only an object already proven to belong to the caller, then runs the same
// pipeline as a brand-new upload.
app.post('/api/rights/files/:cloudFileId/scan', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address first.', emailVerificationRequired: true });
  try {
    const cloudFile = await dbGetCloudFile(req.params.cloudFileId, sess.username);
    if (!cloudFile) return res.status(404).json({ error: 'File not found.' });
    if (await dbGetRightsReviewForOwner(cloudFile.id, sess.username)) {
      return res.status(409).json({ error: 'This file already has a rights review.' });
    }
    const declaration = rightsDeclarationFromBody(req.body);
    const { data: blob, error: downloadError } = await supabase.storage.from(CLOUD_BUCKET).download(cloudFile.storage_path);
    if (downloadError || !blob) throw new Error(downloadError?.message || 'Audio download failed.');
    const buffer = Buffer.from(await blob.arrayBuffer());
    const analysis = await analyzeAudioUpload({
      buffer,
      filename: cloudFile.filename,
      mimeType: cloudFile.mime_type,
      declaredDuration: cloudFile.duration,
      declaration,
      owner: sess.username,
      findInternalCandidates: dbFindInternalRightsCandidates,
      env: process.env,
    });
    const review = await dbPersistRightsReview(cloudFile.id, sess.username, analysis);
    return res.status(201).json({ review: shapeRightsReview(review) });
  } catch (error) {
    console.error('[rights backfill scan]', error);
    if (error instanceof RightsProcessingError) {
      return res.status(error.httpStatus || 400).json({ error: error.publicMessage, code: error.code });
    }
    return res.status(500).json({ error: 'Could not scan this upload.' });
  }
});

app.post('/api/rights/files/:cloudFileId/declaration', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    const cloudFile = await dbGetCloudFile(req.params.cloudFileId, sess.username);
    if (!cloudFile) return res.status(404).json({ error: 'File not found.' });
    const review = await dbGetRightsReviewForOwner(cloudFile.id, sess.username);
    if (!review) return res.status(409).json({ error: 'Run the rights scan before updating the declaration.', scanRequired: true });
    const evidenceCount = await dbCountRightsEvidence(review.id);
    const declaration = rightsDeclarationFromBody(req.body, evidenceCount > 0);
    const { data: updated, error } = await supabase.from('rights_reviews').update({
      declaration_basis: declaration.basis,
      rights_holder: declaration.rightsHolder,
      territories: declaration.territories,
      license_expiry: declaration.licenseExpiry,
      declaration_notes: declaration.notes,
      attested: declaration.attested,
      attested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', review.id).select().single();
    if (error) throw new Error(error.message);
    await dbLogRightsAction({ reviewId: review.id, actor: sess.username, action: 'declaration_updated', fromStatus: review.status, toStatus: review.status });
    const reevaluated = await dbReevaluateRightsReview(updated, evidenceCount);
    return res.json({ review: shapeRightsReview(reevaluated) });
  } catch (error) {
    console.error('[rights declaration]', error);
    if (error instanceof RightsProcessingError) {
      return res.status(error.httpStatus || 400).json({ error: error.publicMessage, code: error.code });
    }
    return res.status(500).json({ error: 'Could not update the rights declaration.' });
  }
});

app.post('/api/rights/files/:cloudFileId/evidence', rateLimit, requireVerifiedEmail, rightsEvidenceUpload.single('file'), async (req, res) => {
  const sess = req._verifiedSession;
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF, image, plain-text, or RTF evidence file up to 10MB.' });
  try {
    const cloudFile = await dbGetCloudFile(req.params.cloudFileId, sess.username);
    if (!cloudFile) return res.status(404).json({ error: 'File not found.' });
    const review = await dbGetRightsReviewForOwner(cloudFile.id, sess.username);
    if (!review) return res.status(409).json({ error: 'Run the rights scan before adding evidence.', scanRequired: true });

    const scan = await scanBufferForMalware(req.file.buffer, req.file.originalname, process.env);
    if (scan.status === 'infected') {
      return res.status(422).json({ error: 'The evidence file was blocked by the security scanner.' });
    }
    if (['unavailable', 'error', 'disabled'].includes(scan.status) && String(process.env.RIGHTS_REQUIRE_CLAMAV || '').toLowerCase() === 'true') {
      return res.status(503).json({ error: 'The required security scan is temporarily unavailable. Try again later.' });
    }

    const type = RIGHTS_ALLOWED_EVIDENCE_TYPES.has(req.body?.evidenceType) ? req.body.evidenceType : 'license_or_permission';
    const safeName = String(req.file.originalname || 'evidence').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
    const storagePath = `${sess.username}/${review.id}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from(RIGHTS_EVIDENCE_BUCKET).upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: evidence, error: insertError } = await supabase.from('rights_evidence').insert({
      review_id: review.id,
      owner: sess.username,
      evidence_type: type,
      storage_path: storagePath,
      filename: String(req.file.originalname || 'evidence').slice(0, 255),
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      description: String(req.body?.description || '').trim().slice(0, 1000) || null,
    }).select().single();
    if (insertError) {
      await supabase.storage.from(RIGHTS_EVIDENCE_BUCKET).remove([storagePath]).catch(() => {});
      throw new Error(insertError.message);
    }

    await dbLogRightsAction({ reviewId: review.id, actor: sess.username, action: 'evidence_added', fromStatus: review.status, toStatus: review.status, detail: { evidenceId: evidence.id, evidenceType: type, scanStatus: scan.status } });
    const evidenceCount = await dbCountRightsEvidence(review.id);
    const reevaluated = await dbReevaluateRightsReview(review, evidenceCount);
    return res.status(201).json({
      evidence: { id: evidence.id, type, filename: evidence.filename, size: evidence.size_bytes, createdAt: evidence.created_at },
      review: shapeRightsReview(reevaluated),
    });
  } catch (error) {
    console.error('[rights evidence]', error);
    return res.status(500).json({ error: 'Could not store the rights evidence.' });
  }
});

app.post('/api/rights/files/:cloudFileId/disputes', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  const statement = String(req.body?.statement || '').trim();
  if (statement.length < 20 || statement.length > 4000) {
    return res.status(400).json({ error: 'Explain the dispute in 20–4000 characters.' });
  }
  try {
    const cloudFile = await dbGetCloudFile(req.params.cloudFileId, sess.username);
    if (!cloudFile) return res.status(404).json({ error: 'File not found.' });
    const review = await dbGetRightsReviewForOwner(cloudFile.id, sess.username);
    if (!review) return res.status(409).json({ error: 'This file does not have a rights review.' });
    const { data: existing } = await supabase.from('rights_disputes').select('id').eq('review_id', review.id).in('status', ['open', 'reviewing']).limit(1).maybeSingle();
    if (existing) return res.status(409).json({ error: 'An open dispute already exists for this upload.' });
    const { data, error } = await supabase.from('rights_disputes').insert({ review_id: review.id, owner: sess.username, statement }).select().single();
    if (error) throw new Error(error.message);
    const { data: updated, error: updateError } = await supabase.from('rights_reviews').update({
      status: 'manual_review',
      decision_code: 'uploader_dispute',
      user_message: 'Your dispute is queued for human review.',
      updated_at: new Date().toISOString(),
    }).eq('id', review.id).select().single();
    if (updateError) throw new Error(updateError.message);
    await dbLogRightsAction({ reviewId: review.id, actor: sess.username, action: 'dispute_submitted', fromStatus: review.status, toStatus: 'manual_review', detail: { disputeId: data.id } });
    return res.status(201).json({ dispute: { id: data.id, status: data.status, createdAt: data.created_at }, review: shapeRightsReview(updated) });
  } catch (error) {
    console.error('[rights dispute]', error);
    return res.status(500).json({ error: 'Could not submit the dispute.' });
  }
});

// Rights-owner claim intake. This creates a review case; it does not remove or
// punish content automatically. Admins investigate through the same moderation
// system and can request more information from either side.
app.post('/api/rights/claims', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = token ? await dbGetSession(token) : null;
  const claimantName = String(req.body?.claimantName || '').trim().slice(0, 255);
  const claimantEmail = normalizeEmail(req.body?.claimantEmail || '');
  const targetTrackId = UUID_RE.test(String(req.body?.targetTrackId || '')) ? req.body.targetTrackId : null;
  const targetUrl = String(req.body?.targetUrl || '').trim().slice(0, 1000) || null;
  const workDescription = String(req.body?.workDescription || '').trim().slice(0, 4000);
  const rightsBasis = String(req.body?.rightsBasis || '').trim().slice(0, 1000);
  const signature = String(req.body?.signature || '').trim().slice(0, 255);
  const goodFaith = req.body?.goodFaithStatement === true;
  const accurate = req.body?.accuracyStatement === true;
  if (!claimantName || !looksLikeEmail(claimantEmail) || !workDescription || !rightsBasis || !signature || (!targetTrackId && !targetUrl) || !goodFaith || !accurate) {
    return res.status(400).json({ error: 'Complete the claimant, target, rights basis, statements, and signature fields.' });
  }
  try {
    const { data, error } = await supabase.from('rights_claims').insert({
      claimant_username: sess?.username || null,
      claimant_name: claimantName,
      claimant_email: claimantEmail,
      target_track_id: targetTrackId,
      target_url: targetUrl,
      work_description: workDescription,
      rights_basis: rightsBasis,
      good_faith_statement: goodFaith,
      accuracy_statement: accurate,
      signature,
    }).select().single();
    if (error) throw new Error(error.message);
    await dbLogRightsAction({ claimId: data.id, actor: sess?.username || 'external_claimant', action: 'claim_submitted', fromStatus: null, toStatus: 'submitted' });
    return res.status(201).json({ claimId: data.id, status: data.status, message: 'Your claim was received for human review. No automatic infringement finding has been made.' });
  } catch (error) {
    console.error('[rights claim]', error);
    return res.status(500).json({ error: 'Could not submit the rights claim.' });
  }
});

// Admin rights queue — mounted into the existing moderation dashboard.
app.get('/api/admin/rights/queue', requireAdmin, async (req, res) => {
  const allowed = new Set(['processing', 'approved', 'hold', 'request_information', 'manual_review', 'rejected']);
  const status = allowed.has(req.query.status) ? req.query.status : 'manual_review';
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const { data: reviews, count, error } = await supabase.from('rights_reviews')
      .select('*', { count: 'exact' })
      .eq('status', status)
      .order('risk_score', { ascending: false })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    const cloudIds = (reviews || []).map(review => review.cloud_file_id);
    const { data: files, error: fileError } = cloudIds.length
      ? await supabase.from('cloud_files').select('id, filename, title, artist, uploaded_at, size').in('id', cloudIds)
      : { data: [], error: null };
    if (fileError) throw new Error(fileError.message);
    const filesById = new Map((files || []).map(file => [String(file.id), file]));
    return res.json({
      reviews: (reviews || []).map(review => ({ ...shapeRightsReview(review, { admin: true }), file: filesById.get(String(review.cloud_file_id)) || null })),
      total: count || 0,
      status,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[admin rights queue]', error);
    return res.status(500).json({ error: 'Could not load the rights queue.' });
  }
});

app.get('/api/admin/rights/claims', requireAdmin, async (req, res) => {
  const allowed = new Set(['submitted', 'triage', 'request_information', 'resolved', 'declined']);
  const status = allowed.has(req.query.status) ? req.query.status : 'submitted';
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const { data, count, error } = await supabase.from('rights_claims')
      .select('*', { count: 'exact' })
      .eq('status', status)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return res.json({ claims: data || [], total: count || 0, status, limit, offset });
  } catch (error) {
    console.error('[admin rights claims]', error);
    return res.status(500).json({ error: 'Could not load rights claims.' });
  }
});

app.post('/api/admin/rights/claims/:claimId/decision', requireAdmin, async (req, res) => {
  const allowed = new Set(['triage', 'request_information', 'resolved', 'declined']);
  const status = String(req.body?.status || '');
  const note = String(req.body?.note || '').trim().slice(0, 2000);
  if (!allowed.has(status)) return res.status(400).json({ error: 'Invalid claim status.' });
  if (note.length < 10) return res.status(400).json({ error: 'Add a review note of at least 10 characters.' });
  try {
    const { data: claim } = await supabase.from('rights_claims').select('*').eq('id', req.params.claimId).maybeSingle();
    if (!claim) return res.status(404).json({ error: 'Rights claim not found.' });
    const { data, error } = await supabase.from('rights_claims').update({
      status,
      reviewer_note: note,
      reviewed_by: req._adminSession.username,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', claim.id).select().single();
    if (error) throw new Error(error.message);
    await dbLogRightsAction({ claimId: claim.id, actor: req._adminSession.username, action: `claim_${status}`, fromStatus: claim.status, toStatus: status, detail: { note } });
    return res.json({ claim: data });
  } catch (error) {
    console.error('[admin rights claim decision]', error);
    return res.status(500).json({ error: 'Could not update the rights claim.' });
  }
});

app.get('/api/admin/rights/evidence/:evidenceId', requireAdmin, async (req, res) => {
  try {
    const { data: evidence, error } = await supabase
      .from('rights_evidence')
      .select('*')
      .eq('id', req.params.evidenceId)
      .maybeSingle();
    if (error || !evidence) return res.status(404).json({ error: 'Rights evidence not found.' });
    const { data: blob, error: downloadError } = await supabase.storage.from(RIGHTS_EVIDENCE_BUCKET).download(evidence.storage_path);
    if (downloadError || !blob) throw new Error(downloadError?.message || 'Evidence download failed.');
    await dbLogRightsAction({ reviewId: evidence.review_id, actor: req._adminSession.username, action: 'evidence_viewed', detail: { evidenceId: evidence.id } });
    res.setHeader('Content-Type', evidence.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(evidence.filename || 'evidence').replace(/["\r\n]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(Buffer.from(await blob.arrayBuffer()));
  } catch (error) {
    console.error('[admin rights evidence]', error);
    return res.status(500).json({ error: 'Could not load rights evidence.' });
  }
});

app.get('/api/admin/rights/:reviewId', requireAdmin, async (req, res) => {
  try {
    const { data: review, error } = await supabase.from('rights_reviews').select('*').eq('id', req.params.reviewId).maybeSingle();
    if (error || !review) return res.status(404).json({ error: 'Rights review not found.' });
    const [{ data: evidence }, { data: disputes }, { data: audit }, { data: cloudFile }] = await Promise.all([
      supabase.from('rights_evidence').select('id, evidence_type, filename, mime_type, size_bytes, description, created_at').eq('review_id', review.id).order('created_at', { ascending: false }),
      supabase.from('rights_disputes').select('*').eq('review_id', review.id).order('created_at', { ascending: false }),
      supabase.from('rights_audit_log').select('*').eq('review_id', review.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('cloud_files').select('id, filename, title, artist, uploaded_at, size, mime_type, duration').eq('id', review.cloud_file_id).maybeSingle(),
    ]);
    return res.json({ review: shapeRightsReview(review, { admin: true }), cloudFile, evidence: evidence || [], disputes: disputes || [], audit: audit || [] });
  } catch (error) {
    console.error('[admin rights detail]', error);
    return res.status(500).json({ error: 'Could not load the rights review.' });
  }
});

app.post('/api/admin/rights/:reviewId/decision', requireAdmin, async (req, res) => {
  const actionToStatus = {
    approve: 'approved',
    hold: 'hold',
    request_information: 'request_information',
    manual_review: 'manual_review',
    reject: 'rejected',
  };
  const action = String(req.body?.action || '');
  const nextStatus = actionToStatus[action];
  const note = String(req.body?.note || '').trim().slice(0, 2000);
  if (!nextStatus) return res.status(400).json({ error: 'Invalid rights decision.' });
  if (action !== 'approve' && note.length < 10) return res.status(400).json({ error: 'Add a clear review note of at least 10 characters.' });
  try {
    const { data: review } = await supabase.from('rights_reviews').select('*').eq('id', req.params.reviewId).maybeSingle();
    if (!review) return res.status(404).json({ error: 'Rights review not found.' });
    const messages = {
      approved: note || 'Your rights information was reviewed and this recording is cleared for publishing on FREQ.',
      hold: 'This upload remains on hold while FREQ verifies the rights information.',
      request_information: 'More rights information is needed before this recording can be published.',
      manual_review: 'This upload is queued for additional human review.',
      rejected: 'FREQ could not clear this recording for publishing based on the information provided. You may submit a dispute with additional evidence.',
    };
    const { data, error } = await supabase.from('rights_reviews').update({
      status: nextStatus,
      decision_code: `admin_${action}`,
      reviewer_note: note || null,
      user_message: messages[nextStatus],
      reviewed_by: req._adminSession.username,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', review.id).select().single();
    if (error) throw new Error(error.message);
    await dbLogRightsAction({ reviewId: review.id, actor: req._adminSession.username, action: `admin_${action}`, fromStatus: review.status, toStatus: nextStatus, detail: { note } });
    try {
      if (review.owner) {
        if (nextStatus === 'request_information') {
          await dbCreateFreqNotice({
            recipientUsername: review.owner,
            createdBy: req._adminSession.username,
            templateKey: 'rights_action_required',
            values: { resourceId: review.id },
            relatedResourceType: 'rights_review',
            relatedResourceId: review.id,
            auditRequired: true,
          });
        } else {
          await dbCreateFreqNotice({
            recipientUsername: review.owner,
            createdBy: req._adminSession.username,
            noticeType: 'rights_review',
            severity: nextStatus === 'rejected' ? 'warning' : 'update',
            title: `FREQ Notice · Rights Review ${nextStatus === 'approved' ? 'Approved' : 'Updated'}`,
            body: `${messages[nextStatus]}${note ? `\n\nReviewer note:\n${note}` : ''}`,
            actions: [{ id: 'view_rights', label: 'View Rights Check', kind: 'rights', resourceId: review.id }],
            relatedResourceType: 'rights_review',
            relatedResourceId: review.id,
            auditRequired: true,
          });
        }
      }
    } catch (noticeError) {
      console.error('[admin rights decision] FREQ Notice failed (non-fatal):', noticeError.message);
    }
    return res.json({ review: shapeRightsReview(data, { admin: true }) });
  } catch (error) {
    console.error('[admin rights decision]', error);
    return res.status(500).json({ error: 'Could not save the rights decision.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MUSIC VIDEOS — direct-to-storage upload, attach to track, playback, analytics
//
//  Upload flow (browser uploads straight to Supabase Storage — the Node
//  process never buffers video bytes, unlike the audio cloud-files path
//  above):
//    1. POST /api/videos/upload-url   { token, filename, mimeType, size }
//       → creates a `pending` video_files row + a short-lived signed
//         UPLOAD url (createSignedUploadUrl), scoped to that row's exact
//         storage_path. The signed URL itself is the authorization the
//         browser needs — Supabase Storage checks the URL's embedded
//         token, not the browser's own credentials, so no storage RLS
//         policy is required for this to be safe (mirrors how cloud-audio
//         has zero RLS policies today and relies entirely on server_role-
//         issued signed URLs for both directions).
//    2. Browser PUTs the file bytes directly to the returned signedUrl.
//    3. POST /api/videos/:id/confirm  { token, duration?, width?, height? }
//       → flips upload_status to 'ready' once the browser confirms the
//         PUT succeeded. A 'pending' row that never gets confirmed (user
//         closed the tab mid-upload) is simply never attachable to a
//         track — dbGetVideoFile's owner+ready check below blocks it —
//         and is harmless dead weight until a cleanup sweep is added later.
//    4. POST /api/tracks/:trackId/video  { token, videoFileId, thumbnailUrl? }
//       → attaches the ready video_files row to the track (creates the
//         track_videos row). This step is separate from publish — a video
//         can be attached before OR after a track is published, same
//         flexibility cover art already has via track-cover.
//
//  Playback mirrors the existing audio stream pattern exactly:
//  GET /api/tracks/:trackId/video-stream is public or token-optional, the
//  same "is_published is the only real gate" philosophy as
//  GET /api/tracks/:trackId/stream.
//
//  Analytics are intentionally on SEPARATE counters from tracks.play_count
//  /track_plays — see track_videos/video_plays in the migration — per the
//  explicit "do not merge video plays into audio plays" requirement.
// ═══════════════════════════════════════════════════════════════════════════════

const VIDEO_BUCKET = 'cloud-video';
const VIDEO_MAX_BYTES = 500 * 1048576; // 500MB — matches the bucket's own file_size_limit (Storage enforces this independently; this is just for a fast, friendly error before even requesting a signed URL)
const VIDEO_SIGNED_UPLOAD_TTL_SECONDS = 60 * 30; // 30 minutes — long enough for a slow connection to finish uploading a few hundred MB, short enough that an abandoned upload URL doesn't stay valid indefinitely
const VIDEO_MIME_TYPES = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

function guessVideoExtFromMime(mimeType) {
  return VIDEO_MIME_TYPES[mimeType] || 'mp4';
}

async function dbGetVideoFile(id, username) {
  const { data, error } = await supabase
    .from('video_files').select('*').eq('id', id).eq('owner', username).maybeSingle();
  if (error) { console.error('[db] getVideoFile:', error.message); return null; }
  return data;
}

async function dbInsertVideoFile(row) {
  const { data, error } = await supabase.from('video_files').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbGetTrackVideo(trackId) {
  const { data, error } = await supabase
    .from('track_videos').select('*, video_files(*)').eq('track_id', trackId).maybeSingle();
  if (error) { console.error('[db] getTrackVideo:', error.message); return null; }
  return data;
}

// POST /api/videos/upload-url   { token, filename, mimeType, size }
// Step 1 of the direct-to-storage flow. Validates format/size up front so
// a doomed upload never starts, then creates the pending video_files row
// and asks Storage for a signed upload URL scoped to that row's path.
app.post('/api/videos/upload-url', rateLimit, requireFeatureAllowed('uploads'), async (req, res) => {
  const { token, filename, mimeType, size } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading.', emailVerificationRequired: true });
  if (!VIDEO_MIME_TYPES[mimeType]) {
    return res.status(400).json({ error: 'Unsupported video format. Upload MP4, WebM, or MOV.' });
  }
  const sizeNum = Number(size);
  if (!Number.isFinite(sizeNum) || sizeNum <= 0) {
    return res.status(400).json({ error: '"size" (bytes) is required.' });
  }
  if (sizeNum > VIDEO_MAX_BYTES) {
    return res.status(413).json({ error: `Video exceeds the ${VIDEO_MAX_BYTES / 1048576}MB limit.` });
  }

  try {
    const safeName = String(filename || 'video').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
    const ext = guessVideoExtFromMime(mimeType);
    const storagePath = `${sess.username}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName.replace(/\.[a-zA-Z0-9]+$/, '')}.${ext}`;

    const row = await dbInsertVideoFile({
      owner: sess.username,
      filename: String(filename || 'video').slice(0, 255),
      mime_type: mimeType,
      size: sizeNum,
      storage_path: storagePath,
      upload_status: 'pending',
    });

    const { data, error } = await supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (error) throw new Error(error.message);

    return res.status(201).json({
      videoFileId: row.id,
      uploadUrl: data.signedUrl,
      uploadToken: data.token,
      storagePath,
      expiresIn: VIDEO_SIGNED_UPLOAD_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[videos upload-url]', err);
    return res.status(500).json({ error: 'Could not start video upload.' });
  }
});

// POST /api/videos/:id/confirm   { token, duration?, width?, height? }
// Step 3 — browser calls this after the direct PUT to Storage succeeds.
// Does NOT re-verify the object actually exists in Storage via a HEAD
// request before flipping to 'ready' — attach-to-track (below) is the
// real gate that matters (a track can't go live with a broken video
// reference unnoticed for long, since video-stream will 404 immediately
// the first time anyone tries to watch it), and adding a verification
// round-trip here would slow down every single confirm call for a
// failure mode that's already cheap to detect downstream.
app.post('/api/videos/:id/confirm', rateLimit, requireFeatureAllowed('uploads'), async (req, res) => {
  const { token, duration, width, height } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const file = await dbGetVideoFile(req.params.id, sess.username);
    if (!file) return res.status(404).json({ error: 'Video upload not found.' });

    const patch = {
      upload_status: 'ready',
      ready_at: new Date().toISOString(),
    };
    if (duration != null && Number.isFinite(Number(duration))) patch.duration = Number(duration);
    if (width != null && Number.isFinite(Number(width)))       patch.width = Math.round(Number(width));
    if (height != null && Number.isFinite(Number(height)))     patch.height = Math.round(Number(height));

    const { data, error } = await supabase
      .from('video_files').update(patch).eq('id', file.id).select().single();
    if (error) throw new Error(error.message);

    return res.json({
      id: data.id, filename: data.filename, mimeType: data.mime_type,
      size: data.size, duration: data.duration, width: data.width, height: data.height,
      uploadStatus: data.upload_status,
    });
  } catch (err) {
    console.error('[videos confirm]', err);
    return res.status(500).json({ error: 'Could not confirm video upload.' });
  }
});

// DELETE /api/videos/:id   { token }
// Lets an artist abandon a pending/ready upload that was never attached to
// a track (e.g. picked the wrong file). Mirrors DELETE /api/cloud-files/:id.
// Does NOT allow deleting a video_files row that's currently attached to a
// track_videos row — use DELETE /api/tracks/:trackId/video for that, which
// detaches first; this route alone would otherwise leave a dangling FK
// reference for track_videos.video_file_id (ON DELETE RESTRICT blocks it
// at the DB level regardless, but the clearer error belongs here).
app.delete('/api/videos/:id', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const file = await dbGetVideoFile(req.params.id, sess.username);
    if (!file) return res.status(404).json({ error: 'Video not found.' });

    const { data: attached } = await supabase
      .from('track_videos').select('id').eq('video_file_id', file.id).maybeSingle();
    if (attached) {
      return res.status(409).json({ error: 'This video is attached to a track. Remove it from the track first.' });
    }

    const { error: removeErr } = await supabase.storage.from(VIDEO_BUCKET).remove([file.storage_path]);
    if (removeErr) console.error('[videos delete] storage:', removeErr.message);
    await supabase.from('video_files').delete().eq('id', file.id).eq('owner', sess.username);
    return res.json({ ok: true, deleted: file.filename });
  } catch (err) {
    console.error('[videos delete]', err);
    return res.status(500).json({ error: 'Could not delete video.' });
  }
});

// POST /api/tracks/:trackId/video   { token, videoFileId, thumbnailUrl? }
// Attaches a ready, owned video_files row to a track the caller's artist
// page owns. One video per track — re-attaching replaces the existing
// track_videos row (and its old video_files row is left in place,
// unattached, rather than auto-deleted, so a mistaken swap is recoverable
// via DELETE /api/videos/:id afterward rather than being unrecoverable).
app.post('/api/tracks/:trackId/video', rateLimit, requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, videoFileId, thumbnailUrl } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!videoFileId) return res.status(400).json({ error: '"videoFileId" is required.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track || !track.cloud_file_id) return res.status(404).json({ error: 'Track not found.' });
    const artist = await supabase.from('artists').select('account_id').eq('id', track.artist_id).maybeSingle();
    if (!artist.data || artist.data.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who owns this track can attach a video.' });
    }

    const videoFile = await dbGetVideoFile(videoFileId, sess.username);
    if (!videoFile) return res.status(404).json({ error: 'Video upload not found.' });
    if (videoFile.upload_status !== 'ready') {
      return res.status(409).json({ error: 'This video upload has not finished processing yet.' });
    }

    const existing = await dbGetTrackVideo(track.id);
    let trackVideo;
    if (existing) {
      const { data, error } = await supabase
        .from('track_videos')
        .update({ video_file_id: videoFile.id, thumbnail_url: thumbnailUrl || existing.thumbnail_url || null, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      if (error) throw new Error(error.message);
      trackVideo = data;
    } else {
      const { data, error } = await supabase
        .from('track_videos')
        .insert({ track_id: track.id, video_file_id: videoFile.id, thumbnail_url: thumbnailUrl || null })
        .select().single();
      if (error) throw new Error(error.message);
      trackVideo = data;
    }

    return res.status(201).json({
      id: trackVideo.id, trackId: trackVideo.track_id, videoFileId: trackVideo.video_file_id,
      thumbnailUrl: trackVideo.thumbnail_url,
    });
  } catch (err) {
    console.error('[track video attach]', err);
    return res.status(500).json({ error: 'Could not attach video to track.' });
  }
});

// Thumbnail upload for a track's music video — same uploadMediaImage()
// helper and public `media` bucket every other image route already uses,
// namespaced under video-thumbnails/. Separate from track-cover since a
// video's thumbnail and a track's cover art are conceptually different
// images an artist may want to differ (e.g. a freeze-frame vs. the single
// artwork), even though they're allowed to be the same image if the
// artist just reuses the cover.
app.post('/api/tracks/:trackId/video-thumbnail', rateLimit, imageUpload.single('file'), requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const sess = await dbGetSession(req.body?.token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading.', emailVerificationRequired: true });
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track) return res.status(404).json({ error: 'Track not found.' });
    const artist = await supabase.from('artists').select('account_id').eq('id', track.artist_id).maybeSingle();
    if (!artist.data || artist.data.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who owns this track can upload a thumbnail.' });
    }
    const thumbnailUrl = await uploadMediaImage(req.file, 'video-thumbnails', track.id);
    await supabase.from('track_videos').update({ thumbnail_url: thumbnailUrl, updated_at: new Date().toISOString() }).eq('track_id', track.id);
    return res.json({ thumbnailUrl });
  } catch (err) {
    console.error('[video thumbnail upload]', err);
    return res.status(500).json({ error: 'Could not upload thumbnail.' });
  }
});

// DELETE /api/tracks/:trackId/video   { token }
// Detaches the video from the track (deletes the track_videos row) and
// removes the underlying file from Storage + video_files — unlike
// DELETE /api/videos/:id, this IS allowed to delete an attached video,
// since detaching is exactly the point of this route.
app.delete('/api/tracks/:trackId/video', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track) return res.status(404).json({ error: 'Track not found.' });
    const artist = await supabase.from('artists').select('account_id').eq('id', track.artist_id).maybeSingle();
    if (!artist.data || artist.data.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who owns this track can remove its video.' });
    }

    const trackVideo = await dbGetTrackVideo(track.id);
    if (!trackVideo) return res.status(404).json({ error: 'This track has no video.' });

    await supabase.from('track_videos').delete().eq('id', trackVideo.id);
    const { data: videoFile } = await supabase.from('video_files').select('storage_path').eq('id', trackVideo.video_file_id).maybeSingle();
    if (videoFile) {
      const { error: removeErr } = await supabase.storage.from(VIDEO_BUCKET).remove([videoFile.storage_path]);
      if (removeErr) console.error('[track video delete] storage:', removeErr.message);
      await supabase.from('video_files').delete().eq('id', trackVideo.video_file_id);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[track video detach]', err);
    return res.status(500).json({ error: 'Could not remove video.' });
  }
});

// GET /api/tracks/:trackId/video-stream
// Public, mirrors GET /api/tracks/:trackId/stream exactly: the gate is
// "is this track published and does it have a video", not ownership —
// any visitor watching a published track's video is the intended audience,
// same philosophy as audio streaming.
app.get('/api/tracks/:trackId/video-stream', rateLimit, async (req, res) => {
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track || !track.is_published) return res.status(404).json({ error: 'Track not found.' });

    // Check the listener's effective family/playback ceiling BEFORE looking
    // up Storage or minting a signed URL. A restricted response must never
    // contain a playable or downloadable location.
    const allowedRatings = await getAllowedRatingsForRequest(req);
    if (!allowedRatings.includes(track.content_rating || 'clean')) {
      return res.status(403).json({
        error: 'This track is restricted by your account settings.',
        contentRestricted: true,
      });
    }
    // Part 6: specific artist/genre/track blocks — same final boundary as
    // the audio stream route.
    if (await isTrackBlockedForRequest(req, track)) {
      return res.status(403).json({
        error: 'This track is restricted by your account settings.',
        contentRestricted: true,
      });
    }

    const listeningAllowance = await getListeningAllowanceForRequest(req, { reserveSeconds: 60 });
    if (!listeningAllowance.allowed) {
      return res.status(403).json({
        error: listeningAllowance.message || 'Listening is unavailable right now.',
        listeningRestricted: true,
        reason: listeningAllowance.reason || null,
      });
    }

    const trackVideo = await dbGetTrackVideo(track.id);
    if (!trackVideo || !trackVideo.video_files) return res.status(404).json({ error: 'This track has no video.' });
    const videoFile = trackVideo.video_files;
    if (videoFile.upload_status !== 'ready') return res.status(404).json({ error: 'This track has no video.' });

    const streamTtlSeconds = listeningAllowance.restrictions
      ? Math.min(SIGNED_URL_TTL_SECONDS, listeningAllowance.streamLeaseSeconds || 60)
      : SIGNED_URL_TTL_SECONDS;
    const { data, error } = await supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(videoFile.storage_path, streamTtlSeconds);
    if (error) throw new Error(error.message);

    // likedByMe mirrors GET /api/discover/tracks' same token-optional
    // single-row lookup — likes are shared between a track's audio and
    // video (see migration comment on track_videos.like_count), so this
    // reads tracks/track_likes directly rather than a separate video-like
    // table.
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
    const sess = token ? await dbGetSession(token) : null;
    let likedByMe = false;
    if (sess) {
      const { data: likeRow } = await supabase.from('track_likes')
        .select('username').eq('track_id', track.id).eq('username', sess.username).maybeSingle();
      likedByMe = !!likeRow;
    }

    return res.json({
      trackVideoId: trackVideo.id, trackId: track.id, title: track.title,
      artistId: track.artist_id, artistName: track.artist_name,
      thumbnailUrl: trackVideo.thumbnail_url, mimeType: videoFile.mime_type,
      duration: videoFile.duration, width: videoFile.width, height: videoFile.height,
      url: data.signedUrl, expiresIn: streamTtlSeconds,
      playCount: trackVideo.play_count, likeCount: track.like_count || 0, likedByMe,
    });
  } catch (err) {
    console.error('[video stream]', err);
    return res.status(500).json({ error: 'Could not load video.' });
  }
});

// POST /api/tracks/:trackId/video/watch-event   { event: 'start'|'end', watchedSeconds? }
// Logs video-specific analytics on COMPLETELY SEPARATE counters from audio
// (track_videos.play_count/watch_start_count, video_plays — never
// tracks.play_count/track_plays). 'start' increments watch_start_count and
// — after a short cooldown identical in spirit to dbLogPlay's
// PLAY_COOLDOWN_MS — also counts as a video play (play_count) and writes
// the video_plays row. 'end' is a best-effort beacon carrying how far the
// viewer got, used only for completion-rate math; a session that never
// sends 'end' (closed the tab) simply has no completion data point, which
// is honest — not backfilled with a guess.
const recentVideoPlayKeys = new Map(); // same cooldown-key idea as recentPlayKeys, separate Map so video/audio cooldowns never interact
const VIDEO_PLAY_COOLDOWN_MS = 30 * 1000;

app.post('/api/tracks/:trackId/video/watch-event', rateLimit, async (req, res) => {
  const { event, watchedSeconds } = req.body || {};
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = token ? await dbGetSession(token) : null;
  if (!['start', 'end'].includes(event)) return res.status(400).json({ error: 'Invalid event.' });

  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track || !track.is_published) return res.status(404).json({ error: 'Track not found.' });
    const allowedRatings = await getAllowedRatingsForRequest(req);
    if (!allowedRatings.includes(track.content_rating || 'clean')) {
      return res.status(403).json({ error: 'This track is restricted by your account settings.', contentRestricted: true });
    }
    if (await isTrackBlockedForRequest(req, track)) {
      return res.status(403).json({ error: 'This track is restricted by your account settings.', contentRestricted: true });
    }
    const trackVideo = await dbGetTrackVideo(track.id);
    if (!trackVideo) return res.status(404).json({ error: 'This track has no video.' });

    if (event === 'start') {
      await supabase.rpc('increment_video_watch_start_count', { p_track_video_id: trackVideo.id });

      const listenerKey = sess?.username || req.ip || 'anon';
      const cooldownKey = `${trackVideo.id}:${listenerKey}`;
      const last = recentVideoPlayKeys.get(cooldownKey);
      const withinCooldown = last && Date.now() - last < VIDEO_PLAY_COOLDOWN_MS;
      if (!withinCooldown) {
        recentVideoPlayKeys.set(cooldownKey, Date.now());
        await supabase.rpc('increment_video_play_count', { p_track_video_id: trackVideo.id });
        await supabase.from('video_plays').insert({
          track_video_id: trackVideo.id, username: sess?.username || null,
          video_duration: trackVideo.video_files?.duration || null,
        });
      }
      return res.json({ ok: true, counted: !withinCooldown });
    }

    // event === 'end' — best-effort, update the most recent open row for
    // this viewer rather than inserting a second row (the 'start' insert
    // above already created the row this session belongs to).
    const seconds = Number(watchedSeconds);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const listenerCol = sess?.username || null;
      let q = supabase.from('video_plays').select('id')
        .eq('track_video_id', trackVideo.id)
        .order('played_at', { ascending: false }).limit(1);
      q = listenerCol ? q.eq('username', listenerCol) : q.is('username', null);
      const { data: recentRow } = await q.maybeSingle();
      if (recentRow) {
        await supabase.from('video_plays').update({ watched_seconds: seconds }).eq('id', recentRow.id);
        await supabase.from('track_videos')
          .update({ total_watch_seconds: (trackVideo.total_watch_seconds || 0) + seconds })
          .eq('id', trackVideo.id);
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[video watch-event]', err);
    return res.status(500).json({ error: 'Could not log watch event.' });
  }
});

// GET /api/artists/:id/videos   ?sort=newest   &limit=
// Artist page "Music Videos" section. Newest-first by default per spec.
app.get('/api/artists/:id/videos', requireFeatureAllowed('artist_pages', { allowAnonymous: true }), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (await isArtistBlockedForRequest(req, artist)) return res.json({ videos: [] });
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const allowedRatings = await getAllowedRatingsForRequest(req);

    const { data, error } = await supabase
      .from('tracks')
      .select('id, title, is_explicit, content_rating, published_at, cover_url, track_videos!inner(id, thumbnail_url, play_count, created_at, video_files(duration))')
      .eq('artist_id', artist.id)
      .eq('is_published', true)
      .in('content_rating', allowedRatings)
      .order('created_at', { referencedTable: 'track_videos', ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const visibleTracks = await filterBlockedTracksForRequest(req, (data || []).map(t => ({ ...t, artist_id: artist.id })));
    return res.json({
      videos: visibleTracks.map(t => {
        const tv = Array.isArray(t.track_videos) ? t.track_videos[0] : t.track_videos;
        return {
          trackId: t.id, title: t.title, isExplicit: !!t.is_explicit,
          thumbnailUrl: tv?.thumbnail_url || t.cover_url || null,
          playCount: tv?.play_count || 0, uploadedAt: tv?.created_at || t.published_at,
          duration: tv?.video_files?.duration || null,
        };
      }),
    });
  } catch (err) {
    console.error('[artist videos]', err);
    return res.status(500).json({ error: 'Could not load music videos.' });
  }
});

// GET /api/discover/videos   ?mode=new|trending|most_played|most_liked
// Discovery "🎬 Music Videos" section — its own ranking surface, NEVER
// mixed into /api/discover/tracks' audio-play-based rankings, per the
// explicit "do not mix video rankings into track rankings" requirement.
app.get('/api/discover/videos', async (req, res) => {
  const mode = ['new', 'trending', 'most_played', 'most_liked'].includes(req.query.mode) ? req.query.mode : 'new';
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const searchQuery = discoverSafeSearchTerm(req.query.q);
  try {
    // Part 6: a child account with Discover disabled sees no video results
    // either — same reasoning as the audio-only discover routes above.
    if (await isFeatureDisabledForRequest(req, 'discover')) {
      return res.json({ mode, videos: [] });
    }
    // Part 3/12: video tracks are still `tracks` rows with a content_rating
    // — Discover must hide blocked ones the same as the audio-only listing.
    const allowedRatings = await getAllowedRatingsForRequest(req);
    let query = supabase
      .from('tracks')
      .select('id, title, artist_id, artist_name, is_explicit, content_rating, like_count, track_videos!inner(id, thumbnail_url, play_count, created_at, video_files(duration))')
      .eq('is_published', true)
      .in('content_rating', allowedRatings);
    if (searchQuery) {
      query = query.or(`title.ilike.%${searchQuery}%,artist_name.ilike.%${searchQuery}%`);
    }

    if (mode === 'most_liked') {
      query = query.order('like_count', { ascending: false });
    } else if (mode === 'most_played' || mode === 'trending') {
      // "Trending" has no separate 7-day video-play counter yet (that would
      // need a video_plays time-window aggregate, parallel to
      // play_count_7d/recomputeWeeklyPlayCounts — not built in this pass);
      // ranking by all-time video plays for both modes today is honest
      // about what's real, rather than faking a trending signal.
      query = query.order('play_count', { referencedTable: 'track_videos', ascending: false });
    } else {
      query = query.order('created_at', { referencedTable: 'track_videos', ascending: false });
    }

    const { data: rawData, error } = await query.limit(limit);
    if (error) throw new Error(error.message);
    // Part 6: specific artist/genre/track blocks on top of the rating
    // ceiling above — a video track can still be individually blocked.
    const data = await filterBlockedTracksForRequest(req, rawData || []);

    return res.json({
      mode,
      videos: (data || []).map(t => {
        const tv = Array.isArray(t.track_videos) ? t.track_videos[0] : t.track_videos;
        return {
          trackId: t.id, title: t.title, artistId: t.artist_id, artistName: t.artist_name,
          isExplicit: !!t.is_explicit, contentRating: t.content_rating || 'clean',
          likeCount: t.like_count || 0,
          thumbnailUrl: tv?.thumbnail_url || null, playCount: tv?.play_count || 0,
          uploadedAt: tv?.created_at || null, duration: tv?.video_files?.duration || null,
        };
      }),
    });
  } catch (err) {
    console.error('[discover videos]', err);
    return res.status(500).json({ error: 'Could not load music videos.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MOTION CANVAS  — a short, muted, looping 16:9 video that plays as the
//  animated background of the Now Playing screen for a published FREQ track.
//  This is NOT Spotify Canvas's vertical 9:16 clip and NOT the Music Video
//  system above — it's a "living album cover" behind the existing player UI,
//  never a separately-watchable thing, so it has no play/watch/like counters
//  of its own (see track_motion_canvas migration).
//
//  Upload flow mirrors Music Video's direct-to-storage pattern exactly:
//    1. POST /api/motion-canvas/upload-url   { token, filename, mimeType, size }
//    2. Browser PUTs the file bytes directly to the returned signedUrl.
//    3. POST /api/motion-canvas/:id/confirm  { token, duration?, width?, height? }
//    4. POST /api/tracks/:trackId/motion-canvas  { token, motionCanvasFileId }
//       → attaches the ready file to the track (creates/replaces the
//         track_motion_canvas row). One canvas per track (v1) — re-attaching
//         replaces the existing row; the old motion_canvas_files row is left
//         unattached rather than auto-deleted, same recoverable-mistake
//         philosophy as track_videos above.
//
//  Playback is NOT a standalone endpoint — GET /api/tracks/:trackId/stream
//  (the audio route) includes motionCanvasUrl/motionCanvasMimeType inline
//  when a canvas is attached, since the two always play together and the
//  frontend already calls that route on every track load. A visitor never
//  needs to know a canvas exists before deciding to play the track, so there
//  is nothing to gain from a second round trip.
// ═══════════════════════════════════════════════════════════════════════════════

const MOTION_CANVAS_BUCKET = 'motion-canvas';
const MOTION_CANVAS_MAX_BYTES = 50 * 1048576; // 50MB — matches the bucket's own file_size_limit; generous for a 3-15s clip, this is just a fast friendly error before requesting a signed URL
const MOTION_CANVAS_MAX_DURATION_SECONDS = 15;
const MOTION_CANVAS_SIGNED_UPLOAD_TTL_SECONDS = 60 * 15; // 15 minutes — these are small files, no need for the 30-minute window Music Video gets
const MOTION_CANVAS_MIME_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' };

function guessMotionCanvasExtFromMime(mimeType) {
  return MOTION_CANVAS_MIME_TYPES[mimeType] || 'mp4';
}

async function dbGetMotionCanvasFile(id, username) {
  const { data, error } = await supabase
    .from('motion_canvas_files').select('*').eq('id', id).eq('owner', username).maybeSingle();
  if (error) { console.error('[db] getMotionCanvasFile:', error.message); return null; }
  return data;
}

async function dbInsertMotionCanvasFile(row) {
  const { data, error } = await supabase.from('motion_canvas_files').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbGetTrackMotionCanvas(trackId) {
  const { data, error } = await supabase
    .from('track_motion_canvas').select('*, motion_canvas_files(*)').eq('track_id', trackId).maybeSingle();
  if (error) { console.error('[db] getTrackMotionCanvas:', error.message); return null; }
  return data;
}

// POST /api/motion-canvas/upload-url   { token, filename, mimeType, size }
app.post('/api/motion-canvas/upload-url', rateLimit, requireFeatureAllowed('uploads'), async (req, res) => {
  const { token, filename, mimeType, size } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading.', emailVerificationRequired: true });
  if (!MOTION_CANVAS_MIME_TYPES[mimeType]) {
    return res.status(400).json({ error: 'Unsupported format. Upload MP4 or WebM.' });
  }
  const sizeNum = Number(size);
  if (!Number.isFinite(sizeNum) || sizeNum <= 0) {
    return res.status(400).json({ error: '"size" (bytes) is required.' });
  }
  if (sizeNum > MOTION_CANVAS_MAX_BYTES) {
    return res.status(413).json({ error: `Motion Canvas exceeds the ${MOTION_CANVAS_MAX_BYTES / 1048576}MB limit.` });
  }

  try {
    const safeName = String(filename || 'canvas').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
    const ext = guessMotionCanvasExtFromMime(mimeType);
    const storagePath = `${sess.username}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName.replace(/\.[a-zA-Z0-9]+$/, '')}.${ext}`;

    const row = await dbInsertMotionCanvasFile({
      owner: sess.username,
      filename: String(filename || 'canvas').slice(0, 255),
      mime_type: mimeType,
      size: sizeNum,
      storage_path: storagePath,
      upload_status: 'pending',
    });

    const { data, error } = await supabase.storage
      .from(MOTION_CANVAS_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (error) throw new Error(error.message);

    return res.status(201).json({
      motionCanvasFileId: row.id,
      uploadUrl: data.signedUrl,
      uploadToken: data.token,
      storagePath,
      expiresIn: MOTION_CANVAS_SIGNED_UPLOAD_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[motion-canvas upload-url]', err);
    return res.status(500).json({ error: 'Could not start Motion Canvas upload.' });
  }
});

// POST /api/motion-canvas/:id/confirm   { token, duration?, width?, height? }
// Same "attach is the real gate, this is not re-verified against Storage"
// reasoning as Music Video's confirm step. Additionally soft-warns (not
// blocks) when duration exceeds the 3-15s guidance, since a hard block here
// would fight a browser whose metadata read came back slightly off; the
// spec's real intent (short, loopable) is enforced by artist expectations
// and the UI's guidance text, not a server-side rejection.
app.post('/api/motion-canvas/:id/confirm', rateLimit, requireFeatureAllowed('uploads'), async (req, res) => {
  const { token, duration, width, height } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const file = await dbGetMotionCanvasFile(req.params.id, sess.username);
    if (!file) return res.status(404).json({ error: 'Motion Canvas upload not found.' });

    const patch = { upload_status: 'ready', ready_at: new Date().toISOString() };
    if (duration != null && Number.isFinite(Number(duration))) patch.duration = Number(duration);
    if (width != null && Number.isFinite(Number(width)))       patch.width = Math.round(Number(width));
    if (height != null && Number.isFinite(Number(height)))     patch.height = Math.round(Number(height));

    const { data, error } = await supabase
      .from('motion_canvas_files').update(patch).eq('id', file.id).select().single();
    if (error) throw new Error(error.message);

    return res.json({
      id: data.id, filename: data.filename, mimeType: data.mime_type,
      size: data.size, duration: data.duration, width: data.width, height: data.height,
      uploadStatus: data.upload_status,
      durationWarning: (data.duration && Number(data.duration) > MOTION_CANVAS_MAX_DURATION_SECONDS)
        ? `This clip is ${Math.round(data.duration)}s — Motion Canvas works best at 3-15s and will still loop, just less seamlessly.`
        : null,
    });
  } catch (err) {
    console.error('[motion-canvas confirm]', err);
    return res.status(500).json({ error: 'Could not confirm Motion Canvas upload.' });
  }
});

// DELETE /api/motion-canvas/:id   { token }
// Lets an artist abandon a pending/ready upload never attached to a track.
// Mirrors DELETE /api/videos/:id — blocked while attached, same reasoning.
app.delete('/api/motion-canvas/:id', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const file = await dbGetMotionCanvasFile(req.params.id, sess.username);
    if (!file) return res.status(404).json({ error: 'Motion Canvas not found.' });

    const { data: attached } = await supabase
      .from('track_motion_canvas').select('id').eq('motion_canvas_file_id', file.id).maybeSingle();
    if (attached) {
      return res.status(409).json({ error: 'This Motion Canvas is attached to a track. Remove it from the track first.' });
    }

    const { error: removeErr } = await supabase.storage.from(MOTION_CANVAS_BUCKET).remove([file.storage_path]);
    if (removeErr) console.error('[motion-canvas delete] storage:', removeErr.message);
    await supabase.from('motion_canvas_files').delete().eq('id', file.id).eq('owner', sess.username);
    return res.json({ ok: true, deleted: file.filename });
  } catch (err) {
    console.error('[motion-canvas delete]', err);
    return res.status(500).json({ error: 'Could not delete Motion Canvas.' });
  }
});

// POST /api/tracks/:trackId/motion-canvas   { token, motionCanvasFileId }
// Attaches a ready, owned motion_canvas_files row to a track the caller's
// artist page owns. One canvas per track (v1) — re-attaching replaces the
// existing track_motion_canvas row.
app.post('/api/tracks/:trackId/motion-canvas', rateLimit, requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, motionCanvasFileId } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!motionCanvasFileId) return res.status(400).json({ error: '"motionCanvasFileId" is required.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track || !track.cloud_file_id) return res.status(404).json({ error: 'Track not found.' });
    const artist = await supabase.from('artists').select('account_id').eq('id', track.artist_id).maybeSingle();
    if (!artist.data || artist.data.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who owns this track can attach a Motion Canvas.' });
    }

    const file = await dbGetMotionCanvasFile(motionCanvasFileId, sess.username);
    if (!file) return res.status(404).json({ error: 'Motion Canvas upload not found.' });
    if (file.upload_status !== 'ready') {
      return res.status(409).json({ error: 'This Motion Canvas upload has not finished processing yet.' });
    }

    const existing = await dbGetTrackMotionCanvas(track.id);
    let row;
    if (existing) {
      const { data, error } = await supabase
        .from('track_motion_canvas')
        .update({ motion_canvas_file_id: file.id, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      if (error) throw new Error(error.message);
      row = data;
    } else {
      const { data, error } = await supabase
        .from('track_motion_canvas')
        .insert({ track_id: track.id, motion_canvas_file_id: file.id })
        .select().single();
      if (error) throw new Error(error.message);
      row = data;
    }

    return res.status(201).json({ id: row.id, trackId: row.track_id, motionCanvasFileId: row.motion_canvas_file_id });
  } catch (err) {
    console.error('[track motion-canvas attach]', err);
    return res.status(500).json({ error: 'Could not attach Motion Canvas to track.' });
  }
});

// DELETE /api/tracks/:trackId/motion-canvas   { token }
// Detaches (deletes the track_motion_canvas row) and removes the underlying
// file from Storage + motion_canvas_files — unlike DELETE /api/motion-canvas/:id,
// this IS allowed to remove an attached one, since detaching is the point.
app.delete('/api/tracks/:trackId/motion-canvas', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track) return res.status(404).json({ error: 'Track not found.' });
    const artist = await supabase.from('artists').select('account_id').eq('id', track.artist_id).maybeSingle();
    if (!artist.data || artist.data.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who owns this track can remove its Motion Canvas.' });
    }

    const row = await dbGetTrackMotionCanvas(track.id);
    if (!row) return res.status(404).json({ error: 'This track has no Motion Canvas.' });

    await supabase.from('track_motion_canvas').delete().eq('id', row.id);
    const { data: file } = await supabase.from('motion_canvas_files').select('storage_path').eq('id', row.motion_canvas_file_id).maybeSingle();
    if (file) {
      const { error: removeErr } = await supabase.storage.from(MOTION_CANVAS_BUCKET).remove([file.storage_path]);
      if (removeErr) console.error('[track motion-canvas delete] storage:', removeErr.message);
      await supabase.from('motion_canvas_files').delete().eq('id', row.motion_canvas_file_id);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[track motion-canvas detach]', err);
    return res.status(500).json({ error: 'Could not remove Motion Canvas.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  NAMED INDEXES  — server-curated playlists fetchable by slug
//  GET /api/index/:name  → { name, tracks: [...], total, fetchedAt }
//  GET /api/index        → { indexes: ['flex', ...] }
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Each entry is a resolved track object identical to what /api/resolve returns.
 * Add more named indexes below by adding a new key.
 */
const NAMED_INDEXES = {
  // Add named indexes here. Each key is the URL slug (e.g. 'flex', 'chill').
  // Tracks use the same shape as /api/resolve responses.
  //
  // Example:
  // flex: {
  //   label:       'FLEX',
  //   description: 'The FREQ FLEX showcase playlist.',
  //   tracks: [
  //     {
  //       platform: 'youtube', type: 'video', id: 'abc123',
  //       originalUrl: 'https://www.youtube.com/watch?v=abc123',
  //       embedUrl:    'https://www.youtube.com/embed/abc123?autoplay=1&controls=1&enablejsapi=1',
  //       embedUrlNC:  'https://www.youtube-nocookie.com/embed/abc123?autoplay=1&controls=1&enablejsapi=1',
  //       title:       'Track Title',
  //     },
  //   ],
  // },
};

// GET /api/index  — list all available named indexes
app.get('/api/index', (req, res) => {
  const indexes = Object.entries(NAMED_INDEXES).map(([slug, idx]) => ({
    slug,
    label:       idx.label,
    description: idx.description || '',
    total:       idx.tracks.length,
  }));
  return res.json({ indexes });
});

// GET /index  — alias for /api/index to support legacy or direct index routes
app.get('/index', (req, res) => {
  const indexes = Object.entries(NAMED_INDEXES).map(([slug, idx]) => ({
    slug,
    label:       idx.label,
    description: idx.description || '',
    total:       idx.tracks.length,
  }));
  return res.json({ indexes });
});

function getNamedIndexResponse(slug) {
  const idx = NAMED_INDEXES[slug];
  if (!idx) {
    return { status: 404, body: {
      error: `No index named "${slug}". Available: ${Object.keys(NAMED_INDEXES).join(', ')}`,
    } };
  }
  return { status: 200, body: {
    name:        slug,
    label:       idx.label,
    description: idx.description || '',
    tracks:      idx.tracks,
    total:       idx.tracks.length,
    fetchedAt:   Date.now(),
  } };
}

// GET /api/index/:name  — fetch a named index by slug
app.get('/api/index/:name', (req, res) => {
  const slug = req.params.name.toLowerCase().trim();
  const result = getNamedIndexResponse(slug);
  return res.status(result.status).json(result.body);
});

// GET /index/:name  — alias for /api/index/:name
app.get('/index/:name', (req, res) => {
  const slug = req.params.name.toLowerCase().trim();
  const result = getNamedIndexResponse(slug);
  return res.status(result.status).json(result.body);
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//  ACTIVITY FEED
//
//  GET /api/activity/feed          ?token= &scope=following|global &before=<ISO> &limit=<n>
//  GET /api/activity/feed/realtime                                                   SSE
//  GET /api/activity/unread        ?token= &since=<ISO>
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/activity/feed', requireFeatureAllowed('social_feed'), async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });

  const scope  = req.query.scope === 'global' ? 'global' : 'following';
  const before = req.query.before || null;
  const limit  = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

  try {
    const rawEvents = scope === 'global'
      ? await dbGetGlobalFeed({ limit, before })
      : await dbGetFollowingFeed(sess.username, { limit, before });

    const eventRefs = rawEvents.map(e => ({
      id: e.id,
      track_id: e.meta?.trackId || null,
      artist_id: e.meta?.artistId || null,
      release_id: e.meta?.releaseId || null,
    }));
    const visibleRefs = await filterRestrictedPostsForRequest(req, eventRefs);
    const visibleIds = new Set(visibleRefs.map(e => e.id));
    const events = rawEvents.filter(e => visibleIds.has(e.id));

    return res.json({
      events: events.map(e => ({
        id: e.id,
        type: e.event_type,
        actor: e.actor,
        targetUser: e.target_user,
        payload: e.meta, // DB column is `meta`; API field stays `payload` for an unchanged public contract
        createdAt: e.created_at,
      })),
      nextCursor: rawEvents.length === limit ? rawEvents[rawEvents.length - 1].created_at : null,
    });
  } catch (err) {
    console.error('[activity feed]', err);
    return res.status(500).json({ error: 'Could not load activity feed.' });
  }
});

app.get('/api/activity/unread', requireFeatureAllowed('social_feed'), async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  const since = req.query.since;
  if (!since) return res.json({ count: 0 });
  try {
    const count = await dbGetUnreadCount(sess.username, since);
    return res.json({ count });
  } catch (err) {
    return res.json({ count: 0 });
  }
});

// ─── Activity SSE fan-out ──────────────────────────────────────────────────────
// One server-side Supabase Realtime channel for the activity_feed table.
// Browsers subscribe to /api/activity/feed/realtime and receive push notifications
// when new rows are inserted — they then re-fetch to stay in sync.

const activitySseClients = new Map(); // username → Set<res>
let activityRealtimeChannel = null;

function ensureActivityRealtimeChannel() {
  if (activityRealtimeChannel) return;
  activityRealtimeChannel = supabase
    .channel('activity_feed_global')
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_feed' },
        (payload) => {
          const row = payload.new;
          // Fan out to: the target_user (if set) + the actor's followers (approximated by
          // broadcasting to everyone and letting the client filter by scope).
          // Simpler and correct: broadcast to all connected SSE clients with the new event.
          // Do not fan catalog metadata directly to every connected child;
          // their authenticated feed refetch applies rating/artist/genre/
          // track restrictions before returning any event details.
          const msg = `data: ${JSON.stringify({ refresh: true })}\n\n`;
          for (const clients of activitySseClients.values()) {
            for (const res of clients) {
              try { res.write(msg); } catch (_) {}
            }
          }
        })
    .subscribe();
}

function removeActivitySseClient(username, res) {
  const clients = activitySseClients.get(username);
  if (!clients) return;
  clients.delete(res);
  if (!clients.size) activitySseClients.delete(username);
  // If no more clients at all, tear down the realtime channel
  if (activitySseClients.size === 0 && activityRealtimeChannel) {
    supabase.removeChannel(activityRealtimeChannel);
    activityRealtimeChannel = null;
  }
}

app.get('/api/activity/feed/realtime', requireFeatureAllowed('social_feed'), async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  if (!activitySseClients.has(sess.username)) activitySseClients.set(sess.username, new Set());
  activitySseClients.get(sess.username).add(res);
  ensureActivityRealtimeChannel();

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeActivitySseClient(sess.username, res);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ARTIST PAGES
//  GET    /api/artists                    ?sort=followers|trending|recent&search=&limit=&offset=
//  GET    /api/artists/:id                ?token=     (id = artists.id uuid, OR @username for a claimed page)
//  GET    /api/artists/:id/tracks         ?sort=plays|trending&limit=
//  GET    /api/artists/:id/releases       ?type=single|album|ep|mixtape
//  GET    /api/artists/:id/activity       ?limit=&before=
//  POST   /api/artists/:id/follow         { token }
//  DELETE /api/artists/:id/follow         { token }
//  PATCH  /api/artists/:id                { token, bio?, avatarUrl?, bannerUrl? }   (claimed-owner only)
//  POST   /api/artists/claim              { token, artistId }                      (link your account to an unclaimed artist)
//  POST   /api/artists/:id/releases       { token, title, releaseType, coverUrl?, releaseDate?, trackIds? } (claimed-owner only)
//
//  Every read route here is intentionally unauthenticated-friendly, same
//  philosophy as Charts and Discovery — an artist page is browsable by a
//  visitor who hasn't signed in. token is optional on GET routes and only
//  used to compute isFollowing/isOwner for the requester.
// ═══════════════════════════════════════════════════════════════════════════════

// Resolves the :id path param to an artists row. Supports four shapes:
//   - a bare artists.id (uuid)              -> dbGetArtistById
//   - "@username"                           -> dbGetArtistByAccount (claimed page, looked up by the claiming account)
//   - a bare username with no "@" that      -> falls back to dbGetArtistByAccount too, so
//     happens not to look like a uuid          /api/artists/slimey2017 and /api/artists/@slimey2017
//                                                both work without the caller needing to know which
//                                                form an id is in.
//   - a slug (artists.slug)                 -> dbGetArtistBySlug — the form /artist/:slug actually
//                                                routes with, and the only one that resolves
//                                                UNCLAIMED artists (no account_id, so no username to
//                                                look up by at all).
// This is the "single :id path param could plausibly be either" case the
// comment above dbGetArtist already flagged as a future need — implementing
// it at the route layer (rather than in dbGetArtist itself) keeps the DB
// helpers' contracts narrow and testable, and keeps this dual-lookup
// concern in exactly one place.
async function resolveArtistFromParam(idParam) {
  const raw = decodeURIComponent(idParam || '').trim();
  if (!raw) return null;
  if (raw.startsWith('@')) return dbGetArtistByAccount(raw.slice(1).toLowerCase());
  if (UUID_RE.test(raw)) return dbGetArtistById(raw);
  // Not a uuid and no @ prefix — try slug first (the canonical /artist/:slug
  // form, and the only lookup that works for unclaimed artists), then fall
  // back to account username for the older /api/artists/slimey2017 convenience
  // form. Slug first because every artist has one (NOT NULL), while only
  // claimed artists have an account_id to match against.
  const bySlug = await dbGetArtistBySlug(raw.toLowerCase());
  if (bySlug) return bySlug;
  return dbGetArtistByAccount(raw.toLowerCase());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SOCIAL POSTS SYSTEM
//
//  POST   /api/posts                    create a post (auth required)
//  GET    /api/posts                    global feed (paginated)
//  GET    /api/posts/user/:username     posts by a user
//  GET    /api/posts/:id                single post
//  PATCH  /api/posts/:id                edit post (owner only)
//  DELETE /api/posts/:id                delete post (owner only)
//  POST   /api/posts/:id/like           like a post
//  DELETE /api/posts/:id/like           unlike a post
//  POST   /api/posts/:id/comments       add comment
//  GET    /api/posts/:id/comments       list comments
//  DELETE /api/posts/:id/comments/:cid  delete comment (owner only)
// ═══════════════════════════════════════════════════════════════════════════════

// ── DB helpers ───────────────────────────────────────────────────────────────

async function dbCreatePost(username, { postType, body, playlistId, trackId, artistId, releaseId }) {
  const { data, error } = await supabase.from('posts').insert({
    author: username,
    post_type: postType || 'text',
    body: body || null,
    playlist_id: playlistId || null,
    track_id: trackId || null,
    artist_id: artistId || null,
    release_id: releaseId || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbGetPost(postId) {
  const { data, error } = await supabase.from('posts')
    .select('*, profiles:author!inner(username, display_name, avatar_url), artists:artist_id(id, name, slug, avatar_url, is_verified)')
    .eq('id', postId).maybeSingle();
  if (error) { console.error('[db] getPost:', error.message); return null; }
  return data;
}

async function dbGetPostsFeed({ before = null, limit = 20, username = null, artistId = null, artistVoiceOnly = false } = {}) {
  let q = supabase.from('posts')
    .select('*, profiles:author!inner(username, display_name, avatar_url), artists:artist_id(id, name, slug, avatar_url, is_verified)')
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50));
  if (username) q = q.eq('author', username);
  if (artistId) {
    q = q.eq('artist_id', artistId);
    // artist_id means two different things depending on post_type: "this
    // artist is speaking" (release_announcement/artist_update) vs "this
    // artist is the subject of someone else's Artist Share post". The
    // artist's own page/dashboard "posts by this artist" list wants only
    // the former — otherwise a stranger's Artist Share recommending this
    // artist would show up looking like the artist posted it themselves.
    if (artistVoiceOnly) q = q.in('post_type', ['release_announcement', 'artist_update']);
  }
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) { console.error('[db] getPostsFeed:', error.message); return []; }
  return data || [];
}

// Artist-only post types (release_announcement, artist_update) are
// presented as coming from the artist page, not the underlying account —
// a fan following "DJ Nova" the artist shouldn't see the post attributed
// to whatever username claimed that page. Every other post type (including
// a regular post that merely references an artist via artist Share) still
// shows the human author, since artist_id there is "the recommendation" not
// "the speaker".
const ARTIST_VOICE_POST_TYPES = ['release_announcement', 'artist_update'];
function formatPost(p, myUsername = null) {
  const postingAsArtist = ARTIST_VOICE_POST_TYPES.includes(p.post_type) && p.artists;
  return {
    id: p.id,
    author: p.author,
    displayName: postingAsArtist ? p.artists.name : (p.profiles?.display_name || p.author),
    avatarUrl: postingAsArtist ? p.artists.avatar_url : (p.profiles?.avatar_url || null),
    postedAsArtist: !!postingAsArtist,
    artistSlug: p.artists?.slug || null,
    artistIsVerified: p.artists?.is_verified || false,
    postType: p.post_type,
    body: p.body,
    playlistId: p.playlist_id,
    trackId: p.track_id,
    artistId: p.artist_id,
    releaseId: p.release_id,
    likeCount: p.like_count || 0,
    commentCount: p.comment_count || 0,
    shareCount: p.share_count || 0,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    isOwner: myUsername ? p.author === myUsername : false,
  };
}

// Hide posts that point at content the requester is not allowed to discover.
// Text-only posts remain visible; a restricted track/artist/release post is
// removed entirely so the social feed cannot act as a metadata side channel.
async function filterRestrictedPostsForRequest(req, rows) {
  const input = Array.isArray(rows) ? rows : [];
  if (!input.length) return input;
  const hiddenPostIds = new Set();
  const allowedRatings = new Set(await getAllowedRatingsForRequest(req));

  const trackIds = [...new Set(input.map(p => p.track_id).filter(Boolean))];
  if (trackIds.length) {
    const { data, error } = await supabase.from('tracks')
      .select('id, artist_id, content_rating').in('id', trackIds).eq('is_published', true);
    if (error) throw new Error(error.message);
    const visibleTracks = await filterBlockedTracksForRequest(req, (data || []).filter(t => allowedRatings.has(t.content_rating || 'clean')));
    const visibleIds = new Set(visibleTracks.map(t => t.id));
    for (const post of input) if (post.track_id && !visibleIds.has(post.track_id)) hiddenPostIds.add(post.id);
  }

  const artistIds = [...new Set(input.map(p => p.artist_id).filter(Boolean))];
  if (artistIds.length) {
    const { data, error } = await supabase.from('artists').select('*').in('id', artistIds);
    if (error) throw new Error(error.message);
    const visibleArtists = await filterBlockedArtistsForRequest(req, data || []);
    const visibleIds = new Set(visibleArtists.map(a => a.id));
    for (const post of input) if (post.artist_id && !visibleIds.has(post.artist_id)) hiddenPostIds.add(post.id);
  }

  const releaseIds = [...new Set(input.map(p => p.release_id).filter(Boolean))];
  if (releaseIds.length) {
    const { data, error } = await supabase.from('artist_releases')
      .select('id, artist_id, content_rating').in('id', releaseIds);
    if (error) throw new Error(error.message);
    const visibleIds = new Set((data || [])
      .filter(r => allowedRatings.has(r.content_rating || 'clean'))
      .map(r => r.id));
    for (const post of input) if (post.release_id && !visibleIds.has(post.release_id)) hiddenPostIds.add(post.id);
  }

  return input.filter(post => !hiddenPostIds.has(post.id));
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.post('/api/posts', rateLimit, requireFeatureAllowed('social_feed'), async (req, res) => {
  const { token, postType, body, playlistId, trackId, artistId, releaseId } = req.body || {};
  const sess = req._session || await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before posting.', emailVerificationRequired: true });
  if (!body && !playlistId && !trackId && !artistId && !releaseId) {
    return res.status(400).json({ error: 'Post must have body text or reference content.' });
  }
  if (body && body.length > 1000) return res.status(400).json({ error: 'Post body must be 1000 characters or fewer.' });

  // Every account can post. 'release_announcement' and 'artist_update' are
  // the two artist-only types — they require posting *as* a claimed artist
  // page, enforced below and mirrored by a DB CHECK (posts_artist_post_types_
  // require_artist_id) so this can't drift out of sync with the schema.
  const POST_TYPES = ['text', 'track', 'playlist', 'artist', 'release_announcement', 'artist_update'];
  const ARTIST_ONLY_TYPES = ['release_announcement', 'artist_update'];
  const resolvedType = postType || 'text';
  if (!POST_TYPES.includes(resolvedType)) {
    return res.status(400).json({ error: `Invalid post type. Must be one of: ${POST_TYPES.join(', ')}.` });
  }
  if (ARTIST_ONLY_TYPES.includes(resolvedType) && !artistId) {
    return res.status(400).json({ error: 'Release announcements and artist updates must be posted from an artist page.' });
  }
  if (resolvedType === 'release_announcement' && !releaseId) {
    return res.status(400).json({ error: 'A release announcement must reference a release.' });
  }

  try {
    // artistId on a post means "this post is from/about this artist page" —
    // when it's set, only the account that claimed that artist page may
    // post as it. Without this check, any signed-in account could tag an
    // arbitrary artistId on a post and have it show up as if that artist
    // posted it, which matters now that the Dashboard's Posts tab lets an
    // owner publish announcements this way.
    let postingArtist = null;
    if (artistId) {
      postingArtist = await dbGetArtistById(artistId);
      if (!postingArtist || postingArtist.account_id !== sess.username) {
        return res.status(403).json({ error: 'Only the artist who claimed this page can post as it.' });
      }
    }
    // releaseId on a release_announcement must belong to that same artist —
    // same "don't let the client tag arbitrary foreign-key ids" concern as
    // the artistId check above, just one level deeper.
    if (resolvedType === 'release_announcement') {
      const { data: rel } = await supabase
        .from('artist_releases').select('id').eq('id', releaseId).eq('artist_id', artistId).maybeSingle();
      if (!rel) return res.status(403).json({ error: 'That release does not belong to this artist.' });
    }
    // A shared playlist must be public, or owned by the person sharing it —
    // otherwise any account could post an arbitrary playlists_v2 id and the
    // resulting post-ref-card would point at a private playlist that isn't
    // theirs to surface. (The viewer itself separately enforces access on
    // open, but the post shouldn't be creatable pointing at it at all.)
    if (playlistId) {
      const { data: pl } = await supabase
        .from('playlists_v2').select('owner, is_public').eq('id', playlistId).maybeSingle();
      if (!pl || (!pl.is_public && pl.owner !== sess.username)) {
        return res.status(403).json({ error: 'You can only share your own or public playlists.' });
      }
    }
    // A shared track must actually be a published FREQ track — unpublished
    // (draft) tracks have no public stream and shouldn't be shareable.
    if (trackId) {
      const { data: tr } = await supabase
        .from('tracks').select('id, is_published').eq('id', trackId).maybeSingle();
      if (!tr || !tr.is_published) {
        return res.status(403).json({ error: 'That track is not available to share.' });
      }
    }
    const post = await dbCreatePost(sess.username, { postType: resolvedType, body, playlistId, trackId, artistId, releaseId });
    // Write to activity feed
    const activityType = ARTIST_ONLY_TYPES.includes(resolvedType) ? resolvedType : 'user_post';
    dbWriteActivity(activityType, sess.username, null, {
      postId: post.id,
      preview: (body || '').slice(0, 80),
      artistId: artistId || null,
      artistName: postingArtist?.name || null,
      releaseId: releaseId || null,
    });
    return res.status(201).json({ post: formatPost(post, sess.username) });
  } catch (err) {
    console.error('[posts create]', err);
    return res.status(500).json({ error: 'Could not create post.' });
  }
});

app.get('/api/posts', requireFeatureAllowed('social_feed', { allowAnonymous: true }), async (req, res) => {
  const before = req.query.before || null;
  const limit  = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const token  = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess   = token ? await dbGetSession(token) : null;
  try {
    const rawPosts = await dbGetPostsFeed({ before, limit });
    const posts = await filterRestrictedPostsForRequest(req, rawPosts);
    // Batch-fetch liked status
    let likedIds = new Set();
    if (sess && posts.length) {
      const ids = posts.map(p => p.id);
      const { data: likes } = await supabase.from('post_likes')
        .select('post_id').eq('username', sess.username).in('post_id', ids);
      likedIds = new Set((likes || []).map(l => l.post_id));
    }
    return res.json({
      posts: posts.map(p => ({ ...formatPost(p, sess?.username), likedByMe: likedIds.has(p.id) })),
      hasMore: rawPosts.length === limit,
    });
  } catch (err) {
    console.error('[posts feed]', err);
    return res.status(500).json({ error: 'Could not load posts.' });
  }
});

app.get('/api/posts/user/:username', requireFeatureAllowed('social_feed', { allowAnonymous: true }), async (req, res) => {
  const username = normalizeUsername(req.params.username);
  const before   = req.query.before || null;
  const limit    = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const token    = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess     = token ? await dbGetSession(token) : null;
  try {
    const rawPosts = await dbGetPostsFeed({ before, limit, username });
    const posts = await filterRestrictedPostsForRequest(req, rawPosts);
    let likedIds = new Set();
    if (sess && posts.length) {
      const ids = posts.map(p => p.id);
      const { data: likes } = await supabase.from('post_likes')
        .select('post_id').eq('username', sess.username).in('post_id', ids);
      likedIds = new Set((likes || []).map(l => l.post_id));
    }
    return res.json({
      posts: posts.map(p => ({ ...formatPost(p, sess?.username), likedByMe: likedIds.has(p.id) })),
      hasMore: rawPosts.length === limit,
    });
  } catch (err) {
    console.error('[posts user]', err);
    return res.status(500).json({ error: 'Could not load posts.' });
  }
});

app.get('/api/posts/artist/:id', requireFeatureAllowed('social_feed', { allowAnonymous: true }), async (req, res) => {
  const before = req.query.before || null;
  const limit  = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const token  = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess   = token ? await dbGetSession(token) : null;
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (await isArtistBlockedForRequest(req, artist)) return res.json({ posts: [], hasMore: false });
    const rawPosts = await dbGetPostsFeed({ before, limit, artistId: artist.id, artistVoiceOnly: true });
    const posts = await filterRestrictedPostsForRequest(req, rawPosts);
    let likedIds = new Set();
    if (sess && posts.length) {
      const ids = posts.map(p => p.id);
      const { data: likes } = await supabase.from('post_likes')
        .select('post_id').eq('username', sess.username).in('post_id', ids);
      likedIds = new Set((likes || []).map(l => l.post_id));
    }
    return res.json({
      posts: posts.map(p => ({ ...formatPost(p, sess?.username), likedByMe: likedIds.has(p.id) })),
      hasMore: rawPosts.length === limit,
    });
  } catch (err) {
    console.error('[posts artist]', err);
    return res.status(500).json({ error: 'Could not load artist posts.' });
  }
});
app.get('/api/posts/:id', requireFeatureAllowed('social_feed', { allowAnonymous: true }), async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = token ? await dbGetSession(token) : null;
  try {
    const post = await dbGetPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const visiblePosts = await filterRestrictedPostsForRequest(req, [post]);
    if (!visiblePosts.length) return res.status(404).json({ error: 'Post not found.' });
    let likedByMe = false;
    if (sess) {
      const { data } = await supabase.from('post_likes')
        .select('post_id').eq('post_id', post.id).eq('username', sess.username).maybeSingle();
      likedByMe = !!data;
    }
    return res.json({ post: { ...formatPost(post, sess?.username), likedByMe } });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load post.' });
  }
});

app.patch('/api/posts/:id', rateLimit, requireFeatureAllowed('social_feed'), async (req, res) => {
  const { token, body } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!body || typeof body !== 'string') return res.status(400).json({ error: '"body" is required.' });
  if (body.length > 1000) return res.status(400).json({ error: 'Post body must be 1000 characters or fewer.' });
  try {
    const post = await dbGetPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.author !== sess.username) return res.status(403).json({ error: 'Not your post.' });
    const { data, error } = await supabase.from('posts')
      .update({ body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    return res.json({ post: formatPost(data, sess.username) });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update post.' });
  }
});

app.delete('/api/posts/:id', rateLimit, async (req, res) => {
  const { token } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const post = await dbGetPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.author !== sess.username) return res.status(403).json({ error: 'Not your post.' });
    await supabase.from('posts').delete().eq('id', req.params.id);
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete post.' });
  }
});

app.post('/api/posts/:id/like', rateLimit, requireFeatureAllowed('social_feed'), async (req, res) => {
  const { token } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const { error } = await supabase.from('post_likes')
      .upsert({ post_id: req.params.id, username: sess.username }, { onConflict: 'post_id,username' });
    if (error && error.code !== '23505') throw new Error(error.message);
    const { count } = await supabase.from('post_likes')
      .select('*', { count: 'exact', head: true }).eq('post_id', req.params.id);
    await supabase.from('posts').update({ like_count: count || 0 }).eq('id', req.params.id);
    return res.json({ liked: true, likeCount: count || 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Could not like post.' });
  }
});

app.delete('/api/posts/:id/like', rateLimit, async (req, res) => {
  const { token } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    await supabase.from('post_likes').delete().eq('post_id', req.params.id).eq('username', sess.username);
    const { count } = await supabase.from('post_likes')
      .select('*', { count: 'exact', head: true }).eq('post_id', req.params.id);
    await supabase.from('posts').update({ like_count: count || 0 }).eq('id', req.params.id);
    return res.json({ liked: false, likeCount: count || 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Could not unlike post.' });
  }
});
app.post('/api/posts/:id/share', rateLimit, requireFeatureAllowed('social_feed'), async (req, res) => {
  const { token } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const post = await dbGetPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const shareCount = (Number(post.share_count) || 0) + 1;
    const { error } = await supabase.from('posts').update({ share_count: shareCount }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    dbWriteActivity('post_shared', sess.username, post.author !== sess.username ? post.author : null, {
      postId: post.id,
      preview: (post.body || '').slice(0, 80),
    });
    return res.json({ shared: true, shareCount });
  } catch (err) {
    console.error('[posts share]', err);
    return res.status(500).json({ error: 'Could not share post.' });
  }
});

app.post('/api/posts/:id/comments', rateLimit, requireFeatureAllowed('social_feed'), async (req, res) => {
  const { token, body } = req.body || {};
  const sess = req._session || await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before commenting.', emailVerificationRequired: true });
  if (!body || typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: '"body" is required.' });
  if (body.length > 500) return res.status(400).json({ error: 'Comment must be 500 characters or fewer.' });
  try {
    const { data, error } = await supabase.from('post_comments').insert({
      post_id: req.params.id, author: sess.username, body: body.trim(),
    }).select().single();
    if (error) throw new Error(error.message);
    const { count } = await supabase.from('post_comments')
      .select('*', { count: 'exact', head: true }).eq('post_id', req.params.id);
    await supabase.from('posts').update({ comment_count: count || 0 }).eq('id', req.params.id);
    return res.status(201).json({ comment: data });
  } catch (err) {
    return res.status(500).json({ error: 'Could not add comment.' });
  }
});

app.get('/api/posts/:id/comments', requireFeatureAllowed('social_feed', { allowAnonymous: true }), async (req, res) => {
  try {
    const { data, error } = await supabase.from('post_comments')
      .select('*, profiles:author!inner(username, display_name, avatar_url)')
      .eq('post_id', req.params.id)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);
    return res.json({ comments: (data || []).map(c => ({
      id: c.id, postId: c.post_id, author: c.author,
      displayName: c.profiles?.display_name || c.author,
      avatarUrl: c.profiles?.avatar_url || null,
      body: c.body, createdAt: c.created_at,
    })) });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load comments.' });
  }
});

app.delete('/api/posts/:id/comments/:cid', rateLimit, async (req, res) => {
  const { token } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const { data: comment } = await supabase.from('post_comments')
      .select('author, post_id').eq('id', req.params.cid).maybeSingle();
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });
    if (comment.author !== sess.username) return res.status(403).json({ error: 'Not your comment.' });
    await supabase.from('post_comments').delete().eq('id', req.params.cid);
    const { count } = await supabase.from('post_comments')
      .select('*', { count: 'exact', head: true }).eq('post_id', req.params.id);
    await supabase.from('posts').update({ comment_count: count || 0 }).eq('id', req.params.id);
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete comment.' });
  }
});

// Also expose artist follower count recompute as admin util (GET returns current counts)
app.post('/api/admin/recount-artist-followers', rateLimit, requireAdmin, async (req, res) => {
  try {
    const { data: artists } = await supabase.from('artists').select('id');
    let updated = 0;
    for (const a of (artists || [])) {
      const { count } = await supabase.from('artist_followers')
        .select('*', { count: 'exact', head: true }).eq('artist_id', a.id);
      await supabase.from('artists').update({ follower_count: count || 0 }).eq('id', a.id);
      updated++;
    }
    return res.json({ recount: true, artistsUpdated: updated });
  } catch (err) {
    return res.status(500).json({ error: 'Recount failed.' });
  }
});

// Admin-only: force the Daily Musi-Shop rotation to regenerate right now,
// instead of waiting for the next 8:00 AM America/New_York cycle. Uses the
// same generation path as the automatic rotation, so item-selection rules
// (category diversity via seeded shuffle, 6 daily + 1 legendary + 1 deal, no
// duplicate SKUs within the rotation) are identical. Only replaces *today's*
// rotation_date rows -- every other date's rows (and every purchase made
// against them) are left alone, so purchase history stays intact.
app.post('/api/admin/musi-shop/reset-daily', rateLimit, requireAdmin, async (req, res) => {
  try {
    const seasonalCollections = await dbGetMusiShopCollections(await dbGetMusiShopSettings());
    const liveSeasonKeys = new Set(
      seasonalCollections.filter(collection => collection.purchasable).map(collection => collection.collectionKey)
    );
    const catalog = await dbGetMusiShopCatalog({ liveSeasonKeys });
    const result = await dbResetMusiShopDailyRotation(req._adminSession.username, catalog);
    return res.json({ reset: true, ...result });
  } catch (err) {
    console.error('[admin musi-shop reset]', err);
    return res.status(500).json({ error: 'Could not reset the Daily Shop rotation.' });
  }
});

// ─── END SOCIAL POSTS ────────────────────────────────────────────────────────

app.get('/api/artists', requireFeatureAllowed('artist_pages', { allowAnonymous: true }), async (req, res) => {
  const sort   = ['trending', 'recent', 'followers'].includes(req.query.sort) ? req.query.sort : 'followers';
  const limit  = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const search = (req.query.search || '').trim().slice(0, 100) || null;
  try {
    const rawArtists = await dbListArtists({ sort, limit, offset, search });
    const artists = await filterBlockedArtistsForRequest(req, rawArtists);
    return res.json({
      artists: artists.map(a => ({
        id: a.id, slug: a.slug, name: a.name, avatarUrl: a.avatar_url, bannerUrl: a.banner_url,
        isVerified: a.is_verified, isClaimed: !!a.account_id, followerCount: a.follower_count,
      })),
    });
  } catch (err) {
    console.error('[artists list]', err);
    return res.status(500).json({ error: 'Could not load artists.' });
  }
});

app.get('/api/artists/:id', requireFeatureAllowed('artist_pages', { allowAnonymous: true }), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (await isArtistBlockedForRequest(req, artist)) return res.status(404).json({ error: 'Artist not found.' });

    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    const sess  = token ? await dbGetSession(token) : null;
    const [cachedStats, isFollowing] = await Promise.all([
      dbGetArtistStats(artist.id),
      sess ? dbIsFollowingArtist(sess.username, artist.id) : Promise.resolve(false),
    ]);
    const stats = await dbGetLiveArtistStats(artist.id, cachedStats);
    let artistMessaging = { enabled: false, recipientUsername: null, requestRequired: true };
    if (sess && artist.account_id && artist.account_id !== sess.username) {
      try {
        const permission = await dbCanRequestDirect(sess.username, artist.account_id);
        artistMessaging = {
          enabled: !!permission.allowed,
          recipientUsername: permission.allowed ? artist.account_id : null,
          requestRequired: permission.requestRequired !== false,
        };
      } catch (messagingError) {
        // Artist pages must continue to load during a code-first deployment
        // before the messaging migration is applied. The button simply stays
        // hidden until its server-side privacy check is available.
        console.warn('[artist messaging availability]', messagingError.message);
      }
    }

    return res.json({
      id: artist.id,
      slug: artist.slug,
      name: artist.name,
      avatarUrl: artist.avatar_url,
      bannerUrl: artist.banner_url,
      bio: artist.bio,
      genre: artist.genre,
      links: artist.links || {},
      isVerified: artist.is_verified,
      isClaimed: !!artist.account_id,
      isOwner: !!(sess && artist.account_id === sess.username),
      messageEnabled: artistMessaging.enabled,
      messageRecipientUsername: artistMessaging.recipientUsername,
      messageRequestRequired: artistMessaging.requestRequired,
      followerCount: stats.followerCount,
      isFollowing,
      joinedAt: artist.created_at,
      stats: {
        totalPlays: stats.totalPlays,
        totalPlays7d: stats.totalPlays7d,
        totalLikesReceived: stats.totalLikesReceived,
        monthlyListeners: stats.monthlyListeners,
        chartRank: stats.chartRank,
        chartRankPrev: stats.chartRankPrev,
        chartMovement: (stats.chartRank != null && stats.chartRankPrev != null)
          ? stats.chartRankPrev - stats.chartRank
          : null,
      },
    });
  } catch (err) {
    console.error('[artist get]', err);
    return res.status(500).json({ error: 'Could not load artist.' });
  }
});

app.get('/api/artists/:id/tracks', requireFeatureAllowed('artist_pages', { allowAnonymous: true }), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (await isArtistBlockedForRequest(req, artist)) return res.json({ tracks: [] });
    const sort  = req.query.sort === 'trending' ? 'trending' : 'plays';
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const allowedRatings = await getAllowedRatingsForRequest(req);
    const rawTracks = await dbGetArtistTracks(artist.id, { sort, limit, allowedRatings });
    const tracks = await filterBlockedTracksForRequest(req, rawTracks);
    const collabsByTrack = await dbGetCollaboratorsForTracks(tracks.map(t => t.id));
    // Batched video-attached check, same shape as the search badge above —
    // backs the 🎬 badge on artist pages without an N+1 per track row.
    let videoTrackIds = new Set();
    if (tracks.length) {
      const { data: videos } = await supabase.from('track_videos')
        .select('track_id').in('track_id', tracks.map(t => t.id));
      videoTrackIds = new Set((videos || []).map(v => v.track_id));
    }
    // Batched Motion Canvas-attached check, same shape as videoTrackIds —
    // backs Edit Track's "has canvas" state without an N+1 per track row.
    let canvasTrackIds = new Set();
    if (tracks.length) {
      const { data: canvases } = await supabase.from('track_motion_canvas')
        .select('track_id').in('track_id', tracks.map(t => t.id));
      canvasTrackIds = new Set((canvases || []).map(c => c.track_id));
    }
    // Batched current-release lookup — same one-query-for-all-tracks shape
    // as videoTrackIds above. Powers Edit Track's release dropdown actually
    // pre-selecting the track's current release instead of always resetting
    // to "No release (standalone)" on open regardless of the real value.
    let releaseIdByTrack = new Map();
    if (tracks.length) {
      const { data: links } = await supabase.from('artist_release_tracks')
        .select('track_id, release_id').in('track_id', tracks.map(t => t.id));
      releaseIdByTrack = new Map((links || []).map(l => [l.track_id, l.release_id]));
    }
    // Batched duration lookup — cloud_files.duration is already captured at
    // upload time (see POST /api/cloud-files) but was never joined through
    // to the artist-page track list. Same batched-by-id shape as
    // videoTrackIds/canvasTrackIds above, keyed by cloud_file_id since
    // duration lives on cloud_files, not tracks.
    let durationByCloudId = new Map();
    const cloudIdsForDuration = tracks.map(t => t.cloud_file_id).filter(Boolean);
    if (cloudIdsForDuration.length) {
      const { data: cloudRows } = await supabase.from('cloud_files')
        .select('id, duration').in('id', cloudIdsForDuration);
      durationByCloudId = new Map((cloudRows || []).map(c => [String(c.id), Number(c.duration)]));
    }
    // Batched like-state lookup for the signed-in visitor — mirrors the
    // token/session resolution already used for isOwner/isFollowing on
    // GET /api/artists/:id. Anonymous visitors simply get likedByMe:false
    // for everything, same as isFollowing does.
    const likeToken = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    const likeSess = likeToken ? await dbGetSession(likeToken) : null;
    let likedTrackIds = new Set();
    if (likeSess && tracks.length) {
      const { data: likeRows } = await supabase.from('track_likes')
        .select('track_id').eq('username', likeSess.username).in('track_id', tracks.map(t => t.id));
      likedTrackIds = new Set((likeRows || []).map(l => l.track_id));
    }
    return res.json({
      tracks: tracks.map(t => ({
        id: t.id, originalUrl: t.original_url, platform: t.platform,
        title: t.title || t.original_url,
        description: t.description || null,
        playCount: t.play_count, playCount7d: t.play_count_7d,
        likeCount: t.like_count || 0,
        likedByMe: likedTrackIds.has(t.id),
        lastPlayedAt: t.last_played_at,
        coverUrl: t.cover_url || null,
        cloudFileId: t.cloud_file_id || null,
        publishedAt: t.published_at || null,
        isUpload: !!t.cloud_file_id,
        isExplicit: !!t.is_explicit,
        contentRating: t.content_rating || 'clean',
        contentRatingTags: t.content_rating_tags || [],
        contentRatingLocked: !!t.content_rating_locked,
        collaborators: (collabsByTrack.get(t.id) || []).map(shapeCollaborator),
        hasVideo: videoTrackIds.has(t.id),
        hasMotionCanvas: canvasTrackIds.has(t.id),
        releaseId: releaseIdByTrack.get(t.id) || null,
        durationSeconds: t.cloud_file_id && Number.isFinite(durationByCloudId.get(String(t.cloud_file_id)))
          ? durationByCloudId.get(String(t.cloud_file_id)) : null,
      })),
    });
  } catch (err) {
    console.error('[artist tracks]', err);
    return res.status(500).json({ error: 'Could not load artist tracks.' });
  }
});

// ─── Creator Insights v1 ───────────────────────────────────────────────────
// Owner-only. Same existence-probing shape as other owner-gated routes in
// this file: a non-owner (or logged-out visitor) gets 404, not 403 — so a
// stranger probing an artist id can't distinguish "not your artist" from
// "no such artist" by response code. The breakdown itself (plays by
// source, by day, per-track) is available to every artist regardless of
// Premium status; only the raw CSV download below is Premium-gated, per
// the roadmap's "Basic play counts free / full funnel + export Premium"
// split — withholding the funnel data itself from Free artists would make
// the free tier feel crippled rather than the paid tier feel additive.
app.get('/api/artists/:id/insights', requireFeatureAllowed('artist_pages'), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });

    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    const sess  = token ? await dbGetSession(token) : null;
    if (!sess || artist.account_id !== sess.username) {
      return res.status(404).json({ error: 'Artist not found.' });
    }

    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
    const insights = await dbGetArtistInsights(artist.id, { days });
    if (!insights) return res.status(500).json({ error: 'Could not load insights.' });

    return res.json({ artistId: artist.id, windowDays: days, ...insights });
  } catch (err) {
    console.error('[artist insights]', err);
    return res.status(500).json({ error: 'Could not load insights.' });
  }
});

// CSV export — Premium only. Reuses dbGetArtistInsights (same aggregation,
// same owner check) rather than a second query path; this route's only
// added job is formatting the response as CSV instead of JSON.
app.get('/api/artists/:id/insights/export.csv', requireFeatureAllowed('artist_pages'), requirePremium, async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== req._premiumSession.username) {
      return res.status(404).json({ error: 'Artist not found.' });
    }

    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
    const insights = await dbGetArtistInsights(artist.id, { days });
    if (!insights) return res.status(500).json({ error: 'Could not export insights.' });

    const sourceKeys = PLAY_SOURCES;
    const header = ['Track', 'Plays (all-time)', 'Plays (7d)', `Plays (last ${days}d)`, ...sourceKeys.map(s => `Source: ${s}`)];
    // Minimal CSV field escaping: wrap in quotes and double-up any embedded
    // quote characters. Track titles are free text and can legitimately
    // contain commas or quotes, so this can't be skipped.
    const escapeCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = insights.tracks.map(t => [
      escapeCsv(t.title), t.playCountAllTime, t.playCount7d, t.playsInWindow,
      ...sourceKeys.map(s => t.bySource[s] || 0),
    ].join(','));

    const csv = [header.map(escapeCsv).join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="freq-insights-${artist.slug || artist.id}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error('[artist insights export]', err);
    return res.status(500).json({ error: 'Could not export insights.' });
  }
});

app.get('/api/artists/:id/releases', requireFeatureAllowed('artist_pages', { allowAnonymous: true }), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (await isArtistBlockedForRequest(req, artist)) return res.json({ releases: [] });
    // Owner can see private/unlisted releases; visitors only see public.
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
    let isOwner = false;
    if (token) {
      const sess = await dbGetSession(token);
      isOwner = !!(sess && artist.account_id === sess.username);
    }
    const type = ['single', 'album', 'ep', 'mixtape', 'compilation'].includes(req.query.type) ? req.query.type : null;
    const allowedRatings = await getAllowedRatingsForRequest(req);
    const releases = await dbGetArtistReleases(artist.id, { type, includeNonPublic: isOwner, allowedRatings });
    const releasesWithCollabs = await Promise.all(releases.map(async r => ({
      r, collaborators: (await dbGetReleaseCollaborators(r.id)).map(shapeCollaborator),
    })));
    return res.json({
      releases: await Promise.all(releasesWithCollabs.map(async ({ r, collaborators }) => ({
        id: r.id, title: r.title, releaseType: r.release_type, coverUrl: r.cover_url,
        releaseDate: r.release_date, trackCount: r.track_count, totalPlays: r.total_plays,
        totalLikes: r.total_likes, description: r.description, externalUrl: r.external_url,
        visibility: r.visibility || 'public',
        // content_rating is maintained by recomputeReleaseContentRating()
        // (worst-of-tracks — Part 2), not computed live per-request the way
        // the old isExplicit check used to be. isExplicit is kept as a
        // derived legacy flag for existing "E" badge call sites.
        contentRating: r.content_rating || 'clean',
        isExplicit: (r.content_rating || 'clean') !== 'clean',
        collaborators,
      }))),
    });
  } catch (err) {
    console.error('[artist releases]', err);
    return res.status(500).json({ error: 'Could not load releases.' });
  }
});

app.get('/api/artists/:id/releases/:releaseId/tracks', requireFeatureAllowed('artist_pages', { allowAnonymous: true }), async (req, res) => {
  try {
    // Visibility gate: private releases require ownership
    const { data: release, error: relErr } = await supabase
      .from('artist_releases')
      .select('id, visibility, artist_id')
      .eq('id', req.params.releaseId)
      .maybeSingle();
    if (relErr || !release) return res.status(404).json({ error: 'Release not found.' });

    const releaseArtist = await dbGetArtistById(release.artist_id);
    if (releaseArtist && await isArtistBlockedForRequest(req, releaseArtist)) {
      return res.status(404).json({ error: 'Release not found.' });
    }

    if (release.visibility === 'private') {
      const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
      const sess = token ? await dbGetSession(token) : null;
      const artist = sess ? await dbGetArtistById(release.artist_id) : null;
      if (!artist || artist.account_id !== sess?.username) {
        return res.status(403).json({ error: 'This release is private.' });
      }
    }

    const allowedRatings = await getAllowedRatingsForRequest(req);
    const rawTracks = await dbGetReleaseTracks(req.params.releaseId, { allowedRatings });
    // Part 6: specific artist/genre/track blocks on top of the rating
    // ceiling — an individual track within an otherwise-visible release can
    // still be blocked.
    const tracks = await filterBlockedTracksForRequest(req, rawTracks);
    const collabsByTrack = await dbGetCollaboratorsForTracks(tracks.map(t => t.id));
    // Batched video-attached check — backs the 🎬 badge on release
    // tracklists (album/EP/single pages) per spec.
    let videoTrackIds = new Set();
    if (tracks.length) {
      const { data: videos } = await supabase.from('track_videos')
        .select('track_id').in('track_id', tracks.map(t => t.id));
      videoTrackIds = new Set((videos || []).map(v => v.track_id));
    }
    // Batched duration lookup — same join as GET /api/artists/:id/tracks
    // (cloud_files.duration was already captured at upload time, just never
    // surfaced here). Powers the fullscreen release view's per-track
    // duration + total runtime.
    let durationByCloudId = new Map();
    const cloudIdsForDuration = tracks.map(t => t.cloud_file_id).filter(Boolean);
    if (cloudIdsForDuration.length) {
      const { data: cloudRows } = await supabase.from('cloud_files')
        .select('id, duration').in('id', cloudIdsForDuration);
      durationByCloudId = new Map((cloudRows || []).map(c => [String(c.id), Number(c.duration)]));
    }
    // Batched like-state lookup for the signed-in visitor, same pattern as
    // GET /api/artists/:id/tracks — powers the like button on each row in
    // the fullscreen release view.
    const likeToken = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
    const likeSess = likeToken ? await dbGetSession(likeToken) : null;
    let likedTrackIds = new Set();
    if (likeSess && tracks.length) {
      const { data: likeRows } = await supabase.from('track_likes')
        .select('track_id').eq('username', likeSess.username).in('track_id', tracks.map(t => t.id));
      likedTrackIds = new Set((likeRows || []).map(l => l.track_id));
    }
    return res.json({
      tracks: tracks.map(t => ({
        id: t.id, originalUrl: t.original_url, platform: t.platform,
        title: t.title || t.original_url, playCount: t.play_count, position: t.position,
        likeCount: t.like_count || 0,
        likedByMe: likedTrackIds.has(t.id),
        coverUrl: t.cover_url || null,
        cloudFileId: t.cloud_file_id || null,
        artistId: t.artist_id || null,
        artistName: t.artist_name || null,
        isUpload: !!t.cloud_file_id,
        isExplicit: !!t.is_explicit,
        contentRating: t.content_rating || 'clean',
        contentRatingTags: t.content_rating_tags || [],
        collaborators: (collabsByTrack.get(t.id) || []).map(shapeCollaborator),
        hasVideo: videoTrackIds.has(t.id),
        durationSeconds: t.cloud_file_id && Number.isFinite(durationByCloudId.get(String(t.cloud_file_id)))
          ? durationByCloudId.get(String(t.cloud_file_id)) : null,
      })),
    });
  } catch (err) {
    console.error('[release tracks]', err);
    return res.status(500).json({ error: 'Could not load release tracks.' });
  }
});

// Artist's own activity (new releases, milestone follows, etc) PLUS recent
// community activity that references this artist (a track of theirs got
// liked, added to a playlist) — both already land in activity_feed with
// meta.artistId set, either via dbWriteArtistActivity (artist-originated)
// or via existing event types extended with artistId in their payload.
// Filtering activity_feed by meta->>artistId here, mirroring the same
// PostgREST or-clause shape dbGetFollowingFeed already uses for the
// artist-follow case.
app.get('/api/artists/:id/activity', requireFeatureAllowed('artist_pages', { allowAnonymous: true }), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (await isArtistBlockedForRequest(req, artist)) return res.json({ events: [], nextCursor: null });
    const limit  = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const before = req.query.before || null;

    let q = supabase.from('activity_feed').select('*')
      .eq('meta->>artistId', artist.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('created_at', before);
    const { data, error } = await q;
    if (error) { console.error('[artist activity]', error.message); return res.json({ events: [] }); }

    return res.json({
      events: (data || []).map(e => ({
        id: e.id, type: e.event_type, actor: e.actor.startsWith('artist:') ? null : e.actor,
        payload: e.meta, createdAt: e.created_at,
      })),
      nextCursor: (data || []).length === limit ? data[data.length - 1].created_at : null,
    });
  } catch (err) {
    console.error('[artist activity]', err);
    return res.status(500).json({ error: 'Could not load artist activity.' });
  }
});

app.post('/api/artists/:id/follow', artistFollowRateLimit, requireFeatureAllowed('following'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const sess = req._followSession;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id === sess.username) {
      return res.status(400).json({ error: "You can't follow your own artist page." });
    }
    await dbFollowArtist(sess.username, artist.id);
    dbWriteArtistActivity('artist_followed', artist.id, { follower: sess.username, artistName: artist.name });
    const updated = await dbGetArtistById(artist.id);
    return res.json({ following: true, followerCount: updated ? updated.follower_count : artist.follower_count + 1 });
  } catch (err) {
    console.error('[artist follow]', err);
    return res.status(500).json({ error: 'Could not follow artist.' });
  }
});

app.delete('/api/artists/:id/follow', artistFollowRateLimit, async (req, res) => {
  const sess = req._followSession;
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    await dbUnfollowArtist(sess.username, artist.id);
    const updated = await dbGetArtistById(artist.id);
    return res.json({ following: false, followerCount: updated ? updated.follower_count : Math.max(artist.follower_count - 1, 0) });
  } catch (err) {
    console.error('[artist unfollow]', err);
    return res.status(500).json({ error: 'Could not unfollow artist.' });
  }
});

// Creates a brand-new artist page for the signed-in account — this is the
// actual "Become an Artist" entry point. /api/artists/claim (below) only
// works if an unclaimed artist row ALREADY exists (e.g. auto-created by
// dbResolveArtist from a prior anonymous play of that name); a user with
// no plays under their name yet has nothing to claim, which is exactly
// the gap this route fills.
//
// If an unclaimed row already exists under the normalized name (their
// music got played before they signed up), this CLAIMS that row instead
// of creating a duplicate — same merge principle dbResolveArtist already
// uses for play-time dedup, just triggered from account creation instead.
// `merged: true` in the response lets the frontend say "we found your
// existing stats" rather than silently inheriting a stranger's-looking row.
app.post('/api/artists/create', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, name } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before creating an artist page.', emailVerificationRequired: true });

  const existing = await dbGetArtistByAccount(sess.username);
  if (existing) return res.status(409).json({ error: 'Your account has already claimed an artist page.' });

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '"name" is required.' });
  }
  const trimmedName = name.trim().slice(0, 100);
  if (isProtectedFreqNoticeIdentity(trimmedName)) return res.status(400).json({ error: 'That artist identity is reserved for official FREQ Notices.' });
  const normalized = normalizeArtistName(trimmedName);
  if (!normalized) return res.status(400).json({ error: 'Please enter a valid artist name.' });

  try {
    const { data: existingUnclaimed } = await supabase
      .from('artists').select('id, account_id').eq('normalized_name', normalized).maybeSingle();

    if (existingUnclaimed) {
      if (existingUnclaimed.account_id) {
        return res.status(409).json({ error: 'An artist with this name already exists and is already claimed.' });
      }
      const updated = await dbUpdateArtist(existingUnclaimed.id, {
        account_id: sess.username, claimed_at: new Date().toISOString(),
      });
      return res.status(200).json({
        id: updated.id, slug: updated.slug, name: updated.name, isClaimed: true, merged: true,
      });
    }
    const slug = await dbGenerateUniqueArtistSlug(trimmedName);
    const { data: created, error } = await supabase
      .from('artists')
      .insert({
        name: trimmedName, normalized_name: normalized, slug,
        account_id: sess.username, claimed_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) {
      // Lost a race to a concurrent create/claim of the same normalized
      // name — same shape as dbResolveArtist's own 23505 handling.
      if (error.code === '23505') return res.status(409).json({ error: 'That artist name was just taken. Please try a different name.' });
      throw new Error(error.message);
    }
    return res.status(201).json({
      id: created.id, slug: created.slug, name: created.name, isClaimed: true, merged: false,
    });
  } catch (err) {
    console.error('[artist create]', err);
    return res.status(500).json({ error: 'Could not create artist page.' });
  }
});


// Claims an existing unclaimed artist row for the signed-in account — the
// "verified artist applications" flow this enables later is just: an admin
// flips is_verified after a claim, not a separate table. One account can
// claim at most one artist (artists.account_id has a UNIQUE constraint),
// and an artist can only ever be claimed once (the WHERE account_id IS
// NULL check below, backed by the same partial-unique-index reasoning as
// get_or_create_artist's dedup).
app.post('/api/artists/claim', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, artistId } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before claiming an artist page.', emailVerificationRequired: true });
  if (!artistId || typeof artistId !== 'string') return res.status(400).json({ error: '"artistId" is required.' });
  try {
    const existing = await dbGetArtistByAccount(sess.username);
    if (existing) return res.status(409).json({ error: 'Your account has already claimed an artist page.' });

    const artist = await dbGetArtistById(artistId);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id) return res.status(409).json({ error: 'This artist page has already been claimed.' });

    const updated = await dbUpdateArtist(artist.id, { account_id: sess.username, claimed_at: new Date().toISOString() });
    return res.json({
      id: updated.id, name: updated.name, isClaimed: true, claimedAt: updated.claimed_at,
    });
  } catch (err) {
    console.error('[artist claim]', err);
    return res.status(500).json({ error: 'Could not claim this artist page.' });
  }
});

// Link keys an artist's Settings pane can set. Kept as a fixed allowlist
// rather than accepting arbitrary keys — links is rendered directly back
// out on the public artist page eventually, so this also bounds what ever
// needs escaping/handling there to a known, small set of platforms.
const ARTIST_LINK_KEYS = ['website', 'spotify', 'soundcloud', 'instagram', 'twitter', 'youtube'];

app.patch('/api/artists/:id', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, bio, avatarUrl, bannerUrl, genre, links } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can edit it.' });
    }
    const patch = {};
    if (bio !== undefined) {
      if (typeof bio !== 'string') return res.status(400).json({ error: '"bio" must be a string.' });
      const trimmed = bio.trim();
      if (trimmed.length > 2000) return res.status(400).json({ error: 'Bio must be 2000 characters or fewer.' });
      patch.bio = trimmed || null;
    }
    if (avatarUrl !== undefined) patch.avatar_url = (typeof avatarUrl === 'string' && avatarUrl.trim()) ? avatarUrl.trim().slice(0, 2000) : null;
    if (bannerUrl !== undefined) patch.banner_url = (typeof bannerUrl === 'string' && bannerUrl.trim()) ? bannerUrl.trim().slice(0, 2000) : null;
    if (genre !== undefined) {
      if (genre !== null && typeof genre !== 'string') return res.status(400).json({ error: '"genre" must be a string.' });
      patch.genre = (genre || '').toString().trim().slice(0, 60) || null;
    }
    if (links !== undefined) {
      if (typeof links !== 'object' || links === null || Array.isArray(links)) {
        return res.status(400).json({ error: '"links" must be an object.' });
      }
      const cleanLinks = {};
      for (const key of ARTIST_LINK_KEYS) {
        const val = links[key];
        if (typeof val === 'string' && val.trim()) cleanLinks[key] = val.trim().slice(0, 500);
      }
      patch.links = cleanLinks;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No valid fields to update.' });

    const updated = await dbUpdateArtist(artist.id, patch);
    return res.json({
      id: updated.id, bio: updated.bio, avatarUrl: updated.avatar_url, bannerUrl: updated.banner_url,
      genre: updated.genre, links: updated.links || {},
    });
  } catch (err) {
    console.error('[artist update]', err);
    return res.status(500).json({ error: 'Could not update artist page.' });
  }
});

// Artist avatar/banner upload — multipart, same uploadMediaImage() helper
// as the profile avatar/cover routes, namespaced under artist-avatars/ and
// artist-banners/ in the shared `media` bucket. Ownership check mirrors
// PATCH /api/artists/:id exactly: only the account that claimed this artist
// page can upload art for it.
app.post('/api/artists/:id/avatar', rateLimit, imageUpload.single('file'), requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const sess = await dbGetSession(req.body?.token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading artist art.', emailVerificationRequired: true });
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can upload art for it.' });
    }
    const avatarUrl = await uploadMediaImage(req.file, 'artist-avatars', artist.id);
    await dbUpdateArtist(artist.id, { avatar_url: avatarUrl });
    return res.json({ avatarUrl });
  } catch (err) {
    console.error('[artist avatar upload]', err);
    return res.status(500).json({ error: 'Could not upload artist avatar.' });
  }
});

app.post('/api/artists/:id/banner', rateLimit, imageUpload.single('file'), requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const sess = await dbGetSession(req.body?.token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can upload art for it.' });
    }
    const bannerUrl = await uploadMediaImage(req.file, 'artist-banners', artist.id);
    await dbUpdateArtist(artist.id, { banner_url: bannerUrl });
    return res.json({ bannerUrl });
  } catch (err) {
    console.error('[artist banner upload]', err);
    return res.status(500).json({ error: 'Could not upload artist banner.' });
  }
});

app.post('/api/artists/:id/releases', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, title, releaseType, coverUrl, releaseDate, trackIds, visibility } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before publishing.', emailVerificationRequired: true });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can publish releases.' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: '"title" is required.' });
    }
    if (!['single', 'album', 'ep', 'mixtape', 'compilation'].includes(releaseType)) {
      return res.status(400).json({ error: '"releaseType" must be one of single, album, ep, mixtape, compilation.' });
    }
    const release = await dbCreateRelease(artist.id, {
      title: title.trim().slice(0, 200), releaseType,
      coverUrl: coverUrl || null, releaseDate: releaseDate || null,
      visibility: visibility || 'public',
    });
    if (Array.isArray(trackIds) && trackIds.length) {
      for (const trackId of trackIds.slice(0, 100)) {
        try { await dbAddTrackToRelease(release.id, trackId); } catch (e) { console.error('[release add track]', e.message); }
      }
    }
    dbWriteArtistActivity('artist_release', artist.id, {
      releaseId: release.id, releaseTitle: release.title, releaseType: release.release_type, artistName: artist.name,
    });
    return res.status(201).json({
      id: release.id, title: release.title, releaseType: release.release_type,
      coverUrl: release.cover_url, releaseDate: release.release_date, trackCount: release.track_count,
      visibility: release.visibility || 'public',
    });
  } catch (err) {
    console.error('[artist create release]', err);
    return res.status(500).json({ error: 'Could not create release.' });
  }
});

// DELETE /api/artists/:id/releases/:releaseId  { token }  (owner only)
// Removes the release row only — its tracks aren't deleted, just unlinked
// from this release (see dbDeleteRelease comment). Same 401/403 ownership
// pattern as every other artist-mutation route in this file: missing/bad
// session is 401, a real session that isn't this artist's owner is 403.
app.delete('/api/artists/:id/releases/:releaseId', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can delete releases.' });
    }
    const { data: release } = await supabase
      .from('artist_releases').select('id').eq('id', req.params.releaseId).eq('artist_id', artist.id).maybeSingle();
    if (!release) return res.status(404).json({ error: 'Release not found.' });

    await dbDeleteRelease(release.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('[artist delete release]', err);
    return res.status(500).json({ error: 'Could not delete release.' });
  }
});

// PATCH /api/artists/:id/releases/:releaseId  { token, title?, coverUrl?, releaseDate?, description?, visibility? }
// Edit release metadata. release_type is immutable after creation by design.
app.patch('/api/artists/:id/releases/:releaseId', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, title, coverUrl, releaseDate, description, visibility } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can edit releases.' });
    }
    const { data: release } = await supabase
      .from('artist_releases').select('id').eq('id', req.params.releaseId).eq('artist_id', artist.id).maybeSingle();
    if (!release) return res.status(404).json({ error: 'Release not found.' });

    const patch = {};
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: '"title" must be a non-empty string.' });
      patch.title = title.trim().slice(0, 200);
    }
    if (coverUrl !== undefined) {
      patch.cover_url = (typeof coverUrl === 'string' && coverUrl.trim()) ? coverUrl.trim().slice(0, 2000) : null;
    }
    if (releaseDate !== undefined) {
      patch.release_date = releaseDate || null;
    }
    if (description !== undefined) {
      patch.description = (typeof description === 'string') ? description.trim().slice(0, 2000) || null : null;
    }
    if (visibility !== undefined) {
      patch.visibility = ['public', 'private', 'unlisted'].includes(visibility) ? visibility : 'public';
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No valid fields to update.' });
    const updated = await dbUpdateRelease(release.id, patch);
    return res.json({
      id: updated.id, title: updated.title, releaseType: updated.release_type,
      coverUrl: updated.cover_url, releaseDate: updated.release_date,
      description: updated.description, trackCount: updated.track_count,
      visibility: updated.visibility || 'public',
    });
  } catch (err) {
    console.error('[artist update release]', err);
    return res.status(500).json({ error: 'Could not update release.' });
  }
});

// DELETE /api/artists/:id/releases/:releaseId/tracks/:trackId  { token }
// Remove a single track from a release (unlinks it, does not delete the track).
app.delete('/api/artists/:id/releases/:releaseId/tracks/:trackId', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can manage releases.' });
    }
    const { data: release } = await supabase
      .from('artist_releases').select('id').eq('id', req.params.releaseId).eq('artist_id', artist.id).maybeSingle();
    if (!release) return res.status(404).json({ error: 'Release not found.' });
    await dbRemoveTrackFromRelease(release.id, req.params.trackId);
    return res.json({ success: true });
  } catch (err) {
    console.error('[release remove track]', err);
    return res.status(500).json({ error: 'Could not remove track from release.' });
  }
});

// POST /api/artists/:id/releases/:releaseId/tracks  { token, trackId }
// Add an existing published track to a release (e.g. after editing release assignment).
app.post('/api/artists/:id/releases/:releaseId/tracks', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, trackId } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!trackId) return res.status(400).json({ error: '"trackId" is required.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can manage releases.' });
    }
    const { data: release } = await supabase
      .from('artist_releases').select('id').eq('id', req.params.releaseId).eq('artist_id', artist.id).maybeSingle();
    if (!release) return res.status(404).json({ error: 'Release not found.' });
    const track = await dbGetTrackById(trackId);
    if (!track || track.artist_id !== artist.id) return res.status(404).json({ error: 'Track not found or does not belong to this artist.' });
    await dbAddTrackToRelease(release.id, track.id);
    return res.json({ success: true });
  } catch (err) {
    if (err.message?.includes('duplicate')) return res.status(409).json({ error: 'Track is already in this release.' });
    console.error('[release add track]', err);
    return res.status(500).json({ error: 'Could not add track to release.' });
  }
});
// Same ownership shape as DELETE /releases/:releaseId just above: resolve
// the artist from the URL, confirm they're the session's account, then
// confirm the release actually belongs to that artist before touching it.
// Listing is public (GET has no auth requirement) — release collaborator
// credits are meant to be visible on the public release/artist page.
app.get('/api/artists/:id/releases/:releaseId/collaborators', rateLimit, requireFeatureAllowed('artist_pages', { allowAnonymous: true }), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    const { data: release } = await supabase
      .from('artist_releases').select('id').eq('id', req.params.releaseId).eq('artist_id', artist.id).maybeSingle();
    if (!release) return res.status(404).json({ error: 'Release not found.' });
    const collaborators = (await dbGetReleaseCollaborators(release.id)).map(shapeCollaborator);
    return res.json({ collaborators });
  } catch (err) {
    console.error('[release collaborators list]', err);
    return res.status(500).json({ error: 'Could not load collaborators.' });
  }
});

app.post('/api/artists/:id/releases/:releaseId/collaborators', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, artistId, role } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (typeof artistId !== 'string' || !artistId.trim()) return res.status(400).json({ error: '"artistId" is required.' });
  if (!COLLAB_ROLES.includes(role)) return res.status(400).json({ error: `"role" must be one of: ${COLLAB_ROLES.join(', ')}.` });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can manage release collaborators.' });
    }
    const { data: release } = await supabase
      .from('artist_releases').select('id, artist_id').eq('id', req.params.releaseId).eq('artist_id', artist.id).maybeSingle();
    if (!release) return res.status(404).json({ error: 'Release not found.' });
    if (artistId === release.artist_id) {
      return res.status(400).json({ error: 'This artist is already the primary artist on this release.' });
    }
    const collaboratorArtist = await dbGetArtistById(artistId);
    if (!collaboratorArtist) return res.status(404).json({ error: 'Collaborator artist not found.' });
    const row = await dbAddCollaborator({
      releaseId: release.id, collaboratorArtistId: artistId, role, addedByUsername: sess.username,
    });
    return res.json({ collaborator: shapeCollaborator(row) });
  } catch (err) {
    console.error('[release collaborator add]', err);
    return res.status(err.message?.includes('already has this role') ? 409 : 500)
      .json({ error: err.message || 'Could not add collaborator.' });
  }
});

app.delete('/api/artists/:id/releases/:releaseId/collaborators/:collabId', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can manage release collaborators.' });
    }
    const { data: release } = await supabase
      .from('artist_releases').select('id').eq('id', req.params.releaseId).eq('artist_id', artist.id).maybeSingle();
    if (!release) return res.status(404).json({ error: 'Release not found.' });
    const collab = await dbGetCollaboration(req.params.collabId);
    if (!collab || collab.release_id !== release.id) return res.status(404).json({ error: 'Collaborator credit not found.' });
    await dbRemoveCollaboration(collab.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('[release collaborator remove]', err);
    return res.status(500).json({ error: 'Could not remove collaborator.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLISHING — turning a private cloud_files upload into a public track
//
//  GET    /api/artists/:id/publishable          ?token=   → owner's unpublished uploads
//  POST   /api/artists/:id/publish               { token, cloudFileId, title, coverUrl, releaseId }
//  PATCH  /api/tracks/:trackId                   { token, title, coverUrl }
//  DELETE /api/tracks/:trackId                   { token }
//
//  Publishing does NOT create a second track system — it creates exactly
//  one new `tracks` row per cloud_files row, linked via tracks.cloud_file_id
//  (see add_publishing_to_tracks migration). Every existing consumer of
//  `tracks` — charts, artist tracks, releases, plays — works on a published
//  upload with zero changes, since it's the same table `tracks` always was
//  for YouTube-resolved tracks (the only kind FREQ had until now). A
//  partial unique index on cloud_file_id (see migration) guarantees at
//  most one published track per cloud_files row, so re-publishing the same
//  file is rejected, not silently duplicated.
// ═══════════════════════════════════════════════════════════════════════════════

// Cloud files this artist owns that haven't been published yet — i.e. not
// already linked to a tracks row. LEFT JOIN-via-NOT-IN rather than a
// second round trip per file; cloud_files belonging to this account that
// have no matching tracks.cloud_file_id are exactly the publishable set.
async function dbGetPublishableCloudFiles(username) {
  const { data: files, error } = await supabase
    .from('cloud_files')
    .select('id, filename, title, artist, duration, mime_type, size, uploaded_at, folder')
    .eq('owner', username)
    .order('uploaded_at', { ascending: false });
  if (error) { console.error('[db] getPublishableCloudFiles:', error.message); return []; }
  if (!files || !files.length) return [];

  const { data: published, error: pubErr } = await supabase
    .from('tracks')
    .select('cloud_file_id')
    .not('cloud_file_id', 'is', null)
    .in('cloud_file_id', files.map(f => f.id));
  if (pubErr) { console.error('[db] getPublishableCloudFiles (published lookup):', pubErr.message); return []; }
  const publishedIds = new Set((published || []).map(p => p.cloud_file_id));
  const unpublished = files.filter(f => !publishedIds.has(f.id));
  const rightsByFile = await dbGetRightsReviewMap(unpublished.map(file => file.id), username);
  return unpublished.map(file => ({ ...file, rights_review: rightsByFile.get(String(file.id)) || null }));
}

// Publishes one cloud_files row as a tracks row. originalUrl is a synthetic
// `cloud:<cloud_file_id>` value — tracks.original_url is NOT NULL + UNIQUE
// and was designed around real external URLs (YouTube etc), so a published
// upload needs *some* unique value there; cloud_file_id already guarantees
// uniqueness, so reusing it as the URL avoids inventing a second identity
// scheme. platform is the literal string 'cloud' so the frontend/queue can
// tell a published upload apart from a YouTube-resolved track without
// needing to check cloud_file_id specifically.
// contentRating is REQUIRED (Part 1 — "artists cannot publish without
// selecting one"), validated by the caller (POST /api/artists/:id/publish)
// before this ever runs. is_explicit is kept in sync as a derived legacy
// flag (true for parental_guidance/adult) purely so the existing "E" badge
// call sites scattered through the frontend keep working unmodified —
// content_rating is the real source of truth going forward, per the column
// comment on tracks.content_rating.
async function dbPublishTrack({ cloudFile, artist, title, coverUrl, contentRating, contentRatingTags = [] }) {
  if (!isValidContentRating(contentRating)) {
    throw Object.assign(new Error('A content rating (clean, parental_guidance, or adult) is required to publish.'), { code: 'RATING_REQUIRED' });
  }
  const finalTitle = (title && title.trim()) ? title.trim().slice(0, 255) : (cloudFile.title || cloudFile.filename);
  const safeTags = sanitizeContentRatingTags(contentRatingTags);
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('tracks')
    .insert({
      original_url: `cloud:${cloudFile.id}`,
      platform: 'cloud',
      title: finalTitle,
      artist_id: artist.id,
      artist_name: artist.name,
      cloud_file_id: cloudFile.id,
      cover_url: coverUrl || null,
      is_published: true,
      is_explicit: contentRating !== 'clean',
      content_rating: contentRating,
      content_rating_tags: safeTags,
      content_rating_set_at: nowIso,
      published_at: nowIso,
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw Object.assign(new Error('This file has already been published.'), { code: 'ALREADY_PUBLISHED' });
    if (error.code === '23514') throw Object.assign(new Error('This upload no longer has an approved rights review.'), { code: 'RIGHTS_NOT_APPROVED' });
    throw new Error(error.message);
  }
  await supabase.from('content_rating_history').insert({
    track_id: data.id, actor: artist.account_id, action: 'set_by_artist',
    previous_rating: null, new_rating: contentRating, reason: null,
  });
  return data;
}

async function dbGetTrackById(trackId) {
  const { data, error } = await supabase.from('tracks').select('*').eq('id', trackId).maybeSingle();
  if (error) { console.error('[db] getTrackById:', error.message); return null; }
  return data;
}

async function dbUpdatePublishedTrack(trackId, patch) {
  const { data, error } = await supabase.from('tracks').update(patch).eq('id', trackId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbUnpublishTrack(trackId) {
  // Hard-delete, not a soft "is_published = false" flip — an unpublished
  // upload's tracks row has no further purpose (it's not playable from
  // anywhere once removed from charts/discovery/releases), and leaving a
  // dead row around would just be a second place the same cloud_files
  // upload could accidentally get "republished" against. artist_release_tracks
  // rows referencing this track cascade-delete via their FK, so the release
  // it belonged to has its track removed cleanly, not left dangling.
  //
  // After delete we immediately kick recomputeArtistStats so the dashboard
  // play counts and release totals don't show stale numbers until the next
  // 10-minute timer fires.
  const { error } = await supabase.from('tracks').delete().eq('id', trackId);
  if (error) throw new Error(error.message);
  // Fire-and-forget recompute — don't await, deletion already succeeded
  recomputeArtistStats().catch(err => console.error('[unpublish] recompute failed:', err));
}

app.get('/api/artists/:id/publishable', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can view publishable files.' });
    }
    const files = await dbGetPublishableCloudFiles(sess.username);
    return res.json({
      files: files.map(f => ({
        id: f.id, filename: f.filename, title: f.title, artist: f.artist,
        duration: f.duration, mimeType: f.mime_type, size: f.size,
        uploadedAt: f.uploaded_at, folder: f.folder,
        rights: shapeRightsReview(f.rights_review) || {
          status: 'scan_required',
          message: 'This older upload needs a rights scan before it can be published.',
        },
      })),
    });
  } catch (err) {
    console.error('[artist publishable]', err);
    return res.status(500).json({ error: 'Could not load publishable files.' });
  }
});

// Cover-art upload for a single published track (not part of a release) —
// same uploadMediaImage() helper as every other image route, namespaced
// under track-covers/ in the shared media bucket. Takes a cloudFileId, not
// a trackId, because this is meant to be called *before* publish (pick the
// cover while setting up metadata) as well as after — the frontend can
// always re-PATCH a track's coverUrl later via PATCH /api/tracks/:trackId
// using the URL this returns.
app.post('/api/artists/:id/track-cover', rateLimit, imageUpload.single('file'), requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const sess = await dbGetSession(req.body?.token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before uploading.', emailVerificationRequired: true });
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  const cloudFileId = Number(req.body?.cloudFileId);
  if (!cloudFileId) return res.status(400).json({ error: '"cloudFileId" is required.' });
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can upload cover art.' });
    }
    const owned = await dbGetCloudFile(cloudFileId, sess.username);
    if (!owned) return res.status(404).json({ error: 'File not found in your library.' });
    const coverUrl = await uploadMediaImage(req.file, 'track-covers', cloudFileId);
    return res.json({ coverUrl });
  } catch (err) {
    console.error('[track cover upload]', err);
    return res.status(500).json({ error: 'Could not upload cover art.' });
  }
});

app.post('/api/artists/:id/publish', rateLimit, requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, cloudFileId, title, coverUrl, releaseId, contentRating, contentRatingTags } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your email address before publishing.', emailVerificationRequired: true });
  if (!cloudFileId) return res.status(400).json({ error: '"cloudFileId" is required.' });
  // Part 1: "Artists cannot publish without selecting one." Validated here
  // (in addition to dbPublishTrack's own check) so a bad request 400s before
  // any file lookups happen, rather than after.
  if (!isValidContentRating(contentRating)) {
    return res.status(400).json({ error: 'A content rating is required: choose Clean, Parental Guidance, or 18+ before publishing.' });
  }
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    if (artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can publish releases.' });
    }
    const cloudFile = await dbGetCloudFile(Number(cloudFileId), sess.username);
    if (!cloudFile) return res.status(404).json({ error: 'File not found in your library.' });
    const rightsReview = await dbGetRightsReviewForOwner(cloudFile.id, sess.username);
    if (!rightsReview) {
      return res.status(409).json({
        error: 'Run the copyright and rights scan before publishing this older upload.',
        code: 'RIGHTS_SCAN_REQUIRED',
        rightsStatus: 'scan_required',
      });
    }
    if (rightsReview.status !== 'approved') {
      return res.status(409).json({
        error: rightsReview.user_message || 'This upload is not cleared for publishing yet.',
        code: 'RIGHTS_REVIEW_NOT_APPROVED',
        rightsStatus: rightsReview.status,
        reviewId: rightsReview.id,
      });
    }

    let release = null;
    if (releaseId) {
      const { data } = await supabase.from('artist_releases').select('*').eq('id', releaseId).eq('artist_id', artist.id).maybeSingle();
      if (!data) return res.status(404).json({ error: 'Release not found.' });
      release = data;
    }

    const track = await dbPublishTrack({
      cloudFile, artist, title,
      coverUrl: coverUrl || release?.cover_url || null,
      contentRating, contentRatingTags,
    });

    if (release) {
      await dbAddTrackToRelease(release.id, track.id);
    }

    // Surfaces in Activity Feed (and, via dbGetFollowingFeed's artistId
    // clause, to anyone following this artist) and is the same event the
    // Discovery/Charts/Search "appears automatically" requirement leans
    // on — nothing else needs to separately notify those surfaces, since
    // they all read off either this feed entry or the tracks row directly.
    dbWriteArtistActivity('track_published', artist.id, {
      trackId: track.id, trackTitle: track.title, artistName: artist.name,
      releaseId: release ? release.id : null, releaseTitle: release ? release.title : null,
    });

    return res.status(201).json({
      id: track.id, title: track.title, coverUrl: track.cover_url,
      publishedAt: track.published_at, releaseId: release ? release.id : null,
      contentRating: track.content_rating, contentRatingTags: track.content_rating_tags || [],
    });
  } catch (err) {
    if (err.code === 'ALREADY_PUBLISHED') return res.status(409).json({ error: err.message });
    if (err.code === 'RIGHTS_NOT_APPROVED') return res.status(409).json({ error: err.message, rightsStatus: 'review_required' });
    if (err.code === 'RATING_REQUIRED') return res.status(400).json({ error: err.message });
    console.error('[artist publish]', err);
    return res.status(500).json({ error: 'Could not publish track.' });
  }
});

app.patch('/api/tracks/:trackId', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, title, coverUrl, description, releaseId, contentRating, contentRatingTags } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track || !track.cloud_file_id) return res.status(404).json({ error: 'Published track not found.' });
    const artist = await dbGetArtistById(track.artist_id);
    if (!artist || artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who published this track can edit it.' });
    }
    const patch = {};
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: '"title" must be a non-empty string.' });
      patch.title = title.trim().slice(0, 255);
    }
    if (coverUrl !== undefined) {
      patch.cover_url = (typeof coverUrl === 'string' && coverUrl.trim()) ? coverUrl.trim().slice(0, 2000) : null;
    }
    if (description !== undefined) {
      patch.description = (typeof description === 'string') ? description.trim().slice(0, 2000) || null : null;
    }

    // Content rating change (Part 1/10) — an artist can revise the rating
    // on an already-published track, UNLESS an admin has locked it (Part 15:
    // "Lock ratings"), in which case only the admin override endpoint can
    // change it. Every change is logged to content_rating_history for the
    // admin "view rating history" surface.
    let ratingChanged = false;
    if (contentRating !== undefined) {
      if (track.content_rating_locked) {
        return res.status(403).json({ error: 'This track\'s rating has been locked by a moderator and can no longer be changed by the artist.' });
      }
      if (!isValidContentRating(contentRating)) {
        return res.status(400).json({ error: '"contentRating" must be one of: clean, parental_guidance, adult.' });
      }
      if (contentRating !== track.content_rating) {
        patch.content_rating = contentRating;
        patch.is_explicit = contentRating !== 'clean';
        patch.content_rating_set_at = new Date().toISOString();
        ratingChanged = true;
      }
    }
    if (contentRatingTags !== undefined) {
      patch.content_rating_tags = sanitizeContentRatingTags(contentRatingTags);
    }

    // Release reassignment: remove from old release(s), add to new one if provided.
    // releaseId === null explicitly unlinks from all releases; omitting releaseId
    // entirely leaves release assignments untouched (standard PATCH semantics).
    if (releaseId !== undefined) {
      // Remove from any existing release(s) first
      const { data: existingLinks } = await supabase
        .from('artist_release_tracks')
        .select('release_id')
        .eq('track_id', track.id);
      for (const link of existingLinks || []) {
        await dbRemoveTrackFromRelease(link.release_id, track.id).catch(() => {});
      }
      // Attach to new release if a non-null releaseId was provided
      if (releaseId) {
        const { data: newRelease } = await supabase
          .from('artist_releases').select('id').eq('id', releaseId).eq('artist_id', artist.id).maybeSingle();
        if (!newRelease) return res.status(404).json({ error: 'Target release not found or does not belong to this artist.' });
        await dbAddTrackToRelease(newRelease.id, track.id);
      }
    }

    if (!Object.keys(patch).length && releaseId === undefined) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }
    let updated = track;
    if (Object.keys(patch).length) {
      updated = await dbUpdatePublishedTrack(track.id, patch);
    }

    if (ratingChanged) {
      await supabase.from('content_rating_history').insert({
        track_id: track.id, actor: sess.username, action: 'changed_by_artist',
        previous_rating: track.content_rating, new_rating: contentRating, reason: null,
      });
      // If this track belongs to a release (and wasn't just reassigned above,
      // which already recomputes on its own), the album's derived rating may
      // now be stale — refresh every release this track currently belongs to.
      const { data: links } = await supabase
        .from('artist_release_tracks').select('release_id').eq('track_id', track.id);
      for (const link of links || []) {
        await recomputeReleaseContentRating(link.release_id);
      }
    }

    return res.json({
      id: updated.id, title: updated.title, coverUrl: updated.cover_url,
      description: updated.description || null,
      contentRating: updated.content_rating, contentRatingTags: updated.content_rating_tags || [],
      contentRatingLocked: !!updated.content_rating_locked,
    });
  } catch (err) {
    console.error('[track update]', err);
    return res.status(500).json({ error: 'Could not update track.' });
  }
});

app.delete('/api/tracks/:trackId', rateLimit, async (req, res) => {
  const token = req.body?.token || req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track || !track.cloud_file_id) return res.status(404).json({ error: 'Published track not found.' });
    const artist = await dbGetArtistById(track.artist_id);
    if (!artist || artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who published this track can remove it.' });
    }
    await dbUnpublishTrack(track.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('[track delete]', err);
    return res.status(500).json({ error: 'Could not remove track.' });
  }
});

// ── Track collaborators ─────────────────────────────────────────────────────
// Management (add/remove) is gated to the track's primary artist — the same
// "only the artist who published this track" check as PATCH/DELETE above —
// since crediting someone as a Featured Artist/Collaborator/Producer/
// Contributor on a track is an edit to that track, not something the
// credited artist grants themselves. Listing is public, same as the track
// itself being publicly streamable once published.
app.get('/api/tracks/:trackId/collaborators', rateLimit, async (req, res) => {
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!await isTrackVisibleForRequest(req, track)) return res.status(404).json({ error: 'Track not found.' });
    const collaborators = (await dbGetTrackCollaborators(track.id)).map(shapeCollaborator);
    return res.json({ collaborators });
  } catch (err) {
    console.error('[track collaborators list]', err);
    return res.status(500).json({ error: 'Could not load collaborators.' });
  }
});

app.post('/api/tracks/:trackId/collaborators', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { token, artistId, role } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (typeof artistId !== 'string' || !artistId.trim()) return res.status(400).json({ error: '"artistId" is required.' });
  if (!COLLAB_ROLES.includes(role)) return res.status(400).json({ error: `"role" must be one of: ${COLLAB_ROLES.join(', ')}.` });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track || !track.cloud_file_id) return res.status(404).json({ error: 'Published track not found.' });
    const artist = await dbGetArtistById(track.artist_id);
    if (!artist || artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who published this track can manage its collaborators.' });
    }
    if (artistId === track.artist_id) {
      return res.status(400).json({ error: 'This artist is already the primary artist on this track.' });
    }
    const collaboratorArtist = await dbGetArtistById(artistId);
    if (!collaboratorArtist) return res.status(404).json({ error: 'Collaborator artist not found.' });
    const row = await dbAddCollaborator({
      trackId: track.id, collaboratorArtistId: artistId, role, addedByUsername: sess.username,
    });
    return res.json({ collaborator: shapeCollaborator(row) });
  } catch (err) {
    console.error('[track collaborator add]', err);
    return res.status(err.message?.includes('already has this role') ? 409 : 500)
      .json({ error: err.message || 'Could not add collaborator.' });
  }
});

app.delete('/api/tracks/:trackId/collaborators/:collabId', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track) return res.status(404).json({ error: 'Track not found.' });
    const artist = await dbGetArtistById(track.artist_id);
    if (!artist || artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who published this track can manage its collaborators.' });
    }
    const collab = await dbGetCollaboration(req.params.collabId);
    if (!collab || collab.track_id !== track.id) return res.status(404).json({ error: 'Collaborator credit not found.' });
    await dbRemoveCollaboration(collab.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('[track collaborator remove]', err);
    return res.status(500).json({ error: 'Could not remove collaborator.' });
  }
});

// GET /api/tracks/:trackId/lyrics  — public for published tracks
app.get('/api/tracks/:trackId/lyrics', async (req, res) => {
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!await isTrackVisibleForRequest(req, track)) return res.status(404).json({ error: 'Track not found.' });
    const row = await dbGetTrackLyrics(track.id);
    return res.json({
      trackId: track.id,
      lyrics: row?.lyrics ?? null,
      synced: row?.synced ?? false,
      updatedAt: row?.updated_at ?? null,
    });
  } catch (err) {
    console.error('[track lyrics GET]', err);
    return res.status(500).json({ error: 'Could not load lyrics.' });
  }
});

// PUT /api/tracks/:trackId/lyrics  — owner only
app.put('/api/tracks/:trackId/lyrics', rateLimit, async (req, res) => {
  const { token, lyrics } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track) return res.status(404).json({ error: 'Track not found.' });
    const artist = await dbGetArtistById(track.artist_id);
    if (!artist || artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the track owner can edit lyrics.' });
    }
    if (typeof lyrics !== 'string') return res.status(400).json({ error: 'lyrics must be a string.' });
    const row = await dbUpsertTrackLyrics(track.id, lyrics.slice(0, 20000));
    return res.json({ trackId: track.id, lyrics: row.lyrics, updatedAt: row.updated_at });
  } catch (err) {
    console.error('[track lyrics PUT]', err);
    return res.status(500).json({ error: 'Could not save lyrics.' });
  }
});

// DELETE /api/tracks/:trackId/lyrics  — owner only
app.delete('/api/tracks/:trackId/lyrics', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track) return res.status(404).json({ error: 'Track not found.' });
    const artist = await dbGetArtistById(track.artist_id);
    if (!artist || artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the track owner can delete lyrics.' });
    }
    await dbDeleteTrackLyrics(track.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('[track lyrics DELETE]', err);
    return res.status(500).json({ error: 'Could not delete lyrics.' });
  }
});

// GET /api/tracks/:trackId/stream  ?token=  (token optional — anyone can
// stream a published track, same "browsable by a visitor who hasn't signed
// in" philosophy as the artist routes above).
//
// Deliberately NOT the same code path as GET /api/cloud-files/:id — that
// route scopes its signed-url lookup to `.eq('owner', sess.username)`,
// correct for "manage my private uploads" but would 404 for every visitor
// trying to stream someone else's published music. The authorization
// boundary here is different on purpose: not "do you own this file" but
// "is this track actually published" — is_published=true is the only gate.
// An unpublished/draft upload can never reach this route's happy path even
// if someone guesses its trackId, because dbGetTrackById's row won't have
// is_published=true until the artist explicitly publishes it.
app.get('/api/tracks/:trackId/stream', rateLimit, async (req, res) => {
  try {
    const track = await dbGetTrackById(req.params.trackId);
    if (!track || !track.is_published || !track.cloud_file_id) {
      return res.status(404).json({ error: 'Track not found.' });
    }

    // Final playback boundary. Catalog surfaces hide restricted tracks for
    // normal browsing, but a copied id or stale playlist can still hit this
    // endpoint directly. Reject it before querying cloud_files or signing any
    // Storage URL so blocked audio is never disclosed to the client.
    const allowedRatings = await getAllowedRatingsForRequest(req);
    if (!allowedRatings.includes(track.content_rating || 'clean')) {
      return res.status(403).json({
        error: 'This track is restricted by your account settings.',
        contentRestricted: true,
      });
    }
    // Part 6: specific artist/genre/track blocks, on top of the rating
    // ceiling above — a track can pass the rating check and still be
    // blocked by name/artist/genre for a given child.
    if (await isTrackBlockedForRequest(req, track)) {
      return res.status(403).json({
        error: 'This track is restricted by your account settings.',
        contentRestricted: true,
      });
    }
    const listeningAllowance = await getListeningAllowanceForRequest(req, { reserveSeconds: 60 });
    if (!listeningAllowance.allowed) {
      return res.status(403).json({
        error: listeningAllowance.message || 'Listening is unavailable right now.',
        listeningRestricted: true,
        reason: listeningAllowance.reason || null,
      });
    }
    // Bypasses dbGetCloudFile's owner-scoped lookup on purpose — see comment
    // above. Goes straight to the table since the publish/ownership check
    // already happened once, permanently, at publish time.
    const { data: cloudFile, error: cfErr } = await supabase
      .from('cloud_files').select('storage_path, filename, mime_type, duration')
      .eq('id', track.cloud_file_id).maybeSingle();
    if (cfErr || !cloudFile) return res.status(404).json({ error: 'Track audio not found.' });

    const streamTtlSeconds = listeningAllowance.restrictions
      ? Math.min(SIGNED_URL_TTL_SECONDS, listeningAllowance.streamLeaseSeconds || 60)
      : SIGNED_URL_TTL_SECONDS;
    const { data, error } = await supabase.storage
      .from(CLOUD_BUCKET)
      .createSignedUrl(cloudFile.storage_path, streamTtlSeconds);
    if (error) throw new Error(error.message);

    const collaborators = (await dbGetTrackCollaborators(track.id)).map(shapeCollaborator);

    // Motion Canvas rides along with the audio stream response rather than
    // a separate endpoint — see the Motion Canvas system comment block —
    // since the frontend always calls this route on track load and the two
    // always play together. Signed the same way as the audio itself, same
    // TTL, so both links expire/refresh in lockstep with no separate
    // freshness bookkeeping needed client-side.
    let motionCanvasUrl = null, motionCanvasMimeType = null;
    const canvasRow = await dbGetTrackMotionCanvas(track.id);
    const canvasFile = canvasRow?.motion_canvas_files;
    if (canvasFile && canvasFile.upload_status === 'ready') {
      const { data: canvasSigned, error: canvasErr } = await supabase.storage
        .from(MOTION_CANVAS_BUCKET)
        .createSignedUrl(canvasFile.storage_path, streamTtlSeconds);
      if (!canvasErr && canvasSigned) {
        motionCanvasUrl = canvasSigned.signedUrl;
        motionCanvasMimeType = canvasFile.mime_type;
      }
    }

    return res.json({
      id: track.id, title: track.title, coverUrl: track.cover_url,
      artistId: track.artist_id, artistName: track.artist_name,
      mimeType: cloudFile.mime_type, duration: cloudFile.duration,
      url: data.signedUrl, expiresIn: streamTtlSeconds,
      collaborators, motionCanvasUrl, motionCanvasMimeType,
    });
  } catch (err) {
    console.error('[track stream]', err);
    return res.status(500).json({ error: 'Could not load track audio.' });
  }
});

// POST/DELETE /api/tracks/:trackId/like   { token }
// Mirrors /api/posts/:id/like exactly — upsert/delete on a join table, then
// recompute and persist the denormalized count. No per-track like existed
// anywhere in this schema before; track_likes + tracks.like_count were added
// specifically to back the Artist Dashboard Analytics view's Likes stat with
// a real number instead of the previous hardcoded `likeCount: 0` placeholder.
app.post('/api/tracks/:trackId/like', rateLimit, async (req, res) => {
  const { token } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const track = await dbGetTrackById(req.params.trackId);
    const allowedRatings = await getAllowedRatingsForRequest(req);
    if (!track?.is_published || !allowedRatings.includes(track.content_rating || 'clean')) {
      return res.status(403).json({ error: 'This track is restricted by your account settings.', contentRestricted: true });
    }
    if (await isTrackBlockedForRequest(req, track)) {
      return res.status(403).json({ error: 'This track is restricted by your account settings.', contentRestricted: true });
    }
    const { error } = await supabase.from('track_likes')
      .upsert({ track_id: req.params.trackId, username: sess.username }, { onConflict: 'track_id,username' });
    if (error && error.code !== '23505') throw new Error(error.message);
    const { count } = await supabase.from('track_likes')
      .select('*', { count: 'exact', head: true }).eq('track_id', req.params.trackId);
    await supabase.from('tracks').update({ like_count: count || 0 }).eq('id', req.params.trackId);
    return res.json({ liked: true, likeCount: count || 0 });
  } catch (err) {
    console.error('[track like]', err);
    return res.status(500).json({ error: 'Could not like track.' });
  }
});

// GET /api/tracks/liked?token=...&limit=50
// Returns the signed-in user's own liked tracks, newest-liked first. This is
// the one read this schema was missing — track_likes could only be checked
// per-track (likedByMe) or counted (like_count), never listed back out for
// the user who did the liking. Added specifically so DJ BOOM's "play my
// liked songs" has a real list to hand the queue instead of a guess; the
// frontend "Liked Songs" surface can reuse this same endpoint later.
app.get('/api/tracks/liked', rateLimit, async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  try {
    const { data: likeRows, error: likeErr } = await supabase.from('track_likes')
      .select('track_id, created_at').eq('username', sess.username)
      .order('created_at', { ascending: false }).limit(limit);
    if (likeErr) throw new Error(likeErr.message);
    if (!likeRows?.length) return res.json({ tracks: [] });

    const ids = likeRows.map(l => l.track_id);
    const allowedRatings = await getAllowedRatingsForRequest(req);
    const { data: tracks, error: trackErr } = await supabase.from('tracks')
      .select('id, title, artist_id, artist_name, is_explicit, content_rating, cover_url')
      .in('id', ids).eq('is_published', true).in('content_rating', allowedRatings);
    if (trackErr) throw new Error(trackErr.message);

    // Preserve like-order (most recently liked first), not the arbitrary
    // order .in() happens to return.
    const visibleTracks = await filterBlockedTracksForRequest(req, tracks || []);
    const byId = new Map(visibleTracks.map(t => [t.id, t]));
    const ordered = likeRows.map(l => byId.get(l.track_id)).filter(Boolean);

    return res.json({
      tracks: ordered.map(t => ({
        id: t.id, title: t.title, artistId: t.artist_id, artistName: t.artist_name,
        isExplicit: !!t.is_explicit, contentRating: t.content_rating || 'clean', coverUrl: t.cover_url,
      })),
    });
  } catch (err) {
    console.error('[tracks liked]', err);
    return res.status(500).json({ error: 'Could not load liked tracks.' });
  }
});

app.delete('/api/tracks/:trackId/like', rateLimit, async (req, res) => {
  const { token } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    await supabase.from('track_likes').delete().eq('track_id', req.params.trackId).eq('username', sess.username);
    const { count } = await supabase.from('track_likes')
      .select('*', { count: 'exact', head: true }).eq('track_id', req.params.trackId);
    await supabase.from('tracks').update({ like_count: count || 0 }).eq('id', req.params.trackId);
    return res.json({ liked: false, likeCount: count || 0 });
  } catch (err) {
    console.error('[track unlike]', err);
    return res.status(500).json({ error: 'Could not unlike track.' });
  }
});

// GET /api/artists/:id/tracks/:trackId/analytics   ?token=
// Owner-only. Aggregates everything the Artist Dashboard's Analytics button
// needs in one call: play stats already on the tracks row, real like count,
// release association, publish date, and a small recent-activity slice from
// track_plays. Comments are intentionally NOT included — there is no
// comments-on-tracks feature anywhere in this schema (only posts have
// comments), so the analytics endpoint reports commentCount as null with a
// supported:false flag rather than fabricating a 0 that looks real but never
// updates. Surface that honestly in the UI instead of pretending it's wired up.
app.get('/api/artists/:id/tracks/:trackId/analytics', requireFeatureAllowed('artist_pages'), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
    const sess = token ? await dbGetSession(token) : null;
    if (!sess || artist.account_id !== sess.username) {
      return res.status(403).json({ error: 'Only the artist who claimed this page can view track analytics.' });
    }

    const { data: track, error: trackErr } = await supabase
      .from('tracks')
      .select('id, title, play_count, play_count_7d, like_count, published_at, cover_url, artist_id, cloud_file_id, is_explicit')
      .eq('id', req.params.trackId)
      .eq('artist_id', artist.id)
      .maybeSingle();
    if (trackErr) throw new Error(trackErr.message);
    if (!track) return res.status(404).json({ error: 'Track not found.' });

    // Release association — artist_release_tracks is the join table; a
    // track can appear in at most one release in this schema (no junction
    // beyond the single release_id/track_id pair per row).
    const { data: releaseLink } = await supabase
      .from('artist_release_tracks')
      .select('release_id, artist_releases(id, title, release_type)')
      .eq('track_id', track.id)
      .maybeSingle();

    // Recent activity — last 10 individual plays, newest first. This is the
    // existing track_plays log (already populated by dbLogPlay on every
    // play), just sliced and surfaced here for the first time.
    const { data: recentPlays } = await supabase
      .from('track_plays')
      .select('username, played_at')
      .eq('track_id', track.id)
      .order('played_at', { ascending: false })
      .limit(10);

    // Video analytics — entirely separate counters from the audio stats
    // above (track_videos.play_count/watch_start_count/total_watch_seconds,
    // never tracks.play_count), per the explicit requirement to keep video
    // plays and audio plays apart. video: null when the track has no video
    // attached, rather than a block of zeros that would misleadingly imply
    // a video exists with no plays yet.
    const trackVideo = await dbGetTrackVideo(track.id);
    let video = null;
    if (trackVideo) {
      const duration = trackVideo.video_files?.duration || null;
      // Completion rate = average fraction of the video watched across
      // plays that actually reported an end-of-session duration. Plays
      // with no 'end' beacon (closed tab, etc) are excluded from the
      // average rather than counted as 0% — an unknown watch length isn't
      // the same signal as "watched none of it".
      const { data: samples } = await supabase
        .from('video_plays')
        .select('watched_seconds, video_duration')
        .eq('track_video_id', trackVideo.id)
        .not('watched_seconds', 'is', null);
      let completionRate = null;
      if (samples && samples.length) {
        const fractions = samples
          .filter(s => s.video_duration && s.video_duration > 0)
          .map(s => Math.min(1, (s.watched_seconds || 0) / s.video_duration));
        if (fractions.length) {
          completionRate = fractions.reduce((sum, f) => sum + f, 0) / fractions.length;
        }
      }
      video = {
        trackVideoId: trackVideo.id,
        thumbnailUrl: trackVideo.thumbnail_url,
        duration,
        videoPlays: trackVideo.play_count || 0,
        watchStarts: trackVideo.watch_start_count || 0,
        completionRate, // 0–1, or null if no samples yet
        completionSamples: samples?.filter(s => s.video_duration && s.video_duration > 0).length || 0,
      };
    }

    return res.json({
      id: track.id, title: track.title,
      coverUrl: track.cover_url, isExplicit: !!track.is_explicit,
      totalPlays: track.play_count || 0,
      totalPlays7d: track.play_count_7d || 0,
      likeCount: track.like_count || 0,
      commentCount: null, commentsSupported: false,
      publishedAt: track.published_at || null,
      release: releaseLink?.artist_releases
        ? { id: releaseLink.artist_releases.id, title: releaseLink.artist_releases.title, releaseType: releaseLink.artist_releases.release_type }
        : null,
      recentActivity: (recentPlays || []).map(p => ({
        username: p.username || 'Anonymous listener',
        playedAt: p.played_at,
      })),
      video,
    });
  } catch (err) {
    console.error('[track analytics]', err);
    return res.status(500).json({ error: 'Could not load track analytics.' });
  }
});

// These exist purely so pasting a profile/artist link into Discord/Twitter/
// iMessage shows that person's name and avatar instead of generic FREQ
// branding — the entire point of a "shareable" URL is how it looks when
// shared, not just that it resolves. Implementation is deliberately tiny:
// read index.html, string-replace three meta tags, send. No templating
// engine, no SSR framework — this is a few lines of value, not a system.
//
// BASE_URL prefers an explicit env var (set this on Render once a domain
// is attached) and falls back to localhost for local dev; og:url would be
// wrong without it, but the page still renders fine either way.
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DEFAULT_OG_IMAGE = `${BASE_URL}/Geometric%20Frequency%20Logo%20Emphasizing%20Modernity.ico`;

function escapeHtmlAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function injectOgTags({ title, description, image, url }) {
  let html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const t = escapeHtmlAttr(title);
  const d = escapeHtmlAttr(description);
  const i = escapeHtmlAttr(image || DEFAULT_OG_IMAGE);
  const u = escapeHtmlAttr(url);
  // Replace the existing <title> + description meta (always present, see
  // index.html's <head>) and append OG/Twitter card tags right after the
  // description tag — additive, doesn't disturb anything else in <head>.
  html = html.replace(/<title>.*?<\/title>/, `<title>${t}</title>`);
  html = html.replace(
    /<meta name="description"[^>]*>/,
    `<meta name="description" content="${d}" />\n` +
    `<meta property="og:title" content="${t}" />\n` +
    `<meta property="og:description" content="${d}" />\n` +
    `<meta property="og:image" content="${i}" />\n` +
    `<meta property="og:url" content="${u}" />\n` +
    `<meta property="og:type" content="profile" />\n` +
    `<meta name="twitter:card" content="summary" />\n` +
    `<meta name="twitter:title" content="${t}" />\n` +
    `<meta name="twitter:description" content="${d}" />\n` +
    `<meta name="twitter:image" content="${i}" />`
  );
  return html;
}

// Server-rendered entry point for shareable profile URLs. Falls through to
// the plain SPA shell (no OG tags) for a private or missing profile, same
// existence-probing protection GET /api/profiles/:username already has —
// a private profile's page source shouldn't visibly differ from a 404 in
// a way that confirms the username exists.
app.get('/u/:username', async (req, res) => {
  try {
    const profile = await dbGetProfile(normalizeUsername(req.params.username));
    if (profile && profile.is_public) {
      const html = await injectOgTags({
        title: `${profile.display_name || profile.username} (@${profile.username}) · FREQ`,
        description: profile.bio || `${profile.follower_count || 0} followers on FREQ`,
        image: profile.avatar_url,
        url: `${BASE_URL}/u/${profile.username}`,
      });
      return res.send(html);
    }
  } catch (err) {
    console.error('[og /u/:username]', err);
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/artist/:slug', async (req, res) => {
  try {
    const artist = await dbGetArtistBySlug((req.params.slug || '').trim().toLowerCase());
    if (artist) {
      const html = await injectOgTags({
        title: `${artist.name} · FREQ`,
        description: artist.bio || `${artist.follower_count || 0} followers on FREQ`,
        image: artist.avatar_url,
        url: `${BASE_URL}/artist/${artist.slug}`,
      });
      return res.send(html);
    }
  } catch (err) {
    console.error('[og /artist/:slug]', err);
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});

// Shareable track links — "share to listen" for a FREQ-catalog track. Same
// existence-probing protection as /u/:username: only a genuinely published
// track gets real OG tags, everything else (unpublished/missing id) falls
// through to the bare SPA shell so a private/draft track's page source
// can't be used to confirm the id exists. The actual "listen" behavior
// (auto-playing this track for a visitor who clicks through) is handled
// client-side in index.html's handleSharedProfileLink, not here — this
// route's only job is what the link looks like when shared.
app.get('/track/:id', async (req, res) => {
  try {
    const track = await dbGetTrackById(req.params.id);
    if (track && track.is_published) {
      const html = await injectOgTags({
        title: `${track.title} by ${track.artist_name || 'Unknown Artist'} · FREQ`,
        description: `Listen to "${track.title}" on FREQ.`,
        image: track.cover_url,
        url: `${BASE_URL}/track/${track.id}`,
      });
      return res.send(html);
    }
  } catch (err) {
    console.error('[og /track/:id]', err);
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});

// Shareable queue links — "share to listen" for a playlist, reusing the
// same is_public flag playlists already have rather than inventing a new
// concept of a queue snapshot. Same existence-probing protection as
// /track/:id: only a public playlist gets real OG tags, a private/missing
// id falls through to the bare SPA shell. Loading the playlist's tracks
// into the visitor's queue on click-through is handled client-side in
// handleSharedProfileLink, same division of responsibility as /track/:id.
app.get('/q/:id', async (req, res) => {
  try {
    const playlist = await dbGetPlaylist(req.params.id);
    if (playlist && playlist.is_public) {
      const html = await injectOgTags({
        title: `${playlist.name} · FREQ`,
        description: playlist.description || `${playlist.track_count || 0} tracks · Listen on FREQ.`,
        image: null,
        url: `${BASE_URL}/q/${playlist.id}`,
      });
      return res.send(html);
    }
  } catch (err) {
    console.error('[og /q/:id]', err);
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});


// ─── Reports ─────────────────────────────────────────────────────────────────

// Reason/targetType strings here MUST exactly match the `reports` table's
// CHECK constraints in Supabase — a mismatch passes server-side validation
// but throws a 23514 check-violation on insert. The DB calls the user-report
// type 'user' (not 'profile') and the harassment reason 'harassment' (not
// 'harassment_bullying'); the frontend label "Harassment / Bullying" maps to
// the single 'harassment' reason value.
const REPORT_REASONS = [
  'impersonation', 'copyright_violation', 'spam',
  'harassment', 'hate_speech', 'explicit_not_marked',
  'misleading_metadata', 'other',
];
const REPORT_TARGET_TYPES = ['track', 'release', 'artist', 'post', 'user', 'video'];

// POST /api/reports
app.post('/api/reports', rateLimit, async (req, res) => {
  const { token, targetType, targetId, reason, details } = req.body || {};
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Sign in to report content.' });
  if (!REPORT_TARGET_TYPES.includes(targetType)) return res.status(400).json({ error: 'Invalid targetType.' });
  if (!targetId) return res.status(400).json({ error: '"targetId" is required.' });
  if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: 'Invalid reason.' });

  let priority = 'normal';
  let targetUsername = null;
  if (targetType === 'user') targetUsername = targetId;
  else if (targetType === 'artist') {
    const { data: artistRow } = await supabase.from('artists').select('account_id').eq('id', targetId).maybeSingle();
    targetUsername = artistRow?.account_id || null;
  }
  if (targetUsername && targetUsername.toLowerCase() === 'slimey2017') priority = 'high';

  try {
    const { data, error } = await supabase.from('reports').insert({
      reporter_user_id: sess.username,
      target_type: targetType,
      target_id: String(targetId),
      reason,
      details: details ? String(details).slice(0, 2000) : null,
      priority,
    }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'You have already reported this content.' });
      throw error;
    }
    return res.status(201).json({ id: data.id, status: data.status, isFounder: priority === 'high' });
  } catch (err) {
    console.error('[reports create]', err);
    return res.status(500).json({ error: 'Could not submit report.' });
  }
});

// GET /api/reports/check
app.get('/api/reports/check', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = token ? await dbGetSession(token) : null;
  if (!sess) return res.json({ reported: false });
  const { targetType, targetId } = req.query;
  if (!targetType || !targetId) return res.json({ reported: false });
  const { data } = await supabase.from('reports')
    .select('id').eq('reporter_user_id', sess.username)
    .eq('target_type', targetType).eq('target_id', String(targetId))
    .maybeSingle();
  return res.json({ reported: !!data });
});

// GET /api/admin/me — also carries isPremium so the frontend can gate DJ BOOM
// and other Premium UI off the same call instead of a second round trip.
app.get('/api/admin/me', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const sess = token ? await dbGetSession(token) : null;
  if (!sess) return res.json({ isAdmin: false, isPremium: false });
  return res.json({ isAdmin: sess.isAdmin, isPremium: sess.isPremium, username: sess.username });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PRESENCE + PAGE VIEWS — admin-only "who's using the site" tracking
//  ─────────────────────────────────────────────────────────────────────────
//  Two logging endpoints any authenticated user's client calls automatically
//  (heartbeat + page view), and three admin-only read endpoints. No IP
//  address or geolocation is ever collected or stored — see the migration
//  comment on presence_sessions/page_views. "Who posted" isn't a new system:
//  post creation already writes to activity_feed via dbWriteActivity, so
//  GET /api/admin/activity below just exposes dbGetGlobalFeed to admins
//  rather than duplicating that tracking.
//
//  POST /api/presence/heartbeat   Authenticated. { } → upserts this session's
//                                 presence_sessions row, refreshing last_seen_at.
//                                 Called every PRESENCE_HEARTBEAT_MS by the
//                                 frontend while the tab is visible. Not
//                                 admin-gated — every logged-in user calls
//                                 this for themselves, same as any session
//                                 keep-alive; only the READ side is admin-only.
//  POST /api/analytics/page-view  { path } → logs a page_views row. Optional
//                                 auth (works for guests too, username null).
//
//  GET  /api/admin/presence       requireAdmin. Currently-online users (any
//                                 presence_sessions row with last_seen_at
//                                 within the offline threshold), plus each
//                                 one's first_seen_at for "online since".
//  GET  /api/admin/presence/history  requireAdmin. Closed online-periods
//                                 (join/leave pairs) for a "who was online
//                                 when" log, most recent first.
//  GET  /api/admin/page-views     requireAdmin. Recent page_views rows,
//                                 optionally filtered by ?username=.
//  GET  /api/admin/activity       requireAdmin. Thin wrapper around
//                                 dbGetGlobalFeed — "who posted what, when."

// A session counts as online if its last heartbeat was within this window.
// Set to 3x the frontend's heartbeat interval (see PRESENCE_HEARTBEAT_MS in
// index.html, 30s) so one dropped/delayed beat doesn't flip someone offline
// and back on again every other tick.
const PRESENCE_OFFLINE_THRESHOLD_MS = 90 * 1000; // 90 seconds

// Upserts the caller's presence row: if they already have an open session
// (no ended_at) that hasn't gone stale past the offline threshold, just bump
// last_seen_at on it; otherwise start a new row. This is what makes
// presence_sessions double as a join/leave history rather than a single
// "currently online" flag per user — going stale and coming back later
// starts a fresh row with its own first_seen_at, rather than stretching the
// old row's "online since" back to a session that actually ended.
async function dbRecordHeartbeat(username, sessionToken) {
  const nowIso = new Date().toISOString();
  const staleBefore = new Date(Date.now() - PRESENCE_OFFLINE_THRESHOLD_MS).toISOString();

  const { data: openRow } = await supabase
    .from('presence_sessions')
    .select('id, last_seen_at')
    .eq('username', username)
    .eq('session_token', sessionToken)
    .is('ended_at', null)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openRow && openRow.last_seen_at >= staleBefore) {
    await supabase.from('presence_sessions').update({ last_seen_at: nowIso }).eq('id', openRow.id);
    return;
  }
  // Either no open row, or the existing one already went stale (the sweep
  // just hasn't closed it out yet) — either way this heartbeat starts a new
  // online period rather than reviving an old one.
  if (openRow) {
    await supabase.from('presence_sessions').update({ ended_at: openRow.last_seen_at }).eq('id', openRow.id);
  }
  await supabase.from('presence_sessions').insert({
    username, session_token: sessionToken, first_seen_at: nowIso, last_seen_at: nowIso,
  });
}

// Closes out any presence_sessions row that's gone stale (last_seen_at older
// than the offline threshold) but hasn't been marked ended_at yet, so
// "currently online" queries and the join/leave history stay accurate even
// if a user's tab just vanished (closed, crashed, lost network) without a
// final heartbeat ever arriving to signal "offline" directly. Cheap enough
// to run opportunistically on every admin presence read rather than needing
// its own cron/scheduler.
async function dbSweepStalePresence() {
  const staleBefore = new Date(Date.now() - PRESENCE_OFFLINE_THRESHOLD_MS).toISOString();
  await supabase.from('presence_sessions')
    .update({ ended_at: staleBefore })
    .is('ended_at', null)
    .lt('last_seen_at', staleBefore);
}

app.post('/api/presence/heartbeat', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = token ? await dbGetSession(token) : null;
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    await dbRecordHeartbeat(sess.username, token);
    return res.json({ ok: true });
  } catch (err) {
    // Best-effort — a failed heartbeat write should never surface as a
    // user-visible error; it just means this tick's presence isn't recorded.
    console.error('[presence heartbeat]', err?.message || err);
    return res.json({ ok: false });
  }
});

// Logs a page view. Deliberately does NOT require authentication — guests
// browsing the site are part of "who's using the website" too, they just
// show up with username: null. `path` is the frontend's own internal route
// name (see ROUTE constants in index.html), never a raw URL — so no query
// strings, hashes, or anything that could carry incidental PII through.
app.post('/api/analytics/page-view', async (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path.slice(0, 200).trim() : '';
  if (!path) return res.status(400).json({ error: 'path is required.' });

  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token;
  const sess = token ? await dbGetSession(token) : null;

  try {
    await supabase.from('page_views').insert({ username: sess?.username || null, path });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[page view]', err?.message || err);
    return res.json({ ok: false });
  }
});

// GET /api/admin/presence — who's online right now.
app.get('/api/admin/presence', requireAdmin, async (req, res) => {
  try {
    await dbSweepStalePresence();
    const { data, error } = await supabase
      .from('presence_sessions')
      .select('username, first_seen_at, last_seen_at')
      .is('ended_at', null)
      .order('first_seen_at', { ascending: false });
    if (error) throw new Error(error.message);
    return res.json({ online: data || [], count: (data || []).length });
  } catch (err) {
    console.error('[admin presence]', err?.message || err);
    return res.status(500).json({ error: 'Could not load presence.' });
  }
});

// GET /api/admin/presence/history — closed online-periods (join/leave log),
// most recent first. ?username= filters to one account; ?limit= caps rows
// (default 100, max 500).
app.get('/api/admin/presence/history', requireAdmin, async (req, res) => {
  try {
    await dbSweepStalePresence();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    let q = supabase
      .from('presence_sessions')
      .select('username, first_seen_at, last_seen_at, ended_at')
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(limit);
    if (req.query.username) q = q.eq('username', normalizeUsername(req.query.username));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return res.json({ history: data || [] });
  } catch (err) {
    console.error('[admin presence history]', err?.message || err);
    return res.status(500).json({ error: 'Could not load presence history.' });
  }
});

// GET /api/admin/page-views — recent page views. ?username= filters to one
// account; ?limit= caps rows (default 200, max 1000).
app.get('/api/admin/page-views', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    let q = supabase
      .from('page_views')
      .select('username, path, viewed_at')
      .order('viewed_at', { ascending: false })
      .limit(limit);
    if (req.query.username) q = q.eq('username', normalizeUsername(req.query.username));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return res.json({ pageViews: data || [] });
  } catch (err) {
    console.error('[admin page views]', err?.message || err);
    return res.status(500).json({ error: 'Could not load page views.' });
  }
});

// GET /api/admin/activity — "who posted what, when." Thin wrapper around the
// same dbGetGlobalFeed used by the public Activity Feed — post creation
// already lands here via dbWriteActivity, so this isn't a new tracking
// system, just an admin-facing read of the existing one. ?limit= caps rows
// (default 50, max 200); ?before= paginates (ISO timestamp cursor).
app.get('/api/admin/activity', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const feed = await dbGetGlobalFeed({ limit, before });
    return res.json({ activity: feed });
  } catch (err) {
    console.error('[admin activity]', err?.message || err);
    return res.status(500).json({ error: 'Could not load activity.' });
  }
});

// GET /api/admin/reports/stats (must come before /api/admin/reports/:id)
app.get('/api/admin/reports/stats', requireAdmin, async (req, res) => {
  try {
    const statuses = ['pending', 'reviewed', 'action_taken', 'dismissed'];
    const counts = {};
    for (const s of statuses) {
      const { count } = await supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', s);
      counts[s] = count || 0;
    }
    return res.json(counts);
  } catch (err) {
    return res.status(500).json({ error: 'Could not load stats.' });
  }
});

// GET /api/admin/reports
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  const status = ['pending', 'reviewed', 'action_taken', 'dismissed'].includes(req.query.status) ? req.query.status : 'pending';
  const limit  = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;
  try {
    const { data, error, count } = await supabase.from('reports')
      .select('*', { count: 'exact' })
      .eq('status', status)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return res.json({ reports: data, total: count, status, limit, offset });
  } catch (err) {
    console.error('[admin reports list]', err);
    return res.status(500).json({ error: 'Could not load reports.' });
  }
});

// PATCH /api/admin/reports/:id
app.patch('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  const { action } = req.body || {};
  const reportId = Number(req.params.id);
  if (!reportId) return res.status(400).json({ error: 'Invalid report ID.' });
  const VALID_ACTIONS = ['reviewed', 'action_taken', 'dismissed', 'ban_user', 'verify_artist', 'remove_content'];
  if (!VALID_ACTIONS.includes(action)) return res.status(400).json({ error: 'Invalid action.' });
  try {
    const { data: report } = await supabase.from('reports').select('*').eq('id', reportId).maybeSingle();
    if (!report) return res.status(404).json({ error: 'Report not found.' });

    // Founder protection
    if (action === 'ban_user' || action === 'remove_content') {
      if (report.target_type === 'user' && report.target_id?.toLowerCase() === 'slimey2017')
        return res.status(403).json({ error: 'Cannot apply automated moderation to the platform founder account.' });
      if (report.target_type === 'artist') {
        const { data: a } = await supabase.from('artists').select('account_id').eq('id', report.target_id).maybeSingle();
        if (a?.account_id?.toLowerCase() === 'slimey2017')
          return res.status(403).json({ error: 'Cannot apply automated moderation to the platform founder account.' });
      }
    }

    let newStatus = report.status;
    if (action === 'reviewed')       newStatus = 'reviewed';
    if (action === 'action_taken')   newStatus = 'action_taken';
    if (action === 'dismissed')      newStatus = 'dismissed';
    if (action === 'ban_user')       newStatus = 'action_taken';
    if (action === 'remove_content') newStatus = 'action_taken';
    if (action === 'verify_artist')  newStatus = 'action_taken';

    if (action === 'verify_artist' && report.target_type === 'artist')
      await supabase.from('artists').update({ is_verified: true }).eq('id', report.target_id);
    if (action === 'remove_content' && report.target_type === 'track')
      await supabase.from('tracks').delete().eq('id', report.target_id);
    if (action === 'remove_content' && report.target_type === 'release')
      await supabase.from('artist_releases').delete().eq('id', report.target_id);
    if (action === 'remove_content' && report.target_type === 'post')
      await supabase.from('posts').delete().eq('id', report.target_id);
    if (action === 'remove_content' && report.target_type === 'video') {
      // report.target_id for a video report is the trackId (videos have no
      // independent public identity — they're addressed via the track they
      // belong to, same as how a video report gets filed in the first
      // place from the track's report-this-video button). Detach + delete
      // storage, but leave the track and its audio intact — a video
      // takedown isn't a track takedown.
      const { data: tv } = await supabase.from('track_videos').select('id, video_file_id').eq('track_id', report.target_id).maybeSingle();
      if (tv) {
        await supabase.from('track_videos').delete().eq('id', tv.id);
        const { data: vf } = await supabase.from('video_files').select('storage_path').eq('id', tv.video_file_id).maybeSingle();
        if (vf) {
          await supabase.storage.from(VIDEO_BUCKET).remove([vf.storage_path]);
          await supabase.from('video_files').delete().eq('id', tv.video_file_id);
        }
      }
    }
    if (action === 'ban_user') {
      await supabase.from('accounts').update({ is_banned: true }).eq('username', report.target_id);
      await supabase.from('sessions').delete().eq('username', report.target_id);
    }

    const { data: updated } = await supabase.from('reports')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', reportId).select().single();
    return res.json({ report: updated, action });
  } catch (err) {
    console.error('[admin report action]', err);
    return res.status(500).json({ error: 'Could not update report.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ARTIST IDENTITY VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════
// Replaces the old one-shot boolean toggle (POST/DELETE /api/admin/artists/:id/verify
// below, kept for backward-compat / quick founder overrides) with a full evidence
// pipeline: claim -> email verification -> consent -> ID + selfie + liveness video
// -> automated (mock) checks -> ownership evidence -> manual review -> decision.
//
// Every automated result (face match, liveness, manipulation) is advisory only —
// see lib/verificationProvider.js's shouldForceManualReview(): until a real vendor
// is configured, every request is routed to manual_review regardless of what the
// mock returns. No route here can grant a badge from the frontend; only the
// POST /manual-review/:requestId/decide route (requireAdmin) can approve.
//
// Multer instance for verification evidence: images (ID doc, selfie) and short
// liveness video in one endpoint family. Higher size ceiling than imageUpload
// (raw phone camera captures, not compressed avatars) but far below the 500MB
// video bucket ceiling — liveness clips are seconds long.
const verificationEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1048576 }, // 25MB — generous for a phone photo or a short liveness clip
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpeg|jpg|webp)$/.test(file.mimetype) || /^video\/(mp4|webm|quicktime)$/.test(file.mimetype);
    cb(null, ok);
  },
});

// GET /api/artists/:id/verification/status
// Public-ish (any authenticated user) summary of the artist's current
// verification state — used to render claim-flow entry points and the badge
// tooltip. Does NOT expose evidence contents, only status metadata.
app.get('/api/artists/:id/verification/status', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    let activeRequest = null;
    if (artist.active_verification_request_id) {
      const { data } = await supabase.from('artist_verification_requests')
        .select('id, status, created_at, updated_at, decision, decision_reason')
        .eq('id', artist.active_verification_request_id).maybeSingle();
      activeRequest = data;
    }
    return res.json({
      artistId: artist.id,
      isVerified: !!artist.is_verified,
      verificationStatus: artist.verification_status || 'not_started',
      badgeRevokedAt: artist.verification_badge_revoked_at || null,
      activeRequest,
    });
  } catch (err) {
    console.error('[verification status]', err);
    return res.status(500).json({ error: 'Could not load verification status.' });
  }
});

// POST /api/artists/:id/verification/start
// Step 1 (claim) + kicks off Step 2 (email verification). Body:
//   { token, role, legalName, stageName, contactEmail, officialLinks: [] }
app.post('/api/artists/:id/verification/start', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  if (!sess.emailVerified) return res.status(403).json({ error: 'Please verify your account email before starting artist verification.', emailVerificationRequired: true });

  const { role, legalName, stageName, contactEmail, officialLinks } = req.body || {};
  const VALID_ROLES = ['artist', 'manager', 'label_rep', 'authorized_team_member'];
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (!legalName || !String(legalName).trim()) return res.status(400).json({ error: 'Legal name is required.' });
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return res.status(400).json({ error: 'A valid contact email is required.' });
  }
  const links = Array.isArray(officialLinks) ? officialLinks.filter(l => typeof l === 'string' && l.trim()).slice(0, 10) : [];

  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });

    if (artist.verification_status && !verificationCore.TERMINAL_STATUSES.has(artist.verification_status) && artist.verification_status !== 'not_started') {
      return res.status(409).json({ error: 'A verification request is already in progress for this artist.', status: artist.verification_status });
    }
    if (artist.is_verified) {
      return res.status(409).json({ error: 'This artist page is already verified.' });
    }

    const rl = await verificationCore.checkAndBumpRateLimit(supabase, sess.username);
    if (!rl.allowed) {
      return res.status(429).json({ error: 'Too many verification attempts. Please try again later.', retryAfterMs: rl.retryAfterMs });
    }

    const duplicates = await verificationCore.detectDuplicates(supabase, {
      applicantUsername: sess.username, legalName: legalName.trim(), contactEmail: contactEmail.toLowerCase().trim(),
    });

    let emailRisk = verificationCore.classifyEmailDomainRisk(contactEmail);
    if (emailRisk === 'unknown' && verificationCore.emailDomainMatchesAnyLink(contactEmail, links)) {
      emailRisk = 'official';
    }

    const { data: request, error } = await supabase.from('artist_verification_requests').insert({
      artist_id: artist.id,
      applicant_username: sess.username,
      role, legal_name: legalName.trim(), stage_name: stageName ? String(stageName).trim() : null,
      contact_email: contactEmail.toLowerCase().trim(),
      contact_email_domain_risk: emailRisk,
      official_links: links,
      status: 'email_pending',
      risk_score: emailRisk === 'free_provider' ? 20 : 0,
    }).select().single();
    if (error) throw new Error(error.message);

    await verificationCore.syncArtistVerificationStatus(supabase, artist.id, request.id, 'email_pending');
    await verificationCore.logAction(supabase, { requestId: request.id, actor: sess.username, action: 'submitted', detail: { role, emailRisk, duplicateCount: duplicates.length } });
    if (duplicates.length) {
      await verificationCore.logAction(supabase, { requestId: request.id, actor: 'system', action: 'duplicate_flagged', detail: { matches: duplicates.map(d => ({ requestId: d.id, artistId: d.artist_id })) } });
    }

    // Step 2: build the verification link. Sending is now done CLIENT-SIDE
    // (see submitVerificationClaim() in verification_frontend.js) via
    // emailjs.send() with the FREQ_VERIFICATION_EMAILJS keys in index.html —
    // that's a real browser context, which EmailJS's API requires unless
    // "allow non-browser applications" is enabled on the account. We still
    // generate + hash + store the token here so the raw token is never
    // persisted, only ever placed in the URL handed back in this response.
    const rawToken = verificationCore.generateVerificationToken();
    await supabase.from('artist_verification_requests').update({
      email_verification_token_hash: verificationCore.hashToken(rawToken),
      email_verification_expires_at: new Date(Date.now() + verificationCore.EMAIL_TOKEN_TTL_HOURS * 3600 * 1000).toISOString(),
    }).eq('id', request.id);

    const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?requestId=${request.id}&token=${rawToken}`;
    console.log(`[verification link generated] ${artist.name} <${contactEmail}> (${verificationCore.EMAIL_TOKEN_TTL_HOURS}h): ${verifyUrl}`);
    await verificationCore.logAction(supabase, { requestId: request.id, actor: 'system', action: 'email_sent', detail: { to: contactEmail, kind: 'initial' } });

    return res.status(201).json({
      requestId: request.id,
      status: 'email_pending',
      duplicatesFlagged: duplicates.length > 0,
      // Handed to the frontend so it can trigger emailjs.send() itself —
      // see submitVerificationClaim(). Not persisted anywhere but this
      // response; the hash in the DB is what actually gets checked on click.
      verifyUrl,
      artistName: artist.name,
      contactEmail,
      expiresInHours: verificationCore.EMAIL_TOKEN_TTL_HOURS,
    });
  } catch (err) {
    console.error('[verification start]', err);
    return res.status(500).json({
      error: 'Could not start verification.',
      detail: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
});

// POST /api/verification/confirm-email   { requestId, token }
// Step 2 completion. Public route (no session needed) since the link is
// clicked from an email client, but still validates the hashed token + expiry.
// POST /api/verification/:requestId/resend-email   { token: AUTH.token }
// For requests stuck on email_pending (e.g. the original emailjs.send() call
// failed client-side, or the link expired). Regenerates a fresh token +
// expiry — the OLD token/link stops working the moment this runs, since the
// stored hash is overwritten. Returns the same verifyUrl/artistName/
// expiresInHours shape as /verification/start so the frontend can reuse the
// exact same emailjs.send() call.
app.post('/api/verification/:requestId/resend-email', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const { requestId } = req.params;
  const authToken = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const sess = await dbGetSession(authToken);
    if (!sess) return res.status(401).json({ error: 'Not authenticated.' });

    const { data: request } = await supabase.from('artist_verification_requests').select('*').eq('id', requestId).maybeSingle();
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });
    if (request.applicant_username !== sess.username) return res.status(403).json({ error: 'Not your verification request.' });
    if (request.status !== 'email_pending') return res.status(409).json({ error: `This request is not awaiting email verification (status: ${request.status}).` });

    const { data: artist } = await supabase.from('artists').select('name').eq('id', request.artist_id).maybeSingle();

    const rawToken = verificationCore.generateVerificationToken();
    await supabase.from('artist_verification_requests').update({
      email_verification_token_hash: verificationCore.hashToken(rawToken),
      email_verification_expires_at: new Date(Date.now() + verificationCore.EMAIL_TOKEN_TTL_HOURS * 3600 * 1000).toISOString(),
    }).eq('id', requestId);

    const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?requestId=${requestId}&token=${rawToken}`;
    console.log(`[verification link regenerated] ${artist?.name || 'artist'} <${request.contact_email}>: ${verifyUrl}`);
    await verificationCore.logAction(supabase, { requestId, actor: sess.username, action: 'email_sent', detail: { to: request.contact_email, kind: 'resend' } });

    return res.json({
      requestId,
      verifyUrl,
      artistName: artist?.name || 'there',
      contactEmail: request.contact_email,
      expiresInHours: verificationCore.EMAIL_TOKEN_TTL_HOURS,
    });
  } catch (err) {
    console.error('[verification resend-email]', err);
    return res.status(500).json({ error: 'Could not resend verification email.' });
  }
});

// Shared by POST /api/verification/confirm-email (programmatic use) and
// GET /verify-email (the actual magic-link click target). Returns
// { ok: true, requestId, status } or { ok: false, httpStatus, error }
// rather than writing to res directly, so both routes can format the
// response their own way (JSON vs redirect).
async function confirmVerificationEmail(requestId, token) {
  if (!requestId || !token) return { ok: false, httpStatus: 400, error: 'requestId and token are required.' };
  const { data: request } = await supabase.from('artist_verification_requests').select('*').eq('id', requestId).maybeSingle();
  if (!request) return { ok: false, httpStatus: 404, error: 'Verification request not found.' };
  if (request.status !== 'email_pending') return { ok: false, httpStatus: 409, error: `This request is not awaiting email verification (status: ${request.status}).` };
  if (!request.email_verification_expires_at || new Date(request.email_verification_expires_at).getTime() < Date.now()) {
    return { ok: false, httpStatus: 410, error: 'This verification link has expired. Please restart the verification process.' };
  }
  if (verificationCore.hashToken(token) !== request.email_verification_token_hash) {
    return { ok: false, httpStatus: 403, error: 'Invalid verification link.' };
  }

  await supabase.from('artist_verification_requests').update({ email_verified_at: new Date().toISOString() }).eq('id', requestId);
  const updated = await verificationCore.transitionStatus(supabase, requestId, 'email_pending', 'evidence_required', { actor: 'system' });
  await verificationCore.syncArtistVerificationStatus(supabase, request.artist_id, requestId, 'evidence_required');
  await verificationCore.logAction(supabase, { requestId, actor: 'system', action: 'email_verified', detail: {} });

  return { ok: true, requestId, status: updated.status };
}

app.post('/api/verification/confirm-email', rateLimit, async (req, res) => {
  const { requestId, token } = req.body || {};
  try {
    const result = await confirmVerificationEmail(requestId, token);
    if (!result.ok) return res.status(result.httpStatus).json({ error: result.error });
    return res.json({ requestId: result.requestId, status: result.status });
  } catch (err) {
    console.error('[verification confirm-email]', err);
    return res.status(500).json({ error: 'Could not confirm email verification.' });
  }
});

// GET /verify-email?requestId=...&token=...
// The ACTUAL link target clicked from the confirmation email (see verifyUrl
// in /verification/start and /verification/:id/resend-email above). Browsers
// hit this with a plain GET when the link is clicked — there is no frontend
// JS anywhere that reads requestId/token from the URL, so without this route
// the request silently falls through to the SPA catch-all and index.html
// just loads with no indication anything happened.
//
// Does the confirm server-side, then redirects into the SPA with a query
// flag (?verified=1 or ?verifyError=...) so the artist dashboard can show a
// toast/status once it boots. rateLimit intentionally omitted here — the
// token itself is the auth (single-use, hashed, expires), and this is a
// GET a human clicks from their inbox, not an API a script would hammer.
app.get('/verify-email', async (req, res) => {
  const { requestId, token } = req.query || {};
  try {
    const result = await confirmVerificationEmail(requestId, token);
    if (!result.ok) {
      return res.redirect(`/?verifyError=${encodeURIComponent(result.error)}`);
    }
    return res.redirect(`/?verified=1&requestId=${encodeURIComponent(result.requestId)}`);
  } catch (err) {
    console.error('[verify-email link]', err);
    return res.redirect(`/?verifyError=${encodeURIComponent('Could not confirm email verification.')}`);
  }
});

// POST /api/verification/:requestId/consent   { token, consentGiven: true }
// Must be recorded before any of the evidence-upload routes below will accept
// a government ID, selfie, or liveness video.
app.post('/api/verification/:requestId/consent', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  if (!req.body?.consentGiven) return res.status(400).json({ error: 'Consent must be explicitly given to continue.' });

  try {
    const request = await getOwnedRequest(req.params.requestId, sess.username);
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });
    await supabase.from('artist_verification_requests').update({
      consent_given_at: new Date().toISOString(), consent_version: verificationCore.CURRENT_CONSENT_VERSION,
    }).eq('id', request.id);
    return res.json({ requestId: request.id, consentGivenAt: new Date().toISOString(), consentVersion: verificationCore.CURRENT_CONSENT_VERSION });
  } catch (err) {
    console.error('[verification consent]', err);
    return res.status(500).json({ error: 'Could not record consent.' });
  }
});

// Shared helper: loads a request and confirms it belongs to the requesting user.
async function getOwnedRequest(requestId, username) {
  const { data, error } = await supabase.from('artist_verification_requests').select('*').eq('id', requestId).eq('applicant_username', username).maybeSingle();
  if (error) { console.error('[verification] getOwnedRequest:', error.message); return null; }
  return data;
}

// POST /api/verification/:requestId/documents/id
// Step 3 — government-issued ID upload. multipart/form-data: file, token.
// Requires consent to already be recorded. Encrypts before storage.
app.post('/api/verification/:requestId/documents/id', rateLimit, verificationEvidenceUpload.single('file'), requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const request = await getOwnedRequest(req.params.requestId, sess.username);
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });
    if (!request.consent_given_at) return res.status(403).json({ error: 'Consent is required before uploading identity documents.' });
    if (!['evidence_required', 'more_information_required'].includes(request.status)) {
      return res.status(409).json({ error: `Cannot upload evidence in status ${request.status}.` });
    }

    const doc = await verificationCore.storeEncryptedDocument(supabase, {
      requestId: request.id, docType: 'government_id', buffer: req.file.buffer, mimeType: req.file.mimetype, ownerUsername: sess.username,
    });
    await supabase.from('artist_verification_requests').update({ id_document_file_id: doc.id }).eq('id', request.id);
    await verificationCore.logAction(supabase, { requestId: request.id, actor: sess.username, action: 'evidence_uploaded', detail: { docType: 'government_id' } });

    return res.status(201).json({ documentId: doc.id, docType: 'government_id' });
  } catch (err) {
    console.error('[verification id upload]', err);
    return res.status(500).json({ error: 'Could not upload identity document.' });
  }
});

// POST /api/verification/:requestId/documents/selfie
// Step 4 — live selfie captured in-app. Frontend enforces camera-capture-only
// (no gallery picker) — this route can't distinguish the two, so the honesty
// of "live capture" depends on the client using getUserMedia + canvas capture
// rather than <input type=file>, which the claim-wizard UI does.
app.post('/api/verification/:requestId/documents/selfie', rateLimit, verificationEvidenceUpload.single('file'), requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const request = await getOwnedRequest(req.params.requestId, sess.username);
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });
    if (!request.consent_given_at) return res.status(403).json({ error: 'Consent is required before submitting a selfie.' });
    if (!['evidence_required', 'more_information_required'].includes(request.status)) {
      return res.status(409).json({ error: `Cannot upload evidence in status ${request.status}.` });
    }

    const doc = await verificationCore.storeEncryptedDocument(supabase, {
      requestId: request.id, docType: 'selfie', buffer: req.file.buffer, mimeType: req.file.mimetype, ownerUsername: sess.username,
    });
    await supabase.from('artist_verification_requests').update({ selfie_file_id: doc.id }).eq('id', request.id);
    await verificationCore.logAction(supabase, { requestId: request.id, actor: sess.username, action: 'evidence_uploaded', detail: { docType: 'selfie' } });

    return res.status(201).json({ documentId: doc.id, docType: 'selfie' });
  } catch (err) {
    console.error('[verification selfie upload]', err);
    return res.status(500).json({ error: 'Could not upload selfie.' });
  }
});

// GET /api/verification/:requestId/liveness/prompt
// Step 5 — issues a fresh randomized liveness prompt. Must be called
// immediately before recording (frontend requests this right as the camera
// opens), since the prompt changing per-attempt is what makes a prerecorded
// video insufficient.
app.get('/api/verification/:requestId/liveness/prompt', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const request = await getOwnedRequest(req.params.requestId, sess.username);
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });
    if (!request.consent_given_at) return res.status(403).json({ error: 'Consent is required before liveness capture.' });

    const prompt = verificationCore.generateLivenessPrompt();
    await supabase.from('artist_verification_requests').update({ liveness_prompt: prompt }).eq('id', request.id);
    await verificationCore.logAction(supabase, { requestId: request.id, actor: 'system', action: 'liveness_prompt_issued', detail: { prompt } });
    return res.json({ prompt });
  } catch (err) {
    console.error('[verification liveness prompt]', err);
    return res.status(500).json({ error: 'Could not issue liveness prompt.' });
  }
});

// POST /api/verification/:requestId/liveness/submit
// Step 5 completion — uploads the recorded clip, then runs Step 6 (face
// comparison), Step 8 (manipulation check), moves to automated_review, and
// immediately to manual_review per shouldForceManualReview(). All automated
// results are stored but treated as advisory only.
app.post('/api/verification/:requestId/liveness/submit', rateLimit, verificationEvidenceUpload.single('file'), requireFeatureAllowed('uploads'), requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const request = await getOwnedRequest(req.params.requestId, sess.username);
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });
    if (!request.consent_given_at) return res.status(403).json({ error: 'Consent is required before liveness capture.' });
    if (!request.liveness_prompt) return res.status(409).json({ error: 'No liveness prompt has been issued yet.' });
    if (!request.id_document_file_id || !request.selfie_file_id) {
      return res.status(409).json({ error: 'Upload your ID document and selfie before submitting a liveness video.' });
    }
    if (!['evidence_required', 'more_information_required'].includes(request.status)) {
      return res.status(409).json({ error: `Cannot submit liveness video in status ${request.status}.` });
    }

    const attemptCount = (request.liveness_attempt_count || 0) + 1;
    const doc = await verificationCore.storeEncryptedDocument(supabase, {
      requestId: request.id, docType: 'liveness_video', buffer: req.file.buffer, mimeType: req.file.mimetype, ownerUsername: sess.username,
    });

    const deviceMetadata = {
      userAgent: req.headers['user-agent'] || null,
      submittedAt: new Date().toISOString(),
      attemptNumber: attemptCount,
    };

    await supabase.from('artist_verification_requests').update({
      liveness_video_file_id: doc.id,
      liveness_attempt_count: attemptCount,
      device_session_metadata: deviceMetadata,
    }).eq('id', request.id);
    await verificationCore.logAction(supabase, { requestId: request.id, actor: sess.username, action: 'liveness_submitted', detail: { attemptCount } });

    let updated = await verificationCore.transitionStatus(supabase, request.id, request.status, 'automated_review', { actor: 'system' });
    await verificationCore.syncArtistVerificationStatus(supabase, request.artist_id, request.id, 'automated_review');

    // Step 6: face comparison (advisory only)
    const faceResult = await verificationCore.runFaceComparison({ selfieStoragePath: null, idDocumentStoragePath: null });
    await verificationCore.logAction(supabase, { requestId: request.id, actor: 'system', action: 'automated_face_check', detail: faceResult });

    // Step 5 result placeholder — liveness analysis (advisory only; mock always inconclusive)
    const livenessResult = await verificationCore.runLivenessCheck({ videoStoragePath: null, issuedPrompt: request.liveness_prompt });

    // Step 8: manipulation/deepfake signals (advisory only)
    const manipulationResult = await verificationCore.runManipulationCheck({ selfieStoragePath: null, videoStoragePath: null });
    await verificationCore.logAction(supabase, { requestId: request.id, actor: 'system', action: 'automated_manipulation_check', detail: manipulationResult });

    await supabase.from('artist_verification_requests').update({
      face_match_result: faceResult.result,
      face_match_confidence: faceResult.confidence,
      liveness_result: livenessResult.result,
      manipulation_risk_result: manipulationResult.result,
      manipulation_signals: manipulationResult.signals || [],
    }).eq('id', request.id);

    // Never auto-approve or auto-reject from automated signals alone — always
    // land in manual_review. verificationCore.shouldForceManualReview() is
    // true whenever no real provider is configured (i.e. always, right now),
    // but the transition below is unconditional even once a provider exists —
    // Step 9 requires human review for every celebrity/high-profile/high-risk
    // claim, and this app has no reliable way to know in advance which
    // claims those are, so ALL claims go to manual_review.
    updated = await verificationCore.transitionStatus(supabase, request.id, 'automated_review', 'manual_review', {
      actor: 'system', detail: { faceResult: faceResult.result, livenessResult: livenessResult.result, manipulationResult: manipulationResult.result },
    });
    await verificationCore.syncArtistVerificationStatus(supabase, request.artist_id, request.id, 'manual_review');

    return res.json({
      requestId: request.id, status: updated.status,
      automatedResults: { faceMatch: faceResult.result, liveness: livenessResult.result, manipulationRisk: manipulationResult.result },
      note: 'Automated results are advisory only. A human reviewer will make the final decision.',
    });
  } catch (err) {
    console.error('[verification liveness submit]', err);
    return res.status(500).json({ error: 'Could not submit liveness video.' });
  }
});

// POST /api/verification/:requestId/ownership-evidence
// Step 7 — the evidence that actually proves control of the artist page.
// Body varies by evidenceType:
//   website_code / social_code -> { evidenceType, url }  (server checks for the issued code)
//   official_email_reply, distributor_link, authorization_doc, verified_collaborator_confirm
//     -> { evidenceType, detail }  (reviewer-verified manually; detail is freeform context)
app.post('/api/verification/:requestId/ownership-evidence', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  const { evidenceType, url, detail } = req.body || {};
  const VALID_TYPES = ['website_code', 'social_code', 'official_email_reply', 'distributor_link', 'authorization_doc', 'verified_collaborator_confirm'];
  if (!VALID_TYPES.includes(evidenceType)) return res.status(400).json({ error: 'Invalid evidence type.' });

  try {
    const request = await getOwnedRequest(req.params.requestId, sess.username);
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });

    let evidenceDetail = { ...(detail && typeof detail === 'object' ? detail : {}) };
    let autoVerified = false;

    if (evidenceType === 'website_code' || evidenceType === 'social_code') {
      if (!url) return res.status(400).json({ error: 'A URL is required for this evidence type.' });
      const code = verificationCore.generateOwnershipCode();
      // If the applicant is submitting (not just requesting) a code, we need
      // the code to have been issued first — issue-then-check in one call by
      // reusing any previously issued code stored in ownership_evidence_detail.
      const existingCode = request.ownership_evidence_detail?.issuedCode;
      const codeToCheck = existingCode || code;
      if (!existingCode) {
        // First call: issue the code, don't check yet — applicant needs time to paste it in.
        await supabase.from('artist_verification_requests').update({
          ownership_evidence_type: evidenceType,
          ownership_evidence_detail: { issuedCode: code, url, checkedAt: null, found: false },
        }).eq('id', request.id);
        return res.json({ requestId: request.id, issuedCode: code, instructions: `Add this code to ${url}, then call this endpoint again to verify.` });
      }
      const checkResult = await verificationCore.checkWebsiteForCode(url, codeToCheck);
      evidenceDetail = { issuedCode: codeToCheck, url, checkedAt: new Date().toISOString(), found: checkResult.found, error: checkResult.error };
      autoVerified = checkResult.found;
    } else {
      evidenceDetail.submittedAt = new Date().toISOString();
    }

    const patch = { ownership_evidence_type: evidenceType, ownership_evidence_detail: evidenceDetail };
    if (autoVerified) patch.ownership_verified_at = new Date().toISOString();
    await supabase.from('artist_verification_requests').update(patch).eq('id', request.id);
    await verificationCore.logAction(supabase, {
      requestId: request.id, actor: sess.username, action: 'ownership_evidence_submitted', detail: { evidenceType, autoVerified },
    });
    if (autoVerified) {
      await verificationCore.logAction(supabase, { requestId: request.id, actor: 'system', action: 'ownership_evidence_verified', detail: { evidenceType } });
    }

    return res.json({ requestId: request.id, evidenceType, autoVerified, detail: evidenceDetail });
  } catch (err) {
    console.error('[verification ownership evidence]', err);
    return res.status(500).json({ error: 'Could not record ownership evidence.' });
  }
});

// GET /api/verification/:requestId  — applicant's own view of their request
// (status + non-sensitive fields; never returns document bytes or raw evidence).
app.get('/api/verification/:requestId', rateLimit, requireFeatureAllowed('artist_pages'), async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const request = await getOwnedRequest(req.params.requestId, sess.username);
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });
    return res.json({
      id: request.id, artistId: request.artist_id, status: request.status,
      role: request.role, legalName: request.legal_name, stageName: request.stage_name,
      contactEmail: request.contact_email, emailVerifiedAt: request.email_verified_at,
      consentGivenAt: request.consent_given_at,
      hasIdDocument: !!request.id_document_file_id, hasSelfie: !!request.selfie_file_id, hasLivenessVideo: !!request.liveness_video_file_id,
      livenessAttemptCount: request.liveness_attempt_count,
      ownershipEvidenceType: request.ownership_evidence_type, ownershipVerifiedAt: request.ownership_verified_at,
      decision: request.decision, decisionReason: request.decision_reason, decisionAt: request.decision_at,
      createdAt: request.created_at, updatedAt: request.updated_at,
    });
  } catch (err) {
    console.error('[verification get]', err);
    return res.status(500).json({ error: 'Could not load verification request.' });
  }
});

// POST /api/verification/:requestId/appeal
// Lets an applicant whose request was rejected start a new linked request
// rather than mutating the rejected one — preserves full history per-appeal.
app.post('/api/verification/:requestId/appeal', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const original = await getOwnedRequest(req.params.requestId, sess.username);
    if (!original) return res.status(404).json({ error: 'Verification request not found.' });
    if (original.status !== 'rejected') return res.status(409).json({ error: 'Only rejected requests can be appealed.' });

    const rl = await verificationCore.checkAndBumpRateLimit(supabase, sess.username);
    if (!rl.allowed) return res.status(429).json({ error: 'Too many verification attempts. Please try again later.', retryAfterMs: rl.retryAfterMs });

    const { data: appeal, error } = await supabase.from('artist_verification_requests').insert({
      artist_id: original.artist_id, applicant_username: sess.username,
      role: original.role, legal_name: original.legal_name, stage_name: original.stage_name,
      contact_email: original.contact_email, contact_email_domain_risk: original.contact_email_domain_risk,
      official_links: original.official_links, status: 'email_pending',
      appeal_of_request_id: original.id,
    }).select().single();
    if (error) throw new Error(error.message);

    await verificationCore.syncArtistVerificationStatus(supabase, original.artist_id, appeal.id, 'email_pending');
    await verificationCore.logAction(supabase, { requestId: appeal.id, actor: sess.username, action: 'appeal_submitted', detail: { originalRequestId: original.id } });

    // Even though the original request's email was already confirmed once,
    // this is a NEW request row with its own email_pending status — generate
    // a fresh token same as /verification/start, so the frontend can send a
    // real confirmation email via emailjs.send() rather than leaving the
    // appeal stuck at email_pending with no way to progress.
    const rawToken = verificationCore.generateVerificationToken();
    await supabase.from('artist_verification_requests').update({
      email_verification_token_hash: verificationCore.hashToken(rawToken),
      email_verification_expires_at: new Date(Date.now() + verificationCore.EMAIL_TOKEN_TTL_HOURS * 3600 * 1000).toISOString(),
    }).eq('id', appeal.id);

    const { data: appealArtist } = await supabase.from('artists').select('name').eq('id', original.artist_id).maybeSingle();
    const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?requestId=${appeal.id}&token=${rawToken}`;
    await verificationCore.logAction(supabase, { requestId: appeal.id, actor: 'system', action: 'email_sent', detail: { to: original.contact_email, kind: 'appeal' } });

    return res.status(201).json({
      requestId: appeal.id, status: 'email_pending', appealOf: original.id,
      verifyUrl, artistName: appealArtist?.name || 'there', contactEmail: original.contact_email,
      expiresInHours: verificationCore.EMAIL_TOKEN_TTL_HOURS,
    });
  } catch (err) {
    console.error('[verification appeal]', err);
    return res.status(500).json({ error: 'Could not submit appeal.' });
  }
});

// ── Admin / reviewer routes ─────────────────────────────────────────────────

// GET /api/admin/verification/queue?status=manual_review&limit=&offset=
// Reviewer queue listing. Defaults to manual_review, the actionable state.
app.get('/api/admin/verification/queue', requireAdmin, async (req, res) => {
  const VALID_STATUSES = ['email_pending', 'evidence_required', 'liveness_pending', 'automated_review', 'manual_review', 'more_information_required', 'approved', 'rejected', 'revoked', 'expired'];
  const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : 'manual_review';
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const offset = Number(req.query.offset) || 0;
  try {
    const { data, error, count } = await supabase
      .from('artist_verification_requests')
      .select('id, artist_id, applicant_username, role, legal_name, stage_name, contact_email, contact_email_domain_risk, status, risk_score, face_match_result, liveness_result, manipulation_risk_result, ownership_evidence_type, ownership_verified_at, created_at, updated_at, artists!artist_verification_requests_artist_id_fkey(id, name, slug, is_verified)', { count: 'exact' })
      .eq('status', status)
      .order('created_at', { ascending: true }) // oldest first — FIFO queue
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return res.json({ requests: data, total: count, status, limit, offset });
  } catch (err) {
    console.error('[admin verification queue]', err);
    return res.status(500).json({ error: 'Could not load verification queue.' });
  }
});

// GET /api/admin/verification/:requestId
// Full reviewer detail view — everything Step 9 says the reviewer should see,
// EXCEPT raw document bytes (those come via the dedicated, logged document
// endpoint below so every access is auditable).
app.get('/api/admin/verification/:requestId', requireAdmin, async (req, res) => {
  try {
    const { data: request, error } = await supabase
      .from('artist_verification_requests')
      .select('*, artists!artist_verification_requests_artist_id_fkey(id, name, slug, is_verified, verification_status)')
      .eq('id', req.params.requestId).maybeSingle();
    if (error || !request) return res.status(404).json({ error: 'Verification request not found.' });

    const { data: history } = await supabase.from('verification_review_log').select('*').eq('request_id', request.id).order('created_at', { ascending: true });
    const { data: priorAttempts } = await supabase.from('artist_verification_requests')
      .select('id, status, decision, created_at').eq('artist_id', request.artist_id).neq('id', request.id).order('created_at', { ascending: false });
    const { data: documents } = await supabase.from('verification_documents')
      .select('id, doc_type, mime_type, size, uploaded_at, retained_until, deleted_at, last_accessed_by, last_accessed_at').eq('request_id', request.id);

    return res.json({ request, history: history || [], priorAttempts: priorAttempts || [], documents: documents || [] });
  } catch (err) {
    console.error('[admin verification detail]', err);
    return res.status(500).json({ error: 'Could not load verification request.' });
  }
});

// GET /api/admin/verification/documents/:documentId
// Decrypted document access for reviewers. Every call is logged
// (document_accessed) and stamps last_accessed_by/at — "prevent reviewers
// from downloading biometric files unless strictly required" is enforced by
// this being the ONLY path to plaintext bytes (no public/signed URL exists
// for this bucket) and every access being attributable to a specific admin.
// Streams the decrypted bytes directly rather than returning a reusable link.
app.get('/api/admin/verification/documents/:documentId', requireAdmin, async (req, res) => {
  try {
    const { buffer, mimeType, docType } = await verificationCore.getDecryptedDocumentForReview(supabase, req.params.documentId, req._adminSession.username);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${docType}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (err) {
    console.error('[admin verification document access]', err);
    return res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message || 'Could not load document.' });
  }
});

// POST /api/admin/verification/:requestId/note   { note }
// Reviewer notes, visible only to other reviewers (not returned by the
// applicant-facing GET /api/verification/:requestId route).
app.post('/api/admin/verification/:requestId/note', requireAdmin, async (req, res) => {
  const { note } = req.body || {};
  if (!note || !String(note).trim()) return res.status(400).json({ error: 'Note text is required.' });
  try {
    await verificationCore.logAction(supabase, {
      requestId: req.params.requestId, actor: req._adminSession.username, action: 'note_added', detail: { note: String(note).slice(0, 2000) },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin verification note]', err);
    return res.status(500).json({ error: 'Could not add note.' });
  }
});

// POST /api/admin/verification/:requestId/decide
// Step 9 decision. Body: { decision: 'approve'|'reject'|'more_info'|'escalate'|'suspend', reason }
// This is the ONLY route that can grant a verification badge — enforced by
// requireAdmin + the explicit state-machine transition, never by anything
// client-controlled.
app.post('/api/admin/verification/:requestId/decide', requireAdmin, async (req, res) => {
  const { decision, reason } = req.body || {};
  const VALID_DECISIONS = ['approve', 'reject', 'more_info', 'escalate', 'suspend'];
  if (!VALID_DECISIONS.includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });

  try {
    const { data: request } = await supabase.from('artist_verification_requests').select('*').eq('id', req.params.requestId).maybeSingle();
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });

    // Founder protection — same guard as the existing report-action route.
    const { data: artist } = await supabase.from('artists').select('account_id, name').eq('id', request.artist_id).maybeSingle();
    if ((decision === 'reject' || decision === 'suspend') && artist?.account_id?.toLowerCase() === 'slimey2017') {
      return res.status(403).json({ error: 'Cannot apply automated moderation to the platform founder account.' });
    }

    const reviewer = req._adminSession.username;
    let newStatus, decisionValue = null;

    if (decision === 'approve') {
      if (request.status !== 'manual_review') return res.status(409).json({ error: `Cannot approve from status ${request.status}.` });
      newStatus = 'approved'; decisionValue = 'approved';
    } else if (decision === 'reject') {
      if (request.status !== 'manual_review') return res.status(409).json({ error: `Cannot reject from status ${request.status}.` });
      newStatus = 'rejected'; decisionValue = 'rejected';
    } else if (decision === 'more_info') {
      if (request.status !== 'manual_review') return res.status(409).json({ error: `Cannot request more info from status ${request.status}.` });
      newStatus = 'more_information_required';
    } else if (decision === 'escalate') {
      newStatus = 'manual_review'; // stays in queue, logged as escalated for visibility
    } else if (decision === 'suspend') {
      if (request.status !== 'approved') return res.status(409).json({ error: 'Only approved verifications can be suspended.' });
      newStatus = 'revoked'; decisionValue = 'revoked';
    }

    const updated = await verificationCore.transitionStatus(supabase, request.id, request.status, newStatus, { actor: reviewer, detail: { decision, reason } });

    if (decisionValue) {
      await supabase.from('artist_verification_requests').update({
        decision: decisionValue, decision_reason: reason || null, decision_by: reviewer, decision_at: new Date().toISOString(),
      }).eq('id', request.id);
    }
    await verificationCore.syncArtistVerificationStatus(supabase, request.artist_id, request.id, newStatus);
    await verificationCore.logAction(supabase, { requestId: request.id, actor: reviewer, action: decision === 'suspend' ? 'suspended' : (decision === 'escalate' ? 'escalated' : newStatus === 'more_information_required' ? 'more_info_requested' : newStatus), detail: { reason } });

    // Notify the applicant (best-effort — failure here shouldn't undo the decision)
    try {
      await verificationCore.sendStatusUpdateEmail({ to: request.contact_email, artistName: artist?.name || 'your artist page', status: newStatus, reason });
    } catch (emailErr) {
      console.error('[verification decide] status email failed (non-fatal):', emailErr.message);
    }

    // The official in-app notice is also best-effort so a temporary notice
    // delivery issue can never roll back the reviewed verification decision.
    try {
      if (newStatus === 'approved') {
        await dbCreateFreqNotice({
          recipientUsername: request.applicant_username,
          createdBy: reviewer,
          templateKey: 'artist_verified',
          values: { artistId: request.artist_id },
          relatedResourceType: 'artist_verification_request',
          relatedResourceId: request.id,
          auditRequired: true,
        });
      } else {
        const noticeTitle = newStatus === 'more_information_required'
          ? 'FREQ Notice · Artist Verification Update'
          : newStatus === 'revoked'
            ? 'FREQ Notice · Artist Verification Revoked'
            : 'FREQ Notice · Artist Verification Decision';
        await dbCreateFreqNotice({
          recipientUsername: request.applicant_username,
          createdBy: reviewer,
          noticeType: 'artist_verification',
          severity: newStatus === 'revoked' ? 'warning' : (newStatus === 'more_information_required' ? 'action_required' : 'update'),
          title: noticeTitle,
          body: newStatus === 'more_information_required'
            ? `Your artist verification needs more information before a decision can be made.\n\n${reason || 'Open the verification workflow to continue.'}`
            : `Your artist verification status is now ${newStatus.replace(/_/g, ' ')}.\n\n${reason || 'Open the verification workflow for details.'}`,
          actions: [{ id: 'view_artist', label: 'View Artist Profile', kind: 'artist', resourceId: request.artist_id }],
          relatedResourceType: 'artist_verification_request',
          relatedResourceId: request.id,
          auditRequired: true,
        });
      }
    } catch (noticeErr) {
      console.error('[verification decide] FREQ Notice failed (non-fatal):', noticeErr.message);
    }

    return res.json({ requestId: request.id, status: updated.status, decision: decisionValue });
  } catch (err) {
    console.error('[admin verification decide]', err);
    return res.status(500).json({ error: err.message || 'Could not record decision.' });
  }
});

// DELETE /api/verification/:requestId/documents
// Applicant-initiated deletion request ("How the user can request deletion").
// Purges any stored evidence immediately rather than waiting for the
// retention window, and only allowed once the request has reached a terminal
// state (can't delete evidence a reviewer is actively evaluating).
app.delete('/api/verification/:requestId/documents', rateLimit, async (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const request = await getOwnedRequest(req.params.requestId, sess.username);
    if (!request) return res.status(404).json({ error: 'Verification request not found.' });
    if (!verificationCore.TERMINAL_STATUSES.has(request.status)) {
      return res.status(409).json({ error: 'Cannot delete evidence while a request is still being reviewed. Wait for a decision or contact support.' });
    }
    const ids = [request.id_document_file_id, request.selfie_file_id, request.liveness_video_file_id].filter(Boolean);
    for (const docId of ids) {
      await verificationCore.purgeDocument(supabase, docId, { reason: 'user_requested_deletion', actor: sess.username });
    }
    return res.json({ ok: true, purgedCount: ids.length });
  } catch (err) {
    console.error('[verification delete documents]', err);
    return res.status(500).json({ error: 'Could not delete documents.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY MANUAL OVERRIDE — kept for backward compatibility and as a founder/admin
// quick-toggle escape hatch (e.g. correcting a mistake without spinning up a full
// verification request). The full evidence-based pipeline above is the intended
// path for real artist verification claims; these two routes bypass it entirely
// and should be used sparingly and deliberately.
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/admin/artists/:id/verify
app.post('/api/admin/artists/:id/verify', requireAdmin, async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    await supabase.from('artists').update({ is_verified: true }).eq('id', artist.id);
    return res.json({ id: artist.id, isVerified: true });
  } catch (err) {
    console.error('[admin verify artist]', err);
    return res.status(500).json({ error: 'Could not verify artist.' });
  }
});

// DELETE /api/admin/artists/:id/verify
app.delete('/api/admin/artists/:id/verify', requireAdmin, async (req, res) => {
  try {
    const artist = await resolveArtistFromParam(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });
    await supabase.from('artists').update({ is_verified: false }).eq('id', artist.id);
    return res.json({ id: artist.id, isVerified: false });
  } catch (err) {
    console.error('[admin unverify artist]', err);
    return res.status(500).json({ error: 'Could not unverify artist.' });
  }
});

// ── Part 15: admin content-rating override/lock/history ────────────────────
// Replaces the old PATCH /api/admin/tracks/:trackId/explicit bridge (no
// frontend ever called it — grep confirms zero call sites — so it's retired
// outright rather than kept as a compat alias). These three routes are the
// real "Override ratings / Lock ratings / View rating history" surface.

// GET /api/admin/tracks/:trackId/rating — metadata for the moderation UI.
// This deliberately stays admin-only even though parts of the same track
// shape are public elsewhere: lock actor/time and reason tags are moderation
// data, not catalog metadata.
app.get('/api/admin/tracks/:trackId/rating', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks')
      .select('id, title, artist_id, artist_name, content_rating, content_rating_tags, content_rating_locked, content_rating_locked_by, content_rating_locked_at')
      .eq('id', req.params.trackId).maybeSingle();
    if (error || !data) return res.status(404).json({ error: 'Track not found.' });
    return res.json({
      track: {
        id: data.id,
        title: data.title || 'Untitled track',
        artistId: data.artist_id || null,
        artistName: data.artist_name || null,
        contentRating: data.content_rating || 'clean',
        contentRatingTags: data.content_rating_tags || [],
        contentRatingLocked: !!data.content_rating_locked,
        lockedBy: data.content_rating_locked_by || null,
        lockedAt: data.content_rating_locked_at || null,
      },
    });
  } catch (err) {
    console.error('[admin rating get]', err);
    return res.status(500).json({ error: 'Could not load track rating.' });
  }
});

// PATCH /api/admin/tracks/:trackId/rating — admin sets content_rating
// directly, bypassing the artist-facing content_rating_locked check in
// PATCH /api/tracks/:trackId (that check only blocks the ARTIST; an admin
// with this route is exactly how a locked rating gets corrected). Every
// call logs to content_rating_history with action 'overridden_by_admin' so
// Part 15's "View rating history" has a full trail. If the track sits in a
// release, that release's derived rating is recomputed afterward.
app.patch('/api/admin/tracks/:trackId/rating', requireAdmin, async (req, res) => {
  const { contentRating, reason } = req.body || {};
  if (!isValidContentRating(contentRating)) {
    return res.status(400).json({ error: '"contentRating" must be one of: clean, parental_guidance, adult.' });
  }
  try {
    const { data: existing } = await supabase.from('tracks').select('id, content_rating').eq('id', req.params.trackId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Track not found.' });

    const { data, error } = await supabase.from('tracks')
      .update({
        content_rating: contentRating,
        is_explicit: contentRating !== 'clean',
        content_rating_set_at: new Date().toISOString(),
      })
      .eq('id', req.params.trackId).select().single();
    if (error || !data) return res.status(404).json({ error: 'Track not found.' });

    await supabase.from('content_rating_history').insert({
      track_id: data.id, actor: req._adminSession.username, action: 'overridden_by_admin',
      previous_rating: existing.content_rating, new_rating: contentRating,
      reason: (typeof reason === 'string' && reason.trim()) ? reason.trim().slice(0, 500) : null,
    });

    const { data: links } = await supabase.from('artist_release_tracks').select('release_id').eq('track_id', data.id);
    for (const link of links || []) {
      await recomputeReleaseContentRating(link.release_id);
    }

    return res.json({
      id: data.id, contentRating: data.content_rating, isExplicit: data.is_explicit,
      contentRatingLocked: !!data.content_rating_locked,
    });
  } catch (err) {
    console.error('[admin rating override]', err);
    return res.status(500).json({ error: 'Could not update track rating.' });
  }
});

// PATCH /api/admin/tracks/:trackId/rating-lock — Part 15 "Lock ratings":
// locked:true freezes content_rating against further artist edits (PATCH
// /api/tracks/:trackId 403s on the artist side while locked); locked:false
// releases it back to the artist. Locking never changes the rating itself —
// pair with the override route above if a correction is also needed.
app.patch('/api/admin/tracks/:trackId/rating-lock', requireAdmin, async (req, res) => {
  const { locked } = req.body || {};
  try {
    const patch = locked
      ? { content_rating_locked: true, content_rating_locked_by: req._adminSession.username, content_rating_locked_at: new Date().toISOString() }
      : { content_rating_locked: false, content_rating_locked_by: null, content_rating_locked_at: null };
    const { data, error } = await supabase.from('tracks')
      .update(patch).eq('id', req.params.trackId).select().single();
    if (error || !data) return res.status(404).json({ error: 'Track not found.' });

    await supabase.from('content_rating_history').insert({
      track_id: data.id, actor: req._adminSession.username,
      action: locked ? 'locked_by_admin' : 'unlocked_by_admin',
      previous_rating: data.content_rating, new_rating: data.content_rating, reason: null,
    });

    return res.json({
      id: data.id, contentRatingLocked: !!data.content_rating_locked,
      lockedBy: data.content_rating_locked_by, lockedAt: data.content_rating_locked_at,
    });
  } catch (err) {
    console.error('[admin rating lock]', err);
    return res.status(500).json({ error: 'Could not update rating lock.' });
  }
});

// GET /api/admin/tracks/:trackId/rating-history — full audit trail for
// Part 15's "View rating history": every set_by_artist (publish),
// changed_by_artist (artist edit), overridden_by_admin, locked_by_admin,
// and unlocked_by_admin row, newest first.
app.get('/api/admin/tracks/:trackId/rating-history', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('content_rating_history')
      .select('*').eq('track_id', req.params.trackId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return res.json({
      history: (data || []).map(h => ({
        id: h.id, actor: h.actor, action: h.action,
        previousRating: h.previous_rating, newRating: h.new_rating,
        reason: h.reason, createdAt: h.created_at,
      })),
    });
  } catch (err) {
    console.error('[admin rating history]', err);
    return res.status(500).json({ error: 'Could not load rating history.' });
  }
});

// GET /api/admin/releases/:releaseId — admin-only lookup for moderation
// "View Target" on a release report needs the artist to navigate to their page.
app.get('/api/admin/releases/:releaseId', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('artist_releases')
      .select('id, title, release_type, artist_id, artists(id, slug, name)')
      .eq('id', req.params.releaseId)
      .maybeSingle();
    if (error || !data) return res.status(404).json({ error: 'Release not found.' });
    return res.json({
      id: data.id, title: data.title, releaseType: data.release_type,
      artistId: data.artist_id,
      artistSlug: data.artists?.slug || null,
      artistName: data.artists?.name || null,
    });
  } catch (err) {
    console.error('[admin releases get]', err);
    return res.status(500).json({ error: 'Could not load release.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
//  FREQ MESSAGING · GROUPS · PROJECT ROOMS · OFFICIAL NOTICES
// ═══════════════════════════════════════════════════════════════════════════

const FREQ_PRIVATE_MESSAGING_BUCKET = 'freq-private-messaging';
const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
const MESSAGE_HISTORY_PAGE_MAX = 60;
const MESSAGE_SIGNED_URL_TTL_SECONDS = 5 * 60;
const MESSAGE_CAPABILITIES = Object.freeze([
  'can_publish_music','can_create_posts','can_send_messages','can_create_groups','can_upload_files',
  'can_use_dj_boom','can_comment','can_follow','can_earn_mp','can_purchase_items',
]);
const MESSAGE_MEMBER_ROLES = new Set(['owner','admin','moderator','member','read_only']);
const PROJECT_MEMBER_ROLES = new Set(['project_owner','artist','featured_artist','producer','engineer','writer','manager','designer','viewer']);
const GROUP_MANAGER_ROLES = new Set(['owner','admin']);
const GROUP_MODERATOR_ROLES = new Set(['owner','admin','moderator']);
const PROJECT_UPLOAD_ROLES = new Set(['project_owner','artist','featured_artist','producer','engineer','writer','manager','designer']);
const messageActionHits = new Map();
const messageTypingState = new Map();
let messagingSchemaWarningLogged = false;

function requestToken(req) {
  return (req.headers.authorization || '').replace('Bearer ', '') || req.body?.token || req.query?.token || '';
}

function defaultAccountCapabilities() {
  return Object.fromEntries(MESSAGE_CAPABILITIES.map(key => [key, true]));
}

async function dbGetEffectiveAccountCapabilities(username) {
  const defaults = { ...defaultAccountCapabilities(), restrictionIds: [], primaryRestrictionId: null, severity: null, endsAt: null };
  if (!username) return defaults;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('account_restrictions')
    .select(`id, severity, ends_at, ${MESSAGE_CAPABILITIES.join(', ')}`)
    .eq('username', username)
    .eq('active', true)
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order('created_at', { ascending: false });
  if (error) {
    // Code can be deployed before the accompanying SQL migration without
    // breaking playback. Only a genuinely missing messaging table fails open;
    // any other database error fails closed in the caller.
    if (['42P01','PGRST205','PGRST204'].includes(error.code)) {
      if (!messagingSchemaWarningLogged) {
        console.warn('[messaging] SQL migration not applied yet; account capability checks are using allow defaults.');
        messagingSchemaWarningLogged = true;
      }
      return defaults;
    }
    throw new Error(error.message);
  }
  const rows = data || [];
  for (const row of rows) {
    for (const capability of MESSAGE_CAPABILITIES) {
      if (row[capability] === false) defaults[capability] = false;
    }
  }
  defaults.restrictionIds = rows.map(row => row.id);
  defaults.primaryRestrictionId = rows[0]?.id || null;
  defaults.severity = rows[0]?.severity || null;
  defaults.endsAt = rows.map(row => row.ends_at).filter(Boolean).sort()[0] || null;
  return defaults;
}

async function requireMessagingSession(req, res, { capability = null, verifiedEmail = false } = {}) {
  const sess = req._session || await dbGetSession(requestToken(req));
  if (!sess) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  if (verifiedEmail && !sess.emailVerified) {
    res.status(403).json({ error: 'Please verify your email address to use FREQ messaging.', emailVerificationRequired: true });
    return null;
  }
  if (capability) {
    const effective = req._accountCapabilities || await dbGetEffectiveAccountCapabilities(sess.username);
    if (effective[capability] === false) {
      res.status(403).json({
        error: 'This account feature is currently restricted. Check FREQ Notices for details.',
        code: 'account_feature_restricted', capability,
        restrictionId: effective.primaryRestrictionId || null,
        severity: effective.severity || null, endsAt: effective.endsAt || null,
      });
      return null;
    }
  }
  return sess;
}

function hitMessagingRateLimit(username, action, windowMs, max) {
  const now = Date.now();
  const key = `${username}:${action}`;
  const fresh = (messageActionHits.get(key) || []).filter(time => now - time < windowMs);
  fresh.push(now);
  messageActionHits.set(key, fresh);
  return fresh.length > max;
}

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, times] of messageActionHits) {
    const fresh = times.filter(time => time >= cutoff);
    if (fresh.length) messageActionHits.set(key, fresh); else messageActionHits.delete(key);
  }
  const typingCutoff = Date.now() - 12_000;
  for (const [key, value] of messageTypingState) if (value.updatedAt < typingCutoff) messageTypingState.delete(key);
}, 5 * 60 * 1000);

function normalizeMessageText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, 4000);
}

function containsExternalLink(value) {
  return /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|gg|co)\b)/i.test(String(value || ''));
}

async function dbAreUsersBlocked(a, b) {
  if (!a || !b) return false;
  const [{ data: first, error: firstError }, { data: second, error: secondError }] = await Promise.all([
    supabase.from('user_blocks').select('blocker_username').eq('blocker_username', a).eq('blocked_username', b).maybeSingle(),
    supabase.from('user_blocks').select('blocker_username').eq('blocker_username', b).eq('blocked_username', a).maybeSingle(),
  ]);
  if (firstError || secondError) throw new Error((firstError || secondError).message);
  return !!(first || second);
}

async function dbGetMessageSettings(username) {
  const { data, error } = await supabase.from('user_message_settings').select('*').eq('username', username).maybeSingle();
  if (error) throw new Error(error.message);
  return data || {
    username, dm_privacy: 'following', artist_dm_privacy: 'followers', group_invites: 'following',
    collaboration_requests: 'verified_artists', read_receipts: true, typing_indicators: true,
    online_status: 'connections', file_downloads: 'ask',
  };
}

async function dbGetConversationAccess(conversationId, username) {
  const [{ data: conversation, error: conversationError }, { data: membership, error: membershipError }] = await Promise.all([
    supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle(),
    supabase.from('conversation_members').select('*').eq('conversation_id', conversationId).eq('username', username).maybeSingle(),
  ]);
  if (conversationError || membershipError) throw new Error((conversationError || membershipError).message);
  if (!conversation || !membership || membership.status !== 'active') return null;
  return { conversation, membership };
}

async function dbGetConversationMembers(conversationId, { activeOnly = true } = {}) {
  let query = supabase.from('conversation_members').select('*').eq('conversation_id', conversationId).order('joined_at');
  if (activeOnly) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function dbGetUserCards(usernames) {
  const names = [...new Set((usernames || []).filter(Boolean))];
  if (!names.length) return new Map();
  const [{ data: profiles, error: profileError }, { data: artists, error: artistError }] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url').in('username', names),
    supabase.from('artists').select('id, account_id, name, avatar_url, slug, is_verified, verification_status').in('account_id', names),
  ]);
  if (profileError || artistError) throw new Error((profileError || artistError).message);
  const profileMap = new Map((profiles || []).map(row => [row.username, row]));
  const artistMap = new Map((artists || []).map(row => [row.account_id, row]));
  return new Map(names.map(username => {
    const profile = profileMap.get(username) || {};
    const artist = artistMap.get(username) || null;
    const verifiedArtist = !!(artist?.is_verified && artist?.verification_status === 'approved');
    return [username, {
      username,
      displayName: artist?.name || profile.display_name || username,
      avatarUrl: artist?.avatar_url || profile.avatar_url || null,
      artistId: artist?.id || null,
      artistSlug: artist?.slug || null,
      isArtist: !!artist,
      isVerifiedArtist: verifiedArtist,
    }];
  }));
}

async function dbFollowRelationship(sender, recipient) {
  const [{ data: senderFollows }, { data: recipientFollows }] = await Promise.all([
    supabase.from('follows').select('follower_username').eq('follower_username', sender).eq('followed_username', recipient).maybeSingle(),
    supabase.from('follows').select('follower_username').eq('follower_username', recipient).eq('followed_username', sender).maybeSingle(),
  ]);
  return { senderFollows: !!senderFollows, recipientFollows: !!recipientFollows, mutual: !!(senderFollows && recipientFollows) };
}

async function dbCanRequestDirect(senderUsername, recipientUsername) {
  if (senderUsername === recipientUsername) return { allowed: false, reason: 'You cannot message yourself.' };
  if (await dbAreUsersBlocked(senderUsername, recipientUsername)) return { allowed: false, reason: 'Messaging is unavailable for this account.' };
  const [settings, relationship, { data: recipientArtist }, { data: senderAccount }] = await Promise.all([
    dbGetMessageSettings(recipientUsername),
    dbFollowRelationship(senderUsername, recipientUsername),
    supabase.from('artists').select('id, account_id, is_verified, verification_status').eq('account_id', recipientUsername).maybeSingle(),
    supabase.from('accounts').select('is_premium').eq('username', senderUsername).maybeSingle(),
  ]);
  if (recipientArtist) {
    const mode = settings.artist_dm_privacy;
    if (mode === 'disabled') return { allowed: false, reason: 'This artist is not accepting messages.' };
    const { data: followsArtist } = await supabase.from('artist_followers').select('artist_id')
      .eq('artist_id', recipientArtist.id).eq('follower_username', senderUsername).maybeSingle();
    if (mode === 'followers' && !followsArtist) return { allowed: false, reason: 'This artist accepts requests from followers.' };
    if (mode === 'mutual' && !relationship.mutual) return { allowed: false, reason: 'This artist accepts requests from mutual followers.' };
    if (mode === 'supporters_premium' && !senderAccount?.is_premium) return { allowed: false, reason: 'This artist accepts requests from supporters or Premium members.' };
  } else {
    const mode = settings.dm_privacy;
    if (mode === 'nobody') return { allowed: false, reason: 'This person is not accepting message requests.' };
    if (mode === 'following' && !relationship.recipientFollows) return { allowed: false, reason: 'This person accepts requests from people they follow.' };
    if (mode === 'mutual' && !relationship.mutual) return { allowed: false, reason: 'This person accepts requests from mutual followers.' };
  }
  // Unknown users enter Requests. Either direction of follow is enough to
  // treat the connection as known and open the thread immediately.
  return { allowed: true, requestRequired: !(relationship.senderFollows || relationship.recipientFollows), recipientArtist: !!recipientArtist };
}

async function resolveSharedContent(req, sharedType, sharedId) {
  if (!sharedType && !sharedId) return null;
  const type = String(sharedType || '').toLowerCase();
  const id = String(sharedId || '').trim();
  if (!['song','album','ep','single','playlist','artist','video','post'].includes(type) || !id) {
    throw Object.assign(new Error('Choose valid FREQ content to share.'), { httpStatus: 400 });
  }
  if (type === 'song') {
    const { data, error } = await supabase.from('tracks')
      .select('id, title, artist_name, artist_id, cover_url, is_published, content_rating, cloud_file_id')
      .eq('id', id).maybeSingle();
    if (error || !data || !(await isTrackVisibleForRequest(req, data))) throw new Error('That song is not available to share.');
    return { type, id, snapshot: { title: data.title || 'Untitled', artist: data.artist_name || 'Unknown Artist', artwork: data.cover_url || null, releaseType: 'Song', artistId: data.artist_id || null, mpEligible: false } };
  }
  if (['album','ep','single'].includes(type)) {
    const { data, error } = await supabase.from('artist_releases')
      .select('id, title, release_type, cover_url, artist_id, visibility, content_rating, artists(name, slug)')
      .eq('id', id).maybeSingle();
    if (error || !data || data.visibility !== 'public' || data.release_type !== type) throw new Error('That release is not available to share.');
    const allowedRatings = await getAllowedRatingsForRequest(req);
    if (!allowedRatings.includes(data.content_rating || 'clean')) throw new Error('That release is hidden by your playback filters.');
    return { type, id, snapshot: { title: data.title, artist: data.artists?.name || 'Unknown Artist', artistSlug: data.artists?.slug || null, artwork: data.cover_url || null, releaseType: type.toUpperCase(), artistId: data.artist_id } };
  }
  if (type === 'playlist') {
    const { data, error } = await supabase.from('playlists_v2').select('id, name, owner, description, cover_url, track_count, is_public').eq('id', id).maybeSingle();
    if (error || !data || !data.is_public) throw new Error('Only public playlists can be shared.');
    return { type, id, snapshot: { title: data.name, artist: data.owner, artwork: data.cover_url || null, releaseType: 'Playlist', trackCount: data.track_count || 0 } };
  }
  if (type === 'artist') {
    const artist = await resolveArtistFromParam(id);
    if (!artist) throw new Error('That artist is not available to share.');
    return { type, id: artist.id, snapshot: { title: artist.name, artist: artist.name, artwork: artist.avatar_url || null, releaseType: 'Artist', artistSlug: artist.slug, verified: !!(artist.is_verified && artist.verification_status === 'approved') } };
  }
  if (type === 'video') {
    const { data, error } = await supabase.from('track_videos').select('id, track_id, thumbnail_url, tracks(title, artist_name, cover_url, is_published)').eq('id', id).maybeSingle();
    if (error || !data || !data.tracks?.is_published) throw new Error('That video is not available to share.');
    return { type, id, snapshot: { title: data.tracks.title || 'Music Video', artist: data.tracks.artist_name || 'Unknown Artist', artwork: data.thumbnail_url || data.tracks.cover_url || null, releaseType: 'Video', trackId: data.track_id } };
  }
  const { data: post, error } = await supabase.from('posts').select('id, author, body, post_type, track_id, playlist_id, artist_id, release_id').eq('id', id).maybeSingle();
  if (error || !post) throw new Error('That post is not available to share.');
  return { type, id, snapshot: { title: `${post.author}'s post`, artist: post.author, artwork: null, releaseType: 'Post', preview: String(post.body || '').slice(0, 180), postType: post.post_type } };
}

async function enforceMessageSpamRules(username, body, { isRequest = false } = {}) {
  if (hitMessagingRateLimit(username, isRequest ? 'request' : 'message', 60_000, isRequest ? 4 : 35)) {
    throw Object.assign(new Error('You are sending messages too quickly. Take a beat and try again.'), { httpStatus: 429 });
  }
  const normalized = normalizeMessageText(body).toLowerCase();
  if (!normalized) return;
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('messages').select('body')
    .eq('sender_username', username).gte('created_at', cutoff).is('deleted_at', null).limit(20);
  if (error) throw new Error(error.message);
  const duplicates = (data || []).filter(row => normalizeMessageText(row.body).toLowerCase() === normalized).length;
  if (duplicates >= 2) throw Object.assign(new Error('That same message was already sent. Change it up before trying again.'), { httpStatus: 429 });
}

function detectPrivateAttachment(file, { allowAudio = false, allowZip = false, allowDocuments = false } = {}) {
  if (!file?.buffer?.length) throw Object.assign(new Error('No file received.'), { httpStatus: 400 });
  const buffer = file.buffer;
  const name = String(file.originalname || 'file').slice(0, 255);
  const ext = path.extname(name).toLowerCase();
  const head = buffer.subarray(0, 16);
  const ascii = head.toString('ascii');
  const hex = head.toString('hex');
  let kind = null;
  let mime = null;
  if (hex.startsWith('89504e470d0a1a0a') && ext === '.png') { kind = 'image'; mime = 'image/png'; }
  else if (hex.startsWith('ffd8ff') && ['.jpg','.jpeg'].includes(ext)) { kind = 'image'; mime = 'image/jpeg'; }
  else if ((ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) && ext === '.gif') { kind = 'image'; mime = 'image/gif'; }
  else if (ascii.startsWith('RIFF') && buffer.subarray(8, 12).toString('ascii') === 'WEBP' && ext === '.webp') { kind = 'image'; mime = 'image/webp'; }
  else if (hex.startsWith('1a45dfa3') && ext === '.webm') { kind = 'video'; mime = 'video/webm'; }
  else if (buffer.subarray(4, 8).toString('ascii') === 'ftyp' && ext === '.mp4') { kind = 'video'; mime = 'video/mp4'; }
  else if (ascii.startsWith('%PDF-') && ext === '.pdf' && allowDocuments) { kind = 'pdf'; mime = 'application/pdf'; }
  else if ((hex.startsWith('504b0304') || hex.startsWith('504b0506') || hex.startsWith('504b0708')) && ext === '.zip' && allowZip) { kind = 'zip'; mime = 'application/zip'; }
  else if (ext === '.txt' && allowDocuments && !buffer.includes(0)) {
    const roundTrip = Buffer.from(buffer.toString('utf8'), 'utf8');
    if (roundTrip.length !== buffer.length) throw Object.assign(new Error('Text file encoding is not valid UTF-8.'), { httpStatus: 400 });
    kind = 'text'; mime = 'text/plain';
  }
  const audioExtension = ['.mp3','.wav','.flac','.m4a','.aac','.ogg'].includes(ext);
  if (!kind && allowAudio && audioExtension) return { kind: 'audio', mime: file.mimetype || guessMimeFromName(name), extension: ext, name };
  if (!kind) throw Object.assign(new Error('This file type or file signature is not allowed here.'), { httpStatus: 400 });
  return { kind, mime, extension: ext, name };
}

async function dbMessageEligibleTrackIds(req, username, trackIds) {
  const ids = new Set(trackIds || []);
  if (!ids.size) return new Set();
  try {
    const allowedRatings = await getAllowedRatingsForRequest(req);
    const result = await dbGetListenToEarnOffers(username, allowedRatings, 100);
    return new Set((result.offers || []).filter(row => ids.has(row.id)).map(row => row.id));
  } catch (error) {
    console.warn('[messaging MP eligibility]', error.message);
    return new Set();
  }
}

async function shapeMessagesForClient(req, sess, rows, { hideReceipts = false } = {}) {
  const messages = rows || [];
  if (!messages.length) return [];
  const ids = messages.map(row => row.id);
  const senders = [...new Set(messages.map(row => row.sender_username))];
  const songIds = messages.filter(row => row.shared_type === 'song').map(row => row.shared_id);
  const [userCards, reactionResult, attachmentResult, readResult, eligibleSongIds] = await Promise.all([
    dbGetUserCards(senders),
    supabase.from('message_reactions').select('message_id, username, emoji').in('message_id', ids),
    supabase.from('message_attachments').select('id, message_id, original_filename, detected_kind, detected_mime_type, size_bytes, scan_status, rights_review_id').in('message_id', ids),
    hideReceipts ? Promise.resolve({ data: [], error: null }) : supabase.from('message_reads').select('message_id, username, read_at').in('message_id', ids),
    dbMessageEligibleTrackIds(req, sess.username, songIds),
  ]);
  const anyError = reactionResult.error || attachmentResult.error || readResult.error;
  if (anyError) throw new Error(anyError.message);
  const reactionsByMessage = new Map();
  for (const row of reactionResult.data || []) {
    const list = reactionsByMessage.get(row.message_id) || [];
    list.push({ username: row.username, emoji: row.emoji });
    reactionsByMessage.set(row.message_id, list);
  }
  const attachmentsByMessage = new Map();
  for (const row of attachmentResult.data || []) {
    const list = attachmentsByMessage.get(row.message_id) || [];
    list.push({ id: row.id, filename: row.original_filename, kind: row.detected_kind, mimeType: row.detected_mime_type, size: Number(row.size_bytes), scanStatus: row.scan_status, rightsReviewId: row.rights_review_id });
    attachmentsByMessage.set(row.message_id, list);
  }
  const readsByMessage = new Map();
  for (const row of readResult.data || []) {
    const list = readsByMessage.get(row.message_id) || [];
    list.push({ username: row.username, readAt: row.read_at });
    readsByMessage.set(row.message_id, list);
  }
  return messages.map(row => {
    const deleted = !!row.deleted_at;
    const shared = deleted || !row.shared_type ? null : {
      type: row.shared_type, id: row.shared_id,
      ...row.shared_snapshot,
      mpEligible: row.shared_type === 'song' ? eligibleSongIds.has(row.shared_id) : false,
    };
    return {
      id: row.id, conversationId: row.conversation_id, sender: userCards.get(row.sender_username) || { username: row.sender_username },
      kind: row.kind, body: deleted ? null : row.body, replyToMessageId: row.reply_to_message_id,
      shared, attachments: deleted ? [] : (attachmentsByMessage.get(row.id) || []),
      reactions: reactionsByMessage.get(row.id) || [], reads: hideReceipts ? [] : (readsByMessage.get(row.id) || []),
      editedAt: row.edited_at, deletedAt: row.deleted_at, pinnedAt: row.pinned_at,
      createdAt: row.created_at, isMine: row.sender_username === sess.username,
      canEdit: row.sender_username === sess.username && !deleted && Date.now() - new Date(row.created_at).getTime() <= MESSAGE_EDIT_WINDOW_MS,
    };
  });
}

function buildFreqNoticeTemplate(templateKey, values = {}) {
  const reason = String(values.reason || 'A FREQ policy was not followed.').slice(0, 4000);
  const timeLeft = values.timeRemaining || (values.endsAt ? `Until ${new Date(values.endsAt).toLocaleString('en-US')}` : 'Until further notice');
  const templates = {
    temporary_restriction: {
      noticeType: 'restriction', severity: 'temporary_restriction', title: 'FREQ Notice · Temporary Restriction', auditRequired: true,
      body: `Looks like things got a little out of tune. 🎵\n\nReason:\n${reason}\n\nFREQ is supposed to be a healthy community, not a war zone, so some account features have been temporarily restricted.\n\nTime remaining:\n${timeLeft}\n\nYou may still be able to:\n• Listen to music\n• Browse public posts\n• Earn MP when eligible\n• Use the Musi-Shop\n• Like songs, albums, and posts\n\nRestricted features are listed in the decision details. A joke should never hide the reason, time, or appeal rights.\n\nWe hope you come back ready to keep the vibes healthy. Have a good day.`,
      actions: values.appealAllowed === false ? [] : [{ id: 'appeal', label: 'Appeal Restriction', kind: 'appeal', resourceId: values.restrictionId || null }],
    },
    artist_verified: { noticeType: 'artist_verification', severity: 'update', title: 'FREQ Notice · Artist Verified', body: 'Your artist verification request was approved.', actions: [{ id: 'view_artist', label: 'View Artist Profile', kind: 'artist', resourceId: values.artistId || null }] },
    rights_action_required: { noticeType: 'rights_review', severity: 'action_required', title: 'FREQ Notice · Action Required', body: 'Your release needs additional rights information before it can be published.', actions: [{ id: 'view_rights', label: 'View Rights Check', kind: 'rights', resourceId: values.resourceId || null }] },
    mp_adjustment: { noticeType: 'mp_adjustment', severity: 'update', title: 'FREQ Notice · Musi-Pixels Updated', body: `Your MP balance was adjusted by ${values.amount || 0}.\n\nReason:\n${reason}`, actions: [{ id: 'view_mp', label: 'View MP History', kind: 'mp_history' }] },
    security_alert: { noticeType: 'security', severity: 'security_alert', title: 'FREQ Notice · Security Alert', body: 'A new login was detected on your FREQ account.', actions: [{ id: 'account_activity', label: 'Review Account Activity', kind: 'account_activity' }] },
    appeal_decision: { noticeType: 'appeal_decision', severity: 'update', title: 'FREQ Notice · Appeal Decision', body: `Your appeal has been ${String(values.decision || 'reviewed').toUpperCase()}.\n\n${values.decisionReason || ''}`.trim(), actions: [{ id: 'view_decision', label: 'View Decision', kind: 'appeal', resourceId: values.appealId || null }] },
  };
  return templates[templateKey] || null;
}

async function dbCreateFreqNotice({ recipientUsername, createdBy, templateKey = null, values = {}, noticeType, severity, title, body, actions = [], relatedResourceType = null, relatedResourceId = null, auditRequired = false }) {
  const template = templateKey ? buildFreqNoticeTemplate(templateKey, values) : null;
  const row = {
    recipient_username: normalizeUsername(recipientUsername), sender_key: 'freq_notices',
    notice_type: template?.noticeType || noticeType || 'general',
    severity: template?.severity || severity || 'info',
    title: String(template?.title || title || 'FREQ Notice').slice(0, 140),
    body: String(template?.body || body || '').slice(0, 10000),
    actions: template?.actions || (Array.isArray(actions) ? actions.slice(0, 8) : []),
    related_resource_type: relatedResourceType || null,
    related_resource_id: relatedResourceId != null ? String(relatedResourceId) : null,
    audit_required: template?.auditRequired ?? !!auditRequired,
    created_by: createdBy,
  };
  if (!row.recipient_username || !row.body) throw new Error('Notice recipient and body are required.');
  const { data, error } = await supabase.from('freq_notices').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Messaging settings and inbox ───────────────────────────────────────────
app.get('/api/messages/settings', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const settings = await dbGetMessageSettings(sess.username);
    return res.json({ settings: {
      dmPrivacy: settings.dm_privacy, artistDmPrivacy: settings.artist_dm_privacy,
      groupInvites: settings.group_invites, collaborationRequests: settings.collaboration_requests,
      readReceipts: settings.read_receipts, typingIndicators: settings.typing_indicators,
      onlineStatus: settings.online_status, fileDownloads: settings.file_downloads,
    } });
  } catch (error) {
    console.error('[messages settings get]', error);
    return res.status(500).json({ error: 'Could not load messaging privacy settings.' });
  }
});

app.patch('/api/messages/settings', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { verifiedEmail: true });
  if (!sess) return;
  const mappings = {
    dmPrivacy: ['dm_privacy', new Set(['everyone','following','mutual','nobody'])],
    artistDmPrivacy: ['artist_dm_privacy', new Set(['everyone','followers','mutual','supporters_premium','disabled'])],
    groupInvites: ['group_invites', new Set(['everyone','following','mutual','nobody'])],
    collaborationRequests: ['collaboration_requests', new Set(['everyone','artists','verified_artists','following','nobody'])],
    readReceipts: ['read_receipts', new Set([true,false])],
    typingIndicators: ['typing_indicators', new Set([true,false])],
    onlineStatus: ['online_status', new Set(['everyone','connections','nobody'])],
    fileDownloads: ['file_downloads', new Set(['allow','ask','deny'])],
  };
  const patch = { username: sess.username, updated_at: new Date().toISOString() };
  for (const [clientKey, [column, allowed]] of Object.entries(mappings)) {
    if (req.body?.[clientKey] !== undefined) {
      if (!allowed.has(req.body[clientKey])) return res.status(400).json({ error: `Invalid ${clientKey} setting.` });
      patch[column] = req.body[clientKey];
    }
  }
  if (Object.keys(patch).length === 2) return res.status(400).json({ error: 'No messaging setting was provided.' });
  try {
    const { error } = await supabase.from('user_message_settings').upsert(patch, { onConflict: 'username' });
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[messages settings patch]', error);
    return res.status(500).json({ error: 'Could not save messaging privacy settings.' });
  }
});

app.get('/api/messages/conversations', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 60);
  const category = String(req.query.category || 'inbox');
  const search = String(req.query.search || '').trim().slice(0, 100).toLowerCase();
  try {
    let membershipQuery = supabase.from('conversation_members')
      .select('conversation_id, role, muted_until, archived, last_read_at, joined_at')
      .eq('username', sess.username).eq('status', 'active').order('updated_at', { ascending: false }).limit(limit * 2);
    if (category === 'archived') membershipQuery = membershipQuery.eq('archived', true);
    else membershipQuery = membershipQuery.eq('archived', false);
    const { data: memberships, error: membershipError } = await membershipQuery;
    if (membershipError) throw new Error(membershipError.message);
    const conversationIds = (memberships || []).map(row => row.conversation_id);
    if (!conversationIds.length) return res.json({ conversations: [], nextCursor: null });

    const [conversationResult, memberResult, messageResult, pendingResult] = await Promise.all([
      supabase.from('conversations').select('*').in('id', conversationIds).order('last_message_at', { ascending: false, nullsFirst: false }),
      supabase.from('conversation_members').select('conversation_id, username, role, status').in('conversation_id', conversationIds).eq('status', 'active'),
      supabase.from('messages').select('id, conversation_id, sender_username, body, kind, shared_type, shared_snapshot, created_at, deleted_at').in('conversation_id', conversationIds).order('created_at', { ascending: false }).limit(Math.min(conversationIds.length * 30, 1200)),
      supabase.from('message_requests').select('conversation_id, sender_username, recipient_username, status').in('conversation_id', conversationIds).eq('status', 'pending'),
    ]);
    const anyError = conversationResult.error || memberResult.error || messageResult.error || pendingResult.error;
    if (anyError) throw new Error(anyError.message);
    const pendingByConversation = new Map((pendingResult.data || []).map(row => [row.conversation_id, row]));
    const membershipByConversation = new Map((memberships || []).map(row => [row.conversation_id, row]));
    const membersByConversation = new Map();
    for (const member of memberResult.data || []) {
      const list = membersByConversation.get(member.conversation_id) || [];
      list.push(member); membersByConversation.set(member.conversation_id, list);
    }
    const latestByConversation = new Map();
    const unreadByConversation = new Map();
    for (const message of messageResult.data || []) {
      if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
      const membership = membershipByConversation.get(message.conversation_id);
      const lastRead = membership?.last_read_at ? new Date(membership.last_read_at).getTime() : 0;
      if (message.sender_username !== sess.username && new Date(message.created_at).getTime() > lastRead) {
        unreadByConversation.set(message.conversation_id, (unreadByConversation.get(message.conversation_id) || 0) + 1);
      }
    }
    const allUsernames = (memberResult.data || []).map(row => row.username);
    const cards = await dbGetUserCards(allUsernames);
    let shaped = (conversationResult.data || []).filter(conversation => {
      const pending = pendingByConversation.get(conversation.id);
      if (pending?.sender_username === sess.username) return false;
      if (category === 'artists') return conversation.type === 'direct' && (membersByConversation.get(conversation.id) || []).some(member => cards.get(member.username)?.isArtist);
      if (category === 'groups') return ['group','artist_fan_group'].includes(conversation.type);
      if (category === 'projects') return conversation.type === 'project_room';
      return true;
    }).map(conversation => {
      const members = membersByConversation.get(conversation.id) || [];
      const other = members.find(member => member.username !== sess.username);
      const otherCard = other ? cards.get(other.username) : null;
      const latest = latestByConversation.get(conversation.id);
      const displayTitle = conversation.type === 'direct' ? (otherCard?.displayName || other?.username || 'Conversation') : (conversation.title || 'Untitled group');
      return {
        id: conversation.id, type: conversation.type, title: displayTitle,
        imageUrl: conversation.type === 'direct' ? (otherCard?.avatarUrl || null) : conversation.image_url,
        official: !!conversation.official, verifiedArtist: !!otherCard?.isVerifiedArtist,
        role: membershipByConversation.get(conversation.id)?.role || 'member',
        mutedUntil: membershipByConversation.get(conversation.id)?.muted_until || null,
        unreadCount: unreadByConversation.get(conversation.id) || 0,
        lastMessage: latest ? { body: latest.deleted_at ? 'Message deleted' : (latest.body || (latest.shared_type ? `Shared ${latest.shared_type}` : 'Attachment')), kind: latest.kind, senderUsername: latest.sender_username, createdAt: latest.created_at } : null,
        lastMessageAt: conversation.last_message_at || conversation.created_at,
      };
    });
    if (search) shaped = shaped.filter(row => row.title.toLowerCase().includes(search) || String(row.lastMessage?.body || '').toLowerCase().includes(search));
    shaped.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    return res.json({ conversations: shaped.slice(0, limit), nextCursor: shaped.length > limit ? shaped[limit - 1].lastMessageAt : null });
  } catch (error) {
    console.error('[messages conversations list]', error);
    return res.status(500).json({ error: 'Could not load conversations. Apply the FREQ messaging SQL migration if this is the first deployment.' });
  }
});

app.post('/api/messages/conversations', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages', verifiedEmail: true });
  if (!sess) return;
  const recipient = normalizeUsername(req.body?.recipientUsername);
  const body = normalizeMessageText(req.body?.message);
  if (!recipient) return res.status(400).json({ error: 'Choose a person to message.' });
  try {
    const { data: recipientAccount, error: recipientError } = await supabase.from('accounts').select('username').eq('username', recipient).maybeSingle();
    if (recipientError) throw new Error(recipientError.message);
    if (!recipientAccount) return res.status(404).json({ error: 'That FREQ account was not found.' });
    const permission = await dbCanRequestDirect(sess.username, recipient);
    if (!permission.allowed) return res.status(403).json({ error: permission.reason });
    if (!body && !req.body?.sharedType) return res.status(400).json({ error: 'Write a message or share FREQ music.' });
    if (permission.requestRequired && containsExternalLink(body)) return res.status(400).json({ error: 'Links are unavailable until this request is accepted.' });
    await enforceMessageSpamRules(sess.username, body, { isRequest: permission.requestRequired });
    const shared = await resolveSharedContent(req, req.body?.sharedType, req.body?.sharedId);
    const directKey = [sess.username, recipient].sort().join('::');
    const { data: existing, error: existingError } = await supabase.from('conversations').select('id').eq('direct_key', directKey).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      const { data: pending } = await supabase.from('message_requests').select('status').eq('conversation_id', existing.id).maybeSingle();
      return res.status(pending?.status === 'pending' ? 409 : 200).json({ conversationId: existing.id, requestPending: pending?.status === 'pending', alreadyExists: true });
    }
    const { data: conversation, error: conversationError } = await supabase.from('conversations').insert({
      type: 'direct', created_by: sess.username, direct_key: directKey,
      visibility: 'private', join_policy: 'invite_only', max_members: 2,
    }).select().single();
    if (conversationError) {
      if (conversationError.code === '23505') {
        const { data: raced } = await supabase.from('conversations').select('id').eq('direct_key', directKey).single();
        return res.json({ conversationId: raced.id, alreadyExists: true });
      }
      throw new Error(conversationError.message);
    }
    try {
      const { error: memberError } = await supabase.from('conversation_members').insert([
        { conversation_id: conversation.id, username: sess.username, role: 'member', status: 'active' },
        { conversation_id: conversation.id, username: recipient, role: 'member', status: permission.requestRequired ? 'pending' : 'active', invited_by: sess.username },
      ]);
      if (memberError) throw new Error(memberError.message);
      const { data: message, error: messageError } = await supabase.from('messages').insert({
        conversation_id: conversation.id, sender_username: sess.username,
        kind: shared ? 'share' : 'text', body: body || null,
        shared_type: shared?.type || null, shared_id: shared?.id || null, shared_snapshot: shared?.snapshot || {},
      }).select().single();
      if (messageError) throw new Error(messageError.message);
      await supabase.from('conversations').update({ last_message_at: message.created_at }).eq('id', conversation.id);
      if (permission.requestRequired) {
        const { error: requestError } = await supabase.from('message_requests').insert({
          conversation_id: conversation.id, sender_username: sess.username, recipient_username: recipient, status: 'pending', message_count: 1,
        });
        if (requestError) throw new Error(requestError.message);
      }
      return res.status(201).json({ conversationId: conversation.id, messageId: message.id, requestPending: permission.requestRequired });
    } catch (error) {
      await supabase.from('conversations').delete().eq('id', conversation.id);
      throw error;
    }
  } catch (error) {
    console.error('[messages conversation create]', error);
    return res.status(error.httpStatus || 500).json({ error: error.httpStatus ? error.message : 'Could not start this conversation.' });
  }
});

app.get('/api/messages/conversations/:id', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access) return res.status(404).json({ error: 'Conversation not found.' });
    const members = await dbGetConversationMembers(req.params.id);
    const cards = await dbGetUserCards(members.map(row => row.username));
    const { data: projectRoom, error: projectError } = access.conversation.type === 'project_room'
      ? await supabase.from('project_rooms').select('*').eq('conversation_id', req.params.id).maybeSingle()
      : { data: null, error: null };
    if (projectError) throw new Error(projectError.message);
    const typing = [];
    const now = Date.now();
    for (const member of members) {
      if (member.username === sess.username) continue;
      const value = messageTypingState.get(`${req.params.id}:${member.username}`);
      if (value && now - value.updatedAt < 10_000) typing.push(cards.get(member.username));
    }
    return res.json({
      conversation: {
        id: access.conversation.id, type: access.conversation.type, title: access.conversation.title,
        description: access.conversation.description, imageUrl: access.conversation.image_url,
        official: access.conversation.official, artistId: access.conversation.artist_id,
        locked: access.conversation.locked, announcementOnly: access.conversation.announcement_only,
        qnaMode: access.conversation.qna_mode, slowModeSeconds: access.conversation.slow_mode_seconds,
        visibility: access.conversation.visibility, joinPolicy: access.conversation.join_policy,
        role: access.membership.role, mutedUntil: access.membership.muted_until,
      },
      project: projectRoom ? { title: projectRoom.project_title, description: projectRoom.project_description, coverImageUrl: projectRoom.cover_image_url, releaseChecklist: projectRoom.release_checklist } : null,
      members: members.map(member => ({ ...cards.get(member.username), role: member.role, joinedAt: member.joined_at })),
      typing: typing.filter(Boolean),
    });
  } catch (error) {
    console.error('[messages conversation get]', error);
    return res.status(500).json({ error: 'Could not load conversation details.' });
  }
});

app.get('/api/messages/conversations/:id/messages', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), MESSAGE_HISTORY_PAGE_MAX);
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access) return res.status(404).json({ error: 'Conversation not found.' });
    let query = supabase.from('messages').select('*').eq('conversation_id', req.params.id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (req.query.before) query = query.lt('created_at', new Date(req.query.before).toISOString());
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data || []).slice(0, limit).reverse();
    const { data: pending } = await supabase.from('message_requests').select('status').eq('conversation_id', req.params.id).maybeSingle();
    const shaped = await shapeMessagesForClient(req, sess, page, { hideReceipts: pending?.status === 'pending' });
    return res.json({ messages: shaped, nextCursor: (data || []).length > limit ? data[limit - 1].created_at : null });
  } catch (error) {
    console.error('[messages history]', error);
    return res.status(500).json({ error: 'Could not load messages.' });
  }
});

app.post('/api/messages/conversations/:id/messages', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages', verifiedEmail: true });
  if (!sess) return;
  const body = normalizeMessageText(req.body?.body);
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access) return res.status(404).json({ error: 'Conversation not found.' });
    const conversation = access.conversation;
    if (conversation.locked && !GROUP_MODERATOR_ROLES.has(access.membership.role) && access.membership.role !== 'project_owner') return res.status(403).json({ error: 'This conversation is temporarily locked.' });
    if (['read_only','viewer'].includes(access.membership.role)) return res.status(403).json({ error: 'Your role is read-only in this conversation.' });
    if (conversation.announcement_only && !GROUP_MODERATOR_ROLES.has(access.membership.role) && access.membership.role !== 'project_owner') return res.status(403).json({ error: 'Only group moderators can post while announcement-only mode is on.' });
    const { data: requestRow, error: requestError } = await supabase.from('message_requests').select('*').eq('conversation_id', conversation.id).maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (requestRow?.status === 'pending') {
      if (requestRow.sender_username !== sess.username) return res.status(403).json({ error: 'Accept this request before replying.' });
      if (requestRow.message_count >= 3) return res.status(429).json({ error: 'Wait for this request to be accepted before sending anything else.' });
      if (containsExternalLink(body) || req.body?.attachmentId) return res.status(400).json({ error: 'Links and attachments unlock after the request is accepted.' });
    }
    const members = conversation.type === 'direct' ? await dbGetConversationMembers(conversation.id, { activeOnly: false }) : [];
    const other = members.find(member => member.username !== sess.username);
    if (other && await dbAreUsersBlocked(sess.username, other.username)) return res.status(403).json({ error: 'Messaging is unavailable for this account.' });
    if (!body && !req.body?.sharedType) return res.status(400).json({ error: 'Write a message or share FREQ content.' });
    await enforceMessageSpamRules(sess.username, body, { isRequest: requestRow?.status === 'pending' });
    if (conversation.slow_mode_seconds > 0 && !GROUP_MODERATOR_ROLES.has(access.membership.role) && access.membership.role !== 'project_owner') {
      const cutoff = new Date(Date.now() - conversation.slow_mode_seconds * 1000).toISOString();
      const { data: recent } = await supabase.from('messages').select('id').eq('conversation_id', conversation.id).eq('sender_username', sess.username).gte('created_at', cutoff).is('deleted_at', null).limit(1).maybeSingle();
      if (recent) return res.status(429).json({ error: 'Slow mode is on. Give the room a moment before sending another message.' });
    }
    let replyTo = null;
    if (req.body?.replyToMessageId) {
      const { data } = await supabase.from('messages').select('id').eq('id', req.body.replyToMessageId).eq('conversation_id', conversation.id).maybeSingle();
      if (!data) return res.status(400).json({ error: 'The replied-to message is not in this conversation.' });
      replyTo = data.id;
    }
    const shared = await resolveSharedContent(req, req.body?.sharedType, req.body?.sharedId);
    const { data: message, error } = await supabase.from('messages').insert({
      conversation_id: conversation.id, sender_username: sess.username,
      kind: shared ? 'share' : 'text', body: body || null, reply_to_message_id: replyTo,
      shared_type: shared?.type || null, shared_id: shared?.id || null, shared_snapshot: shared?.snapshot || {},
    }).select().single();
    if (error) throw new Error(error.message);
    await Promise.all([
      supabase.from('conversations').update({ last_message_at: message.created_at }).eq('id', conversation.id),
      requestRow?.status === 'pending'
        ? supabase.from('message_requests').update({ message_count: requestRow.message_count + 1 }).eq('id', requestRow.id)
        : Promise.resolve(),
    ]);
    const shaped = await shapeMessagesForClient(req, sess, [message], { hideReceipts: requestRow?.status === 'pending' });
    return res.status(201).json({ message: shaped[0] });
  } catch (error) {
    console.error('[messages send]', error);
    return res.status(error.httpStatus || 500).json({ error: error.httpStatus ? error.message : 'Could not send message.' });
  }
});

app.patch('/api/messages/:messageId', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages', verifiedEmail: true });
  if (!sess) return;
  const body = normalizeMessageText(req.body?.body);
  if (!body) return res.status(400).json({ error: 'Edited message cannot be empty.' });
  try {
    const { data: message, error } = await supabase.from('messages').select('*').eq('id', req.params.messageId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!message || message.sender_username !== sess.username || message.deleted_at) return res.status(404).json({ error: 'Message not found.' });
    if (Date.now() - new Date(message.created_at).getTime() > MESSAGE_EDIT_WINDOW_MS) return res.status(409).json({ error: 'The editing window for this message has closed.' });
    if (!(await dbGetConversationAccess(message.conversation_id, sess.username))) return res.status(404).json({ error: 'Message not found.' });
    const { data: updated, error: updateError } = await supabase.from('messages').update({ body, edited_at: new Date().toISOString() }).eq('id', message.id).select().single();
    if (updateError) throw new Error(updateError.message);
    return res.json({ message: (await shapeMessagesForClient(req, sess, [updated]))[0] });
  } catch (error) {
    console.error('[messages edit]', error);
    return res.status(500).json({ error: 'Could not edit message.' });
  }
});

app.delete('/api/messages/:messageId', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages' });
  if (!sess) return;
  try {
    const { data: message, error } = await supabase.from('messages').select('*').eq('id', req.params.messageId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!message || message.sender_username !== sess.username) return res.status(404).json({ error: 'Message not found.' });
    await supabase.from('messages').update({ body: null, shared_type: null, shared_id: null, shared_snapshot: {}, deleted_at: new Date().toISOString() }).eq('id', message.id);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[messages delete]', error);
    return res.status(500).json({ error: 'Could not delete message.' });
  }
});

app.post('/api/messages/:messageId/pin', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages', verifiedEmail: true });
  if (!sess) return;
  try {
    const { data: message, error } = await supabase.from('messages').select('*').eq('id', req.params.messageId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!message || message.deleted_at) return res.status(404).json({ error: 'Message not found.' });
    const access = await dbGetConversationAccess(message.conversation_id, sess.username);
    if (!access) return res.status(404).json({ error: 'Message not found.' });
    const canPin = access.conversation.type === 'direct'
      || GROUP_MODERATOR_ROLES.has(access.membership.role)
      || ['project_owner','manager'].includes(access.membership.role);
    if (!canPin) return res.status(403).json({ error: 'Your role cannot pin messages in this conversation.' });
    const { data: updated, error: updateError } = await supabase.from('messages').update({ pinned_at: new Date().toISOString(), pinned_by: sess.username }).eq('id', message.id).select().single();
    if (updateError) throw new Error(updateError.message);
    return res.json({ message: (await shapeMessagesForClient(req, sess, [updated]))[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Could not pin this message.' });
  }
});

app.delete('/api/messages/:messageId/pin', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages' });
  if (!sess) return;
  try {
    const { data: message, error } = await supabase.from('messages').select('*').eq('id', req.params.messageId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!message) return res.status(404).json({ error: 'Message not found.' });
    const access = await dbGetConversationAccess(message.conversation_id, sess.username);
    if (!access) return res.status(404).json({ error: 'Message not found.' });
    const canPin = access.conversation.type === 'direct'
      || GROUP_MODERATOR_ROLES.has(access.membership.role)
      || ['project_owner','manager'].includes(access.membership.role);
    if (!canPin) return res.status(403).json({ error: 'Your role cannot unpin messages in this conversation.' });
    const { error: updateError } = await supabase.from('messages').update({ pinned_at: null, pinned_by: null }).eq('id', message.id);
    if (updateError) throw new Error(updateError.message);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not unpin this message.' });
  }
});

app.post('/api/messages/:messageId/react', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages' });
  if (!sess) return;
  const emoji = String(req.body?.emoji || '').trim().slice(0, 16);
  if (!emoji || /[\u0000-\u001f]/.test(emoji)) return res.status(400).json({ error: 'Choose a valid reaction.' });
  try {
    const { data: message } = await supabase.from('messages').select('conversation_id, deleted_at').eq('id', req.params.messageId).maybeSingle();
    if (!message || message.deleted_at || !(await dbGetConversationAccess(message.conversation_id, sess.username))) return res.status(404).json({ error: 'Message not found.' });
    const { error } = await supabase.from('message_reactions').upsert({ message_id: req.params.messageId, username: sess.username, emoji }, { onConflict: 'message_id,username,emoji' });
    if (error) throw new Error(error.message);
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('[messages react]', error);
    return res.status(500).json({ error: 'Could not add reaction.' });
  }
});

app.delete('/api/messages/:messageId/react', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  const emoji = String(req.body?.emoji || req.query?.emoji || '').trim().slice(0, 16);
  try {
    const { error } = await supabase.from('message_reactions').delete().eq('message_id', req.params.messageId).eq('username', sess.username).eq('emoji', emoji);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not remove reaction.' });
  }
});

app.post('/api/messages/conversations/:id/read', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access) return res.status(404).json({ error: 'Conversation not found.' });
    const { data: latest, error } = await supabase.from('messages').select('id, created_at').eq('conversation_id', req.params.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    const now = new Date().toISOString();
    await supabase.from('conversation_members').update({ last_read_at: latest?.created_at || now }).eq('conversation_id', req.params.id).eq('username', sess.username);
    if (latest) await supabase.from('message_reads').upsert({ message_id: latest.id, username: sess.username, read_at: now }, { onConflict: 'message_id,username' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not update read status.' });
  }
});

app.post('/api/messages/conversations/:id/typing', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages' });
  if (!sess) return;
  try {
    if (!(await dbGetConversationAccess(req.params.id, sess.username))) return res.status(404).json({ error: 'Conversation not found.' });
    const settings = await dbGetMessageSettings(sess.username);
    if (settings.typing_indicators && req.body?.typing !== false) messageTypingState.set(`${req.params.id}:${sess.username}`, { updatedAt: Date.now() });
    else messageTypingState.delete(`${req.params.id}:${sess.username}`);
    return res.status(204).end();
  } catch (error) {
    return res.status(500).json({ error: 'Could not update typing status.' });
  }
});

app.get('/api/messages/conversations/:id/search', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  const search = String(req.query.q || '').trim().slice(0, 100);
  if (search.length < 2) return res.json({ messages: [] });
  try {
    if (!(await dbGetConversationAccess(req.params.id, sess.username))) return res.status(404).json({ error: 'Conversation not found.' });
    const safe = search.replace(/[%_]/g, '\\$&');
    const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', req.params.id).is('deleted_at', null).ilike('body', `%${safe}%`).order('created_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return res.json({ messages: await shapeMessagesForClient(req, sess, (data || []).reverse()) });
  } catch (error) {
    return res.status(500).json({ error: 'Could not search this conversation.' });
  }
});

// ── Requests, blocks, reports, mute/archive ─────────────────────────────────
app.get('/api/messages/requests', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const { data: requests, error } = await supabase.from('message_requests').select('*')
      .eq('recipient_username', sess.username).eq('status', 'pending').order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const senders = (requests || []).map(row => row.sender_username);
    const conversationIds = (requests || []).map(row => row.conversation_id);
    const [cards, messageResult] = await Promise.all([
      dbGetUserCards(senders),
      conversationIds.length ? supabase.from('messages').select('*').in('conversation_id', conversationIds).order('created_at') : Promise.resolve({ data: [], error: null }),
    ]);
    if (messageResult.error) throw new Error(messageResult.error.message);
    const firstByConversation = new Map();
    for (const message of messageResult.data || []) if (!firstByConversation.has(message.conversation_id)) firstByConversation.set(message.conversation_id, message);
    const shaped = [];
    for (const request of requests || []) {
      const relationship = await dbFollowRelationship(request.sender_username, request.recipient_username);
      const preview = firstByConversation.get(request.conversation_id);
      shaped.push({
        id: request.id, conversationId: request.conversation_id, sender: cards.get(request.sender_username),
        mutualFollowers: relationship.mutual ? 1 : 0,
        preview: preview?.body || (preview?.shared_type ? `Shared ${preview.shared_type}` : 'Message request'),
        shared: preview?.shared_type ? { type: preview.shared_type, id: preview.shared_id, ...preview.shared_snapshot } : null,
        messageCount: request.message_count, createdAt: request.created_at,
      });
    }
    return res.json({ requests: shaped });
  } catch (error) {
    console.error('[messages requests]', error);
    return res.status(500).json({ error: 'Could not load message requests.' });
  }
});

app.post('/api/messages/requests/:id/accept', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_send_messages', verifiedEmail: true });
  if (!sess) return;
  try {
    const { data: requestRow, error } = await supabase.from('message_requests').select('*').eq('id', req.params.id).eq('recipient_username', sess.username).eq('status', 'pending').maybeSingle();
    if (error) throw new Error(error.message);
    if (!requestRow) return res.status(404).json({ error: 'Message request not found.' });
    if (await dbAreUsersBlocked(requestRow.sender_username, sess.username)) return res.status(403).json({ error: 'Messaging is unavailable for this account.' });
    const now = new Date().toISOString();
    const [{ error: requestUpdateError }, { error: memberUpdateError }] = await Promise.all([
      supabase.from('message_requests').update({ status: 'accepted', responded_at: now }).eq('id', requestRow.id),
      supabase.from('conversation_members').update({ status: 'active', joined_at: now }).eq('conversation_id', requestRow.conversation_id).eq('username', sess.username),
    ]);
    if (requestUpdateError || memberUpdateError) throw new Error((requestUpdateError || memberUpdateError).message);
    return res.json({ ok: true, conversationId: requestRow.conversation_id });
  } catch (error) {
    return res.status(500).json({ error: 'Could not accept this request.' });
  }
});

app.post('/api/messages/requests/:id/decline', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('message_requests').update({ status: 'declined', responded_at: now })
      .eq('id', req.params.id).eq('recipient_username', sess.username).eq('status', 'pending').select('conversation_id').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Message request not found.' });
    await supabase.from('conversation_members').update({ status: 'removed' }).eq('conversation_id', data.conversation_id).eq('username', sess.username);
    return res.json({ ok: true }); // Sender is deliberately not notified.
  } catch (error) {
    return res.status(500).json({ error: 'Could not decline this request.' });
  }
});

app.post('/api/users/:userId/block', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  const blocked = normalizeUsername(req.params.userId);
  if (!blocked || blocked === sess.username) return res.status(400).json({ error: 'Choose another account to block.' });
  try {
    const { error } = await supabase.from('user_blocks').upsert({ blocker_username: sess.username, blocked_username: blocked, reason: normalizeMessageText(req.body?.reason).slice(0, 500) || null }, { onConflict: 'blocker_username,blocked_username' });
    if (error) throw new Error(error.message);
    await supabase.from('message_requests').update({ status: 'blocked', responded_at: new Date().toISOString() })
      .eq('recipient_username', sess.username).eq('sender_username', blocked).eq('status', 'pending');
    return res.status(201).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not block this account.' });
  }
});

app.delete('/api/users/:userId/block', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const { error } = await supabase.from('user_blocks').delete().eq('blocker_username', sess.username).eq('blocked_username', normalizeUsername(req.params.userId));
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not unblock this account.' });
  }
});

app.post('/api/users/:userId/report', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { verifiedEmail: true });
  if (!sess) return;
  const target = normalizeUsername(req.params.userId);
  const category = String(req.body?.category || 'other');
  if (!target || target === sess.username) return res.status(400).json({ error: 'Choose another account to report.' });
  if (!['spam','harassment','threats','impersonation','copyright','unsafe_file','other'].includes(category)) return res.status(400).json({ error: 'Choose a valid report category.' });
  try {
    const { data: account, error } = await supabase.from('accounts').select('username').eq('username', target).maybeSingle();
    if (error) throw new Error(error.message);
    if (!account) return res.status(404).json({ error: 'Account not found.' });
    const { data: report, error: reportError } = await supabase.from('message_reports').insert({
      reporter_username: sess.username, reported_username: target, category,
      detail: normalizeMessageText(req.body?.detail).slice(0, 2000) || null,
      moderation_snapshot: { kind: 'user', username: target, capturedAt: new Date().toISOString() },
    }).select('id').single();
    if (reportError) throw new Error(reportError.message);
    return res.status(201).json({ ok: true, reportId: report.id });
  } catch (error) {
    return res.status(500).json({ error: 'Could not submit this account report.' });
  }
});

app.patch('/api/messages/conversations/:id/preferences', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  const patch = {};
  if (req.body?.mutedUntil !== undefined) patch.muted_until = req.body.mutedUntil ? new Date(req.body.mutedUntil).toISOString() : null;
  if (req.body?.archived !== undefined) patch.archived = !!req.body.archived;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No conversation preference was provided.' });
  try {
    const { error } = await supabase.from('conversation_members').update(patch).eq('conversation_id', req.params.id).eq('username', sess.username).eq('status', 'active');
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not update conversation preferences.' });
  }
});

app.post('/api/messages/:messageId/report', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { verifiedEmail: true });
  if (!sess) return;
  const category = String(req.body?.category || 'other');
  if (!['spam','harassment','threats','impersonation','copyright','unsafe_file','other'].includes(category)) return res.status(400).json({ error: 'Choose a valid report category.' });
  try {
    const { data: message, error } = await supabase.from('messages').select('*').eq('id', req.params.messageId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!message || !(await dbGetConversationAccess(message.conversation_id, sess.username))) return res.status(404).json({ error: 'Message not found.' });
    const snapshot = { id: message.id, conversationId: message.conversation_id, sender: message.sender_username, body: message.body, kind: message.kind, sharedType: message.shared_type, sharedId: message.shared_id, sharedSnapshot: message.shared_snapshot, createdAt: message.created_at, capturedAt: new Date().toISOString() };
    const { data: report, error: reportError } = await supabase.from('message_reports').insert({
      reporter_username: sess.username, reported_username: message.sender_username,
      conversation_id: message.conversation_id, message_id: message.id,
      category, detail: normalizeMessageText(req.body?.detail).slice(0, 2000) || null,
      moderation_snapshot: snapshot,
    }).select('id').single();
    if (reportError) throw new Error(reportError.message);
    return res.status(201).json({ ok: true, reportId: report.id });
  } catch (error) {
    return res.status(500).json({ error: 'Could not submit this report.' });
  }
});

// ── Groups and official artist communities ─────────────────────────────────
app.post('/api/groups', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_create_groups', verifiedEmail: true });
  if (!sess) return;
  if (hitMessagingRateLimit(sess.username, 'group_create', 24 * 60 * 60 * 1000, 5)) return res.status(429).json({ error: 'You have created several groups recently. Try again later.' });
  const requestedType = req.body?.type === 'artist_fan_group' ? 'artist_fan_group' : 'group';
  const title = String(req.body?.name || '').trim().slice(0, 100);
  const description = String(req.body?.description || '').trim().slice(0, 1000) || null;
  const visibility = ['public','invite_only','approval_required','followers_only','artist_community'].includes(req.body?.visibility) ? req.body.visibility : 'invite_only';
  if (title.length < 2) return res.status(400).json({ error: 'Group name must be at least 2 characters.' });
  if (isProtectedFreqNoticeIdentity(title)) return res.status(400).json({ error: 'That name is reserved for official FREQ Notices.' });
  try {
    let artistId = null;
    let official = false;
    if (requestedType === 'artist_fan_group') {
      const { data: artist, error } = await supabase.from('artists')
        .select('id, account_id, is_verified, verification_status').eq('id', req.body?.artistId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!artist || artist.account_id !== sess.username || !artist.is_verified || artist.verification_status !== 'approved') {
        return res.status(403).json({ error: 'Only the verified artist owner can create that artist’s official group.' });
      }
      const { data: existing } = await supabase.from('conversations').select('id').eq('artist_id', artist.id).eq('type', 'artist_fan_group').eq('official', true).maybeSingle();
      if (existing) return res.status(409).json({ error: 'This artist already has an official FREQ group.', conversationId: existing.id });
      artistId = artist.id;
      official = true;
    }
    const { data: conversation, error } = await supabase.from('conversations').insert({
      type: requestedType, title, description, image_url: req.body?.imageUrl || null,
      created_by: sess.username, artist_id: artistId, official,
      visibility, join_policy: visibility === 'public' ? 'open' : visibility === 'approval_required' ? 'approval_required' : visibility === 'followers_only' ? 'followers_only' : 'invite_only',
      slow_mode_seconds: Math.min(Math.max(Number(req.body?.slowModeSeconds) || 0, 0), 3600),
      announcement_only: !!req.body?.announcementOnly,
      max_members: requestedType === 'artist_fan_group' ? 500 : Math.min(Math.max(Number(req.body?.maxMembers) || 100, 2), 200),
    }).select().single();
    if (error) throw new Error(error.message);
    const { error: memberError } = await supabase.from('conversation_members').insert({ conversation_id: conversation.id, username: sess.username, role: 'owner', status: 'active' });
    if (memberError) { await supabase.from('conversations').delete().eq('id', conversation.id); throw new Error(memberError.message); }
    return res.status(201).json({ group: { id: conversation.id, type: conversation.type, name: conversation.title, official: conversation.official } });
  } catch (error) {
    console.error('[groups create]', error);
    return res.status(500).json({ error: 'Could not create this group.' });
  }
});

app.patch('/api/groups/:id', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_create_groups', verifiedEmail: true });
  if (!sess) return;
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access || !['group','artist_fan_group'].includes(access.conversation.type)) return res.status(404).json({ error: 'Group not found.' });
    if (!GROUP_MANAGER_ROLES.has(access.membership.role)) return res.status(403).json({ error: 'Only the group owner or an admin can change these settings.' });
    const patch = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 100);
      if (name.length < 2) return res.status(400).json({ error: 'Group name is too short.' });
      if (isProtectedFreqNoticeIdentity(name)) return res.status(400).json({ error: 'That name is reserved for official FREQ Notices.' });
      patch.title = name;
    }
    if (req.body?.description !== undefined) patch.description = String(req.body.description || '').trim().slice(0, 1000) || null;
    if (req.body?.imageUrl !== undefined) patch.image_url = req.body.imageUrl || null;
    if (req.body?.locked !== undefined) patch.locked = !!req.body.locked;
    if (req.body?.announcementOnly !== undefined) patch.announcement_only = !!req.body.announcementOnly;
    if (req.body?.qnaMode !== undefined) patch.qna_mode = !!req.body.qnaMode;
    if (req.body?.slowModeSeconds !== undefined) patch.slow_mode_seconds = Math.min(Math.max(Number(req.body.slowModeSeconds) || 0, 0), 86400);
    if (req.body?.visibility !== undefined && ['public','invite_only','approval_required','followers_only','artist_community'].includes(req.body.visibility)) patch.visibility = req.body.visibility;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No group setting was provided.' });
    const { data, error } = await supabase.from('conversations').update(patch).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    const actions = [];
    if (patch.locked !== undefined) actions.push(patch.locked ? 'lock_group' : 'unlock_group');
    if (patch.slow_mode_seconds !== undefined) actions.push(patch.slow_mode_seconds > 0 ? 'enable_slow_mode' : 'disable_slow_mode');
    if (patch.announcement_only !== undefined) actions.push(patch.announcement_only ? 'enable_announcement_only' : 'disable_announcement_only');
    if (actions.length) {
      const { error: logError } = await supabase.from('moderation_message_actions').insert(actions.map(action => ({
        conversation_id: req.params.id, actor_username: sess.username, action,
        snapshot: { locked: data.locked, slowModeSeconds: data.slow_mode_seconds, announcementOnly: data.announcement_only },
      })));
      if (logError) console.error('[groups update] moderation log failed:', logError.message);
    }
    return res.json({ group: data });
  } catch (error) {
    return res.status(500).json({ error: 'Could not update this group.' });
  }
});

app.post('/api/groups/:id/invite', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_create_groups', verifiedEmail: true });
  if (!sess) return;
  if (hitMessagingRateLimit(sess.username, 'group_invite', 60_000, 25)) return res.status(429).json({ error: 'Too many invitations were sent. Slow down and try again.' });
  const invited = normalizeUsername(req.body?.username);
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access || !['group','artist_fan_group','project_room'].includes(access.conversation.type)) return res.status(404).json({ error: 'Group not found.' });
    if (!GROUP_MANAGER_ROLES.has(access.membership.role) && access.membership.role !== 'project_owner') return res.status(403).json({ error: 'Your role cannot invite members.' });
    if (!invited || invited === sess.username) return res.status(400).json({ error: 'Choose another FREQ account.' });
    if (await dbAreUsersBlocked(sess.username, invited)) return res.status(403).json({ error: 'That account cannot be invited.' });
    const settings = await dbGetMessageSettings(invited);
    const relation = await dbFollowRelationship(sess.username, invited);
    if (settings.group_invites === 'nobody' || (settings.group_invites === 'following' && !relation.recipientFollows) || (settings.group_invites === 'mutual' && !relation.mutual)) {
      return res.status(403).json({ error: 'That account’s group invitation settings do not allow this invite.' });
    }
    const members = await dbGetConversationMembers(req.params.id);
    if (members.length >= access.conversation.max_members) return res.status(409).json({ error: 'This group has reached its member limit.' });
    if (members.some(member => member.username === invited)) return res.status(409).json({ error: 'That person is already a member.' });
    const roleAllowed = access.conversation.type === 'project_room' ? PROJECT_MEMBER_ROLES : MESSAGE_MEMBER_ROLES;
    const requestedRole = roleAllowed.has(req.body?.role) ? req.body.role : (access.conversation.type === 'project_room' ? 'viewer' : 'member');
    const { data, error } = await supabase.from('group_invites').insert({ conversation_id: req.params.id, invited_username: invited, invited_by: sess.username, role: requestedRole }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'An invitation is already pending.' });
      throw new Error(error.message);
    }
    return res.status(201).json({ invite: { id: data.id, username: invited, role: requestedRole, expiresAt: data.expires_at } });
  } catch (error) {
    console.error('[groups invite]', error);
    return res.status(500).json({ error: 'Could not send this group invitation.' });
  }
});

app.post('/api/groups/:id/members', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { verifiedEmail: true });
  if (!sess) return;
  const action = req.body?.action || 'accept_invite';
  try {
    const { data: conversation, error: conversationError } = await supabase.from('conversations').select('*').eq('id', req.params.id).maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversation || !['group','artist_fan_group','project_room'].includes(conversation.type)) return res.status(404).json({ error: 'Group not found.' });
    if (action === 'accept_invite') {
      const { data: invite, error } = await supabase.from('group_invites').select('*').eq('conversation_id', req.params.id).eq('invited_username', sess.username).eq('status', 'pending').gt('expires_at', new Date().toISOString()).maybeSingle();
      if (error) throw new Error(error.message);
      if (!invite) return res.status(404).json({ error: 'Invitation not found or expired.' });
      const { data: ban } = await supabase.from('conversation_bans').select('username, expires_at').eq('conversation_id', req.params.id).eq('username', sess.username).maybeSingle();
      if (ban && (!ban.expires_at || new Date(ban.expires_at).getTime() > Date.now())) return res.status(403).json({ error: 'You cannot join this group.' });
      const memberCount = (await dbGetConversationMembers(req.params.id)).length;
      if (memberCount >= conversation.max_members) return res.status(409).json({ error: 'This group has reached its member limit.' });
      await supabase.from('conversation_members').upsert({ conversation_id: req.params.id, username: sess.username, role: invite.role, status: 'active', invited_by: invite.invited_by, joined_at: new Date().toISOString() }, { onConflict: 'conversation_id,username' });
      await supabase.from('group_invites').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', invite.id);
      return res.json({ ok: true, conversationId: req.params.id });
    }
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access || !GROUP_MANAGER_ROLES.has(access.membership.role)) return res.status(403).json({ error: 'Only a group owner or admin can approve members.' });
    const username = normalizeUsername(req.body?.username);
    const roleAllowed = conversation.type === 'project_room' ? PROJECT_MEMBER_ROLES : MESSAGE_MEMBER_ROLES;
    const role = roleAllowed.has(req.body?.role) ? req.body.role : (conversation.type === 'project_room' ? 'viewer' : 'member');
    const { error } = await supabase.from('conversation_members').upsert({ conversation_id: req.params.id, username, role, status: 'active', invited_by: sess.username, joined_at: new Date().toISOString() }, { onConflict: 'conversation_id,username' });
    if (error) throw new Error(error.message);
    return res.status(201).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not update group membership.' });
  }
});

app.delete('/api/groups/:id/members/:userId', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { verifiedEmail: true });
  if (!sess) return;
  const target = normalizeUsername(req.params.userId);
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access) return res.status(404).json({ error: 'Group not found.' });
    const leavingSelf = target === sess.username;
    if (!leavingSelf && !GROUP_MODERATOR_ROLES.has(access.membership.role) && access.membership.role !== 'project_owner') return res.status(403).json({ error: 'Your role cannot remove members.' });
    const { data: targetMember } = await supabase.from('conversation_members').select('*').eq('conversation_id', req.params.id).eq('username', target).maybeSingle();
    if (!targetMember) return res.status(404).json({ error: 'Member not found.' });
    if (targetMember.role === 'owner' || targetMember.role === 'project_owner') return res.status(409).json({ error: 'Transfer ownership before removing the owner.' });
    await supabase.from('conversation_members').update({ status: leavingSelf ? 'left' : 'removed' }).eq('conversation_id', req.params.id).eq('username', target);
    if (!leavingSelf && req.body?.ban) {
      await supabase.from('conversation_bans').upsert({ conversation_id: req.params.id, username: target, banned_by: sess.username, reason: normalizeMessageText(req.body?.reason).slice(0, 1000) || null, expires_at: req.body?.expiresAt || null }, { onConflict: 'conversation_id,username' });
      await supabase.from('moderation_message_actions').insert({ conversation_id: req.params.id, target_username: target, actor_username: sess.username, action: 'ban_member', reason: normalizeMessageText(req.body?.reason).slice(0, 1000) || null, snapshot: { previousRole: targetMember.role } });
    }
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not remove this member.' });
  }
});

app.post('/api/groups/:id/report', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { verifiedEmail: true });
  if (!sess) return;
  const category = String(req.body?.category || 'other');
  if (!['spam','harassment','threats','impersonation','copyright','unsafe_file','other'].includes(category)) return res.status(400).json({ error: 'Choose a valid report category.' });
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access || !['group','artist_fan_group','project_room'].includes(access.conversation.type)) return res.status(404).json({ error: 'Group not found.' });
    const { data: report, error } = await supabase.from('message_reports').insert({
      reporter_username: sess.username,
      reported_username: access.conversation.created_by,
      conversation_id: access.conversation.id,
      category,
      detail: normalizeMessageText(req.body?.detail).slice(0, 2000) || null,
      moderation_snapshot: {
        kind: 'group', id: access.conversation.id, type: access.conversation.type,
        title: access.conversation.title, description: access.conversation.description,
        createdBy: access.conversation.created_by, official: access.conversation.official,
        capturedAt: new Date().toISOString(),
      },
    }).select('id').single();
    if (error) throw new Error(error.message);
    return res.status(201).json({ ok: true, reportId: report.id });
  } catch (error) {
    return res.status(500).json({ error: 'Could not submit this group report.' });
  }
});

// ── Private project rooms and protected files ──────────────────────────────
app.post('/api/projects', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_create_groups', verifiedEmail: true });
  if (!sess) return;
  if (hitMessagingRateLimit(sess.username, 'project_create', 24 * 60 * 60 * 1000, 4)) return res.status(429).json({ error: 'You have created several project rooms recently. Try again later.' });
  const title = String(req.body?.title || '').trim().slice(0, 120);
  if (title.length < 2) return res.status(400).json({ error: 'Project title must be at least 2 characters.' });
  try {
    const { data: artist } = await supabase.from('artists').select('id').eq('account_id', sess.username).maybeSingle();
    if (!artist) return res.status(403).json({ error: 'Create or claim an artist page before opening a private music project room.' });
    const { data: conversation, error } = await supabase.from('conversations').insert({
      type: 'project_room', title, description: String(req.body?.description || '').trim().slice(0, 2000) || null,
      image_url: req.body?.coverImageUrl || null, created_by: sess.username,
      visibility: 'private', join_policy: 'invite_only', max_members: Math.min(Math.max(Number(req.body?.maxMembers) || 25, 2), 50),
    }).select().single();
    if (error) throw new Error(error.message);
    try {
      const [{ error: memberError }, { error: projectError }] = await Promise.all([
        supabase.from('conversation_members').insert({ conversation_id: conversation.id, username: sess.username, role: 'project_owner', status: 'active' }),
        supabase.from('project_rooms').insert({ conversation_id: conversation.id, project_title: title, project_description: conversation.description, cover_image_url: conversation.image_url, owner_username: sess.username, release_checklist: Array.isArray(req.body?.releaseChecklist) ? req.body.releaseChecklist.slice(0, 100) : [] }),
      ]);
      if (memberError || projectError) throw new Error((memberError || projectError).message);
      return res.status(201).json({ project: { id: conversation.id, title, private: true } });
    } catch (error) {
      await supabase.from('conversations').delete().eq('id', conversation.id);
      throw error;
    }
  } catch (error) {
    console.error('[projects create]', error);
    return res.status(500).json({ error: 'Could not create this private project room.' });
  }
});

async function storePrivateNonAudio({ conversationId, username, file, detection }) {
  const scan = await scanBufferForMalware(file.buffer, detection.name, process.env);
  if (scan.status === 'infected') throw Object.assign(new Error('Security scanning rejected this file.'), { httpStatus: 400 });
  const scanStatus = scan.status === 'clean' ? 'clean' : 'review_required';
  const safeName = detection.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150) || 'attachment';
  const storagePath = `${conversationId}/${username}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName}`;
  const { error } = await supabase.storage.from(FREQ_PRIVATE_MESSAGING_BUCKET).upload(storagePath, file.buffer, { contentType: detection.mime, upsert: false });
  if (error) throw new Error(error.message);
  return { storageBucket: FREQ_PRIVATE_MESSAGING_BUCKET, storagePath, scanStatus, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}

async function storeRightsProtectedAudio({ username, file, body }) {
  const { cloudFile, rightsReview } = await analyzeAndStoreCloudAudio({
    owner: username, buffer: file.buffer, filename: file.originalname || 'audio',
    mimeType: file.mimetype === 'application/octet-stream' ? guessMimeFromName(file.originalname) : file.mimetype,
    folder: 'FREQ Projects', title: String(body?.title || '').trim().slice(0, 255) || null,
    artist: String(body?.artist || '').trim().slice(0, 255) || null,
    duration: body?.duration != null ? Number(body.duration) : null, rightsBody: body || {},
  });
  return { cloudFile, rightsReview, sha256: rightsReview.sha256, scanStatus: rightsReview.security_scan_status === 'clean' ? 'clean' : 'review_required' };
}

app.post('/api/projects/:id/files', rateLimit, messagingAttachmentUpload.single('file'), async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_upload_files', verifiedEmail: true });
  if (!sess) return;
  if (!req.file) return res.status(400).json({ error: 'Choose an approved project file.' });
  if (hitMessagingRateLimit(sess.username, 'project_upload', 60 * 60 * 1000, 30)) return res.status(429).json({ error: 'Project uploads are temporarily cooling down. Try again later.' });
  let uploadedObject = null;
  let uploadedAudio = null;
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access || access.conversation.type !== 'project_room') return res.status(404).json({ error: 'Project room not found.' });
    if (!PROJECT_UPLOAD_ROLES.has(access.membership.role)) return res.status(403).json({ error: 'Your project role cannot upload files.' });
    const detection = detectPrivateAttachment(req.file, { allowAudio: true, allowZip: true, allowDocuments: true });
    if (detection.kind === 'audio' && req.file.size > 20 * 1048576) return res.status(413).json({ error: 'Audio project attachments are limited to 20 MB in this build.' });
    let fileRow;
    if (detection.kind === 'audio') {
      uploadedAudio = await storeRightsProtectedAudio({ username: sess.username, file: req.file, body: req.body });
      fileRow = {
        project_conversation_id: req.params.id, uploaded_by: sess.username,
        cloud_file_id: uploadedAudio.cloudFile.id, rights_review_id: uploadedAudio.rightsReview.id,
        original_filename: detection.name, detected_kind: 'audio', detected_mime_type: uploadedAudio.cloudFile.mime_type,
        size_bytes: req.file.size, sha256: uploadedAudio.sha256, scan_status: uploadedAudio.scanStatus,
      };
    } else {
      uploadedObject = await storePrivateNonAudio({ conversationId: req.params.id, username: sess.username, file: req.file, detection });
      fileRow = {
        project_conversation_id: req.params.id, uploaded_by: sess.username,
        storage_bucket: uploadedObject.storageBucket, storage_path: uploadedObject.storagePath,
        original_filename: detection.name, detected_kind: detection.kind, detected_mime_type: detection.mime,
        size_bytes: req.file.size, sha256: uploadedObject.sha256, scan_status: uploadedObject.scanStatus,
      };
    }
    fileRow.version_label = String(req.body?.versionLabel || '').trim().slice(0, 80) || null;
    fileRow.file_notes = String(req.body?.notes || '').trim().slice(0, 2000) || null;
    fileRow.pinned = !!req.body?.pinned;
    fileRow.download_permission = ['owner','members','roles','disabled'].includes(req.body?.downloadPermission) ? req.body.downloadPermission : 'members';
    fileRow.allowed_roles = Array.isArray(req.body?.allowedRoles) ? req.body.allowedRoles.filter(role => PROJECT_MEMBER_ROLES.has(role)).slice(0, 20) : [];
    const { data: projectFile, error: projectFileError } = await supabase.from('project_files').insert(fileRow).select().single();
    if (projectFileError) throw new Error(projectFileError.message);
    const { data: message, error: messageError } = await supabase.from('messages').insert({ conversation_id: req.params.id, sender_username: sess.username, kind: 'file', body: fileRow.file_notes || null }).select().single();
    if (messageError) { await supabase.from('project_files').delete().eq('id', projectFile.id); throw new Error(messageError.message); }
    const attachmentRow = {
      message_id: message.id, uploader_username: sess.username,
      original_filename: fileRow.original_filename, detected_kind: fileRow.detected_kind, detected_mime_type: fileRow.detected_mime_type,
      size_bytes: fileRow.size_bytes, sha256: fileRow.sha256, scan_status: fileRow.scan_status,
      download_permission: fileRow.download_permission === 'disabled' ? 'disabled' : 'members',
      storage_bucket: fileRow.storage_bucket || null, storage_path: fileRow.storage_path || null,
      cloud_file_id: fileRow.cloud_file_id || null, rights_review_id: fileRow.rights_review_id || null,
    };
    const { data: attachment, error: attachmentError } = await supabase.from('message_attachments').insert(attachmentRow).select('id').single();
    if (attachmentError) throw new Error(attachmentError.message);
    await supabase.from('conversations').update({ last_message_at: message.created_at }).eq('id', req.params.id);
    return res.status(201).json({ file: { id: projectFile.id, attachmentId: attachment.id, filename: projectFile.original_filename, kind: projectFile.detected_kind, versionLabel: projectFile.version_label, scanStatus: projectFile.scan_status, rightsReviewId: projectFile.rights_review_id, private: true } });
  } catch (error) {
    console.error('[projects file upload]', error);
    if (uploadedObject?.storagePath) await supabase.storage.from(FREQ_PRIVATE_MESSAGING_BUCKET).remove([uploadedObject.storagePath]).catch(() => {});
    if (uploadedAudio?.cloudFile) {
      await supabase.storage.from(CLOUD_BUCKET).remove([uploadedAudio.cloudFile.storage_path]).catch(() => {});
      await dbDeleteCloudFile(uploadedAudio.cloudFile.id, sess.username).catch(() => {});
    }
    if (error instanceof RightsProcessingError) return res.status(error.httpStatus || 400).json({ error: error.publicMessage, code: error.code });
    return res.status(error.httpStatus || 500).json({ error: error.httpStatus ? error.message : 'Could not securely upload this project file.' });
  }
});

app.get('/api/projects/:id/files', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access || access.conversation.type !== 'project_room') return res.status(404).json({ error: 'Project room not found.' });
    const { data, error } = await supabase.from('project_files').select('*').eq('project_conversation_id', req.params.id).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return res.json({ files: (data || []).map(row => ({
      id: row.id, filename: row.original_filename, kind: row.detected_kind, mimeType: row.detected_mime_type,
      size: Number(row.size_bytes), versionLabel: row.version_label, notes: row.file_notes, pinned: row.pinned,
      downloadPermission: row.download_permission, allowedRoles: row.allowed_roles,
      scanStatus: row.scan_status, rightsReviewId: row.rights_review_id, uploadedBy: row.uploaded_by, createdAt: row.created_at,
    })) });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load private project files.' });
  }
});

async function canDownloadProjectFile(file, access, username) {
  if (!file || !access || file.scan_status !== 'clean' || file.download_permission === 'disabled') return false;
  if (file.uploaded_by === username || access.membership.role === 'project_owner') return true;
  if (file.download_permission === 'owner') return false;
  if (file.download_permission === 'roles') return (file.allowed_roles || []).includes(access.membership.role);
  return file.download_permission === 'members';
}

app.get('/api/projects/:id/files/:fileId/download', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access || access.conversation.type !== 'project_room') return res.status(404).json({ error: 'Project file not found.' });
    const { data: file, error } = await supabase.from('project_files').select('*').eq('id', req.params.fileId).eq('project_conversation_id', req.params.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!(await canDownloadProjectFile(file, access, sess.username))) return res.status(404).json({ error: 'Project file not found or not cleared for download.' });
    let bucket = file.storage_bucket;
    let storagePath = file.storage_path;
    if (file.cloud_file_id) {
      const { data: cloudFile, error: cloudError } = await supabase.from('cloud_files').select('storage_path').eq('id', file.cloud_file_id).maybeSingle();
      if (cloudError || !cloudFile) throw new Error(cloudError?.message || 'Audio file missing.');
      bucket = CLOUD_BUCKET; storagePath = cloudFile.storage_path;
    }
    const { data, error: signError } = await supabase.storage.from(bucket).createSignedUrl(storagePath, MESSAGE_SIGNED_URL_TTL_SECONDS, { download: file.original_filename });
    if (signError) throw new Error(signError.message);
    return res.json({ url: data.signedUrl, expiresIn: MESSAGE_SIGNED_URL_TTL_SECONDS, filename: file.original_filename });
  } catch (error) {
    console.error('[projects file download]', error);
    return res.status(500).json({ error: 'Could not create a private download link.' });
  }
});

// Listener chats accept only signature-verified images/short video. Audio is
// available only in an artist-to-artist direct thread and is routed through
// FREQ's existing rights pipeline. Arbitrary documents and ZIP never enter a
// normal DM.
app.post('/api/messages/conversations/:id/attachments', rateLimit, messagingAttachmentUpload.single('file'), async (req, res) => {
  const sess = await requireMessagingSession(req, res, { capability: 'can_upload_files', verifiedEmail: true });
  if (!sess) return;
  if (!req.file) return res.status(400).json({ error: 'Choose an approved image, short video, or artist audio file.' });
  let uploadedObject = null;
  let uploadedAudio = null;
  try {
    const access = await dbGetConversationAccess(req.params.id, sess.username);
    if (!access || access.conversation.type === 'project_room') return res.status(404).json({ error: 'Conversation not found.' });
    if (['read_only','viewer'].includes(access.membership.role)) return res.status(403).json({ error: 'Your role cannot upload attachments.' });
    const members = await dbGetConversationMembers(req.params.id);
    const cards = await dbGetUserCards(members.map(row => row.username));
    const artistToArtist = access.conversation.type === 'direct' && members.length === 2 && members.every(member => cards.get(member.username)?.isArtist);
    const detection = detectPrivateAttachment(req.file, { allowAudio: artistToArtist, allowZip: false, allowDocuments: false });
    if (detection.kind === 'image' && req.file.size > 10 * 1048576) return res.status(413).json({ error: 'Chat images are limited to 10 MB.' });
    if (detection.kind === 'video' && req.file.size > 25 * 1048576) return res.status(413).json({ error: 'Chat videos are limited to 25 MB.' });
    if (detection.kind === 'audio' && req.file.size > 20 * 1048576) return res.status(413).json({ error: 'Artist audio attachments are limited to 20 MB.' });
    let values;
    if (detection.kind === 'audio') {
      uploadedAudio = await storeRightsProtectedAudio({ username: sess.username, file: req.file, body: req.body });
      values = { cloud_file_id: uploadedAudio.cloudFile.id, rights_review_id: uploadedAudio.rightsReview.id, scan_status: uploadedAudio.scanStatus, sha256: uploadedAudio.sha256, mime: uploadedAudio.cloudFile.mime_type };
    } else {
      uploadedObject = await storePrivateNonAudio({ conversationId: req.params.id, username: sess.username, file: req.file, detection });
      values = { storage_bucket: uploadedObject.storageBucket, storage_path: uploadedObject.storagePath, scan_status: uploadedObject.scanStatus, sha256: uploadedObject.sha256, mime: detection.mime };
    }
    const { data: message, error: messageError } = await supabase.from('messages').insert({ conversation_id: req.params.id, sender_username: sess.username, kind: 'file', body: normalizeMessageText(req.body?.caption) || null }).select().single();
    if (messageError) throw new Error(messageError.message);
    const { data: attachment, error: attachmentError } = await supabase.from('message_attachments').insert({
      message_id: message.id, uploader_username: sess.username,
      original_filename: detection.name, detected_kind: detection.kind, detected_mime_type: values.mime,
      size_bytes: req.file.size, sha256: values.sha256, scan_status: values.scan_status,
      storage_bucket: values.storage_bucket || null, storage_path: values.storage_path || null,
      cloud_file_id: values.cloud_file_id || null, rights_review_id: values.rights_review_id || null,
      download_permission: 'members',
    }).select().single();
    if (attachmentError) throw new Error(attachmentError.message);
    await supabase.from('conversations').update({ last_message_at: message.created_at }).eq('id', req.params.id);
    return res.status(201).json({ attachment: { id: attachment.id, messageId: message.id, filename: attachment.original_filename, kind: attachment.detected_kind, scanStatus: attachment.scan_status, rightsReviewId: attachment.rights_review_id } });
  } catch (error) {
    console.error('[messages attachment upload]', error);
    if (uploadedObject?.storagePath) await supabase.storage.from(FREQ_PRIVATE_MESSAGING_BUCKET).remove([uploadedObject.storagePath]).catch(() => {});
    if (uploadedAudio?.cloudFile) {
      await supabase.storage.from(CLOUD_BUCKET).remove([uploadedAudio.cloudFile.storage_path]).catch(() => {});
      await dbDeleteCloudFile(uploadedAudio.cloudFile.id, sess.username).catch(() => {});
    }
    if (error instanceof RightsProcessingError) return res.status(error.httpStatus || 400).json({ error: error.publicMessage, code: error.code });
    return res.status(error.httpStatus || 500).json({ error: error.httpStatus ? error.message : 'Could not securely attach this file.' });
  }
});

app.get('/api/messages/attachments/:attachmentId/download', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const { data: attachment, error } = await supabase.from('message_attachments').select('*, messages(conversation_id, deleted_at)').eq('id', req.params.attachmentId).maybeSingle();
    if (error) throw new Error(error.message);
    const conversationId = attachment?.messages?.conversation_id;
    const access = conversationId ? await dbGetConversationAccess(conversationId, sess.username) : null;
    if (!attachment || !access || attachment.messages?.deleted_at || attachment.scan_status !== 'clean' || attachment.download_permission === 'disabled') return res.status(404).json({ error: 'Attachment not found or not cleared for download.' });
    let bucket = attachment.storage_bucket;
    let storagePath = attachment.storage_path;
    if (attachment.cloud_file_id) {
      const { data: cloudFile } = await supabase.from('cloud_files').select('storage_path').eq('id', attachment.cloud_file_id).maybeSingle();
      if (!cloudFile) return res.status(404).json({ error: 'Attachment not found.' });
      bucket = CLOUD_BUCKET; storagePath = cloudFile.storage_path;
    }
    const { data, error: signError } = await supabase.storage.from(bucket).createSignedUrl(storagePath, MESSAGE_SIGNED_URL_TTL_SECONDS, { download: attachment.original_filename });
    if (signError) throw new Error(signError.message);
    return res.json({ url: data.signedUrl, expiresIn: MESSAGE_SIGNED_URL_TTL_SECONDS, filename: attachment.original_filename });
  } catch (error) {
    return res.status(500).json({ error: 'Could not create a private attachment link.' });
  }
});

// ── Official, server-controlled FREQ Notices ───────────────────────────────
app.get('/api/notices', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  try {
    const { data: notices, error } = await supabase.from('freq_notices').select('*')
      .eq('recipient_username', sess.username).order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    const ids = (notices || []).map(row => row.id);
    const { data: reads, error: readError } = ids.length
      ? await supabase.from('notice_reads').select('notice_id, read_at').eq('username', sess.username).in('notice_id', ids)
      : { data: [], error: null };
    if (readError) throw new Error(readError.message);
    const readMap = new Map((reads || []).map(row => [row.notice_id, row.read_at]));
    return res.json({
      official: { name: 'FREQ Notices', senderKey: 'freq_notices', verified: true, publicProfile: false, readOnly: true },
      unreadCount: (notices || []).filter(row => !readMap.has(row.id)).length,
      notices: (notices || []).map(row => ({
        id: row.id, title: row.title, body: row.body, noticeType: row.notice_type, severity: row.severity,
        relatedResourceType: row.related_resource_type, relatedResourceId: row.related_resource_id,
        actions: row.actions || [], auditRequired: row.audit_required, createdAt: row.created_at,
        expiresAt: row.expires_at, readAt: readMap.get(row.id) || null,
      })),
    });
  } catch (error) {
    console.error('[notices list]', error);
    return res.status(500).json({ error: 'Could not load FREQ Notices.' });
  }
});

app.get('/api/notices/:id', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const { data, error } = await supabase.from('freq_notices').select('*').eq('id', req.params.id).eq('recipient_username', sess.username).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'FREQ Notice not found.' });
    const { data: read } = await supabase.from('notice_reads').select('read_at').eq('notice_id', data.id).eq('username', sess.username).maybeSingle();
    return res.json({ notice: { id: data.id, title: data.title, body: data.body, noticeType: data.notice_type, severity: data.severity, actions: data.actions || [], relatedResourceType: data.related_resource_type, relatedResourceId: data.related_resource_id, auditRequired: data.audit_required, createdAt: data.created_at, readAt: read?.read_at || null }, officialVerified: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load this FREQ Notice.' });
  }
});

app.post('/api/notices/:id/read', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  try {
    const { data: notice } = await supabase.from('freq_notices').select('id').eq('id', req.params.id).eq('recipient_username', sess.username).maybeSingle();
    if (!notice) return res.status(404).json({ error: 'FREQ Notice not found.' });
    const { error } = await supabase.from('notice_reads').upsert({ notice_id: notice.id, username: sess.username, read_at: new Date().toISOString() }, { onConflict: 'notice_id,username' });
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Could not update this notice.' });
  }
});

app.post('/api/notices/:id/action', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res);
  if (!sess) return;
  const actionId = String(req.body?.actionId || '');
  try {
    const { data: notice, error } = await supabase.from('freq_notices').select('*').eq('id', req.params.id).eq('recipient_username', sess.username).maybeSingle();
    if (error) throw new Error(error.message);
    if (!notice) return res.status(404).json({ error: 'FREQ Notice not found.' });
    const action = (Array.isArray(notice.actions) ? notice.actions : []).find(item => item?.id === actionId);
    if (!action) return res.status(400).json({ error: 'That notice action is not available.' });
    await supabase.from('notice_reads').upsert({ notice_id: notice.id, username: sess.username, read_at: new Date().toISOString() }, { onConflict: 'notice_id,username' });
    // The client receives a typed, server-validated action. It never executes
    // an arbitrary URL supplied through the database.
    const allowedKinds = new Set(['appeal','artist','rights','mp_history','account_activity','premium','upload','policy']);
    if (!allowedKinds.has(action.kind)) return res.status(400).json({ error: 'That notice action is not supported.' });
    return res.json({ action: { kind: action.kind, resourceId: action.resourceId || notice.related_resource_id || null } });
  } catch (error) {
    return res.status(500).json({ error: 'Could not open that notice action.' });
  }
});

app.post('/api/admin/notices', rateLimit, requireAdmin, async (req, res) => {
  try {
    const recipient = normalizeUsername(req.body?.recipientUsername);
    const { data: account } = await supabase.from('accounts').select('username').eq('username', recipient).maybeSingle();
    if (!account) return res.status(404).json({ error: 'Recipient account not found.' });
    const notice = await dbCreateFreqNotice({
      recipientUsername: recipient, createdBy: req._adminSession.username,
      templateKey: req.body?.templateKey || null, values: req.body?.values || {},
      noticeType: req.body?.noticeType, severity: req.body?.severity,
      title: req.body?.title, body: req.body?.body, actions: req.body?.actions,
      relatedResourceType: req.body?.relatedResourceType, relatedResourceId: req.body?.relatedResourceId,
      auditRequired: req.body?.auditRequired,
    });
    return res.status(201).json({ notice: { id: notice.id, recipientUsername: notice.recipient_username, severity: notice.severity, title: notice.title } });
  } catch (error) {
    console.error('[admin notices create]', error);
    return res.status(500).json({ error: 'Could not create the official FREQ Notice.' });
  }
});

app.post('/api/admin/restrictions', rateLimit, requireAdmin, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const severity = String(req.body?.severity || 'temporary_restriction');
  const reason = normalizeMessageText(req.body?.reason).slice(0, 4000);
  if (!username || reason.length < 3) return res.status(400).json({ error: 'Account and restriction reason are required.' });
  if (!['warning','temporary_restriction','account_suspended','permanent_ban'].includes(severity)) return res.status(400).json({ error: 'Invalid restriction severity.' });
  if (severity === 'temporary_restriction' && !req.body?.endsAt) return res.status(400).json({ error: 'Temporary restrictions need an end time.' });
  const permissions = req.body?.permissions || {};
  const row = {
    username, severity, reason, moderator_decision: String(req.body?.moderatorDecision || '').slice(0, 4000) || null,
    starts_at: req.body?.startsAt ? new Date(req.body.startsAt).toISOString() : new Date().toISOString(),
    ends_at: req.body?.endsAt ? new Date(req.body.endsAt).toISOString() : null,
    appeal_allowed: req.body?.appealAllowed !== false, created_by: req._adminSession.username,
  };
  for (const capability of MESSAGE_CAPABILITIES) if (permissions[capability] !== undefined) row[capability] = !!permissions[capability];
  try {
    const { data: account } = await supabase.from('accounts').select('username').eq('username', username).maybeSingle();
    if (!account) return res.status(404).json({ error: 'Account not found.' });
    const { data: restriction, error } = await supabase.from('account_restrictions').insert(row).select().single();
    if (error) throw new Error(error.message);
    try {
      const templateKey = severity === 'warning' ? null : 'temporary_restriction';
      const notice = await dbCreateFreqNotice({
        recipientUsername: username, createdBy: req._adminSession.username, templateKey,
        values: { reason, endsAt: row.ends_at, restrictionId: restriction.id, appealAllowed: row.appeal_allowed },
        noticeType: severity === 'warning' ? 'account_warning' : (severity === 'permanent_ban' ? 'ban' : 'restriction'),
        severity: severity === 'warning' ? 'warning' : severity,
        title: severity === 'warning' ? 'FREQ Notice · Account Warning' : undefined,
        body: severity === 'warning' ? `Things got a little out of tune. 🎵\n\nReason:\n${reason}\n\nNo restriction should hide its reason or next steps. Please keep the FREQ community healthy.` : undefined,
        relatedResourceType: 'account_restriction', relatedResourceId: restriction.id, auditRequired: severity !== 'warning',
        actions: row.appeal_allowed ? [{ id: 'appeal', label: 'Appeal Decision', kind: 'appeal', resourceId: restriction.id }] : [],
      });
      return res.status(201).json({ restriction: { id: restriction.id, username, severity, endsAt: restriction.ends_at }, noticeId: notice.id });
    } catch (noticeError) {
      await supabase.from('account_restrictions').delete().eq('id', restriction.id);
      throw noticeError;
    }
  } catch (error) {
    console.error('[admin restrictions create]', error);
    return res.status(500).json({ error: 'Could not apply this restriction safely.' });
  }
});

app.patch('/api/admin/restrictions/:id', rateLimit, requireAdmin, async (req, res) => {
  try {
    const { data: existing, error } = await supabase.from('account_restrictions').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!existing) return res.status(404).json({ error: 'Restriction not found.' });
    const patch = {};
    if (req.body?.active === false) Object.assign(patch, { active: false, lifted_by: req._adminSession.username, lifted_at: new Date().toISOString(), lift_reason: normalizeMessageText(req.body?.liftReason).slice(0, 2000) || 'Restriction lifted by moderator.' });
    if (req.body?.endsAt !== undefined) patch.ends_at = req.body.endsAt ? new Date(req.body.endsAt).toISOString() : null;
    if (req.body?.appealAllowed !== undefined) patch.appeal_allowed = !!req.body.appealAllowed;
    for (const capability of MESSAGE_CAPABILITIES) if (req.body?.permissions?.[capability] !== undefined) patch[capability] = !!req.body.permissions[capability];
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No restriction change was provided.' });
    const { data: updated, error: updateError } = await supabase.from('account_restrictions').update(patch).eq('id', existing.id).select().single();
    if (updateError) throw new Error(updateError.message);
    if (patch.active === false) await dbCreateFreqNotice({ recipientUsername: existing.username, createdBy: req._adminSession.username, noticeType: 'restriction', severity: 'update', title: 'FREQ Notice · Restriction Lifted', body: `Your account restriction has been lifted.\n\n${patch.lift_reason}`, relatedResourceType: 'account_restriction', relatedResourceId: existing.id });
    return res.json({ restriction: updated });
  } catch (error) {
    return res.status(500).json({ error: 'Could not update this restriction.' });
  }
});

app.post('/api/restrictions/:id/appeal', rateLimit, async (req, res) => {
  const sess = await requireMessagingSession(req, res, { verifiedEmail: true });
  if (!sess) return;
  const statement = normalizeMessageText(req.body?.statement);
  if (statement.length < 20) return res.status(400).json({ error: 'Tell us why the decision should be reviewed (at least 20 characters).' });
  try {
    const { data: restriction, error } = await supabase.from('account_restrictions').select('*').eq('id', req.params.id).eq('username', sess.username).maybeSingle();
    if (error) throw new Error(error.message);
    if (!restriction || !restriction.appeal_allowed) return res.status(404).json({ error: 'This restriction cannot be appealed here.' });
    const { data: appeal, error: appealError } = await supabase.from('restriction_appeals').insert({ restriction_id: restriction.id, username: sess.username, statement }).select().single();
    if (appealError) {
      if (appealError.code === '23505') return res.status(409).json({ error: 'An appeal is already under review.' });
      throw new Error(appealError.message);
    }
    return res.status(201).json({ appeal: { id: appeal.id, status: appeal.status, createdAt: appeal.created_at } });
  } catch (error) {
    return res.status(500).json({ error: 'Could not submit this appeal.' });
  }
});

app.patch('/api/admin/restrictions/appeals/:id', rateLimit, requireAdmin, async (req, res) => {
  const decision = String(req.body?.decision || '').toLowerCase();
  if (!['approved','denied'].includes(decision)) return res.status(400).json({ error: 'Decision must be approved or denied.' });
  try {
    const { data: appeal, error } = await supabase.from('restriction_appeals').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!appeal) return res.status(404).json({ error: 'Appeal not found.' });
    const decisionReason = normalizeMessageText(req.body?.decisionReason).slice(0, 4000) || null;
    const { data: updated, error: updateError } = await supabase.from('restriction_appeals').update({ status: decision, decision_reason: decisionReason, decided_by: req._adminSession.username, decided_at: new Date().toISOString() }).eq('id', appeal.id).select().single();
    if (updateError) throw new Error(updateError.message);
    if (decision === 'approved') await supabase.from('account_restrictions').update({ active: false, lifted_by: req._adminSession.username, lifted_at: new Date().toISOString(), lift_reason: decisionReason || 'Appeal approved.' }).eq('id', appeal.restriction_id);
    await dbCreateFreqNotice({ recipientUsername: appeal.username, createdBy: req._adminSession.username, templateKey: 'appeal_decision', values: { decision, decisionReason, appealId: appeal.id }, relatedResourceType: 'restriction_appeal', relatedResourceId: appeal.id, auditRequired: true });
    return res.json({ appeal: updated });
  } catch (error) {
    return res.status(500).json({ error: 'Could not decide this appeal.' });
  }
});

app.get('/api/admin/messages/reports', rateLimit, requireAdmin, async (req, res) => {
  const status = ['open','reviewing','actioned','dismissed'].includes(req.query.status) ? req.query.status : 'open';
  try {
    const { data, error } = await supabase.from('message_reports').select('*').eq('status', status).order('created_at').limit(200);
    if (error) throw new Error(error.message);
    return res.json({ reports: (data || []).map(row => ({ id: row.id, reporterUsername: row.reporter_username, reportedUsername: row.reported_username, category: row.category, detail: row.detail, snapshot: row.moderation_snapshot, status: row.status, createdAt: row.created_at })) });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load message reports.' });
  }
});

app.patch('/api/admin/messages/reports/:id', rateLimit, requireAdmin, async (req, res) => {
  const status = String(req.body?.status || 'reviewing');
  if (!['reviewing','actioned','dismissed'].includes(status)) return res.status(400).json({ error: 'Invalid report status.' });
  try {
    const { data: report, error } = await supabase.from('message_reports').update({ status, assigned_to: req._adminSession.username, resolved_at: ['actioned','dismissed'].includes(status) ? new Date().toISOString() : null }).eq('id', req.params.id).select().maybeSingle();
    if (error) throw new Error(error.message);
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    await supabase.from('moderation_message_actions').insert({ conversation_id: report.conversation_id, message_id: report.message_id, target_username: report.reported_username, actor_username: req._adminSession.username, action: 'resolve_report', reason: normalizeMessageText(req.body?.reason).slice(0, 2000) || null, private_note: normalizeMessageText(req.body?.privateNote).slice(0, 2000) || null, snapshot: report.moderation_snapshot });
    return res.json({ report: { id: report.id, status: report.status } });
  } catch (error) {
    return res.status(500).json({ error: 'Could not update this report.' });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵  FREQ v4.6 "The Platform" is running`);
  console.log(`    Local:  http://localhost:${PORT}`);
  console.log(`    Health: http://localhost:${PORT}/health`);
  console.log(`    Store:  Supabase (persistent)`);
  console.log(`    © 2025–2026 FREQ / Slimey2017. All rights reserved.\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is already in use.\n   Run:  PORT=3001 node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
