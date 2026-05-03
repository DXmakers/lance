# Operator Quick Start Guide

## Monitoring Dashboard

### Accessing the Dashboard

```
URL: http://<your-domain>/admin/monitoring
```

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ INFRASTRUCTURE::CORE_MONITOR                    [RE-SCAN] [RESTART] │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│ │ SYNC_STATUS  │ LAST_LEDGER  │ THROUGHPUT   │ RPC_LATENCY  │   │
│ │ OPERATIONAL  │ #12345       │ 15.3 eps     │ 250ms        │   │
│ └──────────────┴──────────────┴──────────────┴──────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────┬──────────────────────────┐ │
│ │ Indexing Throughput (Events/Sec) │ Live_Events            │ │
│ │ [Area Chart - Green]             │ [Event Log Stream]      │ │
│ │                                  │                        │ │
│ ├──────────────────────────────────┤                        │ │
│ │ Resource Usage                   │                        │ │
│ │ [CPU/Memory/Latency Lines]       │                        │ │
│ │                                  │                        │ │
│ ├──────────────────────────────────┤                        │ │
│ │ Recent Ledger Events             │                        │ │
│ │ [Compact Table]                  │                        │ │
│ └──────────────────────────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Status Indicators

**SYNC_STATUS**
- 🟢 **OPERATIONAL**: Indexer is keeping up with network
- 🔴 **LAGGING**: Indexer is behind network (lag > threshold)

**THROUGHPUT**
- 🟢 **Green**: > 10 events/second (healthy)
- ⚪ **Gray**: < 10 events/second (degraded)

**RPC_LATENCY**
- 🟢 **Green**: < 5000ms (healthy)
- 🔴 **Red**: > 5000ms (slow)

### Reading the Charts

**Throughput Chart (Green Area)**
- X-axis: Time (5-second intervals)
- Y-axis: Events per second
- Trend: Should be relatively stable
- Alert: Sudden drops indicate processing issues

**Resource Usage Chart (Multi-line)**
- Blue Line: CPU usage (%)
- Purple Line: Memory usage (%)
- Yellow Line: Latency (ms)
- Alert: CPU/Memory > 80% or Latency > 5000ms

### Event Log Table

| Column | Meaning | Example |
|--------|---------|---------|
| Timestamp | When event was processed | 14:32:45 |
| Ledger | Ledger sequence number | #12345 |
| Events | Number of events in ledger | 42 |
| Hash | Ledger hash (truncated) | 0x12345abc... |
| Status | Processing result | ✅ OK / ⚠️ WARN / ❌ ERR |

### Live Events Panel

Shows real-time system events:
- 🟢 **Green**: Successful operations
- 🟡 **Yellow**: Warnings (retries, lag)
- 🔴 **Red**: Errors

## Common Operations

### Restarting the Worker

**When to use:**
- Worker appears stuck
- After configuration changes
- During maintenance

**Steps:**
1. Click **[RESTART_WORKER]** button
2. Read confirmation dialog carefully
3. Click **RESTART NOW** to confirm
4. Wait 30-60 seconds for restart
5. Verify status returns to OPERATIONAL

**What happens:**
- Current process terminates (SIGTERM)
- New process starts
- Resumes from last checkpoint
- No data loss

### Triggering Ledger Re-scan

**When to use:**
- Suspect data corruption
- After database recovery
- To verify historical data

**Steps:**
1. Click **[RE-SCAN]** button
2. Review ledger range in dialog
3. Click **START RE-SCAN** to confirm
4. Monitor progress in event log
5. Wait for completion (several minutes)

**What happens:**
- Last 10 ledgers are reprocessed
- Idempotent processing prevents duplicates
- Checkpoint is updated
- No data loss

## Troubleshooting

### Issue: Ledger Lag Increasing

**Diagnosis:**
1. Check SYNC_STATUS card - should show LAGGING
2. Look at Throughput chart - should show declining trend
3. Check RPC_LATENCY - if high, RPC is slow

**Quick Fixes:**
1. Check RPC provider status (external)
2. Verify database is responsive
3. Check network connectivity
4. If persistent, restart worker

### Issue: High Error Rate

**Diagnosis:**
1. Check Live_Events panel for red entries
2. Look for error patterns in logs
3. Check RPC_LATENCY for timeouts

**Quick Fixes:**
1. Check RPC provider status
2. Verify database connectivity
3. Review recent configuration changes
4. Restart worker if needed

### Issue: High Memory Usage

**Diagnosis:**
1. Check Resource Usage chart - purple line
2. If > 80%, memory is high
3. Check if memory is growing over time

