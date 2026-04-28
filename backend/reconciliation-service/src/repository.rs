use crate::models::IndexedEventRecord;
use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct Repository {
    pool: PgPool,
}

impl Repository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn ensure_checkpoint_row(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO ledger_checkpoints (id, last_processed_ledger)
            VALUES (1, 0)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn load_checkpoint(&self) -> anyhow::Result<i64> {
        let checkpoint = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT last_processed_ledger
            FROM ledger_checkpoints
            WHERE id = 1
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(checkpoint)
    }

    pub async fn store_checkpoint(&self, last_processed_ledger: i64) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            UPDATE ledger_checkpoints
            SET last_processed_ledger = $1,
                updated_at = NOW()
            WHERE id = 1
            "#,
        )
        .bind(last_processed_ledger)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn insert_indexed_event(&self, event: &IndexedEventRecord) -> anyhow::Result<bool> {
        let result = sqlx::query(
            r#"
            INSERT INTO indexed_events (event_key, ledger_sequence, event_type, payload)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (event_key) DO NOTHING
            "#,
        )
        .bind(&event.event_key)
        .bind(event.ledger_sequence)
        .bind(&event.event_type)
        .bind(&event.payload)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}