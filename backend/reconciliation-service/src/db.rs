use sqlx::{postgres::PgPoolOptions, PgPool};

pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    Ok(PgPoolOptions::new().max_connections(8).connect(database_url).await?)
}

pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}