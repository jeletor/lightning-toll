'use strict';

const crypto = require('crypto');

/**
 * Simple macaroon implementation using HMAC-SHA256.
 *
 * A macaroon is a bearer credential with embedded caveats.
 * Structure: { id, caveats, signature }
 *
 * The id contains the payment hash (binding the macaroon to a specific payment).
 * Caveats restrict where/when/how the macaroon can be used.
 * The signature is chained HMAC — each caveat is folded into the sig.
 */

/**
 * Create a new macaroon.
 * @param {string} secret - Server's HMAC secret
 * @param {object} opts
 * @param {string} opts.paymentHash - Lightning payment hash
 * @param {string} [opts.endpoint] - Bound endpoint path
 * @param {string} [opts.method] - HTTP method restriction
 * @param {number} [opts.expiresAt] - Unix timestamp for expiry
 * @param {string} [opts.ip] - Client IP restriction
 * @returns {{ id: string, caveats: string[], signature: string, raw: string }}
 */
function createMacaroon(secret, opts = {}) {
  if (!secret) throw new Error('Macaroon secret is required');
  if (!opts.paymentHash) throw new Error('paymentHash is required for macaroon');

  const id = opts.paymentHash;

  // Build caveats
  const caveats = [];
  if (opts.expiresAt) caveats.push(`expires_at = ${opts.expiresAt}`);
  if (opts.endpoint) caveats.push(`endpoint = ${opts.endpoint}`);
  if (opts.method) caveats.push(`method = ${opts.method}`);
  if (opts.ip) caveats.push(`ip = ${opts.ip}`);

  // Chain HMAC: start with HMAC(secret, id), then fold each caveat
  let sig = crypto.createHmac('sha256', secret).update(id).digest();
  for (const caveat of caveats) {
    sig = crypto.createHmac('sha256', sig).update(caveat).digest();
  }

  const signature = sig.toString('hex');

  // Encode as base64 JSON for transport
  const payload = { id, caveats, signature };
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return { id, caveats, signature, raw };
}

/**
 * Decode a raw macaroon string back to its components.
 * @param {string} raw - Base64url-encoded macaroon
 * @returns {{ id: string, caveats: string[], signature: string } | null}
 */
function decodeMacaroon(raw) {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed.id || !parsed.signature || !Array.isArray(parsed.caveats)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Verify a macaroon's signature and caveats.
 * @param {string} secret - Server's HMAC secret
 * @param {object} macaroon - Decoded macaroon { id, caveats, signature }
 * @param {object} [context] - Request context for caveat verification
 * @param {string} [context.endpoint] - Current request path
 * @param {string} [context.method] - Current HTTP method
 * @param {string} [context.ip] - Client IP
 * @returns {{ valid: boolean, error?: string, paymentHash: string }}
 */
function verifyMacaroon(secret, macaroon, context = {}) {
  if (!macaroon || !macaroon.id || !macaroon.signature) {
    return { valid: false, error: 'Invalid macaroon structure', paymentHash: null };
  }

  // Recompute chained HMAC
  let sig = crypto.createHmac('sha256', secret).update(macaroon.id).digest();
  for (const caveat of macaroon.caveats) {
    sig = crypto.createHmac('sha256', sig).update(caveat).digest();
  }
  const expectedSig = sig.toString('hex');

  // Constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(macaroon.signature, 'hex'), Buffer.from(expectedSig, 'hex'))) {
    return { valid: false, error: 'Invalid macaroon signature', paymentHash: macaroon.id };
  }

  // Verify caveats
  for (const caveat of macaroon.caveats) {
    const [key, value] = caveat.split(' = ', 2);
    if (!key || value === undefined) {
      return { valid: false, error: `Malformed caveat: ${caveat}`, paymentHash: macaroon.id };
    }

    switch (key.trim()) {
      case 'expires_at': {
        const expiresAt = parseInt(value.trim(), 10);
        if (Date.now() / 1000 > expiresAt) {
          return { valid: false, error: 'Macaroon expired', paymentHash: macaroon.id };
        }
        break;
      }
      case 'endpoint': {
        if (context.endpoint && context.endpoint !== value.trim()) {
          return { valid: false, error: `Endpoint mismatch: expected ${value.trim()}, got ${context.endpoint}`, paymentHash: macaroon.id };
        }
        break;
      }
      case 'method': {
        if (context.method && context.method.toUpperCase() !== value.trim().toUpperCase()) {
          return { valid: false, error: `Method mismatch: expected ${value.trim()}, got ${context.method}`, paymentHash: macaroon.id };
        }
        break;
      }
      case 'ip': {
        if (context.ip && context.ip !== value.trim()) {
          return { valid: false, error: `IP mismatch: expected ${value.trim()}, got ${context.ip}`, paymentHash: macaroon.id };
        }
        break;
      }
      default:
        // Unknown caveats are ignored (forward-compatible)
        break;
    }
  }

  return { valid: true, paymentHash: macaroon.id };
}

/**
 * Verify that a preimage matches a payment hash.
 * payment_hash = SHA256(preimage)
 * @param {string} preimage - Hex-encoded preimage
 * @param {string} paymentHash - Hex-encoded payment hash
 * @returns {boolean}
 */
function verifyPreimage(preimage, paymentHash) {
  if (!preimage || !paymentHash) return false;
  try {
    const computed = crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(paymentHash, 'hex'));
  } catch {
    return false;
  }
}

module.exports = {
  createMacaroon,
  decodeMacaroon,
  verifyMacaroon,
  verifyPreimage
};
