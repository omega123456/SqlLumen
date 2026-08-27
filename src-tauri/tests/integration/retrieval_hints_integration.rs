//! Integration tests for `RetrievalHints` serde round-trip and hint-based
//! score boosting in the extended search pipeline.

use sqllumen_lib::schema_index::search::{RetrievalHints, TableHint, TableRef};

#[test]
fn retrieval_hints_serde_round_trip() {
    let hints = RetrievalHints {
        recent_tables: vec![TableHint {
            db_name: "db1".to_string(),
            table_name: "users".to_string(),
            weight: 0.9,
        }],
        editor_tables: vec![TableRef {
            db_name: "db1".to_string(),
            table_name: "orders".to_string(),
        }],
        accepted_tables: vec![TableHint {
            db_name: "db1".to_string(),
            table_name: "products".to_string(),
            weight: 0.5,
        }],
    };

    let json = serde_json::to_string(&hints).expect("serialize");
    let parsed: RetrievalHints = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(parsed.recent_tables.len(), 1);
    assert_eq!(parsed.recent_tables[0].db_name, "db1");
    assert_eq!(parsed.recent_tables[0].table_name, "users");
    assert!((parsed.recent_tables[0].weight - 0.9).abs() < 1e-6);

    assert_eq!(parsed.editor_tables.len(), 1);
    assert_eq!(parsed.editor_tables[0].table_name, "orders");

    assert_eq!(parsed.accepted_tables.len(), 1);
    assert_eq!(parsed.accepted_tables[0].weight, 0.5);
}

#[test]
fn retrieval_hints_default_is_empty() {
    let hints = RetrievalHints::default();
    assert!(hints.recent_tables.is_empty());
    assert!(hints.editor_tables.is_empty());
    assert!(hints.accepted_tables.is_empty());
}

#[test]
fn retrieval_hints_deserialize_from_camel_case() {
    let json = r#"{"recentTables":[{"dbName":"db","tableName":"t","weight":1.0}],"editorTables":[],"acceptedTables":[]}"#;
    let parsed: RetrievalHints = serde_json::from_str(json).expect("deserialize camelCase");
    assert_eq!(parsed.recent_tables.len(), 1);
    assert_eq!(parsed.recent_tables[0].db_name, "db");
}

#[test]
fn retrieval_hints_deserialize_missing_fields_uses_defaults() {
    let json = r#"{}"#;
    let parsed: RetrievalHints = serde_json::from_str(json).expect("deserialize empty");
    assert!(parsed.recent_tables.is_empty());
    assert!(parsed.editor_tables.is_empty());
    assert!(parsed.accepted_tables.is_empty());
}
