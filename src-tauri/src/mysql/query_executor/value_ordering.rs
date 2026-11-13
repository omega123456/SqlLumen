/// Compare two `serde_json::Value` items for sorting purposes.
///
/// - `Null` sorts **after** all non-null values (for ascending order;
///   callers reverse the result for descending).
/// - Two `Number` values are compared as f64.
/// - Two `String` values are compared lexicographically.
/// - Mixed types (or booleans / arrays / objects) fall back to `to_string()` comparison.
pub fn compare_json_values(
    left: &serde_json::Value,
    right: &serde_json::Value,
) -> std::cmp::Ordering {
    use serde_json::Value;
    use std::cmp::Ordering;

    match (left, right) {
        (Value::Null, Value::Null) => Ordering::Equal,
        (Value::Null, _) => Ordering::Greater, // NULLs sort LAST in ASC
        (_, Value::Null) => Ordering::Less,

        (Value::Number(na), Value::Number(nb)) => {
            let fa = na.as_f64().unwrap_or(0.0);
            let fb = nb.as_f64().unwrap_or(0.0);
            fa.partial_cmp(&fb).unwrap_or(Ordering::Equal)
        }

        (Value::String(sa), Value::String(sb)) => sa.cmp(sb),

        // Mixed types: compare as strings
        _ => {
            let sa = left.to_string();
            let sb = right.to_string();
            sa.cmp(&sb)
        }
    }
}
