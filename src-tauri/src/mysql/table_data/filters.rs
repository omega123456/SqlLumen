use super::*;

#[derive(Clone, Copy)]
pub(super) enum FilterOp {
    Comparison(&'static str),
    Like,
    NotLike,
    IsNull,
    IsNotNull,
}

impl FilterOp {
    fn binds_value(self) -> bool {
        !matches!(self, Self::IsNull | Self::IsNotNull)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ColumnFilterKind {
    TextLike,
    NonText,
}

pub(super) const TEXT_LIKE_TYPE_FRAGMENTS: [&str; 4] = ["CHAR", "TEXT", "ENUM", "SET"];

pub(super) fn classify_column_filter_kind(data_type: &str) -> ColumnFilterKind {
    let upper = data_type.to_uppercase();

    if is_binary_data_type(&upper) {
        return ColumnFilterKind::NonText;
    }

    let is_text_like = TEXT_LIKE_TYPE_FRAGMENTS
        .iter()
        .any(|fragment| upper.contains(fragment));
    if is_text_like {
        return ColumnFilterKind::TextLike;
    }

    ColumnFilterKind::NonText
}

#[cfg(not(coverage))]
pub(super) fn is_boolean_alias_column(data_type: &str, column_type: &str) -> bool {
    let normalized_data_type = data_type.trim().to_uppercase();
    let normalized_column_type = column_type.trim().to_uppercase();

    normalized_data_type == "BOOL"
        || normalized_data_type == "BOOLEAN"
        || (normalized_data_type == "TINYINT" && normalized_column_type.starts_with("TINYINT(1)"))
}

pub(super) fn get_filter_op(operator: &str) -> Option<FilterOp> {
    match operator {
        ">" => Some(FilterOp::Comparison(">")),
        ">=" => Some(FilterOp::Comparison(">=")),
        "<" => Some(FilterOp::Comparison("<")),
        "<=" => Some(FilterOp::Comparison("<=")),
        "==" => Some(FilterOp::Comparison("=")),
        "!=" => Some(FilterOp::Comparison("!=")),
        "LIKE" => Some(FilterOp::Like),
        "NOT LIKE" => Some(FilterOp::NotLike),
        "IS NULL" => Some(FilterOp::IsNull),
        "IS NOT NULL" => Some(FilterOp::IsNotNull),
        _ => None,
    }
}

pub(super) fn is_null_filter_sql(safe_col: &str, column_kind: ColumnFilterKind) -> String {
    if column_kind == ColumnFilterKind::TextLike {
        return format!("({safe_col} IS NULL OR {safe_col} = '')");
    }
    format!("{safe_col} IS NULL")
}

pub(super) fn is_not_null_filter_sql(safe_col: &str, column_kind: ColumnFilterKind) -> String {
    if column_kind == ColumnFilterKind::TextLike {
        return format!("({safe_col} IS NOT NULL AND {safe_col} != '')");
    }
    format!("{safe_col} IS NOT NULL")
}

pub(super) fn filter_condition_sql(
    safe_col: &str,
    op: FilterOp,
    column_kind: ColumnFilterKind,
) -> String {
    match op {
        FilterOp::Comparison(sql_op) => format!("{safe_col} {sql_op} ?"),
        FilterOp::Like => format!("{safe_col} LIKE ?"),
        FilterOp::NotLike => format!("{safe_col} NOT LIKE ?"),
        FilterOp::IsNull => is_null_filter_sql(safe_col, column_kind),
        FilterOp::IsNotNull => is_not_null_filter_sql(safe_col, column_kind),
    }
}

pub(super) fn translate_filter_conditions(
    conditions: &[FilterCondition],
    column_kind_of: impl Fn(&str) -> ColumnFilterKind,
) -> FilterClause {
    let mut sql_parts = Vec::new();
    let mut params = Vec::new();

    for entry in conditions {
        let Ok(safe_col) = safe_identifier(&entry.column) else {
            continue;
        };
        let Some(op) = get_filter_op(&entry.operator) else {
            continue;
        };
        if op.binds_value() {
            params.push(serde_json::Value::String(entry.value.clone()));
        }
        let column_kind = column_kind_of(&entry.column);
        sql_parts.push(filter_condition_sql(&safe_col, op, column_kind));
    }

    FilterClause {
        sql: sql_parts.join(" AND "),
        params,
    }
}

pub fn translate_filter_model(conditions: &[FilterCondition]) -> FilterClause {
    translate_filter_conditions(conditions, |_| ColumnFilterKind::TextLike)
}

pub fn translate_filter_model_with_columns(
    conditions: &[FilterCondition],
    columns: &[TableDataColumnMeta],
) -> FilterClause {
    let column_kinds: HashMap<&str, ColumnFilterKind> = columns
        .iter()
        .map(|column| {
            (
                column.name.as_str(),
                classify_column_filter_kind(&column.data_type),
            )
        })
        .collect();

    translate_filter_conditions(conditions, |column_name| {
        column_kinds
            .get(column_name)
            .copied()
            .unwrap_or(ColumnFilterKind::TextLike)
    })
}

pub fn where_clause_sql(filter_sql: &str) -> String {
    if filter_sql.is_empty() {
        return String::new();
    }
    format!(" WHERE {filter_sql}")
}

pub fn sort_direction_keyword(direction: &str) -> &'static str {
    if direction == "desc" {
        return "DESC";
    }
    "ASC"
}

#[cfg(not(coverage))]
pub(super) fn order_by_sql(sort: Option<&SortInfo>) -> Result<String, String> {
    let Some(sort_spec) = sort else {
        return Ok(String::new());
    };
    let safe_col = safe_identifier(&sort_spec.column)?;
    let dir = sort_direction_keyword(&sort_spec.direction);
    Ok(format!(" ORDER BY {safe_col} {dir}"))
}
