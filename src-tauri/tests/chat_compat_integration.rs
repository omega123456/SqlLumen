use sqllumen_lib::ai::chat_compat::{
    append_reasoning_off_directive, cache_strategy, contains_reasoning_leak, get_cached_strategy,
    is_local_eligible, normalize_endpoint_key, normalize_provider_messages,
    normalize_provider_messages_with_strategy, strip_known_hidden_reasoning_markers,
    strip_prefill_from_content, CachedStrategy, ReasoningStrategy, ASSISTANT_PREFILL_MARKER,
    NEGATIVE_STRATEGY_TTL, POSITIVE_STRATEGY_TTL, REASONING_OFF_DIRECTIVE,
};
use sqllumen_lib::ai::types::IpcMessage;
use std::collections::HashMap;
use std::time::{Duration, Instant};

fn message(role: &str, content: &str) -> IpcMessage {
    IpcMessage {
        role: role.to_string(),
        content: content.to_string(),
    }
}

fn provider_payload_json(messages: &[IpcMessage], reasoning_disabled: bool) -> String {
    serde_json::to_string(&normalize_provider_messages(messages, reasoning_disabled))
        .expect("provider messages should serialize")
}

fn provider_payload_prefix_segment(messages: &[IpcMessage], reasoning_disabled: bool) -> String {
    let payload = provider_payload_json(messages, reasoning_disabled);
    payload
        .strip_suffix(']')
        .expect("normalized provider payload should be a JSON array")
        .to_string()
}

#[test]
fn single_turn_disabled_reasoning_applies_directive_to_every_user_message() {
    let messages = vec![
        message("system", "You are helpful"),
        message("user", "Hello"),
        message("user", "Second prompt"),
    ];

    let normalized = normalize_provider_messages(&messages, true);

    assert_eq!(normalized[0].content, "You are helpful");
    assert_eq!(normalized[1].content, "Hello\n\n/no_think");
    assert_eq!(normalized[2].content, "Second prompt\n\n/no_think");
}

#[test]
fn multi_turn_disabled_reasoning_keeps_earlier_user_prefix_stable() {
    let first_turn = vec![message("user", "Hello")];
    let second_turn = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
    ];

    let first_payload = normalize_provider_messages(&first_turn, true);
    let second_payload = normalize_provider_messages(&second_turn, true);

    assert_eq!(first_payload[0].content, second_payload[0].content);
    assert_eq!(second_payload[0].content, "Hello\n\n/no_think");
}

#[test]
fn duplicate_prevention_does_not_accumulate_directives() {
    let messages = vec![message("user", "Hello")];

    let normalized_once = normalize_provider_messages(&messages, true);
    let normalized_twice_content = append_reasoning_off_directive(&normalized_once[0].content);

    assert_eq!(normalized_once[0].content, "Hello\n\n/no_think");
    assert_eq!(normalized_twice_content, normalized_once[0].content);
    assert_eq!(
        normalized_once[0]
            .content
            .matches(REASONING_OFF_DIRECTIVE)
            .count(),
        1
    );
}

#[test]
fn reasoning_enabled_leaves_provider_messages_unchanged() {
    let messages = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
    ];

    let normalized = normalize_provider_messages(&messages, false);

    assert_eq!(normalized[0].content, "Hello");
    assert_eq!(normalized[1].content, "Hi");
    assert_eq!(normalized[2].content, "Follow up");
    assert!(normalized
        .iter()
        .all(|message| !message.content.contains(REASONING_OFF_DIRECTIVE)));
}

#[test]
fn clean_frontend_inputs_remain_unpolluted() {
    let messages = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
    ];
    let original = messages.clone();

    let _ = normalize_provider_messages(&messages, true);

    assert_eq!(messages.len(), original.len());
    for (actual, expected) in messages.iter().zip(original.iter()) {
        assert_eq!(actual.role, expected.role);
        assert_eq!(actual.content, expected.content);
    }
}

#[test]
fn mlx_cache_prefix_invariant_holds_for_second_payload() {
    let first_turn = vec![message("user", "Hello")];
    let second_turn = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
    ];

    let first_payload_prefix = provider_payload_prefix_segment(&first_turn, true);
    let second_payload = provider_payload_json(&second_turn, true);

    assert!(
        second_payload.starts_with(&first_payload_prefix),
        "second payload should start with exact shared first-turn provider bytes\nfirst_prefix: {first_payload_prefix}\nsecond: {second_payload}"
    );
}

#[test]
fn local_eligibility_accepts_loopback_private_and_lan_hosts() {
    let eligible = [
        "http://127.0.0.1:11434/v1/chat/completions",
        "http://127.12.34.56:8080/v1",
        "http://[::1]:11434/v1",
        "http://[fe80::1]:11434/v1",
        "http://[febf::1234]:11434/v1",
        "http://[fc00::1]:11434/v1",
        "http://[fd12:3456:789a::1]:11434/v1",
        "http://10.0.0.8:1234/v1",
        "http://172.16.5.4:1234/v1",
        "http://172.31.255.254:1234/v1",
        "http://192.168.1.20:1234/v1",
        "http://169.254.10.20:1234/v1",
        "http://localhost:11434/v1",
        "http://ml-host.local:11434/v1",
        "http://edge-box.lan:11434/v1",
    ];

    for url in eligible {
        assert!(
            is_local_eligible(url),
            "expected local eligibility for {url}"
        );
    }
}

