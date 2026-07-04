/**
 * FREQ Premium — Gumroad provider
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies FREQ Premium membership status directly against Gumroad's
 * official REST API (https://api.gumroad.com/v2) instead of trusting
 * webhook payloads. This is a pull, not a push: FREQ asks Gumroad "does
 * this person have an active membership right now?" whenever it needs to
 * know, so there's nothing for Gumroad to deliver, sign, or for us to lose.
 *
 * Auth: a single seller access token (Settings → Advanced → Applications,
 * or an OAuth access token with the `view_sales` scope) in
 * GUMROAD_ACCESS_TOKEN. This token can only read/manage *your own* Gumroad
 * account's sales — it's not a per-customer secret, so it's safe to hold
 * server-side only, same as the Supabase service key.
 *
 * Matching strategy (in order):
 *   1. FREQ username, via the "FREQ Username" custom field collected at
 *      checkout (see index.html's pcoLaunchGumroad, which passes it as a
 *      URL param Gumroad turns into a custom field on the sale).
 *   2. Purchaser email, matched against accounts.premium_email or the
 *      email on file in premium_subscriptions for that username — used as
 *      a fallback for older purchases made before the custom field existed,
 *      or if a customer's browser stripped the query param.
 *
 * Membership vs. one-time sale: Gumroad memberships show up as regular
 * sales with subscription_id set. A sale is an ACTIVE membership if none
 * of subscription_ended_at / subscription_cancelled_at / subscription_failed_at
 * are set, and it isn't refunded/chargebacked. (subscription_cancelled_at
 * alone doesn't necessarily mean access ends immediately — Gumroad lets a
 * canceled membership run out its current paid period — but for FREQ's
 * purposes "canceled" is treated as immediately inactive, which is the
 * conservative/safe direction: worst case a canceling customer loses
 * access a few days before their period technically ends, rather than FREQ
 * granting extra free time it can't independently verify. If tracking the
 * exact paid-through date matters later, expiresAt below is populated from
 * the sale's timestamps so that logic can be layered on without another
 * schema change.)
 */

'use strict';

const GUMROAD_API_BASE = 'https://api.gumroad.com/v2';
const FREQ_USERNAME_FIELD_NAMES = new Set(['freq username', 'username']);

function isConfigured() {
  return !!(process.env.GUMROAD_ACCESS_TOKEN && (process.env.GUMROAD_PRODUCT_ID || process.env.GUMROAD_PRODUCT_IDS));
}

// Comma-separated list, e.g. GUMROAD_PRODUCT_IDS="abc123,def456" — lets one
// Gumroad account run several Premium-granting products (monthly + annual,
// a legacy SKU, a promo variant) without code changes.
function getProductIds() {
  const single = process.env.GUMROAD_PRODUCT_ID;
  const multi = process.env.GUMROAD_PRODUCT_IDS;
  const ids = new Set();
  if (single) ids.add(single.trim());
  if (multi) multi.split(',').map(s => s.trim()).filter(Boolean).forEach(id => ids.add(id));
  return Array.from(ids);
}

function getAccessToken() {
  return process.env.GUMROAD_ACCESS_TOKEN || null;
}

