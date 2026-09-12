// src/render.js
// Every page is rendered fully server-side and returned as plain HTML.
// No client-side JavaScript anywhere: state changes happen through
// <form> POSTs and links, following the classic Post/Redirect/Get
// pattern. Query params carry only view preferences (reveal secrets,
// which settings groups are open, flash messages) — never app state.

const { icon } = require('./icons');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attr(str) {
  return escapeHtml(str);
}

// ---------------------------------------------------------------------
// Shared page shell
// ---------------------------------------------------------------------

function renderLayout({ title = 'OAuth2Helper', theme = 'dark', bodyHtml = '' }) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="${attr(theme)}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css" />
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function renderTopbar({ theme, returnTo }) {
  const themeIcon = theme === 'light' ? icon('sun') : icon('moon');
  const themeLabel = theme === 'light' ? 'Light' : 'Dark';
  return `
<header class="topbar">
  <div class="topbar-title">
    <a href="/" class="logo-link"><span class="logo">${icon('key', 22)}</span></a>
    <h1><a href="/">OAuth2Helper</a></h1>
    <span class="tagline">Postman meets SAML&#8209;tracer, for OAuth 2.0</span>
  </div>
  <nav class="topbar-right">
    <a class="chevron-btn" href="https://oauth.net/2/" target="_blank" rel="noopener">What is OAuth 2.0?</a>
    <a class="chevron-btn" href="https://datatracker.ietf.org/doc/html/rfc6749" target="_blank" rel="noopener">RFC 6749</a>
    <a class="chevron-btn" href="https://datatracker.ietf.org/doc/html/rfc7636" target="_blank" rel="noopener">RFC 7636 (PKCE)</a>
    <a class="chevron-btn" href="https://datatracker.ietf.org/doc/html/rfc7591" target="_blank" rel="noopener">RFC 7591 (DCR)</a>
    <a class="chevron-btn" href="https://datatracker.ietf.org/doc/html/rfc6750" target="_blank" rel="noopener">RFC 6750 (Bearer)</a>
    <a class="chevron-btn" href="/about">${icon('info')} About</a>
    <a class="chevron-btn" href="/help">${icon('helpCircle')} Settings Help</a>
    <a class="chevron-btn" href="/theme/toggle?return=${encodeURIComponent(returnTo || '/')}" title="Switch to ${themeLabel === 'Light' ? 'dark' : 'light'} mode">${themeIcon}</a>
  </nav>
</header>`;
}

function renderFlash(query) {
  if (!query.msg) return '';
  const isError = query.msgType === 'error';
  return `<div class="flash ${isError ? 'flash-error' : 'flash-ok'}">${escapeHtml(query.msg)}</div>`;
}

// ---------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------

const FIELD_LABELS = {
  providerType: 'Provider type',
  providerName: 'Provider name (label only)',
  authUrl: 'Authorization URL',
  tokenUrl: 'Token URL',
  clientId: 'Client ID',
  clientSecret: 'Client secret',
  scope: 'Scope',
  redirectUri: 'Redirect URI (callback)',
  extraAuthParams: 'Extra authorize params',
  extraTokenParams: 'Extra token params',
  postTokenApiUrl: 'Endpoint URL',
  postTokenApiHeaders: 'Extra headers',
  postTokenApiBody: 'Body',
};

function textField(name, value, { type = 'text', placeholder = '', disabled = false, hint = '' } = {}) {
  return `
    <label>${FIELD_LABELS[name] || name}
      <input type="${type}" id="${name}" name="${name}" value="${attr(value || '')}" placeholder="${attr(placeholder)}" ${disabled ? 'disabled' : ''} autocomplete="off" />
      ${hint ? `<small class="hint">${hint}</small>` : ''}
    </label>`;
}

function textareaField(name, value, { placeholder = '', rows = 2 } = {}) {
  return `
    <label>${FIELD_LABELS[name] || name}
      <textarea id="${name}" name="${name}" rows="${rows}" placeholder="${attr(placeholder)}">${escapeHtml(value)}</textarea>
    </label>`;
}

