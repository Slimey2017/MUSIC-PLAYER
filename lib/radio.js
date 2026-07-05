/**
 * FREQ Real-Life Radio (PTB) — Radio Browser API client
 * ─────────────────────────────────────────────────────────────────────────
 * Talks to the free, public Radio Browser directory (https://api.radio-browser.info)
 * server-side only — the client never calls Radio Browser directly, both so
 * every playable stream URL passes through requirePremium (see server.js's
 * /api/radio/* routes) and so this can add caching/fallback-host handling
 * in one place without the frontend needing to know about any of it.
 *
 * Radio Browser is a DNS round-robin of several independently-run mirror
 * servers, not one fixed host — the documented way to use it is to resolve
 * the SRV/A record for `all.api.radio-browser.info` and pick a host from
 * the result, since any single mirror can be slow or briefly down. This
 * module keeps it simpler and more robust for a single Node process: it
 * tries a short static list of known-stable mirrors in order and falls
 * over to the next one on failure, rather than doing DNS SRV resolution.
 * This trades "perfectly load-balanced" for "no extra DNS dependency and a
 * predictable retry path" — reasonable for FREQ's call volume.
 *
 * Every request sends a descriptive User-Agent, per Radio Browser's own
 * request ("send a descriptive User-Agent... something like
 * appname/appversion") — not for auth, just good API citizenship, same
 * spirit as the FREQ Username custom field convention in gumroad.js.
 *
 * NOTHING here writes to FREQ's own tracks/track_plays/charts tables.
 * Radio playback is intentionally invisible to Community Charts and
 * artist/track play counts — see radio_recent_plays / radio_favorites in
 * server.js instead, which are separate tables for exactly this reason.
 */

'use strict';

const USER_AGENT = 'FREQ-RealLifeRadio/1.0 (https://freq.app)';

// Ordered by general reliability/uptime observed across the mirror pool.
// If every mirror in this list is ever simultaneously down, callers get a
// clear "radio directory unavailable" error rather than a silent hang —
// see radioFetch's final throw below.
const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

const REQUEST_TIMEOUT_MS = 8000;

