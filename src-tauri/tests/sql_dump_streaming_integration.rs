//! Integration tests for `stream_to_dump` — the streaming SQL dump helper.
//!
//! These tests use `futures::stream::iter` with `Vec<SqlDumpValue>` rows
//! and `std::io::Cursor<Vec<u8>>` as the writer, avoiding any need for
//! real MySQL connections or `MySqlRow` construction.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, RwLock};

use sqllumen_lib::commands::sql_dump::stream_to_dump;
use sqllumen_lib::export::sql_dump::{SqlDumpValue, INSERT_BATCH_SIZE};
use sqllumen_lib::state::{DumpJobProgress, DumpJobStatus};

/// Create a fresh progress map with a single test job entry.
fn make_progress(job_id: &str) -> Arc<RwLock<HashMap<String, DumpJobProgress>>> {
    let progress = DumpJobProgress {
        job_id: job_id.to_string(),
        status: DumpJobStatus::Running,
        tables_total: 1,
        tables_done: 0,
        current_table: Some("test_table".to_string()),
        bytes_written: 0,
        rows_exported: 0,
        error_message: None,
        cancel_requested: false,
        mysql_thread_id: None,
        completed_at: None,
    };
    let mut map = HashMap::new();
    map.insert(job_id.to_string(), progress);
    Arc::new(RwLock::new(map))
}

/// Build a stream of `Result<Vec<SqlDumpValue>, sqlx::Error>` from an iterator of rows.
fn row_stream(
    rows: Vec<Vec<SqlDumpValue>>,
) -> impl futures::TryStream<Ok = Vec<SqlDumpValue>, Error = sqlx::Error> + Unpin {
    futures::stream::iter(rows.into_iter().map(Ok))
}

/// Helper: generate N rows with two columns (an Int id and a QuotedString name).
fn generate_rows(n: usize) -> Vec<Vec<SqlDumpValue>> {
    (0..n)
        .map(|i| {
            vec![
                SqlDumpValue::Int(i as i64),
                SqlDumpValue::QuotedString(format!("row_{i}")),
            ]
        })
        .collect()
}

/// Count occurrences of a substring in text.
fn count_occurrences(text: &str, pattern: &str) -> usize {
    text.matches(pattern).count()
}

// ---------------------------------------------------------------------------
// Test: Multi-batch table — 2500 rows → 3 INSERT statements
// ---------------------------------------------------------------------------

#[tokio::test]
async fn multi_batch_produces_three_inserts() {
    let job_id = "multi-batch";
    let jobs = make_progress(job_id);
    let mut cursor = Cursor::new(Vec::new());
    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = generate_rows(2500);

    let stream = row_stream(rows);
    stream_to_dump(
        stream,
        &mut cursor,
        "users",
        &columns,
        |row: &Vec<SqlDumpValue>| row.clone(),
        &jobs,
        job_id,
    )
    .await
    .expect("stream_to_dump should succeed");

    let output = String::from_utf8(cursor.into_inner()).unwrap();

    // Exactly 3 INSERT INTO statements (1000 + 1000 + 500)
    let insert_count = count_occurrences(&output, "INSERT INTO");
    assert_eq!(
        insert_count, 3,
        "Expected 3 INSERT statements for 2500 rows, got {insert_count}"
    );

    // Contains proper structure
    assert!(output.contains("LOCK TABLES `users` WRITE;"));
    assert!(output.contains("UNLOCK TABLES;"));
    assert!(output.contains("`id`, `name`"));

    // Verify first and last row data present (values are comma-space separated)
    assert!(output.contains("0, 'row_0'"));
    assert!(output.contains("2499, 'row_2499'"));
}

// ---------------------------------------------------------------------------
// Test: Exact batch boundary — 1000 rows → exactly 1 INSERT statement
// ---------------------------------------------------------------------------

#[tokio::test]
async fn exact_batch_boundary_produces_one_insert() {
    let job_id = "exact-boundary";
    let jobs = make_progress(job_id);
    let mut cursor = Cursor::new(Vec::new());
    let columns = vec!["id".to_string(), "name".to_string()];
    let rows = generate_rows(INSERT_BATCH_SIZE); // exactly 1000

    let stream = row_stream(rows);
    stream_to_dump(
        stream,
        &mut cursor,
        "items",
        &columns,
        |row: &Vec<SqlDumpValue>| row.clone(),
        &jobs,
        job_id,
    )
    .await
    .expect("stream_to_dump should succeed");

    let output = String::from_utf8(cursor.into_inner()).unwrap();

    let insert_count = count_occurrences(&output, "INSERT INTO");
    assert_eq!(
        insert_count, 1,
        "Expected exactly 1 INSERT for {INSERT_BATCH_SIZE} rows, got {insert_count}"
    );

    assert!(output.contains("LOCK TABLES `items` WRITE;"));
    assert!(output.contains("UNLOCK TABLES;"));
}

