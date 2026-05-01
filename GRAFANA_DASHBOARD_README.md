# Grafana Dashboard Setup Guide

## Overview

This guide explains how to set up and customize the Blockchain Indexer monitoring dashboard in Grafana with a monochrome aesthetic.

## Files

- **`grafana-dashboard.json`**: Dashboard configuration with panels and queries
- **`grafana-custom-styles.css`**: Custom CSS for monochrome aesthetic
- **`PRODUCTION_RUNBOOK.md`**: Complete operational runbook

## Features

### Visual Design

- **Monochrome Aesthetic**: Black background with green/red status indicators
- **Monospace Fonts**: Ledger numbers displayed in monospace for easy reading
- **Compact Layout**: Dense information display optimized for operations
- **Real-time Updates**: 5-second refresh interval for live monitoring

### Dashboard Panels

1. **Ledger Lag** (Stat)
   - Current lag behind network
   - Green if ≤5, red if >5
   - Large monospace display

2. **Ledger Status** (Table)
   - Last processed ledger
   - Network height
   - Monospace formatting

3. **Total Errors** (Stat)
   - Cumulative error count
   - Red background if >0
   - Area graph sparkline

4. **Events Processed** (Stat)
   - Total events indexed
   - Green color scheme
   - Area graph sparkline

5. **Event Processing Rate** (Time Series)
   - Events per second over time
   - Smooth line interpolation
   - Mean and max in legend

6. **Error Rate** (Time Series)
   - Errors per minute
   - Bar chart visualization
   - Sum and max in legend

7. **Processing Latency** (Time Series)
   - p50, p95, p99 percentiles
   - Multiple series comparison
   - Smooth gradient fill

8. **Ledger Lag Over Time** (Time Series)
   - Historical lag tracking
   - Threshold line at 5 ledgers
   - Area fill below line

9. **Recent Indexer Events** (Table)
   - Compact log table
   - Monospace font
   - Structured log fields

## Installation

### Step 1: Import Dashboard

