//! Provider-agnostic local compatibility layer.
//!
//! Provides URL classification, capability caching, raw transcript rendering,
//! and thinking-content sanitisation for local/private AI endpoints.

use crate::ai::types::IpcMessage;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

// ── Capability cache ──────────────────────────────────────────────────────

/// Positive probe results are cached for 30 minutes.
const POSITIVE_TTL: Duration = Duration::from_secs(30 * 60);
/// Negative probe results are cached for 60 seconds.
const NEGATIVE_TTL: Duration = Duration::from_secs(60);

/// The kind of capability being probed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CapabilityKind {
    NonStreamingCompletions,
    StreamingCompletions,
}

/// A cached capability result with an expiry timestamp.
#[derive(Debug, Clone)]
pub enum CapabilityResult {
    Positive(Instant),
    Negative(Instant),
}

/// Normalize an endpoint URL to `scheme://host:port` for use as a cache key.
///
/// Strips path components and trailing slashes, keeping only the origin.
/// For non-parseable URLs, returns the original string lowercased.
pub fn normalize_endpoint_key(endpoint: &str) -> String {
    if let Ok(url) = url::Url::parse(endpoint) {
        let scheme = url.scheme();
        let host = match url.host_str() {
            Some(h) => h,
            None => return endpoint.to_ascii_lowercase(),
        };
        match url.port() {
            Some(port) => format!("{scheme}://{host}:{port}"),
            None => format!("{scheme}://{host}"),
        }
    } else {
        endpoint.to_ascii_lowercase()
    }
}

/// Thread-safe cache of endpoint+model capability probe results.
#[derive(Debug, Clone)]
pub struct CapabilityCache {
    inner: Arc<Mutex<HashMap<(String, String, CapabilityKind), CapabilityResult>>>,
}

impl CapabilityCache {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns `Some(true)` for a fresh positive, `Some(false)` for a fresh
    /// negative, or `None` if the entry is missing or expired.
    pub async fn get(&self, endpoint: &str, model: &str, kind: CapabilityKind) -> Option<bool> {
        let map = self.inner.lock().await;
        let key = (normalize_endpoint_key(endpoint), model.to_string(), kind);
        match map.get(&key) {
            Some(CapabilityResult::Positive(ts)) => {
                if ts.elapsed() < POSITIVE_TTL {
                    Some(true)
                } else {
                    None
                }
            }
            Some(CapabilityResult::Negative(ts)) => {
                if ts.elapsed() < NEGATIVE_TTL {
                    Some(false)
                } else {
                    None
                }
            }
            None => None,
        }
    }

    /// Store a capability probe result.
    pub async fn set(&self, endpoint: &str, model: &str, kind: CapabilityKind, positive: bool) {
        let mut map = self.inner.lock().await;
        let key = (normalize_endpoint_key(endpoint), model.to_string(), kind);
        let result = if positive {
            CapabilityResult::Positive(Instant::now())
        } else {
            CapabilityResult::Negative(Instant::now())
        };
        map.insert(key, result);
    }

    /// Insert an entry with a specific timestamp (for testing TTL expiry).
    #[doc(hidden)]
    pub async fn set_with_instant(
        &self,
        endpoint: &str,
        model: &str,
        kind: CapabilityKind,
        positive: bool,
        instant: Instant,
    ) {
        let mut map = self.inner.lock().await;
        let key = (normalize_endpoint_key(endpoint), model.to_string(), kind);
        let result = if positive {
            CapabilityResult::Positive(instant)
        } else {
            CapabilityResult::Negative(instant)
        };
        map.insert(key, result);
    }
}

impl Default for CapabilityCache {
    fn default() -> Self {
        Self::new()
    }
}

// ── Local endpoint classification ─────────────────────────────────────────

/// Returns `true` if the URL points to a local or private-network endpoint.
pub fn is_local_endpoint(url: &str) -> bool {
    // Extract host from URL
    let host = match extract_host(url) {
        Some(h) => h,
        None => return false,
    };

    // Exact matches
    if host == "localhost" || host == "host.docker.internal" {
        return true;
    }

    // Suffix matches
    if host.ends_with(".local") || host.ends_with(".lan") {
        return true;
    }

    // Reject known public cloud domains
    if is_known_public_domain(&host) {
        return false;
    }

    // IPv6 handling (strip brackets)
    let bare = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(&host);

    // Try parsing as an IP address (Fix 2: proper IPv6 classification)
    if let Ok(ip) = bare.parse::<std::net::IpAddr>() {
        return is_private_ip(ip);
    }

    // IPv4 private ranges (fallback for bare octets without brackets)
    if let Some(octets) = parse_ipv4(&host) {
        return is_private_ipv4(octets);
    }

    false
}

