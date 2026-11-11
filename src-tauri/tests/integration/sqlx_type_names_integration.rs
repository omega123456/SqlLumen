use sqllumen_lib::mysql::sqlx_type_names::is_sqlx_integer_type_name;

struct SerializerSource {
    path: &'static str,
    source: &'static str,
}

const SQLX_ROW_SERIALIZER_SOURCES: [SerializerSource; 3] = [
    SerializerSource {
        path: "mysql/table_data.rs",
        source: include_str!("../../src/mysql/table_data.rs"),
    },
    SerializerSource {
        path: "commands/sql_dump.rs",
        source: include_str!("../../src/commands/sql_dump.rs"),
    },
    SerializerSource {
        path: "mysql/query_log.rs",
        source: include_str!("../../src/mysql/query_log.rs"),
    },
];

const PRIVATE_INTEGER_CHECK: &str = "type_name.contains(\"INT\")";
const SHARED_INTEGER_CHECK: &str = "is_sqlx_integer_type_name(&type_name)";

const INTEGER_TYPE_NAMES: [&str; 15] = [
    "BOOLEAN",
    "BOOL",
    "TINYINT",
    "TINYINT UNSIGNED",
    "SMALLINT",
    "SHORT",
    "LONG",
    "INT24",
    "LONGLONG",
    "INT",
    "INT UNSIGNED",
    "BIGINT",
    "BIGINT UNSIGNED",
    "MEDIUMINT",
    "YEAR",
];

const NON_INTEGER_TYPE_NAMES: [&str; 8] = [
    "VARCHAR", "TEXT", "DECIMAL", "DATETIME", "BLOB", "JSON", "BIT", "LONGTEXT",
];

#[test]
fn integer_type_names_including_boolean_labelled_tinyint_are_integers() {
    for type_name in INTEGER_TYPE_NAMES {
        assert!(
            is_sqlx_integer_type_name(type_name),
            "{type_name} should be an integer"
        );
    }
}

#[test]
fn non_integer_type_names_are_not_integers() {
    for type_name in NON_INTEGER_TYPE_NAMES {
        let is_integer = is_sqlx_integer_type_name(type_name);
        assert!(!is_integer, "{type_name} should not be an integer");
    }
}

#[test]
fn every_sqlx_row_serializer_uses_the_shared_integer_check() {
    for serializer in SQLX_ROW_SERIALIZER_SOURCES {
        let keeps_private_check = serializer.source.contains(PRIVATE_INTEGER_CHECK);
        let uses_shared_check = serializer.source.contains(SHARED_INTEGER_CHECK);
        assert!(
            !keeps_private_check,
            "{} must not keep its own integer type-name list",
            serializer.path
        );
        assert!(
            uses_shared_check,
            "{} must decide integer columns with is_sqlx_integer_type_name",
            serializer.path
        );
    }
}
