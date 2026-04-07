mod common;

use mysql_client_lib::commands::app_info::{get_app_info_impl, AppInfo};

#[test]
fn test_get_app_info_without_app_handle() {
    let info: AppInfo = get_app_info_impl(&None);

    // Without an app_handle, log_directory should be empty
    assert!(
        info.log_directory.is_empty(),
        "log_directory should be empty when app_handle is None"
    );

    // app_version should be the package version from Cargo.toml (set by Cargo at build time)
    // or "dev" if CARGO_PKG_VERSION is not set
    assert!(
        !info.app_version.is_empty(),
        "app_version should not be empty"
    );
}

#[test]
fn test_rust_log_override_detection() {
    // Save original state
    let original = std::env::var("RUST_LOG").ok();

    // Set RUST_LOG and check detection
    std::env::set_var("RUST_LOG", "debug");
    let info = get_app_info_impl(&None);
    assert!(
        info.rust_log_override,
        "rust_log_override should be true when RUST_LOG is set"
    );

    // Remove RUST_LOG and check detection
    std::env::remove_var("RUST_LOG");
    let info = get_app_info_impl(&None);
    assert!(
        !info.rust_log_override,
        "rust_log_override should be false when RUST_LOG is not set"
    );

    // Restore original
    if let Some(val) = original {
        std::env::set_var("RUST_LOG", val);
    }
}

#[test]
fn test_app_version_has_value() {
    let info = get_app_info_impl(&None);
    // CARGO_PKG_VERSION is always set during a cargo build
    assert!(
        !info.app_version.is_empty(),
        "app_version should be set"
    );
}

#[test]
fn test_app_info_fields_serialized_camel_case() {
    let info = get_app_info_impl(&None);
    let json = serde_json::to_string(&info).expect("should serialize to JSON");
    assert!(
        json.contains("rustLogOverride"),
        "JSON should contain camelCase field 'rustLogOverride'"
    );
    assert!(
        json.contains("logDirectory"),
        "JSON should contain camelCase field 'logDirectory'"
    );
    assert!(
        json.contains("appVersion"),
        "JSON should contain camelCase field 'appVersion'"
    );
}

#[test]
fn test_app_info_debug_impl() {
    let info = get_app_info_impl(&None);
    let debug_str = format!("{:?}", info);
    assert!(debug_str.contains("AppInfo"));
    assert!(debug_str.contains("rust_log_override"));
    assert!(debug_str.contains("log_directory"));
    assert!(debug_str.contains("app_version"));
}