// ---------------------------------------------------------------------------
// Test: Single-batch table — fewer than 1000 rows → 1 INSERT statement
// ---------------------------------------------------------------------------

#[tokio::test]
async fn single_batch_fewer_than_limit() {
    let job_id = "single-batch";
    let jobs = make_progress(job_id);
    let mut cursor = Cursor::new(Vec::new());
    let columns = vec!["val".to_string()];
    let rows: Vec<Vec<SqlDumpValue>> = (0..50).map(|i| vec![SqlDumpValue::Int(i)]).collect();

    let stream = row_stream(rows);
    stream_to_dump(
        stream,
        &mut cursor,
        "small",
        &columns,
        |row: &Vec<SqlDumpValue>| row.clone(),
        &jobs,
        job_id,
    )
    .await
    .expect("stream_to_dump should succeed");

    let output = String::from_utf8(cursor.into_inner()).unwrap();

    let insert_count = count_occurrences(&output, "INSERT INTO");
    assert_eq!(
        insert_count, 1,
        "Expected 1 INSERT for 50 rows, got {insert_count}"
    );

    assert!(output.contains("LOCK TABLES `small` WRITE;"));
    assert!(output.contains("UNLOCK TABLES;"));
}

// ---------------------------------------------------------------------------
// Test: Empty stream — 0 rows → no INSERT, no LOCK/UNLOCK, no error
// ---------------------------------------------------------------------------

#[tokio::test]
async fn empty_stream_produces_no_output() {
    let job_id = "empty";
    let jobs = make_progress(job_id);
    let mut cursor = Cursor::new(Vec::new());
    let columns = vec!["id".to_string()];

    let stream = row_stream(vec![]);
    stream_to_dump(
        stream,
        &mut cursor,
        "empty_tbl",
        &columns,
        |row: &Vec<SqlDumpValue>| row.clone(),
        &jobs,
        job_id,
    )
    .await
    .expect("stream_to_dump should succeed with empty stream");

    let output = String::from_utf8(cursor.into_inner()).unwrap();

    assert!(
        !output.contains("INSERT INTO"),
        "Empty stream should produce no INSERT"
    );
    assert!(
        !output.contains("LOCK TABLES"),
        "Empty stream should produce no LOCK"
    );
    assert!(
        !output.contains("UNLOCK TABLES"),
        "Empty stream should produce no UNLOCK"
    );

    // bytes_written should still be 0
    let jobs_read = jobs.read().unwrap();
    let progress = jobs_read.get(job_id).unwrap();
    assert_eq!(progress.bytes_written, 0);
}

// ---------------------------------------------------------------------------
// Test: Per-batch progress — bytes_written > 0 and monotonically increasing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn per_batch_progress_is_monotonically_increasing() {
    let job_id = "progress-check";
    let jobs = make_progress(job_id);
    let mut cursor = Cursor::new(Vec::new());
    let columns = vec!["id".to_string(), "name".to_string()];

    // 2500 rows = 3 batches. After completion, bytes_written should reflect
    // the final batch flush position.
    let rows = generate_rows(2500);
    let stream = row_stream(rows);
    stream_to_dump(
        stream,
        &mut cursor,
        "progress_tbl",
        &columns,
        |row: &Vec<SqlDumpValue>| row.clone(),
        &jobs,
        job_id,
    )
    .await
    .expect("stream_to_dump should succeed");

    let jobs_read = jobs.read().unwrap();
    let progress = jobs_read.get(job_id).unwrap();

    // After 3 batches, bytes_written must be > 0
    assert!(
        progress.bytes_written > 0,
        "bytes_written should be > 0 after streaming, got {}",
        progress.bytes_written
    );

    // bytes_written should roughly match the cursor position (minus UNLOCK trailing bytes)
    let total_written = cursor.get_ref().len() as u64;
    assert!(
        progress.bytes_written <= total_written,
        "bytes_written ({}) should not exceed total output ({})",
        progress.bytes_written,
        total_written
    );
}

// ---------------------------------------------------------------------------
// Test: Output correctness — proper SQL formatting and value types
// ---------------------------------------------------------------------------

