/**
 * FREQ Premium — provider registry
 * ─────────────────────────────────────────────────────────────────────────
 * Every payment/membership provider (Gumroad, and later Stripe, Paddle,
 * Lemon Squeezy, etc.) implements the same small interface:
 *
 *   {
 *     name: 'gumroad',
 *     isConfigured(): boolean
 *     findActiveMembership({ username, email }): Promise<NormalizedMembership | null>
 *   }
 *
 * NormalizedMembership shape (what premiumVerification.js consumes — every
 * provider must translate its own API's response into exactly this):
 *   {
 *     provider:            'gumroad' | 'stripe' | ...
 *     providerCustomerId:  string | null   — provider's ID for the payer
 *     providerPurchaseId:  string          — provider's ID for the sale/subscription (required, used as the idempotency key in premium_subscriptions)
 *     purchaserEmail:      string | null
 *     plan:                string          — human-readable plan/tier name
 *     status:              'active' | 'grace_period' | 'trial'
 *     purchaseDate:        ISO string | null
 *     expiresAt:           ISO string | null
 *     graceUntil:          ISO string | null
 *     trialUntil:          ISO string | null
 *     isTestPurchase:      boolean | undefined  — optional; true if the provider flagged this as a test/sandbox purchase (e.g. Gumroad's sale.test). Purely informational — MUST NOT be used to deny/exclude a membership from being active; a provider's own test-purchase flow is expected to unlock Premium the same as a live purchase, since sellers need to be able to test their own checkout. Providers with no such concept simply omit this field.
 *   }
 *
 * Returning `null` means "no active membership found for this person" —
 * premiumVerification.js treats that as a signal to revoke Premium if the
 * account currently has it via this same provider.
 *
 * To add a new provider later: drop a new file next to gumroad.js
 * implementing this interface, then add one line to PROVIDERS below.
 * Nothing in server.js or premiumVerification.js needs to change.
 */

'use strict';

const gumroad = require('./gumroad');
const stripe = require('./stripe');
const lemonsqueezy = require('./lemonsqueezy');
const paddle = require('./paddle');
const polar = require('./polar');

// Registry of all known providers, keyed by the same string stored in
// accounts.premium_provider / premium_subscriptions.provider. Gumroad is
// the only one actually implemented today — the rest are safe placeholders
// (isConfigured() always false, so getConfiguredProviders() below never
// selects them) that exist so adding a real implementation later is a
// one-file change, not a registry restructure. See each file's header
// comment for what a real implementation needs to do.
const PROVIDERS = {
  gumroad,
  stripe,
  lemonsqueezy,
  paddle,
  polar,
};

function getProvider(name) {
  return PROVIDERS[String(name || '').toLowerCase()] || null;
}

// Providers that are actually configured (have the env vars they need) in
// this deployment — i.e. the ones worth checking when we don't yet know
// which provider a given account/purchase belongs to.
function getConfiguredProviders() {
  return Object.values(PROVIDERS).filter(p => {
    try { return p.isConfigured(); } catch (_e) { return false; }
  });
}

module.exports = { PROVIDERS, getProvider, getConfiguredProviders };
