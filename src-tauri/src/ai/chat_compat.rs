use crate::ai::types::{ApiMessage, IpcMessage};
use reqwest::Url;
use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

pub const REASONING_OFF_DIRECTIVE: &str = "/no_think";
pub const ASSISTANT_PREFILL_MARKER: &str = "Answer: ";
pub const POSITIVE_STRATEGY_TTL: Duration = Duration::from_secs(4 * 60 * 60);
pub const NEGATIVE_STRATEGY_TTL: Duration = Duration::from_secs(30 * 60);

pub type ProviderChatMessage = ApiMessage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasoningStrategy {
    StandardFields,
    AssistantPrefill,
    NoSafeStrategy,
}

pub fn reasoning_strategy_name(strategy: ReasoningStrategy) -> &'static str {
    match strategy {
        ReasoningStrategy::StandardFields => "StandardFields",
        ReasoningStrategy::AssistantPrefill => "AssistantPrefill",
        ReasoningStrategy::NoSafeStrategy => "NoSafeStrategy",
    }
}

#[derive(Debug, Clone)]
pub struct CachedStrategy {
    pub strategy: ReasoningStrategy,
    pub cached_at: Instant,
    pub ttl: Duration,
}

impl CachedStrategy {
    pub fn is_expired(&self, now: Instant) -> bool {
        now.duration_since(self.cached_at) >= self.ttl
    }
}

pub type StrategyCache = HashMap<(String, String), CachedStrategy>;

#[derive(Debug, Clone)]
pub enum StrategyCacheLookup {
    Hit(CachedStrategy),
    Expired(CachedStrategy),
    Miss,
}

pub fn cache_strategy(
    cache: &mut StrategyCache,
    endpoint: &str,
    model_id: &str,
    strategy: ReasoningStrategy,
    cached_at: Instant,
    ttl: Duration,
) {
    cache.insert(
        (normalize_endpoint_key(endpoint), model_id.to_string()),
        CachedStrategy {
            strategy,
            cached_at,
            ttl,
        },
    );
}

pub fn get_cached_strategy(
    cache: &StrategyCache,
    endpoint: &str,
    model_id: &str,
    now: Instant,
) -> Option<CachedStrategy> {
    let key = (normalize_endpoint_key(endpoint), model_id.to_string());
    cache
        .get(&key)
        .filter(|entry| !entry.is_expired(now))
        .cloned()
}

pub fn inspect_cached_strategy(
    cache: &StrategyCache,
    endpoint: &str,
    model_id: &str,
    now: Instant,
) -> StrategyCacheLookup {
    let key = (normalize_endpoint_key(endpoint), model_id.to_string());

    match cache.get(&key).cloned() {
        Some(entry) if entry.is_expired(now) => StrategyCacheLookup::Expired(entry),
        Some(entry) => StrategyCacheLookup::Hit(entry),
        None => StrategyCacheLookup::Miss,
    }
}

pub fn is_local_eligible(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };

    let Some(host) = parsed.host_str() else {
        return false;
    };

    let normalized_host = host
        .trim_matches(|ch| ch == '[' || ch == ']')
        .trim_end_matches('.')
        .to_ascii_lowercase();

    if normalized_host == "localhost"
        || normalized_host.ends_with(".local")
        || normalized_host.ends_with(".lan")
    {
        return true;
    }

    let Ok(ip) = normalized_host.parse::<IpAddr>() else {
        return false;
    };

    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || matches!(ipv4.octets(), [127, ..])
        }
        IpAddr::V6(ipv6) => {
            if ipv6.is_loopback() {
                return true;
            }

            let segments = ipv6.segments();
            let first_octet = (segments[0] >> 8) as u8;
            let first_two_octets = segments[0];

            matches!(first_octet, 0xfc | 0xfd) || (0xfe80..=0xfebf).contains(&first_two_octets)
        }
    }
}

pub fn normalize_endpoint_key(url: &str) -> String {
    let Ok(parsed) = Url::parse(url) else {
        return url.trim().to_ascii_lowercase();
    };

    let scheme = parsed.scheme().to_ascii_lowercase();
    let host = parsed
        .host_str()
        .map(|value| value.trim_end_matches('.').to_ascii_lowercase())
        .unwrap_or_default();

    let normalized_path = {
        let path = parsed.path().trim_end_matches('/');
        if path.is_empty() {
            ""
        } else {
            path
        }
    };

    match parsed.port_or_known_default() {
        Some(port) if !host.is_empty() => format!("{scheme}://{host}:{port}{normalized_path}"),
        None if !host.is_empty() => format!("{scheme}://{host}{normalized_path}"),
        _ => url.trim().to_ascii_lowercase(),
    }
}

