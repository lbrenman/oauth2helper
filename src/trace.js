// src/trace.js
// In-memory "SAML-tracer"-style log of every outbound HTTP call the app
// makes, plus enough metadata to inspect what happened. Kept in memory
// only (cleared on server restart or via the Clear button) — this is a
// local debugging tool, not an audit log.

let entries = [];
let nextId = 1;

const SENSITIVE_KEYS = ['client_secret', 'code_verifier', 'password', 'refresh_token', 'access_token'];

// Masks sensitive fields in a plain object or URLSearchParams-like object.
// Keeps the first/last 3 chars so you can still tell values apart across
// requests without leaking the full secret into the browser.
function maskValue(v) {
  if (typeof v !== 'string' || v.length <= 8) return '••••••••';
  return `${v.slice(0, 3)}…${v.slice(-3)} (${v.length} chars)`;
}

function maskObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.includes(k) ? maskValue(v) : v;
  }
  return out;
}

function maskFormBody(bodyStr) {
  if (!bodyStr) return bodyStr;
  // Only touch this if it genuinely looks like an
  // application/x-www-form-urlencoded string (key=value&key=value...).
  // Anything else — plain informational text, a JSON post-token body,
  // free-form text — is left completely untouched. Previously this
  // always ran the string through URLSearchParams, which silently
  // mangled non-form text (e.g. turned "PKCE not used" into
  // "PKCE+not+used=").
  if (!/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(bodyStr)) {
    return bodyStr;
  }
  // Mask sensitive values in place, pair by pair, rather than round-
  // tripping the whole string through URLSearchParams (which would
  // re-encode every value and could alter formatting of the rest).
  return bodyStr.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) return pair;
    const rawKey = pair.slice(0, eq);
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    if (!SENSITIVE_KEYS.includes(key)) return pair;
    const rawValue = pair.slice(eq + 1);
    const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    return `${rawKey}=${encodeURIComponent(maskValue(value))}`;
  }).join('&');
}

/**
 * Add a trace entry.
 * entry: {
 *   type: 'authorize_redirect' | 'token_exchange' | 'refresh' | 'client_credentials' | 'post_token_call' | 'error',
 *   method, url, requestHeaders, requestBody,
 *   responseStatus, responseHeaders, responseBody,
 *   diagnostics: string[]
 * }
 */
function addEntry(entry) {
  const record = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    ...entry,
    requestHeaders: maskObject(entry.requestHeaders),
    requestBody: typeof entry.requestBody === 'string'
      ? maskFormBody(entry.requestBody)
      : maskObject(entry.requestBody),
  };
  entries.push(record);
  // Keep the log bounded so a long test session doesn't grow unbounded.
  if (entries.length > 200) entries = entries.slice(-200);
  return record;
}

function getEntries() {
  return entries;
}

function clear() {
  entries = [];
}

module.exports = { addEntry, getEntries, clear };
