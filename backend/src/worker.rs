use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::Client;
use soroban_client::{
    soroban_rpc::{EventFilter, EventResponse, EventType, Pagination},
    xdr::{ScSymbol, ScVal},
    Options, Server,
};
use sqlx::{PgPool, Row};
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;

use crate::services::{
    judge::{JudgeService, JudgeVerdict},
    stellar::StellarService,
};

const DEFAULT_POLL_INTERVAL_SECS: u64 = 10;
const DEFAULT_BATCH_SIZE: usize = 20;
const DEFAULT_IPFS_GATEWAY: &str = "https://ipfs.io/ipfs";
const DEFAULT_EVENT_START_LEDGER: u64 = 0;

#[derive(Clone, Debug)]
struct WorkerConfig {
    poll_interval: Duration,
    batch_size: usize,
    ipfs_gateway: String,
    event_source: EventSourceMode,
}

#[derive(Clone, Debug)]
enum EventSourceMode {
    Database,
    SorobanRpc {
        rpc_url: String,
        contract_id: String,
        start_ledger: u64,
    },
}

impl WorkerConfig {
    fn enabled() -> bool {
        parse_bool_env("JUDGE_WORKER_ENABLED", false)
    }

    fn from_env() -> Result<Self> {
        let poll_interval = Duration::from_secs(parse_u64_env(
            "JUDGE_WORKER_POLL_INTERVAL_SECS",
            DEFAULT_POLL_INTERVAL_SECS,
        ));
        let batch_size =
            parse_u64_env("JUDGE_WORKER_BATCH_SIZE", DEFAULT_BATCH_SIZE as u64) as usize;
        let ipfs_gateway =
            std::env::var("IPFS_GATEWAY_URL").unwrap_or_else(|_| DEFAULT_IPFS_GATEWAY.to_string());
        let event_mode = std::env::var("JUDGE_WORKER_EVENT_SOURCE")
            .unwrap_or_else(|_| "database".to_string())
            .to_lowercase();

        let event_source = if event_mode == "soroban" {
            let rpc_url = std::env::var("SOROBAN_RPC_URL")
                .context("SOROBAN_RPC_URL must be set when JUDGE_WORKER_EVENT_SOURCE=soroban")?;
            let contract_id = std::env::var("ESCROW_CONTRACT_ID")
                .context("ESCROW_CONTRACT_ID must be set when JUDGE_WORKER_EVENT_SOURCE=soroban")?;
            let start_ledger =
                parse_u64_env("JUDGE_WORKER_START_LEDGER", DEFAULT_EVENT_START_LEDGER);
            EventSourceMode::SorobanRpc {
                rpc_url,
                contract_id,
                start_ledger,
            }
        } else {
            EventSourceMode::Database
        };

        Ok(Self {
            poll_interval,
            batch_size,
            ipfs_gateway,
            event_source,
        })
    }
}

