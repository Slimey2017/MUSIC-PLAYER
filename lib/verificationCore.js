// lib/verificationCore.js

// Mirrors artist_verification_requests.status
const STATUS = {
  NOT_STARTED: 'not_started',
  EMAIL_VERIFIED: 'email_verified',
  CONSENT_GIVEN: 'consent_given',
  EVIDENCE_SUBMITTED: 'evidence_submitted',
  MANUAL_REVIEW: 'manual_review',
  VERIFIED: 'verified',
  REJECTED: 'rejected'
};

// Define valid transitions: source -> [allowed_destinations]
const ALLOWED_TRANSITIONS = {
  [STATUS.NOT_STARTED]: [STATUS.EMAIL_VERIFIED],
  [STATUS.EMAIL_VERIFIED]: [STATUS.CONSENT_GIVEN],
  [STATUS.CONSENT_GIVEN]: [STATUS.EVIDENCE_SUBMITTED],
  [STATUS.EVIDENCE_SUBMITTED]: [STATUS.MANUAL_REVIEW],
  [STATUS.MANUAL_REVIEW]: [STATUS.VERIFIED, STATUS.REJECTED],
  [STATUS.REJECTED]: [STATUS.EVIDENCE_SUBMITTED]
};

const CURRENT_CONSENT_VERSION = 'v1-2026-07';

function canTransition(currentStatus, nextStatus) {
  return ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) || false;
}

module.exports = {
  STATUS,
  ALLOWED_TRANSITIONS,
  CURRENT_CONSENT_VERSION,
  canTransition
};
