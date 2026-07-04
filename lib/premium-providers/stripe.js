/**
 * FREQ Premium — Stripe provider (placeholder)
 * ─────────────────────────────────────────────────────────────────────────
 * Not implemented yet. Exists so the provider registry (index.js) can list
 * Stripe as a known provider without every call site needing a special
 * case for "this one isn't built." isConfigured() always returns false, so
 * getConfiguredProviders() in index.js will never select this provider or
 * call findActiveMembership() on it until it's actually implemented.
 *
 * To implement: mirror gumroad.js's shape exactly —
 *   - isConfigured()  → true once the required Stripe env vars are set
 *                        (e.g. STRIPE_SECRET_KEY + a way to identify the
 *                        Premium price/product, such as STRIPE_PRICE_ID)
 *   - findActiveMembership({ username, email }) → look up the customer by
 *     email (Stripe Customers API) and/or a metadata field carrying the
 *     FREQ username (set at Checkout via `metadata` or `client_reference_id`),
 *     then check for an active/trialing Subscription. Return a
 *     NormalizedMembership (see index.js) or null — never throw for "no
 *     membership found", only for a genuine API/config failure.
 * Then uncomment the `stripe: require('./stripe')` line in index.js.
 */

'use strict';

function isConfigured() {
  return false;
}

async function findActiveMembership(_params) {
  // Deliberately a no-op rather than a thrown error: isConfigured() already
  // returns false, so premiumVerification.js's getConfiguredProviders()
  // filter means this should never actually be invoked. Returning null
  // (not throwing) keeps that contract even if something calls it directly
  // during development/testing.
  return null;
}

module.exports = {
  name: 'stripe',
  isConfigured,
  findActiveMembership,
};
