pub fn extract_responses_error_message(json: &serde_json::Value) -> Option<String> {
    if let Some(message) = json.get("error").and_then(|error| {
        error
            .get("message")
            .and_then(|message| message.as_str())
            .or_else(|| error.as_str())
    }) {
        return Some(message.to_string());
    }

    json.get("message")
        .and_then(|message| message.as_str())
        .map(ToString::to_string)
}

pub fn extract_responses_delta_text(json: &serde_json::Value) -> String {
    json.get("delta")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .unwrap_or_default()
}

const REASONING_PART_TYPES: [&str; 2] = ["summary_text", "reasoning_text"];
const REASONING_CONTENT_PART_TYPES: [&str; 3] = ["summary_text", "reasoning_text", "text"];
const VISIBLE_TEXT_PART_TYPES: [&str; 2] = ["output_text", "text"];

fn allowed_part_text<'a>(part: &'a serde_json::Value, allowed_types: &[&str]) -> Option<&'a str> {
    let part_type = part.get("type").and_then(|value| value.as_str())?;
    if !allowed_types.contains(&part_type) {
        return None;
    }
    part.get("text").and_then(|value| value.as_str())
}

fn array_items(value: Option<&serde_json::Value>) -> &[serde_json::Value] {
    value
        .and_then(|value| value.as_array())
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn text_field(value: &serde_json::Value) -> Option<&str> {
    value.get("text").and_then(|text| text.as_str())
}

pub fn extract_reasoning_text_from_parts(parts: &[serde_json::Value]) -> String {
    parts
        .iter()
        .filter_map(|part| allowed_part_text(part, &REASONING_PART_TYPES))
        .collect()
}

fn is_reasoning_item(item: &serde_json::Value) -> bool {
    item.get("type").and_then(|value| value.as_str()) == Some("reasoning")
}

pub fn extract_reasoning_text_from_item(item: &serde_json::Value) -> String {
    if !is_reasoning_item(item) {
        return String::new();
    }
    let summary_text = extract_reasoning_text_from_parts(array_items(item.get("summary")));
    let content_text: String = array_items(item.get("content"))
        .iter()
        .filter_map(|part| allowed_part_text(part, &REASONING_CONTENT_PART_TYPES))
        .collect();
    summary_text + &content_text
}

fn reasoning_text_from_items(items: &[serde_json::Value]) -> String {
    items.iter().map(extract_reasoning_text_from_item).collect()
}

pub fn extract_responses_reasoning_text(json: &serde_json::Value) -> String {
    let mut text = String::new();
    text.push_str(
        json.get("delta")
            .and_then(|value| value.as_str())
            .unwrap_or_default(),
    );
    let part_text = json
        .get("part")
        .and_then(|part| allowed_part_text(part, &REASONING_PART_TYPES));
    text.push_str(part_text.unwrap_or_default());
    if let Some(item) = json.get("item") {
        text.push_str(&extract_reasoning_text_from_item(item));
    }
    text.push_str(&reasoning_text_from_items(array_items(json.get("output"))));
    let response_output = json
        .get("response")
        .and_then(|response| response.get("output"));
    text.push_str(&reasoning_text_from_items(array_items(response_output)));
    text
}

fn should_treat_content_part_as_visible_text(json: &serde_json::Value) -> bool {
    json.get("item_id")
        .and_then(|value| value.as_str())
        .map(|item_id| !item_id.starts_with("rs_"))
        .unwrap_or(true)
}

fn extract_text_from_response_part(part: &serde_json::Value, allowed_types: &[&str]) -> String {
    allowed_part_text(part, allowed_types)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn message_part_text(part: &serde_json::Value) -> String {
    match part.as_str() {
        Some(value) => value.to_string(),
        None => extract_text_from_response_part(part, &VISIBLE_TEXT_PART_TYPES),
    }
}

fn extract_text_from_message_item(item: &serde_json::Value) -> String {
    if is_reasoning_item(item) {
        return String::new();
    }
    array_items(item.get("content"))
        .iter()
        .map(message_part_text)
        .collect()
}

pub fn extract_responses_reasoning_text_for_event(
    event_type: Option<&str>,
    json: &serde_json::Value,
    already_streamed_reasoning: bool,
) -> String {
    match event_type {
        Some("response.reasoning_summary_text.delta") | Some("response.reasoning_text.delta") => {
            extract_responses_delta_text(json)
        }
        Some("response.reasoning_summary_text.done") | Some("response.reasoning_text.done")
            if already_streamed_reasoning =>
        {
            String::new()
        }
        Some("response.reasoning_summary_text.done") | Some("response.reasoning_text.done") => json
            .get("text")
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| extract_responses_reasoning_text(json)),
        Some("response.reasoning_summary_part.added") | Some("response.content_part.added") => json
            .get("part")
            .map(|part| extract_text_from_response_part(part, &REASONING_PART_TYPES))
            .unwrap_or_default(),
        Some("response.reasoning_summary_part.done")
        | Some("response.content_part.done")
        | Some("response.output_item.done")
        | Some("response.completed")
            if !already_streamed_reasoning =>
        {
            extract_responses_reasoning_text(json)
        }
        _ => String::new(),
    }
}

pub fn extract_responses_content_text_for_event(
    event_type: Option<&str>,
    json: &serde_json::Value,
    already_streamed_output: bool,
) -> String {
    let is_unstreamed_visible_part =
        !already_streamed_output && should_treat_content_part_as_visible_text(json);
    match event_type {
        Some("response.output_text.delta") => extract_responses_delta_text(json),
        Some("response.content_part.added") if should_treat_content_part_as_visible_text(json) => {
            json.get("part")
                .map(|part| extract_text_from_response_part(part, &VISIBLE_TEXT_PART_TYPES))
                .unwrap_or_default()
        }
        Some("response.output_text.done") if !already_streamed_output => json
            .get("text")
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
            .unwrap_or_default(),
        Some("response.content_part.done") if is_unstreamed_visible_part => json
            .get("part")
            .map(|part| extract_text_from_response_part(part, &VISIBLE_TEXT_PART_TYPES))
            .unwrap_or_default(),
        Some("response.output_item.done") if !already_streamed_output => json
            .get("item")
            .map(extract_text_from_message_item)
            .unwrap_or_default(),
        Some("response.completed") if !already_streamed_output => {
            extract_responses_final_text(json)
        }
        _ => String::new(),
    }
}

fn content_field_text(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(value)) => value.clone(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.as_str().or_else(|| text_field(part)))
            .collect(),
        _ => String::new(),
    }
}