function renderSettingsGroups(p, ctx) {
  const isCC = p.grantType === 'client_credentials';
  const openGroups = ctx.groupsOpen; // Set of group keys that should render open

  const groups = [];

  groups.push({
    key: 'provider',
    label: 'Provider',
    body: `
      <label>Provider type
        <select id="providerType" name="providerType">
          ${['generic', 'okta', 'keycloak'].map((v) => `<option value="${v}" ${p.providerType === v ? 'selected' : ''}>${v === 'generic' ? 'Generic / standards-compliant' : v[0].toUpperCase() + v.slice(1)}</option>`).join('')}
        </select>
        <small class="hint">Not sent in any request — only used to tailor the "Likely causes" hints in the trace log when a call fails.</small>
      </label>
      ${textField('providerName', p.providerName, { placeholder: 'e.g. My Okta Org' })}`,
  });

  groups.push({
    key: 'endpoints',
    label: 'Endpoints',
    body: `
      ${textField('authUrl', p.authUrl, { placeholder: 'https://.../oauth2/v1/authorize' })}
      ${textField('tokenUrl', p.tokenUrl, { placeholder: 'https://.../oauth2/v1/token' })}`,
  });

  groups.push({
    key: 'credentials',
    label: 'Client Credentials',
    body: `
      ${textField('clientId', p.clientId)}
      ${textField('clientSecret', p.clientSecret, { type: 'password' })}`,
  });

  groups.push({
    key: 'flow',
    label: 'Flow &amp; PKCE',
    body: `
      <label>Grant type
        <select id="grantType" name="grantType">
          <option value="authorization_code" ${p.grantType === 'authorization_code' ? 'selected' : ''}>Authorization Code (+ PKCE)</option>
          <option value="client_credentials" ${p.grantType === 'client_credentials' ? 'selected' : ''}>Client Credentials</option>
        </select>
        <small class="hint">Changing this takes effect after you click Save Profile or Get Token — fields Client Credentials doesn't use are cleared automatically at that point.</small>
      </label>
      ${textField('scope', p.scope, { placeholder: 'openid profile email' })}
      <label class="checkbox-row">
        <input type="checkbox" id="usePkce" name="usePkce" value="1" ${p.usePkce ? 'checked' : ''} ${isCC ? 'disabled' : ''} />
        Use PKCE
      </label>
      <label>PKCE method
        <select id="pkceMethod" name="pkceMethod" ${isCC ? 'disabled' : ''}>
          <option value="S256" ${p.pkceMethod === 'S256' ? 'selected' : ''}>S256</option>
          <option value="plain" ${p.pkceMethod === 'plain' ? 'selected' : ''}>plain</option>
        </select>
      </label>`,
  });

  groups.push({
    key: 'redirect',
    label: 'Redirect URI',
    body: isCC ? `
      <p class="muted small">Not used for Client Credentials — this flow has no browser redirect.</p>`
      : `
      <label>Redirect URI (callback)
        <input type="text" id="redirectUri" name="redirectUri" value="${attr(p.redirectUri)}" placeholder="${attr(ctx.detectedCallbackUrl)}" autocomplete="off" />
      </label>
      <small class="hint">Detected from this server's current URL: <code>${escapeHtml(ctx.detectedCallbackUrl)}</code> — register this exact value as an allowed redirect URI on the OAuth client.</small>
      <div class="button-row" style="margin-top:8px">
        <button type="submit" formaction="/profile/reset-redirect" formnovalidate>Use detected URL</button>
      </div>`,
  });

  groups.push({
    key: 'advanced',
    label: 'Advanced Params',
    body: isCC ? `
      <p class="muted small">Extra authorize params aren't used for Client Credentials (no authorize request happens).</p>
      ${textField('extraTokenParams', p.extraTokenParams, { placeholder: 'audience=https://api.example.com' })}`
      : `
      ${textField('extraAuthParams', p.extraAuthParams, { placeholder: 'prompt=login&audience=...' })}
      ${textField('extraTokenParams', p.extraTokenParams, { placeholder: 'audience=https://api.example.com' })}`,
  });

  groups.push({
    key: 'posttoken',
    label: 'Post-Token API Call (optional)',
    body: `
      ${textField('postTokenApiUrl', p.postTokenApiUrl, { placeholder: 'https://api.example.com/me' })}
      <label>Method
        <select id="postTokenApiMethod" name="postTokenApiMethod">
          ${['GET', 'POST', 'PUT', 'DELETE'].map((m) => `<option value="${m}" ${p.postTokenApiMethod === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </label>
      ${textField('postTokenApiHeaders', p.postTokenApiHeaders, { placeholder: 'X-Custom=value' })}
      ${textareaField('postTokenApiBody', p.postTokenApiBody)}`,
  });

  return groups.map((g) => `
    <details class="settings-group" ${openGroups.has(g.key) ? 'open' : ''}>
      <summary>${g.label}</summary>
      <div class="group-body">${g.body}</div>
    </details>`).join('');
}

function renderProfileBar(store) {
  const options = store.profiles.map((p) => `<option value="${attr(p.id)}" ${p.id === store.activeProfileId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  const active = store.profiles.find((p) => p.id === store.activeProfileId);
  const canDelete = store.profiles.length > 1;
  return `
    <form method="post" action="/profiles/switch" class="profile-bar">
      <select name="profileId" title="Switch between saved settings profiles">${options}</select>
      <button type="submit">Switch</button>
    </form>
    <details class="settings-group manage-profiles">
      <summary>Manage profiles</summary>
      <div class="group-body">
        <form method="post" action="/profiles/new" class="inline-form">
          <input type="text" name="name" placeholder="New profile name" required />
          <button type="submit">${icon('plus')} Create</button>
        </form>
        <form method="post" action="/profiles/duplicate" class="inline-form">
          <input type="text" name="name" value="${attr(active ? active.name + ' copy' : '')}" placeholder="Duplicate as..." required />
          <button type="submit">${icon('copy')} Duplicate current</button>
        </form>
        <form method="post" action="/profiles/rename" class="inline-form">
          <input type="text" name="name" value="${attr(active ? active.name : '')}" placeholder="Rename current to..." required />
          <button type="submit">${icon('edit')} Rename current</button>
        </form>
        <div class="button-row">
          ${canDelete
            ? `<a class="chevron-btn danger" href="/profiles/delete-confirm">${icon('trash')} Delete current profile</a>`
            : `<span class="muted small">Can't delete the only remaining profile.</span>`}
        </div>
      </div>
    </details>`;
}

function entryOutcome(e) {
  if (e.type === 'error' || (e.diagnostics && e.diagnostics.length > 0)) return 'err';
  if (e.responseStatus === null || e.responseStatus === undefined) return 'pending';
  if (e.responseStatus >= 200 && e.responseStatus < 400) return 'ok';
  return 'err';
}

function outcomeIcon(outcome) {
  if (outcome === 'ok') return icon('checkCircle', 15);
  if (outcome === 'err') return icon('xCircle', 15);
  return icon('arrowRight', 15);
}

function pretty(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  try { return JSON.stringify(val, null, 2); } catch { return String(val); }
}

function parseQueryParams(urlStr) {
  if (!urlStr) return [];
  try {
    return Array.from(new URL(urlStr).searchParams.entries());
  } catch {
    return [];
  }
}

function queryParamsTable(pairs) {
  if (!pairs.length) return '';
  const rows = pairs.map(([k, v]) => `<tr><td class="qp-key">${escapeHtml(k)}</td><td class="qp-val">${escapeHtml(v)}</td></tr>`).join('');
  return `<div class="trace-section"><h4>Query parameters</h4><table class="query-params">${rows}</table></div>`;
}

function renderTraceEntry(e) {
  const outcome = entryOutcome(e);
  const diagHtml = e.diagnostics && e.diagnostics.length ? `
    <div class="diagnostics">
      <h4>Likely causes / what to check</h4>
      <ul>${e.diagnostics.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
    </div>` : '';
  const previewHtml = outcome === 'err' && e.diagnostics && e.diagnostics.length ? `
    <div class="trace-preview">${icon('alertTriangle', 13)} ${escapeHtml(e.diagnostics[0])}</div>` : '';

  return `
    <details class="trace-entry outcome-${outcome}" ${outcome === 'err' ? 'open' : ''}>
      <summary class="trace-entry-header">
        <span class="outcome-icon ${outcome}" title="${outcome === 'ok' ? 'Success' : outcome === 'err' ? 'Failed' : 'Info'}">${outcomeIcon(outcome)}</span>
        <span class="badge">${escapeHtml(e.type)}</span>
        <span class="badge status-${outcome}">${e.responseStatus ?? '\u2014'}</span>
        <span class="trace-url">${escapeHtml(e.method)} ${escapeHtml(e.url || '')}</span>
        <span class="trace-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
      </summary>
      ${previewHtml}
      <div class="trace-body">
        ${diagHtml}
        ${queryParamsTable(parseQueryParams(e.url))}
        <div class="trace-section"><h4>Request headers</h4><pre>${escapeHtml(pretty(e.requestHeaders))}</pre></div>
        <div class="trace-section"><h4>Request body</h4><pre>${escapeHtml(pretty(e.requestBody))}</pre></div>
        <div class="trace-section"><h4>Response headers</h4><pre>${escapeHtml(pretty(e.responseHeaders))}</pre></div>
        <div class="trace-section"><h4>Response body</h4><pre>${escapeHtml(pretty(e.responseBody))}</pre></div>
      </div>
    </details>`;
}

function maskValue(v, reveal) {
  if (!v) return '';
  if (reveal) return v;
  return `${v.slice(0, 8)}\u2026${v.slice(-4)} (${v.length} chars)`;
}

function renderTokenPanel(token, reveal, currentPath) {
  if (!token) return '<p class="muted">No token yet \u2014 click "Get Token" below.</p>';
  const rows = [
    ['Grant type', token.grantType],
    ['Obtained at', token.obtainedAt],
    ['Token type', token.token_type],
    ['Expires in', token.expires_in ? `${token.expires_in}s` : ''],
    ['Scope', token.scope],
    ['Access token', maskValue(token.access_token, reveal)],
    ['ID token', maskValue(token.id_token, reveal)],
    ['Refresh token', maskValue(token.refresh_token, reveal)],
  ].filter(([, v]) => v);

  const toggleHref = reveal ? stripQueryParam(currentPath, 'reveal') : addQueryParam(currentPath, 'reveal', '1');

  return `
    ${rows.map(([k, v]) => `<div class="token-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span></div>`).join('')}
    <div class="button-row" style="margin-top:10px">
      <a class="chevron-btn" href="${attr(toggleHref)}">${reveal ? 'Hide secrets' : 'Reveal secrets'}</a>
    </div>`;
}

function addQueryParam(path, key, value) {
  const [base, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');
  params.set(key, value);
  return `${base}?${params.toString()}`;
}
function stripQueryParam(path, key) {
  const [base, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');
  params.delete(key);
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

function renderHomePage(ctx) {
  const { store, token, traceEntries, query, theme, detectedCallbackUrl } = ctx;
  const p = store.profiles.find((x) => x.id === store.activeProfileId);
  const currentPath = '/' + (Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '');
  const reveal = query.reveal === '1';

  const groupsOpen = new Set(['provider', 'endpoints', 'credentials', 'flow', 'redirect']);
  if (query.groups === 'open') ['provider', 'endpoints', 'credentials', 'flow', 'redirect', 'advanced', 'posttoken'].forEach((k) => groupsOpen.add(k));
  if (query.groups === 'closed') groupsOpen.clear();

  const renderCtx = { detectedCallbackUrl, groupsOpen };

  const hasRefreshToken = !!(token && token.refresh_token);
  const hasPostTokenUrl = !!(p && p.postTokenApiUrl);

  const body = `
${renderTopbar({ theme, returnTo: '/' })}
<main class="layout">
  <section class="panel settings-panel">
    <div class="panel-header">
      <h2>Settings</h2>
      <div class="settings-toolbar">
        <a class="chevron-btn" href="${attr(addQueryParam(currentPath, 'groups', 'open'))}" title="Expand all groups">Expand all</a>
        <a class="chevron-btn" href="${attr(addQueryParam(currentPath, 'groups', 'closed'))}" title="Collapse all groups">Collapse all</a>
      </div>
    </div>

    ${renderProfileBar(store)}

    <form method="post" action="/profile/save" class="settings-form">
      ${renderSettingsGroups(p, renderCtx)}
      <div class="button-row" style="margin-top:12px">
        <button type="submit" formaction="/profile/save" class="primary">Save Profile</button>
        <button type="submit" formaction="/token/get" class="primary large">Get Token</button>
        <button type="submit" formaction="/token/refresh" ${hasRefreshToken ? '' : 'disabled'}>Refresh Token</button>
        <button type="submit" formaction="/token/post-call" ${hasPostTokenUrl ? '' : 'disabled'}>Re-run Post-Token Call</button>
      </div>
    </form>

    <hr />

    <h2>Current Token</h2>
    <div class="token-panel">
      ${renderTokenPanel(token, reveal, currentPath)}
      ${token ? `<form method="post" action="/token/clear" style="margin-top:8px"><button type="submit">Clear token</button></form>` : ''}
    </div>
  </section>

  <section class="panel trace-panel">
    <div class="trace-header">
      <h2>Debug Trace</h2>
      <form method="post" action="/trace/clear">
        <button type="submit">Clear</button>
      </form>
    </div>
    <div class="trace-list">
      ${traceEntries.length
        ? traceEntries.slice().reverse().map(renderTraceEntry).join('')
        : '<p class="muted">No requests logged yet. Requests and responses for every call this app makes (authorization redirect, token exchange, refresh, and any post-token API call) will show up here as they happen.</p>'}
    </div>
  </section>
</main>`;

  return renderLayout({ title: 'OAuth2Helper', theme, bodyHtml: `${renderFlash(query)}${body}` });
}

// ---------------------------------------------------------------------
// Help page (settings reference)
// ---------------------------------------------------------------------

function renderHelpPage(ctx) {
  const body = `
${renderTopbar({ theme: ctx.theme, returnTo: '/help' })}
<main class="single-column">
  <a class="chevron-btn back-link" href="/">${icon('arrowLeft')} Back</a>
  <section class="panel">
    <h2>Settings reference &mdash; what each field means and where to find it</h2>
    <div class="help-grid">

      <div class="help-block">
        <h3>Provider</h3>
        <dl>
          <dt>Provider type</dt>
          <dd>Not sent in any request &mdash; only tailors the "Likely causes" diagnostics in the trace log (Okta/Keycloak-specific hints vs. generic OAuth hints).</dd>
          <dt>Provider name</dt>
          <dd>A label for your own reference only. Not sent anywhere.</dd>
        </dl>
      </div>

      <div class="help-block">
        <h3>Endpoints</h3>
        <dl>
          <dt>Authorization URL</dt>
          <dd>The OAuth <code>authorization_endpoint</code> &mdash; where the browser is sent to log in and consent (Authorization Code flow).
            <span class="where"><strong>Where to find it:</strong> Okta &mdash; your org's <code>/.well-known/openid-configuration</code> document, or Security &rarr; API &rarr; Authorization Servers &rarr; (server) &rarr; Settings. Keycloak &mdash; Realm settings &rarr; "OpenID Endpoint Configuration" link, or <code>/realms/&lt;realm&gt;/protocol/openid-connect/auth</code>.</span>
          </dd>
          <dt>Token URL</dt>
          <dd>The OAuth <code>token_endpoint</code> &mdash; where this app exchanges a code, client credentials, or refresh token for an access token.
            <span class="where"><strong>Where to find it:</strong> same <code>/.well-known/openid-configuration</code> document (Okta), or <code>/realms/&lt;realm&gt;/protocol/openid-connect/token</code> (Keycloak).</span>
          </dd>
        </dl>
      </div>

      <div class="help-block">
        <h3>Client Credentials</h3>
        <dl>
          <dt>Client ID</dt>
          <dd>The identifier of the OAuth client registered on your provider.
            <span class="where"><strong>Where to find it:</strong> Okta &mdash; Applications &rarr; your app &rarr; General tab. Keycloak &mdash; Clients &rarr; your client &rarr; Settings tab (Client ID).</span>
          </dd>
          <dt>Client secret</dt>
          <dd>The registered client's secret. Leave blank for a public client using PKCE instead.
            <span class="where"><strong>Where to find it:</strong> Okta &mdash; Applications &rarr; your app &rarr; General tab, "Client Credentials" section. Keycloak &mdash; Clients &rarr; your client &rarr; Credentials tab (only shown when "Client authentication" is on).</span>
          </dd>
        </dl>
      </div>

      <div class="help-block">
        <h3>Flow &amp; PKCE</h3>
        <dl>
          <dt>Grant type</dt>
          <dd>Which flow "Get Token" runs &mdash; Authorization Code (user logs in via browser) or Client Credentials (machine-to-machine). A "Refresh Token" button appears once a refresh token is returned.
            <span class="where"><strong>Enable it:</strong> Okta &mdash; Applications &rarr; your app &rarr; General &rarr; "Grant type" checkboxes. Keycloak &mdash; Clients &rarr; your client &rarr; Settings &rarr; Capability config ("Standard flow" / "Service accounts roles").</span>
          </dd>
          <dt>Scope</dt>
          <dd>Space-separated <code>scope</code> values to request, e.g. <code>openid profile email</code>.</dd>
          <dt>Use PKCE</dt>
          <dd>Adds a <code>code_challenge</code>/<code>code_verifier</code> pair (RFC 7636). Many providers require this for public clients (no secret).</dd>
          <dt>PKCE method</dt>
          <dd><code>S256</code> hashes the verifier (recommended, often required). <code>plain</code> sends it as-is.</dd>
        </dl>
      </div>

      <div class="help-block">
        <h3>Redirect URI</h3>
        <dl>
          <dt>Redirect URI</dt>
          <dd>The <code>redirect_uri</code> sent on both the authorize and token requests &mdash; must be registered <strong>exactly</strong> (scheme, host, port, path, trailing slash) on the OAuth client. Leave blank to use this server's detected URL; click "Use detected URL" to reset it after that URL changes (e.g. a new ngrok tunnel).
            <span class="where"><strong>Register it:</strong> Okta &mdash; Applications &rarr; your app &rarr; General &rarr; LOGIN &rarr; "Sign-in redirect URIs". Keycloak &mdash; Clients &rarr; your client &rarr; Settings &rarr; "Valid redirect URIs".</span>
          </dd>
        </dl>
      </div>

      <div class="help-block">
        <h3>Advanced Params</h3>
        <dl>
          <dt>Extra authorize params</dt>
          <dd>Additional query params for the authorize request, as <code>key=value&amp;key2=value2</code> &mdash; e.g. <code>prompt=login</code> or an <code>audience</code> some providers require for API access tokens.</dd>
          <dt>Extra token params</dt>
          <dd>Additional body params for the token request, same <code>key=value&amp;key2=value2</code> format.</dd>
        </dl>
      </div>

      <div class="help-block">
        <h3>Post-Token API Call (optional)</h3>
        <dl>
          <dt>Endpoint URL</dt>
          <dd>A resource-server URL to call automatically right after a token is obtained &mdash; useful for smoke-testing the token actually works.</dd>
          <dt>Method</dt>
          <dd>HTTP method for that call.</dd>
          <dt>Extra headers</dt>
          <dd>Additional headers, as <code>key=value,key2=value2</code>, alongside the auto-added <code>Authorization: &lt;token_type&gt; &lt;access_token&gt;</code> header.</dd>
          <dt>Body</dt>
          <dd>Raw request body, sent as-is for non-GET methods.</dd>
        </dl>
      </div>

    </div>
  </section>
</main>`;
  return renderLayout({ title: 'Settings Help \u2014 OAuth2Helper', theme: ctx.theme, bodyHtml: body });
}

// ---------------------------------------------------------------------
// About page
// ---------------------------------------------------------------------

function renderAboutPage(ctx) {
  const body = `
${renderTopbar({ theme: ctx.theme, returnTo: '/about' })}
<main class="single-column">
  <a class="chevron-btn back-link" href="/">${icon('arrowLeft')} Back</a>
  <section class="panel">
    <h2>About OAuth2Helper</h2>
    <div class="help-grid">

      <div class="help-block">
        <h3>What this app does</h3>
        <p class="about-text">A developer tool for testing and debugging OAuth 2.0 flows &mdash; think
          <strong>Postman meets the SAML-tracer Chrome extension, but for OAuth</strong>.
          Configure a client against any standards-compliant provider, run
          Authorization Code (with PKCE), Client Credentials, or Refresh
          Token flows end-to-end, and inspect every request and response
          along the way, with plain-English guesses at what went wrong
          when something fails.</p>
      </div>

      <div class="help-block">
        <h3>How to use it</h3>
        <ol class="about-steps">
          <li>Pick or create a <strong>profile</strong> &mdash; switch with the dropdown at the top of Settings, or create/duplicate/rename one under "Manage profiles".</li>
          <li>Fill in <strong>Endpoints</strong> and <strong>Client Credentials</strong> for your provider (see Settings Help for where to find each value).</li>
          <li>Click <strong>Save Profile</strong> to persist changes, or <strong>Get Token</strong> to save and run in one step.</li>
          <li><strong>Get Token</strong> &mdash; Authorization Code redirects you to the provider to log in; Client Credentials runs immediately with no redirect.</li>
          <li>Inspect the <strong>Debug Trace</strong> on the right &mdash; every request/response, including query params, headers, and body. Failed calls open automatically with "likely causes" diagnostics.</li>
        </ol>
      </div>

      <div class="help-block">
        <h3>What is OAuth 2.0?</h3>
        <p class="about-text">OAuth 2.0 is an authorization framework that lets an application get
          limited access to a user's resources on another service without
          ever handling that user's password. The user authenticates with
          the provider (an identity provider or the resource server
          itself) and grants the application a token; the app then uses
          that token to call APIs on the user's behalf. See
          <a href="https://oauth.net/2/" target="_blank" rel="noopener">oauth.net/2</a>
          for the full picture, or any spec linked in the header above.</p>
      </div>

      <div class="help-block">
        <h3>No client-side JavaScript</h3>
        <p class="about-text">Every page here is rendered on the server and every action is a
          plain HTML form or link &mdash; switching profiles, expanding
          trace entries, toggling theme and reveal-secrets, all of it.
          The one real trade-off: changing the grant type doesn't
          instantly show/hide the PKCE and redirect URI fields the way a
          JS app would &mdash; that takes effect the next time the page
          renders, i.e. right after you click Save Profile or Get Token.</p>
      </div>

    </div>
  </section>
</main>`;
  return renderLayout({ title: 'About \u2014 OAuth2Helper', theme: ctx.theme, bodyHtml: body });
}

// ---------------------------------------------------------------------
// Delete-profile confirmation page
// ---------------------------------------------------------------------

function renderDeleteConfirmPage(ctx) {
  const { store, theme } = ctx;
  const active = store.profiles.find((p) => p.id === store.activeProfileId);
  const body = `
${renderTopbar({ theme, returnTo: '/' })}
<main class="single-column">
  <a class="chevron-btn back-link" href="/">${icon('arrowLeft')} Back</a>
  <section class="panel">
    <h2>Delete profile?</h2>
    <p>This will permanently delete <strong>${escapeHtml(active ? active.name : '')}</strong>. This can't be undone.</p>
    <form method="post" action="/profiles/delete" class="button-row">
      <button type="submit" class="danger">${icon('trash')} Yes, delete it</button>
      <a class="chevron-btn" href="/">Cancel</a>
    </form>
  </section>
</main>`;
  return renderLayout({ title: 'Delete profile \u2014 OAuth2Helper', theme, bodyHtml: body });
}

module.exports = {
  escapeHtml,
  renderHomePage,
  renderHelpPage,
  renderAboutPage,
  renderDeleteConfirmPage,
};