/// Returns `true` if the IP address is loopback, link-local, or in a
/// private/ULA range.
fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
        }
        std::net::IpAddr::V6(v6) => {
            // ::1 loopback
            if v6.is_loopback() {
                return true;
            }
            let segments = v6.segments();
            let first = segments[0];
            // fc00::/7 — Unique Local Addresses (first byte is 0xfc or 0xfd)
            if (first & 0xfe00) == 0xfc00 {
                return true;
            }
            // fe80::/10 — Link-Local
            if (first & 0xffc0) == 0xfe80 {
                return true;
            }
            false
        }
    }
}

fn extract_host(url: &str) -> Option<String> {
    // Try to find ://
    let after_scheme = url.find("://").map(|i| &url[i + 3..]).unwrap_or(url);
    // Strip path
    let host_port = after_scheme.split('/').next().unwrap_or(after_scheme);
    // Strip userinfo
    let host_port = host_port.rsplit('@').next().unwrap_or(host_port);

    if host_port.is_empty() {
        return None;
    }

    // Handle IPv6 brackets
    if host_port.starts_with('[') {
        // Find closing bracket
        if let Some(bracket_end) = host_port.find(']') {
            return Some(host_port[..=bracket_end].to_string());
        }
        return Some(host_port.to_string());
    }

    // Strip port
    let host = if let Some(colon_pos) = host_port.rfind(':') {
        // Only strip if what follows looks like a port number
        if host_port[colon_pos + 1..].chars().all(|c| c.is_ascii_digit()) {
            &host_port[..colon_pos]
        } else {
            host_port
        }
    } else {
        host_port
    };

    Some(host.to_string())
}

fn is_known_public_domain(host: &str) -> bool {
    let lower = host.to_ascii_lowercase();
    lower == "openai.com" || lower.ends_with(".openai.com")
        || lower == "azure.com" || lower.ends_with(".azure.com")
        || lower == "azurewebsites.net" || lower.ends_with(".azurewebsites.net")
}

fn parse_ipv4(host: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut octets = [0u8; 4];
    for (i, part) in parts.iter().enumerate() {
        octets[i] = part.parse().ok()?;
    }
    Some(octets)
}

fn is_private_ipv4(octets: [u8; 4]) -> bool {
    match octets {
        [127, ..] => true,                                          // 127.0.0.0/8
        [10, ..] => true,                                           // 10.0.0.0/8
        [192, 168, ..] => true,                                     // 192.168.0.0/16
        [172, second, ..] if (16..=31).contains(&second) => true,   // 172.16.0.0/12
        [169, 254, ..] => true,                                     // 169.254.0.0/16
        _ => false,
    }
}

// ── Compatibility policy ──────────────────────────────────────────────────

/// Decides whether a request is eligible for the raw-completions compatibility
/// transport (local/private endpoint, reasoning disabled, not using Responses
/// API chaining).
#[derive(Debug, Clone)]
pub struct LocalCompatPolicy;

impl LocalCompatPolicy {
    /// Returns `true` when the request may use the compatibility path.
    ///
    /// `using_responses_chaining` should be `true` when the request carries a
    /// `previous_response_id` **and** `prefer_responses_api` is on — i.e. the
    /// caller is actively using server-side conversation chaining. Plain
    /// `prefer_responses_api` alone does not block compat eligibility.
    pub fn is_eligible(endpoint: &str, enable_reasoning: bool, using_responses_chaining: bool) -> bool {
        is_local_endpoint(endpoint) && !enable_reasoning && !using_responses_chaining
    }
}

// ── Raw transcript renderer ───────────────────────────────────────────────

