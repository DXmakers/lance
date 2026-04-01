use anyhow::{anyhow, bail, Context, Result};
use soroban_client::{
    account::AccountBehavior,
    contract::{ContractBehavior, Contracts},
    keypair::{Keypair, KeypairBehavior},
    soroban_rpc::{SendTransactionStatus, TransactionStatus},
    transaction::{TransactionBehavior, TransactionBuilder, TransactionBuilderBehavior},
    xdr::ScVal,
    Options, Server,
};
use std::{fs, time::Duration};

const DEFAULT_NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";
const DEFAULT_RPC_URL: &str = "https://soroban-testnet.stellar.org";
const DEFAULT_BASE_FEE: u32 = 1_000;
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const DEFAULT_CONFIRM_TIMEOUT_SECS: u64 = 60;

pub struct StellarService {
    server: Server,
    judge_keypair: Keypair,
    contract: Contracts,
    network_passphrase: String,
    tx_timeout: Duration,
    confirmation_timeout: Duration,
    default_base_fee: u32,
}

impl StellarService {
    pub fn from_env() -> Result<Self> {
        let rpc_url =
            std::env::var("SOROBAN_RPC_URL").unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());
        let network_passphrase = std::env::var("STELLAR_NETWORK_PASSPHRASE")
            .unwrap_or_else(|_| DEFAULT_NETWORK_PASSPHRASE.to_string());
        let contract_id =
            std::env::var("ESCROW_CONTRACT_ID").context("ESCROW_CONTRACT_ID must be set")?;
        let judge_secret = load_judge_secret()?;
        let judge_keypair = Keypair::from_secret(&judge_secret)
            .map_err(|err| anyhow!("invalid judge key: {err}"))?;
        let server = Server::new(&rpc_url, Options::default())
            .map_err(|err| anyhow!("failed to create Soroban RPC client: {err}"))?;

