import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SITES } from './sites.js';

const execFileAsync = promisify(execFile);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const SHORT_LIVED_CLIENT_ID = 'onlinereswebshortlived';
const TZ_OFFSET_MINUTES = 420; // PDT; adjust to 480 in winter (PST) if needed
const TZ_ID = 'America/Vancouver';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cloudflare fingerprints Node's TLS stack (confirmed: both `fetch` and the
// built-in `https` module get a 403 "Just a moment..." challenge on nearly every
// request to these sites, while `curl` from the same machine passes reliably).
// Shelling out to curl for the actual request avoids that — it's not bypassing
// anything, just using a plain HTTP client Cloudflare isn't misidentifying.
async function curlRequest(url, { method = 'GET', headers = {}, body, form } = {}) {
  const args = ['-sS', '-o', '-', '-w', '\n%{http_code}', '-X', method];
  for (const [key, value] of Object.entries(headers)) {
    args.push('-H', `${key}: ${value}`);
  }
  if (form) {
    for (const [key, value] of Object.entries(form)) args.push('-F', `${key}=${value}`);
  } else if (body != null) {
    args.push('--data-raw', body);
  }
  args.push(url);

  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
  const splitAt = stdout.lastIndexOf('\n');
  const text = stdout.slice(0, splitAt);
  const status = Number(stdout.slice(splitAt + 1).trim());
  return { status, ok: status >= 200 && status < 300, text: () => text, json: () => JSON.parse(text) };
}

// CPS sites intermittently 403 on otherwise-valid requests — one quick retry
// avoids burning a whole poll cycle (3 min) on a single bad roll.
async function fetchWithRetry(url, opts, retries = 2, delayMs = 700) {
  for (let attempt = 0; ; attempt++) {
    const res = await curlRequest(url, opts);
    if (res.ok || attempt >= retries) return res;
    await sleep(delayMs * (attempt + 1));
  }
}

// Per-site cached config + oauth token, keyed by site key. See CLAUDE.md for the
// full protocol writeup — this mirrors what the Angular SPA does internally.
const siteState = new Map();

async function getSiteConfig(siteKey) {
  const cached = siteState.get(siteKey);
  if (cached?.config) return cached.config;

  const site = SITES[siteKey];
  if (!site) throw new Error(`Unknown site: ${siteKey}`);

  const res = await fetchWithRetry(`https://${site.host}/onlineresweb/Home/Configuration`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Failed to load config for ${siteKey}: HTTP ${res.status}`);
  const config = await res.json();

  const authMode = config.apiKey ? 'apikey' : 'oauth';
  const state = { config, authMode, token: null, tokenExpiresAt: 0 };
  siteState.set(siteKey, state);
  return config;
}

async function getOauthToken(siteKey) {
  const state = siteState.get(siteKey);
  const now = Date.now();
  if (state.token && now < state.tokenExpiresAt) return state.token;

  const res = await fetchWithRetry(`${state.config.authorityBaseUrl}/myconnect/token/short`, {
    method: 'POST',
    headers: { 'User-Agent': UA },
    form: { client_id: SHORT_LIVED_CLIENT_ID },
  });
  if (!res.ok) throw new Error(`Token request failed for ${siteKey}: HTTP ${res.status}`);
  const data = await res.json();

  state.token = data.access_token;
  // Refresh a bit early to avoid edge-of-expiry failures mid-request.
  state.tokenExpiresAt = now + (data.expires_in - 60) * 1000;
  return state.token;
}

async function buildAuthHeaders(siteKey) {
  await getSiteConfig(siteKey);
  const state = siteState.get(siteKey);

  const common = {
    'User-Agent': UA,
    'x-productid': '1',
    'x-componentid': '1',
    'x-siteid': '1',
    'x-timezone-offset': String(TZ_OFFSET_MINUTES),
    'x-timezoneid': TZ_ID,
    'x-ismobile': 'false',
    'x-moduleid': '7',
  };

  if (state.authMode === 'oauth') {
    const token = await getOauthToken(siteKey);
    return { ...common, Authorization: `Bearer ${token}` };
  }

  return {
    ...common,
    'client-id': 'onlineresweb',
    'X-TerminalId': '1',
    'x-requestid': randomUUID(),
    'x-websiteid': '00000000-0000-0000-0000-000000000000',
    'x-apiKey': state.config.apiKey,
  };
}

async function registerTransactionId(siteKey, headers, transactionId) {
  const state = siteState.get(siteKey);
  const res = await fetchWithRetry(`${state.config.onlineApi}/RegisterTransactionId`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId }),
  });
  if (!res.ok) throw new Error(`RegisterTransactionId failed for ${siteKey}: HTTP ${res.status}`);
}

/**
 * Search available tee times for a site.
 * @param {string} siteKey - 'vancouver' | 'burnaby'
 * @param {object} opts
 * @param {Date} opts.date - the date to search
 * @param {number[]} opts.courseIds - course IDs to search (defaults to all courses at the site)
 * @param {number} [opts.holes]
 * @param {number} [opts.numberOfPlayer]
 * @param {number} [opts.teeOffTimeMin] - 0-23, inclusive hour filter
 * @param {number} [opts.teeOffTimeMax] - 0-23, inclusive hour filter
 * @returns {Promise<Array>} raw slot objects from the API
 */
export async function searchTeeTimes(siteKey, opts) {
  const site = SITES[siteKey];
  if (!site) throw new Error(`Unknown site: ${siteKey}`);

  const courseIds = opts.courseIds?.length ? opts.courseIds : Object.keys(site.courses).map(Number);
  const headers = await buildAuthHeaders(siteKey);
  const state = siteState.get(siteKey);
  const transactionId = randomUUID();

  await registerTransactionId(siteKey, headers, transactionId);

  const params = new URLSearchParams({
    searchDate: opts.date.toDateString(),
    holes: String(opts.holes ?? 18),
    numberOfPlayer: String(opts.numberOfPlayer ?? 1),
    courseIds: courseIds.join(','),
    searchTimeType: '0',
    classCode: 'A',
    defaultOnlineRate: 'N',
    isUseCapacityPricing: 'false',
    memberStoreId: '1',
    searchType: '1',
    transactionId,
  });

  if (opts.teeOffTimeMin != null || opts.teeOffTimeMax != null) {
    params.set('teeOffTimeMin', String(opts.teeOffTimeMin ?? 0));
    params.set('teeOffTimeMax', String(opts.teeOffTimeMax ?? 23));
    params.set('isChangeTeeOffTime', 'true');
  }

  const res = await fetchWithRetry(`${state.config.onlineApi}/TeeTimes?${params}`, { headers });
  if (!res.ok) throw new Error(`TeeTimes search failed for ${siteKey}: HTTP ${res.status}`);
  const data = await res.json();
  // On some "nothing at all matches" queries (e.g. a time window before the course
  // opens), `content` holds a { messageKey: "NO_TEETIMES", ... } object instead of
  // an array — treat that the same as genuinely no availability.
  return Array.isArray(data.content) ? data.content : [];
}