#[test]
fn assistant_prefill_turn_two_keeps_turn_one_prefix_exact_through_first_user_boundary() {
    let turn_one = vec![
        message("system", "You are helpful"),
        message("user", "How many rows are in users?"),
    ];

    let turn_one_provider = normalize_provider_messages_with_strategy(
        &turn_one,
        true,
        &ReasoningStrategy::AssistantPrefill,
    );

    let turn_two = vec![
        message("system", "You are helpful"),
        message("user", "How many rows are in users?"),
        message("assistant", "Answer: some content"),
        message("user", "What about orders?"),
    ];

    let turn_two_provider = normalize_provider_messages_with_strategy(
        &turn_two,
        true,
        &ReasoningStrategy::AssistantPrefill,
    );

    assert_eq!(turn_one_provider[0].role, turn_two_provider[0].role);
    assert_eq!(turn_one_provider[0].content, turn_two_provider[0].content);
    assert_eq!(turn_one_provider[1].role, turn_two_provider[1].role);
    assert_eq!(turn_one_provider[1].content, turn_two_provider[1].content);
}

#[test]
fn local_eligibility_rejects_hosted_and_public_endpoints() {
    let ineligible = [
        "https://api.openai.com/v1/chat/completions",
        "https://example.openai.azure.com/openai/deployments/foo/chat/completions?api-version=2024-10-21",
        "http://8.8.8.8:8080/v1",
        "https://1.1.1.1/v1",
        "https://example.com/v1",
    ];

    for url in ineligible {
        assert!(
            !is_local_eligible(url),
            "expected hosted/public exclusion for {url}"
        );
    }
}

#[test]
fn endpoint_key_normalization_uses_scheme_host_port_and_path() {
    assert_eq!(
        normalize_endpoint_key("http://LOCALHOST:11434/v1/chat/completions?foo=bar"),
        "http://localhost:11434/v1/chat/completions"
    );
    assert_eq!(
        normalize_endpoint_key("https://api.openai.com/v1/responses"),
        "https://api.openai.com:443/v1/responses"
    );
}

#[test]
fn endpoint_key_normalization_distinguishes_paths_on_same_host() {
    assert_ne!(
        normalize_endpoint_key("http://localhost:11434/mlx/v1/"),
        normalize_endpoint_key("http://localhost:11434/llama/v1")
    );
    assert_eq!(
        normalize_endpoint_key("http://localhost:11434/mlx/v1/?foo=bar"),
        "http://localhost:11434/mlx/v1"
    );
}

#[test]
fn strip_hidden_reasoning_drops_incomplete_think_block_from_opener_onward() {
    assert_eq!(
        strip_known_hidden_reasoning_markers("Visible<think>hidden only", None),
        "Visible"
    );
}

#[test]
fn reasoning_leak_detector_flags_reasoning_fields_and_wrappers() {
    assert!(contains_reasoning_leak(
        r#"{"choices":[{"message":{"reasoning_content":"hidden chain"}}]}"#
    ));
    assert!(contains_reasoning_leak(
        "<think>internal reasoning</think>Visible answer"
    ));
    assert!(contains_reasoning_leak(
        r#"{"usage":{"completion_tokens_details":{"reasoning_tokens":12}}}"#
    ));
    assert!(contains_reasoning_leak(
        r#"{"thinking":"step-by-step hidden text"}"#
    ));
}

#[test]
fn reasoning_leak_detector_ignores_clean_responses() {
    assert!(!contains_reasoning_leak(
        r#"{"choices":[{"message":{"content":"final answer only"}}],"usage":{"completion_tokens_details":{"reasoning_tokens":0}}}"#
    ));
    assert!(!contains_reasoning_leak(
        "Plain text answer without leaked reasoning."
    ));
}

#[test]
fn strategy_cache_returns_matching_entry_before_ttl_expiry() {
    let mut cache = HashMap::new();
    let now = Instant::now();
    let endpoint = "http://localhost:11434/v1/chat/completions";
    let model = "mlx-community/qwen";

    cache_strategy(
        &mut cache,
        endpoint,
        model,
        ReasoningStrategy::StandardFields,
        now,
        POSITIVE_STRATEGY_TTL,
    );

    let cached = get_cached_strategy(&cache, endpoint, model, now + Duration::from_secs(60))
        .expect("expected unexpired cached strategy");

    assert_eq!(cached.strategy, ReasoningStrategy::StandardFields);
    assert_eq!(cached.ttl, POSITIVE_STRATEGY_TTL);
}

