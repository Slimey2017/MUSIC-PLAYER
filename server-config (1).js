'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

function createSupabaseClientFromEnv(env = process.env) {
  const url = env.SUPABASE_URL && String(env.SUPABASE_URL).trim();
  const serviceKey = env.SUPABASE_SERVICE_KEY && String(env.SUPABASE_SERVICE_KEY).trim();

  if (!url || !serviceKey) {
    console.warn('[startup] Supabase env vars are missing; database-backed routes will be unavailable until configured.');
    return null;
  }

  try {
    return createClient(url, serviceKey);
  } catch (err) {
    console.warn('[startup] Unable to initialize Supabase client:', err?.message || err);
    return null;
  }
}

function createFallbackSupabaseClient(options = {}) {
  const dataFilePath = options.dataFilePath || path.join(process.cwd(), '.freq-local-store.json');
  const ensureStore = () => {
    if (!fs.existsSync(dataFilePath)) {
      fs.writeFileSync(dataFilePath, JSON.stringify({ accounts: [], sessions: [], playlists: [], premium_subscriptions: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
  };

  const saveStore = store => fs.writeFileSync(dataFilePath, JSON.stringify(store, null, 2));
  const makeResponse = (data, error = null) => ({ data, error });
  const normalizeRows = rows => Array.isArray(rows) ? rows.filter(Boolean) : [];

  // Tables where a column must be unique, mirroring the unique constraints
  // that exist on the real Supabase tables. Without this, insert() would
  // silently create duplicate rows (e.g. multiple accounts with the same
  // username) instead of erroring like Postgres would.
  const UNIQUE_KEYS = {
    accounts: 'username',
    sessions: 'token',
  };

  const createQueryBuilder = (table, state, rows = [], pendingPatch = null, pendingError = null) => {
    const currentRows = normalizeRows(rows);

    const builder = {
      select: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      insert: payload => {
        const list = Array.isArray(payload) ? payload : [payload];
        const uniqueKey = UNIQUE_KEYS[table];
        const existingRows = normalizeRows(state[table]);

        if (uniqueKey) {
          const existingValues = new Set(existingRows.map(row => row[uniqueKey]));
          const incomingValues = new Set();
          for (const item of list) {
            const value = item[uniqueKey];
            if (value === undefined || value === null) continue;
            if (existingValues.has(value) || incomingValues.has(value)) {
              return createQueryBuilder(table, state, [], null, {
                message: `duplicate key value violates unique constraint "${table}_${uniqueKey}_key"`,
                code: '23505',
                details: `Key (${uniqueKey})=(${value}) already exists.`,
              });
            }
            incomingValues.add(value);
          }
        }

        const created = list.map(item => ({ ...item, id: `${table}-${Date.now()}-${Math.random().toString(16).slice(2)}` }));
        state[table] = [...existingRows, ...created];
        saveStore(state);
        return createQueryBuilder(table, state, created);
      },
      upsert: (payload, upsertOptions = {}) => {
        const list = Array.isArray(payload) ? payload : [payload];
        // onConflict can be a single column or a comma-separated composite
        // key (e.g. 'playlist_id,username'), matching Supabase's API.
        const conflictKeys = (upsertOptions.onConflict || UNIQUE_KEYS[table] || 'id')
          .split(',').map(k => k.trim()).filter(Boolean);
        const existingRows = normalizeRows(state[table]);

        const matches = (row, item) => conflictKeys.every(key => row[key] === item[key]);

        const resultRows = [];
        let nextRows = existingRows.slice();

        for (const item of list) {
          const matchIdx = nextRows.findIndex(row => matches(row, item));
          if (matchIdx !== -1) {
            if (upsertOptions.ignoreDuplicates) {
              resultRows.push(nextRows[matchIdx]);
              continue;
            }
            const updatedRow = { ...nextRows[matchIdx], ...item };
            nextRows[matchIdx] = updatedRow;
            resultRows.push(updatedRow);
          } else {
            const createdRow = { ...item, id: item.id || `${table}-${Date.now()}-${Math.random().toString(16).slice(2)}` };
            nextRows = [...nextRows, createdRow];
            resultRows.push(createdRow);
          }
        }

        state[table] = nextRows;
        saveStore(state);
        return createQueryBuilder(table, state, resultRows);
      },
      update: patch => createQueryBuilder(table, state, currentRows, patch, pendingError),
      delete: () => {
        const remaining = normalizeRows(state[table]).filter(row => !currentRows.some(current => current.id && row.id && current.id === row.id));
        state[table] = remaining;
        saveStore(state);
        return Promise.resolve(makeResponse([]));
      },
      eq: (field, value) => {
        const filtered = currentRows.filter(row => row[field] === value);
        if (pendingPatch) {
          const updated = normalizeRows(state[table]).map(row => (filtered.some(match => match.id && row.id && match.id === row.id) ? ({ ...row, ...pendingPatch }) : row));
          state[table] = updated;
          saveStore(state);
          return Promise.resolve(makeResponse(updated.filter(row => filtered.some(match => match.id && row.id && match.id === row.id))));
        }
        return createQueryBuilder(table, state, filtered, null, pendingError);
      },
      gte: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      lte: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      gt: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      lt: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      like: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      ilike: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      in: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      contains: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      overlaps: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      order: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      limit: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      range: () => createQueryBuilder(table, state, currentRows, pendingPatch, pendingError),
      maybeSingle: () => Promise.resolve(pendingError ? makeResponse(null, pendingError) : makeResponse(currentRows[0] || null)),
      single: () => Promise.resolve(pendingError ? makeResponse(null, pendingError) : makeResponse(currentRows[0] || null)),
      then: (resolve, reject) => Promise.resolve(pendingError ? makeResponse(null, pendingError) : makeResponse(currentRows)).then(resolve, reject),
      catch: reject => Promise.resolve(pendingError ? makeResponse(null, pendingError) : makeResponse(currentRows)).catch(reject),
      finally: cb => Promise.resolve(pendingError ? makeResponse(null, pendingError) : makeResponse(currentRows)).finally(cb),
    };

    return builder;
  };

  return {
    from: table => createQueryBuilder(table, ensureStore(), normalizeRows(ensureStore()[table])),
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    rpc: async () => ({ data: null, error: null }),
  };
}

module.exports = {
  createSupabaseClientFromEnv,
  createFallbackSupabaseClient,
};
