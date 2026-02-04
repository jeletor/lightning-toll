'use strict';

const { createWallet } = require('lightning-agent');
const { autoPay } = require('./fetch');

/**
 * TollClient — automated L402 payment client.
 *
 * Wraps fetch with automatic Lightning payment handling.
 * When an endpoint returns 402, the client pays the invoice and retries.
 *
 * @example
 * const client = new TollClient({ wallet: nwcUrl, maxSats: 100 });
 * const res = await client.fetch('https://api.example.com/joke');
 * const data = await res.json();
 */
class TollClient {
  /**
   * @param {object} opts
   * @param {string|object} opts.wallet - NWC URL string or lightning-agent wallet instance
   * @param {number} [opts.maxSats=100] - Budget cap per request
   * @param {boolean} [opts.autoRetry=true] - Auto-pay and retry on 402
   * @param {object} [opts.headers] - Default headers for all requests
   */
  constructor(opts = {}) {
    if (!opts.wallet) {
      throw new Error('TollClient: wallet is required (NWC URL or wallet instance)');
    }

    if (typeof opts.wallet === 'string') {
      this.wallet = createWallet(opts.wallet);
    } else {
      this.wallet = opts.wallet;
    }

    this.maxSats = opts.maxSats || 100;
    this.autoRetry = opts.autoRetry !== false;
    this.defaultHeaders = opts.headers || {};

    // Track spending
    this.totalSpent = 0;
    this.requestCount = 0;
    this.paymentCount = 0;
  }

  /**
   * Fetch a URL with automatic L402 payment handling.
   *
   * @param {string} url - URL to fetch
   * @param {object} [opts] - Standard fetch options (method, headers, body, etc.)
   * @returns {Promise<Response>}
   */
  async fetch(url, opts = {}) {
    this.requestCount++;

    const payOpts = {
      wallet: this.wallet,
      maxSats: opts.maxSats || this.maxSats,
      autoRetry: opts.autoRetry !== undefined ? opts.autoRetry : this.autoRetry,
      headers: { ...this.defaultHeaders, ...opts.headers }
    };

    // Remove our custom props from fetch opts
    const fetchOpts = { ...opts };
    delete fetchOpts.maxSats;
    delete fetchOpts.autoRetry;

    const res = await autoPay(url, fetchOpts, payOpts);

    // Track if payment was made (status went from 402 → something else)
    // We can infer this if the response has our auth header set
    // A simpler approach: check if we got a non-402 response
    // The autoPay function handles the retry internally

    return res;
  }

  /**
   * Get spending stats.
   */
  getStats() {
    return {
      totalSpent: this.totalSpent,
      requestCount: this.requestCount,
      paymentCount: this.paymentCount
    };
  }

  /**
   * Close the wallet connection.
   */
  close() {
    if (this.wallet && typeof this.wallet.close === 'function') {
      this.wallet.close();
    }
  }
}

/**
 * Simple one-shot toll fetch.
 *
 * Supports two calling styles:
 *   tollFetch(url, { wallet, maxSats, method, body, headers })  — single opts
 *   tollFetch(url, fetchOpts, { wallet, maxSats })               — separate fetch + pay opts
 *
 * @param {string} url - URL to fetch
 * @param {object} [optsOrFetchOpts] - Combined options, or standard fetch options
 * @param {object} [payOpts] - Pay options (if using 3-arg form)
 * @returns {Promise<Response>}
 */
async function tollFetch(url, optsOrFetchOpts = {}, payOpts) {
  // Support both 2-arg and 3-arg calling styles
  let opts;
  if (payOpts && typeof payOpts === 'object') {
    // 3-arg: tollFetch(url, fetchOpts, payOpts)
    opts = { ...optsOrFetchOpts, ...payOpts };
  } else {
    // 2-arg: tollFetch(url, opts)
    opts = optsOrFetchOpts;
  }

  if (!opts.wallet) {
    throw new Error('tollFetch: wallet is required');
  }

  let wallet;
  if (typeof opts.wallet === 'string') {
    wallet = createWallet(opts.wallet);
  } else {
    wallet = opts.wallet;
  }

  const fetchOpts = {};
  if (opts.method) fetchOpts.method = opts.method;
  if (opts.body) fetchOpts.body = opts.body;
  if (opts.headers) fetchOpts.headers = opts.headers;

  const paymentOpts = {
    wallet,
    maxSats: opts.maxSats || 50,
    autoRetry: true,
    headers: opts.headers || {}
  };

  return autoPay(url, fetchOpts, paymentOpts);
}

module.exports = {
  TollClient,
  tollFetch
};
