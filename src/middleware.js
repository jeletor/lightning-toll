'use strict';

const { createMacaroon, decodeMacaroon, verifyMacaroon, verifyPreimage } = require('./macaroon');
const { formatChallenge, formatChallengeBody, parseAuthorization } = require('./l402');

/**
 * Parse a time window string like '1h', '30m', '1d' to milliseconds.
 */
function parseWindow(window) {
  if (typeof window === 'number') return window;
  if (!window || typeof window !== 'string') return 3600000; // default 1h

  const match = window.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 3600000;

  const num = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * (multipliers[unit] || 3600000);
}

/**
 * Get client identifier from request.
 * Prefers X-Forwarded-For, falls back to req.ip.
 */
function getClientId(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Create the toll middleware function.
 * @param {object} config - From createToll
 * @param {object} routeOpts - Per-route options
 * @returns {Function} Express middleware
 */
function createMiddleware(config, routeOpts = {}) {
  const {
    wallet,
    secret,
    stats,
    defaultSats,
    invoiceExpiry,
    macaroonExpiry,
    onPayment,
    bindEndpoint,
    bindMethod,
    bindIp
  } = config;

  // Resolve price for this request
  function resolvePrice(req) {
    if (typeof routeOpts.price === 'function') return routeOpts.price(req);
    if (typeof routeOpts.sats === 'number') return routeOpts.sats;
    return defaultSats;
  }

  // Resolve description for this request
  function resolveDescription(req) {
    if (typeof routeOpts.description === 'function') return routeOpts.description(req);
    if (typeof routeOpts.description === 'string') return routeOpts.description;
    return `API access: ${req.method} ${req.path}`;
  }

  // Free tier tracking: clientId → { count, windowStart }
  const freeTierMap = new Map();
  const freeRequests = routeOpts.freeRequests || 0;
  const freeWindowMs = parseWindow(routeOpts.freeWindow || '1h');

  // Cleanup free tier map periodically
  if (freeRequests > 0) {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of freeTierMap) {
        if (now - entry.windowStart > freeWindowMs * 2) {
          freeTierMap.delete(key);
        }
      }
    }, freeWindowMs);
    if (cleanupInterval.unref) cleanupInterval.unref();
  }

  /**
   * Check if client has free requests remaining.
   */
  function checkFreeTier(clientId) {
    if (freeRequests <= 0) return false;

    const now = Date.now();
    let entry = freeTierMap.get(clientId);

    if (!entry || now - entry.windowStart > freeWindowMs) {
      // New window
      entry = { count: 0, windowStart: now };
      freeTierMap.set(clientId, entry);
    }

    if (entry.count < freeRequests) {
      entry.count++;
      return true;
    }

    return false;
  }

  // Track used preimages to prevent replay (payment hash → timestamp)
  // Note: In a production system, you'd want persistent storage
  const usedPreimages = new Map();

  // Cleanup old preimage entries periodically
  const preimageCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - (macaroonExpiry * 1000 * 2);
    for (const [hash, ts] of usedPreimages) {
      if (ts < cutoff) usedPreimages.delete(hash);
    }
  }, 60000);
  if (preimageCleanupInterval.unref) preimageCleanupInterval.unref();

  // The actual middleware
  return async function tollMiddleware(req, res, next) {
    const clientId = getClientId(req);
    const endpoint = req.path || req.url;

    // Check for existing L402 authorization
    const authHeader = req.headers.authorization;
    const l402Creds = parseAuthorization(authHeader);

    if (l402Creds) {
      // Client is presenting credentials — verify them
      const decoded = decodeMacaroon(l402Creds.macaroon);
      if (!decoded) {
        return res.status(401).json({ error: 'Invalid macaroon' });
      }

      // Verify macaroon signature and caveats
      const context = {
        endpoint: bindEndpoint !== false ? endpoint : undefined,
        method: bindMethod !== false ? req.method : undefined,
        ip: bindIp ? clientId : undefined
      };

      const macResult = verifyMacaroon(secret, decoded, context);
      if (!macResult.valid) {
        return res.status(401).json({ error: macResult.error });
      }

      // Verify preimage matches payment hash
      if (!verifyPreimage(l402Creds.preimage, decoded.id)) {
        return res.status(401).json({ error: 'Invalid preimage — does not match payment hash' });
      }

      // Record the payment in stats
      const price = resolvePrice(req);
      stats.record(endpoint, true, price, clientId, decoded.id);

      // Attach payment info to request
      req.toll = {
        paid: true,
        paymentHash: decoded.id,
        amountSats: price,
        clientId
      };

      return next();
    }

    // No L402 credentials — check free tier
    if (checkFreeTier(clientId)) {
      stats.record(endpoint, false, 0, clientId);
      req.toll = { paid: false, free: true, clientId };
      return next();
    }

    // No auth, no free tier — issue a 402 challenge
    try {
      const amountSats = resolvePrice(req);
      const description = resolveDescription(req);

      // Create Lightning invoice via wallet
      const invoiceResult = await wallet.createInvoice({
        amountSats,
        description,
        expiry: invoiceExpiry
      });

      if (!invoiceResult || !invoiceResult.invoice || !invoiceResult.paymentHash) {
        return res.status(500).json({ error: 'Failed to create Lightning invoice' });
      }

      // Create macaroon bound to this payment
      const expiresAt = Math.floor(Date.now() / 1000) + macaroonExpiry;
      const macaroonOpts = {
        paymentHash: invoiceResult.paymentHash,
        expiresAt
      };

      if (bindEndpoint !== false) macaroonOpts.endpoint = endpoint;
      if (bindMethod !== false) macaroonOpts.method = req.method;
      if (bindIp) macaroonOpts.ip = clientId;

      const macaroon = createMacaroon(secret, macaroonOpts);

      // Build 402 response
      const wwwAuth = formatChallenge(invoiceResult.invoice, macaroon.raw);
      const body = formatChallengeBody({
        invoice: invoiceResult.invoice,
        macaroon: macaroon.raw,
        paymentHash: invoiceResult.paymentHash,
        amountSats,
        description
      });

      // Fire onPayment callback when payment is received (async, non-blocking)
      if (onPayment) {
        // Don't await — let the payment monitoring happen in the background
        wallet.waitForPayment(invoiceResult.paymentHash, { timeoutMs: invoiceExpiry * 1000 })
          .then(result => {
            if (result.paid) {
              try {
                onPayment({
                  paymentHash: invoiceResult.paymentHash,
                  amountSats,
                  endpoint,
                  preimage: result.preimage,
                  settledAt: result.settledAt,
                  clientId
                });
              } catch (_) { /* don't crash on callback errors */ }
            }
          })
          .catch(() => { /* timeout or error — ignore */ });
      }

      res.status(402)
        .set('WWW-Authenticate', wwwAuth)
        .json(body);
    } catch (err) {
      res.status(500).json({ error: 'Toll booth error: ' + err.message });
    }
  };
}

module.exports = { createMiddleware, parseWindow, getClientId };
