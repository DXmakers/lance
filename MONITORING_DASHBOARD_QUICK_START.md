# Monitoring Dashboard - Quick Start Guide

## Accessing the Dashboard

```
URL: http://localhost:3000/admin/indexer-monitoring
```

## Dashboard Overview

### 1. Health Status Card (Top)

**What it shows:**
- Current indexer health status (Synced/Lagging/Degraded)
- Current network ledger (monospace font)
- Last processed ledger (monospace font)
- Ledger lag with max allowed threshold
- Green checkmark = healthy, Red alert = issues

**Example:**
```
✓ Indexer Synced
Current Ledger: 12345
Processed Ledger: 12340
Lag: 5 / 5 (max allowed)
```

### 2. Real-Time Charts

#### Event Processing Rate (Top Left)
- **Type:** Line chart
- **Shows:** Number of events processed over time
- **Color:** Blue
- **Updates:** Every 5 seconds
- **Use:** Monitor processing throughput

#### Error Count (Top Right)
- **Type:** Bar chart
- **Shows:** Number of errors over time
- **Color:** Red
- **Updates:** Every 5 seconds
- **Use:** Identify error spikes

#### Ledger Lag Over Time (Bottom Left)
- **Type:** Area chart
- **Shows:** Lag progression over time
- **Color:** Green (normal), Red (high)
- **Updates:** Every 5 seconds
- **Use:** Identify lag trends

#### Processing Duration (Bottom Right)
- **Type:** Line chart
- **Shows:** Processing time in milliseconds
- **Color:** Orange
- **Updates:** Every 5 seconds
- **Use:** Monitor performance

### 3. Action Buttons

#### Restart Indexer
- **Purpose:** Gracefully restart the indexer worker
- **Confirmation:** Yes, requires confirmation dialog
- **Effect:** Service restarts, checkpoint preserved
- **Use:** When indexer is stuck or needs reset

**Steps:**
1. Click "Restart Indexer" button
2. Confirm in dialog
3. Wait for service to restart (2-5 seconds)
4. Dashboard auto-refreshes

#### Re-scan Ledger Range
- **Purpose:** Re-process events from specific ledger range
- **Confirmation:** Yes, requires start and end ledger
- **Effect:** Deletes and re-processes events
- **Use:** Recovery from data corruption

**Steps:**
1. Click "Re-scan Ledgers" button
2. Enter start ledger number
3. Enter end ledger number
4. Confirm
5. Monitor progress in logs

### 4. Metrics Summary (Bottom)

**Displays:**
- Current Ledger (monospace)
- Processed Ledger (monospace)
- Lag (monospace)
- Status (monospace)

**All values in monospace font for easy reading**

## Controls

### Refresh Button
- **Purpose:** Manually refresh all data
- **Shortcut:** Click "Refresh" button
- **Effect:** Immediate update of all metrics

### Auto-refresh Toggle
- **Purpose:** Enable/disable automatic refresh
- **Default:** Enabled (5-second interval)
- **Use:** Turn off to reduce network traffic

## Common Scenarios

### Scenario 1: Indexer is Lagging

**Symptoms:**
- Red alert in health status card
- Lag > max_allowed_lag
- Lag chart trending upward

**Actions:**
1. Check Event Processing Rate chart
   - If low: Indexer is slow
   - If high: RPC is slow
2. Check Error Count chart
   - If high: Investigate errors
   - If low: Performance issue
3. Options:
   - Wait for catch-up
   - Restart indexer
   - Scale up (add instances)

### Scenario 2: High Error Rate

**Symptoms:**
- Error Count chart shows spikes
- Red alert in health status
- Processing rate drops

**Actions:**
1. Check error messages in logs
2. Verify RPC endpoint is reachable
3. Verify database is connected
4. Options:
   - Restart indexer
   - Check RPC endpoint
   - Check database connection

### Scenario 3: Indexer Stuck

**Symptoms:**
- Lag not changing
- Processing rate = 0
- Same ledger for > 5 minutes

**Actions:**
1. Click "Restart Indexer"
2. Confirm restart
3. Monitor for recovery
4. If still stuck:
   - Check logs for errors
   - Verify database connection
   - Check RPC endpoint

