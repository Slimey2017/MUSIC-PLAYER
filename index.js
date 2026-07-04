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

// Registry of all known providers, keyed by the same string stored in
// accounts.premium_provider / premium_subscriptions.provider.
const PROVIDERS = {
  gumroad,
  // stripe:        require('./stripe'),        // future
  // paddle:        require('./paddle'),        // future
  // lemonsqueezy:  require('./lemonsqueezy'),   // future
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
