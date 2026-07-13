// lib/verificationCore.js
//
// Mirrors artist_verification_requests.status
//
// RECONCILED 2026-07-13: this used to define a different, shorter status set
// (email_verified/consent_given/evidence_submitted/verified) than the one the
// frontend (verification_frontend.js) actually renders against. That mismatch
// is why resend-email (and likely other status-gated routes) were silently
// failing every request — `request.status !== STATUS.EMAIL_PENDING` could
// never be true when EMAIL_PENDING didn't exist.
//
// This file is now the source of truth the frontend comment claims it is.
// If your DB enum (artist_verification_requests.status check constraint /
// Postgres enum type) doesn't already contain these exact string values,
// you MUST run a migration to add them before deploying this — canTransition
// and any INSERT/UPDATE using these constants will violate the DB constraint
// otherwise. See migration note at the bottom of this file.

const STATUS = {
  NOT_STARTED: 'not_started',
  EMAIL_PENDING: 'email_pending',
  EVIDENCE_REQUIRED: 'evidence_required',
  MORE_INFORMATION_REQUIRED: 'more_information_required',
  LIVENESS_PENDING: 'liveness_pending',
  AUTOMATED_REVIEW: 'automated_review',
  MANUAL_REVIEW: 'manual_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REVOKED: 'revoked',
  EXPIRED: 'expired'
};

// Define valid transitions: source -> [allowed_destinations]
//
// Consent is NOT a separate pipeline status (the frontend has no consent
// step UI) — it's recorded as fields on the request row instead:
//   consentVersion: string | null
//   consentedAt: timestamp | null
// A request must have consentVersion === CURRENT_CONSENT_VERSION before the
// EMAIL_PENDING -> EVIDENCE_REQUIRED transition is allowed. Enforce that in
// the route handler (or add a second guard fn here) — canTransition() below
// only checks the state graph, not this field, so don't rely on it alone
// for that gate.
const ALLOWED_TRANSITIONS = {
  [STATUS.NOT_STARTED]: [STATUS.EMAIL_PENDING],
  [STATUS.EMAIL_PENDING]: [STATUS.EVIDENCE_REQUIRED, STATUS.EXPIRED],
  [STATUS.EVIDENCE_REQUIRED]: [STATUS.LIVENESS_PENDING, STATUS.EXPIRED],
  [STATUS.MORE_INFORMATION_REQUIRED]: [STATUS.LIVENESS_PENDING, STATUS.EXPIRED],
  [STATUS.LIVENESS_PENDING]: [STATUS.AUTOMATED_REVIEW, STATUS.EXPIRED],
  [STATUS.AUTOMATED_REVIEW]: [STATUS.MANUAL_REVIEW, STATUS.APPROVED, STATUS.REJECTED],
  [STATUS.MANUAL_REVIEW]: [STATUS.APPROVED, STATUS.REJECTED, STATUS.MORE_INFORMATION_REQUIRED],
  [STATUS.APPROVED]: [STATUS.REVOKED],
  [STATUS.REJECTED]: [STATUS.MORE_INFORMATION_REQUIRED],
  [STATUS.REVOKED]: [],
  [STATUS.EXPIRED]: [STATUS.EMAIL_PENDING] // "start again" per verificationClaimIntroHtml(true)
};

// Statuses where resend-email is a valid action. Only EMAIL_PENDING has an
// unconfirmed email link to resend — this is the guard the resend-email
// route should use instead of a bare inequality check.
const RESENDABLE_STATUSES = [STATUS.EMAIL_PENDING];

const CURRENT_CONSENT_VERSION = 'v1-2026-07';

function canTransition(currentStatus, nextStatus) {
  return ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) || false;
}

function canResendEmail(currentStatus) {
  return RESENDABLE_STATUSES.includes(currentStatus);
}

module.exports = {
  STATUS,
  ALLOWED_TRANSITIONS,
  RESENDABLE_STATUSES,
  CURRENT_CONSENT_VERSION,
  canTransition,
  canResendEmail
};

/*
MIGRATION NOTE:
If artist_verification_requests.status is a Postgres enum type, e.g.:

  CREATE TYPE verification_status AS ENUM (
    'not_started', 'email_verified', 'consent_given',
    'evidence_submitted', 'manual_review', 'verified', 'rejected'
  );

you'll need to ALTER TYPE to add the new values (Postgres can't remove/rename
enum values in a transaction pre-15, so add-only, then backfill/rename in a
follow-up):

  ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'email_pending';
  ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'evidence_required';
  ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'more_information_required';
  ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'liveness_pending';
  ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'automated_review';
  ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'approved';
  ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'revoked';
  ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'expired';

Then migrate any existing rows off the old values before dropping them:
  email_verified      -> email_pending  (if truly unconfirmed) or evidence_required (if already past that point — check consentedAt)
  consent_given        -> evidence_required
  evidence_submitted    -> liveness_pending  (or automated_review, depending on where your pipeline actually left off)
  verified              -> approved

If status is just a text/varchar column with a CHECK constraint instead,
update the constraint's allowed-values list the same way — no enum ALTER
needed, just a normal migration + backfill UPDATE.

I don't have your schema file, so confirm the actual column type/constraint
before running anything — this note is a best guess from the frontend/backend
status strings alone.
*/