**Quick Fixes:**
1. Restart worker to clear memory
2. Check for connection leaks
3. Reduce number of replicas if scaled
4. Increase memory limits if needed

### Issue: Slow Processing

**Diagnosis:**
1. Check RPC_LATENCY card
2. Check Resource Usage chart - yellow line
3. If > 5000ms, processing is slow

**Quick Fixes:**
1. Check RPC provider status
2. Verify database performance
3. Check network latency
4. Reduce rate limiting if configured

## Metrics to Monitor

### Critical Metrics

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Ledger Lag | < 10 | 10-100 | > 100 |
| Throughput | > 10 eps | 5-10 eps | < 5 eps |
| RPC Latency | < 1000ms | 1-5s | > 5s |
| Error Rate | 0 errors/5m | 1-5 errors/5m | > 5 errors/5m |
| Memory Usage | < 60% | 60-80% | > 80% |
| CPU Usage | < 50% | 50-80% | > 80% |

### Monitoring Frequency

- **Every 5 minutes**: Check dashboard during business hours
- **Every 15 minutes**: Check during off-hours
- **Continuous**: Automated alerts via Prometheus

## Alert Response Procedures

### Alert: High Lag (> 100 ledgers)

**Severity**: 🟡 Warning

**Response**:
1. Check RPC provider status
2. Verify database connectivity
3. Check network latency
4. If lag continues > 30 min, restart worker

### Alert: High Error Rate (> 5 errors/5min)

**Severity**: 🔴 Critical

**Response**:
1. Check Live_Events for error details
2. Verify RPC provider is reachable
3. Check database for issues
4. Restart worker if errors persist

### Alert: Slow Processing (> 5000ms)

**Severity**: 🟡 Warning

**Response**:
1. Check RPC latency
2. Check database performance
3. Verify network connectivity
4. Restart worker if persists

### Alert: High Memory (> 80%)

**Severity**: 🟡 Warning

**Response**:
1. Monitor memory trend
2. If growing, restart worker
3. If stable, increase memory limits
4. Check for connection leaks

## Dashboard Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `R` | Refresh metrics |
| `Esc` | Close dialogs |
| `?` | Show help |

## Common Questions

**Q: How often does the dashboard update?**
A: Every 5 seconds. Charts show 20 data points (100 seconds of history).

**Q: What happens if I restart the worker?**
A: The process terminates and restarts. It resumes from the last checkpoint. No data is lost.

**Q: Can I undo a re-scan?**
A: Re-scans are idempotent (safe to repeat). They don't delete data, only reprocess ledgers.

**Q: What do the colors mean?**
A: Green = healthy, Yellow = warning, Red = error. Monochrome aesthetic with color accents.

**Q: How do I access the full metrics?**
A: Visit `/api/health/metrics` for Prometheus format metrics.

**Q: Can I export the data?**
A: Currently view-only. Export features coming in future versions.

## Getting Help

### Documentation
- [Production Runbook](./backend/PRODUCTION_RUNBOOK.md)
- [Prometheus Metrics](./backend/PROMETHEUS_METRICS.md)
- [Recovery Tests](./backend/RECOVERY_TESTS.md)

### Support Channels
- **Slack**: #soroban-indexer-alerts
- **Email**: indexer-team@company.com
- **On-Call**: Check PagerDuty schedule

### Emergency Procedures
1. Check dashboard for obvious issues
2. Review recent logs
3. Consult troubleshooting section
4. Contact on-call engineer if needed

## Best Practices

### Daily Operations
- ✅ Check dashboard at start of shift
- ✅ Monitor for alerts
- ✅ Review error logs
- ✅ Verify backup completion

### Weekly Operations
- ✅ Review performance trends
- ✅ Check for capacity issues
- ✅ Update runbooks if needed
- ✅ Test disaster recovery procedures

### Monthly Operations
- ✅ Capacity planning review
- ✅ Performance optimization
- ✅ Security audit
- ✅ Update documentation

## Dashboard Features Reference

### Status Cards
- **SYNC_STATUS**: Overall indexer health
- **LAST_LEDGER**: Current processing position
- **THROUGHPUT**: Events per second
- **RPC_LATENCY**: Network latency

### Charts
- **Throughput**: Events/second over time
- **Resource Usage**: CPU, memory, latency

### Tables
- **Event Log**: Recent ledger processing
- **Live Events**: Real-time system events

### Buttons
- **RE-SCAN**: Reprocess recent ledgers
- **RESTART_WORKER**: Restart indexer process

### Dialogs
- **Restart Confirmation**: Warns about impact
- **Rescan Confirmation**: Shows ledger range

---

**Last Updated**: April 28, 2026
**Version**: 1.0.0
**For**: Operations Team
