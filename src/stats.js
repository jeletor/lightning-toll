'use strict';

/**
 * In-memory payment stats tracker.
 * Tracks revenue, request counts, unique payers, and recent payments.
 */

class TollStats {
  constructor(opts = {}) {
    this.maxRecent = opts.maxRecent || 100;

    // Totals
    this.totalRevenue = 0;
    this.totalRequests = 0;
    this.totalPaid = 0;

    // Per-endpoint
    this.endpoints = new Map(); // path → { revenue, requests, paid }

    // Unique payers (by IP or pubkey)
    this.payers = new Set();

    // Recent payments (ring buffer)
    this.recentPayments = [];
  }

  /**
   * Record a request (whether paid or free).
   * @param {string} endpoint - Request path
   * @param {boolean} paid - Whether this was a paid request
   * @param {number} [amountSats] - Amount paid in sats
   * @param {string} [payerId] - Payer identifier (IP or pubkey)
   * @param {string} [paymentHash] - Lightning payment hash
   */
  record(endpoint, paid, amountSats = 0, payerId = null, paymentHash = null) {
    this.totalRequests++;

    // Per-endpoint stats
    let ep = this.endpoints.get(endpoint);
    if (!ep) {
      ep = { revenue: 0, requests: 0, paid: 0, free: 0 };
      this.endpoints.set(endpoint, ep);
    }
    ep.requests++;

    if (paid && amountSats > 0) {
      this.totalRevenue += amountSats;
      this.totalPaid++;
      ep.revenue += amountSats;
      ep.paid++;

      if (payerId) this.payers.add(payerId);

      // Add to recent payments
      this.recentPayments.push({
        endpoint,
        amountSats,
        payerId: payerId || 'unknown',
        paymentHash: paymentHash || null,
        timestamp: Date.now()
      });

      // Trim recent payments
      if (this.recentPayments.length > this.maxRecent) {
        this.recentPayments = this.recentPayments.slice(-this.maxRecent);
      }
    } else {
      ep.free++;
    }
  }

  /**
   * Get stats summary as a plain object.
   * @returns {object}
   */
  toJSON() {
    const endpointStats = {};
    for (const [path, data] of this.endpoints) {
      endpointStats[path] = { ...data };
    }

    return {
      totalRevenue: this.totalRevenue,
      totalRequests: this.totalRequests,
      totalPaid: this.totalPaid,
      uniquePayers: this.payers.size,
      endpoints: endpointStats,
      recentPayments: this.recentPayments.slice(-20).reverse()
    };
  }

  /**
   * Create an Express middleware/handler that serves the dashboard JSON.
   * @returns {Function} Express handler
   */
  dashboardHandler() {
    return (req, res) => {
      res.json(this.toJSON());
    };
  }
}

module.exports = { TollStats };
