use crate::window_chrome::{WindowBackdrop, current_backdrop, native_theme};

pub fn set_window_theme_impl<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    theme: Option<&str>,
) -> Result<(), String> {
    match window.set_theme(native_theme(theme)) {
        Ok(()) => Ok(()),
        Err(error) => Err(window_theme_error(&error, theme)),
    }
}

pub fn window_theme_error(error: &tauri::Error, theme: Option<&str>) -> String {
    tracing::error!(%error, ?theme, "failed to set the native window theme");
    format!("Failed to set the window theme: {error}")
}

pub fn get_window_backdrop_impl() -> WindowBackdrop {
    current_backdrop()
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn set_window_theme(window: tauri::WebviewWindow, theme: Option<String>) -> Result<(), String> {
    set_window_theme_impl(&window, theme.as_deref())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn get_window_backdrop() -> WindowBackdrop {
    get_window_backdrop_impl()
}
