use anyhow::Result;
use dotenvy::from_path_iter;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct EnvBootstrap {
    pub app_env: String,
    pub loaded_files: Vec<String>,
}

pub fn load_backend_environment() -> Result<EnvBootstrap> {
    let app_env = std::env::var("APP_ENV")
        .or_else(|_| std::env::var("RUST_ENV"))
        .unwrap_or_else(|_| "development".to_string());

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let initial_env_keys = snapshot_env_keys();
    let mut loaded_files = Vec::new();

    let base_env = root.join(".env");
    if base_env.is_file() {
        apply_env_file(&base_env, false, &initial_env_keys)?;
        loaded_files.push(display_path(&base_env, &root));
    }

    let env_specific = root.join(format!(".env.{app_env}"));
    if env_specific.is_file() {
        // Environment-specific values should override `.env`,
        // but never override values already supplied by the parent process.
        apply_env_file(&env_specific, true, &initial_env_keys)?;
        loaded_files.push(display_path(&env_specific, &root));
    }

    Ok(EnvBootstrap {
        app_env,
        loaded_files,
    })
}

fn snapshot_env_keys() -> HashSet<String> {
    std::env::vars().map(|(key, _)| key).collect()
}

fn apply_env_file(
    path: &Path,
    allow_override_for_loaded_values: bool,
    initial_env_keys: &HashSet<String>,
) -> Result<()> {
    let iter = from_path_iter(path)?;
    for item in iter {
        let (key, value) = item?;

        let should_set = if allow_override_for_loaded_values {
            !initial_env_keys.contains(&key)
        } else {
            std::env::var_os(&key).is_none()
        };

        if should_set {
            std::env::set_var(key, value);
        }
    }

    Ok(())
}

fn display_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .map(|relative| relative.display().to_string())
        .unwrap_or_else(|_| path.display().to_string())
}
