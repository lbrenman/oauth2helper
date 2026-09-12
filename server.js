// server.js
// OAuth2Helper backend — a classic server-rendered multi-page app.
// Every route either renders a full HTML page or performs an action and
// redirects (Post/Redirect/Get). There is no client-side JavaScript and
// no JSON API: state changes happen through plain <form> POSTs and
// links. The actual OAuth HTTP calls still happen server-side (so
// client_secret never has to live in the browser), logged in full to
// an in-memory trace that's rendered directly into the page.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateCodeVerifier, generateCodeChallenge, generateState } = require('./src/pkce');
const trace = require('./src/trace');
const { analyzeFailure } = require('./src/diagnostics');
const { renderHomePage, renderHelpPage, renderAboutPage, renderDeleteConfirmPage } = require('./src/render');

const app = express();
const PORT = process.env.PORT || 3000;
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const SETTINGS_EXAMPLE_PATH = path.join(__dirname, 'settings.example.json');

// Trust the proxy so req.protocol / req.get('host') reflect the real
// external URL when running behind Codespaces port forwarding, ngrok,
// or any other reverse proxy that sets X-Forwarded-* headers.
app.set('trust proxy', true);

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// Minimal cookie handling (view-preference only: theme). No dependency
// needed for something this small.
// ---------------------------------------------------------------------

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function setCookie(res, name, value) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`);
}

function getTheme(req) {
  const theme = parseCookies(req).theme;
  return theme === 'light' ? 'light' : 'dark';
}

// ---------------------------------------------------------------------
// Settings persistence — multiple named profiles, e.g. "Keycloak -
// Client Credentials" and "Okta - Auth Code + PKCE", stored side by
// side in one settings.json so you can switch between test setups
// without overwriting each other. Only one profile is "active" at a
// time, matching the single in-memory token/trace session below.
// ---------------------------------------------------------------------

const PROFILE_FIELDS = [
  'providerType', 'providerName', 'grantType', 'authUrl', 'tokenUrl',
  'clientId', 'clientSecret', 'scope', 'usePkce', 'pkceMethod', 'redirectUri',
  'extraAuthParams', 'extraTokenParams', 'postTokenApiUrl',
  'postTokenApiMethod', 'postTokenApiHeaders', 'postTokenApiBody',
];

const BLANK_PROFILE_FIELDS = {
  providerType: 'generic',
  providerName: '',
  authUrl: '',
  tokenUrl: '',
  clientId: '',
  clientSecret: '',
  redirectUri: '',
  scope: 'openid profile email',
  grantType: 'authorization_code',
  usePkce: true,
  pkceMethod: 'S256',
  postTokenApiUrl: '',
  postTokenApiMethod: 'GET',
  postTokenApiHeaders: '',
  postTokenApiBody: '',
  extraAuthParams: '',
  extraTokenParams: '',
};

// Fields Client Credentials never uses — cleared whenever a save leaves
// the profile with that grant type, so a saved profile doesn't carry
// stale, irrelevant values.
const CC_UNUSED_FIELDS = ['redirectUri', 'usePkce', 'pkceMethod', 'extraAuthParams'];

function newProfileId() {
  return crypto.randomBytes(6).toString('hex');
}

// Reads one file and returns a valid {activeProfileId, profiles} store,
// or null if the file doesn't exist, isn't valid JSON, or doesn't
// contain at least one profile.
function readStoreFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw && Array.isArray(raw.profiles) && raw.profiles.length > 0) return raw;
  } catch (err) {
    // fall through to null below
  }
  return null;
}

// No auto-invented "Default" profile: if settings.json is missing,
// empty, or unreadable, this falls back to the real, named profiles in
// settings.example.json. Only if neither file yields anything usable
// does it fail loudly, rather than silently fabricating data.
function loadStore() {
  const store = readStoreFile(SETTINGS_PATH) || readStoreFile(SETTINGS_EXAMPLE_PATH);
  if (!store) {
    throw new Error(
      'No usable settings found. Copy settings.example.json to settings.json (or restore it) and restart the server.'
    );
  }
  if (!store.profiles.some((p) => p.id === store.activeProfileId)) {
    store.activeProfileId = store.profiles[0].id;
  }
  return store;
}

function saveStore(store) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function activeProfile(store) {
  return store.profiles.find((p) => p.id === store.activeProfileId) || null;
}

// Applies submitted form fields onto the active profile, clearing the
// Client-Credentials-unused fields when that grant type is in effect.
function saveActiveProfileFromBody(store, body) {
  const profile = activeProfile(store);
  if (!profile) return null;
  for (const f of PROFILE_FIELDS) {
    if (f === 'usePkce') continue; // handled below (checkbox semantics)
    if (body[f] !== undefined) profile[f] = body[f];
  }
  profile.usePkce = body.usePkce === '1' || body.usePkce === 'on';

  if (profile.grantType === 'client_credentials') {
    profile.redirectUri = '';
    profile.usePkce = false;
    profile.extraAuthParams = '';
  }
  saveStore(store);
  return profile;
}

// ---------------------------------------------------------------------
// Self-detected callback URL
// ---------------------------------------------------------------------

function detectBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------
// In-memory session state (single-user local dev tool — no need for a DB)
// ---------------------------------------------------------------------

let pendingAuth = null; // { state, codeVerifier, redirectUri, profileId, createdAt }
let currentToken = null; // last token response received

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------
// Shared token-endpoint request helper (used by every grant type)
// ---------------------------------------------------------------------

async function callTokenEndpoint({ tokenUrl, params, headers, type, providerType, grantType }) {
  const body = new URLSearchParams(params).toString();
  const reqHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };

  let responseStatus;
  let responseHeaders = {};
  let responseBodyText = '';
  let responseJson = null;

  try {
    const resp = await fetch(tokenUrl, { method: 'POST', headers: reqHeaders, body });
    responseStatus = resp.status;
    resp.headers.forEach((v, k) => { responseHeaders[k] = v; });
    responseBodyText = await resp.text();
    try { responseJson = JSON.parse(responseBodyText); } catch { /* not JSON */ }

    const ok = resp.ok;
    const diagnostics = ok ? [] : analyzeFailure({
      providerType,
      grantType,
      httpStatus: responseStatus,
      errorBody: responseJson || responseBodyText,
    });

    trace.addEntry({
      type,
      method: 'POST',
      url: tokenUrl,
      requestHeaders: reqHeaders,
      requestBody: body,
      responseStatus,
      responseHeaders,
      responseBody: responseJson || responseBodyText,
      diagnostics,
    });

    return { ok, status: responseStatus, json: responseJson, text: responseBodyText };
  } catch (err) {
    const diagnostics = analyzeFailure({
      providerType,
      grantType,
      httpStatus: 0,
      errorBody: err.message,
    });
    trace.addEntry({
      type,
      method: 'POST',
      url: tokenUrl,
      requestHeaders: reqHeaders,
      requestBody: body,
      responseStatus: 0,
      responseHeaders: {},
      responseBody: err.message,
      diagnostics,
    });
    return { ok: false, status: 0, json: null, text: err.message };
  }
}

function clientAuthParams(settings) {
  const params = { client_id: settings.clientId };
  if (settings.clientSecret) params.client_secret = settings.clientSecret;
  return params;
}

function parseExtraParams(str) {
  if (!str) return {};
  const out = {};
  for (const pair of str.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return out;
}

// ---------------------------------------------------------------------
// Optional post-success API call
// ---------------------------------------------------------------------

async function doPostTokenApiCall(settings) {
  if (!settings.postTokenApiUrl) return;
  const method = (settings.postTokenApiMethod || 'GET').toUpperCase();
  const headers = { ...parseExtraParams((settings.postTokenApiHeaders || '').replace(/,/g, '&')) };
  if (currentToken && currentToken.access_token) {
    headers['Authorization'] = `${currentToken.token_type || 'Bearer'} ${currentToken.access_token}`;
  }

  let responseStatus = 0;
  let responseHeaders = {};
  let responseBodyText = '';

  try {
    const resp = await fetch(settings.postTokenApiUrl, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : (settings.postTokenApiBody || undefined),
    });
    responseStatus = resp.status;
    resp.headers.forEach((v, k) => { responseHeaders[k] = v; });
    responseBodyText = await resp.text();

    trace.addEntry({
      type: 'post_token_call',
      method,
      url: settings.postTokenApiUrl,
      requestHeaders: headers,
      requestBody: settings.postTokenApiBody || '',
      responseStatus,
      responseHeaders,
      responseBody: responseBodyText,
      diagnostics: resp.ok ? [] : ['Post-token API call failed — this is a plain HTTP call using the access token as a Bearer credential; check the endpoint expects that token format and that the token has the scopes it needs.'],
    });
  } catch (err) {
    trace.addEntry({
      type: 'post_token_call',
      method,
      url: settings.postTokenApiUrl,
      requestHeaders: headers,
      requestBody: settings.postTokenApiBody || '',
      responseStatus: 0,
      responseHeaders: {},
      responseBody: err.message,
      diagnostics: ['Request failed before a response was received — check the URL and that this server can reach it.'],
    });
  }
}

// =======================================================================
// Page routes
// =======================================================================

function pageContext(req, extra = {}) {
  return { theme: getTheme(req), query: req.query, ...extra };
}

app.get('/', (req, res) => {
  let store;
  try {
    store = loadStore();
  } catch (err) {
    return res.status(500).send(`<pre>${err.message}</pre>`);
  }
  const detectedCallbackUrl = `${detectBaseUrl(req)}/callback`;
  res.send(renderHomePage(pageContext(req, { store, token: currentToken, traceEntries: trace.getEntries(), detectedCallbackUrl })));
});

app.get('/help', (req, res) => {
  res.send(renderHelpPage(pageContext(req)));
});

app.get('/about', (req, res) => {
  res.send(renderAboutPage(pageContext(req)));
});

app.get('/profiles/delete-confirm', (req, res) => {
  let store;
  try {
    store = loadStore();
  } catch (err) {
    return res.status(500).send(`<pre>${err.message}</pre>`);
  }
  res.send(renderDeleteConfirmPage(pageContext(req, { store })));
});

app.get('/theme/toggle', (req, res) => {
  setCookie(res, 'theme', getTheme(req) === 'light' ? 'dark' : 'light');
  res.redirect(req.query.return || '/');
});

// ---------------------------------------------------------------------
// Profile management (all operate on the single active profile, except
// switch/new which change which one is active)
// ---------------------------------------------------------------------

app.post('/profiles/switch', (req, res) => {
  const store = loadStore();
  if (store.profiles.some((p) => p.id === req.body.profileId)) {
    store.activeProfileId = req.body.profileId;
    saveStore(store);
  }
  res.redirect('/');
});

app.post('/profiles/new', (req, res) => {
  const store = loadStore();
  const name = (req.body.name || '').trim() || 'New profile';
  const profile = { id: newProfileId(), name, ...BLANK_PROFILE_FIELDS };
  store.profiles.push(profile);
  store.activeProfileId = profile.id;
  saveStore(store);
  res.redirect(`/?msg=${encodeURIComponent(`Created "${name}"`)}`);
});

app.post('/profiles/duplicate', (req, res) => {
  const store = loadStore();
  const source = activeProfile(store);
  if (!source) return res.redirect('/');
  const name = (req.body.name || '').trim() || `${source.name} copy`;
  const profile = { ...source, id: newProfileId(), name };
  store.profiles.push(profile);
  store.activeProfileId = profile.id;
  saveStore(store);
  res.redirect(`/?msg=${encodeURIComponent(`Duplicated as "${name}"`)}`);
});

app.post('/profiles/rename', (req, res) => {
  const store = loadStore();
  const profile = activeProfile(store);
  const name = (req.body.name || '').trim();
  if (profile && name) {
    profile.name = name;
    saveStore(store);
  }
  res.redirect(`/?msg=${encodeURIComponent(`Renamed to "${name}"`)}`);
});

app.post('/profiles/delete', (req, res) => {
  const store = loadStore();
  if (store.profiles.length <= 1) {
    return res.redirect(`/?msg=${encodeURIComponent("Can't delete the only remaining profile.")}&msgType=error`);
  }
  const profile = activeProfile(store);
  store.profiles = store.profiles.filter((p) => p.id !== store.activeProfileId);
  store.activeProfileId = store.profiles[0].id;
  saveStore(store);
  res.redirect(`/?msg=${encodeURIComponent(`Deleted "${profile ? profile.name : ''}"`)}`);
});

app.post('/profile/save', (req, res) => {
  const store = loadStore();
  saveActiveProfileFromBody(store, req.body);
  res.redirect(`/?msg=${encodeURIComponent('Profile saved')}`);
});

app.post('/profile/reset-redirect', (req, res) => {
  const store = loadStore();
  const profile = activeProfile(store);
  if (profile) {
    profile.redirectUri = '';
    saveStore(store);
  }
  res.redirect('/');
});

// ---------------------------------------------------------------------
// Token actions
// ---------------------------------------------------------------------

app.post('/token/get', async (req, res) => {
  const store = loadStore();
  const settings = saveActiveProfileFromBody(store, req.body);
  if (!settings) return res.redirect('/');

  if (settings.grantType === 'client_credentials') {
    const params = {
      grant_type: 'client_credentials',
      scope: settings.scope || '',
      ...clientAuthParams(settings),
      ...parseExtraParams(settings.extraTokenParams),
    };
    const result = await callTokenEndpoint({
      tokenUrl: settings.tokenUrl, params, headers: {}, type: 'client_credentials',
      providerType: settings.providerType, grantType: settings.grantType,
    });
    if (result.ok && result.json) {
      currentToken = { ...result.json, obtainedAt: new Date().toISOString(), grantType: 'client_credentials' };
      await doPostTokenApiCall(settings);
      return res.redirect(`/?msg=${encodeURIComponent('Token retrieved successfully.')}`);
    }
    currentToken = null;
    return res.redirect(`/?msg=${encodeURIComponent('Client credentials request failed — see trace.')}&msgType=error`);
  }

  // Authorization Code (+ PKCE): build the authorize URL, stash
  // PKCE/state server-side, and send the browser there directly — a
  // plain 302 from this form POST, no client JS needed to navigate.
  const redirectUri = settings.redirectUri || `${detectBaseUrl(req)}/callback`;
  const state = generateState();
  let codeVerifier = null;
  let codeChallenge = null;
  if (settings.usePkce) {
    codeVerifier = generateCodeVerifier();
    codeChallenge = generateCodeChallenge(codeVerifier, settings.pkceMethod || 'S256');
  }
  pendingAuth = { state, codeVerifier, redirectUri, profileId: store.activeProfileId, createdAt: Date.now() };

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: settings.clientId,
    redirect_uri: redirectUri,
    scope: settings.scope || '',
    state,
    ...parseExtraParams(settings.extraAuthParams),
  });
  if (settings.usePkce) {
    authParams.set('code_challenge', codeChallenge);
    authParams.set('code_challenge_method', settings.pkceMethod || 'S256');
  }
  const authUrl = `${settings.authUrl}?${authParams.toString()}`;

  trace.addEntry({
    type: 'authorize_redirect',
    method: 'GET',
    url: authUrl,
    requestHeaders: {},
    requestBody: settings.usePkce ? `code_verifier generated (${settings.pkceMethod || 'S256'}), not sent to authorize endpoint` : 'PKCE not used',
    responseStatus: null,
    responseHeaders: {},
    responseBody: 'Browser will be redirected here to authenticate.',
    diagnostics: [],
  });

  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    trace.addEntry({
      type: 'error', method: 'GET', url: req.originalUrl, requestHeaders: {}, requestBody: '',
      responseStatus: null, responseHeaders: {}, responseBody: { error, error_description: errorDescription },
      diagnostics: analyzeFailure({ grantType: 'authorization_code', httpStatus: null, errorBody: { error, error_description: errorDescription } }),
    });
    currentToken = null;
    return res.redirect(`/?msg=${encodeURIComponent('Provider returned an error — see trace.')}&msgType=error`);
  }

  if (!pendingAuth || state !== pendingAuth.state) {
    trace.addEntry({
      type: 'error', method: 'GET', url: req.originalUrl, requestHeaders: {}, requestBody: '',
      responseStatus: null, responseHeaders: {}, responseBody: 'State mismatch or no pending flow.',
      diagnostics: analyzeFailure({ context: 'state_mismatch' }),
    });
    currentToken = null;
    return res.redirect(`/?msg=${encodeURIComponent('State mismatch — see trace.')}&msgType=error`);
  }

  if (Date.now() - pendingAuth.createdAt > PENDING_AUTH_TTL_MS) {
    pendingAuth = null;
    currentToken = null;
    return res.redirect(`/?msg=${encodeURIComponent('The flow took too long and expired — try Get Token again.')}&msgType=error`);
  }

  const store = loadStore();
  const settings = store.profiles.find((p) => p.id === pendingAuth.profileId) || activeProfile(store);
  const params = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: pendingAuth.redirectUri,
    ...clientAuthParams(settings),
    ...parseExtraParams(settings.extraTokenParams),
  };
  if (pendingAuth.codeVerifier) params.code_verifier = pendingAuth.codeVerifier;

  const result = await callTokenEndpoint({
    tokenUrl: settings.tokenUrl, params, headers: {}, type: 'token_exchange',
    providerType: settings.providerType, grantType: 'authorization_code',
  });

  pendingAuth = null;

  if (result.ok && result.json) {
    currentToken = { ...result.json, obtainedAt: new Date().toISOString(), grantType: 'authorization_code' };
    await doPostTokenApiCall(settings);
    return res.redirect(`/?msg=${encodeURIComponent('Token retrieved successfully.')}`);
  }
  currentToken = null;
  return res.redirect(`/?msg=${encodeURIComponent('Token exchange failed — see trace.')}&msgType=error`);
});

app.post('/token/refresh', async (req, res) => {
  const store = loadStore();
  const settings = saveActiveProfileFromBody(store, req.body);
  if (!currentToken || !currentToken.refresh_token) {
    return res.redirect(`/?msg=${encodeURIComponent('No refresh token available from a previous response.')}&msgType=error`);
  }
  const params = {
    grant_type: 'refresh_token',
    refresh_token: currentToken.refresh_token,
    ...clientAuthParams(settings),
    ...parseExtraParams(settings.extraTokenParams),
  };
  const result = await callTokenEndpoint({
    tokenUrl: settings.tokenUrl, params, headers: {}, type: 'refresh',
    providerType: settings.providerType, grantType: 'refresh_token',
  });
  if (result.ok && result.json) {
    currentToken = { ...result.json, obtainedAt: new Date().toISOString(), grantType: 'refresh_token' };
    await doPostTokenApiCall(settings);
    return res.redirect(`/?msg=${encodeURIComponent('Token refreshed.')}`);
  }
  currentToken = null;
  res.redirect(`/?msg=${encodeURIComponent('Refresh failed — see trace.')}&msgType=error`);
});

app.post('/token/post-call', async (req, res) => {
  const store = loadStore();
  const settings = saveActiveProfileFromBody(store, req.body);
  await doPostTokenApiCall(settings);
  res.redirect('/');
});

app.post('/token/clear', (req, res) => {
  currentToken = null;
  res.redirect('/');
});

app.post('/trace/clear', (req, res) => {
  trace.clear();
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`OAuth2Helper running at http://localhost:${PORT}`);
});
