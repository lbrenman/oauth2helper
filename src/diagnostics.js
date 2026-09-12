// src/diagnostics.js
// Turns a failed OAuth call into a list of plain-English "likely causes /
// what to check" hints. Pattern-matches on HTTP status + the OAuth
// error/error_description fields, with extra hints when providerType is
// 'okta' or 'keycloak'.

function analyzeFailure({ providerType, grantType, httpStatus, errorBody, context }) {
  const hints = [];
  let error = '';
  let description = '';

  if (errorBody && typeof errorBody === 'object') {
    error = (errorBody.error || '').toLowerCase();
    description = (errorBody.error_description || errorBody.errorSummary || '').toLowerCase();
  } else if (typeof errorBody === 'string') {
    description = errorBody.toLowerCase();
  }

  const isOkta = providerType === 'okta';
  const isKeycloak = providerType === 'keycloak';

  const add = (msg) => hints.push(msg);

  // --- Generic HTTP-level hints ---
  if (httpStatus === 0 || httpStatus === undefined) {
    add('No response was received at all — check the URL is reachable from where this server is running (network/firewall, typo in authUrl/tokenUrl, or the provider requires a VPN).');
  }
  if (httpStatus === 404) {
    add('404 from the OAuth server — double-check the token/authorize URL path. Many providers version their endpoints (e.g. /oauth2/v1/token, /realms/{realm}/protocol/openid-connect/token for Keycloak).');
  }
  if (httpStatus === 401) {
    add('401 Unauthorized on the token request usually means client authentication failed — check client_id/client_secret are correct and that the client is configured for the auth method being used (client_secret_post vs client_secret_basic vs none).');
  }

  // --- redirect_uri issues ---
  if (error.includes('redirect_uri') || description.includes('redirect_uri') || description.includes('redirect uri')) {
    add('Redirect URI mismatch — the redirect_uri sent in this request must exactly match one registered on the OAuth client (scheme, host, port, path, and trailing slash all matter).');
    if (isOkta) add('Okta: check "Sign-in redirect URIs" on the app integration (Applications → your app → General → LOGIN).');
    if (isKeycloak) add('Keycloak: check "Valid redirect URIs" on the client (Clients → your client → Settings/Access settings). Keycloak supports wildcards but exact matches are safest.');
  }

  // --- invalid_grant ---
  if (error === 'invalid_grant') {
    add('invalid_grant — the authorization code was already used, has expired (usually ~60s), or the PKCE code_verifier does not match the code_challenge sent earlier. Try the flow again from a fresh "Get Token" click.');
    if (grantType === 'refresh_token') add('For a refresh_token grant, invalid_grant also means the refresh token was revoked, expired, or refresh token rotation invalidated it after a previous use.');
  }

  // --- unauthorized_client / invalid_client ---
  if (error === 'unauthorized_client') {
    add('unauthorized_client — the client is not authorized to use this grant type. Check that the grant type is enabled on the client configuration.');
    if (isOkta) add('Okta: Applications → your app → General → "Grant type" — make sure Authorization Code / Client Credentials / Refresh Token is checked as needed.');
    if (isKeycloak) add('Keycloak: Clients → your client → Settings → "Authentication flow" toggles (Standard flow, Direct access grants, Service accounts) must match the grant you\'re using.');
  }
  if (error === 'invalid_client') {
    add('invalid_client — client_id or client_secret is wrong, or the client is set up as "public" (no secret) but a secret was sent, or vice versa.');
    if (isKeycloak) add('Keycloak: check the client\'s "Client authentication" toggle — On = confidential (needs a secret), Off = public (no secret, PKCE required instead).');
  }

  // --- scope issues ---
  if (error === 'invalid_scope' || description.includes('scope')) {
    add('invalid_scope — one of the requested scopes isn\'t recognized or isn\'t permitted for this client. Check the scope string for typos and that each scope is assigned to the client/authorization server.');
    if (isOkta) add('Okta: custom scopes must exist on the Authorization Server and be granted to the app.');
    if (isKeycloak) add('Keycloak: check "Client scopes" assigned to the client (Clients → your client → Client scopes).');
  }

  // --- PKCE ---
  if (description.includes('pkce') || description.includes('code_challenge') || error === 'invalid_request' && description.includes('code_verifier')) {
    add('PKCE-related error — either the server requires PKCE and it wasn\'t sent (enable "Use PKCE" in settings), or the code_verifier sent to the token endpoint doesn\'t match the code_challenge sent to the authorize endpoint.');
    if (isOkta) add('Okta requires PKCE for public clients (no client secret) by default.');
    if (isKeycloak) add('Keycloak: check "Proof Key for Code Exchange Code Challenge Method" on the client — if set to S256, PKCE is mandatory.');
  }

  // --- access_denied ---
  if (error === 'access_denied') {
    add('access_denied — the user (or the provider\'s policy) declined the authorization request. If this happens immediately without a login/consent screen, check the client\'s assigned users/groups or consent settings.');
  }

  // --- unsupported_grant_type ---
  if (error === 'unsupported_grant_type') {
    add(`unsupported_grant_type — the token endpoint doesn't accept "${grantType}". Confirm the grant type is enabled on the client and spelled exactly as the spec expects.`);
  }

  // --- state mismatch (handled before we even call the token endpoint) ---
  if (context === 'state_mismatch') {
    add('The "state" value returned on the callback didn\'t match what this app sent — this usually means a stale/old callback link was reused, multiple flows were started in parallel, or the server restarted between steps (state is kept in memory). Click "Get Token" again to start fresh.');
  }

  if (hints.length === 0) {
    add('No specific pattern matched — check the raw response body in the trace entry above for the exact error/error_description, and verify the client\'s redirect URI, grant type, scopes, and secret against the provider\'s app configuration.');
  }

  return hints;
}

module.exports = { analyzeFailure };