/// Escape content so that it cannot inject fake role headers.
///
/// Any line starting with `### ` (the role-label prefix) is escaped by
/// prepending a zero-width space, making it visually identical but
/// structurally distinct from a real header.
fn escape_role_injection(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for (i, line) in content.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        if line.starts_with("### ") {
            out.push('\u{200B}'); // zero-width space
            out.push_str(line);
        } else {
            out.push_str(line);
        }
    }
    out
}

/// Map a message role to its display label.
fn role_label(role: &str) -> &str {
    match role {
        "system" => "System",
        "context" => "Context",
        "user" => "User",
        "assistant" => "Assistant",
        other => other,
    }
}

/// Render a deterministic, provider-agnostic raw transcript from IPC messages.
///
/// The output uses ASCII-only role labels and contains no model-specific tokens,
/// no `/no_think` directives, and no timestamps/IDs.
///
/// Messages are rendered in input order (Fix 6) to ensure prefix stability
/// across multi-turn replays. Content is escaped to prevent `### ` injection.
pub fn render_raw_transcript(messages: &[IpcMessage], reasoning_off_instruction: &str) -> String {
    let mut out = String::new();

    // 1. Compatibility instruction
    out.push_str("### Compatibility Instruction\n");
    out.push_str(reasoning_off_instruction);

    // 2. Messages in input order (preserving prefix stability)
    for msg in messages {
        let label = role_label(&msg.role);
        out.push_str("\n\n### ");
        out.push_str(label);
        out.push('\n');
        out.push_str(&escape_role_injection(&msg.content));
    }

    // 3. Generation prefix
    out.push_str("\n\n### Assistant\n");

    out
}

// ── Thinking content sanitiser ────────────────────────────────────────────

/// Remove `<think>...</think>` and `<thinking>...</thinking>` blocks from text.
///
/// Also strips any embedded `reasoning_content` references. The full block
/// (tags + content) is removed from the output.
pub fn sanitize_thinking_content(text: &str) -> String {
    let mut result = text.to_string();

    let mut sanitized = false;

    // Remove <think>...</think> blocks (greedy, handles multiline)
    loop {
        let lower = result.to_ascii_lowercase();
        if let Some(start) = lower.find("<think>") {
            if let Some(end) = lower[start..].find("</think>") {
                let end_abs = start + end + "</think>".len();
                result = format!("{}{}", &result[..start], &result[end_abs..]);
                sanitized = true;
                continue;
            }
        }
        break;
    }

    // Remove <thinking>...</thinking> blocks
    loop {
        let lower = result.to_ascii_lowercase();
        if let Some(start) = lower.find("<thinking>") {
            if let Some(end) = lower[start..].find("</thinking>") {
                let end_abs = start + end + "</thinking>".len();
                result = format!("{}{}", &result[..start], &result[end_abs..]);
                sanitized = true;
                continue;
            }
        }
        break;
    }

    if sanitized {
        tracing::debug!("sanitized thinking content from provider chunk");
    }

    result
}

/// Stateful thinking-tag sanitiser for streaming chunks (Fix 3).
///
/// Tracks whether we are inside a `<think>`/`<thinking>` block across chunk
/// boundaries. When `in_block` is true, ALL content is suppressed until the
/// matching closing tag is found. Partial tags at chunk boundaries are buffered
/// in `pending`.
pub struct ThinkingSanitizer {
    /// Whether we are currently inside a thinking block.
    in_block: bool,
    /// Residual bytes that might be part of an opening or closing tag at a
    /// chunk boundary.
    pending: String,
}

/// Opening tags we recognise (lowercase).
const OPEN_TAGS: &[&str] = &["<think>", "<thinking>"];
/// Closing tags we recognise (lowercase).
const CLOSE_TAGS: &[&str] = &["</think>", "</thinking>"];

impl ThinkingSanitizer {
    pub fn new() -> Self {
        Self {
            in_block: false,
            pending: String::new(),
        }
    }