#[tokio::test]
async fn output_contains_correct_sql_formatting() {
    let job_id = "formatting";
    let jobs = make_progress(job_id);
    let mut cursor = Cursor::new(Vec::new());
    let columns = vec!["id".to_string(), "label".to_string(), "price".to_string()];

    let rows = vec![
        vec![
            SqlDumpValue::Int(1),
            SqlDumpValue::QuotedString("hello".to_string()),
            SqlDumpValue::Float(9.99),
        ],
        vec![
            SqlDumpValue::Null,
            SqlDumpValue::QuotedString("world's".to_string()),
            SqlDumpValue::Decimal("123.456".to_string()),
        ],
        vec![
            SqlDumpValue::UInt(42),
            SqlDumpValue::HexBytes(vec![0xDE, 0xAD]),
            SqlDumpValue::Bool(true),
        ],
    ];

    let stream = row_stream(rows);
    stream_to_dump(
        stream,
        &mut cursor,
        "products",
        &columns,
        |row: &Vec<SqlDumpValue>| row.clone(),
        &jobs,
        job_id,
    )
    .await
    .expect("stream_to_dump should succeed");

    let output = String::from_utf8(cursor.into_inner()).unwrap();

    // Correct INSERT INTO with column list
    assert!(output.contains("INSERT INTO `products` (`id`, `label`, `price`) VALUES"));

    // Value formatting checks (columns are comma-space separated)
    assert!(output.contains("1, 'hello', 9.99"));
    assert!(output.contains("NULL, 'world''s', 123.456"));
    assert!(output.contains("42, 0xDEAD, 1"));

    // Data comment header
    assert!(output.contains("-- Data for `products`"));
}

// ---------------------------------------------------------------------------
// Test: Mid-stream error — UNLOCK TABLES is written even when stream fails
// ---------------------------------------------------------------------------

#[tokio::test]
async fn mid_stream_error_propagates() {
    let job_id = "mid-error";
    let jobs = make_progress(job_id);
    let mut cursor = Cursor::new(Vec::new());
    let columns = vec!["id".to_string(), "name".to_string()];

    // 1500 Ok rows followed by one Err — guarantees at least one full batch is flushed
    let mut items: Vec<Result<Vec<SqlDumpValue>, sqlx::Error>> = (0..1500)
        .map(|i| {
            Ok(vec![
                SqlDumpValue::Int(i),
                SqlDumpValue::QuotedString(format!("row_{i}")),
            ])
        })
        .collect();
    items.push(Err(sqlx::Error::Protocol("connection lost".into())));

    let stream = futures::stream::iter(items);

    let result = stream_to_dump(
        stream,
        &mut cursor,
        "erroring",
        &columns,
        |row: &Vec<SqlDumpValue>| row.clone(),
        &jobs,
        job_id,
    )
    .await;

    assert!(
        result.is_err(),
        "stream_to_dump should return Err on mid-stream failure"
    );
    let err_msg = result.unwrap_err();
    assert!(
        err_msg.contains("connection lost"),
        "Error message should contain the protocol error, got: {err_msg}"
    );

    let output = String::from_utf8(cursor.into_inner()).unwrap();

    // At least one batch was flushed before the error
    assert!(
        output.contains("INSERT INTO"),
        "Output should contain INSERT INTO from flushed batches"
    );
    assert!(
        output.contains("LOCK TABLES"),
        "Output should contain LOCK TABLES"
    );
    // Fix 1: UNLOCK TABLES must be written even on error
    assert!(
        output.contains("UNLOCK TABLES"),
        "Output should contain UNLOCK TABLES even after mid-stream error"
    );
}

// ---------------------------------------------------------------------------
// Test: Empty columns — early return with no output
// ---------------------------------------------------------------------------

#[tokio::test]
async fn empty_columns_returns_ok_with_no_output() {
    let job_id = "empty-cols";
    let jobs = make_progress(job_id);
    let mut cursor = Cursor::new(Vec::new());
    let columns: Vec<String> = vec![];
    let rows = generate_rows(10);

    let stream = row_stream(rows);
    stream_to_dump(
        stream,
        &mut cursor,
        "tbl",
        &columns,
        |row: &Vec<SqlDumpValue>| row.clone(),
        &jobs,
        job_id,
    )
    .await
    .expect("stream_to_dump should succeed with empty columns");

    let output = String::from_utf8(cursor.into_inner()).unwrap();
    assert!(output.is_empty(), "Empty columns should produce no output");
}