#[test]
fn strategy_cache_isolated_by_model_for_same_endpoint() {
    let mut cache = HashMap::new();
    let now = Instant::now();
    let endpoint = "http://localhost:11434/v1/chat/completions";

    cache_strategy(
        &mut cache,
        endpoint,
        "model-a",
        ReasoningStrategy::StandardFields,
        now,
        POSITIVE_STRATEGY_TTL,
    );
    cache_strategy(
        &mut cache,
        endpoint,
        "model-b",
        ReasoningStrategy::NoSafeStrategy,
        now,
        NEGATIVE_STRATEGY_TTL,
    );

    let model_a = get_cached_strategy(&cache, endpoint, "model-a", now + Duration::from_secs(1))
        .expect("model-a should have its own cache entry");
    let model_b = get_cached_strategy(&cache, endpoint, "model-b", now + Duration::from_secs(1))
        .expect("model-b should have its own cache entry");

    assert_eq!(model_a.strategy, ReasoningStrategy::StandardFields);
    assert_eq!(model_b.strategy, ReasoningStrategy::NoSafeStrategy);
    assert_ne!(model_a.strategy, model_b.strategy);
}

#[test]
fn expired_strategy_cache_entry_is_treated_as_unknown() {
    let endpoint = normalize_endpoint_key("http://localhost:11434/v1/chat/completions");
    let model = "expired-model".to_string();
    let now = Instant::now();
    let mut cache = HashMap::new();

    cache.insert(
        (endpoint.clone(), model.clone()),
        CachedStrategy {
            strategy: ReasoningStrategy::StandardFields,
            cached_at: now - NEGATIVE_STRATEGY_TTL - Duration::from_secs(1),
            ttl: NEGATIVE_STRATEGY_TTL,
        },
    );

    assert!(get_cached_strategy(&cache, &endpoint, &model, now).is_none());
}

#[test]
fn assistant_prefill_single_turn_appends_hidden_trailing_assistant_message() {
    let messages = vec![message("user", "Hello")];

    let normalized = normalize_provider_messages_with_strategy(
        &messages,
        true,
        &ReasoningStrategy::AssistantPrefill,
    );

    assert_eq!(normalized.len(), 2);
    assert_eq!(normalized[0].role, "user");
    assert_eq!(normalized[0].content, "Hello");
    assert_eq!(normalized[1].role, "assistant");
    assert_eq!(normalized[1].content, ASSISTANT_PREFILL_MARKER);
    assert!(!normalized[0].content.contains(REASONING_OFF_DIRECTIVE));
}

#[test]
fn assistant_prefill_multi_turn_normalizes_historical_assistant_messages() {
    let second_turn = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
    ];
    let third_turn = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
        message("assistant", "More detail"),
        message("user", "Third turn"),
    ];

    let second_payload = normalize_provider_messages_with_strategy(
        &second_turn,
        true,
        &ReasoningStrategy::AssistantPrefill,
    );
    let third_payload = normalize_provider_messages_with_strategy(
        &third_turn,
        true,
        &ReasoningStrategy::AssistantPrefill,
    );

    assert_eq!(
        second_payload[1].content,
        format!("{ASSISTANT_PREFILL_MARKER}Hi")
    );
    for (lhs, rhs) in third_payload
        .iter()
        .take(second_payload.len() - 1)
        .zip(second_payload.iter().take(second_payload.len() - 1))
    {
        assert_eq!(lhs.role, rhs.role);
        assert_eq!(lhs.content, rhs.content);
    }
}

#[test]
fn strip_prefill_from_content_handles_prefixed_and_plain_text() {
    assert_eq!(
        strip_prefill_from_content(&format!("{ASSISTANT_PREFILL_MARKER}Hello")),
        "Hello"
    );
    assert_eq!(strip_prefill_from_content("Hello"), "Hello");
}

#[test]
fn assistant_prefill_prefix_invariant_holds_between_turns() {
    let turn_two = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
    ];
    let turn_three = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
        message("assistant", "More detail"),
        message("user", "Third turn"),
    ];

    let second_payload = normalize_provider_messages_with_strategy(
        &turn_two,
        true,
        &ReasoningStrategy::AssistantPrefill,
    );
    let third_payload = normalize_provider_messages_with_strategy(
        &turn_three,
        true,
        &ReasoningStrategy::AssistantPrefill,
    );

    for (lhs, rhs) in third_payload
        .iter()
        .take(second_payload.len() - 1)
        .zip(second_payload.iter().take(second_payload.len() - 1))
    {
        assert_eq!(lhs.role, rhs.role);
        assert_eq!(lhs.content, rhs.content);
    }
}

#[test]
fn standard_fields_non_regression_keeps_no_think_without_prefill() {
    let messages = vec![
        message("user", "Hello"),
        message("assistant", "Hi"),
        message("user", "Follow up"),
    ];

    let normalized = normalize_provider_messages_with_strategy(
        &messages,
        true,
        &ReasoningStrategy::StandardFields,
    );

    assert_eq!(normalized.len(), 3);
    assert_eq!(normalized[0].content, "Hello\n\n/no_think");
    assert_eq!(normalized[1].content, "Hi");
    assert_eq!(normalized[2].content, "Follow up\n\n/no_think");
    assert!(normalized
        .iter()
        .all(|message| message.content != ASSISTANT_PREFILL_MARKER));
}