#[derive(Debug, Clone)]
struct DisputeRaisedEvent {
    dispute_id: Uuid,
    observed_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct CaseFile {
    dispute_id: Uuid,
    on_chain_job_id: i64,
    job_spec: String,
    deliverable_hash: String,
    client_evidence: Vec<String>,
    freelancer_evidence: Vec<String>,
}

pub fn spawn_judge_worker(pool: PgPool) {
    if !WorkerConfig::enabled() {
        tracing::info!("judge worker disabled; set JUDGE_WORKER_ENABLED=true to start it");
        return;
    }

    tokio::spawn(async move {
        match JudgeWorker::from_env(pool).await {
            Ok(mut worker) => worker.run_forever().await,
            Err(err) => tracing::error!("failed to initialize judge worker: {err:#}"),
        }
    });
}

pub async fn run_judge_worker(pool: PgPool) {
    match JudgeWorker::from_env(pool).await {
        Ok(mut worker) => worker.run_forever().await,
        Err(err) => tracing::error!("failed to initialize judge worker: {err:#}"),
    }
}

struct JudgeWorker {
    pool: PgPool,
    config: WorkerConfig,
    ipfs_client: Client,
    event_source: Box<dyn DisputeEventSource + Send>,
    judge: JudgeService,
    executor: Box<dyn ResolutionExecutor + Send + Sync>,
}

impl JudgeWorker {
    async fn from_env(pool: PgPool) -> Result<Self> {
        let config = WorkerConfig::from_env()?;
        let event_source: Box<dyn DisputeEventSource + Send> = match &config.event_source {
            EventSourceMode::Database => Box::new(DatabaseDisputeEventSource),
            EventSourceMode::SorobanRpc {
                rpc_url,
                contract_id,
                start_ledger,
            } => Box::new(SorobanRpcDisputeEventSource::new(
                rpc_url.clone(),
                contract_id.clone(),
                *start_ledger,
            )?),
        };

        let executor: Box<dyn ResolutionExecutor + Send + Sync> =
            if parse_bool_env("JUDGE_WORKER_SIMULATE_RESOLUTION", false) {
                Box::new(SimulatedResolutionExecutor)
            } else {
                Box::new(StellarResolutionExecutor::from_env()?)
            };

        Ok(Self {
            pool,
            ipfs_client: Client::new(),
            event_source,
            judge: JudgeService::from_env(),
            executor,
            config,
        })
    }

    async fn run_forever(&mut self) {
        loop {
            if let Err(err) = self.run_once().await {
                tracing::error!("judge worker cycle failed: {err:#}");
            }

            sleep(self.config.poll_interval).await;
        }
    }

    async fn run_once(&mut self) -> Result<()> {
        let events = self
            .event_source
            .poll(&self.pool, self.config.batch_size)
            .await
            .context("failed to poll dispute events")?;

        for event in events {
            if let Err(err) = self.process_event(event.clone()).await {
                tracing::error!(
                    dispute_id = %event.dispute_id,
                    observed_at = %event.observed_at,
                    "dispute pipeline failed: {err:#}"
                );

                reopen_dispute(&self.pool, event.dispute_id).await?;
            }
        }

        Ok(())
    }

    async fn process_event(&self, event: DisputeRaisedEvent) -> Result<()> {
        if !claim_dispute_for_review(&self.pool, event.dispute_id).await? {
            return Ok(());
        }

        let case_file = build_case_file(
            &self.pool,
            &self.ipfs_client,
            &self.config.ipfs_gateway,
            event.dispute_id,
        )
        .await?;

        let verdict = self
            .judge
            .judge(
                &case_file.job_spec,
                &case_file.deliverable_hash,
                case_file.client_evidence.clone(),
                case_file.freelancer_evidence.clone(),
            )
            .await
            .context("judge pipeline failed")?;

        let verdict_id = insert_verdict(&self.pool, &case_file, &verdict).await?;
        let tx_hash = self
            .executor
            .resolve_dispute(
                case_file.on_chain_job_id,
                verdict.freelancer_share_bps as u32,
            )
            .await
            .context("resolution transaction failed")?;

        finalize_resolution(&self.pool, event.dispute_id, verdict_id, &tx_hash).await?;
        tracing::info!(
            dispute_id = %event.dispute_id,
            on_chain_job_id = case_file.on_chain_job_id,
            tx_hash = %tx_hash,
            freelancer_share_bps = verdict.freelancer_share_bps,
            "dispute processed successfully"
        );
        Ok(())
    }
}

#[async_trait]
trait DisputeEventSource {
    async fn poll(&mut self, pool: &PgPool, limit: usize) -> Result<Vec<DisputeRaisedEvent>>;
}

struct DatabaseDisputeEventSource;

#[async_trait]
impl DisputeEventSource for DatabaseDisputeEventSource {
    async fn poll(&mut self, pool: &PgPool, limit: usize) -> Result<Vec<DisputeRaisedEvent>> {
        let rows = sqlx::query(
            r#"
            SELECT d.id, d.created_at
            FROM disputes d
            WHERE d.status = 'open'
              AND NOT EXISTS (
                  SELECT 1
                  FROM verdicts v
                  WHERE v.dispute_id = d.id
                    AND v.on_chain_tx IS NOT NULL
              )
            ORDER BY d.created_at ASC
            LIMIT $1
            "#,
        )
        .bind(limit as i64)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| DisputeRaisedEvent {
                dispute_id: row.get("id"),
                observed_at: row.get("created_at"),
            })
            .collect())
    }
}

