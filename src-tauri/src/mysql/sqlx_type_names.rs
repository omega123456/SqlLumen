const SQLX_LABELS_FOR_DISPLAY_WIDTH_ONE_TINYINT: [&str; 2] = ["BOOLEAN", "BOOL"];

const INTEGER_TYPE_NAMES_WITHOUT_INT: [&str; 4] = ["SHORT", "LONG", "LONGLONG", "YEAR"];

const INTEGER_TYPE_NAME_FRAGMENT: &str = "INT";

pub fn is_sqlx_integer_type_name(type_name: &str) -> bool {
    let is_tinyint_labelled_boolean =
        SQLX_LABELS_FOR_DISPLAY_WIDTH_ONE_TINYINT.contains(&type_name);
    let is_listed_integer_name = INTEGER_TYPE_NAMES_WITHOUT_INT.contains(&type_name);
    let names_an_int_family = type_name.contains(INTEGER_TYPE_NAME_FRAGMENT);
    is_tinyint_labelled_boolean || is_listed_integer_name || names_an_int_family
}
