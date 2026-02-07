#!/usr/bin/env node
'use strict';

const { TollStats, createMetricsExporter } = require('./src');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

console.log('\n📊 TollStats');

const stats = new TollStats();

// Record some payments
stats.record('/api/data', true, 100, 'client1', 'hash1');
stats.record('/api/data', true, 50, 'client2', 'hash2');
stats.record('/api/data', false, 0, 'client3'); // free
stats.record('/api/other', true, 200, 'client1', 'hash3');

const data = stats.toJSON();
assert(data.totalRevenue === 350, 'tracks total revenue');
assert(data.totalRequests === 4, 'tracks total requests');
assert(data.totalPaid === 3, 'tracks paid requests');
assert(data.uniquePayers === 2, 'tracks unique payers (paid only)');
assert(Object.keys(data.endpoints).length === 2, 'tracks per-endpoint stats');
assert(data.endpoints['/api/data'].revenue === 150, 'per-endpoint revenue correct');

console.log('\n📈 Prometheus Metrics');

const exporter = createMetricsExporter(stats);
const metrics = exporter.generate();

assert(metrics.includes('lightning_toll_revenue_sats_total 350'), 'exports total revenue');
assert(metrics.includes('lightning_toll_requests_total 4'), 'exports total requests');
assert(metrics.includes('lightning_toll_paid_requests_total 3'), 'exports paid requests');
assert(metrics.includes('lightning_toll_unique_payers 2'), 'exports unique payers');
assert(metrics.includes('endpoint="/api/data"'), 'includes endpoint labels');
assert(metrics.includes('# HELP'), 'includes help text');
assert(metrics.includes('# TYPE'), 'includes type annotations');

console.log('\n📋 Metrics Handler');

const handler = exporter.handler();
assert(typeof handler === 'function', 'handler is a function');

// Mock response
let sentContentType = null;
let sentBody = null;
const mockRes = {
  set: (k, v) => { sentContentType = v; return mockRes; },
  send: (body) => { sentBody = body; }
};

handler({}, mockRes);
assert(sentContentType.includes('text/plain'), 'sets correct content type');
assert(sentBody.includes('lightning_toll'), 'sends metrics');

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
