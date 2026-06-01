mod common;

#[cfg(not(coverage))]
use common::mock_mysql_server::{MockCell, MockColumnDef, MockMySqlServer, MockQueryStep};
#[cfg(not(coverage))]
use opensrv_mysql::{ColumnFlags, ColumnType, ErrorKind};

#[cfg(not(coverage))]
use sqllumen_lib::mysql::schema_queries::{query_all_foreign_keys_batch, query_all_indexes_batch};

#[cfg(coverage)]
use sqllumen_lib::mysql::schema_queries::{query_all_foreign_keys_batch, query_all_indexes_batch};
#[cfg(not(coverage))]
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

#[cfg(not(coverage))]
fn pool_for(port: u16) -> sqlx::MySqlPool {
    let opts = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(port)
        .username("root")
        .password("");
    MySqlPoolOptions::new().connect_lazy_with(opts)
}

#[cfg(not(coverage))]
fn text_col(name: &'static str) -> MockColumnDef {
    MockColumnDef {
        name,
        coltype: ColumnType::MYSQL_TYPE_VAR_STRING,
        colflags: ColumnFlags::empty(),
    }
}

#[cfg(not(coverage))]
fn int_col(name: &'static str) -> MockColumnDef {
    MockColumnDef {
        name,
        coltype: ColumnType::MYSQL_TYPE_LONGLONG,
        colflags: ColumnFlags::empty(),
    }
}

// ── FK batch: multiple databases ────────────────────────────────────────────

#[cfg(not(coverage))]
#[tokio::test]
async fn fk_batch_multiple_databases() {
    let steps = vec![MockQueryStep {
        query: "SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE kcu JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA WHERE kcu.TABLE_SCHEMA IN (?, ?) AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
        columns: vec![
            text_col("TABLE_SCHEMA"),
            text_col("TABLE_NAME"),
            text_col("CONSTRAINT_NAME"),
            text_col("COLUMN_NAME"),
            text_col("REFERENCED_TABLE_SCHEMA"),
            text_col("REFERENCED_TABLE_NAME"),
            text_col("REFERENCED_COLUMN_NAME"),
            text_col("DELETE_RULE"),
            text_col("UPDATE_RULE"),
        ],
        rows: vec![
            vec![
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"orders"),
                MockCell::Bytes(b"fk_orders_user"),
                MockCell::Bytes(b"user_id"),
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"users"),
                MockCell::Bytes(b"id"),
                MockCell::Bytes(b"CASCADE"),
                MockCell::Bytes(b"RESTRICT"),
            ],
            vec![
                MockCell::Bytes(b"analytics"),
                MockCell::Bytes(b"events"),
                MockCell::Bytes(b"fk_events_user"),
                MockCell::Bytes(b"user_id"),
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"users"),
                MockCell::Bytes(b"id"),
                MockCell::Bytes(b"SET NULL"),
                MockCell::Bytes(b"NO ACTION"),
            ],
        ],
        error: None,
        affected_rows: None,
    }];

    let server = MockMySqlServer::start_script(steps).await;
    let pool = pool_for(server.port);

    let dbs = vec!["app".to_string(), "analytics".to_string()];
    let result = query_all_foreign_keys_batch(&pool, &dbs)
        .await
        .expect("batch FK should succeed");

    assert_eq!(result.len(), 2);

    let app_orders = result.get("app.orders").expect("app.orders key");
    assert_eq!(app_orders.len(), 1);
    assert_eq!(app_orders[0].name, "fk_orders_user");
    assert_eq!(app_orders[0].on_delete, "CASCADE");

    let analytics_events = result
        .get("analytics.events")
        .expect("analytics.events key");
    assert_eq!(analytics_events.len(), 1);
    assert_eq!(analytics_events[0].name, "fk_events_user");
    assert_eq!(analytics_events[0].on_delete, "SET NULL");
}

// ── FK batch: single database ───────────────────────────────────────────────

#[cfg(not(coverage))]
#[tokio::test]
async fn fk_batch_single_database() {
    let steps = vec![MockQueryStep {
        query: "SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE kcu JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA WHERE kcu.TABLE_SCHEMA IN (?) AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
        columns: vec![
            text_col("TABLE_SCHEMA"),
            text_col("TABLE_NAME"),
            text_col("CONSTRAINT_NAME"),
            text_col("COLUMN_NAME"),
            text_col("REFERENCED_TABLE_SCHEMA"),
            text_col("REFERENCED_TABLE_NAME"),
            text_col("REFERENCED_COLUMN_NAME"),
            text_col("DELETE_RULE"),
            text_col("UPDATE_RULE"),
        ],
        rows: vec![vec![
            MockCell::Bytes(b"mydb"),
            MockCell::Bytes(b"posts"),
            MockCell::Bytes(b"fk_posts_author"),
            MockCell::Bytes(b"author_id"),
            MockCell::Bytes(b"mydb"),
            MockCell::Bytes(b"authors"),
            MockCell::Bytes(b"id"),
            MockCell::Bytes(b"RESTRICT"),
            MockCell::Bytes(b"CASCADE"),
        ]],
        error: None,
        affected_rows: None,
    }];

    let server = MockMySqlServer::start_script(steps).await;
    let pool = pool_for(server.port);

    let dbs = vec!["mydb".to_string()];
    let result = query_all_foreign_keys_batch(&pool, &dbs)
        .await
        .expect("single-db FK batch should succeed");

    assert_eq!(result.len(), 1);
    let posts = result.get("mydb.posts").expect("mydb.posts key");
    assert_eq!(posts[0].referenced_table, "authors");
}

