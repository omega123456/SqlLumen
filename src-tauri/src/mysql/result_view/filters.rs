use super::*;

#[derive(Debug, Clone, Copy)]
pub(super) enum CompareOp {
    Gt,
    Ge,
    Lt,
    Le,
}

impl CompareOp {
    pub(super) fn holds(self, ordering: Ordering) -> bool {
        match self {
            Self::Gt => ordering == Ordering::Greater,
            Self::Ge => ordering != Ordering::Less,
            Self::Lt => ordering == Ordering::Less,
            Self::Le => ordering != Ordering::Greater,
        }
    }

    pub(super) fn holds_f64(self, left: f64, right: f64) -> bool {
        match self {
            Self::Gt => left > right,
            Self::Ge => left >= right,
            Self::Lt => left < right,
            Self::Le => left <= right,
        }
    }
}

#[derive(Debug)]
pub(super) enum FilterTest {
    IsNull,
    IsNotNull,
    Equals(String),
    NotEquals(String),
    Compare {
        op: CompareOp,
        text: String,
        number: Option<f64>,
    },
    Like {
        regex: Regex,
        negate: bool,
    },
}

pub(super) struct CompareTarget<'a> {
    pub(super) text: &'a str,
    pub(super) number: Option<f64>,
}

pub(super) fn compare_cell(cell: &Value, op: CompareOp, target: CompareTarget<'_>) -> bool {
    if cell.is_null() {
        return false;
    }
    let left = js_number(cell);
    let numeric_right = target.number.filter(|_| left.is_finite());
    if let Some(right) = numeric_right {
        return op.holds_f64(left, right);
    }
    op.holds(js_string_cmp(&js_string(cell), target.text))
}

#[derive(Debug)]
pub struct CompiledFilter {
    pub(super) column: usize,
    pub(super) tinyint: bool,
    pub(super) test: FilterTest,
}

impl CompiledFilter {
    pub(super) fn comparable_cell<'a>(&self, raw: &'a Value) -> Cow<'a, Value> {
        if self.tinyint {
            return normalize_tinyint_value(raw);
        }
        Cow::Borrowed(raw)
    }

    pub fn matches(&self, row: &[Value]) -> bool {
        let raw = row.get(self.column).unwrap_or(&Value::Null);
        let cell = self.comparable_cell(raw);
        let cell = cell.as_ref();
        match &self.test {
            FilterTest::IsNull => cell.is_null(),
            FilterTest::IsNotNull => !cell.is_null(),
            FilterTest::Equals(value) => js_string(cell) == value.as_str(),
            FilterTest::NotEquals(value) => js_string(cell) != value.as_str(),
            FilterTest::Compare { op, text, number } => {
                let target = CompareTarget {
                    text,
                    number: *number,
                };
                compare_cell(cell, *op, target)
            }
            FilterTest::Like { regex, negate } => regex.is_match(&js_string(cell)) != *negate,
        }
    }
}

pub fn like_pattern_to_regex(pattern: &str) -> Result<Regex, String> {
    let mut source = String::from("(?is)^");
    for ch in pattern.chars() {
        match ch {
            '%' => source.push_str(".*"),
            '_' => source.push('.'),
            other => source.push_str(&regex::escape(other.encode_utf8(&mut [0; 4]))),
        }
    }
    source.push('$');
    Regex::new(&source).map_err(|error| format!("Invalid LIKE pattern: {error}"))
}

pub(super) fn compile_filter(
    condition: &ViewFilterCondition,
    column: usize,
    columns: &[ColumnMeta],
) -> Result<CompiledFilter, String> {
    let test = match condition.operator.as_str() {
        "IS NULL" => FilterTest::IsNull,
        "IS NOT NULL" => FilterTest::IsNotNull,
        "==" => FilterTest::Equals(condition.value.clone()),
        "!=" => FilterTest::NotEquals(condition.value.clone()),
        ">" | ">=" | "<" | "<=" => {
            let op = match condition.operator.as_str() {
                ">" => CompareOp::Gt,
                ">=" => CompareOp::Ge,
                "<" => CompareOp::Lt,
                _ => CompareOp::Le,
            };
            let number = finite_compare_number(&condition.value);
            FilterTest::Compare {
                op,
                text: condition.value.clone(),
                number,
            }
        }
        "LIKE" | "NOT LIKE" => FilterTest::Like {
            regex: like_pattern_to_regex(&condition.value)?,
            negate: condition.operator == "NOT LIKE",
        },
        other => return Err(format!("Unsupported filter operator '{other}'")),
    };
    Ok(CompiledFilter {
        column,
        tinyint: is_tinyint_boolean_alias(&columns[column].data_type),
        test,
    })
}
