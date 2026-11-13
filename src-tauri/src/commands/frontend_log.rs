use serde::Deserialize;

const TARGET: &str = "sqllumen_lib::frontend";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFrontendRequest {
    pub level: String,
    pub message: String,
}

pub fn log_frontend_impl(request: &LogFrontendRequest) -> Result<(), String> {
    let level = request.level.as_str();
    let message = request.message.as_str();
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
pub fn log_frontend(payload: LogFrontendRequest) -> Result<(), String> {
    log_frontend_impl(&payload)
}