pub fn contains_reasoning_leak(response_body: &str) -> bool {
    let normalized = response_body.to_ascii_lowercase();

    normalized.contains("reasoning_content")
        || normalized.contains("<think>")
        || normalized.contains("</think>")
        || normalized.contains("\"thinking\"")
        || normalized.contains(" thinking:")
        || normalized.contains("\nthinking:")
        || contains_non_zero_reasoning_tokens(&normalized)
}

fn contains_non_zero_reasoning_tokens(body: &str) -> bool {
    let Some(position) = body.find("reasoning_tokens") else {
        return false;
    };

    let mut started = false;
    let mut digits = String::new();

    for ch in body[position + "reasoning_tokens".len()..].chars() {
        if !started {
            if matches!(ch, ':' | '=') {
                started = true;
            }
            continue;
        }

        if ch.is_ascii_whitespace() || ch == '"' {
            continue;
        }

        if ch.is_ascii_digit() {
            digits.push(ch);
            continue;
        }

        break;
    }

    digits
        .parse::<u64>()
        .map(|value| value > 0)
        .unwrap_or(false)
}

pub fn append_reasoning_off_directive(content: &str) -> String {
    if content.trim_end().ends_with(REASONING_OFF_DIRECTIVE) {
        return content.to_string();
    }

    format!("{content}\n\n{REASONING_OFF_DIRECTIVE}")
}

fn ensure_assistant_prefill_marker(content: &str) -> String {
    if content.starts_with(ASSISTANT_PREFILL_MARKER) {
        return content.to_string();
    }

    format!("{ASSISTANT_PREFILL_MARKER}{content}")
}

pub fn strip_prefill_from_content(content: &str) -> &str {
    content
        .strip_prefix(ASSISTANT_PREFILL_MARKER)
        .unwrap_or(content)
}

pub fn strip_known_hidden_reasoning_markers(
    content: &str,
    strategy: Option<ReasoningStrategy>,
) -> String {
    let mut sanitized = match strategy {
        Some(ReasoningStrategy::AssistantPrefill) => {
            strip_prefill_from_content(content).to_string()
        }
        _ => content.to_string(),
    };

    loop {
        let Some(open_idx) = sanitized.find("<think>") else {
            break;
        };

        let before = &sanitized[..open_idx];
        let after_open = &sanitized[open_idx + "<think>".len()..];

        if let Some(close_idx) = after_open.find("</think>") {
            sanitized = format!("{before}{}", &after_open[close_idx + "</think>".len()..]);
        } else {
            sanitized.truncate(open_idx);
            break;
        }
    }

    sanitized.replace("</think>", "")
}

pub fn normalize_provider_messages_with_strategy(
    messages: &[IpcMessage],
    reasoning_disabled: bool,
    strategy: &ReasoningStrategy,
) -> Vec<ProviderChatMessage> {
    match strategy {
        ReasoningStrategy::StandardFields => {
            normalize_provider_messages(messages, reasoning_disabled)
        }
        ReasoningStrategy::AssistantPrefill => {
            let mut normalized: Vec<ProviderChatMessage> = messages
                .iter()
                .map(|message| {
                    let mut api_message = ApiMessage::from(message);

                    if reasoning_disabled && api_message.role == "assistant" {
                        api_message.content = ensure_assistant_prefill_marker(&api_message.content);
                    }

                    api_message
                })
                .collect();

            if reasoning_disabled {
                normalized.push(ProviderChatMessage {
                    role: "assistant".to_string(),
                    content: ASSISTANT_PREFILL_MARKER.to_string(),
                });
            }

            normalized
        }
        ReasoningStrategy::NoSafeStrategy => messages.iter().map(ApiMessage::from).collect(),
    }
}

pub fn build_probe_request(_system_prompt: &str, _model: &str) -> Vec<ProviderChatMessage> {
    vec![ProviderChatMessage {
        role: "user".to_string(),
        content: "Reply with one word: hello.".to_string(),
    }]
}

pub fn normalize_provider_messages(
    messages: &[IpcMessage],
    reasoning_disabled: bool,
) -> Vec<ApiMessage> {
    messages
        .iter()
        .map(|message| {
            let mut api_message = ApiMessage::from(message);

            if reasoning_disabled && api_message.role == "user" {
                api_message.content = append_reasoning_off_directive(&api_message.content);
            }

            api_message
        })
        .collect()
}
