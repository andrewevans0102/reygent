/**
 * Dashboard HTML template — inlined as template literal.
 * Dark terminal aesthetic, Chart.js 4.x from CDN.
 */
export function generateDashboardHtml(defaultSince: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reygent Telemetry Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    background: #0f0f1a;
    color: #e0e0e0;
    min-height: 100vh;
    padding: 24px;
  }
  a { color: #00d4ff; }
  h1 {
    font-size: 1.5rem;
    color: #00d4ff;
    margin-bottom: 4px;
  }
  .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 20px; }
  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }
  .controls label { color: #888; font-size: 0.85rem; }
  .controls select {
    background: #1a1a2e;
    color: #e0e0e0;
    border: 1px solid #333;
    padding: 6px 12px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .controls select:hover { border-color: #00d4ff; }
  .status {
    margin-left: auto;
    font-size: 0.75rem;
    color: #555;
  }
  .status.loading { color: #ffb700; }
  .status.error { color: #ff4444; }
  .status.ok { color: #00cc66; }

  /* KPI cards */
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .kpi {
    background: #1a1a2e;
    border: 1px solid #2a2a3e;
    border-radius: 8px;
    padding: 16px;
    text-align: center;
  }
  .kpi .value {
    font-size: 1.8rem;
    font-weight: bold;
    color: #00d4ff;
  }
  .kpi .value.green { color: #00cc66; }
  .kpi .value.red { color: #ff4444; }
  .kpi .value.yellow { color: #ffb700; }
  .kpi .label {
    font-size: 0.75rem;
    color: #888;
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Chart grid */
  .chart-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }
  .chart-row.full { grid-template-columns: 1fr; }
  .card {
    background: #1a1a2e;
    border: 1px solid #2a2a3e;
    border-radius: 8px;
    padding: 16px;
  }
  .card h2 {
    font-size: 0.9rem;
    color: #aaa;
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .card canvas { width: 100% !important; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  th {
    text-align: left;
    padding: 8px;
    color: #888;
    border-bottom: 1px solid #2a2a3e;
    font-weight: normal;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 0.7rem;
  }
  td {
    padding: 8px;
    border-bottom: 1px solid #1a1a2e;
  }
  tr:hover td { background: rgba(0,212,255,0.03); }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: bold;
  }
  .badge.success { background: rgba(0,204,102,0.2); color: #00cc66; }
  .badge.fail { background: rgba(255,68,68,0.2); color: #ff4444; }
  .badge.unknown { background: rgba(136,136,136,0.2); color: #888; }
  .mono { font-family: inherit; color: #888; }
  .empty { text-align: center; padding: 32px; color: #555; }

  @media (max-width: 768px) {
    .chart-row { grid-template-columns: 1fr; }
    .kpis { grid-template-columns: repeat(2, 1fr); }
    body { padding: 12px; }
  }
</style>
</head>
<body>

<h1>Reygent Telemetry Dashboard</h1>
<div class="subtitle">Local telemetry analysis</div>

<div class="controls">
  <label for="since">Time Range:</label>
  <select id="since">
    <option value="7d">Last 7 days</option>
    <option value="14d">Last 14 days</option>
    <option value="30d">Last 30 days</option>
    <option value="90d">Last 90 days</option>
    <option value="lastrun">Last Run</option>
  </select>
  <span id="status" class="status">Loading...</span>
</div>

<div class="kpis" id="kpis">
  <div class="kpi"><div class="value" id="kpi-runs">-</div><div class="label">Total Runs</div></div>
  <div class="kpi"><div class="value green" id="kpi-success">-</div><div class="label">Success Rate</div></div>
  <div class="kpi"><div class="value yellow" id="kpi-cost">-</div><div class="label">Total Cost</div></div>
  <div class="kpi"><div class="value" id="kpi-agents">-</div><div class="label">Active Agents</div></div>
  <div class="kpi"><div class="value red" id="kpi-errors">-</div><div class="label">Errors</div></div>
</div>

<div class="chart-row full">
  <div class="card">
    <h2>Event Timeline</h2>
    <canvas id="timelineChart" height="80"></canvas>
  </div>
</div>

<div class="chart-row">
  <div class="card">
    <h2>Cost Breakdown</h2>
    <canvas id="costDoughnut" height="140"></canvas>
  </div>
  <div class="card">
    <h2>Daily Cost</h2>
    <canvas id="costBar" height="140"></canvas>
  </div>
</div>

<div class="chart-row">
  <div class="card">
    <h2>Agent Success Rate</h2>
    <canvas id="agentBar" height="140"></canvas>
  </div>
  <div class="card">
    <h2>Failure Patterns</h2>
    <div id="failureTable"></div>
  </div>
</div>

<div class="chart-row full">
  <div class="card">
    <h2>Recent Runs</h2>
    <div id="runsTable"></div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
(function() {
  const $ = id => document.getElementById(id);
  let charts = {};
  const defaultSince = '${defaultSince}';

  // Set default selection
  const sinceSelect = $('since');
  for (const opt of sinceSelect.options) {
    if (opt.value === defaultSince) { opt.selected = true; break; }
  }

  const COLORS = {
    cyan: '#00d4ff',
    green: '#00cc66',
    red: '#ff4444',
    yellow: '#ffb700',
    purple: '#a855f7',
    orange: '#f97316',
    pink: '#ec4899',
    blue: '#3b82f6',
    teal: '#14b8a6',
    gray: '#666',
  };

  const CATEGORY_COLORS = {
    command: COLORS.cyan,
    agent: COLORS.green,
    llm: COLORS.purple,
    git: COLORS.orange,
    error: COLORS.red,
    pipeline: COLORS.blue,
    usage: COLORS.yellow,
    gate: COLORS.pink,
    tool: COLORS.teal,
    spec: '#8b5cf6',
    performance: '#06b6d4',
    knowledge: '#84cc16',
    review: '#f59e0b',
  };

  const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { labels: { color: '#888', font: { family: 'inherit', size: 11 } } },
    },
    scales: {
      x: { ticks: { color: '#666', font: { size: 10 } }, grid: { color: '#1a1a2e' } },
      y: { ticks: { color: '#666', font: { size: 10 } }, grid: { color: '#2a2a3e' } },
    },
  };

  function setStatus(text, cls) {
    const el = $('status');
    el.textContent = text;
    el.className = 'status ' + (cls || '');
  }

  async function fetchJson(endpoint) {
    const since = sinceSelect.value;
    const res = await fetch(endpoint + '?since=' + since);
    if (!res.ok) throw new Error(res.statusText);
    return res.json();
  }

  function destroyChart(name) {
    if (charts[name]) { charts[name].destroy(); delete charts[name]; }
  }

  function pct(n) { return Math.round(n * 100) + '%'; }
  function usd(n) { return '$' + n.toFixed(2); }
  function shortId(id) { return id ? id.substring(0, 8) : '-'; }
  function relTime(ts) {
    const diff = Date.now() - ts;
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (d > 0) return d + 'd ago';
    if (h > 0) return h + 'h ago';
    return '< 1h ago';
  }
  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
  }

  function renderKpis(overview) {
    $('kpi-runs').textContent = overview.totalRuns;
    $('kpi-success').textContent = overview.totalRuns > 0 ? pct(overview.successRate) : '-';
    $('kpi-cost').textContent = usd(overview.totalCost);
    $('kpi-agents').textContent = overview.activeAgents;
    $('kpi-errors').textContent = overview.totalErrors;
  }

  function renderTimeline(data) {
    destroyChart('timeline');
    if (!data.buckets || data.buckets.length === 0) return;

    const labels = data.buckets.map(b => b.date);
    const datasets = data.categories.map(cat => ({
      label: cat,
      data: data.buckets.map(b => b.counts[cat] || 0),
      backgroundColor: (CATEGORY_COLORS[cat] || COLORS.gray) + '66',
      borderColor: CATEGORY_COLORS[cat] || COLORS.gray,
      borderWidth: 1,
      fill: true,
    }));

    charts.timeline = new Chart($('timelineChart'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...CHART_DEFAULTS,
        interaction: { mode: 'index', intersect: false },
        scales: {
          ...CHART_DEFAULTS.scales,
          x: { ...CHART_DEFAULTS.scales.x, stacked: true },
          y: { ...CHART_DEFAULTS.scales.y, stacked: true, beginAtZero: true },
        },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { ...CHART_DEFAULTS.plugins.legend, position: 'bottom' },
        },
      },
    });
  }

  function renderCostDoughnut(costs) {
    destroyChart('costDoughnut');
    if (!costs.byAgent || costs.byAgent.length === 0) {
      $('costDoughnut').parentElement.querySelector('h2').textContent = 'Cost Breakdown (no data)';
      return;
    }

    const palette = [COLORS.cyan, COLORS.green, COLORS.purple, COLORS.orange, COLORS.pink, COLORS.yellow, COLORS.teal, COLORS.blue];
    charts.costDoughnut = new Chart($('costDoughnut'), {
      type: 'doughnut',
      data: {
        labels: costs.byAgent.map(a => a.name),
        datasets: [{
          data: costs.byAgent.map(a => +a.cost.toFixed(2)),
          backgroundColor: costs.byAgent.map((_, i) => palette[i % palette.length] + 'cc'),
          borderColor: '#0f0f1a',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'right', labels: { color: '#888', font: { family: 'inherit', size: 11 } } },
        },
      },
    });
  }

  function renderCostBar(costs) {
    destroyChart('costBar');
    if (!costs.dailyCosts || costs.dailyCosts.length === 0) return;

    charts.costBar = new Chart($('costBar'), {
      type: 'bar',
      data: {
        labels: costs.dailyCosts.map(d => d.date),
        datasets: [{
          label: 'Daily Cost ($)',
          data: costs.dailyCosts.map(d => +d.cost.toFixed(2)),
          backgroundColor: COLORS.yellow + '99',
          borderColor: COLORS.yellow,
          borderWidth: 1,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true },
        },
      },
    });
  }

  function renderAgentBar(agents) {
    destroyChart('agentBar');
    if (!agents.agents || agents.agents.length === 0) return;

    const sorted = [...agents.agents].sort((a, b) => b.successRate - a.successRate);
    charts.agentBar = new Chart($('agentBar'), {
      type: 'bar',
      data: {
        labels: sorted.map(a => a.agent),
        datasets: [{
          label: 'Success Rate',
          data: sorted.map(a => +(a.successRate * 100).toFixed(1)),
          backgroundColor: sorted.map(a =>
            a.successRate >= 0.9 ? COLORS.green + '99' :
            a.successRate >= 0.7 ? COLORS.yellow + '99' : COLORS.red + '99'
          ),
          borderColor: sorted.map(a =>
            a.successRate >= 0.9 ? COLORS.green :
            a.successRate >= 0.7 ? COLORS.yellow : COLORS.red
          ),
          borderWidth: 1,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        indexAxis: 'y',
        plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
        scales: {
          ...CHART_DEFAULTS.scales,
          x: { ...CHART_DEFAULTS.scales.x, beginAtZero: true, max: 100 },
        },
      },
    });
  }

  function renderFailureTable(failures) {
    const el = $('failureTable');
    if (!failures.patterns || failures.patterns.length === 0) {
      el.innerHTML = '<div class="empty">No failure patterns found</div>';
      return;
    }
    let html = '<table><thead><tr><th>Pattern</th><th>Count</th><th>Agents</th><th>Last Seen</th></tr></thead><tbody>';
    for (const p of failures.patterns.slice(0, 10)) {
      const agents = p.agents.map(a => a.name).join(', ');
      html += '<tr>';
      html += '<td>' + esc(p.eventName) + '</td>';
      html += '<td>' + p.count + '</td>';
      html += '<td class="mono">' + esc(agents) + '</td>';
      html += '<td class="mono">' + relTime(p.mostRecent.timestamp) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function renderRunsTable(runs) {
    const el = $('runsTable');
    if (!runs || runs.length === 0) {
      el.innerHTML = '<div class="empty">No runs found</div>';
      return;
    }
    let html = '<table><thead><tr><th>Run ID</th><th>Status</th><th>Duration</th><th>Cost</th><th>Agents</th><th>When</th></tr></thead><tbody>';
    for (const r of runs.slice(0, 20)) {
      const statusBadge = r.success === true
        ? '<span class="badge success">OK</span>'
        : r.success === false
        ? '<span class="badge fail">FAIL</span>'
        : '<span class="badge unknown">?</span>';
      html += '<tr>';
      html += '<td class="mono">' + shortId(r.runId) + '</td>';
      html += '<td>' + statusBadge + '</td>';
      html += '<td class="mono">' + fmtDuration(r.duration) + '</td>';
      html += '<td class="mono">' + (r.cost > 0 ? usd(r.cost) : '-') + '</td>';
      html += '<td class="mono">' + esc(r.agents.join(', ')) + '</td>';
      html += '<td class="mono">' + relTime(r.startTime) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  async function loadDashboard() {
    setStatus('Loading...', 'loading');
    try {
      const [overview, timeline, costs, agents, failures, runs] = await Promise.all([
        fetchJson('/api/overview'),
        fetchJson('/api/timeline'),
        fetchJson('/api/costs'),
        fetchJson('/api/agents'),
        fetchJson('/api/failures'),
        fetchJson('/api/runs'),
      ]);

      renderKpis(overview);
      renderTimeline(timeline);
      renderCostDoughnut(costs);
      renderCostBar(costs);
      renderAgentBar(agents);
      renderFailureTable(failures);
      renderRunsTable(runs);

      setStatus('Updated ' + new Date().toLocaleTimeString(), 'ok');
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
      console.error('Dashboard load error:', err);
    }
  }

  // Check Chart.js loaded
  if (typeof Chart === 'undefined') {
    document.body.innerHTML = '<div style="padding:48px;text-align:center;color:#ff4444">'
      + '<h1 style="color:#ff4444">Chart.js unavailable</h1>'
      + '<p style="color:#888;margin-top:12px">Could not load Chart.js from CDN. Check internet connection.</p>'
      + '<p style="color:#888;margin-top:8px">Dashboard requires network access for chart rendering.</p>'
      + '</div>';
    return;
  }

  // Set Chart.js defaults
  Chart.defaults.color = '#888';
  Chart.defaults.font.family = 'inherit';

  sinceSelect.addEventListener('change', loadDashboard);
  loadDashboard();
})();
</script>
</body>
</html>`;
}
