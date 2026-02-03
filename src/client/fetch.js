'use strict';

const { parseAuthorization } = require('../l402');

/**
 * Auto-pay fetch wrapper.
 * When a 402 response is received, automatically pays the Lightning invoice
 * and retries the request with the L402 authorization header.
 *
 * @param {string} url - URL to fetch
 * @param {object} [fetchOpts] - Standard fetch options
 * @param {object} payOpts
 * @param {object} payOpts.wallet - lightning-agent wallet instance
 * @param {number} [payOpts.maxSats=100] - Maximum sats to pay per request
 * @param {boolean} [payOpts.autoRetry=true] - Automatically pay and retry on 402
 * @param {object} [payOpts.headers] - Additional headers
 * @returns {Promise<Response>}
 */
async function autoPay(url, fetchOpts = {}, payOpts = {}) {
  const wallet = payOpts.wallet;
  if (!wallet) throw new Error('lightning-toll/client: wallet is required');

  const maxSats = payOpts.maxSats || 100;
  const autoRetry = payOpts.autoRetry !== false;

  // Make the initial request
  const mergedHeaders = { ...payOpts.headers, ...fetchOpts.headers };
  const res = await fetch(url, { ...fetchOpts, headers: mergedHeaders });

  // If not 402, return as-is
  if (res.status !== 402) return res;

  // If auto-retry is disabled, return the 402
  if (!autoRetry) return res;

  // Parse the 402 response
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error('lightning-toll/client: Could not parse 402 response body');
  }

  if (!body.invoice) {
    throw new Error('lightning-toll/client: 402 response missing invoice');
  }
  if (!body.macaroon) {
    throw new Error('lightning-toll/client: 402 response missing macaroon');
  }

  // Check budget
  const amountSats = body.amountSats || 0;
  if (amountSats > maxSats) {
    throw new Error(`lightning-toll/client: Price ${amountSats} sats exceeds budget of ${maxSats} sats`);
  }

  // Pay the invoice
  const payResult = await wallet.payInvoice(body.invoice);
  if (!payResult || !payResult.preimage) {
    throw new Error('lightning-toll/client: Payment failed — no preimage returned');
  }

  // Retry with L402 authorization
  const authHeader = `L402 ${body.macaroon}:${payResult.preimage}`;
  const retryHeaders = {
    ...mergedHeaders,
    Authorization: authHeader
  };

  const retryRes = await fetch(url, { ...fetchOpts, headers: retryHeaders });
  return retryRes;
}

module.exports = { autoPay };
