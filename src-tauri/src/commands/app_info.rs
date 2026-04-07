use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub rust_log_override: bool,
    pub log_directory: String,
    pub app_version: String,
}

pub fn get_app_info_impl(app_handle: &Option<tauri::AppHandle>) -> AppInfo {
    // Check RUST_LOG env var
    let rust_log_override = std::env::var("RUST_LOG").is_ok();

    // Get log directory
    let log_directory = if let Some(handle) = app_handle {
        use tauri::Manager;
        handle
            .path()
            .app_data_dir()
            .map(|p| {
                let dir = crate::resolved_app_data_dir(&p);
                dir.join("logs").to_string_lossy().to_string()
            })
            .unwrap_or_default()
    } else {
        String::new() // fallback for tests
    };

    // Get app version at compile time (embedded by Cargo)
    let app_version = env!("CARGO_PKG_VERSION").to_string();

    AppInfo {
        rust_log_override,
        log_directory,
        app_version,
    }
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_app_info(app_handle: tauri::AppHandle) -> AppInfo {
    get_app_info_impl(&Some(app_handle))
}