fn message_output_text(items: &[serde_json::Value]) -> String {
    items
        .iter()
        .filter(|item| !is_reasoning_item(item))
        .flat_map(|item| array_items(item.get("content")))
        .filter_map(text_field)
        .collect()
}

pub fn extract_responses_final_text(json: &serde_json::Value) -> String {
    let mut text = content_field_text(json.get("content"));
    text.push_str(text_field(json).unwrap_or_default());
    let response_output = json
        .get("response")
        .and_then(|response| response.get("output"));
    text.push_str(&message_output_text(array_items(response_output)));
    text.push_str(&message_output_text(array_items(json.get("output"))));
    text
}

pub fn is_responses_completion_event(event_type: Option<&str>) -> bool {
    matches!(
        event_type,
        Some("response.completed")
            | Some("response.output_text.done")
            | Some("response.output_text.delta")
            | Some("response.created")
            | Some("response.reasoning_summary_text.delta")
            | Some("response.reasoning_summary_text.done")
            | Some("response.reasoning_summary_part.added")
            | Some("response.reasoning_summary_part.done")
            | Some("response.reasoning_text.delta")
            | Some("response.reasoning_text.done")
            | Some("response.output_item.added")
            | Some("response.output_item.done")
            | Some("response.content_part.added")
            | Some("response.content_part.done")
    )
}

pub fn is_responses_failure_event(event_type: Option<&str>) -> bool {
    matches!(event_type, Some("response.failed") | Some("error"))
}

pub fn merge_responses_event_type<'a>(
    sse_event_type: Option<&'a str>,
    json: &'a serde_json::Value,
) -> Option<&'a str> {
    sse_event_type.or_else(|| json.get("type").and_then(|value| value.as_str()))
}

pub fn is_chat_completions_style_payload(json: &serde_json::Value) -> bool {
    json.get("choices")
        .and_then(|choices| choices.as_array())
        .is_some_and(|choices| !choices.is_empty())
}

pub(super) fn responses_event_response_id(json: &serde_json::Value) -> Option<&str> {
    let nested_response_id = json
        .get("response")
        .and_then(|response| response.get("id"))
        .and_then(|value| value.as_str());
    if let Some(id) = nested_response_id {
        return Some(id);
    }
    if let Some(id) = json.get("response_id").and_then(|value| value.as_str()) {
        return Some(id);
    }
    json.get("id")
        .and_then(|value| value.as_str())
        .filter(|id| id.starts_with("resp_"))
}
