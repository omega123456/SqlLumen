use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub messages: Vec<IpcMessage>,
    pub endpoint: String,
    pub model: String,
    pub temperature: f64,
    pub max_tokens: u32,
    pub stream_id: String,
    #[serde(default)]
    pub previous_response_id: Option<String>,
    #[serde(default)]
    pub prefer_responses_api: bool,
    #[serde(default = "default_true")]
    pub enable_reasoning: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiChatRequest {
    pub model: String,
    pub messages: Vec<ApiMessage>,
    pub temperature: f64,
    pub max_tokens: u32,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_thinking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_template_kwargs: Option<ChatTemplateKwargs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ChatTemplateKwargs {
    pub enable_thinking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ResponsesInputItem {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningConfig {
    pub effort: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiResponsesRequest {
    pub model: String,
    pub input: Vec<ResponsesInputItem>,
    pub temperature: f64,
    pub max_output_tokens: u32,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_response_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<ReasoningConfig>,
    #[serde(skip)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiStreamDelta {
    pub content: Option<String>,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiStreamChoice {
    pub delta: ApiStreamDelta,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApiStreamChunk {
    pub choices: Vec<ApiStreamChoice>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ChunkKind {
    #[default]
    Content,
    Thinking,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunkEvent {
    pub stream_id: String,
    pub content: String,
    #[serde(default)]
    pub kind: ChunkKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamDoneEvent {
    pub stream_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_id: Option<String>,
    pub transport: AiTransport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamErrorEvent {
    pub stream_id: String,
    pub error: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiTransport {
    ChatCompletions,
    Responses,
}

impl From<&IpcMessage> for ApiMessage {
    fn from(msg: &IpcMessage) -> Self {
        Self {
            role: msg.role.clone(),
            content: msg.content.clone(),
        }
    }
}

impl From<&IpcMessage> for ResponsesInputItem {
    fn from(msg: &IpcMessage) -> Self {
        Self {
            role: msg.role.clone(),
            content: msg.content.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelInfo {
    pub id: String,
    pub name: Option<String>,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelsResponse {
    pub models: Vec<AiModelInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpenAiModelEntry {
    pub id: String,
    #[serde(default)]
    pub object: String,
    #[serde(rename = "type", default)]
    pub model_type: Option<String>,
    #[serde(default)]
    pub capabilities: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpenAiModelsApiResponse {
    pub data: Vec<OpenAiModelEntry>,
}

#[derive(Debug, Serialize)]
pub struct EmbeddingApiRequest {
    pub model: String,
    pub input: Vec<String>,
    pub truncate: bool,
    pub encoding_format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimensions: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct EmbeddingApiResponse {
    pub data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
pub struct EmbeddingData {
    pub embedding: Vec<f32>,
    pub index: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueryExpandRequest {
    pub endpoint: String,
    pub model: String,
    pub system_prompt: String,
    pub user_message: String,
    #[serde(default)]
    pub conversation_context: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueryExpandResponse {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SseParsed {
    Chunk(ApiStreamChunk),
    Done,
    Skip,
}

pub fn parse_sse_line(line: &str) -> Result<SseParsed, String> {
    let trimmed = line.trim();

    if trimmed.is_empty() {
        return Ok(SseParsed::Skip);
    }

    if trimmed.starts_with("event:") {
        return Ok(SseParsed::Skip);
    }

    if trimmed.starts_with(':') {
        return Ok(SseParsed::Skip);
    }

    if let Some(data) = trimmed.strip_prefix("data:") {
        let data = data.trim();

        if data == "[DONE]" {
            return Ok(SseParsed::Done);
        }

        let chunk: ApiStreamChunk = serde_json::from_str(data)
            .map_err(|error| format!("Failed to parse SSE JSON: {error}"))?;
        return Ok(SseParsed::Chunk(chunk));
    }

    Ok(SseParsed::Skip)
}
