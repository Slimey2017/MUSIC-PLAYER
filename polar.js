/**
 * FREQ Premium — Polar provider (placeholder)
 * ─────────────────────────────────────────────────────────────────────────
 * Not implemented yet — see stripe.js for the general shape a real
 * implementation should follow. isConfigured() always returns false here,
 * so this provider is never selected by getConfiguredProviders() in
 * index.js until it's built out.
 *
 * To implement: use the Polar API (https://api.polar.sh) with an
 * organization access token. Match by purchaser email and/or checkout
 * metadata carrying the FREQ username. An active membership is a
 * Subscription with status "active" for the configured product/price ID.
 * Return a NormalizedMembership (see index.js) or null. Then uncomment
 * the `polar: require('./polar')` line in index.js.
 */

'use strict';

function isConfigured() {
  return false;
}

async function findActiveMembership(_params) {
  return null;
}

module.exports = {
  name: 'polar',
  isConfigured,
  findActiveMembership,
};
