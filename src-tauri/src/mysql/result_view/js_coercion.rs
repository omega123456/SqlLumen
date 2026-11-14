use super::*;

pub(super) fn finite_compare_number(text: &str) -> Option<f64> {
    if text.is_empty() {
        return None;
    }
    Some(js_string_to_number(text)).filter(|number| number.is_finite())
}

pub fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return format!("{}Infinity", minus_sign(value < 0.0));
    }
    if value == 0.0 {
        return "0".to_string();
    }
    let sign = minus_sign(value < 0.0);
    let sci = format!("{:e}", value.abs());
    let (mantissa, exponent) = sci.split_once('e').unwrap_or((sci.as_str(), "0"));
    let digits: String = mantissa
        .chars()
        .filter(|character| *character != '.')
        .collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let point_position = exponent + 1;
    format!("{sign}{}", js_number_body(&digits, point_position))
}

pub(super) const JS_MAX_FIXED_POINT_POSITION: i32 = 21;
pub(super) const JS_MIN_FIXED_POINT_POSITION: i32 = -6;

pub(super) fn js_number_body(digits: &str, point_position: i32) -> String {
    let digit_count = digits.len() as i32;
    let fits_fixed_notation = point_position <= JS_MAX_FIXED_POINT_POSITION;
    let is_whole_number = digit_count <= point_position && fits_fixed_notation;
    if is_whole_number {
        return format!(
            "{digits}{}",
            "0".repeat((point_position - digit_count) as usize)
        );
    }
    let has_inner_decimal_point = 0 < point_position && fits_fixed_notation;
    if has_inner_decimal_point {
        return format!(
            "{}.{}",
            &digits[..point_position as usize],
            &digits[point_position as usize..]
        );
    }
    let is_small_fraction = JS_MIN_FIXED_POINT_POSITION < point_position && point_position <= 0;
    if is_small_fraction {
        return format!("0.{}{digits}", "0".repeat((-point_position) as usize));
    }
    js_exponential_body(digits, point_position - 1)
}

pub(super) fn js_exponential_body(digits: &str, exponent: i32) -> String {
    let exponent_sign = js_exponent_sign(exponent);
    let exponent_magnitude = exponent.abs();
    let has_single_digit = digits.len() == 1;
    if has_single_digit {
        return format!("{digits}e{exponent_sign}{exponent_magnitude}");
    }
    format!(
        "{}.{}e{exponent_sign}{exponent_magnitude}",
        &digits[..1],
        &digits[1..]
    )
}

pub(super) fn js_exponent_sign(exponent: i32) -> char {
    if exponent < 0 {
        return '-';
    }
    '+'
}

pub(super) fn json_number_as_f64(number: &serde_json::Number) -> f64 {
    if let Some(integer) = number.as_i64() {
        return integer as f64;
    }
    if let Some(unsigned) = number.as_u64() {
        return unsigned as f64;
    }
    number.as_f64().unwrap_or(f64::NAN)
}

pub fn js_string(value: &Value) -> Cow<'_, str> {
    match value {
        Value::Null => Cow::Borrowed("null"),
        Value::Bool(true) => Cow::Borrowed("true"),
        Value::Bool(false) => Cow::Borrowed("false"),
        Value::Number(number) => Cow::Owned(js_number_to_string(json_number_as_f64(number))),
        Value::String(text) => Cow::Borrowed(text.as_str()),
        Value::Array(items) => Cow::Owned(
            items
                .iter()
                .map(|item| match item {
                    Value::Null => Cow::Borrowed(""),
                    other => js_string(other),
                })
                .collect::<Vec<_>>()
                .join(","),
        ),
        Value::Object(_) => Cow::Borrowed("[object Object]"),
    }
}

pub(super) fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

pub(super) const DECIMAL_POINT_BYTES: &[u8] = b".";
pub(super) const EXPONENT_MARKER_BYTES: &[u8] = b"eE";
pub(super) const EXPONENT_SIGN_BYTES: &[u8] = b"+-";

pub(super) fn is_ascii_digit_at(bytes: &[u8], position: usize) -> bool {
    bytes.get(position).is_some_and(u8::is_ascii_digit)
}

pub(super) fn has_any_byte_at(bytes: &[u8], position: usize, expected: &[u8]) -> bool {
    bytes
        .get(position)
        .is_some_and(|byte| expected.contains(byte))
}

pub(super) fn is_js_unsigned_decimal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut position = 0;
    let int_start = position;
    while is_ascii_digit_at(bytes, position) {
        position += 1;
    }
    let mut digits = position - int_start;
    if has_any_byte_at(bytes, position, DECIMAL_POINT_BYTES) {
        position += 1;
        let frac_start = position;
        while is_ascii_digit_at(bytes, position) {
            position += 1;
        }
        digits += position - frac_start;
    }
    if digits == 0 {
        return false;
    }
    if has_any_byte_at(bytes, position, EXPONENT_MARKER_BYTES) {
        position += 1;
        if has_any_byte_at(bytes, position, EXPONENT_SIGN_BYTES) {
            position += 1;
        }
        let exp_start = position;
        while is_ascii_digit_at(bytes, position) {
            position += 1;
        }
        if position == exp_start {
            return false;
        }
    }
    position == bytes.len()
}

pub fn js_string_to_number(text: &str) -> f64 {
    let trimmed = text.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return 0.0;
    }
    let lower_prefix = trimmed.get(..2).map(str::to_ascii_lowercase);
    let radix = match lower_prefix.as_deref() {
        Some("0x") => Some(16),
        Some("0o") => Some(8),
        Some("0b") => Some(2),
        _ => None,
    };
    if let Some(radix) = radix {
        let body = &trimmed[2..];
        let is_radix_literal =
            !body.is_empty() && body.chars().all(|character| character.is_digit(radix));
        if !is_radix_literal {
            return f64::NAN;
        }
        return body.chars().fold(0.0, |acc, character| {
            acc * radix as f64 + character.to_digit(radix).unwrap_or(0) as f64
        });
    }
    let (sign, unsigned) = match trimmed.as_bytes()[0] {
        b'+' => (1.0, &trimmed[1..]),
        b'-' => (-1.0, &trimmed[1..]),
        _ => (1.0, trimmed),
    };
    if unsigned == "Infinity" {
        return sign * f64::INFINITY;
    }
    if !is_js_unsigned_decimal(unsigned) {
        return f64::NAN;
    }
    unsigned
        .parse::<f64>()
        .map(|magnitude| sign * magnitude)
        .unwrap_or(f64::NAN)
}

pub fn js_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(true) => 1.0,
        Value::Bool(false) => 0.0,
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => js_string_to_number(text),
        Value::Array(_) => js_string_to_number(&js_string(value)),
        Value::Object(_) => f64::NAN,
    }
}

pub(super) fn js_string_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

pub fn is_tinyint_boolean_alias(data_type: &str) -> bool {
    matches!(
        data_type.trim().to_ascii_uppercase().as_str(),
        "BOOL" | "BOOLEAN" | "TINYINT" | "TINYINT(1)"
    )
}

pub fn normalize_tinyint_value(value: &Value) -> Cow<'_, Value> {
    match value {
        Value::Bool(boolean) => Cow::Owned(Value::from(u8::from(*boolean))),
        Value::String(text) => {
            let mut chars = text.encode_utf16();
            match (chars.next(), chars.next()) {
                (Some(code @ (0 | 1)), None) => Cow::Owned(Value::from(code)),
                _ => Cow::Borrowed(value),
            }
        }
        _ => Cow::Borrowed(value),
    }
}
