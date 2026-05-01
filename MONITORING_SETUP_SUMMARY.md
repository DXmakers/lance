# Monitoring and Operations Setup - Summary

## Overview

Complete monitoring and operations infrastructure for the Blockchain Indexer, including Grafana dashboards, production runbook, and deployment configurations.

## Files Created

### 1. **grafana-dashboard.json**
Grafana dashboard configuration with:
- **9 panels** visualizing all key metrics
- **Monochrome aesthetic** with green/red status indicators
- **Real-time updates** (5-second refresh)
- **Compact layout** optimized for operations
- **Template variables** for datasource selection

**Key Panels**:
- Ledger Lag (stat with threshold)
- Ledger Status (table with monospace fonts)
- Total Errors (stat with red indicator)
- Events Processed (stat with sparkline)
- Event Processing Rate (time series)
- Error Rate (bar chart)
- Processing Latency (percentiles: p50, p95, p99)
- Ledger Lag Over Time (trend chart)
- Recent Indexer Events (compact log table)

### 2. **grafana-custom-styles.css**
Custom CSS implementing monochrome aesthetic:
- **Monospace fonts** for ledger numbers and metrics
- **Green/red status indicators** only
- **Compact table styling** for dense information
- **Dark theme** with subtle borders
- **Monochrome chart colors** (green gradients)
- **Custom scrollbars** and tooltips
- **Responsive design** for mobile/tablet

### 3. **PRODUCTION_RUNBOOK.md**
Comprehensive operational guide covering:

#### Deployment
- Docker deployment with Dockerfile and docker-compose.yml
- Kubernetes deployment with full manifests
- Environment variable configuration
- Health check configuration
- Prometheus and Grafana setup

#### Scaling
- Vertical scaling (CPU/memory)
- Horizontal scaling considerations
- Database scaling strategies
- Connection pooling optimization

#### Monitoring
- Grafana dashboard setup
- Prometheus alert rules
- Log aggregation with Loki
- Key metrics reference

#### Operations
- Manual indexer restart procedures
- Ledger re-scan procedures
- Configuration updates
- Database maintenance (backup, restore, vacuum)

#### Troubleshooting
- High ledger lag diagnosis and solutions
- Frequent errors troubleshooting
- Indexer not processing issues
- High memory usage solutions
- Slow query optimization

#### Disaster Recovery
- Checkpoint corruption recovery
- Database failure recovery
- RPC provider outage handling
- Complete system failure recovery

### 4. **GRAFANA_DASHBOARD_README.md**
Dashboard setup and customization guide:
- Installation instructions
- Custom styles application
- Datasource configuration
- Panel customization
- Query examples
- Action button implementation options
- Alert configuration
- Troubleshooting guide
- Best practices

## Quick Start

### 1. Deploy Infrastructure

```bash
# Start all services with Docker Compose
docker-compose up -d

# Or deploy to Kubernetes
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
```

### 2. Import Grafana Dashboard

```bash
# Open Grafana
open http://localhost:3000

# Login (admin/admin)
# Navigate to Dashboards → Import
# Upload grafana-dashboard.json
# Select Prometheus datasource
# Click Import
```

### 3. Apply Custom Styles (Optional)

```bash
# Method 1: Copy to Grafana public directory
cp grafana-custom-styles.css /usr/share/grafana/public/css/custom.css

# Method 2: Use browser extension (Stylus/Stylish)
# Install extension and paste CSS for localhost:3000
```

### 4. Verify Monitoring

```bash
# Check indexer health
curl http://localhost:3001/api/health

# Check metrics endpoint
curl http://localhost:3001/api/metrics

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# View Grafana dashboard
open http://localhost:3000/d/indexer-monitoring
```

## Key Features

### Monitoring

✅ **Real-time metrics** - 5-second refresh interval  
✅ **Event processing rate** - Events/second throughput  
✅ **Error tracking** - Total and rate of errors  
✅ **Latency percentiles** - p50, p95, p99 processing times  
✅ **Ledger lag** - How far behind the network  
✅ **Compact log table** - Recent indexer events  

### Aesthetics

✅ **Monochrome theme** - Black background, green/red indicators  
✅ **Monospace fonts** - Ledger numbers in Courier New  
✅ **Compact layout** - Dense information display  
✅ **Status colors** - Green for OK, red for errors  
✅ **Smooth animations** - Line interpolation and gradients  

### Operations