struct SorobanRpcDisputeEventSource {
    server: Server,
    contract_id: String,
    cursor: Option<String>,
    start_ledger: u32,
}

impl SorobanRpcDisputeEventSource {
    fn new(rpc_url: String, contract_id: String, start_ledger: u64) -> Result<Self> {
        Ok(Self {
            server: Server::new(&rpc_url, Options::default())
                .map_err(|err| anyhow::anyhow!("invalid Soroban RPC URL: {err}"))?,
            contract_id,
            cursor: None,
            start_ledger: start_ledger as u32,
        })
    }
}

#[async_trait]
impl DisputeEventSource for SorobanRpcDisputeEventSource {
    async fn poll(&mut self, pool: &PgPool, limit: usize) -> Result<Vec<DisputeRaisedEvent>> {
        let pagination = if let Some(cursor) = &self.cursor {
            Pagination::Cursor(cursor.clone())
        } else {
            Pagination::From(self.start_ledger)
        };
        let response = self
            .server
            .get_events(
                pagination,
                vec![EventFilter::new(EventType::Contract).contract(&self.contract_id)],
                Some(limit as u32),
            )
            .await
            .map_err(|err| anyhow::anyhow!("failed to fetch Soroban events: {err}"))?;
        self.cursor = response
            .cursor
            .clone()
            .or_else(|| response.events.last().map(|event| event.id.clone()));

        let mut events = Vec::new();
        for event in response.events {
            if let Some(dispute_id) = resolve_dispute_id_from_event(pool, &event).await? {
                events.push(DisputeRaisedEvent {
                    dispute_id,
                    observed_at: DateTime::parse_from_rfc3339(&event.ledger_closed_at)
                        .map(|value| value.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                });
            }
        }

        Ok(events)
    }
}

async fn resolve_dispute_id_from_event(
    pool: &PgPool,
    event: &EventResponse,
) -> Result<Option<Uuid>> {
    let job_id = extract_dispute_job_id(event);

    let Some(job_id) = job_id else {
        return Ok(None);
    };

    let dispute_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT d.id
        FROM disputes d
        JOIN jobs j ON j.id = d.job_id
        WHERE j.on_chain_job_id = $1
          AND d.status = 'open'
        ORDER BY d.created_at DESC
        LIMIT 1
        "#,
    )
    .bind(job_id)
    .fetch_optional(pool)
    .await?;

    Ok(dispute_id)
}

fn extract_dispute_job_id(event: &EventResponse) -> Option<i64> {
    let topics = event.topic();
    if topics.len() < 2 || !topic_matches_dispute_raised(&topics[0]) {
        return None;
    }

    scval_to_i64(&topics[1]).or_else(|| scval_to_i64(&event.value()))
}

fn topic_matches_dispute_raised(value: &ScVal) -> bool {
    ScSymbol::try_from(value.clone())
        .map(|symbol| symbol.to_string() == "DisputeRaised")
        .unwrap_or(false)
}

fn scval_to_i64(value: &ScVal) -> Option<i64> {
    i64::try_from(value.clone()).ok().or_else(|| {
        u64::try_from(value.clone())
            .ok()
            .and_then(|number| i64::try_from(number).ok())
    })
}

#[async_trait]
trait ResolutionExecutor {
    async fn resolve_dispute(
        &self,
        on_chain_job_id: i64,
        freelancer_share_bps: u32,
    ) -> Result<String>;
}

struct StellarResolutionExecutor {
    inner: StellarService,
}

