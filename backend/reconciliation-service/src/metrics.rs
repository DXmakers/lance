use prometheus::{Encoder, IntCounter, IntGauge, Registry, TextEncoder};

#[derive(Debug)]
pub struct Metrics {
    registry: Registry,
    processed_ledgers_total: IntCounter,
    processing_errors_total: IntCounter,
    latest_ledger_gauge: IntGauge,
    checkpoint_ledger_gauge: IntGauge,
    ledger_lag_gauge: IntGauge,
}

impl Metrics {
    pub fn new() -> anyhow::Result<Self> {
        let registry = Registry::new();

        let processed_ledgers_total = IntCounter::new("processed_ledgers_total", "Total number of ledgers processed")?;
        let processing_errors_total = IntCounter::new("processing_errors_total", "Total number of processing errors")?;
        let latest_ledger_gauge = IntGauge::new("latest_ledger", "Latest ledger observed from Stellar RPC")?;
        let checkpoint_ledger_gauge = IntGauge::new("checkpoint_ledger", "Last processed ledger checkpoint")?;
        let ledger_lag_gauge = IntGauge::new("ledger_lag", "Difference between latest ledger and checkpoint")?;

        registry.register(Box::new(processed_ledgers_total.clone()))?;
        registry.register(Box::new(processing_errors_total.clone()))?;
        registry.register(Box::new(latest_ledger_gauge.clone()))?;
        registry.register(Box::new(checkpoint_ledger_gauge.clone()))?;
        registry.register(Box::new(ledger_lag_gauge.clone()))?;

        Ok(Self {
            registry,
            processed_ledgers_total,
            processing_errors_total,
            latest_ledger_gauge,
            checkpoint_ledger_gauge,
            ledger_lag_gauge,
        })
    }

    pub fn record_success(&self, checkpoint_ledger: i64, latest_ledger: i64) {
        self.processed_ledgers_total.inc();
        self.checkpoint_ledger_gauge.set(checkpoint_ledger);
        self.latest_ledger_gauge.set(latest_ledger);
        self.ledger_lag_gauge.set(latest_ledger.saturating_sub(checkpoint_ledger));
    }

    pub fn record_error(&self) {
        self.processing_errors_total.inc();
    }

    pub fn render(&self) -> anyhow::Result<String> {
        let encoder = TextEncoder::new();
        let families = self.registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&families, &mut buffer)?;
        Ok(String::from_utf8(buffer)?)
    }
}