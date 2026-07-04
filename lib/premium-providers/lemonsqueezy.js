/**
 * FREQ Premium — Lemon Squeezy provider (placeholder)
 * ─────────────────────────────────────────────────────────────────────────
 * Not implemented yet — see stripe.js for the general shape a real
 * implementation should follow. isConfigured() always returns false here,
 * so this provider is never selected by getConfiguredProviders() in
 * index.js until it's built out.
 *
 * To implement: use the Lemon Squeezy REST API (https://api.lemonsqueezy.com/v1)
 * with a store API key. Match by purchaser email and/or a custom field /
 * checkout `checkout_data.custom` value carrying the FREQ username (set at
 * checkout time, mirroring how gumroad.js's "FREQ Username" custom field
 * works). An active membership is a Subscription with status "active" or
 * "on_trial" (Lemon Squeezy's trialing state) for the configured
 * variant/product ID. Return a NormalizedMembership (see index.js) or null.
 * Then uncomment the `lemonsqueezy: require('./lemonsqueezy')` line in index.js.
 */

'use strict';

function isConfigured() {
  return false;
}

async function findActiveMembership(_params) {
  return null;
}

module.exports = {
  name: 'lemonsqueezy',
  isConfigured,
  findActiveMembership,
};
