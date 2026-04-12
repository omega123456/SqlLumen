use serde::{Deserialize, Serialize};

// ── IPC-facing types (frontend ↔ Rust, camelCase) ──────────────────────────

/// A single chat message as received from / sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcMessage {
    pub role: String,
    pub content: String,
}

/// The full chat request as received from the frontend via Tauri invoke.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub messages: Vec<IpcMessage>,
    pub endpoint: String,
    pub model: String,
    pub temperature: f64,
    pub max_tokens: u32,
    pub stream_id: String,
}

// ── API-facing types (Rust → OpenAI HTTP API, snake_case) ──────────────────

/// A single chat message in OpenAI API format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiMessage {
    pub role: String,
    pub content: String,
}

/// The request body sent to the OpenAI-compatible chat completions endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiChatRequest {
    pub model: String,
    pub messages: Vec<ApiMessage>,
    pub temperature: f64,
    pub max_tokens: u32,
    pub stream: bool,
}

/// The delta object inside an SSE stream choice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiStreamDelta {
    pub content: Option<String>,
}

/// A single choice in an SSE stream chunk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiStreamChoice {
    pub delta: ApiStreamDelta,
}

/// A single SSE chunk from the streaming response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiStreamChunk {
    pub choices: Vec<ApiStreamChoice>,
}

// ── Tauri event payload types (camelCase) ──────────────────────────────────

/// Payload emitted for each buffered chunk of streamed tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunkEvent {
    pub stream_id: String,
    pub content: String,
}

/// Payload emitted when the stream completes successfully.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamDoneEvent {
    pub stream_id: String,
}

/// Payload emitted when the stream encounters an error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamErrorEvent {
    pub stream_id: String,
    pub error: String,
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Convert IPC messages to API messages.
impl From<&IpcMessage> for ApiMessage {
    fn from(msg: &IpcMessage) -> Self {
        Self {
            role: msg.role.clone(),
            content: msg.content.clone(),
        }
    }
}

// ── Model listing types ───────────────────────────────────────────────────

/// IPC-facing type for a model entry returned by `list_ai_models`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelInfo {
    pub id: String,
    pub name: Option<String>,
}

/// Response from `list_ai_models` — a list of available models.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelsResponse {
    pub models: Vec<AiModelInfo>,
}

/// A single model entry in the OpenAI `/v1/models` response.
#[derive(Debug, Clone, Deserialize)]
pub struct OpenAiModelEntry {
    pub id: String,
}

/// The outer envelope of the OpenAI `/v1/models` response.
#[derive(Debug, Clone, Deserialize)]
pub struct OpenAiModelsApiResponse {
    pub data: Vec<OpenAiModelEntry>,
}

/// Result of parsing a single SSE line.
#[derive(Debug, Clone, PartialEq)]
pub enum SseParsed {
    /// A data line that was parsed into a stream chunk.
    Chunk(ApiStreamChunk),
    /// The `data: [DONE]` sentinel — stream is finished.
    Done,
    /// An empty line, comment, or `event:` line — skip.
    Skip,
}

/// Parse a single SSE line from the streaming response.
///
/// Returns [`SseParsed::Chunk`] for `data: {...}` lines,
/// [`SseParsed::Done`] for `data: [DONE]`, and [`SseParsed::Skip`]
/// for anything else (empty lines, `event:` lines, etc.).
pub fn parse_sse_line(line: &str) -> Result<SseParsed, String> {
    let trimmed = line.trim();

    // Empty lines
    if trimmed.is_empty() {
        return Ok(SseParsed::Skip);
    }

    // SSE event type lines (e.g., `event: message`)
    if trimmed.starts_with("event:") {
        return Ok(SseParsed::Skip);
    }

    // SSE comment lines
    if trimmed.starts_with(':') {
        return Ok(SseParsed::Skip);
    }

    // Data lines
    if let Some(data) = trimmed.strip_prefix("data:") {
        let data = data.trim();

        if data == "[DONE]" {
            return Ok(SseParsed::Done);
        }

        let chunk: ApiStreamChunk =
            serde_json::from_str(data).map_err(|e| format!("Failed to parse SSE JSON: {e}"))?;
        return Ok(SseParsed::Chunk(chunk));
    }

    // Unknown lines — skip gracefully
    Ok(SseParsed::Skip)
}
