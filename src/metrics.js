'use strict';

/**
 * Prometheus metrics exporter for lightning-toll.
 * Exports payment stats in Prometheus text format.
 */

const METRIC_PREFIX = 'lightning_toll';

/**
 * Format a metric line in Prometheus text format.
 */
function formatMetric(name, value, labels = {}, help = null, type = 'gauge') {
  const lines = [];
  const fullName = `${METRIC_PREFIX}_${name}`;
  
  if (help) {
    lines.push(`# HELP ${fullName} ${help}`);
    lines.push(`# TYPE ${fullName} ${type}`);
  }
  
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
    .join(',');
  
  const labelPart = labelStr ? `{${labelStr}}` : '';
  lines.push(`${fullName}${labelPart} ${value}`);
  
  return lines.join('\n');
}

/**
 * Create a Prometheus metrics exporter for TollStats.
 * @param {TollStats} stats - Stats instance from lightning-toll
 * @returns {object} Metrics exporter
 */
function createMetricsExporter(stats) {
  /**
   * Generate Prometheus text format metrics.
   * @returns {string} Prometheus format metrics
   */
  function generate() {
    const lines = [];
    const data = stats.toJSON();
    
    // Global metrics
    lines.push(formatMetric(
      'revenue_sats_total',
      data.totalRevenue,
      {},
      'Total revenue collected in satoshis',
      'counter'
    ));
    
    lines.push('');
    lines.push(formatMetric(
      'requests_total',
      data.totalRequests,
      {},
      'Total number of requests received',
      'counter'
    ));
    
    lines.push('');
    lines.push(formatMetric(
      'paid_requests_total',
      data.totalPaid,
      {},
      'Total number of paid requests',
      'counter'
    ));
    
    lines.push('');
    lines.push(formatMetric(
      'unique_payers',
      data.uniquePayers,
      {},
      'Number of unique payers',
      'gauge'
    ));
    
    // Per-endpoint metrics
    for (const [endpoint, epData] of Object.entries(data.endpoints)) {
      lines.push('');
      lines.push(formatMetric(
        'endpoint_revenue_sats',
        epData.revenue,
        { endpoint },
        'Revenue per endpoint in satoshis',
        'gauge'
      ));
      
      lines.push(formatMetric(
        'endpoint_requests',
        epData.requests,
        { endpoint }
      ));
      
      lines.push(formatMetric(
        'endpoint_paid',
        epData.paid,
        { endpoint }
      ));
      
      lines.push(formatMetric(
        'endpoint_free',
        epData.free || 0,
        { endpoint }
      ));
    }
    
    // Recent payment rate (last minute approximation)
    const oneMinuteAgo = Date.now() - 60000;
    const recentCount = data.recentPayments.filter(p => p.timestamp > oneMinuteAgo).length;
    lines.push('');
    lines.push(formatMetric(
      'payments_per_minute',
      recentCount,
      {},
      'Approximate payments in the last minute',
      'gauge'
    ));
    
    // Average payment size
    if (data.totalPaid > 0) {
      const avgPayment = Math.round(data.totalRevenue / data.totalPaid);
      lines.push('');
      lines.push(formatMetric(
        'average_payment_sats',
        avgPayment,
        {},
        'Average payment size in satoshis',
        'gauge'
      ));
    }
    
    return lines.join('\n') + '\n';
  }
  
  /**
   * Express handler that serves Prometheus metrics.
   * @returns {Function} Express handler
   */
  function handler() {
    return (req, res) => {
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(generate());
    };
  }
  
  return {
    generate,
    handler
  };
}

module.exports = { createMetricsExporter, formatMetric, METRIC_PREFIX };
