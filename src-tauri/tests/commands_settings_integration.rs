//! Command-layer settings `_impl` functions (`commands/settings.rs`).

mod common;

use sqllumen_lib::commands::settings::{
    get_all_settings_impl, get_setting_impl, set_setting_impl,
};

#[test]
fn test_get_setting_impl_returns_none_for_missing() {
    let state = common::test_app_state();
    let result = get_setting_impl(&state, "nonexistent").expect("should not error");
    assert_eq!(result, None);
}

#[test]
fn test_set_and_get_setting_impl() {
    let state = common::test_app_state();
    set_setting_impl(&state, "theme", "dark").expect("should set");
    let result = get_setting_impl(&state, "theme").expect("should get");
    assert_eq!(result, Some("dark".to_string()));
}

#[test]
fn test_set_setting_impl_upserts() {
    let state = common::test_app_state();
    set_setting_impl(&state, "theme", "light").expect("should set");
    set_setting_impl(&state, "theme", "dark").expect("should upsert");
    let result = get_setting_impl(&state, "theme").expect("should get");
    assert_eq!(result, Some("dark".to_string()));
}

#[test]
fn test_get_all_settings_impl_empty() {
    let state = common::test_app_state();
    let all = get_all_settings_impl(&state).expect("should get all");
    assert!(all.is_empty());
}

#[test]
fn test_get_all_settings_impl_with_values() {
    let state = common::test_app_state();
    set_setting_impl(&state, "theme", "dark").expect("set theme");
    set_setting_impl(&state, "font", "mono").expect("set font");
    let all = get_all_settings_impl(&state).expect("should get all");
    assert_eq!(all.len(), 2);
    assert_eq!(all.get("theme"), Some(&"dark".to_string()));
    assert_eq!(all.get("font"), Some(&"mono".to_string()));
}
