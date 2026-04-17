//! Unit-style integration tests for `normalise_openai_url`.
//!
//! Covers all branches: bare hosts, `/v1`-suffixed bases, already-normalised
//! inputs (idempotence), legacy/sibling OpenAI path suffixes that must be
//! stripped (`/models`, `/embeddings`, `/completions`), and whitespace trimming.
//!
//! The shared helper is used by three call sites (chat completions, models,
//! embeddings), so we also exercise each `final_segment` variant.

use sqllumen_lib::ai::url::normalise_openai_url;

const EXPECTED: &str = "http://host:11434/v1/chat/completions";

#[test]
fn bare_host_with_no_path_gets_v1_and_chat_completions_appended() {
    assert_eq!(
        normalise_openai_url("http://host:11434", "chat/completions"),
        EXPECTED
    );
}

#[test]
fn bare_host_with_trailing_slash_is_normalised() {
    assert_eq!(
        normalise_openai_url("http://host:11434/", "chat/completions"),
        EXPECTED
    );
}

#[test]
fn v1_base_is_the_canonical_input() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1", "chat/completions"),
        EXPECTED
    );
}

#[test]
fn v1_base_with_trailing_slash_is_normalised() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/", "chat/completions"),
        EXPECTED
    );
}

#[test]
fn already_chat_completions_is_idempotent() {
    // Legacy stored value — must not become /v1/chat/completions/chat/completions.
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/chat/completions", "chat/completions"),
        EXPECTED
    );
}

#[test]
fn v1_models_suffix_is_stripped_and_replaced() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/models", "chat/completions"),
        EXPECTED
    );
}

#[test]
fn v1_embeddings_suffix_is_stripped_and_replaced() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/embeddings", "chat/completions"),
        EXPECTED
    );
}

#[test]
fn v1_completions_suffix_is_stripped_and_replaced() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/completions", "chat/completions"),
        EXPECTED
    );
}

#[test]
fn surrounding_whitespace_is_trimmed() {
    assert_eq!(
        normalise_openai_url("  http://host:11434/v1  ", "chat/completions"),
        EXPECTED
    );
}

// ── models segment ────────────────────────────────────────────────────────

#[test]
fn models_segment_from_bare_host() {
    assert_eq!(
        normalise_openai_url("http://host:11434", "models"),
        "http://host:11434/v1/models"
    );
}

#[test]
fn models_segment_is_idempotent_for_models_suffix() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/models", "models"),
        "http://host:11434/v1/models"
    );
}

#[test]
fn models_segment_strips_chat_completions_suffix() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/chat/completions", "models"),
        "http://host:11434/v1/models"
    );
}

// ── embeddings segment ────────────────────────────────────────────────────

#[test]
fn embeddings_segment_from_bare_host() {
    assert_eq!(
        normalise_openai_url("http://host:11434", "embeddings"),
        "http://host:11434/v1/embeddings"
    );
}

#[test]
fn embeddings_segment_is_idempotent_for_embeddings_suffix() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/embeddings", "embeddings"),
        "http://host:11434/v1/embeddings"
    );
}

#[test]
fn embeddings_segment_strips_models_suffix() {
    assert_eq!(
        normalise_openai_url("http://host:11434/v1/models", "embeddings"),
        "http://host:11434/v1/embeddings"
    );
}