// ── FK batch: empty input ───────────────────────────────────────────────────

#[tokio::test]
async fn fk_batch_empty_input() {
    // No mock server needed — empty input returns immediately
    #[cfg(not(coverage))]
    {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(19999)
            .username("root")
            .password("");
        let pool = MySqlPoolOptions::new().connect_lazy_with(opts);
        let result = query_all_foreign_keys_batch(&pool, &[])
            .await
            .expect("empty input should return Ok");
        assert!(result.is_empty());
    }
    #[cfg(coverage)]
    {
        use sqllumen_lib::mysql::schema_queries::query_all_foreign_keys_batch;
        let result = query_all_foreign_keys_batch(&(), &[])
            .await
            .expect("coverage stub empty");
        assert!(result.is_empty());
    }
}

// ── FK batch: error path ────────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tokio::test]
async fn fk_batch_error() {
    let steps = vec![MockQueryStep {
        query: "SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE kcu JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA WHERE kcu.TABLE_SCHEMA IN (?) AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
        columns: vec![text_col("TABLE_SCHEMA")],
        rows: vec![],
        error: Some((ErrorKind::ER_WRONG_VALUE, b"fk boom")),
        affected_rows: None,
    }];

    let server = MockMySqlServer::start_script(steps).await;
    let pool = pool_for(server.port);

    let dbs = vec!["bad_db".to_string()];
    let err = query_all_foreign_keys_batch(&pool, &dbs)
        .await
        .expect_err("should fail");
    assert!(err.contains("Failed to get batch foreign keys"));
}

// ── Index batch: multiple databases ─────────────────────────────────────────

#[cfg(not(coverage))]
#[tokio::test]
async fn index_batch_multiple_databases() {
    let steps = vec![MockQueryStep {
        query: "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, CARDINALITY FROM information_schema.STATISTICS WHERE TABLE_SCHEMA IN (?, ?) ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
        columns: vec![
            text_col("TABLE_SCHEMA"),
            text_col("TABLE_NAME"),
            text_col("INDEX_NAME"),
            int_col("NON_UNIQUE"),
            text_col("INDEX_TYPE"),
            text_col("COLUMN_NAME"),
            int_col("CARDINALITY"),
        ],
        rows: vec![
            vec![
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"users"),
                MockCell::Bytes(b"PRIMARY"),
                MockCell::I64(0),
                MockCell::Bytes(b"BTREE"),
                MockCell::Bytes(b"id"),
                MockCell::I64(100),
            ],
            vec![
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"users"),
                MockCell::Bytes(b"idx_composite"),
                MockCell::I64(1),
                MockCell::Bytes(b"BTREE"),
                MockCell::Bytes(b"first_name"),
                MockCell::I64(50),
            ],
            vec![
                MockCell::Bytes(b"app"),
                MockCell::Bytes(b"users"),
                MockCell::Bytes(b"idx_composite"),
                MockCell::I64(1),
                MockCell::Bytes(b"BTREE"),
                MockCell::Bytes(b"last_name"),
                MockCell::I64(50),
            ],
            vec![
                MockCell::Bytes(b"analytics"),
                MockCell::Bytes(b"events"),
                MockCell::Bytes(b"PRIMARY"),
                MockCell::I64(0),
                MockCell::Bytes(b"BTREE"),
                MockCell::Bytes(b"id"),
                MockCell::I64(1000),
            ],
        ],
        error: None,
        affected_rows: None,
    }];

    let server = MockMySqlServer::start_script(steps).await;
    let pool = pool_for(server.port);

    let dbs = vec!["app".to_string(), "analytics".to_string()];
    let result = query_all_indexes_batch(&pool, &dbs)
        .await
        .expect("batch index should succeed");

    assert_eq!(result.len(), 2);

    let app_users = result.get("app.users").expect("app.users key");
    assert_eq!(app_users.len(), 2);
    assert_eq!(app_users[0].name, "PRIMARY");
    assert!(app_users[0].is_unique);
    assert_eq!(app_users[0].columns, vec!["id"]);
    // Composite index
    assert_eq!(app_users[1].name, "idx_composite");
    assert!(!app_users[1].is_unique);
    assert_eq!(app_users[1].columns, vec!["first_name", "last_name"]);

    let analytics_events = result
        .get("analytics.events")
        .expect("analytics.events key");
    assert_eq!(analytics_events.len(), 1);
    assert_eq!(analytics_events[0].name, "PRIMARY");
}

