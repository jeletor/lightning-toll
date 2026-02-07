# ⚡ lightning-toll

**Pay before accessing this endpoint.**

You can't get the data without paying. lightning-toll is the gate — drop-in Express middleware that puts any API behind a Lightning paywall. No API keys to manage, no billing system, no Stripe. Send a request, get a 402 with an invoice, pay it, retry with the preimage, get your data. Implements the [L402 protocol](https://docs.lightning.engineering/the-lightning-network/l402) with proper macaroon credentials.

Part of the constraint chain: [agent-discovery](https://github.com/jeletor/agent-discovery) (find) → [ai-wot](https://github.com/jeletor/ai-wot) (verify) → [lightning-agent](https://github.com/jeletor/lightning-agent) (pay) → **lightning-toll** (gate).

## Installation

```bash
npm install lightning-toll lightning-agent
```

`express` is a peer dependency (use your existing Express app).

## Quick Start

### Server (5 lines)

```js
const express = require('express');
const { createToll } = require('lightning-toll');

const app = express();
const toll = createToll({ wallet: process.env.NWC_URL, secret: 'your-hmac-secret' });

app.get('/api/joke', toll({ sats: 5 }), (req, res) => res.json({ joke: '...' }));
app.listen(3000);
```

### Client (3 lines)

```js
const { tollFetch } = require('lightning-toll/client');
const res = await tollFetch('https://api.example.com/joke', { wallet: process.env.NWC_URL });
const data = await res.json(); // Paid 5 sats automatically
```

## How It Works — L402 Protocol

```
Client                                Server
  |                                      |
  |  GET /api/joke                       |
  |  ─────────────────────────────────>  |
  |                                      |
  |  402 Payment Required                |
  |  WWW-Authenticate: L402 invoice="..",|
  |    macaroon=".."                     |
  |  <─────────────────────────────────  |
  |                                      |
  |  [Pays Lightning invoice]            |
  |  [Gets preimage as receipt]          |
  |                                      |
  |  GET /api/joke                       |
  |  Authorization: L402 <mac>:<preimage>|
  |  ─────────────────────────────────>  |
  |                                      |
  |  200 OK { joke: "..." }             |
  |  <─────────────────────────────────  |
```

1. Client requests an endpoint without payment
2. Server returns **402 Payment Required** with a Lightning invoice and a macaroon
3. Client pays the invoice with any Lightning wallet
4. Client retries with `Authorization: L402 <macaroon>:<preimage>`
5. Server verifies the preimage matches the payment hash, checks the macaroon, and grants access

## API Reference

### `createToll(options)`

Creates a toll booth instance. Returns a `toll()` function for creating per-route middleware.

```js
const { createToll } = require('lightning-toll');

const toll = createToll({
  // Required
  wallet: process.env.NWC_URL,   // NWC connection string OR lightning-agent wallet instance
  secret: 'hmac-signing-secret', // Secret for macaroon HMAC signatures

  // Optional
  defaultSats: 10,       // Default price if not set per-route (default: 10)
  invoiceExpiry: 300,     // Invoice expiry in seconds (default: 300 = 5 min)
  macaroonExpiry: 3600,   // How long a paid macaroon stays valid (default: 3600 = 1 hour)
  bindEndpoint: true,     // Bind macaroons to the specific endpoint (default: true)
  bindMethod: true,       // Bind macaroons to the HTTP method (default: true)
  bindIp: false,          // Bind macaroons to client IP (default: false)

  // Callbacks
  onPayment: (info) => {
    console.log(`Paid: ${info.amountSats} sats for ${info.endpoint}`);
    // info: { paymentHash, amountSats, endpoint, preimage, settledAt, clientId }
  }
});
```

#### Using a wallet instance

You can pass an NWC URL string (and lightning-toll creates the wallet internally), or pass a pre-created `lightning-agent` wallet:

```js
const { createWallet } = require('lightning-agent');
const wallet = createWallet(process.env.NWC_URL);

const toll = createToll({ wallet, secret: 'my-secret' });
```

### `toll(routeOptions)` — Route Middleware

```js
// Fixed price
app.get('/api/data', toll({ sats: 21 }), handler);

// Dynamic price based on request
app.get('/api/search', toll({
  price: (req) => req.query.premium ? 50 : 10,
  description: (req) => `Search: ${req.query.q}`
}), handler);

// Free tier + paid
app.get('/api/data', toll({
  sats: 21,
  freeRequests: 10,     // Free requests per window per client
  freeWindow: '1h'      // Window duration: '30m', '1h', '1d', etc.
}), handler);

// Custom description
app.get('/api/ai', toll({
  sats: 100,
  description: 'AI inference — GPT-4 quality'
}), handler);
```

#### Route Options

| Option | Type | Description |
|--------|------|-------------|
| `sats` | `number` | Fixed price in satoshis |
| `price` | `(req) => number` | Dynamic pricing function |
| `description` | `string \| (req) => string` | Invoice description |
| `freeRequests` | `number` | Free requests per window per client |
| `freeWindow` | `string \| number` | Free tier window (`'1h'`, `'30m'`, `'1d'`, or milliseconds) |

### `req.toll` — Payment Info

After the middleware runs, `req.toll` is set on the request:

```js
app.get('/api/data', toll({ sats: 5 }), (req, res) => {
  if (req.toll.paid) {
    // Client paid with Lightning
    console.log(req.toll.paymentHash);
    console.log(req.toll.amountSats);
  }
  if (req.toll.free) {
    // Client used a free tier request
  }
  res.json({ data: '...' });
});
```

### `toll.dashboard()` — Stats Endpoint

```js
app.get('/api/stats', toll.dashboard());
```

Returns JSON:

```json
{
  "totalRevenue": 1250,
  "totalRequests": 340,
  "totalPaid": 125,
  "uniquePayers": 42,
  "endpoints": {
    "/api/joke": { "revenue": 500, "requests": 100, "paid": 100, "free": 0 },
    "/api/data": { "revenue": 750, "requests": 240, "paid": 25, "free": 215 }
  },
  "recentPayments": [
    {
      "endpoint": "/api/joke",
      "amountSats": 5,
      "payerId": "203.0.113.1",
      "paymentHash": "abc123...",
      "timestamp": 1706817600000
    }
  ]
}
```

Stats are in-memory by default. To persist them, read `toll.stats.toJSON()` periodically and restore on startup.

### `toll.stats` — Direct Stats Access

```js
const stats = toll.stats.toJSON();
console.log(`Total revenue: ${stats.totalRevenue} sats`);
```

### `toll.metrics()` — Prometheus Metrics

Export stats in Prometheus text format for monitoring:

```js
app.get('/metrics', toll.metrics());
```

Returns:

```
# HELP lightning_toll_revenue_sats_total Total revenue collected in satoshis
# TYPE lightning_toll_revenue_sats_total counter
lightning_toll_revenue_sats_total 1250

# HELP lightning_toll_requests_total Total number of requests received
# TYPE lightning_toll_requests_total counter
lightning_toll_requests_total 340

lightning_toll_paid_requests_total 125
lightning_toll_unique_payers 42
lightning_toll_endpoint_revenue_sats{endpoint="/api/joke"} 500
lightning_toll_payments_per_minute 3
lightning_toll_average_payment_sats 10
```

Scrape this endpoint with Prometheus to track:
- Revenue over time
- Request volume
- Payment conversion rates
- Per-endpoint performance

## Client SDK

### `TollClient`

A client that automatically handles L402 payment flows:

```js
const { TollClient } = require('lightning-toll/client');

const client = new TollClient({
  wallet: process.env.NWC_URL,  // NWC URL or wallet instance
  maxSats: 100,                  // Budget cap per request (default: 100)
  autoRetry: true,               // Auto-pay and retry on 402 (default: true)
  headers: {                     // Default headers for all requests
    'User-Agent': 'MyApp/1.0'
  }
});

// Transparent fetch — handles 402 automatically
const res = await client.fetch('https://api.example.com/joke');
const data = await res.json();

// Per-request budget override
const res2 = await client.fetch('https://api.example.com/expensive', {
  maxSats: 500
});

// Clean up
client.close();
```

### `tollFetch(url, options)`

One-shot fetch with auto-payment — no client setup needed:

```js
const { tollFetch } = require('lightning-toll/client');

const res = await tollFetch('https://api.example.com/joke', {
  wallet: process.env.NWC_URL,
  maxSats: 50
});
const data = await res.json();
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `wallet` | `string \| object` | required | NWC URL or wallet instance |
| `maxSats` | `number` | 50 | Max sats to auto-pay |
| `method` | `string` | `'GET'` | HTTP method |
| `headers` | `object` | `{}` | Request headers |
| `body` | `*` | - | Request body |

## Macaroon Caveats

Macaroons are bearer credentials with embedded restrictions (caveats). Each caveat narrows the scope of what the credential allows.

### Supported Caveats

| Caveat | Description | Default |
|--------|-------------|---------|
| `expires_at` | Unix timestamp — macaroon expires after this | Always set (based on `macaroonExpiry`) |
| `endpoint` | Path the macaroon is valid for | Set when `bindEndpoint: true` |
| `method` | HTTP method restriction | Set when `bindMethod: true` |
| `ip` | Client IP restriction | Set when `bindIp: true` |

### How Macaroons Work

```
1. Server creates macaroon:
   HMAC(secret, paymentHash) → sig₁
   HMAC(sig₁, "expires_at = 1706900000") → sig₂
   HMAC(sig₂, "endpoint = /api/joke") → final_signature

2. Macaroon = { id: paymentHash, caveats: [...], signature: final_sig }

3. Verification: recompute the HMAC chain and compare signatures
```

Macaroons use chained HMAC-SHA256. Each caveat is folded into the signature, making it impossible to remove caveats without invalidating the signature.

### Security Model

- **Payment binding:** The macaroon ID is the Lightning payment hash. The preimage (proof of payment) must match.
- **Caveat verification:** All caveats are checked against the current request context.
- **Timing-safe comparison:** Signature verification uses `crypto.timingSafeEqual`.
- **No replay:** Each preimage+macaroon combination is checked cryptographically. The preimage can only match one payment hash.

## Free Tier Configuration

Give users a taste before they pay:

```js
app.get('/api/data', toll({
  sats: 21,
  freeRequests: 10,     // 10 free requests...
  freeWindow: '1h'      // ...per hour, per client IP
}), handler);
```

Free tier tracking is per client IP by default. The window resets after the specified duration. Supported window formats:

- `'30s'` — 30 seconds
- `'5m'` — 5 minutes
- `'1h'` — 1 hour
- `'1d'` — 1 day
- `3600000` — milliseconds directly

## Dynamic Pricing

Price APIs based on request content:

```js
// Price by query complexity
app.get('/api/search', toll({
  price: (req) => {
    if (req.query.deep === 'true') return 50;
    if (req.query.premium === 'true') return 20;
    return 5;
  }
}), handler);

// Price by content length
app.post('/api/translate', toll({
  price: (req) => {
    const chars = (req.body?.text || '').length;
    return Math.max(1, Math.ceil(chars / 100)); // 1 sat per 100 chars
  }
}), handler);

// Price by time of day (surge pricing)
app.get('/api/premium', toll({
  price: (req) => {
    const hour = new Date().getHours();
    return hour >= 9 && hour <= 17 ? 50 : 10; // Peak vs off-peak
  }
}), handler);
```

## 402 Response Format

When a client hits a toll-gated endpoint without payment:

```
HTTP/1.1 402 Payment Required
WWW-Authenticate: L402 invoice="lnbc50n1pj...", macaroon="eyJpZCI..."
Content-Type: application/json

{
  "status": 402,
  "message": "Payment Required",
  "paymentHash": "a1b2c3d4...",
  "invoice": "lnbc50n1pj...",
  "macaroon": "eyJpZCI...",
  "amountSats": 5,
  "description": "Random joke",
  "protocol": "L402",
  "instructions": {
    "step1": "Pay the Lightning invoice above",
    "step2": "Get the preimage from the payment receipt",
    "step3": "Retry the request with header: Authorization: L402 <macaroon>:<preimage>"
  }
}
```

## Security Considerations

- **Use a strong secret.** The HMAC secret should be a random string of at least 32 characters. Use `crypto.randomBytes(32).toString('hex')`.
- **HTTPS in production.** Macaroons and preimages are bearer credentials — always use HTTPS.
- **Invoice expiry.** Default is 5 minutes. Shorter = safer, but gives users less time to pay.
- **Macaroon expiry.** Default is 1 hour. A paid macaroon can be reused until it expires.
- **IP binding.** Enable `bindIp: true` if you want macaroons tied to a specific client IP. Beware of NAT and proxies.
- **Rate limiting.** lightning-toll doesn't include rate limiting beyond the free tier. Use a proper rate limiter (like `express-rate-limit`) for DDoS protection.
- **Stats persistence.** Stats are in-memory by default and reset on restart. For production, periodically snapshot `toll.stats.toJSON()` to a database.

## Why Lightning Instead of API Keys?

| | API Keys / Stripe | lightning-toll |
|---|---|---|
| **Setup time** | Hours–days (Stripe onboarding, billing pages) | Minutes (`npm install` + 5 lines of code) |
| **User friction** | Sign up, enter credit card, wait for approval | Scan QR code, pay instantly |
| **Minimum viable payment** | $0.50+ (credit card minimums) | 1 sat (~$0.0005) — true micropayments |
| **Chargebacks** | Yes (costly) | No — Lightning payments are final |
| **KYC required** | Yes (for Stripe/PayPal) | No |
| **Geographic restrictions** | Yes | No — works globally, instantly |
| **Privacy** | Full identity required | Pseudonymous by default |
| **Settlement** | Days to weeks | Instant |

## Demo

Run the included demo server:

```bash
cd demo
npm install
NWC_URL="nostr+walletconnect://..." node server.js
```

Open `http://localhost:3402` for an interactive UI with:
- Multiple toll-gated endpoints at different price points
- "Try it" buttons showing the 402 response flow
- Live revenue dashboard
- Code examples

### Demo Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/joke` | 5 sats | Random programming joke |
| `GET /api/time` | 1 sat | Current server time |
| `POST /api/echo` | 1 sat/word | Echo text with dynamic pricing |
| `GET /api/fortune` | 10 sats | Bitcoin-themed fortune cookie |
| `GET /api/free-tier` | 21 sats (3 free/hr) | Free tier demo |
| `GET /api/stats` | Free | Revenue dashboard |

## License

MIT — [Jeletor](https://github.com/jeletor)