1. Open Grafana (default: http://localhost:3000)
2. Login (default: admin/admin)
3. Navigate to **Dashboards** → **Import**
4. Click **Upload JSON file**
5. Select `grafana-dashboard.json`
6. Select your Prometheus datasource
7. Click **Import**

### Step 2: Apply Custom Styles (Optional)

#### Method 1: Grafana Configuration File

Add to `grafana.ini`:

```ini
[server]
enable_gzip = true

[paths]
provisioning = /etc/grafana/provisioning

[panels]
disable_sanitize_html = false

[security]
allow_embedding = true
```

Create custom theme file:

```bash
# Copy CSS to Grafana public directory
cp grafana-custom-styles.css /usr/share/grafana/public/css/custom.css
```

Add to Grafana HTML:

```html
<!-- /usr/share/grafana/public/views/index.html -->
<link rel="stylesheet" href="/public/css/custom.css">
```

#### Method 2: Browser Extension

Use a browser extension like **Stylus** or **Stylish**:

1. Install extension
2. Create new style for `localhost:3000` (or your Grafana URL)
3. Paste contents of `grafana-custom-styles.css`
4. Save and enable

#### Method 3: Grafana Plugin

Use the **Boom Theme** plugin:

```bash
grafana-cli plugins install yesoreyeram-boomtheme-panel
```

Then configure theme in dashboard settings.

### Step 3: Configure Datasources

#### Prometheus

1. Navigate to **Configuration** → **Data Sources**
2. Click **Add data source**
3. Select **Prometheus**
4. Configure:
   - **Name**: Prometheus
   - **URL**: http://prometheus:9090 (Docker) or http://localhost:9090
   - **Scrape interval**: 15s
   - **Query timeout**: 60s
5. Click **Save & Test**

#### Loki (Optional - for logs)

1. Click **Add data source**
2. Select **Loki**
3. Configure:
   - **Name**: Loki
   - **URL**: http://loki:3100 (Docker) or http://localhost:3100
4. Click **Save & Test**

### Step 4: Verify Metrics

Check that Prometheus is scraping the indexer:

```bash
# Check targets
curl http://localhost:9090/api/v1/targets

# Query metrics
curl http://localhost:9090/api/v1/query?query=indexer_events_processed_total
```

## Dashboard Configuration

### Variables

The dashboard uses template variables for datasource selection:

- **`DS_PROMETHEUS`**: Prometheus datasource
- **`DS_LOKI`**: Loki datasource (for logs)

### Time Range

Default: Last 1 hour

Recommended ranges:
- **Real-time monitoring**: Last 15 minutes
- **Troubleshooting**: Last 1 hour
- **Trend analysis**: Last 24 hours
- **Historical review**: Last 7 days

### Refresh Interval

Default: 5 seconds

Available intervals:
- 5s (real-time)
- 10s
- 30s
- 1m
- 5m

## Customization

### Changing Colors

Edit `grafana-dashboard.json`:

```json
{
  "fieldConfig": {
    "defaults": {
      "thresholds": {
        "steps": [
          {
            "color": "green",  // Change to your color
            "value": null
          },
          {
            "color": "red",    // Change to your color
            "value": 5
          }
        ]
      }
    }
  }
}
```

### Adding Panels

1. Click **Add panel** in dashboard
2. Select **Add a new panel**
3. Choose visualization type
4. Configure query:
   ```promql
   # Example: RPC retry rate
   rate(indexer_rpc_retries_total[5m])
   ```
5. Set panel options (title, legend, thresholds)
6. Click **Apply**

### Modifying Queries

Edit existing panel:

1. Click panel title → **Edit**
2. Modify query in **Query** tab
3. Adjust visualization in **Panel** tab
4. Click **Apply**

Common queries:

```promql
# Event processing rate (1-minute window)
rate(indexer_events_processed_total[1m])

# Error rate (5-minute window)
increase(indexer_errors_total[5m])

# Processing latency p95
histogram_quantile(0.95, rate(indexer_processing_latency_seconds_bucket[5m]))

# Ledger lag
indexer_ledger_lag

# Last processed ledger
indexer_last_processed_ledger
```

## Action Buttons (Manual Implementation)

Grafana doesn't natively support action buttons with confirmation dialogs. Here are workarounds:

### Option 1: External Scripts Panel

Use the **Ajax Panel** plugin:

```bash
grafana-cli plugins install ryantxu-ajax-panel
```

Configure panel to call webhook:

```json
{
  "url": "http://your-api/indexer/restart",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer ${token}"
  }
}
```

### Option 2: Custom Panel Plugin

Create a React-based panel plugin:

```typescript
// RestartButton.tsx
import React, { useState } from 'react';
import { Button, Modal } from '@grafana/ui';

export const RestartButton = () => {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleRestart = async () => {
    await fetch('/api/indexer/restart', { method: 'POST' });
    setShowConfirm(false);
  };

  return (
    <>
      <Button onClick={() => setShowConfirm(true)}>
        Restart Indexer
      </Button>
      <Modal
        isOpen={showConfirm}
        title="Confirm Restart"
        onDismiss={() => setShowConfirm(false)}
      >
        <p>Are you sure you want to restart the indexer?</p>
        <Button variant="destructive" onClick={handleRestart}>
          Confirm
        </Button>
      </Modal>
    </>
  );
};
```

### Option 3: External Dashboard

Create a separate operations dashboard with action buttons:

```html
<!-- operations.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Indexer Operations</title>
  <style>
    body {
      background: #1a1a1a;
      color: #e0e0e0;
      font-family: 'Courier New', monospace;
    }
    .btn {
      background: rgba(0, 255, 0, 0.1);
      border: 1px solid #00ff00;
      color: #00ff00;
      padding: 10px 20px;
      margin: 10px;
      cursor: pointer;
      text-transform: uppercase;
      font-family: 'Courier New', monospace;
    }
    .btn-danger {
      background: rgba(255, 0, 0, 0.1);
      border-color: #ff0000;
      color: #ff0000;
    }
  </style>
</head>
<body>
  <h1>Indexer Operations</h1>
  
  <button class="btn" onclick="restartIndexer()">
    Restart Indexer
  </button>
  
  <button class="btn btn-danger" onclick="rescanLedger()">
    Re-scan Ledger
  </button>

  <script>
    async function restartIndexer() {
      if (!confirm('Are you sure you want to restart the indexer?')) return;
      
      try {
        const response = await fetch('/api/indexer/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        alert(response.ok ? 'Restart initiated' : 'Restart failed');
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    async function rescanLedger() {
      const ledger = prompt('Enter ledger number to re-scan from:');
      if (!ledger) return;
      
      if (!confirm(`Re-scan from ledger ${ledger}? This will reprocess events.`)) return;
      
      try {
        const response = await fetch('/api/indexer/rescan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ledger: parseInt(ledger) })
        });
        alert(response.ok ? 'Re-scan initiated' : 'Re-scan failed');
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
  </script>
</body>
</html>
```

Embed in Grafana using **Text Panel** with HTML mode enabled.

## Alerts

### Configure Alert Rules

1. Edit panel → **Alert** tab
2. Click **Create alert rule from this panel**
3. Configure conditions:

```yaml
# High Lag Alert
Condition: indexer_ledger_lag > 10
For: 5m
Severity: Warning
Message: "Indexer is {{ $value }} ledgers behind"

# Error Alert
Condition: increase(indexer_errors_total[5m]) > 5
For: 2m
Severity: Critical
Message: "{{ $value }} errors in last 5 minutes"

# Indexer Down Alert
Condition: up{job="backend"} == 0
For: 1m
Severity: Critical
Message: "Indexer is down"
```

### Notification Channels

Configure in **Alerting** → **Notification channels**:

- **Slack**: Webhook URL
- **PagerDuty**: Integration key
- **Email**: SMTP settings
- **Webhook**: Custom endpoint

## Troubleshooting

### Dashboard Not Loading

1. Check Grafana logs:
   ```bash
   docker-compose logs grafana
   kubectl logs -n monitoring deployment/grafana
   ```

2. Verify datasource connection:
   - Navigate to **Configuration** → **Data Sources**
   - Click **Test** on Prometheus datasource

3. Check Prometheus targets:
   ```bash
   curl http://localhost:9090/api/v1/targets
   ```

### No Data in Panels

1. Verify metrics are being scraped:
   ```bash
   curl http://localhost:3001/api/metrics
   ```

2. Check Prometheus query:
   - Open panel edit mode
   - Click **Query inspector**
   - Verify query syntax

3. Check time range:
   - Ensure time range includes data
   - Try "Last 24 hours"

### Custom Styles Not Applied

1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R)
3. Check browser console for CSS errors
4. Verify CSS file path in Grafana config

