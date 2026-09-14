# OAuth2Helper

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/lbrenman/oauth2helper)

A small web app for testing and debugging OAuth 2.0 flows — think
**Postman meets the SAML-tracer Chrome extension, but for OAuth**.
Configure a client, run a flow end-to-end, and inspect every
request/response along the way, including plain-English guesses at what
went wrong when it fails.

It's a server-rendered, multi-page app rather than a single-page JS app
— see [Architecture](#architecture) below for what that means and why.

> Replace `lbrenman/oauth2helper` in the badge above with your actual
> `owner/repo` once this is pushed to GitHub, if it differs.

## Features

- **Multiple saved profiles** — save any number of named settings
  configurations (e.g. "Okta - Auth Code + PKCE", "Keycloak - Client
  Credentials") and switch between them from the dropdown at the top of
  the Settings panel. New / Duplicate / Rename / Delete live under
  "Manage profiles" — you never have to edit an existing profile and
  rename it to make a new one. Saving with Client Credentials as the
  grant type clears the fields that grant type doesn't use (redirect
  URI, PKCE, extra authorize params) so a saved profile doesn't carry
  stale, irrelevant values.
- **Settings panel** — auth URL, token URL, client ID/secret, scope,
  PKCE, and extra params, saved into the active profile in a local
  `settings.json`. Grouped into collapsible sections (Provider,
  Endpoints, Client Credentials, Flow & PKCE, Redirect URI, Advanced
  Params, Post-Token API Call) using native `<details>` — Expand
  all / Collapse all links set every group's state at once.
- **Light/dark mode** — toggle in the top-right corner; remembered in a
  cookie, no JS required.
- **Self-detected callback URL** — the app figures out its own running
  URL (including behind Codespaces port forwarding or ngrok) and shows
  it as the default redirect URI; "Use detected URL" resets to it.
- **Get Token** — runs the configured grant type and stores the result
  for reuse (including a **Refresh Token** button once a refresh token
  is available).
- **Optional post-success API call** — configure an endpoint to hit
  automatically (as a Bearer-authenticated call) right after a token is
  obtained, useful for smoke-testing a resource server.
- **Debug trace view** — every outbound call (authorize redirect, token
  exchange, refresh, post-token call) with full request/response detail
  in an expandable entry (native `<details>`, no JS). Failed entries
  open automatically. Secrets are masked; the token panel has its own
  "Reveal secrets" link.
- **Repeatable test loop** — tweak settings, click Get Token again,
  compare trace entries. **Clear** resets the trace list.
- **Failure diagnostics** — when a call fails, the trace entry includes
  a "Likely causes / what to check" list tailored to the grant type and,
  when you set **Provider type** to Okta or Keycloak, to that provider's
  specific settings.
- **Works with any standards-compliant OAuth 2.0 provider**, with extra
  attention to Okta and Keycloak quirks.

Grant types currently supported: **Authorization Code** (with optional
PKCE), **Client Credentials**, and **Refresh Token**.

## Quick start

```bash
npm install
cp settings.example.json settings.json   # ships with two example profiles — edit or replace them
npm start
```

Open the forwarded URL (Codespaces) or `http://localhost:3000`. Pick a
profile from the dropdown at the top of Settings, fill in your
provider's details, and click **Save Profile** (or just **Get Token**,
which saves and runs in one step).

### Run in a GitHub Codespace

Click the badge above, or go to **Code → Codespaces → Create codespace**
on this repo. The devcontainer runs `npm install` automatically; once
it's up, run `npm start` in the terminal and open the forwarded port
3000 URL (Codespaces serves it over HTTPS, which most OAuth providers
require for redirect URIs).

### Run locally via ngrok