        Ok(Self {
            server,
            judge_keypair,
            contract: Contracts::new(&contract_id)
                .map_err(|err| anyhow!("invalid ESCROW_CONTRACT_ID: {err}"))?,
            network_passphrase,
            tx_timeout: Duration::from_secs(parse_u64_env(
                "STELLAR_TX_TIMEOUT_SECS",
                DEFAULT_TIMEOUT_SECS,
            )),
            confirmation_timeout: Duration::from_secs(parse_u64_env(
                "STELLAR_CONFIRM_TIMEOUT_SECS",
                DEFAULT_CONFIRM_TIMEOUT_SECS,
            )),
            default_base_fee: parse_u32_env("STELLAR_BASE_FEE", DEFAULT_BASE_FEE),
        })
    }

    pub async fn open_dispute(&self, job_id: u64) -> Result<String> {
        self.submit_contract_call("open_dispute", vec![job_id.into()])
            .await
    }

    pub async fn release_milestone(&self, job_id: u64, milestone_index: u32) -> Result<String> {
        self.submit_contract_call(
            "release_milestone",
            vec![job_id.into(), milestone_index.into()],
        )
        .await
    }

    pub async fn resolve_dispute(&self, job_id: u64, freelancer_share_bps: u32) -> Result<String> {
        if freelancer_share_bps > 10_000 {
            bail!("freelancer_share_bps must be <= 10000");
        }

        self.submit_contract_call(
            "resolve_dispute",
            vec![job_id.into(), freelancer_share_bps.into()],
        )
        .await
    }

    async fn submit_contract_call(&self, method: &str, args: Vec<ScVal>) -> Result<String> {
        let mut source = self
            .server
            .get_account(&self.judge_keypair.public_key())
            .await
            .map_err(|err| anyhow!("failed to fetch judge account: {err}"))?;
        let base_fee = self.fetch_dynamic_base_fee().await;
        let timeout_secs: i64 = self
            .tx_timeout
            .as_secs()
            .try_into()
            .map_err(|_| anyhow!("STELLAR_TX_TIMEOUT_SECS is too large"))?;

        let mut builder =
            TransactionBuilder::new(&mut source, self.network_passphrase.as_str(), None);
        builder
            .fee(base_fee)
            .set_timeout(timeout_secs)
            .map_err(|err| anyhow!("failed to set tx timeout: {err}"))?
            .add_operation(self.contract.call(method, Some(args)));

        let tx = builder.build();
        let mut prepared = self
            .server
            .prepare_transaction(&tx)
            .await
            .map_err(|err| anyhow!("failed to prepare {method} transaction: {err}"))?;
        prepared.sign(std::slice::from_ref(&self.judge_keypair));

        let send = self
            .server
            .send_transaction(prepared)
            .await
            .map_err(|err| anyhow!("failed to send {method} transaction: {err}"))?;

        match send.status {
            SendTransactionStatus::Pending | SendTransactionStatus::Duplicate => {}
            SendTransactionStatus::TryAgainLater => {
                bail!("rpc asked to retry submission for {method}")
            }
            SendTransactionStatus::Error => {
                let details = send
                    .to_error_result()
                    .map(|result| format!("{result:?}"))
                    .or_else(|| {
                        send.to_diagnostic_events()
                            .map(|events| format!("{events:?}"))
                    })
                    .unwrap_or_else(|| "no diagnostic details".to_string());
                bail!("{method} transaction rejected: {details}");
            }
        }

        let tx = self
            .server
            .wait_transaction(&send.hash, self.confirmation_timeout)
            .await
            .map_err(|(err, _)| anyhow!("{method} confirmation failed: {err}"))?;

        if tx.status != TransactionStatus::Success {
            bail!("{method} transaction finished with status {:?}", tx.status);
        }

        Ok(send.hash)
    }

    async fn fetch_dynamic_base_fee(&self) -> u32 {
        match self.server.get_fee_stats().await {
            Ok(stats) => stats
                .soroban_inclusion_fee
                .p95
                .parse::<u32>()
                .ok()
                .filter(|fee| *fee > 0)
                .unwrap_or(self.default_base_fee),
            Err(_) => self.default_base_fee,
        }
    }
}

fn load_judge_secret() -> Result<String> {
    if let Ok(path) = std::env::var("JUDGE_AUTHORITY_SECRET_FILE") {
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read JUDGE_AUTHORITY_SECRET_FILE at {path}"))?;
        let secret = raw.trim().to_string();
        if secret.is_empty() {
            bail!("JUDGE_AUTHORITY_SECRET_FILE is empty");
        }
        return Ok(secret);
    }

    let secret =
        std::env::var("JUDGE_AUTHORITY_SECRET").context("JUDGE_AUTHORITY_SECRET must be set")?;
    if secret.trim().is_empty() {
        bail!("JUDGE_AUTHORITY_SECRET must not be empty");
    }
    Ok(secret.trim().to_string())
}

fn parse_u64_env(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

fn parse_u32_env(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_secret_prefers_file() {
        let path = std::env::temp_dir().join("judge-secret.txt");
        fs::write(&path, "SSECRET\n").expect("write secret file");
        std::env::set_var("JUDGE_AUTHORITY_SECRET_FILE", &path);
        std::env::set_var("JUDGE_AUTHORITY_SECRET", "SOTHER");

        let secret = load_judge_secret().expect("secret should load");
        assert_eq!(secret, "SSECRET");

        std::env::remove_var("JUDGE_AUTHORITY_SECRET_FILE");
        std::env::remove_var("JUDGE_AUTHORITY_SECRET");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn parse_env_uses_default_when_invalid() {
        std::env::set_var("STELLAR_BASE_FEE_TEST", "abc");
        assert_eq!(parse_u32_env("STELLAR_BASE_FEE_TEST", 55), 55);
        std::env::remove_var("STELLAR_BASE_FEE_TEST");
    }
}
