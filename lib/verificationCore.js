/**
 * lib/verificationCore.js
 *
 * Backend helpers for the FREQ artist-verification pipeline: rate limiting,
 * duplicate detection, status transitions, encrypted document storage/
 * retrieval, mock face/liveness/manipulation-check adapters, and
 * verification/status transactional email.
 *
 * Extracted from the inline `fallbackVerificationCore` object that used to
 * live directly in server.js (server.js tried to `require('./lib/verificationCore')`
 * and silently fell back to that inline copy whenever this file was
 * missing — this file removes the need for that fallback).
 *
 * This module doesn't read process.env or hold module-level state for
 * secrets/config; the server wires those in via createVerificationCore()
 * below, so this file stays easy to test in isolation.
 */

const crypto = require('crypto');

const TERMINAL_STATUSES = new Set(['approved', 'rejected', 'revoked', 'expired']);
const EMAIL_TOKEN_TTL_HOURS = 24;
const CURRENT_CONSENT_VERSION = 'v1-2026-07';

const FREE_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

const LIVENESS_PROMPTS = [
  'Turn your head left, then smile',
  'Blink twice, then say your artist name',
  'Look up, then back at the camera',
];

const RETENTION_DAYS = 90; // matches typical KYC/AML minimum-retention practice; adjust if you have a specific policy

/**
 * @param {object} deps
 * @param {(args: { templateId: string, templateParams: object }) => Promise<{skipped: boolean}>} deps.sendEmailJs
 *   Low-level EmailJS sender (see server.js's sendEmailJs).
 * @param {string} deps.emailTemplateIdVerify   EmailJS template id for the initial/resend verification email.
 * @param {string} deps.emailTemplateIdStatus   EmailJS template id for status-change notifications.
 * @param {() => Buffer} deps.getVerificationDocKey
 *   Returns the 32-byte AES-256-GCM key for encrypting/decrypting verification
 *   documents. Should throw if VERIFICATION_DOC_ENCRYPTION_KEY isn't set —
 *   this module doesn't cache or read env vars itself.
 * @param {string} deps.verificationDocBucket   Supabase Storage bucket name for encrypted evidence (private bucket only).
 */
function createVerificationCore(deps) {
  const {
    sendEmailJs,
    emailTemplateIdVerify,
    emailTemplateIdStatus,
    getVerificationDocKey,
    verificationDocBucket,
  } = deps;

  if (typeof sendEmailJs !== 'function') throw new Error('createVerificationCore: deps.sendEmailJs is required.');
  if (typeof getVerificationDocKey !== 'function') throw new Error('createVerificationCore: deps.getVerificationDocKey is required.');
  if (!verificationDocBucket) throw new Error('createVerificationCore: deps.verificationDocBucket is required.');

  const core = {
    EMAIL_TOKEN_TTL_HOURS,
    CURRENT_CONSENT_VERSION,
    TERMINAL_STATUSES,

    classifyEmailDomainRisk(email) {
      const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
      if (!domain) return 'unknown';
      return FREE_EMAIL_PROVIDERS.has(domain) ? 'free_provider' : 'unknown';
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
          templateId: emailTemplateIdVerify,
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
          templateId: emailTemplateIdStatus,
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
      await core.logAction(supabase, { requestId, actor, action: 'status_changed', detail: { fromStatus, toStatus, ...detail } });
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
      const { error: uploadErr } = await supabase.storage.from(verificationDocBucket).upload(storagePath, ciphertext, {
        contentType: 'application/octet-stream', // ciphertext is opaque; real mimeType is stored separately for decrypt-time use
        upsert: false,
      });
      if (uploadErr) throw new Error(uploadErr.message);

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
        await supabase.storage.from(verificationDocBucket).remove([storagePath]).catch(() => {});
        throw new Error(error.message);
      }
      return data;
    },

    generateLivenessPrompt() {
      return LIVENESS_PROMPTS[Math.floor(Math.random() * LIVENESS_PROMPTS.length)];
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

      const { data: fileBlob, error: dlErr } = await supabase.storage.from(verificationDocBucket).download(data.storage_path);
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
        await core.logAction(supabase, {
          requestId: data.request_id, actor: accessorUsername, action: 'document_accessed', detail: { documentId, docType: data.doc_type },
        });
      }

      return { buffer, mimeType: data.mime_type || 'application/octet-stream', docType: data.doc_type };
    },

    async purgeDocument(supabase, documentId, meta = {}) {
      const { data: doc } = await supabase.from('verification_documents').select('storage_path, request_id, doc_type').eq('id', documentId).maybeSingle();
      if (doc?.storage_path) {
        await supabase.storage.from(verificationDocBucket).remove([doc.storage_path]).catch(() => {});
      }
      // Soft-delete (deleted_at) rather than hard DELETE — verification_review_log
      // and artist_verification_requests.id_document_file_id/selfie_file_id/
      // liveness_video_file_id may still reference this row by id via FK.
      const { error } = await supabase.from('verification_documents')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', documentId);
      if (error) throw new Error(error.message);

      if (doc?.request_id) {
        await core.logAction(supabase, {
          requestId: doc.request_id, actor: meta.actor || 'system',
          action: 'document_purged', detail: { documentId, docType: doc.doc_type, reason: meta.reason || 'unspecified' },
        });
      }
    },
  };

  return core;
}

module.exports = { createVerificationCore, TERMINAL_STATUSES, EMAIL_TOKEN_TTL_HOURS, CURRENT_CONSENT_VERSION };