function isConfigured() {
  // No API key/token exists for Radio Browser — it's a fully open public
  // API. "Configured" here just means the feature is enabled at all, which
  // today is unconditional. Kept as a function (rather than a bare `true`)
  // so a future kill-switch env var (e.g. RADIO_FEATURE_ENABLED=false) is a
  // one-line change, matching the isConfigured() shape every other
  // provider module in this codebase already follows.
  return true;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Tries each mirror in turn for the same path+query, returning the first
// successful JSON response. A "successful" response is HTTP 2xx with a
// body that parses as JSON — Radio Browser mirrors occasionally return an
// HTML error page instead of JSON when overloaded, which JSON.parse
// catches and this treats as a failure worth retrying on the next mirror.
async function radioFetch(pathAndQuery) {
  let lastError = null;
  for (const base of MIRRORS) {
    try {
      const res = await fetchWithTimeout(`${base}${pathAndQuery}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) { lastError = new Error(`Radio directory returned HTTP ${res.status}`); continue; }
      const data = await res.json();
      return data;
    } catch (err) {
      lastError = err;
      // Try the next mirror.
    }
  }
  throw lastError || new Error('Radio directory is unavailable right now.');
}

// ─── Normalization ──────────────────────────────────────────────────────
// Radio Browser's raw station fields are translated here into the flat
// shape server.js/index.html actually use, so every call site (search,
// popular, favorites hydration) hands the frontend one consistent object
// regardless of which underlying field name Radio Browser used.
function normalizeStation(raw) {
  if (!raw) return null;
  const streamUrl = raw.url_resolved || raw.urlResolved || raw.url || null;
  if (!streamUrl) return null; // no playable URL at all — not worth returning
  return {
    stationUuid: raw.stationuuid || raw.id || null,
    name: (raw.name || 'Unknown Station').trim(),
    streamUrl,
    homepageUrl: raw.homepage || null,
    faviconUrl: raw.favicon || null,
    country: raw.country || null,
    countryCode: raw.countrycode || null,
    language: raw.language || null,
    tags: raw.tags || '',
    codec: raw.codec || null,
    bitrate: typeof raw.bitrate === 'number' ? raw.bitrate : (Number(raw.bitrate) || null),
    votes: typeof raw.votes === 'number' ? raw.votes : (Number(raw.votes) || 0),
    clickCount: typeof raw.clickcount === 'number' ? raw.clickcount : (Number(raw.clickcount) || 0),
    lastCheckOk: raw.lastcheckok === 1 || raw.lastcheckok === '1' || raw.lastcheckok === true,
  };
}

function normalizeStationList(rawList) {
  return (Array.isArray(rawList) ? rawList : [])
    .map(normalizeStation)
    .filter(Boolean)
    // Drop stations Radio Browser's own uptime checker has already flagged
    // as failing — surfacing them just means a user hits the "station
    // unavailable" error more often than necessary. lastCheckOk is best-
    // effort (checked ~daily by Radio Browser, not live), so this is a
    // filter, not a guarantee — the frontend's own play-error handling is
    // still the real safety net for a station that goes down between checks.
    .filter(s => s.lastCheckOk);
}

const MAX_LIMIT = 100;
function clampLimit(limit, fallback = 30) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * General search across name/tag/country/language/codec, any subset of
 * which may be supplied. Mirrors Radio Browser's own /json/stations/search
 * endpoint parameters directly (it already supports combining all of
 * these server-side) rather than fetching broad and filtering client-side.
 */
async function searchStations({ name, tag, country, countryCode, language, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (tag) params.set('tag', tag);
  if (country) params.set('country', country);
  if (countryCode) params.set('countrycode', countryCode);
  if (language) params.set('language', language);
  params.set('limit', String(clampLimit(limit)));
  params.set('offset', String(Math.max(0, Number(offset) || 0)));
  params.set('hidebroken', 'true');
  params.set('order', 'clickcount');
  params.set('reverse', 'true');

  const data = await radioFetch(`/json/stations/search?${params.toString()}`);
  return normalizeStationList(data);
}

/**
 * Popular / featured stations — ordered by Radio Browser's own click
 * count, which is a real signal (listeners across every app using Radio
 * Browser, not just FREQ) rather than something FREQ would need to
 * maintain itself.
 */
async function getPopularStations({ limit } = {}) {
  const params = new URLSearchParams({
    limit: String(clampLimit(limit, 20)),
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
  });
  const data = await radioFetch(`/json/stations/search?${params.toString()}`);
  return normalizeStationList(data);
}

async function getTopVotedStations({ limit } = {}) {
  const params = new URLSearchParams({
    limit: String(clampLimit(limit, 20)),
    hidebroken: 'true',
    order: 'votes',
    reverse: 'true',
  });
  const data = await radioFetch(`/json/stations/search?${params.toString()}`);
  return normalizeStationList(data);
}

async function getStationByUuid(stationUuid) {
  if (!stationUuid) return null;
  const data = await radioFetch(`/json/stations/byuuid/${encodeURIComponent(stationUuid)}`);
  const list = normalizeStationList(data);
  return list[0] || null;
}

/**
 * Returns the list of tags (genres), sorted by station count descending,
 * trimmed to the top N — Radio Browser's full tag list runs into the tens
 * of thousands of entries (many junk/one-off), which is useless as a
 * browse UI. Also filters out empty-string / whitespace-only tag names,
 * which the raw API does return.
 */
async function getTags({ limit } = {}) {
  const data = await radioFetch(`/json/tags?order=stationcount&reverse=true&limit=${clampLimit(limit, 60)}`);
  return (Array.isArray(data) ? data : [])
    .map(t => ({ name: String(t.name || '').trim(), stationCount: Number(t.stationcount) || 0 }))
    .filter(t => t.name);
}

/**
 * Countries with at least one station, sorted by station count descending.
 * Radio Browser's /json/countries already aggregates this — no need to
 * paginate all stations client-side to build the list ourselves.
 */
async function getCountries({ limit } = {}) {
  const data = await radioFetch(`/json/countries?order=stationcount&reverse=true&limit=${clampLimit(limit, 100)}`);
  return (Array.isArray(data) ? data : [])
    .map(c => ({ name: String(c.name || '').trim(), countryCode: c.iso_3166_1 || null, stationCount: Number(c.stationcount) || 0 }))
    .filter(c => c.name);
}

/**
 * Registers a "click" (play) with Radio Browser itself, per their own
 * request ("send /json/url requests for every click the user makes, this
 * helps to mark stations as popular"). Fire-and-forget from the caller's
 * point of view — a failure here should never block or fail FREQ's own
 * play flow, since this is purely a courtesy signal back to the directory,
 * not something FREQ's own recent-plays feature depends on.
 */
async function registerClick(stationUuid) {
  if (!stationUuid) return;
  try {
    await radioFetch(`/json/url/${encodeURIComponent(stationUuid)}`);
  } catch (_err) {
    // Best-effort only — see comment above.
  }
}

module.exports = {
  name: 'radio-browser',
  isConfigured,
  searchStations,
  getPopularStations,
  getTopVotedStations,
  getStationByUuid,
  getTags,
  getCountries,
  registerClick,
  // Exported for tests/diagnostics.
  _internal: { normalizeStation, normalizeStationList, clampLimit },
};
