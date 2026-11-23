use std::sync::OnceLock;

use serde::Serialize;
use tauri::{Runtime, Theme, WebviewWindow};

pub const MICA_MIN_BUILD: u32 = 22_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowBackdrop {
    Mica,
    Solid,
}

static BACKDROP: OnceLock<WindowBackdrop> = OnceLock::new();

pub fn backdrop_for_build(build: Option<u32>) -> WindowBackdrop {
    match build {
        Some(build) if build >= MICA_MIN_BUILD => WindowBackdrop::Mica,
        _ => WindowBackdrop::Solid,
    }
}

pub fn native_theme(theme: Option<&str>) -> Option<Theme> {
    match theme {
        Some("light") => Some(Theme::Light),
        Some("dark") => Some(Theme::Dark),
        _ => None,
    }
}

pub fn apply_backdrop<R: Runtime>(window: &WebviewWindow<R>) -> WindowBackdrop {
    let backdrop = backdrop_for_window(window, platform::windows_build());
    let _ = BACKDROP.set(backdrop);
    backdrop
}

pub fn backdrop_for_window<R: Runtime>(
    window: &WebviewWindow<R>,
    build: Option<u32>,
) -> WindowBackdrop {
    match backdrop_for_build(build) {
        WindowBackdrop::Mica => platform::apply_mica(window),
        WindowBackdrop::Solid => WindowBackdrop::Solid,
    }
}

pub fn current_backdrop() -> WindowBackdrop {
    BACKDROP.get().copied().unwrap_or(WindowBackdrop::Solid)
}

#[cfg(any(feature = "test-utils", not(windows)))]
mod platform {
    use tauri::{Runtime, WebviewWindow};

    use super::WindowBackdrop;

    pub fn windows_build() -> Option<u32> {
        None
    }

    pub fn apply_mica<R: Runtime>(_window: &WebviewWindow<R>) -> WindowBackdrop {
        WindowBackdrop::Solid
    }
}

#[cfg(all(not(feature = "test-utils"), windows))]
mod platform {
    use tauri::window::{Effect, EffectsBuilder};
    use tauri::{Runtime, WebviewWindow};
    use windows_version::OsVersion;

    use super::WindowBackdrop;

    pub fn windows_build() -> Option<u32> {
        Some(OsVersion::current().build)
    }

    pub fn apply_mica<R: Runtime>(window: &WebviewWindow<R>) -> WindowBackdrop {
        match window.set_effects(EffectsBuilder::new().effect(Effect::Mica).build()) {
            Ok(()) => WindowBackdrop::Mica,
            Err(error) => {
                tracing::warn!(%error, "Mica backdrop unavailable, using the solid base");
                WindowBackdrop::Solid
            }
        }
    }
}
