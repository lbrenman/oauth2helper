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

function activeProfile(store) {
  return store.profiles.find((p) => p.id === store.activeProfileId) || null;
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
  <div class="topbar-center">
    <a class="chevron-btn experimental" href="/browser-test" title="Optional: test Client Credentials / Auth Code+PKCE directly from browser JS, bypassing this app's server">${icon('activity')} Browser-Only Test</a>
  </div>
  <nav class="topbar-right">
    <select class="picker-select" title="Reference docs and in-app help"
      onchange="var v=this.value; if(!v) return; if(v.indexOf('http')===0){ window.open(v,'_blank','noopener'); this.selectedIndex=0; } else { window.location.href=v; }">
      <option value="" selected disabled>Docs &amp; Help</option>
      <optgroup label="This app">
        <option value="/about">About this app</option>
        <option value="/help">Settings Help (what each field means)</option>
      </optgroup>
      <optgroup label="OAuth 2.0 specs">
        <option value="https://oauth.net/2/">What is OAuth 2.0?</option>
        <option value="https://datatracker.ietf.org/doc/html/rfc6749">OAuth 2.0 (RFC 6749)</option>
        <option value="https://datatracker.ietf.org/doc/html/rfc7636">PKCE (RFC 7636)</option>
        <option value="https://datatracker.ietf.org/doc/html/rfc7591">Dynamic Client Registration (RFC 7591)</option>
        <option value="https://datatracker.ietf.org/doc/html/rfc6750">Bearer Tokens (RFC 6750)</option>
      </optgroup>
      <optgroup label="Provider setup guides">
        <option value="https://developer.okta.com/docs/guides/set-up-oauth-api/main/">Okta: Set up OAuth API access (official)</option>
        <option value="https://www.keycloak.org/docs/latest/server_admin/#_oidc_clients">Keycloak: OIDC Clients (official)</option>
        <option value="https://gist.github.com/lbrenman/b34f143aa6edca868db74396c7092b48#file-amplify-integration-use-okta-for-oauth-api-authentication-md">Use Okta for OAuth API Authentication (gist)</option>
        <option value="https://gist.github.com/lbrenman/69317b109e0db85771ae29a2fab890c8">Use PhaseTwo Managed Keycloak for OAuth API Authentication (gist)</option>
      </optgroup>
    </select>
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
    <div class="profile-picker">
      <label class="profile-picker-label">Profile</label>
      <form method="post" action="/profiles/switch" class="profile-bar">
        <select name="profileId" title="Switch between saved settings profiles" onchange="this.form.submit()">${options}</select>
        <noscript><button type="submit">Switch</button></noscript>
      </form>
      <details class="manage-profiles">
        <summary>${icon('edit', 13)} Manage profiles (new, duplicate, rename, delete)</summary>
        <div class="manage-profiles-body">
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
      </details>
    </div>`;
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
      <div class="action-bar">
        <div class="button-row">
          <button type="submit" formaction="/token/get" class="primary large">Get Token</button>
          <button type="submit" formaction="/token/refresh" ${hasRefreshToken ? '' : 'disabled'}>Refresh Token</button>
          <button type="submit" formaction="/token/post-call" ${hasPostTokenUrl ? '' : 'disabled'}>Re-run Post-Token Call</button>
        </div>

        <h2 style="margin-top:16px">Current Token</h2>
        <div class="token-panel">
          ${renderTokenPanel(token, reveal, currentPath)}
          ${token ? `<div class="button-row" style="margin-top:8px"><button type="submit" formaction="/token/clear" formnovalidate>Clear token</button></div>` : ''}
        </div>
      </div>

      <div class="section-divider"><span>Configure &ldquo;${escapeHtml(p ? p.name : '')}&rdquo;</span></div>

      ${renderSettingsGroups(p, renderCtx)}

      <div class="button-row" style="margin-top:14px">
        <button type="submit" formaction="/profile/save" class="primary">Save Profile</button>
        <span class="muted small">Get Token (above) saves automatically too \u2014 this is only for saving without running anything.</span>
      </div>
    </form>
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
    <h2>Setup guides &amp; resources</h2>
    <p class="about-text">Haven't created an OAuth client on your provider yet? Start here, then
      come back down to the field-by-field reference below.</p>
    <div class="help-grid">
      <div class="help-block">
        <h3>Okta</h3>
        <dl>
          <dt><a href="https://developer.okta.com/docs/guides/set-up-oauth-api/main/" target="_blank" rel="noopener">Set up Okta for OAuth API access (official)</a></dt>
          <dd>Okta's own walkthrough for creating an OIDC app integration and using it with the Authorization Code grant.</dd>
          <dt><a href="https://gist.github.com/lbrenman/b34f143aa6edca868db74396c7092b48#file-amplify-integration-use-okta-for-oauth-api-authentication-md" target="_blank" rel="noopener">Use Okta for OAuth API Authentication (gist)</a></dt>
          <dd>A more opinionated, condensed walkthrough covering the same setup.</dd>
        </dl>
      </div>
      <div class="help-block">
        <h3>Keycloak</h3>
        <dl>
          <dt><a href="https://www.keycloak.org/docs/latest/server_admin/#_oidc_clients" target="_blank" rel="noopener">OIDC Clients (official Server Administration Guide)</a></dt>
          <dd>Keycloak's own reference for creating and configuring an OpenID Connect client.</dd>
          <dt><a href="https://gist.github.com/lbrenman/69317b109e0db85771ae29a2fab890c8" target="_blank" rel="noopener">Use PhaseTwo Managed Keycloak for OAuth API Authentication (gist)</a></dt>
          <dd>A more opinionated, condensed walkthrough covering the same setup, for PhaseTwo's managed Keycloak.</dd>
        </dl>
      </div>
    </div>
  </section>

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

  <section class="panel">
    <h2>Dynamic Client Registration (DCR) &mdash; Okta &amp; Keycloak</h2>
    <p class="about-text">This app doesn't do DCR itself yet (see the RFC 7591 link in the
      header &mdash; it's on the roadmap). In the meantime, here's how to register
      a client by hand with <code>curl</code> against each provider, so you don't
      have to click through the admin console. Whatever <code>client_id</code> /
      <code>client_secret</code> comes back can go straight into a profile on the
      <a href="/">main page</a>.</p>

    <h3 class="dcr-heading">Keycloak</h3>
    <p class="muted small">Keycloak's DCR endpoint accepts a lightweight, purpose-built
      <strong>Initial Access Token</strong> &mdash; scoped just to registration, with its
      own expiry and a cap on how many clients it can create. That makes it reasonable
      to hand out for short-lived or CI use, unlike Okta's approach below.</p>
    <ol class="about-steps">
      <li>Generate the token: Admin Console &rarr; select your realm &rarr; <strong>Clients</strong>
        &rarr; <strong>Initial access tokens</strong> tab (older versions: <strong>Realm settings</strong>
        &rarr; <strong>Client registration</strong>) &rarr; <strong>Create</strong>. Set an expiration
        and a max client count, then copy the token &mdash; it's shown only once.</li>
      <li>Register the client:</li>
    </ol>
    <pre class="help-code">curl -X POST "https://&lt;keycloak-host&gt;/realms/&lt;realm&gt;/clients-registrations/openid-connect" \\
  -H "Authorization: Bearer &lt;INITIAL_ACCESS_TOKEN&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{
    "client_name": "OAuth2Helper test client",
    "redirect_uris": ["http://localhost:3000/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none"
  }'</pre>
    <p class="muted small"><code>token_endpoint_auth_method</code>: <code>"none"</code> registers a
      public client (pairs with PKCE &mdash; matches this app's Authorization Code + PKCE profile
      type); use <code>"client_secret_basic"</code> or <code>"client_secret_post"</code> instead for a
      confidential client, or <code>"grant_types": ["client_credentials"]</code> with no
      <code>redirect_uris</code> at all for a Client Credentials profile. The response includes
      <code>client_id</code> (and <code>client_secret</code>, for confidential clients) plus a
      <code>registration_access_token</code> &mdash; save that too if you'll want to read, update, or
      delete this specific client later via
      <code>.../clients-registrations/openid-connect/&lt;client_id&gt;</code>.</p>

    <h3 class="dcr-heading">Okta</h3>
    <p class="muted small">Okta's DCR endpoint doesn't use the initial-access-token pattern at
      all &mdash; it requires you to already be authenticated as an Okta admin, either with an
      API token or a scoped OAuth access token. It's really "provision an app via API" more
      than public self-registration.</p>
    <ol class="about-steps">
      <li>Get credentials, either:
        <ul>
          <li><strong>API token</strong> (simplest for manual testing, but unscoped &mdash; full admin
            access): Admin Console &rarr; <strong>Security</strong> &rarr; <strong>API</strong> &rarr;
            <strong>Tokens</strong> &rarr; <strong>Create Token</strong>. Send it as
            <code>Authorization: SSWS &lt;token&gt;</code>.</li>
          <li>or a <strong>scoped OAuth access token</strong>: create an Okta Service App, request a
            token from the <strong>org</strong> authorization server (<code>/oauth2/v1/token</code> &mdash;
            custom authorization servers don't support Okta management scopes) with
            <code>scope=okta.clients.register</code> (or <code>okta.clients.manage</code> for full
            CRUD), then send it as <code>Authorization: Bearer &lt;token&gt;</code>.</li>
        </ul>
      </li>
      <li>Register the client:</li>
    </ol>
    <pre class="help-code">curl -i -X POST 'https://{yourOktaDomain}/oauth2/v1/clients' \\
  -H 'Authorization: SSWS {api_token}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "client_name": "OAuth2Helper test client",
    "application_type": "web",
    "redirect_uris": ["http://localhost:3000/callback"],
    "response_types": ["code"],
    "grant_types": ["authorization_code", "refresh_token"],
    "token_endpoint_auth_method": "client_secret_basic"
  }'</pre>
    <p class="muted small">The registered client shows up as a regular app under
      <strong>Applications</strong> in the Admin Console (changes made either way stay in sync).
      <code>client_id</code> is assigned by Okta and can't be chosen. For a Client Credentials
      profile, use <code>"grant_types": ["client_credentials"]</code>, drop
      <code>redirect_uris</code>, and note that Okta generally requires PKCE for public clients
      but Client Credentials is always confidential, so keep
      <code>token_endpoint_auth_method</code> as <code>client_secret_basic</code> or
      <code>client_secret_post</code>.</p>
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

// ---------------------------------------------------------------------
// Browser-Only Test — OPTIONAL capability. Everything above this runs
// through the server (no client JS at all, by design). This one
// section is a deliberate, isolated exception: it runs Client
// Credentials and Authorization Code + PKCE entirely from browser
// JavaScript, bypassing this app's server, so you can see for yourself
// what a public-client / pure-SPA implementation of these flows looks
// like (and, for Client Credentials, hit the CORS wall most providers
// put up against exactly that). It does not touch or replace any of
// the server-mediated flows elsewhere in the app.
// ---------------------------------------------------------------------

function jsString(value) {
  // Safe embedding of a server value as a JS string literal inside an
  // inline <script> block — also neutralizes "</script>" break-out.
  return JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c');
}

const CLIENT_SCRIPT_HELPERS = `
function b64url(buffer) {
  var bytes = new Uint8Array(buffer), str = '';
  for (var i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function showResult(el, status, bodyText) {
  el.innerHTML = '<strong>HTTP ' + status + '</strong><pre>' + escapeHtml(bodyText) + '</pre>';
}
function showFetchError(el, err) {
  el.innerHTML = '<strong>Request failed before any response was received.</strong> '
    + 'This is almost always a CORS block \u2014 the browser refuses to hand JavaScript '
    + 'even an error response for a blocked cross-origin request. Open DevTools \u2192 '
    + 'Network tab to see the real CORS error; JS itself cannot read it.'
    + '<pre>' + escapeHtml(err && err.message || String(err)) + '</pre>';
}
function logToServer(type, method, url, status, bodyText) {
  // Self-reports this browser-only attempt so it shows up in the main
  // page's Debug Trace too. The server never saw the actual request —
  // this is just the browser telling it what happened, after the fact.
  var params = new URLSearchParams();
  params.set('type', type);
  params.set('method', method);
  params.set('url', url);
  params.set('status', String(status));
  params.set('responseBody', bodyText == null ? '' : String(bodyText));
  fetch('/browser-test/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  }).catch(function() { /* logging is best-effort; ignore failures */ });
}`;

function renderBrowserTestPage(ctx) {
  const { store, theme, browserCallbackUrl } = ctx;
  const p = activeProfile(store);
  const isCC = p && p.grantType === 'client_credentials';

  const tokenUrlStr = p ? p.tokenUrl : '';

  const ccScript = `
(function(){
  ${CLIENT_SCRIPT_HELPERS}
  var btn = document.getElementById('cc-run-btn');
  var out = document.getElementById('cc-result');
  var tokenUrl = ${jsString(tokenUrlStr)};
  btn.addEventListener('click', function() {
    out.textContent = 'Requesting\u2026';
    var params = new URLSearchParams();
    params.set('grant_type', 'client_credentials');
    params.set('client_id', ${jsString(p ? p.clientId : '')});
    var secret = ${jsString(p ? p.clientSecret : '')};
    if (secret) params.set('client_secret', secret);
    var scope = ${jsString(p ? p.scope : '')};
    if (scope) params.set('scope', scope);
    fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    }).then(function(resp) {
      return resp.text().then(function(text) {
        showResult(out, resp.status, text);
        logToServer('browser_test_cc', 'POST', tokenUrl, resp.status, text);
      });
    }).catch(function(err) {
      showFetchError(out, err);
      logToServer('browser_test_cc', 'POST', tokenUrl, 0, (err && err.message) || String(err));
    });
  });
})();`;

  const pkceScript = `
(function(){
  ${CLIENT_SCRIPT_HELPERS}
  document.getElementById('pkce-run-btn').addEventListener('click', function() {
    var verifierBytes = new Uint8Array(32);
    crypto.getRandomValues(verifierBytes);
    var verifier = b64url(verifierBytes.buffer);
    sessionStorage.setItem('oauth2helper_pkce_verifier', verifier);
    sessionStorage.setItem('oauth2helper_pkce_tokenUrl', ${jsString(tokenUrlStr)});
    sessionStorage.setItem('oauth2helper_pkce_clientId', ${jsString(p ? p.clientId : '')});
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function(digest) {
      var challenge = b64url(digest);
      var params = new URLSearchParams({
        response_type: 'code',
        client_id: ${jsString(p ? p.clientId : '')},
        redirect_uri: ${jsString(browserCallbackUrl)},
        scope: ${jsString(p ? p.scope : '')},
        state: 'browsertest', // must match BROWSER_TEST_STATE in server.js — that's how /callback tells this apart from a normal server-mediated flow
        code_challenge: challenge,
        code_challenge_method: 'S256'
      });
      window.location.href = ${jsString(p ? p.authUrl : '')} + '?' + params.toString();
    });
  });
})();`;

  const ccSection = `
  <section class="panel">
    <h3>Client Credentials \u2014 from the browser</h3>
    <p class="muted small">Sends <code>client_id</code> and <code>client_secret</code> directly
      from this page's JavaScript to <code>${escapeHtml(tokenUrlStr || '(no token URL set)')}</code>.
      Most providers (Okta included) block this via CORS by design.</p>
    <button type="button" id="cc-run-btn">${icon('activity')} Run in browser</button>
    <div id="cc-result" class="browser-test-result"></div>
  </section>
  <script>${ccScript}</script>`;

  const pkceSection = `
  <section class="panel">
    <h3>Authorization Code + PKCE \u2014 from the browser</h3>
    <p class="muted small">Generates the PKCE pair in your browser, redirects you to the
      provider, and exchanges the code for a token via a direct browser
      <code>fetch</code> on return &mdash; no client secret is sent, simulating a
      public client. It shares the main app's own callback URL:</p>
    <p><code>${escapeHtml(browserCallbackUrl)}</code></p>
    <p class="muted small">So there's nothing extra to register &mdash; if the main app's
      flow already works against this OAuth client, this will too. (The
      server tells the two apart by the <code>state</code> value and hands this
      one straight to a page that does the exchange in your browser instead
      of on the server.)</p>
    <button type="button" id="pkce-run-btn">${icon('activity')} Start in browser</button>
  </section>
  <script>${pkceScript}</script>`;

  const noProfileNotice = !p ? `
  <section class="panel"><p class="muted">No profile is set up yet \u2014 create one on the <a href="/">main page</a> first.</p></section>` : '';

  const grantTypeNotice = p ? `
    <p class="muted small">Showing the test that matches this profile's grant type
      (<strong>${isCC ? 'Client Credentials' : 'Authorization Code'}</strong>). Switch the
      grant type on the <a href="/">main page</a> and save to see the other one instead.</p>` : '';

  const body = `
${renderTopbar({ theme, returnTo: '/browser-test' })}
<main class="single-column">
  <a class="chevron-btn back-link" href="/">${icon('arrowLeft')} Back</a>
  <section class="panel experimental-banner">
    <h2>${icon('activity')} Browser-Only Test <span class="badge status-pending">optional</span></h2>
    <p class="about-text">Everywhere else in this app, the actual OAuth HTTP calls happen on
      the server (that's deliberate — it's how client_secret stays out of the
      browser). This page is the one exception: it runs the token request
      <strong>entirely in your browser's JavaScript</strong>, exactly like a public
      client / pure SPA would, so you can see what that looks like &mdash; including
      hitting the CORS wall providers put up against Client Credentials from a browser.
      The result is self-reported back to the server afterward purely for logging, so
      it also shows up in the <strong>Debug Trace</strong> on the main page (labeled as
      browser-only) &mdash; the server still never actually makes or sees the request itself.
      It uses the active profile's current settings
      (<strong>${escapeHtml(p ? p.name : '')}</strong>) &mdash; edit those on the
      <a href="/">main page</a> first if needed.</p>
    ${grantTypeNotice}
  </section>
${noProfileNotice}${p ? (isCC ? ccSection : pkceSection) : ''}
</main>`;

  return renderLayout({ title: 'Browser-Only Test \u2014 OAuth2Helper', theme, bodyHtml: body });
}

function renderBrowserTestCallbackPage(ctx) {
  const { theme } = ctx;
  const script = `
(function(){
  ${CLIENT_SCRIPT_HELPERS}
  var out = document.getElementById('pkce-callback-result');
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var error = params.get('error');
  if (error) {
    out.innerHTML = '<strong>Provider returned an error.</strong><pre>' + escapeHtml(error + (params.get('error_description') ? ' \u2014 ' + params.get('error_description') : '')) + '</pre>';
    return;
  }
  if (!code) {
    out.textContent = 'No authorization code in the callback URL.';
    return;
  }
  var verifier = sessionStorage.getItem('oauth2helper_pkce_verifier');
  var tokenUrl = sessionStorage.getItem('oauth2helper_pkce_tokenUrl');
  var clientId = sessionStorage.getItem('oauth2helper_pkce_clientId');
  if (!verifier || !tokenUrl) {
    out.textContent = 'Missing PKCE session data \u2014 start this from the Browser-Only Test page, in this same browser tab.';
    return;
  }
  var body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: window.location.origin + window.location.pathname,
    client_id: clientId,
    code_verifier: verifier
  });
  out.textContent = 'Exchanging code for token\u2026';
  fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
    .then(function(resp) {
      return resp.text().then(function(text) {
        showResult(out, resp.status, text);
        logToServer('browser_test_pkce', 'POST', tokenUrl, resp.status, text);
      });
    })
    .catch(function(err) {
      showFetchError(out, err);
      logToServer('browser_test_pkce', 'POST', tokenUrl, 0, (err && err.message) || String(err));
    });
})();`;

  const body = `
${renderTopbar({ theme, returnTo: '/browser-test' })}
<main class="single-column">
  <a class="chevron-btn back-link" href="/browser-test">${icon('arrowLeft')} Back to Browser-Only Test</a>
  <section class="panel">
    <h2>PKCE browser test \u2014 callback</h2>
    <div id="pkce-callback-result" class="browser-test-result">Exchanging code for token\u2026</div>
  </section>
</main>
<script>${script}</script>`;

  return renderLayout({ title: 'Browser-Only Test callback \u2014 OAuth2Helper', theme, bodyHtml: body });
}

module.exports = {
  escapeHtml,
  renderHomePage,
  renderHelpPage,
  renderAboutPage,
  renderDeleteConfirmPage,
  renderBrowserTestPage,
  renderBrowserTestCallbackPage,
};
