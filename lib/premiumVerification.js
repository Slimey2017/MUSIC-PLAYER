/**
 * FREQ Premium — verification orchestrator
 * ─────────────────────────────────────────────────────────────────────────
 * This is the single place that decides "is this account Premium right
 * now?" by asking a provider (Gumroad today; Stripe/Paddle/Lemon Squeezy
 * are drop-in additions later — see lib/premium-providers/index.js) and
 * writing the result back to Supabase. Nothing else in server.js talks to
 * a payment provider's API directly.
 *
 * Replaces the old webhook flow entirely:
 *   - No signature verification, no event-type parsing, no "which webhook
 *     event means what" guesswork.
 *   - FREQ pulls status instead of waiting for a push, so a purchase made
 *     while FREQ was down, a webhook that never arrived, or a delivery
 *     that Gumroad gave up retrying can't leave an account stuck.
 *   - The `premium_subscriptions` / `accounts.premium_*` schema is
 *     unchanged — this only changes *how* those columns get written, not
 *     what they mean or how the rest of the app reads them.
 *
 * Exposes two entry points server.js uses:
 *
 *   verifyPremiumNow(supabase, account, { forceProvider, emailOverride }?)
 *     Does a live provider lookup right now and applies the result.
 *     Used by POST /api/premium/verify (checkout-return / manual "I just
 *     paid" flow) — this is deliberately eager and un-throttled since it's
 *     user-initiated and low-frequency by nature (one click after paying).
 *     emailOverride lets the caller supply the email the customer says they
 *     paid with for *this* lookup, without requiring it to already be saved
 *     as accounts.premium_email — see the "Already purchased?" box, which
 *     is exactly for the case where the account's email (if any) doesn't
 *     match what was used at checkout.
 *
 *   verifyPremiumIfDue(supabase, account)
 *     Only re-verifies if enough time has passed since the last check
 *     (PREMIUM_REVERIFY_INTERVAL_MS). Used on every login/session-restore
 *     so cancelled memberships get reflected automatically without
 *     hammering the provider's API on every single request.
 */

'use strict';

const { getProvider, getConfiguredProviders } = require('./premium-providers');

// How often a logged-in session's Premium status gets silently re-verified
// against the provider. Short enough that a cancellation shows up within a
// day; long enough that normal usage (multiple logins/pulls per day) does
// not turn into a Gumroad API call on every request.
const PREMIUM_REVERIFY_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

function isoNow() {
  return new Date().toISOString();
}

/**
 * Applies a NormalizedMembership (see premium-providers/index.js) to the
 * database: flips accounts.is_premium on, updates plan/provider metadata,
 * and upserts the matching premium_subscriptions row. Uses the *same*
 * helper functions the old webhook path used, so the schema and the shape
 * of what gets written are unchanged.
 */
async function activateFromMembership(db, username, membership) {
  const {
    dbGetPremiumSubscription,
    dbCreatePremiumSubscription,
    dbActivatePremiumAccount,
    dbUpdatePremiumSubscriptionMetadata,
  } = db;

  const existing = await dbGetPremiumSubscription(membership.provider, membership.providerPurchaseId);

  await dbActivatePremiumAccount(
    username,
    membership.plan,
    membership.provider,
    membership.providerCustomerId,
    membership.providerPurchaseId,
    membership.purchaserEmail,
    membership.purchaseDate || isoNow(),
    {
      isPremium: true,
      status: membership.status || 'active',
      expiresAt: membership.expiresAt || null,
      graceUntil: membership.graceUntil || null,
      trialUntil: membership.trialUntil || null,
      // Billing cadence, used downstream only to *project* a next-renewal
      // date (purchaseDate + interval) — see the NormalizedMembership doc
      // comment in premium-providers/index.js. Always null-safe: a provider
      // that doesn't report a recognizable interval simply clears this.
      recurrence: membership.recurrence || null,
      lastEventType: 'api_verified',
    }
  );

  if (!existing) {
    await dbCreatePremiumSubscription({
      username,
      provider: membership.provider,
      providerCustomerId: membership.providerCustomerId,
      providerPurchaseId: membership.providerPurchaseId,
      purchaserEmail: membership.purchaserEmail,
      purchaseDate: membership.purchaseDate || isoNow(),
      plan: membership.plan,
      recurrence: membership.recurrence || null,
      // Informational only — see isSaleActiveMembership in gumroad.js.
      // Providers that don't have the concept of a test purchase simply
      // never set this on the membership, so it defaults to false/undefined
      // and the column's own DEFAULT false covers it.
      isTestPurchase: membership.isTestPurchase,
    });
  }

  await dbUpdatePremiumSubscriptionMetadata({
    username,
    provider: membership.provider,
    providerPurchaseId: membership.providerPurchaseId,
    status: membership.status || 'active',
    expiresAt: membership.expiresAt || null,
    graceUntil: membership.graceUntil || null,
    trialUntil: membership.trialUntil || null,
    recurrence: membership.recurrence || null,
    lastEventType: 'api_verified',
  });
}

/**
 * No active membership was found for an account that's currently marked
 * Premium via `provider`. Locks Premium back down and marks the
 * subscription row (if any) as inactive, rather than deleting history.
 */