### Scenario 4: Data Corruption

**Symptoms:**
- Duplicate events detected
- Inconsistent state
- Processing errors

**Actions:**
1. Identify affected ledger range
2. Click "Re-scan Ledgers"
3. Enter start and end ledger
4. Confirm
5. Monitor re-scan progress
6. Verify data consistency

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| F5 | Refresh page |
| Ctrl+Shift+I | Open developer tools |
| Ctrl+L | Focus address bar |

## Mobile View

The dashboard is responsive and works on mobile devices:
- Charts stack vertically
- Buttons are touch-friendly
- Monospace fonts remain readable
- All features available

## Troubleshooting

### Dashboard Not Loading

**Problem:** Page shows "Loading dashboard..."

**Solutions:**
1. Check internet connection
2. Verify backend is running
3. Check browser console for errors
4. Refresh page (F5)

### Charts Not Updating

**Problem:** Charts show old data

**Solutions:**
1. Check auto-refresh is enabled
2. Click manual refresh button
3. Check network tab in developer tools
4. Verify `/api/metrics` endpoint is working

### Buttons Not Responding

**Problem:** Restart/Re-scan buttons don't work

**Solutions:**
1. Check browser console for errors
2. Verify backend endpoints exist
3. Check network connectivity
4. Try refreshing page

### Metrics Not Displaying

**Problem:** Charts show no data

**Solutions:**
1. Wait 5-10 seconds for data to accumulate
2. Check if indexer is running
3. Verify `/api/health/sync` endpoint
4. Check browser console for errors

## API Endpoints

The dashboard uses these backend endpoints:

```
GET /api/health/sync
- Returns: Health status JSON
- Interval: 5 seconds

GET /api/metrics
- Returns: Prometheus text format
- Interval: 5 seconds

POST /api/indexer/restart
- Purpose: Restart indexer
- Requires: Confirmation

POST /api/indexer/rescan
- Purpose: Re-scan ledger range
- Requires: start_ledger, end_ledger
```

## Performance Tips

1. **Reduce refresh rate** if network is slow
   - Disable auto-refresh
   - Use manual refresh

2. **Close other tabs** if browser is slow
   - Reduces CPU usage
   - Improves chart responsiveness

3. **Use Chrome/Firefox** for best performance
   - Better chart rendering
   - Faster metrics parsing

## Color Coding

| Color | Meaning |
|-------|---------|
| Green | Healthy, normal operation |
| Red | Error, issue detected |
| Orange | Warning, monitor closely |
| Blue | Information, neutral |
| Gray | Disabled, not applicable |

## Status Indicators

| Status | Meaning | Action |
|--------|---------|--------|
| ✓ ok | Indexer synced | None needed |
| ⚠ lagging | Lag > threshold | Monitor or scale |
| ✗ degraded | Service issue | Investigate |

## Data Retention

- **Chart history:** Last 60 data points (5 minutes)
- **Metrics:** Real-time from Prometheus
- **Health status:** Current state only
- **Logs:** Check backend logs for history

## Export & Monitoring

### Prometheus Integration

```yaml
scrape_configs:
  - job_name: 'indexer'
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/api/metrics'
```

### Grafana Integration

Import dashboard JSON from monitoring setup to Grafana for persistent monitoring.

### Alert Integration

Set up alerts based on metrics:
- Error rate > 1%
- Lag > 10 ledgers
- Processing rate < 100 events/sec

## Best Practices

1. **Monitor regularly**
   - Check dashboard daily
   - Review trends weekly

2. **Set up alerts**
   - Configure Prometheus alerts
   - Get notified of issues

3. **Keep logs**
   - Archive logs for debugging
   - Review logs for patterns

4. **Document changes**
   - Record restarts and rescans
   - Track performance changes

5. **Test recovery**
   - Practice restart procedures
   - Test re-scan procedures
   - Verify backup/restore

## Support

For issues or questions:
1. Check this guide
2. Review logs in backend
3. Check Prometheus metrics
4. Contact on-call engineer

---

**Last Updated:** 2026-04-28
**Version:** 1.0