impl StellarResolutionExecutor {
    fn from_env() -> Result<Self> {
        Ok(Self {
            inner: StellarService::from_env(),
        })
    }
}

#[async_trait]
impl ResolutionExecutor for StellarResolutionExecutor {
    async fn resolve_dispute(
        &self,
        on_chain_job_id: i64,
        freelancer_share_bps: u32,
    ) -> Result<String> {
        self.inner
            .resolve_dispute(on_chain_job_id as u64, freelancer_share_bps)
            .await
    }
}

struct SimulatedResolutionExecutor;

#[async_trait]
impl ResolutionExecutor for SimulatedResolutionExecutor {
    async fn resolve_dispute(
        &self,
        on_chain_job_id: i64,
        freelancer_share_bps: u32,
    ) -> Result<String> {
        Ok(format!(
            "simulated-resolve-{on_chain_job_id}-{freelancer_share_bps}"
        ))
    }
}

async fn claim_dispute_for_review(pool: &PgPool, dispute_id: Uuid) -> Result<bool> {
    let updated = sqlx::query(
        r#"
        UPDATE disputes
        SET status = 'under_review'
        WHERE id = $1
          AND status = 'open'
        "#,
    )
    .bind(dispute_id)
    .execute(pool)
    .await?;

    Ok(updated.rows_affected() == 1)
}

async fn reopen_dispute(pool: &PgPool, dispute_id: Uuid) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE disputes
        SET status = 'open'
        WHERE id = $1
          AND status = 'under_review'
        "#,
    )
    .bind(dispute_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_verdict(
    pool: &PgPool,
    case_file: &CaseFile,
    verdict: &JudgeVerdict,
) -> Result<Uuid> {
    let verdict_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO verdicts (dispute_id, winner, freelancer_share_bps, reasoning, on_chain_tx)
        VALUES ($1, $2, $3, $4, NULL)
        RETURNING id
        "#,
    )
    .bind(case_file.dispute_id)
    .bind(&verdict.winner)
    .bind(verdict.freelancer_share_bps)
    .bind(&verdict.reasoning)
    .fetch_one(pool)
    .await?;

    Ok(verdict_id)
}

