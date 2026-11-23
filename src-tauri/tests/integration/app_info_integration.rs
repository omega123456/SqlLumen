use sqllumen_lib::commands::app_info::{AppInfo, get_app_info_impl};

fn get_app_info_without_handle() -> AppInfo {
    get_app_info_impl::<tauri::test::MockRuntime>(&None)
}

#[test]
fn test_get_app_info_without_app_handle() {
    let info: AppInfo = get_app_info_without_handle();

    // app_version should be the package version from Cargo.toml (set by Cargo at build time)
    // or "dev" if CARGO_PKG_VERSION is not set
    assert!(
        !info.app_version.is_empty(),
        "app_version should not be empty"
    );
}

#[test]
fn test_rust_log_override_reflects_the_process_environment() {
    let info = get_app_info_without_handle();
    let rust_log_set = std::env::var("RUST_LOG").is_ok();
    assert_eq!(info.rust_log_override, rust_log_set);
}

#[test]
fn test_app_version_has_value() {
    let info = get_app_info_without_handle();
    // CARGO_PKG_VERSION is always set during a cargo build
    assert!(!info.app_version.is_empty(), "app_version should be set");
}

#[test]
fn test_app_info_fields_serialized_camel_case() {
    let info = get_app_info_without_handle();
    let json = serde_json::to_string(&info).expect("should serialize to JSON");
    assert!(
        json.contains("rustLogOverride"),
        "JSON should contain camelCase field 'rustLogOverride'"
    );
    assert!(
        json.contains("appVersion"),
        "JSON should contain camelCase field 'appVersion'"
    );
    assert!(
        !json.contains("logDirectory"),
        "JSON should not contain removed field 'logDirectory'"
    );
}

#[test]
fn test_app_info_debug_impl() {
    let info = get_app_info_without_handle();
    let debug_str = format!("{:?}", info);
    assert!(debug_str.contains("AppInfo"));
    assert!(debug_str.contains("rust_log_override"));
    assert!(debug_str.contains("app_version"));
    assert!(!debug_str.contains("log_directory"));
}

#[cfg(coverage)]
#[test]
fn test_run_stub_is_callable_in_coverage_builds() {
    sqllumen_lib::run();
}
