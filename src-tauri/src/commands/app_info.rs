use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub rust_log_override: bool,
    pub app_version: String,
}

pub fn get_app_info_impl<R: tauri::Runtime>(_app_handle: &Option<tauri::AppHandle<R>>) -> AppInfo {
    let rust_log_override = crate::logging::rust_log_directives().is_some();

    let app_version = env!("CARGO_PKG_VERSION").to_string();

    AppInfo {
        rust_log_override,
        app_version,
    }
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_app_info(app_handle: tauri::AppHandle) -> AppInfo {
    get_app_info_impl(&Some(app_handle))
}
