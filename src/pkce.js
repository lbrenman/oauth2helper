// src/pkce.js
// Minimal PKCE (RFC 7636) helper: generates a code_verifier and derives
// the matching code_challenge using S256 (or returns plain if requested).

const crypto = require('crypto');

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateCodeVerifier() {
  // 32 random bytes -> 43-char base64url string, within the 43-128 char
  // range required by RFC 7636.
  return base64url(crypto.randomBytes(32));
}

function generateCodeChallenge(codeVerifier, method = 'S256') {
  if (method === 'plain') {
    return codeVerifier;
  }
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  return base64url(hash);
}

function generateState() {
  return base64url(crypto.randomBytes(16));
}

module.exports = { generateCodeVerifier, generateCodeChallenge, generateState };
