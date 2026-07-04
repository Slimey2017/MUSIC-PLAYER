/**
 * FREQ Premium — Paddle provider (placeholder)
 * ─────────────────────────────────────────────────────────────────────────
 * Not implemented yet — see stripe.js for the general shape a real
 * implementation should follow. isConfigured() always returns false here,
 * so this provider is never selected by getConfiguredProviders() in
 * index.js until it's built out.
 *
 * To implement: use Paddle's Billing API with an API key. Match by
 * purchaser email (Customers API) and/or a `custom_data` field on the
 * transaction/subscription carrying the FREQ username. An active
 * membership is a Subscription with status "active" or "trialing" for the
 * configured price/product ID. Return a NormalizedMembership (see
 * index.js) or null. Then uncomment the `paddle: require('./paddle')`
 * line in index.js.
 */

'use strict';

function isConfigured() {
  return false;
}

async function findActiveMembership(_params) {
  return null;
}

module.exports = {
  name: 'paddle',
  isConfigured,
  findActiveMembership,
};