// ── Index batch: single database ────────────────────────────────────────────

#[cfg(not(coverage))]
#[tokio::test]
async fn index_batch_single_database() {
    let steps = vec![MockQueryStep {
        query: "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, CARDINALITY FROM information_schema.STATISTICS WHERE TABLE_SCHEMA IN (?) ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
        columns: vec![
            text_col("TABLE_SCHEMA"),
            text_col("TABLE_NAME"),
            text_col("INDEX_NAME"),
            int_col("NON_UNIQUE"),
            text_col("INDEX_TYPE"),
            text_col("COLUMN_NAME"),
            int_col("CARDINALITY"),
        ],
        rows: vec![vec![
            MockCell::Bytes(b"mydb"),
            MockCell::Bytes(b"posts"),
            MockCell::Bytes(b"PRIMARY"),
            MockCell::I64(0),
            MockCell::Bytes(b"BTREE"),
            MockCell::Bytes(b"id"),
            MockCell::I64(5),
        ]],
        error: None,
        affected_rows: None,
    }];

    let server = MockMySqlServer::start_script(steps).await;
    let pool = pool_for(server.port);

    let dbs = vec!["mydb".to_string()];
    let result = query_all_indexes_batch(&pool, &dbs)
        .await
        .expect("single-db index batch should succeed");

    assert_eq!(result.len(), 1);
    let posts = result.get("mydb.posts").expect("mydb.posts key");
    assert_eq!(posts[0].name, "PRIMARY");
}

// ── Index batch: empty input ────────────────────────────────────────────────

#[tokio::test]
async fn index_batch_empty_input() {
    #[cfg(not(coverage))]
    {
        let opts = MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(19999)
            .username("root")
            .password("");
        let pool = MySqlPoolOptions::new().connect_lazy_with(opts);
        let result = query_all_indexes_batch(&pool, &[])
            .await
            .expect("empty input should return Ok");
        assert!(result.is_empty());
    }
    #[cfg(coverage)]
    {
        use sqllumen_lib::mysql::schema_queries::query_all_indexes_batch;
        let result = query_all_indexes_batch(&(), &[])
            .await
            .expect("coverage stub empty");
        assert!(result.is_empty());
    }
}

#[cfg(coverage)]
#[tokio::test]
async fn fk_batch_coverage_stub_non_empty_input() {
    let result = query_all_foreign_keys_batch(&(), &["app".to_string(), "analytics".to_string()])
        .await
        .expect("coverage stub should succeed");
    assert!(result.is_empty());
}

#[cfg(coverage)]
#[tokio::test]
async fn fk_batch_coverage_stub_repeated_calls_stay_empty() {
    let first = query_all_foreign_keys_batch(&(), &["db1".to_string()])
        .await
        .expect("first coverage stub should succeed");
    let second = query_all_foreign_keys_batch(&(), &["db2".to_string(), "db3".to_string()])
        .await
        .expect("second coverage stub should succeed");
    assert!(first.is_empty());
    assert!(second.is_empty());
}

#[cfg(coverage)]
#[tokio::test]
async fn index_batch_coverage_stub_non_empty_input() {
    let result = query_all_indexes_batch(&(), &["app".to_string(), "analytics".to_string()])
        .await
        .expect("coverage stub should succeed");
    assert!(result.is_empty());
}

#[cfg(coverage)]
#[tokio::test]
async fn index_batch_coverage_stub_repeated_calls_stay_empty() {
    let first = query_all_indexes_batch(&(), &["db1".to_string()])
        .await
        .expect("first coverage stub should succeed");
    let second = query_all_indexes_batch(&(), &["db2".to_string(), "db3".to_string()])
        .await
        .expect("second coverage stub should succeed");
    assert!(first.is_empty());
    assert!(second.is_empty());
}

// ── Index batch: error path ─────────────────────────────────────────────────

#[cfg(not(coverage))]
#[tokio::test]
async fn index_batch_error() {
    let steps = vec![MockQueryStep {
        query: "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, CARDINALITY FROM information_schema.STATISTICS WHERE TABLE_SCHEMA IN (?) ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
        columns: vec![text_col("TABLE_SCHEMA")],
        rows: vec![],
        error: Some((ErrorKind::ER_WRONG_VALUE, b"idx boom")),
        affected_rows: None,
    }];

    let server = MockMySqlServer::start_script(steps).await;
    let pool = pool_for(server.port);

    let dbs = vec!["bad_db".to_string()];
    let err = query_all_indexes_batch(&pool, &dbs)
        .await
        .expect_err("should fail");
    assert!(err.contains("Failed to get batch indexes"));
}
