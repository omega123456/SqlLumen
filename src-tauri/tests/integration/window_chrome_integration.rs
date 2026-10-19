use sqllumen_lib::commands::window_chrome::{
    get_window_backdrop_impl, set_window_theme_impl, window_theme_error,
};
use sqllumen_lib::window_chrome::{
    apply_backdrop, backdrop_for_build, backdrop_for_window, current_backdrop, native_theme,
    WindowBackdrop, MICA_MIN_BUILD,
};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::Theme;

fn build_window() -> (tauri::App<MockRuntime>, tauri::WebviewWindow<MockRuntime>) {
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("should build test app");
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("should build test webview");
    (app, window)
}

#[test]
fn native_theme_maps_light_dark_and_falls_back_to_the_os() {
    assert_eq!(native_theme(Some("light")), Some(Theme::Light));
    assert_eq!(native_theme(Some("dark")), Some(Theme::Dark));
    assert_eq!(native_theme(Some("system")), None);
    assert_eq!(native_theme(Some("sepia")), None);
    assert_eq!(native_theme(None), None);
}

#[test]
fn mica_needs_windows_11() {
    assert_eq!(backdrop_for_build(None), WindowBackdrop::Solid);
    assert_eq!(backdrop_for_build(Some(19_045)), WindowBackdrop::Solid);
    assert_eq!(
        backdrop_for_build(Some(MICA_MIN_BUILD - 1)),
        WindowBackdrop::Solid
    );
    assert_eq!(
        backdrop_for_build(Some(MICA_MIN_BUILD)),
        WindowBackdrop::Mica
    );
    assert_eq!(backdrop_for_build(Some(26_100)), WindowBackdrop::Mica);
}

#[test]
fn backdrop_serialises_lowercase() {
    assert_eq!(
        serde_json::to_string(&WindowBackdrop::Mica).unwrap(),
        "\"mica\""
    );
    assert_eq!(
        serde_json::to_string(&WindowBackdrop::Solid).unwrap(),
        "\"solid\""
    );
}

#[test]
fn test_utils_builds_always_get_the_solid_backdrop() {
    let (_app, window) = build_window();
    assert_eq!(apply_backdrop(&window), WindowBackdrop::Solid);
    assert_eq!(current_backdrop(), WindowBackdrop::Solid);
    assert_eq!(get_window_backdrop_impl(), WindowBackdrop::Solid);
}

#[test]
fn set_window_theme_accepts_every_preference() {
    let (_app, window) = build_window();
    for theme in [Some("light"), Some("dark"), Some("system"), None] {
        set_window_theme_impl(&window, theme).expect("theme should apply");
    }
}

#[test]
fn test_utils_builds_never_apply_mica_even_on_windows_11() {
    let (_app, window) = build_window();
    assert_eq!(
        backdrop_for_window(&window, Some(MICA_MIN_BUILD)),
        WindowBackdrop::Solid
    );
    assert_eq!(backdrop_for_window(&window, None), WindowBackdrop::Solid);
}

#[test]
fn window_theme_errors_name_the_failure() {
    let message = window_theme_error(&tauri::Error::WindowNotFound, Some("dark"));
    assert!(message.starts_with("Failed to set the window theme: "));
    assert!(message.len() > "Failed to set the window theme: ".len());
}
