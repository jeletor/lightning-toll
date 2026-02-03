'use strict';

const express = require('express');
const path = require('path');
const { createToll } = require('lightning-toll');

// ─── Configuration ───

const NWC_URL = process.env.NWC_URL;
const SECRET = process.env.TOLL_SECRET || 'demo-secret-change-me-in-production';
const PORT = process.env.PORT || 3402;

if (!NWC_URL) {
  console.error('⚡ lightning-toll demo');
  console.error('');
  console.error('  NWC_URL environment variable is required.');
  console.error('  Get one from https://nwc.getalby.com or your Lightning wallet.');
  console.error('');
  console.error('  Usage:');
  console.error('    NWC_URL="nostr+walletconnect://..." node server.js');
  console.error('');
  process.exit(1);
}

// ─── Create toll booth ───

const toll = createToll({
  wallet: NWC_URL,
  secret: SECRET,
  defaultSats: 10,
  invoiceExpiry: 300,
  macaroonExpiry: 3600,
  onPayment: (info) => {
    console.log(`⚡ Payment received: ${info.amountSats} sats for ${info.endpoint}`);
  }
});

// ─── Express app ───

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Toll-gated endpoints ───

// 1. Random joke — 5 sats
const jokes = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "There are only 10 types of people — those who understand binary and those who don't.",
  "A SQL query walks into a bar, sees two tables, and asks: 'Can I JOIN you?'",
  "Why was the JavaScript developer sad? Because he didn't Node how to Express himself.",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "What's a pirate's favorite programming language? R!",
  "Knock knock. Race condition. Who's there?",
  "!false — it's funny because it's true.",
  "How many Bitcoiners does it take to change a lightbulb? 21 million, but they'll HODL it.",
  "Why did the Bitcoin cross the blockchain? To get to the other node."
];

app.get('/api/joke', toll({ sats: 5, description: 'Random joke' }), (req, res) => {
  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  res.json({
    joke,
    paid: req.toll?.paid || false,
    timestamp: new Date().toISOString()
  });
});

// 2. Current time — 1 sat
app.get('/api/time', toll({ sats: 1, description: 'Current time' }), (req, res) => {
  const now = new Date();
  res.json({
    utc: now.toISOString(),
    unix: Math.floor(now.getTime() / 1000),
    human: now.toUTCString(),
    blockHeight: 'check a real API for that :)',
    paid: req.toll?.paid || false
  });
});

// 3. Echo — dynamic pricing (1 sat per word)
app.post('/api/echo', toll({
  price: (req) => {
    const text = req.body?.text || '';
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, words);
  },
  description: (req) => {
    const text = req.body?.text || '';
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return `Echo ${words} word(s)`;
  }
}), (req, res) => {
  const text = req.body?.text || '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  res.json({
    echo: text,
    wordCount: words.length,
    reversed: words.reverse().join(' '),
    cost: Math.max(1, words.length),
    paid: req.toll?.paid || false
  });
});

// 4. Fortune cookie — 10 sats
const fortunes = [
  "A beautiful, smart, and loving person will come into your life... after you buy more Bitcoin.",
  "The best time to plant a tree was 20 years ago. The best time to buy Bitcoin was 2009.",
  "Your patience will be rewarded. Probably not today though.",
  "A journey of a thousand miles begins with a single satoshi.",
  "You will soon receive an unexpected Lightning payment.",
  "The secret to getting ahead is getting started. Also, proof of work.",
  "Good things come to those who HODL.",
  "Your future is as bright as a Lightning node with 100% uptime.",
  "An empty wallet is a temporary condition. Being broke is a state of mind.",
  "In the middle of difficulty lies opportunity — and a lower buy price."
];

app.get('/api/fortune', toll({ sats: 10, description: 'Fortune cookie' }), (req, res) => {
  const fortune = fortunes[Math.floor(Math.random() * fortunes.length)];
  res.json({
    fortune,
    luckyNumber: Math.floor(Math.random() * 21000000),
    paid: req.toll?.paid || false,
    timestamp: new Date().toISOString()
  });
});

// 5. Free tier endpoint — 21 sats but 3 free requests per hour
app.get('/api/free-tier', toll({
  sats: 21,
  freeRequests: 3,
  freeWindow: '1h',
  description: 'Free tier demo (3 free per hour, then 21 sats)'
}), (req, res) => {
  res.json({
    message: 'You got access!',
    wasFree: req.toll?.free || false,
    wasPaid: req.toll?.paid || false,
    timestamp: new Date().toISOString(),
    hint: 'This endpoint gives 3 free requests per hour per IP, then costs 21 sats.'
  });
});

// 6. Stats dashboard — free
app.get('/api/stats', toll.dashboard());

// ─── API info endpoint (free) ───
app.get('/api', (req, res) => {
  res.json({
    name: 'lightning-toll demo',
    version: '0.1.0',
    endpoints: [
      { path: '/api/joke', method: 'GET', sats: 5, description: 'Random programming joke' },
      { path: '/api/time', method: 'GET', sats: 1, description: 'Current time' },
      { path: '/api/echo', method: 'POST', sats: '1 per word', description: 'Echo with word count (send JSON { text: "..." })' },
      { path: '/api/fortune', method: 'GET', sats: 10, description: 'Fortune cookie message' },
      { path: '/api/free-tier', method: 'GET', sats: '21 (3 free/hour)', description: 'Free tier demo' },
      { path: '/api/stats', method: 'GET', sats: 0, description: 'Revenue dashboard (free)' }
    ],
    protocol: 'L402 — https://github.com/jeletor/lightning-toll'
  });
});

// ─── Start server ───

app.listen(PORT, () => {
  console.log('');
  console.log('  ⚡ lightning-toll demo server');
  console.log(`  ⚡ http://localhost:${PORT}`);
  console.log('');
  console.log('  Endpoints:');
  console.log(`    GET  /api/joke       — 5 sats`);
  console.log(`    GET  /api/time       — 1 sat`);
  console.log(`    POST /api/echo       — 1 sat/word`);
  console.log(`    GET  /api/fortune    — 10 sats`);
  console.log(`    GET  /api/free-tier  — 21 sats (3 free/hour)`);
  console.log(`    GET  /api/stats      — free dashboard`);
  console.log('');
  console.log('  Open http://localhost:' + PORT + ' for the interactive UI');
  console.log('');
});