Most OAuth providers (Okta and Keycloak included) require an HTTPS
redirect URI and won't accept `http://localhost`. If you're running
outside Codespaces, expose your local server with [ngrok](https://ngrok.com/).

#### Install ngrok

Pick whichever fits your machine:

```bash
# macOS (Homebrew)
brew install ngrok

# Linux (apt, Debian/Ubuntu)
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
  && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list \
  && sudo apt update && sudo apt install ngrok

# Linux/macOS (npm, no package manager needed)
npm install -g ngrok

# Windows (Chocolatey)
choco install ngrok

# Or download a prebuilt binary directly:
# https://ngrok.com/download
```

Then authenticate once with your (free) ngrok account token, found at
https://dashboard.ngrok.com/get-started/your-authtoken:

```bash
ngrok config add-authtoken <your-authtoken>
```

#### Run it

```bash
npm start                 # starts the app on http://localhost:3000
ngrok http 3000           # in a second terminal
```

Then:
1. Open the app through the `https://<random>.ngrok-free.app` URL ngrok
   prints, **not** `localhost` — the app detects its own base URL from
   the incoming request, so it needs to see the ngrok hostname to offer
   the right callback URL.
2. Leave Redirect URI blank (or click "Use detected URL") to pick up
   the ngrok URL — it's recomputed on every page load from the request
   itself, so a fresh ngrok tunnel is picked up automatically.
3. Register that exact `https://<random>.ngrok-free.app/callback` as an
   allowed redirect URI on your OAuth client — ngrok's free-tier URL
   changes every time you restart it, so you'll need to update this
   each session.

## Settings reference

| Setting | OAuth concept |
|---|---|
| Provider type | Not sent anywhere — just tells the diagnostics engine to give Okta- or Keycloak-specific hints on failure. |
| Grant type | Which flow to run: `authorization_code` or `client_credentials`. Refresh is a separate button, available once a `refresh_token` has been returned. |
| Authorization URL | The OAuth `authorization_endpoint` — where the browser is sent for the Authorization Code flow. |
| Token URL | The OAuth `token_endpoint` — where the app exchanges a code (or client credentials, or refresh token) for tokens. |
| Client ID / Client secret | The registered OAuth client's credentials. Leave secret blank for a public client using PKCE. |
| Scope | Space-separated `scope` values requested. |
| Use PKCE / PKCE method | Adds `code_challenge` / `code_challenge_method` to the authorize request and `code_verifier` to the token request (RFC 7636). Required by many providers for public clients. |
| Redirect URI | The `redirect_uri` sent on both the authorize and token requests — must be registered **exactly** on the OAuth client. Left blank, it defaults to the app's own detected URL. |
| Extra authorize / token params | Any additional query/body params some providers need (e.g. `audience` for API access tokens, `prompt=login`). |
| Post-token API URL / method / headers / body | An optional resource-server call fired automatically after a token is obtained, with `Authorization: <token_type> <access_token>` attached. |

`settings.json` is gitignored and holds your real values (as an array
of profiles); commit changes to `settings.example.json` only, with
placeholders. Its shape is:

```json
{
  "activeProfileId": "example-okta-pkce",
  "profiles": [
    { "id": "example-okta-pkce", "name": "[Example] Okta - Auth Code + PKCE", "...": "..." },
    { "id": "example-keycloak-cc", "name": "[Example] Keycloak - Client Credentials", "...": "..." }
  ]
}
```

Each entry in `profiles` has the fields from the table above, plus
`id` (generated, don't edit) and `name` (shown in the dropdown).

## Redirect URI

This is the field people most often get stuck on, so it gets its own
section. The redirect URI (a.k.a. callback URL) is where the provider
sends the browser back to after the user logs in, with an authorization
code attached — it only applies to **Authorization Code**; Client
Credentials has no browser step and doesn't use one at all.

### Finding it

Leave the Redirect URI field blank and the app computes one
automatically from its own current running URL, showing it right there
as a hint (e.g. `http://localhost:3000/callback`, or the current
Codespaces/ngrok URL if that's how you're running it) — that's exactly
the value it sends when it builds the authorize request, so there's
nothing to look up separately. If a saved value goes stale (say, after
restarting an ngrok tunnel), click **Use detected URL** to clear it and
pick up the fresh one on the next page load.

### Registering it with your provider

Register whatever value the app shows as an allowed redirect URI on the
OAuth client — scheme, host, port, path, and trailing slash all matter;
a mismatch here is one of the most common causes of a failed exchange
(the trace log's "Likely causes" hints will point this out if it
happens). Concretely:

- **Running locally** (`npm start`, no tunnel) — register
  `http://localhost:3000/callback`, or whatever port you set via the
  `PORT` environment variable.
- **Codespaces** — register the forwarded HTTPS URL Codespaces gives
  port 3000, with `/callback` appended.
- **ngrok** — register the current
  `https://<random>.ngrok-free.app/callback`; see [Run locally via
  ngrok](#run-locally-via-ngrok) above. This changes every time you
  restart a free-tier tunnel, so you'll re-register it each session.

See the Okta-specific and Keycloak-specific notes below for exactly
where in each provider's console this setting lives.

The optional [Browser-Only Test](#deliberate-exception-browser-only-test)
page's PKCE flow reuses this same `/callback` URL rather than needing
its own registered separately.

## Okta-specific notes

- **Grant types** must be explicitly enabled on the app integration:
  *Applications → your app → General → Grant type*.
- **Redirect URIs** are under *General → LOGIN → Sign-in redirect URIs*
  — must match exactly, including trailing slash.
- Okta generally **requires PKCE** for public clients (no client secret).
- Custom scopes must exist on the relevant Authorization Server and be
  granted to the app.
- Setting up Okta from scratch: [Set up Okta for OAuth API access](https://developer.okta.com/docs/guides/set-up-oauth-api/main/)
  (official) or [Use Okta for OAuth API Authentication](https://gist.github.com/lbrenman/b34f143aa6edca868db74396c7092b48#file-amplify-integration-use-okta-for-oauth-api-authentication-md)
  (condensed walkthrough).

## Keycloak-specific notes

- **Client authentication** toggle: On = confidential client (has a
  secret), Off = public client (no secret; PKCE should be required).
- **Authentication flow** toggles (*Standard flow*, *Direct access
  grants*, *Service accounts roles*) gate which grant types the client
  can use — Authorization Code, Resource Owner Password, and Client
  Credentials respectively.
- **Valid redirect URIs** under *Clients → your client → Settings* —
  Keycloak supports wildcards, but an exact match is safest for testing.
- **Proof Key for Code Exchange Code Challenge Method**, if set to
  `S256`, makes PKCE mandatory for that client.
- Token/authorize endpoints follow the pattern
  `/realms/{realm}/protocol/openid-connect/{token|auth}`.
- Setting up Keycloak from scratch: [OIDC Clients](https://www.keycloak.org/docs/latest/server_admin/#_oidc_clients)
  (official Server Administration Guide) or [Use PhaseTwo Managed Keycloak for OAuth API Authentication](https://gist.github.com/lbrenman/69317b109e0db85771ae29a2fab890c8)
  (condensed walkthrough).

## Project structure

```
server.js               Express app: routes only — every route renders a page or redirects
src/render.js            All HTML templates (home, help, about, delete-confirm)
src/icons.js              Shared inline SVG icon set
src/pkce.js               PKCE code_verifier / code_challenge generation
src/trace.js              In-memory trace log with secret masking
src/diagnostics.js        Failure -> likely-causes mapping
public/style.css          Styling (served as a static file; everything else is server-rendered)
settings.example.json     Template — copy to settings.json and fill in real values
```

## Reference specs

- [OAuth 2.0 — RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [PKCE — RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [Bearer Token Usage — RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750)
- [OAuth 2.0 Dynamic Client Registration — RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)
  (not implemented as a feature here — on the roadmap for auto-registering
  a test client instead of configuring one by hand. In the meantime, the
  in-app Settings Help page has copy-pasteable `curl` commands and auth
  setup steps for registering a client by hand against both Okta and
  Keycloak.)
- [What is OAuth 2.0? (oauth.net)](https://oauth.net/2/) — plain-language
  overview if you want the background before diving into the specs.

> Provider-specific details throughout this README and the in-app
> Settings Help page — endpoints, header names, required scopes, admin
> console paths — reflect Okta's and Keycloak's published documentation
> as of **September 14, 2026**. Identity providers evolve their APIs and
> consoles over time, so if something here doesn't match what you see,
> trust your provider's current docs over this snapshot and treat the
> mismatch as a sign something changed upstream, not a bug in this app.

## Architecture

Every page is rendered fully on the server (`src/render.js`) and almost
every interaction is a plain `<form>` POST or a link, following the
classic Post/Redirect/Get pattern — there's no client-side state and
nothing in `localStorage`. Concretely:

- **Profile switching, save, new/duplicate/rename/delete** are all form
  POSTs that redirect back to `/`.
- **Settings groups and trace entries** use native `<details>` —
  the browser handles expand/collapse with zero script.
- **Theme** is a cookie flipped by a link (`/theme/toggle`).
- **Reveal secrets** and **Expand/Collapse all groups** are plain query
  parameters on `/` (`?reveal=1`, `?groups=open`), toggled via links.
  The app starts fully collapsed on a plain visit, on purpose, so the
  first screen is clean rather than a wall of open fields.
- **Get Token** for the Authorization Code flow is a real HTTP 302
  redirect straight from the form's POST handler to the provider — the
  same round trip a JS app would do with `window.location`, just
  without the JS.

Two spots use a one-line `onchange` as a progressive-enhancement
convenience, not app logic: switching a profile submits its `<select>`
immediately instead of needing a separate button, and the "Docs & Help"
dropdown navigates on selection. Neither fetches anything or holds
state — with JS disabled, the profile switcher falls back to a visible
button (`<noscript>`) and the dropdown just doesn't navigate. Beyond
that, the only real trade-off is: **changing the grant type doesn't
instantly show or hide the PKCE / Redirect URI fields.** A JS app can
react to a dropdown change immediately; here, the fields update the
next time the page renders — i.e. right after you click **Save
Profile** or **Get Token**, both of which apply the Client-Credentials
field-clearing rule before rendering the page back. In practice that's
one extra click.

### Deliberate exception: Browser-Only Test

**Browser-Only Test** (linked in the top bar) is a separate, isolated
exception to all of the above. It runs Client Credentials and
Authorization Code + PKCE **entirely in your browser's own
JavaScript**, bypassing this app's server completely — the same way a
real public-client SPA would implement these flows itself, with no
backend of its own to hide a secret behind.

It's useful for two things:
- **Seeing the CORS wall for yourself.** Client Credentials from a
  browser is blocked by design on providers like Okta (see the CORS
  discussion in this repo's docs/commit history) — this page lets you
  hit that wall directly instead of taking it on faith.
- **Testing a true public-client PKCE flow**, where no client secret
  is ever sent, as opposed to the confidential-client-with-optional-
  PKCE flow the rest of the app uses.

It reads the *active profile's* current settings (read-only on this
page; edit them on the main page) and **only shows the test matching
that profile's grant type** — Client Credentials profiles get the
Client Credentials test, Authorization Code profiles get the PKCE
test. Switch grant type on the main page and save to see the other one.

The PKCE flow shares the main app's own `/callback` URL — nothing extra
to register; `/callback` tells the two apart by the `state` value
(`browsertest`) and hands that one straight to a page that does the
exchange in the browser instead of on the server.

The server never makes or sees the actual request either way, but each
script **self-reports its outcome** to `/browser-test/log` right after
the fetch settles, purely so you get one place to look: those attempts
show up in the **Debug Trace** on the main page too, labeled
`browser_test_cc` / `browser_test_pkce`, with a note that the detail
here is limited (no real request headers, and a CORS block looks
identical to a plain network failure from JS's point of view — check
your browser's DevTools Network tab for the actual error).

## Notes / limitations

- Single-user, local-dev tool: state (pending PKCE/state, the current
  token, the trace log) lives in server memory and resets when the
  server restarts. Nothing is persisted except `settings.json`.
- The trace log masks `client_secret`, `code_verifier`, and token
  values by default; the Current Token panel has its own "Reveal
  secrets" link when you need the full value for debugging.
- If `settings.json` is missing, empty, or not valid JSON, the app falls
  back to the real profiles in `settings.example.json` rather than
  inventing a blank one. If neither file has at least one valid profile,
  the home page fails with a clear error telling you to restore one —
  it won't silently fabricate a profile for you.
- **Browser-Only Test only**: the Client Credentials test there puts
  your client secret directly into that page's rendered JavaScript, so
  it's visible in browser DevTools — that's inherent to what the test
  demonstrates (a public client can't keep it confidential either).
  Don't point it at production credentials. A CORS-blocked request also
  can't be distinguished from a network failure by JS at all (browsers
  withhold those details from scripts for security reasons); the page
  says so, but the real error only shows up in DevTools' Network tab.
