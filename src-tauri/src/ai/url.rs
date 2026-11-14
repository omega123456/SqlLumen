pub fn normalise_openai_url(base_url: &str, final_segment: &str) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();
    for suffix in &[
        "/chat/completions",
        "/responses",
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

pub fn normalise_to_responses_url(base_url: &str) -> String {
    normalise_openai_url(base_url, "responses")
}
