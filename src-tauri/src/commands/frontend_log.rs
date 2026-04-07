//! Frontend-originated log lines (application logger / tracing), not toast-specific.

const TARGET: &str = "sqllumen_lib::frontend";

pub fn log_frontend_impl(level: &str, message: &str) -> Result<(), String> {
    let level_norm = level.trim().to_ascii_lowercase();
    match level_norm.as_str() {
        "error" => {
            tracing::error!(target: TARGET, "{}", message);
            Ok(())
        }
        "warn" => {
            tracing::warn!(target: TARGET, "{}", message);
            Ok(())
        }
        "info" => {
            tracing::info!(target: TARGET, "{}", message);
            Ok(())
        }
        "debug" => {
            tracing::debug!(target: TARGET, "{}", message);
            Ok(())
        }
        "trace" => {
            tracing::trace!(target: TARGET, "{}", message);
            Ok(())
        }
        _ => Err(format!("unknown log level: {level}")),
    }
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn log_frontend(level: String, message: String) -> Result<(), String> {
    log_frontend_impl(&level, &message)
}