async function gumroadFetch(pathAndQuery) {
  const token = getAccessToken();
  if (!token) throw new Error('GUMROAD_ACCESS_TOKEN is not configured.');
  const url = `${GUMROAD_API_BASE}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  let body;
  try { body = await res.json(); } catch (_e) { body = null; }
  if (!res.ok || !body || body.success === false) {
    const message = body?.message || `Gumroad API request failed (HTTP ${res.status})`;
    throw new Error(message);
  }
  return body;
}

function extractCustomFieldUsername(sale) {
  const fields = sale?.custom_fields;
  if (Array.isArray(fields)) {
    for (const field of fields) {
      // Gumroad returns custom_fields as an array of { name, value } for
      // sales fetched via the API (distinct from the flat form-encoded
      // custom_fields[n][name]/[value] pairs seen in old webhook payloads).
      if (field && typeof field === 'object') {
        const name = String(field.name || '').trim().toLowerCase();
        if (FREQ_USERNAME_FIELD_NAMES.has(name) && typeof field.value === 'string' && field.value.trim()) {
          return field.value.trim();
        }
      }
    }
  } else if (fields && typeof fields === 'object') {
    // Defensive: some accounts see custom_fields as a plain object map
    // ({ "FREQ Username": "slimey2017" }) rather than an array.
    for (const [name, value] of Object.entries(fields)) {
      if (FREQ_USERNAME_FIELD_NAMES.has(String(name).trim().toLowerCase()) && typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

// A sale counts as an active membership if it's not refunded/chargebacked
// and its subscription hasn't ended/been cancelled/failed. Deliberately
// does NOT check sale.test: Gumroad sets test:true on purchases made with
// the seller's own "Test purchase" flow, and those are real rows in the
// same /v2/sales response as live sales — Gumroad's own API treats them
// identically to a live sale in every other respect (same fields, same
// subscription lifecycle). Excluding them here would mean a seller testing
// their own checkout could pay Gumroad's test-mode "purchase" and still not
// see Premium unlock, with no way to tell why. If test purchases ever need
// to be treated differently (e.g. flagged in the admin dashboard, or not
// counted toward real revenue metrics), do that downstream using the
// isTestPurchase flag on the normalized membership below — not by
// excluding them from being found as active in the first place.
function isSaleActiveMembership(sale) {
  if (!sale) return false;
  if (sale.refunded || sale.chargebacked) return false;
  if (sale.subscription_ended_at) return false;
  if (sale.subscription_cancelled_at) return false;
  if (sale.subscription_failed_at) return false;
  return true;
}

// Gumroad's `recurrence` field on a sale is one of a small fixed set of
// strings ("monthly", "quarterly", "biannually", "yearly" being the ones
// Gumroad's own product config offers). Normalized here to a canonical
// value so premiumVerification.js / server.js can compute a projected next
// renewal date (purchaseDate + interval) without needing to know Gumroad's
// exact vocabulary. Returns null for anything unrecognized rather than
// guessing — an unknown interval means "don't project a renewal date."
const RECURRENCE_MAP = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  biannually: 'biannually',
  'every 6 months': 'biannually',
  yearly: 'yearly',
  annually: 'yearly',
};

function normalizeRecurrence(sale) {
  const raw = String(sale?.recurrence || '').trim().toLowerCase();
  return RECURRENCE_MAP[raw] || null;
}

function normalizeSale(sale) {
  const purchaseId = sale.subscription_id || sale.id;
  return {
    provider: 'gumroad',
    providerCustomerId: sale.subscription_id || sale.id || null,
    providerPurchaseId: String(purchaseId),
    purchaserEmail: sale.email || null,
    plan: sale.tier_name || sale.variants || sale.product_name || 'FREQ Premium',
    status: 'active',
    purchaseDate: sale.created_at || sale.sale_timestamp || null,
    // Gumroad's public sales API doesn't return a forward-looking "next
    // charge date" for active memberships (only *_at timestamps once a
    // subscription has ended/cancelled/failed), so expiresAt stays null
    // for a currently-active membership — there's nothing to fill it with
    // that wouldn't be a guess. It gets populated the moment Gumroad
    // reports one of those end states, at which point the membership is
    // no longer active anyway and dbActivatePremiumAccount will be told
    // isPremium:false directly rather than relying on an expiry date.
    expiresAt: null,
    graceUntil: null,
    trialUntil: null,
    // Gumroad's billing cadence for this sale ("monthly", "yearly", etc), or
    // null if the API didn't report a recognizable value. Combined with
    // purchaseDate downstream to project an estimated next-renewal date —
    // never treated as an exact charge date, since Gumroad doesn't expose one.
    recurrence: normalizeRecurrence(sale),
    // Present only once a cancellation has actually been requested on
    // Gumroad's side (subscription_cancelled_at set). Distinct from
    // expiresAt/graceUntil: a cancelled Gumroad membership still runs out
    // its current paid period, so this is "when the cancellation was
    // requested," and the *projected* end-of-access date is computed
    // downstream from purchaseDate + recurrence, same as an active renewal
    // date would be.
    cancelledAt: sale.subscription_cancelled_at || null,
    // Passed straight through from Gumroad's sale.test flag. Doesn't affect
    // whether this membership is treated as active (see the comment on
    // isSaleActiveMembership above) — purely informational, so a real
    // purchase and a seller's own test purchase can still be told apart
    // later (admin dashboard, revenue reporting, etc.) without changing
    // whether either one unlocks Premium.
    isTestPurchase: !!sale.test,
    raw: { id: sale.id, subscription_id: sale.subscription_id || null, test: !!sale.test },
  };
}

// Fetches every sale for the configured product(s) matching either an email
// or (if provided) paginating through everything and filtering by the FREQ
// username custom field client-side, since Gumroad's /v2/sales endpoint
// only supports filtering by email/date/order_id/product_id server-side —
// there's no server-side "custom field equals" filter.
async function fetchCandidateSales({ username, email }) {
  const productIds = getProductIds();
  const sales = [];

  // Fast path: email filter is server-side and cheap, and covers most
  // returning customers (the email they paid with is usually the one on
  // file). We still fetch all matching product IDs since a customer may
  // have used one product ID historically and another after a SKU change.
  if (email) {
    if (productIds.length) {
      for (const productId of productIds) {
        const page = await gumroadFetch(`/sales?email=${encodeURIComponent(email)}&product_id=${encodeURIComponent(productId)}`);
        if (Array.isArray(page.sales)) sales.push(...page.sales);
      }
    } else {
      const page = await gumroadFetch(`/sales?email=${encodeURIComponent(email)}`);
      if (Array.isArray(page.sales)) sales.push(...page.sales);
    }
  }

  // If we still don't have a hit and a username was supplied, walk sales
  // for the configured product(s) page by page looking for a matching
  // "FREQ Username" custom field. This is the path that makes the "match
  // by FREQ username" requirement work even when the purchaser's Gumroad
  // account email differs from anything FREQ knows about. Bounded to a
  // handful of pages so an account with a very large sales history can't
  // turn a single login into an unbounded crawl.
  const alreadyMatchedByEmail = sales.some(s => isSaleActiveMembership(s) && (!username || extractCustomFieldUsername(s)?.toLowerCase() === username.toLowerCase()));
  if (username && !alreadyMatchedByEmail && productIds.length) {
    const MAX_PAGES = 5;
    for (const productId of productIds) {
      let pageKey = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = `/sales?product_id=${encodeURIComponent(productId)}${pageKey ? `&page_key=${encodeURIComponent(pageKey)}` : ''}`;
        const result = await gumroadFetch(query);
        const pageSales = Array.isArray(result.sales) ? result.sales : [];
        for (const sale of pageSales) {
          const saleUsername = extractCustomFieldUsername(sale);
          if (saleUsername && saleUsername.toLowerCase() === username.toLowerCase()) {
            sales.push(sale);
          }
        }
        pageKey = result.next_page_key || null;
        if (!pageKey) break;
        // Stop early once we've found an active match — no need to keep
        // paginating through years of sales history once we know.
        if (sales.some(isSaleActiveMembership)) break;
      }
    }
  }

  return sales;
}

/**
 * Looks up whether `username`/`email` currently has an active FREQ Premium
 * membership on Gumroad. Returns a NormalizedMembership (see index.js) or
 * null if nothing active was found.
 */
async function findActiveMembership({ username, email }) {
  if (!isConfigured()) return null;
  if (!username && !email) return null;

  const sales = await fetchCandidateSales({ username, email });
  if (!sales.length) return null;

  // Prefer the most recent sale/subscription that's still active — a
  // customer may have an old cancelled sale and a newer active one after
  // resubscribing, and created_at ordering isn't guaranteed by the API.
  const active = sales
    .filter(isSaleActiveMembership)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  if (!active.length) return null;
  return normalizeSale(active[0]);
}

module.exports = {
  name: 'gumroad',
  isConfigured,
  findActiveMembership,
  // Exported for tests / diagnostics — not part of the provider interface
  // other modules rely on.
  _internal: { isSaleActiveMembership, extractCustomFieldUsername, normalizeSale, normalizeRecurrence },
};
