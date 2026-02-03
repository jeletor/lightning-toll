'use strict';

/**
 * L402 protocol header parsing and formatting.
 * Implements the L402 (formerly LSAT) protocol for HTTP 402 Payment Required.
 *
 * WWW-Authenticate: L402 invoice="lnbc...", macaroon="..."
 * Authorization: L402 <macaroon>:<preimage>
 */

/**
 * Format a WWW-Authenticate header value for a 402 response.
 * @param {string} invoice - Bolt11 invoice string
 * @param {string} macaroon - Base64url-encoded macaroon
 * @returns {string}
 */
function formatChallenge(invoice, macaroon) {
  return `L402 invoice="${invoice}", macaroon="${macaroon}"`;
}

/**
 * Format a full 402 response body.
 * @param {object} opts
 * @param {string} opts.invoice - Bolt11 invoice string
 * @param {string} opts.macaroon - Base64url-encoded macaroon
 * @param {string} opts.paymentHash - Payment hash (hex)
 * @param {number} opts.amountSats - Amount in satoshis
 * @param {string} [opts.description] - Invoice description
 * @returns {object}
 */
function formatChallengeBody(opts) {
  return {
    status: 402,
    message: 'Payment Required',
    paymentHash: opts.paymentHash,
    invoice: opts.invoice,
    macaroon: opts.macaroon,
    amountSats: opts.amountSats,
    description: opts.description || null,
    protocol: 'L402',
    instructions: {
      step1: 'Pay the Lightning invoice above',
      step2: 'Get the preimage from the payment receipt',
      step3: 'Retry the request with header: Authorization: L402 <macaroon>:<preimage>'
    }
  };
}

/**
 * Parse an Authorization: L402 header.
 * Format: L402 <macaroon>:<preimage>
 * @param {string} authHeader - Full Authorization header value
 * @returns {{ macaroon: string, preimage: string } | null}
 */
function parseAuthorization(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;

  const trimmed = authHeader.trim();

  // Check for L402 prefix (case-insensitive)
  if (!trimmed.toLowerCase().startsWith('l402 ')) return null;

  const credentials = trimmed.slice(5).trim();
  const colonIdx = credentials.indexOf(':');
  if (colonIdx === -1) return null;

  const macaroon = credentials.substring(0, colonIdx);
  const preimage = credentials.substring(colonIdx + 1);

  if (!macaroon || !preimage) return null;

  return { macaroon, preimage };
}

module.exports = {
  formatChallenge,
  formatChallengeBody,
  parseAuthorization
};
