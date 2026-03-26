//! Integration tests for table data operations — filter translation and coverage stubs.

use mysql_client_lib::mysql::table_data::{
    translate_filter_model, ExportTableOptions, FilterModelEntry, PrimaryKeyInfo, SortInfo,
};
use std::collections::HashMap;

mod common;

// ── translate_filter_model (pure function) ────────────────────────────────────

#[test]
fn translate_filter_model_empty() {
    let model: HashMap<String, FilterModelEntry> = HashMap::new();
    let clause = translate_filter_model(&model);
    assert!(clause.sql.is_empty());
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_contains() {
    let mut model = HashMap::new();
    model.insert(
        "name".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "contains".to_string(),
            filter: Some("alice".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("LIKE ?"));
    assert!(clause.sql.contains("`name`"));
    assert_eq!(clause.params.len(), 1);
    assert_eq!(clause.params[0], serde_json::json!("%alice%"));
}

#[test]
fn translate_filter_model_not_contains() {
    let mut model = HashMap::new();
    model.insert(
        "name".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "notContains".to_string(),
            filter: Some("bob".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("NOT LIKE ?"));
    assert_eq!(clause.params[0], serde_json::json!("%bob%"));
}

#[test]
fn translate_filter_model_equals() {
    let mut model = HashMap::new();
    model.insert(
        "status".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "equals".to_string(),
            filter: Some("active".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`status` = ?"));
    assert_eq!(clause.params.len(), 1);
    assert_eq!(clause.params[0], serde_json::json!("active"));
}

#[test]
fn translate_filter_model_not_equal() {
    let mut model = HashMap::new();
    model.insert(
        "status".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "notEqual".to_string(),
            filter: Some("inactive".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`status` != ?"));
    assert_eq!(clause.params[0], serde_json::json!("inactive"));
}

#[test]
fn translate_filter_model_starts_with() {
    let mut model = HashMap::new();
    model.insert(
        "name".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "startsWith".to_string(),
            filter: Some("Al".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`name` LIKE ?"));
    assert_eq!(clause.params[0], serde_json::json!("Al%"));
}

#[test]
fn translate_filter_model_ends_with() {
    let mut model = HashMap::new();
    model.insert(
        "email".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "endsWith".to_string(),
            filter: Some(".com".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`email` LIKE ?"));
    assert_eq!(clause.params[0], serde_json::json!("%.com"));
}

#[test]
fn translate_filter_model_blank() {
    let mut model = HashMap::new();
    model.insert(
        "notes".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "blank".to_string(),
            filter: None,
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`notes` IS NULL OR `notes` = ''"));
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_not_blank() {
    let mut model = HashMap::new();
    model.insert(
        "notes".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "notBlank".to_string(),
            filter: None,
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(
        clause
            .sql
            .contains("`notes` IS NOT NULL AND `notes` != ''")
    );
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_less_than() {
    let mut model = HashMap::new();
    model.insert(
        "age".to_string(),
        FilterModelEntry {
            filter_type: "number".to_string(),
            filter_condition: "lessThan".to_string(),
            filter: Some("30".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`age` < ?"));
    assert_eq!(clause.params[0], serde_json::json!("30"));
}

#[test]
fn translate_filter_model_greater_than() {
    let mut model = HashMap::new();
    model.insert(
        "salary".to_string(),
        FilterModelEntry {
            filter_type: "number".to_string(),
            filter_condition: "greaterThan".to_string(),
            filter: Some("50000".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`salary` > ?"));
    assert_eq!(clause.params[0], serde_json::json!("50000"));
}

#[test]
fn translate_filter_model_less_than_or_equal() {
    let mut model = HashMap::new();
    model.insert(
        "score".to_string(),
        FilterModelEntry {
            filter_type: "number".to_string(),
            filter_condition: "lessThanOrEqual".to_string(),
            filter: Some("100".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`score` <= ?"));
}

#[test]
fn translate_filter_model_greater_than_or_equal() {
    let mut model = HashMap::new();
    model.insert(
        "score".to_string(),
        FilterModelEntry {
            filter_type: "number".to_string(),
            filter_condition: "greaterThanOrEqual".to_string(),
            filter: Some("0".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`score` >= ?"));
}

#[test]
fn translate_filter_model_in_range() {
    let mut model = HashMap::new();
    model.insert(
        "price".to_string(),
        FilterModelEntry {
            filter_type: "number".to_string(),
            filter_condition: "inRange".to_string(),
            filter: Some("10".to_string()),
            filter_to: Some("100".to_string()),
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.contains("`price` >= ?"));
    assert!(clause.sql.contains("`price` <= ?"));
    assert_eq!(clause.params.len(), 2);
    assert_eq!(clause.params[0], serde_json::json!("10"));
    assert_eq!(clause.params[1], serde_json::json!("100"));
}

#[test]
fn translate_filter_model_multiple_columns() {
    let mut model = HashMap::new();
    model.insert(
        "name".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "contains".to_string(),
            filter: Some("alice".to_string()),
            filter_to: None,
        },
    );
    model.insert(
        "age".to_string(),
        FilterModelEntry {
            filter_type: "number".to_string(),
            filter_condition: "greaterThan".to_string(),
            filter: Some("25".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    // Both conditions should be present, joined by AND
    assert!(clause.sql.contains(" AND "));
    assert!(clause.sql.contains("`name` LIKE ?"));
    assert!(clause.sql.contains("`age` > ?"));
    assert_eq!(clause.params.len(), 2);

    // Since entries are sorted by column name, "age" comes before "name"
    assert_eq!(clause.params[0], serde_json::json!("25"));
    assert_eq!(clause.params[1], serde_json::json!("%alice%"));
}

#[test]
fn translate_filter_model_unknown_condition_skipped() {
    let mut model = HashMap::new();
    model.insert(
        "name".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "unknownFilter".to_string(),
            filter: Some("test".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    // Unknown condition is skipped — empty result
    assert!(clause.sql.is_empty());
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_missing_value_for_value_based_filter() {
    let mut model = HashMap::new();
    // "equals" with filter = None should be skipped
    model.insert(
        "name".to_string(),
        FilterModelEntry {
            filter_type: "text".to_string(),
            filter_condition: "equals".to_string(),
            filter: None,
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.is_empty());
    assert!(clause.params.is_empty());
}

#[test]
fn translate_filter_model_in_range_missing_filter_to() {
    let mut model = HashMap::new();
    // inRange with filter_to = None should be skipped
    model.insert(
        "price".to_string(),
        FilterModelEntry {
            filter_type: "number".to_string(),
            filter_condition: "inRange".to_string(),
            filter: Some("10".to_string()),
            filter_to: None,
        },
    );

    let clause = translate_filter_model(&model);
    assert!(clause.sql.is_empty());
    assert!(clause.params.is_empty());
}

// ── Data structure serialization tests ────────────────────────────────────────

#[test]
fn primary_key_info_serializes() {
    let pk = PrimaryKeyInfo {
        key_columns: vec!["id".to_string()],
        has_auto_increment: true,
        is_unique_key_fallback: false,
    };
    let json = serde_json::to_string(&pk).expect("serialize");
    assert!(json.contains("keyColumns"));
    assert!(json.contains("hasAutoIncrement"));
    assert!(json.contains("isUniqueKeyFallback"));
}

#[test]
fn sort_info_roundtrip() {
    let sort = SortInfo {
        column: "name".to_string(),
        direction: "asc".to_string(),
    };
    let json = serde_json::to_string(&sort).expect("serialize");
    let deserialized: SortInfo = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(deserialized.column, "name");
    assert_eq!(deserialized.direction, "asc");
}

#[test]
fn filter_model_entry_roundtrip() {
    let entry = FilterModelEntry {
        filter_type: "text".to_string(),
        filter_condition: "contains".to_string(),
        filter: Some("test".to_string()),
        filter_to: None,
    };
    let json = serde_json::to_string(&entry).expect("serialize");
    let deserialized: FilterModelEntry = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(deserialized.filter_condition, "contains");
    assert_eq!(deserialized.filter, Some("test".to_string()));
}

#[test]
fn export_table_options_serializes() {
    let opts = ExportTableOptions {
        connection_id: "conn-1".to_string(),
        database: "test_db".to_string(),
        table: "users".to_string(),
        format: "csv".to_string(),
        file_path: "/tmp/export.csv".to_string(),
        include_headers: true,
        table_name_for_sql: "users".to_string(),
        filter_model: HashMap::new(),
        sort: None,
    };
    let json = serde_json::to_string(&opts).expect("serialize");
    assert!(json.contains("connectionId"));
    assert!(json.contains("includeHeaders"));
}

// ── Coverage-mode tests for *_impl stubs ──────────────────────────────────────

#[cfg(coverage)]
mod coverage_stubs {
    use super::*;
    use mysql_client_lib::mysql::table_data::{
        delete_table_row_impl, export_table_data_impl, fetch_table_data_impl,
        insert_table_row_impl, update_table_row_impl,
    };
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    fn dummy_lazy_pool() -> sqlx::MySqlPool {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(13306)
            .username("dummy")
            .password("dummy");
        MySqlPoolOptions::new().connect_lazy_with(opts)
    }

    #[tokio::test]
    async fn fetch_table_data_impl_stub_returns_default() {
        let pool = dummy_lazy_pool();
        let result = fetch_table_data_impl(
            &pool,
            "test_db",
            "test_table",
            1,
            100,
            None,
            HashMap::new(),
            "conn-1",
        )
        .await;

        assert!(result.is_ok());
        let response = result.unwrap();
        assert_eq!(response.total_rows, 0);
        assert_eq!(response.current_page, 1);
        assert_eq!(response.total_pages, 1);
        assert_eq!(response.page_size, 100);
        assert!(response.columns.is_empty());
        assert!(response.rows.is_empty());
        assert!(response.primary_key.is_none());
    }

    #[tokio::test]
    async fn fetch_table_data_impl_stub_with_sort_and_filter() {
        let pool = dummy_lazy_pool();
        let mut filter = HashMap::new();
        filter.insert(
            "name".to_string(),
            FilterModelEntry {
                filter_type: "text".to_string(),
                filter_condition: "contains".to_string(),
                filter: Some("test".to_string()),
                filter_to: None,
            },
        );

        let sort = Some(SortInfo {
            column: "id".to_string(),
            direction: "asc".to_string(),
        });

        let result =
            fetch_table_data_impl(&pool, "db", "tbl", 2, 50, sort, filter, "conn-1").await;

        assert!(result.is_ok());
        let response = result.unwrap();
        assert_eq!(response.current_page, 2);
        assert_eq!(response.page_size, 50);
    }

    #[tokio::test]
    async fn update_table_row_impl_stub_returns_ok() {
        let pool = dummy_lazy_pool();
        let result = update_table_row_impl(
            &pool,
            "test_db",
            "test_table",
            &["id".to_string()],
            &{
                let mut m = HashMap::new();
                m.insert("id".to_string(), serde_json::json!(1));
                m
            },
            &{
                let mut m = HashMap::new();
                m.insert("name".to_string(), serde_json::json!("updated"));
                m
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn insert_table_row_impl_stub_returns_empty_vec() {
        let pool = dummy_lazy_pool();
        let pk = PrimaryKeyInfo {
            key_columns: vec!["id".to_string()],
            has_auto_increment: true,
            is_unique_key_fallback: false,
        };
        let values = {
            let mut m = HashMap::new();
            m.insert("name".to_string(), serde_json::json!("new_user"));
            m
        };

        let result =
            insert_table_row_impl(&pool, "test_db", "test_table", &values, &pk).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn delete_table_row_impl_stub_returns_ok() {
        let pool = dummy_lazy_pool();
        let result = delete_table_row_impl(
            &pool,
            "test_db",
            "test_table",
            &["id".to_string()],
            &{
                let mut m = HashMap::new();
                m.insert("id".to_string(), serde_json::json!(1));
                m
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn export_table_data_impl_stub_returns_ok() {
        let pool = dummy_lazy_pool();
        let options = ExportTableOptions {
            connection_id: "conn-1".to_string(),
            database: "test_db".to_string(),
            table: "users".to_string(),
            format: "csv".to_string(),
            file_path: "/tmp/test_export.csv".to_string(),
            include_headers: true,
            table_name_for_sql: "users".to_string(),
            filter_model: HashMap::new(),
            sort: None,
        };

        let result = export_table_data_impl(&pool, &options).await;
        assert!(result.is_ok());
    }
}