async fn finalize_resolution(
    pool: &PgPool,
    dispute_id: Uuid,
    verdict_id: Uuid,
    tx_hash: &str,
) -> Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE verdicts SET on_chain_tx = $1 WHERE id = $2")
        .bind(tx_hash)
        .bind(verdict_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE disputes SET status = 'resolved' WHERE id = $1")
        .bind(dispute_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        r#"
        UPDATE jobs
        SET status = 'resolved'
        WHERE id = (
            SELECT job_id
            FROM disputes
            WHERE id = $1
        )
        "#,
    )
    .bind(dispute_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

async fn build_case_file(
    pool: &PgPool,
    ipfs_client: &Client,
    ipfs_gateway: &str,
    dispute_id: Uuid,
) -> Result<CaseFile> {
    let job_row = sqlx::query(
        r#"
        SELECT
            d.id AS dispute_id,
            d.opened_by,
            j.id AS job_id,
            j.on_chain_job_id,
            j.title,
            j.description,
            j.budget_usdc,
            j.milestones,
            j.client_address,
            j.freelancer_address,
            j.metadata_hash
        FROM disputes d
        JOIN jobs j ON j.id = d.job_id
        WHERE d.id = $1
        "#,
    )
    .bind(dispute_id)
    .fetch_one(pool)
    .await?;

    let on_chain_job_id = job_row
        .try_get::<Option<i64>, _>("on_chain_job_id")?
        .context("dispute cannot be resolved without jobs.on_chain_job_id")?;
    let client_address: String = job_row.get("client_address");
    let freelancer_address: Option<String> = job_row.get("freelancer_address");
    let metadata_hash: Option<String> = job_row.get("metadata_hash");
    let opened_by: String = job_row.get("opened_by");

    let mut client_evidence = Vec::new();
    let mut freelancer_evidence = Vec::new();

    let evidence_rows = sqlx::query(
        r#"
        SELECT submitted_by, content, file_hash
        FROM evidence
        WHERE dispute_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(dispute_id)
    .fetch_all(pool)
    .await?;

    for row in evidence_rows {
        let submitted_by: String = row.get("submitted_by");
        let content: String = row.get("content");
        let file_hash: Option<String> = row.get("file_hash");
        let normalized = hydrate_evidence_blob(
            ipfs_client,
            ipfs_gateway,
            &submitted_by,
            &content,
            file_hash.as_deref(),
        )
        .await;

        if submitted_by == client_address {
            client_evidence.push(normalized);
        } else if freelancer_address.as_deref() == Some(submitted_by.as_str()) {
            freelancer_evidence.push(normalized);
        } else if submitted_by == opened_by {
            client_evidence.push(normalized);
        } else {
            freelancer_evidence.push(normalized);
        }
    }

    let metadata = match metadata_hash.as_deref() {
        Some(cid) => fetch_ipfs_text(ipfs_client, ipfs_gateway, cid)
            .await
            .unwrap_or_else(|err| format!("unable to load job metadata {cid}: {err}")),
        None => String::new(),
    };

    let job_spec = serde_json::json!({
        "job_id": job_row.get::<Uuid, _>("job_id"),
        "dispute_id": dispute_id,
        "title": job_row.get::<String, _>("title"),
        "description": job_row.get::<String, _>("description"),
        "budget_usdc": job_row.get::<i64, _>("budget_usdc"),
        "milestones": job_row.get::<i32, _>("milestones"),
        "client_address": client_address,
        "freelancer_address": freelancer_address,
        "metadata_hash": metadata_hash,
        "metadata_payload": metadata,
    })
    .to_string();

    Ok(CaseFile {
        dispute_id,
        on_chain_job_id,
        job_spec,
        deliverable_hash: metadata_hash.unwrap_or_else(|| dispute_id.to_string()),
        client_evidence,
        freelancer_evidence,
    })
}

async fn hydrate_evidence_blob(
    ipfs_client: &Client,
    ipfs_gateway: &str,
    submitted_by: &str,
    content: &str,
    file_hash: Option<&str>,
) -> String {
    match file_hash {
        Some(cid) => match fetch_ipfs_text(ipfs_client, ipfs_gateway, cid).await {
            Ok(ipfs_payload) => format!(
                "submitted_by={submitted_by}\ncontent={content}\nipfs_cid={cid}\nipfs_payload={ipfs_payload}"
            ),
            Err(err) => format!(
                "submitted_by={submitted_by}\ncontent={content}\nipfs_cid={cid}\nipfs_error={err}"
            ),
        },
        None => format!("submitted_by={submitted_by}\ncontent={content}"),
    }
}

async fn fetch_ipfs_text(client: &Client, gateway: &str, cid: &str) -> Result<String> {
    let base = gateway.trim_end_matches('/');
    let url = format!("{base}/{cid}");
    let response = client.get(&url).send().await?.error_for_status()?;
    Ok(response.text().await?)
}

fn parse_bool_env(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(default)
}

fn parse_u64_env(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bool_env() {
        std::env::set_var("WORKER_BOOL_TEST", "true");
        assert!(parse_bool_env("WORKER_BOOL_TEST", false));
        std::env::remove_var("WORKER_BOOL_TEST");
        assert!(!parse_bool_env("WORKER_BOOL_TEST", false));
    }

    #[tokio::test]
    async fn test_simulated_executor_uses_exact_bps() {
        let tx_hash = SimulatedResolutionExecutor
            .resolve_dispute(44, 3750)
            .await
            .expect("simulated resolution");
        assert_eq!(tx_hash, "simulated-resolve-44-3750");
    }

    #[test]
    fn test_scval_to_i64_handles_unsigned_values() {
        assert_eq!(scval_to_i64(&42u64.into()), Some(42));
        assert_eq!(scval_to_i64(&7u32.into()), Some(7));
    }
}