✅ **Docker deployment** - Complete docker-compose.yml  
✅ **Kubernetes manifests** - Production-ready K8s configs  
✅ **Health checks** - Liveness, readiness, startup probes  
✅ **Scaling guide** - Vertical and horizontal strategies  
✅ **Troubleshooting** - Common issues and solutions  
✅ **Disaster recovery** - Backup and restore procedures  

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Grafana Dashboard                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Ledger Lag  │  │   Errors    │  │   Events    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Event Processing Rate Chart              │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Processing Latency Chart                 │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          │ Query
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      Prometheus                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Metrics Storage (30-day retention)              │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          │ Scrape /api/metrics
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   Indexer Worker                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Rust/Tokio Async Worker                         │  │
│  │  - Event processing                               │  │
│  │  - Checkpoint management                          │  │
│  │  - Metrics export                                 │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          │ SQL
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      PostgreSQL                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  - indexed_events                                 │  │
│  │  - indexer_state (checkpoint)                     │  │
│  │  - deposits, disputes                             │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Metrics Reference

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `indexer_events_processed_total` | Counter | Total events processed | - |
| `indexer_errors_total` | Counter | Total errors | >5 in 5min |
| `indexer_processing_latency_seconds` | Histogram | Processing cycle latency | p95 >5s |
| `indexer_last_processed_ledger` | Gauge | Last processed ledger | - |
| `indexer_ledger_lag` | Gauge | Ledgers behind network | >10 |

## Environment Variables

### Required
```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

### Optional (with defaults)
```bash
PORT=3001
INDEXER_IDLE_POLL_MS=2000
INDEXER_RPC_RATE_LIMIT_MS=250
INDEXER_RPC_RETRY_MAX_ATTEMPTS=4
INDEXER_MAX_LEDGER_LAG=5
RUST_LOG=backend=info
```

## Alert Rules

### High Lag
```yaml
expr: indexer_ledger_lag > 10
for: 5m
severity: warning
```

### Errors
```yaml
expr: increase(indexer_errors_total[5m]) > 5
for: 2m
severity: critical
```

### Indexer Down
```yaml
expr: up{job="backend"} == 0
for: 1m
severity: critical
```

### Slow Processing
```yaml
expr: histogram_quantile(0.95, rate(indexer_processing_latency_seconds_bucket[5m])) > 5
for: 10m
severity: warning
```

## Action Buttons (Implementation Notes)

While Grafana doesn't natively support action buttons with confirmation dialogs, the runbook provides three implementation options:

1. **Ajax Panel Plugin** - Use ryantxu-ajax-panel for webhook calls
2. **Custom Panel Plugin** - Build React-based panel with modals
3. **External Dashboard** - Separate HTML page with action buttons

See `GRAFANA_DASHBOARD_README.md` for detailed implementation.

## Troubleshooting Quick Reference

### High Lag
```bash
# Check RPC latency
curl http://localhost:3001/api/sync-status | jq '.last_rpc_latency_ms'

# Check processing rate
curl http://localhost:3001/api/sync-status | jq '.last_batch_rate_per_second'

# Solution: Increase RPC rate limit or scale vertically
```

### Errors
```bash
# Check recent errors
docker-compose logs --tail=100 indexer | grep ERROR

# Check error count
curl http://localhost:3001/api/sync-status | jq '.error_count'

# Solution: Check logs for specific error patterns
```

### Not Processing
```bash
# Check health
curl http://localhost:3001/api/health

# Restart indexer
docker-compose restart indexer

# Check logs
docker-compose logs -f indexer
```

## Best Practices

### Monitoring
- Set up alerts for critical metrics
- Review dashboard daily
- Monitor trends over time
- Keep 30-day metric retention

### Operations
- Backup database daily
- Test disaster recovery quarterly
- Document all manual interventions
- Keep runbook updated

### Performance
- Monitor resource usage
- Optimize slow queries
- Scale proactively
- Use connection pooling

### Security
- Rotate database credentials
- Use secrets management
- Enable TLS for RPC
- Restrict network access

## Resources

- **Grafana Dashboard**: `grafana-dashboard.json`
- **Custom Styles**: `grafana-custom-styles.css`
- **Production Runbook**: `PRODUCTION_RUNBOOK.md`
- **Setup Guide**: `GRAFANA_DASHBOARD_README.md`
- **Prometheus Metrics**: http://localhost:3001/api/metrics
- **Health Check**: http://localhost:3001/api/health

## Support

For issues or questions:
- Review runbook: `PRODUCTION_RUNBOOK.md`
- Check dashboard guide: `GRAFANA_DASHBOARD_README.md`
- View logs: `docker-compose logs indexer`
- Contact ops: ops@yourcompany.com

## Next Steps

1. ✅ Deploy infrastructure (Docker/Kubernetes)
2. ✅ Import Grafana dashboard
3. ✅ Configure alerts
4. ✅ Test monitoring
5. ✅ Review runbook
6. ✅ Train operations team
7. ✅ Set up on-call rotation
8. ✅ Schedule regular reviews

---

**Version**: 1.0.0  
**Last Updated**: 2026-04-28  
**Maintainer**: Operations Team
