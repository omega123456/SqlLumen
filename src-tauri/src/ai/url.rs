//! Shared URL normalisation for OpenAI-compatible endpoints.
//!
//! All AI sub-paths (chat completions, completions, models, embeddings) share
//! the same base-URL handling: trim whitespace, strip any known OpenAI path
//! suffix, ensure a `/v1` tail, then append the desired final segment.

/// Normalise a base URL to a specific OpenAI-compatible sub-path.
///
/// Strips any known path suffixes (`/chat/completions`, `/completions`,
/// `/models`, `/embeddings`), ensures the URL ends with `/v1`, then appends
/// `final_segment`.
///
/// This function is idempotent — passing an already-normalised URL returns the
/// same URL.
///
/// # Examples
///
/// ```
/// use sqllumen_lib::ai::url::normalise_openai_url;
/// assert_eq!(
///     normalise_openai_url("http://localhost:11434/v1", "chat/completions"),
///     "http://localhost:11434/v1/chat/completions"
/// );
/// ```
pub fn normalise_openai_url(base_url: &str, final_segment: &str) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();
    for suffix in &[
        "/chat/completions",
        "/completions",
        "/models",
        "/embeddings",
    ] {
        if base.ends_with(suffix) {
            base = base[..base.len() - suffix.len()].to_string();
            break;
        }
    }
    if !base.ends_with("/v1") {
        base = format!("{}/v1", base.trim_end_matches('/'));
    }
    format!("{base}/{final_segment}")
}
