const SQLX_LABELS_FOR_DISPLAY_WIDTH_ONE_TINYINT: [&str; 2] = ["BOOLEAN", "BOOL"];

const INTEGER_TYPE_NAMES_WITHOUT_INT: [&str; 4] = ["SHORT", "LONG", "LONGLONG", "YEAR"];

const INTEGER_TYPE_NAME_FRAGMENT: &str = "INT";

const FLOAT_TYPE_NAME_FRAGMENTS: [&str; 2] = ["FLOAT", "DOUBLE"];

const DECIMAL_TYPE_NAME_FRAGMENTS: [&str; 2] = ["DECIMAL", "NUMERIC"];

const BLOB_TYPE_NAME_FRAGMENT: &str = "BLOB";

const BINARY_TYPE_NAMES_WITHOUT_BLOB: [&str; 2] = ["BINARY", "VARBINARY"];

fn contains_any_fragment(type_name: &str, fragments: &[&str]) -> bool {
    fragments
        .iter()
        .any(|fragment| type_name.contains(fragment))
}

pub fn is_sqlx_float_type_name(type_name: &str) -> bool {
    contains_any_fragment(type_name, &FLOAT_TYPE_NAME_FRAGMENTS)
}

pub fn is_sqlx_decimal_type_name(type_name: &str) -> bool {
    contains_any_fragment(type_name, &DECIMAL_TYPE_NAME_FRAGMENTS)
}

pub fn is_sqlx_binary_type_name(type_name: &str) -> bool {
    let names_a_blob_family = type_name.contains(BLOB_TYPE_NAME_FRAGMENT);
    let is_listed_binary_name = BINARY_TYPE_NAMES_WITHOUT_BLOB.contains(&type_name);
    names_a_blob_family || is_listed_binary_name
}

pub fn is_sqlx_integer_type_name(type_name: &str) -> bool {
    let is_tinyint_labelled_boolean =
        SQLX_LABELS_FOR_DISPLAY_WIDTH_ONE_TINYINT.contains(&type_name);
    let is_listed_integer_name = INTEGER_TYPE_NAMES_WITHOUT_INT.contains(&type_name);
    let names_an_int_family = type_name.contains(INTEGER_TYPE_NAME_FRAGMENT);
    is_tinyint_labelled_boolean || is_listed_integer_name || names_an_int_family
}
