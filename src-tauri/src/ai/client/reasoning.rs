use crate::ai::types::{ApiMessage, ChatTemplateKwargs};

struct ReasoningOffFields {
    effort: &'static str,
    enable_thinking: bool,
    chat_template_kwargs: ChatTemplateKwargs,
}

pub(super) struct ChatReasoningCompat {
    pub(super) enable_thinking: Option<bool>,
    pub(super) chat_template_kwargs: Option<ChatTemplateKwargs>,
}

fn reasoning_off_fields() -> ReasoningOffFields {
    ReasoningOffFields {
        effort: "none",
        enable_thinking: false,
        chat_template_kwargs: ChatTemplateKwargs {
            enable_thinking: false,
        },
    }
}

pub(super) fn chat_reasoning_compat_fields(enable_reasoning: bool) -> ChatReasoningCompat {
    if enable_reasoning {
        return ChatReasoningCompat {
            enable_thinking: None,
            chat_template_kwargs: None,
        };
    }

    let reasoning_off = reasoning_off_fields();
    ChatReasoningCompat {
        enable_thinking: Some(reasoning_off.enable_thinking),
        chat_template_kwargs: Some(reasoning_off.chat_template_kwargs),
    }
}

pub fn apply_reasoning_off_compatibility(body: &mut serde_json::Map<String, serde_json::Value>) {
    let ReasoningOffFields {
        effort,
        enable_thinking,
        ..
    } = reasoning_off_fields();
    body.insert(
        "reasoning_effort".to_string(),
        serde_json::Value::String(effort.to_string()),
    );
    body.insert(
        "enable_thinking".to_string(),
        serde_json::Value::Bool(enable_thinking),
    );
    body.insert(
        "chat_template_kwargs".to_string(),
        serde_json::json!({ "enable_thinking": enable_thinking }),
    );
    apply_no_think_to_json_messages(body);
}

/// Append `/no_think` to content unless it already contains the directive as a
/// standalone whitespace-delimited token.
pub fn append_no_think_directive(content: &str) -> String {
    if content.split_whitespace().any(|token| token == "/no_think") {
        return content.to_string();
    }
    format!("{content}\n\n/no_think")
}

/// Find the last user message in a slice and append the `/no_think` directive.
pub fn apply_no_think_to_last_user_message(messages: &mut [ApiMessage]) {
    if let Some(msg) = messages
        .iter_mut()
        .rev()
        .find(|message| message.role == "user")
    {
        msg.content = append_no_think_directive(&msg.content);
    }
}

/// Apply `/no_think` to the last user message in a JSON body's `messages` array.
///
/// No-op if `messages` is missing, not an array, or has no user message with
/// string content.
pub fn apply_no_think_to_json_messages(body: &mut serde_json::Map<String, serde_json::Value>) {
    let Some(messages) = body
        .get_mut("messages")
        .and_then(|value| value.as_array_mut())
    else {
        return;
    };
    let Some(message) = messages
        .iter_mut()
        .rev()
        .find(|message| is_user_message(message))
    else {
        return;
    };
    let Some(object) = message.as_object_mut() else {
        return;
    };
    let Some(content) = object.get("content").and_then(|content| content.as_str()) else {
        return;
    };
    let updated = append_no_think_directive(content);
    object.insert("content".to_string(), serde_json::Value::String(updated));
}

pub fn should_fallback_from_responses_status(status: reqwest::StatusCode, body: &str) -> bool {
    if matches!(
        status,
        reqwest::StatusCode::NOT_FOUND
            | reqwest::StatusCode::METHOD_NOT_ALLOWED
            | reqwest::StatusCode::NOT_IMPLEMENTED
    ) {
        return true;
    }

    if !matches!(
        status,
        reqwest::StatusCode::BAD_REQUEST
            | reqwest::StatusCode::UNPROCESSABLE_ENTITY
            | reqwest::StatusCode::UNSUPPORTED_MEDIA_TYPE
    ) {
        return false;
    }

    let normalized_body = body.to_ascii_lowercase();
    [
        "previous_response_id",
        "max_output_tokens",
        "unknown parameter",
        "invalid type for 'input'",
        "invalid value for 'input'",
        "invalid type for 'role'",
        "invalid value for 'role'",
        "invalid_union",
        "developer",
        "instructions",
        "messages[0].role",
        "not supported",
        "unrecognized",
        "does not exist",
        "no such endpoint",
        "unknown field `input`",
        "unknown field \"input\"",
        "unknown field `stream`",
        "unknown field `max_output_tokens`",
        "unknown field \"max_output_tokens\"",
        "unknown field `reasoning`",
        "unknown field \"reasoning\"",
        "unknown field `summary`",
        "unknown field \"summary\"",
        "unknown field `effort`",
        "unknown field \"effort\"",
        "reasoning.effort",
        "reasoning.summary",
        "invalid value for 'reasoning'",
        "invalid value for 'reasoning.effort'",
        "invalid value for 'reasoning.summary'",
    ]
    .iter()
    .any(|needle| normalized_body.contains(needle))
}

pub fn should_retry_chat_without_reasoning(status: reqwest::StatusCode, body: &str) -> bool {
    if !matches!(
        status,
        reqwest::StatusCode::BAD_REQUEST
            | reqwest::StatusCode::UNPROCESSABLE_ENTITY
            | reqwest::StatusCode::UNSUPPORTED_MEDIA_TYPE
    ) {
        return false;
    }

    let normalized_body = body.to_ascii_lowercase();
    [
        "reasoning_effort",
        "unknown field `reasoning_effort`",
        "unknown field \"reasoning_effort\"",
        "unknown parameter: reasoning_effort",
        "unknown parameter 'reasoning_effort'",
        "unsupported parameter: reasoning_effort",
        "invalid value for 'reasoning_effort'",
        "reasoning effort",
    ]
    .iter()
    .any(|needle| normalized_body.contains(needle))
}

fn is_user_message(message: &serde_json::Value) -> bool {
    message.get("role").and_then(|role| role.as_str()) == Some("user")
}

pub(super) fn reasoning_effort_level(enable_reasoning: bool) -> &'static str {
    if enable_reasoning {
        return "medium";
    }
    "none"
}