async function revokeExpiredMembership(db, account) {
  const { dbActivatePremiumAccount, dbUpdatePremiumSubscriptionMetadata } = db;
  const username = account.username;
  const provider = account.premium_provider;
  const providerPurchaseId = account.premium_provider_purchase_id;

  await dbActivatePremiumAccount(
    username,
    account.premium_plan || null,
    provider,
    account.premium_provider_customer_id || null,
    providerPurchaseId || null,
    account.premium_email || null,
    account.premium_purchase_date || isoNow(),
    {
      isPremium: false,
      status: 'inactive',
      cancelledAt: isoNow(),
      lastEventType: 'api_verified_inactive',
    }
  );

  if (provider && providerPurchaseId) {
    await dbUpdatePremiumSubscriptionMetadata({
      username,
      provider,
      providerPurchaseId,
      status: 'canceled',
      cancelledAt: isoNow(),
      lastEventType: 'api_verified_inactive',
    });
  }
}

/**
 * Runs a live provider check for `account` right now and applies whatever
 * it finds. Tries the account's known provider first (if it has one from a
 * prior purchase); otherwise tries every configured provider in turn,
 * which covers a brand-new account that hasn't linked a provider yet.
 *
 * Returns { checked: true, isPremium, premiumStatus, provider } so callers
 * can respond to the client without a second DB read.
 */
async function verifyPremiumNow(db, account, opts = {}) {
  const username = db.normalizeUsername(account.username);
  // A user-supplied email for this one lookup (the "Already purchased?"
  // box) takes priority over whatever's on file — that's the whole point:
  // the account may have no premium_email yet, or one that doesn't match
  // what was actually used at checkout. Falls back to the saved value so
  // the existing throttled reverify-on-login path (which never passes
  // emailOverride) keeps working unchanged.
  const email = opts.emailOverride || account.premium_email || account.email || null;

  const providersToTry = [];
  if (opts.forceProvider) {
    const forced = getProvider(opts.forceProvider);
    if (forced) providersToTry.push(forced);
  } else if (account.premium_provider) {
    const known = getProvider(account.premium_provider);
    if (known) providersToTry.push(known);
  }
  // Always also try any other configured provider we haven't already tried,
  // so switching providers later (or a customer paying through a second
  // provider before the first is fully wired down) still resolves.
  for (const provider of getConfiguredProviders()) {
    if (!providersToTry.includes(provider)) providersToTry.push(provider);
  }

  let membership = null;
  let lastError = null;
  for (const provider of providersToTry) {
    try {
      membership = await provider.findActiveMembership({ username, email });
      if (membership) break;
    } catch (err) {
      lastError = err;
      console.error(`[premium verify] ${provider.name} lookup failed:`, err?.message || err);
    }
  }

  if (membership) {
    await activateFromMembership(db, username, membership);
  } else if (account.is_premium && !lastError) {
    // Only revoke on a *confirmed* "no active membership" answer — if every
    // provider call errored out (network issue, provider outage, bad
    // token), lastError is set and we deliberately leave the existing
    // Premium status untouched rather than locking someone out because of
    // a transient failure on our end.
    await revokeExpiredMembership(db, account);
  }

  const refreshed = await db.dbGetAccount(username);
  return {
    checked: true,
    erroredWithoutAnswer: !membership && !!lastError,
    isPremium: !!refreshed?.is_premium,
    premiumStatus: db.getPremiumStatusFromAccount(refreshed),
    provider: membership?.provider || refreshed?.premium_provider || null,
  };
}

/**
 * Re-verifies only if it's been long enough since the last check (or the
 * account has never been checked). Designed to be called on every
 * login/session-restore without needing to think about rate limiting at
 * each call site — this function is the throttle.
 *
 * Non-Premium accounts are skipped entirely (nothing to revoke, and no
 * sense spending a provider API call on someone who's never subscribed).
 */
async function verifyPremiumIfDue(db, account) {
  if (!account) return null;
  if (!account.is_premium) return null;
  if (!getConfiguredProviders().length) return null;

  const lastChecked = account.premium_last_verified_at ? new Date(account.premium_last_verified_at).getTime() : 0;
  const due = Date.now() - lastChecked > PREMIUM_REVERIFY_INTERVAL_MS;
  if (!due) return null;

  try {
    const result = await verifyPremiumNow(db, account);
    // Stamp the check time regardless of outcome (including "errored
    // without an answer") so a persistently-unreachable provider doesn't
    // turn into a verification attempt on every single login. Best-effort:
    // if premium_last_verified_at hasn't been migrated in yet, this quietly
    // no-ops (see dbTouchPremiumVerifiedAt) and every login simply re-checks
    // — correct, just not throttled, until the column exists.
    await db.dbTouchPremiumVerifiedAt(db.normalizeUsername(account.username));
    return result;
  } catch (err) {
    console.error('[premium verify] verifyPremiumIfDue failed:', err?.message || err);
    return null;
  }
}

module.exports = {
  verifyPremiumNow,
  verifyPremiumIfDue,
  PREMIUM_REVERIFY_INTERVAL_MS,
};