### Slow Dashboard Performance

1. Reduce refresh interval (5s → 30s)
2. Limit time range (1h instead of 24h)
3. Optimize queries:
   ```promql
   # Use rate() instead of increase() for better performance
   rate(indexer_events_processed_total[1m])
   ```

4. Enable query caching in Prometheus

## Best Practices

### Dashboard Organization

- **Top row**: Key metrics (lag, errors, status)
- **Middle rows**: Time series charts
- **Bottom row**: Logs and detailed tables

### Query Optimization

- Use appropriate time windows (1m, 5m, 1h)
- Avoid `rate()` with very short windows (<1m)
- Use `increase()` for counters over fixed periods
- Use `histogram_quantile()` for latency percentiles

### Alert Configuration

- Set appropriate thresholds based on baseline
- Use `for` duration to avoid flapping
- Configure multiple severity levels
- Test alerts before enabling

### Maintenance

- Export dashboard JSON regularly (backup)
- Document custom modifications
- Review and update queries as metrics evolve
- Monitor Grafana resource usage

## Resources

- [Grafana Documentation](https://grafana.com/docs/)
- [Prometheus Query Language](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Dashboard Best Practices](https://grafana.com/docs/grafana/latest/best-practices/)
- [Production Runbook](./PRODUCTION_RUNBOOK.md)

## Support

For issues or questions:
- Check logs: `docker-compose logs grafana`
- Review Grafana docs: https://grafana.com/docs/
- Consult runbook: `PRODUCTION_RUNBOOK.md`
- Contact ops team: ops@yourcompany.com

