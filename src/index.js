'use strict';

const { createWallet } = require('lightning-agent');
const { createMiddleware } = require('./middleware');
const { TollStats } = require('./stats');
const { createMacaroon, decodeMacaroon, verifyMacaroon, verifyPreimage } = require('./macaroon');
const { formatChallenge, formatChallengeBody, parseAuthorization } = require('./l402');
const { createMetricsExporter } = require('./metrics');

/**
 * Create a toll booth instance for gating API endpoints behind Lightning payments.
 *
 * @param {object} opts
 * @param {string|object} opts.wallet - NWC URL string or lightning-agent wallet instance
 * @param {string} opts.secret - HMAC secret for signing macaroons
 * @param {number} [opts.defaultSats=10] - Default price in sats if not specified per-route
 * @param {number} [opts.invoiceExpiry=300] - Invoice expiry in seconds (default 5 min)
 * @param {number} [opts.macaroonExpiry=3600] - Macaroon validity after payment (default 1 hour)
 * @param {boolean} [opts.bindEndpoint=true] - Bind macaroons to specific endpoints
 * @param {boolean} [opts.bindMethod=true] - Bind macaroons to specific HTTP methods
 * @param {boolean} [opts.bindIp=false] - Bind macaroons to client IP
 * @param {function} [opts.onPayment] - Callback when a payment is received
 * @returns {Function} toll(routeOpts) — creates middleware for a route
 */
function createToll(opts = {}) {
  if (!opts.wallet) {
    throw new Error('lightning-toll: wallet is required (NWC URL or wallet instance)');
  }
  if (!opts.secret) {
    throw new Error('lightning-toll: secret is required for macaroon signing');
  }

  // Create or use wallet
  let wallet;
  if (typeof opts.wallet === 'string') {
    wallet = createWallet(opts.wallet);
  } else if (opts.wallet && typeof opts.wallet.createInvoice === 'function') {
    wallet = opts.wallet;
  } else {
    throw new Error('lightning-toll: wallet must be an NWC URL string or a wallet instance with createInvoice()');
  }

  // Stats tracker
  const stats = new TollStats();

  // Config shared across all route middlewares
  const config = {
    wallet,
    secret: opts.secret,
    stats,
    defaultSats: opts.defaultSats || 10,
    invoiceExpiry: opts.invoiceExpiry || 300,
    macaroonExpiry: opts.macaroonExpiry || 3600,
    bindEndpoint: opts.bindEndpoint !== false,
    bindMethod: opts.bindMethod !== false,
    bindIp: opts.bindIp || false,
    onPayment: opts.onPayment || null
  };

  /**
   * Create toll middleware for a specific route.
   *
   * @param {object} [routeOpts]
   * @param {number} [routeOpts.sats] - Fixed price in sats
   * @param {function} [routeOpts.price] - Dynamic price function (req) => sats
   * @param {string|function} [routeOpts.description] - Invoice description
   * @param {number} [routeOpts.freeRequests] - Number of free requests per window
   * @param {string|number} [routeOpts.freeWindow] - Time window for free tier ('1h', '30m', etc.)
   * @returns {Function} Express middleware
   */
  function toll(routeOpts = {}) {
    return createMiddleware(config, routeOpts);
  }

  /**
   * Dashboard middleware — returns payment stats as JSON.
   * @returns {Function} Express handler
   */
  toll.dashboard = function dashboard() {
    return stats.dashboardHandler();
  };

  /**
   * Prometheus metrics middleware — returns stats in Prometheus text format.
   * @returns {Function} Express handler
   */
  toll.metrics = function metrics() {
    const exporter = createMetricsExporter(stats);
    return exporter.handler();
  };

  /**
   * Get the stats object directly.
   */
  toll.stats = stats;

  /**
   * Get the wallet instance.
   */
  toll.wallet = wallet;

  return toll;
}

module.exports = {
  createToll,

  // Re-export lower-level utilities
  createMacaroon,
  decodeMacaroon,
  verifyMacaroon,
  verifyPreimage,
  formatChallenge,
  formatChallengeBody,
  parseAuthorization,
  TollStats,
  createMetricsExporter
};