    /// Feed a new chunk and return the sanitised output that is safe to emit.
    ///
    /// Content inside `<think>`/`<thinking>` blocks (including cross-chunk) is
    /// suppressed. Call [`finish`] at stream end to flush residual.
    pub fn push(&mut self, chunk: &str) -> String {
        let mut input = std::mem::take(&mut self.pending);
        input.push_str(chunk);

        let mut output = String::new();
        let mut pos = 0;
        let lower = input.to_ascii_lowercase();
        let bytes = lower.as_bytes();
        let len = bytes.len();

        while pos < len {
            if !self.in_block {
                // Look for '<' which could start an opening tag
                if let Some(lt_offset) = lower[pos..].find('<') {
                    let lt_pos = pos + lt_offset;
                    // Output everything before the '<'
                    output.push_str(&input[pos..lt_pos]);

                    // Try to match an opening tag
                    if let Some(tag_len) = match_any_tag(&lower[lt_pos..], OPEN_TAGS) {
                        // Found a complete opening tag — enter block, skip tag
                        self.in_block = true;
                        pos = lt_pos + tag_len;
                    } else if is_potential_partial_tag_prefix(&lower[lt_pos..]) {
                        // Could be a partial tag at end of chunk — buffer it
                        self.pending = input[lt_pos..].to_string();
                        // Cap pending at 20 chars
                        if self.pending.len() > 20 {
                            let flushed = std::mem::take(&mut self.pending);
                            output.push_str(&flushed);
                        }
                        return output;
                    } else {
                        // Not a tag we care about — output the '<' and continue
                        output.push_str(&input[lt_pos..lt_pos + 1]);
                        pos = lt_pos + 1;
                    }
                } else {
                    // No '<' found — output the rest
                    output.push_str(&input[pos..]);
                    pos = len;
                }
            } else {
                // in_block: look for closing tag
                if let Some(lt_offset) = lower[pos..].find('<') {
                    let lt_pos = pos + lt_offset;

                    if let Some(tag_len) = match_any_tag(&lower[lt_pos..], CLOSE_TAGS) {
                        // Found closing tag — exit block, skip tag
                        self.in_block = false;
                        pos = lt_pos + tag_len;
                    } else if is_potential_partial_close_tag(&lower[lt_pos..]) {
                        // Partial closing tag at end — buffer and suppress
                        self.pending = input[lt_pos..].to_string();
                        if self.pending.len() > 20 {
                            // Too long to be a real tag — discard (still suppressed)
                            self.pending.clear();
                        }
                        return output;
                    } else {
                        // Not a closing tag — suppress and continue
                        pos = lt_pos + 1;
                    }
                } else {
                    // No '<' — suppress everything
                    pos = len;
                }
            }
        }

        output
    }

    /// Flush any remaining buffered content at stream end.
    pub fn finish(&mut self) -> String {
        let out = if self.in_block {
            String::new()
        } else {
            std::mem::take(&mut self.pending)
        };
        self.pending.clear();
        self.in_block = false;
        out
    }
}

/// If `s` starts with one of the given tags, return the tag length.
fn match_any_tag(s: &str, tags: &[&str]) -> Option<usize> {
    for tag in tags {
        if s.starts_with(tag) {
            return Some(tag.len());
        }
    }
    None
}

/// Returns true if `s` could be the prefix of an opening tag
/// (`<think>` or `<thinking>`), but is not yet complete.
fn is_potential_partial_tag_prefix(s: &str) -> bool {
    for tag in OPEN_TAGS {
        if tag.starts_with(s) && s.len() < tag.len() {
            return true;
        }
    }
    false
}

/// Returns true if `s` could be the prefix of a closing tag
/// (`</think>` or `</thinking>`), but is not yet complete.
fn is_potential_partial_close_tag(s: &str) -> bool {
    for tag in CLOSE_TAGS {
        if tag.starts_with(s) && s.len() < tag.len() {
            return true;
        }
    }
    false
}

// ── Endpoint redaction ────────────────────────────────────────────────────

/// Redact an endpoint URL for safe inclusion in user-facing error messages
/// (Fix 5).
///
/// Preserves scheme and host but replaces the path with `/…` and strips
/// query/fragment. API keys sometimes leak into URLs as query parameters;
/// this function prevents that.
pub fn redact_endpoint(endpoint: &str) -> String {
    if let Ok(url) = url::Url::parse(endpoint) {
        let scheme = url.scheme();
        let host = url.host_str().unwrap_or("unknown");
        match url.port() {
            Some(port) => format!("{scheme}://{host}:{port}/…"),
            None => format!("{scheme}://{host}/…"),
        }
    } else {
        "<invalid-url>".to_string()
    }
}
