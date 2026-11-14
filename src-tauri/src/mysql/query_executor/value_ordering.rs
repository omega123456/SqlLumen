pub fn compare_json_values(
    left: &serde_json::Value,
    right: &serde_json::Value,
) -> std::cmp::Ordering {
    use serde_json::Value;
    use std::cmp::Ordering;

    match (left, right) {
        (Value::Null, Value::Null) => Ordering::Equal,
        (Value::Null, _) => Ordering::Greater,
        (_, Value::Null) => Ordering::Less,

        (Value::Number(na), Value::Number(nb)) => {
            let fa = na.as_f64().unwrap_or(0.0);
            let fb = nb.as_f64().unwrap_or(0.0);
            fa.partial_cmp(&fb).unwrap_or(Ordering::Equal)
        }

        (Value::String(sa), Value::String(sb)) => sa.cmp(sb),

        _ => {
            let sa = left.to_string();
            let sb = right.to_string();
            sa.cmp(&sb)
        }
    }
}
